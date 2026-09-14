import { describe, expect, it } from "vitest";
import {
  insertableDraftFromAgentReply,
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

  it("offers Open draft when the reply includes insertable prose", () => {
    const chips = resolveAssistantFollowUpChips({
      mode: "chat",
      canSavePlan: false,
      canOpenScene: true,
      sceneAlreadyOpen: true,
      hasInsertableDraft: true
    });
    expect(chips).toEqual([{ id: "open-scene", label: "Open draft" }]);
  });

  it("extracts continuation prose and drops the closing question", () => {
    expect(
      insertableDraftFromAgentReply(
        "The parchment warmed against his thumbs.\n\nWant it darker, quieter, or dropped into the scene?"
      )
    ).toBe("The parchment warmed against his thumbs.");
  });

  it("hides Open scene when the draft is already on screen", () => {
    const chips = resolveAssistantFollowUpChips({
      mode: "chat",
      canSavePlan: false,
      canOpenScene: true,
      sceneAlreadyOpen: true
    });
    expect(chips).toEqual([]);
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
