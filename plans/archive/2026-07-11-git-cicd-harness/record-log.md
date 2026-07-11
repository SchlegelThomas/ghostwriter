# Record log

## 2026-07-11 07:42
Editor engine decided: Tiptap (ProseMirror). Rationale: schema-enforced manuscript structure,
mature track-changes plugins for reviewable AI edits, best-in-class Yjs collab binding
(y-prosemirror) for future sync. Lexical's React DX advantage is mostly closed by Tiptap.

## 2026-07-11 07:45
Hosting decided. Repo is public on GitHub (SchlegelThomas/ghostwriter) → Actions free with
no minute cap. Web hosting: Cloudflare Pages free tier (unlimited bandwidth, per-branch
preview URLs, wrangler direct-upload — no CF build minutes consumed). Dev deploys are
CLI-driven from any local branch via scripts/deploy-dev.sh; prod deploys auto on push to
main via Actions. Mobile via EAS free tier and desktop via GitHub Releases deferred until
those shells exist. Total running cost: $0 (Apple's $99/yr only when iOS device builds start).

Workflows are step-guarded on package.json existing so CI stays green pre-scaffold.
