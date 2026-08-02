# 0016: Chat work plans and job bundles

- Status: accepted
- Date: 2026-08-01
- Plan: `plans/active/2026-08-01-chat-work-plans/plan.html`
- Extends: ADR 0011, ADR 0013, ADR 0014, ADR 0015

## Context

The Agent dock can brainstorm multi-step next moves (catalog agents, Scene Partner, story
knowledge, cast checks) but historically only *described* submission. Writers need Submit to
start real work, review results in Entity Drafts, and track a bundle in the dock — without
silent manuscript mutation.

## Decision

### Work plan schema

- Structured plans use `work-plan-v1`: summary + ordered jobs with kinds
  `run-catalog-agent`, `create-story-knowledge`, `open-scene-partner`, `cast-reference-check`.
- Plans may be attached to assistant chat turns (tool emission or UI construction from
  next-action suggestions). Free-form “submit” binds to the latest attached plan.

### Execution waves (policy C)

1. **Wave A (cheap):** catalog agents (except when deferred), story-knowledge drafts, cast /
   continuity checks — run in parallel.
2. **Wave B (heavy):** Scene Partner (Plans capture + prefilled brief deep-link), then any
   Dialogue Coach (or other heavy-marked catalog) deferred because a Scene Partner job is in
   the same plan.

v1 orchestration is **client-driven** over existing `catalog-runs`, capture create/save, and
new SK-draft endpoints. No durable server worker queue in this ADR.

### Landing

- Catalog and continuity results → ready proposals / Entity Drafts (ADR 0014).
- Story knowledge → `story-knowledge-create-v1` ready draft; **Acknowledge creates** the Cast
  record via `storyKnowledge.create` (explicit writer gate; still not silent).
- Scene Partner → Plans capture seeded with the job brief + existing Scene Partner workflow
  deep-link (propose/apply remains in Plans).
- Agent pane shows a **job-bundle strip** for in-flight/completed status alongside Entity Drafts.

### Spend

- Submit may spend BYOK immediately for all jobs in the plan. Ambient Auto suggestions (ADR
  0015) do not auto-submit work plans. Future spend limits are a separate product plan.

### Invariants

- Propose ≠ apply for manuscript prose.
- MCP and chat tools may propose/submit work plans and create drafts; they must not apply
  manuscript or craft fields without the existing human apply paths.
- Missing required targets (e.g. scene for Dialogue Coach) refuse that job honestly without
  failing unrelated jobs when possible.

## Options considered

- **Narrated fake queue** — rejected; breaks trust (observed in writer transcript).
- **Fully parallel everything** — rejected; Scene Partner → Dialogue Coach ordering matters.
- **Per-job spend confirm** — deferred; founder chose spend-on-submit for now.
- **Server durable job queue** — deferred; client orchestration is enough for v1.

## Consequences

- New schemas and acknowledge/create path for story knowledge drafts.
- Chat tool surface grows beyond read-only navigator tools.
- Living designs (Mockups 4.0/5.0) remain propose→human-apply for canon; this ADR adds
  execute-into-drafts, not silent canon writes.
