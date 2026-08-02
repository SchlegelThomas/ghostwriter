import { validateSceneDocumentV1 } from "@ghostwriter/editor";
import { describe, expect, it } from "vitest";
import type { AsyncHashPort } from "./agent-domain.js";
import {
  BELLWETHER_FIXTURE,
  BELLWETHER_FIXTURE_PROJECT_ID
} from "./fixtures.js";
import { accountId, createProjectMembership } from "./identity.js";
import { createMemoryAgentProposalRepository } from "./memory-agent-proposal-repository.js";
import { createMemoryAgentRunReflectionCompletionUnitOfWork } from "./memory-agent-run-completion-uow.js";
import { createMemoryAgentRunRepository } from "./memory-agent-run-repository.js";
import { createMemoryContextReceiptRepository } from "./memory-context-receipt-repository.js";
import { createMemoryProjectRepository } from "./memory-project-repository.js";
import { createMemorySceneDocumentRepository } from "./memory-scene-document-repository.js";
import {
  buildDeterministicNextActionV1,
  buildNextActionCoachInputText,
  createNextActionCoachServices
} from "./next-action-coach-services.js";
import { validateNextActionV1 } from "./next-action-v1.js";
import { sceneId } from "./domain.js";
import { createInitialSceneDocumentState } from "./scene-writing-services.js";
import type { DomainIdKind, IdGenerator } from "./project-repository.js";

const arrivalSceneId = sceneId("scene-arrival-at-bellwether");

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
      return `${kind}-next-action-${next}`;
    }
  };
}

function proseDocument(text: string) {
  return validateSceneDocumentV1({
    schemaVersion: 1,
    document: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { id: "block-next-action-1" },
          content: [{ type: "text", text }]
        }
      ]
    }
  });
}

describe("buildDeterministicNextActionV1", () => {
  it("suggests cast capture when prose names someone off-roster", () => {
    const payload = buildDeterministicNextActionV1({
      sceneId: arrivalSceneId,
      sceneTitle: "Arrival at Bellwether",
      trigger: "scene-prose-saved",
      prose: "Jonah stepped off the ferry while Mara watched from the pier.",
      roster: [
        Object.freeze({
          id: "knowledge-mara",
          label: "Mara Venn",
          kind: "character" as const,
          aliases: Object.freeze([] as readonly string[])
        })
      ]
    });
    expect(payload.schemaId).toBe("next-action-v1");
    expect(payload.suggestions.some((item) => item.proposedName === "Jonah")).toBe(true);
    expect(payload.suggestions.some((item) => item.kind === "continue-writing")).toBe(true);
  });

  it("falls back to title-aware setup when prose is empty", () => {
    const payload = buildDeterministicNextActionV1({
      sceneId: arrivalSceneId,
      sceneTitle: "Arrival at Bellwether",
      trigger: "manual-start",
      prose: "",
      roster: []
    });
    expect(payload.summary).toContain("no prose yet");
    expect(payload.suggestions.some((item) => item.kind === "continue-writing")).toBe(true);
    expect(payload.suggestions.some((item) => item.kind === "create-story-knowledge")).toBe(
      true
    );
  });
});

describe("next-action coach service", () => {
  it("creates a ready next-action-v1 proposal with deterministic fallback", async () => {
    const owner = accountId("account-next-action");
    const receipts = createMemoryContextReceiptRepository();
    const runs = createMemoryAgentRunRepository();
    const proposals = createMemoryAgentProposalRepository();
    const sceneDocuments = createMemorySceneDocumentRepository();
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
    const initial = await createInitialSceneDocumentState({
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      sceneId: arrivalSceneId,
      actorAccountId: owner,
      ids: sequenceIds(),
      now: "2026-08-01T12:00:00.000Z"
    });
    await sceneDocuments.initialize({
      ...initial,
      head: {
        ...initial.head,
        document: proseDocument(
          "The ferry groaned against the dock while Jonah scanned the fog."
        )
      },
      genesisRevision: {
        ...initial.genesisRevision,
        document: proseDocument(
          "The ferry groaned against the dock while Jonah scanned the fog."
        )
      }
    });
    const services = createNextActionCoachServices({
      projects,
      sceneDocuments,
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

    const result = await services.runNextActionCoach({
      accountId: owner,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      sceneId: arrivalSceneId,
      trigger: "scene-prose-saved"
    });

    expect(result.proposal.outputSchemaId).toBe("next-action-v1");
    expect(result.proposal.primaryTarget).toEqual({
      kind: "scene",
      id: arrivalSceneId
    });
    expect(result.payload.schemaId).toBe("next-action-v1");
    expect(result.payload.trigger).toBe("scene-prose-saved");
    expect(validateNextActionV1(result.payload)).toEqual(result.payload);
  });

  it("uses provider output when structured completion succeeds", async () => {
    const owner = accountId("account-next-action-provider");
    const receipts = createMemoryContextReceiptRepository();
    const runs = createMemoryAgentRunRepository();
    const proposals = createMemoryAgentProposalRepository();
    const sceneDocuments = createMemorySceneDocumentRepository();
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
    await sceneDocuments.initialize(
      await createInitialSceneDocumentState({
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        sceneId: arrivalSceneId,
        actorAccountId: owner,
        ids: sequenceIds(),
        now: "2026-08-01T12:00:00.000Z"
      })
    );
    const services = createNextActionCoachServices({
      projects,
      sceneDocuments,
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

    const result = await services.runNextActionCoach({
      accountId: owner,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      sceneId: arrivalSceneId,
      trigger: "manual-start",
      provider: {
        async completeStructured() {
          return {
            ok: true,
            output: {
              schemaId: "next-action-v1",
              trigger: "manual-start",
              summary: "Provider summary for manual start.",
              suggestions: [
                {
                  kind: "continue-writing",
                  title: "Keep going",
                  rationale: "Momentum is good."
                },
                {
                  kind: "run-catalog-agent",
                  title: "Dialogue pass",
                  rationale: "Lines need polish.",
                  catalogAgentId: "dialogue-coach",
                  sceneId: arrivalSceneId
                }
              ]
            }
          };
        }
      }
    });

    expect(result.payload.summary).toBe("Provider summary for manual start.");
    expect(result.payload.suggestions).toHaveLength(2);
    expect(buildNextActionCoachInputText({
      projectTitle: "The Bellwether Cycle",
      sceneId: arrivalSceneId,
      sceneTitle: "Arrival at Bellwether",
      trigger: "manual-start",
      prose: "",
      proseTruncated: false,
      roster: []
    })).toContain("Cast roster:");
  });
});
