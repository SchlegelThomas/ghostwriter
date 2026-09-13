import type {
  BeginStoryWorkGenerationInput,
  BeginStoryWorkGenerationResult,
  CompleteStoryWorkGenerationInput,
  CompleteStoryWorkGenerationResult,
  FindStoryWorkGenerationReplayInput,
  FinishStoryWorkGenerationInput,
  FinishStoryWorkGenerationResult,
  StoryWorkGenerationRepositoryExecutor
} from "./story-work-generation-repository-uow.js";

export class SceneStoryWorkGenerationConflictError extends Error {
  readonly code = "SCENE_STORY_WORK_GENERATION_CONFLICT" as const;

  constructor(message = "The scene assignment changed before generation completed.") {
    super(message);
    this.name = "SceneStoryWorkGenerationConflictError";
  }
}

export type BeginSceneStoryWorkGenerationInput = BeginStoryWorkGenerationInput;
export type BeginSceneStoryWorkGenerationResult = BeginStoryWorkGenerationResult;
export type FindSceneStoryWorkGenerationReplayInput =
  FindStoryWorkGenerationReplayInput;
export type CompleteSceneStoryWorkGenerationInput =
  CompleteStoryWorkGenerationInput;
export type CompleteSceneStoryWorkGenerationResult =
  CompleteStoryWorkGenerationResult;
export type FinishSceneStoryWorkGenerationInput = FinishStoryWorkGenerationInput;
export type FinishSceneStoryWorkGenerationResult = FinishStoryWorkGenerationResult;

/**
 * Storage implementations execute each method in one database transaction.
 * Provider calls and context assembly happen before/after these bounded writes.
 */
export type SceneStoryWorkGenerationUnitOfWork =
  StoryWorkGenerationRepositoryExecutor;
