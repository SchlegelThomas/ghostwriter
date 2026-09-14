import { canonicalJsonStringify } from "./agent-canonical-json.js";
import type { AgentGuidanceServices } from "./agent-guidance-services.js";
import {
  STORY_WORK_STRUCTURE_WORKFLOW_ID,
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
  type BookId,
  type ProjectId,
  type ProjectRecords
} from "./domain.js";
import {
  ProjectAccessDeniedError,
  requireProjectOwner,
  type AccountId
} from "./identity.js";
import type { Clock, IdGenerator, ProjectRepository } from "./project-repository.js";
import {
  compileStoryStructure,
  completeStoryStructure,
  type StoryStructureProviderDiagnosticCode,
  type StoryStructureResourceInput,
  type StoryStructureStructuredCompletionProvider
} from "./story-structure-compiler.js";
import type {
  BeginStoryStructureGenerationResult,
  CompleteStoryStructureGenerationResult,
  FinishStoryStructureGenerationResult,
  StoryStructureGenerationUnitOfWork
} from "./story-structure-generation-uow.js";
import { StoryStructureGenerationConflictError } from "./story-structure-generation-uow.js";
import {
  buildStoryStructureProposalV1FromCandidate,
  STORY_STRUCTURE_SCHEMA_ID,
  type StoryStructureLoweringContext
} from "./story-structure-proposal-v1.js";
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

export type StoryStructureAttemptRequest = Readonly<{
  accountId: AccountId;
  projectId: ProjectId;
  assignmentId: StoryWorkAssignmentId;
  expectedAssignmentVersion: number;
  kind: StoryWorkAttemptKind;
  sourceMode: StoryWorkSourceMode;
  /** Exact writer text; it is neither trimmed nor rewritten. */
  instruction: string;
  idempotencyKey: string;
  projectRecords: ProjectRecords;
  storyContext: StoryContextProjection;
  resources: readonly StoryStructureResourceInput[];
  trustedLoweringContext: StoryStructureLoweringContext;
  provider: StoryStructureStructuredCompletionProvider;
  signal?: AbortSignal;
}>;

export type StoryStructureGenerationResult =
  | Readonly<{
      kind: "replayed";
      state: BeginStoryStructureGenerationResult;
    }>
  | Readonly<{
      kind: "ready";
      state: CompleteStoryStructureGenerationResult;
    }>
  | Readonly<{
      kind: "failed" | "canceled" | "stale";
      state: FinishStoryStructureGenerationResult;
    }>;

export type StoryStructureGenerationServices = Readonly<{
  generate(input: StoryStructureAttemptRequest): Promise<StoryStructureGenerationResult>;
}>;

export type StoryStructureGenerationServiceDependencies = Readonly<{
  projects: ProjectRepository;
  assignments: StoryWorkAssignmentRepository;
  proposals: AgentProposalRepository;
  guidance: AgentGuidanceServices;
  generation: StoryStructureGenerationUnitOfWork;
  hashPort: AsyncHashPort;
  ids: IdGenerator;
  clock: Clock;
}>;

function storyStructureResourceFingerprint(
  resources: readonly StoryStructureResourceInput[]
): readonly unknown[] {
  return Object.freeze(resources.map(({ resource }) => resource));
}

function storyStructureBookFingerprint(
  projectRecords: ProjectRecords,
  bookIdValue: BookId
): unknown {
  const book = projectRecords.books.find((entry) => entry.id === bookIdValue);
  return Object.freeze({
    projectVersion: projectRecords.project.version,
    bookId: bookIdValue,
    bookArchived: book?.archivedAt !== undefined
  });
}

export async function storyStructureAttemptRequestFingerprint(
  input: Pick<
    StoryStructureAttemptRequest,
    | "accountId"
    | "projectId"
    | "assignmentId"
    | "kind"
    | "sourceMode"
    | "instruction"
    | "projectRecords"
    | "storyContext"
    | "resources"
    | "trustedLoweringContext"
  > & Readonly<{ targetBookId: BookId }>,
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
        targetBook: storyStructureBookFingerprint(input.projectRecords, input.targetBookId),
        storyContext: Object.freeze({
          projectId: input.storyContext.projectId,
          projectVersion: input.storyContext.projectVersion,
          scope: input.storyContext.scope
        }),
        trustedLoweringContext: Object.freeze({
          projectId: input.trustedLoweringContext.projectId,
          bookId: input.trustedLoweringContext.bookId,
          existingPartIds: [...input.trustedLoweringContext.existingPartIds].sort(),
          existingChapterIds: [...input.trustedLoweringContext.existingChapterIds].sort(),
          existingSceneIds: [...input.trustedLoweringContext.existingSceneIds].sort()
        }),
        resources: storyStructureResourceFingerprint(input.resources)
      })
    )
  );
}

function mapProviderDiagnostic(
  code: StoryStructureProviderDiagnosticCode | "internal_failure"
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
  dependencies: StoryStructureGenerationServiceDependencies,
  input: Pick<StoryStructureAttemptRequest, "accountId" | "projectId" | "assignmentId">
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

function reservedBookIdFromAssignment(
  assignment: Awaited<ReturnType<typeof requireOwnedAssignment>>
): BookId {
  if (
    assignment.taskKind !== "outline" ||
    assignment.destination.kind !== "book" ||
    assignment.destination.operation !== "update"
  ) {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "Structure generation requires an outline assignment with a book update destination."
    );
  }
  return assignment.destination.bookId;
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
  dependencies: StoryStructureGenerationServiceDependencies,
  input: StoryStructureAttemptRequest,
  begun: BeginStoryStructureGenerationResult,
  diagnosticCode: AgentRunTerminalDiagnosticCode,
  completedAt: string
): Promise<StoryStructureGenerationResult> {
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

export function createStoryStructureGenerationServices(
  dependencies: StoryStructureGenerationServiceDependencies
): StoryStructureGenerationServices {
  return Object.freeze({
    async generate(input) {
      if (input.kind !== "initial") {
        throw new DomainValidationError(
          "INVALID_AGENT_POLICY",
          "Story structure generation supports initial attempts only in this slice."
        );
      }
      if (input.sourceMode !== "submitted-snapshot") {
        throw new DomainValidationError(
          "INVALID_AGENT_POLICY",
          "Story structure generation requires submitted-snapshot source mode."
        );
      }

      const assignment = await requireOwnedAssignment(dependencies, input);
      const targetBookId = reservedBookIdFromAssignment(assignment);
      const requestFingerprint = await storyStructureAttemptRequestFingerprint(
        { ...input, targetBookId },
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
      const compiled = await compileStoryStructure({
        receiptId: contextReceiptId(dependencies.ids.create("contextReceipt")),
        createdAt: startedAt,
        assignment: runningAssignment,
        attempt,
        projectRecords: input.projectRecords,
        storyContext: input.storyContext,
        resources: input.resources,
        trustedLoweringContext: input.trustedLoweringContext,
        ...(accountPreferences === undefined ? {} : { accountPreferences }),
        ...(projectInstructions === undefined ? {} : { projectInstructions }),
        hashPort: dependencies.hashPort
      });
      const queuedRun = createQueuedAgentRun({
        id: runId,
        projectId: input.projectId,
        initiatorAccountId: input.accountId,
        workflowId: STORY_WORK_STRUCTURE_WORKFLOW_ID,
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

      const completion = await completeStoryStructure({
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

      let proposalPayload;
      try {
        const handoff = compiled.trustedHandoff;
        proposalPayload = buildStoryStructureProposalV1FromCandidate({
          projectId: input.projectId,
          bookId: handoff.bookId,
          expectedProjectVersion: handoff.expectedProjectVersion,
          contextReceiptHash: compiled.receipt.receiptHash,
          candidate: completion.candidates,
          context: handoff.loweringContext,
          ids: dependencies.ids
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
      if (target?.kind !== "book") {
        throw new StoryStructureGenerationConflictError(
          "Story structure generation receipt lost its reserved book target."
        );
      }
      const contentHash = await computeAgentProposalContentHash(
        {
          outputSchemaId: STORY_STRUCTURE_SCHEMA_ID,
          payload: proposalPayload,
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
        outputSchemaId: STORY_STRUCTURE_SCHEMA_ID,
        payload: proposalPayload,
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
