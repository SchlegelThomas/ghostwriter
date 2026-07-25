import type {
  AccountAiCollaborationProfile,
  ProjectAgentInstructions
} from "./agent-domain.js";
import type { PlaybookId, ProjectId } from "./domain.js";
import type { AccountId } from "./identity.js";
import type { ProjectPlaybook } from "./agent-domain.js";

export type AgentGuidanceListOptions = Readonly<{
  limit?: number;
  includeArchived?: boolean;
}>;

export type UpsertAccountAiCollaborationProfileOutcome =
  | Readonly<{ ok: true; profile: AccountAiCollaborationProfile }>
  | Readonly<{ ok: false; reason: "conflict" }>;

export type UpsertProjectAgentInstructionsOutcome =
  | Readonly<{ ok: true; instructions: ProjectAgentInstructions }>
  | Readonly<{ ok: false; reason: "conflict" }>;

export type UpsertProjectPlaybookOutcome =
  | Readonly<{ ok: true; playbook: ProjectPlaybook }>
  | Readonly<{ ok: false; reason: "conflict" | "not-found" }>;

export interface AccountAiCollaborationProfileRepository {
  get(accountId: AccountId): Promise<AccountAiCollaborationProfile | undefined>;
  upsert(
    accountId: AccountId,
    profile: AccountAiCollaborationProfile,
    expectedVersion: number | undefined
  ): Promise<UpsertAccountAiCollaborationProfileOutcome>;
}

export interface ProjectAgentInstructionsRepository {
  get(projectId: ProjectId): Promise<ProjectAgentInstructions | undefined>;
  upsert(
    instructions: ProjectAgentInstructions,
    expectedVersion: number | undefined
  ): Promise<UpsertProjectAgentInstructionsOutcome>;
}

export interface ProjectPlaybookRepository {
  get(playbookId: PlaybookId): Promise<ProjectPlaybook | undefined>;
  listByProject(
    projectId: ProjectId,
    options?: AgentGuidanceListOptions
  ): Promise<readonly ProjectPlaybook[]>;
  create(playbook: ProjectPlaybook): Promise<UpsertProjectPlaybookOutcome>;
  update(
    playbook: ProjectPlaybook,
    expectedVersion: number
  ): Promise<UpsertProjectPlaybookOutcome>;
}
