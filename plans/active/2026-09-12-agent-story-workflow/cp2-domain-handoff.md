# CP2 domain prerequisite handoff

## Stable bounded outcome

The pure scene-generation prerequisite is implemented without adding lifecycle, persistence, API, UI, provider-runtime, or canonical apply behavior.

- `packages/core/src/scene-draft-v1.ts` defines the strict `scene-draft-v1` proposal payload. It preserves provisional prose byte-for-byte, bounds prose at 24,000 characters and source scenes at 32, rejects unknown fields and normalized duplicate IDs, and contains no destination or canonical document IDs.
- `packages/core/src/agent-domain.ts` registers `scene-draft-v1` and `story-work.scene` in the existing schema/workflow registries.
- `packages/core/src/agent-runs-proposals.ts` validates the new payload through the shared proposal boundary; `agent-proposal-list-preview.ts` supplies its bounded prose summary.
- `packages/core/src/scene-story-work-compiler.ts` compiles one receipt-bound scene task. It fixes provider/model, schema, token/time/tool budgets, and the server-reserved scene target from the assignment. It consumes exactly one canonical CP1a story-context projection, every selected scene resource exactly once, and at most one exact selected Capture.
- Initial attempts require the assignment's submitted project/scene/Capture versions and hashes. Explicit revisions require `latest-authorized`, preserve the exact current proposal pointer and revision instruction, and may refresh versions/hashes only for the same authorized scene and Capture IDs. Assignment sources remain immutable.
- Completion validation accepts only `scene-draft-v1` with the exact selected source-scene ID set. A model cannot choose or change the destination scene ID.
- `packages/core/src/index.ts` exports the new payload and compiler.

## Focused evidence

- `pnpm exec vitest run packages/core/src/scene-draft-v1.test.ts packages/core/src/scene-story-work-compiler.test.ts` — 2 files, 9 tests passed.
- `pnpm --filter @ghostwriter/core typecheck` — passed.
- ESLint over the two new modules/tests and four touched registry/export files — passed.
- Related registry/proposal/character compiler suite: 4 files, 48 tests passed.
- `pnpm exec vitest run packages/core/src --maxWorkers=2 --teardownTimeout=20000 --hookTimeout=20000 --testTimeout=30000` — all 57 core files, 413 tests passed.

The tests cover strict payload shape and bounds, canonical proposal hashing/preview, exact brief/constraints/done text, CP1a purpose/turn context, reserved create/update target agreement, exact scene and optional Capture consumption, submitted-source mismatches, provider-text tampering, explicit latest-source revisions, immutable assignment source snapshots, unauthorized source IDs, the 32-scene compiler ceiling, and completion refusal for invented source IDs.

## Next bounded slice

Follow `cp2-handoff.md` sequence 1 after this prerequisite:

1. Extract the schema-specific character lifecycle checks behind a parameterized repository generation executor while preserving the character behavior.
2. Add scene generation services and memory/PostgreSQL transaction wrappers around the shared assignment/attempt/run/receipt/proposal repositories. Keep the provider call outside transactions and retain uncertain-response/idempotency replay.
3. Add immutable scene review in a separate slice, followed by the single scene apply transaction. No scene document, project, Canvas, assignment, or proposal mutation exists in this prerequisite.

No provider, database migration, browser, Playwright, or external side effect was used.
