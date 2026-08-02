# 0015: Proactive next actions and ambient cheap coach

- Status: accepted
- Date: 2026-08-01
- Plan: `plans/active/2026-08-01-proactive-next-actions/plan.html`
- Extends: ADR 0011, ADR 0014

## Context

Writers benefit when Ghostwriter quietly suggests the next useful move after meaningful work —
create missing story knowledge, sharpen craft, or engage the right catalog agent — without a
second inbox or silent BYOK spend. Capture already uses a local quiet invite pattern (ADR 0011).
Catalog memos and pacing findings land as entity drafts (ADR 0014) with Acknowledge-only closure.
This epic generalizes proactive coaching across the workspace with an optional cheap-tier ambient
coach.

## Decision

### Three tiers

1. **Local guide (default):** After an acknowledged state change and idle, show zero-cost invite
   chips and explicit Start. Never egresses or spends provider budget.
2. **Cheap coach (opt-in ambient):** A Ghostwriter-mark toggle in the Agent pane header enables
   ambient cheap-coach runs after acknowledged save + idle. Off by default (`autoSuggestions:
   false` in workspace agent prefs). When on, egress uses Haiku / Flash / GPT-4.1-mini class with
   receipt and hard caps.
3. **Escalate:** Stronger models require a separate writer confirm even when ambient coach is on.

### Proposal landing

- Proactive coach output uses schema `next-action-v1` and lands as ADR 0011/0014 entity drafts
  (primary target scene / project / story knowledge), not a separate suggestions inbox.
- Acknowledge closes the draft without canon mutation, same as catalog memos and pacing findings.
- Individual suggestions may propose creating story knowledge or starting catalog agents; those
  still require explicit writer action to apply.

### Schema and detection

- `next-action-v1` payloads carry a trigger, summary, bounded suggestion list, and optional
  escalate hint. Suggestion kinds include create-story-knowledge, run-catalog-agent, open-surface,
  escalate-model, and continue-writing.
- Entity detection for new characters or missing roster entries uses cheap-coach structured
  extraction with the project cast/story-knowledge roster in prompt context — **no vector DB** for
  this epic.
- First vertical trigger: scene prose save + idle.

### Invariants

- Propose ≠ apply. No silent manuscript or story-knowledge writes.
- No spend on keystroke or while Saving; wait for acknowledged save + idle.
- Dismissible without nag; durable dismiss per invitation kind where Capture already does.
- Selection refusals stay honest when context is missing.

## Options considered

- **Separate Suggestions inbox** — rejected; duplicates ADR 0014 entity drafts.
- **Always-on ambient coach** — rejected; violates ADR 0011 quiet-invite posture and BYOK consent.
- **Vector DB for roster comparison** — deferred; scene-vs-roster extraction is sufficient for v1.

## Consequences

- Core exposes typed `next-action-v1` validation, invitation eligibility helpers, and workspace
  prefs for `autoSuggestions`.
- Acknowledge path treats `next-action-v1` like catalog memos.
- CP1+ wire Agent pane toggle UI, scene-save trigger, provider routes, and coach workflow.
- Embeddings / whole-corpus retrieval remain a future Continuity/RAG concern, not this epic.
