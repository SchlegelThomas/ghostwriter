import { randomUUID } from "node:crypto";
import { generateOpenAiImage } from "@ghostwriter/ai";
import {
  accountId,
  assertCharacterVisualPngDataUri,
  buildCharacterVisualLocatorUrl,
  buildCharacterVisualObjectKey,
  DomainValidationError,
  parseCharacterVisualLocatorUrl,
  projectId,
  storyKnowledgeId,
  type CaptureObjectStoragePort,
  type CharacterVisual,
  type GhostwriterServices,
  type ProjectNavigatorKnowledge
} from "@ghostwriter/core";
import type { Context, Hono } from "hono";
import {
  characterVisualApplyRequestSchema,
  characterVisualJobRequestSchema,
  parseJsonRequest
} from "./api-contract.js";
import type { AuthenticatedSession } from "./auth.js";
import type { AgentProviderRuntime } from "./agent-provider-runtime.js";
import { resolveCatalogImageGeneration } from "./catalog-image-generation.js";
import {
  composeCharacterVisualPrompt,
  createCharacterVisualJob,
  getCharacterVisualJob,
  runCharacterVisualJob,
  toCharacterVisualJobSnapshot,
  trackCharacterVisualJobRun
} from "./character-visual-jobs.js";
import { CaptureObjectStorageError } from "./capture-object-storage-error.js";
import { mapAgentRunRouteError } from "./agent-run-api.js";
import { providerAgentErrorStatusAndBody } from "./provider-agent-api.js";
import type { ScenePartnerImageGenerator } from "./scene-partner-routes.js";

type CharacterVisualEnvironment = {
  Variables: {
    authSession: AuthenticatedSession;
  };
};

export type CharacterVisualRouteDependencies = Readonly<{
  agentProvider: AgentProviderRuntime;
  services: GhostwriterServices;
  objectStorage: CaptureObjectStoragePort;
  generateImage?: ScenePartnerImageGenerator;
  now?: () => Date;
}>;

const DOWNLOAD_TTL_MS = 5 * 60 * 1000;
const CHARACTER_IMAGE_SIZE = "1024x1024" as const;

function invalidRequestResponse(
  context: Context<CharacterVisualEnvironment>,
  parsed: {
    success: false;
    code: string;
    issues?: readonly { path: string; message: string }[];
  }
) {
  return context.json(
    {
      error: "Invalid request.",
      code: parsed.code,
      ...(parsed.issues === undefined ? {} : { issues: parsed.issues })
    },
    parsed.code === "PAYLOAD_TOO_LARGE" ? 413 : 400
  );
}

async function resolveImageGeneration(
  agentProvider: AgentProviderRuntime,
  account: ReturnType<typeof accountId>,
  usingInjectedGenerator: boolean,
  imageModel?: string
): Promise<{ apiKey: string; model: string }> {
  return resolveCatalogImageGeneration({
    agentProvider,
    accountId: account,
    imageModel,
    usingInjectedGenerator
  });
}

function bytesToPngDataUri(bytes: Uint8Array): string {
  return `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
}

async function loadKnowledgeInProject(input: Readonly<{
  services: GhostwriterServices;
  accountId: ReturnType<typeof accountId>;
  projectId: ReturnType<typeof projectId>;
  knowledgeId: ReturnType<typeof storyKnowledgeId>;
}>) {
  const navigator = await input.services.getProjectNavigator(
    input.accountId,
    input.projectId
  );
  if (navigator === undefined) {
    return undefined;
  }
  const knowledge = navigator.storyKnowledge.find(
    (candidate) => candidate.id === input.knowledgeId
  );
  if (knowledge === undefined) {
    return Object.freeze({ navigator, knowledge: undefined as undefined });
  }
  return Object.freeze({ navigator, knowledge });
}

function appendVisual(
  knowledge: ProjectNavigatorKnowledge,
  visual: CharacterVisual
): readonly CharacterVisual[] {
  const existing = knowledge.visuals ?? [];
  return Object.freeze([...existing, visual]);
}

export function registerCharacterVisualRoutes(
  app: Hono<CharacterVisualEnvironment>,
  dependencies: CharacterVisualRouteDependencies
): void {
  const { agentProvider, services, objectStorage } = dependencies;
  const usingInjectedGenerator = dependencies.generateImage !== undefined;
  const generateImage = dependencies.generateImage ?? generateOpenAiImage;
  const now = dependencies.now ?? (() => new Date());

  app.post(
    "/api/projects/:projectId/story-knowledge/:knowledgeId/visuals/jobs",
    async (context) => {
      const parsed = await parseJsonRequest(
        context.req.raw,
        characterVisualJobRequestSchema
      );
      if (!parsed.success) {
        return invalidRequestResponse(context, parsed);
      }
      try {
        const authSession = context.get("authSession");
        const account = accountId(authSession.account.id);
        const scopedProjectId = projectId(context.req.param("projectId"));
        const scopedKnowledgeId = storyKnowledgeId(context.req.param("knowledgeId"));

        const loaded = await loadKnowledgeInProject({
          services,
          accountId: account,
          projectId: scopedProjectId,
          knowledgeId: scopedKnowledgeId
        });
        if (loaded === undefined) {
          return context.json(
            { error: "Project not found.", code: "PROJECT_NOT_FOUND" },
            404
          );
        }
        if (loaded.knowledge === undefined) {
          return context.json(
            { error: "Story knowledge not found.", code: "STORY_KNOWLEDGE_NOT_FOUND" },
            404
          );
        }

        const { apiKey, model } = await resolveImageGeneration(
          agentProvider,
          account,
          usingInjectedGenerator,
          parsed.data.imageModel
        );
        const basePrompt = composeCharacterVisualPrompt({
          label: loaded.knowledge.label,
          notes: loaded.knowledge.notes,
          characterSheet: loaded.knowledge.characterSheet,
          promptOverride: parsed.data.prompt,
          refinement: parsed.data.refinement
        });
        const job = createCharacterVisualJob({
          accountId: account,
          projectId: scopedProjectId,
          knowledgeId: scopedKnowledgeId,
          basePrompt,
          count: parsed.data.count,
          now
        });

        trackCharacterVisualJobRun(
          runCharacterVisualJob({
            jobId: job.id,
            generateImage,
            apiKey,
            model,
            size: CHARACTER_IMAGE_SIZE,
            now
          })
        );

        return context.json({ jobId: job.id, status: "queued" as const }, 202);
      } catch (error) {
        const mapped =
          mapAgentRunRouteError(error) ?? providerAgentErrorStatusAndBody(error);
        if (mapped !== undefined) {
          return context.json(mapped.body, mapped.status);
        }
        throw error;
      }
    }
  );

  app.get(
    "/api/projects/:projectId/story-knowledge/:knowledgeId/visuals/jobs/:jobId",
    async (context) => {
      try {
        const authSession = context.get("authSession");
        const account = accountId(authSession.account.id);
        const scopedProjectId = projectId(context.req.param("projectId"));
        const scopedKnowledgeId = storyKnowledgeId(context.req.param("knowledgeId"));
        const jobId = context.req.param("jobId");

        const loaded = await loadKnowledgeInProject({
          services,
          accountId: account,
          projectId: scopedProjectId,
          knowledgeId: scopedKnowledgeId
        });
        if (loaded === undefined) {
          return context.json(
            { error: "Project not found.", code: "PROJECT_NOT_FOUND" },
            404
          );
        }
        if (loaded.knowledge === undefined) {
          return context.json(
            { error: "Story knowledge not found.", code: "STORY_KNOWLEDGE_NOT_FOUND" },
            404
          );
        }

        const job = getCharacterVisualJob({
          jobId,
          accountId: account,
          projectId: scopedProjectId,
          knowledgeId: scopedKnowledgeId,
          now
        });
        if (job === undefined) {
          return context.json(
            {
              error: "Character visual job not found.",
              code: "CHARACTER_VISUAL_JOB_NOT_FOUND"
            },
            404
          );
        }

        return context.json(toCharacterVisualJobSnapshot(job), 200);
      } catch (error) {
        const mapped =
          mapAgentRunRouteError(error) ?? providerAgentErrorStatusAndBody(error);
        if (mapped !== undefined) {
          return context.json(mapped.body, mapped.status);
        }
        throw error;
      }
    }
  );

  app.post(
    "/api/projects/:projectId/story-knowledge/:knowledgeId/visuals/apply",
    async (context) => {
      const parsed = await parseJsonRequest(
        context.req.raw,
        characterVisualApplyRequestSchema
      );
      if (!parsed.success) {
        return invalidRequestResponse(context, parsed);
      }
      try {
        const authSession = context.get("authSession");
        const account = accountId(authSession.account.id);
        const scopedProjectId = projectId(context.req.param("projectId"));
        const scopedKnowledgeId = storyKnowledgeId(context.req.param("knowledgeId"));

        const loaded = await loadKnowledgeInProject({
          services,
          accountId: account,
          projectId: scopedProjectId,
          knowledgeId: scopedKnowledgeId
        });
        if (loaded === undefined) {
          return context.json(
            { error: "Project not found.", code: "PROJECT_NOT_FOUND" },
            404
          );
        }
        if (loaded.knowledge === undefined) {
          return context.json(
            { error: "Story knowledge not found.", code: "STORY_KNOWLEDGE_NOT_FOUND" },
            404
          );
        }

        const existingCount = loaded.knowledge.visuals?.length ?? 0;
        if (existingCount >= 24) {
          return context.json(
            {
              error: "Character visuals are limited to 24 images.",
              code: "CHARACTER_VISUAL_LIMIT"
            },
            422
          );
        }

        let bytes: Uint8Array;
        try {
          bytes = assertCharacterVisualPngDataUri(parsed.data.previewDataUri);
        } catch (error) {
          if (error instanceof DomainValidationError) {
            return context.json(
              {
                error: error.message,
                code: error.code
              },
              400
            );
          }
          throw error;
        }

        const visualId = randomUUID();
        const objectKey = buildCharacterVisualObjectKey(
          scopedProjectId,
          scopedKnowledgeId,
          visualId
        );
        const locator = buildCharacterVisualLocatorUrl(
          scopedProjectId,
          scopedKnowledgeId,
          visualId
        );

        try {
          await objectStorage.putObject({
            objectKey,
            contentType: "image/png",
            bytes
          });
        } catch (error) {
          if (error instanceof CaptureObjectStorageError) {
            return context.json(
              {
                error: "Character visual object storage is unavailable.",
                code: "CHARACTER_VISUAL_STORAGE_UNAVAILABLE"
              },
              503
            );
          }
          throw error;
        }

        const visual: CharacterVisual = Object.freeze({
          id: visualId,
          url: locator,
          alt: parsed.data.alt,
          ...(parsed.data.caption === undefined
            ? {}
            : { caption: parsed.data.caption }),
          source: parsed.data.source
        });
        const visuals = appendVisual(loaded.knowledge, visual);

        const navigator = await services.executeProjectCommand({
          accountId: account,
          projectId: scopedProjectId,
          expectedVersion: loaded.navigator.version,
          command: {
            type: "storyKnowledge.update",
            storyKnowledgeId: scopedKnowledgeId,
            visuals
          }
        });
        const updated = navigator.storyKnowledge.find(
          (candidate) => candidate.id === scopedKnowledgeId
        );
        const persistedVisuals = updated?.visuals ?? visuals;
        const persisted =
          persistedVisuals.find((candidate) => candidate.id === visualId) ?? visual;

        return context.json(
          {
            visual: persisted,
            visuals: persistedVisuals
          },
          201
        );
      } catch (error) {
        const mapped =
          mapAgentRunRouteError(error) ?? providerAgentErrorStatusAndBody(error);
        if (mapped !== undefined) {
          return context.json(mapped.body, mapped.status);
        }
        throw error;
      }
    }
  );

  app.get(
    "/api/projects/:projectId/story-knowledge/:knowledgeId/visuals/:visualId/download",
    async (context) => {
      try {
        const authSession = context.get("authSession");
        const account = accountId(authSession.account.id);
        const scopedProjectId = projectId(context.req.param("projectId"));
        const scopedKnowledgeId = storyKnowledgeId(context.req.param("knowledgeId"));
        const visualId = context.req.param("visualId");

        const loaded = await loadKnowledgeInProject({
          services,
          accountId: account,
          projectId: scopedProjectId,
          knowledgeId: scopedKnowledgeId
        });
        if (loaded === undefined) {
          return context.json(
            { error: "Project not found.", code: "PROJECT_NOT_FOUND" },
            404
          );
        }
        if (loaded.knowledge === undefined) {
          return context.json(
            { error: "Story knowledge not found.", code: "STORY_KNOWLEDGE_NOT_FOUND" },
            404
          );
        }

        const visual = loaded.knowledge.visuals?.find(
          (candidate) => candidate.id === visualId
        );
        if (visual === undefined) {
          return context.json(
            {
              error: "Character visual not found.",
              code: "CHARACTER_VISUAL_NOT_FOUND"
            },
            404
          );
        }
        const locator = parseCharacterVisualLocatorUrl(visual.url);
        if (
          locator === undefined ||
          locator.projectId !== scopedProjectId ||
          locator.knowledgeId !== scopedKnowledgeId ||
          locator.visualId !== visualId
        ) {
          return context.json(
            {
              error: "Character visual not found.",
              code: "CHARACTER_VISUAL_NOT_FOUND"
            },
            404
          );
        }

        const objectKey = buildCharacterVisualObjectKey(
          scopedProjectId,
          scopedKnowledgeId,
          visualId
        );
        const expiresAt = new Date(now().getTime() + DOWNLOAD_TTL_MS).toISOString();

        if (objectStorage.getObjectBytes !== undefined) {
          try {
            const bytes = await objectStorage.getObjectBytes(objectKey);
            if (bytes !== undefined) {
              return context.json({
                download: {
                  url: bytesToPngDataUri(bytes),
                  expiresAt
                }
              });
            }
          } catch (error) {
            if (!(error instanceof CaptureObjectStorageError)) {
              throw error;
            }
          }
        }

        try {
          const download = await objectStorage.presignGet({
            objectKey,
            expiresAt
          });
          return context.json({
            download: {
              url: download.url,
              expiresAt: download.expiresAt
            }
          });
        } catch (error) {
          if (error instanceof CaptureObjectStorageError) {
            return context.json(
              {
                error: "Character visual object storage is unavailable.",
                code: "CHARACTER_VISUAL_STORAGE_UNAVAILABLE"
              },
              503
            );
          }
          throw error;
        }
      } catch (error) {
        const mapped =
          mapAgentRunRouteError(error) ?? providerAgentErrorStatusAndBody(error);
        if (mapped !== undefined) {
          return context.json(mapped.body, mapped.status);
        }
        throw error;
      }
    }
  );
}
