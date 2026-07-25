import {
  createAccountAiCollaborationProfile,
  createProjectAgentInstructions,
  createProjectPlaybook,
  type AccountAiCollaborationProfile,
  type ProjectAgentInstructions,
  type ProjectPlaybook
} from "./agent-domain.js";
import type {
  AccountAiCollaborationProfileRepository,
  AgentGuidanceListOptions,
  ProjectAgentInstructionsRepository,
  ProjectPlaybookRepository,
  UpsertAccountAiCollaborationProfileOutcome,
  UpsertProjectAgentInstructionsOutcome,
  UpsertProjectPlaybookOutcome
} from "./agent-guidance-repository.js";
import { normalizeAgentFoundationListLimit } from "./agent-runs-proposals.js";
import type { PlaybookId, ProjectId } from "./domain.js";
import type { AccountId } from "./identity.js";
import {
  MEMORY_TRANSACTION_STATE,
  type MemoryTransactionalRepository
} from "./memory-transaction.js";

type MemoryCollaborationProfileState = {
  profiles: Map<string, AccountAiCollaborationProfile>;
};

type MemoryProjectInstructionsState = {
  instructions: Map<string, ProjectAgentInstructions>;
};

type MemoryPlaybookState = {
  playbooks: Map<string, ProjectPlaybook>;
};

function accountKey(accountId: AccountId): string {
  return String(accountId);
}

function projectKey(projectId: ProjectId): string {
  return String(projectId);
}

function cloneProfile(profile: AccountAiCollaborationProfile): AccountAiCollaborationProfile {
  return createAccountAiCollaborationProfile(profile);
}

function cloneInstructions(
  instructions: ProjectAgentInstructions
): ProjectAgentInstructions {
  return createProjectAgentInstructions(instructions);
}

function clonePlaybook(playbook: ProjectPlaybook): ProjectPlaybook {
  return createProjectPlaybook(playbook);
}

function sortPlaybooks(values: readonly ProjectPlaybook[]): readonly ProjectPlaybook[] {
  return Object.freeze(
    [...values].sort(
      (left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id)
    )
  );
}

function createSerializedWrite() {
  let writeTail: Promise<void> = Promise.resolve();
  return async function serializeWrite<Result>(
    operation: () => Result | Promise<Result>
  ): Promise<Result> {
    const previousWrite = writeTail;
    let release = (): void => undefined;
    writeTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previousWrite;
    try {
      return await operation();
    } finally {
      release();
    }
  };
}

export function createMemoryAccountAiCollaborationProfileRepository(): AccountAiCollaborationProfileRepository &
  MemoryTransactionalRepository {
  let state: MemoryCollaborationProfileState = { profiles: new Map() };
  const serializeWrite = createSerializedWrite();

  const repository: AccountAiCollaborationProfileRepository &
    MemoryTransactionalRepository = {
    async get(accountId) {
      const profile = state.profiles.get(accountKey(accountId));
      return profile === undefined ? undefined : cloneProfile(profile);
    },
    upsert(accountId, profile, expectedVersion) {
      return serializeWrite((): UpsertAccountAiCollaborationProfileOutcome => {
        const key = accountKey(accountId);
        const existing = state.profiles.get(key);
        const stored = cloneProfile(profile);
        if (existing === undefined) {
          if (expectedVersion !== undefined) {
            return { ok: false, reason: "conflict" };
          }
          state.profiles.set(key, stored);
          return { ok: true, profile: cloneProfile(stored) };
        }
        if (expectedVersion === undefined || existing.version !== expectedVersion) {
          return { ok: false, reason: "conflict" };
        }
        state.profiles.set(key, stored);
        return { ok: true, profile: cloneProfile(stored) };
      });
    },
    [MEMORY_TRANSACTION_STATE]: {
      snapshot(): MemoryCollaborationProfileState {
        return {
          profiles: new Map(
            [...state.profiles.entries()].map(([key, profile]) => [key, cloneProfile(profile)])
          )
        };
      },
      restore(snapshot: unknown): void {
        const next = snapshot as MemoryCollaborationProfileState;
        state = {
          profiles: new Map(
            [...next.profiles.entries()].map(([key, profile]) => [key, cloneProfile(profile)])
          )
        };
      }
    }
  };

  return repository;
}

export function createMemoryProjectAgentInstructionsRepository(): ProjectAgentInstructionsRepository &
  MemoryTransactionalRepository {
  let state: MemoryProjectInstructionsState = { instructions: new Map() };
  const serializeWrite = createSerializedWrite();

  const repository: ProjectAgentInstructionsRepository & MemoryTransactionalRepository = {
    async get(projectId) {
      const instructions = state.instructions.get(projectKey(projectId));
      return instructions === undefined ? undefined : cloneInstructions(instructions);
    },
    upsert(instructions, expectedVersion) {
      return serializeWrite((): UpsertProjectAgentInstructionsOutcome => {
        const key = projectKey(instructions.projectId);
        const existing = state.instructions.get(key);
        const stored = cloneInstructions(instructions);
        if (existing === undefined) {
          if (expectedVersion !== undefined) {
            return { ok: false, reason: "conflict" };
          }
          state.instructions.set(key, stored);
          return { ok: true, instructions: cloneInstructions(stored) };
        }
        if (expectedVersion === undefined || existing.version !== expectedVersion) {
          return { ok: false, reason: "conflict" };
        }
        state.instructions.set(key, stored);
        return { ok: true, instructions: cloneInstructions(stored) };
      });
    },
    [MEMORY_TRANSACTION_STATE]: {
      snapshot(): MemoryProjectInstructionsState {
        return {
          instructions: new Map(
            [...state.instructions.entries()].map(([key, value]) => [
              key,
              cloneInstructions(value)
            ])
          )
        };
      },
      restore(snapshot: unknown): void {
        const next = snapshot as MemoryProjectInstructionsState;
        state = {
          instructions: new Map(
            [...next.instructions.entries()].map(([key, value]) => [
              key,
              cloneInstructions(value)
            ])
          )
        };
      }
    }
  };

  return repository;
}

export function createMemoryProjectPlaybookRepository(): ProjectPlaybookRepository &
  MemoryTransactionalRepository {
  let state: MemoryPlaybookState = { playbooks: new Map() };
  const serializeWrite = createSerializedWrite();

  const repository: ProjectPlaybookRepository & MemoryTransactionalRepository = {
    async get(playbookIdValue: PlaybookId) {
      const playbook = state.playbooks.get(String(playbookIdValue));
      return playbook === undefined ? undefined : clonePlaybook(playbook);
    },
    async listByProject(projectId, options: AgentGuidanceListOptions = {}) {
      const limit = normalizeAgentFoundationListLimit(options.limit);
      const includeArchived = options.includeArchived ?? false;
      const matches = [...state.playbooks.values()].filter((playbook) => {
        if (playbook.projectId !== projectId) return false;
        if (!includeArchived && playbook.archivedAt !== undefined) return false;
        return true;
      });
      return sortPlaybooks(matches).slice(0, limit).map(clonePlaybook);
    },
    create(playbook) {
      return serializeWrite((): UpsertProjectPlaybookOutcome => {
        const key = String(playbook.id);
        if (state.playbooks.has(key)) {
          return { ok: false, reason: "conflict" };
        }
        const stored = clonePlaybook(playbook);
        state.playbooks.set(key, stored);
        return { ok: true, playbook: clonePlaybook(stored) };
      });
    },
    update(playbook, expectedVersion) {
      return serializeWrite((): UpsertProjectPlaybookOutcome => {
        const key = String(playbook.id);
        const existing = state.playbooks.get(key);
        if (existing === undefined) {
          return { ok: false, reason: "not-found" };
        }
        if (existing.version !== expectedVersion) {
          return { ok: false, reason: "conflict" };
        }
        const stored = clonePlaybook(playbook);
        state.playbooks.set(key, stored);
        return { ok: true, playbook: clonePlaybook(stored) };
      });
    },
    [MEMORY_TRANSACTION_STATE]: {
      snapshot(): MemoryPlaybookState {
        return {
          playbooks: new Map(
            [...state.playbooks.entries()].map(([key, value]) => [key, clonePlaybook(value)])
          )
        };
      },
      restore(snapshot: unknown): void {
        const next = snapshot as MemoryPlaybookState;
        state = {
          playbooks: new Map(
            [...next.playbooks.entries()].map(([key, value]) => [key, clonePlaybook(value)])
          )
        };
      }
    }
  };

  return repository;
}
