import {
  hashSceneDocument,
  validateSceneDocumentV1
} from "@ghostwriter/editor";
import type { AgentModelId } from "./agent-context-receipt.js";
import {
  assembleCaptureReflectionResource,
  buildPlanModeOutlineContextReceipt,
  PLAN_MODE_OUTLINE_WORKFLOW_CONTRACT_VERSION
} from "./agent-context-receipt.js";
import type { AsyncHashPort } from "./agent-domain.js";
import {
  createPlanModeOutlineAssignment,
  PLAN_MODE_OUTLINE_WORKFLOW_ID
} from "./agent-domain.js";
import type { ContextReceiptRepository } from "./agent-foundation-repository.js";
import type { AgentFoundationServices } from "./agent-foundation-services.js";
import type { AgentProposal } from "./agent-runs-proposals.js";
import type { CaptureDocumentRepository } from "./capture-document-repository.js";
import { captureContentHash, ProjectArchivedMutationError } from "./capture-documents.js";
import type { CaptureServices } from "./capture-services.js";
import {
  agentProposalId,
  agentRunId,
  contextReceiptId,
  type AgentProposalId,
  type AgentRunId,
  type CaptureId,
  type ProjectId
} from "./domain.js";
import type { AccountId } from "./identity.js";
import { CAPTURE_REFLECTION_DEFAULT_MODEL } from "./model-catalog.js";
import { buildPlanOutlinePayload } from "./plan-outline-v1.js";
import type { Clock, IdGenerator, ProjectRepository } from "./project-repository.js";

export type PersistPlanOutlineToPlansResult = Readonly<{
  captureId: CaptureId;
  proposalId: AgentProposalId;
  runId: AgentRunId;
}>;

export type PlanModeOutlineServices = Readonly<{
  persistPlanOutlineToPlans(input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
    outlineText: string;
    model?: AgentModelId;
    title?: string;
  }>): Promise<PersistPlanOutlineToPlansResult>;
  acknowledgeProposal(input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
    proposalId: AgentProposalId;
  }>): Promise<AgentProposal>;
}>;

export type PlanModeOutlineServiceDependencies = Readonly<{
  projects: ProjectRepository;
  captureDocuments: CaptureDocumentRepository;
  captureServices: CaptureServices;
  receipts: ContextReceiptRepository;
  foundation: AgentFoundationServices;
  hashPort: AsyncHashPort;
  ids: IdGenerator;
  clock: Clock;
}>;

function captureDocumentFromPlainText(
  prose: string,
  generateBlockId: () => string
) {
  return validateSceneDocumentV1({
    schemaVersion: 1,
    document: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { id: generateBlockId() },
          content: [{ type: "text", text: prose }]
        }
      ]
    }
  });
}

export function createPlanModeOutlineServices(
  dependencies: PlanModeOutlineServiceDependencies
): PlanModeOutlineServices {
  return Object.freeze({
    async persistPlanOutlineToPlans(input) {
      const project = await dependencies.projects.getProject(input.projectId);
      if (project?.archivedAt !== undefined) {
        throw new ProjectArchivedMutationError();
      }

      const captureHead = await dependencies.captureServices.createCapture({
        accountId: input.accountId,
        projectId: input.projectId,
        sourceModality: "text"
      });
      const document = captureDocumentFromPlainText(
        input.outlineText,
        () => dependencies.ids.create("captureDocumentBlock")
      );
      const savedCapture = await dependencies.captureServices.saveCaptureDocument({
        accountId: input.accountId,
        projectId: input.projectId,
        captureId: captureHead.captureId,
        expectedWorkingVersion: captureHead.workingVersion,
        document
      });

      const now = dependencies.clock.now();
      const receiptId = contextReceiptId(dependencies.ids.create("contextReceipt"));
      const assignment = createPlanModeOutlineAssignment({
        workflowId: PLAN_MODE_OUTLINE_WORKFLOW_ID,
        captureId: savedCapture.captureId
      });
      const resource = await assembleCaptureReflectionResource({
        captureHead: savedCapture,
        assignment,
        hashPort: dependencies.hashPort
      });
      const model = input.model ?? CAPTURE_REFLECTION_DEFAULT_MODEL;
      const receipt = await buildPlanModeOutlineContextReceipt({
        id: receiptId,
        projectId: input.projectId,
        workflowVersion: PLAN_MODE_OUTLINE_WORKFLOW_CONTRACT_VERSION,
        layers: Object.freeze([]),
        resources: Object.freeze([resource]),
        model,
        createdAt: now,
        hashPort: dependencies.hashPort
      });
      await dependencies.foundation.persistPreview({
        accountId: input.accountId,
        receipt
      });

      const runId = agentRunId(dependencies.ids.create("agentRun"));
      await dependencies.foundation.queueRun({
        accountId: input.accountId,
        runId,
        receiptId: receipt.id,
        expectedReceiptHash: receipt.receiptHash
      });
      await dependencies.foundation.markRunning({
        accountId: input.accountId,
        projectId: input.projectId,
        runId
      });

      const payload = buildPlanOutlinePayload(input.outlineText, input.title);
      const proposalId = agentProposalId(dependencies.ids.create("agentProposal"));
      const completed = await dependencies.foundation.completeReflectionRun({
        accountId: input.accountId,
        projectId: input.projectId,
        runId,
        proposalId,
        rawPayload: payload,
        baseCaptureId: savedCapture.captureId,
        expectedCaptureWorkingVersion: savedCapture.workingVersion,
        expectedCaptureContentHash: savedCapture.contentHash
      });
      if (completed.kind !== "ready") {
        throw new Error("Plan outline completion did not produce a ready proposal.");
      }

      return Object.freeze({
        captureId: savedCapture.captureId,
        proposalId: completed.proposal.id,
        runId
      });
    },

    acknowledgeProposal(input) {
      return dependencies.foundation.acknowledgeProposal(input);
    }
  });
}

/** @internal exported for tests */
export async function hashCaptureDocumentFromPlainText(prose: string): Promise<string> {
  const document = captureDocumentFromPlainText(prose, () => "block-test");
  return captureContentHash(await hashSceneDocument(document));
}
