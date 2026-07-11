# Ghostwriter

An AI tool for creative writers. One TypeScript/Node.js codebase targeting web, desktop
(Electron), and mobile — plus an MCP server so external AI agents can collaborate on a
writer's project directly.

> Status: the foundation and product blueprint are merged. Current branch implements a
> platform-neutral multi-book domain kernel, a responsive read-only fixture navigator, a matching
> MCP project query, and (ADR 0004) a Databricks Lakebase Postgres backend with Drizzle migrations,
> a Node/Hono service, and a database branch per pull request. Auth, profiles, subscriptions,
> rich editing, and collaboration remain later slices.

## Orientation

| Read | To learn |
|---|---|
| `AGENTS.md` | How AI agents (and humans) should work in this repo |
| `docs/PRODUCT.md` | What Ghostwriter is and who it's for |
| `docs/ARCHITECTURE.md` | One-codebase strategy, stack, open decisions |
| `docs/OPERATIONS.md` | CI/CD, hosting, dev/prod deploy flows |
| `plans/WHERE-I-LEFT-OFF.html` | Current state and next step |
| `plans/README.html` | Rich planning system and delivery loop |
| `plans/designs/Ghostwriter Mockups 2.0.html` | Living Story Canvas and writing-experience design source |
| `docs/adr/README.md` | How durable architecture decisions are recorded |

## Working on this repo

All meaningful work begins with a rich HTML delivery plan in `plans/active/`. Start every
session by reading `plans/WHERE-I-LEFT-OFF.html`.
