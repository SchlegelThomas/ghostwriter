import type { WorkspaceAgentMode } from "./workspace-agent-prefs.js";

export type WorkspaceChatFollowUpChipId = "save-plan" | "open-scene" | "retry";

export type WorkspaceChatFollowUpChip = Readonly<{
  id: WorkspaceChatFollowUpChipId;
  label: string;
}>;

const MAX_FOLLOW_UP_CHIPS = 3;

export function resolveAssistantFollowUpChips(input: Readonly<{
  mode: WorkspaceAgentMode;
  planOutlineText?: string;
  canSavePlan: boolean;
  canOpenScene: boolean;
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
  if (input.canOpenScene) {
    chips.push(Object.freeze({ id: "open-scene", label: "Open scene" }));
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
