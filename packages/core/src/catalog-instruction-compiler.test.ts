import { describe, expect, it } from "vitest";
import { instructionContentHash, type AsyncHashPort } from "./agent-domain.js";
import { catalogAgentPlaybook } from "./catalog-agent-playbooks.js";
import { createCatalogPlaybookOverride } from "./catalog-playbook-overrides.js";
import { projectId } from "./domain.js";
import {
  CATALOG_AGENT_PRODUCT_POLICY_VERSION,
  compileCatalogAgentInstructions
} from "./catalog-instruction-compiler.js";

function createTestHashPort(): AsyncHashPort {
  return Object.freeze({
    async digestSha256Hex(value: string): Promise<string> {
      let hash = 0n;
      for (let index = 0; index < value.length; index += 1) {
        hash = (hash * 131n + BigInt(value.charCodeAt(index))) & ((1n << 256n) - 1n);
      }
      return hash.toString(16).padStart(64, "0");
    }
  });
}

const BASE = Object.freeze({
  projectTitle: "The Bellwether",
  target: Object.freeze({ kind: "project", id: "project-1" }),
  scenes: Object.freeze([
    Object.freeze({ id: "scene-1", title: "The signal" }),
    Object.freeze({ id: "scene-2", title: "Low water" })
  ])
});

describe("compileCatalogAgentInstructions", () => {
  it("keeps built-in doctrine and layers writer steering on top as untrusted", async () => {
    const builtIn = catalogAgentPlaybook("dialogue-coach");
    const compiled = await compileCatalogAgentInstructions({
      ...BASE,
      agentId: "dialogue-coach",
      playbookOverride: createCatalogPlaybookOverride({
        projectId: projectId("project-1"),
        agentId: "dialogue-coach",
        version: 2,
        doctrine: "Treat every exchange as a contest over withheld truth.",
        sections: [{ heading: "Subtext read", note: "Track what each speaker refuses." }],
        contentHash: instructionContentHash("b".repeat(64)),
        createdAt: "2026-08-01T20:00:00.000Z",
        updatedAt: "2026-08-01T21:00:00.000Z"
      })
    });
    const text = compiled.systemInstructionText;
    expect(text).toContain(builtIn.doctrine);
    expect(text).toContain("Treat every exchange as a contest over withheld truth.");
    expect(text).toContain("Track what each speaker refuses.");
    expect(text).toContain("Never reconstruct a line");
    expect(text.indexOf("AGENT PLAYBOOK")).toBeLessThan(
      text.indexOf("UNTRUSTED WRITER STEERING")
    );
    expect(text.indexOf("UNTRUSTED WRITER STEERING")).toBeLessThan(
      text.indexOf("Treat every exchange as a contest over withheld truth.")
    );
    expect(compiled.layers[2]?.version).toBe("dialogue-coach@1");
    expect(compiled.layers.map((layer) => layer.kind)).toContain(
      "project-instructions"
    );
  });

  it("stacks policy, contract, and agent doctrine ahead of untrusted guidance", async () => {
    const compiled = await compileCatalogAgentInstructions({
      ...BASE,
      agentId: "dialogue-coach"
    });
    const text = compiled.systemInstructionText;
    expect(text).toContain("=== GHOSTWRITER PRODUCT POLICY (authoritative) ===");
    expect(text).toContain("catalog-agent.memo v1");
    expect(text).toContain("=== AGENT PLAYBOOK Dialogue Coach v1");
    expect(text).toContain(catalogAgentPlaybook("dialogue-coach").doctrine);
    expect(text).toContain("1. Subtext read");
    expect(text).toContain("Propose only.");
    expect(text).toContain("Respond only with JSON matching catalog-memo-v1.");
    expect(text).toContain("(none provided)");
    expect(text.indexOf("GHOSTWRITER PRODUCT POLICY")).toBeLessThan(
      text.indexOf("UNTRUSTED WRITER STEERING")
    );
    expect(text.indexOf("AGENT PLAYBOOK")).toBeLessThan(
      text.indexOf("UNTRUSTED WRITER STEERING")
    );
    expect(compiled.lens).toBeUndefined();
    expect(compiled.layers.map((layer) => layer.kind)).toEqual([
      "product-policy",
      "workflow-contract",
      "agent-doctrine"
    ]);
  });

  it("adds the structural lens overlay, defaulting structure agents to Save the Cat", async () => {
    const defaulted = await compileCatalogAgentInstructions({
      ...BASE,
      agentId: "story-architect"
    });
    expect(defaulted.lens).toBe("save-the-cat");
    expect(defaulted.systemInstructionText).toContain(
      "=== STRUCTURAL LENS save-the-cat (authoritative overlay) ==="
    );
    expect(defaulted.systemInstructionText).toContain("Break Into Three (80%");

    const chosen = await compileCatalogAgentInstructions({
      ...BASE,
      agentId: "story-architect",
      lens: "heros-journey"
    });
    expect(chosen.lens).toBe("heros-journey");
    expect(chosen.systemInstructionText).toContain("Return with the Elixir");
    expect(chosen.systemInstructionText).not.toContain("Break Into Three (80%");
    expect(chosen.layers.map((layer) => layer.kind)).toContain("lens-overlay");
  });

  it("keeps project instructions in the untrusted layer", async () => {
    const compiled = await compileCatalogAgentInstructions({
      ...BASE,
      agentId: "line-editor",
      projectInstructionsBody: "Keep the salt-marsh imagery; never soften Wren's swearing."
    });
    const untrustedIndex = compiled.systemInstructionText.indexOf(
      "UNTRUSTED WRITER STEERING"
    );
    const instructionsIndex = compiled.systemInstructionText.indexOf(
      "never soften Wren's swearing"
    );
    expect(untrustedIndex).toBeGreaterThan(-1);
    expect(instructionsIndex).toBeGreaterThan(untrustedIndex);
    expect(compiled.layers.map((layer) => layer.kind)).toContain(
      "project-instructions"
    );
  });

  it("serializes the model context as bounded JSON", async () => {
    const compiled = await compileCatalogAgentInstructions({
      ...BASE,
      agentId: "continuity-reader"
    });
    const context = JSON.parse(compiled.inputText) as Record<string, unknown>;
    expect(context).toMatchObject({
      agentId: "continuity-reader",
      projectTitle: "The Bellwether",
      target: { kind: "project", id: "project-1" },
      scenes: [
        { id: "scene-1", title: "The signal" },
        { id: "scene-2", title: "Low water" }
      ]
    });
    expect(context.sectionHeadings).toEqual(
      catalogAgentPlaybook("continuity-reader").sectionHeadings
    );
    expect(context.lens).toBeUndefined();
  });

  it("selects pacing findings and includes the manuscript position map", async () => {
    const compiled = await compileCatalogAgentInstructions({
      ...BASE,
      agentId: "pacing-doctor",
      scenes: [
        {
          id: "scene-2",
          title: "The turn",
          index: 0,
          startPct: 0,
          midPct: 25,
          endPct: 50
        }
      ]
    });
    expect(compiled.systemInstructionText).toContain(
      "Respond only with JSON matching pacing-findings-v1."
    );
    expect(JSON.parse(compiled.inputText)).toMatchObject({
      scenes: [
        {
          id: "scene-2",
          index: 0,
          startPct: 0,
          midPct: 25,
          endPct: 50
        }
      ]
    });
  });

  it("hashes layer bodies for receipt provenance when a hash port is supplied", async () => {
    const hashPort = createTestHashPort();
    const compiled = await compileCatalogAgentInstructions({
      ...BASE,
      agentId: "pitch-pack",
      hashPort
    });
    for (const layer of compiled.layers) {
      expect(layer.contentHash).toMatch(/^[a-f0-9]{64}$/u);
    }
    const policyLayer = compiled.layers.find(
      (layer) => layer.kind === "product-policy"
    );
    expect(policyLayer?.version).toBe(CATALOG_AGENT_PRODUCT_POLICY_VERSION);
    const doctrineLayer = compiled.layers.find(
      (layer) => layer.kind === "agent-doctrine"
    );
    expect(doctrineLayer?.version).toBe("pitch-pack@1");

    const other = await compileCatalogAgentInstructions({
      ...BASE,
      agentId: "query-coach",
      hashPort
    });
    expect(
      other.layers.find((layer) => layer.kind === "agent-doctrine")?.contentHash
    ).not.toBe(doctrineLayer?.contentHash);
  });
});
