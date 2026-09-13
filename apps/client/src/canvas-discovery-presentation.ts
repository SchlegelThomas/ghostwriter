import type { CanvasWorkflowLens } from "@ghostwriter/ui";
import type { CanvasSearchResult } from "./canvas-model.js";

export function canvasLensDescription(lens: CanvasWorkflowLens): string {
  switch (lens) {
    case "outline":
      return "Shows every active object in this scope and emphasizes scene cards and regions.";
    case "relationships":
      return "Shows every active object in this scope and emphasizes endpoints of active typed links.";
    case "continuity":
      return "Shows placed beat markers and their linked objects. This is a Canvas filter, not a story assessment.";
    case "plan-draft":
      return "Shows every active object in this scope and emphasizes scene cards whose Draft status is planned.";
    case "review":
      return "Shows every active object, emphasizes provisional objects and links, and opens Canvas history. It does not assess the story.";
  }
}

export type CanvasEmptyPresentation = Readonly<{
  title: string;
  detail: string;
  resetLens: boolean;
  showWholeStory: boolean;
}>;

export function canvasEmptyPresentation(input: Readonly<{
  lens: CanvasWorkflowLens;
  scopeKind: "project" | "chapter" | "scene";
  hiddenByLensCount: number;
}>): CanvasEmptyPresentation {
  if (input.hiddenByLensCount > 0) {
    return {
      title: "No objects match this Canvas filter",
      detail:
        "The current scope contains Canvas objects, but this lens hides them. Reset the Map lens to see the scope again.",
      resetLens: true,
      showWholeStory: input.scopeKind !== "project"
    };
  }
  return {
    title:
      input.scopeKind === "project"
        ? "Nothing placed on this Canvas"
        : "Nothing placed in this scope",
    detail:
      "Use the reading spine for manuscript scenes that are not placed. Canvas tools add spatial notes, regions, image references, and placements.",
    resetLens: input.lens !== "outline",
    showWholeStory: input.scopeKind !== "project"
  };
}

export type CanvasSearchPresentation = Readonly<{
  label: string;
  disabled: boolean;
  action: "inspect-object" | "select-scene" | "select-knowledge" | "none";
}>;

export function canvasSearchPresentation(
  result: CanvasSearchResult
): CanvasSearchPresentation {
  if (result.archived === true) {
    if (result.object !== undefined) {
      return {
        label:
          result.object.archivedAt === undefined
            ? `Inspect Canvas placement · archived story record · ${result.label}`
            : `Inspect archived Canvas placement · ${result.label}`,
        disabled: false,
        action: "inspect-object"
      };
    }
    return {
      label: `Archived story record · ${result.label} · restore the story record first`,
      disabled: true,
      action: "none"
    };
  }
  if (result.object !== undefined) {
    return { label: `Jump to ${result.label}`, disabled: false, action: "inspect-object" };
  }
  if (result.sceneId !== undefined) {
    return { label: `Select unplaced ${result.label}`, disabled: false, action: "select-scene" };
  }
  if (result.knowledgeId !== undefined) {
    return { label: `Select unplaced ${result.label}`, disabled: false, action: "select-knowledge" };
  }
  return { label: result.label, disabled: true, action: "none" };
}
