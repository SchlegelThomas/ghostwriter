# CP2 apply foundation handoff

## Stable outcome

Foundation steps 1–2 from `cp2-apply-contract.md` are implemented. No canonical scene apply UOW, backend route, client binding, provider call, or UI behavior is included.

- `StoryWorkResultReference` scene results now support `variantId?: SceneVariantId` and require `revisionId` whenever a variant is recorded.
- `StoryWorkAssignment` now supports paired `applyIdempotencyKey` and `applyRequestFingerprint`. They may be introduced only with an applied transition and cannot be rewritten by memory or PostgreSQL CAS. Legacy/applied character assignments without the pair remain valid.
- `recordAppliedStoryWorkAssignmentFromUnitOfWork` accepts optional apply request identity. The existing character caller remains source compatible and behaviorally unchanged.
- Migration `0028_condemned_rogue.sql` adds the two nullable assignment columns and a paired-null database check. Migration 0027 was not changed.
- Memory and PostgreSQL assignment mappings persist, reload and CAS-fence apply identity.
- `story-work-apply-validation.ts` extracts the immutable assignment/attempt/proposal/run/receipt binding and receipt freshness checks from character apply. Character apply now delegates to it with Capture disabled and its existing public errors/API.
- The shared freshness validator can require the exact assignment scene/Capture source set. Scene mode validates one exact CP1a story-context resource, exact scene heads, active scene records, at most one exact Capture head, and rejects missing, foreign, changed or archived sources. Integrated but unchanged Capture content remains valid historical input and is never mutated.
- `scene-story-work-uow.ts` defines the discriminated `create-scene`, `named-variant`, and `apply-revision` request/result/UOW contracts plus deterministic request fingerprinting. The fingerprint includes all client semantics and excludes the idempotency key, server timestamp and generated canonical IDs. No ID generator is accepted or called.
- The existing-scene contract documents that `leaseHolderId` is server bound. The future backend must derive it from the authenticated editing session and must never accept a caller-selected holder ID as authority.

Required core index exports were sent to the current index owner: `story-work-apply-validation.js` and `scene-story-work-uow.js`.

## Verification

- Core typecheck: passed.
- Storage typecheck: passed.
- Scoped ESLint over all owned core/storage files: passed.
- Foundation focus: 6 files, 35 tests passed.
- Character memory/PostgreSQL parity plus PostgreSQL assignment and scene-generation migration regression: 4 files, 24 tests passed.
- Full core suite: 62 files, 439 tests passed.
- `git diff --check`: passed.

The migration test applies 0028 to the committed 0027-compatible assignment shape, preserves a legacy row with both fields null, and rejects a half-populated pair. Repository tests cover reload, first applied CAS and later identity replacement refusal. Freshness tests cover exact source sets, Capture version/archive/missing behavior and the unchanged character Capture refusal. Fingerprint tests cover all three modes, exact create geometry/placement, mode separation, normalization, changed request semantics and invalid inputs.

## Precise next boundary

The next writer can own only new scene apply policy and memory UOW files/tests:

1. Add `scene-story-work-apply-policy.ts` using `validateStoryWorkApplyBindings`, `validateStoryWorkReceiptFreshness`, `sceneStoryWorkApplyRequestFingerprint`, `sceneDraftDocument`, and the existing assignment applied transition.
2. Implement exact replay from the stored assignment key/fingerprint before freshness checks or any ID allocation. Require the single stored scene result shape appropriate to its mode.
3. Build mode-specific validated effects: proposal-backed genesis/project/optional explicit Canvas mutation; leased named variant; or leased `agent-apply` revision.
4. Add `memory-scene-story-work-uow.ts` with serialized snapshots for project, scene document, Canvas, proposal and assignment repositories and failure injection after every mutation boundary.

Do not add PostgreSQL locks/routes/UI in that slice. The subsequent storage slice should compose the already designed explicit lock order in one outer transaction after memory semantics are stable.
