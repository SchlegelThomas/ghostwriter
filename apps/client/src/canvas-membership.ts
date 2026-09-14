import type {
  CanvasObjectId,
  CanvasScopePlacement,
  ProjectNavigator
} from "@ghostwriter/core";
import type { CanvasDrillScope } from "@ghostwriter/ui";

export type CanvasMembershipDestination = Readonly<{
  key: string;
  label: string;
  scope: Extract<CanvasDrillScope, { kind: "chapter" | "scene" }>;
}>;

export type CanvasMembershipStatus = Readonly<{
  key: string;
  label: string;
  available: boolean;
  scopeKind: "chapter" | "scene";
  scopeId: string;
}>;

function allMembershipDestinations(
  project: ProjectNavigator,
  includeUnavailable: boolean
): readonly (CanvasMembershipDestination & Readonly<{ available: boolean }>)[] {
  return project.books.flatMap((book) => {
    const bookAvailable = book.archivedAt === undefined;
    const chapters = book.parts.flatMap((part) =>
      part.chapters.flatMap((chapter) => {
        const chapterDestination = {
          key: `chapter:${chapter.id}`,
          label: `Chapter · ${chapter.title} · ${book.title} › ${part.title}`,
          scope: {
            kind: "chapter" as const,
            bookId: book.id,
            partId: part.id,
            chapterId: chapter.id
          },
          available: bookAvailable
        };
        const scenes = chapter.scenes.map((scene) => ({
          key: `scene:${scene.id}`,
          label: `Scene · ${scene.title} · ${book.title} › ${part.title} › ${chapter.title}`,
          scope: {
            kind: "scene" as const,
            bookId: book.id,
            partId: part.id,
            chapterId: chapter.id,
            sceneId: scene.id
          },
          available: bookAvailable && scene.archivedAt === undefined
        }));
        return [chapterDestination, ...scenes];
      })
    );
    const unassigned = book.unassignedScenes.map((scene) => ({
      key: `scene:${scene.id}`,
      label: `Scene · ${scene.title} · ${book.title} › Unassigned`,
      scope: {
        kind: "scene" as const,
        bookId: book.id,
        sceneId: scene.id
      },
      available: bookAvailable && scene.archivedAt === undefined
    }));
    return [...chapters, ...unassigned].filter(
      (destination) => includeUnavailable || destination.available
    );
  });
}

export function canvasMembershipDestinations(
  project: ProjectNavigator,
  query: string,
  limit = 20
): readonly CanvasMembershipDestination[] {
  const needle = query.trim().toLocaleLowerCase();
  return allMembershipDestinations(project, false)
    .filter(
      (destination) =>
        needle.length === 0 ||
        destination.label.toLocaleLowerCase().includes(needle)
    )
    .slice(0, Math.max(1, limit));
}

export function canvasScopeTitle(
  project: ProjectNavigator,
  scope: CanvasDrillScope
): string {
  if (scope.kind === "project") return `Whole story · ${project.title}`;
  const destination = allMembershipDestinations(project, true).find(
    (candidate) => candidate.key === `${scope.kind}:${scope.kind === "chapter" ? scope.chapterId : scope.sceneId}`
  );
  if (destination !== undefined) {
    return destination.available
      ? destination.label
      : `Unavailable · ${destination.label}`;
  }
  return `${scope.kind === "chapter" ? "Unavailable chapter" : "Unavailable scene"} · ${
    scope.kind === "chapter" ? scope.chapterId : scope.sceneId
  }`;
}

export function canvasExplicitMemberships(
  project: ProjectNavigator,
  placements: readonly CanvasScopePlacement[],
  objectId: CanvasObjectId
): readonly CanvasMembershipStatus[] {
  const destinations = new Map(
    allMembershipDestinations(project, true).map((destination) => [
      destination.key,
      destination
    ])
  );
  return placements.flatMap((placement) => {
    if (
      placement.objectId !== objectId ||
      placement.membership !== "explicit" ||
      placement.scopeId === undefined ||
      (placement.scopeKind !== "chapter" && placement.scopeKind !== "scene")
    ) {
      return [];
    }
    const key = `${placement.scopeKind}:${placement.scopeId}`;
    const destination = destinations.get(key);
    return [
      {
        key,
        label:
          destination === undefined
            ? `Unavailable ${placement.scopeKind} · ${placement.scopeId}`
            : destination.available
              ? destination.label
              : `Unavailable · ${destination.label}`,
        available: destination?.available === true,
        scopeKind: placement.scopeKind,
        scopeId: placement.scopeId
      }
    ];
  });
}
