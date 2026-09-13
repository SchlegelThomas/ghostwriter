import type { ContextReceipt } from "./agent-context-receipt.js";
import { SCENE_STORY_WORK_WORKFLOW_ID } from "./agent-domain.js";
import type { AgentProposalPrimaryTarget } from "./agent-runs-proposals.js";
import { StoryWorkAssignmentNotFoundError } from "./character-story-work-services.js";
import {
  SceneStoryWorkGenerationConflictError,
  type SceneStoryWorkGenerationUnitOfWork
} from "./scene-story-work-generation-uow.js";
import type { StoryWorkAssignment } from "./story-work-assignment.js";
import {
  createRepositoryStoryWorkGenerationExecutor,
  type StoryWorkGenerationRepositoryDependencies,
  type StoryWorkGenerationRepositoryPolicy
} from "./story-work-generation-repository-uow.js";

export type SceneStoryWorkGenerationRepositoryDependencies =
  StoryWorkGenerationRepositoryDependencies;

function sceneAssignmentTarget(
  assignment: StoryWorkAssignment
): AgentProposalPrimaryTarget | undefined {
  const validDestination =
    assignment.destination.kind === "scene" &&
    ((assignment.taskKind === "scene" &&
      assignment.destination.operation === "create") ||
      (assignment.taskKind === "revise" &&
        assignment.destination.operation === "update"));
  return validDestination && assignment.destination.kind === "scene"
    ? Object.freeze({
        kind: "scene" as const,
        id: assignment.destination.sceneId
      })
    : undefined;
}

const SCENE_GENERATION_POLICY: StoryWorkGenerationRepositoryPolicy =
  Object.freeze({
    workflowId: SCENE_STORY_WORK_WORKFLOW_ID,
    outputSchemaId: "scene-draft-v1",
    label: "Scene",
    lowerLabel: "scene",
    assignmentTarget: sceneAssignmentTarget,
    receiptTargetId(receipt: ContextReceipt) {
      return receipt.targetSceneId;
    },
    conflictError(message?: string) {
      return new SceneStoryWorkGenerationConflictError(message);
    },
    notFoundError() {
      return new StoryWorkAssignmentNotFoundError();
    }
  });

export function createRepositorySceneStoryWorkGenerationExecutor(
  dependencies: SceneStoryWorkGenerationRepositoryDependencies
): SceneStoryWorkGenerationUnitOfWork {
  return createRepositoryStoryWorkGenerationExecutor(
    dependencies,
    SCENE_GENERATION_POLICY
  );
}
