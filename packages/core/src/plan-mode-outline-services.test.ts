import { validateSceneDocumentV1 } from "@ghostwriter/editor";
import { describe, expect, it } from "vitest";
import { createAgentFoundationServices } from "./agent-foundation-services.js";
import { createCaptureServices } from "./capture-services.js";
import { createMemoryAgentProposalRepository } from "./memory-agent-proposal-repository.js";
import { createMemoryAgentRunReflectionCompletionUnitOfWork } from "./memory-agent-run-completion-uow.js";
import { createMemoryAgentRunRepository } from "./memory-agent-run-repository.js";
import { createMemoryCaptureDocumentRepository } from "./memory-capture-document-repository.js";
import { createMemoryContextReceiptRepository } from "./memory-context-receipt-repository.js";
import { createMemoryProjectRepository } from "./memory-project-repository.js";
import { createPlanModeOutlineServices } from "./plan-mode-outline-services.js";
import { derivePlanOutlineTitle, validatePlanOutlineV1 } from "./plan-outline-v1.js";
import {
  BELLWETHER_FIXTURE,
  BELLWETHER_FIXTURE_PROJECT_ID
} from "./fixtures.js";
import { accountId, createProjectMembership } from "./identity.js";

const OWNER = accountId("acct-bellwether-owner");
const NOW = "2026-07-24T22:30:00.000Z";

function createTestHashPort() {
  return {
    async digestSha256Hex(value: string) {
      let hash = 0;
      for (const char of value) {
        hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
      }
      return hash.toString(16).padStart(64, "0");
    }
  };
}

function createSequenceIds() {
  let counter = 0;
  return {
    create(prefix: string) {
      counter += 1;
      return `${prefix}-${counter}`;
    }
  };
}

function createHarness() {
  const receipts = createMemoryContextReceiptRepository();
  const runs = createMemoryAgentRunRepository();
  const proposals = createMemoryAgentProposalRepository();
  const captureDocuments = createMemoryCaptureDocumentRepository();
  const projects = createMemoryProjectRepository(
    [BELLWETHER_FIXTURE],
    [
      createProjectMembership({
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        accountId: OWNER,
        role: "owner",
        createdAt: NOW
      })
    ]
  );
  let tick = 0;
  const clock = {
    now: () => {
      tick += 1;
      return `2026-07-24T22:30:0${Math.min(tick, 9)}.000Z`;
    }
  };
  const hashPort = createTestHashPort();
  const ids = createSequenceIds();
  const foundation = createAgentFoundationServices({
    projects,
    captureDocuments,
    receipts,
    runs,
    proposals,
    completion: createMemoryAgentRunReflectionCompletionUnitOfWork({ runs, proposals }),
    hashPort,
    clock
  });
  const captureServices = createCaptureServices({
    projects,
    captureDocuments,
    ids,
    clock
  });
  const services = createPlanModeOutlineServices({
    projects,
    captureDocuments,
    captureServices,
    receipts,
    foundation,
    hashPort,
    ids,
    clock
  });
  return { services, foundation, captureDocuments, proposals };
}

describe("plan-outline-v1 schema", () => {
  it("validates outline payloads", () => {
    const payload = validatePlanOutlineV1({
      schemaId: "plan-outline-v1",
      title: "Act II beats",
      outline: "## Act II\n- Mara chooses the harbor.",
      sourceMode: "plan"
    });
    expect(payload.title).toBe("Act II beats");
  });

  it("derives title from the first line", () => {
    expect(
      derivePlanOutlineTitle("Harbor opening\n- Fog\n- Signal", undefined)
    ).toBe("Harbor opening");
    expect(derivePlanOutlineTitle("   \n\n", undefined)).toBe("Plan outline");
  });
});

describe("plan-mode outline services", () => {
  it("persists outline text as capture + ready plan-outline proposal without provider", async () => {
    const { services, foundation, captureDocuments, proposals } = createHarness();
    const outlineText = "## Opening\n- Fog on the pier.\n- Mara hears the signal.";
    const result = await services.persistPlanOutlineToPlans({
      accountId: OWNER,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      outlineText,
      title: "Harbor plan"
    });

    const capture = await captureDocuments.get(result.captureId);
    expect(capture?.status).toBe("draft");
    expect(
      validateSceneDocumentV1(capture!.document).document.content?.[0]
    ).toMatchObject({
      type: "paragraph"
    });

    const proposal = await foundation.getProposal({
      accountId: OWNER,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      proposalId: result.proposalId
    });
    expect(proposal.outputSchemaId).toBe("plan-outline-v1");
    expect(proposal.payload.schemaId).toBe("plan-outline-v1");
    if (proposal.payload.schemaId !== "plan-outline-v1") return;
    expect(proposal.payload.outline).toBe(outlineText);
    expect(proposal.payload.title).toBe("Harbor plan");
    expect(proposal.status).toBe("ready");

    const acknowledged = await services.acknowledgeProposal({
      accountId: OWNER,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      proposalId: result.proposalId
    });
    expect(acknowledged.status).toBe("applied");
    expect((await proposals.get(result.proposalId))?.status).toBe("applied");
  });
});
