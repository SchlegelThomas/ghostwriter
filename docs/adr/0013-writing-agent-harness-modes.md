# ADR 0013: Writing agent harness modes and Plan→Plans

## Status

Accepted — 2026-08-01

## Context

Ghostwriter’s Agent dock exposes three harness modes — **Chat**, **Plan**, and **Agent** — backed by the same BYOK provider runtime but with different instructions and writer affordances (see [ADR 0011](./0011-byok-context-proposals-playbooks-and-mcp-grants.md) for the broader propose-only agent platform).

Plan mode helps writers brainstorm outlines and structure without mutating manuscript canon. CP5 adds an explicit **Save to Plans** action that persists a Plan-mode assistant reply as a durable typed agent proposal bound to a new Capture seed, then opens Plans to that idea.

## Decision

1. **Harness modes** remain instruction/profile variants on the workspace chat route (`chat` | `plan` | `agent`). Plan mode does not auto-persist every turn; the writer must choose **Save to Plans**.

2. **Plan→Plans workflow** uses a dedicated agent workflow id `plan-mode.outline` and output schema `plan-outline-v1`:
   - `title` — short label derived from an optional writer title or the first outline line
   - `outline` — full markdown/plain outline body (the Plan assistant reply)
   - `sourceMode: "plan"`

3. **Persistence path** (no second LLM call):
   - Create a Capture with the outline as its noncanonical document body
   - Build a minimal context receipt + agent run + ready proposal via existing foundation completion (`completeReflectionRun`) without calling a provider
   - Bind proposal to the Capture through the existing `baseCaptureId` invariant

4. **Apply semantics** for `plan-outline-v1`:
   - **Reject** — standard proposal rejection
   - **Acknowledge** — marks proposal `applied` with **zero manuscript side effects** via `acknowledgeProposal` on foundation services
   - No new-scene, named-variant, or craft-fields apply paths for this schema in CP5

5. **API**: `POST /api/projects/:projectId/agent/plan-outlines` accepts `{ outlineText, title?, model? }` and returns `{ captureId, proposalId, runId, proposal }`. Acknowledge via `POST .../proposals/:proposalId/acknowledge`.

## Consequences

- Plan outlines live in Plans as Captures plus a typed proposal card; manuscript tree and scene documents are untouched until the writer promotes or edits canon separately.
- Reuses existing agent run/proposal storage; no migration beyond JSON payload and string workflow/schema ids.
- Craft partner apply paths remain unchanged; `craftPartnerOutputSchemaId` excludes `plan-outline-v1`.

## Related

- [ADR 0011 — BYOK context, proposals, playbooks, and MCP grants](./0011-byok-context-proposals-playbooks-and-mcp-grants.md)
- [ADR 0010 — Capture, Inbox, media, and promotion](./0010-capture-inbox-media-and-promotion.md)
- [ADR 0012 — Multi-provider model registry](./0012-multi-provider-model-registry.md)
