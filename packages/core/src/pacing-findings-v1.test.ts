import { describe, expect, it } from "vitest";
import { catalogAgentPlaybook } from "./catalog-agent-playbooks.js";
import { buildDeterministicPacingFindings } from "./pacing-findings-builder.js";
import { validatePacingFindingsV1 } from "./pacing-findings-v1.js";
import { equalWeightScenePercents } from "./pacing-position.js";

describe("pacing-findings-v1", () => {
  it("strictly validates bounded, unique pacing turns", () => {
    const findings = validatePacingFindingsV1({
      schemaId: "pacing-findings-v1",
      agentId: "pacing-doctor",
      title: "Pacing",
      summary: "Equal-scene pacing read.",
      positionBasis: "equal-scene",
      turns: [{ id: "catalyst", bandLow: 8, bandHigh: 12 }],
      flatRuns: [],
      prescriptions: [{ action: "cut", body: "Cut repetition." }],
      sections: [{ heading: "Turns", body: "Review the turn positions." }],
      evidence: []
    });
    expect(findings.positionBasis).toBe("equal-scene");
    expect(() =>
      validatePacingFindingsV1({ ...findings, extra: true })
    ).toThrow(/unexpected/u);
    expect(() =>
      validatePacingFindingsV1({
        ...findings,
        turns: [findings.turns[0], findings.turns[0]]
      })
    ).toThrow(/unique/u);
  });

  it("builds deterministic turns, prescriptions, sections, and scene evidence", () => {
    const percents = equalWeightScenePercents(
      Array.from({ length: 10 }, (_, index) => ({
        id: `scene-${index + 1}`,
        title: `Scene ${index + 1}`
      }))
    );
    const findings = buildDeterministicPacingFindings({
      projectTitle: "The Bellwether",
      lens: "save-the-cat",
      orderedPercents: percents,
      playbook: catalogAgentPlaybook("pacing-doctor")
    });
    expect(findings.schemaId).toBe("pacing-findings-v1");
    expect(findings.turns.map((turn) => turn.id)).toEqual([
      "catalyst",
      "commitment",
      "midpoint",
      "low-point",
      "final-movement"
    ]);
    expect(findings.turns[0]).toMatchObject({
      sceneId: "scene-1",
      measuredPct: 5
    });
    expect(findings.prescriptions.map(({ action }) => action)).toEqual([
      "cut",
      "merge",
      "add-pressure"
    ]);
    expect(findings.sections.map(({ heading }) => heading)).toEqual(
      catalogAgentPlaybook("pacing-doctor").sectionHeadings
    );
    expect(findings.evidence[9]).toMatchObject({ sceneId: "scene-10" });
  });
});
