import {
  bookId,
  CANVAS_MAX_COORDINATE,
  CANVAS_MAX_DIMENSION,
  CANVAS_MAX_ZOOM,
  CANVAS_MIN_ZOOM,
  canvasLinkId,
  canvasObjectId,
  canvasRevisionId,
  chapterId,
  partId,
  revisionId,
  SCENE_VARIANT_NAME_MAX_LENGTH,
  sceneId,
  storyKnowledgeId,
  type CanvasCommand,
  type CreateSceneFromCanvasInput,
  type ProjectCommand
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

export const createProjectRequestSchema = z.object({
  title,
  firstBookTitle: title
});

export const updateProfileRequestSchema = z.object({
  displayName,
  expectedVersion: z.number().int().positive()
});

const commandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("project.rename"), title }),
  z.object({ type: z.literal("project.setArchived"), archived: z.boolean() }),
  z.object({ type: z.literal("book.create"), title }),
  z.object({
    type: z.literal("book.update"),
    bookId: id,
    title: title.optional(),
    status: bookStatus.optional()
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
    povStoryKnowledgeId: id.nullable().optional()
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
    authority: knowledgeAuthority.optional()
  }),
  z.object({
    type: z.literal("storyKnowledge.setSceneLink"),
    storyKnowledgeId: id,
    sceneId: id,
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
  }
}
