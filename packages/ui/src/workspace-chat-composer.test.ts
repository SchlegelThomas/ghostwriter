import { describe, expect, it } from "vitest";
import {
  composerAttachmentKindFromMime,
  resolveComposerSendMessage,
  shouldSubmitChatOnEnterKey,
  WORKSPACE_CHAT_MAX_ATTACHMENTS
} from "./workspace-chat-composer.js";

describe("workspace-chat-composer", () => {
  it("sends on Enter without Shift", () => {
    expect(shouldSubmitChatOnEnterKey({ key: "Enter", shiftKey: false })).toBe(
      true
    );
  });

  it("does not send on Shift+Enter", () => {
    expect(shouldSubmitChatOnEnterKey({ key: "Enter", shiftKey: true })).toBe(
      false
    );
  });

  it("does not send during IME composition", () => {
    expect(
      shouldSubmitChatOnEnterKey({
        key: "Enter",
        shiftKey: false,
        nativeEvent: { isComposing: true }
      })
    ).toBe(false);
    expect(
      shouldSubmitChatOnEnterKey({
        key: "Enter",
        shiftKey: false,
        nativeEvent: { keyCode: 229 }
      })
    ).toBe(false);
  });

  it("does not send on native-shaped Enter without top-level key", () => {
    expect(
      shouldSubmitChatOnEnterKey({
        nativeEvent: { key: "Enter" }
      })
    ).toBe(false);
  });

  it("ignores non-Enter keys", () => {
    expect(shouldSubmitChatOnEnterKey({ key: "a", shiftKey: false })).toBe(
      false
    );
  });

  it("classifies attachment mime types", () => {
    expect(composerAttachmentKindFromMime("image/png")).toBe("image");
    expect(composerAttachmentKindFromMime("video/mp4")).toBe("video");
    expect(composerAttachmentKindFromMime("text/plain")).toBeUndefined();
  });

  it("builds a fallback message when only attachments are sent", () => {
    expect(
      resolveComposerSendMessage("", [
        Object.freeze({
          id: "a1",
          kind: "image" as const,
          name: "cover.png",
          mimeType: "image/png",
          byteLength: 100
        })
      ])
    ).toBe("Attached: cover.png");
  });

  it("caps attachment count constant", () => {
    expect(WORKSPACE_CHAT_MAX_ATTACHMENTS).toBe(3);
  });
});
