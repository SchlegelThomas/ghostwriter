# AGENTS.md — How to work in this repo

You are helping build **Ghostwriter**, an AI tool for creative writers. One TypeScript/Node.js
codebase that ships to web, desktop (Electron), and mobile, and also exposes itself to AI
agents via MCP.

## Start here, every session

1. Read `plans/WHERE-I-LEFT-OFF.html`, then the active plan and its `record-log.html`.
2. For product, UX, editor, Story Canvas, or workflow work, read the living design source:
   `plans/designs/Ghostwriter Mockups 2.0.html`.
3. If the user has not already directed the work, summarize **Done / Incomplete / Next** and
   ask whether to resume or start new work. Do not assume pickup.
4. For product context read `docs/PRODUCT.md`; for technical context read
   `docs/ARCHITECTURE.md`; for delivery constraints read `docs/OPERATIONS.md`.

## The planning harness

All meaningful work is documentation-first. See `plans/README.html` for the full system.

- New effort → create `plans/active/YYYY-MM-DD-short-slug/` with `plan.html` and
  `record-log.html`, following `plans/template.html`.
- A plan is not ready to build until it contains **Intent, Acceptance criteria, Tasks, Tests
  and verification, Documentation and ADR impact, Risks and decisions, and Todos**.
- Log decisions and meaningful progress in `record-log.html` as you go — this is the project's
  memory. Keep todos and acceptance status truthful.
- Done → move the folder to `plans/archive/` and update `plans/WHERE-I-LEFT-OFF.html`.
- Trivial fixes (typos, one-liners) don't need a plan.

## Living design sources

`plans/designs/` contains long-running product-design artifacts that evolve across many delivery
plans. They are durable inputs, not active plans, and are never archived with a feature.

- `plans/designs/Ghostwriter Mockups 2.0.html` is the current visual and interaction source of
  truth for the Story Canvas, manuscript/Canvas relationship, links, imagery, reader, and related
  UX. Read it before changing those experiences.
- Preserve user-authored design files. Do not replace, relocate, flatten, or regenerate them unless
  the user explicitly asks. The design file may be iterated outside the current implementation plan.
- When a living design changes, update the active plan's scope/acceptance criteria and record log
  for any affected delivery work. Do not copy the whole design into a plan.
- A design mockup expresses product intent; accepted `docs/PRODUCT.md`, architecture invariants,
  ADRs, security rules, and the active plan still govern implementation. Surface conflicts rather
  than silently choosing one source.

## Autonomous delivery loop

Once the user has accepted a plan, work independently in repeated, bounded loops:

1. Take the next coherent task from the plan.
2. Read the local code and documentation it affects.
3. Implement the smallest complete slice, including tests.
4. Run targeted checks; fix failures before continuing.
5. Update the plan, record log, affected docs, and ADRs immediately — not at the end.
6. Reassess acceptance criteria and move to the next task.

Continue until the plan is complete or a real decision requires the user. Stop and ask before
making a material product, architecture, cost, security, data-loss, or external-side-effect
choice not already accepted in the plan. Do not confuse a passing test suite with meeting the
acceptance criteria.

## Documentation and ADRs

- Plan documentation updates as tasks, alongside implementation and tests.
- Create or update an ADR under `docs/adr/` for durable decisions about architecture,
  persistence, sync, AI providers, security, deployment, or product-platform tradeoffs.
- Link each ADR from the plan's **Documentation and ADR impact** section and record its
  decision in the log.

## Ground rules

- **Keep changes focused and reversible.** Small diffs, one concern at a time.
- **Read before you write.** Understand surrounding code/docs before editing.
- **Preserve user work.** Never revert or overwrite changes you didn't make.
- **Follow existing patterns** over inventing new abstractions.
- **Verify before declaring done** — `pnpm verify` (typecheck + lint + test) must pass.
- Surface important tradeoffs early instead of silently picking a side.

## Git workflow

This repo is git- and CLI-driven. Agents are expected to drive git, not avoid it.

- **Never commit directly to `main`.** All work lands via PR with green CI.
- **One plan = one feature branch.** When you start a plan, branch from up-to-date `main`
  using the plan slug: `feat/<slug>`, `fix/<slug>`, `docs/<slug>`, or `chore/<slug>`.
- **Commit as you go** on the feature branch at logical checkpoints, with conventional
  commit messages (`feat:`, `fix:`, `docs:`, `test:`, `chore:`). Small, coherent commits.
- **Pushing, opening PRs, and merging require the user's go-ahead.** Local commits on a
  feature branch don't.
- **Tests ship with the feature.** Anything in `packages/*` with logic gets Vitest coverage
  in the same branch — not as a follow-up. During implementation, verify writer-visible work
  directly in a real browser and record the walkthrough; do not author, repair, or repeatedly run
  Playwright before the user has verified the complete planned outcome. After that explicit gate,
  audit existing journeys and add only the smallest high-value acceptance coverage. Route all new
  or rewritten tests through the model-pinned project subagents in `.cursor/agents/`, per
  `.cursor/skills/ghostwriter-autonomous-delivery/SKILL.md`: `routine-tests` (Composer 2.5 fast)
  first, and `hard-tests` (Grok 4.5) only for recorded hard escalation. Post-gate Playwright prompts
  must include `GHOSTWRITER_PLAYWRIGHT_GATE=user-verified`; `.cursor/hooks.json` enforces the gate
  and model routing.
- Keep branches short-lived; prefer finishing and merging over stacking work.

## Deployments (CLI-driven — see `docs/OPERATIONS.md`)

- "Deploy a dev version" → run `./scripts/deploy-dev.sh` from any feature branch. It builds
  the web app and publishes a per-branch preview URL on Cloudflare Pages.
- Production deploys are automatic: merge to `main` → GitHub Actions builds and deploys.
  Never deploy production manually.
- The backend (`apps/backend`) deploys to Fly.io on merge to `main` via
  `.github/workflows/deploy-backend.yml`, which first migrates the Lakebase `production` branch.
- Every pull request gets its own copy-on-write Lakebase database branch via
  `.github/workflows/db-branch.yml`; migrations run against it and it is deleted on close.
- Database migrations are Drizzle-managed and checked in (`pnpm db:generate` / `pnpm db:migrate`);
  Lakebase branch helpers live in `scripts/lakebase.sh`. See ADR 0004 and `docs/OPERATIONS.md`.
- CI (`.github/workflows/ci.yml`) runs typecheck/lint/test on every PR and push to `main`.

## Architecture invariants

These hold for all code written in this repo (details in `docs/ARCHITECTURE.md`):

1. **One codebase.** Shared TypeScript everywhere. Platform-specific code lives only in thin
   shells under `apps/`; everything else is shared packages under `packages/`.
2. **Core is platform-agnostic.** `packages/core` (domain logic, AI orchestration, document
   model) must never import from Electron, React, DOM, or mobile APIs.
3. **MCP is a first-class input.** Any capability a writer can use in the UI should be
   reachable through the MCP server too. Design features as core functions first, then bind
   them to UI and MCP.
4. **Storage is writer-owned and server-authoritative in v1.** ADR 0002 explicitly replaces the
   earlier local-first invariant for the real-time collaborative web product. The shared service
   owns canonical project state; browsers keep only minimal unacknowledged-work recovery, not a
   complete offline replica. Preserve complete history, usable export, account exit, and clear save
   state. Do not add a second canonical store or promise offline editing without a new plan and ADR.

## Conventions

- TypeScript strict mode, ESM modules.
- pnpm workspaces for the monorepo.
- Prefer plain functions and modules over classes unless state genuinely demands it.
- Name things for the writer's domain (manuscript, scene, character, draft), not generic
  CS terms, wherever it fits.

## When decisions are open

`docs/ARCHITECTURE.md` has an **Open decisions** section. If your work depends on an
undecided item, raise it with the user rather than choosing unilaterally, then record the
outcome in the current plan's `record-log.html` and update the doc.
