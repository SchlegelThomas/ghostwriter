import {
  CaptureNotFoundError,
  DomainValidationError,
  McpGrantNotFoundError,
  ProjectAccessDeniedError,
  ProjectArchivedMutationError,
  type McpGrantSummary
} from "@ghostwriter/core";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export function mcpGrantSummaryResponse(grant: McpGrantSummary) {
  return Object.freeze({
    id: grant.id,
    accountId: grant.accountId,
    projectId: grant.projectId,
    captureIds: grant.captureIds,
    tools: grant.tools,
    tokenHint: grant.tokenHint,
    expiresAt: grant.expiresAt,
    createdAt: grant.createdAt,
    updatedAt: grant.updatedAt,
    ...(grant.revokedAt === undefined ? {} : { revokedAt: grant.revokedAt })
  });
}

export function mcpGrantCreateResponse(input: Readonly<{
  grant: McpGrantSummary;
  token: string;
}>) {
  return Object.freeze({
    grant: mcpGrantSummaryResponse(input.grant),
    token: input.token
  });
}

export function mapMcpGrantRouteError(
  error: unknown
): Readonly<{ status: ContentfulStatusCode; body: Record<string, unknown> }> | undefined {
  if (error instanceof McpGrantNotFoundError) {
    return {
      status: 404,
      body: { error: "Not found.", code: "NOT_FOUND" }
    };
  }
  if (error instanceof CaptureNotFoundError) {
    return {
      status: 404,
      body: { error: "Not found.", code: "NOT_FOUND" }
    };
  }
  if (error instanceof ProjectAccessDeniedError) {
    return {
      status: 404,
      body: { error: "Not found.", code: "NOT_FOUND" }
    };
  }
  if (error instanceof ProjectArchivedMutationError) {
    return {
      status: 409,
      body: {
        error: "Archived projects cannot be changed.",
        code: "PROJECT_ARCHIVED"
      }
    };
  }
  if (error instanceof DomainValidationError) {
    return {
      status: 400,
      body: {
        error: "Invalid request.",
        code: error.code
      }
    };
  }
  return undefined;
}
