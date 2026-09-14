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

export class StoryStructureGenerationConflictError extends Error {
  readonly code = "STORY_STRUCTURE_GENERATION_CONFLICT" as const;

  constructor(message = "The outline assignment changed before generation completed.") {
    super(message);
    this.name = "StoryStructureGenerationConflictError";
  }
}

export type BeginStoryStructureGenerationInput = BeginStoryWorkGenerationInput;
export type BeginStoryStructureGenerationResult = BeginStoryWorkGenerationResult;
export type FindStoryStructureGenerationReplayInput = FindStoryWorkGenerationReplayInput;
export type CompleteStoryStructureGenerationInput = CompleteStoryWorkGenerationInput;
export type CompleteStoryStructureGenerationResult = CompleteStoryWorkGenerationResult;
export type FinishStoryStructureGenerationInput = FinishStoryWorkGenerationInput;
export type FinishStoryStructureGenerationResult = FinishStoryWorkGenerationResult;

/**
 * Storage implementations execute each method in one database transaction.
 * Provider calls and context assembly happen before/after these bounded writes.
 */
export type StoryStructureGenerationUnitOfWork = StoryWorkGenerationRepositoryExecutor;
