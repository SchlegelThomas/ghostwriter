# ADR 0009 — Canvas scope placements, Reader TTS, and MCP chat shell

- Status: Accepted
- Date: 2026-07-12
- Branch: `feat/authenticated-project-crud`

## Context

Drill lenses filter one global Canvas board. Writers need distinct layouts per project/chapter/scene scope without inventing a second manuscript order. Reader needs book-like presentation and ElevenLabs voices (pattern from the peer `wrapper` repo). Writers also need an in-app way to reach MCP-exposed capabilities before OpenAI credentials arrive.

## Decision

1. **Scope-keyed Canvas placements.** Persist optional placements keyed by `(objectId, scopeKind, scopeId?)` with x/y/width/height. Missing keys fall back to the object’s global geometry. Scope layouts are interpretive; manuscript order stays on the tree. Canvas board version still gates mutations.
2. **Reader TTS via ElevenLabs.** Server-only synthesis (`ELEVENLABS_API_KEY`), voice packs (`default` / `narrative` / `noir` / `soft`) mapped to voice IDs with env overrides, bounded text, base64 mp3 response. Client plays audio; unconfigured key returns a clear non-fatal “voice unavailable” state. No key in the browser bundle.
3. **In-app MCP chat shell.** Authenticated docked panel lists `GHOSTWRITER_CAPABILITIES`, can invoke read tools against the open project through the backend, and reserves an LLM turn slot. OpenAI tool-use activates only when `OPENAI_API_KEY` is configured; until then, tool-only turns and explicit “AI not configured” copy apply. Canonical writes through chat remain capability-gated like MCP.

## Consequences

- New tables/columns for scope placements; commands to upsert placement without rewriting object identity.
- Backend routes for TTS and chat/tool invoke; Fly secrets for ElevenLabs (and later OpenAI).
- Reader UI gains book chrome and voice controls; workspace gains a chat dock.
- Does not authorize remote anonymous MCP, multi-tenant AI billing, or streaming synthesis in v1.

## Alternatives considered

- Separate Canvas board per chapter — rejected; one board with scope placements preserves shared identity.
- Client-side ElevenLabs calls — rejected; key must stay server-side.
- Wait for OpenAI before shipping chat UI — rejected; tool invoke alone is useful and matches MCP-first design.
