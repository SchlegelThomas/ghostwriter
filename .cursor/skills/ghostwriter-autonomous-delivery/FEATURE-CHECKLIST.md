# Feature checkpoint template

Use one copy per observable feature. Keep it in working notes or the active plan record.

## Outcome

- Writer-visible result:
- Entry point:
- Successful end state:
- Refusal/error states:
- Explicit non-goals:

## Domain map

- Canonical objects and IDs:
- Ownership and authorization:
- Relationships and reference rules:
- State transitions:
- Archive/restore/deletion:
- History/provenance:
- Concurrency domain and expected precondition:
- Transaction boundary and rollback:

## Design map

- Living-design screens/concepts:
- Wide layout:
- Narrow layout:
- Selection/focus handoff:
- Save/acknowledgement:
- Conflict/recovery:
- Keyboard/screen-reader path:
- Reduced-motion behavior:

## Binding map

- Core command/query:
- Repository ports:
- Memory adapter:
- Postgres tables/migration:
- Backend route/contract:
- Client state:
- UI surface:
- Capability registry:
- MCP binding or explicit exception:

## Tests

Route authorship/repair through model-pinned project subagents: `routine-tests` (Composer 2.5
fast) by default; `hard-tests` (Grok 4.5) only for an intrinsically hard case or after two distinct
evidence-backed routine attempts. During implementation, use a real-browser walkthrough instead
of writing Playwright. Defer Playwright until the user explicitly verifies the complete outcome.

- Core invariants:
- Repository parity/rollback:
- Backend auth/validation/conflict:
- Client state:
- Wide browser walkthrough:
- Narrow/accessibility browser walkthrough:
- Performance or scale fixture:
- Routing marker (`routine` or `hard`):
- Subagent + resolved model:
- Focused command/result:
- Composer attempt count (maximum 2):
- Hard escalation reason/evidence (if any):
- User verification received:
- Deferred Playwright audit (`GHOSTWRITER_PLAYWRIGHT_GATE=user-verified`):
- Full suite run only after user verification and focused green:

## Documentation

- Active plan/todo:
- Record log:
- API:
- Product:
- Architecture/ADR:
- Operations:
- Handoff:

## Cumulative coherence gate

- [ ] No duplicate canonical state
- [ ] Tree/manuscript order and Canvas relationships agree
- [ ] Draft, history, reader, Canvas, and split share IDs
- [ ] All success UI follows durable acknowledgement
- [ ] Conflicts apply nothing and expose review/recovery
- [ ] Recovery remains bounded and noncanonical
- [ ] Memory/Postgres and migration paths agree
- [ ] Authorization/non-disclosure remain intact
- [ ] Keyboard, focus, narrow, and reduced motion work
- [ ] Capabilities/MCP exceptions are truthful
- [ ] Prior workflows pass direct browser walkthroughs
- [ ] Docs and handoff are current

## Evidence

- Targeted checks:
- `pnpm verify`:
- Browser walkthrough:
- User verification:
- Deferred Playwright:
- Diagnostics/diff:
- Commit:

## Harness learning

- Friction observed:
- Reusable improvement:
- Skill/rule/template update:
