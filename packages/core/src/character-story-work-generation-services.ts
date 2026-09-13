import { canonicalJsonStringify } from "./agent-canonical-json.js";
import type { AgentGuidanceServices } from "./agent-guidance-services.js";
import {
  CHARACTER_STORY_WORK_WORKFLOW_ID,
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
import {
  compileCharacterStoryWork,
  completeCharacterStoryWork,
  type CharacterStoryWorkProviderDiagnosticCode,
  type CharacterStoryWorkResourceInput,
  type CharacterStoryWorkStructuredCompletionProvider
} from "./character-story-work-compiler.js";
import type {
  BeginCharacterStoryWorkGenerationResult,
  CharacterStoryWorkGenerationUnitOfWork,
  CompleteCharacterStoryWorkGenerationResult,
  FinishCharacterStoryWorkGenerationResult
} from "./character-story-work-generation-uow.js";
import { CharacterStoryWorkGenerationConflictError } from "./character-story-work-generation-uow.js";
import { validateCharacterCreateV2 } from "./character-create-v2.js";
import { ProjectArchivedMutationError } from "./capture-documents.js";
import {
  agentProposalId,
  agentRunId,
  contextReceiptId,
  type ProjectId
} from "./domain.js";
import {
  ProjectAccessDeniedError,
  requireProjectOwner,
  type AccountId
} from "./identity.js";
import type { Clock, IdGenerator, ProjectRepository } from "./project-repository.js";
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
import { StoryWorkAssignmentNotFoundError } from "./character-story-work-services.js";

export type CharacterStoryWorkAttemptRequest = Readonly<{
  accountId: AccountId;
  projectId: ProjectId;
  assignmentId: StoryWorkAssignmentId;
  expectedAssignmentVersion: number;
  kind: StoryWorkAttemptKind;
  sourceMode: StoryWorkSourceMode;
  /** Exact writer text; it is neither trimmed nor rewritten. */
  instruction: string;
  priorArtifact?: StoryWorkArtifactPointer;
  idempotencyKey: string;
  storyContext: StoryContextProjection;
  resources: readonly CharacterStoryWorkResourceInput[];
  provider: CharacterStoryWorkStructuredCompletionProvider;
  signal?: AbortSignal;
}>;

export type CharacterStoryWorkGenerationResult =
  | Readonly<{
      kind: "replayed";
      state: BeginCharacterStoryWorkGenerationResult;
    }>
  | Readonly<{
      kind: "ready";
      state: CompleteCharacterStoryWorkGenerationResult;
    }>
  | Readonly<{
      kind: "failed" | "canceled" | "stale";
      state: FinishCharacterStoryWorkGenerationResult;
    }>;

export type CharacterStoryWorkGenerationServices = Readonly<{
  generate(
    input: CharacterStoryWorkAttemptRequest
  ): Promise<CharacterStoryWorkGenerationResult>;
}>;

export type CharacterStoryWorkGenerationServiceDependencies = Readonly<{
  projects: ProjectRepository;
  assignments: StoryWorkAssignmentRepository;
  proposals: AgentProposalRepository;
  guidance: AgentGuidanceServices;
  generation: CharacterStoryWorkGenerationUnitOfWork;
  hashPort: AsyncHashPort;
  ids: IdGenerator;
  clock: Clock;
}>;

export async function characterStoryWorkAttemptRequestFingerprint(
  input: Pick<
    CharacterStoryWorkAttemptRequest,
    | "accountId"
    | "projectId"
    | "assignmentId"
    | "kind"
    | "sourceMode"
    | "instruction"
    | "priorArtifact"
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
        ...(input.priorArtifact === undefined
          ? {}
          : { priorArtifact: input.priorArtifact })
      })
    )
  );
}

function mapProviderDiagnostic(
  code: CharacterStoryWorkProviderDiagnosticCode | "internal_failure"
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
  dependencies: CharacterStoryWorkGenerationServiceDependencies,
  input: Pick<CharacterStoryWorkAttemptRequest, "accountId" | "projectId" | "assignmentId">
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

export function createCharacterStoryWorkGenerationServices(
  dependencies: CharacterStoryWorkGenerationServiceDependencies
): CharacterStoryWorkGenerationServices {
  return Object.freeze({
    async generate(input) {
      const assignment = await requireOwnedAssignment(dependencies, input);
      const requestFingerprint = await characterStoryWorkAttemptRequestFingerprint(
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
        ...(input.priorArtifact === undefined
          ? {}
          : { priorArtifact: input.priorArtifact }),
        createdAt: startedAt
      });
      const priorArtifact =
        input.priorArtifact === undefined
          ? undefined
          : await dependencies.proposals.get(input.priorArtifact.proposalId);
      if (
        input.priorArtifact !== undefined &&
        (priorArtifact === undefined || priorArtifact.projectId !== input.projectId)
      ) {
        throw new StoryWorkAssignmentNotFoundError();
      }
      const [accountPreferences, projectInstructions, playbooks] = await Promise.all([
        dependencies.guidance.getAccountAiCollaborationProfile(input.accountId),
        dependencies.guidance.getProjectAgentInstructions({
          accountId: input.accountId,
          projectId: input.projectId
        }),
        dependencies.guidance.listProjectPlaybooks({
          accountId: input.accountId,
          projectId: input.projectId,
          includeArchived: false
        })
      ]);
      const matchedPlaybook = playbooks.find(
        (playbook) =>
          playbook.enabled &&
          playbook.trigger === "manual" &&
          playbook.outputSchemaId === "character-create-v2"
      );
      const compiled = await compileCharacterStoryWork({
        receiptId: contextReceiptId(dependencies.ids.create("contextReceipt")),
        createdAt: startedAt,
        assignment: runningAssignment,
        attempt,
        storyContext: input.storyContext,
        resources: input.resources,
        ...(priorArtifact === undefined
          ? {}
          : {
              priorArtifact: {
                proposal: priorArtifact,
                payload: validateCharacterCreateV2(priorArtifact.payload)
              }
            }),
        ...(accountPreferences === undefined ? {} : { accountPreferences }),
        ...(projectInstructions === undefined ? {} : { projectInstructions }),
        ...(matchedPlaybook === undefined ? {} : { matchedPlaybook }),
        hashPort: dependencies.hashPort
      });
      const queuedRun = createQueuedAgentRun({
        id: runId,
        projectId: input.projectId,
        initiatorAccountId: input.accountId,
        workflowId: CHARACTER_STORY_WORK_WORKFLOW_ID,
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

      const completion = await completeCharacterStoryWork({
        compiled,
        provider: input.provider,
        ...(input.signal === undefined ? {} : { signal: input.signal })
      });
      const completedAt = dependencies.clock.now();
      if (completion.kind === "failed") {
        const diagnosticCode = mapProviderDiagnostic(completion.diagnostic.code);
        const failedRun = terminalRun(begun.run, diagnosticCode, completedAt);
        const outcome = diagnosticCode === "run-canceled" ? "canceled" : "failed";
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

      const target = compiled.receipt.primaryTarget;
      if (target?.kind !== "story-knowledge") {
        throw new CharacterStoryWorkGenerationConflictError(
          "Character generation receipt lost its reserved Cast target."
        );
      }
      const contentHash = await computeAgentProposalContentHash(
        {
          outputSchemaId: "character-create-v2",
          payload: completion.artifact,
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
        outputSchemaId: "character-create-v2",
        payload: completion.artifact,
        contentHash,
        primaryTarget: target,
        createdAt: completedAt,
        updatedAt: completedAt
      });
      const pointer: StoryWorkArtifactPointer = Object.freeze({
        proposalId: proposal.id,
        artifactVersion: (begun.attempt.priorArtifact?.artifactVersion ?? 0) + 1,
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
        ...(begun.attempt.priorArtifact === undefined
          ? {}
          : { expectedCurrentArtifact: begun.attempt.priorArtifact }),
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
