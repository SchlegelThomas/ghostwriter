import {
  bookId,
  chapterId,
  partId,
  sceneId,
  storyKnowledgeId,
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

export async function parseJsonRequest<Output>(
  request: Request,
  schema: z.ZodType<Output>
): Promise<JsonRequestResult<Output>> {
  const text = await request.text();
  if (text.length > 65_536) {
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
