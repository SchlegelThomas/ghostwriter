# CP2 handoff — develop one scene

## Required outcome

Deliver one durable scene assignment loop: submit an exact brief and bounded source scope, generate actual scene prose, edit and review an immutable proposal, then explicitly create the reserved scene, save a named variant, or apply a reviewed revision. The assignment records canonical references only. Scene prose, history, variants, manuscript placement, and Canvas state remain in their existing canonical stores.

## Reusable paths

- `packages/core/src/story-work-assignment.ts`, `story-work-attempt.ts`, their repositories, and migration 0027 already provide reserved scene destinations, immutable assignment sources, generated/current artifact lineage, latest-attempt recovery, idempotent attempts, CAS, and canonical result references.
- `packages/core/src/story-context-receipt.ts`, `agent-context-receipt.ts`, and `story-context.ts` provide exact scene-document, Capture, and CP1a structure resources. Scene resources carry working version/content hash; story context carries purpose, intent, beats, and adjacent scenes without duplicating prose.
- `packages/core/src/agent-runs-proposals.ts` and the PostgreSQL agent-foundation repository already persist immutable proposal payloads in JSONB and accept `scene` as a primary target.
- `packages/core/src/character-story-work-generation-*`, `character-story-work-review.ts`, and `character-story-work-apply-policy.ts` are the proven lifecycle, lineage, freshness, replay, and rollback pattern. The generic assignment/attempt/run/receipt/proposal repositories are reusable; the current executors are character-schema-specific.
- `packages/core/src/scene-document-repository.ts` and `packages/storage/src/postgres-scene-document-repository.ts` already support conditional named variants, revisions, leases, exact working versions, and immutable history.
- `packages/core/src/canvas-services.ts` plus `packages/storage/src/postgres-canvas-scene-creation.ts` prove atomic project metadata + scene genesis + scoped Canvas placement. `packages/core/src/capture-promotion-services.ts` plus `packages/storage/src/postgres-capture-scene-promotion.ts` prove Capture/source/project/Canvas fencing.
- `packages/ui/src/StoryWorkPanel.tsx`, `apps/client/src/use-story-work-workspace.tsx`, and the character review surface provide assignment entry, durable job reopening, dirty review gating, revision requests, and exact apply retries. `apps/client/src/DraftPanel.tsx` already owns scene leases, timeline, named variants, comparison, restore, and the canonical editor. Existing App Canvas/Draft callbacks preserve same-scene inspection and scoped return state.

## Gaps that prevent CP2

- `apps/backend/src/scene-partner-routes.ts` calls the provider directly and returns `scene-partner-turn-v1`; its `proseDraft` is not a receipt, run, proposal, or assignment artifact.
- `apps/client/src/InboxPanel.tsx` currently applies the Capture/reflection base rather than the live Scene Partner `proseDraft`. Its new-scene path resolves a Canvas version and then discards it.
- `packages/core/src/agent-proposal-apply-services.ts` marks a proposal after scene promotion or variant creation. A later failure can leave canonical scene state changed while proposal/assignment state is not applied. CP2 must not call this service for assignment apply.
- No `scene-draft-v1` proposal schema/workflow/compiler exists. Current generation/review executors hard-code `character-create-v2` and the story-knowledge target.
- `StoryWorkResultReference` can record a scene and revision but not a named variant. Add optional `variantId`; require a revision when it is present. Do not store prose or manuscript/Canvas copies on the assignment.
- Applying proposal prose to the working scene needs one repository mutation that checks lease + working version, inserts an immutable agent-apply revision, updates the head, and increments working version. `restoreRevision` is not the right provenance and `saveWorkingDocument` does not create the required apply checkpoint.

## Bounded implementation sequence

### 1. Scene artifact and exact generation

Add `packages/core/src/scene-draft-v1.ts` with a strict payload:

```ts
type SceneDraftV1 = Readonly<{
  schemaId: "scene-draft-v1";
  prose: string;
  sourceSceneIds: readonly SceneId[];
}>;
```

Bound prose and source count, reject extra fields and duplicate/unauthorized scene IDs, and keep the reserved destination ID outside model output. Convert reviewed prose to `SceneDocumentV1` on the server with generated block IDs; model output must not create canonical IDs.

Add `SCENE_STORY_WORK_WORKFLOW_ID = "story-work.scene"` and `scene-draft-v1` to the agent schema unions/validators/previews. Add `scene-story-work-compiler.ts` and `scene-story-work-generation-services.ts`. The compiler must consume exactly one CP1a story-context resource, every selected scene resource exactly once, and an optional exact Capture resource. Initial attempts require submitted versions/hashes; explicit revisions may refresh versions/hashes for the same authorized IDs through `latest-authorized`. Provider calls remain outside transactions.

Before adding a second lifecycle copy, extract the repository lifecycle mechanics in `character-story-work-generation-repository-uow.ts` into a schema-parameterized `story-work-generation-repository-uow.ts`. Inject workflow/schema/target validation; keep the current character wrapper and behavior unchanged. Add scene memory and PostgreSQL wrappers using the same atomic begin/complete/failure and replay ordering. No schema migration should be needed for proposal payloads or workflow IDs.

### 2. Immutable scene review

Add `scene-story-work-review.ts` and memory/PostgreSQL transaction wrappers following the character review contract. Open moves the exact generated artifact to review; editing creates a new immutable `scene-draft-v1` proposal, advances only `currentArtifact`, and marks the prior proposal stale; revision generation resets generated/current lineage through the existing attempt lifecycle. Preserve run, receipt, target scene ID, owner, and authorized source IDs.

Add `packages/ui/src/SceneStoryWorkReview.tsx` as a focused prose review surface with brief, constraints, done condition, source coverage, destination, and exact artifact version. Keep the canonical Draft mounted. The writer can edit the proposal, request revision, reject, or choose an explicit apply mode.

### 3. One atomic scene apply boundary

Add `scene-story-work-apply-policy.ts` and `scene-story-work-uow.ts`, with memory and PostgreSQL implementations. All three modes lock and validate assignment, current proposal, generated attempt, run, receipt, owner, exact source dependencies, and artifact pointer before mutation:

- `create-scene`: require assignment destination `{ kind: "scene", operation: "create" }`; use its already-reserved `sceneId`; accept writer-confirmed title, book/chapter or unassigned position, expected project version, and optional scoped Canvas placement plus expected Canvas version. In one transaction update project records, initialize proposal prose as scene genesis, optionally place the same scene ID with explicit scope membership, mark proposal applied, and CAS assignment to the scene result.
- `named-variant`: require destination `{ kind: "scene", operation: "update" }`; require exact destination head version/hash, variant name, and session lease holder. In one transaction create the proposal document revision + named variant through the scene repository, leave the working head unchanged, mark proposal applied, and store `{ sceneId, workingVersion, revisionId, variantId }`.
- `apply-revision`: require the same update destination, exact head version/hash, explicit mode, and held/unexpired lease. Add `applyDocumentAsRevision` to the scene repository and `"agent-apply"` to `SceneRevisionReason`; atomically insert the proposal revision, update the working head/version, mark proposal applied, and store `{ sceneId, workingVersion, revisionId }`.

An exact repeated apply returns the recorded canonical references and creates no new IDs, revisions, variants, project version, Canvas version, or assignment version. Any nonexact replay conflicts.

### 4. Transport and existing UI integration

Extend the existing endpoints in `apps/backend/src/story-work-api.ts` rather than adding a parallel API:

- `POST /api/projects/:projectId/story-work/assignments`: strict discriminated character/scene/revise submission. New-scene submission reserves the SceneId; update submission binds the selected existing SceneId.
- `POST .../:assignmentId/attempts`: dispatch by stored assignment task/destination, not request claims.
- Existing review open/edit/reject routes: dispatch by proposal schema.
- `POST .../:assignmentId/apply`: strict `create-scene | named-variant | apply-revision` body carrying assignment/artifact preconditions plus mode-specific project, Canvas, head, and lease preconditions.
- Detail response continues to resolve `latestAttemptId`, including a failed revision whose current proposal remains the prior artifact.

Extend `apps/client/src/api.ts` and `use-story-work-workspace.tsx` through discriminated responses. Enable `scene` and `revise` in `StoryWorkPanel`; add Capture selection only when entered from Plans/Scene Partner. On acknowledged create, refresh the navigator and Canvas response, then open/select the same reserved SceneId in Draft/Canvas. Named variant opens the existing Draft history/variant view without replacing prose. Applied revision refreshes the same scene head; a conflict keeps the proposal open and canon unchanged.

Keep `ScenePartnerChatPanel` as optional brief shaping during this slice. Its final “develop scene” action should prefill/submit the durable assignment instead of treating transient `proseDraft` as applied output. Remove the old Inbox apply route only after the durable path covers its entry points.

## Transaction and race safeguards

- Lock the scoped assignment first, then proposal/run/receipt/attempt, then deterministically sorted consumed Capture/scene heads, destination scene head/lease, project records, and optional Canvas board. Keep all provider work outside the database transaction.
- Rebuild and hash the consumed CP1a story-context projection inside apply. Check every consumed scene and Capture version/hash; unrelated prose changes do not invalidate the proposal.
- Create mode checks project CAS and, only when requested, Canvas CAS. A stale Canvas placement applies nothing, including project scene creation and assignment/proposal state.
- Update modes check destination head working version and content hash plus lease holder/expiry inside the same transaction. Named variant never changes working prose. Apply revision always creates a history revision before changing the head.
- Validate the reserved destination SceneId across assignment, receipt, proposal primary target, project mutation, scene head/revision, Canvas object, and result. Never accept a model-selected destination or regenerate the ID during apply.
- Treat archived/missing project, Capture, book/chapter, scene, or Canvas scope as a refusal before writes. Preserve project, scene, Canvas, assignment, and attempt version domains independently.

## Focused verification required

- Strict schema tests: bounded prose/source IDs, no extra fields, no target IDs in output, editor conversion and canonical hashing.
- Compiler tests: exact CP1a purpose/beats/adjacent context, optional Capture, selected prose once each, initial snapshot mismatch, explicit latest-source revision, injection isolation, and provider budget/refusal.
- Lifecycle tests in memory and PostgreSQL: uncertain-response replay without second provider call; atomic begin, completion, failure, revision lineage, latest-attempt detail, and rollback at every later write.
- Review tests: open/edit/reject, immutable prior proposal, generated/current lineage, unauthorized source edit, stale assignment/artifact, owner isolation, and PostgreSQL rollback.
- Apply parity tests for all three modes: exact replay, nonexact replay, consumed-source stale, project/Canvas CAS, missing/archived placement, destination head/hash stale, lease conflict/expiry, variant-name conflict, and injected rollback after scene/project/Canvas/proposal writes.
- Canonical assertions: create uses one reserved SceneId in Explorer, scene head, history and Canvas; named variant leaves head/version/prose unchanged; apply revision creates one immutable revision and increments the head once; rejected work changes none of them.
- Backend contract tests: strict discriminated payloads, stored-kind dispatch, hidden foreign IDs, conflict mapping, and complete acknowledged response references.
- Client/UI tests: dirty review navigation gate, edit/revise retry identity, exact apply-mode copy, stale recovery, new-scene Draft/Canvas handoff, named-variant history opening, and project/account async isolation.

Parent browser verification follows the completed vertical slice. No provider call or Playwright run belongs in these implementation tests.
