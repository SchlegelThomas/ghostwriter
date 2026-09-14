import { instructionContentHash, type InstructionContentHash } from "./agent-domain.js";
import {
  DomainValidationError,
  bookId,
  chapterId,
  partId,
  sceneId,
  projectId,
  type Book,
  type BookId,
  type ChapterId,
  type PartId,
  type ProjectId,
  type Scene,
  type SceneId
} from "./domain.js";
import type { SceneIntentPatch } from "./project-commands.js";
import type { IdGenerator } from "./project-repository.js";
import { validateStoryStructureOperationGraph } from "./story-structure-operation-graph.js";

export const STORY_STRUCTURE_SCHEMA_ID = "story-structure-proposal-v1" as const;
export const STORY_STRUCTURE_CANDIDATES_SCHEMA_ID =
  "story-structure-proposal-candidates-v1" as const;

export const STORY_STRUCTURE_MAX_PARTS = 10;
export const STORY_STRUCTURE_MAX_CHAPTERS = 50;
export const STORY_STRUCTURE_MAX_OPERATIONS = 200;
export const STORY_STRUCTURE_MAX_LOCAL_KEY_CHARS = 64;
export const STORY_STRUCTURE_MAX_TITLE_CHARS = 500;
export const STORY_STRUCTURE_MAX_OBJECTIVE_CHARS = 4_000;
export const STORY_STRUCTURE_MAX_INTENT_FIELD_CHARS = 2_000;
export const STORY_STRUCTURE_MAX_REORDER_CHAPTERS = 50;
export const STORY_STRUCTURE_MAX_DEPENDENCIES = 32;

type BrandedId<Name extends string> = string & { readonly __brand: Name };

export type StoryStructureOperationId = BrandedId<"StoryStructureOperationId">;

export function storyStructureOperationId(value: string): StoryStructureOperationId {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 128) {
    throw new DomainValidationError(
      "INVALID_AGENT_OUTPUT",
      "Story structure operation id length is out of bounds."
    );
  }
  return normalized as StoryStructureOperationId;
}

export type StoryStructurePartRefCandidate = Readonly<
  | { kind: "existing"; partId: PartId }
  | { kind: "new"; localKey: string }
>;

export type StoryStructureChapterRefCandidate = Readonly<
  | { kind: "existing"; chapterId: ChapterId }
  | { kind: "new"; localKey: string }
>;

export type StoryStructureSceneHostCandidate = Readonly<
  | { kind: "existingChapter"; chapterId: ChapterId }
  | { kind: "newChapter"; localKey: string }
  | { kind: "unassigned" }
>;

export type StoryStructureSceneIntentCandidate = Readonly<{
  purpose?: string;
  conflict?: string;
  turn?: string;
  openQuestions?: string;
}>;

export type StoryStructureNewPartCandidate = Readonly<{
  localKey: string;
  title: string;
}>;

export type StoryStructureNewChapterCandidate = Readonly<{
  localKey: string;
  part: StoryStructurePartRefCandidate;
  title: string;
  objective?: string;
}>;

export type StoryStructureNewPlannedSceneCandidate = Readonly<{
  localKey: string;
  host: StoryStructureSceneHostCandidate;
  title: string;
  intent?: StoryStructureSceneIntentCandidate;
}>;

export type StoryStructureExistingChapterUpdateCandidate = Readonly<{
  chapterId: ChapterId;
  objective: string;
}>;

export type StoryStructureChapterReorderCandidate = Readonly<{
  part: StoryStructurePartRefCandidate;
  order: readonly StoryStructureChapterRefCandidate[];
}>;

export type StoryStructureExistingSceneMoveCandidate = Readonly<{
  sceneId: SceneId;
  destination: StoryStructureSceneHostCandidate;
  position: number;
}>;

export type StoryStructureExistingSceneArchiveCandidate = Readonly<{
  sceneId: SceneId;
  archived: boolean;
}>;

export type StoryStructureExistingSceneIntentUpdateCandidate = Readonly<{
  sceneId: SceneId;
  patch: StoryStructureSceneIntentCandidate;
}>;

export type StoryStructureProposalCandidatesV1 = Readonly<{
  schemaId: typeof STORY_STRUCTURE_CANDIDATES_SCHEMA_ID;
  newParts: readonly StoryStructureNewPartCandidate[];
  newChapters: readonly StoryStructureNewChapterCandidate[];
  newPlannedScenes: readonly StoryStructureNewPlannedSceneCandidate[];
  existingChapterUpdates: readonly StoryStructureExistingChapterUpdateCandidate[];
  chapterReorders: readonly StoryStructureChapterReorderCandidate[];
  existingSceneMoves: readonly StoryStructureExistingSceneMoveCandidate[];
  existingSceneArchiveChanges: readonly StoryStructureExistingSceneArchiveCandidate[];
  existingSceneIntentUpdates: readonly StoryStructureExistingSceneIntentUpdateCandidate[];
}>;

export type StoryStructureOperation = Readonly<
  | {
      type: "part.create";
      operationId: StoryStructureOperationId;
      bookId: BookId;
      partId: PartId;
      title: string;
    }
  | {
      type: "chapter.create";
      operationId: StoryStructureOperationId;
      bookId: BookId;
      partId: PartId;
      chapterId: ChapterId;
      title: string;
      objective?: string;
    }
  | {
      type: "chapter.update";
      operationId: StoryStructureOperationId;
      bookId: BookId;
      partId: PartId;
      chapterId: ChapterId;
      objective: string;
    }
  | {
      type: "chapter.reorder";
      operationId: StoryStructureOperationId;
      bookId: BookId;
      partId: PartId;
      chapterIds: readonly ChapterId[];
    }
  | {
      type: "scene.createPlanned";
      operationId: StoryStructureOperationId;
      bookId: BookId;
      sceneId: SceneId;
      title: string;
      chapterId?: ChapterId;
      position?: number;
    }
  | {
      type: "scene.updateIntent";
      operationId: StoryStructureOperationId;
      sceneId: SceneId;
      patch: SceneIntentPatch;
    }
  | {
      type: "scene.move";
      operationId: StoryStructureOperationId;
      sceneId: SceneId;
      bookId: BookId;
      chapterId?: ChapterId;
      position: number;
    }
  | {
      type: "scene.setArchived";
      operationId: StoryStructureOperationId;
      sceneId: SceneId;
      archived: boolean;
    }
>;

export type StoryStructureDependency = Readonly<{
  operationId: StoryStructureOperationId;
  requires: readonly StoryStructureOperationId[];
}>;

export type StoryStructureProposalV1 = Readonly<{
  schemaId: typeof STORY_STRUCTURE_SCHEMA_ID;
  projectId: ProjectId;
  bookId: BookId;
  expectedProjectVersion: number;
  contextReceiptHash: InstructionContentHash;
  operations: readonly StoryStructureOperation[];
  dependencies: readonly StoryStructureDependency[];
}>;

export type StoryStructureLoweringContext = Readonly<{
  projectId: ProjectId;
  bookId: BookId;
  existingPartIds: ReadonlySet<PartId>;
  existingChapterIds: ReadonlySet<ChapterId>;
  existingSceneIds: ReadonlySet<SceneId>;
  chapterPartId: ReadonlyMap<ChapterId, PartId>;
  partChapterOrder: ReadonlyMap<PartId, readonly ChapterId[]>;
  archivedSceneIds: ReadonlySet<SceneId>;
}>;

const boundedText = (maxLength: number) =>
  Object.freeze({ type: "string", minLength: 1, maxLength });

export const STORY_STRUCTURE_CANDIDATES_V1_JSON_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: Object.freeze([
    "schemaId",
    "newParts",
    "newChapters",
    "newPlannedScenes",
    "existingChapterUpdates",
    "chapterReorders",
    "existingSceneMoves",
    "existingSceneArchiveChanges",
    "existingSceneIntentUpdates"
  ]),
  properties: Object.freeze({
    schemaId: Object.freeze({ type: "string", const: STORY_STRUCTURE_CANDIDATES_SCHEMA_ID }),
    newParts: Object.freeze({
      type: "array",
      maxItems: STORY_STRUCTURE_MAX_PARTS,
      items: Object.freeze({
        type: "object",
        additionalProperties: false,
        required: Object.freeze(["localKey", "title"]),
        properties: Object.freeze({
          localKey: boundedText(STORY_STRUCTURE_MAX_LOCAL_KEY_CHARS),
          title: boundedText(STORY_STRUCTURE_MAX_TITLE_CHARS)
        })
      })
    }),
    newChapters: Object.freeze({
      type: "array",
      maxItems: STORY_STRUCTURE_MAX_CHAPTERS,
      items: Object.freeze({
        type: "object",
        additionalProperties: false,
        required: Object.freeze(["localKey", "part", "title"]),
        properties: Object.freeze({
          localKey: boundedText(STORY_STRUCTURE_MAX_LOCAL_KEY_CHARS),
          title: boundedText(STORY_STRUCTURE_MAX_TITLE_CHARS),
          objective: boundedText(STORY_STRUCTURE_MAX_OBJECTIVE_CHARS),
          part: Object.freeze({
            oneOf: Object.freeze([
              Object.freeze({
                type: "object",
                additionalProperties: false,
                required: Object.freeze(["kind", "partId"]),
                properties: Object.freeze({
                  kind: Object.freeze({ const: "existing" }),
                  partId: boundedText(128)
                })
              }),
              Object.freeze({
                type: "object",
                additionalProperties: false,
                required: Object.freeze(["kind", "localKey"]),
                properties: Object.freeze({
                  kind: Object.freeze({ const: "new" }),
                  localKey: boundedText(STORY_STRUCTURE_MAX_LOCAL_KEY_CHARS)
                })
              })
            ])
          })
        })
      })
    }),
    newPlannedScenes: Object.freeze({
      type: "array",
      maxItems: STORY_STRUCTURE_MAX_OPERATIONS,
      items: Object.freeze({
        type: "object",
        additionalProperties: false,
        required: Object.freeze(["localKey", "host", "title"]),
        properties: Object.freeze({
          localKey: boundedText(STORY_STRUCTURE_MAX_LOCAL_KEY_CHARS),
          title: boundedText(STORY_STRUCTURE_MAX_TITLE_CHARS),
          host: Object.freeze({
            oneOf: Object.freeze([
              Object.freeze({
                type: "object",
                additionalProperties: false,
                required: Object.freeze(["kind", "chapterId"]),
                properties: Object.freeze({
                  kind: Object.freeze({ const: "existingChapter" }),
                  chapterId: boundedText(128)
                })
              }),
              Object.freeze({
                type: "object",
                additionalProperties: false,
                required: Object.freeze(["kind", "localKey"]),
                properties: Object.freeze({
                  kind: Object.freeze({ const: "newChapter" }),
                  localKey: boundedText(STORY_STRUCTURE_MAX_LOCAL_KEY_CHARS)
                })
              }),
              Object.freeze({
                type: "object",
                additionalProperties: false,
                required: Object.freeze(["kind"]),
                properties: Object.freeze({
                  kind: Object.freeze({ const: "unassigned" })
                })
              })
            ])
          }),
          intent: Object.freeze({
            type: "object",
            additionalProperties: false,
            minProperties: 1,
            properties: Object.freeze({
              purpose: boundedText(STORY_STRUCTURE_MAX_INTENT_FIELD_CHARS),
              conflict: boundedText(STORY_STRUCTURE_MAX_INTENT_FIELD_CHARS),
              turn: boundedText(STORY_STRUCTURE_MAX_INTENT_FIELD_CHARS),
              openQuestions: boundedText(STORY_STRUCTURE_MAX_INTENT_FIELD_CHARS)
            })
          })
        })
      })
    }),
    existingChapterUpdates: Object.freeze({
      type: "array",
      maxItems: STORY_STRUCTURE_MAX_CHAPTERS,
      items: Object.freeze({
        type: "object",
        additionalProperties: false,
        required: Object.freeze(["chapterId"]),
        properties: Object.freeze({
          chapterId: boundedText(128),
          objective: boundedText(STORY_STRUCTURE_MAX_OBJECTIVE_CHARS)
        })
      })
    }),
    chapterReorders: Object.freeze({
      type: "array",
      maxItems: STORY_STRUCTURE_MAX_PARTS,
      items: Object.freeze({
        type: "object",
        additionalProperties: false,
        required: Object.freeze(["part", "order"]),
        properties: Object.freeze({
          part: Object.freeze({
            oneOf: Object.freeze([
              Object.freeze({
                type: "object",
                additionalProperties: false,
                required: Object.freeze(["kind", "partId"]),
                properties: Object.freeze({
                  kind: Object.freeze({ const: "existing" }),
                  partId: boundedText(128)
                })
              }),
              Object.freeze({
                type: "object",
                additionalProperties: false,
                required: Object.freeze(["kind", "localKey"]),
                properties: Object.freeze({
                  kind: Object.freeze({ const: "new" }),
                  localKey: boundedText(STORY_STRUCTURE_MAX_LOCAL_KEY_CHARS)
                })
              })
            ])
          }),
          order: Object.freeze({
            type: "array",
            minItems: 1,
            maxItems: STORY_STRUCTURE_MAX_REORDER_CHAPTERS,
            items: Object.freeze({
              oneOf: Object.freeze([
                Object.freeze({
                  type: "object",
                  additionalProperties: false,
                  required: Object.freeze(["kind", "chapterId"]),
                  properties: Object.freeze({
                    kind: Object.freeze({ const: "existing" }),
                    chapterId: boundedText(128)
                  })
                }),
                Object.freeze({
                  type: "object",
                  additionalProperties: false,
                  required: Object.freeze(["kind", "localKey"]),
                  properties: Object.freeze({
                    kind: Object.freeze({ const: "new" }),
                    localKey: boundedText(STORY_STRUCTURE_MAX_LOCAL_KEY_CHARS)
                  })
                })
              ])
            })
          })
        })
      })
    }),
    existingSceneMoves: Object.freeze({
      type: "array",
      maxItems: STORY_STRUCTURE_MAX_OPERATIONS,
      items: Object.freeze({
        type: "object",
        additionalProperties: false,
        required: Object.freeze(["sceneId", "destination", "position"]),
        properties: Object.freeze({
          sceneId: boundedText(128),
          position: Object.freeze({ type: "integer", minimum: 0 }),
          destination: Object.freeze({
            oneOf: Object.freeze([
              Object.freeze({
                type: "object",
                additionalProperties: false,
                required: Object.freeze(["kind", "chapterId"]),
                properties: Object.freeze({
                  kind: Object.freeze({ const: "existingChapter" }),
                  chapterId: boundedText(128)
                })
              }),
              Object.freeze({
                type: "object",
                additionalProperties: false,
                required: Object.freeze(["kind", "localKey"]),
                properties: Object.freeze({
                  kind: Object.freeze({ const: "newChapter" }),
                  localKey: boundedText(STORY_STRUCTURE_MAX_LOCAL_KEY_CHARS)
                })
              }),
              Object.freeze({
                type: "object",
                additionalProperties: false,
                required: Object.freeze(["kind"]),
                properties: Object.freeze({
                  kind: Object.freeze({ const: "unassigned" })
                })
              })
            ])
          })
        })
      })
    }),
    existingSceneArchiveChanges: Object.freeze({
      type: "array",
      maxItems: STORY_STRUCTURE_MAX_OPERATIONS,
      items: Object.freeze({
        type: "object",
        additionalProperties: false,
        required: Object.freeze(["sceneId", "archived"]),
        properties: Object.freeze({
          sceneId: boundedText(128),
          archived: Object.freeze({ type: "boolean" })
        })
      })
    }),
    existingSceneIntentUpdates: Object.freeze({
      type: "array",
      maxItems: STORY_STRUCTURE_MAX_OPERATIONS,
      items: Object.freeze({
        type: "object",
        additionalProperties: false,
        required: Object.freeze(["sceneId", "patch"]),
        properties: Object.freeze({
          sceneId: boundedText(128),
          patch: Object.freeze({
            type: "object",
            additionalProperties: false,
            minProperties: 1,
            properties: Object.freeze({
              purpose: boundedText(STORY_STRUCTURE_MAX_INTENT_FIELD_CHARS),
              conflict: boundedText(STORY_STRUCTURE_MAX_INTENT_FIELD_CHARS),
              turn: boundedText(STORY_STRUCTURE_MAX_INTENT_FIELD_CHARS),
              openQuestions: boundedText(STORY_STRUCTURE_MAX_INTENT_FIELD_CHARS)
            })
          })
        })
      })
    })
  })
});

function invalid(message: string): never {
  throw new DomainValidationError("INVALID_AGENT_OUTPUT", message);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = []
): void {
  const allowed = new Set([...required, ...optional]);
  if (
    required.some((key) => !Object.prototype.hasOwnProperty.call(value, key)) ||
    Object.keys(value).some((key) => !allowed.has(key))
  ) {
    invalid("Structure proposal payload includes unexpected or missing fields.");
  }
}

function text(value: unknown, field: string, maximum: number): string {
  if (typeof value !== "string") invalid(`${field} must be a string.`);
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maximum) {
    invalid(`${field} length is out of bounds.`);
  }
  return normalized;
}

function array(value: unknown, field: string, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) {
    invalid(`${field} must be an array of at most ${maximum} items.`);
  }
  return value;
}

function parsePartRef(value: unknown): StoryStructurePartRefCandidate {
  if (!isPlainObject(value)) invalid("Part reference must be an object.");
  if (value.kind === "existing") {
    exactKeys(value, ["kind", "partId"]);
    return Object.freeze({
      kind: "existing",
      partId: partId(text(value.partId, "Part id", 128))
    });
  }
  if (value.kind === "new") {
    exactKeys(value, ["kind", "localKey"]);
    return Object.freeze({
      kind: "new",
      localKey: text(value.localKey, "Part local key", STORY_STRUCTURE_MAX_LOCAL_KEY_CHARS)
    });
  }
  invalid("Part reference kind is invalid.");
}

function parseChapterRef(value: unknown): StoryStructureChapterRefCandidate {
  if (!isPlainObject(value)) invalid("Chapter reference must be an object.");
  if (value.kind === "existing") {
    exactKeys(value, ["kind", "chapterId"]);
    return Object.freeze({
      kind: "existing",
      chapterId: chapterId(text(value.chapterId, "Chapter id", 128))
    });
  }
  if (value.kind === "new") {
    exactKeys(value, ["kind", "localKey"]);
    return Object.freeze({
      kind: "new",
      localKey: text(value.localKey, "Chapter local key", STORY_STRUCTURE_MAX_LOCAL_KEY_CHARS)
    });
  }
  invalid("Chapter reference kind is invalid.");
}

function parseSceneHost(value: unknown): StoryStructureSceneHostCandidate {
  if (!isPlainObject(value)) invalid("Scene host must be an object.");
  if (value.kind === "existingChapter") {
    exactKeys(value, ["kind", "chapterId"]);
    return Object.freeze({
      kind: "existingChapter",
      chapterId: chapterId(text(value.chapterId, "Chapter id", 128))
    });
  }
  if (value.kind === "newChapter") {
    exactKeys(value, ["kind", "localKey"]);
    return Object.freeze({
      kind: "newChapter",
      localKey: text(value.localKey, "Chapter local key", STORY_STRUCTURE_MAX_LOCAL_KEY_CHARS)
    });
  }
  if (value.kind === "unassigned") {
    exactKeys(value, ["kind"]);
    return Object.freeze({ kind: "unassigned" });
  }
  invalid("Scene host kind is invalid.");
}

function parseIntentCandidate(value: unknown): StoryStructureSceneIntentCandidate {
  if (!isPlainObject(value)) invalid("Scene intent must be an object.");
  exactKeys(value, [], ["purpose", "conflict", "turn", "openQuestions"]);
  const intent = Object.freeze({
    ...(value.purpose === undefined
      ? {}
      : { purpose: text(value.purpose, "Scene purpose", STORY_STRUCTURE_MAX_INTENT_FIELD_CHARS) }),
    ...(value.conflict === undefined
      ? {}
      : {
          conflict: text(value.conflict, "Scene conflict", STORY_STRUCTURE_MAX_INTENT_FIELD_CHARS)
        }),
    ...(value.turn === undefined
      ? {}
      : { turn: text(value.turn, "Scene turn", STORY_STRUCTURE_MAX_INTENT_FIELD_CHARS) }),
    ...(value.openQuestions === undefined
      ? {}
      : {
          openQuestions: text(
            value.openQuestions,
            "Scene open questions",
            STORY_STRUCTURE_MAX_INTENT_FIELD_CHARS
          )
        })
  });
  if (Object.keys(intent).length === 0) {
    invalid("Scene intent must include at least one field.");
  }
  return intent;
}

function rejectCandidateAuthorityFields(value: unknown): void {
  if (!isPlainObject(value)) return;
  for (const forbidden of [
    "projectId",
    "bookId",
    "expectedProjectVersion",
    "contextReceiptHash",
    "operations",
    "dependencies"
  ]) {
    if (Object.prototype.hasOwnProperty.call(value, forbidden)) {
      invalid("Structure proposal candidates cannot include trusted authority fields.");
    }
  }
  const rejectEntityAuthority = (entity: unknown, forbiddenKeys: readonly string[]) => {
    if (!isPlainObject(entity)) return;
    for (const key of forbiddenKeys) {
      if (Object.prototype.hasOwnProperty.call(entity, key)) {
        invalid("Structure proposal candidates cannot include trusted authority fields.");
      }
    }
  };
  if (Array.isArray(value.newParts)) {
    for (const part of value.newParts) {
      rejectEntityAuthority(part, ["partId", "operationId", "chapterId", "sceneId"]);
    }
  }
  if (Array.isArray(value.newChapters)) {
    for (const chapter of value.newChapters) {
      rejectEntityAuthority(chapter, ["chapterId", "partId", "operationId", "sceneId"]);
    }
  }
  if (Array.isArray(value.newPlannedScenes)) {
    for (const scene of value.newPlannedScenes) {
      rejectEntityAuthority(scene, ["sceneId", "chapterId", "partId", "operationId"]);
    }
  }
}

export function validateStoryStructureProposalCandidatesV1(
  value: unknown
): StoryStructureProposalCandidatesV1 {
  rejectCandidateAuthorityFields(value);
  if (!isPlainObject(value)) invalid("Structure proposal candidates must be an object.");
  exactKeys(value, [
    "schemaId",
    "newParts",
    "newChapters",
    "newPlannedScenes",
    "existingChapterUpdates",
    "chapterReorders",
    "existingSceneMoves",
    "existingSceneArchiveChanges",
    "existingSceneIntentUpdates"
  ]);
  if (value.schemaId !== STORY_STRUCTURE_CANDIDATES_SCHEMA_ID) {
    invalid("Structure proposal candidates schema identifier is invalid.");
  }

  const newParts = array(value.newParts, "New parts", STORY_STRUCTURE_MAX_PARTS).map((raw) => {
    if (!isPlainObject(raw)) invalid("New part must be an object.");
    exactKeys(raw, ["localKey", "title"]);
    return Object.freeze({
      localKey: text(raw.localKey, "Part local key", STORY_STRUCTURE_MAX_LOCAL_KEY_CHARS),
      title: text(raw.title, "Part title", STORY_STRUCTURE_MAX_TITLE_CHARS)
    });
  });

  const newChapters = array(value.newChapters, "New chapters", STORY_STRUCTURE_MAX_CHAPTERS).map(
    (raw) => {
      if (!isPlainObject(raw)) invalid("New chapter must be an object.");
      exactKeys(raw, ["localKey", "part", "title"], ["objective"]);
      return Object.freeze({
        localKey: text(raw.localKey, "Chapter local key", STORY_STRUCTURE_MAX_LOCAL_KEY_CHARS),
        part: parsePartRef(raw.part),
        title: text(raw.title, "Chapter title", STORY_STRUCTURE_MAX_TITLE_CHARS),
        ...(raw.objective === undefined
          ? {}
          : {
              objective: text(
                raw.objective,
                "Chapter objective",
                STORY_STRUCTURE_MAX_OBJECTIVE_CHARS
              )
            })
      });
    }
  );

  const newPlannedScenes = array(
    value.newPlannedScenes,
    "New planned scenes",
    STORY_STRUCTURE_MAX_OPERATIONS
  ).map((raw) => {
    if (!isPlainObject(raw)) invalid("New planned scene must be an object.");
    exactKeys(raw, ["localKey", "host", "title"], ["intent"]);
    return Object.freeze({
      localKey: text(raw.localKey, "Scene local key", STORY_STRUCTURE_MAX_LOCAL_KEY_CHARS),
      host: parseSceneHost(raw.host),
      title: text(raw.title, "Scene title", STORY_STRUCTURE_MAX_TITLE_CHARS),
      ...(raw.intent === undefined ? {} : { intent: parseIntentCandidate(raw.intent) })
    });
  });

  const existingChapterUpdates = array(
    value.existingChapterUpdates,
    "Existing chapter updates",
    STORY_STRUCTURE_MAX_CHAPTERS
  ).map((raw) => {
    if (!isPlainObject(raw)) invalid("Existing chapter update must be an object.");
    exactKeys(raw, ["chapterId", "objective"]);
    return Object.freeze({
      chapterId: chapterId(text(raw.chapterId, "Chapter id", 128)),
      objective: text(raw.objective, "Chapter objective", STORY_STRUCTURE_MAX_OBJECTIVE_CHARS)
    });
  });

  const chapterReorders = array(
    value.chapterReorders,
    "Chapter reorders",
    STORY_STRUCTURE_MAX_PARTS
  ).map((raw) => {
    if (!isPlainObject(raw)) invalid("Chapter reorder must be an object.");
    exactKeys(raw, ["part", "order"]);
    const order = array(raw.order, "Chapter reorder order", STORY_STRUCTURE_MAX_REORDER_CHAPTERS).map(
      (entry) => parseChapterRef(entry)
    );
    if (order.length === 0) invalid("Chapter reorder order must not be empty.");
    return Object.freeze({
      part: parsePartRef(raw.part),
      order: Object.freeze(order)
    });
  });

  const existingSceneMoves = array(
    value.existingSceneMoves,
    "Existing scene moves",
    STORY_STRUCTURE_MAX_OPERATIONS
  ).map((raw) => {
    if (!isPlainObject(raw)) invalid("Existing scene move must be an object.");
    exactKeys(raw, ["sceneId", "destination", "position"]);
    if (typeof raw.position !== "number" || !Number.isInteger(raw.position) || raw.position < 0) {
      invalid("Scene move position must be a non-negative integer.");
    }
    return Object.freeze({
      sceneId: sceneId(text(raw.sceneId, "Scene id", 128)),
      destination: parseSceneHost(raw.destination),
      position: raw.position
    });
  });

  const existingSceneArchiveChanges = array(
    value.existingSceneArchiveChanges,
    "Existing scene archive changes",
    STORY_STRUCTURE_MAX_OPERATIONS
  ).map((raw) => {
    if (!isPlainObject(raw)) invalid("Existing scene archive change must be an object.");
    exactKeys(raw, ["sceneId", "archived"]);
    if (typeof raw.archived !== "boolean") {
      invalid("Scene archive flag must be a boolean.");
    }
    return Object.freeze({
      sceneId: sceneId(text(raw.sceneId, "Scene id", 128)),
      archived: raw.archived
    });
  });

  const existingSceneIntentUpdates = array(
    value.existingSceneIntentUpdates,
    "Existing scene intent updates",
    STORY_STRUCTURE_MAX_OPERATIONS
  ).map((raw) => {
    if (!isPlainObject(raw)) invalid("Existing scene intent update must be an object.");
    exactKeys(raw, ["sceneId", "patch"]);
    return Object.freeze({
      sceneId: sceneId(text(raw.sceneId, "Scene id", 128)),
      patch: parseIntentCandidate(raw.patch)
    });
  });

  assertUniqueLocalKeys(newParts.map((part) => part.localKey), "Part local keys");
  assertUniqueLocalKeys(newChapters.map((chapter) => chapter.localKey), "Chapter local keys");
  assertUniqueLocalKeys(newPlannedScenes.map((scene) => scene.localKey), "Scene local keys");

  return Object.freeze({
    schemaId: STORY_STRUCTURE_CANDIDATES_SCHEMA_ID,
    newParts: Object.freeze(newParts),
    newChapters: Object.freeze(newChapters),
    newPlannedScenes: Object.freeze(newPlannedScenes),
    existingChapterUpdates: Object.freeze(existingChapterUpdates),
    chapterReorders: Object.freeze(chapterReorders),
    existingSceneMoves: Object.freeze(existingSceneMoves),
    existingSceneArchiveChanges: Object.freeze(existingSceneArchiveChanges),
    existingSceneIntentUpdates: Object.freeze(existingSceneIntentUpdates)
  });
}

function assertUniqueLocalKeys(keys: readonly string[], label: string): void {
  if (new Set(keys).size !== keys.length) {
    invalid(`${label} must be unique.`);
  }
}

export function storyStructureLoweringContextFromBook(
  projectId: ProjectId,
  book: Book,
  scenes: readonly Scene[]
): StoryStructureLoweringContext {
  if (book.projectId !== projectId) {
    invalid("Structure lowering book must belong to the target project.");
  }
  if (book.archivedAt !== undefined) {
    invalid("Structure proposals cannot target an archived book.");
  }
  const bookScenes = scenes.filter((scene) => scene.bookId === book.id);
  const existingPartIds = new Set<PartId>();
  const existingChapterIds = new Set<ChapterId>();
  const chapterPartId = new Map<ChapterId, PartId>();
  const partChapterOrder = new Map<PartId, ChapterId[]>();
  for (const part of book.manuscript.parts) {
    existingPartIds.add(part.id);
    partChapterOrder.set(
      part.id,
      part.chapters.map((chapter) => chapter.id)
    );
    for (const chapter of part.chapters) {
      existingChapterIds.add(chapter.id);
      chapterPartId.set(chapter.id, part.id);
    }
  }
  const existingSceneIds = new Set<SceneId>();
  const archivedSceneIds = new Set<SceneId>();
  for (const scene of bookScenes) {
    existingSceneIds.add(scene.id);
    if (scene.archivedAt !== undefined) archivedSceneIds.add(scene.id);
  }
  return Object.freeze({
    projectId,
    bookId: book.id,
    existingPartIds,
    existingChapterIds,
    existingSceneIds,
    chapterPartId,
    partChapterOrder,
    archivedSceneIds
  });
}

type LoweringState = Readonly<{
  candidate: StoryStructureProposalCandidatesV1;
  context: StoryStructureLoweringContext;
  ids: IdGenerator;
  targetBookId: BookId;
  expectedProjectVersion: number;
  contextReceiptHash: InstructionContentHash;
}>;

function resolvePartId(
  ref: StoryStructurePartRefCandidate,
  newPartIds: ReadonlyMap<string, PartId>,
  context: StoryStructureLoweringContext
): PartId {
  if (ref.kind === "existing") {
    if (!context.existingPartIds.has(ref.partId)) {
      invalid("Structure candidate references a part outside the trusted allowlist.");
    }
    return ref.partId;
  }
  const allocated = newPartIds.get(ref.localKey);
  if (allocated === undefined) {
    invalid("Structure candidate references an unknown new part local key.");
  }
  return allocated;
}

function resolveChapterId(
  ref: StoryStructureChapterRefCandidate,
  newChapterIds: ReadonlyMap<string, ChapterId>,
  context: StoryStructureLoweringContext
): ChapterId {
  if (ref.kind === "existing") {
    if (!context.existingChapterIds.has(ref.chapterId)) {
      invalid("Structure candidate references a chapter outside the trusted allowlist.");
    }
    return ref.chapterId;
  }
  const allocated = newChapterIds.get(ref.localKey);
  if (allocated === undefined) {
    invalid("Structure candidate references an unknown new chapter local key.");
  }
  return allocated;
}

function resolveSceneHostChapterId(
  host: StoryStructureSceneHostCandidate,
  newChapterIds: ReadonlyMap<string, ChapterId>,
  context: StoryStructureLoweringContext
): ChapterId | undefined {
  if (host.kind === "unassigned") return undefined;
  if (host.kind === "existingChapter") {
    if (!context.existingChapterIds.has(host.chapterId)) {
      invalid("Structure candidate references a chapter outside the trusted allowlist.");
    }
    return host.chapterId;
  }
  const allocated = newChapterIds.get(host.localKey);
  if (allocated === undefined) {
    invalid("Structure candidate references an unknown new chapter local key.");
  }
  return allocated;
}

function sceneIntentToPatch(
  intent: StoryStructureSceneIntentCandidate
): SceneIntentPatch {
  return Object.freeze({
    ...(intent.purpose === undefined ? {} : { purpose: intent.purpose }),
    ...(intent.conflict === undefined ? {} : { conflict: intent.conflict }),
    ...(intent.turn === undefined ? {} : { turn: intent.turn }),
    ...(intent.openQuestions === undefined ? {} : { openQuestions: intent.openQuestions })
  });
}

function nextOperationId(ids: IdGenerator): StoryStructureOperationId {
  return storyStructureOperationId(ids.create("storyStructureOperation"));
}

export function estimateStoryStructureOperationCount(
  candidate: StoryStructureProposalCandidatesV1
): number {
  return (
    candidate.newParts.length +
    candidate.newChapters.length +
    candidate.newPlannedScenes.length +
    candidate.existingChapterUpdates.length +
    candidate.chapterReorders.length +
    candidate.existingSceneMoves.length +
    candidate.existingSceneArchiveChanges.length +
    candidate.existingSceneIntentUpdates.length +
    candidate.newPlannedScenes.filter((scene) => scene.intent !== undefined).length
  );
}

function assertStoryStructureCandidateOperationBudget(
  candidate: StoryStructureProposalCandidatesV1
): void {
  const totalOps = estimateStoryStructureOperationCount(candidate);
  if (totalOps === 0) {
    invalid("Structure proposal must include at least one operation.");
  }
  if (totalOps > STORY_STRUCTURE_MAX_OPERATIONS) {
    invalid("Structure candidate exceeds the maximum operation count.");
  }
}

export function buildStoryStructureProposalV1FromCandidate(input: Readonly<{
  projectId: ProjectId;
  bookId: BookId;
  expectedProjectVersion: number;
  contextReceiptHash: InstructionContentHash;
  candidate: unknown;
  context: StoryStructureLoweringContext;
  ids: IdGenerator;
}>): StoryStructureProposalV1 {
  if (input.context.bookId !== input.bookId || input.context.projectId !== input.projectId) {
    invalid("Structure lowering context does not match the trusted target.");
  }
  const candidate = validateStoryStructureProposalCandidatesV1(input.candidate);
  validateCandidateSemantics(candidate, input.context);
  assertStoryStructureCandidateOperationBudget(candidate);

  const state: LoweringState = {
    candidate,
    context: input.context,
    ids: input.ids,
    targetBookId: input.bookId,
    expectedProjectVersion: input.expectedProjectVersion,
    contextReceiptHash: input.contextReceiptHash
  };

  const operations: StoryStructureOperation[] = [];
  const dependencyDraft = new Map<StoryStructureOperationId, StoryStructureOperationId[]>();

  const addOperation = (
    operation: StoryStructureOperation,
    requires: readonly StoryStructureOperationId[] = []
  ): StoryStructureOperationId => {
    if (operations.length >= STORY_STRUCTURE_MAX_OPERATIONS) {
      invalid("Structure proposal exceeds the maximum operation count.");
    }
    if (requires.length > STORY_STRUCTURE_MAX_DEPENDENCIES) {
      invalid("Structure proposal operation dependency list is out of bounds.");
    }
    operations.push(operation);
    dependencyDraft.set(operation.operationId, [...requires]);
    return operation.operationId;
  };

  const newPartIds = new Map<string, PartId>();
  const newPartCreateOp = new Map<string, StoryStructureOperationId>();
  for (const part of candidate.newParts) {
    const allocatedPartId = partId(state.ids.create("part"));
    newPartIds.set(part.localKey, allocatedPartId);
    const operationId = nextOperationId(state.ids);
    newPartCreateOp.set(part.localKey, operationId);
    addOperation(
      Object.freeze({
        type: "part.create",
        operationId,
        bookId: input.bookId,
        partId: allocatedPartId,
        title: part.title
      })
    );
  }

  const newChapterIds = new Map<string, ChapterId>();
  const newChapterCreateOp = new Map<string, StoryStructureOperationId>();
  for (const chapter of candidate.newChapters) {
    const allocatedChapterId = chapterId(state.ids.create("chapter"));
    newChapterIds.set(chapter.localKey, allocatedChapterId);
    const partIdValue = resolvePartId(chapter.part, newPartIds, input.context);
    const requires: StoryStructureOperationId[] = [];
    if (chapter.part.kind === "new") {
      const partOp = newPartCreateOp.get(chapter.part.localKey);
      if (partOp === undefined) {
        invalid("Structure candidate references an unknown new part local key.");
      }
      requires.push(partOp);
    } else if (input.context.existingPartIds.size === 0 && candidate.newParts.length === 0) {
      invalid("Structure candidate must create a part before adding chapters to an empty book.");
    }
    const operationId = nextOperationId(state.ids);
    newChapterCreateOp.set(chapter.localKey, operationId);
    addOperation(
      Object.freeze({
        type: "chapter.create",
        operationId,
        bookId: input.bookId,
        partId: partIdValue,
        chapterId: allocatedChapterId,
        title: chapter.title,
        ...(chapter.objective === undefined ? {} : { objective: chapter.objective })
      }),
      requires
    );
  }

  for (const update of candidate.existingChapterUpdates) {
    const partIdValue = input.context.chapterPartId.get(update.chapterId);
    if (partIdValue === undefined) {
      invalid("Structure candidate references a chapter outside the trusted allowlist.");
    }
    addOperation(
      Object.freeze({
        type: "chapter.update",
        operationId: nextOperationId(state.ids),
        bookId: input.bookId,
        partId: partIdValue,
        chapterId: update.chapterId,
        objective: update.objective
      })
    );
  }

  for (const reorder of candidate.chapterReorders) {
    const partIdValue = resolvePartId(reorder.part, newPartIds, input.context);
    const resolvedChapterIds = reorder.order.map((entry) =>
      resolveChapterId(entry, newChapterIds, input.context)
    );
    if (new Set(resolvedChapterIds).size !== resolvedChapterIds.length) {
      invalid("Chapter reorder lists must not contain duplicate chapter ids.");
    }
    const baseline = input.context.partChapterOrder.get(partIdValue) ?? [];
    const newInPart = candidate.newChapters
      .filter((chapter) => resolvePartId(chapter.part, newPartIds, input.context) === partIdValue)
      .map((chapter) => newChapterIds.get(chapter.localKey))
      .filter((id): id is ChapterId => id !== undefined);
    const expectedIds = [...baseline, ...newInPart];
    if (
      resolvedChapterIds.length !== expectedIds.length ||
      !expectedIds.every((id) => resolvedChapterIds.includes(id))
    ) {
      invalid("Chapter reorder must include the exact complete chapter id list for the part.");
    }
    const requires = reorder.order
      .filter((entry): entry is Extract<StoryStructureChapterRefCandidate, { kind: "new" }> => entry.kind === "new")
      .map((entry) => {
        const op = newChapterCreateOp.get(entry.localKey);
        if (op === undefined) {
          invalid("Chapter reorder references an unknown new chapter local key.");
        }
        return op;
      });
    addOperation(
      Object.freeze({
        type: "chapter.reorder",
        operationId: nextOperationId(state.ids),
        bookId: input.bookId,
        partId: partIdValue,
        chapterIds: Object.freeze(resolvedChapterIds)
      }),
      requires
    );
  }

  const newSceneCreateOp = new Map<string, StoryStructureOperationId>();
  for (const planned of candidate.newPlannedScenes) {
    const allocatedSceneId = sceneId(state.ids.create("scene"));
    const hostChapterId = resolveSceneHostChapterId(planned.host, newChapterIds, input.context);
    const requires: StoryStructureOperationId[] = [];
    if (planned.host.kind === "newChapter") {
      const chapterOp = newChapterCreateOp.get(planned.host.localKey);
      if (chapterOp === undefined) {
        invalid("Structure candidate references an unknown new chapter local key.");
      }
      requires.push(chapterOp);
    }
    const operationId = nextOperationId(state.ids);
    newSceneCreateOp.set(planned.localKey, operationId);
    addOperation(
      Object.freeze({
        type: "scene.createPlanned",
        operationId,
        bookId: input.bookId,
        sceneId: allocatedSceneId,
        title: planned.title,
        ...(hostChapterId === undefined ? {} : { chapterId: hostChapterId })
      }),
      requires
    );
    if (planned.intent !== undefined) {
      addOperation(
        Object.freeze({
          type: "scene.updateIntent",
          operationId: nextOperationId(state.ids),
          sceneId: allocatedSceneId,
          patch: sceneIntentToPatch(planned.intent)
        }),
        [operationId]
      );
    }
  }

  for (const intentUpdate of candidate.existingSceneIntentUpdates) {
    if (!input.context.existingSceneIds.has(intentUpdate.sceneId)) {
      invalid("Structure candidate references a scene outside the trusted allowlist.");
    }
    addOperation(
      Object.freeze({
        type: "scene.updateIntent",
        operationId: nextOperationId(state.ids),
        sceneId: intentUpdate.sceneId,
        patch: sceneIntentToPatch(intentUpdate.patch)
      })
    );
  }

  const archiveState = new Map<SceneId, boolean>();
  for (const scene of input.context.existingSceneIds) {
    archiveState.set(scene, input.context.archivedSceneIds.has(scene));
  }
  for (const change of candidate.existingSceneArchiveChanges) {
    if (!input.context.existingSceneIds.has(change.sceneId)) {
      invalid("Structure candidate references a scene outside the trusted allowlist.");
    }
    archiveState.set(change.sceneId, change.archived);
  }

  for (const move of candidate.existingSceneMoves) {
    if (!input.context.existingSceneIds.has(move.sceneId)) {
      invalid("Structure candidate references a scene outside the trusted allowlist.");
    }
    if (archiveState.get(move.sceneId) === true) {
      invalid("Structure candidate cannot move an archived scene without restoring it first.");
    }
    const destinationChapterId = resolveSceneHostChapterId(
      move.destination,
      newChapterIds,
      input.context
    );
    const requires: StoryStructureOperationId[] = [];
    if (move.destination.kind === "newChapter") {
      const chapterOp = newChapterCreateOp.get(move.destination.localKey);
      if (chapterOp === undefined) {
        invalid("Structure candidate references an unknown new chapter local key.");
      }
      requires.push(chapterOp);
    }
    addOperation(
      Object.freeze({
        type: "scene.move",
        operationId: nextOperationId(state.ids),
        sceneId: move.sceneId,
        bookId: input.bookId,
        ...(destinationChapterId === undefined ? {} : { chapterId: destinationChapterId }),
        position: move.position
      }),
      requires
    );
  }

  for (const change of candidate.existingSceneArchiveChanges) {
    addOperation(
      Object.freeze({
        type: "scene.setArchived",
        operationId: nextOperationId(state.ids),
        sceneId: change.sceneId,
        archived: change.archived
      })
    );
  }

  if (operations.length === 0) {
    invalid("Structure proposal must include at least one operation.");
  }

  const dependencies = Object.freeze(
    operations.map((operation) =>
      Object.freeze({
        operationId: operation.operationId,
        requires: Object.freeze(dependencyDraft.get(operation.operationId) ?? [])
      })
    )
  );

  const proposal = Object.freeze({
    schemaId: STORY_STRUCTURE_SCHEMA_ID,
    projectId: input.projectId,
    bookId: input.bookId,
    expectedProjectVersion: input.expectedProjectVersion,
    contextReceiptHash: input.contextReceiptHash,
    operations: Object.freeze(operations),
    dependencies
  });

  validateStoryStructureProposalV1(proposal);
  return proposal;
}

function validateCandidateSemantics(
  candidate: StoryStructureProposalCandidatesV1,
  context: StoryStructureLoweringContext
): void {
  for (const chapter of candidate.newChapters) {
    if (chapter.part.kind === "existing" && !context.existingPartIds.has(chapter.part.partId)) {
      invalid("Structure candidate references a part outside the trusted allowlist.");
    }
    if (chapter.part.kind === "new") {
      const partLocalKey = chapter.part.localKey;
      const exists = candidate.newParts.some((part) => part.localKey === partLocalKey);
      if (!exists) {
        invalid("Structure candidate references an unknown new part local key.");
      }
    }
  }
  for (const reorder of candidate.chapterReorders) {
    if (reorder.part.kind === "existing" && !context.existingPartIds.has(reorder.part.partId)) {
      invalid("Structure candidate references a part outside the trusted allowlist.");
    }
    if (reorder.part.kind === "new") {
      const partLocalKey = reorder.part.localKey;
      const exists = candidate.newParts.some((part) => part.localKey === partLocalKey);
      if (!exists) {
        invalid("Structure candidate references an unknown new part local key.");
      }
    }
  }
  for (const update of candidate.existingChapterUpdates) {
    if (!context.existingChapterIds.has(update.chapterId)) {
      invalid("Structure candidate references a chapter outside the trusted allowlist.");
    }
  }
  for (const scene of candidate.newPlannedScenes) {
    if (scene.host.kind === "existingChapter") {
      if (!context.existingChapterIds.has(scene.host.chapterId)) {
        invalid("Structure candidate references a chapter outside the trusted allowlist.");
      }
    }
    if (scene.host.kind === "newChapter") {
      const chapterLocalKey = scene.host.localKey;
      const exists = candidate.newChapters.some(
        (chapter) => chapter.localKey === chapterLocalKey
      );
      if (!exists) {
        invalid("Structure candidate references an unknown new chapter local key.");
      }
    }
  }
  if (
    context.existingPartIds.size === 0 &&
    candidate.newChapters.length > 0 &&
    candidate.newParts.length === 0 &&
    !candidate.newChapters.every((chapter) => chapter.part.kind === "new")
  ) {
    invalid("Structure candidate must create a part before adding chapters to an empty book.");
  }
}

function parseStoredOperation(value: unknown): StoryStructureOperation {
  if (!isPlainObject(value)) invalid("Structure operation must be an object.");
  const operationId = storyStructureOperationId(
    text(value.operationId, "Operation id", 128)
  );
  switch (value.type) {
    case "part.create":
      exactKeys(value, ["type", "operationId", "bookId", "partId", "title"]);
      return Object.freeze({
        type: "part.create",
        operationId,
        bookId: bookId(text(value.bookId, "Book id", 128)),
        partId: partId(text(value.partId, "Part id", 128)),
        title: text(value.title, "Part title", STORY_STRUCTURE_MAX_TITLE_CHARS)
      });
    case "chapter.create":
      exactKeys(value, ["type", "operationId", "bookId", "partId", "chapterId", "title"], [
        "objective"
      ]);
      return Object.freeze({
        type: "chapter.create",
        operationId,
        bookId: bookId(text(value.bookId, "Book id", 128)),
        partId: partId(text(value.partId, "Part id", 128)),
        chapterId: chapterId(text(value.chapterId, "Chapter id", 128)),
        title: text(value.title, "Chapter title", STORY_STRUCTURE_MAX_TITLE_CHARS),
        ...(value.objective === undefined
          ? {}
          : {
              objective: text(
                value.objective,
                "Chapter objective",
                STORY_STRUCTURE_MAX_OBJECTIVE_CHARS
              )
            })
      });
    case "chapter.update":
      exactKeys(value, ["type", "operationId", "bookId", "partId", "chapterId", "objective"]);
      return Object.freeze({
        type: "chapter.update",
        operationId,
        bookId: bookId(text(value.bookId, "Book id", 128)),
        partId: partId(text(value.partId, "Part id", 128)),
        chapterId: chapterId(text(value.chapterId, "Chapter id", 128)),
        objective: text(value.objective, "Chapter objective", STORY_STRUCTURE_MAX_OBJECTIVE_CHARS)
      });
    case "chapter.reorder": {
      exactKeys(value, ["type", "operationId", "bookId", "partId", "chapterIds"]);
      if (
        !Array.isArray(value.chapterIds) ||
        value.chapterIds.length === 0 ||
        value.chapterIds.length > STORY_STRUCTURE_MAX_REORDER_CHAPTERS
      ) {
        invalid("Chapter reorder id list is out of bounds.");
      }
      const chapterIdsList = value.chapterIds.map((entry) =>
        chapterId(text(entry, "Chapter id", 128))
      );
      if (new Set(chapterIdsList).size !== chapterIdsList.length) {
        invalid("Chapter reorder id list must not contain duplicates.");
      }
      return Object.freeze({
        type: "chapter.reorder",
        operationId,
        bookId: bookId(text(value.bookId, "Book id", 128)),
        partId: partId(text(value.partId, "Part id", 128)),
        chapterIds: Object.freeze(chapterIdsList)
      });
    }
    case "scene.createPlanned":
      exactKeys(
        value,
        ["type", "operationId", "bookId", "sceneId", "title"],
        ["chapterId", "position"]
      );
      if (Object.prototype.hasOwnProperty.call(value, "intent")) {
        invalid("Scene create planned operations cannot include intent.");
      }
      return Object.freeze({
        type: "scene.createPlanned",
        operationId,
        bookId: bookId(text(value.bookId, "Book id", 128)),
        sceneId: sceneId(text(value.sceneId, "Scene id", 128)),
        title: text(value.title, "Scene title", STORY_STRUCTURE_MAX_TITLE_CHARS),
        ...(value.chapterId === undefined
          ? {}
          : { chapterId: chapterId(text(value.chapterId, "Chapter id", 128)) }),
        ...(value.position === undefined
          ? {}
          : {
              position:
                typeof value.position === "number" &&
                Number.isInteger(value.position) &&
                value.position >= 0
                  ? value.position
                  : invalid("Scene create position must be a non-negative integer.")
            })
      });
    case "scene.updateIntent":
      exactKeys(value, ["type", "operationId", "sceneId", "patch"]);
      return Object.freeze({
        type: "scene.updateIntent",
        operationId,
        sceneId: sceneId(text(value.sceneId, "Scene id", 128)),
        patch: sceneIntentToPatch(parseIntentCandidate(value.patch))
      });
    case "scene.move":
      exactKeys(value, ["type", "operationId", "sceneId", "bookId", "position"], ["chapterId"]);
      if (
        typeof value.position !== "number" ||
        !Number.isInteger(value.position) ||
        value.position < 0
      ) {
        invalid("Scene move position must be a non-negative integer.");
      }
      return Object.freeze({
        type: "scene.move",
        operationId,
        sceneId: sceneId(text(value.sceneId, "Scene id", 128)),
        bookId: bookId(text(value.bookId, "Book id", 128)),
        ...(value.chapterId === undefined
          ? {}
          : { chapterId: chapterId(text(value.chapterId, "Chapter id", 128)) }),
        position: value.position
      });
    case "scene.setArchived":
      exactKeys(value, ["type", "operationId", "sceneId", "archived"]);
      if (typeof value.archived !== "boolean") {
        invalid("Scene archive flag must be a boolean.");
      }
      return Object.freeze({
        type: "scene.setArchived",
        operationId,
        sceneId: sceneId(text(value.sceneId, "Scene id", 128)),
        archived: value.archived
      });
    default:
      invalid("Structure operation type is not recognized.");
  }
}

export function validateStoryStructureProposalV1(value: unknown): StoryStructureProposalV1 {
  if (!isPlainObject(value)) invalid("Structure proposal must be an object.");
  exactKeys(value, [
    "schemaId",
    "projectId",
    "bookId",
    "expectedProjectVersion",
    "contextReceiptHash",
    "operations",
    "dependencies"
  ]);
  if (value.schemaId !== STORY_STRUCTURE_SCHEMA_ID) {
    invalid("Structure proposal schema identifier is invalid.");
  }
  if (
    typeof value.expectedProjectVersion !== "number" ||
    !Number.isInteger(value.expectedProjectVersion) ||
    value.expectedProjectVersion < 0
  ) {
    invalid("Structure proposal expected project version is invalid.");
  }
  const operations = array(value.operations, "Structure operations", STORY_STRUCTURE_MAX_OPERATIONS).map(
    (entry) => parseStoredOperation(entry)
  );
  const dependencies = array(
    value.dependencies,
    "Structure dependencies",
    STORY_STRUCTURE_MAX_OPERATIONS
  ).map((entry) => {
    if (!isPlainObject(entry)) invalid("Structure dependency must be an object.");
    exactKeys(entry, ["operationId", "requires"]);
    const requires = array(entry.requires, "Structure dependency requirements", STORY_STRUCTURE_MAX_DEPENDENCIES).map(
      (required) => storyStructureOperationId(text(required, "Operation id", 128))
    );
    return Object.freeze({
      operationId: storyStructureOperationId(text(entry.operationId, "Operation id", 128)),
      requires: Object.freeze(requires)
    });
  });

  const proposal = Object.freeze({
    schemaId: STORY_STRUCTURE_SCHEMA_ID,
    projectId: projectId(text(value.projectId, "Project id", 128)),
    bookId: bookId(text(value.bookId, "Book id", 128)),
    expectedProjectVersion: value.expectedProjectVersion,
    contextReceiptHash: instructionContentHash(String(value.contextReceiptHash)),
    operations: Object.freeze(operations),
    dependencies: Object.freeze(dependencies)
  });

  validateStoryStructureOperationGraph(proposal);
  return proposal;
}

export function isStoryStructureProposalV1(value: unknown): value is StoryStructureProposalV1 {
  try {
    validateStoryStructureProposalV1(value);
    return true;
  } catch {
    return false;
  }
}
