import { describe, expect, it } from "vitest";
import {
  instructionContentHash,
  projectId,
  sceneId,
  storyWorkAssignmentId,
  agentProposalId,
  type StoryWorkAssignment,
  type StoryWorkArtifactPointer
} from "@ghostwriter/core";
import { resolveCheckProposalDraftFreshnessContentHash } from "./story-work-check-freshness.js";

const PROJECT = projectId("project-bellwether");
const ACCOUNT = "account-test" as StoryWorkAssignment["initiatorAccountId"];
const SOURCE_ASSIGNMENT_ID = storyWorkAssignmentId("story_work_assignment_source");
const TARGET_SCENE = sceneId("scene-arrival-at-bellwether");
const STORED_HASH = instructionContentHash("a".repeat(64));
const CURRENT_HASH = instructionContentHash("b".repeat(64));

const proposalSource = Object.freeze({
  kind: "proposal-artifact" as const,
  assignmentId: SOURCE_ASSIGNMENT_ID,
  proposalId: agentProposalId("proposal_stored"),
  sceneId: TARGET_SCENE,
  artifactVersion: 1,
  contentHash: STORED_HASH
});

function reviseAssignment(
  currentArtifact: StoryWorkArtifactPointer | undefined
): StoryWorkAssignment {
  return {
    id: SOURCE_ASSIGNMENT_ID,
    projectId: PROJECT,
    initiatorAccountId: ACCOUNT,
    taskKind: "revise",
    status: "artifact-ready",
    version: 2,
    brief: "Revise",
    constraints: "",
    doneWhen: "",
    model: "gpt-4.1",
    provider: "openai",
    destination: Object.freeze({
      kind: "scene" as const,
      operation: "update" as const,
      sceneId: TARGET_SCENE
    }),
    sources: [],
    results: [],
    steps: [],
    idempotencyKey: "idem",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...(currentArtifact === undefined ? {} : { currentArtifact, generatedArtifact: currentArtifact })
  } satisfies StoryWorkAssignment;
}

describe("resolveCheckProposalDraftFreshnessContentHash", () => {
  it("returns the unchanged current artifact hash for the same pointer", async () => {
    const currentArtifact = Object.freeze({
      proposalId: proposalSource.proposalId,
      artifactVersion: proposalSource.artifactVersion,
      contentHash: STORED_HASH
    });
    const hash = await resolveCheckProposalDraftFreshnessContentHash(
      {
        assignments: {
          async get() {
            return reviseAssignment(currentArtifact);
          }
        },
        proposals: {
          async get(id) {
            return {
              id,
              projectId: PROJECT,
              outputSchemaId: "scene-draft-v1",
              contentHash: STORED_HASH
            } as never;
          }
        }
      },
      { accountId: ACCOUNT, projectId: PROJECT, proposalSource }
    );
    expect(hash).toBe(STORED_HASH);
  });

  it("returns the current artifact hash when the source draft was replaced", async () => {
    const currentArtifact = Object.freeze({
      proposalId: agentProposalId("proposal_replacement"),
      artifactVersion: 2,
      contentHash: CURRENT_HASH
    });
    const hash = await resolveCheckProposalDraftFreshnessContentHash(
      {
        assignments: {
          async get() {
            return reviseAssignment(currentArtifact);
          }
        },
        proposals: {
          async get(id) {
            if (id !== currentArtifact.proposalId) return undefined;
            return {
              id,
              projectId: PROJECT,
              outputSchemaId: "scene-draft-v1",
              contentHash: CURRENT_HASH
            } as never;
          }
        }
      },
      { accountId: ACCOUNT, projectId: PROJECT, proposalSource }
    );
    expect(hash).toBe(CURRENT_HASH);
  });

  it("returns undefined when the source assignment has no current artifact", async () => {
    const hash = await resolveCheckProposalDraftFreshnessContentHash(
      {
        assignments: {
          async get() {
            return reviseAssignment(undefined);
          }
        },
        proposals: { async get() { return undefined; } }
      },
      { accountId: ACCOUNT, projectId: PROJECT, proposalSource }
    );
    expect(hash).toBeUndefined();
  });

  it("returns undefined when the current proposal is not a scene draft", async () => {
    const currentArtifact = Object.freeze({
      proposalId: agentProposalId("proposal_wrong_schema"),
      artifactVersion: 1,
      contentHash: CURRENT_HASH
    });
    const hash = await resolveCheckProposalDraftFreshnessContentHash(
      {
        assignments: {
          async get() {
            return reviseAssignment(currentArtifact);
          }
        },
        proposals: {
          async get(id) {
            return {
              id,
              projectId: PROJECT,
              outputSchemaId: "story-check-findings-v1",
              contentHash: CURRENT_HASH
            } as never;
          }
        }
      },
      { accountId: ACCOUNT, projectId: PROJECT, proposalSource }
    );
    expect(hash).toBeUndefined();
  });
});
