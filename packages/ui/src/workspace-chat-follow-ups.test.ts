import { describe, expect, it } from "vitest";
import {
  resolveAssistantFollowUpChips,
  resolveSystemFollowUpChips
} from "./workspace-chat-follow-ups.js";

describe("workspace-chat-follow-ups", () => {
  it("offers plan and scene chips when relevant", () => {
    const chips = resolveAssistantFollowUpChips({
      mode: "plan",
      planOutlineText: "Act I beats",
      canSavePlan: true,
      canOpenScene: true
    });
    expect(chips.map((chip) => chip.id)).toEqual(["save-plan", "open-scene"]);
  });

  it("caps assistant chips and skips empty plan text", () => {
    const chips = resolveAssistantFollowUpChips({
      mode: "plan",
      planOutlineText: "   ",
      canSavePlan: true,
      canOpenScene: true
    });
    expect(chips.map((chip) => chip.id)).toEqual(["open-scene"]);
  });

  it("offers retry for retryable system turns", () => {
    expect(resolveSystemFollowUpChips(true)).toEqual([
      { id: "retry", label: "Retry" }
    ]);
    expect(resolveSystemFollowUpChips(false)).toEqual([]);
  });
});
