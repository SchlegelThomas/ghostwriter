# CP2 scene apply contract

## Boundary and invariants

One `SceneStoryWorkApplyUnitOfWork` owns the complete human-approved transition from a reviewed `scene-draft-v1` proposal to canonical state. It has three explicit modes. It performs no provider work and never treats proposal JSON as a canonical scene document until the trusted server converts it with `sceneDraftDocument` and server-generated block IDs.

All modes bind the same account, project, assignment, current artifact version/hash, generated attempt, run, receipt, proposal, workflow/schema, reserved destination SceneId and authorized source IDs. The assignment is the coordinator only: prose remains in proposal/scene storage, manuscript placement remains in project records, and geometry remains in Canvas.

## Public core request and result

Add `packages/core/src/scene-story-work-uow.ts` with these shapes. API parsing brands the IDs and validates finite geometry before calling the service. `appliedAt` is server supplied and is not accepted from the client.

```ts
type SceneStoryWorkApplyBase = Readonly<{
  accountId: AccountId;
  projectId: ProjectId;
  assignmentId: StoryWorkAssignmentId;
  expectedAssignmentVersion: number;
  proposalId: AgentProposalId;
  expectedArtifactVersion: number;
  expectedProposalContentHash: InstructionContentHash | string;
  idempotencyKey: string;
}>;

type CreateSceneApplyInput = SceneStoryWorkApplyBase & Readonly<{
  mode: "create-scene";
  expectedProjectVersion: number;
  title: string;
  manuscriptPlacement:
    | Readonly<{ kind: "chapter"; bookId: BookId; chapterId: ChapterId; position?: number }>
    | Readonly<{ kind: "unassigned"; bookId: BookId; position?: number }>;
  canvas?: Readonly<{
    expectedCanvasVersion: number;
    scope: CanvasScopeRef;
    x: number;
    y: number;
    width: number;
    height: number;
    z: number;
    parentRegionId?: CanvasObjectId;
    storyOrderHint?: number;
  }>;
}>;

type ExistingSceneApplyBase = SceneStoryWorkApplyBase & Readonly<{
  expectedSceneWorkingVersion: number;
  expectedSceneContentHash: SceneContentHash | string;
  leaseHolderId: SceneLeaseHolderId;
}>;

type NamedVariantApplyInput = ExistingSceneApplyBase & Readonly<{
  mode: "named-variant";
  variantName: string;
}>;

type ApplyRevisionInput = ExistingSceneApplyBase & Readonly<{
  mode: "apply-revision";
}>;

type ApplySceneStoryWorkInput =
  | CreateSceneApplyInput
  | NamedVariantApplyInput
  | ApplyRevisionInput;

type SceneStoryWorkApplyResult = Readonly<{
  replayed: boolean;
  assignment: StoryWorkAssignment;
  proposal: AgentProposal;
  result: Extract<StoryWorkResultReference, { kind: "scene" }>;
}>;

interface SceneStoryWorkApplyUnitOfWork {
  applyScene(
    input: ApplySceneStoryWorkInput & Readonly<{ appliedAt: string }>
  ): Promise<SceneStoryWorkApplyResult>;
}
```

The result stays stable across replay and contains canonical references only:

- `create-scene`: `{ kind: "scene", sceneId, workingVersion: 1, revisionId: genesisRevisionId }`.
- `named-variant`: `{ kind: "scene", sceneId, workingVersion: unchangedHeadVersion, revisionId, variantId }`.
- `apply-revision`: `{ kind: "scene", sceneId, workingVersion: previous + 1, revisionId }`.

Extend the scene member of `StoryWorkResultReference` with `variantId?: SceneVariantId`; validation requires `revisionId` when `variantId` is present. A scene assignment records exactly one scene result whose ID equals the reserved destination. Project and Canvas versions are intentionally absent from assignment results: clients refresh those canonical stores after apply, and a later unrelated change must not alter the recorded result.

## Exact replay identity

The existing character replay inference is insufficient for scene work because title, manuscript placement, optional Canvas placement, lease, variant name and apply mode are not represented by the current artifact pointer. Add two optional, paired fields to `StoryWorkAssignment` and the assignment row:

```ts
applyIdempotencyKey?: string;
applyRequestFingerprint?: InstructionContentHash;
```

They are absent for legacy and unapplied assignments. `recordAppliedStoryWorkAssignmentFromUnitOfWork` receives and persists both for new scene applies. Storage adds nullable text columns with a check requiring both null or both non-null. No uniqueness index is needed: one assignment can reach `applied` once, and the assignment row lock serializes callers.

Compute the fingerprint in core from canonical JSON after strict request validation. Include account, project, assignment, expected assignment version, proposal/artifact tuple, mode and every mode-specific client value. For create include expected project version, exact title, manuscript placement and the complete optional Canvas request. For update modes include expected destination head version/hash, lease holder, and variant name when present. Exclude the idempotency key, `appliedAt`, and every server-generated block/revision/variant/Canvas object ID. This follows attempt fingerprint policy: the key selects the attempt; the fingerprint proves the same semantic request.

Replay runs immediately after scoped ownership and canonical assignment/proposal/run/receipt/attempt binding, before freshness/version checks or ID generation:

1. If assignment status is not `applied`, continue normal validation and require no applied-request fields.
2. If applied, require the stored key and fingerprint to equal this request, assignment version to equal `expectedAssignmentVersion + 1`, proposal status to be `applied` by the same account, and the single stored scene result to match the reserved destination and mode shape.
3. Return that stored result with `replayed: true`. Do not recheck current project/Canvas/head/source versions: canonical state may legitimately have advanced after the successful apply.
4. A reused key with a different fingerprint, a different key after apply, or a malformed recorded result throws `StoryWorkApplyIdempotencyConflictError`. It never attempts another mutation.

## Shared validation and scene-specific policy

Extract only the two policy-neutral pieces of `character-story-work-apply-policy.ts` into `story-work-apply-validation.ts`:

```ts
validateStoryWorkApplyBindings(input, policy): ReservedTarget;
validateStoryWorkReceiptFreshness({
  receipt,
  currentRecords,
  sceneDocumentHeads,
  captureDocumentHeads,
  hashPort,
  allowCapture
}): Promise<void>;
```

`validateStoryWorkApplyBindings` owns account/project/assignment/attempt/proposal/run/receipt identity, current versus generated artifact lineage, provider/model, workflow/schema and reserved target checks. A small policy supplies workflow ID, schema ID, target kind and destination resolver. `validateStoryWorkReceiptFreshness` rebuilds the one CP1a story-context resource with `storyContextFromProjectRecords` plus `assembleStoryStructureResource`, compares the canonical receipt metadata, and checks every consumed scene head at exact project/scene/version/hash.

Add Capture support to the shared freshness helper: at most one Capture resource, exact assignment Capture ID, current project/working-version/content-hash match, and status other than `archived`. An already integrated but unchanged Capture remains valid historical source data; scene apply never calls `CaptureDocumentRepository.integrate`. Missing, foreign or archived Capture is stale. Require every assignment scene/Capture source exactly once and reject every extra receipt resource.

Keep mutation construction, result validation, replay mode checks and error wording in `scene-story-work-apply-policy.ts`. Do not parameterize the character project mutation or create a generic apply UOW: character creation, scene genesis, named variants and leased head replacement have materially different writes. Character policy should delegate to the shared binding/freshness helpers with `allowCapture: false`, preserving its existing public API and behavior.

Scene validation additionally requires:

- `scene` task with `{ kind: "scene", operation: "create" }` only for `create-scene`.
- `revise` task with `{ kind: "scene", operation: "update" }` only for the two existing-scene modes.
- Receipt and proposal primary targets equal the reserved destination, and proposal payload source IDs equal the assignment's explicit scene source IDs.
- Assignment `awaiting-review`, proposal/run `ready`, exact current artifact, and attempt result equal to `generatedArtifact`.
- Every consumed scene and Capture remains current, active and in the same project; archived destination/source scenes refuse.
- The reconstructed story-context receipt remains exact inside the transaction. Unconsumed prose is irrelevant.

Use `SceneStoryWorkArtifactMismatchError` for binding/lineage failures, `SceneStoryWorkContextStaleError` for consumed dependency drift, the existing project/Canvas version errors, and a scene apply conditional conflict carrying the existing repository reason union (`working-version-conflict`, `lease-conflict`, `lease-expired`, `variant-name-conflict`).

## Mode-specific canonical effects

### Create scene

Load project records under the project row lock and require `project.version === expectedProjectVersion`, active project/book/chapter references, and absence of the reserved SceneId in both project scenes and scene-document heads.

1. Call `applyProjectCommandToRecords(records, { type: "scene.create", ... }, fixedSceneIdGenerator(destinationId), appliedAt)`.
2. Convert the reviewed proposal with `sceneDraftDocument(payload, () => ids.create("sceneDocumentBlock"))`, hash it with `hashSceneDocument`, and construct an `InitializeSceneDocumentInput` using one server revision ID. The revision is the destination's genesis, with `origin: "agent"`, `reason: "genesis"`; head version is 1 and points to that revision.
3. If `canvas` is present, require an existing acknowledged board at its expected version. Call `applyCanvasCommand` with `canvas.object.place`, the updated project records, the required typed scope, server-generated Canvas IDs, and the latest Canvas revision as parent. Set authority `confirmed`, label from the canonical scene title, `sourceKey: "story-work:<assignmentId>"`, and provenance `story-work.scene`. The command writes explicit scope membership. No Canvas input accepts IDs, source keys or provenance from the client.
4. In the outer transaction call `projects.transaction(writer => writer.replaceProjectRecords(updated, expectedProjectVersion))`, `sceneDocuments.initialize(sceneDocument)`, optional `canvases.replace({ mutation, expectedCanvasVersion })`, `proposals.markApplied(...)`, then assignment CAS with the recorded scene result and apply key/fingerprint.

If Canvas is omitted, neither Canvas board nor Canvas version is read or written. If it is supplied, any Canvas scope/reference/version conflict rolls back the project scene, genesis, proposal and assignment. A missing board is a Canvas conflict; callers must first load/initialize the board through the existing Canvas read path.

### Named variant

Require the reserved destination head to match both `expectedSceneWorkingVersion` and `expectedSceneContentHash`. Lock and validate the held, unexpired lease. Convert/hash the reviewed proposal and allocate server revision/variant IDs only after replay and freshness validation.

Call `sceneDocuments.createNamedVariantFromDocument` with the exact head precondition, lease holder, generated IDs, validated variant name, proposal document/hash, `origin: "agent"`, `reason: "named-variant"`, actor and server time. Require success; record its unchanged head working version, immutable revision ID and variant ID. Then mark the proposal applied and CAS the assignment. Do not alter the working head, project records or Canvas.

### Apply revision

Require the same exact destination head and lease conditions. Convert/hash the proposal, allocate one server revision ID, then call `sceneDocuments.applyDocumentAsRevision`. This repository operation creates `agent` / `agent-apply` history and advances the working head exactly once. Record the returned working version and revision ID, mark the proposal applied, and CAS the assignment. Do not call `saveWorkingDocument` or `restoreRevision`, and do not mutate project records or Canvas.

## PostgreSQL unit of work and lock order

Add `createPostgresSceneStoryWorkApplyUnitOfWork({ db, ids, hashPort })`. Open one outer `db.transaction`, construct every repository against that transaction, and use this lock order consistently:

1. Scoped story-work assignment row `FOR UPDATE`; then verify project ownership while hiding foreign IDs as not found.
2. Requested proposal row `FOR UPDATE`.
3. Proposal run, receipt and exact attempt rows `FOR UPDATE`.
4. Receipt Capture rows sorted by CaptureId `FOR UPDATE`.
5. Union of consumed scene-document rows and existing destination, deduplicated and sorted by SceneId, `FOR UPDATE`.
6. Destination lease row `FOR UPDATE` for the two update modes.
7. Project row `FOR UPDATE`, then load the full project records used to reconstruct story context. Every project command advances this row, so the lock closes metadata freshness races.
8. Optional Canvas board row `FOR UPDATE`, then read its latest revision with `listRevisions(projectId, { limit: 1 })`.

Run exact replay after step 3 and before source/project/Canvas locks. For a new apply, hold all applicable locks through freshness validation and every write. Transaction-bound `createPostgresProjectRepository`, `createPostgresCanvasRepository`, `createPostgresCaptureDocumentRepository`, `createPostgresSceneDocumentRepository`, assignment, attempt, proposal, run and receipt repositories are the reusable adapters. The scene repository's internal transaction becomes a savepoint on the transaction-bound database; its conditional checks remain authoritative.

This ordering closes these races:

- Scene/Capture autosave cannot occur between receipt validation and apply.
- Destination autosave or lease release cannot occur between head/lease validation and variant/revision creation.
- Project intent, beat, placement or archival mutation cannot occur between CP1a projection reconstruction and commit.
- Optional Canvas edits cannot occur between placement computation and board replacement.
- Concurrent review/edit/apply calls serialize on the assignment before reading the current artifact.

## Memory parity and rollback

Add `createMemorySceneStoryWorkApplyUnitOfWork` using the existing serialized-tail pattern. Require `MEMORY_TRANSACTION_STATE` participants for project, scene document, optional Canvas, assignment and proposal repositories. Snapshot all participants before reads; restore every snapshot on any validation error, conditional refusal or injected failure. Capture, run, receipt and attempt repositories are read-only in this UOW and need no rollback participant.

Exercise failure points after project replacement, scene initialize/variant/revision, Canvas replacement, proposal mark-applied and before assignment CAS. A rollback may consume unused generated IDs; it must restore every canonical map/version/status. Exact replay must allocate no IDs and mutate no participant.

## Implementation sequence and focused proof

1. Extend scene result validation with optional `variantId`, add paired assignment apply key/fingerprint fields and migration, and add the shared binding/freshness helper while proving character apply parity.
2. Add the scene apply types, pure policy/fingerprint/replay tests, and proposal-to-genesis state helper.
3. Add memory UOW with all three effects, replay and injected rollback tests.
4. Add PostgreSQL UOW with explicit locks and parity tests, including rollback after every later write.
5. Bind one strict discriminated backend apply request only after the storage boundary is green.

Required tests cover wrong owner/target/workflow/schema/artifact lineage; extra/missing/stale scene and Capture resources; archived dependencies; create project/Canvas CAS; missing Canvas board/scope; duplicate reserved SceneId; named-variant name conflict; destination head hash/version and lease conflicts; exact key/fingerprint replay after later unrelated canonical changes; different-key/body replay refusal; and unchanged project/Canvas/head behavior for the two update modes.

No provider, cost, queue, MCP grant or automatic apply behavior belongs in this contract.
