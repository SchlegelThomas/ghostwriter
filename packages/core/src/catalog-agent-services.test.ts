import { describe, expect, it } from "vitest";
import type { AsyncHashPort } from "./agent-domain.js";
import {
  buildDeterministicCatalogMemo,
  CatalogAgentTargetRequiredError,
  createCatalogAgentServices,
  resolveCatalogAgentPrimaryTarget
} from "./catalog-agent-services.js";
import { catalogAgentPlaybook } from "./catalog-agent-playbooks.js";
import { validateCatalogMemoV1 } from "./catalog-memo-v1.js";
import { projectId } from "./domain.js";
import { accountId, createProjectMembership } from "./identity.js";
import { createMemoryAgentProposalRepository } from "./memory-agent-proposal-repository.js";
import { createMemoryAgentRunReflectionCompletionUnitOfWork } from "./memory-agent-run-completion-uow.js";
import { createMemoryAgentRunRepository } from "./memory-agent-run-repository.js";
import { createMemoryContextReceiptRepository } from "./memory-context-receipt-repository.js";
import { createMemoryProjectRepository } from "./memory-project-repository.js";
import { BELLWETHER_FIXTURE, BELLWETHER_FIXTURE_PROJECT_ID } from "./fixtures.js";
import type { DomainIdKind, IdGenerator } from "./project-repository.js";

function testHashPort(): AsyncHashPort {
  return {
    async digestSha256Hex(value) {
      let hash = 0n;
      for (const character of value) {
        hash = (hash * 131n + BigInt(character.charCodeAt(0))) & ((1n << 256n) - 1n);
      }
      return hash.toString(16).padStart(64, "0");
    }
  };
}

function sequenceIds(): IdGenerator {
  const counts = new Map<DomainIdKind, number>();
  return {
    create(kind) {
      const next = (counts.get(kind) ?? 0) + 1;
      counts.set(kind, next);
      return `${kind}-catalog-${next}`;
    }
  };
}

describe("catalog-memo-v1", () => {
  it("strictly validates bounded memo fields", () => {
    const memo = validateCatalogMemoV1({
      schemaId: "catalog-memo-v1",
      agentId: "genre-compass",
      title: "Genre read",
      summary: "A grounded summary.",
      lens: "genre-conventions",
      sections: [{ heading: "Promise", body: "Track the reader promise." }],
      evidence: [{ label: "Opening", sceneId: "scene-1" }]
    });
    expect(memo.title).toBe("Genre read");
    expect(() =>
      validateCatalogMemoV1({ ...memo, unexpected: true })
    ).toThrow(/unexpected/u);
    expect(() =>
      validateCatalogMemoV1({
        ...memo,
        agentId: "continuity-reader",
        evidence: [{ label: "Unsupported claim" }]
      })
    ).toThrow(/identify a scene or quote/u);
  });
});

describe("buildDeterministicCatalogMemo", () => {
  it("uses real scene references without fabricating quotes", () => {
    const memo = buildDeterministicCatalogMemo({
      agentId: "continuity-reader",
      projectTitle: "The Bellwether",
      sceneTitles: [{ id: "scene-1", title: "The signal" }]
    });
    expect(memo.schemaId).toBe("catalog-memo-v1");
    expect(memo.evidence).toEqual([
      { label: "Review anchor: The signal", sceneId: "scene-1" }
    ]);
    expect(memo.evidence[0]?.quote).toBeUndefined();
  });

  it("defaults structure work to Save the Cat", () => {
    expect(
      buildDeterministicCatalogMemo({
        agentId: "story-architect",
        projectTitle: "The Bellwether",
        sceneTitles: []
      }).lens
    ).toBe("save-the-cat");
  });

  it("builds sections from the agent playbook rather than generic filler", () => {
    const playbook = catalogAgentPlaybook("promise-keeper");
    const memo = buildDeterministicCatalogMemo({
      agentId: "promise-keeper",
      projectTitle: "The Bellwether",
      sceneTitles: [{ id: "scene-1", title: "The signal" }]
    });
    expect(memo.sections.map((section) => section.heading)).toEqual(
      playbook.sectionHeadings
    );
    expect(memo.sections[0]?.body).toContain("The signal");
    expect(memo.sections[1]?.body.length).toBeGreaterThan(80);
    expect(memo.summary).toContain("No model result was available");
  });

  it("gives every heading its own craft note", () => {
    const playbook = catalogAgentPlaybook("developmental-editor");
    const memo = buildDeterministicCatalogMemo({
      agentId: "developmental-editor",
      projectTitle: "The Bellwether",
      sceneTitles: [{ id: "scene-1", title: "The signal" }]
    });
    for (const [index, section] of playbook.sections.entries()) {
      expect(memo.sections[index]?.heading).toBe(section.heading);
      expect(memo.sections[index]?.body).toContain(section.note);
    }
    expect(new Set(memo.sections.map((section) => section.body)).size).toBe(
      memo.sections.length
    );
  });

  it("says so plainly when there is no story material yet", () => {
    const memo = buildDeterministicCatalogMemo({
      agentId: "idea-midwife",
      projectTitle: "The Bellwether",
      sceneTitles: []
    });
    expect(memo.sections[0]?.body).toContain("No scene material is available yet");
    expect(memo.evidence).toEqual([]);
  });
});

describe("resolveCatalogAgentPrimaryTarget", () => {
  const project = projectId("project-catalog");

  it("resolves project, scene, and cast targets", () => {
    expect(
      resolveCatalogAgentPrimaryTarget({
        agentId: "genre-compass",
        projectId: project
      })
    ).toEqual({ kind: "project", id: project });
    expect(
      resolveCatalogAgentPrimaryTarget({
        agentId: "dialogue-coach",
        projectId: project,
        sceneId: "scene-1"
      })
    ).toEqual({ kind: "scene", id: "scene-1" });
    expect(
      resolveCatalogAgentPrimaryTarget({
        agentId: "character-coach-cast",
        projectId: project,
        storyKnowledgeId: "knowledge-1"
      })
    ).toEqual({ kind: "story-knowledge", id: "knowledge-1" });
  });

  it("refuses missing scene and cast context", () => {
    expect(() =>
      resolveCatalogAgentPrimaryTarget({
        agentId: "scene-sequel-coach",
        projectId: project
      })
    ).toThrow(CatalogAgentTargetRequiredError);
    expect(() =>
      resolveCatalogAgentPrimaryTarget({
        agentId: "character-coach-cast",
        projectId: project
      })
    ).toThrow(/cast member/u);
  });
});

describe("catalog agent service schema branching", () => {
  it("creates pacing-findings-v1 for Pacing Doctor and leaves memo agents unchanged", async () => {
    const owner = accountId("account-catalog");
    const receipts = createMemoryContextReceiptRepository();
    const runs = createMemoryAgentRunRepository();
    const proposals = createMemoryAgentProposalRepository();
    const projects = createMemoryProjectRepository(
      [BELLWETHER_FIXTURE],
      [
        createProjectMembership({
          projectId: BELLWETHER_FIXTURE_PROJECT_ID,
          accountId: owner,
          role: "owner",
          createdAt: "2026-08-01T12:00:00.000Z"
        })
      ]
    );
    const services = createCatalogAgentServices({
      projects,
      receipts,
      runs,
      completion: createMemoryAgentRunReflectionCompletionUnitOfWork({
        runs,
        proposals
      }),
      foundation: {
        async persistPreview({ receipt }) {
          const result = await receipts.insertImmutable(receipt);
          if (!result.ok) throw new Error("Receipt conflict");
          return result.receipt;
        }
      },
      hashPort: testHashPort(),
      ids: sequenceIds(),
      clock: { now: () => "2026-08-01T12:00:00.000Z" }
    });

    let requestedSchema: string | undefined;
    const pacing = await services.runCatalogAgent({
      accountId: owner,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      agentId: "pacing-doctor",
      provider: {
        async completeStructured(input) {
          requestedSchema = input.outputSchema.name;
          return { ok: false, diagnostic: { code: "provider-unavailable" } };
        }
      }
    });
    const genre = await services.runCatalogAgent({
      accountId: owner,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      agentId: "genre-compass"
    });

    expect(pacing.outputSchemaId).toBe("pacing-findings-v1");
    expect(pacing.payload.schemaId).toBe("pacing-findings-v1");
    expect(requestedSchema).toBe("pacing-findings-v1");
    expect(genre.outputSchemaId).toBe("catalog-memo-v1");
    expect(genre.payload.schemaId).toBe("catalog-memo-v1");
  });
});
