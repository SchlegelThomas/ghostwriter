import { generateOpenAiImage } from "@ghostwriter/ai";
import {
  accountId,
  bookId,
  buildBookCoverLocatorUrl,
  buildBookCoverObjectKey,
  decodePngDataUri,
  parseBookCoverLocatorUrl,
  projectId,
  type BookCover,
  type CaptureObjectStoragePort,
  type GhostwriterServices
} from "@ghostwriter/core";
import type { Context, Hono } from "hono";
import {
  bookCoverImageApplyRequestSchema,
  bookCoverImageJobRequestSchema,
  bookCoverImageRequestSchema,
  parseJsonRequest
} from "./api-contract.js";
import type { AuthenticatedSession } from "./auth.js";
import type { AgentProviderRuntime } from "./agent-provider-runtime.js";
import {
  ProviderCallsDisabledError,
  ProviderEncryptionUnavailableError
} from "./agent-provider-runtime.js";
import { mapAgentRunRouteError } from "./agent-run-api.js";
import {
  composeBookCoverImagePrompt,
  createBookCoverImageJob,
  getBookCoverImageJob,
  runBookCoverImageJob,
  toBookCoverImageJobSnapshot
} from "./book-cover-image-jobs.js";
import { CaptureObjectStorageError } from "./capture-object-storage-error.js";
import { providerAgentErrorStatusAndBody } from "./provider-agent-api.js";
import type { ScenePartnerImageGenerator } from "./scene-partner-routes.js";

type BookCoverEnvironment = {
  Variables: {
    authSession: AuthenticatedSession;
  };
};

export type BookCoverImageRouteDependencies = Readonly<{
  agentProvider: AgentProviderRuntime;
  services: GhostwriterServices;
  objectStorage: CaptureObjectStoragePort;
  /** Defaults to live OpenAI Images; hermetic/tests inject a fake. */
  generateImage?: ScenePartnerImageGenerator;
  now?: () => Date;
}>;

const DOWNLOAD_TTL_MS = 5 * 60 * 1000;
const COVER_IMAGE_SIZE = "1024x1536" as const;

function invalidRequestResponse(
  context: Context<BookCoverEnvironment>,
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

function providerImageError(
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
    case "refusal":
      return {
        status: 422,
        body: {
          error:
            "The image provider blocked this prompt. Try different wording.",
          code: "COVER_IMAGE_MODERATION_BLOCKED"
        }
      };
    case "validation_failed":
    case "invalid_structured_output":
      return {
        status: 422,
        body: {
          error: "Cover image generation returned an unusable response.",
          code: "COVER_IMAGE_INVALID_OUTPUT"
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

function bytesToPngDataUri(bytes: Uint8Array): string {
  return `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
}

function mergeCoverWithImageUrl(
  existing: BookCover | undefined,
  imageUrl: string
): BookCover {
  return Object.freeze({
    ...(existing?.concept === undefined ? {} : { concept: existing.concept }),
    ...(existing?.notes === undefined ? {} : { notes: existing.notes }),
    imageUrl
  });
}

async function loadBookInProject(input: Readonly<{
  services: GhostwriterServices;
  accountId: ReturnType<typeof accountId>;
  projectId: ReturnType<typeof projectId>;
  bookId: ReturnType<typeof bookId>;
}>) {
  const navigator = await input.services.getProjectNavigator(
    input.accountId,
    input.projectId
  );
  if (navigator === undefined) {
    return undefined;
  }
  const book = navigator.books.find((candidate) => candidate.id === input.bookId);
  if (book === undefined) {
    return Object.freeze({ navigator, book: undefined as undefined });
  }
  return Object.freeze({ navigator, book });
}

async function resolveImageApiKey(
  agentProvider: AgentProviderRuntime,
  account: ReturnType<typeof accountId>,
  usingInjectedGenerator: boolean
): Promise<string> {
  if (usingInjectedGenerator) {
    // Hermetic/tests inject a generator — do not require a saved BYOK key.
    return "injected-image-generator";
  }
  assertProviderCallable(agentProvider);
  return agentProvider.resolveOpenAiApiKey({ accountId: account });
}

export function registerBookCoverImageRoutes(
  app: Hono<BookCoverEnvironment>,
  dependencies: BookCoverImageRouteDependencies
): void {
  const { agentProvider, services, objectStorage } = dependencies;
  const usingInjectedGenerator = dependencies.generateImage !== undefined;
  const generateImage = dependencies.generateImage ?? generateOpenAiImage;
  const now = dependencies.now ?? (() => new Date());

  app.post(
    "/api/projects/:projectId/books/:bookId/cover/images",
    async (context) => {
      const parsed = await parseJsonRequest(context.req.raw, bookCoverImageRequestSchema);
      if (!parsed.success) {
        return invalidRequestResponse(context, parsed);
      }
      try {
        const authSession = context.get("authSession");
        const account = accountId(authSession.account.id);
        const scopedProjectId = projectId(context.req.param("projectId"));
        const scopedBookId = bookId(context.req.param("bookId"));

        const loaded = await loadBookInProject({
          services,
          accountId: account,
          projectId: scopedProjectId,
          bookId: scopedBookId
        });
        if (loaded === undefined) {
          return context.json(
            { error: "Project not found.", code: "PROJECT_NOT_FOUND" },
            404
          );
        }
        if (loaded.book === undefined) {
          return context.json({ error: "Book not found.", code: "BOOK_NOT_FOUND" }, 404);
        }

        const apiKey = await resolveImageApiKey(
          agentProvider,
          account,
          usingInjectedGenerator
        );
        const generated = await generateImage({
          apiKey,
          prompt: parsed.data.prompt,
          size: COVER_IMAGE_SIZE
        });
        if (!generated.ok) {
          const mapped = providerImageError(generated.diagnostic.code);
          return context.json(mapped.body, mapped.status);
        }

        return context.json(
          {
            previewUrl: generated.dataUri,
            alt: "Proposed book cover",
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

  app.post(
    "/api/projects/:projectId/books/:bookId/cover/images/jobs",
    async (context) => {
      const parsed = await parseJsonRequest(
        context.req.raw,
        bookCoverImageJobRequestSchema
      );
      if (!parsed.success) {
        return invalidRequestResponse(context, parsed);
      }
      try {
        const authSession = context.get("authSession");
        const account = accountId(authSession.account.id);
        const scopedProjectId = projectId(context.req.param("projectId"));
        const scopedBookId = bookId(context.req.param("bookId"));

        const loaded = await loadBookInProject({
          services,
          accountId: account,
          projectId: scopedProjectId,
          bookId: scopedBookId
        });
        if (loaded === undefined) {
          return context.json(
            { error: "Project not found.", code: "PROJECT_NOT_FOUND" },
            404
          );
        }
        if (loaded.book === undefined) {
          return context.json({ error: "Book not found.", code: "BOOK_NOT_FOUND" }, 404);
        }

        const apiKey = await resolveImageApiKey(
          agentProvider,
          account,
          usingInjectedGenerator
        );
        const basePrompt = composeBookCoverImagePrompt(
          parsed.data.prompt,
          parsed.data.refinement
        );
        const job = createBookCoverImageJob({
          accountId: account,
          projectId: scopedProjectId,
          bookId: scopedBookId,
          basePrompt,
          count: parsed.data.count,
          now
        });

        void runBookCoverImageJob({
          jobId: job.id,
          generateImage,
          apiKey,
          size: COVER_IMAGE_SIZE,
          now
        });

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
    "/api/projects/:projectId/books/:bookId/cover/images/jobs/:jobId",
    async (context) => {
      try {
        const authSession = context.get("authSession");
        const account = accountId(authSession.account.id);
        const scopedProjectId = projectId(context.req.param("projectId"));
        const scopedBookId = bookId(context.req.param("bookId"));
        const jobId = context.req.param("jobId");

        const loaded = await loadBookInProject({
          services,
          accountId: account,
          projectId: scopedProjectId,
          bookId: scopedBookId
        });
        if (loaded === undefined) {
          return context.json(
            { error: "Project not found.", code: "PROJECT_NOT_FOUND" },
            404
          );
        }
        if (loaded.book === undefined) {
          return context.json({ error: "Book not found.", code: "BOOK_NOT_FOUND" }, 404);
        }

        const job = getBookCoverImageJob({
          jobId,
          accountId: account,
          projectId: scopedProjectId,
          bookId: scopedBookId,
          now
        });
        if (job === undefined) {
          return context.json(
            { error: "Cover image job not found.", code: "COVER_IMAGE_JOB_NOT_FOUND" },
            404
          );
        }

        return context.json(toBookCoverImageJobSnapshot(job), 200);
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
    "/api/projects/:projectId/books/:bookId/cover/images/apply",
    async (context) => {
      const parsed = await parseJsonRequest(
        context.req.raw,
        bookCoverImageApplyRequestSchema
      );
      if (!parsed.success) {
        return invalidRequestResponse(context, parsed);
      }
      try {
        const authSession = context.get("authSession");
        const account = accountId(authSession.account.id);
        const scopedProjectId = projectId(context.req.param("projectId"));
        const scopedBookId = bookId(context.req.param("bookId"));

        const loaded = await loadBookInProject({
          services,
          accountId: account,
          projectId: scopedProjectId,
          bookId: scopedBookId
        });
        if (loaded === undefined) {
          return context.json(
            { error: "Project not found.", code: "PROJECT_NOT_FOUND" },
            404
          );
        }
        if (loaded.book === undefined) {
          return context.json({ error: "Book not found.", code: "BOOK_NOT_FOUND" }, 404);
        }

        let previewDataUri = parsed.data.previewDataUri;
        if (previewDataUri === undefined) {
          const apiKey = await resolveImageApiKey(
            agentProvider,
            account,
            usingInjectedGenerator
          );
          const generated = await generateImage({
            apiKey,
            prompt: parsed.data.prompt!,
            size: COVER_IMAGE_SIZE
          });
          if (!generated.ok) {
            const mapped = providerImageError(generated.diagnostic.code);
            return context.json(mapped.body, mapped.status);
          }
          previewDataUri = generated.dataUri;
        }

        const bytes = decodePngDataUri(previewDataUri);
        const objectKey = buildBookCoverObjectKey(scopedProjectId, scopedBookId);
        const locator = buildBookCoverLocatorUrl(scopedProjectId, scopedBookId);

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
                error: "Book cover object storage is unavailable.",
                code: "COVER_STORAGE_UNAVAILABLE"
              },
              503
            );
          }
          throw error;
        }

        const cover = mergeCoverWithImageUrl(loaded.book.cover, locator);
        const navigator = await services.executeProjectCommand({
          accountId: account,
          projectId: scopedProjectId,
          expectedVersion: loaded.navigator.version,
          command: {
            type: "book.update",
            bookId: scopedBookId,
            cover
          }
        });
        const updatedBook = navigator.books.find(
          (candidate) => candidate.id === scopedBookId
        );
        const persistedCover = updatedBook?.cover ?? cover;

        return context.json(
          {
            cover: persistedCover,
            imageUrl: locator
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
    "/api/projects/:projectId/books/:bookId/cover/download",
    async (context) => {
      try {
        const authSession = context.get("authSession");
        const account = accountId(authSession.account.id);
        const scopedProjectId = projectId(context.req.param("projectId"));
        const scopedBookId = bookId(context.req.param("bookId"));

        const loaded = await loadBookInProject({
          services,
          accountId: account,
          projectId: scopedProjectId,
          bookId: scopedBookId
        });
        if (loaded === undefined) {
          return context.json(
            { error: "Project not found.", code: "PROJECT_NOT_FOUND" },
            404
          );
        }
        if (loaded.book === undefined) {
          return context.json({ error: "Book not found.", code: "BOOK_NOT_FOUND" }, 404);
        }

        const imageUrl = loaded.book.cover?.imageUrl;
        if (imageUrl === undefined) {
          return context.json(
            { error: "Book cover image not found.", code: "COVER_IMAGE_NOT_FOUND" },
            404
          );
        }
        const locator = parseBookCoverLocatorUrl(imageUrl);
        if (
          locator === undefined ||
          locator.projectId !== scopedProjectId ||
          locator.bookId !== scopedBookId
        ) {
          return context.json(
            { error: "Book cover image not found.", code: "COVER_IMAGE_NOT_FOUND" },
            404
          );
        }

        const objectKey = buildBookCoverObjectKey(scopedProjectId, scopedBookId);
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
                error: "Book cover object storage is unavailable.",
                code: "COVER_STORAGE_UNAVAILABLE"
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
