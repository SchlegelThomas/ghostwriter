import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
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
  AcknowledgementToastHost,
  type AcknowledgementToast
} from "./AcknowledgementToastHost.js";
import {
  currentDrillScope,
  drillBreadcrumbs,
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
import {
  quickBuildOptions,
  storyTrail,
  structureLaunchpad,
  type QuickBuildOption
} from "./workspace-structure.js";
import {
  WorkspaceChatPanel,
  type WorkspaceChatMessage
} from "./WorkspaceChatPanel.js";

export type ProjectWorkspaceMode = "draft" | "canvas" | "split";

export type DraftWorkspacePresentation = Readonly<{
  contextDockOpen: boolean;
  focusHalo: boolean;
  historyOpen: boolean;
  narrow: boolean;
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
  toasts?: readonly AcknowledgementToast[];
  onBack(): void;
  onRefresh(): void;
  onSignOut(): void;
  onCommand(command: ProjectCommand): Promise<boolean>;
  onModeChange(mode: ProjectWorkspaceMode): void;
  onSelectedSceneIdChange(sceneId: SceneId | undefined): void;
  onOpenReader?(): void;
  onToastAction?(id: string): void;
  onToastDismiss?(id: string): void;
  onToastPause?(id: string): void;
  onToastResume?(id: string): void;
  drillStack?: CanvasDrillStack;
  workflowLens?: CanvasWorkflowLens;
  onDrillBack?(): void;
  onDrillTo?(scope: CanvasDrillScope): void;
  onEnterChapter?(
    selection: Extract<ManuscriptSelection, { kind: "chapter" }>
  ): void;
  onWorkflowLensChange?(lens: CanvasWorkflowLens): void;
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
    >
      <Text style={[styles.railGlyph, selected && styles.railTextSelected]}>
        {glyph}
      </Text>
      <Text style={[styles.railLabel, selected && styles.railTextSelected]}>
        {label}
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
  toasts = [],
  onBack,
  onRefresh,
  onSignOut,
  onCommand,
  onModeChange,
  onSelectedSceneIdChange,
  onOpenReader,
  onToastAction = () => undefined,
  onToastDismiss = () => undefined,
  onToastPause = () => undefined,
  onToastResume = () => undefined,
  drillStack = [{ kind: "project" }],
  workflowLens = "outline",
  onDrillBack = () => undefined,
  onDrillTo = () => undefined,
  onEnterChapter = () => undefined,
  onWorkflowLensChange = () => undefined,
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
  const [chatOpen, setChatOpen] = useState(false);
  const [contextDockOpen, setContextDockOpen] = useState(true);
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
  const structureCollapsible = canvasVisible && !narrow;
  const [structureRail, setStructureRail] = useState<MapStructureRailMode>(() =>
    defaultMapStructureRail(mode, width >= 760)
  );
  const mapDense = mapBoardOwnsViewport(mode);
  const drillScope = currentDrillScope(drillStack);
  const drillTrail = drillBreadcrumbs(drillStack, project);
  const structureWidth = mapStructureRailWidth(
    structureRail,
    structureCollapsible
  );
  const quickBuildVisible = mapStructureQuickBuildVisible(mode, structureRail);
  const structureCollapsed = structureRail === "collapsed";

  useEffect(() => {
    setStructureRail(defaultMapStructureRail(mode, structureCollapsible));
  }, [mode, structureCollapsible]);

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
  const [treeAddRequest, setTreeAddRequest] =
    useState<ManuscriptTreeAddRequest>();
  const quickBuildRequestId = useRef(0);
  const trail = storyTrail(project, selection);
  const quickOptions = quickBuildOptions(project, selection);
  const launchpad = structureLaunchpad(project, selection);
  const launchpadVisible =
    mode === "draft" && selection.kind !== "scene" && launchpad !== undefined;
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
  }, []);

  function dispatchQuickBuild(option: QuickBuildOption): void {
    setQuickBuildOpen(false);
    if (!wide) setCollapsedPanel("tree");
    quickBuildRequestId.current += 1;
    setTreeAddRequest({
      selectionKey: manuscriptSelectionKey(option.parent),
      requestId: quickBuildRequestId.current
    });
  }

  function openLaunchpadScene(scene: ProjectNavigatorScene): void {
    const next = sceneSelection(project, scene.id);
    if (next === undefined) return;
    chooseSelection(next);
    onModeChange("draft");
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
    ? launchpad.title
    : drillScope.kind === "scene"
      ? (drillTrail[drillTrail.length - 1]?.label ?? selectedScene?.title)
      : drillScope.kind === "chapter"
        ? (drillTrail[drillTrail.length - 1]?.label ?? "Chapter lens")
        : (selectedScene?.title ?? "Shape the manuscript");
  const centerEyebrow = launchpadVisible
    ? launchpad.eyebrow
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
                  ? `Story Trail, current scope ${item.label}`
                  : `Story Trail, go to ${item.label}`
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

  return (
    <View style={styles.screen}>
      <View
        style={[
          styles.topbar,
          mapDense && styles.topbarMap,
          narrow && styles.topbarNarrow
        ]}
      >
        <Button disabled={busy} label="← Projects" onPress={onBack} />
        {structureCollapsible && mapDense ? (
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
            style={[styles.topbarTitle, mapDense && styles.topbarTitleMap]}
          >
            {project.title}
          </Text>
          {mapDense ? null : (
            <Text numberOfLines={1} style={styles.topbarMeta}>
              {profileDisplayName} · project version {project.version}
            </Text>
          )}
        </View>
        {wide && mapDense && !focusHalo ? (
          <View style={styles.topbarTrail}>{storyTrailNodes}</View>
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
              {mapDense ? "Saved" : "All changes saved"}
            </Text>
          ) : null}
          {mapDense ? (
            <Button disabled={busy} label="Sign out" onPress={onSignOut} />
          ) : (
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
              {onChatSend === undefined ? null : (
                <Button
                  disabled={busy}
                  label={chatOpen ? "Hide chat" : "Chat"}
                  onPress={() => setChatOpen((current) => !current)}
                  selected={chatOpen}
                />
              )}
              <Button disabled={busy} label="Sign out" onPress={onSignOut} />
            </>
          )}
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
              onPress={() => onModeChange("draft")}
              selected={mode === "draft"}
            />
            <RailButton
              disabled={busy}
              glyph="C"
              label="Canvas"
              onPress={() => onModeChange("canvas")}
              selected={mode === "canvas"}
            />
            {wide ? (
              <RailButton
                disabled={busy}
                glyph="S"
                label="Split"
                onPress={() => onModeChange("split")}
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
            {onChatSend === undefined ? null : (
              <RailButton
                disabled={busy}
                glyph="M"
                label="Chat"
                onPress={() => setChatOpen((current) => !current)}
                selected={chatOpen}
              />
            )}
            <View style={styles.railSpacer} />
            <Text style={styles.railAuthority}>Tree = order</Text>
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
        </View>

        {(() => {
          const centerChrome = focusHalo ? null : (
            <>
              {mapDense && wide ? null : (
                <View style={styles.storyTrailRow}>
                  {storyTrailNodes}
                  {quickOptions.length === 0 || !quickBuildVisible ? null : (
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
              {mapDense ? null : (
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
              mapDense && styles.workSurfaceMap,
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
                {launchpadVisible && mode === "draft" ? (
                  <View
                    accessibilityLabel="Scene Launchpad"
                    style={styles.launchpad}
                  >
                    <Text style={styles.launchpadDescription}>
                      {launchpad.description}
                    </Text>
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
                      {launchpad.storyboardChapter === undefined ? null : (
                        <Button
                          disabled={busy}
                          label="Storyboard on Canvas"
                          onPress={() => {
                            const chapter = launchpad.storyboardChapter;
                            if (chapter === undefined) return;
                            chooseSelection(chapter);
                            onEnterChapter(chapter);
                            onModeChange("canvas");
                          }}
                        />
                      )}
                    </View>
                    {launchpad.scenes.length === 0 ? null : (
                      <View
                        accessibilityLabel="Scene launch list"
                        style={styles.launchpadScenes}
                      >
                        {launchpad.scenes.map((scene) => (
                          <Pressable
                            accessibilityLabel={`Open scene ${scene.title}`}
                            accessibilityRole="button"
                            disabled={busy}
                            key={scene.id}
                            onPress={() => openLaunchpadScene(scene)}
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
                              {scene.status} · open in Draft
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                    )}
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
          if (mapDense) {
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

        {chatOpen && onChatSend !== undefined ? (
          <View
            style={[
              styles.chatRegion,
              narrow && styles.narrowRegion
            ]}
          >
            <WorkspaceChatPanel
              busy={busy}
              capabilities={chatCapabilities}
              messages={chatMessages}
              onClose={() => setChatOpen(false)}
              onSend={onChatSend}
              open={chatOpen}
            />
          </View>
        ) : null}
      </View>

      <AcknowledgementToastHost
        onAction={onToastAction}
        onDismiss={onToastDismiss}
        onPause={onToastPause}
        onResume={onToastResume}
        toasts={toasts}
      />
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
    gap: 6,
    minHeight: 36,
    paddingHorizontal: 8,
    paddingVertical: 2
  },
  topbarNarrow: {
    alignItems: "flex-start",
    flexWrap: "wrap"
  },
  topbarCopy: {
    flexGrow: 0,
    flexShrink: 1,
    maxWidth: 220,
    minWidth: 0
  },
  topbarTrail: {
    flex: 1,
    minWidth: 0,
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
    minWidth: 0
  },
  topbarActionsNarrow: {
    flexBasis: "100%",
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
    gap: 4,
    minHeight: 0,
    paddingHorizontal: 3,
    paddingVertical: 8,
    width: shell.railWidth
  },
  railProject: {
    color: "#ffffff",
    fontFamily: fonts.brand,
    fontSize: 16,
    marginBottom: 2,
    textAlign: "center"
  },
  railButton: {
    alignItems: "center",
    borderColor: "transparent",
    borderRadius: 6,
    borderWidth: 1,
    gap: 1,
    justifyContent: "center",
    minHeight: 34
  },
  railButtonSelected: {
    backgroundColor: colors.railActive,
    borderColor: "#63554b"
  },
  railGlyph: {
    color: colors.railText,
    fontFamily: fonts.uiSemibold,
    fontSize: 10
  },
  railLabel: {
    color: colors.railText,
    fontFamily: fonts.uiMedium,
    fontSize: 6
  },
  railTextSelected: {
    color: "#ffffff"
  },
  railSpacer: {
    flex: 1
  },
  railAuthority: {
    color: colors.railText,
    fontFamily: fonts.ui,
    fontSize: 5,
    lineHeight: 8,
    textAlign: "center"
  },
  treeRegion: {
    borderRightColor: colors.line,
    borderRightWidth: 1,
    minHeight: 0,
    minWidth: 0,
    overflow: "hidden",
    width: shell.navigatorWidth
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
    fontSize: 9
  },
  storyTrailButton: {
    borderColor: "transparent",
    borderRadius: 5,
    borderWidth: 1,
    maxWidth: 200,
    paddingHorizontal: 5,
    paddingVertical: 3
  },
  storyTrailCurrent: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent
  },
  storyTrailText: {
    color: colors.muted,
    fontFamily: fonts.uiMedium,
    fontSize: 8
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
    gap: 12,
    padding: 18,
    width: "100%"
  },
  launchpadDescription: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 9.5,
    lineHeight: 15,
    maxWidth: 520
  },
  launchpadActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7
  },
  launchpadScenes: {
    gap: 5,
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
