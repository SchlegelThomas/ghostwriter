import {
  STORY_CHECK_MAX_DEFER_REASON_CHARS,
  type SceneId,
  type StoryCheckCoverageV1,
  type StoryCheckEvidenceAnchor,
  type StoryCheckFindingKind,
  type StoryCheckFindingResolution,
  type StoryCheckFindingSeverity,
  type StoryCheckFindingV1,
  type StoryCheckFindingsV1,
  type StoryCheckSpecialist,
  type StoryCheckStoredPayloadFreshness,
  type StoryCheckStoredPayloadFreshnessReason,
  type StoryCheckTarget,
  type StoryWorkArtifactPointer
} from "@ghostwriter/core";

export type StoryCheckReviewArtifact = Readonly<{
  pointer: StoryWorkArtifactPointer;
  payload: StoryCheckFindingsV1;
}>;

/** Presentational resolve callback sends one finding resolution only; trusted payload fields stay server-side. */
export type StoryCheckReviewResolveInput = Readonly<{
  artifact: StoryWorkArtifactPointer;
  findingId: string;
  resolution: StoryCheckFindingResolution;
}>;

export type StoryCheckReviewSceneLabel = Readonly<{
  sceneId: SceneId;
  title: string;
}>;

export type StoryCheckResolutionEditorDraft = Readonly<{
  findingId: string;
  status: "deferred";
  reason: string;
}>;

export type StoryCheckCoveragePresentation = Readonly<{
  requestedScopeSummary: string;
  examinedLines: readonly string[];
  skippedLines: readonly string[];
  truncationLines: readonly string[];
  completenessLabel: string;
  limitedCoverageNotice?: string;
}>;

const sceneTitleFor = (
  sceneId: SceneId,
  labels: readonly StoryCheckReviewSceneLabel[]
): string | undefined => labels.find((entry) => entry.sceneId === sceneId)?.title;

export function sameStoryCheckReviewArtifact(
  left: StoryWorkArtifactPointer,
  right: StoryWorkArtifactPointer
): boolean {
  return (
    left.proposalId === right.proposalId &&
    left.artifactVersion === right.artifactVersion &&
    left.contentHash === right.contentHash
  );
}

export function storyCheckFindingsReadyForCompletion(
  payload: StoryCheckFindingsV1
): boolean {
  return payload.findings.every((finding) => finding.resolution.status !== "open");
}

export function storyCheckReviewCanComplete(
  freshness: StoryCheckStoredPayloadFreshness,
  payload: StoryCheckFindingsV1
): boolean {
  if (freshness.status !== "fresh") return false;
  return storyCheckFindingsReadyForCompletion(payload);
}

export function storyCheckCoverageCompleteLabel(
  completeForRequestedScope: boolean
): string {
  return completeForRequestedScope
    ? "Complete for the requested scope"
    : "Limited coverage for the requested scope";
}

export function storyCheckCoveragePresentation(
  coverage: StoryCheckCoverageV1,
  sceneLabels: readonly StoryCheckReviewSceneLabel[]
): StoryCheckCoveragePresentation {
  const examinedLines = coverage.examined.map((entry) => {
    const title = sceneTitleFor(entry.sceneId, sceneLabels);
    const label = title ?? String(entry.sceneId);
    return `${label} · version ${entry.workingVersion}`;
  });
  const skippedLines = coverage.skipped.map((entry) => {
    const title = sceneTitleFor(entry.sceneId, sceneLabels);
    const label = title ?? String(entry.sceneId);
    return `${label} · ${entry.reason}`;
  });
  const truncationLines = coverage.truncations
    .filter((entry) => entry.truncated)
    .map(
      (entry) =>
        `${entry.resourceKind} ${entry.resourceId} · ${entry.providerCharCount} of ${entry.fullCharCount} characters read`
    );
  const limitedCoverageNotice = coverage.completeForRequestedScope
    ? undefined
    : "This check did not read every requested source in full. Treat zero findings as inconclusive, not as proof the manuscript is clean.";
  return Object.freeze({
    requestedScopeSummary: coverage.requestedScopeSummary,
    examinedLines: Object.freeze(examinedLines),
    skippedLines: Object.freeze(skippedLines),
    truncationLines: Object.freeze(truncationLines),
    completenessLabel: storyCheckCoverageCompleteLabel(
      coverage.completeForRequestedScope
    ),
    limitedCoverageNotice
  });
}

export function storyCheckFreshnessHeadline(
  freshness: StoryCheckStoredPayloadFreshness
): string {
  return freshness.status === "fresh" ? "Fresh" : "Needs recheck";
}

export function storyCheckFreshnessReasonCopy(
  reason: StoryCheckStoredPayloadFreshnessReason
): string {
  switch (reason) {
    case "scene-prose-changed":
      return "Scene prose changed since this check ran.";
    case "scene-intent-changed":
      return "Scene intent changed since this check ran.";
    case "chapter-objective-changed":
      return "Chapter objective changed since this check ran.";
    case "story-knowledge-changed":
      return "Story knowledge changed since this check ran.";
    case "manuscript-slice-changed":
      return "Manuscript structure changed since this check ran.";
    case "dependency-missing":
      return "A consumed dependency is no longer available.";
    case "proposal-artifact-changed":
      return "The bound proposal draft changed since this check ran.";
    case "proposal-artifact-missing":
      return "The bound proposal draft is no longer available.";
  }
}

export function storyCheckStaleInspectCopy(): string {
  return "Findings stay visible for inspection, but actions that assume current story state stay disabled until you run a fresh check.";
}

export function validateStoryCheckDeferReason(reason: string): string | undefined {
  const trimmed = reason.trim();
  if (trimmed.length === 0) {
    return "Add a short reason before deferring this finding.";
  }
  if (trimmed.length > STORY_CHECK_MAX_DEFER_REASON_CHARS) {
    return `Defer reason must be ${STORY_CHECK_MAX_DEFER_REASON_CHARS} characters or fewer.`;
  }
  return undefined;
}

export function storyCheckResolutionFromDraft(
  status: "dismissed" | "deferred",
  deferReason?: string
): StoryCheckFindingResolution | Readonly<{ error: string }> {
  if (status === "dismissed") {
    return Object.freeze({ status: "dismissed" });
  }
  const error = validateStoryCheckDeferReason(deferReason ?? "");
  if (error !== undefined) {
    return Object.freeze({ error });
  }
  return Object.freeze({ status: "deferred", reason: deferReason!.trim() });
}

export function storyCheckApplyFindingResolution(
  payload: StoryCheckFindingsV1,
  findingId: string,
  resolution: StoryCheckFindingResolution
): StoryCheckFindingsV1 {
  if (!payload.findings.some((finding) => finding.id === findingId)) {
    throw new Error("The requested finding is not in this check artifact.");
  }
  return Object.freeze({
    ...payload,
    findings: Object.freeze(
      payload.findings.map((finding) =>
        finding.id === findingId ? Object.freeze({ ...finding, resolution }) : finding
      )
    )
  });
}

export function storyCheckReviewHasResolutionEdits(
  working: StoryCheckFindingsV1,
  baseline: StoryCheckFindingsV1
): boolean {
  if (working.findings.length !== baseline.findings.length) return true;
  return working.findings.some((finding, index) => {
    const original = baseline.findings[index];
    if (original === undefined || original.id !== finding.id) return true;
    const left = finding.resolution;
    const right = original.resolution;
    if (left.status !== right.status) return true;
    if (left.status === "deferred" && right.status === "deferred") {
      return left.reason !== right.reason;
    }
    return false;
  });
}

export function storyCheckResolutionEditorDirty(
  draft: StoryCheckResolutionEditorDraft | undefined
): boolean {
  return draft !== undefined && draft.reason.trim().length > 0;
}

export function storyCheckSpecialistLabel(specialist: StoryCheckSpecialist): string {
  switch (specialist) {
    case "continuity":
      return "Continuity";
    case "character":
      return "Character";
    case "dialogue-completeness":
      return "Dialogue and completeness";
  }
}

export function storyCheckTargetModeLabel(target: StoryCheckTarget): string {
  return target.mode === "applied-scene"
    ? "Applied scene head"
    : "Reviewable scene proposal";
}

export function storyCheckFindingKindLabel(kind: StoryCheckFindingKind): string {
  switch (kind) {
    case "contradiction":
      return "Contradiction";
    case "suggestion":
      return "Suggestion";
    case "question":
      return "Question";
  }
}

export function storyCheckFindingSeverityLabel(
  severity: StoryCheckFindingSeverity
): string {
  switch (severity) {
    case "blocking":
      return "Blocking";
    case "important":
      return "Important";
    case "advisory":
      return "Advisory";
  }
}

export function storyCheckAnchorEvidenceLabel(
  anchor: StoryCheckEvidenceAnchor,
  sceneLabels: readonly StoryCheckReviewSceneLabel[]
): string {
  const title = sceneTitleFor(anchor.sceneId, sceneLabels);
  const sceneLabel = title ?? String(anchor.sceneId);
  const parts = [sceneLabel];
  if (anchor.blockId !== undefined) {
    parts.push(`block ${anchor.blockId}`);
  }
  if (anchor.quote !== undefined) {
    parts.push(`“${anchor.quote}”`);
  }
  if (anchor.storyKnowledgeId !== undefined) {
    parts.push(`story knowledge ${anchor.storyKnowledgeId}`);
  }
  return parts.join(" · ");
}

export function storyCheckLinkedRecheckSceneLabel(
  sceneId: SceneId,
  sceneLabels: readonly StoryCheckReviewSceneLabel[]
): string {
  return sceneTitleFor(sceneId, sceneLabels) ?? String(sceneId);
}

export function storyCheckRevisionPrefillInstruction(
  finding: StoryCheckFindingV1
): string {
  const lines = [
    `Address this ${storyCheckFindingKindLabel(finding.kind).toLowerCase()} from the continuity check:`,
    finding.claim
  ];
  if (finding.nextStep !== undefined && finding.nextStep.trim().length > 0) {
    lines.push(`Suggested next step: ${finding.nextStep.trim()}`);
  }
  return lines.join("\n");
}

export function storyCheckSourceScopeHint(): string {
  return "Only the scenes you select below are read as surrounding context. This is explicit selected scope, not your whole book.";
}
