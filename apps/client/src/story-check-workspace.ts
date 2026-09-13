import type {
  ProjectId,
  ProjectNavigator,
  SceneId,
  StoryCheckFindingV1,
  StoryCheckFindingsV1,
  StoryWorkArtifactPointer,
  StoryWorkAssignment,
  StoryWorkAssignmentId
} from "@ghostwriter/core";
import type {
  StoryWorkPanelRevisePrefill,
  StoryWorkProposalCheckTarget,
  SubmitStoryWorkBrief
} from "@ghostwriter/ui";
import type { createCheckStoryWorkAssignment } from "./api.js";

const MAX_REVISION_SOURCE_SCENES = 32;
const PROPOSAL_CHECK_BRIEF_TITLE_MAX = 80;

export function proposalCheckTargetTitleFromBrief(brief: string): string | undefined {
  const line = brief
    .split("\n")
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0);
  if (line === undefined) return undefined;
  return line.length > PROPOSAL_CHECK_BRIEF_TITLE_MAX
    ? `${line.slice(0, PROPOSAL_CHECK_BRIEF_TITLE_MAX - 1)}…`
    : line;
}

export function resolveProposalCheckTargetTitle(input: Readonly<{
  assignment: StoryWorkAssignment;
  targetSceneId: SceneId;
  sceneTitle: (sceneId: SceneId) => string | undefined;
}>): string {
  const canonical = input.sceneTitle(input.targetSceneId);
  if (canonical !== undefined) return canonical;
  return (
    proposalCheckTargetTitleFromBrief(input.assignment.brief) ??
    "Reviewable scene proposal"
  );
}

export function isCheckStoryWorkAssignment(assignment: StoryWorkAssignment): boolean {
  return assignment.taskKind === "check";
}

export function storyWorkScopeEpochMismatch(currentEpoch: number, renderEpoch: number): boolean {
  return currentEpoch !== renderEpoch;
}

export function proposalCheckTargetLabel(assignment: StoryWorkAssignment): string {
  return assignment.taskKind === "revise" ? "Scene revision" : "New scene";
}

/** Reviewable scene/revise artifacts with an exact scene destination and current artifact pointer. */
export function buildProposalCheckTargets(
  assignments: readonly StoryWorkAssignment[],
  sceneTitle: (sceneId: SceneId) => string | undefined
): readonly StoryWorkProposalCheckTarget[] {
  const targets: StoryWorkProposalCheckTarget[] = [];
  for (const assignment of assignments) {
    if (assignment.taskKind !== "scene" && assignment.taskKind !== "revise") continue;
    if (assignment.status !== "artifact-ready" && assignment.status !== "awaiting-review") continue;
    if (assignment.currentArtifact === undefined) continue;
    if (assignment.destination.kind !== "scene") continue;
    if (
      assignment.destination.operation !== "create" &&
      assignment.destination.operation !== "update"
    ) {
      continue;
    }
    const targetSceneId = assignment.destination.sceneId;
    targets.push(
      Object.freeze({
        assignmentId: assignment.id,
        artifact: assignment.currentArtifact,
        targetSceneId,
        title: resolveProposalCheckTargetTitle({
          assignment,
          targetSceneId,
          sceneTitle
        }),
        label: proposalCheckTargetLabel(assignment)
      })
    );
  }
  return Object.freeze(targets);
}

type CreateCheckInput = Parameters<typeof createCheckStoryWorkAssignment>[0];

export function buildCheckStoryWorkCreateInput(
  project: ProjectNavigator,
  brief: Extract<SubmitStoryWorkBrief, { taskKind: "check" }>,
  idempotencyKey: string
): CreateCheckInput {
  const shared = Object.freeze({
    projectId: project.id,
    expectedProjectVersion: project.version,
    idempotencyKey,
    brief: brief.brief,
    constraints: brief.constraints,
    doneWhen: brief.doneWhen,
    sceneIds: brief.sceneIds,
    model: brief.model,
    targetSceneId: brief.targetSceneId
  });
  if (brief.checkMode === "applied-scene") {
    return Object.freeze({ ...shared, checkMode: "applied-scene" });
  }
  return Object.freeze({
    ...shared,
    checkMode: "proposal-draft",
    sourceAssignmentId: brief.sourceAssignmentId,
    sourceArtifact: brief.sourceArtifact
  });
}

/** First finding anchor scene is the revision destination; empty anchors fall back to the check target. */
export function storyCheckRevisionTargetSceneId(
  finding: StoryCheckFindingV1,
  payload: StoryCheckFindingsV1
): SceneId {
  const firstAnchorSceneId = finding.anchors[0]?.sceneId;
  return firstAnchorSceneId ?? payload.target.sceneId;
}

export function storyCheckRevisionSourceSceneIds(
  finding: StoryCheckFindingV1,
  targetSceneId: SceneId
): readonly SceneId[] {
  const seen = new Set<SceneId>();
  const sceneIds: SceneId[] = [];
  for (const anchor of finding.anchors) {
    if (anchor.sceneId === targetSceneId || seen.has(anchor.sceneId)) continue;
    seen.add(anchor.sceneId);
    sceneIds.push(anchor.sceneId);
    if (sceneIds.length >= MAX_REVISION_SOURCE_SCENES) break;
  }
  return Object.freeze(sceneIds);
}

export function deriveStoryCheckRevisionPrefill(input: Readonly<{
  requestToken: string;
  payload: StoryCheckFindingsV1;
  finding: StoryCheckFindingV1;
  prefilledBrief: string;
  constraints: string;
  doneWhen: string;
}>): StoryWorkPanelRevisePrefill {
  const targetSceneId = storyCheckRevisionTargetSceneId(input.finding, input.payload);
  return Object.freeze({
    requestToken: input.requestToken,
    revise: Object.freeze({
      targetSceneId,
      brief: input.prefilledBrief,
      constraints: input.constraints,
      doneWhen: input.doneWhen,
      sceneIds: storyCheckRevisionSourceSceneIds(input.finding, targetSceneId)
    })
  });
}

export const STORY_CHECK_REVISION_DONE_WHEN =
  "The revision addresses this continuity finding and is ready for your review.";

export function sameStoryWorkArtifactPointer(
  left: StoryWorkArtifactPointer,
  right: StoryWorkArtifactPointer
): boolean {
  return (
    left.proposalId === right.proposalId &&
    left.artifactVersion === right.artifactVersion &&
    left.contentHash === right.contentHash
  );
}

export type StoryCheckRevisionFollowUp =
  | Readonly<{ kind: "story-work-panel-revise" }>
  | Readonly<{
      kind: "source-scene-review";
      sourceAssignmentId: StoryWorkAssignmentId;
      sourceArtifact: StoryWorkArtifactPointer;
    }>;

export function shouldUseStoryWorkPanelReviseForCheckFollowUp(
  payload: StoryCheckFindingsV1
): boolean {
  return payload.target.mode === "applied-scene";
}

export function chooseStoryCheckRevisionFollowUp(
  payload: StoryCheckFindingsV1
): StoryCheckRevisionFollowUp {
  if (payload.target.mode === "applied-scene") {
    return Object.freeze({ kind: "story-work-panel-revise" });
  }
  const target = payload.target;
  return Object.freeze({
    kind: "source-scene-review",
    sourceAssignmentId: target.assignmentId,
    sourceArtifact: Object.freeze({
      proposalId: target.proposalId,
      artifactVersion: target.artifactVersion,
      contentHash: target.contentHash
    })
  });
}

export function sceneStoryWorkRevisionPrefillScopeKey(
  projectId: ProjectId,
  sourceAssignmentId: StoryWorkAssignmentId
): string {
  return `${projectId}:${sourceAssignmentId}`;
}

export function validateProposalDraftRevisionFollowUp(
  assignment: StoryWorkAssignment,
  expectedArtifact: StoryWorkArtifactPointer
): Readonly<{ ok: true } | { ok: false; message: string }> {
  if (assignment.taskKind !== "scene" && assignment.taskKind !== "revise") {
    return Object.freeze({
      ok: false,
      message:
        "The checked proposal assignment is unavailable. Refresh story work and try again."
    });
  }
  if (
    assignment.status !== "artifact-ready" &&
    assignment.status !== "awaiting-review"
  ) {
    return Object.freeze({
      ok: false,
      message:
        "The checked proposal is no longer awaiting review. Run a fresh check or open that assignment directly."
    });
  }
  if (assignment.currentArtifact === undefined) {
    return Object.freeze({
      ok: false,
      message: "The checked proposal no longer has a reviewable artifact."
    });
  }
  if (!sameStoryWorkArtifactPointer(assignment.currentArtifact, expectedArtifact)) {
    return Object.freeze({
      ok: false,
      message:
        "The checked proposal changed since this check ran. Run a fresh check before starting a revision."
    });
  }
  return Object.freeze({ ok: true });
}
