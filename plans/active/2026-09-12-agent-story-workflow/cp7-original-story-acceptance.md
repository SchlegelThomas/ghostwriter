# CP7 — AC10 original-story browser acceptance

**Status (2026-09-14):** **parent browser walkthrough complete** — present to Thomas. Epic **not archived**; Playwright still gated.

**Branch:** `feat/agent-story-workflow` · PR [#26](https://github.com/SchlegelThomas/ghostwriter/pull/26) · commits through `15eb3cb`.

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
- [x] **AC5:** applied-scene check on **Rot** with source **The Brass Letter** showed **Fresh**, exact scope/heads, **one valid anchored contradiction**. Live hermetic **claim text on this process is generic** (`Hermetic continuity note for local validation.`) because `:8787` started **before** the content-sensitive helper; the helper is unit-tested for the AC10 brass-letter claim. Restarting the backend would wipe this project.
- [x] **Revision loop:** started revision assignment from finding **prefilled check handoff**; writer replaced generic brief with **exact issue**; generated revision; edited reviewed prose to **restore Mira authorship + root warning** and **preserve oil map**; **Replace working Draft** applied; Draft and Reader **Forecast** show reconciled Rot (`DO NOT FOLLOW THE ROOTS remained scored beneath her signature`).
- [x] **Finding after revision:** original check is **Needs recheck** (`scene-prose-changed`); findings stay inspectable; Dismiss / Complete review / Start revision stay **disabled** until a fresh check — expected CP3 freshness, not an incomplete apply.
- [x] **AC11/12:** Canvas Map reading-order spine shows **3 scenes**; open thread note persists title/body and **all three inclusion markers**; **Draft → Canvas** returns **Map**; **390×844** inspector and check review are reachable.
- [x] **Reader (wide 1600×1000):** chapter tabs isolate prose. **The Letter** header + Brass Letter only; **The Forecast** header + Rot only (reconciled); **Under the Engine** header + Map Beneath Harvest only (Mira fate open). **Spread 1 of 1** on each short chapter; **no** “This scene has no acknowledged prose yet” on the blank verso.
- [x] **AC10 cumulative:** wide Reader + Draft/Canvas agreement; narrow Mira-thread inspector and check review; no copy/paste glue or repaired IDs.

### Evidence files

- [01-narrow-mira-thread.png](evidence/cp7/01-narrow-mira-thread.png)
- [02-wide-reader-under-the-engine.png](evidence/cp7/02-wide-reader-under-the-engine.png)
- [03-narrow-check-needs-recheck.png](evidence/cp7/03-narrow-check-needs-recheck.png)

---

## Still outside this walkthrough

| Item | Notes |
|------|--------|
| Live-process specific claim | Unit-tested in `story-check-hermetic-candidates`; browser recheck needs a **new** hermetic process (wipes Clockwork Orchard). |
| Playwright | Gated on `GHOSTWRITER_PLAYWRIGHT_GATE=user-verified` after Thomas accepts the complete outcome. |
| Lakebase PR migrate | Databricks `provision` failed four times (`Cannot create Branch, please try again later`). Migrations `0029`/`0030` are in the PR; not applied on a PR Lakebase branch. |

---

## Local runtime

| Service | Detail |
|---------|--------|
| Backend | Hermetic process on **`:8787`** still holds Clockwork Orchard in **in-memory PGlite**. Restart wipes it. Process predates the content-sensitive hermetic helper. |
| Frontend | Static export **`http://localhost:8081`**. |
| Provider | **No live provider.** |

**Exact next:** Thomas reviews the walkthrough / PR. After explicit complete-outcome verification, run focused Playwright only. Do not archive the epic until that gate.
