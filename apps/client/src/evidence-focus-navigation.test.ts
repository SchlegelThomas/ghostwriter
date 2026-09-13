import { sceneId as toSceneId } from "@ghostwriter/core";
import { describe, expect, it } from "vitest";

import { resolveEvidenceFocusAfterOpenScene } from "./evidence-focus-navigation.js";

const sceneId = toSceneId("scene-evidence");

describe("resolveEvidenceFocusAfterOpenScene", () => {
  it("clears stored focus on scene-only navigation", () => {
    expect(
      resolveEvidenceFocusAfterOpenScene({
        blockId: undefined,
        navigationOpened: true,
        projectOpen: true,
        targetSceneId: sceneId,
        nextRequestId: 1,
      }),
    ).toEqual({ kind: "clear" });
  });

  it("noops when navigation or project is unavailable", () => {
    expect(
      resolveEvidenceFocusAfterOpenScene({
        blockId: "sceneDocumentBlock_test",
        navigationOpened: false,
        projectOpen: true,
        targetSceneId: sceneId,
        nextRequestId: 2,
      }),
    ).toEqual({ kind: "noop" });

    expect(
      resolveEvidenceFocusAfterOpenScene({
        blockId: "sceneDocumentBlock_test",
        navigationOpened: true,
        projectOpen: false,
        targetSceneId: sceneId,
        nextRequestId: 2,
      }),
    ).toEqual({ kind: "noop" });
  });

  it("installs a scene-scoped request without waiting on selectedSceneId", () => {
    expect(
      resolveEvidenceFocusAfterOpenScene({
        blockId: "sceneDocumentBlock_test",
        navigationOpened: true,
        projectOpen: true,
        targetSceneId: sceneId,
        nextRequestId: 3,
      }),
    ).toEqual({
      kind: "install",
      request: {
        id: 3,
        sceneId,
        blockId: "sceneDocumentBlock_test",
      },
    });
  });
});
