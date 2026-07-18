# Ghostwriter

An AI tool for creative writers. One TypeScript/Node.js codebase targeting web, desktop
(Electron), and mobile — plus an MCP server so external AI agents can collaborate on a
writer's project directly.

> Status: the foundation, product blueprint, multi-book kernel, and Lakebase backend are merged.
> The current feature branch adds ADR 0005 Google/Better Auth accounts, writer profiles, owner-scoped
> projects, a first-party Pages-to-Fly API path, and safe end-to-end commands for the current
> project/book/manuscript-structure/scene-metadata/story-knowledge kernel. Local real-Google
> acceptance is preserved at pushed checkpoint `a73d532`. The uncommitted expanded milestone now
> adds durable Tiptap prose, owner leases, checkpoints/variants/compare/restore, encrypted
> unacknowledged-work recovery, and server-authoritative Story Canvas/Split state. All 121 tests and
> 13 browser journeys pass. Subscriptions, collaborators, AI, import/export, and purge remain later.

## Orientation

| Read | To learn |
|---|---|
| `AGENTS.md` | How AI agents (and humans) should work in this repo |
| `docs/PRODUCT.md` | What Ghostwriter is and who it's for |
| `docs/ARCHITECTURE.md` | One-codebase strategy, stack, open decisions |
| `docs/API.md` | Authenticated HTTP surface, typed commands, versions, and errors |
| `docs/OPERATIONS.md` | CI/CD, hosting, dev/prod deploy flows |
| `plans/WHERE-I-LEFT-OFF.html` | Current state and next step |
| `plans/README.html` | Rich planning system and delivery loop |
| `plans/designs/Ghostwriter Mockups 2.0.html` | Living Story Canvas and writing-experience design source |
| `docs/adr/README.md` | How durable architecture decisions are recorded |

## Working on this repo

All meaningful work begins with a rich HTML delivery plan in `plans/active/`. Start every
session by reading `plans/WHERE-I-LEFT-OFF.html`.
