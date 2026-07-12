import { serializeCanonicalSceneBlock } from "./canonical.js";
import { validateSceneDocumentV1 } from "./document.js";
import type {
  BlockId,
  SceneBlockChangeKind,
  SceneBlockComparison,
  SceneBlockV1,
  SceneDocumentComparison,
} from "./types.js";

interface IndexedBlock {
  readonly block: SceneBlockV1;
  readonly index: number;
}

function findBlocksInStableOrder(
  beforeBlocks: readonly SceneBlockV1[],
  afterBlocks: readonly SceneBlockV1[],
): ReadonlySet<BlockId> {
  const beforePositions = new Map<BlockId, number>(
    beforeBlocks.map((block, index) => [block.attrs.id, index]),
  );
  const shared = afterBlocks.flatMap((block) => {
    const beforeIndex = beforePositions.get(block.attrs.id);
    return beforeIndex === undefined
      ? []
      : [{ blockId: block.attrs.id, beforeIndex }];
  });

  if (shared.length === 0) {
    return new Set<BlockId>();
  }

  const predecessors = new Array<number>(shared.length).fill(-1);
  const tailIndexes: number[] = [];

  for (let index = 0; index < shared.length; index += 1) {
    const item = shared[index];

    if (item === undefined) {
      continue;
    }

    let lower = 0;
    let upper = tailIndexes.length;

    while (lower < upper) {
      const middle = Math.floor((lower + upper) / 2);
      const tailIndex = tailIndexes[middle];
      const tail = tailIndex === undefined ? undefined : shared[tailIndex];

      if (tail !== undefined && tail.beforeIndex < item.beforeIndex) {
        lower = middle + 1;
      } else {
        upper = middle;
      }
    }

    if (lower > 0) {
      predecessors[index] = tailIndexes[lower - 1] ?? -1;
    }

    tailIndexes[lower] = index;
  }

  const stable = new Set<BlockId>();
  let cursor = tailIndexes[tailIndexes.length - 1] ?? -1;

  while (cursor >= 0) {
    const item = shared[cursor];

    if (item === undefined) {
      break;
    }

    stable.add(item.blockId);
    cursor = predecessors[cursor] ?? -1;
  }

  return stable;
}

/**
 * Compares top-level blocks by stable ID. Results follow the after-document
 * order, with removed blocks appended in their original order.
 */
export function compareSceneDocuments(
  beforeValue: unknown,
  afterValue: unknown,
): SceneDocumentComparison {
  const beforeDocument = validateSceneDocumentV1(beforeValue);
  const afterDocument = validateSceneDocumentV1(afterValue);
  const beforeBlocks = beforeDocument.document.content;
  const afterBlocks = afterDocument.document.content;
  const beforeById = new Map<BlockId, IndexedBlock>(
    beforeBlocks.map((block, index) => [
      block.attrs.id,
      { block, index },
    ]),
  );
  const afterIds = new Set(afterBlocks.map((block) => block.attrs.id));
  const stableOrder = findBlocksInStableOrder(beforeBlocks, afterBlocks);
  const blocks: SceneBlockComparison[] = [];

  afterBlocks.forEach((after, afterIndex) => {
    const before = beforeById.get(after.attrs.id);

    if (before === undefined) {
      blocks.push({
        blockId: after.attrs.id,
        beforeIndex: null,
        afterIndex,
        changes: ["added"],
        before: null,
        after,
      });
      return;
    }

    const changes: SceneBlockChangeKind[] = [];

    if (
      serializeCanonicalSceneBlock(before.block) !==
      serializeCanonicalSceneBlock(after)
    ) {
      changes.push("changed");
    }

    if (!stableOrder.has(after.attrs.id)) {
      changes.push("moved");
    }

    blocks.push({
      blockId: after.attrs.id,
      beforeIndex: before.index,
      afterIndex,
      changes,
      before: before.block,
      after,
    });
  });

  beforeBlocks.forEach((before, beforeIndex) => {
    if (afterIds.has(before.attrs.id)) {
      return;
    }

    blocks.push({
      blockId: before.attrs.id,
      beforeIndex,
      afterIndex: null,
      changes: ["removed"],
      before,
      after: null,
    });
  });

  return {
    equal: blocks.every((block) => block.changes.length === 0),
    blocks,
  };
}
