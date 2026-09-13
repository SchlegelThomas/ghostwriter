import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import {
  TextSelection,
  type EditorState,
} from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

const TOP_LEVEL_FOCUS_BLOCK_TYPES = new Set([
  "paragraph",
  "heading",
  "blockquote",
  "horizontalRule",
]);

/**
 * Resolves a collapsed text selection for a top-level block id in a ProseMirror
 * document. Returns undefined when the id is missing or not on a focusable block.
 * Duplicate ids resolve to the first top-level match.
 */
export function findTopLevelBlockTextSelection(
  doc: ProseMirrorNode,
  blockId: string,
): Readonly<{ from: number; to: number }> | undefined {
  let pos = 1;
  for (let index = 0; index < doc.content.childCount; index += 1) {
    const child = doc.content.child(index);
    const childId = child.attrs.id;
    if (typeof childId === "string" && childId === blockId) {
      if (!TOP_LEVEL_FOCUS_BLOCK_TYPES.has(child.type.name)) {
        return undefined;
      }
      return selectionForTopLevelBlock(child, pos);
    }
    pos += child.nodeSize;
  }
  return undefined;
}

function selectionForTopLevelBlock(
  node: ProseMirrorNode,
  pos: number,
): Readonly<{ from: number; to: number }> {
  if (node.type.name === "horizontalRule") {
    const caret = Math.min(pos + 1, pos + node.nodeSize - 1);
    return { from: caret, to: caret };
  }
  if (node.type.name === "blockquote") {
    const caret = findFirstTextblockCaret(node, pos + 1);
    return { from: caret, to: caret };
  }
  const caret = Math.min(pos + 1, pos + node.nodeSize - 1);
  return { from: caret, to: caret };
}

function findFirstTextblockCaret(node: ProseMirrorNode, pos: number): number {
  if (node.isTextblock) {
    return Math.min(pos + 1, pos + node.nodeSize - 1);
  }
  if (node.content.size === 0) {
    return pos;
  }
  let offset = pos + 1;
  for (let index = 0; index < node.content.childCount; index += 1) {
    const child = node.content.child(index);
    if (child.isTextblock) {
      return Math.min(offset + 1, offset + child.nodeSize - 1);
    }
    if (child.content.size > 0) {
      return findFirstTextblockCaret(child, offset);
    }
    offset += child.nodeSize;
  }
  return pos;
}

function escapeBlockIdForDataIdSelector(blockId: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(blockId);
  }
  return blockId.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"');
}

/** Scrolls the rendered block node (UniqueID `data-id`) into view when present. */
export function scrollBlockElementIntoView(
  rootElement: HTMLElement,
  blockId: string,
): void {
  const node = rootElement.querySelector(
    `[data-id="${escapeBlockIdForDataIdSelector(blockId)}"]`,
  );
  node?.scrollIntoView({ block: "center", inline: "nearest" });
}

/** Applies a collapsed selection and DOM focus without mutating document content. */
export function dispatchBlockFocusSelection(
  view: EditorView,
  state: EditorState,
  selection: Readonly<{ from: number; to: number }>,
): void {
  if (view.isDestroyed) {
    return;
  }
  const transaction = state.tr.setSelection(
    TextSelection.create(state.doc, selection.from, selection.to),
  );
  view.dispatch(transaction);
}

/** Selection, scroll, and editor surface focus for evidence navigation. */
export function applyBlockFocusInEditorView(
  view: EditorView,
  state: EditorState,
  selection: Readonly<{ from: number; to: number }>,
  blockId: string,
): void {
  if (view.isDestroyed) {
    return;
  }
  dispatchBlockFocusSelection(view, state, selection);
  scrollBlockElementIntoView(view.dom, blockId);
  view.focus();
  view.dom.focus();
}
