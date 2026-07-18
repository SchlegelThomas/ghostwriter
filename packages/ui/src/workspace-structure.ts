import type {
  ProjectNavigator,
  ProjectNavigatorScene
} from "@ghostwriter/core";
import {
  resolveManuscriptSelection,
  type ManuscriptSelection
} from "./manuscript-selection.js";

export type StoryTrailItem = Readonly<{
  label: string;
  selection: ManuscriptSelection;
}>;

export type QuickBuildKind =
  | "book"
  | "part"
  | "chapter"
  | "scene"
  | "story-record";

export type QuickBuildOption = Readonly<{
  id: string;
  kind: QuickBuildKind;
  label: string;
  detail: string;
  parent: ManuscriptSelection;
}>;

export type StructureLaunchpadProjection = Readonly<{
  eyebrow: string;
  title: string;
  description: string;
  scenes: readonly ProjectNavigatorScene[];
  moveCandidateCount: number;
  storyboardChapter?: Extract<ManuscriptSelection, { kind: "chapter" }>;
}>;

function option(
  kind: QuickBuildKind,
  label: string,
  detail: string,
  parent: ManuscriptSelection
): QuickBuildOption {
  return {
    id: `${kind}:${JSON.stringify(parent)}`,
    kind,
    label,
    detail,
    parent
  };
}

function activeScenes(project: ProjectNavigator): ProjectNavigatorScene[] {
  return project.books.flatMap((book) => [
    ...book.parts.flatMap((part) =>
      part.chapters.flatMap((chapter) => chapter.scenes)
    ),
    ...book.unassignedScenes
  ]).filter((scene) => scene.archivedAt === undefined);
}

export function storyTrail(
  project: ProjectNavigator,
  selection: ManuscriptSelection
): readonly StoryTrailItem[] {
  const projectItem: StoryTrailItem = {
    label: project.title,
    selection: { kind: "project" }
  };
  const resolved = resolveManuscriptSelection(project, selection);
  if (resolved === undefined || selection.kind === "project") return [projectItem];

  if (
    selection.kind === "storyKnowledgeRoot" ||
    selection.kind === "storyKnowledge"
  ) {
    const root: StoryTrailItem = {
      label: "Story knowledge",
      selection: { kind: "storyKnowledgeRoot" }
    };
    return selection.kind === "storyKnowledge" &&
      resolved.knowledge !== undefined
      ? [
          projectItem,
          root,
          { label: resolved.knowledge.label, selection }
        ]
      : [projectItem, root];
  }

  if (resolved.book === undefined) return [projectItem];
  const items: StoryTrailItem[] = [
    projectItem,
    {
      label: resolved.book.title,
      selection: { kind: "book", bookId: resolved.book.id }
    }
  ];

  if (selection.kind === "book") return items;
  if (selection.kind === "unassigned") {
    return [...items, { label: "Unassigned", selection }];
  }
  if (selection.kind === "scene" && selection.chapterId === undefined) {
    return [
      ...items,
      {
        label: "Unassigned",
        selection: { kind: "unassigned", bookId: selection.bookId }
      },
      { label: resolved.scene?.title ?? "Scene", selection }
    ];
  }

  if (resolved.part === undefined) return items;
  items.push({
    label: resolved.part.title,
    selection: {
      kind: "part",
      bookId: resolved.book.id,
      partId: resolved.part.id
    }
  });
  if (selection.kind === "part") return items;

  if (resolved.chapter === undefined) return items;
  items.push({
    label: resolved.chapter.title,
    selection: {
      kind: "chapter",
      bookId: resolved.book.id,
      partId: resolved.part.id,
      chapterId: resolved.chapter.id
    }
  });
  if (selection.kind === "chapter") return items;

  return [
    ...items,
    { label: resolved.scene?.title ?? "Scene", selection }
  ];
}

export function quickBuildOptions(
  project: ProjectNavigator,
  selection: ManuscriptSelection
): readonly QuickBuildOption[] {
  if (project.archivedAt !== undefined) return [];
  const resolved = resolveManuscriptSelection(project, selection);
  if (resolved === undefined) return [];
  if (
    resolved.book?.archivedAt !== undefined ||
    resolved.scene?.archivedAt !== undefined ||
    resolved.knowledge?.archivedAt !== undefined
  ) {
    return [];
  }

  switch (selection.kind) {
    case "project":
      return [
        option("book", "New book", `Add a book to ${project.title}`, selection),
        option(
          "story-record",
          "New story record",
          "Add a character, place, rule, thread, or custom record",
          { kind: "storyKnowledgeRoot" }
        )
      ];
    case "book":
      return [
        option(
          "part",
          "New part",
          `Add a part to ${resolved.book?.title ?? "this book"}`,
          selection
        ),
        option(
          "scene",
          "New unassigned scene",
          `Capture a scene in ${resolved.book?.title ?? "this book"}`,
          { kind: "unassigned", bookId: selection.bookId }
        )
      ];
    case "part":
      return [
        option(
          "chapter",
          "New chapter",
          `Add a chapter to ${resolved.part?.title ?? "this part"}`,
          selection
        )
      ];
    case "chapter":
      return [
        option(
          "scene",
          "New scene",
          `Add a scene to ${resolved.chapter?.title ?? "this chapter"}`,
          selection
        )
      ];
    case "unassigned":
      return [
        option(
          "scene",
          "New unassigned scene",
          `Capture a scene in ${resolved.book?.title ?? "this book"}`,
          selection
        )
      ];
    case "scene": {
      const parent: ManuscriptSelection =
        selection.chapterId === undefined || selection.partId === undefined
          ? { kind: "unassigned", bookId: selection.bookId }
          : {
              kind: "chapter",
              bookId: selection.bookId,
              partId: selection.partId,
              chapterId: selection.chapterId
            };
      return [
        option(
          "scene",
          "New scene in this folder",
          "Append a sibling scene to the selected scene’s folder",
          parent
        )
      ];
    }
    case "storyKnowledgeRoot":
    case "storyKnowledge":
      return [
        option(
          "story-record",
          "New story record",
          "Add a character, place, rule, thread, or custom record",
          { kind: "storyKnowledgeRoot" }
        )
      ];
  }
}

export function structureLaunchpad(
  project: ProjectNavigator,
  selection: ManuscriptSelection
): StructureLaunchpadProjection | undefined {
  const resolved = resolveManuscriptSelection(project, selection);
  if (resolved === undefined || selection.kind === "scene") return undefined;
  const allActiveScenes = activeScenes(project);

  switch (selection.kind) {
    case "project":
      return {
        eyebrow: "Project structure",
        title: project.title,
        description: `${project.totals.books} ${
          project.totals.books === 1 ? "book" : "books"
        } · ${project.totals.scenes} ${
          project.totals.scenes === 1 ? "scene" : "scenes"
        } · ${project.totals.storyKnowledge} story records`,
        scenes: [],
        moveCandidateCount: 0
      };
    case "book":
      return {
        eyebrow: `Book · ${resolved.book?.status ?? "planned"}`,
        title: resolved.book?.title ?? "Book",
        description: `${resolved.book?.parts.length ?? 0} parts · ${
          resolved.book?.sceneCount ?? 0
        } scenes. Build the manuscript here or capture an unassigned scene.`,
        scenes: resolved.book?.unassignedScenes.filter(
          (scene) => scene.archivedAt === undefined
        ) ?? [],
        moveCandidateCount: 0
      };
    case "part":
      return {
        eyebrow: "Part",
        title: resolved.part?.title ?? "Part",
        description: `${resolved.part?.chapters.length ?? 0} ${
          resolved.part?.chapters.length === 1 ? "chapter" : "chapters"
        }. Add the next chapter folder when the structure is ready.`,
        scenes: [],
        moveCandidateCount: 0
      };
    case "chapter": {
      const scenes =
        resolved.chapter?.scenes.filter(
          (scene) => scene.archivedAt === undefined
        ) ?? [];
      return {
        eyebrow:
          scenes.length === 0
            ? "Empty chapter · ready to shape"
            : `Chapter folder · ${scenes.length} ${
                scenes.length === 1 ? "scene" : "scenes"
              }`,
        title: resolved.chapter?.title ?? "Chapter",
        description:
          resolved.chapter?.summary ??
          (scenes.length === 0
            ? "Start with prose, move an existing scene here, or storyboard this chapter on Canvas."
            : "Choose a scene to write, create the next one, or open this chapter on Canvas."),
        scenes,
        moveCandidateCount: Math.max(0, allActiveScenes.length - scenes.length),
        storyboardChapter: selection
      };
    }
    case "unassigned": {
      const scenes =
        resolved.book?.unassignedScenes.filter(
          (scene) => scene.archivedAt === undefined
        ) ?? [];
      return {
        eyebrow: `Unassigned scenes · ${resolved.book?.title ?? "Book"}`,
        title: scenes.length === 0 ? "No loose scenes" : "Ideas waiting for a chapter",
        description:
          scenes.length === 0
            ? "Capture a scene now, then place it in the manuscript when its chapter becomes clear."
            : "Open a scene to write or move it into the chapter where it belongs.",
        scenes,
        moveCandidateCount: Math.max(0, allActiveScenes.length - scenes.length)
      };
    }
    case "storyKnowledgeRoot":
      return {
        eyebrow: "Story knowledge",
        title: "The story behind the manuscript",
        description: `${project.storyKnowledge.length} ${
          project.storyKnowledge.length === 1 ? "record" : "records"
        }. Capture characters, places, rules, and threads without interrupting Draft.`,
        scenes: [],
        moveCandidateCount: 0
      };
    case "storyKnowledge":
      return {
        eyebrow: `${resolved.knowledge?.kind ?? "Story record"} · ${
          resolved.knowledge?.authority ?? "planned"
        }`,
        title: resolved.knowledge?.label ?? "Story record",
        description:
          resolved.knowledge?.notes ??
          `${resolved.knowledge?.linkedSceneCount ?? 0} linked scenes · ${
            resolved.knowledge?.linkedKnowledge.length ?? 0
          } linked story records`,
        scenes: [],
        moveCandidateCount: 0
      };
  }
}
