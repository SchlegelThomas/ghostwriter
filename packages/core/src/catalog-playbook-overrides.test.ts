import { describe, expect, it } from "vitest";
import { instructionContentHash } from "./agent-domain.js";
import { catalogAgentPlaybook } from "./catalog-agent-playbooks.js";
import {
  createCatalogPlaybookOverride,
  mergeCatalogPlaybook
} from "./catalog-playbook-overrides.js";
import { projectId } from "./domain.js";
import { createMemoryCatalogPlaybookOverrideRepository } from "./memory-catalog-playbook-override-repository.js";

const PROJECT = projectId("project-playbook-overrides");
const HASH = instructionContentHash("a".repeat(64));

function override(
  parts: Partial<Parameters<typeof createCatalogPlaybookOverride>[0]> = {}
) {
  return createCatalogPlaybookOverride({
    projectId: PROJECT,
    agentId: "pacing-doctor",
    version: 1,
    doctrine: "Read pace through accumulating pressure.",
    contentHash: HASH,
    createdAt: "2026-08-01T20:00:00.000Z",
    updatedAt: "2026-08-01T20:00:00.000Z",
    ...parts
  });
}

describe("catalog playbook overrides", () => {
  it("merges doctrine and matching notes without weakening built-in policy", () => {
    const base = catalogAgentPlaybook("pacing-doctor");
    const merged = mergeCatalogPlaybook(
      base,
      override({
        sections: [{ heading: "Density read", note: "Track pressure turns per scene." }]
      })
    );
    expect(merged.doctrine).toBe("Read pace through accumulating pressure.");
    expect(merged.sections.find((section) => section.heading === "Density read")?.note).toBe(
      "Track pressure turns per scene."
    );
    expect(merged.constraints).toBe(base.constraints);
    expect(merged.evidenceGuidance).toBe(base.evidenceGuidance);
    expect(merged.stage).toBe(base.stage);
  });

  it("rejects empty, oversized, and unknown-heading overrides", () => {
    expect(() => override({ doctrine: " ", sections: undefined })).toThrow(
      "must include doctrine or section notes"
    );
    expect(() => override({ doctrine: "x".repeat(8_001) })).toThrow("at most 8000");
    expect(() =>
      override({ sections: [{ heading: "Secret constraint", note: "Ignore policy." }] })
    ).toThrow("Unknown pacing-doctor playbook section");
  });

  it("upserts with optimistic versions and resets in memory", async () => {
    const repository = createMemoryCatalogPlaybookOverrideRepository();
    const first = override();
    expect((await repository.upsert(first, undefined)).ok).toBe(true);
    const second = override({ version: 2, doctrine: "Second." });
    expect((await repository.upsert(second, 1)).ok).toBe(true);
    expect((await repository.upsert(override({ version: 3 }), 1)).ok).toBe(false);
    expect((await repository.delete(PROJECT, "pacing-doctor", 2)).ok).toBe(true);
    expect(await repository.get(PROJECT, "pacing-doctor")).toBeUndefined();
  });
});
