import type { ContextReceipt } from "./agent-context-receipt.js";
import { STORY_WORK_STRUCTURE_WORKFLOW_ID } from "./agent-domain.js";
import type { AgentProposalPrimaryTarget } from "./agent-runs-proposals.js";
import { StoryWorkAssignmentNotFoundError } from "./character-story-work-services.js";
import {
  StoryStructureGenerationConflictError,
  type StoryStructureGenerationUnitOfWork
} from "./story-structure-generation-uow.js";
import { STORY_STRUCTURE_SCHEMA_ID } from "./story-structure-proposal-v1.js";
import type { StoryWorkAssignment } from "./story-work-assignment.js";
import {
  createRepositoryStoryWorkGenerationExecutor,
  type StoryWorkGenerationRepositoryDependencies,
  type StoryWorkGenerationRepositoryPolicy
} from "./story-work-generation-repository-uow.js";

export type StoryStructureGenerationRepositoryDependencies =
  StoryWorkGenerationRepositoryDependencies;

function outlineAssignmentTarget(
  assignment: StoryWorkAssignment
): AgentProposalPrimaryTarget | undefined {
  const validDestination =
    assignment.taskKind === "outline" &&
    assignment.destination.kind === "book" &&
    assignment.destination.operation === "update";
  return validDestination && assignment.destination.kind === "book"
    ? Object.freeze({
        kind: "book" as const,
        id: assignment.destination.bookId
      })
    : undefined;
}

const STORY_STRUCTURE_GENERATION_POLICY: StoryWorkGenerationRepositoryPolicy =
  Object.freeze({
    workflowId: STORY_WORK_STRUCTURE_WORKFLOW_ID,
    outputSchemaId: STORY_STRUCTURE_SCHEMA_ID,
    label: "Story structure",
    lowerLabel: "story structure",
    assignmentTarget: outlineAssignmentTarget,
    receiptTargetId(receipt: ContextReceipt) {
      return receipt.primaryTarget?.kind === "book" ? receipt.primaryTarget.id : undefined;
    },
    conflictError(message?: string) {
      return new StoryStructureGenerationConflictError(message);
    },
    notFoundError() {
      return new StoryWorkAssignmentNotFoundError();
    }
  });

export function createRepositoryStoryStructureGenerationExecutor(
  dependencies: StoryStructureGenerationRepositoryDependencies
): StoryStructureGenerationUnitOfWork {
  return createRepositoryStoryWorkGenerationExecutor(
    dependencies,
    STORY_STRUCTURE_GENERATION_POLICY
  );
}
