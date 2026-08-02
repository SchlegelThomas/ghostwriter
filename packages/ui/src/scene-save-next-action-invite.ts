import type { CatalogAgentId, NextActionV1 } from "@ghostwriter/core";

export type SceneSaveNextActionInvite = Readonly<{
  sceneId: string;
  revision: number;
  mayRunAmbientCoach: boolean;
}>;

export type SceneSaveNextActionStartInput = Readonly<{
  sceneId: string;
  revision: number;
  ambient: boolean;
}>;

export type SceneSaveNextActionChip = Readonly<{
  id: string;
  label: string;
  catalogAgentId?: CatalogAgentId;
}>;

export function sceneSaveNextActionDismissKey(
  sceneId: string,
  revision: number
): string {
  return `${sceneId}:${revision}`;
}

export const SCENE_SAVE_NEXT_ACTION_INVITE_PROMPT =
  "Want suggestions for next steps on this scene?";

export const SCENE_SAVE_NEXT_ACTION_AUTO_BODY =
  "I looked at what you just saved. Useful next moves:";

export const SCENE_SAVE_NEXT_ACTION_INVITE_CHIPS = Object.freeze([
  Object.freeze({
    id: "start-next-action-coach",
    label: "Suggest next steps"
  }),
  Object.freeze({ id: "dismiss-next-action", label: "Not now" })
] as const satisfies readonly SceneSaveNextActionChip[]);

export const SCENE_SAVE_NEXT_ACTION_RESULT_CHIPS = Object.freeze([
  Object.freeze({ id: "continue-writing", label: "Continue writing" }),
  Object.freeze({
    id: "dialogue-coach",
    label: "Dialogue Coach",
    catalogAgentId: "dialogue-coach" as CatalogAgentId
  }),
  Object.freeze({
    id: "create-story-knowledge",
    label: "Create story knowledge"
  }),
  Object.freeze({ id: "dismiss-next-action", label: "Dismiss" })
] as const satisfies readonly SceneSaveNextActionChip[]);

export type SceneSaveNextActionInviteChipId =
  (typeof SCENE_SAVE_NEXT_ACTION_INVITE_CHIPS)[number]["id"];

export function sceneSaveNextActionResultBody(sceneTitle?: string): string {
  const where =
    sceneTitle !== undefined && sceneTitle.trim().length > 0
      ? `**${sceneTitle.trim()}**`
      : "this scene";
  return [
    SCENE_SAVE_NEXT_ACTION_AUTO_BODY,
    "",
    `For ${where}:`,
    "",
    "1. Keep drafting from the caret",
    "2. Run Dialogue Coach on the latest beats",
    "3. Capture a new character or place in story knowledge"
  ].join("\n");
}

function suggestionChipId(
  suggestion: NextActionV1["suggestions"][number]
): string | undefined {
  switch (suggestion.kind) {
    case "continue-writing":
      return "continue-writing";
    case "run-catalog-agent":
      return suggestion.catalogAgentId === "dialogue-coach"
        ? "dialogue-coach"
        : undefined;
    case "create-story-knowledge":
      return "create-story-knowledge";
    case "open-surface":
    case "escalate-model":
      return undefined;
    default: {
      const _exhaustive: never = suggestion.kind;
      return _exhaustive;
    }
  }
}

export function chipsFromNextActionV1(
  payload: NextActionV1
): readonly SceneSaveNextActionChip[] {
  const chips: SceneSaveNextActionChip[] = [];
  const seen = new Set<string>();
  for (const suggestion of payload.suggestions) {
    const id = suggestionChipId(suggestion);
    if (id === undefined || seen.has(id)) continue;
    seen.add(id);
    const template = SCENE_SAVE_NEXT_ACTION_RESULT_CHIPS.find(
      (chip) => chip.id === id
    );
    if (template === undefined) continue;
    const title = suggestion.title.trim();
    chips.push(
      Object.freeze({
        ...template,
        label:
          title.length > 0 && title.length <= 28 ? title : template.label
      })
    );
  }
  if (!seen.has("dismiss-next-action")) {
    chips.push(
      SCENE_SAVE_NEXT_ACTION_RESULT_CHIPS.find(
        (chip) => chip.id === "dismiss-next-action"
      )!
    );
  }
  return Object.freeze(chips);
}

export function formatNextActionCoachMessage(
  payload: NextActionV1,
  sceneTitle?: string
): string {
  const where =
    sceneTitle !== undefined && sceneTitle.trim().length > 0
      ? `**${sceneTitle.trim()}**`
      : "this scene";
  const lines = payload.suggestions.map((suggestion, index) => {
    const detail =
      suggestion.rationale.trim().length > 0
        ? suggestion.rationale.trim()
        : suggestion.title.trim();
    return `${index + 1}. ${suggestion.title.trim()} — ${detail}`;
  });
  return [
    SCENE_SAVE_NEXT_ACTION_AUTO_BODY,
    "",
    payload.summary.trim(),
    "",
    `For ${where}:`,
    "",
    ...lines
  ].join("\n");
}
