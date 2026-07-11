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
    backend/      # Required shared-project identity/sync shell; runtime is still open
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
| Real-time backend | shared database + subscriptions, actor/room model, CRDT coordination service | Select identity, authorization, hosting, deletion, retention, and reconnect semantics together |
| Content history | content-addressed checkpoint/variant graph, event sourcing, literal Git repository | Recommend immutable prose-aware version graph; do not expose Git mechanics or event-source keystrokes |
| Browser recovery | IndexedDB, OPFS, simpler encrypted draft buffer | Store only unacknowledged recovery data; clear safely after server acknowledgement |
| Build tooling | pnpm native workspace orchestration; revisit Turborepo only when measured need appears | Resolved for scaffold |
| AI providers | Anthropic, OpenAI, local models via Ollama | `packages/ai` should abstract this from day one |

## Non-negotiables recap

Writer ownership, acknowledged-write recovery, complete history and export, MCP parity with the UI,
and a platform-agnostic core remain non-negotiable. Server-authoritative online-only v1 project
state is an explicit exception to the repository's earlier local-first direction, recorded by ADR
0002 and reflected in `AGENTS.md`. Do not introduce a second canonical store or imply offline
editing without a later accepted plan and ADR.
