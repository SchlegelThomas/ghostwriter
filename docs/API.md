# Ghostwriter application API

The responsive client calls the Hono service through the web origin's same-origin `/api/*` Pages
Function. The proxy streams to Fly.io; it does not authorize or mutate data. Authentication,
project policy, validation, and canonical effects remain in the backend and shared core.

## Authentication

Better Auth owns routes under `/api/auth/*`. The shipped login method is Google:

- `POST /api/auth/sign-in/social`
- `GET /api/auth/callback/google`
- `POST /api/auth/sign-out` accepts an empty JSON object, revokes the current database session, and
  clears its cookie.

The browser uses an opaque `HttpOnly`, `Secure`, `SameSite=Lax` database session cookie. It never
receives a durable application bearer or stores Google tokens in JavaScript. Better Auth enforces
OAuth state and redirect/trusted-origin policy.

All other `/api/*` routes require a session. Canonical `POST`, `PATCH`, and `DELETE` requests also
require an exact trusted `Origin`. Metadata JSON bodies are limited to 64 KiB and schema-validated.

## Account and profile

- `GET /api/me` returns the authenticated account, opaque session metadata, and idempotently
  bootstrapped Ghostwriter writer profile.
- `PATCH /api/me/profile` accepts `displayName`, optional `publishing` (nullable object of optional
  contact/address/bio/representation strings), and `expectedVersion`. Omitting `publishing` leaves
  stored publishing details unchanged; `null` clears them. A stale profile returns
  `409 VERSION_CONFLICT`.

Email, display name, and provider image are not authorization keys. Core uses the opaque Better Auth
user ID as its provider-neutral `AccountId`.
Publishing contact fields are writer-owned profile data, not authorization.

## Projects

- `GET /api/projects` lists only projects reachable through the current account's membership.
- `GET /api/projects?includeArchived=true` also lists archived projects.
- `POST /api/projects` accepts `title` and `firstBookTitle`, then atomically creates the project,
  first book, and owner membership.
- `GET /api/projects/{projectId}/navigator` returns the versioned project/book/manuscript
  structure/scene metadata/story-knowledge projection. Story-knowledge entries may include
  `notes`, `aliases`, and optional `characterSheet` (`desire`, `pressure`, `voiceNotes`).
- `POST /api/projects/{projectId}/commands` accepts an `expectedVersion` and one typed command. A
  successful command returns the complete navigator at the next version.

An unauthorized ID and an unknown ID both return a non-disclosing not-found response.

## Scene writing workspace

Owner-authenticated scene writing uses dedicated routes and the server-resolved account and session:

- `GET /api/projects/{projectId}/scenes/{sceneId}/workspace` returns the acknowledged document head,
  working version, content hash, genesis/checkpoint head, and safe current-session lease state.
  Existing scenes are initialized idempotently with a valid empty schema-v1 document and immutable
  genesis revision on first access.
- `POST /api/projects/{projectId}/scenes/{sceneId}/lease` acquires or renews the current session's
  60-second editing lease. Another unexpired session receives `409 LEASE_CONFLICT`.
- `DELETE /api/projects/{projectId}/scenes/{sceneId}/lease` best-effort releases the current
  session's lease.
- `PATCH /api/projects/{projectId}/scenes/{sceneId}/body` accepts `expectedWorkingVersion` and a
  strict schema-versioned scene `document`. This route has a separate 2 MiB JSON limit.
- `GET /api/projects/{projectId}/scenes/{sceneId}/history` returns newest-first immutable revision
  metadata and named-variant pointers. It does not return revision documents.
- `POST /api/projects/{projectId}/scenes/{sceneId}/checkpoints` accepts
  `expectedWorkingVersion`. It returns `201` when it appends a checkpoint and advances the working
  version, or `200` without a version change when the acknowledged document already equals the
  checkpoint head.
- `POST /api/projects/{projectId}/scenes/{sceneId}/variants` accepts
  `expectedWorkingVersion` and a trimmed 1–100 character `name`. If the acknowledged document is
  not checkpointed, the transaction checkpoints it first; the named variant then points to that
  immutable revision. Names are unique within a scene.
- `POST /api/projects/{projectId}/scenes/{sceneId}/compare` accepts `beforeRevisionId` and
  `afterRevisionId` from the same scene. It returns revision metadata and stable-block-aware
  added/removed/changed/moved structures. Those structures may contain prose because the writer
  explicitly requested the comparison; errors and diagnostics remain content-free.
- `POST /api/projects/{projectId}/scenes/{sceneId}/restore` accepts
  `expectedWorkingVersion` and `revisionId`. It copies the selected snapshot into a newly
  attributable immutable revision, advances the working version, and returns the restored working
  document. Existing revisions are never changed or deleted.

A body save succeeds only when the expected scene working version matches and the server-resolved
session owns an unexpired lease. The update and version increment are atomic; any stale version,
wrong holder, or expired lease applies nothing. Working saves do not create a revision per request;
manual checkpoints, variant checkpointing, and restore create meaningful immutable revisions.

Checkpoint, variant, and restore mutations have the same owner, current-session lease, and exact
working-version preconditions as body saves. A normal checkpoint has exactly one parent: the prior
checkpoint head. Restore always creates a new revision, even when its content hash matches an older
revision. Variant creation only advances the working version when it must checkpoint current
acknowledged content; naming an existing checkpoint leaves that version unchanged.

Unknown scenes, cross-project scene IDs, and projects owned by another account all return the same
`404 SCENE_NOT_FOUND` response. Session IDs and lease holders are never accepted from or exposed to
the client. Revision IDs from another scene are treated as missing. History metadata includes
content hashes and attribution but not stored documents.

## Capture and Inbox foundation

Capture is a project-owned, explicitly noncanonical rich document with its own working version. It
reuses the scene-compatible editor schema but is not a Scene, does not require manuscript placement
or a scene lease, and does not advance project, scene, or Canvas versions.

- `POST /api/projects/{projectId}/captures` accepts an optional `sourceModality` (`text` or
  `dictation`, default `text`) and creates an acknowledged empty Capture plus immutable genesis
  provenance.
- `GET /api/projects/{projectId}/captures` returns nonempty active Capture summaries without document
  bodies. `?includeArchived=true` also includes nonempty archived Captures.
- `GET /api/projects/{projectId}/captures/{captureId}` returns the acknowledged working head,
  document, content hash, genesis revision ID, actor metadata, status, and timestamps.
- `PATCH /api/projects/{projectId}/captures/{captureId}/body` accepts
  `expectedWorkingVersion` plus a strict schema-versioned document. It has the same separate 2 MiB
  JSON limit as scene prose. A stale version applies nothing.
- `POST /api/projects/{projectId}/captures/{captureId}/archive` accepts
  `{ "archived": true | false }`. Archived and integrated Captures are read-only.
- `POST /api/projects/{projectId}/captures/{captureId}/promote` accepts exact Capture working
  version and content hash, project version, a writer-authored scene title, explicit chapter or
  Unassigned placement, and optional Canvas version/geometry. One transaction snapshots an
  immutable Capture integration revision, creates the canonical scene with the Capture prose as its
  `capture-promotion` genesis, optionally places a same-ID Canvas card, and marks the source Capture
  integrated/read-only. The response returns the acknowledged Capture head, scene/document head,
  navigator, and optional Canvas board/spine. Any Capture, project, Canvas, placement, or persistence
  conflict applies none of those effects.

Only project owners may use these routes in the current owner-only release. Unknown, unauthorized,
cross-project, and account-mismatched IDs return non-disclosing `404 CAPTURE_NOT_FOUND`. Invalid
documents return `422 INVALID_CAPTURE_DOCUMENT`; stale saves return
`409 CAPTURE_VERSION_CONFLICT`; archived/integrated mutation returns
`409 CAPTURE_NOT_EDITABLE`; promotion additionally uses `CAPTURE_CONTENT_CHANGED` and
`CAPTURE_NOT_PROMOTABLE`; archived projects reject Capture mutation.

The current Inbox center workspace projects Capture summaries and deterministic integration
receipts without owning duplicate prose. Agent runs and proposals join that projection through the
agent routes below; attachments remain separate private object references.

### MCP grants (propose-only)

Owners mint project-scoped opaque grant tokens for external MCP clients. Grants carry Capture and
tool allowlists, expiry, and revocation. Tokens are returned once on create; only a SHA-256 hash is
stored. Missing, expired, revoked, and unauthorized grant access share non-disclosing `404 NOT_FOUND`.

- `GET /api/projects/{projectId}/mcp-grants` lists grant summaries for the project (no token material).
- `POST /api/projects/{projectId}/mcp-grants` accepts `captureIds`, `tools` (closed enum of Capture
  reflection MCP tools), and `expiresAt`, then returns `{ grant, token }`.
- `DELETE /api/projects/{projectId}/mcp-grants/{grantId}` revokes a grant.

External MCP tools under a grant may discover the grant, read one granted Capture plain summary,
assemble a Capture reflection receipt, and propose via the same core preview+start path as the UI.
They cannot apply proposals, read credentials, mutate grants, or enumerate unauthorized projects.
Production remote MCP OAuth remains later; local/tests inject grant services with
`GHOSTWRITER_MCP_GRANT_TOKEN` or an in-process runtime.

### Capture attachments

Capture attachments are private object references outside ProseMirror and project JSON. Control
routes are authenticated through Fly; upload/download bytes use short-lived single-object R2 URLs.

- `POST /api/projects/{projectId}/captures/{captureId}/attachments/init` accepts display filename,
  allowlisted declared content type, declared byte size, and client SHA-256. It transactionally
  reserves count/project quota and returns a pending summary, 15-minute PUT URL, and the exact
  signed `Content-Type` header.
- `POST /api/projects/{projectId}/captures/{captureId}/attachments/{attachmentId}/finalize` accepts
  an empty object. Fly re-reads the bounded private object, computes SHA-256, detects its actual
  type, and returns either ready or a durable refused summary. The API never trusts ETag or a
  client-supplied finalize checksum.
- `GET /api/projects/{projectId}/captures/{captureId}/attachments` returns pending, ready, refused,
  and deleted metadata/tombstones without object keys, checksums, signed URLs, or bytes.
- `GET /api/projects/{projectId}/captures/{captureId}/attachments/{attachmentId}/download` returns
  a five-minute GET URL only for ready content.
- `DELETE /api/projects/{projectId}/captures/{captureId}/attachments/{attachmentId}` removes the
  object and returns a retained deleted tombstone.

Init/finalize requires a draft/ready Capture; authenticated list/download/delete remains available
for archived/integrated source review. Accepted limits are 10 active items per Capture and 200 MiB
per project, with 8 MiB images, 15 MiB audio, and 5 MiB PDF/plain text. Pending uploads expire after
24 hours. Unsupported, oversized, quota, expiry, unavailable-storage, and non-disclosing not-found
responses use stable `ATTACHMENT_*` codes. Attachments never promote into scene prose or Canvas.

## Provider credentials and agent guidance (BYOK)

Writer provider keys (OpenAI, Anthropic, Google, Groq, xAI, Mistral, DeepSeek, OpenRouter) are
encrypted at rest under a versioned Fly-held KEK — one envelope per `(account, provider)`. Routes
never return plaintext keys. Missing, invalid, and unconfigured provider states use stable codes
without echoing secrets. See ADR 0011 and ADR 0012.

- `GET /api/me/providers` lists configuration status for every supported provider id.
- `GET` / `PUT` / `DELETE /api/me/providers/{providerId}` read/store/remove one provider key.
- `POST /api/me/providers/{providerId}/validate` revalidates the stored key without returning it.
- `GET /api/me/available-models` returns curated catalog entries the account can use (non-revoked
  credential for that provider), with capability flags (`supportsChat`, `supportsTools`,
  `supportsStructured`, `supportsImage`).
- Compatibility shims: `GET` / `PUT` / `DELETE` / `POST …/validate` on
  `/api/me/provider/openai` forward to the `openai` provider id.
- `GET` / `PATCH /api/me/ai-collaboration` read/update optional collaboration preferences.
- `GET` / `PATCH /api/projects/{projectId}/agent-instructions` project-level guidance text.
- Playbooks: `GET` / `POST /api/projects/{projectId}/playbooks`,
  `PATCH` / `DELETE /api/projects/{projectId}/playbooks/{playbookId}` — declarative, non-authoritative
  goal refinements (ADR 0011).
- Catalog playbook overrides:
  - `GET /api/projects/{projectId}/catalog-playbooks` lists built-in catalog summaries and whether
    each has a project override.
  - `GET /api/projects/{projectId}/catalog-playbooks/{agentId}` returns `{ builtIn, override,
    effective }`.
  - `PUT /api/projects/{projectId}/catalog-playbooks/{agentId}` accepts
    `{ doctrine?, sections?: [{ heading, note }], expectedVersion? }`; at least one override is
    required, doctrine is capped at 8,000 characters, and headings must match the built-in agent.
  - `DELETE /api/projects/{projectId}/catalog-playbooks/{agentId}` resets to the built-in playbook.
  These owner-only routes can override doctrine and section notes, never built-in constraints,
  evidence guidance, stage, or agent identity.

## Agent runs and proposals

Typed noncanonical runs/proposals (context receipts, Capture reflection, craft partners):

- `POST /api/projects/{projectId}/agent/context-preview` assembles an inspectable receipt.
- `POST /api/projects/{projectId}/agent/runs` starts a run from a receipt + workflow.
- `GET /api/projects/{projectId}/agent/runs` and `.../runs/{runId}` list/read run status.
- `POST /api/projects/{projectId}/agent/runs/{runId}/cancel` cancels a run.
- `GET /api/projects/{projectId}/agent/proposals` and `.../proposals/{proposalId}` list/read.
  The list accepts paired `targetKind` / `targetId` filters and an optional proposal `status`
  (default `ready`), and returns at most 100 newest-first summaries. Each proposal exposes one
  `primaryTarget`; Capture-base fields are omitted for entity drafts that have no Capture base.
- `POST /api/projects/{projectId}/agent/proposals/{proposalId}/reject` rejects a ready proposal.
- `POST /api/projects/{projectId}/agent/proposals/{proposalId}/acknowledge` marks a
  `plan-outline-v1`, `catalog-memo-v1`, or `pacing-findings-v1` proposal applied with zero
  manuscript side effects.
- `POST /api/projects/{projectId}/agent/plan-outlines` body `{ outlineText (1–8000), title?, model? }`
  creates a Capture + ready `plan-mode.outline` proposal from a Plan-mode reply (no provider call).
- `POST /api/projects/{projectId}/agent/catalog-runs` accepts
  `{ agentId, lens?, model?, effort?, sceneId?, storyKnowledgeId?, bookId? }`. It creates a ready
  `catalog-agent.memo` proposal targeted to the project, selected scene, or selected cast record.
  Pacing Doctor returns `pacing-findings-v1`, with turn positions derived from equal-weight scenes
  in navigator manuscript order; all other catalog agents return `catalog-memo-v1`. Structure
  lenses are `save-the-cat` (default), `three-act`,
  `heros-journey`, `scene-sequel`, `character-want-need`, and `genre-conventions`. A reachable
  BYOK model may fill the strict schema; missing keys or unusable model output fall back to a
  deterministic memo grounded in current scene titles and ids.
- Apply / reject proposal routes accept the exact proposal hash; only first-party human sessions
  apply craft/reflection paths. Core revalidates a present Capture base and every canonical target
  version, then applies all effects or none. See ADR 0014 for entity-draft proposal binding.

Scene Partner Capture chat (BYOK structured turn, propose-only until promote/variant apply):

- `POST /api/projects/{projectId}/captures/{captureId}/scene-partner/turns`
- `POST /api/projects/{projectId}/captures/{captureId}/scene-partner/images` (optional illustration
  preview; does not write manuscript canon)

## Workspace Agent chat

- `POST /api/workspace/chat` accepts project/selection context, optional capability id, and Agent
  dock prefs (`mode`: `chat` | `plan` | `agent`; model + effort). Optional `priorTurns` (max 6
  `{ role: "user"|"assistant"; body }` pairs) may be included for regenerate/edit coherence; the
  server treats them as non-authoritative recent conversation text alongside server-assembled
  project/selection context. When `message` equals a read capability id (e.g.
  `project.navigator.read`), the server invokes that tool deterministically.
  **Plan** mode instructs outline-friendly replies; the writer saves to Plans explicitly via
  `POST /api/projects/{projectId}/agent/plan-outlines` (not auto-persisted each turn). Otherwise,
  with a valid BYOK key and a tool-capable model (`supportsTools`), the route runs a
  read-only tool loop (`project_navigator_read`, `scene_workspace_read`, `capture_list`) via
  `@ghostwriter/ai` and returns assistant text plus optional `toolTraces` (compact writer-facing
  step summaries). Scene reads are budgeted per turn (max 4 scenes, ~64k prose chars). Models
  without tool support, or when tool-loop creation fails recoverably, fall back to
  `completeStructured` with server-assembled navigator context (no `toolTraces`). Without a key,
  the route returns a friendly unconfigured response (no silent failure wall). Chat never mutates
  manuscript canon. Client abort of the stream request cancels in-flight provider work when the
  SSE body is cancelled.

- `POST /api/workspace/chat/stream` — same request body and auth as JSON chat; response is
  `text/event-stream` (SSE). The client uses `fetch` + `ReadableStream` (POST + cookies). Named
  events (JSON `data` payloads):
  - `status` — `{ phase, label }` working-state phases (`starting`, `assembling_context`,
    `thinking`, `reading_tools`, `writing`, …)
  - `tool_trace` — `{ toolName, title, ok, summary, errorMessage? }` as each read tool finishes
  - `text_delta` — `{ delta }` assistant text chunks during tool-loop streaming
  - `done` — final `{ reply, mode, model, effort, toolTraces?, code? }` (same shape as JSON chat)
  - `error` — `{ error, code }` hard failures
  Comment keepalives (`: ping`) may appear during long waits. Structured / no-tools / no-key paths
  emit `status` then `done` (or soft-error `done`) so the dock never looks idle.

## Book covers (Title Page)

`book.update` may set optional `cover` `{ concept?, notes?, imageUrl? }`. `imageUrl` must be an
absolute http(s) locator (applied covers use a stable `https://ghostwriter.cover/...` form). Data
URIs are rejected. Concept/notes persist in Lakebase; bitmap bytes live only in private object
storage after Apply.

- `POST /api/projects/{projectId}/books/{bookId}/cover/images` — sync single preview (BYOK /
  hermetic fake); does not persist.
- `POST /api/projects/{projectId}/books/{bookId}/cover/images/jobs` — start async multi-option job
  (default 3 portrait `1024x1536` via `gpt-image-1`); optional iteration notes.
- `GET /api/projects/{projectId}/books/{bookId}/cover/images/jobs/{jobId}` — poll job status/options.
- `POST /api/projects/{projectId}/books/{bookId}/cover/images/apply` — write PNG to object storage and
  `book.update` the locator; requires storage configured (hermetic memory fake in E2E).
- `GET /api/projects/{projectId}/books/{bookId}/cover/download` — short-lived display URL (or hermetic
  data URI) for the applied locator.

Jobs are in-process for v1 (not a durable queue). History may acknowledge when options are ready.

## Character visuals (Cast gallery)

`storyKnowledge.update` may set optional `visuals` — an array of
`{ id, url, alt, caption?, source: generated|upload|url }` (1–24 when set; `null` clears).
Applied generate/upload images use stable `https://ghostwriter.character/...` locators; bitmap
bytes live in private object storage. Navigator and MCP reads include `visuals` when present.

- `POST /api/projects/{projectId}/story-knowledge/{knowledgeId}/visuals/jobs` — start async BYOK
  image job (prompt from label + sheet + notes).
- `GET /api/projects/{projectId}/story-knowledge/{knowledgeId}/visuals/jobs/{jobId}` — poll status/options.
- `POST /api/projects/{projectId}/story-knowledge/{knowledgeId}/visuals/apply` — write PNG (data URI)
  to object storage and append a visual via `storyKnowledge.update` (`source` generated|upload).
- `GET /api/projects/{projectId}/story-knowledge/{knowledgeId}/visuals/{visualId}/download` —
  short-lived display URL (or hermetic data URI) for a locator visual.

Delete removes the visual from `visuals` via `storyKnowledge.update` (metadata); object GC is
best-effort later. Jobs are in-process for v1 like book covers.

## Writing assist

- `POST /api/projects/{projectId}/writing-assist` accepts a role (`scene-partner`,
  `character-coach`, `worldkeeper`, `sketch-partner`), scene context, optional sketch/cast/
  backdrop caption, and optional recent prose excerpt. It returns inspectable proposals labeled
  `deterministic-local` when no provider path is used. Proposals never mutate the project; Apply is
  a separate client action through `scene.update`, `storyKnowledge.update`, or Draft caret insert.
  Live Scene Partner Capture turns use the Scene Partner routes above.

## Story Canvas

Each project owns one server-authoritative Canvas board with a positive, monotonically increasing
`board.version` independent from both `project.version` and scene `workingVersion`. Canvas objects
and links reference canonical scene and story-knowledge IDs; they never copy scene prose or become
another manuscript-order authority.

- `GET /api/projects/{projectId}/canvas` idempotently initializes and returns `{ board, spine }`.
  The board contains canonical objects, typed links, and optional `scopePlacements` keyed by
  `(objectId, scopeKind, scopeId?)`. Missing placements fall back to each object's global geometry.
  Legacy scope layouts are geometry-only. A placement marked `membership: "explicit"` also
  grants direct visibility in that scope; manuscript order stays on the tree. The spine is derived at
  read time from canonical book/part/chapter/unassigned scene order.
- `POST /api/projects/{projectId}/canvas/commands` accepts `expectedCanvasVersion` and one closed
  Canvas command. A completed create/place/update/move/resize/setScopePlacement/archive/restore/
  confirm/dismiss gesture advances the board exactly once and creates one immutable, SHA-256
  content-addressed snapshot. `canvas.object.setScopePlacement` upserts a scope layout without
  rewriting object identity; when `scopeKind` is `project`, it also updates global x/y/(optional)
  width/height so the project lens stays a single source. Pointer-move events are not API commands.
- `GET /api/projects/{projectId}/canvas/history` returns newest-first snapshot metadata without
  snapshot bodies. `limit` defaults to 100 and is bounded to 1–100; optional `beforeVersion` is an
  exclusive positive board-version cursor. A page returns `revisions` and, when more remain,
  `nextBeforeVersion`. New Undo/restore metadata includes `restoredFromRevisionId`.
- `POST /api/projects/{projectId}/canvas/history/restore` accepts `expectedCanvasVersion` and an
  optional `revisionId`. A supplied revision restores that snapshot as a new version/revision;
  omitting it performs guarded Undo of the latest logical writer action. Commands and explicit
  restores are actions; Undo records are traversed using provenance. Ambiguous legacy Undo or
  exhausted/unavailable history refuses without mutation; explicit history review remains available.
  Existing snapshots are never rewritten, and Canvas restore never restores manuscript prose.
- `GET /api/projects/{projectId}/canvas/preference` returns the current account's viewport or
  `null`. `PUT /api/projects/{projectId}/canvas/preference` accepts bounded `x`, `y`, `zoom`, and an
  optional `selectedObjectId`. Preferences are per-account and never advance the board version.
- `POST /api/projects/{projectId}/canvas/scenes` requires both `expectedProjectVersion` and
  `expectedCanvasVersion`, an explicit chapter or unassigned manuscript placement, and bounded
  Canvas geometry. One database transaction creates the canonical scene, advances manuscript
  metadata, initializes its empty scene document/genesis revision, and places its scene card. Any
  stale version, invalid reference, or persistence failure applies none of those effects.

Object kinds are `scene-card`, `story-knowledge-card`, `note`, `region`, and `image-reference`.
Link kinds are `pin`, `thread`, `beat`, `dependency`, and `reference`. Authority is `confirmed` or
`provisional`. Image requests accept metadata and a future local `assetId`; they do not accept an
upstream URL, fetch instruction, binary body, or generation provider.

The reading-order spine reports each canonical scene's book/chapter-or-unassigned placement,
canonical index, matching Canvas card, optional `storyOrderHint`, and drift. Canvas coordinates,
regions, links, and story-order hints never reorder Draft. Changing manuscript order remains a
separate explicit project command.

Unknown and unauthorized projects share `404 CANVAS_NOT_FOUND`. A stale Canvas command returns
`409 CANVAS_VERSION_CONFLICT`; an unavailable snapshot returns
`404 CANVAS_REVISION_NOT_FOUND`. Cross-project, dangling, duplicate, self-link, authority,
geometry, and placement failures are stable validation/refusal responses and apply nothing.

## Typed project commands

Project:

- `project.rename`
- `project.setArchived`

Books:

- `book.create`
- `book.update` (`title?`, `status?`, `cover?` with optional `concept` / `notes` / `imageUrl`;
  `null` cover clears; http(s) `imageUrl` only — no data URIs)
- `book.reorder`
- `book.setArchived`

Manuscript structure:

- `part.create`
- `part.rename`
- `part.update` (`title?`, `summary?` with `null` to clear)
- `part.reorder`
- `part.removeEmpty`
- `chapter.create`
- `chapter.rename` (title-only; prefer `chapter.update`)
- `chapter.update` (`title?`, `summary?` with `null` to clear)
- `chapter.reorder`
- `chapter.removeEmpty`

Scenes:

- `scene.create`
- `scene.update` (`title?`, `status?`, `summary?`, `povStoryKnowledgeId?`, `backdrop?`, `music?`, `imageRefs?`, `sketch?`; media/sketch fields accept `null` to clear; URLs must be absolute http(s); sketch is craft JSON — purpose/conflict/turn/beats/sensoryNotes/openQuestions/detail/inkPaths — not manuscript prose)
- `scene.move`
- `scene.setArchived`

Story knowledge:

- `storyKnowledge.create`
- `storyKnowledge.update` (`label?`, `kind?`, `authority?`, `notes?`, `aliases?`, `characterSheet?`; `null` clears notes/aliases/characterSheet; characterSheet holds desire/pressure/voiceNotes)
- `storyKnowledge.setSceneLink`
- `storyKnowledge.setKnowledgeLink` (`fromId`, `toId`, `kind` of `cast` | `theme` | `development-cycle` | `breadcrumb` | `related`, `linked`)
- `storyKnowledge.setArchived`

Each command has a closed schema in `apps/backend/src/api-contract.ts` and a domain implementation in
`packages/core/src/project-commands.ts`. The transport does not accept arbitrary SQL, table names,
JSON Patch, or untyped operations.

## Version and removal semantics

Commands recheck owner scope and exact project version, validate a complete normalized project,
increment once, and commit atomically. Concurrent use of the same base version lets one command
succeed and returns `409 VERSION_CONFLICT` for the other without partial effects.

Projects, books, scenes, and story-knowledge records archive and restore. A project retains at least
one active book. Parts and chapters may be removed only while empty. Story knowledge used as a scene
POV must be unassigned before archival. Permanent project/account purge is not exposed before
export, retention, backup, and account-exit policy.

Named editions remain read-only; scene checkpoints do not yet establish project-level edition and
export semantics.

## Stable error classes

- `400 INVALID_JSON` / `INVALID_REQUEST`
- `401 UNAUTHENTICATED`
- `403 UNTRUSTED_ORIGIN`
- `404 PROJECT_NOT_FOUND` or `RECORD_NOT_FOUND`
- `404 CAPTURE_NOT_FOUND`
- `409 VERSION_CONFLICT` or `UNSAFE_REMOVAL`
- `409 CAPTURE_VERSION_CONFLICT` or `CAPTURE_NOT_EDITABLE`
- `404 CANVAS_NOT_FOUND` or `CANVAS_REVISION_NOT_FOUND`
- `409 CANVAS_VERSION_CONFLICT`
- `404 REVISION_NOT_FOUND`
- `409 REVISION_CONFLICT`, `LEASE_CONFLICT`, `LEASE_EXPIRED`, or
  `VARIANT_NAME_CONFLICT`
- `413 PAYLOAD_TOO_LARGE`
- `422 INVALID_SCENE_DOCUMENT`, `INVALID_VARIANT_NAME`, domain validation, invalid order, or
  invalid placement
- `500 INTERNAL_ERROR`

Errors and diagnostics do not include manuscript text, cookies, OAuth codes, provider tokens, or
request bodies.

## MCP parity

The existing fixture MCP navigator (`ghostwriter_project_navigator`) uses the same core projection,
including those story-knowledge read fields (`notes`, `aliases`, `characterSheet`). All 24 project
commands plus
scene lease/save/checkpoint/variant/restore web bindings are registered with explicit MCP
exceptions: direct external-agent writes remain unavailable until scoped grants and remote/local
MCP authorization are accepted. Authenticated scene workspace/history reads and prose-bearing
comparison also have explicit MCP exceptions until that transport can carry project authority.
Canvas board/history/preference reads and command/restore/scene-handoff writes are likewise
registered with backend bindings and explicit MCP authorization exceptions.
These exceptions preserve the human/agent authority contract rather than silently granting a
fixture process owner authority.

### Canvas scope creation (story workflow foundation)

Canvas `canvas.object.create` / `canvas.object.place` accept optional
`scope: { scopeKind: "project" | "chapter" | "scene", scopeId?: string }`.
Project scope has no ID; chapter and scene scopes require an existing authorized-project target.
The object and its initial scoped geometry with `membership: "explicit"` persist in one
expected-Canvas-version command. Existing geometry-only rows are not backfilled; geometry edits
preserve the marker without inventing membership. Invalid new targets are refused while old
orphan placements remain inspectable from project Canvas.
Create-scene-from-Canvas accepts the same optional `canvas.scope` in its existing atomic handoff.
`canvas.object.setScopePlacement` also validates newly targeted scopes and serves complete geometry
updates (position plus size) without two racing writes. No endpoint bypasses owner authorization.

`canvas.object.setScopeMembership` accepts `objectId`, the typed scope fields and `member`.
Adding explicit inclusion requires an active object and active target scope and uses existing
resolved geometry. Removing inclusion permits historical unavailable scopes and preserves all
placement geometry, objects and links. Canonical scene membership and legacy graph-related
visibility can still keep an object visible after its explicit marker is removed. Both operations
use the normal expected board version; neither changes manuscript membership.

### Shared scene intent and narrative threads

The existing owned-project command endpoint accepts `scene.updateIntent` with a partial
`patch` of purpose, conflict, turn and openQuestions. Null clears a field; omitted fields
and the rest of the sketch are preserved. These changes use the project metadata version,
not the scene document or Canvas board version.

Thread-kind story knowledge supports `storyKnowledge.addNarrativeBeat`,
`storyKnowledge.updateNarrativeBeat`, `storyKnowledge.setNarrativeBeatArchived`, and
`storyKnowledge.setNarrativeResolution`. Beats have stable IDs, scene anchors, explicit
roles and same-thread dependency IDs. Invalid/cyclic references and stale project versions
refuse without mutation. New anchors must be active; archival retains inspectable references.
The project navigator returns this canonical optional narrative aggregate. Legacy threads
without one remain Unmapped; ordinary knowledge links do not imply causality.

Draft and Canvas share these commands through StoryContextCompanion. External canonical
approval/apply remains unavailable; scoped proposal parity is an open epic checkpoint.

### Personal Canvas return state

`GET /api/projects/:projectId/canvas/view-preference` returns `{ preference }` (null if
absent). `PUT` accepts `expectedPreferenceVersion` (0 for creation), one full `scopeView`,
and `lastScope`. Both scopes use `{ scopeKind: "project" | "chapter" | "scene", scopeId? }`.
A view contains viewport `{x,y,zoom}`, spatial/outline viewMode, inspectorOpen, focusToken
(surface/inspector/search), workflowLens and optional selectedObjectId/inspectedSceneId
(null clears a selection). Server timestamps and a new independent preference version are
returned. This never advances project or Canvas board versions.

A stale write returns `409 PREFERENCE_VERSION_CONFLICT`. Ownership and references are
validated; invalid saved scene scopes fall back to their active chapter or project. The map
is capped at 1,024 entries, retaining project/current scope and evicting the oldest other
view. Legacy `/canvas/preference` remains compatible and advances the same preference CAS
while updating the project camera. Client queue/hydration acceptance is tracked in the epic.

### Story-work assignments (ADR 0018, implementation in progress)

Character and scene workflows use `/api/projects/:projectId/story-work/assignments` with the
authenticated project owner. Assignment definitions preserve the original brief, constraints,
done condition, selected source IDs/revisions, provider/model and server-reserved destination.
The separate assignment version fences workflow changes; canonical project metadata, scene prose
and Canvas keep their own versions.

- `POST /assignments` accepts `taskKind` (`character`, `scene`, `revise`, `outline`, or `check`),
  `idempotencyKey`, `expectedProjectVersion`, `brief`, `constraints`, `doneWhen`, `sceneIds` (zero
  to 32), and `model`; `revise` additionally requires its distinct `targetSceneId`; `outline`
  requires `targetBookId` on one active book and does not accept Capture sources; check kinds use
  the discriminated check submission schema. Scene work may include one active `captureId`. It
  returns `{assignment,created}`.
- `GET /assignments?limit=100` returns bounded assignments. `GET /assignments/:id` returns the
  assignment and available current proposal, latest/active attempt, linked run and context receipt.
- `POST /assignments/:id/attempts` accepts `expectedAssignmentVersion`, `kind` (`initial` or
  `revision`), exact `instruction`, optional exact `priorArtifact`, `sourceMode`
  (`submitted-snapshot` initially; `latest-authorized` for an explicit refresh revision), and `idempotencyKey`. Replayed
  requests return the same persisted attempt without another provider call.
- `POST /assignments/:id/review/open`, `PATCH /assignments/:id/review`, and
  `POST /assignments/:id/review/reject` use `expectedAssignmentVersion` and the exact `artifact`
  (`proposalId`, `artifactVersion`, `contentHash`). PATCH additionally accepts the complete
  `character-create-v2`, `scene-draft-v1`, or `story-structure-proposal-v1` payload. Edits produce
  an immutable replacement proposal and preserve the original generated artifact's lineage.
  Structure review edits may change semantic fields only; canonical IDs, operation IDs and expected
  baseline remain server-owned.
- `POST /assignments/:id/apply` always binds the exact assignment/proposal/artifact tuple.
  Character apply additionally requires `expectedProjectVersion`. Scene apply requires an
  `idempotencyKey` and one strict mode: `create-scene` with project/manuscript and optional complete
  Canvas placement preconditions; `named-variant` with exact scene head plus variant name; or
  `apply-revision` with the exact scene head. Update requests never accept a lease holder—the
  backend derives it from the authenticated session. It returns
  `{replayed,assignment,proposal,result}` only after the atomic write. Exact repeated application
  creates no duplicate; changed semantics reuse refuses. Changed consumed prose/story context,
  project/Canvas versions, scene head, lease or variant name applies nothing.
- `taskKind: check` currently supports specialist `continuity` with an explicit
  `applied-scene` target or exact `proposal-draft` source assignment/artifact. Check attempts use
  the same durable start/replay route but persist trusted `story-check-findings-v1` artifacts:
  provider candidates cannot choose finding IDs, coverage, dependency vectors or review authority.
  Assignment detail includes read-only `checkFreshness`. `PATCH
  /assignments/:id/review/findings/:findingId` resolves one exact finding as open, dismissed or
  deferred; `POST /assignments/:id/review/complete` records noncanonical review completion only
  while sources remain fresh. Checks have no apply route.
- `taskKind: outline` uses trusted `story-structure-proposal-v1` with server-allocated operation and
  entity IDs. Provider candidates cannot choose IDs, apply subsets, or authority.
- `POST /assignments/:id/review/preview` (outline only) accepts `expectedAssignmentVersion`,
  `expectedProjectVersion`, the exact structure artifact, and a non-empty unique
  `selectedOperationIds` list. It returns a pure preview: resolved operation order, manuscript
  before/after, created/updated scene IDs, empty genesis descriptors, narrative-anchor impact,
  known check staleness, and optional Canvas effects. Invalid partial selection returns explicit
  `missingRequired` operation IDs without silently widening the writer's selection. Preview performs
  no writes and does not rerun providers.
- Outline apply uses the same `POST /assignments/:id/apply` route with
  `applyStructureStoryWorkRequestSchema`: exact proposal/artifact preconditions,
  `expectedProjectVersion`, dependency-complete `selectedOperationIds`, `idempotencyKey`, and
  optional one new-scene Canvas placement preconditions. One transaction updates project metadata
  once, initializes empty genesis documents for new scenes, optionally places one Canvas card, and
  records a durable result of kind `story-structure` (`resolvedOperationIds`, `createdSceneIds`,
  `bookId`, `projectVersion`, optional `canvasPlacedSceneId`/`canvasObjectId`). Exact replay returns
  the stored result without a second version increment. Stale project, Canvas, artifact or incomplete
  selection applies nothing. Structure apply never writes scene prose.

These are first-party human review/apply routes. They do not grant external MCP clients direct
canonical-write authority. MCP bindings remain the later CP6 checkpoint.
