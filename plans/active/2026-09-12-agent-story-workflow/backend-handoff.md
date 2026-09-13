# CP1b backend transport handoff

The backend implementation is frozen and safe for the parent to restart against the final disposable migration `0027_premium_randall.sql`. No paid or live provider call was made.

## Outcome

- Added owner-scoped character story-work transport:
  - `POST /api/projects/:projectId/story-work/assignments`
  - `GET /api/projects/:projectId/story-work/assignments`
  - `GET /api/projects/:projectId/story-work/assignments/:assignmentId`
  - `POST /api/projects/:projectId/story-work/assignments/:assignmentId/attempts`
  - `POST /api/projects/:projectId/story-work/assignments/:assignmentId/review/open`
  - `PATCH /api/projects/:projectId/story-work/assignments/:assignmentId/review`
  - `POST /api/projects/:projectId/story-work/assignments/:assignmentId/review/reject`
  - `POST /api/projects/:projectId/story-work/assignments/:assignmentId/apply`
- Assignment submission preserves the exact writer brief, constraints, and completion condition; accepts the fixed optional `taskKind: "character"`; bounds scene selection to 0–32 unique active scenes; reserves the destination `StoryKnowledgeId` on the server; fixes the selected provider/model; and creates no canonical Cast record until apply.
- A zero-scene assignment stores project structure as its source and can generate a complete character proposal from the brief and canonical project context.
- Selected scenes must have a canonical document head. Submission stores each selected scene's exact `workingVersion` and `contentHash` in immutable assignment sources. A selected scene without a head receives a clear validation refusal rather than silently omitting its prose.
- Assignment idempotency is checked through the scoped indexed repository lookup before project-version and source validation. An exact lost-response retry returns the original assignment even if unrelated project metadata advanced; reuse of the key for different submitted fields returns a conflict.
- Attempts require the explicit source mode pair `initial/submitted-snapshot` or `revision/latest-authorized`. Initial compilation enforces the submitted project and scene revisions. Explicit revision refreshes retain the same authorized source IDs/scope while assembling a new exact receipt from current revisions.
- Attempt fingerprint replay occurs before context assembly, credential resolution, or provider access. An exact retry returns the durable run/attempt/receipt/proposal state and never retries a timed-out or otherwise terminal provider call.
- Detail resolves `assignment.latestAttemptId` first and returns that attempt's run and receipt, including failed revisions with no new proposal. The current reviewed proposal remains available separately, so after a failed revision the proposal can intentionally belong to the prior successful run.
- Review opening, full character field editing, rejection, and exact apply use the shared transactional core/storage units of work. Edited proposals preserve generated lineage, and apply commits the reviewed proposal to the reserved Cast record under assignment, proposal, receipt-freshness, and project CAS checks.
- Provider diagnostics that the generation service understands are persisted as normal terminal workflow results. Known domain/precondition errors return bounded 404/409/422 responses. Unexpected story-work infrastructure failures return a generic 503 without disclosing records, credentials, provider text, or internal error messages.
- The provider runtime now exposes the character structured-completion contract and constructs the PostgreSQL assignment repository plus generation, review, and apply units of work. Provider network execution remains outside every transaction.
- The hermetic backend recognizes `character_create_v2`, returns a deterministic schema-valid fake dossier, and injects a local deterministic `gpt-4.1` model-list provider. Hermetic discovery and generation therefore make no remote request. Focused tests assert that the actual exact brief and selected prose reach the fake provider.

## Files

- `apps/backend/src/story-work-api-contract.ts` — bounded Zod request contracts and exported request types.
- `apps/backend/src/story-work-api.ts` — owner-scoped routes, source assembly, idempotent replay, detail projection, review, and apply bindings.
- `apps/backend/src/story-work-api.test.ts` — contract and migration-backed route coverage.
- `apps/backend/src/agent-provider-runtime.ts` — shared provider type and PostgreSQL story-work runtime construction.
- `apps/backend/src/app.ts` — route registration.
- `apps/backend/src/e2e-server.ts` — hermetic character completion and deterministic model discovery.
- `plans/active/2026-09-12-agent-story-workflow/backend-handoff.md` — this handoff.

## Verification

- `pnpm --filter @ghostwriter/backend typecheck` — passed.
- `pnpm exec vitest run apps/backend/src/story-work-api.test.ts apps/backend/src/provider-agent-routes.test.ts packages/core/src/character-story-work-generation-services.test.ts packages/core/src/character-story-work-review.test.ts packages/core/src/memory-character-story-work-uow.test.ts packages/storage/src/postgres-story-work-repository.test.ts packages/storage/src/postgres-character-story-work-generation-uow.test.ts packages/storage/src/postgres-character-story-work-uow.test.ts --maxWorkers=2` — 8 files passed, 52 tests passed.
- `pnpm exec vitest run apps/backend/src/story-work-api.test.ts --maxWorkers=1` after the final request-abort binding — 1 file passed, 6 tests passed.
- `pnpm exec eslint apps/backend/src/story-work-api.ts apps/backend/src/story-work-api-contract.ts apps/backend/src/story-work-api.test.ts apps/backend/src/agent-provider-runtime.ts apps/backend/src/app.ts apps/backend/src/e2e-server.ts` — passed.
- `git diff --check -- apps/backend/src` — passed.

The route coverage includes exact text preservation, 0- and 33-scene bounds, assignment replay after project-version drift, foreign-account non-disclosure, exact selected scene head capture, exact brief/prose provider input, replay after deleting the provider credential, current artifact review editing, atomic Cast apply, zero-scene initial generation, and latest failed-revision detail.

## Remaining integration and acceptance

- Restart the disposable hermetic backend from an empty database so it applies `0027_premium_randall.sql`. Discard any disposable database that applied an earlier uncommitted 0027 filename.
- Browser acceptance remains with the parent. The deterministic hermetic dossier is intentionally fixed rather than creatively derived from the brief; transport tests verify the exact writer brief and selected prose sent to it.
- The UI should treat detail `attempt/run/receipt` as the latest attempt and `proposal` as the current review artifact. Those records can reference different runs after a failed revision.
- Selected scenes that have never initialized a document head cannot be submitted as prose context. Opening the scene workspace initializes its canonical genesis head; empty-source project assignments remain available without that step.
- The parent is running whole-repository verification. This slice did not run Playwright, a browser, a live provider, a backend restart, a remote migration, a commit, push, or deployment.
