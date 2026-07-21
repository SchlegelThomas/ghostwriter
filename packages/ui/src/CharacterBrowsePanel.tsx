import { useEffect, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import type {
  ProjectCommand,
  ProjectNavigator,
  ProjectNavigatorKnowledge,
  SceneId,
  StoryKnowledgeId,
  StoryKnowledgeLinkKind
} from "@ghostwriter/core";
import { ghostwriterTheme } from "./theme.js";

const { colors, fonts } = ghostwriterTheme;

const LINK_KINDS: readonly StoryKnowledgeLinkKind[] = [
  "cast",
  "theme",
  "development-cycle",
  "breadcrumb",
  "related"
];

export type CharacterBrowsePanelProps = Readonly<{
  project: ProjectNavigator;
  knowledge: ProjectNavigatorKnowledge;
  busy?: boolean;
  onCommand(command: ProjectCommand): Promise<boolean>;
  onOpenScene?(sceneId: SceneId): void;
  onOpenRecord?(storyKnowledgeId: StoryKnowledgeId): void;
}>;

export function CharacterBrowsePanel({
  project,
  knowledge,
  busy = false,
  onCommand,
  onOpenScene,
  onOpenRecord
}: CharacterBrowsePanelProps) {
  const [linkKind, setLinkKind] = useState<StoryKnowledgeLinkKind>("related");
  const [notesDraft, setNotesDraft] = useState(knowledge.notes ?? "");
  const [desireDraft, setDesireDraft] = useState(
    knowledge.characterSheet?.desire ?? ""
  );
  const [pressureDraft, setPressureDraft] = useState(
    knowledge.characterSheet?.pressure ?? ""
  );
  const [voiceDraft, setVoiceDraft] = useState(
    knowledge.characterSheet?.voiceNotes ?? ""
  );

  useEffect(() => {
    setNotesDraft(knowledge.notes ?? "");
    setDesireDraft(knowledge.characterSheet?.desire ?? "");
    setPressureDraft(knowledge.characterSheet?.pressure ?? "");
    setVoiceDraft(knowledge.characterSheet?.voiceNotes ?? "");
  }, [knowledge]);

  const peers = project.storyKnowledge.filter(
    (candidate) =>
      candidate.id !== knowledge.id && candidate.archivedAt === undefined
  );
  const linkedScenes = project.books.flatMap((book) => [
    ...book.parts.flatMap((part) =>
      part.chapters.flatMap((chapter) => chapter.scenes)
    ),
    ...book.unassignedScenes
  ]).filter(
    (scene) =>
      scene.archivedAt === undefined &&
      knowledge.linkedSceneIds.includes(scene.id)
  );

  return (
    <View accessibilityLabel="Character relationships" style={styles.root}>
      <Text style={styles.eyebrow}>Character · {knowledge.authority}</Text>
      <Text style={styles.title}>{knowledge.label}</Text>

      <Text style={styles.fieldLabel}>Notes</Text>
      <TextInput
        accessibilityLabel="Character notes"
        editable={!busy}
        multiline
        onBlur={() => {
          const next = notesDraft.trim();
          const current = knowledge.notes ?? "";
          if (next === current) return;
          void onCommand({
            type: "storyKnowledge.update",
            storyKnowledgeId: knowledge.id,
            notes: next === "" ? null : next
          });
        }}
        onChangeText={setNotesDraft}
        placeholder="Who they are in the story"
        style={styles.input}
        value={notesDraft}
      />

      <Text style={styles.sectionTitle}>Character sheet</Text>
      {(
        [
          ["Desire", desireDraft, setDesireDraft, "desire"],
          ["Pressure", pressureDraft, setPressureDraft, "pressure"],
          ["Voice", voiceDraft, setVoiceDraft, "voiceNotes"]
        ] as const
      ).map(([label, value, setValue, key]) => (
        <View key={key} style={styles.field}>
          <Text style={styles.fieldLabel}>{label}</Text>
          <TextInput
            accessibilityLabel={label}
            editable={!busy}
            multiline
            onBlur={() => {
              const next = value.trim();
              const current = knowledge.characterSheet?.[key] ?? "";
              if (next === current) return;
              const desire =
                key === "desire" ? next : desireDraft.trim();
              const pressure =
                key === "pressure" ? next : pressureDraft.trim();
              const voiceNotes =
                key === "voiceNotes" ? next : voiceDraft.trim();
              const empty =
                desire === "" && pressure === "" && voiceNotes === "";
              void onCommand({
                type: "storyKnowledge.update",
                storyKnowledgeId: knowledge.id,
                characterSheet: empty
                  ? null
                  : {
                      ...(desire === "" ? {} : { desire }),
                      ...(pressure === "" ? {} : { pressure }),
                      ...(voiceNotes === "" ? {} : { voiceNotes })
                    }
              });
            }}
            onChangeText={setValue}
            style={styles.input}
            value={value}
          />
        </View>
      ))}

      <Text style={styles.sectionTitle}>Relationships</Text>
      <Text style={styles.help}>
        Link this character to other story records with an explicit kind.
      </Text>
      <View style={styles.kindRow}>
        {LINK_KINDS.map((kind) => (
          <Pressable
            accessibilityLabel={`Link kind ${kind}`}
            accessibilityRole="button"
            accessibilityState={{ selected: linkKind === kind }}
            disabled={busy}
            key={kind}
            onPress={() => setLinkKind(kind)}
            style={({ pressed }) => [
              styles.kindChip,
              linkKind === kind && styles.kindChipSelected,
              pressed && styles.pressed
            ]}
          >
            <Text
              style={[
                styles.kindChipText,
                linkKind === kind && styles.kindChipTextSelected
              ]}
            >
              {kind}
            </Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.linkList}>
        {peers.map((candidate) => {
          const linked = knowledge.linkedKnowledge.some(
            (link) => link.toId === candidate.id && link.kind === linkKind
          );
          return (
            <View key={candidate.id} style={styles.linkRow}>
              <Pressable
                accessibilityLabel={`Open ${candidate.label}`}
                disabled={busy || onOpenRecord === undefined}
                onPress={() => onOpenRecord?.(candidate.id)}
                style={styles.linkLabelPress}
              >
                <Text style={styles.linkLabel}>
                  {candidate.label}
                  <Text style={styles.linkMeta}> · {candidate.kind}</Text>
                </Text>
              </Pressable>
              <Pressable
                accessibilityLabel={
                  linked
                    ? `Unlink ${candidate.label}`
                    : `Link ${candidate.label}`
                }
                accessibilityRole="button"
                disabled={busy}
                onPress={() =>
                  void onCommand({
                    type: "storyKnowledge.setKnowledgeLink",
                    fromId: knowledge.id,
                    toId: candidate.id,
                    kind: linkKind,
                    linked: !linked
                  })
                }
                style={({ pressed }) => [
                  styles.linkButton,
                  linked && styles.linkButtonOn,
                  pressed && styles.pressed
                ]}
              >
                <Text
                  style={[
                    styles.linkButtonText,
                    linked && styles.linkButtonTextOn
                  ]}
                >
                  {linked ? "Unlink" : "Link"}
                </Text>
              </Pressable>
            </View>
          );
        })}
      </View>
      {knowledge.linkedKnowledge.length === 0 ? (
        <Text style={styles.help}>No knowledge links yet.</Text>
      ) : (
        knowledge.linkedKnowledge.map((link) => {
          const peer = project.storyKnowledge.find(
            (candidate) => candidate.id === link.toId
          );
          return (
            <Text key={`${link.kind}:${link.toId}`} style={styles.help}>
              {link.kind} → {peer?.label ?? link.toId}
            </Text>
          );
        })
      )}

      <Text style={styles.sectionTitle}>Linked scenes</Text>
      {linkedScenes.length === 0 ? (
        <Text style={styles.help}>
          No scene links yet. Link scenes from Context or the tree.
        </Text>
      ) : (
        linkedScenes.map((scene) => (
          <Pressable
            accessibilityLabel={`Open scene ${scene.title}`}
            accessibilityRole="button"
            disabled={busy || onOpenScene === undefined}
            key={scene.id}
            onPress={() => onOpenScene?.(scene.id)}
            style={({ pressed }) => [
              styles.sceneRow,
              pressed && styles.pressed
            ]}
          >
            <Text style={styles.linkLabel}>{scene.title}</Text>
            <Text style={styles.linkMeta}>{scene.status} · Draft</Text>
          </Pressable>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 10,
    borderWidth: 1,
    gap: 8,
    padding: 14
  },
  eyebrow: {
    color: colors.kicker,
    fontFamily: fonts.uiSemibold,
    fontSize: 8,
    letterSpacing: 1.1,
    textTransform: "uppercase"
  },
  title: {
    color: colors.ink,
    fontFamily: fonts.story,
    fontSize: 24,
    marginTop: -2
  },
  sectionTitle: {
    color: colors.kicker,
    fontFamily: fonts.uiSemibold,
    fontSize: 8,
    letterSpacing: 1.1,
    marginTop: 6,
    textTransform: "uppercase"
  },
  field: {
    gap: 3
  },
  fieldLabel: {
    color: colors.muted,
    fontFamily: fonts.uiSemibold,
    fontSize: 9,
    letterSpacing: 0.5,
    textTransform: "uppercase"
  },
  input: {
    borderColor: colors.line,
    borderRadius: 6,
    borderWidth: 1,
    color: colors.ink,
    fontFamily: fonts.ui,
    fontSize: 13,
    minHeight: 44,
    paddingHorizontal: 8,
    paddingVertical: 6,
    textAlignVertical: "top"
  },
  help: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 11,
    lineHeight: 15
  },
  kindRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4
  },
  kindChip: {
    borderColor: colors.line,
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 5
  },
  kindChipSelected: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent
  },
  kindChipText: {
    color: colors.ink,
    fontFamily: fonts.uiSemibold,
    fontSize: 10
  },
  kindChipTextSelected: {
    color: colors.accent
  },
  linkList: {
    gap: 4
  },
  linkRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8
  },
  linkLabelPress: {
    flex: 1,
    minWidth: 0
  },
  linkLabel: {
    color: colors.ink,
    fontFamily: fonts.uiSemibold,
    fontSize: 12
  },
  linkMeta: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 10
  },
  linkButton: {
    borderColor: colors.line,
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 5
  },
  linkButtonOn: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent
  },
  linkButtonText: {
    color: colors.ink,
    fontFamily: fonts.uiSemibold,
    fontSize: 10
  },
  linkButtonTextOn: {
    color: colors.accent
  },
  sceneRow: {
    backgroundColor: colors.wash,
    borderColor: colors.line,
    borderRadius: 8,
    borderWidth: 1,
    gap: 2,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  pressed: {
    opacity: 0.72
  }
});
