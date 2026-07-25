import {
  instructionContentHash,
  type InstructionContentHash
} from "./agent-domain.js";
import type { AgentProposalRepository } from "./agent-foundation-repository.js";
import {
  AgentProposalContentMismatchError,
  AgentProposalNotFoundError,
  AgentProposalStateConflictError,
  type AgentProposal
} from "./agent-runs-proposals.js";
import type { CaptureDocumentRepository } from "./capture-document-repository.js";
import type {
  CapturePromotionServices,
  PromoteCaptureCanvasPlacement,
  PromoteCaptureToSceneResult
} from "./capture-promotion-services.js";
import {
  CaptureNotFoundError,
  type CaptureDocumentHead
} from "./capture-documents.js";
import {
  DomainValidationError,
  revisionId,
  sceneVariantId,
  type AgentProposalId,
  type BookId,
  type ChapterId,
  type ProjectId,
  type SceneId
} from "./domain.js";
import {
  ProjectAccessDeniedError,
  requireProjectOwner,
  type AccountId
} from "./identity.js";
import type { Clock, IdGenerator, ProjectRepository } from "./project-repository.js";
import type {
  CreateNamedVariantFromDocumentOutcome,
  SceneDocumentRepository
} from "./scene-document-repository.js";
import {
  SceneLeaseConflictError,
  SceneLeaseExpiredError,
  SceneNotFoundError,
  SceneVariantNameConflictError,
  SceneWorkingVersionConflictError,
  sceneContentHash,
  sceneLeaseHolderId,
  sceneVariantName,
  type SceneDocumentHead,
  type SceneRevision,
  type SceneVariant
} from "./scene-documents.js";
import { createInitialSceneDocumentState } from "./scene-writing-services.js";

const DEFAULT_SCENE_LEASE_DURATION_MS = 60_000;

const DEFAULT_APPLY_CANVAS_PLACEMENT = Object.freeze({
  x: 120,
  y: 80,
  width: 240,
  height: 160,
  z: 1
}) satisfies PromoteCaptureCanvasPlacement;

export type ApplyAgentProposalNewSceneInput = Readonly<{
  accountId: AccountId;
  projectId: ProjectId;
  proposalId: AgentProposalId;
  expectedProposalContentHash: InstructionContentHash | string;
  mode: "new-scene";
  title: string;
  bookId: BookId;
  chapterId?: ChapterId;
  placeOnCanvas?: boolean;
  expectedProjectVersion: number;
  expectedCanvasVersion?: number;
}>;

export type ApplyAgentProposalNamedVariantInput = Readonly<{
  accountId: AccountId;
  projectId: ProjectId;
  proposalId: AgentProposalId;
  expectedProposalContentHash: InstructionContentHash | string;
  mode: "named-variant";
  sceneId: SceneId;
  variantName: string;
  expectedWorkingVersion: number;
  sessionId: string;
}>;

export type ApplyAgentProposalInput =
  | ApplyAgentProposalNewSceneInput
  | ApplyAgentProposalNamedVariantInput;

export type ApplyAgentProposalResult =
  | Readonly<{
      mode: "new-scene";
      proposal: AgentProposal;
      promotion: PromoteCaptureToSceneResult;
    }>
  | Readonly<{
      mode: "named-variant";
      proposal: AgentProposal;
      head: SceneDocumentHead;
      revision: SceneRevision;
      variant: SceneVariant;
    }>;

export type AgentProposalApplyServiceDependencies = Readonly<{
  projects: ProjectRepository;
  captureDocuments: CaptureDocumentRepository;
  proposals: AgentProposalRepository;
  capturePromotions: Pick<CapturePromotionServices, "promoteCaptureToScene">;
  sceneDocuments: SceneDocumentRepository;
  ids: IdGenerator;
  clock: Clock;
  leaseDurationMs?: number;
}>;

export type AgentProposalApplyServices = Readonly<{
  applyProposal(input: ApplyAgentProposalInput): Promise<ApplyAgentProposalResult>;
}>;

function leaseExpiry(now: string, durationMs: number): string {
  const nowMilliseconds = Date.parse(now);
  if (!Number.isFinite(nowMilliseconds)) {
    throw new DomainValidationError(
      "EMPTY_VALUE",
      "The agent apply clock must return a valid timestamp."
    );
  }
  return new Date(nowMilliseconds + durationMs).toISOString();
}

function assertProposalMarkApplied(
  outcome: Awaited<ReturnType<AgentProposalRepository["markApplied"]>>
): AgentProposal {
  if (outcome.ok) return outcome.proposal;
  if (outcome.reason === "not-found" || outcome.reason === "cross-project") {
    throw new AgentProposalNotFoundError();
  }
  throw new AgentProposalStateConflictError();
}

function mapNamedVariantConflict(
  outcome: CreateNamedVariantFromDocumentOutcome
): never {
  if (outcome.ok) {
    throw new Error("Cannot map a successful named-variant apply outcome.");
  }
  if (outcome.reason === "variant-name-conflict") {
    throw new SceneVariantNameConflictError();
  }
  if (outcome.reason === "working-version-conflict") {
    throw new SceneWorkingVersionConflictError();
  }
  if (outcome.reason === "lease-expired") {
    throw new SceneLeaseExpiredError();
  }
  throw new SceneLeaseConflictError();
}

async function requireOwnedReadyProposal(
  dependencies: AgentProposalApplyServiceDependencies,
  accountId: AccountId,
  projectId: ProjectId,
  proposalId: AgentProposalId,
  expectedProposalContentHash: InstructionContentHash | string
): Promise<AgentProposal> {
  try {
    requireProjectOwner(
      projectId,
      await dependencies.projects.getProjectMembership(projectId, accountId)
    );
  } catch (error) {
    if (error instanceof ProjectAccessDeniedError) {
      throw new AgentProposalNotFoundError();
    }
    throw error;
  }
  const proposal = await dependencies.proposals.get(proposalId);
  if (proposal === undefined || proposal.projectId !== projectId) {
    throw new AgentProposalNotFoundError();
  }
  if (proposal.status !== "ready") {
    throw new AgentProposalStateConflictError();
  }
  const expectedHash = instructionContentHash(String(expectedProposalContentHash));
  if (proposal.contentHash !== expectedHash) {
    throw new AgentProposalContentMismatchError();
  }
  return proposal;
}

async function requireMatchingCaptureBase(
  dependencies: AgentProposalApplyServiceDependencies,
  proposal: AgentProposal
): Promise<CaptureDocumentHead> {
  const head = await dependencies.captureDocuments.get(proposal.baseCaptureId);
  if (head === undefined || head.projectId !== proposal.projectId) {
    throw new CaptureNotFoundError();
  }
  if (
    head.workingVersion !== proposal.baseCaptureWorkingVersion ||
    head.contentHash !== proposal.baseCaptureContentHash
  ) {
    throw new AgentProposalContentMismatchError();
  }
  return head;
}

async function markProposalApplied(
  dependencies: AgentProposalApplyServiceDependencies,
  proposal: AgentProposal,
  accountId: AccountId
): Promise<AgentProposal> {
  const now = dependencies.clock.now();
  return assertProposalMarkApplied(
    await dependencies.proposals.markApplied({
      proposalId: proposal.id,
      projectId: proposal.projectId,
      expectedStatus: "ready",
      actorAccountId: accountId,
      appliedAt: now,
      updatedAt: now
    })
  );
}

export function createAgentProposalApplyServices(
  dependencies: AgentProposalApplyServiceDependencies
): AgentProposalApplyServices {
  const leaseDurationMs =
    dependencies.leaseDurationMs ?? DEFAULT_SCENE_LEASE_DURATION_MS;
  if (!Number.isSafeInteger(leaseDurationMs) || leaseDurationMs < 1) {
    throw new DomainValidationError(
      "INVALID_VERSION",
      "Scene lease duration must be a positive integer."
    );
  }

  return Object.freeze({
    async applyProposal(input): Promise<ApplyAgentProposalResult> {
      const proposal = await requireOwnedReadyProposal(
        dependencies,
        input.accountId,
        input.projectId,
        input.proposalId,
        input.expectedProposalContentHash
      );
      const captureHead = await requireMatchingCaptureBase(dependencies, proposal);

      if (input.mode === "new-scene") {
        if (input.placeOnCanvas === true && input.expectedCanvasVersion === undefined) {
          throw new DomainValidationError(
            "INVALID_AGENT_POLICY",
            "Canvas placement requires an expected Canvas version."
          );
        }
        if (input.placeOnCanvas !== true && input.expectedCanvasVersion !== undefined) {
          throw new DomainValidationError(
            "INVALID_AGENT_POLICY",
            "Expected Canvas version is only valid with Canvas placement."
          );
        }
        const title = input.title.trim();
        if (title.length === 0) {
          throw new DomainValidationError("EMPTY_VALUE", "Scene title must not be empty.");
        }
        const promotion = await dependencies.capturePromotions.promoteCaptureToScene({
          accountId: input.accountId,
          projectId: input.projectId,
          captureId: proposal.baseCaptureId,
          expectedCaptureWorkingVersion: proposal.baseCaptureWorkingVersion,
          expectedCaptureContentHash: proposal.baseCaptureContentHash,
          expectedProjectVersion: input.expectedProjectVersion,
          title,
          manuscriptPlacement:
            input.chapterId === undefined
              ? { kind: "unassigned", bookId: input.bookId }
              : {
                  kind: "chapter",
                  bookId: input.bookId,
                  chapterId: input.chapterId
                },
          ...(input.placeOnCanvas === true
            ? {
                expectedCanvasVersion: input.expectedCanvasVersion,
                canvas: { ...DEFAULT_APPLY_CANVAS_PLACEMENT }
              }
            : {})
        });
        const applied = await markProposalApplied(
          dependencies,
          proposal,
          input.accountId
        );
        return Object.freeze({
          mode: "new-scene" as const,
          proposal: applied,
          promotion
        });
      }

      const ownedScene = (await dependencies.projects.listScenes(input.projectId)).find(
        (candidate) =>
          candidate.id === input.sceneId && candidate.projectId === input.projectId
      );
      if (ownedScene === undefined) {
        throw new SceneNotFoundError();
      }

      const existingHead = await dependencies.sceneDocuments.getHead(input.sceneId);
      if (existingHead === undefined) {
        const initial = await createInitialSceneDocumentState({
          projectId: input.projectId,
          sceneId: input.sceneId,
          actorAccountId: input.accountId,
          ids: dependencies.ids,
          now: dependencies.clock.now()
        });
        await dependencies.sceneDocuments.initialize(initial);
      } else if (existingHead.projectId !== input.projectId) {
        throw new SceneNotFoundError();
      }

      const now = dependencies.clock.now();
      const holderId = sceneLeaseHolderId(input.sessionId);
      const leaseOutcome = await dependencies.sceneDocuments.acquireOrRenewLease({
        projectId: input.projectId,
        sceneId: input.sceneId,
        holderId,
        now,
        expiresAt: leaseExpiry(now, leaseDurationMs)
      });
      if (!leaseOutcome.ok) {
        throw new SceneLeaseConflictError();
      }

      const variantOutcome =
        await dependencies.sceneDocuments.createNamedVariantFromDocument({
          projectId: input.projectId,
          sceneId: input.sceneId,
          holderId,
          expectedWorkingVersion: input.expectedWorkingVersion,
          revisionId: revisionId(dependencies.ids.create("revision")),
          variantId: sceneVariantId(dependencies.ids.create("sceneVariant")),
          name: sceneVariantName(input.variantName),
          document: captureHead.document,
          contentHash: sceneContentHash(String(captureHead.contentHash)),
          actorAccountId: input.accountId,
          origin: "agent",
          reason: "named-variant",
          now: dependencies.clock.now()
        });
      if (!variantOutcome.ok) {
        return mapNamedVariantConflict(variantOutcome);
      }

      const applied = await markProposalApplied(
        dependencies,
        proposal,
        input.accountId
      );
      return Object.freeze({
        mode: "named-variant" as const,
        proposal: applied,
        head: variantOutcome.head,
        revision: variantOutcome.revision,
        variant: variantOutcome.variant
      });
    }
  });
}
