import type { ContextReceipt } from "./agent-context-receipt.js";
import { STORY_CHECK_CONTINUITY_WORKFLOW_ID } from "./agent-domain.js";
import type { AgentProposalPrimaryTarget } from "./agent-runs-proposals.js";
import { StoryWorkAssignmentNotFoundError } from "./character-story-work-services.js";
import {
  StoryCheckGenerationConflictError,
  type StoryCheckGenerationUnitOfWork
} from "./story-check-generation-uow.js";
import type { StoryWorkAssignment } from "./story-work-assignment.js";
import {
  createRepositoryStoryWorkGenerationExecutor,
  type StoryWorkGenerationRepositoryDependencies,
  type StoryWorkGenerationRepositoryPolicy
} from "./story-work-generation-repository-uow.js";

export type StoryCheckGenerationRepositoryDependencies =
  StoryWorkGenerationRepositoryDependencies;

function checkAssignmentTarget(
  assignment: StoryWorkAssignment
): AgentProposalPrimaryTarget | undefined {
  const validDestination =
    assignment.taskKind === "check" &&
    assignment.destination.kind === "scene" &&
    assignment.destination.operation === "assess";
  return validDestination && assignment.destination.kind === "scene"
    ? Object.freeze({
        kind: "scene" as const,
        id: assignment.destination.sceneId
      })
    : undefined;
}

const STORY_CHECK_GENERATION_POLICY: StoryWorkGenerationRepositoryPolicy =
  Object.freeze({
    workflowId: STORY_CHECK_CONTINUITY_WORKFLOW_ID,
    outputSchemaId: "story-check-findings-v1",
    label: "Story check",
    lowerLabel: "story check",
    assignmentTarget: checkAssignmentTarget,
    receiptTargetId(receipt: ContextReceipt) {
      return receipt.targetSceneId;
    },
    conflictError(message?: string) {
      return new StoryCheckGenerationConflictError(message);
    },
    notFoundError() {
      return new StoryWorkAssignmentNotFoundError();
    }
  });

export function createRepositoryStoryCheckGenerationExecutor(
  dependencies: StoryCheckGenerationRepositoryDependencies
): StoryCheckGenerationUnitOfWork {
  return createRepositoryStoryWorkGenerationExecutor(
    dependencies,
    STORY_CHECK_GENERATION_POLICY
  );
}
