# Record log

## 2026-07-11 07:30
Repo was empty except README. Decided harness shape: AGENTS.md (agent entry point) +
plans/ (cross-session memory: active/archive plans, WHERE-I-LEFT-OFF) + docs/ (product +
architecture). Key architecture invariants recorded up front: shared TS core with thin
platform shells, MCP as a first-class interface, local-first storage. Stack leanings
(pnpm workspaces, strict TS, ESM) written into AGENTS.md; framework choices (UI, mobile
strategy, editor engine) deliberately left as open decisions in docs/ARCHITECTURE.md.
