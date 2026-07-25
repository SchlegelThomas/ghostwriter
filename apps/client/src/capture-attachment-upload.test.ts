import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CAPTURE_ATTACHMENT_DIRECT_UPLOAD_FAILED_MESSAGE,
  CAPTURE_ATTACHMENT_SIZE_EXCEEDED_MESSAGE,
  CAPTURE_ATTACHMENT_TYPE_REFUSED_MESSAGE,
  CAPTURE_ATTACHMENT_UPLOAD_UNAVAILABLE_MESSAGE,
  CaptureAttachmentDirectUploadError,
  computeCaptureAttachmentSha256Hex,
  createBrowserPresignedBlobUploadTransport,
  captureAttachmentDirectUploadEnvironmentAvailable,
  captureAttachmentDirectUploadTransportAvailable,
  resolveCaptureAttachmentUploadMetadata,
  uploadCaptureAttachment,
  validateCaptureAttachmentFileMetadata,
  type XMLHttpRequestUploadFactory,
  type XMLHttpRequestUploadLike
} from "./capture-attachment-upload.js";
import {
  finalizeCaptureAttachmentUpload,
  initCaptureAttachmentUpload
} from "./api.js";

vi.mock("./api.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./api.js")>();
  return {
    ...original,
    initCaptureAttachmentUpload: vi.fn(),
    finalizeCaptureAttachmentUpload: vi.fn()
  };
});

const captureScope = {
  projectId: "project / draft",
  captureId: "capture / inbox"
} as const;

const pendingAttachment = {
  attachmentId: "attachment / note",
  captureId: captureScope.captureId,
  projectId: captureScope.projectId,
  state: "pending",
  displayFilename: "note.txt",
  declaredContentType: "text/plain",
  declaredByteSize: 17,
  pendingExpiresAt: "2026-07-24T13:00:00.000Z",
  createdAt: "2026-07-24T12:00:00.000Z",
  updatedAt: "2026-07-24T12:00:00.000Z"
} as const;

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function textFile(text: string, name = "note.txt"): File {
  return new File([text], name, { type: "text/plain" });
}

function createXhrFactory(
  behavior: Readonly<{
    status?: number;
    fail?: "error" | "abort";
    progress?: readonly CaptureAttachmentUploadProgress[];
  }>
): XMLHttpRequestUploadFactory {
  return () => {
    const uploadProgressListeners: Array<
      (event: ProgressEvent<EventTarget>) => void
    > = [];
    const listeners: Partial<
      Record<"load" | "error" | "abort", Array<() => void>>
    > = {};
    const xhr: XMLHttpRequestUploadLike = {
      status: behavior.status ?? 200,
      open: vi.fn(),
      setRequestHeader: vi.fn(),
      abort: vi.fn(),
      upload: {
        addEventListener(type, listener) {
          if (type === "progress") {
            uploadProgressListeners.push(listener);
          }
        }
      },
      addEventListener(type, listener) {
        const existing = listeners[type] ?? [];
        listeners[type] = [...existing, listener];
      },
      send: vi.fn(() => {
        for (const step of behavior.progress ?? []) {
          for (const listener of uploadProgressListeners) {
            listener({
              lengthComputable: true,
              loaded: step.loaded,
              total: step.total
            } as ProgressEvent<EventTarget>);
          }
        }
        if (behavior.fail === "error") {
          listeners.error?.forEach((listener) => listener());
          return;
        }
        if (behavior.fail === "abort") {
          listeners.abort?.forEach((listener) => listener());
          return;
        }
        listeners.load?.forEach((listener) => listener());
      })
    };
    return xhr;
  };
}

type CaptureAttachmentUploadProgress = Readonly<{
  loaded: number;
  total: number;
}>;

describe("capture attachment upload", () => {
  it("computes lowercase SHA-256 digests for attachment bytes", async () => {
    const blob = new Blob(["Hello attachment client."]);
    await expect(computeCaptureAttachmentSha256Hex(blob)).resolves.toBe(
      "9bb203405a339720997b4ad52e8d48fe1bc6b303b7ba3280177d5ae1d146fc93"
    );
  });

  it("rejects client policy boundaries before init", () => {
    expect(() =>
      validateCaptureAttachmentFileMetadata({
        displayFilename: "note.txt",
        declaredContentType: "application/zip",
        declaredByteSize: 100
      })
    ).toThrow(
      expect.objectContaining({
        code: "ATTACHMENT_TYPE_REFUSED",
        message: CAPTURE_ATTACHMENT_TYPE_REFUSED_MESSAGE
      })
    );

    expect(() =>
      validateCaptureAttachmentFileMetadata({
        displayFilename: "note.txt",
        declaredContentType: "text/plain",
        declaredByteSize: 6 * 1024 * 1024
      })
    ).toThrow(
      expect.objectContaining({
        code: "ATTACHMENT_SIZE_EXCEEDED",
        message: CAPTURE_ATTACHMENT_SIZE_EXCEEDED_MESSAGE
      })
    );
  });

  it("reports unavailable environments without throwing from metadata helpers", () => {
    expect(
      captureAttachmentDirectUploadEnvironmentAvailable({
        crypto: undefined,
        Blob: undefined
      })
    ).toBe(false);
    expect(
      captureAttachmentDirectUploadTransportAvailable({
        XMLHttpRequest: undefined
      })
    ).toBe(false);
  });

  it("accepts Blob uploads with an explicit filename when File is absent", () => {
    vi.stubGlobal("File", undefined);
    const blob = new Blob(["Blob-only body."], { type: "text/plain" });

    expect(() =>
      resolveCaptureAttachmentUploadMetadata(blob)
    ).toThrow(
      expect.objectContaining({
        code: "INVALID_REQUEST"
      })
    );

    expect(
      resolveCaptureAttachmentUploadMetadata(blob, "explicit-note.txt")
    ).toEqual({
      displayFilename: "explicit-note.txt",
      declaredContentType: "text/plain",
      declaredByteSize: blob.size
    });
  });

  it("uploads with exact Content-Type, monotonic progress, finalize on PUT success", async () => {
    const file = textFile("Ready attachment.");
    const sha = await computeCaptureAttachmentSha256Hex(file);
    const initResponse = {
      attachment: pendingAttachment,
      upload: {
        url: "https://signed.example.test/put/object?sig=secret",
        expiresAt: "2026-07-24T12:15:00.000Z"
      },
      uploadHeaders: { "Content-Type": "text/plain" }
    };
    vi.mocked(initCaptureAttachmentUpload).mockResolvedValue(initResponse);
    vi.mocked(finalizeCaptureAttachmentUpload).mockResolvedValue({
      attachment: {
        ...pendingAttachment,
        state: "ready",
        readyContentType: "text/plain",
        actualByteSize: file.size,
        readyAt: "2026-07-24T12:05:00.000Z",
        pendingExpiresAt: undefined
      }
    });

    const progress: CaptureAttachmentUploadProgress[] = [];
    let uploadXhr: XMLHttpRequestUploadLike | undefined;
    const innerXhrFactory = createXhrFactory({
      progress: [
        { loaded: 4, total: 17 },
        { loaded: 17, total: 17 },
        { loaded: 10, total: 17 }
      ]
    });
    const xhrFactory: XMLHttpRequestUploadFactory = () => {
      uploadXhr = innerXhrFactory();
      return uploadXhr;
    };
    const transport = createBrowserPresignedBlobUploadTransport(xhrFactory);

    await expect(
      uploadCaptureAttachment({
        scope: captureScope,
        file,
        transport,
        onProgress: (event) => {
          progress.push(event);
        }
      })
    ).resolves.toMatchObject({ state: "ready" });

    expect(initCaptureAttachmentUpload).toHaveBeenCalledWith({
      ...captureScope,
      displayFilename: "note.txt",
      declaredContentType: "text/plain",
      declaredByteSize: file.size,
      clientSha256: sha
    });
    expect(finalizeCaptureAttachmentUpload).toHaveBeenCalledWith({
      ...captureScope,
      attachmentId: pendingAttachment.attachmentId
    });

    expect(uploadXhr?.setRequestHeader).toHaveBeenCalledWith(
      "Content-Type",
      "text/plain"
    );
    expect(progress).toEqual([
      { loaded: 4, total: 17 },
      { loaded: 17, total: 17 },
      { loaded: 17, total: 17 }
    ]);
  });

  it("does not finalize after direct upload failure and keeps errors content-free", async () => {
    vi.mocked(initCaptureAttachmentUpload).mockResolvedValue({
      attachment: pendingAttachment,
      upload: {
        url: "https://signed.example.test/put/object?sig=secret",
        expiresAt: "2026-07-24T12:15:00.000Z"
      },
      uploadHeaders: { "Content-Type": "text/plain" }
    });

    const transport = createBrowserPresignedBlobUploadTransport(
      createXhrFactory({ status: 403 })
    );

    await expect(
      uploadCaptureAttachment({
        scope: captureScope,
        file: textFile("Will fail."),
        transport
      })
    ).rejects.toEqual(
      expect.objectContaining({
        code: "ATTACHMENT_DIRECT_UPLOAD_FAILED",
        message: CAPTURE_ATTACHMENT_DIRECT_UPLOAD_FAILED_MESSAGE
      })
    );
    expect(finalizeCaptureAttachmentUpload).not.toHaveBeenCalled();
    await expect(
      uploadCaptureAttachment({
        scope: captureScope,
        file: textFile("Network fail."),
        transport: createBrowserPresignedBlobUploadTransport(
          createXhrFactory({ fail: "error" })
        )
      })
    ).rejects.toMatchObject({
      message: CAPTURE_ATTACHMENT_DIRECT_UPLOAD_FAILED_MESSAGE
    });
    expect(String(new CaptureAttachmentDirectUploadError())).not.toMatch(
      /signed\.example|sig=/
    );
  });

  it("returns refused finalize summaries without treating them as transport failures", async () => {
    vi.mocked(initCaptureAttachmentUpload).mockResolvedValue({
      attachment: pendingAttachment,
      upload: {
        url: "https://signed.example.test/put/object",
        expiresAt: "2026-07-24T12:15:00.000Z"
      },
      uploadHeaders: { "Content-Type": "text/plain" }
    });
    vi.mocked(finalizeCaptureAttachmentUpload).mockResolvedValue({
      attachment: {
        ...pendingAttachment,
        state: "refused",
        refusalCode: "type-mismatch",
        pendingExpiresAt: undefined
      }
    });

    const transport = createBrowserPresignedBlobUploadTransport(
      createXhrFactory({ status: 200 })
    );

    await expect(
      uploadCaptureAttachment({
        scope: captureScope,
        file: textFile("Wrong bytes."),
        transport
      })
    ).resolves.toMatchObject({
      state: "refused",
      refusalCode: "type-mismatch"
    });
  });

  it("refuses unavailable upload environments before calling init", async () => {
    const unavailableCrypto = {} as Crypto;

    await expect(
      uploadCaptureAttachment({
        scope: captureScope,
        file: textFile("Unavailable."),
        crypto: unavailableCrypto
      })
    ).rejects.toEqual(
      expect.objectContaining({
        code: "ATTACHMENT_UPLOAD_UNAVAILABLE",
        message: CAPTURE_ATTACHMENT_UPLOAD_UNAVAILABLE_MESSAGE
      })
    );
    expect(initCaptureAttachmentUpload).not.toHaveBeenCalled();
  });
});
