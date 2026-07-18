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

export type ReaderVoicePack = "default" | "narrative" | "noir" | "soft";

export type BookReaderPanelProps = Readonly<{
  projection?: BookReaderProjection;
  busy?: boolean;
  error?: string;
  voiceError?: string;
  voicePack?: ReaderVoicePack;
  speaking?: boolean;
  onExit(): void;
  onVoicePackChange?(pack: ReaderVoicePack): void;
  onSpeak?(text: string, voicePack: ReaderVoicePack): void | Promise<void>;
  onStopSpeak?(): void;
}>;

const VOICE_PACKS: readonly ReaderVoicePack[] = [
  "default",
  "narrative",
  "noir",
  "soft"
];

function blocksToSpeechText(blocks: readonly SceneBlockV1[]): string {
  return blocks
    .map((block) => {
      if (block.type === "horizontalRule") return "";
      if (block.type === "blockquote") {
        return blocksToSpeechText(block.content);
      }
      return inlineText(block.content);
    })
    .filter((part) => part.trim().length > 0)
    .join("\n\n");
}

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

function VoiceControls({
  voicePack,
  speaking,
  disabled,
  onVoicePackChange,
  onSpeak,
  onStopSpeak,
  speechText
}: Readonly<{
  voicePack: ReaderVoicePack;
  speaking: boolean;
  disabled?: boolean;
  onVoicePackChange?(pack: ReaderVoicePack): void;
  onSpeak?(text: string, voicePack: ReaderVoicePack): void | Promise<void>;
  onStopSpeak?(): void;
  speechText: string;
}>) {
  if (onSpeak === undefined && onStopSpeak === undefined) return null;
  return (
    <View style={styles.voiceControls}>
      <Text style={styles.voiceLabel}>Voice</Text>
      <View style={styles.voicePackRow}>
        {VOICE_PACKS.map((pack) => (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: voicePack === pack }}
            disabled={disabled}
            key={pack}
            onPress={() => onVoicePackChange?.(pack)}
            style={[
              styles.voicePackButton,
              voicePack === pack && styles.voicePackButtonSelected
            ]}
          >
            <Text
              style={[
                styles.voicePackText,
                voicePack === pack && styles.voicePackTextSelected
              ]}
            >
              {pack}
            </Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.voiceActionRow}>
        <Pressable
          accessibilityRole="button"
          disabled={
            disabled ||
            speaking ||
            onSpeak === undefined ||
            speechText.trim().length === 0
          }
          onPress={() => void onSpeak?.(speechText, voicePack)}
          style={[styles.navButton, styles.voicePlayButton]}
        >
          <Text style={[styles.navButtonText, styles.voicePlayButtonText]}>
            Play
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={disabled || !speaking || onStopSpeak === undefined}
          onPress={() => onStopSpeak?.()}
          style={styles.navButton}
        >
          <Text style={styles.navButtonText}>Stop</Text>
        </Pressable>
      </View>
    </View>
  );
}

function WideReader({
  projection,
  onExit,
  voiceError,
  voicePack,
  speaking,
  onVoicePackChange,
  onSpeak,
  onStopSpeak
}: Readonly<{
  projection: BookReaderProjection;
  onExit(): void;
  voiceError?: string;
  voicePack: ReaderVoicePack;
  speaking: boolean;
  onVoicePackChange?(pack: ReaderVoicePack): void;
  onSpeak?(text: string, voicePack: ReaderVoicePack): void | Promise<void>;
  onStopSpeak?(): void;
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
  const speechText = useMemo(() => {
    const left = (spread?.left?.blocks ?? []).map((entry) => entry.block);
    const right = (spread?.right?.blocks ?? []).map((entry) => entry.block);
    return blocksToSpeechText([...left, ...right]);
  }, [spread]);

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
          <Text style={styles.readerEyebrow}>Bound reader</Text>
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

      <VoiceControls
        onSpeak={onSpeak}
        onStopSpeak={onStopSpeak}
        onVoicePackChange={onVoicePackChange}
        speaking={speaking}
        speechText={speechText}
        voicePack={voicePack}
      />
      {voiceError === undefined ? null : (
        <Text accessibilityRole="alert" style={styles.voiceError}>
          {voiceError}
        </Text>
      )}

      <View style={styles.spreadRegion}>
        <Text style={styles.runningHeader}>
          {spread?.left?.runningHeader ??
            spread?.right?.runningHeader ??
            projection.bookTitle}
        </Text>
        <View style={styles.spreadShell}>
          <View style={styles.spread}>
            <View style={[styles.page, styles.pageLeft]}>
              <PageContent
                blocks={(spread?.left?.blocks ?? []).map((entry) => entry.block)}
              />
              <Text style={[styles.pageNumber, styles.pageNumberLeft]}>
                {spread?.left === undefined ? " " : spread.left.index + 1}
              </Text>
            </View>
            <View style={styles.spine}>
              <View style={styles.spineShadow} />
            </View>
            <View style={[styles.page, styles.pageRight]}>
              <PageContent
                blocks={(spread?.right?.blocks ?? []).map((entry) => entry.block)}
              />
              <Text style={[styles.pageNumber, styles.pageNumberRight]}>
                {spread?.right === undefined ? " " : spread.right.index + 1}
              </Text>
            </View>
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
  onExit,
  voiceError,
  voicePack,
  speaking,
  onVoicePackChange,
  onSpeak,
  onStopSpeak
}: Readonly<{
  projection: BookReaderProjection;
  onExit(): void;
  voiceError?: string;
  voicePack: ReaderVoicePack;
  speaking: boolean;
  onVoicePackChange?(pack: ReaderVoicePack): void;
  onSpeak?(text: string, voicePack: ReaderVoicePack): void | Promise<void>;
  onStopSpeak?(): void;
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
  const speechText = useMemo(
    () =>
      currentScene === undefined
        ? ""
        : blocksToSpeechText(currentScene.document.document.content),
    [currentScene]
  );

  return (
    <View style={styles.readerScreen}>
      <View style={styles.readerTopbar}>
        <Pressable accessibilityRole="button" onPress={onExit} style={styles.exitButton}>
          <Text style={styles.exitButtonText}>Exit reader</Text>
        </Pressable>
        <View style={styles.readerHeading}>
          <Text style={styles.readerEyebrow}>Bound reader</Text>
          <Text style={styles.readerTitle}>{projection.bookTitle}</Text>
        </View>
      </View>

      <VoiceControls
        onSpeak={onSpeak}
        onStopSpeak={onStopSpeak}
        onVoicePackChange={onVoicePackChange}
        speaking={speaking}
        speechText={speechText}
        voicePack={voicePack}
      />
      {voiceError === undefined ? null : (
        <Text accessibilityRole="alert" style={styles.voiceError}>
          {voiceError}
        </Text>
      )}

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
  voiceError,
  voicePack = "default",
  speaking = false,
  onExit,
  onVoicePackChange,
  onSpeak,
  onStopSpeak
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
    <NarrowReader
      onExit={onExit}
      onSpeak={onSpeak}
      onStopSpeak={onStopSpeak}
      onVoicePackChange={onVoicePackChange}
      projection={projection}
      speaking={speaking}
      voiceError={voiceError}
      voicePack={voicePack}
    />
  ) : (
    <WideReader
      onExit={onExit}
      onSpeak={onSpeak}
      onStopSpeak={onStopSpeak}
      onVoicePackChange={onVoicePackChange}
      projection={projection}
      speaking={speaking}
      voiceError={voiceError}
      voicePack={voicePack}
    />
  );
}

const styles = StyleSheet.create({
  readerScreen: {
    backgroundColor: "#e8dfd0",
    flex: 1,
    minHeight: 0
  },
  readerTopbar: {
    alignItems: "center",
    backgroundColor: "#f4eee4",
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
    backgroundColor: "#efe6d8",
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
  voiceControls: {
    backgroundColor: "#f7f1e7",
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10
  },
  voiceError: {
    backgroundColor: colors.redSoft,
    color: colors.red,
    fontFamily: fonts.uiSemibold,
    fontSize: 9,
    paddingHorizontal: 16,
    paddingVertical: 8
  },
  voiceLabel: {
    color: colors.muted,
    fontFamily: fonts.uiSemibold,
    fontSize: 8,
    letterSpacing: 0.8,
    textTransform: "uppercase"
  },
  voicePackRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6
  },
  voicePackButton: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 5
  },
  voicePackButtonSelected: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent
  },
  voicePackText: {
    color: colors.muted,
    fontFamily: fonts.uiMedium,
    fontSize: 9
  },
  voicePackTextSelected: {
    color: colors.accent
  },
  voiceActionRow: {
    flexDirection: "row",
    gap: 8
  },
  voicePlayButton: {
    backgroundColor: colors.brandDark,
    borderColor: colors.brandDark
  },
  voicePlayButtonText: {
    color: "#ffffff"
  },
  spreadRegion: {
    flex: 1,
    padding: 16
  },
  runningHeader: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 9,
    letterSpacing: 0.6,
    marginBottom: 8,
    textAlign: "center",
    textTransform: "uppercase"
  },
  spreadShell: {
    flex: 1,
    minHeight: 360,
    shadowColor: "#3a2f24",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.18,
    shadowRadius: 18
  },
  spread: {
    backgroundColor: "#d9cdb8",
    borderRadius: 4,
    flex: 1,
    flexDirection: "row",
    gap: 0,
    minHeight: 360,
    overflow: "hidden"
  },
  page: {
    backgroundColor: "#f7f0e4",
    flex: 1,
    paddingBottom: 28,
    paddingHorizontal: 28,
    paddingTop: 24,
    position: "relative"
  },
  pageLeft: {
    borderRightWidth: 0
  },
  pageRight: {
    borderLeftWidth: 0
  },
  spine: {
    backgroundColor: "#c9b89f",
    position: "relative",
    width: 14
  },
  spineShadow: {
    backgroundColor: "rgba(60, 45, 30, 0.18)",
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0
  },
  pageNumber: {
    bottom: 10,
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 9,
    position: "absolute"
  },
  pageNumberLeft: {
    left: 24
  },
  pageNumberRight: {
    right: 24
  },
  paragraph: {
    color: colors.ink,
    fontFamily: fonts.story,
    fontSize: 17,
    lineHeight: 28,
    marginBottom: 14
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
