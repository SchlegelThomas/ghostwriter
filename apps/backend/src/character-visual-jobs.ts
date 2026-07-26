import { randomUUID } from "node:crypto";
import type { OpenAiImageGenerationResult } from "@ghostwriter/ai";
import type { CharacterSheet } from "@ghostwriter/core";

export type CharacterVisualJobStatus = "queued" | "running" | "ready" | "failed";

export type CharacterVisualJobOption = Readonly<{
  id: string;
  previewUrl: string;
  prompt: string;
  variationIndex: number;
}>;

export type CharacterVisualJobError = Readonly<{
  code: string;
  message: string;
}>;

export type CharacterVisualJob = Readonly<{
  id: string;
  accountId: string;
  projectId: string;
  knowledgeId: string;
  status: CharacterVisualJobStatus;
  basePrompt: string;
  count: number;
  options: readonly CharacterVisualJobOption[];
  error?: CharacterVisualJobError;
  createdAt: string;
  updatedAt: string;
}>;

export type CharacterVisualJobSnapshot = Readonly<{
  jobId: string;
  status: CharacterVisualJobStatus;
  basePrompt: string;
  createdAt: string;
  updatedAt: string;
  options?: readonly CharacterVisualJobOption[];
  error?: CharacterVisualJobError;
}>;

type MutableJob = {
  id: string;
  accountId: string;
  projectId: string;
  knowledgeId: string;
  status: CharacterVisualJobStatus;
  basePrompt: string;
  count: number;
  options: CharacterVisualJobOption[];
  error?: CharacterVisualJobError;
  createdAt: string;
  updatedAt: string;
};

const DEFAULT_COUNT = 3;
const MIN_COUNT = 2;
const MAX_COUNT = 4;
const JOB_TTL_MS = 30 * 60 * 1000;

const VARIATION_SUFFIXES = Object.freeze([
  "alternate wardrobe and posture",
  "softer lighting and closer framing",
  "stronger mood and contrast",
  "different angle with clear face detail"
] as const);

const CHARACTER_IMAGE_SIZE = "1024x1024" as const;

export type CharacterVisualImageGenerator = (input: Readonly<{
  apiKey: string;
  prompt: string;
  size?: typeof CHARACTER_IMAGE_SIZE | "1024x1536" | "1536x1024" | "1024x1792" | "1792x1024";
}>) => Promise<OpenAiImageGenerationResult>;

const jobs = new Map<string, MutableJob>();
const pendingJobRuns = new Set<Promise<void>>();

function clampCount(count: number | undefined): number {
  if (count === undefined) {
    return DEFAULT_COUNT;
  }
  return Math.min(MAX_COUNT, Math.max(MIN_COUNT, Math.trunc(count)));
}

function nowIso(now: () => Date): string {
  return now().toISOString();
}

function purgeExpiredJobs(now: () => Date): void {
  const cutoff = now().getTime() - JOB_TTL_MS;
  for (const [id, job] of jobs) {
    const created = Date.parse(job.createdAt);
    if (Number.isFinite(created) && created < cutoff) {
      jobs.delete(id);
    }
  }
}

function toReadonlyJob(job: MutableJob): CharacterVisualJob {
  return Object.freeze({
    id: job.id,
    accountId: job.accountId,
    projectId: job.projectId,
    knowledgeId: job.knowledgeId,
    status: job.status,
    basePrompt: job.basePrompt,
    count: job.count,
    options: Object.freeze([...job.options]),
    ...(job.error === undefined ? {} : { error: Object.freeze({ ...job.error }) }),
    createdAt: job.createdAt,
    updatedAt: job.updatedAt
  });
}

export function composeCharacterVisualPrompt(input: Readonly<{
  label: string;
  notes?: string;
  characterSheet?: CharacterSheet;
  promptOverride?: string;
  refinement?: string;
}>): string {
  const override = input.promptOverride?.trim();
  let base: string;
  if (override !== undefined && override.length > 0) {
    base = override;
  } else {
    const parts = [
      `Character portrait of ${input.label.trim()}.`,
      "Single subject, literary fiction character visualization, clear face, no text overlay."
    ];
    const desire = input.characterSheet?.desire?.trim();
    if (desire !== undefined && desire.length > 0) {
      parts.push(`Desire: ${desire}`);
    }
    const pressure = input.characterSheet?.pressure?.trim();
    if (pressure !== undefined && pressure.length > 0) {
      parts.push(`Pressure: ${pressure}`);
    }
    const voice = input.characterSheet?.voiceNotes?.trim();
    if (voice !== undefined && voice.length > 0) {
      parts.push(`Voice: ${voice}`);
    }
    const notes = input.notes?.trim();
    if (notes !== undefined && notes.length > 0) {
      parts.push(`Notes: ${notes}`);
    }
    base = parts.join("\n");
  }
  const refinement = input.refinement?.trim();
  if (refinement === undefined || refinement.length === 0) {
    return base;
  }
  return `${base}\nIteration notes: ${refinement}`;
}

export function buildCharacterVisualVariationPrompts(
  basePrompt: string,
  count: number
): readonly string[] {
  const clamped = clampCount(count);
  return Object.freeze(
    Array.from({ length: clamped }, (_, index) => {
      const suffix = VARIATION_SUFFIXES[index % VARIATION_SUFFIXES.length]!;
      return `${basePrompt}\nVariation: ${suffix}.`;
    })
  );
}

function mapGenerationFailure(code: string): CharacterVisualJobError {
  switch (code) {
    case "auth_failed":
      return Object.freeze({
        code: "PROVIDER_AUTH_FAILED",
        message: "The OpenAI key was rejected."
      });
    case "rate_limited":
      return Object.freeze({
        code: "PROVIDER_RATE_LIMITED",
        message: "OpenAI rate limited this request."
      });
    case "timeout":
    case "cancelled":
      return Object.freeze({
        code: "PROVIDER_TIMEOUT",
        message: "The provider call did not finish in time."
      });
    case "refusal":
      return Object.freeze({
        code: "CHARACTER_VISUAL_MODERATION_BLOCKED",
        message:
          "The image provider blocked this prompt. Try different wording."
      });
    case "validation_failed":
    case "invalid_structured_output":
      return Object.freeze({
        code: "CHARACTER_VISUAL_INVALID_OUTPUT",
        message: "Character visual generation returned an unusable response."
      });
    default:
      return Object.freeze({
        code: "PROVIDER_UPSTREAM_ERROR",
        message: "The provider call failed."
      });
  }
}

export function createCharacterVisualJob(input: Readonly<{
  accountId: string;
  projectId: string;
  knowledgeId: string;
  basePrompt: string;
  count?: number;
  now?: () => Date;
}>): CharacterVisualJob {
  const now = input.now ?? (() => new Date());
  purgeExpiredJobs(now);
  const createdAt = nowIso(now);
  const job: MutableJob = {
    id: randomUUID(),
    accountId: input.accountId,
    projectId: input.projectId,
    knowledgeId: input.knowledgeId,
    status: "queued",
    basePrompt: input.basePrompt,
    count: clampCount(input.count),
    options: [],
    createdAt,
    updatedAt: createdAt
  };
  jobs.set(job.id, job);
  return toReadonlyJob(job);
}

export function getCharacterVisualJob(input: Readonly<{
  jobId: string;
  accountId: string;
  projectId: string;
  knowledgeId: string;
  now?: () => Date;
}>): CharacterVisualJob | undefined {
  const now = input.now ?? (() => new Date());
  purgeExpiredJobs(now);
  const job = jobs.get(input.jobId);
  if (job === undefined) {
    return undefined;
  }
  if (
    job.accountId !== input.accountId ||
    job.projectId !== input.projectId ||
    job.knowledgeId !== input.knowledgeId
  ) {
    return undefined;
  }
  return toReadonlyJob(job);
}

export function toCharacterVisualJobSnapshot(
  job: CharacterVisualJob
): CharacterVisualJobSnapshot {
  return Object.freeze({
    jobId: job.id,
    status: job.status,
    basePrompt: job.basePrompt,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    ...(job.status === "ready" ? { options: job.options } : {}),
    ...(job.status === "failed" && job.error !== undefined
      ? { error: job.error }
      : {})
  });
}

export function clearCharacterVisualJobsForTests(): void {
  jobs.clear();
}

export async function settleCharacterVisualJobsForTests(): Promise<void> {
  await Promise.allSettled([...pendingJobRuns]);
}

export function trackCharacterVisualJobRun(run: Promise<void>): void {
  pendingJobRuns.add(run);
  void run.finally(() => {
    pendingJobRuns.delete(run);
  });
}

export async function runCharacterVisualJob(input: Readonly<{
  jobId: string;
  generateImage: CharacterVisualImageGenerator;
  apiKey: string;
  size?: typeof CHARACTER_IMAGE_SIZE | "1024x1536" | "1536x1024" | "1024x1792" | "1792x1024";
  now?: () => Date;
}>): Promise<void> {
  const now = input.now ?? (() => new Date());
  const job = jobs.get(input.jobId);
  if (job === undefined) {
    return;
  }

  job.status = "running";
  job.updatedAt = nowIso(now);

  const prompts = buildCharacterVisualVariationPrompts(job.basePrompt, job.count);
  const size = input.size ?? CHARACTER_IMAGE_SIZE;

  try {
    const settled = await Promise.allSettled(
      prompts.map((prompt) =>
        input.generateImage({
          apiKey: input.apiKey,
          prompt,
          size
        })
      )
    );

    const options: CharacterVisualJobOption[] = [];
    let firstFailureCode: string | undefined;

    for (let index = 0; index < settled.length; index += 1) {
      const result = settled[index]!;
      const prompt = prompts[index]!;
      if (result.status === "rejected") {
        if (firstFailureCode === undefined) {
          firstFailureCode = "upstream_error";
        }
        continue;
      }
      const generated = result.value;
      if (!generated.ok) {
        if (firstFailureCode === undefined) {
          firstFailureCode = generated.diagnostic.code;
        }
        continue;
      }
      options.push(
        Object.freeze({
          id: `${job.id}-${index + 1}`,
          previewUrl: generated.dataUri,
          prompt,
          variationIndex: index
        })
      );
    }

    if (options.length > 0) {
      job.status = "ready";
      job.options = options;
      job.error = undefined;
      job.updatedAt = nowIso(now);
      return;
    }

    job.status = "failed";
    job.options = [];
    job.error = mapGenerationFailure(firstFailureCode ?? "upstream_error");
    job.updatedAt = nowIso(now);
  } catch {
    job.status = "failed";
    job.options = [];
    job.error = mapGenerationFailure("upstream_error");
    job.updatedAt = nowIso(now);
  }
}
