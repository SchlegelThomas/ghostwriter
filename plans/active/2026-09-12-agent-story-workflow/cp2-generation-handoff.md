# CP2 shared generation repository handoff

## Delivered prerequisite

`packages/core/src/story-work-generation-repository-uow.ts` now owns the schema-independent repository lifecycle for story-work generation. It preserves the existing operation ordering and preconditions for:

- owner-scoped replay lookup and exact request-fingerprint idempotency;
- atomic receipt, queued/running run, attempt, and assignment start;
- atomic ready proposal, completed attempt, ready run, and generated/current assignment lineage;
- atomic failed, canceled, or stale run and assignment completion;
- assignment/attempt/run versions, `sourceMode`, `latestAttemptId`, prior-artifact versioning, and generated/current artifact transitions;
- injected rollback checkpoints used by the memory lifecycle tests.

The shared executor requires a `StoryWorkGenerationRepositoryPolicy` with an exact workflow ID, output schema ID, assignment-to-primary-target resolver, receipt target-ID resolver, and workflow-specific conflict/not-found errors. The executor itself checks exact target equality across the assignment, receipt primary target, receipt schema-specific target field, and proposal. A policy cannot opt out of the shared workflow, schema, project, account, run, receipt, attempt, version, or canonical transition checks.

`packages/core/src/character-story-work-generation-repository-uow.ts` is now a narrow compatibility wrapper. Its exported dependency type, factory name, return interface, diagnostics, and behavior are unchanged. Its policy continues to accept only `story-work.character`, `character-create-v2`, and a reserved `story-knowledge/create` destination whose ID matches both `primaryTarget` and `targetStoryKnowledgeId`.

## Later scene binding

A later scene wrapper can call `createRepositoryStoryWorkGenerationExecutor` with:

- workflow `story-work.scene`;
- schema `scene-draft-v1`;
- an assignment target resolver that accepts exactly the already-approved pairs `scene/create` and `revise/update`, returning the reserved or existing scene primary target;
- `receiptTargetId: receipt => receipt.targetSceneId`;
- scene-specific conflict and hidden-not-found errors.

The wrapper should not duplicate the lifecycle or relax target validation. Memory and PostgreSQL transaction shells can retain their current locking/rollback responsibilities and delegate the state transition mechanics to the shared executor.

The generic module still needs an additive export from `packages/core/src/index.ts`; that file remains with the schema/index owner.

## Files

- Added `packages/core/src/story-work-generation-repository-uow.ts`.
- Reduced `packages/core/src/character-story-work-generation-repository-uow.ts` to the character policy wrapper.
- Extended `packages/core/src/character-story-work-generation-services.test.ts` with wrong-workflow, wrong-schema, and wrong-reserved-target regression coverage that asserts no receipt write.

## Verification

- `pnpm --filter @ghostwriter/core typecheck` — passed.
- `pnpm exec eslint packages/core/src/story-work-generation-repository-uow.ts packages/core/src/character-story-work-generation-repository-uow.ts packages/core/src/character-story-work-generation-services.test.ts` — passed.
- `pnpm exec vitest run packages/core/src/character-story-work-generation-services.test.ts packages/storage/src/postgres-character-story-work-generation-uow.test.ts` — 2 files and 12 tests passed, including begin/completion/failure rollback and exact replay.
- `git diff --check` for the owned source/test files — passed.

The storage package-wide typecheck was also attempted. It is presently blocked by concurrent scene-review work in `packages/storage/src/postgres-scene-story-work-review-uow.test.ts:132`, where `primaryTarget.kind` is inferred as `string`; the failure is outside this extraction.

No provider, browser, or Playwright work was performed.

## Parent integration update
Core index now exports the generic generation module. The concurrent scene-review test annotation was fixed; core/storage typechecks are green. Full repository verification is running in `/tmp/ghostwriter-character-checkpoint-verify.log` (read its final result before treating it as evidence).
