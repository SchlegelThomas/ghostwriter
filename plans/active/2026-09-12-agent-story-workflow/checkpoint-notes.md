# Checkpoint working notes

Implementation authorized 2026-09-12. CP0a/CP0b foundation slice in progress.

- Outcome: inspect Canvas without replacing Draft; create visible chapter objects; find unplaced scenes; consistent scoped geometry; predictable consecutive Undo.
- Refusals: unknown/foreign scope, stale board version, archived target; no canonical prose writes from Canvas inspection or Undo.
- Domain: same canonical scene/knowledge IDs, board version for placement/geometry/history, independent scene lease/version. Scope placement explicitly grants visibility; legacy graph inclusion is currently preserved and requires compatibility review before CP0a acceptance.
- Binding: core CanvasCommand adds optional scope to create/place; existing relational placement table persists within the same board transaction; strict backend accepts typed scope; UI sets current scope. No new store/migration for this additive contract.
- History: reconstruct action stack from append-only ordered revision reasons. Normal command/explicit restore pushes, Undo pops; exhausted stack refuses without mutation. No Redo introduced; snapshot restore stays explicit. Older pre-fix Undo sequences require documented compatibility treatment before CP0b completion.
- Delegation: Sol/medium and Sol/high agents all failed before edits due workspace credits. Parent continues locally under user’s explicit continue instruction; no model success claim.
- Checks: focused existing + new scope/search/Undo tests, client typecheck, direct browser, affected backend/storage, then pnpm verify. Playwright remains gated on complete-outcome user verification.
- Parent still owns: all checkpoint acceptance, scope legacy independence/recovery, complete narrow/focus behavior, new-scene atomic scope handoff, persistence and browser evidence; remaining epic CP1–CP7 untouched.
 Fill this frame before delegating implementation.

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
