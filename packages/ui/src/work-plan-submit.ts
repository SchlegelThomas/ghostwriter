import {
  isCatalogAgentId,
  isWorkPlanV1,
  type NextActionV1,
  type WorkPlanJobV1,
  type WorkPlanStoryKnowledgeKind,
  type WorkPlanV1
} from "@ghostwriter/core";

const SUBMIT_INTENTS = Object.freeze([
  "submit",
  "submit it",
  "submit them",
  "submit the plan",
  "do it",
  "do them",
  "do them all",
  "do all",
  "do all 4",
  "do all four",
  "run them",
  "run it",
  "run the plan",
  "go ahead",
  "go for it",
  "lets do it",
  "let's do it",
  "lets do them",
  "let's do them",
  "lets do them all",
  "let's do them all",
  "k lets do them all",
  "k let's do them all",
  "ok yep lets do all 4",
  "ok yep let's do all 4",
  "yes submit",
  "yes, submit",
  "ok submit",
  "okay submit"
] as const);

export const WORK_PLAN_SUBMIT_CHIP = Object.freeze({
  id: "submit-work-plan",
  label: "Submit work plan"
});

export const WORK_PLAN_DISMISS_CHIP = Object.freeze({
  id: "dismiss-work-plan",
  label: "Dismiss"
});

export const WORK_PLAN_ACTION_CHIPS = Object.freeze([
  WORK_PLAN_SUBMIT_CHIP,
  WORK_PLAN_DISMISS_CHIP
]);

/** Short free-form confirmations that mean “run the attached work plan”. */
export function isWorkPlanSubmitIntent(text: string): boolean {
  const normalized = text.trim().toLocaleLowerCase().replace(/\s+/g, " ");
  if (normalized.length === 0 || normalized.length > 40) return false;
  if (SUBMIT_INTENTS.includes(normalized as (typeof SUBMIT_INTENTS)[number])) {
    return true;
  }
  // Near-matches: punctuation-only noise around a known phrase.
  const stripped = normalized.replace(/[.!?]+$/u, "").trim();
  if (
    stripped !== normalized &&
    SUBMIT_INTENTS.includes(stripped as (typeof SUBMIT_INTENTS)[number])
  ) {
    return true;
  }
  return false;
}

function mapSuggestionToJob(
  suggestion: NextActionV1["suggestions"][number],
  index: number,
  fallbackSceneId: string | undefined
): WorkPlanJobV1 | undefined {
  const sceneId = suggestion.sceneId ?? fallbackSceneId;
  const instruction =
    suggestion.rationale.trim().length > 0
      ? suggestion.rationale.trim()
      : suggestion.title.trim();
  const id = `na-job-${index + 1}`;

  switch (suggestion.kind) {
    case "run-catalog-agent": {
      if (
        suggestion.catalogAgentId === undefined ||
        !isCatalogAgentId(suggestion.catalogAgentId)
      ) {
        return undefined;
      }
      return Object.freeze({
        id,
        kind: "run-catalog-agent",
        title: suggestion.title.trim(),
        instruction,
        catalogAgentId: suggestion.catalogAgentId,
        ...(sceneId === undefined ? {} : { sceneId })
      });
    }
    case "create-story-knowledge": {
      const proposedName =
        suggestion.proposedName?.trim() || suggestion.title.trim();
      if (proposedName.length === 0) return undefined;
      const storyKnowledgeKind: WorkPlanStoryKnowledgeKind =
        suggestion.storyKnowledgeKind ?? "custom";
      return Object.freeze({
        id,
        kind: "create-story-knowledge",
        title: suggestion.title.trim(),
        instruction,
        proposedName,
        storyKnowledgeKind,
        ...(sceneId === undefined ? {} : { sceneId })
      });
    }
    case "open-surface": {
      if (suggestion.openSurface !== "plans") return undefined;
      return Object.freeze({
        id,
        kind: "open-scene-partner",
        title: suggestion.title.trim(),
        instruction,
        ...(sceneId === undefined ? {} : { sceneId })
      });
    }
    case "continue-writing":
    case "escalate-model":
      return undefined;
    default: {
      const _exhaustive: never = suggestion.kind;
      return _exhaustive;
    }
  }
}

/** Build a submit-able work plan from next-action coach suggestions when possible. */
export function workPlanFromNextActionV1(
  payload: NextActionV1,
  sceneId?: string
): WorkPlanV1 | undefined {
  const jobs = payload.suggestions
    .map((suggestion, index) =>
      mapSuggestionToJob(suggestion, index, sceneId)
    )
    .filter((job): job is WorkPlanJobV1 => job !== undefined);
  if (jobs.length === 0) return undefined;
  return Object.freeze({
    schemaId: "work-plan-v1",
    summary: payload.summary.trim(),
    ...(sceneId === undefined ? {} : { sceneId }),
    jobs: Object.freeze(jobs)
  });
}

export type WorkPlanMessageLike = Readonly<{
  role: string;
  workPlan?: WorkPlanV1;
}>;

/** Most recent assistant message that still carries an attached work plan. */
export function latestWorkPlanFromMessages(
  messages: readonly WorkPlanMessageLike[]
): WorkPlanV1 | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "assistant") continue;
    if (message.workPlan !== undefined && isWorkPlanV1(message.workPlan)) {
      return message.workPlan;
    }
  }
  return undefined;
}
