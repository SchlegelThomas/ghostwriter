import { describe, expect, it } from "vitest";
import {
  canvasHistoryQuerySchema,
  createSceneFromCanvasRequestSchema,
  executeCanvasCommandRequestSchema,
  saveCanvasPersonalViewRequestSchema,
  toCanvasPersonalViewRequest,
  toCanvasCommand
} from "./api-contract.js";

const note = {
  kind: "note",
  x: 10,
  y: 20,
  width: 200,
  height: 120,
  z: 1,
  authority: "confirmed",
  label: "Scoped note"
} as const;

const canvasGeometry = {
  x: 10,
  y: 20,
  width: 200,
  height: 120,
  z: 1,
  label: "Scoped scene"
} as const;

describe("Canvas scope API contracts", () => {
  it("accepts only strict, refined scope membership commands", () => {
    const command = {
      type: "canvas.object.setScopeMembership",
      objectId: "canvas-object",
      scopeKind: "chapter",
      scopeId: "chapter-low-tide",
      member: true
    };
    const parsed = executeCanvasCommandRequestSchema.safeParse({
      expectedCanvasVersion: 1,
      command
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(toCanvasCommand(parsed.data.command)).toEqual(command);
    }
    expect(
      executeCanvasCommandRequestSchema.safeParse({
        expectedCanvasVersion: 1,
        command: { ...command, member: false }
      }).success
    ).toBe(true);
    for (const invalid of [
      { ...command, scopeKind: "project", scopeId: "not-allowed" },
      { ...command, scopeId: undefined },
      { ...command, member: "true" },
      { ...command, extra: true }
    ]) {
      expect(
        executeCanvasCommandRequestSchema.safeParse({
          expectedCanvasVersion: 1,
          command: invalid
        }).success
      ).toBe(false);
    }
  });

  it("defaults and bounds Canvas history pagination", () => {
    expect(canvasHistoryQuerySchema.parse({})).toEqual({ limit: 100 });
    expect(canvasHistoryQuerySchema.parse({ limit: "25", beforeVersion: "80" }))
      .toEqual({ limit: 25, beforeVersion: 80 });
    expect(canvasHistoryQuerySchema.safeParse({ limit: "101" }).success)
      .toBe(false);
    expect(canvasHistoryQuerySchema.safeParse({ beforeVersion: "0" }).success)
      .toBe(false);
  });

  it.each([
    { scopeKind: "project", scopeId: "not-allowed" },
    { scopeKind: "chapter" },
    { scopeKind: "scene" }
  ])("rejects invalid create/place scope $scopeKind", (scope) => {
    expect(
      executeCanvasCommandRequestSchema.safeParse({
        expectedCanvasVersion: 1,
        command: { type: "canvas.object.create", object: note, scope }
      }).success
    ).toBe(false);
  });

  it("accepts a refined chapter scope for create and scene creation", () => {
    const scope = { scopeKind: "chapter", scopeId: "chapter-low-tide" };
    expect(
      executeCanvasCommandRequestSchema.safeParse({
        expectedCanvasVersion: 1,
        command: { type: "canvas.object.create", object: note, scope }
      }).success
    ).toBe(true);
    expect(
      createSceneFromCanvasRequestSchema.safeParse({
        expectedProjectVersion: 1,
        expectedCanvasVersion: 1,
        title: "Canvas scene",
        manuscriptPlacement: {
          kind: "chapter",
          bookId: "book-one",
          chapterId: "chapter-low-tide"
        },
        canvas: { ...canvasGeometry, scope }
      }).success
    ).toBe(true);
  });

  it("applies the same scope refinement to atomic scene creation", () => {
    expect(
      createSceneFromCanvasRequestSchema.safeParse({
        expectedProjectVersion: 1,
        expectedCanvasVersion: 1,
        title: "Canvas scene",
        manuscriptPlacement: {
          kind: "unassigned",
          bookId: "book-one"
        },
        canvas: {
          ...canvasGeometry,
          scope: { scopeKind: "project", scopeId: "not-allowed" }
        }
      }).success
    ).toBe(false);
  });

  it("accepts a closed, bounded personal scope view with explicit clears", () => {
    const parsed = saveCanvasPersonalViewRequestSchema.parse({
      expectedPreferenceVersion: 0,
      scopeView: {
        scope: { scopeKind: "scene", scopeId: "scene-arrival" },
        viewport: { x: 10, y: -20, zoom: 1.5 },
        viewMode: "outline",
        inspectorOpen: false,
        focusToken: "search",
        selectedObjectId: null,
        inspectedSceneId: "scene-arrival",
        workflowLens: "continuity"
      },
      lastScope: { scopeKind: "scene", scopeId: "scene-arrival" }
    });
    expect(toCanvasPersonalViewRequest(parsed)).toEqual({
      expectedPreferenceVersion: 0,
      scopeView: {
        scope: { scopeKind: "scene", scopeId: "scene-arrival" },
        viewport: { x: 10, y: -20, zoom: 1.5 },
        viewMode: "outline",
        inspectorOpen: false,
        focusToken: "search",
        inspectedSceneId: "scene-arrival",
        workflowLens: "continuity"
      },
      lastScope: { scopeKind: "scene", scopeId: "scene-arrival" }
    });
  });

  it.each([
    { expectedPreferenceVersion: -1 },
    { scopeView: { viewMode: "cards" } },
    { scopeView: { viewport: { x: Number.POSITIVE_INFINITY } } },
    { scopeView: { focusToken: "toolbar" } },
    { scopeView: { workflowLens: "characters" } },
    { scopeView: { extra: true } },
    { lastScope: { scopeKind: "project", scopeId: "forbidden" } }
  ])("rejects invalid personal Canvas view payload %#", (patch) => {
    const valid = {
      expectedPreferenceVersion: 1,
      scopeView: {
        scope: { scopeKind: "project" },
        viewport: { x: 0, y: 0, zoom: 1 },
        viewMode: "spatial",
        inspectorOpen: false,
        focusToken: "surface",
        workflowLens: "outline"
      },
      lastScope: { scopeKind: "project" }
    };
    const candidate = {
      ...valid,
      ...patch,
      ...(patch.scopeView === undefined
        ? {}
        : { scopeView: { ...valid.scopeView, ...patch.scopeView } })
    };
    expect(saveCanvasPersonalViewRequestSchema.safeParse(candidate).success)
      .toBe(false);
  });
});
