# 0018: Story work assignments and artifact review

- Status: proposed — awaiting epic acceptance; no implementation authority yet
- Date: 2026-09-12
- Plan: [Develop a story with agents](../../plans/active/2026-09-12-agent-story-workflow/plan.html)
- Extends: ADR 0011 (context/proposals/grants), ADR 0014 (entity drafts)
- Would partially supersede: ADR 0016 transient bundle state and fixed wave execution

## Context

The current Agent panel can submit jobs, create proposals, and seed Scene Partner briefs,
but does not preserve a complete assignment or coordinate downstream checks on actual results.
A brief-open event is not a written scene, and a catalog memo without prose is not a story check.

## Proposed decision

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
domains or require a new queue vendor. Thomas must accept recoverability, approval granularity,
context/spend boundaries and MCP transport scope before implementation. Until then ADRs 0011/0014/0016
remain the accepted behavior. Update the ADR index and architecture/product/API/operations docs
when accepted and as each checkpoint ships.

## Proposed extension — connected story spine (2026-09-12 review)

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
