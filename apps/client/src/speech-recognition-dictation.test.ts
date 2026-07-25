import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDictationStatusSessionCallbacks,
  detachDictationRecognition,
  DICTATION_STATUS,
  getSpeechRecognitionConstructor,
  resolveDictationStatusCopy,
  startDictationSession,
  wireDictationRecognition,
  type SpeechRecognitionLike
} from "./speech-recognition-dictation.js";

function fakeRecognition() {
  const start = vi.fn<() => void>();
  const stop = vi.fn<() => void>();
  const recognition: SpeechRecognitionLike = {
    continuous: false,
    interimResults: true,
    lang: "",
    onresult: null,
    onerror: null,
    onend: null,
    start,
    stop
  };
  return Object.assign(recognition, { start, stop });
}

describe("getSpeechRecognitionConstructor", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns undefined when window is missing", () => {
    expect(getSpeechRecognitionConstructor(undefined)).toBeUndefined();
  });

  it("prefers SpeechRecognition over webkitSpeechRecognition", () => {
    class Standard {}
    class Webkit {}
    vi.stubGlobal("window", {
      SpeechRecognition: Standard,
      webkitSpeechRecognition: Webkit
    });
    expect(getSpeechRecognitionConstructor(window as unknown as Window)).toBe(
      Standard
    );
  });

  it("falls back to webkitSpeechRecognition", () => {
    class Webkit {}
    vi.stubGlobal("window", { webkitSpeechRecognition: Webkit });
    expect(getSpeechRecognitionConstructor(window as unknown as Window)).toBe(
      Webkit
    );
  });
});

describe("wireDictationRecognition", () => {
  it("delivers trimmed transcript with trailing space", () => {
    const recognition = fakeRecognition();
    const onInsertProse = vi.fn();
    wireDictationRecognition(recognition, {
      onInsertProse,
      shouldKeepListening: () => false,
      onEngineError: vi.fn(),
      onRestartFailed: vi.fn()
    });
    expect(recognition.continuous).toBe(true);
    expect(recognition.interimResults).toBe(false);
    expect(recognition.lang).toBe("en-US");

    recognition.onresult?.({
      results: [{ 0: { transcript: "  hello there  " } }]
    });
    expect(onInsertProse).toHaveBeenCalledWith("hello there ");
  });

  it("ignores empty transcripts", () => {
    const recognition = fakeRecognition();
    const onInsertProse = vi.fn();
    wireDictationRecognition(recognition, {
      onInsertProse,
      shouldKeepListening: () => false,
      onEngineError: vi.fn(),
      onRestartFailed: vi.fn()
    });
    recognition.onresult?.({ results: [{ 0: { transcript: "   " } }] });
    expect(onInsertProse).not.toHaveBeenCalled();
  });

  it("restarts when still listening", () => {
    const recognition = fakeRecognition();
    wireDictationRecognition(recognition, {
      onInsertProse: vi.fn(),
      shouldKeepListening: () => true,
      onEngineError: vi.fn(),
      onRestartFailed: vi.fn()
    });
    recognition.onend?.();
    expect(recognition.start).toHaveBeenCalledTimes(1);
  });

  it("calls onRestartFailed when restart throws", () => {
    const recognition = fakeRecognition();
    recognition.start.mockImplementation(() => {
      throw new Error("busy");
    });
    const onRestartFailed = vi.fn();
    wireDictationRecognition(recognition, {
      onInsertProse: vi.fn(),
      shouldKeepListening: () => true,
      onEngineError: vi.fn(),
      onRestartFailed
    });
    recognition.onend?.();
    expect(onRestartFailed).toHaveBeenCalledTimes(1);
  });

  it("forwards engine errors", () => {
    const recognition = fakeRecognition();
    const onEngineError = vi.fn();
    wireDictationRecognition(recognition, {
      onInsertProse: vi.fn(),
      shouldKeepListening: () => false,
      onEngineError,
      onRestartFailed: vi.fn()
    });
    recognition.onerror?.();
    expect(onEngineError).toHaveBeenCalledTimes(1);
  });
});

describe("detachDictationRecognition", () => {
  it("clears handlers and stops", () => {
    const recognition = fakeRecognition();
    recognition.onresult = vi.fn();
    recognition.onerror = vi.fn();
    recognition.onend = vi.fn();
    detachDictationRecognition(recognition);
    expect(recognition.onresult).toBeNull();
    expect(recognition.onerror).toBeNull();
    expect(recognition.onend).toBeNull();
    expect(recognition.stop).toHaveBeenCalledTimes(1);
  });
});

describe("startDictationSession", () => {
  it("reports unavailable when constructor is missing", () => {
    const onUnavailable = vi.fn();
    const recognition = startDictationSession({
      getConstructor: () => undefined,
      onInsertProse: vi.fn(),
      shouldKeepListening: () => false,
      onUnavailable,
      onListening: vi.fn(),
      onStartFailed: vi.fn(),
      onEngineError: vi.fn(),
      onRestartFailed: vi.fn()
    });
    expect(recognition).toBeUndefined();
    expect(onUnavailable).toHaveBeenCalledTimes(1);
  });

  it("starts listening with status callback on success", () => {
    const recognition = fakeRecognition();
    class Ctor {
      constructor() {
        return recognition;
      }
    }
    const onListening = vi.fn();
    const session = startDictationSession({
      getConstructor: () => Ctor as never,
      onInsertProse: vi.fn(),
      shouldKeepListening: () => true,
      onUnavailable: vi.fn(),
      onListening,
      onStartFailed: vi.fn(),
      onEngineError: vi.fn(),
      onRestartFailed: vi.fn()
    });
    expect(session).toBe(recognition);
    expect(recognition.start).toHaveBeenCalledTimes(1);
    expect(onListening).toHaveBeenCalledTimes(1);
  });

  it("reports start failure without throwing", () => {
    const recognition = fakeRecognition();
    recognition.start.mockImplementation(() => {
      throw new Error("denied");
    });
    class Ctor {
      constructor() {
        return recognition;
      }
    }
    const onStartFailed = vi.fn();
    const session = startDictationSession({
      getConstructor: () => Ctor as never,
      onInsertProse: vi.fn(),
      shouldKeepListening: () => false,
      onUnavailable: vi.fn(),
      onListening: vi.fn(),
      onStartFailed,
      onEngineError: vi.fn(),
      onRestartFailed: vi.fn()
    });
    expect(session).toBe(recognition);
    expect(onStartFailed).toHaveBeenCalledTimes(1);
  });
});

describe("resolveDictationStatusCopy", () => {
  it("defaults to DICTATION_STATUS when omitted", () => {
    expect(resolveDictationStatusCopy()).toEqual(DICTATION_STATUS);
  });

  it("merges partial overrides while keeping other defaults", () => {
    expect(
      resolveDictationStatusCopy({
        listening: "Listening — speech enters the Capture caret."
      })
    ).toEqual({
      ...DICTATION_STATUS,
      listening: "Listening — speech enters the Capture caret."
    });
  });
});

describe("createDictationStatusSessionCallbacks", () => {
  it("uses custom listening copy at the hook seam", () => {
    const setAssistStatus = vi.fn();
    const onStopDictation = vi.fn();
    const captureListening = "Listening — speech enters the Capture caret.";
    const callbacks = createDictationStatusSessionCallbacks({
      statusCopy: { listening: captureListening },
      setAssistStatus,
      onStopDictation
    });
    callbacks.onListening();
    expect(setAssistStatus).toHaveBeenCalledWith(captureListening);
    expect(onStopDictation).not.toHaveBeenCalled();
  });

  it("keeps default unavailable copy when only listening is overridden", () => {
    const setAssistStatus = vi.fn();
    const callbacks = createDictationStatusSessionCallbacks({
      statusCopy: {
        listening: "Listening — speech enters the Capture caret."
      },
      setAssistStatus,
      onStopDictation: vi.fn()
    });
    callbacks.onUnavailable();
    expect(setAssistStatus).toHaveBeenCalledWith(DICTATION_STATUS.unavailable);
  });
});

describe("DICTATION_STATUS", () => {
  it("matches shipped writer-facing copy", () => {
    expect(DICTATION_STATUS.unavailable).toBe(
      "Dictation is unavailable in this browser."
    );
    expect(DICTATION_STATUS.listening).toBe(
      "Listening — speech enters the Draft caret."
    );
    expect(DICTATION_STATUS.couldNotStart).toBe("Could not start dictation.");
    expect(DICTATION_STATUS.stopped).toBe(
      "Dictation stopped — microphone permission or engine error."
    );
  });
});
