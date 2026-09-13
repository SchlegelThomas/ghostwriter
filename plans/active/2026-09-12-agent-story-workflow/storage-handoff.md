# CP1b storage handoff

Stable boundary for the hermetic backend restart: `0027_premium_randall.sql` is the sole generated migration after `0026_true_wild_child`. It has not been applied to a production or remote database.

## Outcome

- `StoryWorkAssignment.latestAttemptId` is optional on a new assignment, is set with `activeAttemptId` whenever an attempt starts, and remains after success, failure, cancellation, or stale completion clears the active attempt. Existing artifact pointers remain unchanged when a revision attempt fails. If both active and latest IDs are supplied, they must identify the same run.
- Assignment persistence maps and compare-and-sets `latestAttemptId`. Migration 0027 adds nullable `story_work_assignments.latest_attempt_id` with the same restricted `agent_runs` reference used by the active attempt.
- `StoryWorkAttempt.sourceMode` is persisted as required immutable state. Migration 0027 adds non-null `story_work_attempts.source_mode` and checks `initial/submitted-snapshot` and `revision/latest-authorized` pairs. PostgreSQL row conversion and CAS identity preserve it.
- `StoryWorkAssignmentRepository.getByIdempotencyKey({ accountId, projectId, idempotencyKey })` returns `{ assignment, requestFingerprint } | undefined`. Memory uses its scoped unique-key map. PostgreSQL performs a direct indexed lookup against `(initiator_account_id, project_id, idempotency_key)` with `limit 1`; it does not list or scan assignments. Missing and foreign rows are indistinguishable.
- The existing PostgreSQL assignment/attempt repositories and character generation/review/apply unit-of-work factories remain on the same 0027 schema. The stricter submitted-source fixture now records and consumes the exact selected scene head version/hash.

## Files

Core assignment/repository contract:

- `packages/core/src/story-work-assignment.ts`
- `packages/core/src/story-work-assignment.test.ts`
- `packages/core/src/story-work-assignment-repository.ts`
- `packages/core/src/memory-story-work-assignment-repository.ts`
- `packages/core/src/memory-story-work-assignment-repository.test.ts`

PostgreSQL storage and focused integration coverage:

- `packages/storage/src/schema.ts`
- `packages/storage/src/postgres-story-work-repository.ts`
- `packages/storage/src/postgres-story-work-repository.test.ts`
- `packages/storage/src/postgres-character-story-work-generation-uow.test.ts`
- `packages/storage/src/postgres-character-story-work-uow.test.ts`
- `packages/storage/drizzle/0027_premium_randall.sql`
- `packages/storage/drizzle/meta/0027_snapshot.json`
- `packages/storage/drizzle/meta/_journal.json`

The broader new CP1b storage implementation remains in:

- `packages/storage/src/postgres-character-story-work-generation-uow.ts`
- `packages/storage/src/postgres-character-story-work-review-uow.ts`
- `packages/storage/src/postgres-character-story-work-uow.ts`
- `packages/storage/src/index.ts`

## Verification

- `pnpm vitest run packages/core/src/story-work-assignment.test.ts packages/core/src/memory-story-work-assignment-repository.test.ts packages/core/src/character-story-work-generation-services.test.ts packages/core/src/memory-character-story-work-uow.test.ts packages/storage/src/postgres-story-work-repository.test.ts packages/storage/src/postgres-character-story-work-generation-uow.test.ts packages/storage/src/postgres-character-story-work-uow.test.ts` — 7 files passed, 42 tests passed.
- `pnpm --filter @ghostwriter/core typecheck` — passed.
- `pnpm --filter @ghostwriter/storage typecheck` — passed.
- Targeted ESLint over the owned core/storage files — passed.
- `pnpm --filter @ghostwriter/storage db:generate` — reported no schema changes after generating 0027.
- `git diff --check` — passed.

## Remaining integration

- Backend assignment detail must load the attempt identified by `assignment.latestAttemptId`, including after a failed revision. It must not infer the latest attempt by timestamp or run ID ordering.
- Backend submission must populate exact selected scene `workingVersion` and `contentHash`; initial attempts use `submitted-snapshot`, explicit revisions use `latest-authorized`.
- Restart the disposable backend from an empty database so it applies the regenerated migration filename. Any process that previously applied an earlier uncommitted 0027 variant must discard that disposable database first.
- Parent still owns whole-repository verification and browser acceptance. No full `pnpm verify`, browser run, Playwright run, commit, push, deployment, or production migration was performed in this slice.
