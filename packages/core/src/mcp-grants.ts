import {
  DomainValidationError,
  captureId,
  type CaptureId,
  type ProjectId
} from "./domain.js";
import type { AccountId } from "./identity.js";

type BrandedId<Name extends string> = string & { readonly __brand: Name };

export type McpGrantId = BrandedId<"McpGrantId">;

export function mcpGrantId(value: string): McpGrantId {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new DomainValidationError("EMPTY_VALUE", "MCP grant ID must not be empty.");
  }
  return normalized as McpGrantId;
}

export const MCP_GRANT_TOOL_NAMES = Object.freeze([
  "ghostwriter_get_grant",
  "ghostwriter_read_capture",
  "ghostwriter_assemble_capture_reflection_context",
  "ghostwriter_propose_capture_reflection"
] as const);

export type McpGrantToolName = (typeof MCP_GRANT_TOOL_NAMES)[number];

const MCP_GRANT_TOOL_SET = new Set<string>(MCP_GRANT_TOOL_NAMES);

export type McpGrantTokenHash = string & { readonly __brand: "McpGrantTokenHash" };

export function mcpGrantTokenHash(value: string): McpGrantTokenHash {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(normalized)) {
    throw new DomainValidationError(
      "EMPTY_VALUE",
      "MCP grant token hash must be a SHA-256 digest."
    );
  }
  return normalized as McpGrantTokenHash;
}

export type McpGrantRecord = Readonly<{
  id: McpGrantId;
  accountId: AccountId;
  projectId: ProjectId;
  captureIds: readonly CaptureId[];
  tools: readonly McpGrantToolName[];
  tokenHash: McpGrantTokenHash;
  tokenHint: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  revokedAt?: string;
}>;

/** Safe grant view for owners and MCP discovery — never includes token material. */
export type McpGrantSummary = Readonly<{
  id: McpGrantId;
  accountId: AccountId;
  projectId: ProjectId;
  captureIds: readonly CaptureId[];
  tools: readonly McpGrantToolName[];
  tokenHint: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  revokedAt?: string;
}>;

/** Effective grant discovered by an MCP client under a token — no global project listing. */
export type McpGrantEffectiveView = Readonly<{
  id: McpGrantId;
  projectId: ProjectId;
  captureIds: readonly CaptureId[];
  tools: readonly McpGrantToolName[];
  expiresAt: string;
}>;

export type McpGrantTokenPort = Readonly<{
  mintPlaintext(): string;
  hash(plaintext: string): Promise<McpGrantTokenHash>;
}>;

export class McpGrantNotFoundError extends Error {
  constructor() {
    super("MCP grant not found.");
    this.name = "McpGrantNotFoundError";
  }
}

export class McpGrantToolDeniedError extends Error {
  readonly tool: McpGrantToolName;

  constructor(tool: McpGrantToolName) {
    super("MCP grant does not allow this tool.");
    this.name = "McpGrantToolDeniedError";
    this.tool = tool;
  }
}

export class McpGrantCaptureDeniedError extends Error {
  constructor() {
    super("MCP grant does not allow this Capture.");
    this.name = "McpGrantCaptureDeniedError";
  }
}

function requireIsoTimestamp(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length === 0 || Number.isNaN(Date.parse(normalized))) {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      `${field} must be a valid ISO-8601 timestamp.`
    );
  }
  return new Date(normalized).toISOString();
}

function requireTokenHint(value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 16) {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "MCP grant token hint is invalid."
    );
  }
  return normalized;
}

export function createMcpGrantTokenHint(plaintextToken: string): string {
  const normalized = plaintextToken.trim();
  if (normalized.length < 8) {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "MCP grant token is too short."
    );
  }
  return `…${normalized.slice(-4)}`;
}

export function assertMcpGrantToolName(value: string): McpGrantToolName {
  if (!MCP_GRANT_TOOL_SET.has(value)) {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "MCP grant tool is not recognized."
    );
  }
  return value as McpGrantToolName;
}

export function normalizeMcpGrantTools(
  tools: readonly string[]
): readonly McpGrantToolName[] {
  if (tools.length === 0) {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "MCP grant must allow at least one tool."
    );
  }
  const normalized = Object.freeze(
    [...new Set(tools.map((tool) => assertMcpGrantToolName(tool)))].sort()
  );
  return normalized as readonly McpGrantToolName[];
}

export function normalizeMcpGrantCaptureIds(
  captureIds: readonly string[]
): readonly CaptureId[] {
  if (captureIds.length === 0) {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "MCP grant must allow at least one Capture."
    );
  }
  if (captureIds.length > 64) {
    throw new DomainValidationError(
      "VALUE_TOO_LONG",
      "MCP grant Capture allowlist is too large."
    );
  }
  const normalized = Object.freeze([
    ...new Set(captureIds.map((id) => captureId(id)))
  ].sort());
  return normalized as readonly CaptureId[];
}

export function createMcpGrantRecord(input: McpGrantRecord): McpGrantRecord {
  const captureIds = normalizeMcpGrantCaptureIds(input.captureIds);
  const tools = normalizeMcpGrantTools(input.tools);
  return Object.freeze({
    id: mcpGrantId(input.id),
    accountId: input.accountId,
    projectId: input.projectId,
    captureIds,
    tools,
    tokenHash: mcpGrantTokenHash(input.tokenHash),
    tokenHint: requireTokenHint(input.tokenHint),
    expiresAt: requireIsoTimestamp(input.expiresAt, "expiresAt"),
    createdAt: requireIsoTimestamp(input.createdAt, "createdAt"),
    updatedAt: requireIsoTimestamp(input.updatedAt, "updatedAt"),
    ...(input.revokedAt === undefined
      ? {}
      : { revokedAt: requireIsoTimestamp(input.revokedAt, "revokedAt") })
  });
}

export function mcpGrantSummaryFromRecord(record: McpGrantRecord): McpGrantSummary {
  return Object.freeze({
    id: record.id,
    accountId: record.accountId,
    projectId: record.projectId,
    captureIds: record.captureIds,
    tools: record.tools,
    tokenHint: record.tokenHint,
    expiresAt: record.expiresAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(record.revokedAt === undefined ? {} : { revokedAt: record.revokedAt })
  });
}

export function mcpGrantEffectiveViewFromRecord(
  record: McpGrantRecord
): McpGrantEffectiveView {
  return Object.freeze({
    id: record.id,
    projectId: record.projectId,
    captureIds: record.captureIds,
    tools: record.tools,
    expiresAt: record.expiresAt
  });
}

export function isMcpGrantActive(
  record: McpGrantRecord,
  nowIso: string
): boolean {
  if (record.revokedAt !== undefined) return false;
  return Date.parse(record.expiresAt) > Date.parse(nowIso);
}

export function grantAllowsTool(
  record: McpGrantRecord,
  tool: McpGrantToolName
): boolean {
  return record.tools.includes(tool);
}

export function grantAllowsCapture(
  record: McpGrantRecord,
  captureIdValue: CaptureId
): boolean {
  return record.captureIds.includes(captureIdValue);
}
