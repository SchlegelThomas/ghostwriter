import { describe, expect, it } from "vitest";
import {
  clampShellWidth,
  nextSecondaryModeOnAgentOpen,
  primarySideLabel,
  PRIMARY_WIDTH_DEFAULT,
  secondaryPanelStorageKey,
  SECONDARY_WIDTH_DEFAULT,
  workspaceShowsDraftPane,
  workspaceSplitPanesActive
} from "./workspace-shell-layout.js";

describe("workspace-shell-layout", () => {
  it("clamps shell widths", () => {
    expect(clampShellWidth(100, 240, 480)).toBe(240);
    expect(clampShellWidth(900, 240, 480)).toBe(480);
    expect(clampShellWidth(300.6, 240, 480)).toBe(301);
  });

  it("builds per-project storage keys", () => {
    expect(secondaryPanelStorageKey("acct", "proj")).toBe(
      "ghostwriter:shell-secondary-width:acct:proj"
    );
    expect(SECONDARY_WIDTH_DEFAULT).toBeGreaterThan(200);
    expect(PRIMARY_WIDTH_DEFAULT).toBeGreaterThan(200);
  });

  it("opens agent mode when the agent panel is requested", () => {
    expect(nextSecondaryModeOnAgentOpen("inspector", true)).toBe("agent");
    expect(nextSecondaryModeOnAgentOpen("agent", false)).toBe("agent");
  });

  it("labels primary side views", () => {
    expect(primarySideLabel("explorer")).toBe("Explorer");
    expect(primarySideLabel("characters")).toBe("Characters");
  });

  it("gives Canvas the full center and hides empty Draft panes", () => {
    expect(
      workspaceShowsDraftPane({
        mode: "canvas",
        hasSelectedScene: false,
        draftHomeVisible: true
      })
    ).toBe(false);
    expect(
      workspaceShowsDraftPane({
        mode: "split",
        hasSelectedScene: false,
        draftHomeVisible: false
      })
    ).toBe(false);
    expect(
      workspaceShowsDraftPane({
        mode: "split",
        hasSelectedScene: true,
        draftHomeVisible: false
      })
    ).toBe(true);
    expect(
      workspaceShowsDraftPane({
        mode: "draft",
        hasSelectedScene: false,
        draftHomeVisible: true
      })
    ).toBe(true);
    expect(
      workspaceSplitPanesActive({
        mode: "split",
        wide: true,
        showCanvas: true,
        showDraft: false
      })
    ).toBe(false);
    expect(
      workspaceSplitPanesActive({
        mode: "split",
        wide: true,
        showCanvas: true,
        showDraft: true
      })
    ).toBe(true);
  });
});
