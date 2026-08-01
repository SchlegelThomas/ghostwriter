import {
  instructionContentHash,
  type InstructionContentHash
} from "./agent-domain.js";
import type {
  AgentProposalRepository,
  ContextReceiptRepository
} from "./agent-foundation-repository.js";
import {
  AgentProposalContentMismatchError,
  AgentProposalNotFoundError,
  AgentProposalStateConflictError,
  AgentReceiptNotFoundError,
  type AgentProposal
} from "./agent-runs-proposals.js";
import type { CaptureDocumentRepository } from "./capture-document-repository.js";
import {
  CaptureNotFoundError,
  type CaptureDocumentHead
} from "./capture-documents.js";
import type {
  BackdropFieldsV1,
  CharacterSheetFieldsV1,
  SketchFieldsV1
} from "./craft-partner-schemas.js";
import {
  DomainValidationError,
  createCharacterSheet,
  createSceneSketch,
  type AgentProposalId,
  type ProjectId,
  type Scene,
  type SceneId,
  type SceneSketch,
  type StoryKnowledge
} from "./domain.js";
import {
  ProjectAccessDeniedError,
  requireProjectOwner,
  type AccountId
} from "./identity.js";
import type { ProjectCommandServices } from "./project-commands.js";
import type { Clock, ProjectRepository } from "./project-repository.js";
import type { ProjectNavigator } from "./project-navigator.js";

export type ApplyCraftProposalInput = Readonly<{
  accountId: AccountId;
  projectId: ProjectId;
  proposalId: AgentProposalId;
  expectedProposalContentHash: InstructionContentHash | string;
  expectedProjectVersion: number;
}>;

export type ApplyCraftProposalResult = Readonly<{
  mode: "craft-fields";
  proposal: AgentProposal;
  project: ProjectNavigator;
}>;

export type CraftProposalApplyServiceDependencies = Readonly<{
  projects: ProjectRepository;
  captureDocuments: CaptureDocumentRepository;
  proposals: AgentProposalRepository;
  receipts: ContextReceiptRepository;
  projectCommands: ProjectCommandServices;
  clock: Clock;
}>;

export type CraftProposalApplyServices = Readonly<{
  applyCraftProposal(input: ApplyCraftProposalInput): Promise<ApplyCraftProposalResult>;
}>;

function assertProposalMarkApplied(
  outcome: Awaited<ReturnType<AgentProposalRepository["markApplied"]>>
): AgentProposal {
  if (outcome.ok) return outcome.proposal;
  if (outcome.reason === "not-found" || outcome.reason === "cross-project") {
    throw new AgentProposalNotFoundError();
  }
  throw new AgentProposalStateConflictError();
}

async function requireOwnedReadyCraftProposal(
  dependencies: CraftProposalApplyServiceDependencies,
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
  if (
    proposal.outputSchemaId !== "sketch-fields-v1" &&
    proposal.outputSchemaId !== "character-sheet-v1" &&
    proposal.outputSchemaId !== "backdrop-fields-v1"
  ) {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "Proposal output schema is not a craft partner schema."
    );
  }
  return proposal;
}

async function requireMatchingCaptureBase(
  dependencies: CraftProposalApplyServiceDependencies,
  proposal: AgentProposal
): Promise<CaptureDocumentHead | undefined> {
  if (proposal.baseCaptureId === undefined) {
    return undefined;
  }
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

function mergeSketch(
  existing: SceneSketch | undefined,
  delta: SketchFieldsV1
): SceneSketch {
  return createSceneSketch({
    ...(existing ?? {}),
    ...(delta.purpose === undefined ? {} : { purpose: delta.purpose }),
    ...(delta.conflict === undefined ? {} : { conflict: delta.conflict }),
    ...(delta.turn === undefined ? {} : { turn: delta.turn }),
    ...(delta.sensoryNotes === undefined ? {} : { sensoryNotes: delta.sensoryNotes }),
    ...(delta.openQuestions === undefined
      ? {}
      : { openQuestions: delta.openQuestions }),
    ...(delta.detail === undefined ? {} : { detail: delta.detail })
  });
}

function resolveSceneTarget(
  receiptSceneId: SceneId | undefined,
  payloadSceneId: SceneId | undefined
): SceneId {
  const sceneId = payloadSceneId ?? receiptSceneId;
  if (sceneId === undefined) {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "Craft proposal is missing a scene target."
    );
  }
  if (
    receiptSceneId !== undefined &&
    payloadSceneId !== undefined &&
    receiptSceneId !== payloadSceneId
  ) {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "Craft proposal scene target does not match the context receipt."
    );
  }
  return sceneId;
}

async function requireOwnedScene(
  dependencies: CraftProposalApplyServiceDependencies,
  projectId: ProjectId,
  sceneId: SceneId
): Promise<Scene> {
  const scene = (await dependencies.projects.listScenes(projectId)).find(
    (candidate) => candidate.id === sceneId && candidate.projectId === projectId
  );
  if (scene === undefined || scene.archivedAt !== undefined) {
    throw new DomainValidationError(
      "UNKNOWN_REFERENCE",
      "The craft proposal scene target was not found."
    );
  }
  return scene;
}

async function requireOwnedCharacter(
  dependencies: CraftProposalApplyServiceDependencies,
  projectId: ProjectId,
  storyKnowledgeId: StoryKnowledge["id"]
): Promise<StoryKnowledge> {
  const record = (await dependencies.projects.listStoryKnowledge(projectId)).find(
    (candidate) =>
      candidate.id === storyKnowledgeId && candidate.projectId === projectId
  );
  if (record === undefined || record.archivedAt !== undefined) {
    throw new DomainValidationError(
      "UNKNOWN_REFERENCE",
      "The craft proposal cast target was not found."
    );
  }
  return record;
}

export function createCraftProposalApplyServices(
  dependencies: CraftProposalApplyServiceDependencies
): CraftProposalApplyServices {
  return Object.freeze({
    async applyCraftProposal(input): Promise<ApplyCraftProposalResult> {
      const proposal = await requireOwnedReadyCraftProposal(
        dependencies,
        input.accountId,
        input.projectId,
        input.proposalId,
        input.expectedProposalContentHash
      );
      await requireMatchingCaptureBase(dependencies, proposal);
      const receipt = await dependencies.receipts.get(proposal.receiptId);
      if (receipt === undefined || receipt.projectId !== input.projectId) {
        throw new AgentReceiptNotFoundError();
      }

      let project: ProjectNavigator;

      if (proposal.outputSchemaId === "sketch-fields-v1") {
        const payload = proposal.payload as SketchFieldsV1;
        const targetSceneId = resolveSceneTarget(receipt.targetSceneId, undefined);
        const scene = await requireOwnedScene(
          dependencies,
          input.projectId,
          targetSceneId
        );
        project = await dependencies.projectCommands.executeProjectCommand({
          accountId: input.accountId,
          projectId: input.projectId,
          expectedVersion: input.expectedProjectVersion,
          command: {
            type: "scene.update",
            sceneId: scene.id,
            sketch: mergeSketch(scene.sketch, payload)
          }
        });
      } else if (proposal.outputSchemaId === "character-sheet-v1") {
        const payload = proposal.payload as CharacterSheetFieldsV1;
        if (
          receipt.targetStoryKnowledgeId !== undefined &&
          receipt.targetStoryKnowledgeId !== payload.storyKnowledgeId
        ) {
          throw new DomainValidationError(
            "INVALID_AGENT_POLICY",
            "Character Coach proposal target does not match the context receipt."
          );
        }
        const existing = await requireOwnedCharacter(
          dependencies,
          input.projectId,
          payload.storyKnowledgeId
        );
        const sheet = createCharacterSheet({
          ...(existing.characterSheet ?? {}),
          ...(payload.desire === undefined ? {} : { desire: payload.desire }),
          ...(payload.pressure === undefined ? {} : { pressure: payload.pressure }),
          ...(payload.voiceNotes === undefined
            ? {}
            : { voiceNotes: payload.voiceNotes })
        });
        project = await dependencies.projectCommands.executeProjectCommand({
          accountId: input.accountId,
          projectId: input.projectId,
          expectedVersion: input.expectedProjectVersion,
          command: {
            type: "storyKnowledge.update",
            storyKnowledgeId: payload.storyKnowledgeId,
            characterSheet: sheet
          }
        });
      } else {
        const payload = proposal.payload as BackdropFieldsV1;
        const targetSceneId = resolveSceneTarget(
          receipt.targetSceneId,
          payload.sceneId
        );
        const scene = await requireOwnedScene(
          dependencies,
          input.projectId,
          targetSceneId
        );
        if (payload.caption !== undefined && scene.backdrop !== undefined) {
          project = await dependencies.projectCommands.executeProjectCommand({
            accountId: input.accountId,
            projectId: input.projectId,
            expectedVersion: input.expectedProjectVersion,
            command: {
              type: "scene.update",
              sceneId: scene.id,
              backdrop: {
                ...scene.backdrop,
                caption: payload.caption
              }
            }
          });
        } else {
          const sensory =
            payload.sensoryNotesFallback ?? payload.caption;
          if (sensory === undefined) {
            throw new DomainValidationError(
              "INVALID_AGENT_POLICY",
              "Backdrop proposal has no applyable craft fields."
            );
          }
          project = await dependencies.projectCommands.executeProjectCommand({
            accountId: input.accountId,
            projectId: input.projectId,
            expectedVersion: input.expectedProjectVersion,
            command: {
              type: "scene.update",
              sceneId: scene.id,
              sketch: mergeSketch(scene.sketch, {
                schemaId: "sketch-fields-v1",
                sensoryNotes: sensory
              })
            }
          });
        }
      }

      const now = dependencies.clock.now();
      const applied = assertProposalMarkApplied(
        await dependencies.proposals.markApplied({
          proposalId: proposal.id,
          projectId: proposal.projectId,
          expectedStatus: "ready",
          actorAccountId: input.accountId,
          appliedAt: now,
          updatedAt: now
        })
      );

      return Object.freeze({
        mode: "craft-fields" as const,
        proposal: applied,
        project
      });
    }
  });
}
