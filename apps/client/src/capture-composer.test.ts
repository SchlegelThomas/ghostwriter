import { blockId, type SceneDocumentV1 } from "@ghostwriter/editor";
import { describe, expect, it } from "vitest";
import {
  CAPTURE_DICTATION_LISTENING_COPY,
  CAPTURE_DICTATION_STATUS_COPY,
  CAPTURE_LOAD_FAILURE_GENERIC,
  CAPTURE_LOAD_FAILURE_NOT_FOUND,
  captureComposerActivity,
  captureComposerIsReadOnly,
  captureComposerProblemEvents,
  captureReadOnlyStatusText,
  captureSaveStatusIsWarning,
  captureSaveStatusText,
  isCaptureVersionConflict,
  mapCaptureSaveFailureToProblem,
  messageForCaptureLoadFailure,
  messageForCaptureSaveFailure,
  messageForCaptureVersionConflict
} from "./capture-composer.js";
import { GhostwriterApiError } from "./api.js";
import type { SceneSaveQueueSnapshot } from "./scene-save-queue.js";
import { createEmptySceneDocument } from "@ghostwriter/editor";

const captureId = "capture-test";
const document: SceneDocumentV1 = createEmptySceneDocument({
  generateBlockId: () => blockId("block-capture-composer-test")
});

const head = {
  captureId,
  projectId: "project-harbor",
  status: "draft",
  sourceModality: "text",
  workingVersion: 2,
  document,
  contentHash: "a".repeat(64),
  genesisRevisionId: "revision-genesis",
  authorAccountId: "account-writer",
  updatedByAccountId: "account-writer",
  createdAt: "2026-07-12T18:00:00.000Z",
  updatedAt: "2026-07-12T18:01:00.000Z"
} as const;

function snapshot(
  overrides: Partial<SceneSaveQueueSnapshot> = {}
): SceneSaveQueueSnapshot {
  return {
    status: "saved",
    dirty: false,
    acknowledgedWorkingVersion: 2,
    latestDocument: document,
    acknowledgedDocument: document,
    ...overrides
  };
}

describe("capture composer dictation copy", () => {
  it("keeps stable Capture-specific listening copy at the hook seam", () => {
    expect(CAPTURE_DICTATION_LISTENING_COPY).toBe(
      "Listening — speech enters the Capture caret."
    );
    expect(CAPTURE_DICTATION_STATUS_COPY.listening).toBe(
      CAPTURE_DICTATION_LISTENING_COPY
    );
  });
});

describe("captureSaveStatusText", () => {
  it("maps queue phases and recovery to writer-facing save truth", () => {
    expect(captureSaveStatusText(undefined, undefined, false)).toBe("Loading…");
    expect(captureSaveStatusText(snapshot(), undefined, false)).toBe(
      "Saved to project"
    );
    expect(
      captureSaveStatusText(snapshot({ status: "pending", dirty: true }), undefined, false)
    ).toBe("Waiting to save…");
    expect(
      captureSaveStatusText(snapshot({ status: "saving", dirty: true }), undefined, false)
    ).toBe("Saving…");
    expect(captureSaveStatusText(snapshot(), undefined, true)).toBe(
      "Not saved · recovery"
    );
    expect(
      captureSaveStatusText(snapshot(), { kind: "version", message: "x" }, false)
    ).toBe("Capture changed · conflict");
    expect(
      captureSaveStatusText(
        snapshot({ status: "paused", dirty: true }),
        undefined,
        false
      )
    ).toBe("Not saved");
  });

  it("flags warning styling for conflict, recovery, and dirty states", () => {
    expect(captureSaveStatusIsWarning(snapshot(), undefined, false)).toBe(false);
    expect(captureSaveStatusIsWarning(snapshot(), undefined, true)).toBe(true);
    expect(
      captureSaveStatusIsWarning(
        snapshot(),
        { kind: "version", message: messageForCaptureVersionConflict() },
        false
      )
    ).toBe(true);
    expect(
      captureSaveStatusIsWarning(snapshot({ dirty: true }), undefined, false)
    ).toBe(true);
  });
});

describe("capture save failure mapping", () => {
  it("detects capture version conflicts without prose in messages", () => {
    const conflict = new GhostwriterApiError(
      409,
      "CAPTURE_VERSION_CONFLICT",
      "Server detail with prose should not leak"
    );
    expect(isCaptureVersionConflict(conflict)).toBe(true);
    expect(mapCaptureSaveFailureToProblem(conflict)).toEqual({
      kind: "version",
      message: messageForCaptureVersionConflict()
    });
    expect(messageForCaptureVersionConflict()).not.toContain(
      "Server detail with prose should not leak"
    );
  });

  it("uses content-free copy for other save failures", () => {
    expect(mapCaptureSaveFailureToProblem(new Error("network down"))).toEqual({
      kind: "save",
      message: messageForCaptureSaveFailure(new Error("network down"))
    });
    expect(messageForCaptureSaveFailure(new Error("network down"))).not.toContain(
      "network"
    );
  });
});

describe("messageForCaptureLoadFailure", () => {
  it("returns stable copy and never surfaces arbitrary error or API detail", () => {
    const leaky = new GhostwriterApiError(
      500,
      "REQUEST_FAILED",
      "Database said: secret manuscript excerpt"
    );
    expect(messageForCaptureLoadFailure(leaky)).toBe(CAPTURE_LOAD_FAILURE_GENERIC);
    expect(messageForCaptureLoadFailure(leaky)).not.toContain("secret");
    expect(messageForCaptureLoadFailure(leaky)).not.toContain("Database");

    expect(messageForCaptureLoadFailure(new Error("fetch failed: ECONNREFUSED"))).toBe(
      CAPTURE_LOAD_FAILURE_GENERIC
    );
    expect(
      messageForCaptureLoadFailure(new Error("fetch failed: ECONNREFUSED"))
    ).not.toContain("ECONNREFUSED");
  });

  it("keeps explicit session and not-found copy without server messages", () => {
    expect(
      messageForCaptureLoadFailure(
        new GhostwriterApiError(401, "UNAUTHORIZED", "Session invalid detail")
      )
    ).toBe("Your session ended. Sign in again before opening this Capture.");
    expect(
      messageForCaptureLoadFailure(
        new GhostwriterApiError(401, "UNAUTHORIZED", "Session invalid detail")
      )
    ).not.toContain("Session invalid");

    expect(
      messageForCaptureLoadFailure(
        new GhostwriterApiError(404, "CAPTURE_NOT_FOUND", "Capture not found.")
      )
    ).toBe(CAPTURE_LOAD_FAILURE_NOT_FOUND);
    expect(
      messageForCaptureLoadFailure(
        new GhostwriterApiError(404, "REQUEST_FAILED", "Missing resource prose")
      )
    ).toBe(CAPTURE_LOAD_FAILURE_NOT_FOUND);
    expect(
      messageForCaptureLoadFailure(
        new GhostwriterApiError(404, "REQUEST_FAILED", "Missing resource prose")
      )
    ).not.toContain("Missing resource");
  });
});

describe("captureComposerActivity", () => {
  it("reports saving while initializing or flushing and problem when blocked", () => {
    expect(captureComposerActivity(undefined, undefined, false, true)).toBe(
      "saving"
    );
    expect(
      captureComposerActivity(snapshot({ status: "saving" }), undefined, false, false)
    ).toBe("saving");
    expect(captureComposerActivity(snapshot(), undefined, true, false)).toBe(
      "problem"
    );
    expect(
      captureComposerActivity(
        snapshot(),
        { kind: "save", message: "blocked" },
        false,
        false
      )
    ).toBe("problem");
    expect(captureComposerActivity(snapshot(), undefined, false, false)).toBe(
      "idle"
    );
  });
});

describe("captureComposerProblemEvents", () => {
  it("wires recovery and conflict problem ids for shell acknowledgement", () => {
    const events = captureComposerProblemEvents({
      captureId,
      recoveryOffer: true,
      recoveryMode: "tab-only",
      problem: { kind: "version", message: messageForCaptureVersionConflict() }
    });
    expect(events.map((event) => event.id)).toEqual([
      `capture-recovery:${captureId}`,
      `capture-recovery-storage:${captureId}`,
      `capture-problem:${captureId}`
    ]);
    expect(events[0]?.tone).toBe("warning");
    expect(events[2]?.title).toBe("Capture version conflict");
  });
});

describe("captureComposerIsReadOnly", () => {
  it("treats archived and integrated heads as read-only", () => {
    expect(captureComposerIsReadOnly({ ...head, status: "draft" })).toBe(false);
    expect(captureComposerIsReadOnly({ ...head, status: "ready" })).toBe(false);
    expect(captureComposerIsReadOnly({ ...head, status: "archived" })).toBe(true);
    expect(captureComposerIsReadOnly({ ...head, status: "integrated" })).toBe(
      true
    );
    expect(captureReadOnlyStatusText({ ...head, status: "archived" })).toMatch(
      /archived/
    );
  });
});
