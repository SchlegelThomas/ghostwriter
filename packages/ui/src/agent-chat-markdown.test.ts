import { describe, expect, it } from "vitest";
import {
  isSafeChatLinkHref,
  parseAgentChatInline,
  parseAgentChatMarkdown
} from "./agent-chat-markdown.js";

describe("parseAgentChatInline", () => {
  it("returns a single plain run for unmarked prose", () => {
    expect(parseAgentChatInline("She closed the door.")).toEqual([
      { text: "She closed the door." }
    ]);
  });

  it("marks bold and italic runs", () => {
    expect(parseAgentChatInline("**Hold** the _line_ and *breathe*")).toEqual([
      { text: "Hold", strong: true },
      { text: " the " },
      { text: "line", emphasis: true },
      { text: " and " },
      { text: "breathe", emphasis: true }
    ]);
  });

  it("nests marks instead of dropping them", () => {
    expect(parseAgentChatInline("**_both_**")).toEqual([
      { text: "both", strong: true, emphasis: true }
    ]);
  });

  it("keeps inline code literal", () => {
    expect(parseAgentChatInline("run `pnpm verify` first")).toEqual([
      { text: "run " },
      { text: "pnpm verify", code: true },
      { text: " first" }
    ]);
  });

  it("allows backticks inside a double-backtick code span", () => {
    expect(parseAgentChatInline("``a ` b``")).toEqual([
      { text: "a ` b", code: true }
    ]);
  });

  it("leaves snake_case identifiers alone", () => {
    expect(parseAgentChatInline("scene_beat_one is fine")).toEqual([
      { text: "scene_beat_one is fine" }
    ]);
  });

  it("treats unclosed emphasis as literal text", () => {
    expect(parseAgentChatInline("**oops and *also")).toEqual([
      { text: "**oops and *also" }
    ]);
  });

  it("does not open emphasis across a space-padded delimiter", () => {
    expect(parseAgentChatInline("3 * 4 * 5")).toEqual([{ text: "3 * 4 * 5" }]);
  });

  it("honours backslash escapes", () => {
    expect(parseAgentChatInline("\\*not italic\\*")).toEqual([
      { text: "*not italic*" }
    ]);
  });

  it("keeps http links and their marks", () => {
    expect(
      parseAgentChatInline("See [**the notes**](https://example.com/a) today")
    ).toEqual([
      { text: "See " },
      { text: "the notes", strong: true, href: "https://example.com/a" },
      { text: " today" }
    ]);
  });

  it("unwraps angle-bracketed targets", () => {
    expect(parseAgentChatInline("[docs](<https://example.com>)")).toEqual([
      { text: "docs", href: "https://example.com" }
    ]);
  });

  it("drops the target of an unsafe link but keeps its words", () => {
    expect(parseAgentChatInline("[click](javascript:alert)")).toEqual([
      { text: "click" }
    ]);
  });

  it("drops relative and data targets", () => {
    expect(parseAgentChatInline("[a](/local) [b](data:text/html,x)")).toEqual([
      { text: "a b" }
    ]);
  });
});

describe("isSafeChatLinkHref", () => {
  it("accepts absolute http and https targets", () => {
    expect(isSafeChatLinkHref("https://example.com/scene?id=1")).toBe(true);
    expect(isSafeChatLinkHref("http://example.com")).toBe(true);
  });

  it("rejects scripts, schemes, relatives, and blanks", () => {
    expect(isSafeChatLinkHref("javascript:alert(1)")).toBe(false);
    expect(isSafeChatLinkHref("JavaScript:alert(1)")).toBe(false);
    expect(isSafeChatLinkHref("data:text/html;base64,AAA")).toBe(false);
    expect(isSafeChatLinkHref("/scenes/3")).toBe(false);
    expect(isSafeChatLinkHref("")).toBe(false);
    expect(isSafeChatLinkHref("https://")).toBe(false);
  });

  it("rejects targets carrying control or quoting characters", () => {
    expect(isSafeChatLinkHref("https://example.com/a\u0001b")).toBe(false);
    expect(isSafeChatLinkHref('https://example.com/"onload')).toBe(false);
  });
});

describe("parseAgentChatMarkdown", () => {
  it("returns nothing for empty or blank replies", () => {
    expect(parseAgentChatMarkdown("")).toEqual([]);
    expect(parseAgentChatMarkdown("\n  \n")).toEqual([]);
  });

  it("reads ATX headings and clamps deep levels", () => {
    expect(parseAgentChatMarkdown("# One\n\n## Two\n\n##### Five")).toEqual([
      { kind: "heading", level: 1, spans: [{ text: "One" }] },
      { kind: "heading", level: 2, spans: [{ text: "Two" }] },
      { kind: "heading", level: 3, spans: [{ text: "Five" }] }
    ]);
  });

  it("splits paragraphs on blank lines and keeps soft line breaks", () => {
    expect(parseAgentChatMarkdown("first\nstill first\n\nsecond")).toEqual([
      { kind: "paragraph", spans: [{ text: "first\nstill first" }] },
      { kind: "paragraph", spans: [{ text: "second" }] }
    ]);
  });

  it("groups bullets into one list with nesting depth", () => {
    expect(parseAgentChatMarkdown("- top\n  - under\n- back")).toEqual([
      {
        kind: "list",
        ordered: false,
        items: [
          { depth: 0, marker: "•", spans: [{ text: "top" }] },
          { depth: 1, marker: "•", spans: [{ text: "under" }] },
          { depth: 0, marker: "•", spans: [{ text: "back" }] }
        ]
      }
    ]);
  });

  it("keeps the writer's own numbering on ordered lists", () => {
    expect(parseAgentChatMarkdown("2. two\n3) three")).toEqual([
      {
        kind: "list",
        ordered: true,
        items: [
          { depth: 0, marker: "2.", spans: [{ text: "two" }] },
          { depth: 0, marker: "3.", spans: [{ text: "three" }] }
        ]
      }
    ]);
  });

  it("folds an indented continuation line into the item above it", () => {
    expect(parseAgentChatMarkdown("- beat one\n    keeps going")).toEqual([
      {
        kind: "list",
        ordered: false,
        items: [
          { depth: 0, marker: "•", spans: [{ text: "beat one\nkeeps going" }] }
        ]
      }
    ]);
  });

  it("ends a list at the next paragraph", () => {
    expect(parseAgentChatMarkdown("Try:\n- one\n\nThen rest.")).toEqual([
      { kind: "paragraph", spans: [{ text: "Try:" }] },
      {
        kind: "list",
        ordered: false,
        items: [{ depth: 0, marker: "•", spans: [{ text: "one" }] }]
      },
      { kind: "paragraph", spans: [{ text: "Then rest." }] }
    ]);
  });

  it("reads fenced code with its language and without the fences", () => {
    expect(
      parseAgentChatMarkdown("```ts\nconst a = 1;\n\nconst b = 2;\n```")
    ).toEqual([
      { kind: "code", language: "ts", text: "const a = 1;\n\nconst b = 2;" }
    ]);
  });

  it("closes an unterminated fence at the end of the reply", () => {
    expect(parseAgentChatMarkdown("```\nstill writing")).toEqual([
      { kind: "code", text: "still writing" }
    ]);
  });

  it("does not format inside fenced code", () => {
    expect(parseAgentChatMarkdown("```\n# not a heading **plain**\n```")).toEqual(
      [{ kind: "code", text: "# not a heading **plain**" }]
    );
  });

  it("collects quote lines into one quote block", () => {
    expect(parseAgentChatMarkdown("> she said\n> nothing\n\nAfter.")).toEqual([
      { kind: "quote", spans: [{ text: "she said\nnothing" }] },
      { kind: "paragraph", spans: [{ text: "After." }] }
    ]);
  });

  it("reads thematic breaks without mistaking them for bullets", () => {
    expect(parseAgentChatMarkdown("one\n\n---\n\ntwo")).toEqual([
      { kind: "paragraph", spans: [{ text: "one" }] },
      { kind: "rule" },
      { kind: "paragraph", spans: [{ text: "two" }] }
    ]);
  });

  it("parses a realistic mixed reply", () => {
    const blocks = parseAgentChatMarkdown(
      [
        "## Where the scene stalls",
        "",
        "Mara's turn lands **late**, so the room never tightens.",
        "",
        "1. Cut the opening beat",
        "2. Move the [reference](https://example.com/ch3) earlier",
        "",
        "> He waited for the door.",
        "",
        "Then run `pnpm verify`."
      ].join("\n")
    );

    expect(blocks.map((block) => block.kind)).toEqual([
      "heading",
      "paragraph",
      "list",
      "quote",
      "paragraph"
    ]);
    expect(blocks[2]).toEqual({
      kind: "list",
      ordered: true,
      items: [
        { depth: 0, marker: "1.", spans: [{ text: "Cut the opening beat" }] },
        {
          depth: 0,
          marker: "2.",
          spans: [
            { text: "Move the " },
            { text: "reference", href: "https://example.com/ch3" },
            { text: " earlier" }
          ]
        }
      ]
    });
  });
});
