import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View
} from "react-native";
import type {
  BookId,
  BookStatus,
  ChapterId,
  PartId,
  ProjectCommand,
  ProjectNavigator,
  ProjectNavigatorBook,
  ProjectNavigatorChapter,
  ProjectNavigatorScene,
  SceneId,
  SceneStatus,
  StoryKnowledgeAuthority,
  StoryKnowledgeId,
  StoryKnowledgeKind
} from "@ghostwriter/core";
import { ghostwriterTheme } from "./theme.js";

export type AuthenticatedProjectWorkspaceProps = Readonly<{
  project: ProjectNavigator;
  profileDisplayName: string;
  busy?: boolean;
  saveState?: "saved" | "saving" | "error";
  error?: string;
  onBack(): void;
  onRefresh(): void;
  onSignOut(): void;
  onCommand(command: ProjectCommand): void;
}>;

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

function Button({
  label,
  onPress,
  primary = false,
  danger = false,
  disabled = false
}: Readonly<{
  label: string;
  onPress(): void;
  primary?: boolean;
  danger?: boolean;
  disabled?: boolean;
}>) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        primary && styles.buttonPrimary,
        danger && styles.buttonDanger,
        pressed && styles.pressed,
        disabled && styles.disabled
      ]}
    >
      <Text
        style={[
          styles.buttonText,
          primary && styles.buttonTextPrimary,
          danger && styles.buttonTextDanger
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
  multiline = false,
  disabled = false
}: Readonly<{
  label: string;
  value: string;
  onChangeText(value: string): void;
  multiline?: boolean;
  disabled?: boolean;
}>) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        editable={!disabled}
        multiline={multiline}
        onChangeText={onChangeText}
        placeholderTextColor={colors.muted}
        style={[styles.input, multiline && styles.inputMultiline]}
        value={value}
      />
    </View>
  );
}

function ChoiceRow<Value extends string>({
  label,
  options,
  value,
  disabled = false,
  onChange
}: Readonly<{
  label: string;
  options: readonly Value[];
  value: Value;
  disabled?: boolean;
  onChange(value: Value): void;
}>) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.choiceRow}>
        {options.map((option) => (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: option === value }}
            disabled={disabled}
            key={option}
            onPress={() => onChange(option)}
            style={[
              styles.choice,
              option === value && styles.choiceSelected,
              disabled && styles.disabled
            ]}
          >
            <Text
              style={[
                styles.choiceText,
                option === value && styles.choiceTextSelected
              ]}
            >
              {option}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function orderedScenes(book: ProjectNavigatorBook): ProjectNavigatorScene[] {
  return [
    ...book.parts.flatMap((part) =>
      part.chapters.flatMap((chapter) => chapter.scenes)
    ),
    ...book.unassignedScenes
  ];
}

function allScenes(project: ProjectNavigator): ProjectNavigatorScene[] {
  return project.books.flatMap(orderedScenes);
}

function swapped<Value>(values: readonly Value[], from: number, to: number): Value[] {
  if (to < 0 || to >= values.length) return [...values];
  const result = [...values];
  const [value] = result.splice(from, 1);
  if (value !== undefined) result.splice(to, 0, value);
  return result;
}

function Section({
  eyebrow,
  title,
  children
}: Readonly<{
  eyebrow: string;
  title: string;
  children: ReactNode;
}>) {
  return (
    <View style={styles.panel}>
      <Text style={styles.eyebrow}>{eyebrow}</Text>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

export function AuthenticatedProjectWorkspace({
  project,
  profileDisplayName,
  busy = false,
  saveState = "saved",
  error,
  onBack,
  onRefresh,
  onSignOut,
  onCommand
}: AuthenticatedProjectWorkspaceProps) {
  const compact = useWindowDimensions().width < 920;
  const firstBook = project.books[0];
  const [selectedBookId, setSelectedBookId] = useState<BookId | undefined>(
    firstBook?.id
  );
  const selectedBook =
    project.books.find((book) => book.id === selectedBookId) ?? firstBook;
  const firstPart = selectedBook?.parts[0];
  const [selectedPartId, setSelectedPartId] = useState<PartId | undefined>(
    firstPart?.id
  );
  const selectedPart =
    selectedBook?.parts.find((part) => part.id === selectedPartId) ??
    selectedBook?.parts[0];
  const firstChapter = selectedPart?.chapters[0];
  const [selectedChapterId, setSelectedChapterId] = useState<
    ChapterId | undefined
  >(firstChapter?.id);
  const selectedChapter =
    selectedPart?.chapters.find((chapter) => chapter.id === selectedChapterId) ??
    selectedPart?.chapters[0];
  const projectScenes = useMemo(() => allScenes(project), [project]);
  const [selectedSceneId, setSelectedSceneId] = useState<SceneId | undefined>(
    projectScenes[0]?.id
  );
  const selectedScene =
    projectScenes.find((scene) => scene.id === selectedSceneId) ??
    projectScenes[0];
  const [selectedKnowledgeId, setSelectedKnowledgeId] = useState<
    StoryKnowledgeId | undefined
  >(project.storyKnowledge[0]?.id);
  const selectedKnowledge =
    project.storyKnowledge.find(
      (knowledge) => knowledge.id === selectedKnowledgeId
    ) ?? project.storyKnowledge[0];

  const [projectTitle, setProjectTitle] = useState(project.title);
  const [newBookTitle, setNewBookTitle] = useState("");
  const [bookTitle, setBookTitle] = useState(selectedBook?.title ?? "");
  const [bookStatus, setBookStatus] = useState<BookStatus>(
    selectedBook?.status ?? "planned"
  );
  const [newPartTitle, setNewPartTitle] = useState("");
  const [partTitle, setPartTitle] = useState(selectedPart?.title ?? "");
  const [newChapterTitle, setNewChapterTitle] = useState("");
  const [chapterTitle, setChapterTitle] = useState(
    selectedChapter?.title ?? ""
  );
  const [newSceneTitle, setNewSceneTitle] = useState("");
  const [sceneTitle, setSceneTitle] = useState(selectedScene?.title ?? "");
  const [sceneSummary, setSceneSummary] = useState(selectedScene?.summary ?? "");
  const [sceneStatus, setSceneStatus] = useState<SceneStatus>(
    selectedScene?.status ?? "planned"
  );
  const [scenePovId, setScenePovId] = useState<StoryKnowledgeId | undefined>(
    selectedScene?.povStoryKnowledgeId
  );
  const [newKnowledgeLabel, setNewKnowledgeLabel] = useState("");
  const [newKnowledgeKind, setNewKnowledgeKind] =
    useState<StoryKnowledgeKind>("character");
  const [newKnowledgeAuthority, setNewKnowledgeAuthority] =
    useState<StoryKnowledgeAuthority>("planned");
  const [knowledgeLabel, setKnowledgeLabel] = useState(
    selectedKnowledge?.label ?? ""
  );
  const [knowledgeKind, setKnowledgeKind] = useState<StoryKnowledgeKind>(
    selectedKnowledge?.kind ?? "character"
  );
  const [knowledgeAuthority, setKnowledgeAuthority] =
    useState<StoryKnowledgeAuthority>(
      selectedKnowledge?.authority ?? "planned"
    );

  useEffect(() => setProjectTitle(project.title), [project.title]);
  useEffect(() => {
    setBookTitle(selectedBook?.title ?? "");
    setBookStatus(selectedBook?.status ?? "planned");
    const nextPart = selectedBook?.parts[0];
    if (
      selectedBook !== undefined &&
      !selectedBook.parts.some((part) => part.id === selectedPartId)
    ) {
      setSelectedPartId(nextPart?.id);
    }
  }, [selectedBook, selectedPartId]);
  useEffect(() => {
    setPartTitle(selectedPart?.title ?? "");
    const nextChapter = selectedPart?.chapters[0];
    if (
      selectedPart !== undefined &&
      !selectedPart.chapters.some(
        (chapter) => chapter.id === selectedChapterId
      )
    ) {
      setSelectedChapterId(nextChapter?.id);
    }
  }, [selectedPart, selectedChapterId]);
  useEffect(
    () => setChapterTitle(selectedChapter?.title ?? ""),
    [selectedChapter]
  );
  useEffect(() => {
    setSceneTitle(selectedScene?.title ?? "");
    setSceneSummary(selectedScene?.summary ?? "");
    setSceneStatus(selectedScene?.status ?? "planned");
    setScenePovId(selectedScene?.povStoryKnowledgeId);
  }, [selectedScene]);
  useEffect(() => {
    setKnowledgeLabel(selectedKnowledge?.label ?? "");
    setKnowledgeKind(selectedKnowledge?.kind ?? "character");
    setKnowledgeAuthority(selectedKnowledge?.authority ?? "planned");
  }, [selectedKnowledge]);

  const selectedBookIndex =
    selectedBook === undefined
      ? -1
      : project.books.findIndex((book) => book.id === selectedBook.id);
  const selectedPartIndex =
    selectedBook === undefined || selectedPart === undefined
      ? -1
      : selectedBook.parts.findIndex((part) => part.id === selectedPart.id);
  const selectedChapterIndex =
    selectedPart === undefined || selectedChapter === undefined
      ? -1
      : selectedPart.chapters.findIndex(
          (chapter) => chapter.id === selectedChapter.id
        );

  function command(value: ProjectCommand): void {
    if (!busy) onCommand(value);
  }

  function moveSceneTo(
    targetBook: ProjectNavigatorBook,
    targetChapter?: ProjectNavigatorChapter
  ): void {
    if (selectedScene === undefined) return;
    const existingIds =
      targetChapter === undefined
        ? targetBook.unassignedScenes.map((scene) => scene.id)
        : targetChapter.scenes.map((scene) => scene.id);
    command({
      type: "scene.move",
      sceneId: selectedScene.id,
      bookId: targetBook.id,
      ...(targetChapter === undefined ? {} : { chapterId: targetChapter.id }),
      position: existingIds.filter((id) => id !== selectedScene.id).length
    });
  }

  return (
    <View style={styles.screen}>
      <View style={[styles.topbar, compact && styles.topbarCompact]}>
        <Button disabled={busy} label="← Projects" onPress={onBack} />
        <View style={styles.topbarCopy}>
          <Text numberOfLines={1} style={styles.topbarTitle}>
            {project.title}
          </Text>
          <Text style={styles.topbarMeta}>
            {profileDisplayName} · project version {project.version}
          </Text>
        </View>
        <View style={styles.topbarActions}>
          <Text
            accessibilityLiveRegion="polite"
            style={[
              styles.saveState,
              saveState === "error" && styles.saveStateError
            ]}
          >
            {saveState === "saving"
              ? "Saving…"
              : saveState === "error"
                ? "Not saved"
                : "Saved to project"}
          </Text>
          <Button disabled={busy} label="Refresh" onPress={onRefresh} />
          <Button disabled={busy} label="Sign out" onPress={onSignOut} />
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {error === undefined ? null : (
          <View accessibilityRole="alert" style={styles.error}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <Section eyebrow="Project" title="Project identity and lifecycle">
          <Field
            disabled={busy}
            label="Project title"
            onChangeText={setProjectTitle}
            value={projectTitle}
          />
          <View style={styles.actionRow}>
            <Button
              disabled={busy || projectTitle.trim().length === 0}
              label="Save title"
              onPress={() =>
                command({ type: "project.rename", title: projectTitle.trim() })
              }
              primary
            />
            <Button
              danger={project.archivedAt === undefined}
              disabled={busy}
              label={project.archivedAt === undefined ? "Archive project" : "Restore project"}
              onPress={() =>
                command({
                  type: "project.setArchived",
                  archived: project.archivedAt === undefined
                })
              }
            />
          </View>
        </Section>

        <View style={[styles.columns, compact && styles.columnsCompact]}>
          <View style={styles.column}>
            <Section eyebrow="Books" title="Series order">
              <View style={styles.addRow}>
                <TextInput
                  accessibilityLabel="New book title"
                  editable={!busy}
                  onChangeText={setNewBookTitle}
                  placeholder="New book title"
                  placeholderTextColor={colors.muted}
                  style={[styles.input, styles.addInput]}
                  value={newBookTitle}
                />
                <Button
                  disabled={busy || newBookTitle.trim().length === 0}
                  label="Add book"
                  onPress={() => {
                    command({ type: "book.create", title: newBookTitle.trim() });
                    setNewBookTitle("");
                  }}
                />
              </View>
              <View style={styles.selectionList}>
                {project.books.map((book, index) => (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected: book.id === selectedBook?.id }}
                    key={book.id}
                    onPress={() => setSelectedBookId(book.id)}
                    style={[
                      styles.selectionRow,
                      book.id === selectedBook?.id && styles.selectionRowActive
                    ]}
                  >
                    <Text style={styles.selectionIndex}>{index + 1}</Text>
                    <View style={styles.selectionCopy}>
                      <Text style={styles.selectionTitle}>{book.title}</Text>
                      <Text style={styles.selectionMeta}>
                        {book.status}
                        {book.archivedAt === undefined ? "" : " · archived"}
                      </Text>
                    </View>
                  </Pressable>
                ))}
              </View>
              {selectedBook === undefined ? null : (
                <View style={styles.editorBlock}>
                  <Field
                    disabled={busy}
                    label="Selected book title"
                    onChangeText={setBookTitle}
                    value={bookTitle}
                  />
                  <ChoiceRow<BookStatus>
                    disabled={busy}
                    label="Book status"
                    onChange={setBookStatus}
                    options={BOOK_STATUSES}
                    value={bookStatus}
                  />
                  <View style={styles.actionRow}>
                    <Button
                      disabled={busy || bookTitle.trim().length === 0}
                      label="Save book"
                      onPress={() =>
                        command({
                          type: "book.update",
                          bookId: selectedBook.id,
                          title: bookTitle.trim(),
                          status: bookStatus
                        })
                      }
                      primary
                    />
                    <Button
                      disabled={busy || selectedBookIndex <= 0}
                      label="Move up"
                      onPress={() =>
                        command({
                          type: "book.reorder",
                          bookIds: swapped(
                            project.books.map((book) => book.id),
                            selectedBookIndex,
                            selectedBookIndex - 1
                          )
                        })
                      }
                    />
                    <Button
                      disabled={
                        busy ||
                        selectedBookIndex < 0 ||
                        selectedBookIndex >= project.books.length - 1
                      }
                      label="Move down"
                      onPress={() =>
                        command({
                          type: "book.reorder",
                          bookIds: swapped(
                            project.books.map((book) => book.id),
                            selectedBookIndex,
                            selectedBookIndex + 1
                          )
                        })
                      }
                    />
                    <Button
                      danger={selectedBook.archivedAt === undefined}
                      disabled={busy}
                      label={
                        selectedBook.archivedAt === undefined
                          ? "Archive"
                          : "Restore"
                      }
                      onPress={() =>
                        command({
                          type: "book.setArchived",
                          bookId: selectedBook.id,
                          archived: selectedBook.archivedAt === undefined
                        })
                      }
                    />
                  </View>
                </View>
              )}
            </Section>

            <Section eyebrow="Structure" title="Parts and chapters">
              {selectedBook === undefined ? (
                <Text style={styles.muted}>Select a book first.</Text>
              ) : (
                <>
                  <View style={styles.addRow}>
                    <TextInput
                      accessibilityLabel="New part title"
                      editable={!busy}
                      onChangeText={setNewPartTitle}
                      placeholder="New part title"
                      placeholderTextColor={colors.muted}
                      style={[styles.input, styles.addInput]}
                      value={newPartTitle}
                    />
                    <Button
                      disabled={busy || newPartTitle.trim().length === 0}
                      label="Add part"
                      onPress={() => {
                        command({
                          type: "part.create",
                          bookId: selectedBook.id,
                          title: newPartTitle.trim()
                        });
                        setNewPartTitle("");
                      }}
                    />
                  </View>
                  <View style={styles.choiceRow}>
                    {selectedBook.parts.map((part) => (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityState={{
                          selected: part.id === selectedPart?.id
                        }}
                        key={part.id}
                        onPress={() => setSelectedPartId(part.id)}
                        style={[
                          styles.choice,
                          part.id === selectedPart?.id && styles.choiceSelected
                        ]}
                      >
                        <Text
                          style={[
                            styles.choiceText,
                            part.id === selectedPart?.id &&
                              styles.choiceTextSelected
                          ]}
                        >
                          {part.title}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  {selectedPart === undefined ? null : (
                    <View style={styles.editorBlock}>
                      <Field
                        disabled={busy}
                        label="Selected part title"
                        onChangeText={setPartTitle}
                        value={partTitle}
                      />
                      <View style={styles.actionRow}>
                        <Button
                          disabled={busy || partTitle.trim().length === 0}
                          label="Save part"
                          onPress={() =>
                            command({
                              type: "part.rename",
                              bookId: selectedBook.id,
                              partId: selectedPart.id,
                              title: partTitle.trim()
                            })
                          }
                        />
                        <Button
                          disabled={busy || selectedPartIndex <= 0}
                          label="Part ↑"
                          onPress={() =>
                            command({
                              type: "part.reorder",
                              bookId: selectedBook.id,
                              partIds: swapped(
                                selectedBook.parts.map((part) => part.id),
                                selectedPartIndex,
                                selectedPartIndex - 1
                              )
                            })
                          }
                        />
                        <Button
                          disabled={
                            busy ||
                            selectedPartIndex < 0 ||
                            selectedPartIndex >= selectedBook.parts.length - 1
                          }
                          label="Part ↓"
                          onPress={() =>
                            command({
                              type: "part.reorder",
                              bookId: selectedBook.id,
                              partIds: swapped(
                                selectedBook.parts.map((part) => part.id),
                                selectedPartIndex,
                                selectedPartIndex + 1
                              )
                            })
                          }
                        />
                        <Button
                          danger
                          disabled={busy || selectedPart.chapters.length > 0}
                          label="Remove empty part"
                          onPress={() =>
                            command({
                              type: "part.removeEmpty",
                              bookId: selectedBook.id,
                              partId: selectedPart.id
                            })
                          }
                        />
                      </View>

                      <View style={styles.divider} />
                      <View style={styles.addRow}>
                        <TextInput
                          accessibilityLabel="New chapter title"
                          editable={!busy}
                          onChangeText={setNewChapterTitle}
                          placeholder="New chapter title"
                          placeholderTextColor={colors.muted}
                          style={[styles.input, styles.addInput]}
                          value={newChapterTitle}
                        />
                        <Button
                          disabled={busy || newChapterTitle.trim().length === 0}
                          label="Add chapter"
                          onPress={() => {
                            command({
                              type: "chapter.create",
                              bookId: selectedBook.id,
                              partId: selectedPart.id,
                              title: newChapterTitle.trim()
                            });
                            setNewChapterTitle("");
                          }}
                        />
                      </View>
                      <View style={styles.choiceRow}>
                        {selectedPart.chapters.map((chapter) => (
                          <Pressable
                            accessibilityRole="button"
                            accessibilityState={{
                              selected: chapter.id === selectedChapter?.id
                            }}
                            key={chapter.id}
                            onPress={() => setSelectedChapterId(chapter.id)}
                            style={[
                              styles.choice,
                              chapter.id === selectedChapter?.id &&
                                styles.choiceSelected
                            ]}
                          >
                            <Text
                              style={[
                                styles.choiceText,
                                chapter.id === selectedChapter?.id &&
                                  styles.choiceTextSelected
                              ]}
                            >
                              {chapter.title}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                      {selectedChapter === undefined ? null : (
                        <>
                          <Field
                            disabled={busy}
                            label="Selected chapter title"
                            onChangeText={setChapterTitle}
                            value={chapterTitle}
                          />
                          <View style={styles.actionRow}>
                            <Button
                              disabled={busy || chapterTitle.trim().length === 0}
                              label="Save chapter"
                              onPress={() =>
                                command({
                                  type: "chapter.rename",
                                  bookId: selectedBook.id,
                                  partId: selectedPart.id,
                                  chapterId: selectedChapter.id,
                                  title: chapterTitle.trim()
                                })
                              }
                            />
                            <Button
                              disabled={busy || selectedChapterIndex <= 0}
                              label="Chapter ↑"
                              onPress={() =>
                                command({
                                  type: "chapter.reorder",
                                  bookId: selectedBook.id,
                                  partId: selectedPart.id,
                                  chapterIds: swapped(
                                    selectedPart.chapters.map(
                                      (chapter) => chapter.id
                                    ),
                                    selectedChapterIndex,
                                    selectedChapterIndex - 1
                                  )
                                })
                              }
                            />
                            <Button
                              disabled={
                                busy ||
                                selectedChapterIndex < 0 ||
                                selectedChapterIndex >=
                                  selectedPart.chapters.length - 1
                              }
                              label="Chapter ↓"
                              onPress={() =>
                                command({
                                  type: "chapter.reorder",
                                  bookId: selectedBook.id,
                                  partId: selectedPart.id,
                                  chapterIds: swapped(
                                    selectedPart.chapters.map(
                                      (chapter) => chapter.id
                                    ),
                                    selectedChapterIndex,
                                    selectedChapterIndex + 1
                                  )
                                })
                              }
                            />
                            <Button
                              danger
                              disabled={busy || selectedChapter.scenes.length > 0}
                              label="Remove empty chapter"
                              onPress={() =>
                                command({
                                  type: "chapter.removeEmpty",
                                  bookId: selectedBook.id,
                                  partId: selectedPart.id,
                                  chapterId: selectedChapter.id
                                })
                              }
                            />
                          </View>
                        </>
                      )}
                    </View>
                  )}
                </>
              )}
            </Section>
          </View>

          <View style={styles.column}>
            <Section eyebrow="Scenes" title="Scene metadata and placement">
              {selectedBook === undefined ? null : (
                <View style={styles.addRow}>
                  <TextInput
                    accessibilityLabel="New scene title"
                    editable={!busy}
                    onChangeText={setNewSceneTitle}
                    placeholder="New scene title"
                    placeholderTextColor={colors.muted}
                    style={[styles.input, styles.addInput]}
                    value={newSceneTitle}
                  />
                  <Button
                    disabled={busy || newSceneTitle.trim().length === 0}
                    label={
                      selectedChapter === undefined
                        ? "Add unassigned"
                        : "Add to chapter"
                    }
                    onPress={() => {
                      command({
                        type: "scene.create",
                        bookId: selectedBook.id,
                        title: newSceneTitle.trim(),
                        ...(selectedChapter === undefined
                          ? {}
                          : { chapterId: selectedChapter.id })
                      });
                      setNewSceneTitle("");
                    }}
                  />
                </View>
              )}
              <View style={styles.selectionList}>
                {projectScenes.map((scene) => (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected: scene.id === selectedScene?.id }}
                    key={scene.id}
                    onPress={() => setSelectedSceneId(scene.id)}
                    style={[
                      styles.selectionRow,
                      scene.id === selectedScene?.id && styles.selectionRowActive
                    ]}
                  >
                    <View style={styles.selectionCopy}>
                      <Text style={styles.selectionTitle}>{scene.title}</Text>
                      <Text style={styles.selectionMeta}>
                        {scene.status}
                        {scene.archivedAt === undefined ? "" : " · archived"}
                      </Text>
                    </View>
                  </Pressable>
                ))}
              </View>
              {selectedScene === undefined ? (
                <Text style={styles.muted}>Create a scene to edit its metadata.</Text>
              ) : (
                <View style={styles.editorBlock}>
                  <Field
                    disabled={busy}
                    label="Scene title"
                    onChangeText={setSceneTitle}
                    value={sceneTitle}
                  />
                  <Field
                    disabled={busy}
                    label="Scene summary"
                    multiline
                    onChangeText={setSceneSummary}
                    value={sceneSummary}
                  />
                  <ChoiceRow<SceneStatus>
                    disabled={busy}
                    label="Scene status"
                    onChange={setSceneStatus}
                    options={SCENE_STATUSES}
                    value={sceneStatus}
                  />
                  <Text style={styles.fieldLabel}>Point of view</Text>
                  <View style={styles.choiceRow}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ selected: scenePovId === undefined }}
                      onPress={() => setScenePovId(undefined)}
                      style={[
                        styles.choice,
                        scenePovId === undefined && styles.choiceSelected
                      ]}
                    >
                      <Text style={styles.choiceText}>Open</Text>
                    </Pressable>
                    {project.storyKnowledge
                      .filter((knowledge) => knowledge.archivedAt === undefined)
                      .map((knowledge) => (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityState={{
                            selected: scenePovId === knowledge.id
                          }}
                          key={knowledge.id}
                          onPress={() => setScenePovId(knowledge.id)}
                          style={[
                            styles.choice,
                            scenePovId === knowledge.id && styles.choiceSelected
                          ]}
                        >
                          <Text style={styles.choiceText}>{knowledge.label}</Text>
                        </Pressable>
                      ))}
                  </View>
                  <View style={styles.actionRow}>
                    <Button
                      disabled={busy || sceneTitle.trim().length === 0}
                      label="Save scene"
                      onPress={() =>
                        command({
                          type: "scene.update",
                          sceneId: selectedScene.id,
                          title: sceneTitle.trim(),
                          status: sceneStatus,
                          summary:
                            sceneSummary.trim().length === 0
                              ? null
                              : sceneSummary.trim(),
                          povStoryKnowledgeId: scenePovId ?? null
                        })
                      }
                      primary
                    />
                    <Button
                      danger={selectedScene.archivedAt === undefined}
                      disabled={busy}
                      label={
                        selectedScene.archivedAt === undefined
                          ? "Archive scene"
                          : "Restore scene"
                      }
                      onPress={() =>
                        command({
                          type: "scene.setArchived",
                          sceneId: selectedScene.id,
                          archived: selectedScene.archivedAt === undefined
                        })
                      }
                    />
                  </View>
                  <Text style={[styles.fieldLabel, styles.moveLabel]}>
                    Move to the end of…
                  </Text>
                  <View style={styles.actionRow}>
                    {project.books.map((book) => (
                      <Button
                        disabled={busy}
                        key={book.id}
                        label={`${book.title} · Unassigned`}
                        onPress={() => moveSceneTo(book)}
                      />
                    ))}
                    {selectedBook === undefined || selectedChapter === undefined ? null : (
                      <Button
                        disabled={busy}
                        label={`${selectedBook.title} · ${selectedChapter.title}`}
                        onPress={() => moveSceneTo(selectedBook, selectedChapter)}
                      />
                    )}
                  </View>
                </View>
              )}
            </Section>

            <Section eyebrow="Story" title="Project-wide story knowledge">
              <Field
                disabled={busy}
                label="New story-knowledge label"
                onChangeText={setNewKnowledgeLabel}
                value={newKnowledgeLabel}
              />
              <ChoiceRow<StoryKnowledgeKind>
                disabled={busy}
                label="Kind"
                onChange={setNewKnowledgeKind}
                options={KNOWLEDGE_KINDS}
                value={newKnowledgeKind}
              />
              <ChoiceRow<StoryKnowledgeAuthority>
                disabled={busy}
                label="Authority"
                onChange={setNewKnowledgeAuthority}
                options={KNOWLEDGE_AUTHORITIES}
                value={newKnowledgeAuthority}
              />
              <Button
                disabled={busy || newKnowledgeLabel.trim().length === 0}
                label="Add story knowledge"
                onPress={() => {
                  command({
                    type: "storyKnowledge.create",
                    label: newKnowledgeLabel.trim(),
                    kind: newKnowledgeKind,
                    authority: newKnowledgeAuthority
                  });
                  setNewKnowledgeLabel("");
                }}
              />
              <View style={[styles.selectionList, styles.knowledgeList]}>
                {project.storyKnowledge.map((knowledge) => (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{
                      selected: knowledge.id === selectedKnowledge?.id
                    }}
                    key={knowledge.id}
                    onPress={() => setSelectedKnowledgeId(knowledge.id)}
                    style={[
                      styles.selectionRow,
                      knowledge.id === selectedKnowledge?.id &&
                        styles.selectionRowActive
                    ]}
                  >
                    <View style={styles.selectionCopy}>
                      <Text style={styles.selectionTitle}>{knowledge.label}</Text>
                      <Text style={styles.selectionMeta}>
                        {knowledge.kind} · {knowledge.authority} ·{" "}
                        {knowledge.linkedSceneCount} scene links
                        {knowledge.archivedAt === undefined ? "" : " · archived"}
                      </Text>
                    </View>
                  </Pressable>
                ))}
              </View>
              {selectedKnowledge === undefined ? null : (
                <View style={styles.editorBlock}>
                  <Field
                    disabled={busy}
                    label="Selected story-knowledge label"
                    onChangeText={setKnowledgeLabel}
                    value={knowledgeLabel}
                  />
                  <ChoiceRow<StoryKnowledgeKind>
                    disabled={busy}
                    label="Kind"
                    onChange={setKnowledgeKind}
                    options={KNOWLEDGE_KINDS}
                    value={knowledgeKind}
                  />
                  <ChoiceRow<StoryKnowledgeAuthority>
                    disabled={busy}
                    label="Authority"
                    onChange={setKnowledgeAuthority}
                    options={KNOWLEDGE_AUTHORITIES}
                    value={knowledgeAuthority}
                  />
                  <View style={styles.actionRow}>
                    <Button
                      disabled={busy || knowledgeLabel.trim().length === 0}
                      label="Save story knowledge"
                      onPress={() =>
                        command({
                          type: "storyKnowledge.update",
                          storyKnowledgeId: selectedKnowledge.id,
                          label: knowledgeLabel.trim(),
                          kind: knowledgeKind,
                          authority: knowledgeAuthority
                        })
                      }
                      primary
                    />
                    <Button
                      danger={selectedKnowledge.archivedAt === undefined}
                      disabled={busy}
                      label={
                        selectedKnowledge.archivedAt === undefined
                          ? "Archive"
                          : "Restore"
                      }
                      onPress={() =>
                        command({
                          type: "storyKnowledge.setArchived",
                          storyKnowledgeId: selectedKnowledge.id,
                          archived: selectedKnowledge.archivedAt === undefined
                        })
                      }
                    />
                    {selectedScene === undefined ? null : (
                      <Button
                        disabled={busy}
                        label={
                          selectedKnowledge.linkedSceneIds.includes(
                            selectedScene.id
                          )
                            ? `Unlink ${selectedScene.title}`
                            : `Link ${selectedScene.title}`
                        }
                        onPress={() =>
                          command({
                            type: "storyKnowledge.setSceneLink",
                            storyKnowledgeId: selectedKnowledge.id,
                            sceneId: selectedScene.id,
                            linked: !selectedKnowledge.linkedSceneIds.includes(
                              selectedScene.id
                            )
                          })
                        }
                      />
                    )}
                  </View>
                </View>
              )}
            </Section>
          </View>
        </View>

        <Section eyebrow="Editions" title="Named editions are reference-only">
          <Text style={styles.muted}>
            Edition mutation remains disabled until immutable scene and project revisions
            exist. This prevents the interface from promising history that Ghostwriter
            cannot yet preserve.
          </Text>
        </Section>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: colors.canvas,
    flex: 1
  },
  topbar: {
    alignItems: "center",
    backgroundColor: colors.topbar,
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 12,
    minHeight: 64,
    paddingHorizontal: 14,
    paddingVertical: 8
  },
  topbarCompact: {
    alignItems: "flex-start",
    flexWrap: "wrap"
  },
  topbarCopy: {
    flex: 1,
    minWidth: 180
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
    gap: 7
  },
  saveState: {
    color: colors.green,
    fontFamily: fonts.uiSemibold,
    fontSize: 9
  },
  saveStateError: {
    color: colors.red
  },
  content: {
    gap: 14,
    marginHorizontal: "auto",
    maxWidth: 1280,
    padding: 16,
    width: "100%"
  },
  error: {
    backgroundColor: colors.redSoft,
    borderRadius: 8,
    padding: 11
  },
  errorText: {
    color: colors.red,
    fontFamily: fonts.uiMedium,
    fontSize: 10
  },
  columns: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 14
  },
  columnsCompact: {
    flexDirection: "column"
  },
  column: {
    flex: 1,
    gap: 14,
    minWidth: 0,
    width: "100%"
  },
  panel: {
    backgroundColor: colors.paper,
    borderColor: colors.line,
    borderRadius: 10,
    borderWidth: 1,
    padding: 16
  },
  eyebrow: {
    color: colors.kicker,
    fontFamily: fonts.uiSemibold,
    fontSize: 8,
    letterSpacing: 1.5,
    textTransform: "uppercase"
  },
  sectionTitle: {
    color: colors.ink,
    fontFamily: fonts.story,
    fontSize: 23,
    marginBottom: 13,
    marginTop: 3
  },
  field: {
    marginBottom: 10
  },
  fieldLabel: {
    color: colors.muted,
    fontFamily: fonts.uiSemibold,
    fontSize: 8,
    letterSpacing: 0.6,
    marginBottom: 5,
    textTransform: "uppercase"
  },
  input: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 7,
    borderWidth: 1,
    color: colors.ink,
    fontFamily: fonts.ui,
    fontSize: 10,
    minHeight: 40,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  inputMultiline: {
    minHeight: 86,
    textAlignVertical: "top"
  },
  addRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 7,
    marginBottom: 10
  },
  addInput: {
    flex: 1,
    minWidth: 0
  },
  actionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7
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
  buttonText: {
    color: colors.ink,
    fontFamily: fonts.uiSemibold,
    fontSize: 9
  },
  buttonTextPrimary: {
    color: "#ffffff"
  },
  buttonTextDanger: {
    color: colors.red
  },
  pressed: {
    opacity: 0.72
  },
  disabled: {
    opacity: 0.42
  },
  choiceRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 5
  },
  choice: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 5
  },
  choiceSelected: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.kicker
  },
  choiceText: {
    color: colors.muted,
    fontFamily: fonts.uiMedium,
    fontSize: 8
  },
  choiceTextSelected: {
    color: colors.kicker
  },
  selectionList: {
    gap: 6
  },
  selectionRow: {
    alignItems: "center",
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 7,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    padding: 9
  },
  selectionRowActive: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.kicker
  },
  selectionIndex: {
    color: colors.kicker,
    fontFamily: fonts.story,
    fontSize: 14,
    width: 20
  },
  selectionCopy: {
    flex: 1,
    minWidth: 0
  },
  selectionTitle: {
    color: colors.ink,
    fontFamily: fonts.uiSemibold,
    fontSize: 9
  },
  selectionMeta: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 8,
    marginTop: 2
  },
  editorBlock: {
    borderTopColor: colors.line,
    borderTopWidth: 1,
    marginTop: 12,
    paddingTop: 12
  },
  divider: {
    backgroundColor: colors.line,
    height: 1,
    marginVertical: 12
  },
  moveLabel: {
    marginTop: 13
  },
  knowledgeList: {
    marginTop: 12
  },
  muted: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 10,
    lineHeight: 16
  }
});
