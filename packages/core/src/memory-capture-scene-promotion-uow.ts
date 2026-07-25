import {
  validateCanvasBoardReferences,
  CanvasVersionConflictError
} from "./canvas.js";
import type { CanvasRepository } from "./canvas-repository.js";
import type {
  CaptureDocumentRepository,
  IntegrateCaptureDocumentOutcome
} from "./capture-document-repository.js";
import {
  CaptureArchivedMutationError,
  CaptureContentHashMismatchError,
  CaptureIntegratedMutationError,
  CaptureNotFoundError,
  CaptureVersionConflictError
} from "./capture-documents.js";
import type {
  CaptureScenePromotionUnitOfWork,
  CommitCaptureScenePromotionInput
} from "./capture-promotion-repository.js";
import { DomainValidationError, validateProjectRecords } from "./domain.js";
import { requireProjectOwner } from "./identity.js";
import {
  ProjectVersionConflictError,
  type ProjectRepository
} from "./project-repository.js";
import type { SceneDocumentRepository } from "./scene-document-repository.js";
import {
  MEMORY_TRANSACTION_STATE,
  type MemoryTransactionalRepository
} from "./memory-transaction.js";

async function revalidateCaptureForPromotion(
  captureDocuments: CaptureDocumentRepository,
  input: CommitCaptureScenePromotionInput
): Promise<void> {
  const captureHead = await captureDocuments.get(input.captureIntegration.captureId);
  if (
    captureHead === undefined ||
    captureHead.projectId !== input.captureIntegration.projectId
  ) {
    throw new CaptureNotFoundError();
  }
  if (captureHead.status === "integrated") {
    throw new CaptureIntegratedMutationError();
  }
  if (captureHead.status === "archived") {
    throw new CaptureArchivedMutationError();
  }
  if (
    captureHead.workingVersion !==
    input.captureIntegration.expectedWorkingVersion
  ) {
    throw new CaptureVersionConflictError();
  }
  if (captureHead.contentHash !== input.captureIntegration.expectedContentHash) {
    throw new CaptureContentHashMismatchError();
  }
}

function assertCombinedPromotion(
  input: CommitCaptureScenePromotionInput,
  currentProjectVersion: number,
  currentCanvasVersion: number | undefined
): void {
  validateProjectRecords(input.projectRecords);
  if (input.projectRecords.project.version !== currentProjectVersion + 1) {
    throw new DomainValidationError(
      "INVALID_VERSION",
      "Capture promotion must increment the project version exactly once."
    );
  }
  if (
    input.sceneDocument.head.projectId !== input.projectRecords.project.id ||
    input.sceneDocument.genesisRevision.projectId !==
      input.projectRecords.project.id ||
    input.sceneDocument.head.sceneId !==
      input.sceneDocument.genesisRevision.sceneId ||
    !input.projectRecords.scenes.some(
      (scene) => scene.id === input.sceneDocument.head.sceneId
    )
  ) {
    throw new DomainValidationError(
      "UNKNOWN_REFERENCE",
      "Capture promotion must initialize the scene added to the project."
    );
  }
  if (
    input.captureIntegration.integratedSceneId !==
    input.sceneDocument.head.sceneId
  ) {
    throw new DomainValidationError(
      "UNKNOWN_REFERENCE",
      "Capture integration must target the promoted scene."
    );
  }

  const hasCanvas = input.canvasMutation !== undefined;
  if (hasCanvas !== (input.expectedCanvasVersion !== undefined)) {
    throw new DomainValidationError(
      "UNKNOWN_REFERENCE",
      "Capture promotion Canvas expectations must match the supplied mutation."
    );
  }
  if (hasCanvas && input.canvasMutation !== undefined) {
    if (currentCanvasVersion === undefined) {
      throw new DomainValidationError(
        "UNKNOWN_REFERENCE",
        "Capture promotion with Canvas requires an initialized board."
      );
    }
    validateCanvasBoardReferences(
      input.canvasMutation.board,
      input.projectRecords
    );
    if (input.canvasMutation.board.version !== currentCanvasVersion + 1) {
      throw new DomainValidationError(
        "INVALID_VERSION",
        "Capture promotion must increment the Canvas version exactly once."
      );
    }
  }
}

function assertIntegrationApplied(outcome: IntegrateCaptureDocumentOutcome): void {
  if (outcome.ok) return;
  switch (outcome.reason) {
    case "not-found":
      throw new CaptureNotFoundError();
    case "working-version-conflict":
      throw new CaptureVersionConflictError();
    case "content-hash-mismatch":
      throw new CaptureContentHashMismatchError();
    case "capture-integrated":
      throw new CaptureIntegratedMutationError();
    case "capture-archived":
      throw new CaptureArchivedMutationError();
    default: {
      const exhaustive: never = outcome.reason;
      throw exhaustive;
    }
  }
}

export function createMemoryCaptureScenePromotionUnitOfWork(dependencies: {
  projects: ProjectRepository;
  sceneDocuments: SceneDocumentRepository;
  captureDocuments: CaptureDocumentRepository;
  canvases?: CanvasRepository;
}): CaptureScenePromotionUnitOfWork {
  let transactionTail: Promise<void> = Promise.resolve();
  const repositoryParticipants = [
    dependencies.projects,
    dependencies.sceneDocuments,
    dependencies.captureDocuments,
    ...(dependencies.canvases === undefined ? [] : [dependencies.canvases])
  ];
  const participants = repositoryParticipants.map((repository) => {
    const participant = (repository as MemoryTransactionalRepository)[
      MEMORY_TRANSACTION_STATE
    ];
    if (participant === undefined) {
      throw new Error(
        "Memory capture promotion requires memory repository participants."
      );
    }
    return participant;
  });

  return Object.freeze({
    async commitCaptureScenePromotion(
      input: CommitCaptureScenePromotionInput
    ): Promise<void> {
      const previous = transactionTail;
      let release = (): void => undefined;
      transactionTail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      const snapshots = participants.map((participant) =>
        participant.snapshot()
      );

      try {
        requireProjectOwner(
          input.projectRecords.project.id,
          await dependencies.projects.getProjectMembership(
            input.projectRecords.project.id,
            input.accountId
          )
        );
        await revalidateCaptureForPromotion(
          dependencies.captureDocuments,
          input
        );
        const currentProject = await dependencies.projects.getProject(
          input.projectRecords.project.id
        );
        if (
          currentProject === undefined ||
          currentProject.version !== input.expectedProjectVersion
        ) {
          throw new ProjectVersionConflictError(
            input.projectRecords.project.id,
            input.expectedProjectVersion
          );
        }

        let currentCanvasVersion: number | undefined;
        if (input.canvasMutation !== undefined) {
          if (dependencies.canvases === undefined) {
            throw new Error(
              "Capture promotion with Canvas requires a Canvas repository."
            );
          }
          const currentCanvas = await dependencies.canvases.getBoard(
            input.projectRecords.project.id
          );
          if (
            currentCanvas === undefined ||
            currentCanvas.version !== input.expectedCanvasVersion
          ) {
            throw new CanvasVersionConflictError(
              input.projectRecords.project.id,
              input.expectedCanvasVersion ?? currentCanvas?.version ?? 0
            );
          }
          currentCanvasVersion = currentCanvas.version;
          if (
            (await dependencies.canvases.getRevision(
              input.projectRecords.project.id,
              input.canvasMutation.revision.id
            )) !== undefined
          ) {
            throw new DomainValidationError(
              "DUPLICATE_ID",
              "The Canvas revision already exists."
            );
          }
        }

        if (
          (await dependencies.sceneDocuments.getHead(
            input.sceneDocument.head.sceneId
          )) !== undefined
        ) {
          throw new DomainValidationError(
            "DUPLICATE_ID",
            "The scene document already exists."
          );
        }

        assertCombinedPromotion(
          input,
          currentProject.version,
          currentCanvasVersion
        );

        await dependencies.projects.transaction((writer) => {
          writer.replaceProjectRecords(
            input.projectRecords,
            input.expectedProjectVersion
          );
        });
        await dependencies.sceneDocuments.initialize(input.sceneDocument);
        const integrationOutcome = await dependencies.captureDocuments.integrate(
          input.captureIntegration
        );
        assertIntegrationApplied(integrationOutcome);

        if (
          input.canvasMutation !== undefined &&
          input.expectedCanvasVersion !== undefined &&
          dependencies.canvases !== undefined
        ) {
          await dependencies.canvases.replace({
            mutation: input.canvasMutation,
            expectedCanvasVersion: input.expectedCanvasVersion
          });
        }
      } catch (error) {
        participants.forEach((participant, index) => {
          participant.restore(snapshots[index]);
        });
        throw error;
      } finally {
        release();
      }
    }
  });
}
