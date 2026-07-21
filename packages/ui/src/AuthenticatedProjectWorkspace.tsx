import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View
} from "react-native";
import type {
  GhostwriterCapability,
  ProjectCommand,
  ProjectNavigator,
  ProjectNavigatorScene,
  SceneId
} from "@ghostwriter/core";
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
  type SceneMoveDestination
} from "./ManuscriptTree.js";
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
import { CharacterBrowsePanel } from "./CharacterBrowsePanel.js";
import {
  projectCharacterLaunchpad,
  quickBuildOptions,
  sceneTimeline,
  storyTrail,
  structureLaunchpad,
  type QuickBuildOption
} from "./workspace-structure.js";
import {
  type WorkspaceChatMessage
} from "./WorkspaceChatPanel.js";
import {
  WorkspaceQuickNav,
  type WorkspacePaletteMode
} from "./WorkspaceQuickNav.js";
import {
  buildWorkspaceJumpTargets,
  type WorkspaceJumpTarget
} from "./workspace-quick-nav.js";

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
  chatCapabilities?: readonly GhostwriterCapability[];
  chatMessages?: readonly WorkspaceChatMessage[];
  onChatSend?(message: string): Promise<void> | void;
}>;

const { colors, fonts, shell } = ghostwriterTheme;

const STRUCTURE_WIDTH_MIN = 180;
const STRUCTURE_WIDTH_MAX = 420;
const STRUCTURE_WIDTH_DEFAULT = shell.navigatorWidth;

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
  glyph,
  label,
  selected,
  disabled,
  onPress
}: Readonly<{
  glyph: string;
  label: string;
  selected: boolean;
  disabled: boolean;
  onPress(): void;
}>) {
  return (
    <Pressable
      accessibilityLabel={`${glyph} ${label}${selected ? ", selected" : ""}`}
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
      <Text style={[styles.railGlyph, selected && styles.railTextSelected]}>
        {glyph}
      </Text>
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
  chatCapabilities = [],
  chatMessages = [],
  onChatSend
}: AuthenticatedProjectWorkspaceProps) {
  const { width } = useWindowDimensions();
  const wide = width >= 1240;
  const narrow = width < 760;
  const [splitRatio, setSplitRatio] = useState(SPLIT_RATIO_DEFAULT);
  const [paletteMode, setPaletteMode] = useState<WorkspacePaletteMode>();
  const [structureWidthPx, setStructureWidthPx] = useState<number>(
    STRUCTURE_WIDTH_DEFAULT
  );
  const [contextDockOpen, setContextDockOpen] = useState(false);
  const [draftDockTab, setDraftDockTab] = useState<
    "brief" | "story" | "canvas" | "history"
  >("brief");
  const [focusHalo, setFocusHalo] = useState(false);
  const splitSurfaceRef = useRef<View>(null);
  useEffect(() => {
    if (storageAccountId === undefined) {
      setSplitRatio(SPLIT_RATIO_DEFAULT);
      return;
    }
    setSplitRatio(
      readStoredSplitRatio(project.id, storageAccountId) ?? SPLIT_RATIO_DEFAULT
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
  const structureResizeOriginRef = useRef(structureWidthPx);

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
          const next = Math.min(
            STRUCTURE_WIDTH_MAX,
            Math.max(
              STRUCTURE_WIDTH_MIN,
              structureResizeOriginRef.current + gesture.dx
            )
          );
          setStructureWidthPx(next);
        }
      }),
    [structureCollapsible, structureRail, structureWidthPx]
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
    if (!wide && mode === "split") onModeChange("draft");
  }, [mode, onModeChange, wide]);

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
    setSelection(next);
    if (next.kind === "scene") onSelectedSceneIdChange(next.sceneId);
  }

  const [quickBuildOpen, setQuickBuildOpen] = useState(false);
  const [railDestination, setRailDestination] = useState<
    "write" | "characters"
  >("write");
  const [treeAddRequest, setTreeAddRequest] =
    useState<ManuscriptTreeAddRequest>();
  const quickBuildRequestId = useRef(0);
  const trail = storyTrail(project, selection);
  const quickOptions = quickBuildOptions(project, selection);
  const charactersLens = railDestination === "characters";
  const launchpad = charactersLens
    ? projectCharacterLaunchpad(project)
    : structureLaunchpad(project, selection);
  const launchpadVisible =
    mode === "draft" &&
    (charactersLens ||
      (selection.kind !== "scene" && launchpad !== undefined));
  const timeline = sceneTimeline(project, selection);
  const resolvedSelection = resolveManuscriptSelection(project, selection);
  const moveCandidates =
    selection.kind === "chapter"
      ? (resolvedSelection?.book?.unassignedScenes.filter(
          (scene) => scene.archivedAt === undefined
        ) ?? [])
      : [];

  const selectionKey = manuscriptSelectionKey(selection);
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
    if (target.toggleJump === true) {
      setPaletteMode("jump");
      return;
    }
    if (target.toggleChat === true) {
      setPaletteMode((current) =>
        current === "command" ? undefined : "command"
      );
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
      chooseSelection(target.selection);
      if (!wide) setCollapsedPanel("tree");
    }
    if (target.mode !== undefined) {
      onModeChange(target.mode);
    }
    if (target.openReader === true) {
      onOpenReader?.();
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

  async function moveSceneToLaunchpadChapter(
    scene: ProjectNavigatorScene
  ): Promise<void> {
    if (selection.kind !== "chapter") return;
    await onCommand({
      type: "scene.move",
      sceneId: scene.id,
      bookId: selection.bookId,
      chapterId: selection.chapterId,
      position: launchpad?.scenes.length ?? 0
    });
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
      onAddChild={addChild}
      onEnterChapter={(next) => {
        chooseSelection(next);
        onEnterChapter(next);
        if (mode !== "canvas" && mode !== "split") onModeChange("canvas");
      }}
      onMoveScene={moveScene}
      onOpenScene={(next) => {
        chooseSelection(next);
        onModeChange("draft");
        if (!wide) {
          setCollapsedPanel("none");
          setContextDockOpen(false);
        }
      }}
      onRename={renameSelection}
      onReorder={reorderSelection}
      onSelectionChange={chooseSelection}
      project={project}
      selection={selection}
    />
  );
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
  const draftVisible = mode === "draft" || mode === "split";
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
          <Button label="Open Canvas" onPress={() => onModeChange("canvas")} />
          {wide ? (
            <Button label="Open Split" onPress={() => onModeChange("split")} />
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
  const centerTitle = launchpadVisible
    ? (launchpad?.title ?? "Browse structure")
    : drillScope.kind === "scene"
      ? (drillTrail[drillTrail.length - 1]?.label ?? selectedScene?.title)
      : drillScope.kind === "chapter"
        ? (drillTrail[drillTrail.length - 1]?.label ?? "Chapter lens")
        : (selectedScene?.title ?? "Shape the manuscript");
  const centerEyebrow = launchpadVisible
    ? (launchpad?.eyebrow ?? "Structure")
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
        <Button disabled={busy} label="← Projects" onPress={onBack} />
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
        <View style={styles.topbarCopy}>
          <Text
            numberOfLines={1}
            style={[styles.topbarTitle, surfaceDense && styles.topbarTitleMap]}
          >
            {project.title}
          </Text>
          {surfaceDense ? null : (
            <Text numberOfLines={1} style={styles.topbarMeta}>
              {profileDisplayName} · project version {project.version}
            </Text>
          )}
        </View>
        {wide && surfaceDense && !focusHalo ? (
          <View style={styles.topbarTrail}>
            {canvasVisible ? mapScopeTrailNodes : storyTrailNodes}
          </View>
        ) : null}
        <View
          style={[
            styles.topbarActions,
            narrow && styles.topbarActionsNarrow
          ]}
        >
          {allChangesIdle ? (
            <Text
              accessibilityLiveRegion="polite"
              style={styles.aggregateStatus}
            >
              {surfaceDense ? "Saved" : "All changes saved"}
            </Text>
          ) : null}
          {surfaceDense ? null : (
            <>
              {!wide ? (
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
                        // Medium/narrow: tree and Context Dock are mutually exclusive.
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
              ) : null}
              <Button disabled={busy} label="Refresh" onPress={onRefresh} />
              {onOpenReader === undefined ? null : (
                <Button
                  disabled={busy || selectedSceneId === undefined}
                  label="Reader"
                  onPress={onOpenReader}
                />
              )}
            </>
          )}
          {/* Jump · ⌘P and Chat · ⌘⇧P live on the left rail — not the topbar. */}
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
              onModeChange("draft");
            }}
            selected={mode === "draft" && collapsedPanel === "none"}
          />
          <Button
            label="Canvas"
            onPress={() => {
              setCollapsedPanel("none");
              onModeChange("canvas");
            }}
            selected={mode === "canvas" && collapsedPanel === "none"}
          />
          {onOpenReader === undefined ? null : (
            <Button
              disabled={busy || selectedSceneId === undefined}
              label="Reader"
              onPress={onOpenReader}
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
              glyph="D"
              label="Draft"
              onPress={() => {
                setRailDestination("write");
                onModeChange("draft");
              }}
              selected={mode === "draft" && !charactersLens}
            />
            <RailButton
              disabled={busy}
              glyph="C"
              label="Canvas"
              onPress={() => {
                setRailDestination("write");
                onModeChange("canvas");
              }}
              selected={mode === "canvas"}
            />
            {wide ? (
              <RailButton
                disabled={busy}
                glyph="S"
                label="Split"
                onPress={() => {
                  setRailDestination("write");
                  onModeChange("split");
                }}
                selected={mode === "split"}
              />
            ) : null}
            {onOpenReader === undefined ? null : (
              <RailButton
                disabled={busy || selectedSceneId === undefined}
                glyph="R"
                label="Reader"
                onPress={onOpenReader}
                selected={false}
              />
            )}
            <RailButton
              disabled={busy}
              glyph="K"
              label="Characters"
              onPress={() => {
                setRailDestination("characters");
                onModeChange("draft");
                chooseSelection({ kind: "storyKnowledgeRoot" });
                if (structureCollapsible) setStructureRail("expanded");
              }}
              selected={charactersLens}
            />
            {timeline.length > 0 && mode === "draft" && !charactersLens ? (
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
            <RailButton
              disabled={busy}
              glyph="◷"
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
            {onChatSend === undefined ? null : (
              <RailButton
                disabled={busy}
                glyph="✦"
                label="Chat · ⌘⇧P"
                onPress={() =>
                  setPaletteMode((current) =>
                    current === "command" ? undefined : "command"
                  )
                }
                selected={paletteMode === "command"}
              />
            )}
            <RailButton
              disabled={busy}
              glyph="⌕"
              label="Jump · ⌘P"
              onPress={() =>
                setPaletteMode((current) =>
                  current === "jump" ? undefined : "jump"
                )
              }
              selected={paletteMode === "jump"}
            />
            <RailButton
              disabled={busy || !structureCollapsible}
              glyph="☰"
              label="Structure · ["
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
                <Text style={styles.structureCollapsedHint}>Tree</Text>
              </View>
            ) : (
              <View style={styles.structureExpandedShell}>
                <View style={styles.structureExpandedHeader}>
                  <Text style={styles.structureExpandedLabel}>Manuscript</Text>
                  <Pressable
                    accessibilityLabel="Collapse manuscript · ["
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
                {tree}
              </View>
            )
          ) : (
            tree
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
          const centerChrome = focusHalo ? null : (
            <>
              {surfaceDense && wide ? null : (
                <View style={styles.storyTrailRow}>
                  {storyTrailNodes}
                  {/* Draft keeps ＋ Add on the Write toolbar so the trail stays slim. */}
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
              )}
              {surfaceDense ? null : (
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
              surfaceDense && styles.workSurfaceMap,
              mode === "split" && styles.workSurfaceSplit,
              narrow && styles.workSurfaceNarrow
            ]}
          >
            {canvasVisible ? (
              <View
                key="canvas"
                style={[
                  styles.workSurfacePane,
                  mode === "split" && wide
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
            {mode === "split" && wide ? (
              <View
                accessibilityLabel="Resize Draft and Canvas panes"
                accessibilityRole="adjustable"
                {...splitDividerResponder.panHandlers}
                style={styles.splitDivider}
              >
                <View style={styles.splitDividerGrip} />
              </View>
            ) : null}
            {draftVisible ? (
              <View
                key="draft"
                style={[
                  styles.workSurfacePane,
                  mode === "split" && wide
                    ? { flex: 1 - splitRatio, flexBasis: 0 }
                    : undefined
                ]}
              >
                {launchpadVisible && mode === "draft" && launchpad !== undefined ? (
                  <View
                    accessibilityLabel={
                      charactersLens ? "Characters browse" : "Scene Launchpad"
                    }
                    style={styles.launchpad}
                  >
                    <View style={styles.launchpadHeaderRow}>
                      <View style={styles.launchpadHeaderCopy}>
                        <Text style={styles.launchpadEyebrow}>
                          {launchpad.eyebrow}
                        </Text>
                        <Text numberOfLines={1} style={styles.launchpadTitle}>
                          {launchpad.title}
                        </Text>
                        <Text numberOfLines={1} style={styles.launchpadDescription}>
                          {launchpad.description}
                        </Text>
                      </View>
                      <View style={styles.launchpadActions}>
                        {quickOptions[0] === undefined ? null : (
                          <Button
                            disabled={busy}
                            label={quickOptions[0].label}
                            onPress={() => {
                              const first = quickOptions[0];
                              if (first !== undefined) dispatchQuickBuild(first);
                            }}
                            primary
                          />
                        )}
                        {charactersLens ? (
                          <Button
                            disabled={busy}
                            label="Characters on Canvas"
                            onPress={() => {
                              setRailDestination("write");
                              chooseSelection({ kind: "storyKnowledgeRoot" });
                              onModeChange("canvas");
                            }}
                          />
                        ) : null}
                        {launchpad.storyboardChapter === undefined ? null : (
                          <Button
                            disabled={busy}
                            label="Storyboard on Canvas"
                            onPress={() => {
                              const chapter = launchpad.storyboardChapter;
                              if (chapter === undefined) return;
                              setRailDestination("write");
                              chooseSelection(chapter);
                              onEnterChapter(chapter);
                              onModeChange("canvas");
                            }}
                          />
                        )}
                      </View>
                    </View>
                    {(selection.kind === "part" || selection.kind === "chapter") &&
                    !charactersLens ? (
                      <View style={styles.launchpadDescriptionEdit}>
                        <Text style={styles.launchpadSectionTitle}>
                          Description
                        </Text>
                        <TextInput
                          accessibilityLabel="Structure description"
                          editable={!busy}
                          multiline
                          defaultValue={
                            selection.kind === "part"
                              ? (resolvedSelection?.part?.summary ?? "")
                              : (resolvedSelection?.chapter?.summary ?? "")
                          }
                          key={`desc:${manuscriptSelectionKey(selection)}:${
                            selection.kind === "part"
                              ? (resolvedSelection?.part?.summary ?? "")
                              : (resolvedSelection?.chapter?.summary ?? "")
                          }`}
                          onEndEditing={(event) => {
                            const next = event.nativeEvent.text.trim();
                            if (selection.kind === "part") {
                              const current =
                                resolvedSelection?.part?.summary ?? "";
                              if (next === current) return;
                              void onCommand({
                                type: "part.update",
                                bookId: selection.bookId,
                                partId: selection.partId,
                                summary: next === "" ? null : next
                              });
                              return;
                            }
                            if (selection.kind === "chapter") {
                              const current =
                                resolvedSelection?.chapter?.summary ?? "";
                              if (next === current) return;
                              void onCommand({
                                type: "chapter.update",
                                bookId: selection.bookId,
                                partId: selection.partId,
                                chapterId: selection.chapterId,
                                summary: next === "" ? null : next
                              });
                            }
                          }}
                          placeholder="Add a short description for this folder"
                          style={styles.launchpadDescriptionInput}
                        />
                      </View>
                    ) : null}
                    {selection.kind === "storyKnowledge" &&
                    resolvedSelection?.knowledge !== undefined ? (
                      <CharacterBrowsePanel
                        busy={busy}
                        knowledge={resolvedSelection.knowledge}
                        onCommand={onCommand}
                        onOpenRecord={(storyKnowledgeId) => {
                          setRailDestination("characters");
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
                          onModeChange("draft");
                        }}
                        project={project}
                      />
                    ) : null}
                    {launchpad.entries.length === 0 ? null : (
                      <View
                        accessibilityLabel="Browse manuscript entries"
                        style={styles.launchpadScenes}
                      >
                        {launchpad.entries.map((entry) => (
                          <Pressable
                            accessibilityLabel={`Open ${entry.kind} ${entry.title}`}
                            accessibilityRole="button"
                            disabled={busy}
                            key={entry.id}
                            onPress={() => {
                              if (entry.kind === "character") {
                                setRailDestination("characters");
                              } else {
                                setRailDestination("write");
                              }
                              chooseSelection(entry.selection);
                              if (entry.kind === "scene") {
                                onModeChange("draft");
                              }
                            }}
                            style={({ pressed }) => [
                              styles.launchpadScene,
                              pressed && styles.pressed
                            ]}
                          >
                            <Text
                              numberOfLines={1}
                              style={styles.launchpadSceneTitle}
                            >
                              {entry.title}
                            </Text>
                            {entry.description === undefined ? null : (
                              <Text
                                numberOfLines={2}
                                style={styles.launchpadEntryDescription}
                              >
                                {entry.description}
                              </Text>
                            )}
                            <Text style={styles.launchpadSceneMeta}>
                              {entry.kind} · {entry.meta}
                            </Text>
                            <View style={styles.launchpadEntryActions}>
                              {entry.kind === "scene" ? (
                                <>
                                  <Pressable
                                    accessibilityLabel={`Draft ${entry.title}`}
                                    accessibilityRole="button"
                                    disabled={busy}
                                    onPress={(event) => {
                                      event?.stopPropagation?.();
                                      setRailDestination("write");
                                      chooseSelection(entry.selection);
                                      onModeChange("draft");
                                    }}
                                    style={({ pressed }) => [
                                      styles.launchpadEntryActionButton,
                                      pressed && styles.pressed
                                    ]}
                                  >
                                    <Text style={styles.launchpadEntryAction}>Draft</Text>
                                  </Pressable>
                                  {onOpenReader === undefined ? null : (
                                    <Pressable
                                      accessibilityLabel={`Read ${entry.title}`}
                                      accessibilityRole="button"
                                      disabled={busy}
                                      onPress={(event) => {
                                        event?.stopPropagation?.();
                                        setRailDestination("write");
                                        chooseSelection(entry.selection);
                                        onOpenReader();
                                      }}
                                      style={({ pressed }) => [
                                        styles.launchpadEntryActionButton,
                                        pressed && styles.pressed
                                      ]}
                                    >
                                      <Text style={styles.launchpadEntryAction}>Reader</Text>
                                    </Pressable>
                                  )}
                                  <Pressable
                                    accessibilityLabel={`Canvas ${entry.title}`}
                                    accessibilityRole="button"
                                    disabled={busy}
                                    onPress={(event) => {
                                      event?.stopPropagation?.();
                                      setRailDestination("write");
                                      chooseSelection(entry.selection);
                                      onModeChange("canvas");
                                    }}
                                    style={({ pressed }) => [
                                      styles.launchpadEntryActionButton,
                                      pressed && styles.pressed
                                    ]}
                                  >
                                    <Text style={styles.launchpadEntryAction}>Canvas</Text>
                                  </Pressable>
                                </>
                              ) : entry.kind === "chapter" &&
                                entry.selection.kind === "chapter" ? (
                                <>
                                  <Pressable
                                    accessibilityLabel={`Open ${entry.title}`}
                                    accessibilityRole="button"
                                    disabled={busy}
                                    onPress={(event) => {
                                      event?.stopPropagation?.();
                                      if (entry.selection.kind !== "chapter") {
                                        return;
                                      }
                                      setRailDestination("write");
                                      chooseSelection(entry.selection);
                                    }}
                                    style={({ pressed }) => [
                                      styles.launchpadEntryActionButton,
                                      pressed && styles.pressed
                                    ]}
                                  >
                                    <Text style={styles.launchpadEntryAction}>Open</Text>
                                  </Pressable>
                                  <Pressable
                                    accessibilityLabel={`Canvas ${entry.title}`}
                                    accessibilityRole="button"
                                    disabled={busy}
                                    onPress={(event) => {
                                      event?.stopPropagation?.();
                                      if (entry.selection.kind !== "chapter") {
                                        return;
                                      }
                                      const chapterSelection = entry.selection;
                                      setRailDestination("write");
                                      chooseSelection(chapterSelection);
                                      onEnterChapter(chapterSelection);
                                      onModeChange("canvas");
                                    }}
                                    style={({ pressed }) => [
                                      styles.launchpadEntryActionButton,
                                      pressed && styles.pressed
                                    ]}
                                  >
                                    <Text style={styles.launchpadEntryAction}>Canvas</Text>
                                  </Pressable>
                                </>
                              ) : entry.kind === "character" ? (
                                <Pressable
                                  accessibilityLabel={`Open character ${entry.title}`}
                                  accessibilityRole="button"
                                  disabled={busy}
                                  onPress={(event) => {
                                    event?.stopPropagation?.();
                                    setRailDestination("characters");
                                    chooseSelection(entry.selection);
                                  }}
                                  style={({ pressed }) => [
                                    styles.launchpadEntryActionButton,
                                    pressed && styles.pressed
                                  ]}
                                >
                                  <Text style={styles.launchpadEntryAction}>Sheet · Links</Text>
                                </Pressable>
                              ) : (
                                <Pressable
                                  accessibilityLabel={`Open ${entry.title}`}
                                  accessibilityRole="button"
                                  disabled={busy}
                                  onPress={(event) => {
                                    event?.stopPropagation?.();
                                    setRailDestination("write");
                                    chooseSelection(entry.selection);
                                  }}
                                  style={({ pressed }) => [
                                    styles.launchpadEntryActionButton,
                                    pressed && styles.pressed
                                  ]}
                                >
                                  <Text style={styles.launchpadEntryAction}>Open</Text>
                                </Pressable>
                              )}
                            </View>
                          </Pressable>
                        ))}
                      </View>
                    )}
                    {!charactersLens && launchpad.characters.length > 0 ? (
                      <View
                        accessibilityLabel="Characters in this scope"
                        style={styles.launchpadScenes}
                      >
                        <Text style={styles.launchpadSectionTitle}>
                          Characters in this scope
                        </Text>
                        {launchpad.characters.map((character) => (
                          <Pressable
                            accessibilityLabel={`Open character ${character.label}`}
                            accessibilityRole="button"
                            disabled={busy}
                            key={character.id}
                            onPress={() => {
                              setRailDestination("characters");
                              chooseSelection(character.selection);
                            }}
                            style={({ pressed }) => [
                              styles.launchpadScene,
                              pressed && styles.pressed
                            ]}
                          >
                            <Text
                              numberOfLines={1}
                              style={styles.launchpadSceneTitle}
                            >
                              {character.label}
                            </Text>
                            {character.desire === undefined &&
                            character.description === undefined ? null : (
                              <Text
                                numberOfLines={2}
                                style={styles.launchpadEntryDescription}
                              >
                                {character.desire ?? character.description}
                              </Text>
                            )}
                            <Text style={styles.launchpadSceneMeta}>
                              {character.linkedSceneCount} scenes ·{" "}
                              {character.linkedRecordCount} links
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                    ) : null}
                    {moveCandidates.length === 0 ? null : (
                      <View
                        accessibilityLabel="Move an existing scene here"
                        style={styles.launchpadScenes}
                      >
                        <Text style={styles.launchpadSectionTitle}>
                          Move an unassigned scene into this chapter
                        </Text>
                        {moveCandidates.slice(0, 6).map((scene) => (
                          <Pressable
                            accessibilityLabel={`Move scene ${scene.title} here`}
                            accessibilityRole="button"
                            disabled={busy}
                            key={scene.id}
                            onPress={() =>
                              void moveSceneToLaunchpadChapter(scene)
                            }
                            style={({ pressed }) => [
                              styles.launchpadScene,
                              pressed && styles.pressed
                            ]}
                          >
                            <Text
                              numberOfLines={1}
                              style={styles.launchpadSceneTitle}
                            >
                              {scene.title}
                            </Text>
                            <Text style={styles.launchpadSceneMeta}>
                              Move here · keeps one canonical order
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                    )}
                  </View>
                ) : (
                  (renderDraft?.(selectedScene, draftPresentation) ?? (
                    <View style={styles.empty}>
                      <Text style={styles.emptyTitle}>
                        Open a scene to write
                      </Text>
                      <Text style={styles.emptyText}>
                        Use the Scene Launchpad or manuscript tree to open one
                        scene at a time. Draft never invents a scene for you.
                      </Text>
                    </View>
                  ))
                )}
              </View>
            ) : null}
          </View>
          );
          // Dense Draft/Canvas/Split: edge-to-edge column (no ScrollView page padding).
          if (surfaceDense) {
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

        <View
          style={[
            styles.inspectorRegion,
            !wide && styles.collapsedRegion,
            narrow && styles.narrowRegion,
            (focusHalo ||
              mapDense ||
              (draftDeskActive
                ? !contextDockOpen
                : !wide && collapsedPanel !== "inspector")) &&
              styles.regionHidden
          ]}
        >
          {draftDeskActive ? draftContextDock : inspector}
        </View>

      </View>

      {paletteMode === undefined ? null : (
        <WorkspaceQuickNav
          chatBusy={busy}
          chatCapabilities={chatCapabilities}
          chatMessages={chatMessages}
          mode={paletteMode}
          onChatSend={onChatSend}
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
    gap: 10,
    minHeight: 62,
    paddingHorizontal: 12,
    paddingVertical: 8,
    zIndex: 20
  },
  topbarMap: {
    alignItems: "center",
    gap: 6,
    minHeight: 52,
    paddingHorizontal: 8,
    paddingVertical: 4
  },
  topbarNarrow: {
    alignItems: "flex-start",
    flexWrap: "wrap"
  },
  topbarCopy: {
    flexGrow: 0,
    flexShrink: 1,
    maxWidth: 140,
    minWidth: 0
  },
  topbarTrail: {
    flex: 1,
    minWidth: 180,
    paddingHorizontal: 4
  },
  topbarTitle: {
    color: colors.ink,
    fontFamily: fonts.story,
    fontSize: 21
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
  topbarActions: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 5,
    marginLeft: "auto",
    minWidth: 0
  },
  topbarActionsNarrow: {
    flexBasis: "100%",
    marginLeft: 0,
    width: "100%"
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
    minHeight: 0,
    minWidth: 0
  },
  structureExpandedHeader: {
    alignItems: "center",
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 8,
    paddingVertical: 6
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
  inspectorRegion: {
    borderLeftColor: colors.line,
    borderLeftWidth: 1,
    minHeight: 0,
    minWidth: 0,
    width: 310
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
    minHeight: 0
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
