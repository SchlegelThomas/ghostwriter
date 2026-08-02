import type { AgentOutputSchemaId } from "./agent-domain.js";
import { catalogAgentLabel, isCatalogAgentId } from "./catalog-agent-ids.js";

export type AgentProposalListPreview = Readonly<{
  agentId?: string;
  agentLabel?: string;
  title?: string;
  summary?: string;
}>;

const PREVIEW_SUMMARY_MAX = 240;
const PREVIEW_TITLE_MAX = 120;

function trimText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 1).trimEnd()}…`;
}

function recordPayload(payload: unknown): Record<string, unknown> | undefined {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined;
  }
  return payload as Record<string, unknown>;
}

function firstNonEmptyText(
  record: Record<string, unknown>,
  keys: readonly string[],
  maxLength: number
): string | undefined {
  for (const key of keys) {
    const value = trimText(record[key], maxLength);
    if (value !== undefined) return value;
  }
  return undefined;
}

function catalogAgentPreview(agentId: string): Pick<
  AgentProposalListPreview,
  "agentId" | "agentLabel"
> {
  if (!isCatalogAgentId(agentId)) {
    return Object.freeze({ agentId });
  }
  return Object.freeze({
    agentId,
    agentLabel: catalogAgentLabel(agentId)
  });
}

function previewFromCatalogMemo(record: Record<string, unknown>): AgentProposalListPreview {
  const agentId = trimText(record.agentId, 100);
  const agent = agentId === undefined ? {} : catalogAgentPreview(agentId);
  return Object.freeze({
    ...agent,
    title: trimText(record.title, PREVIEW_TITLE_MAX),
    summary: trimText(record.summary, PREVIEW_SUMMARY_MAX)
  });
}

function previewFromNextAction(record: Record<string, unknown>): AgentProposalListPreview {
  return Object.freeze({
    agentLabel: "Next actions",
    summary: trimText(record.summary, PREVIEW_SUMMARY_MAX)
  });
}

function previewFromWorkPlan(record: Record<string, unknown>): AgentProposalListPreview {
  return Object.freeze({
    agentLabel: "Work plan",
    summary: trimText(record.summary, PREVIEW_SUMMARY_MAX)
  });
}

function previewFromStoryKnowledgeCreate(
  record: Record<string, unknown>
): AgentProposalListPreview {
  return Object.freeze({
    title: trimText(record.name, PREVIEW_TITLE_MAX),
    summary: trimText(record.summary, PREVIEW_SUMMARY_MAX)
  });
}

function previewFromPacingFindings(record: Record<string, unknown>): AgentProposalListPreview {
  return Object.freeze({
    agentLabel: "Pacing Doctor",
    title: trimText(record.title, PREVIEW_TITLE_MAX),
    summary: trimText(record.summary, PREVIEW_SUMMARY_MAX)
  });
}

function previewFromPlanOutline(record: Record<string, unknown>): AgentProposalListPreview {
  const title = trimText(record.title, PREVIEW_TITLE_MAX);
  const outline = trimText(record.outline, PREVIEW_SUMMARY_MAX);
  return Object.freeze({
    ...(title === undefined ? {} : { title }),
    ...(outline === undefined ? {} : { summary: outline })
  });
}

function previewFromCaptureReflection(
  record: Record<string, unknown>
): AgentProposalListPreview {
  const summary = trimText(record.summary, PREVIEW_SUMMARY_MAX);
  return Object.freeze(summary === undefined ? {} : { summary });
}

function previewFromCraftPartner(
  outputSchemaId: AgentOutputSchemaId,
  record: Record<string, unknown>
): AgentProposalListPreview {
  if (outputSchemaId === "sketch-fields-v1") {
    const summary = firstNonEmptyText(
      record,
      ["purpose", "conflict", "turn", "detail", "sensoryNotes", "openQuestions"],
      PREVIEW_SUMMARY_MAX
    );
    return Object.freeze(summary === undefined ? {} : { summary });
  }
  if (outputSchemaId === "character-sheet-v1") {
    const summary = firstNonEmptyText(
      record,
      ["desire", "pressure", "voiceNotes"],
      PREVIEW_SUMMARY_MAX
    );
    return Object.freeze(summary === undefined ? {} : { summary });
  }
  if (outputSchemaId === "backdrop-fields-v1") {
    const title = trimText(record.caption, PREVIEW_TITLE_MAX);
    const summary = trimText(record.sensoryNotesFallback, PREVIEW_SUMMARY_MAX);
    return Object.freeze({
      ...(title === undefined ? {} : { title }),
      ...(summary === undefined ? {} : { summary })
    });
  }
  return Object.freeze({});
}

function previewBestEffort(
  outputSchemaId: AgentOutputSchemaId,
  record: Record<string, unknown>
): AgentProposalListPreview {
  const agentId = trimText(record.agentId, 100);
  const agent = agentId === undefined ? {} : catalogAgentPreview(agentId);
  const title = firstNonEmptyText(record, ["title", "caption", "label"], PREVIEW_TITLE_MAX);
  const summary = firstNonEmptyText(
    record,
    ["summary", "outline", "detail", "purpose", "body"],
    PREVIEW_SUMMARY_MAX
  );
  return Object.freeze({
    ...agent,
    ...(title === undefined ? {} : { title }),
    ...(summary === undefined ? {} : { summary })
  });
}

export function agentProposalListPreviewFromPayload(
  outputSchemaId: AgentOutputSchemaId,
  payload: unknown
): AgentProposalListPreview {
  try {
    const record = recordPayload(payload);
    if (record === undefined) return Object.freeze({});

    switch (outputSchemaId) {
      case "catalog-memo-v1":
        return previewFromCatalogMemo(record);
      case "pacing-findings-v1":
        return previewFromPacingFindings(record);
      case "next-action-v1":
        return previewFromNextAction(record);
      case "work-plan-v1":
        return previewFromWorkPlan(record);
      case "story-knowledge-create-v1":
        return previewFromStoryKnowledgeCreate(record);
      case "plan-outline-v1":
        return previewFromPlanOutline(record);
      case "capture-reflection-v1":
        return previewFromCaptureReflection(record);
      case "sketch-fields-v1":
      case "character-sheet-v1":
      case "backdrop-fields-v1":
        return previewFromCraftPartner(outputSchemaId, record);
      default:
        return previewBestEffort(outputSchemaId, record);
    }
  } catch {
    return Object.freeze({});
  }
}
