import { DomainValidationError, projectId, type GhostwriterServices } from "@ghostwriter/core";
import { Hono } from "hono";

export type BackendDependencies = Readonly<{
  services: GhostwriterServices;
}>;

export function createApp(dependencies: BackendDependencies): Hono {
  const app = new Hono();

  app.get("/health", (context) => context.json({ status: "ok" }));

  app.get("/api/projects/:projectId/navigator", async (context) => {
    const rawProjectId = context.req.param("projectId");

    let id;
    try {
      id = projectId(rawProjectId);
    } catch (error) {
      if (error instanceof DomainValidationError) {
        return context.json({ error: "Invalid project id." }, 400);
      }
      throw error;
    }

    const navigator = await dependencies.services.getProjectNavigator(id);

    if (navigator === undefined) {
      return context.json({ error: "Project not found." }, 404);
    }

    return context.json(navigator);
  });

  return app;
}
