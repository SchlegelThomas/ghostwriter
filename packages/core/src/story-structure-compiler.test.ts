import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { instructionContentHash, type AsyncHashPort } from "./agent-domain.js";
import {
  STORY_STRUCTURE_CANDIDATES_SCHEMA_ID,
  STORY_STRUCTURE_SCHEMA_ID,
  storyStructureLoweringContextFromBook
} from "./story-structure-proposal-v1.js";
import {
  bookId,
  contextReceiptId,
  createManuscriptStructure,
  defineProjectRecords,
  projectId
} from "./domain.js";
import { createStoryWorkAssignment, storyWorkAssignmentId } from "./story-work-assignment.js";
import { accountId } from "./identity.js";
import { createStoryWorkAttempt } from "./story-work-attempt.js";
import { assembleStoryStructureResource } from "./story-context-receipt.js";
import type { StoryContextProjection } from "./story-context.js";
import {
  compileStoryStructure,
  completeStoryStructure,
  STORY_STRUCTURE_CONTRACT_VERSION,
  type CompiledStoryStructure
} from "./story-structure-compiler.js";
import type { AgentModelId } from "./agent-context-receipt.js";
import { agentRunId } from "./domain.js";
const hashPort: AsyncHashPort = Object.freeze({
  async digestSha256Hex(value: string) {
    return createHash("sha256").update(value).digest("hex");
  }
});

const PROJECT = projectId("project-structure-compiler");
const OWNER = accountId("account-structure-compiler");
const BOOK = bookId("book-structure-compiler");
const NOW = "2026-09-13T21:00:00.000Z";

const projectRecords = defineProjectRecords({
  project: {
    id: PROJECT,
    title: "Structure compiler",
    bookIds: [BOOK],
    version: 9,
    createdAt: NOW
  },
  books: [
    {
      id: BOOK,
      projectId: PROJECT,
      title: "Novel",
      status: "drafting",
      manuscript: createManuscriptStructure({ parts: [], unassignedSceneIds: [] }),
      createdAt: NOW
    }
  ],
  scenes: [],
  storyKnowledge: [],
  editions: []
});

const storyContext: StoryContextProjection = Object.freeze({
  projectId: PROJECT,
  projectVersion: 9,
  scope: Object.freeze({ kind: "project" as const }),
  totalCanonicalSceneCount: 0,
  scenes: Object.freeze([]),
  threads: Object.freeze([])
});

const assignment = createStoryWorkAssignment({
  id: storyWorkAssignmentId("assignment-structure-compiler"),
  projectId: PROJECT,
  initiatorAccountId: OWNER,
  version: 1,
  taskKind: "outline",
  brief: "Develop a three-chapter outline for the active book.",
  constraints: "Respect existing canon.",
  doneWhen: "Structure is ready for writer review.",
  sources: [{ kind: "book", bookId: BOOK, projectVersion: 9 }],
  destination: { kind: "book", bookId: BOOK, operation: "update" },
  provider: "openai",
  model: "gpt-4.1" as AgentModelId,
  status: "running",
  activeAttemptId: agentRunId("agentRun-structure-compiler-1"),
  steps: [{ id: "structure", title: "Propose structure", dependencies: [] }],
  results: [],
  idempotencyKey: "submit-structure-compiler",
  createdAt: NOW,
  updatedAt: NOW
});

const attempt = createStoryWorkAttempt({
  assignmentId: assignment.id,
  projectId: PROJECT,
  initiatorAccountId: OWNER,
  runId: agentRunId("agentRun-structure-compiler-1"),
  version: 1,
  kind: "initial",
  sourceMode: "submitted-snapshot",
  instruction: assignment.brief,
  idempotencyKey: "attempt-structure-compiler",
  requestFingerprint: instructionContentHash("a".repeat(64)),
  createdAt: NOW
});

async function compileFixture(): Promise<CompiledStoryStructure> {
  const structure = await assembleStoryStructureResource({
    projectId: PROJECT,
    context: storyContext,
    inclusionReason: "selected-structure",
    hashPort
  });
  const book = projectRecords.books[0]!;
  const loweringContext = storyStructureLoweringContextFromBook(PROJECT, book, []);
  return compileStoryStructure({
    receiptId: contextReceiptId("receipt-structure-compiler"),
    createdAt: NOW,
    assignment,
    attempt,
    projectRecords,
    storyContext,
    resources: Object.freeze([structure]),
    trustedLoweringContext: loweringContext,
    hashPort
  });
}

describe("story-structure-compiler", () => {
  it("layers policy, workflow, brief, allowlist, and exact receipt metadata without prose or canvas fields", async () => {
    const compiled = await compileFixture();
    expect(compiled.workflow).toBe("story-work.structure");
    expect(compiled.receipt).toMatchObject({
      workflowId: "story-work.structure",
      workflowVersion: STORY_STRUCTURE_CONTRACT_VERSION,
      outputSchemaId: STORY_STRUCTURE_SCHEMA_ID,
      primaryTarget: { kind: "book", id: BOOK },
      maxOutputTokens: 8_000,
      wallClockSeconds: 90,
      toolCount: 0
    });
    expect(compiled.receipt.excludedContextClasses).toContain("canvas");
    expect(compiled.instructions).toContain("story-structure-proposal-candidates-v1");
    expect(compiled.outputSchema.schema).not.toHaveProperty("canvas");
    expect(compiled.inputText).toContain(assignment.brief);
    expect(compiled.inputText).toContain(assignment.constraints);
    expect(compiled.inputText).toContain(assignment.doneWhen);
    expect(compiled.inputText).toContain("TRUSTED EXISTING REFERENCE ALLOWLIST");
    expect(compiled.outputSchema.name).toBe("story_structure_proposal_candidates_v1");
    expect(compiled.outputSchema.schema).toMatchObject({
      properties: expect.objectContaining({
        schemaId: expect.objectContaining({ const: STORY_STRUCTURE_CANDIDATES_SCHEMA_ID })
      })
    });
    expect(JSON.stringify(compiled.outputSchema.schema)).not.toContain("canvas");
    expect(JSON.stringify(compiled.outputSchema.schema)).not.toContain("prose");
  });

  it("validates provider candidates only and rejects authority injection", async () => {
    const compiled = await compileFixture();
    const candidate = {
      schemaId: STORY_STRUCTURE_CANDIDATES_SCHEMA_ID,
      newParts: [{ localKey: "part-a", title: "Act One" }],
      newChapters: [],
      newPlannedScenes: [],
      existingChapterUpdates: [],
      chapterReorders: [],
      existingSceneMoves: [],
      existingSceneArchiveChanges: [],
      existingSceneIntentUpdates: []
    };
    const ready = await completeStoryStructure({
      compiled,
      provider: {
        async completeStructured() {
          return { ok: true as const, output: candidate };
        }
      }
    });
    expect(ready.kind).toBe("ready");

    const failed = await completeStoryStructure({
      compiled,
      provider: {
        async completeStructured() {
          return {
            ok: true as const,
            output: { ...candidate, bookId: BOOK }
          };
        }
      }
    });
    expect(failed).toMatchObject({
      kind: "failed",
      diagnostic: { code: "validation_failed" }
    });
  });
});
