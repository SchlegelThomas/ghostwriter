import { serializeCanonicalSceneDocument } from "@ghostwriter/editor";
import type { BookId, ProjectId, SceneId } from "./domain.js";
import type { CanvasBoard } from "./canvas.js";
import {
  ProjectAccessDeniedError,
  requireProjectOwner,
  type AccountId
} from "./identity.js";
import type { CanvasRepository } from "./canvas-repository.js";
import {
  buildBookReaderProjection,
  BookNotFoundError,
  BookReaderTooLargeError,
  BOOK_READER_MAX_SCENES,
  type BookReaderProjection
} from "./book-reader.js";
import { loadProjectRecords } from "./project-services.js";
import { projectNavigatorFromRecords } from "./project-navigator.js";
import type { ProjectRepository } from "./project-repository.js";
import type { SceneDocumentRepository } from "./scene-document-repository.js";
import type { SceneDocumentHead } from "./scene-documents.js";

export const BOOK_READER_MAX_PAYLOAD_BYTES = 4 * 1_024 * 1_024;

export type BookReaderServices = Readonly<{
  getBookReader(input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
    bookId: BookId;
    pinSceneId?: SceneId;
  }>): Promise<BookReaderProjection>;
}>;

export type BookReaderServiceDependencies = Readonly<{
  projects: ProjectRepository;
  sceneDocuments: SceneDocumentRepository;
  canvases: CanvasRepository;
}>;

async function loadCanvasBoard(
  dependencies: BookReaderServiceDependencies,
  projectId: ProjectId
): Promise<CanvasBoard | undefined> {
  const board = await dependencies.canvases.getBoard(projectId);
  return board;
}

function headsToInputs(
  heads: ReadonlyMap<SceneId, SceneDocumentHead>
): ReadonlyMap<
  SceneId,
  Readonly<{
    document: SceneDocumentHead["document"];
    workingVersion: number;
    contentHash?: SceneDocumentHead["contentHash"];
  }>
> {
  const inputs = new Map<
    SceneId,
    Readonly<{
      document: SceneDocumentHead["document"];
      workingVersion: number;
      contentHash?: SceneDocumentHead["contentHash"];
    }>
  >();
  for (const [sceneId, head] of heads) {
    inputs.set(sceneId, {
      document: head.document,
      workingVersion: head.workingVersion,
      contentHash: head.contentHash
    });
  }
  return inputs;
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function assertPayloadWithinBounds(projection: BookReaderProjection): void {
  const bytes = utf8ByteLength(
    JSON.stringify({
      scenes: projection.scenes.map((scene) => ({
        sceneId: scene.sceneId,
        document: serializeCanonicalSceneDocument(scene.document)
      }))
    })
  );
  if (bytes > BOOK_READER_MAX_PAYLOAD_BYTES) {
    throw new BookReaderTooLargeError();
  }
}

export function createBookReaderServices(
  dependencies: BookReaderServiceDependencies
): BookReaderServices {
  return Object.freeze({
    async getBookReader(input): Promise<BookReaderProjection> {
      requireProjectOwner(
        input.projectId,
        await dependencies.projects.getProjectMembership(
          input.projectId,
          input.accountId
        )
      );
      const records = await loadProjectRecords(
        dependencies.projects,
        input.projectId
      );
      if (records === undefined) {
        throw new BookNotFoundError();
      }

      const navigator = projectNavigatorFromRecords(records);
      const book = navigator.books.find((candidate) => candidate.id === input.bookId);
      if (book === undefined || book.archivedAt !== undefined) {
        throw new BookNotFoundError();
      }

      const sceneIds = [
        ...book.parts.flatMap((part) =>
          part.chapters.flatMap((chapter) =>
            chapter.scenes
              .filter((scene) => scene.archivedAt === undefined)
              .map((scene) => scene.id)
          )
        ),
        ...book.unassignedScenes
          .filter((scene) => scene.archivedAt === undefined)
          .map((scene) => scene.id)
      ];
      if (sceneIds.length > BOOK_READER_MAX_SCENES) {
        throw new BookReaderTooLargeError();
      }

      const [heads, board] = await Promise.all([
        dependencies.sceneDocuments.getHeads(sceneIds),
        loadCanvasBoard(dependencies, input.projectId)
      ]);

      const projection = buildBookReaderProjection({
        navigator,
        bookId: input.bookId,
        heads: headsToInputs(heads),
        ...(board === undefined ? {} : { board }),
        ...(input.pinSceneId === undefined ? {} : { pinSceneId: input.pinSceneId })
      });
      if (projection === undefined) {
        throw new BookNotFoundError();
      }

      assertPayloadWithinBounds(projection);
      return projection;
    }
  });
}

export { ProjectAccessDeniedError, BookNotFoundError, BookReaderTooLargeError };
