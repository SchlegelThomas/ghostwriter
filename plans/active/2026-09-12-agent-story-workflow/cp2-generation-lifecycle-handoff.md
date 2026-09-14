# CP2 scene generation lifecycle handoff

## Delivered

The scene workflow now has a complete generation lifecycle around the existing `scene-draft-v1` compiler and shared repository executor.

- `createSceneStoryWorkGenerationServices` fingerprints the exact account, project, assignment, attempt kind, source mode, instruction, and prior pointer before replay lookup. An exact retry returns the durable prior attempt without another provider call.
- Initial attempts use `submitted-snapshot` and the byte-exact original brief. Revision attempts use `latest-authorized`, an exact current artifact pointer, and the exact writer revision instruction. The compiler retains the immutable submitted assignment sources while its new receipt records the selected latest authorized resource revisions.
- Provider execution remains outside repository transactions. Typed provider failures persist one terminal run/assignment outcome and do not retry.
- Ready completion persists the immutable `scene-draft-v1` proposal and advances attempt, run, `latestAttemptId`, `generatedArtifact`, and `currentArtifact` through the shared atomic lifecycle.
- The repository policy accepts only `scene/create` and `revise/update` assignment/destination pairs. It pins `story-work.scene`, `scene-draft-v1`, the assignment scene ID, receipt `primaryTarget`, receipt `targetSceneId`, and proposal primary target.
- Memory and PostgreSQL wrappers retain the same participant rollback and assignment/attempt/run locking order as the character lifecycle.

No scene apply, API, runtime, UI, provider adapter, or schema behavior was added in this slice.

## Files

- `packages/core/src/scene-story-work-generation-uow.ts`
- `packages/core/src/scene-story-work-generation-repository-uow.ts`
- `packages/core/src/memory-scene-story-work-generation-uow.ts`
- `packages/core/src/scene-story-work-generation-services.ts`
- `packages/core/src/scene-story-work-generation-services.test.ts`
- `packages/storage/src/postgres-scene-story-work-generation-uow.ts`
- `packages/storage/src/postgres-scene-story-work-generation-uow.test.ts`
- additive exports in `packages/core/src/index.ts` and `packages/storage/src/index.ts`

## Verification

- `pnpm exec vitest run packages/core/src/scene-story-work-generation-services.test.ts packages/core/src/character-story-work-generation-services.test.ts packages/storage/src/postgres-scene-story-work-generation-uow.test.ts packages/storage/src/postgres-character-story-work-generation-uow.test.ts` — 4 files and 23 tests passed.
- Targeted ESLint over all new generation source/test files and both indexes — passed.
- `pnpm --filter @ghostwriter/storage typecheck` — passed.
- `pnpm --filter @ghostwriter/core typecheck` passed before concurrent apply-policy work changed, then was blocked outside this slice by `packages/core/src/story-work-apply-validation.ts:193,199` (`currentStructure` possibly undefined). Generation-focused compilation and tests remain green; rerun the core typecheck after that concurrent narrowing fix.

No provider call, browser session, or Playwright run was performed.
