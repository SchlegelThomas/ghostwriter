import { describe, expect, it } from "vitest";
import {
  NEXT_ACTION_AUTO_DEBOUNCE_MS,
  NEXT_ACTION_COOLDOWN_MS,
  NEXT_ACTION_IDLE_THRESHOLD_MS,
  nextActionInvitationKindForPrefs,
  nextActionScheduleDelayMs,
  shouldAllowManualNextActionCoach,
  shouldOfferSceneSaveInvitation
} from "./next-action-invitation.js";

const base = {
  dismissedForRevision: false,
  hasOpenNextActionMessage: false,
  hasReadyNextActionProposal: false,
  saveAcknowledged: true
} as const;

describe("next-action-invitation", () => {
  it("offers local invite after idle when Auto is off", () => {
    expect(
      shouldOfferSceneSaveInvitation({
        ...base,
        autoSuggestionsEnabled: false,
        idleElapsedMs: NEXT_ACTION_IDLE_THRESHOLD_MS
      })
    ).toMatchObject({ showLocalInvite: true, mayRunAmbientCoach: false });
  });

  it("runs ambient only after Auto debounce and never shows Start invite", () => {
    expect(
      shouldOfferSceneSaveInvitation({
        ...base,
        autoSuggestionsEnabled: true,
        idleElapsedMs: NEXT_ACTION_AUTO_DEBOUNCE_MS
      })
    ).toEqual({
      showLocalInvite: false,
      mayRunAmbientCoach: true
    });
  });

  it("blocks when an undismissed next-steps message is open", () => {
    expect(
      shouldOfferSceneSaveInvitation({
        ...base,
        autoSuggestionsEnabled: true,
        hasOpenNextActionMessage: true,
        idleElapsedMs: NEXT_ACTION_AUTO_DEBOUNCE_MS
      }).blockedReason
    ).toBe("open-message");
  });

  it("blocks within the 3-minute cooldown", () => {
    expect(
      shouldOfferSceneSaveInvitation({
        ...base,
        autoSuggestionsEnabled: true,
        idleElapsedMs: NEXT_ACTION_AUTO_DEBOUNCE_MS,
        msSinceLastSuggestion: NEXT_ACTION_COOLDOWN_MS - 1
      }).blockedReason
    ).toBe("cooldown");
    expect(
      shouldAllowManualNextActionCoach({
        hasOpenNextActionMessage: false,
        msSinceLastSuggestion: 1_000
      })
    ).toEqual({ allowed: false, blockedReason: "cooldown" });
  });

  it("allows manual coach when cooldown clear and no open message", () => {
    expect(
      shouldAllowManualNextActionCoach({
        hasOpenNextActionMessage: false,
        msSinceLastSuggestion: NEXT_ACTION_COOLDOWN_MS
      })
    ).toEqual({ allowed: true });
  });

  it("maps prefs and schedule delay", () => {
    expect(nextActionInvitationKindForPrefs(true)).toBe("coach-start");
    expect(nextActionScheduleDelayMs(true)).toBe(NEXT_ACTION_AUTO_DEBOUNCE_MS);
    expect(nextActionScheduleDelayMs(false)).toBe(NEXT_ACTION_IDLE_THRESHOLD_MS);
  });
});
