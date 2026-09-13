import type { ContextReceipt } from "./agent-context-receipt.js";
import type { InstructionContentHash } from "./agent-domain.js";
import type { AgentProposal, AgentRun } from "./agent-runs-proposals.js";
import type { ProjectId } from "./domain.js";
import type { AccountId } from "./identity.js";
import type { StoryWorkAssignment } from "./story-work-assignment.js";
import type { StoryWorkAttempt } from "./story-work-attempt.js";

export class CharacterStoryWorkGenerationConflictError extends Error {
  readonly code = "CHARACTER_STORY_WORK_GENERATION_CONFLICT" as const;

  constructor(message = "The character assignment changed before generation completed.") {
    super(message);
    this.name = "CharacterStoryWorkGenerationConflictError";
  }
}

type ScopedGenerationInput = Readonly<{
  accountId: AccountId;
  projectId: ProjectId;
  expectedAssignmentVersion: number;
  expectedAttemptVersion: number;
  expectedRunStatus: "running";
}>;

export type BeginCharacterStoryWorkGenerationInput = Readonly<{
  accountId: AccountId;
  projectId: ProjectId;
  expectedAssignmentVersion: number;
  receipt: ContextReceipt;
  queuedRun: AgentRun;
  runningRun: AgentRun;
  attempt: StoryWorkAttempt;
  runningAssignment: StoryWorkAssignment;
}>;

export type BeginCharacterStoryWorkGenerationResult = Readonly<{
  replayed: boolean;
  receipt: ContextReceipt;
  run: AgentRun;
  attempt: StoryWorkAttempt;
  assignment: StoryWorkAssignment;
  proposal?: AgentProposal;
}>;

export type FindCharacterStoryWorkGenerationReplayInput = Readonly<{
  accountId: AccountId;
  projectId: ProjectId;
  assignmentId: StoryWorkAssignment["id"];
  idempotencyKey: string;
  requestFingerprint: InstructionContentHash;
}>;

export type CompleteCharacterStoryWorkGenerationInput =
  ScopedGenerationInput &
    Readonly<{
      proposal: AgentProposal;
      readyRun: AgentRun;
      completedAttempt: StoryWorkAttempt;
      artifactReadyAssignment: StoryWorkAssignment;
    }>;

export type CompleteCharacterStoryWorkGenerationResult = Readonly<{
  assignment: StoryWorkAssignment;
  attempt: StoryWorkAttempt;
  run: AgentRun;
  proposal: AgentProposal;
}>;

export type FinishCharacterStoryWorkGenerationInput =
  ScopedGenerationInput &
    Readonly<{
      terminalRun: AgentRun;
      terminalAssignment: StoryWorkAssignment;
    }>;

export type FinishCharacterStoryWorkGenerationResult = Readonly<{
  assignment: StoryWorkAssignment;
  attempt: StoryWorkAttempt;
  run: AgentRun;
}>;

/**
 * Storage implementations execute each method in one database transaction.
 * Provider calls and context assembly happen before/after these bounded writes.
 */
export interface CharacterStoryWorkGenerationUnitOfWork {
  findReplay(
    input: FindCharacterStoryWorkGenerationReplayInput
  ): Promise<BeginCharacterStoryWorkGenerationResult | undefined>;
  begin(
    input: BeginCharacterStoryWorkGenerationInput
  ): Promise<BeginCharacterStoryWorkGenerationResult>;
  complete(
    input: CompleteCharacterStoryWorkGenerationInput
  ): Promise<CompleteCharacterStoryWorkGenerationResult>;
  finishWithoutArtifact(
    input: FinishCharacterStoryWorkGenerationInput
  ): Promise<FinishCharacterStoryWorkGenerationResult>;
}
