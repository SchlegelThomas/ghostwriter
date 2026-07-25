import type { StructuredCompletionProvider } from "@ghostwriter/ai";
import {
  accountId,
  AGENT_MODEL_IDS,
  CAPTURE_REFLECTION_DEFAULT_MODEL,
  DomainValidationError,
  GHOSTWRITER_CAPABILITIES,
  ProjectAccessDeniedError,
  ProviderCredentialNotFoundError,
  projectId,
  type AgentModelId,
  type GhostwriterServices,
  type ProjectNavigator
} from "@ghostwriter/core";
import type { Context, Hono } from "hono";
import { z } from "zod";
import type { AuthenticatedSession } from "./auth.js";
import type { AgentProviderRuntime } from "./agent-provider-runtime.js";
import {
  ProviderCallsDisabledError,
  ProviderEncryptionUnavailableError
} from "./agent-provider-runtime.js";
import { parseJsonRequest } from "./api-contract.js";
import { providerAgentErrorStatusAndBody } from "./provider-agent-api.js";

type WorkspaceChatEnvironment = {
  Variables: {
    authSession: AuthenticatedSession;
  };
};

export const WORKSPACE_CHAT_MODES = ["chat", "plan", "agent"] as const;
export type WorkspaceChatMode = (typeof WORKSPACE_CHAT_MODES)[number];

export const WORKSPACE_CHAT_EFFORTS = ["fast", "standard", "high"] as const;
export type WorkspaceChatEffort = (typeof WORKSPACE_CHAT_EFFORTS)[number];

export const workspaceChatRequestSchema = z.object({
  message: z.string().trim().min(1).max(4_000),
  projectId: z.string().trim().min(1).max(200).optional(),
  mode: z.enum(WORKSPACE_CHAT_MODES).optional(),
  model: z.enum(AGENT_MODEL_IDS).optional(),
  effort: z.enum(WORKSPACE_CHAT_EFFORTS).optional(),
  selection: z
    .object({
      kind: z.string().trim().min(1).max(64),
      bookId: z.string().trim().min(1).max(200).optional(),
      partId: z.string().trim().min(1).max(200).optional(),
      chapterId: z.string().trim().min(1).max(200).optional(),
      sceneId: z.string().trim().min(1).max(200).optional(),
      storyKnowledgeId: z.string().trim().min(1).max(200).optional()
    })
    .optional()
});

export type WorkspaceChatSelection = NonNullable<
  z.infer<typeof workspaceChatRequestSchema>["selection"]
>;

export type WorkspaceChatRouteDependencies = Readonly<{
  services: Pick<GhostwriterServices, "getProjectNavigator">;
  agentProvider: AgentProviderRuntime;
}>;

const WORKSPACE_CHAT_TURN_SCHEMA_NAME = "workspace-chat-turn-v1";

const WORKSPACE_CHAT_TURN_V1_JSON_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["reply"],
  properties: Object.freeze({
    reply: Object.freeze({
      type: "string",
      minLength: 1,
      maxLength: 8_000
    })
  })
});

type WorkspaceChatTurnV1 = Readonly<{ reply: string }>;

function isWorkspaceChatTurnV1(value: unknown): value is WorkspaceChatTurnV1 {
  if (typeof value !== "object" || value === null) return false;
  const reply = (value as { reply?: unknown }).reply;
  return typeof reply === "string" && reply.trim().length > 0;
}

const EFFORT_LIMITS: Readonly<
  Record<
    WorkspaceChatEffort,
    Readonly<{ maxOutputTokens: number; maxDurationMs: number }>
  >
> = Object.freeze({
  fast: Object.freeze({ maxOutputTokens: 800, maxDurationMs: 30_000 }),
  standard: Object.freeze({ maxOutputTokens: 1_600, maxDurationMs: 45_000 }),
  high: Object.freeze({ maxOutputTokens: 3_200, maxDurationMs: 60_000 })
});

const MODE_INSTRUCTIONS: Readonly<Record<WorkspaceChatMode, string>> = Object.freeze({
  chat: [
    "You are Ghostwriter's writing agent in chat mode.",
    "Answer questions, research the open project, and draft ideas the writer can revise.",
    "Propose only. Never claim manuscript canon was written, saved, or changed.",
    "Stay concise and writer-facing. Return only the workspace-chat-turn-v1 object."
  ].join("\n"),
  plan: [
    "You are Ghostwriter's writing agent in Plan mode.",
    "Produce outlines, plans, and proposal drafts the writer can paste into Plans.",
    "Propose only. Never claim Plans, captures, or manuscript canon were written or saved.",
    "Structure the reply so it is easy to copy into Plans. Return only the workspace-chat-turn-v1 object."
  ].join("\n"),
  agent: [
    "You are Ghostwriter's writing-agent harness in agent mode.",
    "Suggest next toolkit jobs and structured next steps (Scene Partner, cover concepts, craft partners).",
    "Propose only. Do not invent that Scene Partner or another toolkit job already ran.",
    "Never claim manuscript canon was written, saved, or changed.",
    "Return only the workspace-chat-turn-v1 object."
  ].join("\n")
});

function invalidRequestResponse(
  context: Context<WorkspaceChatEnvironment>,
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

function findBookTitle(
  navigator: ProjectNavigator,
  bookId: string | undefined
): string | undefined {
  if (bookId === undefined) return undefined;
  return navigator.books.find((book) => book.id === bookId)?.title;
}

function findChapterTitle(
  navigator: ProjectNavigator,
  selection: WorkspaceChatSelection
): string | undefined {
  if (
    selection.bookId === undefined ||
    selection.partId === undefined ||
    selection.chapterId === undefined
  ) {
    return undefined;
  }
  const book = navigator.books.find((candidate) => candidate.id === selection.bookId);
  const part = book?.parts.find((candidate) => candidate.id === selection.partId);
  return part?.chapters.find((candidate) => candidate.id === selection.chapterId)
    ?.title;
}

function findSceneTitle(
  navigator: ProjectNavigator,
  selection: WorkspaceChatSelection
): string | undefined {
  if (selection.bookId === undefined || selection.sceneId === undefined) {
    return undefined;
  }
  const book = navigator.books.find((candidate) => candidate.id === selection.bookId);
  if (book === undefined) return undefined;
  for (const part of book.parts) {
    for (const chapter of part.chapters) {
      const scene = chapter.scenes.find(
        (candidate) => candidate.id === selection.sceneId
      );
      if (scene !== undefined) return scene.title;
    }
  }
  return book.unassignedScenes.find((scene) => scene.id === selection.sceneId)
    ?.title;
}

export function assembleWorkspaceChatContext(input: Readonly<{
  navigator?: ProjectNavigator;
  selection?: WorkspaceChatSelection;
}>): string {
  if (input.navigator === undefined) {
    return "No project is open.";
  }
  const navigator = input.navigator;
  const bookTitles =
    navigator.books.length === 0
      ? "(none)"
      : navigator.books.map((book) => book.title).join(", ");
  const lines = [
    `Project: ${navigator.title}`,
    `Books: ${navigator.totals.books} · Scenes: ${navigator.totals.scenes} · Story knowledge: ${navigator.totals.storyKnowledge}`,
    `Book titles: ${bookTitles}`
  ];
  const selection = input.selection;
  if (selection !== undefined) {
    const focusParts: string[] = [`kind=${selection.kind}`];
    const bookTitle = findBookTitle(navigator, selection.bookId);
    if (bookTitle !== undefined) focusParts.push(`book="${bookTitle}"`);
    const chapterTitle = findChapterTitle(navigator, selection);
    if (chapterTitle !== undefined) focusParts.push(`chapter="${chapterTitle}"`);
    const sceneTitle = findSceneTitle(navigator, selection);
    if (sceneTitle !== undefined) focusParts.push(`scene="${sceneTitle}"`);
    if (selection.storyKnowledgeId !== undefined) {
      const knowledge = navigator.storyKnowledge.find(
        (entry) => entry.id === selection.storyKnowledgeId
      );
      if (knowledge !== undefined) {
        focusParts.push(`storyKnowledge="${knowledge.label}"`);
      }
    }
    lines.push(`Selection focus: ${focusParts.join(" · ")}`);
  } else {
    lines.push("Selection focus: (none)");
  }
  return lines.join("\n");
}

function buildWorkspaceChatInputText(input: Readonly<{
  message: string;
  contextText: string;
}>): string {
  return [
    "Project context:",
    input.contextText,
    "",
    "Writer message:",
    input.message
  ].join("\n");
}

function providerUnavailableReply(code: string): Readonly<{
  reply: string;
  code: string;
}> {
  switch (code) {
    case "PROVIDER_DISABLED":
      return {
        reply:
          "OpenAI calls are temporarily disabled. Try again later, or check Settings.",
        code
      };
    case "PROVIDER_ENCRYPTION_UNAVAILABLE":
      return {
        reply:
          "Provider credential encryption is unavailable on this server. Add or re-check your OpenAI key in Settings once encryption is ready.",
        code
      };
    case "PROVIDER_NOT_CONFIGURED":
    default:
      return {
        reply:
          "Add your OpenAI key in Settings to chat about this project with the writing agent.",
        code: "PROVIDER_NOT_CONFIGURED"
      };
  }
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
          error: "The writing agent returned an unusable response.",
          code: "WORKSPACE_CHAT_INVALID_OUTPUT"
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

function chatSuccessResponse(input: Readonly<{
  reply: string;
  mode: WorkspaceChatMode;
  model: AgentModelId;
  effort: WorkspaceChatEffort;
  code?: string;
}>) {
  return Object.freeze({
    reply: input.reply,
    mode: input.mode,
    model: input.model,
    effort: input.effort,
    ...(input.code === undefined ? {} : { code: input.code })
  });
}

export function registerWorkspaceChatRoutes(
  app: Hono<WorkspaceChatEnvironment>,
  dependencies: WorkspaceChatRouteDependencies
): void {
  const { services, agentProvider } = dependencies;

  app.post("/api/workspace/chat", async (context) => {
    const parsed = await parseJsonRequest(
      context.req.raw,
      workspaceChatRequestSchema
    );
    if (!parsed.success) {
      return invalidRequestResponse(context, parsed);
    }

    const mode = parsed.data.mode ?? "chat";
    const model = parsed.data.model ?? CAPTURE_REFLECTION_DEFAULT_MODEL;
    const effort = parsed.data.effort ?? "standard";
    const normalizedMessage = parsed.data.message.trim();
    const normalizedId = normalizedMessage.toLocaleLowerCase();

    const requestedCapability = GHOSTWRITER_CAPABILITIES.find(
      (capability) => capability.id.toLocaleLowerCase() === normalizedId
    );

    if (
      requestedCapability?.id === "project.navigator.read" &&
      requestedCapability.access === "read"
    ) {
      if (parsed.data.projectId === undefined) {
        return context.json(
          chatSuccessResponse({
            reply:
              "Open a project before running the manuscript hierarchy capability.",
            mode,
            model,
            effort
          })
        );
      }
      const authSession = context.get("authSession");
      let navigator: ProjectNavigator | undefined;
      try {
        navigator = await services.getProjectNavigator(
          accountId(authSession.account.id),
          projectId(parsed.data.projectId)
        );
      } catch (error) {
        if (
          error instanceof DomainValidationError ||
          error instanceof ProjectAccessDeniedError
        ) {
          return context.json(
            { error: "Project not found.", code: "PROJECT_NOT_FOUND" },
            404
          );
        }
        throw error;
      }
      if (navigator === undefined) {
        return context.json(
          { error: "Project not found.", code: "PROJECT_NOT_FOUND" },
          404
        );
      }
      return context.json(
        chatSuccessResponse({
          reply: [
            `Ran ${requestedCapability.title}.`,
            `${navigator.title} · project version ${navigator.version}`,
            `${navigator.totals.books} books · ${navigator.totals.scenes} scenes · ${navigator.totals.storyKnowledge} story records`,
            `Books: ${navigator.books.map((book) => book.title).join(", ")}`
          ].join("\n"),
          mode,
          model,
          effort
        })
      );
    }

    let navigator: ProjectNavigator | undefined;
    if (parsed.data.projectId !== undefined) {
      const authSession = context.get("authSession");
      try {
        navigator = await services.getProjectNavigator(
          accountId(authSession.account.id),
          projectId(parsed.data.projectId)
        );
      } catch (error) {
        if (
          error instanceof DomainValidationError ||
          error instanceof ProjectAccessDeniedError
        ) {
          return context.json(
            { error: "Project not found.", code: "PROJECT_NOT_FOUND" },
            404
          );
        }
        throw error;
      }
      if (navigator === undefined) {
        return context.json(
          { error: "Project not found.", code: "PROJECT_NOT_FOUND" },
          404
        );
      }
    }

    const contextText = assembleWorkspaceChatContext({
      navigator,
      selection: parsed.data.selection
    });

    try {
      if (agentProvider.policy.callsDisabled) {
        throw new ProviderCallsDisabledError();
      }
      if (!agentProvider.policy.encryptionAvailable) {
        throw new ProviderEncryptionUnavailableError();
      }

      const authSession = context.get("authSession");
      const provider = (await agentProvider.createOpenAiCompletionProvider({
        accountId: accountId(authSession.account.id)
      })) as unknown as StructuredCompletionProvider;

      const limits = EFFORT_LIMITS[effort];
      const completion = await provider.completeStructured({
        workflow: "workspace-chat.turn",
        model,
        instructions: MODE_INSTRUCTIONS[mode],
        inputText: buildWorkspaceChatInputText({
          message: normalizedMessage,
          contextText
        }),
        outputSchema: {
          name: WORKSPACE_CHAT_TURN_SCHEMA_NAME,
          schema: WORKSPACE_CHAT_TURN_V1_JSON_SCHEMA as Record<string, unknown>
        },
        maxOutputTokens: limits.maxOutputTokens,
        maxDurationMs: limits.maxDurationMs,
        validateOutput: isWorkspaceChatTurnV1
      });

      if (!completion.ok) {
        const mapped = providerCompletionError(completion.diagnostic.code);
        return context.json(mapped.body, mapped.status);
      }

      return context.json(
        chatSuccessResponse({
          reply: completion.output.reply.trim(),
          mode,
          model,
          effort
        })
      );
    } catch (error) {
      if (
        error instanceof ProviderCredentialNotFoundError ||
        error instanceof ProviderCallsDisabledError ||
        error instanceof ProviderEncryptionUnavailableError
      ) {
        const mapped = providerAgentErrorStatusAndBody(error);
        const unavailable = providerUnavailableReply(
          mapped?.body.code ?? "PROVIDER_NOT_CONFIGURED"
        );
        return context.json(
          chatSuccessResponse({
            reply: unavailable.reply,
            mode,
            model,
            effort,
            code: unavailable.code
          })
        );
      }
      const mapped = providerAgentErrorStatusAndBody(error);
      if (mapped !== undefined) {
        return context.json(mapped.body, mapped.status);
      }
      throw error;
    }
  });
}
