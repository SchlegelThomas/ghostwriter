# Feature checkpoint template

Use one copy per observable feature. Keep it in working notes or the active plan record.

## Outcome

- Writer-visible result:
- Entry point:
- Successful end state:
- Refusal/error states:
- Explicit non-goals:

## Parent frame

- Analysis / plan notes:
- Bounded slices for delegates:
- Shared version domains kept serial:
- End-to-end acceptance owner: parent

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

## Parallel research

- Fan-out digs launched (paths/questions):
- Conflicting findings resolved by parent:
- Shared write targets kept serial:

## Delegation ladder

Prefer Composer (`fast` → `standard`), then Grok (`high-fast`). Escalate only with reason:
`escalate-opus` (`high`) for creative work; `escalate-gpt` (`sol` → `terra`) for concrete work.
Effort is chosen with the model variant (`GHOSTWRITER_EFFORT=…`). Parent owns end-to-end
acceptance. Defer Playwright until the user verifies the complete outcome.

- Route marker (`composer` / `grok` / `escalate-opus` / `escalate-gpt`):
- Effort (`fast` / `standard` / `high-fast` / `high` / `sol` / `terra`):
- Subagent + resolved model:
- Focused command/result:
- Composer attempt count:
- Grok attempt count:
- Escalation reason/evidence (if any):
- User verification received:
- Deferred Playwright audit (`GHOSTWRITER_PLAYWRIGHT_GATE=user-verified`):
- Full suite run only after user verification and focused green:

## Delegated work

For each Task/subagent:

- Outcome attempted:
- Files touched:
- Evidence:
- Parent still owns:
- Stop reason (`done` / `blocked` / `escalate`):

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
- [ ] Delegated “parent still owns” items closed
- [ ] Parent completed end-to-end acceptance (not subagent-green alone)

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
