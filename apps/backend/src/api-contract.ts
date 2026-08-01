import {
  bookId,
  CAPTURE_ATTACHMENT_MAX_DISPLAY_FILENAME_LENGTH,
  MCP_GRANT_TOOL_NAMES,
  CANVAS_MAX_COORDINATE,
  CANVAS_MAX_DIMENSION,
  CANVAS_MAX_ZOOM,
  CANVAS_MIN_ZOOM,
  CATALOG_AGENT_IDS,
  canvasLinkId,
  canvasObjectId,
  canvasRevisionId,
  captureContentHash,
  chapterId,
  partId,
  revisionId,
  SCENE_VARIANT_NAME_MAX_LENGTH,
  sceneId,
  storyKnowledgeId,
  isAgentModelId,
  getModelCatalogEntry,
  OPENAI_PROVIDER_ID,
  type AccountId,
  type CanvasCommand,
  type CaptureId,
  type CreateSceneFromCanvasInput,
  type ProjectCommand,
  type ProjectId,
  type PromoteCaptureToSceneInput
} from "@ghostwriter/core";
import { z } from "zod";

export type JsonRequestResult<Output> =
  | Readonly<{ success: true; data: Output }>
  | Readonly<{
      success: false;
      code: "INVALID_JSON" | "INVALID_REQUEST" | "PAYLOAD_TOO_LARGE";
      issues?: readonly { path: string; message: string }[];
    }>;

export const DEFAULT_JSON_REQUEST_MAX_BYTES = 65_536;
export const SCENE_DOCUMENT_REQUEST_MAX_BYTES = 2 * 1_024 * 1_024;

export async function parseJsonRequest<Output>(
  request: Request,
  schema: z.ZodType<Output>,
  maxBytes = DEFAULT_JSON_REQUEST_MAX_BYTES
): Promise<JsonRequestResult<Output>> {
  const contentLength = Number.parseInt(
    request.headers.get("content-length") ?? "",
    10
  );
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    return { success: false, code: "PAYLOAD_TOO_LARGE" };
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    return { success: false, code: "PAYLOAD_TOO_LARGE" };
  }

  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    return { success: false, code: "INVALID_JSON" };
  }

  const result = schema.safeParse(value);
  if (!result.success) {
    return {
      success: false,
      code: "INVALID_REQUEST",
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message
      }))
    };
  }
  return { success: true, data: result.data };
}

const title = z.string().trim().min(1).max(200);
const displayName = z.string().trim().min(1).max(100);
const id = z.string().trim().min(1).max(200);
const position = z.number().int().nonnegative();
const bookStatus = z.enum(["planned", "drafting", "revising", "complete"]);
const sceneStatus = z.enum(["planned", "drafting", "revising", "complete"]);
const knowledgeKind = z.enum([
  "character",
  "location",
  "world-rule",
  "thread",
  "custom"
]);
const knowledgeAuthority = z.enum(["planned", "confirmed", "inferred", "disputed"]);
const knowledgeLinkKind = z.enum([
  "cast",
  "theme",
  "development-cycle",
  "breadcrumb",
  "related"
]);
const httpUrl = z
  .string()
  .trim()
  .min(1)
  .max(2_000)
  .refine((value) => {
    try {
      const parsed = new URL(value);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  }, "Must be an absolute http(s) URL");
const sceneBackdrop = z.object({
  url: httpUrl,
  caption: z.string().trim().min(1).max(500).optional()
});
const sceneMusic = z.object({
  url: httpUrl,
  label: z.string().trim().min(1).max(200).optional()
});
const sceneImageRef = z.object({
  url: httpUrl,
  alt: z.string().trim().min(1).max(500),
  caption: z.string().trim().min(1).max(500).optional()
});
const sceneSketchInkPoint = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  pressure: z.number().min(0).max(1).optional()
});
const sceneSketchInkPath = z.object({
  points: z.array(sceneSketchInkPoint).min(1).max(2_000),
  color: z.string().trim().min(1).max(40),
  size: z.number().positive().max(64)
});
const sceneSketch = z
  .object({
    purpose: z.string().trim().min(1).max(2_000).optional(),
    conflict: z.string().trim().min(1).max(2_000).optional(),
    turn: z.string().trim().min(1).max(2_000).optional(),
    beats: z.array(z.string().trim().min(1).max(500)).max(40).optional(),
    sensoryNotes: z.string().trim().min(1).max(5_000).optional(),
    openQuestions: z.string().trim().min(1).max(5_000).optional(),
    detail: z.string().trim().min(1).max(20_000).optional(),
    inkPaths: z.array(sceneSketchInkPath).max(100).optional()
  })
  .refine(
    (value) =>
      value.purpose !== undefined ||
      value.conflict !== undefined ||
      value.turn !== undefined ||
      (value.beats !== undefined && value.beats.length > 0) ||
      value.sensoryNotes !== undefined ||
      value.openQuestions !== undefined ||
      value.detail !== undefined ||
      (value.inkPaths !== undefined && value.inkPaths.length > 0),
    "Sketch must include at least one craft field"
  );
const characterVisual = z
  .object({
    id,
    url: z.string().trim().url().max(2_000),
    alt: z.string().trim().min(1).max(500),
    caption: z.string().trim().min(1).max(2_000).optional(),
    source: z.enum(["generated", "upload", "url"])
  })
  .strict();

const characterSheet = z
  .object({
    desire: z.string().trim().min(1).max(2_000).optional(),
    pressure: z.string().trim().min(1).max(2_000).optional(),
    voiceNotes: z.string().trim().min(1).max(5_000).optional()
  })
  .refine(
    (value) =>
      value.desire !== undefined ||
      value.pressure !== undefined ||
      value.voiceNotes !== undefined,
    "Character sheet must include at least one field"
  );
const longText = z.string().trim().min(1).max(20_000);
const alias = z.string().trim().min(1).max(200);

export const createProjectRequestSchema = z.object({
  title,
  firstBookTitle: title
});

const optionalProfileText = (max: number) =>
  z.string().trim().max(max).optional();

const writerPublishingSchema = z
  .object({
    legalName: optionalProfileText(120),
    contactEmail: optionalProfileText(200),
    phone: optionalProfileText(40),
    addressLine1: optionalProfileText(200),
    addressLine2: optionalProfileText(200),
    city: optionalProfileText(100),
    region: optionalProfileText(100),
    postalCode: optionalProfileText(40),
    country: optionalProfileText(100),
    website: optionalProfileText(300),
    bio: optionalProfileText(4_000),
    agentName: optionalProfileText(120),
    agencyName: optionalProfileText(160)
  })
  .strict();

export const updateProfileRequestSchema = z.object({
  displayName,
  publishing: writerPublishingSchema.nullable().optional(),
  expectedVersion: z.number().int().positive()
});

export const writingAssistRequestSchema = z.object({
  role: z.enum([
    "scene-partner",
    "character-coach",
    "worldkeeper",
    "sketch-partner"
  ]),
  sceneId: id,
  sceneTitle: title,
  sceneSummary: z.string().trim().min(1).max(5_000).optional(),
  recentProse: z.string().max(8_000).optional(),
  sketch: sceneSketch.optional(),
  backdropCaption: z.string().trim().min(1).max(2_000).optional(),
  cast: z
    .array(
      z.object({
        id,
        label: title,
        characterSheet: characterSheet.optional()
      })
    )
    .max(40)
    .optional()
});

const commandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("project.rename"), title }),
  z.object({ type: z.literal("project.setArchived"), archived: z.boolean() }),
  z.object({ type: z.literal("book.create"), title }),
  z.object({
    type: z.literal("book.update"),
    bookId: id,
    title: title.optional(),
    status: bookStatus.optional(),
    cover: z
      .object({
        concept: z.string().trim().min(1).max(5_000).optional(),
        notes: z.string().trim().min(1).max(5_000).optional(),
        imageUrl: httpUrl.optional()
      })
      .partial()
      .nullable()
      .optional()
  }),
  z.object({ type: z.literal("book.reorder"), bookIds: z.array(id).max(100) }),
  z.object({
    type: z.literal("book.setArchived"),
    bookId: id,
    archived: z.boolean()
  }),
  z.object({ type: z.literal("part.create"), bookId: id, title }),
  z.object({
    type: z.literal("part.rename"),
    bookId: id,
    partId: id,
    title
  }),
  z.object({
    type: z.literal("part.update"),
    bookId: id,
    partId: id,
    title: title.optional(),
    summary: z.string().trim().min(1).max(5_000).nullable().optional()
  }),
  z.object({
    type: z.literal("part.reorder"),
    bookId: id,
    partIds: z.array(id).max(500)
  }),
  z.object({
    type: z.literal("part.removeEmpty"),
    bookId: id,
    partId: id
  }),
  z.object({
    type: z.literal("chapter.create"),
    bookId: id,
    partId: id,
    title
  }),
  z.object({
    type: z.literal("chapter.rename"),
    bookId: id,
    partId: id,
    chapterId: id,
    title
  }),
  z.object({
    type: z.literal("chapter.update"),
    bookId: id,
    partId: id,
    chapterId: id,
    title: title.optional(),
    summary: z.string().trim().min(1).max(5_000).nullable().optional()
  }),
  z.object({
    type: z.literal("chapter.reorder"),
    bookId: id,
    partId: id,
    chapterIds: z.array(id).max(2_000)
  }),
  z.object({
    type: z.literal("chapter.removeEmpty"),
    bookId: id,
    partId: id,
    chapterId: id
  }),
  z.object({
    type: z.literal("scene.create"),
    bookId: id,
    title,
    chapterId: id.optional(),
    position: position.optional()
  }),
  z.object({
    type: z.literal("scene.update"),
    sceneId: id,
    title: title.optional(),
    status: sceneStatus.optional(),
    summary: z.string().trim().min(1).max(5_000).nullable().optional(),
    povStoryKnowledgeId: id.nullable().optional(),
    backdrop: sceneBackdrop.nullable().optional(),
    music: sceneMusic.nullable().optional(),
    imageRefs: z.array(sceneImageRef).max(50).nullable().optional(),
    sketch: sceneSketch.nullable().optional()
  }),
  z.object({
    type: z.literal("scene.move"),
    sceneId: id,
    bookId: id,
    chapterId: id.optional(),
    position
  }),
  z.object({
    type: z.literal("scene.setArchived"),
    sceneId: id,
    archived: z.boolean()
  }),
  z.object({
    type: z.literal("storyKnowledge.create"),
    label: title,
    kind: knowledgeKind,
    authority: knowledgeAuthority
  }),
  z.object({
    type: z.literal("storyKnowledge.update"),
    storyKnowledgeId: id,
    label: title.optional(),
    kind: knowledgeKind.optional(),
    authority: knowledgeAuthority.optional(),
    notes: longText.nullable().optional(),
    aliases: z.array(alias).max(50).nullable().optional(),
    characterSheet: characterSheet.nullable().optional(),
    visuals: z.array(characterVisual).min(1).max(24).nullable().optional()
  }),
  z.object({
    type: z.literal("storyKnowledge.setSceneLink"),
    storyKnowledgeId: id,
    sceneId: id,
    linked: z.boolean()
  }),
  z.object({
    type: z.literal("storyKnowledge.setKnowledgeLink"),
    fromId: id,
    toId: id,
    kind: knowledgeLinkKind,
    linked: z.boolean()
  }),
  z.object({
    type: z.literal("storyKnowledge.setArchived"),
    storyKnowledgeId: id,
    archived: z.boolean()
  })
]);

export const executeProjectCommandRequestSchema = z.object({
  expectedVersion: z.number().int().positive(),
  command: commandSchema
});

export const saveSceneDocumentRequestSchema = z
  .object({
    expectedWorkingVersion: z.number().int().positive(),
    document: z.unknown()
  })
  .strict();

export const saveCaptureDocumentRequestSchema = saveSceneDocumentRequestSchema;
export const CAPTURE_DOCUMENT_REQUEST_MAX_BYTES = SCENE_DOCUMENT_REQUEST_MAX_BYTES;

export const createCaptureRequestSchema = z
  .object({
    sourceModality: z.enum(["text", "dictation"]).default("text")
  })
  .strict();

export const setCaptureArchivedRequestSchema = z
  .object({
    archived: z.boolean()
  })
  .strict();

const captureAttachmentSha256Schema = z
  .string()
  .trim()
  .regex(/^[0-9a-f]{64}$/i, "Must be a 64-character hexadecimal SHA-256 digest.");

export const initCaptureAttachmentRequestSchema = z
  .object({
    displayFilename: z
      .string()
      .trim()
      .min(1)
      .max(CAPTURE_ATTACHMENT_MAX_DISPLAY_FILENAME_LENGTH),
    declaredContentType: z.string().trim().min(1).max(200),
    declaredByteSize: z.number().int().positive(),
    clientSha256: captureAttachmentSha256Schema
  })
  .strict();

export const finalizeCaptureAttachmentRequestSchema = z.object({}).strict();

export async function parseOptionalJsonRequest<Output>(
  request: Request,
  schema: z.ZodType<Output>,
  maxBytes = DEFAULT_JSON_REQUEST_MAX_BYTES
): Promise<JsonRequestResult<Output>> {
  const contentLength = Number.parseInt(
    request.headers.get("content-length") ?? "",
    10
  );
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    return { success: false, code: "PAYLOAD_TOO_LARGE" };
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    return { success: false, code: "PAYLOAD_TOO_LARGE" };
  }

  let value: unknown;
  if (text.trim() === "") {
    value = {};
  } else {
    try {
      value = JSON.parse(text) as unknown;
    } catch {
      return { success: false, code: "INVALID_JSON" };
    }
  }

  const result = schema.safeParse(value);
  if (!result.success) {
    return {
      success: false,
      code: "INVALID_REQUEST",
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message
      }))
    };
  }
  return { success: true, data: result.data };
}

export const createSceneCheckpointRequestSchema = z
  .object({
    expectedWorkingVersion: z.number().int().positive()
  })
  .strict();

export const createSceneVariantRequestSchema = z
  .object({
    expectedWorkingVersion: z.number().int().positive(),
    name: z.string().trim().min(1).max(SCENE_VARIANT_NAME_MAX_LENGTH)
  })
  .strict();

export const compareSceneRevisionsRequestSchema = z
  .object({
    beforeRevisionId: id.transform(revisionId),
    afterRevisionId: id.transform(revisionId)
  })
  .strict();

export const restoreSceneRevisionRequestSchema = z
  .object({
    expectedWorkingVersion: z.number().int().positive(),
    revisionId: id.transform(revisionId)
  })
  .strict();

const canvasCoordinate = z
  .number()
  .finite()
  .min(-CANVAS_MAX_COORDINATE)
  .max(CANVAS_MAX_COORDINATE);
const canvasDimension = z
  .number()
  .finite()
  .min(1)
  .max(CANVAS_MAX_DIMENSION);
const canvasZ = z
  .number()
  .finite()
  .min(-CANVAS_MAX_COORDINATE)
  .max(CANVAS_MAX_COORDINATE);
const canvasObjectReference = id.transform(canvasObjectId);
const canvasObjectKind = z.enum([
  "scene-card",
  "story-knowledge-card",
  "note",
  "region",
  "image-reference"
]);
const canvasLinkKind = z.enum([
  "pin",
  "thread",
  "beat",
  "dependency",
  "reference"
]);
const canvasAuthority = z.enum(["confirmed", "provisional"]);
const canvasNoteMetadata = z
  .object({
    body: z.string().trim().min(1).max(20_000).optional(),
    color: z.string().trim().min(1).max(100).optional()
  })
  .strict();
const canvasImageMetadata = z
  .object({
    assetId: z.string().trim().min(1).max(500).optional(),
    altText: z.string().trim().min(1).max(1_000).optional(),
    caption: z.string().trim().min(1).max(2_000).optional(),
    mimeType: z.string().trim().min(1).max(200).optional()
  })
  .strict();
const canvasObjectDraftSchema = z
  .object({
    kind: canvasObjectKind,
    x: canvasCoordinate,
    y: canvasCoordinate,
    width: canvasDimension,
    height: canvasDimension,
    z: canvasZ,
    parentRegionId: canvasObjectReference.optional(),
    authority: canvasAuthority,
    label: z.string().trim().min(1).max(200),
    note: canvasNoteMetadata.optional(),
    image: canvasImageMetadata.optional(),
    sceneId: id.transform(sceneId).optional(),
    storyKnowledgeId: id.transform(storyKnowledgeId).optional(),
    storyOrderHint: z
      .number()
      .int()
      .nonnegative()
      .max(CANVAS_MAX_COORDINATE)
      .optional(),
    sourceKey: z.string().trim().min(1).max(500).optional(),
    provenance: z.string().trim().min(1).max(1_000).optional()
  })
  .strict();
const canvasLinkDraftSchema = z
  .object({
    kind: canvasLinkKind,
    fromObjectId: canvasObjectReference,
    toObjectId: canvasObjectReference,
    authority: canvasAuthority,
    label: z.string().trim().min(1).max(200).optional(),
    sourceKey: z.string().trim().min(1).max(500).optional(),
    provenance: z.string().trim().min(1).max(1_000).optional()
  })
  .strict();
const canvasObjectUpdateSchema = z
  .object({
    label: z.string().trim().min(1).max(200).optional(),
    z: canvasZ.optional(),
    parentRegionId: canvasObjectReference.nullable().optional(),
    note: canvasNoteMetadata.nullable().optional(),
    image: canvasImageMetadata.nullable().optional(),
    storyOrderHint: z
      .number()
      .int()
      .nonnegative()
      .max(CANVAS_MAX_COORDINATE)
      .nullable()
      .optional(),
    sourceKey: z.string().trim().min(1).max(500).nullable().optional(),
    provenance: z.string().trim().min(1).max(1_000).nullable().optional()
  })
  .strict();
const canvasLinkUpdateSchema = z
  .object({
    label: z.string().trim().min(1).max(200).nullable().optional(),
    sourceKey: z.string().trim().min(1).max(500).nullable().optional(),
    provenance: z.string().trim().min(1).max(1_000).nullable().optional()
  })
  .strict();

const canvasCommandSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.enum(["canvas.object.create", "canvas.object.place"]),
      object: canvasObjectDraftSchema
    })
    .strict(),
  z
    .object({
      type: z.literal("canvas.object.update"),
      objectId: canvasObjectReference,
      changes: canvasObjectUpdateSchema
    })
    .strict(),
  z
    .object({
      type: z.literal("canvas.object.move"),
      objectId: canvasObjectReference,
      x: canvasCoordinate,
      y: canvasCoordinate,
      parentRegionId: canvasObjectReference.nullable().optional()
    })
    .strict(),
  z
    .object({
      type: z.literal("canvas.object.resize"),
      objectId: canvasObjectReference,
      width: canvasDimension,
      height: canvasDimension
    })
    .strict(),
  z
    .object({
      type: z.literal("canvas.object.setScopePlacement"),
      objectId: canvasObjectReference,
      scopeKind: z.enum(["project", "chapter", "scene"]),
      scopeId: z.string().trim().min(1).max(200).optional(),
      x: canvasCoordinate,
      y: canvasCoordinate,
      width: canvasDimension.optional(),
      height: canvasDimension.optional()
    })
    .strict()
    .superRefine((value, context) => {
      if (value.scopeKind === "project" && value.scopeId !== undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "A project Canvas scope must not carry a scope ID.",
          path: ["scopeId"]
        });
      }
      if (value.scopeKind !== "project" && value.scopeId === undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Chapter and scene Canvas scopes require a scope ID.",
          path: ["scopeId"]
        });
      }
    }),
  z
    .object({
      type: z.enum([
        "canvas.object.archive",
        "canvas.object.restore",
        "canvas.object.confirm",
        "canvas.object.dismiss"
      ]),
      objectId: canvasObjectReference
    })
    .strict(),
  z
    .object({
      type: z.literal("canvas.link.create"),
      link: canvasLinkDraftSchema
    })
    .strict(),
  z
    .object({
      type: z.literal("canvas.link.update"),
      linkId: id.transform(canvasLinkId),
      changes: canvasLinkUpdateSchema
    })
    .strict(),
  z
    .object({
      type: z.enum([
        "canvas.link.archive",
        "canvas.link.restore",
        "canvas.link.confirm",
        "canvas.link.dismiss"
      ]),
      linkId: id.transform(canvasLinkId)
    })
    .strict()
]);

export const executeCanvasCommandRequestSchema = z
  .object({
    expectedCanvasVersion: z.number().int().positive(),
    command: canvasCommandSchema
  })
  .strict();

export const restoreCanvasRequestSchema = z
  .object({
    expectedCanvasVersion: z.number().int().positive(),
    revisionId: id.transform(canvasRevisionId).optional()
  })
  .strict();

export const saveCanvasPreferenceRequestSchema = z
  .object({
    x: canvasCoordinate,
    y: canvasCoordinate,
    zoom: z.number().finite().min(CANVAS_MIN_ZOOM).max(CANVAS_MAX_ZOOM),
    selectedObjectId: canvasObjectReference.nullable().optional()
  })
  .strict();

const canvasGeometrySchema = z
  .object({
    x: canvasCoordinate,
    y: canvasCoordinate,
    width: canvasDimension,
    height: canvasDimension,
    z: canvasZ,
    parentRegionId: canvasObjectReference.optional(),
    storyOrderHint: z
      .number()
      .int()
      .nonnegative()
      .max(CANVAS_MAX_COORDINATE)
      .optional(),
    label: z.string().trim().min(1).max(200).optional(),
    sourceKey: z.string().trim().min(1).max(500).optional(),
    provenance: z.string().trim().min(1).max(1_000).optional()
  })
  .strict();
const manuscriptPlacementSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("chapter"),
      bookId: id.transform(bookId),
      chapterId: id.transform(chapterId),
      position: position.optional()
    })
    .strict(),
  z
    .object({
      kind: z.literal("unassigned"),
      bookId: id.transform(bookId),
      position: position.optional()
    })
    .strict()
]);

export const createSceneFromCanvasRequestSchema = z
  .object({
    expectedProjectVersion: z.number().int().positive(),
    expectedCanvasVersion: z.number().int().positive(),
    title,
    manuscriptPlacement: manuscriptPlacementSchema,
    canvas: canvasGeometrySchema
  })
  .strict();

export function toCanvasCommand(
  command: z.infer<typeof canvasCommandSchema>
): CanvasCommand {
  return command as CanvasCommand;
}

export type ParsedCreateSceneFromCanvasRequest = z.infer<
  typeof createSceneFromCanvasRequestSchema
>;

export function toCreateSceneFromCanvasInput(
  request: ParsedCreateSceneFromCanvasRequest,
  accountId: CreateSceneFromCanvasInput["accountId"],
  projectId: CreateSceneFromCanvasInput["projectId"]
): CreateSceneFromCanvasInput {
  return {
    accountId,
    projectId,
    ...request
  };
}

const captureContentHashRequestSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-f0-9]{64}$/u,
    "Capture content hash must be a SHA-256 digest."
  );

const promoteCaptureCanvasRequestSchema = canvasGeometrySchema
  .extend({
    expectedCanvasVersion: z.number().int().positive()
  })
  .strict();

export const promoteCaptureRequestSchema = z
  .object({
    expectedCaptureWorkingVersion: z.number().int().positive(),
    expectedCaptureContentHash: captureContentHashRequestSchema,
    expectedProjectVersion: z.number().int().positive(),
    title,
    manuscriptPlacement: manuscriptPlacementSchema,
    canvas: promoteCaptureCanvasRequestSchema.optional()
  })
  .strict();

export type ParsedPromoteCaptureRequest = z.infer<
  typeof promoteCaptureRequestSchema
>;

export function toPromoteCaptureToSceneInput(
  request: ParsedPromoteCaptureRequest,
  accountId: AccountId,
  projectId: ProjectId,
  captureId: CaptureId
): PromoteCaptureToSceneInput {
  const { canvas, expectedCaptureContentHash, ...rest } = request;
  return {
    accountId,
    projectId,
    captureId,
    expectedCaptureContentHash: captureContentHash(expectedCaptureContentHash),
    ...rest,
    ...(canvas === undefined
      ? {}
      : {
          expectedCanvasVersion: canvas.expectedCanvasVersion,
          canvas: {
            x: canvas.x,
            y: canvas.y,
            width: canvas.width,
            height: canvas.height,
            z: canvas.z,
            ...(canvas.parentRegionId === undefined
              ? {}
              : { parentRegionId: canvas.parentRegionId }),
            ...(canvas.storyOrderHint === undefined
              ? {}
              : { storyOrderHint: canvas.storyOrderHint }),
            ...(canvas.label === undefined ? {} : { label: canvas.label }),
            ...(canvas.sourceKey === undefined
              ? {}
              : { sourceKey: canvas.sourceKey }),
            ...(canvas.provenance === undefined
              ? {}
              : { provenance: canvas.provenance })
          }
        })
  };
}

type ParsedCommand = z.infer<typeof commandSchema>;

export function toProjectCommand(command: ParsedCommand): ProjectCommand {
  switch (command.type) {
    case "project.rename":
    case "project.setArchived":
    case "book.create":
    case "storyKnowledge.create":
      return command;
    case "book.update":
      return { ...command, bookId: bookId(command.bookId) };
    case "book.reorder":
      return { ...command, bookIds: command.bookIds.map(bookId) };
    case "book.setArchived":
    case "part.create":
      return { ...command, bookId: bookId(command.bookId) };
    case "part.rename":
    case "part.update":
    case "part.removeEmpty":
      return {
        ...command,
        bookId: bookId(command.bookId),
        partId: partId(command.partId)
      };
    case "part.reorder":
      return {
        ...command,
        bookId: bookId(command.bookId),
        partIds: command.partIds.map(partId)
      };
    case "chapter.create":
      return {
        ...command,
        bookId: bookId(command.bookId),
        partId: partId(command.partId)
      };
    case "chapter.rename":
    case "chapter.update":
    case "chapter.removeEmpty":
      return {
        ...command,
        bookId: bookId(command.bookId),
        partId: partId(command.partId),
        chapterId: chapterId(command.chapterId)
      };
    case "chapter.reorder":
      return {
        ...command,
        bookId: bookId(command.bookId),
        partId: partId(command.partId),
        chapterIds: command.chapterIds.map(chapterId)
      };
    case "scene.create": {
      const {
        bookId: rawBookId,
        chapterId: rawChapterId,
        ...sceneCreate
      } = command;
      return {
        ...sceneCreate,
        bookId: bookId(rawBookId),
        ...(rawChapterId === undefined
          ? {}
          : { chapterId: chapterId(rawChapterId) })
      };
    }
    case "scene.update": {
      const {
        sceneId: rawSceneId,
        povStoryKnowledgeId: rawPovId,
        ...sceneUpdate
      } = command;
      return {
        ...sceneUpdate,
        sceneId: sceneId(rawSceneId),
        ...(rawPovId === undefined
          ? {}
          : rawPovId === null
            ? { povStoryKnowledgeId: null }
            : { povStoryKnowledgeId: storyKnowledgeId(rawPovId) })
      };
    }
    case "scene.move": {
      const {
        sceneId: rawSceneId,
        bookId: rawBookId,
        chapterId: rawChapterId,
        ...sceneMove
      } = command;
      return {
        ...sceneMove,
        sceneId: sceneId(rawSceneId),
        bookId: bookId(rawBookId),
        ...(rawChapterId === undefined
          ? {}
          : { chapterId: chapterId(rawChapterId) })
      };
    }
    case "scene.setArchived":
      return { ...command, sceneId: sceneId(command.sceneId) };
    case "storyKnowledge.update":
    case "storyKnowledge.setArchived":
      return {
        ...command,
        storyKnowledgeId: storyKnowledgeId(command.storyKnowledgeId)
      };
    case "storyKnowledge.setSceneLink":
      return {
        ...command,
        storyKnowledgeId: storyKnowledgeId(command.storyKnowledgeId),
        sceneId: sceneId(command.sceneId)
      };
    case "storyKnowledge.setKnowledgeLink":
      return {
        ...command,
        fromId: storyKnowledgeId(command.fromId),
        toId: storyKnowledgeId(command.toId)
      };
  }
}

const optionalPositiveVersion = z.number().int().positive().optional();

export const OPENAI_PROVIDER_CREDENTIAL_MAX_BYTES = 4_096;

export const providerIdParamSchema = z.enum([
  "openai",
  "anthropic",
  "google",
  "groq",
  "xai",
  "mistral",
  "deepseek",
  "openrouter"
]);

export const setProviderCredentialRequestSchema = z.object({
  apiKey: z.string().trim().min(20).max(200).regex(/^\S+$/u),
  expectedVersion: optionalPositiveVersion
});

export const deleteProviderCredentialRequestSchema = z.object({
  expectedVersion: z.number().int().positive()
});

export const validateProviderCredentialRequestSchema = z.object({
  expectedVersion: z.number().int().positive()
});

export const setOpenAiProviderCredentialRequestSchema = setProviderCredentialRequestSchema;

export const deleteOpenAiProviderCredentialRequestSchema =
  deleteProviderCredentialRequestSchema;

export const validateOpenAiProviderCredentialRequestSchema =
  validateProviderCredentialRequestSchema;

const aiCollaborationPostureSchema = z.enum([
  "options",
  "questions-first",
  "craft-explanations",
  "minimal"
]);

export const patchAiCollaborationRequestSchema = z.union([
  z.object({
    skipSetup: z.literal(true),
    expectedVersion: optionalPositiveVersion
  }),
  z.object({
    posture: aiCollaborationPostureSchema,
    boundaries: z.string().trim().max(2_000).optional(),
    expectedVersion: optionalPositiveVersion
  })
]);

export const saveProjectAgentInstructionsRequestSchema = z.object({
  body: z.string().trim().min(1).max(8_000),
  expectedVersion: optionalPositiveVersion
});

const catalogPlaybookSectionOverrideSchema = z
  .object({
    heading: z.string().trim().min(1).max(200),
    note: z.string().trim().min(1).max(4_000)
  })
  .strict();

export const saveCatalogPlaybookOverrideRequestSchema = z
  .object({
    doctrine: z.string().trim().min(1).max(8_000).optional(),
    sections: z.array(catalogPlaybookSectionOverrideSchema).min(1).max(24).optional(),
    expectedVersion: optionalPositiveVersion
  })
  .strict()
  .refine(
    (value) => value.doctrine !== undefined || value.sections !== undefined,
    "Doctrine or section notes are required."
  );

export const catalogAgentIdSchema = z.enum(CATALOG_AGENT_IDS);

const playbookTriggerSchema = z.enum(["capture-reflection", "manual"]);
const agentContextClassSchema = z.enum(["capture"]);
const agentOutputSchemaIdSchema = z.enum([
  "capture-reflection-v1",
  "plan-outline-v1",
  "sketch-fields-v1",
  "character-sheet-v1",
  "backdrop-fields-v1"
]);

export const saveProjectPlaybookRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  enabled: z.boolean(),
  trigger: playbookTriggerSchema,
  allowedContextClasses: z.array(agentContextClassSchema).min(1).max(8),
  outputSchemaId: agentOutputSchemaIdSchema,
  guidance: z.string().trim().min(1).max(4_000),
  expectedVersion: optionalPositiveVersion
});

export const updateProjectPlaybookRequestSchema = saveProjectPlaybookRequestSchema;

export const archiveProjectPlaybookRequestSchema = z.object({
  expectedVersion: z.number().int().positive()
});

const agentModelIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine(isAgentModelId, { message: "Invalid agent model id." });

const imageModelIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine((id) => {
    if (!isAgentModelId(id)) return false;
    const entry = getModelCatalogEntry(id);
    if (entry !== undefined) {
      return entry.supportsImage && entry.provider === OPENAI_PROVIDER_ID;
    }
    // Discovered OpenAI image ids (availability checked at the image route).
    const normalized = id.trim().toLowerCase();
    return (
      normalized.includes("image") ||
      normalized.startsWith("dall-e")
    );
  }, { message: "Unknown or unsupported image model." });

const agentWorkflowIdSchema = z.enum([
  "scene-partner.capture-reflection",
  "plan-mode.outline",
  "sketch-partner.craft-fields",
  "character-coach.sheet-fields",
  "worldkeeper.backdrop-fields"
]);

export const catalogAgentRunRequestSchema = z
  .object({
    agentId: z.enum([
      "idea-midwife",
      "genre-compass",
      "what-if-engine",
      "story-architect",
      "pacing-doctor",
      "promise-keeper",
      "outline-expander",
      "scene-sequel-coach",
      "dialogue-coach",
      "character-coach-cast",
      "developmental-editor",
      "continuity-reader",
      "line-editor",
      "copy-editor",
      "pitch-pack",
      "query-coach",
      "series-bible",
      "market-fit"
    ]),
    lens: z
      .enum([
        "save-the-cat",
        "three-act",
        "heros-journey",
        "scene-sequel",
        "character-want-need",
        "genre-conventions"
      ])
      .optional(),
    model: agentModelIdSchema.optional(),
    effort: z.enum(["fast", "standard", "high"]).optional(),
    sceneId: id.optional(),
    storyKnowledgeId: id.optional(),
    bookId: id.optional()
  })
  .strict();

export const agentContextPreviewRequestSchema = z.object({
  captureId: id,
  model: agentModelIdSchema.optional(),
  workflowId: agentWorkflowIdSchema.optional(),
  sceneId: id.optional(),
  storyKnowledgeId: id.optional()
});

export const agentStartRunRequestSchema = z.object({
  receiptId: id,
  expectedReceiptHash: z
    .string()
    .trim()
    .regex(/^[a-f0-9]{64}$/u)
});

export const persistPlanOutlineRequestSchema = z.object({
  outlineText: z.string().trim().min(1).max(8_000),
  title: z.string().trim().min(1).max(120).optional(),
  model: agentModelIdSchema.optional()
});

const scenePartnerTurnPhaseSchema = z.enum([
  "interview",
  "match",
  "new-scene",
  "iterate"
]);

export const scenePartnerTurnRequestSchema = z
  .object({
    ideaProse: z.string().max(24_000),
    scenes: z
      .array(
        z
          .object({
            id: id,
            title: z.string().trim().min(1).max(200),
            label: z.string().trim().min(1).max(400)
          })
          .strict()
      )
      .max(200),
    messages: z
      .array(
        z
          .object({
            role: z.enum(["assistant", "user"]),
            body: z.string().trim().min(1).max(4_000)
          })
          .strict()
      )
      .max(40),
    phase: scenePartnerTurnPhaseSchema.optional(),
    matchedSceneId: id.nullable().optional()
  })
  .strict();

export const scenePartnerImageRequestSchema = z
  .object({
    prompt: z.string().trim().min(1).max(4_000)
  })
  .strict();

export const bookCoverImageRequestSchema = z
  .object({
    prompt: z.string().trim().min(1).max(4_000),
    imageModel: imageModelIdSchema.optional()
  })
  .strict();

export const bookCoverImageJobRequestSchema = z
  .object({
    prompt: z.string().trim().min(1).max(4_000),
    count: z.number().int().min(2).max(4).optional(),
    refinement: z.string().trim().min(1).max(2_000).optional(),
    imageModel: imageModelIdSchema.optional()
  })
  .strict();

export const bookCoverImageApplyRequestSchema = z
  .object({
    prompt: z.string().trim().min(1).max(4_000).optional(),
    previewDataUri: z.string().trim().min(1).max(12_000_000).optional(),
    imageModel: imageModelIdSchema.optional()
  })
  .strict()
  .superRefine((value, context) => {
    const hasPrompt = value.prompt !== undefined;
    const hasPreview = value.previewDataUri !== undefined;
    if (hasPrompt === hasPreview) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide exactly one of prompt or previewDataUri."
      });
    }
  });

export const characterVisualJobRequestSchema = z
  .object({
    prompt: z.string().trim().min(1).max(4_000).optional(),
    count: z.number().int().min(2).max(4).optional(),
    refinement: z.string().trim().min(1).max(2_000).optional(),
    imageModel: imageModelIdSchema.optional()
  })
  .strict();

export const characterVisualApplyRequestSchema = z
  .object({
    previewDataUri: z.string().trim().min(1).max(12_000_000),
    alt: z.string().trim().min(1).max(500),
    source: z.enum(["generated", "upload"]),
    caption: z.string().trim().min(1).max(2_000).optional()
  })
  .strict();

const agentProposalContentHashSchema = z
  .string()
  .trim()
  .regex(/^[a-f0-9]{64}$/u);

export const agentApplyProposalRequestSchema = z.discriminatedUnion("mode", [
  z
    .object({
      mode: z.literal("new-scene"),
      title,
      bookId: id,
      chapterId: id.optional(),
      placeOnCanvas: z.boolean().optional(),
      expectedProjectVersion: z.number().int().positive(),
      expectedCanvasVersion: z.number().int().positive().optional(),
      expectedProposalContentHash: agentProposalContentHashSchema
    })
    .strict(),
  z
    .object({
      mode: z.literal("named-variant"),
      sceneId: id,
      variantName: z.string().trim().min(1).max(SCENE_VARIANT_NAME_MAX_LENGTH),
      expectedWorkingVersion: z.number().int().positive(),
      sessionId: id,
      expectedProposalContentHash: agentProposalContentHashSchema
    })
    .strict(),
  z
    .object({
      mode: z.literal("craft-fields"),
      expectedProjectVersion: z.number().int().positive(),
      expectedProposalContentHash: agentProposalContentHashSchema
    })
    .strict()
]);

export const createMcpGrantRequestSchema = z
  .object({
    captureIds: z.array(id).min(1).max(64),
    tools: z.array(z.enum(MCP_GRANT_TOOL_NAMES)).min(1),
    expiresAt: z.string().trim().min(1).max(64)
  })
  .strict();
