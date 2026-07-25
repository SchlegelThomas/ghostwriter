import { DomainValidationError } from "./domain.js";

export type CaptureReflectionStoryJob = Readonly<{
  label: string;
  rationale: string;
}>;

export type CaptureReflectionV1 = Readonly<{
  schemaId: "capture-reflection-v1";
  summary: string;
  questions: readonly string[];
  possibleStoryJobs: readonly CaptureReflectionStoryJob[];
}>;

export const CAPTURE_REFLECTION_V1_JSON_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["schemaId", "summary", "questions", "possibleStoryJobs"],
  properties: Object.freeze({
    schemaId: Object.freeze({ type: "string", const: "capture-reflection-v1" }),
    summary: Object.freeze({ type: "string", minLength: 1, maxLength: 2_000 }),
    questions: Object.freeze({
      type: "array",
      minItems: 1,
      maxItems: 5,
      items: Object.freeze({ type: "string", minLength: 1, maxLength: 500 })
    }),
    possibleStoryJobs: Object.freeze({
      type: "array",
      minItems: 1,
      maxItems: 5,
      items: Object.freeze({
        type: "object",
        additionalProperties: false,
        required: ["label", "rationale"],
        properties: Object.freeze({
          label: Object.freeze({ type: "string", minLength: 1, maxLength: 120 }),
          rationale: Object.freeze({ type: "string", minLength: 1, maxLength: 1_000 })
        })
      })
    })
  })
});

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireNonEmptyString(value: unknown, field: string, max: number): string {
  if (typeof value !== "string") {
    throw new DomainValidationError(
      "INVALID_AGENT_OUTPUT",
      `${field} must be a string.`
    );
  }
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > max) {
    throw new DomainValidationError(
      "INVALID_AGENT_OUTPUT",
      `${field} length is out of bounds.`
    );
  }
  return normalized;
}

function parseStoryJob(value: unknown, index: number): CaptureReflectionStoryJob {
  if (!isPlainObject(value)) {
    throw new DomainValidationError(
      "INVALID_AGENT_OUTPUT",
      `Story job ${index + 1} is malformed.`
    );
  }
  const keys = Object.keys(value);
  if (keys.length !== 2 || !keys.includes("label") || !keys.includes("rationale")) {
    throw new DomainValidationError(
      "INVALID_AGENT_OUTPUT",
      `Story job ${index + 1} includes unexpected fields.`
    );
  }
  return Object.freeze({
    label: requireNonEmptyString(value.label, "Story job label", 120),
    rationale: requireNonEmptyString(value.rationale, "Story job rationale", 1_000)
  });
}

export function validateCaptureReflectionV1(value: unknown): CaptureReflectionV1 {
  if (!isPlainObject(value)) {
    throw new DomainValidationError(
      "INVALID_AGENT_OUTPUT",
      "Capture reflection payload must be an object."
    );
  }
  const keys = Object.keys(value).sort();
  const expected = ["possibleStoryJobs", "questions", "schemaId", "summary"];
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new DomainValidationError(
      "INVALID_AGENT_OUTPUT",
      "Capture reflection payload includes unexpected fields."
    );
  }
  if (value.schemaId !== "capture-reflection-v1") {
    throw new DomainValidationError(
      "INVALID_AGENT_OUTPUT",
      "Capture reflection schema identifier is invalid."
    );
  }
  const summary = requireNonEmptyString(value.summary, "Summary", 2_000);
  if (!Array.isArray(value.questions)) {
    throw new DomainValidationError(
      "INVALID_AGENT_OUTPUT",
      "Questions must be an array."
    );
  }
  if (value.questions.length < 1 || value.questions.length > 5) {
    throw new DomainValidationError(
      "INVALID_AGENT_OUTPUT",
      "Question count is out of bounds."
    );
  }
  const questions = Object.freeze(
    value.questions.map((question, index) =>
      requireNonEmptyString(question, `Question ${index + 1}`, 500)
    )
  );
  if (!Array.isArray(value.possibleStoryJobs)) {
    throw new DomainValidationError(
      "INVALID_AGENT_OUTPUT",
      "Possible story jobs must be an array."
    );
  }
  if (value.possibleStoryJobs.length < 1 || value.possibleStoryJobs.length > 5) {
    throw new DomainValidationError(
      "INVALID_AGENT_OUTPUT",
      "Story job count is out of bounds."
    );
  }
  const possibleStoryJobs = Object.freeze(
    value.possibleStoryJobs.map((job, index) => parseStoryJob(job, index))
  );
  return Object.freeze({
    schemaId: "capture-reflection-v1",
    summary,
    questions,
    possibleStoryJobs
  });
}

export function isCaptureReflectionV1(value: unknown): value is CaptureReflectionV1 {
  try {
    validateCaptureReflectionV1(value);
    return true;
  } catch {
    return false;
  }
}
