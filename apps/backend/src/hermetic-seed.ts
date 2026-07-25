import {
  accountId,
  createCaptureServices,
  createInitialSceneDocumentState,
  createProjectMembership,
  createSceneDocumentStateWithProse,
  harryPotterSceneProse,
  HARRY_POTTER_FIXTURE,
  HARRY_POTTER_FIXTURE_PROJECT_ID,
  HARRY_POTTER_SEED_CAPTURES,
  type AccountId,
  type CaptureDocumentRepository,
  type Clock,
  type IdGenerator,
  type ProjectRepository,
  type SceneDocumentRepository
} from "@ghostwriter/core";
import { seedProject } from "@ghostwriter/storage";

export type HermeticSeedDependencies = Readonly<{
  projects: ProjectRepository;
  sceneDocuments: SceneDocumentRepository;
  captureDocuments: CaptureDocumentRepository;
  accountId: AccountId;
  ids: IdGenerator;
  clock: Clock;
}>;

/**
 * Seeds the Harry Potter series into a fresh hermetic database:
 * project structure, membership, scene prose, and a few Dreams & Ideas captures.
 */
export async function seedHermeticHarryPotter(
  dependencies: HermeticSeedDependencies
): Promise<void> {
  const now = dependencies.clock.now();
  const owner = accountId(dependencies.accountId);

  await seedProject(dependencies.projects, HARRY_POTTER_FIXTURE);
  await dependencies.projects.transaction((writer) => {
    writer.insertProjectMembership(
      createProjectMembership({
        projectId: HARRY_POTTER_FIXTURE_PROJECT_ID,
        accountId: owner,
        role: "owner",
        createdAt: now
      })
    );
  });

  for (const scene of HARRY_POTTER_FIXTURE.scenes) {
    const prose = harryPotterSceneProse(scene.id);
    const initial =
      prose === undefined
        ? await createInitialSceneDocumentState({
            projectId: HARRY_POTTER_FIXTURE_PROJECT_ID,
            sceneId: scene.id,
            actorAccountId: owner,
            ids: dependencies.ids,
            now
          })
        : await createSceneDocumentStateWithProse({
            projectId: HARRY_POTTER_FIXTURE_PROJECT_ID,
            sceneId: scene.id,
            actorAccountId: owner,
            ids: dependencies.ids,
            now,
            prose
          });
    await dependencies.sceneDocuments.initialize(initial);
  }

  const captures = createCaptureServices({
    projects: dependencies.projects,
    captureDocuments: dependencies.captureDocuments,
    ids: dependencies.ids,
    clock: dependencies.clock
  });

  for (const seed of HARRY_POTTER_SEED_CAPTURES) {
    const head = await captures.createCapture({
      accountId: owner,
      projectId: HARRY_POTTER_FIXTURE_PROJECT_ID,
      sourceModality: seed.modality
    });
    await captures.saveCaptureDocument({
      accountId: owner,
      projectId: HARRY_POTTER_FIXTURE_PROJECT_ID,
      captureId: head.captureId,
      expectedWorkingVersion: head.workingVersion,
      document: {
        schemaVersion: 1,
        document: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              attrs: { id: dependencies.ids.create("captureDocumentBlock") },
              content: [{ type: "text", text: seed.prose }]
            }
          ]
        }
      }
    });
  }
}
