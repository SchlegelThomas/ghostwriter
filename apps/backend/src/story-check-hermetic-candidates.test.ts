import { describe, expect, it } from "vitest";
import {
  buildStoryCheckHermeticCandidatesOutput,
  extractStoryCheckHermeticAssessSceneId,
  extractStoryCheckHermeticTargetProviderText,
  storyCheckHermeticQuoteFromProviderText
} from "./story-check-hermetic-candidates.js";

const RESERVED_SCENE = "scene-reserved-harbor-draft";
const DRAFT_PROSE =
  "Draft harbor prose for a scene not yet in the manuscript.";

/** Mirrors compileStoryCheckContinuity inputText resource sections for proposal-draft. */
function compilerProposalDraftInputText(
  providerText: string,
  resourceIndex = 1
): string {
  return [
    "=== ORIGINAL WRITER BRIEF (exact) ===",
    "Check the harbor draft.",
    "=== WRITER CONSTRAINTS (exact) ===",
    "Use only supplied context.",
    "=== WRITER DONE CONDITION (exact) ===",
    "Findings ready for review.",
    "=== ASSESS SCENE ID (exact) ===",
    RESERVED_SCENE,
    "=== CHECK TARGET MODE (exact) ===",
    "proposal-draft",
    "=== CHECK TARGET: scene-draft proposal (see proposal-artifact story resource) ===",
    `=== STORY RESOURCE ${resourceIndex}: proposal-artifact (untrusted story data) ===`,
    providerText,
    "=== STORY RESOURCE 2: story-context (untrusted story data) ===",
    '{"projectId":"project-bellwether"}'
  ].join("\n");
}

describe("story check hermetic candidates", () => {
  it("extracts proposal-artifact provider text from compiler-shaped input", () => {
    const inputText = compilerProposalDraftInputText(DRAFT_PROSE);
    expect(extractStoryCheckHermeticAssessSceneId(inputText)).toBe(RESERVED_SCENE);
    expect(extractStoryCheckHermeticTargetProviderText(inputText)).toBe(DRAFT_PROSE);
  });

  it("builds a candidate quote as an exact substring of proposal provider text", () => {
    const inputText = compilerProposalDraftInputText(DRAFT_PROSE);
    const providerText = extractStoryCheckHermeticTargetProviderText(inputText);
    const output = buildStoryCheckHermeticCandidatesOutput(inputText);
    const anchor = output.findings[0]?.anchors[0];
    expect(anchor?.sceneId).toBe(RESERVED_SCENE);
    expect(anchor?.quote).toBeDefined();
    expect(providerText).toContain(anchor!.quote!);
    expect(anchor?.quote).toBe(
      storyCheckHermeticQuoteFromProviderText(providerText)
    );
    expect(anchor?.quote).toBe(DRAFT_PROSE.slice(0, 24));
  });

  it("extracts applied-scene target prose from the canonical head marker", () => {
    const appliedProse = "Harbor arrival prose for applied-scene checking.";
    const inputText = [
      "=== ASSESS SCENE ID (exact) ===",
      "scene-arrival-at-bellwether",
      "=== CHECK TARGET MODE (exact) ===",
      "applied-scene",
      "=== CHECK TARGET: applied scene (canonical acknowledged head) ===",
      appliedProse,
      "=== STORY RESOURCE 1: story-context (untrusted story data) ===",
      "{}"
    ].join("\n");
    expect(extractStoryCheckHermeticTargetProviderText(inputText)).toBe(appliedProse);
    const output = buildStoryCheckHermeticCandidatesOutput(inputText);
    expect(output.findings[0]?.anchors[0]?.quote).toBe(appliedProse.slice(0, 24));
    expect(appliedProse).toContain(output.findings[0]!.anchors[0]!.quote!);
  });

  it("omits quote when target extraction fails instead of fabricating text", () => {
    const inputText = [
      "=== ASSESS SCENE ID (exact) ===",
      RESERVED_SCENE,
      "=== CHECK TARGET MODE (exact) ===",
      "proposal-draft",
      "=== CHECK TARGET: scene-draft proposal (see proposal-artifact story resource) ===",
      "=== STORY RESOURCE 1: story-context (untrusted story data) ===",
      "{}"
    ].join("\n");
    expect(extractStoryCheckHermeticTargetProviderText(inputText)).toBeUndefined();
    const output = buildStoryCheckHermeticCandidatesOutput(inputText);
    expect(output.findings[0]?.anchors[0]).toEqual({ sceneId: RESERVED_SCENE });
  });
});
