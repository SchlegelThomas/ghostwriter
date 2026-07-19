import { describe, expect, it } from "vitest";
import {
  companionForComposition,
  compositionFromWorkspaceMode,
  workspaceModeForComposition
} from "./writing-studio.js";

describe("writing studio composition", () => {
  it("maps page and craft splits to draft mode", () => {
    expect(workspaceModeForComposition("page")).toBe("draft");
    expect(workspaceModeForComposition("split-sheet")).toBe("draft");
    expect(workspaceModeForComposition("split-backdrop")).toBe("draft");
    expect(workspaceModeForComposition("split-map")).toBe("split");
  });

  it("exposes craft companions only for sheet and backdrop", () => {
    expect(companionForComposition("page")).toBe("none");
    expect(companionForComposition("split-map")).toBe("none");
    expect(companionForComposition("split-sheet")).toBe("sheet");
    expect(companionForComposition("split-backdrop")).toBe("backdrop");
  });

  it("reconstructs composition from mode and companion", () => {
    expect(compositionFromWorkspaceMode("split", "none")).toBe("split-map");
    expect(compositionFromWorkspaceMode("draft", "sheet")).toBe("split-sheet");
    expect(compositionFromWorkspaceMode("draft", "backdrop")).toBe(
      "split-backdrop"
    );
    expect(compositionFromWorkspaceMode("draft", "none")).toBe("page");
  });
});
