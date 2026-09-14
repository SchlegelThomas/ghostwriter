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

export class StoryCheckGenerationConflictError extends Error {
  readonly code = "STORY_CHECK_GENERATION_CONFLICT" as const;

  constructor(message = "The check assignment changed before generation completed.") {
    super(message);
    this.name = "StoryCheckGenerationConflictError";
  }
}

export type BeginStoryCheckGenerationInput = BeginStoryWorkGenerationInput;
export type BeginStoryCheckGenerationResult = BeginStoryWorkGenerationResult;
export type FindStoryCheckGenerationReplayInput = FindStoryWorkGenerationReplayInput;
export type CompleteStoryCheckGenerationInput = CompleteStoryWorkGenerationInput;
export type CompleteStoryCheckGenerationResult = CompleteStoryWorkGenerationResult;
export type FinishStoryCheckGenerationInput = FinishStoryWorkGenerationInput;
export type FinishStoryCheckGenerationResult = FinishStoryWorkGenerationResult;

/**
 * Storage implementations execute each method in one database transaction.
 * Provider calls and context assembly happen before/after these bounded writes.
 */
export type StoryCheckGenerationUnitOfWork = StoryWorkGenerationRepositoryExecutor;
