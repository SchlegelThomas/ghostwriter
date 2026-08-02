import { describe, expect, it } from "vitest";
import { SETTINGS_FOCUSES } from "./settings-focus.js";

describe("settings focus", () => {
  it("includes project playbook guidance", () => {
    expect(SETTINGS_FOCUSES).toContain("playbooks");
  });

  it("includes reader voice ops guidance", () => {
    expect(SETTINGS_FOCUSES).toContain("reader-voice");
  });
});
