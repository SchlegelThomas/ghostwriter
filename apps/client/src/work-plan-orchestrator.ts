import {
  isCatalogAgentId,
  planWorkPlanWaves,
  type CatalogAgentId,
  type StoryKnowledgeCreateKind,
  type WorkPlanJobV1,
  type WorkPlanV1
} from "@ghostwriter/core";

export type WorkPlanJobRuntimeStatus =
  | "queued"
  | "running"
  | "done"
  | "error"
  | "skipped";

export type WorkPlanJobResultPatch = Readonly<{
  kind: "plans" | "project-draft" | "scene-draft" | "none";
  openLabel: string;
  proposalId?: string;
  captureId?: string;
  preview?: string;
}>;

export type WorkPlanJobUpdate = Readonly<{
  status: WorkPlanJobRuntimeStatus;
  detail?: string;
  logLine?: string;
  result?: WorkPlanJobResultPatch;
}>;

export type ExecuteWorkPlanInput = Readonly<{
  projectId: string;
  plan: WorkPlanV1;
  onJobUpdate(jobId: string, update: WorkPlanJobUpdate): void;
  runCatalogAgent(input: Readonly<{
    projectId: string;
    agentId: CatalogAgentId;
    sceneId?: string;
    storyKnowledgeId?: string;
  }>): Promise<{
    proposal: Readonly<{
      id: string;
      primaryTarget: Readonly<{ kind: string; id: string }>;
      payload?: unknown;
    }>;
  }>;
  createStoryKnowledgeDraft(input: Readonly<{
    projectId: string;
    name: string;
    kind: StoryKnowledgeCreateKind;
    summary: string;
    sceneId?: string;
  }>): Promise<{
    proposal: Readonly<{
      id: string;
      primaryTarget: Readonly<{ kind: string; id: string }>;
      payload?: unknown;
    }>;
  }>;
  openScenePartner(
    brief: string,
    sceneId?: string
  ): Promise<{ captureId: string }>;
}>;

function previewFromPayload(payload: unknown): string | undefined {
  if (payload === null || typeof payload !== "object") return undefined;
  const record = payload as Record<string, unknown>;
  for (const key of ["summary", "title", "name", "instruction"] as const) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim().slice(0, 400);
    }
  }
  return undefined;
}

async function runOneJob(
  job: WorkPlanJobV1,
  plan: WorkPlanV1,
  input: ExecuteWorkPlanInput
): Promise<void> {
  const sceneId = job.sceneId ?? plan.sceneId;
  input.onJobUpdate(job.id, {
    status: "running",
    detail: "Running",
    logLine: `Starting · ${job.title}`
  });

  try {
    switch (job.kind) {
      case "run-catalog-agent": {
        if (
          job.catalogAgentId === undefined ||
          !isCatalogAgentId(job.catalogAgentId)
        ) {
          input.onJobUpdate(job.id, {
            status: "error",
            detail: "Missing catalog agent.",
            logLine: "Failed · missing catalog agent id."
          });
          return;
        }
        const needsScene =
          job.catalogAgentId === "dialogue-coach" ||
          job.catalogAgentId === "scene-sequel-coach";
        if (needsScene && sceneId === undefined) {
          input.onJobUpdate(job.id, {
            status: "error",
            detail: "Needs an open scene.",
            logLine: "Failed · scene required for this coach."
          });
          return;
        }
        input.onJobUpdate(job.id, {
          status: "running",
          detail: "Working",
          logLine: `Started ${job.catalogAgentId} (structured draft — streams when the run finishes).`
        });
        const { proposal } = await input.runCatalogAgent({
          projectId: input.projectId,
          agentId: job.catalogAgentId,
          ...(sceneId === undefined ? {} : { sceneId })
        });
        const draftKind =
          proposal.primaryTarget.kind === "scene"
            ? ("scene-draft" as const)
            : proposal.primaryTarget.kind === "story-knowledge"
              ? ("scene-draft" as const)
              : ("project-draft" as const);
        const openLabel =
          draftKind === "project-draft"
            ? "Open in Project Drafts"
            : proposal.primaryTarget.kind === "story-knowledge"
              ? "Open Cast draft"
              : "Open Scene Draft";
        input.onJobUpdate(job.id, {
          status: "done",
          detail: "Draft ready",
          logLine: "Draft ready · review in the Agent strip or open it.",
          result: {
            kind: draftKind,
            openLabel,
            proposalId: proposal.id,
            ...(previewFromPayload(proposal.payload) === undefined
              ? {}
              : { preview: previewFromPayload(proposal.payload) })
          }
        });
        return;
      }
      case "create-story-knowledge": {
        if (
          job.proposedName === undefined ||
          job.storyKnowledgeKind === undefined
        ) {
          input.onJobUpdate(job.id, {
            status: "error",
            detail: "Missing name or kind.",
            logLine: "Failed · missing story-knowledge name or kind."
          });
          return;
        }
        input.onJobUpdate(job.id, {
          status: "running",
          detail: "Creating draft…",
          logLine: `Creating Cast draft · ${job.proposedName}`
        });
        const { proposal } = await input.createStoryKnowledgeDraft({
          projectId: input.projectId,
          name: job.proposedName,
          kind: job.storyKnowledgeKind,
          summary: job.instruction,
          ...(sceneId === undefined ? {} : { sceneId })
        });
        input.onJobUpdate(job.id, {
          status: "done",
          detail: "Draft ready",
          logLine: "Cast draft ready · Add to Cast when it looks right.",
          result: {
            kind: "scene-draft",
            openLabel: "Open Cast draft",
            proposalId: proposal.id,
            preview: job.instruction.slice(0, 400)
          }
        });
        return;
      }
      case "cast-reference-check": {
        if (job.storyKnowledgeId !== undefined) {
        input.onJobUpdate(job.id, {
          status: "running",
          detail: "Working",
          logLine: "Started character-coach-cast (result arrives when the draft is ready)."
        });
          const { proposal } = await input.runCatalogAgent({
            projectId: input.projectId,
            agentId: "character-coach-cast",
            storyKnowledgeId: job.storyKnowledgeId,
            ...(sceneId === undefined ? {} : { sceneId })
          });
          input.onJobUpdate(job.id, {
            status: "done",
            detail: "Draft ready",
            logLine: "Cast memo ready.",
            result: {
              kind: "scene-draft",
              openLabel: "Open Cast draft",
              proposalId: proposal.id,
              ...(previewFromPayload(proposal.payload) === undefined
                ? {}
                : { preview: previewFromPayload(proposal.payload) })
            }
          });
        } else {
          input.onJobUpdate(job.id, {
            status: "running",
            detail: "Working",
            logLine: "Started continuity-reader (result arrives when the draft is ready)."
          });
          const { proposal } = await input.runCatalogAgent({
            projectId: input.projectId,
            agentId: "continuity-reader",
            ...(sceneId === undefined ? {} : { sceneId })
          });
          input.onJobUpdate(job.id, {
            status: "done",
            detail: "Draft ready",
            logLine: "Project continuity draft ready.",
            result: {
              kind: "project-draft",
              openLabel: "Open Project Drafts",
              proposalId: proposal.id,
              ...(previewFromPayload(proposal.payload) === undefined
                ? {}
                : { preview: previewFromPayload(proposal.payload) })
            }
          });
        }
        return;
      }
      case "open-scene-partner": {
        input.onJobUpdate(job.id, {
          status: "running",
          detail: "Seeding Plans…",
          logLine: "Creating Plans capture with Scene Partner brief…"
        });
        const result = await input.openScenePartner(job.instruction, sceneId);
        input.onJobUpdate(job.id, {
          status: "done",
          detail: "Ready in Plans",
          logLine: "Brief saved · open Plans to continue Scene Partner.",
          result: {
            kind: "plans",
            openLabel: "Open Plans",
            captureId: result.captureId,
            preview: job.instruction.slice(0, 400)
          }
        });
        return;
      }
      default: {
        const _exhaustive: never = job.kind;
        input.onJobUpdate(_exhaustive, {
          status: "error",
          detail: "Unknown job kind.",
          logLine: "Failed · unknown job kind."
        });
      }
    }
  } catch (cause) {
    const detail =
      cause instanceof Error && cause.message.trim().length > 0
        ? cause.message.trim().slice(0, 120)
        : "Failed";
    input.onJobUpdate(job.id, {
      status: "error",
      detail,
      logLine: `Failed · ${detail}`
    });
  }
}

/** Client-side wave execution: cheap jobs in parallel, then heavy jobs in order. */
export async function executeWorkPlan(
  input: ExecuteWorkPlanInput
): Promise<void> {
  const { waveA, waveB } = planWorkPlanWaves(input.plan);

  for (const job of input.plan.jobs) {
    input.onJobUpdate(job.id, {
      status: "queued",
      detail: "Queued",
      logLine: "Queued"
    });
  }

  await Promise.all(waveA.map((job) => runOneJob(job, input.plan, input)));

  for (const job of waveB) {
    await runOneJob(job, input.plan, input);
  }
}
