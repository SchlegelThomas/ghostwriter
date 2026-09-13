/** Opt-in local profile: pnpm --filter @ghostwriter/storage exec tsx src/canvas-capacity-profile.ts */
import { cpus, platform, arch, totalmem } from "node:os";
import { performance } from "node:perf_hooks";
import {
  accountId, canvasRevisionId, createCanvasRevision, hashCanvasBoard,
  applyCanvasCommand, deriveCanvasReadingOrderSpine
} from "@ghostwriter/core";
import { createCanvasCapacityFixture } from "./canvas-capacity-fixture.js";
import { createPgliteDatabase, migratePgliteRepositoryDatabase } from "./pglite.js";
import { toRepositoryDatabase } from "./client.js";
import { createPostgresProjectRepository } from "./postgres-project-repository.js";
import { createPostgresCanvasRepository } from "./postgres-canvas-repository.js";
import { seedProject } from "./seed.js";
import { user } from "./schema.js";

const actor = accountId("capacity-writer");
const { now, project, records, objects, initial } = createCanvasCapacityFixture();
const { db, close } = createPgliteDatabase();
const samples: Record<string, number[]> = {};
async function timed<T>(name: string, work: () => Promise<T>): Promise<T> {
  const start = performance.now();
  const result = await work();
  (samples[name] ??= []).push(performance.now() - start);
  return result;
}
try {
  await migratePgliteRepositoryDatabase(db);
  await db.insert(user).values({ id: actor, name: "Capacity Writer", email: "capacity@example.test", emailVerified: true });
  const repositoryDb = toRepositoryDatabase(db);
  await seedProject(createPostgresProjectRepository(repositoryDb), records);
  const canvases = createPostgresCanvasRepository(repositoryDb);
  const hash = await hashCanvasBoard(initial);
  let board = await canvases.initialize({ board: initial, revision: createCanvasRevision({
    id: canvasRevisionId(`canvas_revision_${hash}`), projectId: project,
    boardVersion: 1, contentHash: hash, snapshot: initial, actorAccountId: actor,
    reason: "genesis", createdAt: now
  }) });
  for (let i = 0; i < 200; i++) {
    const mutation = await timed("coreGeometry", () => applyCanvasCommand({
      board, projectRecords: records, expectedCanvasVersion: board.version,
      actorAccountId: actor, ids: { create: kind => `capacity-${kind}-${i}` }, now,
      command: { type: "canvas.object.setScopePlacement", objectId: objects[i % 1000]!.id,
        scopeKind: "chapter", scopeId: `capacity-chapter-${Math.floor((i % 500) / 5)}`,
        x: (i % 5) * 300 + i + 1, y: 12, width: 260, height: 160 }
    }));
    board = await timed("persistGeometry", () => canvases.replace({ mutation, expectedCanvasVersion: board.version }));
  }
  for (let i = 0; i < 10; i++) {
    await timed("loadBoard", () => canvases.getBoard(project));
    await timed("historyMetadata", () =>
      canvases.listRevisions(project, { limit: 100 })
    );
    await timed("readingSpine", async () => deriveCanvasReadingOrderSpine(records, board));
  }
  const saved = await canvases.getBoard(project);
  const history = await canvases.listRevisions(project);
  if (saved?.version !== 201 || history.length !== 201) throw new Error("Serialized history lost or duplicated a write.");
  const firstHistoryPage = await canvases.listRevisions(project, { limit: 100 });
  const secondHistoryPage = await canvases.listRevisions(project, {
    limit: 100,
    beforeVersion: firstHistoryPage.at(-1)!.boardVersion
  });
  const finalHistoryPage = await canvases.listRevisions(project, {
    limit: 100,
    beforeVersion: secondHistoryPage.at(-1)!.boardVersion
  });
  if (
    firstHistoryPage.length !== 100 ||
    secondHistoryPage.length !== 100 ||
    finalHistoryPage.length !== 1 ||
    finalHistoryPage[0]?.boardVersion !== 1
  ) {
    throw new Error("Canvas history pagination skipped or duplicated revisions.");
  }
  for (let i = 0; i < 200; i++) {
    const placement = saved.scopePlacements.find(p => p.objectId === objects[i]!.id);
    if (placement?.x !== (i % 5) * 300 + i + 1 || placement.y !== 12) {
      throw new Error(`Serialized geometry did not survive reload at action ${i}.`);
    }
  }
  const stats = Object.fromEntries(Object.entries(samples).map(([name, values]) => {
    const sorted = [...values].sort((a, b) => a - b);
    return [name, { samples: values.length, medianMs: sorted[Math.floor(sorted.length / 2)],
      p95Ms: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * .95) - 1)], maxMs: sorted.at(-1) }];
  }));
  console.log(JSON.stringify({ fixture: { chapters: 100, scenes: 500, supportingObjects: 500,
    links: 1500, scopePlacements: 1000, actions: 200 },
    runtime: { node: process.version, platform: platform(), arch: arch(), cpu: cpus()[0]?.model,
      logicalCpus: cpus().length, memoryGiB: Math.round(totalmem() / 1024 ** 3), adapter: "local PGlite" },
    boardBytes: Buffer.byteLength(JSON.stringify(board)), finalBoardVersion: board.version, stats }, null, 2));
} finally { await close(); }
