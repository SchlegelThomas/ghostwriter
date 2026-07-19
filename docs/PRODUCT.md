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
canonical local or offline project. See ADR 0005.

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

## Current writing milestone — implemented locally 2026-07-12

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
- Chapters act as named scene folders with objectives/cast notes; scenes may carry URL backdrop,
  music, and image references; story knowledge supports notes, aliases, and typed knowledge links;
- Reader presents bound-book spreads with optional ElevenLabs voice packs (server-side TTS);
- An in-app MCP chat dock lists capabilities and can invoke read tools; OpenAI completion waits on
  a configured key;
- wide web supports spatial writing and tree drag-and-drop; narrow web uses an ordered
  keyboard/screen-reader Canvas posture instead of pretending freeform drag fits a phone;
- Map (Canvas) mode defaults to a collapsed ~36px structure rail with `[` / »| expand, icon tool
  dock with Name · shortcut tooltips, Details hidden until needed, free card drag, Space/Hand pan,
  out-handle link drag, context menus mirroring tools, and ease-out layer camera on drill (instant
  when reduced motion is preferred).

This milestone does not yet deliver collaborators, comments/suggestions, real-time subscriptions or
presence, AI/image generation, binary media hosting (R2), import/export, account exit, permanent
purge, or native freeform Canvas editing. Product copy must not imply those later outcomes already
ship.

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
