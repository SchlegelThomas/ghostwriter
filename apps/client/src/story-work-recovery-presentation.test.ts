import { describe, expect, it } from "vitest";
import { GhostwriterApiError } from "./api.js";
import {
  messageForStoryWorkRecoveryFailure,
  presentStoryWorkReloadRecovery,
  presentStoryWorkTerminalOutcome,
  storyWorkNonReviewableStatusLine,
  storyWorkRecoverySuccessMessage,
  storyWorkReloadRecoveryShowsRetry
} from "./story-work-recovery-presentation.js";

describe("story work recovery presentation", () => {
  it("enables cancel and mark interrupted only for active-or-interrupted recovery", () => {
    const active = presentStoryWorkReloadRecovery({
      assignmentStatus: "running",
      recovery: {
        status: "active-or-interrupted",
        runId: "run-active",
        expectedAssignmentVersion: 2,
        actions: ["cancel", "mark-interrupted"],
        message:
          "Generation is still active or the provider outcome is uncertain. Cancel the run or mark it interrupted after reload."
      }
    });
    expect(active?.actions).toEqual({
      refresh: true,
      cancel: true,
      markInterrupted: true
    });
    expect(active?.technicalRunId).toBe("run-active");
    expect(active?.message).not.toMatch(/still running|provider is dead/i);

    const refreshRequired = presentStoryWorkReloadRecovery({
      assignmentStatus: "running",
      recovery: {
        status: "refresh-required",
        expectedAssignmentVersion: 3,
        actions: ["cancel", "mark-interrupted"],
        message:
          "Story work changed while this page was open. Refresh assignment details before canceling or marking interrupted."
      }
    });
    expect(refreshRequired?.actions).toEqual({
      refresh: true,
      cancel: false,
      markInterrupted: false
    });
  });

  it("falls back to honest uncertain copy for running assignments without projection", () => {
    const fallback = presentStoryWorkReloadRecovery({
      assignmentStatus: "running",
      runId: "run-fallback"
    });
    expect(fallback?.message).toContain("uncertain");
    expect(fallback?.message).not.toMatch(/still running|provider is dead/i);
    expect(fallback?.actions.cancel).toBe(false);
    expect(fallback?.technicalRunId).toBe("run-fallback");
  });

  it("maps client-interrupted and run-canceled terminal diagnostics", () => {
    expect(
      presentStoryWorkTerminalOutcome({
        assignmentStatus: "failed",
        terminalDiagnosticCode: "client-interrupted"
      })
    ).toMatchObject({
      showRetry: true,
      statusLine: expect.stringMatching(/marked this generation interrupted/i)
    });
    expect(
      presentStoryWorkTerminalOutcome({
        assignmentStatus: "canceled",
        terminalDiagnosticCode: "run-canceled"
      })
    ).toMatchObject({
      showRetry: true,
      statusLine: expect.stringMatching(/Provider usage may already have occurred/i)
    });
  });

  it("prefers terminal copy over generic non-reviewable messaging", () => {
    expect(
      storyWorkNonReviewableStatusLine({
        assignmentStatus: "canceled",
        terminalDiagnosticCode: "run-canceled"
      })
    ).toContain("canceled");
  });

  it("maps recovery failures to refresh-first and unavailable copy", () => {
    expect(
      messageForStoryWorkRecoveryFailure(
        new GhostwriterApiError(
          409,
          "STORY_WORK_RECOVERY_TRANSITION_CONFLICT",
          "The story work assignment changed before this recovery action completed."
        )
      )
    ).toContain("Refresh status");
    expect(
      messageForStoryWorkRecoveryFailure(new GhostwriterApiError(404, "NOT_FOUND", "Missing"))
    ).toContain("unavailable");
  });

  it("announces recovery success and replay", () => {
    expect(storyWorkRecoverySuccessMessage("cancel", false)).toBe("Generation canceled.");
    expect(storyWorkRecoverySuccessMessage("mark-interrupted", true)).toBe(
      "Generation was already marked interrupted."
    );
  });

  it("shows retry for terminal and brief-ready outcomes", () => {
    expect(
      storyWorkReloadRecoveryShowsRetry({
        assignmentStatus: "brief-ready"
      })
    ).toBe(true);
    expect(
      storyWorkReloadRecoveryShowsRetry({
        assignmentStatus: "running"
      })
    ).toBe(false);
    expect(
      storyWorkReloadRecoveryShowsRetry({
        assignmentStatus: "failed",
        terminalDiagnosticCode: "provider-timeout"
      })
    ).toBe(true);
  });
});
