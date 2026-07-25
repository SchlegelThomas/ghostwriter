import { beforeEach, describe, expect, it } from "vitest";
import {
  advanceScenePartnerTurn,
  buildScenePartnerImageProposalTurn,
  buildScenePartnerOpening,
  findScenePartnerMatch,
  imageProposalMessageFromLive,
  isScenePartnerIdeaTooShort,
  labelForScenePartnerThinkingStep,
  messagesFromScenePartnerLiveTurn,
  resetScenePartnerMessageSerial,
  SCENE_PARTNER_SHORT_IDEA_MAX_CHARS,
  SCENE_PARTNER_THINKING_STEPS,
  scenePartnerPlaceholderImageDataUri,
  scenePartnerThinkingStepsForOpening,
  scenePartnerTranscriptForApi,
  thinkingMessagesForLabels,
  thinkingMessagesForSteps
} from "./scene-partner-chat.js";

const scenes = [
  {
    id: "scene-harbor",
    title: "Harbor lanterns",
    label: "Book · Harbor lanterns"
  },
  {
    id: "scene-kitchen",
    title: "Kitchen quarrel",
    label: "Book · Kitchen quarrel"
  }
] as const;

beforeEach(() => {
  resetScenePartnerMessageSerial();
});

describe("isScenePartnerIdeaTooShort", () => {
  it("treats empty and very short prose as interview-first", () => {
    expect(isScenePartnerIdeaTooShort("")).toBe(true);
    expect(isScenePartnerIdeaTooShort("   ")).toBe(true);
    expect(isScenePartnerIdeaTooShort("A spark.")).toBe(true);
    expect(
      isScenePartnerIdeaTooShort("x".repeat(SCENE_PARTNER_SHORT_IDEA_MAX_CHARS))
    ).toBe(false);
  });
});

describe("scenePartnerThinkingStepsForOpening", () => {
  it("uses a shorter thinking path for interview openings", () => {
    expect(scenePartnerThinkingStepsForOpening("Hi")).toEqual([
      "reading-idea",
      "drafting-response"
    ]);
    expect(scenePartnerThinkingStepsForOpening("x".repeat(60))).toEqual([
      ...SCENE_PARTNER_THINKING_STEPS
    ]);
  });

  it("labels thinking steps for the writer-visible trail", () => {
    expect(labelForScenePartnerThinkingStep("reading-idea")).toBe(
      "Reading idea"
    );
    expect(labelForScenePartnerThinkingStep("scanning-scenes")).toBe(
      "Scanning scenes"
    );
    expect(labelForScenePartnerThinkingStep("evaluating-match")).toBe(
      "Evaluating match"
    );
    expect(labelForScenePartnerThinkingStep("drafting-response")).toBe(
      "Drafting response"
    );
  });

  it("builds thinking messages in sequence", () => {
    const messages = thinkingMessagesForSteps(["reading-idea", "scanning-scenes"]);
    expect(messages).toHaveLength(2);
    expect(messages[0]?.kind).toBe("thinking");
    expect(messages[0]?.body).toBe("Reading idea");
    expect(messages[1]?.body).toBe("Scanning scenes");
  });
});

describe("buildScenePartnerOpening", () => {
  it("asks an interview question when the idea is too short", () => {
    const opening = buildScenePartnerOpening({
      ideaProse: "Fog.",
      scenes
    });
    expect(opening.phase).toBe("interview");
    expect(opening.matchedScene).toBeUndefined();
    expect(opening.thinkingSteps).toEqual([
      "reading-idea",
      "drafting-response"
    ]);
    expect(opening.messages[0]?.kind).toBe("assistant");
    expect(opening.messages[0]?.body).toMatch(/central beat|thin/i);
    expect(opening.messages.some((message) => message.actions !== undefined)).toBe(
      false
    );
  });

  it("suggests a manuscript match when titles overlap the idea", () => {
    const opening = buildScenePartnerOpening({
      ideaProse:
        "The harbor lanterns tremble as she waits for the last ferry home tonight.",
      scenes
    });
    expect(opening.phase).toBe("match");
    expect(opening.matchedScene?.id).toBe("scene-harbor");
    expect(opening.thinkingSteps).toEqual([...SCENE_PARTNER_THINKING_STEPS]);
    expect(opening.messages[0]?.body).toMatch(/Harbor lanterns/);
    expect(opening.messages.some((message) =>
      message.actions?.includes("apply-new-scene")
    )).toBe(true);
  });

  it("suggests creating a new scene when nothing matches", () => {
    const opening = buildScenePartnerOpening({
      ideaProse:
        "A botanist finds a letter sealed inside a hollow seed pod at dawn.",
      scenes
    });
    expect(opening.phase).toBe("new-scene");
    expect(opening.matchedScene).toBeUndefined();
    expect(opening.messages[0]?.body).toMatch(/new scene/i);
    expect(
      opening.messages.some((message) =>
        message.actions?.includes("propose-image")
      )
    ).toBe(true);
  });
});

describe("findScenePartnerMatch", () => {
  it("returns undefined without overlapping tokens", () => {
    expect(
      findScenePartnerMatch("Quiet rain on copper roofs.", scenes)
    ).toBeUndefined();
  });
});

describe("advanceScenePartnerTurn", () => {
  it("moves from interview into a scan opening after a clarifying reply", () => {
    const result = advanceScenePartnerTurn({
      phase: "interview",
      userText:
        "She finds a sealed letter inside a hollow seed pod before sunrise.",
      ideaProse: "Fog.",
      matchedScene: undefined,
      scenes
    });
    expect(result.phase).toBe("new-scene");
    expect(result.messages[0]?.role).toBe("user");
    expect(
      result.messages.some((message) => message.body.match(/new scene/i))
    ).toBe(true);
  });

  it("offers an image-proposal message from the fake provider", () => {
    const result = advanceScenePartnerTurn({
      phase: "new-scene",
      userText: "Could you propose an image for this scene?",
      ideaProse: "A botanist finds a letter sealed inside a hollow seed pod.",
      matchedScene: undefined,
      scenes
    });
    const image = result.messages.find((message) => message.kind === "image-proposal");
    expect(image).toBeDefined();
    expect(image?.imageProposal?.url.startsWith("data:image/svg+xml")).toBe(true);
  });

  it("drafts iterable prose and keeps apply human-gated via chips", () => {
    const result = advanceScenePartnerTurn({
      phase: "new-scene",
      userText: "Make the opening quieter.",
      ideaProse: "A botanist finds a letter sealed inside a hollow seed pod.",
      matchedScene: undefined,
      scenes
    });
    expect(result.phase).toBe("iterate");
    expect(
      result.messages.some((message) => message.proseDraft !== undefined)
    ).toBe(true);
    expect(
      result.messages.some((message) =>
        message.actions?.includes("apply-new-scene")
      )
    ).toBe(true);
  });
});

describe("buildScenePartnerImageProposalTurn", () => {
  it("structures a deterministic image-proposal card", () => {
    const turn = buildScenePartnerImageProposalTurn("Harbor lanterns at dusk");
    expect(turn.messages[0]?.kind).toBe("image-proposal");
    expect(turn.messages[0]?.imageProposal?.prompt).toMatch(/Harbor lanterns/);
    expect(scenePartnerPlaceholderImageDataUri("Harbor")).toContain(
      "data:image/svg+xml"
    );
  });
});

describe("live Scene Partner helpers", () => {
  it("maps live turns and image payloads into chat messages", () => {
    const thinking = thinkingMessagesForLabels(["Reading idea", "Drafting"]);
    expect(thinking.map((message) => message.body)).toEqual([
      "Reading idea",
      "Drafting"
    ]);

    const messages = messagesFromScenePartnerLiveTurn({
      thinkingSteps: ["Reading idea"],
      assistantMessage: "Ready for a new scene.",
      phase: "new-scene",
      matchedSceneId: null,
      proseDraft: "Soft light holds.",
      actions: ["apply-new-scene", "propose-image"],
      imagePrompt: "Harbor study"
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]?.proseDraft).toBe("Soft light holds.");
    expect(messages[0]?.actions).toEqual(["apply-new-scene", "propose-image"]);

    const image = imageProposalMessageFromLive({
      url: "data:image/png;base64,abc",
      alt: "Proposed scene image",
      prompt: "Harbor study"
    });
    expect(image.kind).toBe("image-proposal");
    expect(image.imageProposal?.url).toContain("data:image/png");

    const transcript = scenePartnerTranscriptForApi([
      ...thinking,
      ...messages,
      image
    ]);
    expect(transcript).toEqual([
      { role: "assistant", body: "Ready for a new scene." },
      {
        role: "assistant",
        body: "Here is a scene image proposal. Nothing is saved until you apply it later."
      }
    ]);
  });
});
