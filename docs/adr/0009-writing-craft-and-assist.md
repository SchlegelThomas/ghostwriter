# ADR 0009 — Scene craft fields and writing-assist proposals

## Status

Accepted — 2026-07-19

## Context

Mockups 4.0 asks writers to invent scenes with sketches, character sheets, and backdrops, then call bounded writing agents. Manuscript prose already uses schema-v1 Tiptap documents with leases, checkpoints, and variants. Craft must not become a second manuscript, and agents must not silently write canon.

## Decision

1. **Scene sketch** is optional JSON on `scenes.sketch` (purpose, conflict, turn, beats, sensory notes, open questions, ink paths). It is planned craft, updated through `scene.update`, never reading-order prose.
2. **Character sheet** is optional JSON on `story_knowledge.character_sheet` (desire, pressure, voice notes), updated through `storyKnowledge.update`.
3. **Ink** persists only on the scene sketch. It is not stored in ProseMirror scene documents.
4. **Writing assist** returns inspectable proposals via `POST /api/projects/{id}/writing-assist`. V1 uses deterministic local proposals labeled `deterministic-local`. Apply is always a separate human action through existing commands or Draft caret insert.
5. **Dictation** inserts into the live Tiptap editor via browser SpeechRecognition; it does not bypass the scene lease or save queue.

## Consequences

- Migration `0009_writing_craft` adds `scenes.sketch` and `story_knowledge.character_sheet`.
- Capability `writing.assist.propose` is registered with MCP mutation deferred.
- OpenAI (or other providers) may later replace the deterministic generator without changing the propose → apply authority rule.
- Compare/checkpoint/restore remain prose-only; craft has its own project-command version domain.

## Alternatives considered

- Freehand nodes inside Tiptap — rejected for v1 (schema/compare risk).
- Persisted proposal inbox table — deferred; apply still human-gated through existing mutations.
- Replacing Tiptap — rejected; modalities layer on the existing editor.
