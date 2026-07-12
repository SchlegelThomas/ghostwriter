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

- Core invariants:
- Repository parity/rollback:
- Backend auth/validation/conflict:
- Client state:
- Wide Playwright:
- Narrow/accessibility Playwright:
- Performance or scale fixture:

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
- [ ] Prior browser journeys still pass
- [ ] Docs and handoff are current

## Evidence

- Targeted checks:
- `pnpm verify`:
- Playwright:
- Diagnostics/diff:
- Commit:

## Harness learning

- Friction observed:
- Reusable improvement:
- Skill/rule/template update:
