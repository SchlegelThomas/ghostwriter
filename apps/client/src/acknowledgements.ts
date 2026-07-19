import type {
  CanvasCommand,
  ProjectCommand,
  ProjectNavigator,
  ProjectNavigatorBook,
  ProjectNavigatorChapter,
  ProjectNavigatorKnowledge,
  ProjectNavigatorPart,
  ProjectNavigatorScene,
  SceneId
} from "@ghostwriter/core";
import type { AcknowledgementToast } from "@ghostwriter/ui";

export const TOAST_VISIBLE_LIMIT = 3;
export const TOAST_SUCCESS_DURATION_MS = 6_000;
export const SAFE_UNDO_DURATION_MS = 30_000;
export const DRAFT_ACKNOWLEDGEMENT_SUPPRESSION_MS = 30_000;

export type ToastReducerEvent =
  | Readonly<{ type: "push"; toast: AcknowledgementToast }>
  | Readonly<{ type: "clear" }>
  | Readonly<{ type: "dismiss"; id: string }>
  | Readonly<{ type: "tick"; now: number }>
  | Readonly<{ type: "pause"; id: string; now: number }>
  | Readonly<{ type: "resume"; id: string; now: number }>
  | Readonly<{ type: "expireAction"; id: string }>;

export type ProjectCommandAcknowledgement = Readonly<{
  title: string;
  detail: string;
  inverse?: ProjectCommand;
  actionLabel?: "Undo" | "Restore";
}>;

export type CanvasCommandAcknowledgement = Readonly<{
  title: string;
  detail: string;
  actionLabel: "Undo";
}>;

type LocatedScene = Readonly<{
  scene: ProjectNavigatorScene;
  book: ProjectNavigatorBook;
  part?: ProjectNavigatorPart;
  chapter?: ProjectNavigatorChapter;
  position: number;
}>;

function locateScene(
  project: ProjectNavigator,
  sceneId: SceneId
): LocatedScene | undefined {
  for (const book of project.books) {
    for (const part of book.parts) {
      for (const chapter of part.chapters) {
        const position = chapter.scenes.findIndex(
          (scene) => scene.id === sceneId
        );
        if (position >= 0) {
          const scene = chapter.scenes[position];
          if (scene !== undefined) {
            return { scene, book, part, chapter, position };
          }
        }
      }
    }
    const position = book.unassignedScenes.findIndex(
      (scene) => scene.id === sceneId
    );
    if (position >= 0) {
      const scene = book.unassignedScenes[position];
      if (scene !== undefined) return { scene, book, position };
    }
  }
  return undefined;
}

function findBook(
  project: ProjectNavigator,
  id: ProjectNavigatorBook["id"]
): ProjectNavigatorBook | undefined {
  return project.books.find((book) => book.id === id);
}

function findPart(
  project: ProjectNavigator,
  bookId: ProjectNavigatorBook["id"],
  partId: ProjectNavigatorPart["id"]
): ProjectNavigatorPart | undefined {
  return findBook(project, bookId)?.parts.find((part) => part.id === partId);
}

function findChapter(
  project: ProjectNavigator,
  bookId: ProjectNavigatorBook["id"],
  partId: ProjectNavigatorPart["id"],
  chapterId: ProjectNavigatorChapter["id"]
): ProjectNavigatorChapter | undefined {
  return findPart(project, bookId, partId)?.chapters.find(
    (chapter) => chapter.id === chapterId
  );
}

function findKnowledge(
  project: ProjectNavigator,
  id: ProjectNavigatorKnowledge["id"]
): ProjectNavigatorKnowledge | undefined {
  return project.storyKnowledge.find((knowledge) => knowledge.id === id);
}

function sceneDestination(scene: LocatedScene | undefined): string {
  if (scene === undefined) return "its manuscript destination";
  return scene.chapter?.title ?? `${scene.book.title} · Unassigned`;
}

export function acknowledgementForProjectCommand(
  before: ProjectNavigator,
  command: ProjectCommand,
  after: ProjectNavigator
): ProjectCommandAcknowledgement {
  switch (command.type) {
    case "project.rename":
      return {
        title: "Project renamed",
        detail: `${after.title} · Saved to project`,
        inverse: { type: "project.rename", title: before.title },
        actionLabel: "Undo"
      };
    case "project.setArchived":
      return {
        title: command.archived ? "Project archived" : "Project restored",
        detail: `${after.title} · Saved to project`,
        inverse: {
          type: "project.setArchived",
          archived: !command.archived
        },
        actionLabel: command.archived ? "Restore" : "Undo"
      };
    case "book.create":
      return {
        title: "Book created",
        detail: `${command.title} · Saved to project`
      };
    case "book.update": {
      const oldBook = findBook(before, command.bookId);
      const newBook = findBook(after, command.bookId);
      const renamed = command.title !== undefined;
      const statusChanged = command.status !== undefined;
      return {
        title:
          renamed && !statusChanged
            ? "Book renamed"
            : statusChanged && !renamed
              ? "Book status updated"
              : "Book updated",
        detail: `${newBook?.title ?? oldBook?.title ?? "Book"} · Saved to project`,
        ...(oldBook === undefined
          ? {}
          : {
              inverse: {
                type: "book.update" as const,
                bookId: command.bookId,
                ...(command.title === undefined
                  ? {}
                  : { title: oldBook.title }),
                ...(command.status === undefined
                  ? {}
                  : { status: oldBook.status })
              },
              actionLabel: "Undo" as const
            })
      };
    }
    case "book.reorder":
      return {
        title: "Book order updated",
        detail: "Canonical series order · Saved to project",
        inverse: {
          type: "book.reorder",
          bookIds: before.books.map((book) => book.id)
        },
        actionLabel: "Undo"
      };
    case "book.setArchived": {
      const book =
        findBook(after, command.bookId) ?? findBook(before, command.bookId);
      return {
        title: command.archived ? "Book archived" : "Book restored",
        detail: `${book?.title ?? "Book"} · Saved to project`,
        inverse: {
          type: "book.setArchived",
          bookId: command.bookId,
          archived: !command.archived
        },
        actionLabel: command.archived ? "Restore" : "Undo"
      };
    }
    case "part.create":
      return {
        title: "Part created",
        detail: `${command.title} · Saved to project`
      };
    case "part.rename": {
      const oldPart = findPart(before, command.bookId, command.partId);
      return {
        title: "Part renamed",
        detail: `${command.title} · Saved to project`,
        ...(oldPart === undefined
          ? {}
          : {
              inverse: {
                type: "part.rename" as const,
                bookId: command.bookId,
                partId: command.partId,
                title: oldPart.title
              },
              actionLabel: "Undo" as const
            })
      };
    }
    case "part.update": {
      const oldPart = findPart(before, command.bookId, command.partId);
      const newPart = findPart(after, command.bookId, command.partId);
      return {
        title:
          command.title !== undefined && command.summary === undefined
            ? "Part renamed"
            : "Part updated",
        detail: `${newPart?.title ?? oldPart?.title ?? "Part"} · Saved to project`,
        ...(oldPart === undefined
          ? {}
          : {
              inverse: {
                type: "part.update" as const,
                bookId: command.bookId,
                partId: command.partId,
                ...(command.title === undefined
                  ? {}
                  : { title: oldPart.title }),
                ...(command.summary === undefined
                  ? {}
                  : { summary: oldPart.summary ?? null })
              },
              actionLabel: "Undo" as const
            })
      };
    }
    case "part.reorder":
      return {
        title: "Part order updated",
        detail: "Canonical manuscript order · Saved to project",
        inverse: {
          type: "part.reorder",
          bookId: command.bookId,
          partIds:
            findBook(before, command.bookId)?.parts.map((part) => part.id) ?? []
        },
        actionLabel: "Undo"
      };
    case "part.removeEmpty":
      return {
        title: "Empty part removed",
        detail: "No scenes or prose were removed · Saved to project"
      };
    case "chapter.create":
      return {
        title: "Chapter created",
        detail: `${command.title} · Saved to project`
      };
    case "chapter.rename": {
      const oldChapter = findChapter(
        before,
        command.bookId,
        command.partId,
        command.chapterId
      );
      return {
        title: "Chapter renamed",
        detail: `${command.title} · Saved to project`,
        ...(oldChapter === undefined
          ? {}
          : {
              inverse: {
                type: "chapter.rename" as const,
                bookId: command.bookId,
                partId: command.partId,
                chapterId: command.chapterId,
                title: oldChapter.title
              },
              actionLabel: "Undo" as const
            })
      };
    }
    case "chapter.update": {
      const oldChapter = findChapter(
        before,
        command.bookId,
        command.partId,
        command.chapterId
      );
      const newChapter = findChapter(
        after,
        command.bookId,
        command.partId,
        command.chapterId
      );
      return {
        title:
          command.title !== undefined && command.summary === undefined
            ? "Chapter renamed"
            : "Chapter updated",
        detail: `${newChapter?.title ?? oldChapter?.title ?? "Chapter"} · Saved to project`,
        ...(oldChapter === undefined
          ? {}
          : {
              inverse: {
                type: "chapter.update" as const,
                bookId: command.bookId,
                partId: command.partId,
                chapterId: command.chapterId,
                ...(command.title === undefined
                  ? {}
                  : { title: oldChapter.title }),
                ...(command.summary === undefined
                  ? {}
                  : { summary: oldChapter.summary ?? null })
              },
              actionLabel: "Undo" as const
            })
      };
    }
    case "chapter.reorder":
      return {
        title: "Chapter order updated",
        detail: "Canonical manuscript order · Saved to project",
        inverse: {
          type: "chapter.reorder",
          bookId: command.bookId,
          partId: command.partId,
          chapterIds:
            findPart(before, command.bookId, command.partId)?.chapters.map(
              (chapter) => chapter.id
            ) ?? []
        },
        actionLabel: "Undo"
      };
    case "chapter.removeEmpty":
      return {
        title: "Empty chapter removed",
        detail: "No scenes or prose were removed · Saved to project"
      };
    case "scene.create":
      return {
        title: "Scene created",
        detail: `${command.title} · Saved to project`
      };
    case "scene.update": {
      const oldScene = locateScene(before, command.sceneId)?.scene;
      const newScene = locateScene(after, command.sceneId)?.scene;
      const changedFields = [
        command.title === undefined ? undefined : "title",
        command.status === undefined ? undefined : "status",
        command.summary === undefined ? undefined : "summary",
        command.povStoryKnowledgeId === undefined ? undefined : "POV",
        command.backdrop === undefined ? undefined : "backdrop",
        command.music === undefined ? undefined : "music",
        command.imageRefs === undefined ? undefined : "images"
      ].filter((field): field is string => field !== undefined);
      return {
        title:
          changedFields.length === 1 && changedFields[0] === "title"
            ? "Scene renamed"
            : changedFields.length === 1 && changedFields[0] === "status"
              ? "Scene status updated"
              : "Scene metadata updated",
        detail: `${newScene?.title ?? oldScene?.title ?? "Scene"} · Saved to project`,
        ...(oldScene === undefined
          ? {}
          : {
              inverse: {
                type: "scene.update" as const,
                sceneId: command.sceneId,
                ...(command.title === undefined
                  ? {}
                  : { title: oldScene.title }),
                ...(command.status === undefined
                  ? {}
                  : { status: oldScene.status }),
                ...(command.summary === undefined
                  ? {}
                  : { summary: oldScene.summary ?? null }),
                ...(command.povStoryKnowledgeId === undefined
                  ? {}
                  : {
                      povStoryKnowledgeId:
                        oldScene.povStoryKnowledgeId ?? null
                    }),
                ...(command.backdrop === undefined
                  ? {}
                  : { backdrop: oldScene.backdrop ?? null }),
                ...(command.music === undefined
                  ? {}
                  : { music: oldScene.music ?? null }),
                ...(command.imageRefs === undefined
                  ? {}
                  : { imageRefs: oldScene.imageRefs ?? null })
              },
              actionLabel: "Undo" as const
            })
      };
    }
    case "scene.move": {
      const oldPlacement = locateScene(before, command.sceneId);
      const newPlacement = locateScene(after, command.sceneId);
      return {
        title:
          oldPlacement?.chapter?.id === newPlacement?.chapter?.id &&
          oldPlacement?.book.id === newPlacement?.book.id
            ? "Scene reordered"
            : "Scene moved",
        detail: `${newPlacement?.scene.title ?? oldPlacement?.scene.title ?? "Scene"} → ${sceneDestination(
          newPlacement
        )} · Saved to project`,
        ...(oldPlacement === undefined
          ? {}
          : {
              inverse: {
                type: "scene.move" as const,
                sceneId: command.sceneId,
                bookId: oldPlacement.book.id,
                ...(oldPlacement.chapter === undefined
                  ? {}
                  : { chapterId: oldPlacement.chapter.id }),
                position: oldPlacement.position
              },
              actionLabel: "Undo" as const
            })
      };
    }
    case "scene.setArchived": {
      const scene =
        locateScene(after, command.sceneId)?.scene ??
        locateScene(before, command.sceneId)?.scene;
      return {
        title: command.archived ? "Scene archived" : "Scene restored",
        detail: `${scene?.title ?? "Scene"} · Saved to project`,
        inverse: {
          type: "scene.setArchived",
          sceneId: command.sceneId,
          archived: !command.archived
        },
        actionLabel: command.archived ? "Restore" : "Undo"
      };
    }
    case "storyKnowledge.create":
      return {
        title: "Story record created",
        detail: `${command.label} · Saved to project`
      };
    case "storyKnowledge.update": {
      const oldKnowledge = findKnowledge(before, command.storyKnowledgeId);
      const newKnowledge = findKnowledge(after, command.storyKnowledgeId);
      return {
        title:
          command.label !== undefined &&
          command.kind === undefined &&
          command.authority === undefined &&
          command.notes === undefined &&
          command.aliases === undefined
            ? "Story record renamed"
            : "Story record updated",
        detail: `${newKnowledge?.label ?? oldKnowledge?.label ?? "Story record"} · Saved to project`,
        ...(oldKnowledge === undefined
          ? {}
          : {
              inverse: {
                type: "storyKnowledge.update" as const,
                storyKnowledgeId: command.storyKnowledgeId,
                ...(command.label === undefined
                  ? {}
                  : { label: oldKnowledge.label }),
                ...(command.kind === undefined
                  ? {}
                  : { kind: oldKnowledge.kind }),
                ...(command.authority === undefined
                  ? {}
                  : { authority: oldKnowledge.authority }),
                ...(command.notes === undefined
                  ? {}
                  : { notes: oldKnowledge.notes ?? null }),
                ...(command.aliases === undefined
                  ? {}
                  : { aliases: oldKnowledge.aliases ?? null })
              },
              actionLabel: "Undo" as const
            })
      };
    }
    case "storyKnowledge.setSceneLink": {
      const knowledge =
        findKnowledge(after, command.storyKnowledgeId) ??
        findKnowledge(before, command.storyKnowledgeId);
      const scene =
        locateScene(after, command.sceneId)?.scene ??
        locateScene(before, command.sceneId)?.scene;
      return {
        title: command.linked ? "Story link added" : "Story link removed",
        detail: `${knowledge?.label ?? "Story record"} ↔ ${
          scene?.title ?? "Scene"
        } · Saved to project`,
        inverse: {
          type: "storyKnowledge.setSceneLink",
          storyKnowledgeId: command.storyKnowledgeId,
          sceneId: command.sceneId,
          linked: !command.linked
        },
        actionLabel: "Undo"
      };
    }
    case "storyKnowledge.setKnowledgeLink": {
      const from =
        findKnowledge(after, command.fromId) ??
        findKnowledge(before, command.fromId);
      const to =
        findKnowledge(after, command.toId) ?? findKnowledge(before, command.toId);
      return {
        title: command.linked
          ? "Knowledge link added"
          : "Knowledge link removed",
        detail: `${from?.label ?? "Story record"} → ${
          to?.label ?? "Story record"
        } (${command.kind}) · Saved to project`,
        inverse: {
          type: "storyKnowledge.setKnowledgeLink",
          fromId: command.fromId,
          toId: command.toId,
          kind: command.kind,
          linked: !command.linked
        },
        actionLabel: "Undo"
      };
    }
    case "storyKnowledge.setArchived": {
      const knowledge =
        findKnowledge(after, command.storyKnowledgeId) ??
        findKnowledge(before, command.storyKnowledgeId);
      return {
        title: command.archived
          ? "Story record archived"
          : "Story record restored",
        detail: `${knowledge?.label ?? "Story record"} · Saved to project`,
        inverse: {
          type: "storyKnowledge.setArchived",
          storyKnowledgeId: command.storyKnowledgeId,
          archived: !command.archived
        },
        actionLabel: command.archived ? "Restore" : "Undo"
      };
    }
  }
}

export function acknowledgementForCanvasCommand(
  command: CanvasCommand
): CanvasCommandAcknowledgement {
  switch (command.type) {
    case "canvas.object.create":
      return {
        title:
          command.object.kind === "note"
            ? "Canvas note created"
            : command.object.kind === "region"
              ? "Canvas region created"
              : command.object.kind === "image-reference"
                ? "Image reference created"
                : "Canvas object created",
        detail: `${command.object.label} · Saved to Canvas`,
        actionLabel: "Undo"
      };
    case "canvas.object.place":
      return {
        title:
          command.object.kind === "scene-card"
            ? "Scene placed on Canvas"
            : command.object.kind === "story-knowledge-card"
              ? "Story record placed on Canvas"
              : "Canvas object placed",
        detail: `${command.object.label} · Saved to Canvas`,
        actionLabel: "Undo"
      };
    case "canvas.object.update":
      return {
        title: "Canvas object updated",
        detail: "Object details · Saved to Canvas",
        actionLabel: "Undo"
      };
    case "canvas.object.move":
      return {
        title: "Canvas object moved",
        detail: "Spatial position · Saved to Canvas",
        actionLabel: "Undo"
      };
    case "canvas.object.resize":
      return {
        title: "Canvas object resized",
        detail: "Object dimensions · Saved to Canvas",
        actionLabel: "Undo"
      };
    case "canvas.object.setScopePlacement":
      return {
        title: "Canvas scope placement saved",
        detail:
          command.scopeKind === "project"
            ? "Project layout · Saved to Canvas"
            : command.scopeKind === "chapter"
              ? "Chapter layout · Saved to Canvas"
              : "Scene layout · Saved to Canvas",
        actionLabel: "Undo"
      };
    case "canvas.object.archive":
      return {
        title: "Canvas object archived",
        detail: "Saved to Canvas",
        actionLabel: "Undo"
      };
    case "canvas.object.restore":
      return {
        title: "Canvas object restored",
        detail: "Saved to Canvas",
        actionLabel: "Undo"
      };
    case "canvas.object.confirm":
      return {
        title: "Canvas object confirmed",
        detail: "Writer authority · Saved to Canvas",
        actionLabel: "Undo"
      };
    case "canvas.object.dismiss":
      return {
        title: "Provisional object dismissed",
        detail: "Review decision · Saved to Canvas",
        actionLabel: "Undo"
      };
    case "canvas.link.create":
      return {
        title:
          command.link.authority === "confirmed"
            ? "Relationship linked"
            : "Provisional relationship added",
        detail: `${titleCase(command.link.kind)} relationship · Saved to Canvas`,
        actionLabel: "Undo"
      };
    case "canvas.link.update":
      return {
        title: "Relationship updated",
        detail: "Link details · Saved to Canvas",
        actionLabel: "Undo"
      };
    case "canvas.link.archive":
      return {
        title: "Relationship archived",
        detail: "Saved to Canvas",
        actionLabel: "Undo"
      };
    case "canvas.link.restore":
      return {
        title: "Relationship restored",
        detail: "Saved to Canvas",
        actionLabel: "Undo"
      };
    case "canvas.link.confirm":
      return {
        title: "Relationship confirmed",
        detail: "Writer authority · Saved to Canvas",
        actionLabel: "Undo"
      };
    case "canvas.link.dismiss":
      return {
        title: "Provisional relationship dismissed",
        detail: "Review decision · Saved to Canvas",
        actionLabel: "Undo"
      };
  }
}

function titleCase(value: string): string {
  return value
    .split("-")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

export function acknowledgementToast(input: Readonly<{
  id: string;
  title: string;
  detail: string;
  now: number;
  actionLabel?: string;
}>): AcknowledgementToast {
  return {
    id: input.id,
    title: input.title,
    detail: input.detail,
    tone: "success",
    createdAt: input.now,
    expiresAt:
      input.now +
      (input.actionLabel === undefined
        ? TOAST_SUCCESS_DURATION_MS
        : SAFE_UNDO_DURATION_MS),
    ...(input.actionLabel === undefined
      ? {}
      : { actionLabel: input.actionLabel }),
    dismissible: true
  };
}

export function problemToast(input: Readonly<{
  id: string;
  title: string;
  detail: string;
  now: number;
  tone?: "warning" | "error";
  actionLabel?: string;
  dismissible?: boolean;
}>): AcknowledgementToast {
  return {
    id: input.id,
    title: input.title,
    detail: input.detail,
    tone: input.tone ?? "warning",
    createdAt: input.now,
    sticky: true,
    ...(input.actionLabel === undefined
      ? {}
      : { actionLabel: input.actionLabel }),
    ...(input.dismissible === undefined
      ? {}
      : { dismissible: input.dismissible })
  };
}

export function toastReducer(
  state: readonly AcknowledgementToast[],
  event: ToastReducerEvent
): readonly AcknowledgementToast[] {
  switch (event.type) {
    case "clear":
      return [];
    case "push": {
      const next = [
        ...state.filter((toast) => toast.id !== event.toast.id),
        event.toast
      ];
      while (next.length > TOAST_VISIBLE_LIMIT) {
        const removable = next.findIndex((toast) => toast.sticky !== true);
        next.splice(removable < 0 ? 0 : removable, 1);
      }
      return next;
    }
    case "dismiss":
      return state.filter((toast) => toast.id !== event.id);
    case "tick":
      return state.filter(
        (toast) =>
          toast.expiresAt === undefined || toast.expiresAt > event.now
      );
    case "pause":
      return state.map((toast) =>
        toast.id !== event.id || toast.expiresAt === undefined
          ? toast
          : {
              ...toast,
              expiresAt: undefined,
              pausedRemainingMs: Math.max(0, toast.expiresAt - event.now)
            }
      );
    case "resume":
      return state.map((toast) =>
        toast.id !== event.id || toast.pausedRemainingMs === undefined
          ? toast
          : {
              ...toast,
              expiresAt: event.now + toast.pausedRemainingMs,
              pausedRemainingMs: undefined
            }
      );
    case "expireAction":
      return state.map((toast) =>
        toast.id === event.id
          ? { ...toast, actionLabel: undefined }
          : toast
      );
  }
}

export function shouldShowDraftAcknowledgement(
  lastShownAt: number | undefined,
  now: number,
  suppressionMs = DRAFT_ACKNOWLEDGEMENT_SUPPRESSION_MS
): boolean {
  return lastShownAt === undefined || now - lastShownAt >= suppressionMs;
}
