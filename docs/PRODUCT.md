# Ghostwriter — Product

## What it is

An AI tool for creative writers: novelists, short-story writers, screenwriters, worldbuilders.
It helps with the craft — drafting, revising, continuity, structure — without taking the pen
away from the writer.

## Who it's for

Writers who want an AI collaborator that knows their whole project (manuscript, characters,
world, style), not a chat window they paste fragments into.

## Where it runs

One product, four surfaces, one codebase:

| Surface | Role |
|---|---|
| Web | Primary writing environment, zero-install |
| Desktop (Electron) | Offline-first, local files, long writing sessions |
| Mobile | Capture ideas, review and light editing on the go |
| MCP server | Lets external AI agents (Claude, Cursor, etc.) read/write the writer's project |

The MCP surface is what makes Ghostwriter a *tool for the AI era*: a writer's project becomes
something any agent can collaborate on, with Ghostwriter as the source of truth.

## Product principles

1. **The writer owns the words.** Local-first storage, exportable formats, no lock-in.
2. **AI assists, never autopilots.** Suggestions and drafts are always offered, never silently applied.
3. **Project-aware, not prompt-aware.** The value is context: the AI knows the characters,
   the timeline, the voice.
4. **Same brain everywhere.** A feature that exists on web exists on desktop, mobile
   (where it makes sense), and MCP.

## Candidate feature areas (not committed)

- Manuscript editor with scene/chapter structure
- Story bible: characters, places, timelines, automatically kept in sync with the text
- Continuity checking ("Elena's eyes were green in chapter 2")
- Voice-consistent drafting and revision suggestions
- Outlining and beat-sheet tools
- MCP tools: query the story bible, propose edits, generate drafts into an inbox

This list exists to give direction; each feature gets its own plan before it gets built.
