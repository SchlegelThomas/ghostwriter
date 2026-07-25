import { useEffect, useRef } from "react";
import {
  createDictationStatusSessionCallbacks,
  detachDictationRecognition,
  startDictationSession,
  type DictationStatusCopy,
  type SpeechRecognitionLike
} from "./speech-recognition-dictation.js";

export type UseDictationSpeechRecognitionOptions = Readonly<{
  active: boolean;
  onInsertProse(text: string): void;
  onStopDictation(): void;
  setAssistStatus(status: string | undefined): void;
  statusCopy?: Partial<DictationStatusCopy>;
}>;

export function useDictationSpeechRecognition({
  active,
  onInsertProse,
  onStopDictation,
  setAssistStatus,
  statusCopy
}: UseDictationSpeechRecognitionOptions): void {
  const recognitionRef = useRef<SpeechRecognitionLike | undefined>(undefined);
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      recognitionRef.current = undefined;
    };
  }, []);

  useEffect(() => {
    if (!active) {
      recognitionRef.current?.stop();
      recognitionRef.current = undefined;
      return;
    }
    const statusCallbacks = createDictationStatusSessionCallbacks({
      statusCopy,
      setAssistStatus,
      onStopDictation
    });
    const recognition = startDictationSession({
      onInsertProse,
      shouldKeepListening: () => activeRef.current,
      ...statusCallbacks
    });
    if (recognition !== undefined) {
      recognitionRef.current = recognition;
    }
    return () => {
      if (recognition !== undefined) {
        detachDictationRecognition(recognition);
      }
    };
  }, [active, onInsertProse, onStopDictation, setAssistStatus, statusCopy]);
}
