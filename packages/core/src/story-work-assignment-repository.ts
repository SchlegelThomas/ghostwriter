import type { InstructionContentHash } from "./agent-domain.js";
import type { ProjectId } from "./domain.js";
import type { AccountId } from "./identity.js";
import type { McpGrantId } from "./mcp-grants.js";
import type {
  StoryWorkAssignment,
  StoryWorkAssignmentId,
  StoryWorkAssignmentStatus
} from "./story-work-assignment.js";

export type StoryWorkAssignmentListOptions = Readonly<{
  limit?: number;
  status?: StoryWorkAssignmentStatus;
}>;

export type CreateStoryWorkAssignmentOutcome =
  | Readonly<{
      ok: true;
      assignment: StoryWorkAssignment;
      created: boolean;
    }>
  | Readonly<{ ok: false; reason: "idempotency-conflict" | "duplicate-id" }>;

export type CompareAndSetStoryWorkAssignmentOutcome =
  | Readonly<{ ok: true; assignment: StoryWorkAssignment }>
  | Readonly<{ ok: false; reason: "not-found" | "version-conflict" }>;

export type StoryWorkAssignmentIdempotencyRecord = Readonly<{
  assignment: StoryWorkAssignment;
  requestFingerprint: InstructionContentHash;
}>;

/**
 * Project/account arguments are part of every lookup so an inaccessible ID is
 * indistinguishable from a missing one at the repository boundary.
 */
export interface StoryWorkAssignmentRepository {
  get(input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
    assignmentId: StoryWorkAssignmentId;
  }>): Promise<StoryWorkAssignment | undefined>;
  getByIdempotencyKey(input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
    idempotencyKey: string;
  }>): Promise<StoryWorkAssignmentIdempotencyRecord | undefined>;
  listByProject(input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
    options?: StoryWorkAssignmentListOptions;
  }>): Promise<readonly StoryWorkAssignment[]>;
  listByMcpGrantOrigin(input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
    originMcpGrantId: McpGrantId;
    options?: Readonly<{ limit?: number }>;
  }>): Promise<readonly StoryWorkAssignment[]>;
  create(input: Readonly<{
    assignment: StoryWorkAssignment;
    requestFingerprint: InstructionContentHash;
  }>): Promise<CreateStoryWorkAssignmentOutcome>;
  /**
   * Internal persistence primitive. Services must construct `next` through the
   * domain transitions. Persisting `applied` is permitted only within the same
   * unit of work that commits the referenced canonical results.
   */
  compareAndSet(input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
    assignmentId: StoryWorkAssignmentId;
    expectedVersion: number;
    next: StoryWorkAssignment;
  }>): Promise<CompareAndSetStoryWorkAssignmentOutcome>;
}
