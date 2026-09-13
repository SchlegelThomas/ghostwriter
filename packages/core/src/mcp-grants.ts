import {
  DomainValidationError,
  bookId,
  captureId,
  sceneId,
  type BookId,
  type CaptureId,
  type ProjectId,
  type SceneId
} from "./domain.js";
import type { AccountId } from "./identity.js";
import type { StoryWorkAssignmentId } from "./story-work-assignment.js";
import type { StoryWorkCoordinationId } from "./story-work-coordination.js";

type BrandedId<Name extends string> = string & { readonly __brand: Name };

export type McpGrantId = BrandedId<"McpGrantId">;

export function mcpGrantId(value: string): McpGrantId {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new DomainValidationError("EMPTY_VALUE", "MCP grant ID must not be empty.");
  }
  return normalized as McpGrantId;
}

export const MCP_GRANT_CAPTURE_TOOL_NAMES = Object.freeze([
  "ghostwriter_read_capture",
  "ghostwriter_assemble_capture_reflection_context",
  "ghostwriter_propose_capture_reflection"
] as const);

export type McpGrantCaptureToolName = (typeof MCP_GRANT_CAPTURE_TOOL_NAMES)[number];

export const MCP_GRANT_STORY_WORK_TOOL_NAMES = Object.freeze([
  "ghostwriter_list_story_work",
  "ghostwriter_get_story_work",
  "ghostwriter_submit_character_work",
  "ghostwriter_submit_scene_work",
  "ghostwriter_submit_check_work",
  "ghostwriter_submit_structure_work",
  "ghostwriter_preview_story_structure",
  "ghostwriter_list_story_work_coordinations",
  "ghostwriter_get_story_work_coordination",
  "ghostwriter_create_story_work_coordination",
  "ghostwriter_continue_story_work_coordination"
] as const);

export type McpGrantStoryWorkToolName = (typeof MCP_GRANT_STORY_WORK_TOOL_NAMES)[number];

export const MCP_GRANT_DISCOVERY_TOOL_NAME = "ghostwriter_get_grant" as const;

export const MCP_GRANT_TOOL_NAMES = Object.freeze(
  [
    MCP_GRANT_DISCOVERY_TOOL_NAME,
    ...MCP_GRANT_CAPTURE_TOOL_NAMES,
    ...MCP_GRANT_STORY_WORK_TOOL_NAMES
  ].sort()
);

export type McpGrantToolName = (typeof MCP_GRANT_TOOL_NAMES)[number];

const MCP_GRANT_TOOL_SET = new Set<string>(MCP_GRANT_TOOL_NAMES);
const MCP_GRANT_CAPTURE_TOOL_SET = new Set<string>(MCP_GRANT_CAPTURE_TOOL_NAMES);
const MCP_GRANT_STORY_WORK_TOOL_SET = new Set<string>(MCP_GRANT_STORY_WORK_TOOL_NAMES);

export const MCP_GRANT_MAX_CAPTURE_IDS = 64;
export const MCP_GRANT_MAX_SCENE_IDS = 100;
export const MCP_GRANT_MAX_BOOK_IDS = 100;
export const MCP_GRANT_MAX_ASSIGNMENT_IDS = 100;
export const MCP_GRANT_MAX_COORDINATION_IDS = 100;

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

export type McpStoryWorkOrigin = Readonly<{
  kind: "mcp";
  grantId: McpGrantId;
}>;

export function normalizeMcpStoryWorkOrigin(
  value: unknown
): McpStoryWorkOrigin | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "object" || value === null) {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "Story work MCP origin is invalid."
    );
  }
  const candidate = value as { kind?: unknown; grantId?: unknown };
  if (candidate.kind !== "mcp") {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "Story work MCP origin kind is invalid."
    );
  }
  return Object.freeze({
    kind: "mcp" as const,
    grantId: mcpGrantId(String(candidate.grantId))
  });
}

export function mcpStoryWorkOriginsEqual(
  left: McpStoryWorkOrigin | undefined,
  right: McpStoryWorkOrigin | undefined
): boolean {
  if (left === undefined && right === undefined) return true;
  if (left === undefined || right === undefined) return false;
  return left.kind === right.kind && left.grantId === right.grantId;
}

export type McpGrantResourceFields = Readonly<{
  captureIds: readonly CaptureId[];
  sceneIds: readonly SceneId[];
  bookIds: readonly BookId[];
  assignmentIds: readonly StoryWorkAssignmentId[];
  coordinationIds: readonly StoryWorkCoordinationId[];
  allowProjectStructureRead: boolean;
}>;

export type McpGrantRecord = Readonly<
  {
    id: McpGrantId;
    accountId: AccountId;
    projectId: ProjectId;
    tools: readonly McpGrantToolName[];
    tokenHash: McpGrantTokenHash;
    tokenHint: string;
    expiresAt: string;
    createdAt: string;
    updatedAt: string;
    revokedAt?: string;
  } & McpGrantResourceFields
>;

/** Safe grant view for owners and MCP discovery — never includes token material. */
export type McpGrantSummary = Readonly<
  {
    id: McpGrantId;
    accountId: AccountId;
    projectId: ProjectId;
    tools: readonly McpGrantToolName[];
    tokenHint: string;
    expiresAt: string;
    createdAt: string;
    updatedAt: string;
    revokedAt?: string;
  } & McpGrantResourceFields
>;

/** Effective grant discovered by an MCP client under a token — no global project listing. */
export type McpGrantEffectiveView = Readonly<
  {
    id: McpGrantId;
    projectId: ProjectId;
    tools: readonly McpGrantToolName[];
    expiresAt: string;
  } & McpGrantResourceFields
>;

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

export class McpGrantResourceDeniedError extends Error {
  constructor() {
    super("MCP grant does not allow this resource.");
    this.name = "McpGrantResourceDeniedError";
  }
}

function requireIdentifier(value: string, label: string): string {
  if (typeof value !== "string") {
    throw new DomainValidationError("EMPTY_VALUE", `${label} ID must be a string.`);
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new DomainValidationError("EMPTY_VALUE", `${label} ID must not be empty.`);
  }
  if (normalized.length > 200) {
    throw new DomainValidationError("VALUE_TOO_LONG", `${label} ID is too long.`);
  }
  return normalized;
}

function storyWorkAssignmentId(value: string): StoryWorkAssignmentId {
  return requireIdentifier(value, "Story work assignment") as StoryWorkAssignmentId;
}

function storyWorkCoordinationId(value: string): StoryWorkCoordinationId {
  return requireIdentifier(value, "Story work coordination") as StoryWorkCoordinationId;
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

export function isMcpGrantCaptureTool(tool: McpGrantToolName): tool is McpGrantCaptureToolName {
  return MCP_GRANT_CAPTURE_TOOL_SET.has(tool);
}

export function isMcpGrantStoryWorkTool(
  tool: McpGrantToolName
): tool is McpGrantStoryWorkToolName {
  return MCP_GRANT_STORY_WORK_TOOL_SET.has(tool);
}

export function grantUsesCaptureTools(
  tools: readonly McpGrantToolName[]
): boolean {
  return tools.some((tool) => isMcpGrantCaptureTool(tool));
}

export function grantUsesStoryWorkTools(
  tools: readonly McpGrantToolName[]
): boolean {
  return tools.some((tool) => isMcpGrantStoryWorkTool(tool));
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

function normalizeBoundedIdList<T extends string>(
  values: readonly string[] | undefined,
  label: string,
  maximum: number,
  mapValue: (value: string) => T
): readonly T[] {
  const source = values ?? [];
  if (!Array.isArray(source)) {
    throw new DomainValidationError("UNKNOWN_REFERENCE", `${label} must be an array.`);
  }
  if (source.length > maximum) {
    throw new DomainValidationError(
      "VALUE_TOO_LONG",
      `${label} allowlist is too large.`
    );
  }
  const seen = new Set<string>();
  const normalized: T[] = [];
  for (const value of source) {
    const next = mapValue(value);
    if (seen.has(next)) {
      throw new DomainValidationError(
        "DUPLICATE_REFERENCE",
        `${label} allowlist must not contain duplicate entries.`
      );
    }
    seen.add(next);
    normalized.push(next);
  }
  normalized.sort();
  return Object.freeze(normalized);
}

export function normalizeMcpGrantCaptureIds(
  captureIds: readonly string[] | undefined,
  options?: Readonly<{ allowEmpty?: boolean }>
): readonly CaptureId[] {
  const allowEmpty = options?.allowEmpty ?? false;
  const normalized = normalizeBoundedIdList(
    captureIds,
    "MCP grant Capture",
    MCP_GRANT_MAX_CAPTURE_IDS,
    (value) => captureId(value)
  );
  if (!allowEmpty && normalized.length === 0) {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "MCP grant must allow at least one Capture."
    );
  }
  return normalized;
}

export function normalizeMcpGrantSceneIds(
  sceneIds: readonly string[] | undefined
): readonly SceneId[] {
  return normalizeBoundedIdList(
    sceneIds,
    "MCP grant scene",
    MCP_GRANT_MAX_SCENE_IDS,
    (value) => sceneId(value)
  );
}

export function normalizeMcpGrantBookIds(
  bookIds: readonly string[] | undefined
): readonly BookId[] {
  return normalizeBoundedIdList(
    bookIds,
    "MCP grant book",
    MCP_GRANT_MAX_BOOK_IDS,
    (value) => bookId(value)
  );
}

export function normalizeMcpGrantAssignmentIds(
  assignmentIds: readonly string[] | undefined
): readonly StoryWorkAssignmentId[] {
  return normalizeBoundedIdList(
    assignmentIds,
    "MCP grant assignment",
    MCP_GRANT_MAX_ASSIGNMENT_IDS,
    (value) => storyWorkAssignmentId(value)
  );
}

export function normalizeMcpGrantCoordinationIds(
  coordinationIds: readonly string[] | undefined
): readonly StoryWorkCoordinationId[] {
  return normalizeBoundedIdList(
    coordinationIds,
    "MCP grant coordination",
    MCP_GRANT_MAX_COORDINATION_IDS,
    (value) => storyWorkCoordinationId(value)
  );
}

export function normalizeMcpGrantResourceFields(input: Readonly<{
  captureIds?: readonly string[];
  sceneIds?: readonly string[];
  bookIds?: readonly string[];
  assignmentIds?: readonly string[];
  coordinationIds?: readonly string[];
  allowProjectStructureRead?: boolean;
}>): McpGrantResourceFields {
  return Object.freeze({
    captureIds: normalizeMcpGrantCaptureIds(input.captureIds, { allowEmpty: true }),
    sceneIds: normalizeMcpGrantSceneIds(input.sceneIds),
    bookIds: normalizeMcpGrantBookIds(input.bookIds),
    assignmentIds: normalizeMcpGrantAssignmentIds(input.assignmentIds),
    coordinationIds: normalizeMcpGrantCoordinationIds(input.coordinationIds),
    allowProjectStructureRead: input.allowProjectStructureRead === true
  });
}

export function mcpGrantHasAnyResource(fields: McpGrantResourceFields): boolean {
  return (
    fields.captureIds.length > 0 ||
    fields.sceneIds.length > 0 ||
    fields.bookIds.length > 0 ||
    fields.assignmentIds.length > 0 ||
    fields.coordinationIds.length > 0 ||
    fields.allowProjectStructureRead
  );
}

export function validateMcpGrantToolResourceCompatibility(input: Readonly<{
  tools: readonly McpGrantToolName[];
  resources: McpGrantResourceFields;
}>): void {
  if (!mcpGrantHasAnyResource(input.resources)) {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "MCP grant must allow at least one resource or project structure read."
    );
  }
  if (grantUsesCaptureTools(input.tools) && input.resources.captureIds.length === 0) {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "Capture MCP tools require at least one allowed Capture."
    );
  }
  if (
    grantUsesStoryWorkTools(input.tools) &&
    !input.resources.allowProjectStructureRead
  ) {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "Story-work MCP tools require project structure read."
    );
  }
}

export function createMcpGrantRecord(input: McpGrantRecord): McpGrantRecord {
  const tools = normalizeMcpGrantTools(input.tools);
  const resources = normalizeMcpGrantResourceFields(input);
  validateMcpGrantToolResourceCompatibility({ tools, resources });
  return Object.freeze({
    id: mcpGrantId(input.id),
    accountId: input.accountId,
    projectId: input.projectId,
    ...resources,
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
    sceneIds: record.sceneIds,
    bookIds: record.bookIds,
    assignmentIds: record.assignmentIds,
    coordinationIds: record.coordinationIds,
    allowProjectStructureRead: record.allowProjectStructureRead,
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
    sceneIds: record.sceneIds,
    bookIds: record.bookIds,
    assignmentIds: record.assignmentIds,
    coordinationIds: record.coordinationIds,
    allowProjectStructureRead: record.allowProjectStructureRead,
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

export function grantAllowsScene(
  record: McpGrantRecord,
  sceneIdValue: SceneId
): boolean {
  return record.sceneIds.includes(sceneIdValue);
}

export function grantAllowsBook(
  record: McpGrantRecord,
  bookIdValue: BookId
): boolean {
  return record.bookIds.includes(bookIdValue);
}

export function grantAllowsProjectStructureRead(record: McpGrantRecord): boolean {
  return record.allowProjectStructureRead;
}

export function grantOriginMatchesRecord(
  record: McpGrantRecord,
  origin: McpStoryWorkOrigin | undefined
): boolean {
  return origin !== undefined && origin.grantId === record.id;
}

export function grantAllowsAssignment(
  record: McpGrantRecord,
  assignmentId: StoryWorkAssignmentId,
  origin: McpStoryWorkOrigin | undefined
): boolean {
  if (record.assignmentIds.includes(assignmentId)) {
    return true;
  }
  return grantOriginMatchesRecord(record, origin);
}

export function grantAllowsCoordination(
  record: McpGrantRecord,
  coordinationId: StoryWorkCoordinationId,
  origin: McpStoryWorkOrigin | undefined
): boolean {
  if (record.coordinationIds.includes(coordinationId)) {
    return true;
  }
  return grantOriginMatchesRecord(record, origin);
}

export function requireGrantAllowsCapture(
  record: McpGrantRecord,
  captureIdValue: CaptureId
): void {
  if (!grantAllowsCapture(record, captureIdValue)) {
    throw new McpGrantCaptureDeniedError();
  }
}

export function requireGrantAllowsScene(
  record: McpGrantRecord,
  sceneIdValue: SceneId
): void {
  if (!grantAllowsScene(record, sceneIdValue)) {
    throw new McpGrantResourceDeniedError();
  }
}

export function requireGrantAllowsBook(
  record: McpGrantRecord,
  bookIdValue: BookId
): void {
  if (!grantAllowsBook(record, bookIdValue)) {
    throw new McpGrantResourceDeniedError();
  }
}

export function requireGrantAllowsProjectStructureRead(record: McpGrantRecord): void {
  if (!grantAllowsProjectStructureRead(record)) {
    throw new McpGrantResourceDeniedError();
  }
}

export function requireGrantAllowsAssignment(
  record: McpGrantRecord,
  assignmentId: StoryWorkAssignmentId,
  origin: McpStoryWorkOrigin | undefined
): void {
  if (!grantAllowsAssignment(record, assignmentId, origin)) {
    throw new McpGrantResourceDeniedError();
  }
}

export function requireGrantAllowsCoordination(
  record: McpGrantRecord,
  coordinationId: StoryWorkCoordinationId,
  origin: McpStoryWorkOrigin | undefined
): void {
  if (!grantAllowsCoordination(record, coordinationId, origin)) {
    throw new McpGrantResourceDeniedError();
  }
}

export function requireGrantAllowsTool(
  record: McpGrantRecord,
  tool: McpGrantToolName
): void {
  if (!grantAllowsTool(record, tool)) {
    throw new McpGrantToolDeniedError(tool);
  }
}
