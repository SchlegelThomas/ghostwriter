# Ghostwriter — Operations

How code gets built, tested, and deployed. Everything is git- and CLI-driven so both humans
and AI agents can operate it from a terminal. The static web scaffold costs **$0**. ADR 0004
selects the server-authoritative backend required by ADR 0002: a Databricks Lakebase Postgres
database with Drizzle migrations, a Node/Hono service, and a database branch per pull request.

## Hosting decisions (2026-07-11)

| Concern | Choice | Why |
|---|---|---|
| Repo + CI/CD | GitHub + GitHub Actions | Repo already lives here; public repo → Actions free, no minute cap |
| Web hosting | Cloudflare Pages | Free unlimited bandwidth, per-branch preview URLs, `wrangler` direct-upload deploys from any machine |
| Database | Databricks Lakebase (serverless Postgres) | ADR 0004: standard Postgres, copy-on-write branch per PR, OAuth-token auth, portable |
| Backend service | Node/Hono on Fly.io | Container deploy with a direct TCP path to Lakebase; thin shell over `packages/core` |
| Migrations | Drizzle Kit (checked-in SQL) | `pnpm db:migrate`; applied in CI on PR branches and on deploy to production |
| Identity | Better Auth + Google on the Hono service | ADR 0005; opaque Postgres sessions and provider-neutral writer profiles |
| Browser API | Cloudflare Pages Function → Fly.io | Same-origin `/api/*` keeps auth cookies first-party and streams to the fixed backend |
| Mobile builds (later) | Expo EAS free tier | ~30 builds/month free; EAS Update for OTA fixes |
| Desktop distribution (later) | GitHub Releases | electron-builder artifacts attached by Actions, free |
| MCP server | Runs locally (stdio) | No hosting needed; distribute via `npx` when it stabilizes |

Expected future costs are Lakebase/Fly usage beyond their available tiers and Apple's $99/yr
developer account once iOS device/TestFlight builds start. Cloudflare Pages is used in
**direct-upload** mode (we build
in Actions or locally and push the artifact with `wrangler`), so Cloudflare's build-minute
limits never apply.

## Environments and flows

### Authentication and same-origin API (ADR 0005)

The public web origin is `https://ghostwriter-di2.pages.dev`. Its Pages Function handles only
`/api/*` and streams those requests to `https://ghostwriter-backend.fly.dev`; static asset requests
do not traverse the function. Better Auth therefore sets first-party cookies for the Pages origin
instead of relying on third-party `pages.dev` → `fly.dev` cookies.

The dedicated Google Cloud project is `ghostwriter-app-2026` (display name `Ghostwriter`), owned
by `tas9117@gmail.com`. Keep consumer OAuth branding and client configuration in this project;
do not reuse an unrelated Google Cloud project.

Production Google web-client configuration:

- Authorized JavaScript origin: `https://ghostwriter-di2.pages.dev`
- Authorized redirect URI:
  `https://ghostwriter-di2.pages.dev/api/auth/callback/google`
- Better Auth public URL and trusted origin: `https://ghostwriter-di2.pages.dev`

Local live-provider smoke configuration:

- Client: `EXPO_PUBLIC_API_URL=http://localhost:8787 pnpm --filter client web`
- Backend: `BETTER_AUTH_URL=http://localhost:8787` and
  `AUTH_TRUSTED_ORIGINS=http://localhost:8081,http://localhost:8787`
- Authorized JavaScript origins: `http://localhost:8081`, `http://localhost:8787`
- Authorized redirect URI: `http://localhost:8787/api/auth/callback/google`

The backend requires `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, and `GOOGLE_CLIENT_SECRET` as Fly
secrets. Set them without putting values in command arguments or shell history:

```bash
fly secrets import --app ghostwriter-backend --stage
# Enter NAME=VALUE lines through the interactive stdin, then Ctrl-D.
# Deploy the staged values with the feature release.
```

`BETTER_AUTH_URL` and `AUTH_TRUSTED_ORIGINS` are non-secret values in
`apps/backend/fly.toml`. Google requires exact redirect registration and has no wildcard branch
callback, so required CI uses the hermetic identity boundary; a real Google login is a separate
local or production acceptance check. The test identity server refuses to start unless
`GHOSTWRITER_E2E=1` and is never part of the production entry point.

Validated locally on 2026-07-12 against a temporary migrated Lakebase branch: real Google consent,
durable account/profile bootstrap, project creation and reload, and sign-out with zero remaining
server sessions. The temporary branch and downloaded credential files were deleted afterward.
The three Fly auth secrets are staged for the normal feature release; no production deployment was
performed manually.

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

Storage and backend tests run against **PGlite** (in-process Postgres), so `pnpm verify` needs no
database or cloud credentials — CI and forks stay green without Databricks access.

## Database, migrations, and CI branches (ADR 0004)

The canonical store is a Databricks Lakebase Autoscaling project exposing standard Postgres.
Production data lives on the `production` branch; every PR gets its own copy-on-write branch.

### Migrations

Schema lives in `packages/storage/src/schema.ts`. Regenerate SQL after schema changes and apply it:

```bash
pnpm db:generate                 # writes packages/storage/drizzle/*.sql (commit these)
DATABASE_URL=postgres://… pnpm db:migrate
```

Migrations are checked into git, applied to each PR's Lakebase branch in CI, and applied to
`production` on deploy. They are forward-only.

### Per-PR database branches

`.github/workflows/db-branch.yml` creates `pr-<number>` from `production` (with a TTL), migrates it,
and deletes it when the PR closes. It is driven by `scripts/lakebase.sh`, which wraps the Databricks
CLI:

```bash
# local, using the "ghostwriter" CLI profile
export DATABRICKS_PROFILE=ghostwriter
export LAKEBASE_PROJECT_ID=<project-id> LAKEBASE_USER=<pg-identity>
scripts/lakebase.sh create-branch pr-123 172800
scripts/lakebase.sh migrate pr-123
scripts/lakebase.sh delete-branch pr-123
```

### Backend deploy — automatic on merge to main

`.github/workflows/deploy-backend.yml` migrates `production` and deploys `apps/backend` to Fly.io.
Both the branch and deploy workflows no-op until secrets/variables are configured.

### Provisioned Lakebase resources (2026-07-11)

| Field | Value |
|---|---|
| Project | `projects/ghostwriter` (`LAKEBASE_PROJECT_ID=ghostwriter`) |
| Default branch | `production` (source for PR branches) |
| Endpoint | `primary` (read-write) |
| Region / PG | AWS `us-east-2`, Postgres 17 |
| Direct host | `ep-dawn-forest-d8ffu38j.database.us-east-2.cloud.databricks.com` (use this — see note) |
| Pooled host | `…-pooler…` — do **not** use: the pooler rejects OAuth-token SASL (Postgres `08P01`) |
| Deployed backend | `https://ghostwriter-backend.fly.dev` (`/health` ok; SP OAuth M2M verified) |
| Owner role | `tas9117@gmail.com` (`LAKEBASE_USER` for local runs via the `ghostwriter` profile) |

Validated end-to-end on 2026-07-11: a throwaway branch was created from `production`, migrated with
`scripts/lakebase.sh migrate`, and deleted.

### CI credential status (2026-07-11)

Provisioned and wired automatically:

- Service principal **`ghostwriter-ci`** — client id `a4622cb7-c206-4ace-a085-2b9ecdf98b37`.
- Its Postgres role on `production` with `CREATE`/table privileges (migrations can run as the SP).
- GitHub secrets `DATABRICKS_HOST`, `DATABRICKS_CLIENT_ID`; variables `LAKEBASE_PROJECT_ID`,
  `LAKEBASE_USER` (= SP client id), `LAKEBASE_ENDPOINT_ID`.

Provisioning is complete: `DATABRICKS_CLIENT_SECRET` and `FLY_API_TOKEN` are configured, the Fly
app is deployed, and the backend authenticates to Lakebase with the service principal. The current
Databricks service-principal secret was entered directly in local shell history during initial
provisioning; the founder accepted rotating it later. Rotation remains required security hygiene
but is not an auth-epic deployment blocker by founder direction.

### Backend database connection

The long-running backend uses service-principal OAuth (`DATABRICKS_CLIENT_ID`/`_SECRET`) and mints a
fresh Lakebase credential on demand via `POST /oidc/v1/token` → `POST /api/2.0/postgres/credentials`,
caching it until just before expiry (`packages/storage/src/lakebase.ts`). Local dev and CI migrations
still use a plain `DATABASE_URL` or `PG*` variables.

### Required GitHub configuration

Secrets: `DATABRICKS_HOST`, `DATABRICKS_CLIENT_ID`, `DATABRICKS_CLIENT_SECRET` (service principal),
`FLY_API_TOKEN`. Fly runtime secrets additionally include `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`,
and `GOOGLE_CLIENT_SECRET`. Variables: `LAKEBASE_PROJECT_ID`, `LAKEBASE_USER`, and optionally
`LAKEBASE_ENDPOINT_ID` (default `primary`).

```bash
gh secret set DATABRICKS_HOST
gh secret set DATABRICKS_CLIENT_ID
gh secret set DATABRICKS_CLIENT_SECRET
gh secret set FLY_API_TOKEN
gh variable set LAKEBASE_PROJECT_ID
gh variable set LAKEBASE_USER
```

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
| "generate a migration" | `pnpm db:generate` |
| "run migrations" | `pnpm db:migrate` (needs `DATABASE_URL` or `PG*`) |
| "branch the database" | `scripts/lakebase.sh create-branch <id> [ttl]` |
| "ship it" / "open a PR" | `git push -u origin HEAD && gh pr create` |
| "release desktop build" (later) | tag push → Actions → GitHub Release |
| "push a mobile update" (later) | `eas update` |
