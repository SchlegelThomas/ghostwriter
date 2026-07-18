# Ghostwriter — Architecture

## Strategy: one codebase, thin shells

Everything that can be shared lives in `packages/`. Platform targets are thin shells in
`apps/` that wire shared packages to a platform's entry point, storage, and native APIs.

```
ghostwriter/
  apps/
    client/       # Expo universal app; responsive real-time web is the primary product
    desktop/      # Optional Electron shell adding filesystem and credential conveniences
    mcp/          # MCP server exposing Ghostwriter to external agents
    backend/      # Node/Hono shared-project identity and application shell
  packages/
    core/         # domain model + logic: multi-book projects, scenes, revisions, policy
    ui/           # shared React Native components (render on web via react-native-web)
    editor/       # Tiptap (ProseMirror) rich-text editor; mounted directly on web/desktop,
                  # hosted in an Expo DOM component ('use dom' WebView) on iOS/Android
    storage/      # persistence abstraction with per-platform adapters
    sync/         # Protocol-neutral presence, leases, subscriptions, reconnect, and recovery
    ai/           # LLM provider clients, prompt templates, streaming
  docs/
  plans/
```

The editor is deliberately its own package because it's the one piece of UI that is DOM-based
rather than React Native: web and desktop mount it directly, native mobile hosts it via Expo's
DOM components (stable since SDK 56). Keep its public interface platform-neutral (props in,
document changes out) so the hosting mechanism stays swappable.

## Dependency rules (enforced by review, later by lint)

- `core` imports nothing platform-specific: no DOM, no Electron, no React, no React Native.
- `ui` may import `core`, never the reverse.
- `sync` and `storage` may implement core ports; provider, database, and transport types never
  leak into `core`.
- `apps/*` may import any package; packages never import from `apps/`.
- `mcp` is an `apps/` shell over `core` — the same functions the UI calls. If an MCP tool
  needs logic that doesn't exist in `core`, add it to `core` first.
- The proposed shared backend is also an application shell over core policy and use cases;
  authorization and canonical mutation rules do not live only in HTTP or socket handlers.

## Feature workflow

Every feature is built inside-out:

1. Model + logic in `packages/core` (pure, testable, platform-free).
2. Expose through appropriate application transports, including MCP and the shared web service.
3. Bind to UI in `packages/ui`, mount in shells.

This ordering keeps MCP at parity by construction instead of as an afterthought.

## Implemented writing kernel (2026-07-11)

Phase 1.1 replaces the scaffold manuscript object with the first shared product capability:

- ADR 0003 defines normalized project, book, scene, story-knowledge, and edition records. A project
  owns ordered book references; each book owns its manuscript structure; parts and chapters order
  stable scene references rather than copied scene bodies.
- `packages/core` provides branded IDs, immutable record constructors, cross-record validation,
  plain repository/transaction/ID/clock ports, project commands and queries, and a transactional
  memory adapter. The memory adapter is a deterministic test and fixture implementation, not a
  browser store or candidate canonical backend.
- One `ProjectNavigator` query projection drives the responsive fixture navigator in
  `packages/ui` and the read-only `ghostwriter_project_navigator` MCP tool. A capability registry
  records those bindings explicitly.
- `packages/ui/src/theme.ts` holds the product chrome tokens and font roles derived from the living
  `plans/designs/Ghostwriter Mockups 2.0.html` source. The client loads Parisienne, Jost, and
  Cormorant Garamond, while the shared UI owns the supplied Ghostwriter lockup and responsive shell.
- The client labels the Bellwether data as a read-only sample. It does not imply persistence,
  server acknowledgement, collaboration, or offline access.
- The MCP process smoke test launches a real stdio server, discovers the tool, invokes it, validates
  structured output against the core fixture, and closes it cleanly.

See [ADR 0003](adr/0003-multi-book-domain-boundaries.md). Tiptap scene bodies, the revision graph,
real-time sync, recovery, and Story Canvas mutation remain later plans.

## Implemented backend and persistence (2026-07-11)

ADR 0004 makes the server-authoritative store concrete:

- `packages/storage` implements the core `ProjectRepository` port against Postgres with **Drizzle
  ORM**. The relational schema is the normalized ADR 0003 model; write transactions run the domain's
  whole-project validation for parity with the in-memory adapter. Provider/SQL types never enter
  `packages/core`. The store depends only on standard Postgres, so tests and local dev use in-process
  **PGlite** (kept out of the `@ghostwriter/storage` entry point via a `./pglite` subpath).
- Migrations are TypeScript-defined and emitted as checked-in SQL under `packages/storage/drizzle/`.
- `apps/backend` is a thin **Hono** service composing the same core services the UI and MCP call,
  over the Postgres adapter. It exposes health and the project-navigator read model and is
  container-deployable (Fly.io).
- The database is **Databricks Lakebase** (serverless Postgres). CI branches the database per pull
  request (copy-on-write) via `scripts/lakebase.sh`; production deploys migrate and ship the backend.

See [ADR 0004](adr/0004-lakebase-backend-and-cicd.md). Subscriptions, real-time transport, and
browser recovery remain later plans on top of this backend.

## Implemented identity, project access, and kernel mutations (2026-07-11)

ADR 0005 establishes the identity spine used by all real project access:

- **Better Auth** runs inside the Node/Hono backend with its Drizzle/Postgres adapter and Google as
  the only initial login provider. Auth/session/provider types remain outside `packages/core`.
- The browser uses opaque database-backed sessions in secure HttpOnly cookies. Cloudflare Pages
  proxies its same-origin `/api/*` path to Fly on the production custom domain
  (`https://ghost-writer.studio`); the product does not depend on third-party cookies between the
  web origin and `fly.dev` or durable browser bearer tokens.
- Core owns provider-neutral account/profile, project-membership, and authorization contracts.
  Every query and command receives a server-resolved actor and enforces project scope before
  storage effects. Client-supplied account IDs never grant access.
- First login idempotently creates one writer profile. Creating a project atomically creates its
  owner membership; account-scoped project listing follows membership rather than global project
  enumeration.
- Authentication precedes every product/onboarding surface. Authored records archive and restore;
  permanent purge waits for export, backup, retention, and account-exit policy.
- Google requires exact callback registration. Required CI uses a production-inert test identity
  boundary. A live-provider acceptance run passed locally on 2026-07-12 for consent, durable
  account/profile bootstrap, project creation/reload, and server-side sign-out revocation;
  production still receives its own post-release smoke.
- Core exposes 22 typed, owner-authorized, expected-version commands for project/book/manuscript
  structure/scene metadata/story knowledge. Memory and Postgres share one transaction contract;
  Postgres conditionally advances the project version and atomically replaces normalized metadata
  children while preserving memberships. This aggregate replacement is for low-frequency metadata,
  not the future scene-body editor write path.
- Hono exposes validated account/profile, account-scoped project, navigator, and typed-command
  endpoints with stable error codes and strict mutation origins. The responsive client binds all 22
  commands and shows <em>Saved</em> only after the returned server version is installed.
- Authored kernel records archive/restore; empty parts/chapters may be safely removed. Named editions
  remain read-only until immutable scene/project revisions exist.
- Canonical MCP command bindings are explicit security exceptions, not omissions: direct external
  writes wait for scoped grants and the agent-authority/remote-authorization ADR. Fixture MCP reads
  continue to exercise the shared navigator projection.

See [ADR 0005](adr/0005-authenticated-accounts-and-project-access.md).

## Implemented writing, revision, and Canvas foundation (2026-07-12)

The founder expanded the active pre-PR epic from authenticated metadata CRUD into the complete
single-owner writing loop from the living design. Two accepted ADRs now have working vertical
implementations:

- [ADR 0006](adr/0006-scene-documents-revisions-and-recovery.md) selects canonical versioned
  ProseMirror JSON with stable block IDs, a dedicated scene working version, append-only meaningful
  checkpoints and variant heads, owner-session leases, block-aware compare/restore, and a bounded
  IndexedDB recovery buffer for unacknowledged prose.
- [ADR 0007](adr/0007-story-canvas-spatial-state.md) selects one project-owned Canvas board with
  dedicated versioning, relational objects/links referencing canonical scene/story IDs, separate
  per-writer viewport preferences, manuscript-derived spine/drift, and an accessible ordered view.

The concurrency boundary is intentionally split: project metadata keeps `project.version`, scene
prose uses a per-scene working version, and Canvas spatial state uses a board version. Postgres
metadata persistence now updates stable canonical rows rather than deleting/rebuilding scenes.

- `packages/editor` owns strict schema-v1 ProseMirror JSON, stable block IDs, canonical hashing and
  block-aware comparison plus the SSR-safe web Tiptap component. Core imports only its DOM-free
  document contract.
- Scene document/revision/variant/lease tables and repository contracts support acknowledged
  working saves, meaningful immutable checkpoints, named variants, compare, restore-as-new, and
  owner-session lease conflicts. Errors and diagnostics remain prose-free.
- The browser save queue serializes debounced writes. A seven-day AES-GCM IndexedDB buffer stores
  only unacknowledged scene text, asks before recovery, and clears after matching acknowledgement
  or sign-out; it is not an offline project replica.
- Canvas uses relational current-state boards/objects/links, immutable snapshots, personal viewport
  preferences, a manuscript-derived spine, and a separate board version. The combined unit of work
  atomically creates a manuscript scene, genesis document, and Canvas card.
- The responsive client exposes Draft, Canvas, Split, and Project setup. Wide web supports spatial
  editing and inspectors; narrow web defaults to an ordered keyboard/screen-reader representation.
  Canvas position and story-order hints expose drift but never reorder the manuscript.
- Canonical MCP writes, real-time subscriptions/presence, editor invitations, comments/suggestions,
  image generation, and full offline access remain explicit later decisions.

## Accepted product requirements (2026-07-11)

- Responsive real-time web is the primary product; desktop and mobile are convenience surfaces
  over the same shared project.
- A project may contain a full novel or multiple books with shared world knowledge and
  cross-book arcs.
- The rich manuscript editor and spatial Story Canvas are linked views over the same scene
  and story objects.
- Content history borrows Git's safety model—checkpoints, variants, compare/combine, attribution,
  review, restore, and named editions—but exposes writer-facing language and prose-aware diffs.
- Authors invite editors to comment, suggest tracked changes, compare variants, and review named
  revisions.
- Agents are assistants to authors and editors. They may create ideas, analyses, edits, and
  multiple prose variants, but cannot silently apply canonical changes.

These requirements make identity, shared persistence, real-time updates, and collaboration part
of the writing spine. ADR 0002 settles the v1 topology: server-authoritative online-only projects,
minimal browser recovery for unacknowledged work, live project/editorial updates, and one direct
scene-body editor at a time. Full offline replicas and same-scene multi-cursor editing are later.

## Accepted project authority and collaboration topology

- The shared service is the canonical project store. A client shows **Saved** only after durable
  server acknowledgement.
- Browser persistence is a small recovery buffer for unacknowledged commands/text, not a complete
  project replica or offline mode.
- Authors and editors can work in different scenes and project surfaces concurrently. Presence,
  comments, tracked suggestions, review state, Canvas changes, and version updates are real-time.
- One collaborator directly edits a scene body at a time. A visible lease and expected revision
  guard writes; conflicts apply nothing and open comparison/recovery.
- V1 scene editing does not require Yjs/CRDT convergence. Full offline replication and same-scene
  multi-cursor editing require a new plan and ADR.
- Complete history, export, account exit, and transparent permissions preserve writer ownership.

See [ADR 0002](adr/0002-server-authoritative-web-collaboration.md).

## Committed stack

- TypeScript (strict), ESM, Node.js LTS
- pnpm workspaces monorepo
- **Expo / React Native** for the universal client (iOS, Android, web via react-native-web)
  — decided 2026-07-11
- Responsive web as the lead product surface; Electron may wrap the web export for optional
  platform conveniences
- **Tiptap (ProseMirror)** for the rich-text editor — decided 2026-07-11 (schema-enforced
  manuscript structure, mature track-changes ecosystem, y-prosemirror for future sync)
- `@modelcontextprotocol/sdk` for the MCP server
- Vitest for tests
- GitHub Actions for CI/CD; Cloudflare Pages for web hosting (see `docs/OPERATIONS.md`)

## Open decisions

Decide these when the work demands it, with the user, and record the outcome in the active
plan's record-log plus update this section.

| Decision | Options on the table | Notes |
|---|---|---|
| Real-time transport | subscriptions over the shared DB, actor/room model, CRDT coordination service | Database chosen (Lakebase, ADR 0004); live-update transport, presence, and reconnect semantics still open |
| Content history | content-addressed checkpoint/variant graph, event sourcing, literal Git repository | Implemented foundation under ADR 0006: acknowledged working state plus immutable meaningful checkpoints |
| Browser recovery | IndexedDB, OPFS, simpler encrypted draft buffer | Implemented under ADR 0006: bounded encrypted IndexedDB for unacknowledged prose only |
| Story Canvas state | relational board objects/links, aggregate JSON board, scene-only placement fields | Implemented foundation under ADR 0007: project board with dedicated version, canonical ID references, manuscript-derived spine, and accessible ordered projection |
| Build tooling | pnpm native workspace orchestration; revisit Turborepo only when measured need appears | Resolved for scaffold |
| AI providers | Anthropic, OpenAI, local models via Ollama | `packages/ai` should abstract this from day one |

## Non-negotiables recap

Writer ownership, acknowledged-write recovery, complete history and export, MCP parity with the UI,
and a platform-agnostic core remain non-negotiable. Server-authoritative online-only v1 project
state is an explicit exception to the repository's earlier local-first direction, recorded by ADR
0002 and reflected in `AGENTS.md`. Do not introduce a second canonical store or imply offline
editing without a later accepted plan and ADR.
