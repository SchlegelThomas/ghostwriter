import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  accountId,
  createCaptureServices,
  createInitialSceneDocumentState,
  createProjectMembership,
  createSceneDocumentStateWithProse,
  harryPotterSceneProse,
  HARRY_POTTER_CHARACTER_VISUAL_SEEDS,
  HARRY_POTTER_FIXTURE,
  HARRY_POTTER_FIXTURE_PROJECT_ID,
  HARRY_POTTER_SEED_CAPTURES,
  type AccountId,
  type CaptureDocumentRepository,
  type CaptureObjectStoragePort,
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
  /** When provided, seed character portrait PNGs into object storage. */
  objectStorage?: CaptureObjectStoragePort;
}>;

const VISUAL_FIXTURES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../packages/core/fixtures/harry-potter-visuals"
);

/**
 * Seeds the Harry Potter series into a fresh hermetic database:
 * project structure, membership, scene prose, character seed portraits, and captures.
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

  if (dependencies.objectStorage !== undefined) {
    for (const seed of HARRY_POTTER_CHARACTER_VISUAL_SEEDS) {
      const bytes = new Uint8Array(
        await readFile(join(VISUAL_FIXTURES_DIR, seed.filename))
      );
      await dependencies.objectStorage.putObject({
        objectKey: seed.objectKey,
        contentType: "image/png",
        bytes
      });
    }
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

/**
 * Idempotent Harry Potter demo seed for production/dev backends.
 * If the fixture project already exists, skips structure/prose/captures/portrait
 * re-upload and only ensures the demo account has owner membership.
 */
export async function ensureDemoHarryPotterSeed(
  dependencies: HermeticSeedDependencies
): Promise<void> {
  const existing = await dependencies.projects.getProject(
    HARRY_POTTER_FIXTURE_PROJECT_ID
  );
  if (existing === undefined) {
    await seedHermeticHarryPotter(dependencies);
    return;
  }

  const owner = accountId(dependencies.accountId);
  const membership = await dependencies.projects.getProjectMembership(
    HARRY_POTTER_FIXTURE_PROJECT_ID,
    owner
  );
  if (membership !== undefined) {
    return;
  }

  await dependencies.projects.transaction((writer) => {
    writer.insertProjectMembership(
      createProjectMembership({
        projectId: HARRY_POTTER_FIXTURE_PROJECT_ID,
        accountId: owner,
        role: "owner",
        createdAt: dependencies.clock.now()
      })
    );
  });
}
