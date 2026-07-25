import type { CaptureAttachmentAllowedMime } from "@ghostwriter/core";

export const CAPTURE_AUDIO_MIME_PREFERENCE = [
  "audio/webm",
  "audio/mp4",
  "audio/mpeg"
] as const satisfies readonly CaptureAttachmentAllowedMime[];

export type CaptureAudioAcceptedMime = (typeof CAPTURE_AUDIO_MIME_PREFERENCE)[number];

export const CAPTURE_AUDIO_RECORDER_ERROR_MESSAGE = {
  unavailable: "Audio recording is unavailable in this browser.",
  permissionDenied: "Microphone permission was denied.",
  noSupportedMime: "This browser cannot record audio in a supported format.",
  recorderError: "Audio recording failed.",
  emptyRecording: "The recording contained no audio.",
  invalidState: "Audio recording is not in the expected state."
} as const;

export type CaptureAudioRecorderErrorCode = keyof typeof CAPTURE_AUDIO_RECORDER_ERROR_MESSAGE;

export class CaptureAudioRecorderError extends Error {
  readonly code: CaptureAudioRecorderErrorCode;

  constructor(code: CaptureAudioRecorderErrorCode) {
    super(CAPTURE_AUDIO_RECORDER_ERROR_MESSAGE[code]);
    this.name = "CaptureAudioRecorderError";
    this.code = code;
  }
}

export type MediaStreamTrackLike = Readonly<{
  stop(): void;
}>;

export type MediaStreamLike = Readonly<{
  getTracks(): MediaStreamTrackLike[];
}>;

export type MediaDevicesLike = Readonly<{
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStreamLike>;
}>;

export type MediaRecorderLike = {
  mimeType: string;
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onerror: (() => void) | null;
  onstop: (() => void) | null;
  start(): void;
  stop(): void;
};

export type MediaRecorderConstructorLike = {
  new (stream: MediaStreamLike, options?: { mimeType?: string }): MediaRecorderLike;
  isTypeSupported(mimeType: string): boolean;
};

export type CaptureAudioRecorderEnvironment = Readonly<{
  mediaDevices: MediaDevicesLike;
  MediaRecorder: MediaRecorderConstructorLike;
  Blob: typeof Blob;
  File: typeof File;
  now(): number;
}>;

export type CaptureAudioRecorderState = "idle" | "recording" | "stopping";

export type CaptureAudioRecordingResult = Readonly<{
  file: File;
  contentType: CaptureAudioAcceptedMime;
  displayFilename: string;
}>;

export type CaptureAudioRecorderController = Readonly<{
  getState(): CaptureAudioRecorderState;
  start(): Promise<void>;
  stop(): Promise<CaptureAudioRecordingResult>;
  cancel(): Promise<void>;
}>;

const MIME_TO_EXTENSION: Readonly<Record<CaptureAudioAcceptedMime, string>> = {
  "audio/webm": "webm",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3"
};

export function resolvePreferredCaptureAudioMime(
  MediaRecorder: MediaRecorderConstructorLike
): CaptureAudioAcceptedMime | undefined {
  for (const mime of CAPTURE_AUDIO_MIME_PREFERENCE) {
    if (MediaRecorder.isTypeSupported(mime)) {
      return mime;
    }
  }
  return undefined;
}

export function getCaptureAudioRecorderEnvironment(
  host: typeof globalThis = globalThis
): CaptureAudioRecorderEnvironment | undefined {
  const navigatorLike = host.navigator as
    | (Navigator & { mediaDevices?: MediaDevicesLike })
    | undefined;
  if (navigatorLike?.mediaDevices?.getUserMedia === undefined) {
    return undefined;
  }
  const MediaRecorder = (
    host as typeof globalThis & { MediaRecorder?: MediaRecorderConstructorLike }
  ).MediaRecorder;
  if (MediaRecorder === undefined || typeof MediaRecorder.isTypeSupported !== "function") {
    return undefined;
  }
  if (host.Blob === undefined || host.File === undefined) {
    return undefined;
  }
  return {
    mediaDevices: navigatorLike.mediaDevices,
    MediaRecorder,
    Blob: host.Blob,
    File: host.File,
    now: () => Date.now()
  };
}

export function isCaptureAudioRecordingAvailable(
  environment: CaptureAudioRecorderEnvironment | undefined = getCaptureAudioRecorderEnvironment()
): boolean {
  if (environment === undefined) {
    return false;
  }
  return (
    typeof environment.mediaDevices.getUserMedia === "function" &&
    typeof environment.MediaRecorder.isTypeSupported === "function"
  );
}

export function buildCaptureAudioRecordingDisplayFilename(
  contentType: CaptureAudioAcceptedMime,
  nowMs: number
): string {
  const date = new Date(nowMs);
  const stamp = [
    date.getUTCFullYear(),
    pad2(date.getUTCMonth() + 1),
    pad2(date.getUTCDate()),
    pad2(date.getUTCHours()),
    pad2(date.getUTCMinutes()),
    pad2(date.getUTCSeconds())
  ].join("");
  return `capture-audio-${stamp}.${MIME_TO_EXTENSION[contentType]}`;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function stopAllTracks(stream: MediaStreamLike | undefined): void {
  if (stream === undefined) return;
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

function detachRecorderHandlers(activeRecorder: MediaRecorderLike | undefined): void {
  if (activeRecorder === undefined) return;
  activeRecorder.ondataavailable = null;
  activeRecorder.onerror = null;
  activeRecorder.onstop = null;
}

function isPermissionDeniedError(cause: unknown): boolean {
  if (!(cause instanceof DOMException)) return false;
  return cause.name === "NotAllowedError" || cause.name === "PermissionDeniedError";
}

function isNonEmptyBlobPart(data: Blob): boolean {
  return data.size > 0;
}

export function createCaptureAudioRecorderController(deps: Readonly<{
  environment: CaptureAudioRecorderEnvironment;
  onError?(error: CaptureAudioRecorderError): void;
}>): CaptureAudioRecorderController {
  const { environment, onError } = deps;
  let state: CaptureAudioRecorderState = "idle";
  let stream: MediaStreamLike | undefined;
  let recorder: MediaRecorderLike | undefined;
  let chunks: Blob[] = [];
  let selectedMime: CaptureAudioAcceptedMime | undefined;
  let stopPromise: Promise<CaptureAudioRecordingResult> | undefined;
  let stopResolve: ((result: CaptureAudioRecordingResult) => void) | undefined;
  let stopReject: ((error: CaptureAudioRecorderError) => void) | undefined;
  let stopSettled = false;
  let terminalError: CaptureAudioRecorderError | undefined;

  const clearActiveSession = (): void => {
    detachRecorderHandlers(recorder);
    stopAllTracks(stream);
    stream = undefined;
    recorder = undefined;
    chunks = [];
    selectedMime = undefined;
    stopPromise = undefined;
    stopResolve = undefined;
    stopReject = undefined;
    stopSettled = false;
    state = "idle";
  };

  const failStart = (code: CaptureAudioRecorderErrorCode): CaptureAudioRecorderError => {
    terminalError = undefined;
    clearActiveSession();
    return new CaptureAudioRecorderError(code);
  };

  const rejectStopPromise = (error: CaptureAudioRecorderError): void => {
    if (stopSettled) return;
    stopSettled = true;
    const reject = stopReject;
    clearActiveSession();
    reject?.(error);
  };

  const resolveStopPromise = (result: CaptureAudioRecordingResult): void => {
    if (stopSettled) return;
    stopSettled = true;
    const resolve = stopResolve;
    clearActiveSession();
    resolve?.(result);
  };

  const rejectStop = (code: CaptureAudioRecorderErrorCode): void => {
    rejectStopPromise(new CaptureAudioRecorderError(code));
  };

  const handleRecorderError = (): void => {
    const error = new CaptureAudioRecorderError("recorderError");
    if (state === "stopping") {
      rejectStopPromise(error);
      return;
    }
    if (state === "recording") {
      terminalError = error;
      onError?.(error);
      clearActiveSession();
      return;
    }
  };

  const finalizeStop = (): void => {
    if (stopSettled) return;

    const mime = selectedMime;
    if (mime === undefined || stopResolve === undefined) {
      rejectStop("recorderError");
      return;
    }

    const nonemptyChunks = chunks.filter(isNonEmptyBlobPart);
    if (nonemptyChunks.length === 0) {
      rejectStop("emptyRecording");
      return;
    }

    const blob = new environment.Blob(nonemptyChunks, { type: mime });
    if (blob.size === 0) {
      rejectStop("emptyRecording");
      return;
    }

    const displayFilename = buildCaptureAudioRecordingDisplayFilename(
      mime,
      environment.now()
    );
    const file = new environment.File([blob], displayFilename, { type: mime });
    resolveStopPromise({
      file,
      contentType: mime,
      displayFilename
    });
  };

  return {
    getState: () => state,

    async start(): Promise<void> {
      if (state !== "idle") {
        throw new CaptureAudioRecorderError("invalidState");
      }
      terminalError = undefined;
      if (!isCaptureAudioRecordingAvailable(environment)) {
        throw failStart("unavailable");
      }

      try {
        stream = await environment.mediaDevices.getUserMedia({ audio: true, video: false });
      } catch (cause) {
        if (isPermissionDeniedError(cause)) {
          throw failStart("permissionDenied");
        }
        throw failStart("unavailable");
      }

      const mime = resolvePreferredCaptureAudioMime(environment.MediaRecorder);
      if (mime === undefined) {
        throw failStart("noSupportedMime");
      }
      selectedMime = mime;

      let activeRecorder: MediaRecorderLike;
      try {
        activeRecorder = new environment.MediaRecorder(stream, { mimeType: mime });
      } catch {
        throw failStart("noSupportedMime");
      }
      recorder = activeRecorder;

      chunks = [];
      activeRecorder.ondataavailable = (event: { data: Blob }) => {
        if (isNonEmptyBlobPart(event.data)) {
          chunks.push(event.data);
        }
      };
      activeRecorder.onerror = () => {
        handleRecorderError();
      };
      activeRecorder.onstop = () => {
        finalizeStop();
      };

      state = "recording";
      try {
        activeRecorder.start();
      } catch {
        throw failStart("recorderError");
      }
    },

    stop(): Promise<CaptureAudioRecordingResult> {
      if (state === "idle") {
        if (terminalError !== undefined) {
          return Promise.reject(terminalError);
        }
        return Promise.reject(new CaptureAudioRecorderError("invalidState"));
      }
      if (state === "stopping") {
        if (stopPromise === undefined) {
          return Promise.reject(new CaptureAudioRecorderError("invalidState"));
        }
        return stopPromise;
      }

      state = "stopping";
      stopSettled = false;
      stopPromise = new Promise<CaptureAudioRecordingResult>((resolve, reject) => {
        stopResolve = resolve;
        stopReject = reject;
      });

      try {
        recorder?.stop();
      } catch {
        rejectStop("recorderError");
      }

      return stopPromise;
    },

    cancel(): Promise<void> {
      if (state !== "recording") {
        return Promise.reject(new CaptureAudioRecorderError("invalidState"));
      }
      detachRecorderHandlers(recorder);
      try {
        recorder?.stop();
      } catch {
        clearActiveSession();
        return Promise.resolve();
      }
      clearActiveSession();
      return Promise.resolve();
    }
  };
}
