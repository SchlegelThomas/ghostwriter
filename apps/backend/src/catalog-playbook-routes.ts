import {
  accountId,
  catalogAgentPlaybook,
  catalogPlaybookSummaries,
  CatalogPlaybookOverrideConflictError,
  CatalogPlaybookOverrideNotFoundError,
  DomainValidationError,
  isCatalogAgentId,
  mergeCatalogPlaybook,
  ProjectArchivedMutationError,
  projectId
} from "@ghostwriter/core";
import type { Context, Hono } from "hono";
import type { AgentProviderRuntime } from "./agent-provider-runtime.js";
import type { AuthenticatedSession } from "./auth.js";
import {
  parseJsonRequest,
  saveCatalogPlaybookOverrideRequestSchema
} from "./api-contract.js";

type Environment = { Variables: { authSession: AuthenticatedSession } };

function invalid(context: Context<Environment>, code = "INVALID_REQUEST") {
  return context.json({ error: "Invalid request.", code }, 400);
}

function mapError(context: Context<Environment>, error: unknown) {
  if (error instanceof CatalogPlaybookOverrideNotFoundError) {
    return context.json({ error: "Project not found.", code: "PROJECT_NOT_FOUND" }, 404);
  }
  if (error instanceof CatalogPlaybookOverrideConflictError) {
    return context.json(
      { error: error.message, code: "CATALOG_PLAYBOOK_CONFLICT" },
      409
    );
  }
  if (error instanceof ProjectArchivedMutationError) {
    return context.json({ error: error.message, code: "PROJECT_ARCHIVED" }, 409);
  }
  if (error instanceof DomainValidationError) {
    return context.json({ error: error.message, code: error.code }, 400);
  }
  return undefined;
}

function detail(
  agentId: Parameters<typeof catalogAgentPlaybook>[0],
  override: Awaited<
    ReturnType<AgentProviderRuntime["catalogPlaybookOverrides"]["get"]>
  >
) {
  const builtIn = catalogAgentPlaybook(agentId);
  return Object.freeze({
    builtIn,
    override: override ?? null,
    effective: mergeCatalogPlaybook(builtIn, override)
  });
}

export function registerCatalogPlaybookRoutes(
  app: Hono<Environment>,
  dependencies: Readonly<{ agentProvider: AgentProviderRuntime }>
): void {
  app.get("/api/projects/:projectId/catalog-playbooks", async (context) => {
    try {
      const overrides = await dependencies.agentProvider.catalogPlaybookOverrides.list({
        accountId: accountId(context.get("authSession").account.id),
        projectId: projectId(context.req.param("projectId"))
      });
      return context.json({ playbooks: catalogPlaybookSummaries(overrides) });
    } catch (error) {
      const mapped = mapError(context, error);
      if (mapped !== undefined) return mapped;
      throw error;
    }
  });

  app.get("/api/projects/:projectId/catalog-playbooks/:agentId", async (context) => {
    const agentId = context.req.param("agentId");
    if (!isCatalogAgentId(agentId)) return invalid(context);
    try {
      const override = await dependencies.agentProvider.catalogPlaybookOverrides.get({
        accountId: accountId(context.get("authSession").account.id),
        projectId: projectId(context.req.param("projectId")),
        agentId
      });
      return context.json(detail(agentId, override));
    } catch (error) {
      const mapped = mapError(context, error);
      if (mapped !== undefined) return mapped;
      throw error;
    }
  });

  app.put("/api/projects/:projectId/catalog-playbooks/:agentId", async (context) => {
    const agentId = context.req.param("agentId");
    if (!isCatalogAgentId(agentId)) return invalid(context);
    const parsed = await parseJsonRequest(
      context.req.raw,
      saveCatalogPlaybookOverrideRequestSchema
    );
    if (!parsed.success) return invalid(context, parsed.code);
    try {
      const override = await dependencies.agentProvider.catalogPlaybookOverrides.upsert({
        accountId: accountId(context.get("authSession").account.id),
        projectId: projectId(context.req.param("projectId")),
        agentId,
        ...(parsed.data.doctrine === undefined
          ? {}
          : { doctrine: parsed.data.doctrine }),
        ...(parsed.data.sections === undefined
          ? {}
          : { sections: parsed.data.sections }),
        ...(parsed.data.expectedVersion === undefined
          ? {}
          : { expectedVersion: parsed.data.expectedVersion })
      });
      return context.json(detail(agentId, override));
    } catch (error) {
      const mapped = mapError(context, error);
      if (mapped !== undefined) return mapped;
      throw error;
    }
  });

  app.delete("/api/projects/:projectId/catalog-playbooks/:agentId", async (context) => {
    const agentId = context.req.param("agentId");
    if (!isCatalogAgentId(agentId)) return invalid(context);
    try {
      await dependencies.agentProvider.catalogPlaybookOverrides.reset({
        accountId: accountId(context.get("authSession").account.id),
        projectId: projectId(context.req.param("projectId")),
        agentId
      });
      return context.json(detail(agentId, undefined));
    } catch (error) {
      const mapped = mapError(context, error);
      if (mapped !== undefined) return mapped;
      throw error;
    }
  });
}
