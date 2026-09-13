import {
  STORY_WORK_COORDINATION_LIST_MAX,
  DomainValidationError,
  accountId,
  canonicalJsonStringify,
  assertStoryWorkCoordinationOriginImmutable,
  createStoryWorkCoordination,
  instructionContentHash,
  projectId,
  storyWorkAssignmentId,
  storyWorkCoordinationDefinitionFingerprint,
  storyWorkCoordinationRequestFingerprint,
  storyWorkCoordinationStepId,
  mcpGrantId,
  type CompareAndSetStoryWorkCoordinationOutcome,
  type CreateStoryWorkCoordinationOutcome,
  type InstructionContentHash,
  type ProposalContinuityCheckDeferredConfig,
  type StoryWorkCoordination,
  type StoryWorkCoordinationStepBinding,
  type StoryWorkCoordinationStepDefinition,
  type StoryWorkCoordinationStepDependency
} from "@ghostwriter/core";
import { and, desc, eq } from "drizzle-orm";
import type { RepositoryDatabase } from "./client.js";
import {
  storyWorkCoordinationStepBindings,
  storyWorkCoordinations
} from "./schema.js";

function coordinationOriginFromRow(
  row: typeof storyWorkCoordinations.$inferSelect
): StoryWorkCoordination["origin"] {
  if (row.originKind === null && row.originMcpGrantId === null) {
    return undefined;
  }
  return Object.freeze({
    kind: "mcp" as const,
    grantId: mcpGrantId(row.originMcpGrantId!)
  });
}

function coordinationOriginToRow(
  origin: StoryWorkCoordination["origin"]
): Pick<
  typeof storyWorkCoordinations.$inferInsert,
  "originKind" | "originMcpGrantId"
> {
  if (origin === undefined) {
    return { originKind: null, originMcpGrantId: null };
  }
  return {
    originKind: origin.kind,
    originMcpGrantId: origin.grantId
  };
}

const STORED_COORDINATION_INVALID = "Stored story work coordination is invalid.";

function postgresErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (
      typeof current === "object" &&
      current !== null &&
      "code" in current &&
      typeof (current as { code: unknown }).code === "string"
    ) {
      return (current as { code: string }).code;
    }
    current =
      typeof current === "object" && current !== null && "cause" in current
        ? (current as { cause: unknown }).cause
        : undefined;
    if (current === undefined) break;
  }
  return undefined;
}

async function resolveCreateConflict(
  exec: RepositoryDatabase,
  coordination: StoryWorkCoordination,
  fingerprint: InstructionContentHash
): Promise<CreateStoryWorkCoordinationOutcome> {
  const [existingByKey] = await exec
    .select()
    .from(storyWorkCoordinations)
    .where(
      and(
        eq(storyWorkCoordinations.projectId, coordination.projectId),
        eq(storyWorkCoordinations.initiatorAccountId, coordination.initiatorAccountId),
        eq(storyWorkCoordinations.idempotencyKey, coordination.idempotencyKey)
      )
    )
    .limit(1);
  if (existingByKey !== undefined) {
    const bindings = await loadBindingRows(exec, existingByKey.id);
    return instructionContentHash(existingByKey.requestFingerprint) === fingerprint
      ? {
          ok: true,
          coordination: coordinationFromRow(existingByKey, bindings),
          created: false
        }
      : { ok: false, reason: "idempotency-conflict" };
  }
  const [existingById] = await exec
    .select({ id: storyWorkCoordinations.id })
    .from(storyWorkCoordinations)
    .where(eq(storyWorkCoordinations.id, coordination.id))
    .limit(1);
  if (existingById !== undefined) {
    return { ok: false, reason: "duplicate-id" };
  }
  throw new Error("Story work coordination create failed without a resolvable conflict.");
}

type CoordinationGetInput = Parameters<
  import("@ghostwriter/core").StoryWorkCoordinationRepository["get"]
>[0];
type CoordinationIdempotencyInput = Parameters<
  import("@ghostwriter/core").StoryWorkCoordinationRepository["getByIdempotencyKey"]
>[0];
type CoordinationListInput = Parameters<
  import("@ghostwriter/core").StoryWorkCoordinationRepository["listByProject"]
>[0];
type CoordinationOriginListInput = Parameters<
  import("@ghostwriter/core").StoryWorkCoordinationRepository["listByMcpGrantOrigin"]
>[0];
type CoordinationCreateInput = Parameters<
  import("@ghostwriter/core").StoryWorkCoordinationRepository["create"]
>[0];
type CoordinationCompareAndSetInput = Parameters<
  import("@ghostwriter/core").StoryWorkCoordinationRepository["compareAndSet"]
>[0];

type StoredStepDefinition =
  | Readonly<{
      kind: "scene-draft";
      stepId: string;
      title: string;
    }>
  | Readonly<{
      kind: "proposal-continuity-check";
      stepId: string;
      title: string;
      dependencies: readonly [StoryWorkCoordinationStepDependency];
      deferred: ProposalContinuityCheckDeferredConfig;
    }>;

function boundedLimit(value: number | undefined): number {
  if (value === undefined) return STORY_WORK_COORDINATION_LIST_MAX;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new DomainValidationError(
      "INVALID_VERSION",
      "Story work coordination list limit must be a positive integer."
    );
  }
  return Math.min(value, STORY_WORK_COORDINATION_LIST_MAX);
}

function stepDefinitionToStored(
  step: StoryWorkCoordinationStepDefinition
): StoredStepDefinition {
  if (step.kind === "scene-draft") {
    return Object.freeze({
      kind: step.kind,
      stepId: step.stepId,
      title: step.title
    });
  }
  return Object.freeze({
    kind: step.kind,
    stepId: step.stepId,
    title: step.title,
    dependencies: step.dependencies,
    deferred: step.deferred
  });
}

function bindingFromRow(
  row: typeof storyWorkCoordinationStepBindings.$inferSelect
): StoryWorkCoordinationStepBinding | undefined {
  if (row.resolvedDependency === null) {
    return undefined;
  }
  const dependency = row.resolvedDependency as StoryWorkCoordinationStepBinding["resolvedDependency"];
  return Object.freeze({
    assignmentId: storyWorkAssignmentId(row.assignmentId),
    resolvedDependency: dependency,
    boundAt: row.boundAt
  });
}

function mergeStepDefinition(
  stored: StoredStepDefinition,
  bindingRow: typeof storyWorkCoordinationStepBindings.$inferSelect | undefined
): StoryWorkCoordinationStepDefinition {
  if (stored.kind === "scene-draft") {
    return Object.freeze({
      kind: stored.kind,
      stepId: storyWorkCoordinationStepId(stored.stepId),
      title: stored.title,
      assignmentId: storyWorkAssignmentId(bindingRow!.assignmentId)
    });
  }
  const binding = bindingRow === undefined ? undefined : bindingFromRow(bindingRow);
  return Object.freeze({
    kind: stored.kind,
    stepId: storyWorkCoordinationStepId(stored.stepId),
    title: stored.title,
    dependencies: stored.dependencies,
    deferred: stored.deferred,
    ...(binding === undefined ? {} : { binding })
  });
}

function coordinationFromRow(
  row: typeof storyWorkCoordinations.$inferSelect,
  bindingRows: readonly (typeof storyWorkCoordinationStepBindings.$inferSelect)[]
): StoryWorkCoordination {
  try {
    const storedSteps = row.stepDefinitions as readonly StoredStepDefinition[];
    const bindingsByStepId = new Map(
      bindingRows.map((binding) => [binding.stepId, binding] as const)
    );
    const steps = storedSteps.map((stored) => {
      const bindingRow = bindingsByStepId.get(stored.stepId);
      if (stored.kind === "scene-draft" && bindingRow === undefined) {
        throw new Error(STORED_COORDINATION_INVALID);
      }
      return mergeStepDefinition(stored, bindingRow);
    });
    const origin = coordinationOriginFromRow(row);
    return createStoryWorkCoordination({
      id: row.id as StoryWorkCoordination["id"],
      projectId: projectId(row.projectId),
      initiatorAccountId: accountId(row.initiatorAccountId),
      version: row.version,
      title: row.title,
      status: row.status as StoryWorkCoordination["status"],
      steps,
      idempotencyKey: row.idempotencyKey,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      ...(origin === undefined ? {} : { origin })
    });
  } catch (error) {
    if (error instanceof Error && error.message === STORED_COORDINATION_INVALID) {
      throw error;
    }
    throw new Error(STORED_COORDINATION_INVALID, { cause: error });
  }
}

function coordinationToRow(
  coordination: StoryWorkCoordination,
  requestFingerprint: InstructionContentHash
): typeof storyWorkCoordinations.$inferInsert {
  const candidate = createStoryWorkCoordination(coordination);
  return {
    id: candidate.id,
    projectId: candidate.projectId,
    initiatorAccountId: candidate.initiatorAccountId,
    version: candidate.version,
    title: candidate.title,
    status: candidate.status,
    stepDefinitions: candidate.steps.map(stepDefinitionToStored),
    idempotencyKey: candidate.idempotencyKey,
    requestFingerprint: storyWorkCoordinationRequestFingerprint(requestFingerprint),
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt,
    ...coordinationOriginToRow(candidate.origin)
  };
}

function rootSceneDraftBinding(
  coordination: StoryWorkCoordination
): typeof storyWorkCoordinationStepBindings.$inferInsert {
  const root = coordination.steps.find((step) => step.kind === "scene-draft");
  if (root === undefined || root.kind !== "scene-draft") {
    throw new Error(STORED_COORDINATION_INVALID);
  }
  return {
    coordinationId: coordination.id,
    stepId: root.stepId,
    assignmentId: root.assignmentId,
    resolvedDependency: null,
    boundAt: coordination.createdAt
  };
}

function checkStepBindingInsert(
  coordination: StoryWorkCoordination,
  stepId: string,
  binding: StoryWorkCoordinationStepBinding
): typeof storyWorkCoordinationStepBindings.$inferInsert {
  return {
    coordinationId: coordination.id,
    stepId,
    assignmentId: binding.assignmentId,
    resolvedDependency: binding.resolvedDependency,
    boundAt: binding.boundAt
  };
}

function stepBindings(coordination: StoryWorkCoordination): readonly string[] {
  return coordination.steps.map((step) =>
    step.kind === "proposal-continuity-check" && step.binding !== undefined
      ? canonicalJsonStringify(step.binding)
      : ""
  );
}

function casTransitionPermitted(
  previous: StoryWorkCoordination,
  next: StoryWorkCoordination
): boolean {
  const previousBindings = stepBindings(previous);
  const nextBindings = stepBindings(next);
  for (let index = 0; index < previousBindings.length; index += 1) {
    const prior = previousBindings[index]!;
    const updated = nextBindings[index]!;
    if (prior.length > 0 && prior !== updated) {
      return false;
    }
    if (prior.length > 0 && updated.length === 0) {
      return false;
    }
  }
  const addedBindings = nextBindings.filter((binding, index) => {
    return binding.length > 0 && previousBindings[index]!.length === 0;
  }).length;
  if (addedBindings > 1) {
    return false;
  }
  if (previous.status === "canceled") {
    return next.status === "canceled" && addedBindings === 0;
  }
  if (next.status === "canceled") {
    return previous.status === "active" && addedBindings === 0;
  }
  if (next.status !== previous.status) {
    return false;
  }
  if (addedBindings === 1 && previous.status !== "active") {
    return false;
  }
  return true;
}

function addedCheckBindingStep(
  previous: StoryWorkCoordination,
  next: StoryWorkCoordination
): Readonly<{ stepId: string; binding: StoryWorkCoordinationStepBinding }> | undefined {
  const previousBindings = stepBindings(previous);
  const nextBindings = stepBindings(next);
  let found: Readonly<{ stepId: string; binding: StoryWorkCoordinationStepBinding }> | undefined;
  for (let index = 0; index < previousBindings.length; index += 1) {
    if (previousBindings[index]!.length > 0 || nextBindings[index]!.length === 0) {
      continue;
    }
    const step = next.steps[index]!;
    if (step.kind !== "proposal-continuity-check" || step.binding === undefined) {
      return undefined;
    }
    if (found !== undefined) {
      return undefined;
    }
    found = Object.freeze({ stepId: step.stepId, binding: step.binding });
  }
  return found;
}

async function loadScopedCoordinationRow(
  db: RepositoryDatabase,
  input: Readonly<{
    accountId: CoordinationGetInput["accountId"];
    projectId: CoordinationGetInput["projectId"];
    coordinationId: CoordinationGetInput["coordinationId"];
  }>
) {
  const [row] = await db
    .select()
    .from(storyWorkCoordinations)
    .where(
      and(
        eq(storyWorkCoordinations.id, input.coordinationId),
        eq(storyWorkCoordinations.projectId, input.projectId),
        eq(storyWorkCoordinations.initiatorAccountId, input.accountId)
      )
    )
    .limit(1);
  return row;
}

async function loadBindingRows(db: RepositoryDatabase, coordinationId: string) {
  return db
    .select()
    .from(storyWorkCoordinationStepBindings)
    .where(eq(storyWorkCoordinationStepBindings.coordinationId, coordinationId));
}

async function loadScopedCoordination(
  db: RepositoryDatabase,
  input: Readonly<{
    accountId: CoordinationGetInput["accountId"];
    projectId: CoordinationGetInput["projectId"];
    coordinationId: CoordinationGetInput["coordinationId"];
  }>
): Promise<StoryWorkCoordination | undefined> {
  const row = await loadScopedCoordinationRow(db, input);
  if (row === undefined) return undefined;
  const bindings = await loadBindingRows(db, row.id);
  return coordinationFromRow(row, bindings);
}

export function createPostgresStoryWorkCoordinationRepository(
  db: RepositoryDatabase
): import("@ghostwriter/core").StoryWorkCoordinationRepository {
  return Object.freeze({
    async get(input: CoordinationGetInput) {
      return loadScopedCoordination(db, input);
    },

    async getByIdempotencyKey(input: CoordinationIdempotencyInput) {
      const [row] = await db
        .select()
        .from(storyWorkCoordinations)
        .where(
          and(
            eq(storyWorkCoordinations.projectId, input.projectId),
            eq(storyWorkCoordinations.initiatorAccountId, input.accountId),
            eq(storyWorkCoordinations.idempotencyKey, input.idempotencyKey)
          )
        )
        .limit(1);
      if (row === undefined) return undefined;
      const bindings = await loadBindingRows(db, row.id);
      return Object.freeze({
        coordination: coordinationFromRow(row, bindings),
        requestFingerprint: instructionContentHash(row.requestFingerprint)
      });
    },

    async listByProject(input: CoordinationListInput) {
      const limit = boundedLimit(input.options?.limit);
      const rows = await db
        .select()
        .from(storyWorkCoordinations)
        .where(
          and(
            eq(storyWorkCoordinations.projectId, input.projectId),
            eq(storyWorkCoordinations.initiatorAccountId, input.accountId)
          )
        )
        .orderBy(
          desc(storyWorkCoordinations.updatedAt),
          desc(storyWorkCoordinations.id)
        )
        .limit(limit);
      return Object.freeze(
        await Promise.all(
          rows.map(async (row) => {
            const bindings = await loadBindingRows(db, row.id);
            return coordinationFromRow(row, bindings);
          })
        )
      );
    },

    async listByMcpGrantOrigin(input: CoordinationOriginListInput) {
      const limit = boundedLimit(input.options?.limit);
      const rows = await db
        .select()
        .from(storyWorkCoordinations)
        .where(
          and(
            eq(storyWorkCoordinations.originMcpGrantId, input.originMcpGrantId),
            eq(storyWorkCoordinations.projectId, input.projectId),
            eq(storyWorkCoordinations.initiatorAccountId, input.accountId)
          )
        )
        .orderBy(
          desc(storyWorkCoordinations.updatedAt),
          desc(storyWorkCoordinations.id)
        )
        .limit(limit);
      return Object.freeze(
        await Promise.all(
          rows.map(async (row) => {
            const bindings = await loadBindingRows(db, row.id);
            return coordinationFromRow(row, bindings);
          })
        )
      );
    },

    async create(
      input: CoordinationCreateInput
    ): Promise<CreateStoryWorkCoordinationOutcome> {
      const coordination = createStoryWorkCoordination(input.coordination);
      const fingerprint = storyWorkCoordinationRequestFingerprint(
        input.requestFingerprint
      );
      try {
        return await db.transaction(async (transaction) => {
          const exec = transaction as unknown as RepositoryDatabase;
          const [existingByKey] = await exec
            .select()
            .from(storyWorkCoordinations)
            .where(
              and(
                eq(storyWorkCoordinations.projectId, coordination.projectId),
                eq(
                  storyWorkCoordinations.initiatorAccountId,
                  coordination.initiatorAccountId
                ),
                eq(storyWorkCoordinations.idempotencyKey, coordination.idempotencyKey)
              )
            )
            .limit(1);
          if (existingByKey !== undefined) {
            const bindings = await loadBindingRows(exec, existingByKey.id);
            return instructionContentHash(existingByKey.requestFingerprint) === fingerprint
              ? {
                  ok: true,
                  coordination: coordinationFromRow(existingByKey, bindings),
                  created: false
                }
              : { ok: false, reason: "idempotency-conflict" };
          }
          const [existingById] = await exec
            .select({ id: storyWorkCoordinations.id })
            .from(storyWorkCoordinations)
            .where(eq(storyWorkCoordinations.id, coordination.id))
            .limit(1);
          if (existingById !== undefined) {
            return { ok: false, reason: "duplicate-id" };
          }
          await exec
            .insert(storyWorkCoordinations)
            .values(coordinationToRow(coordination, fingerprint));
          const rootBinding = rootSceneDraftBinding(coordination);
          await exec.insert(storyWorkCoordinationStepBindings).values(rootBinding);
          const reloaded = await loadScopedCoordination(exec, {
            accountId: coordination.initiatorAccountId,
            projectId: coordination.projectId,
            coordinationId: coordination.id
          });
          if (reloaded === undefined) {
            throw new Error(STORED_COORDINATION_INVALID);
          }
          return {
            ok: true,
            coordination: reloaded,
            created: true
          };
        });
      } catch (error) {
        if (postgresErrorCode(error) !== "23505") {
          throw error;
        }
        return resolveCreateConflict(db, coordination, fingerprint);
      }
    },

    async compareAndSet(
      input: CoordinationCompareAndSetInput
    ): Promise<CompareAndSetStoryWorkCoordinationOutcome> {
      return db.transaction(async (transaction) => {
        const exec = transaction as unknown as RepositoryDatabase;
        await exec
          .select({ id: storyWorkCoordinations.id })
          .from(storyWorkCoordinations)
          .where(
            and(
              eq(storyWorkCoordinations.id, input.coordinationId),
              eq(storyWorkCoordinations.projectId, input.projectId),
              eq(storyWorkCoordinations.initiatorAccountId, input.accountId)
            )
          )
          .for("update");
        const row = await loadScopedCoordinationRow(exec, input);
        if (row === undefined) {
          return { ok: false, reason: "not-found" };
        }
        const bindingRows = await loadBindingRows(exec, row.id);
        const current = coordinationFromRow(row, bindingRows);
        if (current.version !== input.expectedVersion) {
          return { ok: false, reason: "version-conflict" };
        }
        let next: StoryWorkCoordination;
        try {
          next = createStoryWorkCoordination(input.next);
        } catch {
          return { ok: false, reason: "version-conflict" };
        }
        try {
          assertStoryWorkCoordinationOriginImmutable(current, next);
        } catch {
          return { ok: false, reason: "version-conflict" };
        }
        if (
          next.id !== current.id ||
          next.projectId !== current.projectId ||
          next.initiatorAccountId !== current.initiatorAccountId ||
          next.idempotencyKey !== current.idempotencyKey ||
          next.createdAt !== current.createdAt ||
          next.version !== current.version + 1 ||
          storyWorkCoordinationDefinitionFingerprint(next) !==
            storyWorkCoordinationDefinitionFingerprint(current)
        ) {
          return { ok: false, reason: "version-conflict" };
        }
        if (!casTransitionPermitted(current, next)) {
          return { ok: false, reason: "version-conflict" };
        }
        const addedBinding = addedCheckBindingStep(current, next);
        if (addedBinding !== undefined) {
          await exec.insert(storyWorkCoordinationStepBindings).values(
            checkStepBindingInsert(next, addedBinding.stepId, addedBinding.binding)
          );
        }
        const [updated] = await exec
          .update(storyWorkCoordinations)
          .set({
            version: next.version,
            status: next.status,
            updatedAt: next.updatedAt
          })
          .where(
            and(
              eq(storyWorkCoordinations.id, current.id),
              eq(storyWorkCoordinations.projectId, current.projectId),
              eq(storyWorkCoordinations.initiatorAccountId, current.initiatorAccountId),
              eq(storyWorkCoordinations.version, input.expectedVersion)
            )
          )
          .returning();
        if (updated === undefined) {
          return { ok: false, reason: "version-conflict" };
        }
        const nextBindings = await loadBindingRows(exec, updated.id);
        return {
          ok: true,
          coordination: coordinationFromRow(updated, nextBindings)
        };
      });
    }
  });
}
