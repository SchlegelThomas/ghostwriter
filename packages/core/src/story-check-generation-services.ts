import { canonicalJsonStringify } from "./agent-canonical-json.js";
import type { AgentGuidanceServices } from "./agent-guidance-services.js";
import {
  STORY_CHECK_CONTINUITY_WORKFLOW_ID,
  instructionContentHash,
  type AsyncHashPort,
  type InstructionContentHash
} from "./agent-domain.js";
import type { AgentProposalRepository } from "./agent-foundation-repository.js";
import {
  computeAgentProposalContentHash,
  createAgentRun,
  createQueuedAgentRun,
  createReadyAgentProposal,
  type AgentRun,
  type AgentRunTerminalDiagnosticCode
} from "./agent-runs-proposals.js";
import { ProjectArchivedMutationError } from "./capture-documents.js";
import { StoryWorkAssignmentNotFoundError } from "./character-story-work-services.js";
import {
  agentProposalId,
  agentRunId,
  contextReceiptId,
  DomainValidationError,
  type ManuscriptChapter,
  type ProjectId,
  type Scene,
  type SceneId,
  type StoryKnowledge
} from "./domain.js";
import {
  ProjectAccessDeniedError,
  requireProjectOwner,
  type AccountId
} from "./identity.js";
import type { Clock, IdGenerator, ProjectRepository } from "./project-repository.js";
import {
  compileStoryCheckContinuity,
  completeStoryCheckContinuity,
  type StoryCheckProviderDiagnosticCode,
  type StoryCheckResourceInput,
  type StoryCheckStructuredCompletionProvider,
  type StoryCheckTargetBindingInput
} from "./story-check-compiler.js";
import type {
  BeginStoryCheckGenerationResult,
  CompleteStoryCheckGenerationResult,
  FinishStoryCheckGenerationResult,
  StoryCheckGenerationUnitOfWork
} from "./story-check-generation-uow.js";
import { StoryCheckGenerationConflictError } from "./story-check-generation-uow.js";
import { buildTrustedStoryCheckFindingsV1 } from "./story-check-findings-validation.js";
import type { StoryContextProjection } from "./story-context.js";
import type { StoryWorkAssignmentRepository } from "./story-work-assignment-repository.js";
import {
  attachGeneratedStoryWorkArtifact,
  finishStoryWorkAttemptWithoutArtifact,
  startStoryWorkAttempt,
  type StoryWorkArtifactPointer,
  type StoryWorkAssignmentId
} from "./story-work-assignment.js";
import {
  completeStoryWorkAttempt,
  createStoryWorkAttempt,
  storyWorkAttemptIdempotencyKey,
  type StoryWorkAttemptKind,
  type StoryWorkSourceMode
} from "./story-work-attempt.js";

export type StoryCheckAttemptRequest = Readonly<{
  accountId: AccountId;
  projectId: ProjectId;
  assignmentId: StoryWorkAssignmentId;
  expectedAssignmentVersion: number;
  kind: StoryWorkAttemptKind;
  sourceMode: StoryWorkSourceMode;
  /** Exact writer text; it is neither trimmed nor rewritten. */
  instruction: string;
  idempotencyKey: string;
  storyContext: StoryContextProjection;
  target: StoryCheckTargetBindingInput;
  resources: readonly StoryCheckResourceInput[];
  skippedScenes?: readonly Readonly<{ sceneId: SceneId; reason: string }>[];
  consumedStoryKnowledge?: readonly StoryKnowledge[];
  targetSceneIntent?: Pick<Scene, "id" | "summary" | "sketch">;
  chapterObjective?: Pick<ManuscriptChapter, "id" | "summary">;
  provider: StoryCheckStructuredCompletionProvider;
  signal?: AbortSignal;
}>;

export type StoryCheckGenerationResult =
  | Readonly<{
      kind: "replayed";
      state: BeginStoryCheckGenerationResult;
    }>
  | Readonly<{
      kind: "ready";
      state: CompleteStoryCheckGenerationResult;
    }>
  | Readonly<{
      kind: "failed" | "canceled" | "stale";
      state: FinishStoryCheckGenerationResult;
    }>;

export type StoryCheckGenerationServices = Readonly<{
  generate(input: StoryCheckAttemptRequest): Promise<StoryCheckGenerationResult>;
}>;

export type StoryCheckGenerationServiceDependencies = Readonly<{
  projects: ProjectRepository;
  assignments: StoryWorkAssignmentRepository;
  proposals: AgentProposalRepository;
  guidance: AgentGuidanceServices;
  generation: StoryCheckGenerationUnitOfWork;
  hashPort: AsyncHashPort;
  ids: IdGenerator;
  clock: Clock;
}>;

function storyCheckTargetFingerprint(target: StoryCheckTargetBindingInput): unknown {
  if (target.mode === "applied-scene") {
    return Object.freeze({
      mode: "applied-scene" as const,
      sceneId: target.head.sceneId,
      workingVersion: target.head.workingVersion,
      contentHash: target.head.contentHash
    });
  }
  return Object.freeze({
    mode: "proposal-draft" as const,
    workingVersion: target.coverageSceneHead.workingVersion,
    contentHash: target.coverageSceneHead.contentHash,
    draft: target.draft
  });
}

function storyCheckResourceFingerprint(
  resources: readonly StoryCheckResourceInput[]
): readonly unknown[] {
  return Object.freeze(resources.map(({ resource }) => resource));
}

export async function storyCheckAttemptRequestFingerprint(
  input: Pick<
    StoryCheckAttemptRequest,
    | "accountId"
    | "projectId"
    | "assignmentId"
    | "kind"
    | "sourceMode"
    | "instruction"
    | "storyContext"
    | "target"
    | "resources"
    | "skippedScenes"
    | "consumedStoryKnowledge"
    | "targetSceneIntent"
    | "chapterObjective"
  >,
  hashPort: AsyncHashPort
): Promise<InstructionContentHash> {
  return instructionContentHash(
    await hashPort.digestSha256Hex(
      canonicalJsonStringify({
        accountId: input.accountId,
        projectId: input.projectId,
        assignmentId: input.assignmentId,
        kind: input.kind,
        sourceMode: input.sourceMode,
        instruction: input.instruction,
        storyContext: Object.freeze({
          projectId: input.storyContext.projectId,
          projectVersion: input.storyContext.projectVersion,
          scope: input.storyContext.scope
        }),
        target: storyCheckTargetFingerprint(input.target),
        resources: storyCheckResourceFingerprint(input.resources),
        ...(input.skippedScenes === undefined || input.skippedScenes.length === 0
          ? {}
          : { skippedScenes: input.skippedScenes }),
        ...(input.consumedStoryKnowledge === undefined ||
        input.consumedStoryKnowledge.length === 0
          ? {}
          : {
              consumedStoryKnowledge: input.consumedStoryKnowledge.map(
                (record) => record.id
              )
            }),
        ...(input.targetSceneIntent === undefined
          ? {}
          : { targetSceneIntent: input.targetSceneIntent }),
        ...(input.chapterObjective === undefined
          ? {}
          : { chapterObjective: input.chapterObjective })
      })
    )
  );
}

function mapProviderDiagnostic(
  code: StoryCheckProviderDiagnosticCode | "internal_failure"
): AgentRunTerminalDiagnosticCode {
  switch (code) {
    case "timeout":
      return "provider-timeout";
    case "rate_limited":
      return "provider-rate-limited";
    case "invalid_structured_output":
    case "validation_failed":
    case "refusal":
      return "provider-malformed-output";
    case "cancelled":
      return "run-canceled";
    case "auth_failed":
    case "upstream_error":
    case "budget_exceeded":
      return "provider-unavailable";
    case "internal_failure":
      return "internal-failure";
  }
}

async function requireOwnedAssignment(
  dependencies: StoryCheckGenerationServiceDependencies,
  input: Pick<StoryCheckAttemptRequest, "accountId" | "projectId" | "assignmentId">
) {
  try {
    requireProjectOwner(
      input.projectId,
      await dependencies.projects.getProjectMembership(input.projectId, input.accountId)
    );
  } catch (error) {
    if (error instanceof ProjectAccessDeniedError) {
      throw new StoryWorkAssignmentNotFoundError();
    }
    throw error;
  }
  const [project, assignment] = await Promise.all([
    dependencies.projects.getProject(input.projectId),
    dependencies.assignments.get(input)
  ]);
  if (project === undefined || assignment === undefined) {
    throw new StoryWorkAssignmentNotFoundError();
  }
  if (project.archivedAt !== undefined) throw new ProjectArchivedMutationError();
  return assignment;
}

function terminalRun(
  running: AgentRun,
  diagnosticCode: AgentRunTerminalDiagnosticCode,
  completedAt: string
): AgentRun {
  return createAgentRun({
    ...running,
    status: "failed",
    terminalDiagnosticCode: diagnosticCode,
    updatedAt: completedAt,
    completedAt
  });
}

async function finishTerminal(
  dependencies: StoryCheckGenerationServiceDependencies,
  input: StoryCheckAttemptRequest,
  begun: BeginStoryCheckGenerationResult,
  diagnosticCode: AgentRunTerminalDiagnosticCode,
  completedAt: string
): Promise<StoryCheckGenerationResult> {
  const outcome = diagnosticCode === "run-canceled" ? "canceled" : "failed";
  const failedRun = terminalRun(begun.run, diagnosticCode, completedAt);
  const failedAssignment = finishStoryWorkAttemptWithoutArtifact({
    assignment: begun.assignment,
    expectedVersion: begun.assignment.version,
    runId: begun.run.id,
    outcome,
    updatedAt: completedAt
  });
  const state = await dependencies.generation.finishWithoutArtifact({
    accountId: input.accountId,
    projectId: input.projectId,
    expectedAssignmentVersion: begun.assignment.version,
    expectedAttemptVersion: begun.attempt.version,
    expectedRunStatus: "running",
    terminalRun: failedRun,
    terminalAssignment: failedAssignment
  });
  return Object.freeze({ kind: outcome, state });
}

export function createStoryCheckGenerationServices(
  dependencies: StoryCheckGenerationServiceDependencies
): StoryCheckGenerationServices {
  return Object.freeze({
    async generate(input) {
      if (input.kind !== "initial") {
        throw new DomainValidationError(
          "INVALID_AGENT_POLICY",
          "Story check generation supports initial attempts only in this slice."
        );
      }
      if (input.sourceMode !== "submitted-snapshot") {
        throw new DomainValidationError(
          "INVALID_AGENT_POLICY",
          "Story check generation requires submitted-snapshot source mode."
        );
      }

      const assignment = await requireOwnedAssignment(dependencies, input);
      const requestFingerprint = await storyCheckAttemptRequestFingerprint(
        input,
        dependencies.hashPort
      );
      const idempotencyKey = storyWorkAttemptIdempotencyKey(input.idempotencyKey);
      const replay = await dependencies.generation.findReplay({
        accountId: input.accountId,
        projectId: input.projectId,
        assignmentId: input.assignmentId,
        idempotencyKey,
        requestFingerprint
      });
      if (replay !== undefined) {
        return Object.freeze({ kind: "replayed" as const, state: replay });
      }

      const startedAt = dependencies.clock.now();
      const runId = agentRunId(dependencies.ids.create("agentRun"));
      const runningAssignment = startStoryWorkAttempt({
        assignment,
        expectedVersion: input.expectedAssignmentVersion,
        runId,
        updatedAt: startedAt
      });
      const attempt = createStoryWorkAttempt({
        assignmentId: assignment.id,
        projectId: assignment.projectId,
        initiatorAccountId: assignment.initiatorAccountId,
        runId,
        version: 1,
        kind: input.kind,
        sourceMode: input.sourceMode,
        instruction: input.instruction,
        idempotencyKey,
        requestFingerprint,
        createdAt: startedAt
      });
      const [accountPreferences, projectInstructions] = await Promise.all([
        dependencies.guidance.getAccountAiCollaborationProfile(input.accountId),
        dependencies.guidance.getProjectAgentInstructions({
          accountId: input.accountId,
          projectId: input.projectId
        })
      ]);
      const compiled = await compileStoryCheckContinuity({
        receiptId: contextReceiptId(dependencies.ids.create("contextReceipt")),
        createdAt: startedAt,
        assignment: runningAssignment,
        attempt,
        storyContext: input.storyContext,
        target: input.target,
        resources: input.resources,
        ...(input.skippedScenes === undefined ? {} : { skippedScenes: input.skippedScenes }),
        ...(input.consumedStoryKnowledge === undefined
          ? {}
          : { consumedStoryKnowledge: input.consumedStoryKnowledge }),
        ...(input.targetSceneIntent === undefined
          ? {}
          : { targetSceneIntent: input.targetSceneIntent }),
        ...(input.chapterObjective === undefined
          ? {}
          : { chapterObjective: input.chapterObjective }),
        ...(accountPreferences === undefined ? {} : { accountPreferences }),
        ...(projectInstructions === undefined ? {} : { projectInstructions }),
        hashPort: dependencies.hashPort
      });
      const queuedRun = createQueuedAgentRun({
        id: runId,
        projectId: input.projectId,
        initiatorAccountId: input.accountId,
        workflowId: STORY_CHECK_CONTINUITY_WORKFLOW_ID,
        workflowVersion: compiled.receipt.workflowVersion,
        provider: compiled.provider,
        model: compiled.model,
        receiptId: compiled.receipt.id,
        receiptHash: compiled.receipt.receiptHash,
        status: "queued",
        createdAt: startedAt,
        updatedAt: startedAt
      });
      const runningRun = createAgentRun({
        ...queuedRun,
        status: "running",
        updatedAt: startedAt
      });
      const begun = await dependencies.generation.begin({
        accountId: input.accountId,
        projectId: input.projectId,
        expectedAssignmentVersion: input.expectedAssignmentVersion,
        receipt: compiled.receipt,
        queuedRun,
        runningRun,
        attempt,
        runningAssignment
      });
      if (begun.replayed) {
        return Object.freeze({ kind: "replayed" as const, state: begun });
      }

      const completion = await completeStoryCheckContinuity({
        compiled,
        provider: input.provider,
        ...(input.signal === undefined ? {} : { signal: input.signal })
      });
      const completedAt = dependencies.clock.now();
      if (completion.kind === "failed") {
        return finishTerminal(
          dependencies,
          input,
          begun,
          mapProviderDiagnostic(completion.diagnostic.code),
          completedAt
        );
      }

      let findings;
      try {
        const handoff = compiled.trustedHandoff;
        findings = await buildTrustedStoryCheckFindingsV1({
          specialist: handoff.specialist,
          target: handoff.target,
          candidates: completion.candidates,
          coverage: handoff.coverage,
          revisionVectorInput: handoff.revisionVectorInput,
          linkedRecheckSceneIds: handoff.linkedRecheckSceneIds,
          trustedSceneIds: handoff.trustedSceneIds,
          canonicalContextSceneIds: handoff.canonicalContextSceneIds,
          anchorResources: handoff.anchorResources,
          allowBlockAnchors: handoff.allowBlockAnchors,
          ...(handoff.targetBoundDocument === undefined
            ? {}
            : { targetBoundDocument: handoff.targetBoundDocument }),
          allocateFindingId: () =>
            dependencies.ids.create("storyCheckFinding")
        });
      } catch (error) {
        if (
          error instanceof DomainValidationError &&
          (error.code === "INVALID_AGENT_OUTPUT" ||
            error.code === "UNKNOWN_REFERENCE" ||
            error.code === "INVALID_AGENT_POLICY")
        ) {
          return finishTerminal(
            dependencies,
            input,
            begun,
            "provider-malformed-output",
            completedAt
          );
        }
        throw error;
      }

      const target = compiled.receipt.primaryTarget;
      if (target?.kind !== "scene") {
        throw new StoryCheckGenerationConflictError(
          "Story check generation receipt lost its reserved scene target."
        );
      }
      const contentHash = await computeAgentProposalContentHash(
        {
          outputSchemaId: "story-check-findings-v1",
          payload: findings,
          primaryTarget: target
        },
        dependencies.hashPort
      );
      const proposal = createReadyAgentProposal({
        id: agentProposalId(dependencies.ids.create("agentProposal")),
        projectId: input.projectId,
        runId: begun.run.id,
        receiptId: begun.receipt.id,
        status: "ready",
        outputSchemaId: "story-check-findings-v1",
        payload: findings,
        contentHash,
        primaryTarget: target,
        createdAt: completedAt,
        updatedAt: completedAt
      });
      const pointer: StoryWorkArtifactPointer = Object.freeze({
        proposalId: proposal.id,
        artifactVersion: 1,
        contentHash
      });
      const completedAttempt = completeStoryWorkAttempt({
        attempt: begun.attempt,
        expectedVersion: begun.attempt.version,
        resultArtifact: pointer,
        completedAt
      });
      const artifactReadyAssignment = attachGeneratedStoryWorkArtifact({
        assignment: begun.assignment,
        expectedVersion: begun.assignment.version,
        runId: begun.run.id,
        artifact: pointer,
        updatedAt: completedAt
      });
      const readyRun = createAgentRun({
        ...begun.run,
        status: "ready",
        updatedAt: completedAt,
        completedAt,
        ...(completion.providerResponseId === undefined
          ? {}
          : { providerResponseId: completion.providerResponseId }),
        ...(completion.usage === undefined ? {} : { tokenUsage: completion.usage })
      });
      const state = await dependencies.generation.complete({
        accountId: input.accountId,
        projectId: input.projectId,
        expectedAssignmentVersion: begun.assignment.version,
        expectedAttemptVersion: begun.attempt.version,
        expectedRunStatus: "running",
        proposal,
        readyRun,
        completedAttempt,
        artifactReadyAssignment
      });
      return Object.freeze({ kind: "ready" as const, state });
    }
  });
}
