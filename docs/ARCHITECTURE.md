# Ghostwriter — Architecture

## Strategy: one codebase, thin shells

Everything that can be shared lives in `packages/`. Platform targets are thin shells in
`apps/` that wire shared packages to a platform's entry point, storage, and native APIs.

```
ghostwriter/
  apps/
    client/       # Expo universal app: iOS, Android, AND web from one React Native codebase
    desktop/      # Electron shell wrapping the client's web export (native FS, offline)
    mcp/          # MCP server exposing Ghostwriter to external agents
  packages/
    core/         # domain model + logic: manuscripts, scenes, story bible, AI orchestration
    ui/           # shared React Native components (render on web via react-native-web)
    editor/       # Tiptap (ProseMirror) rich-text editor; mounted directly on web/desktop,
                  # hosted in an Expo DOM component ('use dom' WebView) on iOS/Android
    storage/      # persistence abstraction with per-platform adapters
    ai/           # LLM provider clients, prompt templates, streaming
  docs/
  plans/
```

The editor is deliberately its own package because it's the one piece of UI that is DOM-based
rather than React Native: web and desktop mount it directly, native mobile hosts it via Expo's
DOM components (stable since SDK 56). Keep its public interface platform-neutral (props in,
document changes out) so the hosting mechanism stays swappable.

## Dependency rules (enforced by review, later by lint)

- `core` imports nothing platform-specific: no DOM, no Electron, no React, no React Native.
- `ui` may import `core`, never the reverse.
- `apps/*` may import any package; packages never import from `apps/`.
- `mcp` is an `apps/` shell over `core` — the same functions the UI calls. If an MCP tool
  needs logic that doesn't exist in `core`, add it to `core` first.

## Feature workflow

Every feature is built inside-out:

1. Model + logic in `packages/core` (pure, testable, platform-free).
2. Expose via MCP tool in `apps/mcp`.
3. Bind to UI in `packages/ui`, mount in shells.

This ordering keeps MCP at parity by construction instead of as an afterthought.

## Committed stack

- TypeScript (strict), ESM, Node.js LTS
- pnpm workspaces monorepo
- **Expo / React Native** for the universal client (iOS, Android, web via react-native-web)
  — decided 2026-07-11
- Electron for desktop, wrapping the Expo web export
- **Tiptap (ProseMirror)** for the rich-text editor — decided 2026-07-11 (schema-enforced
  manuscript structure, mature track-changes ecosystem, y-prosemirror for future sync)
- `@modelcontextprotocol/sdk` for the MCP server
- Vitest for tests
- GitHub Actions for CI/CD; Cloudflare Pages for web hosting (see `docs/OPERATIONS.md`)

## Open decisions

Decide these when the work demands it, with the user, and record the outcome in the active
plan's record-log plus update this section.

| Decision | Options on the table | Notes |
|---|---|---|
| Local storage | SQLite (via better-sqlite3 / wa-sqlite), flat files (Markdown + frontmatter), hybrid | Local-first is committed; the format is not |
| Sync/backend | none (v1), CRDT-based sync (Yjs/Automerge), simple cloud backup | Only matters once multi-device editing is real |
| Build tooling | Vite, Turborepo for task orchestration | Likely Vite + Turborepo, confirm when scaffolding |
| AI providers | Anthropic, OpenAI, local models via Ollama | `packages/ai` should abstract this from day one |

## Non-negotiables recap

Local-first storage, MCP parity with the UI, platform-agnostic core. See `AGENTS.md`.
