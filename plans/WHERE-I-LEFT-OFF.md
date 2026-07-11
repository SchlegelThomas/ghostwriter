# Where I left off

_Last updated: 2026-07-11_

## Current state

Repo is pre-code. The agentic harness is set up: `AGENTS.md`, this `plans/` system,
`docs/PRODUCT.md` (vision), and `docs/ARCHITECTURE.md` (one-codebase strategy for
web / Electron / mobile / MCP, committed stack, open decisions table).

No active plans. Setup plan archived at `plans/archive/2026-07-11-agentic-harness/`.

## Decisions so far

- 2026-07-11: **Expo / React Native** for the universal client (iOS/Android/web via
  react-native-web); Electron wraps the Expo web export. The rich-text editor stays
  DOM-based in `packages/editor`, hosted via Expo DOM components on native.
- 2026-07-11: **Tiptap (ProseMirror)** for the editor engine.
- 2026-07-11: **GitHub Actions + Cloudflare Pages** for CI/CD and web hosting; feature-branch
  git workflow encoded in `AGENTS.md`; dev deploys via `scripts/deploy-dev.sh`, prod deploys
  auto on merge to main. See `docs/OPERATIONS.md`.

## Next step

1. **One-time ops setup** (user, ~10 min): Cloudflare account, `wrangler login`, create the
   Pages project, set `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` repo secrets, protect
   `main`. Exact commands in `docs/OPERATIONS.md`.
2. Commit the harness to `main` as the bootstrap commit, then all future work on feature
   branches per `AGENTS.md`.
3. Scaffold the monorepo (first feature branch): pnpm workspaces, `packages/core` with
   strict TS + Vitest, stub `apps/mcp`, `pnpm verify` script wired so CI goes live.

## Open questions for the user

- Which surface to build first for fastest feedback (suggest: MCP + core, since it's
  UI-free and proves the architecture).
- Build tooling (Vite/Turborepo) — confirm when scaffolding.
