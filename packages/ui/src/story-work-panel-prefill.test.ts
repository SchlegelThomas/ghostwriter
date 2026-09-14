import { describe, expect, it } from "vitest";
import { sceneId } from "@ghostwriter/core";
import {
  sanitizeStoryWorkRevisePrefill,
  shouldApplyStoryWorkPanelPrefill
} from "./story-work-panel-prefill.js";

const harbor = sceneId("scene-harbor");
const dock = sceneId("scene-dock");
const missing = sceneId("scene-missing");

describe("story work panel revise prefill", () => {
  it("applies only when the request token changes", () => {
    expect(shouldApplyStoryWorkPanelPrefill(undefined, "token-a")).toBe(true);
    expect(shouldApplyStoryWorkPanelPrefill("token-a", "token-a")).toBe(false);
    expect(shouldApplyStoryWorkPanelPrefill("token-a", "token-b")).toBe(true);
    expect(shouldApplyStoryWorkPanelPrefill("token-a", undefined)).toBe(false);
    expect(shouldApplyStoryWorkPanelPrefill("token-a", "   ")).toBe(false);
  });

  it("sanitizes unknown scene IDs without substituting unrelated scenes", () => {
    const result = sanitizeStoryWorkRevisePrefill(
      {
        targetSceneId: missing,
        brief: "Fix the dock timing.",
        constraints: "Keep Mara’s voice.",
        doneWhen: "The arrival reads consistently.",
        sceneIds: [harbor, missing, harbor, dock]
      },
      [harbor, dock]
    );
    expect(result.targetSceneId).toBeUndefined();
    expect(result.sceneIds).toEqual([harbor, dock]);
    expect(result.brief).toBe("Fix the dock timing.");
    expect(result.warnings.join(" ")).toContain("revision scene");
    expect(result.warnings.join(" ")).toContain("source scene");
  });

  it("passes through valid target and sources unchanged", () => {
    const result = sanitizeStoryWorkRevisePrefill(
      {
        targetSceneId: harbor,
        brief: "Brief",
        constraints: "Constraints",
        doneWhen: "Done",
        sceneIds: [dock]
      },
      [harbor, dock]
    );
    expect(result).toMatchObject({
      targetSceneId: harbor,
      brief: "Brief",
      constraints: "Constraints",
      doneWhen: "Done",
      sceneIds: [dock],
      warnings: []
    });
  });
});
