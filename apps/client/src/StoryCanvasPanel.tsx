import type {
  CanvasCommand,
  CanvasLink,
  CanvasLinkKind,
  CanvasObject,
  CanvasObjectId,
  CanvasRevisionId,
  CanvasScopePlacement,
  ProjectNavigator,
  ProjectNavigatorScene,
  SceneId,
  StoryKnowledgeId
} from "@ghostwriter/core";
import { resolveObjectGeometry } from "@ghostwriter/core";
import {
  CANVAS_CAMERA_TRANSITION_MS,
  CANVAS_WORKFLOW_LENSES,
  PROVISIONAL_BEAT_FIXTURE_SOURCE,
  canvasDrillScopeKey,
  chapterBoundOverlays,
  currentDrillScope,
  easeOutCubic,
  ghostwriterTheme,
  interpolateCanvasViewport,
  projectCanvasLensProjection,
  readPrefersReducedMotion,
  sceneDrillScope,
  targetViewportForDrillScope,
  workflowLensLabel,
  type CanvasDrillScope,
  type CanvasDrillStack,
  type CanvasWorkflowLens
} from "@ghostwriter/ui";
import {
  createElement,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import {
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent
} from "react-native";
import type {
  CanvasPreferenceResponse,
  CanvasHistoryResponse,
  CanvasSceneGeometryInput,
  CanvasScenePlacementInput,
  CanvasWorkspaceResponse
} from "./api.js";
import {
  CANVAS_TOOL_DEFINITIONS,
  canvasBoardCursor,
  canvasToolAccessibilityLabel,
  canvasToolTip,
  isCanvasPlaceTool,
  objectAtScreenPoint,
  panViewportByScreenDelta,
  pinchDistance,
  shouldBackgroundPanBoard,
  shouldDragObjects,
  shouldPanBoard,
  type LinkDragState
} from "./canvas-interaction.js";
import {
  availableCanvasStoryKnowledge,
  canvasChapterAggregates,
  canonicalIndexForCanvasHandoff,
  canvasCapturePosition,
  canvasCanonicalReferenceState,
  canvasDriftLabel,
  canvasHistoryLabel,
  canvasPositionAfterDrag,
  canvasScreenFrame,
  canvasWorldPointFromScreen,
  CANVAS_VIEW_MAX_ZOOM,
  CANVAS_VIEW_MIN_ZOOM,
  clampCanvasZoom,
  fitCanvasObjects,
  projectCanvasOutline,
  searchCanvasObjects,
  visibleCanvasObjects,
  zoomViewportAtScreenPoint,
  type CanvasTool,
  type CanvasViewport,
  type CanvasViewportSize
} from "./canvas-model.js";

const { colors, fonts } = ghostwriterTheme;
const OBJECT_NUDGE = 24;
const OBJECT_RESIZE = 24;

const LENS_GLYPHS: Readonly<Record<CanvasWorkflowLens, string>> = {
  outline: "☰",
  relationships: "⇄",
  continuity: "◎",
  "plan-draft": "→",
  review: "◷"
};

function canvasScopeRefFromDrill(scope: CanvasDrillScope): Readonly<{
  scopeKind: "project" | "chapter" | "scene";
  scopeId?: string;
}> {
  switch (scope.kind) {
    case "project":
      return { scopeKind: "project" };
    case "chapter":
      return { scopeKind: "chapter", scopeId: scope.chapterId };
    case "scene":
      return { scopeKind: "scene", scopeId: scope.sceneId };
  }
}

function withResolvedGeometry(
  object: CanvasObject,
  placements: readonly CanvasScopePlacement[],
  scope: CanvasDrillScope
): CanvasObject {
  const geometry = resolveObjectGeometry(
    object,
    placements,
    canvasScopeRefFromDrill(scope)
  );
  return { ...object, ...geometry };
}

export type CanvasPanelMessage = Readonly<{
  kind: "error" | "conflict";
  text: string;
}>;

export type StoryCanvasPanelProps = Readonly<{
  project: ProjectNavigator;
  workspace?: CanvasWorkspaceResponse;
  preference?: CanvasPreferenceResponse | null;
  selectedSceneId?: SceneId;
  selectedObjectId?: CanvasObjectId;
  loading?: boolean;
  busy?: boolean;
  condensed?: boolean;
  saveState?: "saved" | "saving" | "error" | "conflict";
  message?: CanvasPanelMessage;
  history?: CanvasHistoryResponse;
  historyLoading?: boolean;
  onCommand(command: CanvasCommand): Promise<boolean>;
  onCreateScene(input: {
    title: string;
    manuscriptPlacement: CanvasScenePlacementInput;
    canvas: CanvasSceneGeometryInput;
  }): Promise<SceneId | undefined>;
  onPreferenceChange(input: {
    x: number;
    y: number;
    zoom: number;
    selectedObjectId?: CanvasObjectId | null;
  }): Promise<void>;
  onLoadHistory(): Promise<void>;
  onReload(): Promise<void>;
  onRestoreRevision(revisionId: CanvasRevisionId): Promise<boolean>;
  onSelectObject(objectId: CanvasObjectId | undefined): void;
  onSelectScene(sceneId: SceneId): void;
  onOpenDraft?(sceneId: SceneId): void;
  onOpenSplit?(sceneId: SceneId): void;
  onUndo(): Promise<void>;
  drillStack?: CanvasDrillStack;
  workflowLens?: CanvasWorkflowLens;
  onWorkflowLensChange?(lens: CanvasWorkflowLens): void;
  onDrillBack?(): void;
  onDrillIntoChapter?(
    scope: Extract<CanvasDrillScope, { kind: "chapter" }>
  ): void;
  onDrillIntoScene?(
    scope: Extract<CanvasDrillScope, { kind: "scene" }>
  ): void;
}>;

type CanvasView = "spatial" | "outline";

function CanvasButton({
  label,
  onPress,
  disabled = false,
  primary = false,
  danger = false,
  selected = false
}: Readonly<{
  label: string;
  onPress(): void;
  disabled?: boolean;
  primary?: boolean;
  danger?: boolean;
  selected?: boolean;
}>) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        primary && styles.buttonPrimary,
        danger && styles.buttonDanger,
        selected && styles.buttonSelected,
        pressed && styles.pressed,
        disabled && styles.disabled
      ]}
    >
      <Text
        style={[
          styles.buttonText,
          primary && styles.buttonTextPrimary,
          danger && styles.buttonTextDanger,
          selected && styles.buttonTextSelected
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function Field({
  label,
  value,
  onChangeText,
  disabled = false,
  multiline = false,
  numeric = false,
  placeholder
}: Readonly<{
  label: string;
  value: string;
  onChangeText(value: string): void;
  disabled?: boolean;
  multiline?: boolean;
  numeric?: boolean;
  placeholder?: string;
}>) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        editable={!disabled}
        inputMode={numeric ? "decimal" : "text"}
        multiline={multiline}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        style={[styles.input, multiline && styles.inputMultiline]}
        value={value}
      />
    </View>
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

function saveStateLabel(
  state: StoryCanvasPanelProps["saveState"],
  loading: boolean
): string {
  if (loading) return "Loading Canvas…";
  if (state === "saving") return "Saving…";
  if (state === "error") return "Not saved";
  if (state === "conflict") return "Review latest Canvas";
  return "Saved to Canvas";
}

function objectKindLabel(object: CanvasObject): string {
  switch (object.kind) {
    case "scene-card":
      return "Scene card";
    case "story-knowledge-card":
      return "Story knowledge";
    case "note":
      return "Writer note";
    case "region":
      return "Region";
    case "image-reference":
      return "Image metadata";
  }
}

function objectDetail(
  object: CanvasObject,
  scenes: ReadonlyMap<SceneId, ProjectNavigatorScene>,
  project: ProjectNavigator
): string {
  const canonicalState = canvasCanonicalReferenceState(object, project);
  let detail: string;
  if (object.kind === "scene-card" && object.sceneId !== undefined) {
    const scene = scenes.get(object.sceneId);
    detail = scene?.summary ?? `${scene?.status ?? "Scene"} · shared with Draft`;
  } else if (
    object.kind === "story-knowledge-card" &&
    object.storyKnowledgeId !== undefined
  ) {
    const knowledge = project.storyKnowledge.find(
      (candidate) => candidate.id === object.storyKnowledgeId
    );
    detail = knowledge === undefined
      ? "Referenced story record is unavailable"
      : `${knowledge.kind} · ${knowledge.authority}`;
  } else if (object.kind === "note") {
    detail = object.note?.body ?? "Writer note";
  } else if (object.kind === "region") {
    detail = "A spatial grouping; it does not change manuscript order.";
  } else {
    detail =
      object.image?.caption ??
      object.image?.altText ??
      "Local image-reference metadata placeholder";
  }
  return canonicalState.label === undefined
    ? detail
    : `${canonicalState.label}. ${detail}`;
}

function linkStateLabel(link: CanvasLink): string {
  if (link.dismissedAt !== undefined) return "Dismissed";
  if (link.archivedAt !== undefined) return "Archived";
  return link.authority === "provisional"
    ? "Provisional fixture"
    : "Confirmed";
}

function CanvasIconButton({
  glyph,
  label,
  tip,
  onPress,
  disabled = false,
  selected = false
}: Readonly<{
  glyph: string;
  label: string;
  tip: string;
  onPress(): void;
  disabled?: boolean;
  selected?: boolean;
}>) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={onPress}
      // RN web tooltip
      {...({ title: tip } as object)}
      style={({ pressed }) => [
        styles.iconButton,
        selected && styles.iconButtonSelected,
        pressed && styles.pressed,
        disabled && styles.disabled
      ]}
    >
      <Text
        style={[
          styles.iconButtonGlyph,
          selected && styles.iconButtonGlyphSelected
        ]}
      >
        {glyph}
      </Text>
    </Pressable>
  );
}

function CanvasModal({
  accessibilityLabel,
  eyebrow,
  title,
  rule,
  children,
  footer,
  onClose
}: Readonly<{
  accessibilityLabel: string;
  eyebrow: string;
  title: string;
  rule?: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose(): void;
}>) {
  return (
    <View
      accessibilityLabel={accessibilityLabel}
      accessibilityViewIsModal
      style={styles.modalRoot}
    >
      <Pressable
        accessibilityLabel="Dismiss dialog"
        accessibilityRole="button"
        onPress={onClose}
        style={styles.modalBackdrop}
      />
      <View style={styles.modalCard}>
        <View style={styles.modalHeader}>
          <View style={styles.headingCopy}>
            <Text style={styles.modalEyebrow}>{eyebrow}</Text>
            <Text style={styles.modalTitle}>{title}</Text>
            {rule === undefined ? null : (
              <Text style={styles.modalRule}>{rule}</Text>
            )}
          </View>
          <Pressable
            accessibilityLabel="Close dialog"
            accessibilityRole="button"
            onPress={onClose}
            style={({ pressed }) => [
              styles.modalClose,
              pressed && styles.pressed
            ]}
          >
            <Text style={styles.modalCloseText}>×</Text>
          </Pressable>
        </View>
        <ScrollView
          contentContainerStyle={styles.modalBody}
          keyboardShouldPersistTaps="handled"
          style={styles.modalScroll}
        >
          {children}
        </ScrollView>
        {footer === undefined ? null : (
          <View style={styles.modalFooter}>{footer}</View>
        )}
      </View>
    </View>
  );
}

function LinkRubberBand({
  fromX,
  fromY,
  toX,
  toY,
  hot = false
}: Readonly<{
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  hot?: boolean;
}>) {
  const stroke = hot ? colors.green : colors.accent;
  if (typeof document !== "undefined") {
    return (
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        {createElement(
          "svg",
          {
            width: "100%",
            height: "100%",
            style: {
              overflow: "visible",
              pointerEvents: "none",
              position: "absolute",
              left: 0,
              top: 0
            }
          },
          createElement(
            "line",
            {
              x1: fromX,
              y1: fromY,
              x2: toX,
              y2: toY,
              stroke,
              strokeWidth: 2.5,
              strokeDasharray: "9 7",
              strokeLinecap: "round"
            },
            createElement("animate", {
              attributeName: "stroke-dashoffset",
              from: "32",
              to: "0",
              dur: "0.55s",
              repeatCount: "indefinite"
            })
          )
        )}
      </View>
    );
  }

  const width = Math.hypot(toX - fromX, toY - fromY);
  const angle = Math.atan2(toY - fromY, toX - fromX);
  return (
    <View
      pointerEvents="none"
      style={[
        styles.linkRubberBand,
        {
          borderTopColor: stroke,
          left: fromX,
          top: fromY,
          transform: [{ rotate: `${angle}rad` }, { translateY: -1 }],
          width: Math.max(4, width)
        }
      ]}
    />
  );
}

function SpatialObjectCard({
  object,
  viewport,
  selected,
  detail,
  staleLabel,
  dimmed = false,
  primary = false,
  dragEnabled,
  linkHandleVisible,
  onDismiss,
  onMove,
  onReview,
  onSelect,
  onDrillIntoScene,
  onContextMenu,
  onLinkDragStart,
  onNodeActions,
  onDragActiveChange,
  linkDropTarget = false
}: Readonly<{
  object: CanvasObject;
  viewport: CanvasViewport;
  selected: boolean;
  detail: string;
  staleLabel?: string;
  dimmed?: boolean;
  primary?: boolean;
  dragEnabled: boolean;
  linkHandleVisible: boolean;
  onDismiss(object: CanvasObject): Promise<void>;
  onMove(object: CanvasObject, x: number, y: number): Promise<void>;
  onReview(object: CanvasObject): void;
  onSelect(object: CanvasObject): void;
  onDrillIntoScene?(object: CanvasObject): void;
  onContextMenu?(object: CanvasObject, x: number, y: number): void;
  onLinkDragStart?(object: CanvasObject): void;
  onNodeActions?(object: CanvasObject, x: number, y: number): void;
  onDragActiveChange?(active: boolean): void;
  linkDropTarget?: boolean;
}>) {
  const [dragDelta, setDragDelta] = useState({ x: 0, y: 0 });
  const [pendingWorld, setPendingWorld] = useState<
    Readonly<{ x: number; y: number }> | undefined
  >();
  const [dragging, setDragging] = useState(false);
  const draggedRef = useRef(false);
  const dragStartRef = useRef<{ x: number; y: number } | undefined>(undefined);
  const dragRafRef = useRef(0);
  const latestDeltaRef = useRef({ x: 0, y: 0 });
  const baseObject =
    pendingWorld === undefined
      ? object
      : { ...object, x: pendingWorld.x, y: pendingWorld.y };
  const frame = canvasScreenFrame(baseObject, viewport);

  useEffect(() => {
    if (pendingWorld === undefined) return;
    if (object.x === pendingWorld.x && object.y === pendingWorld.y) {
      setPendingWorld(undefined);
    }
  }, [object.x, object.y, pendingWorld]);

  useEffect(() => {
    return () => {
      dragStartRef.current = undefined;
    };
  }, []);

  function handleContextMenu(event: GestureResponderEvent): void {
    if (onContextMenu === undefined) return;
    const native = event.nativeEvent as unknown as {
      pageX?: number;
      pageY?: number;
      clientX?: number;
      clientY?: number;
      preventDefault?: () => void;
    };
    native.preventDefault?.();
    onContextMenu(
      object,
      native.pageX ?? native.clientX ?? frame.left,
      native.pageY ?? native.clientY ?? frame.top
    );
  }

  function beginPointerDrag(clientX: number, clientY: number): void {
    if (!dragEnabled) {
      onSelect(object);
      return;
    }
    draggedRef.current = false;
    dragStartRef.current = { x: clientX, y: clientY };
    onSelect(object);
    const origin = { x: baseObject.x, y: baseObject.y };
    const commitMove = onMove;

    const handlePointerMove = (event: PointerEvent): void => {
      const start = dragStartRef.current;
      if (start === undefined) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
        if (!draggedRef.current) {
          draggedRef.current = true;
          setDragging(true);
          onDragActiveChange?.(true);
        }
        latestDeltaRef.current = { x: dx, y: dy };
        if (dragRafRef.current !== 0) return;
        dragRafRef.current = requestAnimationFrame(() => {
          dragRafRef.current = 0;
          setDragDelta(latestDeltaRef.current);
        });
      }
    };
    const handlePointerUp = (event: PointerEvent): void => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      if (dragRafRef.current !== 0) {
        cancelAnimationFrame(dragRafRef.current);
        dragRafRef.current = 0;
      }
      const start = dragStartRef.current;
      dragStartRef.current = undefined;
      const dx = start === undefined ? 0 : event.clientX - start.x;
      const dy = start === undefined ? 0 : event.clientY - start.y;
      const moved = draggedRef.current;
      setDragging(false);
      onDragActiveChange?.(false);
      draggedRef.current = false;
      if (!moved || !dragEnabled) {
        setDragDelta({ x: 0, y: 0 });
        return;
      }
      const next = canvasPositionAfterDrag(origin, { x: dx, y: dy }, viewport.zoom);
      // Keep the card at the drop point until the server board catches up.
      setPendingWorld(next);
      setDragDelta({ x: 0, y: 0 });
      void commitMove(object, next.x, next.y);
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  }

  function beginHandlePointer(clientX: number, clientY: number): void {
    onSelect(object);
    const start = { x: clientX, y: clientY };
    let moved = false;
    const handlePointerMove = (event: PointerEvent): void => {
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (!moved && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
        moved = true;
        onLinkDragStart?.(object);
      }
    };
    const handlePointerUp = (event: PointerEvent): void => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      if (!moved) {
        onNodeActions?.(object, event.clientX, event.clientY);
      }
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  }

  // Keep native PanResponder as a non-web fallback for spatial drag.
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => dragEnabled,
        onMoveShouldSetPanResponder: (_event, gesture) =>
          dragEnabled &&
          (Math.abs(gesture.dx) > 2 || Math.abs(gesture.dy) > 2),
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => dragEnabled,
        onPanResponderGrant: () => {
          draggedRef.current = false;
          onSelect(object);
        },
        onPanResponderMove: (_event, gesture) => {
          if (!dragEnabled) return;
          draggedRef.current = true;
          setDragging(true);
          onDragActiveChange?.(true);
          setDragDelta({ x: gesture.dx, y: gesture.dy });
        },
        onPanResponderRelease: (_event, gesture) => {
          const moved = draggedRef.current;
          setDragging(false);
          onDragActiveChange?.(false);
          draggedRef.current = false;
          if (!moved || !dragEnabled) {
            setDragDelta({ x: 0, y: 0 });
            return;
          }
          const next = canvasPositionAfterDrag(
            { x: baseObject.x, y: baseObject.y },
            { x: gesture.dx, y: gesture.dy },
            viewport.zoom
          );
          setPendingWorld(next);
          setDragDelta({ x: 0, y: 0 });
          void onMove(object, next.x, next.y);
        },
        onPanResponderTerminate: () => {
          setDragDelta({ x: 0, y: 0 });
          setDragging(false);
          onDragActiveChange?.(false);
          draggedRef.current = false;
        }
      }),
    [
      baseObject.x,
      baseObject.y,
      dragEnabled,
      object,
      onDragActiveChange,
      onMove,
      onSelect,
      viewport.zoom
    ]
  );

  const webPointer =
    typeof window !== "undefined"
      ? ({
          onPointerDown: (event: {
            button?: number;
            clientX: number;
            clientY: number;
            preventDefault?: () => void;
            stopPropagation?: () => void;
          }) => {
            if (event.button !== undefined && event.button !== 0) return;
            event.preventDefault?.();
            event.stopPropagation?.();
            beginPointerDrag(event.clientX, event.clientY);
          }
        } as object)
      : panResponder.panHandlers;

  return (
    <View
      {...webPointer}
      accessibilityLabel={`${objectKindLabel(object)} ${object.label}`}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      {...({
        onClick: () => {
          if (!draggedRef.current) onSelect(object);
        },
        onContextMenu: handleContextMenu,
        onDoubleClick: () => onDrillIntoScene?.(object)
      } as object)}
      style={[
        styles.spatialObject,
        object.kind === "scene-card" && styles.sceneObject,
        object.kind === "story-knowledge-card" && styles.knowledgeObject,
        object.kind === "note" && styles.noteObject,
        object.kind === "region" && styles.regionObject,
        object.kind === "image-reference" && styles.imageObject,
        object.authority === "provisional" && styles.provisionalObject,
        staleLabel !== undefined && styles.staleObject,
        dimmed && styles.dimmedObject,
        primary && styles.primaryObject,
        selected && styles.spatialObjectSelected,
        linkDropTarget && styles.spatialObjectLinkTarget,
        dragging && styles.spatialObjectDragging,
        {
          ...(object.kind === "note" && object.note?.color !== undefined
            ? { backgroundColor: object.note.color }
            : {}),
          height: Math.max(76, frame.height),
          left: frame.left + dragDelta.x,
          top: frame.top + dragDelta.y,
          width: Math.max(132, frame.width),
          zIndex: Math.round(object.z + (dragging || linkDropTarget ? 400 : 100))
        },
        typeof window !== "undefined"
          ? ({
              cursor: dragEnabled
                ? dragging
                  ? "grabbing"
                  : "grab"
                : "pointer",
              touchAction: "none",
              transform: dragging
                ? [{ scale: 1.03 }]
                : linkDropTarget
                  ? [{ scale: 1.02 }]
                  : [{ scale: 1 }],
              transition: dragging
                ? "box-shadow 140ms ease, border-color 140ms ease, transform 140ms ease"
                : "left 200ms cubic-bezier(0.22, 1, 0.36, 1), top 200ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 160ms ease, border-color 160ms ease, transform 160ms ease"
            } as object)
          : null
      ]}
    >
      <View style={styles.spatialObjectPressable}>
        <Text
          style={[
            styles.objectBadge,
            object.authority === "provisional" && styles.provisionalBadge
          ]}
        >
          {staleLabel ??
          (object.authority === "provisional"
            ? "Provisional fixture · not confirmed"
            : objectKindLabel(object))}
        </Text>
        <Text numberOfLines={2} style={styles.objectTitle}>
          {object.label}
        </Text>
        <Text numberOfLines={3} style={styles.objectDetail}>
          {detail}
        </Text>
      </View>
      {linkHandleVisible ? (
        <View
          accessibilityLabel={`Node actions for ${object.label}`}
          accessibilityRole="button"
          {...({
            onPointerDown: (event: {
              button?: number;
              clientX: number;
              clientY: number;
              preventDefault?: () => void;
              stopPropagation?: () => void;
            }) => {
              if (event.button !== undefined && event.button !== 0) return;
              event.preventDefault?.();
              event.stopPropagation?.();
              beginHandlePointer(event.clientX, event.clientY);
            },
            title: "Actions · click for menu · drag to link"
          } as object)}
          style={styles.linkHandle}
        >
          <Text style={styles.linkHandleGlyph}>+</Text>
        </View>
      ) : null}
      {object.authority === "provisional" &&
      object.archivedAt === undefined ? (
        <View style={styles.quickActionRow}>
          <Pressable
            accessibilityLabel={`Review provisional ${object.label}`}
            accessibilityRole="button"
            onPress={(event) => {
              event.stopPropagation();
              onReview(object);
            }}
            style={({ pressed }) => [
              styles.quickAction,
              pressed && styles.pressed
            ]}
          >
            <Text style={styles.quickActionText}>Review</Text>
          </Pressable>
          <Pressable
            accessibilityLabel={`Dismiss provisional ${object.label}`}
            accessibilityRole="button"
            onPress={(event) => {
              event.stopPropagation();
              void onDismiss(object);
            }}
            style={({ pressed }) => [
              styles.quickAction,
              styles.quickActionDanger,
              pressed && styles.pressed
            ]}
          >
            <Text style={[styles.quickActionText, styles.quickActionTextDanger]}>
              Dismiss
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function SpatialLink({
  link,
  from,
  to,
  viewport
}: Readonly<{
  link: CanvasLink;
  from: CanvasObject;
  to: CanvasObject;
  viewport: CanvasViewport;
}>) {
  const fromFrame = canvasScreenFrame(from, viewport);
  const toFrame = canvasScreenFrame(to, viewport);
  const start = {
    x: fromFrame.left + fromFrame.width / 2,
    y: fromFrame.top + fromFrame.height / 2
  };
  const end = {
    x: toFrame.left + toFrame.width / 2,
    y: toFrame.top + toFrame.height / 2
  };
  const width = Math.hypot(end.x - start.x, end.y - start.y);
  const angle = Math.atan2(end.y - start.y, end.x - start.x);

  return (
    <View
      pointerEvents="none"
      style={[
        styles.spatialLink,
        link.authority === "provisional" && styles.spatialLinkProvisional,
        {
          left: start.x,
          top: start.y,
          transform: [{ rotateZ: `${angle}rad` }],
          width,
          zIndex: 60
        }
      ]}
    />
  );
}

type SpineChromeMode = "minimized" | "bubbles" | "expanded";

function ReadingSpine({
  project,
  workspace,
  onSelectObject,
  onSelectScene
}: Readonly<{
  project: ProjectNavigator;
  workspace: CanvasWorkspaceResponse;
  onSelectObject(objectId: CanvasObjectId): void;
  onSelectScene(sceneId: SceneId): void;
}>) {
  const [chrome, setChrome] = useState<SpineChromeMode>("minimized");
  const [hoveredSceneId, setHoveredSceneId] = useState<SceneId>();
  const scenes = new Map(allScenes(project).map((scene) => [scene.id, scene]));
  const bookById = new Map(project.books.map((book) => [book.id, book]));
  const count = workspace.spine.entries.length;

  function cycleChrome(): void {
    setChrome((current) =>
      current === "minimized"
        ? "bubbles"
        : current === "bubbles"
          ? "expanded"
          : "minimized"
    );
  }

  return (
    <View
      accessibilityLabel="Reading-order spine"
      style={[
        styles.spine,
        chrome === "minimized" && styles.spineMinimized,
        chrome === "bubbles" && styles.spineCollapsed
      ]}
    >
      <View style={styles.spineHeading}>
        <Pressable
          accessibilityLabel={`Reading-order spine, ${count} scenes. Activate to change size.`}
          accessibilityRole="button"
          onPress={cycleChrome}
          style={({ pressed }) => [
            styles.spineMiniToggle,
            pressed && styles.pressed
          ]}
        >
          <Text style={styles.spineMiniLabel}>
            Spine · {count}
            {chrome === "minimized" ? " · ▴" : chrome === "bubbles" ? " · ▴▴" : " · ▾"}
          </Text>
        </Pressable>
        {chrome === "expanded" ? (
          <Text style={styles.spineRule}>
            Canvas position never silently reorders the manuscript.
          </Text>
        ) : null}
      </View>
      {chrome === "minimized" ? null : workspace.spine.entries.length === 0 ? (
        <Text style={styles.spineEmpty}>
          Create a scene to begin the canonical reading spine.
        </Text>
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.spineList,
            chrome === "bubbles" && styles.spineBubbleList
          ]}
          horizontal
          showsHorizontalScrollIndicator={chrome === "expanded"}
        >
          {workspace.spine.entries.map((entry) => {
            const scene = scenes.get(entry.sceneId);
            const book = bookById.get(entry.bookId);
            const staleLabel = entry.archived
              ? "Archived scene · stale Canvas reference"
              : scene === undefined
                ? "Scene unavailable · stale Canvas reference"
                : undefined;
            const title = scene?.title ?? "Unavailable scene";
            const hovered = hoveredSceneId === entry.sceneId;
            if (chrome === "bubbles") {
              return (
                <Pressable
                  accessibilityLabel={`Draft ${entry.canonicalIndex + 1}: ${title}, ${canvasDriftLabel(
                    entry.drift
                  )}`}
                  accessibilityRole="button"
                  key={entry.sceneId}
                  onPress={() => {
                    onSelectScene(entry.sceneId);
                    if (entry.canvasObjectId !== undefined) {
                      onSelectObject(entry.canvasObjectId);
                    }
                  }}
                  {...({
                    onMouseEnter: () => setHoveredSceneId(entry.sceneId),
                    onMouseLeave: () =>
                      setHoveredSceneId((current) =>
                        current === entry.sceneId ? undefined : current
                      ),
                    title: `${title} · ${canvasDriftLabel(entry.drift)}`
                  } as object)}
                  style={[
                    styles.spineBubble,
                    entry.canvasObjectId === undefined && styles.spineBubbleOpen,
                    staleLabel !== undefined && styles.spineBubbleArchived,
                    hovered && styles.spineBubbleHover,
                    typeof window !== "undefined"
                      ? ({
                          transform: hovered
                            ? [{ scale: 1.4 }]
                            : [{ scale: 1 }],
                          transition:
                            "transform 180ms cubic-bezier(0.22, 1, 0.36, 1)",
                          zIndex: hovered ? 8 : 1
                        } as object)
                      : null
                  ]}
                >
                  <Text style={styles.spineBubbleIndex}>
                    {entry.canonicalIndex + 1}
                  </Text>
                </Pressable>
              );
            }
            return (
              <Pressable
                accessibilityLabel={`Draft ${entry.canonicalIndex + 1}: ${title}, ${
                  staleLabel === undefined ? "" : `${staleLabel}, `
                }${canvasDriftLabel(entry.drift)}`}
                accessibilityRole="button"
                key={entry.sceneId}
                onPress={() => {
                  onSelectScene(entry.sceneId);
                  if (entry.canvasObjectId !== undefined) {
                    onSelectObject(entry.canvasObjectId);
                  }
                }}
                style={({ pressed }) => [
                  styles.spineEntry,
                  entry.canvasObjectId === undefined && styles.spineEntryOpen,
                  staleLabel !== undefined && styles.spineEntryArchived,
                  pressed && styles.pressed
                ]}
              >
                <Text style={styles.spineIndex}>
                  {entry.canonicalIndex + 1}
                </Text>
                <View style={styles.spineCopy}>
                  <Text numberOfLines={1} style={styles.spineScene}>
                    {title}
                  </Text>
                  <Text style={styles.spineMeta}>
                    {book?.title ?? "Unknown book"} ·{" "}
                    {entry.placement === "unassigned"
                      ? "Unassigned"
                      : "Chapter"}
                  </Text>
                  {staleLabel === undefined ? null : (
                    <Text style={styles.spineStale}>{staleLabel}</Text>
                  )}
                  <Text style={styles.spineDrift}>
                    {canvasDriftLabel(entry.drift)}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

function parseFinite(value: string): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseStoryOrderHint(value: string): number | undefined {
  if (value.trim().length === 0) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function canvasHistoryTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function StoryCanvasPanel({
  project,
  workspace,
  preference,
  history,
  historyLoading = false,
  selectedSceneId,
  selectedObjectId,
  loading = false,
  busy = false,
  condensed = false,
  saveState = "saved",
  message,
  onCommand,
  onCreateScene,
  onLoadHistory,
  onPreferenceChange,
  onReload,
  onRestoreRevision,
  onSelectObject,
  onSelectScene,
  onOpenDraft = () => undefined,
  onOpenSplit = () => undefined,
  onUndo,
  drillStack = [{ kind: "project" }],
  workflowLens = "outline",
  onWorkflowLensChange,
  onDrillBack = () => undefined,
  onDrillIntoChapter = () => undefined,
  onDrillIntoScene = () => undefined
}: StoryCanvasPanelProps) {
  // Match workspace narrow breakpoint so ordered Canvas and shell modes agree.
  const compact = useWindowDimensions().width < 760;
  const [view, setView] = useState<CanvasView>(compact ? "outline" : "spatial");
  const [viewport, setViewport] = useState<CanvasViewport>({
    x: 0,
    y: 0,
    zoom: 1
  });
  const [surfaceSize, setSurfaceSize] = useState<CanvasViewportSize>({
    width: 900,
    height: 560
  });
  const [showInspector, setShowInspector] = useState(false);
  const [activeTool, setActiveTool] = useState<CanvasTool>("select");
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [draggingObject, setDraggingObject] = useState(false);
  const [boardPanning, setBoardPanning] = useState(false);
  const [zoomRailOpen, setZoomRailOpen] = useState(false);
  const [linkDrag, setLinkDrag] = useState<LinkDragState>();
  const [linkDropTargetId, setLinkDropTargetId] = useState<CanvasObjectId>();
  const [pendingLink, setPendingLink] = useState<
    | Readonly<{
        fromObjectId: CanvasObjectId;
        toObjectId: CanvasObjectId;
      }>
    | undefined
  >();
  const [contextMenu, setContextMenu] = useState<
    | Readonly<{
        x: number;
        y: number;
        objectId?: CanvasObjectId;
      }>
    | undefined
  >();
  const [searchQuery, setSearchQuery] = useState("");
  const [showSceneForm, setShowSceneForm] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [objectLabel, setObjectLabel] = useState("");
  const [noteBody, setNoteBody] = useState("");
  const [noteColor, setNoteColor] = useState("");
  const [imageAltText, setImageAltText] = useState("");
  const [imageCaption, setImageCaption] = useState("");
  const [imageAssetId, setImageAssetId] = useState("");
  const [imageMimeType, setImageMimeType] = useState("");
  const [sceneOrderHint, setSceneOrderHint] = useState("");
  const [linkLabel, setLinkLabel] = useState("");
  const [linkKind, setLinkKind] = useState<CanvasLinkKind>("thread");
  const [linkTargetId, setLinkTargetId] = useState<CanvasObjectId>();
  const [selectedLinkId, setSelectedLinkId] = useState<CanvasLink["id"]>();
  const [selectedKnowledgeTargetId, setSelectedKnowledgeTargetId] =
    useState<StoryKnowledgeId>();
  const [selectedHistoryRevisionId, setSelectedHistoryRevisionId] =
    useState<CanvasRevisionId>();
  const [confirmHistoryRestore, setConfirmHistoryRestore] = useState(false);
  const [sceneTitle, setSceneTitle] = useState("");
  const [scenePlacement, setScenePlacement] = useState("");
  const [sceneStoryOrderHint, setSceneStoryOrderHint] = useState("");
  const [sceneX, setSceneX] = useState("160");
  const [sceneY, setSceneY] = useState("140");
  const [sceneWidth, setSceneWidth] = useState("260");
  const [sceneHeight, setSceneHeight] = useState("160");
  const [cameraTransitioning, setCameraTransitioning] = useState(false);
  const animationFrameRef = useRef<number | undefined>(undefined);
  const viewportByScopeRef = useRef(new Map<string, CanvasViewport>());
  const drillScope = currentDrillScope(drillStack);
  const previousDrillKeyRef = useRef(canvasDrillScopeKey(drillScope));
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const panOriginRef = useRef(viewport);
  const viewportPersistTimerRef = useRef<
    ReturnType<typeof setTimeout> | undefined
  >(undefined);
  const activeToolRef = useRef(activeTool);
  activeToolRef.current = activeTool;
  const spaceHeldRef = useRef(spaceHeld);
  spaceHeldRef.current = spaceHeld;
  const linkDragActiveRef = useRef(false);
  linkDragActiveRef.current = linkDrag !== undefined;
  const touchPointsRef = useRef(
    new Map<number, Readonly<{ x: number; y: number }>>()
  );
  const pinchSessionRef = useRef<
    | Readonly<{
        startDistance: number;
        startZoom: number;
        midpointX: number;
        midpointY: number;
      }>
    | undefined
  >(undefined);
  const boardPanGestureRef = useRef(false);

  function applyLiveViewport(next: CanvasViewport): void {
    const normalized = { ...next, zoom: clampCanvasZoom(next.zoom) };
    setViewport(normalized);
    viewportRef.current = normalized;
    if (viewportPersistTimerRef.current !== undefined) {
      clearTimeout(viewportPersistTimerRef.current);
    }
    viewportPersistTimerRef.current = setTimeout(() => {
      void onPreferenceChange({
        ...normalized,
        ...(selectedObjectId === undefined
          ? { selectedObjectId: null }
          : { selectedObjectId })
      });
    }, 180);
  }

  function rememberTouchPoint(
    pointerId: number,
    clientX: number,
    clientY: number
  ): void {
    if (typeof document === "undefined") return;
    const surface = document.getElementById("story-canvas-surface");
    if (surface === null) return;
    const rect = surface.getBoundingClientRect();
    touchPointsRef.current.set(pointerId, {
      x: clientX - rect.left,
      y: clientY - rect.top
    });
    if (touchPointsRef.current.size === 2) {
      const points = [...touchPointsRef.current.values()];
      const a = points[0]!;
      const b = points[1]!;
      pinchSessionRef.current = {
        startDistance: Math.max(1, pinchDistance(a, b)),
        startZoom: viewportRef.current.zoom,
        midpointX: (a.x + b.x) / 2,
        midpointY: (a.y + b.y) / 2
      };
    }
  }

  const board = workspace?.board;
  const scopePlacements = board?.scopePlacements ?? [];
  const scenes = useMemo(
    () => new Map(allScenes(project).map((scene) => [scene.id, scene])),
    [project]
  );
  const selectedObject = board?.objects.find(
    (object) => object.id === selectedObjectId
  );
  const selectedObjectDisplay =
    selectedObject === undefined
      ? undefined
      : withResolvedGeometry(selectedObject, scopePlacements, drillScope);
  const selectedCanonicalState =
    selectedObject === undefined
      ? undefined
      : canvasCanonicalReferenceState(selectedObject, project);
  const selectedLink = board?.links.find((link) => link.id === selectedLinkId);
  const activeObjects =
    board?.objects.filter((object) => object.archivedAt === undefined) ?? [];
  const lensProjection =
    board === undefined
      ? undefined
      : projectCanvasLensProjection(
          project,
          board,
          drillScope,
          workflowLens
        );
  const projectedObjects = (lensProjection?.objects ?? activeObjects).map(
    (object) => withResolvedGeometry(object, scopePlacements, drillScope)
  );
  const projectedLinks = lensProjection?.links ?? [];
  const activeLinks =
    workflowLens === "relationships" ||
    workflowLens === "continuity" ||
    workflowLens === "review"
      ? projectedLinks
      : (board?.links.filter((link) => link.archivedAt === undefined) ?? []);
  const objectById = new Map(
    (board?.objects ?? []).map((object) => [
      object.id,
      withResolvedGeometry(object, scopePlacements, drillScope)
    ])
  );
  const outline =
    board === undefined || workspace === undefined
      ? []
      : projectCanvasOutline(board, workspace.spine);
  const projectedObjectIds = new Set(
    projectedObjects.map((object) => object.id)
  );
  const orderedOutline = outline.filter(
    (item) =>
      projectedObjectIds.has(item.object.id) ||
      (drillScope.kind === "project" && item.object.archivedAt !== undefined)
  );
  const searchResults =
    board === undefined ? [] : searchCanvasObjects(board.objects, searchQuery);
  const chapterAggregates =
    board === undefined || drillScope.kind !== "project"
      ? []
      : canvasChapterAggregates(project, board);
  const culledVisibleObjects =
    board === undefined
      ? []
      : visibleCanvasObjects(projectedObjects, viewport, surfaceSize);
  const selectedVisibleObject =
    selectedObjectDisplay !== undefined &&
    projectedObjects.some((object) => object.id === selectedObjectDisplay.id) &&
    !culledVisibleObjects.some(
      (object) => object.id === selectedObjectDisplay.id
    )
      ? selectedObjectDisplay
      : undefined;
  const visibleObjects = [
    ...culledVisibleObjects,
    ...(selectedVisibleObject === undefined ? [] : [selectedVisibleObject])
  ].sort((left, right) => left.z - right.z);
  const chapterOverlays =
    board === undefined || drillScope.kind !== "project"
      ? []
      : chapterBoundOverlays(project, board);
  const activeSceneCard = projectedObjects.find(
    (object) =>
      object.kind === "scene-card" && object.sceneId === selectedSceneId
  );
  const hasProvisionalBeat = (board?.objects ?? []).some(
    (object) => object.sourceKey === PROVISIONAL_BEAT_FIXTURE_SOURCE
  );
  const maxZ = Math.max(0, ...(board?.objects.map((object) => object.z) ?? []));
  const minZ = Math.min(0, ...(board?.objects.map((object) => object.z) ?? []));
  const relatedLinks =
    selectedObject === undefined
      ? []
      : (board?.links ?? []).filter(
          (link) =>
            link.fromObjectId === selectedObject.id ||
            link.toObjectId === selectedObject.id
        );
  const linkTargets =
    selectedObject === undefined
      ? []
      : activeObjects.filter((object) => object.id !== selectedObject.id);
  const selectedScene =
    selectedSceneId === undefined ? undefined : scenes.get(selectedSceneId);
  const selectedSpineEntry =
    selectedObject?.sceneId === undefined
      ? undefined
      : workspace?.spine.entries.find(
          (entry) => entry.sceneId === selectedObject.sceneId
        );
  const availableKnowledge = useMemo(
    () =>
      board === undefined ? [] : availableCanvasStoryKnowledge(project, board),
    [board, project]
  );
  const selectedKnowledgeTarget = availableKnowledge.find(
    (knowledge) => knowledge.id === selectedKnowledgeTargetId
  );
  const priorCanvasSnapshots =
    history?.revisions.filter(
      (revision) => board !== undefined && revision.boardVersion < board.version
    ) ?? [];

  useEffect(() => {
    if (compact) {
      setView("outline");
      setShowInspector(false);
    }
  }, [compact]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const typingTarget = (target: HTMLElement | null): boolean =>
      target?.tagName === "INPUT" ||
      target?.tagName === "TEXTAREA" ||
      Boolean(target?.isContentEditable);

    const chooseTool = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (
        typingTarget(target) ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      ) {
        return;
      }
      if (event.code === "Space" || event.key === " ") {
        event.preventDefault();
        setSpaceHeld(true);
        return;
      }
      if (event.key === "]") {
        event.preventDefault();
        setShowInspector((current) => !current);
        return;
      }
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        changeViewport({
          ...viewportRef.current,
          zoom: viewportRef.current.zoom + 0.15
        });
        return;
      }
      if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        changeViewport({
          ...viewportRef.current,
          zoom: viewportRef.current.zoom - 0.15
        });
        return;
      }
      if (event.key === "1" && event.shiftKey) {
        event.preventDefault();
        if (selectedObjectDisplay !== undefined) {
          changeViewport(
            fitCanvasObjects([selectedObjectDisplay], surfaceSize)
          );
        }
        return;
      }
      if (event.key === "2" && event.shiftKey) {
        event.preventDefault();
        changeViewport(fitCanvasObjects(projectedObjects, surfaceSize));
        return;
      }
      if (event.key === "/") {
        event.preventDefault();
        const search = document.querySelector<HTMLInputElement>(
          '[aria-label="Search or jump on Canvas"]'
        );
        search?.focus();
        return;
      }
      const toolByKey: Readonly<Record<string, CanvasTool | undefined>> = {
        v: "select",
        h: "hand",
        s: "scene",
        n: "note",
        k: "story",
        i: "image",
        r: "region",
        l: "connect"
      };
      if (event.key === "Escape") {
        setActiveTool("select");
        setShowSceneForm(false);
        setShowHistory(false);
        setConfirmHistoryRestore(false);
        setContextMenu(undefined);
        setLinkDrag(undefined);
        setLinkDropTargetId(undefined);
        setPendingLink(undefined);
        return;
      }
      const tool = toolByKey[event.key.toLocaleLowerCase()];
      if (tool === undefined) return;
      event.preventDefault();
      activateTool(tool);
    };
    const releaseSpace = (event: KeyboardEvent): void => {
      if (event.code === "Space" || event.key === " ") {
        setSpaceHeld(false);
      }
    };
    document.addEventListener("keydown", chooseTool);
    document.addEventListener("keyup", releaseSpace);
    return () => {
      document.removeEventListener("keydown", chooseTool);
      document.removeEventListener("keyup", releaseSpace);
    };
  });

  useEffect(() => {
    if (workflowLens === "review") {
      setShowHistory(true);
      void onLoadHistory();
    }
  }, [onLoadHistory, workflowLens]);

  useEffect(() => {
    if (board === undefined) return;
    const drillKey = canvasDrillScopeKey(drillScope);
    const previousKey = previousDrillKeyRef.current;
    if (previousKey !== drillKey) {
      viewportByScopeRef.current.set(previousKey, viewportRef.current);
      previousDrillKeyRef.current = drillKey;
    }

    const restored = viewportByScopeRef.current.get(drillKey);
    const target =
      restored ??
      targetViewportForDrillScope(project, board, drillScope, surfaceSize);
    if (target === undefined) return;

    if (animationFrameRef.current !== undefined) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = undefined;
    }

    if (readPrefersReducedMotion()) {
      setViewport(target);
      void onPreferenceChange({
        ...target,
        ...(selectedObjectId === undefined
          ? { selectedObjectId: null }
          : { selectedObjectId })
      });
      return;
    }

    const from = viewportRef.current;
    const startedAt = performance.now();
    setCameraTransitioning(true);
    const step = (now: number): void => {
      const progress = Math.min(
        1,
        (now - startedAt) / CANVAS_CAMERA_TRANSITION_MS
      );
      const next = interpolateCanvasViewport(
        from,
        target,
        progress,
        easeOutCubic
      );
      setViewport(next);
      if (progress < 1) {
        animationFrameRef.current = requestAnimationFrame(step);
        return;
      }
      setCameraTransitioning(false);
      animationFrameRef.current = undefined;
      void onPreferenceChange({
        ...target,
        ...(selectedObjectId === undefined
          ? { selectedObjectId: null }
          : { selectedObjectId })
      });
    };
    animationFrameRef.current = requestAnimationFrame(step);
    return () => {
      if (animationFrameRef.current !== undefined) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [board, drillScope, project, surfaceSize.height, surfaceSize.width]);

  useEffect(() => {
    if (preference === undefined || preference === null) return;
    setViewport({
      x: preference.x,
      y: preference.y,
      zoom: clampCanvasZoom(preference.zoom)
    });
  }, [preference]);

  useEffect(() => {
    setObjectLabel(selectedObject?.label ?? "");
    setNoteBody(selectedObject?.note?.body ?? "");
    setNoteColor(selectedObject?.note?.color ?? "");
    setImageAltText(selectedObject?.image?.altText ?? "");
    setImageCaption(selectedObject?.image?.caption ?? "");
    setImageAssetId(selectedObject?.image?.assetId ?? "");
    setImageMimeType(selectedObject?.image?.mimeType ?? "");
    setSceneOrderHint(
      selectedObject?.storyOrderHint === undefined
        ? ""
        : String(selectedObject.storyOrderHint)
    );
    setSelectedLinkId(undefined);
    setLinkLabel("");
    setLinkTargetId(undefined);
  }, [selectedObject]);

  useEffect(() => {
    setLinkLabel(selectedLink?.label ?? "");
  }, [selectedLink]);

  useEffect(() => {
    if (
      selectedKnowledgeTargetId === undefined ||
      !availableKnowledge.some(
        (knowledge) => knowledge.id === selectedKnowledgeTargetId
      )
    ) {
      setSelectedKnowledgeTargetId(availableKnowledge[0]?.id);
    }
  }, [availableKnowledge, selectedKnowledgeTargetId]);

  useEffect(() => {
    if (
      selectedHistoryRevisionId !== undefined &&
      !priorCanvasSnapshots.some(
        (revision) => revision.id === selectedHistoryRevisionId
      )
    ) {
      setSelectedHistoryRevisionId(undefined);
      setConfirmHistoryRestore(false);
    }
  }, [priorCanvasSnapshots, selectedHistoryRevisionId]);

  function defaultPosition(offset = 0): Readonly<{ x: number; y: number }> {
    return canvasCapturePosition(
      activeObjects.length + offset,
      viewport,
      surfaceSize
    );
  }

  async function sendCommand(command: CanvasCommand): Promise<void> {
    await onCommand(command);
  }

  async function moveObject(
    object: CanvasObject,
    x: number,
    y: number
  ): Promise<void> {
    if (drillScope.kind === "project") {
      await sendCommand({
        type: "canvas.object.move",
        objectId: object.id,
        x,
        y,
        ...(object.parentRegionId === undefined
          ? {}
          : { parentRegionId: object.parentRegionId })
      });
      return;
    }
    const scope = canvasScopeRefFromDrill(drillScope);
    await sendCommand({
      type: "canvas.object.setScopePlacement",
      objectId: object.id,
      scopeKind: scope.scopeKind,
      ...(scope.scopeId === undefined ? {} : { scopeId: scope.scopeId }),
      x,
      y,
      width: object.width,
      height: object.height
    });
  }

  function enterSceneFromObject(object: CanvasObject): void {
    if (object.sceneId === undefined) return;
    const scope = sceneDrillScope(project, object.sceneId);
    if (scope === undefined) return;
    onSelectScene(object.sceneId);
    onDrillIntoScene(scope);
  }

  function selectObject(object: CanvasObject): void {
    onSelectObject(object.id);
    if (object.sceneId !== undefined) onSelectScene(object.sceneId);
    if (compact) setShowInspector(true);
    void onPreferenceChange({
      ...viewport,
      selectedObjectId: object.id
    });
  }

  function changeViewport(next: CanvasViewport): void {
    const normalized = { ...next, zoom: clampCanvasZoom(next.zoom) };
    setViewport(normalized);
    viewportRef.current = normalized;
    void onPreferenceChange({
      ...normalized,
      ...(selectedObjectId === undefined
        ? { selectedObjectId: null }
        : { selectedObjectId })
    });
  }

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      view !== "spatial" ||
      compact ||
      loading ||
      board === undefined
    ) {
      return;
    }

    const onWheel = (event: WheelEvent): void => {
      const surface = document.getElementById("story-canvas-surface");
      if (surface === null) return;
      const target = event.target;
      const overSurface =
        target instanceof Node &&
        (surface === target || surface.contains(target));
      if (!overSurface) return;

      // Trackpad pinch arrives as wheel + ctrlKey (even without holding Ctrl).
      const isPinchZoom = event.ctrlKey || event.metaKey;
      event.preventDefault();
      const rect = surface.getBoundingClientRect();
      const screenX = event.clientX - rect.left;
      const screenY = event.clientY - rect.top;
      if (isPinchZoom) {
        const clampedDelta = Math.max(-12, Math.min(12, event.deltaY));
        const factor = Math.pow(2, -clampedDelta * 0.045);
        applyLiveViewport(
          zoomViewportAtScreenPoint(
            viewportRef.current,
            screenX,
            screenY,
            viewportRef.current.zoom * factor
          )
        );
        return;
      }
      applyLiveViewport(
        panViewportByScreenDelta(
          viewportRef.current,
          -event.deltaX,
          -event.deltaY
        )
      );
    };

    // Window capture so Mac trackpad pinch can preventDefault reliably.
    window.addEventListener("wheel", onWheel, { passive: false, capture: true });
    return () => {
      window.removeEventListener("wheel", onWheel, true);
    };
  }, [board, compact, loading, view]);

  function activateTool(tool: CanvasTool): void {
    setActiveTool(tool);
    if (tool !== "scene") setShowSceneForm(false);
    switch (tool) {
      case "scene":
        setShowSceneForm(true);
        break;
      case "note":
      case "image":
      case "region":
        // Armed for click-to-place on the board (no auto grid drop).
        break;
      case "story":
        break;
      case "connect":
        break;
      case "select":
      case "hand":
        break;
    }
  }

  function surfacePointFromClient(
    clientX: number,
    clientY: number
  ): Readonly<{ x: number; y: number }> | undefined {
    if (typeof document === "undefined") return undefined;
    const surface = document.getElementById("story-canvas-surface");
    if (surface === null) return undefined;
    const rect = surface.getBoundingClientRect();
    return {
      x: clientX - rect.left,
      y: clientY - rect.top
    };
  }

  function placeArmedToolAtScreen(
    screenX: number,
    screenY: number
  ): boolean {
    if (!isCanvasPlaceTool(activeTool)) return false;
    const world = canvasWorldPointFromScreen(viewport, screenX, screenY);
    if (activeTool === "note") {
      createNote({ x: world.x - 120, y: world.y - 70 });
    } else if (activeTool === "region") {
      createRegion({ x: world.x - 310, y: world.y - 180 });
    } else if (activeTool === "image") {
      createImagePlaceholder({ x: world.x - 130, y: world.y - 90 });
    }
    setActiveTool("select");
    return true;
  }

  function jumpToObject(object: CanvasObject): void {
    selectObject(object);
    setView(compact ? "outline" : "spatial");
    changeViewport(
      fitCanvasObjects([withResolvedGeometry(object, scopePlacements, drillScope)], surfaceSize)
    );
  }

  function createNote(
    position: Readonly<{ x: number; y: number }> = defaultPosition()
  ): void {
    void sendCommand({
      type: "canvas.object.create",
      object: {
        kind: "note",
        ...position,
        width: 240,
        height: 140,
        z: maxZ + 1,
        authority: "confirmed",
        label: "Writer note",
        note: { body: "Add the thought you do not want to lose." }
      }
    });
  }

  function createRegion(
    position: Readonly<{ x: number; y: number }> = defaultPosition()
  ): void {
    void sendCommand({
      type: "canvas.object.create",
      object: {
        kind: "region",
        ...position,
        width: 620,
        height: 360,
        z: Math.min(-1, maxZ - 1),
        authority: "confirmed",
        label: "Story region"
      }
    });
  }

  function createImagePlaceholder(
    position: Readonly<{ x: number; y: number }> = defaultPosition()
  ): void {
    void sendCommand({
      type: "canvas.object.create",
      object: {
        kind: "image-reference",
        ...position,
        width: 260,
        height: 180,
        z: maxZ + 1,
        authority: "confirmed",
        label: "Concept image reference",
        image: {
          altText: "Image metadata placeholder",
          caption: "Local asset metadata can be attached later."
        }
      }
    });
  }

  function createProvisionalBeat(): void {
    const position = defaultPosition();
    void sendCommand({
      type: "canvas.object.create",
      object: {
        kind: "note",
        ...position,
        width: 250,
        height: 150,
        z: maxZ + 1,
        authority: "provisional",
        label: "A costly turn",
        note: {
          body: "Provisional beat fixture: the apparent success creates a harder choice."
        },
        sourceKey: PROVISIONAL_BEAT_FIXTURE_SOURCE,
        provenance: "Deterministic Ghostwriter review fixture; no model call."
      }
    });
  }

  function placeSelectedScene(): void {
    if (selectedScene === undefined || activeSceneCard !== undefined) return;
    const position = defaultPosition();
    const spineEntry = workspace?.spine.entries.find(
      (entry) => entry.sceneId === selectedScene.id
    );
    void sendCommand({
      type: "canvas.object.place",
      object: {
        kind: "scene-card",
        ...position,
        width: 260,
        height: 160,
        z: maxZ + 1,
        authority: "confirmed",
        label: selectedScene.title,
        sceneId: selectedScene.id,
        ...(spineEntry === undefined
          ? {}
          : { storyOrderHint: spineEntry.canonicalIndex })
      }
    });
  }

  function placeSelectedKnowledge(): void {
    if (selectedKnowledgeTarget === undefined) return;
    const position = defaultPosition();
    void sendCommand({
      type: "canvas.object.place",
      object: {
        kind: "story-knowledge-card",
        ...position,
        width: 240,
        height: 140,
        z: maxZ + 1,
        authority: "confirmed",
        label: selectedKnowledgeTarget.label,
        storyKnowledgeId: selectedKnowledgeTarget.id
      }
    });
  }

  function saveNoteMetadata(): void {
    if (selectedObject?.kind !== "note") return;
    const body = noteBody.trim();
    const color = noteColor.trim();
    if (body.length === 0 && color.length === 0) return;
    void sendCommand({
      type: "canvas.object.update",
      objectId: selectedObject.id,
      changes: {
        note: {
          ...(body.length === 0 ? {} : { body }),
          ...(color.length === 0 ? {} : { color })
        }
      }
    });
  }

  function saveImageMetadata(): void {
    if (selectedObject?.kind !== "image-reference") return;
    const altText = imageAltText.trim();
    const caption = imageCaption.trim();
    const assetId = imageAssetId.trim();
    const mimeType = imageMimeType.trim();
    if (
      altText.length === 0 &&
      caption.length === 0 &&
      assetId.length === 0 &&
      mimeType.length === 0
    ) {
      return;
    }
    void sendCommand({
      type: "canvas.object.update",
      objectId: selectedObject.id,
      changes: {
        image: {
          ...(altText.length === 0 ? {} : { altText }),
          ...(caption.length === 0 ? {} : { caption }),
          ...(assetId.length === 0 ? {} : { assetId }),
          ...(mimeType.length === 0 ? {} : { mimeType })
        }
      }
    });
  }

  function saveSceneOrderHint(): void {
    if (selectedObject?.kind !== "scene-card") return;
    const hint = parseStoryOrderHint(sceneOrderHint);
    if (hint === undefined) return;
    void sendCommand({
      type: "canvas.object.update",
      objectId: selectedObject.id,
      changes: { storyOrderHint: hint }
    });
  }

  function reviewObject(object: CanvasObject): void {
    selectObject(object);
    setShowInspector(true);
  }

  async function dismissObject(object: CanvasObject): Promise<void> {
    await sendCommand({
      type: "canvas.object.dismiss",
      objectId: object.id
    });
  }

  function chooseScenePlacement(value: string): void {
    setScenePlacement(value);
    const [bookIdValue, chapterIdValue] = value.split("::");
    const book = project.books.find((candidate) => candidate.id === bookIdValue);
    if (book === undefined) {
      setSceneStoryOrderHint("");
      return;
    }
    const placement: CanvasScenePlacementInput =
      chapterIdValue === "unassigned"
        ? { kind: "unassigned", bookId: book.id }
        : {
            kind: "chapter",
            bookId: book.id,
            chapterId: book.parts
              .flatMap((part) => part.chapters)
              .find((chapter) => chapter.id === chapterIdValue)!.id
          };
    const canonicalIndex = canonicalIndexForCanvasHandoff(project, placement);
    setSceneStoryOrderHint(
      canonicalIndex === undefined ? "" : String(canonicalIndex)
    );
  }

  function updateSurfaceSize(event: LayoutChangeEvent): void {
    const { width, height } = event.nativeEvent.layout;
    if (width > 0 && height > 0) setSurfaceSize({ width, height });
  }

  function createLinkBetween(
    fromObjectId: CanvasObjectId,
    toObjectId: CanvasObjectId,
    authority: "confirmed" | "provisional" = "confirmed"
  ): void {
    void sendCommand({
      type: "canvas.link.create",
      link: {
        kind: linkKind,
        fromObjectId,
        toObjectId,
        authority,
        ...(linkLabel.trim().length === 0
          ? {}
          : { label: linkLabel.trim() }),
        ...(authority === "confirmed"
          ? {}
          : {
              sourceKey: `fixture:${linkKind}:${fromObjectId}:${toObjectId}`,
              provenance:
                "Deterministic Ghostwriter link fixture; no model call."
            })
      }
    });
  }

  function createLink(authority: "confirmed" | "provisional"): void {
    const fromId = pendingLink?.fromObjectId ?? selectedObject?.id;
    const toId = pendingLink?.toObjectId ?? linkTargetId;
    if (fromId === undefined || toId === undefined) return;
    createLinkBetween(fromId, toId, authority);
    setPendingLink(undefined);
    setActiveTool("select");
  }

  const boardPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () =>
          shouldPanBoard(activeTool, spaceHeld) && linkDrag === undefined,
        onMoveShouldSetPanResponder: (_event, gesture) =>
          shouldPanBoard(activeTool, spaceHeld) &&
          linkDrag === undefined &&
          (Math.abs(gesture.dx) > 2 || Math.abs(gesture.dy) > 2),
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          panOriginRef.current = viewportRef.current;
        },
        onPanResponderMove: (_event, gesture) => {
          if (!shouldPanBoard(activeTool, spaceHeld)) return;
          setViewport(
            panViewportByScreenDelta(
              panOriginRef.current,
              gesture.dx,
              gesture.dy
            )
          );
        },
        onPanResponderRelease: (_event, gesture) => {
          if (!shouldPanBoard(activeTool, spaceHeld)) return;
          changeViewport(
            panViewportByScreenDelta(
              panOriginRef.current,
              gesture.dx,
              gesture.dy
            )
          );
        }
      }),
    [activeTool, linkDrag, spaceHeld]
  );

  function openContextMenu(
    x: number,
    y: number,
    objectId?: CanvasObjectId
  ): void {
    setContextMenu({ x, y, objectId });
  }

  const projectedObjectsRef = useRef(projectedObjects);
  projectedObjectsRef.current = projectedObjects;
  const linkDragRef = useRef(linkDrag);
  linkDragRef.current = linkDrag;

  function finishLinkDrag(screenX: number, screenY: number): void {
    const activeDrag = linkDragRef.current;
    if (activeDrag === undefined) return;
    const fromObjectId = activeDrag.fromObjectId;
    const target = objectAtScreenPoint(
      projectedObjectsRef.current,
      viewportRef.current,
      screenX,
      screenY,
      fromObjectId,
      14
    );
    setLinkDrag(undefined);
    setLinkDropTargetId(undefined);
    if (target === undefined) {
      setActiveTool("select");
      return;
    }
    const source = objectById.get(fromObjectId);
    if (source !== undefined) selectObject(source);
    setLinkTargetId(target.id);
    setPendingLink({ fromObjectId, toObjectId: target.id });
    setActiveTool("connect");
  }

  function beginLinkDragFromObject(object: CanvasObject): void {
    const frame = canvasScreenFrame(object, viewportRef.current);
    setActiveTool("connect");
    setLinkDropTargetId(undefined);
    setLinkDrag({
      fromObjectId: object.id,
      x: frame.left + frame.width - 6,
      y: frame.top + frame.height / 2
    });
  }

  useEffect(() => {
    if (linkDrag === undefined || typeof window === "undefined") return;
    const fromObjectId = linkDrag.fromObjectId;
    const handlePointerMove = (event: PointerEvent): void => {
      const point = surfacePointFromClient(event.clientX, event.clientY);
      if (point === undefined) return;
      setLinkDrag((current) =>
        current === undefined ? current : { ...current, x: point.x, y: point.y }
      );
      const hover = objectAtScreenPoint(
        projectedObjectsRef.current,
        viewportRef.current,
        point.x,
        point.y,
        fromObjectId,
        14
      );
      setLinkDropTargetId(hover?.id);
    };
    const handlePointerUp = (event: PointerEvent): void => {
      const point = surfacePointFromClient(event.clientX, event.clientY);
      const fallback = linkDragRef.current;
      finishLinkDrag(
        point?.x ?? fallback?.x ?? 0,
        point?.y ?? fallback?.y ?? 0
      );
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [linkDrag?.fromObjectId]);

  async function submitSceneHandoff(
    options: Readonly<{ openSplit?: boolean }> = {}
  ): Promise<void> {
    const [bookIdValue, chapterIdValue] = scenePlacement.split("::");
    const book = project.books.find((candidate) => candidate.id === bookIdValue);
    const position = defaultPosition();
    const width = parseFinite(sceneWidth) ?? 260;
    const height = parseFinite(sceneHeight) ?? 160;
    const storyOrderHint = parseStoryOrderHint(sceneStoryOrderHint);
    if (
      book === undefined ||
      storyOrderHint === undefined ||
      width <= 0 ||
      height <= 0 ||
      sceneTitle.trim().length === 0
    ) {
      return;
    }
    const manuscriptPlacement: CanvasScenePlacementInput =
      chapterIdValue === "unassigned"
        ? { kind: "unassigned", bookId: book.id }
        : {
            kind: "chapter",
            bookId: book.id,
            chapterId: book.parts
              .flatMap((part) => part.chapters)
              .find((chapter) => chapter.id === chapterIdValue)!.id
          };
    const createdSceneId = await onCreateScene({
      title: sceneTitle.trim(),
      manuscriptPlacement,
      canvas: {
        x: position.x,
        y: position.y,
        width,
        height,
        z: maxZ + 1,
        storyOrderHint
      }
    });
    if (createdSceneId !== undefined) {
      setSceneTitle("");
      setScenePlacement("");
      setSceneStoryOrderHint("");
      setShowSceneForm(false);
      setActiveTool("select");
      if (options.openSplit) {
        onOpenSplit?.(createdSceneId);
      }
    }
  }

  async function restoreSelectedCanvasSnapshot(): Promise<void> {
    if (selectedHistoryRevisionId === undefined) return;
    const restored = await onRestoreRevision(selectedHistoryRevisionId);
    if (restored) {
      setConfirmHistoryRestore(false);
      setSelectedHistoryRevisionId(undefined);
    }
  }

  const sceneFormValid =
    sceneTitle.trim().length > 0 &&
    scenePlacement.length > 0 &&
    parseStoryOrderHint(sceneStoryOrderHint) !== undefined;

  let inspector: ReactNode = null;
  if (showInspector) {
    inspector = (
      <View
        accessibilityLabel="Canvas inspector"
        style={[styles.inspector, (compact || condensed) && styles.inspectorStacked]}
      >
        <View style={styles.inspectorHeading}>
          <Text style={styles.inspectorTitle}>Inspector</Text>
          <CanvasButton
            label="Close inspector"
            onPress={() => setShowInspector(false)}
          />
        </View>
        {selectedObject === undefined ? (
          <Text style={styles.emptyText}>
            Select a card, note, image reference, or region to inspect it.
          </Text>
        ) : (
          <>
            <View
              style={[
                styles.authorityCard,
                selectedObject.authority === "provisional" &&
                  styles.authorityCardProvisional,
                selectedCanonicalState?.stale === true &&
                  styles.authorityCardStale
              ]}
            >
              <Text style={styles.authorityLabel}>
                {selectedCanonicalState?.label ??
                  (selectedObject.authority === "provisional"
                    ? "Provisional fixture · not confirmed"
                    : "Confirmed · writer-created")}
              </Text>
              <Text style={styles.authorityMeta}>
                {objectKindLabel(selectedObject)} ·{" "}
                {selectedObject.dismissedAt !== undefined
                  ? "dismissed"
                  : selectedObject.archivedAt !== undefined
                    ? "archived"
                    : "active"}{" "}
                · x {Math.round(selectedObject.x)}, y{" "}
                {Math.round(selectedObject.y)}
              </Text>
            </View>

            <Field
              disabled={busy || selectedObject.archivedAt !== undefined}
              label="Selected object label"
              onChangeText={setObjectLabel}
              value={objectLabel}
            />
            <View style={styles.actionRow}>
              <CanvasButton
                disabled={
                  busy ||
                  selectedObject.archivedAt !== undefined ||
                  objectLabel.trim().length === 0
                }
                label="Save label"
                onPress={() =>
                  void sendCommand({
                    type: "canvas.object.update",
                    objectId: selectedObject.id,
                    changes: { label: objectLabel.trim() }
                  })
                }
                primary
              />
              {selectedObject.archivedAt === undefined ? (
                <CanvasButton
                  danger
                  disabled={busy}
                  label="Archive object"
                  onPress={() =>
                    void sendCommand({
                      type: "canvas.object.archive",
                      objectId: selectedObject.id
                    })
                  }
                />
              ) : (
                <CanvasButton
                  disabled={busy}
                  label="Restore object"
                  onPress={() =>
                    void sendCommand({
                      type: "canvas.object.restore",
                      objectId: selectedObject.id
                    })
                  }
                />
              )}
              {selectedObject.authority === "provisional" &&
              selectedObject.archivedAt === undefined ? (
                <>
                  <CanvasButton
                    disabled={busy}
                    label="Confirm object"
                    onPress={() =>
                      void sendCommand({
                        type: "canvas.object.confirm",
                        objectId: selectedObject.id
                      })
                    }
                    primary
                  />
                  <CanvasButton
                    danger
                    disabled={busy}
                    label="Dismiss object"
                    onPress={() =>
                      void sendCommand({
                        type: "canvas.object.dismiss",
                        objectId: selectedObject.id
                      })
                    }
                  />
                </>
              ) : null}
            </View>

            <Text style={styles.inspectorSectionTitle}>Typed links</Text>
            <Text style={styles.emptyText}>
              Select a second object below to connect story-knowledge cards and
              scenes with a typed Canvas link. Drag objects to keep positions.
            </Text>
            <View style={styles.choiceRow}>
              {(
                [
                  "pin",
                  "thread",
                  "beat",
                  "dependency",
                  "reference"
                ] as const
              ).map((kind) => (
                <CanvasButton
                  disabled={busy}
                  key={kind}
                  label={kind}
                  onPress={() => setLinkKind(kind)}
                  selected={linkKind === kind}
                />
              ))}
            </View>
            <Field
              disabled={busy}
              label="Link label (optional)"
              onChangeText={setLinkLabel}
              placeholder="What connects these?"
              value={linkLabel}
            />
            <Text style={styles.fieldLabel}>Link to object</Text>
            <View style={styles.choiceRow}>
              {linkTargets.length === 0 ? (
                <Text style={styles.emptyText}>Add another active object first.</Text>
              ) : (
                linkTargets.map((target) => (
                  <CanvasButton
                    disabled={busy}
                    key={target.id}
                    label={`${objectKindLabel(target)} · ${target.label}`}
                    onPress={() => setLinkTargetId(target.id)}
                    selected={linkTargetId === target.id}
                  />
                ))
              )}
            </View>
            <View style={styles.actionRow}>
              <CanvasButton
                disabled={busy || linkTargetId === undefined}
                label={`Create confirmed ${linkKind} link`}
                onPress={() => createLink("confirmed")}
                primary
              />
              <CanvasButton
                disabled={busy || linkTargetId === undefined}
                label={`Create provisional ${linkKind} fixture`}
                onPress={() => createLink("provisional")}
              />
            </View>

            <View style={styles.linkList}>
              {relatedLinks.map((link) => {
                const otherId =
                  link.fromObjectId === selectedObject.id
                    ? link.toObjectId
                    : link.fromObjectId;
                const other = objectById.get(otherId);
                return (
                  <Pressable
                    accessibilityLabel={`Select ${link.kind} link to ${
                      other?.label ?? "unavailable object"
                    }`}
                    accessibilityRole="button"
                    accessibilityState={{ selected: link.id === selectedLinkId }}
                    key={link.id}
                    onPress={() => setSelectedLinkId(link.id)}
                    style={[
                      styles.linkRow,
                      link.id === selectedLinkId && styles.linkRowSelected,
                      link.authority === "provisional" &&
                        styles.linkRowProvisional
                    ]}
                  >
                    <Text style={styles.linkTitle}>
                      {link.kind} · {other?.label ?? "Unavailable object"}
                    </Text>
                    <Text style={styles.linkMeta}>{linkStateLabel(link)}</Text>
                  </Pressable>
                );
              })}
            </View>

            {selectedLink === undefined ? null : (
              <View style={styles.selectedLink}>
                <Field
                  disabled={busy || selectedLink.archivedAt !== undefined}
                  label="Selected link label"
                  onChangeText={setLinkLabel}
                  value={linkLabel}
                />
                <View style={styles.actionRow}>
                  <CanvasButton
                    disabled={
                      busy ||
                      selectedLink.archivedAt !== undefined ||
                      linkLabel.trim().length === 0
                    }
                    label="Save link label"
                    onPress={() =>
                      void sendCommand({
                        type: "canvas.link.update",
                        linkId: selectedLink.id,
                        changes: { label: linkLabel.trim() }
                      })
                    }
                  />
                  {selectedLink.archivedAt === undefined ? (
                    <CanvasButton
                      danger
                      disabled={busy}
                      label="Archive link"
                      onPress={() =>
                        void sendCommand({
                          type: "canvas.link.archive",
                          linkId: selectedLink.id
                        })
                      }
                    />
                  ) : (
                    <CanvasButton
                      disabled={busy}
                      label="Restore link"
                      onPress={() =>
                        void sendCommand({
                          type: "canvas.link.restore",
                          linkId: selectedLink.id
                        })
                      }
                    />
                  )}
                  {selectedLink.authority === "provisional" &&
                  selectedLink.archivedAt === undefined ? (
                    <>
                      <CanvasButton
                        disabled={busy}
                        label="Confirm link"
                        onPress={() =>
                          void sendCommand({
                            type: "canvas.link.confirm",
                            linkId: selectedLink.id
                          })
                        }
                        primary
                      />
                      <CanvasButton
                        danger
                        disabled={busy}
                        label="Dismiss link"
                        onPress={() =>
                          void sendCommand({
                            type: "canvas.link.dismiss",
                            linkId: selectedLink.id
                          })
                        }
                      />
                    </>
                  ) : null}
                </View>
              </View>
            )}

            {selectedObject.kind === "note" ? (
              <>
                <Text style={styles.inspectorSectionTitle}>Note metadata</Text>
                <Field
                  disabled={busy || selectedObject.archivedAt !== undefined}
                  label="Note body"
                  multiline
                  onChangeText={setNoteBody}
                  value={noteBody}
                />
                <Field
                  disabled={busy || selectedObject.archivedAt !== undefined}
                  label="Note color"
                  onChangeText={setNoteColor}
                  placeholder="#fff7dc or a named color"
                  value={noteColor}
                />
                <CanvasButton
                  disabled={
                    busy ||
                    selectedObject.archivedAt !== undefined ||
                    (noteBody.trim().length === 0 &&
                      noteColor.trim().length === 0)
                  }
                  label="Save note metadata"
                  onPress={saveNoteMetadata}
                  primary
                />
              </>
            ) : null}

            {selectedObject.kind === "image-reference" ? (
              <>
                <Text style={styles.inspectorSectionTitle}>Image metadata only</Text>
                <Text style={styles.inspectorHelp}>
                  Ghostwriter stores this reference and description; no binary or
                  generated image is created here.
                </Text>
                <Field
                  disabled={busy || selectedObject.archivedAt !== undefined}
                  label="Image alt text"
                  multiline
                  onChangeText={setImageAltText}
                  value={imageAltText}
                />
                <Field
                  disabled={busy || selectedObject.archivedAt !== undefined}
                  label="Image caption"
                  multiline
                  onChangeText={setImageCaption}
                  value={imageCaption}
                />
                <Field
                  disabled={busy || selectedObject.archivedAt !== undefined}
                  label="Image asset ID (optional)"
                  onChangeText={setImageAssetId}
                  value={imageAssetId}
                />
                <Field
                  disabled={busy || selectedObject.archivedAt !== undefined}
                  label="Image MIME type (optional)"
                  onChangeText={setImageMimeType}
                  placeholder="image/png"
                  value={imageMimeType}
                />
                <CanvasButton
                  disabled={
                    busy ||
                    selectedObject.archivedAt !== undefined ||
                    [
                      imageAltText,
                      imageCaption,
                      imageAssetId,
                      imageMimeType
                    ].every((value) => value.trim().length === 0)
                  }
                  label="Save image metadata"
                  onPress={saveImageMetadata}
                  primary
                />
              </>
            ) : null}

            {selectedObject.kind === "scene-card" ? (
              <>
                <Text style={styles.inspectorSectionTitle}>
                  Canvas story-order hint
                </Text>
                <Text
                  accessibilityLabel="Current Canvas story order drift"
                  style={[
                    styles.inspectorHelp,
                    selectedSpineEntry?.drift !== "aligned" &&
                      styles.inspectorHelpWarning
                  ]}
                >
                  {selectedSpineEntry === undefined
                    ? "This scene is not on the current Draft spine."
                    : `Draft position ${
                        selectedSpineEntry.canonicalIndex + 1
                      } · ${canvasDriftLabel(selectedSpineEntry.drift)}. Changing this hint never reorders Draft.`}
                </Text>
                <Field
                  disabled={busy || selectedObject.archivedAt !== undefined}
                  label="Story order hint (0 = first)"
                  numeric
                  onChangeText={setSceneOrderHint}
                  value={sceneOrderHint}
                />
                <View style={styles.actionRow}>
                  <CanvasButton
                    disabled={
                      busy ||
                      selectedObject.archivedAt !== undefined ||
                      parseStoryOrderHint(sceneOrderHint) === undefined
                    }
                    label="Save story-order hint"
                    onPress={saveSceneOrderHint}
                    primary
                  />
                  <CanvasButton
                    disabled={
                      busy ||
                      selectedObject.archivedAt !== undefined ||
                      selectedObject.storyOrderHint === undefined
                    }
                    label="Clear story-order hint"
                    onPress={() =>
                      void sendCommand({
                        type: "canvas.object.update",
                        objectId: selectedObject.id,
                        changes: { storyOrderHint: null }
                      })
                    }
                  />
                </View>
              </>
            ) : null}

            <Text style={styles.inspectorSectionTitle}>Layer order</Text>
            <Text style={styles.inspectorHelp}>
              Current layer {selectedObject.z}. These controls change overlap only.
            </Text>
            <View style={styles.actionRow}>
              <CanvasButton
                disabled={
                  busy || selectedObject.archivedAt !== undefined
                }
                label="Bring forward"
                onPress={() =>
                  void sendCommand({
                    type: "canvas.object.update",
                    objectId: selectedObject.id,
                    changes: { z: maxZ + 1 }
                  })
                }
              />
              <CanvasButton
                disabled={
                  busy || selectedObject.archivedAt !== undefined
                }
                label="Send backward"
                onPress={() =>
                  void sendCommand({
                    type: "canvas.object.update",
                    objectId: selectedObject.id,
                    changes: { z: minZ - 1 }
                  })
                }
              />
            </View>

            <Text style={styles.inspectorSectionTitle}>Move with keyboard controls</Text>
            <View style={styles.actionRow}>
              {[
                ["Nudge left", -OBJECT_NUDGE, 0],
                ["Nudge right", OBJECT_NUDGE, 0],
                ["Nudge up", 0, -OBJECT_NUDGE],
                ["Nudge down", 0, OBJECT_NUDGE]
              ].map(([label, dx, dy]) => (
                <CanvasButton
                  disabled={busy || selectedObject.archivedAt !== undefined}
                  key={String(label)}
                  label={String(label)}
                  onPress={() =>
                    void moveObject(
                      selectedObjectDisplay ?? selectedObject,
                      (selectedObjectDisplay ?? selectedObject).x + Number(dx),
                      (selectedObjectDisplay ?? selectedObject).y + Number(dy)
                    )
                  }
                />
              ))}
            </View>

            <Text style={styles.inspectorSectionTitle}>Resize</Text>
            <View style={styles.actionRow}>
              <CanvasButton
                disabled={
                  busy ||
                  selectedObject.archivedAt !== undefined ||
                  selectedObject.width <= OBJECT_RESIZE
                }
                label="Narrower"
                onPress={() =>
                  void sendCommand({
                    type: "canvas.object.resize",
                    objectId: selectedObject.id,
                    width: selectedObject.width - OBJECT_RESIZE,
                    height: selectedObject.height
                  })
                }
              />
              <CanvasButton
                disabled={busy || selectedObject.archivedAt !== undefined}
                label="Wider"
                onPress={() =>
                  void sendCommand({
                    type: "canvas.object.resize",
                    objectId: selectedObject.id,
                    width: selectedObject.width + OBJECT_RESIZE,
                    height: selectedObject.height
                  })
                }
              />
              <CanvasButton
                disabled={
                  busy ||
                  selectedObject.archivedAt !== undefined ||
                  selectedObject.height <= OBJECT_RESIZE
                }
                label="Shorter"
                onPress={() =>
                  void sendCommand({
                    type: "canvas.object.resize",
                    objectId: selectedObject.id,
                    width: selectedObject.width,
                    height: selectedObject.height - OBJECT_RESIZE
                  })
                }
              />
              <CanvasButton
                disabled={busy || selectedObject.archivedAt !== undefined}
                label="Taller"
                onPress={() =>
                  void sendCommand({
                    type: "canvas.object.resize",
                    objectId: selectedObject.id,
                    width: selectedObject.width,
                    height: selectedObject.height + OBJECT_RESIZE
                  })
                }
              />
            </View>

            <Text style={styles.inspectorSectionTitle}>Region membership</Text>
            <View style={styles.actionRow}>
              <CanvasButton
                disabled={
                  busy ||
                  selectedObject.archivedAt !== undefined ||
                  selectedObject.parentRegionId === undefined
                }
                label="No region"
                onPress={() =>
                  void sendCommand({
                    type: "canvas.object.move",
                    objectId: selectedObject.id,
                    x: selectedObject.x,
                    y: selectedObject.y,
                    parentRegionId: null
                  })
                }
              />
              {activeObjects
                .filter(
                  (candidate) =>
                    candidate.kind === "region" &&
                    candidate.id !== selectedObject.id
                )
                .map((region) => (
                  <CanvasButton
                    disabled={busy || selectedObject.archivedAt !== undefined}
                    key={region.id}
                    label={`Place in ${region.label}`}
                    onPress={() =>
                      void sendCommand({
                        type: "canvas.object.move",
                        objectId: selectedObject.id,
                        x: selectedObject.x,
                        y: selectedObject.y,
                        parentRegionId: region.id
                      })
                    }
                    selected={selectedObject.parentRegionId === region.id}
                  />
                ))}
            </View>
          </>
        )}
      </View>
    );
  }

  return (
    <View accessibilityLabel="Story Canvas workspace" style={styles.panel}>
      <View
        accessibilityLabel="Canvas toolbar"
        style={styles.chromeHeader}
      >
        {drillStack.length > 1 ? (
          <CanvasIconButton
            glyph="←"
            label="Back to parent Canvas scope · Esc"
            onPress={() => onDrillBack()}
            tip="Back · Esc"
          />
        ) : null}
        <View accessibilityLabel="Canvas tools" style={styles.chromeGroup}>
          {CANVAS_TOOL_DEFINITIONS.map((definition) => (
            <CanvasIconButton
              disabled={
                busy ||
                (compact &&
                  (definition.tool === "hand" || definition.tool === "region"))
              }
              glyph={definition.glyph}
              key={definition.tool}
              label={canvasToolAccessibilityLabel(definition)}
              onPress={() => activateTool(definition.tool)}
              selected={activeTool === definition.tool}
              tip={canvasToolTip(definition)}
            />
          ))}
        </View>
        <View style={styles.chromeDivider} />
        {onWorkflowLensChange === undefined ? null : (
          <View
            accessibilityLabel="Canvas workflow lenses"
            style={styles.chromeGroup}
          >
            {CANVAS_WORKFLOW_LENSES.map((lens) => {
              const label = workflowLensLabel(lens);
              return (
                <CanvasIconButton
                  disabled={busy}
                  glyph={LENS_GLYPHS[lens]}
                  key={lens}
                  label={`${label} lens`}
                  onPress={() => onWorkflowLensChange(lens)}
                  selected={workflowLens === lens}
                  tip={`${label} lens`}
                />
              );
            })}
          </View>
        )}
        {onWorkflowLensChange === undefined ? null : (
          <View style={styles.chromeDivider} />
        )}
        <View accessibilityLabel="Canvas utilities" style={styles.chromeGroup}>
          {!compact ? (
            <>
              <CanvasIconButton
                glyph="◫"
                label="Spatial · view"
                onPress={() => setView("spatial")}
                selected={view === "spatial"}
                tip="Spatial view"
              />
              <CanvasIconButton
                glyph="☰"
                label="Outline · view"
                onPress={() => setView("outline")}
                selected={view === "outline"}
                tip="Outline view"
              />
            </>
          ) : null}
          <View style={styles.searchBox}>
            <TextInput
              accessibilityLabel="Search or jump on Canvas"
              onChangeText={setSearchQuery}
              placeholder="⌕ /"
              placeholderTextColor={colors.muted}
              style={styles.searchInput}
              value={searchQuery}
            />
            {searchResults.length === 0 ? null : (
              <View
                accessibilityLabel="Canvas search results"
                style={styles.searchResults}
              >
                {searchResults.slice(0, 8).map((object) => (
                  <CanvasButton
                    key={object.id}
                    label={`Jump to ${object.label}`}
                    onPress={() => jumpToObject(object)}
                  />
                ))}
              </View>
            )}
          </View>
          <CanvasIconButton
            disabled={selectedObjectDisplay === undefined}
            glyph="▣"
            label="Fit selection · ⇧1"
            onPress={() => {
              if (selectedObjectDisplay !== undefined) {
                changeViewport(
                  fitCanvasObjects([selectedObjectDisplay], surfaceSize)
                );
              }
            }}
            tip="Fit selection · ⇧1"
          />
          <CanvasIconButton
            disabled={projectedObjects.length === 0}
            glyph="▦"
            label="Fit board · ⇧2"
            onPress={() =>
              changeViewport(fitCanvasObjects(projectedObjects, surfaceSize))
            }
            tip="Fit board · ⇧2"
          />
          {!compact ? (
            <>
              <CanvasIconButton
                glyph="−"
                label="Zoom out · -"
                onPress={() =>
                  changeViewport({
                    ...viewport,
                    zoom: viewport.zoom - 0.15
                  })
                }
                tip="Zoom out · -"
              />
              <Text style={styles.zoomLabel}>
                {Math.round(viewport.zoom * 100)}%
              </Text>
              <CanvasIconButton
                glyph="+"
                label="Zoom in · +"
                onPress={() =>
                  changeViewport({
                    ...viewport,
                    zoom: viewport.zoom + 0.15
                  })
                }
                tip="Zoom in · +"
              />
            </>
          ) : null}
          <CanvasIconButton
            disabled={busy || board === undefined || board.version <= 1}
            glyph="↶"
            label="Undo Canvas command"
            onPress={() => void onUndo()}
            tip="Undo Canvas command"
          />
          <CanvasIconButton
            glyph="◷"
            label={showHistory ? "Hide Canvas history" : "Show Canvas history"}
            onPress={() => {
              const next = !showHistory;
              setShowHistory(next);
              if (next) void onLoadHistory();
            }}
            selected={showHistory}
            tip="Canvas history"
          />
          <CanvasIconButton
            glyph="▥"
            label={showInspector ? "Hide Details · ]" : "Show Details · ]"}
            onPress={() => setShowInspector(!showInspector)}
            selected={showInspector}
            tip="Details · ]"
          />
        </View>
        <View style={styles.chromeSpacer} />
        <Text
          accessibilityLabel="Canvas save status"
          accessibilityLiveRegion="polite"
          numberOfLines={1}
          style={[
            styles.saveStatus,
            (saveState === "error" || saveState === "conflict") &&
              styles.saveStatusWarning
          ]}
        >
          {cameraTransitioning
            ? "Opening…"
            : saveStateLabel(saveState, loading)}
        </Text>
      </View>

      {message === undefined ? null : (
        <View
          accessibilityRole="alert"
          style={[
            styles.message,
            message.kind === "conflict" && styles.messageConflict
          ]}
        >
          <Text style={styles.messageText}>{message.text}</Text>
          {message.kind === "conflict" || message.kind === "error" ? (
            <CanvasButton
              disabled={loading}
              label="Reload latest Canvas"
              onPress={() => void onReload()}
            />
          ) : null}
        </View>
      )}

      {pendingLink === undefined ? null : (
        <CanvasModal
          accessibilityLabel="Confirm Canvas link"
          eyebrow="Unconfirmed relationship"
          onClose={() => {
            setPendingLink(undefined);
            setActiveTool("select");
          }}
          rule="The dashed drag line is not a saved link until you confirm."
          title="Confirm Canvas link"
          footer={
            <>
              <CanvasButton
                label="Cancel · Esc"
                onPress={() => {
                  setPendingLink(undefined);
                  setActiveTool("select");
                }}
              />
              <CanvasButton
                label={`Create ${linkKind} link`}
                onPress={() => createLink("confirmed")}
                primary
              />
            </>
          }
        >
          <Text style={styles.pendingLinkMeta}>
            {objectById.get(pendingLink.fromObjectId)?.label ?? "Source"} →{" "}
            {objectById.get(pendingLink.toObjectId)?.label ?? "Target"}
          </Text>
          <Text style={styles.fieldLabel}>Link kind</Text>
          <View style={styles.choiceRow}>
            {(
              ["pin", "thread", "beat", "dependency", "reference"] as const
            ).map((kind) => (
              <CanvasButton
                key={kind}
                label={kind}
                onPress={() => setLinkKind(kind)}
                selected={linkKind === kind}
              />
            ))}
          </View>
          <Field
            label="Optional link label"
            onChangeText={setLinkLabel}
            value={linkLabel}
          />
        </CanvasModal>
      )}

      {showHistory ? (
        <CanvasModal
          accessibilityLabel="Canvas history"
          eyebrow="Canvas history"
          onClose={() => {
            setShowHistory(false);
            setConfirmHistoryRestore(false);
          }}
          rule="Restoring creates a new current Canvas. Draft prose and manuscript order stay unchanged."
          title="Earlier board snapshots"
          footer={
            selectedHistoryRevisionId === undefined ? (
              <CanvasButton
                label="Close"
                onPress={() => setShowHistory(false)}
              />
            ) : confirmHistoryRestore ? (
              <>
                <CanvasButton
                  label="Cancel Canvas restore"
                  onPress={() => setConfirmHistoryRestore(false)}
                />
                <CanvasButton
                  disabled={busy}
                  label="Confirm Canvas restore"
                  onPress={() => void restoreSelectedCanvasSnapshot()}
                  primary
                />
              </>
            ) : (
              <CanvasButton
                disabled={busy || historyLoading}
                label="Restore selected Canvas snapshot"
                onPress={() => setConfirmHistoryRestore(true)}
              />
            )
          }
        >
          {historyLoading ? (
            <Text style={styles.emptyText}>Loading Canvas history…</Text>
          ) : priorCanvasSnapshots.length === 0 ? (
            <Text style={styles.emptyText}>
              No earlier Canvas snapshot is available yet.
            </Text>
          ) : (
            <View style={styles.historyList}>
              {priorCanvasSnapshots.map((revision) => (
                <Pressable
                  accessibilityLabel={`Select Canvas snapshot ${revision.boardVersion}: ${canvasHistoryLabel(
                    revision
                  )}`}
                  accessibilityRole="button"
                  accessibilityState={{
                    selected: revision.id === selectedHistoryRevisionId
                  }}
                  key={revision.id}
                  onPress={() => {
                    setSelectedHistoryRevisionId(revision.id);
                    setConfirmHistoryRestore(false);
                  }}
                  style={({ pressed }) => [
                    styles.historyRow,
                    revision.id === selectedHistoryRevisionId &&
                      styles.historyRowSelected,
                    pressed && styles.pressed
                  ]}
                >
                  <Text style={styles.historyVersion}>
                    Canvas version {revision.boardVersion}
                  </Text>
                  <Text style={styles.historyReason}>
                    {canvasHistoryLabel(revision)}
                  </Text>
                  <Text style={styles.historyTime}>
                    {canvasHistoryTime(revision.createdAt)}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
          {confirmHistoryRestore ? (
            <Text style={styles.historyConfirm}>
              Restore this Canvas snapshot? A new current Canvas version is created.
            </Text>
          ) : null}
        </CanvasModal>
      ) : null}

      {activeTool === "story" ? (
        <CanvasModal
          accessibilityLabel="Story knowledge placement"
          eyebrow="Canonical story knowledge"
          onClose={() => setActiveTool("select")}
          rule="Writer placement is confirmed. Archived records are not new targets."
          title="Place an active story record"
          footer={
            <>
              <CanvasButton
                label="Cancel"
                onPress={() => setActiveTool("select")}
              />
              <CanvasButton
                disabled={busy || selectedKnowledgeTarget === undefined}
                label={
                  selectedKnowledgeTarget === undefined
                    ? "Choose story knowledge"
                    : `Place ${selectedKnowledgeTarget.label} on Canvas`
                }
                onPress={() => {
                  placeSelectedKnowledge();
                  setActiveTool("select");
                }}
                primary
              />
            </>
          }
        >
          {availableKnowledge.length === 0 ? (
            <Text style={styles.emptyText}>
              Every active story record is already placed, or there are no active
              records yet.
            </Text>
          ) : (
            <View style={styles.choiceRow}>
              {availableKnowledge.map((knowledge) => (
                <CanvasButton
                  disabled={busy}
                  key={knowledge.id}
                  label={`${knowledge.label} · ${knowledge.kind} · ${knowledge.authority}`}
                  onPress={() => setSelectedKnowledgeTargetId(knowledge.id)}
                  selected={knowledge.id === selectedKnowledgeTargetId}
                />
              ))}
            </View>
          )}
        </CanvasModal>
      ) : null}

      {showSceneForm ? (
        <CanvasModal
          accessibilityLabel="Storyboard scene handoff"
          eyebrow="Storyboard-first handoff"
          onClose={() => {
            setShowSceneForm(false);
            setActiveTool("select");
          }}
          rule="One acknowledged transaction creates the scene in Canvas and Draft. The board stays put under this dialog."
          title="Create a scene"
          footer={
            <>
              <CanvasButton
                label="Cancel"
                onPress={() => {
                  setShowSceneForm(false);
                  setActiveTool("select");
                }}
              />
              {!compact ? (
                <CanvasButton
                  disabled={busy || !sceneFormValid}
                  label={
                    busy ? "Creating…" : "Create and open Split"
                  }
                  onPress={() => void submitSceneHandoff({ openSplit: true })}
                />
              ) : null}
              <CanvasButton
                disabled={busy || !sceneFormValid}
                label={busy ? "Creating scene…" : "Create scene"}
                onPress={() => void submitSceneHandoff()}
                primary
              />
            </>
          }
        >
          <View style={styles.actionRow}>
            <CanvasButton
              disabled={
                busy || selectedScene === undefined || activeSceneCard !== undefined
              }
              label={
                activeSceneCard === undefined
                  ? "Place selected Draft scene"
                  : "Selected scene is placed"
              }
              onPress={() => {
                placeSelectedScene();
                setShowSceneForm(false);
                setActiveTool("select");
              }}
            />
            {selectedScene !== undefined && !compact ? (
              <CanvasButton
                label="Open selected in Split"
                onPress={() => {
                  setShowSceneForm(false);
                  setActiveTool("select");
                  onOpenSplit?.(selectedScene.id);
                }}
              />
            ) : null}
          </View>
          <Field
            disabled={busy}
            label="Canvas scene title"
            onChangeText={setSceneTitle}
            placeholder="The turn at the lighthouse"
            value={sceneTitle}
          />
          <Text style={styles.fieldLabel}>
            Explicit book and chapter-or-Unassigned placement
          </Text>
          <View style={styles.choiceRow}>
            {project.books
              .filter((book) => book.archivedAt === undefined)
              .flatMap((book) => [
                <CanvasButton
                  disabled={busy}
                  key={`${book.id}::unassigned`}
                  label={`${book.title} · Unassigned`}
                  onPress={() =>
                    chooseScenePlacement(`${book.id}::unassigned`)
                  }
                  selected={scenePlacement === `${book.id}::unassigned`}
                />,
                ...book.parts.flatMap((part) =>
                  part.chapters.map((chapter) => (
                    <CanvasButton
                      disabled={busy}
                      key={`${book.id}::${chapter.id}`}
                      label={`${book.title} · ${chapter.title}`}
                      onPress={() =>
                        chooseScenePlacement(`${book.id}::${chapter.id}`)
                      }
                      selected={
                        scenePlacement === `${book.id}::${chapter.id}`
                      }
                    />
                  ))
                )
              ])}
          </View>
          <Field
            disabled={busy}
            label="Initial story order hint (0 = first)"
            numeric
            onChangeText={setSceneStoryOrderHint}
            placeholder="Choose manuscript placement for an aligned default"
            value={sceneStoryOrderHint}
          />
          <Text style={styles.sceneFormHint}>
            Geometry starts near the board center; drag freely after create.
          </Text>
        </CanvasModal>
      ) : null}

      {chapterAggregates.length === 0 ? null : (
        <View
          accessibilityLabel="Canvas Chapter Aggregates"
          style={styles.aggregateGrid}
        >
          {chapterAggregates.map((aggregate) => (
            <Pressable
              accessibilityLabel={`Enter chapter aggregate ${aggregate.title}`}
              accessibilityRole="button"
              key={aggregate.chapterId}
              onPress={() =>
                onDrillIntoChapter({
                  kind: "chapter",
                  bookId: aggregate.bookId,
                  partId: aggregate.partId,
                  chapterId: aggregate.chapterId
                })
              }
              style={({ pressed }) => [
                styles.aggregateCard,
                pressed && styles.pressed
              ]}
            >
              <Text style={styles.aggregateEyebrow}>Chapter aggregate</Text>
              <Text style={styles.aggregateTitle}>{aggregate.title}</Text>
              <Text style={styles.aggregateMeta}>
                {aggregate.sceneCount} scenes · {aggregate.placedSceneCount} placed
                · {aggregate.linkCount} links
              </Text>
              <Text style={styles.aggregateAction}>Dive into chapter →</Text>
            </Pressable>
          ))}
        </View>
      )}

      {board !== undefined && board.objects.length >= 500 ? (
        <View style={styles.largeBoardNotice}>
          <Text style={styles.largeBoardText}>
            Large board · {board.objects.length} objects. Spatial view is
            viewport-culled; Outline remains the complete ordered review.
          </Text>
        </View>
      ) : null}

      {loading || workspace === undefined || board === undefined ? (
        <View style={styles.loading}>
          <Text style={styles.emptyTitle}>Opening Story Canvas…</Text>
          <Text style={styles.emptyText}>
            Loading the server-acknowledged board and personal view.
          </Text>
        </View>
      ) : (
        <>
          <View
            style={[
              styles.canvasBody,
              (compact || condensed) && styles.canvasBodyStacked
            ]}
          >
            <View style={styles.canvasMain}>
              {view === "spatial" && !compact ? (
                <View style={styles.spatialStage}>
                  <View
                    accessibilityLabel="Canvas zoom rail"
                    style={styles.zoomRailDock}
                  >
                    <Pressable
                      accessibilityLabel={
                        zoomRailOpen
                          ? "Hide zoom slider"
                          : "Show zoom slider"
                      }
                      accessibilityRole="button"
                      onPress={() => setZoomRailOpen((open) => !open)}
                      style={({ pressed }) => [
                        styles.zoomRailToggle,
                        zoomRailOpen && styles.zoomRailToggleOpen,
                        pressed && styles.pressed
                      ]}
                      {...({
                        title: "Toggle zoom slider"
                      } as object)}
                    >
                      <Text style={styles.zoomRailToggleText}>
                        {Math.round(viewport.zoom * 100)}%
                      </Text>
                    </Pressable>
                    {zoomRailOpen ? (
                      <View
                        accessibilityLabel="Zoom slider · drag up to zoom in"
                        style={styles.zoomRailTrack}
                        {...({
                          onPointerDown: (event: {
                            nativeEvent?: { locationY?: number };
                            preventDefault?: () => void;
                          }) => {
                            event.preventDefault?.();
                            const trackHeight = 160;
                            const applyFromY = (locationY: number): void => {
                              const t = 1 - Math.min(1, Math.max(0, locationY / trackHeight));
                              const nextZoom =
                                CANVAS_VIEW_MIN_ZOOM +
                                t *
                                  (CANVAS_VIEW_MAX_ZOOM -
                                    CANVAS_VIEW_MIN_ZOOM);
                              const centerX = surfaceSize.width / 2;
                              const centerY = surfaceSize.height / 2;
                              applyLiveViewport(
                                zoomViewportAtScreenPoint(
                                  viewportRef.current,
                                  centerX,
                                  centerY,
                                  nextZoom
                                )
                              );
                            };
                            applyFromY(event.nativeEvent?.locationY ?? 80);
                            const onMove = (moveEvent: PointerEvent): void => {
                              const surface = document.getElementById(
                                "canvas-zoom-rail-track"
                              );
                              if (surface === null) return;
                              const rect = surface.getBoundingClientRect();
                              applyFromY(moveEvent.clientY - rect.top);
                            };
                            const onUp = (): void => {
                              window.removeEventListener("pointermove", onMove);
                              window.removeEventListener("pointerup", onUp);
                              changeViewport(viewportRef.current);
                            };
                            window.addEventListener("pointermove", onMove);
                            window.addEventListener("pointerup", onUp);
                          },
                          id: "canvas-zoom-rail-track"
                        } as object)}
                      >
                        <View
                          style={[
                            styles.zoomRailFill,
                            {
                              height: `${Math.round(
                                ((viewport.zoom - CANVAS_VIEW_MIN_ZOOM) /
                                  (CANVAS_VIEW_MAX_ZOOM -
                                    CANVAS_VIEW_MIN_ZOOM)) *
                                  100
                              )}%`
                            }
                          ]}
                        />
                        <View
                          style={[
                            styles.zoomRailThumb,
                            {
                              top: `${Math.round(
                                (1 -
                                  (viewport.zoom - CANVAS_VIEW_MIN_ZOOM) /
                                    (CANVAS_VIEW_MAX_ZOOM -
                                      CANVAS_VIEW_MIN_ZOOM)) *
                                  100
                              )}%`
                            }
                          ]}
                        />
                      </View>
                    ) : null}
                  </View>
                  <View
                    {...(typeof window === "undefined"
                      ? boardPanResponder.panHandlers
                      : {})}
                    accessibilityLabel="Spatial Story Canvas"
                    nativeID="story-canvas-surface"
                    onLayout={updateSurfaceSize}
                    {...({
                      id: "story-canvas-surface",
                      onContextMenu: (event: {
                        preventDefault?: () => void;
                        nativeEvent?: {
                          pageX?: number;
                          pageY?: number;
                          locationX?: number;
                          locationY?: number;
                        };
                      }) => {
                        event.preventDefault?.();
                        const native = event.nativeEvent ?? {};
                        openContextMenu(
                          native.pageX ?? native.locationX ?? 24,
                          native.pageY ?? native.locationY ?? 24
                        );
                      },
                      onClick: (event: {
                        nativeEvent?: { locationX?: number; locationY?: number };
                      }) => {
                        if (
                          draggingObject ||
                          boardPanning ||
                          linkDrag !== undefined
                        ) {
                          return;
                        }
                        const locationX = event.nativeEvent?.locationX;
                        const locationY = event.nativeEvent?.locationY;
                        if (locationX === undefined || locationY === undefined) {
                          return;
                        }
                        placeArmedToolAtScreen(locationX, locationY);
                      },
                      onPointerDown: (event: {
                        button?: number;
                        pointerId?: number;
                        pointerType?: string;
                        clientX: number;
                        clientY: number;
                        preventDefault?: () => void;
                      }) => {
                        const button = event.button ?? 0;
                        const middleButton = button === 1;
                        if (button !== 0 && !middleButton) return;

                        if (
                          event.pointerType === "touch" &&
                          event.pointerId !== undefined
                        ) {
                          rememberTouchPoint(
                            event.pointerId,
                            event.clientX,
                            event.clientY
                          );
                        }

                        if (boardPanGestureRef.current) return;

                        if (
                          !shouldBackgroundPanBoard(
                            activeToolRef.current,
                            spaceHeldRef.current,
                            {
                              linkDragging: linkDragActiveRef.current,
                              placeArmed: isCanvasPlaceTool(
                                activeToolRef.current
                              ),
                              middleButton
                            }
                          )
                        ) {
                          return;
                        }

                        event.preventDefault?.();
                        const startX = event.clientX;
                        const startY = event.clientY;
                        panOriginRef.current = viewportRef.current;
                        boardPanGestureRef.current = true;
                        setBoardPanning(true);

                        const onMove = (moveEvent: PointerEvent): void => {
                          if (
                            moveEvent.pointerType === "touch" &&
                            moveEvent.pointerId !== undefined
                          ) {
                            rememberTouchPoint(
                              moveEvent.pointerId,
                              moveEvent.clientX,
                              moveEvent.clientY
                            );
                            const session = pinchSessionRef.current;
                            if (
                              touchPointsRef.current.size >= 2 &&
                              session !== undefined
                            ) {
                              const points = [
                                ...touchPointsRef.current.values()
                              ];
                              const a = points[0]!;
                              const b = points[1]!;
                              const distance = Math.max(
                                1,
                                pinchDistance(a, b)
                              );
                              applyLiveViewport(
                                zoomViewportAtScreenPoint(
                                  {
                                    x: viewportRef.current.x,
                                    y: viewportRef.current.y,
                                    zoom: session.startZoom
                                  },
                                  session.midpointX,
                                  session.midpointY,
                                  session.startZoom *
                                    (distance / session.startDistance)
                                )
                              );
                              return;
                            }
                          }

                          applyLiveViewport(
                            panViewportByScreenDelta(
                              panOriginRef.current,
                              moveEvent.clientX - startX,
                              moveEvent.clientY - startY
                            )
                          );
                        };
                        const endGesture = (upEvent: PointerEvent): void => {
                          if (upEvent.pointerId !== undefined) {
                            touchPointsRef.current.delete(upEvent.pointerId);
                          }
                          if (touchPointsRef.current.size < 2) {
                            pinchSessionRef.current = undefined;
                          }
                          if (
                            upEvent.pointerType === "touch" &&
                            touchPointsRef.current.size > 0
                          ) {
                            return;
                          }
                          window.removeEventListener("pointermove", onMove);
                          window.removeEventListener("pointerup", endGesture);
                          window.removeEventListener(
                            "pointercancel",
                            endGesture
                          );
                          boardPanGestureRef.current = false;
                          touchPointsRef.current.clear();
                          pinchSessionRef.current = undefined;
                          setBoardPanning(false);
                          changeViewport(viewportRef.current);
                        };
                        window.addEventListener("pointermove", onMove);
                        window.addEventListener("pointerup", endGesture);
                        window.addEventListener("pointercancel", endGesture);
                      }
                    } as object)}
                    style={[
                      styles.surface,
                      typeof window !== "undefined"
                        ? ({
                            cursor: canvasBoardCursor(activeTool, spaceHeld, {
                              draggingObject,
                              panning:
                                boardPanning ||
                                spaceHeld ||
                                activeTool === "hand"
                            }),
                            touchAction: "none"
                          } as object)
                        : null
                    ]}
                  >
                    {chapterOverlays.map((overlay) => {
                      const frame = {
                        left:
                          (overlay.bounds.x - viewport.x) * viewport.zoom,
                        top: (overlay.bounds.y - viewport.y) * viewport.zoom,
                        width: overlay.bounds.width * viewport.zoom,
                        height: overlay.bounds.height * viewport.zoom
                      };
                      return (
                        <Pressable
                          accessibilityLabel={`Enter chapter ${overlay.label}`}
                          accessibilityRole="button"
                          key={`${overlay.scope.chapterId}`}
                          onPress={() => onDrillIntoChapter(overlay.scope)}
                          {...({
                            onDoubleClick: () =>
                              onDrillIntoChapter(overlay.scope)
                          } as object)}
                          style={({ pressed }) => [
                            styles.chapterOverlay,
                            pressed && styles.pressed,
                            {
                              height: Math.max(96, frame.height),
                              left: frame.left,
                              top: frame.top,
                              width: Math.max(160, frame.width)
                            }
                          ]}
                        >
                          <Text style={styles.chapterOverlayLabel}>
                            Enter {overlay.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                    {activeLinks.map((link) => {
                      const from = objectById.get(link.fromObjectId);
                      const to = objectById.get(link.toObjectId);
                      if (
                        from === undefined ||
                        to === undefined ||
                        from.archivedAt !== undefined ||
                        to.archivedAt !== undefined
                      ) {
                        return null;
                      }
                      return (
                        <SpatialLink
                          from={from}
                          key={link.id}
                          link={link}
                          to={to}
                          viewport={viewport}
                        />
                      );
                    })}
                    {linkDrag === undefined
                      ? null
                      : (() => {
                          const from = objectById.get(linkDrag.fromObjectId);
                          if (from === undefined) return null;
                          const fromFrame = canvasScreenFrame(from, viewport);
                          return (
                            <LinkRubberBand
                              fromX={fromFrame.left + fromFrame.width - 6}
                              fromY={fromFrame.top + fromFrame.height / 2}
                              hot={linkDropTargetId !== undefined}
                              toX={linkDrag.x}
                              toY={linkDrag.y}
                            />
                          );
                        })()}
                    {visibleObjects.map((object) => {
                      const canonicalState = canvasCanonicalReferenceState(
                        object,
                        project
                      );
                      return (
                        <SpatialObjectCard
                          detail={objectDetail(object, scenes, project)}
                          dimmed={lensProjection?.dimmedObjectIds.has(object.id)}
                          dragEnabled={shouldDragObjects(activeTool, spaceHeld)}
                          key={object.id}
                          linkDropTarget={object.id === linkDropTargetId}
                          linkHandleVisible={!compact}
                          object={object}
                          onContextMenu={(card, x, y) => {
                            selectObject(card);
                            openContextMenu(x, y, card.id);
                          }}
                          onDismiss={dismissObject}
                          onDragActiveChange={setDraggingObject}
                          onDrillIntoScene={
                            drillScope.kind === "scene"
                              ? undefined
                              : enterSceneFromObject
                          }
                          onLinkDragStart={beginLinkDragFromObject}
                          onMove={moveObject}
                          onNodeActions={(card, x, y) => {
                            selectObject(card);
                            openContextMenu(x, y, card.id);
                          }}
                          onReview={reviewObject}
                          onSelect={selectObject}
                          primary={lensProjection?.primaryObjectIds.has(
                            object.id
                          )}
                          selected={object.id === selectedObjectId}
                          staleLabel={canonicalState.label}
                          viewport={viewport}
                        />
                      );
                    })}
                    {projectedObjects.length === 0 ? (
                      <View style={styles.surfaceEmpty}>
                        <Text style={styles.emptyTitle}>An open board</Text>
                        <Text style={styles.emptyText}>
                          Click the board with Note, Region, or Image armed — or
                          right-click for create actions. Scene still needs
                          placement.
                        </Text>
                        <View style={styles.actionRow}>
                          <CanvasButton
                            label="Arm note · N"
                            onPress={() => activateTool("note")}
                          />
                          <CanvasButton
                            label="New scene… · S"
                            onPress={() => activateTool("scene")}
                          />
                        </View>
                      </View>
                    ) : null}
                    {contextMenu === undefined ? null : (
                      <View
                        accessibilityLabel="Canvas context menu"
                        style={[
                          styles.contextMenu,
                          {
                            left: Math.min(
                              Math.max(8, contextMenu.x - 40),
                              surfaceSize.width - 200
                            ),
                            top: Math.min(
                              Math.max(8, contextMenu.y - 40),
                              surfaceSize.height - 220
                            )
                          }
                        ]}
                      >
                        {(
                          [
                            ["New scene… · S", () => activateTool("scene")],
                            [
                              "New note · N",
                              () => {
                                const world = canvasWorldPointFromScreen(
                                  viewport,
                                  contextMenu.x,
                                  contextMenu.y
                                );
                                createNote({
                                  x: world.x - 120,
                                  y: world.y - 70
                                });
                                setActiveTool("select");
                              }
                            ],
                            [
                              "New region · R",
                              () => {
                                const world = canvasWorldPointFromScreen(
                                  viewport,
                                  contextMenu.x,
                                  contextMenu.y
                                );
                                createRegion({
                                  x: world.x - 310,
                                  y: world.y - 180
                                });
                                setActiveTool("select");
                              }
                            ],
                            [
                              "Place story record… · K",
                              () => activateTool("story")
                            ],
                            ...(contextMenu.objectId !== undefined
                              ? ([
                                  [
                                    "Connect from here · L",
                                    () => {
                                      const object = objectById.get(
                                        contextMenu.objectId!
                                      );
                                      if (object !== undefined) {
                                        selectObject(object);
                                        activateTool("connect");
                                      }
                                    }
                                  ],
                                  [
                                    "Enter layer",
                                    () => {
                                      const object = objectById.get(
                                        contextMenu.objectId!
                                      );
                                      if (object !== undefined) {
                                        enterSceneFromObject(object);
                                      }
                                    }
                                  ],
                                  [
                                    "Bring forward",
                                    () => {
                                      const object = objectById.get(
                                        contextMenu.objectId!
                                      );
                                      if (object !== undefined) {
                                        void sendCommand({
                                          type: "canvas.object.update",
                                          objectId: object.id,
                                          changes: { z: maxZ + 1 }
                                        });
                                      }
                                    }
                                  ],
                                  [
                                    "Send backward",
                                    () => {
                                      const object = objectById.get(
                                        contextMenu.objectId!
                                      );
                                      if (object !== undefined) {
                                        void sendCommand({
                                          type: "canvas.object.update",
                                          objectId: object.id,
                                          changes: { z: minZ - 1 }
                                        });
                                      }
                                    }
                                  ]
                                ] as const)
                              : []),
                            ...(contextMenu.objectId !== undefined &&
                            objectById.get(contextMenu.objectId)?.sceneId !==
                              undefined
                              ? ([
                                  [
                                    "Open Draft",
                                    () => {
                                      const sceneId = objectById.get(
                                        contextMenu.objectId!
                                      )?.sceneId;
                                      if (sceneId !== undefined) {
                                        onOpenDraft?.(sceneId);
                                      }
                                    }
                                  ],
                                  ...(compact
                                    ? []
                                    : ([
                                        [
                                          "Open Split",
                                          () => {
                                            const sceneId = objectById.get(
                                              contextMenu.objectId!
                                            )?.sceneId;
                                            if (sceneId !== undefined) {
                                              onOpenSplit?.(sceneId);
                                            }
                                          }
                                        ]
                                      ] as const))
                                ] as const)
                              : []),
                            [
                              "Open Details · ]",
                              () => setShowInspector(true)
                            ],
                            [
                              "Canvas history",
                              () => {
                                setShowHistory(true);
                                void onLoadHistory();
                              }
                            ],
                            ["Select · V", () => activateTool("select")],
                            ["Hand · H", () => activateTool("hand")]
                          ] as const
                        ).map(([label, action]) => (
                          <Pressable
                            accessibilityLabel={label}
                            accessibilityRole="menuitem"
                            key={label}
                            onPress={() => {
                              action();
                              setContextMenu(undefined);
                            }}
                            style={({ pressed }) => [
                              styles.contextMenuItem,
                              pressed && styles.pressed
                            ]}
                          >
                            <Text style={styles.contextMenuItemText}>
                              {label}
                            </Text>
                          </Pressable>
                        ))}
                        <Pressable
                          accessibilityLabel="Close context menu"
                          accessibilityRole="menuitem"
                          onPress={() => setContextMenu(undefined)}
                          style={({ pressed }) => [
                            styles.contextMenuItem,
                            pressed && styles.pressed
                          ]}
                        >
                          <Text style={styles.contextMenuItemText}>
                            Close · Esc
                          </Text>
                        </Pressable>
                      </View>
                    )}
                  </View>
                </View>
              ) : (
                <View accessibilityLabel="Ordered Canvas outline" style={styles.outline}>
                  <View style={styles.outlineHeading}>
                    <View style={styles.headingCopy}>
                      <Text style={styles.outlineEyebrow}>Ordered view</Text>
                      <Text style={styles.outlineTitle}>
                        Every object, without spatial gestures
                      </Text>
                    </View>
                    <Text style={styles.outlineRule}>
                      Select an item, then use labeled inspector controls to move,
                      resize, link, archive, confirm, or dismiss it.
                    </Text>
                  </View>
                  {orderedOutline.length === 0 ? (
                    <View style={styles.outlineEmpty}>
                      <Text style={styles.emptyTitle}>Nothing placed yet</Text>
                      <Text style={styles.emptyText}>
                        Canvas actions above create the first confirmed or provisional
                        object.
                      </Text>
                    </View>
                  ) : (
                    <View style={styles.outlineList}>
                      {orderedOutline.map((item, index) => {
                        const canonicalState = canvasCanonicalReferenceState(
                          item.object,
                          project
                        );
                        return (
                          <Pressable
                            accessibilityLabel={`Canvas object ${index + 1}: ${
                              item.object.label
                            }, ${item.authorityLabel}, ${item.stateLabel}, ${
                              canonicalState.label === undefined
                                ? ""
                                : `${canonicalState.label}, `
                            }${item.positionLabel}`}
                          accessibilityRole="button"
                          accessibilityState={{
                            selected: item.object.id === selectedObjectId
                          }}
                          key={item.object.id}
                          onPress={() => selectObject(item.object)}
                            style={({ pressed }) => [
                              styles.outlineRow,
                              item.object.authority === "provisional" &&
                                styles.outlineRowProvisional,
                              item.object.archivedAt !== undefined &&
                                styles.outlineRowArchived,
                              canonicalState.stale && styles.outlineRowStale,
                              item.object.id === selectedObjectId &&
                                styles.outlineRowSelected,
                              lensProjection?.dimmedObjectIds.has(
                                item.object.id
                              ) && styles.outlineRowDimmed,
                              lensProjection?.primaryObjectIds.has(
                                item.object.id
                              ) && styles.outlineRowPrimary,
                              pressed && styles.pressed
                            ]}
                          >
                            <Text style={styles.outlineIndex}>{index + 1}</Text>
                            <View style={styles.outlineCopy}>
                              <View style={styles.outlineTitleRow}>
                                <Text style={styles.outlineObjectTitle}>
                                  {item.object.label}
                                </Text>
                                <Text style={styles.outlineAuthority}>
                                  {item.authorityLabel} · {item.stateLabel}
                                </Text>
                              </View>
                              {canonicalState.label === undefined ? null : (
                                <Text style={styles.outlineStale}>
                                  {canonicalState.label}
                                </Text>
                              )}
                              <Text style={styles.outlineMeta}>
                                {objectKindLabel(item.object)} ·{" "}
                                {item.positionLabel}
                              </Text>
                              {item.orderLabel === undefined ? null : (
                                <Text style={styles.outlineOrder}>
                                  {item.orderLabel}
                                </Text>
                              )}
                              <Text numberOfLines={3} style={styles.outlineDetail}>
                                {objectDetail(item.object, scenes, project)}
                              </Text>
                            </View>
                          </Pressable>
                        );
                      })}
                    </View>
                  )}
                </View>
              )}
            </View>
            {inspector}
          </View>
          <ReadingSpine
            onSelectObject={(objectId) => {
              const object = objectById.get(objectId);
              if (object !== undefined) selectObject(object);
            }}
            onSelectScene={onSelectScene}
            project={project}
            workspace={workspace}
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: colors.paper,
    borderColor: colors.line,
    borderRadius: 0,
    borderWidth: 0,
    flex: 1,
    minHeight: 0,
    minWidth: 0,
    overflow: "hidden",
    position: "relative",
    width: "100%"
  },
  chromeHeader: {
    alignItems: "center",
    backgroundColor: colors.topbar,
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    minHeight: 36,
    paddingHorizontal: 8,
    paddingVertical: 4
  },
  chromeGroup: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 3
  },
  chromeDivider: {
    alignSelf: "stretch",
    backgroundColor: colors.line,
    marginHorizontal: 2,
    minHeight: 22,
    width: 1
  },
  chromeSpacer: {
    flex: 1,
    minWidth: 8
  },
  heading: {
    alignItems: "flex-start",
    backgroundColor: "#f8f2e9",
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 14,
    justifyContent: "space-between",
    padding: 16
  },
  headingCopy: {
    flex: 1,
    minWidth: 0
  },
  eyebrow: {
    color: colors.kicker,
    fontFamily: fonts.uiSemibold,
    fontSize: 9,
    letterSpacing: 1.6,
    textTransform: "uppercase"
  },
  title: {
    color: colors.ink,
    fontFamily: fonts.story,
    fontSize: 29,
    marginTop: 2
  },
  intro: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 9,
    lineHeight: 14,
    marginTop: 4,
    maxWidth: 660
  },
  canvasStatus: {
    alignItems: "flex-end",
    gap: 4
  },
  canvasMeta: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 8
  },
  saveStatus: {
    color: colors.green,
    fontFamily: fonts.uiSemibold,
    fontSize: 9
  },
  saveStatusWarning: {
    color: colors.amber
  },
  message: {
    alignItems: "center",
    backgroundColor: colors.redSoft,
    borderBottomColor: colors.red,
    borderBottomWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    justifyContent: "space-between",
    padding: 11
  },
  messageConflict: {
    backgroundColor: colors.amberSoft,
    borderBottomColor: colors.amber
  },
  messageText: {
    color: colors.ink,
    flex: 1,
    fontFamily: fonts.uiMedium,
    fontSize: 9,
    lineHeight: 14,
    minWidth: 220
  },
  toolbar: {
    backgroundColor: colors.topbar,
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    gap: 8,
    padding: 10
  },
  toolbarGroup: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6
  },
  iconButton: {
    alignItems: "center",
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 6,
    borderWidth: 1,
    height: 28,
    justifyContent: "center",
    minWidth: 28,
    paddingHorizontal: 5
  },
  iconButtonSelected: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent
  },
  iconButtonGlyph: {
    color: colors.ink,
    fontFamily: fonts.uiSemibold,
    fontSize: 10
  },
  iconButtonGlyphSelected: {
    color: colors.accent
  },
  searchBox: {
    minWidth: 120,
    position: "relative",
    zIndex: 20
  },
  searchInput: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 6,
    borderWidth: 1,
    color: colors.ink,
    fontFamily: fonts.ui,
    fontSize: 9,
    minHeight: 28,
    paddingHorizontal: 8,
    paddingVertical: 4,
    width: 120
  },
  searchResults: {
    backgroundColor: colors.paper,
    borderColor: colors.line,
    borderRadius: 7,
    borderWidth: 1,
    elevation: 5,
    gap: 3,
    left: 0,
    minWidth: 220,
    padding: 5,
    position: "absolute",
    shadowColor: "#1d150f",
    shadowOffset: { height: 5, width: 0 },
    shadowOpacity: 0.16,
    shadowRadius: 12,
    top: 38,
    zIndex: 30
  },
  pendingLinkSheet: {
    backgroundColor: colors.accentSoft,
    borderBottomColor: colors.accent,
    borderBottomWidth: 1,
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  pendingLinkTitle: {
    color: colors.accent,
    fontFamily: fonts.uiSemibold,
    fontSize: 9
  },
  pendingLinkMeta: {
    color: colors.ink,
    fontFamily: fonts.uiMedium,
    fontSize: 9
  },
  selectionBar: {
    alignItems: "center",
    backgroundColor: colors.accentSoft,
    borderBottomColor: colors.accent,
    borderBottomWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 5,
    padding: 8
  },
  selectionBarTitle: {
    color: colors.ink,
    flexGrow: 1,
    fontFamily: fonts.uiSemibold,
    fontSize: 9,
    minWidth: 120
  },
  button: {
    alignItems: "center",
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 6,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 34,
    paddingHorizontal: 10,
    paddingVertical: 6
  },
  buttonPrimary: {
    backgroundColor: colors.brandDark,
    borderColor: colors.brandDark
  },
  buttonDanger: {
    backgroundColor: colors.redSoft,
    borderColor: colors.red
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
  buttonTextDanger: {
    color: colors.red
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
  narrowPosture: {
    color: colors.blue,
    fontFamily: fonts.uiMedium,
    fontSize: 8,
    lineHeight: 13
  },
  historyPanel: {
    backgroundColor: colors.wash,
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    gap: 10,
    padding: 14
  },
  historyHeading: {
    alignItems: "flex-start",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    justifyContent: "space-between"
  },
  historyEyebrow: {
    color: colors.kicker,
    fontFamily: fonts.uiSemibold,
    fontSize: 8,
    letterSpacing: 1.2,
    textTransform: "uppercase"
  },
  historyTitle: {
    color: colors.ink,
    fontFamily: fonts.story,
    fontSize: 22,
    marginTop: 2
  },
  historyRule: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 8,
    lineHeight: 13,
    maxWidth: 430
  },
  historyList: {
    gap: 6
  },
  historyRow: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 7,
    borderWidth: 1,
    padding: 9
  },
  historyRowSelected: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent
  },
  historyVersion: {
    color: colors.ink,
    fontFamily: fonts.uiSemibold,
    fontSize: 9
  },
  historyReason: {
    color: colors.accent,
    fontFamily: fonts.uiMedium,
    fontSize: 8,
    marginTop: 2
  },
  historyTime: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 7,
    marginTop: 2
  },
  historyConfirm: {
    color: colors.ink,
    fontFamily: fonts.uiMedium,
    fontSize: 9,
    lineHeight: 14,
    marginTop: 8
  },
  historyConfirmation: {
    backgroundColor: colors.amberSoft,
    borderColor: colors.amber,
    borderRadius: 7,
    borderWidth: 1,
    gap: 7,
    padding: 10
  },
  historyConfirmationTitle: {
    color: colors.ink,
    fontFamily: fonts.uiSemibold,
    fontSize: 10
  },
  historyConfirmationText: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 8,
    lineHeight: 13
  },
  knowledgePlacement: {
    backgroundColor: colors.greenSoft,
    borderBottomColor: colors.green,
    borderBottomWidth: 1,
    gap: 9,
    padding: 14
  },
  knowledgePlacementHeading: {
    alignItems: "flex-start",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    justifyContent: "space-between"
  },
  knowledgePlacementEyebrow: {
    color: colors.green,
    fontFamily: fonts.uiSemibold,
    fontSize: 8,
    letterSpacing: 1.2,
    textTransform: "uppercase"
  },
  knowledgePlacementTitle: {
    color: colors.ink,
    fontFamily: fonts.story,
    fontSize: 21,
    marginTop: 2
  },
  knowledgePlacementRule: {
    color: colors.green,
    fontFamily: fonts.uiMedium,
    fontSize: 8,
    lineHeight: 13,
    maxWidth: 430
  },
  sceneForm: {
    backgroundColor: colors.wash,
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    gap: 10,
    padding: 14
  },
  sceneFormHeading: {
    alignItems: "flex-start",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    justifyContent: "space-between"
  },
  sceneFormEyebrow: {
    color: colors.kicker,
    fontFamily: fonts.uiSemibold,
    fontSize: 8,
    letterSpacing: 1.2,
    textTransform: "uppercase"
  },
  sceneFormTitle: {
    color: colors.ink,
    fontFamily: fonts.story,
    fontSize: 22,
    marginTop: 2
  },
  sceneFormRule: {
    color: colors.green,
    fontFamily: fonts.uiMedium,
    fontSize: 8,
    lineHeight: 13,
    maxWidth: 270
  },
  sceneFormHint: {
    color: colors.accent,
    fontFamily: fonts.uiMedium,
    fontSize: 8,
    lineHeight: 13
  },
  field: {
    flexGrow: 1,
    minWidth: 0
  },
  fieldLabel: {
    color: colors.muted,
    fontFamily: fonts.uiSemibold,
    fontSize: 8,
    letterSpacing: 0.5,
    marginBottom: 4,
    marginTop: 7,
    textTransform: "uppercase"
  },
  input: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 6,
    borderWidth: 1,
    color: colors.ink,
    fontFamily: fonts.ui,
    fontSize: 10,
    minHeight: 38,
    minWidth: 0,
    paddingHorizontal: 9,
    paddingVertical: 7,
    width: "100%"
  },
  inputMultiline: {
    minHeight: 80,
    textAlignVertical: "top"
  },
  choiceRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 5,
    minWidth: 0
  },
  geometryRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    minWidth: 0
  },
  aggregateGrid: {
    backgroundColor: colors.wash,
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    padding: 10
  },
  aggregateCard: {
    backgroundColor: colors.paper,
    borderColor: colors.line,
    borderRadius: 9,
    borderWidth: 1,
    flexGrow: 1,
    minWidth: 190,
    padding: 10
  },
  aggregateEyebrow: {
    color: colors.kicker,
    fontFamily: fonts.uiSemibold,
    fontSize: 7,
    letterSpacing: 1.1,
    textTransform: "uppercase"
  },
  aggregateTitle: {
    color: colors.ink,
    fontFamily: fonts.story,
    fontSize: 19,
    marginTop: 2
  },
  aggregateMeta: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 8,
    marginTop: 3
  },
  aggregateAction: {
    color: colors.accent,
    fontFamily: fonts.uiSemibold,
    fontSize: 8,
    marginTop: 7
  },
  focusStage: {
    alignItems: "flex-start",
    backgroundColor: colors.paper,
    borderBottomColor: colors.accent,
    borderBottomWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    justifyContent: "space-between",
    padding: 13
  },
  focusStageEyebrow: {
    color: colors.kicker,
    fontFamily: fonts.uiSemibold,
    fontSize: 7,
    letterSpacing: 1.2,
    textTransform: "uppercase"
  },
  focusStageTitle: {
    color: colors.ink,
    fontFamily: fonts.story,
    fontSize: 24,
    marginTop: 2
  },
  focusStageSummary: {
    color: colors.muted,
    fontFamily: fonts.storyItalic,
    fontSize: 10,
    lineHeight: 15,
    marginTop: 3,
    maxWidth: 560
  },
  focusStageMeta: {
    color: colors.accent,
    fontFamily: fonts.uiMedium,
    fontSize: 8,
    marginTop: 5
  },
  largeBoardNotice: {
    backgroundColor: colors.blueSoft,
    borderBottomColor: colors.blue,
    borderBottomWidth: 1,
    padding: 9
  },
  largeBoardText: {
    color: colors.blue,
    fontFamily: fonts.uiMedium,
    fontSize: 8,
    lineHeight: 13
  },
  loading: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 360,
    padding: 24
  },
  emptyTitle: {
    color: colors.ink,
    fontFamily: fonts.story,
    fontSize: 20
  },
  emptyText: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 9,
    lineHeight: 14,
    marginTop: 3
  },
  canvasBody: {
    alignItems: "stretch",
    flex: 1,
    flexDirection: "row",
    minHeight: 0,
    minWidth: 0
  },
  canvasBodyStacked: {
    flexDirection: "column"
  },
  canvasMain: {
    flex: 1,
    minHeight: 0,
    minWidth: 0
  },
  viewportControls: {
    alignItems: "center",
    backgroundColor: colors.wash,
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    justifyContent: "space-between",
    minHeight: 36,
    paddingHorizontal: 8,
    paddingVertical: 4
  },
  zoomLabel: {
    color: colors.ink,
    fontFamily: fonts.uiSemibold,
    fontSize: 9,
    minWidth: 38,
    textAlign: "center"
  },
  viewportSummary: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 8
  },
  minimap: {
    alignItems: "center",
    backgroundColor: colors.paper,
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 7,
    paddingHorizontal: 9,
    paddingVertical: 5
  },
  minimapLabel: {
    color: colors.ink,
    fontFamily: fonts.uiSemibold,
    fontSize: 7
  },
  minimapTrack: {
    backgroundColor: colors.line,
    borderRadius: 99,
    flex: 1,
    height: 5,
    maxWidth: 180,
    overflow: "hidden"
  },
  minimapViewport: {
    backgroundColor: colors.accent,
    borderRadius: 99,
    height: 5
  },
  minimapMeta: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 7
  },
  surface: {
    backgroundColor: "#eee8df",
    flex: 1,
    minHeight: 420,
    minWidth: 0,
    overflow: "hidden",
    position: "relative"
  },
  linkHandle: {
    alignItems: "center",
    backgroundColor: colors.accent,
    borderColor: colors.panel,
    borderRadius: 12,
    borderWidth: 2,
    height: 24,
    justifyContent: "center",
    position: "absolute",
    // Keep inside the card so board overflow does not clip the control.
    right: 6,
    top: "42%",
    width: 24,
    zIndex: 5,
    ...(typeof window !== "undefined"
      ? ({ cursor: "pointer" } as object)
      : {})
  },
  linkHandleGlyph: {
    color: "#ffffff",
    fontFamily: fonts.uiSemibold,
    fontSize: 14,
    lineHeight: 16
  },
  linkRubberBand: {
    borderStyle: "dashed",
    borderTopColor: colors.accent,
    borderTopWidth: 2,
    height: 1,
    opacity: 0.9,
    position: "absolute",
    transformOrigin: "left center",
    zIndex: 40
  },
  modalRoot: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    padding: 18,
    zIndex: 80
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(28, 22, 18, 0.42)"
  },
  modalCard: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 12,
    borderWidth: 1,
    elevation: 10,
    maxHeight: "86%",
    maxWidth: 560,
    shadowColor: "#1d150f",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.22,
    shadowRadius: 24,
    width: "100%",
    zIndex: 1
  },
  modalHeader: {
    alignItems: "flex-start",
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12
  },
  modalEyebrow: {
    color: colors.kicker,
    fontFamily: fonts.uiSemibold,
    fontSize: 8,
    letterSpacing: 1.1,
    textTransform: "uppercase"
  },
  modalTitle: {
    color: colors.ink,
    fontFamily: fonts.story,
    fontSize: 22,
    marginTop: 2
  },
  modalRule: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 9,
    lineHeight: 13,
    marginTop: 4
  },
  modalClose: {
    alignItems: "center",
    borderColor: colors.line,
    borderRadius: 6,
    borderWidth: 1,
    height: 30,
    justifyContent: "center",
    minWidth: 30
  },
  modalCloseText: {
    color: colors.ink,
    fontFamily: fonts.uiSemibold,
    fontSize: 18,
    lineHeight: 20
  },
  modalScroll: {
    maxHeight: 420
  },
  modalBody: {
    gap: 4,
    paddingHorizontal: 16,
    paddingVertical: 12
  },
  modalFooter: {
    borderTopColor: colors.line,
    borderTopWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "flex-end",
    paddingHorizontal: 16,
    paddingVertical: 12
  },
  contextMenu: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 8,
    borderWidth: 1,
    elevation: 6,
    gap: 2,
    minWidth: 168,
    padding: 5,
    position: "absolute",
    shadowColor: "#1d150f",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.16,
    shadowRadius: 10,
    zIndex: 50
  },
  contextMenuItem: {
    borderRadius: 5,
    paddingHorizontal: 8,
    paddingVertical: 7
  },
  contextMenuItemText: {
    color: colors.ink,
    fontFamily: fonts.uiMedium,
    fontSize: 9
  },
  lane: {
    borderRightColor: "#d6cdc1",
    borderRightWidth: 1,
    bottom: 0,
    padding: 10,
    position: "absolute",
    top: 0,
    width: "33.333%"
  },
  laneOne: {
    left: 0
  },
  laneTwo: {
    left: "33.333%"
  },
  laneThree: {
    borderRightWidth: 0,
    left: "66.666%"
  },
  laneLabel: {
    color: "#a0968b",
    fontFamily: fonts.uiSemibold,
    fontSize: 8,
    letterSpacing: 1.2,
    textTransform: "uppercase"
  },
  spatialObject: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 8,
    borderWidth: 1,
    minWidth: 0,
    overflow: "visible",
    position: "absolute",
    shadowColor: "#2c2a27",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 5
  },
  spatialObjectDragging: {
    shadowOpacity: 0.22,
    shadowRadius: 14
  },
  spatialObjectLinkTarget: {
    borderColor: colors.green,
    borderWidth: 2,
    shadowColor: colors.green,
    shadowOpacity: 0.28,
    shadowRadius: 10
  },
  sceneObject: {
    borderTopColor: colors.accent,
    borderTopWidth: 3
  },
  knowledgeObject: {
    backgroundColor: colors.greenSoft,
    borderColor: colors.green
  },
  noteObject: {
    backgroundColor: "#fff7dc",
    borderColor: "#d7bd69"
  },
  regionObject: {
    backgroundColor: "rgba(117,69,53,0.04)",
    borderColor: colors.accent,
    borderWidth: 2
  },
  imageObject: {
    backgroundColor: colors.blueSoft,
    borderColor: colors.blue
  },
  provisionalObject: {
    borderColor: colors.blue,
    borderStyle: "dashed",
    borderWidth: 2
  },
  staleObject: {
    backgroundColor: colors.redSoft,
    borderColor: colors.red,
    borderWidth: 2
  },
  dimmedObject: {
    opacity: 0.42
  },
  primaryObject: {
    borderColor: colors.kicker,
    borderWidth: 2
  },
  chapterOverlay: {
    alignItems: "flex-start",
    backgroundColor: "rgba(117,69,53,0.08)",
    borderColor: colors.accent,
    borderRadius: 10,
    borderStyle: "dashed",
    borderWidth: 2,
    justifyContent: "flex-end",
    padding: 10,
    position: "absolute",
    zIndex: 40
  },
  chapterOverlayLabel: {
    color: colors.accent,
    fontFamily: fonts.uiSemibold,
    fontSize: 8,
    textTransform: "uppercase"
  },
  spatialObjectSelected: {
    borderColor: colors.kicker,
    borderWidth: 3
  },
  spatialObjectPressable: {
    flex: 1,
    minWidth: 0,
    padding: 10
  },
  quickActionRow: {
    borderTopColor: colors.line,
    borderTopWidth: 1,
    flexDirection: "row"
  },
  quickAction: {
    alignItems: "center",
    backgroundColor: colors.blueSoft,
    flex: 1,
    justifyContent: "center",
    minHeight: 30,
    paddingHorizontal: 6,
    paddingVertical: 5
  },
  quickActionDanger: {
    backgroundColor: colors.redSoft,
    borderLeftColor: colors.line,
    borderLeftWidth: 1
  },
  quickActionText: {
    color: colors.blue,
    fontFamily: fonts.uiSemibold,
    fontSize: 7,
    textTransform: "uppercase"
  },
  quickActionTextDanger: {
    color: colors.red
  },
  objectBadge: {
    color: colors.accent,
    fontFamily: fonts.uiSemibold,
    fontSize: 7,
    letterSpacing: 0.6,
    textTransform: "uppercase"
  },
  provisionalBadge: {
    color: colors.blue
  },
  objectTitle: {
    color: colors.ink,
    fontFamily: fonts.story,
    fontSize: 17,
    marginTop: 4
  },
  objectDetail: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 8,
    lineHeight: 12,
    marginTop: 3
  },
  spatialLink: {
    borderTopColor: colors.accent,
    borderTopWidth: 2,
    height: 1,
    position: "absolute",
    transformOrigin: "left center"
  },
  spatialLinkProvisional: {
    borderStyle: "dashed",
    borderTopColor: colors.blue
  },
  surfaceEmpty: {
    alignItems: "center",
    left: "20%",
    position: "absolute",
    right: "20%",
    top: 220
  },
  outline: {
    backgroundColor: colors.wash,
    minHeight: 380,
    minWidth: 0,
    padding: 12
  },
  outlineHeading: {
    alignItems: "flex-start",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "space-between",
    marginBottom: 10
  },
  outlineEyebrow: {
    color: colors.kicker,
    fontFamily: fonts.uiSemibold,
    fontSize: 8,
    letterSpacing: 1.2,
    textTransform: "uppercase"
  },
  outlineTitle: {
    color: colors.ink,
    fontFamily: fonts.story,
    fontSize: 21,
    marginTop: 2
  },
  outlineRule: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 8,
    lineHeight: 13,
    maxWidth: 360
  },
  outlineEmpty: {
    alignItems: "center",
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 8,
    borderWidth: 1,
    padding: 24
  },
  outlineList: {
    gap: 7
  },
  outlineRow: {
    alignItems: "flex-start",
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 9,
    minWidth: 0,
    padding: 10
  },
  outlineRowProvisional: {
    borderColor: colors.blue,
    borderStyle: "dashed",
    borderWidth: 2
  },
  outlineRowArchived: {
    backgroundColor: colors.wash,
    opacity: 0.72
  },
  outlineRowStale: {
    backgroundColor: colors.redSoft,
    borderColor: colors.red
  },
  outlineRowSelected: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent
  },
  outlineRowDimmed: {
    opacity: 0.5
  },
  outlineRowPrimary: {
    borderColor: colors.kicker,
    borderWidth: 2
  },
  outlineIndex: {
    color: colors.kicker,
    fontFamily: fonts.story,
    fontSize: 17,
    width: 24
  },
  outlineCopy: {
    flex: 1,
    minWidth: 0
  },
  outlineTitleRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    justifyContent: "space-between"
  },
  outlineObjectTitle: {
    color: colors.ink,
    flexShrink: 1,
    fontFamily: fonts.uiSemibold,
    fontSize: 10
  },
  outlineAuthority: {
    color: colors.blue,
    fontFamily: fonts.uiSemibold,
    fontSize: 7,
    textTransform: "uppercase"
  },
  outlineMeta: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 8,
    marginTop: 3
  },
  outlineStale: {
    color: colors.red,
    fontFamily: fonts.uiSemibold,
    fontSize: 8,
    marginTop: 3,
    textTransform: "uppercase"
  },
  outlineOrder: {
    color: colors.accent,
    fontFamily: fonts.uiMedium,
    fontSize: 8,
    marginTop: 3
  },
  outlineDetail: {
    color: colors.ink,
    fontFamily: fonts.story,
    fontSize: 13,
    lineHeight: 17,
    marginTop: 4
  },
  inspector: {
    backgroundColor: colors.paper,
    borderLeftColor: colors.line,
    borderLeftWidth: 1,
    gap: 8,
    maxWidth: 330,
    minWidth: 270,
    padding: 12,
    width: "31%"
  },
  inspectorStacked: {
    borderLeftWidth: 0,
    borderTopColor: colors.line,
    borderTopWidth: 1,
    maxWidth: "100%",
    minWidth: 0,
    width: "100%"
  },
  inspectorHeading: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between"
  },
  inspectorTitle: {
    color: colors.ink,
    fontFamily: fonts.story,
    fontSize: 21
  },
  authorityCard: {
    backgroundColor: colors.greenSoft,
    borderColor: colors.green,
    borderRadius: 7,
    borderWidth: 1,
    padding: 9
  },
  authorityCardProvisional: {
    backgroundColor: colors.blueSoft,
    borderColor: colors.blue,
    borderStyle: "dashed"
  },
  authorityCardStale: {
    backgroundColor: colors.redSoft,
    borderColor: colors.red,
    borderStyle: "solid"
  },
  authorityLabel: {
    color: colors.ink,
    fontFamily: fonts.uiSemibold,
    fontSize: 8,
    textTransform: "uppercase"
  },
  authorityMeta: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 7,
    lineHeight: 11,
    marginTop: 3
  },
  actionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 5,
    minWidth: 0
  },
  inspectorSectionTitle: {
    borderTopColor: colors.line,
    borderTopWidth: 1,
    color: colors.ink,
    fontFamily: fonts.uiSemibold,
    fontSize: 9,
    marginTop: 6,
    paddingTop: 9
  },
  inspectorHelp: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 8,
    lineHeight: 13
  },
  inspectorHelpWarning: {
    color: colors.amber,
    fontFamily: fonts.uiSemibold
  },
  linkList: {
    gap: 5,
    marginTop: 5
  },
  linkRow: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 6,
    borderWidth: 1,
    padding: 8
  },
  linkRowSelected: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent
  },
  linkRowProvisional: {
    borderColor: colors.blue,
    borderStyle: "dashed"
  },
  linkTitle: {
    color: colors.ink,
    fontFamily: fonts.uiMedium,
    fontSize: 8
  },
  linkMeta: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 7,
    marginTop: 2
  },
  selectedLink: {
    backgroundColor: colors.wash,
    borderColor: colors.line,
    borderRadius: 7,
    borderWidth: 1,
    marginTop: 3,
    padding: 8
  },
  spatialStage: {
    flex: 1,
    flexDirection: "row",
    minHeight: 0,
    minWidth: 0
  },
  zoomRailDock: {
    alignItems: "center",
    backgroundColor: colors.wash,
    borderRightColor: colors.line,
    borderRightWidth: 1,
    gap: 6,
    paddingHorizontal: 4,
    paddingVertical: 8,
    width: 40,
    zIndex: 4
  },
  zoomRailToggle: {
    alignItems: "center",
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 6,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 34,
    paddingHorizontal: 2,
    width: 32
  },
  zoomRailToggleOpen: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent
  },
  zoomRailToggleText: {
    color: colors.ink,
    fontFamily: fonts.uiSemibold,
    fontSize: 8,
    textAlign: "center"
  },
  zoomRailTrack: {
    backgroundColor: colors.line,
    borderRadius: 99,
    flexGrow: 1,
    maxHeight: 180,
    minHeight: 120,
    overflow: "hidden",
    position: "relative",
    width: 10
  },
  zoomRailFill: {
    backgroundColor: colors.accent,
    bottom: 0,
    left: 0,
    opacity: 0.55,
    position: "absolute",
    right: 0
  },
  zoomRailThumb: {
    backgroundColor: colors.ink,
    borderRadius: 99,
    height: 12,
    left: -3,
    marginTop: -6,
    position: "absolute",
    width: 16
  },
  spine: {
    backgroundColor: colors.brandDark,
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4
  },
  spineMinimized: {
    minHeight: 28,
    paddingVertical: 2
  },
  spineCollapsed: {
    gap: 2,
    paddingVertical: 4
  },
  spineHeading: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    justifyContent: "space-between"
  },
  spineMiniToggle: {
    borderRadius: 5,
    paddingHorizontal: 4,
    paddingVertical: 2
  },
  spineMiniLabel: {
    color: "#d6b8a9",
    fontFamily: fonts.uiSemibold,
    fontSize: 8,
    letterSpacing: 0.4
  },
  spineRule: {
    color: colors.railText,
    fontFamily: fonts.ui,
    fontSize: 8,
    lineHeight: 12,
    maxWidth: 280
  },
  spineEmpty: {
    color: colors.railText,
    fontFamily: fonts.ui,
    fontSize: 8
  },
  spineList: {
    gap: 7,
    paddingBottom: 2,
    paddingTop: 2
  },
  spineBubbleList: {
    alignItems: "center",
    gap: 8,
    minHeight: 26,
    paddingHorizontal: 2,
    paddingVertical: 2
  },
  spineBubble: {
    alignItems: "center",
    backgroundColor: colors.railActive,
    borderColor: "#64564d",
    borderRadius: 12,
    borderWidth: 1,
    height: 24,
    justifyContent: "center",
    width: 24
  },
  spineBubbleOpen: {
    borderColor: "#a98c7c",
    borderStyle: "dashed"
  },
  spineBubbleArchived: {
    backgroundColor: "#4f3434",
    borderColor: "#e0a4a4"
  },
  spineBubbleHover: {
    backgroundColor: "#6d5c51"
  },
  spineBubbleIndex: {
    color: "#ffffff",
    fontFamily: fonts.uiSemibold,
    fontSize: 11
  },
  spineEntry: {
    alignItems: "center",
    backgroundColor: colors.railActive,
    borderColor: "#64564d",
    borderRadius: 7,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    minWidth: 210,
    padding: 8
  },
  spineEntryOpen: {
    borderColor: "#a98c7c",
    borderStyle: "dashed"
  },
  spineEntryArchived: {
    backgroundColor: "#4f3434",
    borderColor: "#e0a4a4",
    borderStyle: "solid"
  },
  spineIndex: {
    color: "#ffffff",
    fontFamily: fonts.story,
    fontSize: 18,
    width: 24
  },
  spineCopy: {
    flex: 1,
    minWidth: 0
  },
  spineScene: {
    color: "#ffffff",
    fontFamily: fonts.uiMedium,
    fontSize: 8
  },
  spineMeta: {
    color: colors.railText,
    fontFamily: fonts.ui,
    fontSize: 7,
    marginTop: 2
  },
  spineStale: {
    color: "#f3b7b7",
    fontFamily: fonts.uiSemibold,
    fontSize: 7,
    marginTop: 2,
    textTransform: "uppercase"
  },
  spineDrift: {
    color: "#d6b8a9",
    fontFamily: fonts.uiSemibold,
    fontSize: 7,
    marginTop: 2,
    textTransform: "uppercase"
  }
});
