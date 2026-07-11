# Ghostwriter — Operations

How code gets built, tested, and deployed. Everything is git- and CLI-driven so both humans
and AI agents can operate it from a terminal. The current static scaffold costs **$0**; ADR 0002
requires a future server-authoritative shared-project backend whose provider and cost are not yet
selected.

## Hosting decisions (2026-07-11)

| Concern | Choice | Why |
|---|---|---|
| Repo + CI/CD | GitHub + GitHub Actions | Repo already lives here; public repo → Actions free, no minute cap |
| Web hosting | Cloudflare Pages | Free unlimited bandwidth, per-branch preview URLs, `wrangler` direct-upload deploys from any machine |
| Shared project backend | Open decision | Required for v1 identity, canonical project state, real-time editorial updates, backup, and account exit |
| Mobile builds (later) | Expo EAS free tier | ~30 builds/month free; EAS Update for OTA fixes |
| Desktop distribution (later) | GitHub Releases | electron-builder artifacts attached by Actions, free |
| MCP server | Runs locally (stdio) | No hosting needed; distribute via `npx` when it stabilizes |

Expected future costs are the shared backend selected in the upcoming architecture spike and
Apple's $99/yr developer account once iOS device/TestFlight builds start. Cloudflare Pages is
used in **direct-upload** mode (we build
in Actions or locally and push the artifact with `wrangler`), so Cloudflare's build-minute
limits never apply.

## Environments and flows

### Dev deploy — any local feature branch, on demand

```bash
./scripts/deploy-dev.sh
```

Builds the Expo web export and publishes it to Cloudflare Pages under the current branch
name. You get a stable preview URL per branch, e.g.
`https://feat-story-bible.ghostwriter-abc.pages.dev`. Re-running updates the same URL.
This is what "deploy a dev version" means; agents should run it when asked.

### Production deploy — automatic on merge to main

`.github/workflows/deploy-web-production.yml` triggers on push to `main`, builds the web
export, and deploys it to the Pages production environment. No manual production deploys.

### CI — every PR and push to main

`.github/workflows/ci.yml` runs `pnpm verify` (typecheck + lint + test). Merging requires
green CI. Both workflows are guarded to no-op until the monorepo is scaffolded
(they check for `package.json`), so they won't fail on docs-only work in the meantime.

## Setup status

Completed 2026-07-11:

- Cloudflare Pages project created and Git-integrated Cloudflare builds disconnected. GitHub
  Actions is the sole deployment path.
- `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` configured as GitHub repository secrets.
- `main` protected for all users: current `checks` CI status is required; force-pushes and
  branch deletion are disabled.

For another development machine:

```bash
npm i -g wrangler
wrangler login
```

To rotate a Cloudflare credential:

```bash
gh secret set CLOUDFLARE_API_TOKEN
gh secret set CLOUDFLARE_ACCOUNT_ID
```

## Command cheat sheet

| Ask the agent | It runs |
|---|---|
| "deploy a dev version" | `./scripts/deploy-dev.sh` |
| "verify the build" | `pnpm verify` |
| "ship it" / "open a PR" | `git push -u origin HEAD && gh pr create` |
| "release desktop build" (later) | tag push → Actions → GitHub Release |
| "push a mobile update" (later) | `eas update` |
