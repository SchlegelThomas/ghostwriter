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
  structure/scene metadata/story-knowledge projection.
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

## Writing assist

- `POST /api/projects/{projectId}/writing-assist` accepts a role (`scene-partner`,
  `character-coach`, `worldkeeper`, `sketch-partner`), scene context, optional sketch/cast/
  backdrop caption, and optional recent prose excerpt. It returns inspectable proposals labeled
  `deterministic-local` in v1. Proposals never mutate the project; Apply is a separate client
  action through `scene.update`, `storyKnowledge.update`, or Draft caret insert.

## Story Canvas

Each project owns one server-authoritative Canvas board with a positive, monotonically increasing
`board.version` independent from both `project.version` and scene `workingVersion`. Canvas objects
and links reference canonical scene and story-knowledge IDs; they never copy scene prose or become
another manuscript-order authority.

- `GET /api/projects/{projectId}/canvas` idempotently initializes and returns `{ board, spine }`.
  The board contains canonical objects, typed links, and optional `scopePlacements` keyed by
  `(objectId, scopeKind, scopeId?)`. Missing placements fall back to each object's global geometry.
  Scope layouts are interpretive only; manuscript order stays on the tree. The spine is derived at
  read time from canonical book/part/chapter/unassigned scene order.
- `POST /api/projects/{projectId}/canvas/commands` accepts `expectedCanvasVersion` and one closed
  Canvas command. A completed create/place/update/move/resize/setScopePlacement/archive/restore/
  confirm/dismiss gesture advances the board exactly once and creates one immutable, SHA-256
  content-addressed snapshot. `canvas.object.setScopePlacement` upserts a scope layout without
  rewriting object identity; when `scopeKind` is `project`, it also updates global x/y/(optional)
  width/height so the project lens stays a single source. Pointer-move events are not API commands.
- `GET /api/projects/{projectId}/canvas/history` returns newest-first snapshot metadata without
  snapshot bodies.
- `POST /api/projects/{projectId}/canvas/history/restore` accepts `expectedCanvasVersion` and an
  optional `revisionId`. A supplied revision restores that snapshot as a new version/revision;
  omitting it performs immediate guarded Undo to the preceding snapshot. Existing history is never
  rewritten.
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
- `book.update`
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
- `409 VERSION_CONFLICT` or `UNSAFE_REMOVAL`
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

The existing fixture MCP navigator uses the same core projection. All 24 project commands plus
scene lease/save/checkpoint/variant/restore web bindings are registered with explicit MCP
exceptions: direct external-agent writes remain unavailable until scoped grants and remote/local
MCP authorization are accepted. Authenticated scene workspace/history reads and prose-bearing
comparison also have explicit MCP exceptions until that transport can carry project authority.
Canvas board/history/preference reads and command/restore/scene-handoff writes are likewise
registered with backend bindings and explicit MCP authorization exceptions.
These exceptions preserve the human/agent authority contract rather than silently granting a
fixture process owner authority.
