import type { AccountId } from "./identity.js";
import {
  createOpenAiProviderCredentialEnvelope,
  type OpenAiProviderCredentialEnvelope,
  type ProviderCredentialValidationState
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
  credentials: Map<string, OpenAiProviderCredentialEnvelope>;
};

function accountKey(accountId: AccountId): string {
  return String(accountId);
}

function cloneEnvelope(
  envelope: OpenAiProviderCredentialEnvelope
): OpenAiProviderCredentialEnvelope {
  return createOpenAiProviderCredentialEnvelope(envelope);
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
    async get(accountId) {
      const envelope = state.credentials.get(accountKey(accountId));
      return envelope === undefined ? undefined : cloneEnvelope(envelope);
    },

    upsert(envelope, expectedVersion) {
      return serializeWrite((): UpsertProviderCredentialOutcome => {
        const key = accountKey(envelope.accountId);
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

    delete(accountId, expectedVersion) {
      return serializeWrite((): DeleteProviderCredentialOutcome => {
        const key = accountKey(accountId);
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
        const key = accountKey(input.accountId);
        const existing = state.credentials.get(key);
        if (existing === undefined) {
          return { ok: false, reason: "not-found" };
        }
        if (existing.version !== input.expectedVersion) {
          return { ok: false, reason: "conflict" };
        }
        const { validatedAt: _ignoredValidatedAt, ...rest } = existing;
        const next = createOpenAiProviderCredentialEnvelope({
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
