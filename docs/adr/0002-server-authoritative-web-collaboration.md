# 0002: Server-authoritative web projects and editorial collaboration

- Status: accepted
- Date: 2026-07-11
- Plan: `plans/active/2026-07-11-agentic-writing-experience/plan.html`

## Context

Ghostwriter's initial beachhead is novelists and aspiring novelists creating full books and
multi-book story worlds. The primary product is a real-time web workspace where authors can work
across devices and invite editors to comment, suggest changes, compare variants, and review named
versions.

The repository previously treated local-first storage and no v1 backend as invariants. That model
does not by itself provide the accepted shared-project, identity, authorization, and editorial
workflow. The product owner explicitly chose online-only v1 project access with minimal browser
recovery, and chose editorial real-time collaboration without simultaneous same-scene co-editing.

## Decision

V1 project state is server-authoritative and requires a network connection for normal project
access and editing.

- The shared service owns canonical project heads, permissions, immutable checkpoints, variants,
  comments, tracked suggestions, review requests, and named editions.
- The browser may render optimistically, but it shows **Saved** only after the server acknowledges
  durable persistence.
- The browser keeps a small recovery buffer for unacknowledged text and commands so a refresh,
  tab crash, or brief connection loss does not silently discard recent input. This is recovery,
  not a complete project replica or an offline-editing promise.
- V1 does not support opening and editing a complete project while offline.
- Authors and editors receive explicit project and book scopes. Editors can comment, create
  tracked suggestions, compare variants, and review named revisions. Apply authority is granted
  separately.
- Project presence and updates are real-time across collaborators, but only one person directly
  edits a scene body at a time. Other collaborators may read, comment, or prepare suggestions
  against its current immutable revision.
- Scene editing uses a visible active-editor lease plus optimistic revision preconditions. A
  conflicting or expired write applies nothing and opens compare/recovery; it never silently
  overwrites or auto-merges prose.
- Yjs or another CRDT is not required for v1 scene bodies. Same-scene multi-cursor editing and full
  offline replication require a later plan and ADR.
- Writer ownership is protected through complete attributable history, named editions, usable
  project/manuscript export, and documented account-exit behavior—not through a complete local v1
  replica.
- The backend runtime, database, identity provider, real-time transport, encryption, retention,
  deletion, backup, and remote MCP authentication remain implementation decisions for a focused
  architecture spike and follow-up ADR where needed.

## Options considered

- **Cloud-synced shared project with durable local recovery and later offline editing** — strongest
  balance of collaboration and resilience, but includes more local-cache scope than the founder
  wants for v1.
- **Complete local-first replica with real-time sync and full offline editing in v1** — strongest
  offline custody, but substantially increases replication, migration, encryption, convergence,
  and support complexity before the web workflow is validated.
- **Online-only shared project with minimal browser recovery** — selected. It keeps the initial
  implementation focused on the real-time web and editorial experience while still protecting
  unacknowledged work from common browser failures.

For collaboration depth:

- **Live project updates, presence, comments, tracked suggestions, and version review with one
  direct scene editor** — selected.
- **Simultaneous same-scene multi-cursor editing** — deferred; requires CRDT and convergence work
  that is not necessary for the initial author/editor workflow.
- **Comments-only collaboration** — rejected as too weak for the accepted editorial experience.

## Consequences

- Identity, authorization, shared persistence, real-time updates, recovery, service monitoring,
  backup, and account exit move into the writing spine rather than a later sync phase.
- The initial web architecture is simpler than a complete local-first replicated system and avoids
  CRDT complexity for scene prose.
- Users cannot rely on full project access or editing without a connection in v1. Product copy and
  save indicators must say this plainly.
- Availability and backend operations become product reliability concerns; the current static
  Cloudflare Pages deployment is not sufficient by itself.
- Scene leases reduce overwrite risk but require clear handoff, expiry, stale-tab, reconnect, and
  recovery UX.
- Desktop and mobile wrappers remain optional conveniences and cannot become separate canonical
  stores.
- Local stdio MCP cannot treat browser storage as the project source of truth. MCP access must use
  the authorized shared service or a deliberately exported project snapshot.
- The `AGENTS.md` local-first invariant and affected product/architecture/operations docs must be
  updated to reflect this accepted exception.
