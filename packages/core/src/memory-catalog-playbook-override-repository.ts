import {
  createCatalogPlaybookOverride,
  type CatalogPlaybookOverride,
  type CatalogPlaybookOverrideRepository,
  type DeleteCatalogPlaybookOverrideOutcome,
  type UpsertCatalogPlaybookOverrideOutcome
} from "./catalog-playbook-overrides.js";
import type { ProjectId } from "./domain.js";

function key(projectId: ProjectId, agentId: string): string {
  return `${projectId}\u0000${agentId}`;
}

function clone(value: CatalogPlaybookOverride): CatalogPlaybookOverride {
  return createCatalogPlaybookOverride(value);
}

export function createMemoryCatalogPlaybookOverrideRepository(): CatalogPlaybookOverrideRepository {
  const values = new Map<string, CatalogPlaybookOverride>();
  let writeTail: Promise<void> = Promise.resolve();
  async function serialize<Result>(
    operation: () => Result | Promise<Result>
  ): Promise<Result> {
    const previous = writeTail;
    let release = (): void => undefined;
    writeTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
  const repository: CatalogPlaybookOverrideRepository = {
    async get(projectId, agentId) {
      const value = values.get(key(projectId, agentId));
      return value === undefined ? undefined : clone(value);
    },
    async listByProject(projectId) {
      return Object.freeze(
        [...values.values()]
          .filter((value) => value.projectId === projectId)
          .sort((left, right) => left.agentId.localeCompare(right.agentId))
          .map(clone)
      );
    },
    upsert(value, expectedVersion) {
      return serialize((): UpsertCatalogPlaybookOverrideOutcome => {
        const storageKey = key(value.projectId, value.agentId);
        const existing = values.get(storageKey);
        if (
          (existing === undefined && expectedVersion !== undefined) ||
          (existing !== undefined &&
            (expectedVersion === undefined || existing.version !== expectedVersion))
        ) {
          return { ok: false, reason: "conflict" };
        }
        const stored = clone(value);
        values.set(storageKey, stored);
        return { ok: true, override: clone(stored) };
      });
    },
    delete(projectId, agentId, expectedVersion) {
      return serialize((): DeleteCatalogPlaybookOverrideOutcome => {
        const storageKey = key(projectId, agentId);
        const existing = values.get(storageKey);
        if (existing === undefined) return { ok: true, deleted: false };
        if (existing.version !== expectedVersion) {
          return { ok: false, reason: "conflict" };
        }
        values.delete(storageKey);
        return { ok: true, deleted: true };
      });
    }
  };
  return Object.freeze(repository);
}
