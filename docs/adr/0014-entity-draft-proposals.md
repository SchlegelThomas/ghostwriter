# 0014: Entity drafts extend agent proposals

- Status: accepted
- Date: 2026-08-01
- Extends: ADR 0011

## Context

Writing agents need to leave recommendations beside scenes, story knowledge, books, and projects.
Creating a separate drafts store would duplicate ADR 0011 proposal status, approval, provenance,
and content-hash authority.

## Decision

- An ADR 0011 `AgentProposal` has one `primaryTarget` with kind `capture`, `scene`,
  `story-knowledge`, `book`, or `project` and an opaque project-scoped target ID.
- Capture-targeted proposals require the existing Capture ID, working version, and content hash.
  Other targets may carry all three Capture-base fields as provenance, or none.
- Proposal content identity includes the primary target and, when present, the Capture base.
- Ready proposals are listed by primary target from the same proposal repository, newest first,
  with a maximum of 100 results.
- Apply still requires a first-party owner, ready status, and the exact proposal content hash.
  A present Capture base is rechecked; an absent base adds no synthetic Capture precondition.
- Reject remains the atomic `ready` to `rejected` transition.

Migration 0021 backfills existing proposal targets as
`{ kind: "capture", id: base_capture_id }` before making the target columns required. Existing
stored hashes remain their historical approval identities; every proposal created under this
decision hashes its primary target.

## Consequences

Entity drafts remain durable, noncanonical proposals rather than a second source of truth. Entity
surfaces can share one list/reject/apply contract, while Capture-backed workflows retain their
revision guard unchanged.
