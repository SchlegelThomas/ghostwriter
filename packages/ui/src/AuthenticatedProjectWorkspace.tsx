import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Alert,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View
} from "react-native";
import {
  ArrowDown,
  ArrowUp,
  CaretDoubleUp,
  PencilSimple,
  Plus,
  type Icon
} from "phosphor-react-native";
import type {
  AgentModelId,
  GhostwriterCapability,
  ProjectCommand,
  ProjectNavigator,
  ProjectNavigatorScene,
  SceneId,
  BookId,
  StoryKnowledgeId
} from "@ghostwriter/core";
import type { OpenSettingsHandler } from "./settings-focus.js";
import {
  type AcknowledgementToast
} from "./AcknowledgementToastHost.js";
import {
  currentDrillScope,
  drillBreadcrumbs,
  workflowLensLabel,
  type CanvasDrillScope,
  type CanvasDrillStack,
  type CanvasWorkflowLens
} from "./canvas-drill.js";
import { CanvasDrillBar } from "./CanvasDrillBar.js";
import {
  ManuscriptTree,
  type ManuscriptTreeAddRequest,
  type ManuscriptTreeCollapseAllRequest,
  type ManuscriptTreeRenameRequest,
  type SceneMoveDestination
} from "./ManuscriptTree.js";
import {
  manuscriptExplorerActionLabel,
  manuscriptExplorerHeaderActions,
  planManuscriptExplorerArchive,
  resolveManuscriptExplorerCapabilities,
  type ManuscriptExplorerActionId
} from "./manuscript-explorer-actions.js";
import {
  manuscriptSelectionKey,
  resolveManuscriptSelection,
  sceneSelection,
  type ManuscriptSelection
} from "./manuscript-selection.js";
import { SelectionInspector } from "./SelectionInspector.js";
import {
  clampSplitRatio,
  readStoredSplitRatio,
  SPLIT_RATIO_DEFAULT,
  writeStoredSplitRatio
} from "./split-layout.js";
import { ghostwriterTheme } from "./theme.js";
import {
  defaultMapStructureRail,
  mapBoardOwnsViewport,
  mapStructureQuickBuildVisible,
  mapStructureRailWidth,
  toggleMapStructureRail,
  type MapStructureRailMode
} from "./map-structure-rail.js";
import {
  ProjectTitlePage,
  type CoverOptionsJobSnapshot
} from "./ProjectTitlePage.js";
import { ManuscriptChronologyDesk } from "./ManuscriptChronologyDesk.js";
import {
  chronologySceneIds,
  manuscriptChronology
} from "./manuscript-chronology.js";
import {
  quickBuildOptions,
  sceneTimeline,
  storyTrail,
  type QuickBuildOption
} from "./workspace-structure.js";
import {
  WorkspaceChatPanel,
  type WorkspaceChatMessage,
  type WorkspaceChatSendInput
} from "./WorkspaceChatPanel.js";
import {
  buildAgentToolkitSelection,
  type AgentToolkitId,
  type AgentToolkitSelection
} from "./workspace-agent-toolkit.js";
import {
  DEFAULT_WORKSPACE_AGENT_PREFS,
  type WorkspaceAgentEffort,
  type WorkspaceAgentMode,
  type WorkspaceAvailableModel
} from "./workspace-agent-prefs.js";
import { WorkspaceSecondaryPanel } from "./WorkspaceSecondaryPanel.js";
import {
  WorkspaceQuickNav,
  type WorkspacePaletteMode
} from "./WorkspaceQuickNav.js";
import { WorkspaceTopSearch } from "./WorkspaceTopSearch.js";
import {
  clampShellWidth,
  nextSecondaryTabOnAgentOpen,
  primaryPanelStorageKey,
  primarySideLabel,
  PRIMARY_WIDTH_DEFAULT,
  PRIMARY_WIDTH_MAX,
  PRIMARY_WIDTH_MIN,
  readStoredShellWidth,
  secondaryPanelStorageKey,
  SECONDARY_WIDTH_DEFAULT,
  SECONDARY_WIDTH_MAX,
  SECONDARY_WIDTH_MIN,
  workspaceShowsDraftPane,
  workspaceSplitPanesActive,
  writeStoredShellWidth,
  type WorkspacePrimaryView,
  type WorkspaceSecondaryTab
} from "./workspace-shell-layout.js";
import {
  buildUnifiedSearchTargets,
  buildWorkspaceJumpTargets,
  type WorkspaceJumpTarget
} from "./workspace-quick-nav.js";
import {
  castOpenClosesInbox,
  castTakesCenterWorkspace,
  manuscriptSelectionLeavesCharactersLens,
  centerUsesDenseColumn,
  inboxOpenLeavesCharactersRail,
  inboxTakesCenterWorkspace,
  NARROW_INBOX_TAB_LABEL,
  workspaceNavigationClosesInbox,
  type WorkspaceShellNavigationAction
} from "./workspace-capture-shell.js";
import {
  CastRelationshipsStudio,
  type CharacterVisualOptionsJobSnapshot
} from "./CastRelationshipsStudio.js";
import { selectedCastKnowledge } from "./cast-studio-model.js";
import {
  CanvasRailIcon,
  CharactersRailIcon,
  ChatRailIcon,
  DraftRailIcon,
  DreamsRailIcon,
  ExplorerRailIcon,
  HistoryRailIcon,
  JumpRailIcon,
  ReaderRailIcon,
  SettingsRailIcon,
  SplitRailIcon,
  StructureRailIcon
} from "./rail-icons.js";

function explorerHeaderIcon(
  action: ManuscriptExplorerActionId
): Icon | undefined {
  switch (action) {
    case "add":
      return Plus;
    case "rename":
      return PencilSimple;
    case "move-up":
      return ArrowUp;
    case "move-down":
      return ArrowDown;
    case "collapse-all":
      return CaretDoubleUp;
    default:
      return undefined;
  }
}

export type ProjectWorkspaceMode = "draft" | "canvas" | "split";

export type DraftQuickBuildPresentation = Readonly<{
  open: boolean;
  options: readonly QuickBuildOption[];
  onOpenChange(open: boolean): void;
  onSelect(option: QuickBuildOption): void;
}>;

export type DraftWorkspacePresentation = Readonly<{
  contextDockOpen: boolean;
  focusHalo: boolean;
  historyOpen: boolean;
  narrow: boolean;
  quickBuild?: DraftQuickBuildPresentation;
  onContextDockOpenChange(open: boolean): void;
  onFocusHaloChange(focused: boolean): void;
  onHistoryOpenChange(open: boolean): void;
}>;

export type InboxWorkspacePresentation = Readonly<{
  compact: boolean;
}>;

export type AuthenticatedProjectWorkspaceProps = Readonly<{
  project: ProjectNavigator;
  profileDisplayName: string;
  mode: ProjectWorkspaceMode;
  selectedSceneId?: SceneId;
  busy?: boolean;
  allChangesIdle?: boolean;
  error?: string;
  /** Acknowledgements for the History rail panel — not floating toasts. */
  activityHistory?: readonly AcknowledgementToast[];
  activityHistoryOpen?: boolean;
  onActivityHistoryOpenChange?(open: boolean): void;
  onBack(): void;
  onRefresh(): void;
  onSignOut(): void;
  onCommand(command: ProjectCommand): Promise<boolean>;
  onModeChange(mode: ProjectWorkspaceMode): void;
  onSelectedSceneIdChange(sceneId: SceneId | undefined): void;
  onOpenReader?(): void;
  onToastAction?(id: string): void;
  onToastDismiss?(id: string): void;
  drillStack?: CanvasDrillStack;
  workflowLens?: CanvasWorkflowLens;
  onDrillBack?(): void;
  onDrillTo?(scope: CanvasDrillScope): void;
  onEnterChapter?(
    selection: Extract<ManuscriptSelection, { kind: "chapter" }>
  ): void;
  onWorkflowLensChange?(lens: CanvasWorkflowLens): void;
  canvasHistoryOpen?: boolean;
  onCanvasHistoryOpenChange?(open: boolean): void;
  storageAccountId?: string;
  renderCanvas?: ReactNode;
  renderDraft?(
    scene: ProjectNavigatorScene | undefined,
    presentation: DraftWorkspacePresentation
  ): ReactNode;
  /** Plain-text scene bodies for ManuscriptChronologyDesk (loaded by App). */
  sceneProseById?: Readonly<Record<string, string>>;
  /** Scoped chronology scene ids when the manuscript scroll is visible. */
  onChronologySceneIdsChange?(sceneIds: readonly SceneId[]): void;
  inboxOpen?: boolean;
  settingsOpen?: boolean;
  renderInbox?(presentation: InboxWorkspacePresentation): ReactNode;
  onOpenInbox?(): void;
  onCloseInbox?(): void;
  onOpenCapture?(captureId?: string): void;
  onOpenSettings?: OpenSettingsHandler;
  chatCapabilities?: readonly GhostwriterCapability[];
  chatMessages?: readonly WorkspaceChatMessage[];
  chatMode?: WorkspaceAgentMode;
  chatModel?: AgentModelId;
  chatEffort?: WorkspaceAgentEffort;
  onChatModeChange?(mode: WorkspaceAgentMode): void;
  onChatModelChange?(model: AgentModelId): void;
  onChatEffortChange?(effort: WorkspaceAgentEffort): void;
  chatProviderConfigured?: boolean;
  chatAvailableModels?: readonly WorkspaceAvailableModel[];
  imageAvailableModels?: readonly WorkspaceAvailableModel[];
  preferredImageModelId?: string;
  onChatSend?(input: WorkspaceChatSendInput): Promise<void> | void;
  inboxSelectedCaptureId?: string;
  onAgentToolkitAction?(
    id: AgentToolkitId,
    selection: AgentToolkitSelection
  ): void;
  onStartCoverOptionsJob?(input: Readonly<{
    bookId: BookId;
    prompt: string;
    count?: number;
    refinement?: string;
    imageModel?: string;
  }>): Promise<void>;
  coverOptionsJob?: CoverOptionsJobSnapshot;
  coverReviewBookId?: BookId;
  onCoverReviewConsumed?(): void;
  /** Split Sheet → Cast studio handoff (mirrors coverReviewBookId). */
  castFocusKnowledgeId?: StoryKnowledgeId;
  onCastFocusConsumed?(): void;
  onGenerateCoverPreview?(input: Readonly<{
    bookId: BookId;
    prompt: string;
  }>): Promise<Readonly<{ previewUrl: string }>>;
  onApplyCoverImage?(input: Readonly<{
    bookId: BookId;
    previewDataUri: string;
  }>): Promise<void>;
  onResolveCoverDisplayUrl?(input: Readonly<{
    bookId: BookId;
    imageUrl: string;
  }>): Promise<string | undefined>;
  characterVisualJob?: CharacterVisualOptionsJobSnapshot;
  onStartCharacterVisualJob?(input: Readonly<{
    knowledgeId: StoryKnowledgeId;
    count?: number;
    refinement?: string;
    imageModel?: string;
  }>): Promise<void>;
  onApplyCharacterVisual?(input: Readonly<{
    knowledgeId: StoryKnowledgeId;
    previewDataUri: string;
    alt: string;
    source: "generated" | "upload";
  }>): Promise<void>;
  onResolveCharacterVisualDisplayUrl?(input: Readonly<{
    knowledgeId: StoryKnowledgeId;
    visualId: string;
    imageUrl: string;
  }>): Promise<string | undefined>;
}>;

const { colors, fonts, shell } = ghostwriterTheme;


type CollapsedPanel = "tree" | "inspector" | "none";

function Button({
  label,
  onPress,
  disabled = false,
  primary = false,
  selected = false
}: Readonly<{
  label: string;
  onPress(): void;
  disabled?: boolean;
  primary?: boolean;
  selected?: boolean;
}>) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        primary && styles.buttonPrimary,
        selected && styles.buttonSelected,
        pressed && styles.pressed,
        disabled && styles.disabled
      ]}
    >
      <Text
        style={[
          styles.buttonText,
          primary && styles.buttonTextPrimary,
          selected && styles.buttonTextSelected
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function RailButton({
  icon,
  label,
  selected,
  disabled,
  onPress
}: Readonly<{
  icon: (tone: "default" | "selected") => ReactNode;
  label: string;
  selected: boolean;
  disabled: boolean;
  onPress(): void;
}>) {
  return (
    <Pressable
      accessibilityLabel={`${label}${selected ? ", selected" : ""}`}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.railButton,
        selected && styles.railButtonSelected,
        pressed && styles.pressed,
        disabled && styles.disabled
      ]}
      {...({ title: label } as object)}
    >
      {icon(selected ? "selected" : "default")}
    </Pressable>
  );
}

function allScenes(project: ProjectNavigator): ProjectNavigatorScene[] {
  return project.books.flatMap((book) => [
    ...book.parts.flatMap((part) =>
      part.chapters.flatMap((chapter) => chapter.scenes)
    ),
    ...book.unassignedScenes
  ]);
}

function swapped<Value>(values: readonly Value[], from: number, to: number): Value[] {
  if (from < 0 || to < 0 || from >= values.length || to >= values.length) {
    return [...values];
  }
  const result = [...values];
  const [value] = result.splice(from, 1);
  if (value !== undefined) result.splice(to, 0, value);
  return result;
}

export function AuthenticatedProjectWorkspace({
  project,
  profileDisplayName,
  mode,
  selectedSceneId,
  busy = false,
  allChangesIdle = false,
  error,
  activityHistory = [],
  activityHistoryOpen = false,
  onActivityHistoryOpenChange,
  onBack,
  onRefresh,
  onSignOut,
  onCommand,
  onModeChange,
  onSelectedSceneIdChange,
  onOpenReader,
  onToastAction = () => undefined,
  onToastDismiss = () => undefined,
  drillStack = [{ kind: "project" }],
  workflowLens = "outline",
  onDrillBack = () => undefined,
  onDrillTo = () => undefined,
  onEnterChapter = () => undefined,
  onWorkflowLensChange = () => undefined,
  canvasHistoryOpen = false,
  onCanvasHistoryOpenChange,
  storageAccountId,
  renderCanvas,
  renderDraft,
  sceneProseById = {},
  onChronologySceneIdsChange,
  inboxOpen = false,
  settingsOpen = false,
  renderInbox,
  onOpenInbox,
  onCloseInbox,
  onOpenCapture,
  onOpenSettings,
  chatCapabilities = [],
  chatMessages = [],
  chatMode = DEFAULT_WORKSPACE_AGENT_PREFS.mode,
  chatModel = DEFAULT_WORKSPACE_AGENT_PREFS.model,
  chatEffort = DEFAULT_WORKSPACE_AGENT_PREFS.effort,
  onChatModeChange,
  onChatModelChange,
  onChatEffortChange,
  chatProviderConfigured = true,
  chatAvailableModels = [],
  imageAvailableModels = [],
  preferredImageModelId,
  onChatSend,
  inboxSelectedCaptureId,
  onAgentToolkitAction,
  onStartCoverOptionsJob,
  coverOptionsJob,
  coverReviewBookId,
  onCoverReviewConsumed,
  castFocusKnowledgeId,
  onCastFocusConsumed,
  onGenerateCoverPreview,
  onApplyCoverImage,
  onResolveCoverDisplayUrl,
  characterVisualJob,
  onStartCharacterVisualJob,
  onApplyCharacterVisual,
  onResolveCharacterVisualDisplayUrl
}: AuthenticatedProjectWorkspaceProps) {
  const { width } = useWindowDimensions();
  const wide = width >= 1240;
  const narrow = width < 760;
  const [primarySideView, setPrimarySideView] =
    useState<WorkspacePrimaryView>("explorer");
  const centerShowsInbox =
    inboxTakesCenterWorkspace(inboxOpen) && renderInbox !== undefined;
  const inboxOwnsCenter = centerShowsInbox;
  const inboxPresentation: InboxWorkspacePresentation = {
    compact: narrow
  };

  function closeInboxForNavigation(
    action: WorkspaceShellNavigationAction
  ): void {
    if (!inboxOpen || !workspaceNavigationClosesInbox(action)) return;
    onCloseInbox?.();
  }

  function openPlans(): void {
    setPrimarySideView("explorer");
    setRailDestination("write");
    if (structureCollapsible) setStructureRail("expanded");
    onOpenInbox?.();
  }

  function handleAgentToolkitAction(id: AgentToolkitId): void {
    if (onAgentToolkitAction === undefined) return;
    onAgentToolkitAction(
      id,
      buildAgentToolkitSelection(selection, selectedSceneId, inboxSelectedCaptureId)
    );
  }

  function openCharactersPrimary(): void {
    // Cast owns the center; Explorer stays the only wide primary content.
    setPrimarySideView("explorer");
    setRailDestination("characters");
    requestModeChange("draft");
    chooseSelection({ kind: "storyKnowledgeRoot" });
    if (structureCollapsible) setStructureRail("expanded");
    if (castOpenClosesInbox(inboxOpen)) onCloseInbox?.();
  }

  function openExplorerPrimary(): void {
    setPrimarySideView("explorer");
    if (inboxOpen && workspaceNavigationClosesInbox("mode-change")) {
      onCloseInbox?.();
    }
  }

  function requestModeChange(next: ProjectWorkspaceMode): void {
    closeInboxForNavigation("mode-change");
    onModeChange(next);
  }

  function requestOpenReader(): void {
    closeInboxForNavigation("reader");
    // Same Reader rail as Draft/Title Page — leave Cast lens so center yields.
    setRailDestination("write");
    setPrimarySideView("explorer");
    onOpenReader?.();
  }

  function handleProjectBack(): void {
    closeInboxForNavigation("project-back");
    onBack();
  }
  const [splitRatio, setSplitRatio] = useState(SPLIT_RATIO_DEFAULT);
  const [paletteMode, setPaletteMode] = useState<WorkspacePaletteMode>();
  const [structureWidthPx, setStructureWidthPx] = useState<number>(
    PRIMARY_WIDTH_DEFAULT
  );
  const [secondaryWidthPx, setSecondaryWidthPx] = useState<number>(
    SECONDARY_WIDTH_DEFAULT
  );
  const [secondaryTab, setSecondaryTab] =
    useState<WorkspaceSecondaryTab>("agent");
  const [secondaryOpen, setSecondaryOpen] = useState(true);
  const [explorerQuery, setExplorerQuery] = useState("");
  const [contextDockOpen, setContextDockOpen] = useState(false);
  const [draftDockTab, setDraftDockTab] = useState<
    "brief" | "story" | "canvas" | "history"
  >("brief");
  const [focusHalo, setFocusHalo] = useState(false);
  const splitSurfaceRef = useRef<View>(null);
  useEffect(() => {
    if (storageAccountId === undefined) {
      setSplitRatio(SPLIT_RATIO_DEFAULT);
      setStructureWidthPx(PRIMARY_WIDTH_DEFAULT);
      setSecondaryWidthPx(SECONDARY_WIDTH_DEFAULT);
      return;
    }
    setSplitRatio(
      readStoredSplitRatio(project.id, storageAccountId) ?? SPLIT_RATIO_DEFAULT
    );
    setStructureWidthPx(
      readStoredShellWidth(
        primaryPanelStorageKey(storageAccountId, project.id),
        PRIMARY_WIDTH_DEFAULT,
        PRIMARY_WIDTH_MIN,
        PRIMARY_WIDTH_MAX
      )
    );
    setSecondaryWidthPx(
      readStoredShellWidth(
        secondaryPanelStorageKey(storageAccountId, project.id),
        SECONDARY_WIDTH_DEFAULT,
        SECONDARY_WIDTH_MIN,
        SECONDARY_WIDTH_MAX
      )
    );
  }, [project.id, storageAccountId]);

  function persistSplitRatio(next: number): void {
    const clamped = clampSplitRatio(next);
    setSplitRatio(clamped);
    if (storageAccountId !== undefined) {
      writeStoredSplitRatio(project.id, storageAccountId, clamped);
    }
  }

  const splitRatioRef = useRef(splitRatio);
  useEffect(() => {
    splitRatioRef.current = splitRatio;
  }, [splitRatio]);

  const splitDividerResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => mode === "split" && wide,
        onMoveShouldSetPanResponder: () => mode === "split" && wide,
        onPanResponderMove: (_event, gesture) => {
          const node = splitSurfaceRef.current as unknown as
            | HTMLElement
            | undefined;
          const surfaceWidth =
            node?.getBoundingClientRect?.().width ?? width * 0.5;
          if (surfaceWidth <= 0) return;
          persistSplitRatio(splitRatioRef.current + gesture.dx / surfaceWidth);
        },
        onPanResponderRelease: () => undefined
      }),
    [mode, project.id, storageAccountId, wide, width]
  );

  const projectScenes = useMemo(() => allScenes(project), [project]);
  const selectedScene = projectScenes.find(
    (scene) => scene.id === selectedSceneId
  );
  const [selection, setSelection] = useState<ManuscriptSelection>(
    () =>
      (selectedSceneId === undefined
        ? undefined
        : sceneSelection(project, selectedSceneId)) ?? { kind: "project" }
  );
  const [collapsedPanel, setCollapsedPanel] =
    useState<CollapsedPanel>("tree");
  const previousSceneId = useRef(selectedSceneId);
  const canvasVisible = mode === "canvas" || mode === "split";
  // Same collapsible manuscript rail in Draft, Canvas, and Split (wide layouts).
  const structureCollapsible = !narrow;
  const [structureRail, setStructureRail] = useState<MapStructureRailMode>(() =>
    defaultMapStructureRail(mode, width >= 760)
  );
  const mapDense = mapBoardOwnsViewport(mode);
  // Draft matches Map density: trail in topbar, no hero heading stack.
  const draftDense = mode === "draft";
  const surfaceDense = mapDense || draftDense;
  const drillScope = currentDrillScope(drillStack);
  const drillTrail = drillBreadcrumbs(drillStack, project);
  const structureWidth =
    structureCollapsible && structureRail === "collapsed"
      ? mapStructureRailWidth(structureRail, structureCollapsible)
      : structureCollapsible
        ? structureWidthPx
        : shell.navigatorWidth;
  const quickBuildVisible = mapStructureQuickBuildVisible(mode, structureRail);
  const structureCollapsed = structureRail === "collapsed";
  const jumpTargets = useMemo(
    () => buildWorkspaceJumpTargets(project),
    [project]
  );
  const unifiedSearchTargets = useMemo(
    () => buildUnifiedSearchTargets(project, chatCapabilities),
    [chatCapabilities, project]
  );
  const structureResizeOriginRef = useRef(structureWidthPx);
  const secondaryResizeOriginRef = useRef(secondaryWidthPx);

  function persistPrimaryWidth(next: number): void {
    const clamped = clampShellWidth(
      next,
      PRIMARY_WIDTH_MIN,
      PRIMARY_WIDTH_MAX
    );
    setStructureWidthPx(clamped);
    writeStoredShellWidth(
      primaryPanelStorageKey(storageAccountId, project.id),
      clamped,
      PRIMARY_WIDTH_MIN,
      PRIMARY_WIDTH_MAX
    );
  }

  function persistSecondaryWidth(next: number): void {
    const clamped = clampShellWidth(
      next,
      SECONDARY_WIDTH_MIN,
      SECONDARY_WIDTH_MAX
    );
    setSecondaryWidthPx(clamped);
    writeStoredShellWidth(
      secondaryPanelStorageKey(storageAccountId, project.id),
      clamped,
      SECONDARY_WIDTH_MIN,
      SECONDARY_WIDTH_MAX
    );
  }

  function openAgentSecondary(): void {
    setSecondaryOpen(true);
    setSecondaryTab(nextSecondaryTabOnAgentOpen(secondaryTab, true));
    setContextDockOpen(true);
    if (!wide) setCollapsedPanel("inspector");
  }

  const structureResizeResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () =>
          structureCollapsible && structureRail === "expanded",
        onMoveShouldSetPanResponder: () =>
          structureCollapsible && structureRail === "expanded",
        onPanResponderGrant: () => {
          structureResizeOriginRef.current = structureWidthPx;
        },
        onPanResponderMove: (_event, gesture) => {
          persistPrimaryWidth(
            structureResizeOriginRef.current + gesture.dx
          );
        }
      }),
    [project.id, storageAccountId, structureCollapsible, structureRail, structureWidthPx]
  );

  const secondaryResizeResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => secondaryOpen && !narrow,
        onMoveShouldSetPanResponder: () => secondaryOpen && !narrow,
        onPanResponderGrant: () => {
          secondaryResizeOriginRef.current = secondaryWidthPx;
        },
        onPanResponderMove: (_event, gesture) => {
          // Dragging the left edge of the secondary panel: dx increases width when moving left.
          persistSecondaryWidth(
            secondaryResizeOriginRef.current - gesture.dx
          );
        }
      }),
    [narrow, project.id, secondaryOpen, secondaryWidthPx, storageAccountId]
  );

  useEffect(() => {
    // Narrow layouts cannot host the thin rail — force expanded tree.
    // Wide mode switches keep the writer's collapse choice (same bar everywhere).
    if (!structureCollapsible) {
      setStructureRail("expanded");
    }
  }, [structureCollapsible]);

  useEffect(() => {
    if (!canvasVisible || typeof document === "undefined") return;
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || drillStack.length <= 1) return;
      event.preventDefault();
      onDrillBack();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [canvasVisible, drillStack.length, onDrillBack]);

  useEffect(() => {
    if (!structureCollapsible || typeof document === "undefined") return;
    const handleStructureToggle = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      ) {
        return;
      }
      if (event.key !== "[") return;
      event.preventDefault();
      setStructureRail((current) => toggleMapStructureRail(current));
    };
    document.addEventListener("keydown", handleStructureToggle);
    return () =>
      document.removeEventListener("keydown", handleStructureToggle);
  }, [structureCollapsible]);

  useEffect(() => {
    if (typeof document === "undefined" || !focusHalo) return;
    const exitFocus = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setFocusHalo(false);
    };
    document.addEventListener("keydown", exitFocus);
    return () => document.removeEventListener("keydown", exitFocus);
  }, [focusHalo]);

  useEffect(() => {
    if (!wide && mode === "split") requestModeChange("draft");
  }, [mode, wide]);

  useEffect(() => {
    if (mode !== "draft" || selectedSceneId === undefined) {
      setFocusHalo(false);
      setDraftDockTab("brief");
    }
  }, [mode, selectedSceneId]);

  useEffect(() => {
    if (!narrow || (mode !== "draft" && mode !== "canvas")) return;
    setCollapsedPanel("none");
    if (mode === "draft") setContextDockOpen(false);
  }, [mode, narrow, selectedSceneId]);

  useEffect(() => {
    if (
      selectedSceneId !== undefined &&
      selectedSceneId !== previousSceneId.current
    ) {
      const next = sceneSelection(project, selectedSceneId);
      if (next !== undefined) setSelection(next);
    }
    previousSceneId.current = selectedSceneId;
  }, [project, selectedSceneId]);

  useEffect(() => {
    if (resolveManuscriptSelection(project, selection) !== undefined) return;
    setSelection(
      (selectedSceneId === undefined
        ? undefined
        : sceneSelection(project, selectedSceneId)) ?? { kind: "project" }
    );
  }, [project, selectedSceneId, selection]);

  function chooseSelection(next: ManuscriptSelection): void {
    closeInboxForNavigation("manuscript-selection");
    // Write-rail character records open Cast; structure selection returns to Write.
    if (next.kind === "storyKnowledge") {
      setPrimarySideView("explorer");
      setRailDestination("characters");
      if (mode !== "draft") {
        onModeChange("draft");
      }
    } else if (manuscriptSelectionLeavesCharactersLens(next.kind)) {
      setRailDestination("write");
    }
    setSelection(next);
    if (next.kind === "scene") onSelectedSceneIdChange(next.sceneId);
  }

  const [quickBuildOpen, setQuickBuildOpen] = useState(false);
  const [railDestination, setRailDestination] = useState<
    "write" | "characters"
  >("write");
  const [treeAddRequest, setTreeAddRequest] =
    useState<ManuscriptTreeAddRequest>();
  const [treeRenameRequest, setTreeRenameRequest] =
    useState<ManuscriptTreeRenameRequest>();
  const [treeCollapseAllRequest, setTreeCollapseAllRequest] =
    useState<ManuscriptTreeCollapseAllRequest>();
  const quickBuildRequestId = useRef(0);
  const treeEditorRequestId = useRef(0);

  // History "Review covers" → Title Page studio (project home + draft).
  useEffect(() => {
    if (coverReviewBookId === undefined) return;
    closeInboxForNavigation("manuscript-selection");
    setRailDestination("write");
    setPrimarySideView("explorer");
    if (mode !== "draft") {
      void onModeChange("draft");
    }
    chooseSelection({ kind: "project" });
    // coverReviewBookId is the gate; ProjectTitlePage opens the book studio.
  }, [coverReviewBookId]);
  // Split Sheet → Cast studio handoff (same knowledge id).
  useEffect(() => {
    if (castFocusKnowledgeId === undefined) return;
    openCharactersPrimary();
    chooseSelection({
      kind: "storyKnowledge",
      storyKnowledgeId: castFocusKnowledgeId
    });
    onCastFocusConsumed?.();
  }, [castFocusKnowledgeId]);
  // Inbox review is a first-class center workspace — leave Characters framing.
  useEffect(() => {
    if (!inboxOpen) return;
    if (!inboxOpenLeavesCharactersRail(railDestination)) return;
    setRailDestination("write");
  }, [inboxOpen, railDestination]);
  const trail = storyTrail(project, selection);
  const quickOptions = quickBuildOptions(project, selection);
  const charactersLens = railDestination === "characters";
  const castOwnsCenter = castTakesCenterWorkspace({
    charactersLens,
    inboxOpen
  });
  const exclusiveCenterOwner = inboxOwnsCenter || castOwnsCenter;
  const denseCenter = centerUsesDenseColumn(surfaceDense, exclusiveCenterOwner);
  const castSelectedKnowledge = selectedCastKnowledge(project, selection);
  const chronology = manuscriptChronology(project, selection);
  const manuscriptChronologyVisible =
    mode === "draft" &&
    !exclusiveCenterOwner &&
    chronology !== undefined;
  const projectTitlePageVisible =
    mode === "draft" &&
    !exclusiveCenterOwner &&
    selection.kind === "project";

  const timeline = sceneTimeline(project, selection);
  const selectionKey = manuscriptSelectionKey(selection);

  useEffect(() => {
    if (!manuscriptChronologyVisible) {
      onChronologySceneIdsChange?.([]);
      return;
    }
    onChronologySceneIdsChange?.(
      chronologySceneIds(manuscriptChronology(project, selection))
    );
  }, [
    manuscriptChronologyVisible,
    onChronologySceneIdsChange,
    project,
    selection,
    selectionKey
  ]);

  useEffect(() => {
    setQuickBuildOpen(false);
  }, [selectionKey, project.id]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const handleQuickBuildKey = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        if (paletteMode !== undefined) return;
        event.preventDefault();
        setQuickBuildOpen((current) => !current);
        return;
      }
      if (event.key === "Escape") {
        setQuickBuildOpen((current) => (current ? false : current));
      }
    };
    document.addEventListener("keydown", handleQuickBuildKey);
    return () => document.removeEventListener("keydown", handleQuickBuildKey);
  }, [paletteMode]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const handlePaletteKeys = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      const typingInField =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable === true;
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "p") {
        return;
      }
      // Allow ⌘P / ⌘⇧P even from inputs so jump stays global.
      event.preventDefault();
      if (event.shiftKey) {
        setPaletteMode((current) =>
          current === "command" ? undefined : "command"
        );
        return;
      }
      if (typingInField && paletteMode === undefined) {
        // still open jump — founders expect IDE-style global jump
      }
      setPaletteMode((current) => (current === "jump" ? undefined : "jump"));
    };
    document.addEventListener("keydown", handlePaletteKeys);
    return () => document.removeEventListener("keydown", handlePaletteKeys);
  }, [paletteMode]);

  function applyJumpTarget(target: WorkspaceJumpTarget): void {
    if (target.openCapture === true) {
      onOpenCapture?.();
      setPaletteMode(undefined);
      return;
    }
    if (target.openInbox === true) {
      openPlans();
      setPaletteMode(undefined);
      return;
    }
    if (target.toggleJump === true) {
      setPaletteMode("jump");
      return;
    }
    if (target.toggleChat === true) {
      openAgentSecondary();
      setPaletteMode(undefined);
      return;
    }
    if (target.capabilityId !== undefined && onChatSend !== undefined) {
      openAgentSecondary();
      void onChatSend({
        message: target.capabilityId,
        mode: chatMode,
        model: chatModel,
        effort: chatEffort
      });
      setPaletteMode(undefined);
      return;
    }
    if (target.toggleStructure === true) {
      if (structureCollapsible) {
        setStructureRail((current) => toggleMapStructureRail(current));
      } else if (!wide) {
        setCollapsedPanel((current) =>
          current === "tree" ? "none" : "tree"
        );
      }
      setPaletteMode(undefined);
      return;
    }
    if (target.selection !== undefined) {
      openExplorerPrimary();
      chooseSelection(target.selection);
      if (!wide) setCollapsedPanel("tree");
    }
    if (target.mode !== undefined) {
      openExplorerPrimary();
      requestModeChange(target.mode);
    }
    if (target.openReader === true) {
      requestOpenReader();
    }
    setPaletteMode(undefined);
  }

  function dispatchQuickBuild(option: QuickBuildOption): void {
    setQuickBuildOpen(false);
    if (!wide) setCollapsedPanel("tree");
    quickBuildRequestId.current += 1;
    setTreeAddRequest({
      selectionKey: manuscriptSelectionKey(option.parent),
      requestId: quickBuildRequestId.current
    });
  }

  const explorerCapabilities = useMemo(
    () => resolveManuscriptExplorerCapabilities(project, selection),
    [project, selection]
  );
  const explorerHeaderActions =
    explorerCapabilities === undefined
      ? ([] as const)
      : manuscriptExplorerHeaderActions(explorerCapabilities);

  function runExplorerArchive(
    target: ManuscriptSelection,
    archived: boolean
  ): void {
    const plan = planManuscriptExplorerArchive(project, target, archived);
    if (plan === undefined || busy) return;
    if (plan.confirmation === undefined) {
      void onCommand(plan.command);
      return;
    }
    Alert.alert(plan.confirmation.title, plan.confirmation.detail, [
      { text: "Cancel", style: "cancel" },
      {
        text: plan.confirmation.confirmLabel,
        style: "destructive",
        onPress: () => {
          void onCommand(plan.command);
        }
      }
    ]);
  }

  function runExplorerHeaderAction(action: ManuscriptExplorerActionId): void {
    if (busy || explorerCapabilities === undefined) return;
    switch (action) {
      case "add": {
        if (!explorerCapabilities.canAdd) return;
        treeEditorRequestId.current += 1;
        setTreeAddRequest({
          selectionKey: manuscriptSelectionKey(selection),
          requestId: treeEditorRequestId.current
        });
        return;
      }
      case "rename": {
        if (!explorerCapabilities.canRename) return;
        treeEditorRequestId.current += 1;
        setTreeRenameRequest({
          selectionKey: manuscriptSelectionKey(selection),
          requestId: treeEditorRequestId.current
        });
        return;
      }
      case "move-up":
        void reorderSelection(selection, -1);
        return;
      case "move-down":
        void reorderSelection(selection, 1);
        return;
      case "collapse-all":
        treeEditorRequestId.current += 1;
        setTreeCollapseAllRequest({
          requestId: treeEditorRequestId.current
        });
        return;
      case "archive":
      case "restore":
        return;
    }
  }

  function proposeCoverConcept(bookId: BookId): void {
    const book = project.books.find((candidate) => candidate.id === bookId);
    if (book === undefined || onChatSend === undefined) return;
    openAgentSecondary();
    void onChatSend({
      message: `Propose three cover design concepts for the book "${book.title}" in project "${project.title}". Give palette, typography mood, and central image idea. I will apply the winner into cover.concept.`,
      mode: chatMode,
      model: chatModel,
      effort: chatEffort
    });
  }

  function manuscriptSelectionSummary(
    current: ManuscriptSelection
  ): string | undefined {
    const resolved = resolveManuscriptSelection(project, current);
    if (resolved === undefined) return undefined;
    switch (current.kind) {
      case "scene":
        return resolved.scene === undefined
          ? undefined
          : `Scene: ${resolved.scene.title}`;
      case "chapter":
        return resolved.chapter === undefined
          ? undefined
          : `Chapter: ${resolved.chapter.title}`;
      case "book":
        return resolved.book === undefined
          ? undefined
          : `Book: ${resolved.book.title}`;
      case "part":
        return resolved.part === undefined
          ? undefined
          : `Part: ${resolved.part.title}`;
      case "storyKnowledge":
        return resolved.knowledge === undefined
          ? undefined
          : `Cast: ${resolved.knowledge.label}`;
      default:
        return undefined;
    }
  }

  async function addChild(
    parent: ManuscriptSelection,
    title: string
  ): Promise<boolean> {
    switch (parent.kind) {
      case "project":
        return onCommand({ type: "book.create", title });
      case "book":
        return onCommand({
          type: "part.create",
          bookId: parent.bookId,
          title
        });
      case "part":
        return onCommand({
          type: "chapter.create",
          bookId: parent.bookId,
          partId: parent.partId,
          title
        });
      case "chapter":
        return onCommand({
          type: "scene.create",
          bookId: parent.bookId,
          chapterId: parent.chapterId,
          title
        });
      case "unassigned":
        return onCommand({
          type: "scene.create",
          bookId: parent.bookId,
          title
        });
      case "storyKnowledgeRoot":
        return onCommand({
          type: "storyKnowledge.create",
          label: title,
          kind: "custom",
          authority: "planned"
        });
      default:
        return false;
    }
  }

  async function renameSelection(
    target: ManuscriptSelection,
    title: string
  ): Promise<boolean> {
    switch (target.kind) {
      case "project":
        return onCommand({ type: "project.rename", title });
      case "book":
        return onCommand({
          type: "book.update",
          bookId: target.bookId,
          title
        });
      case "part":
        return onCommand({
          type: "part.rename",
          bookId: target.bookId,
          partId: target.partId,
          title
        });
      case "chapter":
        return onCommand({
          type: "chapter.rename",
          bookId: target.bookId,
          partId: target.partId,
          chapterId: target.chapterId,
          title
        });
      case "scene":
        return onCommand({
          type: "scene.update",
          sceneId: target.sceneId,
          title
        });
      case "storyKnowledge":
        return onCommand({
          type: "storyKnowledge.update",
          storyKnowledgeId: target.storyKnowledgeId,
          label: title
        });
      default:
        return false;
    }
  }

  async function reorderSelection(
    target: ManuscriptSelection,
    offset: -1 | 1
  ): Promise<boolean> {
    const resolved = resolveManuscriptSelection(project, target);
    if (resolved === undefined) return false;
    if (target.kind === "book" && resolved.book !== undefined) {
      const index = project.books.findIndex(
        (book) => book.id === target.bookId
      );
      if (index + offset < 0 || index + offset >= project.books.length) {
        return false;
      }
      return onCommand({
        type: "book.reorder",
        bookIds: swapped(
          project.books.map((book) => book.id),
          index,
          index + offset
        )
      });
    }
    if (
      target.kind === "part" &&
      resolved.book !== undefined &&
      resolved.part !== undefined
    ) {
      const index = resolved.book.parts.findIndex(
        (part) => part.id === target.partId
      );
      if (
        index + offset < 0 ||
        index + offset >= resolved.book.parts.length
      ) {
        return false;
      }
      return onCommand({
        type: "part.reorder",
        bookId: target.bookId,
        partIds: swapped(
          resolved.book.parts.map((part) => part.id),
          index,
          index + offset
        )
      });
    }
    if (
      target.kind === "chapter" &&
      resolved.part !== undefined &&
      resolved.chapter !== undefined
    ) {
      const index = resolved.part.chapters.findIndex(
        (chapter) => chapter.id === target.chapterId
      );
      if (
        index + offset < 0 ||
        index + offset >= resolved.part.chapters.length
      ) {
        return false;
      }
      return onCommand({
        type: "chapter.reorder",
        bookId: target.bookId,
        partId: target.partId,
        chapterIds: swapped(
          resolved.part.chapters.map((chapter) => chapter.id),
          index,
          index + offset
        )
      });
    }
    if (target.kind === "scene" && resolved.scene !== undefined) {
      const source =
        resolved.chapter?.scenes ?? resolved.book?.unassignedScenes ?? [];
      const index = source.findIndex((scene) => scene.id === target.sceneId);
      if (index + offset < 0 || index + offset >= source.length) return false;
      return onCommand({
        type: "scene.move",
        sceneId: target.sceneId,
        bookId: target.bookId,
        ...(target.chapterId === undefined
          ? {}
          : { chapterId: target.chapterId }),
        position: index + offset
      });
    }
    return false;
  }

  async function moveScene(
    target: Extract<ManuscriptSelection, { kind: "scene" }>,
    destination: SceneMoveDestination
  ): Promise<boolean> {
    return onCommand({
      type: "scene.move",
      sceneId: target.sceneId,
      bookId: destination.bookId,
      ...(destination.chapterId === undefined
        ? {}
        : { chapterId: destination.chapterId }),
      position: destination.position
    });
  }

  const tree = (
    <ManuscriptTree
      addRequest={treeAddRequest}
      busy={busy}
      chrome={structureCollapsible ? "embedded" : "full"}
      collapseAllRequest={treeCollapseAllRequest}
      onSearchQueryChange={setExplorerQuery}
      searchQuery={explorerQuery}
      onAddChild={addChild}
      onArchiveAction={runExplorerArchive}
      onEnterChapter={(next) => {
        chooseSelection(next);
        onEnterChapter(next);
        if (mode !== "canvas" && mode !== "split") requestModeChange("canvas");
      }}
      onMoveScene={moveScene}
      onOpenScene={(next) => {
        openExplorerPrimary();
        chooseSelection(next);
        requestModeChange("draft");
        if (!wide) {
          setCollapsedPanel("none");
          setContextDockOpen(false);
        }
      }}
      onRename={renameSelection}
      onReorder={reorderSelection}
      onSelectionChange={(next) => {
        if (primarySideView !== "explorer") setPrimarySideView("explorer");
        chooseSelection(next);
      }}
      project={project}
      renameRequest={treeRenameRequest}
      selection={selection}
    />
  );
  // Explorer stays the only wide primary content; Cast hosts in the center.
  const primarySideContent = tree;
  const inspector = (
    <SelectionInspector
      busy={busy}
      onClose={wide ? undefined : () => setCollapsedPanel("none")}
      onCommand={onCommand}
      onReorder={reorderSelection}
      project={project}
      selectedSceneId={selectedSceneId}
      selection={selection}
    />
  );
  const draftHomeVisible =
    mode === "draft" &&
    (projectTitlePageVisible || manuscriptChronologyVisible);
  const showDraftPane = workspaceShowsDraftPane({
    mode,
    hasSelectedScene: selectedScene !== undefined,
    draftHomeVisible
  });
  const showCanvasPane = canvasVisible && !exclusiveCenterOwner;
  const splitPanesActive = workspaceSplitPanesActive({
    mode,
    wide,
    showCanvas: showCanvasPane,
    showDraft: showDraftPane
  });
  const draftDeskActive =
    mode === "draft" && selection.kind === "scene" && selectedScene !== undefined;
  const draftKnowledge =
    selectedScene === undefined
      ? []
      : project.storyKnowledge.filter(
          (knowledge) =>
            knowledge.archivedAt === undefined &&
            knowledge.linkedSceneIds.includes(selectedScene.id)
        );
  const draftPresentation: DraftWorkspacePresentation = {
    contextDockOpen,
    focusHalo,
    historyOpen: draftDockTab === "history",
    narrow,
    ...(quickOptions.length > 0 && quickBuildVisible
      ? {
          quickBuild: {
            open: quickBuildOpen,
            options: quickOptions,
            onOpenChange: setQuickBuildOpen,
            onSelect: dispatchQuickBuild
          }
        }
      : {}),
    onContextDockOpenChange: setContextDockOpen,
    onFocusHaloChange: setFocusHalo,
    onHistoryOpenChange: (open) => {
      setDraftDockTab(open ? "history" : "brief");
      if (open) setContextDockOpen(true);
    }
  };
  const draftContextDock = (
    <View accessibilityLabel="Draft Context Dock" style={styles.draftDock}>
      <View style={styles.draftDockHeading}>
        <View style={styles.draftDockHeadingCopy}>
          <Text style={styles.draftDockEyebrow}>Context Dock</Text>
          <Text numberOfLines={1} style={styles.draftDockTitle}>
            {selectedScene?.title ?? "Scene"}
          </Text>
        </View>
        <Button
          label="Close Context Dock"
          onPress={() => setContextDockOpen(false)}
        />
      </View>
      <View accessibilityLabel="Draft Context Dock tabs" style={styles.draftDockTabs}>
        {(["brief", "story", "canvas", "history"] as const).map((tab) => (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: draftDockTab === tab }}
            key={tab}
            onPress={() => setDraftDockTab(tab)}
            style={({ pressed }) => [
              styles.draftDockTab,
              draftDockTab === tab && styles.draftDockTabSelected,
              pressed && styles.pressed
            ]}
          >
            <Text
              style={[
                styles.draftDockTabText,
                draftDockTab === tab && styles.draftDockTabTextSelected
              ]}
            >
              {tab[0]?.toUpperCase()}
              {tab.slice(1)}
            </Text>
          </Pressable>
        ))}
      </View>
      {draftDockTab === "brief" ? (
        inspector
      ) : draftDockTab === "story" ? (
        <ScrollView contentContainerStyle={styles.draftDockBody}>
          <Text style={styles.draftDockSectionTitle}>Story in this scene</Text>
          {draftKnowledge.length === 0 ? (
            <Text style={styles.draftDockText}>
              No active story records are linked to this scene yet.
            </Text>
          ) : (
            draftKnowledge.map((knowledge) => (
              <View key={knowledge.id} style={styles.draftDockCard}>
                <Text style={styles.draftDockCardTitle}>{knowledge.label}</Text>
                <Text style={styles.draftDockText}>
                  {knowledge.kind} · {knowledge.authority}
                </Text>
                {knowledge.notes === undefined ? null : (
                  <Text style={styles.draftDockText}>{knowledge.notes}</Text>
                )}
              </View>
            ))
          )}
        </ScrollView>
      ) : draftDockTab === "canvas" ? (
        <View style={styles.draftDockBody}>
          <Text style={styles.draftDockSectionTitle}>Canvas context</Text>
          <Text style={styles.draftDockText}>
            Open Canvas or Split from the project rail to review spatial
            placement and directed links for this same canonical scene.
          </Text>
          <Button label="Open Canvas" onPress={() => requestModeChange("canvas")} />
          {wide ? (
            <Button label="Open Split" onPress={() => requestModeChange("split")} />
          ) : null}
        </View>
      ) : (
        <View style={styles.draftDockBody}>
          <Text style={styles.draftDockSectionTitle}>Draft History</Text>
          <Text style={styles.draftDockText}>
            Timeline, named variants, compare, and restore are open in the
            drawer below the manuscript page. The editor stays mounted.
          </Text>
        </View>
      )}
    </View>
  );
  const centerTitle = projectTitlePageVisible
    ? project.title
    : manuscriptChronologyVisible
      ? (chronology?.title ?? "Manuscript")
      : drillScope.kind === "scene"
        ? (drillTrail[drillTrail.length - 1]?.label ?? selectedScene?.title)
        : drillScope.kind === "chapter"
          ? (drillTrail[drillTrail.length - 1]?.label ?? "Chapter lens")
          : (selectedScene?.title ?? "Shape the manuscript");
  const centerEyebrow = projectTitlePageVisible
    ? "Title page"
    : manuscriptChronologyVisible
      ? (chronology?.eyebrow ?? "Manuscript")
      : mode === "draft"
        ? "Focused Draft"
        : mode === "canvas"
          ? "Story Canvas"
          : "Draft + Canvas";

  const storyTrailNodes = (
    <View accessibilityLabel="Story Trail" style={styles.storyTrail}>
      {trail.map((item, index) => {
        const current = index === trail.length - 1;
        const key = manuscriptSelectionKey(item.selection);
        return (
          <View key={key} style={styles.storyTrailItem}>
            {index === 0 ? null : (
              <Text style={styles.storyTrailDivider}>›</Text>
            )}
            <Pressable
              accessibilityLabel={
                current
                  ? `Story Trail, current ${item.role} ${item.label}`
                  : `Story Trail, go to ${item.role} ${item.label}`
              }
              accessibilityRole="button"
              accessibilityState={{ disabled: current }}
              disabled={current || busy}
              onPress={() => chooseSelection(item.selection)}
              style={({ pressed }) => [
                styles.storyTrailButton,
                current && styles.storyTrailCurrent,
                pressed && styles.pressed
              ]}
            >
              <Text style={styles.storyTrailRole}>{item.role}</Text>
              <Text
                numberOfLines={1}
                style={[
                  styles.storyTrailText,
                  current && styles.storyTrailTextCurrent
                ]}
              >
                {item.label}
              </Text>
            </Pressable>
          </View>
        );
      })}
    </View>
  );

  // Map chrome must show Canvas drill scope — not manuscript selection.
  // Selecting a scene card syncs the tree, but must not look like Enter layer.
  const mapLocationLabel =
    drillScope.kind === "project"
      ? `Project board · ${project.title}`
      : drillScope.kind === "chapter"
        ? "Inside chapter lens"
        : "Inside scene lens";

  const mapScopeTrailNodes = (
    <View accessibilityLabel="Canvas scope trail" style={styles.mapTrail}>
      <Text style={styles.mapTrailEyebrow}>{mapLocationLabel}</Text>
      <View style={styles.storyTrail}>
        {drillTrail.map((crumb, index) => {
          const current = index === drillTrail.length - 1;
          return (
            <View key={crumb.focusKey} style={styles.storyTrailItem}>
              {index === 0 ? null : (
                <Text style={styles.storyTrailDivider}>›</Text>
              )}
              <Pressable
                accessibilityLabel={
                  current
                    ? `Canvas scope, current ${crumb.label}`
                    : `Canvas scope, go to ${crumb.label}`
                }
                accessibilityRole="button"
                accessibilityState={{ disabled: current }}
                disabled={current || busy}
                onPress={() => onDrillTo?.(crumb.scope)}
                style={({ pressed }) => [
                  styles.storyTrailButton,
                  current && styles.storyTrailCurrent,
                  pressed && styles.pressed
                ]}
              >
                <Text
                  numberOfLines={1}
                  style={[
                    styles.storyTrailText,
                    current && styles.storyTrailTextCurrent
                  ]}
                >
                  {crumb.label}
                </Text>
              </Pressable>
            </View>
          );
        })}
        {canvasVisible &&
        selectedScene !== undefined &&
        drillScope.kind === "project" ? (
          <View style={styles.storyTrailItem}>
            <Text style={styles.mapSelectionHint}>
              · card selected: {selectedScene.title} · Enter to dive
            </Text>
          </View>
        ) : null}
        {workflowLens !== "outline" ? (
          <View style={styles.storyTrailItem}>
            <Text style={styles.mapSelectionHint}>
              · lens {workflowLensLabel(workflowLens)}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );

  return (
    <View style={styles.screen}>
      <View
        style={[
          styles.topbar,
          surfaceDense && styles.topbarMap,
          narrow && styles.topbarNarrow
        ]}
      >
        <View accessibilityLabel={`Workspace for ${profileDisplayName}`} style={styles.topbarLeft}>
          <Button
            disabled={busy}
            label="← Projects"
            onPress={handleProjectBack}
          />
          {structureCollapsible ? (
            <Pressable
              accessibilityLabel={
                structureCollapsed
                  ? "Expand manuscript · ["
                  : "Collapse manuscript · ["
              }
              accessibilityRole="button"
              disabled={busy}
              onPress={() =>
                setStructureRail((current) => toggleMapStructureRail(current))
              }
              style={({ pressed }) => [
                styles.structureTopToggle,
                pressed && styles.pressed,
                busy && styles.disabled
              ]}
            >
              <Text style={styles.structureTopToggleGlyph}>
                {structureCollapsed ? "»|" : "|«"}
              </Text>
            </Pressable>
          ) : null}
          {wide && !focusHalo ? (
            <View style={styles.topbarTrail}>
              {canvasVisible ? mapScopeTrailNodes : storyTrailNodes}
            </View>
          ) : (
            <View style={styles.topbarCopy}>
              <Text
                numberOfLines={1}
                style={[
                  styles.topbarTitle,
                  surfaceDense && styles.topbarTitleMap
                ]}
              >
                {project.title}
              </Text>
            </View>
          )}
        </View>
        {focusHalo ? null : (
          <View
            pointerEvents="box-none"
            style={[
              styles.topbarCenter,
              narrow && styles.topbarCenterNarrow
            ]}
          >
            <WorkspaceTopSearch
              busy={busy}
              onExplorerQueryChange={setExplorerQuery}
              onPick={applyJumpTarget}
              targets={unifiedSearchTargets}
            />
          </View>
        )}
        <View
          style={[styles.topbarRight, narrow && styles.topbarRightNarrow]}
        >
          {allChangesIdle ? (
            <Text
              accessibilityLiveRegion="polite"
              style={styles.aggregateStatus}
            >
              {surfaceDense ? "Saved" : "All changes saved"}
            </Text>
          ) : null}
          {surfaceDense || wide ? null : (
            <>
              <Button
                label={
                  collapsedPanel === "tree"
                    ? "Hide manuscript tree"
                    : "Show manuscript tree"
                }
                onPress={() => {
                  setCollapsedPanel((current) => {
                    const next = current === "tree" ? "none" : "tree";
                    if (next === "tree") setContextDockOpen(false);
                    return next;
                  });
                }}
                selected={collapsedPanel === "tree"}
              />
              <Button
                label={
                  draftDeskActive
                    ? contextDockOpen
                      ? "Hide Context Dock"
                      : "Show Context Dock"
                    : collapsedPanel === "inspector"
                      ? "Hide inspector"
                      : "Show inspector"
                }
                onPress={() => {
                  if (draftDeskActive) {
                    setContextDockOpen((open) => {
                      const next = !open;
                      if (next) setCollapsedPanel("none");
                      return next;
                    });
                    return;
                  }
                  setCollapsedPanel((current) =>
                    current === "inspector" ? "none" : "inspector"
                  );
                }}
                selected={
                  draftDeskActive
                    ? contextDockOpen
                    : collapsedPanel === "inspector"
                }
              />
            </>
          )}
          {surfaceDense ? null : (
            <Button disabled={busy} label="Refresh" onPress={onRefresh} />
          )}
          {surfaceDense || onOpenReader === undefined ? null : (
            <Button
              disabled={busy || selectedSceneId === undefined}
              label="Reader"
              onPress={requestOpenReader}
            />
          )}
          <Button disabled={busy} label="Sign out" onPress={onSignOut} />
        </View>
      </View>

      {narrow ? (
        <View
          accessibilityLabel="Writing workspace modes"
          style={styles.narrowModes}
        >
          <Button
            label="Project"
            onPress={() => {
              setContextDockOpen(false);
              setCollapsedPanel("tree");
            }}
            selected={collapsedPanel === "tree"}
          />
          <Button
            label="Draft"
            onPress={() => {
              setCollapsedPanel("none");
              setContextDockOpen(false);
              requestModeChange("draft");
            }}
            selected={mode === "draft" && collapsedPanel === "none"}
          />
          <Button
            label="Canvas"
            onPress={() => {
              setCollapsedPanel("none");
              requestModeChange("canvas");
            }}
            selected={mode === "canvas" && collapsedPanel === "none"}
          />
          {onOpenInbox === undefined ? null : (
            <Button
              label={NARROW_INBOX_TAB_LABEL}
              onPress={openPlans}
              selected={inboxOpen}
            />
          )}
          {onOpenReader === undefined ? null : (
            <Button
              disabled={busy || selectedSceneId === undefined}
              label="Reader"
              onPress={requestOpenReader}
            />
          )}
          {onOpenSettings === undefined ? null : (
            <Button
              label="Settings"
              onPress={onOpenSettings}
              selected={settingsOpen}
            />
          )}
        </View>
      ) : null}

      <View
        style={[
          styles.workspace,
          narrow && styles.workspaceNarrow
        ]}
      >
        {!narrow && !focusHalo ? (
          <View
            accessibilityLabel="Project areas"
            style={styles.rail}
          >
            <Text style={styles.railProject}>gw</Text>
            <RailButton
              disabled={busy}
              icon={(tone) => <ExplorerRailIcon tone={tone} />}
              label="Explorer"
              onPress={() => {
                openExplorerPrimary();
                setRailDestination("write");
                if (structureCollapsible) setStructureRail("expanded");
              }}
              selected={
                primarySideView === "explorer" &&
                !inboxOpen &&
                !charactersLens
              }
            />
            {onOpenInbox === undefined ? null : (
              <RailButton
                disabled={busy}
                icon={(tone) => <DreamsRailIcon tone={tone} />}
                label={NARROW_INBOX_TAB_LABEL}
                onPress={openPlans}
                selected={inboxOpen}
              />
            )}
            <RailButton
              disabled={busy}
              icon={(tone) => <CharactersRailIcon tone={tone} />}
              label="Characters"
              onPress={openCharactersPrimary}
              selected={charactersLens}
            />
            <View style={styles.railDivider} />
            <RailButton
              disabled={busy}
              icon={(tone) => <DraftRailIcon tone={tone} />}
              label="Draft"
              onPress={() => {
                openExplorerPrimary();
                setRailDestination("write");
                requestModeChange("draft");
              }}
              selected={
                mode === "draft" &&
                !charactersLens &&
                primarySideView === "explorer" &&
                !inboxOpen
              }
            />
            <RailButton
              disabled={busy}
              icon={(tone) => <CanvasRailIcon tone={tone} />}
              label="Canvas"
              onPress={() => {
                openExplorerPrimary();
                setRailDestination("write");
                requestModeChange("canvas");
              }}
              selected={mode === "canvas"}
            />
            {wide ? (
              <RailButton
                disabled={busy}
                icon={(tone) => <SplitRailIcon tone={tone} />}
                label="Split"
                onPress={() => {
                  openExplorerPrimary();
                  setRailDestination("write");
                  requestModeChange("split");
                }}
                selected={mode === "split"}
              />
            ) : null}
            {onOpenReader === undefined ? null : (
              <RailButton
                disabled={busy || selectedSceneId === undefined}
                icon={(tone) => <ReaderRailIcon tone={tone} />}
                label="Reader"
                onPress={requestOpenReader}
                selected={false}
              />
            )}
            {timeline.length > 0 &&
            mode === "draft" &&
            !charactersLens &&
            primarySideView === "explorer" ? (
              <>
                <View style={styles.railDivider} />
                <View
                  accessibilityLabel="Scene timeline"
                  style={styles.railTimeline}
                >
                  {timeline.map((item) => (
                    <Pressable
                      accessibilityLabel={`Scene ${item.index} of ${item.total}: ${item.title}`}
                      accessibilityRole="button"
                      accessibilityState={{
                        selected: item.sceneId === selectedSceneId
                      }}
                      disabled={busy}
                      key={item.sceneId}
                      onPress={() => {
                        openExplorerPrimary();
                        setRailDestination("write");
                        chooseSelection(item.selection);
                      }}
                      style={({ pressed }) => [
                        styles.railTimelineItem,
                        item.sceneId === selectedSceneId &&
                          styles.railTimelineItemSelected,
                        pressed && styles.pressed,
                        busy && styles.disabled
                      ]}
                      {...({ title: item.title } as object)}
                    >
                      <Text
                        style={[
                          styles.railTimelineIndex,
                          item.sceneId === selectedSceneId &&
                            styles.railTextSelected
                        ]}
                      >
                        {item.index}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </>
            ) : null}
            <View style={styles.railSpacer} />
            {onChatSend === undefined ? null : (
              <RailButton
                disabled={busy}
                icon={(tone) => <ChatRailIcon tone={tone} />}
                label="Agent"
                onPress={() => {
                  if (secondaryOpen && secondaryTab === "agent") {
                    setSecondaryOpen(false);
                    return;
                  }
                  openAgentSecondary();
                }}
                selected={secondaryOpen && secondaryTab === "agent"}
              />
            )}
            <RailButton
              disabled={busy}
              icon={(tone) => <JumpRailIcon tone={tone} />}
              label="Jump · ⌘P"
              onPress={() =>
                setPaletteMode((current) =>
                  current === "jump" ? undefined : "jump"
                )
              }
              selected={paletteMode === "jump"}
            />
            <RailButton
              disabled={busy}
              icon={(tone) => <HistoryRailIcon tone={tone} />}
              label="History"
              onPress={() => {
                if (canvasVisible && onCanvasHistoryOpenChange !== undefined) {
                  onCanvasHistoryOpenChange(!canvasHistoryOpen);
                  onActivityHistoryOpenChange?.(false);
                  return;
                }
                onActivityHistoryOpenChange?.(!activityHistoryOpen);
              }}
              selected={
                canvasVisible ? canvasHistoryOpen : activityHistoryOpen
              }
            />
            {onOpenSettings === undefined ? null : (
              <RailButton
                disabled={busy}
                icon={(tone) => <SettingsRailIcon tone={tone} />}
                label="Settings"
                onPress={onOpenSettings}
                selected={settingsOpen}
              />
            )}
            <RailButton
              disabled={busy || !structureCollapsible}
              icon={(tone) => <StructureRailIcon tone={tone} />}
              label="Primary side · ["
              onPress={() =>
                setStructureRail((current) => toggleMapStructureRail(current))
              }
              selected={structureCollapsible && structureRail === "expanded"}
            />
          </View>
        ) : null}

        <View
          {...(structureCollapsible && structureRail === "collapsed"
            ? { accessibilityLabel: "Collapsed manuscript structure" }
            : {})}
          style={[
            styles.treeRegion,
            structureCollapsible &&
              ({
                width: structureWidth,
                transition:
                  "width 380ms cubic-bezier(0.22, 1, 0.36, 1), background-color 280ms ease"
              } as object),
            structureCollapsible &&
              structureRail === "collapsed" &&
              styles.treeRegionCollapsed,
            !wide && !structureCollapsible && styles.collapsedRegion,
            narrow && styles.narrowRegion,
            (focusHalo || (!wide && collapsedPanel !== "tree")) &&
              styles.regionHidden
          ]}
        >
          {structureCollapsible ? (
            structureRail === "collapsed" ? (
              <View style={styles.structureCollapsedRail}>
                <Pressable
                  accessibilityLabel="Expand manuscript · ["
                  accessibilityRole="button"
                  disabled={busy}
                  onPress={() => setStructureRail("expanded")}
                  style={({ pressed }) => [
                    styles.structureToggle,
                    pressed && styles.pressed,
                    busy && styles.disabled
                  ]}
                >
                  <Text style={styles.structureToggleGlyph}>»|</Text>
                </Pressable>
                <Text style={styles.structureCollapsedHint}>
                  {primarySideLabel(primarySideView)}
                </Text>
              </View>
            ) : (
              <View style={styles.structureExpandedShell}>
                <View style={styles.structureExpandedHeader}>
                  <Text style={styles.structureExpandedLabel}>
                    {primarySideLabel(primarySideView)}
                  </Text>
                  <View style={styles.structureExpandedHeaderTrailing}>
                    {primarySideView === "explorer"
                      ? explorerHeaderActions.map((action) => {
                          const Icon = explorerHeaderIcon(action);
                          if (Icon === undefined) return null;
                          return (
                            <Pressable
                              accessibilityLabel={manuscriptExplorerActionLabel(
                                action,
                                explorerCapabilities
                              )}
                              accessibilityRole="button"
                              disabled={busy}
                              key={action}
                              onPress={() => runExplorerHeaderAction(action)}
                              style={({ pressed }) => [
                                styles.explorerHeaderAction,
                                pressed && styles.pressed,
                                busy && styles.disabled
                              ]}
                            >
                              <Icon
                                color={colors.muted}
                                size={13}
                                weight="regular"
                              />
                            </Pressable>
                          );
                        })
                      : null}
                    <Pressable
                      accessibilityLabel="Collapse primary side · ["
                      accessibilityRole="button"
                      disabled={busy}
                      onPress={() => setStructureRail("collapsed")}
                      style={({ pressed }) => [
                        styles.structureToggle,
                        pressed && styles.pressed,
                        busy && styles.disabled
                      ]}
                    >
                      <Text style={styles.structureToggleGlyph}>|«</Text>
                    </Pressable>
                  </View>
                </View>
                <View style={styles.structureTreeHost}>
                  {primarySideContent}
                </View>
              </View>
            )
          ) : (
            primarySideContent
          )}
          {structureCollapsible && structureRail === "expanded" ? (
            <View
              accessibilityLabel="Resize manuscript structure"
              accessibilityRole="adjustable"
              {...structureResizeResponder.panHandlers}
              style={styles.structureResizeHandle}
            />
          ) : null}
        </View>

        {(() => {
          // Inbox / Cast own their headings; never compete with Write trail/hero.
          const centerChrome =
            focusHalo || exclusiveCenterOwner ? null : (
            <>
              {!wide ? (
                <View style={styles.storyTrailRow}>
                  {storyTrailNodes}
                  {mode === "draft" ||
                  quickOptions.length === 0 ||
                  !quickBuildVisible ? null : (
                    <View style={styles.quickBuild}>
                      <Pressable
                        accessibilityLabel="Quick Build: add to the manuscript"
                        accessibilityRole="button"
                        accessibilityState={{ expanded: quickBuildOpen }}
                        disabled={busy}
                        onPress={() =>
                          setQuickBuildOpen((current) => !current)
                        }
                        style={({ pressed }) => [
                          styles.quickBuildButton,
                          quickBuildOpen && styles.buttonSelected,
                          pressed && styles.pressed,
                          busy && styles.disabled
                        ]}
                      >
                        <Text style={styles.quickBuildButtonText}>＋ Add</Text>
                      </Pressable>
                      {quickBuildOpen ? (
                        <View
                          accessibilityLabel="Quick Build options"
                          style={styles.quickBuildMenu}
                        >
                          {quickOptions.map((option) => (
                            <Pressable
                              accessibilityLabel={option.label}
                              accessibilityRole="menuitem"
                              disabled={busy}
                              key={option.id}
                              onPress={() => dispatchQuickBuild(option)}
                              style={({ pressed }) => [
                                styles.quickBuildOption,
                                pressed && styles.pressed
                              ]}
                            >
                              <Text style={styles.quickBuildOptionLabel}>
                                {option.label}
                              </Text>
                              <Text
                                numberOfLines={2}
                                style={styles.quickBuildOptionDetail}
                              >
                                {option.detail}
                              </Text>
                            </Pressable>
                          ))}
                          <Text style={styles.quickBuildHint}>
                            Titles commit with Enter in the manuscript tree.
                            Escape cancels.
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  )}
                </View>
              ) : mode === "draft" ||
                quickOptions.length === 0 ||
                !quickBuildVisible ? null : (
                <View style={styles.storyTrailRow}>
                  <View style={styles.quickBuild}>
                    <Pressable
                      accessibilityLabel="Quick Build: add to the manuscript"
                      accessibilityRole="button"
                      accessibilityState={{ expanded: quickBuildOpen }}
                      disabled={busy}
                      onPress={() =>
                        setQuickBuildOpen((current) => !current)
                      }
                      style={({ pressed }) => [
                        styles.quickBuildButton,
                        quickBuildOpen && styles.buttonSelected,
                        pressed && styles.pressed,
                        busy && styles.disabled
                      ]}
                    >
                      <Text style={styles.quickBuildButtonText}>＋ Add</Text>
                    </Pressable>
                    {quickBuildOpen ? (
                      <View
                        accessibilityLabel="Quick Build options"
                        style={styles.quickBuildMenu}
                      >
                        {quickOptions.map((option) => (
                          <Pressable
                            accessibilityLabel={option.label}
                            accessibilityRole="menuitem"
                            disabled={busy}
                            key={option.id}
                            onPress={() => dispatchQuickBuild(option)}
                            style={({ pressed }) => [
                              styles.quickBuildOption,
                              pressed && styles.pressed
                            ]}
                          >
                            <Text style={styles.quickBuildOptionLabel}>
                              {option.label}
                            </Text>
                            <Text
                              numberOfLines={2}
                              style={styles.quickBuildOptionDetail}
                            >
                              {option.detail}
                            </Text>
                          </Pressable>
                        ))}
                        <Text style={styles.quickBuildHint}>
                          Titles commit with Enter in the manuscript tree.
                          Escape cancels.
                        </Text>
                      </View>
                    ) : null}
                  </View>
                </View>
              )}
              {surfaceDense ||
              projectTitlePageVisible ||
              manuscriptChronologyVisible ? null : (
                <View style={styles.centerHeading}>
                  <View style={styles.centerHeadingCopy}>
                    <Text style={styles.centerEyebrow}>{centerEyebrow}</Text>
                    <Text style={styles.centerTitle}>{centerTitle}</Text>
                  </View>
                  <Text style={styles.centerRule}>
                    Tree order is canonical. Canvas relationships never reorder
                    Draft.
                  </Text>
                </View>
              )}
              {canvasVisible && !mapDense ? (
                <CanvasDrillBar
                  busy={busy}
                  canvasVisible={canvasVisible}
                  drillStack={drillStack}
                  onDrillBack={onDrillBack}
                  onDrillTo={onDrillTo}
                  onWorkflowLensChange={onWorkflowLensChange}
                  project={project}
                  workflowLens={workflowLens}
                />
              ) : null}
            </>
          );
          const workSurface = (
          <View
            ref={splitSurfaceRef}
            style={[
              styles.workSurface,
              (surfaceDense || exclusiveCenterOwner) && styles.workSurfaceMap,
              splitPanesActive && styles.workSurfaceSplit,
              narrow && styles.workSurfaceNarrow
            ]}
          >
            {inboxOwnsCenter ? (
              <View
                key="inbox"
                style={[styles.workSurfacePane, styles.workSurfaceInbox]}
              >
                {renderInbox?.(inboxPresentation)}
              </View>
            ) : castOwnsCenter ? (
              <View
                key="cast"
                style={[styles.workSurfacePane, styles.workSurfaceInbox]}
              >
                <CastRelationshipsStudio
                  busy={busy}
                  characterVisualJob={characterVisualJob}
                  imageAvailableModels={imageAvailableModels}
                  preferredImageModelId={preferredImageModelId}
                  layout={narrow ? "narrow" : "wide"}
                  onApplyCharacterVisual={onApplyCharacterVisual}
                  onCommand={onCommand}
                  onOpenRecord={(storyKnowledgeId) => {
                    chooseSelection({
                      kind: "storyKnowledge",
                      storyKnowledgeId
                    });
                  }}
                  onOpenScene={(sceneId) => {
                    const next = sceneSelection(project, sceneId);
                    if (next === undefined) return;
                    setRailDestination("write");
                    chooseSelection(next);
                    requestModeChange("draft");
                  }}
                  onResolveCharacterVisualDisplayUrl={
                    onResolveCharacterVisualDisplayUrl
                  }
                  onSelectKnowledge={(storyKnowledgeId) => {
                    if (storyKnowledgeId === undefined) {
                      chooseSelection({ kind: "storyKnowledgeRoot" });
                      return;
                    }
                    chooseSelection({
                      kind: "storyKnowledge",
                      storyKnowledgeId
                    });
                  }}
                  onStartCharacterVisualJob={onStartCharacterVisualJob}
                  onOpenSettings={onOpenSettings}
                  project={project}
                  selectedKnowledgeId={castSelectedKnowledge?.id}
                />
              </View>
            ) : (
              <>
            {showCanvasPane ? (
              <View
                key="canvas"
                style={[
                  styles.workSurfacePane,
                  splitPanesActive
                    ? { flex: splitRatio, flexBasis: 0 }
                    : undefined
                ]}
              >
                {renderCanvas ?? (
                  <View style={styles.empty}>
                    <Text style={styles.emptyTitle}>Canvas unavailable</Text>
                    <Text style={styles.emptyText}>
                      Refresh the project to load its acknowledged board.
                    </Text>
                  </View>
                )}
              </View>
            ) : null}
            {splitPanesActive ? (
              <View
                accessibilityLabel="Resize Draft and Canvas panes"
                accessibilityRole="adjustable"
                {...splitDividerResponder.panHandlers}
                style={styles.splitDivider}
              >
                <View style={styles.splitDividerGrip} />
              </View>
            ) : null}
            {showDraftPane ? (
              <View
                key="draft"
                style={[
                  styles.workSurfacePane,
                  splitPanesActive
                    ? { flex: 1 - splitRatio, flexBasis: 0 }
                    : undefined
                ]}
              >
                {projectTitlePageVisible ? (
                  <ProjectTitlePage
                    busy={busy}
                    coverOptionsJob={coverOptionsJob}
                    coverReviewBookId={coverReviewBookId}
                    imageAvailableModels={imageAvailableModels}
                    preferredImageModelId={preferredImageModelId}
                    onApplyCoverImage={onApplyCoverImage}
                    onCommand={onCommand}
                    onCoverReviewConsumed={onCoverReviewConsumed}
                    onGenerateCoverPreview={onGenerateCoverPreview}
                    onOpenBook={(bookSelection) => {
                      setRailDestination("write");
                      chooseSelection(bookSelection);
                    }}
                    onProposeCoverConcept={
                      onChatSend === undefined ? undefined : proposeCoverConcept
                    }
                    onResolveCoverDisplayUrl={onResolveCoverDisplayUrl}
                    onOpenSettings={onOpenSettings}
                    onStartCoverOptionsJob={onStartCoverOptionsJob}
                    project={project}
                  />
                ) : manuscriptChronologyVisible && chronology !== undefined ? (
                  <ManuscriptChronologyDesk
                    busy={busy}
                    onOpenScene={(sceneSelectionNext) => {
                      setRailDestination("write");
                      chooseSelection(sceneSelectionNext);
                      requestModeChange("draft");
                    }}
                    project={project}
                    sceneProseById={sceneProseById}
                    selection={selection}
                  />
                ) : selectedScene !== undefined ? (
                  (renderDraft?.(selectedScene, draftPresentation) ?? null)
                ) : null}
              </View>
            ) : null}
              </>
            )}
          </View>
          );
          // Dense Draft/Canvas/Split or Inbox: bounded flex column (no page ScrollView).
          if (denseCenter) {
            return (
              <View style={[styles.center, styles.centerMap]}>
                {error === undefined ? null : (
                  <View accessibilityRole="alert" style={styles.error}>
                    <Text style={styles.errorText}>{error}</Text>
                  </View>
                )}
                {centerChrome}
                {workSurface}
              </View>
            );
          }
          return (
            <ScrollView
              contentContainerStyle={[
                styles.centerContent,
                narrow && styles.centerContentNarrow
              ]}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator
              style={styles.center}
            >
              {error === undefined ? null : (
                <View accessibilityRole="alert" style={styles.error}>
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              )}
              {centerChrome}
              {workSurface}
            </ScrollView>
          );
        })()}

        {secondaryOpen && !focusHalo && !narrow ? (
          <View
            accessibilityLabel="Resize secondary panel"
            accessibilityRole="adjustable"
            {...secondaryResizeResponder.panHandlers}
            style={styles.secondaryResizeHandle}
          />
        ) : null}

        <View
          style={[
            styles.inspectorRegion,
            !wide && styles.collapsedRegion,
            narrow && styles.narrowRegion,
            (focusHalo ||
              !secondaryOpen ||
              (!wide && collapsedPanel !== "inspector")) &&
              styles.regionHidden
          ]}
        >
          {onChatSend === undefined ? (
            draftDeskActive ? draftContextDock : inspector
          ) : (
            <WorkspaceSecondaryPanel
              agent={
                <WorkspaceChatPanel
                  availableModels={chatAvailableModels}
                  busy={busy}
                  effort={chatEffort}
                  messages={chatMessages}
                  mode={chatMode}
                  model={chatModel}
                  onClose={() => setSecondaryTab("properties")}
                  onEffortChange={(next) => onChatEffortChange?.(next)}
                  onModeChange={(next) => onChatModeChange?.(next)}
                  onModelChange={(next) => onChatModelChange?.(next)}
                  onOpenSettings={onOpenSettings}
                  onSend={(input) => onChatSend?.(input)}
                  onToolkitAction={
                    onAgentToolkitAction === undefined
                      ? undefined
                      : handleAgentToolkitAction
                  }
                  open
                  providerConfigured={chatProviderConfigured}
                  selectionSummary={manuscriptSelectionSummary(selection)}
                  variant="docked"
                />
              }
              onCollapse={() => setSecondaryOpen(false)}
              onTabChange={(tab) => {
                setSecondaryTab(tab);
                if (tab === "properties") setContextDockOpen(true);
              }}
              properties={draftDeskActive ? draftContextDock : inspector}
              tab={secondaryTab}
              width={wide ? secondaryWidthPx : shell.inspectorWidth}
            />
          )}
        </View>

        {!secondaryOpen && !focusHalo && !narrow && onChatSend !== undefined ? (
          <Pressable
            accessibilityLabel="Expand secondary panel"
            accessibilityRole="button"
            onPress={() => {
              setSecondaryOpen(true);
              setSecondaryTab("agent");
            }}
            style={({ pressed }) => [
              styles.secondaryCollapsedRail,
              pressed && styles.pressed
            ]}
          >
            <Text style={styles.secondaryCollapsedHint}>⟨</Text>
          </Pressable>
        ) : null}

      </View>

      {paletteMode === undefined ? null : (
        <WorkspaceQuickNav
          chatBusy={busy}
          chatCapabilities={chatCapabilities}
          chatMessages={chatMessages}
          mode={paletteMode}
          onChatSend={
            onChatSend === undefined
              ? undefined
              : (message) =>
                  onChatSend({
                    message,
                    mode: chatMode,
                    model: chatModel,
                    effort: chatEffort
                  })
          }
          onClose={() => setPaletteMode(undefined)}
          onPick={applyJumpTarget}
          targets={jumpTargets}
        />
      )}

      {activityHistoryOpen && !canvasVisible ? (
        <View
          accessibilityLabel="Notifications and history"
          style={styles.activityHistoryRoot}
        >
          <Pressable
            accessibilityLabel="Dismiss history"
            accessibilityRole="button"
            onPress={() => onActivityHistoryOpenChange?.(false)}
            style={styles.activityHistoryBackdrop}
          />
          <View style={styles.activityHistoryCard}>
            <View style={styles.activityHistoryHeader}>
              <Pressable
                accessibilityLabel="Close history"
                accessibilityRole="button"
                onPress={() => onActivityHistoryOpenChange?.(false)}
                style={({ pressed }) => [
                  styles.activityHistoryClose,
                  pressed && styles.pressed
                ]}
              >
                <Text style={styles.activityHistoryCloseText}>×</Text>
              </Pressable>
            </View>
            {activityHistory.length === 0 ? (
              <View style={styles.activityHistoryEmpty} />
            ) : (
              <View style={styles.activityHistoryList}>
                {activityHistory.map((entry) => (
                  <View
                    key={`${entry.id}:${entry.createdAt}`}
                    style={[
                      styles.activityHistoryRow,
                      entry.tone === "success" &&
                        styles.activityHistoryRowSuccess,
                      entry.tone === "warning" &&
                        styles.activityHistoryRowWarning,
                      entry.tone === "error" && styles.activityHistoryRowError
                    ]}
                  >
                    <View style={styles.activityHistoryCopy}>
                      <Text style={styles.activityHistoryRowTitle}>
                        {entry.title}
                      </Text>
                      <Text style={styles.activityHistoryRowDetail}>
                        {entry.detail}
                      </Text>
                      <Text style={styles.activityHistoryRowTime}>
                        {new Date(entry.createdAt).toLocaleTimeString()}
                      </Text>
                    </View>
                    <View style={styles.activityHistoryActions}>
                      {entry.actionLabel === undefined ? null : (
                        <Pressable
                          accessibilityLabel={entry.actionLabel}
                          accessibilityRole="button"
                          onPress={() => onToastAction(entry.id)}
                          style={({ pressed }) => [
                            styles.activityHistoryAction,
                            pressed && styles.pressed
                          ]}
                        >
                          <Text style={styles.activityHistoryActionText}>
                            {entry.actionLabel}
                          </Text>
                        </Pressable>
                      )}
                      {entry.dismissible === true ? (
                        <Pressable
                          accessibilityLabel="Dismiss"
                          accessibilityRole="button"
                          onPress={() => onToastDismiss(entry.id)}
                          style={({ pressed }) => [
                            styles.activityHistoryAction,
                            pressed && styles.pressed
                          ]}
                        >
                          <Text style={styles.activityHistoryActionText}>
                            Dismiss
                          </Text>
                        </Pressable>
                      ) : null}
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: colors.canvas,
    flex: 1,
    minHeight: 0,
    minWidth: 0,
    overflow: "hidden",
    position: "relative",
    width: "100%"
  },
  topbar: {
    alignItems: "center",
    backgroundColor: colors.topbar,
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 12,
    minHeight: 52,
    paddingHorizontal: 12,
    paddingVertical: 6,
    position: "relative",
    zIndex: 20
  },
  topbarMap: {
    minHeight: 48,
    paddingHorizontal: 8,
    paddingVertical: 4
  },
  topbarNarrow: {
    alignItems: "stretch",
    flexWrap: "wrap",
    rowGap: 8
  },
  topbarLeft: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: 8,
    minWidth: 0,
    zIndex: 1
  },
  topbarCenter: {
    alignItems: "center",
    bottom: 0,
    justifyContent: "center",
    left: 0,
    pointerEvents: "box-none",
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 2
  },
  topbarCenterNarrow: {
    flexBasis: "100%",
    position: "relative",
    width: "100%"
  },
  topbarRight: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 5,
    justifyContent: "flex-end",
    minWidth: 0,
    zIndex: 1
  },
  topbarRightNarrow: {
    flexBasis: "100%",
    justifyContent: "flex-start"
  },
  topbarCopy: {
    flexGrow: 0,
    flexShrink: 1,
    maxWidth: 180,
    minWidth: 0
  },
  topbarTrail: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 2
  },
  topbarTitle: {
    color: colors.ink,
    fontFamily: fonts.story,
    fontSize: 18
  },
  topbarTitleMap: {
    fontFamily: fonts.uiSemibold,
    fontSize: 13
  },
  topbarMeta: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 8,
    marginTop: 2
  },
  structureTopToggle: {
    alignItems: "center",
    borderColor: colors.line,
    borderRadius: 6,
    borderWidth: 1,
    height: 28,
    justifyContent: "center",
    minWidth: 28,
    paddingHorizontal: 6
  },
  structureTopToggleGlyph: {
    color: colors.ink,
    fontFamily: fonts.uiSemibold,
    fontSize: 12
  },
  aggregateStatus: {
    color: colors.green,
    fontFamily: fonts.uiSemibold,
    fontSize: 8
  },
  centerMap: {
    flex: 1,
    minHeight: 0,
    overflow: "hidden",
    padding: 0
  },
  button: {
    alignItems: "center",
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 6,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 33,
    paddingHorizontal: 8,
    paddingVertical: 6
  },
  buttonPrimary: {
    backgroundColor: colors.brandDark,
    borderColor: colors.brandDark
  },
  buttonSelected: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent
  },
  buttonText: {
    color: colors.ink,
    fontFamily: fonts.uiSemibold,
    fontSize: 8
  },
  buttonTextPrimary: {
    color: "#ffffff"
  },
  buttonTextSelected: {
    color: colors.accent
  },
  pressed: {
    opacity: 0.72
  },
  disabled: {
    opacity: 0.42
  },
  narrowModes: {
    backgroundColor: colors.brandDark,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  workspace: {
    alignItems: "stretch",
    flex: 1,
    flexDirection: "row",
    minHeight: 0,
    minWidth: 0
  },
  workspaceNarrow: {
    flexDirection: "column"
  },
  rail: {
    backgroundColor: colors.rail,
    gap: 2,
    minHeight: 0,
    paddingHorizontal: 2,
    paddingVertical: 6,
    width: 32
  },
  railProject: {
    color: "#ffffff",
    fontFamily: fonts.brand,
    fontSize: 13,
    marginBottom: 4,
    textAlign: "center"
  },
  railButton: {
    alignItems: "center",
    borderColor: "transparent",
    borderRadius: 5,
    borderWidth: 1,
    height: 28,
    justifyContent: "center",
    width: 28
  },
  railButtonSelected: {
    backgroundColor: colors.railActive,
    borderColor: "#63554b"
  },
  railGlyph: {
    color: colors.railText,
    fontFamily: fonts.uiSemibold,
    fontSize: 12
  },
  railTextSelected: {
    color: "#ffffff"
  },
  railDivider: {
    alignSelf: "center",
    backgroundColor: "#4a4039",
    height: 1,
    marginVertical: 4,
    width: 16
  },
  railSpacer: {
    flex: 1
  },
  railTimeline: {
    alignItems: "center",
    gap: 3,
    maxHeight: 220,
    overflow: "hidden",
    paddingVertical: 2
  },
  railTimelineItem: {
    alignItems: "center",
    borderColor: "transparent",
    borderRadius: 5,
    borderWidth: 1,
    height: 24,
    justifyContent: "center",
    width: 24
  },
  railTimelineItemSelected: {
    backgroundColor: colors.railActive,
    borderColor: "#63554b"
  },
  railTimelineIndex: {
    color: colors.railText,
    fontFamily: fonts.uiSemibold,
    fontSize: 10
  },
  treeRegion: {
    borderRightColor: colors.line,
    borderRightWidth: 1,
    flexDirection: "column",
    flexShrink: 0,
    minHeight: 0,
    minWidth: 0,
    overflow: "hidden",
    position: "relative",
    width: shell.navigatorWidth
  },
  structureResizeHandle: {
    bottom: 0,
    position: "absolute",
    right: 0,
    top: 0,
    width: 6,
    zIndex: 4,
    ...(typeof document !== "undefined"
      ? ({ cursor: "ew-resize" } as object)
      : {})
  },
  treeRegionCollapsed: {
    backgroundColor: colors.wash
  },
  structureCollapsedRail: {
    alignItems: "center",
    flex: 1,
    gap: 8,
    paddingTop: 10,
    paddingHorizontal: 2
  },
  structureExpandedShell: {
    flex: 1,
    flexDirection: "column",
    minHeight: 0,
    minWidth: 0,
    overflow: "hidden"
  },
  structureTreeHost: {
    flex: 1,
    minHeight: 0,
    minWidth: 0,
    overflow: "hidden"
  },
  primaryViewScroll: {
    flex: 1,
    minHeight: 0
  },
  primaryViewContent: {
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 10
  },
  primaryViewActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6
  },
  primaryViewList: {
    gap: 6,
    marginTop: 4
  },
  primaryViewRow: {
    borderColor: colors.line,
    borderRadius: 6,
    borderWidth: 1,
    gap: 2,
    paddingHorizontal: 8,
    paddingVertical: 8
  },
  structureExpandedHeader: {
    alignItems: "center",
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    flexDirection: "row",
    flexShrink: 0,
    justifyContent: "space-between",
    paddingHorizontal: 8,
    paddingVertical: 6
  },
  structureExpandedHeaderTrailing: {
    alignItems: "center",
    flexDirection: "row",
    gap: 2
  },
  explorerHeaderAction: {
    alignItems: "center",
    borderRadius: 4,
    height: 22,
    justifyContent: "center",
    width: 22
  },
  structureExpandedLabel: {
    color: colors.kicker,
    fontFamily: fonts.uiSemibold,
    fontSize: 7,
    letterSpacing: 1,
    textTransform: "uppercase"
  },
  structureToggle: {
    alignItems: "center",
    borderColor: colors.line,
    borderRadius: 5,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 28,
    minWidth: 28,
    paddingHorizontal: 4
  },
  structureToggleGlyph: {
    color: colors.ink,
    fontFamily: fonts.uiSemibold,
    fontSize: 11
  },
  structureCollapsedHint: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 7,
    textAlign: "center",
    transform: [{ rotate: "-90deg" }],
    width: 48
  },
  secondaryResizeHandle: {
    backgroundColor: "transparent",
    bottom: 0,
    position: "relative",
    top: 0,
    width: 6,
    zIndex: 4,
    ...(typeof document !== "undefined"
      ? ({ cursor: "ew-resize" } as object)
      : {})
  },
  secondaryCollapsedRail: {
    alignItems: "center",
    backgroundColor: colors.wash,
    borderLeftColor: colors.line,
    borderLeftWidth: 1,
    justifyContent: "center",
    width: 28
  },
  secondaryCollapsedHint: {
    color: colors.muted,
    fontFamily: fonts.uiSemibold,
    fontSize: 14
  },
  inspectorRegion: {
    alignSelf: "stretch",
    flexDirection: "column",
    flexShrink: 0,
    height: "100%",
    minHeight: 0,
    minWidth: 0,
    overflow: "hidden"
  },
  draftDock: {
    backgroundColor: colors.paper,
    flex: 1,
    minHeight: 0,
    minWidth: 0
  },
  draftDockHeading: {
    alignItems: "center",
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 7,
    justifyContent: "space-between",
    padding: 11
  },
  draftDockHeadingCopy: {
    flex: 1,
    minWidth: 0
  },
  draftDockEyebrow: {
    color: colors.kicker,
    fontFamily: fonts.uiSemibold,
    fontSize: 7,
    letterSpacing: 1.2,
    textTransform: "uppercase"
  },
  draftDockTitle: {
    color: colors.ink,
    fontFamily: fonts.story,
    fontSize: 20,
    marginTop: 2
  },
  draftDockTabs: {
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 3,
    padding: 7
  },
  draftDockTab: {
    borderColor: "transparent",
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 7,
    paddingVertical: 5
  },
  draftDockTabSelected: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent
  },
  draftDockTabText: {
    color: colors.muted,
    fontFamily: fonts.uiMedium,
    fontSize: 8
  },
  draftDockTabTextSelected: {
    color: colors.accent,
    fontFamily: fonts.uiSemibold
  },
  draftDockBody: {
    gap: 9,
    padding: 12
  },
  draftDockSectionTitle: {
    color: colors.ink,
    fontFamily: fonts.story,
    fontSize: 20
  },
  draftDockText: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 9,
    lineHeight: 14
  },
  draftDockCard: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 8,
    borderWidth: 1,
    gap: 3,
    padding: 9
  },
  draftDockCardTitle: {
    color: colors.ink,
    fontFamily: fonts.uiSemibold,
    fontSize: 9
  },
  chatRegion: {
    borderLeftColor: colors.line,
    borderLeftWidth: 1,
    minHeight: 0,
    minWidth: 0,
    width: 300
  },
  collapsedRegion: {
    flexShrink: 0,
    width: 288
  },
  narrowRegion: {
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    borderLeftWidth: 0,
    borderRightWidth: 0,
    flexGrow: 0,
    flexShrink: 0,
    height: 340,
    maxHeight: 430,
    minHeight: 0,
    width: "100%"
  },
  regionHidden: {
    display: "none"
  },
  center: {
    flex: 1,
    minHeight: 0,
    minWidth: 0
  },
  centerContent: {
    gap: 12,
    minWidth: 0,
    padding: 14,
    width: "100%"
  },
  centerContentNarrow: {
    padding: 9
  },
  error: {
    backgroundColor: colors.redSoft,
    borderColor: colors.red,
    borderRadius: 8,
    borderWidth: 1,
    padding: 10
  },
  errorText: {
    color: colors.red,
    fontFamily: fonts.uiMedium,
    fontSize: 9,
    lineHeight: 14
  },
  storyTrailRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "space-between",
    minWidth: 0,
    zIndex: 30
  },
  storyTrail: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 3,
    minWidth: 0
  },
  storyTrailItem: {
    alignItems: "center",
    flexDirection: "row",
    gap: 3,
    minWidth: 0
  },
  storyTrailDivider: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 9,
    marginTop: 10
  },
  storyTrailButton: {
    alignItems: "flex-start",
    borderColor: "transparent",
    borderRadius: 5,
    borderWidth: 1,
    flexDirection: "column",
    gap: 1,
    maxWidth: 160,
    paddingHorizontal: 5,
    paddingVertical: 2
  },
  storyTrailCurrent: {},
  storyTrailRole: {
    color: colors.kicker,
    fontFamily: fonts.uiSemibold,
    fontSize: 7,
    letterSpacing: 0.6,
    textTransform: "uppercase"
  },
  storyTrailText: {
    color: colors.muted,
    fontFamily: fonts.uiMedium,
    fontSize: 9
  },
  mapTrail: {
    flex: 1,
    gap: 2,
    minWidth: 0
  },
  mapTrailEyebrow: {
    color: colors.kicker,
    fontFamily: fonts.uiSemibold,
    fontSize: 9,
    letterSpacing: 0.4
  },
  mapSelectionHint: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 11,
    maxWidth: 220,
    paddingHorizontal: 4
  },
  activityHistoryRoot: {
    ...StyleSheet.absoluteFill,
    alignItems: "flex-end",
    justifyContent: "flex-start",
    padding: 16,
    zIndex: 80
  },
  activityHistoryBackdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(40, 35, 31, 0.28)"
  },
  activityHistoryCard: {
    backgroundColor: colors.paper,
    borderColor: colors.line,
    borderRadius: 12,
    borderWidth: 1,
    gap: 10,
    maxHeight: "88%",
    maxWidth: 420,
    overflow: "hidden",
    padding: 14,
    width: "100%",
    zIndex: 2,
    ...({
      boxShadow: "0 12px 32px rgba(28, 22, 16, 0.18)"
    } as object)
  },
  activityHistoryHeader: {
    alignItems: "flex-end",
    flexDirection: "row",
    justifyContent: "flex-end"
  },
  activityHistoryClose: {
    alignItems: "center",
    borderColor: colors.line,
    borderRadius: 6,
    borderWidth: 1,
    height: 28,
    justifyContent: "center",
    width: 28
  },
  activityHistoryCloseText: {
    color: colors.ink,
    fontFamily: fonts.uiSemibold,
    fontSize: 16
  },
  activityHistoryEmpty: {
    minHeight: 120
  },
  activityHistoryList: {
    gap: 8,
    overflow: "scroll"
  },
  activityHistoryRow: {
    borderColor: colors.line,
    borderLeftWidth: 4,
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
    padding: 10
  },
  activityHistoryRowSuccess: {
    backgroundColor: "#f8fcf9",
    borderLeftColor: colors.green
  },
  activityHistoryRowWarning: {
    backgroundColor: colors.amberSoft,
    borderLeftColor: colors.amber
  },
  activityHistoryRowError: {
    backgroundColor: colors.redSoft,
    borderLeftColor: colors.red
  },
  activityHistoryCopy: {
    gap: 2
  },
  activityHistoryRowTitle: {
    color: colors.ink,
    fontFamily: fonts.uiSemibold,
    fontSize: 11
  },
  activityHistoryRowDetail: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 10,
    lineHeight: 14
  },
  activityHistoryRowTime: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 9,
    marginTop: 2
  },
  activityHistoryActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6
  },
  activityHistoryAction: {
    borderColor: colors.line,
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 5
  },
  activityHistoryActionText: {
    color: colors.ink,
    fontFamily: fonts.uiSemibold,
    fontSize: 10
  },
  storyTrailTextCurrent: {
    color: colors.accent,
    fontFamily: fonts.uiSemibold
  },
  quickBuild: {
    position: "relative",
    zIndex: 30
  },
  quickBuildButton: {
    alignItems: "center",
    backgroundColor: colors.brandDark,
    borderColor: colors.brandDark,
    borderRadius: 6,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 33,
    paddingHorizontal: 10,
    paddingVertical: 6
  },
  quickBuildButtonText: {
    color: "#ffffff",
    fontFamily: fonts.uiSemibold,
    fontSize: 8
  },
  quickBuildMenu: {
    backgroundColor: colors.paper,
    borderColor: colors.line,
    borderRadius: 8,
    borderWidth: 1,
    elevation: 6,
    gap: 2,
    marginTop: 4,
    minWidth: 250,
    padding: 6,
    position: "absolute",
    right: 0,
    shadowColor: "#1d150f",
    shadowOffset: { height: 6, width: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 14,
    top: "100%",
    zIndex: 40
  },
  quickBuildOption: {
    borderRadius: 6,
    gap: 1,
    paddingHorizontal: 7,
    paddingVertical: 6
  },
  quickBuildOptionLabel: {
    color: colors.ink,
    fontFamily: fonts.uiSemibold,
    fontSize: 9
  },
  quickBuildOptionDetail: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 7.5,
    lineHeight: 11
  },
  quickBuildHint: {
    borderTopColor: colors.line,
    borderTopWidth: 1,
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 7,
    lineHeight: 10,
    marginTop: 3,
    paddingHorizontal: 7,
    paddingTop: 5
  },
  launchpad: {
    backgroundColor: colors.paper,
    borderColor: colors.line,
    borderRadius: 10,
    borderWidth: 1,
    flex: 1,
    gap: 10,
    minHeight: 0,
    padding: 12,
    width: "100%"
  },
  launchpadHeaderRow: {
    alignItems: "center",
    flexDirection: "row",
    flexShrink: 0,
    gap: 12,
    minWidth: 0
  },
  launchpadHeaderCopy: {
    flex: 1,
    gap: 1,
    minWidth: 0
  },
  launchpadEyebrow: {
    color: colors.kicker,
    fontFamily: fonts.uiSemibold,
    fontSize: 7,
    letterSpacing: 1.2,
    textTransform: "uppercase"
  },
  launchpadTitle: {
    color: colors.ink,
    fontFamily: fonts.story,
    fontSize: 20
  },
  launchpadDescription: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 9,
    lineHeight: 13
  },
  launchpadEntryDescription: {
    color: colors.ink,
    fontFamily: fonts.ui,
    fontSize: 9,
    lineHeight: 13,
    marginTop: 2
  },
  launchpadEntryActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 4
  },
  launchpadEntryActionButton: {
    borderColor: colors.accent,
    borderRadius: 5,
    borderWidth: 1,
    paddingHorizontal: 7,
    paddingVertical: 4
  },
  launchpadEntryAction: {
    color: colors.accent,
    fontFamily: fonts.uiSemibold,
    fontSize: 8,
    letterSpacing: 0.4,
    textTransform: "uppercase"
  },
  launchpadDescriptionEdit: {
    gap: 5
  },
  launchpadDescriptionInput: {
    borderColor: colors.line,
    borderRadius: 8,
    borderWidth: 1,
    color: colors.ink,
    fontFamily: fonts.ui,
    fontSize: 12,
    minHeight: 64,
    paddingHorizontal: 10,
    paddingVertical: 8,
    textAlignVertical: "top"
  },
  launchpadActions: {
    alignItems: "center",
    flexDirection: "row",
    flexShrink: 0,
    flexWrap: "wrap",
    gap: 6,
    justifyContent: "flex-end",
    marginLeft: "auto"
  },
  launchpadScenes: {
    flex: 1,
    gap: 5,
    minHeight: 0,
    minWidth: 0
  },
  launchpadSectionTitle: {
    color: colors.kicker,
    fontFamily: fonts.uiSemibold,
    fontSize: 7.5,
    letterSpacing: 1.1,
    textTransform: "uppercase"
  },
  launchpadScene: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 8,
    borderWidth: 1,
    gap: 1,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  launchpadScenePrimary: {
    gap: 1
  },
  launchpadSceneTitle: {
    color: colors.ink,
    fontFamily: fonts.uiSemibold,
    fontSize: 9.5
  },
  launchpadSceneMeta: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 7.5
  },
  centerHeading: {
    alignItems: "flex-start",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "space-between",
    minWidth: 0
  },
  centerHeadingCopy: {
    flex: 1,
    minWidth: 0
  },
  centerEyebrow: {
    color: colors.kicker,
    fontFamily: fonts.uiSemibold,
    fontSize: 8,
    letterSpacing: 1.4,
    textTransform: "uppercase"
  },
  centerTitle: {
    color: colors.ink,
    fontFamily: fonts.story,
    fontSize: 25,
    marginTop: 2
  },
  centerRule: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 8,
    lineHeight: 13,
    maxWidth: 330
  },
  workSurface: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 10,
    minWidth: 0,
    width: "100%"
  },
  workSurfaceMap: {
    alignItems: "stretch",
    flex: 1,
    gap: 0,
    minHeight: 0,
    overflow: "hidden"
  },
  workSurfaceSplit: {
    alignItems: "stretch",
    gap: 0
  },
  workSurfaceNarrow: {
    flexDirection: "column"
  },
  workSurfacePane: {
    alignSelf: "stretch",
    flex: 1,
    minHeight: 0,
    minWidth: 0,
    width: "100%"
  },
  workSurfaceInbox: {
    alignItems: "stretch",
    flex: 1,
    minHeight: 0,
    overflow: "hidden"
  },
  splitDivider: {
    alignItems: "center",
    backgroundColor: colors.line,
    justifyContent: "center",
    width: 8
  },
  splitDividerGrip: {
    backgroundColor: colors.muted,
    borderRadius: 999,
    height: 42,
    width: 3
  },
  empty: {
    backgroundColor: colors.paper,
    borderColor: colors.line,
    borderRadius: 10,
    borderWidth: 1,
    padding: 18
  },
  emptyTitle: {
    color: colors.ink,
    fontFamily: fonts.story,
    fontSize: 21
  },
  emptyText: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 9,
    lineHeight: 14,
    marginTop: 3
  }
});
