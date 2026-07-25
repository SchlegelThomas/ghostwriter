/**
 * Scene Partner conversational helpers (checkpoint 8).
 *
 * Live path: BYOK OpenAI turns/images via backend when the writer key is
 * configured. Hermetic path: deterministic local script + placeholder images
 * when the provider is not configured (or as an explicit fallback for images).
 * Apply stays human-gated via parent handlers.
 */

export const SCENE_PARTNER_SHORT_IDEA_MAX_CHARS = 48;

export const SCENE_PARTNER_THINKING_STEPS = [
  "reading-idea",
  "scanning-scenes",
  "evaluating-match",
  "drafting-response"
] as const;

export type ScenePartnerThinkingStepId =
  (typeof SCENE_PARTNER_THINKING_STEPS)[number];

export type ScenePartnerActionKind = "apply-new-scene" | "propose-image";

export type ScenePartnerMessageKind =
  | "thinking"
  | "assistant"
  | "user"
  | "image-proposal";

export type ScenePartnerScriptPhase =
  | "interview"
  | "match"
  | "new-scene"
  | "iterate";

export type ScenePartnerManuscriptScene = Readonly<{
  id: string;
  title: string;
  label: string;
}>;

export type ScenePartnerImageProposal = Readonly<{
  /** Deterministic placeholder (SVG data URI) for this slice. */
  url: string;
  alt: string;
  prompt: string;
}>;

export type ScenePartnerChatMessage = Readonly<{
  id: string;
  role: "assistant" | "user";
  kind: ScenePartnerMessageKind;
  body: string;
  thinkingStepId?: ScenePartnerThinkingStepId;
  actions?: readonly ScenePartnerActionKind[];
  imageProposal?: ScenePartnerImageProposal;
  proseDraft?: string;
}>;

export type ScenePartnerOpening = Readonly<{
  phase: ScenePartnerScriptPhase;
  matchedScene: ScenePartnerManuscriptScene | undefined;
  thinkingSteps: readonly ScenePartnerThinkingStepId[];
  messages: readonly ScenePartnerChatMessage[];
}>;

export type ScenePartnerTurnResult = Readonly<{
  phase: ScenePartnerScriptPhase;
  messages: readonly ScenePartnerChatMessage[];
}>;

export type ScenePartnerLiveTurn = Readonly<{
  thinkingSteps: readonly string[];
  assistantMessage: string;
  phase: ScenePartnerScriptPhase;
  matchedSceneId: string | null;
  proseDraft: string | null;
  actions: readonly ScenePartnerActionKind[];
  imagePrompt: string | null;
}>;

export type ScenePartnerLiveImage = Readonly<{
  url: string;
  alt: string;
  prompt: string;
}>;

let messageSerial = 0;

function nextMessageId(prefix: string): string {
  messageSerial += 1;
  return `scene-partner-${prefix}-${messageSerial}`;
}

/** Test helper — keeps ids stable across suites when needed. */
export function resetScenePartnerMessageSerial(): void {
  messageSerial = 0;
}

export function isScenePartnerIdeaTooShort(ideaProse: string): boolean {
  return ideaProse.trim().length < SCENE_PARTNER_SHORT_IDEA_MAX_CHARS;
}

export function labelForScenePartnerThinkingStep(
  stepId: ScenePartnerThinkingStepId
): string {
  switch (stepId) {
    case "reading-idea":
      return "Reading idea";
    case "scanning-scenes":
      return "Scanning scenes";
    case "evaluating-match":
      return "Evaluating match";
    case "drafting-response":
      return "Drafting response";
  }
}

export function scenePartnerThinkingStepsForOpening(
  ideaProse: string
): readonly ScenePartnerThinkingStepId[] {
  if (isScenePartnerIdeaTooShort(ideaProse)) {
    return ["reading-idea", "drafting-response"];
  }
  return SCENE_PARTNER_THINKING_STEPS;
}

function tokenize(text: string): readonly string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((token) => token.length >= 4);
}

export function findScenePartnerMatch(
  ideaProse: string,
  scenes: readonly ScenePartnerManuscriptScene[]
): ScenePartnerManuscriptScene | undefined {
  const ideaTokens = new Set(tokenize(ideaProse));
  if (ideaTokens.size === 0) return undefined;

  let best:
    | Readonly<{ scene: ScenePartnerManuscriptScene; score: number }>
    | undefined;
  for (const scene of scenes) {
    const haystack = tokenize(`${scene.title} ${scene.label}`);
    let score = 0;
    for (const token of haystack) {
      if (ideaTokens.has(token)) score += 1;
    }
    if (score === 0) continue;
    if (best === undefined || score > best.score) {
      best = { scene, score };
    }
  }
  return best?.scene;
}

export function scenePartnerPlaceholderImageDataUri(seed: string): string {
  const safe = seed.replace(/[^a-zA-Z0-9 _.-]/gu, "").slice(0, 48) || "Scene";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#f2eee7"/>
      <stop offset="100%" stop-color="#e8f0f4"/>
    </linearGradient>
  </defs>
  <rect width="640" height="360" fill="url(#g)"/>
  <rect x="24" y="24" width="592" height="312" fill="none" stroke="#ddd5ca" stroke-width="2"/>
  <text x="320" y="170" text-anchor="middle" fill="#766c63" font-family="Georgia, serif" font-size="28">Scene study</text>
  <text x="320" y="210" text-anchor="middle" fill="#28231f" font-family="Georgia, serif" font-size="18">${safe}</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function assistantMessage(
  body: string,
  extras: Partial<
    Omit<ScenePartnerChatMessage, "id" | "role" | "kind" | "body">
  > = {}
): ScenePartnerChatMessage {
  return {
    id: nextMessageId("assistant"),
    role: "assistant",
    kind: "assistant",
    body,
    ...extras
  };
}

function userMessage(body: string): ScenePartnerChatMessage {
  return {
    id: nextMessageId("user"),
    role: "user",
    kind: "user",
    body
  };
}

function imageProposalMessage(
  ideaProse: string
): ScenePartnerChatMessage {
  const prompt =
    ideaProse.trim().length > 0
      ? `Quiet literary study for: ${ideaProse.trim().slice(0, 120)}`
      : "Quiet literary study of an unnamed scene";
  const url = scenePartnerPlaceholderImageDataUri(
    ideaProse.trim().slice(0, 40) || "untitled"
  );
  return {
    id: nextMessageId("image"),
    role: "assistant",
    kind: "image-proposal",
    body: "Here is a scene image proposal. Nothing is saved until you apply it later.",
    imageProposal: {
      url,
      alt: "Proposed scene image (placeholder)",
      prompt
    }
  };
}

export function buildScenePartnerOpening(input: Readonly<{
  ideaProse: string;
  scenes: readonly ScenePartnerManuscriptScene[];
}>): ScenePartnerOpening {
  const ideaProse = input.ideaProse.trim();
  const thinkingSteps = scenePartnerThinkingStepsForOpening(ideaProse);

  if (isScenePartnerIdeaTooShort(ideaProse)) {
    return {
      phase: "interview",
      matchedScene: undefined,
      thinkingSteps,
      messages: [
        assistantMessage(
          ideaProse.length === 0
            ? "This idea is still thin. What moment, feeling, or conflict should become a scene?"
            : "I have a glimpse of the idea, but not enough to place it yet. What is the central beat you want on the page?"
        )
      ]
    };
  }

  const matchedScene = findScenePartnerMatch(ideaProse, input.scenes);
  if (matchedScene !== undefined) {
    return {
      phase: "match",
      matchedScene,
      thinkingSteps,
      messages: [
        assistantMessage(
          `I scanned the manuscript and found a possible home: “${matchedScene.title}”. We can deepen that scene, or start a new one from this idea.`
        ),
        assistantMessage(
          "Tell me how you want to shape the prose — or ask for a scene image study.",
          {
            actions: ["apply-new-scene", "propose-image"]
          }
        )
      ]
    };
  }

  return {
    phase: "new-scene",
    matchedScene: undefined,
    thinkingSteps,
    messages: [
      assistantMessage(
        "I scanned the manuscript and did not find a clear match. This idea feels ready to become a new scene."
      ),
      assistantMessage(
        "We can draft the opening together. When you are ready, apply it as a new scene — nothing enters the manuscript until you do.",
        {
          actions: ["apply-new-scene", "propose-image"]
        }
      )
    ]
  };
}

function wantsImage(userText: string): boolean {
  return /\b(image|picture|visual|illustration|drawing)\b/i.test(userText);
}

function wantsApply(userText: string): boolean {
  return /\b(apply|place it|add (it )?to (the )?manuscript|make (it )?a scene)\b/i.test(
    userText
  );
}

function draftProseFromIdea(ideaProse: string, userText: string): string {
  const seed = ideaProse.trim() || userText.trim();
  const lead = seed.split(/(?<=[.!?])\s+/u)[0] ?? seed;
  return `${lead.replace(/\.$/u, "")}. Soft light holds for a breath; the moment waits for the next line.`;
}

export function advanceScenePartnerTurn(input: Readonly<{
  phase: ScenePartnerScriptPhase;
  userText: string;
  ideaProse: string;
  matchedScene: ScenePartnerManuscriptScene | undefined;
  scenes: readonly ScenePartnerManuscriptScene[];
}>): ScenePartnerTurnResult {
  const userText = input.userText.trim();
  const user = userMessage(userText);

  if (userText.length === 0) {
    return {
      phase: input.phase,
      messages: [
        user,
        assistantMessage("Say a little more whenever you are ready.")
      ]
    };
  }

  if (input.phase === "interview") {
    const enrichedIdea = [input.ideaProse, userText].filter(Boolean).join(" ");
    const opening = buildScenePartnerOpening({
      ideaProse: enrichedIdea,
      scenes: input.scenes
    });
    if (opening.phase === "interview") {
      return {
        phase: "interview",
        messages: [
          user,
          assistantMessage(
            "Still a little unclear. Who is in the moment, and what changes by the end of it?"
          )
        ]
      };
    }
    return {
      phase: opening.phase === "match" ? "match" : "new-scene",
      messages: [user, ...opening.messages]
    };
  }

  if (wantsImage(userText)) {
    return {
      phase: "iterate",
      messages: [user, imageProposalMessage(input.ideaProse || userText)]
    };
  }

  if (wantsApply(userText)) {
    return {
      phase: "iterate",
      messages: [
        user,
        assistantMessage(
          "I can prepare this as a new scene. Review the title and placement, then apply — the draft stays unchanged until you confirm.",
          { actions: ["apply-new-scene"] }
        )
      ]
    };
  }

  const proseDraft = draftProseFromIdea(input.ideaProse, userText);
  const matchNote =
    input.matchedScene !== undefined
      ? ` Keeping “${input.matchedScene.title}” in mind as a possible anchor.`
      : "";

  return {
    phase: "iterate",
    messages: [
      user,
      assistantMessage(
        `Here is a draft beat to try:${matchNote}`,
        {
          proseDraft,
          actions: ["apply-new-scene", "propose-image"]
        }
      ),
      assistantMessage(
        "We can revise that line, ask clarifying questions, or propose a scene image."
      )
    ]
  };
}

export function buildScenePartnerImageProposalTurn(
  ideaProse: string
): ScenePartnerTurnResult {
  return {
    phase: "iterate",
    messages: [imageProposalMessage(ideaProse)]
  };
}

export function thinkingMessagesForSteps(
  steps: readonly ScenePartnerThinkingStepId[]
): readonly ScenePartnerChatMessage[] {
  return steps.map((thinkingStepId) => ({
    id: nextMessageId(`thinking-${thinkingStepId}`),
    role: "assistant" as const,
    kind: "thinking" as const,
    thinkingStepId,
    body: labelForScenePartnerThinkingStep(thinkingStepId)
  }));
}

/** Live API thinking labels (free-form short strings). */
export function thinkingMessagesForLabels(
  labels: readonly string[]
): readonly ScenePartnerChatMessage[] {
  return labels.map((label, index) => ({
    id: nextMessageId(`thinking-live-${index}`),
    role: "assistant" as const,
    kind: "thinking" as const,
    body: label.trim().length > 0 ? label.trim() : "Thinking"
  }));
}

export function messagesFromScenePartnerLiveTurn(
  turn: ScenePartnerLiveTurn
): readonly ScenePartnerChatMessage[] {
  return [
    assistantMessage(turn.assistantMessage, {
      ...(turn.proseDraft !== null && turn.proseDraft !== undefined
        ? { proseDraft: turn.proseDraft }
        : {}),
      ...(turn.actions.length > 0 ? { actions: turn.actions } : {})
    })
  ];
}

export function imageProposalMessageFromLive(
  image: ScenePartnerLiveImage
): ScenePartnerChatMessage {
  return {
    id: nextMessageId("image"),
    role: "assistant",
    kind: "image-proposal",
    body: "Here is a scene image proposal. Nothing is saved until you apply it later.",
    imageProposal: {
      url: image.url,
      alt: image.alt,
      prompt: image.prompt
    }
  };
}

export function scenePartnerTranscriptForApi(
  messages: readonly ScenePartnerChatMessage[]
): readonly Readonly<{ role: "assistant" | "user"; body: string }>[] {
  return messages
    .filter(
      (message) =>
        message.kind === "assistant" ||
        message.kind === "user" ||
        message.kind === "image-proposal"
    )
    .map((message) => ({
      role: message.role,
      body: message.body
    }));
}
