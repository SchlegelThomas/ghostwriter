import { blockId, createEmptySceneDocument } from "@ghostwriter/editor";
import { describe, expect, it, vi } from "vitest";
import {
  captureComposerActivity,
  type CaptureComposerProblem
} from "./capture-composer.js";
import {
  buildCaptureAttachmentFileInputAccept,
  captureAttachmentActivityFromPanel,
  captureAttachmentAddControlsDisabled,
  captureAttachmentCanDelete,
  captureAttachmentCanDownload,
  captureAttachmentFilePickerDisabled,
  captureAttachmentPendingExpiryLabel,
  captureAttachmentRefusalLabel,
  captureAttachmentStateLabel,
  captureAttachmentUploadProgressPercent,
  captureAttachmentListScrollStyle,
  CAPTURE_ATTACHMENT_LIST_SCROLL_BOUNDS,
  captureAttachmentsAddAllowed,
  captureComposerMergedActivity,
  captureComposerProblemEventsWithAttachments,
  captureComposerSaveStatusText,
  confirmCaptureAttachmentDelete,
  isCaptureFilePickerAvailable,
  mergeCaptureComposerActivity,
  monotonicCaptureAttachmentUploadPercent,
  type CaptureAttachmentActivity
} from "./capture-attachments-panel.js";
import { CAPTURE_AUDIO_RECORDER_ERROR_MESSAGE } from "./capture-audio-recorder.js";
import type { SceneSaveQueueSnapshot } from "./scene-save-queue.js";

const document = createEmptySceneDocument({
  generateBlockId: () => blockId("block-attachment-panel-test")
});

const draftHead = {
  captureId: "capture-1",
  projectId: "project-1",
  status: "draft",
  sourceModality: "text",
  workingVersion: 1,
  document,
  contentHash: "a".repeat(64),
  genesisRevisionId: "revision-genesis",
  authorAccountId: "account-writer",
  updatedByAccountId: "account-writer",
  createdAt: "2026-07-24T12:00:00.000Z",
  updatedAt: "2026-07-24T12:00:00.000Z"
} as const;

function snapshot(
  overrides: Partial<SceneSaveQueueSnapshot> = {}
): SceneSaveQueueSnapshot {
  return {
    status: "saved",
    dirty: false,
    acknowledgedWorkingVersion: 1,
    latestDocument: document,
    acknowledgedDocument: document,
    ...overrides
  };
}

describe("capture attachment labels", () => {
  it("maps attachment states and refusal codes to plain-language copy", () => {
    expect(captureAttachmentStateLabel("ready")).toBe("Ready");
    expect(captureAttachmentStateLabel("pending")).toBe("Pending");
    expect(captureAttachmentRefusalLabel("unsupported-type")).toMatch(/not allowed/i);
    expect(captureAttachmentRefusalLabel("checksum-mismatch")).toMatch(/verified/i);
    expect(captureAttachmentRefusalLabel(undefined)).toBeUndefined();
  });

  it("formats pending expiry without leaking file content", () => {
    const label = captureAttachmentPendingExpiryLabel("2026-07-24T18:00:00.000Z");
    expect(label).toMatch(/Upload must finish/);
    expect(label).not.toContain("secret");
  });
});

describe("capture attachment action eligibility", () => {
  it("allows add on draft and ready captures only", () => {
    expect(captureAttachmentsAddAllowed({ ...draftHead, status: "draft" })).toBe(
      true
    );
    expect(captureAttachmentsAddAllowed({ ...draftHead, status: "ready" })).toBe(
      true
    );
    expect(
      captureAttachmentsAddAllowed({ ...draftHead, status: "integrated" })
    ).toBe(false);
    expect(
      captureAttachmentsAddAllowed({ ...draftHead, status: "archived" })
    ).toBe(false);
  });

  it("gates download and delete by attachment state", () => {
    expect(captureAttachmentCanDownload("ready")).toBe(true);
    expect(captureAttachmentCanDownload("pending")).toBe(false);
    expect(captureAttachmentCanDelete("deleted")).toBe(false);
    expect(captureAttachmentCanDelete("ready")).toBe(true);
  });

  it("disables add controls while uploading or when not editable", () => {
    expect(
      captureAttachmentAddControlsDisabled({
        attachmentsEditable: false,
        activity: "idle",
        listLoading: false,
        uploadBusy: false,
        filePickerAvailable: true
      })
    ).toBe(true);
    expect(
      captureAttachmentAddControlsDisabled({
        attachmentsEditable: true,
        activity: "recording",
        listLoading: false,
        uploadBusy: false,
        filePickerAvailable: true
      })
    ).toBe(true);
    expect(
      captureAttachmentFilePickerDisabled({
        addControlsDisabled: false,
        filePickerAvailable: false
      })
    ).toBe(true);
  });
});

describe("capture attachment activity merge", () => {
  it("merges prose and attachment activity for shell idle truth", () => {
    expect(
      mergeCaptureComposerActivity("idle", "uploading")
    ).toBe("saving");
    expect(
      mergeCaptureComposerActivity("idle", "recording")
    ).toBe("saving");
    expect(
      mergeCaptureComposerActivity("saving", "idle")
    ).toBe("saving");
    expect(
      mergeCaptureComposerActivity("idle", "problem")
    ).toBe("problem");
  });

  it("derives panel activity from upload and recording flags", () => {
    expect(
      captureAttachmentActivityFromPanel({
        listFailed: false,
        actionProblem: false,
        uploadActive: true,
        recordingActive: false
      })
    ).toBe("uploading");
    expect(
      captureAttachmentActivityFromPanel({
        listFailed: false,
        actionProblem: false,
        uploadActive: false,
        recordingActive: true
      })
    ).toBe("recording");
  });

  it("keeps composer save status honest during attachment upload", () => {
    const saved = captureComposerSaveStatusText({
      snapshot: snapshot(),
      problem: undefined,
      recoveryOffer: false,
      attachmentActivity: "idle"
    });
    expect(saved).toBe("");
    expect(
      captureComposerSaveStatusText({
        snapshot: snapshot(),
        problem: undefined,
        recoveryOffer: false,
        attachmentActivity: "uploading",
        uploadFilename: "sketch.jpg",
        uploadPercent: 42
      })
    ).toBe("Uploading sketch.jpg… 42%");
  });

  it("includes attachment problems in composer problem events", () => {
    const events = captureComposerProblemEventsWithAttachments({
      captureId: "capture-1",
      recoveryOffer: false,
      recoveryMode: undefined,
      problem: undefined,
      attachmentListFailed: true,
      attachmentListFailureMessage: "Ghostwriter could not load Capture attachments."
    });
    expect(events.some((event) => event.id === "capture-attachment:capture-1")).toBe(
      true
    );
  });

  it("merges initializing prose activity with attachment upload", () => {
    const merged = captureComposerMergedActivity({
      snapshot: undefined,
      problem: undefined,
      recoveryOffer: false,
      initializing: true,
      attachmentActivity: "uploading"
    });
    expect(merged).toBe("saving");
    expect(
      captureComposerActivity(undefined, undefined, false, true)
    ).toBe("saving");
  });
});

describe("capture attachment upload progress", () => {
  it("computes percent and keeps it monotonic", () => {
    expect(
      captureAttachmentUploadProgressPercent({ loaded: 50, total: 200 })
    ).toBe(25);
    expect(
      monotonicCaptureAttachmentUploadPercent(40, 30)
    ).toBe(40);
    expect(
      monotonicCaptureAttachmentUploadPercent(undefined, 12)
    ).toBe(12);
  });
});

describe("capture attachment list scroll layout", () => {
  it("bounds scroll height so rows stay reachable in the Capture modal", () => {
    expect(CAPTURE_ATTACHMENT_LIST_SCROLL_BOUNDS.maxHeight).toBeGreaterThan(
      CAPTURE_ATTACHMENT_LIST_SCROLL_BOUNDS.minHeight
    );
    expect(captureAttachmentListScrollStyle()).toEqual({
      minHeight: CAPTURE_ATTACHMENT_LIST_SCROLL_BOUNDS.minHeight,
      maxHeight: CAPTURE_ATTACHMENT_LIST_SCROLL_BOUNDS.maxHeight,
      flexGrow: 0,
      flexShrink: 1
    });
  });
});

describe("capture attachment file picker seam", () => {
  it("detects DOM file input availability and builds accept list", () => {
    expect(isCaptureFilePickerAvailable({})).toBe(false);
    expect(
      isCaptureFilePickerAvailable({
        document: { createElement: vi.fn() }
      })
    ).toBe(true);
    expect(buildCaptureAttachmentFileInputAccept()).toContain("image/jpeg");
    expect(buildCaptureAttachmentFileInputAccept()).toContain("audio/webm");
  });
});

describe("capture attachment delete confirm", () => {
  it("asks for explicit confirmation with filename only", async () => {
    const confirm = vi.fn(async () => true);
    await expect(
      confirmCaptureAttachmentDelete("notes.txt", confirm)
    ).resolves.toBe(true);
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("notes.txt"));
  });
});

describe("capture audio recorder status copy", () => {
  it("keeps stable unavailable and permission copy at the seam", () => {
    expect(CAPTURE_AUDIO_RECORDER_ERROR_MESSAGE.unavailable).toMatch(/unavailable/i);
    expect(CAPTURE_AUDIO_RECORDER_ERROR_MESSAGE.permissionDenied).toMatch(
      /permission/i
    );
  });
});

describe("captureComposerMergedActivity with prose problems", () => {
  it("prefers problem when prose is blocked", () => {
    const problem: CaptureComposerProblem = { kind: "save", message: "blocked" };
    const attachment: CaptureAttachmentActivity = "uploading";
    expect(
      captureComposerMergedActivity({
        snapshot: snapshot({ dirty: true, status: "paused" }),
        problem,
        recoveryOffer: false,
        initializing: false,
        attachmentActivity: attachment
      })
    ).toBe("problem");
  });
});
