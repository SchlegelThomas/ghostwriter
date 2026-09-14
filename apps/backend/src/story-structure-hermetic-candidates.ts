import { STORY_STRUCTURE_CANDIDATES_SCHEMA_ID } from "@ghostwriter/core";

const TARGET_BOOK_MARKER = "=== TARGET BOOK ID (exact) ===\n";

/** Target book id from compiled structure provider input, when present. */
export function extractStoryStructureHermeticTargetBookId(
  inputText: string
): string | undefined {
  const line = inputText.split(TARGET_BOOK_MARKER)[1]?.split("\n", 1)[0]?.trim();
  return line === undefined || line.length === 0 ? undefined : line;
}

export type StoryStructureHermeticCandidatesOutput = Readonly<{
  schemaId: typeof STORY_STRUCTURE_CANDIDATES_SCHEMA_ID;
  newParts: readonly Readonly<{ localKey: string; title: string }>[];
  newChapters: readonly Readonly<{
    localKey: string;
    part: Readonly<{ kind: "new"; localKey: string }>;
    title: string;
    objective?: string;
  }>[];
  newPlannedScenes: readonly Readonly<{
    localKey: string;
    host: Readonly<{ kind: "newChapter"; localKey: string }>;
    title: string;
    intent?: Readonly<{ purpose: string }>;
  }>[];
  existingChapterUpdates: readonly [];
  chapterReorders: readonly Readonly<{
    part: Readonly<{ kind: "new"; localKey: string }>;
    order: readonly Readonly<{ kind: "new"; localKey: string }>[];
  }>[];
  existingSceneMoves: readonly [];
  existingSceneArchiveChanges: readonly [];
  existingSceneIntentUpdates: readonly [];
}>;

/**
 * Deterministic three-chapter structure candidate for hermetic generation tests.
 * Uses local keys only; no canonical IDs, Canvas fields, or prose.
 */
export function buildStoryStructureHermeticCandidatesOutput(
  _inputText: string
): StoryStructureHermeticCandidatesOutput {
  void extractStoryStructureHermeticTargetBookId(_inputText);
  return Object.freeze({
    schemaId: STORY_STRUCTURE_CANDIDATES_SCHEMA_ID,
    newParts: Object.freeze([Object.freeze({ localKey: "part-a", title: "Act One" })]),
    newChapters: Object.freeze([
      Object.freeze({
        localKey: "ch-1",
        part: Object.freeze({ kind: "new" as const, localKey: "part-a" }),
        title: "Chapter One",
        objective: "Introduce the world"
      }),
      Object.freeze({
        localKey: "ch-2",
        part: Object.freeze({ kind: "new" as const, localKey: "part-a" }),
        title: "Chapter Two",
        objective: "Complicate the hidden-map mystery"
      }),
      Object.freeze({
        localKey: "ch-3",
        part: Object.freeze({ kind: "new" as const, localKey: "part-a" }),
        title: "Chapter Three",
        objective: "Turn the discovery into a consequential choice"
      })
    ]),
    newPlannedScenes: Object.freeze([
      Object.freeze({
        localKey: "sc-1",
        host: Object.freeze({ kind: "newChapter" as const, localKey: "ch-1" }),
        title: "Opening"
      }),
      Object.freeze({
        localKey: "sc-2",
        host: Object.freeze({ kind: "newChapter" as const, localKey: "ch-2" }),
        title: "Middle"
      }),
      Object.freeze({
        localKey: "sc-3",
        host: Object.freeze({ kind: "newChapter" as const, localKey: "ch-3" }),
        title: "Turn",
        intent: Object.freeze({ purpose: "Raise the stakes" })
      })
    ]),
    existingChapterUpdates: [] as const,
    chapterReorders: Object.freeze([
      Object.freeze({
        part: Object.freeze({ kind: "new" as const, localKey: "part-a" }),
        order: Object.freeze([
          Object.freeze({ kind: "new" as const, localKey: "ch-1" }),
          Object.freeze({ kind: "new" as const, localKey: "ch-2" }),
          Object.freeze({ kind: "new" as const, localKey: "ch-3" })
        ])
      })
    ]),
    existingSceneMoves: [] as const,
    existingSceneArchiveChanges: [] as const,
    existingSceneIntentUpdates: [] as const
  });
}
