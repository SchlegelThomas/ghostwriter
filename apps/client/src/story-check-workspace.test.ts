import { describe, expect, it } from "vitest";
import {
  accountId,
  agentProposalId,
  createStoryWorkAssignment,
  instructionContentHash,
  sceneContentHash,
  sceneId,
  storyWorkAssignmentId,
  validateStoryCheckFindingsV1,
  type StoryWorkAssignment
} from "@ghostwriter/core";
import {
  BELLWETHER_FIXTURE,
  BELLWETHER_FIXTURE_NAVIGATOR
} from "../../../packages/core/src/fixtures.js";
import type { SubmitStoryWorkBrief } from "@ghostwriter/ui";
import {
  buildCheckStoryWorkCreateInput,
  buildProposalCheckTargets,
  chooseStoryCheckRevisionFollowUp,
  deriveStoryCheckRevisionPrefill,
  proposalCheckTargetLabel,
  proposalCheckTargetTitleFromBrief,
  resolveProposalCheckTargetTitle,
  shouldUseStoryWorkPanelReviseForCheckFollowUp,
  storyCheckRevisionSourceSceneIds,
  storyCheckRevisionTargetSceneId,
  storyWorkScopeEpochMismatch,
  STORY_CHECK_REVISION_DONE_WHEN,
  validateProposalDraftRevisionFollowUp
} from "./story-check-workspace.js";

const project = BELLWETHER_FIXTURE_NAVIGATOR;
const owner = accountId("check-workspace-owner");
const sceneA = BELLWETHER_FIXTURE.scenes[0]!.id;
const sceneB = BELLWETHER_FIXTURE.scenes[1]!.id;
const hash = instructionContentHash("a".repeat(64));
const pointer = {
  proposalId: agentProposalId("proposal-1"),
  artifactVersion: 1,
  contentHash: hash
};

function sceneAssignment(
  overrides: Partial<StoryWorkAssignment> = {}
): StoryWorkAssignment {
  return createStoryWorkAssignment({
    id: storyWorkAssignmentId("assignment-scene"),
    projectId: project.id,
    initiatorAccountId: owner,
    version: 2,
    taskKind: "scene",
    brief: "Draft scene",
    constraints: "Stay in voice",
    doneWhen: "Ready to review",
    sources: [{ kind: "scene", sceneId: sceneA, projectVersion: project.version }],
    destination: { kind: "scene", operation: "create", sceneId: sceneB },
    provider: "openai",
    model: "gpt-4.1",
    status: "awaiting-review",
    steps: [{ id: "draft", title: "Draft", dependencies: [] }],
    currentArtifact: pointer,
    generatedArtifact: pointer,
    results: [],
    idempotencyKey: "scene-1",
    createdAt: "2026-09-12T12:00:00.000Z",
    updatedAt: "2026-09-12T12:01:00.000Z",
    ...overrides
  });
}

describe("story check workspace helpers", () => {
  it("filters proposal check targets to reviewable scene destinations only", () => {
    const targets = buildProposalCheckTargets(
      [
        sceneAssignment(),
        sceneAssignment({
          id: storyWorkAssignmentId("assignment-failed"),
          status: "failed",
          taskKind: "revise",
          destination: { kind: "scene", operation: "update", sceneId: sceneA },
          currentArtifact: undefined,
          generatedArtifact: undefined
        }),
        sceneAssignment({
          id: storyWorkAssignmentId("assignment-no-artifact"),
          status: "brief-ready",
          currentArtifact: undefined,
          generatedArtifact: undefined
        })
      ],
      (id) => (id === sceneB ? "Harbor scene" : undefined)
    );
    expect(targets).toHaveLength(1);
    expect(targets[0]).toEqual({
      assignmentId: storyWorkAssignmentId("assignment-scene"),
      artifact: pointer,
      targetSceneId: sceneB,
      title: "Harbor scene",
      label: "New scene"
    });
    expect(proposalCheckTargetLabel(sceneAssignment({ taskKind: "revise" }))).toBe(
      "Scene revision"
    );
  });

  it("uses brief-derived titles for new scene proposals without canonical scene names", () => {
    const reserved = sceneId("scene-reserved-create");
    const assignment = sceneAssignment({
      id: storyWorkAssignmentId("assignment-new-scene"),
      brief: "  Harbor arrival after the storm  \nExpand the dock beat.",
      destination: { kind: "scene", operation: "create", sceneId: reserved }
    });
    const targets = buildProposalCheckTargets([assignment], () => undefined);
    expect(targets).toHaveLength(1);
    expect(targets[0]?.title).toBe("Harbor arrival after the storm");
    expect(targets[0]?.title).not.toMatch(/selected scene|saved scene/i);
    expect(
      resolveProposalCheckTargetTitle({
        assignment,
        targetSceneId: reserved,
        sceneTitle: () => undefined
      })
    ).toBe("Harbor arrival after the storm");
  });

  it("keeps canonical scene titles for revise and update targets", () => {
    const assignment = sceneAssignment({
      taskKind: "revise",
      brief: "Brief headline should not replace canonical titles.",
      destination: { kind: "scene", operation: "update", sceneId: sceneA }
    });
    const targets = buildProposalCheckTargets([assignment], (id) =>
      id === sceneA ? "Arrival at Bellwether" : undefined
    );
    expect(targets[0]?.title).toBe("Arrival at Bellwether");
  });

  it("truncates brief-derived proposal titles at eighty characters", () => {
    const longLine = `x${"y".repeat(90)}`;
    expect(proposalCheckTargetTitleFromBrief(`${longLine}\nSecond line`)).toBe(
      `${longLine.slice(0, 79)}…`
    );
  });

  it("builds exact create payloads for applied and proposal check submits", () => {
    const appliedBrief: SubmitStoryWorkBrief = {
      taskKind: "check",
      specialist: "continuity",
      checkMode: "applied-scene",
      targetSceneId: sceneA,
      brief: "Check continuity.",
      constraints: "Ground claims.",
      doneWhen: "Findings ready.",
      sceneIds: [sceneB],
      model: "gpt-4.1"
    };
    expect(buildCheckStoryWorkCreateInput(project, appliedBrief, "key-applied")).toEqual({
      projectId: project.id,
      expectedProjectVersion: project.version,
      idempotencyKey: "key-applied",
      brief: "Check continuity.",
      constraints: "Ground claims.",
      doneWhen: "Findings ready.",
      sceneIds: [sceneB],
      model: "gpt-4.1",
      targetSceneId: sceneA,
      checkMode: "applied-scene"
    });
    const proposalBrief: SubmitStoryWorkBrief = {
      taskKind: "check",
      specialist: "continuity",
      checkMode: "proposal-draft",
      targetSceneId: sceneA,
      sourceAssignmentId: storyWorkAssignmentId("assignment-scene"),
      sourceArtifact: pointer,
      brief: "Check proposal.",
      constraints: "Stay grounded.",
      doneWhen: "Findings cite proposal.",
      sceneIds: [],
      model: "gpt-4.1"
    };
    expect(buildCheckStoryWorkCreateInput(project, proposalBrief, "key-proposal")).toMatchObject({
      checkMode: "proposal-draft",
      sourceAssignmentId: storyWorkAssignmentId("assignment-scene"),
      sourceArtifact: pointer
    });
  });

  it("derives revision prefill from finding anchors and preserves assignment constraints", () => {
    const target = sceneId("scene-target");
    const neighbor = sceneId("scene-neighbor");
    const finding = {
      id: "finding-1",
      kind: "contradiction" as const,
      severity: "important" as const,
      claim: "Timeline slips.",
      anchors: [
        { sceneId: target },
        { sceneId: neighbor },
        { sceneId: neighbor }
      ],
      resolution: { status: "open" as const }
    };
    const payload = validateStoryCheckFindingsV1({
      schemaId: "story-check-findings-v1",
      specialist: "continuity",
      target: {
        mode: "applied-scene",
        projectId: project.id,
        sceneId: target,
        workingVersion: 2,
        contentHash: sceneContentHash("a".repeat(64))
      },
      findings: [finding],
      coverage: {
        requestedScopeSummary: "Selected scenes",
        examined: [
          {
            sceneId: target,
            workingVersion: 2,
            contentHash: sceneContentHash("a".repeat(64))
          }
        ],
        skipped: [],
        truncations: [],
        completeForRequestedScope: true
      },
      revisionVector: { dependencies: [] },
      linkedRecheckSceneIds: []
    });
    const prefill = deriveStoryCheckRevisionPrefill({
      requestToken: "token-1",
      payload,
      finding,
      prefilledBrief: "Address the timeline slip.",
      constraints: "Preserve intent.",
      doneWhen: STORY_CHECK_REVISION_DONE_WHEN
    });
    expect(prefill.requestToken).toBe("token-1");
    expect(prefill.revise.targetSceneId).toBe(target);
    expect(prefill.revise.constraints).toBe("Preserve intent.");
    expect(prefill.revise.sceneIds).toEqual([neighbor]);
    expect(storyCheckRevisionSourceSceneIds(finding, target)).toEqual([neighbor]);
  });

  it("prefers the first finding anchor scene over the assessed check target", () => {
    const assessTarget = sceneId("scene-assess");
    const affectedScene = sceneId("scene-affected");
    const finding = {
      id: "finding-cross-scene",
      kind: "contradiction" as const,
      severity: "blocking" as const,
      claim: "The harbor timeline conflicts with the road scene.",
      anchors: [{ sceneId: affectedScene }, { sceneId: assessTarget }],
      resolution: { status: "open" as const }
    };
    const payload = validateStoryCheckFindingsV1({
      schemaId: "story-check-findings-v1",
      specialist: "continuity",
      target: {
        mode: "applied-scene",
        projectId: project.id,
        sceneId: assessTarget,
        workingVersion: 1,
        contentHash: sceneContentHash("c".repeat(64))
      },
      findings: [finding],
      coverage: {
        requestedScopeSummary: "Assess plus neighbor",
        examined: [
          {
            sceneId: assessTarget,
            workingVersion: 1,
            contentHash: sceneContentHash("c".repeat(64))
          },
          {
            sceneId: affectedScene,
            workingVersion: 1,
            contentHash: sceneContentHash("d".repeat(64))
          }
        ],
        skipped: [],
        truncations: [],
        completeForRequestedScope: true
      },
      revisionVector: { dependencies: [] },
      linkedRecheckSceneIds: []
    });
    expect(storyCheckRevisionTargetSceneId(finding, payload)).toBe(affectedScene);
    const prefill = deriveStoryCheckRevisionPrefill({
      requestToken: "token-cross-scene",
      payload,
      finding,
      prefilledBrief: "Fix the harbor timing.",
      constraints: "Keep POV.",
      doneWhen: STORY_CHECK_REVISION_DONE_WHEN
    });
    expect(prefill.revise.targetSceneId).toBe(affectedScene);
    expect(prefill.revise.sceneIds).toEqual([assessTarget]);
  });

  it("falls back to the check target when finding anchors are empty", () => {
    const assessTarget = sceneId("scene-assess-only");
    const finding = {
      id: "finding-legacy",
      kind: "question" as const,
      severity: "advisory" as const,
      claim: "Legacy finding without anchors.",
      anchors: [],
      resolution: { status: "open" as const }
    };
    const payload = validateStoryCheckFindingsV1({
      schemaId: "story-check-findings-v1",
      specialist: "continuity",
      target: {
        mode: "applied-scene",
        projectId: project.id,
        sceneId: assessTarget,
        workingVersion: 1,
        contentHash: sceneContentHash("e".repeat(64))
      },
      findings: [
        {
          id: "finding-with-anchor",
          kind: "question",
          severity: "advisory",
          claim: "Placeholder for schema validation.",
          anchors: [{ sceneId: assessTarget, quote: "legacy" }],
          resolution: { status: "open" }
        }
      ],
      coverage: {
        requestedScopeSummary: "Assess only",
        examined: [
          {
            sceneId: assessTarget,
            workingVersion: 1,
            contentHash: sceneContentHash("e".repeat(64))
          }
        ],
        skipped: [],
        truncations: [],
        completeForRequestedScope: true
      },
      revisionVector: { dependencies: [] },
      linkedRecheckSceneIds: []
    });
    expect(storyCheckRevisionTargetSceneId(finding, payload)).toBe(assessTarget);
    expect(
      deriveStoryCheckRevisionPrefill({
        requestToken: "token-legacy",
        payload,
        finding,
        prefilledBrief: "Clarify the question.",
        constraints: "Preserve voice.",
        doneWhen: STORY_CHECK_REVISION_DONE_WHEN
      }).revise.sceneIds
    ).toEqual([]);
  });

  it("detects scope epoch mismatch for stale async handlers", () => {
    expect(storyWorkScopeEpochMismatch(2, 2)).toBe(false);
    expect(storyWorkScopeEpochMismatch(3, 2)).toBe(true);
  });

  it("routes applied-scene checks to Story work panel revise and proposal checks to source review", () => {
    const assessTarget = sceneA;
    const reservedProposalScene = sceneId("scene-reserved-proposal-target");
    const sourceAssignment = storyWorkAssignmentId("assignment-source-scene");
    const appliedPayload = validateStoryCheckFindingsV1({
      schemaId: "story-check-findings-v1",
      specialist: "continuity",
      target: {
        mode: "applied-scene",
        projectId: project.id,
        sceneId: assessTarget,
        workingVersion: 2,
        contentHash: sceneContentHash("f".repeat(64))
      },
      findings: [
        {
          id: "finding-applied",
          kind: "contradiction",
          severity: "important",
          claim: "Applied head conflict.",
          anchors: [{ sceneId: assessTarget, quote: "quote" }],
          resolution: { status: "open" }
        }
      ],
      coverage: {
        requestedScopeSummary: "Assess",
        examined: [
          {
            sceneId: assessTarget,
            workingVersion: 2,
            contentHash: sceneContentHash("f".repeat(64))
          }
        ],
        skipped: [],
        truncations: [],
        completeForRequestedScope: true
      },
      revisionVector: { dependencies: [] },
      linkedRecheckSceneIds: []
    });
    expect(shouldUseStoryWorkPanelReviseForCheckFollowUp(appliedPayload)).toBe(true);
    expect(chooseStoryCheckRevisionFollowUp(appliedPayload)).toEqual({
      kind: "story-work-panel-revise"
    });

    const proposalPayload = validateStoryCheckFindingsV1({
      schemaId: "story-check-findings-v1",
      specialist: "continuity",
      target: {
        mode: "proposal-draft",
        projectId: project.id,
        sceneId: reservedProposalScene,
        assignmentId: sourceAssignment,
        proposalId: pointer.proposalId,
        artifactVersion: pointer.artifactVersion,
        contentHash: pointer.contentHash
      },
      findings: [
        {
          id: "finding-proposal",
          kind: "contradiction",
          severity: "important",
          claim: "Proposal conflict.",
          anchors: [{ sceneId: reservedProposalScene, quote: "draft quote" }],
          resolution: { status: "open" }
        }
      ],
      coverage: {
        requestedScopeSummary: "Proposal assess",
        examined: [
          {
            sceneId: reservedProposalScene,
            workingVersion: 1,
            contentHash: sceneContentHash("c".repeat(64))
          }
        ],
        skipped: [],
        truncations: [],
        completeForRequestedScope: true
      },
      revisionVector: { dependencies: [] },
      linkedRecheckSceneIds: []
    });
    expect(shouldUseStoryWorkPanelReviseForCheckFollowUp(proposalPayload)).toBe(false);
    expect(chooseStoryCheckRevisionFollowUp(proposalPayload)).toEqual({
      kind: "source-scene-review",
      sourceAssignmentId: sourceAssignment,
      sourceArtifact: pointer
    });
    expect(
      deriveStoryCheckRevisionPrefill({
        requestToken: "would-be-wrong",
        payload: proposalPayload,
        finding: proposalPayload.findings[0]!,
        prefilledBrief: "Should not become panel target.",
        constraints: "Keep intent.",
        doneWhen: STORY_CHECK_REVISION_DONE_WHEN
      }).revise.targetSceneId
    ).toBe(reservedProposalScene);
  });

  it("refuses proposal follow-up when the source artifact moved", () => {
    const assignment = sceneAssignment({
      taskKind: "scene",
      status: "awaiting-review",
      currentArtifact: pointer,
      generatedArtifact: pointer
    });
    expect(
      validateProposalDraftRevisionFollowUp(assignment, {
        ...pointer,
        artifactVersion: 99
      })
    ).toMatchObject({ ok: false });
    expect(validateProposalDraftRevisionFollowUp(assignment, pointer)).toEqual({
      ok: true
    });
  });
});
