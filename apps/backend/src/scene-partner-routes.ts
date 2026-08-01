import {
  generateOpenAiImage,
  type OpenAiImageGenerationResult,
  type StructuredCompletionProvider
} from "@ghostwriter/ai";
import {
  accountId,
  CAPTURE_REFLECTION_DEFAULT_MODEL,
  captureId,
  isScenePartnerTurnV1,
  projectId,
  SCENE_PARTNER_TURN_V1_JSON_SCHEMA,
  validateScenePartnerTurnV1,
  type CaptureServices,
  type ScenePartnerTurnV1
} from "@ghostwriter/core";
import type { Context, Hono } from "hono";
import {
  parseJsonRequest,
  scenePartnerImageRequestSchema,
  scenePartnerTurnRequestSchema
} from "./api-contract.js";
import type { AuthenticatedSession } from "./auth.js";
import type { AgentProviderRuntime } from "./agent-provider-runtime.js";
import {
  ProviderCallsDisabledError,
  ProviderEncryptionUnavailableError
} from "./agent-provider-runtime.js";
import { mapAgentRunRouteError } from "./agent-run-api.js";
import { providerAgentErrorStatusAndBody } from "./provider-agent-api.js";

type ScenePartnerEnvironment = {
  Variables: {
    authSession: AuthenticatedSession;
  };
};

export type ScenePartnerImageGenerator = (input: Readonly<{
  apiKey: string;
  prompt: string;
  model?: string;
  size?: "1024x1024" | "1024x1536" | "1536x1024" | "1024x1792" | "1792x1024";
}>) => Promise<OpenAiImageGenerationResult>;

export type ScenePartnerRouteDependencies = Readonly<{
  agentProvider: AgentProviderRuntime;
  captures: CaptureServices;
  /** Defaults to live OpenAI Images; hermetic/tests inject a fake. */
  generateImage?: ScenePartnerImageGenerator;
}>;

const SCENE_PARTNER_TURN_INSTRUCTIONS = [
  "You are Ghostwriter Scene Partner — a job-bound conversational writing partner.",
  "Your job: help the writer turn a Capture idea into scene work.",
  "Always scan the provided manuscript scenes for a plausible match before proposing a new scene.",
  "If the idea is thin or unclear, stay in interview and ask one focused clarifying question.",
  "When ready, draft short prose the writer can revise; offer apply-new-scene and/or propose-image.",
  "Propose only. NEVER claim the manuscript was written, saved, or changed.",
  "Never invent that an image was saved. Image prompts are proposals only.",
  "Keep thinkingSteps as 1–6 short writer-visible labels.",
  "Return only the scene-partner-turn-v1 structured object."
].join("\n");

function invalidRequestResponse(
  context: Context<ScenePartnerEnvironment>,
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

function assertProviderCallable(agentProvider: AgentProviderRuntime): void {
  if (agentProvider.policy.callsDisabled) {
    throw new ProviderCallsDisabledError();
  }
  if (!agentProvider.policy.encryptionAvailable) {
    throw new ProviderEncryptionUnavailableError();
  }
}

function buildTurnInputText(input: Readonly<{
  ideaProse: string;
  scenes: readonly Readonly<{ id: string; title: string; label: string }>[];
  messages: readonly Readonly<{ role: "assistant" | "user"; body: string }>[];
  phase?: string;
  matchedSceneId?: string | null;
}>): string {
  const sceneLines =
    input.scenes.length === 0
      ? "(no manuscript scenes yet)"
      : input.scenes
          .map((scene) => `- ${scene.id}: ${scene.title} (${scene.label})`)
          .join("\n");
  const history =
    input.messages.length === 0
      ? "(opening turn — no prior chat messages)"
      : input.messages.map((message) => `${message.role}: ${message.body}`).join("\n");
  const phaseLine =
    input.phase === undefined ? "phase: (unspecified)" : `phase: ${input.phase}`;
  const matchLine =
    input.matchedSceneId === undefined || input.matchedSceneId === null
      ? "matchedSceneId: (none)"
      : `matchedSceneId: ${input.matchedSceneId}`;

  return [
    "Idea prose:",
    input.ideaProse.trim().length > 0 ? input.ideaProse.trim() : "(empty)",
    "",
    "Manuscript scenes:",
    sceneLines,
    "",
    phaseLine,
    matchLine,
    "",
    "Conversation so far:",
    history,
    "",
    "Produce the next Scene Partner turn."
  ].join("\n");
}

function turnResponse(turn: ScenePartnerTurnV1) {
  return Object.freeze({
    turn: Object.freeze({
      thinkingSteps: turn.thinkingSteps,
      assistantMessage: turn.assistantMessage,
      phase: turn.phase,
      matchedSceneId: turn.matchedSceneId ?? null,
      proseDraft: turn.proseDraft ?? null,
      actions: turn.actions,
      imagePrompt: turn.imagePrompt ?? null
    })
  });
}

function providerCompletionError(
  code: string
): Readonly<{ status: 502 | 503 | 422; body: Readonly<{ error: string; code: string }> }> {
  switch (code) {
    case "auth_failed":
      return {
        status: 502,
        body: {
          error: "The OpenAI key was rejected.",
          code: "PROVIDER_AUTH_FAILED"
        }
      };
    case "rate_limited":
      return {
        status: 503,
        body: {
          error: "OpenAI rate limited this request.",
          code: "PROVIDER_RATE_LIMITED"
        }
      };
    case "timeout":
    case "cancelled":
      return {
        status: 503,
        body: {
          error: "The provider call did not finish in time.",
          code: "PROVIDER_TIMEOUT"
        }
      };
    case "validation_failed":
    case "invalid_structured_output":
    case "refusal":
      return {
        status: 422,
        body: {
          error: "Scene Partner returned an unusable response.",
          code: "SCENE_PARTNER_INVALID_OUTPUT"
        }
      };
    default:
      return {
        status: 502,
        body: {
          error: "The provider call failed.",
          code: "PROVIDER_UPSTREAM_ERROR"
        }
      };
  }
}

export function registerScenePartnerRoutes(
  app: Hono<ScenePartnerEnvironment>,
  dependencies: ScenePartnerRouteDependencies
): void {
  const { agentProvider, captures } = dependencies;
  const generateImage = dependencies.generateImage ?? generateOpenAiImage;

  app.post(
    "/api/projects/:projectId/captures/:captureId/scene-partner/turns",
    async (context) => {
      const parsed = await parseJsonRequest(
        context.req.raw,
        scenePartnerTurnRequestSchema
      );
      if (!parsed.success) {
        return invalidRequestResponse(context, parsed);
      }
      try {
        assertProviderCallable(agentProvider);
        const authSession = context.get("authSession");
        const account = accountId(authSession.account.id);
        const scopedProjectId = projectId(context.req.param("projectId"));
        const scopedCaptureId = captureId(context.req.param("captureId"));

        await captures.getCapture({
          accountId: account,
          projectId: scopedProjectId,
          captureId: scopedCaptureId
        });

        const provider = (await agentProvider.createCompletionProviderForModel({
          accountId: account,
          model: CAPTURE_REFLECTION_DEFAULT_MODEL
        })) as unknown as StructuredCompletionProvider;

        const completion = await provider.completeStructured({
          workflow: "scene-partner.turn",
          model: CAPTURE_REFLECTION_DEFAULT_MODEL,
          instructions: SCENE_PARTNER_TURN_INSTRUCTIONS,
          inputText: buildTurnInputText(parsed.data),
          outputSchema: {
            name: "scene_partner_turn_v1",
            schema: SCENE_PARTNER_TURN_V1_JSON_SCHEMA as Record<string, unknown>
          },
          maxOutputTokens: 1_500,
          maxDurationMs: 60_000,
          validateOutput: isScenePartnerTurnV1
        });

        if (!completion.ok) {
          const mapped = providerCompletionError(completion.diagnostic.code);
          return context.json(mapped.body, mapped.status);
        }

        const turn = validateScenePartnerTurnV1(completion.output);
        return context.json(turnResponse(turn), 201);
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
    "/api/projects/:projectId/captures/:captureId/scene-partner/images",
    async (context) => {
      const parsed = await parseJsonRequest(
        context.req.raw,
        scenePartnerImageRequestSchema
      );
      if (!parsed.success) {
        return invalidRequestResponse(context, parsed);
      }
      try {
        assertProviderCallable(agentProvider);
        const authSession = context.get("authSession");
        const account = accountId(authSession.account.id);
        const scopedProjectId = projectId(context.req.param("projectId"));
        const scopedCaptureId = captureId(context.req.param("captureId"));

        await captures.getCapture({
          accountId: account,
          projectId: scopedProjectId,
          captureId: scopedCaptureId
        });

        const apiKey = await agentProvider.resolveOpenAiApiKey({
          accountId: account
        });
        const generated = await generateImage({
          apiKey,
          prompt: parsed.data.prompt
        });

        if (!generated.ok) {
          const mapped = providerCompletionError(generated.diagnostic.code);
          return context.json(mapped.body, mapped.status);
        }

        return context.json(
          {
            url: generated.dataUri,
            alt: "Proposed scene image",
            prompt: parsed.data.prompt
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
}
