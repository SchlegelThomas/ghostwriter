import type {
  BookId,
  BookReaderProjection,
  CanvasBoard,
  CanvasCommand,
  CanvasObjectId,
  CanvasReadingOrderSpine,
  CanvasRevisionId,
  CanvasRevisionMetadata,
  CanvasViewportPreference,
  CatalogAgentEffort,
  CatalogAgentId,
  CatalogAgentPlaybook,
  CatalogPlaybookOverride,
  CatalogMemoLens,
  CaptureAttachmentAllowedMime,
  CaptureAttachmentRefusalCode,
  CaptureAttachmentState,
  ChapterId,
  ProjectCommand,
  ProjectNavigator,
  Scene,
  StoryProjectSummary,
  WriterProfile
} from "@ghostwriter/core";
import type {
  SceneDocumentComparison,
  SceneDocumentV1
} from "@ghostwriter/editor";

export type SessionAccount = Readonly<{
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
}>;

export type CurrentWriter = Readonly<{
  account: SessionAccount;
  profile: WriterProfile;
  session: Readonly<{ id: string; expiresAt: string }>;
}>;

export type SceneHeadResponse = Readonly<{
  sceneId: string;
  projectId: string;
  workingVersion: number;
  document: SceneDocumentV1;
  contentHash: string;
  checkpointRevisionId: string;
  updatedByAccountId: string;
  createdAt: string;
  updatedAt: string;
}>;

export type SceneLeaseResponse = Readonly<{
  heldByCurrentSession: boolean;
  renewedAt: string;
  expiresAt: string;
}>;

export type SceneWorkspaceResponse = Readonly<{
  head: SceneHeadResponse;
  lease: SceneLeaseResponse | null;
}>;

export type SceneHeadMetadataResponse = Readonly<
  Omit<SceneHeadResponse, "document">
>;

export type SceneRevisionReason =
  | "genesis"
  | "checkpoint"
  | "idle-checkpoint"
  | "restore"
  | "schema-migration";

export type SceneRevisionMetadataResponse = Readonly<{
  id: string;
  sceneId: string;
  projectId: string;
  parentRevisionId?: string;
  schemaVersion: number;
  contentHash: string;
  actorAccountId: string;
  origin: "human" | "agent" | "system";
  reason: SceneRevisionReason;
  createdAt: string;
}>;

export type SceneVariantResponse = Readonly<{
  id: string;
  sceneId: string;
  projectId: string;
  revisionId: string;
  creatorAccountId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}>;

export type SceneHistoryResponse = Readonly<{
  revisions: readonly SceneRevisionMetadataResponse[];
  variants: readonly SceneVariantResponse[];
}>;

export type SceneCheckpointResponse = Readonly<{
  head: SceneHeadMetadataResponse;
  revision: SceneRevisionMetadataResponse;
  created: boolean;
}>;

export type SceneVariantCreationResponse = Readonly<{
  head: SceneHeadMetadataResponse;
  revision: SceneRevisionMetadataResponse;
  variant: SceneVariantResponse;
  checkpointCreated: boolean;
}>;

export type SceneRevisionComparisonResponse = Readonly<{
  beforeRevision: SceneRevisionMetadataResponse;
  afterRevision: SceneRevisionMetadataResponse;
  comparison: SceneDocumentComparison;
}>;

export type SceneRevisionRestoreResponse = Readonly<{
  head: SceneHeadResponse;
  revision: SceneRevisionMetadataResponse;
}>;

export type SceneRequestScope = Readonly<{
  projectId: string;
  sceneId: string;
}>;

export type CaptureSourceModality = "text" | "dictation";

export type CaptureStatus = "draft" | "ready" | "integrated" | "archived";

export type CaptureIntegrationProvenanceResponse = Readonly<{
  integrationRevisionId: string;
  integratedSceneId: string;
  integratedAt: string;
  integratedByAccountId: string;
}>;

export type CaptureHeadResponse = Readonly<{
  captureId: string;
  projectId: string;
  status: CaptureStatus;
  sourceModality: CaptureSourceModality;
  workingVersion: number;
  document: SceneDocumentV1;
  contentHash: string;
  genesisRevisionId: string;
  authorAccountId: string;
  updatedByAccountId: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}> &
  Partial<CaptureIntegrationProvenanceResponse>;

export type CaptureSummaryResponse = Readonly<{
  captureId: string;
  projectId: string;
  status: CaptureStatus;
  sourceModality: CaptureSourceModality;
  workingVersion: number;
  authorAccountId: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}> &
  Partial<CaptureIntegrationProvenanceResponse>;

export type CaptureRequestScope = Readonly<{
  projectId: string;
  captureId: string;
}>;

export type { CaptureAttachmentAllowedMime, CaptureAttachmentRefusalCode, CaptureAttachmentState };

export type CaptureAttachmentSummaryResponse = Readonly<{
  attachmentId: string;
  captureId: string;
  projectId: string;
  state: CaptureAttachmentState;
  displayFilename: string;
  declaredContentType: CaptureAttachmentAllowedMime;
  declaredByteSize: number;
  createdAt: string;
  updatedAt: string;
  readyContentType?: CaptureAttachmentAllowedMime;
  actualByteSize?: number;
  pendingExpiresAt?: string;
  refusalCode?: CaptureAttachmentRefusalCode;
  readyAt?: string;
  deletedAt?: string;
}>;

export type CaptureAttachmentPresignedUrlResponse = Readonly<{
  url: string;
  expiresAt: string;
}>;

export type CaptureAttachmentInitUploadResponse = Readonly<{
  attachment: CaptureAttachmentSummaryResponse;
  upload: CaptureAttachmentPresignedUrlResponse;
  uploadHeaders: Readonly<{ "Content-Type": string }>;
}>;

export type CaptureAttachmentDownloadUrlResponse = Readonly<{
  download: CaptureAttachmentPresignedUrlResponse;
}>;

export type CaptureAttachmentRequestScope = CaptureRequestScope &
  Readonly<{ attachmentId: string }>;

export type CanvasBoardResponse = CanvasBoard;
export type CanvasObjectResponse = CanvasBoard["objects"][number];
export type CanvasLinkResponse = CanvasBoard["links"][number];
export type CanvasSpineResponse = CanvasReadingOrderSpine;
export type CanvasRevisionResponse = CanvasRevisionMetadata;
export type CanvasPreferenceResponse = CanvasViewportPreference;

export type CanvasWorkspaceResponse = Readonly<{
  board: CanvasBoardResponse;
  spine: CanvasSpineResponse;
}>;

export type CanvasHistoryResponse = Readonly<{
  revisions: readonly CanvasRevisionResponse[];
}>;

export type CanvasScenePlacementInput =
  | Readonly<{
      kind: "chapter";
      bookId: BookId;
      chapterId: ChapterId;
      position?: number;
    }>
  | Readonly<{
      kind: "unassigned";
      bookId: BookId;
      position?: number;
    }>;

export type CanvasSceneGeometryInput = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  parentRegionId?: CanvasObjectId;
  storyOrderHint?: number;
  label?: string;
  sourceKey?: string;
  provenance?: string;
}>;

export type CanvasSceneHandoffResponse = Readonly<{
  scene: Scene;
  sceneDocumentHead: SceneHeadResponse;
  navigator: ProjectNavigator;
  canvas: CanvasWorkspaceResponse;
}>;

export type PromoteCaptureManuscriptPlacementInput = CanvasScenePlacementInput;

export type PromoteCaptureCanvasInput = CanvasSceneGeometryInput &
  Readonly<{ expectedCanvasVersion: number }>;

export type PromoteCaptureToSceneResponse = Readonly<{
  captureHead: CaptureHeadResponse;
  scene: Scene;
  sceneDocumentHead: SceneHeadResponse;
  navigator: ProjectNavigator;
  canvas?: CanvasWorkspaceResponse;
}>;

export class GhostwriterApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "GhostwriterApiError";
    this.status = status;
    this.code = code;
  }
}

function apiUrl(path: string): string {
  const configuredOrigin = process.env.EXPO_PUBLIC_API_URL;
  if (configuredOrigin === undefined || configuredOrigin.length === 0) return path;
  return new URL(path, configuredOrigin).toString();
}

async function requestJson<Output>(
  path: string,
  init: RequestInit = {}
): Promise<Output> {
  const response = await fetch(apiUrl(path), {
    ...init,
    credentials: "include",
    headers: {
      accept: "application/json",
      ...init.headers
    }
  });
  if (response.ok && response.status === 204) {
    return undefined as Output;
  }
  const body = (await response.json().catch(() => ({}))) as {
    code?: string;
    error?: string;
  };
  if (!response.ok) {
    throw new GhostwriterApiError(
      response.status,
      body.code ?? "REQUEST_FAILED",
      body.error ?? "Ghostwriter could not complete the request."
    );
  }
  return body as Output;
}

function jsonRequest(
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  body?: unknown
): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  };
}

export function getCurrentWriter(): Promise<CurrentWriter> {
  return requestJson("/api/me");
}

export function updateWriterProfile(input: {
  displayName: string;
  publishing?: WriterProfile["publishing"] | null;
  expectedVersion: number;
}): Promise<Readonly<{ profile: WriterProfile }>> {
  return requestJson("/api/me/profile", jsonRequest("PATCH", input));
}

export async function beginGoogleSignIn(callbackURL: string): Promise<string> {
  const result = await requestJson<Readonly<{ url: string }>>(
    "/api/auth/sign-in/social",
    jsonRequest("POST", {
      provider: "google",
      callbackURL,
      newUserCallbackURL: callbackURL,
      errorCallbackURL: `${callbackURL}?authError=google`
    })
  );
  return result.url;
}

/** Signs into the fixed founder demo seed account. Password never reaches the client. */
export function signInDemoSeed(): Promise<Readonly<{ ok: true }>> {
  return requestJson("/api/demo/sign-in", jsonRequest("POST", {}));
}

export function signOut(): Promise<unknown> {
  return requestJson("/api/auth/sign-out", jsonRequest("POST", {}));
}

export async function listProjects(
  includeArchived = false
): Promise<readonly StoryProjectSummary[]> {
  const result = await requestJson<Readonly<{ projects: StoryProjectSummary[] }>>(
    `/api/projects${includeArchived ? "?includeArchived=true" : ""}`
  );
  return result.projects;
}

export function createProject(input: {
  title: string;
  firstBookTitle: string;
}): Promise<ProjectNavigator> {
  return requestJson("/api/projects", jsonRequest("POST", input));
}

export type BookReaderResponse = BookReaderProjection;

export function getBookReader(input: Readonly<{
  projectId: string;
  bookId: BookId;
  pinSceneId?: string;
}>): Promise<BookReaderResponse> {
  const params = new URLSearchParams();
  if (input.pinSceneId !== undefined) {
    params.set("pinSceneId", input.pinSceneId);
  }
  const query = params.toString();
  return requestJson(
    `/api/projects/${encodeURIComponent(input.projectId)}/books/${encodeURIComponent(input.bookId)}/reader${
      query.length > 0 ? `?${query}` : ""
    }`
  );
}

export function getProject(projectId: string): Promise<ProjectNavigator> {
  return requestJson(`/api/projects/${encodeURIComponent(projectId)}/navigator`);
}

export function executeProjectCommand(input: {
  projectId: string;
  expectedVersion: number;
  command: ProjectCommand;
}): Promise<ProjectNavigator> {
  return requestJson(
    `/api/projects/${encodeURIComponent(input.projectId)}/commands`,
    jsonRequest("POST", {
      expectedVersion: input.expectedVersion,
      command: input.command
    })
  );
}

function canvasPath(projectId: string, resource = ""): string {
  const suffix = resource.length === 0 ? "" : `/${resource}`;
  return `/api/projects/${encodeURIComponent(projectId)}/canvas${suffix}`;
}

export function getCanvasBoard(
  projectId: string
): Promise<CanvasWorkspaceResponse> {
  return requestJson(canvasPath(projectId));
}

export function executeCanvasCommand(input: {
  projectId: string;
  expectedCanvasVersion: number;
  command: CanvasCommand;
}): Promise<CanvasWorkspaceResponse> {
  return requestJson(
    canvasPath(input.projectId, "commands"),
    jsonRequest("POST", {
      expectedCanvasVersion: input.expectedCanvasVersion,
      command: input.command
    })
  );
}

export function getCanvasHistory(
  projectId: string
): Promise<CanvasHistoryResponse> {
  return requestJson(canvasPath(projectId, "history"));
}

export function undoCanvas(input: {
  projectId: string;
  expectedCanvasVersion: number;
}): Promise<CanvasWorkspaceResponse> {
  return requestJson(
    canvasPath(input.projectId, "history/restore"),
    jsonRequest("POST", {
      expectedCanvasVersion: input.expectedCanvasVersion
    })
  );
}

export function restoreCanvasRevision(input: {
  projectId: string;
  expectedCanvasVersion: number;
  revisionId: CanvasRevisionId;
}): Promise<CanvasWorkspaceResponse> {
  return requestJson(
    canvasPath(input.projectId, "history/restore"),
    jsonRequest("POST", {
      expectedCanvasVersion: input.expectedCanvasVersion,
      revisionId: input.revisionId
    })
  );
}

export async function getCanvasPreference(
  projectId: string
): Promise<CanvasPreferenceResponse | null> {
  const response = await requestJson<
    Readonly<{ preference: CanvasPreferenceResponse | null }>
  >(canvasPath(projectId, "preference"));
  return response.preference;
}

export async function saveCanvasPreference(input: {
  projectId: string;
  x: number;
  y: number;
  zoom: number;
  selectedObjectId?: CanvasObjectId | null;
}): Promise<CanvasPreferenceResponse> {
  const response = await requestJson<
    Readonly<{ preference: CanvasPreferenceResponse }>
  >(
    canvasPath(input.projectId, "preference"),
    jsonRequest("PUT", {
      x: input.x,
      y: input.y,
      zoom: input.zoom,
      ...(input.selectedObjectId === undefined
        ? {}
        : { selectedObjectId: input.selectedObjectId })
    })
  );
  return response.preference;
}

export function createSceneFromCanvas(input: {
  projectId: string;
  expectedProjectVersion: number;
  expectedCanvasVersion: number;
  title: string;
  manuscriptPlacement: CanvasScenePlacementInput;
  canvas: CanvasSceneGeometryInput;
}): Promise<CanvasSceneHandoffResponse> {
  return requestJson(
    canvasPath(input.projectId, "scenes"),
    jsonRequest("POST", {
      expectedProjectVersion: input.expectedProjectVersion,
      expectedCanvasVersion: input.expectedCanvasVersion,
      title: input.title,
      manuscriptPlacement: input.manuscriptPlacement,
      canvas: input.canvas
    })
  );
}

function scenePath(
  input: SceneRequestScope,
  resource:
    | "workspace"
    | "lease"
    | "body"
    | "history"
    | "checkpoints"
    | "variants"
    | "compare"
    | "restore"
): string {
  return (
    `/api/projects/${encodeURIComponent(input.projectId)}` +
    `/scenes/${encodeURIComponent(input.sceneId)}/${resource}`
  );
}

export function getSceneWorkspace(
  input: SceneRequestScope
): Promise<SceneWorkspaceResponse> {
  return requestJson(scenePath(input, "workspace"));
}

async function requestSceneLease(
  input: SceneRequestScope
): Promise<SceneLeaseResponse> {
  const result = await requestJson<Readonly<{ lease: SceneLeaseResponse }>>(
    scenePath(input, "lease"),
    { method: "POST" }
  );
  return result.lease;
}

export function acquireSceneLease(
  input: SceneRequestScope
): Promise<SceneLeaseResponse> {
  return requestSceneLease(input);
}

export function renewSceneLease(
  input: SceneRequestScope
): Promise<SceneLeaseResponse> {
  return requestSceneLease(input);
}

export function releaseSceneLease(input: SceneRequestScope): Promise<void> {
  return requestJson(scenePath(input, "lease"), {
    method: "DELETE",
    keepalive: true
  });
}

export async function saveSceneDocument(
  input: SceneRequestScope &
    Readonly<{
      expectedWorkingVersion: number;
      document: SceneDocumentV1;
    }>
): Promise<SceneHeadResponse> {
  const result = await requestJson<Readonly<{ head: SceneHeadResponse }>>(
    scenePath(input, "body"),
    jsonRequest("PATCH", {
      expectedWorkingVersion: input.expectedWorkingVersion,
      document: input.document
    })
  );
  return result.head;
}

export function getSceneHistory(
  input: SceneRequestScope
): Promise<SceneHistoryResponse> {
  return requestJson(scenePath(input, "history"));
}

export function createSceneCheckpoint(
  input: SceneRequestScope &
    Readonly<{ expectedWorkingVersion: number }>
): Promise<SceneCheckpointResponse> {
  return requestJson(
    scenePath(input, "checkpoints"),
    jsonRequest("POST", {
      expectedWorkingVersion: input.expectedWorkingVersion
    })
  );
}

export function createSceneVariant(
  input: SceneRequestScope &
    Readonly<{ expectedWorkingVersion: number; name: string }>
): Promise<SceneVariantCreationResponse> {
  return requestJson(
    scenePath(input, "variants"),
    jsonRequest("POST", {
      expectedWorkingVersion: input.expectedWorkingVersion,
      name: input.name
    })
  );
}

export function compareSceneRevisions(
  input: SceneRequestScope &
    Readonly<{ beforeRevisionId: string; afterRevisionId: string }>
): Promise<SceneRevisionComparisonResponse> {
  return requestJson(
    scenePath(input, "compare"),
    jsonRequest("POST", {
      beforeRevisionId: input.beforeRevisionId,
      afterRevisionId: input.afterRevisionId
    })
  );
}

export function restoreSceneRevision(
  input: SceneRequestScope &
    Readonly<{ expectedWorkingVersion: number; revisionId: string }>
): Promise<SceneRevisionRestoreResponse> {
  return requestJson(
    scenePath(input, "restore"),
    jsonRequest("POST", {
      expectedWorkingVersion: input.expectedWorkingVersion,
      revisionId: input.revisionId
    })
  );
}

function capturePath(
  projectId: string,
  captureId?: string,
  resource?: "body" | "archive" | "promote"
): string {
  const base = `/api/projects/${encodeURIComponent(projectId)}/captures`;
  if (captureId === undefined) return base;
  const scoped = `${base}/${encodeURIComponent(captureId)}`;
  if (resource === undefined) return scoped;
  return `${scoped}/${resource}`;
}

export async function createCapture(input: {
  projectId: string;
  sourceModality?: CaptureSourceModality;
}): Promise<CaptureHeadResponse> {
  const init =
    input.sourceModality === undefined || input.sourceModality === "text"
      ? ({ method: "POST" } satisfies RequestInit)
      : jsonRequest("POST", { sourceModality: input.sourceModality });
  const result = await requestJson<Readonly<{ head: CaptureHeadResponse }>>(
    capturePath(input.projectId),
    init
  );
  return result.head;
}

export async function listCaptures(
  projectId: string,
  includeArchived = false
): Promise<readonly CaptureSummaryResponse[]> {
  const result = await requestJson<
    Readonly<{ captures: CaptureSummaryResponse[] }>
  >(
    `${capturePath(projectId)}${includeArchived ? "?includeArchived=true" : ""}`
  );
  return result.captures;
}

export async function getCapture(
  input: CaptureRequestScope
): Promise<CaptureHeadResponse> {
  const result = await requestJson<Readonly<{ head: CaptureHeadResponse }>>(
    capturePath(input.projectId, input.captureId)
  );
  return result.head;
}

export async function saveCaptureDocument(
  input: CaptureRequestScope &
    Readonly<{
      expectedWorkingVersion: number;
      document: SceneDocumentV1;
    }>
): Promise<CaptureHeadResponse> {
  const result = await requestJson<Readonly<{ head: CaptureHeadResponse }>>(
    capturePath(input.projectId, input.captureId, "body"),
    jsonRequest("PATCH", {
      expectedWorkingVersion: input.expectedWorkingVersion,
      document: input.document
    })
  );
  return result.head;
}

export async function setCaptureArchived(
  input: CaptureRequestScope & Readonly<{ archived: boolean }>
): Promise<CaptureHeadResponse> {
  const result = await requestJson<Readonly<{ head: CaptureHeadResponse }>>(
    capturePath(input.projectId, input.captureId, "archive"),
    jsonRequest("POST", { archived: input.archived })
  );
  return result.head;
}

export function promoteCaptureToScene(
  input: CaptureRequestScope &
    Readonly<{
      expectedCaptureWorkingVersion: number;
      expectedCaptureContentHash: string;
      expectedProjectVersion: number;
      title: string;
      manuscriptPlacement: PromoteCaptureManuscriptPlacementInput;
      canvas?: PromoteCaptureCanvasInput;
    }>
): Promise<PromoteCaptureToSceneResponse> {
  return requestJson(
    capturePath(input.projectId, input.captureId, "promote"),
    jsonRequest("POST", {
      expectedCaptureWorkingVersion: input.expectedCaptureWorkingVersion,
      expectedCaptureContentHash: input.expectedCaptureContentHash,
      expectedProjectVersion: input.expectedProjectVersion,
      title: input.title,
      manuscriptPlacement: input.manuscriptPlacement,
      ...(input.canvas === undefined ? {} : { canvas: input.canvas })
    })
  );
}

function captureAttachmentsPath(projectId: string, captureId: string): string {
  return `${capturePath(projectId, captureId)}/attachments`;
}

function captureAttachmentItemPath(
  scope: CaptureAttachmentRequestScope,
  resource?: "finalize" | "download"
): string {
  const base = `${captureAttachmentsPath(scope.projectId, scope.captureId)}/${encodeURIComponent(scope.attachmentId)}`;
  if (resource === undefined) return base;
  return `${base}/${resource}`;
}

export function initCaptureAttachmentUpload(input: CaptureRequestScope &
  Readonly<{
    displayFilename: string;
    declaredContentType: string;
    declaredByteSize: number;
    clientSha256: string;
  }>): Promise<CaptureAttachmentInitUploadResponse> {
  return requestJson(
    `${captureAttachmentsPath(input.projectId, input.captureId)}/init`,
    jsonRequest("POST", {
      displayFilename: input.displayFilename,
      declaredContentType: input.declaredContentType,
      declaredByteSize: input.declaredByteSize,
      clientSha256: input.clientSha256
    })
  );
}

export function finalizeCaptureAttachmentUpload(
  scope: CaptureAttachmentRequestScope
): Promise<Readonly<{ attachment: CaptureAttachmentSummaryResponse }>> {
  return requestJson(
    captureAttachmentItemPath(scope, "finalize"),
    jsonRequest("POST", {})
  );
}

export async function listCaptureAttachments(
  scope: CaptureRequestScope
): Promise<readonly CaptureAttachmentSummaryResponse[]> {
  const result = await requestJson<
    Readonly<{ attachments: CaptureAttachmentSummaryResponse[] }>
  >(captureAttachmentsPath(scope.projectId, scope.captureId));
  return result.attachments;
}

export function getCaptureAttachmentDownloadUrl(
  scope: CaptureAttachmentRequestScope
): Promise<CaptureAttachmentDownloadUrlResponse> {
  return requestJson(captureAttachmentItemPath(scope, "download"));
}

export function deleteCaptureAttachment(
  scope: CaptureAttachmentRequestScope
): Promise<Readonly<{ attachment: CaptureAttachmentSummaryResponse }>> {
  return requestJson(captureAttachmentItemPath(scope), { method: "DELETE" });
}

export type ReaderVoicePack = "default" | "narrative" | "noir" | "soft";

export type SynthesizeReaderSpeechResponse = Readonly<{
  audioBase64: string;
  mimeType: string;
}>;

export function synthesizeReaderSpeech(input: Readonly<{
  text: string;
  voice?: ReaderVoicePack;
}>): Promise<SynthesizeReaderSpeechResponse> {
  return requestJson(
    "/api/reader/speak",
    jsonRequest("POST", {
      text: input.text,
      ...(input.voice === undefined ? {} : { voice: input.voice })
    })
  );
}

export type WorkspaceChatMode = "chat" | "plan" | "agent";
export type WorkspaceChatEffort = "fast" | "standard" | "high";

export type WorkspaceChatSelection = Readonly<{
  kind: string;
  bookId?: string;
  partId?: string;
  chapterId?: string;
  sceneId?: string;
  storyKnowledgeId?: string;
}>;

export type WorkspaceChatPriorTurn = Readonly<{
  role: "user" | "assistant";
  body: string;
}>;

export type WorkspaceChatAttachment = Readonly<{
  kind: "image" | "video";
  name: string;
  mimeType: string;
  dataBase64?: string;
  byteLength: number;
}>;

export type WorkspaceChatToolTrace = Readonly<{
  toolName: string;
  title: string;
  ok: boolean;
  summary: string;
  errorMessage?: string;
}>;

export type WorkspaceChatResponse = Readonly<{
  reply: string;
  mode?: WorkspaceChatMode;
  model?: AgentModelId;
  effort?: WorkspaceChatEffort;
  toolTraces?: readonly WorkspaceChatToolTrace[];
  code?: string;
}>;

export function sendWorkspaceChat(input: Readonly<{
  message: string;
  projectId?: string;
  mode?: WorkspaceChatMode;
  model?: AgentModelId;
  effort?: WorkspaceChatEffort;
  selection?: WorkspaceChatSelection;
  priorTurns?: readonly WorkspaceChatPriorTurn[];
  attachments?: readonly WorkspaceChatAttachment[];
}>): Promise<WorkspaceChatResponse> {
  return requestJson(
    "/api/workspace/chat",
    jsonRequest("POST", {
      message: input.message,
      ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
      ...(input.mode === undefined ? {} : { mode: input.mode }),
      ...(input.model === undefined ? {} : { model: input.model }),
      ...(input.effort === undefined ? {} : { effort: input.effort }),
      ...(input.selection === undefined ? {} : { selection: input.selection }),
      ...(input.priorTurns === undefined || input.priorTurns.length === 0
        ? {}
        : { priorTurns: input.priorTurns }),
      ...(input.attachments === undefined || input.attachments.length === 0
        ? {}
        : { attachments: input.attachments })
    })
  );
}

export type WorkspaceChatStreamHandlers = Readonly<{
  onStatus?(phase: string, label: string): void;
  onToolTrace?(trace: WorkspaceChatToolTrace): void;
  onTextDelta?(delta: string): void;
  onDone?(result: WorkspaceChatResponse): void;
  onError?(error: Readonly<{ error: string; code?: string }>): void;
}>;

function parseWorkspaceChatSseBuffer(
  buffer: string,
  handlers: WorkspaceChatStreamHandlers
): { remainder: string; result?: WorkspaceChatResponse } {
  let remainder = buffer;
  let result: WorkspaceChatResponse | undefined;

  while (true) {
    const boundary = remainder.indexOf("\n\n");
    if (boundary === -1) break;

    const rawEvent = remainder.slice(0, boundary);
    remainder = remainder.slice(boundary + 2);

    if (rawEvent.startsWith(":")) {
      continue;
    }

    let eventName = "message";
    const dataLines: string[] = [];
    for (const line of rawEvent.split("\n")) {
      if (line.startsWith("event:")) {
        eventName = line.slice("event:".length).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice("data:".length).trimStart());
      }
    }
    if (dataLines.length === 0) continue;

    const payload = JSON.parse(dataLines.join("\n")) as Record<string, unknown>;
    switch (eventName) {
      case "status":
        handlers.onStatus?.(
          String(payload.phase ?? ""),
          String(payload.label ?? "")
        );
        break;
      case "tool_trace":
        handlers.onToolTrace?.(payload as WorkspaceChatToolTrace);
        break;
      case "text_delta":
        handlers.onTextDelta?.(String(payload.delta ?? ""));
        break;
      case "done":
        result = payload as WorkspaceChatResponse;
        handlers.onDone?.(result);
        break;
      case "error":
        handlers.onError?.({
          error: String(payload.error ?? "Chat could not complete that turn."),
          ...(payload.code === undefined
            ? {}
            : { code: String(payload.code) })
        });
        break;
      default:
        break;
    }
  }

  return { remainder, ...(result === undefined ? {} : { result }) };
}

export async function sendWorkspaceChatStream(
  input: Readonly<{
    message: string;
    projectId?: string;
    mode?: WorkspaceChatMode;
    model?: AgentModelId;
    effort?: WorkspaceChatEffort;
    selection?: WorkspaceChatSelection;
    priorTurns?: readonly WorkspaceChatPriorTurn[];
    attachments?: readonly WorkspaceChatAttachment[];
  }>,
  handlers: WorkspaceChatStreamHandlers,
  signal?: AbortSignal
): Promise<WorkspaceChatResponse> {
  const response = await fetch(apiUrl("/api/workspace/chat/stream"), {
    method: "POST",
    credentials: "include",
    headers: {
      accept: "text/event-stream",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      message: input.message,
      ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
      ...(input.mode === undefined ? {} : { mode: input.mode }),
      ...(input.model === undefined ? {} : { model: input.model }),
      ...(input.effort === undefined ? {} : { effort: input.effort }),
      ...(input.selection === undefined ? {} : { selection: input.selection }),
      ...(input.priorTurns === undefined || input.priorTurns.length === 0
        ? {}
        : { priorTurns: input.priorTurns }),
      ...(input.attachments === undefined || input.attachments.length === 0
        ? {}
        : { attachments: input.attachments })
    }),
    signal
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      code?: string;
      error?: string;
    };
    throw new GhostwriterApiError(
      response.status,
      body.code ?? "REQUEST_FAILED",
      body.error ?? "Ghostwriter could not complete the request."
    );
  }

  const reader = response.body?.getReader();
  if (reader === undefined) {
    throw new GhostwriterApiError(
      502,
      "STREAM_UNAVAILABLE",
      "Ghostwriter could not open a chat stream."
    );
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let finalResult: WorkspaceChatResponse | undefined;
  let streamError: Readonly<{ error: string; code?: string }> | undefined;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parsed = parseWorkspaceChatSseBuffer(buffer, {
      ...handlers,
      onDone: (result) => {
        finalResult = result;
        handlers.onDone?.(result);
      },
      onError: (error) => {
        streamError = error;
        handlers.onError?.(error);
      }
    });
    buffer = parsed.remainder;
    if (parsed.result !== undefined) {
      finalResult = parsed.result;
    }
  }

  if (buffer.trim().length > 0) {
    const parsed = parseWorkspaceChatSseBuffer(buffer, {
      ...handlers,
      onDone: (result) => {
        finalResult = result;
        handlers.onDone?.(result);
      },
      onError: (error) => {
        streamError = error;
        handlers.onError?.(error);
      }
    });
    if (parsed.result !== undefined) {
      finalResult = parsed.result;
    }
  }

  if (finalResult !== undefined) {
    return finalResult;
  }
  if (streamError !== undefined) {
    throw new GhostwriterApiError(
      502,
      streamError.code ?? "WORKSPACE_CHAT_STREAM_FAILED",
      streamError.error
    );
  }
  throw new GhostwriterApiError(
    502,
    "WORKSPACE_CHAT_STREAM_INCOMPLETE",
    "Chat ended before a reply arrived."
  );
}

export type WritingAssistApiProposal = Readonly<{
  id: string;
  role: string;
  kind: string;
  title: string;
  summary: string;
  provider: string;
  status: string;
  prose?: string;
  sketch?: Readonly<Record<string, unknown>>;
  characterSheet?: Readonly<Record<string, unknown>>;
  storyKnowledgeId?: string;
  backdropCaption?: string;
}>;

export type WritingAssistResponse = Readonly<{
  provider: string;
  proposals: readonly WritingAssistApiProposal[];
}>;

export function requestWritingAssist(input: Readonly<{
  projectId: string;
  role: string;
  sceneId: string;
  sceneTitle: string;
  sceneSummary?: string;
  recentProse?: string;
  sketch?: unknown;
  backdropCaption?: string;
  cast?: readonly Readonly<{
    id: string;
    label: string;
    characterSheet?: unknown;
  }>[];
}>): Promise<WritingAssistResponse> {
  return requestJson(
    `/api/projects/${encodeURIComponent(input.projectId)}/writing-assist`,
    jsonRequest("POST", {
      role: input.role,
      sceneId: input.sceneId,
      sceneTitle: input.sceneTitle,
      ...(input.sceneSummary === undefined
        ? {}
        : { sceneSummary: input.sceneSummary }),
      ...(input.recentProse === undefined
        ? {}
        : { recentProse: input.recentProse }),
      ...(input.sketch === undefined ? {} : { sketch: input.sketch }),
      ...(input.backdropCaption === undefined
        ? {}
        : { backdropCaption: input.backdropCaption }),
      ...(input.cast === undefined ? {} : { cast: input.cast })
    })
  );
}

export type OpenAiProviderStatusResponse =
  | Readonly<{ configured: false; callsDisabled: boolean }>
  | Readonly<{
      configured: true;
      callsDisabled: boolean;
      provider: string;
      version: number;
      maskedHint: string;
      validationState: string;
      createdAt: string;
      updatedAt: string;
      validatedAt?: string;
    }>;

export type AgentModelId = string;

export type AgentWorkflowId =
  | "scene-partner.capture-reflection"
  | "plan-mode.outline"
  | "sketch-partner.craft-fields"
  | "character-coach.sheet-fields"
  | "worldkeeper.backdrop-fields";

export type ContextReceiptResponse = Readonly<{
  id: string;
  projectId: string;
  workflowId: string;
  workflowVersion: string;
  model: AgentModelId;
  receiptHash: string;
  createdAt: string;
  resources: readonly Readonly<{
    resourceClass: string;
    captureId: string;
    workingVersion: number;
    contentHash: string;
    inclusionReason: string;
    providerTextCharCount: number;
    providerTextHash: string;
  }>[];
  maxOutputTokens: number;
  wallClockSeconds: number;
  outputSchemaId: string;
  targetSceneId?: string;
  targetStoryKnowledgeId?: string;
}>;

export type AgentRunResponse = Readonly<{
  id: string;
  projectId: string;
  status: string;
  workflowId: string;
  receiptId: string;
  receiptHash: string;
  model: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  terminalDiagnosticCode?: string;
  providerResponseId?: string;
}>;

export type CaptureReflectionPayloadResponse = Readonly<{
  schemaId: "capture-reflection-v1";
  summary: string;
  questions: readonly string[];
  possibleStoryJobs: readonly Readonly<{
    label: string;
    rationale: string;
  }>[];
}>;

export type SketchFieldsPayloadResponse = Readonly<{
  schemaId: "sketch-fields-v1";
  purpose?: string;
  conflict?: string;
  turn?: string;
  sensoryNotes?: string;
  openQuestions?: string;
  detail?: string;
}>;

export type CharacterSheetPayloadResponse = Readonly<{
  schemaId: "character-sheet-v1";
  storyKnowledgeId: string;
  desire?: string;
  pressure?: string;
  voiceNotes?: string;
}>;

export type BackdropFieldsPayloadResponse = Readonly<{
  schemaId: "backdrop-fields-v1";
  sceneId?: string;
  caption?: string;
  sensoryNotesFallback?: string;
}>;

export type PlanOutlinePayloadResponse = Readonly<{
  schemaId: "plan-outline-v1";
  title: string;
  outline: string;
  sourceMode: "plan";
}>;

export type CatalogMemoPayloadResponse = Readonly<{
  schemaId: "catalog-memo-v1";
  agentId: string;
  title: string;
  summary: string;
  lens?: CatalogMemoLens;
  sections: readonly Readonly<{ heading: string; body: string }>[];
  evidence: readonly Readonly<{ label: string; sceneId?: string; quote?: string }>[];
}>;

export type PacingFindingsPayloadResponse = Readonly<{
  schemaId: "pacing-findings-v1";
  agentId: "pacing-doctor";
  title: string;
  summary: string;
  lens?: CatalogMemoLens;
  positionBasis: "equal-scene";
  turns: readonly Readonly<{
    id: "catalyst" | "commitment" | "midpoint" | "low-point" | "final-movement";
    sceneId?: string;
    sceneTitle?: string;
    measuredPct?: number;
    bandLow: number;
    bandHigh: number;
    driftNote?: string;
  }>[];
  flatRuns: readonly Readonly<{
    fromSceneId: string;
    toSceneId: string;
    reason: string;
  }>[];
  prescriptions: readonly Readonly<{
    action: "cut" | "merge" | "add-pressure" | "reorder";
    body: string;
    sceneIds?: readonly string[];
  }>[];
  sections: readonly Readonly<{ heading: string; body: string }>[];
  evidence: readonly Readonly<{ label: string; sceneId?: string; quote?: string }>[];
}>;

export type AgentProposalPayloadResponse =
  | CaptureReflectionPayloadResponse
  | PlanOutlinePayloadResponse
  | CatalogMemoPayloadResponse
  | PacingFindingsPayloadResponse
  | SketchFieldsPayloadResponse
  | CharacterSheetPayloadResponse
  | BackdropFieldsPayloadResponse;

export type AgentOutputSchemaId =
  | "capture-reflection-v1"
  | "plan-outline-v1"
  | "catalog-memo-v1"
  | "pacing-findings-v1"
  | "sketch-fields-v1"
  | "character-sheet-v1"
  | "backdrop-fields-v1";

export type AgentProposalResponse = Readonly<{
  id: string;
  projectId: string;
  runId: string;
  receiptId: string;
  status: string;
  outputSchemaId: AgentOutputSchemaId;
  payload: AgentProposalPayloadResponse;
  contentHash: string;
  primaryTarget: AgentProposalPrimaryTargetResponse;
  baseCaptureId?: string;
  baseCaptureWorkingVersion?: number;
  baseCaptureContentHash?: string;
  createdAt: string;
  updatedAt: string;
}>;

export type AgentProposalListPreviewResponse = Readonly<{
  agentId?: string;
  agentLabel?: string;
  title?: string;
  summary?: string;
}>;

export type AgentProposalSummaryResponse = Readonly<{
  id: string;
  projectId: string;
  runId: string;
  status: string;
  outputSchemaId: AgentOutputSchemaId;
  contentHash: string;
  primaryTarget: AgentProposalPrimaryTargetResponse;
  baseCaptureId?: string;
  createdAt: string;
  updatedAt: string;
  preview: AgentProposalListPreviewResponse;
}>;

export type AgentProposalTargetKind =
  | "capture"
  | "scene"
  | "story-knowledge"
  | "book"
  | "project";

export type AgentProposalStatus = "ready" | "rejected" | "stale" | "applied";

export type AgentProposalPrimaryTargetResponse = Readonly<{
  kind: AgentProposalTargetKind;
  id: string;
}>;

export type StartCaptureReflectionResponse =
  | Readonly<{
      kind: "ready";
      run: AgentRunResponse;
      proposal: AgentProposalResponse;
    }>
  | Readonly<{
      kind: "stale" | "failed" | "canceled";
      run: AgentRunResponse;
    }>;

function agentProjectPath(projectId: string, suffix: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/agent/${suffix}`;
}

export function getProviderCredentialStatus(
  providerId: string
): Promise<OpenAiProviderStatusResponse> {
  return requestJson(`/api/me/providers/${encodeURIComponent(providerId)}`);
}

export function setProviderCredential(
  providerId: string,
  input: Readonly<{
    apiKey: string;
    expectedVersion?: number;
  }>
): Promise<OpenAiProviderStatusResponse> {
  return requestJson(
    `/api/me/providers/${encodeURIComponent(providerId)}`,
    jsonRequest("PUT", {
      apiKey: input.apiKey,
      ...(input.expectedVersion === undefined
        ? {}
        : { expectedVersion: input.expectedVersion })
    })
  );
}

export function deleteProviderCredential(
  providerId: string,
  input: Readonly<{
    expectedVersion: number;
  }>
): Promise<OpenAiProviderStatusResponse> {
  return requestJson(
    `/api/me/providers/${encodeURIComponent(providerId)}`,
    jsonRequest("DELETE", {
      expectedVersion: input.expectedVersion
    })
  );
}

export function validateProviderCredential(
  providerId: string,
  input: Readonly<{
    expectedVersion: number;
  }>
): Promise<OpenAiProviderStatusResponse> {
  return requestJson(
    `/api/me/providers/${encodeURIComponent(providerId)}/validate`,
    jsonRequest("POST", { expectedVersion: input.expectedVersion })
  );
}

export type AccountProviderCredentialListItem =
  | Readonly<{ provider: string; configured: false }>
  | Readonly<{
      provider: string;
      configured: true;
      version: number;
      maskedHint: string;
      validationState: string;
      createdAt: string;
      updatedAt: string;
      validatedAt?: string;
    }>;

export function listAccountProviderCredentials(): Promise<
  Readonly<{
    callsDisabled: boolean;
    providers: readonly AccountProviderCredentialListItem[];
  }>
> {
  return requestJson("/api/me/providers");
}

export type AvailableModelCatalogEntry = Readonly<{
  id: string;
  provider: string;
  label: string;
  supportsChat: boolean;
  supportsTools: boolean;
  supportsStructured: boolean;
  supportsImage: boolean;
  defaultEffort?: "fast" | "standard" | "high";
  notes?: string;
  bestFor?: string;
  relativeStrength?: string;
  adapterReady: boolean;
}>;

export type AvailableModelDiscoveryStatus = Readonly<{
  provider: string;
  ok: boolean;
  count: number;
  errorCode?: string;
}>;

export type AvailableModelsResponse = Readonly<{
  callsDisabled: boolean;
  models: readonly AvailableModelCatalogEntry[];
  providers: readonly AccountProviderCredentialListItem[];
  discovery?: readonly AvailableModelDiscoveryStatus[];
}>;

export function getAvailableModels(): Promise<AvailableModelsResponse> {
  return requestJson("/api/me/available-models");
}

export function getOpenAiProviderStatus(): Promise<OpenAiProviderStatusResponse> {
  return requestJson("/api/me/provider/openai");
}

export function setOpenAiProviderCredential(input: Readonly<{
  apiKey: string;
  expectedVersion?: number;
}>): Promise<OpenAiProviderStatusResponse> {
  return requestJson(
    "/api/me/provider/openai",
    jsonRequest("PUT", {
      apiKey: input.apiKey,
      ...(input.expectedVersion === undefined
        ? {}
        : { expectedVersion: input.expectedVersion })
    })
  );
}

export function deleteOpenAiProviderCredential(input: Readonly<{
  expectedVersion: number;
}>): Promise<OpenAiProviderStatusResponse> {
  return requestJson(
    "/api/me/provider/openai",
    jsonRequest("DELETE", {
      expectedVersion: input.expectedVersion
    })
  );
}

export function validateOpenAiProviderCredential(input: Readonly<{
  expectedVersion: number;
}>): Promise<OpenAiProviderStatusResponse> {
  return requestJson(
    "/api/me/provider/openai/validate",
    jsonRequest("POST", { expectedVersion: input.expectedVersion })
  );
}

export function skipAiCollaborationSetup(input?: Readonly<{
  expectedVersion?: number;
}>): Promise<
  Readonly<{
    configured: true;
    profile: Readonly<{
      version: number;
      setupSkipped: boolean;
      updatedAt: string;
    }>;
  }>
> {
  return requestJson(
    "/api/me/ai-collaboration",
    jsonRequest("PATCH", {
      skipSetup: true,
      ...(input?.expectedVersion === undefined
        ? {}
        : { expectedVersion: input.expectedVersion })
    })
  );
}

export async function previewCaptureReflectionContext(input: Readonly<{
  projectId: string;
  captureId: string;
  model?: AgentModelId;
  workflowId?: AgentWorkflowId;
  sceneId?: string;
  storyKnowledgeId?: string;
}>): Promise<ContextReceiptResponse> {
  const response = await requestJson<Readonly<{ receipt: ContextReceiptResponse }>>(
    agentProjectPath(input.projectId, "context-preview"),
    jsonRequest("POST", {
      captureId: input.captureId,
      ...(input.model === undefined ? {} : { model: input.model }),
      ...(input.workflowId === undefined ? {} : { workflowId: input.workflowId }),
      ...(input.sceneId === undefined ? {} : { sceneId: input.sceneId }),
      ...(input.storyKnowledgeId === undefined
        ? {}
        : { storyKnowledgeId: input.storyKnowledgeId })
    })
  );
  return response.receipt;
}

export async function startCaptureReflectionRun(input: Readonly<{
  projectId: string;
  receiptId: string;
  expectedReceiptHash: string;
}>): Promise<StartCaptureReflectionResponse> {
  const response = await requestJson<
    | Readonly<{
        kind: "ready";
        run: AgentRunResponse;
        proposal: AgentProposalResponse;
      }>
    | Readonly<{
        kind: "stale" | "failed" | "canceled";
        run: AgentRunResponse;
      }>
  >(
    agentProjectPath(input.projectId, "runs"),
    jsonRequest("POST", {
      receiptId: input.receiptId,
      expectedReceiptHash: input.expectedReceiptHash
    })
  );
  return response;
}

export async function getAgentRun(input: Readonly<{
  projectId: string;
  runId: string;
}>): Promise<AgentRunResponse> {
  const response = await requestJson<Readonly<{ run: AgentRunResponse }>>(
    agentProjectPath(input.projectId, `runs/${encodeURIComponent(input.runId)}`)
  );
  return response.run;
}

export async function cancelAgentRun(input: Readonly<{
  projectId: string;
  runId: string;
}>): Promise<AgentRunResponse> {
  const response = await requestJson<Readonly<{ run: AgentRunResponse }>>(
    agentProjectPath(
      input.projectId,
      `runs/${encodeURIComponent(input.runId)}/cancel`
    ),
    jsonRequest("POST", {})
  );
  return response.run;
}

export async function listAgentProposals(
  projectId: string,
  filter: Readonly<{
    targetKind?: AgentProposalTargetKind;
    targetId?: string;
    status?: AgentProposalStatus;
  }> = {}
): Promise<readonly AgentProposalSummaryResponse[]> {
  const params = new URLSearchParams();
  if (filter.targetKind !== undefined) params.set("targetKind", filter.targetKind);
  if (filter.targetId !== undefined) params.set("targetId", filter.targetId);
  if (filter.status !== undefined) params.set("status", filter.status);
  const query = params.toString();
  const response = await requestJson<
    Readonly<{ proposals: readonly AgentProposalSummaryResponse[] }>
  >(agentProjectPath(projectId, `proposals${query.length === 0 ? "" : `?${query}`}`));
  return response.proposals;
}

export async function getAgentProposal(input: Readonly<{
  projectId: string;
  proposalId: string;
}>): Promise<AgentProposalResponse> {
  const response = await requestJson<Readonly<{ proposal: AgentProposalResponse }>>(
    agentProjectPath(
      input.projectId,
      `proposals/${encodeURIComponent(input.proposalId)}`
    )
  );
  return response.proposal;
}

export async function rejectAgentProposal(input: Readonly<{
  projectId: string;
  proposalId: string;
}>): Promise<AgentProposalResponse> {
  const response = await requestJson<Readonly<{ proposal: AgentProposalResponse }>>(
    agentProjectPath(
      input.projectId,
      `proposals/${encodeURIComponent(input.proposalId)}/reject`
    ),
    jsonRequest("POST", {})
  );
  return response.proposal;
}

export async function acknowledgeAgentProposal(input: Readonly<{
  projectId: string;
  proposalId: string;
}>): Promise<AgentProposalResponse> {
  const response = await requestJson<Readonly<{ proposal: AgentProposalResponse }>>(
    agentProjectPath(
      input.projectId,
      `proposals/${encodeURIComponent(input.proposalId)}/acknowledge`
    ),
    jsonRequest("POST", {})
  );
  return response.proposal;
}

export async function runCatalogAgent(input: Readonly<{
  projectId: string;
  agentId: CatalogAgentId;
  lens?: CatalogMemoLens;
  model?: string;
  effort?: CatalogAgentEffort;
  sceneId?: string;
  storyKnowledgeId?: string;
  bookId?: string;
}>): Promise<AgentProposalResponse> {
  const response = await requestJson<Readonly<{ proposal: AgentProposalResponse }>>(
    agentProjectPath(input.projectId, "catalog-runs"),
    jsonRequest("POST", {
      agentId: input.agentId,
      ...(input.lens === undefined ? {} : { lens: input.lens }),
      ...(input.model === undefined ? {} : { model: input.model }),
      ...(input.effort === undefined ? {} : { effort: input.effort }),
      ...(input.sceneId === undefined ? {} : { sceneId: input.sceneId }),
      ...(input.storyKnowledgeId === undefined
        ? {}
        : { storyKnowledgeId: input.storyKnowledgeId }),
      ...(input.bookId === undefined ? {} : { bookId: input.bookId })
    })
  );
  return response.proposal;
}

export type CatalogPlaybookSummaryResponse = Readonly<{
  agentId: CatalogAgentId;
  label: string;
  stage: CatalogAgentPlaybook["stage"];
  builtInVersion: string;
  overridden: boolean;
  doctrinePreview: string;
}>;

export type CatalogPlaybookDetailResponse = Readonly<{
  builtIn: CatalogAgentPlaybook;
  override: CatalogPlaybookOverride | null;
  effective: CatalogAgentPlaybook;
}>;

function catalogPlaybookPath(projectId: string, agentId?: CatalogAgentId): string {
  const base = `/api/projects/${encodeURIComponent(projectId)}/catalog-playbooks`;
  return agentId === undefined ? base : `${base}/${encodeURIComponent(agentId)}`;
}

export async function listCatalogPlaybooks(
  projectId: string
): Promise<readonly CatalogPlaybookSummaryResponse[]> {
  const response = await requestJson<
    Readonly<{ playbooks: readonly CatalogPlaybookSummaryResponse[] }>
  >(catalogPlaybookPath(projectId));
  return response.playbooks;
}

export async function getCatalogPlaybook(input: Readonly<{
  projectId: string;
  agentId: CatalogAgentId;
}>): Promise<CatalogPlaybookDetailResponse> {
  return requestJson(catalogPlaybookPath(input.projectId, input.agentId));
}

export async function saveCatalogPlaybookOverride(input: Readonly<{
  projectId: string;
  agentId: CatalogAgentId;
  doctrine?: string;
  sections?: readonly Readonly<{ heading: string; note: string }>[];
  expectedVersion?: number;
}>): Promise<CatalogPlaybookDetailResponse> {
  return requestJson(
    catalogPlaybookPath(input.projectId, input.agentId),
    jsonRequest("PUT", {
      ...(input.doctrine === undefined ? {} : { doctrine: input.doctrine }),
      ...(input.sections === undefined ? {} : { sections: input.sections }),
      ...(input.expectedVersion === undefined
        ? {}
        : { expectedVersion: input.expectedVersion })
    })
  );
}

export async function resetCatalogPlaybookOverride(input: Readonly<{
  projectId: string;
  agentId: CatalogAgentId;
}>): Promise<CatalogPlaybookDetailResponse> {
  return requestJson(catalogPlaybookPath(input.projectId, input.agentId), {
    method: "DELETE"
  });
}

export type PersistPlanOutlineResponse = Readonly<{
  captureId: string;
  proposalId: string;
  runId: string;
  proposal: AgentProposalResponse;
}>;

export async function persistPlanOutline(input: Readonly<{
  projectId: string;
  outlineText: string;
  title?: string;
  model?: AgentModelId;
}>): Promise<PersistPlanOutlineResponse> {
  return requestJson<PersistPlanOutlineResponse>(
    agentProjectPath(input.projectId, "plan-outlines"),
    jsonRequest("POST", {
      outlineText: input.outlineText,
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.model === undefined ? {} : { model: input.model })
    })
  );
}

export type ApplyAgentProposalNewSceneInput = Readonly<{
  projectId: string;
  proposalId: string;
  mode: "new-scene";
  title: string;
  bookId: string;
  chapterId?: string;
  placeOnCanvas?: boolean;
  expectedProjectVersion: number;
  expectedCanvasVersion?: number;
  expectedProposalContentHash: string;
}>;

export type ApplyAgentProposalNamedVariantInput = Readonly<{
  projectId: string;
  proposalId: string;
  mode: "named-variant";
  sceneId: string;
  variantName: string;
  expectedWorkingVersion: number;
  sessionId: string;
  expectedProposalContentHash: string;
}>;

export type ApplyAgentProposalCraftFieldsInput = Readonly<{
  projectId: string;
  proposalId: string;
  mode: "craft-fields";
  expectedProjectVersion: number;
  expectedProposalContentHash: string;
}>;

export type ApplyAgentProposalInput =
  | ApplyAgentProposalNewSceneInput
  | ApplyAgentProposalNamedVariantInput
  | ApplyAgentProposalCraftFieldsInput;

export type ApplyAgentProposalNewSceneResponse = Readonly<{
  mode: "new-scene";
  proposal: AgentProposalResponse;
  scene: Readonly<{ id: string; title: string; projectId: string }>;
  sceneDocumentHead: Readonly<{
    sceneId: string;
    projectId: string;
    workingVersion: number;
    contentHash: string;
  }>;
  captureHead: CaptureHeadResponse;
  navigator: unknown;
}>;

export type ApplyAgentProposalNamedVariantResponse = Readonly<{
  mode: "named-variant";
  proposal: AgentProposalResponse;
  head: Readonly<{
    sceneId: string;
    projectId: string;
    workingVersion: number;
    contentHash: string;
  }>;
  revision: Readonly<{
    id: string;
    sceneId: string;
    origin: string;
    reason: string;
    contentHash: string;
  }>;
  variant: Readonly<{
    id: string;
    sceneId: string;
    name: string;
    revisionId: string;
  }>;
}>;

export type ApplyAgentProposalCraftFieldsResponse = Readonly<{
  mode: "craft-fields";
  proposal: AgentProposalResponse;
  navigator: unknown;
}>;

export type ApplyAgentProposalResponse =
  | ApplyAgentProposalNewSceneResponse
  | ApplyAgentProposalNamedVariantResponse
  | ApplyAgentProposalCraftFieldsResponse;

export async function applyAgentProposal(
  input: ApplyAgentProposalInput
): Promise<ApplyAgentProposalResponse> {
  const { projectId, proposalId, ...body } = input;
  return requestJson<ApplyAgentProposalResponse>(
    agentProjectPath(
      projectId,
      `proposals/${encodeURIComponent(proposalId)}/apply`
    ),
    jsonRequest("POST", body)
  );
}

export type ScenePartnerTurnPhase =
  | "interview"
  | "match"
  | "new-scene"
  | "iterate";

export type ScenePartnerTurnAction = "apply-new-scene" | "propose-image";

export type ScenePartnerTurnResponse = Readonly<{
  thinkingSteps: readonly string[];
  assistantMessage: string;
  phase: ScenePartnerTurnPhase;
  matchedSceneId: string | null;
  proseDraft: string | null;
  actions: readonly ScenePartnerTurnAction[];
  imagePrompt: string | null;
}>;

export type ScenePartnerImageResponse = Readonly<{
  url: string;
  alt: string;
  prompt: string;
}>;

function scenePartnerPath(
  projectId: string,
  captureId: string,
  suffix: "turns" | "images"
): string {
  return `/api/projects/${encodeURIComponent(projectId)}/captures/${encodeURIComponent(captureId)}/scene-partner/${suffix}`;
}

export async function postScenePartnerTurn(input: Readonly<{
  projectId: string;
  captureId: string;
  ideaProse: string;
  scenes: readonly Readonly<{ id: string; title: string; label: string }>[];
  messages: readonly Readonly<{ role: "assistant" | "user"; body: string }>[];
  phase?: ScenePartnerTurnPhase;
  matchedSceneId?: string | null;
}>): Promise<ScenePartnerTurnResponse> {
  const response = await requestJson<Readonly<{ turn: ScenePartnerTurnResponse }>>(
    scenePartnerPath(input.projectId, input.captureId, "turns"),
    jsonRequest("POST", {
      ideaProse: input.ideaProse,
      scenes: input.scenes,
      messages: input.messages,
      ...(input.phase === undefined ? {} : { phase: input.phase }),
      ...(input.matchedSceneId === undefined
        ? {}
        : { matchedSceneId: input.matchedSceneId })
    })
  );
  return response.turn;
}

export async function postScenePartnerImage(input: Readonly<{
  projectId: string;
  captureId: string;
  prompt: string;
}>): Promise<ScenePartnerImageResponse> {
  return requestJson(
    scenePartnerPath(input.projectId, input.captureId, "images"),
    jsonRequest("POST", { prompt: input.prompt })
  );
}

export type BookCoverImagePreviewResponse = Readonly<{
  previewUrl: string;
  alt: string;
  prompt: string;
}>;

export type BookCoverImageApplyResponse = Readonly<{
  cover: Readonly<{
    concept?: string;
    notes?: string;
    imageUrl?: string;
  }>;
  imageUrl: string;
}>;

export type BookCoverDownloadResponse = Readonly<{
  download: Readonly<{
    url: string;
    expiresAt: string;
  }>;
}>;

export type BookCoverImageJobStatus = "queued" | "running" | "ready" | "failed";

export type BookCoverImageJobOption = Readonly<{
  id: string;
  previewUrl: string;
  prompt: string;
  variationIndex: number;
}>;

export type BookCoverImageJobStartResponse = Readonly<{
  jobId: string;
  status: "queued";
}>;

export type BookCoverImageJobResponse = Readonly<{
  jobId: string;
  status: BookCoverImageJobStatus;
  basePrompt: string;
  createdAt: string;
  updatedAt: string;
  options?: readonly BookCoverImageJobOption[];
  error?: Readonly<{
    code: string;
    message: string;
  }>;
}>;

function bookCoverImagePath(
  projectId: string,
  bookId: string,
  suffix: "images" | "images/apply" | "images/jobs" | "download" | `images/jobs/${string}`
): string {
  return `/api/projects/${encodeURIComponent(projectId)}/books/${encodeURIComponent(bookId)}/cover/${suffix}`;
}

export async function postBookCoverImagePreview(input: Readonly<{
  projectId: string;
  bookId: string;
  prompt: string;
}>): Promise<BookCoverImagePreviewResponse> {
  return requestJson(
    bookCoverImagePath(input.projectId, input.bookId, "images"),
    jsonRequest("POST", { prompt: input.prompt })
  );
}

export async function postBookCoverImageJob(input: Readonly<{
  projectId: string;
  bookId: string;
  prompt: string;
  count?: number;
  refinement?: string;
  imageModel?: string;
}>): Promise<BookCoverImageJobStartResponse> {
  return requestJson(
    bookCoverImagePath(input.projectId, input.bookId, "images/jobs"),
    jsonRequest("POST", {
      prompt: input.prompt,
      ...(input.count === undefined ? {} : { count: input.count }),
      ...(input.refinement === undefined ? {} : { refinement: input.refinement }),
      ...(input.imageModel === undefined ? {} : { imageModel: input.imageModel })
    })
  );
}

export async function getBookCoverImageJob(input: Readonly<{
  projectId: string;
  bookId: string;
  jobId: string;
}>): Promise<BookCoverImageJobResponse> {
  return requestJson(
    bookCoverImagePath(
      input.projectId,
      input.bookId,
      `images/jobs/${encodeURIComponent(input.jobId)}`
    )
  );
}

export async function postBookCoverImageApply(input: Readonly<{
  projectId: string;
  bookId: string;
  previewDataUri?: string;
  prompt?: string;
}>): Promise<BookCoverImageApplyResponse> {
  return requestJson(
    bookCoverImagePath(input.projectId, input.bookId, "images/apply"),
    jsonRequest("POST", {
      ...(input.previewDataUri === undefined
        ? {}
        : { previewDataUri: input.previewDataUri }),
      ...(input.prompt === undefined ? {} : { prompt: input.prompt })
    })
  );
}

export async function getBookCoverDownload(input: Readonly<{
  projectId: string;
  bookId: string;
}>): Promise<BookCoverDownloadResponse> {
  return requestJson(bookCoverImagePath(input.projectId, input.bookId, "download"));
}

export type CharacterVisualRecord = Readonly<{
  id: string;
  url: string;
  alt: string;
  caption?: string;
  source: "generated" | "upload" | "url";
}>;

export type CharacterVisualApplyResponse = Readonly<{
  visual: CharacterVisualRecord;
  visuals: readonly CharacterVisualRecord[];
}>;

export type CharacterVisualDownloadResponse = Readonly<{
  download: Readonly<{
    url: string;
    expiresAt: string;
  }>;
}>;

export type CharacterVisualJobStatus = "queued" | "running" | "ready" | "failed";

export type CharacterVisualJobOption = Readonly<{
  id: string;
  previewUrl: string;
  prompt: string;
  variationIndex: number;
}>;

export type CharacterVisualJobStartResponse = Readonly<{
  jobId: string;
  status: "queued";
}>;

export type CharacterVisualJobResponse = Readonly<{
  jobId: string;
  status: CharacterVisualJobStatus;
  basePrompt: string;
  createdAt: string;
  updatedAt: string;
  options?: readonly CharacterVisualJobOption[];
  error?: Readonly<{
    code: string;
    message: string;
  }>;
}>;

function characterVisualPath(
  projectId: string,
  knowledgeId: string,
  suffix:
    | "visuals/apply"
    | "visuals/jobs"
    | `visuals/jobs/${string}`
    | `visuals/${string}/download`
): string {
  return `/api/projects/${encodeURIComponent(projectId)}/story-knowledge/${encodeURIComponent(knowledgeId)}/${suffix}`;
}

export async function postCharacterVisualJob(input: Readonly<{
  projectId: string;
  knowledgeId: string;
  prompt?: string;
  count?: number;
  refinement?: string;
  imageModel?: string;
}>): Promise<CharacterVisualJobStartResponse> {
  return requestJson(
    characterVisualPath(input.projectId, input.knowledgeId, "visuals/jobs"),
    jsonRequest("POST", {
      ...(input.prompt === undefined ? {} : { prompt: input.prompt }),
      ...(input.count === undefined ? {} : { count: input.count }),
      ...(input.refinement === undefined ? {} : { refinement: input.refinement }),
      ...(input.imageModel === undefined ? {} : { imageModel: input.imageModel })
    })
  );
}

export async function getCharacterVisualJob(input: Readonly<{
  projectId: string;
  knowledgeId: string;
  jobId: string;
}>): Promise<CharacterVisualJobResponse> {
  return requestJson(
    characterVisualPath(
      input.projectId,
      input.knowledgeId,
      `visuals/jobs/${encodeURIComponent(input.jobId)}`
    )
  );
}

export async function postCharacterVisualApply(input: Readonly<{
  projectId: string;
  knowledgeId: string;
  previewDataUri: string;
  alt: string;
  source: "generated" | "upload";
  caption?: string;
}>): Promise<CharacterVisualApplyResponse> {
  return requestJson(
    characterVisualPath(input.projectId, input.knowledgeId, "visuals/apply"),
    jsonRequest("POST", {
      previewDataUri: input.previewDataUri,
      alt: input.alt,
      source: input.source,
      ...(input.caption === undefined ? {} : { caption: input.caption })
    })
  );
}

export async function getCharacterVisualDownload(input: Readonly<{
  projectId: string;
  knowledgeId: string;
  visualId: string;
}>): Promise<CharacterVisualDownloadResponse> {
  return requestJson(
    characterVisualPath(
      input.projectId,
      input.knowledgeId,
      `visuals/${encodeURIComponent(input.visualId)}/download`
    )
  );
}
