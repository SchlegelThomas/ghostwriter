import type { Clock } from "./project-repository.js";
import type {
  ApplyCharacterStoryWorkInput,
  CharacterStoryWorkApplyResult,
  CharacterStoryWorkApplyUnitOfWork
} from "./character-story-work-uow.js";

export class StoryWorkAssignmentNotFoundError extends Error {
  readonly code = "STORY_WORK_ASSIGNMENT_NOT_FOUND" as const;

  constructor() {
    super("The story work assignment could not be found.");
    this.name = "StoryWorkAssignmentNotFoundError";
  }
}

export class CharacterStoryWorkArtifactMismatchError extends Error {
  readonly code = "CHARACTER_STORY_WORK_ARTIFACT_MISMATCH" as const;

  constructor(message = "The reviewed character artifact is no longer current.") {
    super(message);
    this.name = "CharacterStoryWorkArtifactMismatchError";
  }
}

export type CharacterStoryWorkServices = Readonly<{
  applyCharacterProposal(
    input: ApplyCharacterStoryWorkInput
  ): Promise<CharacterStoryWorkApplyResult>;
}>;

export function createCharacterStoryWorkServices(dependencies: Readonly<{
  apply: CharacterStoryWorkApplyUnitOfWork;
  clock: Clock;
}>): CharacterStoryWorkServices {
  return Object.freeze({
    applyCharacterProposal(input) {
      return dependencies.apply.applyCharacter({
        ...input,
        appliedAt: dependencies.clock.now()
      });
    }
  });
}
