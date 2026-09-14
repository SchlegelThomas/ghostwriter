import type { InstructionContentHash } from "./agent-domain.js";
import type { ProjectId } from "./domain.js";
import type { AccountId } from "./identity.js";
import type { McpGrantId } from "./mcp-grants.js";
import type {
  StoryWorkCoordination,
  StoryWorkCoordinationId
} from "./story-work-coordination.js";

export const STORY_WORK_COORDINATION_LIST_MAX = 100;

export type StoryWorkCoordinationListOptions = Readonly<{
  limit?: number;
}>;

export type CreateStoryWorkCoordinationOutcome =
  | Readonly<{
      ok: true;
      coordination: StoryWorkCoordination;
      created: boolean;
    }>
  | Readonly<{ ok: false; reason: "idempotency-conflict" | "duplicate-id" }>;

export type CompareAndSetStoryWorkCoordinationOutcome =
  | Readonly<{ ok: true; coordination: StoryWorkCoordination }>
  | Readonly<{ ok: false; reason: "not-found" | "version-conflict" }>;

export type StoryWorkCoordinationIdempotencyRecord = Readonly<{
  coordination: StoryWorkCoordination;
  requestFingerprint: InstructionContentHash;
}>;

/**
 * Project/account arguments are part of every lookup so an inaccessible ID is
 * indistinguishable from a missing one at the repository boundary.
 */
export interface StoryWorkCoordinationRepository {
  get(input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
    coordinationId: StoryWorkCoordinationId;
  }>): Promise<StoryWorkCoordination | undefined>;
  getByIdempotencyKey(input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
    idempotencyKey: string;
  }>): Promise<StoryWorkCoordinationIdempotencyRecord | undefined>;
  listByProject(input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
    options?: StoryWorkCoordinationListOptions;
  }>): Promise<readonly StoryWorkCoordination[]>;
  listByMcpGrantOrigin(input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
    originMcpGrantId: McpGrantId;
    options?: Readonly<{ limit?: number }>;
  }>): Promise<readonly StoryWorkCoordination[]>;
  create(input: Readonly<{
    coordination: StoryWorkCoordination;
    requestFingerprint: InstructionContentHash;
  }>): Promise<CreateStoryWorkCoordinationOutcome>;
  /**
   * Internal persistence primitive. Services must construct `next` through domain
   * transitions. CAS permits only coordination status and one previously-unbound
   * proposal-continuity-check binding.
   */
  compareAndSet(input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
    coordinationId: StoryWorkCoordinationId;
    expectedVersion: number;
    next: StoryWorkCoordination;
  }>): Promise<CompareAndSetStoryWorkCoordinationOutcome>;
}
