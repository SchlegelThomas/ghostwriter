import type { ProjectCommand, ProjectNavigator } from "@ghostwriter/core";
import {
  resolveManuscriptSelection,
  type ManuscriptSelection
} from "./manuscript-selection.js";

export type ManuscriptExplorerActionId =
  | "add"
  | "rename"
  | "move-up"
  | "move-down"
  | "archive"
  | "restore"
  | "collapse-all";

export type ManuscriptExplorerActionFlags = Readonly<{
  canAdd: boolean;
  addLabel?: string;
  canRename: boolean;
  canReorderUp: boolean;
  canReorderDown: boolean;
  canArchive: boolean;
  archived: boolean;
  /** When false, omit collapse-all. Default true. */
  includeCollapseAll?: boolean;
}>;

/**
 * Cursor-style explorer actions for the current selection.
 * Derives from the same capability rules as ManuscriptTree + SelectionInspector.
 */
export function manuscriptExplorerActions(
  flags: ManuscriptExplorerActionFlags
): readonly ManuscriptExplorerActionId[] {
  const actions: ManuscriptExplorerActionId[] = [];
  if (flags.canAdd) actions.push("add");
  if (flags.canRename) actions.push("rename");
  if (flags.canReorderUp) actions.push("move-up");
  if (flags.canReorderDown) actions.push("move-down");
  if (flags.canArchive) {
    actions.push(flags.archived ? "restore" : "archive");
  }
  if (flags.includeCollapseAll !== false) {
    actions.push("collapse-all");
  }
  return actions;
}

export function manuscriptExplorerActionLabel(
  action: ManuscriptExplorerActionId,
  flags: Pick<ManuscriptExplorerActionFlags, "addLabel"> = {}
): string {
  switch (action) {
    case "add":
      return flags.addLabel === undefined
        ? "Add child"
        : `Add ${flags.addLabel}`;
    case "rename":
      return "Rename";
    case "move-up":
      return "Move up";
    case "move-down":
      return "Move down";
    case "archive":
      return "Archive";
    case "restore":
      return "Restore";
    case "collapse-all":
      return "Collapse all";
  }
}

/**
 * Resolve tree + inspector capability flags for a manuscript selection.
 * Returns undefined when the selection is absent from the navigator.
 */
export function resolveManuscriptExplorerCapabilities(
  project: ProjectNavigator,
  selection: ManuscriptSelection
): ManuscriptExplorerActionFlags | undefined {
  if (selection.kind === "project") {
    return {
      canAdd: true,
      addLabel: "book",
      canRename: true,
      canReorderUp: false,
      canReorderDown: false,
      canArchive: true,
      archived: project.archivedAt !== undefined
    };
  }

  if (selection.kind === "storyKnowledgeRoot") {
    return {
      canAdd: true,
      addLabel: "story record",
      canRename: false,
      canReorderUp: false,
      canReorderDown: false,
      canArchive: false,
      archived: false
    };
  }

  const resolved = resolveManuscriptSelection(project, selection);
  if (resolved === undefined) return undefined;

  if (selection.kind === "book" && resolved.book !== undefined) {
    const book = resolved.book;
    const index = project.books.findIndex((candidate) => candidate.id === book.id);
    const lastActive =
      book.archivedAt === undefined &&
      project.books.filter((candidate) => candidate.archivedAt === undefined)
        .length <= 1;
    return {
      canAdd: true,
      addLabel: "part",
      canRename: true,
      canReorderUp: index > 0,
      canReorderDown: index >= 0 && index < project.books.length - 1,
      canArchive: !lastActive,
      archived: book.archivedAt !== undefined
    };
  }

  if (
    selection.kind === "part" &&
    resolved.book !== undefined &&
    resolved.part !== undefined
  ) {
    const index = resolved.book.parts.findIndex(
      (candidate) => candidate.id === resolved.part!.id
    );
    return {
      canAdd: true,
      addLabel: "chapter",
      canRename: true,
      canReorderUp: index > 0,
      canReorderDown: index >= 0 && index < resolved.book.parts.length - 1,
      canArchive: false,
      archived: false
    };
  }

  if (
    selection.kind === "chapter" &&
    resolved.book !== undefined &&
    resolved.part !== undefined &&
    resolved.chapter !== undefined
  ) {
    const index = resolved.part.chapters.findIndex(
      (candidate) => candidate.id === resolved.chapter!.id
    );
    return {
      canAdd: true,
      addLabel: "scene",
      canRename: true,
      canReorderUp: index > 0,
      canReorderDown: index >= 0 && index < resolved.part.chapters.length - 1,
      canArchive: false,
      archived: false
    };
  }

  if (selection.kind === "unassigned" && resolved.book !== undefined) {
    return {
      canAdd: true,
      addLabel: "scene",
      canRename: false,
      canReorderUp: false,
      canReorderDown: false,
      canArchive: false,
      archived: false
    };
  }

  if (selection.kind === "scene" && resolved.scene !== undefined) {
    const scene = resolved.scene;
    let reorderIndex = -1;
    let reorderCount = 0;
    if (
      selection.partId !== undefined &&
      selection.chapterId !== undefined &&
      resolved.chapter !== undefined
    ) {
      reorderIndex = resolved.chapter.scenes.findIndex(
        (candidate) => candidate.id === scene.id
      );
      reorderCount = resolved.chapter.scenes.length;
    } else if (resolved.book !== undefined) {
      reorderIndex = resolved.book.unassignedScenes.findIndex(
        (candidate) => candidate.id === scene.id
      );
      reorderCount = resolved.book.unassignedScenes.length;
    }
    return {
      canAdd: false,
      canRename: true,
      canReorderUp: reorderIndex > 0,
      canReorderDown:
        reorderIndex >= 0 && reorderIndex < reorderCount - 1,
      canArchive: true,
      archived: scene.archivedAt !== undefined
    };
  }

  if (selection.kind === "storyKnowledge" && resolved.knowledge !== undefined) {
    const knowledge = resolved.knowledge;
    const usedAsPov = project.books.some((book) => {
      const scenes = [
        ...book.parts.flatMap((part) =>
          part.chapters.flatMap((chapter) => chapter.scenes)
        ),
        ...book.unassignedScenes
      ];
      return scenes.some(
        (scene) => scene.povStoryKnowledgeId === knowledge.id
      );
    });
    return {
      canAdd: false,
      canRename: true,
      canReorderUp: false,
      canReorderDown: false,
      canArchive: !usedAsPov,
      archived: knowledge.archivedAt !== undefined
    };
  }

  return undefined;
}

/** Header toolbar omits archive/restore — those stay on the context menu. */
export function manuscriptExplorerHeaderActions(
  flags: ManuscriptExplorerActionFlags
): readonly ManuscriptExplorerActionId[] {
  return manuscriptExplorerActions(flags).filter(
    (action) => action !== "archive" && action !== "restore"
  );
}

export type ManuscriptExplorerArchivePlan = Readonly<{
  command: ProjectCommand;
  confirmation?: Readonly<{ title: string; detail: string; confirmLabel: string }>;
}>;

/**
 * Build the archive/restore command (and archive confirmation copy) for kinds
 * SelectionInspector already supports.
 */
export function planManuscriptExplorerArchive(
  project: ProjectNavigator,
  selection: ManuscriptSelection,
  archived: boolean
): ManuscriptExplorerArchivePlan | undefined {
  const resolved = resolveManuscriptSelection(project, selection);
  if (selection.kind === "project") {
    if (archived) {
      return {
        command: { type: "project.setArchived", archived: true },
        confirmation: {
          title: `Archive ${project.title}?`,
          detail:
            "It leaves the active library, but every book, Draft revision, and Canvas snapshot remains recoverable.",
          confirmLabel: "Confirm archive project"
        }
      };
    }
    return { command: { type: "project.setArchived", archived: false } };
  }
  if (selection.kind === "book" && resolved?.book !== undefined) {
    const book = resolved.book;
    if (archived) {
      return {
        command: {
          type: "book.setArchived",
          bookId: book.id,
          archived: true
        },
        confirmation: {
          title: `Archive ${book.title}?`,
          detail:
            "Its manuscript and history remain recoverable. Ghostwriter always keeps at least one active book.",
          confirmLabel: "Confirm archive book"
        }
      };
    }
    return {
      command: {
        type: "book.setArchived",
        bookId: book.id,
        archived: false
      }
    };
  }
  if (selection.kind === "scene" && resolved?.scene !== undefined) {
    const scene = resolved.scene;
    if (archived) {
      return {
        command: {
          type: "scene.setArchived",
          sceneId: scene.id,
          archived: true
        },
        confirmation: {
          title: `Archive ${scene.title}?`,
          detail:
            "The scene stays in manuscript placement and all Draft/Canvas history remains recoverable.",
          confirmLabel: "Confirm archive scene"
        }
      };
    }
    return {
      command: {
        type: "scene.setArchived",
        sceneId: scene.id,
        archived: false
      }
    };
  }
  if (
    selection.kind === "storyKnowledge" &&
    resolved?.knowledge !== undefined
  ) {
    const knowledge = resolved.knowledge;
    if (archived) {
      return {
        command: {
          type: "storyKnowledge.setArchived",
          storyKnowledgeId: knowledge.id,
          archived: true
        },
        confirmation: {
          title: `Archive ${knowledge.label}?`,
          detail:
            "Existing scene links remain preserved. A record used as POV must be unassigned first.",
          confirmLabel: "Confirm archive story knowledge"
        }
      };
    }
    return {
      command: {
        type: "storyKnowledge.setArchived",
        storyKnowledgeId: knowledge.id,
        archived: false
      }
    };
  }
  return undefined;
}
