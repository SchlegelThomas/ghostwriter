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
  method: "POST" | "PUT" | "PATCH",
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

export type WorkspaceChatResponse = Readonly<{
  reply: string;
}>;

export function sendWorkspaceChat(input: Readonly<{
  message: string;
  projectId?: string;
}>): Promise<WorkspaceChatResponse> {
  return requestJson(
    "/api/workspace/chat",
    jsonRequest("POST", {
      message: input.message,
      ...(input.projectId === undefined ? {} : { projectId: input.projectId })
    })
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
