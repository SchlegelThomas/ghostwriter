import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  accountId,
  agentProposalId,
  assembleProposalArtifactContextResource,
  assembleStorySceneResource,
  assembleStoryStructureResource,
  bookId,
  chapterId,
  computeAgentProposalContentHash,
  characterStoryWorkAttemptRequestFingerprint,
  createAgentGuidanceServices,
  createMemoryAccountAiCollaborationProfileRepository,
  createMemoryProjectAgentInstructionsRepository,
  createMemoryProjectPlaybookRepository,
  createProjectMembership,
  createSceneDocumentStateWithProse,
  createStoryCheckGenerationServices,
  createStoryWorkAssignment,
  defineProjectRecords,
  instructionContentHash,
  projectId,
  sceneId,
  sceneStoryWorkAttemptRequestFingerprint,
  storyContextFromProjectRecords,
  storyWorkAssignmentId,
  StoryWorkAssignmentNotFoundError,
  STORY_CHECK_CANDIDATES_SCHEMA_ID,
  validateAgentProposalPayload,
  type DomainIdKind
} from "@ghostwriter/core";
import { toRepositoryDatabase } from "./client.js";
import { createPgliteDatabase, migratePgliteRepositoryDatabase } from "./pglite.js";
import {
  createPostgresAgentProposalRepository,
  createPostgresAgentRunRepository,
  createPostgresContextReceiptRepository
} from "./postgres-agent-foundation-repository.js";
import { createPostgresSceneDocumentRepository } from "./postgres-scene-document-repository.js";
import { createPostgresStoryCheckGenerationUnitOfWork } from "./postgres-story-check-generation-uow.js";
import { createPostgresProjectRepository } from "./postgres-project-repository.js";
import {
  createPostgresStoryWorkAssignmentRepository,
  createPostgresStoryWorkAttemptRepository
} from "./postgres-story-work-repository.js";
import { seedProject } from "./seed.js";
import { user } from "./schema.js";

const PROJECT = projectId("project-check-generation-postgres");
const OWNER = accountId("account-check-generation-postgres");
const STRANGER = accountId("account-check-generation-postgres-stranger");
const ASSIGNMENT_APPLIED = storyWorkAssignmentId("assignment-check-generation-postgres-applied");
const ASSIGNMENT_PROPOSAL = storyWorkAssignmentId("assignment-check-generation-postgres-proposal");
const TARGET = sceneId("scene-check-generation-postgres-target");
const CONTEXT = sceneId("scene-check-generation-postgres-context");
const DRAFT_ASSIGNMENT = storyWorkAssignmentId("assignment-check-generation-postgres-draft");
const PROPOSAL_ID = agentProposalId("proposal-check-generation-postgres-draft");
const CREATED_AT = "2026-09-13T20:00:00.000Z";
const hashPort = Object.freeze({
  async digestSha256Hex(value: string) {
    return createHash("sha256").update(value).digest("hex");
  }
});
const targetProse = "Mara burned the letter on the dock.";
const contextProse = "Theo watched the harbor fog roll in.";
const draftProse = "  Draft harbor prose for review.  ";
const draftPayload = Object.freeze({
  schemaId: "scene-draft-v1" as const,
  prose: draftProse,
  sourceSceneIds: Object.freeze([CONTEXT])
});
const contradictionCandidates = Object.freeze({
  schemaId: STORY_CHECK_CANDIDATES_SCHEMA_ID,
  findings: Object.freeze([
    Object.freeze({
      kind: "contradiction" as const,
      severity: "blocking" as const,
      claim: "The letter was already destroyed.",
      anchors: Object.freeze([Object.freeze({ sceneId: TARGET, quote: "burned the letter" })])
    })
  ])
});
const CHECK_PROJECT = defineProjectRecords({
  project: {
    id: PROJECT,
    title: "Check generation postgres",
    bookIds: [bookId("book-check-generation-postgres")],
    version: 5,
    createdAt: CREATED_AT
  },
  books: [
    {
      id: bookId("book-check-generation-postgres"),
      projectId: PROJECT,
      title: "Book",
      status: "drafting",
      manuscript: {
        parts: [],
        unassignedSceneIds: [TARGET, CONTEXT]
      },
      createdAt: CREATED_AT
    }
  ],
  scenes: [
    {
      id: TARGET,
      projectId: PROJECT,
      bookId: bookId("book-check-generation-postgres"),
      title: "Target",
      status: "drafting",
      summary: "Hide the letter.",
      sketch: { turn: "Mara burns it." }
    },
    {
      id: CONTEXT,
      projectId: PROJECT,
      bookId: bookId("book-check-generation-postgres"),
      title: "Context",
      status: "drafting"
    }
  ],
  storyKnowledge: [],
  editions: []
});
const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (closers.length > 0) await closers.pop()?.();
});

async function fullProposalArtifactContentHash() {
  const payload = validateAgentProposalPayload("scene-draft-v1", draftPayload);
  return computeAgentProposalContentHash(
    {
      outputSchemaId: "scene-draft-v1",
      payload,
      primaryTarget: Object.freeze({ kind: "scene", id: TARGET })
    },
    hashPort
  );
}

async function createHarness(mode: "applied" | "proposal") {
  const { db, client, close } = createPgliteDatabase();
  closers.push(close);
  await migratePgliteRepositoryDatabase(db);
  await db.insert(user).values({
    id: OWNER,
    name: "Check Generation Owner",
    email: "check-generation-postgres@example.test",
    emailVerified: true
  });
  const exec = toRepositoryDatabase(db);
  const projects = createPostgresProjectRepository(exec);
  await seedProject(projects, CHECK_PROJECT);
  await projects.transaction((writer) => {
    writer.insertProjectMembership(
      createProjectMembership({
        projectId: PROJECT,
        accountId: OWNER,
        role: "owner",
        createdAt: CREATED_AT
      })
    );
  });

  const sceneDocuments = createPostgresSceneDocumentRepository(exec);
  const targetState = await createSceneDocumentStateWithProse({
    projectId: PROJECT,
    sceneId: TARGET,
    actorAccountId: OWNER,
    ids: { create: (kind) => `${kind}-check-generation-postgres-target` },
    now: CREATED_AT,
    prose: targetProse
  });
  await sceneDocuments.initialize(targetState);
  const contextState = await createSceneDocumentStateWithProse({
    projectId: PROJECT,
    sceneId: CONTEXT,
    actorAccountId: OWNER,
    ids: { create: (kind) => `${kind}-check-generation-postgres-context` },
    now: CREATED_AT,
    prose: contextProse
  });
  await sceneDocuments.initialize(contextState);
  const targetHead = targetState.head;
  const contextHead = contextState.head;
  const proposalArtifactContentHash =
    mode === "proposal" ? await fullProposalArtifactContentHash() : undefined;

  const assignments = createPostgresStoryWorkAssignmentRepository(exec);
  const assignment =
    mode === "applied"
      ? createStoryWorkAssignment({
          id: ASSIGNMENT_APPLIED,
          projectId: PROJECT,
          initiatorAccountId: OWNER,
          version: 1,
          taskKind: "check",
          brief: "  Check continuity for the harbor scene.  ",
          constraints: "  Use only supplied context.  ",
          doneWhen: "  Findings are ready for review.  ",
          sources: [
            { kind: "project", projectId: PROJECT, projectVersion: 5 },
            {
              kind: "scene",
              sceneId: TARGET,
              projectVersion: 5,
              workingVersion: targetHead.workingVersion,
              contentHash: targetHead.contentHash
            },
            {
              kind: "scene",
              sceneId: CONTEXT,
              projectVersion: 5,
              workingVersion: contextHead.workingVersion,
              contentHash: contextHead.contentHash
            }
          ],
          destination: { kind: "scene", sceneId: TARGET, operation: "assess" },
          provider: "openai",
          model: "gpt-4.1",
          status: "brief-ready",
          steps: [{ id: "check", title: "Run continuity check", dependencies: [] }],
          results: [],
          idempotencyKey: "submit-check-generation-postgres-applied",
          createdAt: CREATED_AT,
          updatedAt: CREATED_AT
        })
      : createStoryWorkAssignment({
          id: ASSIGNMENT_PROPOSAL,
          projectId: PROJECT,
          initiatorAccountId: OWNER,
          version: 1,
          taskKind: "check",
          brief: "  Check continuity for the draft scene.  ",
          constraints: "  Use only supplied context.  ",
          doneWhen: "  Findings are ready for review.  ",
          sources: [
            { kind: "book", bookId: bookId("book-check-generation-postgres"), projectVersion: 5 },
            {
              kind: "proposal-artifact",
              assignmentId: DRAFT_ASSIGNMENT,
              proposalId: PROPOSAL_ID,
              sceneId: TARGET,
              artifactVersion: 2,
              contentHash: proposalArtifactContentHash!
            },
            {
              kind: "scene",
              sceneId: CONTEXT,
              projectVersion: 5,
              workingVersion: contextHead.workingVersion,
              contentHash: contextHead.contentHash
            }
          ],
          destination: { kind: "scene", sceneId: TARGET, operation: "assess" },
          provider: "openai",
          model: "gpt-4.1",
          status: "brief-ready",
          steps: [{ id: "check", title: "Run continuity check", dependencies: [] }],
          results: [],
          idempotencyKey: "submit-check-generation-postgres-proposal",
          createdAt: CREATED_AT,
          updatedAt: CREATED_AT
        });
  expect(
    await assignments.create({
      assignment,
      requestFingerprint: instructionContentHash("c".repeat(64))
    })
  ).toMatchObject({ ok: true });

  let id = 0;
  const ids = {
    create(kind: DomainIdKind) {
      id += 1;
      return `${kind}-check-generation-postgres-${id}`;
    }
  };
  let tick = 0;
  const clock = {
    now() {
      tick += 1;
      return `2026-09-13T20:00:${String(tick).padStart(2, "0")}.000Z`;
    }
  };
  const guidance = createAgentGuidanceServices({
    projects,
    collaborationProfiles: createMemoryAccountAiCollaborationProfileRepository(),
    projectInstructions: createMemoryProjectAgentInstructionsRepository(),
    playbooks: createMemoryProjectPlaybookRepository(),
    hashPort,
    ids,
    clock
  });
  const proposals = createPostgresAgentProposalRepository(exec);
  const runs = createPostgresAgentRunRepository(exec);
  const attempts = createPostgresStoryWorkAttemptRepository(exec);
  const receipts = createPostgresContextReceiptRepository(exec);
  const services = createStoryCheckGenerationServices({
    projects,
    assignments,
    proposals,
    guidance,
    generation: createPostgresStoryCheckGenerationUnitOfWork(exec),
    hashPort,
    ids,
    clock
  });
  const storyContext = storyContextFromProjectRecords(CHECK_PROJECT, {
    scope: { kind: "project" }
  });
  const structure = await assembleStoryStructureResource({
    projectId: PROJECT,
    context: storyContext,
    inclusionReason: "selected-structure",
    hashPort
  });
  const contextResource = await assembleStorySceneResource({
    projectId: PROJECT,
    sceneId: CONTEXT,
    head: contextHead,
    inclusionReason: "surrounding-context",
    hashPort
  });
  const appliedTargetResource = await assembleStorySceneResource({
    projectId: PROJECT,
    sceneId: TARGET,
    head: targetHead,
    inclusionReason: "assess-target",
    hashPort
  });
  const proposalResource =
    proposalArtifactContentHash === undefined
      ? undefined
      : await assembleProposalArtifactContextResource({
          projectId: PROJECT,
          assignmentId: DRAFT_ASSIGNMENT,
          proposalId: PROPOSAL_ID,
          sceneId: TARGET,
          artifactVersion: 2,
          contentHash: proposalArtifactContentHash,
          draft: draftPayload,
          providerText: draftProse,
          fullTextCharCount: draftProse.length,
          truncated: false,
          inclusionReason: "assess-proposal-target",
          hashPort
        });
  const request =
    mode === "applied"
      ? {
          accountId: OWNER,
          projectId: PROJECT,
          assignmentId: assignment.id,
          expectedAssignmentVersion: assignment.version,
          kind: "initial" as const,
          sourceMode: "submitted-snapshot" as const,
          instruction: assignment.brief,
          idempotencyKey: "attempt-check-generation-postgres-applied",
          storyContext,
          target: Object.freeze({ mode: "applied-scene" as const, head: targetHead }),
          resources: Object.freeze([appliedTargetResource, contextResource, structure]),
          targetSceneIntent: Object.freeze({
            id: TARGET,
            summary: "Hide the letter.",
            sketch: Object.freeze({ turn: "Mara burns it." })
          }),
          chapterObjective: Object.freeze({
            id: chapterId("chapter-check-generation-postgres"),
            summary: "Chapter objective"
          })
        }
      : {
          accountId: OWNER,
          projectId: PROJECT,
          assignmentId: assignment.id,
          expectedAssignmentVersion: assignment.version,
          kind: "initial" as const,
          sourceMode: "submitted-snapshot" as const,
          instruction: assignment.brief,
          idempotencyKey: "attempt-check-generation-postgres-proposal",
          storyContext,
          target: Object.freeze({
            mode: "proposal-draft" as const,
            draft: draftPayload,
            providerText: draftProse,
            fullTextCharCount: draftProse.length,
            truncated: false,
            artifactContentHash: proposalArtifactContentHash!,
            coverageSceneHead: Object.freeze({
              workingVersion: targetHead.workingVersion,
              contentHash: targetHead.contentHash
            })
          }),
          resources: Object.freeze([proposalResource!, contextResource, structure])
        };
  return {
    client,
    assignments,
    attempts,
    receipts,
    runs,
    proposals,
    services,
    assignment,
    request
  };
}

async function createFailureTrigger(
  client: Awaited<ReturnType<typeof createHarness>>["client"],
  name: string,
  table: "agent_runs" | "story_work_assignments",
  condition: string
) {
  await client.exec(`
    create function ${name}() returns trigger as $$
    begin
      if ${condition} then raise exception 'injected generation persistence failure'; end if;
      return new;
    end;
    $$ language plpgsql;
    create trigger ${name}_trigger before update on ${table}
    for each row execute function ${name}();
  `);
}

function successProvider(output: unknown = contradictionCandidates) {
  return {
    async completeStructured() {
      return { ok: true as const, output, providerResponseId: "provider-check-generation-postgres" };
    }
  };
}

describe("postgres story check generation unit of work", () => {
  it("persists applied-scene begin and completion atomically, then replays without provider spend", async () => {
    const harness = await createHarness("applied");
    let calls = 0;
    const provider = {
      async completeStructured() {
        calls += 1;
        return {
          ok: true as const,
          output: contradictionCandidates,
          providerResponseId: "provider-check-generation-postgres"
        };
      }
    };
    const first = await harness.services.generate({ ...harness.request, provider });
    expect(first).toMatchObject({
      kind: "ready",
      state: {
        assignment: { status: "artifact-ready", version: 3 },
        run: { workflowId: "story-work.check-continuity", status: "ready" },
        proposal: {
          outputSchemaId: "story-check-findings-v1",
          primaryTarget: { kind: "scene", id: TARGET }
        }
      }
    });
    const replay = await harness.services.generate({ ...harness.request, provider });
    expect(replay).toMatchObject({ kind: "replayed", state: { replayed: true } });
    expect(calls).toBe(1);
  });

  it("persists proposal-artifact receipts and roundtrips them through replay", async () => {
    const harness = await createHarness("proposal");
    const proposalCandidates = Object.freeze({
      schemaId: STORY_CHECK_CANDIDATES_SCHEMA_ID,
      findings: Object.freeze([
        Object.freeze({
          kind: "contradiction" as const,
          severity: "important" as const,
          claim: "Draft tone drifts from surrounding context.",
          anchors: Object.freeze([
            Object.freeze({ sceneId: TARGET, quote: "Draft harbor prose" })
          ])
        })
      ])
    });
    const result = await harness.services.generate({
      ...harness.request,
      provider: successProvider(proposalCandidates)
    });
    expect(result).toMatchObject({
      kind: "ready",
      state: { proposal: { outputSchemaId: "story-check-findings-v1" } }
    });
    const stored = await harness.receipts.listByProject(PROJECT);
    expect(stored).toHaveLength(1);
    const proposalArtifact = stored[0]!.resources.find(
      (resource) => resource.resourceClass === "proposal-artifact"
    );
    expect(proposalArtifact).toMatchObject({
      resourceClass: "proposal-artifact",
      assignmentId: DRAFT_ASSIGNMENT,
      proposalId: PROPOSAL_ID,
      sceneId: TARGET,
      artifactVersion: 2
    });
    const replay = await harness.services.generate({
      ...harness.request,
      provider: successProvider(proposalCandidates)
    });
    expect(replay).toMatchObject({ kind: "replayed", state: { replayed: true } });
    expect(await harness.receipts.listByProject(PROJECT)).toHaveLength(1);
  });

  it("serializes concurrent begins so only one provider call runs", async () => {
    const harness = await createHarness("applied");
    let calls = 0;
    const provider = {
      async completeStructured() {
        calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 25));
        return {
          ok: true as const,
          output: contradictionCandidates,
          providerResponseId: "provider-check-generation-postgres-concurrent"
        };
      }
    };
    const attempts = await Promise.allSettled([
      harness.services.generate({ ...harness.request, provider }),
      harness.services.generate({ ...harness.request, provider })
    ]);
    const fulfilled = attempts.filter((attempt) => attempt.status === "fulfilled");
    expect(fulfilled).toHaveLength(2);
    expect(calls).toBe(1);
    const kinds = fulfilled.map(
      (attempt) => (attempt as PromiseFulfilledResult<{ kind: string }>).value.kind
    );
    expect(kinds).toContain("ready");
    expect(kinds).toContain("replayed");
  });

  it("records malformed provider output as a terminal failure without proposals", async () => {
    const harness = await createHarness("applied");
    const result = await harness.services.generate({
      ...harness.request,
      provider: {
        async completeStructured() {
          return {
            ok: false as const,
            diagnostic: { code: "invalid_structured_output" as const, retryable: false }
          };
        }
      }
    });
    expect(result).toMatchObject({
      kind: "failed",
      state: {
        run: { status: "failed", terminalDiagnosticCode: "provider-malformed-output" },
        assignment: { status: "failed", version: 3 }
      }
    });
    await expect(harness.proposals.listByProject(PROJECT)).resolves.toEqual([]);
  });

  it("rolls back proposal completion when assignment completion fails", async () => {
    const harness = await createHarness("applied");
    await createFailureTrigger(
      harness.client,
      "reject_check_generation_completion",
      "story_work_assignments",
      "new.status = 'artifact-ready'"
    );
    await expect(
      harness.services.generate({ ...harness.request, provider: successProvider() })
    ).rejects.toBeDefined();
    await expect(harness.proposals.listByProject(PROJECT)).resolves.toEqual([]);
    await expect(harness.runs.listByProject(PROJECT)).resolves.toMatchObject([
      { status: "running" }
    ]);
    await expect(
      harness.attempts.listByAssignment({
        accountId: OWNER,
        projectId: PROJECT,
        assignmentId: ASSIGNMENT_APPLIED
      })
    ).resolves.toMatchObject([{ version: 1 }]);
  });

  it("refuses foreign assignments before provider work", async () => {
    const harness = await createHarness("applied");
    let calls = 0;
    await expect(
      harness.services.generate({
        ...harness.request,
        accountId: STRANGER,
        provider: {
          async completeStructured() {
            calls += 1;
            return { ok: true as const, output: contradictionCandidates };
          }
        }
      })
    ).rejects.toBeInstanceOf(StoryWorkAssignmentNotFoundError);
    expect(calls).toBe(0);
  });
});

describe("story work generation regression", () => {
  it("still fingerprints scene and character generation requests independently", async () => {
    const sceneFingerprint = await sceneStoryWorkAttemptRequestFingerprint(
      {
        accountId: OWNER,
        projectId: PROJECT,
        assignmentId: ASSIGNMENT_APPLIED,
        kind: "initial",
        sourceMode: "submitted-snapshot",
        instruction: "scene"
      },
      hashPort
    );
    const characterFingerprint = await characterStoryWorkAttemptRequestFingerprint(
      {
        accountId: OWNER,
        projectId: PROJECT,
        assignmentId: ASSIGNMENT_APPLIED,
        kind: "initial",
        sourceMode: "submitted-snapshot",
        instruction: "character"
      },
      hashPort
    );
    expect(sceneFingerprint).not.toEqual(characterFingerprint);
  });
});
