# CP2 scene revision apply port handoff

## Added contract

`SceneDocumentRepository.applyDocumentAsRevision` accepts an already reviewed
`SceneDocumentV1`, its canonical SHA-256 content hash, a caller-created revision
ID, and the same project/scene/actor/time plus exact working-version and lease
preconditions used by the existing conditional scene mutations.

Success creates one immutable child of the current checkpoint with
`origin: "agent"` and `reason: "agent-apply"`, then advances the working head
once to that document, hash, and checkpoint revision. Failure before the write
returns the existing `working-version-conflict`, `lease-conflict`, or
`lease-expired` outcome. Duplicate revision IDs and other invalid records throw;
both implementations leave the head and history unchanged.

The method deliberately does not accept origin or reason from its caller. It
does not mark a proposal or assignment applied. The later CP2 apply unit of work
must compose this repository operation with proposal/assignment/result updates
inside one outer transaction and preserve exact replay at that higher boundary.

## Persistence and transaction notes

No schema migration is required. Scene revision `origin` and `reason` are stored
as text, and `agent-apply` fits the existing table and row mapper. The domain
factory now rejects unsupported origin/reason values so corrupted or unknown
stored classifications fail closed.

The PostgreSQL implementation follows the restore/named-variant locking path:
it locks the scene head, checks exact working version and held/unexpired lease,
inserts the revision, and updates the locked version in one transaction. The
memory implementation validates both new records before changing either map and
participates in the existing memory transaction snapshot/restore mechanism.

## Integration obligations

- Convert reviewed scene prose to a validated `SceneDocumentV1` and compute its
  canonical hash before calling this port.
- Validate assignment, receipt, artifact lineage, source freshness, destination
  scene hash/version, owner, and exact replay in the CP2 apply policy/UOW.
- Supply the active editor session lease holder and the expected working version;
  map the repository's three conditional conflicts without retrying or silently
  reacquiring a lease.
- Store the returned `{ sceneId, workingVersion, revisionId }` as the canonical
  assignment result in the same transaction. A replay must return that stored
  result without calling this method again or generating a new revision ID.
- For a transaction-bound PostgreSQL repository, instantiate this repository
  against the outer transaction database so its mutation participates in the
  full apply rollback boundary.

## Focused evidence

- Memory: successful provenance/head advance/history retention; duplicate-ID
  rollback; version, holder, and expiry refusals; reason validation.
- PostgreSQL/PGlite: the same successful provenance and immutable history;
  duplicate-ID rollback; version, holder, and expiry refusals.
- Core and storage TypeScript checks and focused ESLint pass.

No provider, public API, lifecycle, UI, schema, migration, or index changes are
included in this prerequisite.
