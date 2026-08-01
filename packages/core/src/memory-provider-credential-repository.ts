import type { AccountId } from "./identity.js";
import {
  createProviderCredentialEnvelope,
  type ProviderCredentialEnvelope,
  type ProviderCredentialValidationState,
  type ProviderId
} from "./provider-credentials.js";
import type {
  DeleteProviderCredentialOutcome,
  MarkProviderCredentialValidationOutcome,
  ProviderCredentialRepository,
  UpsertProviderCredentialOutcome
} from "./provider-credential-repository.js";
import {
  MEMORY_TRANSACTION_STATE,
  type MemoryTransactionalRepository
} from "./memory-transaction.js";

type MemoryProviderCredentialState = {
  credentials: Map<string, ProviderCredentialEnvelope>;
};

function credentialKey(accountId: AccountId, providerId: ProviderId): string {
  return `${String(accountId)}|${providerId}`;
}

function cloneEnvelope(envelope: ProviderCredentialEnvelope): ProviderCredentialEnvelope {
  return createProviderCredentialEnvelope(envelope);
}

function cloneMemoryProviderCredentialState(
  state: MemoryProviderCredentialState
): MemoryProviderCredentialState {
  return {
    credentials: new Map(
      [...state.credentials.entries()].map(([key, envelope]) => [
        key,
        cloneEnvelope(envelope)
      ])
    )
  };
}

export function createMemoryProviderCredentialRepository(): ProviderCredentialRepository &
  MemoryTransactionalRepository {
  let state: MemoryProviderCredentialState = { credentials: new Map() };
  let writeTail: Promise<void> = Promise.resolve();

  async function serializeWrite<Result>(
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
  }

  const repository: ProviderCredentialRepository & MemoryTransactionalRepository = {
    async get(accountId, providerId) {
      const envelope = state.credentials.get(credentialKey(accountId, providerId));
      return envelope === undefined ? undefined : cloneEnvelope(envelope);
    },

    async listForAccount(accountId) {
      const prefix = `${String(accountId)}|`;
      return Object.freeze(
        [...state.credentials.entries()]
          .filter(([key]) => key.startsWith(prefix))
          .map(([, envelope]) => cloneEnvelope(envelope))
      );
    },

    upsert(envelope, expectedVersion) {
      return serializeWrite((): UpsertProviderCredentialOutcome => {
        const key = credentialKey(envelope.accountId, envelope.provider);
        const existing = state.credentials.get(key);
        const stored = cloneEnvelope(envelope);
        if (existing === undefined) {
          if (expectedVersion !== undefined) {
            return { ok: false, reason: "conflict" };
          }
          state.credentials.set(key, stored);
          return { ok: true, envelope: cloneEnvelope(stored) };
        }
        if (expectedVersion === undefined || existing.version !== expectedVersion) {
          return { ok: false, reason: "conflict" };
        }
        state.credentials.set(key, stored);
        return { ok: true, envelope: cloneEnvelope(stored) };
      });
    },

    delete(accountId, providerId, expectedVersion) {
      return serializeWrite((): DeleteProviderCredentialOutcome => {
        const key = credentialKey(accountId, providerId);
        const existing = state.credentials.get(key);
        if (existing === undefined) {
          return { ok: false, reason: "not-found" };
        }
        if (existing.version !== expectedVersion) {
          return { ok: false, reason: "conflict" };
        }
        state.credentials.delete(key);
        return { ok: true };
      });
    },

    markValidation(input) {
      return serializeWrite((): MarkProviderCredentialValidationOutcome => {
        const key = credentialKey(input.accountId, input.providerId);
        const existing = state.credentials.get(key);
        if (existing === undefined) {
          return { ok: false, reason: "not-found" };
        }
        if (existing.version !== input.expectedVersion) {
          return { ok: false, reason: "conflict" };
        }
        const { validatedAt: _ignoredValidatedAt, ...rest } = existing;
        const next = createProviderCredentialEnvelope({
          ...rest,
          validationState: input.validationState as ProviderCredentialValidationState,
          updatedAt: input.updatedAt,
          ...(input.validationState === "valid" && input.validatedAt !== undefined
            ? { validatedAt: input.validatedAt }
            : {})
        });
        state.credentials.set(key, next);
        return { ok: true, envelope: cloneEnvelope(next) };
      });
    },

    async listByKekVersion(kekVersion) {
      const normalized = kekVersion.trim();
      return Object.freeze(
        [...state.credentials.values()]
          .filter((envelope) => envelope.kekVersion === normalized)
          .map(cloneEnvelope)
      );
    },

    deleteByKekVersion(kekVersion) {
      return serializeWrite(() => {
        const normalized = kekVersion.trim();
        let deleted = 0;
        for (const [key, envelope] of state.credentials.entries()) {
          if (envelope.kekVersion === normalized) {
            state.credentials.delete(key);
            deleted += 1;
          }
        }
        return deleted;
      });
    },

    [MEMORY_TRANSACTION_STATE]: {
      snapshot(): MemoryProviderCredentialState {
        return cloneMemoryProviderCredentialState(state);
      },
      restore(snapshot: unknown): void {
        state = cloneMemoryProviderCredentialState(snapshot as MemoryProviderCredentialState);
      }
    }
  };

  return repository;
}
