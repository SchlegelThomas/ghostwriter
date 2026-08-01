import {
  isCatalogAgentId,
  type BookId,
  type CatalogAgentId,
  type CatalogMemoLens,
  type SceneId,
  type StoryKnowledgeId
} from "@ghostwriter/core";
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

export type AgentCatalogStageId =
  | "brainstorm"
  | "structure"
  | "writing"
  | "editing"
  | "commercial";

export type AgentCatalogEntry =
  | Readonly<{
      id: AgentToolkitId | CatalogAgentId;
      label: string;
      blurb: string;
      status: "shipped";
    }>
  | Readonly<{ id: string; label: string; blurb: string; status: "coming-soon" }>;

export type AgentCatalogStage = Readonly<{
  id: AgentCatalogStageId;
  label: string;
  agents: readonly AgentCatalogEntry[];
}>;

const AGENT_CATALOG_STAGE_LABELS: Readonly<Record<AgentCatalogStageId, string>> =
  Object.freeze({
    brainstorm: "Brainstorm",
    structure: "Structure",
    writing: "Writing",
    editing: "Editing",
    commercial: "Commercial"
  });

export function agentCatalogStageLabel(id: AgentCatalogStageId): string {
  return AGENT_CATALOG_STAGE_LABELS[id];
}

/** Sticky partner chosen from a stage menu in the Agent dock. */
export type ActiveWorkspaceCatalogPartner = Readonly<{
  entryId: string;
  label: string;
  stageId: AgentCatalogStageId;
  lens?: CatalogMemoLens;
}>;

export function formatActiveCatalogPartnerSummary(
  partner: ActiveWorkspaceCatalogPartner
): string {
  const stage = agentCatalogStageLabel(partner.stageId);
  if (partner.lens === undefined) {
    return `${partner.label} · ${stage}`;
  }
  return `${partner.label} · ${stage} · ${partner.lens.replaceAll("-", " ")}`;
}

export function findShippedToolkitId(
  entry: AgentCatalogEntry
): AgentToolkitId | undefined {
  if (entry.status !== "shipped" || isCatalogAgentId(entry.id)) return undefined;
  return entry.id as AgentToolkitId;
}

export function findShippedCatalogAgentId(
  entry: AgentCatalogEntry
): CatalogAgentId | undefined {
  return entry.status === "shipped" && isCatalogAgentId(entry.id)
    ? entry.id
    : undefined;
}

export function shippedToolkitIdsInCatalog(): readonly AgentToolkitId[] {
  const ids: AgentToolkitId[] = [];
  for (const stage of AGENT_CATALOG_STAGES) {
    for (const agent of stage.agents) {
      const toolkitId = findShippedToolkitId(agent);
      if (toolkitId !== undefined) {
        ids.push(toolkitId);
      }
    }
  }
  return Object.freeze(ids);
}

export const AGENT_CATALOG_STAGES: readonly AgentCatalogStage[] = Object.freeze([
  Object.freeze({
    id: "brainstorm",
    label: AGENT_CATALOG_STAGE_LABELS.brainstorm,
    agents: Object.freeze([
      Object.freeze({
        id: "sketch-partner",
        label: "Sketch Partner",
        blurb: "Shape scenes from your Plans idea with craft prompts.",
        status: "shipped"
      }),
      Object.freeze({
        id: "idea-midwife",
        label: "Idea Midwife",
        blurb: "Turn raw sparks into story-ready concepts.",
        status: "shipped"
      }),
      Object.freeze({
        id: "genre-compass",
        label: "Genre Compass",
        blurb: "Find the genre lane that fits your idea.",
        status: "shipped"
      }),
      Object.freeze({
        id: "what-if-engine",
        label: "What-if Engine",
        blurb: "Explore branching possibilities from a seed.",
        status: "shipped"
      })
    ])
  }),
  Object.freeze({
    id: "structure",
    label: AGENT_CATALOG_STAGE_LABELS.structure,
    agents: Object.freeze([
      Object.freeze({
        id: "story-architect",
        label: "Story Architect",
        blurb: "Build act and beat structure for your outline.",
        status: "shipped"
      }),
      Object.freeze({
        id: "pacing-doctor",
        label: "Pacing Doctor",
        blurb: "Diagnose rhythm and tension across the manuscript.",
        status: "shipped"
      }),
      Object.freeze({
        id: "promise-keeper",
        label: "Promise Keeper",
        blurb: "Track setup, payoff, and reader promises.",
        status: "shipped"
      }),
      Object.freeze({
        id: "outline-expander",
        label: "Outline Expander",
        blurb: "Grow beats into scene-level outlines.",
        status: "shipped"
      })
    ])
  }),
  Object.freeze({
    id: "writing",
    label: AGENT_CATALOG_STAGE_LABELS.writing,
    agents: Object.freeze([
      Object.freeze({
        id: "scene-partner",
        label: "Scene Partner",
        blurb: "Run scene craft from a Plans capture.",
        status: "shipped"
      }),
      Object.freeze({
        id: "character-coach",
        label: "Character Coach",
        blurb: "Develop cast sheets from a Plans capture.",
        status: "shipped"
      }),
      Object.freeze({
        id: "worldkeeper",
        label: "Worldkeeper",
        blurb: "Ground scenes in backdrop and world detail.",
        status: "shipped"
      }),
      Object.freeze({
        id: "scene-sequel-coach",
        label: "Scene/Sequel Coach",
        blurb: "Balance action and reaction in scene flow.",
        status: "shipped"
      }),
      Object.freeze({
        id: "dialogue-coach",
        label: "Dialogue Coach",
        blurb: "Sharpen voice and subtext in conversation.",
        status: "shipped"
      }),
      Object.freeze({
        id: "character-coach-cast",
        label: "Character Coach · Cast",
        blurb: "Review want, need, pressure, and voice for the selected cast member.",
        status: "shipped"
      })
    ])
  }),
  Object.freeze({
    id: "editing",
    label: AGENT_CATALOG_STAGE_LABELS.editing,
    agents: Object.freeze([
      Object.freeze({
        id: "developmental-editor",
        label: "Developmental Editor",
        blurb: "Big-picture story and structure feedback.",
        status: "shipped"
      }),
      Object.freeze({
        id: "continuity-reader",
        label: "Continuity Reader",
        blurb: "Catch timeline, logic, and lore gaps.",
        status: "shipped"
      }),
      Object.freeze({
        id: "line-editor",
        label: "Line Editor",
        blurb: "Improve clarity, rhythm, and prose style.",
        status: "shipped"
      }),
      Object.freeze({
        id: "copy-editor",
        label: "Copy Editor",
        blurb: "Polish grammar, spelling, and consistency.",
        status: "shipped"
      })
    ])
  }),
  Object.freeze({
    id: "commercial",
    label: AGENT_CATALOG_STAGE_LABELS.commercial,
    agents: Object.freeze([
      Object.freeze({
        id: "cover",
        label: "Cover",
        blurb: "Generate cover concepts on the Title Page.",
        status: "shipped"
      }),
      Object.freeze({
        id: "pitch-pack",
        label: "Pitch Pack",
        blurb: "Package logline, comps, and pitch materials.",
        status: "shipped"
      }),
      Object.freeze({
        id: "query-coach",
        label: "Query Coach",
        blurb: "Draft and refine agent query letters.",
        status: "shipped"
      }),
      Object.freeze({
        id: "series-bible",
        label: "Series Bible",
        blurb: "Document series arc and recurring elements.",
        status: "shipped"
      }),
      Object.freeze({
        id: "market-fit",
        label: "Market Fit",
        blurb: "Align positioning with genre and audience.",
        status: "shipped"
      })
    ])
  })
]);

export const AGENT_TOOLKIT_ACTIONS: readonly Readonly<{
  id: AgentToolkitId;
  label: string;
}>[] = Object.freeze(
  AGENT_CATALOG_STAGES.flatMap((stage) =>
    stage.agents.flatMap((agent) => {
      const toolkitId = findShippedToolkitId(agent);
      return toolkitId === undefined
        ? []
        : [Object.freeze({ id: toolkitId, label: agent.label })];
    })
  )
);
