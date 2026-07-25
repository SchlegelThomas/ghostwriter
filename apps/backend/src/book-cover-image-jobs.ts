import { randomUUID } from "node:crypto";
import type { OpenAiImageGenerationResult } from "@ghostwriter/ai";

export type BookCoverImageJobStatus = "queued" | "running" | "ready" | "failed";

export type BookCoverImageJobOption = Readonly<{
  id: string;
  previewUrl: string;
  prompt: string;
  variationIndex: number;
}>;

export type BookCoverImageJobError = Readonly<{
  code: string;
  message: string;
}>;

export type BookCoverImageJob = Readonly<{
  id: string;
  accountId: string;
  projectId: string;
  bookId: string;
  status: BookCoverImageJobStatus;
  basePrompt: string;
  count: number;
  options: readonly BookCoverImageJobOption[];
  error?: BookCoverImageJobError;
  createdAt: string;
  updatedAt: string;
}>;

export type BookCoverImageJobSnapshot = Readonly<{
  jobId: string;
  status: BookCoverImageJobStatus;
  basePrompt: string;
  createdAt: string;
  updatedAt: string;
  options?: readonly BookCoverImageJobOption[];
  error?: BookCoverImageJobError;
}>;

type MutableJob = {
  id: string;
  accountId: string;
  projectId: string;
  bookId: string;
  status: BookCoverImageJobStatus;
  basePrompt: string;
  count: number;
  options: BookCoverImageJobOption[];
  error?: BookCoverImageJobError;
  createdAt: string;
  updatedAt: string;
};

const DEFAULT_COUNT = 3;
const MIN_COUNT = 2;
const MAX_COUNT = 4;
const JOB_TTL_MS = 30 * 60 * 1000;

const VARIATION_SUFFIXES = Object.freeze([
  "alternate composition",
  "moodier lighting",
  "bolder title space",
  "sharper focal contrast"
] as const);

const COVER_IMAGE_SIZE = "1024x1536" as const;

export type BookCoverImageGenerator = (input: Readonly<{
  apiKey: string;
  prompt: string;
  size?: typeof COVER_IMAGE_SIZE | "1024x1024" | "1536x1024" | "1024x1792" | "1792x1024";
}>) => Promise<OpenAiImageGenerationResult>;

const jobs = new Map<string, MutableJob>();

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

function toReadonlyJob(job: MutableJob): BookCoverImageJob {
  return Object.freeze({
    id: job.id,
    accountId: job.accountId,
    projectId: job.projectId,
    bookId: job.bookId,
    status: job.status,
    basePrompt: job.basePrompt,
    count: job.count,
    options: Object.freeze([...job.options]),
    ...(job.error === undefined ? {} : { error: Object.freeze({ ...job.error }) }),
    createdAt: job.createdAt,
    updatedAt: job.updatedAt
  });
}

export function composeBookCoverImagePrompt(
  basePrompt: string,
  refinement?: string
): string {
  const trimmedBase = basePrompt.trim();
  const trimmedRefinement = refinement?.trim();
  if (trimmedRefinement === undefined || trimmedRefinement.length === 0) {
    return trimmedBase;
  }
  return `${trimmedBase}\nIteration notes: ${trimmedRefinement}`;
}

export function buildBookCoverVariationPrompts(
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

function mapGenerationFailure(
  code: string
): BookCoverImageJobError {
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
        code: "COVER_IMAGE_MODERATION_BLOCKED",
        message:
          "The image provider blocked this prompt. Try different wording."
      });
    case "validation_failed":
    case "invalid_structured_output":
      return Object.freeze({
        code: "COVER_IMAGE_INVALID_OUTPUT",
        message: "Cover image generation returned an unusable response."
      });
    default:
      return Object.freeze({
        code: "PROVIDER_UPSTREAM_ERROR",
        message: "The provider call failed."
      });
  }
}

export function createBookCoverImageJob(input: Readonly<{
  accountId: string;
  projectId: string;
  bookId: string;
  basePrompt: string;
  count?: number;
  now?: () => Date;
}>): BookCoverImageJob {
  const now = input.now ?? (() => new Date());
  purgeExpiredJobs(now);
  const createdAt = nowIso(now);
  const job: MutableJob = {
    id: randomUUID(),
    accountId: input.accountId,
    projectId: input.projectId,
    bookId: input.bookId,
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

export function getBookCoverImageJob(input: Readonly<{
  jobId: string;
  accountId: string;
  projectId: string;
  bookId: string;
  now?: () => Date;
}>): BookCoverImageJob | undefined {
  const now = input.now ?? (() => new Date());
  purgeExpiredJobs(now);
  const job = jobs.get(input.jobId);
  if (job === undefined) {
    return undefined;
  }
  if (
    job.accountId !== input.accountId ||
    job.projectId !== input.projectId ||
    job.bookId !== input.bookId
  ) {
    return undefined;
  }
  return toReadonlyJob(job);
}

export function toBookCoverImageJobSnapshot(
  job: BookCoverImageJob
): BookCoverImageJobSnapshot {
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

export function clearBookCoverImageJobsForTests(): void {
  jobs.clear();
}

export async function runBookCoverImageJob(input: Readonly<{
  jobId: string;
  generateImage: BookCoverImageGenerator;
  apiKey: string;
  size?: "1024x1024" | "1024x1536" | "1536x1024" | "1024x1792" | "1792x1024";
  now?: () => Date;
}>): Promise<void> {
  const now = input.now ?? (() => new Date());
  const job = jobs.get(input.jobId);
  if (job === undefined) {
    return;
  }

  job.status = "running";
  job.updatedAt = nowIso(now);

  const prompts = buildBookCoverVariationPrompts(job.basePrompt, job.count);
  const size = input.size ?? COVER_IMAGE_SIZE;

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

    const options: BookCoverImageJobOption[] = [];
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
    // Never log api keys or prompt payloads from unexpected generator failures.
    job.status = "failed";
    job.options = [];
    job.error = mapGenerationFailure("upstream_error");
    job.updatedAt = nowIso(now);
  }
}
