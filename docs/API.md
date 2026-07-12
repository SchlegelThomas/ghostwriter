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
require an exact trusted `Origin`. JSON bodies are limited to 64 KiB and schema-validated.

## Account and profile

- `GET /api/me` returns the authenticated account, opaque session metadata, and idempotently
  bootstrapped Ghostwriter writer profile.
- `PATCH /api/me/profile` accepts `displayName` and `expectedVersion`. A stale profile returns
  `409 VERSION_CONFLICT`.

Email, display name, and provider image are not authorization keys. Core uses the opaque Better Auth
user ID as its provider-neutral `AccountId`.

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
- `part.reorder`
- `part.removeEmpty`
- `chapter.create`
- `chapter.rename`
- `chapter.reorder`
- `chapter.removeEmpty`

Scenes:

- `scene.create`
- `scene.update`
- `scene.move`
- `scene.setArchived`

Story knowledge:

- `storyKnowledge.create`
- `storyKnowledge.update`
- `storyKnowledge.setSceneLink`
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

Named editions are read-only until immutable project and scene revisions are implemented.

## Stable error classes

- `400 INVALID_JSON` / `INVALID_REQUEST`
- `401 UNAUTHENTICATED`
- `403 UNTRUSTED_ORIGIN`
- `404 PROJECT_NOT_FOUND` or `RECORD_NOT_FOUND`
- `409 VERSION_CONFLICT` or `UNSAFE_REMOVAL`
- `413 PAYLOAD_TOO_LARGE`
- `422` domain validation, invalid order, or invalid placement
- `500 INTERNAL_ERROR`

Errors and diagnostics do not include manuscript text, cookies, OAuth codes, provider tokens, or
request bodies.

## MCP parity

The existing fixture MCP navigator uses the same core projection. All 22 canonical web commands are
registered with explicit MCP exceptions: direct external-agent writes remain unavailable until
scoped grants and remote/local MCP authorization are accepted. The exception preserves the
human/agent authority contract rather than silently granting a fixture process owner authority.
