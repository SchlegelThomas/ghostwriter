# AGENTS.md — How to work in this repo

You are helping build **Ghostwriter**, an AI tool for creative writers. One TypeScript/Node.js
codebase that ships to web, desktop (Electron), and mobile, and also exposes itself to AI
agents via MCP.

## Start here, every session

1. Read `plans/WHERE-I-LEFT-OFF.md`.
2. If a plan exists in `plans/active/`, summarize **Done / Incomplete / Next** to the user
   and ask whether to resume or start new work. Do not assume pickup.
3. For product context read `docs/PRODUCT.md`; for technical context read `docs/ARCHITECTURE.md`.

## The planning harness

All meaningful work goes through a lightweight plan. See `plans/README.md` for the full system.
Short version:

- New effort → create `plans/active/YYYY-MM-DD-short-slug/` containing `plan.md` and `record-log.md`.
- Log decisions and meaningful progress in `record-log.md` as you go — this is the project's memory.
- Done → move the folder to `plans/archive/` and update `plans/WHERE-I-LEFT-OFF.md`.
- Trivial fixes (typos, one-liners) don't need a plan.

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
  in the same branch — not as a follow-up.
- Keep branches short-lived; prefer finishing and merging over stacking work.

## Deployments (CLI-driven — see `docs/OPERATIONS.md`)

- "Deploy a dev version" → run `./scripts/deploy-dev.sh` from any feature branch. It builds
  the web app and publishes a per-branch preview URL on Cloudflare Pages.
- Production deploys are automatic: merge to `main` → GitHub Actions builds and deploys.
  Never deploy production manually.
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
4. **Storage is local-first.** Writers own their words. Don't add cloud dependencies for
   core writing features without an explicit decision recorded in a plan.

## Conventions

- TypeScript strict mode, ESM modules.
- pnpm workspaces for the monorepo.
- Prefer plain functions and modules over classes unless state genuinely demands it.
- Name things for the writer's domain (manuscript, scene, character, draft), not generic
  CS terms, wherever it fits.

## When decisions are open

`docs/ARCHITECTURE.md` has an **Open decisions** section. If your work depends on an
undecided item, raise it with the user rather than choosing unilaterally, then record the
outcome in the current plan's `record-log.md` and update the doc.
