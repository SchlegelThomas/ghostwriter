import type {
  CanvasBoard,
  CanvasMutationResult,
  CanvasRevision,
  CanvasRevisionMetadata,
  CanvasViewportPreference
} from "./canvas.js";
import type { ProjectId, ProjectRecords } from "./domain.js";
import type { AccountId } from "./identity.js";
import type { InitializeSceneDocumentInput } from "./scene-document-repository.js";

export interface CanvasRepository {
  getBoard(projectId: ProjectId): Promise<CanvasBoard | undefined>;
  initialize(input: CanvasMutationResult): Promise<CanvasBoard>;
  replace(input: {
    mutation: CanvasMutationResult;
    expectedCanvasVersion: number;
  }): Promise<CanvasBoard>;
  getRevision(
    projectId: ProjectId,
    revisionId: CanvasRevision["id"]
  ): Promise<CanvasRevision | undefined>;
  listRevisions(projectId: ProjectId): Promise<readonly CanvasRevisionMetadata[]>;
  getViewportPreference(
    projectId: ProjectId,
    accountId: AccountId
  ): Promise<CanvasViewportPreference | undefined>;
  saveViewportPreference(
    preference: CanvasViewportPreference
  ): Promise<CanvasViewportPreference>;
}

export type CommitCanvasSceneCreationInput = Readonly<{
  accountId: AccountId;
  projectRecords: ProjectRecords;
  expectedProjectVersion: number;
  sceneDocument: InitializeSceneDocumentInput;
  canvasMutation: CanvasMutationResult;
  expectedCanvasVersion: number;
}>;

/**
 * One platform-neutral transaction boundary for the only mutation that spans
 * project metadata, a scene document genesis, and Canvas state.
 */
export interface CanvasSceneCreationUnitOfWork {
  commitSceneFromCanvas(input: CommitCanvasSceneCreationInput): Promise<void>;
}
