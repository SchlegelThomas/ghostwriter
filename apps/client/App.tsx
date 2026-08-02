import { CormorantGaramond_500Medium } from "@expo-google-fonts/cormorant-garamond/500Medium/index.js";
import { CormorantGaramond_500Medium_Italic } from "@expo-google-fonts/cormorant-garamond/500Medium_Italic/index.js";
import { Jost_400Regular } from "@expo-google-fonts/jost/400Regular/index.js";
import { Jost_500Medium } from "@expo-google-fonts/jost/500Medium/index.js";
import { Jost_600SemiBold } from "@expo-google-fonts/jost/600SemiBold/index.js";
import { Parisienne_400Regular } from "@expo-google-fonts/parisienne/400Regular/index.js";
import type {
  AgentModelId,
  BookId,
  CanvasCommand,
  CatalogAgentId,
  CatalogMemoLens,
  CanvasObjectId,
  CanvasRevisionId,
  ProjectCommand,
  ProjectNavigator,
  SceneId,
  StoryKnowledgeId,
  StoryProjectSummary,
  WorkPlanV1,
  WriterPublishingDetails
} from "@ghostwriter/core";
import {
  GHOSTWRITER_CAPABILITIES,
  NEXT_ACTION_COACH_DEFAULT_MODEL,
  nextActionScheduleDelayMs,
  parseBookCoverLocatorUrl,
  parseCharacterVisualLocatorUrl,
  sceneId as toSceneId,
  shouldAllowManualNextActionCoach,
  shouldOfferSceneSaveInvitation,
  storyKnowledgeId as toStoryKnowledgeId
} from "@ghostwriter/core";
import { blockId, validateSceneDocumentV1 } from "@ghostwriter/editor";
import {
  AccountGateScreen,
  AuthenticatedProjectWorkspace,
  BookReaderPanel,
  aggregateProjectChangesIdle,
  captureReturnStateFromScene,
  captureShellChangesIdle,
  finalizeCaptureShellActivityOnClose,
  scheduleCaptureFocusRestore,
  drillBack,
  drillIntoChapter,
  drillIntoScene,
  drillToScope,
  initialDrillStack,
  type CanvasDrillScope,
  type CanvasDrillStack,
  type CanvasWorkflowLens,
  ghostwriterTheme,
  ProjectLibraryScreen,
  type AcknowledgementToast,
  type ProjectWorkspaceMode,
  type ReaderVoicePack,
  type WriteComposition,
  type WriteInputModality,
  type WorkspaceChatMessage,
  type WorkspaceChatSendInput,
  type CaptureReturnState,
  type InboxWorkspacePresentation,
  DEFAULT_WORKSPACE_AGENT_PREFS,
  readWorkspaceAgentPrefs,
  writeWorkspaceAgentPrefs,
  accountHasAvailableChatModels,
  filterWorkspaceImageModels,
  resolveWorkspaceAgentModel,
  filterModelsByPreferences,
  readModelPreferences,
  resolveTaskModel,
  type WorkspaceAgentEffort,
  type WorkspaceAgentMode,
  type WorkspaceAvailableModel,
  type SettingsFocus,
  type WorkspaceChatSessionsState,
  activeWorkspaceChatMessages,
  activeWorkspaceChatSession,
  appendWorkspaceChatMessage,
  collectWorkspaceChatPriorTurns,
  createWorkspaceChatSession,
  deleteWorkspaceChatSession,
  dismissWorkspaceChatSession,
  contentfulWorkspaceChatSessions,
  emptyWorkspaceChatSessionsState,
  findLastUserMessage,
  forkWorkspaceChatSession,
  loadWorkspaceChatSessions,
  removeLastAssistantTurn,
  renameWorkspaceChatSession,
  reopenWorkspaceChatSession,
  replaceWorkspaceChatMessages,
  openWorkspaceChatSessions,
  saveWorkspaceChatSessions,
  setActiveWorkspaceChatSession,
  truncateMessagesBeforeUserMessage,
  updateActiveWorkspaceChatSessionPrefs,
  sceneSelection,
  workspaceModeForComposition,
  resolveAgentToolkitAction,
  type AgentToolkitId,
  type PlansAgentDeepLink,
  type EntityDraftSummary,
  type EntityDraftTarget,
  entityDraftDetailTitle,
  entityDraftPrimaryAction,
  formatEntityDraftDetailBody,
  SCENE_SAVE_NEXT_ACTION_INVITE_CHIPS,
  SCENE_SAVE_NEXT_ACTION_INVITE_PROMPT,
  chipsFromNextActionV1,
  formatNextActionCoachMessage,
  sceneSaveNextActionDismissKey,
  isWorkPlanSubmitIntent,
  latestWorkPlanFromMessages,
  resolveWorkPlanScenes,
  workPlanFromNextActionV1,
  type WorkPlanJobStripAction,
  type WorkPlanJobStripJob
} from "@ghostwriter/ui";
import { useFonts } from "expo-font";
import { useEffect, useMemo, useReducer, useRef, useState, useCallback } from "react";
import { ActivityIndicator, Linking, View } from "react-native";
import {
  DraftPanel,
  type DraftAcknowledgementEvent,
  type DraftPanelHandle,
  type DraftProblemEvent
} from "./src/DraftPanel.js";
import {
  draftDeskSceneContext,
  projectScenes,
  sceneDocumentPlainText
} from "./src/draft-desk.js";
import {
  StoryCanvasPanel,
  type CanvasPanelMessage
} from "./src/StoryCanvasPanel.js";
import {
  beginGoogleSignIn,
  signInDemoSeed,
  createSceneFromCanvas,
  createProject,
  createCapture,
  createStoryKnowledgeDraft,
  executeCanvasCommand,
  executeProjectCommand,
  getBookCoverDownload,
  getBookReader,
  getCanvasBoard,
  getCanvasHistory,
  getCanvasPreference,
  getCharacterVisualDownload,
  getCharacterVisualJob,
  getAvailableModels,
  getCurrentWriter,
  getProject,
  getSceneWorkspace,
  GhostwriterApiError,
  listProjects,
  getBookCoverImageJob,
  postBookCoverImageApply,
  postBookCoverImageJob,
  postCharacterVisualApply,
  postCharacterVisualJob,
  promoteCaptureToScene,
  persistPlanOutline,
  releaseSceneLease,
  runCatalogAgent,
  runNextActionCoach,
  restoreCanvasRevision,
  saveCanvasPreference,
  saveCaptureDocument,
  sendWorkspaceChat,
  sendWorkspaceChatStream,
  signOut,
  synthesizeReaderSpeech,
  undoCanvas,
  updateWriterProfile,
  listAgentProposals,
  getAgentProposal,
  rejectAgentProposal,
  acknowledgeAgentProposal,
  type AgentProposalSummaryResponse,
  type AgentProposalResponse,
  type BookCoverImageJobOption,
  type BookCoverImageJobStatus,
  type CharacterVisualJobOption,
  type CharacterVisualJobStatus,
  type BookReaderResponse,
  type CanvasPreferenceResponse,
  type CanvasHistoryResponse,
  type CanvasSceneGeometryInput,
  type CanvasScenePlacementInput,
  type CanvasWorkspaceResponse,
  type CurrentWriter,
  type WorkspaceChatAttachment
} from "./src/api.js";
import { useDictationSpeechRecognition } from "./src/useDictationSpeechRecognition.js";
import { getSpeechRecognitionConstructor } from "./src/speech-recognition-dictation.js";
import { executeWorkPlan } from "./src/work-plan-orchestrator.js";
import {
  canvasFailureDisposition,
  preferredCanvasSceneId
} from "./src/canvas-model.js";
import {
  acknowledgementForCanvasCommand,
  acknowledgementForProjectCommand,
  acknowledgementToast,
  problemToast,
  shouldShowDraftAcknowledgement,
  toastReducer
} from "./src/acknowledgements.js";
import {
  pushRecentCanvasAction,
  type RecentCanvasAction
} from "./src/canvas-chrome.js";
import type { ManuscriptSelection } from "@ghostwriter/ui";
import { sceneRecoveryService } from "./src/scene-recovery.js";
import {
  CaptureComposerPanel,
  type CaptureComposerHandle
} from "./src/CaptureComposerPanel.js";
import { CaptureModalShell } from "./src/CaptureModalShell.js";
import { InboxPanel } from "./src/InboxPanel.js";
import { SettingsPanel } from "./src/SettingsPanel.js";
import {
  captureRecoveryService
} from "./src/capture-recovery.js";
import type {
  CaptureComposerAcknowledgementEvent,
  CaptureComposerActivity,
  CaptureComposerProblemEvent
} from "./src/capture-composer.js";
import type {
  CaptureHandoffPromoteInput
} from "./src/capture-handoff.js";
import {
  acknowledgementCopyForCapturePromotion,
  handoffTargetShouldAbortAfterDraftPrepFailed,
  installCapturePromotionState
} from "./src/capture-handoff.js";
import type {
  InboxPanelAcknowledgementEvent,
  InboxPanelActivity,
  InboxPanelProblemEvent
} from "./src/inbox-panel.js";

type AppPhase = "loading" | "signedOut" | "library" | "project";

type ActiveCoverOptionsJob = Readonly<{
  projectId: string;
  bookId: BookId;
  bookTitle: string;
  jobId: string;
  status: BookCoverImageJobStatus;
  options?: readonly BookCoverImageJobOption[];
  error?: Readonly<{
    code: string;
    message: string;
  }>;
  basePrompt?: string;
}>;

type ActiveCharacterVisualJob = Readonly<{
  projectId: string;
  knowledgeId: StoryKnowledgeId;
  jobId: string;
  status: CharacterVisualJobStatus;
  options?: readonly CharacterVisualJobOption[];
  error?: Readonly<{
    code: string;
    message: string;
  }>;
  basePrompt?: string;
}>;

type ReaderReturnState = Readonly<{
  workspaceMode: ProjectWorkspaceMode;
  selectedSceneId?: SceneId;
  selectedCanvasObjectId?: CanvasObjectId;
  drillStack: CanvasDrillStack;
  workflowLens: CanvasWorkflowLens;
}>;

function bookIdForScene(
  project: ProjectNavigator,
  sceneId: SceneId
): BookId | undefined {
  for (const book of project.books) {
    const inTree = [
      ...book.parts.flatMap((part) =>
        part.chapters.flatMap((chapter) => chapter.scenes)
      ),
      ...book.unassignedScenes
    ].some((scene) => scene.id === sceneId);
    if (inTree) return book.id;
  }
  return undefined;
}

function returnUrl(): string {
  if (typeof globalThis.location !== "undefined") {
    return `${globalThis.location.origin}/`;
  }
  return process.env.EXPO_PUBLIC_APP_URL ?? "ghostwriter://";
}

function resolveWorkspaceModelForTask(
  mode: WorkspaceAgentMode,
  current: AgentModelId,
  models: readonly WorkspaceAvailableModel[],
  accountId: string | undefined
): AgentModelId {
  const prefs = readModelPreferences(accountId);
  const taskDefault = resolveTaskModel(prefs, mode, undefined);
  if (
    taskDefault !== undefined &&
    models.some((entry) => entry.id === taskDefault)
  ) {
    return taskDefault as AgentModelId;
  }
  return resolveWorkspaceAgentModel(current, models, mode);
}

function projectSceneIds(project: ProjectNavigator): readonly SceneId[] {
  return projectScenes(project).map((scene) => scene.id);
}

function mapProposalSummaryToEntityDraft(
  proposal: AgentProposalSummaryResponse
): EntityDraftSummary {
  return Object.freeze({
    id: proposal.id,
    outputSchemaId: proposal.outputSchemaId,
    createdAt: proposal.createdAt,
    ...(proposal.baseCaptureId === undefined
      ? {}
      : { baseCaptureId: proposal.baseCaptureId }),
    preview: proposal.preview
  });
}

function entityDraftSummaryFromProposalDetail(
  proposal: AgentProposalResponse
): EntityDraftSummary {
  const title = entityDraftDetailTitle(
    proposal.outputSchemaId,
    proposal.payload
  );
  return Object.freeze({
    id: proposal.id,
    outputSchemaId: proposal.outputSchemaId,
    createdAt: proposal.createdAt,
    ...(proposal.baseCaptureId === undefined
      ? {}
      : { baseCaptureId: proposal.baseCaptureId }),
    ...(title === undefined
      ? {}
      : { preview: Object.freeze({ title }) })
  });
}

function buildEntityDraftPlansDeepLink(
  draft: EntityDraftSummary
): PlansAgentDeepLink {
  let workflowStep: PlansAgentDeepLink["workflowStep"] = "scene-partner";
  if (draft.outputSchemaId === "plan-outline-v1") {
    workflowStep = "plan-outline";
  } else if (
    draft.outputSchemaId === "sketch-fields-v1" ||
    draft.outputSchemaId === "character-sheet-v1"
  ) {
    workflowStep = "craft-partner";
  } else if (draft.outputSchemaId === "backdrop-fields-v1") {
    workflowStep = "worldkeeper";
  }
  return Object.freeze({
    ...(draft.baseCaptureId === undefined ? {} : { captureId: draft.baseCaptureId }),
    proposalId: draft.id,
    ...(draft.outputSchemaId === "plan-outline-v1"
      ? { highlight: "plan-outline" as const }
      : {}),
    workflowStep
  });
}

export default function App() {
  const [fontsLoaded, fontError] = useFonts({
    [ghostwriterTheme.fonts.brand]: Parisienne_400Regular,
    [ghostwriterTheme.fonts.story]: CormorantGaramond_500Medium,
    [ghostwriterTheme.fonts.storyItalic]: CormorantGaramond_500Medium_Italic,
    [ghostwriterTheme.fonts.ui]: Jost_400Regular,
    [ghostwriterTheme.fonts.uiMedium]: Jost_500Medium,
    [ghostwriterTheme.fonts.uiSemibold]: Jost_600SemiBold
  });
  const [phase, setPhase] = useState<AppPhase>("loading");
  const [writer, setWriter] = useState<CurrentWriter>();
  const [projects, setProjects] = useState<readonly StoryProjectSummary[]>([]);
  const [selectedProject, setSelectedProject] = useState<ProjectNavigator>();
  const [workspaceMode, setWorkspaceMode] =
    useState<ProjectWorkspaceMode>("draft");
  const [writeComposition, setWriteComposition] =
    useState<WriteComposition>("page");
  const [writeModality, setWriteModality] =
    useState<WriteInputModality>("keyboard");
  const [assistOpen, setAssistOpen] = useState(false);
  const [drillStack, setDrillStack] =
    useState<CanvasDrillStack>(initialDrillStack);
  const [workflowLens, setWorkflowLens] =
    useState<CanvasWorkflowLens>("outline");
  const [selectedSceneId, setSelectedSceneId] = useState<SceneId>();
  const [chronologySceneIds, setChronologySceneIds] = useState<
    readonly SceneId[]
  >([]);
  const [sceneProseById, setSceneProseById] = useState<
    Readonly<Record<string, string>>
  >({});
  const [canvasWorkspace, setCanvasWorkspace] =
    useState<CanvasWorkspaceResponse>();
  const [canvasPreference, setCanvasPreference] =
    useState<CanvasPreferenceResponse | null>();
  const canvasPreferenceSaveGenRef = useRef(0);
  const [recentCanvasActions, setRecentCanvasActions] = useState<
    readonly RecentCanvasAction[]
  >([]);
  const [canvasHistoryOpen, setCanvasHistoryOpen] = useState(false);
  const canvasUndoActionRef = useRef<(() => void) | undefined>(undefined);
  const [canvasHistory, setCanvasHistory] = useState<CanvasHistoryResponse>();
  const [canvasHistoryLoading, setCanvasHistoryLoading] = useState(false);
  const [selectedCanvasObjectId, setSelectedCanvasObjectId] =
    useState<CanvasObjectId>();
  const [canvasLoading, setCanvasLoading] = useState(false);
  const [canvasBusy, setCanvasBusy] = useState(false);
  const [canvasSaveState, setCanvasSaveState] = useState<
    "saved" | "saving" | "error" | "conflict"
  >("saved");
  const [canvasMessage, setCanvasMessage] = useState<CanvasPanelMessage>();
  const [draftMountVersion, setDraftMountVersion] = useState(0);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">(
    "saved"
  );
  const [draftActivity, setDraftActivity] = useState<
    "idle" | "saving" | "problem"
  >("idle");
  const [profileSaveState, setProfileSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [toasts, dispatchToast] = useReducer(toastReducer, []);
  const [activityHistory, setActivityHistory] = useState<
    readonly AcknowledgementToast[]
  >([]);
  const [activityHistoryOpen, setActivityHistoryOpen] = useState(false);
  const [readerProjection, setReaderProjection] = useState<BookReaderResponse>();
  const [readerLoading, setReaderLoading] = useState(false);
  const [readerError, setReaderError] = useState<string>();
  const [readerVoiceError, setReaderVoiceError] = useState<string>();
  const [readerVoicePack, setReaderVoicePack] =
    useState<ReaderVoicePack>("default");
  const [readerSpeaking, setReaderSpeaking] = useState(false);
  const readerAudioRef = useRef<{ pause(): void } | null>(null);
  const chatAbortRef = useRef<AbortController | undefined>(undefined);
  const [chatStreaming, setChatStreaming] = useState(false);
  const [chatDictating, setChatDictating] = useState(false);
  const chatDictateAppendRef = useRef<((text: string) => void) | undefined>(
    undefined
  );
  const chatDictationAvailable =
    typeof window !== "undefined" &&
    getSpeechRecognitionConstructor() !== undefined;
  const [chatSessionsState, setChatSessionsState] =
    useState<WorkspaceChatSessionsState>(() => emptyWorkspaceChatSessionsState());
  const [chatMode, setChatMode] = useState<WorkspaceAgentMode>(
    DEFAULT_WORKSPACE_AGENT_PREFS.mode
  );
  const [chatModel, setChatModel] = useState<AgentModelId>(
    DEFAULT_WORKSPACE_AGENT_PREFS.model
  );
  const [chatEffort, setChatEffort] = useState<WorkspaceAgentEffort>(
    DEFAULT_WORKSPACE_AGENT_PREFS.effort
  );
  const [autoSuggestionsEnabled, setAutoSuggestionsEnabled] = useState(
    DEFAULT_WORKSPACE_AGENT_PREFS.autoSuggestions
  );
  const [requestOpenAgentPanel, setRequestOpenAgentPanel] = useState(0);
  const [requestFocusDraftScene, setRequestFocusDraftScene] = useState(0);
  const autoSuggestionsEnabledRef = useRef(autoSuggestionsEnabled);
  autoSuggestionsEnabledRef.current = autoSuggestionsEnabled;
  const nextActionIdleTimerRef = useRef<
    ReturnType<typeof setTimeout> | undefined
  >(undefined);
  const nextActionDismissedRevisionsRef = useRef(new Set<string>());
  const nextActionPendingSaveRef = useRef<
    Readonly<{ sceneId: SceneId; revision: number }> | undefined
  >(undefined);
  const nextActionLastPostedAtRef = useRef<number | undefined>(undefined);
  const nextActionInFlightRef = useRef(false);
  const [nextActionCoachBusy, setNextActionCoachBusy] = useState(false);
  const [workPlanJobSummary, setWorkPlanJobSummary] = useState("");
  const [workPlanJobs, setWorkPlanJobs] = useState<
    readonly WorkPlanJobStripJob[]
  >([]);
  const [workPlanJobActions, setWorkPlanJobActions] = useState<
    readonly WorkPlanJobStripAction[]
  >([]);
  const [requestReviewProjectDrafts, setRequestReviewProjectDrafts] =
    useState(0);
  const [requestReviewSceneDrafts, setRequestReviewSceneDrafts] = useState(0);
  const [requestReviewSceneDraftsSceneId, setRequestReviewSceneDraftsSceneId] =
    useState<SceneId | undefined>();
  const [requestOpenEntityDraft, setRequestOpenEntityDraft] = useState(0);
  const [requestOpenEntityDraftProposalId, setRequestOpenEntityDraftProposalId] =
    useState<string | undefined>();
  const [requestOpenEntityDraftScope, setRequestOpenEntityDraftScope] = useState<
    "scene" | "project" | undefined
  >();
  const [requestOpenEntityDraftSceneId, setRequestOpenEntityDraftSceneId] =
    useState<SceneId | undefined>();
  const [pendingEntityDraftProposalId, setPendingEntityDraftProposalId] =
    useState<string | undefined>();
  const workPlanSubmitInFlightRef = useRef(false);
  const workPlanLastCaptureIdRef = useRef<string | undefined>(undefined);
  const workPlanLastSceneIdRef = useRef<SceneId | undefined>(undefined);
  /** Undismissed next-steps turn in the active chat (timer-safe). */
  const nextActionOpenRef = useRef(false);
  const [chatProviderConfigured, setChatProviderConfigured] = useState(false);
  const [chatAvailableModels, setChatAvailableModels] = useState<
    readonly WorkspaceAvailableModel[]
  >([]);
  const chatMessages = useMemo(
    () => [...activeWorkspaceChatMessages(chatSessionsState)],
    [chatSessionsState]
  );

  useDictationSpeechRecognition({
    active: chatDictating,
    onInsertProse: (text) => chatDictateAppendRef.current?.(text),
    onStopDictation: () => setChatDictating(false),
    setAssistStatus: () => undefined,
    statusCopy: {
      listening: "Listening — speech enters the Agent composer.",
      unavailable: "Dictation is unavailable in this browser.",
      couldNotStart: "Could not start dictation.",
      stopped: "Dictation stopped — microphone permission or engine error."
    }
  });
  const chatSessionTabs = useMemo(
    () =>
      openWorkspaceChatSessions(chatSessionsState).map((session) =>
        Object.freeze({ id: session.id, title: session.title })
      ),
    [chatSessionsState]
  );
  const chatHistoryTabs = useMemo(() => {
    const openIds = new Set(
      openWorkspaceChatSessions(chatSessionsState).map((session) => session.id)
    );
    return contentfulWorkspaceChatSessions(chatSessionsState).map((session) =>
      Object.freeze({
        id: session.id,
        title: session.title,
        open: openIds.has(session.id)
      })
    );
  }, [chatSessionsState]);
  const imageAvailableModels = useMemo(
    () => filterWorkspaceImageModels(chatAvailableModels),
    [chatAvailableModels]
  );
  const readerReturnStateRef = useRef<ReaderReturnState | undefined>(undefined);
  const draftPanelRef = useRef<DraftPanelHandle>(null);
  const selectedProjectRef = useRef<ProjectNavigator | undefined>(undefined);
  const toastSequenceRef = useRef(0);
  const toastActionsRef = useRef(
    new Map<string, () => void | Promise<void>>()
  );
  const metadataUndoToastIdRef = useRef<string | undefined>(undefined);
  const canvasUndoToastIdRef = useRef<string | undefined>(undefined);
  const lastDraftAcknowledgementAtRef = useRef<number | undefined>(undefined);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [activeCaptureId, setActiveCaptureId] = useState<string | undefined>();
  const [inboxSelectedCaptureId, setInboxSelectedCaptureId] = useState<
    string | undefined
  >();
  const [captureComposerReadOnly, setCaptureComposerReadOnly] = useState(false);
  const captureComposerRef = useRef<CaptureComposerHandle>(null);
  const captureReturnStateRef = useRef<CaptureReturnState | undefined>(
    undefined
  );
  const pendingCaptureFocusRestoreRef = useRef<
    CaptureReturnState | undefined
  >(undefined);
  const captureActivityRef = useRef<CaptureComposerActivity>("idle");
  const captureProblemWhileClosedRef = useRef(false);
  const [captureActivity, setCaptureActivity] =
    useState<CaptureComposerActivity>("idle");
  const [captureProblemWhileClosed, setCaptureProblemWhileClosed] =
    useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [plansAgentDeepLink, setPlansAgentDeepLink] = useState<
    PlansAgentDeepLink | undefined
  >();
  const [inboxActivity, setInboxActivity] =
    useState<InboxPanelActivity>("idle");
  const [inboxRefreshSignal, setInboxRefreshSignal] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsFocus>("providers");

  function openSettings(focus?: SettingsFocus): void {
    if (focus !== undefined) {
      setSettingsTab(focus);
    }
    setSettingsOpen(true);
  }
  const [providerStatusSignal, setProviderStatusSignal] = useState(0);
  const [modelPreferencesSignal, setModelPreferencesSignal] = useState(0);
  const preferredImageModelId = useMemo(() => {
    const prefs = readModelPreferences(writer?.account.id);
    return resolveTaskModel(prefs, "image", undefined);
  }, [writer?.account.id, modelPreferencesSignal]);
  const [coverOptionsJob, setCoverOptionsJob] = useState<
    ActiveCoverOptionsJob | undefined
  >();
  const [characterVisualJob, setCharacterVisualJob] = useState<
    ActiveCharacterVisualJob | undefined
  >();
  const [coverReviewBookId, setCoverReviewBookId] = useState<
    BookId | undefined
  >();
  const [castFocusKnowledgeId, setCastFocusKnowledgeId] = useState<
    StoryKnowledgeId | undefined
  >();
  const [entityDraftTarget, setEntityDraftTarget] = useState<
    EntityDraftTarget | undefined
  >();
  const [entityDrafts, setEntityDrafts] = useState<
    readonly EntityDraftSummary[]
  >([]);
  const [entityDraftsLoading, setEntityDraftsLoading] = useState(false);
  const [entityDraftMutatingProposalId, setEntityDraftMutatingProposalId] =
    useState<string | undefined>();
  const [entityDraftExpandedId, setEntityDraftExpandedId] = useState<
    string | undefined
  >();
  const [entityDraftExpandedBody, setEntityDraftExpandedBody] = useState<
    string | undefined
  >();
  const [entityDraftExpandedLoading, setEntityDraftExpandedLoading] =
    useState(false);
  const [entityDraftDetailTitles, setEntityDraftDetailTitles] = useState<
    Readonly<Record<string, string>>
  >({});
  const coverJobPollRef = useRef<ReturnType<typeof setInterval> | undefined>(
    undefined
  );
  const characterVisualJobPollRef = useRef<
    ReturnType<typeof setInterval> | undefined
  >(undefined);

  function focusTargetFromDocument():
    | CaptureReturnState["focusTarget"]
    | undefined {
    if (typeof document === "undefined") return undefined;
    const active = document.activeElement;
    if (active instanceof HTMLElement && typeof active.focus === "function") {
      return { focus: () => active.focus() };
    }
    return undefined;
  }

  async function flushCaptureIfOpen(): Promise<void> {
    if (!captureOpen || captureComposerRef.current === null) return;
    try {
      await captureComposerRef.current.flush();
    } catch {
      // Exit paths continue when Capture flush fails; recovery stays explicit.
    }
  }

  function handleCaptureActivityChange(
    activity: CaptureComposerActivity
  ): void {
    captureActivityRef.current = activity;
    setCaptureActivity(activity);
    if (activity === "problem") {
      captureProblemWhileClosedRef.current = true;
      setCaptureProblemWhileClosed(true);
    } else if (activity === "idle") {
      captureProblemWhileClosedRef.current = false;
      setCaptureProblemWhileClosed(false);
    }
  }

  function handleCaptureProblemResolved(id: string): void {
    dismissToast(id);
  }

  function bumpInboxRefresh(): void {
    setInboxRefreshSignal((signal) => signal + 1);
  }

  function openCaptureComposer(
    captureId?: string,
    options?: Readonly<{ readOnly?: boolean }>
  ): void {
    captureReturnStateRef.current = captureReturnStateFromScene(
      selectedSceneId,
      focusTargetFromDocument()
    );
    setCaptureComposerReadOnly(options?.readOnly === true);
    setActiveCaptureId(captureId);
    setCaptureOpen(true);
  }

  async function closeCaptureComposer(): Promise<void> {
    await flushCaptureIfOpen();
    const restore = captureReturnStateRef.current;
    captureReturnStateRef.current = undefined;
    pendingCaptureFocusRestoreRef.current = restore;
    const finalized = finalizeCaptureShellActivityOnClose(
      captureActivityRef.current,
      captureProblemWhileClosedRef.current
    );
    captureActivityRef.current = finalized.activity;
    captureProblemWhileClosedRef.current = finalized.problemWhileClosed;
    setCaptureActivity(finalized.activity);
    setCaptureProblemWhileClosed(finalized.problemWhileClosed);
    setCaptureOpen(false);
    setActiveCaptureId(undefined);
    setCaptureComposerReadOnly(false);
  }

  async function openInboxWorkspace(): Promise<void> {
    if (inboxOpen) return;
    const draftIsVisible =
      workspaceMode === "draft" || workspaceMode === "split";
    if (draftIsVisible) {
      setBusy(true);
      try {
        await prepareCurrentDraftForExit();
      } finally {
        setBusy(false);
      }
    }
    setInboxOpen(true);
  }

  function closeInboxWorkspace(): void {
    setInboxOpen(false);
    if (workspaceMode === "draft" || workspaceMode === "split") {
      setDraftMountVersion((version) => version + 1);
    }
  }

  async function ensureCanvasVersionForHandoff(): Promise<number | undefined> {
    if (selectedProject === undefined) return undefined;
    if (canvasWorkspace !== undefined) {
      return canvasWorkspace.board.version;
    }
    try {
      const loaded = await getCanvasBoard(selectedProject.id);
      setCanvasWorkspace(loaded);
      setCanvasSaveState("saved");
      setCanvasMessage(undefined);
      dismissToast("canvas-conflict");
      dismissToast("canvas-save-problem");
      return loaded.board.version;
    } catch {
      return undefined;
    }
  }

  async function handleCapturePromote(input: CaptureHandoffPromoteInput) {
    if (selectedProject === undefined) {
      throw new Error("Capture handoff requires an open project.");
    }
    const response = await promoteCaptureToScene({
      projectId: selectedProject.id,
      captureId: input.captureId,
      expectedCaptureWorkingVersion: input.expectedCaptureWorkingVersion,
      expectedCaptureContentHash: input.expectedCaptureContentHash,
      expectedProjectVersion: input.expectedProjectVersion,
      title: input.title,
      manuscriptPlacement: input.manuscriptPlacement,
      ...(input.canvas === undefined ? {} : { canvas: input.canvas })
    });
    const installed = installCapturePromotionState(response);
    setSelectedProject(installed.navigator);
    selectedProjectRef.current = installed.navigator;
    if (installed.canvasWorkspace !== undefined) {
      setCanvasWorkspace(installed.canvasWorkspace);
      setCanvasSaveState("saved");
      setCanvasMessage(undefined);
      dismissToast("canvas-conflict");
      dismissToast("canvas-save-problem");
    }
    setSaveState("saved");
    dismissToast("project-conflict");
    dismissToast("project-save-problem");
    bumpInboxRefresh();
    const acknowledgement = acknowledgementCopyForCapturePromotion(response);
    showToast(
      acknowledgementToast({
        id: nextToastId("capture-promote"),
        title: acknowledgement.title,
        detail: acknowledgement.detail,
        now: Date.now()
      })
    );
    return response;
  }

  async function openHandoffTargetScene(
    sceneId: SceneId,
    targetMode: "draft" | "split"
  ): Promise<void> {
    const needsDraftPrep =
      workspaceMode === "draft" || workspaceMode === "split";
    if (needsDraftPrep) {
      setBusy(true);
      let draftPrepFailed = false;
      try {
        await prepareCurrentDraftForExit();
      } catch (cause) {
        draftPrepFailed = true;
        handleError(
          cause,
          "Ghostwriter could not prepare Draft before opening the integrated scene."
        );
      } finally {
        setBusy(false);
      }
      if (handoffTargetShouldAbortAfterDraftPrepFailed(draftPrepFailed)) {
        return;
      }
    }

    setBusy(true);
    try {
      closeInboxWorkspace();
      setSelectedSceneId(sceneId);
      setSelectedCanvasObjectId(
        canvasWorkspace?.board.objects.find(
          (object) =>
            object.sceneId === sceneId && object.archivedAt === undefined
        )?.id
      );
      await changeWorkspaceMode(targetMode);
    } catch (cause) {
      handleError(cause, "Ghostwriter could not open the integrated scene.");
    } finally {
      setBusy(false);
    }
  }

  function handleCaptureAcknowledgement(
    event: CaptureComposerAcknowledgementEvent
  ): void {
    bumpInboxRefresh();
    showToast(
      acknowledgementToast({
        id: nextToastId(`capture-${event.kind}`),
        title: event.title,
        detail: `${event.detail} · Saved to project`,
        now: Date.now()
      })
    );
  }

  function handleCaptureProblem(problem: CaptureComposerProblemEvent): void {
    captureProblemWhileClosedRef.current = true;
    setCaptureProblemWhileClosed(true);
    showToast(
      problemToast({
        id: problem.id,
        title: problem.title,
        detail: problem.detail,
        tone: problem.tone,
        now: Date.now()
      })
    );
  }

  function handleInboxAcknowledgement(
    event: InboxPanelAcknowledgementEvent
  ): void {
    bumpInboxRefresh();
    showToast(
      acknowledgementToast({
        id: nextToastId(`inbox-${event.kind}`),
        title: event.title,
        detail: event.detail,
        now: Date.now()
      })
    );
  }

  function handleInboxProblem(problem: InboxPanelProblemEvent): void {
    showToast(
      problemToast({
        id: problem.id,
        title: problem.title,
        detail: problem.detail,
        tone: problem.tone,
        now: Date.now()
      })
    );
  }

  function resetCaptureInboxShell(): void {
    setCaptureOpen(false);
    setActiveCaptureId(undefined);
    setInboxSelectedCaptureId(undefined);
    setCaptureComposerReadOnly(false);
    captureReturnStateRef.current = undefined;
    pendingCaptureFocusRestoreRef.current = undefined;
    captureActivityRef.current = "idle";
    captureProblemWhileClosedRef.current = false;
    setCaptureActivity("idle");
    setCaptureProblemWhileClosed(false);
    setInboxOpen(false);
    setInboxActivity("idle");
    setInboxRefreshSignal(0);
  }

  useEffect(() => {
    if (captureOpen) return;
    const restore = pendingCaptureFocusRestoreRef.current;
    if (restore === undefined) return;
    pendingCaptureFocusRestoreRef.current = undefined;
    let frame = 0;
    let cancelled = false;
    scheduleCaptureFocusRestore(restore, (run) => {
      if (typeof requestAnimationFrame === "undefined") {
        if (!cancelled) run();
        return;
      }
      frame = requestAnimationFrame(() => {
        if (!cancelled) run();
      });
    });
    return () => {
      cancelled = true;
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [captureOpen]);

  useEffect(() => {
    void bootstrap();
  }, []);

  useEffect(() => {
    selectedProjectRef.current = selectedProject;
  }, [selectedProject]);

  useEffect(() => {
    const timer = setInterval(
      () => dispatchToast({ type: "tick", now: Date.now() }),
      500
    );
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const visibleIds = new Set(toasts.map((toast) => toast.id));
    for (const id of toastActionsRef.current.keys()) {
      if (!visibleIds.has(id)) toastActionsRef.current.delete(id);
    }
    if (
      metadataUndoToastIdRef.current !== undefined &&
      !visibleIds.has(metadataUndoToastIdRef.current)
    ) {
      metadataUndoToastIdRef.current = undefined;
    }
    if (
      canvasUndoToastIdRef.current !== undefined &&
      !visibleIds.has(canvasUndoToastIdRef.current)
    ) {
      canvasUndoToastIdRef.current = undefined;
    }
  }, [toasts]);

  function nextToastId(scope: string): string {
    toastSequenceRef.current += 1;
    return `${scope}-${toastSequenceRef.current}`;
  }

  function showToast(
    toast: AcknowledgementToast,
    action?: () => void | Promise<void>
  ): void {
    if (action !== undefined) toastActionsRef.current.set(toast.id, action);
    dispatchToast({ type: "push", toast });
    // History rail keeps a durable feed; floating toasts are no longer shown.
    setActivityHistory((current) => {
      const entry: AcknowledgementToast = {
        ...toast,
        expiresAt: undefined,
        pausedRemainingMs: undefined
      };
      return [entry, ...current.filter((item) => item.id !== entry.id)].slice(
        0,
        40
      );
    });
  }

  function clearCoverJobPoll(): void {
    if (coverJobPollRef.current === undefined) return;
    clearInterval(coverJobPollRef.current);
    coverJobPollRef.current = undefined;
  }

  function clearCharacterVisualJobPoll(): void {
    if (characterVisualJobPollRef.current === undefined) return;
    clearInterval(characterVisualJobPollRef.current);
    characterVisualJobPollRef.current = undefined;
  }

  useEffect(() => {
    return () => {
      clearCoverJobPoll();
      clearCharacterVisualJobPoll();
    };
  }, []);

  useEffect(() => {
    clearCoverJobPoll();
    clearCharacterVisualJobPoll();
    setCoverOptionsJob(undefined);
    setCharacterVisualJob(undefined);
    setCoverReviewBookId(undefined);
    setCastFocusKnowledgeId(undefined);
    setChronologySceneIds([]);
    setSceneProseById({});
  }, [selectedProject?.id]);

  const sceneProseByIdRef = useRef(sceneProseById);
  sceneProseByIdRef.current = sceneProseById;

  useEffect(() => {
    if (selectedProject === undefined || chronologySceneIds.length === 0) {
      return;
    }
    let cancelled = false;
    const projectId = selectedProject.id;
    const missing = chronologySceneIds.filter(
      (sceneId) => sceneProseByIdRef.current[String(sceneId)] === undefined
    );
    if (missing.length === 0) return;

    void (async () => {
      const loaded: Record<string, string> = {};
      await Promise.all(
        missing.map(async (sceneId) => {
          try {
            const workspace = await getSceneWorkspace({
              projectId,
              sceneId
            });
            loaded[String(sceneId)] = sceneDocumentPlainText(
              workspace.head.document
            );
          } catch {
            loaded[String(sceneId)] = "";
          }
        })
      );
      if (cancelled) return;
      setSceneProseById((current) => ({ ...current, ...loaded }));
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedProject?.id, selectedProject?.version, chronologySceneIds]);

  useEffect(() => {
    if (selectedProject === undefined) {
      setChatMode(DEFAULT_WORKSPACE_AGENT_PREFS.mode);
      setChatModel(DEFAULT_WORKSPACE_AGENT_PREFS.model);
      setChatEffort(DEFAULT_WORKSPACE_AGENT_PREFS.effort);
      setAutoSuggestionsEnabled(DEFAULT_WORKSPACE_AGENT_PREFS.autoSuggestions);
      setChatSessionsState(emptyWorkspaceChatSessionsState());
      return;
    }
    const loaded = loadWorkspaceChatSessions(
      writer?.account.id,
      selectedProject.id
    );
    setChatSessionsState(loaded);
    const projectPrefs = readWorkspaceAgentPrefs(selectedProject.id);
    const activeSession = activeWorkspaceChatSession(loaded);
    setChatMode(activeSession?.mode ?? projectPrefs.mode);
    setChatModel(activeSession?.model ?? projectPrefs.model);
    setChatEffort(activeSession?.effort ?? projectPrefs.effort);
    setAutoSuggestionsEnabled(projectPrefs.autoSuggestions);
    nextActionDismissedRevisionsRef.current.clear();
  }, [selectedProject?.id, writer?.account.id]);

  useEffect(() => {
    return () => {
      if (nextActionIdleTimerRef.current !== undefined) {
        clearTimeout(nextActionIdleTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (nextActionIdleTimerRef.current !== undefined) {
      clearTimeout(nextActionIdleTimerRef.current);
      nextActionIdleTimerRef.current = undefined;
    }
    nextActionPendingSaveRef.current = undefined;
  }, [selectedSceneId]);

  useEffect(() => {
    if (selectedProject === undefined) {
      setChatProviderConfigured(false);
      setChatAvailableModels([]);
      return;
    }
    const accountId = writer?.account.id;
    let cancelled = false;
    void getAvailableModels()
      .then((response) => {
        if (cancelled) return;
        const prefs = readModelPreferences(accountId);
        const preferenceFiltered = filterModelsByPreferences(
          response.models,
          prefs
        );
        setChatAvailableModels(preferenceFiltered);
        setChatProviderConfigured(
          accountHasAvailableChatModels(preferenceFiltered)
        );
        setChatModel((current) => {
          const resolved = resolveWorkspaceModelForTask(
            chatMode,
            current,
            preferenceFiltered,
            accountId
          );
          if (resolved !== current) {
            writeWorkspaceAgentPrefs(selectedProject.id, {
              mode: chatMode,
              model: resolved,
              effort: chatEffort,
              autoSuggestions: autoSuggestionsEnabled
            });
          }
          return resolved;
        });
      })
      .catch(() => {
        if (!cancelled) {
          setChatProviderConfigured(false);
          setChatAvailableModels([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    selectedProject?.id,
    providerStatusSignal,
    modelPreferencesSignal,
    writer?.account.id
  ]);

  function persistChatSessions(state: WorkspaceChatSessionsState): void {
    if (selectedProject === undefined) return;
    saveWorkspaceChatSessions(writer?.account.id, selectedProject.id, state);
  }

  function replaceActiveChatMessages(
    mutator: (messages: WorkspaceChatMessage[]) => WorkspaceChatMessage[]
  ): void {
    setChatSessionsState((current) => {
      const activeId = current.activeSessionId;
      const active = current.sessions.find((session) => session.id === activeId);
      if (active === undefined) return current;
      const next = replaceWorkspaceChatMessages(
        current,
        activeId,
        mutator([...active.messages])
      );
      persistChatSessions(next);
      return next;
    });
  }

  function appendActiveChatMessage(message: WorkspaceChatMessage): void {
    setChatSessionsState((current) => {
      const next = appendWorkspaceChatMessage(
        current,
        current.activeSessionId,
        message
      );
      persistChatSessions(next);
      return next;
    });
  }

  function persistChatPrefs(next: Readonly<{
    mode?: WorkspaceAgentMode;
    model?: AgentModelId;
    effort?: WorkspaceAgentEffort;
    autoSuggestions?: boolean;
  }>): void {
    if (selectedProject === undefined) return;
    writeWorkspaceAgentPrefs(selectedProject.id, {
      mode: next.mode ?? chatMode,
      model: next.model ?? chatModel,
      effort: next.effort ?? chatEffort,
      autoSuggestions: next.autoSuggestions ?? autoSuggestionsEnabled
    });
    setChatSessionsState((current) => {
      const updated = updateActiveWorkspaceChatSessionPrefs(current, {
        ...(next.mode === undefined ? {} : { mode: next.mode }),
        ...(next.model === undefined ? {} : { model: next.model }),
        ...(next.effort === undefined ? {} : { effort: next.effort })
      });
      persistChatSessions(updated);
      return updated;
    });
  }

  function handleChatSessionSelect(sessionId: string): void {
    setChatSessionsState((current) => {
      const next = setActiveWorkspaceChatSession(current, sessionId);
      persistChatSessions(next);
      const session = next.sessions.find((entry) => entry.id === sessionId);
      const projectPrefs =
        selectedProject === undefined
          ? DEFAULT_WORKSPACE_AGENT_PREFS
          : readWorkspaceAgentPrefs(selectedProject.id);
      setChatMode(session?.mode ?? projectPrefs.mode);
      setChatModel(session?.model ?? projectPrefs.model);
      setChatEffort(session?.effort ?? projectPrefs.effort);
      return next;
    });
  }

  function handleNewChatSession(): void {
    setChatSessionsState((current) => {
      const next = createWorkspaceChatSession(current, {
        mode: chatMode,
        model: chatModel,
        effort: chatEffort
      });
      persistChatSessions(next);
      return next;
    });
  }

  function handleRenameChatSession(sessionId: string, title: string): void {
    setChatSessionsState((current) => {
      const next = renameWorkspaceChatSession(current, sessionId, title);
      persistChatSessions(next);
      return next;
    });
  }

  function handleDismissChatSession(sessionId: string): void {
    setChatSessionsState((current) => {
      const next = dismissWorkspaceChatSession(current, sessionId);
      persistChatSessions(next);
      const session = next.sessions.find(
        (entry) => entry.id === next.activeSessionId
      );
      const projectPrefs =
        selectedProject === undefined
          ? DEFAULT_WORKSPACE_AGENT_PREFS
          : readWorkspaceAgentPrefs(selectedProject.id);
      setChatMode(session?.mode ?? projectPrefs.mode);
      setChatModel(session?.model ?? projectPrefs.model);
      setChatEffort(session?.effort ?? projectPrefs.effort);
      return next;
    });
  }

  function handleReopenChatSession(sessionId: string): void {
    setChatSessionsState((current) => {
      const next = reopenWorkspaceChatSession(current, sessionId);
      persistChatSessions(next);
      const session = next.sessions.find((entry) => entry.id === sessionId);
      const projectPrefs =
        selectedProject === undefined
          ? DEFAULT_WORKSPACE_AGENT_PREFS
          : readWorkspaceAgentPrefs(selectedProject.id);
      setChatMode(session?.mode ?? projectPrefs.mode);
      setChatModel(session?.model ?? projectPrefs.model);
      setChatEffort(session?.effort ?? projectPrefs.effort);
      return next;
    });
  }

  function handleDeleteChatSession(sessionId: string): void {
    setChatSessionsState((current) => {
      const next = deleteWorkspaceChatSession(current, sessionId);
      if (next === null) return current;
      persistChatSessions(next);
      const session = next.sessions.find(
        (entry) => entry.id === next.activeSessionId
      );
      const projectPrefs =
        selectedProject === undefined
          ? DEFAULT_WORKSPACE_AGENT_PREFS
          : readWorkspaceAgentPrefs(selectedProject.id);
      setChatMode(session?.mode ?? projectPrefs.mode);
      setChatModel(session?.model ?? projectPrefs.model);
      setChatEffort(session?.effort ?? projectPrefs.effort);
      return next;
    });
  }

  function dismissToast(id: string): void {
    toastActionsRef.current.delete(id);
    dispatchToast({ type: "dismiss", id });
    setActivityHistory((current) => current.filter((item) => item.id !== id));
  }

  function invalidateMetadataUndo(): void {
    const id = metadataUndoToastIdRef.current;
    if (id === undefined) return;
    toastActionsRef.current.delete(id);
    dispatchToast({ type: "expireAction", id });
    metadataUndoToastIdRef.current = undefined;
  }

  function invalidateCanvasUndo(): void {
    const id = canvasUndoToastIdRef.current;
    if (id === undefined) return;
    toastActionsRef.current.delete(id);
    dispatchToast({ type: "expireAction", id });
    canvasUndoToastIdRef.current = undefined;
  }

  function clearAcknowledgements(): void {
    toastActionsRef.current.clear();
    metadataUndoToastIdRef.current = undefined;
    canvasUndoToastIdRef.current = undefined;
    lastDraftAcknowledgementAtRef.current = undefined;
    dispatchToast({ type: "clear" });
  }

  function resetCanvasState(): void {
    setCanvasWorkspace(undefined);
    setCanvasPreference(undefined);
    setCanvasHistory(undefined);
    setCanvasHistoryLoading(false);
    setSelectedCanvasObjectId(undefined);
    setRecentCanvasActions([]);
    setCanvasHistoryOpen(false);
    canvasUndoActionRef.current = undefined;
    setCanvasLoading(false);
    setCanvasBusy(false);
    setCanvasSaveState("saved");
    setCanvasMessage(undefined);
  }

  function handleError(cause: unknown, fallback: string): void {
    if (cause instanceof GhostwriterApiError && cause.status === 401) {
      setWriter(undefined);
      setProjects([]);
      setSelectedProject(undefined);
      selectedProjectRef.current = undefined;
      setSelectedSceneId(undefined);
      setWorkspaceMode("draft");
      setDraftMountVersion(0);
      setDraftActivity("idle");
      resetCanvasState();
      clearAcknowledgements();
      resetCaptureInboxShell();
      setPhase("signedOut");
      setError("Your session ended. Sign in again to continue.");
      return;
    }
    setError(cause instanceof Error ? cause.message : fallback);
  }

  async function bootstrap(): Promise<void> {
    setError(undefined);
    try {
      const current = await getCurrentWriter();
      const ownedProjects = await listProjects(false);
      setWriter(current);
      setProjects(ownedProjects);
      setPhase("library");
    } catch (cause) {
      if (cause instanceof GhostwriterApiError && cause.status === 401) {
        setPhase("signedOut");
      } else {
        setPhase("signedOut");
        handleError(cause, "Ghostwriter could not load your account.");
      }
    }
  }

  async function refreshProjects(
    showArchived: boolean = includeArchived
  ): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      setProjects(await listProjects(showArchived));
    } catch (cause) {
      handleError(cause, "Ghostwriter could not refresh your projects.");
    } finally {
      setBusy(false);
    }
  }

  async function startGoogleSignIn(): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      const url = await beginGoogleSignIn(returnUrl());
      if (typeof globalThis.location !== "undefined") {
        globalThis.location.assign(url);
      } else {
        await Linking.openURL(url);
      }
    } catch (cause) {
      handleError(cause, "Google sign-in could not start.");
      setBusy(false);
    }
  }

  async function startDemoSignIn(): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      await signInDemoSeed();
      await bootstrap();
    } catch (cause) {
      handleError(cause, "Demo sign-in could not complete.");
    } finally {
      setBusy(false);
    }
  }

  async function endSession(): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      const accountId = writer?.account.id;
      await flushCaptureIfOpen();
      await prepareCurrentDraftForExit();
      await signOut();
      if (accountId !== undefined) {
        await sceneRecoveryService.clearAccount(accountId);
        await captureRecoveryService.clearAccount(accountId);
      }
      setWriter(undefined);
      setProjects([]);
      setSelectedProject(undefined);
      selectedProjectRef.current = undefined;
      setSelectedSceneId(undefined);
      setWorkspaceMode("draft");
      setDraftMountVersion(0);
      setDraftActivity("idle");
      resetCanvasState();
      clearAcknowledgements();
      resetCaptureInboxShell();
      setPhase("signedOut");
    } catch (cause) {
      handleError(cause, "Ghostwriter could not sign out.");
    } finally {
      setBusy(false);
    }
  }

  async function openProject(projectId: string): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      const opened = await getProject(projectId);
      clearAcknowledgements();
      setSelectedProject(opened);
      selectedProjectRef.current = opened;
      setSelectedSceneId(undefined);
      setWorkspaceMode("draft");
      setDrillStack(initialDrillStack());
      setWorkflowLens("outline");
      setDraftMountVersion(0);
      setDraftActivity("idle");
      resetCanvasState();
      setSaveState("saved");
      resetCaptureInboxShell();
      setPhase("project");
    } catch (cause) {
      handleError(cause, "Ghostwriter could not open the project.");
    } finally {
      setBusy(false);
    }
  }

  async function refreshCurrentProject(): Promise<void> {
    if (selectedProject === undefined) return;
    setBusy(true);
    setError(undefined);
    const draftIsVisible =
      workspaceMode === "draft" || workspaceMode === "split";
    if (draftIsVisible) await prepareCurrentDraftForExit();
    try {
      const latest = await getProject(selectedProject.id);
      invalidateMetadataUndo();
      dismissToast("project-conflict");
      dismissToast("project-save-problem");
      setSelectedProject(latest);
      selectedProjectRef.current = latest;
      const sceneIds = projectSceneIds(latest);
      setSelectedSceneId((current) =>
        current !== undefined && sceneIds.includes(current)
          ? current
          : undefined
      );
      if (draftIsVisible) {
        setDraftMountVersion((version) => version + 1);
      }
      if (workspaceMode === "canvas" || workspaceMode === "split") {
        await loadCanvas(
          latest.id,
          "Latest project and Canvas loaded for review."
        );
      }
      setSaveState("saved");
    } catch (cause) {
      handleError(cause, "Ghostwriter could not refresh the project.");
    } finally {
      setBusy(false);
    }
  }

  function beginCoverOptionsJobPoll(input: Readonly<{
    projectId: string;
    bookId: BookId;
    bookTitle: string;
    jobId: string;
  }>): void {
    clearCoverJobPoll();
    const pollOnce = (): void => {
      void (async () => {
        try {
          const snapshot = await getBookCoverImageJob({
            projectId: input.projectId,
            bookId: input.bookId,
            jobId: input.jobId
          });
          if (snapshot.status === "ready") {
            clearCoverJobPoll();
            setCoverOptionsJob((current) =>
              current?.jobId === input.jobId
                ? {
                    ...current,
                    status: "ready",
                    options: snapshot.options,
                    basePrompt: snapshot.basePrompt,
                    error: undefined
                  }
                : current
            );
            const now = Date.now();
            const toastId = nextToastId("cover-options");
            showToast(
              acknowledgementToast({
                id: toastId,
                title: "Cover options ready",
                detail: `${input.bookTitle} · ready to review`,
                now,
                actionLabel: "Review covers"
              }),
              () => {
                setCoverReviewBookId(input.bookId);
              }
            );
            return;
          }
          if (snapshot.status === "failed") {
            clearCoverJobPoll();
            setCoverOptionsJob((current) =>
              current?.jobId === input.jobId
                ? {
                    ...current,
                    status: "failed",
                    error: snapshot.error,
                    basePrompt: snapshot.basePrompt
                  }
                : current
            );
            showToast(
              problemToast({
                id: nextToastId("cover-options"),
                title: "Cover options failed",
                detail:
                  snapshot.error?.message ??
                  "Ghostwriter could not paint cover options.",
                now: Date.now()
              })
            );
            return;
          }
          setCoverOptionsJob((current) =>
            current?.jobId === input.jobId
              ? {
                  ...current,
                  status: snapshot.status,
                  basePrompt: snapshot.basePrompt
                }
              : current
          );
        } catch {
          // Transient poll failures keep the interval alive until ready/failed.
        }
      })();
    };
    pollOnce();
    coverJobPollRef.current = setInterval(pollOnce, 2000);
  }

  async function startBookCoverOptionsJob(input: Readonly<{
    bookId: BookId;
    prompt: string;
    count?: number;
    refinement?: string;
    imageModel?: string;
  }>): Promise<void> {
    if (selectedProject === undefined) {
      throw new Error("No project is open.");
    }
    const book = selectedProject.books.find(
      (entry) => entry.id === input.bookId
    );
    const bookTitle = book?.title ?? "Book";
    const projectId = selectedProject.id;
    clearCoverJobPoll();
    const started = await postBookCoverImageJob({
      projectId,
      bookId: input.bookId,
      prompt: input.prompt,
      count: input.count ?? 3,
      ...(input.refinement === undefined || input.refinement.trim() === ""
        ? {}
        : { refinement: input.refinement.trim() }),
      ...(input.imageModel === undefined || input.imageModel.trim() === ""
        ? {}
        : { imageModel: input.imageModel.trim() })
    });
    setCoverOptionsJob({
      projectId,
      bookId: input.bookId,
      bookTitle,
      jobId: started.jobId,
      status: "queued",
      basePrompt: input.prompt
    });
    beginCoverOptionsJobPoll({
      projectId,
      bookId: input.bookId,
      bookTitle,
      jobId: started.jobId
    });
  }

  async function applyBookCoverImage(input: Readonly<{
    bookId: BookId;
    previewDataUri: string;
  }>): Promise<void> {
    if (selectedProject === undefined) return;
    await postBookCoverImageApply({
      projectId: selectedProject.id,
      bookId: input.bookId,
      previewDataUri: input.previewDataUri
    });
    await refreshCurrentProject();
  }

  async function resolveBookCoverDisplayUrl(input: Readonly<{
    bookId: BookId;
    imageUrl: string;
  }>): Promise<string | undefined> {
    const locator = parseBookCoverLocatorUrl(input.imageUrl);
    if (locator === undefined) {
      return input.imageUrl;
    }
    const download = await getBookCoverDownload({
      projectId: locator.projectId,
      bookId: locator.bookId
    });
    return download.download.url;
  }

  function beginCharacterVisualJobPolling(input: Readonly<{
    projectId: string;
    knowledgeId: StoryKnowledgeId;
    jobId: string;
  }>): void {
    clearCharacterVisualJobPoll();
    const pollOnce = (): void => {
      void (async () => {
        try {
          const snapshot = await getCharacterVisualJob({
            projectId: input.projectId,
            knowledgeId: input.knowledgeId,
            jobId: input.jobId
          });
          if (snapshot.status === "ready") {
            clearCharacterVisualJobPoll();
            setCharacterVisualJob((current) =>
              current?.jobId === input.jobId
                ? {
                    ...current,
                    status: snapshot.status,
                    options: snapshot.options,
                    basePrompt: snapshot.basePrompt,
                    error: undefined
                  }
                : current
            );
            return;
          }
          if (snapshot.status === "failed") {
            clearCharacterVisualJobPoll();
            setCharacterVisualJob((current) =>
              current?.jobId === input.jobId
                ? {
                    ...current,
                    status: snapshot.status,
                    error: snapshot.error,
                    basePrompt: snapshot.basePrompt,
                    options: undefined
                  }
                : current
            );
            return;
          }
          setCharacterVisualJob((current) =>
            current?.jobId === input.jobId
              ? {
                  ...current,
                  status: snapshot.status,
                  basePrompt: snapshot.basePrompt
                }
              : current
          );
        } catch {
          clearCharacterVisualJobPoll();
          setCharacterVisualJob((current) =>
            current?.jobId === input.jobId
              ? {
                  ...current,
                  status: "failed",
                  error: {
                    code: "CHARACTER_VISUAL_POLL_FAILED",
                    message: "Could not check portrait generation status."
                  }
                }
              : current
          );
        }
      })();
    };
    pollOnce();
    characterVisualJobPollRef.current = setInterval(pollOnce, 2000);
  }

  async function startCharacterVisualJob(input: Readonly<{
    knowledgeId: StoryKnowledgeId;
    count?: number;
    refinement?: string;
    imageModel?: string;
  }>): Promise<void> {
    if (selectedProject === undefined) return;
    const projectId = selectedProject.id;
    clearCharacterVisualJobPoll();
    const started = await postCharacterVisualJob({
      projectId,
      knowledgeId: input.knowledgeId,
      count: input.count ?? 3,
      ...(input.refinement === undefined || input.refinement.trim() === ""
        ? {}
        : { refinement: input.refinement.trim() }),
      ...(input.imageModel === undefined || input.imageModel.trim() === ""
        ? {}
        : { imageModel: input.imageModel.trim() })
    });
    setCharacterVisualJob({
      projectId,
      knowledgeId: input.knowledgeId,
      jobId: started.jobId,
      status: "queued"
    });
    beginCharacterVisualJobPolling({
      projectId,
      knowledgeId: input.knowledgeId,
      jobId: started.jobId
    });
  }

  async function applyCharacterVisual(input: Readonly<{
    knowledgeId: StoryKnowledgeId;
    previewDataUri: string;
    alt: string;
    source: "generated" | "upload";
  }>): Promise<void> {
    if (selectedProject === undefined) return;
    await postCharacterVisualApply({
      projectId: selectedProject.id,
      knowledgeId: input.knowledgeId,
      previewDataUri: input.previewDataUri,
      alt: input.alt,
      source: input.source
    });
    if (
      characterVisualJob !== undefined &&
      characterVisualJob.knowledgeId === input.knowledgeId
    ) {
      setCharacterVisualJob(undefined);
    }
    await refreshCurrentProject();
  }

  async function resolveCharacterVisualDisplayUrl(input: Readonly<{
    knowledgeId: StoryKnowledgeId;
    visualId: string;
    imageUrl: string;
  }>): Promise<string | undefined> {
    const locator = parseCharacterVisualLocatorUrl(input.imageUrl);
    if (locator === undefined) {
      return input.imageUrl;
    }
    try {
      const download = await getCharacterVisualDownload({
        projectId: locator.projectId,
        knowledgeId: locator.knowledgeId,
        visualId: locator.visualId
      });
      return download.download.url;
    } catch {
      // Storage may be unavailable (503) or the object missing; thumbnails keep
      // the locator and must not throw into an effect retry loop.
      return undefined;
    }
  }

  async function makeProject(input: {
    title: string;
    firstBookTitle: string;
  }): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      const created = await createProject(input);
      clearAcknowledgements();
      setSelectedProject(created);
      selectedProjectRef.current = created;
      setSelectedSceneId(undefined);
      setWorkspaceMode("draft");
      setDrillStack(initialDrillStack());
      setWorkflowLens("outline");
      setDraftMountVersion(0);
      setDraftActivity("idle");
      resetCanvasState();
      setSaveState("saved");
      resetCaptureInboxShell();
      setPhase("project");
      const now = Date.now();
      showToast(
        acknowledgementToast({
          id: nextToastId("project"),
          title: "Project created",
          detail: `${created.title} · Saved to project`,
          now
        })
      );
    } catch (cause) {
      handleError(cause, "Ghostwriter could not create the project.");
    } finally {
      setBusy(false);
    }
  }

  async function runCommand(command: ProjectCommand): Promise<boolean> {
    const before = selectedProjectRef.current;
    if (before === undefined) return false;
    const previousSceneIds = new Set(projectSceneIds(before));
    setBusy(true);
    setError(undefined);
    setSaveState("saving");
    try {
      const updated = await executeProjectCommand({
        projectId: before.id,
        expectedVersion: before.version,
        command
      });
      setSelectedProject(updated);
      selectedProjectRef.current = updated;
      const updatedSceneIds = projectSceneIds(updated);
      const createdSceneId =
        command.type === "scene.create"
          ? updatedSceneIds.find((sceneId) => !previousSceneIds.has(sceneId))
          : undefined;
      setSelectedSceneId((current) => {
        if (createdSceneId !== undefined) return createdSceneId;
        return current !== undefined && updatedSceneIds.includes(current)
          ? current
          : updatedSceneIds[0];
      });
      setSaveState("saved");
      dismissToast("project-conflict");
      dismissToast("project-save-problem");

      const acknowledgement = acknowledgementForProjectCommand(
        before,
        command,
        updated
      );
      invalidateMetadataUndo();
      const now = Date.now();
      const id = nextToastId("project");
      const toast = acknowledgementToast({
        id,
        title: acknowledgement.title,
        detail: acknowledgement.detail,
        now,
        ...(acknowledgement.actionLabel === undefined
          ? {}
          : { actionLabel: acknowledgement.actionLabel })
      });
      if (
        acknowledgement.inverse !== undefined &&
        toast.expiresAt !== undefined
      ) {
        metadataUndoToastIdRef.current = id;
        const inverse = acknowledgement.inverse;
        const expiresAt = toast.expiresAt;
        showToast(toast, () =>
          undoProjectCommand(id, inverse, expiresAt)
        );
      } else {
        showToast(toast);
      }

      if (canvasWorkspace !== undefined) {
        try {
          setCanvasWorkspace(await getCanvasBoard(updated.id));
        } catch {
          setCanvasMessage({
            kind: "error",
            text: "Project metadata was saved, but the Canvas spine could not be refreshed."
          });
          showToast(
            problemToast({
              id: "canvas-spine-refresh",
              title: "Canvas spine needs refresh",
              detail:
                "Project metadata was saved, but the Canvas projection could not reload.",
              now: Date.now(),
              dismissible: true
            })
          );
        }
      }
      return true;
    } catch (cause) {
      setSaveState("error");
      if (
        cause instanceof GhostwriterApiError &&
        cause.code === "VERSION_CONFLICT"
      ) {
        invalidateMetadataUndo();
        try {
          const latest = await getProject(before.id);
          setSelectedProject(latest);
          selectedProjectRef.current = latest;
          const latestSceneIds = projectSceneIds(latest);
          setSelectedSceneId((current) =>
            current !== undefined && latestSceneIds.includes(current)
              ? current
              : latestSceneIds[0]
          );
          setError(
            "This project changed in another request. Ghostwriter reloaded the latest version; review and try again."
          );
          showToast(
            problemToast({
              id: "project-conflict",
              title: "Project changed elsewhere",
              detail:
                "Your command changed nothing. The latest project is loaded for review.",
              now: Date.now(),
              actionLabel: "Review latest"
            }),
            () => {
              setError(undefined);
              setSaveState("saved");
              dismissToast("project-conflict");
            }
          );
        } catch (reloadCause) {
          handleError(reloadCause, "Ghostwriter could not reload the project.");
        }
      } else {
        handleError(cause, "Ghostwriter could not save the change.");
        showToast(
          problemToast({
            id: "project-save-problem",
            title: "Project change not saved",
            detail:
              cause instanceof Error
                ? cause.message
                : "Review the current project and retry the action.",
            now: Date.now(),
            tone: "error",
            dismissible: true
          })
        );
      }
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function undoProjectCommand(
    sourceToastId: string,
    command: ProjectCommand,
    expiresAt: number
  ): Promise<void> {
    const before = selectedProjectRef.current;
    if (before === undefined || Date.now() >= expiresAt) {
      dismissToast(sourceToastId);
      return;
    }
    metadataUndoToastIdRef.current = undefined;
    toastActionsRef.current.delete(sourceToastId);
    setBusy(true);
    setError(undefined);
    setSaveState("saving");
    try {
      const updated = await executeProjectCommand({
        projectId: before.id,
        expectedVersion: before.version,
        command
      });
      setSelectedProject(updated);
      selectedProjectRef.current = updated;
      const sceneIds = projectSceneIds(updated);
      setSelectedSceneId((current) =>
        current !== undefined && sceneIds.includes(current)
          ? current
          : sceneIds[0]
      );
      setSaveState("saved");
      dismissToast(sourceToastId);
      const acknowledgement = acknowledgementForProjectCommand(
        before,
        command,
        updated
      );
      showToast(
        acknowledgementToast({
          id: nextToastId("project-undo"),
          title: acknowledgement.title,
          detail: `${acknowledgement.detail} · Undo complete`,
          now: Date.now()
        })
      );
      if (canvasWorkspace !== undefined) {
        try {
          setCanvasWorkspace(await getCanvasBoard(updated.id));
        } catch {
          setCanvasMessage({
            kind: "error",
            text: "The project Undo was saved, but the Canvas spine needs a refresh."
          });
        }
      }
    } catch (cause) {
      setSaveState("error");
      invalidateMetadataUndo();
      if (
        cause instanceof GhostwriterApiError &&
        cause.code === "VERSION_CONFLICT"
      ) {
        try {
          const latest = await getProject(before.id);
          setSelectedProject(latest);
          selectedProjectRef.current = latest;
        } catch {
          // The original inverse remains discarded; an explicit refresh can retry loading.
        }
        setError(
          "Undo was not applied because the project changed again. Ghostwriter kept the latest acknowledged version."
        );
        showToast(
          problemToast({
            id: "project-conflict",
            title: "Undo could not apply",
            detail:
              "The project changed again. Nothing was reversed; review the latest version.",
            now: Date.now(),
            dismissible: true
          })
        );
      } else {
        handleError(cause, "Ghostwriter could not undo the project change.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function saveProfile(input: {
    displayName: string;
    publishing?: WriterPublishingDetails | null;
    expectedVersion: number;
  }): Promise<void> {
    setBusy(true);
    setError(undefined);
    setProfileSaveState("saving");
    try {
      const result = await updateWriterProfile(input);
      setWriter((current) =>
        current === undefined ? current : { ...current, profile: result.profile }
      );
      setProfileSaveState("saved");
    } catch (cause) {
      setProfileSaveState("error");
      if (
        cause instanceof GhostwriterApiError &&
        cause.code === "VERSION_CONFLICT"
      ) {
        try {
          setWriter(await getCurrentWriter());
          setError(
            "Your profile changed in another tab. Ghostwriter reloaded the latest name; review and save again."
          );
        } catch (reloadCause) {
          handleError(reloadCause, "Ghostwriter could not reload your profile.");
        }
      } else {
        handleError(cause, "Ghostwriter could not update your profile.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function prepareCurrentDraftForExit(): Promise<void> {
    if (draftPanelRef.current !== null) {
      try {
        await draftPanelRef.current.flushAndRelease();
      } catch {
        // Navigation and sign-out must continue when best-effort cleanup fails.
      }
      setDraftActivity("idle");
      return;
    }
    if (selectedProject === undefined || selectedSceneId === undefined) return;
    try {
      await releaseSceneLease({
        projectId: selectedProject.id,
        sceneId: selectedSceneId
      });
    } catch {
      // Lease release is best-effort during navigation and sign-out.
    }
    setDraftActivity("idle");
  }

  async function leaveProject(): Promise<void> {
    setBusy(true);
    setError(undefined);
    await flushCaptureIfOpen();
    resetCaptureInboxShell();
    await prepareCurrentDraftForExit();
    setReaderProjection(undefined);
    setReaderError(undefined);
    setReaderVoiceError(undefined);
    setReaderLoading(false);
    readerReturnStateRef.current = undefined;
    setSelectedSceneId(undefined);
    setSelectedProject(undefined);
    selectedProjectRef.current = undefined;
    setWorkspaceMode("draft");
    setDrillStack(initialDrillStack());
    setWorkflowLens("outline");
    setDraftActivity("idle");
    resetCanvasState();
    clearAcknowledgements();
    setPhase("library");
    setBusy(false);
    void refreshProjects();
  }

  async function loadCanvas(
    projectId: string,
    acknowledgement?: string
  ): Promise<void> {
    setCanvasLoading(true);
    try {
      const [loadedWorkspace, loadedPreference] = await Promise.all([
        getCanvasBoard(projectId),
        getCanvasPreference(projectId)
      ]);
      setCanvasWorkspace(loadedWorkspace);
      setCanvasPreference(loadedPreference);
      setCanvasSaveState("saved");
      setCanvasMessage(undefined);
      dismissToast("canvas-conflict");
      dismissToast("canvas-save-problem");
      if (acknowledgement !== undefined) {
        showToast(
          acknowledgementToast({
            id: nextToastId("canvas-load"),
            title: "Canvas refreshed",
            detail: acknowledgement,
            now: Date.now()
          })
        );
      }
      const preferredObject =
        loadedPreference?.selectedObjectId === undefined
          ? undefined
          : loadedWorkspace.board.objects.find(
              (object) => object.id === loadedPreference.selectedObjectId
            );
      setSelectedCanvasObjectId(preferredObject?.id);
      const preferredSceneId = preferredCanvasSceneId(
        loadedWorkspace.board,
        preferredObject?.id
      );
      if (preferredSceneId !== undefined) setSelectedSceneId(preferredSceneId);
      if (canvasHistory !== undefined) {
        void loadCanvasHistoryForProject(projectId);
      }
    } catch (cause) {
      if (cause instanceof GhostwriterApiError && cause.status === 401) {
        handleError(cause, "Ghostwriter could not load Story Canvas.");
      } else {
        setCanvasSaveState("error");
        setCanvasMessage({
          kind: "error",
          text:
            cause instanceof Error
              ? `Story Canvas could not load: ${cause.message}`
              : "Story Canvas could not load."
        });
        showToast(
          problemToast({
            id: "canvas-save-problem",
            title: "Canvas could not load",
            detail:
              cause instanceof Error
                ? cause.message
                : "Reload the latest Canvas to continue.",
            now: Date.now(),
            tone: "error",
            dismissible: true
          })
        );
      }
    } finally {
      setCanvasLoading(false);
    }
  }

  async function loadCanvasHistoryForProject(projectId: string): Promise<void> {
    setCanvasHistoryLoading(true);
    try {
      setCanvasHistory(await getCanvasHistory(projectId));
    } catch (cause) {
      if (cause instanceof GhostwriterApiError && cause.status === 401) {
        handleError(cause, "Ghostwriter could not load Canvas history.");
      } else {
        setCanvasMessage({
          kind: "error",
          text:
            cause instanceof Error
              ? `Canvas history could not load: ${cause.message}`
              : "Canvas history could not load."
        });
      }
    } finally {
      setCanvasHistoryLoading(false);
    }
  }

  useEffect(() => {
    if (workspaceMode === "split") {
      setWriteComposition("split-map");
      return;
    }
    if (workspaceMode === "canvas") {
      setWriteComposition("page");
      setAssistOpen(false);
      setWriteModality("keyboard");
    }
  }, [workspaceMode]);

  async function changeWorkspaceMode(
    nextMode: ProjectWorkspaceMode
  ): Promise<void> {
    if (nextMode === workspaceMode || selectedProject === undefined) return;
    if (inboxOpen) closeInboxWorkspace();
    const draftIsVisible =
      workspaceMode === "draft" || workspaceMode === "split";
    const draftWillBeVisible = nextMode === "draft" || nextMode === "split";
    if (draftIsVisible && !draftWillBeVisible) {
      setBusy(true);
      await prepareCurrentDraftForExit();
      setBusy(false);
    }
    setWorkspaceMode(nextMode);
    if (
      (nextMode === "canvas" || nextMode === "split") &&
      canvasWorkspace === undefined
    ) {
      void loadCanvas(selectedProject.id);
    }
  }

  async function selectWorkspaceScene(sceneId: SceneId): Promise<void> {
    if (sceneId === selectedSceneId) return;
    if (inboxOpen) closeInboxWorkspace();
    if (workspaceMode === "draft" || workspaceMode === "split") {
      setBusy(true);
      await prepareCurrentDraftForExit();
      setBusy(false);
    }
    setSelectedSceneId(sceneId);
    setSelectedCanvasObjectId(
      canvasWorkspace?.board.objects.find(
        (object) =>
          object.sceneId === sceneId && object.archivedAt === undefined
      )?.id
    );
  }

  function handleDrillBack(): void {
    setDrillStack((stack) => drillBack(stack));
  }

  function handleDrillTo(scope: CanvasDrillScope): void {
    setDrillStack((stack) => drillToScope(stack, scope));
  }

  function handleEnterChapter(
    selection: Extract<ManuscriptSelection, { kind: "chapter" }>
  ): void {
    setDrillStack((stack) =>
      drillIntoChapter(stack, {
        kind: "chapter",
        bookId: selection.bookId,
        partId: selection.partId,
        chapterId: selection.chapterId
      })
    );
    if (workspaceMode !== "canvas" && workspaceMode !== "split") {
      void changeWorkspaceMode("canvas");
    }
  }

  function handleDrillIntoChapter(
    scope: Extract<CanvasDrillScope, { kind: "chapter" }>
  ): void {
    setDrillStack((stack) => drillIntoChapter(stack, scope));
    if (workspaceMode !== "canvas" && workspaceMode !== "split") {
      void changeWorkspaceMode("canvas");
    }
  }

  function handleDrillIntoScene(
    scope: Extract<CanvasDrillScope, { kind: "scene" }>
  ): void {
    setDrillStack((stack) => drillIntoScene(stack, scope));
    void selectWorkspaceScene(scope.sceneId);
    // Scene writing takes the full center; plan-draft keeps Canvas+Draft split.
    if (workflowLens === "plan-draft") {
      void changeWorkspaceMode("split");
      return;
    }
    void changeWorkspaceMode("draft");
  }

  function handleWorkflowLensChange(lens: CanvasWorkflowLens): void {
    setWorkflowLens(lens);
    if (lens === "plan-draft" && selectedSceneId !== undefined) {
      void changeWorkspaceMode("split");
    }
  }

  async function openReader(): Promise<void> {
    if (selectedProject === undefined || selectedSceneId === undefined) return;
    if (inboxOpen) closeInboxWorkspace();
    const bookId = bookIdForScene(selectedProject, selectedSceneId);
    if (bookId === undefined) {
      setReaderError("Choose a scene in a book to open Reader.");
      return;
    }

    readerReturnStateRef.current = {
      workspaceMode,
      selectedSceneId,
      selectedCanvasObjectId,
      drillStack,
      workflowLens
    };
    setReaderError(undefined);
    setReaderVoiceError(undefined);
    setReaderLoading(true);
    try {
      const projection = await getBookReader({
        projectId: selectedProject.id,
        bookId,
        pinSceneId: selectedSceneId
      });
      setReaderProjection(projection);
    } catch (cause) {
      setReaderProjection(undefined);
      setReaderError(
        cause instanceof GhostwriterApiError
          ? cause.message
          : "Ghostwriter could not open Reader."
      );
    } finally {
      setReaderLoading(false);
    }
  }

  function exitReader(): void {
    const restore = readerReturnStateRef.current;
    readerAudioRef.current?.pause();
    readerAudioRef.current = null;
    setReaderSpeaking(false);
    setReaderProjection(undefined);
    setReaderError(undefined);
    setReaderVoiceError(undefined);
    setReaderLoading(false);
    if (restore === undefined) return;
    setWorkspaceMode(restore.workspaceMode);
    setSelectedSceneId(restore.selectedSceneId);
    setSelectedCanvasObjectId(restore.selectedCanvasObjectId);
    setDrillStack(restore.drillStack);
    setWorkflowLens(restore.workflowLens);
    readerReturnStateRef.current = undefined;
  }

  async function speakReaderPassage(
    text: string,
    voicePack: ReaderVoicePack
  ): Promise<void> {
    readerAudioRef.current?.pause();
    readerAudioRef.current = null;
    setReaderSpeaking(true);
    setReaderVoiceError(undefined);
    try {
      const speech = await synthesizeReaderSpeech({ text, voice: voicePack });
      if (typeof Audio === "undefined") {
        setReaderSpeaking(false);
        return;
      }
      const audio = new Audio(
        `data:${speech.mimeType};base64,${speech.audioBase64}`
      );
      readerAudioRef.current = audio;
      audio.onended = () => {
        setReaderSpeaking(false);
        readerAudioRef.current = null;
      };
      await audio.play();
    } catch (cause) {
      setReaderSpeaking(false);
      setReaderVoiceError(
        cause instanceof GhostwriterApiError
          ? cause.message
          : "Ghostwriter could not speak this passage."
      );
    }
  }

  function stopReaderSpeech(): void {
    readerAudioRef.current?.pause();
    readerAudioRef.current = null;
    setReaderSpeaking(false);
  }

  function workspaceChatAttachmentsForApi(
    attachments: WorkspaceChatSendInput["attachments"]
  ): readonly WorkspaceChatAttachment[] | undefined {
    if (attachments === undefined || attachments.length === 0) return undefined;
    return attachments.map(({ kind, name, mimeType, byteLength, dataBase64 }) =>
      Object.freeze({
        kind,
        name,
        mimeType,
        byteLength,
        ...(dataBase64 === undefined ? {} : { dataBase64 })
      })
    );
  }

  function captureDocumentFromBrief(brief: string) {
    const prose = brief.trim().length > 0 ? brief.trim() : "Scene Partner brief";
    return validateSceneDocumentV1({
      schemaVersion: 1,
      document: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { id: blockId(`wp-brief-${Date.now().toString(36)}`) },
            content: [{ type: "text", text: prose }]
          }
        ]
      }
    });
  }

  function handleWorkPlanJobAction(actionId: string): void {
    if (actionId === "review-plans") {
      if (workPlanLastCaptureIdRef.current !== undefined) {
        setInboxSelectedCaptureId(workPlanLastCaptureIdRef.current);
        setPlansAgentDeepLink({
          captureId: workPlanLastCaptureIdRef.current,
          workflowStep: "scene-partner"
        });
      }
      void openInboxWorkspace();
      return;
    }
    if (actionId === "review-project-drafts") {
      setRequestReviewProjectDrafts((current) => current + 1);
      return;
    }
    if (actionId === "review-scene-drafts") {
      const sceneId = workPlanLastSceneIdRef.current ?? selectedSceneId;
      if (sceneId === undefined) {
        appendChatStatusMessage("Open a scene to review its Drafts.");
        return;
      }
      setRequestReviewSceneDraftsSceneId(sceneId);
      setRequestReviewSceneDrafts((current) => current + 1);
    }
  }

  function handleOpenWorkPlanJob(jobId: string): void {
    const job = workPlanJobs.find((entry) => entry.id === jobId);
    const result = job?.result;
    if (result === undefined) return;
    if (result.kind === "plans") {
      const captureId = result.captureId ?? workPlanLastCaptureIdRef.current;
      if (captureId !== undefined) {
        setInboxSelectedCaptureId(captureId);
        setPlansAgentDeepLink({
          captureId,
          workflowStep: "scene-partner"
        });
      }
      void openInboxWorkspace();
      return;
    }
    if (result.kind === "project-draft") {
      setRequestOpenEntityDraftScope("project");
      setRequestOpenEntityDraftSceneId(undefined);
      setRequestOpenEntityDraftProposalId(result.proposalId);
      setRequestOpenEntityDraft((current) => current + 1);
      return;
    }
    if (result.kind === "scene-draft") {
      const sceneId =
        workPlanLastSceneIdRef.current ?? selectedSceneId;
      if (sceneId !== undefined) {
        setRequestOpenEntityDraftScope("scene");
        setRequestOpenEntityDraftSceneId(sceneId);
        setRequestOpenEntityDraftProposalId(result.proposalId);
        setRequestOpenEntityDraft((current) => current + 1);
      }
    }
  }

  async function handleSubmitWorkPlan(plan: WorkPlanV1): Promise<void> {
    if (selectedProject === undefined) {
      appendChatStatusMessage("Open a project before submitting a work plan.");
      return;
    }
    if (workPlanSubmitInFlightRef.current) {
      appendChatStatusMessage("A work plan is already running.");
      return;
    }
    const resolvedPlan = resolveWorkPlanScenes(
      plan,
      projectScenes(selectedProject).map((scene) =>
        Object.freeze({ id: scene.id, title: scene.title })
      ),
      selectedSceneId
    );
    workPlanSubmitInFlightRef.current = true;
    workPlanLastCaptureIdRef.current = undefined;
    workPlanLastSceneIdRef.current =
      resolvedPlan.sceneId !== undefined
        ? toSceneId(resolvedPlan.sceneId)
        : selectedSceneId;
    setWorkPlanJobActions([]);
    setWorkPlanJobSummary(resolvedPlan.summary);
    setWorkPlanJobs(
      resolvedPlan.jobs.map((job) =>
        Object.freeze({
          id: job.id,
          title: job.title,
          status: "queued" as const,
          logLines: Object.freeze(["Queued"])
        })
      )
    );
    setRequestOpenAgentPanel((current) => current + 1);
    let openedPlans = false;
    try {
      await executeWorkPlan({
        projectId: selectedProject.id,
        plan: resolvedPlan,
        onJobUpdate: (jobId, update) => {
          if (update.result?.kind === "plans") openedPlans = true;
          setWorkPlanJobs((current) =>
            current.map((job) => {
              if (job.id !== jobId) return job;
              const priorLogs = job.logLines ?? [];
              const logLines =
                update.logLine === undefined
                  ? priorLogs
                  : Object.freeze([
                      ...priorLogs.filter((line) => line !== update.logLine),
                      update.logLine
                    ]);
              return Object.freeze({
                ...job,
                status: update.status,
                ...(update.detail === undefined ? {} : { detail: update.detail }),
                logLines,
                ...(update.result === undefined
                  ? {}
                  : { result: update.result })
              });
            })
          );
        },
        runCatalogAgent: async (input) => ({
          proposal: await runCatalogAgent({
            projectId: input.projectId,
            agentId: input.agentId,
            model: chatModel,
            effort: chatEffort,
            ...(input.sceneId === undefined ? {} : { sceneId: input.sceneId }),
            ...(input.storyKnowledgeId === undefined
              ? {}
              : { storyKnowledgeId: input.storyKnowledgeId })
          })
        }),
        createStoryKnowledgeDraft: async (input) => ({
          proposal: await createStoryKnowledgeDraft(input)
        }),
        openScenePartner: async (brief, sceneId) => {
          const head = await createCapture({ projectId: selectedProject.id });
          await saveCaptureDocument({
            projectId: selectedProject.id,
            captureId: head.captureId,
            expectedWorkingVersion: head.workingVersion,
            document: captureDocumentFromBrief(brief)
          });
          workPlanLastCaptureIdRef.current = head.captureId;
          setInboxSelectedCaptureId(head.captureId);
          setPlansAgentDeepLink({
            captureId: head.captureId,
            workflowStep: "scene-partner",
            ...(sceneId === undefined ? {} : { craftSceneId: sceneId })
          });
          bumpInboxRefresh();
          return { captureId: head.captureId };
        }
      });
      await loadEntityDrafts();
      setWorkPlanJobActions(
        openedPlans
          ? Object.freeze([
              Object.freeze({ id: "review-plans", label: "Open Plans" })
            ])
          : []
      );
      // Progress/finish live on the job strip — do not mirror into chat.
    } catch (cause) {
      const detail =
        cause instanceof GhostwriterApiError
          ? cause.message
          : cause instanceof Error
            ? cause.message
            : "Work plan could not finish.";
      setWorkPlanJobSummary((current) =>
        current.trim().length > 0 ? `${current} · Failed` : "Work plan failed"
      );
      setWorkPlanJobs((current) =>
        current.map((job) =>
          job.status === "running" || job.status === "queued"
            ? Object.freeze({
                ...job,
                status: "error" as const,
                detail,
                logLines: Object.freeze([
                  ...(job.logLines ?? []),
                  `Failed · ${detail}`
                ])
              })
            : job
        )
      );
    } finally {
      workPlanSubmitInFlightRef.current = false;
    }
  }

  async function handleChatSend(input: WorkspaceChatSendInput): Promise<void> {
    let messagesForTurn = [...(input.baseMessages ?? chatMessages)];
    if (input.resendFromMessageId !== undefined) {
      messagesForTurn = [
        ...truncateMessagesBeforeUserMessage(
          messagesForTurn,
          input.resendFromMessageId
        )
      ];
      replaceActiveChatMessages(() => messagesForTurn);
    }

    if (isWorkPlanSubmitIntent(input.message)) {
      const userMessageId =
        input.existingUserMessageId ?? `chat-user-${Date.now()}`;
      if (input.existingUserMessageId === undefined) {
        appendActiveChatMessage({
          id: userMessageId,
          role: "user",
          body: input.message
        });
        messagesForTurn = [
          ...messagesForTurn,
          { id: userMessageId, role: "user", body: input.message }
        ];
      }
      const plan = latestWorkPlanFromMessages(messagesForTurn);
      if (plan === undefined) {
        appendChatStatusMessage(
          "No work plan to submit. Ask for a multi-step plan first."
        );
        return;
      }
      await handleSubmitWorkPlan(plan);
      return;
    }

    chatAbortRef.current?.abort();
    const abortController = new AbortController();
    chatAbortRef.current = abortController;
    setChatStreaming(true);

    const priorTurns =
      input.priorTurns ??
      collectWorkspaceChatPriorTurns(
        input.existingUserMessageId === undefined
          ? messagesForTurn
          : truncateMessagesBeforeUserMessage(
              messagesForTurn,
              input.existingUserMessageId
            )
      );

    const userMessageId =
      input.existingUserMessageId ?? `chat-user-${Date.now()}`;
    if (input.existingUserMessageId === undefined) {
      const userMessage: WorkspaceChatMessage = {
        id: userMessageId,
        role: "user",
        body: input.message
      };
      appendActiveChatMessage(userMessage);
      messagesForTurn = [...messagesForTurn, userMessage];
    }

    const selection =
      selectedProject === undefined || selectedSceneId === undefined
        ? undefined
        : sceneSelection(selectedProject, selectedSceneId);
    const chatAttachments = workspaceChatAttachmentsForApi(input.attachments);
    const chatRequest = {
      message: input.message,
      projectId: selectedProject?.id,
      mode: input.mode,
      model: input.model,
      effort: input.effort,
      ...(priorTurns.length === 0 ? {} : { priorTurns }),
      ...(chatAttachments === undefined ? {} : { attachments: chatAttachments }),
      ...(selection === undefined
        ? {}
        : {
            selection: {
              kind: selection.kind,
              ...("bookId" in selection ? { bookId: selection.bookId } : {}),
              ...("partId" in selection && selection.partId !== undefined
                ? { partId: selection.partId }
                : {}),
              ...("chapterId" in selection && selection.chapterId !== undefined
                ? { chapterId: selection.chapterId }
                : {}),
              ...("sceneId" in selection ? { sceneId: selection.sceneId } : {}),
              ...("storyKnowledgeId" in selection
                ? { storyKnowledgeId: selection.storyKnowledgeId }
                : {})
            }
          })
    } as const;
    const assistantId = `chat-assistant-${Date.now()}`;
    appendActiveChatMessage({
      id: assistantId,
      role: "assistant",
      body: "",
      streaming: true,
      statusLabel: "Thinking…",
      toolTraces: []
    });

    const finalizeAssistant = (update: Partial<WorkspaceChatMessage>): void => {
      replaceActiveChatMessages((current) =>
        current.map((message) =>
          message.id === assistantId
            ? { ...message, ...update, streaming: false }
            : message
        )
      );
    };

    let partialBody = "";

    try {
      const result = await sendWorkspaceChatStream(
        chatRequest,
        {
          onStatus: (_phase, label) => {
            replaceActiveChatMessages((current) =>
              current.map((message) =>
                message.id === assistantId
                  ? { ...message, statusLabel: label }
                  : message
              )
            );
          },
          onToolTrace: (trace) => {
            replaceActiveChatMessages((current) =>
              current.map((message) =>
                message.id === assistantId
                  ? {
                      ...message,
                      toolTraces: [...(message.toolTraces ?? []), trace]
                    }
                  : message
              )
            );
          },
          onTextDelta: (delta) => {
            partialBody += delta;
            replaceActiveChatMessages((current) =>
              current.map((message) =>
                message.id === assistantId
                  ? {
                      ...message,
                      body: `${message.body}${delta}`,
                      statusLabel: "Writing…"
                    }
                  : message
              )
            );
          }
        },
        abortController.signal
      );
      finalizeAssistant({
        body: result.reply,
        ...(result.toolTraces === undefined || result.toolTraces.length === 0
          ? {}
          : { toolTraces: result.toolTraces }),
        ...(result.workPlan === undefined ? {} : { workPlan: result.workPlan }),
        statusLabel: undefined
      });
    } catch (cause) {
      if (
        abortController.signal.aborted ||
        (cause instanceof DOMException && cause.name === "AbortError")
      ) {
        finalizeAssistant({
          body:
            partialBody.trim().length > 0 ? partialBody.trim() : "Stopped.",
          statusLabel: undefined
        });
        return;
      }
      const canFallbackToJson =
        cause instanceof GhostwriterApiError &&
        (cause.status === 404 ||
          cause.code === "STREAM_UNAVAILABLE" ||
          cause.code === "REQUEST_FAILED");
      if (canFallbackToJson) {
        try {
          const result = await sendWorkspaceChat(chatRequest);
          finalizeAssistant({
            body: result.reply,
            ...(result.toolTraces === undefined || result.toolTraces.length === 0
              ? {}
              : { toolTraces: result.toolTraces }),
            ...(result.workPlan === undefined
              ? {}
              : { workPlan: result.workPlan }),
            statusLabel: undefined
          });
          return;
        } catch {
          // fall through to system error
        }
      }
      replaceActiveChatMessages((current) =>
        current
          .filter((message) => message.id !== assistantId)
          .concat({
            id: `chat-system-${Date.now()}`,
            role: "system",
            body:
              cause instanceof GhostwriterApiError
                ? cause.message
                : "Chat could not complete that turn.",
            retryable: true
          })
      );
    } finally {
      setChatStreaming(false);
      if (chatAbortRef.current === abortController) {
        chatAbortRef.current = undefined;
      }
    }
  }

  function handleChatStop(): void {
    chatAbortRef.current?.abort();
  }

  function handleForkChatMessage(messageId: string): void {
    setChatSessionsState((current) => {
      const next = forkWorkspaceChatSession(
        current,
        current.activeSessionId,
        messageId,
        { mode: chatMode, model: chatModel, effort: chatEffort }
      );
      if (next === null) return current;
      persistChatSessions(next);
      const session = next.sessions.find(
        (entry) => entry.id === next.activeSessionId
      );
      if (session !== undefined) {
        setChatMode(session.mode ?? chatMode);
        setChatModel(session.model ?? chatModel);
        setChatEffort(session.effort ?? chatEffort);
      }
      return next;
    });
  }

  function handleRegenerateChatMessage(messageId: string): void {
    const active = activeWorkspaceChatSession(chatSessionsState);
    if (active === undefined) return;
    const message = active.messages.find((entry) => entry.id === messageId);
    if (message?.role !== "assistant") return;
    const truncated = removeLastAssistantTurn(active.messages);
    const lastUser = findLastUserMessage(truncated);
    if (lastUser === undefined) return;
    replaceActiveChatMessages(() => [...truncated]);
    void handleChatSend({
      message: lastUser.body,
      mode: chatMode,
      model: chatModel,
      effort: chatEffort,
      existingUserMessageId: lastUser.id,
      baseMessages: truncated,
      priorTurns: collectWorkspaceChatPriorTurns(
        truncateMessagesBeforeUserMessage(truncated, lastUser.id)
      )
    });
  }

  function handleRetryChatTurn(): void {
    const lastUser = findLastUserMessage(chatMessages);
    if (lastUser === undefined) return;
    const withoutSystem = chatMessages.filter(
      (message) => message.role !== "system"
    );
    replaceActiveChatMessages(() => withoutSystem);
    void handleChatSend({
      message: lastUser.body,
      mode: chatMode,
      model: chatModel,
      effort: chatEffort,
      existingUserMessageId: lastUser.id,
      baseMessages: withoutSystem,
      priorTurns: collectWorkspaceChatPriorTurns(
        truncateMessagesBeforeUserMessage(withoutSystem, lastUser.id)
      )
    });
  }

  async function handleOpenChatScene(sceneId?: SceneId | string): Promise<void> {
    const targetSceneId =
      sceneId !== undefined ? toSceneId(sceneId) : selectedSceneId;
    if (targetSceneId === undefined) return;
    if (inboxOpen) closeInboxWorkspace();
    // selectWorkspaceScene early-returns when already selected — still must
    // enter Draft so "Open scene" is never a silent no-op.
    await selectWorkspaceScene(targetSceneId);
    const targetMode = workflowLens === "plan-draft" ? "split" : "draft";
    if (workspaceMode !== targetMode) {
      await changeWorkspaceMode(targetMode);
    }
    setWriteComposition("page");
    setRequestFocusDraftScene((current) => current + 1);
  }

  function appendChatStatusMessage(body: string): void {
    appendActiveChatMessage({
      id: `chat-system-${Date.now()}`,
      role: "system",
      body
    });
  }

  const planOutlineText = useMemo(() => {
    if (chatMode !== "plan") return undefined;
    for (let index = chatMessages.length - 1; index >= 0; index -= 1) {
      const message = chatMessages[index];
      if (message?.role === "assistant") {
        return message.body;
      }
    }
    return undefined;
  }, [chatMessages, chatMode]);

  async function handleSavePlanToPlans(outlineText: string): Promise<void> {
    if (selectedProject === undefined) return;
    try {
      const result = await persistPlanOutline({
        projectId: selectedProject.id,
        outlineText,
        model: chatModel
      });
      appendChatStatusMessage("Saved to Plans.");
      setInboxSelectedCaptureId(result.captureId);
      setPlansAgentDeepLink({
        captureId: result.captureId,
        proposalId: result.proposalId,
        highlight: "plan-outline",
        workflowStep: "plan-outline"
      });
      bumpInboxRefresh();
      void openInboxWorkspace();
    } catch (cause) {
      appendChatStatusMessage(
        cause instanceof GhostwriterApiError
          ? cause.message
          : "Ghostwriter could not save that outline to Plans."
      );
    }
  }

  function handleAgentToolkitAction(
    id: AgentToolkitId,
    toolkitSelection: Parameters<typeof resolveAgentToolkitAction>[1]
  ): void {
    const result = resolveAgentToolkitAction(id, toolkitSelection);
    if (!result.ok) {
      appendChatStatusMessage(result.refusalMessage);
      return;
    }
    if (result.kind === "cover") {
      setCoverReviewBookId(result.bookId);
      appendChatStatusMessage(result.statusMessage);
      return;
    }
    if (result.deepLink.captureId !== undefined) {
      setInboxSelectedCaptureId(result.deepLink.captureId);
    }
    setPlansAgentDeepLink(result.deepLink);
    void openInboxWorkspace();
    appendChatStatusMessage(result.statusMessage);
  }

  async function handleCatalogAgentRun(
    agentId: CatalogAgentId,
    toolkitSelection: Parameters<typeof resolveAgentToolkitAction>[1],
    lens?: CatalogMemoLens
  ): Promise<void> {
    if (selectedProject === undefined) return;
    try {
      const proposal = await runCatalogAgent({
        projectId: selectedProject.id,
        agentId,
        model: chatModel,
        effort: chatEffort,
        ...(lens === undefined ? {} : { lens }),
        ...(toolkitSelection.sceneId === undefined
          ? {}
          : { sceneId: toolkitSelection.sceneId }),
        ...(toolkitSelection.storyKnowledgeId === undefined
          ? {}
          : { storyKnowledgeId: toolkitSelection.storyKnowledgeId }),
        ...(toolkitSelection.bookId === undefined
          ? {}
          : { bookId: toolkitSelection.bookId })
      });
      appendChatStatusMessage(
        proposal.primaryTarget.kind === "scene"
          ? "Draft ready on Scene."
          : proposal.primaryTarget.kind === "story-knowledge"
            ? "Draft ready on Cast."
            : "Draft ready on Project."
      );
      await loadEntityDrafts();
    } catch (cause) {
      appendChatStatusMessage(
        cause instanceof GhostwriterApiError
          ? cause.message
          : "Ghostwriter could not run that catalog agent."
      );
    }
  }

  const loadEntityDrafts = useCallback(async () => {
    if (selectedProject === undefined || entityDraftTarget === undefined) {
      setEntityDrafts([]);
      setEntityDraftDetailTitles({});
      return;
    }
    setEntityDraftsLoading(true);
    try {
      const proposals = await listAgentProposals(selectedProject.id, {
        targetKind: entityDraftTarget.targetKind,
        targetId: entityDraftTarget.targetId,
        status: "ready"
      });
      setEntityDrafts(proposals.map(mapProposalSummaryToEntityDraft));
    } catch {
      setEntityDrafts([]);
    } finally {
      setEntityDraftsLoading(false);
    }
  }, [entityDraftTarget, selectedProject]);

  useEffect(() => {
    setEntityDraftExpandedId(undefined);
    setEntityDraftExpandedBody(undefined);
    void loadEntityDrafts();
  }, [loadEntityDrafts]);

  useEffect(() => {
    if (requestOpenEntityDraft < 1) return;
    const proposalId = requestOpenEntityDraftProposalId;
    const scope = requestOpenEntityDraftScope;
    if (proposalId === undefined || scope === undefined) return;
    const targetReady =
      scope === "project"
        ? entityDraftTarget?.targetKind === "project"
        : entityDraftTarget?.targetKind === "scene" &&
          entityDraftTarget.targetId === requestOpenEntityDraftSceneId;
    if (!targetReady) return;
    setPendingEntityDraftProposalId(proposalId);
  }, [
    requestOpenEntityDraft,
    requestOpenEntityDraftProposalId,
    requestOpenEntityDraftScope,
    requestOpenEntityDraftSceneId,
    entityDraftTarget
  ]);

  useEffect(() => {
    if (pendingEntityDraftProposalId === undefined) return;
    if (entityDraftsLoading) return;
    void handleSelectEntityDraft(pendingEntityDraftProposalId);
    setPendingEntityDraftProposalId(undefined);
  }, [
    pendingEntityDraftProposalId,
    entityDrafts,
    entityDraftsLoading
  ]);

  async function handleRejectEntityDraft(proposalId: string): Promise<void> {
    if (selectedProject === undefined) return;
    setEntityDraftMutatingProposalId(proposalId);
    try {
      await rejectAgentProposal({
        projectId: selectedProject.id,
        proposalId
      });
      if (entityDraftExpandedId === proposalId) {
        setEntityDraftExpandedId(undefined);
        setEntityDraftExpandedBody(undefined);
      }
      await loadEntityDrafts();
    } catch (cause) {
      appendChatStatusMessage(
        cause instanceof GhostwriterApiError
          ? cause.message
          : "Ghostwriter could not reject that draft."
      );
    } finally {
      setEntityDraftMutatingProposalId(undefined);
    }
  }

  async function handleAcknowledgeEntityDraft(
    proposalId: string
  ): Promise<void> {
    if (selectedProject === undefined) return;
    setEntityDraftMutatingProposalId(proposalId);
    try {
      await acknowledgeAgentProposal({
        projectId: selectedProject.id,
        proposalId
      });
      if (entityDraftExpandedId === proposalId) {
        setEntityDraftExpandedId(undefined);
        setEntityDraftExpandedBody(undefined);
      }
      await loadEntityDrafts();
    } catch (cause) {
      appendChatStatusMessage(
        cause instanceof GhostwriterApiError
          ? cause.message
          : "Ghostwriter could not acknowledge that draft."
      );
    } finally {
      setEntityDraftMutatingProposalId(undefined);
    }
  }

  async function handleSelectEntityDraft(proposalId: string): Promise<void> {
    if (selectedProject === undefined) return;

    let draft = entityDrafts.find((candidate) => candidate.id === proposalId);
    if (draft === undefined) {
      try {
        const proposal = await getAgentProposal({
          projectId: selectedProject.id,
          proposalId
        });
        draft = entityDraftSummaryFromProposalDetail(proposal);
        setEntityDrafts((current) =>
          current.some((entry) => entry.id === proposalId)
            ? current
            : Object.freeze([...current, draft!])
        );
      } catch {
        appendChatStatusMessage("Could not open that draft.");
        return;
      }
    }

    if (entityDraftPrimaryAction(draft) === "open-in-plans") {
      if (draft.baseCaptureId !== undefined) {
        setInboxSelectedCaptureId(draft.baseCaptureId);
      }
      setPlansAgentDeepLink(buildEntityDraftPlansDeepLink(draft));
      void openInboxWorkspace();
      return;
    }

    if (entityDraftExpandedId === proposalId) {
      setEntityDraftExpandedId(undefined);
      setEntityDraftExpandedBody(undefined);
      return;
    }

    setEntityDraftExpandedId(proposalId);
    setEntityDraftExpandedBody(undefined);
    setEntityDraftExpandedLoading(true);
    try {
      const proposal = await getAgentProposal({
        projectId: selectedProject.id,
        proposalId
      });
      const title = entityDraftDetailTitle(
        proposal.outputSchemaId,
        proposal.payload
      );
      if (title !== undefined) {
        setEntityDraftDetailTitles((current) =>
          Object.freeze({ ...current, [proposalId]: title })
        );
      }
      setEntityDraftExpandedBody(
        formatEntityDraftDetailBody(proposal.outputSchemaId, proposal.payload)
      );
    } catch {
      setEntityDraftExpandedBody("Could not load this draft.");
    } finally {
      setEntityDraftExpandedLoading(false);
    }
  }

  async function handleCanvasFailure(cause: unknown): Promise<void> {
    if (cause instanceof GhostwriterApiError && cause.status === 401) {
      handleError(cause, "Ghostwriter could not save Story Canvas.");
      return;
    }
    const code =
      cause instanceof GhostwriterApiError ? cause.code : undefined;
    const disposition = canvasFailureDisposition(code);
    if (
      disposition !== "preserve-board" &&
      selectedProject !== undefined
    ) {
      invalidateCanvasUndo();
      try {
        const [latestCanvas, latestProject] = await Promise.all([
          getCanvasBoard(selectedProject.id),
          disposition === "reload-project-and-board"
            ? getProject(selectedProject.id)
            : Promise.resolve(undefined)
        ]);
        setCanvasWorkspace(latestCanvas);
        if (latestProject !== undefined) {
          setSelectedProject(latestProject);
          selectedProjectRef.current = latestProject;
          const sceneIds = projectSceneIds(latestProject);
          setSelectedSceneId((current) =>
            current !== undefined && sceneIds.includes(current)
              ? current
              : sceneIds[0]
          );
        }
        const selectedStillExists =
          selectedCanvasObjectId !== undefined &&
          latestCanvas.board.objects.some(
            (object) => object.id === selectedCanvasObjectId
          );
        if (!selectedStillExists) setSelectedCanvasObjectId(undefined);
        setCanvasSaveState("conflict");
        const conflictText =
          disposition === "reload-project-and-board"
            ? "The manuscript changed before this Canvas scene handoff. Ghostwriter created nothing, reloaded both latest views, and left them ready for review."
            : "Story Canvas changed in another request. Ghostwriter applied nothing, reloaded the latest board, and kept the new version ready for review.";
        // Map notifications live in History — do not duplicate as banner + toast.
        setCanvasMessage(undefined);
        setRecentCanvasActions((current) =>
          pushRecentCanvasAction(current, {
            id: nextToastId("canvas-conflict"),
            title:
              disposition === "reload-project-and-board"
                ? "Manuscript changed during handoff"
                : "Canvas changed elsewhere",
            detail: conflictText,
            createdAt: Date.now(),
            canUndo: false,
            tone: "warning",
            actionLabel: "Reload Canvas",
            actionKind: "reload-canvas"
          })
        );
        return;
      } catch (reloadCause) {
        setCanvasSaveState("error");
        setCanvasMessage(undefined);
        setRecentCanvasActions((current) =>
          pushRecentCanvasAction(current, {
            id: nextToastId("canvas-save-problem"),
            title: "Canvas conflict needs review",
            detail:
              reloadCause instanceof Error
                ? reloadCause.message
                : "The latest Canvas could not reload.",
            createdAt: Date.now(),
            canUndo: false,
            tone: "error",
            actionLabel: "Reload Canvas",
            actionKind: "reload-canvas"
          })
        );
        return;
      }
    }
    setCanvasSaveState("error");
    setCanvasMessage(undefined);
    setRecentCanvasActions((current) =>
      pushRecentCanvasAction(current, {
        id: nextToastId("canvas-save-problem"),
        title: "Canvas change not saved",
        detail:
          cause instanceof Error
            ? cause.message
            : "Review the current board and retry.",
        createdAt: Date.now(),
        canUndo: false,
        tone: "error",
        actionLabel: "Reload Canvas",
        actionKind: "reload-canvas"
      })
    );
  }

  async function runCanvasCommand(command: CanvasCommand): Promise<boolean> {
    if (selectedProject === undefined || canvasWorkspace === undefined) {
      return false;
    }
    const previousObjectIds = new Set(
      canvasWorkspace.board.objects.map((object) => object.id)
    );
    setCanvasBusy(true);
    setCanvasSaveState("saving");
    setCanvasMessage(undefined);
    try {
      const updated = await executeCanvasCommand({
        projectId: selectedProject.id,
        expectedCanvasVersion: canvasWorkspace.board.version,
        command
      });
      setCanvasWorkspace(updated);
      setCanvasSaveState("saved");
      dismissToast("canvas-conflict");
      dismissToast("canvas-save-problem");
      const acknowledgement = acknowledgementForCanvasCommand(command);
      invalidateCanvasUndo();
      const now = Date.now();
      const id = nextToastId("canvas");
      const canUndo = acknowledgement.actionLabel === "Undo";
      setRecentCanvasActions((current) =>
        pushRecentCanvasAction(current, {
          id,
          title: acknowledgement.title,
          detail: acknowledgement.detail,
          createdAt: now,
          canUndo
        })
      );
      if (canUndo) {
        canvasUndoToastIdRef.current = id;
        canvasUndoActionRef.current = () => {
          void undoLatestCanvasCommand(id);
        };
      } else {
        canvasUndoToastIdRef.current = undefined;
        canvasUndoActionRef.current = undefined;
      }
      if (canvasHistory !== undefined) {
        void loadCanvasHistoryForProject(selectedProject.id);
      }
      if (
        command.type === "canvas.object.create" ||
        command.type === "canvas.object.place"
      ) {
        const created = updated.board.objects.find(
          (object) => !previousObjectIds.has(object.id)
        );
        if (created !== undefined) {
          setSelectedCanvasObjectId(created.id);
          if (created.sceneId !== undefined) setSelectedSceneId(created.sceneId);
        }
      }
      return true;
    } catch (cause) {
      await handleCanvasFailure(cause);
      return false;
    } finally {
      setCanvasBusy(false);
    }
  }

  async function undoLatestCanvasCommand(sourceToastId?: string): Promise<void> {
    if (selectedProject === undefined || canvasWorkspace === undefined) return;
    setCanvasBusy(true);
    setCanvasSaveState("saving");
    setCanvasMessage(undefined);
    try {
      const updated = await undoCanvas({
        projectId: selectedProject.id,
        expectedCanvasVersion: canvasWorkspace.board.version
      });
      setCanvasWorkspace(updated);
      setCanvasSaveState("saved");
      invalidateCanvasUndo();
      if (sourceToastId !== undefined) dismissToast(sourceToastId);
      canvasUndoToastIdRef.current = undefined;
      canvasUndoActionRef.current = undefined;
      const undoNow = Date.now();
      const undoId = nextToastId("canvas-undo");
      setRecentCanvasActions((current) =>
        pushRecentCanvasAction(current, {
          id: undoId,
          title: "Canvas action undone",
          detail:
            "Draft prose and canonical manuscript order were unchanged.",
          createdAt: undoNow,
          canUndo: false
        })
      );
      if (canvasHistory !== undefined) {
        void loadCanvasHistoryForProject(selectedProject.id);
      }
      setCanvasMessage(undefined);
      if (
        selectedCanvasObjectId !== undefined &&
        !updated.board.objects.some(
          (object) => object.id === selectedCanvasObjectId
        )
      ) {
        setSelectedCanvasObjectId(undefined);
      }
    } catch (cause) {
      await handleCanvasFailure(cause);
    } finally {
      setCanvasBusy(false);
    }
  }

  async function restoreCanvasSnapshot(
    revisionId: CanvasRevisionId
  ): Promise<boolean> {
    if (selectedProject === undefined || canvasWorkspace === undefined) {
      return false;
    }
    setCanvasBusy(true);
    setCanvasSaveState("saving");
    setCanvasMessage(undefined);
    let restored: CanvasWorkspaceResponse | undefined;
    try {
      restored = await restoreCanvasRevision({
        projectId: selectedProject.id,
        expectedCanvasVersion: canvasWorkspace.board.version,
        revisionId
      });
      const [reloaded, updatedHistory] = await Promise.all([
        getCanvasBoard(selectedProject.id),
        getCanvasHistory(selectedProject.id)
      ]);
      setCanvasWorkspace(reloaded);
      setCanvasHistory(updatedHistory);
      setCanvasSaveState("saved");
      setCanvasMessage(undefined);
      invalidateCanvasUndo();
      const now = Date.now();
      const id = nextToastId("canvas-restore");
      setRecentCanvasActions((current) =>
        pushRecentCanvasAction(current, {
          id,
          title: "Canvas snapshot restored",
          detail:
            "The earlier board is current. Draft prose and manuscript order were unchanged.",
          createdAt: now,
          canUndo: true
        })
      );
      canvasUndoToastIdRef.current = id;
      canvasUndoActionRef.current = () => {
        void undoLatestCanvasCommand(id);
      };
      if (
        selectedCanvasObjectId !== undefined &&
        !reloaded.board.objects.some(
          (object) => object.id === selectedCanvasObjectId
        )
      ) {
        setSelectedCanvasObjectId(undefined);
      }
      return true;
    } catch (cause) {
      if (restored !== undefined) {
        setCanvasWorkspace(restored);
        setCanvasSaveState("error");
        setCanvasMessage({
          kind: "error",
          text:
            cause instanceof Error
              ? `The Canvas snapshot was restored, but the acknowledged board could not reload: ${cause.message}`
              : "The Canvas snapshot was restored, but the acknowledged board could not reload."
        });
        return true;
      }
      await handleCanvasFailure(cause);
      return false;
    } finally {
      setCanvasBusy(false);
    }
  }

  async function persistCanvasPreference(input: {
    x: number;
    y: number;
    zoom: number;
    selectedObjectId?: CanvasObjectId | null;
  }): Promise<void> {
    if (selectedProject === undefined) return;
    if (input.selectedObjectId !== undefined) {
      setSelectedCanvasObjectId(input.selectedObjectId ?? undefined);
    }
    const saveGen = ++canvasPreferenceSaveGenRef.current;
    try {
      const saved = await saveCanvasPreference({
        projectId: selectedProject.id,
        ...input
      });
      // Ignore out-of-order preference responses so a slow save cannot
      // overwrite a newer pan/zoom the writer already made.
      if (saveGen !== canvasPreferenceSaveGenRef.current) return;
      setCanvasPreference(saved);
    } catch (cause) {
      if (saveGen !== canvasPreferenceSaveGenRef.current) return;
      setCanvasMessage({
        kind: "error",
        text:
          cause instanceof Error
            ? `Canvas content is safe, but this personal view was not saved: ${cause.message}`
            : "Canvas content is safe, but this personal view was not saved."
      });
    }
  }

  async function createStoryboardScene(input: {
    title: string;
    manuscriptPlacement: CanvasScenePlacementInput;
    canvas: CanvasSceneGeometryInput;
  }): Promise<SceneId | undefined> {
    if (selectedProject === undefined || canvasWorkspace === undefined) {
      return undefined;
    }
    setCanvasBusy(true);
    setCanvasSaveState("saving");
    setCanvasMessage(undefined);
    try {
      const result = await createSceneFromCanvas({
        projectId: selectedProject.id,
        expectedProjectVersion: selectedProject.version,
        expectedCanvasVersion: canvasWorkspace.board.version,
        ...input
      });
      if (workspaceMode === "split") {
        await prepareCurrentDraftForExit();
      }
      setSelectedProject(result.navigator);
      selectedProjectRef.current = result.navigator;
      setCanvasWorkspace(result.canvas);
      setSelectedSceneId(result.scene.id);
      setSelectedCanvasObjectId(
        result.canvas.board.objects.find(
          (object) => object.sceneId === result.scene.id
        )?.id
      );
      setCanvasSaveState("saved");
      setCanvasMessage(undefined);
      invalidateMetadataUndo();
      invalidateCanvasUndo();
      setRecentCanvasActions((current) =>
        pushRecentCanvasAction(current, {
          id: nextToastId("canvas-scene"),
          title: "Scene created in Canvas and Draft",
          detail: `${result.scene.title} · One acknowledged transaction`,
          createdAt: Date.now(),
          canUndo: false
        })
      );
      return result.scene.id;
    } catch (cause) {
      await handleCanvasFailure(cause);
      return undefined;
    } finally {
      setCanvasBusy(false);
    }
  }

  function clearSceneSaveNextActionInviteTimer(): void {
    if (nextActionIdleTimerRef.current !== undefined) {
      clearTimeout(nextActionIdleTimerRef.current);
      nextActionIdleTimerRef.current = undefined;
    }
  }

  function sceneTitleForNextAction(sceneId: SceneId): string | undefined {
    if (selectedProject === undefined) return undefined;
    return projectScenes(selectedProject).find((scene) => scene.id === sceneId)
      ?.title;
  }

  function activeChatHasOpenNextActionMessage(): boolean {
    return (
      nextActionOpenRef.current ||
      nextActionInFlightRef.current ||
      activeWorkspaceChatMessages(chatSessionsState).some(
        (message) =>
          message.nextActionSceneId !== undefined &&
          message.actionChips !== undefined &&
          message.actionChips.length > 0
      )
    );
  }

  function msSinceLastNextActionSuggestion(now = Date.now()): number | undefined {
    const last = nextActionLastPostedAtRef.current;
    if (last === undefined) return undefined;
    return now - last;
  }

  function appendSceneNextActionInviteMessage(
    sceneId: SceneId,
    revision: number
  ): void {
    setRequestOpenAgentPanel((current) => current + 1);
    nextActionLastPostedAtRef.current = Date.now();
    nextActionOpenRef.current = true;
    appendActiveChatMessage({
      id: `next-action-invite-${sceneId}-${revision}`,
      role: "assistant",
      body: SCENE_SAVE_NEXT_ACTION_INVITE_PROMPT,
      nextActionSceneId: sceneId,
      nextActionRevision: revision,
      actionChips: SCENE_SAVE_NEXT_ACTION_INVITE_CHIPS
    });
  }

  async function runAndAppendNextActionCoach(input: Readonly<{
    sceneId: SceneId;
    revision?: number;
    trigger: "scene-prose-saved" | "manual-start";
    statusLabel: string;
  }>): Promise<void> {
    if (selectedProject === undefined) return;
    if (nextActionInFlightRef.current) return;
    nextActionInFlightRef.current = true;
    setNextActionCoachBusy(true);
    setRequestOpenAgentPanel((current) => current + 1);
    const workingId = `next-action-working-${input.sceneId}-${Date.now()}`;
    appendActiveChatMessage({
      id: workingId,
      role: "assistant",
      body: "Looking at this scene for next steps…",
      statusLabel: input.statusLabel,
      streaming: true,
      nextActionSceneId: input.sceneId,
      ...(input.revision === undefined
        ? {}
        : { nextActionRevision: input.revision })
    });
    try {
      const result = await runNextActionCoach({
        projectId: selectedProject.id,
        sceneId: input.sceneId,
        model: NEXT_ACTION_COACH_DEFAULT_MODEL,
        trigger: input.trigger
      });
      nextActionLastPostedAtRef.current = Date.now();
      nextActionOpenRef.current = true;
      const attachedPlan = workPlanFromNextActionV1(
        result.payload,
        input.sceneId
      );
      replaceActiveChatMessages((messages) =>
        messages.map((message) =>
          message.id === workingId
            ? {
                id: `next-action-result-${input.sceneId}-${Date.now()}`,
                role: "assistant" as const,
                body: formatNextActionCoachMessage(
                  result.payload,
                  sceneTitleForNextAction(input.sceneId)
                ),
                nextActionSceneId: input.sceneId,
                ...(input.revision === undefined
                  ? {}
                  : { nextActionRevision: input.revision }),
                actionChips: chipsFromNextActionV1(result.payload),
                ...(attachedPlan === undefined
                  ? {}
                  : { workPlan: attachedPlan }),
                statusLabel: input.statusLabel
              }
            : message
        )
      );
      void loadEntityDrafts();
    } catch (cause) {
      replaceActiveChatMessages((messages) =>
        messages.map((message) =>
          message.id === workingId
            ? {
                ...message,
                streaming: false,
                body:
                  cause instanceof GhostwriterApiError
                    ? `Could not suggest next steps: ${cause.message} (${cause.status}${cause.code ? ` · ${cause.code}` : ""})`
                    : cause instanceof Error
                      ? `Could not suggest next steps: ${cause.message}`
                      : "Could not suggest next steps right now.",
                actionChips: undefined,
                statusLabel: input.statusLabel
              }
            : message
        )
      );
    } finally {
      nextActionInFlightRef.current = false;
      setNextActionCoachBusy(false);
    }
  }

  function evaluateSceneSaveNextActionInvite(
    sceneId: SceneId,
    revision: number
  ): void {
    const dismissKey = sceneSaveNextActionDismissKey(sceneId, revision);
    const autoOn = autoSuggestionsEnabledRef.current;
    const delayMs = nextActionScheduleDelayMs(autoOn);
    const result = shouldOfferSceneSaveInvitation({
      autoSuggestionsEnabled: autoOn,
      dismissedForRevision:
        nextActionDismissedRevisionsRef.current.has(dismissKey),
      hasOpenNextActionMessage: activeChatHasOpenNextActionMessage(),
      hasReadyNextActionProposal: false,
      saveAcknowledged: true,
      idleElapsedMs: delayMs,
      ...(msSinceLastNextActionSuggestion() === undefined
        ? {}
        : { msSinceLastSuggestion: msSinceLastNextActionSuggestion() })
    });
    if (result.mayRunAmbientCoach) {
      void runAndAppendNextActionCoach({
        sceneId,
        revision,
        trigger: "scene-prose-saved",
        statusLabel: "Auto suggestions"
      });
      return;
    }
    if (result.showLocalInvite) {
      appendSceneNextActionInviteMessage(sceneId, revision);
    }
  }

  function scheduleSceneSaveNextActionInvite(
    sceneId: SceneId,
    revision: number
  ): void {
    // Reset debounce on each save ack so bursts collapse to one evaluation.
    clearSceneSaveNextActionInviteTimer();
    nextActionPendingSaveRef.current = { sceneId, revision };
    const delayMs = nextActionScheduleDelayMs(
      autoSuggestionsEnabledRef.current
    );
    nextActionIdleTimerRef.current = setTimeout(() => {
      nextActionIdleTimerRef.current = undefined;
      const pending = nextActionPendingSaveRef.current;
      if (pending === undefined) return;
      if (pending.sceneId !== sceneId || pending.revision !== revision) return;
      evaluateSceneSaveNextActionInvite(sceneId, revision);
    }, delayMs);
  }

  function dismissNextActionFor(
    sceneId: SceneId | undefined,
    revision: number | undefined,
    messageId: string
  ): void {
    if (sceneId !== undefined && revision !== undefined) {
      nextActionDismissedRevisionsRef.current.add(
        sceneSaveNextActionDismissKey(sceneId, revision)
      );
    }
    // Cooldown starts from dismiss too so Auto cannot immediately re-fire.
    nextActionLastPostedAtRef.current = Date.now();
    nextActionOpenRef.current = false;
    replaceActiveChatMessages((messages) =>
      messages.map((message) =>
        message.id === messageId
          ? { ...message, actionChips: undefined, nextActionSceneId: undefined }
          : message
      )
    );
  }

  function resolveManualNextActionSceneId(
    sceneIdArg?: SceneId | string
  ): SceneId | undefined {
    if (sceneIdArg !== undefined) return toSceneId(sceneIdArg);
    if (selectedSceneId !== undefined) return selectedSceneId;
    for (let index = chatMessages.length - 1; index >= 0; index -= 1) {
      const message = chatMessages[index];
      if (message?.nextActionSceneId !== undefined) {
        return message.nextActionSceneId;
      }
    }
    return undefined;
  }

  function handleManualNextActionCoach(sceneIdArg?: SceneId | string): void {
    const sceneId = resolveManualNextActionSceneId(sceneIdArg);
    if (sceneId === undefined) {
      appendChatStatusMessage("Open a scene before asking for next steps.");
      return;
    }
    const gate = shouldAllowManualNextActionCoach({
      hasOpenNextActionMessage: activeChatHasOpenNextActionMessage(),
      ...(msSinceLastNextActionSuggestion() === undefined
        ? {}
        : { msSinceLastSuggestion: msSinceLastNextActionSuggestion() })
    });
    if (!gate.allowed) {
      if (gate.blockedReason === "open-message") {
        const draftSceneId =
          resolveManualNextActionSceneId(sceneIdArg) ?? sceneId;
        appendActiveChatMessage({
          id: `chat-system-${Date.now()}`,
          role: "system",
          body: "Dismiss the current next-steps suggestions first — tap to open the scene draft.",
          openSceneOnPress: draftSceneId
        });
        return;
      }
      appendChatStatusMessage(
        "Next-step suggestions just ran — try again in a few minutes."
      );
      return;
    }
    void runAndAppendNextActionCoach({
      sceneId,
      trigger: "manual-start",
      statusLabel: "Next steps"
    });
  }

  function handleMessageActionChip(input: Readonly<{
    messageId: string;
    chipId: string;
    sceneId?: SceneId;
    revision?: number;
    catalogAgentId?: CatalogAgentId;
  }>): void {
    if (
      input.chipId === "review-plans" ||
      input.chipId === "review-project-drafts" ||
      input.chipId === "review-scene-drafts"
    ) {
      handleWorkPlanJobAction(input.chipId);
      return;
    }
    if (input.chipId === "submit-work-plan") {
      const message = chatMessages.find(
        (entry) => entry.id === input.messageId
      );
      const plan =
        message?.workPlan ?? latestWorkPlanFromMessages(chatMessages);
      if (plan === undefined) {
        appendChatStatusMessage(
          "No work plan to submit. Ask for a multi-step plan first."
        );
        return;
      }
      replaceActiveChatMessages((messages) =>
        messages.map((entry) =>
          entry.id === input.messageId
            ? {
                ...entry,
                workPlan: undefined,
                actionChips: entry.actionChips?.filter(
                  (chip) =>
                    chip.id !== "submit-work-plan" &&
                    chip.id !== "dismiss-work-plan"
                )
              }
            : entry
        )
      );
      void handleSubmitWorkPlan(plan);
      return;
    }
    if (input.chipId === "dismiss-work-plan") {
      replaceActiveChatMessages((messages) =>
        messages.map((entry) =>
          entry.id === input.messageId
            ? {
                ...entry,
                workPlan: undefined,
                actionChips: entry.actionChips?.filter(
                  (chip) =>
                    chip.id !== "submit-work-plan" &&
                    chip.id !== "dismiss-work-plan"
                )
              }
            : entry
        )
      );
      return;
    }
    if (input.chipId === "dismiss-next-action") {
      dismissNextActionFor(input.sceneId, input.revision, input.messageId);
      return;
    }
    if (input.chipId === "start-next-action-coach") {
      if (input.sceneId !== undefined) {
        dismissNextActionFor(input.sceneId, input.revision, input.messageId);
        void runAndAppendNextActionCoach({
          sceneId: input.sceneId,
          ...(input.revision === undefined ? {} : { revision: input.revision }),
          trigger: "manual-start",
          statusLabel: "Next steps"
        });
      }
      return;
    }
    if (input.chipId === "dialogue-coach" && input.catalogAgentId !== undefined) {
      dismissNextActionFor(input.sceneId, input.revision, input.messageId);
      const sceneIdForCoach = input.sceneId ?? selectedSceneId;
      void handleCatalogAgentRun(input.catalogAgentId, {
        ...(sceneIdForCoach === undefined ? {} : { sceneId: sceneIdForCoach })
      });
      return;
    }
    if (input.chipId === "continue-writing") {
      dismissNextActionFor(input.sceneId, input.revision, input.messageId);
      void handleOpenChatScene(input.sceneId);
      return;
    }
    if (input.chipId === "create-story-knowledge") {
      dismissNextActionFor(input.sceneId, input.revision, input.messageId);
      appendChatStatusMessage(
        "Open Cast to add the suggested story knowledge record."
      );
    }
  }

  function handleDraftAcknowledgement(
    event: DraftAcknowledgementEvent
  ): void {
    const now = Date.now();
    if (event.kind === "save") {
      if (
        event.sceneId !== undefined &&
        event.workingVersion !== undefined
      ) {
        scheduleSceneSaveNextActionInvite(
          toSceneId(event.sceneId),
          event.workingVersion
        );
      }
      if (
        !shouldShowDraftAcknowledgement(
          lastDraftAcknowledgementAtRef.current,
          now
        )
      ) {
        return;
      }
      lastDraftAcknowledgementAtRef.current = now;
    }
    showToast(
      acknowledgementToast({
        id: nextToastId(`draft-${event.kind}`),
        title: event.title,
        detail:
          event.kind === "save"
            ? `${event.detail} · Saved to project`
            : event.detail,
        now
      })
    );
  }

  function handleDraftProblem(problem: DraftProblemEvent): void {
    showToast(
      problemToast({
        id: problem.id,
        title: problem.title,
        detail: problem.detail,
        tone: problem.tone,
        now: Date.now()
      })
    );
  }

  if (!fontsLoaded && fontError === null) {
    return (
      <View
        accessibilityLabel="Loading Ghostwriter"
        style={{
          alignItems: "center",
          backgroundColor: ghostwriterTheme.colors.paper,
          flex: 1,
          justifyContent: "center"
        }}
      >
        <ActivityIndicator color={ghostwriterTheme.colors.kicker} />
      </View>
    );
  }

  // Bootstrap session check must not reuse the Google button spinner — that looks
  // like sign-in already started for first-time visitors.
  if (phase === "loading") {
    return (
      <View
        accessibilityLabel="Loading Ghostwriter"
        style={{
          alignItems: "center",
          backgroundColor: ghostwriterTheme.colors.canvas,
          flex: 1,
          justifyContent: "center"
        }}
      >
        <ActivityIndicator color={ghostwriterTheme.colors.kicker} />
      </View>
    );
  }

  if (phase === "signedOut" || writer === undefined) {
    return (
      <AccountGateScreen
        error={error}
        onDemoSignIn={() => void startDemoSignIn()}
        onSignIn={() => void startGoogleSignIn()}
        signingIn={busy}
      />
    );
  }

  if (phase === "project" && selectedProject !== undefined) {
    if (readerProjection !== undefined || readerLoading || readerError !== undefined) {
      return (
        <BookReaderPanel
          busy={readerLoading}
          error={readerError}
          onConfigureVoice={() => {
            exitReader();
            openSettings("reader-voice");
          }}
          onExit={exitReader}
          onSpeak={speakReaderPassage}
          onStopSpeak={stopReaderSpeech}
          onVoicePackChange={setReaderVoicePack}
          projection={readerProjection}
          speaking={readerSpeaking}
          voiceError={readerVoiceError}
          voicePack={readerVoicePack}
        />
      );
    }

    return (
      <>
      <AuthenticatedProjectWorkspace
        allChangesIdle={aggregateProjectChangesIdle({
          projectSaveIdle: saveState === "saved",
          canvasSaveIdle: canvasSaveState === "saved",
          draftActivityIdle: draftActivity === "idle",
          captureActivityIdle: captureShellChangesIdle({
            modalOpen: captureOpen,
            activity: captureActivity,
            problemWhileClosed: captureProblemWhileClosed
          }),
          inboxActivityIdle: !inboxOpen || inboxActivity === "idle",
          shellBusy: busy,
          canvasBusy
        })}
        busy={busy}
        inboxOpen={inboxOpen}
        settingsOpen={settingsOpen}
        onCloseInbox={closeInboxWorkspace}
        onOpenCapture={(captureId) => openCaptureComposer(captureId)}
        onOpenInbox={() => void openInboxWorkspace()}
        onOpenSettings={openSettings}
        renderInbox={(presentation: InboxWorkspacePresentation) => (
          <InboxPanel
            agentDeepLink={plansAgentDeepLink}
            onAgentDeepLinkConsumed={() => setPlansAgentDeepLink(undefined)}
            canvasVersion={canvasWorkspace?.board.version}
            compact={presentation.compact}
            ensureCanvasVersion={() => ensureCanvasVersionForHandoff()}
            onAcknowledgement={handleInboxAcknowledgement}
            onActivityChange={setInboxActivity}
            onOpenCapture={(captureId) => openCaptureComposer(captureId)}
            onOpenSettings={openSettings}
            providerStatusSignal={providerStatusSignal}
            onOpenDraft={(sceneId) =>
              void openHandoffTargetScene(sceneId as SceneId, "draft")
            }
            {...(presentation.compact
              ? {}
              : {
                  onOpenSplit: (sceneId) =>
                    void openHandoffTargetScene(sceneId as SceneId, "split")
                })}
            onProblem={handleInboxProblem}
            onProblemResolved={dismissToast}
            onPromote={(input) => handleCapturePromote(input)}
            onSelectCapture={setInboxSelectedCaptureId}
            onViewSourceCapture={(captureId) =>
              openCaptureComposer(captureId, { readOnly: true })
            }
            project={selectedProject}
            projectId={selectedProject.id}
            projectVersion={selectedProject.version}
            refreshSignal={inboxRefreshSignal}
            selectedCaptureId={inboxSelectedCaptureId}
          />
        )}
        chatCapabilities={GHOSTWRITER_CAPABILITIES}
        chatMessages={chatMessages}
        chatMode={chatMode}
        chatModel={chatModel}
        chatEffort={chatEffort}
        autoSuggestionsEnabled={autoSuggestionsEnabled}
        onAutoSuggestionsChange={(enabled) => {
          setAutoSuggestionsEnabled(enabled);
          persistChatPrefs({ autoSuggestions: enabled });
        }}
        requestOpenAgentPanel={requestOpenAgentPanel}
        requestFocusDraftScene={requestFocusDraftScene}
        onMessageActionChip={handleMessageActionChip}
        onManualNextActionCoach={handleManualNextActionCoach}
        nextActionCoachBusy={nextActionCoachBusy}
        workPlanJobSummary={workPlanJobSummary}
        workPlanJobs={workPlanJobs}
        workPlanJobActions={workPlanJobActions}
        onWorkPlanJobAction={handleWorkPlanJobAction}
        onOpenWorkPlanJob={handleOpenWorkPlanJob}
        onDismissWorkPlanJobs={() => {
          setWorkPlanJobs([]);
          setWorkPlanJobSummary("");
          setWorkPlanJobActions([]);
        }}
        requestReviewProjectDrafts={requestReviewProjectDrafts}
        requestReviewSceneDrafts={requestReviewSceneDrafts}
        requestReviewSceneDraftsSceneId={requestReviewSceneDraftsSceneId}
        requestOpenEntityDraft={requestOpenEntityDraft}
        requestOpenEntityDraftProposalId={requestOpenEntityDraftProposalId}
        requestOpenEntityDraftScope={requestOpenEntityDraftScope}
        requestOpenEntityDraftSceneId={requestOpenEntityDraftSceneId}
        chatSessions={chatSessionTabs}
        chatHistorySessions={chatHistoryTabs}
        activeChatSessionId={chatSessionsState.activeSessionId}
        onChatSessionSelect={handleChatSessionSelect}
        onNewChatSession={handleNewChatSession}
        onRenameChatSession={handleRenameChatSession}
        onDismissChatSession={handleDismissChatSession}
        onReopenChatSession={handleReopenChatSession}
        onDeleteChatSession={handleDeleteChatSession}
        chatStreaming={chatStreaming}
        onChatStop={handleChatStop}
        onForkChatMessage={handleForkChatMessage}
        onRegenerateChatMessage={handleRegenerateChatMessage}
        onRetryChatTurn={handleRetryChatTurn}
        onOpenChatScene={handleOpenChatScene}
        canOpenChatScene={selectedSceneId !== undefined}
        chatProviderConfigured={chatProviderConfigured}
        chatAvailableModels={chatAvailableModels}
        imageAvailableModels={imageAvailableModels}
        preferredImageModelId={preferredImageModelId}
        onChatModeChange={(mode) => {
          setChatMode(mode);
          const nextModel = resolveWorkspaceModelForTask(
            mode,
            chatModel,
            chatAvailableModels,
            writer.account.id
          );
          setChatModel(nextModel);
          persistChatPrefs({ mode, model: nextModel });
        }}
        onChatModelChange={(model) => {
          setChatModel(model);
          persistChatPrefs({ model });
        }}
        onChatEffortChange={(effort) => {
          setChatEffort(effort);
          persistChatPrefs({ effort });
        }}
        drillStack={drillStack}
        error={error}
        mode={workspaceMode}
        coverOptionsJob={
          coverOptionsJob === undefined
            ? undefined
            : {
                bookId: coverOptionsJob.bookId,
                jobId: coverOptionsJob.jobId,
                status: coverOptionsJob.status,
                ...(coverOptionsJob.options === undefined
                  ? {}
                  : { options: coverOptionsJob.options }),
                ...(coverOptionsJob.error === undefined
                  ? {}
                  : { error: coverOptionsJob.error }),
                ...(coverOptionsJob.basePrompt === undefined
                  ? {}
                  : { basePrompt: coverOptionsJob.basePrompt })
              }
        }
        coverReviewBookId={coverReviewBookId}
        castFocusKnowledgeId={castFocusKnowledgeId}
        onApplyCoverImage={(input) => applyBookCoverImage(input)}
        onApplyCharacterVisual={(input) => applyCharacterVisual(input)}
        onCastFocusConsumed={() => setCastFocusKnowledgeId(undefined)}
        onCoverReviewConsumed={() => setCoverReviewBookId(undefined)}
        onResolveCoverDisplayUrl={(input) => resolveBookCoverDisplayUrl(input)}
        onResolveCharacterVisualDisplayUrl={(input) =>
          resolveCharacterVisualDisplayUrl(input)
        }
        onStartCoverOptionsJob={(input) => startBookCoverOptionsJob(input)}
        onStartCharacterVisualJob={(input) => startCharacterVisualJob(input)}
        characterVisualJob={
          characterVisualJob === undefined
            ? undefined
            : {
                knowledgeId: characterVisualJob.knowledgeId,
                jobId: characterVisualJob.jobId,
                status: characterVisualJob.status,
                ...(characterVisualJob.options === undefined
                  ? {}
                  : { options: characterVisualJob.options }),
                ...(characterVisualJob.error === undefined
                  ? {}
                  : { error: characterVisualJob.error }),
                ...(characterVisualJob.basePrompt === undefined
                  ? {}
                  : { basePrompt: characterVisualJob.basePrompt })
              }
        }
        entityDraftDetailTitles={entityDraftDetailTitles}
        entityDraftExpandedBody={entityDraftExpandedBody}
        entityDraftExpandedId={entityDraftExpandedId}
        entityDraftExpandedLoading={entityDraftExpandedLoading}
        entityDraftMutatingProposalId={entityDraftMutatingProposalId}
        entityDrafts={entityDrafts}
        entityDraftsLoading={entityDraftsLoading}
        onAcknowledgeEntityDraft={(proposalId) =>
          void handleAcknowledgeEntityDraft(proposalId)
        }
        onEntityDraftTargetChange={setEntityDraftTarget}
        onRefreshEntityDrafts={() => void loadEntityDrafts()}
        onRejectEntityDraft={(proposalId) =>
          void handleRejectEntityDraft(proposalId)
        }
        onSelectEntityDraft={(proposalId) =>
          void handleSelectEntityDraft(proposalId)
        }
        inboxSelectedCaptureId={inboxSelectedCaptureId}
        onAgentToolkitAction={handleAgentToolkitAction}
        onCatalogAgentRun={(agentId, selection, lens) =>
          void handleCatalogAgentRun(agentId, selection, lens)
        }
        onBack={() => void leaveProject()}
        onChatSend={handleChatSend}
        chatDictating={chatDictating}
        onChatToggleDictation={() => setChatDictating((current) => !current)}
        chatDictationAvailable={chatDictationAvailable}
        onBindChatDictateAppend={(append) => {
          chatDictateAppendRef.current = append;
        }}
        onSavePlanToPlans={(outlineText) => void handleSavePlanToPlans(outlineText)}
        planOutlineText={planOutlineText}
        onCommand={runCommand}
        onDrillBack={handleDrillBack}
        onDrillTo={handleDrillTo}
        onEnterChapter={handleEnterChapter}
        onModeChange={(mode) => void changeWorkspaceMode(mode)}
        onOpenReader={() => void openReader()}
        onRefresh={() => void refreshCurrentProject()}
        onSelectedSceneIdChange={(sceneId) => {
          if (sceneId !== undefined) void selectWorkspaceScene(sceneId);
        }}
        onSignOut={() => void endSession()}
        activityHistory={activityHistory}
        activityHistoryOpen={activityHistoryOpen}
        onActivityHistoryOpenChange={setActivityHistoryOpen}
        onToastAction={(id) => {
          const action = toastActionsRef.current.get(id);
          if (action !== undefined) void action();
        }}
        onToastDismiss={dismissToast}
        onWorkflowLensChange={handleWorkflowLensChange}
        canvasHistoryOpen={canvasHistoryOpen}
        onCanvasHistoryOpenChange={(open) => {
          setCanvasHistoryOpen(open);
          if (open) {
            setActivityHistoryOpen(false);
            void loadCanvasHistoryForProject(selectedProject.id);
          }
        }}
        profileDisplayName={writer.profile.displayName}
        project={selectedProject}
        storageAccountId={writer.account.id}
        renderCanvas={
          <StoryCanvasPanel
            busy={canvasBusy}
            condensed={workspaceMode === "split"}
            drillStack={drillStack}
            history={canvasHistory}
            historyLoading={canvasHistoryLoading}
            historyOpen={canvasHistoryOpen}
            loading={canvasLoading}
            message={canvasMessage}
            onCommand={runCanvasCommand}
            onCreateScene={createStoryboardScene}
            onDrillIntoChapter={handleDrillIntoChapter}
            onDrillIntoScene={handleDrillIntoScene}
            onHistoryOpenChange={setCanvasHistoryOpen}
            onLoadHistory={() =>
              loadCanvasHistoryForProject(selectedProject.id)
            }
            onPreferenceChange={persistCanvasPreference}
            recentActions={recentCanvasActions}
            onReload={() =>
              loadCanvas(
                selectedProject.id,
                "Latest server-acknowledged Canvas loaded for review."
              )
            }
            onRestoreRevision={restoreCanvasSnapshot}
            onSelectObject={setSelectedCanvasObjectId}
            onOpenDraft={(sceneId) => {
              void (async () => {
                await selectWorkspaceScene(sceneId);
                await changeWorkspaceMode("draft");
              })();
            }}
            onOpenSplit={(sceneId) => {
              void (async () => {
                await selectWorkspaceScene(sceneId);
                await changeWorkspaceMode("split");
              })();
            }}
            onSelectScene={(sceneId) => void selectWorkspaceScene(sceneId)}
            onUndo={undoLatestCanvasCommand}
            preference={canvasPreference}
            project={selectedProject}
            saveState={canvasSaveState}
            selectedObjectId={selectedCanvasObjectId}
            selectedSceneId={selectedSceneId}
            workflowLens={workflowLens}
            onWorkflowLensChange={setWorkflowLens}
            onDrillBack={handleDrillBack}
            workspace={canvasWorkspace}
          />
        }
        renderDraft={(scene, presentation) => {
          if (scene === undefined) return null;
          const context = draftDeskSceneContext(selectedProject, scene.id);
          const nextSceneId = context.nextScene?.id;
          const previousSceneId = context.previousScene?.id;
          return (
            <DraftPanel
              accountId={writer.account.id}
              assistOpen={assistOpen}
              contextDockOpen={presentation.contextDockOpen}
              focusHalo={presentation.focusHalo}
              historyOpen={presentation.historyOpen}
              key={`${scene.id}:${draftMountVersion}`}
              nextSceneTitle={context.nextScene?.title}
              onAcknowledgement={handleDraftAcknowledgement}
              onActivityChange={setDraftActivity}
              onAssistOpenChange={setAssistOpen}
              onContextDockOpenChange={presentation.onContextDockOpenChange}
              onFocusHaloChange={presentation.onFocusHaloChange}
              onHistoryOpenChange={presentation.onHistoryOpenChange}
              {...(presentation.quickBuild === undefined
                ? {}
                : { quickBuild: presentation.quickBuild })}
              onNextScene={
                nextSceneId === undefined
                  ? undefined
                  : () => void selectWorkspaceScene(nextSceneId)
              }
              onPreviousScene={
                previousSceneId === undefined
                  ? undefined
                  : () => void selectWorkspaceScene(previousSceneId)
              }
              onOpenCastStudio={(knowledgeId) => {
                setCastFocusKnowledgeId(toStoryKnowledgeId(knowledgeId));
              }}
              onProblem={handleDraftProblem}
              onProblemResolved={dismissToast}
              onProjectCommand={runCommand}
              onWriteCompositionChange={(composition) => {
                setWriteComposition(composition);
                const nextMode = workspaceModeForComposition(composition);
                if (nextMode !== workspaceMode) {
                  void changeWorkspaceMode(nextMode);
                }
              }}
              onWriteModalityChange={setWriteModality}
              povLabel={context.povLabel}
              previousSceneTitle={context.previousScene?.title}
              projectId={selectedProject.id}
              projectVersion={selectedProject.version}
              readOnly={scene.archivedAt !== undefined}
              ref={draftPanelRef}
              sceneBackdropCaption={scene.backdrop?.caption}
              sceneBackdropUrl={scene.backdrop?.url}
              sceneCast={selectedProject.storyKnowledge
                .filter(
                  (knowledge) =>
                    knowledge.archivedAt === undefined &&
                    knowledge.linkedSceneIds.includes(scene.id)
                )
                .map((knowledge) => ({
                  id: knowledge.id,
                  label: knowledge.label,
                  ...(knowledge.characterSheet === undefined
                    ? {}
                    : { characterSheet: knowledge.characterSheet })
                }))}
              linkableCast={selectedProject.storyKnowledge
                .filter(
                  (knowledge) =>
                    knowledge.archivedAt === undefined &&
                    !knowledge.linkedSceneIds.includes(scene.id)
                )
                .map((knowledge) => ({
                  id: knowledge.id,
                  label: knowledge.label,
                  ...(knowledge.characterSheet === undefined
                    ? {}
                    : { characterSheet: knowledge.characterSheet })
                }))}
              sceneId={scene.id}
              scenePosition={context.positionLabel}
              sceneSketch={scene.sketch}
              sceneStatus={scene.status}
              sceneSummary={scene.summary}
              sceneTitle={scene.title}
              writeComposition={writeComposition}
              writeModality={writeModality}
            />
          );
        }}
        sceneProseById={sceneProseById}
        onChronologySceneIdsChange={setChronologySceneIds}
        selectedSceneId={selectedSceneId}
        workflowLens={workflowLens}
      />
      <CaptureModalShell
        onRequestClose={() => void closeCaptureComposer()}
        onShow={() => captureComposerRef.current?.focus()}
        visible={captureOpen}
      >
        <CaptureComposerPanel
          accountId={writer.account.id}
          captureId={activeCaptureId}
          readOnly={captureComposerReadOnly}
          onAcknowledgement={handleCaptureAcknowledgement}
          onActivityChange={handleCaptureActivityChange}
          onCaptureReady={(captureId) => setActiveCaptureId(captureId)}
          onClose={() => void closeCaptureComposer()}
          onProblem={handleCaptureProblem}
          onProblemResolved={handleCaptureProblemResolved}
          projectId={selectedProject.id}
          ref={captureComposerRef}
        />
      </CaptureModalShell>
      <CaptureModalShell
        accessibilityLabel="Settings"
        dismissAccessibilityLabel="Dismiss Settings"
        onRequestClose={() => {
          setSettingsOpen(false);
          setProviderStatusSignal((n) => n + 1);
        }}
        visible={settingsOpen}
      >
        <SettingsPanel
          accountId={writer.account.id}
          projectId={selectedProject.id}
          activeTab={settingsTab}
          onClose={() => {
            setSettingsOpen(false);
            setProviderStatusSignal((n) => n + 1);
          }}
          onConfigured={() => {
            setProviderStatusSignal((n) => n + 1);
          }}
          onPreferencesChanged={() => {
            setModelPreferencesSignal((n) => n + 1);
          }}
          onTabChange={setSettingsTab}
          providerStatusSignal={providerStatusSignal}
        />
      </CaptureModalShell>
      </>
    );
  }

  return (
    <ProjectLibraryScreen
      busy={busy}
      error={error}
      includeArchived={includeArchived}
      onCreate={(input) => void makeProject(input)}
      onOpen={(projectId) => void openProject(projectId)}
      onRefresh={() => void refreshProjects()}
      onSetIncludeArchived={(next) => {
        setIncludeArchived(next);
        void refreshProjects(next);
      }}
      onSignOut={() => void endSession()}
      onUpdateProfile={(input) => void saveProfile(input)}
      profile={writer.profile}
      profileSaveState={profileSaveState}
      projects={projects}
    />
  );
}
