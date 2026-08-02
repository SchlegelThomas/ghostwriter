import { DomainValidationError } from "./domain.js";

export const WORK_PLAN_JOB_KINDS = Object.freeze([
  "run-catalog-agent",
  "create-story-knowledge",
  "open-scene-partner",
  "cast-reference-check"
] as const);

export type WorkPlanJobKind = (typeof WORK_PLAN_JOB_KINDS)[number];

export const WORK_PLAN_STORY_KNOWLEDGE_KINDS = Object.freeze([
  "character",
  "location",
  "world-rule",
  "thread",
  "custom"
] as const);

export type WorkPlanStoryKnowledgeKind =
  (typeof WORK_PLAN_STORY_KNOWLEDGE_KINDS)[number];

export type WorkPlanJobV1 = Readonly<{
  id: string;
  kind: WorkPlanJobKind;
  title: string;
  instruction: string;
  catalogAgentId?: string;
  storyKnowledgeKind?: WorkPlanStoryKnowledgeKind;
  proposedName?: string;
  storyKnowledgeId?: string;
  sceneId?: string;
  heavy?: boolean;
}>;

export type WorkPlanV1 = Readonly<{
  schemaId: "work-plan-v1";
  summary: string;
  sceneId?: string;
  jobs: readonly WorkPlanJobV1[];
}>;

const boundedText = (maxLength: number) =>
  Object.freeze({ type: "string", minLength: 1, maxLength });

export const WORK_PLAN_V1_JSON_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["schemaId", "summary", "jobs"],
  properties: Object.freeze({
    schemaId: Object.freeze({ type: "string", const: "work-plan-v1" }),
    summary: boundedText(2_000),
    sceneId: boundedText(200),
    jobs: Object.freeze({
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: Object.freeze({
        type: "object",
        additionalProperties: false,
        required: ["id", "kind", "title", "instruction"],
        properties: Object.freeze({
          id: boundedText(64),
          kind: Object.freeze({ type: "string", enum: WORK_PLAN_JOB_KINDS }),
          title: boundedText(120),
          instruction: boundedText(4_000),
          catalogAgentId: boundedText(100),
          storyKnowledgeKind: Object.freeze({
            type: "string",
            enum: WORK_PLAN_STORY_KNOWLEDGE_KINDS
          }),
          proposedName: boundedText(120),
          storyKnowledgeId: boundedText(200),
          sceneId: boundedText(200),
          heavy: Object.freeze({ type: "boolean" })
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
  const keys = Object.keys(value);
  if (
    required.some((key) => !Object.prototype.hasOwnProperty.call(value, key)) ||
    keys.some((key) => !allowed.has(key))
  ) {
    invalid("Work plan payload includes unexpected or missing fields.");
  }
}

function text(value: unknown, field: string, max: number): string {
  if (typeof value !== "string") invalid(`${field} must be a string.`);
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > max) {
    invalid(`${field} length is out of bounds.`);
  }
  return normalized;
}

function booleanValue(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") invalid(`${field} must be a boolean.`);
  return value;
}

function validateJob(raw: unknown): WorkPlanJobV1 {
  if (!isPlainObject(raw)) invalid("Work plan job must be an object.");
  exactKeys(
    raw,
    ["id", "kind", "title", "instruction"],
    [
      "catalogAgentId",
      "storyKnowledgeKind",
      "proposedName",
      "storyKnowledgeId",
      "sceneId",
      "heavy"
    ]
  );
  if (!WORK_PLAN_JOB_KINDS.includes(raw.kind as WorkPlanJobKind)) {
    invalid("Work plan job kind is invalid.");
  }
  const kind = raw.kind as WorkPlanJobKind;
  const storyKnowledgeKind =
    raw.storyKnowledgeKind === undefined
      ? undefined
      : WORK_PLAN_STORY_KNOWLEDGE_KINDS.includes(
            raw.storyKnowledgeKind as WorkPlanStoryKnowledgeKind
          )
        ? (raw.storyKnowledgeKind as WorkPlanStoryKnowledgeKind)
        : invalid("Work plan story knowledge kind is invalid.");
  const catalogAgentId =
    raw.catalogAgentId === undefined
      ? undefined
      : text(raw.catalogAgentId, "Catalog agent id", 100);
  const proposedName =
    raw.proposedName === undefined
      ? undefined
      : text(raw.proposedName, "Proposed name", 120);
  const instruction = text(raw.instruction, "Job instruction", 4_000);

  if (kind === "run-catalog-agent" && catalogAgentId === undefined) {
    invalid("Run catalog agent jobs require catalogAgentId.");
  }
  if (kind === "create-story-knowledge") {
    if (proposedName === undefined) {
      invalid("Create story knowledge jobs require proposedName.");
    }
    if (storyKnowledgeKind === undefined) {
      invalid("Create story knowledge jobs require storyKnowledgeKind.");
    }
  }
  if (kind === "open-scene-partner" && instruction.length === 0) {
    invalid("Open scene partner jobs require instruction.");
  }
  if (kind === "cast-reference-check" && instruction.length === 0) {
    invalid("Cast reference check jobs require instruction.");
  }

  return Object.freeze({
    id: text(raw.id, "Job id", 64),
    kind,
    title: text(raw.title, "Job title", 120),
    instruction,
    ...(catalogAgentId === undefined ? {} : { catalogAgentId }),
    ...(storyKnowledgeKind === undefined ? {} : { storyKnowledgeKind }),
    ...(proposedName === undefined ? {} : { proposedName }),
    ...(raw.storyKnowledgeId === undefined
      ? {}
      : { storyKnowledgeId: text(raw.storyKnowledgeId, "Story knowledge id", 200) }),
    ...(raw.sceneId === undefined
      ? {}
      : { sceneId: text(raw.sceneId, "Scene id", 200) }),
    ...(raw.heavy === undefined ? {} : { heavy: booleanValue(raw.heavy, "Job heavy") })
  });
}

export function validateWorkPlanV1(value: unknown): WorkPlanV1 {
  if (!isPlainObject(value)) invalid("Work plan payload must be an object.");
  exactKeys(value, ["schemaId", "summary", "jobs"], ["sceneId"]);
  if (value.schemaId !== "work-plan-v1") {
    invalid("Work plan schema identifier is invalid.");
  }
  if (!Array.isArray(value.jobs) || value.jobs.length < 1 || value.jobs.length > 8) {
    invalid("Work plan jobs are invalid.");
  }
  const jobs = Object.freeze(value.jobs.map((item) => validateJob(item)));
  return Object.freeze({
    schemaId: "work-plan-v1",
    summary: text(value.summary, "Summary", 2_000),
    ...(value.sceneId === undefined
      ? {}
      : { sceneId: text(value.sceneId, "Scene id", 200) }),
    jobs
  });
}

export function isWorkPlanV1(value: unknown): value is WorkPlanV1 {
  try {
    validateWorkPlanV1(value);
    return true;
  } catch {
    return false;
  }
}
