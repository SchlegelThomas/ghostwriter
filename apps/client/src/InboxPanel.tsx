import type { ProjectNavigator } from "@ghostwriter/core";
import {
  ghostwriterTheme,
  accountHasAvailableStructuredModels,
  type OpenSettingsHandler,
  type PlansAgentDeepLink
} from "@ghostwriter/ui";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode
} from "react";
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
  getAvailableModels,
  getCapture,
  getAgentProposal,
  getSceneWorkspace,
  listCaptures,
  previewCaptureReflectionContext,
  acknowledgeAgentProposal,
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
  buildCaptureHandoffPromoteRequest,
  CAPTURE_HANDOFF_DEFAULT_SCENE_TITLE,
  inboxHandoffLayoutMode,
  inboxHandoffShowsDetailPane,
  inboxHandoffShowsList
} from "./capture-handoff.js";
import { ScenePartnerChatPanel } from "./ScenePartnerChatPanel.js";
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
  DREAMS_IDEA_PROMPT,
  PLANS_TITLE,
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
import { sceneDocumentPlainText } from "./draft-desk.js";
import {
  listManuscriptHandoffChoices,
  resolveManuscriptHandoffPlacement
} from "./manuscript-handoff-placement.js";

const { colors, fonts } = ghostwriterTheme;

type DreamsWorkflowStep =
  | "idea"
  | "scene-partner"
  | "craft-partner"
  | "worldkeeper"
  | "plan-outline"
  | "integrate";

type AiSetupResume =
  | "scene"
  | "sketch-partner.craft-fields"
  | "character-coach.sheet-fields"
  | "worldkeeper.backdrop-fields";

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
  /** Omit captureId to open a new Idea Capture. */
  onOpenCapture(captureId?: string): void;
  onOpenSettings?: OpenSettingsHandler;
  /** Bump when Settings may have changed provider keys. */
  providerStatusSignal?: number;
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
  agentDeepLink?: PlansAgentDeepLink;
  onAgentDeepLinkConsumed?(): void;
}>;

function InboxButton({
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

function ChoiceCard({
  title,
  subtitle,
  onPress,
  disabled = false,
  secondary = false
}: Readonly<{
  title: string;
  subtitle: string;
  onPress(): void;
  disabled?: boolean;
  secondary?: boolean;
}>) {
  return (
    <Pressable
      accessibilityHint={subtitle}
      accessibilityLabel={title}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.choiceCard,
        secondary && styles.choiceCardSecondary,
        pressed && !disabled && styles.buttonPressed,
        disabled && styles.buttonDisabled
      ]}
    >
      <Text style={styles.choiceCardTitle}>{title}</Text>
      <Text style={styles.choiceCardSubtitle}>{subtitle}</Text>
    </Pressable>
  );
}

function workflowStepLabel(step: DreamsWorkflowStep): string {
  switch (step) {
    case "scene-partner":
      return "Scene Partner";
    case "craft-partner":
      return "Craft Partner";
    case "worldkeeper":
      return "Worldkeeper";
    case "plan-outline":
      return "Plan outline";
    case "integrate":
      return "Add to manuscript";
    case "idea":
      return "Idea";
  }
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
  onOpenSettings,
  providerStatusSignal = 0,
  onViewSourceCapture,
  onPromote,
  onOpenDraft,
  onOpenSplit,
  onActivityChange,
  onProblem,
  onProblemResolved,
  onAcknowledgement,
  agentDeepLink,
  onAgentDeepLinkConsumed
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
  const [workflowStep, setWorkflowStep] = useState<DreamsWorkflowStep>("idea");
  const [reflectionBusy, setReflectionBusy] = useState(false);
  const [showAiSetup, setShowAiSetup] = useState(false);
  const [aiSetupResume, setAiSetupResume] = useState<AiSetupResume>();
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
  const pendingDeepLinkRef = useRef<PlansAgentDeepLink | undefined>(undefined);
  const deepLinkAutoStartPendingRef = useRef(false);

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

  useEffect(() => {
    if (agentDeepLink === undefined) return;

    pendingDeepLinkRef.current = agentDeepLink;

    if (
      agentDeepLink.captureId !== undefined &&
      agentDeepLink.captureId !== selectedCaptureId
    ) {
      onSelectCapture?.(agentDeepLink.captureId);
    }

    setWorkflowStep(agentDeepLink.workflowStep);
    setShowAiSetup(false);
    setAiSetupResume(undefined);
    setPendingReceipt(undefined);
    setReflectionProposal(undefined);
    setReflectionMessage(undefined);
    setProposalApplied(false);

    if (agentDeepLink.craftSceneId !== undefined) {
      setCraftSceneId(agentDeepLink.craftSceneId);
    }
    if (agentDeepLink.craftCharacterId !== undefined) {
      setCraftCharacterId(agentDeepLink.craftCharacterId);
    }

    if (agentDeepLink.autoStartWorkflowId !== undefined) {
      deepLinkAutoStartPendingRef.current = true;
      return;
    }

    if (agentDeepLink.proposalId !== undefined) {
      void (async () => {
        try {
          const proposal = await getAgentProposal({
            projectId,
            proposalId: agentDeepLink.proposalId!
          });
          setReflectionProposal(proposal);
          setProposalApplied(proposal.status === "applied");
          setReflectionMessage(
            proposal.payload.schemaId === "plan-outline-v1"
              ? "Plan outline ready to review."
              : "Proposal ready to review."
          );
        } catch (error) {
          setReflectionMessage(
            error instanceof GhostwriterApiError
              ? error.message
              : "Ghostwriter could not load that proposal."
          );
        } finally {
          pendingDeepLinkRef.current = undefined;
          onAgentDeepLinkConsumed?.();
        }
      })();
      return;
    }

    pendingDeepLinkRef.current = undefined;
    onAgentDeepLinkConsumed?.();
  }, [agentDeepLink, onAgentDeepLinkConsumed, onSelectCapture, projectId, selectedCaptureId]);

  useEffect(() => {
    if (!deepLinkAutoStartPendingRef.current) return;
    const link = pendingDeepLinkRef.current;
    if (link?.autoStartWorkflowId === undefined) return;
    if (detailLoading || selectedCaptureId === undefined) return;
    if (
      link.craftSceneId !== undefined &&
      craftSceneId !== link.craftSceneId
    ) {
      return;
    }
    if (
      link.craftCharacterId !== undefined &&
      craftCharacterId !== link.craftCharacterId
    ) {
      return;
    }

    deepLinkAutoStartPendingRef.current = false;
    pendingDeepLinkRef.current = undefined;

    if (!captureInboxCanRequestReflection(detailHead)) {
      onAgentDeepLinkConsumed?.();
      return;
    }

    const workflowId = link.autoStartWorkflowId;
    void beginCraftPartner(workflowId).finally(() => {
      onAgentDeepLinkConsumed?.();
    });
  }, [
    craftCharacterId,
    craftSceneId,
    detailHead,
    detailLoading,
    selectedCaptureId
  ]);

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
    setWorkflowStep("idea");
    setShowAiSetup(false);
    setAiSetupResume(undefined);
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

  const selectedSummary =
    selectedCaptureId === undefined
      ? undefined
      : captures.find((capture) => capture.captureId === selectedCaptureId);
  const ideaTitle =
    selectedSummary !== undefined
      ? captureInboxRowTitle(selectedSummary)
      : detailHead !== undefined
        ? captureInboxRowTitle(detailHead)
        : "Idea";

  const liveStatus =
    phase === "loading"
      ? `Loading ${PLANS_TITLE}…`
      : phase === "failure"
        ? loadFailureMessage ?? `${PLANS_TITLE} could not load.`
        : phase === "empty"
          ? includeArchived
            ? "No archived ideas in this project."
            : "No ideas yet. Acknowledged Captures appear here."
          : layoutMode === "detail-only"
            ? workflowStep === "idea"
              ? "Choose what to do with this idea."
              : `${workflowStepLabel(workflowStep)} for this idea.`
            : `${captures.length} idea${captures.length === 1 ? "" : "s"}.`;

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

  function goHome(): void {
    onSelectCapture?.(undefined);
  }

  function goIdea(): void {
    setWorkflowStep("idea");
    setShowAiSetup(false);
    setAiSetupResume(undefined);
    setPendingReceipt(undefined);
    setReflectionProposal(undefined);
    setReflectionMessage(undefined);
    setProposalApplied(false);
  }

  function enterWorkflow(step: Exclude<DreamsWorkflowStep, "idea">): void {
    setWorkflowStep(step);
    setShowAiSetup(false);
    setAiSetupResume(undefined);
    setPendingReceipt(undefined);
    setReflectionProposal(undefined);
    setReflectionMessage(undefined);
    setProposalApplied(false);
  }

  async function confirmPartnerRun(): Promise<void> {
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
            : "Proposal ready to review."
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
          : "Ghostwriter could not start the partner."
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
      setReflectionMessage("Proposal rejected.");
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

  async function acknowledgePlanOutlineProposal(): Promise<void> {
    if (reflectionProposal === undefined || proposalApplied) return;
    if (reflectionProposal.payload.schemaId !== "plan-outline-v1") return;
    setReflectionBusy(true);
    try {
      await acknowledgeAgentProposal({
        projectId,
        proposalId: reflectionProposal.id
      });
      setProposalApplied(true);
      setReflectionMessage("Plan outline acknowledged.");
    } catch (error) {
      setReflectionMessage(
        error instanceof GhostwriterApiError
          ? error.message
          : "Ghostwriter could not acknowledge that outline."
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
      const available = await getAvailableModels();
      if (available.callsDisabled) {
        setReflectionMessage("Provider calls are temporarily disabled.");
        return;
      }
      if (!accountHasAvailableStructuredModels(available.models)) {
        setAiSetupResume(workflowId);
        setShowAiSetup(true);
        setReflectionMessage(
          "Add a model provider key in Settings before asking this partner."
        );
        return;
      }
      setShowAiSetup(false);
      setAiSetupResume(undefined);
      if (
        (workflowId === "sketch-partner.craft-fields" ||
          workflowId === "worldkeeper.backdrop-fields") &&
        craftSceneId.trim() === ""
      ) {
        setReflectionMessage("Choose a scene before asking this partner.");
        return;
      }
      if (
        workflowId === "character-coach.sheet-fields" &&
        craftCharacterId.trim() === ""
      ) {
        setReflectionMessage("Choose a cast member before Character Coach.");
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
      setReflectionMessage(`Ready to ask ${label}.`);
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

  async function resumeAfterAiSetup(): Promise<void> {
    setShowAiSetup(false);
    const resume = aiSetupResume;
    setAiSetupResume(undefined);
    if (resume === undefined || resume === "scene") {
      return;
    }
    await beginCraftPartner(resume);
  }

  async function applyScenePartnerChatAsNewScene(input: Readonly<{
    title: string;
    placementKey: string;
  }>): Promise<void> {
    if (proposalApplied) {
      throw new Error("This proposal was already applied.");
    }
    if (project === undefined) {
      throw new Error("Manuscript apply is not wired for this idea yet.");
    }
    const placement = resolveManuscriptHandoffPlacement(
      project,
      input.placementKey
    );
    if (placement === undefined) {
      throw new Error("Choose a manuscript placement before applying.");
    }
    const title = input.title.trim();
    if (title.length === 0) {
      throw new Error("Give the new scene a title before applying.");
    }

    if (
      reflectionProposal !== undefined &&
      reflectionProposal.payload.schemaId === "capture-reflection-v1" &&
      projectVersion !== undefined
    ) {
      setReflectionBusy(true);
      try {
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
        void loadCaptures();
        if (onOpenDraft !== undefined) {
          onOpenDraft(result.scene.id);
        }
        return;
      } finally {
        setReflectionBusy(false);
      }
    }

    if (
      onPromote === undefined ||
      detailHead === undefined ||
      selectedCaptureId === undefined ||
      project === undefined ||
      projectVersion === undefined
    ) {
      throw new Error("Manuscript apply is not wired for this idea yet.");
    }

    const request = buildCaptureHandoffPromoteRequest({
      captureId: selectedCaptureId,
      captureHead: detailHead,
      projectVersion,
      project,
      form: {
        title,
        placementKey: input.placementKey,
        canvasEnabled: false
      }
    });
    if (request === undefined) {
      throw new Error("Ghostwriter could not prepare that scene apply.");
    }
    setHandoffBusy(true);
    try {
      const result = await onPromote(request);
      setDetailHead(result.captureHead);
      setProposalApplied(true);
      void loadCaptures();
      if (onOpenDraft !== undefined) {
        onOpenDraft(result.scene.id);
      }
    } finally {
      setHandoffBusy(false);
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
      setReflectionMessage("Craft fields applied. Your prose is unchanged.");
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
      setReflectionMessage(`Applied as scene “${result.scene.title}”.`);
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
      setReflectionMessage(`Applied as named variant “${result.variant.name}”.`);
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

  function renderBreadcrumbs(): ReactNode {
    const crumbs: Array<Readonly<{ key: string; label: string; onPress?(): void }>> = [
      {
        key: "home",
        label: PLANS_TITLE,
        onPress: selectedCaptureId === undefined ? undefined : goHome
      }
    ];
    if (selectedCaptureId !== undefined) {
      crumbs.push({
        key: "idea",
        label: ideaTitle,
        onPress: workflowStep === "idea" ? undefined : goIdea
      });
      if (workflowStep !== "idea") {
        crumbs.push({
          key: workflowStep,
          label: workflowStepLabel(workflowStep)
        });
      }
    }
    return (
      <View
        accessibilityLabel="Breadcrumb"
        style={styles.breadcrumb}
      >
        {crumbs.map((crumb, index) => (
          <View key={crumb.key} style={styles.breadcrumbItem}>
            {index > 0 ? <Text style={styles.breadcrumbSep}>›</Text> : null}
            {crumb.onPress !== undefined ? (
              <Pressable
                accessibilityRole="link"
                disabled={sessionControlsDisabled}
                onPress={crumb.onPress}
                style={({ pressed }) => [
                  pressed && !sessionControlsDisabled && styles.buttonPressed,
                  sessionControlsDisabled && styles.buttonDisabled
                ]}
              >
                <Text style={styles.breadcrumbLink}>{crumb.label}</Text>
              </Pressable>
            ) : (
              <Text
                accessibilityRole={index === 0 ? "header" : undefined}
                style={styles.breadcrumbCurrent}
              >
                {crumb.label}
              </Text>
            )}
          </View>
        ))}
      </View>
    );
  }

  function renderReflectionStatusAndProposal(): ReactNode {
    return (
      <>
        {showAiSetup ? (
          <AiSetupPanel
            compact={compact}
            onConfigured={() => {
              void resumeAfterAiSetup();
            }}
            onDismiss={() => {
              setShowAiSetup(false);
              setAiSetupResume(undefined);
            }}
          />
        ) : null}
        {reflectionMessage !== undefined ? (
          <Text style={styles.statusCopy}>{reflectionMessage}</Text>
        ) : null}
        {pendingReceipt !== undefined ? (
          <InboxButton
            disabled={sessionControlsDisabled}
            label="Start partner"
            onPress={() => void confirmPartnerRun()}
            primary
          />
        ) : null}
        {reflectionProposal !== undefined &&
        !proposalApplied &&
        reflectionProposal.payload.schemaId !== "plan-outline-v1" ? (
          <InboxButton
            disabled={sessionControlsDisabled}
            label="Reject proposal"
            onPress={() => void rejectReflectionProposal()}
          />
        ) : null}
        {reflectionProposal !== undefined &&
        reflectionProposal.payload.schemaId === "plan-outline-v1" ? (
          <View style={styles.proposalCard}>
            <Text style={styles.proposalSummary}>
              {reflectionProposal.payload.title}
            </Text>
            <Text style={styles.statusCopy}>{reflectionProposal.payload.outline}</Text>
            {!proposalApplied ? (
              <View style={styles.headerActions}>
                <InboxButton
                  disabled={sessionControlsDisabled}
                  label="Acknowledge"
                  onPress={() => void acknowledgePlanOutlineProposal()}
                  primary
                />
                <InboxButton
                  disabled={sessionControlsDisabled}
                  label="Reject"
                  onPress={() => void rejectReflectionProposal()}
                />
              </View>
            ) : null}
          </View>
        ) : null}
        {reflectionProposal !== undefined &&
        reflectionProposal.payload.schemaId !== "capture-reflection-v1" &&
        reflectionProposal.payload.schemaId !== "plan-outline-v1" ? (
          <View style={styles.proposalCard}>
            <Text style={styles.proposalSummary}>Typed craft proposal ready</Text>
            {Object.entries(reflectionProposal.payload)
              .filter(([key]) => key !== "schemaId")
              .map(([key, value]) => (
                <Text key={key} style={styles.statusCopy}>
                  {key}: {String(value)}
                </Text>
              ))}
            {!proposalApplied && projectVersion !== undefined ? (
              <InboxButton
                disabled={sessionControlsDisabled}
                label="Apply craft fields"
                onPress={() => void applyCraftProposalFields()}
                primary
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
              <Text key={question} style={styles.statusCopy}>
                · {question}
              </Text>
            ))}
            {reflectionProposal.payload.possibleStoryJobs.map((job) => (
              <Text key={job.label} style={styles.statusCopy}>
                {job.label}: {job.rationale}
              </Text>
            ))}
            {!proposalApplied &&
            project !== undefined &&
            projectVersion !== undefined ? (
              <View style={styles.applyPane}>
                <Text style={styles.sectionTitle}>Apply as new scene</Text>
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
                  primary
                />
                <Text style={styles.sectionTitle}>Apply as named variant</Text>
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
      </>
    );
  }

  function renderIdeaChoices(): ReactNode {
    const canPartner = captureInboxCanRequestReflection(detailHead);
    const ideaProse =
      detailHead === undefined
        ? ""
        : sceneDocumentPlainText(detailHead.document);
    return (
      <View style={styles.ideaStep}>
        <Text accessibilityRole="header" style={styles.prompt}>
          {DREAMS_IDEA_PROMPT}
        </Text>
        <View
          accessibilityLabel="Idea Capture contents"
          style={styles.ideaPreview}
        >
          {detailLoading ? (
            <Text style={styles.statusCopy}>Loading this idea…</Text>
          ) : ideaProse.length === 0 ? (
            <Text style={styles.statusCopy}>This idea has no prose yet.</Text>
          ) : (
            <Text style={styles.ideaPreviewText}>{ideaProse}</Text>
          )}
        </View>
        <View style={styles.choiceGrid}>
          {canPartner ? (
            <>
              <ChoiceCard
                disabled={sessionControlsDisabled}
                onPress={() => enterWorkflow("scene-partner")}
                subtitle="Find where this idea fits in the story"
                title="Scene Partner"
              />
              <ChoiceCard
                disabled={sessionControlsDisabled}
                onPress={() => enterWorkflow("craft-partner")}
                subtitle="Sketch fields or character coaching"
                title="Craft Partner"
              />
              <ChoiceCard
                disabled={sessionControlsDisabled}
                onPress={() => enterWorkflow("worldkeeper")}
                subtitle="Backdrop and setting notes"
                title="Worldkeeper"
              />
            </>
          ) : (
            <Text style={styles.statusCopy}>
              {detailHead?.status === "integrated"
                ? "This idea is already in the manuscript."
                : "Partners are unavailable for this idea."}
            </Text>
          )}
          <ChoiceCard
            disabled={sessionControlsDisabled || !handoffReady}
            onPress={() => enterWorkflow("integrate")}
            secondary
            subtitle="Place it in Draft yourself"
            title="Add to manuscript"
          />
        </View>
        {selectedCaptureId !== undefined ? (
          <View style={styles.headerActions}>
            <InboxButton
              disabled={sessionControlsDisabled}
              label="Edit Idea Capture"
              onPress={() => openViewSource(selectedCaptureId)}
            />
          </View>
        ) : null}
      </View>
    );
  }

  function renderScenePartnerStep(): ReactNode {
    if (selectedCaptureId === undefined || detailHead === undefined) {
      return null;
    }
    const ideaProse = sceneDocumentPlainText(detailHead.document);
    const scenes = navigatorScenes.map((scene) => ({
      id: scene.id,
      title: scene.label.includes(" · ")
        ? (scene.label.split(" · ").at(-1) ?? scene.label)
        : scene.label,
      label: scene.label
    }));
    return (
      <ScenePartnerChatPanel
        captureId={selectedCaptureId}
        compact={compact}
        defaultPlacementKey={manuscriptChoices[0]?.key ?? ""}
        defaultTitle={CAPTURE_HANDOFF_DEFAULT_SCENE_TITLE}
        disabled={sessionControlsDisabled}
        ideaProse={ideaProse}
        onApplyAsNewScene={applyScenePartnerChatAsNewScene}
        onBusyChange={(busy) => {
          setReflectionBusy(busy);
        }}
        onOpenSettings={onOpenSettings}
        placementChoices={manuscriptChoices.map((choice) => ({
          key: choice.key,
          label: choice.label
        }))}
        projectId={projectId}
        providerStatusSignal={providerStatusSignal}
        scenes={scenes}
      />
    );
  }

  function renderCraftPartnerStep(): ReactNode {
    return (
      <View style={styles.workflowPane}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          Craft Partner
        </Text>
        <Text style={styles.statusCopy}>Choose a secondary partner.</Text>
        <View style={styles.choiceGrid}>
          <ChoiceCard
            disabled={sessionControlsDisabled}
            onPress={() => void beginCraftPartner("sketch-partner.craft-fields")}
            subtitle="Scene craft fields from this idea"
            title="Sketch Partner"
          />
          <ChoiceCard
            disabled={sessionControlsDisabled}
            onPress={() =>
              void beginCraftPartner("character-coach.sheet-fields")
            }
            subtitle="Character sheet updates from this idea"
            title="Character Coach"
          />
        </View>
        <Text style={styles.sectionTitle}>Scene</Text>
        <View style={styles.headerActions}>
          {navigatorScenes.map((scene) => (
            <InboxButton
              key={scene.id}
              disabled={sessionControlsDisabled}
              label={
                craftSceneId === scene.id
                  ? `✓ ${scene.label}`
                  : scene.label
              }
              onPress={() => setCraftSceneId(scene.id)}
            />
          ))}
        </View>
        <Text style={styles.sectionTitle}>Cast</Text>
        <View style={styles.headerActions}>
          {castChoices.map((cast) => (
            <InboxButton
              key={cast.id}
              disabled={sessionControlsDisabled}
              label={
                craftCharacterId === cast.id
                  ? `✓ ${cast.label}`
                  : cast.label
              }
              onPress={() => setCraftCharacterId(cast.id)}
            />
          ))}
        </View>
        {renderReflectionStatusAndProposal()}
      </View>
    );
  }

  function renderWorldkeeperStep(): ReactNode {
    return (
      <View style={styles.workflowPane}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          Worldkeeper
        </Text>
        <Text style={styles.sectionTitle}>Scene</Text>
        <View style={styles.headerActions}>
          {navigatorScenes.map((scene) => (
            <InboxButton
              key={scene.id}
              disabled={sessionControlsDisabled}
              label={
                craftSceneId === scene.id
                  ? `✓ ${scene.label}`
                  : scene.label
              }
              onPress={() => setCraftSceneId(scene.id)}
            />
          ))}
        </View>
        <InboxButton
          disabled={sessionControlsDisabled}
          label="Ask Worldkeeper"
          onPress={() => void beginCraftPartner("worldkeeper.backdrop-fields")}
          primary
        />
        {renderReflectionStatusAndProposal()}
      </View>
    );
  }

  function renderIntegrateStep(): ReactNode {
    if (
      handoffReady &&
      detailHead !== undefined &&
      selectedCaptureId !== undefined &&
      project !== undefined &&
      projectVersion !== undefined
    ) {
      return (
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
      );
    }
    return (
      <View style={styles.detailFallback}>
        <Text style={styles.statusCopy}>
          Manuscript handoff needs project wiring from the workspace.
        </Text>
        {selectedCaptureId !== undefined ? (
          <InboxButton
            disabled={sessionControlsDisabled}
            label="View source"
            onPress={() => openViewSource(selectedCaptureId)}
          />
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.panel}>
      <View style={styles.header}>
        <View style={styles.headingCopy}>{renderBreadcrumbs()}</View>
        <View style={styles.headerActions}>
          {selectedCaptureId !== undefined ? (
            <InboxButton
              disabled={sessionControlsDisabled}
              label="Back"
              onPress={() => {
                if (workflowStep !== "idea") {
                  goIdea();
                  return;
                }
                goHome();
              }}
            />
          ) : (
            <InboxButton
              disabled={sessionControlsDisabled}
              label="New idea"
              onPress={() => onOpenCapture()}
              primary
            />
          )}
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
            {loadFailureMessage ?? INBOX_LOAD_FALLBACK}
          </Text>
          <InboxButton label="Try again" onPress={() => void loadCaptures()} />
        </View>
      ) : null}

      {phase === "empty" && !loading ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No ideas yet</Text>
          <Text style={styles.emptyText}>
            {includeArchived
              ? "Archived ideas you restore will return to the active list."
              : "Start with a new idea — typed or dictated — and it will land here."}
          </Text>
          {includeArchived ? null : (
            <InboxButton
              disabled={sessionControlsDisabled}
              label="New idea"
              onPress={() => onOpenCapture()}
              primary
            />
          )}
        </View>
      ) : null}

      {phase === "ready" ? (
        <View style={styles.workspace}>
          {showList ? (
            <ScrollView contentContainerStyle={styles.list}>
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
                      <Pressable
                        accessibilityHint="Opens this idea"
                        accessibilityLabel={rowTitle}
                        accessibilityRole="button"
                        accessibilityState={{
                          disabled: sessionControlsDisabled,
                          selected
                        }}
                        disabled={sessionControlsDisabled}
                        onPress={() => onSelectCapture?.(summary.captureId)}
                        style={({ pressed }) => [
                          styles.rowMain,
                          pressed && !sessionControlsDisabled && styles.buttonPressed,
                          sessionControlsDisabled && styles.buttonDisabled
                        ]}
                      >
                        <View style={styles.rowLabels}>
                          {readOnly ? (
                            <Text style={styles.readOnlyPill}>Read-only</Text>
                          ) : null}
                          <Text style={styles.statusChip}>
                            {captureInboxStatusLabel(summary.status)}
                          </Text>
                        </View>
                        <Text style={styles.rowTitle}>{rowTitle}</Text>
                        <Text style={styles.rowMeta}>
                          {captureInboxMetaLine(summary)}
                        </Text>
                        {integratedNote !== undefined ? (
                          <Text style={styles.integratedNote}>{integratedNote}</Text>
                        ) : null}
                      </Pressable>
                      <View style={styles.rowActions}>
                        <InboxButton
                          disabled={sessionControlsDisabled}
                          label="Edit"
                          onPress={() => onOpenCapture(summary.captureId)}
                        />
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
                      </View>
                    </View>
                  );
                })}
              </View>
            </ScrollView>
          ) : null}

          {showDetail ? (
            <ScrollView
              contentContainerStyle={styles.detailPaneContent}
              keyboardShouldPersistTaps="handled"
              style={styles.detailPane}
            >
              {detailLoading ? (
                <Text style={styles.loadingText}>Loading idea…</Text>
              ) : null}
              {detailLoadFailed ? (
                <View accessibilityRole="alert" style={styles.notice}>
                  <Text style={styles.noticeText}>
                    {detailFailureMessage ??
                      "Ghostwriter could not load this idea."}
                  </Text>
                  <InboxButton
                    disabled={sessionControlsDisabled}
                    label="Try again"
                    onPress={() => void loadDetailHead()}
                  />
                </View>
              ) : null}
              {!detailLoading && !detailLoadFailed && detailHead !== undefined
                ? workflowStep === "idea"
                  ? renderIdeaChoices()
                  : workflowStep === "scene-partner"
                    ? renderScenePartnerStep()
                    : workflowStep === "craft-partner"
                      ? renderCraftPartnerStep()
                      : workflowStep === "worldkeeper"
                        ? renderWorldkeeperStep()
                        : renderIntegrateStep()
                : null}
            </ScrollView>
          ) : null}
        </View>
      ) : null}

      {phase === "loading" ? (
        <View style={styles.loading}>
          <Text style={styles.loadingText}>Loading {PLANS_TITLE}…</Text>
        </View>
      ) : null}
    </View>
  );
}

const INBOX_LOAD_FALLBACK = "Ghostwriter could not load Plans.";

const styles = StyleSheet.create({
  panel: {
    backgroundColor: colors.paper,
    flex: 1,
    gap: 12,
    minHeight: 0,
    overflow: "hidden",
    padding: 16
  },
  header: {
    alignItems: "flex-start",
    flexDirection: "row",
    flexShrink: 0,
    flexWrap: "wrap",
    gap: 12,
    justifyContent: "space-between"
  },
  headingCopy: {
    flex: 1,
    gap: 4,
    minWidth: 200
  },
  breadcrumb: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6
  },
  breadcrumbItem: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    maxWidth: "100%"
  },
  breadcrumbSep: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 16
  },
  breadcrumbLink: {
    color: colors.brandDark,
    fontFamily: fonts.story,
    fontSize: 22
  },
  breadcrumbCurrent: {
    color: colors.ink,
    fontFamily: fonts.story,
    fontSize: 22
  },
  headerActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  liveStatus: {
    color: colors.muted,
    flexShrink: 0,
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
  ideaStep: {
    gap: 16
  },
  prompt: {
    color: colors.ink,
    fontFamily: fonts.story,
    fontSize: 26,
    lineHeight: 32
  },
  ideaPreview: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 10,
    borderWidth: 1,
    padding: 14
  },
  ideaPreviewText: {
    color: colors.ink,
    fontFamily: fonts.story,
    fontSize: 17,
    lineHeight: 26
  },
  choiceGrid: {
    gap: 10
  },
  choiceCard: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 12,
    borderWidth: 1,
    gap: 4,
    paddingHorizontal: 16,
    paddingVertical: 14
  },
  choiceCardSecondary: {
    backgroundColor: colors.wash
  },
  choiceCardTitle: {
    color: colors.ink,
    fontFamily: fonts.uiMedium,
    fontSize: 16
  },
  choiceCardSubtitle: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 13,
    lineHeight: 18
  },
  workflowPane: {
    gap: 12
  },
  sectionTitle: {
    color: colors.ink,
    fontFamily: fonts.uiMedium,
    fontSize: 16
  },
  statusCopy: {
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
    minHeight: 0,
    overflow: "hidden"
  },
  list: {
    paddingBottom: 16
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
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
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
  statusChip: {
    color: colors.muted,
    fontFamily: fonts.uiMedium,
    fontSize: 12
  },
  detailPane: {
    flex: 1,
    minHeight: 0,
    minWidth: 0
  },
  detailPaneContent: {
    gap: 12,
    paddingBottom: 16
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
