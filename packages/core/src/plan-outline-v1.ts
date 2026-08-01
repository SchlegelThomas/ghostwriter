import { DomainValidationError } from "./domain.js";

export type PlanOutlineV1 = Readonly<{
  schemaId: "plan-outline-v1";
  title: string;
  outline: string;
  sourceMode: "plan";
}>;

export const PLAN_OUTLINE_V1_JSON_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["schemaId", "title", "outline", "sourceMode"],
  properties: Object.freeze({
    schemaId: Object.freeze({ type: "string", const: "plan-outline-v1" }),
    title: Object.freeze({ type: "string", minLength: 1, maxLength: 120 }),
    outline: Object.freeze({ type: "string", minLength: 1, maxLength: 8_000 }),
    sourceMode: Object.freeze({ type: "string", const: "plan" })
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

export function derivePlanOutlineTitle(
  outlineText: string,
  title?: string
): string {
  if (title !== undefined) {
    const normalized = title.trim();
    if (normalized.length > 0) {
      return normalized.slice(0, 120);
    }
  }
  const firstLine = outlineText.trim().split(/\n/u)[0]?.trim() ?? "";
  if (firstLine.length > 0) {
    return firstLine.slice(0, 120);
  }
  return "Plan outline";
}

export function validatePlanOutlineV1(value: unknown): PlanOutlineV1 {
  if (!isPlainObject(value)) {
    throw new DomainValidationError(
      "INVALID_AGENT_OUTPUT",
      "Plan outline payload must be an object."
    );
  }
  const keys = Object.keys(value).sort();
  const expected = ["outline", "schemaId", "sourceMode", "title"];
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new DomainValidationError(
      "INVALID_AGENT_OUTPUT",
      "Plan outline payload includes unexpected fields."
    );
  }
  if (value.schemaId !== "plan-outline-v1") {
    throw new DomainValidationError(
      "INVALID_AGENT_OUTPUT",
      "Plan outline schema identifier is invalid."
    );
  }
  if (value.sourceMode !== "plan") {
    throw new DomainValidationError(
      "INVALID_AGENT_OUTPUT",
      "Plan outline source mode is invalid."
    );
  }
  return Object.freeze({
    schemaId: "plan-outline-v1",
    title: requireNonEmptyString(value.title, "Title", 120),
    outline: requireNonEmptyString(value.outline, "Outline", 8_000),
    sourceMode: "plan"
  });
}

export function isPlanOutlineV1(value: unknown): value is PlanOutlineV1 {
  try {
    validatePlanOutlineV1(value);
    return true;
  } catch {
    return false;
  }
}

export function buildPlanOutlinePayload(
  outlineText: string,
  title?: string
): PlanOutlineV1 {
  return validatePlanOutlineV1({
    schemaId: "plan-outline-v1",
    title: derivePlanOutlineTitle(outlineText, title),
    outline: outlineText.trim(),
    sourceMode: "plan"
  });
}
