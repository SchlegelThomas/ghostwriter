import type {
  ProjectNavigator,
  ProjectNavigatorKnowledge,
  ProjectNavigatorScene,
  SceneId
} from "@ghostwriter/core";
import {
  resolveManuscriptSelection,
  type ManuscriptSelection
} from "./manuscript-selection.js";

export type StoryTrailRole =
  | "Project"
  | "Book"
  | "Part"
  | "Chapter"
  | "Scene"
  | "Unassigned"
  | "Knowledge"
  | "Record";

export type StoryTrailItem = Readonly<{
  role: StoryTrailRole;
  label: string;
  selection: ManuscriptSelection;
}>;

export function storyTrailRole(
  selection: ManuscriptSelection
): StoryTrailRole {
  switch (selection.kind) {
    case "project":
      return "Project";
    case "book":
      return "Book";
    case "part":
      return "Part";
    case "chapter":
      return "Chapter";
    case "scene":
      return "Scene";
    case "unassigned":
      return "Unassigned";
    case "storyKnowledgeRoot":
      return "Knowledge";
    case "storyKnowledge":
      return "Record";
  }
}

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

export type LaunchpadEntryKind =
  | "book"
  | "part"
  | "chapter"
  | "scene"
  | "unassigned"
  | "character"
  | "story-record";

/** Browsable child rows for structure launchpads (open / edit / read). */
export type LaunchpadEntry = Readonly<{
  id: string;
  kind: LaunchpadEntryKind;
  title: string;
  description?: string;
  meta: string;
  selection: ManuscriptSelection;
  sceneId?: SceneId;
}>;

export type LaunchpadCharacter = Readonly<{
  id: string;
  label: string;
  description?: string;
  linkedSceneCount: number;
  linkedRecordCount: number;
  desire?: string;
  selection: Extract<ManuscriptSelection, { kind: "storyKnowledge" }>;
}>;

export type StructureLaunchpadProjection = Readonly<{
  eyebrow: string;
  title: string;
  description: string;
  scenes: readonly ProjectNavigatorScene[];
  entries: readonly LaunchpadEntry[];
  characters: readonly LaunchpadCharacter[];
  moveCandidateCount: number;
  storyboardChapter?: Extract<ManuscriptSelection, { kind: "chapter" }>;
}>;

export type SceneTimelineItem = Readonly<{
  sceneId: SceneId;
  title: string;
  index: number;
  total: number;
  status: string;
  selection: Extract<ManuscriptSelection, { kind: "scene" }>;
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
  return project.books
    .flatMap((book) => [
      ...book.parts.flatMap((part) =>
        part.chapters.flatMap((chapter) => chapter.scenes)
      ),
      ...book.unassignedScenes
    ])
    .filter((scene) => scene.archivedAt === undefined);
}

function characterRecords(
  project: ProjectNavigator
): readonly ProjectNavigatorKnowledge[] {
  return project.storyKnowledge.filter(
    (record) =>
      record.archivedAt === undefined && record.kind === "character"
  );
}

function toLaunchpadCharacter(
  record: ProjectNavigatorKnowledge
): LaunchpadCharacter {
  return {
    id: record.id,
    label: record.label,
    ...(record.notes === undefined ? {} : { description: record.notes }),
    linkedSceneCount: record.linkedSceneCount,
    linkedRecordCount: record.linkedKnowledge.length,
    ...(record.characterSheet?.desire === undefined
      ? {}
      : { desire: record.characterSheet.desire }),
    selection: { kind: "storyKnowledge", storyKnowledgeId: record.id }
  };
}

function charactersForScenes(
  project: ProjectNavigator,
  sceneIds: ReadonlySet<string>
): readonly LaunchpadCharacter[] {
  return characterRecords(project)
    .filter((record) =>
      record.linkedSceneIds.some((sceneId) => sceneIds.has(sceneId))
    )
    .map(toLaunchpadCharacter);
}

export function projectCharacterLaunchpad(
  project: ProjectNavigator
): StructureLaunchpadProjection {
  const characters = characterRecords(project).map(toLaunchpadCharacter);
  return {
    eyebrow: "Characters",
    title: "Cast & relationships",
    description:
      characters.length === 0
        ? "No characters yet. Add a character record, then link scenes and other knowledge."
        : `${characters.length} ${
            characters.length === 1 ? "character" : "characters"
          }. Open a sheet, jump to linked scenes, or place them on Canvas.`,
    scenes: [],
    entries: characters.map((character) => ({
      id: character.id,
      kind: "character" as const,
      title: character.label,
      ...(character.description === undefined
        ? {}
        : { description: character.description }),
      meta: `${character.linkedSceneCount} scenes · ${character.linkedRecordCount} links`,
      selection: character.selection
    })),
    characters,
    moveCandidateCount: 0
  };
}

function trailItem(
  label: string,
  selection: ManuscriptSelection
): StoryTrailItem {
  return {
    role: storyTrailRole(selection),
    label,
    selection
  };
}

export function storyTrail(
  project: ProjectNavigator,
  selection: ManuscriptSelection
): readonly StoryTrailItem[] {
  const projectItem = trailItem(project.title, { kind: "project" });
  const resolved = resolveManuscriptSelection(project, selection);
  if (resolved === undefined || selection.kind === "project") return [projectItem];

  if (
    selection.kind === "storyKnowledgeRoot" ||
    selection.kind === "storyKnowledge"
  ) {
    const root = trailItem("Story knowledge", {
      kind: "storyKnowledgeRoot"
    });
    return selection.kind === "storyKnowledge" &&
      resolved.knowledge !== undefined
      ? [
          projectItem,
          root,
          trailItem(resolved.knowledge.label, selection)
        ]
      : [projectItem, root];
  }

  if (resolved.book === undefined) return [projectItem];
  const items: StoryTrailItem[] = [
    projectItem,
    trailItem(resolved.book.title, {
      kind: "book",
      bookId: resolved.book.id
    })
  ];

  if (selection.kind === "book") return items;
  if (selection.kind === "unassigned") {
    return [...items, trailItem("Unassigned", selection)];
  }
  if (selection.kind === "scene" && selection.chapterId === undefined) {
    return [
      ...items,
      trailItem("Unassigned", {
        kind: "unassigned",
        bookId: selection.bookId
      }),
      trailItem(resolved.scene?.title ?? "Scene", selection)
    ];
  }

  if (resolved.part === undefined) return items;
  items.push(
    trailItem(resolved.part.title, {
      kind: "part",
      bookId: resolved.book.id,
      partId: resolved.part.id
    })
  );
  if (selection.kind === "part") return items;

  if (resolved.chapter === undefined) return items;
  items.push(
    trailItem(resolved.chapter.title, {
      kind: "chapter",
      bookId: resolved.book.id,
      partId: resolved.part.id,
      chapterId: resolved.chapter.id
    })
  );
  if (selection.kind === "chapter") return items;

  return [
    ...items,
    trailItem(resolved.scene?.title ?? "Scene", selection)
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

/**
 * Sibling scene timeline for the selected scene — replaces prev/next chrome.
 */
export function sceneTimeline(
  project: ProjectNavigator,
  selection: ManuscriptSelection
): readonly SceneTimelineItem[] {
  if (selection.kind !== "scene") return [];
  const resolved = resolveManuscriptSelection(project, selection);
  if (resolved?.book === undefined || resolved.scene === undefined) return [];

  const siblings: ProjectNavigatorScene[] =
    resolved.chapter !== undefined
      ? resolved.chapter.scenes.filter((scene) => scene.archivedAt === undefined)
      : resolved.book.unassignedScenes.filter(
          (scene) => scene.archivedAt === undefined
        );

  return siblings.map((scene, index) => ({
    sceneId: scene.id,
    title: scene.title,
    index: index + 1,
    total: siblings.length,
    status: scene.status,
    selection: {
      kind: "scene" as const,
      bookId: selection.bookId,
      ...(selection.partId === undefined ? {} : { partId: selection.partId }),
      ...(selection.chapterId === undefined
        ? {}
        : { chapterId: selection.chapterId }),
      sceneId: scene.id
    }
  }));
}

export function structureLaunchpad(
  project: ProjectNavigator,
  selection: ManuscriptSelection
): StructureLaunchpadProjection | undefined {
  const resolved = resolveManuscriptSelection(project, selection);
  if (resolved === undefined || selection.kind === "scene") return undefined;
  const allActiveScenes = activeScenes(project);

  switch (selection.kind) {
    case "project": {
      const books = project.books.filter((book) => book.archivedAt === undefined);
      return {
        eyebrow: "Project structure",
        title: project.title,
        description: `${project.totals.books} ${
          project.totals.books === 1 ? "book" : "books"
        } · ${project.totals.scenes} ${
          project.totals.scenes === 1 ? "scene" : "scenes"
        } · ${project.totals.storyKnowledge} story records`,
        scenes: [],
        entries: books.map((book) => ({
          id: book.id,
          kind: "book" as const,
          title: book.title,
          meta: `${book.parts.length} parts · ${book.sceneCount} scenes · ${book.status}`,
          selection: { kind: "book" as const, bookId: book.id }
        })),
        characters: characterRecords(project).map(toLaunchpadCharacter),
        moveCandidateCount: 0
      };
    }
    case "book": {
      const book = resolved.book;
      const parts = book?.parts ?? [];
      const unassigned =
        book?.unassignedScenes.filter(
          (scene) => scene.archivedAt === undefined
        ) ?? [];
      const sceneIds = new Set(
        [
          ...parts.flatMap((part) =>
            part.chapters.flatMap((chapter) =>
              chapter.scenes.map((scene) => scene.id)
            )
          ),
          ...unassigned.map((scene) => scene.id)
        ].map(String)
      );
      const entries: LaunchpadEntry[] = [
        ...parts.map((part) => ({
          id: part.id,
          kind: "part" as const,
          title: part.title,
          meta: `${part.chapters.length} ${
            part.chapters.length === 1 ? "chapter" : "chapters"
          }`,
          selection: {
            kind: "part" as const,
            bookId: selection.bookId,
            partId: part.id
          }
        })),
        ...(unassigned.length === 0
          ? []
          : [
              {
                id: `unassigned:${selection.bookId}`,
                kind: "unassigned" as const,
                title: "Unassigned scenes",
                meta: `${unassigned.length} ${
                  unassigned.length === 1 ? "scene" : "scenes"
                }`,
                selection: {
                  kind: "unassigned" as const,
                  bookId: selection.bookId
                }
              }
            ]),
        ...unassigned.map((scene) => ({
          id: scene.id,
          kind: "scene" as const,
          title: scene.title,
          ...(scene.summary === undefined
            ? {}
            : { description: scene.summary }),
          meta: `${scene.status} · open in Draft`,
          selection: {
            kind: "scene" as const,
            bookId: selection.bookId,
            sceneId: scene.id
          },
          sceneId: scene.id
        }))
      ];
      return {
        eyebrow: `Book · ${book?.status ?? "planned"}`,
        title: book?.title ?? "Book",
        description: `${parts.length} parts · ${
          book?.sceneCount ?? 0
        } scenes. Open a part or chapter, capture an unassigned scene, or review cast.`,
        scenes: unassigned,
        entries,
        characters: charactersForScenes(project, sceneIds),
        moveCandidateCount: 0
      };
    }
    case "part": {
      const chapters = resolved.part?.chapters ?? [];
      const sceneIds = new Set(
        chapters
          .flatMap((chapter) => chapter.scenes.map((scene) => scene.id))
          .map(String)
      );
      return {
        eyebrow: "Part",
        title: resolved.part?.title ?? "Part",
        description:
          resolved.part?.summary ??
          `${chapters.length} ${
            chapters.length === 1 ? "chapter" : "chapters"
          }. Open a chapter to write, edit structure, or read its scenes.`,
        scenes: [],
        entries: chapters.map((chapter) => {
          const active = chapter.scenes.filter(
            (scene) => scene.archivedAt === undefined
          );
          return {
            id: chapter.id,
            kind: "chapter" as const,
            title: chapter.title,
            ...(chapter.summary === undefined
              ? {}
              : { description: chapter.summary }),
            meta: `${active.length} ${
              active.length === 1 ? "scene" : "scenes"
            }`,
            selection: {
              kind: "chapter" as const,
              bookId: selection.bookId,
              partId: selection.partId,
              chapterId: chapter.id
            }
          };
        }),
        characters: charactersForScenes(project, sceneIds),
        moveCandidateCount: 0
      };
    }
    case "chapter": {
      const scenes =
        resolved.chapter?.scenes.filter(
          (scene) => scene.archivedAt === undefined
        ) ?? [];
      const sceneIds = new Set(scenes.map((scene) => String(scene.id)));
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
        entries: scenes.map((scene) => ({
          id: scene.id,
          kind: "scene" as const,
          title: scene.title,
          ...(scene.summary === undefined
            ? {}
            : { description: scene.summary }),
          meta: `${scene.status} · open in Draft`,
          selection: {
            kind: "scene" as const,
            bookId: selection.bookId,
            partId: selection.partId,
            chapterId: selection.chapterId,
            sceneId: scene.id
          },
          sceneId: scene.id
        })),
        characters: charactersForScenes(project, sceneIds),
        moveCandidateCount: Math.max(0, allActiveScenes.length - scenes.length),
        storyboardChapter: selection
      };
    }
    case "unassigned": {
      const scenes =
        resolved.book?.unassignedScenes.filter(
          (scene) => scene.archivedAt === undefined
        ) ?? [];
      const sceneIds = new Set(scenes.map((scene) => String(scene.id)));
      return {
        eyebrow: `Unassigned scenes · ${resolved.book?.title ?? "Book"}`,
        title: scenes.length === 0 ? "No loose scenes" : "Ideas waiting for a chapter",
        description:
          scenes.length === 0
            ? "Capture a scene now, then place it in the manuscript when its chapter becomes clear."
            : "Open a scene to write or move it into the chapter where it belongs.",
        scenes,
        entries: scenes.map((scene) => ({
          id: scene.id,
          kind: "scene" as const,
          title: scene.title,
          ...(scene.summary === undefined
            ? {}
            : { description: scene.summary }),
          meta: `${scene.status} · open in Draft`,
          selection: {
            kind: "scene" as const,
            bookId: selection.bookId,
            sceneId: scene.id
          },
          sceneId: scene.id
        })),
        characters: charactersForScenes(project, sceneIds),
        moveCandidateCount: Math.max(0, allActiveScenes.length - scenes.length)
      };
    }
    case "storyKnowledgeRoot": {
      const records = project.storyKnowledge.filter(
        (record) => record.archivedAt === undefined
      );
      const characters = characterRecords(project).map(toLaunchpadCharacter);
      return {
        eyebrow: "Story knowledge",
        title: "The story behind the manuscript",
        description: `${records.length} ${
          records.length === 1 ? "record" : "records"
        }. Capture characters, places, rules, and threads without interrupting Draft.`,
        scenes: [],
        entries: records.map((record) => ({
          id: record.id,
          kind:
            record.kind === "character"
              ? ("character" as const)
              : ("story-record" as const),
          title: record.label,
          ...(record.notes === undefined
            ? {}
            : { description: record.notes }),
          meta: `${record.kind} · ${record.linkedSceneCount} scenes · ${record.linkedKnowledge.length} links`,
          selection: {
            kind: "storyKnowledge" as const,
            storyKnowledgeId: record.id
          }
        })),
        characters,
        moveCandidateCount: 0
      };
    }
    case "storyKnowledge": {
      const knowledge = resolved.knowledge;
      const linkedScenes = allActiveScenes.filter((scene) =>
        knowledge?.linkedSceneIds.includes(scene.id)
      );
      return {
        eyebrow: `${knowledge?.kind ?? "Story record"} · ${
          knowledge?.authority ?? "planned"
        }`,
        title: knowledge?.label ?? "Story record",
        description:
          knowledge?.notes ??
          `${knowledge?.linkedSceneCount ?? 0} linked scenes · ${
            knowledge?.linkedKnowledge.length ?? 0
          } linked story records`,
        scenes: linkedScenes,
        entries: [
          ...linkedScenes.map((scene) => {
            const home = sceneSelectionForId(project, scene.id);
            return {
              id: scene.id,
              kind: "scene" as const,
              title: scene.title,
              ...(scene.summary === undefined
                ? {}
                : { description: scene.summary }),
              meta: `${scene.status} · linked scene`,
              selection: home,
              sceneId: scene.id
            };
          }),
          ...(knowledge?.linkedKnowledge ?? []).map((link) => {
            const target = project.storyKnowledge.find(
              (record) => record.id === link.toId
            );
            return {
              id: link.toId,
              kind:
                target?.kind === "character"
                  ? ("character" as const)
                  : ("story-record" as const),
              title: target?.label ?? String(link.toId),
              meta: `${link.kind} link`,
              selection: {
                kind: "storyKnowledge" as const,
                storyKnowledgeId: link.toId
              }
            };
          })
        ],
        characters:
          knowledge?.kind === "character"
            ? [toLaunchpadCharacter(knowledge)]
            : [],
        moveCandidateCount: 0
      };
    }
  }
}

function sceneSelectionForId(
  project: ProjectNavigator,
  sceneId: SceneId
): Extract<ManuscriptSelection, { kind: "scene" }> {
  for (const book of project.books) {
    for (const scene of book.unassignedScenes) {
      if (scene.id === sceneId) {
        return { kind: "scene", bookId: book.id, sceneId };
      }
    }
    for (const part of book.parts) {
      for (const chapter of part.chapters) {
        for (const scene of chapter.scenes) {
          if (scene.id === sceneId) {
            return {
              kind: "scene",
              bookId: book.id,
              partId: part.id,
              chapterId: chapter.id,
              sceneId
            };
          }
        }
      }
    }
  }
  // Fallback — caller only uses ids known to exist on the navigator.
  const book = project.books[0];
  return {
    kind: "scene",
    bookId: book?.id ?? ("book_unknown" as never),
    sceneId
  };
}
