import { describe, expect, it } from "vitest";
import {
  accountId,
  BELLWETHER_FIXTURE,
  BELLWETHER_FIXTURE_NAVIGATOR,
  BELLWETHER_FIXTURE_PROJECT_ID,
  createCaptureServices,
  createGhostwriterServices,
  createMemoryCaptureDocumentRepository,
  createMemoryProjectRepository,
  createMemorySceneDocumentRepository,
  createProjectMembership,
  createSceneWritingServices,
  projectId,
  sceneId
} from "@ghostwriter/core";
import {
  WORKSPACE_CHAT_SCENE_READ_MAX_CALLS,
  createWorkspaceChatTools,
  extractProposedWorkPlanFromToolTraces
} from "./workspace-chat-tools.js";

const ACCOUNT = accountId("account-test");
const PROJECT = projectId(BELLWETHER_FIXTURE_PROJECT_ID);
const SCENE_ID = sceneId("scene-arrival-at-bellwether");

function setup() {
  const projects = createMemoryProjectRepository(
    [BELLWETHER_FIXTURE],
    [
      createProjectMembership({
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        accountId: ACCOUNT,
        role: "owner",
        createdAt: "2026-07-11T19:00:00.000Z"
      })
    ]
  );
  const sceneDocuments = createMemorySceneDocumentRepository();
  const captureDocuments = createMemoryCaptureDocumentRepository();
  let nextId = 0;
  const ids = {
    create: (kind: string) => {
      nextId += 1;
      return `${kind}-test-${nextId}`;
    }
  };
  const clock = { now: () => "2026-07-11T19:00:00.000Z" };
  const services = createGhostwriterServices({ projects, ids, clock });
  const writing = createSceneWritingServices({
    projects,
    sceneDocuments,
    ids,
    clock
  });
  const captures = createCaptureServices({
    projects,
    captureDocuments,
    ids,
    clock
  });
  return { services, writing, captures };
}

describe("createWorkspaceChatTools", () => {
  it("refuses scene reads after the per-turn budget is exhausted", async () => {
    const { services, writing, captures } = setup();
    const tools = createWorkspaceChatTools({
      accountId: ACCOUNT,
      projectId: PROJECT,
      services,
      writing,
      captures,
      navigator: BELLWETHER_FIXTURE_NAVIGATOR
    });
    const sceneTool = tools.find((tool) => tool.name === "scene_workspace_read");
    expect(sceneTool).toBeDefined();

    for (let index = 0; index < WORKSPACE_CHAT_SCENE_READ_MAX_CALLS; index += 1) {
      const result = await sceneTool!.execute({ sceneId: SCENE_ID });
      expect(result).toMatchObject({ ok: true });
    }

    const refused = await sceneTool!.execute({ sceneId: SCENE_ID });
    expect(refused).toEqual({
      ok: false,
      error: `Scene read budget exhausted (${WORKSPACE_CHAT_SCENE_READ_MAX_CALLS} reads per turn).`
    });
  });

  it("returns navigator hierarchy without prose", async () => {
    const { services, writing, captures } = setup();
    const tools = createWorkspaceChatTools({
      accountId: ACCOUNT,
      projectId: PROJECT,
      services,
      writing,
      captures,
      navigator: BELLWETHER_FIXTURE_NAVIGATOR
    });
    const navigatorTool = tools.find((tool) => tool.name === "project_navigator_read");
    const result = await navigatorTool!.execute({});
    expect(result).toMatchObject({
      title: BELLWETHER_FIXTURE_NAVIGATOR.title,
      version: BELLWETHER_FIXTURE_NAVIGATOR.version,
      totals: BELLWETHER_FIXTURE_NAVIGATOR.totals
    });
    expect(JSON.stringify(result)).not.toContain("plainText");
  });

  it("returns not-found errors for unknown scenes without throwing", async () => {
    const { services, writing, captures } = setup();
    const tools = createWorkspaceChatTools({
      accountId: ACCOUNT,
      projectId: PROJECT,
      services,
      writing,
      captures,
      navigator: BELLWETHER_FIXTURE_NAVIGATOR
    });
    const sceneTool = tools.find((tool) => tool.name === "scene_workspace_read");
    await expect(
      sceneTool!.execute({ sceneId: sceneId("scene-missing") })
    ).resolves.toEqual({
      ok: false,
      error: "Scene not found or not accessible."
    });
  });

  it("validates and returns a work plan from propose_work_plan", async () => {
    const { services, writing, captures } = setup();
    const tools = createWorkspaceChatTools({
      accountId: ACCOUNT,
      projectId: PROJECT,
      services,
      writing,
      captures,
      navigator: BELLWETHER_FIXTURE_NAVIGATOR
    });
    const propose = tools.find((tool) => tool.name === "propose_work_plan");
    expect(propose).toBeDefined();
    const result = await propose!.execute({
      schemaId: "work-plan-v1",
      summary: "Two jobs for this scene.",
      sceneId: SCENE_ID,
      jobs: [
        {
          id: "job-1",
          kind: "run-catalog-agent",
          title: "Dialogue Coach",
          instruction: "Tighten dialogue.",
          catalogAgentId: "dialogue-coach"
        },
        {
          id: "job-2",
          kind: "create-story-knowledge",
          title: "Add Mara",
          instruction: "New character.",
          proposedName: "Mara",
          storyKnowledgeKind: "character"
        }
      ]
    });
    expect(result).toMatchObject({
      ok: true,
      workPlan: {
        schemaId: "work-plan-v1",
        summary: "Two jobs for this scene.",
        jobs: [{ id: "job-1" }, { id: "job-2" }]
      }
    });
    const extracted = extractProposedWorkPlanFromToolTraces([
      {
        toolName: "propose_work_plan",
        title: "Propose work plan",
        input: {},
        output: result,
        ok: true
      }
    ]);
    expect(extracted?.jobs).toHaveLength(2);
  });
});
