import { afterEach, describe, expect, it } from "vitest";
import { createFakeStructuredCompletionProvider } from "@ghostwriter/ai";
import { BELLWETHER_FIXTURE_PROJECT_ID } from "@ghostwriter/core";
import {
  createSeededBackendApp,
  fakeBackendAuth,
  testBackendClosers,
  TEST_BACKEND_ORIGIN
} from "./test-backend-app.js";
import {
  generateCharacterStoryWorkRequestSchema,
  submitCharacterStoryWorkRequestSchema
} from "./story-work-api-contract.js";
import { createTestProviderKekRuntimeConfig } from "./provider-kek-config.js";

const assignmentPath =
  `/api/projects/${BELLWETHER_FIXTURE_PROJECT_ID}/story-work/assignments`;
const selectedSceneId = "scene-arrival-at-bellwether";

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
});
