import { describe, expect, it } from "vitest";
import {
  CAPTURE_ATTACHMENT_ALLOWED_MIME_BYTE_LIMITS,
  CAPTURE_ATTACHMENT_MAX_DISPLAY_FILENAME_LENGTH,
  createCaptureAttachmentDisplayFilename,
  createCaptureAttachmentRecord,
  detectCaptureAttachmentContentType,
  isRejectedCaptureAttachmentMime,
  maxByteSizeForCaptureAttachmentMime,
  sha256Digest,
  validateDeclaredCaptureAttachment
} from "./capture-attachments.js";
import { attachmentId, captureId, projectId } from "./domain.js";

const NOW = "2026-07-24T12:00:00.000Z";

describe("capture attachment policy helpers", () => {
  it.each(Object.keys(CAPTURE_ATTACHMENT_ALLOWED_MIME_BYTE_LIMITS))(
    "accepts allowlisted MIME %s within its byte limit",
    (mime) => {
      const limit = maxByteSizeForCaptureAttachmentMime(
        mime as keyof typeof CAPTURE_ATTACHMENT_ALLOWED_MIME_BYTE_LIMITS
      );
      expect(
        validateDeclaredCaptureAttachment({
          declaredContentType: mime,
          declaredByteSize: limit
        })
      ).toEqual({ ok: true, contentType: mime });
    }
  );

  it.each([
    "application/octet-stream",
    "application/zip",
    "application/x-msdownload",
    "image/gif",
    "video/mp4"
  ])("rejects unsupported MIME %s", (mime) => {
    expect(isRejectedCaptureAttachmentMime(mime)).toBe(true);
    expect(
      validateDeclaredCaptureAttachment({
        declaredContentType: mime,
        declaredByteSize: 1
      })
    ).toEqual({ ok: false, code: "unsupported-content-type" });
  });

  it("rejects declared sizes above the MIME limit", () => {
    const limit = maxByteSizeForCaptureAttachmentMime("text/plain");
    expect(
      validateDeclaredCaptureAttachment({
        declaredContentType: "text/plain",
        declaredByteSize: limit + 1
      })
    ).toEqual({ ok: false, code: "declared-size-exceeded" });
  });

  it("validates display filenames without path or control characters", () => {
    expect(createCaptureAttachmentDisplayFilename("notes.txt")).toBe("notes.txt");
    expect(() => createCaptureAttachmentDisplayFilename("../evil.txt")).toThrow();
    expect(() =>
      createCaptureAttachmentDisplayFilename("a".repeat(CAPTURE_ATTACHMENT_MAX_DISPLAY_FILENAME_LENGTH + 1))
    ).toThrow();
  });

  it("requires coherent attachment record states", () => {
    const base = {
      attachmentId: attachmentId("att-1"),
      captureId: captureId("cap-1"),
      projectId: projectId("proj-1"),
      displayFilename: "photo.jpg",
      declaredContentType: "image/jpeg" as const,
      declaredByteSize: 3,
      clientSha256: sha256Digest("a".repeat(64).replace(/a/g, "0")),
      objectKey: "projects/proj-1/captures/cap-1/attachments/att-1",
      createdAt: NOW,
      updatedAt: NOW
    };
    expect(() =>
      createCaptureAttachmentRecord({
        ...base,
        state: "pending"
      })
    ).toThrow();
    expect(
      createCaptureAttachmentRecord({
        ...base,
        state: "pending",
        pendingExpiresAt: NOW
      }).state
    ).toBe("pending");
  });
});

describe("capture attachment content detection", () => {
  it("detects common allowlisted signatures", () => {
    expect(
      detectCaptureAttachmentContentType(new Uint8Array([0xff, 0xd8, 0xff, 0x00]))
    ).toEqual({ ok: true, contentType: "image/jpeg" });
    expect(
      detectCaptureAttachmentContentType(
        new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34])
      )
    ).toEqual({ ok: true, contentType: "application/pdf" });
    expect(
      detectCaptureAttachmentContentType(new TextEncoder().encode("Plain note."))
    ).toEqual({ ok: true, contentType: "text/plain" });
  });

  it.each([
    {
      label: "NUL in ASCII payload",
      bytes: new Uint8Array([0x68, 0x69, 0x00, 0x21])
    },
    {
      label: "DEL byte",
      bytes: new Uint8Array([0x68, 0x69, 0x7f, 0x21])
    },
    {
      label: "disallowed C0 control (ESC)",
      bytes: new Uint8Array([0x68, 0x1b, 0x69])
    },
    {
      label: "invalid UTF-8 continuation",
      bytes: new Uint8Array([0xc3, 0x28])
    },
    {
      label: "random invalid UTF-8",
      bytes: new Uint8Array([0xff, 0xfe, 0xfd])
    }
  ])("rejects non-text bytes for text/plain: $label", ({ bytes }) => {
    expect(detectCaptureAttachmentContentType(bytes)).toEqual({
      ok: false,
      reason: "unsupported-type"
    });
  });

  it.each([
    {
      label: "ZIP local header",
      bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00])
    },
    {
      label: "Windows PE (MZ)",
      bytes: new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00])
    },
    {
      label: "ELF executable",
      bytes: new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01])
    },
    {
      label: "Mach-O 64-bit LE",
      bytes: new Uint8Array([0xcf, 0xfa, 0xed, 0xfe, 0x07, 0x00, 0x00])
    }
  ])("refuses executable and archive signatures: $label", ({ bytes }) => {
    expect(detectCaptureAttachmentContentType(bytes)).toEqual({
      ok: false,
      reason: "unsupported-type"
    });
  });

  it("accepts legitimate multilingual UTF-8 with whitespace controls", () => {
    const multilingual = "Notes\tline one\n日本語\r\nEmoji 🎬";
    expect(detectCaptureAttachmentContentType(new TextEncoder().encode(multilingual))).toEqual({
      ok: true,
      contentType: "text/plain"
    });
  });

  it("allows shebang scripts as inert text/plain download references", () => {
    const script = "#!/usr/bin/env bash\necho hello\n";
    expect(detectCaptureAttachmentContentType(new TextEncoder().encode(script))).toEqual({
      ok: true,
      contentType: "text/plain"
    });
  });
});
