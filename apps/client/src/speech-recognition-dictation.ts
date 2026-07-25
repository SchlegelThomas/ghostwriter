export type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult:
    | ((event: { results: ArrayLike<{ 0: { transcript: string } }> }) => void)
    | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};

export type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

export const DICTATION_STATUS = {
  unavailable: "Dictation is unavailable in this browser.",
  listening: "Listening — speech enters the Draft caret.",
  couldNotStart: "Could not start dictation.",
  stopped:
    "Dictation stopped — microphone permission or engine error."
} as const;

export type DictationStatusCopy = Readonly<{
  unavailable: string;
  listening: string;
  couldNotStart: string;
  stopped: string;
}>;

export function resolveDictationStatusCopy(
  statusCopy?: Partial<DictationStatusCopy>
): DictationStatusCopy {
  return {
    unavailable: statusCopy?.unavailable ?? DICTATION_STATUS.unavailable,
    listening: statusCopy?.listening ?? DICTATION_STATUS.listening,
    couldNotStart: statusCopy?.couldNotStart ?? DICTATION_STATUS.couldNotStart,
    stopped: statusCopy?.stopped ?? DICTATION_STATUS.stopped
  };
}

export type DictationStatusSessionCallbacks = Readonly<{
  onUnavailable(): void;
  onListening(): void;
  onStartFailed(): void;
  onEngineError(): void;
  onRestartFailed(): void;
}>;

export function createDictationStatusSessionCallbacks(deps: Readonly<{
  statusCopy?: Partial<DictationStatusCopy>;
  setAssistStatus(status: string | undefined): void;
  onStopDictation(): void;
}>): DictationStatusSessionCallbacks {
  const copy = resolveDictationStatusCopy(deps.statusCopy);
  return {
    onUnavailable: () => {
      deps.setAssistStatus(copy.unavailable);
      deps.onStopDictation();
    },
    onListening: () => {
      deps.setAssistStatus(copy.listening);
    },
    onStartFailed: () => {
      deps.setAssistStatus(copy.couldNotStart);
      deps.onStopDictation();
    },
    onEngineError: () => {
      deps.setAssistStatus(copy.stopped);
      deps.onStopDictation();
    },
    onRestartFailed: () => {
      deps.onStopDictation();
    }
  };
}

export function getSpeechRecognitionConstructor(
  host: Window | undefined = typeof window === "undefined" ? undefined : window
): SpeechRecognitionConstructor | undefined {
  if (host === undefined) return undefined;
  const extended = host as Window &
    Readonly<{
      SpeechRecognition?: SpeechRecognitionConstructor;
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
    }>;
  return extended.SpeechRecognition ?? extended.webkitSpeechRecognition;
}

export type DictationRecognitionHandlers = Readonly<{
  onInsertProse(text: string): void;
  shouldKeepListening(): boolean;
  onEngineError(): void;
  onRestartFailed(): void;
}>;

export function wireDictationRecognition(
  recognition: SpeechRecognitionLike,
  handlers: DictationRecognitionHandlers
): void {
  recognition.continuous = true;
  recognition.interimResults = false;
  recognition.lang = "en-US";
  recognition.onresult = (event) => {
    const result = event.results[event.results.length - 1];
    const transcript = result?.[0]?.transcript?.trim();
    if (transcript !== undefined && transcript.length > 0) {
      handlers.onInsertProse(`${transcript} `);
    }
  };
  recognition.onerror = () => {
    handlers.onEngineError();
  };
  recognition.onend = () => {
    if (handlers.shouldKeepListening()) {
      try {
        recognition.start();
      } catch {
        handlers.onRestartFailed();
      }
    }
  };
}

export function detachDictationRecognition(
  recognition: SpeechRecognitionLike
): void {
  recognition.onresult = null;
  recognition.onerror = null;
  recognition.onend = null;
  recognition.stop();
}

export type StartDictationSessionOptions = Readonly<{
  getConstructor?: () => SpeechRecognitionConstructor | undefined;
  onInsertProse(text: string): void;
  shouldKeepListening(): boolean;
  onUnavailable(): void;
  onListening(): void;
  onStartFailed(): void;
  onEngineError(): void;
  onRestartFailed(): void;
}>;

export function startDictationSession(
  options: StartDictationSessionOptions
): SpeechRecognitionLike | undefined {
  const getConstructor =
    options.getConstructor ?? getSpeechRecognitionConstructor;
  const Ctor = getConstructor();
  if (Ctor === undefined) {
    options.onUnavailable();
    return undefined;
  }
  const recognition = new Ctor();
  wireDictationRecognition(recognition, {
    onInsertProse: options.onInsertProse,
    shouldKeepListening: options.shouldKeepListening,
    onEngineError: options.onEngineError,
    onRestartFailed: options.onRestartFailed
  });
  try {
    recognition.start();
    options.onListening();
  } catch {
    options.onStartFailed();
  }
  return recognition;
}
