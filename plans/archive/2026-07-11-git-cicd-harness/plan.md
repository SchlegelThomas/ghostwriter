# Git workflow, CI/CD, and hosting harness

**Goal:** Encode git hygiene + testing rules into the harness, and set up an agent/CLI-driven
deploy story: dev deploys from any feature branch, production deploys on merge to main, all
on free/cheap hosting.
**Status:** done

## Approach
GitHub (already the remote) for repo + Actions CI. Cloudflare Pages for web hosting: free
unlimited bandwidth, per-branch preview URLs, and `wrangler` CLI direct-upload — which makes
"deploy a dev version" a single command from any local branch. Prod deploy is a GitHub Action
on push to main. Mobile (EAS) and desktop (GitHub Releases) deferred until those shells exist.
Workflows are guarded so they no-op gracefully until the monorepo is scaffolded.

## Checklist
- [x] Record editor decision (Tiptap/ProseMirror) in ARCHITECTURE.md
- [x] AGENTS.md: feature-branch workflow, commit conventions, tests-with-features, verify step
- [x] docs/OPERATIONS.md: hosting decisions, deploy flows, costs, one-time setup
- [x] .github/workflows/ci.yml (PR checks) + deploy-web-production.yml (main → prod)
- [x] scripts/deploy-dev.sh — agent-invokable dev deploy from any branch
- [x] Update WHERE-I-LEFT-OFF, archive plan
