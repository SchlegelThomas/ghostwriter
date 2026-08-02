import { describe, expect, it } from "vitest";
import {
  chipsFromNextActionV1,
  formatNextActionCoachMessage,
  SCENE_SAVE_NEXT_ACTION_INVITE_CHIPS,
  SCENE_SAVE_NEXT_ACTION_INVITE_PROMPT,
  SCENE_SAVE_NEXT_ACTION_RESULT_CHIPS,
  sceneSaveNextActionDismissKey,
  sceneSaveNextActionResultBody
} from "./scene-save-next-action-invite.js";
import { validateNextActionV1 } from "@ghostwriter/core";

describe("scene-save-next-action-invite", () => {
  it("keys dismiss state by scene and revision", () => {
    expect(sceneSaveNextActionDismissKey("scene_a", 3)).toBe("scene_a:3");
    expect(sceneSaveNextActionDismissKey("scene_a", 4)).not.toBe("scene_a:3");
  });

  it("exposes stable invite and result chips for in-chat next steps", () => {
    expect(SCENE_SAVE_NEXT_ACTION_INVITE_PROMPT).toContain("next steps");
    expect(SCENE_SAVE_NEXT_ACTION_INVITE_CHIPS.map((chip) => chip.id)).toEqual([
      "start-next-action-coach",
      "dismiss-next-action"
    ]);
    expect(SCENE_SAVE_NEXT_ACTION_RESULT_CHIPS.map((chip) => chip.id)).toEqual([
      "continue-writing",
      "dialogue-coach",
      "create-story-knowledge",
      "dismiss-next-action"
    ]);
    expect(sceneSaveNextActionResultBody("The alley")).toContain("The alley");
  });

  it("formats model payload and maps suggestion chips", () => {
    const payload = validateNextActionV1({
      schemaId: "next-action-v1",
      trigger: "scene-prose-saved",
      summary: "Jonah is new on the page.",
      suggestions: [
        {
          kind: "continue-writing",
          title: "Keep drafting",
          rationale: "The ferry beat has momentum."
        },
        {
          kind: "run-catalog-agent",
          title: "Dialogue pass",
          rationale: "Lines need polish.",
          catalogAgentId: "dialogue-coach"
        },
        {
          kind: "create-story-knowledge",
          title: "Add Jonah",
          rationale: "Jonah is not on the roster.",
          proposedName: "Jonah"
        }
      ]
    });
    expect(formatNextActionCoachMessage(payload, "Arrival")).toContain("Jonah is new");
    expect(chipsFromNextActionV1(payload).map((chip) => chip.id)).toEqual([
      "continue-writing",
      "dialogue-coach",
      "create-story-knowledge",
      "dismiss-next-action"
    ]);
  });
});
