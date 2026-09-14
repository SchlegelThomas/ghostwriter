import type {
  McpBridgeContinueCoordinationStepBody,
  McpBridgeCreateCoordinationInput,
  McpBridgeStructurePreviewInput
} from "./story-work-bridge-mutation-schemas.js";
import type {
  McpBridgeCharacterSubmitInput,
  McpBridgeCheckSubmitInput,
  McpBridgeSceneSubmitInput,
  McpBridgeStructureSubmitInput
} from "./story-work-bridge-submit-schemas.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_REQUEST_BYTES = 2 * 1024 * 1024;

export class LocalBridgeNotFoundError extends Error {
  constructor() {
    super("Local MCP bridge resource not found.");
    this.name = "LocalBridgeNotFoundError";
  }
}

export class LocalBridgeRequestFailedError extends Error {
  constructor(message = "Local MCP bridge request failed.") {
    super(message);
    this.name = "LocalBridgeRequestFailedError";
  }
}

export class LocalBridgeConflictError extends Error {
  constructor() {
    super("Local MCP bridge request conflict.");
    this.name = "LocalBridgeConflictError";
  }
}

export class LocalBridgeStructurePreviewConflictError extends Error {
  readonly missingRequired: readonly string[];

  constructor(missingRequired: readonly string[]) {
    super("Local MCP bridge structure preview conflict.");
    this.name = "LocalBridgeStructurePreviewConflictError";
    this.missingRequired = Object.freeze([...missingRequired]);
  }
}

export class LocalBridgeInvalidRequestError extends Error {
  constructor() {
    super("Local MCP bridge invalid request.");
    this.name = "LocalBridgeInvalidRequestError";
  }
}

export class LocalBridgeUnavailableError extends Error {
  constructor() {
    super("Local MCP bridge unavailable.");
    this.name = "LocalBridgeUnavailableError";
  }
}

export class LocalBridgeConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocalBridgeConfigError";
  }
}

export type LocalBridgeConfig = Readonly<{
  apiUrl: string;
  token: string;
}>;

export type LocalBridgeSubmitResponse = Readonly<{
  assignment: unknown;
  created: boolean;
  generation: unknown;
}>;

export type LocalBridgePreviewResponse = Readonly<{
  preview: unknown;
}>;

export type LocalBridgeCoordinationCreateResponse = Readonly<{
  replayed: boolean;
  coordination: unknown;
  rootAssignment: unknown;
  projection?: unknown;
}>;

export type LocalBridgeCoordinationContinueResponse =
  LocalBridgeCoordinationCreateResponse &
    Readonly<{
      checkAssignment: unknown;
    }>;

function trimOptional(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

export function parseLocalBridgeConfig(input: {
  apiUrl?: string;
  grantToken?: string;
}): LocalBridgeConfig {
  const apiUrlRaw = trimOptional(input.apiUrl);
  const token = trimOptional(input.grantToken);
  if (apiUrlRaw === undefined && token === undefined) {
    throw new LocalBridgeConfigError(
      "Grant bridge mode requires GHOSTWRITER_MCP_API_URL and GHOSTWRITER_MCP_GRANT_TOKEN."
    );
  }
  if (apiUrlRaw === undefined) {
    throw new LocalBridgeConfigError(
      "Grant bridge mode requires GHOSTWRITER_MCP_API_URL when GHOSTWRITER_MCP_GRANT_TOKEN is set."
    );
  }
  if (token === undefined) {
    throw new LocalBridgeConfigError(
      "Grant bridge mode requires GHOSTWRITER_MCP_GRANT_TOKEN when GHOSTWRITER_MCP_API_URL is set."
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(apiUrlRaw);
  } catch {
    throw new LocalBridgeConfigError(
      "GHOSTWRITER_MCP_API_URL must be a valid http or https URL."
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new LocalBridgeConfigError(
      "GHOSTWRITER_MCP_API_URL must use http or https."
    );
  }
  const normalizedBase = parsed.toString().replace(/\/+$/, "");
  return Object.freeze({ apiUrl: normalizedBase, token });
}

export function resolveLocalBridgeConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env
): LocalBridgeConfig | undefined {
  const apiUrl = trimOptional(env.GHOSTWRITER_MCP_API_URL);
  const token = trimOptional(env.GHOSTWRITER_MCP_GRANT_TOKEN);
  if (apiUrl === undefined && token === undefined) {
    return undefined;
  }
  return parseLocalBridgeConfig({ apiUrl, grantToken: token });
}

export type LocalBridgeClient = Readonly<{
  getGrant(): Promise<unknown>;
  listStoryWork(): Promise<unknown>;
  getStoryWork(assignmentId: string): Promise<unknown>;
  listStoryWorkCoordinations(): Promise<unknown>;
  getStoryWorkCoordination(coordinationId: string): Promise<unknown>;
  submitCharacterWork(
    body: McpBridgeCharacterSubmitInput
  ): Promise<LocalBridgeSubmitResponse>;
  submitSceneWork(body: McpBridgeSceneSubmitInput): Promise<LocalBridgeSubmitResponse>;
  submitCheckWork(body: McpBridgeCheckSubmitInput): Promise<LocalBridgeSubmitResponse>;
  submitStructureWork(
    body: McpBridgeStructureSubmitInput
  ): Promise<LocalBridgeSubmitResponse>;
  previewStoryStructure(
    body: McpBridgeStructurePreviewInput
  ): Promise<LocalBridgePreviewResponse>;
  createStoryWorkCoordination(
    body: McpBridgeCreateCoordinationInput
  ): Promise<LocalBridgeCoordinationCreateResponse>;
  continueStoryWorkCoordinationStep(
    coordinationId: string,
    stepId: string,
    body: McpBridgeContinueCoordinationStepBody
  ): Promise<LocalBridgeCoordinationContinueResponse>;
  readCapture(captureId: string): Promise<unknown>;
  assembleCaptureReflectionContext(captureId: string): Promise<unknown>;
  proposeCaptureReflection(captureId: string): Promise<unknown>;
}>;

function normalizeBridgeResourceId(value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 200) {
    throw new LocalBridgeNotFoundError();
  }
  return normalized;
}

export type CreateLocalBridgeClientOptions = Readonly<{
  apiUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxResponseBytes?: number;
  maxRequestBytes?: number;
}>;

async function readBoundedJsonBody(
  response: Response,
  maxBytes: number
): Promise<unknown> {
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > maxBytes) {
    throw new LocalBridgeRequestFailedError();
  }
  if (buffer.byteLength === 0) {
    return undefined;
  }
  try {
    return JSON.parse(new TextDecoder().decode(buffer)) as unknown;
  } catch {
    throw new LocalBridgeRequestFailedError();
  }
}

function bridgeUrl(base: string, path: string): string {
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

function mapBridgeHttpStatus(status: number): never {
  if (status === 404) {
    throw new LocalBridgeNotFoundError();
  }
  if (status === 409) {
    throw new LocalBridgeConflictError();
  }
  if (status === 422) {
    throw new LocalBridgeInvalidRequestError();
  }
  if (status === 503) {
    throw new LocalBridgeUnavailableError();
  }
  throw new LocalBridgeRequestFailedError();
}

function sanitizeMissingRequiredOperationIds(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const ids: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") {
      return undefined;
    }
    const trimmed = entry.trim();
    if (trimmed.length === 0 || trimmed.length > 200) {
      return undefined;
    }
    ids.push(trimmed);
    if (ids.length > 500) {
      return undefined;
    }
  }
  return Object.freeze(ids);
}

async function throwForBridgeErrorResponse(
  response: Response,
  path: string,
  maxResponseBytes: number
): Promise<never> {
  const status = response.status;
  if (
    status === 409 &&
    path === "/local-mcp/v1/story-work/structure/preview"
  ) {
    try {
      const body = await readBoundedJsonBody(response, maxResponseBytes);
      if (body !== null && typeof body === "object") {
        const missingRequired = sanitizeMissingRequiredOperationIds(
          (body as { missingRequired?: unknown }).missingRequired
        );
        if (missingRequired !== undefined) {
          throw new LocalBridgeStructurePreviewConflictError(missingRequired);
        }
      }
    } catch (error) {
      if (error instanceof LocalBridgeStructurePreviewConflictError) {
        throw error;
      }
    }
    throw new LocalBridgeConflictError();
  }
  mapBridgeHttpStatus(status);
}

function parseSubmitResponse(body: unknown): LocalBridgeSubmitResponse {
  if (body === null || typeof body !== "object") {
    throw new LocalBridgeRequestFailedError();
  }
  const record = body as {
    assignment?: unknown;
    created?: unknown;
    generation?: unknown;
  };
  if (
    record.assignment === undefined ||
    typeof record.created !== "boolean" ||
    record.generation === undefined
  ) {
    throw new LocalBridgeRequestFailedError();
  }
  return Object.freeze({
    assignment: record.assignment,
    created: record.created,
    generation: record.generation
  });
}

export function createLocalBridgeClient(
  options: CreateLocalBridgeClientOptions
): LocalBridgeClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const maxRequestBytes = options.maxRequestBytes ?? DEFAULT_MAX_REQUEST_BYTES;
  const authorization = `Bearer ${options.token}`;

  async function bridgeGet(path: string): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(bridgeUrl(options.apiUrl, path), {
        method: "GET",
        headers: {
          Authorization: authorization,
          Accept: "application/json"
        },
        signal: controller.signal
      });
      if (!response.ok) {
        mapBridgeHttpStatus(response.status);
      }
      return await readBoundedJsonBody(response, maxResponseBytes);
    } catch (error) {
      if (
        error instanceof LocalBridgeNotFoundError ||
        error instanceof LocalBridgeConflictError ||
        error instanceof LocalBridgeInvalidRequestError ||
        error instanceof LocalBridgeUnavailableError ||
        error instanceof LocalBridgeRequestFailedError
      ) {
        throw error;
      }
      if (error instanceof Error && error.name === "AbortError") {
        throw new LocalBridgeRequestFailedError();
      }
      throw new LocalBridgeRequestFailedError();
    } finally {
      clearTimeout(timeout);
    }
  }

  async function bridgePostRaw(path: string, body: unknown): Promise<Response> {
    const serialized = JSON.stringify(body);
    if (serialized.length > maxRequestBytes) {
      throw new LocalBridgeRequestFailedError();
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(bridgeUrl(options.apiUrl, path), {
        method: "POST",
        headers: {
          Authorization: authorization,
          Accept: "application/json",
          "Content-Type": "application/json"
        },
        body: serialized,
        signal: controller.signal
      });
      return response;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new LocalBridgeRequestFailedError();
      }
      throw new LocalBridgeRequestFailedError();
    } finally {
      clearTimeout(timeout);
    }
  }

  async function bridgePost(path: string, body: unknown): Promise<LocalBridgeSubmitResponse> {
    try {
      const response = await bridgePostRaw(path, body);
      if (!response.ok) {
        await throwForBridgeErrorResponse(response, path, maxResponseBytes);
      }
      const parsed = await readBoundedJsonBody(response, maxResponseBytes);
      return parseSubmitResponse(parsed);
    } catch (error) {
      return rethrowBridgePostError(error);
    }
  }

  async function bridgePostJson(path: string, body: unknown): Promise<unknown> {
    try {
      const response = await bridgePostRaw(path, body);
      if (!response.ok) {
        await throwForBridgeErrorResponse(response, path, maxResponseBytes);
      }
      return await readBoundedJsonBody(response, maxResponseBytes);
    } catch (error) {
      return rethrowBridgePostError(error);
    }
  }

  function rethrowBridgePostError(error: unknown): never {
    if (
      error instanceof LocalBridgeNotFoundError ||
      error instanceof LocalBridgeConflictError ||
      error instanceof LocalBridgeStructurePreviewConflictError ||
      error instanceof LocalBridgeInvalidRequestError ||
      error instanceof LocalBridgeUnavailableError ||
      error instanceof LocalBridgeRequestFailedError
    ) {
      throw error;
    }
    throw new LocalBridgeRequestFailedError();
  }

  function parsePreviewResponse(body: unknown): LocalBridgePreviewResponse {
    if (body === null || typeof body !== "object" || !("preview" in body)) {
      throw new LocalBridgeRequestFailedError();
    }
    return Object.freeze({ preview: (body as { preview: unknown }).preview });
  }

  function parseCoordinationCreateResponse(
    body: unknown
  ): LocalBridgeCoordinationCreateResponse {
    if (body === null || typeof body !== "object") {
      throw new LocalBridgeRequestFailedError();
    }
    const record = body as {
      replayed?: unknown;
      coordination?: unknown;
      rootAssignment?: unknown;
      projection?: unknown;
    };
    if (
      typeof record.replayed !== "boolean" ||
      record.coordination === undefined ||
      record.rootAssignment === undefined
    ) {
      throw new LocalBridgeRequestFailedError();
    }
    return Object.freeze({
      replayed: record.replayed,
      coordination: record.coordination,
      rootAssignment: record.rootAssignment,
      ...(record.projection === undefined ? {} : { projection: record.projection })
    });
  }

  function parseCoordinationContinueResponse(
    body: unknown
  ): LocalBridgeCoordinationContinueResponse {
    const created = parseCoordinationCreateResponse(body);
    if (body === null || typeof body !== "object") {
      throw new LocalBridgeRequestFailedError();
    }
    const checkAssignment = (body as { checkAssignment?: unknown }).checkAssignment;
    if (checkAssignment === undefined) {
      throw new LocalBridgeRequestFailedError();
    }
    return Object.freeze({
      ...created,
      checkAssignment
    });
  }

  return Object.freeze({
    async getGrant() {
      const body = await bridgeGet("/local-mcp/v1/grant");
      if (
        body === null ||
        typeof body !== "object" ||
        !("grant" in body) ||
        (body as { grant?: unknown }).grant === undefined
      ) {
        throw new LocalBridgeRequestFailedError();
      }
      return (body as { grant: unknown }).grant;
    },
    async listStoryWork() {
      return bridgeGet("/local-mcp/v1/story-work");
    },
    async getStoryWork(assignmentId: string) {
      const normalized = assignmentId.trim();
      if (normalized.length === 0 || normalized.length > 200) {
        throw new LocalBridgeNotFoundError();
      }
      return bridgeGet(
        `/local-mcp/v1/story-work/${encodeURIComponent(normalized)}`
      );
    },
    async listStoryWorkCoordinations() {
      return bridgeGet("/local-mcp/v1/coordinations");
    },
    async getStoryWorkCoordination(coordinationId: string) {
      const normalized = coordinationId.trim();
      if (normalized.length === 0 || normalized.length > 200) {
        throw new LocalBridgeNotFoundError();
      }
      return bridgeGet(
        `/local-mcp/v1/coordinations/${encodeURIComponent(normalized)}`
      );
    },
    submitCharacterWork(body) {
      return bridgePost("/local-mcp/v1/story-work/character", body);
    },
    submitSceneWork(body) {
      return bridgePost("/local-mcp/v1/story-work/scene", body);
    },
    submitCheckWork(body) {
      return bridgePost("/local-mcp/v1/story-work/check", body);
    },
    submitStructureWork(body) {
      return bridgePost("/local-mcp/v1/story-work/structure", body);
    },
    async previewStoryStructure(body) {
      const parsed = await bridgePostJson(
        "/local-mcp/v1/story-work/structure/preview",
        body
      );
      return parsePreviewResponse(parsed);
    },
    async createStoryWorkCoordination(body) {
      const parsed = await bridgePostJson("/local-mcp/v1/coordinations", body);
      return parseCoordinationCreateResponse(parsed);
    },
    async continueStoryWorkCoordinationStep(coordinationId, stepId, body) {
      const normalizedCoordinationId = coordinationId.trim();
      const normalizedStepId = stepId.trim();
      if (
        normalizedCoordinationId.length === 0 ||
        normalizedCoordinationId.length > 200 ||
        normalizedStepId.length === 0 ||
        normalizedStepId.length > 200
      ) {
        throw new LocalBridgeNotFoundError();
      }
      const parsed = await bridgePostJson(
        `/local-mcp/v1/coordinations/${encodeURIComponent(normalizedCoordinationId)}/steps/${encodeURIComponent(normalizedStepId)}/continue`,
        body
      );
      return parseCoordinationContinueResponse(parsed);
    },
    async readCapture(captureIdValue) {
      const normalized = normalizeBridgeResourceId(captureIdValue);
      return bridgeGet(
        `/local-mcp/v1/captures/${encodeURIComponent(normalized)}`
      );
    },
    async assembleCaptureReflectionContext(captureIdValue) {
      const normalized = normalizeBridgeResourceId(captureIdValue);
      return bridgePostJson(
        `/local-mcp/v1/captures/${encodeURIComponent(normalized)}/context`,
        {}
      );
    },
    async proposeCaptureReflection(captureIdValue) {
      const normalized = normalizeBridgeResourceId(captureIdValue);
      return bridgePostJson(
        `/local-mcp/v1/captures/${encodeURIComponent(normalized)}/proposals`,
        {}
      );
    }
  });
}
