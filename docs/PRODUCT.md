# Ghostwriter — Product

## What it is

Ghostwriter is the complete creative workspace for writing ambitious novels and multi-book
story arcs. It joins a rich manuscript editor, spatial Story Canvas, notes, story knowledge,
version history, editorial collaboration, and project-aware AI assistants in one live project.

It is not an AI book generator or a chat window beside a document. Authors and editors remain
the decision-makers; agents help them explore, compare, draft, inspect, and revise.

## Initial beachhead — accepted 2026-07-11

Novelists and aspiring novelists creating full books, series, and large interconnected story
worlds. Ghostwriter must work for both:

- an experienced novelist who wants direct, keyboard-first control and deep project memory;
- an idea-rich aspiring novelist who benefits from optional craft guidance and a clear next
  step without having the story written for them.

The underlying artifacts are the same. Guided, Balanced, and Minimal assistance change the
amount of coaching, not the writer's capabilities.

## Core product promise

Bring Ghostwriter an idea, an existing draft, or a blank page. Develop the world visually,
write the book in a focused editor, keep characters and continuity coherent across books,
work with editors and assistants, explore alternate versions safely, and always understand
what changed, why, and who changed it.

## Where it runs

The real-time web platform is the primary product and should be useful anywhere a browser is
convenient. Desktop and mobile shells may add platform conveniences, but they share the same
project and do not become separate products.

| Surface | Role |
|---|---|
| Responsive web | Primary live writing, Story Canvas, review, and collaboration environment |
| Desktop shell | Optional long-session, filesystem, credential, and future offline conveniences |
| Mobile | Responsive capture, reading, review, and focused editing |
| MCP server | Lets explicitly authorized external agents work through the same core capabilities |

V1 projects are online-only and server-authoritative. The browser keeps minimal recovery for
unacknowledged work, not a complete offline project. Cross-device access, presence, comments,
tracked suggestions, and version review update in real time. Only one collaborator directly edits
a scene body at a time; same-scene multi-cursor editing is deferred. See ADR 0002.

All product and onboarding surfaces require an authenticated account in the first shared-project
release. Google is the initial sign-in method; first login creates a provider-neutral Ghostwriter
writer profile. There is no public fixture workspace or locally saved pre-auth project. A future
temporary Spark-before-sign-in flow requires its own accepted product plan and cannot imply a
canonical local or offline project. The signed-out gate still shows only Google; an unmarked
founder demo entry (double-click hit target) may sign into a fixed demo account that owns a Harry
Potter sample project — see ADR 0005.

## Core experience

- A project may contain one book or a multi-book series with shared characters, world rules,
  timeline, relationships, and long-running arcs.
- The Story Canvas and manuscript are two views of the same scenes and story objects.
  Writers may storyboard first, write first, or move between both.
- Notes, research, canvas links, and confirmed story knowledge remain connected to the passages
  and revisions that support them.
- Git-inspired history is presented in writer language: autosave, checkpoints, alternate
  versions, compare, restore, review requests, attribution, and named editions—not Git commands.
- Authors can invite editors to comment, suggest tracked changes, compare variants, and review
  specific versions without surrendering project ownership. Editors may work elsewhere in the
  project concurrently, but v1 hands direct scene-body editing between collaborators explicitly.
- Built-in and external agents act as assistants. They may draft ideas, suggest edits, or offer
  multiple prose variants, but their output stays provisional until an author or authorized
  editor chooses what to apply.

## Current writing milestone — Write Experience 4.0 (2026-07-19)

On `feat/writing-experience-ux-4`, writers also get:

- Writing Studio chrome on Draft: Page / Sheet / Place composition (Map/Split is left-rail only), Focus, Assist, keyboard / dictate / ink;
- Scene Sketch craft fields (and craft-only ink paths) plus character sheet desire/pressure/voice on story knowledge;
- Sheet and Place as side companions beside Draft (with one-tap cast link/unlink on Sheet);
- Browser dictation into the live Tiptap caret;
- Deterministic writing-assist proposals (Scene Partner, Character Coach, Worldkeeper, Sketch Partner) that require explicit Apply;
- Dense shell: Story Trail role annotations, ＋ Add on the Write toolbar, History on the left rail (no floating acknowledgement toasts);
- Writer profile publishing details (pen name, legal/contact, mailing address, bio, representation) edited from a pencil modal on the project library;
- Sign-in gate led by the brand lockup with short “Bring your ideas to life” copy.

Agents still never silent-write canon. Multi-provider BYOK (OpenAI, Anthropic, Google, Groq, xAI,
Mistral, DeepSeek, optional OpenRouter) powers Agent dock chat and toolkit jobs when configured;
Settings lists keys per provider and the dock shows only available real model ids; deterministic-local
proposals remain available without a key.

## Current writing milestone — Capture to Story (implemented locally 2026-07-24)

On `feat/capture-to-story-agents`, writers can Capture first and integrate with consent:

- open Capture from Project, Draft, Canvas, or narrow web without choosing hierarchy first;
- write scene-compatible rich prose with browser dictation; attach bounded private images, recorded
  audio, PDF, and plain text (Cloudflare R2 when configured; prose Capture still works without it);
- review Captures in a durable Inbox; promote losslessly to a new Scene with optional same-ID
  Canvas placement, or keep the source as inspectable provenance;
- connect BYOK provider keys under progressive setup (Capture never requires AI); preview a
  server-assembled context receipt before egress; optional collaboration preferences and
  declarative playbooks refine goals without granting tools or canonical authority;
- Scene Partner reflects on a Capture (summary, questions, story jobs) and can apply as a new Scene
  or a named scene variant that leaves the live working draft unchanged until apply;
- Sketch Partner, Character Coach, and Worldkeeper propose typed craft deltas applied only through
  existing scene/story-knowledge commands;
- project-scoped MCP grants can read granted Captures and submit Capture-reflection proposals into
  the same Inbox; external clients cannot apply canon or retrieve credentials.

Agents still never silent-write canon. Mockups 5.0, ADR 0010, and ADR 0011 govern the design.
Repository verification is green. Real-browser founder acceptance, live R2/KEK provisioning on
Fly, and post-gate Playwright remain pending before calling Capture shipped on production.

## Current writing milestone — Cursor shell, Title Page, Agent harness (2026-07-25)

On the same branch, the workspace shell and Agent dock advanced:

- Cursor-like chrome: activity rail, resizable Explorer primary, editor center, secondary
  **Agent | Properties** (Agent defaults open);
- **Plans** (ex–Dreams & Ideas) opens as a center workspace; Capture stays modal; primary side on
  wide remains Explorer (manuscript tree);
- **Cast** (Characters rail) opens as a center workspace — roster + dossier with visual gallery
  (BYOK generate / upload / delete), Role in the story, desire/pressure/voice, knowledge-link
  constellation (not Canvas Thread Trace), and scene presence with Draft jump; Explorer stays
  visible on wide. Manuscript tree selection leaves Cast for Write; a Write-rail click on a
  character record switches into Cast on that dossier. Split · Sheet can
  **Open in Cast studio** on the same story-knowledge id; Reader rail uses the same scene pin as
  elsewhere and exits Cast when opened;
- project home is a **Title Page**; Write-rail structure folders and Story Knowledge root use a
  **manuscript chronology** scroll (not BookReader, not launchpad cards);
- hardcover studio remains on the Title Page (cover concept/notes);
- BYOK cover / character visual options via async jobs with selectable image models from the
  available catalog (default `gpt-image-1`); Apply stores a private object locator (R2 when
  configured; hermetic memory fake for E2E) — never a data URI in Lakebase;
- Agent dock composer: modes **chat** / **Plan** / **agent**, real provider model ids + effort,
  persisted per project; picker lists only models the account can reach; **agent** mode requires
  tool-capable models; **agent** mode also exposes a compact toolkit row (Scene Partner, Cover,
  Character Coach, Worldkeeper, Sketch Partner) that deep-links into Plans or the Title Page cover
  studio with dock status copy, or refuses with writer-facing guidance when selection is missing;
  **chat** completes with BYOK via the selected provider and server-assembled project context;
  **Plan** replies can be explicitly **Saved to Plans** as a typed `plan-outline-v1` proposal bound
  to a new Capture (acknowledge/reject only — no manuscript apply); Settings owns multi-provider keys;
  capability ids still invoke read tools;
- Manuscript Explorer: header icons + right-click context menu; Canvas owns full center with a
  compact chapter chip strip (no canvas Quick Build).

**Proposed next:** Founder browser verification of writing-agent harness CP3–CP5 (including Plan→Plans
save) and post-gate Playwright; confirm production deploy/migrate for provider credentials when ready.

## Prior writing milestone — implemented locally 2026-07-12

The active branch now proves the first owner-only version of the core promise:

- authenticated writers create projects and manage the complete current manuscript/story-knowledge
  kernel through safe server-acknowledged commands;
- each scene has durable Tiptap prose, one direct-edit lease, clear save/conflict states, immutable
  checkpoints, named variants, block-aware comparison, restore-as-new, and explicit crash recovery;
- Draft and Story Canvas share canonical scene/story IDs, selected scene context, and Split view;
- Story Canvas persists spatial objects, notes, regions, story-knowledge/image metadata, typed
  confirmed or provisional links, personal viewport state, snapshot restore/undo, scope-keyed
  placements per drill layer, and a manuscript-derived spine that exposes drift without reordering
  prose;
- Parts and chapters carry optional descriptions; on the Write rail, book / part / chapter /
  unassigned / Story Knowledge root selections open a chronological manuscript scroll (scene
  blocks in tree order with plain-text prose) instead of structure card launchpads — structure
  stays in Explorer, Cast stays on the Characters rail, and a single scene still opens Draft;
- Chapters act as named scene folders with objectives/cast notes; scenes may carry URL backdrop,
  music, and image references; story knowledge supports notes, aliases, and typed knowledge links;
- Reader presents bound-book spreads with optional ElevenLabs voice packs (server-side TTS);
- wide web supports spatial writing and tree drag-and-drop; narrow web uses an ordered
  keyboard/screen-reader Canvas posture instead of pretending freeform drag fits a phone;
- Map (Canvas) mode defaults to a collapsed ~36px structure rail with `[` / »| expand, icon tool
  dock with Name · shortcut tooltips, Details hidden until needed, free card drag, Space/Hand pan,
  out-handle link drag, context menus mirroring tools, and ease-out layer camera on drill (instant
  when reduced motion is preferred).

This milestone does not yet deliver collaborators, comments/suggestions, real-time subscriptions or
presence, import/export, account exit, permanent purge, or production-provisioned R2/KEK (adapters
and hermetic fakes exist locally). Product copy must not imply those later outcomes already ship.

## Product principles

1. **The writer owns the work.** Complete history, usable export, clear permissions, and no
   model or platform lock-in.
2. **Full stories, not isolated prompts.** Books, series, characters, worlds, timelines, prose,
   notes, and decisions form one connected project.
3. **History without fear.** Writers can explore branches and variants, compare them, restore
   prior work, and publish named editions through a calm rich interface.
4. **AI assists; humans author and edit.** Agents propose and explain. Authors and editors
   review, combine, revise, or reject.
5. **Same project everywhere.** Web, platform shells, collaborators, and MCP operate on shared
   domain capabilities with permissions appropriate to each actor.
6. **Craft is a lens, not a law.** Guidance is optional, explainable, genre-aware, and never an
   opaque score of creativity.

## Scope boundary

Novel writing and multi-book storytelling lead the product. Screenplay-specific formatting,
writers' rooms, publishing integrations, studios, licensing, audience discovery, commerce,
and a marketplace remain later expansions. Each receives its own accepted plan before build.
