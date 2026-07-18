# 0005: Google accounts, first-party sessions, and project access

- Status: accepted
- Date: 2026-07-11
- Plan: `plans/active/2026-07-11-authenticated-project-crud/plan.html`
- Related: ADR 0002 (server-authoritative online-only v1), ADR 0003 (project boundary), ADR 0004 (Lakebase backend)

## Context

Ghostwriter's deployed Hono/Lakebase service currently exposes one public read-only project fixture.
The primary web client needs real accounts before it can create writer-owned projects or permit
canonical mutations. Identity is part of the writing spine because every project read, change,
future revision, collaborator action, and account-exit operation must have an authenticated,
provider-neutral actor and an enforceable project scope.

The production web app and API currently use unrelated hosts (`pages.dev` and `fly.dev`). A session
cookie set by the Fly host is a third-party cookie when the Pages app calls it and is blocked by
privacy-restrictive browsers. Storing long-lived bearer tokens in browser JavaScript would avoid
that symptom by creating a larger token-theft boundary. Building OAuth, account linking, session
rotation, and CSRF handling directly would also duplicate mature security-sensitive machinery.

The living design includes both older local/no-account language and a plan-scoped instruction to
sign in before creating and saving a project. ADR 0002 is authoritative: canonical v1 projects are
online-only and server-authoritative.

## Decision

### Authentication

- Self-host **Better Auth** inside the existing Node/Hono backend and use its Drizzle/Postgres
  adapter against the Lakebase database selected by ADR 0004.
- Enable **Google only** in this slice. Passwords, magic links, passkeys, and additional social
  providers require later plans.
- Request only the identity scopes needed for login (`openid`, email, and basic profile). Google
  provider tokens and secrets remain server-side and are never project data, browser application
  state, logs, diagnostics, MCP output, or exports.
- Use Better Auth's application-owned user ID as the provider-neutral account identifier. A Google
  subject identifies a provider account through the auth adapter; email address is profile/contact
  data and is not a project authorization key.
- Do not add automatic cross-provider email linking in this Google-only slice. A later provider or
  account-linking feature must explicitly define verified-email, takeover, unlink, and recovery
  policy.

### Sessions and web topology

- Use opaque, database-backed sessions in a `Secure`, `HttpOnly`, `SameSite=Lax`, path-root cookie.
  Browser JavaScript does not persist a durable session bearer or Google token.
- Route browser requests under the Pages origin's `/api/*` through a narrowly scoped Cloudflare
  Pages Function to the fixed Fly backend. Better Auth's production public/base URL is the Pages
  origin, so Google's exact callback is:
  `https://<public-app-host>/api/auth/callback/google`.
- The proxy accepts no caller-selected upstream, preserves method/body and multiple `Set-Cookie`
  headers, sets explicit forwarding metadata, removes hop-by-hop headers, and never logs cookies,
  authorization codes, provider payloads, or response bodies.
- The backend keeps an exact trusted-origin allowlist. CORS with credentials is permitted only for
  explicit local tooling that does not use the same-origin proxy; wildcard credentialed CORS is
  forbidden.
- Better Auth owns OAuth state/nonce and session rotation. Ghostwriter adds exact callback and
  post-login redirect allowlists, rejects open redirects, and uses origin/CSRF checks on mutations.
- Google credentials, `BETTER_AUTH_SECRET`, public URLs, proxy upstream, and trusted origins are
  environment configuration. Secrets are supplied through GitHub/Fly/Cloudflare secret stores,
  never checked-in env files or command arguments.

### Product entry and profile

- Authentication is required before every product and onboarding surface in this slice. Signed-out
  users see only the branded auth gate; there is no public fixture workspace or locally saved
  Spark.
- A successful first login idempotently creates one Ghostwriter writer profile keyed by the
  provider-neutral account ID. The initial display name comes from the provider and can be edited;
  authorization never depends on display name, email, or avatar URL.
- Auth adapter records and the writer profile are separate concerns. Better Auth may evolve its
  session/provider schema without redefining Ghostwriter's writer-domain profile.

### Project ownership and authorization

- Core defines an opaque `AccountId`, writer profile, authenticated actor, project membership, and
  authorization policy without importing Better Auth, Google, Hono, cookies, or SQL types.
- Every project has at least one membership. This slice creates exactly one `owner` membership in
  the same transaction as the project. The schema may admit future roles, but no collaborator or
  invitation behavior is implied until its plan is accepted.
- The backend resolves the session to an authenticated account and invokes shared core policy for
  every project query and mutation. HTTP handlers never authorize from a client-supplied account
  ID and never mutate Drizzle tables around core.
- Account-scoped project listing comes from membership, not global project enumeration. Requests
  outside the actor's scope return a stable denial/not-found response without disclosing titles,
  counts, or existence.
- Canonical writes use task-oriented commands, transaction-scoped authorization, and explicit
  expected-version checks. “CRUD” does not add arbitrary table endpoints or generic JSON Patch.

### Removal and tests

- Authored projects and mutable kernel records use archive/restore behavior in this epic.
  Irreversible project/account purge waits for accepted export, backup, retention, deletion, and
  account-exit policy.
- Required CI uses a test-only identity boundary plus PGlite and cannot activate that boundary in a
  production configuration. Integration tests exercise the real Better Auth handler where
  deterministic; a manual acceptance run covers Google's live consent/login flow.
- Remote MCP authorization and canonical MCP mutation remain deferred. Existing local MCP fixture
  identity is not promoted into a user session or owner grant.

## Options considered

- **Managed identity provider (Clerk/Auth0/etc.)** — shortens initial UI work but adds a new account
  data processor, pricing/availability boundary, and provider-specific client surface before the
  product needs those services.
- **Direct Google OAuth and custom sessions** — avoids a library but makes Ghostwriter responsible
  for OAuth state, account linking, cookie rotation, revocation, CSRF, and adapter maintenance.
- **Better Auth on Hono/Postgres** — selected. It fits the committed TypeScript/Hono/Drizzle stack,
  keeps account/session data in writer infrastructure, and has an Expo integration path.
- **Credentialed cross-site cookie from Pages to Fly** — rejected because third-party-cookie
  restrictions make session persistence browser-dependent.
- **Bearer token in browser storage** — rejected for the primary web session because script access
  expands the impact of an XSS defect and complicates revocation/rotation.
- **Shared custom parent domain** — valid later, but the founder selected a Pages same-origin proxy
  so the current hosting topology can ship without a domain dependency.
- **Pre-auth local Spark** — rejected for this epic. It can return only through a later product plan
  that clearly treats it as temporary noncanonical input and does not imply offline projects.
- **Permanent deletion now** — rejected until export, retention, backup, and account-exit guarantees
  make irreversible removal informed and recoverable where promised.

## Consequences

- The web app gains a small edge proxy and its own tests/operations, while Fly remains the only
  application backend and Lakebase remains canonical.
- Production and one stable acceptance environment require exact Google callback registration.
  Wildcard PR-preview callbacks are unavailable; hermetic CI does not depend on Google.
- Identity tables, writer profiles, memberships, archive/version fields, and indexes require
  forward-only migrations and PGlite/Lakebase verification.
- Authorization becomes a shared core dependency for all future commands, collaboration, audit,
  revision, AI, and MCP plans rather than route-local middleware.
- Google-only login has no password recovery path inside Ghostwriter. Provider outage and lost
  Google-account recovery are external constraints until another accepted identity method exists.
- Native Expo can later use Better Auth's Expo/SecureStore integration, but this decision does not
  claim native auth is tested or shipped in the current web-first epic.
- Account closure and permanent content purge remain visibly incomplete until portable export,
  retention, backup, and deletion policy are accepted and implemented.
