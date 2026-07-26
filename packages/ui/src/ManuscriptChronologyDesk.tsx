import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View
} from "react-native";
import type { ProjectNavigator } from "@ghostwriter/core";
import {
  manuscriptChronology,
  type ManuscriptChronologySceneBlock
} from "./manuscript-chronology.js";
import type { ManuscriptSelection } from "./manuscript-selection.js";
import { ghostwriterTheme } from "./theme.js";

const { colors, fonts } = ghostwriterTheme;

export type ManuscriptChronologyDeskProps = Readonly<{
  project: ProjectNavigator;
  selection: ManuscriptSelection;
  busy?: boolean;
  sceneProseById?: Readonly<Record<string, string>>;
  onOpenScene(selection: Extract<ManuscriptSelection, { kind: "scene" }>): void;
}>;

function withLandmarkFlags(
  scenes: readonly ManuscriptChronologySceneBlock[]
): readonly (ManuscriptChronologySceneBlock & {
  showChapterLandmark: boolean;
})[] {
  let previous: string | undefined;
  return scenes.map((block) => {
    const showChapterLandmark = block.chapterLandmark !== previous;
    previous = block.chapterLandmark;
    return { ...block, showChapterLandmark };
  });
}

function SceneBlock({
  block,
  prose,
  busy,
  showChapterLandmark,
  onOpenScene
}: Readonly<{
  block: ManuscriptChronologySceneBlock;
  prose: string;
  busy: boolean;
  showChapterLandmark: boolean;
  onOpenScene(selection: Extract<ManuscriptSelection, { kind: "scene" }>): void;
}>) {
  const body =
    prose.trim().length > 0
      ? prose
      : (block.summary ?? "No prose loaded yet for this scene.");
  return (
    <View
      accessibilityLabel={`Scene ${block.title}`}
      style={styles.sceneBlock}
    >
      {showChapterLandmark ? (
        <Text style={styles.chapterLandmark}>{block.chapterLandmark}</Text>
      ) : null}
      <View style={styles.sceneHeader}>
        <Pressable
          accessibilityLabel={`Edit scene ${block.title}`}
          accessibilityRole="button"
          disabled={busy}
          onPress={() => onOpenScene(block.selection)}
          style={({ pressed }) => [
            styles.sceneTitlePressable,
            pressed && styles.pressed
          ]}
        >
          <Text style={styles.sceneTitle}>{block.title}</Text>
        </Pressable>
        <Pressable
          accessibilityLabel={`Edit ${block.title}`}
          accessibilityRole="button"
          disabled={busy}
          onPress={() => onOpenScene(block.selection)}
          style={({ pressed }) => [
            styles.editButton,
            pressed && styles.pressed,
            busy && styles.disabled
          ]}
        >
          <Text style={styles.editButtonText}>Edit</Text>
        </Pressable>
      </View>
      <Text style={styles.sceneMeta}>
        {block.status}
        {block.povLabel === undefined ? "" : ` · POV ${block.povLabel}`}
      </Text>
      <Text style={styles.sceneBody}>{body}</Text>
    </View>
  );
}

export function ManuscriptChronologyDesk({
  project,
  selection,
  busy = false,
  sceneProseById = {},
  onOpenScene
}: ManuscriptChronologyDeskProps) {
  const projection = manuscriptChronology(project, selection);
  if (projection === undefined) return null;
  const scenes = withLandmarkFlags(projection.scenes);

  return (
    <ScrollView
      accessibilityLabel="Manuscript chronology"
      contentContainerStyle={styles.content}
      style={styles.root}
    >
      <View style={styles.header}>
        <Text style={styles.eyebrow}>{projection.eyebrow}</Text>
        <Text style={styles.title}>{projection.title}</Text>
        <Text style={styles.description}>{projection.description}</Text>
      </View>

      {projection.chapters.length > 1 ? (
        <View
          accessibilityLabel="Chapter landmarks"
          style={styles.toc}
        >
          {projection.chapters.map((item) => (
            <View key={item.id} style={styles.tocChip}>
              <Text numberOfLines={1} style={styles.tocChipText}>
                {item.label}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {scenes.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No scenes in this scope</Text>
          <Text style={styles.emptyText}>
            Structure stays in Explorer. Add a scene there, then return to read
            the manuscript in order.
          </Text>
        </View>
      ) : (
        scenes.map((block) => (
          <SceneBlock
            block={block}
            busy={busy}
            key={block.sceneId}
            onOpenScene={onOpenScene}
            prose={sceneProseById[String(block.sceneId)] ?? ""}
            showChapterLandmark={block.showChapterLandmark}
          />
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.paper
  },
  content: {
    paddingHorizontal: 28,
    paddingTop: 20,
    paddingBottom: 48,
    maxWidth: 720,
    width: "100%",
    alignSelf: "center",
    gap: 8
  },
  header: {
    gap: 6,
    marginBottom: 12,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.documentLine
  },
  eyebrow: {
    fontFamily: fonts.uiMedium,
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: colors.kicker
  },
  title: {
    fontFamily: fonts.story,
    fontSize: 28,
    lineHeight: 34,
    color: colors.ink
  },
  description: {
    fontFamily: fonts.ui,
    fontSize: 14,
    lineHeight: 20,
    color: colors.muted
  },
  toc: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 12
  },
  tocChip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    backgroundColor: colors.wash,
    paddingHorizontal: 10,
    paddingVertical: 5
  },
  tocChipText: {
    fontFamily: fonts.uiMedium,
    fontSize: 12,
    color: colors.muted
  },
  sceneBlock: {
    gap: 6,
    paddingVertical: 18,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.documentLine
  },
  chapterLandmark: {
    fontFamily: fonts.uiSemibold,
    fontSize: 12,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: colors.kicker,
    marginBottom: 4
  },
  sceneHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12
  },
  sceneTitlePressable: {
    flex: 1,
    minWidth: 0
  },
  sceneTitle: {
    fontFamily: fonts.story,
    fontSize: 20,
    lineHeight: 26,
    color: colors.ink
  },
  editButton: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    backgroundColor: colors.panel,
    paddingHorizontal: 12,
    paddingVertical: 6
  },
  editButtonText: {
    fontFamily: fonts.uiMedium,
    fontSize: 12,
    color: colors.accent
  },
  sceneMeta: {
    fontFamily: fonts.ui,
    fontSize: 12,
    color: colors.muted
  },
  sceneBody: {
    fontFamily: fonts.story,
    fontSize: 17,
    lineHeight: 28,
    color: colors.ink,
    marginTop: 4
  },
  empty: {
    marginTop: 24,
    gap: 8,
    padding: 20,
    backgroundColor: colors.wash,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line
  },
  emptyTitle: {
    fontFamily: fonts.uiSemibold,
    fontSize: 15,
    color: colors.ink
  },
  emptyText: {
    fontFamily: fonts.ui,
    fontSize: 14,
    lineHeight: 20,
    color: colors.muted
  },
  pressed: {
    opacity: 0.72
  },
  disabled: {
    opacity: 0.45
  }
});
