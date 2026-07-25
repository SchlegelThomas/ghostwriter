import { ghostwriterTheme } from "@ghostwriter/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View
} from "react-native";
import {
  deleteCaptureAttachment,
  getCaptureAttachmentDownloadUrl,
  listCaptureAttachments,
  type CaptureAttachmentSummaryResponse
} from "./api.js";
import {
  CaptureAttachmentUploadRefusalError,
  CaptureAttachmentUploadUnavailableError,
  uploadCaptureAttachment
} from "./capture-attachment-upload.js";
import {
  CAPTURE_AUDIO_RECORDER_ERROR_MESSAGE,
  CaptureAudioRecorderError,
  createCaptureAudioRecorderController,
  getCaptureAudioRecorderEnvironment,
  isCaptureAudioRecordingAvailable
} from "./capture-audio-recorder.js";
import {
  buildCaptureAttachmentFileInputAccept,
  captureAttachmentActivityFromPanel,
  captureAttachmentAddControlsDisabled,
  captureAttachmentCanDelete,
  captureAttachmentCanDownload,
  captureAttachmentFilePickerDisabled,
  captureAttachmentMimeLabel,
  captureAttachmentPendingExpiryLabel,
  captureAttachmentRecordControlsDisabled,
  captureAttachmentRefusalLabel,
  captureAttachmentListScrollStyle,
  captureAttachmentStateLabel,
  captureAttachmentUploadProgressPercent,
  CAPTURE_ATTACHMENT_FILE_PICKER_UNAVAILABLE_COPY,
  CAPTURE_ATTACHMENT_RECORDING_STATUS_COPY,
  confirmCaptureAttachmentDelete,
  formatCaptureAttachmentByteSize,
  isCaptureFilePickerAvailable,
  messageForCaptureAttachmentActionFailure,
  messageForCaptureAttachmentListFailure,
  messageForCaptureAttachmentUploadFailure,
  monotonicCaptureAttachmentUploadPercent,
  type CaptureAttachmentActivity,
  type CaptureAttachmentDeleteConfirm
} from "./capture-attachments-panel.js";

const { colors, fonts } = ghostwriterTheme;

export type CaptureAttachmentsPanelProps = Readonly<{
  projectId: string;
  captureId: string | undefined;
  attachmentsEditable: boolean;
  onActivityChange?(activity: CaptureAttachmentActivity): void;
  onUploadDisplayChange?(
    display: Readonly<{ filename?: string; percent?: number }> | undefined
  ): void;
  onAttachmentActionFailure?(message: string | undefined): void;
  onAttachmentListFailure?(failed: boolean, message?: string): void;
  confirmDelete?: CaptureAttachmentDeleteConfirm;
  openDownloadUrl?(url: string): Promise<void>;
}>;

function defaultConfirmDelete(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert("Delete attachment?", message, [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => resolve(true)
      }
    ]);
  });
}

async function defaultOpenDownloadUrl(url: string): Promise<void> {
  await Linking.openURL(url);
}

function PanelButton({
  label,
  onPress,
  disabled = false,
  primary = false
}: Readonly<{
  label: string;
  onPress(): void;
  disabled?: boolean;
  primary?: boolean;
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

export function CaptureAttachmentsPanel({
  projectId,
  captureId,
  attachmentsEditable,
  onActivityChange,
  onUploadDisplayChange,
  onAttachmentActionFailure,
  onAttachmentListFailure,
  confirmDelete = defaultConfirmDelete,
  openDownloadUrl = defaultOpenDownloadUrl
}: CaptureAttachmentsPanelProps) {
  const [attachments, setAttachments] = useState<
    readonly CaptureAttachmentSummaryResponse[]
  >([]);
  const [listLoading, setListLoading] = useState(false);
  const [listFailed, setListFailed] = useState(false);
  const [listFailureMessage, setListFailureMessage] = useState<string>();
  const [actionFailureMessage, setActionFailureMessage] = useState<string>();
  const [uploadFilename, setUploadFilename] = useState<string>();
  const [uploadPercent, setUploadPercent] = useState<number>();
  const [uploadBusy, setUploadBusy] = useState(false);
  const [recordingActive, setRecordingActive] = useState(false);
  const [recordingStatus, setRecordingStatus] = useState<string>();
  const [recordingError, setRecordingError] = useState<string>();
  const [rowBusyId, setRowBusyId] = useState<string>();
  const [listAttempt, setListAttempt] = useState(0);

  const activeCaptureRef = useRef<string | undefined>(captureId);
  const uploadAbortRef = useRef<AbortController | undefined>(undefined);
  const uploadPercentRef = useRef<number | undefined>(undefined);
  const recorderRef = useRef<ReturnType<typeof createCaptureAudioRecorderController> | undefined>(
    undefined
  );
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const filePickerAvailable = isCaptureFilePickerAvailable();
  const recorderEnvironment = getCaptureAudioRecorderEnvironment();
  const recorderAvailable = isCaptureAudioRecordingAvailable(recorderEnvironment);

  const reloadAttachments = useCallback(async (): Promise<void> => {
    const scopeCaptureId = captureId;
    if (scopeCaptureId === undefined) return;
    setListLoading(true);
    setListFailed(false);
    setListFailureMessage(undefined);
    try {
      const rows = await listCaptureAttachments({
        projectId,
        captureId: scopeCaptureId
      });
      if (activeCaptureRef.current !== scopeCaptureId) return;
      setAttachments(rows);
    } catch (cause) {
      if (activeCaptureRef.current !== scopeCaptureId) return;
      const message = messageForCaptureAttachmentListFailure(cause);
      setListFailed(true);
      setListFailureMessage(message);
      setAttachments([]);
    } finally {
      if (activeCaptureRef.current === scopeCaptureId) {
        setListLoading(false);
      }
    }
  }, [captureId, projectId]);

  useEffect(() => {
    activeCaptureRef.current = captureId;
    uploadAbortRef.current?.abort();
    uploadAbortRef.current = undefined;
    uploadPercentRef.current = undefined;
    setUploadBusy(false);
    setUploadFilename(undefined);
    setUploadPercent(undefined);
    setRecordingActive(false);
    setRecordingStatus(undefined);
    setRecordingError(undefined);
    setActionFailureMessage(undefined);
    void recorderRef.current?.cancel().catch(() => undefined);
    recorderRef.current = undefined;

    if (captureId === undefined) {
      setAttachments([]);
      setListLoading(false);
      setListFailed(false);
      return;
    }

    void reloadAttachments();
  }, [captureId, listAttempt, reloadAttachments]);

  useEffect(() => {
    if (!filePickerAvailable || typeof document === "undefined") return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = buildCaptureAttachmentFileInputAccept();
    input.multiple = false;
    input.setAttribute("aria-hidden", "true");
    input.style.position = "fixed";
    input.style.left = "-9999px";
    input.style.width = "1px";
    input.style.height = "1px";
    input.style.opacity = "0";
    document.body.appendChild(input);
    fileInputRef.current = input;
    return () => {
      fileInputRef.current = null;
      input.remove();
    };
  }, [filePickerAvailable]);

  const attachmentActivity = captureAttachmentActivityFromPanel({
    listFailed,
    actionProblem: actionFailureMessage !== undefined,
    uploadActive: uploadBusy,
    recordingActive
  });

  useEffect(() => {
    onActivityChange?.(attachmentActivity);
  }, [attachmentActivity, onActivityChange]);

  useEffect(() => {
    if (!uploadBusy) {
      onUploadDisplayChange?.(undefined);
      return;
    }
    onUploadDisplayChange?.({
      filename: uploadFilename,
      percent: uploadPercent
    });
  }, [onUploadDisplayChange, uploadBusy, uploadFilename, uploadPercent]);

  useEffect(() => {
    onAttachmentListFailure?.(listFailed, listFailureMessage);
  }, [listFailed, listFailureMessage, onAttachmentListFailure]);

  useEffect(() => {
    onAttachmentActionFailure?.(actionFailureMessage);
  }, [actionFailureMessage, onAttachmentActionFailure]);

  useEffect(
    () => () => {
      uploadAbortRef.current?.abort();
      void recorderRef.current?.cancel().catch(() => undefined);
      recorderRef.current = undefined;
    },
    []
  );

  const addControlsDisabled = captureAttachmentAddControlsDisabled({
    attachmentsEditable,
    activity: attachmentActivity,
    listLoading,
    uploadBusy,
    filePickerAvailable
  });

  const filePickerDisabled = captureAttachmentFilePickerDisabled({
    addControlsDisabled,
    filePickerAvailable
  });

  const recordDisabled = captureAttachmentRecordControlsDisabled({
    addControlsDisabled,
    recorderAvailable
  });

  const runUpload = useCallback(
    async (file: File | Blob, displayFilename: string): Promise<void> => {
      const scopeCaptureId = captureId;
      if (scopeCaptureId === undefined) return;

      uploadAbortRef.current?.abort();
      const controller = new AbortController();
      uploadAbortRef.current = controller;
      uploadPercentRef.current = undefined;

      setUploadBusy(true);
      setUploadFilename(displayFilename);
      setUploadPercent(undefined);
      setActionFailureMessage(undefined);

      try {
        await uploadCaptureAttachment({
          scope: { projectId, captureId: scopeCaptureId },
          file,
          displayFilename,
          signal: controller.signal,
          onProgress: (progress) => {
            if (activeCaptureRef.current !== scopeCaptureId) return;
            const next = captureAttachmentUploadProgressPercent(progress);
            const monotonic = monotonicCaptureAttachmentUploadPercent(
              uploadPercentRef.current,
              next
            );
            uploadPercentRef.current = monotonic;
            setUploadPercent(monotonic);
          }
        });
        if (activeCaptureRef.current !== scopeCaptureId) return;
        await reloadAttachments();
      } catch (cause) {
        if (activeCaptureRef.current !== scopeCaptureId) return;
        if (controller.signal.aborted) return;
        if (cause instanceof CaptureAttachmentUploadRefusalError) {
          setActionFailureMessage(cause.message);
        } else if (cause instanceof CaptureAttachmentUploadUnavailableError) {
          setActionFailureMessage(cause.message);
        } else {
          setActionFailureMessage(messageForCaptureAttachmentUploadFailure(cause));
        }
      } finally {
        if (activeCaptureRef.current === scopeCaptureId) {
          setUploadBusy(false);
          setUploadFilename(undefined);
          setUploadPercent(undefined);
          uploadPercentRef.current = undefined;
        }
        if (uploadAbortRef.current === controller) {
          uploadAbortRef.current = undefined;
        }
      }
    },
    [captureId, projectId, reloadAttachments]
  );

  const onPickFile = useCallback((): void => {
    const input = fileInputRef.current;
    if (input === null || filePickerDisabled) return;
    input.value = "";
    input.onchange = () => {
      const file = input.files?.[0];
      input.value = "";
      if (file === undefined) return;
      void runUpload(file, file.name);
    };
    input.click();
  }, [filePickerDisabled, runUpload]);

  const ensureRecorder = useCallback(() => {
    if (recorderEnvironment === undefined) return undefined;
    if (recorderRef.current === undefined) {
      recorderRef.current = createCaptureAudioRecorderController({
        environment: recorderEnvironment,
        onError: (error) => {
          if (activeCaptureRef.current !== captureId) return;
          setRecordingError(error.message);
          setRecordingActive(false);
          setRecordingStatus(undefined);
        }
      });
    }
    return recorderRef.current;
  }, [captureId, recorderEnvironment]);

  const startRecording = useCallback(async (): Promise<void> => {
    if (recordDisabled || captureId === undefined) return;
    setRecordingError(undefined);
    setActionFailureMessage(undefined);
    const recorder = ensureRecorder();
    if (recorder === undefined) {
      setRecordingError(CAPTURE_AUDIO_RECORDER_ERROR_MESSAGE.unavailable);
      return;
    }
    try {
      await recorder.start();
      if (activeCaptureRef.current !== captureId) {
        await recorder.cancel().catch(() => undefined);
        return;
      }
      setRecordingActive(true);
      setRecordingStatus(CAPTURE_ATTACHMENT_RECORDING_STATUS_COPY.recording);
    } catch (cause) {
      if (activeCaptureRef.current !== captureId) return;
      const message =
        cause instanceof CaptureAudioRecorderError
          ? cause.message
          : CAPTURE_AUDIO_RECORDER_ERROR_MESSAGE.unavailable;
      setRecordingError(message);
      setRecordingActive(false);
      setRecordingStatus(undefined);
    }
  }, [captureId, ensureRecorder, recordDisabled]);

  const cancelRecording = useCallback(async (): Promise<void> => {
    const recorder = recorderRef.current;
    if (recorder === undefined) return;
    try {
      await recorder.cancel();
    } catch {
      // Cancel is best-effort when recording already ended.
    }
    setRecordingActive(false);
    setRecordingStatus(undefined);
  }, []);

  const stopAndAttachRecording = useCallback(async (): Promise<void> => {
    const scopeCaptureId = captureId;
    const recorder = recorderRef.current;
    if (recorder === undefined || scopeCaptureId === undefined) return;
    setRecordingStatus(CAPTURE_ATTACHMENT_RECORDING_STATUS_COPY.stopping);
    try {
      const result = await recorder.stop();
      if (activeCaptureRef.current !== scopeCaptureId) return;
      setRecordingActive(false);
      setRecordingStatus(undefined);
      await runUpload(result.file, result.displayFilename);
    } catch (cause) {
      if (activeCaptureRef.current !== scopeCaptureId) return;
      const message =
        cause instanceof CaptureAudioRecorderError
          ? cause.message
          : CAPTURE_AUDIO_RECORDER_ERROR_MESSAGE.recorderError;
      setRecordingError(message);
      setRecordingActive(false);
      setRecordingStatus(undefined);
    }
  }, [captureId, runUpload]);

  const downloadAttachment = useCallback(
    async (attachment: CaptureAttachmentSummaryResponse): Promise<void> => {
      const scopeCaptureId = captureId;
      if (scopeCaptureId === undefined) return;
      if (!captureAttachmentCanDownload(attachment.state)) return;
      setRowBusyId(attachment.attachmentId);
      setActionFailureMessage(undefined);
      try {
        const { download } = await getCaptureAttachmentDownloadUrl({
          projectId,
          captureId: scopeCaptureId,
          attachmentId: attachment.attachmentId
        });
        if (activeCaptureRef.current !== scopeCaptureId) return;
        await openDownloadUrl(download.url);
      } catch {
        if (activeCaptureRef.current !== scopeCaptureId) return;
        setActionFailureMessage(messageForCaptureAttachmentActionFailure(undefined));
      } finally {
        if (activeCaptureRef.current === scopeCaptureId) {
          setRowBusyId(undefined);
        }
      }
    },
    [captureId, openDownloadUrl, projectId]
  );

  const removeAttachment = useCallback(
    async (attachment: CaptureAttachmentSummaryResponse): Promise<void> => {
      const scopeCaptureId = captureId;
      if (scopeCaptureId === undefined) return;
      if (!captureAttachmentCanDelete(attachment.state)) return;
      const confirmed = await confirmCaptureAttachmentDelete(
        attachment.displayFilename,
        confirmDelete
      );
      if (!confirmed) return;
      setRowBusyId(attachment.attachmentId);
      setActionFailureMessage(undefined);
      try {
        const result = await deleteCaptureAttachment({
          projectId,
          captureId: scopeCaptureId,
          attachmentId: attachment.attachmentId
        });
        if (activeCaptureRef.current !== scopeCaptureId) return;
        setAttachments((current) =>
          current.map((row) =>
            row.attachmentId === result.attachment.attachmentId
              ? result.attachment
              : row
          )
        );
      } catch {
        if (activeCaptureRef.current !== scopeCaptureId) return;
        setActionFailureMessage(messageForCaptureAttachmentActionFailure(undefined));
      } finally {
        if (activeCaptureRef.current === scopeCaptureId) {
          setRowBusyId(undefined);
        }
      }
    },
    [captureId, confirmDelete, projectId]
  );

  const uploadStatusLine = useMemo(() => {
    if (!uploadBusy || uploadFilename === undefined) return undefined;
    const percent =
      uploadPercent === undefined ? undefined : `${uploadPercent}%`;
    return percent === undefined
      ? `Uploading ${uploadFilename}…`
      : `Uploading ${uploadFilename}… ${percent}`;
  }, [uploadBusy, uploadFilename, uploadPercent]);

  if (captureId === undefined) {
    return null;
  }

  return (
    <View accessibilityLabel="Capture attachments" style={styles.section}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>
        Attachments
      </Text>

      <View style={styles.actionRow}>
        <PanelButton
          disabled={filePickerDisabled}
          label="Attach file"
          onPress={onPickFile}
          primary
        />
        {recordingActive ? (
          <>
            <PanelButton
              disabled={uploadBusy}
              label="Stop and attach"
              onPress={() => void stopAndAttachRecording()}
              primary
            />
            <PanelButton
              disabled={uploadBusy}
              label="Cancel recording"
              onPress={() => void cancelRecording()}
            />
          </>
        ) : (
          <PanelButton
            disabled={recordDisabled}
            label="Record audio"
            onPress={() => void startRecording()}
          />
        )}
      </View>

      {!filePickerAvailable ? (
        <Text style={styles.hint}>{CAPTURE_ATTACHMENT_FILE_PICKER_UNAVAILABLE_COPY}</Text>
      ) : null}
      {!attachmentsEditable ? (
        <Text style={styles.hint}>
          Integrated and archived Captures keep attachments for download or delete, but new
          uploads are disabled.
        </Text>
      ) : null}
      {recordingStatus === undefined ? null : (
        <Text accessibilityLiveRegion="polite" style={styles.liveStatus}>
          {recordingStatus}
        </Text>
      )}
      {recordingError === undefined ? null : (
        <Text accessibilityLiveRegion="polite" style={styles.inlineWarning}>
          {recordingError}
        </Text>
      )}
      {uploadStatusLine === undefined ? null : (
        <Text accessibilityLiveRegion="polite" style={styles.liveStatus}>
          {uploadStatusLine}
        </Text>
      )}

      {listLoading ? (
        <Text style={styles.hint}>Loading attachments…</Text>
      ) : listFailed ? (
        <View style={styles.inlineProblem}>
          <Text style={styles.inlineWarning}>
            {listFailureMessage ?? messageForCaptureAttachmentListFailure(undefined)}
          </Text>
          <PanelButton
            label="Retry attachments"
            onPress={() => setListAttempt((attempt) => attempt + 1)}
            primary
          />
        </View>
      ) : attachments.length === 0 ? (
        <Text style={styles.hint}>No attachments yet.</Text>
      ) : (
        <ScrollView
          accessibilityLabel="Capture attachment list"
          contentContainerStyle={styles.listContent}
          nestedScrollEnabled
          style={captureAttachmentListScrollStyle()}
        >
          <View accessibilityRole="list" style={styles.list}>
            {attachments.map((attachment) => {
            const stateLabel = captureAttachmentStateLabel(attachment.state);
            const refusal = captureAttachmentRefusalLabel(attachment.refusalCode);
            const expiry = captureAttachmentPendingExpiryLabel(
              attachment.pendingExpiresAt
            );
            const sizeBytes =
              attachment.actualByteSize ?? attachment.declaredByteSize;
            const mime =
              attachment.readyContentType ?? attachment.declaredContentType;
            const rowBusy = rowBusyId === attachment.attachmentId;
            return (
              <View
                accessibilityLabel={`${attachment.displayFilename}, ${stateLabel}`}
                key={attachment.attachmentId}
                style={[
                  styles.row,
                  attachment.state === "deleted" && styles.rowDeleted
                ]}
              >
                <View style={styles.rowCopy}>
                  <Text style={styles.rowTitle}>{attachment.displayFilename}</Text>
                  <Text style={styles.rowMeta}>
                    {[
                      `${stateLabel} · ${captureAttachmentMimeLabel(mime)} · ${formatCaptureAttachmentByteSize(sizeBytes)}`
                    ].join("")}
                  </Text>
                  {refusal === undefined ? null : (
                    <Text style={styles.rowDetail}>{refusal}</Text>
                  )}
                  {expiry === undefined ? null : (
                    <Text style={styles.rowDetail}>{expiry}</Text>
                  )}
                </View>
                <View style={styles.rowActions}>
                  <PanelButton
                    disabled={
                      rowBusy ||
                      !captureAttachmentCanDownload(attachment.state)
                    }
                    label="Download"
                    onPress={() => void downloadAttachment(attachment)}
                  />
                  <PanelButton
                    disabled={
                      rowBusy || !captureAttachmentCanDelete(attachment.state)
                    }
                    label="Delete"
                    onPress={() => void removeAttachment(attachment)}
                  />
                </View>
              </View>
            );
          })}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    borderColor: colors.line,
    borderRadius: 8,
    borderTopWidth: 1,
    flexGrow: 0,
    flexShrink: 0,
    gap: 10,
    paddingTop: 12
  },
  sectionTitle: {
    color: colors.ink,
    fontFamily: fonts.uiSemibold,
    fontSize: 14
  },
  actionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  hint: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 12,
    lineHeight: 16
  },
  liveStatus: {
    color: colors.ink,
    fontFamily: fonts.uiMedium,
    fontSize: 12
  },
  inlineWarning: {
    color: colors.amber,
    fontFamily: fonts.ui,
    fontSize: 12,
    lineHeight: 16
  },
  inlineProblem: {
    gap: 8
  },
  listContent: {
    flexGrow: 0
  },
  list: {
    gap: 8
  },
  row: {
    backgroundColor: colors.wash,
    borderColor: colors.line,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "space-between",
    padding: 10
  },
  rowDeleted: {
    opacity: 0.72
  },
  rowCopy: {
    flex: 1,
    gap: 4,
    minWidth: 160
  },
  rowTitle: {
    color: colors.ink,
    fontFamily: fonts.uiMedium,
    fontSize: 13
  },
  rowMeta: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 12
  },
  rowDetail: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 12,
    lineHeight: 16
  },
  rowActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  button: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6
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
    fontSize: 12
  },
  buttonTextPrimary: {
    color: colors.paper
  }
});
