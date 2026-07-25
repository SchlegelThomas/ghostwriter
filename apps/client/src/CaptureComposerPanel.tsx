import {
  SceneEditor,
  type SceneEditorInsertRequest
} from "@ghostwriter/editor/react";
import type { SceneDocumentV1 } from "@ghostwriter/editor";
import { ghostwriterTheme } from "@ghostwriter/ui";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState
} from "react";
import { X } from "phosphor-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  createCapture,
  getCapture,
  saveCaptureDocument,
  type CaptureHeadResponse
} from "./api.js";
import { CaptureAttachmentsPanel } from "./CaptureAttachmentsPanel.js";
import {
  captureComposerIsReadOnly,
  captureReadOnlyStatusText,
  CAPTURE_DICTATION_STATUS_COPY,
  isCaptureVersionConflict,
  mapCaptureSaveFailureToProblem,
  messageForCaptureLoadFailure,
  messageForCaptureVersionConflict,
  type CaptureComposerAcknowledgementEvent,
  type CaptureComposerActivity,
  type CaptureComposerProblem,
  type CaptureComposerProblemEvent
} from "./capture-composer.js";
import {
  captureComposerMergedActivity,
  captureComposerProblemEventsWithAttachments,
  captureComposerSaveStatusIsWarning,
  captureComposerSaveStatusText,
  type CaptureAttachmentActivity
} from "./capture-attachments-panel.js";
import {
  captureRecoveryService,
  createCaptureRecoveryCoordinator,
  decideCaptureRecovery,
  type CaptureRecoveryCoordinator,
  type CaptureRecoveryEntry,
  type CaptureRecoveryStorageMode
} from "./capture-recovery.js";
import {
  createSceneSaveQueue,
  type SceneSaveQueue,
  type SceneSaveQueueSnapshot
} from "./scene-save-queue.js";
import { useDictationSpeechRecognition } from "./useDictationSpeechRecognition.js";
import { sceneDocumentWordCount } from "./draft-desk.js";

const { colors, fonts } = ghostwriterTheme;
const AUTOSAVE_DEBOUNCE_MS = 900;

export type CaptureComposerHandle = Readonly<{
  flush(): Promise<void>;
  focus(): void;
}>;

export type CaptureComposerPanelProps = Readonly<{
  accountId: string;
  projectId: string;
  captureId?: string;
  readOnly?: boolean;
  onClose?(): void;
  onEscapeKey?(): void;
  onCaptureReady?(captureId: string): void;
  onAcknowledgement?(event: CaptureComposerAcknowledgementEvent): void;
  onActivityChange?(activity: CaptureComposerActivity): void;
  onProblem?(problem: CaptureComposerProblemEvent): void;
  onProblemResolved?(id: string): void;
}>;

type WriteModality = "keyboard" | "dictation";

function formatRecoveryTime(timestamp: string): string {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? timestamp : date.toLocaleString();
}

function ComposerButton({
  label,
  onPress,
  primary = false,
  disabled = false
}: Readonly<{
  label: string;
  onPress(): void;
  primary?: boolean;
  disabled?: boolean;
}>) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        primary && styles.buttonPrimary,
        pressed && styles.buttonPressed,
        disabled && styles.buttonDisabled
      ]}
    >
      <Text style={[styles.buttonText, primary && styles.buttonTextPrimary]}>
        {label}
      </Text>
    </Pressable>
  );
}

type FocusableView = View & { focus?: () => void };

export const CaptureComposerPanel = forwardRef<
  CaptureComposerHandle,
  CaptureComposerPanelProps
>(function CaptureComposerPanel(
  {
    accountId,
    projectId,
    captureId: initialCaptureId,
    readOnly: forcedReadOnly = false,
    onClose,
    onEscapeKey,
    onCaptureReady,
    onAcknowledgement,
    onActivityChange,
    onProblem,
    onProblemResolved
  },
  ref
) {
  const [captureId, setCaptureId] = useState<string | undefined>(
    initialCaptureId
  );
  const [document, setDocument] = useState<SceneDocumentV1>();
  const [head, setHead] = useState<CaptureHeadResponse>();
  const [saveSnapshot, setSaveSnapshot] =
    useState<SceneSaveQueueSnapshot>();
  const [problem, setProblem] = useState<CaptureComposerProblem>();
  const [actionBusy, setActionBusy] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [recoveryOffer, setRecoveryOffer] = useState<CaptureRecoveryEntry>();
  const [recoveryMode, setRecoveryMode] =
    useState<CaptureRecoveryStorageMode>();
  const [modality, setModality] = useState<WriteModality>("keyboard");
  const [dictationStatus, setDictationStatus] = useState<string>();
  const [attachmentActivity, setAttachmentActivity] =
    useState<CaptureAttachmentActivity>("idle");
  const [attachmentListFailed, setAttachmentListFailed] = useState(false);
  const [attachmentListFailureMessage, setAttachmentListFailureMessage] =
    useState<string>();
  const [attachmentActionFailureMessage, setAttachmentActionFailureMessage] =
    useState<string>();
  const [attachmentUploadDisplay, setAttachmentUploadDisplay] = useState<
    Readonly<{ filename?: string; percent?: number }> | undefined
  >();
  const [insertTextRequest, setInsertTextRequest] =
    useState<SceneEditorInsertRequest>();
  const insertSeqRef = useRef(0);
  const queueRef = useRef<SceneSaveQueue | undefined>(undefined);
  const recoveryRef = useRef<CaptureRecoveryCoordinator | undefined>(undefined);
  const panelRef = useRef<FocusableView>(null);
  const acknowledgementCallbackRef = useRef(onAcknowledgement);
  const activityCallbackRef = useRef(onActivityChange);
  const problemCallbackRef = useRef(onProblem);
  const problemResolvedCallbackRef = useRef(onProblemResolved);
  const captureReadyCallbackRef = useRef(onCaptureReady);
  const reportedProblemIdsRef = useRef(new Set<string>());
  const activeRef = useRef(false);
  const transitionRef = useRef<Promise<void>>(Promise.resolve());

  acknowledgementCallbackRef.current = onAcknowledgement;
  activityCallbackRef.current = onActivityChange;
  problemCallbackRef.current = onProblem;
  problemResolvedCallbackRef.current = onProblemResolved;
  captureReadyCallbackRef.current = onCaptureReady;

  const readOnly = captureComposerIsReadOnly(head, forcedReadOnly);
  const editorIsEditable =
    !readOnly && !actionBusy && problem?.kind !== "version";
  const initializing = document === undefined || captureId === undefined;

  useEffect(() => {
    setAttachmentActivity("idle");
    setAttachmentListFailed(false);
    setAttachmentListFailureMessage(undefined);
    setAttachmentActionFailureMessage(undefined);
    setAttachmentUploadDisplay(undefined);
  }, [captureId]);

  useImperativeHandle(
    ref,
    () => ({
      async flush(): Promise<void> {
        const queue = queueRef.current;
        if (queue === undefined) {
          throw new Error("The Capture save queue is not ready.");
        }
        await recoveryRef.current?.flush();
        await queue.flush();
        await recoveryRef.current?.flush();
      },
      focus(): void {
        panelRef.current?.focus?.();
      }
    }),
    []
  );

  useEffect(() => {
    if (onEscapeKey === undefined) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onEscapeKey();
    };
    globalThis.addEventListener?.("keydown", onKeyDown);
    return () => globalThis.removeEventListener?.("keydown", onKeyDown);
  }, [onEscapeKey]);

  useEffect(() => {
    let active = true;
    activeRef.current = true;
    let ownedQueue: SceneSaveQueue | undefined;
    let ownedRecovery: CaptureRecoveryCoordinator | undefined;

    async function handleSaveFailure(
      cause: unknown,
      queue: SceneSaveQueue
    ): Promise<void> {
      if (!active) return;
      if (isCaptureVersionConflict(cause)) {
        queue.pause();
        setProblem({
          kind: "version",
          message: messageForCaptureVersionConflict()
        });
        const scope = captureId;
        if (scope === undefined) return;
        try {
          const serverHead = await getCapture({ projectId, captureId: scope });
          if (!active) return;
          queue.installAcknowledgement(serverHead, true);
          setHead(serverHead);
          setProblem({
            kind: "version",
            message: messageForCaptureVersionConflict(),
            serverHead
          });
        } catch {
          // Local recovery and paused queue remain for explicit retry.
        }
        return;
      }
      setProblem(mapCaptureSaveFailureToProblem(cause));
    }

    async function initialize(): Promise<void> {
      try {
        await transitionRef.current;
        if (!active) return;

        const loadedHead =
          initialCaptureId === undefined
            ? await createCapture({ projectId })
            : await getCapture({ projectId, captureId: initialCaptureId });
        if (!active) return;

        const resolvedCaptureId = loadedHead.captureId;
        setCaptureId(resolvedCaptureId);
        captureReadyCallbackRef.current?.(resolvedCaptureId);
        setDocument(loadedHead.document);
        setHead(loadedHead);

        const scope = {
          accountId,
          projectId,
          captureId: resolvedCaptureId
        };
        const localRecovery = {
          current: undefined as CaptureRecoveryCoordinator | undefined
        };
        const queue = createSceneSaveQueue({
          initialAcknowledgement: loadedHead,
          debounceMs: AUTOSAVE_DEBOUNCE_MS,
          startPaused: captureComposerIsReadOnly(loadedHead, forcedReadOnly),
          save: ({ expectedWorkingVersion, document: nextDocument }) =>
            saveCaptureDocument({
              projectId,
              captureId: resolvedCaptureId,
              expectedWorkingVersion,
              document: nextDocument
            }),
          onAcknowledged: (acknowledgement) => {
            void localRecovery.current?.acknowledge(acknowledgement.document);
            if (active) {
              setHead(acknowledgement);
              acknowledgementCallbackRef.current?.({
                kind: "save",
                title: "Capture saved",
                detail: `Capture · version ${acknowledgement.workingVersion}`
              });
            }
          },
          onError: (cause) => {
            void handleSaveFailure(cause, queue);
          },
          onStateChange: (snapshot) => {
            if (active) setSaveSnapshot(snapshot);
          }
        });
        ownedQueue = queue;
        queueRef.current = queue;
        setSaveSnapshot(queue.getSnapshot());

        const recovery = createCaptureRecoveryCoordinator({
          service: captureRecoveryService,
          scope,
          scheduleSave: (nextDocument) => queue.enqueue(nextDocument),
          onModeChange: (mode) => {
            if (active) setRecoveryMode(mode);
          }
        });
        localRecovery.current = recovery;
        ownedRecovery = recovery;
        recoveryRef.current = recovery;

        const recovered = await captureRecoveryService.load(scope);
        if (!active) return;
        setRecoveryMode(recovered.mode);
        const recoveryDecision = decideCaptureRecovery(
          recovered.entry,
          loadedHead.document
        );
        if (
          recoveryDecision === "matches-acknowledged" &&
          recovered.entry !== undefined
        ) {
          void recovery.acknowledge(loadedHead.document);
        } else if (
          recoveryDecision === "offer" &&
          recovered.entry !== undefined
        ) {
          setRecoveryOffer(recovered.entry);
        }

        if (!captureComposerIsReadOnly(loadedHead, forcedReadOnly)) {
          queue.resume();
        }
      } catch (cause) {
        if (!active) return;
        setProblem({
          kind: "load",
          message: messageForCaptureLoadFailure(cause)
        });
      }
    }

    const initialization = initialize();
    void initialization;
    return () => {
      active = false;
      activeRef.current = false;
      if (queueRef.current === ownedQueue) queueRef.current = undefined;
      if (recoveryRef.current === ownedRecovery) {
        recoveryRef.current = undefined;
      }
      const cleanup = (async () => {
        await initialization;
        await ownedRecovery?.flush();
        await ownedQueue?.flush();
        await ownedRecovery?.flush();
        ownedQueue?.dispose();
      })();
      transitionRef.current = cleanup;
      void cleanup;
    };
  }, [
    accountId,
    forcedReadOnly,
    initialCaptureId,
    loadAttempt,
    projectId
  ]);

  const recoverLocalCapture = useCallback((): void => {
    const local = recoveryOffer;
    const queue = queueRef.current;
    const recovery = recoveryRef.current;
    if (local === undefined || queue === undefined || recovery === undefined) {
      return;
    }
    setDocument(local.document);
    setRecoveryOffer(undefined);
    setProblem(undefined);
    void recovery.capture(local.document, queue.getAcknowledgedWorkingVersion());
  }, [recoveryOffer]);

  const discardLocalRecovery = useCallback(async (): Promise<void> => {
    setActionBusy(true);
    try {
      await recoveryRef.current?.discard();
      if (activeRef.current) setRecoveryOffer(undefined);
    } finally {
      if (activeRef.current) setActionBusy(false);
    }
  }, []);

  const useServerCapture = useCallback(async (): Promise<void> => {
    const serverHead =
      problem?.kind === "version" ? problem.serverHead : undefined;
    const queue = queueRef.current;
    if (serverHead === undefined || queue === undefined) return;
    setActionBusy(true);
    queue.pause();
    try {
      queue.installAcknowledgement(serverHead, false);
      setDocument(serverHead.document);
      setHead(serverHead);
      setRecoveryOffer(undefined);
      await recoveryRef.current?.discard();
      setProblem(undefined);
      queue.resume();
    } finally {
      if (activeRef.current) setActionBusy(false);
    }
  }, [problem]);

  const keepLocalAndRetry = useCallback(async (): Promise<void> => {
    const queue = queueRef.current;
    const scopeCaptureId = captureId;
    if (queue === undefined || scopeCaptureId === undefined || readOnly) {
      return;
    }
    setActionBusy(true);
    queue.pause();
    try {
      const serverHead = await getCapture({
        projectId,
        captureId: scopeCaptureId
      });
      if (!activeRef.current) return;
      const snapshot = queue.getSnapshot();
      if (
        serverHead.workingVersion !== snapshot.acknowledgedWorkingVersion &&
        snapshot.dirty
      ) {
        queue.pause();
        queue.installAcknowledgement(serverHead, true);
        setHead(serverHead);
        setProblem({
          kind: "version",
          message:
            "The server Capture changed again before retry. Ghostwriter applied nothing and " +
            "kept your local prose for another review choice.",
          serverHead
        });
        return;
      }
      if (!snapshot.dirty) {
        queue.installAcknowledgement(serverHead, false);
        setDocument(serverHead.document);
      } else {
        queue.installAcknowledgement(serverHead, true);
      }
      setHead(serverHead);
      setProblem(undefined);
      queue.resume();
    } catch (cause) {
      if (activeRef.current) {
        setProblem({
          kind: "version",
          message:
            `Ghostwriter could not reload the latest Capture for review: ` +
            `${messageForCaptureLoadFailure(cause)} Your local prose remains in recovery.`
        });
      }
    } finally {
      if (activeRef.current) setActionBusy(false);
    }
  }, [captureId, projectId, readOnly]);

  const reviewLatestCapture = useCallback(async (): Promise<void> => {
    const queue = queueRef.current;
    const scopeCaptureId = captureId;
    if (queue === undefined || scopeCaptureId === undefined) return;
    setActionBusy(true);
    queue.pause();
    try {
      const serverHead = await getCapture({
        projectId,
        captureId: scopeCaptureId
      });
      if (!activeRef.current) return;
      queue.installAcknowledgement(serverHead, true);
      setHead(serverHead);
      setProblem({
        kind: "version",
        message:
          "The latest acknowledged Capture is ready for review. Your local prose is still " +
          "unchanged in recovery, and Ghostwriter has not combined either document.",
        serverHead
      });
    } catch (cause) {
      if (activeRef.current) {
        setProblem({
          kind: "version",
          message:
            `Ghostwriter could not reload the latest Capture for review: ` +
            `${messageForCaptureLoadFailure(cause)} Your local prose remains in recovery.`
        });
      }
    } finally {
      if (activeRef.current) setActionBusy(false);
    }
  }, [captureId, projectId]);

  const retrySave = useCallback((): void => {
    const queue = queueRef.current;
    if (queue === undefined) return;
    setProblem(undefined);
    queue.resume({ immediate: true });
  }, []);

  const onInsertProse = useCallback((text: string) => {
    insertSeqRef.current += 1;
    setInsertTextRequest({
      id: insertSeqRef.current,
      text
    });
  }, []);

  const stopDictation = useCallback(() => {
    setModality("keyboard");
    setDictationStatus(undefined);
  }, []);

  useDictationSpeechRecognition({
    active: modality === "dictation" && editorIsEditable,
    onInsertProse,
    onStopDictation: stopDictation,
    setAssistStatus: setDictationStatus,
    statusCopy: CAPTURE_DICTATION_STATUS_COPY
  });

  useEffect(() => {
    const events = captureComposerProblemEventsWithAttachments({
      captureId: captureId ?? "pending",
      recoveryOffer: recoveryOffer !== undefined,
      recoveryMode,
      problem,
      attachmentListFailed,
      attachmentListFailureMessage,
      attachmentActionFailureMessage
    });
    const nextIds = new Set(events.map((event) => event.id));
    for (const event of events) {
      problemCallbackRef.current?.(event);
    }
    for (const id of reportedProblemIdsRef.current) {
      if (!nextIds.has(id)) problemResolvedCallbackRef.current?.(id);
    }
    reportedProblemIdsRef.current = nextIds;
  }, [
    attachmentActionFailureMessage,
    attachmentListFailed,
    attachmentListFailureMessage,
    captureId,
    problem,
    recoveryMode,
    recoveryOffer
  ]);

  useEffect(
    () => () => {
      for (const id of reportedProblemIdsRef.current) {
        problemResolvedCallbackRef.current?.(id);
      }
      reportedProblemIdsRef.current.clear();
    },
    []
  );

  useEffect(() => {
    activityCallbackRef.current?.(
      captureComposerMergedActivity({
        snapshot: saveSnapshot,
        problem,
        recoveryOffer: recoveryOffer !== undefined,
        initializing,
        attachmentActivity
      })
    );
  }, [
    attachmentActivity,
    initializing,
    problem,
    recoveryOffer,
    saveSnapshot
  ]);

  const statusText = captureComposerSaveStatusText({
    snapshot: saveSnapshot,
    problem,
    recoveryOffer: recoveryOffer !== undefined,
    attachmentActivity,
    uploadFilename: attachmentUploadDisplay?.filename,
    uploadPercent: attachmentUploadDisplay?.percent
  });
  const readOnlyStatus = captureReadOnlyStatusText(head);
  const canReviewServer =
    problem?.kind === "version" && problem.serverHead !== undefined;
  const wordCount = sceneDocumentWordCount(document);

  return (
    <View
      accessibilityLabel="Idea Capture composer"
      focusable
      ref={panelRef}
      style={styles.panel}
      tabIndex={-1}
    >
      <View accessibilityLabel="Idea Capture composer header" style={styles.header}>
        <View style={styles.headingCopy}>
          <Text accessibilityRole="header" style={styles.title}>
            Idea Capture
          </Text>
          <Text numberOfLines={1} style={styles.meta}>
            {[
              head === undefined ? "Opening…" : `v${head.workingVersion}`,
              `${wordCount} ${wordCount === 1 ? "word" : "words"}`,
              head?.status ?? "draft"
            ].join(" · ")}
          </Text>
        </View>
        {statusText.length === 0 ? null : (
          <Text
            accessibilityLabel="Capture save status"
            accessibilityLiveRegion="polite"
            style={[
              styles.saveStatus,
              captureComposerSaveStatusIsWarning({
                snapshot: saveSnapshot,
                problem,
                recoveryOffer: recoveryOffer !== undefined,
                attachmentActivity
              }) && styles.saveStatusWarning
            ]}
          >
            {statusText}
          </Text>
        )}
        {readOnlyStatus === undefined ? null : (
          <Text accessibilityLabel="Capture access status" style={styles.accessStatus}>
            {readOnlyStatus}
          </Text>
        )}
        <View style={styles.headerActions}>
          {onClose === undefined ? null : (
            <Pressable
              accessibilityLabel="Close Idea Capture"
              accessibilityRole="button"
              onPress={onClose}
              style={({ pressed }) => [
                styles.closeButton,
                pressed && styles.buttonPressed
              ]}
            >
              <X color={colors.ink} size={18} weight="thin" />
            </Pressable>
          )}
        </View>
      </View>

      {readOnly ? (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>
            {head?.status === "integrated"
              ? "This integrated Idea Capture is read-only. Promotion and manuscript placement stay in Plans."
              : head?.status === "archived"
                ? "This archived Idea Capture is read-only. Restore it from Plans before editing."
                : "This Idea Capture is read-only."}
          </Text>
        </View>
      ) : null}

      {recoveryMode === "tab-only" ? (
        <View accessibilityRole="alert" style={styles.recoveryWarning}>
          <Text style={styles.noticeText}>
            Encrypted browser recovery is unavailable. New unacknowledged prose is
            protected only while this tab remains open; editing and project saves still
            work.
          </Text>
        </View>
      ) : null}

      {recoveryOffer === undefined ? null : (
        <View accessibilityRole="alert" style={styles.recoveryOffer}>
          <Text style={styles.problemText}>
            Local Capture recovery from {formatRecoveryTime(recoveryOffer.updatedAt)}{" "}
            differs from the acknowledged project Capture. Ghostwriter will not combine
            or overwrite either version automatically.
          </Text>
          <Text style={styles.problemMeta}>
            Recovering chooses the local prose for the next save. Discarding keeps
            acknowledged Capture version {head?.workingVersion ?? "—"}.
          </Text>
          <View style={styles.actionRow}>
            <ComposerButton
              disabled={actionBusy}
              label="Recover local Capture"
              onPress={recoverLocalCapture}
              primary
            />
            <ComposerButton
              disabled={actionBusy}
              label="Discard local recovery"
              onPress={() => void discardLocalRecovery()}
            />
          </View>
        </View>
      )}

      {problem === undefined ? null : (
        <View accessibilityRole="alert" style={styles.problem}>
          <Text style={styles.problemText}>{problem.message}</Text>
          {canReviewServer ? (
            <Text style={styles.problemMeta}>
              Server Capture version {problem.serverHead?.workingVersion}. Choose the
              document to continue from; Ghostwriter will not combine them automatically.
            </Text>
          ) : null}
          <View style={styles.actionRow}>
            {problem.kind === "load" ? (
              <ComposerButton
                disabled={actionBusy}
                label="Reload Capture"
                onPress={() => setLoadAttempt((attempt) => attempt + 1)}
                primary
              />
            ) : problem.kind === "version" ? (
              canReviewServer ? (
                <>
                  <ComposerButton
                    disabled={actionBusy}
                    label="Keep local and retry"
                    onPress={() => void keepLocalAndRetry()}
                    primary
                  />
                  <ComposerButton
                    disabled={actionBusy}
                    label="Use server Capture"
                    onPress={() => void useServerCapture()}
                  />
                </>
              ) : (
                <ComposerButton
                  disabled={actionBusy}
                  label="Reload latest for review"
                  onPress={() => void reviewLatestCapture()}
                  primary
                />
              )
            ) : (
              <ComposerButton
                disabled={actionBusy}
                label="Retry save"
                onPress={retrySave}
                primary
              />
            )}
          </View>
        </View>
      )}

      {document === undefined ? (
        <View style={styles.loading}>
          <Text style={styles.noticeText}>Opening Capture…</Text>
        </View>
      ) : (
        <>
          <View accessibilityLabel="Idea Capture input mode" style={styles.modalityRow}>
            <ComposerButton
              disabled={!editorIsEditable}
              label="Keyboard"
              onPress={() => {
                stopDictation();
                setModality("keyboard");
              }}
              primary={modality === "keyboard"}
            />
            <ComposerButton
              disabled={!editorIsEditable}
              label="Dictate"
              onPress={() => setModality("dictation")}
              primary={modality === "dictation"}
            />
            {dictationStatus === undefined ? null : (
              <Text accessibilityLiveRegion="polite" style={styles.dictationStatus}>
                {dictationStatus}
              </Text>
            )}
          </View>
          <SceneEditor
            ariaLabel="Idea Capture prose"
            defaultFormattingToolbarOpen={false}
            editable={editorIsEditable}
            insertTextRequest={insertTextRequest}
            onChange={(nextDocument) => {
              setDocument(nextDocument);
              const queue = queueRef.current;
              const recovery = recoveryRef.current;
              if (queue === undefined) return;
              if (recovery === undefined) {
                queue.enqueue(nextDocument);
                return;
              }
              void recovery.capture(
                nextDocument,
                queue.getAcknowledgedWorkingVersion()
              );
            }}
            selectionStorageKey={
              captureId === undefined
                ? undefined
                : `ghostwriter:capture-selection:${accountId}:${projectId}:${captureId}`
            }
            style={{
              boxSizing: "border-box",
              flex: 1,
              maxWidth: "100%",
              minHeight: 280,
              width: "100%"
            }}
            value={document}
          />
          <CaptureAttachmentsPanel
            attachmentsEditable={!readOnly}
            captureId={captureId}
            onActivityChange={setAttachmentActivity}
            onAttachmentActionFailure={setAttachmentActionFailureMessage}
            onAttachmentListFailure={(failed, message) => {
              setAttachmentListFailed(failed);
              setAttachmentListFailureMessage(message);
            }}
            onUploadDisplayChange={setAttachmentUploadDisplay}
            projectId={projectId}
          />
        </>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  panel: {
    backgroundColor: colors.canvas,
    borderColor: colors.line,
    borderRadius: 12,
    borderWidth: 1,
    flex: 1,
    gap: 12,
    maxWidth: "100%",
    padding: 16
  },
  header: {
    alignItems: "flex-start",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "space-between"
  },
  headingCopy: {
    flex: 1,
    gap: 2,
    minWidth: 160
  },
  title: {
    color: colors.ink,
    fontFamily: fonts.story,
    fontSize: 20
  },
  meta: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 12
  },
  saveStatus: {
    color: colors.green,
    fontFamily: fonts.uiSemibold,
    fontSize: 12
  },
  saveStatusWarning: {
    color: colors.amber
  },
  accessStatus: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 12,
    width: "100%"
  },
  headerActions: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8
  },
  closeButton: {
    alignItems: "center",
    borderColor: colors.line,
    borderRadius: 8,
    borderWidth: 1,
    height: 32,
    justifyContent: "center",
    width: 32
  },
  notice: {
    backgroundColor: colors.wash,
    borderRadius: 8,
    padding: 12
  },
  noticeText: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 13,
    lineHeight: 18
  },
  recoveryWarning: {
    backgroundColor: colors.blueSoft,
    borderColor: colors.blue,
    borderRadius: 8,
    borderWidth: 1,
    padding: 12
  },
  recoveryOffer: {
    backgroundColor: colors.amberSoft,
    borderColor: colors.amber,
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
    padding: 12
  },
  problem: {
    backgroundColor: colors.amberSoft,
    borderColor: colors.amber,
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
    padding: 12
  },
  problemText: {
    color: colors.ink,
    fontFamily: fonts.ui,
    fontSize: 13,
    lineHeight: 18
  },
  problemMeta: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 12,
    lineHeight: 16
  },
  actionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  modalityRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  dictationStatus: {
    color: colors.muted,
    flex: 1,
    fontFamily: fonts.ui,
    fontSize: 12,
    minWidth: 180
  },
  loading: {
    minHeight: 280,
    paddingVertical: 24
  },
  button: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  buttonPrimary: {
    backgroundColor: colors.brandDark,
    borderColor: colors.brandDark
  },
  buttonPressed: {
    opacity: 0.85
  },
  buttonDisabled: {
    opacity: 0.5
  },
  buttonText: {
    color: colors.ink,
    fontFamily: fonts.uiMedium,
    fontSize: 13
  },
  buttonTextPrimary: {
    color: colors.paper
  }
});
