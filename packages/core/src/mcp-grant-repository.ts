import type { ProjectId } from "./domain.js";
import type {
  McpGrantId,
  McpGrantRecord,
  McpGrantTokenHash
} from "./mcp-grants.js";

export type InsertMcpGrantOutcome =
  | Readonly<{ ok: true; grant: McpGrantRecord }>
  | Readonly<{ ok: false; reason: "conflict" }>;

export type RevokeMcpGrantOutcome =
  | Readonly<{ ok: true; grant: McpGrantRecord }>
  | Readonly<{ ok: false; reason: "not-found" | "already-revoked" }>;

export interface McpGrantRepository {
  getById(id: McpGrantId): Promise<McpGrantRecord | undefined>;
  getByTokenHash(tokenHash: McpGrantTokenHash): Promise<McpGrantRecord | undefined>;
  listByProject(projectId: ProjectId): Promise<readonly McpGrantRecord[]>;
  insert(grant: McpGrantRecord): Promise<InsertMcpGrantOutcome>;
  revoke(input: Readonly<{
    id: McpGrantId;
    projectId: ProjectId;
    revokedAt: string;
    updatedAt: string;
  }>): Promise<RevokeMcpGrantOutcome>;
}
