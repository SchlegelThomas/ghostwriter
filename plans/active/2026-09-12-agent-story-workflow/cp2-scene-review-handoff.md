# CP2 immutable scene review handoff

## Added boundary

`executeSceneStoryWorkReview` and the memory/PostgreSQL unit-of-work wrappers
provide the immutable review lifecycle for `scene-draft-v1` proposals. They use
the existing assignment, proposal, run, receipt, and project repositories. The
PostgreSQL wrapper locks the scoped assignment, current proposal, and proposal
run before executing the shared policy in one transaction; the memory wrapper
serializes review writes and restores assignment/proposal snapshots on failure.

The boundary accepts only these exact assignment/destination pairs:

- `taskKind: "scene"` with a reserved `scene/create` destination.
- `taskKind: "revise"` with the selected `scene/update` destination.

The assignment artifact pointer, proposal hash/target/schema, ready run,
receipt, workflow, provider, model, owner, and project must all agree. The
receipt and run must use `story-work.scene`; the receipt and proposal must use
`scene-draft-v1` and target the assignment's exact SceneId.

## Review behavior

- Open advances `artifact-ready` to `awaiting-review` and safely replays the
  already-open tuple.
- Edit validates and preserves the complete prose without trimming or
  projection. It requires the exact generated `sourceSceneIds` array, creates a
  new immutable proposal and content hash, increments artifact version, retains
  `generatedArtifact`, updates only `currentArtifact`, and marks the prior
  proposal stale.
- Reject marks the exact current proposal and assignment rejected and safely
  replays the acknowledged rejection.
- Foreign ownership, stale pointers/versions, invalid pairings, workflow/schema
  mismatches, and added, removed, reordered, or unauthorized source SceneIds
  are refused before state mutation.

This review boundary never creates, edits, checkpoints, or versions a canonical
scene. Canonical scene changes remain the responsibility of the later explicit
CP2 apply unit of work.

## Integration obligations

- Bind the new core and memory modules through the core package exports and the
  PostgreSQL wrapper through the storage package export before API wiring.
- Dispatch review by the stored assignment kind/destination and proposal schema,
  never by request claims.
- Keep the review proposal open on conflicts; do not fall back to the generated
  proposal after a human edit advances `currentArtifact`.
- The later apply policy must consume the exact reviewed `currentArtifact`, tie
  it to `generatedArtifact` and the completed attempt, validate source freshness,
  and perform the selected canonical scene mutation atomically.

## Focused evidence

- Memory tests cover create/open, revise/open, full prose/source preservation,
  unauthorized source mutation, foreign/stale/workflow refusal, rejection
  replay, generated/current lineage, concurrent edit serialization, and late
  assignment-CAS rollback.
- PostgreSQL/PGlite tests cover immutable edit lineage, rejection replay, no
  canonical scene writes, and rollback of both the new proposal and stale mark
  after an injected late assignment write failure.
- Core/storage TypeScript checks, targeted ESLint, and diff checks pass.

No provider, scene repository mutation, assignment generation, schema,
migration, public API, client, UI, or Playwright work is included.
