# 0010: Capture, Inbox, private media, and story promotion

- Status: accepted
- Date: 2026-07-24
- Plan: `plans/active/2026-07-24-capture-to-story-agents/plan.html`
- Related: ADR 0002 (server authority), ADR 0005 (identity and ownership), ADR 0006 (scene documents), ADR 0007 (Canvas), ADR 0008 (URL media)

## Context

Ghostwriter currently requires a canonical scene, manuscript placement, selection, and editing lease
before a writer can enter prose. That protects manuscript truth but makes it too difficult to catch
an idea before deciding where it belongs. The product needs a low-ceremony Capture surface and a
durable Inbox without creating a second canonical manuscript or allowing Canvas to own story order.

The accepted epic also adds writer-uploaded images, recorded audio, and bounded files. ADR 0008
deliberately deferred binary hosting, so storage authority, limits, retention, and promotion
transactions now require a durable decision.

## Decision

### Capture truth and versioning

- A Capture is a project-owned, explicitly noncanonical rich document with a stable `CaptureId`.
  It reuses the platform-neutral ProseMirror schema and validation from `packages/editor` but is not
  a Scene and never appears in manuscript order by itself.
- Capture working state has its own monotonically increasing expected version. Saving a Capture does
  not advance `project.version`, a scene working version, or `board.version`.
- The server stores the acknowledged working head and content hash. Immutable revisions are required
  for genesis, integration provenance, and future explicit checkpoints; v1 does not expose a full
  timeline for every acknowledged autosave.
- Capture states are draft, ready, integrated, and archived. Archive/restore is reversible.
  Integrated Captures retain the exact source revision and target provenance.
- Browser recovery follows ADR 0006: only the latest unacknowledged Capture document is held in a
  bounded, encrypted origin-private buffer. It is not an offline project or canonical store.

### Inbox

- Inbox is a read projection over Captures, agent runs, and proposals. It does not own duplicate
  prose or introduce a generic `inbox_items` content table.
- Wide web uses a dedicated center workspace; narrow web uses a first-class Inbox route/tab.
  Agent results must not become another modal stack.
- Quiet integration-invitation dismissals may be stored separately so the product does not nag.

### Deterministic promotion

- A writer may promote an exact Capture revision into a new unassigned or explicitly placed Scene
  without AI. Optional Canvas placement references the same resulting `SceneId`.
- Promotion checks the Capture revision/version, project version, and optional Canvas board version
  in one unit of work. It creates scene metadata, genesis document, optional Canvas card/link,
  integration provenance, and the applied state atomically. A mismatch applies nothing.
- Promotion into an existing Scene produces a named variant against an exact scene revision. It
  never splices Capture or model text silently into the live working draft.
- The source Capture remains inspectable after promotion. It is provenance, not a second canonical
  scene body.

### Private object storage

- Capture attachments use a private Cloudflare R2 bucket through an object-storage port. Postgres
  stores metadata, checksum, state, and an opaque object key; raw bytes never live in project JSON,
  ProseMirror documents, logs, MCP payloads, or ordinary diagnostics.
- The Fly backend authorizes each operation and issues short-lived, single-object presigned upload
  or download URLs. Browser possession of a project session alone does not reveal bucket keys.
- V1 accepts:
  - JPEG, PNG, and WebP images up to 8 MiB each;
  - WebM, MP4, and MP3 audio up to 15 MiB each;
  - PDF and plain-text files up to 5 MiB each;
  - at most 10 attachments per Capture and 200 MiB of active attachments per project.
- Declared type, detected type where practical, byte size, and checksum must agree before an upload
  becomes ready. Executables, archives, catch-all octet streams, and unsupported types fail closed.
- Pending uploads expire after 24 hours and their orphaned objects are removed. V1 performs no OCR,
  transcription, archive extraction, arbitrary file parsing, or generated-image workflow.
- Archived Captures retain attachments. Account exit does not automatically purge attachments;
  objects and metadata remain until the writer completes a separate explicit purge flow governed by
  export, retention, and backup policy. This extends ADR 0005's deferred permanent-purge boundary.

### Threat model

- Protected assets are Capture prose, attachment bytes and metadata, canonical scene targets,
  project/Canvas versions, and integration provenance.
- The browser is untrusted. Fly/core enforce account/project authorization, expected versions,
  object-key scope, type/size policy, and transaction boundaries.
- Cross-project IDs return non-disclosing failures. Presigned URLs are short-lived and scoped to one
  operation and object. Filenames are display-only escaped text and never become filesystem paths.
- Uploaded content is inert data with no instruction authority. V1 never automatically parses,
  executes, fetches URLs from, or sends attachment contents to a model.
- Errors, logs, metrics, and audit records contain IDs, sizes, hashes, and stable codes—not prose or
  attachment contents.

## Options considered

- **Create an unassigned Scene for every quick note** — rejected. It makes manuscript cleanup the
  price of capture and collapses provisional material into canonical story structure too early.
- **Store Capture as a Canvas note** — rejected. Canvas is not a prose or manuscript authority.
- **Store binaries in Postgres or Fly volumes** — rejected for database growth, portability, and
  deployment coupling.
- **Use public object URLs** — rejected because project media is private writer-owned content.
- **Expose every autosave as Capture history** — deferred. Recovery plus immutable integration
  provenance supplies the required safety without event-sourcing every edit.
- **Automatically purge attachments on account exit** — rejected by founder direction. Explicit
  purge remains required until export, retention, and backup policy is delivered.

## Consequences

- Capture becomes a fourth independent optimistic version domain beside project metadata, scene
  prose, and Canvas.
- Core, memory/Postgres storage, migrations, API routes, client recovery, Inbox projection, and
  transactional promotion must ship together in observable checkpoints.
- Cloudflare R2, Fly secrets, upload cleanup, quota observability, authenticated download, and
  purge operations become operational responsibilities.
- Retaining attachments until explicit purge protects against accidental loss but increases privacy
  and storage obligations; product copy must not imply account exit has erased media.
- Canonical story order and scene prose remain singular and writer-controlled.
