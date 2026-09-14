import { canvasObjectId, sceneId, type CanvasObject } from "@ghostwriter/core";
import { describe, expect, it } from "vitest";
import {
  canvasEmptyPresentation,
  canvasLensDescription,
  canvasSearchPresentation
} from "./canvas-discovery-presentation.js";

describe("Canvas discovery presentation", () => {
  it("describes Continuity as its actual filter rather than an assessment", () => {
    expect(canvasLensDescription("continuity")).toContain("Canvas filter");
    expect(canvasLensDescription("continuity")).toContain("not a story assessment");
  });

  it("distinguishes a filter-empty scope from a scope with no placements", () => {
    expect(
      canvasEmptyPresentation({
        lens: "continuity",
        scopeKind: "chapter",
        hiddenByLensCount: 3
      })
    ).toMatchObject({ resetLens: true, showWholeStory: true });
    expect(
      canvasEmptyPresentation({
        lens: "outline",
        scopeKind: "project",
        hiddenByLensCount: 0
      })
    ).toMatchObject({ resetLens: false, showWholeStory: false });
  });

  it("allows archived Canvas placement inspection for restore", () => {
    expect(
      canvasSearchPresentation({
        key: "archived-card",
        label: "Old opening",
        archived: true,
        object: {
          id: canvasObjectId("canvas-object-archived-search"),
          archivedAt: "2026-09-12T00:00:00.000Z"
        } as CanvasObject
      })
    ).toMatchObject({
      action: "inspect-object",
      disabled: false,
      label: "Inspect archived Canvas placement · Old opening"
    });
  });

  it("distinguishes an active placement whose story record is archived", () => {
    expect(
      canvasSearchPresentation({
        key: "active-card-archived-scene",
        label: "Old opening",
        archived: true,
        object: {
          id: canvasObjectId("canvas-object-active-archived-scene")
        } as CanvasObject
      })
    ).toMatchObject({
      action: "inspect-object",
      disabled: false,
      label: "Inspect Canvas placement · archived story record · Old opening"
    });
  });

  it("does not offer placement for an archived unplaced canonical scene", () => {
    expect(
      canvasSearchPresentation({
        key: "archived-scene",
        label: "Removed ending",
        archived: true,
        sceneId: sceneId("scene-archived-search")
      })
    ).toMatchObject({
      action: "none",
      disabled: true,
      label:
        "Archived story record · Removed ending · restore the story record first"
    });
  });
});
