import { CHARACTER_STORY_WORK_WORKFLOW_ID, type AsyncHashPort } from "./agent-domain.js";
import type { AgentProposalRepository, AgentRunRepository, ContextReceiptRepository } from "./agent-foundation-repository.js";
import { AgentProposalStateConflictError, computeAgentProposalContentHash, createReadyAgentProposal, type AgentProposal } from "./agent-runs-proposals.js";
import { validateCharacterCreateV2, type CharacterCreateV2 } from "./character-create-v2.js";
import { CharacterStoryWorkArtifactMismatchError, StoryWorkAssignmentNotFoundError } from "./character-story-work-services.js";
import { agentProposalId, type ProjectId } from "./domain.js";
import { type AccountId, ProjectAccessDeniedError, requireProjectOwner } from "./identity.js";
import type { IdGenerator, ProjectRepository } from "./project-repository.js";
import { ProjectArchivedMutationError } from "./capture-documents.js";
import type { StoryWorkAssignmentRepository } from "./story-work-assignment-repository.js";
import {
  openStoryWorkArtifactReview, rejectStoryWorkArtifact, replaceStoryWorkReviewArtifact,
  StoryWorkAssignmentTransitionError, type StoryWorkArtifactPointer, type StoryWorkAssignment, type StoryWorkAssignmentId
} from "./story-work-assignment.js";

export type CharacterStoryWorkReviewInput = Readonly<{
  accountId: AccountId;
  projectId: ProjectId;
  assignmentId: StoryWorkAssignmentId;
  expectedAssignmentVersion: number;
  artifact: StoryWorkArtifactPointer;
  updatedAt: string;
}> & (Readonly<{ action: "open" }> | Readonly<{ action: "reject" }> | Readonly<{ action: "edit"; payload: CharacterCreateV2 }>);

export type CharacterStoryWorkReviewResult = Readonly<{ assignment: StoryWorkAssignment; proposal: AgentProposal }>;
export interface CharacterStoryWorkReviewUnitOfWork {
  review(input: CharacterStoryWorkReviewInput): Promise<CharacterStoryWorkReviewResult>;
}

export type CharacterStoryWorkReviewRepositories = Readonly<{
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

/** Caller must bind all repositories to one transaction and lock the scoped assignment first. */
export async function executeCharacterStoryWorkReview(
  repositories: CharacterStoryWorkReviewRepositories,
  input: CharacterStoryWorkReviewInput
): Promise<CharacterStoryWorkReviewResult> {
  const assignment = await repositories.assignments.get(input);
  if (assignment === undefined) throw new StoryWorkAssignmentNotFoundError();
  try { requireProjectOwner(input.projectId, await repositories.projects.getProjectMembership(input.projectId, input.accountId)); }
  catch (cause) { if (cause instanceof ProjectAccessDeniedError) throw new StoryWorkAssignmentNotFoundError(); throw cause; }
  const project = await repositories.projects.getProject(input.projectId);
  if (project === undefined) throw new StoryWorkAssignmentNotFoundError();
  if (project.archivedAt !== undefined) throw new ProjectArchivedMutationError();
  if (!samePointer(assignment.currentArtifact, input.artifact) || assignment.taskKind !== "character" || assignment.destination.kind !== "story-knowledge") {
    throw new CharacterStoryWorkArtifactMismatchError();
  }
  const proposal = await repositories.proposals.get(input.artifact.proposalId);
  if (proposal === undefined || proposal.projectId !== input.projectId || proposal.outputSchemaId !== "character-create-v2" ||
      proposal.contentHash !== input.artifact.contentHash || proposal.primaryTarget.kind !== "story-knowledge" ||
      proposal.primaryTarget.id !== assignment.destination.storyKnowledgeId) throw new CharacterStoryWorkArtifactMismatchError();
  const run = await repositories.runs.get(proposal.runId);
  const receipt = await repositories.receipts.get(proposal.receiptId);
  if (run === undefined || receipt === undefined || run.projectId !== input.projectId || run.initiatorAccountId !== input.accountId ||
      run.workflowId !== CHARACTER_STORY_WORK_WORKFLOW_ID || run.status !== "ready" || run.receiptId !== receipt.id ||
      run.receiptHash !== receipt.receiptHash || receipt.projectId !== input.projectId || receipt.provider !== assignment.provider ||
      receipt.model !== assignment.model || run.provider !== assignment.provider || run.model !== assignment.model) {
    throw new CharacterStoryWorkArtifactMismatchError();
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
    const payload = validateCharacterCreateV2(input.payload);
    const allowedSources = new Set(assignment.sources.flatMap((source) => source.kind === "scene" ? [source.sceneId] : []));
    if (payload.sourceSceneIds?.some((id) => !allowedSources.has(id))) throw new CharacterStoryWorkArtifactMismatchError("Character edits cannot add scene sources outside this assignment.");
    const contentHash = await computeAgentProposalContentHash({ outputSchemaId: "character-create-v2", payload, primaryTarget: proposal.primaryTarget }, repositories.hashPort);
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
