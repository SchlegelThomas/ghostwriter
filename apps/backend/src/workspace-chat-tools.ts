import type { ToolLoopToolDefinition, ToolTraceStep } from "@ghostwriter/ai";
import {
  CAPTURE_REFLECTION_MAX_CAPTURE_CHARS,
  DomainValidationError,
  ProjectAccessDeniedError,
  SceneNotFoundError,
  sceneId,
  sliceCaptureProviderText,
  validateWorkPlanV1,
  WORK_PLAN_JOB_KINDS,
  WORK_PLAN_STORY_KNOWLEDGE_KINDS,
  type AccountId,
  type CaptureServices,
  type CaptureSummary,
  type GhostwriterServices,
  type ProjectId,
  type ProjectNavigator,
  type SceneWritingServices,
  type WorkPlanV1
} from "@ghostwriter/core";
import { z } from "zod";

export const WORKSPACE_CHAT_SCENE_READ_MAX_CALLS = 4;
export const WORKSPACE_CHAT_SCENE_READ_MAX_PLAIN_TEXT_CHARS = 64_000;

export type WorkspaceChatToolTrace = Readonly<{
  toolName: string;
  title: string;
  ok: boolean;
  summary: string;
  errorMessage?: string;
}>;

const TOOL_DISPLAY_TITLES: Readonly<Record<string, string>> = Object.freeze({
  project_navigator_read: "Read manuscript hierarchy",
  scene_workspace_read: "Read scene",
  capture_list: "List captures",
  propose_work_plan: "Propose work plan"
});

const proposeWorkPlanInputSchema = z.object({
  schemaId: z.literal("work-plan-v1"),
  summary: z.string().trim().min(1).max(2_000),
  sceneId: z.string().trim().min(1).max(200).optional(),
  jobs: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(64),
        kind: z.enum(WORK_PLAN_JOB_KINDS),
        title: z.string().trim().min(1).max(120),
        instruction: z.string().trim().min(1).max(4_000),
        catalogAgentId: z.string().trim().min(1).max(100).optional(),
        storyKnowledgeKind: z.enum(WORK_PLAN_STORY_KNOWLEDGE_KINDS).optional(),
        proposedName: z.string().trim().min(1).max(120).optional(),
        storyKnowledgeId: z.string().trim().min(1).max(200).optional(),
        sceneId: z.string().trim().min(1).max(200).optional(),
        heavy: z.boolean().optional()
      })
    )
    .min(1)
    .max(8)
});

type SceneReadBudget = {
  successfulReads: number;
  totalPlainTextChars: number;
};

export type WorkspaceChatToolsContext = Readonly<{
  accountId: AccountId;
  projectId: ProjectId;
  services: Pick<GhostwriterServices, "getProjectNavigator">;
  writing: Pick<SceneWritingServices, "getSceneWorkspace">;
  captures: Pick<CaptureServices, "listCaptures">;
  navigator?: ProjectNavigator;
}>;

function compactNavigator(navigator: ProjectNavigator) {
  return Object.freeze({
    title: navigator.title,
    version: navigator.version,
    totals: navigator.totals,
    books: navigator.books.map((book) =>
      Object.freeze({
        id: book.id,
        title: book.title,
        status: book.status,
        parts: book.parts.map((part) =>
          Object.freeze({
            id: part.id,
            title: part.title,
            ...(part.summary === undefined ? {} : { summary: part.summary }),
            chapters: part.chapters.map((chapter) =>
              Object.freeze({
                id: chapter.id,
                title: chapter.title,
                ...(chapter.summary === undefined
                  ? {}
                  : { summary: chapter.summary }),
                scenes: chapter.scenes.map((scene) =>
                  Object.freeze({
                    id: scene.id,
                    title: scene.title,
                    status: scene.status,
                    ...(scene.summary === undefined
                      ? {}
                      : { summary: scene.summary })
                  })
                )
              })
            )
          })
        ),
        unassignedScenes: book.unassignedScenes.map((scene) =>
          Object.freeze({
            id: scene.id,
            title: scene.title,
            status: scene.status,
            ...(scene.summary === undefined ? {} : { summary: scene.summary })
          })
        )
      })
    )
  });
}

function findSceneTitle(
  navigator: ProjectNavigator | undefined,
  sceneIdValue: string
): string | undefined {
  if (navigator === undefined) return undefined;
  for (const book of navigator.books) {
    for (const part of book.parts) {
      for (const chapter of part.chapters) {
        const scene = chapter.scenes.find((candidate) => candidate.id === sceneIdValue);
        if (scene !== undefined) return scene.title;
      }
    }
    const unassigned = book.unassignedScenes.find(
      (candidate) => candidate.id === sceneIdValue
    );
    if (unassigned !== undefined) return unassigned.title;
  }
  return undefined;
}

function captureSummaries(captures: readonly CaptureSummary[]) {
  return captures.map((capture) =>
    Object.freeze({
      captureId: capture.captureId,
      status: capture.status,
      sourceModality: capture.sourceModality,
      workingVersion: capture.workingVersion,
      createdAt: capture.createdAt,
      updatedAt: capture.updatedAt,
      ...(capture.archivedAt === undefined ? {} : { archivedAt: capture.archivedAt }),
      ...(capture.integratedSceneId === undefined
        ? {}
        : { integratedSceneId: capture.integratedSceneId })
    })
  );
}

function toolError(message: string) {
  return Object.freeze({ ok: false as const, error: message });
}

function formatCount(value: number, label: string): string {
  return `${value.toLocaleString("en-US")} ${label}${value === 1 ? "" : "s"}`;
}

export function summarizeWorkspaceChatToolTrace(
  trace: ToolTraceStep
): WorkspaceChatToolTrace {
  const title = TOOL_DISPLAY_TITLES[trace.toolName] ?? trace.title ?? trace.toolName;
  if (!trace.ok) {
    return Object.freeze({
      toolName: trace.toolName,
      title,
      ok: false,
      summary: trace.errorMessage ?? "Tool call failed.",
      ...(trace.errorMessage === undefined
        ? {}
        : { errorMessage: trace.errorMessage })
    });
  }

  const output = trace.output;
  if (
    typeof output === "object" &&
    output !== null &&
    "ok" in output &&
    (output as { ok: unknown }).ok === false &&
    "error" in output &&
    typeof (output as { error: unknown }).error === "string"
  ) {
    const errorMessage = (output as { error: string }).error;
    return Object.freeze({
      toolName: trace.toolName,
      title,
      ok: false,
      summary: errorMessage,
      errorMessage
    });
  }

  switch (trace.toolName) {
    case "project_navigator_read": {
      const payload =
        typeof output === "object" && output !== null
          ? (output as {
              title?: string;
              totals?: { books?: number; scenes?: number };
            })
          : {};
      const books = payload.totals?.books ?? 0;
      const scenes = payload.totals?.scenes ?? 0;
      return Object.freeze({
        toolName: trace.toolName,
        title,
        ok: true,
        summary: `Hierarchy · ${formatCount(books, "book")} · ${formatCount(scenes, "scene")}`
      });
    }
    case "scene_workspace_read": {
      const payload =
        typeof output === "object" && output !== null
          ? (output as {
              title?: string;
              plainText?: string;
              truncated?: boolean;
            })
          : {};
      const sceneTitle = payload.title?.trim();
      const chars = payload.plainText?.length ?? 0;
      const truncatedSuffix =
        payload.truncated === true ? " · truncated" : "";
      return Object.freeze({
        toolName: trace.toolName,
        title,
        ok: true,
        summary:
          sceneTitle === undefined || sceneTitle.length === 0
            ? `Scene · ${formatCount(chars, "char")}${truncatedSuffix}`
            : `Scene “${sceneTitle}” · ${formatCount(chars, "char")}${truncatedSuffix}`
      });
    }
    case "capture_list": {
      const payload =
        typeof output === "object" && output !== null
          ? (output as { count?: number; captures?: readonly unknown[] })
          : {};
      const count =
        payload.count ??
        (Array.isArray(payload.captures) ? payload.captures.length : 0);
      return Object.freeze({
        toolName: trace.toolName,
        title,
        ok: true,
        summary: formatCount(count, "capture")
      });
    }
    case "propose_work_plan": {
      const payload =
        typeof output === "object" && output !== null
          ? (output as { workPlan?: { jobs?: readonly unknown[]; summary?: string } })
          : {};
      const jobCount = payload.workPlan?.jobs?.length ?? 0;
      return Object.freeze({
        toolName: trace.toolName,
        title,
        ok: true,
        summary:
          jobCount > 0
            ? `Work plan · ${formatCount(jobCount, "job")}`
            : "Work plan attached"
      });
    }
    default:
      return Object.freeze({
        toolName: trace.toolName,
        title,
        ok: true,
        summary: "Completed"
      });
  }
}

/** Latest successful propose_work_plan output from a tool-loop turn. */
export function extractProposedWorkPlanFromToolTraces(
  traces: readonly ToolTraceStep[]
): WorkPlanV1 | undefined {
  for (let index = traces.length - 1; index >= 0; index -= 1) {
    const trace = traces[index];
    if (trace === undefined || trace.toolName !== "propose_work_plan" || !trace.ok) {
      continue;
    }
    const output = trace.output;
    if (
      typeof output !== "object" ||
      output === null ||
      !("ok" in output) ||
      (output as { ok: unknown }).ok !== true ||
      !("workPlan" in output)
    ) {
      continue;
    }
    try {
      return validateWorkPlanV1((output as { workPlan: unknown }).workPlan);
    } catch {
      continue;
    }
  }
  return undefined;
}

export function mapWorkspaceChatToolTraces(
  traces: readonly ToolTraceStep[]
): readonly WorkspaceChatToolTrace[] {
  return Object.freeze(traces.map(summarizeWorkspaceChatToolTrace));
}

export function createWorkspaceChatTools(
  context: WorkspaceChatToolsContext
): readonly ToolLoopToolDefinition[] {
  const budget: SceneReadBudget = {
    successfulReads: 0,
    totalPlainTextChars: 0
  };

  return Object.freeze([
    Object.freeze({
      name: "project_navigator_read",
      description:
        "Read the open project's manuscript hierarchy: books, parts, chapters, and scenes with ids, titles, status, and summaries.",
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const navigator =
            context.navigator ??
            (await context.services.getProjectNavigator(
              context.accountId,
              context.projectId
            ));
          if (navigator === undefined) {
            return toolError("Project not found.");
          }
          return compactNavigator(navigator);
        } catch (error) {
          if (
            error instanceof DomainValidationError ||
            error instanceof ProjectAccessDeniedError
          ) {
            return toolError("Project not found.");
          }
          throw error;
        }
      }
    }),
    Object.freeze({
      name: "scene_workspace_read",
      description:
        "Read one scene's working prose by sceneId. Use iteratively for whole-book questions; prose may be truncated.",
      inputSchema: z.object({
        sceneId: z.string().trim().min(1).max(200)
      }),
      execute: async (input: unknown) => {
        const parsed = z.object({ sceneId: z.string().trim().min(1) }).safeParse(input);
        if (!parsed.success) {
          return toolError("sceneId is required.");
        }
        if (budget.successfulReads >= WORKSPACE_CHAT_SCENE_READ_MAX_CALLS) {
          return toolError(
            `Scene read budget exhausted (${WORKSPACE_CHAT_SCENE_READ_MAX_CALLS} reads per turn).`
          );
        }
        const remainingChars =
          WORKSPACE_CHAT_SCENE_READ_MAX_PLAIN_TEXT_CHARS - budget.totalPlainTextChars;
        if (remainingChars <= 0) {
          return toolError(
            `Scene prose budget exhausted (${WORKSPACE_CHAT_SCENE_READ_MAX_PLAIN_TEXT_CHARS.toLocaleString("en-US")} chars per turn).`
          );
        }

        try {
          const workspace = await context.writing.getSceneWorkspace({
            accountId: context.accountId,
            projectId: context.projectId,
            sceneId: sceneId(parsed.data.sceneId)
          });
          const slice = sliceCaptureProviderText(workspace.head.document);
          const perSceneLimit = Math.min(
            CAPTURE_REFLECTION_MAX_CAPTURE_CHARS,
            remainingChars
          );
          const plainText =
            slice.providerPlainText.length <= perSceneLimit
              ? slice.providerPlainText
              : slice.providerPlainText.slice(0, perSceneLimit);
          const truncated =
            slice.truncated || plainText.length < slice.fullPlainText.length;

          budget.successfulReads += 1;
          budget.totalPlainTextChars += plainText.length;

          const sceneTitle = findSceneTitle(context.navigator, parsed.data.sceneId);
          return Object.freeze({
            ok: true as const,
            sceneId: parsed.data.sceneId,
            ...(sceneTitle === undefined ? {} : { title: sceneTitle }),
            workingVersion: workspace.head.workingVersion,
            truncated,
            plainText
          });
        } catch (error) {
          if (
            error instanceof DomainValidationError ||
            error instanceof ProjectAccessDeniedError ||
            error instanceof SceneNotFoundError
          ) {
            return toolError("Scene not found or not accessible.");
          }
          throw error;
        }
      }
    }),
    Object.freeze({
      name: "capture_list",
      description:
        "List inbox captures for the open project. Returns capture summaries only (no full bodies).",
      inputSchema: z.object({
        includeArchived: z.boolean().optional()
      }),
      execute: async (input: unknown) => {
        const parsed = z
          .object({ includeArchived: z.boolean().optional() })
          .safeParse(input ?? {});
        if (!parsed.success) {
          return toolError("Invalid capture list arguments.");
        }
        try {
          const listed = await context.captures.listCaptures({
            accountId: context.accountId,
            projectId: context.projectId,
            ...(parsed.data.includeArchived === undefined
              ? {}
              : { includeArchived: parsed.data.includeArchived })
          });
          const summaries = captureSummaries(listed);
          return Object.freeze({
            count: summaries.length,
            captures: summaries
          });
        } catch (error) {
          if (
            error instanceof DomainValidationError ||
            error instanceof ProjectAccessDeniedError
          ) {
            return toolError("Captures not accessible for this project.");
          }
          throw error;
        }
      }
    }),
    Object.freeze({
      name: "propose_work_plan",
      description:
        "Attach a structured work-plan-v1 the writer can Submit. Use when proposing multiple concrete jobs (catalog agents, story-knowledge drafts, Scene Partner brief, cast/continuity checks). Does not execute jobs.",
      inputSchema: proposeWorkPlanInputSchema,
      execute: async (input: unknown) => {
        const parsed = proposeWorkPlanInputSchema.safeParse(input);
        if (!parsed.success) {
          return toolError("Work plan arguments are invalid.");
        }
        try {
          const workPlan = validateWorkPlanV1(parsed.data);
          return Object.freeze({
            ok: true as const,
            workPlan
          });
        } catch (error) {
          if (error instanceof DomainValidationError) {
            return toolError(error.message);
          }
          throw error;
        }
      }
    })
  ]);
}
