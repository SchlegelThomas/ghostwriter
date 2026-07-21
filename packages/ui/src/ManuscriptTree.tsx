import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode
} from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type PressableProps,
  type ViewProps
} from "react-native";
import type { BookId, ChapterId, ProjectNavigator } from "@ghostwriter/core";
import {
  manuscriptSelectionKey,
  type ManuscriptSelection
} from "./manuscript-selection.js";
import { ghostwriterTheme } from "./theme.js";

const { colors, fonts } = ghostwriterTheme;

export type SceneMoveDestination = Readonly<{
  bookId: BookId;
  chapterId?: ChapterId;
  position: number;
}>;

type TreeKeyEvent = Readonly<{
  key: string;
  altKey?: boolean;
  preventDefault(): void;
  stopPropagation(): void;
}>;

type WebTreeItemProps = PressableProps &
  Readonly<{
    role: "treeitem";
    tabIndex: number;
    "aria-label": string;
    "aria-level": number;
    "aria-selected": boolean;
    "aria-expanded"?: boolean;
    "data-tree-key": string;
    onKeyDown(event: TreeKeyEvent): void;
  }>;

type WebTreeProps = ViewProps &
  Readonly<{
    role: "tree";
    "aria-label": string;
  }>;

const TreeItemPressable = Pressable as unknown as ComponentType<WebTreeItemProps>;
const TreeView = View as unknown as ComponentType<WebTreeProps>;

type TreeDragDataTransfer = {
  getData(type: string): string;
  setData(type: string, value: string): void;
  effectAllowed: string;
};

type TreeDragEvent = Readonly<{
  dataTransfer?: TreeDragDataTransfer;
  nativeEvent?: { dataTransfer?: TreeDragDataTransfer };
  preventDefault(): void;
}>;

type TreeDragContainerProps = Readonly<{
  children: ReactNode;
  draggable: boolean;
  onDragStart(event: TreeDragEvent): void;
  onDragOver(event: TreeDragEvent): void;
  onDragEnter(event: TreeDragEvent): void;
  onDragLeave(): void;
  onDrop(event: TreeDragEvent): void;
  onDragEnd(): void;
}>;

const WebTreeDragContainer = "div" as unknown as ComponentType<TreeDragContainerProps>;

function TreeDragContainer(props: TreeDragContainerProps) {
  if (Platform.OS === "web") {
    return <WebTreeDragContainer {...props} />;
  }
  return <View>{props.children}</View>;
}

type TreeNode = Readonly<{
  key: string;
  label: string;
  ariaLabel: string;
  kindLabel: string;
  selection: ManuscriptSelection;
  level: number;
  parentKey?: string;
  children: readonly TreeNode[];
  archived?: boolean;
  detail?: string;
  addLabel?: string;
  renameable?: boolean;
  reorderIndex?: number;
  reorderCount?: number;
}>;

export type ManuscriptTreeAddRequest = Readonly<{
  selectionKey: string;
  requestId: number;
}>;

export type ManuscriptTreeProps = Readonly<{
  project: ProjectNavigator;
  selection: ManuscriptSelection;
  busy?: boolean;
  addRequest?: ManuscriptTreeAddRequest;
  onSelectionChange(selection: ManuscriptSelection): void;
  onOpenScene?(selection: Extract<ManuscriptSelection, { kind: "scene" }>): void;
  onEnterChapter?(
    selection: Extract<ManuscriptSelection, { kind: "chapter" }>
  ): void;
  onAddChild(parent: ManuscriptSelection, title: string): Promise<boolean>;
  onRename(selection: ManuscriptSelection, title: string): Promise<boolean>;
  onReorder(selection: ManuscriptSelection, offset: -1 | 1): Promise<boolean>;
  onMoveScene?(
    selection: Extract<ManuscriptSelection, { kind: "scene" }>,
    destination: SceneMoveDestination
  ): Promise<boolean>;
}>;

function makeNode(
  input: Omit<TreeNode, "ariaLabel"> & { ariaLabel?: string }
): TreeNode {
  return {
    ...input,
    ariaLabel: input.ariaLabel ?? `${input.kindLabel} ${input.label}`
  };
}

function buildTree(
  project: ProjectNavigator,
  showArchived: boolean
): TreeNode {
  const rootSelection: ManuscriptSelection = { kind: "project" };
  const bookNodes = project.books
    .filter((book) => showArchived || book.archivedAt === undefined)
    .map<TreeNode>((book, bookIndex) => {
      const bookSelection: ManuscriptSelection = {
        kind: "book",
        bookId: book.id
      };
      const partNodes = book.parts.map<TreeNode>((part, partIndex) => {
        const partSelection: ManuscriptSelection = {
          kind: "part",
          bookId: book.id,
          partId: part.id
        };
        const chapterNodes = part.chapters.map<TreeNode>(
          (chapter, chapterIndex) => {
            const chapterSelection: ManuscriptSelection = {
              kind: "chapter",
              bookId: book.id,
              partId: part.id,
              chapterId: chapter.id
            };
            const sceneNodes = chapter.scenes
              .filter(
                (scene) => showArchived || scene.archivedAt === undefined
              )
              .map<TreeNode>((scene, sceneIndex) => {
                const selection: ManuscriptSelection = {
                  kind: "scene",
                  bookId: book.id,
                  partId: part.id,
                  chapterId: chapter.id,
                  sceneId: scene.id
                };
                return makeNode({
                  key: manuscriptSelectionKey(selection),
                  label: scene.title,
                  kindLabel: "Scene",
                  selection,
                  level: 5,
                  parentKey: manuscriptSelectionKey(chapterSelection),
                  children: [],
                  archived: scene.archivedAt !== undefined,
                  detail: scene.status,
                  renameable: true,
                  reorderIndex: sceneIndex,
                  reorderCount: chapter.scenes.length
                });
              });
            return makeNode({
              key: manuscriptSelectionKey(chapterSelection),
              label: chapter.title,
              kindLabel: "Chapter",
              selection: chapterSelection,
              level: 4,
              parentKey: manuscriptSelectionKey(partSelection),
              children: sceneNodes,
              detail: [
                `${chapter.scenes.length} ${
                  chapter.scenes.length === 1 ? "scene" : "scenes"
                }`,
                chapter.summary === undefined
                  ? undefined
                  : chapter.summary.slice(0, 48) +
                    (chapter.summary.length > 48 ? "…" : "")
              ]
                .filter((part): part is string => part !== undefined)
                .join(" · "),
              addLabel: "scene",
              renameable: true,
              reorderIndex: chapterIndex,
              reorderCount: part.chapters.length
            });
          }
        );
        return makeNode({
          key: manuscriptSelectionKey(partSelection),
          label: part.title,
          kindLabel: "Part",
          selection: partSelection,
          level: 3,
          parentKey: manuscriptSelectionKey(bookSelection),
          children: chapterNodes,
          detail: `${part.chapters.length} ${
            part.chapters.length === 1 ? "chapter" : "chapters"
          }`,
          addLabel: "chapter",
          renameable: true,
          reorderIndex: partIndex,
          reorderCount: book.parts.length
        });
      });
      const unassignedSelection: ManuscriptSelection = {
        kind: "unassigned",
        bookId: book.id
      };
      const unassignedScenes = book.unassignedScenes
        .filter((scene) => showArchived || scene.archivedAt === undefined)
        .map<TreeNode>((scene, sceneIndex) => {
          const selection: ManuscriptSelection = {
            kind: "scene",
            bookId: book.id,
            sceneId: scene.id
          };
          return makeNode({
            key: manuscriptSelectionKey(selection),
            label: scene.title,
            kindLabel: "Scene",
            selection,
            level: 4,
            parentKey: manuscriptSelectionKey(unassignedSelection),
            children: [],
            archived: scene.archivedAt !== undefined,
            detail: scene.status,
            renameable: true,
            reorderIndex: sceneIndex,
            reorderCount: book.unassignedScenes.length
          });
        });
      const unassignedNode = makeNode({
        key: manuscriptSelectionKey(unassignedSelection),
        label: "Unassigned",
        ariaLabel: `Unassigned scenes in ${book.title}`,
        kindLabel: "Scene folder",
        selection: unassignedSelection,
        level: 3,
        parentKey: manuscriptSelectionKey(bookSelection),
        children: unassignedScenes,
        detail: `${book.unassignedScenes.length} ${
          book.unassignedScenes.length === 1 ? "scene" : "scenes"
        }`,
        addLabel: "scene"
      });
      return makeNode({
        key: manuscriptSelectionKey(bookSelection),
        label: book.title,
        kindLabel: "Book",
        selection: bookSelection,
        level: 2,
        parentKey: manuscriptSelectionKey(rootSelection),
        children: [...partNodes, unassignedNode],
        archived: book.archivedAt !== undefined,
        detail: `${book.sceneCount} scenes · ${book.status}`,
        addLabel: "part",
        renameable: true,
        reorderIndex: bookIndex,
        reorderCount: project.books.length
      });
    });
  const storyRootSelection: ManuscriptSelection = {
    kind: "storyKnowledgeRoot"
  };
  const storyNodes = project.storyKnowledge
    .filter(
      (knowledge) => showArchived || knowledge.archivedAt === undefined
    )
    .map<TreeNode>((knowledge) => {
      const selection: ManuscriptSelection = {
        kind: "storyKnowledge",
        storyKnowledgeId: knowledge.id
      };
      return makeNode({
        key: manuscriptSelectionKey(selection),
        label: knowledge.label,
        kindLabel: "Story knowledge",
        selection,
        level: 3,
        parentKey: manuscriptSelectionKey(storyRootSelection),
        children: [],
        archived: knowledge.archivedAt !== undefined,
        detail: `${knowledge.kind} · ${knowledge.authority}`,
        renameable: true
      });
    });
  const storyRoot = makeNode({
    key: manuscriptSelectionKey(storyRootSelection),
    label: "Story knowledge",
    kindLabel: "Project folder",
    selection: storyRootSelection,
    level: 2,
    parentKey: manuscriptSelectionKey(rootSelection),
    children: storyNodes,
    detail: `${project.storyKnowledge.length} records`,
    addLabel: "story record"
  });
  return makeNode({
    key: manuscriptSelectionKey(rootSelection),
    label: project.title,
    kindLabel: "Project",
    selection: rootSelection,
    level: 1,
    children: [...bookNodes, storyRoot],
    detail: `${project.totals.books} books · ${project.totals.scenes} scenes`,
    addLabel: "book",
    renameable: true
  });
}

function filterNode(node: TreeNode, query: string): TreeNode | undefined {
  if (query.length === 0) return node;
  const children = node.children
    .map((child) => filterNode(child, query))
    .filter((child): child is TreeNode => child !== undefined);
  const matches =
    node.label.toLocaleLowerCase().includes(query) ||
    node.kindLabel.toLocaleLowerCase().includes(query) ||
    node.detail?.toLocaleLowerCase().includes(query) === true;
  if (!matches && children.length === 0) return undefined;
  return { ...node, children: matches ? node.children : children };
}

function flattenTree(
  root: TreeNode,
  expandedKeys: ReadonlySet<string>,
  searchActive: boolean
): TreeNode[] {
  const nodes: TreeNode[] = [];
  function visit(node: TreeNode): void {
    nodes.push(node);
    if (
      node.children.length > 0 &&
      (searchActive || expandedKeys.has(node.key))
    ) {
      node.children.forEach(visit);
    }
  }
  visit(root);
  return nodes;
}

function findNodePath(
  node: TreeNode,
  key: string
): readonly TreeNode[] | undefined {
  if (node.key === key) return [node];
  for (const child of node.children) {
    const path = findNodePath(child, key);
    if (path !== undefined) return [node, ...path];
  }
  return undefined;
}

function initialExpandedKeys(project: ProjectNavigator): Set<string> {
  const keys = new Set<string>(["project", "story-knowledge"]);
  for (const book of project.books) {
    keys.add(`book:${book.id}`);
    keys.add(`unassigned:${book.id}`);
    for (const part of book.parts) {
      keys.add(`part:${book.id}:${part.id}`);
      for (const chapter of part.chapters) {
        keys.add(`chapter:${book.id}:${part.id}:${chapter.id}`);
      }
    }
  }
  return keys;
}

function expandedStorageKey(project: ProjectNavigator): string {
  return `ghostwriter:manuscript-tree:${project.id}:expanded`;
}

function readExpandedKeys(project: ProjectNavigator): Set<string> {
  if (typeof sessionStorage === "undefined") return initialExpandedKeys(project);
  try {
    const stored = JSON.parse(
      sessionStorage.getItem(expandedStorageKey(project)) ?? "null"
    ) as unknown;
    return Array.isArray(stored) && stored.every((value) => typeof value === "string")
      ? new Set(stored)
      : initialExpandedKeys(project);
  } catch {
    return initialExpandedKeys(project);
  }
}

function writeExpandedKeys(
  project: ProjectNavigator,
  expandedKeys: ReadonlySet<string>
): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(
      expandedStorageKey(project),
      JSON.stringify([...expandedKeys])
    );
  } catch {
    // Session-only UI state may fail closed without affecting canonical structure.
  }
}

function Action({
  label,
  disabled = false,
  onPress
}: Readonly<{
  label: string;
  disabled?: boolean;
  onPress(): void;
}>) {
  const glyph = label.startsWith("Add ")
    ? "+"
    : label.startsWith("Rename ")
      ? "✎"
      : label.endsWith(" up")
        ? "↑"
        : label.endsWith(" down")
          ? "↓"
          : label.startsWith("Cancel")
            ? "×"
            : label;
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      disabled={disabled}
      onPress={(event) => {
        event.stopPropagation();
        onPress();
      }}
      style={({ pressed }) => [
        styles.rowAction,
        pressed && styles.pressed,
        disabled && styles.disabled
      ]}
    >
      <Text style={styles.rowActionText}>{glyph}</Text>
    </Pressable>
  );
}

export function ManuscriptTree({
  project,
  selection,
  busy = false,
  addRequest,
  onSelectionChange,
  onOpenScene,
  onEnterChapter,
  onAddChild,
  onRename,
  onReorder,
  onMoveScene
}: ManuscriptTreeProps) {
  const [showArchived, setShowArchived] = useState(false);
  const [query, setQuery] = useState("");
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() =>
    readExpandedKeys(project)
  );
  const [activeKey, setActiveKey] = useState(() =>
    manuscriptSelectionKey(selection)
  );
  const [focusedKey, setFocusedKey] = useState<string>();
  const [renameKey, setRenameKey] = useState<string>();
  const [renameValue, setRenameValue] = useState("");
  const [addParentKey, setAddParentKey] = useState<string>();
  const [addValue, setAddValue] = useState("");
  const [inlineBusy, setInlineBusy] = useState(false);
  const [dropTargetKey, setDropTargetKey] = useState<string>();
  const [draggingKey, setDraggingKey] = useState<string>();
  const renameInFlight = useRef(false);
  const addInFlight = useRef(false);
  const skipExpandedWrite = useRef(false);

  const root = useMemo(
    () => buildTree(project, showArchived),
    [project, showArchived]
  );
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredRoot = useMemo(
    () => filterNode(root, normalizedQuery) ?? root,
    [normalizedQuery, root]
  );
  const visibleNodes = useMemo(
    () =>
      flattenTree(filteredRoot, expandedKeys, normalizedQuery.length > 0),
    [expandedKeys, filteredRoot, normalizedQuery]
  );
  const selectedKey = manuscriptSelectionKey(selection);

  useEffect(() => {
    skipExpandedWrite.current = true;
    setExpandedKeys(readExpandedKeys(project));
    setActiveKey("project");
    setRenameKey(undefined);
    setAddParentKey(undefined);
  }, [project.id]);

  useEffect(() => {
    if (skipExpandedWrite.current) {
      skipExpandedWrite.current = false;
      return;
    }
    writeExpandedKeys(project, expandedKeys);
  }, [expandedKeys, project]);

  useEffect(() => {
    if (visibleNodes.some((node) => node.key === selectedKey)) {
      setActiveKey(selectedKey);
    }
  }, [selectedKey, visibleNodes]);

  useEffect(() => {
    if (!visibleNodes.some((node) => node.key === activeKey)) {
      setActiveKey(visibleNodes[0]?.key ?? "project");
    }
  }, [activeKey, visibleNodes]);

  function focusNode(key: string): void {
    setActiveKey(key);
    if (typeof document === "undefined") return;
    const row = Array.from(
      document.querySelectorAll<HTMLElement>("[data-tree-key]")
    ).find((candidate) => candidate.dataset["treeKey"] === key);
    row?.focus();
  }

  function selectNode(node: TreeNode, open = false): void {
    setActiveKey(node.key);
    onSelectionChange(node.selection);
    if (open && node.selection.kind === "scene") {
      onOpenScene?.(node.selection);
    } else if (open && node.selection.kind === "chapter") {
      onEnterChapter?.(node.selection);
    }
  }

  function toggleExpanded(node: TreeNode): void {
    if (node.children.length === 0) return;
    setExpandedKeys((current) => {
      const next = new Set(current);
      if (next.has(node.key)) next.delete(node.key);
      else next.add(node.key);
      return next;
    });
  }

  function beginRename(node: TreeNode): void {
    if (!node.renameable || busy || inlineBusy) return;
    selectNode(node);
    setRenameKey(node.key);
    setRenameValue(node.label);
    setAddParentKey(undefined);
  }

  async function commitRename(node: TreeNode): Promise<void> {
    if (renameInFlight.current || renameKey !== node.key) return;
    const title = renameValue.trim();
    if (title.length === 0 || title === node.label) {
      setRenameKey(undefined);
      setRenameValue("");
      return;
    }
    renameInFlight.current = true;
    setInlineBusy(true);
    try {
      if (await onRename(node.selection, title)) {
        setRenameKey(undefined);
        setRenameValue("");
      }
    } finally {
      renameInFlight.current = false;
      setInlineBusy(false);
    }
  }

  function beginAdd(node: TreeNode): void {
    if (node.addLabel === undefined || busy || inlineBusy) return;
    selectNode(node);
    setExpandedKeys((current) => new Set(current).add(node.key));
    setAddParentKey(node.key);
    setAddValue("");
    setRenameKey(undefined);
  }

  const handledAddRequestId = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (
      addRequest === undefined ||
      addRequest.requestId === handledAddRequestId.current
    ) {
      return;
    }
    handledAddRequestId.current = addRequest.requestId;
    const path = findNodePath(root, addRequest.selectionKey);
    const node = path?.[path.length - 1];
    if (path === undefined || node?.addLabel === undefined) return;
    setExpandedKeys((current) => {
      const next = new Set(current);
      for (const ancestor of path) next.add(ancestor.key);
      return next;
    });
    beginAdd(node);
  }, [addRequest, root]);

  async function commitAdd(node: TreeNode): Promise<void> {
    if (addInFlight.current || addParentKey !== node.key) return;
    const title = addValue.trim();
    if (title.length === 0) return;
    addInFlight.current = true;
    setInlineBusy(true);
    try {
      if (await onAddChild(node.selection, title)) {
        setAddParentKey(undefined);
        setAddValue("");
      }
    } finally {
      addInFlight.current = false;
      setInlineBusy(false);
    }
  }

  function handleTreeKey(node: TreeNode, event: TreeKeyEvent): void {
    const index = visibleNodes.findIndex((candidate) => candidate.key === node.key);
    if (event.altKey === true && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      event.stopPropagation();
      if (!busy && !inlineBusy && node.reorderIndex !== undefined) {
        void onReorder(node.selection, event.key === "ArrowUp" ? -1 : 1);
      }
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusNode(visibleNodes[Math.min(visibleNodes.length - 1, index + 1)]?.key ?? node.key);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      focusNode(visibleNodes[Math.max(0, index - 1)]?.key ?? node.key);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      focusNode(visibleNodes[0]?.key ?? node.key);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      focusNode(visibleNodes[visibleNodes.length - 1]?.key ?? node.key);
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      if (node.children.length > 0 && !expandedKeys.has(node.key)) {
        toggleExpanded(node);
      } else if (node.children[0] !== undefined) {
        focusNode(node.children[0].key);
      }
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (node.children.length > 0 && expandedKeys.has(node.key)) {
        toggleExpanded(node);
      } else if (node.parentKey !== undefined) {
        focusNode(node.parentKey);
      }
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectNode(node, true);
      return;
    }
    if (event.key === "F2") {
      event.preventDefault();
      beginRename(node);
    }
  }

  function destinationForDrop(
    target: TreeNode
  ): SceneMoveDestination | undefined {
    const selection = target.selection;
    if (selection.kind === "chapter") {
      const chapter = project.books
        .find((book) => book.id === selection.bookId)
        ?.parts.find((part) => part.id === selection.partId)
        ?.chapters.find((chapter) => chapter.id === selection.chapterId);
      if (chapter === undefined) return undefined;
      return {
        bookId: selection.bookId,
        chapterId: selection.chapterId,
        position: chapter.scenes.length
      };
    }
    if (selection.kind === "unassigned") {
      const book = project.books.find(
        (candidate) => candidate.id === selection.bookId
      );
      if (book === undefined) return undefined;
      return {
        bookId: selection.bookId,
        position: book.unassignedScenes.length
      };
    }
    if (selection.kind === "scene") {
      return {
        bookId: selection.bookId,
        ...(selection.chapterId === undefined
          ? {}
          : { chapterId: selection.chapterId }),
        position: target.reorderIndex ?? 0
      };
    }
    return undefined;
  }

  function canAcceptSceneDrop(node: TreeNode): boolean {
    return (
      onMoveScene !== undefined &&
      (node.selection.kind === "chapter" ||
        node.selection.kind === "unassigned" ||
        node.selection.kind === "scene")
    );
  }

  async function handleDrop(
    target: TreeNode,
    rawPayload: string
  ): Promise<void> {
    if (onMoveScene === undefined || busy || inlineBusy) return;
    let payload: ManuscriptSelection;
    try {
      payload = JSON.parse(rawPayload) as ManuscriptSelection;
    } catch {
      return;
    }
    if (payload.kind !== "scene") return;
    if (manuscriptSelectionKey(payload) === target.key) return;
    const destination = destinationForDrop(target);
    if (destination === undefined) return;
    setDropTargetKey(undefined);
    setDraggingKey(undefined);
    await onMoveScene(payload, destination);
  }

  return (
    <View accessibilityLabel="Persistent manuscript tree" style={styles.panel}>
      <View style={styles.heading}>
        <View style={styles.headingCopy}>
          <Text style={styles.eyebrow}>Manuscript</Text>
          <Text numberOfLines={2} style={styles.title}>
            Story structure
          </Text>
        </View>
        <Text style={styles.version}>v{project.version}</Text>
      </View>
      <TextInput
        accessibilityLabel="Search manuscript tree"
        editable={!busy}
        onChangeText={setQuery}
        placeholder="Find a scene, chapter, or story record"
        placeholderTextColor={colors.muted}
        style={styles.search}
        value={query}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected: showArchived }}
        disabled={busy}
        onPress={() => setShowArchived((current) => !current)}
        style={({ pressed }) => [
          styles.archiveToggle,
          showArchived && styles.archiveToggleSelected,
          pressed && styles.pressed
        ]}
      >
        <Text style={styles.archiveToggleText}>
          {showArchived ? "Hide archived records" : "Show archived records"}
        </Text>
      </Pressable>
      <ScrollView
        contentContainerStyle={styles.treeContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator
        style={styles.treeScroll}
      >
        <TreeView aria-label="Project manuscript" role="tree">
          {visibleNodes.map((node) => {
            const expanded =
              node.children.length === 0
                ? undefined
                : normalizedQuery.length > 0 || expandedKeys.has(node.key);
            const selected = node.key === selectedKey;
            const focused = node.key === focusedKey;
            const dropHighlight = dropTargetKey === node.key;
            const dragging = draggingKey === node.key;
            const canMoveUp =
              node.reorderIndex !== undefined && node.reorderIndex > 0;
            const canMoveDown =
              node.reorderIndex !== undefined &&
              node.reorderCount !== undefined &&
              node.reorderIndex < node.reorderCount - 1;
            const sceneDraggable =
              node.selection.kind === "scene" && onMoveScene !== undefined;
            return (
              <TreeDragContainer
                draggable={sceneDraggable}
                key={node.key}
                onDragEnd={() => {
                  setDraggingKey(undefined);
                  setDropTargetKey(undefined);
                }}
                onDragEnter={(event) => {
                  if (!canAcceptSceneDrop(node)) return;
                  event.preventDefault();
                  setDropTargetKey(node.key);
                }}
                onDragLeave={() => {
                  setDropTargetKey((current) =>
                    current === node.key ? undefined : current
                  );
                }}
                onDragOver={(event) => {
                  if (!canAcceptSceneDrop(node)) return;
                  event.preventDefault();
                }}
                onDragStart={(event) => {
                  if (node.selection.kind !== "scene") return;
                  const dataTransfer =
                    event.dataTransfer ?? event.nativeEvent?.dataTransfer;
                  setDraggingKey(node.key);
                  dataTransfer?.setData(
                    "application/x-ghostwriter-scene",
                    JSON.stringify(node.selection)
                  );
                  dataTransfer?.setData(
                    "text/plain",
                    manuscriptSelectionKey(node.selection)
                  );
                  if (dataTransfer !== undefined) {
                    dataTransfer.effectAllowed = "move";
                  }
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const dataTransfer =
                    event.dataTransfer ?? event.nativeEvent?.dataTransfer;
                  const payload =
                    dataTransfer?.getData("application/x-ghostwriter-scene") ??
                    dataTransfer?.getData("text/plain") ??
                    "";
                  void handleDrop(node, payload);
                }}
              >
                <TreeItemPressable
                  aria-label={node.ariaLabel}
                  aria-expanded={expanded}
                  aria-level={node.level}
                  aria-selected={selected}
                  data-tree-key={node.key}
                  disabled={busy || inlineBusy}
                  onBlur={() => setFocusedKey(undefined)}
                  onFocus={() => {
                    setActiveKey(node.key);
                    setFocusedKey(node.key);
                  }}
                  onKeyDown={(event) => handleTreeKey(node, event)}
                  onPress={() => selectNode(node)}
                  role="treeitem"
                  style={({ pressed }) => [
                    styles.row,
                    selected && styles.rowSelected,
                    focused && styles.rowFocused,
                    dropHighlight && styles.rowDropTarget,
                    dragging && styles.rowDragging,
                    node.archived === true && styles.rowArchived,
                    pressed && styles.pressed
                  ]}
                  tabIndex={node.key === activeKey ? 0 : -1}
                >
                  <View
                    style={[
                      styles.rowInner,
                      { paddingLeft: Math.max(0, node.level - 1) * 13 }
                    ]}
                  >
                    <Pressable
                      accessibilityLabel={
                        node.children.length === 0
                          ? `${node.kindLabel} leaf`
                          : `${expanded === true ? "Collapse" : "Expand"} ${node.label}`
                      }
                      accessibilityRole="button"
                      disabled={node.children.length === 0}
                      onPress={(event) => {
                        event.stopPropagation();
                        toggleExpanded(node);
                      }}
                      style={styles.chevron}
                    >
                      <Text style={styles.chevronText}>
                        {node.children.length === 0
                          ? "·"
                          : expanded === true
                            ? "⌄"
                            : "›"}
                      </Text>
                    </Pressable>
                    <View style={styles.rowCopy}>
                      <View style={styles.rowTitleLine}>
                        <Text
                          numberOfLines={1}
                          style={[
                            styles.rowTitle,
                            selected && styles.rowTitleSelected
                          ]}
                        >
                          {node.label}
                        </Text>
                        {node.archived === true ? (
                          <Text style={styles.archivedBadge}>Archived</Text>
                        ) : null}
                      </View>
                      <Text numberOfLines={1} style={styles.rowMeta}>
                        {node.kindLabel}
                        {node.detail === undefined ? "" : ` · ${node.detail}`}
                      </Text>
                    </View>
                    {selected ? (
                      <View style={styles.rowActions}>
                        {node.addLabel === undefined ? null : (
                          <Action
                            disabled={busy || inlineBusy}
                            label={`Add ${node.addLabel} to ${node.label}`}
                            onPress={() => beginAdd(node)}
                          />
                        )}
                        {node.renameable === true ? (
                          <Action
                            disabled={busy || inlineBusy}
                            label={`Rename ${node.kindLabel} ${node.label}`}
                            onPress={() => beginRename(node)}
                          />
                        ) : null}
                        {node.reorderIndex === undefined ? null : (
                          <>
                            <Action
                              disabled={busy || inlineBusy || !canMoveUp}
                              label={`Move ${node.kindLabel} up`}
                              onPress={() => void onReorder(node.selection, -1)}
                            />
                            <Action
                              disabled={busy || inlineBusy || !canMoveDown}
                              label={`Move ${node.kindLabel} down`}
                              onPress={() => void onReorder(node.selection, 1)}
                            />
                          </>
                        )}
                      </View>
                    ) : null}
                  </View>
                </TreeItemPressable>
                {renameKey === node.key ? (
                  <View
                    style={[
                      styles.inlineEditor,
                      { marginLeft: Math.max(0, node.level - 1) * 13 + 24 }
                    ]}
                  >
                    <TextInput
                      accessibilityLabel={`Rename ${node.kindLabel} ${node.label}`}
                      autoFocus
                      editable={!busy && !inlineBusy}
                      onBlur={() => void commitRename(node)}
                      onChangeText={setRenameValue}
                      onSubmitEditing={() => void commitRename(node)}
                      selectTextOnFocus
                      style={styles.inlineInput}
                      value={renameValue}
                    />
                    <Action
                      label="Cancel rename"
                      onPress={() => {
                        setRenameKey(undefined);
                        setRenameValue("");
                      }}
                    />
                  </View>
                ) : null}
                {addParentKey === node.key ? (
                  <View
                    style={[
                      styles.inlineEditor,
                      { marginLeft: Math.max(0, node.level - 1) * 13 + 24 }
                    ]}
                  >
                    <TextInput
                      accessibilityLabel={`New ${node.addLabel ?? "item"} in ${node.label}`}
                      autoFocus
                      editable={!busy && !inlineBusy}
                      onChangeText={setAddValue}
                      onSubmitEditing={() => void commitAdd(node)}
                      placeholder={`New ${node.addLabel ?? "item"} title`}
                      placeholderTextColor={colors.muted}
                      style={styles.inlineInput}
                      value={addValue}
                    />
                    <Action
                      disabled={addValue.trim().length === 0}
                      label={`Add ${node.addLabel ?? "item"}`}
                      onPress={() => void commitAdd(node)}
                    />
                    <Action
                      label="Cancel add"
                      onPress={() => {
                        setAddParentKey(undefined);
                        setAddValue("");
                      }}
                    />
                  </View>
                ) : null}
              </TreeDragContainer>
            );
          })}
        </TreeView>
        {normalizedQuery.length > 0 && visibleNodes.length <= 1 ? (
          <Text style={styles.empty}>
            No manuscript or story record matches “{query.trim()}”.
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: "#f8f5ef",
    flex: 1,
    minHeight: 0,
    minWidth: 0,
    paddingHorizontal: 10,
    paddingTop: 12
  },
  heading: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between"
  },
  headingCopy: {
    flex: 1,
    minWidth: 0
  },
  eyebrow: {
    color: colors.kicker,
    fontFamily: fonts.uiSemibold,
    fontSize: 8,
    letterSpacing: 1.4,
    textTransform: "uppercase"
  },
  title: {
    color: colors.ink,
    fontFamily: fonts.story,
    fontSize: 21,
    marginTop: 2
  },
  version: {
    color: colors.muted,
    fontFamily: fonts.uiMedium,
    fontSize: 8
  },
  search: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 7,
    borderWidth: 1,
    color: colors.ink,
    fontFamily: fonts.ui,
    fontSize: 9,
    marginTop: 10,
    minHeight: 36,
    paddingHorizontal: 9,
    paddingVertical: 7,
    width: "100%"
  },
  archiveToggle: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 999,
    borderWidth: 1,
    marginTop: 7,
    paddingHorizontal: 8,
    paddingVertical: 5
  },
  archiveToggleSelected: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent
  },
  archiveToggleText: {
    color: colors.muted,
    fontFamily: fonts.uiSemibold,
    fontSize: 7
  },
  treeScroll: {
    flex: 1,
    marginTop: 7,
    minHeight: 0
  },
  treeContent: {
    paddingBottom: 30
  },
  row: {
    borderColor: "transparent",
    borderRadius: 7,
    borderWidth: 2,
    marginVertical: 1,
    minWidth: 0
  },
  rowSelected: {
    backgroundColor: colors.accentSoft,
    borderColor: "#d4b7aa"
  },
  rowFocused: {
    borderColor: colors.accent
  },
  rowDropTarget: {
    backgroundColor: colors.blueSoft,
    borderColor: colors.blue
  },
  rowDragging: {
    opacity: 0.45
  },
  rowArchived: {
    opacity: 0.72
  },
  rowInner: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
    minHeight: 42,
    minWidth: 0,
    paddingRight: 4,
    paddingVertical: 4
  },
  chevron: {
    alignItems: "center",
    height: 24,
    justifyContent: "center",
    width: 20
  },
  chevronText: {
    color: colors.muted,
    fontFamily: fonts.uiSemibold,
    fontSize: 14
  },
  rowCopy: {
    flex: 1,
    minWidth: 0
  },
  rowTitleLine: {
    alignItems: "center",
    flexDirection: "row",
    gap: 5,
    minWidth: 0
  },
  rowTitle: {
    color: colors.ink,
    flexShrink: 1,
    fontFamily: fonts.uiMedium,
    fontSize: 9
  },
  rowTitleSelected: {
    color: colors.kicker,
    fontFamily: fonts.uiSemibold
  },
  rowMeta: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 7,
    marginTop: 2
  },
  archivedBadge: {
    backgroundColor: colors.redSoft,
    borderRadius: 999,
    color: colors.red,
    fontFamily: fonts.uiSemibold,
    fontSize: 6,
    paddingHorizontal: 5,
    paddingVertical: 2,
    textTransform: "uppercase"
  },
  rowActions: {
    alignItems: "center",
    flexDirection: "row",
    gap: 3
  },
  rowAction: {
    alignItems: "center",
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 5,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 25,
    minWidth: 25,
    paddingHorizontal: 5
  },
  rowActionText: {
    color: colors.ink,
    fontFamily: fonts.uiSemibold,
    fontSize: 7
  },
  inlineEditor: {
    alignItems: "center",
    flexDirection: "row",
    gap: 5,
    marginBottom: 5,
    marginRight: 5,
    minWidth: 0
  },
  inlineInput: {
    backgroundColor: colors.panel,
    borderColor: colors.accent,
    borderRadius: 6,
    borderWidth: 1,
    color: colors.ink,
    flex: 1,
    fontFamily: fonts.ui,
    fontSize: 9,
    minHeight: 34,
    minWidth: 0,
    paddingHorizontal: 8,
    paddingVertical: 6
  },
  pressed: {
    opacity: 0.72
  },
  disabled: {
    opacity: 0.4
  },
  empty: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 8,
    lineHeight: 13,
    padding: 12
  }
});
