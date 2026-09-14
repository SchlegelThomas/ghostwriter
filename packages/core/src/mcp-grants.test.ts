import { describe, expect, it } from "vitest";
import { bookId, captureId, sceneId } from "./domain.js";
import { accountId } from "./identity.js";
import { storyWorkAssignmentId } from "./story-work-assignment.js";
import { storyWorkCoordinationId } from "./story-work-coordination.js";
import {
  MCP_GRANT_CAPTURE_TOOL_NAMES,
  MCP_GRANT_STORY_WORK_TOOL_NAMES,
  MCP_GRANT_TOOL_NAMES,
  createMcpGrantRecord,
  grantAllowsAssignment,
  grantAllowsBook,
  grantAllowsCapture,
  grantAllowsCoordination,
  grantAllowsProjectStructureRead,
  grantAllowsScene,
  grantAllowsTool,
  isMcpGrantActive,
  mcpGrantId,
  mcpGrantTokenHash,
  mcpStoryWorkOriginsEqual,
  normalizeMcpStoryWorkOrigin,
  validateMcpGrantToolResourceCompatibility,
  type McpGrantRecord
} from "./mcp-grants.js";

const OWNER = accountId("account-mcp-grants");
const PROJECT = "project-mcp-grants" as never;
const GRANT = mcpGrantId("grant-mcp-test");
const CAPTURE = captureId("capture-grant-a");
const SCENE = sceneId("scene-grant-a");
const BOOK = bookId("book-grant-a");
const ASSIGNMENT = storyWorkAssignmentId("assignment-grant-a");
const COORDINATION = storyWorkCoordinationId("coordination-grant-a");
const TOKEN_HASH = mcpGrantTokenHash("a".repeat(64));
const NOW = "2026-07-24T23:30:00.000Z";

function baseRecord(
  overrides: Partial<McpGrantRecord> = {}
): McpGrantRecord {
  return createMcpGrantRecord({
    id: GRANT,
    accountId: OWNER,
    projectId: PROJECT,
    captureIds: [CAPTURE],
    sceneIds: [],
    bookIds: [],
    assignmentIds: [],
    coordinationIds: [],
    allowProjectStructureRead: false,
    tools: ["ghostwriter_get_grant", "ghostwriter_read_capture"],
    tokenHash: TOKEN_HASH,
    tokenHint: "…1234",
    expiresAt: "2026-08-01T00:00:00.000Z",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  });
}

describe("MCP grant domain", () => {
  it("keeps the closed tool enum with Capture and story-work names", () => {
    expect(MCP_GRANT_TOOL_NAMES).toHaveLength(15);
    expect([...MCP_GRANT_CAPTURE_TOOL_NAMES]).toEqual([
      "ghostwriter_read_capture",
      "ghostwriter_assemble_capture_reflection_context",
      "ghostwriter_propose_capture_reflection"
    ]);
    expect(MCP_GRANT_STORY_WORK_TOOL_NAMES).toHaveLength(11);
    expect(MCP_GRANT_TOOL_NAMES).toContain("ghostwriter_get_grant");
  });

  it("accepts backward-compatible capture-only grants", () => {
    const record = baseRecord();
    expect(record.captureIds).toEqual([CAPTURE]);
    expect(record.sceneIds).toEqual([]);
    expect(record.allowProjectStructureRead).toBe(false);
  });

  it("accepts story grants without captures when structure read is enabled", () => {
    const record = baseRecord({
      captureIds: [],
      allowProjectStructureRead: true,
      tools: [
        "ghostwriter_get_grant",
        "ghostwriter_list_story_work",
        "ghostwriter_get_story_work"
      ]
    });
    expect(record.captureIds).toEqual([]);
    expect(grantAllowsProjectStructureRead(record)).toBe(true);
  });

  it("accepts mixed capture and story-work grants", () => {
    const record = baseRecord({
      sceneIds: [SCENE],
      allowProjectStructureRead: true,
      tools: [
        "ghostwriter_get_grant",
        "ghostwriter_read_capture",
        "ghostwriter_list_story_work"
      ]
    });
    expect(record.captureIds).toEqual([CAPTURE]);
    expect(record.sceneIds).toEqual([SCENE]);
  });

  it("rejects incompatible tool and resource combinations", () => {
    expect(() =>
      createMcpGrantRecord({
        id: GRANT,
        accountId: OWNER,
        projectId: PROJECT,
        captureIds: [],
        sceneIds: [],
        bookIds: [],
        assignmentIds: [],
        coordinationIds: [],
        allowProjectStructureRead: false,
        tools: ["ghostwriter_read_capture"],
        tokenHash: TOKEN_HASH,
        tokenHint: "…1234",
        expiresAt: "2026-08-01T00:00:00.000Z",
        createdAt: NOW,
        updatedAt: NOW
      })
    ).toThrow();

    expect(() =>
      createMcpGrantRecord({
        id: GRANT,
        accountId: OWNER,
        projectId: PROJECT,
        captureIds: [CAPTURE],
        sceneIds: [],
        bookIds: [],
        assignmentIds: [],
        coordinationIds: [],
        allowProjectStructureRead: false,
        tools: ["ghostwriter_list_story_work"],
        tokenHash: TOKEN_HASH,
        tokenHint: "…1234",
        expiresAt: "2026-08-01T00:00:00.000Z",
        createdAt: NOW,
        updatedAt: NOW
      })
    ).toThrow();

    expect(() =>
      validateMcpGrantToolResourceCompatibility({
        tools: ["ghostwriter_get_grant"],
        resources: {
          captureIds: [],
          sceneIds: [],
          bookIds: [],
          assignmentIds: [],
          coordinationIds: [],
          allowProjectStructureRead: false
        }
      })
    ).toThrow();
  });

  it("sorts unique resource id lists and rejects duplicates", () => {
    const record = baseRecord({
      sceneIds: [sceneId("scene-grant-b"), SCENE],
      bookIds: [BOOK],
      assignmentIds: [ASSIGNMENT],
      coordinationIds: [COORDINATION]
    });
    expect(record.sceneIds).toEqual([SCENE, sceneId("scene-grant-b")].sort());
    expect(record.bookIds).toEqual([BOOK]);
    expect(() =>
      baseRecord({
        sceneIds: [SCENE, SCENE]
      })
    ).toThrow();
  });

  it("tracks active, expired, and revoked grants", () => {
    const active = baseRecord();
    expect(isMcpGrantActive(active, NOW)).toBe(true);
    expect(isMcpGrantActive(active, "2026-08-02T00:00:00.000Z")).toBe(false);
    expect(
      isMcpGrantActive(
        baseRecord({ revokedAt: "2026-07-25T00:00:00.000Z" }),
        NOW
      )
    ).toBe(false);
  });

  it("evaluates explicit and origin-based assignment and coordination access", () => {
    const record = baseRecord({
      captureIds: [],
      allowProjectStructureRead: true,
      assignmentIds: [ASSIGNMENT],
      coordinationIds: [COORDINATION],
      tools: ["ghostwriter_get_grant", "ghostwriter_list_story_work"]
    });
    const origin = normalizeMcpStoryWorkOrigin({ kind: "mcp", grantId: GRANT })!;
    const foreignOrigin = normalizeMcpStoryWorkOrigin({
      kind: "mcp",
      grantId: mcpGrantId("grant-other")
    })!;

    expect(grantAllowsScene(record, SCENE)).toBe(false);
    expect(grantAllowsBook(record, BOOK)).toBe(false);
    expect(grantAllowsAssignment(record, ASSIGNMENT, undefined)).toBe(true);
    expect(
      grantAllowsAssignment(
        record,
        storyWorkAssignmentId("assignment-other"),
        origin
      )
    ).toBe(true);
    expect(
      grantAllowsAssignment(
        record,
        storyWorkAssignmentId("assignment-other"),
        foreignOrigin
      )
    ).toBe(false);
    expect(grantAllowsCoordination(record, COORDINATION, undefined)).toBe(true);
    expect(
      grantAllowsCoordination(
        record,
        storyWorkCoordinationId("coordination-other"),
        origin
      )
    ).toBe(true);
    expect(grantAllowsCapture(record, CAPTURE)).toBe(false);
    expect(grantAllowsTool(record, "ghostwriter_list_story_work")).toBe(true);
  });

  it("normalizes and compares MCP story-work origin", () => {
    const origin = normalizeMcpStoryWorkOrigin({ kind: "mcp", grantId: GRANT });
    expect(origin).toEqual({ kind: "mcp", grantId: GRANT });
    expect(normalizeMcpStoryWorkOrigin(undefined)).toBeUndefined();
    expect(mcpStoryWorkOriginsEqual(origin, origin)).toBe(true);
    expect(mcpStoryWorkOriginsEqual(origin, undefined)).toBe(false);
  });
});
