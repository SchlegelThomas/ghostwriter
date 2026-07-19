export type WriteComposition =
  | "page"
  | "split-map"
  | "split-sheet"
  | "split-backdrop";

export type WriteInputModality = "keyboard" | "dictate" | "ink";

export type WritingAssistRoleId =
  | "scene-partner"
  | "character-coach"
  | "worldkeeper"
  | "sketch-partner";

export const WRITE_COMPOSITION_OPTIONS = Object.freeze([
  Object.freeze({
    id: "page" as const,
    label: "Page",
    tip: "Page only · Draft"
  }),
  Object.freeze({
    id: "split-map" as const,
    label: "Map",
    tip: "Split · Map"
  }),
  Object.freeze({
    id: "split-sheet" as const,
    label: "Sheet",
    tip: "Split · Character sheet"
  }),
  Object.freeze({
    id: "split-backdrop" as const,
    label: "Bd",
    tip: "Split · Backdrop"
  })
]);

export const WRITE_INPUT_OPTIONS = Object.freeze([
  Object.freeze({
    id: "keyboard" as const,
    label: "Kb",
    tip: "Keyboard"
  }),
  Object.freeze({
    id: "dictate" as const,
    label: "Mic",
    tip: "Dictate · ⌘M"
  }),
  Object.freeze({
    id: "ink" as const,
    label: "Ink",
    tip: "Stylus · sketch layer"
  })
]);

export const WRITING_ASSIST_ROLES = Object.freeze([
  Object.freeze({
    id: "scene-partner" as const,
    label: "Scene Partner",
    detail: "Continuation and beat variants for this scene."
  }),
  Object.freeze({
    id: "character-coach" as const,
    label: "Character Coach",
    detail: "Sheet updates that protect agency and voice."
  }),
  Object.freeze({
    id: "worldkeeper" as const,
    label: "Worldkeeper",
    detail: "Backdrop facts and place constraints."
  }),
  Object.freeze({
    id: "sketch-partner" as const,
    label: "Sketch Partner",
    detail: "Purpose / conflict / turn before prose."
  })
]);

/** Map Write composition to workspace mode + companion pane. */
export function workspaceModeForComposition(
  composition: WriteComposition
): "draft" | "split" {
  return composition === "split-map" ? "split" : "draft";
}

export function companionForComposition(
  composition: WriteComposition
): "none" | "sheet" | "backdrop" {
  if (composition === "split-sheet") return "sheet";
  if (composition === "split-backdrop") return "backdrop";
  return "none";
}

export function compositionFromWorkspaceMode(
  mode: "draft" | "canvas" | "split",
  companion: "none" | "sheet" | "backdrop"
): WriteComposition {
  if (mode === "split") return "split-map";
  if (companion === "sheet") return "split-sheet";
  if (companion === "backdrop") return "split-backdrop";
  return "page";
}
