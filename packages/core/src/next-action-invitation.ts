/** Manual (Auto off): wait after save before soft in-chat invite. */
export const NEXT_ACTION_IDLE_THRESHOLD_MS = 2_000;
/** Auto on: wait for save bursts to settle before running coach. */
export const NEXT_ACTION_AUTO_DEBOUNCE_MS = 2_500;
/** Minimum gap between ambient/manual coach posts (same project). */
export const NEXT_ACTION_COOLDOWN_MS = 3 * 60 * 1_000;

export type NextActionTriggerEvent = Readonly<{
  trigger: "scene-prose-saved";
  sceneId: string;
  revision: number;
}>;

export const NEXT_ACTION_INVITATION_KINDS = Object.freeze([
  "local-guide",
  "coach-start"
] as const);

export type NextActionInvitationKind =
  (typeof NEXT_ACTION_INVITATION_KINDS)[number];

export type SceneSaveInvitationInput = Readonly<{
  autoSuggestionsEnabled: boolean;
  dismissedForRevision: boolean;
  /** True when an undismissed next-steps turn is still in the active chat. */
  hasOpenNextActionMessage: boolean;
  hasReadyNextActionProposal: boolean;
  saveAcknowledged: boolean;
  idleElapsedMs: number;
  /** Ms since last next-steps post (ambient or manual). */
  msSinceLastSuggestion?: number;
  idleThresholdMs?: number;
  autoDebounceMs?: number;
  cooldownMs?: number;
}>;

export type SceneSaveInvitationResult = Readonly<{
  showLocalInvite: boolean;
  mayRunAmbientCoach: boolean;
  blockedReason?:
    | "not-saved"
    | "dismissed"
    | "open-message"
    | "ready-proposal"
    | "cooldown"
    | "idle";
}>;

export function shouldOfferSceneSaveInvitation(
  input: SceneSaveInvitationInput
): SceneSaveInvitationResult {
  if (!input.saveAcknowledged) {
    return Object.freeze({
      showLocalInvite: false,
      mayRunAmbientCoach: false,
      blockedReason: "not-saved"
    });
  }
  if (input.dismissedForRevision) {
    return Object.freeze({
      showLocalInvite: false,
      mayRunAmbientCoach: false,
      blockedReason: "dismissed"
    });
  }
  if (input.hasOpenNextActionMessage) {
    return Object.freeze({
      showLocalInvite: false,
      mayRunAmbientCoach: false,
      blockedReason: "open-message"
    });
  }
  if (input.hasReadyNextActionProposal) {
    return Object.freeze({
      showLocalInvite: false,
      mayRunAmbientCoach: false,
      blockedReason: "ready-proposal"
    });
  }

  const cooldownMs = input.cooldownMs ?? NEXT_ACTION_COOLDOWN_MS;
  const since = input.msSinceLastSuggestion;
  if (since !== undefined && since < cooldownMs) {
    return Object.freeze({
      showLocalInvite: false,
      mayRunAmbientCoach: false,
      blockedReason: "cooldown"
    });
  }

  if (input.autoSuggestionsEnabled) {
    const autoDebounceMs =
      input.autoDebounceMs ?? NEXT_ACTION_AUTO_DEBOUNCE_MS;
    if (input.idleElapsedMs < autoDebounceMs) {
      return Object.freeze({
        showLocalInvite: false,
        mayRunAmbientCoach: false,
        blockedReason: "idle"
      });
    }
    return Object.freeze({
      showLocalInvite: false,
      mayRunAmbientCoach: true
    });
  }

  const idleThresholdMs =
    input.idleThresholdMs ?? NEXT_ACTION_IDLE_THRESHOLD_MS;
  if (input.idleElapsedMs < idleThresholdMs) {
    return Object.freeze({
      showLocalInvite: false,
      mayRunAmbientCoach: false,
      blockedReason: "idle"
    });
  }
  return Object.freeze({
    showLocalInvite: true,
    mayRunAmbientCoach: false
  });
}

/** Manual ghost-mark press — ignores save idle, still respects open message + cooldown. */
export function shouldAllowManualNextActionCoach(input: Readonly<{
  hasOpenNextActionMessage: boolean;
  msSinceLastSuggestion?: number;
  cooldownMs?: number;
}>): Readonly<{ allowed: boolean; blockedReason?: "open-message" | "cooldown" }> {
  if (input.hasOpenNextActionMessage) {
    return Object.freeze({ allowed: false, blockedReason: "open-message" });
  }
  const cooldownMs = input.cooldownMs ?? NEXT_ACTION_COOLDOWN_MS;
  const since = input.msSinceLastSuggestion;
  if (since !== undefined && since < cooldownMs) {
    return Object.freeze({ allowed: false, blockedReason: "cooldown" });
  }
  return Object.freeze({ allowed: true });
}

export function nextActionInvitationKindForPrefs(
  autoSuggestionsEnabled: boolean
): NextActionInvitationKind {
  return autoSuggestionsEnabled ? "coach-start" : "local-guide";
}

export function nextActionScheduleDelayMs(
  autoSuggestionsEnabled: boolean
): number {
  return autoSuggestionsEnabled
    ? NEXT_ACTION_AUTO_DEBOUNCE_MS
    : NEXT_ACTION_IDLE_THRESHOLD_MS;
}
