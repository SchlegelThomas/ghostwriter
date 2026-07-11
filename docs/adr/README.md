# Architecture decision records

ADRs preserve decisions whose consequences outlive the feature that introduced them. They are
short, immutable records: amend only factual errors; supersede a decision with a new ADR.

## Create or update an ADR when

- choosing or replacing a foundational technology, runtime, persistence model, sync model, or AI provider;
- changing platform boundaries, deployment architecture, security posture, or data ownership;
- accepting a long-lived product-platform tradeoff with meaningful cost or maintenance impact.

Do not use an ADR for a local refactor or implementation detail that a feature plan already
fully explains.

## Process

1. Add the ADR as a task in the active plan's **Documentation and ADR impact** section.
2. Copy the template below into `docs/adr/NNNN-short-title.md`.
3. Record the decision, context, options, and consequences. Link the plan.
4. Add a record-log entry and update relevant product, architecture, or operations docs.

## Template

```markdown
# NNNN: Short decision title

- Status: accepted | superseded by NNNN
- Date: YYYY-MM-DD
- Plan: `plans/active/YYYY-MM-DD-short-slug/plan.html`

## Context
What durable problem requires a decision?

## Decision
What are we doing?

## Options considered
- Option A — tradeoff
- Option B — tradeoff

## Consequences
What becomes easier, harder, more expensive, or no longer possible?
```
