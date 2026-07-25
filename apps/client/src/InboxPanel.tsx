import type { ProjectNavigator } from "@ghostwriter/core";
import { ghostwriterTheme } from "@ghostwriter/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import {
  GhostwriterApiError,
  applyAgentProposal,
  getOpenAiProviderStatus,
  getCapture,
  getSceneWorkspace,
  listCaptures,
  previewCaptureReflectionContext,
  rejectAgentProposal,
  setCaptureArchived,
  startCaptureReflectionRun,
  type AgentProposalResponse,
  type CaptureHeadResponse,
  type CaptureSummaryResponse,
  type ContextReceiptResponse,
  type PromoteCaptureToSceneResponse
} from "./api.js";
import { AiSetupPanel } from "./AiSetupPanel.js";
import { CaptureHandoffPanel } from "./CaptureHandoffPanel.js";
import type { CaptureHandoffPromoteInput } from "./capture-handoff.js";
import {
  inboxHandoffLayoutMode,
  inboxHandoffShowsDetailPane,
  inboxHandoffShowsList
} from "./capture-handoff.js";
import {
  acknowledgementForInboxArchive,
  captureInboxCanArchive,
  captureInboxCanRequestReflection,
  captureInboxCanRestore,
  captureInboxIntegratedNote,
  captureInboxIsReadOnly,
  captureInboxMetaLine,
  captureInboxRowTitle,
  captureInboxStatusLabel,
  inboxLoadPhase,
  inboxCaptureSessionControlsDisabled,
  inboxPanelActivity,
  inboxPanelProblemEvents,
  messageForInboxArchiveFailure,
  messageForInboxLoadFailure,
  type InboxPanelAcknowledgementEvent,
  type InboxPanelActivity,
  type InboxPanelProblemEvent
} from "./inbox-panel.js";
import { messageForCaptureLoadFailure } from "./capture-composer.js";
import {
  listManuscriptHandoffChoices,
  resolveManuscriptHandoffPlacement
} from "./manuscript-handoff-placement.js";

const { colors, fonts } = ghostwriterTheme;

export type InboxPanelProps = Readonly<{
  projectId: string;
  project?: ProjectNavigator;
  projectVersion?: number;
  selectedCaptureId?: string;
  refreshSignal?: number;
  compact?: boolean;
  canvasVersion?: number;
  ensureCanvasVersion?(): Promise<number | undefined>;
  onSelectCapture?(captureId: string | undefined): void;
  onOpenCapture(captureId: string): void;
  onViewSourceCapture?(captureId: string): void;
  onPromote?(
    input: CaptureHandoffPromoteInput
  ): Promise<PromoteCaptureToSceneResponse>;
  onOpenDraft?(sceneId: string): void;
  onOpenSplit?(sceneId: string): void;
  onActivityChange?(activity: InboxPanelActivity): void;
  onProblem?(problem: InboxPanelProblemEvent): void;
  onProblemResolved?(id: string): void;
  onAcknowledgement?(event: InboxPanelAcknowledgementEvent): void;
}>;

function InboxButton({
  label,
  onPress,
  disabled = false
}: Readonly<{
  label: string;
  onPress(): void;
  disabled?: boolean;
}>) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        pressed && styles.buttonPressed,
        disabled && styles.buttonDisabled
      ]}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

export function InboxPanel({
  projectId,
  project,
  projectVersion,
  selectedCaptureId,
  refreshSignal = 0,
  compact = false,
  canvasVersion,
  ensureCanvasVersion,
  onSelectCapture,
  onOpenCapture,
  onViewSourceCapture,
  onPromote,
  onOpenDraft,
  onOpenSplit,
  onActivityChange,
  onProblem,
  onProblemResolved,
  onAcknowledgement
}: InboxPanelProps) {
  const openViewSource =
    onViewSourceCapture ?? ((captureId: string) => onOpenCapture(captureId));
  const [captures, setCaptures] = useState<readonly CaptureSummaryResponse[]>(
    []
  );
  const [includeArchived, setIncludeArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadFailureMessage, setLoadFailureMessage] = useState<string>();
  const [rowActionBusy, setRowActionBusy] = useState(false);
  const [handoffBusy, setHandoffBusy] = useState(false);
  const [rowFailure, setRowFailure] = useState<
    Readonly<{ captureId: string; message: string }> | undefined
  >();
  const [detailHead, setDetailHead] = useState<CaptureHeadResponse>();
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailLoadFailed, setDetailLoadFailed] = useState(false);
  const [detailFailureMessage, setDetailFailureMessage] = useState<string>();
  const [reflectionBusy, setReflectionBusy] = useState(false);
  const [showAiSetup, setShowAiSetup] = useState(false);
  const [pendingReceipt, setPendingReceipt] = useState<ContextReceiptResponse>();
  const [reflectionProposal, setReflectionProposal] =
    useState<AgentProposalResponse>();
  const [reflectionMessage, setReflectionMessage] = useState<string>();
  const [proposalApplied, setProposalApplied] = useState(false);
  const [applyTitle, setApplyTitle] = useState("");
  const [applyPlacementKey, setApplyPlacementKey] = useState("");
  const [applyVariantSceneId, setApplyVariantSceneId] = useState("");
  const [applyVariantName, setApplyVariantName] = useState("");
  const [craftSceneId, setCraftSceneId] = useState("");
  const [craftCharacterId, setCraftCharacterId] = useState("");
  const applySessionIdRef = useRef(`inbox-apply-${projectId}`);

  const activityCallbackRef = useRef(onActivityChange);
  const problemCallbackRef = useRef(onProblem);
  const problemResolvedCallbackRef = useRef(onProblemResolved);
  const reportedProblemIdsRef = useRef<Set<string>>(new Set());
  activityCallbackRef.current = onActivityChange;
  problemCallbackRef.current = onProblem;
  problemResolvedCallbackRef.current = onProblemResolved;

  const loadCaptures = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    setLoadFailureMessage(undefined);
    setRowFailure(undefined);
    try {
      const listed = await listCaptures(projectId, includeArchived);
      setCaptures(listed);
    } catch (cause) {
      setCaptures([]);
      setLoadFailed(true);
      setLoadFailureMessage(messageForInboxLoadFailure(cause));
    } finally {
      setLoading(false);
    }
  }, [includeArchived, projectId]);

  useEffect(() => {
    void loadCaptures();
  }, [loadCaptures, refreshSignal]);

  const loadDetailHead = useCallback(async () => {
    if (selectedCaptureId === undefined) {
      setDetailHead(undefined);
      setDetailLoading(false);
      setDetailLoadFailed(false);
      setDetailFailureMessage(undefined);
      return;
    }
    setDetailLoading(true);
    setDetailLoadFailed(false);
    setDetailFailureMessage(undefined);
    try {
      const head = await getCapture({ projectId, captureId: selectedCaptureId });
      setDetailHead(head);
    } catch (cause) {
      setDetailHead(undefined);
      setDetailLoadFailed(true);
      setDetailFailureMessage(messageForCaptureLoadFailure(cause));
    } finally {
      setDetailLoading(false);
    }
  }, [projectId, selectedCaptureId]);

  useEffect(() => {
    void loadDetailHead();
  }, [loadDetailHead, refreshSignal]);

  const phase = inboxLoadPhase({
    loading,
    loadFailed,
    captureCount: captures.length
  });

  useEffect(() => {
    activityCallbackRef.current?.(
      inboxPanelActivity({
        loading,
        loadFailed,
        rowActionBusy,
        handoffBusy,
        reflectionBusy
      })
    );
  }, [handoffBusy, loadFailed, loading, reflectionBusy, rowActionBusy]);

  useEffect(() => {
    setShowAiSetup(false);
    setPendingReceipt(undefined);
    setReflectionProposal(undefined);
    setReflectionMessage(undefined);
    setProposalApplied(false);
    setApplyTitle("");
    setApplyPlacementKey("");
    setApplyVariantSceneId("");
    setApplyVariantName("");
  }, [selectedCaptureId]);

  const manuscriptChoices =
    project === undefined ? [] : listManuscriptHandoffChoices(project);
  const navigatorScenes =
    project === undefined
      ? []
      : project.books.flatMap((book) => [
          ...book.unassignedScenes.map((scene) => ({
            id: scene.id,
            label: `${book.title} · ${scene.title}`
          })),
          ...book.parts.flatMap((part) =>
            part.chapters.flatMap((chapter) =>
              chapter.scenes.map((scene) => ({
                id: scene.id,
                label: `${book.title} · ${chapter.title} · ${scene.title}`
              }))
            )
          )
        ]);

  const defaultPlacementKey = manuscriptChoices[0]?.key ?? "";
  const defaultVariantSceneId = navigatorScenes[0]?.id ?? "";
  const castChoices =
    project === undefined
      ? []
      : project.storyKnowledge
          .filter(
            (record) =>
              record.kind === "character" && record.archivedAt === undefined
          )
          .map((record) => ({ id: record.id, label: record.label }));
  const defaultCastId = castChoices[0]?.id ?? "";
  useEffect(() => {
    if (craftSceneId === "" && defaultVariantSceneId !== "") {
      setCraftSceneId(defaultVariantSceneId);
    }
  }, [craftSceneId, defaultVariantSceneId]);
  useEffect(() => {
    if (craftCharacterId === "" && defaultCastId !== "") {
      setCraftCharacterId(defaultCastId);
    }
  }, [craftCharacterId, defaultCastId]);
  useEffect(() => {
    if (reflectionProposal === undefined) return;
    setProposalApplied(false);
    if (reflectionProposal.payload.schemaId !== "capture-reflection-v1") {
      return;
    }
    const defaultJob = reflectionProposal.payload.possibleStoryJobs[0]?.label;
    setApplyTitle(defaultJob ?? "Untitled scene");
    setApplyPlacementKey(defaultPlacementKey);
    setApplyVariantSceneId(defaultVariantSceneId);
    setApplyVariantName(defaultJob ?? "Capture take");
  }, [defaultPlacementKey, defaultVariantSceneId, reflectionProposal]);

  useEffect(() => {
    const events = inboxPanelProblemEvents({
      projectId,
      loadFailed,
      loadFailureMessage,
      rowFailure
    });
    const nextIds = new Set(events.map((event) => event.id));
    for (const event of events) {
      problemCallbackRef.current?.(event);
    }
    for (const id of reportedProblemIdsRef.current) {
      if (!nextIds.has(id)) problemResolvedCallbackRef.current?.(id);
    }
    reportedProblemIdsRef.current = nextIds;
  }, [loadFailed, loadFailureMessage, projectId, rowFailure]);

  useEffect(
    () => () => {
      for (const id of reportedProblemIdsRef.current) {
        problemResolvedCallbackRef.current?.(id);
      }
      reportedProblemIdsRef.current.clear();
    },
    []
  );

  async function toggleArchive(
    summary: CaptureSummaryResponse,
    archived: boolean
  ): Promise<void> {
    if (sessionControlsDisabled) return;
    setRowActionBusy(true);
    setRowFailure(undefined);
    try {
      await setCaptureArchived({
        projectId,
        captureId: summary.captureId,
        archived
      });
      onAcknowledgement?.(acknowledgementForInboxArchive(archived));
      await loadCaptures();
      if (summary.captureId === selectedCaptureId && archived) {
        onSelectCapture?.(undefined);
      }
    } catch (cause) {
      setRowFailure({
        captureId: summary.captureId,
        message: messageForInboxArchiveFailure(cause)
      });
    } finally {
      setRowActionBusy(false);
    }
  }

  const layoutMode = inboxHandoffLayoutMode(compact, selectedCaptureId);
  const showList = phase === "ready" && inboxHandoffShowsList(compact, selectedCaptureId);
  const showDetail =
    inboxHandoffShowsDetailPane(compact, selectedCaptureId) &&
    selectedCaptureId !== undefined;

  const liveStatus =
    phase === "loading"
      ? "Loading Inbox…"
      : phase === "failure"
        ? loadFailureMessage ?? "Inbox could not load."
        : phase === "empty"
          ? includeArchived
            ? "No archived Captures in this project."
            : "No Captures yet. Acknowledged Captures appear here."
          : layoutMode === "detail-only"
            ? "Reviewing selected Capture."
            : `${captures.length} Capture${captures.length === 1 ? "" : "s"} in Inbox.`;

  const canRenderHandoffPanel =
    project !== undefined &&
    projectVersion !== undefined &&
    detailHead !== undefined &&
    !detailLoading &&
    !detailLoadFailed;
  const handoffReady =
    canRenderHandoffPanel &&
    (detailHead.status === "integrated" ||
      captureInboxIsReadOnly(detailHead) ||
      onPromote !== undefined);

  const sessionControlsDisabled = inboxCaptureSessionControlsDisabled({
    loading,
    rowActionBusy,
    handoffBusy,
    reflectionBusy
  });

  async function beginScenePartnerHelp(): Promise<void> {
    if (selectedCaptureId === undefined || !captureInboxCanRequestReflection(detailHead)) {
      return;
    }
    setReflectionBusy(true);
    setReflectionMessage(undefined);
    setReflectionProposal(undefined);
    setPendingReceipt(undefined);
    try {
      const provider = await getOpenAiProviderStatus();
      if (provider.callsDisabled) {
        setReflectionMessage("Provider calls are temporarily disabled.");
        return;
      }
      if (!provider.configured) {
        setShowAiSetup(true);
        setReflectionMessage("Add an OpenAI key to ask Scene Partner for help.");
        return;
      }
      setShowAiSetup(false);
      const receipt = await previewCaptureReflectionContext({
        projectId,
        captureId: selectedCaptureId
      });
      setPendingReceipt(receipt);
      setReflectionMessage(
        `Ready to ask Scene Partner about this Capture (${receipt.resources[0]?.providerTextCharCount ?? 0} characters of context).`
      );
    } catch (error) {
      setReflectionMessage(
        error instanceof GhostwriterApiError
          ? error.message
          : "Ghostwriter could not prepare Scene Partner help."
      );
    } finally {
      setReflectionBusy(false);
    }
  }

  async function confirmScenePartnerRun(): Promise<void> {
    if (pendingReceipt === undefined) return;
    setReflectionBusy(true);
    setReflectionMessage(undefined);
    try {
      const result = await startCaptureReflectionRun({
        projectId,
        receiptId: pendingReceipt.id,
        expectedReceiptHash: pendingReceipt.receiptHash
      });
      setPendingReceipt(undefined);
      if (result.kind === "ready") {
        setReflectionProposal(result.proposal);
        setReflectionMessage(
          result.proposal.payload.schemaId === "capture-reflection-v1"
            ? "Scene Partner found a place to start."
            : "Craft partner proposal is ready to review."
        );
        return;
      }
      setReflectionMessage(
        result.kind === "stale"
          ? "This Capture changed. Preview again before asking the partner."
          : result.kind === "canceled"
            ? "Partner run was canceled."
            : "Partner could not finish. Try again after checking your key."
      );
    } catch (error) {
      if (
        error instanceof GhostwriterApiError &&
        (error.code === "PROVIDER_NOT_CONFIGURED" ||
          error.code === "PROVIDER_ENCRYPTION_UNAVAILABLE")
      ) {
        setShowAiSetup(true);
      }
      setReflectionMessage(
        error instanceof GhostwriterApiError
          ? error.message
          : "Ghostwriter could not start Scene Partner."
      );
    } finally {
      setReflectionBusy(false);
    }
  }

  async function rejectReflectionProposal(): Promise<void> {
    if (reflectionProposal === undefined || proposalApplied) return;
    setReflectionBusy(true);
    try {
      await rejectAgentProposal({
        projectId,
        proposalId: reflectionProposal.id
      });
      setReflectionProposal(undefined);
      setReflectionMessage("Proposal rejected. The Capture is unchanged.");
    } catch (error) {
      setReflectionMessage(
        error instanceof GhostwriterApiError
          ? error.message
          : "Ghostwriter could not reject that proposal."
      );
    } finally {
      setReflectionBusy(false);
    }
  }

  async function beginCraftPartner(
    workflowId:
      | "sketch-partner.craft-fields"
      | "character-coach.sheet-fields"
      | "worldkeeper.backdrop-fields"
  ): Promise<void> {
    if (selectedCaptureId === undefined || !captureInboxCanRequestReflection(detailHead)) {
      return;
    }
    setReflectionBusy(true);
    setReflectionMessage(undefined);
    setReflectionProposal(undefined);
    setPendingReceipt(undefined);
    try {
      const provider = await getOpenAiProviderStatus();
      if (provider.callsDisabled) {
        setReflectionMessage("Provider calls are temporarily disabled.");
        return;
      }
      if (!provider.configured) {
        setShowAiSetup(true);
        setReflectionMessage("Add an OpenAI key before asking a craft partner.");
        return;
      }
      setShowAiSetup(false);
      if (
        (workflowId === "sketch-partner.craft-fields" ||
          workflowId === "worldkeeper.backdrop-fields") &&
        craftSceneId.trim() === ""
      ) {
        setReflectionMessage("Choose a scene before asking this craft partner.");
        return;
      }
      if (
        workflowId === "character-coach.sheet-fields" &&
        craftCharacterId.trim() === ""
      ) {
        setReflectionMessage(
          "Choose a cast member before Character Coach can propose sheet updates."
        );
        return;
      }
      const receipt = await previewCaptureReflectionContext({
        projectId,
        captureId: selectedCaptureId,
        workflowId,
        ...(workflowId === "character-coach.sheet-fields"
          ? { storyKnowledgeId: craftCharacterId }
          : { sceneId: craftSceneId })
      });
      setPendingReceipt(receipt);
      const label =
        workflowId === "sketch-partner.craft-fields"
          ? "Sketch Partner"
          : workflowId === "character-coach.sheet-fields"
            ? "Character Coach"
            : "Worldkeeper";
      setReflectionMessage(
        `Ready to ask ${label} about this Capture (${receipt.resources[0]?.providerTextCharCount ?? 0} characters of context).`
      );
    } catch (error) {
      setReflectionMessage(
        error instanceof GhostwriterApiError
          ? error.message
          : "Ghostwriter could not prepare craft partner help."
      );
    } finally {
      setReflectionBusy(false);
    }
  }

  async function applyCraftProposalFields(): Promise<void> {
    if (
      reflectionProposal === undefined ||
      proposalApplied ||
      projectVersion === undefined ||
      reflectionProposal.payload.schemaId === "capture-reflection-v1"
    ) {
      return;
    }
    setReflectionBusy(true);
    try {
      const result = await applyAgentProposal({
        projectId,
        proposalId: reflectionProposal.id,
        mode: "craft-fields",
        expectedProjectVersion: projectVersion,
        expectedProposalContentHash: reflectionProposal.contentHash
      });
      setProposalApplied(true);
      setReflectionProposal(result.proposal);
      setReflectionMessage(
        "Craft fields applied through project commands. Your prose is unchanged."
      );
    } catch (error) {
      setReflectionMessage(
        error instanceof GhostwriterApiError
          ? error.message
          : "Ghostwriter could not apply those craft fields."
      );
    } finally {
      setReflectionBusy(false);
    }
  }

  async function applyReflectionAsNewScene(): Promise<void> {
    if (
      reflectionProposal === undefined ||
      proposalApplied ||
      project === undefined ||
      projectVersion === undefined
    ) {
      return;
    }
    const placement = resolveManuscriptHandoffPlacement(project, applyPlacementKey);
    if (placement === undefined) {
      setReflectionMessage("Choose a manuscript placement before applying.");
      return;
    }
    const title = applyTitle.trim();
    if (title.length === 0) {
      setReflectionMessage("Give the new scene a title before applying.");
      return;
    }
    setReflectionBusy(true);
    try {
      let resolvedCanvasVersion = canvasVersion;
      if (resolvedCanvasVersion === undefined && ensureCanvasVersion !== undefined) {
        resolvedCanvasVersion = await ensureCanvasVersion();
      }
      const result = await applyAgentProposal({
        projectId,
        proposalId: reflectionProposal.id,
        mode: "new-scene",
        title,
        bookId: placement.bookId,
        ...(placement.kind === "chapter" ? { chapterId: placement.chapterId } : {}),
        expectedProjectVersion: projectVersion,
        expectedProposalContentHash: reflectionProposal.contentHash
      });
      if (result.mode !== "new-scene") {
        throw new Error("Unexpected apply response.");
      }
      setProposalApplied(true);
      setReflectionProposal(result.proposal);
      setDetailHead(result.captureHead);
      setReflectionMessage(
        `Applied as scene “${result.scene.title}”. Your draft stayed unchanged until this apply.`
      );
      void loadCaptures();
      if (onOpenDraft !== undefined) {
        onOpenDraft(result.scene.id);
      }
      void resolvedCanvasVersion;
    } catch (error) {
      setReflectionMessage(
        error instanceof GhostwriterApiError
          ? error.message
          : "Ghostwriter could not apply that proposal as a scene."
      );
    } finally {
      setReflectionBusy(false);
    }
  }

  async function applyReflectionAsNamedVariant(): Promise<void> {
    if (reflectionProposal === undefined || proposalApplied) return;
    const sceneId = applyVariantSceneId.trim();
    const variantName = applyVariantName.trim();
    if (sceneId.length === 0 || variantName.length === 0) {
      setReflectionMessage("Choose a scene and variant name before applying.");
      return;
    }
    setReflectionBusy(true);
    try {
      const workspace = await getSceneWorkspace({ projectId, sceneId });
      const result = await applyAgentProposal({
        projectId,
        proposalId: reflectionProposal.id,
        mode: "named-variant",
        sceneId,
        variantName,
        expectedWorkingVersion: workspace.head.workingVersion,
        sessionId: applySessionIdRef.current,
        expectedProposalContentHash: reflectionProposal.contentHash
      });
      if (result.mode !== "named-variant") {
        throw new Error("Unexpected apply response.");
      }
      setProposalApplied(true);
      setReflectionProposal(result.proposal);
      setReflectionMessage(
        `Applied as named variant “${result.variant.name}”. Your draft has not changed.`
      );
    } catch (error) {
      setReflectionMessage(
        error instanceof GhostwriterApiError
          ? error.message
          : "Ghostwriter could not apply that proposal as a named variant."
      );
    } finally {
      setReflectionBusy(false);
    }
  }

  return (
    <View style={styles.panel}>
      <View style={styles.header}>
        <View style={styles.headingCopy}>
          <Text accessibilityRole="header" style={styles.title}>
            Inbox
          </Text>
          <Text style={styles.subtitle}>
            Noncanonical Captures and future proposals · center workspace
          </Text>
        </View>
        <View style={styles.headerActions}>
          {compact && selectedCaptureId !== undefined ? (
            <InboxButton
              disabled={sessionControlsDisabled}
              label="Back"
              onPress={() => onSelectCapture?.(undefined)}
            />
          ) : null}
          <InboxButton
            disabled={sessionControlsDisabled}
            label={includeArchived ? "Show active" : "Show archived"}
            onPress={() => setIncludeArchived((current) => !current)}
          />
          <InboxButton
            disabled={sessionControlsDisabled}
            label="Refresh"
            onPress={() => {
              void loadCaptures();
              void loadDetailHead();
            }}
          />
        </View>
      </View>

      <Text accessibilityLiveRegion="polite" style={styles.liveStatus}>
        {liveStatus}
      </Text>

      {phase === "failure" ? (
        <View accessibilityRole="alert" style={styles.notice}>
          <Text style={styles.noticeText}>
            {loadFailureMessage ?? "Ghostwriter could not load the Inbox."}
          </Text>
          <InboxButton label="Try again" onPress={() => void loadCaptures()} />
        </View>
      ) : null}

      {phase === "empty" && !loading ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Inbox is empty</Text>
          <Text style={styles.emptyText}>
            {includeArchived
              ? "Archived Captures you restore will return to the active list."
              : "Open Capture from any surface, write, and acknowledged material lands here."}
          </Text>
        </View>
      ) : null}

      {phase === "ready" ? (
        <View
          style={[
            styles.workspace,
            layoutMode === "split" && styles.workspaceSplit
          ]}
        >
          {showList ? (
            <ScrollView
              contentContainerStyle={[
                styles.list,
                layoutMode === "split" && styles.listSplit
              ]}
            >
              <View accessibilityRole="list" style={styles.listInner}>
                {captures.map((summary) => {
                  const selected = summary.captureId === selectedCaptureId;
                  const readOnly = captureInboxIsReadOnly(summary);
                  const canArchive = captureInboxCanArchive(summary);
                  const canRestore =
                    includeArchived && captureInboxCanRestore(summary);

                  const integratedNote = captureInboxIntegratedNote(summary);
                  const rowTitle = captureInboxRowTitle(summary);

                  return (
                    <View
                      key={summary.captureId}
                      style={[styles.row, selected && styles.rowSelected]}
                    >
                      <View style={styles.rowMain}>
                        <View style={styles.rowLabels}>
                          <Text style={styles.noncanonicalPill}>
                            Capture · noncanonical
                          </Text>
                          {readOnly ? (
                            <Text style={styles.readOnlyPill}>Read-only</Text>
                          ) : null}
                        </View>
                        <Text style={styles.rowTitle}>{rowTitle}</Text>
                        <Text style={styles.rowMeta}>
                          {captureInboxMetaLine(summary)}
                        </Text>
                        {integratedNote !== undefined ? (
                          <Text style={styles.integratedNote}>{integratedNote}</Text>
                        ) : null}
                      </View>
                      <View style={styles.rowActions}>
                        <Pressable
                          accessibilityHint="Opens handoff detail for this Capture"
                          accessibilityLabel={`Review ${rowTitle}`}
                          accessibilityRole="button"
                          accessibilityState={{ disabled: sessionControlsDisabled, selected }}
                          disabled={sessionControlsDisabled}
                          onPress={() => onSelectCapture?.(summary.captureId)}
                          style={({ pressed }) => [
                            styles.reviewButton,
                            selected && styles.reviewButtonSelected,
                            pressed && !sessionControlsDisabled && styles.buttonPressed,
                            sessionControlsDisabled && styles.buttonDisabled
                          ]}
                        >
                          <Text
                            style={[
                              styles.reviewButtonText,
                              selected && styles.reviewButtonTextSelected
                            ]}
                          >
                            Review
                          </Text>
                        </Pressable>
                        <Pressable
                          accessibilityHint="Opens this Capture in the composer"
                          accessibilityLabel={`Open ${rowTitle}`}
                          accessibilityRole="button"
                          disabled={sessionControlsDisabled}
                          onPress={() => onOpenCapture(summary.captureId)}
                          style={({ pressed }) => [
                            styles.openButton,
                            pressed && !sessionControlsDisabled && styles.buttonPressed,
                            sessionControlsDisabled && styles.buttonDisabled
                          ]}
                        >
                          <Text style={styles.openButtonText}>Open</Text>
                        </Pressable>
                        {canArchive ? (
                          <InboxButton
                            disabled={sessionControlsDisabled}
                            label="Archive"
                            onPress={() => void toggleArchive(summary, true)}
                          />
                        ) : null}
                        {canRestore ? (
                          <InboxButton
                            disabled={sessionControlsDisabled}
                            label="Restore"
                            onPress={() => void toggleArchive(summary, false)}
                          />
                        ) : null}
                        <Text style={styles.statusChip}>
                          {captureInboxStatusLabel(summary.status)}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            </ScrollView>
          ) : null}

          {showDetail ? (
            <View style={styles.detailPane}>
              {detailLoading ? (
                <Text style={styles.loadingText}>Loading Capture…</Text>
              ) : null}
              {detailLoadFailed ? (
                <View accessibilityRole="alert" style={styles.notice}>
                  <Text style={styles.noticeText}>
                    {detailFailureMessage ??
                      "Ghostwriter could not load this Capture."}
                  </Text>
                  <InboxButton
                    disabled={sessionControlsDisabled}
                    label="Try again"
                    onPress={() => void loadDetailHead()}
                  />
                </View>
              ) : null}
              {detailHead !== undefined &&
              captureInboxCanRequestReflection(detailHead) ? (
                <View style={styles.reflectionPane}>
                  <Text style={styles.reflectionTitle}>Scene Partner</Text>
                  <Text style={styles.reflectionCopy}>
                    Ask for a typed summary, questions, and possible story jobs.
                    Nothing applies until you choose later.
                  </Text>
                  <View style={styles.headerActions}>
                    <InboxButton
                      disabled={sessionControlsDisabled}
                      label="Help find its place"
                      onPress={() => void beginScenePartnerHelp()}
                    />
                    {pendingReceipt !== undefined ? (
                      <InboxButton
                        disabled={sessionControlsDisabled}
                        label={
                          pendingReceipt.workflowId ===
                          "scene-partner.capture-reflection"
                            ? "Start Scene Partner"
                            : "Start craft partner"
                        }
                        onPress={() => void confirmScenePartnerRun()}
                      />
                    ) : null}
                    {reflectionProposal !== undefined && !proposalApplied ? (
                      <InboxButton
                        disabled={sessionControlsDisabled}
                        label="Reject proposal"
                        onPress={() => void rejectReflectionProposal()}
                      />
                    ) : null}
                  </View>
                  <Text style={styles.reflectionTitle}>Craft partners</Text>
                  <Text style={styles.reflectionCopy}>
                    Ask for typed craft deltas only. Nothing enters prose until you
                    apply a separate prose workflow.
                  </Text>
                  <View style={styles.headerActions}>
                    {navigatorScenes.map((scene) => (
                      <InboxButton
                        key={scene.id}
                        disabled={sessionControlsDisabled}
                        label={
                          craftSceneId === scene.id
                            ? `✓ Scene · ${scene.label}`
                            : `Scene · ${scene.label}`
                        }
                        onPress={() => setCraftSceneId(scene.id)}
                      />
                    ))}
                  </View>
                  <View style={styles.headerActions}>
                    {castChoices.map((cast) => (
                      <InboxButton
                        key={cast.id}
                        disabled={sessionControlsDisabled}
                        label={
                          craftCharacterId === cast.id
                            ? `✓ Cast · ${cast.label}`
                            : `Cast · ${cast.label}`
                        }
                        onPress={() => setCraftCharacterId(cast.id)}
                      />
                    ))}
                  </View>
                  <View style={styles.headerActions}>
                    <InboxButton
                      disabled={sessionControlsDisabled}
                      label="Ask Sketch Partner"
                      onPress={() =>
                        void beginCraftPartner("sketch-partner.craft-fields")
                      }
                    />
                    <InboxButton
                      disabled={sessionControlsDisabled}
                      label="Ask Character Coach"
                      onPress={() =>
                        void beginCraftPartner("character-coach.sheet-fields")
                      }
                    />
                    <InboxButton
                      disabled={sessionControlsDisabled}
                      label="Ask Worldkeeper"
                      onPress={() =>
                        void beginCraftPartner("worldkeeper.backdrop-fields")
                      }
                    />
                  </View>
                  {showAiSetup ? (
                    <AiSetupPanel
                      compact={compact}
                      onConfigured={() => {
                        setShowAiSetup(false);
                        void beginScenePartnerHelp();
                      }}
                      onDismiss={() => setShowAiSetup(false)}
                    />
                  ) : null}
                  {reflectionMessage !== undefined ? (
                    <Text style={styles.reflectionCopy}>{reflectionMessage}</Text>
                  ) : null}
                  {reflectionProposal !== undefined &&
                  reflectionProposal.payload.schemaId !== "capture-reflection-v1" ? (
                    <View style={styles.proposalCard}>
                      <Text style={styles.proposalSummary}>
                        Typed craft proposal ready
                      </Text>
                      {Object.entries(reflectionProposal.payload)
                        .filter(([key]) => key !== "schemaId")
                        .map(([key, value]) => (
                          <Text key={key} style={styles.reflectionCopy}>
                            {key}: {String(value)}
                          </Text>
                        ))}
                      {!proposalApplied ? (
                        <Text style={styles.reflectionCopy}>
                          Your prose is unchanged. Apply the full typed payload or
                          reject.
                        </Text>
                      ) : null}
                      {!proposalApplied && projectVersion !== undefined ? (
                        <InboxButton
                          disabled={sessionControlsDisabled}
                          label="Apply craft fields"
                          onPress={() => void applyCraftProposalFields()}
                        />
                      ) : null}
                    </View>
                  ) : null}
                  {reflectionProposal !== undefined &&
                  reflectionProposal.payload.schemaId === "capture-reflection-v1" ? (
                    <View style={styles.proposalCard}>
                      <Text style={styles.proposalSummary}>
                        {reflectionProposal.payload.summary}
                      </Text>
                      {reflectionProposal.payload.questions.map((question) => (
                        <Text key={question} style={styles.reflectionCopy}>
                          · {question}
                        </Text>
                      ))}
                      {reflectionProposal.payload.possibleStoryJobs.map((job) => (
                        <Text key={job.label} style={styles.reflectionCopy}>
                          {job.label}: {job.rationale}
                        </Text>
                      ))}
                      {!proposalApplied ? (
                        <Text style={styles.reflectionCopy}>
                          Your draft has not changed. Compare these jobs, then apply
                          one path or reject.
                        </Text>
                      ) : null}
                      {!proposalApplied &&
                      project !== undefined &&
                      projectVersion !== undefined ? (
                        <View style={styles.applyPane}>
                          <Text style={styles.reflectionTitle}>Apply as new scene</Text>
                          <TextInput
                            accessibilityLabel="New scene title"
                            onChangeText={setApplyTitle}
                            style={styles.applyInput}
                            value={applyTitle}
                          />
                          <View style={styles.headerActions}>
                            {manuscriptChoices.map((choice) => (
                              <InboxButton
                                key={choice.key}
                                disabled={sessionControlsDisabled}
                                label={
                                  applyPlacementKey === choice.key
                                    ? `✓ ${choice.label}`
                                    : choice.label
                                }
                                onPress={() => setApplyPlacementKey(choice.key)}
                              />
                            ))}
                          </View>
                          <InboxButton
                            disabled={sessionControlsDisabled}
                            label="Apply as new scene"
                            onPress={() => void applyReflectionAsNewScene()}
                          />
                          <Text style={styles.reflectionTitle}>
                            Apply as named variant
                          </Text>
                          <TextInput
                            accessibilityLabel="Named variant title"
                            onChangeText={setApplyVariantName}
                            style={styles.applyInput}
                            value={applyVariantName}
                          />
                          <View style={styles.headerActions}>
                            {navigatorScenes.map((scene) => (
                              <InboxButton
                                key={scene.id}
                                disabled={sessionControlsDisabled}
                                label={
                                  applyVariantSceneId === scene.id
                                    ? `✓ ${scene.label}`
                                    : scene.label
                                }
                                onPress={() => setApplyVariantSceneId(scene.id)}
                              />
                            ))}
                          </View>
                          <InboxButton
                            disabled={sessionControlsDisabled}
                            label="Apply as named variant"
                            onPress={() => void applyReflectionAsNamedVariant()}
                          />
                        </View>
                      ) : null}
                    </View>
                  ) : null}
                </View>
              ) : null}

              {handoffReady ? (
                <CaptureHandoffPanel
                  canvasVersion={canvasVersion}
                  captureHead={detailHead}
                  captureId={selectedCaptureId}
                  ensureCanvasVersion={ensureCanvasVersion}
                  navigationDisabled={handoffBusy || reflectionBusy}
                  onIntegrated={(head) => {
                    setDetailHead(head);
                    void loadCaptures();
                  }}
                  onOpenDraft={onOpenDraft}
                  onOpenSplit={compact ? undefined : onOpenSplit}
                  onPromote={async (input) => {
                    if (onPromote === undefined) {
                      throw new Error("Capture handoff is not wired.");
                    }
                    setHandoffBusy(true);
                    try {
                      return await onPromote(input);
                    } finally {
                      setHandoffBusy(false);
                    }
                  }}
                  onViewSource={() => openViewSource(selectedCaptureId)}
                  project={project}
                  projectVersion={projectVersion}
                />
              ) : null}
              {!detailLoading &&
              !detailLoadFailed &&
              detailHead !== undefined &&
              !handoffReady ? (
                <View style={styles.detailFallback}>
                  <Text style={styles.emptyText}>
                    Handoff controls require project wiring from the workspace
                    shell.
                  </Text>
                  <InboxButton
                    disabled={sessionControlsDisabled}
                    label="View source"
                    onPress={() => openViewSource(selectedCaptureId)}
                  />
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}

      {phase === "loading" ? (
        <View style={styles.loading}>
          <Text style={styles.loadingText}>Loading Inbox…</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: colors.paper,
    flex: 1,
    gap: 12,
    minHeight: 280,
    padding: 16
  },
  header: {
    alignItems: "flex-start",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    justifyContent: "space-between"
  },
  headingCopy: {
    flex: 1,
    gap: 4,
    minWidth: 200
  },
  title: {
    color: colors.ink,
    fontFamily: fonts.story,
    fontSize: 28
  },
  subtitle: {
    color: colors.muted,
    flexShrink: 1,
    fontFamily: fonts.ui,
    fontSize: 13,
    lineHeight: 18
  },
  headerActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  liveStatus: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 12
  },
  notice: {
    backgroundColor: colors.amberSoft,
    borderColor: colors.amber,
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
    padding: 12
  },
  noticeText: {
    color: colors.ink,
    fontFamily: fonts.ui,
    fontSize: 13,
    lineHeight: 18
  },
  reflectionPane: {
    borderColor: colors.line,
    borderRadius: 10,
    borderWidth: 1,
    gap: 10,
    padding: 12
  },
  reflectionTitle: {
    color: colors.ink,
    fontFamily: fonts.uiMedium,
    fontSize: 16
  },
  reflectionCopy: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 13,
    lineHeight: 18
  },
  proposalCard: {
    gap: 6
  },
  proposalSummary: {
    color: colors.ink,
    fontFamily: fonts.uiMedium,
    fontSize: 14,
    lineHeight: 20
  },
  applyPane: {
    borderColor: colors.line,
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
    marginTop: 8,
    padding: 10
  },
  applyInput: {
    borderColor: colors.line,
    borderRadius: 6,
    borderWidth: 1,
    color: colors.ink,
    fontFamily: fonts.ui,
    fontSize: 14,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  empty: {
    gap: 8,
    paddingVertical: 24
  },
  emptyTitle: {
    color: colors.ink,
    fontFamily: fonts.uiMedium,
    fontSize: 16
  },
  emptyText: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 13,
    lineHeight: 18,
    maxWidth: 520
  },
  loading: {
    paddingVertical: 32
  },
  loadingText: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 13
  },
  workspace: {
    flex: 1,
    minHeight: 200
  },
  workspaceSplit: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12
  },
  list: {
    paddingBottom: 16
  },
  listSplit: {
    flex: 1,
    minWidth: 280
  },
  listInner: {
    gap: 10
  },
  row: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    padding: 12
  },
  rowSelected: {
    borderColor: colors.brandDark
  },
  rowMain: {
    flex: 1,
    gap: 6,
    minWidth: 220
  },
  rowLabels: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  noncanonicalPill: {
    backgroundColor: colors.wash,
    borderRadius: 999,
    color: colors.ink,
    fontFamily: fonts.uiMedium,
    fontSize: 11,
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 4
  },
  readOnlyPill: {
    backgroundColor: colors.blueSoft,
    borderRadius: 999,
    color: colors.ink,
    fontFamily: fonts.uiMedium,
    fontSize: 11,
    paddingHorizontal: 8,
    paddingVertical: 4
  },
  rowTitle: {
    color: colors.ink,
    fontFamily: fonts.uiMedium,
    fontSize: 15,
    lineHeight: 20
  },
  rowMeta: {
    color: colors.muted,
    flexShrink: 1,
    fontFamily: fonts.ui,
    fontSize: 12,
    lineHeight: 17
  },
  integratedNote: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 12,
    lineHeight: 16
  },
  rowActions: {
    alignItems: "flex-start",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  reviewButton: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  reviewButtonSelected: {
    borderColor: colors.brandDark
  },
  reviewButtonText: {
    color: colors.ink,
    fontFamily: fonts.uiMedium,
    fontSize: 13
  },
  reviewButtonTextSelected: {
    color: colors.brandDark
  },
  openButton: {
    backgroundColor: colors.brandDark,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  openButtonText: {
    color: colors.paper,
    fontFamily: fonts.uiMedium,
    fontSize: 13
  },
  statusChip: {
    alignSelf: "center",
    color: colors.muted,
    fontFamily: fonts.uiMedium,
    fontSize: 12
  },
  detailPane: {
    flex: 1,
    minWidth: 280
  },
  detailFallback: {
    gap: 8,
    paddingVertical: 12
  },
  button: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8
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
  }
});
