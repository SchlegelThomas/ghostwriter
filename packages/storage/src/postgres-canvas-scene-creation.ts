import {
  CanvasVersionConflictError,
  DomainValidationError,
  ProjectVersionConflictError,
  requireProjectOwner,
  validateCanvasBoardReferences,
  validateProjectRecords,
  type CanvasSceneCreationUnitOfWork,
  type CommitCanvasSceneCreationInput
} from "@ghostwriter/core";
import type { RepositoryDatabase } from "./client.js";
import { createPostgresCanvasRepository } from "./postgres-canvas-repository.js";
import { createPostgresProjectRepository } from "./postgres-project-repository.js";
import { createPostgresSceneDocumentRepository } from "./postgres-scene-document-repository.js";

function validateInput(input: CommitCanvasSceneCreationInput): void {
  validateProjectRecords(input.projectRecords);
  validateCanvasBoardReferences(
    input.canvasMutation.board,
    input.projectRecords
  );
  if (
    input.projectRecords.project.version !==
    input.expectedProjectVersion + 1
  ) {
    throw new DomainValidationError(
      "INVALID_VERSION",
      "Canvas scene creation must increment the project version exactly once."
    );
  }
  if (
    input.canvasMutation.board.version !== input.expectedCanvasVersion + 1
  ) {
    throw new DomainValidationError(
      "INVALID_VERSION",
      "Canvas scene creation must increment the Canvas version exactly once."
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
      "Canvas scene creation must initialize the scene added to the project."
    );
  }
}

export function createPostgresCanvasSceneCreationUnitOfWork(
  db: RepositoryDatabase
): CanvasSceneCreationUnitOfWork {
  return Object.freeze({
    async commitSceneFromCanvas(
      input: CommitCanvasSceneCreationInput
    ): Promise<void> {
      validateInput(input);
      await db.transaction(async (transaction) => {
        const exec = transaction as unknown as RepositoryDatabase;
        const projects = createPostgresProjectRepository(exec);
        const canvases = createPostgresCanvasRepository(exec);
        const sceneDocuments = createPostgresSceneDocumentRepository(exec);

        requireProjectOwner(
          input.projectRecords.project.id,
          await projects.getProjectMembership(
            input.projectRecords.project.id,
            input.accountId
          )
        );
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
        const currentCanvas = await canvases.getBoard(
          input.projectRecords.project.id
        );
        if (
          currentCanvas === undefined ||
          currentCanvas.version !== input.expectedCanvasVersion
        ) {
          throw new CanvasVersionConflictError(
            input.projectRecords.project.id,
            input.expectedCanvasVersion
          );
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

        await projects.transaction((writer) => {
          writer.replaceProjectRecords(
            input.projectRecords,
            input.expectedProjectVersion
          );
        });
        await sceneDocuments.initialize(input.sceneDocument);
        await canvases.replace({
          mutation: input.canvasMutation,
          expectedCanvasVersion: input.expectedCanvasVersion
        });
      });
    }
  });
}
