import { describe, expect, it } from "vitest";
import { buildHermeticWorkspaceChatReply } from "./hermetic-workspace-chat-reply.js";

describe("buildHermeticWorkspaceChatReply", () => {
  it("writes a continuation when the writer asks to introduce a dark connection", () => {
    const { reply } = buildHermeticWorkspaceChatReply(
      [
        "Project: Harry Potter",
        'Selection focus: kind=scene · scene="The first letter"',
        "Open scene draft:",
        "The letter was not like the bills. The ink looked older than the paper.",
        "",
        "Writer message:",
        "lets introduce harry being connected to a dark power here"
      ].join("\n")
    );
    expect(reply).toContain("felt like a claim");
    expect(reply).toContain("dropped into the scene");
    expect(reply.toLowerCase()).not.toContain("if we try");
    expect(reply.toLowerCase()).not.toContain("propose-only");
    expect(reply.toLowerCase()).not.toContain("canon");
  });

  it("writes the chosen pull when the writer continues the conversation", () => {
    const { reply } = buildHermeticWorkspaceChatReply(
      [
        "Recent conversation (non-authoritative):",
        "Writer: introduce a dark power",
        "Assistant: Something older than the paper seemed to know him.",
        "",
        "Writer message:",
        "character feeling the pull"
      ].join("\n")
    );
    expect(reply).toContain("pull sat behind his own name");
    expect(reply).toContain("drop this into the scene");
  });

  it("asks what to press on when the writer has not asked yet", () => {
    const { reply } = buildHermeticWorkspaceChatReply(
      'Project: Harbor\nSelection focus: kind=scene · scene="The pier"'
    );
    expect(reply).toContain("On The pier");
    expect(reply).toContain("What do you want to press on first");
  });
});
