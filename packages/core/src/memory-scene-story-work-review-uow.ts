import { executeSceneStoryWorkReview, type SceneStoryWorkReviewRepositories, type SceneStoryWorkReviewUnitOfWork } from "./scene-story-work-review.js";
import { MEMORY_TRANSACTION_STATE, type MemoryTransactionalRepository } from "./memory-transaction.js";

export function createMemorySceneStoryWorkReviewUnitOfWork(repositories: SceneStoryWorkReviewRepositories): SceneStoryWorkReviewUnitOfWork {
  const participants = [repositories.assignments, repositories.proposals].map((repository) => {
    const participant = (repository as MemoryTransactionalRepository)[MEMORY_TRANSACTION_STATE];
    if (participant === undefined) throw new Error("Scene review requires transactional memory repositories.");
    return participant;
  });
  let tail = Promise.resolve();
  return { async review(input) {
    const previous = tail;
    let release = () => {};
    tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    const snapshots = participants.map((participant) => participant.snapshot());
    try { return await executeSceneStoryWorkReview(repositories, input); }
    catch (cause) { participants.forEach((participant, index) => participant.restore(snapshots[index])); throw cause; }
    finally { release(); }
  } };
}
