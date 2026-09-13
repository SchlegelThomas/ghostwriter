import {
  STORY_WORK_STRUCTURE_WORKFLOW_ID,
  type AsyncHashPort
} from "./agent-domain.js";
import type {
  AgentProposalRepository,
  AgentRunRepository,
  ContextReceiptRepository
} from "./agent-foundation-repository.js";
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
  openStoryWorkArtifactReview,
  rejectStoryWorkArtifact,
  replaceStoryWorkReviewArtifact,
  StoryWorkAssignmentTransitionError,
  type StoryWorkArtifactPointer,
  type StoryWorkAssignment,
  type StoryWorkAssignmentId
} from "./story-work-assignment.js";
import {
  STORY_STRUCTURE_SCHEMA_ID,
  validateStoryStructureProposalV1,
  type StoryStructureDependency,
  type StoryStructureOperation,
  type StoryStructureProposalV1
} from "./story-structure-proposal-v1.js";

export class StoryStructureStoryWorkArtifactMismatchError extends Error {
  readonly code = "STORY_STRUCTURE_STORY_WORK_ARTIFACT_MISMATCH" as const;

  constructor(message = "The reviewed structure artifact is no longer current.") {
    super(message);
    this.name = "StoryStructureStoryWorkArtifactMismatchError";
  }
}

export type StoryStructureStoryWorkReviewInput = Readonly<{
  accountId: AccountId;
  projectId: ProjectId;
  assignmentId: StoryWorkAssignmentId;
  expectedAssignmentVersion: number;
  artifact: StoryWorkArtifactPointer;
  updatedAt: string;
}> &
  (
    | Readonly<{ action: "open" }>
    | Readonly<{ action: "reject" }>
    | Readonly<{ action: "edit"; payload: StoryStructureProposalV1 }>
  );

export type StoryStructureStoryWorkReviewResult = Readonly<{
  assignment: StoryWorkAssignment;
  proposal: AgentProposal;
}>;

export interface StoryStructureStoryWorkReviewUnitOfWork {
  review(input: StoryStructureStoryWorkReviewInput): Promise<StoryStructureStoryWorkReviewResult>;
}

export type StoryStructureStoryWorkReviewRepositories = Readonly<{
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

function sortedIds(ids: readonly string[]): string[] {
  return [...ids].map(String).sort((left, right) => left.localeCompare(right));
}

function sameIdMultiset(left: readonly string[], right: readonly string[]): boolean {
  const a = sortedIds(left);
  const b = sortedIds(right);
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

function dependenciesEqual(
  left: readonly StoryStructureDependency[],
  right: readonly StoryStructureDependency[]
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const leftById = new Map(
    left.map((edge) => [
      edge.operationId,
      sortedIds(edge.requires.map(String)).join("\0")
    ])
  );
  for (const edge of right) {
    const signature = sortedIds(edge.requires.map(String)).join("\0");
    if (leftById.get(edge.operationId) !== signature) {
      return false;
    }
  }
  return true;
}

function collectCanonicalEntityIds(proposal: StoryStructureProposalV1): readonly string[] {
  const ids = new Set<string>();
  for (const operation of proposal.operations) {
    switch (operation.type) {
      case "part.create":
        ids.add(String(operation.partId));
        ids.add(String(operation.bookId));
        break;
      case "chapter.create":
        ids.add(String(operation.partId));
        ids.add(String(operation.chapterId));
        ids.add(String(operation.bookId));
        break;
      case "chapter.update":
        ids.add(String(operation.partId));
        ids.add(String(operation.chapterId));
        ids.add(String(operation.bookId));
        break;
      case "chapter.reorder":
        ids.add(String(operation.partId));
        ids.add(String(operation.bookId));
        for (const chapterId of operation.chapterIds) {
          ids.add(String(chapterId));
        }
        break;
      case "scene.createPlanned":
        ids.add(String(operation.sceneId));
        ids.add(String(operation.bookId));
        if (operation.chapterId !== undefined) {
          ids.add(String(operation.chapterId));
        }
        break;
      case "scene.updateIntent":
      case "scene.setArchived":
        ids.add(String(operation.sceneId));
        break;
      case "scene.move":
        ids.add(String(operation.sceneId));
        ids.add(String(operation.bookId));
        if (operation.chapterId !== undefined) {
          ids.add(String(operation.chapterId));
        }
        break;
    }
  }
  return Object.freeze(sortedIds([...ids]));
}

function assertOperationAuthorityUnchanged(
  stored: StoryStructureOperation,
  edited: StoryStructureOperation
): void {
  if (stored.type !== edited.type || stored.operationId !== edited.operationId) {
    throw new StoryStructureStoryWorkArtifactMismatchError(
      "Structure edits must preserve operation ids and types."
    );
  }
  switch (stored.type) {
    case "part.create":
      if (
        edited.type !== "part.create" ||
        stored.bookId !== edited.bookId ||
        stored.partId !== edited.partId
      ) {
        throw new StoryStructureStoryWorkArtifactMismatchError();
      }
      break;
    case "chapter.create":
      if (
        edited.type !== "chapter.create" ||
        stored.bookId !== edited.bookId ||
        stored.partId !== edited.partId ||
        stored.chapterId !== edited.chapterId
      ) {
        throw new StoryStructureStoryWorkArtifactMismatchError();
      }
      break;
    case "chapter.update":
      if (
        edited.type !== "chapter.update" ||
        stored.bookId !== edited.bookId ||
        stored.partId !== edited.partId ||
        stored.chapterId !== edited.chapterId
      ) {
        throw new StoryStructureStoryWorkArtifactMismatchError();
      }
      break;
    case "chapter.reorder":
      if (
        edited.type !== "chapter.reorder" ||
        stored.bookId !== edited.bookId ||
        stored.partId !== edited.partId ||
        !sameIdMultiset(stored.chapterIds, edited.chapterIds)
      ) {
        throw new StoryStructureStoryWorkArtifactMismatchError(
          "Structure reorder edits must keep the same chapter id set."
        );
      }
      break;
    case "scene.createPlanned":
      if (
        edited.type !== "scene.createPlanned" ||
        stored.bookId !== edited.bookId ||
        stored.sceneId !== edited.sceneId ||
        stored.chapterId !== edited.chapterId
      ) {
        throw new StoryStructureStoryWorkArtifactMismatchError();
      }
      break;
    case "scene.updateIntent":
      if (edited.type !== "scene.updateIntent" || stored.sceneId !== edited.sceneId) {
        throw new StoryStructureStoryWorkArtifactMismatchError();
      }
      break;
    case "scene.move":
      if (
        edited.type !== "scene.move" ||
        stored.bookId !== edited.bookId ||
        stored.sceneId !== edited.sceneId ||
        stored.chapterId !== edited.chapterId
      ) {
        throw new StoryStructureStoryWorkArtifactMismatchError();
      }
      break;
    case "scene.setArchived":
      if (edited.type !== "scene.setArchived" || stored.sceneId !== edited.sceneId) {
        throw new StoryStructureStoryWorkArtifactMismatchError();
      }
      break;
  }
}

/** Ensures writer edits change only human-reviewable fields while authority stays fixed. */
export function assertStoryStructureReviewEditPreservesAuthority(
  stored: StoryStructureProposalV1,
  edited: StoryStructureProposalV1
): void {
  if (
    stored.projectId !== edited.projectId ||
    stored.bookId !== edited.bookId ||
    stored.expectedProjectVersion !== edited.expectedProjectVersion ||
    stored.contextReceiptHash !== edited.contextReceiptHash
  ) {
    throw new StoryStructureStoryWorkArtifactMismatchError(
      "Structure edits must preserve project, book, baseline version, and context receipt."
    );
  }
  if (stored.operations.length !== edited.operations.length) {
    throw new StoryStructureStoryWorkArtifactMismatchError(
      "Structure edits must preserve the generated operation count."
    );
  }
  if (!dependenciesEqual(stored.dependencies, edited.dependencies)) {
    throw new StoryStructureStoryWorkArtifactMismatchError(
      "Structure edits must preserve dependency records and edges."
    );
  }
  const storedById = new Map(
    stored.operations.map((operation) => [operation.operationId, operation])
  );
  const editedById = new Map(
    edited.operations.map((operation) => [operation.operationId, operation])
  );
  if (storedById.size !== editedById.size) {
    throw new StoryStructureStoryWorkArtifactMismatchError(
      "Structure edits must preserve operation ids."
    );
  }
  for (const [operationId, storedOperation] of storedById) {
    const editedOperation = editedById.get(operationId);
    if (editedOperation === undefined) {
      throw new StoryStructureStoryWorkArtifactMismatchError(
        "Structure edits must preserve every operation id."
      );
    }
    assertOperationAuthorityUnchanged(storedOperation, editedOperation);
  }
  const storedEntities = collectCanonicalEntityIds(stored);
  const editedEntities = collectCanonicalEntityIds(edited);
  if (
    storedEntities.length !== editedEntities.length ||
    storedEntities.some((id, index) => id !== editedEntities[index])
  ) {
    throw new StoryStructureStoryWorkArtifactMismatchError(
      "Structure edits must preserve the canonical entity id set."
    );
  }
}

/** Caller must bind all repositories to one transaction and lock the scoped assignment first. */
export async function executeStoryStructureStoryWorkReview(
  repositories: StoryStructureStoryWorkReviewRepositories,
  input: StoryStructureStoryWorkReviewInput
): Promise<StoryStructureStoryWorkReviewResult> {
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
  if (
    !samePointer(assignment.currentArtifact, input.artifact) ||
    assignment.taskKind !== "outline" ||
    assignment.destination.kind !== "book" ||
    assignment.destination.operation !== "update"
  ) {
    throw new StoryStructureStoryWorkArtifactMismatchError();
  }
  const targetBookId = assignment.destination.bookId;
  const proposal = await repositories.proposals.get(input.artifact.proposalId);
  if (
    proposal === undefined ||
    proposal.projectId !== input.projectId ||
    proposal.outputSchemaId !== STORY_STRUCTURE_SCHEMA_ID ||
    proposal.contentHash !== input.artifact.contentHash ||
    proposal.primaryTarget.kind !== "book" ||
    proposal.primaryTarget.id !== targetBookId
  ) {
    throw new StoryStructureStoryWorkArtifactMismatchError();
  }
  const storedPayload = validateStoryStructureProposalV1(proposal.payload);
  if (
    storedPayload.projectId !== input.projectId ||
    storedPayload.bookId !== targetBookId
  ) {
    throw new StoryStructureStoryWorkArtifactMismatchError();
  }
  const run = await repositories.runs.get(proposal.runId);
  const receipt = await repositories.receipts.get(proposal.receiptId);
  if (
    run === undefined ||
    receipt === undefined ||
    run.projectId !== input.projectId ||
    run.initiatorAccountId !== input.accountId ||
    run.workflowId !== STORY_WORK_STRUCTURE_WORKFLOW_ID ||
    run.status !== "ready" ||
    run.receiptId !== receipt.id ||
    run.receiptHash !== receipt.receiptHash ||
    receipt.projectId !== input.projectId ||
    receipt.provider !== assignment.provider ||
    receipt.model !== assignment.model ||
    receipt.workflowId !== STORY_WORK_STRUCTURE_WORKFLOW_ID ||
    receipt.outputSchemaId !== STORY_STRUCTURE_SCHEMA_ID ||
    receipt.primaryTarget?.kind !== "book" ||
    receipt.primaryTarget.id !== targetBookId ||
    run.provider !== assignment.provider ||
    run.model !== assignment.model
  ) {
    throw new StoryStructureStoryWorkArtifactMismatchError();
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
  if (
    input.action === "reject" &&
    assignment.status === "rejected" &&
    assignment.version === input.expectedAssignmentVersion + 1 &&
    proposal.status === "rejected" &&
    proposal.decision?.actorAccountId === input.accountId
  ) {
    return { assignment, proposal };
  }
  if (assignment.version !== input.expectedAssignmentVersion) {
    throw new StoryWorkAssignmentTransitionError();
  }
  if (proposal.status !== "ready") throw new AgentProposalStateConflictError();
  let next: StoryWorkAssignment;
  let resultProposal = proposal;
  if (input.action === "open") {
    next = openStoryWorkArtifactReview({
      assignment,
      expectedVersion: input.expectedAssignmentVersion,
      artifact: input.artifact,
      updatedAt: input.updatedAt
    });
  } else if (input.action === "reject") {
    next = rejectStoryWorkArtifact({
      assignment,
      expectedVersion: input.expectedAssignmentVersion,
      artifact: input.artifact,
      updatedAt: input.updatedAt
    });
    const rejected = await repositories.proposals.reject({
      proposalId: proposal.id,
      projectId: input.projectId,
      expectedStatus: "ready",
      actorAccountId: input.accountId,
      decidedAt: input.updatedAt,
      updatedAt: input.updatedAt
    });
    if (!rejected.ok) throw new AgentProposalStateConflictError();
    resultProposal = rejected.proposal;
  } else {
    const payload = validateStoryStructureProposalV1(input.payload);
    assertStoryStructureReviewEditPreservesAuthority(storedPayload, payload);
    const contentHash = await computeAgentProposalContentHash(
      {
        outputSchemaId: STORY_STRUCTURE_SCHEMA_ID,
        payload,
        primaryTarget: proposal.primaryTarget
      },
      repositories.hashPort
    );
    const edited = createReadyAgentProposal({
      ...proposal,
      id: agentProposalId(repositories.ids.create("agentProposal")),
      contentHash,
      payload,
      createdAt: input.updatedAt,
      updatedAt: input.updatedAt
    });
    next = replaceStoryWorkReviewArtifact({
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
    resultProposal = created.proposal;
  }
  const saved = await repositories.assignments.compareAndSet({
    accountId: input.accountId,
    projectId: input.projectId,
    assignmentId: input.assignmentId,
    expectedVersion: assignment.version,
    next
  });
  if (!saved.ok) throw new StoryWorkAssignmentTransitionError();
  return { assignment: saved.assignment, proposal: resultProposal };
}
