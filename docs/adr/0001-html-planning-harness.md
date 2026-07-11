# 0001: HTML delivery plans and an autonomous documentation-first workflow

- Status: accepted
- Date: 2026-07-11
- Plan: `plans/active/2026-07-11-html-planning-harness/plan.html`

## Context

Ghostwriter will be built collaboratively through long-running agent work. The prior Markdown
checklist convention was too lightweight to reliably capture acceptance criteria, test intent,
documentation impact, and durable decisions before implementation.

## Decision

New active plans use semantic HTML (`plan.html` and `record-log.html`) with a shared local
stylesheet. Every plan must explicitly include intent, acceptance criteria, tasks, tests and
verification, documentation and ADR impact, risks and decisions, and checkable todos.

An accepted plan authorizes agents to work autonomously through small implementation,
verification, documentation, and record-log loops. Agents stop for user input only when a
material decision or external side effect is outside the accepted plan.

## Options considered

- Keep concise Markdown plans — simpler to author but insufficiently structured for the desired
  documentation-first, long-running workflow.
- Use an external project-management system — richer workflows but adds account, cost, and
  context-switching overhead for a small local-first project.

## Consequences

Plans become more deliberate and readable in a browser, with a small authoring overhead.
Historical Markdown plans remain unchanged to preserve history. New plans must maintain richer
documentation throughout delivery, not only at handoff.
