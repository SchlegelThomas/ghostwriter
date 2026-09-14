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
  type BookId,
  type CaptureId,
  type ProjectId,
  type SceneId
} from "./domain.js";
import { StoryWorkAssignmentNotFoundError } from "./character-story-work-services.js";
import {
  ProjectAccessDeniedError,
  requireProjectOwner,
  type AccountId
} from "./identity.js";
import type { McpGrantRepository } from "./mcp-grant-repository.js";
import {
  createMcpGrantRecord,
  createMcpGrantTokenHint,
  grantAllowsAssignment,
  grantAllowsCoordination,
  grantAllowsCapture,
  isMcpGrantActive,
  mcpGrantEffectiveViewFromRecord,
  mcpGrantId,
  mcpGrantSummaryFromRecord,
  mcpGrantTokenHash,
  normalizeMcpGrantResourceFields,
  normalizeMcpGrantTools,
  McpGrantCaptureDeniedError,
  McpGrantNotFoundError,
  McpGrantResourceDeniedError,
  requireGrantAllowsAssignment,
  requireGrantAllowsCoordination,
  requireGrantAllowsTool,
  type McpGrantEffectiveView,
  type McpGrantId,
  type McpGrantRecord,
  type McpGrantSummary,
  type McpGrantTokenPort,
  type McpGrantToolName,
  type McpStoryWorkOrigin
} from "./mcp-grants.js";
import type { Clock, IdGenerator, ProjectRepository } from "./project-repository.js";
import type { StoryWorkAssignmentRepository } from "./story-work-assignment-repository.js";
import type { StoryWorkAssignmentId } from "./story-work-assignment.js";
import {
  StoryWorkCoordinationNotFoundError,
  type StoryWorkCoordinationId
} from "./story-work-coordination.js";
import type { StoryWorkCoordinationRepository } from "./story-work-coordination-repository.js";

export type CreateMcpGrantResult = Readonly<{
  grant: McpGrantSummary;
  token: string;
}>;

export type McpGrantCaptureReflectionProviderFactory = (
  receipt: ContextReceipt
) =>
  | CaptureReflectionStructuredCompletionProvider
  | Promise<CaptureReflectionStructuredCompletionProvider>;

export type ProposeCaptureReflectionUnderTokenInput = Readonly<
  {
    token: string;
    captureId: CaptureId;
    signal?: AbortSignal;
  } & (
    | {
        provider: CaptureReflectionStructuredCompletionProvider;
        createProvider?: undefined;
      }
    | {
        provider?: undefined;
        createProvider: McpGrantCaptureReflectionProviderFactory;
      }
  )
>;

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
    captureIds?: readonly string[];
    sceneIds?: readonly string[];
    bookIds?: readonly string[];
    assignmentIds?: readonly string[];
    coordinationIds?: readonly string[];
    allowProjectStructureRead?: boolean;
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
  resolveActiveGrantRecordFromToken(token: string): Promise<McpGrantRecord>;
  getGrantUnderToken(token: string): Promise<McpGrantEffectiveView>;
  requireToolUnderToken(input: Readonly<{
    token: string;
    tool: McpGrantToolName;
  }>): Promise<McpGrantRecord>;
  assertAssignmentReadableUnderGrant(input: Readonly<{
    record: McpGrantRecord;
    assignmentId: StoryWorkAssignmentId;
  }>): Promise<void>;
  assertCoordinationReadableUnderGrant(input: Readonly<{
    record: McpGrantRecord;
    coordinationId: StoryWorkCoordinationId;
  }>): Promise<void>;
  readCaptureUnderToken(input: Readonly<{
    token: string;
    captureId: CaptureId;
  }>): Promise<McpGrantedCapturePlainSummary>;
  assembleCaptureReflectionContextUnderToken(input: Readonly<{
    token: string;
    captureId: CaptureId;
  }>): Promise<ContextReceipt>;
  proposeCaptureReflectionUnderToken(
    input: ProposeCaptureReflectionUnderTokenInput
  ): Promise<StartCaptureReflectionResult>;
}>;

export type McpGrantServiceDependencies = Readonly<{
  projects: ProjectRepository;
  grants: McpGrantRepository;
  captureDocuments: CaptureDocumentRepository;
  captureReflection: CaptureReflectionServices;
  storyWorkAssignments: StoryWorkAssignmentRepository;
  storyWorkCoordinations: StoryWorkCoordinationRepository;
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
): Promise<McpGrantRecord> {
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
): Promise<McpGrantRecord> {
  const record = await resolveActiveRecord(dependencies, token);
  requireGrantAllowsTool(record, tool);
  return record;
}

async function resolveCaptureReflectionProviderForPropose(input: Readonly<{
  receipt: ContextReceipt;
  provider?: CaptureReflectionStructuredCompletionProvider;
  createProvider?: McpGrantCaptureReflectionProviderFactory;
}>): Promise<CaptureReflectionStructuredCompletionProvider> {
  const hasProvider = input.provider !== undefined;
  const hasFactory = input.createProvider !== undefined;
  if (hasProvider === hasFactory) {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "MCP capture reflection propose requires exactly one provider mode."
    );
  }
  if (input.provider !== undefined) {
    return input.provider;
  }
  return input.createProvider!(input.receipt);
}

async function requireGrantedCaptureHead(
  dependencies: McpGrantServiceDependencies,
  record: McpGrantRecord,
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

async function validateGrantResourceReferences(
  dependencies: McpGrantServiceDependencies,
  input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
    captureIds: readonly CaptureId[];
    sceneIds: readonly SceneId[];
    bookIds: readonly BookId[];
    assignmentIds: readonly StoryWorkAssignmentId[];
    coordinationIds: readonly StoryWorkCoordinationId[];
  }>
): Promise<void> {
  for (const id of input.captureIds) {
    const head = await dependencies.captureDocuments.get(id);
    if (head === undefined || head.projectId !== input.projectId) {
      throw new CaptureNotFoundError();
    }
  }

  const [books, scenes] = await Promise.all([
    dependencies.projects.listBooks(input.projectId),
    dependencies.projects.listScenes(input.projectId)
  ]);
  const bookSet = new Set(books.map((book) => book.id));
  const sceneSet = new Set(scenes.map((scene) => scene.id));
  for (const id of input.bookIds) {
    const book = books.find((candidate) => candidate.id === id);
    if (!bookSet.has(id) || book === undefined || book.archivedAt !== undefined) {
      throw new DomainValidationError(
        "UNKNOWN_REFERENCE",
        "MCP grant book allowlist references an unavailable book."
      );
    }
  }
  for (const id of input.sceneIds) {
    const scene = scenes.find((candidate) => candidate.id === id);
    if (!sceneSet.has(id) || scene === undefined || scene.archivedAt !== undefined) {
      throw new DomainValidationError(
        "UNKNOWN_REFERENCE",
        "MCP grant scene allowlist references an unavailable scene."
      );
    }
  }

  for (const assignmentId of input.assignmentIds) {
    const assignment = await dependencies.storyWorkAssignments.get({
      accountId: input.accountId,
      projectId: input.projectId,
      assignmentId
    });
    if (assignment === undefined) {
      throw new StoryWorkAssignmentNotFoundError();
    }
  }

  for (const coordinationId of input.coordinationIds) {
    const coordination = await dependencies.storyWorkCoordinations.get({
      accountId: input.accountId,
      projectId: input.projectId,
      coordinationId
    });
    if (coordination === undefined || coordination.status !== "active") {
      throw new StoryWorkCoordinationNotFoundError();
    }
  }
}

export function createMcpGrantServices(
  dependencies: McpGrantServiceDependencies
): McpGrantServices {
  return Object.freeze({
    async createGrant(input) {
      await requireOwnedProject(dependencies, input.accountId, input.projectId);
      const resources = normalizeMcpGrantResourceFields(input);
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

      await validateGrantResourceReferences(dependencies, {
        accountId: input.accountId,
        projectId: input.projectId,
        captureIds: resources.captureIds,
        sceneIds: resources.sceneIds,
        bookIds: resources.bookIds,
        assignmentIds: resources.assignmentIds,
        coordinationIds: resources.coordinationIds
      });

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
        ...resources,
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

    async resolveActiveGrantRecordFromToken(token) {
      return resolveActiveRecord(dependencies, token);
    },

    async getGrantUnderToken(token) {
      const record = await requireTool(
        dependencies,
        token,
        "ghostwriter_get_grant"
      );
      return mcpGrantEffectiveViewFromRecord(record);
    },

    async requireToolUnderToken(input) {
      return requireTool(dependencies, input.token, input.tool);
    },

    async assertAssignmentReadableUnderGrant(input) {
      const assignment = await dependencies.storyWorkAssignments.get({
        accountId: input.record.accountId,
        projectId: input.record.projectId,
        assignmentId: input.assignmentId
      });
      if (assignment === undefined) {
        throw new StoryWorkAssignmentNotFoundError();
      }
      requireGrantAllowsAssignment(
        input.record,
        input.assignmentId,
        assignment.origin
      );
    },

    async assertCoordinationReadableUnderGrant(input) {
      const coordination = await dependencies.storyWorkCoordinations.get({
        accountId: input.record.accountId,
        projectId: input.record.projectId,
        coordinationId: input.coordinationId
      });
      if (coordination === undefined) {
        throw new StoryWorkCoordinationNotFoundError();
      }
      requireGrantAllowsCoordination(
        input.record,
        input.coordinationId,
        coordination.origin
      );
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
      const provider = await resolveCaptureReflectionProviderForPropose({
        receipt,
        ...(input.provider === undefined ? {} : { provider: input.provider }),
        ...(input.createProvider === undefined
          ? {}
          : { createProvider: input.createProvider })
      });
      return dependencies.captureReflection.start({
        accountId: record.accountId,
        projectId: record.projectId,
        receiptId: receipt.id,
        expectedReceiptHash: receipt.receiptHash,
        provider,
        ...(input.signal === undefined ? {} : { signal: input.signal })
      });
    }
  });
}

export {
  grantAllowsAssignment,
  grantAllowsCoordination,
  McpGrantResourceDeniedError,
  type McpStoryWorkOrigin
};
