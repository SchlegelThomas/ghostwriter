---
name: ghostwriter-autonomous-delivery
description: Delivers substantial Ghostwriter product features in autonomous vertical loops with planning records, domain and living-design audits, cumulative coherence reviews, verification, and checkpoint commits. Use whenever implementing or refactoring Ghostwriter domain, storage, API, editor, Canvas, UI, or writer workflows.
---

# Ghostwriter Autonomous Delivery

Use this skill for meaningful Ghostwriter implementation. It supplements `AGENTS.md`; repository
rules, accepted ADRs, and explicit user direction remain authoritative.

## Start

1. Read `AGENTS.md`, `plans/WHERE-I-LEFT-OFF.html`, the active plan and record log.
2. Read `docs/PRODUCT.md`, `docs/ARCHITECTURE.md`, and `docs/OPERATIONS.md` where relevant.
3. For product, UX, editor, Canvas, reader, or workflow work, read
   `plans/designs/Ghostwriter Mockups 2.0.html`.
4. Copy the feature checkpoint from [FEATURE-CHECKLIST.md](FEATURE-CHECKLIST.md) into working notes.
5. Make the plan truthful before product code: intent, acceptance, tasks, tests, docs/ADR impact,
   risks, and todos.

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

## Implement inside-out

For each checkpoint:

1. Update the active plan/record with the selected outcome and any decision.
2. Implement core types, invariants, commands/queries, and repository ports.
3. Implement memory and Postgres adapters plus forward migration when persistence changes.
4. Bind authenticated backend contracts with bounded payloads and stable content-free errors.
5. Bind client state and UI from the living design; preserve keyboard and screen-reader parity.
6. Update capabilities and MCP parity/exception records.
7. Add targeted unit, contract, integration, and state tests via the **test authorship routing**
   below.
8. Walk the observable outcome in a real browser and record what was exercised.
9. Run the checkpoint verification ladder.
10. Perform the cumulative coherence review.
11. Update docs and the record log immediately.
12. If commits are authorized, create one conventional checkpoint commit.

Never let a transport mutate canonical tables around core policy. Never route prose autosave,
project metadata, and Canvas gestures through one coarse version.

## Test authorship routing

When a checkpoint needs new or materially rewritten tests (Vitest unit/integration, repository
contracts, backend route suites, or post-acceptance Playwright journeys), do **not** author or
repeatedly repair them inline in the parent agent. Cursor cannot switch the parent model
automatically; deterministic routing happens by delegating to a model-pinned project subagent:

| Route | Project subagent | Resolved model | Use when |
|---|---|---|---|
| Routine | `routine-tests` | Composer 2.5 fast | Every new/rewritten unit, contract, integration, or post-acceptance Playwright test; ordinary failure triage, selectors, waits, and fixtures |
| Hard escalation | `hard-tests` | Grok 4.5 | Concurrency/lease/version races, migration/parity, accessibility-critical cross-surface behavior, or two distinct evidence-backed Composer repairs that failed |

Project definitions live in `.cursor/agents/`. Every task prompt must include exactly one routing
marker:

- `GHOSTWRITER_TEST_ROUTING=routine`
- `GHOSTWRITER_TEST_ROUTING=hard ESCALATION_REASON=<reason>`

When named project subagents are unavailable in the current tool schema, use a regular Subagent
with explicit model `composer-2.5-fast` or `cursor-grok-4.5-high-fast` and the same marker. The
project `subagentStart` hook validates the resolved model and denies mismatches.

### Browser-first product verification and deferred Playwright

During implementation, verify writer-visible work in a real browser instead of continually
authoring or repairing Playwright:

1. Define one writer-visible behavior, its refusal state, and the browser walkthrough.
2. Start the local product, exercise the successful and refusal paths in the browser, and inspect
   responsive layout, focus, save truth, and errors directly. Record the route, viewport, actions,
   and observed result in the feature log.
3. Fix product defects found by the walkthrough. Do not create or repair Playwright yet, and do not
   spend implementation loops chasing stale end-to-end selectors.
4. After all planned implementation checkpoints pass targeted checks and `pnpm verify`, present the
   complete product outcome to the user for verification.
5. Playwright authoring, repair, and full-suite work begins only after the user explicitly verifies
   the complete outcome. Every such subagent prompt must include
   `GHOSTWRITER_PLAYWRIGHT_GATE=user-verified` in addition to exactly one test-routing marker.
6. At that gate, audit existing journeys first. Update or add only the smallest high-value
   acceptance coverage for durable writer workflows; prefer extending a coherent journey over
   accumulating one spec per implementation checkpoint.
7. Run one focused journey first. Permit at most **two** distinct Composer repair attempts, each
   using new evidence. Escalate once to `hard-tests` only with a recorded reason and evidence (or
   immediately for an intrinsically hard race/migration/parity case).
8. If the focused test still fails after the bounded loop, stop and reassess product behavior or
   architecture. Run the full Playwright suite once only after focused green.

Parent agent remains responsible for:

- stating the writer-visible outcome, refusal cases, and exact files/APIs under test;
- reviewing the returned tests for domain truth (no false greens, no selector-only assertions);
- recording route, model, attempt count, focused command/result, user-verification gate, and
  escalation reason;
- running the broader verification ladder after focused green evidence.

Keep the parent on implementation, coherence, and docs. Prefer one bounded test subagent per layer
or journey rather than a sprawling “write all tests” prompt.

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

## Autonomous decisions and check-ins

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
- no new diagnostics or secret artifacts exist;
- the checkpoint is committed when authorized.
