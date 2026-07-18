# ADR 0008 — Scene folders, URL media, and story-knowledge depth

- Status: Accepted
- Date: 2026-07-12
- Branch: `feat/authenticated-project-crud`

## Context

The authenticated tree + Canvas milestone proved structure and prose, but live review showed thin folder metadata, flat story knowledge, and no scene ambience. Writers need chapter-level objectives/cast notes, deeper knowledge records with relationships, and scene backdrop/music/image references without waiting on a full CDN.

## Decision

1. **Chapters are scene folders.** Extend `ManuscriptChapter` with optional `summary` (objectives, cast, folder notes). Parts may later gain the same field; Unassigned remains a synthetic system bucket and is not renameable.
2. **Scene ambience is URL + metadata.** Scenes may carry optional `backdrop` (`url`, `caption`), `music` (`url`, `label`), and `imageRefs` (`url`, `alt`, `caption`) arrays. Ghostwriter does not fetch, proxy, or host binaries in this ADR. Cloudflare R2 upload requires a later ADR.
3. **Story knowledge deepens inside ADR 0003 boundaries.** Add optional `notes` body and `aliases`. Add `story_knowledge_links` with directed kinds: `cast`, `theme`, `development-cycle`, `breadcrumb`, `related`. Scene links and Canvas object links remain separate authorities.
4. **Concurrency.** These fields mutate through existing `project.version` metadata commands. No new optimistic domain.

## Consequences

- Migration adds chapter summary, scene ambience JSON columns, knowledge notes/aliases, and knowledge-link table.
- Inspector and tree surface the new fields; Canvas Relationships lens can emphasize knowledge links.
- Broken external URLs are writer-visible reference failures, not server errors.
- Binary assets, generated images, and audio hosting remain explicitly deferred.

## Alternatives considered

- Renameable Unassigned folders — rejected; Unassigned is placement state, not a container record.
- Immediate R2 uploads — deferred for reversible URL-first delivery.
- Full typed story-bible schema — deferred; notes + aliases + typed K↔K links are the minimum useful depth.
