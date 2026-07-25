# Ghostwriter

An AI tool for creative writers. One TypeScript/Node.js codebase targeting web, desktop
(Electron), and mobile — plus an MCP server so external AI agents can collaborate on a
writer's project directly.

> Status: authenticated writing workspace, Canvas/Write craft, and Capture→Story / BYOK agent
> foundation land via feature branches (see `plans/WHERE-I-LEFT-OFF.html`). Production web is
> `https://ghost-writer.studio` with Google/Better Auth and a first-party Pages-to-Fly `/api` path;
> backend is `https://ghostwriter-backend.fly.dev`. Subscriptions, collaborators, import/export,
> purge, and production R2/KEK provisioning remain later or ops-gated.

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
| `plans/designs/Ghostwriter Mockups 5.0.html` | Proposed Capture, Inbox, story-integration, and first-agent living design |
| `docs/adr/README.md` | How durable architecture decisions are recorded |

## Working on this repo

All meaningful work begins with a rich HTML delivery plan in `plans/active/`. Start every
session by reading `plans/WHERE-I-LEFT-OFF.html`.
