/**
 * Seed portrait metadata for the Harry Potter hermetic fixture.
 * PNG bytes live under packages/core/fixtures/harry-potter-visuals/.
 */
import {
  buildCharacterVisualLocatorUrl,
  buildCharacterVisualObjectKey
} from "./character-visual-images.js";
import type { CharacterVisual } from "./domain.js";

/** Keep in sync with HARRY_POTTER_FIXTURE_PROJECT_ID. */
const PROJECT_ID = "project-harry-potter-series";

const PORTRAIT_COUNT = 6;

export type HarryPotterCharacterVisualSeed = Readonly<{
  knowledgeId: string;
  label: string;
  /** Filename under packages/core/fixtures/harry-potter-visuals/ */
  filename: string;
  visual: CharacterVisual;
  objectKey: string;
}>;

function visualIdForPortraitIndex(index: number): string {
  return `visual-seed-portrait-${index}`;
}

function seedPortrait(
  knowledgeId: string,
  label: string,
  filename: string,
  portraitIndex: number
): HarryPotterCharacterVisualSeed {
  const visualId = visualIdForPortraitIndex(portraitIndex);
  const caption = `Seed portrait ${portraitIndex}`;
  return {
    knowledgeId,
    label,
    filename,
    objectKey: buildCharacterVisualObjectKey(PROJECT_ID, knowledgeId, visualId),
    visual: Object.freeze({
      id: visualId,
      url: buildCharacterVisualLocatorUrl(PROJECT_ID, knowledgeId, visualId),
      alt: label,
      caption,
      source: "upload" as const
    })
  };
}

function seedPortraitsForCharacter(
  knowledgeId: string,
  label: string,
  filename: string
): readonly HarryPotterCharacterVisualSeed[] {
  return Object.freeze(
    Array.from({ length: PORTRAIT_COUNT }, (_, i) =>
      seedPortrait(knowledgeId, label, filename, i + 1)
    )
  );
}

export const HARRY_POTTER_CHARACTER_VISUAL_SEEDS: readonly HarryPotterCharacterVisualSeed[] =
  Object.freeze([
    ...seedPortraitsForCharacter("knowledge-hp-harry", "Harry Potter", "hp-harry.png"),
    ...seedPortraitsForCharacter(
      "knowledge-hp-hermione",
      "Hermione Granger",
      "hp-hermione.png"
    ),
    ...seedPortraitsForCharacter("knowledge-hp-ron", "Ron Weasley", "hp-ron.png"),
    ...seedPortraitsForCharacter(
      "knowledge-hp-dumbledore",
      "Albus Dumbledore",
      "hp-dumbledore.png"
    ),
    ...seedPortraitsForCharacter(
      "knowledge-hp-voldemort",
      "Lord Voldemort",
      "hp-voldemort.png"
    ),
    ...seedPortraitsForCharacter("knowledge-hp-snape", "Severus Snape", "hp-snape.png"),
    ...seedPortraitsForCharacter("knowledge-hp-hagrid", "Rubeus Hagrid", "hp-hagrid.png")
  ]);

export function harryPotterSeedVisualsForKnowledge(
  knowledgeId: string
): readonly CharacterVisual[] {
  return HARRY_POTTER_CHARACTER_VISUAL_SEEDS.filter(
    (seed) => seed.knowledgeId === knowledgeId
  ).map((seed) => seed.visual);
}
