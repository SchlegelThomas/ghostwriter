import type { ProjectId } from "./domain.js";
import type { AccountId } from "./identity.js";
import type {
  StoryWorkAttempt
} from "./story-work-attempt.js";
import type { StoryWorkAssignmentId } from "./story-work-assignment.js";
import type { AgentRunId } from "./domain.js";

export type CreateStoryWorkAttemptOutcome =
  | Readonly<{ ok: true; attempt: StoryWorkAttempt }>
  | Readonly<{ ok: false; reason: "duplicate-run" }>;

export type CompareAndSetStoryWorkAttemptOutcome =
  | Readonly<{ ok: true; attempt: StoryWorkAttempt }>
  | Readonly<{ ok: false; reason: "not-found" | "version-conflict" }>;

export interface StoryWorkAttemptRepository {
  get(input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
    assignmentId: StoryWorkAssignmentId;
    runId: AgentRunId;
  }>): Promise<StoryWorkAttempt | undefined>;
  listByAssignment(input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
    assignmentId: StoryWorkAssignmentId;
    limit?: number;
  }>): Promise<readonly StoryWorkAttempt[]>;
  create(input: Readonly<{ attempt: StoryWorkAttempt }>): Promise<CreateStoryWorkAttemptOutcome>;
  compareAndSet(input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
    assignmentId: StoryWorkAssignmentId;
    runId: AgentRunId;
    expectedVersion: number;
    next: StoryWorkAttempt;
  }>): Promise<CompareAndSetStoryWorkAttemptOutcome>;
}
