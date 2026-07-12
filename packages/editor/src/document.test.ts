import { describe, expect, it } from "vitest";

import {
  EMPTY_SCENE_DOCUMENT,
  SceneDocumentValidationError,
  assignTopLevelBlockIds,
  compareSceneDocuments,
  createEmptySceneDocument,
  hashSceneDocument,
  normalizeSceneDocument,
  serializeCanonicalSceneDocument,
  validateSceneDocumentV1,
  type SceneDocumentV1,
  type SceneDocumentValidationCode,
} from "./index.js";

function expectValidationCode(
  action: () => unknown,
  code: SceneDocumentValidationCode,
): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(SceneDocumentValidationError);
    expect((error as SceneDocumentValidationError).code).toBe(code);
    return;
  }

  throw new Error(`Expected validation error ${code}.`);
}

function paragraph(id: string, text: string) {
  return {
    type: "paragraph",
    attrs: { id },
    content: [{ type: "text", text }],
  };
}

function sceneDocument(content: readonly unknown[]): SceneDocumentV1 {
  return validateSceneDocumentV1({
    schemaVersion: 1,
    document: {
      type: "doc",
      content,
    },
  });
}

describe("scene document schema v1", () => {
  it("provides valid constant and generated empty documents", () => {
    expect(validateSceneDocumentV1(EMPTY_SCENE_DOCUMENT)).toEqual(
      EMPTY_SCENE_DOCUMENT,
    );

    expect(
      createEmptySceneDocument({
        generateBlockId: () => "empty-generated",
      }),
    ).toEqual({
      schemaVersion: 1,
      document: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { id: "empty-generated" },
          },
        ],
      },
    });
  });

  it("assigns missing block IDs once and preserves existing IDs", () => {
    const ids = ["generated-paragraph", "generated-quote", "generated-nested"];
    const assigned = assignTopLevelBlockIds(
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Opening" }],
          },
          {
            type: "blockquote",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "Quoted" }],
              },
            ],
          },
          {
            type: "heading",
            attrs: { id: "kept-heading", level: 2 },
            content: [{ type: "text", text: "Chapter" }],
          },
        ],
      },
      {
        generateBlockId: () => {
          const id = ids.shift();

          if (id === undefined) {
            throw new Error("Unexpected extra ID request.");
          }

          return id;
        },
      },
    );

    expect(assigned.content[0]?.attrs.id).toBe("generated-paragraph");
    expect(assigned.content[1]?.attrs.id).toBe("generated-quote");
    expect(
      assigned.content[1]?.type === "blockquote"
        ? assigned.content[1].content[0]?.attrs.id
        : undefined,
    ).toBe("generated-nested");
    expect(assigned.content[2]?.attrs.id).toBe("kept-heading");

    expect(
      assignTopLevelBlockIds(assigned, {
        generateBlockId: () => {
          throw new Error("Stable IDs must not be reassigned.");
        },
      }),
    ).toEqual(assigned);

    expect(normalizeSceneDocument(assigned)).toEqual({
      schemaVersion: 1,
      document: assigned,
    });
  });

  it("rejects missing and duplicate block IDs", () => {
    expectValidationCode(
      () =>
        validateSceneDocumentV1({
          schemaVersion: 1,
          document: {
            type: "doc",
            content: [{ type: "paragraph" }],
          },
        }),
      "MISSING_BLOCK_ID",
    );

    expectValidationCode(
      () =>
        sceneDocument([
          paragraph("duplicate", "First"),
          paragraph("duplicate", "Second"),
        ]),
      "DUPLICATE_BLOCK_ID",
    );
  });

  it("rejects nodes, marks, and heading levels outside schema v1", () => {
    expectValidationCode(
      () =>
        sceneDocument([
          {
            type: "codeBlock",
            attrs: { id: "code" },
            content: [{ type: "text", text: "not prose" }],
          },
        ]),
      "INVALID_NODE",
    );

    expectValidationCode(
      () =>
        sceneDocument([
          {
            type: "heading",
            attrs: { id: "heading", level: 4 },
          },
        ]),
      "INVALID_HEADING_LEVEL",
    );

    expectValidationCode(
      () =>
        sceneDocument([
          {
            type: "paragraph",
            attrs: { id: "linked" },
            content: [
              {
                type: "text",
                text: "No links in v1",
                marks: [{ type: "link" }],
              },
            ],
          },
        ]),
      "INVALID_MARK",
    );
  });

  it("serializes and hashes equivalent canonical content identically", async () => {
    const first = {
      schemaVersion: 1,
      document: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { id: "paragraph-1" },
            content: [
              {
                type: "text",
                text: "A stable sentence.",
                marks: [{ type: "italic" }, { type: "bold" }],
              },
            ],
          },
        ],
      },
    };
    const second = {
      document: {
        content: [
          {
            content: [
              {
                marks: [{ type: "bold" }, { type: "italic" }],
                text: "A stable sentence.",
                type: "text",
              },
            ],
            attrs: { id: "paragraph-1" },
            type: "paragraph",
          },
        ],
        type: "doc",
      },
      schemaVersion: 1,
    };

    expect(serializeCanonicalSceneDocument(first)).toBe(
      serializeCanonicalSceneDocument(second),
    );

    const [firstHash, secondHash] = await Promise.all([
      hashSceneDocument(first),
      hashSceneDocument(second),
    ]);

    expect(firstHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(firstHash).toBe(secondHash);
    expect(
      await hashSceneDocument(
        sceneDocument([paragraph("paragraph-1", "A changed sentence.")]),
      ),
    ).not.toBe(firstHash);
  });
});

describe("block-aware scene comparison", () => {
  it("reports stable add, remove, change, and move operations", () => {
    const before = sceneDocument([
      paragraph("a", "Alpha"),
      paragraph("b", "Bravo"),
      paragraph("c", "Charlie"),
      paragraph("removed", "Gone"),
    ]);
    const after = sceneDocument([
      paragraph("b", "Bravo revised"),
      paragraph("a", "Alpha"),
      paragraph("c", "Charlie"),
      paragraph("added", "New"),
    ]);

    expect(compareSceneDocuments(before, after)).toEqual({
      equal: false,
      blocks: [
        {
          blockId: "b",
          beforeIndex: 1,
          afterIndex: 0,
          changes: ["changed", "moved"],
          before: before.document.content[1],
          after: after.document.content[0],
        },
        {
          blockId: "a",
          beforeIndex: 0,
          afterIndex: 1,
          changes: [],
          before: before.document.content[0],
          after: after.document.content[1],
        },
        {
          blockId: "c",
          beforeIndex: 2,
          afterIndex: 2,
          changes: [],
          before: before.document.content[2],
          after: after.document.content[2],
        },
        {
          blockId: "added",
          beforeIndex: null,
          afterIndex: 3,
          changes: ["added"],
          before: null,
          after: after.document.content[3],
        },
        {
          blockId: "removed",
          beforeIndex: 3,
          afterIndex: null,
          changes: ["removed"],
          before: before.document.content[3],
          after: null,
        },
      ],
    });
  });

  it("does not report movement for index shifts caused by insertion", () => {
    const before = sceneDocument([
      paragraph("a", "Alpha"),
      paragraph("b", "Bravo"),
    ]);
    const after = sceneDocument([
      paragraph("new", "New"),
      paragraph("a", "Alpha"),
      paragraph("b", "Bravo"),
    ]);
    const comparison = compareSceneDocuments(before, after);

    expect(comparison.blocks.map((block) => block.changes)).toEqual([
      ["added"],
      [],
      [],
    ]);
    expect(compareSceneDocuments(before, before).equal).toBe(true);
  });
});
