import {
  createToolLoopProvider,
  type StructuredCompletionProvider,
  type ToolLoopCompletionProvider
} from "@ghostwriter/ai";
import {
  accountId,
  CAPTURE_REFLECTION_DEFAULT_MODEL,
  DomainValidationError,
  GHOSTWRITER_CAPABILITIES,
  isAgentModelId,
  ProjectAccessDeniedError,
  providerForAvailableModel,
  ProviderCredentialNotFoundError,
  projectId,
  type AgentModelId,
  type CaptureServices,
  type GhostwriterServices,
  type ProjectNavigator,
  type SceneWritingServices,
  type WorkPlanV1
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
import { discoverModelsForAccount } from "./model-discovery.js";
import {
  createWorkspaceChatTools,
  extractProposedWorkPlanFromToolTraces,
  mapWorkspaceChatToolTraces,
  summarizeWorkspaceChatToolTrace,
  type WorkspaceChatToolTrace
} from "./workspace-chat-tools.js";
import {
  createWorkspaceChatSseResponse,
  writeSse
} from "./workspace-chat-sse.js";

type WorkspaceChatEnvironment = {
  Variables: {
    authSession: AuthenticatedSession;
  };
};

export const WORKSPACE_CHAT_MODES = ["chat", "plan", "agent"] as const;
export type WorkspaceChatMode = (typeof WORKSPACE_CHAT_MODES)[number];

export const WORKSPACE_CHAT_EFFORTS = ["fast", "standard", "high"] as const;
export type WorkspaceChatEffort = (typeof WORKSPACE_CHAT_EFFORTS)[number];

export const WORKSPACE_CHAT_MAX_ATTACHMENTS = 3;
export const WORKSPACE_CHAT_MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const workspaceChatAttachmentSchema = z
  .object({
    kind: z.enum(["image", "video"]),
    name: z.string().trim().min(1).max(200),
    mimeType: z.string().trim().min(1).max(100),
    dataBase64: z.string().max(12_000_000).optional(),
    byteLength: z.number().int().min(0).max(WORKSPACE_CHAT_MAX_IMAGE_BYTES)
  })
  .superRefine((attachment, context) => {
    if (
      attachment.kind === "image" &&
      attachment.byteLength > WORKSPACE_CHAT_MAX_IMAGE_BYTES
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Image attachment exceeds size limit."
      });
    }
    if (attachment.kind === "video" && attachment.dataBase64 !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Video attachments must not include inline binary data."
      });
    }
  });

export type WorkspaceChatAttachment = z.infer<typeof workspaceChatAttachmentSchema>;

export const workspaceChatRequestSchema = z.object({
  message: z.string().trim().min(1).max(4_000),
  projectId: z.string().trim().min(1).max(200).optional(),
  mode: z.enum(WORKSPACE_CHAT_MODES).optional(),
  model: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .refine(isAgentModelId, { message: "Unknown agent model." })
    .optional(),
  effort: z.enum(WORKSPACE_CHAT_EFFORTS).optional(),
  priorTurns: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        body: z.string().trim().min(1).max(4_000)
      })
    )
    .max(6)
    .optional(),
  attachments: z.array(workspaceChatAttachmentSchema).max(WORKSPACE_CHAT_MAX_ATTACHMENTS).optional(),
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
  writing: Pick<SceneWritingServices, "getSceneWorkspace">;
  captures: Pick<CaptureServices, "listCaptures">;
  agentProvider: AgentProviderRuntime;
  createToolLoopProvider?: typeof createToolLoopProvider;
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

const TOOL_READ_INSTRUCTIONS = [
  "You MAY call read tools to inspect the open project:",
  "- project_navigator_read — manuscript hierarchy (books → scenes)",
  "- scene_workspace_read — one scene's working prose by sceneId",
  "- capture_list — inbox capture summaries",
  "When proposing a multi-step bundle the writer can Submit, call propose_work_plan with a work-plan-v1 object (catalog agents, story-knowledge drafts, Scene Partner brief, cast/continuity checks). Do not invent fake job queues — attachment is enough; the writer Submits.",
  "Use scene reads iteratively for whole-book questions; do not dump or assume unseen scenes.",
  "When citing prose, name the scene title.",
  "Propose only. Never claim manuscript canon was written, saved, or changed.",
  "Reply in plain writer-facing text."
].join("\n");

const MODE_INSTRUCTIONS: Readonly<Record<WorkspaceChatMode, string>> = Object.freeze({
  chat: [
    "You are Ghostwriter's writing agent in chat mode.",
    "Answer questions, research the open project, and draft ideas the writer can revise.",
    "Propose only. Never claim manuscript canon was written, saved, or changed.",
    "Stay concise and writer-facing. Return only the workspace-chat-turn-v1 object."
  ].join("\n"),
  plan: [
    "You are Ghostwriter's writing agent in Plan mode.",
    "Produce outlines, plans, and proposal drafts the writer can save to Plans.",
    "Propose only. Never claim Plans, captures, or manuscript canon were written or saved.",
    "Structure the reply so it is easy to save as a plan outline. Return only the workspace-chat-turn-v1 object."
  ].join("\n"),
  agent: [
    "You are Ghostwriter's writing-agent harness in agent mode.",
    "Suggest next toolkit jobs and structured next steps (Scene Partner, cover concepts, craft partners).",
    "Propose only. Do not invent that Scene Partner or another toolkit job already ran.",
    "Never claim manuscript canon was written, saved, or changed.",
    "Return only the workspace-chat-turn-v1 object."
  ].join("\n")
});

const TOOL_LOOP_MAX_STEPS: Readonly<Record<WorkspaceChatEffort, number>> = Object.freeze({
  fast: 3,
  standard: 6,
  high: 8
});

function toolLoopInstructions(mode: WorkspaceChatMode): string {
  const base = MODE_INSTRUCTIONS[mode].replace(
    " Return only the workspace-chat-turn-v1 object.",
    "."
  );
  return `${base}\n\n${TOOL_READ_INSTRUCTIONS}`;
}

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

export type WorkspaceChatPriorTurn = Readonly<{
  role: "user" | "assistant";
  body: string;
}>;

function buildWorkspaceChatInputText(input: Readonly<{
  message: string;
  contextText: string;
  priorTurns?: readonly WorkspaceChatPriorTurn[];
  attachments?: readonly WorkspaceChatAttachment[];
}>): string {
  const lines = ["Project context:", input.contextText, ""];
  if (input.priorTurns !== undefined && input.priorTurns.length > 0) {
    lines.push("Recent conversation (non-authoritative):");
    for (const turn of input.priorTurns) {
      const speaker = turn.role === "user" ? "Writer" : "Assistant";
      lines.push(`${speaker}: ${turn.body}`);
    }
    lines.push("");
  }
  const attachmentContext = formatWorkspaceChatAttachmentsContext(
    input.attachments
  );
  if (attachmentContext.length > 0) {
    lines.push(attachmentContext, "");
  }
  lines.push("Writer message:", input.message);
  return lines.join("\n");
}

export function formatWorkspaceChatAttachmentsContext(
  attachments: readonly WorkspaceChatAttachment[] | undefined
): string {
  if (attachments === undefined || attachments.length === 0) return "";
  const lines = ["Writer attachments (this turn):"];
  for (const attachment of attachments) {
    if (attachment.kind === "video") {
      lines.push(
        `- video: ${attachment.name} (${attachment.mimeType}, ${attachment.byteLength} bytes) — binary not ingested as frames yet`
      );
      continue;
    }
    if (attachment.dataBase64 !== undefined && attachment.dataBase64.length > 0) {
      lines.push(
        `- image: ${attachment.name} (${attachment.mimeType}, ${attachment.byteLength} bytes) — image data included in request metadata; vision ingestion may vary by model`
      );
      continue;
    }
    lines.push(
      `- image: ${attachment.name} (${attachment.mimeType}, ${attachment.byteLength} bytes) — metadata only`
    );
  }
  return lines.join("\n");
}

export { buildWorkspaceChatInputText };

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
  toolTraces?: readonly WorkspaceChatToolTrace[];
  workPlan?: WorkPlanV1;
  code?: string;
}>) {
  return Object.freeze({
    reply: input.reply,
    mode: input.mode,
    model: input.model,
    effort: input.effort,
    ...(input.toolTraces === undefined || input.toolTraces.length === 0
      ? {}
      : { toolTraces: input.toolTraces }),
    ...(input.workPlan === undefined ? {} : { workPlan: input.workPlan }),
    ...(input.code === undefined ? {} : { code: input.code })
  });
}

function createToolLoopProviderForChat(
  dependencies: WorkspaceChatRouteDependencies,
  input: Readonly<{ providerId: string; apiKey: string }>
): ToolLoopCompletionProvider | undefined {
  try {
    const factory = dependencies.createToolLoopProvider ?? createToolLoopProvider;
    return factory({
      providerId: input.providerId as Parameters<typeof createToolLoopProvider>[0]["providerId"],
      apiKey: input.apiKey
    });
  } catch {
    return undefined;
  }
}

export function registerWorkspaceChatRoutes(
  app: Hono<WorkspaceChatEnvironment>,
  dependencies: WorkspaceChatRouteDependencies
): void {
  const { services, writing, captures, agentProvider } = dependencies;

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
      const account = accountId(authSession.account.id);
      const configured = await agentProvider.providerCredentials.listCredentialStatuses(
        account
      );
      const hasReachableCredential = configured.some(
        (status) =>
          status.validationState === "unvalidated" ||
          status.validationState === "valid" ||
          status.validationState === "invalid"
      );

      let resolvedProviderId = providerForAvailableModel(model, []);
      let modelSupportsTools = false;
      if (hasReachableCredential) {
        const available = await discoverModelsForAccount({
          accountId: authSession.account.id,
          configured,
          resolveApiKey: async (providerId) =>
            agentProvider.resolveProviderApiKey({ accountId: account, providerId }),
          ...(agentProvider.listModelsFactory === undefined
            ? {}
            : { createListingProvider: agentProvider.listModelsFactory })
        });
        resolvedProviderId = providerForAvailableModel(model, available.models);
        const modelEntry = available.models.find((entry) => entry.id === model);
        modelSupportsTools = modelEntry?.supportsTools === true;
        if (
          resolvedProviderId === undefined ||
          !available.models.some((entry) => entry.id === model && entry.supportsChat)
        ) {
          return context.json(
            {
              error: "That model is not available for this account.",
              code: "MODEL_NOT_AVAILABLE"
            },
            400
          );
        }
      }

      const limits = EFFORT_LIMITS[effort];
      const inputText = buildWorkspaceChatInputText({
        message: normalizedMessage,
        contextText,
        priorTurns: parsed.data.priorTurns,
        attachments: parsed.data.attachments
      });

      if (
        modelSupportsTools &&
        resolvedProviderId !== undefined &&
        parsed.data.projectId !== undefined
      ) {
        const apiKey = await agentProvider.resolveProviderApiKey({
          accountId: account,
          providerId: resolvedProviderId
        });
        const toolLoopProvider = createToolLoopProviderForChat(dependencies, {
          providerId: resolvedProviderId,
          apiKey
        });
        if (toolLoopProvider !== undefined) {
          const toolCompletion = await toolLoopProvider.completeWithTools({
            workflow: "workspace-chat.turn",
            model,
            instructions: toolLoopInstructions(mode),
            inputText,
            tools: createWorkspaceChatTools({
              accountId: account,
              projectId: projectId(parsed.data.projectId),
              services,
              writing,
              captures,
              ...(navigator === undefined ? {} : { navigator })
            }),
            maxSteps: TOOL_LOOP_MAX_STEPS[effort],
            maxOutputTokens: limits.maxOutputTokens,
            maxDurationMs: limits.maxDurationMs
          });

          if (toolCompletion.ok) {
            const workPlan = extractProposedWorkPlanFromToolTraces(
              toolCompletion.toolTraces
            );
            return context.json(
              chatSuccessResponse({
                reply: toolCompletion.text.trim(),
                mode,
                model,
                effort,
                toolTraces: mapWorkspaceChatToolTraces(toolCompletion.toolTraces),
                ...(workPlan === undefined ? {} : { workPlan })
              })
            );
          }

          const mapped = providerCompletionError(toolCompletion.diagnostic.code);
          return context.json(mapped.body, mapped.status);
        }
      }

      const provider = (await agentProvider.createCompletionProviderForModel({
        accountId: account,
        model,
        ...(resolvedProviderId === undefined ? {} : { providerId: resolvedProviderId })
      })) as unknown as StructuredCompletionProvider;

      const completion = await provider.completeStructured({
        workflow: "workspace-chat.turn",
        model,
        instructions: MODE_INSTRUCTIONS[mode],
        inputText,
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

  app.post("/api/workspace/chat/stream", async (context) => {
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

    return createWorkspaceChatSseResponse(async (controller, signal) => {
      if (signal.aborted) return;
      writeSse(controller, "status", {
        phase: "starting",
        label: "Starting…"
      });

      const normalizedMessage = parsed.data.message.trim();
      const normalizedId = normalizedMessage.toLocaleLowerCase();

      const requestedCapability = GHOSTWRITER_CAPABILITIES.find(
        (capability) => capability.id.toLocaleLowerCase() === normalizedId
      );

      if (
        requestedCapability?.id === "project.navigator.read" &&
        requestedCapability.access === "read"
      ) {
        writeSse(controller, "status", {
          phase: "assembling_context",
          label: "Reading project…"
        });
        if (parsed.data.projectId === undefined) {
          writeSse(controller, "status", {
            phase: "writing",
            label: "Finishing…"
          });
          writeSse(controller, "done", {
            reply:
              "Open a project before running the manuscript hierarchy capability.",
            mode,
            model,
            effort
          });
          return;
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
            writeSse(controller, "error", {
              error: "Project not found.",
              code: "PROJECT_NOT_FOUND"
            });
            return;
          }
          throw error;
        }
        if (navigator === undefined) {
          writeSse(controller, "error", {
            error: "Project not found.",
            code: "PROJECT_NOT_FOUND"
          });
          return;
        }
        writeSse(controller, "status", {
          phase: "writing",
          label: "Finishing…"
        });
        writeSse(controller, "done", {
          reply: [
            `Ran ${requestedCapability.title}.`,
            `${navigator.title} · project version ${navigator.version}`,
            `${navigator.totals.books} books · ${navigator.totals.scenes} scenes · ${navigator.totals.storyKnowledge} story records`,
            `Books: ${navigator.books.map((book) => book.title).join(", ")}`
          ].join("\n"),
          mode,
          model,
          effort
        });
        return;
      }

      writeSse(controller, "status", {
        phase: "assembling_context",
        label: "Reading project…"
      });

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
            writeSse(controller, "error", {
              error: "Project not found.",
              code: "PROJECT_NOT_FOUND"
            });
            return;
          }
          throw error;
        }
        if (navigator === undefined) {
          writeSse(controller, "error", {
            error: "Project not found.",
            code: "PROJECT_NOT_FOUND"
          });
          return;
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
        const account = accountId(authSession.account.id);
        const configured = await agentProvider.providerCredentials.listCredentialStatuses(
          account
        );
        const hasReachableCredential = configured.some(
          (status) =>
            status.validationState === "unvalidated" ||
            status.validationState === "valid" ||
            status.validationState === "invalid"
        );

        let resolvedProviderId = providerForAvailableModel(model, []);
        let modelSupportsTools = false;
        if (hasReachableCredential) {
          const available = await discoverModelsForAccount({
            accountId: authSession.account.id,
            configured,
            resolveApiKey: async (providerId) =>
              agentProvider.resolveProviderApiKey({ accountId: account, providerId }),
            ...(agentProvider.listModelsFactory === undefined
              ? {}
              : { createListingProvider: agentProvider.listModelsFactory })
          });
          resolvedProviderId = providerForAvailableModel(model, available.models);
          const modelEntry = available.models.find((entry) => entry.id === model);
          modelSupportsTools = modelEntry?.supportsTools === true;
          if (
            resolvedProviderId === undefined ||
            !available.models.some((entry) => entry.id === model && entry.supportsChat)
          ) {
            writeSse(controller, "error", {
              error: "That model is not available for this account.",
              code: "MODEL_NOT_AVAILABLE"
            });
            return;
          }
        }

        const limits = EFFORT_LIMITS[effort];
        const inputText = buildWorkspaceChatInputText({
          message: normalizedMessage,
          contextText,
          priorTurns: parsed.data.priorTurns,
          attachments: parsed.data.attachments
        });

        writeSse(controller, "status", {
          phase: "thinking",
          label: "Thinking…"
        });

        if (
          modelSupportsTools &&
          resolvedProviderId !== undefined &&
          parsed.data.projectId !== undefined
        ) {
          const apiKey = await agentProvider.resolveProviderApiKey({
            accountId: account,
            providerId: resolvedProviderId
          });
          const toolLoopProvider = createToolLoopProviderForChat(dependencies, {
            providerId: resolvedProviderId,
            apiKey
          });
          if (toolLoopProvider !== undefined) {
            if (signal.aborted) return;
            await toolLoopProvider.streamWithTools({
              workflow: "workspace-chat.turn",
              model,
              instructions: toolLoopInstructions(mode),
              inputText,
              tools: createWorkspaceChatTools({
                accountId: account,
                projectId: projectId(parsed.data.projectId),
                services,
                writing,
                captures,
                ...(navigator === undefined ? {} : { navigator })
              }),
              maxSteps: TOOL_LOOP_MAX_STEPS[effort],
              maxOutputTokens: limits.maxOutputTokens,
              maxDurationMs: limits.maxDurationMs,
              signal,
              onEvent: (event) => {
                if (signal.aborted) return;
                switch (event.type) {
                  case "status":
                    writeSse(controller, "status", {
                      phase: event.phase,
                      label: event.label
                    });
                    break;
                  case "tool_trace":
                    writeSse(
                      controller,
                      "tool_trace",
                      summarizeWorkspaceChatToolTrace(event.trace)
                    );
                    break;
                  case "text_delta":
                    writeSse(controller, "text_delta", { delta: event.delta });
                    break;
                  case "error":
                    writeSse(controller, "error", {
                      error: providerCompletionError(event.diagnostic.code).body
                        .error,
                      code: providerCompletionError(event.diagnostic.code).body.code
                    });
                    break;
                  case "done": {
                    const workPlan = extractProposedWorkPlanFromToolTraces(
                      event.result.toolTraces
                    );
                    writeSse(controller, "done", {
                      reply: event.result.text.trim(),
                      mode,
                      model,
                      effort,
                      ...(event.result.toolTraces.length === 0
                        ? {}
                        : {
                            toolTraces: mapWorkspaceChatToolTraces(
                              event.result.toolTraces
                            )
                          }),
                      ...(workPlan === undefined ? {} : { workPlan })
                    });
                    break;
                  }
                  default:
                    break;
                }
              }
            });
            return;
          }
        }

        const provider = (await agentProvider.createCompletionProviderForModel({
          accountId: account,
          model,
          ...(resolvedProviderId === undefined ? {} : { providerId: resolvedProviderId })
        })) as unknown as StructuredCompletionProvider;

        const completion = await provider.completeStructured({
          workflow: "workspace-chat.turn",
          model,
          instructions: MODE_INSTRUCTIONS[mode],
          inputText,
          outputSchema: {
            name: WORKSPACE_CHAT_TURN_SCHEMA_NAME,
            schema: WORKSPACE_CHAT_TURN_V1_JSON_SCHEMA as Record<string, unknown>
          },
          maxOutputTokens: limits.maxOutputTokens,
          maxDurationMs: limits.maxDurationMs,
          validateOutput: isWorkspaceChatTurnV1,
          signal
        });

        if (signal.aborted) return;

        if (!completion.ok) {
          const mapped = providerCompletionError(completion.diagnostic.code);
          writeSse(controller, "error", mapped.body);
          return;
        }

        writeSse(controller, "done", {
          reply: completion.output.reply.trim(),
          mode,
          model,
          effort
        });
      } catch (error) {
        if (signal.aborted) return;
        if (
          error instanceof ProviderCredentialNotFoundError ||
          error instanceof ProviderCallsDisabledError ||
          error instanceof ProviderEncryptionUnavailableError
        ) {
          const mapped = providerAgentErrorStatusAndBody(error);
          const unavailable = providerUnavailableReply(
            mapped?.body.code ?? "PROVIDER_NOT_CONFIGURED"
          );
          writeSse(controller, "status", {
            phase: "writing",
            label: "Finishing…"
          });
          writeSse(controller, "done", {
            reply: unavailable.reply,
            mode,
            model,
            effort,
            code: unavailable.code
          });
          return;
        }
        const mapped = providerAgentErrorStatusAndBody(error);
        if (mapped !== undefined) {
          writeSse(controller, "error", mapped.body);
          return;
        }
        throw error;
      }
    });
  });
}
