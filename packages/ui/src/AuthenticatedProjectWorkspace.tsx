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
import { ManuscriptTree, type SceneMoveDestination } from "./ManuscriptTree.js";
import {
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
  WorkspaceChatPanel,
  type WorkspaceChatMessage
} from "./WorkspaceChatPanel.js";

export type ProjectWorkspaceMode = "draft" | "canvas" | "split";

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
  renderDraft?(scene: ProjectNavigatorScene | undefined): ReactNode;
  chatCapabilities?: readonly GhostwriterCapability[];
  chatMessages?: readonly WorkspaceChatMessage[];
  onChatSend?(message: string): Promise<void> | void;
}>;

const { colors, fonts, shell } = ghostwriterTheme;

type CollapsedPanel = "tree" | "inspector";

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
  const drillScope = currentDrillScope(drillStack);
  const drillTrail = drillBreadcrumbs(drillStack, project);

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
    if (!wide && mode === "split") onModeChange("draft");
  }, [mode, onModeChange, wide]);

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

  useEffect(() => {
    if (
      selectedSceneId === undefined &&
      projectScenes[0] !== undefined
    ) {
      onSelectedSceneIdChange(projectScenes[0].id);
    }
  }, [onSelectedSceneIdChange, projectScenes, selectedSceneId]);

  function chooseSelection(next: ManuscriptSelection): void {
    setSelection(next);
    if (next.kind === "scene") onSelectedSceneIdChange(next.sceneId);
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
        if (!wide) setCollapsedPanel("tree");
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
      onClose={wide ? undefined : () => setCollapsedPanel("tree")}
      onCommand={onCommand}
      onReorder={reorderSelection}
      project={project}
      selectedSceneId={selectedSceneId}
      selection={selection}
    />
  );
  const draftVisible = mode === "draft" || mode === "split";
  const centerTitle =
    drillScope.kind === "scene"
      ? (drillTrail[drillTrail.length - 1]?.label ?? selectedScene?.title)
      : drillScope.kind === "chapter"
        ? (drillTrail[drillTrail.length - 1]?.label ?? "Chapter lens")
        : (selectedScene?.title ?? "Shape the manuscript");

  return (
    <View style={styles.screen}>
      <View style={[styles.topbar, narrow && styles.topbarNarrow]}>
        <Button disabled={busy} label="← Projects" onPress={onBack} />
        <View style={styles.topbarCopy}>
          <Text numberOfLines={1} style={styles.topbarTitle}>
            {project.title}
          </Text>
          <Text numberOfLines={1} style={styles.topbarMeta}>
            {profileDisplayName} · project version {project.version}
          </Text>
        </View>
        <View style={styles.topbarActions}>
          {allChangesIdle ? (
            <Text
              accessibilityLiveRegion="polite"
              style={styles.aggregateStatus}
            >
              All changes saved
            </Text>
          ) : null}
          {!wide ? (
            <>
              <Button
                label={
                  collapsedPanel === "tree"
                    ? "Hide manuscript tree"
                    : "Show manuscript tree"
                }
                onPress={() =>
                  setCollapsedPanel((current) =>
                    current === "tree" ? "inspector" : "tree"
                  )
                }
                selected={collapsedPanel === "tree"}
              />
              <Button
                label={
                  collapsedPanel === "inspector"
                    ? "Hide inspector"
                    : "Show inspector"
                }
                onPress={() =>
                  setCollapsedPanel((current) =>
                    current === "inspector" ? "tree" : "inspector"
                  )
                }
                selected={collapsedPanel === "inspector"}
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
        </View>
      </View>

      {narrow ? (
        <View
          accessibilityLabel="Writing workspace modes"
          style={styles.narrowModes}
        >
          <Button
            label="Draft"
            onPress={() => onModeChange("draft")}
            selected={mode === "draft"}
          />
          <Button
            label="Canvas"
            onPress={() => onModeChange("canvas")}
            selected={mode === "canvas"}
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
        {!narrow ? (
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

        {wide || collapsedPanel === "tree" ? (
          <View
            style={[
              styles.treeRegion,
              !wide && styles.collapsedRegion,
              narrow && styles.narrowRegion
            ]}
          >
            {tree}
          </View>
        ) : null}

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
          <View style={styles.centerHeading}>
            <View style={styles.centerHeadingCopy}>
              <Text style={styles.centerEyebrow}>
                {mode === "draft"
                  ? "Focused Draft"
                  : mode === "canvas"
                    ? "Story Canvas"
                    : "Draft + Canvas"}
              </Text>
              <Text style={styles.centerTitle}>{centerTitle}</Text>
            </View>
            <Text style={styles.centerRule}>
              Tree order is canonical. Canvas relationships never reorder Draft.
            </Text>
          </View>
          {canvasVisible ? (
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
          <View
            ref={splitSurfaceRef}
            style={[
              styles.workSurface,
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
                {renderDraft?.(selectedScene) ?? (
                  <View style={styles.empty}>
                    <Text style={styles.emptyTitle}>Choose or create a scene</Text>
                    <Text style={styles.emptyText}>
                      Draft opens one canonical manuscript scene at a time.
                    </Text>
                  </View>
                )}
              </View>
            ) : null}
          </View>
        </ScrollView>

        {wide || collapsedPanel === "inspector" ? (
          <View
            style={[
              styles.inspectorRegion,
              !wide && styles.collapsedRegion,
              narrow && styles.narrowRegion
            ]}
          >
            {inspector}
          </View>
        ) : null}

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
    position: "relative"
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
  topbarNarrow: {
    alignItems: "flex-start",
    flexWrap: "wrap"
  },
  topbarCopy: {
    flex: 1,
    minWidth: 150
  },
  topbarTitle: {
    color: colors.ink,
    fontFamily: fonts.story,
    fontSize: 21
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
  aggregateStatus: {
    color: colors.green,
    fontFamily: fonts.uiSemibold,
    fontSize: 8
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
    gap: 7,
    minHeight: 0,
    paddingHorizontal: 5,
    paddingVertical: 9,
    width: shell.railWidth + 10
  },
  railProject: {
    color: "#ffffff",
    fontFamily: fonts.brand,
    fontSize: 22,
    marginBottom: 4,
    textAlign: "center"
  },
  railButton: {
    alignItems: "center",
    borderColor: "transparent",
    borderRadius: 7,
    borderWidth: 1,
    gap: 2,
    justifyContent: "center",
    minHeight: 46
  },
  railButtonSelected: {
    backgroundColor: colors.railActive,
    borderColor: "#63554b"
  },
  railGlyph: {
    color: colors.railText,
    fontFamily: fonts.uiSemibold,
    fontSize: 11
  },
  railLabel: {
    color: colors.railText,
    fontFamily: fonts.uiMedium,
    fontSize: 7
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
    fontSize: 6,
    lineHeight: 9,
    textAlign: "center"
  },
  treeRegion: {
    borderRightColor: colors.line,
    borderRightWidth: 1,
    minHeight: 0,
    minWidth: 0,
    width: 292
  },
  inspectorRegion: {
    borderLeftColor: colors.line,
    borderLeftWidth: 1,
    minHeight: 0,
    minWidth: 0,
    width: 310
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
    flex: 0,
    maxHeight: 430,
    width: "100%"
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
    minWidth: 180
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
  workSurfaceSplit: {
    alignItems: "stretch",
    gap: 0
  },
  workSurfaceNarrow: {
    flexDirection: "column"
  },
  workSurfacePane: {
    flex: 1,
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
