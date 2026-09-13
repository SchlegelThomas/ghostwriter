import {
  CANVAS_MAX_COORDINATE,
  CANVAS_MAX_DIMENSION,
  CHARACTER_CREATE_V2_MAX_ALIASES,
  CHARACTER_CREATE_V2_MAX_SOURCE_SCENES,
  SCENE_DRAFT_V1_MAX_PROSE_CHARS,
  SCENE_DRAFT_V1_MAX_SOURCE_SCENES,
  SCENE_VARIANT_NAME_MAX_LENGTH,
  STORY_STRUCTURE_MAX_OPERATIONS,
  STORY_STRUCTURE_SCHEMA_ID,
  isAgentModelId,
  validateStoryStructureProposalV1
} from "@ghostwriter/core";
import { z } from "zod";

const id = z.string().trim().min(1).max(200);
const exactWriterText = (maximum: number) =>
  z.string().min(1).max(maximum).refine((value) => value.trim().length > 0, {
    message: "Writer text must not be blank."
  });
const contentHash = z.string().regex(/^[a-f0-9]{64}$/u);
const positiveVersion = z.number().int().positive();

export const storyWorkArtifactSchema = z
  .object({
    proposalId: id,
    artifactVersion: positiveVersion,
    contentHash
  })
  .strict();

const characterSheetSchema = z
  .object({
    desire: exactWriterText(2_000).optional(),
    pressure: exactWriterText(2_000).optional(),
    voiceNotes: exactWriterText(2_000).optional()
  })
  .strict()
  .refine((sheet) => Object.values(sheet).some((value) => value !== undefined), {
    message: "Character sheet must include at least one field."
  });

export const characterCreateV2RequestSchema = z
  .object({
    schemaId: z.literal("character-create-v2"),
    name: exactWriterText(120),
    summary: exactWriterText(4_000),
    aliases: z
      .array(exactWriterText(120))
      .max(CHARACTER_CREATE_V2_MAX_ALIASES)
      .refine((aliases) => new Set(aliases.map((alias) => alias.trim())).size === aliases.length, {
        message: "Character aliases must be unique."
      }),
    characterSheet: characterSheetSchema,
    sourceSceneIds: z.array(id).max(CHARACTER_CREATE_V2_MAX_SOURCE_SCENES).optional()
  })
  .strict();

const storyWorkSubmissionBase = z.object({
  idempotencyKey: id,
  expectedProjectVersion: positiveVersion,
  brief: exactWriterText(20_000),
  constraints: exactWriterText(8_000),
  doneWhen: exactWriterText(4_000),
  sceneIds: z.array(id).max(SCENE_DRAFT_V1_MAX_SOURCE_SCENES),
  model: z.string().trim().refine(isAgentModelId, "Unsupported model.")
});

const uniqueSelectedScenes = <Schema extends z.ZodTypeAny>(schema: Schema) =>
  schema.refine(
    (body) => {
      const value = body as { sceneIds: readonly string[] };
      return new Set(value.sceneIds).size === value.sceneIds.length;
    },
    {
      path: ["sceneIds"],
      message: "Selected scene IDs must be unique."
    }
  );

const submitCharacterStoryWorkRequestBase =
  storyWorkSubmissionBase
    .extend({ taskKind: z.literal("character") })
    .strict();

export const submitCharacterStoryWorkRequestSchema = uniqueSelectedScenes(
  submitCharacterStoryWorkRequestBase
);

const submitSceneStoryWorkRequestBase =
  storyWorkSubmissionBase
    .extend({
      taskKind: z.literal("scene"),
      captureId: id.optional()
    })
    .strict();

export const submitSceneStoryWorkRequestSchema = uniqueSelectedScenes(
  submitSceneStoryWorkRequestBase
);

const submitSceneRevisionStoryWorkRequestBase =
  storyWorkSubmissionBase
    .extend({
      taskKind: z.literal("revise"),
      targetSceneId: id,
      captureId: id.optional()
    })
    .strict();

export const submitSceneRevisionStoryWorkRequestSchema = uniqueSelectedScenes(
  submitSceneRevisionStoryWorkRequestBase
);

const submitCheckStoryWorkRequestBase = storyWorkSubmissionBase
  .extend({
    taskKind: z.literal("check"),
    specialist: z.literal("continuity"),
    targetSceneId: id
  })
  .strict();

export const submitAppliedSceneCheckStoryWorkRequestSchema = uniqueSelectedScenes(
  submitCheckStoryWorkRequestBase
    .extend({
      checkMode: z.literal("applied-scene")
    })
    .strict()
);

export const submitProposalDraftCheckStoryWorkRequestSchema = uniqueSelectedScenes(
  submitCheckStoryWorkRequestBase
    .extend({
      checkMode: z.literal("proposal-draft"),
      sourceAssignmentId: id,
      sourceArtifact: storyWorkArtifactSchema
    })
    .strict()
    .superRefine((body, context) => {
      if (body.sceneIds.includes(body.targetSceneId)) {
        context.addIssue({
          code: "custom",
          message: "Proposal-draft checks must not include the assess scene in sceneIds.",
          path: ["sceneIds"]
        });
      }
    })
);

export const submitCheckStoryWorkRequestSchema = z.discriminatedUnion("checkMode", [
  submitAppliedSceneCheckStoryWorkRequestSchema,
  submitProposalDraftCheckStoryWorkRequestSchema
]);

const submitOutlineStoryWorkRequestBase = storyWorkSubmissionBase
  .extend({
    taskKind: z.literal("outline"),
    targetBookId: id
  })
  .strict();

export const submitOutlineStoryWorkRequestSchema = uniqueSelectedScenes(
  submitOutlineStoryWorkRequestBase
);

export const submitStoryWorkRequestSchema = z
  .discriminatedUnion("taskKind", [
    submitCharacterStoryWorkRequestBase,
    submitSceneStoryWorkRequestBase,
    submitSceneRevisionStoryWorkRequestBase,
    submitCheckStoryWorkRequestSchema,
    submitOutlineStoryWorkRequestBase
  ])
  .superRefine((body, context) => {
    if (new Set(body.sceneIds).size !== body.sceneIds.length) {
      context.addIssue({
        code: "custom",
        path: ["sceneIds"],
        message: "Selected scene IDs must be unique."
      });
    }
    if (body.taskKind === "outline") {
      if ("specialist" in body && body.specialist !== undefined) {
        context.addIssue({
          code: "custom",
          path: ["specialist"],
          message: "Only check story work accepts a specialist."
        });
      }
      if ("checkMode" in body && body.checkMode !== undefined) {
        context.addIssue({
          code: "custom",
          path: ["checkMode"],
          message: "Only check story work accepts checkMode."
        });
      }
      if ("targetSceneId" in body && body.targetSceneId !== undefined) {
        context.addIssue({
          code: "custom",
          path: ["targetSceneId"],
          message: "Only check and revise story work accept targetSceneId."
        });
      }
      if (
        ("sourceAssignmentId" in body && body.sourceAssignmentId !== undefined) ||
        ("sourceArtifact" in body && body.sourceArtifact !== undefined)
      ) {
        context.addIssue({
          code: "custom",
          path: ["sourceAssignmentId"],
          message: "Only proposal-draft checks accept a source assignment artifact."
        });
      }
      if ("captureId" in body && body.captureId !== undefined) {
        context.addIssue({
          code: "custom",
          path: ["captureId"],
          message: "Outline story work does not accept Capture sources."
        });
      }
      return;
    }
    if (body.taskKind !== "check") {
      if ("targetBookId" in body && body.targetBookId !== undefined) {
        context.addIssue({
          code: "custom",
          path: ["targetBookId"],
          message: "Only outline story work accepts targetBookId."
        });
      }
      if ("specialist" in body && body.specialist !== undefined) {
        context.addIssue({
          code: "custom",
          path: ["specialist"],
          message: "Only check story work accepts a specialist."
        });
      }
      if ("checkMode" in body && body.checkMode !== undefined) {
        context.addIssue({
          code: "custom",
          path: ["checkMode"],
          message: "Only check story work accepts checkMode."
        });
      }
      if (
        "targetSceneId" in body &&
        body.targetSceneId !== undefined &&
        body.taskKind !== "revise"
      ) {
        context.addIssue({
          code: "custom",
          path: ["targetSceneId"],
          message: "Only check and revise story work accept targetSceneId."
        });
      }
      if (
        ("sourceAssignmentId" in body && body.sourceAssignmentId !== undefined) ||
        ("sourceArtifact" in body && body.sourceArtifact !== undefined)
      ) {
        context.addIssue({
          code: "custom",
          path: ["sourceAssignmentId"],
          message: "Only proposal-draft checks accept a source assignment artifact."
        });
      }
      return;
    }
  });

export const generateCharacterStoryWorkRequestSchema = z
  .object({
    expectedAssignmentVersion: positiveVersion,
    kind: z.enum(["initial", "revision"]),
    sourceMode: z.enum(["submitted-snapshot", "latest-authorized"]),
    instruction: exactWriterText(20_000),
    priorArtifact: storyWorkArtifactSchema.optional(),
    idempotencyKey: id
  })
  .strict()
  .superRefine((body, context) => {
    if (body.kind === "initial" && body.priorArtifact !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["priorArtifact"],
        message: "Initial generation cannot include a prior artifact."
      });
    }
    if (
      (body.kind === "initial" && body.sourceMode !== "submitted-snapshot") ||
      (body.kind === "revision" && body.sourceMode !== "latest-authorized")
    ) {
      context.addIssue({
        code: "custom",
        path: ["sourceMode"],
        message:
          "Initial work uses submitted sources; revisions require an explicit latest-source refresh."
      });
    }
    if (body.kind === "revision" && body.priorArtifact === undefined) {
      context.addIssue({
        code: "custom",
        path: ["priorArtifact"],
        message: "Revision generation requires the current artifact."
      });
    }
  });

export const generateStoryWorkRequestSchema =
  generateCharacterStoryWorkRequestSchema;

export const openCharacterStoryWorkReviewRequestSchema = z
  .object({
    expectedAssignmentVersion: positiveVersion,
    artifact: storyWorkArtifactSchema
  })
  .strict();

export const openStoryWorkReviewRequestSchema = openCharacterStoryWorkReviewRequestSchema;

const storyCheckFindingResolutionSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("open") }).strict(),
  z.object({ status: z.literal("dismissed") }).strict(),
  z
    .object({
      status: z.literal("deferred"),
      reason: exactWriterText(500)
    })
    .strict()
]);

export const resolveCheckStoryWorkFindingRequestSchema = z
  .object({
    expectedAssignmentVersion: positiveVersion,
    artifact: storyWorkArtifactSchema,
    resolution: storyCheckFindingResolutionSchema
  })
  .strict();

export const completeCheckStoryWorkReviewRequestSchema = openStoryWorkReviewRequestSchema;

export const editCharacterStoryWorkReviewRequestSchema = z
  .object({
    expectedAssignmentVersion: positiveVersion,
    artifact: storyWorkArtifactSchema,
    payload: characterCreateV2RequestSchema
  })
  .strict();

export const sceneDraftV1RequestSchema = z
  .object({
    schemaId: z.literal("scene-draft-v1"),
    prose: exactWriterText(SCENE_DRAFT_V1_MAX_PROSE_CHARS),
    sourceSceneIds: z
      .array(id)
      .max(SCENE_DRAFT_V1_MAX_SOURCE_SCENES)
      .refine((sceneIds) => new Set(sceneIds).size === sceneIds.length, {
        message: "Scene source IDs must be unique."
      })
  })
  .strict();

export const editSceneStoryWorkReviewRequestSchema = z
  .object({
    expectedAssignmentVersion: positiveVersion,
    artifact: storyWorkArtifactSchema,
    payload: sceneDraftV1RequestSchema
  })
  .strict();

export const storyStructureProposalV1RequestSchema = z
  .unknown()
  .superRefine((value, context) => {
    try {
      const proposal = validateStoryStructureProposalV1(value);
      if (proposal.schemaId !== STORY_STRUCTURE_SCHEMA_ID) {
        context.addIssue({
          code: "custom",
          message: "Structure review edits must use story-structure-proposal-v1."
        });
      }
    } catch (error) {
      context.addIssue({
        code: "custom",
        message:
          error instanceof Error ? error.message : "Structure proposal payload is invalid."
      });
    }
  });

export const editStructureStoryWorkReviewRequestSchema = z
  .object({
    expectedAssignmentVersion: positiveVersion,
    artifact: storyWorkArtifactSchema,
    payload: storyStructureProposalV1RequestSchema
  })
  .strict();

export const applyCharacterStoryWorkRequestSchema = z
  .object({
    expectedAssignmentVersion: positiveVersion,
    proposalId: id,
    expectedArtifactVersion: positiveVersion,
    expectedProposalContentHash: contentHash,
    expectedProjectVersion: positiveVersion
  })
  .strict();

const canvasCoordinate = z
  .number()
  .finite()
  .min(-CANVAS_MAX_COORDINATE)
  .max(CANVAS_MAX_COORDINATE);
const canvasDimension = z.number().finite().min(1).max(CANVAS_MAX_DIMENSION);
const canvasZ = z
  .number()
  .finite()
  .min(-CANVAS_MAX_COORDINATE)
  .max(CANVAS_MAX_COORDINATE);

const canvasScopeFields = {
  scopeKind: z.enum(["project", "chapter", "scene"]),
  scopeId: z.string().trim().min(1).max(200).optional()
} as const;

function refineCanvasScope(
  value: Readonly<{ scopeKind: "project" | "chapter" | "scene"; scopeId?: string }>,
  context: z.RefinementCtx
): void {
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
}

const sceneApplyCanvasScopeRefSchema = z
  .object(canvasScopeFields)
  .strict()
  .superRefine(refineCanvasScope);

const sceneApplyCanvasPlacementSchema = z
  .object({
    expectedCanvasVersion: positiveVersion,
    scope: sceneApplyCanvasScopeRefSchema,
    x: canvasCoordinate,
    y: canvasCoordinate,
    width: canvasDimension,
    height: canvasDimension,
    z: canvasZ,
    parentRegionId: id.optional(),
    storyOrderHint: z
      .number()
      .int()
      .nonnegative()
      .max(CANVAS_MAX_COORDINATE)
      .optional()
  })
  .strict();

const sceneApplyManuscriptPlacementSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("chapter"),
      bookId: id,
      chapterId: id,
      position: z.number().int().nonnegative().optional()
    })
    .strict(),
  z
    .object({
      kind: z.literal("unassigned"),
      bookId: id,
      position: z.number().int().nonnegative().optional()
    })
    .strict()
]);

const applySceneStoryWorkArtifactBaseSchema = z
  .object({
    expectedAssignmentVersion: positiveVersion,
    proposalId: id,
    expectedArtifactVersion: positiveVersion,
    expectedProposalContentHash: contentHash,
    idempotencyKey: id
  })
  .strict();

const applyCreateSceneStoryWorkRequestSchema =
  applySceneStoryWorkArtifactBaseSchema
    .extend({
      mode: z.literal("create-scene"),
      expectedProjectVersion: positiveVersion,
      title: exactWriterText(200),
      manuscriptPlacement: sceneApplyManuscriptPlacementSchema,
      canvas: sceneApplyCanvasPlacementSchema.optional()
    })
    .strict();

const applyExistingSceneStoryWorkBaseSchema = applySceneStoryWorkArtifactBaseSchema
  .extend({
    expectedSceneWorkingVersion: positiveVersion,
    expectedSceneContentHash: contentHash
  })
  .strict();

const applyNamedVariantSceneStoryWorkRequestSchema =
  applyExistingSceneStoryWorkBaseSchema
    .extend({
      mode: z.literal("named-variant"),
      variantName: exactWriterText(SCENE_VARIANT_NAME_MAX_LENGTH)
    })
    .strict();

const applyRevisionSceneStoryWorkRequestSchema =
  applyExistingSceneStoryWorkBaseSchema
    .extend({
      mode: z.literal("apply-revision")
    })
    .strict();

export const applySceneStoryWorkRequestSchema = z.discriminatedUnion("mode", [
  applyCreateSceneStoryWorkRequestSchema,
  applyNamedVariantSceneStoryWorkRequestSchema,
  applyRevisionSceneStoryWorkRequestSchema
]);

const structureOperationId = z.string().trim().min(1).max(200);

export const previewStructureStoryWorkRequestSchema = z
  .object({
    expectedAssignmentVersion: positiveVersion,
    expectedProjectVersion: positiveVersion,
    artifact: storyWorkArtifactSchema,
    selectedOperationIds: z
      .array(structureOperationId)
      .min(1)
      .max(STORY_STRUCTURE_MAX_OPERATIONS)
      .refine((ids) => new Set(ids).size === ids.length, {
        message: "Selected operation IDs must be unique."
      })
  })
  .strict();

const structureApplyCanvasPlacementSchema = z
  .object({
    expectedCanvasVersion: positiveVersion,
    sceneId: id,
    scope: sceneApplyCanvasScopeRefSchema,
    x: canvasCoordinate,
    y: canvasCoordinate,
    width: canvasDimension,
    height: canvasDimension,
    z: canvasZ,
    parentRegionId: id.optional(),
    storyOrderHint: z
      .number()
      .int()
      .nonnegative()
      .max(CANVAS_MAX_COORDINATE)
      .optional()
  })
  .strict();

export const applyStructureStoryWorkRequestSchema = z
  .object({
    expectedAssignmentVersion: positiveVersion,
    proposalId: id,
    expectedArtifactVersion: positiveVersion,
    expectedProposalContentHash: contentHash,
    expectedProjectVersion: positiveVersion,
    selectedOperationIds: z
      .array(structureOperationId)
      .min(1)
      .max(STORY_STRUCTURE_MAX_OPERATIONS)
      .refine((ids) => new Set(ids).size === ids.length, {
        message: "Selected operation IDs must be unique."
      }),
    idempotencyKey: id,
    canvas: structureApplyCanvasPlacementSchema.optional()
  })
  .strict();

export const storyWorkAssignmentListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).optional(),
    status: z
      .enum([
        "brief-ready",
        "running",
        "artifact-ready",
        "awaiting-review",
        "failed",
        "canceled",
        "stale",
        "rejected",
        "applied",
        "reviewed"
      ])
      .optional()
  })
  .strict();

export type SubmitCharacterStoryWorkRequest = z.infer<
  typeof submitCharacterStoryWorkRequestSchema
>;
export type SubmitSceneStoryWorkRequest = z.infer<
  typeof submitSceneStoryWorkRequestSchema
>;
export type SubmitSceneRevisionStoryWorkRequest = z.infer<
  typeof submitSceneRevisionStoryWorkRequestSchema
>;
export type SubmitAppliedSceneCheckStoryWorkRequest = z.infer<
  typeof submitAppliedSceneCheckStoryWorkRequestSchema
>;
export type SubmitProposalDraftCheckStoryWorkRequest = z.infer<
  typeof submitProposalDraftCheckStoryWorkRequestSchema
>;
export type SubmitCheckStoryWorkRequest = z.infer<typeof submitCheckStoryWorkRequestSchema>;
export type SubmitStoryWorkRequest = z.infer<typeof submitStoryWorkRequestSchema>;
export type ResolveCheckStoryWorkFindingRequest = z.infer<
  typeof resolveCheckStoryWorkFindingRequestSchema
>;
export type CompleteCheckStoryWorkReviewRequest = z.infer<
  typeof completeCheckStoryWorkReviewRequestSchema
>;
export type GenerateCharacterStoryWorkRequest = z.infer<
  typeof generateCharacterStoryWorkRequestSchema
>;
export type GenerateStoryWorkRequest = z.infer<typeof generateStoryWorkRequestSchema>;
export type EditCharacterStoryWorkReviewRequest = z.infer<
  typeof editCharacterStoryWorkReviewRequestSchema
>;
export type EditSceneStoryWorkReviewRequest = z.infer<
  typeof editSceneStoryWorkReviewRequestSchema
>;
export type ApplyCharacterStoryWorkRequest = z.infer<
  typeof applyCharacterStoryWorkRequestSchema
>;
export type ApplySceneStoryWorkRequest = z.infer<
  typeof applySceneStoryWorkRequestSchema
>;
export type SubmitOutlineStoryWorkRequest = z.infer<
  typeof submitOutlineStoryWorkRequestSchema
>;
export type PreviewStructureStoryWorkRequest = z.infer<
  typeof previewStructureStoryWorkRequestSchema
>;
export type EditStructureStoryWorkReviewRequest = z.infer<
  typeof editStructureStoryWorkReviewRequestSchema
>;
export type ApplyStructureStoryWorkRequest = z.infer<
  typeof applyStructureStoryWorkRequestSchema
>;
