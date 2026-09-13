import { afterEach, describe, expect, expectTypeOf, it } from "vitest";
import { createFakeStructuredCompletionProvider } from "@ghostwriter/ai";
import { BELLWETHER_FIXTURE_PROJECT_ID, STORY_STRUCTURE_SCHEMA_ID } from "@ghostwriter/core";
import {
  createSeededBackendApp,
  fakeBackendAuth,
  testBackendClosers,
  TEST_BACKEND_ORIGIN
} from "./test-backend-app.js";
import {
  applyCharacterStoryWorkRequestSchema,
  applySceneStoryWorkRequestSchema,
  editSceneStoryWorkReviewRequestSchema,
  generateCharacterStoryWorkRequestSchema,
  submitAppliedSceneCheckStoryWorkRequestSchema,
  submitCharacterStoryWorkRequestSchema,
  submitCheckStoryWorkRequestSchema,
  submitProposalDraftCheckStoryWorkRequestSchema,
  submitOutlineStoryWorkRequestSchema,
  submitStoryWorkRequestSchema,
  previewStructureStoryWorkRequestSchema,
  applyStructureStoryWorkRequestSchema,
  editStructureStoryWorkReviewRequestSchema
} from "./story-work-api-contract.js";
import type { StoryWorkApiRuntime } from "./story-work-api.js";
import { createTestProviderKekRuntimeConfig } from "./provider-kek-config.js";
import { buildStoryCheckHermeticCandidatesOutput } from "./story-check-hermetic-candidates.js";
import { buildStoryStructureHermeticCandidatesOutput } from "./story-structure-hermetic-candidates.js";

const assignmentPath =
  `/api/projects/${BELLWETHER_FIXTURE_PROJECT_ID}/story-work/assignments`;
const selectedSceneId = "scene-arrival-at-bellwether";
const crossChapterContextSceneId = "scene-future-call";
const signalBookId = "book-signal-at-bellwether";
const lowTideChapterId = "chapter-low-tide";
const canvasPath = `/api/projects/${BELLWETHER_FIXTURE_PROJECT_ID}/canvas`;

function sceneCreateApplyBody(
  assignment: Readonly<{
    version: number;
    currentArtifact: { artifactVersion: number };
  }>,
  proposal: Readonly<{ id: string; contentHash: string }>,
  overrides: Record<string, unknown> = {}
) {
  return {
    expectedAssignmentVersion: assignment.version,
    proposalId: proposal.id,
    expectedArtifactVersion: assignment.currentArtifact.artifactVersion,
    expectedProposalContentHash: proposal.contentHash,
    idempotencyKey: "scene-create-apply-1",
    mode: "create-scene",
    expectedProjectVersion: 1,
    title: "Harbor Choice",
    manuscriptPlacement: {
      kind: "chapter",
      bookId: signalBookId,
      chapterId: lowTideChapterId
    },
    ...overrides
  };
}

function mutation(body: unknown, method = "POST") {
  return {
    method,
    headers: {
      "content-type": "application/json",
      origin: TEST_BACKEND_ORIGIN
    },
    body: JSON.stringify(body)
  };
}

function assignmentRequest(overrides: Record<string, unknown> = {}) {
  return {
    taskKind: "character",
    idempotencyKey: "assignment-request-1",
    expectedProjectVersion: 1,
    brief: "  Keep the exact character brief.  ",
    constraints: "Do not invent a second setting.",
    doneWhen: "The dossier gives the writer a usable pressure point.",
    sceneIds: [],
    model: "gpt-4.1",
    ...overrides
  };
}

function sourceSceneIdsFromPrompt(inputText: string): string[] {
  const marker = "=== SELECTED SOURCE SCENE IDS (exact) ===\n";
  const line = inputText.split(marker)[1]?.split("\n", 1)[0];
  if (line === undefined) return [];
  const parsed: unknown = JSON.parse(line);
  return Array.isArray(parsed) && parsed.every((value) => typeof value === "string")
    ? parsed
    : [];
}

function hermeticCheckCandidateOutput(inputText: string) {
  const output = buildStoryCheckHermeticCandidatesOutput(inputText);
  const anchor = output.findings[0]?.anchors[0];
  const sceneId =
    anchor?.sceneId === "scene-unknown" ? selectedSceneId : (anchor?.sceneId ?? selectedSceneId);
  return {
    schemaId: output.schemaId,
    findings: [
      {
        kind: "contradiction" as const,
        severity: "important" as const,
        claim: "Continuity note anchored to supplied target text.",
        anchors: [
          {
            sceneId,
            ...(anchor?.quote === undefined ? {} : { quote: anchor.quote })
          }
        ]
      }
    ]
  };
}

function outlineAssignmentRequest(overrides: Record<string, unknown> = {}) {
  return {
    taskKind: "outline",
    targetBookId: signalBookId,
    idempotencyKey: "outline-assignment-1",
    expectedProjectVersion: 1,
    brief: "  Develop a three-chapter outline for the active book.  ",
    constraints: "Respect existing canon.",
    doneWhen: "Structure is ready for writer review.",
    sceneIds: [selectedSceneId],
    model: "gpt-4.1",
    ...overrides
  };
}

function hermeticStructureCandidateOutput(inputText: string) {
  return buildStoryStructureHermeticCandidatesOutput(inputText);
}

async function withOutlineHermeticApp() {
  let providerCalls = 0;
  const provider = createFakeStructuredCompletionProvider((input) => {
    providerCalls += 1;
    return { output: hermeticStructureCandidateOutput(input.inputText) };
  });
  const harness = await createSeededBackendApp(undefined, {
    kekConfig: createTestProviderKekRuntimeConfig(),
    openAiCompletionProviderFactory: () => provider
  });
  return { ...harness, provider, providerCalls: () => providerCalls };
}

async function prepareBellwetherSceneHead(app: Awaited<ReturnType<typeof createSeededBackendApp>>["app"]) {
  const scenePath =
    `/api/projects/${BELLWETHER_FIXTURE_PROJECT_ID}/scenes/${selectedSceneId}`;
  expect((await app.request(`${scenePath}/workspace`)).status).toBe(200);
  expect(
    (
      await app.request(`${scenePath}/lease`, {
        method: "POST",
        headers: { origin: TEST_BACKEND_ORIGIN }
      })
    ).status
  ).toBe(200);
}

async function registerOutlineProviderKey(
  app: Awaited<ReturnType<typeof createSeededBackendApp>>["app"]
) {
  expect(
    (
      await app.request(
        "/api/me/provider/openai",
        mutation({ apiKey: "sk-outline-story-work-test-key-123456789" }, "PUT")
      )
    ).status
  ).toBe(200);
}

async function outlineThroughReviewOpen(
  app: Awaited<ReturnType<typeof createSeededBackendApp>>["app"],
  keys: Readonly<{ assignmentKey: string; attemptKey: string }>,
  options: Readonly<{ skipProviderKey?: boolean }> = {}
) {
  await prepareBellwetherSceneHead(app);
  if (!options.skipProviderKey) {
    await registerOutlineProviderKey(app);
  }
  const submitted = await app.request(
    assignmentPath,
    mutation(outlineAssignmentRequest({ idempotencyKey: keys.assignmentKey }))
  );
  expect(submitted.status).toBe(201);
  const submittedBody = await submitted.json();
  const generated = await app.request(
    `${assignmentPath}/${submittedBody.assignment.id}/attempts`,
    mutation({
      expectedAssignmentVersion: 1,
      kind: "initial",
      sourceMode: "submitted-snapshot",
      instruction: outlineAssignmentRequest().brief,
      idempotencyKey: keys.attemptKey
    })
  );
  const generatedBody = await generated.json();
  expect(generated.status, JSON.stringify(generatedBody)).toBe(201);
  const opened = await app.request(
    `${assignmentPath}/${submittedBody.assignment.id}/review/open`,
    mutation({
      expectedAssignmentVersion: generatedBody.state.assignment.version,
      artifact: generatedBody.state.assignment.currentArtifact
    })
  );
  expect(opened.status).toBe(200);
  const openedBody = await opened.json();
  const operationIds = generatedBody.state.proposal.payload.operations.map(
    (operation: { operationId: string }) => operation.operationId
  );
  const plannedScene = generatedBody.state.proposal.payload.operations.find(
    (operation: { type: string }) => operation.type === "scene.createPlanned"
  ) as { sceneId: string; chapterId?: string } | undefined;
  return {
    assignmentId: submittedBody.assignment.id as string,
    submittedBody,
    generatedBody,
    openedBody,
    operationIds,
    plannedScene
  };
}

function checkAssignmentRequest(overrides: Record<string, unknown> = {}) {
  return {
    taskKind: "check",
    specialist: "continuity",
    checkMode: "applied-scene",
    targetSceneId: selectedSceneId,
    idempotencyKey: "check-assignment-1",
    expectedProjectVersion: 1,
    brief: "  Check continuity for the harbor arrival scene.  ",
    constraints: "Use only supplied context.",
    doneWhen: "Findings are ready for review.",
    sceneIds: [],
    model: "gpt-4.1",
    ...overrides
  };
}

function captureDocumentWith(text: string) {
  return {
    schemaVersion: 1,
    document: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { id: "block-story-work-capture" },
          content: [{ type: "text", text }]
        }
      ]
    }
  };
}

afterEach(async () => {
  while (testBackendClosers.length > 0) {
    const close = testBackendClosers.pop();
    if (close !== undefined) await close();
  }
});

describe("story work API contract", () => {
  it("preserves exact writer text and permits an empty manuscript selection", () => {
    const parsed = submitCharacterStoryWorkRequestSchema.parse(assignmentRequest());

    expect(parsed.brief).toBe("  Keep the exact character brief.  ");
    expect(parsed.sceneIds).toEqual([]);
  });

  it("bounds selected sources and enforces attempt artifact shape", () => {
    expect(
      submitCharacterStoryWorkRequestSchema.safeParse(
        assignmentRequest({ sceneIds: Array.from({ length: 33 }, (_, i) => `scene-${i}`) })
      ).success
    ).toBe(false);
    expect(
      generateCharacterStoryWorkRequestSchema.safeParse({
        expectedAssignmentVersion: 1,
        kind: "revision",
        sourceMode: "latest-authorized",
        instruction: "Keep the pressure but change the voice.",
        idempotencyKey: "attempt-request-1"
      }).success
    ).toBe(false);
    expect(
      generateCharacterStoryWorkRequestSchema.safeParse({
        expectedAssignmentVersion: 1,
        kind: "initial",
        sourceMode: "submitted-snapshot",
        instruction: "Draft the submitted brief.",
        priorArtifact: {
          proposalId: "proposal-1",
          artifactVersion: 1,
          contentHash: "a".repeat(64)
        },
        idempotencyKey: "attempt-request-1"
      }).success
    ).toBe(false);
  });

  it("accepts bounded new-scene and revision submissions with strict targets", () => {
    expect(
      submitStoryWorkRequestSchema.safeParse(
        assignmentRequest({
          taskKind: "scene",
          sceneIds: [],
          captureId: "capture-1"
        })
      ).success
    ).toBe(true);
    expect(
      submitStoryWorkRequestSchema.safeParse(
        assignmentRequest({
          taskKind: "revise",
          sceneIds: [],
          targetSceneId: selectedSceneId
        })
      ).success
    ).toBe(true);
    expect(
      submitStoryWorkRequestSchema.safeParse(
        assignmentRequest({ taskKind: "revise", sceneIds: [] })
      ).success
    ).toBe(false);
    expect(
      submitStoryWorkRequestSchema.safeParse(
        assignmentRequest({
          taskKind: "scene",
          targetSceneId: selectedSceneId,
          sceneIds: []
        })
      ).success
    ).toBe(false);
    expect(
      editSceneStoryWorkReviewRequestSchema.safeParse({
        expectedAssignmentVersion: 3,
        artifact: {
          proposalId: "proposal-1",
          artifactVersion: 1,
          contentHash: "a".repeat(64)
        },
        payload: {
          schemaId: "scene-draft-v1",
          prose: "A revised opening.",
          sourceSceneIds: []
        }
      }).success
    ).toBe(true);
  });

  it("strictly validates scene apply modes without caller lease authority", () => {
    const artifact = {
      expectedAssignmentVersion: 3,
      proposalId: "proposal-1",
      expectedArtifactVersion: 1,
      expectedProposalContentHash: "a".repeat(64),
      idempotencyKey: "apply-key-1"
    };
    expect(
      applySceneStoryWorkRequestSchema.safeParse({
        ...artifact,
        mode: "create-scene",
        expectedProjectVersion: 1,
        title: "Harbor Choice",
        manuscriptPlacement: {
          kind: "chapter",
          bookId: signalBookId,
          chapterId: lowTideChapterId
        }
      }).success
    ).toBe(true);
    expect(
      applySceneStoryWorkRequestSchema.safeParse({
        ...artifact,
        mode: "apply-revision",
        expectedSceneWorkingVersion: 2,
        expectedSceneContentHash: "b".repeat(64)
      }).success
    ).toBe(true);
    expect(
      applySceneStoryWorkRequestSchema.safeParse({
        ...artifact,
        mode: "apply-revision",
        expectedSceneWorkingVersion: 2,
        expectedSceneContentHash: "b".repeat(64),
        leaseHolderId: "session-caller"
      }).success
    ).toBe(false);
    expect(
      applySceneStoryWorkRequestSchema.safeParse({
        ...artifact,
        mode: "create-scene",
        expectedProjectVersion: 1,
        title: "Harbor Choice",
        manuscriptPlacement: {
          kind: "chapter",
          bookId: signalBookId,
          chapterId: lowTideChapterId
        },
        accountId: "account-test"
      }).success
    ).toBe(false);
    expect(
      applyCharacterStoryWorkRequestSchema.safeParse({
        expectedAssignmentVersion: 3,
        proposalId: "proposal-1",
        expectedArtifactVersion: 1,
        expectedProposalContentHash: "a".repeat(64),
        expectedProjectVersion: 1
      }).success
    ).toBe(true);
  });

  it("types story work runtime with separate scene apply", () => {
    expectTypeOf<StoryWorkApiRuntime>().toHaveProperty("apply");
    expectTypeOf<StoryWorkApiRuntime>().toHaveProperty("sceneApply");
    expectTypeOf<StoryWorkApiRuntime>().toHaveProperty("checkGeneration");
    expectTypeOf<StoryWorkApiRuntime>().toHaveProperty("checkReview");
    expectTypeOf<StoryWorkApiRuntime>().toHaveProperty("structureGeneration");
    expectTypeOf<StoryWorkApiRuntime>().toHaveProperty("structureApply");
  });

  it("strictly validates outline submit, preview, and apply contracts", () => {
    expect(submitOutlineStoryWorkRequestSchema.safeParse(outlineAssignmentRequest()).success).toBe(
      true
    );
    expect(
      submitOutlineStoryWorkRequestSchema.safeParse(
        outlineAssignmentRequest({ captureId: "capture-1" })
      ).success
    ).toBe(false);
    expect(
      previewStructureStoryWorkRequestSchema.safeParse({
        expectedAssignmentVersion: 3,
        expectedProjectVersion: 1,
        artifact: {
          proposalId: "proposal-1",
          artifactVersion: 1,
          contentHash: "a".repeat(64)
        },
        selectedOperationIds: ["op-part"]
      }).success
    ).toBe(true);
    expect(
      applyStructureStoryWorkRequestSchema.safeParse({
        expectedAssignmentVersion: 3,
        proposalId: "proposal-1",
        expectedArtifactVersion: 1,
        expectedProposalContentHash: "a".repeat(64),
        expectedProjectVersion: 1,
        selectedOperationIds: ["op-part"],
        idempotencyKey: "structure-apply-1"
      }).success
    ).toBe(true);
    expect(
      editStructureStoryWorkReviewRequestSchema.safeParse({
        expectedAssignmentVersion: 3,
        artifact: {
          proposalId: "proposal-1",
          artifactVersion: 1,
          contentHash: "a".repeat(64)
        },
        payload: { schemaId: "not-structure" }
      }).success
    ).toBe(false);
  });

  it("strictly validates exported continuity check submit schemas by mode", () => {
    expect(
      submitAppliedSceneCheckStoryWorkRequestSchema.safeParse(checkAssignmentRequest()).success
    ).toBe(true);
    expect(
      submitAppliedSceneCheckStoryWorkRequestSchema.safeParse(
        checkAssignmentRequest({ sceneIds: [selectedSceneId] })
      ).success
    ).toBe(true);
    expect(
      submitAppliedSceneCheckStoryWorkRequestSchema.safeParse(
        checkAssignmentRequest({ checkMode: "proposal-draft" })
      ).success
    ).toBe(false);
    expect(
      submitAppliedSceneCheckStoryWorkRequestSchema.safeParse(
        checkAssignmentRequest({
          sourceAssignmentId: "assignment-1",
          sourceArtifact: {
            proposalId: "proposal-1",
            artifactVersion: 1,
            contentHash: "a".repeat(64)
          }
        })
      ).success
    ).toBe(false);
    expect(
      submitProposalDraftCheckStoryWorkRequestSchema.safeParse(
        checkAssignmentRequest({
          checkMode: "proposal-draft",
          sceneIds: [],
          sourceAssignmentId: "assignment-1",
          sourceArtifact: {
            proposalId: "proposal-1",
            artifactVersion: 1,
            contentHash: "a".repeat(64)
          }
        })
      ).success
    ).toBe(true);
    expect(
      submitProposalDraftCheckStoryWorkRequestSchema.safeParse(
        checkAssignmentRequest({ checkMode: "applied-scene", sceneIds: [] })
      ).success
    ).toBe(false);
    expect(
      submitProposalDraftCheckStoryWorkRequestSchema.safeParse(
        checkAssignmentRequest({ checkMode: "proposal-draft", sceneIds: [] })
      ).success
    ).toBe(false);
    expect(
      submitCheckStoryWorkRequestSchema.safeParse(
        checkAssignmentRequest({ checkMode: "proposal-draft", sceneIds: [] })
      ).success
    ).toBe(false);
    expect(
      submitStoryWorkRequestSchema.safeParse(
        checkAssignmentRequest({ checkMode: "proposal-draft", sceneIds: [selectedSceneId] })
      ).success
    ).toBe(false);
    expect(
      submitStoryWorkRequestSchema.safeParse(
        checkAssignmentRequest({ extraField: true })
      ).success
    ).toBe(false);
  });
});

describe("story work routes", () => {
  it("creates, replays, lists, and loads an owner-scoped assignment", async () => {
    const { app } = await createSeededBackendApp();
    const first = await app.request(assignmentPath, mutation(assignmentRequest()));

    expect(first.status).toBe(201);
    const firstBody = await first.json();
    expect(firstBody).toMatchObject({
      created: true,
      assignment: {
        taskKind: "character",
        brief: "  Keep the exact character brief.  ",
        sources: [{ kind: "project", projectId: BELLWETHER_FIXTURE_PROJECT_ID }],
        destination: { kind: "story-knowledge", operation: "create" }
      }
    });

    const renamed = await app.request(
      `/api/projects/${BELLWETHER_FIXTURE_PROJECT_ID}/commands`,
      mutation(
        {
          expectedVersion: 1,
          command: { type: "project.rename", title: "Bellwether after submit" }
        }
      )
    );
    expect(renamed.status).toBe(200);

    const replay = await app.request(assignmentPath, mutation(assignmentRequest()));
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({
      created: false,
      assignment: { id: firstBody.assignment.id }
    });

    const list = await app.request(`${assignmentPath}?status=brief-ready&limit=1`);
    expect(list.status).toBe(200);
    await expect(list.json()).resolves.toMatchObject({
      assignments: [{ id: firstBody.assignment.id }]
    });

    const detail = await app.request(`${assignmentPath}/${firstBody.assignment.id}`);
    const detailBody = await detail.json();
    expect(detail.status, JSON.stringify(detailBody)).toBe(200);
    expect(detailBody).toEqual({ assignment: firstBody.assignment });
  });

  it("does not disclose assignments or projects across accounts", async () => {
    const { app } = await createSeededBackendApp(
      fakeBackendAuth({
        account: {
          id: "account-other",
          name: "Other Writer",
          email: "other@example.test",
          emailVerified: true
        },
        session: {
          id: "session-other",
          expiresAt: "2099-07-18T19:00:00.000Z"
        }
      })
    );

    const response = await app.request(assignmentPath);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      code: "STORY_WORK_ASSIGNMENT_NOT_FOUND"
    });
  });

  it("passes the exact brief and selected prose once, then replays before provider access", async () => {
    const providerInputs: Array<{ instructions: string; inputText: string }> = [];
    const provider = createFakeStructuredCompletionProvider((input) => {
      providerInputs.push({
        instructions: input.instructions,
        inputText: input.inputText
      });
      return {
        output: {
          schemaId: "character-create-v2",
          name: "Inez Vale",
          summary: "A navigator whose certainty masks an old failure.",
          aliases: ["Inez"],
          characterSheet: {
            desire: "Bring the ship through the harbor safely.",
            pressure: "The trusted chart contradicts what she can see.",
            voiceNotes: "Measured sentences that shorten when she is afraid."
          },
          sourceSceneIds: [selectedSceneId]
        }
      };
    });
    const { app } = await createSeededBackendApp(undefined, {
      kekConfig: createTestProviderKekRuntimeConfig(),
      openAiCompletionProviderFactory: () => provider
    });
    const scenePath =
      `/api/projects/${BELLWETHER_FIXTURE_PROJECT_ID}/scenes/${selectedSceneId}`;
    expect((await app.request(`${scenePath}/workspace`)).status).toBe(200);
    expect(
      (
        await app.request(`${scenePath}/lease`, {
          method: "POST",
          headers: { origin: TEST_BACKEND_ORIGIN }
        })
      ).status
    ).toBe(200);
    const selectedProse = "The red harbor light vanished behind Inez.";
    expect(
      (
        await app.request(
          `${scenePath}/body`,
          mutation(
            {
              expectedWorkingVersion: 1,
              document: {
                schemaVersion: 1,
                document: {
                  type: "doc",
                  content: [
                    {
                      type: "paragraph",
                      attrs: { id: "block-story-work-source" },
                      content: [{ type: "text", text: selectedProse }]
                    }
                  ]
                }
              }
            },
            "PATCH"
          )
        )
      ).status
    ).toBe(200);
    const configured = await app.request(
      "/api/me/provider/openai",
      mutation({ apiKey: "sk-character-story-work-test-key-1234" }, "PUT")
    );
    expect(configured.status).toBe(200);
    const configuredBody = await configured.json();

    const brief = "  Develop Inez from the selected harbor scene.  ";
    const submitted = await app.request(
      assignmentPath,
      mutation(
        assignmentRequest({
          idempotencyKey: "assignment-with-scene",
          brief,
          sceneIds: [selectedSceneId]
        })
      )
    );
    expect(submitted.status).toBe(201);
    const assignment = (await submitted.json()).assignment;
    expect(assignment.sources).toEqual([
      expect.objectContaining({
        kind: "scene",
        sceneId: selectedSceneId,
        workingVersion: 2,
        contentHash: expect.stringMatching(/^[a-f0-9]{64}$/u)
      })
    ]);

    const attemptBody = {
      expectedAssignmentVersion: 1,
      kind: "initial",
      sourceMode: "submitted-snapshot",
      instruction: brief,
      idempotencyKey: "attempt-with-scene"
    };
    const generated = await app.request(
      `${assignmentPath}/${assignment.id}/attempts`,
      mutation(attemptBody)
    );
    expect(generated.status).toBe(201);
    const generatedBody = await generated.json();
    expect(generatedBody).toMatchObject({
      kind: "ready",
      state: {
        assignment: { status: "artifact-ready" },
        attempt: { instruction: brief, sourceMode: "submitted-snapshot" },
        proposal: { payload: { name: "Inez Vale" } }
      }
    });
    expect(providerInputs).toHaveLength(1);
    expect(providerInputs[0]!.inputText).toContain(brief);
    expect(providerInputs[0]!.inputText).toContain(selectedProse);

    const removedCredential = await app.request(
      "/api/me/provider/openai",
      mutation({ expectedVersion: configuredBody.version }, "DELETE")
    );
    expect(removedCredential.status).toBe(200);

    const replay = await app.request(
      `${assignmentPath}/${assignment.id}/attempts`,
      mutation(attemptBody)
    );
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({
      kind: "replayed",
      state: { attempt: { instruction: brief } }
    });
    expect(providerInputs).toHaveLength(1);

    const detail = await app.request(`${assignmentPath}/${assignment.id}`);
    await expect(detail.json()).resolves.toMatchObject({
      attempt: { instruction: brief, sourceMode: "submitted-snapshot" },
      proposal: { payload: { name: "Inez Vale" } },
      run: { status: "ready" }
    });

    const generatedArtifact = generatedBody.state.assignment.currentArtifact;
    const opened = await app.request(
      `${assignmentPath}/${assignment.id}/review/open`,
      mutation({
        expectedAssignmentVersion: generatedBody.state.assignment.version,
        artifact: generatedArtifact
      })
    );
    expect(opened.status).toBe(200);
    const openedBody = await opened.json();
    expect(openedBody.assignment.status).toBe("awaiting-review");

    const editedPayload = {
      ...generatedBody.state.proposal.payload,
      summary: "A harbor navigator who chooses the dangerous honest route.",
      characterSheet: {
        ...generatedBody.state.proposal.payload.characterSheet,
        pressure: "The crew will mutiny if she cannot explain the missing light."
      }
    };
    const edited = await app.request(
      `${assignmentPath}/${assignment.id}/review`,
      mutation(
        {
          expectedAssignmentVersion: openedBody.assignment.version,
          artifact: openedBody.assignment.currentArtifact,
          payload: editedPayload
        },
        "PATCH"
      )
    );
    expect(edited.status).toBe(200);
    const editedBody = await edited.json();
    expect(editedBody).toMatchObject({
      assignment: { status: "awaiting-review" },
      proposal: {
        payload: {
          summary: editedPayload.summary,
          characterSheet: { pressure: editedPayload.characterSheet.pressure }
        }
      }
    });

    const applied = await app.request(
      `${assignmentPath}/${assignment.id}/apply`,
      mutation({
        expectedAssignmentVersion: editedBody.assignment.version,
        proposalId: editedBody.proposal.id,
        expectedArtifactVersion:
          editedBody.assignment.currentArtifact.artifactVersion,
        expectedProposalContentHash: editedBody.proposal.contentHash,
        expectedProjectVersion: 1
      })
    );
    expect(applied.status).toBe(200);
    await expect(applied.json()).resolves.toMatchObject({
      assignment: { status: "applied" },
      proposal: {
        payload: {
          name: "Inez Vale",
          summary: editedPayload.summary,
          characterSheet: { pressure: editedPayload.characterSheet.pressure }
        }
      },
      result: { storyKnowledgeId: assignment.destination.storyKnowledgeId }
    });
    const navigator = await app.request(
      `/api/projects/${BELLWETHER_FIXTURE_PROJECT_ID}/navigator`
    );
    const navigatorBody = await navigator.json();
    expect(navigatorBody.storyKnowledge).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: assignment.destination.storyKnowledgeId,
          label: "Inez Vale",
          notes: editedPayload.summary,
          characterSheet: expect.objectContaining({
            pressure: editedPayload.characterSheet.pressure
          })
        })
      ])
    );
  });

  it("generates from project structure alone and details the latest failed revision", async () => {
    let completionCount = 0;
    const provider = createFakeStructuredCompletionProvider(() => {
      completionCount += 1;
      return {
        output: {
          schemaId: "character-create-v2",
          name: "Mara Venn",
          summary: "A pilot carrying an old harbor loss.",
          aliases: ["Mara"],
          characterSheet: {
            desire: "Bring the crew home.",
            pressure: "The safe route is closing.",
            voiceNotes: "Quiet and exact."
          }
        },
        ...(completionCount === 1
          ? {}
          : { failure: { mode: "completion" as const, code: "timeout" as const } })
      };
    });
    const { app } = await createSeededBackendApp(undefined, {
      kekConfig: createTestProviderKekRuntimeConfig(),
      openAiCompletionProviderFactory: () => provider
    });
    const configured = await app.request(
      "/api/me/provider/openai",
      mutation({ apiKey: "sk-empty-story-work-test-key-123456" }, "PUT")
    );
    expect(configured.status).toBe(200);
    const brief = "Develop Mara from the project structure and this brief.";
    const submitted = await app.request(
      assignmentPath,
      mutation(
        assignmentRequest({
          idempotencyKey: "empty-source-assignment",
          brief,
          sceneIds: []
        })
      )
    );
    expect(submitted.status).toBe(201);
    const assignment = (await submitted.json()).assignment;
    expect(assignment.sources).toEqual([
      { kind: "project", projectId: BELLWETHER_FIXTURE_PROJECT_ID, projectVersion: 1 }
    ]);

    const initial = await app.request(
      `${assignmentPath}/${assignment.id}/attempts`,
      mutation({
        expectedAssignmentVersion: assignment.version,
        kind: "initial",
        sourceMode: "submitted-snapshot",
        instruction: brief,
        idempotencyKey: "empty-source-initial"
      })
    );
    expect(initial.status).toBe(201);
    const initialBody = await initial.json();
    expect(initialBody).toMatchObject({
      kind: "ready",
      state: {
        assignment: { status: "artifact-ready" },
        proposal: { payload: { name: "Mara Venn" } }
      }
    });

    const revisionInstruction = "Keep Mara, but make the harbor loss more immediate.";
    const revision = await app.request(
      `${assignmentPath}/${assignment.id}/attempts`,
      mutation({
        expectedAssignmentVersion: initialBody.state.assignment.version,
        kind: "revision",
        sourceMode: "latest-authorized",
        instruction: revisionInstruction,
        priorArtifact: initialBody.state.assignment.currentArtifact,
        idempotencyKey: "empty-source-revision"
      })
    );
    expect(revision.status).toBe(201);
    await expect(revision.json()).resolves.toMatchObject({
      kind: "failed",
      state: {
        assignment: { status: "failed" },
        attempt: { instruction: revisionInstruction }
      }
    });

    const detail = await app.request(`${assignmentPath}/${assignment.id}`);
    const detailBody = await detail.json();
    expect(detail.status).toBe(200);
    expect(detailBody).toMatchObject({
      assignment: { status: "failed" },
      attempt: { instruction: revisionInstruction, kind: "revision" },
      run: { status: "failed", terminalDiagnosticCode: "provider-timeout" },
      proposal: { id: initialBody.state.proposal.id }
    });
    expect(detailBody.attempt.runId).toBe(detailBody.run.id);
    expect(detailBody.receipt.id).toBe(detailBody.run.receiptId);
    expect(completionCount).toBe(2);
  });

  it("generates and reviews a scene from exact manuscript and Capture sources", async () => {
    const providerInputs: string[] = [];
    const provider = createFakeStructuredCompletionProvider((input) => {
      providerInputs.push(input.inputText);
      return {
        output: {
          schemaId: "scene-draft-v1",
          prose: "Inez watched the signal vanish, then opened the sealed log.",
          sourceSceneIds: sourceSceneIdsFromPrompt(input.inputText)
        }
      };
    });
    const { app } = await createSeededBackendApp(undefined, {
      kekConfig: createTestProviderKekRuntimeConfig(),
      openAiCompletionProviderFactory: () => provider
    });
    const scenePath =
      `/api/projects/${BELLWETHER_FIXTURE_PROJECT_ID}/scenes/${selectedSceneId}`;
    await app.request(`${scenePath}/workspace`);
    await app.request(`${scenePath}/lease`, {
      method: "POST",
      headers: { origin: TEST_BACKEND_ORIGIN }
    });
    const sourceProse = "The harbor signal disappeared behind the rain.";
    const savedScene = await app.request(
      `${scenePath}/body`,
      mutation(
        {
          expectedWorkingVersion: 1,
          document: {
            schemaVersion: 1,
            document: {
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  attrs: { id: "block-scene-source" },
                  content: [{ type: "text", text: sourceProse }]
                }
              ]
            }
          }
        },
        "PATCH"
      )
    );
    expect(savedScene.status).toBe(200);

    const capturesPath =
      `/api/projects/${BELLWETHER_FIXTURE_PROJECT_ID}/captures`;
    const createdCapture = await app.request(
      capturesPath,
      mutation({ sourceModality: "text" })
    );
    expect(createdCapture.status).toBe(201);
    const captureId = (await createdCapture.json()).head.captureId as string;
    const captureText = "The torn note says the west beacon was deliberately darkened.";
    const savedCapture = await app.request(
      `${capturesPath}/${captureId}/body`,
      mutation(
        {
          expectedWorkingVersion: 1,
          document: captureDocumentWith(captureText)
        },
        "PATCH"
      )
    );
    expect(savedCapture.status).toBe(200);
    const captureHead = (await savedCapture.json()).head;

    expect(
      (
        await app.request(
          "/api/me/provider/openai",
          mutation({ apiKey: "sk-scene-story-work-test-key-123456" }, "PUT")
        )
      ).status
    ).toBe(200);
    const brief = "Draft the discovery that connects the signal to the torn note.";
    const submitted = await app.request(
      assignmentPath,
      mutation(
        assignmentRequest({
          taskKind: "scene",
          idempotencyKey: "scene-assignment-with-capture",
          brief,
          sceneIds: [selectedSceneId],
          captureId
        })
      )
    );
    expect(submitted.status).toBe(201);
    const assignment = (await submitted.json()).assignment;
    expect(assignment).toMatchObject({
      taskKind: "scene",
      destination: { kind: "scene", operation: "create" }
    });
    expect(assignment.destination.sceneId).not.toBe(selectedSceneId);
    expect(assignment.sources).toEqual([
      expect.objectContaining({
        kind: "scene",
        sceneId: selectedSceneId,
        workingVersion: 2
      }),
      expect.objectContaining({
        kind: "capture",
        captureId,
        workingVersion: captureHead.workingVersion,
        contentHash: captureHead.contentHash
      })
    ]);

    const attemptRequest = {
      expectedAssignmentVersion: 1,
      kind: "initial",
      sourceMode: "submitted-snapshot",
      instruction: brief,
      idempotencyKey: "scene-attempt-with-capture"
    };
    const generated = await app.request(
      `${assignmentPath}/${assignment.id}/attempts`,
      mutation(attemptRequest)
    );
    const generatedBody = await generated.json();
    expect(generated.status, JSON.stringify(generatedBody)).toBe(201);
    expect(generatedBody).toMatchObject({
      kind: "ready",
      state: {
        proposal: {
          outputSchemaId: "scene-draft-v1",
          primaryTarget: { kind: "scene", id: assignment.destination.sceneId },
          payload: { sourceSceneIds: [selectedSceneId] }
        },
        assignment: { status: "artifact-ready" }
      }
    });
    expect(providerInputs).toHaveLength(1);
    expect(providerInputs[0]!.split(sourceProse)).toHaveLength(2);
    expect(providerInputs[0]!.split(captureText)).toHaveLength(2);

    const replay = await app.request(
      `${assignmentPath}/${assignment.id}/attempts`,
      mutation(attemptRequest)
    );
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({ kind: "replayed" });
    expect(providerInputs).toHaveLength(1);

    const opened = await app.request(
      `${assignmentPath}/${assignment.id}/review/open`,
      mutation({
        expectedAssignmentVersion: generatedBody.state.assignment.version,
        artifact: generatedBody.state.assignment.currentArtifact
      })
    );
    const openedBody = await opened.json();
    expect(opened.status, JSON.stringify(openedBody)).toBe(200);
    const revisedProse =
      "Inez watched the signal vanish. The torn note in her hand named who had darkened it.";
    const edited = await app.request(
      `${assignmentPath}/${assignment.id}/review`,
      mutation(
        {
          expectedAssignmentVersion: openedBody.assignment.version,
          artifact: openedBody.assignment.currentArtifact,
          payload: {
            ...openedBody.proposal.payload,
            prose: revisedProse
          }
        },
        "PATCH"
      )
    );
    const editedBody = await edited.json();
    expect(edited.status, JSON.stringify(editedBody)).toBe(200);
    expect(editedBody).toMatchObject({
      assignment: { status: "awaiting-review" },
      proposal: {
        payload: { prose: revisedProse, sourceSceneIds: [selectedSceneId] }
      }
    });

    const refusedApply = await app.request(
      `${assignmentPath}/${assignment.id}/apply`,
      mutation({
        expectedAssignmentVersion: editedBody.assignment.version,
        proposalId: editedBody.proposal.id,
        expectedArtifactVersion: editedBody.assignment.currentArtifact.artifactVersion,
        expectedProposalContentHash: editedBody.proposal.contentHash,
        expectedProjectVersion: 1
      })
    );
    expect(refusedApply.status).toBe(400);
    await expect(refusedApply.json()).resolves.toMatchObject({
      code: "INVALID_REQUEST"
    });
    const workspace = await app.request(`${scenePath}/workspace`);
    const workspaceBody = await workspace.json();
    expect(JSON.stringify(workspaceBody)).not.toContain(revisedProse);
  });

  it("supports project-only new-scene work and targets an active scene for revision", async () => {
    const provider = createFakeStructuredCompletionProvider((input) => ({
      output: {
        schemaId: "scene-draft-v1",
        prose: input.inputText.includes("REVISION INSTRUCTION")
          ? "The revised arrival opens on the extinguished beacon."
          : "A new harbor scene begins before dawn.",
        sourceSceneIds: sourceSceneIdsFromPrompt(input.inputText)
      }
    }));
    const { app } = await createSeededBackendApp(undefined, {
      kekConfig: createTestProviderKekRuntimeConfig(),
      openAiCompletionProviderFactory: () => provider
    });
    await app.request(
      "/api/me/provider/openai",
      mutation({ apiKey: "sk-project-scene-work-test-key-123456" }, "PUT")
    );

    for (const task of [
      {
        taskKind: "scene" as const,
        idempotencyKey: "project-only-scene",
        brief: "Draft a new scene from the project structure.",
        sceneIds: []
      },
      {
        taskKind: "revise" as const,
        idempotencyKey: "project-only-revision",
        brief: "Revise the active arrival scene from the project structure.",
        sceneIds: [],
        targetSceneId: selectedSceneId
      }
    ]) {
      const submitted = await app.request(
        assignmentPath,
        mutation(assignmentRequest(task))
      );
      const submittedBody = await submitted.json();
      expect(submitted.status, JSON.stringify(submittedBody)).toBe(201);
      expect(submittedBody.assignment.sources).toEqual([
        {
          kind: "project",
          projectId: BELLWETHER_FIXTURE_PROJECT_ID,
          projectVersion: 1
        }
      ]);
      expect(submittedBody.assignment.destination).toMatchObject({
        kind: "scene",
        operation: task.taskKind === "scene" ? "create" : "update",
        ...(task.taskKind === "revise" ? { sceneId: selectedSceneId } : {})
      });
      const generated = await app.request(
        `${assignmentPath}/${submittedBody.assignment.id}/attempts`,
        mutation({
          expectedAssignmentVersion: 1,
          kind: "initial",
          sourceMode: "submitted-snapshot",
          instruction: task.brief,
          idempotencyKey: `${task.idempotencyKey}-attempt`
        })
      );
      const generatedBody = await generated.json();
      expect(generated.status, JSON.stringify(generatedBody)).toBe(201);
      expect(generatedBody).toMatchObject({
        kind: "ready",
        state: {
          proposal: {
            outputSchemaId: "scene-draft-v1",
            payload: { sourceSceneIds: [] }
          }
        }
      });
    }
  });

  it("applies a reviewed new-scene proposal with replay and stale refusal", async () => {
    const provider = createFakeStructuredCompletionProvider(() => ({
      output: {
        schemaId: "scene-draft-v1",
        prose: "A new harbor scene begins before dawn.",
        sourceSceneIds: []
      }
    }));
    const { app } = await createSeededBackendApp(undefined, {
      kekConfig: createTestProviderKekRuntimeConfig(),
      openAiCompletionProviderFactory: () => provider
    });
    await app.request(
      "/api/me/provider/openai",
      mutation({ apiKey: "sk-scene-apply-test-key-1234567890" }, "PUT")
    );
    const submitted = await app.request(
      assignmentPath,
      mutation(
        assignmentRequest({
          taskKind: "scene",
          idempotencyKey: "scene-apply-assignment",
          brief: "Draft a new scene from the project structure.",
          sceneIds: []
        })
      )
    );
    expect(submitted.status).toBe(201);
    const assignment = (await submitted.json()).assignment;
    const generated = await app.request(
      `${assignmentPath}/${assignment.id}/attempts`,
      mutation({
        expectedAssignmentVersion: 1,
        kind: "initial",
        sourceMode: "submitted-snapshot",
        instruction: "Draft a new scene from the project structure.",
        idempotencyKey: "scene-apply-attempt"
      })
    );
    expect(generated.status).toBe(201);
    const generatedBody = await generated.json();
    const opened = await app.request(
      `${assignmentPath}/${assignment.id}/review/open`,
      mutation({
        expectedAssignmentVersion: generatedBody.state.assignment.version,
        artifact: generatedBody.state.assignment.currentArtifact
      })
    );
    expect(opened.status).toBe(200);
    const openedBody = await opened.json();
    const edited = await app.request(
      `${assignmentPath}/${assignment.id}/review`,
      mutation(
        {
          expectedAssignmentVersion: openedBody.assignment.version,
          artifact: openedBody.assignment.currentArtifact,
          payload: openedBody.proposal.payload
        },
        "PATCH"
      )
    );
    expect(edited.status).toBe(200);
    const editedBody = await edited.json();
    const applyBody = sceneCreateApplyBody(
      editedBody.assignment,
      editedBody.proposal,
      { idempotencyKey: "scene-create-apply-replay" }
    );
    const applied = await app.request(
      `${assignmentPath}/${assignment.id}/apply`,
      mutation(applyBody)
    );
    expect(applied.status).toBe(200);
    const appliedBody = await applied.json();
    expect(appliedBody).toMatchObject({
      replayed: false,
      assignment: { status: "applied" },
      result: {
        kind: "scene",
        sceneId: assignment.destination.sceneId,
        workingVersion: 1
      }
    });
    const replay = await app.request(
      `${assignmentPath}/${assignment.id}/apply`,
      mutation(applyBody)
    );
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({
      replayed: true,
      result: appliedBody.result
    });

    const submittedAgain = await app.request(
      assignmentPath,
      mutation(
        assignmentRequest({
          taskKind: "scene",
          idempotencyKey: "scene-apply-stale-assignment",
          brief: "Draft another scene for stale apply refusal.",
          sceneIds: [],
          expectedProjectVersion: 2
        })
      )
    );
    expect(submittedAgain.status).toBe(201);
    const staleAssignment = (await submittedAgain.json()).assignment;
    const staleGenerated = await app.request(
      `${assignmentPath}/${staleAssignment.id}/attempts`,
      mutation({
        expectedAssignmentVersion: 1,
        kind: "initial",
        sourceMode: "submitted-snapshot",
        instruction: "Draft another scene for stale apply refusal.",
        idempotencyKey: "scene-apply-stale-attempt"
      })
    );
    const staleGeneratedBody = await staleGenerated.json();
    const staleOpened = await app.request(
      `${assignmentPath}/${staleAssignment.id}/review/open`,
      mutation({
        expectedAssignmentVersion: staleGeneratedBody.state.assignment.version,
        artifact: staleGeneratedBody.state.assignment.currentArtifact
      })
    );
    const staleOpenedBody = await staleOpened.json();
    const staleEdited = await app.request(
      `${assignmentPath}/${staleAssignment.id}/review`,
      mutation(
        {
          expectedAssignmentVersion: staleOpenedBody.assignment.version,
          artifact: staleOpenedBody.assignment.currentArtifact,
          payload: staleOpenedBody.proposal.payload
        },
        "PATCH"
      )
    );
    const staleEditedBody = await staleEdited.json();
    const renamed = await app.request(
      `/api/projects/${BELLWETHER_FIXTURE_PROJECT_ID}/commands`,
      mutation({
        expectedVersion: 2,
        command: { type: "project.rename", title: "Bellwether after scene apply" }
      })
    );
    expect(renamed.status).toBe(200);
    const staleApply = await app.request(
      `${assignmentPath}/${staleAssignment.id}/apply`,
      mutation(
        sceneCreateApplyBody(staleEditedBody.assignment, staleEditedBody.proposal, {
          idempotencyKey: "scene-create-apply-stale",
          expectedProjectVersion: 2
        })
      )
    );
    expect(staleApply.status).toBe(409);
    await expect(staleApply.json()).resolves.toMatchObject({
      code: "SCENE_STORY_WORK_CONTEXT_STALE"
    });
  });

  it("runs applied-scene continuity checks with replay, review completion, and freshness", async () => {
    let providerCalls = 0;
    const provider = createFakeStructuredCompletionProvider((input) => {
      providerCalls += 1;
      return { output: hermeticCheckCandidateOutput(input.inputText) };
    });
    const { app } = await createSeededBackendApp(undefined, {
      kekConfig: createTestProviderKekRuntimeConfig(),
      openAiCompletionProviderFactory: () => provider
    });
    const scenePath =
      `/api/projects/${BELLWETHER_FIXTURE_PROJECT_ID}/scenes/${selectedSceneId}`;
    await app.request(`${scenePath}/workspace`);
    await app.request(`${scenePath}/lease`, {
      method: "POST",
      headers: { origin: TEST_BACKEND_ORIGIN }
    });
    const targetProse = "The red harbor light vanished behind Inez before dawn.";
    const saved = await app.request(
      `${scenePath}/body`,
      mutation(
        {
          expectedWorkingVersion: 1,
          document: {
            schemaVersion: 1,
            document: {
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  attrs: { id: "block-check-target" },
                  content: [{ type: "text", text: targetProse }]
                }
              ]
            }
          }
        },
        "PATCH"
      )
    );
    expect(saved.status).toBe(200);
    const workspaceBefore = await app.request(`${scenePath}/workspace`);
    const workspaceBeforeBody = await workspaceBefore.json();
    expect(
      (
        await app.request(
          "/api/me/provider/openai",
          mutation({ apiKey: "sk-check-story-work-test-key-123456789" }, "PUT")
        )
      ).status
    ).toBe(200);

    const submitted = await app.request(
      assignmentPath,
      mutation(checkAssignmentRequest({ idempotencyKey: "check-applied-assignment" }))
    );
    expect(submitted.status).toBe(201);
    const assignment = (await submitted.json()).assignment;
    expect(assignment).toMatchObject({
      taskKind: "check",
      destination: { kind: "scene", sceneId: selectedSceneId, operation: "assess" }
    });
    expect(assignment.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "scene",
          sceneId: selectedSceneId,
          workingVersion: 2
        })
      ])
    );

    const attemptBody = {
      expectedAssignmentVersion: 1,
      kind: "initial",
      sourceMode: "submitted-snapshot",
      instruction: checkAssignmentRequest().brief,
      idempotencyKey: "check-applied-attempt"
    };
    const generated = await app.request(
      `${assignmentPath}/${assignment.id}/attempts`,
      mutation(attemptBody)
    );
    expect(generated.status).toBe(201);
    const generatedBody = await generated.json();
    expect(generatedBody).toMatchObject({
      kind: "ready",
      state: {
        assignment: { status: "artifact-ready" },
        proposal: { outputSchemaId: "story-check-findings-v1" }
      }
    });
    expect(providerCalls).toBe(1);

    const replay = await app.request(
      `${assignmentPath}/${assignment.id}/attempts`,
      mutation(attemptBody)
    );
    expect(replay.status).toBe(200);
    expect(providerCalls).toBe(1);

    const detail = await app.request(`${assignmentPath}/${assignment.id}`);
    const detailBody = await detail.json();
    expect(detailBody.checkFreshness).toEqual({ status: "fresh" });

    const artifact = generatedBody.state.assignment.currentArtifact;
    const opened = await app.request(
      `${assignmentPath}/${assignment.id}/review/open`,
      mutation({
        expectedAssignmentVersion: generatedBody.state.assignment.version,
        artifact
      })
    );
    expect(opened.status).toBe(200);
    const openedBody = await opened.json();
    const findingId = openedBody.proposal.payload.findings[0]?.id as string;
    const dismissed = await app.request(
      `${assignmentPath}/${assignment.id}/review/findings/${findingId}`,
      mutation(
        {
          expectedAssignmentVersion: openedBody.assignment.version,
          artifact: openedBody.assignment.currentArtifact,
          resolution: { status: "dismissed" }
        },
        "PATCH"
      )
    );
    expect(dismissed.status).toBe(200);
    const dismissedBody = await dismissed.json();
    const completedResponse = await app.request(
      `${assignmentPath}/${assignment.id}/review/complete`,
      mutation({
        expectedAssignmentVersion: dismissedBody.assignment.version,
        artifact: dismissedBody.assignment.currentArtifact
      })
    );
    expect(completedResponse.status).toBe(200);
    const completedBody = await completedResponse.json();
    expect(completedBody.assignment.status).toBe("reviewed");

    const refusedApply = await app.request(
      `${assignmentPath}/${assignment.id}/apply`,
      mutation({
        expectedAssignmentVersion: completedBody.assignment.version,
        proposalId: completedBody.proposal.id,
        expectedArtifactVersion: completedBody.assignment.currentArtifact.artifactVersion,
        expectedProposalContentHash: completedBody.proposal.contentHash,
        expectedProjectVersion: 1
      })
    );
    expect(refusedApply.status).toBe(422);

    const workspaceAfter = await app.request(`${scenePath}/workspace`);
    const workspaceAfterBody = await workspaceAfter.json();
    expect(workspaceAfterBody.head.workingVersion).toBe(
      workspaceBeforeBody.head.workingVersion
    );

    await app.request(
      `${scenePath}/body`,
      mutation(
        {
          expectedWorkingVersion: workspaceAfterBody.head.workingVersion,
          document: {
            schemaVersion: 1,
            document: {
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  attrs: { id: "block-check-target" },
                  content: [{ type: "text", text: `${targetProse} A foghorn answered.` }]
                }
              ]
            }
          }
        },
        "PATCH"
      )
    );
    const staleDetail = await app.request(`${assignmentPath}/${assignment.id}`);
    const staleDetailBody = await staleDetail.json();
    expect(staleDetailBody.checkFreshness.status).toBe("needs-recheck");
    expect(providerCalls).toBe(1);
  });

  it("refuses invalid check anchors and supports proposal-draft receipt resources", async () => {
    const badProvider = createFakeStructuredCompletionProvider(() => ({
      output: {
        schemaId: "story-check-findings-candidates-v1",
        findings: [
          {
            kind: "contradiction",
            severity: "important",
            claim: "This quote is not in the supplied text.",
            anchors: [{ sceneId: selectedSceneId, quote: "missing-anchor-text" }]
          }
        ]
      }
    }));
    const { app: badApp } = await createSeededBackendApp(undefined, {
      kekConfig: createTestProviderKekRuntimeConfig(),
      openAiCompletionProviderFactory: () => badProvider
    });
    const badScenePath =
      `/api/projects/${BELLWETHER_FIXTURE_PROJECT_ID}/scenes/${selectedSceneId}`;
    await badApp.request(`${badScenePath}/workspace`);
    await badApp.request(`${badScenePath}/lease`, {
      method: "POST",
      headers: { origin: TEST_BACKEND_ORIGIN }
    });
    await badApp.request(
      "/api/me/provider/openai",
      mutation({ apiKey: "sk-check-bad-anchor-test-key-123456789" }, "PUT")
    );
    const badSubmitted = await badApp.request(
      assignmentPath,
      mutation(checkAssignmentRequest({ idempotencyKey: "check-bad-anchor-assignment" }))
    );
    expect(badSubmitted.status).toBe(201);
    const badAssignment = (await badSubmitted.json()).assignment;
    const badGenerated = await badApp.request(
      `${assignmentPath}/${badAssignment.id}/attempts`,
      mutation({
        expectedAssignmentVersion: 1,
        kind: "initial",
        sourceMode: "submitted-snapshot",
        instruction: checkAssignmentRequest().brief,
        idempotencyKey: "check-bad-anchor-attempt"
      })
    );
    expect(badGenerated.status).toBe(201);
    await expect(badGenerated.json()).resolves.toMatchObject({
      kind: "failed",
      state: { assignment: { status: "failed" } }
    });

    const goodProvider = createFakeStructuredCompletionProvider((input) => ({
      output:
        input.outputSchema.name === "story_check_findings_candidates_v1"
          ? hermeticCheckCandidateOutput(input.inputText)
          : {
              schemaId: "scene-draft-v1",
              prose: "Draft prose for proposal continuity checking.",
              sourceSceneIds: []
            }
    }));
    const { app } = await createSeededBackendApp(undefined, {
      kekConfig: createTestProviderKekRuntimeConfig(),
      openAiCompletionProviderFactory: () => goodProvider
    });
    await app.request(
      "/api/me/provider/openai",
      mutation({ apiKey: "sk-check-proposal-test-key-1234567890" }, "PUT")
    );
    const proposalScenePath =
      `/api/projects/${BELLWETHER_FIXTURE_PROJECT_ID}/scenes/${selectedSceneId}`;
    await app.request(`${proposalScenePath}/workspace`);
    await app.request(`${proposalScenePath}/lease`, {
      method: "POST",
      headers: { origin: TEST_BACKEND_ORIGIN }
    });
    const reviseSubmitted = await app.request(
      assignmentPath,
      mutation(
        assignmentRequest({
          taskKind: "revise",
          idempotencyKey: "check-proposal-source-assignment",
          brief: "Revise the arrival scene for a proposal check.",
          sceneIds: [],
          targetSceneId: selectedSceneId
        })
      )
    );
    expect(reviseSubmitted.status).toBe(201);
    const reviseAssignment = (await reviseSubmitted.json()).assignment;
    const reviseGenerated = await app.request(
      `${assignmentPath}/${reviseAssignment.id}/attempts`,
      mutation({
        expectedAssignmentVersion: 1,
        kind: "initial",
        sourceMode: "submitted-snapshot",
        instruction: "Revise the arrival scene for a proposal check.",
        idempotencyKey: "check-proposal-source-attempt"
      })
    );
    expect(reviseGenerated.status).toBe(201);
    const reviseGeneratedBody = await reviseGenerated.json();
    const sourceArtifact = reviseGeneratedBody.state.assignment.currentArtifact;
    const checkSubmitted = await app.request(
      assignmentPath,
      mutation(
        checkAssignmentRequest({
          checkMode: "proposal-draft",
          idempotencyKey: "check-proposal-assignment",
          sourceAssignmentId: reviseAssignment.id,
          sourceArtifact
        })
      )
    );
    expect(checkSubmitted.status).toBe(201);
    const checkAssignment = (await checkSubmitted.json()).assignment;
    const proposalArtifactSource = checkAssignment.sources.find(
      (source: { kind: string }) => source.kind === "proposal-artifact"
    );
    expect(proposalArtifactSource).toMatchObject({
      kind: "proposal-artifact",
      sceneId: selectedSceneId,
      contentHash: reviseGeneratedBody.state.proposal.contentHash
    });
    expect(proposalArtifactSource.contentHash).toBe(sourceArtifact.contentHash);
    const checkGenerated = await app.request(
      `${assignmentPath}/${checkAssignment.id}/attempts`,
      mutation({
        expectedAssignmentVersion: 1,
        kind: "initial",
        sourceMode: "submitted-snapshot",
        instruction: checkAssignmentRequest().brief,
        idempotencyKey: "check-proposal-attempt"
      })
    );
    const checkGeneratedBody = await checkGenerated.json();
    expect(checkGenerated.status, JSON.stringify(checkGeneratedBody)).toBe(201);
    const checkDetail = await app.request(`${assignmentPath}/${checkAssignment.id}`);
    const checkDetailBody = await checkDetail.json();
    expect(checkDetailBody.receipt.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ resourceClass: "proposal-artifact" })
      ])
    );
  });

  it("reports proposal-artifact-changed after the source draft is replaced in review", async () => {
    const provider = createFakeStructuredCompletionProvider((input) => ({
      output:
        input.outputSchema.name === "story_check_findings_candidates_v1"
          ? hermeticCheckCandidateOutput(input.inputText)
          : {
              schemaId: "scene-draft-v1",
              prose: "Draft prose for proposal continuity checking.",
              sourceSceneIds: []
            }
    }));
    const { app } = await createSeededBackendApp(undefined, {
      kekConfig: createTestProviderKekRuntimeConfig(),
      openAiCompletionProviderFactory: () => provider
    });
    await app.request(
      "/api/me/provider/openai",
      mutation({ apiKey: "sk-check-proposal-fresh-key-1234567890" }, "PUT")
    );
    const proposalScenePath =
      `/api/projects/${BELLWETHER_FIXTURE_PROJECT_ID}/scenes/${selectedSceneId}`;
    await app.request(`${proposalScenePath}/workspace`);
    await app.request(`${proposalScenePath}/lease`, {
      method: "POST",
      headers: { origin: TEST_BACKEND_ORIGIN }
    });
    const reviseSubmitted = await app.request(
      assignmentPath,
      mutation(
        assignmentRequest({
          taskKind: "revise",
          idempotencyKey: "check-proposal-fresh-source",
          brief: "Revise the arrival scene for proposal freshness.",
          sceneIds: [],
          targetSceneId: selectedSceneId
        })
      )
    );
    expect(reviseSubmitted.status).toBe(201);
    const reviseAssignment = (await reviseSubmitted.json()).assignment;
    const reviseGenerated = await app.request(
      `${assignmentPath}/${reviseAssignment.id}/attempts`,
      mutation({
        expectedAssignmentVersion: 1,
        kind: "initial",
        sourceMode: "submitted-snapshot",
        instruction: "Revise the arrival scene for proposal freshness.",
        idempotencyKey: "check-proposal-fresh-source-attempt"
      })
    );
    expect(reviseGenerated.status).toBe(201);
    const reviseGeneratedBody = await reviseGenerated.json();
    const sourceArtifact = reviseGeneratedBody.state.assignment.currentArtifact;
    const storedTargetProposalId = reviseGeneratedBody.state.proposal.id as string;
    const checkSubmitted = await app.request(
      assignmentPath,
      mutation(
        checkAssignmentRequest({
          checkMode: "proposal-draft",
          idempotencyKey: "check-proposal-fresh-assignment",
          sourceAssignmentId: reviseAssignment.id,
          sourceArtifact
        })
      )
    );
    expect(checkSubmitted.status).toBe(201);
    const checkAssignment = (await checkSubmitted.json()).assignment;
    const checkGenerated = await app.request(
      `${assignmentPath}/${checkAssignment.id}/attempts`,
      mutation({
        expectedAssignmentVersion: 1,
        kind: "initial",
        sourceMode: "submitted-snapshot",
        instruction: checkAssignmentRequest().brief,
        idempotencyKey: "check-proposal-fresh-attempt"
      })
    );
    expect(checkGenerated.status).toBe(201);
    const freshDetail = await app.request(`${assignmentPath}/${checkAssignment.id}`);
    expect((await freshDetail.json()).checkFreshness).toEqual({ status: "fresh" });

    const opened = await app.request(
      `${assignmentPath}/${reviseAssignment.id}/review/open`,
      mutation({
        expectedAssignmentVersion: reviseGeneratedBody.state.assignment.version,
        artifact: sourceArtifact
      })
    );
    expect(opened.status).toBe(200);
    const openedBody = await opened.json();
    const replacementProse =
      "Replacement harbor draft prose after the writer edited the proposal in review.";
    const edited = await app.request(
      `${assignmentPath}/${reviseAssignment.id}/review`,
      mutation(
        {
          expectedAssignmentVersion: openedBody.assignment.version,
          artifact: openedBody.assignment.currentArtifact,
          payload: {
            ...openedBody.proposal.payload,
            prose: replacementProse
          }
        },
        "PATCH"
      )
    );
    expect(edited.status).toBe(200);
    const editedBody = await edited.json();
    expect(editedBody.proposal.contentHash).not.toBe(sourceArtifact.contentHash);

    const staleDetail = await app.request(`${assignmentPath}/${checkAssignment.id}`);
    const staleBody = await staleDetail.json();
    expect(staleBody.checkFreshness).toMatchObject({ status: "needs-recheck" });
    expect(staleBody.checkFreshness.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          dependencyKey: `proposal-artifact:${storedTargetProposalId}`,
          reason: "proposal-artifact-changed"
        })
      ])
    );
    expect(staleBody.checkFreshness.reasons).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: "proposal-artifact-missing" })
      ])
    );
  });

  it("refuses stale and foreign check targets before generation", async () => {
    const { app } = await createSeededBackendApp(undefined, {
      kekConfig: createTestProviderKekRuntimeConfig(),
      openAiCompletionProviderFactory: () =>
        createFakeStructuredCompletionProvider((input) => ({
          output: hermeticCheckCandidateOutput(input.inputText)
        }))
    });
    const missingTarget = await app.request(
      assignmentPath,
      mutation(
        checkAssignmentRequest({
          targetSceneId: "scene-does-not-exist",
          idempotencyKey: "check-missing-target"
        })
      )
    );
    expect(missingTarget.status).toBe(422);
    const staleProposal = await app.request(
      assignmentPath,
      mutation(
        checkAssignmentRequest({
          checkMode: "proposal-draft",
          idempotencyKey: "check-stale-proposal",
          sourceAssignmentId: "story_work_assignment_missing",
          sourceArtifact: {
            proposalId: "proposal-missing",
            artifactVersion: 1,
            contentHash: "a".repeat(64)
          }
        })
      )
    );
    expect(staleProposal.status).toBe(422);
  });

  it("rejects check revision attempts and hides assignments from foreign owners", async () => {
    const provider = createFakeStructuredCompletionProvider((input) => ({
      output: hermeticCheckCandidateOutput(input.inputText)
    }));
    const { app } = await createSeededBackendApp(undefined, {
      kekConfig: createTestProviderKekRuntimeConfig(),
      openAiCompletionProviderFactory: () => provider
    });
    const scenePath =
      `/api/projects/${BELLWETHER_FIXTURE_PROJECT_ID}/scenes/${selectedSceneId}`;
    await app.request(`${scenePath}/workspace`);
    await app.request(`${scenePath}/lease`, {
      method: "POST",
      headers: { origin: TEST_BACKEND_ORIGIN }
    });
    await app.request(
      "/api/me/provider/openai",
      mutation({ apiKey: "sk-check-revision-test-key-1234567890" }, "PUT")
    );
    const targetProse = "Revision refusal checks the harbor arrival prose.";
    await app.request(
      `${scenePath}/body`,
      mutation(
        {
          expectedWorkingVersion: 1,
          document: {
            schemaVersion: 1,
            document: {
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  attrs: { id: "block-check-revision" },
                  content: [{ type: "text", text: targetProse }]
                }
              ]
            }
          }
        },
        "PATCH"
      )
    );
    const submitted = await app.request(
      assignmentPath,
      mutation(checkAssignmentRequest({ idempotencyKey: "check-revision-assignment" }))
    );
    expect(submitted.status).toBe(201);
    const assignment = (await submitted.json()).assignment;
    const initial = await app.request(
      `${assignmentPath}/${assignment.id}/attempts`,
      mutation({
        expectedAssignmentVersion: 1,
        kind: "initial",
        sourceMode: "submitted-snapshot",
        instruction: checkAssignmentRequest().brief,
        idempotencyKey: "check-revision-initial"
      })
    );
    expect(initial.status).toBe(201);
    const initialBody = await initial.json();
    const revision = await app.request(
      `${assignmentPath}/${assignment.id}/attempts`,
      mutation({
        expectedAssignmentVersion: initialBody.state.assignment.version,
        kind: "revision",
        sourceMode: "latest-authorized",
        instruction: "Recheck with a revision attempt.",
        priorArtifact: initialBody.state.assignment.currentArtifact,
        idempotencyKey: "check-revision-attempt"
      })
    );
    expect(revision.status).toBe(422);
    await expect(revision.json()).resolves.toMatchObject({
      code: "INVALID_AGENT_POLICY"
    });

    const foreign = await createSeededBackendApp(
      fakeBackendAuth({
        account: {
          id: "account-check-foreign",
          name: "Foreign Writer",
          email: "foreign-check@example.test",
          emailVerified: true
        },
        session: {
          id: "session-check-foreign",
          expiresAt: "2099-07-18T19:00:00.000Z"
        }
      })
    );
    const foreignDetail = await foreign.app.request(`${assignmentPath}/${assignment.id}`);
    expect(foreignDetail.status).toBe(404);
    await expect(foreignDetail.json()).resolves.toMatchObject({
      code: "STORY_WORK_ASSIGNMENT_NOT_FOUND"
    });
  });

  it("lists reviewed check assignments and supports deferred then reopen resolution", async () => {
    const provider = createFakeStructuredCompletionProvider((input) => ({
      output: hermeticCheckCandidateOutput(input.inputText)
    }));
    const { app } = await createSeededBackendApp(undefined, {
      kekConfig: createTestProviderKekRuntimeConfig(),
      openAiCompletionProviderFactory: () => provider
    });
    const scenePath =
      `/api/projects/${BELLWETHER_FIXTURE_PROJECT_ID}/scenes/${selectedSceneId}`;
    await app.request(`${scenePath}/workspace`);
    await app.request(`${scenePath}/lease`, {
      method: "POST",
      headers: { origin: TEST_BACKEND_ORIGIN }
    });
    await app.request(
      `${scenePath}/body`,
      mutation(
        {
          expectedWorkingVersion: 1,
          document: {
            schemaVersion: 1,
            document: {
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  attrs: { id: "block-check-reviewed" },
                  content: [{ type: "text", text: "Reviewed list checks harbor continuity prose." }]
                }
              ]
            }
          }
        },
        "PATCH"
      )
    );
    await app.request(
      "/api/me/provider/openai",
      mutation({ apiKey: "sk-check-reviewed-test-key-1234567890" }, "PUT")
    );
    const submitted = await app.request(
      assignmentPath,
      mutation(checkAssignmentRequest({ idempotencyKey: "check-reviewed-assignment" }))
    );
    expect(submitted.status).toBe(201);
    const assignment = (await submitted.json()).assignment;
    const generated = await app.request(
      `${assignmentPath}/${assignment.id}/attempts`,
      mutation({
        expectedAssignmentVersion: 1,
        kind: "initial",
        sourceMode: "submitted-snapshot",
        instruction: checkAssignmentRequest().brief,
        idempotencyKey: "check-reviewed-attempt"
      })
    );
    expect(generated.status).toBe(201);
    const generatedBody = await generated.json();
    const artifact = generatedBody.state.assignment.currentArtifact;
    const opened = await app.request(
      `${assignmentPath}/${assignment.id}/review/open`,
      mutation({
        expectedAssignmentVersion: generatedBody.state.assignment.version,
        artifact
      })
    );
    const openedBody = await opened.json();
    const findingId = openedBody.proposal.payload.findings[0]?.id as string;
    const deferred = await app.request(
      `${assignmentPath}/${assignment.id}/review/findings/${findingId}`,
      mutation(
        {
          expectedAssignmentVersion: openedBody.assignment.version,
          artifact: openedBody.assignment.currentArtifact,
          resolution: { status: "deferred", reason: "Need to reread the harbor beat." }
        },
        "PATCH"
      )
    );
    expect(deferred.status).toBe(200);
    const deferredBody = await deferred.json();
    expect(deferredBody.proposal.payload.findings[0]?.resolution).toMatchObject({
      status: "deferred",
      reason: "Need to reread the harbor beat."
    });
    const reopened = await app.request(
      `${assignmentPath}/${assignment.id}/review/findings/${findingId}`,
      mutation(
        {
          expectedAssignmentVersion: deferredBody.assignment.version,
          artifact: deferredBody.assignment.currentArtifact,
          resolution: { status: "open" }
        },
        "PATCH"
      )
    );
    expect(reopened.status).toBe(200);
    const reopenedBody = await reopened.json();
    expect(reopenedBody.proposal.payload.findings[0]?.resolution).toEqual({ status: "open" });
    const dismissed = await app.request(
      `${assignmentPath}/${assignment.id}/review/findings/${findingId}`,
      mutation(
        {
          expectedAssignmentVersion: reopenedBody.assignment.version,
          artifact: reopenedBody.assignment.currentArtifact,
          resolution: { status: "dismissed" }
        },
        "PATCH"
      )
    );
    const dismissedBody = await dismissed.json();
    const completed = await app.request(
      `${assignmentPath}/${assignment.id}/review/complete`,
      mutation({
        expectedAssignmentVersion: dismissedBody.assignment.version,
        artifact: dismissedBody.assignment.currentArtifact
      })
    );
    expect(completed.status).toBe(200);
    const completedBody = await completed.json();
    expect(completedBody.assignment.status).toBe("reviewed");

    const list = await app.request(`${assignmentPath}?status=reviewed&limit=20`);
    expect(list.status).toBe(200);
    const listBody = await list.json();
    expect(listBody.assignments).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: assignment.id, status: "reviewed" })])
    );
  });

  it("marks applied-scene checks stale on intent drift without another provider call", async () => {
    let providerCalls = 0;
    const provider = createFakeStructuredCompletionProvider((input) => {
      providerCalls += 1;
      return { output: hermeticCheckCandidateOutput(input.inputText) };
    });
    const { app } = await createSeededBackendApp(undefined, {
      kekConfig: createTestProviderKekRuntimeConfig(),
      openAiCompletionProviderFactory: () => provider
    });
    const scenePath =
      `/api/projects/${BELLWETHER_FIXTURE_PROJECT_ID}/scenes/${selectedSceneId}`;
    await app.request(`${scenePath}/workspace`);
    await app.request(`${scenePath}/lease`, {
      method: "POST",
      headers: { origin: TEST_BACKEND_ORIGIN }
    });
    await app.request(
      `${scenePath}/body`,
      mutation(
        {
          expectedWorkingVersion: 1,
          document: {
            schemaVersion: 1,
            document: {
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  attrs: { id: "block-check-intent" },
                  content: [{ type: "text", text: "Intent freshness keeps this harbor prose stable." }]
                }
              ]
            }
          }
        },
        "PATCH"
      )
    );
    await app.request(
      "/api/me/provider/openai",
      mutation({ apiKey: "sk-check-intent-fresh-test-key-123456" }, "PUT")
    );
    const submitted = await app.request(
      assignmentPath,
      mutation(checkAssignmentRequest({ idempotencyKey: "check-intent-assignment" }))
    );
    expect(submitted.status).toBe(201);
    const assignment = (await submitted.json()).assignment;
    const generated = await app.request(
      `${assignmentPath}/${assignment.id}/attempts`,
      mutation({
        expectedAssignmentVersion: 1,
        kind: "initial",
        sourceMode: "submitted-snapshot",
        instruction: checkAssignmentRequest().brief,
        idempotencyKey: "check-intent-attempt"
      })
    );
    expect(generated.status).toBe(201);
    expect(providerCalls).toBe(1);
    const detailFresh = await app.request(`${assignmentPath}/${assignment.id}`);
    const detailFreshBody = await detailFresh.json();
    expect(detailFresh.status, JSON.stringify(detailFreshBody)).toBe(200);
    expect(detailFreshBody.checkFreshness).toEqual({ status: "fresh" });

    const navigator = await app.request(
      `/api/projects/${BELLWETHER_FIXTURE_PROJECT_ID}/navigator`
    );
    const navigatorBody = await navigator.json();
    const intentUpdate = await app.request(
      `/api/projects/${BELLWETHER_FIXTURE_PROJECT_ID}/commands`,
      mutation({
        expectedVersion: navigatorBody.version,
        command: {
          type: "scene.updateIntent",
          sceneId: selectedSceneId,
          patch: { purpose: "Intent-only drift for check freshness." }
        }
      })
    );
    expect(intentUpdate.status).toBe(200);

    const detailStale = await app.request(`${assignmentPath}/${assignment.id}`);
    const staleBody = await detailStale.json();
    expect(staleBody.checkFreshness).toMatchObject({ status: "needs-recheck" });
    expect(staleBody.checkFreshness.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          dependencyKey: `scene-intent:${selectedSceneId}`,
          reason: "scene-intent-changed"
        })
      ])
    );
    expect(providerCalls).toBe(1);
  });

  it("checks a new-scene proposal target absent from the manuscript", async () => {
    const provider = createFakeStructuredCompletionProvider((input) => ({
      output:
        input.outputSchema.name === "story_check_findings_candidates_v1"
          ? hermeticCheckCandidateOutput(input.inputText)
          : {
              schemaId: "scene-draft-v1",
              prose: "Draft harbor prose for a scene not yet in the manuscript.",
              sourceSceneIds: []
            }
    }));
    const { app } = await createSeededBackendApp(undefined, {
      kekConfig: createTestProviderKekRuntimeConfig(),
      openAiCompletionProviderFactory: () => provider
    });
    await app.request(
      "/api/me/provider/openai",
      mutation({ apiKey: "sk-check-new-scene-proposal-key-123456789" }, "PUT")
    );
    const navigatorBefore = await app.request(
      `/api/projects/${BELLWETHER_FIXTURE_PROJECT_ID}/navigator`
    );
    const scenesBefore = (await navigatorBefore.json()).totals.scenes as number;

    const sceneSubmitted = await app.request(
      assignmentPath,
      mutation(
        assignmentRequest({
          taskKind: "scene",
          idempotencyKey: "check-new-scene-source-assignment",
          brief: "Draft a new harbor scene for proposal checking.",
          sceneIds: []
        })
      )
    );
    expect(sceneSubmitted.status).toBe(201);
    const sceneAssignment = (await sceneSubmitted.json()).assignment;
    const reservedSceneId = sceneAssignment.destination.sceneId as string;
    expect(sceneAssignment.destination).toMatchObject({ operation: "create" });

    const sceneGenerated = await app.request(
      `${assignmentPath}/${sceneAssignment.id}/attempts`,
      mutation({
        expectedAssignmentVersion: 1,
        kind: "initial",
        sourceMode: "submitted-snapshot",
        instruction: "Draft a new harbor scene for proposal checking.",
        idempotencyKey: "check-new-scene-source-attempt"
      })
    );
    expect(sceneGenerated.status).toBe(201);
    const sceneGeneratedBody = await sceneGenerated.json();
    const sourceArtifact = sceneGeneratedBody.state.assignment.currentArtifact;

    const checkSubmitted = await app.request(
      assignmentPath,
      mutation(
        checkAssignmentRequest({
          checkMode: "proposal-draft",
          targetSceneId: reservedSceneId,
          idempotencyKey: "check-new-scene-proposal-assignment",
          sourceAssignmentId: sceneAssignment.id,
          sourceArtifact
        })
      )
    );
    expect(checkSubmitted.status).toBe(201);
    const checkAssignment = (await checkSubmitted.json()).assignment;
    expect(checkAssignment.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "proposal-artifact",
          sceneId: reservedSceneId,
          contentHash: sceneGeneratedBody.state.proposal.contentHash
        })
      ])
    );

    const checkGenerated = await app.request(
      `${assignmentPath}/${checkAssignment.id}/attempts`,
      mutation({
        expectedAssignmentVersion: 1,
        kind: "initial",
        sourceMode: "submitted-snapshot",
        instruction: checkAssignmentRequest().brief,
        idempotencyKey: "check-new-scene-proposal-attempt"
      })
    );
    const checkGeneratedBody = await checkGenerated.json();
    expect(checkGenerated.status, JSON.stringify(checkGeneratedBody)).toBe(201);
    expect(checkGeneratedBody.kind).toBe("ready");
    const opened = await app.request(
      `${assignmentPath}/${checkAssignment.id}/review/open`,
      mutation({
        expectedAssignmentVersion: checkGeneratedBody.state.assignment.version,
        artifact: checkGeneratedBody.state.assignment.currentArtifact
      })
    );
    expect(opened.status).toBe(200);

    const checkDetail = await app.request(`${assignmentPath}/${checkAssignment.id}`);
    const checkDetailBody = await checkDetail.json();
    expect(checkDetailBody.receipt.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ resourceClass: "proposal-artifact", sceneId: reservedSceneId })
      ])
    );
    expect(checkDetailBody.checkFreshness).toEqual({ status: "fresh" });

    const navigatorAfter = await app.request(
      `/api/projects/${BELLWETHER_FIXTURE_PROJECT_ID}/navigator`
    );
    expect((await navigatorAfter.json()).totals.scenes).toBe(scenesBefore);
  });

  it("refuses stale check review complete while resolve remains allowed", async () => {
    let providerCalls = 0;
    const provider = createFakeStructuredCompletionProvider((input) => {
      providerCalls += 1;
      return { output: hermeticCheckCandidateOutput(input.inputText) };
    });
    const { app } = await createSeededBackendApp(undefined, {
      kekConfig: createTestProviderKekRuntimeConfig(),
      openAiCompletionProviderFactory: () => provider
    });
    const scenePath =
      `/api/projects/${BELLWETHER_FIXTURE_PROJECT_ID}/scenes/${selectedSceneId}`;
    await app.request(`${scenePath}/workspace`);
    await app.request(`${scenePath}/lease`, {
      method: "POST",
      headers: { origin: TEST_BACKEND_ORIGIN }
    });
    const targetProse = "Complete refusal keeps this harbor prose stable.";
    await app.request(
      `${scenePath}/body`,
      mutation(
        {
          expectedWorkingVersion: 1,
          document: {
            schemaVersion: 1,
            document: {
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  attrs: { id: "block-check-complete-stale" },
                  content: [{ type: "text", text: targetProse }]
                }
              ]
            }
          }
        },
        "PATCH"
      )
    );
    await app.request(
      "/api/me/provider/openai",
      mutation({ apiKey: "sk-check-complete-stale-test-key-123456" }, "PUT")
    );
    const submitted = await app.request(
      assignmentPath,
      mutation(checkAssignmentRequest({ idempotencyKey: "check-complete-stale-assignment" }))
    );
    expect(submitted.status).toBe(201);
    const assignment = (await submitted.json()).assignment;
    const generated = await app.request(
      `${assignmentPath}/${assignment.id}/attempts`,
      mutation({
        expectedAssignmentVersion: 1,
        kind: "initial",
        sourceMode: "submitted-snapshot",
        instruction: checkAssignmentRequest().brief,
        idempotencyKey: "check-complete-stale-attempt"
      })
    );
    expect(generated.status).toBe(201);
    expect(providerCalls).toBe(1);
    const generatedBody = await generated.json();
    const artifact = generatedBody.state.assignment.currentArtifact;
    const opened = await app.request(
      `${assignmentPath}/${assignment.id}/review/open`,
      mutation({
        expectedAssignmentVersion: generatedBody.state.assignment.version,
        artifact
      })
    );
    const openedBody = await opened.json();
    expect(openedBody.assignment.status).toBe("awaiting-review");
    const findingId = openedBody.proposal.payload.findings[0]?.id as string;

    const savedAgain = await app.request(
      `${scenePath}/body`,
      mutation(
        {
          expectedWorkingVersion: 2,
          document: {
            schemaVersion: 1,
            document: {
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  attrs: { id: "block-check-complete-stale" },
                  content: [{ type: "text", text: `${targetProse} Fog closed in.` }]
                }
              ]
            }
          }
        },
        "PATCH"
      )
    );
    expect(savedAgain.status).toBe(200);

    const staleComplete = await app.request(
      `${assignmentPath}/${assignment.id}/review/complete`,
      mutation({
        expectedAssignmentVersion: openedBody.assignment.version,
        artifact: openedBody.assignment.currentArtifact
      })
    );
    expect(staleComplete.status).toBe(409);
    await expect(staleComplete.json()).resolves.toMatchObject({
      code: "STORY_CHECK_STALE"
    });

    const resolveWhileStale = await app.request(
      `${assignmentPath}/${assignment.id}/review/findings/${findingId}`,
      mutation(
        {
          expectedAssignmentVersion: openedBody.assignment.version,
          artifact: openedBody.assignment.currentArtifact,
          resolution: { status: "dismissed" }
        },
        "PATCH"
      )
    );
    expect(resolveWhileStale.status).toBe(200);

    const detail = await app.request(`${assignmentPath}/${assignment.id}`);
    const detailBody = await detail.json();
    expect(detailBody.assignment.status).toBe("awaiting-review");
    expect(detailBody.checkFreshness.status).toBe("needs-recheck");
    expect(providerCalls).toBe(1);
  });

  it("submits outline work, generates structure, previews, reviews, and applies atomically", async () => {
    let providerCalls = 0;
    const provider = createFakeStructuredCompletionProvider((input) => {
      providerCalls += 1;
      return { output: hermeticStructureCandidateOutput(input.inputText) };
    });
    const { app } = await createSeededBackendApp(undefined, {
      kekConfig: createTestProviderKekRuntimeConfig(),
      openAiCompletionProviderFactory: () => provider
    });
    const scenePath =
      `/api/projects/${BELLWETHER_FIXTURE_PROJECT_ID}/scenes/${selectedSceneId}`;
    expect((await app.request(`${scenePath}/workspace`)).status).toBe(200);
    expect(
      (
        await app.request(`${scenePath}/lease`, {
          method: "POST",
          headers: { origin: TEST_BACKEND_ORIGIN }
        })
      ).status
    ).toBe(200);
    expect(
      (
        await app.request(
          "/api/me/provider/openai",
          mutation({ apiKey: "sk-outline-story-work-test-key-123456789" }, "PUT")
        )
      ).status
    ).toBe(200);

    const submitted = await app.request(
      assignmentPath,
      mutation(outlineAssignmentRequest({ idempotencyKey: "outline-route-assignment" }))
    );
    expect(submitted.status).toBe(201);
    const submittedBody = await submitted.json();
    expect(submittedBody.assignment).toMatchObject({
      taskKind: "outline",
      brief: "  Develop a three-chapter outline for the active book.  ",
      destination: { kind: "book", bookId: signalBookId, operation: "update" },
      steps: [{ id: "structure" }]
    });
    expect(submittedBody.assignment.sources).toEqual(
      expect.arrayContaining([
        { kind: "book", bookId: signalBookId, projectVersion: 1 },
        expect.objectContaining({ kind: "scene", sceneId: selectedSceneId })
      ])
    );

    const generated = await app.request(
      `${assignmentPath}/${submittedBody.assignment.id}/attempts`,
      mutation({
        expectedAssignmentVersion: 1,
        kind: "initial",
        sourceMode: "submitted-snapshot",
        instruction: outlineAssignmentRequest().brief,
        idempotencyKey: "outline-route-attempt"
      })
    );
    const generatedBody = await generated.json();
    expect(generated.status, JSON.stringify(generatedBody)).toBe(201);
    expect(providerCalls).toBe(1);
    expect(generatedBody.state.proposal.outputSchemaId).toBe(STORY_STRUCTURE_SCHEMA_ID);
    expect(generatedBody.state.proposal.id).toMatch(/^agentProposal-/);
    const operationIds = generatedBody.state.proposal.payload.operations.map(
      (operation: { operationId: string }) => operation.operationId
    );
    expect(operationIds.length).toBeGreaterThan(0);
    expect(JSON.stringify(generatedBody.state.proposal.payload)).not.toContain("prose");

    const replay = await app.request(
      `${assignmentPath}/${submittedBody.assignment.id}/attempts`,
      mutation({
        expectedAssignmentVersion: generatedBody.state.assignment.version,
        kind: "initial",
        sourceMode: "submitted-snapshot",
        instruction: outlineAssignmentRequest().brief,
        idempotencyKey: "outline-route-attempt"
      })
    );
    expect(replay.status).toBe(200);
    expect(providerCalls).toBe(1);

    const opened = await app.request(
      `${assignmentPath}/${submittedBody.assignment.id}/review/open`,
      mutation({
        expectedAssignmentVersion: generatedBody.state.assignment.version,
        artifact: generatedBody.state.assignment.currentArtifact
      })
    );
    expect(opened.status).toBe(200);
    const openedBody = await opened.json();
    const editedPayload = {
      ...openedBody.proposal.payload,
      operations: openedBody.proposal.payload.operations.map(
        (operation: { type: string; title?: string; operationId: string }) =>
          operation.type === "chapter.create"
            ? { ...operation, title: "Chapter One (edited)" }
            : operation
      )
    };
    const edited = await app.request(
      `${assignmentPath}/${submittedBody.assignment.id}/review`,
      mutation(
        {
          expectedAssignmentVersion: openedBody.assignment.version,
          artifact: openedBody.assignment.currentArtifact,
          payload: editedPayload
        },
        "PATCH"
      )
    );
    expect(edited.status).toBe(200);
    const editedBody = await edited.json();
    expect(editedBody.proposal.contentHash).not.toBe(openedBody.proposal.contentHash);

    const tampered = await app.request(
      `${assignmentPath}/${submittedBody.assignment.id}/review`,
      mutation(
        {
          expectedAssignmentVersion: editedBody.assignment.version,
          artifact: editedBody.assignment.currentArtifact,
          payload: {
            ...editedBody.proposal.payload,
            expectedProjectVersion: editedBody.proposal.payload.expectedProjectVersion + 1
          }
        },
        "PATCH"
      )
    );
    expect(tampered.status).toBe(409);
    await expect(tampered.json()).resolves.toMatchObject({
      code: "STORY_STRUCTURE_STORY_WORK_ARTIFACT_MISMATCH"
    });

    const partialPreview = await app.request(
      `${assignmentPath}/${submittedBody.assignment.id}/review/preview`,
      mutation({
        expectedAssignmentVersion: editedBody.assignment.version,
        expectedProjectVersion: 1,
        artifact: editedBody.assignment.currentArtifact,
        selectedOperationIds: [operationIds[operationIds.length - 1]!]
      })
    );
    expect(partialPreview.status).toBe(409);
    await expect(partialPreview.json()).resolves.toMatchObject({
      code: "MISSING_REQUIREMENTS"
    });

    const fullPreview = await app.request(
      `${assignmentPath}/${submittedBody.assignment.id}/review/preview`,
      mutation({
        expectedAssignmentVersion: editedBody.assignment.version,
        expectedProjectVersion: 1,
        artifact: editedBody.assignment.currentArtifact,
        selectedOperationIds: operationIds
      })
    );
    expect(fullPreview.status).toBe(200);
    const previewBody = await fullPreview.json();
    expect(previewBody.preview.createdSceneIds.length).toBeGreaterThan(0);

    const workspaceBefore = await app.request(`${scenePath}/workspace`);
    const proseBefore = (await workspaceBefore.json()).document;

    const applied = await app.request(
      `${assignmentPath}/${submittedBody.assignment.id}/apply`,
      mutation({
        expectedAssignmentVersion: editedBody.assignment.version,
        proposalId: editedBody.proposal.id,
        expectedArtifactVersion: editedBody.assignment.currentArtifact.artifactVersion,
        expectedProposalContentHash: editedBody.proposal.contentHash,
        expectedProjectVersion: 1,
        selectedOperationIds: operationIds,
        idempotencyKey: "outline-route-apply"
      })
    );
    expect(applied.status).toBe(200);
    const appliedBody = await applied.json();
    expect(appliedBody.replayed).toBe(false);
    expect(appliedBody.result).toMatchObject({
      kind: "story-structure",
      bookId: signalBookId,
      projectVersion: 2
    });
    expect(appliedBody.result.resolvedOperationIds).toEqual(operationIds);
    expect(appliedBody.result.createdSceneIds).toEqual(previewBody.preview.createdSceneIds);
    const appliedDetail = await app.request(
      `${assignmentPath}/${submittedBody.assignment.id}`
    );
    expect((await appliedDetail.json()).assignment.results).toEqual([appliedBody.result]);
    for (const createdSceneId of appliedBody.result.createdSceneIds) {
      const head = await app.request(
        `/api/projects/${BELLWETHER_FIXTURE_PROJECT_ID}/scenes/${createdSceneId}/workspace`
      );
      expect(head.status).toBe(200);
    }

    const replayApply = await app.request(
      `${assignmentPath}/${submittedBody.assignment.id}/apply`,
      mutation({
        expectedAssignmentVersion: editedBody.assignment.version,
        proposalId: editedBody.proposal.id,
        expectedArtifactVersion: editedBody.assignment.currentArtifact.artifactVersion,
        expectedProposalContentHash: editedBody.proposal.contentHash,
        expectedProjectVersion: 1,
        selectedOperationIds: operationIds,
        idempotencyKey: "outline-route-apply"
      })
    );
    expect(replayApply.status).toBe(200);
    const replayApplyBody = await replayApply.json();
    expect(replayApplyBody.replayed).toBe(true);
    expect(replayApplyBody.result).toEqual(appliedBody.result);

    const workspaceAfter = await app.request(`${scenePath}/workspace`);
    expect((await workspaceAfter.json()).document).toEqual(proseBefore);
  });

  it("refuses archived-book outline submit and hides assignments from foreign owners", async () => {
    const { app } = await withOutlineHermeticApp();
    const archived = await app.request(
      `/api/projects/${BELLWETHER_FIXTURE_PROJECT_ID}/commands`,
      mutation({
        expectedVersion: 1,
        command: { type: "book.setArchived", bookId: signalBookId, archived: true }
      })
    );
    expect(archived.status).toBe(200);
    const refused = await app.request(
      assignmentPath,
      mutation(
        outlineAssignmentRequest({
          idempotencyKey: "outline-archived-book",
          sceneIds: [],
          expectedProjectVersion: 2
        })
      )
    );
    expect(refused.status).toBe(422);

    await app.request(
      `/api/projects/${BELLWETHER_FIXTURE_PROJECT_ID}/commands`,
      mutation({
        expectedVersion: 2,
        command: { type: "book.setArchived", bookId: signalBookId, archived: false }
      })
    );

    const { app: ownerApp, providerCalls } = await withOutlineHermeticApp();
    await prepareBellwetherSceneHead(ownerApp);
    const submitted = await ownerApp.request(
      assignmentPath,
      mutation(outlineAssignmentRequest({ idempotencyKey: "outline-foreign-hide" }))
    );
    expect(submitted.status).toBe(201);
    const assignmentId = (await submitted.json()).assignment.id as string;
    expect(providerCalls()).toBe(0);

    const foreign = await createSeededBackendApp(
      fakeBackendAuth({
        account: {
          id: "account-outline-foreign",
          name: "Foreign Writer",
          email: "foreign-outline@example.test",
          emailVerified: true
        },
        session: {
          id: "session-outline-foreign",
          expiresAt: "2099-07-18T19:00:00.000Z"
        }
      })
    );
    const foreignDetail = await foreign.app.request(`${assignmentPath}/${assignmentId}`);
    expect(foreignDetail.status).toBe(404);
    await expect(foreignDetail.json()).resolves.toMatchObject({
      code: "STORY_WORK_ASSIGNMENT_NOT_FOUND"
    });
  });

  it("rejects outline revision attempts before provider access", async () => {
    const { app, providerCalls } = await withOutlineHermeticApp();
    const { generatedBody, assignmentId } = await outlineThroughReviewOpen(app, {
      assignmentKey: "outline-revision-assignment",
      attemptKey: "outline-revision-initial"
    });
    expect(providerCalls()).toBe(1);
    const revision = await app.request(
      `${assignmentPath}/${assignmentId}/attempts`,
      mutation({
        expectedAssignmentVersion: generatedBody.state.assignment.version,
        kind: "revision",
        sourceMode: "latest-authorized",
        instruction: "Refresh the outline from latest sources.",
        priorArtifact: generatedBody.state.assignment.currentArtifact,
        idempotencyKey: "outline-revision-attempt"
      })
    );
    expect(revision.status).toBe(422);
    await expect(revision.json()).resolves.toMatchObject({
      code: "INVALID_AGENT_POLICY"
    });
    expect(providerCalls()).toBe(1);
  });

  it("rejects structure review without changing canonical project records", async () => {
    const { app } = await withOutlineHermeticApp();
    const navigatorBefore = await app.request(
      `/api/projects/${BELLWETHER_FIXTURE_PROJECT_ID}/navigator`
    );
    const beforeBody = await navigatorBefore.json();
    const { openedBody, assignmentId } = await outlineThroughReviewOpen(app, {
      assignmentKey: "outline-reject-assignment",
      attemptKey: "outline-reject-attempt"
    });
    const rejected = await app.request(
      `${assignmentPath}/${assignmentId}/review/reject`,
      mutation({
        expectedAssignmentVersion: openedBody.assignment.version,
        artifact: openedBody.assignment.currentArtifact
      })
    );
    expect(rejected.status).toBe(200);
    const rejectedBody = await rejected.json();
    expect(rejectedBody.assignment.status).toBe("rejected");
    const navigatorAfter = await app.request(
      `/api/projects/${BELLWETHER_FIXTURE_PROJECT_ID}/navigator`
    );
    expect(await navigatorAfter.json()).toEqual(beforeBody);
  });

  it("applies optional Canvas placement with exact geometry and spine coverage", async () => {
    const { app } = await withOutlineHermeticApp();
    const navigatorBefore = await app.request(
      `/api/projects/${BELLWETHER_FIXTURE_PROJECT_ID}/navigator`
    );
    const scenesBefore = (await navigatorBefore.json()).totals.scenes as number;
    const canvasBefore = await app.request(canvasPath);
    const canvasBeforeBody = await canvasBefore.json();
    const { openedBody, assignmentId, operationIds, plannedScene } =
      await outlineThroughReviewOpen(app, {
        assignmentKey: "outline-canvas-assignment",
        attemptKey: "outline-canvas-attempt"
      });
    expect(plannedScene?.sceneId).toBeDefined();
    expect(plannedScene?.chapterId).toBeDefined();
    const applied = await app.request(
      `${assignmentPath}/${assignmentId}/apply`,
      mutation({
        expectedAssignmentVersion: openedBody.assignment.version,
        proposalId: openedBody.proposal.id,
        expectedArtifactVersion: openedBody.assignment.currentArtifact.artifactVersion,
        expectedProposalContentHash: openedBody.proposal.contentHash,
        expectedProjectVersion: 1,
        selectedOperationIds: operationIds,
        idempotencyKey: "outline-canvas-apply",
        canvas: {
          expectedCanvasVersion: canvasBeforeBody.board.version,
          sceneId: plannedScene!.sceneId,
          scope: { scopeKind: "chapter", scopeId: plannedScene!.chapterId! },
          x: 120,
          y: 80,
          width: 240,
          height: 160,
          z: 2
        }
      })
    );
    expect(applied.status).toBe(200);
    const appliedBody = await applied.json();
    expect(appliedBody.result).toMatchObject({
      kind: "story-structure",
      bookId: signalBookId,
      projectVersion: 2,
      resolvedOperationIds: operationIds,
      canvasPlacedSceneId: plannedScene!.sceneId
    });
    expect(appliedBody.result.createdSceneIds.length).toBeGreaterThan(0);
    expect(appliedBody.result.canvasObjectId).toMatch(/^canvasObject-/);
    const appliedDetail = await app.request(`${assignmentPath}/${assignmentId}`);
    expect((await appliedDetail.json()).assignment.results).toEqual([appliedBody.result]);
    const canvasAfter = await app.request(canvasPath);
    const canvasAfterBody = await canvasAfter.json();
    expect(canvasAfterBody.board.version).toBe(canvasBeforeBody.board.version + 1);
    const card = canvasAfterBody.board.objects.find(
      (object: { kind: string; sceneId?: string }) =>
        object.kind === "scene-card" && object.sceneId === plannedScene!.sceneId
    );
    expect(card).toMatchObject({
      id: appliedBody.result.canvasObjectId,
      x: 120,
      y: 80,
      width: 240,
      height: 160,
      z: 2
    });
    expect(canvasAfterBody.spine.entries.map((entry: { sceneId: string }) => entry.sceneId)).toEqual(
      expect.arrayContaining(appliedBody.result.createdSceneIds)
    );
    const navigatorAfter = await app.request(
      `/api/projects/${BELLWETHER_FIXTURE_PROJECT_ID}/navigator`
    );
    expect((await navigatorAfter.json()).totals.scenes).toBe(
      scenesBefore + appliedBody.result.createdSceneIds.length
    );
  });

  it("rolls back stale Canvas structure apply without mutation", async () => {
    const { app } = await withOutlineHermeticApp();
    const { openedBody, assignmentId, operationIds, plannedScene } =
      await outlineThroughReviewOpen(app, {
        assignmentKey: "outline-stale-canvas-assignment",
        attemptKey: "outline-stale-canvas-attempt"
      });
    const canvasBefore = await app.request(canvasPath);
    const canvasVersion = (await canvasBefore.json()).board.version;
    const navigatorBefore = await app.request(
      `/api/projects/${BELLWETHER_FIXTURE_PROJECT_ID}/navigator`
    );
    const navigatorVersion = (await navigatorBefore.json()).version;
    const staleApply = await app.request(
      `${assignmentPath}/${assignmentId}/apply`,
      mutation({
        expectedAssignmentVersion: openedBody.assignment.version,
        proposalId: openedBody.proposal.id,
        expectedArtifactVersion: openedBody.assignment.currentArtifact.artifactVersion,
        expectedProposalContentHash: openedBody.proposal.contentHash,
        expectedProjectVersion: 1,
        selectedOperationIds: operationIds,
        idempotencyKey: "outline-stale-canvas-apply",
        canvas: {
          expectedCanvasVersion: canvasVersion + 1,
          sceneId: plannedScene!.sceneId,
          scope: { scopeKind: "chapter", scopeId: plannedScene!.chapterId! },
          x: 120,
          y: 80,
          width: 240,
          height: 160,
          z: 2
        }
      })
    );
    expect(staleApply.status).toBe(409);
    await expect(staleApply.json()).resolves.toMatchObject({
      code: "CANVAS_VERSION_CONFLICT"
    });
    const canvasAfter = await app.request(canvasPath);
    expect((await canvasAfter.json()).board.version).toBe(canvasVersion);
    const navigatorAfter = await app.request(
      `/api/projects/${BELLWETHER_FIXTURE_PROJECT_ID}/navigator`
    );
    expect((await navigatorAfter.json()).version).toBe(navigatorVersion);
    const detail = await app.request(`${assignmentPath}/${assignmentId}`);
    expect((await detail.json()).assignment.status).toBe("awaiting-review");
  });

  it("refuses stale project structure apply after metadata rename", async () => {
    const { app } = await withOutlineHermeticApp();
    const { openedBody, assignmentId, operationIds } = await outlineThroughReviewOpen(app, {
      assignmentKey: "outline-stale-project-assignment",
      attemptKey: "outline-stale-project-attempt"
    });
    const renamed = await app.request(
      `/api/projects/${BELLWETHER_FIXTURE_PROJECT_ID}/commands`,
      mutation({
        expectedVersion: 1,
        command: { type: "project.rename", title: "Bellwether after outline stale apply" }
      })
    );
    expect(renamed.status).toBe(200);
    const navigatorBeforeApply = await app.request(
      `/api/projects/${BELLWETHER_FIXTURE_PROJECT_ID}/navigator`
    );
    const beforeApplyBody = await navigatorBeforeApply.json();
    const staleApply = await app.request(
      `${assignmentPath}/${assignmentId}/apply`,
      mutation({
        expectedAssignmentVersion: openedBody.assignment.version,
        proposalId: openedBody.proposal.id,
        expectedArtifactVersion: openedBody.assignment.currentArtifact.artifactVersion,
        expectedProposalContentHash: openedBody.proposal.contentHash,
        expectedProjectVersion: 1,
        selectedOperationIds: operationIds,
        idempotencyKey: "outline-stale-project-apply"
      })
    );
    expect(staleApply.status).toBe(409);
    await expect(staleApply.json()).resolves.toMatchObject({
      code: "PROJECT_VERSION_CONFLICT"
    });
    const navigatorAfter = await app.request(
      `/api/projects/${BELLWETHER_FIXTURE_PROJECT_ID}/navigator`
    );
    expect(await navigatorAfter.json()).toEqual(beforeApplyBody);
  });

  it("preview flags newly stale manuscript-slice checks without a provider rerun", async () => {
    let providerCalls = 0;
    const provider = createFakeStructuredCompletionProvider((input) => {
      providerCalls += 1;
      if (input.outputSchema.name === "story_structure_proposal_candidates_v1") {
        return { output: hermeticStructureCandidateOutput(input.inputText) };
      }
      return { output: hermeticCheckCandidateOutput(input.inputText) };
    });
    const { app } = await createSeededBackendApp(undefined, {
      kekConfig: createTestProviderKekRuntimeConfig(),
      openAiCompletionProviderFactory: () => provider
    });
    const scenePath =
      `/api/projects/${BELLWETHER_FIXTURE_PROJECT_ID}/scenes/${selectedSceneId}`;
    await app.request(`${scenePath}/workspace`);
    await app.request(`${scenePath}/lease`, {
      method: "POST",
      headers: { origin: TEST_BACKEND_ORIGIN }
    });
    const contextScenePath =
      `/api/projects/${BELLWETHER_FIXTURE_PROJECT_ID}/scenes/${crossChapterContextSceneId}`;
    await app.request(`${contextScenePath}/workspace`);
    await app.request(`${contextScenePath}/lease`, {
      method: "POST",
      headers: { origin: TEST_BACKEND_ORIGIN }
    });
    await app.request(
      "/api/me/provider/openai",
      mutation({ apiKey: "sk-outline-preview-check-key-1234567890" }, "PUT")
    );
    const checkSubmitted = await app.request(
      assignmentPath,
      mutation(
        checkAssignmentRequest({
          idempotencyKey: "outline-preview-check-assignment",
          sceneIds: [crossChapterContextSceneId]
        })
      )
    );
    expect(checkSubmitted.status).toBe(201);
    const checkAssignment = (await checkSubmitted.json()).assignment;
    const checkGenerated = await app.request(
      `${assignmentPath}/${checkAssignment.id}/attempts`,
      mutation({
        expectedAssignmentVersion: 1,
        kind: "initial",
        sourceMode: "submitted-snapshot",
        instruction: checkAssignmentRequest().brief,
        idempotencyKey: "outline-preview-check-attempt"
      })
    );
    expect(checkGenerated.status).toBe(201);
    const checkGeneratedBody = await checkGenerated.json();
    const checkOpened = await app.request(
      `${assignmentPath}/${checkAssignment.id}/review/open`,
      mutation({
        expectedAssignmentVersion: checkGeneratedBody.state.assignment.version,
        artifact: checkGeneratedBody.state.assignment.currentArtifact
      })
    );
    const checkOpenedBody = await checkOpened.json();
    const findingId = checkOpenedBody.proposal.payload.findings[0]?.id as string;
    const dismissed = await app.request(
      `${assignmentPath}/${checkAssignment.id}/review/findings/${findingId}`,
      mutation(
        {
          expectedAssignmentVersion: checkOpenedBody.assignment.version,
          artifact: checkOpenedBody.assignment.currentArtifact,
          resolution: { status: "dismissed" }
        },
        "PATCH"
      )
    );
    expect(dismissed.status).toBe(200);
    const dismissedBody = await dismissed.json();
    const completed = await app.request(
      `${assignmentPath}/${checkAssignment.id}/review/complete`,
      mutation({
        expectedAssignmentVersion: dismissedBody.assignment.version,
        artifact: dismissedBody.assignment.currentArtifact
      })
    );
    expect(completed.status).toBe(200);
    const completedBody = await completed.json();
    expect(
      completedBody.proposal.payload.revisionVector.dependencies.some(
        (dependency: { kind: string; scope?: { kind: string } }) =>
          dependency.kind === "manuscript-slice" && dependency.scope?.kind === "project"
      )
    ).toBe(true);
    expect(providerCalls).toBe(1);

    const { openedBody, assignmentId, operationIds } = await outlineThroughReviewOpen(
      app,
      {
        assignmentKey: "outline-preview-stale-assignment",
        attemptKey: "outline-preview-stale-attempt"
      },
      { skipProviderKey: true }
    );
    expect(providerCalls).toBe(2);
    const preview = await app.request(
      `${assignmentPath}/${assignmentId}/review/preview`,
      mutation({
        expectedAssignmentVersion: openedBody.assignment.version,
        expectedProjectVersion: 1,
        artifact: openedBody.assignment.currentArtifact,
        selectedOperationIds: operationIds
      })
    );
    expect(preview.status).toBe(200);
    const previewBody = await preview.json();
    expect(
      previewBody.preview.newlyStaleChecks.map(
        (entry: { assignmentId: string }) => entry.assignmentId
      )
    ).toContain(checkAssignment.id);
    expect(providerCalls).toBe(2);
  });

  it("replays exact structure apply after project and Canvas drift and refuses idempotency body conflicts", async () => {
    const { app } = await withOutlineHermeticApp();
    const { openedBody, assignmentId, operationIds } = await outlineThroughReviewOpen(app, {
      assignmentKey: "outline-replay-drift-assignment",
      attemptKey: "outline-replay-drift-attempt"
    });
    const firstApply = await app.request(
      `${assignmentPath}/${assignmentId}/apply`,
      mutation({
        expectedAssignmentVersion: openedBody.assignment.version,
        proposalId: openedBody.proposal.id,
        expectedArtifactVersion: openedBody.assignment.currentArtifact.artifactVersion,
        expectedProposalContentHash: openedBody.proposal.contentHash,
        expectedProjectVersion: 1,
        selectedOperationIds: operationIds,
        idempotencyKey: "outline-replay-drift-apply"
      })
    );
    expect(firstApply.status).toBe(200);
    const firstApplyBody = await firstApply.json();
    expect(firstApplyBody.replayed).toBe(false);
    expect(firstApplyBody.result).toMatchObject({
      kind: "story-structure",
      bookId: signalBookId,
      projectVersion: 2
    });
    expect(firstApplyBody.result.resolvedOperationIds).toEqual(operationIds);
    expect(firstApplyBody.result.createdSceneIds.length).toBeGreaterThan(0);

    await app.request(
      `/api/projects/${BELLWETHER_FIXTURE_PROJECT_ID}/commands`,
      mutation({
        expectedVersion: 2,
        command: { type: "project.rename", title: "Bellwether after structure apply" }
      })
    );
    const canvasForDrift = await app.request(canvasPath);
    const canvasForDriftBody = await canvasForDrift.json();
    await app.request(
      `${canvasPath}/commands`,
      mutation({
        expectedCanvasVersion: canvasForDriftBody.board.version,
        command: {
          type: "canvas.object.create",
          object: {
            kind: "note",
            x: 12,
            y: 24,
            width: 180,
            height: 120,
            z: 1,
            authority: "confirmed",
            label: "Drift marker",
            note: { body: "Drift marker" }
          }
        }
      })
    );

    const replayApply = await app.request(
      `${assignmentPath}/${assignmentId}/apply`,
      mutation({
        expectedAssignmentVersion: openedBody.assignment.version,
        proposalId: openedBody.proposal.id,
        expectedArtifactVersion: openedBody.assignment.currentArtifact.artifactVersion,
        expectedProposalContentHash: openedBody.proposal.contentHash,
        expectedProjectVersion: 1,
        selectedOperationIds: operationIds,
        idempotencyKey: "outline-replay-drift-apply"
      })
    );
    expect(replayApply.status).toBe(200);
    const replayApplyBody = await replayApply.json();
    expect(replayApplyBody.replayed).toBe(true);
    expect(replayApplyBody.result).toEqual(firstApplyBody.result);
    const replayDetail = await app.request(`${assignmentPath}/${assignmentId}`);
    expect((await replayDetail.json()).assignment.results).toEqual([firstApplyBody.result]);

    const conflictApply = await app.request(
      `${assignmentPath}/${assignmentId}/apply`,
      mutation({
        expectedAssignmentVersion: openedBody.assignment.version,
        proposalId: openedBody.proposal.id,
        expectedArtifactVersion: openedBody.assignment.currentArtifact.artifactVersion,
        expectedProposalContentHash: openedBody.proposal.contentHash,
        expectedProjectVersion: 1,
        selectedOperationIds: [operationIds[0]!],
        idempotencyKey: "outline-replay-drift-apply"
      })
    );
    expect(conflictApply.status).toBe(409);
    await expect(conflictApply.json()).resolves.toMatchObject({
      code: "STORY_WORK_APPLY_IDEMPOTENCY_CONFLICT"
    });
  });

  it("leaves plan-outline persistence separate from outline story work", async () => {
    const { app } = await createSeededBackendApp();
    const saved = await app.request(
      `/api/projects/${BELLWETHER_FIXTURE_PROJECT_ID}/agent/plan-outlines`,
      mutation({
        outlineText: "## Act II\n- Mara chooses the harbor.",
        model: "gpt-4.1"
      })
    );
    expect(saved.status).toBe(201);
    const savedBody = await saved.json();
    expect(savedBody.proposal.outputSchemaId).toBe("plan-outline-v1");
    expect(savedBody.proposal.payload.schemaId).toBe("plan-outline-v1");
    const renamed = await app.request(
      `/api/projects/${BELLWETHER_FIXTURE_PROJECT_ID}/commands`,
      mutation({
        expectedVersion: 1,
        command: { type: "project.rename", title: "Bellwether unchanged by plan outline" }
      })
    );
    expect(renamed.status).toBe(200);
  });
});
