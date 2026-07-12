import {
  BELLWETHER_FIXTURE_NAVIGATOR,
  BELLWETHER_FIXTURE_PROJECT_ID
} from "@ghostwriter/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export const PROJECT_NAVIGATOR_TOOL_NAME = "ghostwriter_project_navigator";

const sceneSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(["planned", "drafting", "revising", "complete"]),
  summary: z.string().optional(),
  povStoryKnowledgeId: z.string().optional(),
  archivedAt: z.string().optional()
});

const projectNavigatorOutputSchema = z.object({
  id: z.string(),
  title: z.string(),
  version: z.number().int().positive(),
  archivedAt: z.string().optional(),
  books: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      status: z.enum(["planned", "drafting", "revising", "complete"]),
      parts: z.array(
        z.object({
          id: z.string(),
          title: z.string(),
          chapters: z.array(
            z.object({
              id: z.string(),
              title: z.string(),
              scenes: z.array(sceneSchema)
            })
          )
        })
      ),
      unassignedScenes: z.array(sceneSchema),
      archivedAt: z.string().optional(),
      editions: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          sceneCount: z.number().int().nonnegative(),
          createdAt: z.string()
        })
      ),
      sceneCount: z.number().int().nonnegative()
    })
  ),
  storyKnowledge: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      kind: z.enum(["character", "location", "world-rule", "thread", "custom"]),
      authority: z.enum(["planned", "confirmed", "inferred", "disputed"]),
      linkedSceneIds: z.array(z.string()),
      linkedSceneCount: z.number().int().nonnegative(),
      archivedAt: z.string().optional()
    })
  ),
  totals: z.object({
    books: z.number().int().nonnegative(),
    scenes: z.number().int().nonnegative(),
    storyKnowledge: z.number().int().nonnegative(),
    editions: z.number().int().nonnegative()
  })
});

function projectNavigatorOutput(): z.infer<typeof projectNavigatorOutputSchema> {
  return {
    id: BELLWETHER_FIXTURE_NAVIGATOR.id,
    title: BELLWETHER_FIXTURE_NAVIGATOR.title,
    version: BELLWETHER_FIXTURE_NAVIGATOR.version,
    ...(BELLWETHER_FIXTURE_NAVIGATOR.archivedAt === undefined
      ? {}
      : { archivedAt: BELLWETHER_FIXTURE_NAVIGATOR.archivedAt }),
    books: BELLWETHER_FIXTURE_NAVIGATOR.books.map((book) => ({
      id: book.id,
      title: book.title,
      status: book.status,
      parts: book.parts.map((part) => ({
        id: part.id,
        title: part.title,
        chapters: part.chapters.map((chapter) => ({
          id: chapter.id,
          title: chapter.title,
          scenes: chapter.scenes.map((scene) => ({ ...scene }))
        }))
      })),
      unassignedScenes: book.unassignedScenes.map((scene) => ({ ...scene })),
      ...(book.archivedAt === undefined ? {} : { archivedAt: book.archivedAt }),
      editions: book.editions.map((edition) => ({ ...edition })),
      sceneCount: book.sceneCount
    })),
    storyKnowledge: BELLWETHER_FIXTURE_NAVIGATOR.storyKnowledge.map((knowledge) => ({
      ...knowledge,
      linkedSceneIds: [...knowledge.linkedSceneIds]
    })),
    totals: { ...BELLWETHER_FIXTURE_NAVIGATOR.totals }
  };
}

export function createGhostwriterMcpServer(): McpServer {
  const server = new McpServer(
    { name: "ghostwriter", version: "0.1.0" },
    {
      instructions:
        "Ghostwriter exposes project-scoped writing capabilities. This build contains read-only sample data."
    }
  );

  server.registerTool(
    PROJECT_NAVIGATOR_TOOL_NAME,
    {
      title: "Read project navigator",
      description:
        "Return the ordered books, manuscript scenes, editions, and shared story knowledge for the current sample project.",
      inputSchema: z.object({
        projectId: z
          .string()
          .optional()
          .describe("Project ID. Omit it to read the sample project in this build.")
      }),
      outputSchema: projectNavigatorOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ projectId }) => {
      if (
        projectId !== undefined &&
        projectId !== BELLWETHER_FIXTURE_PROJECT_ID
      ) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Project "${projectId}" is not available in this fixture build.`
            }
          ]
        };
      }

      const output = projectNavigatorOutput();

      return {
        structuredContent: output,
        content: [
          {
            type: "text",
            text: JSON.stringify(output)
          }
        ]
      };
    }
  );

  return server;
}
