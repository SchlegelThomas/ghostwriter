import { SCENE_STORY_WORK_WORKFLOW_ID, type AsyncHashPort } from "./agent-domain.js";
import type { AgentProposalRepository, AgentRunRepository, ContextReceiptRepository } from "./agent-foundation-repository.js";
import { AgentProposalStateConflictError, computeAgentProposalContentHash, createReadyAgentProposal, type AgentProposal } from "./agent-runs-proposals.js";
import { validateSceneDraftV1, type SceneDraftV1 } from "./scene-draft-v1.js";
import { StoryWorkAssignmentNotFoundError } from "./character-story-work-services.js";
import { agentProposalId, type ProjectId } from "./domain.js";
import { type AccountId, ProjectAccessDeniedError, requireProjectOwner } from "./identity.js";
import type { IdGenerator, ProjectRepository } from "./project-repository.js";
import { ProjectArchivedMutationError } from "./capture-documents.js";
import type { StoryWorkAssignmentRepository } from "./story-work-assignment-repository.js";
import {
  openStoryWorkArtifactReview, rejectStoryWorkArtifact, replaceStoryWorkReviewArtifact,
  StoryWorkAssignmentTransitionError, type StoryWorkArtifactPointer, type StoryWorkAssignment, type StoryWorkAssignmentId
} from "./story-work-assignment.js";

export class SceneStoryWorkArtifactMismatchError extends Error {
  readonly code = "SCENE_STORY_WORK_ARTIFACT_MISMATCH" as const;

  constructor(message = "The reviewed scene artifact is no longer current.") {
    super(message);
    this.name = "SceneStoryWorkArtifactMismatchError";
  }
}

export type SceneStoryWorkReviewInput = Readonly<{
  accountId: AccountId;
  projectId: ProjectId;
  assignmentId: StoryWorkAssignmentId;
  expectedAssignmentVersion: number;
  artifact: StoryWorkArtifactPointer;
  updatedAt: string;
}> & (Readonly<{ action: "open" }> | Readonly<{ action: "reject" }> | Readonly<{ action: "edit"; payload: SceneDraftV1 }>);

export type SceneStoryWorkReviewResult = Readonly<{ assignment: StoryWorkAssignment; proposal: AgentProposal }>;
export interface SceneStoryWorkReviewUnitOfWork {
  review(input: SceneStoryWorkReviewInput): Promise<SceneStoryWorkReviewResult>;
}

export type SceneStoryWorkReviewRepositories = Readonly<{
  projects: ProjectRepository;
  assignments: StoryWorkAssignmentRepository;
  proposals: AgentProposalRepository;
  runs: AgentRunRepository;
  receipts: ContextReceiptRepository;
  ids: IdGenerator;
  hashPort: AsyncHashPort;
}>;

function samePointer(left: StoryWorkArtifactPointer | undefined, right: StoryWorkArtifactPointer): boolean {
  return left?.proposalId === right.proposalId && left.artifactVersion === right.artifactVersion && left.contentHash === right.contentHash;
}

function sameSceneIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

/** Caller must bind all repositories to one transaction and lock the scoped assignment first. */
export async function executeSceneStoryWorkReview(
  repositories: SceneStoryWorkReviewRepositories,
  input: SceneStoryWorkReviewInput
): Promise<SceneStoryWorkReviewResult> {
  const assignment = await repositories.assignments.get(input);
  if (assignment === undefined) throw new StoryWorkAssignmentNotFoundError();
  try { requireProjectOwner(input.projectId, await repositories.projects.getProjectMembership(input.projectId, input.accountId)); }
  catch (cause) { if (cause instanceof ProjectAccessDeniedError) throw new StoryWorkAssignmentNotFoundError(); throw cause; }
  const project = await repositories.projects.getProject(input.projectId);
  if (project === undefined) throw new StoryWorkAssignmentNotFoundError();
  if (project.archivedAt !== undefined) throw new ProjectArchivedMutationError();
  const validDestination = assignment.destination.kind === "scene" &&
    ((assignment.taskKind === "scene" && assignment.destination.operation === "create") ||
      (assignment.taskKind === "revise" && assignment.destination.operation === "update"));
  if (!samePointer(assignment.currentArtifact, input.artifact) || !validDestination || assignment.destination.kind !== "scene") {
    throw new SceneStoryWorkArtifactMismatchError();
  }
  const proposal = await repositories.proposals.get(input.artifact.proposalId);
  if (proposal === undefined || proposal.projectId !== input.projectId || proposal.outputSchemaId !== "scene-draft-v1" ||
      proposal.contentHash !== input.artifact.contentHash || proposal.primaryTarget.kind !== "scene" ||
      proposal.primaryTarget.id !== assignment.destination.sceneId) throw new SceneStoryWorkArtifactMismatchError();
  const allowedSources = new Set(assignment.sources.flatMap((source) => source.kind === "scene" ? [source.sceneId] : []));
  const storedPayload = validateSceneDraftV1(proposal.payload);
  if (storedPayload.sourceSceneIds.length !== allowedSources.size || storedPayload.sourceSceneIds.some((id) => !allowedSources.has(id))) {
    throw new SceneStoryWorkArtifactMismatchError("Scene artifacts cannot cite scene sources outside this assignment.");
  }
  const run = await repositories.runs.get(proposal.runId);
  const receipt = await repositories.receipts.get(proposal.receiptId);
  if (run === undefined || receipt === undefined || run.projectId !== input.projectId || run.initiatorAccountId !== input.accountId ||
      run.workflowId !== SCENE_STORY_WORK_WORKFLOW_ID || run.status !== "ready" || run.receiptId !== receipt.id ||
      run.receiptHash !== receipt.receiptHash || receipt.projectId !== input.projectId || receipt.provider !== assignment.provider ||
      receipt.model !== assignment.model || receipt.workflowId !== SCENE_STORY_WORK_WORKFLOW_ID ||
      receipt.outputSchemaId !== "scene-draft-v1" || receipt.primaryTarget?.kind !== "scene" ||
      receipt.primaryTarget.id !== assignment.destination.sceneId || run.provider !== assignment.provider || run.model !== assignment.model) {
    throw new SceneStoryWorkArtifactMismatchError();
  }
  if (input.action === "open" && assignment.status === "awaiting-review" &&
      (assignment.version === input.expectedAssignmentVersion || assignment.version === input.expectedAssignmentVersion + 1) && proposal.status === "ready") {
    return { assignment, proposal };
  }
  if (input.action === "reject" && assignment.status === "rejected" && assignment.version === input.expectedAssignmentVersion + 1 &&
      proposal.status === "rejected" && proposal.decision?.actorAccountId === input.accountId) return { assignment, proposal };
  if (assignment.version !== input.expectedAssignmentVersion) throw new StoryWorkAssignmentTransitionError();
  if (proposal.status !== "ready") throw new AgentProposalStateConflictError();
  let next: StoryWorkAssignment;
  let resultProposal = proposal;
  if (input.action === "open") {
    next = openStoryWorkArtifactReview({ assignment, expectedVersion: input.expectedAssignmentVersion, artifact: input.artifact, updatedAt: input.updatedAt });
  } else if (input.action === "reject") {
    next = rejectStoryWorkArtifact({ assignment, expectedVersion: input.expectedAssignmentVersion, artifact: input.artifact, updatedAt: input.updatedAt });
    const rejected = await repositories.proposals.reject({ proposalId: proposal.id, projectId: input.projectId, expectedStatus: "ready", actorAccountId: input.accountId, decidedAt: input.updatedAt, updatedAt: input.updatedAt });
    if (!rejected.ok) throw new AgentProposalStateConflictError();
    resultProposal = rejected.proposal;
  } else {
    const payload = validateSceneDraftV1(input.payload);
    if (!sameSceneIds(payload.sourceSceneIds, storedPayload.sourceSceneIds)) throw new SceneStoryWorkArtifactMismatchError("Scene edits must preserve the generated artifact's exact scene sources.");
    const contentHash = await computeAgentProposalContentHash({ outputSchemaId: "scene-draft-v1", payload, primaryTarget: proposal.primaryTarget }, repositories.hashPort);
    const edited = createReadyAgentProposal({ ...proposal, id: agentProposalId(repositories.ids.create("agentProposal")), contentHash, payload, createdAt: input.updatedAt, updatedAt: input.updatedAt });
    next = replaceStoryWorkReviewArtifact({ assignment, expectedVersion: input.expectedAssignmentVersion, expectedCurrentArtifact: input.artifact,
      nextArtifact: { proposalId: edited.id, artifactVersion: input.artifact.artifactVersion + 1, contentHash }, updatedAt: input.updatedAt });
    const created = await repositories.proposals.create(edited);
    if (!created.ok) throw new AgentProposalStateConflictError();
    const superseded = await repositories.proposals.markStale({ proposalId: proposal.id, projectId: input.projectId, expectedStatus: "ready", updatedAt: input.updatedAt });
    if (!superseded.ok) throw new AgentProposalStateConflictError();
    resultProposal = created.proposal;
  }
  const saved = await repositories.assignments.compareAndSet({ accountId: input.accountId, projectId: input.projectId, assignmentId: input.assignmentId, expectedVersion: assignment.version, next });
  if (!saved.ok) throw new StoryWorkAssignmentTransitionError();
  return { assignment: saved.assignment, proposal: resultProposal };
}
