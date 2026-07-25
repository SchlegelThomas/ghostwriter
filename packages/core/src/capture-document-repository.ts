import type { CaptureId, CaptureRevisionId, ProjectId, SceneId } from "./domain.js";
import type { AccountId } from "./identity.js";
import type {
  CaptureContentHash,
  CaptureDocumentHead,
  CaptureRevision,
  CaptureSummary
} from "./capture-documents.js";
import type { SceneDocumentV1 } from "@ghostwriter/editor";

export type SaveWorkingCaptureDocumentOutcome =
  | Readonly<{ ok: true; head: CaptureDocumentHead }>
  | Readonly<{
      ok: false;
      reason:
        | "working-version-conflict"
        | "capture-integrated"
        | "capture-archived";
    }>;

export type SetCaptureArchivedOutcome =
  | Readonly<{ ok: true; head: CaptureDocumentHead }>
  | Readonly<{
      ok: false;
      reason: "not-found" | "capture-integrated";
    }>;

export type InitializeCaptureDocumentInput = Readonly<{
  head: CaptureDocumentHead;
  genesisRevision: CaptureRevision;
}>;

export type SaveWorkingCaptureDocumentInput = Readonly<{
  projectId: ProjectId;
  captureId: CaptureId;
  expectedWorkingVersion: number;
  document: SceneDocumentV1;
  contentHash: CaptureContentHash;
  actorAccountId: AccountId;
  now: string;
}>;

export type SetCaptureArchivedInput = Readonly<{
  projectId: ProjectId;
  captureId: CaptureId;
  archived: boolean;
  actorAccountId: AccountId;
  now: string;
}>;

export type IntegrateCaptureDocumentInput = Readonly<{
  projectId: ProjectId;
  captureId: CaptureId;
  expectedWorkingVersion: number;
  expectedContentHash: CaptureContentHash;
  integrationRevision: CaptureRevision;
  integratedSceneId: SceneId;
  actorAccountId: AccountId;
  now: string;
}>;

export type IntegrateCaptureDocumentOutcome =
  | Readonly<{ ok: true; head: CaptureDocumentHead; revision: CaptureRevision }>
  | Readonly<{
      ok: false;
      reason:
        | "not-found"
        | "working-version-conflict"
        | "content-hash-mismatch"
        | "capture-integrated"
        | "capture-archived";
    }>;

export type ListCapturesOptions = Readonly<{
  includeArchived?: boolean;
}>;

export interface CaptureDocumentRepository {
  get(captureId: CaptureId): Promise<CaptureDocumentHead | undefined>;
  getRevision(
    revisionId: CaptureRevisionId
  ): Promise<CaptureRevision | undefined>;
  list(
    projectId: ProjectId,
    options?: ListCapturesOptions
  ): Promise<readonly CaptureSummary[]>;
  initialize(input: InitializeCaptureDocumentInput): Promise<CaptureDocumentHead>;
  saveWorkingDocument(
    input: SaveWorkingCaptureDocumentInput
  ): Promise<SaveWorkingCaptureDocumentOutcome>;
  setArchived(input: SetCaptureArchivedInput): Promise<SetCaptureArchivedOutcome>;
  integrate(
    input: IntegrateCaptureDocumentInput
  ): Promise<IntegrateCaptureDocumentOutcome>;
}
