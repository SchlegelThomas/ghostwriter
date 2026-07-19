import type { ProjectNavigator } from "@ghostwriter/core";
import type { ManuscriptSelection } from "./manuscript-selection.js";

export type WorkspaceSurfaceMode = "draft" | "canvas" | "split";

export type WorkspaceJumpKind =
  | "book"
  | "chapter"
  | "scene"
  | "story-knowledge"
  | "mode"
  | "panel";

export type WorkspaceJumpTarget = Readonly<{
  id: string;
  kind: WorkspaceJumpKind;
  title: string;
  subtitle: string;
  selection?: ManuscriptSelection;
  mode?: WorkspaceSurfaceMode;
  openReader?: boolean;
  toggleStructure?: boolean;
  toggleChat?: boolean;
  toggleJump?: boolean;
}>;

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

function scoreMatch(haystack: string, query: string): number {
  const text = haystack.toLowerCase();
  if (query.length === 0) return 1;
  if (text === query) return 100;
  if (text.startsWith(query)) return 80;
  const index = text.indexOf(query);
  if (index >= 0) return 60 - Math.min(40, index);
  const compact = text.replace(/\s+/g, "");
  const compactQuery = query.replace(/\s+/g, "");
  if (compact.includes(compactQuery)) return 40;
  return 0;
}

/** Index manuscript + common shell destinations for ⌘P / ⌘⇧P. */
export function buildWorkspaceJumpTargets(
  project: ProjectNavigator
): readonly WorkspaceJumpTarget[] {
  const targets: WorkspaceJumpTarget[] = [
    {
      id: "mode:draft",
      kind: "mode",
      title: "Open Draft",
      subtitle: "Writing surface",
      mode: "draft"
    },
    {
      id: "mode:canvas",
      kind: "mode",
      title: "Open Canvas",
      subtitle: "Map / board",
      mode: "canvas"
    },
    {
      id: "mode:split",
      kind: "mode",
      title: "Open Split",
      subtitle: "Draft beside Canvas",
      mode: "split"
    },
    {
      id: "panel:structure",
      kind: "panel",
      title: "Toggle Structure",
      subtitle: "Manuscript tree · [",
      toggleStructure: true
    },
    {
      id: "panel:chat",
      kind: "panel",
      title: "Toggle Chat",
      subtitle: "MCP chat · ⌘⇧P",
      toggleChat: true
    },
    {
      id: "panel:jump",
      kind: "panel",
      title: "Quick Jump",
      subtitle: "Jump to book components · ⌘P",
      toggleJump: true
    }
  ];

  for (const book of project.books) {
    targets.push({
      id: `book:${book.id}`,
      kind: "book",
      title: book.title,
      subtitle: "Book",
      selection: { kind: "book", bookId: book.id }
    });

    for (const part of book.parts) {
      for (const chapter of part.chapters) {
        targets.push({
          id: `chapter:${chapter.id}`,
          kind: "chapter",
          title: chapter.title,
          subtitle: `${book.title} · Chapter`,
          selection: {
            kind: "chapter",
            bookId: book.id,
            partId: part.id,
            chapterId: chapter.id
          }
        });

        for (const scene of chapter.scenes) {
          if (scene.archivedAt !== undefined) continue;
          targets.push({
            id: `scene:${scene.id}`,
            kind: "scene",
            title: scene.title,
            subtitle: `${book.title} · ${chapter.title} · Scene`,
            selection: {
              kind: "scene",
              bookId: book.id,
              partId: part.id,
              chapterId: chapter.id,
              sceneId: scene.id
            },
            mode: "draft"
          });
        }
      }
    }

    for (const scene of book.unassignedScenes) {
      if (scene.archivedAt !== undefined) continue;
      targets.push({
        id: `scene:${scene.id}`,
        kind: "scene",
        title: scene.title,
        subtitle: `${book.title} · Unassigned · Scene`,
        selection: {
          kind: "scene",
          bookId: book.id,
          sceneId: scene.id
        },
        mode: "draft"
      });
    }
  }

  for (const knowledge of project.storyKnowledge) {
    if (knowledge.archivedAt !== undefined) continue;
    targets.push({
      id: `story-knowledge:${knowledge.id}`,
      kind: "story-knowledge",
      title: knowledge.label,
      subtitle: `Story record · ${knowledge.kind}`,
      selection: {
        kind: "storyKnowledge",
        storyKnowledgeId: knowledge.id
      }
    });
  }

  return targets;
}

export function filterWorkspaceJumpTargets(
  targets: readonly WorkspaceJumpTarget[],
  query: string,
  options: Readonly<{ kinds?: readonly WorkspaceJumpKind[]; limit?: number }> = {}
): readonly WorkspaceJumpTarget[] {
  const normalized = normalizeQuery(query);
  const kinds = options.kinds === undefined ? undefined : new Set(options.kinds);
  const limit = options.limit ?? 40;

  return targets
    .filter((target) => kinds === undefined || kinds.has(target.kind))
    .map((target) => {
      const score = Math.max(
        scoreMatch(target.title, normalized),
        scoreMatch(target.subtitle, normalized) * 0.7,
        scoreMatch(target.kind, normalized) * 0.5
      );
      return { target, score };
    })
    .filter((entry) => (normalized.length === 0 ? true : entry.score > 0))
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.target.title.localeCompare(right.target.title);
    })
    .slice(0, limit)
    .map((entry) => entry.target);
}

/** Manuscript-only targets for ⌘P quick open. */
export function manuscriptJumpKinds(): readonly WorkspaceJumpKind[] {
  return ["book", "chapter", "scene", "story-knowledge"];
}

/** Shell commands for ⌘⇧P (modes + panels). */
export function commandPaletteKinds(): readonly WorkspaceJumpKind[] {
  return ["mode", "panel"];
}
