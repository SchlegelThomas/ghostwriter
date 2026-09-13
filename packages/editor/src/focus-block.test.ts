import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";

import { findTopLevelBlockTextSelection } from "./focus-block.js";

const testSchema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      attrs: { id: { default: null } },
      content: "inline*",
      group: "block",
      parseDOM: [{ tag: "p" }],
      toDOM: () => ["p", 0],
    },
    heading: {
      attrs: { id: { default: null }, level: { default: 1 } },
      content: "inline*",
      group: "block",
      parseDOM: [{ tag: "h1", attrs: { level: 1 } }],
      toDOM: (node) => [`h${node.attrs.level}`, 0],
    },
    blockquote: {
      attrs: { id: { default: null } },
      content: "block+",
      group: "block",
      parseDOM: [{ tag: "blockquote" }],
      toDOM: () => ["blockquote", 0],
    },
    horizontalRule: {
      attrs: { id: { default: null } },
      group: "block",
      parseDOM: [{ tag: "hr" }],
      toDOM: () => ["hr"],
    },
    text: { group: "inline" },
  },
});

function docFromJson(content: unknown) {
  return testSchema.nodeFromJSON({
    type: "doc",
    content,
  });
}

describe("findTopLevelBlockTextSelection", () => {
  it("focuses the first paragraph match", () => {
    const doc = docFromJson([
      {
        type: "paragraph",
        attrs: { id: "p-one" },
        content: [{ type: "text", text: "Alpha" }],
      },
      {
        type: "paragraph",
        attrs: { id: "p-two" },
        content: [{ type: "text", text: "Beta" }],
      },
    ]);

    expect(findTopLevelBlockTextSelection(doc, "p-two")).toEqual({
      from: 9,
      to: 9,
    });
  });

  it("focuses headings and empty paragraphs safely", () => {
    const doc = docFromJson([
      {
        type: "heading",
        attrs: { id: "h-one", level: 1 },
        content: [{ type: "text", text: "Title" }],
      },
      { type: "paragraph", attrs: { id: "p-empty" } },
    ]);

    expect(findTopLevelBlockTextSelection(doc, "h-one")).toEqual({
      from: 2,
      to: 2,
    });
    expect(findTopLevelBlockTextSelection(doc, "p-empty")).toEqual({
      from: 9,
      to: 9,
    });
  });

  it("focuses inside blockquote content", () => {
    const doc = docFromJson([
      {
        type: "blockquote",
        attrs: { id: "quote-one" },
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Quoted" }],
          },
        ],
      },
    ]);

    expect(findTopLevelBlockTextSelection(doc, "quote-one")).toEqual({
      from: 4,
      to: 4,
    });
  });

  it("focuses horizontal rules at a safe caret", () => {
    const doc = docFromJson([
      {
        type: "paragraph",
        attrs: { id: "before" },
        content: [{ type: "text", text: "Before" }],
      },
      { type: "horizontalRule", attrs: { id: "rule-one" } },
    ]);

    expect(findTopLevelBlockTextSelection(doc, "rule-one")).toEqual({
      from: 9,
      to: 9,
    });
  });

  it("returns undefined for missing ids and uses the first duplicate", () => {
    const doc = docFromJson([
      {
        type: "paragraph",
        attrs: { id: "dup" },
        content: [{ type: "text", text: "First" }],
      },
      {
        type: "paragraph",
        attrs: { id: "dup" },
        content: [{ type: "text", text: "Second" }],
      },
    ]);

    expect(findTopLevelBlockTextSelection(doc, "missing")).toBeUndefined();
    expect(findTopLevelBlockTextSelection(doc, "dup")).toEqual({
      from: 2,
      to: 2,
    });
  });

  it("uses a selection-only transaction that does not change the document", () => {
    const doc = docFromJson([
      {
        type: "paragraph",
        attrs: { id: "p-one" },
        content: [{ type: "text", text: "Alpha" }],
      },
    ]);
    const selection = findTopLevelBlockTextSelection(doc, "p-one");
    expect(selection).toBeDefined();
    if (selection === undefined) {
      return;
    }

    const state = EditorState.create({ doc, schema: testSchema });
    const transaction = state.tr.setSelection(
      TextSelection.create(state.doc, selection.from, selection.to),
    );
    expect(transaction.docChanged).toBe(false);
  });
});
