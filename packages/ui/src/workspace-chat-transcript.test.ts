import { describe, expect, it } from "vitest";
import { formatWorkspaceChatTranscript } from "./workspace-chat-transcript.js";

describe("formatWorkspaceChatTranscript", () => {
  it("returns empty string for no messages and no headers", () => {
    expect(formatWorkspaceChatTranscript({ messages: [] })).toBe("");
  });

  it("formats multi-role turns with blank lines between them", () => {
    expect(
      formatWorkspaceChatTranscript({
        messages: [
          { role: "user", body: "Hello there." },
          { role: "assistant", body: "**Hi!** How can I help?" },
          { role: "system", body: "Session started." }
        ]
      })
    ).toBe(
      [
        "You:",
        "Hello there.",
        "",
        "Ghostwriter:",
        "**Hi!** How can I help?",
        "",
        "System:",
        "Session started."
      ].join("\n")
    );
  });

  it("includes optional session and context headers before turns", () => {
    expect(
      formatWorkspaceChatTranscript({
        sessionTitle: "Scene polish",
        selectionSummary: "Chapter 3 · The letter",
        messages: [{ role: "user", body: "Tighten the opening." }]
      })
    ).toBe(
      [
        "Session: Scene polish",
        "Context: Chapter 3 · The letter",
        "",
        "You:",
        "Tighten the opening."
      ].join("\n")
    );
  });

  it("skips blank message bodies", () => {
    expect(
      formatWorkspaceChatTranscript({
        messages: [
          { role: "user", body: "   " },
          { role: "assistant", body: "Ready when you are." },
          { role: "system", body: "\n" }
        ]
      })
    ).toBe(["Ghostwriter:", "Ready when you are."].join("\n"));
  });
});
