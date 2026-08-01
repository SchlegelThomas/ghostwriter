import type { BookId, SceneId, StoryKnowledgeId } from "@ghostwriter/core";
import type { ManuscriptSelection } from "./manuscript-selection.js";

export type AgentToolkitId =
  | "scene-partner"
  | "cover"
  | "character-coach"
  | "worldkeeper"
  | "sketch-partner";

export type PlansAgentDeepLink = Readonly<{
  captureId?: string;
  proposalId?: string;
  highlight?: "plan-outline";
  workflowStep: "scene-partner" | "craft-partner" | "worldkeeper" | "plan-outline";
  craftSceneId?: string;
  craftCharacterId?: string;
  /** When set, InboxPanel should call beginCraftPartner after landing if selection is valid */
  autoStartWorkflowId?:
    | "sketch-partner.craft-fields"
    | "character-coach.sheet-fields"
    | "worldkeeper.backdrop-fields";
}>;

export type AgentToolkitSelection = Readonly<{
  bookId?: BookId;
  sceneId?: SceneId;
  storyKnowledgeId?: StoryKnowledgeId;
  /** Currently selected Plans capture if any */
  captureId?: string;
  /** Whether that capture can run partners (draft/ready) — caller can pass boolean */
  capturePartnerable?: boolean;
}>;

export type AgentToolkitActionResult =
  | {
      ok: true;
      kind: "plans";
      deepLink: PlansAgentDeepLink;
      statusMessage: string;
    }
  | { ok: true; kind: "cover"; bookId: BookId; statusMessage: string }
  | { ok: false; refusalMessage: string };

const PLANS_CAPTURE_REFUSAL =
  "Select an idea in Plans (draft or ready) before";

/** Returns either a deep-link/cover action or a refusal message. Pure. */
export function resolveAgentToolkitAction(
  id: AgentToolkitId,
  selection: AgentToolkitSelection
): AgentToolkitActionResult {
  switch (id) {
    case "scene-partner": {
      if (selection.captureId === undefined) {
        return {
          ok: false,
          refusalMessage: `${PLANS_CAPTURE_REFUSAL} Scene Partner.`
        };
      }
      if (selection.capturePartnerable === false) {
        return {
          ok: false,
          refusalMessage: `${PLANS_CAPTURE_REFUSAL} Scene Partner.`
        };
      }
      return {
        ok: true,
        kind: "plans",
        deepLink: {
          captureId: selection.captureId,
          workflowStep: "scene-partner"
        },
        statusMessage: "Opened Scene Partner in Plans."
      };
    }
    case "sketch-partner": {
      if (selection.captureId === undefined) {
        return {
          ok: false,
          refusalMessage: `${PLANS_CAPTURE_REFUSAL} Sketch Partner.`
        };
      }
      if (selection.capturePartnerable === false) {
        return {
          ok: false,
          refusalMessage: `${PLANS_CAPTURE_REFUSAL} Sketch Partner.`
        };
      }
      if (selection.sceneId === undefined) {
        return {
          ok: false,
          refusalMessage: "Choose a scene before asking this partner."
        };
      }
      return {
        ok: true,
        kind: "plans",
        deepLink: {
          captureId: selection.captureId,
          workflowStep: "craft-partner",
          craftSceneId: selection.sceneId,
          autoStartWorkflowId: "sketch-partner.craft-fields"
        },
        statusMessage: "Opened Sketch Partner in Plans."
      };
    }
    case "character-coach": {
      if (selection.captureId === undefined) {
        return {
          ok: false,
          refusalMessage: `${PLANS_CAPTURE_REFUSAL} Character Coach.`
        };
      }
      if (selection.capturePartnerable === false) {
        return {
          ok: false,
          refusalMessage: `${PLANS_CAPTURE_REFUSAL} Character Coach.`
        };
      }
      if (selection.storyKnowledgeId === undefined) {
        return {
          ok: false,
          refusalMessage: "Choose a cast member before Character Coach."
        };
      }
      return {
        ok: true,
        kind: "plans",
        deepLink: {
          captureId: selection.captureId,
          workflowStep: "craft-partner",
          craftCharacterId: selection.storyKnowledgeId,
          autoStartWorkflowId: "character-coach.sheet-fields"
        },
        statusMessage: "Opened Character Coach in Plans."
      };
    }
    case "worldkeeper": {
      if (selection.captureId === undefined) {
        return {
          ok: false,
          refusalMessage: `${PLANS_CAPTURE_REFUSAL} Worldkeeper.`
        };
      }
      if (selection.capturePartnerable === false) {
        return {
          ok: false,
          refusalMessage: `${PLANS_CAPTURE_REFUSAL} Worldkeeper.`
        };
      }
      if (selection.sceneId === undefined) {
        return {
          ok: false,
          refusalMessage: "Choose a scene before asking this partner."
        };
      }
      return {
        ok: true,
        kind: "plans",
        deepLink: {
          captureId: selection.captureId,
          workflowStep: "worldkeeper",
          craftSceneId: selection.sceneId,
          autoStartWorkflowId: "worldkeeper.backdrop-fields"
        },
        statusMessage: "Opened Worldkeeper in Plans."
      };
    }
    case "cover": {
      if (selection.bookId === undefined) {
        return {
          ok: false,
          refusalMessage:
            "Select a book (or open Title Page) before cover options."
        };
      }
      return {
        ok: true,
        kind: "cover",
        bookId: selection.bookId,
        statusMessage: "Opened Title Page for cover options."
      };
    }
  }
}

export function buildAgentToolkitSelection(
  manuscriptSelection: ManuscriptSelection,
  selectedSceneId: SceneId | undefined,
  inboxSelectedCaptureId: string | undefined
): AgentToolkitSelection {
  let bookId: BookId | undefined;
  if (
    manuscriptSelection.kind === "book" ||
    manuscriptSelection.kind === "unassigned" ||
    manuscriptSelection.kind === "part" ||
    manuscriptSelection.kind === "chapter" ||
    manuscriptSelection.kind === "scene"
  ) {
    bookId = manuscriptSelection.bookId;
  }

  const sceneId =
    manuscriptSelection.kind === "scene"
      ? manuscriptSelection.sceneId
      : selectedSceneId;

  const storyKnowledgeId =
    manuscriptSelection.kind === "storyKnowledge"
      ? manuscriptSelection.storyKnowledgeId
      : undefined;

  return {
    ...(bookId === undefined ? {} : { bookId }),
    ...(sceneId === undefined ? {} : { sceneId }),
    ...(storyKnowledgeId === undefined ? {} : { storyKnowledgeId }),
    ...(inboxSelectedCaptureId === undefined
      ? {}
      : { captureId: inboxSelectedCaptureId })
  };
}

export const AGENT_TOOLKIT_ACTIONS: readonly Readonly<{
  id: AgentToolkitId;
  label: string;
}>[] = Object.freeze([
  Object.freeze({ id: "scene-partner", label: "Scene Partner" }),
  Object.freeze({ id: "cover", label: "Cover" }),
  Object.freeze({ id: "character-coach", label: "Character Coach" }),
  Object.freeze({ id: "worldkeeper", label: "Worldkeeper" }),
  Object.freeze({ id: "sketch-partner", label: "Sketch Partner" })
]);
