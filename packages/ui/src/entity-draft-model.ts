import type {
  ProjectId,
  ProjectNavigator,
  SceneId,
  StoryKnowledgeId
} from "@ghostwriter/core";
import type { ManuscriptSelection } from "./manuscript-selection.js";
import { resolveManuscriptSelection } from "./manuscript-selection.js";

export type EntityDraftTargetKind = "project" | "scene" | "story-knowledge";

export type EntityDraftTarget = Readonly<{
  targetKind: EntityDraftTargetKind;
  targetId: string;
}>;

export type EntityDraftPreview = Readonly<{
  agentId?: string;
  agentLabel?: string;
  title?: string;
  summary?: string;
}>;

export type EntityDraftSummary = Readonly<{
  id: string;
  outputSchemaId: string;
  createdAt: string;
  baseCaptureId?: string;
  preview?: EntityDraftPreview;
}>;

const ENTITY_DRAFT_KIND_LABELS: Readonly<Record<string, string>> = {
  "capture-reflection-v1": "Scene Partner",
  "plan-outline-v1": "Plan outline",
  "catalog-memo-v1": "Memo",
  "pacing-findings-v1": "Pacing",
  "sketch-fields-v1": "Sketch Partner",
  "character-sheet-v1": "Character Coach",
  "backdrop-fields-v1": "Worldkeeper"
};

const ENTITY_DRAFT_SCHEMA_LABELS: Readonly<Record<string, string>> = {
  "capture-reflection-v1": "Scene Partner",
  "plan-outline-v1": "Plan outline",
  "catalog-memo-v1": "Catalog memo",
  "pacing-findings-v1": "Pacing Doctor",
  "sketch-fields-v1": "Sketch Partner",
  "character-sheet-v1": "Character Coach",
  "backdrop-fields-v1": "Worldkeeper"
};

export function entityDraftKindLabel(outputSchemaId: string): string {
  return ENTITY_DRAFT_KIND_LABELS[outputSchemaId] ?? "Agent draft";
}

export function entityDraftSchemaLabel(outputSchemaId: string): string {
  return ENTITY_DRAFT_SCHEMA_LABELS[outputSchemaId] ?? "Agent draft";
}

export function entityDraftPartnerLabel(draft: EntityDraftSummary): string | undefined {
  const label = draft.preview?.agentLabel?.trim();
  if (label !== undefined && label.length > 0) {
    return label;
  }
  return undefined;
}

export function truncateEntityDraftSummary(
  summary: string,
  maxLength = 240
): string {
  const trimmed = summary.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength - 1).trimEnd()}…`;
}

export function entityDraftCardTitle(
  draft: EntityDraftSummary,
  detailTitle?: string
): string {
  const previewTitle = draft.preview?.title?.trim();
  if (previewTitle !== undefined && previewTitle.length > 0) {
    return truncateEntityDraftTitle(previewTitle);
  }
  if (detailTitle !== undefined && detailTitle.trim().length > 0) {
    return truncateEntityDraftTitle(detailTitle);
  }
  const partner = entityDraftPartnerLabel(draft);
  if (partner !== undefined) {
    return partner;
  }
  return entityDraftKindLabel(draft.outputSchemaId);
}

export function entityDraftCardSummary(draft: EntityDraftSummary): string | undefined {
  const previewSummary = draft.preview?.summary?.trim();
  if (previewSummary !== undefined && previewSummary.length > 0) {
    return truncateEntityDraftSummary(previewSummary);
  }
  return undefined;
}

export function entityDraftAccessibilityLabel(draft: EntityDraftSummary): string {
  const parts = [
    entityDraftKindLabel(draft.outputSchemaId),
    entityDraftPartnerLabel(draft),
    entityDraftCardTitle(draft)
  ].filter((part): part is string => part !== undefined && part.length > 0);
  return [...new Set(parts)].join(", ");
}

export function entityDraftTargetForSelection(
  project: ProjectNavigator,
  selection: ManuscriptSelection
): EntityDraftTarget | undefined {
  if (selection.kind === "project") {
    return {
      targetKind: "project",
      targetId: project.id as ProjectId
    };
  }
  if (selection.kind === "storyKnowledge") {
    const knowledgeId = selection.storyKnowledgeId;
    if (knowledgeId === undefined) return undefined;
    const exists = project.storyKnowledge.some(
      (record) => record.id === knowledgeId
    );
    if (!exists) return undefined;
    return {
      targetKind: "story-knowledge",
      targetId: knowledgeId as StoryKnowledgeId
    };
  }
  if (selection.kind !== "scene") {
    return undefined;
  }
  const resolved = resolveManuscriptSelection(project, selection);
  if (resolved?.scene === undefined) {
    return undefined;
  }
  return {
    targetKind: "scene",
    targetId: resolved.scene.id as SceneId
  };
}

export function formatEntityDraftCreatedAt(iso: string): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) {
    return iso;
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(parsed);
}

export function truncateEntityDraftTitle(title: string, maxLength = 48): string {
  const trimmed = title.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength - 1).trimEnd()}…`;
}

export function entityDraftRowTitle(
  draft: EntityDraftSummary,
  detailTitle?: string
): string {
  const label = entityDraftSchemaLabel(draft.outputSchemaId);
  if (detailTitle === undefined || detailTitle.trim().length === 0) {
    return label;
  }
  return `${label} · ${truncateEntityDraftTitle(detailTitle)}`;
}

export type EntityDraftPrimaryAction = "acknowledge" | "open-in-plans" | "view";

export function entityDraftPrimaryAction(
  draft: EntityDraftSummary
): EntityDraftPrimaryAction {
  if (
    draft.outputSchemaId === "plan-outline-v1" ||
    draft.outputSchemaId === "catalog-memo-v1" ||
    draft.outputSchemaId === "pacing-findings-v1"
  ) {
    return "acknowledge";
  }
  if (draft.baseCaptureId !== undefined) {
    return "open-in-plans";
  }
  return "view";
}

export function entityDraftPrimaryActionLabel(
  action: EntityDraftPrimaryAction
): string {
  switch (action) {
    case "acknowledge":
      return "Acknowledge";
    case "open-in-plans":
      return "Open in Plans";
    case "view":
      return "View";
  }
}

export function formatEntityDraftDetailBody(
  outputSchemaId: string,
  payload: unknown
): string {
  if (payload === null || typeof payload !== "object") {
    return "";
  }
  const record = payload as Record<string, unknown>;
  if (outputSchemaId === "plan-outline-v1") {
    const title =
      typeof record.title === "string" ? record.title.trim() : "";
    const outline =
      typeof record.outline === "string" ? record.outline.trim() : "";
    return [title, outline].filter((part) => part.length > 0).join("\n\n");
  }
  if (outputSchemaId === "capture-reflection-v1") {
    const summary =
      typeof record.summary === "string" ? record.summary.trim() : "";
    const questions = Array.isArray(record.questions)
      ? record.questions.filter(
          (question): question is string => typeof question === "string"
        )
      : [];
    const questionLines = questions.map((question) => `· ${question}`);
    return [summary, ...questionLines].filter((part) => part.length > 0).join("\n");
  }
  if (outputSchemaId === "catalog-memo-v1") {
    const summary =
      typeof record.summary === "string" ? record.summary.trim() : "";
    const sections = Array.isArray(record.sections)
      ? record.sections.flatMap((section) => {
          if (section === null || typeof section !== "object") return [];
          const item = section as Record<string, unknown>;
          const heading = typeof item.heading === "string" ? item.heading.trim() : "";
          const body = typeof item.body === "string" ? item.body.trim() : "";
          return heading.length === 0 && body.length === 0
            ? []
            : [`${heading}\n${body}`.trim()];
        })
      : [];
    return [summary, ...sections].filter((part) => part.length > 0).join("\n\n");
  }
  if (outputSchemaId === "pacing-findings-v1") {
    const summary =
      typeof record.summary === "string" ? record.summary.trim() : "";
    const turns = Array.isArray(record.turns)
      ? record.turns.flatMap((turn) => {
          if (turn === null || typeof turn !== "object") return [];
          const item = turn as Record<string, unknown>;
          if (typeof item.id !== "string") return [];
          const label = item.id
            .split("-")
            .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
            .join(" ");
          const scene =
            typeof item.sceneTitle === "string" ? item.sceneTitle.trim() : "Not located";
          const measured =
            typeof item.measuredPct === "number"
              ? `${item.measuredPct.toFixed(1)}%`
              : "—";
          const band =
            typeof item.bandLow === "number" && typeof item.bandHigh === "number"
              ? `${item.bandLow}–${item.bandHigh}%`
              : "—";
          const drift =
            typeof item.driftNote === "string" && item.driftNote.trim().length > 0
              ? ` — ${item.driftNote.trim()}`
              : "";
          return [`${label} | ${scene} | ${measured} (band ${band})${drift}`];
        })
      : [];
    const prescriptions = Array.isArray(record.prescriptions)
      ? record.prescriptions.flatMap((prescription) => {
          if (prescription === null || typeof prescription !== "object") return [];
          const item = prescription as Record<string, unknown>;
          if (typeof item.body !== "string" || item.body.trim().length === 0) return [];
          const action =
            typeof item.action === "string"
              ? item.action.replaceAll("-", " ")
              : "review";
          return [`· ${action}: ${item.body.trim()}`];
        })
      : [];
    return [
      summary,
      ...(turns.length === 0 ? [] : [`Turns\n${turns.join("\n")}`]),
      ...(prescriptions.length === 0
        ? []
        : [`Prescriptions\n${prescriptions.join("\n")}`])
    ]
      .filter((part) => part.length > 0)
      .join("\n\n");
  }
  return Object.entries(record)
    .filter(([key]) => key !== "schemaId")
    .map(([key, value]) => `${key}: ${String(value ?? "")}`)
    .join("\n");
}

export function entityDraftDetailTitle(
  outputSchemaId: string,
  payload: unknown
): string | undefined {
  if (payload === null || typeof payload !== "object") {
    return undefined;
  }
  const record = payload as Record<string, unknown>;
  if (outputSchemaId === "plan-outline-v1") {
    return typeof record.title === "string" ? record.title : undefined;
  }
  if (outputSchemaId === "capture-reflection-v1") {
    return typeof record.summary === "string" ? record.summary : undefined;
  }
  if (
    outputSchemaId === "catalog-memo-v1" ||
    outputSchemaId === "pacing-findings-v1"
  ) {
    return typeof record.title === "string" ? record.title : undefined;
  }
  return undefined;
}
