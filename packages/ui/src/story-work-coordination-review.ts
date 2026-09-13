export type StoryWorkCoordinationReviewStepActionKind =
  | "start-root"
  | "open-root-review"
  | "continue-check"
  | "start-check"
  | "open-check-review"
  | "recover-child"
  | "retry-child";

export type StoryWorkCoordinationReviewStepKind =
  | "scene-draft"
  | "proposal-continuity-check";

export type StoryWorkCoordinationReviewStepState =
  | "blocked"
  | "ready"
  | "draft-ready"
  | "running"
  | "awaiting-review"
  | "completed"
  | "failed"
  | "canceled"
  | "stale"
  | "rejected";

export type StoryWorkCoordinationStepBlockedReason =
  | "upstream-not-ready"
  | "upstream-terminal"
  | "upstream-artifact-missing"
  | "upstream-artifact-expired";

export type StoryWorkCoordinationReviewAssignmentStatus =
  | "brief-ready"
  | "running"
  | "artifact-ready"
  | "awaiting-review"
  | "reviewed"
  | "applied"
  | "failed"
  | "canceled"
  | "stale"
  | "rejected";

export type StoryWorkCoordinationReviewStepNeutralInput = Readonly<{
  stepId: string;
  title: string;
  kind: StoryWorkCoordinationReviewStepKind;
  state: StoryWorkCoordinationReviewStepState;
  blockedReasons?: readonly StoryWorkCoordinationStepBlockedReason[];
  assignmentStatus?: StoryWorkCoordinationReviewAssignmentStatus;
  /** Deferred check step is ready to bind against the resolved upstream artifact. */
  continueCheckReady?: boolean;
  /** Child check assignment exists after continue. */
  checkBound?: boolean;
}>;

export type StoryWorkCoordinationReviewStepAction = Readonly<{
  kind: StoryWorkCoordinationReviewStepActionKind;
  label: string;
}>;

export type StoryWorkCoordinationReviewStepViewModel = Readonly<{
  stepId: string;
  title: string;
  kind: StoryWorkCoordinationReviewStepKind;
  statusLabel: string;
  detail: string;
  blockedReason?: string;
  action?: StoryWorkCoordinationReviewStepAction;
}>;

export type StoryWorkCoordinatedCheckBriefFields = Readonly<{
  brief: string;
  constraints: string;
  doneWhen: string;
}>;

const TERMINAL_ASSIGNMENT_STATUSES = new Set<StoryWorkCoordinationReviewAssignmentStatus>([
  "failed",
  "canceled",
  "stale",
  "rejected"
]);

const OPEN_REVIEW_ASSIGNMENT_STATUSES = new Set<StoryWorkCoordinationReviewAssignmentStatus>([
  "artifact-ready",
  "awaiting-review",
  "reviewed"
]);

export function storyWorkCoordinationReviewRefreshCopy(): string {
  return "Refresh reloads coordination and assignment truth from the server. It never auto-continues a step or spends provider quota.";
}

export function storyWorkCoordinationReviewForegroundCopy(): string {
  return "Each step waits for your explicit action. Reload shows durable status only; Continue, Resume, and Retry never run without a button press.";
}

export function storyWorkCoordinationStepBlockedReasonCopy(
  reason: StoryWorkCoordinationStepBlockedReason
): string {
  switch (reason) {
    case "upstream-not-ready":
      return "Waiting for the upstream scene draft to reach a reviewable proposal.";
    case "upstream-terminal":
      return "The upstream scene draft stopped before a reviewable proposal existed.";
    case "upstream-artifact-missing":
      return "The upstream proposal artifact is unavailable. Refresh coordination details.";
    case "upstream-artifact-expired":
      return "The upstream scene was applied to the manuscript; this check depends on the reviewable proposal artifact.";
  }
}

export function storyWorkCoordinationStepBlockedReasonPresentation(
  reasons: readonly StoryWorkCoordinationStepBlockedReason[] | undefined
): string | undefined {
  if (reasons === undefined || reasons.length === 0) return undefined;
  return reasons.map(storyWorkCoordinationStepBlockedReasonCopy).join(" ");
}

export function storyWorkCoordinationReviewActionLabel(
  kind: StoryWorkCoordinationReviewStepActionKind
): string {
  switch (kind) {
    case "start-root":
      return "Start scene draft";
    case "open-root-review":
      return "Open scene draft review";
    case "continue-check":
      return "Continue continuity check";
    case "start-check":
      return "Start continuity check";
    case "open-check-review":
      return "Open continuity check review";
    case "recover-child":
      return "Refresh running generation";
    case "retry-child":
      return "Retry this step";
  }
}

export function storyWorkCoordinationStepStatusLabel(input: Readonly<{
  state: StoryWorkCoordinationReviewStepState;
  kind: StoryWorkCoordinationReviewStepKind;
  assignmentStatus?: StoryWorkCoordinationReviewAssignmentStatus;
}>): string {
  if (input.state === "blocked") return "Blocked";
  if (input.state === "running") return "Working";
  if (input.state === "draft-ready") return "Draft ready";
  if (input.state === "awaiting-review") return "Awaiting review";
  if (input.state === "completed") {
    if (input.kind === "scene-draft" && input.assignmentStatus === "applied") {
      return "Applied to story";
    }
    return "Review complete";
  }
  if (input.state === "canceled") return "Canceled";
  if (input.state === "failed" || input.state === "stale" || input.state === "rejected") {
    return "Needs attention";
  }
  if (input.state === "ready") {
    if (input.assignmentStatus === "brief-ready") return "Brief ready";
    return "Ready";
  }
  return "Ready";
}

export function storyWorkCoordinationStepDetail(input: Readonly<{
  kind: StoryWorkCoordinationReviewStepKind;
  state: StoryWorkCoordinationReviewStepState;
  assignmentStatus?: StoryWorkCoordinationReviewAssignmentStatus;
  continueCheckReady?: boolean;
}>): string {
  if (input.kind === "scene-draft") {
    switch (input.state) {
      case "blocked":
        return "The scene draft cannot start until coordination details are available.";
      case "ready":
        return "Start the scene draft when you are ready. Provider usage begins only after you press Start.";
      case "draft-ready":
        return "A reviewable scene draft proposal is ready and waits for your review before the chain continues.";
      case "running":
        return "Ghostwriter is generating the scene draft. Refresh to reconcile status after reload.";
      case "awaiting-review":
        return "You opened scene draft review. Finish apply or reject on the existing scene review surface.";
      case "completed":
        if (input.assignmentStatus === "applied") {
          return "This scene draft was applied to your manuscript.";
        }
        return "Scene draft review is complete.";
      case "failed":
      case "stale":
      case "rejected":
        return "The scene draft needs your attention before the chain can continue.";
      case "canceled":
        return "This scene draft step was canceled.";
    }
  }
  switch (input.state) {
    case "blocked":
      return "The continuity check stays blocked until the upstream scene draft proposal is ready.";
    case "ready":
      if (input.continueCheckReady) {
        return "The upstream proposal is ready. Continue explicitly to bind and prepare the continuity check.";
      }
      if (input.assignmentStatus === "brief-ready") {
        return "Start the continuity check when you are ready. It reads the bound proposal artifact only.";
      }
      return "This continuity check step is ready for your next explicit action.";
    case "draft-ready":
      return "Continuity findings are ready as a reviewable proposal and wait for your review.";
    case "running":
      return "Ghostwriter is running the continuity check. Refresh to reconcile status after reload.";
    case "awaiting-review":
      return "You opened continuity check review. Finish review on the existing check review surface.";
    case "completed":
      return "Continuity check review is complete.";
    case "failed":
    case "stale":
    case "rejected":
      return "The continuity check needs your attention before the chain can continue.";
    case "canceled":
      return "This continuity check step was canceled.";
  }
}

export function deriveStoryWorkCoordinationReviewStepActionKind(
  input: StoryWorkCoordinationReviewStepNeutralInput
): StoryWorkCoordinationReviewStepActionKind | undefined {
  if (input.state === "blocked") return undefined;

  if (input.kind === "scene-draft") {
    const status = input.assignmentStatus;
    if (status === undefined) return undefined;
    if (status === "brief-ready") return "start-root";
    if (status === "artifact-ready" || status === "awaiting-review") {
      return "open-root-review";
    }
    if (status === "running") return "recover-child";
    if (TERMINAL_ASSIGNMENT_STATUSES.has(status)) return "retry-child";
    return undefined;
  }

  if (input.continueCheckReady) return "continue-check";
  const status = input.assignmentStatus;
  if (status === undefined) return undefined;
  if (status === "brief-ready" && input.checkBound) return "start-check";
  if (OPEN_REVIEW_ASSIGNMENT_STATUSES.has(status)) return "open-check-review";
  if (status === "running") return "recover-child";
  if (TERMINAL_ASSIGNMENT_STATUSES.has(status)) return "retry-child";
  return undefined;
}

export function buildStoryWorkCoordinationReviewStepView(
  input: StoryWorkCoordinationReviewStepNeutralInput
): StoryWorkCoordinationReviewStepViewModel {
  const statusLabel = storyWorkCoordinationStepStatusLabel({
    state: input.state,
    kind: input.kind,
    assignmentStatus: input.assignmentStatus
  });
  const detail = storyWorkCoordinationStepDetail({
    kind: input.kind,
    state: input.state,
    assignmentStatus: input.assignmentStatus,
    continueCheckReady: input.continueCheckReady
  });
  const blockedReason = storyWorkCoordinationStepBlockedReasonPresentation(
    input.blockedReasons
  );
  const actionKind = deriveStoryWorkCoordinationReviewStepActionKind(input);
  const action =
    actionKind === undefined
      ? undefined
      : Object.freeze({
          kind: actionKind,
          label: storyWorkCoordinationReviewActionLabel(actionKind)
        });
  return Object.freeze({
    stepId: input.stepId,
    title: input.title,
    kind: input.kind,
    statusLabel,
    detail,
    ...(blockedReason === undefined ? {} : { blockedReason }),
    ...(action === undefined ? {} : { action })
  });
}

export function validateStoryWorkCoordinatedCheckFields(input: Readonly<{
  enabled: boolean;
  fields: StoryWorkCoordinatedCheckBriefFields;
}>): Readonly<{ valid: boolean; errors: readonly string[] }> {
  if (!input.enabled) {
    return Object.freeze({ valid: true, errors: Object.freeze([]) });
  }
  const errors: string[] = [];
  if (input.fields.brief.trim().length === 0) {
    errors.push("Check brief is required when a continuity check follows this draft.");
  }
  if (input.fields.constraints.trim().length === 0) {
    errors.push("Check constraints are required when a continuity check follows this draft.");
  }
  if (input.fields.doneWhen.trim().length === 0) {
    errors.push("Check done when is required when a continuity check follows this draft.");
  }
  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors)
  });
}

export function storyWorkSceneCoordinationFollowUpCopy(): string {
  return "The scene draft stays reviewable on its own. The continuity check starts only after you explicitly continue it in coordinated story work.";
}
