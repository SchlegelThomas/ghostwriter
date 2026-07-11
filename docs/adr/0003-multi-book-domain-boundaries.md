# 0003: Multi-book project and manuscript boundaries

- Status: accepted
- Date: 2026-07-11
- Plan: `plans/active/2026-07-11-multi-book-domain-kernel/plan.html`

## Context

Ghostwriter must support a single novel and a multi-book story world without turning either the
project, the manuscript, or the Story Canvas into a second source of truth. The first production
slice needs stable records and use-case boundaries that can be exercised in memory now and stored
by the future server-authoritative backend later.

The technical blueprint already accepts scene-granular writing, project-wide story knowledge,
book-owned manuscript order, named editions, and shared core capabilities for UI and MCP. It also
warns against one giant project document, provider types in core, generic CRUD, and pre-choosing a
database or synchronization protocol.

## Decision

Use a normalized multi-book domain with these ownership and reference rules:

- **Project** is the story-universe, permission, collaboration, archive, and account-exit boundary.
  It owns the canonical ordered references to one or more books.
- **Book** belongs to exactly one project. It owns its manuscript structure and release state.
  Parts contain ordered chapters; chapters contain ordered scene references. Unscheduled scenes
  remain explicit rather than disappearing from the manuscript.
- **Scene** belongs to exactly one project and book and is the primary writing, revision, review,
  retrieval, and lease unit. Scene metadata is a record in core; its versioned ProseMirror body and
  block schema arrive in the editor plan.
- **Story-knowledge records** belong to the project and may reference scenes across its books.
  Their authority is always explicit as planned, confirmed, inferred, or disputed. The complete
  typed story-bible model remains a later plan.
- **Named editions** belong to one book and point to immutable project and scene revision IDs.
  This kernel establishes the reference boundary; revision graph creation, compare, restore, and
  retention behavior arrive with the revisions plan.
- IDs are opaque, globally unique, stable domain values. Arrays of references carry intentional
  writer-facing order; duplicated numeric `order` fields are not another authority.
- Manuscript, Canvas, review, and MCP projections reference canonical record IDs. They do not copy
  scene bodies or create surface-specific scene records.
- Core commands and queries are plain functions over explicit repository, transaction, ID, and
  clock ports. Adapters may store records differently, but transport, database, React, DOM, Expo,
  Electron, MCP SDK, and provider types do not enter core.
- The initial memory repository stores normalized records and validates the same cross-record
  invariants expected of a server adapter. A fixture bundle is test/sample input, not a proposed
  database document or second canonical store.

## Options considered

- **One nested project document** — simple for the scaffold, but forces whole-project loads and
  writes, makes scene leases and subscriptions coarse, and scales poorly for long series.
- **Independent book projects with copied series knowledge** — reduces each project’s size but
  creates duplicate characters, facts, arcs, and cross-book history with ambiguous authority.
- **Generic entity/attribute graph** — flexible, but weakens domain validation and leaks generic
  storage concerns into writer-facing concepts.
- **Normalized project, book, scene, knowledge, and edition records with stable references** —
  selected. It preserves one story universe while allowing scene- and book-sized operations.

## Consequences

- A series and a standalone novel use the same model; a standalone project simply has one book.
- Manuscript order can change without rewriting scene records, and Story Canvas placement cannot
  silently reorder prose.
- Cross-record commands require a transaction and validation rather than mutation of one nested
  object.
- Repository adapters need efficient record queries and transactional invariant enforcement, but
  remain free to choose a concrete database after the platform spike.
- Scene body schema, revision graph mechanics, collaboration transport, and backend layout are not
  settled by this ADR and must not be inferred from the in-memory implementation.
- Future changes to these ownership boundaries or authority states require a superseding ADR;
  adding fields or adapters inside the boundaries does not.
