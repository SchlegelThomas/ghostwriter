# Where I left off

_Last updated: 2026-07-11_

## Current state

Repo is pre-code. The agentic harness, CI/CD, and deployment credentials are ready:
`AGENTS.md`, this `plans/` system, GitHub Actions, protected `main`, and Cloudflare Pages.
See `docs/PRODUCT.md`, `docs/ARCHITECTURE.md`, and `docs/OPERATIONS.md`.

No active plans after `chore/activate-cicd` merges. Prior work is archived in
`plans/archive/`.

## Decisions so far

- 2026-07-11: **Expo / React Native** for the universal client (iOS/Android/web via
  react-native-web); Electron wraps the Expo web export. The rich-text editor stays
  DOM-based in `packages/editor`, hosted via Expo DOM components on native.
- 2026-07-11: **Tiptap (ProseMirror)** for the editor engine.
- 2026-07-11: **GitHub Actions + Cloudflare Pages** for CI/CD and web hosting; feature-branch
  git workflow encoded in `AGENTS.md`; dev deploys via `scripts/deploy-dev.sh`, prod deploys
  auto on merge to main. CI is a required, up-to-date check on `main`, which is protected
  for all users. Cloudflare credentials are stored as GitHub secrets. See `docs/OPERATIONS.md`.

## Next step

1. Merge `chore/activate-cicd` to archive the completed CI/CD activation plan.
2. Scaffold the monorepo (first product feature branch): pnpm workspaces, `packages/core` with
   strict TS + Vitest, stub `apps/mcp`, `pnpm verify` script wired so CI goes live.
3. The first client branch will validate the Cloudflare Pages credentials with a real web export.

## Open questions for the user

- Which surface to build first for fastest feedback (suggest: MCP + core, since it's
  UI-free and proves the architecture).
- Build tooling (Vite/Turborepo) — confirm when scaffolding.
