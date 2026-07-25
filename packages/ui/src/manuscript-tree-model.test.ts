import { describe, expect, it } from "vitest";
import {
  defaultManuscriptExpandedKeys,
  filterManuscriptTreeNode,
  flattenManuscriptTreeNodes,
  manuscriptKindGlyph,
  manuscriptTreeIndentPx,
  type ManuscriptTreeFilterNode
} from "./manuscript-tree-model.js";
import type { ProjectNavigator } from "@ghostwriter/core";

function node(
  input: Omit<ManuscriptTreeFilterNode, "children"> & {
    children?: readonly ManuscriptTreeFilterNode[];
  }
): ManuscriptTreeFilterNode {
  return {
    ...input,
    children: input.children ?? []
  };
}

const sample = node({
  key: "project",
  label: "Harry Potter",
  kindLabel: "Project",
  children: [
    node({
      key: "book:stone",
      label: "Philosopher's Stone",
      kindLabel: "Book",
      detail: "4 scenes · complete",
      children: [
        node({
          key: "part:year-one",
          label: "Year One",
          kindLabel: "Part",
          children: [
            node({
              key: "chapter:boy",
              label: "The Boy Who Lived",
              kindLabel: "Chapter",
              children: [
                node({
                  key: "scene:morning",
                  label: "Morning on Privet Drive",
                  kindLabel: "Scene",
                  detail: "complete"
                }),
                node({
                  key: "scene:letter",
                  label: "The first letter",
                  kindLabel: "Scene",
                  detail: "complete"
                })
              ]
            })
          ]
        })
      ]
    }),
    node({
      key: "book:chamber",
      label: "Chamber of Secrets",
      kindLabel: "Book",
      children: [
        node({
          key: "scene:dobby",
          label: "A visitor with socks",
          kindLabel: "Scene"
        })
      ]
    })
  ]
});

describe("manuscript-tree-model", () => {
  it("prunes non-matching branches and never restores full children on parent match", () => {
    const filtered = filterManuscriptTreeNode(sample, "privet");
    expect(filtered?.label).toBe("Harry Potter");
    expect(filtered?.children).toHaveLength(1);
    expect(filtered?.children[0]?.label).toBe("Philosopher's Stone");
    const scenes =
      filtered?.children[0]?.children[0]?.children[0]?.children ?? [];
    expect(scenes.map((scene) => scene.label)).toEqual([
      "Morning on Privet Drive"
    ]);
  });

  it("returns undefined when nothing matches", () => {
    expect(filterManuscriptTreeNode(sample, "muggle studies")).toBeUndefined();
  });

  it("flattens only expanded branches unless search is active", () => {
    const collapsed = flattenManuscriptTreeNodes(
      sample,
      new Set(["project"]),
      false
    );
    expect(collapsed.map((entry) => entry.key)).toEqual([
      "project",
      "book:stone",
      "book:chamber"
    ]);

    const searching = flattenManuscriptTreeNodes(
      filterManuscriptTreeNode(sample, "letter")!,
      new Set(),
      true
    );
    expect(searching.some((entry) => entry.key === "scene:letter")).toBe(true);
  });

  it("defaults expansion to project and story folders only", () => {
    const keys = defaultManuscriptExpandedKeys({
      id: "project-hp",
      books: [{ id: "book-a" }, { id: "book-b" }]
    } as unknown as ProjectNavigator);
    expect([...keys].sort()).toEqual(["project", "story-knowledge"]);
  });

  it("indents and glyphs support nested scanning", () => {
    expect(manuscriptTreeIndentPx(1)).toBe(0);
    expect(manuscriptTreeIndentPx(4)).toBe(42);
    expect(manuscriptKindGlyph("Book")).toBe("▣");
    expect(manuscriptKindGlyph("Scene")).toBe("▢");
  });
});
