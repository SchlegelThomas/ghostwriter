import { STORY_CHECK_CONTINUITY_WORKFLOW_ID, type AsyncHashPort, type InstructionContentHash } from "./agent-domain.js";
import type { AgentProposalRepository, AgentRunRepository, ContextReceiptRepository } from "./agent-foundation-repository.js";
import {
  AgentProposalStateConflictError,
  computeAgentProposalContentHash,
  createReadyAgentProposal,
  type AgentProposal
} from "./agent-runs-proposals.js";
import { StoryWorkAssignmentNotFoundError } from "./character-story-work-services.js";
import { agentProposalId, type ProjectId } from "./domain.js";
import { type AccountId, ProjectAccessDeniedError, requireProjectOwner } from "./identity.js";
import type { IdGenerator, ProjectRepository } from "./project-repository.js";
import { ProjectArchivedMutationError } from "./capture-documents.js";
import type { StoryWorkAssignmentRepository } from "./story-work-assignment-repository.js";
import {
  evaluateStoryAssessmentFreshness,
  type StoryAssessmentFreshnessReason,
  type StoryAssessmentRevisionVector
} from "./story-assessment-freshness.js";
import {
  evaluateStoryCheckProposalDraftArtifactFreshness
} from "./story-check-revision-vector.js";
import {
  validateStoryCheckFindingsV1,
  type StoryCheckFindingResolution,
  type StoryCheckFindingsV1
} from "./story-check-findings-v1.js";
import {
  openStoryWorkArtifactReview,
  recordReviewedStoryWorkAssignment,
  replaceStoryWorkReviewArtifact,
  StoryWorkAssignmentTransitionError,
  type StoryWorkArtifactPointer,
  type StoryWorkAssignment,
  type StoryWorkAssignmentId,
  type StoryWorkResultReference
} from "./story-work-assignment.js";

export class StoryCheckArtifactMismatchError extends Error {
  readonly code = "STORY_CHECK_ARTIFACT_MISMATCH" as const;

  constructor(message = "The reviewed check findings artifact is no longer current.") {
    super(message);
    this.name = "StoryCheckArtifactMismatchError";
  }
}

export class StoryCheckFindingNotFoundError extends Error {
  readonly code = "STORY_CHECK_FINDING_NOT_FOUND" as const;

  constructor(message = "The requested finding is not in this check artifact.") {
    super(message);
    this.name = "StoryCheckFindingNotFoundError";
  }
}

export type StoryCheckStoredPayloadFreshnessReason =
  | StoryAssessmentFreshnessReason
  | "proposal-artifact-changed"
  | "proposal-artifact-missing";

export type StoryCheckStoredPayloadFreshness =
  | Readonly<{ status: "fresh" }>
  | Readonly<{
      status: "needs-recheck";
      reasons: readonly Readonly<{
        dependencyKey: string;
        reason: StoryCheckStoredPayloadFreshnessReason;
      }>[];
    }>;

export type StoryCheckReviewInput = Readonly<{
  accountId: AccountId;
  projectId: ProjectId;
  assignmentId: StoryWorkAssignmentId;
  expectedAssignmentVersion: number;
  artifact: StoryWorkArtifactPointer;
  updatedAt: string;
}> &
  (
    | Readonly<{ action: "open" }>
    | Readonly<{
        action: "resolve";
        findingId: string;
        resolution: StoryCheckFindingResolution;
      }>
    | Readonly<{ action: "complete"; result: StoryWorkResultReference }>
  );

export type StoryCheckReviewResult = Readonly<{
  assignment: StoryWorkAssignment;
  proposal: AgentProposal;
}>;

export interface StoryCheckReviewUnitOfWork {
  review(input: StoryCheckReviewInput): Promise<StoryCheckReviewResult>;
}

export type StoryCheckReviewRepositories = Readonly<{
  projects: ProjectRepository;
  assignments: StoryWorkAssignmentRepository;
  proposals: AgentProposalRepository;
  runs: AgentRunRepository;
  receipts: ContextReceiptRepository;
  ids: IdGenerator;
  hashPort: AsyncHashPort;
}>;

function samePointer(
  left: StoryWorkArtifactPointer | undefined,
  right: StoryWorkArtifactPointer
): boolean {
  return (
    left?.proposalId === right.proposalId &&
    left.artifactVersion === right.artifactVersion &&
    left.contentHash === right.contentHash
  );
}

function storyCheckResultMatches(
  assignment: Readonly<{
    destination: StoryWorkAssignment["destination"];
    currentArtifact?: StoryWorkArtifactPointer;
  }>,
  result: StoryWorkResultReference,
  artifact: StoryWorkArtifactPointer
): boolean {
  if (
    assignment.destination.kind !== "scene" ||
    assignment.destination.operation !== "assess"
  ) {
    return false;
  }
  return (
    result.kind === "story-check" &&
    result.sceneId === assignment.destination.sceneId &&
    result.proposalId === artifact.proposalId &&
    result.artifactVersion === artifact.artifactVersion &&
    result.contentHash === artifact.contentHash
  );
}

function assertCheckPayloadTarget(
  payload: StoryCheckFindingsV1,
  projectId: ProjectId,
  sceneId: string
): void {
  if (payload.target.projectId !== projectId || payload.target.sceneId !== sceneId) {
    throw new StoryCheckArtifactMismatchError();
  }
}

function findingsReadyForCompletion(payload: StoryCheckFindingsV1): boolean {
  return payload.findings.every((finding) => finding.resolution.status !== "open");
}

function withFindingResolution(
  payload: StoryCheckFindingsV1,
  findingId: string,
  resolution: StoryCheckFindingResolution
): StoryCheckFindingsV1 {
  if (!payload.findings.some((finding) => finding.id === findingId)) {
    throw new StoryCheckFindingNotFoundError();
  }
  return validateStoryCheckFindingsV1({
    ...payload,
    findings: payload.findings.map((finding) =>
      finding.id === findingId ? { ...finding, resolution } : finding
    )
  });
}

/**
 * Evaluates whether stored check findings are still grounded in current project
 * state. Does not mutate assignments or call providers.
 */
export function evaluateStoredStoryCheckPayloadFreshness(input: Readonly<{
  storedPayload: StoryCheckFindingsV1;
  currentRevisionVector: StoryAssessmentRevisionVector;
  currentProposalDraftContentHash?: InstructionContentHash;
}>): StoryCheckStoredPayloadFreshness {
  const vectorFreshness = evaluateStoryAssessmentFreshness(
    input.storedPayload.revisionVector,
    input.currentRevisionVector
  );
  const reasons: Array<
    Readonly<{
      dependencyKey: string;
      reason: StoryCheckStoredPayloadFreshnessReason;
    }>
  > = [];
  if (vectorFreshness.status === "needs-recheck") {
    reasons.push(...vectorFreshness.reasons);
  }
  if (input.storedPayload.target.mode === "proposal-draft") {
    const dependencyKey = `proposal-artifact:${input.storedPayload.target.proposalId}`;
    if (input.currentProposalDraftContentHash === undefined) {
      reasons.push(
        Object.freeze({
          dependencyKey,
          reason: "proposal-artifact-missing"
        })
      );
    } else {
      const draftFreshness = evaluateStoryCheckProposalDraftArtifactFreshness(
        input.storedPayload.target.contentHash,
        input.currentProposalDraftContentHash
      );
      if (draftFreshness.status === "needs-recheck") {
        reasons.push(
          Object.freeze({
            dependencyKey,
            reason: "proposal-artifact-changed"
          })
        );
      }
    }
  }
  return reasons.length === 0
    ? Object.freeze({ status: "fresh" })
    : Object.freeze({ status: "needs-recheck", reasons: Object.freeze(reasons) });
}

async function loadReviewContext(
  repositories: StoryCheckReviewRepositories,
  input: StoryCheckReviewInput
): Promise<{
  assignment: StoryWorkAssignment;
  proposal: AgentProposal;
  payload: StoryCheckFindingsV1;
}> {
  const assignment = await repositories.assignments.get(input);
  if (assignment === undefined) throw new StoryWorkAssignmentNotFoundError();
  try {
    requireProjectOwner(
      input.projectId,
      await repositories.projects.getProjectMembership(input.projectId, input.accountId)
    );
  } catch (cause) {
    if (cause instanceof ProjectAccessDeniedError) throw new StoryWorkAssignmentNotFoundError();
    throw cause;
  }
  const project = await repositories.projects.getProject(input.projectId);
  if (project === undefined) throw new StoryWorkAssignmentNotFoundError();
  if (project.archivedAt !== undefined) throw new ProjectArchivedMutationError();
  const validDestination =
    assignment.taskKind === "check" &&
    assignment.destination.kind === "scene" &&
    assignment.destination.operation === "assess";
  if (
    !validDestination ||
    !samePointer(assignment.currentArtifact, input.artifact) ||
    assignment.generatedArtifact === undefined
  ) {
    throw new StoryCheckArtifactMismatchError();
  }
  const proposal = await repositories.proposals.get(input.artifact.proposalId);
  const assessSceneId =
    assignment.destination.kind === "scene" ? assignment.destination.sceneId : undefined;
  if (
    proposal === undefined ||
    assessSceneId === undefined ||
    proposal.projectId !== input.projectId ||
    proposal.outputSchemaId !== "story-check-findings-v1" ||
    proposal.contentHash !== input.artifact.contentHash ||
    proposal.primaryTarget.kind !== "scene" ||
    proposal.primaryTarget.id !== assessSceneId
  ) {
    throw new StoryCheckArtifactMismatchError();
  }
  let payload: StoryCheckFindingsV1;
  try {
    payload = validateStoryCheckFindingsV1(proposal.payload);
  } catch {
    throw new StoryCheckArtifactMismatchError();
  }
  assertCheckPayloadTarget(payload, input.projectId, assessSceneId);
  const run = await repositories.runs.get(proposal.runId);
  const receipt = await repositories.receipts.get(proposal.receiptId);
  if (
    run === undefined ||
    receipt === undefined ||
    run.projectId !== input.projectId ||
    run.initiatorAccountId !== input.accountId ||
    run.workflowId !== STORY_CHECK_CONTINUITY_WORKFLOW_ID ||
    run.status !== "ready" ||
    run.receiptId !== receipt.id ||
    run.receiptHash !== receipt.receiptHash ||
    receipt.projectId !== input.projectId ||
    receipt.provider !== assignment.provider ||
    receipt.model !== assignment.model ||
    receipt.workflowId !== STORY_CHECK_CONTINUITY_WORKFLOW_ID ||
    receipt.outputSchemaId !== "story-check-findings-v1" ||
    receipt.primaryTarget?.kind !== "scene" ||
    receipt.primaryTarget.id !== assessSceneId ||
    receipt.targetSceneId !== assessSceneId ||
    run.provider !== assignment.provider ||
    run.model !== assignment.model
  ) {
    throw new StoryCheckArtifactMismatchError();
  }
  return { assignment, proposal, payload };
}

/** Caller must bind all repositories to one transaction and lock the scoped assignment first. */
export async function executeStoryCheckReview(
  repositories: StoryCheckReviewRepositories,
  input: StoryCheckReviewInput
): Promise<StoryCheckReviewResult> {
  const { assignment, proposal, payload } = await loadReviewContext(repositories, input);

  if (input.action === "complete" && assignment.status === "reviewed") {
    if (
      assignment.version === input.expectedAssignmentVersion &&
      samePointer(assignment.currentArtifact, input.artifact) &&
      storyCheckResultMatches(assignment, input.result, input.artifact) &&
      assignment.results.length === 1 &&
      assignment.results[0]?.kind === "story-check"
    ) {
      return { assignment, proposal };
    }
    throw new StoryWorkAssignmentTransitionError();
  }

  if (assignment.status === "reviewed") {
    throw new StoryWorkAssignmentTransitionError();
  }

  if (
    input.action === "open" &&
    assignment.status === "awaiting-review" &&
    (assignment.version === input.expectedAssignmentVersion ||
      assignment.version === input.expectedAssignmentVersion + 1) &&
    proposal.status === "ready"
  ) {
    return { assignment, proposal };
  }

  if (input.action === "open" && assignment.status === "artifact-ready") {
    if (assignment.version !== input.expectedAssignmentVersion) {
      throw new StoryWorkAssignmentTransitionError();
    }
    if (proposal.status !== "ready") throw new AgentProposalStateConflictError();
    const next = openStoryWorkArtifactReview({
      assignment,
      expectedVersion: input.expectedAssignmentVersion,
      artifact: input.artifact,
      updatedAt: input.updatedAt
    });
    const saved = await repositories.assignments.compareAndSet({
      accountId: input.accountId,
      projectId: input.projectId,
      assignmentId: input.assignmentId,
      expectedVersion: assignment.version,
      next
    });
    if (!saved.ok) throw new StoryWorkAssignmentTransitionError();
    return { assignment: saved.assignment, proposal };
  }

  if (assignment.version !== input.expectedAssignmentVersion) {
    throw new StoryWorkAssignmentTransitionError();
  }
  if (proposal.status !== "ready") throw new AgentProposalStateConflictError();

  if (input.action === "open") {
    throw new StoryWorkAssignmentTransitionError();
  }

  if (input.action === "complete") {
    if (assignment.status !== "awaiting-review") {
      throw new StoryWorkAssignmentTransitionError();
    }
    if (!findingsReadyForCompletion(payload)) {
      throw new StoryWorkAssignmentTransitionError(
        "Check review can complete only when every finding is dismissed, deferred, or absent."
      );
    }
    if (!storyCheckResultMatches(assignment, input.result, input.artifact)) {
      throw new StoryCheckArtifactMismatchError(
        "The story-check result must match the current findings artifact and assess destination."
      );
    }
    const next = recordReviewedStoryWorkAssignment({
      assignment,
      expectedVersion: input.expectedAssignmentVersion,
      artifact: input.artifact,
      result: input.result,
      updatedAt: input.updatedAt
    });
    const saved = await repositories.assignments.compareAndSet({
      accountId: input.accountId,
      projectId: input.projectId,
      assignmentId: input.assignmentId,
      expectedVersion: assignment.version,
      next
    });
    if (!saved.ok) throw new StoryWorkAssignmentTransitionError();
    return { assignment: saved.assignment, proposal };
  }

  if (assignment.status !== "awaiting-review") {
    throw new StoryWorkAssignmentTransitionError();
  }

  const nextPayload = withFindingResolution(payload, input.findingId, input.resolution);
  const contentHash = await computeAgentProposalContentHash(
    {
      outputSchemaId: "story-check-findings-v1",
      payload: nextPayload,
      primaryTarget: proposal.primaryTarget
    },
    repositories.hashPort
  );
  const edited = createReadyAgentProposal({
    ...proposal,
    id: agentProposalId(repositories.ids.create("agentProposal")),
    contentHash,
    payload: nextPayload,
    createdAt: input.updatedAt,
    updatedAt: input.updatedAt
  });
  const next = replaceStoryWorkReviewArtifact({
    assignment,
    expectedVersion: input.expectedAssignmentVersion,
    expectedCurrentArtifact: input.artifact,
    nextArtifact: {
      proposalId: edited.id,
      artifactVersion: input.artifact.artifactVersion + 1,
      contentHash
    },
    updatedAt: input.updatedAt
  });
  const created = await repositories.proposals.create(edited);
  if (!created.ok) throw new AgentProposalStateConflictError();
  const superseded = await repositories.proposals.markStale({
    proposalId: proposal.id,
    projectId: input.projectId,
    expectedStatus: "ready",
    updatedAt: input.updatedAt
  });
  if (!superseded.ok) throw new AgentProposalStateConflictError();
  const saved = await repositories.assignments.compareAndSet({
    accountId: input.accountId,
    projectId: input.projectId,
    assignmentId: input.assignmentId,
    expectedVersion: assignment.version,
    next
  });
  if (!saved.ok) throw new StoryWorkAssignmentTransitionError();
  return { assignment: saved.assignment, proposal: created.proposal };
}
