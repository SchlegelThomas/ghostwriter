# CP6 scoped story-work MCP parity contract

## Checkpoint outcome

**Status (2026-09-13):** **CP6 complete locally** (CP6a–d). Scoped read/status and propose-only
story-work MCP parity ships under extended project grants, a flag-gated local/test HTTP bridge, and
stdio grant mode with a closed **15-tool** enum. Human review/apply/reject, recovery manage/cancel,
credentials, grant admin, and canonical project/scene/Canvas commands remain **first-party only**.

**Baseline:** CP5 complete locally; epic baseline commit **`6cc0455`**. CP5+CP6 work remains
**uncommitted** atop that commit (no push/PR/deploy). Migrations **`0029_material_rachel_grey.sql`**
(CP5 coordination) and **`0030_curly_korg.sql`** (CP6 grants + story-work origin) are checked in;
**neither is production-deployed**.

**Epic AC7 (authority and MCP):** satisfied for local/test scoped grants and stdio bridge walkthroughs.
**CP7** AC10 original-story browser acceptance is **next**. Playwright remains gated on explicit
user verification of the complete epic outcome.

**Explicit future / non-goals (not CP6 blockers):** production remote MCP OAuth/service deployment;
durable last-used grant audit table; owner-facing grant mint UI for new allowlists; project-wide
navigator for external clients; revision/update scene MCP tools; external review/apply/recovery manage.

## External authority ceiling (accepted)

| Surface | External MCP (scoped grant) | First-party only (permanent) |
|---|---|---|
| Story-work assignment list/detail, recovery **read** projections | Allowed when grant + tool allowlist + resource rules pass | — |
| Typed submit: character, scene (new-scene only), check, structure | Allowed (creates assignment + one foreground attempt) | — |
| Structure preview (no writes) | Allowed | — |
| Coordination list/detail, create, continue bind | Allowed (no auto-start of child attempts; **continue** requires same grant origin as coordination) | — |
| Grant discover (`ghostwriter_get_grant`) | Allowed | — |
| Capture reflection (3 tools) | Allowed on Capture/story-only/mixed grants (backward compatible) | — |
| Review open/edit/reject, apply, check finding resolve/complete | — | Yes |
| Recovery cancel / mark interrupted | — | Yes |
| Coordination cancel (domain exists; no external route in v1) | — | Yes |
| Provider credentials, BYOK admin | — | Yes |
| Grant mint/revoke/widen | — | Yes |
| Canonical manuscript/Canvas/project-structure commands | — | Yes |
| Project enumeration / credentials / grant admin tools | — | Yes |

Prompt text, playbooks, and assignment briefs **never widen** tools, resources, egress, or apply
authority.

## Grant resource allowlists (CP6a — complete)

Extend **project-scoped** grants (ADR 0011) with explicit resource selectors alongside existing
`captureIds` and closed-enum `tools`. **No project listing** for external clients.

**Mint-time fields (owner session API):**

| Field | Semantics |
|---|---|
| `sceneIds` | Scene prose/context may be compiled only for these IDs (revision-addressed receipts). |
| `bookIds` | Structure/outline targets must be one of these active books. |
| `assignmentIds` | Existing assignments readable and eligible as proposal/check sources when allowlisted. |
| `coordinationIds` | Existing coordinations readable when allowlisted. |
| `allowProjectStructureRead` | When true, story-work compiler may include bounded project structure metadata (manuscript tree, chapter objectives, scene sketch/intent fields) without scene prose unless `sceneIds` also allow those scenes. When false, structure metadata is omitted from compiler input even if IDs are known. |

**Backward compatibility:** Capture-only grants (`captureIds` + Capture reflection tools) behave as
before. **Story-only** and **mixed** Capture+story-work grants validate tool/resource pairing at
mint time.

**Provenance (migration `0030_curly_korg.sql`):**

- Assignments and coordinations **created through MCP** persist durable origin
  `{ kind: "mcp", grantId }` as nullable **`origin_kind`** + **`origin_mcp_grant_id`** (FK to
  `mcp_grants`, indexed per grant+project). UI/first-party rows remain null origin.
- A token may read resources **explicitly allowlisted** **or** rows **created under its grant**
  (foreign-origin rows are allowlist-read-only, not grant-origin mutable).
- List/get endpoints filter to **allowlisted IDs ∪ grant-origin IDs** via indexed repository methods
  (no project-wide scan).
- Child assignments materialized under a grant-origin coordination **inherit** the same grant
  origin for read/submit authorization.
- Runs remain attributable through attempt → assignment; MCP does not introduce a second actor
  authority beyond the grant + tool check.

**Owner mint API:** `POST /api/projects/{projectId}/mcp-grants` accepts the extended allowlists and
closed `tools` enum; returns `{ grant, token }` with plaintext token **once**; storage keeps
SHA-256 hash only. Expiry, revoke, wrong project, wrong tool, and out-of-allowlist resources use
**nondisclosing** `404 NOT_FOUND` (same posture as Capture grants).

**Audit:** origin columns on assignment/coordination rows; **last-used event table deferred**.

## Context compiler gates (story-work)

The server-assembled story-work compiler applies **additional** grant checks before provider egress:

1. **Structure metadata** — only if `allowProjectStructureRead`.
2. **Scene prose** — only for allowlisted `sceneIds` (and receipt-backed revisions).
3. **Structure submit** — target `bookId` must be allowlisted.
4. **Check/scene sources** — proposal source assignment must be allowlisted or grant-origin.
5. **Coordination reads** — coordination ID allowlisted or grant-origin.
6. **Coordination continue** — coordination must carry the **same** MCP grant origin as the token
   (allowlisted foreign coordinations are read-only).

Violation fails closed with nondisclosing grant failures. Instruction layers still cannot override
these gates (ADR 0011).

## Closed MCP tool enum (15 tools — complete)

Grant `tools` must be a subset of the closed enum; unknown names refuse at mint time. A **full
bridge grant** registers exactly these **15** names (1 discover + 3 Capture + 11 story-work):

| Tool | Access | Maps to capability intent | Behavior |
|---|---|---|---|
| `ghostwriter_get_grant` | read | `mcp.grant.discover` | Active grant metadata and allowlists (no token, no secrets). |
| `ghostwriter_read_capture` | read | Capture grant read | Plain summary for one allowlisted capture. |
| `ghostwriter_assemble_capture_reflection_context` | read | Capture receipt | Server-assembled reflection receipt. |
| `ghostwriter_propose_capture_reflection` | propose | Capture reflection | Preview+start proposal via trusted receipt provider factory (**independent** of assemble tool). |
| `ghostwriter_list_story_work` | read | `story-work.assignment.read` (+ filtered coordinations) | List assignments/coordinations visible under grant filter rules only. |
| `ghostwriter_get_story_work` | read | assignment read + optional recovery read projection + check freshness read | Single assignment detail; recovery **manage** actions stripped from bridge DTO. |
| `ghostwriter_submit_character_work` | propose | `story-work.character.propose` | Create assignment + **one** foreground attempt; typed brief fields only. |
| `ghostwriter_submit_scene_work` | propose | `story-work.scene.propose` | **New-scene** assignment + one attempt (no external revise/update path). |
| `ghostwriter_submit_check_work` | propose | `story-work.check.propose` | Create check assignment + one attempt; sources must pass compiler gates. |
| `ghostwriter_submit_structure_work` | propose | `story-work.structure.propose` | Create outline assignment + one attempt; book allowlisted. |
| `ghostwriter_preview_story_structure` | read | `story-work.structure.preview` | Dependency-complete preview; no provider rerun; no writes. |
| `ghostwriter_list_story_work_coordinations` | read | `story-work.coordination.read` | Filtered list. |
| `ghostwriter_get_story_work_coordination` | read | `story-work.coordination.read` | Detail + projected child status. |
| `ghostwriter_create_story_work_coordination` | propose | `story-work.coordination.manage` (create half) | Zero-provider create; records grant origin. |
| `ghostwriter_continue_story_work_coordination` | propose | `story-work.coordination.manage` (continue bind) | Bind deferred step on **same-origin** coordination; **does not** auto-start child attempts. |

**Not in enum (first-party):** all review/apply/reject routes, recovery `POST …/recover`, grant
admin, credentials, navigator/fixture reads, generic arbitrary task payloads, canonical mutation
tools.

**Submit tools:** each creates **one** assignment and starts **one** foreground attempt via the same
core paths as UI Submit.

## Local/test stdio transport and bridge (CP6b–d — complete)

**Not production remote OAuth/MCP.** Stdio parity uses a **local/test-only backend bridge**:

| Env | Role |
|---|---|
| `GHOSTWRITER_MCP_API_URL` | Base URL for bridge HTTP (e.g. hermetic backend). |
| `GHOSTWRITER_MCP_GRANT_TOKEN` | Plaintext grant token for bridge auth (never logged). |
| `GHOSTWRITER_ENABLE_LOCAL_MCP_BRIDGE=1` | Backend registers Bearer-authenticated `/local-mcp/v1/*` routes; **default off**. |

Bridge routes sit **outside** the session cookie API. Invalid/malformed assignment/coordination/capture
IDs return **404**; cross-project and cross-account access is refused nondisclosing. Bridge read DTOs
**strip recovery manage** action hints.

Thin MCP server in `apps/mcp` maps the closed tool enum to bridge calls. In-process grant runtime
may remain for unit tests.

**Stdio modes (mutually exclusive, fail clearly):**

| Mode | Required env | Registered tools |
|---|---|---|
| **Grant bridge** | `GHOSTWRITER_MCP_API_URL` **and** `GHOSTWRITER_MCP_GRANT_TOKEN` (both) | Closed 15-tool grant set only — **no** live navigator |
| **Fixture navigator** | `GHOSTWRITER_MCP_FIXTURE=1` only | `ghostwriter_project_navigator` (explicit fixture-only exception on live project navigator capability) |
| **Invalid** | half bridge env, both bridge+fixture, or neither | Process exits with explicit stderr message — **no silent live data** |

## Grant failure posture

Invalid, revoked, expired, wrong-project, disallowed tool, or out-of-allowlist resource requests
**fail closed** with **nondisclosing** errors (`404 NOT_FOUND` class). Tests cover expiry, wrong
project, wrong tool, resource not allowlisted, cross-grant enumeration, malformed IDs, and bridge
recovery-action stripping.

Token storage: **hash only** in database; plaintext shown **once** at mint.

## Capability registry (CP6d — complete)

Concrete `mcp` tool bindings replace CP6 exception strings for story-work read/propose surfaces;
permanent exceptions remain on review, apply, recovery manage, check review, human apply, grant
manage, credentials, canonical mutation, and fixture navigator (except explicit fixture-only
registration).

## Implementation slices

| Slice | Scope | Migration | Status |
|---|---|---|---|
| **CP6a** | Grant resource columns; assignment/coordination origin; mint/list filter rules; authorization matrix tests; owner grant API fields | `0030_curly_korg.sql` | **Complete locally** |
| **CP6b** | Local bridge routes (flag-gated); read/status tools; grant discover; list/get story-work + coordinations; Capture bridge restored | — | **Complete locally** |
| **CP6c** | Submit tools (character/scene/check/structure) + structure preview; compiler grant gates; provenance on create; coordination create/continue | — | **Complete locally** |
| **CP6d** | Hermetic stdio walkthrough; capability registry bindings; PRODUCT/API/ARCHITECTURE/OPERATIONS/ADR coherence | — | **Complete locally** |

## Verification (CP6 boundary — recorded)

- Focused CP6 suite before final capture/index fixes: **19 files / 176 tests**.
- Later targeted counts (non-exhaustive): **29** MCP package, **26** bridge, **59** origin-list
  repository tests; plus grant/auth/compiler matrices across core/backend.
- **Security coherence:** bridge assignment detail strips recovery manage actions; high-value origin
  listing uses indexed repo methods; malformed IDs nondisclosing; Capture propose tool regression
  fixed; navigator registry truth aligned with stdio modes.
- **Hermetic stdio walkthrough (bridge-enabled fresh backend):** owner minted **mixed** grant via
  HTTP; child stdio process listed **15** tools; exercised Capture read + ready reflection proposal,
  ready character proposal, origin-filtered assignment read, and confirmed forbidden tools/token
  absent. Earlier story coordination walkthrough validated origin rules and blocked manage surfaces.
  No live provider (hermetic fake).
- **Final `pnpm verify`:** typecheck, lint, **17** routing checks, **229** files pass / 1 skipped,
  **1,914** tests pass / 3 skipped. Post-verify registry repair: **12** index tests + core
  type/lint green.

**No Playwright** at CP6 boundary.

## Resolved decisions (implementation)

1. **Bridge HTTP:** Bearer token on `/local-mcp/v1/*` prefix; DTOs mirror strict backend contracts.
2. **Origin storage:** nullable `origin_kind` + `origin_mcp_grant_id` FK with grant+project indexes
   (see `0030_curly_korg.sql`).
3. **Check freshness:** exposed via `ghostwriter_get_story_work` projection only (no standalone tool).
4. **Coordination create under MCP:** v1 HTTP parity — one scene root + one check in strict body.
5. **Recovery read without recovery manage:** bridge DTO omits manage action hints.
6. **Grant mint UI:** API-only for CP6; hermetic walkthrough uses owner HTTP mint.
7. **Combined grants:** single row may union Capture and story-work tools/columns; mint validation
   rejects incompatible pairings.

## Baseline and next command

- **CP6:** **complete locally** — docs/plans finalized; code uncommitted atop `6cc0455`.
- **Next checkpoint:** **CP7** — AC10 original-story walkthrough in real browser (wide + narrow),
  cumulative coherence, `pnpm verify`, handoff; Playwright only after explicit user verification.

Plan: [plan.html](plan.html) · Prior: [cp5-coordination-contract.md](cp5-coordination-contract.md)
