import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  accountId,
  buildCharacterVisualPublicUrl,
  createCaptureServices,
  createInitialSceneDocumentState,
  createProjectMembership,
  createSceneDocumentStateWithProse,
  harryPotterSceneProse,
  HARRY_POTTER_CHARACTER_VISUAL_SEEDS,
  HARRY_POTTER_FIXTURE,
  HARRY_POTTER_FIXTURE_PROJECT_ID,
  HARRY_POTTER_SEED_CAPTURES,
  parseCharacterVisualLocatorUrl,
  type AccountId,
  type CaptureDocumentRepository,
  type CaptureObjectStoragePort,
  type CharacterVisual,
  type Clock,
  type GhostwriterServices,
  type IdGenerator,
  type ProjectRepository,
  type SceneDocumentRepository
} from "@ghostwriter/core";
import { seedProject } from "@ghostwriter/storage";
import { CaptureObjectStorageError } from "./capture-object-storage-error.js";

export type HermeticSeedDependencies = Readonly<{
  projects: ProjectRepository;
  sceneDocuments: SceneDocumentRepository;
  captureDocuments: CaptureDocumentRepository;
  accountId: AccountId;
  ids: IdGenerator;
  clock: Clock;
  /** When provided, seed character portrait PNGs into object storage. */
  objectStorage?: CaptureObjectStoragePort;
  /** Public bucket for demo character portraits when configured. */
  publicObjectStorage?: CaptureObjectStoragePort;
  /** HTTPS origin for persisted public character visual URLs. */
  publicMediaOrigin?: string;
  /** Required to rewrite existing demo portrait locators to public URLs. */
  services?: GhostwriterServices;
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

  await putHarryPotterCharacterVisualObjects(dependencies);
  await rewriteHarryPotterVisualUrlsToPublic(dependencies);

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

async function putHarryPotterCharacterVisualObjects(
  dependencies: HermeticSeedDependencies
): Promise<void> {
  const objectStorage =
    dependencies.publicObjectStorage ?? dependencies.objectStorage;
  if (objectStorage === undefined) return;
  try {
    for (const seed of HARRY_POTTER_CHARACTER_VISUAL_SEEDS) {
      const bytes = new Uint8Array(
        await readFile(join(VISUAL_FIXTURES_DIR, seed.filename))
      );
      await objectStorage.putObject({
        objectKey: seed.objectKey,
        contentType: "image/png",
        bytes
      });
    }
  } catch (error) {
    if (error instanceof CaptureObjectStorageError) {
      // R2 may be unprovisioned in some environments; seed metadata still lands.
      return;
    }
    throw error;
  }
}

function rewriteVisualUrlToPublic(
  visual: CharacterVisual,
  publicMediaOrigin: string
): CharacterVisual {
  const locator = parseCharacterVisualLocatorUrl(visual.url);
  if (locator === undefined) {
    return visual;
  }
  return Object.freeze({
    ...visual,
    url: buildCharacterVisualPublicUrl(
      publicMediaOrigin,
      locator.projectId,
      locator.knowledgeId,
      locator.visualId
    )
  });
}

async function rewriteHarryPotterVisualUrlsToPublic(
  dependencies: HermeticSeedDependencies
): Promise<void> {
  const publicMediaOrigin = dependencies.publicMediaOrigin;
  if (publicMediaOrigin === undefined || dependencies.services === undefined) {
    return;
  }

  const owner = accountId(dependencies.accountId);
  let navigator = await dependencies.services.getProjectNavigator(
    owner,
    HARRY_POTTER_FIXTURE_PROJECT_ID
  );
  if (navigator === undefined) {
    return;
  }

  for (const knowledge of navigator.storyKnowledge) {
    const visuals = knowledge.visuals;
    if (visuals === undefined || visuals.length === 0) {
      continue;
    }

    const updatedVisuals = visuals.map((visual) =>
      rewriteVisualUrlToPublic(visual, publicMediaOrigin)
    );
    const changed = updatedVisuals.some(
      (visual, index) => visual.url !== visuals[index]?.url
    );
    if (!changed) {
      continue;
    }

    navigator = await dependencies.services.executeProjectCommand({
      accountId: owner,
      projectId: HARRY_POTTER_FIXTURE_PROJECT_ID,
      expectedVersion: navigator.version,
      command: {
        type: "storyKnowledge.update",
        storyKnowledgeId: knowledge.id,
        visuals: updatedVisuals
      }
    });
  }
}

/**
 * Idempotent Harry Potter demo seed for production/dev backends.
 * If the fixture project already exists, skips structure/prose/captures and
 * re-puts portrait objects (cheap overwrite) plus ensures demo ownership.
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

  await putHarryPotterCharacterVisualObjects(dependencies);
  await rewriteHarryPotterVisualUrlsToPublic(dependencies);

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
