import type {
  BookReaderChapter,
  BookReaderProjection,
  BookReaderSceneEntry,
  BookReaderSceneLink,
  ChapterId,
  SceneId
} from "@ghostwriter/core";
import {
  bookReaderChapterStartSpreadIndex,
  bookReaderSpreadIndexForScene,
  buildBookReaderSpreads,
  paginateBookReaderProjection
} from "@ghostwriter/core";
import type { SceneBlockV1, SceneInlineNodeV1 } from "@ghostwriter/editor";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View
} from "react-native";
import { ghostwriterTheme } from "./theme.js";

const { colors, fonts } = ghostwriterTheme;

export type BookReaderPanelProps = Readonly<{
  projection?: BookReaderProjection;
  busy?: boolean;
  error?: string;
  onExit(): void;
}>;

function inlineText(nodes: readonly SceneInlineNodeV1[] | undefined): string {
  if (nodes === undefined) return "";
  return nodes
    .map((node) => (node.type === "text" ? node.text : "\n"))
    .join("");
}

function BlockView({ block }: Readonly<{ block: SceneBlockV1 }>) {
  if (block.type === "heading") {
    return (
      <Text
        accessibilityRole="header"
        style={[
          styles.heading,
          block.attrs.level === 1 && styles.headingOne,
          block.attrs.level === 2 && styles.headingTwo
        ]}
      >
        {inlineText(block.content)}
      </Text>
    );
  }
  if (block.type === "horizontalRule") {
    return <View style={styles.rule} />;
  }
  if (block.type === "blockquote") {
    return (
      <View style={styles.blockquote}>
        {block.content.map((child, index) => (
          <BlockView block={child} key={`${child.attrs.id}-${index}`} />
        ))}
      </View>
    );
  }
  const text = inlineText(block.content);
  if (text.length === 0) return null;
  return <Text style={styles.paragraph}>{text}</Text>;
}

function PageContent({ blocks }: Readonly<{ blocks: readonly SceneBlockV1[] }>) {
  if (blocks.length === 0) {
    return (
      <Text style={styles.emptyPage}>
        This scene has no acknowledged prose yet.
      </Text>
    );
  }
  return (
    <>
      {blocks.map((block, index) => (
        <BlockView block={block} key={`${block.attrs.id}-${index}`} />
      ))}
    </>
  );
}

function LinksRail({
  links,
  visible
}: Readonly<{
  links: readonly BookReaderSceneLink[];
  visible: boolean;
}>) {
  if (!visible) return null;
  return (
    <View style={styles.linksRail}>
      <Text style={styles.linksTitle}>Scene links</Text>
      {links.length === 0 ? (
        <Text style={styles.linksEmpty}>No Canvas links for this spread.</Text>
      ) : (
        links.map((link) => (
          <View key={link.id} style={styles.linkCard}>
            <Text style={styles.linkKind}>
              {link.direction} · {link.kind}
            </Text>
            <Text style={styles.linkPeer}>{link.peerLabel}</Text>
            {link.label === undefined ? null : (
              <Text style={styles.linkLabel}>{link.label}</Text>
            )}
          </View>
        ))
      )}
    </View>
  );
}

function sceneLinksForSpread(
  projection: BookReaderProjection,
  spreadIndex: number,
  pages: ReturnType<typeof paginateBookReaderProjection>
): readonly BookReaderSceneLink[] {
  const spread = buildBookReaderSpreads(pages)[spreadIndex];
  const sceneIds = new Set<SceneId>();
  for (const page of [spread?.left, spread?.right]) {
    if (page === undefined) continue;
    for (const block of page.blocks) sceneIds.add(block.sceneId);
  }
  const links: BookReaderSceneLink[] = [];
  for (const scene of projection.scenes) {
    if (!sceneIds.has(scene.sceneId)) continue;
    links.push(...scene.links);
  }
  return links;
}

function WideReader({
  projection,
  onExit
}: Readonly<{
  projection: BookReaderProjection;
  onExit(): void;
}>) {
  const pages = useMemo(
    () => paginateBookReaderProjection(projection),
    [projection]
  );
  const spreads = useMemo(() => buildBookReaderSpreads(pages), [pages]);
  const [spreadIndex, setSpreadIndex] = useState(() =>
    projection.pinSceneId === undefined
      ? 0
      : bookReaderSpreadIndexForScene(pages, projection.pinSceneId)
  );
  const [linksVisible, setLinksVisible] = useState(false);
  const [selectedChapterId, setSelectedChapterId] = useState<
    ChapterId | "unassigned" | undefined
  >(projection.chapters[0]?.id);
  const spread = spreads[spreadIndex] ?? spreads[0];
  const links = sceneLinksForSpread(projection, spreadIndex, pages);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "ArrowLeft") {
        setSpreadIndex((current) => Math.max(0, current - 1));
      }
      if (event.key === "ArrowRight") {
        setSpreadIndex((current) => Math.min(spreads.length - 1, current + 1));
      }
      if (event.key === "Escape") onExit();
    };
    if (typeof globalThis.addEventListener === "function") {
      globalThis.addEventListener("keydown", onKeyDown);
      return () => globalThis.removeEventListener("keydown", onKeyDown);
    }
    return undefined;
  }, [onExit, spreads.length]);

  return (
    <View style={styles.readerScreen}>
      <View style={styles.readerTopbar}>
        <Pressable accessibilityRole="button" onPress={onExit} style={styles.exitButton}>
          <Text style={styles.exitButtonText}>Exit reader</Text>
        </Pressable>
        <View style={styles.readerHeading}>
          <Text style={styles.readerEyebrow}>Book reader</Text>
          <Text style={styles.readerTitle}>{projection.bookTitle}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: linksVisible }}
          onPress={() => setLinksVisible((current) => !current)}
          style={[styles.toggleButton, linksVisible && styles.toggleButtonSelected]}
        >
          <Text
            style={[
              styles.toggleButtonText,
              linksVisible && styles.toggleButtonTextSelected
            ]}
          >
            Links
          </Text>
        </Pressable>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chapterTabs}
      >
        {projection.chapters.map((chapter: BookReaderChapter) => (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: selectedChapterId === chapter.id }}
            key={chapter.id}
            onPress={() => {
              setSelectedChapterId(chapter.id);
              setSpreadIndex(bookReaderChapterStartSpreadIndex(pages, chapter.id));
            }}
            style={[
              styles.chapterTab,
              selectedChapterId === chapter.id && styles.chapterTabSelected
            ]}
          >
            <Text
              style={[
                styles.chapterTabText,
                selectedChapterId === chapter.id && styles.chapterTabTextSelected
              ]}
            >
              {chapter.title}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      <View style={styles.spreadRegion}>
        <Text style={styles.runningHeader}>
          {spread?.left?.runningHeader ?? spread?.right?.runningHeader ?? projection.bookTitle}
        </Text>
        <View style={styles.spread}>
          <View style={[styles.page, styles.pageLeft]}>
            <PageContent
              blocks={(spread?.left?.blocks ?? []).map((entry) => entry.block)}
            />
          </View>
          <View style={styles.spine} />
          <View style={[styles.page, styles.pageRight]}>
            <PageContent
              blocks={(spread?.right?.blocks ?? []).map((entry) => entry.block)}
            />
          </View>
        </View>
        <LinksRail links={links} visible={linksVisible} />
      </View>

      <View style={styles.readerFooter}>
        <Pressable
          accessibilityRole="button"
          disabled={spreadIndex <= 0}
          onPress={() => setSpreadIndex((current) => Math.max(0, current - 1))}
          style={[styles.navButton, spreadIndex <= 0 && styles.navButtonDisabled]}
        >
          <Text style={styles.navButtonText}>Previous</Text>
        </Pressable>
        <Text style={styles.progress}>
          Spread {spreadIndex + 1} of {spreads.length}
        </Text>
        <Pressable
          accessibilityRole="button"
          disabled={spreadIndex >= spreads.length - 1}
          onPress={() =>
            setSpreadIndex((current) => Math.min(spreads.length - 1, current + 1))
          }
          style={[
            styles.navButton,
            spreadIndex >= spreads.length - 1 && styles.navButtonDisabled
          ]}
        >
          <Text style={styles.navButtonText}>Next</Text>
        </Pressable>
      </View>
    </View>
  );
}

function NarrowReader({
  projection,
  onExit
}: Readonly<{
  projection: BookReaderProjection;
  onExit(): void;
}>) {
  const scrollRef = useRef<ScrollView>(null);
  const landmarkOffsets = useRef(new Map<string, number>());
  const [sceneIndex, setSceneIndex] = useState(() => {
    if (projection.pinSceneId === undefined) return 0;
    const index = projection.scenes.findIndex(
      (scene) => scene.sceneId === projection.pinSceneId
    );
    return index < 0 ? 0 : index;
  });

  const currentScene = projection.scenes[sceneIndex];

  return (
    <View style={styles.readerScreen}>
      <View style={styles.readerTopbar}>
        <Pressable accessibilityRole="button" onPress={onExit} style={styles.exitButton}>
          <Text style={styles.exitButtonText}>Exit reader</Text>
        </Pressable>
        <View style={styles.readerHeading}>
          <Text style={styles.readerEyebrow}>Book reader</Text>
          <Text style={styles.readerTitle}>{projection.bookTitle}</Text>
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chapterTabs}
      >
        {projection.chapters.map((chapter) => (
          <Pressable
            accessibilityRole="button"
            key={chapter.id}
            onPress={() => {
              const offset = landmarkOffsets.current.get(chapter.id);
              if (offset !== undefined) {
                scrollRef.current?.scrollTo({ y: offset, animated: true });
              }
            }}
            style={styles.chapterTab}
          >
            <Text style={styles.chapterTabText}>{chapter.title}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <ScrollView ref={scrollRef} style={styles.narrowScroll}>
        {projection.chapters.map((chapter) => {
          const chapterScenes = projection.scenes.filter((scene) =>
            chapter.sceneIds.includes(scene.sceneId)
          );
          return (
            <View
              key={chapter.id}
              onLayout={(event) => {
                landmarkOffsets.current.set(chapter.id, event.nativeEvent.layout.y);
              }}
              style={styles.chapterLandmark}
            >
              <Text accessibilityRole="header" style={styles.chapterLandmarkTitle}>
                {chapter.title}
              </Text>
              {chapterScenes.map((scene: BookReaderSceneEntry) => (
                <View key={scene.sceneId} style={styles.sceneLandmark}>
                  <Text style={styles.sceneLandmarkTitle}>{scene.title}</Text>
                  {scene.document.document.content.map((block, index) => (
                    <BlockView block={block} key={`${block.attrs.id}-${index}`} />
                  ))}
                  {scene.links.length > 0 ? (
                    <View style={styles.narrowLinks}>
                      <Text style={styles.linksTitle}>Links</Text>
                      {scene.links.map((link) => (
                        <Text key={link.id} style={styles.narrowLinkLine}>
                          {link.direction} {link.kind}: {link.peerLabel}
                        </Text>
                      ))}
                    </View>
                  ) : null}
                </View>
              ))}
            </View>
          );
        })}
      </ScrollView>

      <View style={styles.readerFooter}>
        <Pressable
          accessibilityRole="button"
          disabled={sceneIndex <= 0}
          onPress={() => setSceneIndex((current) => Math.max(0, current - 1))}
          style={[styles.navButton, sceneIndex <= 0 && styles.navButtonDisabled]}
        >
          <Text style={styles.navButtonText}>Previous scene</Text>
        </Pressable>
        <Text style={styles.progress}>
          Scene {sceneIndex + 1} of {projection.scenes.length}
        </Text>
        <Pressable
          accessibilityRole="button"
          disabled={sceneIndex >= projection.scenes.length - 1}
          onPress={() =>
            setSceneIndex((current) =>
              Math.min(projection.scenes.length - 1, current + 1)
            )
          }
          style={[
            styles.navButton,
            sceneIndex >= projection.scenes.length - 1 && styles.navButtonDisabled
          ]}
        >
          <Text style={styles.navButtonText}>Next scene</Text>
        </Pressable>
      </View>
      {currentScene === undefined ? null : (
        <Text style={styles.narrowCurrentScene}>Reading {currentScene.title}</Text>
      )}
    </View>
  );
}

export function BookReaderPanel({
  projection,
  busy = false,
  error,
  onExit
}: BookReaderPanelProps) {
  const { width } = useWindowDimensions();
  const narrow = width < 760;

  if (error !== undefined) {
    return (
      <View style={styles.readerScreen}>
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
        <Pressable accessibilityRole="button" onPress={onExit} style={styles.exitButton}>
          <Text style={styles.exitButtonText}>Exit reader</Text>
        </Pressable>
      </View>
    );
  }

  if (busy || projection === undefined) {
    return (
      <View style={styles.readerScreen}>
        <Text style={styles.loading}>Loading reader…</Text>
      </View>
    );
  }

  return narrow ? (
    <NarrowReader onExit={onExit} projection={projection} />
  ) : (
    <WideReader onExit={onExit} projection={projection} />
  );
}

const styles = StyleSheet.create({
  readerScreen: {
    backgroundColor: colors.paper,
    flex: 1,
    minHeight: 0
  },
  readerTopbar: {
    alignItems: "center",
    backgroundColor: colors.topbar,
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10
  },
  readerHeading: {
    flex: 1
  },
  readerEyebrow: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 9,
    letterSpacing: 1.1,
    textTransform: "uppercase"
  },
  readerTitle: {
    color: colors.ink,
    fontFamily: fonts.story,
    fontSize: 24
  },
  exitButton: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  exitButtonText: {
    color: colors.ink,
    fontFamily: fonts.uiSemibold,
    fontSize: 10
  },
  toggleButton: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  toggleButtonSelected: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent
  },
  toggleButtonText: {
    color: colors.ink,
    fontFamily: fonts.uiSemibold,
    fontSize: 10
  },
  toggleButtonTextSelected: {
    color: colors.accent
  },
  chapterTabs: {
    backgroundColor: colors.wash,
    maxHeight: 44
  },
  chapterTab: {
    borderBottomColor: "transparent",
    borderBottomWidth: 2,
    paddingHorizontal: 14,
    paddingVertical: 10
  },
  chapterTabSelected: {
    borderBottomColor: colors.accent
  },
  chapterTabText: {
    color: colors.muted,
    fontFamily: fonts.uiMedium,
    fontSize: 10
  },
  chapterTabTextSelected: {
    color: colors.accent
  },
  spreadRegion: {
    flex: 1,
    padding: 16
  },
  runningHeader: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 9,
    marginBottom: 8,
    textAlign: "center"
  },
  spread: {
    flex: 1,
    flexDirection: "row",
    gap: 0,
    minHeight: 360
  },
  page: {
    backgroundColor: colors.panel,
    borderColor: colors.documentLine,
    borderWidth: 1,
    flex: 1,
    padding: 24
  },
  pageLeft: {
    borderRightWidth: 0,
    borderTopRightRadius: 0,
    borderBottomRightRadius: 0
  },
  pageRight: {
    borderLeftWidth: 0,
    borderTopLeftRadius: 0,
    borderBottomLeftRadius: 0
  },
  spine: {
    backgroundColor: colors.line,
    width: 10
  },
  paragraph: {
    color: colors.ink,
    fontFamily: fonts.story,
    fontSize: 16,
    lineHeight: 26,
    marginBottom: 12
  },
  heading: {
    color: colors.ink,
    fontFamily: fonts.story,
    marginBottom: 12
  },
  headingOne: {
    fontSize: 24,
    lineHeight: 30
  },
  headingTwo: {
    fontSize: 18,
    lineHeight: 24
  },
  blockquote: {
    borderLeftColor: colors.accent,
    borderLeftWidth: 3,
    marginBottom: 12,
    paddingLeft: 12
  },
  rule: {
    backgroundColor: colors.documentLine,
    height: 1,
    marginVertical: 16
  },
  emptyPage: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 12,
    fontStyle: "italic"
  },
  linksRail: {
    backgroundColor: colors.blueSoft,
    borderColor: colors.blue,
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
    marginTop: 12,
    padding: 12
  },
  linksTitle: {
    color: colors.blue,
    fontFamily: fonts.uiSemibold,
    fontSize: 10,
    textTransform: "uppercase"
  },
  linksEmpty: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 11
  },
  linkCard: {
    gap: 2
  },
  linkKind: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 9,
    textTransform: "uppercase"
  },
  linkPeer: {
    color: colors.ink,
    fontFamily: fonts.uiMedium,
    fontSize: 11
  },
  linkLabel: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 10
  },
  readerFooter: {
    alignItems: "center",
    borderTopColor: colors.line,
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
    padding: 12
  },
  navButton: {
    backgroundColor: colors.brandDark,
    borderRadius: 6,
    minWidth: 96,
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  navButtonDisabled: {
    opacity: 0.4
  },
  navButtonText: {
    color: "#ffffff",
    fontFamily: fonts.uiSemibold,
    fontSize: 10,
    textAlign: "center"
  },
  progress: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 10
  },
  narrowScroll: {
    flex: 1,
    padding: 16
  },
  chapterLandmark: {
    marginBottom: 28
  },
  chapterLandmarkTitle: {
    color: colors.accent,
    fontFamily: fonts.story,
    fontSize: 28,
    marginBottom: 12
  },
  sceneLandmark: {
    marginBottom: 20
  },
  sceneLandmarkTitle: {
    color: colors.ink,
    fontFamily: fonts.uiSemibold,
    fontSize: 12,
    marginBottom: 8,
    textTransform: "uppercase"
  },
  narrowLinks: {
    backgroundColor: colors.wash,
    borderRadius: 8,
    gap: 4,
    marginTop: 8,
    padding: 10
  },
  narrowLinkLine: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 10
  },
  narrowCurrentScene: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 9,
    paddingBottom: 8,
    textAlign: "center"
  },
  loading: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 12,
    margin: 24
  },
  error: {
    color: colors.red,
    fontFamily: fonts.uiSemibold,
    fontSize: 12,
    margin: 24
  }
});
