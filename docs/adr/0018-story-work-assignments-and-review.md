# 0018: Story work assignments and artifact review

- Status: accepted — 2026-09-12 user approved the epic; implementation in progress
- Date: 2026-09-12
- Plan: [Develop a story with agents](../../plans/active/2026-09-12-agent-story-workflow/plan.html)
- Extends: ADR 0011 (context/proposals/grants), ADR 0014 (entity drafts)
- Would partially supersede: ADR 0016 transient bundle state and fixed wave execution

## Context

The current Agent panel can submit jobs, create proposals, and seed Scene Partner briefs,
but does not preserve a complete assignment or coordinate downstream checks on actual results.
A brief-open event is not a written scene, and a catalog memo without prose is not a story check.

## Decision

Persist project-owned assignments with work kind, writer brief, stable scope/destination IDs,
context receipt references, bounded steps/dependencies, attempt identities, and proposal/result
references. Assignment state coordinates work; it never duplicates canonical scene/Canvas/knowledge
content. Reuse the proposal store for provisional output and existing domain commands for apply.
The exact schema/migration is designed in CP1 against the existing repository contracts.

Persist progress and results on the server; keep execution bounded and foreground-driven in this
epic. Closing the client does not promise unattended continuation. Reconcile interrupted attempts
on reconnect; require explicit resume/retry where outcome or provider spend is uncertain. Use
idempotency and attempt preconditions; never blindly resubmit after timeout.

Replace implicit wave dependencies with explicit artifact-ready or applied-revision dependencies.
A downstream checker receives the actual source revision and coverage receipt. Parallelize
independent read/proposal work; serialize shared mutation domains. Checks are advisory, not a
second authority capable of approving canon.

Review an exact proposal version/hash and affected destinations. User edits invalidate the old
review version. Human apply revalidates scope, all versions, leases and dependencies atomically.
One selected structure batch must be dependency-complete; conflicts apply nothing. Saving a named
variant remains distinct from replacing working prose. Preserve provenance and existing history.

Expose bounded read, context, proposal and status capabilities from shared core through UI/backend
and scoped MCP. External grants explicitly enumerate permitted resource/tool scope, expiry and
revocation. No external approve/apply, credentials, implicit project enumeration, or authority
from prompt text. Production remote MCP OAuth/deployment remains outside this epic.

Keep spend-on-Submit from ADR 0016 and zero-spend ambient suggestions from ADR 0015. Show bounded
jobs/context and coverage; do not silently start full-book checks or auto-retry provider calls.
Provider errors and deterministic guidance must remain distinguishable from generated output.

## Alternatives

- Keep only client bundle state: smaller, but loses resumability and dependency truth.
- Add a durable unattended worker system: useful later, but expands operational and cost scope.
- Store each workflow artifact as a second manuscript: rejected; creates conflicting authority.
- Give internal/external agents direct canonical writes: rejected under existing human apply policy.

## Consequences and acceptance gate

Requires assignment persistence, attempt/version contracts, bounded context queries, typed structure
proposals/findings, migration tests, and UI review/resume states. Does not change canonical version
domains or require a new queue vendor. Thomas accepted the epic and its recoverability, approval granularity, context/spend and MCP
transport boundaries on 2026-09-12. Existing behavior remains as documented until each checkpoint
is implemented and verified. Update the ADR index and architecture/product/API/operations docs
when accepted and as each checkpoint ships.

## Accepted extension — connected story spine (2026-09-12 review)

The user identified Canvas/writing integration and maintaining the main story spine as a central
missing outcome. Deliver a shared narrative-context projection early, before agent-specific loops.
Reuse canonical manuscript order, chapter objectives, scene sketch fields, and scene/knowledge IDs.
Add explicitly authored narrative beat relationships and revision-addressed evidence only where
existing semantic contracts do not cover them; settle ownership and transaction/version domains
in CP1a. Never duplicate intent text per Canvas card, or treat spatial/knowledge links as causal
relationships implicitly. Reading order, causal relationships and story-world chronology differ.

Both Canvas and Draft expose the same acknowledged intent; editing either uses the same core
command and expected metadata version. Prose saves stay in the scene working domain. Model-inferred
outcomes remain provisional findings until explicit writer acceptance. Prose/intent/link changes
invalidate relevant assessments through their version dependencies without automatic provider calls.
A stale assessment is not proof of narrative inconsistency. Changed known dependencies identify
scenes to revisit; model-suggested additional dependencies remain bounded, provisional and labeled.

Writers may revise prose, revise intent, or defer a difference. Each approved change has its own
precise effect and preserves history; no automatic downstream rewrite. Canvas restore remains
spatial. Assignment/context/MCP projections share this model with the existing human-apply ceiling.
No new store, automatic whole-book score, or hidden synchronization authority is introduced.

## Canvas foundation review — accepted clarifications (2026-09-12)

The thorough pre-approval audit adds CP0a/CP0b before narrative work. Current scoped visibility
is graph-derived, so objects created inside a chapter can disappear. Introduce explicit board
scope membership independent of narrative links; scope placement geometry alone is insufficient.
Define migration/reference guards and preserve all existing objects and placements. Invalid,
archived or removed chapter/scene scopes need an inspectable recovery path, not invisible content.

Separate inspected Canvas object from active writing scene. This modifies ADR0007's single
shared-selection wording: stable canonical IDs still join the surfaces, while browsing is not
an implicit command to flush/replace Draft. Explicit open acquires the appropriate scene context.
Define per-scope return camera/selection/lens/focus persistence rather than assuming the current
single viewport preference stores the navigation stack.

Unify scope-aware move/resize into one completed-gesture command and expected-board-version
boundary. Inspector/ordered geometry must use the same resolution as spatial rendering. Preserve
other scopes, and roll back optimistic geometry on refusal. Repair repeated Undo (current snapshot
selection alternates states). Specify action traversal and redo policy before implementation;
retain append-only audit history and distinct exact-version snapshot restore. Reconcile ADR0007's
inverse/meaningful-checkpoint language with the chosen implementation; do not silently switch to
event sourcing or conflate board restore with prose/intent restore.

Bound history and graph/context reads after profiling a realistic many-scene/link/scope fixture.
No performance budget is claimed as measured until CP0b records it. Canvas/spine/history MCP reads
and typed proposals require explicit grants/bindings; current registry exceptions are not parity.
Thomas authorized implementation of the full epic after reviewing the audit on 2026-09-12.

## Foundation implementation contract (in progress)

Canvas create/place accepts an optional typed scope and writes its initial scope placement in the
same board transaction. Only a placement marked `membership: "explicit"` grants direct visibility without a narrative
edge. Legacy placements remain geometry-only: add a nullable membership column with no backfill.
Geometry updates preserve a preexisting marker without inventing membership. Existing graph-derived
related-object visibility is preserved for compatibility. New scope targets
must resolve within the authorized project; stale historical placements remain inspectable at project
level rather than blocking unrelated edits. Completed geometry uses setScopePlacement for one
expected-board-version commit, including project scope.

Undo traverses writer actions: command and explicit restore add an action, Undo removes the latest
action, and exhaustion refuses without mutation. Audit snapshots remain append-only. No implicit
Redo is introduced. This reconciles the actual snapshot-based store with ADR0007’s earlier guarded
inverse wording; it does not introduce event sourcing or restore manuscript prose. Historical Undo
compatibility and bounded history traversal remain required before CP0b is complete.

### Undo provenance and bounded traversal

CP0b replaces reconstruction from the entire audit list with explicit restore provenance on new
Undo/restore revisions. Each new revision records the source revision restored; normal commands
retain their parent revision. Undo resolves the current logical state and its predecessor through
these references, preserving physical audit ancestry and exact snapshots. Old Undo records lacking
provenance form a deliberate boundary: new actions can still be undone to that saved state, while
traversal beyond an ambiguous legacy Undo refuses with a link to history instead of guessing. No
old snapshot is deleted or rewritten. This also enables bounded public history pages without an
unbounded list read for ordinary commands or Undo.

### CP1a authored narrative contract

Scene intent remains in the existing sketch. A partial `scene.updateIntent` command changes only
purpose/conflict/turn/open questions (null clears a field), preserving other sketch content.
An optional narrative aggregate belongs to a thread-kind story-knowledge record: explicit beats
with stable IDs, scene anchors, roles and same-thread dependency IDs, plus thread resolution
(open, intentionally open, resolved). Absence means Unmapped. Scene-local free-text beats and
knowledge associations retain their existing meaning and are never inferred into causal links.

Persist the bounded aggregate in one nullable JSONB column on the existing story-knowledge row,
following character-sheet aggregate persistence under the existing project-version transaction.
No second store or version domain is introduced. Domain validation owns project-wide beat-ID
uniqueness, active new anchors, dependency existence/uniqueness/cycles and bounds (1,500 beats per
project, 100 dependencies per beat). Archive/restore preserves beat IDs and dependency references;
archived scene anchors remain inspectable. Cross-thread causal dependencies are outside this first
contract. Shared context consumes only this canonical aggregate once wired, replacing the temporary
projection-only beat input. Provider context and advisory findings remain later checkpoints.

### Personal Canvas return state

Extend the existing account/project viewport preference with a bounded JSON map of canonical
project/chapter/scene scope views and a last scope. This remains personal UI state, independent
of project metadata and board versions. A preference-level CAS and serialized client saves prevent
late requests overwriting newer acknowledged views. Legacy columns and endpoint remain compatible
and increment the same preference version. Migration backfills only the known project camera.
Scope entries retain camera, selection, inspection, lens, view and focus intent; invalid active
references fall back to a valid ancestor while historical entries remain available for restore.
Bound the map to 1,024 entries, evicting the least recently used non-project/non-current entry.
This is not a new canonical story store or an offline replica.

### CP1b submission, revision and atomic character apply

The brief is editable before Submit. Submission persists its exact immutable definition and
server-reserved destination ID; request fingerprints exclude generated IDs/timestamps and bind the
writer's submitted fields and context. Revision instructions are durable attempt records linked to
existing AgentRun IDs. They preserve the original brief and prior artifact pointer. An explicit retry
creates a new attempt; an uncertain provider outcome never resubmits automatically.

Character output uses character-create-v2 with Cast-shaped fields and no model-selected destination.
Reviewed edits and generated revisions create new immutable proposals and increasing artifact
versions, preserving prior artifacts. Identical content may share a hash; the full proposal/version/hash
pointer identifies review authority. The server validates context, owner, project, run, receipt and
reserved target before apply. One storage transaction updates project metadata, proposal applied state
and assignment result under their preconditions. Exact repeated apply returns the recorded result
without a second character or metadata version increment. Network calls are outside transactions;
start, success and failure each commit their run/attempt/assignment transition atomically.

### Character review lineage and transactional freshness

Each assignment keeps the provider's `generatedArtifact` separately from its `currentArtifact`.
Human review edits create a new immutable proposal and advance only the current pointer; they do
not rewrite the provider attempt. A subsequent generated revision resets both pointers to its new
result. Apply ties the attempt's result to the generated pointer and the human-reviewed input to the
current pointer, preserving the same run, receipt, owner, reserved destination and source scope.

Freshness checks run inside the apply transaction. Project metadata version alone is insufficient:
scene prose has an independent working version. Postgres locks the consumed scene heads and checks
exact versions/content hashes, then reconstructs and hashes the consumed story-context projection.
Changed or missing consumed sources refuse application. Unconsumed prose does not invalidate an
artifact. Assignment locking serializes duplicate review/apply actions, and all proposal/assignment/
canonical mutations roll back together on a later conflict. Initial and revision attempt request keys
and fingerprints prevent duplicate provider invocation after an uncertain response.


An attempt records `sourceMode`. Initial generation uses `submitted-snapshot`. An explicit revision
uses `latest-authorized`, which reloads the same authorized source IDs at their current acknowledged
revisions without widening scope. The UI names this choice; no source change starts a provider call
automatically. The original assignment snapshot remains immutable and each attempt's receipt records
exactly what was consumed. Source mode participates in the attempt request fingerprint. Retrying a
failed attempt preserves its exact instruction, prior artifact and source mode.

### Scene artifact and revision prerequisites

Scene proposals use `scene-draft-v1`: bounded literal prose and authorized source scene references.
The server-reserved destination is outside model output. On application the trusted server converts
reviewed prose into the existing document schema with newly generated block IDs; markup-looking text
remains literal text. This proposal is not a second canonical document store.

The scene repository's `applyDocumentAsRevision` operation requires an exact working version and a
held, unexpired editing lease. It creates an immutable `agent` / `agent-apply` revision and advances
the head once. Its caller must compose this mutation with proposal and assignment state in the same
outer transaction, validate context and destination freshness, and return stored results on exact
replay. Named variants remain separate and leave working prose unchanged. These repository and
schema prerequisites alone do not expose scene application to a writer or MCP client.


Scene application records a paired request key and semantic fingerprint on the assignment
(migration 0028). The fingerprint includes exact review preconditions and explicit apply mode,
placement or variant choices; it excludes server time and allocated IDs. A replay must match the
stored request and returns the recorded scene/revision/variant references before checking freshness
or allocating anything new. This prevents a lost response from producing duplicate canonical work.
Legacy character assignments remain compatible. The atomic UOW and first-party scene workflow are
implemented locally; production migration/deployment and complete-epic acceptance remain later.

### Grounded continuity checks

Checks use `story-check-findings-v1`, not catalog memos or Canvas fixture lenses. Applied scene heads
and exact `scene-draft-v1` proposal artifacts are distinct target modes. Proposal artifacts have
their own receipt resource and bind the full immutable proposal pointer hash; a reserved New scene
target may be assessed before it becomes canonical.

The provider emits bounded candidate findings only. Core attaches trusted finding IDs, target,
selected-scope coverage, truncation truth, revision vector and explicit downstream scene links.
Scene/knowledge IDs must be receipt-backed, quotes must occur in provider-visible text, and block
anchors are derived from the exact acknowledged document. Invalid evidence fails generation rather
than becoming an ungrounded ready finding. There is no aggregate coherence score.

Finding resolutions create immutable replacement proposals. A fully resolved, still-fresh check
may become `reviewed`; it never becomes `applied` and has no canonical apply route. Current
freshness is rebuilt from only the dependencies the check consumed. Missing or changed prose,
intent, chapter objective, story knowledge, manuscript structure or proposal artifact yields Needs
recheck without changing assignment status or invoking a provider. A proposal finding opens its
source proposal with a prefilled revision request; an applied-scene finding prefills a separate
revise assignment. Neither action auto-submits or rewrites prose.

### Outline and book structure (CP4, locally verified 2026-09-13)

Outline assignments (`taskKind: outline`) target one existing active book. Provider output is
bounded candidate structure with local keys only; the trusted server lowers
`story-structure-proposal-v1`, allocates immutable part/chapter/scene/operation IDs after validation,
and records explicit operation dependencies. Human review may edit semantic fields (titles,
objectives, scene intent) but never canonical IDs, operation IDs or expected baseline versions.

Preview recomputes dependency closure for an exact writer-selected operation set, lowers through
the existing project-command kernel without writes, and returns manuscript order, empty genesis
descriptors, narrative-anchor impact and known check staleness without invoking a provider. Invalid
partial selection refuses with explicit required operations; preview does not silently widen
selection.

Apply is one atomic unit of work across assignment/proposal, project CAS, optional Canvas placement,
and empty genesis initialization for each new scene. Existing scene prose is never mutated.
Structure batches advance project metadata once. Exact apply replay returns the stored
`story-structure` result reference (`resolvedOperationIds`, `createdSceneIds`, `bookId`,
`projectVersion`, optional Canvas scene/object IDs) before freshness checks or reallocation.
Conflicts roll back every effect. Memory and Postgres implementations share the same contract.

First-party HTTP/UI bindings and hermetic provider fixtures are implemented locally; scoped MCP
parity for structure remains CP6. Multi-step coordination remains CP5.
