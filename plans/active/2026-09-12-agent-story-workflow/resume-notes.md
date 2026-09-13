# Resume here — 2026-09-13

## Current frontier — read this first (September 13, CP7 in progress)

This section supersedes older chronological notes below.

- **CP1b–CP4:** character, scene, grounded checks and outline/structure loops implemented and browser-verified locally (see record log). CP4 baseline commit **`6cc0455`**.
- **CP5 — complete locally (uncommitted atop `6cc0455`):** [`cp5-coordination-contract.md`](cp5-coordination-contract.md), migration **`0029`**, record log CP5d. Not production-deployed.
- **CP6 — complete locally (uncommitted atop `6cc0455`):** [`cp6-mcp-parity-contract.md`](cp6-mcp-parity-contract.md) — 15 closed bridge tools, flag-gated **`/local-mcp/v1/*`**, migration **`0030`**, hermetic stdio walkthrough. Final **`pnpm verify`**: **1,914** tests / 3 skipped. Not production-deployed.
- **CP7 — in progress (AC10 original-story browser):** see [`cp7-original-story-acceptance.md`](cp7-original-story-acceptance.md). Cumulative **`pnpm verify`** passed: **1,922 tests / 3 skipped**, **230 files / 1 skipped**, typecheck/lint/17 routing green. **Epic not complete.**

### Clockwork Orchard walkthrough (browser, UI-only)

- New project **The Clockwork Orchard** / book **The Brass Harvest** — no API or manual IDs.
- Character **Elian Voss** — proposal edited (motive/wound/voice), applied; Explorer Story knowledge shows Elian.
- Structure **The Brass Season:** chapters *The Letter* / *The Forecast* / *Under the Engine*; scenes **The Brass Letter**, **Rot in the Gears**, **The Map Beneath Harvest**; Mira payoff intentionally open; Explorer **3 scenes**.
- Acknowledged prose in all three scenes via **Draft UI**.
- Deliberate contradiction in **Rot:** letter author **Elian**, **root warning omitted**; applied check on Rot + source **The Brass Letter** — Fresh, exact scope/heads, one anchored finding; **hermetic claim was generic** (gap until content-sensitive helper + recheck).
- Revision from finding handoff: exact brief, revision restored **Mira authorship + root warning**, kept oil map; **Replace working Draft**; check **stale** (expected).
- Canvas Map spine **3 scenes**; note **“Open thread · Where is Mira?”** in all three scopes — reload preserved title/body/inclusions; Draft→Canvas same Map; **390×844** inspector shows thread.
- **Reader defects found/fixed in UI:** short chapters shared spread 0; tab switch left **The Letter** header and concatenated chapters — **chapter-scoped pagination** fixed; rebuild on **:8081** verified **Forecast** shows **Rot only**. **Blank verso** “no acknowledged prose” — unit fixed; **browser recheck pending**. **Under the Engine** Reader pass **pending**.
- **Code repair (uncommitted):** hermetic finding helper now content-sensitive for authorship/root-warning (**exact substring anchor**); focused tests green — **restart backend or fresh process** needed before browser claim recheck (live **:8787** may still load old module).

### CP7 still open

1. Browser recheck **specific** continuity claim after backend reload.
2. Reader **blank verso** post-fix browser check.
3. Reader **Under the Engine** chapter tab/spreads.
4. Finding **resolution/complete** state if contract requires after revision apply.
5. Wide + narrow AC10 screenshots/coherence; present outcome to Thomas.
6. **No Playwright** until user-verified complete epic.

### Branch and runtime

- **Branch:** `feat/agent-story-workflow` — CP5+CP6+CP7 repairs **uncommitted atop `6cc0455`**; no push/PR/deploy unless authorized.
- **Backend:** bridge-capable hermetic **`:8787`** — **in-memory PGlite holds the walkthrough project**; **restart wipes browser data**.
- **Frontend:** static **`http://localhost:8081`** (latest Reader bundle).
- **Viewport at handoff:** **390×844** Canvas inspector. **No live provider.**

### Exact next

1. Browser: continuity check claim recheck (restart backend only if needed for new hermetic module — accept data loss).
2. Browser Reader: blank verso + **Under the Engine**.
3. Browser: wide/narrow AC10 closure; update [`cp7-original-story-acceptance.md`](cp7-original-story-acceptance.md) checkboxes and evidence paths.
4. Update record log and WHERE-I-LEFT-OFF; do **not** mark epic or CP7 done until Thomas accepts AC10.

---

## Earlier implementation notes (chronological; current frontier above wins)

## Authorization and status
User authorized the ENTIRE epic and continuing implementation; explicitly requests durable handoff for a cheaper model. Branch `feat/agent-story-workflow`. Last stable local commit `6cc0455` (CP4); CP5+CP6+CP7 work uncommitted. No push, PR, merge, deployment, live provider call, or Playwright authorization. Epic remains active; **CP7 acceptance in progress**.

Read `plan.html`, `record-log.html`, ADR0018 and the feature-delivery skill. Codex mapping: Luna medium narrow research, Sol medium implementation, Sol high dense contracts. Use one writer per shared domain. Parent owns real-browser acceptance.

*(Older CP0–CP4 chronological notes preserved below for archaeology; do not treat stale “next step” lines as current.)*

## Verified baseline
`edeb4f1`: Canvas scope/discovery, geometry/history/personal return, shared manual Canvas/Draft story context, character contract prerequisites. Full pnpm verify: 1257 tests passed, 155 files passed, 1 file/3 tests skipped; typecheck/lint and 17 routing checks green. Log `/tmp/ghostwriter-foundations-full-verify.log`. Full epic/responsive acceptance remains open.

## Current uncommitted checkpoint CP1b
Character brief -> generation -> exact review/edit/revision -> human Add to Cast implemented across core/storage/API/UI, NOT yet accepted in browser. Durable assignments retain original brief and source IDs, immutable attempts record instructions and source mode. Initial generation uses submitted-snapshot, explicit revision latest-authorized with SAME source IDs. Generated/current artifact pointers differ after manual edits. Apply checks consumed scene heads and structure hashes inside transaction and never trusts model authorization. No automatic provider retry.

Core generation/review services and memory/Postgres UOWs are new. Migration is currently `0027_premium_randall.sql` plus snapshot/journal. Latest repair adds assignment.latestAttemptId so failed revision details do not report the old proposal run. Two agents interrupted by credits before final validation; resumed on user continue. Their final results must be checked, not assumed.

Owners: scope_contract = latestAttemptId/core-storage migration/tests; canvas_discovery_ui = backend story-work routes/runtime/hermetic fixtures/tests; parent = UI/client and integration/docs. Agent handoffs requested in storage-handoff.md and backend-handoff.md. canvas_selection previously reviewed UI; no active write assignment.

UI entry: Agent -> Develop story. Files StoryWorkPanel.tsx, CharacterStoryWorkReview.tsx, use-story-work-workspace.tsx, story-work-attempt-input.ts, api.ts, App.tsx, AuthenticatedProjectWorkspace.tsx. Review keeps Draft/Canvas mounted hidden to preserve lease. Epoch/sequence guards fence late responses. Apply acknowledgement is distinct from project-refresh failure. Latest fixes reset source selection after submit and scope refresh error to assignment. Client typecheck green after those fixes. Parent focused tests: 15 passed in four files before latest UI-only fixes; `/tmp/ghostwriter-story-work-parent-tests.log`. Current full verify still required.

Latest resumed evidence: four focused client/review files passed all 15 tests on 2026-09-13; git diff --check green. Frontend rebuild command: `EXPO_PUBLIC_API_URL=http://localhost:8787 pnpm --filter client exec expo export --platform web --output-dir /tmp/ghostwriter-story-preview` (workspace name is client, not @ghostwriter/client). Build log /tmp/ghostwriter-story-preview-build.log.

## Exact next steps
*(Superseded — see current frontier: CP7 AC10 browser acceptance.)*

## Local runtime / browser caveats
Static frontend http://localhost:8081 served from /tmp/ghostwriter-story-preview by Python (old session17792). Backend old session26200 runs pre-CP1b code; logs /tmp/ghostwriter-story-backend.log. Docs http://127.0.0.1:8090. Recheck processes rather than trusting session IDs. Live Lakebase endpoint disabled; do not change infrastructure.
CUA after compaction first call cua.rewriteDocumentation(). Existing foundationTab tab6 browser1, Harry Potter shared-context Canvas; fresh inventory required. Viewport capability affected selected tab2, not tab6: do not claim responsive evidence unless screenshot dimensions match. No Playwright APIs. Previous screenshot/evidence and capacity results are in evidence/foundations, committed. All eight resize handles, reload, stale second-client refusal, archive/search/restore, scoped creation and same-scene context return were exercised. Pointer cancellation only code-tested.

## Handoff discipline
Update this file, WHERE-I-LEFT-OFF.html and record-log after meaningful progress or before stopping. Record actual command results, current files/owners and the first executable next step. Temporary logs may disappear; preserve material findings here. A credit failure is not successful completion.

## Latest acceptance progress (2026-09-13)
Backend frozen/green: backend-handoff.md, 52 focused tests plus final6 route tests, types/lint. Restarted isolated backend session14224 with fake key and LIVE_OPENAI=0; startup confirms hermetic fake, capacity seed and0027. Frontend ef64... export.
Full pnpm verify PASSED: 1305 tests,164 files;1file/3tests skipped, typecheck/lint/17routing green,126.50s. Log /tmp/ghostwriter-cp1b-resume-verify.log. This predates two browser-found UI fixes below; run their targeted checks after repair.
Browser tab6 created The Harbor of Unsent Letters / The Last Tide. Develop story, zero prose sources, brief for Mara Venn -> Draft ready -> Review -> revision request about missing sister retained verbatim -> edited Desire to “Find her missing sister without sacrificing the crew who now trusts her.” -> saved -> Add to Cast acknowledged projectv2 with exactly1knowledge record -> Open character dossier showed same desire. Fake output static; no quality claim. Reload just triggered; next inspect library/openproject/dossier to verify persistence.
Browser-found repairs underway: canvas_selection owns CharacterStoryWorkReview.tsx entry focus (sidebar retained focus); parent changed hook onRevise to open acknowledged new review rather than drop to title page. Must review/check/rebuild and browser retest. Parent hook change is after full verify. Preserve all work.
CP2 read-only inventory now in cp2-handoff.md. No CP2 product implementation yet. Continue full epic.

Reload persistence confirmed: original projectv2, one Mara Venn record, exact edited Desire persisted. Screenshot evidence/character/01-applied-dossier-reload.png saved and reopened at1600x1000. Rebuilt fixes; applied assignment reopened with original and revision instructions and heading focus (verified AX). Keyboard Back worked but focused page root; canvas_selection now sole writer of StoryWorkPanel.tsx and use-story-work-workspace.tsx for explicit-close focus restoration. Preserve parent onRevise auto-open change. UI/client navigation types/lint green. Next verify delegate back-focus repair, revision staying open, narrow/refusal before commit. No CP2 implementation started.

Second browser assignment (rival pilot) verified repaired revision stays in center review, retains exact new instruction, requires Load latest artifact before apply, dirty Back refusal, Discard restoring saved fields, Reject -> Rejected without canon change (projectv2,oneCastrecord). Parent updated revision/stale copy in CharacterStoryWorkReview.tsx afterward to avoid obsolete Return to Story work instruction and claiming local edits when clean. Pending latest export/check. Entry focus repair verified; back focus delegate still pending. No claims of live model response quality (fake alwaysMara).

Responsive finding: selecting tab6 through open_in_codex then viewport capability now successfully produces mobile AX at390x844. Phone has no Agent route; review Back returns titlepage with no task entry. canvas_discovery_ui (Sol/high) now owns ONLY AuthenticatedProjectWorkspace.tsx for narrow Agent route/center integration. canvas_selection back-focus repair done (UI/clienttypes/lintgreen); parent still needs rebuild/browser. Currenttab6 at390 override, titlepage; RESET viewport before stop. Screenshot output oddly scaled but AX confirms mobile mode; save screenshot metadata before claiming rendered dimensions.

Viewport reset after phone finding. scope_contract now starts ONLY CP2 pure schema/compiler prerequisite + registry/index/tests (Sol/high); no lifecycle/storage/apply/UI. Parent acceptance remains CP1b. Agent to leave cp2-domain-handoff.md. Full CP2 not implemented. Narrow Agent repair still sole-owned AuthenticatedProjectWorkspace by canvas_discovery_ui.

Parent added STORY_WORK_CAPABILITIES to capabilities.ts for assignment read, character generation/review/apply; MCP access truthfully pendingCP6, human apply exception explicit. Focused lint passed. checkpoint-notes.md now links current resume file to avoid stale initial frame confusion. Latest full verify1305 precedes these metadata/focus/narrow changes; repeat appropriate checks after sources stabilize.

Additional CP2 independently testable prerequisite assigned to canvas_selection Sol/medium: applyDocumentAsRevision port in scene-document-repository, scene-documents reason, memory/Postgres implementations and tests only. Exact working version and lease, immutable agent-apply revision, one head increment. No public API or assignment application yet. Agent must report migration need before edits; index/schema/lifecycle remain outside ownership. Expect cp2-revision-port-handoff.md. Shared scope/compiler agent owns separate files; parent narrow acceptance continues.

Latest browser: rebuilt narrow repair. At390x844 Agent entry opens tasks; applied assignment opens heading-focused review; Tab/Return on Back restores focus to exact assignment row; Draft exits task route. Saved/reopened02-phone-task-return.png reveals panel only276px of390px, so canvas_discovery_ui fixing inner panel width (WorkspaceSecondaryPanel allowed). At768x1024 reopened applied review with Agent sidebar retained, readable layout;03-tablet-review.png saved/reopened. Viewport RESET. Currenttab6 applied review on normalwide viewport. Existing metadata unchangedv2. Wait width fix -> rebuild -> phone screenshot/recheck -> final focused checks. CP2 agents stillown puredomain/revisionport independently.

Phone width repair VERIFIED:04-phone-full-width.png saved/reopened,390x844 full-width form with readable brief/constraints/done condition and Agent route. Viewport reset. CP1b browser successes: original empty project generate/revise/edit/apply/open/reload; second proposal dirty refusal/discard/reject; persisted assignment reopening; heading/back focus; phone/tablet paths. Remaining overallAC2 includes same character in scene context, to verify with CP2. No full epic acceptance. Do NOT rerun fullverify during CP2 writers. Wait their stable handoffs, then targeted integration and whole verify/checkpoint commit.
canvas_discovery_ui now owns extraction of generic generation repository mechanics (new story-work-generation-repository-uow plus existing character wrapper/tests only); preserves character behavior. Expect cp2-generation-handoff.md. scope_contract owns schema/compiler/index; canvas_selection owns scene revisionport memory/Postgres. All three CP2 prerequisites independent; no scene UI/backend yet. Most urgent parent next: synthesize these returns, review contracts, full verify stable, commit current coherent foundation/character checkpoint with explicit CP2 prerequisite scope, then wire CP2 lifecycle/apply/API/UI in serialized slices.

CP2 revision repository prerequisite COMPLETE (cp2-revision-port-handoff.md):22coretests+8PGlite tests, core/storagetypes/lint. Agent now owns new scene review core/memory/Postgres wrappers/tests ONLY, mirroring exact character review and source authorization. Noindex/schema edits. Expect cp2-scene-review-handoff.md. Generation extraction and scene compiler stillactive. Parent read scene schema:24kcharprose,max32sourceIDs, no modelchosenIDs. Need fullUOW apply tocombine scene mutation+proposal+assignment atomically; no publicsceneaction yet.

Shared generation extraction code stable; character core/Postgres regression and coretypes/lint green. Added genericmodule coreexport. Full pnpm verify running session43641, log /tmp/ghostwriter-character-checkpoint-verify.log. Scene review test ContextReceipt annotation repaired while starting; final result must be read. Plan/handoff/log local href targets checked (3HTMLfiles,no missinglocaltargets). Parent ADR adds scene literal-prose/server-block-ID and lease-aware agent-apply prerequisite semantics. scope_contract read-only applycontract design; no newcode duringcheckpoint verification.

FINAL CHECKPOINT VERIFY PASSED1333tests/170files,1file/3tests skipped,types/lint/17routinggreen,118.92s. No product changes after this verification. Parent adding final notes/commit only. Model handoff entrypoints: WHERE-I-LEFT-OFF.html -> resume-notes.md currentfrontier -> cp2-apply-contract.md + cp2-handoff.md. Full epic remains incomplete.

Postcheckpoint parent client edits: added history reason types/labels for agent-apply, named-variant, capture-promotion (previous client reason union omitted latter two). Not yet rechecked; include next clienttypecheck/lint. Parent inspected DraftPanelHandle: currently onlyflushAndRelease. Scene update apply must NOT use this (lease required); later add prepare/finish boundary using flushLatestForBoundary, queue.pause/installAcknowledgement/resume, retain lease, refresh actual head/history without remount. Backend derives leaseHolderId from authenticated session, neverclientinput. Current source code has no prepare/finish implementation yet. Newapplycontract includes key/fingerprint columns0028; no materialproductchoice outsideaccepted idempotency.


## Latest parent preparation
Client scene submission/attempt/review helpers are present but not exposed from StoryWorkPanel. Character submission now includes explicit taskKind for the stricter backend contract. Five client transport tests and client typecheck passed. Draft prepare/finish remain unbound: review found unresolved recovery could be discarded and in-flight recovery capture could race refresh. Parent added recovery-offer refusal and recovery.flush before refresh installation; remaining review is pending. Do not claim these methods are browser accepted. Full verify at50aa1cf predates this work.

Draft review follow-up: remove finish(refresh:boolean); finishStoryWorkApply() must always reload workspace/history after any dispatched apply, including conflicts and uncertain responses. Prepare handles failures before dispatch. Clear prior comparison/restore confirmation on success; preserve recovery on dirty/refresh failure. canvas_selection owns implementation/tests now. Parent must bind this contract once scene apply is ready.

Parent added story-work-scene-placement.ts with two passing tests: active-book chapter/unassigned choices, archived-book exclusion, duplicate chapter titles retain distinct IDs, no inferred Canvas/manuscript ordering. It is ready for the scene review host but not yet wired. See /tmp/ghostwriter-scene-placement-tests.log. Client typecheck after this helper passed (/tmp/ghostwriter-scene-placement-types.log).
