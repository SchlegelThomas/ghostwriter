# 0006: Scene documents, revision history, leases, and recovery

- Status: accepted
- Date: 2026-07-12
- Plan: `plans/active/2026-07-11-authenticated-project-crud/plan.html`
- Related: ADR 0002 (server authority and one direct editor), ADR 0003 (scene boundary), ADR 0004 (Lakebase), ADR 0005 (identity and ownership)

## Context

Ghostwriter now persists authenticated scene metadata and manuscript order, but a scene has no prose
body. The current project command path conditionally advances one project version and replaces a
normalized metadata aggregate. That is appropriate for low-frequency structure edits, not for
debounced prose saves, immutable history, or a foreign-key-stable scene document.

ADR 0002 requires one direct scene editor at a time, durable acknowledgement before the UI says
*Saved*, optimistic revision preconditions, no silent overwrite or auto-merge, and a minimal browser
buffer for unacknowledged work. ADR 0003 requires one canonical versioned ProseMirror document per
scene, while keeping DOM and editor-library types outside core. The product also promises
checkpoints, named variants, compare, and restore without exposing Git mechanics or event-sourcing
every keystroke.

## Decision

### Document boundary and schema

- Add `packages/editor` as the DOM/editor boundary. It owns ProseMirror schema v1, canonical JSON
  validation and migration, stable top-level block IDs, document normalization, content hashing,
  block-aware comparison, and the web Tiptap component.
- A scene owns exactly one canonical ProseMirror JSON document. HTML is a rendering/import format,
  never canonical storage.
- Schema v1 supports paragraphs, headings, block quotes, horizontal scene breaks, hard breaks,
  bold, italic, underline, and strike. Top-level content blocks carry opaque stable IDs; the codec
  rejects missing or duplicate IDs and preserves IDs across ordinary edits.
- Core consumes platform-neutral validated document values and editor codec functions. It never
  imports React, Tiptap, ProseMirror view, DOM, Expo, or browser APIs.

### Working state and immutable history

- Add a dedicated scene-document concurrency domain rather than reusing `project.version`.
  `scene_documents` stores the latest acknowledged working document, schema version, monotonically
  increasing `working_version`, content hash, checkpoint head, actor, and timestamps.
- `scene_revisions` is append-only and content-addressed. A revision stores scene/project IDs,
  parent revision, schema version, document snapshot, content hash, actor, origin, reason, and
  timestamp. Normal revisions have one parent in this epic; multi-parent combine waits for a later
  editorial plan.
- Debounced working saves update `scene_documents` only when `expectedWorkingVersion` matches.
  They do not create a revision per keystroke or network request.
- Immutable revisions are created at manual checkpoint, named-variant creation, sustained idle
  checkpoint, restore, and schema migration boundaries. Identical content deduplicates by hash.
- A named variant points to an immutable revision head. Compare is initially stable-block-aware
  add/remove/change/move output; character-level literary diff and three-way combine are later.
- Restore copies a selected immutable document into a new attributable revision and advances the
  working head. It never mutates or deletes prior history.

### Lease and API behavior

- A database-backed scene lease is keyed by scene and held by the authenticated session. The first
  owner editor acquires it, renews it while focused, and releases it best-effort on navigation.
  The initial defaults are a 60-second lease and a 20-second renewal heartbeat.
- Save, checkpoint, variant, and restore operations require owner authorization, the active lease,
  and the expected scene working version. A stale version or lease applies nothing and returns a
  stable conflict that opens reload/compare/recovery.
- Scene workspace reads and body writes use dedicated HTTP routes and a separate bounded payload
  parser (initial maximum 2 MiB). Errors and diagnostics never contain prose, documents, diffs, or
  recovery contents.
- New scenes and pre-existing scenes without a document receive one valid empty document and
  genesis checkpoint through an idempotent service path. Metadata persistence must stop deleting
  and rebuilding scene rows before revision foreign keys are introduced.

### Browser recovery

- The browser keeps only the latest unacknowledged document per project/scene in origin-private
  IndexedDB. Entries contain the expected server version, update time, and expiry; they are not a
  browsable project cache.
- Recovery documents are encrypted with AES-GCM using a non-exportable WebCrypto key stored in the
  same origin-private browser storage. This reduces casual at-rest disclosure but does not claim
  protection from same-origin script compromise; XSS can use any key available to the application.
- The client writes recovery before sending, clears it only after matching server acknowledgement,
  expires stale entries, and clears account-scoped entries on sign-out. If recovery and server
  heads differ after reload, the writer explicitly restores, compares, or discards; Ghostwriter
  never auto-merges.

### Scope boundary

- This ADR enables an owner-only web writing loop and preserves extension points for future editor
  roles and live subscriptions. It does not ship invitations, presence, comments, tracked
  suggestions, multi-cursor editing, full offline projects, AI prose, or canonical MCP writes.
- Named editions remain read-only until project-level checkpoint and export semantics are accepted.

## Options considered

- **Store prose inside the existing project aggregate** — rejected. Debounced saves would rewrite
  unrelated metadata, create false project-version conflicts, and make long projects expensive.
- **Append one immutable revision for every autosave** — rejected as keystroke-adjacent event
  sourcing. Working state and meaningful immutable checkpoints have different retention needs.
- **Store HTML as canonical content** — rejected because schema migration, stable anchors, compare,
  and cross-platform rendering need structured documents.
- **Use Yjs/CRDT for scene bodies now** — rejected by ADR 0002; one direct editor plus leases and
  optimistic revisions is sufficient for v1.
- **Keep recovery only in memory** — rejected because refresh and tab failure are explicitly in the
  accepted recovery promise.
- **Persist a complete browser project replica** — rejected because ADR 0002 selects online-only,
  server-authoritative v1.

## Consequences

- Scene prose, metadata, and Canvas state gain independent optimistic concurrency and can evolve
  without creating unrelated conflicts.
- The storage adapter must move from delete/rebuild metadata replacement to stable, surgical row
  updates before scene revisions can safely reference scenes.
- `packages/editor`, new core ports, Postgres tables, migrations, API routes, client recovery, and
  editor/browser tests become required parts of the writing spine.
- Working saves remain compact, while checkpoints and variants provide attributable safety without
  preserving every intermediate request forever.
- Browser recovery improves crash resilience but is not an offline mode and cannot defend against
  malicious same-origin code.
- Real-time transport, collaborative review, retention/deletion policy, edition publishing, and
  project export remain explicit later decisions.
