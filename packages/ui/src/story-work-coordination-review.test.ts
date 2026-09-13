import { describe, expect, it } from "vitest";
import {
  buildStoryWorkCoordinationReviewStepView,
  deriveStoryWorkCoordinationReviewStepActionKind,
  storyWorkCoordinationReviewActionLabel,
  storyWorkCoordinationReviewRefreshCopy,
  storyWorkCoordinationStepBlockedReasonCopy,
  storyWorkCoordinationStepDetail,
  storyWorkCoordinationStepStatusLabel,
  validateStoryWorkCoordinatedCheckFields,
  type StoryWorkCoordinationReviewStepActionKind,
  type StoryWorkCoordinationReviewStepState
} from "./story-work-coordination-review.js";

const ACTION_KINDS: readonly StoryWorkCoordinationReviewStepActionKind[] = Object.freeze([
  "start-root",
  "open-root-review",
  "continue-check",
  "start-check",
  "open-check-review",
  "recover-child",
  "retry-child"
]);

const STEP_STATES: readonly StoryWorkCoordinationReviewStepState[] = Object.freeze([
  "blocked",
  "ready",
  "draft-ready",
  "running",
  "awaiting-review",
  "completed",
  "failed",
  "canceled",
  "stale",
  "rejected"
]);

describe("story work coordination review presentation", () => {
  it("labels every explicit step action", () => {
    for (const kind of ACTION_KINDS) {
      expect(storyWorkCoordinationReviewActionLabel(kind).length).toBeGreaterThan(0);
    }
  });

  it("maps brief ready, draft ready, and awaiting review distinctly", () => {
    expect(
      storyWorkCoordinationStepStatusLabel({
        state: "ready",
        kind: "scene-draft",
        assignmentStatus: "brief-ready"
      })
    ).toBe("Brief ready");
    expect(
      storyWorkCoordinationStepStatusLabel({
        state: "draft-ready",
        kind: "scene-draft",
        assignmentStatus: "artifact-ready"
      })
    ).toBe("Draft ready");
    expect(
      storyWorkCoordinationStepStatusLabel({
        state: "awaiting-review",
        kind: "scene-draft",
        assignmentStatus: "awaiting-review"
      })
    ).toBe("Awaiting review");
    expect(
      storyWorkCoordinationStepDetail({
        kind: "scene-draft",
        state: "draft-ready",
        assignmentStatus: "artifact-ready"
      })
    ).toMatch(/waits for your review/i);
    expect(
      storyWorkCoordinationStepDetail({
        kind: "proposal-continuity-check",
        state: "draft-ready",
        assignmentStatus: "artifact-ready"
      })
    ).toMatch(/wait for your review/i);
  });

  it("maps completed scene applied vs check review complete", () => {
    expect(
      storyWorkCoordinationStepStatusLabel({
        state: "completed",
        kind: "scene-draft",
        assignmentStatus: "applied"
      })
    ).toBe("Applied to story");
    expect(
      storyWorkCoordinationStepDetail({
        kind: "scene-draft",
        state: "completed",
        assignmentStatus: "applied"
      })
    ).toMatch(/applied to your manuscript/i);
    expect(
      storyWorkCoordinationStepStatusLabel({
        state: "completed",
        kind: "scene-draft",
        assignmentStatus: "reviewed"
      })
    ).toBe("Review complete");
    expect(
      storyWorkCoordinationStepStatusLabel({
        state: "completed",
        kind: "proposal-continuity-check",
        assignmentStatus: "reviewed"
      })
    ).toBe("Review complete");
    expect(
      storyWorkCoordinationStepDetail({
        kind: "proposal-continuity-check",
        state: "completed",
        assignmentStatus: "reviewed"
      })
    ).toMatch(/Continuity check review is complete/i);
  });

  it("maps other step states to writer-facing status labels", () => {
    expect(
      storyWorkCoordinationStepStatusLabel({
        state: "blocked",
        kind: "scene-draft"
      })
    ).toBe("Blocked");
    expect(
      storyWorkCoordinationStepStatusLabel({ state: "running", kind: "scene-draft" })
    ).toBe("Working");
    expect(
      storyWorkCoordinationStepStatusLabel({ state: "failed", kind: "scene-draft" })
    ).toBe("Needs attention");
    expect(
      storyWorkCoordinationStepStatusLabel({ state: "canceled", kind: "scene-draft" })
    ).toBe("Canceled");
    for (const state of STEP_STATES) {
      expect(
        storyWorkCoordinationStepStatusLabel({
          state,
          kind: "proposal-continuity-check"
        }).length
      ).toBeGreaterThan(0);
    }
  });

  it("explains blocked reasons in foreground copy", () => {
    expect(storyWorkCoordinationStepBlockedReasonCopy("upstream-not-ready")).toMatch(
      /upstream/i
    );
    expect(storyWorkCoordinationStepBlockedReasonCopy("upstream-terminal")).toMatch(
      /stopped/i
    );
    expect(storyWorkCoordinationStepBlockedReasonCopy("upstream-artifact-missing")).toMatch(
      /unavailable/i
    );
    expect(storyWorkCoordinationStepBlockedReasonCopy("upstream-artifact-expired")).toMatch(
      /applied/i
    );
  });

  it("derives open-review actions from assignmentStatus artifact-ready and awaiting-review", () => {
    expect(
      deriveStoryWorkCoordinationReviewStepActionKind({
        stepId: "scene",
        title: "Scene",
        kind: "scene-draft",
        state: "ready",
        assignmentStatus: "brief-ready"
      })
    ).toBe("start-root");
    expect(
      deriveStoryWorkCoordinationReviewStepActionKind({
        stepId: "scene",
        title: "Scene",
        kind: "scene-draft",
        state: "draft-ready",
        assignmentStatus: "artifact-ready"
      })
    ).toBe("open-root-review");
    expect(
      deriveStoryWorkCoordinationReviewStepActionKind({
        stepId: "scene",
        title: "Scene",
        kind: "scene-draft",
        state: "awaiting-review",
        assignmentStatus: "awaiting-review"
      })
    ).toBe("open-root-review");
    expect(
      deriveStoryWorkCoordinationReviewStepActionKind({
        stepId: "check",
        title: "Check",
        kind: "proposal-continuity-check",
        state: "draft-ready",
        checkBound: true,
        assignmentStatus: "artifact-ready"
      })
    ).toBe("open-check-review");
  });

  it("derives other explicit actions without automatic continue on reload", () => {
    expect(
      deriveStoryWorkCoordinationReviewStepActionKind({
        stepId: "scene",
        title: "Scene",
        kind: "scene-draft",
        state: "running",
        assignmentStatus: "running"
      })
    ).toBe("recover-child");
    expect(
      deriveStoryWorkCoordinationReviewStepActionKind({
        stepId: "check",
        title: "Check",
        kind: "proposal-continuity-check",
        state: "blocked",
        blockedReasons: ["upstream-not-ready"]
      })
    ).toBeUndefined();
    expect(
      deriveStoryWorkCoordinationReviewStepActionKind({
        stepId: "check",
        title: "Check",
        kind: "proposal-continuity-check",
        state: "ready",
        continueCheckReady: true
      })
    ).toBe("continue-check");

    const blocked = buildStoryWorkCoordinationReviewStepView({
      stepId: "check",
      title: "Continuity check",
      kind: "proposal-continuity-check",
      state: "blocked",
      blockedReasons: ["upstream-not-ready"]
    });
    expect(blocked.action).toBeUndefined();

    const completed = buildStoryWorkCoordinationReviewStepView({
      stepId: "scene",
      title: "Scene draft",
      kind: "scene-draft",
      state: "completed",
      assignmentStatus: "applied"
    });
    expect(completed.action).toBeUndefined();
    expect(completed.statusLabel).toBe("Applied to story");

    const draftReadyIdle = buildStoryWorkCoordinationReviewStepView({
      stepId: "scene",
      title: "Scene draft",
      kind: "scene-draft",
      state: "draft-ready",
      assignmentStatus: "artifact-ready"
    });
    expect(draftReadyIdle.action?.kind).toBe("open-root-review");
    expect(
      buildStoryWorkCoordinationReviewStepView({
        stepId: "check",
        title: "Check",
        kind: "proposal-continuity-check",
        state: "ready",
        continueCheckReady: true
      }).action?.kind
    ).toBe("continue-check");
  });

  it("states refresh is read-only reconciliation", () => {
    expect(storyWorkCoordinationReviewRefreshCopy()).toMatch(/never auto-continues/i);
    expect(storyWorkCoordinationReviewRefreshCopy()).toMatch(/provider quota/i);
  });

  it("validates coordinated check fields only when enabled", () => {
    expect(
      validateStoryWorkCoordinatedCheckFields({
        enabled: false,
        fields: { brief: "", constraints: "", doneWhen: "" }
      }).valid
    ).toBe(true);
    const invalid = validateStoryWorkCoordinatedCheckFields({
      enabled: true,
      fields: { brief: " ", constraints: "c", doneWhen: "d" }
    });
    expect(invalid.valid).toBe(false);
    expect(invalid.errors.length).toBe(1);
    expect(
      validateStoryWorkCoordinatedCheckFields({
        enabled: true,
        fields: {
          brief: "Check prose",
          constraints: "Ground in canon",
          doneWhen: "Findings ready"
        }
      }).valid
    ).toBe(true);
  });
});
