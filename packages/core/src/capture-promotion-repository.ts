import type { CanvasMutationResult } from "./canvas.js";
import type { IntegrateCaptureDocumentInput } from "./capture-document-repository.js";
import type { ProjectRecords } from "./domain.js";
import type { AccountId } from "./identity.js";
import type { InitializeSceneDocumentInput } from "./scene-document-repository.js";

export type CommitCaptureScenePromotionInput = Readonly<{
  accountId: AccountId;
  projectRecords: ProjectRecords;
  expectedProjectVersion: number;
  sceneDocument: InitializeSceneDocumentInput;
  captureIntegration: IntegrateCaptureDocumentInput;
  canvasMutation?: CanvasMutationResult;
  expectedCanvasVersion?: number;
}>;

/**
 * One platform-neutral transaction boundary for promoting an acknowledged Capture
 * into canonical scene metadata, scene genesis, integration provenance, and
 * optional Canvas placement.
 */
export interface CaptureScenePromotionUnitOfWork {
  commitCaptureScenePromotion(
    input: CommitCaptureScenePromotionInput
  ): Promise<void>;
}
