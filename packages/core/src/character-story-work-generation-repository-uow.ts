import type { ContextReceipt } from "./agent-context-receipt.js";
import { CHARACTER_STORY_WORK_WORKFLOW_ID } from "./agent-domain.js";
import type { AgentProposalPrimaryTarget } from "./agent-runs-proposals.js";
import {
  CharacterStoryWorkGenerationConflictError,
  type CharacterStoryWorkGenerationUnitOfWork
} from "./character-story-work-generation-uow.js";
import { StoryWorkAssignmentNotFoundError } from "./character-story-work-services.js";
import type { StoryWorkAssignment } from "./story-work-assignment.js";
import {
  createRepositoryStoryWorkGenerationExecutor,
  type StoryWorkGenerationRepositoryDependencies,
  type StoryWorkGenerationRepositoryPolicy
} from "./story-work-generation-repository-uow.js";

export type CharacterStoryWorkGenerationRepositoryDependencies =
  StoryWorkGenerationRepositoryDependencies;

function characterAssignmentTarget(
  assignment: StoryWorkAssignment
): AgentProposalPrimaryTarget | undefined {
  return assignment.destination.kind === "story-knowledge" &&
    assignment.destination.operation === "create"
    ? Object.freeze({
        kind: "story-knowledge" as const,
        id: assignment.destination.storyKnowledgeId
      })
    : undefined;
}

const CHARACTER_GENERATION_POLICY: StoryWorkGenerationRepositoryPolicy =
  Object.freeze({
    workflowId: CHARACTER_STORY_WORK_WORKFLOW_ID,
    outputSchemaId: "character-create-v2",
    label: "Character",
    lowerLabel: "character",
    assignmentTarget: characterAssignmentTarget,
    receiptTargetId(receipt: ContextReceipt) {
      return receipt.targetStoryKnowledgeId;
    },
    conflictError(message?: string) {
      return new CharacterStoryWorkGenerationConflictError(message);
    },
    notFoundError() {
      return new StoryWorkAssignmentNotFoundError();
    }
  });

export function createRepositoryCharacterStoryWorkGenerationExecutor(
  dependencies: CharacterStoryWorkGenerationRepositoryDependencies
): CharacterStoryWorkGenerationUnitOfWork {
  return createRepositoryStoryWorkGenerationExecutor(
    dependencies,
    CHARACTER_GENERATION_POLICY
  );
}
