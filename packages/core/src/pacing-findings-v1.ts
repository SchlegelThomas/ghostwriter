import type { CatalogMemoLens } from "./catalog-memo-v1.js";
import { CATALOG_MEMO_LENSES } from "./catalog-memo-v1.js";
import { DomainValidationError } from "./domain.js";

export const PACING_TURN_IDS = Object.freeze([
  "catalyst",
  "commitment",
  "midpoint",
  "low-point",
  "final-movement"
] as const);
export type PacingTurnId = (typeof PACING_TURN_IDS)[number];

export const PACING_PRESCRIPTION_ACTIONS = Object.freeze([
  "cut",
  "merge",
  "add-pressure",
  "reorder"
] as const);
export type PacingPrescriptionAction =
  (typeof PACING_PRESCRIPTION_ACTIONS)[number];

export type PacingFindingsV1 = Readonly<{
  schemaId: "pacing-findings-v1";
  agentId: "pacing-doctor";
  title: string;
  summary: string;
  lens?: CatalogMemoLens;
  positionBasis: "equal-scene";
  turns: readonly Readonly<{
    id: PacingTurnId;
    sceneId?: string;
    sceneTitle?: string;
    measuredPct?: number;
    bandLow: number;
    bandHigh: number;
    driftNote?: string;
  }>[];
  flatRuns: readonly Readonly<{
    fromSceneId: string;
    toSceneId: string;
    reason: string;
  }>[];
  prescriptions: readonly Readonly<{
    action: PacingPrescriptionAction;
    body: string;
    sceneIds?: readonly string[];
  }>[];
  sections: readonly Readonly<{ heading: string; body: string }>[];
  evidence: readonly Readonly<{
    label: string;
    sceneId?: string;
    quote?: string;
  }>[];
}>;

const boundedText = (maxLength: number) =>
  Object.freeze({ type: "string", minLength: 1, maxLength });
const percent = Object.freeze({ type: "number", minimum: 0, maximum: 100 });

export const PACING_FINDINGS_V1_JSON_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: [
    "schemaId",
    "agentId",
    "title",
    "summary",
    "positionBasis",
    "turns",
    "flatRuns",
    "prescriptions",
    "sections",
    "evidence"
  ],
  properties: Object.freeze({
    schemaId: Object.freeze({ type: "string", const: "pacing-findings-v1" }),
    agentId: Object.freeze({ type: "string", const: "pacing-doctor" }),
    title: boundedText(120),
    summary: boundedText(2_000),
    lens: Object.freeze({ type: "string", enum: CATALOG_MEMO_LENSES }),
    positionBasis: Object.freeze({ type: "string", const: "equal-scene" }),
    turns: Object.freeze({
      type: "array",
      maxItems: 5,
      items: Object.freeze({
        type: "object",
        additionalProperties: false,
        required: ["id", "bandLow", "bandHigh"],
        properties: Object.freeze({
          id: Object.freeze({ type: "string", enum: PACING_TURN_IDS }),
          sceneId: boundedText(200),
          sceneTitle: boundedText(300),
          measuredPct: percent,
          bandLow: percent,
          bandHigh: percent,
          driftNote: boundedText(1_000)
        })
      })
    }),
    flatRuns: Object.freeze({
      type: "array",
      maxItems: 20,
      items: Object.freeze({
        type: "object",
        additionalProperties: false,
        required: ["fromSceneId", "toSceneId", "reason"],
        properties: Object.freeze({
          fromSceneId: boundedText(200),
          toSceneId: boundedText(200),
          reason: boundedText(1_000)
        })
      })
    }),
    prescriptions: Object.freeze({
      type: "array",
      maxItems: 20,
      items: Object.freeze({
        type: "object",
        additionalProperties: false,
        required: ["action", "body"],
        properties: Object.freeze({
          action: Object.freeze({
            type: "string",
            enum: PACING_PRESCRIPTION_ACTIONS
          }),
          body: boundedText(2_000),
          sceneIds: Object.freeze({
            type: "array",
            maxItems: 20,
            items: boundedText(200)
          })
        })
      })
    }),
    sections: Object.freeze({
      type: "array",
      maxItems: 12,
      items: Object.freeze({
        type: "object",
        additionalProperties: false,
        required: ["heading", "body"],
        properties: Object.freeze({
          heading: boundedText(120),
          body: boundedText(4_000)
        })
      })
    }),
    evidence: Object.freeze({
      type: "array",
      maxItems: 20,
      items: Object.freeze({
        type: "object",
        additionalProperties: false,
        required: ["label"],
        properties: Object.freeze({
          label: boundedText(300),
          sceneId: boundedText(200),
          quote: boundedText(1_000)
        })
      })
    })
  })
});

function invalid(message: string): never {
  throw new DomainValidationError("INVALID_AGENT_OUTPUT", message);
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
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
    invalid("Pacing findings include unexpected or missing fields.");
  }
}

function text(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string") invalid(`${label} must be a string.`);
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maxLength) {
    invalid(`${label} length is out of bounds.`);
  }
  return normalized;
}

function numberPercent(value: unknown, label: string): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 100
  ) {
    invalid(`${label} must be a finite percentage.`);
  }
  return value;
}

function array(value: unknown, label: string, maxItems: number): unknown[] {
  if (!Array.isArray(value) || value.length > maxItems) {
    invalid(`${label} are invalid.`);
  }
  return value;
}

export function validatePacingFindingsV1(value: unknown): PacingFindingsV1 {
  const root = object(value, "Pacing findings");
  exactKeys(
    root,
    [
      "schemaId",
      "agentId",
      "title",
      "summary",
      "positionBasis",
      "turns",
      "flatRuns",
      "prescriptions",
      "sections",
      "evidence"
    ],
    ["lens"]
  );
  if (
    root.schemaId !== "pacing-findings-v1" ||
    root.agentId !== "pacing-doctor" ||
    root.positionBasis !== "equal-scene"
  ) {
    invalid("Pacing findings identifiers are invalid.");
  }
  const lens =
    root.lens === undefined
      ? undefined
      : CATALOG_MEMO_LENSES.includes(root.lens as CatalogMemoLens)
        ? (root.lens as CatalogMemoLens)
        : invalid("Pacing findings lens is invalid.");
  const turns = array(root.turns, "Pacing turns", 5).map((raw) => {
    const item = object(raw, "Pacing turn");
    exactKeys(item, ["id", "bandLow", "bandHigh"], [
      "sceneId",
      "sceneTitle",
      "measuredPct",
      "driftNote"
    ]);
    if (!PACING_TURN_IDS.includes(item.id as PacingTurnId)) {
      invalid("Pacing turn id is invalid.");
    }
    const bandLow = numberPercent(item.bandLow, "Turn band low");
    const bandHigh = numberPercent(item.bandHigh, "Turn band high");
    if (bandLow > bandHigh) invalid("Pacing turn band is reversed.");
    return Object.freeze({
      id: item.id as PacingTurnId,
      ...(item.sceneId === undefined
        ? {}
        : { sceneId: text(item.sceneId, "Turn scene id", 200) }),
      ...(item.sceneTitle === undefined
        ? {}
        : { sceneTitle: text(item.sceneTitle, "Turn scene title", 300) }),
      ...(item.measuredPct === undefined
        ? {}
        : { measuredPct: numberPercent(item.measuredPct, "Measured turn") }),
      bandLow,
      bandHigh,
      ...(item.driftNote === undefined
        ? {}
        : { driftNote: text(item.driftNote, "Turn drift note", 1_000) })
    });
  });
  if (new Set(turns.map((turn) => turn.id)).size !== turns.length) {
    invalid("Pacing turn ids must be unique.");
  }
  const flatRuns = array(root.flatRuns, "Pacing flat runs", 20).map((raw) => {
    const item = object(raw, "Pacing flat run");
    exactKeys(item, ["fromSceneId", "toSceneId", "reason"]);
    return Object.freeze({
      fromSceneId: text(item.fromSceneId, "Flat run start scene", 200),
      toSceneId: text(item.toSceneId, "Flat run end scene", 200),
      reason: text(item.reason, "Flat run reason", 1_000)
    });
  });
  const prescriptions = array(
    root.prescriptions,
    "Pacing prescriptions",
    20
  ).map((raw) => {
    const item = object(raw, "Pacing prescription");
    exactKeys(item, ["action", "body"], ["sceneIds"]);
    if (
      !PACING_PRESCRIPTION_ACTIONS.includes(
        item.action as PacingPrescriptionAction
      )
    ) {
      invalid("Pacing prescription action is invalid.");
    }
    return Object.freeze({
      action: item.action as PacingPrescriptionAction,
      body: text(item.body, "Prescription body", 2_000),
      ...(item.sceneIds === undefined
        ? {}
        : {
            sceneIds: Object.freeze(
              array(item.sceneIds, "Prescription scene ids", 20).map((id) =>
                text(id, "Prescription scene id", 200)
              )
            )
          })
    });
  });
  const sections = array(root.sections, "Pacing sections", 12).map((raw) => {
    const item = object(raw, "Pacing section");
    exactKeys(item, ["heading", "body"]);
    return Object.freeze({
      heading: text(item.heading, "Section heading", 120),
      body: text(item.body, "Section body", 4_000)
    });
  });
  const evidence = array(root.evidence, "Pacing evidence", 20).map((raw) => {
    const item = object(raw, "Pacing evidence");
    exactKeys(item, ["label"], ["sceneId", "quote"]);
    return Object.freeze({
      label: text(item.label, "Evidence label", 300),
      ...(item.sceneId === undefined
        ? {}
        : { sceneId: text(item.sceneId, "Evidence scene id", 200) }),
      ...(item.quote === undefined
        ? {}
        : { quote: text(item.quote, "Evidence quote", 1_000) })
    });
  });
  return Object.freeze({
    schemaId: "pacing-findings-v1",
    agentId: "pacing-doctor",
    title: text(root.title, "Title", 120),
    summary: text(root.summary, "Summary", 2_000),
    ...(lens === undefined ? {} : { lens }),
    positionBasis: "equal-scene",
    turns: Object.freeze(turns),
    flatRuns: Object.freeze(flatRuns),
    prescriptions: Object.freeze(prescriptions),
    sections: Object.freeze(sections),
    evidence: Object.freeze(evidence)
  });
}
