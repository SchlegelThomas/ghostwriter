import { sliceCaptureProviderText } from "./agent-context-receipt.js";
import type { ContextReceipt } from "./agent-context-receipt.js";
import type {
  CaptureReflectionServices,
  CaptureReflectionStructuredCompletionProvider,
  StartCaptureReflectionResult
} from "./capture-reflection-services.js";
import type { CaptureDocumentRepository } from "./capture-document-repository.js";
import {
  CaptureNotFoundError,
  ProjectArchivedMutationError,
  type CaptureDocumentHead
} from "./capture-documents.js";
import {
  DomainValidationError,
  type CaptureId,
  type ProjectId
} from "./domain.js";
import {
  ProjectAccessDeniedError,
  requireProjectOwner,
  type AccountId
} from "./identity.js";
import type { McpGrantRepository } from "./mcp-grant-repository.js";
import {
  createMcpGrantRecord,
  createMcpGrantTokenHint,
  grantAllowsCapture,
  grantAllowsTool,
  isMcpGrantActive,
  mcpGrantEffectiveViewFromRecord,
  mcpGrantId,
  mcpGrantSummaryFromRecord,
  mcpGrantTokenHash,
  normalizeMcpGrantCaptureIds,
  normalizeMcpGrantTools,
  McpGrantCaptureDeniedError,
  McpGrantNotFoundError,
  McpGrantToolDeniedError,
  type McpGrantEffectiveView,
  type McpGrantId,
  type McpGrantSummary,
  type McpGrantTokenPort,
  type McpGrantToolName
} from "./mcp-grants.js";
import type { Clock, IdGenerator, ProjectRepository } from "./project-repository.js";

export type CreateMcpGrantResult = Readonly<{
  grant: McpGrantSummary;
  token: string;
}>;

export type McpGrantedCapturePlainSummary = Readonly<{
  captureId: CaptureId;
  projectId: ProjectId;
  status: CaptureDocumentHead["status"];
  sourceModality: CaptureDocumentHead["sourceModality"];
  workingVersion: number;
  contentHash: CaptureDocumentHead["contentHash"];
  plainTextSummary: string;
  truncated: boolean;
  updatedAt: string;
}>;

export type McpGrantServices = Readonly<{
  createGrant(input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
    captureIds: readonly string[];
    tools: readonly string[];
    expiresAt: string;
  }>): Promise<CreateMcpGrantResult>;
  listGrants(input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
  }>): Promise<readonly McpGrantSummary[]>;
  revokeGrant(input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
    grantId: McpGrantId;
  }>): Promise<McpGrantSummary>;
  resolveActiveGrantFromToken(token: string): Promise<McpGrantEffectiveView>;
  getGrantUnderToken(token: string): Promise<McpGrantEffectiveView>;
  readCaptureUnderToken(input: Readonly<{
    token: string;
    captureId: CaptureId;
  }>): Promise<McpGrantedCapturePlainSummary>;
  assembleCaptureReflectionContextUnderToken(input: Readonly<{
    token: string;
    captureId: CaptureId;
  }>): Promise<ContextReceipt>;
  proposeCaptureReflectionUnderToken(input: Readonly<{
    token: string;
    captureId: CaptureId;
    provider: CaptureReflectionStructuredCompletionProvider;
    signal?: AbortSignal;
  }>): Promise<StartCaptureReflectionResult>;
}>;

export type McpGrantServiceDependencies = Readonly<{
  projects: ProjectRepository;
  grants: McpGrantRepository;
  captureDocuments: CaptureDocumentRepository;
  captureReflection: CaptureReflectionServices;
  tokens: McpGrantTokenPort;
  ids: IdGenerator;
  clock: Clock;
}>;

async function requireOwnedProject(
  dependencies: McpGrantServiceDependencies,
  accountId: AccountId,
  projectId: ProjectId
): Promise<void> {
  const project = await dependencies.projects.getProject(projectId);
  if (project === undefined) {
    throw new ProjectAccessDeniedError(projectId);
  }
  if (project.archivedAt !== undefined) {
    throw new ProjectArchivedMutationError();
  }
  requireProjectOwner(
    projectId,
    await dependencies.projects.getProjectMembership(projectId, accountId)
  );
}

async function resolveActiveRecord(
  dependencies: McpGrantServiceDependencies,
  token: string
) {
  const normalized = token.trim();
  if (normalized.length === 0) {
    throw new McpGrantNotFoundError();
  }
  let tokenHash;
  try {
    tokenHash = await dependencies.tokens.hash(normalized);
  } catch {
    throw new McpGrantNotFoundError();
  }
  const record = await dependencies.grants.getByTokenHash(tokenHash);
  const now = dependencies.clock.now();
  if (record === undefined || !isMcpGrantActive(record, now)) {
    throw new McpGrantNotFoundError();
  }
  const project = await dependencies.projects.getProject(record.projectId);
  if (project === undefined || project.archivedAt !== undefined) {
    throw new McpGrantNotFoundError();
  }
  return record;
}

async function requireTool(
  dependencies: McpGrantServiceDependencies,
  token: string,
  tool: McpGrantToolName
) {
  const record = await resolveActiveRecord(dependencies, token);
  if (!grantAllowsTool(record, tool)) {
    throw new McpGrantToolDeniedError(tool);
  }
  return record;
}

async function requireGrantedCaptureHead(
  dependencies: McpGrantServiceDependencies,
  record: Awaited<ReturnType<typeof resolveActiveRecord>>,
  captureIdValue: CaptureId
): Promise<CaptureDocumentHead> {
  if (!grantAllowsCapture(record, captureIdValue)) {
    throw new McpGrantCaptureDeniedError();
  }
  const head = await dependencies.captureDocuments.get(captureIdValue);
  if (head === undefined || head.projectId !== record.projectId) {
    throw new CaptureNotFoundError();
  }
  return head;
}

export function createMcpGrantServices(
  dependencies: McpGrantServiceDependencies
): McpGrantServices {
  return Object.freeze({
    async createGrant(input) {
      await requireOwnedProject(dependencies, input.accountId, input.projectId);
      const captureIds = normalizeMcpGrantCaptureIds(input.captureIds);
      const tools = normalizeMcpGrantTools(input.tools);
      const expiresAt = new Date(input.expiresAt.trim()).toISOString();
      if (Number.isNaN(Date.parse(expiresAt))) {
        throw new DomainValidationError(
          "INVALID_AGENT_POLICY",
          "MCP grant expiry must be a valid ISO-8601 timestamp."
        );
      }
      const now = dependencies.clock.now();
      if (Date.parse(expiresAt) <= Date.parse(now)) {
        throw new DomainValidationError(
          "INVALID_AGENT_POLICY",
          "MCP grant expiry must be in the future."
        );
      }

      for (const id of captureIds) {
        const head = await dependencies.captureDocuments.get(id);
        if (head === undefined || head.projectId !== input.projectId) {
          throw new CaptureNotFoundError();
        }
      }

      const plaintext = dependencies.tokens.mintPlaintext().trim();
      if (plaintext.length < 24) {
        throw new DomainValidationError(
          "INVALID_AGENT_POLICY",
          "MCP grant token mint produced an insecure token."
        );
      }
      const tokenHash = await dependencies.tokens.hash(plaintext);
      const grant = createMcpGrantRecord({
        id: mcpGrantId(dependencies.ids.create("mcpGrant")),
        accountId: input.accountId,
        projectId: input.projectId,
        captureIds,
        tools,
        tokenHash: mcpGrantTokenHash(tokenHash),
        tokenHint: createMcpGrantTokenHint(plaintext),
        expiresAt,
        createdAt: now,
        updatedAt: now
      });
      const inserted = await dependencies.grants.insert(grant);
      if (!inserted.ok) {
        throw new DomainValidationError(
          "DUPLICATE_ID",
          "MCP grant could not be created."
        );
      }
      return Object.freeze({
        grant: mcpGrantSummaryFromRecord(inserted.grant),
        token: plaintext
      });
    },

    async listGrants(input) {
      await requireOwnedProject(dependencies, input.accountId, input.projectId);
      const grants = await dependencies.grants.listByProject(input.projectId);
      return Object.freeze(grants.map(mcpGrantSummaryFromRecord));
    },

    async revokeGrant(input) {
      await requireOwnedProject(dependencies, input.accountId, input.projectId);
      const now = dependencies.clock.now();
      const revoked = await dependencies.grants.revoke({
        id: input.grantId,
        projectId: input.projectId,
        revokedAt: now,
        updatedAt: now
      });
      if (!revoked.ok) {
        throw new McpGrantNotFoundError();
      }
      return mcpGrantSummaryFromRecord(revoked.grant);
    },

    async resolveActiveGrantFromToken(token) {
      const record = await resolveActiveRecord(dependencies, token);
      return mcpGrantEffectiveViewFromRecord(record);
    },

    async getGrantUnderToken(token) {
      const record = await requireTool(
        dependencies,
        token,
        "ghostwriter_get_grant"
      );
      return mcpGrantEffectiveViewFromRecord(record);
    },

    async readCaptureUnderToken(input) {
      const record = await requireTool(
        dependencies,
        input.token,
        "ghostwriter_read_capture"
      );
      const head = await requireGrantedCaptureHead(
        dependencies,
        record,
        input.captureId
      );
      const slice = sliceCaptureProviderText(head.document);
      return Object.freeze({
        captureId: head.captureId,
        projectId: head.projectId,
        status: head.status,
        sourceModality: head.sourceModality,
        workingVersion: head.workingVersion,
        contentHash: head.contentHash,
        plainTextSummary: slice.providerPlainText,
        truncated: slice.truncated,
        updatedAt: head.updatedAt
      });
    },

    async assembleCaptureReflectionContextUnderToken(input) {
      const record = await requireTool(
        dependencies,
        input.token,
        "ghostwriter_assemble_capture_reflection_context"
      );
      await requireGrantedCaptureHead(dependencies, record, input.captureId);
      return dependencies.captureReflection.preview({
        accountId: record.accountId,
        projectId: record.projectId,
        captureId: input.captureId
      });
    },

    async proposeCaptureReflectionUnderToken(input) {
      const record = await requireTool(
        dependencies,
        input.token,
        "ghostwriter_propose_capture_reflection"
      );
      await requireGrantedCaptureHead(dependencies, record, input.captureId);
      const receipt = await dependencies.captureReflection.preview({
        accountId: record.accountId,
        projectId: record.projectId,
        captureId: input.captureId
      });
      return dependencies.captureReflection.start({
        accountId: record.accountId,
        projectId: record.projectId,
        receiptId: receipt.id,
        expectedReceiptHash: receipt.receiptHash,
        provider: input.provider,
        ...(input.signal === undefined ? {} : { signal: input.signal })
      });
    }
  });
}
