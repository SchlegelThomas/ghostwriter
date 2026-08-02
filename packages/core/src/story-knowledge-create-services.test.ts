import { describe, expect, it } from "vitest";
import type { AsyncHashPort } from "./agent-domain.js";
import { createAgentFoundationServices } from "./agent-foundation-services.js";
import {
  BELLWETHER_FIXTURE,
  BELLWETHER_FIXTURE_PROJECT_ID
} from "./fixtures.js";
import { accountId, createProjectMembership } from "./identity.js";
import { createMemoryAgentProposalRepository } from "./memory-agent-proposal-repository.js";
import { createMemoryAgentRunReflectionCompletionUnitOfWork } from "./memory-agent-run-completion-uow.js";
import { createMemoryAgentRunRepository } from "./memory-agent-run-repository.js";
import { createMemoryCaptureDocumentRepository } from "./memory-capture-document-repository.js";
import { createMemoryContextReceiptRepository } from "./memory-context-receipt-repository.js";
import { createMemoryProjectRepository } from "./memory-project-repository.js";
import { createProjectCommandServices } from "./project-commands.js";
import type { DomainIdKind, IdGenerator } from "./project-repository.js";
import { sceneId } from "./domain.js";
import {
  buildStoryKnowledgeCreateDraftPayload,
  createStoryKnowledgeCreateServices
} from "./story-knowledge-create-services.js";
import { validateStoryKnowledgeCreateV1 } from "./story-knowledge-create-v1.js";

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
      return `${kind}-sk-create-${next}`;
    }
  };
}

describe("buildStoryKnowledgeCreateDraftPayload", () => {
  it("validates a bounded cast draft payload", () => {
    const payload = buildStoryKnowledgeCreateDraftPayload({
      name: "Jonah",
      kind: "character",
      summary: "A ferry passenger scanning the fog.",
      sceneId: arrivalSceneId,
      firstAppearanceNote: "Named in the arrival scene."
    });
    expect(payload.schemaId).toBe("story-knowledge-create-v1");
    expect(validateStoryKnowledgeCreateV1(payload)).toEqual(payload);
  });
});

describe("story-knowledge create draft service", () => {
  it("creates a ready draft targeted at a scene", async () => {
    const owner = accountId("account-sk-create-scene");
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
    const services = createStoryKnowledgeCreateServices({
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

    const result = await services.createStoryKnowledgeDraft({
      accountId: owner,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      name: "Jonah",
      kind: "character",
      summary: "A ferry passenger scanning the fog.",
      sceneId: arrivalSceneId
    });

    expect(result.proposal.outputSchemaId).toBe("story-knowledge-create-v1");
    expect(result.proposal.status).toBe("ready");
    expect(result.proposal.primaryTarget).toEqual({
      kind: "scene",
      id: arrivalSceneId
    });
    expect(validateStoryKnowledgeCreateV1(result.proposal.payload).name).toBe("Jonah");
  });

  it("acknowledge creates cast and marks the proposal applied", async () => {
    const owner = accountId("account-sk-create-ack");
    const receipts = createMemoryContextReceiptRepository();
    const runs = createMemoryAgentRunRepository();
    const proposals = createMemoryAgentProposalRepository();
    const captureDocuments = createMemoryCaptureDocumentRepository();
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
    const ids = sequenceIds();
    const clock = { now: () => "2026-08-01T12:00:00.000Z" };
    const projectCommands = createProjectCommandServices({ projects, ids, clock });
    const foundation = createAgentFoundationServices({
      projects,
      captureDocuments,
      receipts,
      runs,
      proposals,
      completion: createMemoryAgentRunReflectionCompletionUnitOfWork({
        runs,
        proposals
      }),
      hashPort: testHashPort(),
      clock,
      projectCommands
    });
    const services = createStoryKnowledgeCreateServices({
      projects,
      receipts,
      runs,
      completion: createMemoryAgentRunReflectionCompletionUnitOfWork({
        runs,
        proposals
      }),
      foundation,
      hashPort: testHashPort(),
      ids,
      clock
    });

    const before = await projects.listStoryKnowledge(BELLWETHER_FIXTURE_PROJECT_ID);
    expect(before.some((entry) => entry.label === "Jonah")).toBe(false);

    const { proposal } = await services.createStoryKnowledgeDraft({
      accountId: owner,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      name: "Jonah",
      kind: "character",
      summary: "A ferry passenger scanning the fog."
    });

    const acknowledged = await foundation.acknowledgeProposal({
      accountId: owner,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      proposalId: proposal.id
    });
    expect(acknowledged.status).toBe("applied");

    const after = await projects.listStoryKnowledge(BELLWETHER_FIXTURE_PROJECT_ID);
    expect(after.some((entry) => entry.label === "Jonah")).toBe(true);
  });
});
