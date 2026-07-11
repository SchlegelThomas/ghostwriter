# 0004: Lakebase Postgres backend, migrations, and branch-based CI/CD

- Status: accepted
- Date: 2026-07-11
- Plan: `plans/active/2026-07-11-backend-lakebase-cicd/plan.html`
- Related: ADR 0002 (server-authoritative online-only v1), ADR 0003 (multi-book domain boundaries)

## Context

ADR 0002 made the shared project store server-authoritative and left the concrete backend
runtime, database, migrations, and operations as open decisions. The founder directed us to
select and wire that backend now: a PostgreSQL database on Databricks Lakebase, version-controlled
migrations, and CI/CD that gives each feature branch / pull request an isolated database using
Lakebase's git-style branching, before evaluating auth, profiles, and subscriptions.

The domain kernel (ADR 0003) already defines platform-neutral records and a `ProjectRepository`
port with an in-memory adapter. This ADR chooses the durable implementation behind that port and
the surrounding delivery pipeline. It does not change domain ownership rules or add offline/CRDT
behavior.

## Decision

### Database — Databricks Lakebase (serverless Postgres)

- The canonical v1 store is a Databricks Lakebase **Autoscaling project** exposing standard
  Postgres. Production data lives on the project's default (`production`) branch.
- Access uses Databricks OAuth tokens as the Postgres password (≈1h TTL). Application and CI use a
  **service principal** for machine-to-machine auth; the token is refreshed per connection.
- We depend only on the standard Postgres wire protocol and SQL. No Lakebase-only SQL features are
  required, so the store remains portable (local Postgres / PGlite for tests) and Lakebase-specific
  concerns stay in operations, not in `packages/core`.

### Persistence layer — `packages/storage` with Drizzle

- `packages/storage` implements the core `ProjectRepository` port against Postgres using
  **Drizzle ORM**. Core stays platform-neutral; provider/SQL types never leak into `packages/core`.
- The relational schema is the normalized ADR 0003 model: `projects`, ordered `books`, manuscript
  `parts`/`chapters`/ordered scene references, `scenes`, `story_knowledge` (+ scene links),
  `editions` (+ ordered scene-revision references). References are enforced with foreign keys; the
  adapter also runs whole-project domain validation inside each write transaction for parity with
  the in-memory adapter.
- The adapter accepts any Drizzle Postgres executor. Production/CI use `node-postgres`; tests and
  local dev can use **PGlite** (in-process Postgres, WASM) so `pnpm verify` needs no live database.

### Migrations — Drizzle Kit, checked into git

- Schema is defined in TypeScript; `drizzle-kit generate` emits immutable, ordered SQL migration
  files under `packages/storage/drizzle/` that are committed and reviewed like code.
- Migrations are applied with Drizzle's migrator (`pnpm db:migrate`) in CI and on deploy. The same
  migration set runs against PGlite in tests, so schema drift is caught before merge.

### Backend runtime — Node (Hono) service

- `apps/backend` is a thin Hono HTTP service (`@hono/node-server`) composing `packages/core`
  services with the `packages/storage` adapter — the same use cases the UI and MCP call. It owns no
  business rules of its own.
- It is container-deployable (Dockerfile) and targeted at a managed Node host (Fly.io) reachable
  over TCP to Lakebase. Hosting choice is operational and can change without touching core.
- Because Lakebase credentials are short-lived and workspace PATs are disabled, the backend
  authenticates with the service principal (OAuth M2M) and refreshes the database token on demand
  (`/oidc/v1/token` → `/api/2.0/postgres/credentials`), caching it until just before expiry. Local
  dev and CI migrations use a plain `DATABASE_URL`/`PG*` connection instead.

### CI/CD — database branch per pull request

- **CI (`ci.yml`)** keeps `pnpm verify` and additionally runs the migration + repository/backend
  suites against PGlite, requiring no cloud access for forks or docs-only work.
- **Ephemeral DB branch (`db-branch.yml`)**: on PR open/sync, CI creates a Lakebase branch
  (`pr-<number>`) from `production` with a TTL via the Databricks CLI, runs migrations against it,
  and exercises integration checks; the branch is deleted on PR close (TTL is the backstop).
- **Backend deploy (`deploy-backend.yml`)**: on merge to `main`, CI runs migrations against
  `production` and deploys `apps/backend` to the managed host. Production migrations are forward-only
  and gated on green CI.
- CI authenticates to Databricks with a service principal via `DATABRICKS_HOST`,
  `DATABRICKS_CLIENT_ID`, and `DATABRICKS_CLIENT_SECRET` GitHub secrets; the deploy host uses its own
  token secret.

## Options considered

- **Lakebase vs. Neon/Supabase/RDS** — Lakebase selected by the founder; its copy-on-write branching
  maps directly to per-PR isolated databases and keeps operational data on their platform. Portability
  is preserved by depending only on standard Postgres.
- **Drizzle vs. Prisma vs. raw SQL/Atlas** — Drizzle chosen: TypeScript/ESM-native, lightweight,
  no engine binary, and it composes cleanly with the existing core ports; migrations are plain SQL.
- **Node/Hono vs. Databricks Apps vs. Cloudflare Workers** — Node/Hono on a managed host chosen for a
  simple TCP path to Postgres and standard container ops; kept behind core so it is replaceable.
- **Branch-per-PR vs. shared staging DB** — branch-per-PR chosen so migrations and destructive tests
  run against production-shaped data in isolation, with no shared-state contention or teardown scripts.

## Consequences

- Identity, connection-token refresh, backup/retention, and branch lifecycle become operational
  responsibilities (documented in `docs/OPERATIONS.md`).
- CI gains a cloud dependency for the integration branch job; the hermetic PGlite path keeps core
  verification working without secrets (e.g. on forks) so `pnpm verify` never requires Databricks.
- Lakebase branch and endpoint APIs are Beta; command/endpoint shapes may change and are isolated to
  scripts/workflows so updates stay contained.
- Google OAuth accounts/profiles and subscription management are explicitly out of scope here and get
  their own plans/ADRs on top of this backend.
