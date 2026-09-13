# CP7 — AC10 original-story browser acceptance

**Status (2026-09-13):** **in progress** — substantial browser walkthrough recorded; epic **not** complete.

**Branch:** `feat/agent-story-workflow` · baseline commit **`6cc0455`** · CP5+CP6+CP7 repairs **uncommitted** atop it.

**Plan:** [plan.html](plan.html) · **Log:** [record-log.html](record-log.html) · **Handoff:** [resume-notes.md](resume-notes.md)

---

## Story under test (UI-only setup)

| Item | Value |
|------|--------|
| Project | **The Clockwork Orchard** (created through UI; no API setup or manual IDs) |
| Book | **The Brass Harvest** |
| Character | **Elian Voss** — proposal generated, fixture output edited (motive/wound/voice), saved, applied; Explorer Story knowledge shows Elian |
| Chapters | **The Brass Season:** *The Letter* / *The Forecast* / *Under the Engine* (objectives edited in review) |
| Scenes | **The Brass Letter** · **Rot in the Gears** · **The Map Beneath Harvest** — planned objectives; payoff intent leaves **Mira’s fate open**; structure previewed and applied; Explorer shows **3 scenes** |
| Open thread | Writer note **“Open thread · Where is Mira?”** with explicit body, included in **all three** scene scopes |

---

## Recorded browser evidence (success paths)

- [x] **AC2 (in walkthrough):** character develop → edit → apply → visible in Explorer knowledge.
- [x] **AC3 (in walkthrough):** three-chapter structure with scene placeholders applied; Explorer scene count matches.
- [x] **AC4 (in walkthrough):** acknowledged prose drafted in **all three scenes** via real Draft UI (not paste/API).
- [x] **Deliberate continuity issue:** in **Rot in the Gears**, prose changed letter **author to Elian** and **omitted the root warning** (contradicts setup in **The Brass Letter**).
- [x] **AC5 (partial):** applied-scene check on **Rot** with source **The Brass Letter** showed **Fresh**, exact scope/heads, **one valid anchored contradiction** — but hermetic provider **claim text was generic** (acceptance gap until content-sensitive fixture + browser recheck).
- [x] **Revision loop (partial):** started revision assignment from finding **prefilled check handoff**; writer replaced generic brief with **exact issue**; generated revision; edited reviewed prose to **restore Mira authorship + root warning** and **preserve oil map**; **Replace working Draft** applied; Draft visibly updated; source continuity check **stale by revision semantics** (expected if observed).
- [x] **AC11/12 (partial):** Canvas Map reading-order spine shows **3 scenes**; open thread note with reload persistence of title/body and **all three inclusion markers**; **Draft → Canvas** returns same Map scope; **390×844** inspector reachable with thread title and inclusions.
- [x] **Reader repair (code + partial browser):** defect — short chapters shared **spread 0**; chapter tab changed but **header/content stayed on The Letter** and **concatenated chapters**. **UI chapter-scoped pagination** fixed; static rebuild on **:8081** verified **Forecast** tab shows **only Rot** reconciled prose (not concatenated).

---

## Open / pending (blocks CP7 closure)

| # | Item | Notes |
|---|------|--------|
| 1 | **Content-sensitive check claim** | Hermetic finding helper repaired for authorship/root-warning **exact substring anchor**; focused automated tests green — **fresh backend restart required** (current PGlite process may still load old module) then **browser recheck** that finding claim matches deliberate contradiction. |
| 2 | **Reader blank verso** | False “no acknowledged prose” on undefined **right page** — **unit verified**; **post-fix browser recheck still pending**. |
| 3 | **Reader Under the Engine** | Confirm third chapter tab/pagination after fixes (not yet recorded this session). |
| 4 | **Finding resolution / review complete** | If CP3 contract requires explicit dismiss/complete after revision, verify resolution state on the original check (may already be stale-only). |
| 5 | **AC10 cumulative coherence** | Wide **1600×1000** + narrow **390×844** refusal/reachability pass; saved screenshot set for Clockwork Orchard journey; present full outcome to Thomas. |
| 6 | **`pnpm verify`** | **Complete:** typecheck, lint, 17 routing checks, **230 files passed / 1 skipped**, **1,922 tests passed / 3 skipped**. |
| 7 | **Playwright** | **Not run** — gated on `GHOSTWRITER_PLAYWRIGHT_GATE=user-verified` after complete epic user verification. |

---

## Local runtime (do not restart casually)

| Service | Detail |
|---------|--------|
| Backend | Hermetic **bridge-enabled** process on **`:8787`** — **original project lives in in-memory PGlite**; **restarting loses browser-visible data**. |
| Frontend | Static export **`http://localhost:8081`** — **latest Reader bundle** after pagination fix. |
| Provider | **No live provider**; fake/hermetic only unless explicitly authorized. |
| Viewport at handoff | **390×844** — Canvas inspector / thread inclusions. |

Env reference: `GHOSTWRITER_ENABLE_LOCAL_MCP_BRIDGE=1` for CP6 bridge (not required for CP7 browser path); `GHOSTWRITER_E2E=1` hermetic candidates.

---

## Exact next (resume here)

1. **If check claim recheck needs new hermetic module:** restart backend **only after** noting data loss — or re-run only the check step if project state still acceptable.
2. **Browser:** re-run applied continuity check on **Rot** → confirm **specific** authorship/root-warning claim and anchor; complete revision/check resolution if still open.
3. **Browser Reader:** recheck **blank verso** on short chapters; open **Under the Engine** tab — header, spread, and prose isolation.
4. **Browser:** wide + narrow AC10 pass (Map scope return, thread, Draft/Canvas/Reader agreement); capture screenshots under `evidence/` if saved.
5. Update plan, this file, resume notes, and WHERE-I-LEFT-OFF; **do not** mark epic done, commit, push, PR, or Playwright until Thomas verifies complete outcome.
