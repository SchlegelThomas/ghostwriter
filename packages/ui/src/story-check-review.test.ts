import { describe, expect, it } from "vitest";
import {
  agentProposalId,
  instructionContentHash,
  projectId,
  sceneContentHash,
  sceneId,
  storyWorkAssignmentId,
  type StoryCheckFindingsV1
} from "@ghostwriter/core";
import {
  storyCheckAnchorEvidenceLabel,
  storyCheckApplyFindingResolution,
  storyCheckCoverageCompleteLabel,
  storyCheckCoveragePresentation,
  storyCheckFindingKindLabel,
  storyCheckFindingsReadyForCompletion,
  storyCheckFreshnessHeadline,
  storyCheckFreshnessReasonCopy,
  storyCheckResolutionFromDraft,
  storyCheckReviewCanComplete,
  storyCheckResolutionEditorDirty,
  storyCheckReviewHasResolutionEdits,
  storyCheckRevisionPrefillInstruction,
  storyCheckSourceScopeHint,
  storyCheckSpecialistLabel,
  storyCheckTargetModeLabel,
  validateStoryCheckDeferReason
} from "./story-check-review.js";

const project = projectId("project-check-ui");
const assessScene = sceneId("scene-assess");
const neighborScene = sceneId("scene-neighbor");

const basePayload = (): StoryCheckFindingsV1 =>
  Object.freeze({
    schemaId: "story-check-findings-v1",
    specialist: "continuity",
    target: Object.freeze({
      mode: "applied-scene",
      projectId: project,
      sceneId: assessScene,
      workingVersion: 2,
      contentHash: sceneContentHash("a".repeat(64))
    }),
    findings: Object.freeze([
      Object.freeze({
        id: "finding-one",
        kind: "contradiction",
        severity: "important",
        claim: "Mara cannot reach the dock before dawn.",
        nextStep: "Adjust travel timing in the harbor scene.",
        anchors: Object.freeze([
          Object.freeze({ sceneId: assessScene, quote: "Mara reached the dock at midnight." })
        ]),
        resolution: Object.freeze({ status: "open" })
      })
    ]),
    coverage: Object.freeze({
      requestedScopeSummary: "Assess scene plus one neighbor for continuity.",
      examined: Object.freeze([
        Object.freeze({
          sceneId: assessScene,
          workingVersion: 2,
          contentHash: sceneContentHash("a".repeat(64))
        }),
        Object.freeze({
          sceneId: neighborScene,
          workingVersion: 1,
          contentHash: sceneContentHash("b".repeat(64))
        })
      ]),
      skipped: Object.freeze([
        Object.freeze({
          sceneId: sceneId("scene-skipped"),
          reason: "Scene archived before the check ran."
        })
      ]),
      truncations: Object.freeze([
        Object.freeze({
          resourceKind: "scene-document",
          resourceId: String(neighborScene),
          truncated: true,
          providerCharCount: 4000,
          fullCharCount: 9000
        })
      ]),
      completeForRequestedScope: false
    }),
    revisionVector: Object.freeze({ dependencies: Object.freeze([]) }),
    linkedRecheckSceneIds: Object.freeze([neighborScene])
  });

describe("story check review presentation", () => {
  it("describes coverage, completeness, and limited-scope copy", () => {
    const presentation = storyCheckCoveragePresentation(basePayload().coverage, [
      { sceneId: assessScene, title: "Harbor scene" },
      { sceneId: neighborScene, title: "Fog neighbor" },
      { sceneId: sceneId("scene-skipped"), title: "Archived scene" }
    ]);
    expect(storyCheckCoverageCompleteLabel(false)).toBe(
      "Limited coverage for the requested scope"
    );
    expect(presentation.requestedScopeSummary).toContain("Assess scene");
    expect(presentation.examinedLines[0]).toBe("Harbor scene · version 2");
    expect(presentation.skippedLines[0]).toContain("Archived scene");
    expect(presentation.truncationLines[0]).toContain("4000 of 9000");
    expect(presentation.limitedCoverageNotice).toContain("zero findings");
    expect(storyCheckSourceScopeHint()).toContain("not your whole book");
  });

  it("gates completion on freshness and open findings", () => {
    const payload = basePayload();
    expect(storyCheckFindingsReadyForCompletion(payload)).toBe(false);
    expect(
      storyCheckReviewCanComplete({ status: "fresh" }, payload)
    ).toBe(false);
    const resolved = storyCheckApplyFindingResolution(payload, "finding-one", {
      status: "dismissed"
    });
    expect(storyCheckFindingsReadyForCompletion(resolved)).toBe(true);
    expect(
      storyCheckReviewCanComplete({ status: "fresh" }, resolved)
    ).toBe(true);
    expect(
      storyCheckReviewCanComplete(
        {
          status: "needs-recheck",
          reasons: [
            {
              dependencyKey: `scene-prose:${assessScene}`,
              reason: "scene-prose-changed"
            }
          ]
        },
        resolved
      )
    ).toBe(false);
  });

  it("updates resolutions and validates defer reasons", () => {
    const payload = basePayload();
    expect(validateStoryCheckDeferReason("   ")).toContain("short reason");
    expect(validateStoryCheckDeferReason("x".repeat(501))).toContain("500");
    expect(storyCheckResolutionFromDraft("dismissed")).toEqual({
      status: "dismissed"
    });
    expect(storyCheckResolutionFromDraft("deferred", "  Need another pass  ")).toEqual({
      status: "deferred",
      reason: "Need another pass"
    });
    const dismissed = storyCheckApplyFindingResolution(payload, "finding-one", {
      status: "dismissed"
    });
    expect(storyCheckReviewHasResolutionEdits(dismissed, payload)).toBe(true);
    expect(storyCheckReviewHasResolutionEdits(payload, payload)).toBe(false);
    expect(storyCheckResolutionEditorDirty(undefined)).toBe(false);
    expect(
      storyCheckResolutionEditorDirty({
        findingId: "finding-one",
        status: "deferred",
        reason: "   "
      })
    ).toBe(false);
    expect(
      storyCheckResolutionEditorDirty({
        findingId: "finding-one",
        status: "deferred",
        reason: "Need another pass"
      })
    ).toBe(true);
  });

  it("formats stale reasons, labels, anchors, and revision prefill", () => {
    expect(storyCheckFreshnessHeadline({ status: "fresh" })).toBe("Fresh");
    expect(
      storyCheckFreshnessHeadline({
        status: "needs-recheck",
        reasons: [
          {
            dependencyKey: "scene-prose:scene",
            reason: "scene-prose-changed"
          }
        ]
      })
    ).toBe("Needs recheck");
    expect(storyCheckFreshnessReasonCopy("proposal-artifact-changed")).toContain(
      "proposal draft changed"
    );
    expect(storyCheckSpecialistLabel("continuity")).toBe("Continuity");
    expect(
      storyCheckTargetModeLabel({
        mode: "proposal-draft",
        projectId: project,
        sceneId: assessScene,
        assignmentId: storyWorkAssignmentId("assignment-draft"),
        proposalId: agentProposalId("proposal-draft"),
        artifactVersion: 1,
        contentHash: instructionContentHash("c".repeat(64))
      })
    ).toBe("Reviewable scene proposal");
    expect(storyCheckFindingKindLabel("question")).toBe("Question");
    expect(
      storyCheckAnchorEvidenceLabel(
        {
          sceneId: assessScene,
          quote: "Dock lights",
          blockId: "block-1"
        },
        [{ sceneId: assessScene, title: "Harbor scene" }]
      )
    ).toContain("Harbor scene · block block-1 · “Dock lights”");
    expect(
      storyCheckRevisionPrefillInstruction(basePayload().findings[0]!)
    ).toContain("Mara cannot reach the dock before dawn.");
  });
});
