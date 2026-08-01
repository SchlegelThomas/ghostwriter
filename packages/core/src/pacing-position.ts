import type {
  ProjectNavigator,
  ProjectNavigatorScene
} from "./project-navigator.js";

export type EqualWeightScenePercent = Readonly<{
  sceneId: string;
  title: string;
  index: number;
  startPct: number;
  midPct: number;
  endPct: number;
}>;

export const PACING_TURN_BANDS = Object.freeze([
  Object.freeze({ id: "catalyst", targetPct: 10, bandLow: 8, bandHigh: 12 }),
  Object.freeze({
    id: "commitment",
    targetPct: 22.5,
    bandLow: 20,
    bandHigh: 25
  }),
  Object.freeze({ id: "midpoint", targetPct: 50, bandLow: 45, bandHigh: 55 }),
  Object.freeze({ id: "low-point", targetPct: 75, bandLow: 72, bandHigh: 78 }),
  Object.freeze({
    id: "final-movement",
    targetPct: 82.5,
    bandLow: 80,
    bandHigh: 85
  })
] as const);

export type PacingTurnBand = (typeof PACING_TURN_BANDS)[number];

export function manuscriptOrderedScenes(
  navigator: ProjectNavigator
): readonly ProjectNavigatorScene[] {
  return Object.freeze(
    navigator.books.flatMap((book) => [
      ...book.parts.flatMap((part) =>
        part.chapters.flatMap((chapter) => chapter.scenes)
      ),
      ...book.unassignedScenes
    ])
  );
}

export function equalWeightScenePercents(
  scenes: readonly Readonly<{ id: string; title: string }>[]
): readonly EqualWeightScenePercent[] {
  if (scenes.length === 0) return Object.freeze([]);
  return Object.freeze(
    scenes.map((scene, index) =>
      Object.freeze({
        sceneId: scene.id,
        title: scene.title,
        index,
        startPct: (index / scenes.length) * 100,
        midPct: ((index + 0.5) / scenes.length) * 100,
        endPct: ((index + 1) / scenes.length) * 100
      })
    )
  );
}

export function assignTurnsToNearestScenes(
  turns: readonly PacingTurnBand[],
  percents: readonly EqualWeightScenePercent[]
): readonly Readonly<{
  id: PacingTurnBand["id"];
  targetPct: number;
  bandLow: number;
  bandHigh: number;
  scene?: EqualWeightScenePercent;
}>[] {
  return Object.freeze(
    turns.map((turn) => {
      const scene = percents.reduce<EqualWeightScenePercent | undefined>(
        (nearest, candidate) =>
          nearest === undefined ||
          Math.abs(candidate.midPct - turn.targetPct) <
            Math.abs(nearest.midPct - turn.targetPct)
            ? candidate
            : nearest,
        undefined
      );
      return Object.freeze({
        id: turn.id,
        targetPct: turn.targetPct,
        bandLow: turn.bandLow,
        bandHigh: turn.bandHigh,
        ...(scene === undefined ? {} : { scene })
      });
    })
  );
}
