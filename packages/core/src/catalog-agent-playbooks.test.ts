import { describe, expect, it } from "vitest";
import { CATALOG_AGENT_IDS, CATALOG_AGENT_LABELS } from "./catalog-agent-ids.js";
import {
  catalogAgentDefaultLens,
  catalogAgentPlaybook,
  catalogAgentPlaybookDoctrineText,
  catalogLensDoctrine
} from "./catalog-agent-playbooks.js";
import { CATALOG_MEMO_LENSES } from "./catalog-memo-v1.js";

describe("catalogAgentPlaybook", () => {
  it("covers every catalog agent with bounded, usable doctrine", () => {
    for (const agentId of CATALOG_AGENT_IDS) {
      const playbook = catalogAgentPlaybook(agentId);
      expect(playbook.agentId).toBe(agentId);
      expect(playbook.label).toBe(CATALOG_AGENT_LABELS[agentId]);
      expect(playbook.version).toBe("1");
      expect(playbook.doctrine.length).toBeGreaterThanOrEqual(800);
      expect(playbook.doctrine.length).toBeLessThanOrEqual(2_500);
      expect(playbook.sectionHeadings.length).toBeGreaterThanOrEqual(3);
      expect(playbook.sectionHeadings.length).toBeLessThanOrEqual(6);
      expect(new Set(playbook.sectionHeadings).size).toBe(
        playbook.sectionHeadings.length
      );
      expect(playbook.sectionHeadings).toEqual(
        playbook.sections.map((section) => section.heading)
      );
      for (const section of playbook.sections) {
        expect(section.heading.trim()).toBe(section.heading);
        expect(section.heading.length).toBeGreaterThan(0);
        expect(section.heading.length).toBeLessThanOrEqual(120);
        expect(section.note.length).toBeGreaterThanOrEqual(60);
        expect(section.note.length).toBeLessThanOrEqual(400);
      }
      expect(new Set(playbook.sections.map((section) => section.note)).size).toBe(
        playbook.sections.length
      );
      expect(playbook.evidenceGuidance.length).toBeGreaterThan(40);
      expect(playbook.constraints).toContain("Propose only");
      expect(playbook.constraints).toContain("Quote nothing you were not given");
    }
  });

  it("names the craft techniques each agent is expected to work from", () => {
    expect(catalogAgentPlaybook("story-architect").doctrine).toContain(
      "Save the Cat"
    );
    expect(catalogAgentPlaybook("scene-sequel-coach").doctrine).toContain("Swain");
    expect(catalogAgentPlaybook("genre-compass").doctrine).toContain("Whydunit");
    expect(catalogAgentPlaybook("pacing-doctor").doctrine).toContain("midpoint");
    expect(catalogAgentPlaybook("developmental-editor").doctrine).toContain(
      "editorial letter"
    );
    expect(catalogAgentPlaybook("copy-editor").doctrine).toContain("style sheet");
    expect(catalogAgentPlaybook("query-coach").doctrine).toContain("synopsis");
  });

  it("holds evidence and honesty rules where fabrication is most tempting", () => {
    expect(catalogAgentPlaybook("continuity-reader").evidenceGuidance).toContain(
      "scene id"
    );
    expect(catalogAgentPlaybook("continuity-reader").constraints).toContain("Drop any finding");
    expect(catalogAgentPlaybook("market-fit").doctrine).toContain(
      "You do not have live sales data"
    );
    expect(catalogAgentPlaybook("market-fit").constraints).toContain(
      "Never invent sales numbers"
    );
    expect(catalogAgentPlaybook("dialogue-coach").constraints).toContain(
      "Never reconstruct a line"
    );
  });

  it("stages agents across the writing arc", () => {
    const stages = new Set(
      CATALOG_AGENT_IDS.map((agentId) => catalogAgentPlaybook(agentId).stage)
    );
    expect(stages).toEqual(
      new Set(["brainstorm", "structure", "writing", "editing", "commercial"])
    );
  });
});

describe("catalogAgentDefaultLens", () => {
  it("opens structure work on Save the Cat and leaves other agents lens-free", () => {
    expect(catalogAgentDefaultLens("story-architect")).toBe("save-the-cat");
    expect(catalogAgentDefaultLens("pacing-doctor")).toBe("save-the-cat");
    expect(catalogAgentDefaultLens("promise-keeper")).toBe("save-the-cat");
    expect(catalogAgentDefaultLens("outline-expander")).toBe("save-the-cat");
    expect(catalogAgentDefaultLens("dialogue-coach")).toBeUndefined();
    expect(catalogAgentDefaultLens("market-fit")).toBeUndefined();
  });
});

describe("catalogLensDoctrine", () => {
  it("covers every supported lens with beat-level guidance", () => {
    for (const lens of CATALOG_MEMO_LENSES) {
      const doctrine = catalogLensDoctrine(lens);
      expect(doctrine.startsWith("Lens:")).toBe(true);
      expect(doctrine.length).toBeGreaterThanOrEqual(300);
      expect(doctrine.length).toBeLessThanOrEqual(1_500);
    }
    expect(catalogLensDoctrine("save-the-cat")).toContain("Midpoint (50%");
    expect(catalogLensDoctrine("three-act")).toContain("turning point");
    expect(catalogLensDoctrine("heros-journey")).toContain("Ordeal");
    expect(catalogLensDoctrine("scene-sequel")).toContain(
      "goal, conflict, disaster"
    );
    expect(catalogLensDoctrine("character-want-need")).toContain("wound");
    expect(catalogLensDoctrine("genre-conventions")).toContain("fair-play");
  });
});

describe("catalogAgentPlaybookDoctrineText", () => {
  it("stacks doctrine, headings, evidence, and constraints into one layer body", () => {
    const playbook = catalogAgentPlaybook("promise-keeper");
    const text = catalogAgentPlaybookDoctrineText(playbook);
    expect(text).toContain("Promise Keeper — structure playbook v1.");
    expect(text).toContain(playbook.doctrine);
    expect(text).toContain(`1. Open promises — ${playbook.sections[0]?.note ?? ""}`);
    expect(text).toContain("4. Closing moves — ");
    expect(text).toContain(`Evidence: ${playbook.evidenceGuidance}`);
    expect(text).toContain(playbook.constraints);
  });
});
