# CP5 resume and multi-step coordination contract

## Checkpoint outcome

**Status (2026-09-13):** **CP5 is complete locally** on `feat/agent-story-workflow` (uncommitted
atop CP4 baseline `6cc0455`). **CP5a** cancel/interruption/reload recovery, **CP5b**
persistence/backend, **CP5c** client foreground driver/UI, and **CP5d** parent coherence,
hermetic browser chain, and full verify are all **done locally**. The epic stays **active**:
CP6 scoped MCP parity **contract started** ([cp6-mcp-parity-contract.md](cp6-mcp-parity-contract.md)); CP7 AC10 original-story walkthrough follows.

**Final verification (parent-recorded):** `pnpm verify` — typecheck, lint, 17 routing checks,
219 Vitest files passed / 1 skipped, **1,823** tests passed / 3 skipped; IDE diagnostics and
`git diff --check` clean. Focused CP5a–c matrix **179** tests before the recovery-replay
blocker fix; **100** blocker-focused tests after the fix. Migration `0029_material_rachel_grey.sql`
is checked in; **not production-deployed**. No live provider, push, PR, deploy, or Playwright.

**CP5 v1 / AC6 accepted scope:** artifact-ready **proposal** dependency for the continuity check;
explicit **child assignment recovery** (CP5a cancel/mark) satisfies writer cancellation needs for
v1. **Deliberate future extensions — not CP5 blockers:** applied-scene / **applied-revision**
dependency variant; UI/API fan-out for **2–7** concurrent ready checks and bulk foreground start;
**coordination-level cancel** (domain cancel exists; child cancel/recovery exists today);
reusable workflow templates and unattended background workers (explicitly refused in CP5).

CP5 extends durable story-work assignments into **dependency-aware, foreground-only**
multi-step work without unattended continuation, background workers, or a second canonical
store. Writers reload to durable truth, explicitly Continue/Resume/Retry, and keep human review
gates on every apply path.

Epic AC6 dependency/recovery semantics for the **first coordinated chain** are satisfied at CP5
boundary for local acceptance; epic AC6 is not re-litigated for every future extension above.

## Core invariants

### One assignment, one task domain

Each `StoryWorkAssignment` continues to own exactly one task kind, one destination, one
attempt/proposal lineage, and one apply domain (character, scene, check, structure, etc.).

- Do **not** mutate assignment `steps[]` into duplicate progress markers or force unrelated
  task kinds into a single assignment row.
- Multi-step work is coordinated **above** assignments through a separate control-plane
  aggregate; child steps materialize as normal assignments when they run.

### StoryWorkCoordination (CP5b control plane)

Add a project-owned **`StoryWorkCoordination`** aggregate for durable orchestration and
provenance only. It never stores story prose, Canvas geometry, or canonical manuscript truth.

The aggregate holds:

- stable coordination and step IDs;
- bounded typed step definitions (kind, dependency edges, optional deferred child binding);
- optional materialized child assignment IDs and summarized step results;
- explicit **artifact-ready** and **applied-revision** dependency predicates;
- create **idempotency key** and **semantic fingerprint**;
- monotonic **coordination version** for optimistic concurrency.

**Projection rules:**

- Child step status is **derived** from canonical assignment rows (and their artifacts/results),
  not from a parallel mutable progress journal inside assignment JSON.
- Binding a deferred step to a concrete child assignment is **CAS-protected** on the
  coordination version; late or duplicate binds refuse without orphaning canonical state.

**Refusal:** do not use assignment `steps[]` JSON as the mutable coordination state machine.

### Foreground execution only

- No worker, queue, cron, or unattended continuation after the browser disconnects.
- **Reload** is read-only reconciliation: show durable coordination, assignment, attempt and
  dependency truth; never auto-spend provider quota or auto-submit the next step. Client reload
  helpers **assert no automatic** Start, Continue, bind, or provider action on mount.
- The writer explicitly chooses **Continue**, **Resume**, or **Retry** for each ready or
  recoverable step.
- Independent **ready proposal** steps (read/proposal-only, no shared mutation domain) may run
  **concurrently only within one connected foreground action** (one user gesture/session
  turn). Any shared project/scene/Canvas mutation or apply remains in existing atomic UOWs
  and existing human review gates; never parallelize apply across the same version domain.

## Initial observable chain (CP5 acceptance spine)

The first end-to-end coordinated flow:

1. **Scene draft assignment** — existing CP2 scene generation/review/apply path as step one
   (or generation through review-ready without forcing apply before the check, per product
   wiring; the check dependency is on the **proposal artifact**, not applied prose).
2. **Continuity check assignment** — CP3 grounded check over the **exact** upstream
   `scene-draft-v1` proposal artifact, declared with an **artifact-ready** dependency on
   that artifact.

Behavior:

- The check step stays **blocked** until the exact upstream proposal artifact exists and
  satisfies the dependency predicate; stale, missing, rejected or canceled upstream states
  refuse downstream start.
- The writer **explicitly continues** the check step; reload does not auto-start it.
- Both steps retain **existing review surfaces** as human gates (scene review/apply and check
  review/complete); coordination does not bypass them.
- A later **applied-revision** dependency path reuses the exact applied scene result
  (post-apply revision head) without conflating proposal-artifact and applied-scene target
  modes; CP3 target-mode rules remain authoritative.

This chain exercises AC6 dependency waiting, distinct step copy (**Brief ready**, **Draft ready**,
**Awaiting review**, **Applied to story** / **Review complete**), and foreground resume without
introducing new task kinds. When a child is draft-ready or awaiting review, the coordination
aggregate may show **paused-awaiting-human** even though **Continue** (bind) is already satisfied
for a downstream deferred step — step-level labels remain authoritative.

## CP5a — Cancel, interruption and reload truth (no migration) — complete locally

Delivered before CP5b schema:

- **`POST …/assignments/:id/recover`** with strict body: `expectedAssignmentVersion`, `runId`,
  `action` (`cancel` | `mark-interrupted`). Server time drives transitions. Response includes
  `replayed`, updated `assignment`, retained `attempt`, and terminal `run`.
- **`GET …/assignments/:id`** optionally projects **active-or-interrupted** or
  **refresh-required** recovery truth (read-only; no age guess, no automatic provider poll).
- **Atomic UOW** transitions **run + assignment** together. The **attempt row stays immutable**
  and incomplete: schema completion pairs with a result artifact, not a mutable attempt status
  field. Cancel ⇒ failed run (`run-canceled`) + canceled assignment. Mark interrupted ⇒ failed
  run (`client-interrupted`) + failed assignment. Late provider completion is fenced.
- **Exact idempotent replay** keyed by **run + action + prior expected assignment version** (no
  separate recovery idempotency key). Same-action concurrent commit replays; competing actions
  conflict; rollback on refusal. Archived project owner may clean up; foreign scope is hidden.
- UI **Refresh** re-reads detail without transition; **Cancel** / **Mark interrupted** drive
  recover. **Explicit retry** (existing attempt route) uses the persisted attempt instruction
  and a **new** caller idempotency key; recovery never retries generation.

Hermetic E2E fixture seeds a running character assignment with **no provider start** and **no
canon reservation**. Browser: reload after running generation showed honest uncertain copy plus
Refresh/Cancel/Mark; Refresh did not transition; Mark led to failed/client-interrupted and Try
another generation with persistence across reload; fresh seed Cancel showed canceled copy,
provider-usage caveat, unchanged story, and explicit retry. Clipped generic recovery heading
repaired with padding/line-height.

No new migration in CP5a; reuse CP2 `0027`/`0028` assignment/attempt tables and existing run
records. **133** focused cross-layer tests passed for CP5a; full verify remains for a later CP5
checkpoint.

## CP5b — Coordination persistence and backend (migration `0029`) — complete locally

**Domain and storage:**

- **Pure core domain:** stable coordination/step IDs; bounded graph with typed step definitions;
  projection of child status from canonical assignments (no duplicate progress in assignment
  `steps[]`); deferred-step bind and cancel; semantic **request fingerprint** (uses child scene
  assignment request fingerprint; excludes server IDs); platform-neutral **AsyncHashPort** repair.
- **v1 domain chain shape:** exactly **one materialized scene-draft root** step plus **1–7
  deferred** proposal-continuity check steps, all **artifact-ready**-dependent on that root; an
  **applied** root expires proposal-mode dependency (**applied-revision** path specified but
  **not implemented** in CP5b/c).
- **Memory repository:** create idempotency, CAS/version guards, snapshot read parity with
  Postgres contract.
- **Postgres repository + migration `0029_material_rachel_grey.sql`:** coordination parent row
  with immutable JSON step definitions plus monotonic version, status, idempotency key, and
  fingerprint; relational step bindings with assignment FK and exact resolved dependency JSON;
  atomic root insert; bind CAS/locks; project **cascade** delete; assignment **restrict** on
  bound children. Migration is **present in repo** (hermetic/CI branches); **not deployed to
  production** yet.

**Create/bind UOW (memory/Postgres parity):**

- Atomic **coordination + root scene-draft assignment** create with **exact replay before ID
  allocation** and **all-or-nothing** rollback on partial failure.
- Explicit **continue** bind: CAS on coordination version; materializes a **brief-ready**
  proposal-draft continuity-check child assignment with exact upstream artifact dependency; **no
  provider** on bind.
- Child generation/review still uses existing assignment **attempt** routes (explicit Start check /
  Start scene).

**Backend v1 HTTP** under `/api/projects/:projectId/story-work/coordinations`:

- **Create** (strict body): one scene root + **one** continuity check step (domain allows 1–7;
  API/UI v1 exposes one check only — concurrent ready checks remain **open**).
- Create coordination and root assignment is **zero-provider, zero-canon** (brief-ready root only).
- **List** and **detail** return read **projections** of coordination + derived child step status.
- **`POST …/steps/:stepId/continue`** binds a deferred check when upstream artifact satisfies
  artifact-ready dependency; does not start the provider.
- Assignment recovery stays on **`…/assignments/:id/recover`**. **Coordination-level cancel**
  route is **absent** (child cancel/recovery from CP5a remains).
- Store orchestration metadata only — not prose, findings bodies, or Canvas layout.

## CP5c — Client foreground driver and UI — complete locally

- Foreground **coordination driver** loads coordination + assignments on entry/reload, computes
  ready/blocked/running from server truth, and offers explicit **Start scene**, **Continue**
  (bind), **Start check**, and **Open reviews** — **no mount/reload auto action or provider
  spend**.
- **New scene** entry optionally **Follow with continuity check** using exact separate check
  brief/constraints/done fields from the scene step.
- **Coordinated work** list with reload; center **step review** for coordination status beside
  Agent story work without replacing per-task review panels.
- Existing proposal/check review gates and apply hosts unchanged.

**Browser acceptance (hermetic, no live provider):** wide and narrow viewports; **zero-spend**
coordination create with check **blocked** until upstream artifact; explicit **Start scene**;
**Continue** bound the check with **no** provider start (exact proposal artifact dependency);
page reload retained child **Brief ready** with **no** auto provider; explicit **Start check** →
review → dismiss finding → **Complete review**; scene review/apply after check; Explorer showed
the created scene. Wide and narrow coordination controls remained reachable. **Repairs during
walkthrough:** existing source scenes shared as **context** (not generation target); review
handoff guard; child assignment list upsert after starts; coordination projection refresh after
return from child review; aggregate **paused-awaiting-human** while step shows Draft ready;
generic recovery heading spacing from CP5a. **CP5a** cancel/mark browser paths remain prior proof.

## CP5d — Coherence, full verify, and scope closure — complete locally

- Parent cumulative **coherence review** against ADR 0018, this contract, and AC6 — **done**.
- **`pnpm verify`** at CP5 boundary — **passed** (counts in checkpoint outcome above).
- **Coherence blocker found and fixed (backend regression):** recovery idempotent replay must
  **not** compare against a freshly observed server `completedAt` on the run row. **Same** run +
  action + prior expected assignment version replays the **stored** run timestamps and outcome;
  **competing** recovery actions conflict. Covered by focused regression tests after fix.
- **Remaining contract gaps are deliberate v1 deferrals, not CP5 blockers** (see checkpoint
  outcome): applied-revision dependency path; multi-check API/UI fan-out (domain 1–7); coordination-
  level cancel route; reusable templates / unattended workers.
- Playwright remains deferred until complete-outcome user verification (CP7 gate).

## Refusal matrix

The server and client refuse (non-exhaustive; exact error copy is implementation detail):

| Condition | Effect |
|---|---|
| Foreign project/account or non-running assignment when cancel/interrupt expected | No mutation |
| Stale active run / attempt superseded by newer attempt | No mutation; show current truth |
| Concurrent provider completion racing cancel or new attempt | Fenced; late completion cannot apply |
| Recovery replay mismatch (run, action, or expected assignment version) | No mutation; return stored outcome or refuse |
| Dependency missing, stale, upstream rejected or canceled | Downstream step cannot start |
| Reload with no explicit user continue | No provider spend |
| Partial child assignment creation failure | Roll back coordination bind and child rows together |
| Parallel apply or mutation in the same shared version domain | Serialize; existing UOW conflicts apply nothing |

Shared version domains (project metadata, scene document head/lease, Canvas board, assignment
CAS) never accept parallel apply from coordination.

## Tests, documentation and MCP obligations

- **CP5a (done locally):** cancel/interrupt recovery UOW atomicity (run+assignment; attempt
  immutable), late-run fencing, recovery replay matrix (including post-blocker same-action replay),
  backend/client contract parity, hermetic browser fixture — **133** focused cross-layer tests plus
  prior browser cancel/mark paths.
- **CP5b–c (complete locally):** domain/storage/UOW/HTTP/client/UI vertical slice; **179**
  focused CP5a–c tests before recovery-replay blocker fix.
- **CP5d (complete locally):** coherence review, hermetic browser full chain above, **100**
  blocker-focused tests, final **`pnpm verify`** (1,823 tests passed / 3 skipped).
- **Backend routes:** strict authenticated contracts mirroring memory/Postgres; foreign scope
  hidden.
- **Client:** driver state machine, blocked/ready UI, explicit continue without auto-spend on
  reload.
- **ADR 0018:** record accepted CP5 implementation refinement (this contract).
- **Capability registry / MCP:** `story-work.recovery.read`, `story-work.recovery.manage`,
  `story-work.coordination.read`, and `story-work.coordination.manage` record first-party bindings
  with **CP6** read/manage/propose exceptions. No external approve/apply.
- **PRODUCT / ARCHITECTURE / API / OPERATIONS / ADR 0018:** updated for CP5a recovery and CP5b/c
  coordination behavior (local; not production-deployed).

Playwright authoring/repair waits for `GHOSTWRITER_PLAYWRIGHT_GATE=user-verified`.

## Implementation slices

| Slice | Scope | Migration | Status |
|---|---|---|---|
| CP5a | Cancel, mark interrupted, reload recovery truth, atomic run+assignment UOW (attempt immutable), GET detail projections without auto provider poll, explicit retry via attempt route | None (reuse `0027`/`0028`) | **Complete locally** (133 focused tests; browser hermetic) |
| CP5b | Domain/repository/migration `0029`; create/bind UOW + `/story-work/coordinations` HTTP; memory/Postgres parity | **`0029`** | **Complete locally** |
| CP5c | Foreground driver, Agent UI for multi-step status, explicit continue/start/open review | — | **Complete locally** (browser hermetic) |
| CP5d | Coherence review, recovery-replay regression fix, full verify, hermetic browser full chain; defer applied-revision, multi-check UI, coordination cancel to post-CP5 | — | **Complete locally** |

## Deliberate deferrals (post-CP5, not blockers)

These were scoped out of CP5 v1 intentionally; domain or partial API may exist without writer-facing
parity:

| Extension | CP5 v1 substitute | Risk if assumed shipped |
|---|---|---|
| Applied-revision dependency variant | Artifact-ready **proposal** dependency only | Downstream check might start before applied prose when product intended post-apply mode |
| 2–7 concurrent ready checks + bulk foreground start | v1 create/bind exposes **one** check in HTTP/UI | Writers cannot fan out multiple checks from one coordination in product UI yet |
| Coordination-level cancel route | Per-child **recover** (cancel/mark) from CP5a | No single “cancel whole flow” control; domain cancel exists without HTTP/UI |
| Reusable templates / unattended worker | One coordination per ad-hoc writer-started flow | No saved multi-step recipes or background continuation after disconnect |

## Material choices resolved in this contract

- **Control plane vs assignment row:** coordination is a separate aggregate; assignments stay
  single-kind.
- **Dependency storage:** typed edges on coordination, not mutable assignment `steps[]`.
- **Execution model:** foreground-only; reload reconciles, never continues spend.
- **First chain:** scene proposal artifact → artifact-ready continuity check; applied-revision
  path specified for later steps reusing CP3 modes.
- **Slice order:** CP5a before CP5b migration; driver and browser after persistence.

## Material choices resolved (2026-09-13, post–CP5a)

- **Initial chain dependency:** the continuity check depends on the **exact proposal artifact**
  (`scene-draft-v1`); scene apply is **not** required before the check. **Applied-revision**
  dependencies remain a separate later path (CP3 target modes).
- **HTTP routes:** coordination under
  `/api/projects/:projectId/story-work/coordinations` for CP5b/c; assignment recovery stays
  `POST …/assignments/:id/recover`.
- **Coordination instance scope:** **one coordination per explicit ad-hoc writer-started flow**
  with a stable ID for reload; reusable workflow templates deferred.

## Baseline and verification

- **CP4 baseline commit:** `6cc0455` (`feat: complete scene check and structure story work`).
- **CP4 final verify:** typecheck, lint, 17 routing checks, 1,680 tests passed, 3 skipped.
- **CP5a (local):** 133 focused cross-layer tests; affected typechecks/lint/IDE clean; hermetic
  browser recovery walkthrough recorded in the record log.
- **CP5b–c (local):** persistence, backend coordinations routes, client driver/UI, hermetic browser
  chain above. **179** focused CP5a–c tests before recovery-replay blocker fix.
- **CP5a (local):** **133** focused cross-layer tests + browser cancel/mark evidence.
- **CP5d (local):** coherence review, recovery-replay backend fix, **100** blocker-focused tests,
  final **`pnpm verify`**: typecheck, lint, 17 routing checks, 219 files / 1 skipped, **1,823**
  tests / 3 skipped; IDE diagnostics and diff check clean.
- **Next:** **CP6** MCP parity ([contract](cp6-mcp-parity-contract.md), CP6a grants next); **CP7** AC10. Post-CP5
  extensions (applied-revision deps, multi-check fan-out, coordination cancel, templates/workers)
  remain tracked as risks/deferrals, not open CP5 tasks.
