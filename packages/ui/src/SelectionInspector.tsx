import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import type {
  BookStatus,
  ProjectCommand,
  ProjectNavigator,
  ProjectNavigatorBook,
  ProjectNavigatorChapter,
  ProjectNavigatorScene,
  SceneId,
  SceneStatus,
  StoryKnowledgeAuthority,
  StoryKnowledgeKind
} from "@ghostwriter/core";
import {
  resolveManuscriptSelection,
  type ManuscriptSelection
} from "./manuscript-selection.js";
import { ghostwriterTheme } from "./theme.js";

const { colors, fonts } = ghostwriterTheme;
const BOOK_STATUSES: readonly BookStatus[] = [
  "planned",
  "drafting",
  "revising",
  "complete"
];
const SCENE_STATUSES: readonly SceneStatus[] = [
  "planned",
  "drafting",
  "revising",
  "complete"
];
const KNOWLEDGE_KINDS: readonly StoryKnowledgeKind[] = [
  "character",
  "location",
  "world-rule",
  "thread",
  "custom"
];
const KNOWLEDGE_AUTHORITIES: readonly StoryKnowledgeAuthority[] = [
  "planned",
  "confirmed",
  "inferred",
  "disputed"
];

type Confirmation = Readonly<{
  title: string;
  detail: string;
  confirmLabel: string;
  command: ProjectCommand;
}>;

export type SelectionInspectorProps = Readonly<{
  project: ProjectNavigator;
  selection: ManuscriptSelection;
  selectedSceneId?: SceneId;
  busy?: boolean;
  onClose?(): void;
  onCommand(command: ProjectCommand): Promise<boolean>;
  onReorder(selection: ManuscriptSelection, offset: -1 | 1): Promise<boolean>;
}>;

type ScenePlacement = Readonly<{
  book: ProjectNavigatorBook;
  chapter?: ProjectNavigatorChapter;
  position: number;
  count: number;
}>;

function titleCase(value: string): string {
  return value
    .split("-")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function allScenes(project: ProjectNavigator): ProjectNavigatorScene[] {
  return project.books.flatMap((book) => [
    ...book.parts.flatMap((part) =>
      part.chapters.flatMap((chapter) => chapter.scenes)
    ),
    ...book.unassignedScenes
  ]);
}

function placementForScene(
  project: ProjectNavigator,
  sceneId: SceneId
): ScenePlacement | undefined {
  for (const book of project.books) {
    for (const part of book.parts) {
      for (const chapter of part.chapters) {
        const position = chapter.scenes.findIndex(
          (scene) => scene.id === sceneId
        );
        if (position >= 0) {
          return {
            book,
            chapter,
            position,
            count: chapter.scenes.length
          };
        }
      }
    }
    const position = book.unassignedScenes.findIndex(
      (scene) => scene.id === sceneId
    );
    if (position >= 0) {
      return { book, position, count: book.unassignedScenes.length };
    }
  }
  return undefined;
}

function Button({
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

function CommitField({
  label,
  value,
  onCommit,
  disabled = false,
  multiline = false,
  emptyAsNull = false
}: Readonly<{
  label: string;
  value: string;
  onCommit(value: string | null): Promise<boolean>;
  disabled?: boolean;
  multiline?: boolean;
  emptyAsNull?: boolean;
}>) {
  const [draft, setDraft] = useState(value);
  const [pending, setPending] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const lastServerValue = useRef(value);
  const commitInFlight = useRef(false);

  useEffect(() => {
    if (value !== lastServerValue.current) {
      lastServerValue.current = value;
      setDraft(value);
      setInvalid(false);
    }
  }, [value]);

  const normalized = draft.trim();
  const dirty = normalized !== value.trim();

  async function commit(): Promise<void> {
    if (commitInFlight.current || !dirty) return;
    if (!emptyAsNull && normalized.length === 0) {
      setInvalid(true);
      return;
    }
    commitInFlight.current = true;
    setPending(true);
    setInvalid(false);
    try {
      if (await onCommit(normalized.length === 0 ? null : normalized)) {
        lastServerValue.current = normalized;
        setDraft(normalized);
      }
    } finally {
      commitInFlight.current = false;
      setPending(false);
    }
  }

  return (
    <View style={styles.field}>
      <View style={styles.fieldHeading}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <Text
          accessibilityLiveRegion="polite"
          style={
            pending
              ? styles.fieldSaving
              : dirty
                ? styles.fieldDirty
                : styles.fieldSaved
          }
        >
          {pending ? "Saving…" : dirty ? "Not saved" : "Acknowledged"}
        </Text>
      </View>
      <TextInput
        accessibilityLabel={label}
        editable={!disabled && !pending}
        multiline={multiline}
        onBlur={() => void commit()}
        onChangeText={(next) => {
          setDraft(next);
          setInvalid(false);
        }}
        onSubmitEditing={() => void commit()}
        style={[
          styles.input,
          multiline && styles.inputMultiline,
          dirty && styles.inputDirty,
          invalid && styles.inputInvalid
        ]}
        value={draft}
      />
      {invalid ? (
        <Text accessibilityRole="alert" style={styles.validation}>
          {label} cannot be empty.
        </Text>
      ) : null}
    </View>
  );
}

function ChoiceGroup<Value extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false
}: Readonly<{
  label: string;
  value: Value | undefined;
  options: readonly Value[];
  onChange(value: Value): Promise<boolean>;
  disabled?: boolean;
}>) {
  const [pending, setPending] = useState<Value>();
  return (
    <View style={styles.field}>
      <View style={styles.fieldHeading}>
        <Text style={styles.fieldLabel}>{label}</Text>
        {pending === undefined ? null : (
          <Text accessibilityLiveRegion="polite" style={styles.fieldSaving}>
            Saving…
          </Text>
        )}
      </View>
      <View style={styles.actionRow}>
        {options.map((option) => (
          <Button
            disabled={disabled || pending !== undefined}
            key={option}
            label={titleCase(option)}
            onPress={() => {
              setPending(option);
              void onChange(option).finally(() => setPending(undefined));
            }}
            selected={value === option}
          />
        ))}
      </View>
    </View>
  );
}

function Section({
  title,
  children
}: Readonly<{ title: string; children: ReactNode }>) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function selectionHeading(
  project: ProjectNavigator,
  selection: ManuscriptSelection
): Readonly<{ eyebrow: string; title: string }> {
  const resolved = resolveManuscriptSelection(project, selection);
  switch (selection.kind) {
    case "project":
      return { eyebrow: "Selected · project", title: project.title };
    case "book":
      return {
        eyebrow: "Selected · book",
        title: resolved?.book?.title ?? "Unavailable book"
      };
    case "part":
      return {
        eyebrow: "Selected · part",
        title: resolved?.part?.title ?? "Unavailable part"
      };
    case "chapter":
      return {
        eyebrow: "Selected · chapter",
        title: resolved?.chapter?.title ?? "Unavailable chapter"
      };
    case "scene":
      return {
        eyebrow: "Selected · scene",
        title: resolved?.scene?.title ?? "Unavailable scene"
      };
    case "unassigned":
      return { eyebrow: "Selected · folder", title: "Unassigned scenes" };
    case "storyKnowledgeRoot":
      return { eyebrow: "Selected · project", title: "Story knowledge" };
    case "storyKnowledge":
      return {
        eyebrow: "Selected · story knowledge",
        title: resolved?.knowledge?.label ?? "Unavailable story record"
      };
  }
}

export function SelectionInspector({
  project,
  selection,
  selectedSceneId,
  busy = false,
  onClose,
  onCommand,
  onReorder
}: SelectionInspectorProps) {
  const resolved = resolveManuscriptSelection(project, selection);
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const [moveQuery, setMoveQuery] = useState("");
  const heading = selectionHeading(project, selection);
  const scenes = useMemo(() => allScenes(project), [project]);
  const selectedWorkspaceScene = scenes.find(
    (scene) => scene.id === selectedSceneId
  );

  useEffect(() => {
    setConfirmation(undefined);
    setMoveQuery("");
  }, [selection]);

  async function run(command: ProjectCommand): Promise<boolean> {
    if (busy) return false;
    return onCommand(command);
  }

  function archiveButton(
    archived: boolean,
    labels: Readonly<{ archive: string; restore: string }>,
    commandFor: (next: boolean) => ProjectCommand,
    confirmationCopy: Readonly<{ title: string; detail: string }>,
    disabled = false
  ): ReactNode {
    return (
      <Button
        danger={!archived}
        disabled={busy || disabled}
        label={archived ? labels.restore : labels.archive}
        onPress={() => {
          if (archived) {
            void run(commandFor(false));
          } else {
            setConfirmation({
              ...confirmationCopy,
              confirmLabel: `Confirm ${labels.archive.toLocaleLowerCase()}`,
              command: commandFor(true)
            });
          }
        }}
      />
    );
  }

  let content: ReactNode;
  if (resolved === undefined) {
    content = (
      <Section title="Selection unavailable">
        <Text style={styles.help}>
          This record is absent from the latest acknowledged project. Choose
          another item from the tree.
        </Text>
      </Section>
    );
  } else if (selection.kind === "project") {
    content = (
      <>
        <Section title="Project identity">
          <CommitField
            disabled={busy}
            label="Project title"
            onCommit={(title) =>
              title === null
                ? Promise.resolve(false)
                : run({ type: "project.rename", title })
            }
            value={project.title}
          />
          <Text style={styles.help}>
            {project.totals.books} books · {project.totals.scenes} scenes ·{" "}
            {project.totals.storyKnowledge} story records
          </Text>
        </Section>
        <Section title="Lifecycle">
          {archiveButton(
            project.archivedAt !== undefined,
            { archive: "Archive project", restore: "Restore project" },
            (archived) => ({ type: "project.setArchived", archived }),
            {
              title: `Archive ${project.title}?`,
              detail:
                "It leaves the active library, but every book, Draft revision, and Canvas snapshot remains recoverable."
            }
          )}
        </Section>
      </>
    );
  } else if (selection.kind === "book" && resolved.book !== undefined) {
    const book = resolved.book;
    const lastActive =
      book.archivedAt === undefined &&
      project.books.filter((candidate) => candidate.archivedAt === undefined)
        .length <= 1;
    content = (
      <>
        <Section title="Book details">
          <CommitField
            disabled={busy}
            label="Book title"
            onCommit={(title) =>
              title === null
                ? Promise.resolve(false)
                : run({
                    type: "book.update",
                    bookId: book.id,
                    title
                  })
            }
            value={book.title}
          />
          <ChoiceGroup
            disabled={busy}
            label="Book status"
            onChange={(status) =>
              run({ type: "book.update", bookId: book.id, status })
            }
            options={BOOK_STATUSES}
            value={book.status}
          />
          <Text style={styles.help}>
            {book.sceneCount} scenes · {book.parts.length} parts
          </Text>
        </Section>
        <Section title="Series order and lifecycle">
          <View style={styles.actionRow}>
            <Button
              disabled={
                busy ||
                project.books.findIndex(
                  (candidate) => candidate.id === book.id
                ) <= 0
              }
              label="Move book up"
              onPress={() => void onReorder(selection, -1)}
            />
            <Button
              disabled={
                busy ||
                project.books.findIndex(
                  (candidate) => candidate.id === book.id
                ) >=
                  project.books.length - 1
              }
              label="Move book down"
              onPress={() => void onReorder(selection, 1)}
            />
            {archiveButton(
              book.archivedAt !== undefined,
              { archive: "Archive book", restore: "Restore book" },
              (archived) => ({
                type: "book.setArchived",
                bookId: book.id,
                archived
              }),
              {
                title: `Archive ${book.title}?`,
                detail:
                  "Its manuscript and history remain recoverable. Ghostwriter always keeps at least one active book."
              },
              lastActive
            )}
          </View>
          {lastActive ? (
            <Text style={styles.refusal}>
              Create or restore another active book before archiving this one.
            </Text>
          ) : null}
        </Section>
      </>
    );
  } else if (
    selection.kind === "part" &&
    resolved.book !== undefined &&
    resolved.part !== undefined
  ) {
    const { book, part } = resolved;
    const partIndex = book.parts.findIndex(
      (candidate) => candidate.id === part.id
    );
    content = (
      <>
        <Section title="Part details">
          <CommitField
            disabled={busy}
            label="Part title"
            onCommit={(title) =>
              title === null
                ? Promise.resolve(false)
                : run({
                    type: "part.rename",
                    bookId: book.id,
                    partId: part.id,
                    title
                  })
            }
            value={part.title}
          />
          <Text style={styles.help}>
            {part.chapters.length}{" "}
            {part.chapters.length === 1 ? "chapter" : "chapters"}
          </Text>
        </Section>
        <Section title="Order and safe removal">
          <View style={styles.actionRow}>
            <Button
              disabled={busy || partIndex <= 0}
              label="Move part up"
              onPress={() => void onReorder(selection, -1)}
            />
            <Button
              disabled={busy || partIndex >= book.parts.length - 1}
              label="Move part down"
              onPress={() => void onReorder(selection, 1)}
            />
            <Button
              danger
              disabled={busy || part.chapters.length > 0}
              label="Remove empty part"
              onPress={() =>
                setConfirmation({
                  title: `Remove ${part.title}?`,
                  detail:
                    "Only this empty structural container is removed. No scenes, prose, or Canvas records are deleted.",
                  confirmLabel: "Confirm remove part",
                  command: {
                    type: "part.removeEmpty",
                    bookId: book.id,
                    partId: part.id
                  }
                })
              }
            />
          </View>
          {part.chapters.length > 0 ? (
            <Text style={styles.refusal}>
              Move or remove every chapter before removing this part.
            </Text>
          ) : null}
        </Section>
      </>
    );
  } else if (
    selection.kind === "chapter" &&
    resolved.book !== undefined &&
    resolved.part !== undefined &&
    resolved.chapter !== undefined
  ) {
    const { book, part, chapter } = resolved;
    const chapterIndex = part.chapters.findIndex(
      (candidate) => candidate.id === chapter.id
    );
    content = (
      <>
        <Section title="Chapter details">
          <CommitField
            disabled={busy}
            label="Chapter title"
            onCommit={(title) =>
              title === null
                ? Promise.resolve(false)
                : run({
                    type: "chapter.rename",
                    bookId: book.id,
                    partId: part.id,
                    chapterId: chapter.id,
                    title
                  })
            }
            value={chapter.title}
          />
          <Text style={styles.help}>
            {chapter.scenes.length}{" "}
            {chapter.scenes.length === 1 ? "scene" : "scenes"}
          </Text>
        </Section>
        <Section title="Order and safe removal">
          <View style={styles.actionRow}>
            <Button
              disabled={busy || chapterIndex <= 0}
              label="Move chapter up"
              onPress={() => void onReorder(selection, -1)}
            />
            <Button
              disabled={
                busy || chapterIndex >= part.chapters.length - 1
              }
              label="Move chapter down"
              onPress={() => void onReorder(selection, 1)}
            />
            <Button
              danger
              disabled={busy || chapter.scenes.length > 0}
              label="Remove empty chapter"
              onPress={() =>
                setConfirmation({
                  title: `Remove ${chapter.title}?`,
                  detail:
                    "Only this empty structural container is removed. Active and archived scenes must be moved first.",
                  confirmLabel: "Confirm remove chapter",
                  command: {
                    type: "chapter.removeEmpty",
                    bookId: book.id,
                    partId: part.id,
                    chapterId: chapter.id
                  }
                })
              }
            />
          </View>
          {chapter.scenes.length > 0 ? (
            <Text style={styles.refusal}>
              Move every active or archived scene before removing this chapter.
            </Text>
          ) : null}
        </Section>
      </>
    );
  } else if (selection.kind === "scene" && resolved.scene !== undefined) {
    const scene = resolved.scene;
    const placement = placementForScene(project, scene.id);
    const destinations = project.books
      .filter((book) => book.archivedAt === undefined)
      .flatMap((book) => [
        {
          key: `${book.id}:unassigned`,
          label: `${book.title} · Unassigned`,
          book,
          chapter: undefined
        },
        ...book.parts.flatMap((part) =>
          part.chapters.map((chapter) => ({
            key: `${book.id}:${chapter.id}`,
            label: `${book.title} · ${part.title} · ${chapter.title}`,
            book,
            chapter
          }))
        )
      ])
      .filter((destination) =>
        destination.label
          .toLocaleLowerCase()
          .includes(moveQuery.trim().toLocaleLowerCase())
      );
    content = (
      <>
        <Section title="Scene details">
          <CommitField
            disabled={busy}
            label="Scene title"
            onCommit={(title) =>
              title === null
                ? Promise.resolve(false)
                : run({
                    type: "scene.update",
                    sceneId: scene.id,
                    title
                  })
            }
            value={scene.title}
          />
          <CommitField
            disabled={busy}
            emptyAsNull
            label="Scene summary"
            multiline
            onCommit={(summary) =>
              run({
                type: "scene.update",
                sceneId: scene.id,
                summary
              })
            }
            value={scene.summary ?? ""}
          />
          <ChoiceGroup
            disabled={busy}
            label="Scene status"
            onChange={(status) =>
              run({ type: "scene.update", sceneId: scene.id, status })
            }
            options={SCENE_STATUSES}
            value={scene.status}
          />
          <Text style={styles.fieldLabel}>Point of view</Text>
          <View style={styles.actionRow}>
            <Button
              disabled={busy}
              label="Open POV"
              onPress={() =>
                void run({
                  type: "scene.update",
                  sceneId: scene.id,
                  povStoryKnowledgeId: null
                })
              }
              selected={scene.povStoryKnowledgeId === undefined}
            />
            {project.storyKnowledge
              .filter((knowledge) => knowledge.archivedAt === undefined)
              .map((knowledge) => (
                <Button
                  disabled={busy}
                  key={knowledge.id}
                  label={knowledge.label}
                  onPress={() =>
                    void run({
                      type: "scene.update",
                      sceneId: scene.id,
                      povStoryKnowledgeId: knowledge.id
                    })
                  }
                  selected={scene.povStoryKnowledgeId === knowledge.id}
                />
              ))}
          </View>
        </Section>
        <Section title="Manuscript placement">
          <Text style={styles.help}>
            {placement === undefined
              ? "Placement unavailable"
              : `${placement.book.title} · ${
                  placement.chapter?.title ?? "Unassigned"
                } · position ${placement.position + 1} of ${placement.count}`}
          </Text>
          <View style={[styles.actionRow, styles.spaced]}>
            <Button
              disabled={
                busy || placement === undefined || placement.position <= 0
              }
              label="Move scene up"
              onPress={() => void onReorder(selection, -1)}
            />
            <Button
              disabled={
                busy ||
                placement === undefined ||
                placement.position >= placement.count - 1
              }
              label="Move scene down"
              onPress={() => void onReorder(selection, 1)}
            />
          </View>
          <TextInput
            accessibilityLabel="Find scene destination"
            editable={!busy}
            onChangeText={setMoveQuery}
            placeholder="Find a chapter or Unassigned"
            placeholderTextColor={colors.muted}
            style={[styles.input, styles.moveSearch]}
            value={moveQuery}
          />
          {moveQuery.length > 0 ? (
            <Button
              disabled={busy}
              label="Clear scene destination search"
              onPress={() => setMoveQuery("")}
            />
          ) : null}
          <View style={[styles.destinationList, styles.spaced]}>
            {destinations.map((destination) => {
              const current =
                placement?.book.id === destination.book.id &&
                placement.chapter?.id === destination.chapter?.id;
              const targetCount =
                destination.chapter?.scenes.length ??
                destination.book.unassignedScenes.length;
              return (
                <Button
                  disabled={busy || current}
                  key={destination.key}
                  label={
                    current
                      ? `${destination.label} · current`
                      : `Move scene to ${destination.label}`
                  }
                  onPress={() =>
                    void run({
                      type: "scene.move",
                      sceneId: scene.id,
                      bookId: destination.book.id,
                      ...(destination.chapter === undefined
                        ? {}
                        : { chapterId: destination.chapter.id }),
                      position: targetCount
                    })
                  }
                  selected={current}
                />
              );
            })}
          </View>
        </Section>
        <Section title="Scene lifecycle">
          {archiveButton(
            scene.archivedAt !== undefined,
            { archive: "Archive scene", restore: "Restore scene" },
            (archived) => ({
              type: "scene.setArchived",
              sceneId: scene.id,
              archived
            }),
            {
              title: `Archive ${scene.title}?`,
              detail:
                "The scene stays in manuscript placement and all Draft/Canvas history remains recoverable."
            }
          )}
        </Section>
      </>
    );
  } else if (
    selection.kind === "unassigned" &&
    resolved.book !== undefined
  ) {
    content = (
      <Section title="Unassigned scenes">
        <Text style={styles.help}>
          {resolved.book.unassignedScenes.length} scenes are outside a chapter
          in {resolved.book.title}. Add here from the tree, or select a scene
          to move it into a chapter.
        </Text>
      </Section>
    );
  } else if (selection.kind === "storyKnowledgeRoot") {
    content = (
      <Section title="Project story knowledge">
        <Text style={styles.help}>
          Characters, locations, world rules, and threads are shared across
          books. Add a record from the tree, then edit and link it here.
        </Text>
      </Section>
    );
  } else if (
    selection.kind === "storyKnowledge" &&
    resolved.knowledge !== undefined
  ) {
    const knowledge = resolved.knowledge;
    const usedAsPov = scenes.some(
      (scene) => scene.povStoryKnowledgeId === knowledge.id
    );
    const linked =
      selectedWorkspaceScene !== undefined &&
      knowledge.linkedSceneIds.includes(selectedWorkspaceScene.id);
    content = (
      <>
        <Section title="Story record details">
          <CommitField
            disabled={busy}
            label="Story-knowledge label"
            onCommit={(label) =>
              label === null
                ? Promise.resolve(false)
                : run({
                    type: "storyKnowledge.update",
                    storyKnowledgeId: knowledge.id,
                    label
                  })
            }
            value={knowledge.label}
          />
          <ChoiceGroup
            disabled={busy}
            label="Kind"
            onChange={(kind) =>
              run({
                type: "storyKnowledge.update",
                storyKnowledgeId: knowledge.id,
                kind
              })
            }
            options={KNOWLEDGE_KINDS}
            value={knowledge.kind}
          />
          <ChoiceGroup
            disabled={busy}
            label="Authority"
            onChange={(authority) =>
              run({
                type: "storyKnowledge.update",
                storyKnowledgeId: knowledge.id,
                authority
              })
            }
            options={KNOWLEDGE_AUTHORITIES}
            value={knowledge.authority}
          />
        </Section>
        <Section title="Selected scene link">
          {selectedWorkspaceScene === undefined ? (
            <Text style={styles.help}>
              Select a scene in the tree before linking this record.
            </Text>
          ) : (
            <>
              <Text style={styles.help}>
                {knowledge.linkedSceneCount} total scene links · current Draft
                selection: {selectedWorkspaceScene.title}
              </Text>
              <View style={styles.spaced}>
                <Button
                  disabled={
                    busy ||
                    (selectedWorkspaceScene.archivedAt !== undefined && !linked)
                  }
                  label={
                    linked
                      ? `Unlink ${selectedWorkspaceScene.title}`
                      : `Link ${selectedWorkspaceScene.title}`
                  }
                  onPress={() =>
                    void run({
                      type: "storyKnowledge.setSceneLink",
                      storyKnowledgeId: knowledge.id,
                      sceneId: selectedWorkspaceScene.id,
                      linked: !linked
                    })
                  }
                />
              </View>
              {selectedWorkspaceScene.archivedAt !== undefined && !linked ? (
                <Text style={styles.refusal}>
                  Restore {selectedWorkspaceScene.title} before creating a new
                  story link.
                </Text>
              ) : null}
            </>
          )}
        </Section>
        <Section title="Story record lifecycle">
          {archiveButton(
            knowledge.archivedAt !== undefined,
            {
              archive: "Archive story knowledge",
              restore: "Restore story knowledge"
            },
            (archived) => ({
              type: "storyKnowledge.setArchived",
              storyKnowledgeId: knowledge.id,
              archived
            }),
            {
              title: `Archive ${knowledge.label}?`,
              detail:
                "Existing scene links remain preserved. A record used as POV must be unassigned first."
            },
            usedAsPov
          )}
          {usedAsPov ? (
            <Text style={styles.refusal}>
              Clear this record from every scene POV before archiving it.
            </Text>
          ) : null}
        </Section>
      </>
    );
  } else {
    content = null;
  }

  return (
    <View accessibilityLabel="Selection inspector" style={styles.panel}>
      <View style={styles.heading}>
        <View style={styles.headingCopy}>
          <Text style={styles.eyebrow}>{heading.eyebrow}</Text>
          <Text numberOfLines={2} style={styles.title}>
            {heading.title}
          </Text>
        </View>
        {onClose === undefined ? null : (
          <Button label="Close inspector" onPress={onClose} />
        )}
      </View>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator
        style={styles.scroll}
      >
        {confirmation === undefined ? null : (
          <View accessibilityRole="alert" style={styles.confirmation}>
            <Text style={styles.confirmationTitle}>{confirmation.title}</Text>
            <Text style={styles.confirmationDetail}>{confirmation.detail}</Text>
            <View style={styles.actionRow}>
              <Button
                disabled={busy}
                label="Cancel"
                onPress={() => setConfirmation(undefined)}
              />
              <Button
                danger
                disabled={busy}
                label={confirmation.confirmLabel}
                onPress={() => {
                  const command = confirmation.command;
                  setConfirmation(undefined);
                  void run(command);
                }}
              />
            </View>
          </View>
        )}
        {content}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: "#fcfbf8",
    flex: 1,
    minHeight: 0,
    minWidth: 0
  },
  heading: {
    alignItems: "flex-start",
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between",
    padding: 12
  },
  headingCopy: {
    flex: 1,
    minWidth: 0
  },
  eyebrow: {
    color: colors.kicker,
    fontFamily: fonts.uiSemibold,
    fontSize: 8,
    letterSpacing: 1.3,
    textTransform: "uppercase"
  },
  title: {
    color: colors.ink,
    fontFamily: fonts.story,
    fontSize: 21,
    lineHeight: 24,
    marginTop: 3
  },
  scroll: {
    flex: 1,
    minHeight: 0
  },
  content: {
    paddingBottom: 28
  },
  section: {
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    padding: 12
  },
  sectionTitle: {
    color: colors.ink,
    fontFamily: fonts.uiSemibold,
    fontSize: 10,
    marginBottom: 9
  },
  field: {
    marginBottom: 11,
    minWidth: 0
  },
  fieldHeading: {
    alignItems: "center",
    flexDirection: "row",
    gap: 5,
    justifyContent: "space-between",
    marginBottom: 4
  },
  fieldLabel: {
    color: colors.muted,
    fontFamily: fonts.uiSemibold,
    fontSize: 8,
    letterSpacing: 0.5,
    marginBottom: 4,
    textTransform: "uppercase"
  },
  fieldSaving: {
    color: colors.blue,
    fontFamily: fonts.uiSemibold,
    fontSize: 7
  },
  fieldDirty: {
    color: colors.amber,
    fontFamily: fonts.uiSemibold,
    fontSize: 7
  },
  fieldSaved: {
    color: colors.green,
    fontFamily: fonts.uiSemibold,
    fontSize: 7
  },
  input: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 7,
    borderWidth: 1,
    color: colors.ink,
    fontFamily: fonts.ui,
    fontSize: 10,
    minHeight: 39,
    minWidth: 0,
    paddingHorizontal: 9,
    paddingVertical: 7,
    width: "100%"
  },
  inputDirty: {
    borderColor: colors.amber
  },
  inputInvalid: {
    borderColor: colors.red
  },
  inputMultiline: {
    minHeight: 82,
    textAlignVertical: "top"
  },
  moveSearch: {
    marginTop: 10
  },
  validation: {
    color: colors.red,
    fontFamily: fonts.uiMedium,
    fontSize: 8,
    marginTop: 4
  },
  actionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 5,
    minWidth: 0
  },
  spaced: {
    marginTop: 9
  },
  destinationList: {
    gap: 5
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
  help: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 9,
    lineHeight: 14
  },
  refusal: {
    color: colors.amber,
    fontFamily: fonts.uiMedium,
    fontSize: 8,
    lineHeight: 13,
    marginTop: 7
  },
  confirmation: {
    backgroundColor: colors.amberSoft,
    borderBottomColor: colors.amber,
    borderBottomWidth: 1,
    gap: 7,
    padding: 11
  },
  confirmationTitle: {
    color: colors.ink,
    fontFamily: fonts.uiSemibold,
    fontSize: 10
  },
  confirmationDetail: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 8,
    lineHeight: 13
  }
});
