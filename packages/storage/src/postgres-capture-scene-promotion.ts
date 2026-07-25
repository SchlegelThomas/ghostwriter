import {
  CanvasVersionConflictError,
  CaptureArchivedMutationError,
  CaptureContentHashMismatchError,
  CaptureIntegratedMutationError,
  CaptureNotFoundError,
  CaptureVersionConflictError,
  DomainValidationError,
  ProjectVersionConflictError,
  requireProjectOwner,
  validateCanvasBoardReferences,
  validateProjectRecords,
  type CaptureScenePromotionUnitOfWork,
  type CommitCaptureScenePromotionInput,
  type IntegrateCaptureDocumentOutcome
} from "@ghostwriter/core";
import type { RepositoryDatabase } from "./client.js";
import { createPostgresCanvasRepository } from "./postgres-canvas-repository.js";
import { createPostgresCaptureDocumentRepository } from "./postgres-capture-document-repository.js";
import { createPostgresProjectRepository } from "./postgres-project-repository.js";
import { createPostgresSceneDocumentRepository } from "./postgres-scene-document-repository.js";

async function revalidateCaptureForPromotion(
  captureDocuments: ReturnType<typeof createPostgresCaptureDocumentRepository>,
  input: CommitCaptureScenePromotionInput
): Promise<void> {
  const captureHead = await captureDocuments.get(
    input.captureIntegration.captureId
  );
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
  if (
    captureHead.contentHash !== input.captureIntegration.expectedContentHash
  ) {
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

function assertIntegrationApplied(
  outcome: IntegrateCaptureDocumentOutcome
): void {
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

export function createPostgresCaptureScenePromotionUnitOfWork(
  db: RepositoryDatabase
): CaptureScenePromotionUnitOfWork {
  return Object.freeze({
    async commitCaptureScenePromotion(
      input: CommitCaptureScenePromotionInput
    ): Promise<void> {
      await db.transaction(async (transaction) => {
        const exec = transaction as unknown as RepositoryDatabase;
        const projects = createPostgresProjectRepository(exec);
        const sceneDocuments = createPostgresSceneDocumentRepository(exec);
        const captureDocuments = createPostgresCaptureDocumentRepository(exec);
        const canvases = createPostgresCanvasRepository(exec);

        requireProjectOwner(
          input.projectRecords.project.id,
          await projects.getProjectMembership(
            input.projectRecords.project.id,
            input.accountId
          )
        );
        await revalidateCaptureForPromotion(captureDocuments, input);
        const currentProject = await projects.getProject(
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
          const currentCanvas = await canvases.getBoard(
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
            (await canvases.getRevision(
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
          (await sceneDocuments.getHead(input.sceneDocument.head.sceneId)) !==
          undefined
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

        await projects.transaction((writer) => {
          writer.replaceProjectRecords(
            input.projectRecords,
            input.expectedProjectVersion
          );
        });
        await sceneDocuments.initialize(input.sceneDocument);
        const integrationOutcome = await captureDocuments.integrate(
          input.captureIntegration
        );
        assertIntegrationApplied(integrationOutcome);

        if (
          input.canvasMutation !== undefined &&
          input.expectedCanvasVersion !== undefined
        ) {
          await canvases.replace({
            mutation: input.canvasMutation,
            expectedCanvasVersion: input.expectedCanvasVersion
          });
        }
      });
    }
  });
}
