import {
  bookId,
  chapterId,
  partId,
  projectId,
  sceneId,
  type ProjectNavigator
} from "@ghostwriter/core";
import { blockId, type SceneDocumentV1 } from "@ghostwriter/editor";
import { describe, expect, it } from "vitest";
import { GhostwriterApiError, type CaptureHeadResponse } from "./api.js";
import {
  buildCaptureHandoffPromoteRequest,
  captureContentHashPrefix,
  captureHandoffAuthorityReceiptLines,
  captureHandoffCanvasGeometryHintText,
  captureHandoffDefaultFormState,
  captureHandoffPanelSessionForCapture,
  captureHandoffPanelShouldResetSession,
  captureHandoffIntegratedReceiptLines,
  captureHandoffIsEligibleHead,
  captureHandoffIsEligibleSummary,
  captureHandoffOpenDraftAvailable,
  captureHandoffPreviewLines,
  CAPTURE_HANDOFF_CAPTURE_CHANGED,
  CAPTURE_HANDOFF_CANVAS_CHANGED,
  CAPTURE_HANDOFF_CANVAS_GEOMETRY_BOUNDS,
  CAPTURE_HANDOFF_DEFAULT_SCENE_TITLE,
  CAPTURE_HANDOFF_NOT_PROMOTABLE,
  CAPTURE_HANDOFF_PREVIEW_FOOTER,
  CAPTURE_HANDOFF_PROJECT_CHANGED,
  CAPTURE_HANDOFF_PROMOTION_FAILURE_GENERIC,
  acknowledgementCopyForCapturePromotion,
  captureHandoffValidateForm,
  defaultCaptureHandoffCanvasGeometry,
  handoffReceiptOpenMode,
  handoffTargetShouldAbortAfterDraftPrepFailed,
  inboxHandoffLayoutMode,
  inboxHandoffShowsDetailPane,
  inboxHandoffShowsList,
  installCapturePromotionState,
  messageForCaptureHandoffPromotionFailure
} from "./capture-handoff.js";
import { encodeManuscriptHandoffKey } from "./manuscript-handoff-placement.js";
import type { CaptureSummaryResponse } from "./api.js";

const project = projectId("project-handoff");
const activeBook = bookId("book-active");
const chapterOpening = chapterId("chapter-opening");
const partOne = partId("part-one");

const navigator: ProjectNavigator = {
  id: project,
  title: "Handoff",
  version: 4,
  books: [
    {
      id: activeBook,
      title: "Active novel",
      status: "drafting",
      parts: [
        {
          id: partOne,
          title: "Part I",
          chapters: [
            {
              id: chapterOpening,
              title: "Opening",
              scenes: [{ id: sceneId("scene-a"), title: "First", status: "drafting" }]
            }
          ]
        }
      ],
      unassignedScenes: [],
      editions: [],
      sceneCount: 1
    }
  ],
  storyKnowledge: [],
  totals: { books: 1, scenes: 1, storyKnowledge: 0, editions: 0 }
};

const proseDocument: SceneDocumentV1 = {
  schemaVersion: 1,
  document: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        attrs: { id: blockId("block-handoff") },
        content: [{ type: "text", text: "Harbor light on the water." }]
      }
    ]
  }
};

const emptyDocument: SceneDocumentV1 = {
  schemaVersion: 1,
  document: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        attrs: { id: blockId("block-empty") }
      }
    ]
  }
};

function captureHead(
  overrides: Partial<CaptureHeadResponse> = {}
): CaptureHeadResponse {
  return {
    captureId: "capture-handoff",
    projectId: project,
    status: "ready",
    sourceModality: "text",
    workingVersion: 2,
    document: proseDocument,
    contentHash: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
    genesisRevisionId: "capture-revision-genesis",
    authorAccountId: "account-writer",
    updatedByAccountId: "account-writer",
    createdAt: "2026-07-12T18:00:00.000Z",
    updatedAt: "2026-07-12T18:05:00.000Z",
    ...overrides
  };
}

function summary(
  overrides: Partial<CaptureSummaryResponse> = {}
): CaptureSummaryResponse {
  return {
    captureId: "capture-handoff",
    projectId: project,
    status: "ready",
    sourceModality: "text",
    workingVersion: 2,
    authorAccountId: "account-writer",
    createdAt: "2026-07-12T18:00:00.000Z",
    updatedAt: "2026-07-12T18:05:00.000Z",
    ...overrides
  };
}

describe("capture handoff eligibility", () => {
  it("allows acknowledged nonempty draft/ready captures", () => {
    expect(captureHandoffIsEligibleSummary(summary())).toBe(true);
    expect(captureHandoffIsEligibleHead(captureHead())).toBe(true);
  });

  it("refuses unacknowledged, empty, archived, and integrated captures", () => {
    expect(captureHandoffIsEligibleSummary(summary({ workingVersion: 1 }))).toBe(
      false
    );
    expect(
      captureHandoffIsEligibleHead(
        captureHead({ workingVersion: 1, document: proseDocument })
      )
    ).toBe(false);
    expect(
      captureHandoffIsEligibleHead(captureHead({ document: emptyDocument }))
    ).toBe(false);
    expect(captureHandoffIsEligibleSummary(summary({ status: "archived" }))).toBe(
      false
    );
    expect(
      captureHandoffIsEligibleSummary(summary({ status: "integrated" }))
    ).toBe(false);
  });
});

describe("capture handoff validation and preview", () => {
  it("defaults title and placement from the project navigator", () => {
    const form = captureHandoffDefaultFormState(navigator);
    expect(form.title).toBe(CAPTURE_HANDOFF_DEFAULT_SCENE_TITLE);
    expect(form.canvasEnabled).toBe(false);
    expect(form.placementKey).toBe(
      encodeManuscriptHandoffKey(activeBook, "unassigned")
    );
  });

  it("requires a trimmed title and valid placement", () => {
    const form = captureHandoffDefaultFormState(navigator);
    expect(captureHandoffValidateForm(navigator, form).valid).toBe(true);
    expect(
      captureHandoffValidateForm(navigator, { ...form, title: "   " }).valid
    ).toBe(false);
    expect(
      captureHandoffValidateForm(navigator, { ...form, placementKey: "bad" })
        .valid
    ).toBe(false);
  });

  it("builds preview lines with hash prefix, versions, placement, and footer", () => {
    const head = captureHead();
    const form = captureHandoffDefaultFormState(navigator);
    const lines = captureHandoffPreviewLines({
      captureHead: head,
      projectVersion: 4,
      canvasVersion: 2,
      project: navigator,
      placementKey: form.placementKey,
      canvasEnabled: true
    });
    expect(lines[0]).toContain("v2");
    expect(lines[0]).toContain(captureContentHashPrefix(head.contentHash));
    expect(lines.some((line) => line.includes("Project · v4"))).toBe(true);
    expect(lines.some((line) => line.includes("Canvas · board v2"))).toBe(true);
    expect(lines.some((line) => line.includes("Active novel · Unassigned"))).toBe(
      true
    );
    expect(lines.at(-1)).toBe(CAPTURE_HANDOFF_PREVIEW_FOOTER);
  });

  it("includes authority receipt copy without model language", () => {
    expect(captureHandoffAuthorityReceiptLines().join(" ")).toMatch(/no AI/i);
    expect(captureHandoffAuthorityReceiptLines().join(" ")).not.toMatch(/gpt|model/i);
  });
});

describe("capture handoff canvas defaults", () => {
  const placementKey = encodeManuscriptHandoffKey(activeBook, chapterOpening);

  it("uses bounded geometry and manuscript-derived story order hint", () => {
    const geometry = defaultCaptureHandoffCanvasGeometry({
      project: navigator,
      placementKey,
      expectedCanvasVersion: 3
    });
    expect(geometry).toEqual({
      expectedCanvasVersion: 3,
      x: CAPTURE_HANDOFF_CANVAS_GEOMETRY_BOUNDS.defaultX,
      y: CAPTURE_HANDOFF_CANVAS_GEOMETRY_BOUNDS.defaultY,
      width: CAPTURE_HANDOFF_CANVAS_GEOMETRY_BOUNDS.defaultWidth,
      height: CAPTURE_HANDOFF_CANVAS_GEOMETRY_BOUNDS.defaultHeight,
      z: CAPTURE_HANDOFF_CANVAS_GEOMETRY_BOUNDS.defaultZ,
      storyOrderHint: 1
    });
    expect(captureHandoffCanvasGeometryHintText(navigator, placementKey)).toContain(
      "240×160"
    );
  });

  it("builds promote requests with optional canvas payload", () => {
    const form = {
      ...captureHandoffDefaultFormState(navigator),
      placementKey,
      canvasEnabled: true
    };
    const request = buildCaptureHandoffPromoteRequest({
      captureId: "capture-handoff",
      captureHead: captureHead(),
      projectVersion: 4,
      project: navigator,
      form,
      canvas: defaultCaptureHandoffCanvasGeometry({
        project: navigator,
        placementKey,
        expectedCanvasVersion: 1
      })
    });
    expect(request?.title).toBe(CAPTURE_HANDOFF_DEFAULT_SCENE_TITLE);
    expect(request?.canvas?.storyOrderHint).toBe(1);
  });
});

describe("capture handoff promotion failures", () => {
  it("maps stable conflict codes to content-free copy", () => {
    expect(
      messageForCaptureHandoffPromotionFailure(
        new GhostwriterApiError(409, "CAPTURE_VERSION_CONFLICT", "leak")
      )
    ).toBe(CAPTURE_HANDOFF_CAPTURE_CHANGED);
    expect(
      messageForCaptureHandoffPromotionFailure(
        new GhostwriterApiError(409, "CAPTURE_CONTENT_CHANGED", "leak")
      )
    ).toBe(CAPTURE_HANDOFF_CAPTURE_CHANGED);
    expect(
      messageForCaptureHandoffPromotionFailure(
        new GhostwriterApiError(409, "CAPTURE_NOT_PROMOTABLE", "leak")
      )
    ).toBe(CAPTURE_HANDOFF_NOT_PROMOTABLE);
    expect(
      messageForCaptureHandoffPromotionFailure(
        new GhostwriterApiError(409, "VERSION_CONFLICT", "leak")
      )
    ).toBe(CAPTURE_HANDOFF_PROJECT_CHANGED);
    expect(
      messageForCaptureHandoffPromotionFailure(
        new GhostwriterApiError(409, "CANVAS_VERSION_CONFLICT", "leak")
      )
    ).toBe(CAPTURE_HANDOFF_CANVAS_CHANGED);
    expect(messageForCaptureHandoffPromotionFailure(new Error("db leak"))).toBe(
      CAPTURE_HANDOFF_PROMOTION_FAILURE_GENERIC
    );
    expect(
      messageForCaptureHandoffPromotionFailure(
        new GhostwriterApiError(409, "CAPTURE_VERSION_CONFLICT", "leak")
      )
    ).not.toContain("leak");
  });
});

describe("capture handoff integrated receipt", () => {
  it("surfaces integration provenance and open-draft availability", () => {
    const head = captureHead({
      status: "integrated",
      integratedSceneId: "scene-from-capture",
      integrationRevisionId: "capture-revision-integrated",
      integratedAt: "2026-07-12T19:00:00.000Z",
      integratedByAccountId: "account-writer"
    });
    const lines = captureHandoffIntegratedReceiptLines(head);
    expect(lines.some((line) => line.includes("scene-from-capture"))).toBe(true);
    expect(lines.some((line) => line.includes("capture-revision-integrated"))).toBe(
      true
    );
    expect(captureHandoffOpenDraftAvailable(head)).toBe(true);
    expect(captureHandoffOpenDraftAvailable(captureHead())).toBe(false);
  });
});

describe("capture handoff panel session", () => {
  it("detects capture or project scope changes", () => {
    expect(
      captureHandoffPanelShouldResetSession({
        captureId: "capture-a",
        projectId: "project-a",
        previousCaptureId: "capture-a",
        previousProjectId: "project-a"
      })
    ).toBe(false);
    expect(
      captureHandoffPanelShouldResetSession({
        captureId: "capture-b",
        projectId: "project-a",
        previousCaptureId: "capture-a",
        previousProjectId: "project-a"
      })
    ).toBe(true);
    expect(
      captureHandoffPanelShouldResetSession({
        captureId: "capture-a",
        projectId: "project-b",
        previousCaptureId: "capture-a",
        previousProjectId: "project-a"
      })
    ).toBe(true);
    expect(
      captureHandoffPanelShouldResetSession({
        captureId: "capture-a",
        projectId: "project-a"
      })
    ).toBe(true);
  });

  it("rebuilds default form and clears apply errors for a new capture", () => {
    const first = captureHandoffPanelSessionForCapture({
      project: navigator,
      captureHead: captureHead({ captureId: "capture-one" })
    });
    const second = captureHandoffPanelSessionForCapture({
      project: navigator,
      captureHead: captureHead({
        captureId: "capture-two",
        workingVersion: 3
      })
    });
    expect(first.form).toEqual(captureHandoffDefaultFormState(navigator));
    expect(first.applying).toBe(false);
    expect(first.errorMessage).toBeUndefined();
    expect(second.head.captureId).toBe("capture-two");
    expect(second.head.workingVersion).toBe(3);
    expect(second.form.title).toBe(CAPTURE_HANDOFF_DEFAULT_SCENE_TITLE);
    expect(second.errorMessage).toBeUndefined();
  });
});

describe("inbox handoff layout helpers", () => {
  it("uses stack list→detail for all widths (no wide split)", () => {
    expect(inboxHandoffLayoutMode(false, undefined)).toBe("list-only");
    expect(inboxHandoffLayoutMode(false, "capture-a")).toBe("detail-only");
    expect(inboxHandoffShowsList(false, undefined)).toBe(true);
    expect(inboxHandoffShowsList(false, "capture-a")).toBe(false);
    expect(inboxHandoffShowsDetailPane(false, undefined)).toBe(false);
    expect(inboxHandoffShowsDetailPane(false, "capture-a")).toBe(true);

    expect(inboxHandoffLayoutMode(true, undefined)).toBe("list-only");
    expect(inboxHandoffLayoutMode(true, "capture-a")).toBe("detail-only");
    expect(inboxHandoffShowsList(true, "capture-a")).toBe(false);
    expect(inboxHandoffShowsDetailPane(true, undefined)).toBe(false);
    expect(inboxHandoffShowsDetailPane(true, "capture-a")).toBe(true);
  });
});

describe("capture promotion shell helpers", () => {
  it("installs navigator and optional canvas from a promotion response", () => {
    const navigatorAfter = { ...navigator, version: 5 };
    const installed = installCapturePromotionState({
      captureHead: captureHead({ status: "integrated" }),
      scene: { id: sceneId("scene-new"), title: "From Capture" } as never,
      sceneDocumentHead: {} as never,
      navigator: navigatorAfter,
      canvas: {
        board: { version: 9, objects: [], links: [] },
        projectId: project
      } as never
    });
    expect(installed.navigator.version).toBe(5);
    expect(installed.canvasWorkspace?.board.version).toBe(9);
  });

  it("builds promotion acknowledgement copy from the created scene", () => {
    expect(
      acknowledgementCopyForCapturePromotion({
        captureHead: captureHead(),
        scene: { id: sceneId("scene-new"), title: "Harbor steps" } as never,
        sceneDocumentHead: {} as never,
        navigator
      })
    ).toEqual({
      title: "Capture integrated",
      detail: "Harbor steps · Saved to project"
    });
  });

  it("withholds split receipt navigation on compact layouts", () => {
    expect(handoffReceiptOpenMode("draft", true)).toBe("draft");
    expect(handoffReceiptOpenMode("split", true)).toBeUndefined();
    expect(handoffReceiptOpenMode("split", false)).toBe("split");
  });

  it("aborts handoff navigation when draft preparation fails", () => {
    expect(handoffTargetShouldAbortAfterDraftPrepFailed(true)).toBe(true);
    expect(handoffTargetShouldAbortAfterDraftPrepFailed(false)).toBe(false);
  });
});
