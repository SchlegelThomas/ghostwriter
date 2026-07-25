import { describe, expect, it } from "vitest";
import { DomainValidationError } from "./domain.js";
import {
  isScenePartnerTurnV1,
  SCENE_PARTNER_TURN_V1_JSON_SCHEMA,
  SCENE_PARTNER_TURN_V1_SCHEMA_ID,
  validateScenePartnerTurnV1
} from "./scene-partner-turn-v1.js";

const validTurn = Object.freeze({
  schemaId: SCENE_PARTNER_TURN_V1_SCHEMA_ID,
  thinkingSteps: Object.freeze(["Reading idea", "Scanning scenes"]),
  assistantMessage: "This idea feels ready for a new scene.",
  phase: "new-scene" as const,
  matchedSceneId: null,
  proseDraft: null,
  actions: Object.freeze(["apply-new-scene", "propose-image"] as const),
  imagePrompt: "Quiet harbor lanterns at dusk"
});

describe("validateScenePartnerTurnV1", () => {
  it("accepts a complete turn and freezes the result", () => {
    const turn = validateScenePartnerTurnV1(validTurn);
    expect(turn.schemaId).toBe("scene-partner-turn-v1");
    expect(turn.thinkingSteps).toEqual(["Reading idea", "Scanning scenes"]);
    expect(turn.phase).toBe("new-scene");
    expect(turn.actions).toEqual(["apply-new-scene", "propose-image"]);
    expect(Object.isFrozen(turn)).toBe(true);
    expect(Object.isFrozen(turn.thinkingSteps)).toBe(true);
    expect(Object.isFrozen(turn.actions)).toBe(true);
  });

  it("accepts interview turns with empty actions and omitted nullables", () => {
    const turn = validateScenePartnerTurnV1({
      schemaId: "scene-partner-turn-v1",
      thinkingSteps: ["Reading idea"],
      assistantMessage: "What beat should land on the page?",
      phase: "interview",
      actions: []
    });
    expect(turn.matchedSceneId).toBeUndefined();
    expect(turn.proseDraft).toBeUndefined();
    expect(turn.imagePrompt).toBeUndefined();
    expect(turn.actions).toEqual([]);
  });

  it("rejects unexpected fields, bad phases, and action bounds", () => {
    expect(() =>
      validateScenePartnerTurnV1({ ...validTurn, extra: true })
    ).toThrow(DomainValidationError);

    expect(() =>
      validateScenePartnerTurnV1({ ...validTurn, phase: "chat" })
    ).toThrow(DomainValidationError);

    expect(() =>
      validateScenePartnerTurnV1({
        ...validTurn,
        thinkingSteps: []
      })
    ).toThrow(DomainValidationError);

    expect(() =>
      validateScenePartnerTurnV1({
        ...validTurn,
        actions: ["apply-new-scene", "propose-image", "apply-new-scene"]
      })
    ).toThrow(DomainValidationError);

    expect(() =>
      validateScenePartnerTurnV1({
        ...validTurn,
        actions: ["apply-new-scene", "apply-new-scene"]
      })
    ).toThrow(DomainValidationError);
  });

  it("exposes a strict JSON schema and a type guard", () => {
    expect(SCENE_PARTNER_TURN_V1_JSON_SCHEMA.additionalProperties).toBe(false);
    expect(SCENE_PARTNER_TURN_V1_JSON_SCHEMA.required).toEqual([
      "schemaId",
      "thinkingSteps",
      "assistantMessage",
      "phase",
      "matchedSceneId",
      "proseDraft",
      "actions",
      "imagePrompt"
    ]);
    expect(isScenePartnerTurnV1(validTurn)).toBe(true);
    expect(isScenePartnerTurnV1({ schemaId: "nope" })).toBe(false);
  });
});
