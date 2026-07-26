import { ghostwriterTheme } from "./theme.js";

const { shell } = ghostwriterTheme;

export type WorkspaceSecondaryTab = "agent" | "properties";

/** What the primary (left) sidebar hosts — Cursor-like side-bar views. */
export type WorkspacePrimaryView = "explorer" | "characters";

export function primarySideLabel(view: WorkspacePrimaryView): string {
  switch (view) {
    case "characters":
      return "Characters";
    case "explorer":
      return "Explorer";
  }
}

export const SECONDARY_WIDTH_MIN = 240;
export const SECONDARY_WIDTH_MAX = 480;
export const SECONDARY_WIDTH_DEFAULT = shell.inspectorWidth;

export const PRIMARY_WIDTH_MIN = 180;
export const PRIMARY_WIDTH_MAX = 420;
export const PRIMARY_WIDTH_DEFAULT = shell.navigatorWidth;

export function clampShellWidth(
  value: number,
  min: number,
  max: number
): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function secondaryPanelStorageKey(
  accountId: string | undefined,
  projectId: string
): string {
  const account = accountId?.trim() || "anonymous";
  return `ghostwriter:shell-secondary-width:${account}:${projectId}`;
}

export function primaryPanelStorageKey(
  accountId: string | undefined,
  projectId: string
): string {
  const account = accountId?.trim() || "anonymous";
  return `ghostwriter:shell-primary-width:${account}:${projectId}`;
}

export function readStoredShellWidth(
  key: string,
  fallback: number,
  min: number,
  max: number
): number {
  if (typeof localStorage === "undefined") {
    return clampShellWidth(fallback, min, max);
  }
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return clampShellWidth(fallback, min, max);
    return clampShellWidth(Number.parseFloat(raw), min, max);
  } catch {
    return clampShellWidth(fallback, min, max);
  }
}

export function writeStoredShellWidth(
  key: string,
  width: number,
  min: number,
  max: number
): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(key, String(clampShellWidth(width, min, max)));
  } catch {
    // Persistence may fail closed without affecting layout.
  }
}

export function nextSecondaryTabOnAgentOpen(
  current: WorkspaceSecondaryTab | undefined,
  open: boolean
): WorkspaceSecondaryTab {
  if (!open) return current ?? "agent";
  return "agent";
}

export type WorkspaceCenterMode = "draft" | "canvas" | "split";

/**
 * Draft pane visibility for the center work surface.
 * Canvas owns the full center alone; Draft home (Title Page / manuscript
 * chronology) only in draft mode; Split shows Draft only when a scene is open
 * (no empty placeholder).
 */
export function workspaceShowsDraftPane(input: Readonly<{
  mode: WorkspaceCenterMode;
  hasSelectedScene: boolean;
  draftHomeVisible: boolean;
}>): boolean {
  switch (input.mode) {
    case "canvas":
      return false;
    case "draft":
      return input.hasSelectedScene || input.draftHomeVisible;
    case "split":
      return input.hasSelectedScene;
  }
}

/** Split divider + dual flex only when both Canvas and Draft panes are present. */
export function workspaceSplitPanesActive(input: Readonly<{
  mode: WorkspaceCenterMode;
  wide: boolean;
  showCanvas: boolean;
  showDraft: boolean;
}>): boolean {
  return (
    input.mode === "split" &&
    input.wide &&
    input.showCanvas &&
    input.showDraft
  );
}
