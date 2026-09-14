# CP4 typed structure proposal and apply contract

## Checkpoint outcome

**Status (2026-09-13):** implemented and browser-verified locally on hermetic PGlite; epic CP5–CP7
remain open.

From Agent → Develop story → Outline, a writer generates a typed book structure, reviews chapter
objectives and scene placeholders, selects one dependency-complete subset, previews manuscript,
narrative and assessment impact, then applies it once. Explorer, chronology and Canvas spine use the
same canonical IDs afterward. Reject or stale/conflicted apply changes nothing.

This checkpoint writes no scene prose. New scene placeholders receive an empty genesis document so
Draft/history remain valid.

Applied assignments record a durable result of kind `story-structure` with resolved operation IDs,
created scene IDs, book/project version and optional Canvas placement IDs. Reload must retain the
same acknowledgment and result references.

## Product boundaries

- Add `story-structure-proposal-v1`; do not reinterpret acknowledge-only `plan-outline-v1` or
  catalog structure memos as apply-ready operations.
- First vertical flow targets one existing active book. A book created through the normal project
  flow already exists. If it has no part, the proposal may create one before creating chapters.
- `outline` is the first task kind. A later `chapter` task reuses this contract for a narrower scope.
- Manuscript reading order, Canvas geometry and in-world chronology remain separate. Reorder is not
  a continuity defect and a flashback is not automatically wrong.
- New placeholders default to unplaced/spine-only. Canvas cards appear only when the writer
  explicitly selects separately previewed placement requests at apply time.
- One assignment applies once. Unselected operations are deliberately abandoned, while the
  immutable proposal remains inspectable.

## Provider candidate versus trusted proposal

The provider emits bounded candidate structure with local keys, titles, objectives, scene intent and
requested relationships. It cannot emit canonical IDs, project/Canvas versions, operation IDs,
apply choices or authority.

After strict candidate validation, the trusted server:

- validates all referenced existing book/part/chapter/scene IDs against the supplied context;
- allocates canonical IDs for every proposed new part, chapter and scene;
- allocates stable operation IDs;
- lowers candidates into typed operations and explicit dependency edges;
- records exact story-context receipt and expected project version;
- computes a pure full-proposal preview.

IDs are allocated after valid provider output but before proposal persistence. They are thereafter
immutable across review edits and apply replay. The model never chooses them.

## Trusted proposal operations

The first schema supports:

- create part in the target book;
- create/update chapter title and objective;
- reorder all chapters of one part with an exact complete ID list;
- create a planned scene placeholder in a chapter or the book's unassigned list;
- update existing/new scene intent (purpose, conflict, turn, open questions);
- move an existing scene within the same book;
- archive or restore an existing scene.

Every operation has a stable ID and a bounded list of required operation IDs. Dependencies include:

- chapter creation requires its new part creation;
- scene creation in a new chapter requires that chapter (and transitively its part);
- intent update for a new scene requires that scene creation;
- reorder lists that include new chapters require all relevant creates;
- optional Canvas placement for a new scene requires its scene creation.

Cycles, missing dependencies, duplicate IDs, references outside the target book, incomplete reorder
lists and unsafe archive/move operations are invalid output.

## Dependency-complete selection

The writer selects operation IDs. A selection is valid only when it contains every transitive
requirement. The preview endpoint returns required additions/removals and does not silently widen
the selection. UI may offer “Select required operations,” but the writer sees the exact change
before apply.

The server recomputes closure during preview and apply. Empty selection refuses. A selected
operation cannot depend on an unselected operation. Unselected dependents are allowed and are
abandoned after the one successful apply.

## Pure preview

Preview takes current `ProjectRecords`, the exact proposal artifact and selected operation IDs. It
performs no writes or ID allocation and returns:

- resolved operation order;
- before/after Explorer tree and manuscript scene order;
- created/updated/moved/archived records;
- new empty scene-document heads that apply would initialize;
- explicit authored narrative beats affected by moved/archived anchors, including resulting anchor
  state;
- known stored checks whose consumed `manuscript-slice` dependency would become Needs recheck;
- optional Canvas placement effects and required board precondition;
- clear distinctions among reading order, Canvas geometry and chronology.

Preview lowering uses the existing project command policy, but a structure batch is one project CAS:
intermediate command application may use logical working versions; the final validated records have
`project.version = expectedProjectVersion + 1`. One batch does not pretend to be several separately
acknowledged writer actions.

## Atomic apply

`StructureStoryWorkApplyUnitOfWork` binds account/project/assignment, exact current/generated
artifact, run/receipt, expected assignment/project versions, selected operation IDs, idempotency key
and semantic request fingerprint.

In one transaction:

1. lock and validate assignment/proposal/run/receipt/attempt;
2. replay an exact prior request before freshness checks or ID allocation;
3. lock the project, all affected scene documents, and optional Canvas board in deterministic order;
4. rebuild the story-context receipt and preview against current records;
5. replace project records once at `expectedProjectVersion`;
6. initialize one empty genesis document for each selected new scene;
7. optionally place selected scene cards in one Canvas mutation/version;
8. mark proposal applied and assignment applied with stable project/scene result references.

Any project/Canvas/document/proposal/assignment conflict rolls back every effect. Existing scene
prose is never changed. Geometry-only Canvas changes never reorder the manuscript.

## Review and freshness

Opening/editing/rejecting follows immutable character/scene review lineage. Writer edits may change
titles/objectives/intent and dependency-safe operation details, but never canonical IDs, operation
IDs, source scope or expected baseline.

Apply revalidates the exact structure receipt and current artifact hash. A project metadata change,
archived target, moved source, invalid complete-order list or stale Canvas version applies nothing.
Post-apply check freshness remains a read-only derived projection; no provider rerun starts.

## Implementation slices (2026-09-13)

| Slice | Status |
|---|---|
| Pure candidate/trusted schemas, ID lowering, dependency closure, preview over kernel | Done |
| Immutable structure review; memory + Postgres apply UOW, genesis/rollback/replay | Done |
| Generation lifecycle, strict backend submit/preview/review/apply; hermetic provider | Done |
| Client structure review, dependency selection, preview/apply, optional Canvas placement | Done — browser acceptance in record log |
| Scoped MCP parity for structure | Deferred to CP6 |

Browser repairs during acceptance: dependency-ordered resolved operations (not ID sort), all
hermetic objectives in review, human Canvas chooser labels, durable result reload. Check-impact
preview tested at API/core without provider rerun. No migration beyond CP2 `0028`. CP6 remains the
scoped MCP parity audit. No Playwright before complete-outcome user verification.
