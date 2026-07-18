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
  PROVISIONAL_BEAT_FIXTURE_SOURCE,
  canvasDrillScopeKey,
  chapterBoundOverlays,
  currentDrillScope,
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
  availableCanvasStoryKnowledge,
  canvasChapterAggregates,
  canonicalIndexForCanvasHandoff,
  canvasCapturePosition,
  canvasCanonicalReferenceState,
  canvasDriftLabel,
  canvasHistoryLabel,
  canvasPositionAfterDrag,
  canvasSceneFocus,
  canvasScreenFrame,
  canvasToolInstruction,
  clampCanvasZoom,
  fitCanvasObjects,
  projectCanvasOutline,
  searchCanvasObjects,
  visibleCanvasObjects,
  type CanvasTool,
  type CanvasViewport,
  type CanvasViewportSize
} from "./canvas-model.js";

const { colors, fonts } = ghostwriterTheme;
const OBJECT_NUDGE = 24;
const OBJECT_RESIZE = 24;

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
  }): Promise<boolean>;
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

function SpatialObjectCard({
  object,
  viewport,
  selected,
  detail,
  staleLabel,
  dimmed = false,
  primary = false,
  onDismiss,
  onMove,
  onReview,
  onSelect,
  onDrillIntoScene
}: Readonly<{
  object: CanvasObject;
  viewport: CanvasViewport;
  selected: boolean;
  detail: string;
  staleLabel?: string;
  dimmed?: boolean;
  primary?: boolean;
  onDismiss(object: CanvasObject): Promise<void>;
  onMove(object: CanvasObject, x: number, y: number): Promise<void>;
  onReview(object: CanvasObject): void;
  onSelect(object: CanvasObject): void;
  onDrillIntoScene?(object: CanvasObject): void;
}>) {
  const [dragDelta, setDragDelta] = useState({ x: 0, y: 0 });
  const draggedRef = useRef(false);
  const frame = canvasScreenFrame(object, viewport);
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          Math.abs(gesture.dx) > 3 || Math.abs(gesture.dy) > 3,
        onPanResponderGrant: () => {
          draggedRef.current = false;
          onSelect(object);
        },
        onPanResponderMove: (_event, gesture) => {
          draggedRef.current = true;
          setDragDelta({ x: gesture.dx, y: gesture.dy });
        },
        onPanResponderRelease: (_event, gesture) => {
          const moved = draggedRef.current;
          setDragDelta({ x: 0, y: 0 });
          draggedRef.current = false;
          if (!moved) return;
          const next = canvasPositionAfterDrag(
            { x: object.x, y: object.y },
            { x: gesture.dx, y: gesture.dy },
            viewport.zoom
          );
          void onMove(object, next.x, next.y);
        },
        onPanResponderTerminate: () => {
          setDragDelta({ x: 0, y: 0 });
          draggedRef.current = false;
        }
      }),
    [object, onMove, onSelect, viewport.zoom]
  );

  return (
    <View
      {...panResponder.panHandlers}
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
        {
          ...(object.kind === "note" && object.note?.color !== undefined
            ? { backgroundColor: object.note.color }
            : {}),
          height: Math.max(76, frame.height),
          left: frame.left + dragDelta.x,
          top: frame.top + dragDelta.y,
          width: Math.max(132, frame.width),
          zIndex: Math.round(object.z + 100)
        }
      ]}
    >
      <Pressable
        accessibilityLabel={`${objectKindLabel(object)} ${object.label}`}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        onPress={() => onSelect(object)}
        style={({ pressed }) => [
          styles.spatialObjectPressable,
          pressed && styles.pressed
        ]}
      >
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
      </Pressable>
      {object.kind === "scene-card" && onDrillIntoScene !== undefined ? (
        <Pressable
          accessibilityLabel={`Enter scene lens for ${object.label}`}
          accessibilityRole="button"
          onPress={(event) => {
            event.stopPropagation();
            onDrillIntoScene(object);
          }}
          style={({ pressed }) => [
            styles.quickAction,
            pressed && styles.pressed
          ]}
        >
          <Text style={styles.quickActionText}>Enter scene</Text>
        </Pressable>
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
  const scenes = new Map(allScenes(project).map((scene) => [scene.id, scene]));
  const bookById = new Map(project.books.map((book) => [book.id, book]));

  return (
    <View accessibilityLabel="Reading-order spine" style={styles.spine}>
      <View style={styles.spineHeading}>
        <View style={styles.headingCopy}>
          <Text style={styles.spineEyebrow}>Reading-order spine</Text>
          <Text style={styles.spineTitle}>Draft remains canonical</Text>
        </View>
        <Text style={styles.spineRule}>
          Canvas position never silently reorders the manuscript.
        </Text>
      </View>
      {workspace.spine.entries.length === 0 ? (
        <Text style={styles.emptyText}>
          Create a scene to begin the canonical reading spine.
        </Text>
      ) : (
        <ScrollView
          contentContainerStyle={styles.spineList}
          horizontal
          showsHorizontalScrollIndicator
        >
          {workspace.spine.entries.map((entry) => {
            const scene = scenes.get(entry.sceneId);
            const book = bookById.get(entry.bookId);
            const staleLabel = entry.archived
              ? "Archived scene · stale Canvas reference"
              : scene === undefined
                ? "Scene unavailable · stale Canvas reference"
                : undefined;
            return (
              <Pressable
                accessibilityLabel={`Draft ${entry.canonicalIndex + 1}: ${
                  scene?.title ?? "Unavailable scene"
                }, ${
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
                    {scene?.title ?? "Unavailable scene"}
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
  const [showInspector, setShowInspector] = useState(!compact);
  const [activeTool, setActiveTool] = useState<CanvasTool>("select");
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
  const sceneFocus =
    board === undefined || drillScope.kind !== "scene"
      ? undefined
      : canvasSceneFocus(project, board, drillScope.sceneId);
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
    const chooseTool = (event: KeyboardEvent): void => {
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
        return;
      }
      const tool = toolByKey[event.key.toLocaleLowerCase()];
      if (tool === undefined) return;
      event.preventDefault();
      activateTool(tool);
    };
    document.addEventListener("keydown", chooseTool);
    return () => document.removeEventListener("keydown", chooseTool);
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
      const next = interpolateCanvasViewport(from, target, progress);
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
    void onPreferenceChange({
      ...normalized,
      ...(selectedObjectId === undefined
        ? { selectedObjectId: null }
        : { selectedObjectId })
    });
  }

  function activateTool(tool: CanvasTool): void {
    setActiveTool(tool);
    if (tool !== "scene") setShowSceneForm(false);
    switch (tool) {
      case "scene":
        setShowSceneForm(true);
        break;
      case "note":
        createNote();
        break;
      case "story":
        break;
      case "image":
        createImagePlaceholder();
        break;
      case "region":
        createRegion();
        break;
      case "connect":
        setShowInspector(true);
        break;
      case "select":
      case "hand":
        break;
    }
  }

  function jumpToObject(object: CanvasObject): void {
    selectObject(object);
    setView(compact ? "outline" : "spatial");
    changeViewport(
      fitCanvasObjects([withResolvedGeometry(object, scopePlacements, drillScope)], surfaceSize)
    );
  }

  function createNote(): void {
    const position = defaultPosition();
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

  function createRegion(): void {
    const position = defaultPosition();
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

  function createImagePlaceholder(): void {
    const position = defaultPosition();
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

  function createLink(authority: "confirmed" | "provisional"): void {
    if (selectedObject === undefined || linkTargetId === undefined) return;
    void sendCommand({
      type: "canvas.link.create",
      link: {
        kind: linkKind,
        fromObjectId: selectedObject.id,
        toObjectId: linkTargetId,
        authority,
        ...(linkLabel.trim().length === 0
          ? {}
          : { label: linkLabel.trim() }),
        ...(authority === "confirmed"
          ? {}
          : {
              sourceKey: `fixture:${linkKind}:${selectedObject.id}:${linkTargetId}`,
              provenance:
                "Deterministic Ghostwriter link fixture; no model call."
            })
      }
    });
  }

  async function submitSceneHandoff(): Promise<void> {
    const [bookIdValue, chapterIdValue] = scenePlacement.split("::");
    const book = project.books.find((candidate) => candidate.id === bookIdValue);
    const x = parseFinite(sceneX);
    const y = parseFinite(sceneY);
    const width = parseFinite(sceneWidth);
    const height = parseFinite(sceneHeight);
    const storyOrderHint = parseStoryOrderHint(sceneStoryOrderHint);
    if (
      book === undefined ||
      x === undefined ||
      y === undefined ||
      width === undefined ||
      height === undefined ||
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
    const created = await onCreateScene({
      title: sceneTitle.trim(),
      manuscriptPlacement,
      canvas: {
        x,
        y,
        width,
        height,
        z: maxZ + 1,
        storyOrderHint
      }
    });
    if (created) {
      setSceneTitle("");
      setScenePlacement("");
      setSceneStoryOrderHint("");
      setShowSceneForm(false);
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

  const parsedSceneGeometry = [
    parseFinite(sceneX),
    parseFinite(sceneY),
    parseFinite(sceneWidth),
    parseFinite(sceneHeight),
    parseStoryOrderHint(sceneStoryOrderHint)
  ];
  const sceneFormValid =
    sceneTitle.trim().length > 0 &&
    scenePlacement.length > 0 &&
    parsedSceneGeometry.every((value) => value !== undefined) &&
    (parsedSceneGeometry[2] ?? 0) > 0 &&
    (parsedSceneGeometry[3] ?? 0) > 0;

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
      <View style={styles.heading}>
        <View style={styles.headingCopy}>
          <Text style={styles.eyebrow}>Story Canvas</Text>
          <Text style={styles.title}>See the shape of the story</Text>
          <Text style={styles.intro}>
            Scenes, knowledge, notes, imagery, and regions share one board.
            Draft remains the manuscript authority.
          </Text>
        </View>
        <View style={styles.canvasStatus}>
          <Text style={styles.canvasMeta}>
            {board === undefined
              ? "Canvas not loaded"
              : `${projectedObjects.length} scoped objects · ${board.links.length} links · ${workflowLensLabel(
                  workflowLens
                )} lens`}
          </Text>
          <Text
            accessibilityLabel="Canvas save status"
            accessibilityLiveRegion="polite"
            style={[
              styles.saveStatus,
              (saveState === "error" || saveState === "conflict") &&
                styles.saveStatusWarning
            ]}
          >
            {saveStateLabel(saveState, loading)}
          </Text>
        </View>
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

      <View accessibilityLabel="Canvas Workbench" style={styles.workbench}>
        <View accessibilityLabel="Canvas tool dock" style={styles.toolDock}>
          {(
            [
              ["select", "Select", "V"],
              ["hand", "Hand", "H"],
              ["scene", "Scene", "S"],
              ["note", "Note", "N"],
              ["story", "Story record", "K"],
              ["image", "Image reference", "I"],
              ["region", "Region", "R"],
              ["connect", "Connect", "L"]
            ] as const
          ).map(([tool, label, shortcut]) => (
            <CanvasButton
              disabled={busy || (compact && (tool === "hand" || tool === "region"))}
              key={tool}
              label={`${label} (${shortcut})`}
              onPress={() => activateTool(tool)}
              selected={activeTool === tool}
            />
          ))}
        </View>
        <Text accessibilityLiveRegion="polite" style={styles.toolInstruction}>
          {canvasToolInstruction(activeTool)}
        </Text>
        <View accessibilityLabel="Canvas utility bar" style={styles.utilityBar}>
          {!compact ? (
            <>
              <CanvasButton
                label="Spatial"
                onPress={() => setView("spatial")}
                selected={view === "spatial"}
              />
              <CanvasButton
                label="Outline"
                onPress={() => setView("outline")}
                selected={view === "outline"}
              />
            </>
          ) : (
            <Text style={styles.narrowPosture}>
              Ordered review mode · freeform drag stays on wide web
            </Text>
          )}
          <View style={styles.searchBox}>
            <TextInput
              accessibilityLabel="Search or jump on Canvas"
              onChangeText={setSearchQuery}
              placeholder="Search or jump"
              placeholderTextColor={colors.muted}
              style={styles.searchInput}
              value={searchQuery}
            />
            {searchResults.length === 0 ? null : (
              <View accessibilityLabel="Canvas search results" style={styles.searchResults}>
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
          <CanvasButton
            disabled={projectedObjects.length === 0}
            label="Fit board"
            onPress={() =>
              changeViewport(fitCanvasObjects(projectedObjects, surfaceSize))
            }
          />
          <CanvasButton
            disabled={selectedObjectDisplay === undefined}
            label="Fit selection"
            onPress={() => {
              if (selectedObjectDisplay !== undefined) {
                changeViewport(
                  fitCanvasObjects([selectedObjectDisplay], surfaceSize)
                );
              }
            }}
          />
          <CanvasButton
            disabled={busy || board === undefined || board.version <= 1}
            label="Undo Canvas command"
            onPress={() => void onUndo()}
          />
          <CanvasButton
            label={showHistory ? "Hide Canvas history" : "Show Canvas history"}
            onPress={() => {
              const next = !showHistory;
              setShowHistory(next);
              if (next) void onLoadHistory();
            }}
            selected={showHistory}
          />
          <CanvasButton
            label={showInspector ? "Hide Details" : "Show Details"}
            onPress={() => setShowInspector(!showInspector)}
          />
          <CanvasButton
            disabled={busy || hasProvisionalBeat}
            label={
              hasProvisionalBeat
                ? "Review fixture added"
                : "Add provisional review fixture"
            }
            onPress={createProvisionalBeat}
          />
        </View>
      </View>

      {selectedObject === undefined ? null : (
        <View
          accessibilityLabel="Canvas selection actions"
          style={styles.selectionBar}
        >
          <Text numberOfLines={1} style={styles.selectionBarTitle}>
            {selectedObject.label}
          </Text>
          {selectedObject.sceneId === undefined ? null : (
            <CanvasButton
              label="Open Draft"
              onPress={() => {
                if (selectedObject.sceneId !== undefined) {
                  onOpenDraft(selectedObject.sceneId);
                }
              }}
              primary
            />
          )}
          <CanvasButton
            label="Link"
            onPress={() => {
              setActiveTool("connect");
              setShowInspector(true);
            }}
          />
          <CanvasButton
            disabled={busy || selectedObject.archivedAt !== undefined}
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
            disabled={busy || selectedObject.archivedAt !== undefined}
            label="Send backward"
            onPress={() =>
              void sendCommand({
                type: "canvas.object.update",
                objectId: selectedObject.id,
                changes: { z: minZ - 1 }
              })
            }
          />
          <CanvasButton
            label="Details"
            onPress={() => setShowInspector(true)}
          />
        </View>
      )}

      {showHistory ? (
        <View accessibilityLabel="Canvas history" style={styles.historyPanel}>
          <View style={styles.historyHeading}>
            <View style={styles.headingCopy}>
              <Text style={styles.historyEyebrow}>Canvas history</Text>
              <Text style={styles.historyTitle}>Earlier board snapshots</Text>
            </View>
            <Text style={styles.historyRule}>
              Choose an earlier snapshot to preview its metadata. Restoring creates a
              new current Canvas and leaves Draft prose and manuscript order unchanged.
            </Text>
          </View>
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
          {selectedHistoryRevisionId === undefined ? null : (
            <CanvasButton
              disabled={busy || historyLoading}
              label="Restore selected Canvas snapshot"
              onPress={() => setConfirmHistoryRestore(true)}
            />
          )}
          {confirmHistoryRestore ? (
            <View accessibilityRole="alert" style={styles.historyConfirmation}>
              <Text style={styles.historyConfirmationTitle}>
                Restore this Canvas snapshot?
              </Text>
              <Text style={styles.historyConfirmationText}>
                The board will reload from the selected snapshot as a new current
                version. Draft prose and manuscript order will not change.
              </Text>
              <View style={styles.actionRow}>
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
              </View>
            </View>
          ) : null}
        </View>
      ) : null}

      {activeTool === "story" ? (
        <View
          accessibilityLabel="Story knowledge placement"
          style={styles.knowledgePlacement}
        >
        <View style={styles.knowledgePlacementHeading}>
          <View style={styles.headingCopy}>
            <Text style={styles.knowledgePlacementEyebrow}>Canonical story knowledge</Text>
            <Text style={styles.knowledgePlacementTitle}>
              Place an active story record
            </Text>
          </View>
          <Text style={styles.knowledgePlacementRule}>
            Writer placement is confirmed. Archived records are not new targets;
            cards already on the board remain visible as stale references.
          </Text>
        </View>
        {availableKnowledge.length === 0 ? (
          <Text style={styles.emptyText}>
            Every active story record is already placed, or there are no active
            records yet.
          </Text>
        ) : (
          <>
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
            <CanvasButton
              disabled={busy || selectedKnowledgeTarget === undefined}
              label={
                selectedKnowledgeTarget === undefined
                  ? "Choose story knowledge"
                  : `Place ${selectedKnowledgeTarget.label} on Canvas`
              }
              onPress={placeSelectedKnowledge}
              primary
            />
          </>
        )}
        </View>
      ) : null}

      {showSceneForm ? (
        <View accessibilityLabel="Storyboard scene handoff" style={styles.sceneForm}>
          <View style={styles.sceneFormHeading}>
            <View style={styles.headingCopy}>
              <Text style={styles.sceneFormEyebrow}>Storyboard-first handoff</Text>
              <Text style={styles.sceneFormTitle}>
                Create one scene in Canvas and Draft
              </Text>
            </View>
            <Text style={styles.sceneFormRule}>
              One acknowledged transaction; no partial scene card.
            </Text>
          </View>
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
              onPress={placeSelectedScene}
            />
            <CanvasButton
              label="Cancel scene tool"
              onPress={() => {
                setShowSceneForm(false);
                setActiveTool("select");
              }}
            />
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
            This explicit Canvas hint defaults to the new scene’s canonical Draft
            position. Edit it to plan an earlier or later beat without reordering the
            manuscript.
          </Text>
          <View style={styles.geometryRow}>
            <Field
              disabled={busy}
              label="Initial Canvas x"
              numeric
              onChangeText={setSceneX}
              value={sceneX}
            />
            <Field
              disabled={busy}
              label="Initial Canvas y"
              numeric
              onChangeText={setSceneY}
              value={sceneY}
            />
            <Field
              disabled={busy}
              label="Initial Canvas width"
              numeric
              onChangeText={setSceneWidth}
              value={sceneWidth}
            />
            <Field
              disabled={busy}
              label="Initial Canvas height"
              numeric
              onChangeText={setSceneHeight}
              value={sceneHeight}
            />
          </View>
          <CanvasButton
            disabled={busy || !sceneFormValid}
            label={busy ? "Creating scene…" : "Create scene in Canvas and Draft"}
            onPress={() => void submitSceneHandoff()}
            primary
          />
        </View>
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

      {sceneFocus === undefined ? null : (
        <View accessibilityLabel="Canvas Scene Focus Stage" style={styles.focusStage}>
          <View style={styles.headingCopy}>
            <Text style={styles.focusStageEyebrow}>Scene Focus Stage</Text>
            <Text style={styles.focusStageTitle}>{sceneFocus.title}</Text>
            <Text style={styles.focusStageSummary}>
              {sceneFocus.summary ??
                "No scene brief yet. Open Draft to shape the acknowledged prose."}
            </Text>
            <Text style={styles.focusStageMeta}>
              {sceneFocus.placed ? "Placed on Canvas" : "Not placed"} ·{" "}
              {sceneFocus.inboundLinks} inbound · {sceneFocus.outboundLinks} outbound
            </Text>
          </View>
          <View style={styles.actionRow}>
            <CanvasButton
              label="Open Draft"
              onPress={() => onOpenDraft(sceneFocus.sceneId)}
              primary
            />
            {!compact ? (
              <CanvasButton
                label="Open Split"
                onPress={() => onOpenSplit(sceneFocus.sceneId)}
              />
            ) : null}
            <CanvasButton
              label="Open Canvas History"
              onPress={() => {
                setShowHistory(true);
                void onLoadHistory();
              }}
            />
          </View>
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
                <>
                  <View style={styles.viewportControls}>
                    <View style={styles.toolbarGroup}>
                      <CanvasButton
                        label="Zoom out"
                        onPress={() =>
                          changeViewport({
                            ...viewport,
                            zoom: viewport.zoom - 0.15
                          })
                        }
                      />
                      <Text style={styles.zoomLabel}>
                        {Math.round(viewport.zoom * 100)}%
                      </Text>
                      <CanvasButton
                        label="Zoom in"
                        onPress={() =>
                          changeViewport({
                            ...viewport,
                            zoom: viewport.zoom + 0.15
                          })
                        }
                      />
                      <CanvasButton
                        label="Reset view"
                        onPress={() =>
                          changeViewport({ x: 0, y: 0, zoom: 1 })
                        }
                      />
                    </View>
                    <View style={styles.toolbarGroup}>
                      <CanvasButton
                        label="Pan left"
                        onPress={() =>
                          changeViewport({
                            ...viewport,
                            x: viewport.x - 80 / viewport.zoom
                          })
                        }
                      />
                      <CanvasButton
                        label="Pan right"
                        onPress={() =>
                          changeViewport({
                            ...viewport,
                            x: viewport.x + 80 / viewport.zoom
                          })
                        }
                      />
                      <CanvasButton
                        label="Pan up"
                        onPress={() =>
                          changeViewport({
                            ...viewport,
                            y: viewport.y - 80 / viewport.zoom
                          })
                        }
                      />
                      <CanvasButton
                        label="Pan down"
                        onPress={() =>
                          changeViewport({
                            ...viewport,
                            y: viewport.y + 80 / viewport.zoom
                          })
                        }
                      />
                    </View>
                    <Text style={styles.viewportSummary}>
                      {cameraTransitioning
                        ? "Opening this scope…"
                        : `Showing ${visibleObjects.length} of ${projectedObjects.length} scoped objects`}
                    </Text>
                  </View>
                  <View accessibilityLabel="Canvas minimap" style={styles.minimap}>
                    <Text style={styles.minimapLabel}>Board overview</Text>
                    <View style={styles.minimapTrack}>
                      <View
                        style={[
                          styles.minimapViewport,
                          {
                            width: `${Math.max(
                              16,
                              Math.min(
                                100,
                                (visibleObjects.length /
                                  Math.max(1, projectedObjects.length)) *
                                  100
                              )
                            )}%`
                          }
                        ]}
                      />
                    </View>
                    <Text style={styles.minimapMeta}>
                      {projectedObjects.length} scoped objects
                    </Text>
                  </View>
                  <View
                    accessibilityLabel="Spatial Story Canvas"
                    onLayout={updateSurfaceSize}
                    style={styles.surface}
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
                    <View style={[styles.lane, styles.laneOne]}>
                      <Text style={styles.laneLabel}>Beginning</Text>
                    </View>
                    <View style={[styles.lane, styles.laneTwo]}>
                      <Text style={styles.laneLabel}>Middle</Text>
                    </View>
                    <View style={[styles.lane, styles.laneThree]}>
                      <Text style={styles.laneLabel}>Ending</Text>
                    </View>
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
                    {visibleObjects.map((object) => {
                      const canonicalState = canvasCanonicalReferenceState(
                        object,
                        project
                      );
                      return (
                        <SpatialObjectCard
                          detail={objectDetail(object, scenes, project)}
                          dimmed={lensProjection?.dimmedObjectIds.has(object.id)}
                          key={object.id}
                          object={object}
                          onDismiss={dismissObject}
                          onDrillIntoScene={
                            drillScope.kind === "scene"
                              ? undefined
                              : enterSceneFromObject
                          }
                          onMove={moveObject}
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
                          Place the selected Draft scene, capture a note, or storyboard
                          a new scene.
                        </Text>
                      </View>
                    ) : null}
                  </View>
                </>
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
    borderRadius: 12,
    borderWidth: 1,
    minWidth: 0,
    overflow: "hidden",
    width: "100%"
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
  workbench: {
    backgroundColor: colors.topbar,
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    gap: 7,
    padding: 9
  },
  toolDock: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 5
  },
  toolInstruction: {
    color: colors.accent,
    fontFamily: fonts.uiMedium,
    fontSize: 8,
    lineHeight: 13
  },
  utilityBar: {
    alignItems: "center",
    borderTopColor: colors.line,
    borderTopWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 5,
    paddingTop: 7
  },
  searchBox: {
    minWidth: 180,
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
    minHeight: 34,
    paddingHorizontal: 9,
    paddingVertical: 6
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
    flexDirection: "row",
    minWidth: 0
  },
  canvasBodyStacked: {
    flexDirection: "column"
  },
  canvasMain: {
    flex: 1,
    minWidth: 0
  },
  viewportControls: {
    alignItems: "center",
    backgroundColor: colors.wash,
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "space-between",
    padding: 8
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
    height: 580,
    minWidth: 0,
    overflow: "hidden",
    position: "relative",
    width: "100%"
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
    overflow: "hidden",
    position: "absolute",
    shadowColor: "#2c2a27",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 5
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
  spine: {
    backgroundColor: colors.brandDark,
    gap: 9,
    padding: 12
  },
  spineHeading: {
    alignItems: "flex-start",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "space-between"
  },
  spineEyebrow: {
    color: "#d6b8a9",
    fontFamily: fonts.uiSemibold,
    fontSize: 7,
    letterSpacing: 1.2,
    textTransform: "uppercase"
  },
  spineTitle: {
    color: "#ffffff",
    fontFamily: fonts.story,
    fontSize: 19,
    marginTop: 1
  },
  spineRule: {
    color: colors.railText,
    fontFamily: fonts.ui,
    fontSize: 8,
    lineHeight: 12,
    maxWidth: 360
  },
  spineList: {
    gap: 7,
    paddingBottom: 2
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
