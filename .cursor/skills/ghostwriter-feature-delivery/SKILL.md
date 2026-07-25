---
name: ghostwriter-feature-delivery
description: Delivers Ghostwriter product features and epics in vertical checkpoints with planning records, domain and living-design audits, parent-owned end-to-end acceptance, parallel research, Composer/Grok delegation for most development, coherence reviews, verification, and checkpoint commits. Use whenever implementing or refactoring Ghostwriter domain, storage, API, editor, Canvas, UI, or writer workflows.
---

# Ghostwriter Feature Delivery

Use this skill for meaningful Ghostwriter implementation. It supplements `AGENTS.md`; repository
rules, accepted ADRs, and explicit user direction remain authoritative.

Trivial fixes (typos, one-liners) do not need this skill or a plan.

## Start

1. Read `AGENTS.md`, `plans/WHERE-I-LEFT-OFF.html`, the active plan and record log.
2. Read `docs/PRODUCT.md`, `docs/ARCHITECTURE.md`, and `docs/OPERATIONS.md` where relevant.
3. For product, UX, editor, Canvas, reader, or workflow work, read the living design that owns
   the surface (`plans/designs/Ghostwriter Mockups 2.0.html`, `3.0.html`, `4.0.html`, or
   `5.0.html`).
4. Copy the feature checkpoint from [FEATURE-CHECKLIST.md](FEATURE-CHECKLIST.md) into working notes.
5. Make the plan truthful before product code: intent, acceptance, tasks, tests, docs/ADR impact,
   risks, and todos.

## Parent owns end-to-end

The parent (session) model owns the checkpoint end-to-end even when work is delegated.

Use the parent for analysis, planning, domain/design judgment, breakdown into bounded slices,
synthesis of subagent returns, coherence review, browser-walkthrough framing, documentation truth,
and acceptance. Do not declare a checkpoint done because a subagent returned green.

Before delegating development or validation, the parent must frame each slice with:

- writer-visible outcome and refusal cases;
- exact files/APIs and non-goals;
- constraints from the plan/ADRs;
- success checks and, when relevant, a focused command.

Prefer spending parent capacity on planning quality and breakdown quality so Composer/Grok can
execute efficiently.

## Choose one observable feature

A feature checkpoint must produce a writer-visible outcome or a necessary independently verified
foundation. Keep each checkpoint reversible even when the epic is large.

Examples:

- “Rename/reorder a chapter from the manuscript tree and receive an acknowledged toast.”
- “Drill from project Canvas into one chapter and return with selection preserved.”
- “Open a bound-reader spread from Draft and return to the same scene.”
- “Create one scene from Canvas placement through the atomic handoff.”

Do not define checkpoints as layers alone (“add tables”, “add routes”) unless they unblock a
specific next observable checkpoint and have their own contract tests.

## Audit domain and design before editing

For the feature, inventory:

- canonical domain objects, ownership, IDs, and relationships;
- state transitions, refusal rules, archive/restore, and history;
- concurrency domain and expected precondition;
- storage rows, migrations, transaction boundary, and rollback;
- API requests/responses/errors and authorization;
- Draft, Canvas, reader, tree, inspector, narrow, and accessibility behavior;
- capability registry and MCP binding or explicit security exception;
- documentation and ADR consequences.

State which source is authoritative when design language conflicts with ADRs. Never infer that
Canvas order is manuscript order, that browser recovery is offline storage, or that a proposal is
canonical.

## Parallel work

Parallelize reading and well-framed delegated slices that do not share write targets. Serialize
anything that mutates the same canonical rows or version domains.

| Work | Parallel? | Who / model |
|---|---|---|
| Read-only codebase, design, or ADR digs | Yes — fan out early | `explore` (fast) |
| Independent inventories that do not share write targets | Yes | `explore` or scoped Task |
| Living-design vs architecture conflict scan | Yes with research | Parent synthesizes |
| Analysis, planning, and slice breakdown | No | Parent |
| Bounded development / validation after parent frames it | Yes if write targets differ | `delegate-composer` / `delegate-grok` |
| Shared canonical rows/version domains for one checkpoint | No — serial | Parent frames; one writer at a time |
| Coherence review, browser walkthrough framing, docs truth, acceptance | No | Parent |
| Single failing CI check diagnosis | Optional one-shot | `ci-investigator` |

Do not run two writers against the same files or version domains. Parent owns synthesis when
parallel research or delegates return conflicting findings.

## Delegation ladder

Cursor cannot switch the parent model mid-session. Route most development and some validation
through pinned project subagents. Keep analysis and planning on the parent.

Effort is not a separate Task parameter—choose it with the model variant (slug or
`model[fast=…]` / `[effort=…]` brackets). The parent picks **route + effort** together.

| Route | Effort | Project subagent | Model pin | Use when |
|---|---|---|---|---|
| Composer | `fast` (default) | `delegate-composer` | `composer-2.5[fast=true]` | Default well-framed implementation, ordinary repairs, routine tests, post-gate Playwright |
| Composer | `standard` | `delegate-composer-standard` | `composer-2.5[fast=false]` | Denser Composer slice after fast thrash, before Grok |
| Grok | `high-fast` (default) | `delegate-grok` | `grok-4.5` / `cursor-grok-4.5-high-fast` | Stronger efficient tier when Composer fast/standard is insufficient |
| Escalate Opus | `high` (default) | `escalate-opus` | `claude-opus-5-thinking-high` | Creative/design-sensitive escalation |
| Escalate GPT | `sol` (default) | `escalate-gpt` | `gpt-5.6-sol-medium` | Concrete escalation (races, migrations, contracts, types) |
| Escalate GPT | `terra` | `escalate-gpt-terra` | `gpt-5.6-terra-medium` | Stubborn concrete escalation after Sol |

Escalation split:

- **Opus** → creative work (living-design interpretation, design-sensitive UI, product voice).
- **GPT 5.6** → concrete work (concurrency, migrations, contracts, type/protocol puzzles).

Every delegated task prompt must include exactly one route marker, plus effort when not the
default:

- `GHOSTWRITER_ROUTE=composer` (`GHOSTWRITER_EFFORT=fast` optional default; `GHOSTWRITER_EFFORT=standard` for standard)
- `GHOSTWRITER_ROUTE=grok` (`GHOSTWRITER_EFFORT=high-fast` optional)
- `GHOSTWRITER_ROUTE=escalate-opus ESCALATION_REASON=<reason>` (`GHOSTWRITER_EFFORT=high` optional)
- `GHOSTWRITER_ROUTE=escalate-gpt ESCALATION_REASON=<reason>` (`GHOSTWRITER_EFFORT=sol` optional; `GHOSTWRITER_EFFORT=terra` for Terra)

When named project subagents are unavailable, use a regular Subagent with the matching explicit
model variant and the same markers. The project `subagentStart` hook validates route, effort, and
model together.

Bugbot / security review remain explicit user-ask only.

## Implement inside-out

For each checkpoint:

1. Update the active plan/record with the selected outcome and any decision.
2. Fan out read-only research when the domain map is unclear; synthesize before editing.
3. On the parent, design the vertical slice and break it into bounded delegate frames.
4. Delegate most development and focused validation through the ladder above; keep one writer per
   shared version domain.
5. Parent reviews returns for domain truth, closes “parent still owns” items, and stitches the
   vertical slice (core → storage → API → UI → capabilities/MCP).
6. Walk the observable outcome in a real browser and record what was exercised.
7. Run the checkpoint verification ladder.
8. Perform the cumulative coherence review.
9. Update docs and the record log immediately.
10. If commits are authorized, create one conventional checkpoint commit.

Never let a transport mutate canonical tables around core policy. Never route prose autosave,
project metadata, and Canvas gestures through one coarse version.

### Browser-first product verification and deferred Playwright

During implementation, verify writer-visible work in a real browser instead of continually
authoring or repairing Playwright:

1. Define one writer-visible behavior, its refusal state, and the browser walkthrough.
2. Start the local product, exercise the successful and refusal paths in the browser, and inspect
   responsive layout, focus, save truth, and errors directly. Record the route, viewport, actions,
   and observed result in the feature log.
3. Fix product defects found by the walkthrough. Do not create or repair Playwright yet.
4. After all planned implementation checkpoints pass targeted checks and `pnpm verify`, present the
   complete product outcome to the user for verification.
5. Playwright authoring, repair, and full-suite work begins only after the user explicitly verifies
   the complete outcome. Every such subagent prompt must include
   `GHOSTWRITER_PLAYWRIGHT_GATE=user-verified` in addition to exactly one route marker.
6. At that gate, audit existing journeys first. Update or add only the smallest high-value
   acceptance coverage for durable writer workflows.
7. Run one focused journey first. Prefer Composer, then Grok, then one recorded escalate
   (`escalate-gpt` for concrete flake/race/parity; `escalate-opus` only if the failure is
   design/UX-sensitive).
8. If the focused test still fails after the bounded loop, stop and reassess product behavior or
   architecture. Run the full Playwright suite once only after focused green.

The parent remains responsible for end-to-end acceptance, route/model audit notes, and the broader
verification ladder after focused green evidence.

## Delegated-task return shape

Every Task or project subagent must return:

- outcome attempted;
- files touched (or none);
- evidence (focused command + result, or walkthrough notes);
- open risks / what the parent must still do;
- stop reason (`done`, `blocked`, or `escalate`).

The parent may not check a plan todo or claim a checkpoint until:

1. checklist domains for that checkpoint are addressed or listed as explicit non-goals;
2. applicable verification-ladder steps have evidence in the record log;
3. every delegated “parent still owns” item is closed or explicitly deferred with a reason.

## Cumulative coherence review

After every feature, review the whole built product—not only the new diff:

- **Domain:** no duplicate truth, dangling references, hidden cascades, or authority confusion.
- **State:** project metadata, scene working revision, Canvas board, recovery, and UI selection agree.
- **Persistence:** memory/Postgres parity, stable canonical rows, migration-from-empty, rollback.
- **API:** authorization, non-disclosure, preconditions, payload limits, stable errors.
- **Experience:** tree, Draft, Canvas, reader, split, history, and handoffs share canonical IDs.
- **Save truth:** success only after acknowledgement; conflicts apply nothing; recovery is explicit.
- **Accessibility:** keyboard path, focus transfer, semantic labels, reduced motion, narrow posture.
- **Capabilities:** UI/backend/core bindings are recorded; MCP mutation exceptions stay explicit.
- **Docs:** plan, record, handoff, product/architecture/API/operations and ADRs are current.
- **Regression:** every prior accepted feature still works in targeted checks and the browser
  walkthrough; post-user-verification Playwright covers the final acceptance set.

Fix coherence regressions before starting the next feature.

## Verification ladder

Use the smallest useful check first, then expand:

1. Changed-file diagnostics and focused unit tests.
2. Affected package typechecks and repository/backend integration tests.
3. Real-browser walkthrough of the checkpoint at the relevant wide/narrow postures.
4. `pnpm verify`.
5. `git diff --check` and changed-document link/structure validation.
6. User verification of the complete planned product outcome.
7. After that explicit gate only: focused Playwright acceptance, then one full
   `pnpm test:e2e` run.

Do not mark acceptance complete from typecheck alone. Before the user gate, record exact automated
evidence and browser walkthrough observations. After the gate, record focused/full Playwright
results and test counts.

## Documentation loop

Update alongside implementation:

- active `plan.html` checkbox and acceptance truth;
- `record-log.html` decision, behavior, risks, and evidence;
- `plans/WHERE-I-LEFT-OFF.html` after milestone or changed next step;
- `docs/API.md` for transport;
- `docs/ARCHITECTURE.md` and an ADR for durable boundaries;
- `docs/PRODUCT.md` for accepted/delivered experience;
- `docs/OPERATIONS.md` for migrations, secrets, deploy, recovery, or monitoring.

Preserve the living design. Additive proposals require explicit user direction and remain labeled
until accepted.

## When to proceed vs check in

Proceed without interruption for reversible choices inside accepted plans and ADRs. Use existing
patterns and the smallest coherent implementation.

Stop for:

- material product, architecture, security, cost, retention, or data-loss choices;
- conflicting sources of truth;
- visual review gates explicitly requested by the user;
- authentication or console-only interaction;
- push, PR, merge, deployment, or external messages without current authorization.

An unchanged external wait is not failure. Continue bounded local work where safe.

## Checkpoint commits

Only commit when the user has authorized commits for the current effort.

- Commit one coherent feature plus tests/docs.
- Use conventional messages and repository style.
- Never include secrets, downloaded OAuth clients, local recovery data, or test artifacts.
- Verify the worktree and staged diff before committing.
- Do not push, open a PR, merge, or deploy unless separately authorized.

## Improve this skill

After every checkpoint:

1. Note repeated friction, missed context, weak tests, or a coherence defect.
2. Decide whether the fix belongs in code, plan templates, repository rules, or this skill.
3. Update this skill only with reusable guidance; move detail to the reference checklist.
4. Validate the skill and record the harness change in the active feature log.

Do not turn one feature’s implementation detail into permanent process.

## Done

A checkpoint is done only when:

- the writer-visible outcome and refusal/error states work;
- domain/storage/API/client tests pass;
- prior features remain coherent;
- docs and plan truth match the implementation;
- delegated return items the parent still owned are closed;
- verification-ladder evidence is recorded for applicable steps;
- no new diagnostics or secret artifacts exist;
- the checkpoint is committed when authorized.
