import type { WorkspaceAgentMode } from "./workspace-agent-prefs.js";

export type WorkspaceChatFollowUpChipId = "save-plan" | "open-scene" | "retry";

export type WorkspaceChatFollowUpChip = Readonly<{
  id: WorkspaceChatFollowUpChipId;
  label: string;
}>;

const MAX_FOLLOW_UP_CHIPS = 3;

export function insertableDraftFromAgentReply(body: string): string | undefined {
  const parts = body
    .trim()
    .split(/\n\n+/u)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const draftParts = parts.filter((part) => !part.endsWith("?"));
  const draft = draftParts.join("\n\n").trim();
  if (draft.length < 40) return undefined;
  if (/^(?:On |If we |Two ways |What do you)/u.test(draft)) return undefined;
  return draft;
}

export function resolveAssistantFollowUpChips(input: Readonly<{
  mode: WorkspaceAgentMode;
  planOutlineText?: string;
  canSavePlan: boolean;
  canOpenScene: boolean;
  sceneAlreadyOpen?: boolean;
  hasInsertableDraft?: boolean;
}>): readonly WorkspaceChatFollowUpChip[] {
  const chips: WorkspaceChatFollowUpChip[] = [];
  if (
    input.canSavePlan &&
    input.mode === "plan" &&
    input.planOutlineText !== undefined &&
    input.planOutlineText.trim().length > 0
  ) {
    chips.push(Object.freeze({ id: "save-plan", label: "Save to Plans" }));
  }
  const showOpenScene =
    input.canOpenScene &&
    (input.hasInsertableDraft === true || input.sceneAlreadyOpen !== true);
  if (showOpenScene) {
    chips.push(
      Object.freeze({
        id: "open-scene",
        label: input.hasInsertableDraft === true ? "Open draft" : "Open scene"
      })
    );
  }
  return Object.freeze(chips.slice(0, MAX_FOLLOW_UP_CHIPS));
}

export function resolveSystemFollowUpChips(
  retryable: boolean
): readonly WorkspaceChatFollowUpChip[] {
  if (!retryable) return Object.freeze([]);
  return Object.freeze([
    Object.freeze({ id: "retry", label: "Retry" })
  ] as const);
}
