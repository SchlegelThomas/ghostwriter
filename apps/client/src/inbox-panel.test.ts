import { describe, expect, it } from "vitest";
import type { CaptureSummaryResponse } from "./api.js";
import {
  acknowledgementForInboxArchive,
  captureInboxCanArchive,
  captureInboxCanRequestReflection,
  captureInboxCanRestore,
  captureInboxIntegratedNote,
  captureInboxIsReadOnly,
  captureInboxMetaLine,
  captureInboxRowTitle,
  captureInboxStatusLabel,
  inboxCaptureSessionControlsDisabled,
  inboxLoadPhase,
  inboxPanelActivity,
  inboxPanelProblemEvents,
  INBOX_ARCHIVE_FAILURE_GENERIC,
  INBOX_LOAD_FAILURE_GENERIC,
  messageForInboxArchiveFailure,
  messageForInboxLoadFailure
} from "./inbox-panel.js";
import { GhostwriterApiError } from "./api.js";

function summary(
  overrides: Partial<CaptureSummaryResponse> = {}
): CaptureSummaryResponse {
  return {
    captureId: "capture-inbox-test",
    projectId: "project-harbor",
    status: "draft",
    sourceModality: "text",
    workingVersion: 2,
    authorAccountId: "account-writer",
    createdAt: "2026-07-12T18:00:00.000Z",
    updatedAt: "2026-07-12T18:05:00.000Z",
    ...overrides
  };
}

describe("captureInboxRowTitle", () => {
  it("uses Untitled Capture and a formatted updated time", () => {
    const title = captureInboxRowTitle(summary());
    expect(title).toContain("Untitled Capture");
    expect(title).toContain("2026");
  });
});

describe("captureInboxMetaLine", () => {
  it("labels modality, acknowledged version, time, and status", () => {
    expect(captureInboxMetaLine(summary())).toContain("Typed text");
    expect(captureInboxMetaLine(summary())).toContain("Acknowledged v2");
    expect(captureInboxMetaLine(summary())).toContain("Draft");
    expect(
      captureInboxMetaLine(summary({ sourceModality: "dictation", status: "ready" }))
    ).toContain("Dictation");
    expect(
      captureInboxMetaLine(summary({ sourceModality: "dictation", status: "ready" }))
    ).toContain("Ready");
  });
});

describe("captureInboxStatusLabel", () => {
  it("maps capture statuses for Inbox rows", () => {
    expect(captureInboxStatusLabel("draft")).toBe("Draft");
    expect(captureInboxStatusLabel("ready")).toBe("Ready");
    expect(captureInboxStatusLabel("integrated")).toBe("Integrated");
    expect(captureInboxStatusLabel("archived")).toBe("Archived");
  });
});

describe("captureInbox archive eligibility", () => {
  it("requires acknowledgement before archive and blocks integrated captures", () => {
    expect(captureInboxCanArchive(summary({ workingVersion: 1 }))).toBe(false);
    expect(captureInboxCanArchive(summary({ workingVersion: 2 }))).toBe(true);
    expect(
      captureInboxCanArchive(summary({ status: "integrated", workingVersion: 4 }))
    ).toBe(false);
    expect(
      captureInboxCanArchive(
        summary({ status: "archived", archivedAt: "2026-07-12T19:00:00.000Z" })
      )
    ).toBe(false);
  });

  it("allows restore only for archived captures", () => {
    expect(captureInboxCanRestore(summary())).toBe(false);
    expect(
      captureInboxCanRestore(
        summary({ status: "archived", archivedAt: "2026-07-12T19:00:00.000Z" })
      )
    ).toBe(true);
  });

  it("marks integrated and archived rows read-only", () => {
    expect(captureInboxIsReadOnly(summary())).toBe(false);
    expect(captureInboxIsReadOnly(summary({ status: "integrated" }))).toBe(true);
    expect(captureInboxIsReadOnly(summary({ status: "archived" }))).toBe(true);
  });

  it("allows Scene Partner reflection only for draft or ready Captures", () => {
    expect(captureInboxCanRequestReflection(summary({ status: "draft" }))).toBe(true);
    expect(captureInboxCanRequestReflection(summary({ status: "ready" }))).toBe(true);
    expect(
      captureInboxCanRequestReflection(summary({ status: "integrated" }))
    ).toBe(false);
    expect(captureInboxCanRequestReflection(summary({ status: "archived" }))).toBe(
      false
    );
    expect(captureInboxCanRequestReflection(undefined)).toBe(false);
  });
});

describe("captureInboxIntegratedNote", () => {
  it("shows target scene and formatted integration time", () => {
    const note = captureInboxIntegratedNote(
      summary({
        status: "integrated",
        integratedSceneId: "scene-from-inbox",
        integratedAt: "2026-07-12T19:00:00.000Z"
      })
    );
    expect(note).toContain("Integrated into Draft");
    expect(note).toContain("target scene scene-from-inbox");
    expect(note).toContain("2026");
    expect(note).not.toContain("Ready");
  });
});

describe("inboxCaptureSessionControlsDisabled", () => {
  it("locks capture selection and row navigation while load, archive, or handoff is busy", () => {
    expect(
      inboxCaptureSessionControlsDisabled({
        loading: false,
        rowActionBusy: false,
        handoffBusy: false
      })
    ).toBe(false);
    expect(
      inboxCaptureSessionControlsDisabled({
        loading: true,
        rowActionBusy: false,
        handoffBusy: false
      })
    ).toBe(true);
    expect(
      inboxCaptureSessionControlsDisabled({
        loading: false,
        rowActionBusy: true,
        handoffBusy: false
      })
    ).toBe(true);
    expect(
      inboxCaptureSessionControlsDisabled({
        loading: false,
        rowActionBusy: false,
        handoffBusy: true
      })
    ).toBe(true);
    expect(
      inboxCaptureSessionControlsDisabled({
        loading: false,
        rowActionBusy: false,
        handoffBusy: false,
        reflectionBusy: true
      })
    ).toBe(true);
  });
});

describe("inboxLoadPhase", () => {
  it("derives loading, failure, empty, and ready phases", () => {
    expect(
      inboxLoadPhase({ loading: true, loadFailed: false, captureCount: 0 })
    ).toBe("loading");
    expect(
      inboxLoadPhase({ loading: false, loadFailed: true, captureCount: 0 })
    ).toBe("failure");
    expect(
      inboxLoadPhase({ loading: false, loadFailed: false, captureCount: 0 })
    ).toBe("empty");
    expect(
      inboxLoadPhase({ loading: false, loadFailed: false, captureCount: 2 })
    ).toBe("ready");
  });
});

describe("inboxPanelActivity", () => {
  it("surfaces loading and problem activity for the shell", () => {
    expect(
      inboxPanelActivity({ loading: false, loadFailed: true, rowActionBusy: false })
    ).toBe("problem");
    expect(
      inboxPanelActivity({ loading: true, loadFailed: false, rowActionBusy: false })
    ).toBe("loading");
    expect(
      inboxPanelActivity({ loading: false, loadFailed: false, rowActionBusy: true })
    ).toBe("loading");
    expect(
      inboxPanelActivity({ loading: false, loadFailed: false, rowActionBusy: false })
    ).toBe("idle");
  });
});

describe("inbox failure copy", () => {
  it("keeps list and archive failures content-free", () => {
    expect(messageForInboxLoadFailure(new Error("db prose"))).toBe(
      INBOX_LOAD_FAILURE_GENERIC
    );
    expect(messageForInboxArchiveFailure(new Error("constraint"))).toBe(
      INBOX_ARCHIVE_FAILURE_GENERIC
    );
    expect(
      messageForInboxLoadFailure(new GhostwriterApiError(401, "UNAUTHORIZED", "nope"))
    ).toMatch(/session ended/i);
  });

  it("emits stable inbox problem events", () => {
    const events = inboxPanelProblemEvents({
      projectId: "project-harbor",
      loadFailed: true,
      loadFailureMessage: INBOX_LOAD_FAILURE_GENERIC,
      rowFailure: {
        captureId: "capture-inbox-test",
        message: INBOX_ARCHIVE_FAILURE_GENERIC
      }
    });
    expect(events).toHaveLength(2);
    expect(events[0]?.detail).toBe(INBOX_LOAD_FAILURE_GENERIC);
    expect(events[1]?.detail).toBe(INBOX_ARCHIVE_FAILURE_GENERIC);
  });
});

describe("acknowledgementForInboxArchive", () => {
  it("returns archive and restore acknowledgement copy", () => {
    expect(acknowledgementForInboxArchive(true).kind).toBe("archive");
    expect(acknowledgementForInboxArchive(false).kind).toBe("restore");
  });
});
