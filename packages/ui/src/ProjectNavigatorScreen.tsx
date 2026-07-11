import { useMemo, useState } from "react";
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View
} from "react-native";
import type {
  BookId,
  ProjectNavigator,
  ProjectNavigatorBook,
  ProjectNavigatorScene,
  SceneId,
  StoryKnowledgeAuthority
} from "@ghostwriter/core";
import brandLockup from "./Ghostwriter.png";
import { ghostwriterTheme } from "./theme.js";

export type ProjectNavigatorScreenProps = Readonly<{
  project: ProjectNavigator;
}>;

const { colors, fonts, shell } = ghostwriterTheme;

function scenesForBook(book: ProjectNavigatorBook): readonly ProjectNavigatorScene[] {
  return [
    ...book.parts.flatMap((part) =>
      part.chapters.flatMap((chapter) => chapter.scenes)
    ),
    ...book.unassignedScenes
  ];
}

function titleCase(value: string): string {
  return value
    .split("-")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function statusTone(status: string) {
  if (status === "complete" || status === "confirmed") {
    return {
      background: styles.pillConfirmed,
      text: styles.pillConfirmedText
    };
  }

  if (status === "drafting" || status === "revising" || status === "inferred") {
    return {
      background: styles.pillInferred,
      text: styles.pillInferredText
    };
  }

  if (status === "disputed") {
    return {
      background: styles.pillDisputed,
      text: styles.pillDisputedText
    };
  }

  return {
    background: styles.pillPlanned,
    text: styles.pillPlannedText
  };
}

function StatusPill({ status }: Readonly<{ status: string }>) {
  const tone = statusTone(status);

  return (
    <View style={[styles.pill, tone.background]}>
      <Text style={[styles.pillText, tone.text]}>{titleCase(status)}</Text>
    </View>
  );
}

function AuthorityPill({
  authority
}: Readonly<{ authority: StoryKnowledgeAuthority }>) {
  return <StatusPill status={authority} />;
}

function BrandLockup({ compact = false }: Readonly<{ compact?: boolean }>) {
  return (
    <View style={[styles.brandLockup, compact && styles.brandLockupCompact]}>
      <Image
        accessibilityLabel="ghost-writer AI Writing Studio"
        fadeDuration={0}
        resizeMode="contain"
        source={brandLockup}
        style={[styles.brandLockupImage, compact && styles.brandLockupImageCompact]}
      />
    </View>
  );
}

function RailItem({
  glyph,
  label,
  active = false
}: Readonly<{ glyph: string; label: string; active?: boolean }>) {
  return (
    <View style={[styles.railItem, active && styles.railItemActive]}>
      <Text style={[styles.railGlyph, active && styles.railTextActive]}>{glyph}</Text>
      <Text style={[styles.railLabel, active && styles.railTextActive]}>{label}</Text>
    </View>
  );
}

type ManuscriptTreeProps = Readonly<{
  book: ProjectNavigatorBook;
  selectedSceneId?: SceneId;
  onSelectScene(sceneId: SceneId): void;
}>;

function SceneNavigationRow({
  scene,
  selected,
  onSelect
}: Readonly<{
  scene: ProjectNavigatorScene;
  selected: boolean;
  onSelect(): void;
}>) {
  const statusStyle =
    scene.status === "complete"
      ? styles.sceneStatusComplete
      : scene.status === "planned"
        ? styles.sceneStatusPlanned
        : styles.sceneStatusDrafting;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onSelect}
      style={({ pressed }) => [
        styles.sceneNavRow,
        selected && styles.sceneNavRowActive,
        pressed && styles.pressed
      ]}
    >
      <View style={[styles.sceneStatusDot, statusStyle]} />
      <Text
        numberOfLines={1}
        style={[styles.sceneNavText, selected && styles.sceneNavTextActive]}
      >
        {scene.title}
      </Text>
    </Pressable>
  );
}

function ManuscriptTree({
  book,
  selectedSceneId,
  onSelectScene
}: ManuscriptTreeProps) {
  return (
    <>
      {book.parts.map((part) => (
        <View key={part.id}>
          <Text style={styles.navGroup}>{part.title}</Text>
          {part.chapters.map((chapter) => (
            <View key={chapter.id}>
              <View style={styles.chapterRow}>
                <Text style={styles.chapterTitle}>{chapter.title}</Text>
                <View style={styles.countBadge}>
                  <Text style={styles.countText}>{chapter.scenes.length}</Text>
                </View>
              </View>
              {chapter.scenes.map((scene) => (
                <SceneNavigationRow
                  key={scene.id}
                  onSelect={() => onSelectScene(scene.id)}
                  scene={scene}
                  selected={scene.id === selectedSceneId}
                />
              ))}
            </View>
          ))}
        </View>
      ))}
      {book.unassignedScenes.length > 0 ? (
        <View>
          <Text style={styles.navGroup}>Unscheduled</Text>
          {book.unassignedScenes.map((scene) => (
            <SceneNavigationRow
              key={scene.id}
              onSelect={() => onSelectScene(scene.id)}
              scene={scene}
              selected={scene.id === selectedSceneId}
            />
          ))}
        </View>
      ) : null}
    </>
  );
}

export function ProjectNavigatorScreen({ project }: ProjectNavigatorScreenProps) {
  const { width } = useWindowDimensions();
  const compact = width < 760;
  const showInspector = width >= 1180;
  const firstBook = project.books[0];
  const [selectedBookId, setSelectedBookId] = useState<BookId | undefined>(firstBook?.id);
  const [selectedSceneId, setSelectedSceneId] = useState<SceneId | undefined>(
    firstBook === undefined ? undefined : scenesForBook(firstBook)[0]?.id
  );
  const selectedBook =
    project.books.find((book) => book.id === selectedBookId) ?? firstBook;
  const selectedBookScenes = useMemo(
    () => (selectedBook === undefined ? [] : scenesForBook(selectedBook)),
    [selectedBook]
  );
  const selectedScene =
    selectedBookScenes.find((scene) => scene.id === selectedSceneId) ??
    selectedBookScenes[0];
  const pov = project.storyKnowledge.find(
    (knowledge) => knowledge.id === selectedScene?.povStoryKnowledgeId
  );

  function selectBook(book: ProjectNavigatorBook): void {
    setSelectedBookId(book.id);
    setSelectedSceneId(scenesForBook(book)[0]?.id);
  }

  if (selectedBook === undefined) {
    return (
      <View style={styles.emptyState}>
        <BrandLockup compact />
        <Text style={styles.emptyTitle}>{project.title}</Text>
        <Text style={styles.emptyCopy}>This project does not contain a book yet.</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={[styles.topbar, compact && styles.topbarCompact]}>
        <View style={styles.wordmark}>
          <Text style={styles.wordmarkText}>ghost-writer</Text>
          {!compact ? <Text style={styles.wordmarkTagline}>AI WRITING STUDIO</Text> : null}
        </View>
        {!compact ? (
          <Text numberOfLines={1} style={styles.breadcrumb}>
            {project.title} / Draft /{" "}
            <Text style={styles.breadcrumbStrong}>{selectedBook.title}</Text>
          </Text>
        ) : null}
        <View style={styles.topbarActions}>
          <View style={styles.fixtureState}>
            <View style={styles.fixtureDot} />
            <Text style={styles.fixtureText}>Read-only sample</Text>
          </View>
          {!compact ? (
            <View accessibilityLabel="Search is not available in this fixture" style={styles.searchControl}>
              <Text style={styles.searchControlText}>Search ⌘K</Text>
            </View>
          ) : null}
        </View>
      </View>

      {compact ? (
        <ScrollView
          contentContainerStyle={styles.bookTabsContent}
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.bookTabs}
        >
          {project.books.map((book, index) => {
            const selected = book.id === selectedBook.id;

            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected }}
                key={book.id}
                onPress={() => selectBook(book)}
                style={({ pressed }) => [
                  styles.bookTab,
                  selected && styles.bookTabActive,
                  pressed && styles.pressed
                ]}
              >
                <Text style={[styles.bookTabIndex, selected && styles.bookTabTextActive]}>
                  Book {index + 1}
                </Text>
                <Text
                  numberOfLines={1}
                  style={[styles.bookTabTitle, selected && styles.bookTabTextActive]}
                >
                  {book.title}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      <View style={styles.workspace}>
        {!compact ? (
          <View style={styles.rail}>
            <RailItem glyph="H" label="Home" />
            <RailItem active glyph="D" label="Draft" />
            <RailItem glyph="C" label="Canvas" />
            <RailItem glyph="S" label="Story" />
            <RailItem glyph="R" label="Review" />
            <RailItem glyph="I" label="Inbox" />
            <View style={styles.railSpacer} />
            <RailItem glyph="+" label="Capture" />
          </View>
        ) : null}

        {!compact ? (
          <View style={styles.navigator}>
            <BrandLockup />
            <View style={styles.navHeader}>
              <View>
                <Text style={styles.eyebrow}>Manuscript</Text>
                <Text numberOfLines={2} style={styles.navTitle}>
                  {selectedBook.title}
                </Text>
              </View>
              <View style={styles.countBadge}>
                <Text style={styles.countText}>{selectedBook.sceneCount}</Text>
              </View>
            </View>
            <Text style={styles.sampleNotice}>Sample hierarchy · changes are disabled</Text>
            <ScrollView
              contentContainerStyle={styles.navigatorScrollContent}
              showsVerticalScrollIndicator={false}
            >
              <Text style={styles.navGroup}>Books</Text>
              {project.books.map((book, index) => {
                const selected = book.id === selectedBook.id;

                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    key={book.id}
                    onPress={() => selectBook(book)}
                    style={({ pressed }) => [
                      styles.bookNavRow,
                      selected && styles.bookNavRowActive,
                      pressed && styles.pressed
                    ]}
                  >
                    <View style={styles.bookNumber}>
                      <Text style={styles.bookNumberText}>{index + 1}</Text>
                    </View>
                    <View style={styles.bookNavCopy}>
                      <Text
                        numberOfLines={1}
                        style={[
                          styles.bookNavTitle,
                          selected && styles.bookNavTitleActive
                        ]}
                      >
                        {book.title}
                      </Text>
                      <Text style={styles.bookNavMeta}>
                        {book.sceneCount} scenes · {titleCase(book.status)}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
              <ManuscriptTree
                book={selectedBook}
                onSelectScene={setSelectedSceneId}
                selectedSceneId={selectedScene?.id}
              />
            </ScrollView>
          </View>
        ) : null}

        <ScrollView
          contentContainerStyle={[
            styles.mainContent,
            compact && styles.mainContentCompact
          ]}
          showsVerticalScrollIndicator={false}
          style={styles.main}
        >
          {compact ? <BrandLockup compact /> : null}

          <View style={styles.workspaceHeader}>
            <View style={styles.workspaceHeaderCopy}>
              <Text style={styles.eyebrow}>Draft · sample project</Text>
              <Text style={styles.projectTitle}>{project.title}</Text>
              <Text style={styles.projectSubtitle}>
                {selectedBook.title} · {selectedBook.sceneCount} scenes
              </Text>
            </View>
            <StatusPill status={selectedBook.status} />
          </View>

          {compact ? (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View>
                  <Text style={styles.eyebrow}>Manuscript</Text>
                  <Text style={styles.cardTitle}>{selectedBook.title}</Text>
                </View>
                <Text style={styles.cardMeta}>{selectedBook.sceneCount} scenes</Text>
              </View>
              <ManuscriptTree
                book={selectedBook}
                onSelectScene={setSelectedSceneId}
                selectedSceneId={selectedScene?.id}
              />
            </View>
          ) : null}

          {selectedScene !== undefined ? (
            <View style={styles.documentPage}>
              <View style={styles.documentHeader}>
                <View style={styles.documentTitleWrap}>
                  <Text style={styles.documentKicker}>Selected scene</Text>
                  <Text style={styles.sceneTitle}>{selectedScene.title}</Text>
                </View>
                <StatusPill status={selectedScene.status} />
              </View>
              <Text style={styles.sceneSummary}>
                {selectedScene.summary ?? "No scene summary has been added."}
              </Text>
              <View style={styles.editorPlaceholder}>
                <Text style={styles.editorPlaceholderMark}>✦</Text>
                <Text style={styles.editorPlaceholderTitle}>The writing surface comes next.</Text>
                <Text style={styles.editorPlaceholderCopy}>
                  This slice proves the shared scene hierarchy. A versioned Tiptap document,
                  server acknowledgement, and collaboration arrive in their accepted plans.
                </Text>
              </View>
              <View style={styles.documentFooter}>
                <Text style={styles.sceneMeta}>
                  {pov === undefined ? "POV open" : `POV · ${pov.label}`}
                </Text>
                <Text style={styles.sceneMeta}>Read-only fixture</Text>
              </View>
            </View>
          ) : (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>No scenes yet</Text>
              <Text style={styles.cardCopy}>
                This book has a valid empty manuscript and is ready for its first scene.
              </Text>
            </View>
          )}

          <View style={[styles.twoColumn, compact && styles.oneColumn]}>
            <View style={[styles.card, styles.flexCard]}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>Reading structure</Text>
                <Text style={styles.cardMeta}>Canonical order</Text>
              </View>
              {selectedBook.parts.map((part) => (
                <View key={part.id} style={styles.structurePart}>
                  <Text style={styles.structurePartTitle}>{part.title}</Text>
                  {part.chapters.map((chapter) => (
                    <View key={chapter.id} style={styles.structureChapter}>
                      <Text style={styles.structureChapterTitle}>{chapter.title}</Text>
                      <Text style={styles.structureChapterMeta}>
                        {chapter.scenes.length}{" "}
                        {chapter.scenes.length === 1 ? "scene" : "scenes"}
                      </Text>
                    </View>
                  ))}
                </View>
              ))}
            </View>

            <View style={[styles.card, styles.flexCard]}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>Named editions</Text>
                <Text style={styles.cardMeta}>Reference only</Text>
              </View>
              {selectedBook.editions.length > 0 ? (
                selectedBook.editions.map((edition) => (
                  <View key={edition.id} style={styles.editionRow}>
                    <View style={styles.editionMark}>
                      <Text style={styles.editionMarkText}>E</Text>
                    </View>
                    <View style={styles.editionCopy}>
                      <Text style={styles.editionTitle}>{edition.name}</Text>
                      <Text style={styles.editionMeta}>
                        {edition.sceneCount} preserved scene revisions
                      </Text>
                    </View>
                  </View>
                ))
              ) : (
                <Text style={styles.cardCopy}>
                  No named edition yet. Revision behavior is intentionally deferred.
                </Text>
              )}
            </View>
          </View>

          {!showInspector ? (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>Scene context</Text>
                <Text style={styles.cardMeta}>Project-wide sample</Text>
              </View>
              {project.storyKnowledge.map((knowledge) => (
                <View key={knowledge.id} style={styles.knowledgeRow}>
                  <View style={styles.knowledgeCopy}>
                    <Text style={styles.knowledgeTitle}>{knowledge.label}</Text>
                    <Text style={styles.knowledgeMeta}>
                      {titleCase(knowledge.kind)} · {knowledge.linkedSceneCount} linked scenes
                    </Text>
                  </View>
                  <AuthorityPill authority={knowledge.authority} />
                </View>
              ))}
            </View>
          ) : null}
        </ScrollView>

        {showInspector ? (
          <View style={styles.inspector}>
            <View style={styles.inspectorHeader}>
              <View>
                <Text style={styles.eyebrow}>Selected · scene</Text>
                <Text style={styles.inspectorTitle}>
                  {selectedScene?.title ?? "No scene selected"}
                </Text>
              </View>
              <View style={styles.closeControl}>
                <Text style={styles.closeControlText}>×</Text>
              </View>
            </View>
            <ScrollView
              contentContainerStyle={styles.inspectorScrollContent}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.inspectorSection}>
                <Text style={styles.inspectorSectionTitle}>Scene brief</Text>
                <Text style={styles.inspectorCopy}>
                  {selectedScene?.summary ?? "No scene brief has been added."}
                </Text>
                <View style={styles.inspectorPov}>
                  <Text style={styles.inspectorLabel}>Point of view</Text>
                  <Text style={styles.inspectorValue}>{pov?.label ?? "Open"}</Text>
                </View>
              </View>
              <View style={styles.inspectorSection}>
                <View style={styles.inspectorSectionHeader}>
                  <Text style={styles.inspectorSectionTitle}>Project story</Text>
                  <Text style={styles.inspectorLabel}>Shared across books</Text>
                </View>
                {project.storyKnowledge.map((knowledge) => (
                  <View key={knowledge.id} style={styles.inspectorKnowledgeRow}>
                    <View style={styles.knowledgeAvatar}>
                      <Text style={styles.knowledgeAvatarText}>
                        {knowledge.label.charAt(0)}
                      </Text>
                    </View>
                    <View style={styles.knowledgeCopy}>
                      <Text style={styles.knowledgeTitle}>{knowledge.label}</Text>
                      <Text style={styles.knowledgeMeta}>{titleCase(knowledge.kind)}</Text>
                    </View>
                    <AuthorityPill authority={knowledge.authority} />
                  </View>
                ))}
              </View>
              <View style={styles.fixtureNote}>
                <Text style={styles.fixtureNoteTitle}>Sample project</Text>
                <Text style={styles.fixtureNoteCopy}>
                  Selection works; editing, save state, Canvas, and collaboration are not
                  represented in this fixture.
                </Text>
              </View>
            </ScrollView>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: colors.canvas,
    flex: 1,
    minHeight: 0
  },
  topbar: {
    alignItems: "center",
    backgroundColor: colors.topbar,
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 18,
    height: shell.topbarHeight,
    paddingHorizontal: 14
  },
  topbarCompact: {
    justifyContent: "space-between",
    paddingHorizontal: 12
  },
  wordmark: {
    alignItems: "center",
    flexDirection: "row",
    gap: 11,
    minWidth: 220
  },
  wordmarkText: {
    color: colors.brandDark,
    fontFamily: fonts.brand,
    fontSize: 25,
    lineHeight: 31
  },
  wordmarkTagline: {
    color: colors.brandRule,
    fontFamily: fonts.uiSemibold,
    fontSize: 7,
    letterSpacing: 1.6
  },
  breadcrumb: {
    color: colors.muted,
    flex: 1,
    fontFamily: fonts.ui,
    fontSize: 11
  },
  breadcrumbStrong: {
    color: colors.ink,
    fontFamily: fonts.uiSemibold
  },
  topbarActions: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8
  },
  fixtureState: {
    alignItems: "center",
    backgroundColor: colors.amberSoft,
    borderRadius: 999,
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 5
  },
  fixtureDot: {
    backgroundColor: colors.amber,
    borderRadius: 999,
    height: 6,
    width: 6
  },
  fixtureText: {
    color: colors.amber,
    fontFamily: fonts.uiSemibold,
    fontSize: 9
  },
  searchControl: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 6
  },
  searchControlText: {
    color: colors.muted,
    fontFamily: fonts.uiMedium,
    fontSize: 9
  },
  workspace: {
    flex: 1,
    flexDirection: "row",
    minHeight: 0
  },
  rail: {
    backgroundColor: colors.rail,
    gap: 7,
    paddingHorizontal: 6,
    paddingVertical: 10,
    width: shell.railWidth
  },
  railItem: {
    alignItems: "center",
    borderColor: "transparent",
    borderRadius: 7,
    borderWidth: 1,
    gap: 2,
    justifyContent: "center",
    minHeight: 40
  },
  railItemActive: {
    backgroundColor: colors.railActive,
    borderColor: "#5c5048"
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
  railTextActive: {
    color: "#ffffff"
  },
  railSpacer: {
    flex: 1
  },
  navigator: {
    backgroundColor: "#f8f5ef",
    borderRightColor: colors.line,
    borderRightWidth: 1,
    paddingHorizontal: 12,
    paddingTop: 10,
    width: shell.navigatorWidth
  },
  brandLockup: {
    alignItems: "center",
    backgroundColor: "#fffefa",
    borderColor: colors.documentLine,
    borderRadius: 8,
    borderWidth: 1,
    height: 108,
    justifyContent: "center",
    marginBottom: 14,
    overflow: "hidden"
  },
  brandLockupCompact: {
    alignSelf: "center",
    height: 132,
    marginBottom: 4,
    maxWidth: 520,
    width: "100%"
  },
  brandLockupImage: {
    height: 108,
    width: 144
  },
  brandLockupImageCompact: {
    height: 132,
    width: 176
  },
  navHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between"
  },
  eyebrow: {
    color: colors.kicker,
    fontFamily: fonts.uiSemibold,
    fontSize: 8,
    letterSpacing: 1.5,
    textTransform: "uppercase"
  },
  navTitle: {
    color: colors.ink,
    fontFamily: fonts.story,
    fontSize: 17,
    lineHeight: 20,
    marginTop: 2,
    maxWidth: 188
  },
  sampleNotice: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 9,
    marginTop: 8
  },
  navigatorScrollContent: {
    paddingBottom: 28
  },
  navGroup: {
    color: colors.muted,
    fontFamily: fonts.uiSemibold,
    fontSize: 8,
    letterSpacing: 1,
    marginBottom: 5,
    marginHorizontal: 7,
    marginTop: 15,
    textTransform: "uppercase"
  },
  bookNavRow: {
    alignItems: "center",
    borderRadius: 7,
    flexDirection: "row",
    gap: 8,
    marginVertical: 2,
    padding: 7
  },
  bookNavRowActive: {
    backgroundColor: colors.accentSoft
  },
  bookNumber: {
    alignItems: "center",
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 6,
    borderWidth: 1,
    height: 27,
    justifyContent: "center",
    width: 27
  },
  bookNumberText: {
    color: colors.kicker,
    fontFamily: fonts.story,
    fontSize: 12
  },
  bookNavCopy: {
    flex: 1,
    minWidth: 0
  },
  bookNavTitle: {
    color: colors.ink,
    fontFamily: fonts.uiSemibold,
    fontSize: 10
  },
  bookNavTitleActive: {
    color: colors.kicker
  },
  bookNavMeta: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 8,
    marginTop: 2
  },
  chapterRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 7,
    paddingVertical: 5
  },
  chapterTitle: {
    color: colors.ink,
    fontFamily: fonts.uiSemibold,
    fontSize: 10
  },
  countBadge: {
    backgroundColor: "#e9e3db",
    borderRadius: 999,
    paddingHorizontal: 5,
    paddingVertical: 2
  },
  countText: {
    color: colors.muted,
    fontFamily: fonts.uiSemibold,
    fontSize: 8
  },
  sceneNavRow: {
    alignItems: "center",
    borderRadius: 6,
    flexDirection: "row",
    gap: 7,
    marginVertical: 1,
    paddingHorizontal: 10,
    paddingVertical: 6
  },
  sceneNavRowActive: {
    backgroundColor: colors.accentSoft
  },
  sceneNavText: {
    color: colors.muted,
    flex: 1,
    fontFamily: fonts.ui,
    fontSize: 10
  },
  sceneNavTextActive: {
    color: colors.kicker,
    fontFamily: fonts.uiSemibold
  },
  sceneStatusDot: {
    borderRadius: 999,
    height: 6,
    width: 6
  },
  sceneStatusComplete: {
    backgroundColor: colors.green
  },
  sceneStatusDrafting: {
    backgroundColor: colors.blue
  },
  sceneStatusPlanned: {
    backgroundColor: colors.amber
  },
  pressed: {
    opacity: 0.72
  },
  main: {
    backgroundColor: colors.canvas,
    flex: 1
  },
  mainContent: {
    gap: 14,
    marginHorizontal: "auto",
    maxWidth: 940,
    padding: 22,
    width: "100%"
  },
  mainContentCompact: {
    padding: 13
  },
  workspaceHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 14,
    justifyContent: "space-between"
  },
  workspaceHeaderCopy: {
    flex: 1
  },
  projectTitle: {
    color: colors.ink,
    fontFamily: fonts.story,
    fontSize: 32,
    lineHeight: 37,
    marginTop: 3
  },
  projectSubtitle: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 11,
    marginTop: 3
  },
  pill: {
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 3
  },
  pillText: {
    fontFamily: fonts.uiSemibold,
    fontSize: 8
  },
  pillConfirmed: {
    backgroundColor: colors.greenSoft
  },
  pillConfirmedText: {
    color: colors.green
  },
  pillPlanned: {
    backgroundColor: colors.amberSoft
  },
  pillPlannedText: {
    color: colors.amber
  },
  pillInferred: {
    backgroundColor: colors.blueSoft
  },
  pillInferredText: {
    color: colors.blue
  },
  pillDisputed: {
    backgroundColor: colors.redSoft
  },
  pillDisputedText: {
    color: colors.red
  },
  documentPage: {
    backgroundColor: colors.paper,
    borderColor: colors.documentLine,
    borderRadius: 5,
    borderWidth: 1,
    minHeight: 430,
    paddingHorizontal: 34,
    paddingVertical: 30
  },
  documentHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between"
  },
  documentTitleWrap: {
    flex: 1
  },
  documentKicker: {
    color: colors.kicker,
    fontFamily: fonts.uiSemibold,
    fontSize: 8,
    letterSpacing: 1.5,
    textTransform: "uppercase"
  },
  sceneTitle: {
    color: colors.ink,
    fontFamily: fonts.story,
    fontSize: 31,
    lineHeight: 36,
    marginTop: 4
  },
  sceneSummary: {
    color: colors.ink,
    fontFamily: fonts.storyItalic,
    fontSize: 20,
    lineHeight: 29,
    marginTop: 26,
    maxWidth: 670
  },
  editorPlaceholder: {
    alignItems: "center",
    borderColor: colors.line,
    borderRadius: 8,
    borderStyle: "dashed",
    borderWidth: 1,
    marginTop: 34,
    paddingHorizontal: 22,
    paddingVertical: 28
  },
  editorPlaceholderMark: {
    color: colors.brandRule,
    fontSize: 15
  },
  editorPlaceholderTitle: {
    color: colors.ink,
    fontFamily: fonts.story,
    fontSize: 18,
    marginTop: 6
  },
  editorPlaceholderCopy: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 10,
    lineHeight: 16,
    marginTop: 6,
    maxWidth: 470,
    textAlign: "center"
  },
  documentFooter: {
    borderTopColor: colors.line,
    borderTopWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "space-between",
    marginTop: 30,
    paddingTop: 12
  },
  sceneMeta: {
    color: colors.muted,
    fontFamily: fonts.uiMedium,
    fontSize: 9
  },
  twoColumn: {
    flexDirection: "row",
    gap: 12
  },
  oneColumn: {
    flexDirection: "column"
  },
  card: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 8,
    borderWidth: 1,
    padding: 14
  },
  flexCard: {
    flex: 1
  },
  cardHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
    marginBottom: 9
  },
  cardTitle: {
    color: colors.ink,
    fontFamily: fonts.uiSemibold,
    fontSize: 12
  },
  cardMeta: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 8
  },
  cardCopy: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 10,
    lineHeight: 16
  },
  structurePart: {
    borderTopColor: colors.line,
    borderTopWidth: 1,
    paddingVertical: 9
  },
  structurePartTitle: {
    color: colors.kicker,
    fontFamily: fonts.uiSemibold,
    fontSize: 8,
    letterSpacing: 1,
    textTransform: "uppercase"
  },
  structureChapter: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 7
  },
  structureChapterTitle: {
    color: colors.ink,
    fontFamily: fonts.uiMedium,
    fontSize: 10
  },
  structureChapterMeta: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 8
  },
  editionRow: {
    alignItems: "center",
    borderTopColor: colors.line,
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 9,
    paddingVertical: 9
  },
  editionMark: {
    alignItems: "center",
    backgroundColor: colors.accentSoft,
    borderRadius: 7,
    height: 30,
    justifyContent: "center",
    width: 30
  },
  editionMarkText: {
    color: colors.kicker,
    fontFamily: fonts.story,
    fontSize: 12
  },
  editionCopy: {
    flex: 1
  },
  editionTitle: {
    color: colors.ink,
    fontFamily: fonts.uiSemibold,
    fontSize: 10
  },
  editionMeta: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 8,
    marginTop: 2
  },
  knowledgeRow: {
    alignItems: "center",
    borderTopColor: colors.line,
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 9,
    justifyContent: "space-between",
    paddingVertical: 9
  },
  knowledgeCopy: {
    flex: 1
  },
  knowledgeTitle: {
    color: colors.ink,
    fontFamily: fonts.uiSemibold,
    fontSize: 10
  },
  knowledgeMeta: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 8,
    lineHeight: 13,
    marginTop: 2
  },
  inspector: {
    backgroundColor: "#fcfbf8",
    borderLeftColor: colors.line,
    borderLeftWidth: 1,
    paddingHorizontal: 14,
    paddingTop: 15,
    width: shell.inspectorWidth
  },
  inspectorHeader: {
    alignItems: "flex-start",
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between",
    paddingBottom: 13
  },
  inspectorTitle: {
    color: colors.ink,
    fontFamily: fonts.story,
    fontSize: 18,
    lineHeight: 22,
    marginTop: 3,
    maxWidth: 210
  },
  closeControl: {
    alignItems: "center",
    borderColor: colors.line,
    borderRadius: 6,
    borderWidth: 1,
    height: 27,
    justifyContent: "center",
    width: 27
  },
  closeControlText: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 15
  },
  inspectorScrollContent: {
    paddingBottom: 28
  },
  inspectorSection: {
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    paddingVertical: 13
  },
  inspectorSectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between"
  },
  inspectorSectionTitle: {
    color: colors.ink,
    fontFamily: fonts.uiSemibold,
    fontSize: 10
  },
  inspectorCopy: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 10,
    lineHeight: 16,
    marginTop: 7
  },
  inspectorPov: {
    backgroundColor: colors.wash,
    borderRadius: 7,
    marginTop: 10,
    padding: 10
  },
  inspectorLabel: {
    color: colors.muted,
    fontFamily: fonts.uiMedium,
    fontSize: 8
  },
  inspectorValue: {
    color: colors.ink,
    fontFamily: fonts.story,
    fontSize: 15,
    marginTop: 2
  },
  inspectorKnowledgeRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    paddingTop: 10
  },
  knowledgeAvatar: {
    alignItems: "center",
    backgroundColor: colors.accentSoft,
    borderRadius: 999,
    height: 28,
    justifyContent: "center",
    width: 28
  },
  knowledgeAvatarText: {
    color: colors.kicker,
    fontFamily: fonts.story,
    fontSize: 11
  },
  fixtureNote: {
    backgroundColor: colors.amberSoft,
    borderRadius: 8,
    marginTop: 13,
    padding: 11
  },
  fixtureNoteTitle: {
    color: colors.amber,
    fontFamily: fonts.uiSemibold,
    fontSize: 9
  },
  fixtureNoteCopy: {
    color: colors.amber,
    fontFamily: fonts.ui,
    fontSize: 9,
    lineHeight: 14,
    marginTop: 3
  },
  bookTabs: {
    backgroundColor: "#f8f5ef",
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    flexGrow: 0
  },
  bookTabsContent: {
    gap: 7,
    paddingHorizontal: 11,
    paddingVertical: 8
  },
  bookTab: {
    borderColor: colors.line,
    borderRadius: 7,
    borderWidth: 1,
    maxWidth: 220,
    minWidth: 150,
    paddingHorizontal: 10,
    paddingVertical: 7
  },
  bookTabActive: {
    backgroundColor: colors.brandDark,
    borderColor: colors.brandDark
  },
  bookTabIndex: {
    color: colors.muted,
    fontFamily: fonts.uiSemibold,
    fontSize: 7,
    letterSpacing: 1,
    textTransform: "uppercase"
  },
  bookTabTitle: {
    color: colors.ink,
    fontFamily: fonts.uiSemibold,
    fontSize: 10,
    marginTop: 2
  },
  bookTabTextActive: {
    color: "#ffffff"
  },
  emptyState: {
    alignItems: "center",
    backgroundColor: colors.paper,
    flex: 1,
    justifyContent: "center",
    padding: 32
  },
  emptyTitle: {
    color: colors.ink,
    fontFamily: fonts.story,
    fontSize: 30
  },
  emptyCopy: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 11,
    marginTop: 7
  }
});
