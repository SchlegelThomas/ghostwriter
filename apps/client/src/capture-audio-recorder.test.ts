import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildCaptureAudioRecordingDisplayFilename,
  CaptureAudioRecorderError,
  CAPTURE_AUDIO_RECORDER_ERROR_MESSAGE,
  createCaptureAudioRecorderController,
  getCaptureAudioRecorderEnvironment,
  isCaptureAudioRecordingAvailable,
  resolvePreferredCaptureAudioMime,
  type CaptureAudioRecorderEnvironment,
  type MediaDevicesLike,
  type MediaRecorderConstructorLike,
  type MediaRecorderLike,
  type MediaStreamLike,
  type MediaStreamTrackLike
} from "./capture-audio-recorder.js";

const SAMPLE_RECORDING_NOW_MS = Date.UTC(2024, 6, 24, 12, 0, 0);

function scheduleRecorderStop(
  recorder: FakeRecorderInternals,
  run: () => void
): void {
  recorder.stop = vi.fn(() => {
    queueMicrotask(run);
  }) as FakeRecorderInternals["stop"];
}

function createTestBlob(parts: BlobPart[] = ["audio-bytes"], type = "audio/webm"): Blob {
  return new Blob(parts, { type });
}

function createTrack(): MediaStreamTrackLike & { stop: ReturnType<typeof vi.fn> } {
  return { stop: vi.fn() as MediaStreamTrackLike["stop"] & ReturnType<typeof vi.fn> };
}

function createStream(tracks = [createTrack()]): MediaStreamLike {
  return { getTracks: () => tracks };
}

type FakeRecorderInternals = MediaRecorderLike & {
  start: ReturnType<typeof vi.fn>;
  stop(): void;
  emitData(data: Blob): void;
  emitStop(): void;
  emitError(): void;
};

function createFakeMediaRecorderFactory(options?: Readonly<{
  supportedMimes?: string[];
  onCreate?: (recorder: FakeRecorderInternals) => void;
}>): MediaRecorderConstructorLike {
  const supported = new Set(options?.supportedMimes ?? ["audio/webm", "audio/mp4", "audio/mpeg"]);
  const Factory = function FakeMediaRecorder(
    _stream: MediaStreamLike,
    recorderOptions?: { mimeType?: string }
  ) {
    const recorder: FakeRecorderInternals = {
      mimeType: recorderOptions?.mimeType ?? "audio/webm",
      ondataavailable: null,
      onerror: null,
      onstop: null,
      start: vi.fn(() => undefined),
      stop: vi.fn(() => undefined),
      emitData(data: Blob) {
        recorder.ondataavailable?.({ data });
      },
      emitStop() {
        recorder.onstop?.();
      },
      emitError() {
        recorder.onerror?.();
      }
    };
    options?.onCreate?.(recorder);
    return recorder;
  } as unknown as MediaRecorderConstructorLike;
  (Factory as MediaRecorderConstructorLike & { isTypeSupported(mime: string): boolean }).isTypeSupported =
    (mime: string) => supported.has(mime);
  return Factory;
}

function createEnvironment(overrides?: Partial<CaptureAudioRecorderEnvironment> & Readonly<{
  getUserMedia?: MediaDevicesLike["getUserMedia"];
  MediaRecorder?: MediaRecorderConstructorLike;
  tracks?: Array<MediaStreamTrackLike & { stop: ReturnType<typeof vi.fn> }>;
}>): CaptureAudioRecorderEnvironment {
  const tracks = overrides?.tracks ?? [createTrack()];
  const stream = createStream(tracks);
  return {
    mediaDevices: {
      getUserMedia:
        overrides?.getUserMedia ??
        vi.fn(async () => stream)
    },
    MediaRecorder:
      overrides?.MediaRecorder ?? createFakeMediaRecorderFactory(),
    Blob: globalThis.Blob,
    File: globalThis.File,
    now: overrides?.now ?? (() => SAMPLE_RECORDING_NOW_MS),
    ...overrides
  };
}

describe("resolvePreferredCaptureAudioMime", () => {
  it("prefers audio/webm when supported", () => {
    const MediaRecorder = createFakeMediaRecorderFactory({
      supportedMimes: ["audio/webm", "audio/mp4"]
    });
    expect(resolvePreferredCaptureAudioMime(MediaRecorder)).toBe("audio/webm");
  });

  it("falls back to audio/mp4 then audio/mpeg", () => {
    const mp4Only = createFakeMediaRecorderFactory({ supportedMimes: ["audio/mp4"] });
    expect(resolvePreferredCaptureAudioMime(mp4Only)).toBe("audio/mp4");

    const mpegOnly = createFakeMediaRecorderFactory({ supportedMimes: ["audio/mpeg"] });
    expect(resolvePreferredCaptureAudioMime(mpegOnly)).toBe("audio/mpeg");
  });

  it("returns undefined when no accepted mime is supported", () => {
    const MediaRecorder = createFakeMediaRecorderFactory({ supportedMimes: ["audio/ogg"] });
    expect(resolvePreferredCaptureAudioMime(MediaRecorder)).toBeUndefined();
  });
});

describe("getCaptureAudioRecorderEnvironment", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns undefined when getUserMedia is missing", () => {
    vi.stubGlobal("navigator", {});
    expect(getCaptureAudioRecorderEnvironment()).toBeUndefined();
  });

  it("returns environment when APIs exist", () => {
    const mediaDevices = { getUserMedia: vi.fn() };
    class MR {
      static isTypeSupported() {
        return true;
      }
    }
    vi.stubGlobal("navigator", { mediaDevices });
    vi.stubGlobal("MediaRecorder", MR);
    const env = getCaptureAudioRecorderEnvironment();
    expect(env?.mediaDevices).toBe(mediaDevices);
    expect(env?.MediaRecorder).toBe(MR);
  });
});

describe("isCaptureAudioRecordingAvailable", () => {
  it("is false without an environment", () => {
    expect(isCaptureAudioRecordingAvailable(undefined)).toBe(false);
  });

  it("is true with injected environment", () => {
    expect(isCaptureAudioRecordingAvailable(createEnvironment())).toBe(true);
  });
});

describe("buildCaptureAudioRecordingDisplayFilename", () => {
  it("builds a safe timestamped filename with extension", () => {
    expect(
      buildCaptureAudioRecordingDisplayFilename("audio/webm", SAMPLE_RECORDING_NOW_MS)
    ).toBe("capture-audio-20240724120000.webm");
    expect(buildCaptureAudioRecordingDisplayFilename("audio/mp4", 0)).toBe(
      "capture-audio-19700101000000.m4a"
    );
    expect(buildCaptureAudioRecordingDisplayFilename("audio/mpeg", 0)).toBe(
      "capture-audio-19700101000000.mp3"
    );
  });
});

describe("createCaptureAudioRecorderController", () => {
  it("reports unavailable when environment APIs are incomplete", async () => {
    const base = createEnvironment();
    const environment = {
      ...base,
      mediaDevices: {
        getUserMedia: undefined as unknown as MediaDevicesLike["getUserMedia"]
      }
    };
    const controller = createCaptureAudioRecorderController({ environment });
    await expect(controller.start()).rejects.toMatchObject({
      code: "unavailable",
      message: CAPTURE_AUDIO_RECORDER_ERROR_MESSAGE.unavailable
    });
  });

  it("maps microphone permission denial to a stable error and stops tracks", async () => {
    const track = createTrack();
    const environment = createEnvironment({
      tracks: [track],
      getUserMedia: vi.fn(async () => {
        throw new DOMException("denied", "NotAllowedError");
      })
    });
    const controller = createCaptureAudioRecorderController({ environment });
    await expect(controller.start()).rejects.toMatchObject({ code: "permissionDenied" });
    expect(track.stop).not.toHaveBeenCalled();
  });

  it("fails when no supported mime is available and stops acquired tracks", async () => {
    const track = createTrack();
    const environment = createEnvironment({
      tracks: [track],
      MediaRecorder: createFakeMediaRecorderFactory({ supportedMimes: [] })
    });
    const controller = createCaptureAudioRecorderController({ environment });
    await expect(controller.start()).rejects.toMatchObject({ code: "noSupportedMime" });
    expect(track.stop).toHaveBeenCalled();
  });

  it("records chunks and stop resolves a file-like result", async () => {
    let active: FakeRecorderInternals | undefined;
    const track = createTrack();
    const environment = createEnvironment({
      tracks: [track],
      MediaRecorder: createFakeMediaRecorderFactory({
        supportedMimes: ["audio/mp4"],
        onCreate: (recorder) => {
          active = recorder;
          scheduleRecorderStop(recorder, () => {
            recorder.emitData(createTestBlob(["part-a"], "audio/mp4"));
            recorder.emitStop();
          });
        }
      })
    });
    const controller = createCaptureAudioRecorderController({ environment });
    await controller.start();
    expect(controller.getState()).toBe("recording");
    active?.emitData(createTestBlob(["part-b"], "audio/mp4"));

    const result = await controller.stop();
    expect(result.contentType).toBe("audio/mp4");
    expect(result.displayFilename).toBe("capture-audio-20240724120000.m4a");
    expect(result.file.name).toBe(result.displayFilename);
    expect(result.file.type).toBe("audio/mp4");
    expect((await result.file.arrayBuffer()).byteLength).toBeGreaterThan(0);
    expect(controller.getState()).toBe("idle");
    expect(track.stop).toHaveBeenCalled();
  });

  it("rejects empty recordings and cleans up tracks", async () => {
    let active: FakeRecorderInternals | undefined;
    const track = createTrack();
    const environment = createEnvironment({
      tracks: [track],
      MediaRecorder: createFakeMediaRecorderFactory({
        onCreate: (recorder) => {
          active = recorder;
          scheduleRecorderStop(recorder, () => {
            recorder.emitData(createTestBlob([], "audio/webm"));
            recorder.emitStop();
          });
        }
      })
    });
    const controller = createCaptureAudioRecorderController({ environment });
    await controller.start();
    await expect(controller.stop()).rejects.toMatchObject({ code: "emptyRecording" });
    expect(controller.getState()).toBe("idle");
    expect(track.stop).toHaveBeenCalled();
    void active;
  });

  it("maps recorder errors to stable failures and stops tracks", async () => {
    let active: FakeRecorderInternals | undefined;
    const track = createTrack();
    const onError = vi.fn();
    const environment = createEnvironment({
      tracks: [track],
      MediaRecorder: createFakeMediaRecorderFactory({
        onCreate: (recorder) => {
          active = recorder;
          recorder.start = vi.fn(() => {
            recorder.emitError();
          });
        }
      })
    });
    const controller = createCaptureAudioRecorderController({ environment, onError });
    await controller.start();
    expect(controller.getState()).toBe("idle");
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: "recorderError" }));
    await expect(controller.stop()).rejects.toMatchObject({ code: "recorderError" });
    expect(track.stop).toHaveBeenCalled();
    void active;
  });

  it("notifies onError during recording and stop rejects the terminal error", async () => {
    let active: FakeRecorderInternals | undefined;
    const onError = vi.fn();
    const environment = createEnvironment({
      MediaRecorder: createFakeMediaRecorderFactory({
        onCreate: (recorder) => {
          active = recorder;
        }
      })
    });
    const controller = createCaptureAudioRecorderController({ environment, onError });
    await controller.start();
    active?.emitError();
    expect(onError).toHaveBeenCalledTimes(1);
    const terminal = onError.mock.calls[0]?.[0] as CaptureAudioRecorderError;
    expect(terminal.code).toBe("recorderError");
    await expect(controller.stop()).rejects.toBe(terminal);
    void active;
  });

  it("rejects stop exactly once when recorder errors while stopping", async () => {
    let active: FakeRecorderInternals | undefined;
    const track = createTrack();
    const rejectSpy = vi.fn();
    const environment = createEnvironment({
      tracks: [track],
      MediaRecorder: createFakeMediaRecorderFactory({
        onCreate: (recorder) => {
          active = recorder;
          scheduleRecorderStop(recorder, () => {
            recorder.emitError();
            recorder.emitData(createTestBlob(["late"], "audio/webm"));
            recorder.emitStop();
          });
        }
      })
    });
    const controller = createCaptureAudioRecorderController({ environment });
    await controller.start();
    const stopPromise = controller.stop().catch((error: unknown) => {
      rejectSpy(error);
      throw error;
    });
    await expect(stopPromise).rejects.toMatchObject({ code: "recorderError" });
    expect(rejectSpy).toHaveBeenCalledTimes(1);
    expect(controller.getState()).toBe("idle");
    expect(track.stop).toHaveBeenCalled();
    void active;
  });

  it("cancel stops tracks immediately when onstop never fires", async () => {
    let active: FakeRecorderInternals | undefined;
    const track = createTrack();
    const environment = createEnvironment({
      tracks: [track],
      MediaRecorder: createFakeMediaRecorderFactory({
        onCreate: (recorder) => {
          active = recorder;
          recorder.stop = vi.fn(() => undefined);
        }
      })
    });
    const controller = createCaptureAudioRecorderController({ environment });
    await controller.start();
    await controller.cancel();
    expect(controller.getState()).toBe("idle");
    expect(track.stop).toHaveBeenCalled();
    active?.emitStop();
    expect(controller.getState()).toBe("idle");
    void active;
  });

  it("ignores late recorder events after cancel cleanup", async () => {
    let active: FakeRecorderInternals | undefined;
    const onError = vi.fn();
    const environment = createEnvironment({
      MediaRecorder: createFakeMediaRecorderFactory({
        onCreate: (recorder) => {
          active = recorder;
          recorder.stop = vi.fn(() => undefined);
        }
      })
    });
    const controller = createCaptureAudioRecorderController({ environment, onError });
    await controller.start();
    await controller.cancel();
    active?.emitError();
    active?.emitData(createTestBlob(["late"], "audio/webm"));
    active?.emitStop();
    expect(onError).not.toHaveBeenCalled();
    await expect(controller.stop()).rejects.toMatchObject({ code: "invalidState" });
    void active;
  });

  it("cancel discards chunks, stops tracks, and returns to idle", async () => {
    let active: FakeRecorderInternals | undefined;
    const track = createTrack();
    const environment = createEnvironment({
      tracks: [track],
      MediaRecorder: createFakeMediaRecorderFactory({
        onCreate: (recorder) => {
          active = recorder;
          recorder.stop = vi.fn(() => undefined);
        }
      })
    });
    const controller = createCaptureAudioRecorderController({ environment });
    await controller.start();
    active?.emitData(createTestBlob(["discard-me"], "audio/webm"));
    await controller.cancel();
    expect(controller.getState()).toBe("idle");
    expect(track.stop).toHaveBeenCalled();
    active?.emitStop();
    expect(controller.getState()).toBe("idle");
  });

  it("prevents double start, stop, and cancel", async () => {
    let active: FakeRecorderInternals | undefined;
    const environment = createEnvironment({
      MediaRecorder: createFakeMediaRecorderFactory({
        onCreate: (recorder) => {
          active = recorder;
          scheduleRecorderStop(recorder, () => {
            recorder.emitData(createTestBlob(["ok"], "audio/webm"));
            recorder.emitStop();
          });
        }
      })
    });
    const controller = createCaptureAudioRecorderController({ environment });
    await controller.start();
    await expect(controller.start()).rejects.toMatchObject({ code: "invalidState" });
    const stopPromise = controller.stop();
    const duplicateStop = controller.stop();
    expect(duplicateStop).toBe(stopPromise);
    await expect(stopPromise).resolves.toMatchObject({ contentType: "audio/webm" });
    await expect(controller.stop()).rejects.toMatchObject({ code: "invalidState" });
    await controller.start();
    await expect(controller.cancel()).resolves.toBeUndefined();
    await expect(controller.cancel()).rejects.toMatchObject({ code: "invalidState" });
    void active;
  });

  it("ignores empty dataavailable chunks", async () => {
    let active: FakeRecorderInternals | undefined;
    const environment = createEnvironment({
      MediaRecorder: createFakeMediaRecorderFactory({
        onCreate: (recorder) => {
          active = recorder;
          scheduleRecorderStop(recorder, () => {
            recorder.emitData(createTestBlob([], "audio/webm"));
            recorder.emitData(createTestBlob(["real"], "audio/webm"));
            recorder.emitStop();
          });
        }
      })
    });
    const controller = createCaptureAudioRecorderController({ environment });
    await controller.start();
    active?.emitData(createTestBlob([], "audio/webm"));
    const result = await controller.stop();
    expect(await result.file.text()).toBe("real");
  });
});

describe("CaptureAudioRecorderError", () => {
  it("uses content-free messages", () => {
    const error = new CaptureAudioRecorderError("recorderError");
    expect(error.message).toBe(CAPTURE_AUDIO_RECORDER_ERROR_MESSAGE.recorderError);
    expect(error.message).not.toMatch(/denied|NotAllowed/i);
  });
});
