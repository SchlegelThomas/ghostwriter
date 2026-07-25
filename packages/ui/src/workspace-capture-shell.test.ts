import { describe, expect, it } from "vitest";
import {
  aggregateProjectChangesIdle,
  captureReturnStateFromScene,
  captureShellChangesIdle,
  centerUsesDenseColumn,
  finalizeCaptureShellActivityOnClose,
  inboxOpenLeavesCharactersRail,
  inboxTakesCenterWorkspace,
  NARROW_CAPTURE_TAB_LABEL,
  NARROW_INBOX_TAB_LABEL,
  restoreCaptureReturnFocus,
  scheduleCaptureFocusRestore,
  workspaceNavigationClosesInbox,
  inboxSelectionDiffersFromModalCapture
} from "./workspace-capture-shell.js";

describe("workspace capture shell helpers", () => {
  it("exposes narrow Capture and Plans tab labels", () => {
    expect(NARROW_CAPTURE_TAB_LABEL).toBe("Idea Capture");
    expect(NARROW_INBOX_TAB_LABEL).toBe("Plans");
  });

  it("treats open Plans as always owning the center workspace", () => {
    expect(inboxTakesCenterWorkspace(false)).toBe(false);
    expect(inboxTakesCenterWorkspace(true)).toBe(true);
  });

  it("uses a dense center column whenever Inbox owns the center", () => {
    expect(centerUsesDenseColumn(false, false)).toBe(false);
    expect(centerUsesDenseColumn(true, false)).toBe(true);
    expect(centerUsesDenseColumn(false, true)).toBe(true);
    expect(centerUsesDenseColumn(true, true)).toBe(true);
  });

  it("leaves the Characters rail when Inbox opens", () => {
    expect(inboxOpenLeavesCharactersRail("characters")).toBe(true);
    expect(inboxOpenLeavesCharactersRail("write")).toBe(false);
  });

  it("closes Inbox on primary workspace navigation actions", () => {
    expect(workspaceNavigationClosesInbox("mode-change")).toBe(true);
    expect(workspaceNavigationClosesInbox("reader")).toBe(true);
    expect(workspaceNavigationClosesInbox("manuscript-selection")).toBe(true);
    expect(workspaceNavigationClosesInbox("project-back")).toBe(true);
  });

  it("aggregates idle state across draft, canvas, capture, and inbox", () => {
    const allIdle = {
      projectSaveIdle: true,
      canvasSaveIdle: true,
      draftActivityIdle: true,
      captureActivityIdle: true,
      inboxActivityIdle: true,
      shellBusy: false,
      canvasBusy: false
    };
    expect(aggregateProjectChangesIdle(allIdle)).toBe(true);
    expect(
      aggregateProjectChangesIdle({ ...allIdle, captureActivityIdle: false })
    ).toBe(false);
    expect(
      aggregateProjectChangesIdle({ ...allIdle, inboxActivityIdle: false })
    ).toBe(false);
    expect(aggregateProjectChangesIdle({ ...allIdle, shellBusy: true })).toBe(
      false
    );
  });

  it("preserves scene selection and restores DOM focus after Capture", () => {
    let focused = false;
    const state = captureReturnStateFromScene("scene-a", {
      focus: () => {
        focused = true;
      }
    });
    expect(state.selectedSceneId).toBe("scene-a");
    restoreCaptureReturnFocus(state);
    expect(focused).toBe(true);
    restoreCaptureReturnFocus(undefined);
    expect(focused).toBe(true);
  });

  it("keeps shell not idle when a Capture problem persists after close", () => {
    expect(
      captureShellChangesIdle({
        modalOpen: false,
        activity: "idle",
        problemWhileClosed: true
      })
    ).toBe(false);
    expect(
      captureShellChangesIdle({
        modalOpen: false,
        activity: "problem",
        problemWhileClosed: true
      })
    ).toBe(false);
    expect(
      captureShellChangesIdle({
        modalOpen: false,
        activity: "idle",
        problemWhileClosed: false
      })
    ).toBe(true);
  });

  it("tracks open Capture saving separately from closed shell state", () => {
    expect(
      captureShellChangesIdle({
        modalOpen: true,
        activity: "saving",
        problemWhileClosed: false
      })
    ).toBe(false);
    expect(
      captureShellChangesIdle({
        modalOpen: true,
        activity: "idle",
        problemWhileClosed: false
      })
    ).toBe(true);
  });

  it("finalizes Capture activity on close without clearing problems", () => {
    expect(
      finalizeCaptureShellActivityOnClose("problem", false)
    ).toEqual({ activity: "problem", problemWhileClosed: true });
    expect(finalizeCaptureShellActivityOnClose("saving", false)).toEqual({
      activity: "idle",
      problemWhileClosed: false
    });
    expect(finalizeCaptureShellActivityOnClose("idle", true)).toEqual({
      activity: "problem",
      problemWhileClosed: true
    });
  });

  it("defers focus restore through a scheduler", () => {
    let focused = false;
    const runs: Array<() => void> = [];
    scheduleCaptureFocusRestore(
      captureReturnStateFromScene(undefined, {
        focus: () => {
          focused = true;
        }
      }),
      (run) => runs.push(run)
    );
    expect(focused).toBe(false);
    runs[0]?.();
    expect(focused).toBe(true);
  });

  it("preserves scene selection and restores DOM focus after Capture", () => {
    let focused = false;
    const state = captureReturnStateFromScene("scene-a", {
      focus: () => {
        focused = true;
      }
    });
    expect(state.selectedSceneId).toBe("scene-a");
    restoreCaptureReturnFocus(state);
    expect(focused).toBe(true);
    restoreCaptureReturnFocus(undefined);
    expect(focused).toBe(true);
  });

  it("keeps Inbox selection independent from modal Capture id", () => {
    expect(
      inboxSelectionDiffersFromModalCapture({
        inboxSelectedCaptureId: "capture-a",
        modalCaptureId: "capture-b",
        modalOpen: true
      })
    ).toBe(true);
    expect(
      inboxSelectionDiffersFromModalCapture({
        inboxSelectedCaptureId: "capture-a",
        modalCaptureId: "capture-a",
        modalOpen: true
      })
    ).toBe(false);
    expect(
      inboxSelectionDiffersFromModalCapture({
        inboxSelectedCaptureId: "capture-a",
        modalCaptureId: "capture-b",
        modalOpen: false
      })
    ).toBe(false);
  });
});
