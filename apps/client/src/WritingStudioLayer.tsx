import {
  sceneId as toSceneId,
  storyKnowledgeId as toStoryKnowledgeId,
  type CharacterSheet,
  type ProjectCommand,
  type SceneSketch,
  type WritingAssistProposal
} from "@ghostwriter/core";
import {
  WRITE_COMPOSITION_OPTIONS,
  WRITE_INPUT_OPTIONS,
  WritingAssistPanel,
  ghostwriterTheme,
  type WriteComposition,
  type WriteInputModality,
  type WritingAssistRoleId
} from "@ghostwriter/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { requestWritingAssist } from "./api.js";

const { colors, fonts } = ghostwriterTheme;

export type WritingStudioCastMember = Readonly<{
  id: string;
  label: string;
  characterSheet?: CharacterSheet;
}>;

export type WritingStudioLayerProps = Readonly<{
  projectId: string;
  projectVersion: number;
  sceneId: string;
  sceneTitle: string;
  sceneSummary?: string;
  sketch?: SceneSketch;
  backdropUrl?: string;
  backdropCaption?: string;
  cast: readonly WritingStudioCastMember[];
  recentProse: string;
  composition: WriteComposition;
  modality: WriteInputModality;
  assistOpen: boolean;
  focusHalo: boolean;
  disabled?: boolean;
  onCompositionChange(composition: WriteComposition): void;
  onModalityChange(modality: WriteInputModality): void;
  onAssistOpenChange(open: boolean): void;
  onCommand(command: ProjectCommand): Promise<boolean>;
  onInsertProse(text: string): void;
  onAcknowledgement?(title: string, detail: string): void;
}>;

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};

function getSpeechRecognitionConstructor():
  | (new () => SpeechRecognitionLike)
  | undefined {
  if (typeof window === "undefined") return undefined;
  const host = window as Window &
    Readonly<{
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    }>;
  return host.SpeechRecognition ?? host.webkitSpeechRecognition;
}

export function WritingStudioLayer({
  projectId,
  projectVersion,
  sceneId,
  sceneTitle,
  sceneSummary,
  sketch,
  backdropUrl,
  backdropCaption,
  cast,
  recentProse,
  composition,
  modality,
  assistOpen,
  focusHalo,
  disabled = false,
  onCompositionChange,
  onModalityChange,
  onAssistOpenChange,
  onCommand,
  onInsertProse,
  onAcknowledgement
}: WritingStudioLayerProps) {
  const [activeRole, setActiveRole] =
    useState<WritingAssistRoleId>("scene-partner");
  const [proposals, setProposals] = useState<readonly WritingAssistProposal[]>(
    []
  );
  const [assistBusy, setAssistBusy] = useState(false);
  const [assistStatus, setAssistStatus] = useState<string | undefined>();
  const [draftSketch, setDraftSketch] = useState({
    purpose: sketch?.purpose ?? "",
    conflict: sketch?.conflict ?? "",
    turn: sketch?.turn ?? "",
    sensoryNotes: sketch?.sensoryNotes ?? "",
    openQuestions: sketch?.openQuestions ?? ""
  });
  const [inkPaths, setInkPaths] = useState(sketch?.inkPaths ?? []);
  const recognitionRef = useRef<SpeechRecognitionLike | undefined>(undefined);
  useEffect(() => {
    setDraftSketch({
      purpose: sketch?.purpose ?? "",
      conflict: sketch?.conflict ?? "",
      turn: sketch?.turn ?? "",
      sensoryNotes: sketch?.sensoryNotes ?? "",
      openQuestions: sketch?.openQuestions ?? ""
    });
    setInkPaths(sketch?.inkPaths ?? []);
  }, [sceneId, sketch]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      recognitionRef.current = undefined;
    };
  }, []);

  useEffect(() => {
    if (modality !== "dictate") {
      recognitionRef.current?.stop();
      recognitionRef.current = undefined;
      return;
    }
    const Ctor = getSpeechRecognitionConstructor();
    if (Ctor === undefined) {
      setAssistStatus("Dictation is unavailable in this browser.");
      onModalityChange("keyboard");
      return;
    }
    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = "en-US";
    recognition.onresult = (event) => {
      const result = event.results[event.results.length - 1];
      const transcript = result?.[0]?.transcript?.trim();
      if (transcript !== undefined && transcript.length > 0) {
        onInsertProse(`${transcript} `);
      }
    };
    recognition.onerror = () => {
      setAssistStatus("Dictation stopped — microphone permission or engine error.");
      onModalityChange("keyboard");
    };
    recognition.onend = () => {
      if (modality === "dictate") {
        // Keep listening until the writer leaves dictate mode.
        try {
          recognition.start();
        } catch {
          onModalityChange("keyboard");
        }
      }
    };
    recognitionRef.current = recognition;
    try {
      recognition.start();
      setAssistStatus("Listening — speech enters the Draft caret.");
    } catch {
      setAssistStatus("Could not start dictation.");
      onModalityChange("keyboard");
    }
    return () => {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.stop();
    };
  }, [modality, onInsertProse, onModalityChange]);

  const saveSketch = useCallback(
    async (next: SceneSketch) => {
      const ok = await onCommand({
        type: "scene.update",
        sceneId: toSceneId(sceneId),
        sketch: next
      });
      if (ok) {
        onAcknowledgement?.(
          "Sketch saved",
          "Scene craft fields were acknowledged by the server."
        );
      }
    },
    [onAcknowledgement, onCommand, sceneId]
  );

  const handleGenerate = useCallback(
    async (role: WritingAssistRoleId) => {
      setAssistBusy(true);
      setAssistStatus(undefined);
      try {
        const response = await requestWritingAssist({
          projectId,
          role,
          sceneId,
          sceneTitle,
          ...(sceneSummary === undefined ? {} : { sceneSummary }),
          recentProse: recentProse.slice(-4_000),
          ...(sketch === undefined ? {} : { sketch }),
          ...(backdropCaption === undefined ? {} : { backdropCaption }),
          cast: cast.map((member) => ({
            id: member.id,
            label: member.label,
            ...(member.characterSheet === undefined
              ? {}
              : { characterSheet: member.characterSheet })
          }))
        });
        setProposals(response.proposals as readonly WritingAssistProposal[]);
        setAssistStatus(`Ready · ${response.provider}`);
      } catch (error) {
        setAssistStatus(
          error instanceof Error ? error.message : "Assist request failed."
        );
      } finally {
        setAssistBusy(false);
      }
    },
    [
      backdropCaption,
      cast,
      projectId,
      recentProse,
      sceneId,
      sceneSummary,
      sceneTitle,
      sketch
    ]
  );

  const handleApply = useCallback(
    async (proposal: WritingAssistProposal) => {
      if (proposal.kind === "prose-variant" && proposal.prose !== undefined) {
        onInsertProse(
          proposal.prose.endsWith("\n")
            ? proposal.prose
            : `${proposal.prose}\n\n`
        );
        onAcknowledgement?.(
          "Proposal inserted",
          "Prose was inserted at the caret — review and save as usual."
        );
        setProposals((current) =>
          current.filter((entry) => entry.id !== proposal.id)
        );
        return;
      }
      if (proposal.kind === "sketch-fields" && proposal.sketch !== undefined) {
        const ok = await onCommand({
          type: "scene.update",
          sceneId: toSceneId(sceneId),
          sketch: {
            ...proposal.sketch,
            ...(inkPaths.length > 0 ? { inkPaths } : {})
          }
        });
        if (ok) {
          onAcknowledgement?.(
            "Sketch applied",
            "Sketch Partner fields were saved to the scene."
          );
          setProposals((current) =>
            current.filter((entry) => entry.id !== proposal.id)
          );
        }
        return;
      }
      if (
        proposal.kind === "character-sheet" &&
        proposal.characterSheet !== undefined &&
        proposal.storyKnowledgeId !== undefined
      ) {
        const ok = await onCommand({
          type: "storyKnowledge.update",
          storyKnowledgeId: toStoryKnowledgeId(proposal.storyKnowledgeId),
          characterSheet: proposal.characterSheet
        });
        if (ok) {
          onAcknowledgement?.(
            "Sheet applied",
            "Character Coach updates were saved."
          );
          setProposals((current) =>
            current.filter((entry) => entry.id !== proposal.id)
          );
        }
        return;
      }
      if (
        proposal.kind === "backdrop-notes" &&
        proposal.backdropCaption !== undefined
      ) {
        if (backdropUrl !== undefined) {
          const ok = await onCommand({
            type: "scene.update",
            sceneId: toSceneId(sceneId),
            backdrop: {
              url: backdropUrl,
              caption: proposal.backdropCaption
            }
          });
          if (ok) {
            onAcknowledgement?.(
              "Backdrop applied",
              "Worldkeeper caption was saved on the scene backdrop."
            );
            setProposals((current) =>
              current.filter((entry) => entry.id !== proposal.id)
            );
          }
          return;
        }
        const ok = await onCommand({
          type: "scene.update",
          sceneId: toSceneId(sceneId),
          sketch: {
            ...(sketch ?? {}),
            sensoryNotes: proposal.backdropCaption
          }
        });
        if (ok) {
          onAcknowledgement?.(
            "Backdrop notes applied",
            "Saved to scene sketch sensory notes (no backdrop URL yet)."
          );
          setProposals((current) =>
            current.filter((entry) => entry.id !== proposal.id)
          );
        }
      }
    },
    [
      backdropUrl,
      inkPaths,
      onAcknowledgement,
      onCommand,
      onInsertProse,
      sceneId,
      sketch
    ]
  );

  const companion = useMemo(() => {
    if (composition === "split-sheet") return "sheet";
    if (composition === "split-backdrop") return "backdrop";
    if (composition === "page" && modality === "ink") return "sketch";
    return composition === "page" ? "none" : "none";
  }, [composition, modality]);

  if (focusHalo) {
    return modality === "dictate" ? (
      <View style={styles.listenChip}>
        <Text style={styles.listenChipText}>● Listening</Text>
      </View>
    ) : null;
  }

  return (
    <View style={styles.root}>
      <View accessibilityLabel="Writing studio toolbar" style={styles.toolbar}>
        <View style={styles.group}>
          {WRITE_COMPOSITION_OPTIONS.map((option) => (
            <Pressable
              accessibilityLabel={option.tip}
              accessibilityRole="button"
              accessibilityState={{
                selected: composition === option.id,
                disabled
              }}
              disabled={disabled}
              key={option.id}
              onPress={() => onCompositionChange(option.id)}
              style={({ pressed }) => [
                styles.chip,
                composition === option.id && styles.chipSelected,
                pressed && styles.pressed,
                disabled && styles.disabled
              ]}
            >
              <Text
                style={[
                  styles.chipText,
                  composition === option.id && styles.chipTextSelected
                ]}
              >
                {option.label}
              </Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.divider} />
        <View style={styles.group}>
          {WRITE_INPUT_OPTIONS.map((option) => (
            <Pressable
              accessibilityLabel={option.tip}
              accessibilityRole="button"
              accessibilityState={{
                selected: modality === option.id,
                disabled
              }}
              disabled={disabled}
              key={option.id}
              onPress={() => onModalityChange(option.id)}
              style={({ pressed }) => [
                styles.chip,
                modality === option.id && styles.chipSelected,
                modality === "dictate" &&
                  option.id === "dictate" &&
                  styles.chipLive,
                pressed && styles.pressed,
                disabled && styles.disabled
              ]}
            >
              <Text
                style={[
                  styles.chipText,
                  modality === option.id && styles.chipTextSelected
                ]}
              >
                {option.label}
              </Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.divider} />
        <Pressable
          accessibilityLabel={assistOpen ? "Hide Assist" : "Show Assist"}
          accessibilityRole="button"
          onPress={() => onAssistOpenChange(!assistOpen)}
          style={({ pressed }) => [
            styles.chip,
            assistOpen && styles.chipSelected,
            pressed && styles.pressed
          ]}
        >
          <Text style={[styles.chipText, assistOpen && styles.chipTextSelected]}>
            Assist
          </Text>
        </Pressable>
        <Text style={styles.versionHint}>v{projectVersion}</Text>
      </View>

      {modality === "dictate" ? (
        <View style={styles.listenChip}>
          <Text style={styles.listenChipText}>
            ● Listening — words enter the Draft caret
          </Text>
        </View>
      ) : null}

      <View style={styles.row}>
        {companion === "sheet" ? (
          <View accessibilityLabel="Split character sheet" style={styles.companion}>
            <Text style={styles.companionEye}>Split · Character sheet</Text>
            {cast.length === 0 ? (
              <Text style={styles.companionBody}>
                Link a character to this scene to cast it here.
              </Text>
            ) : (
              cast.map((member) => (
                <View key={member.id} style={styles.sheetCard}>
                  <Text style={styles.sheetTitle}>{member.label}</Text>
                  <Text style={styles.companionBody}>
                    Desire: {member.characterSheet?.desire ?? "—"}
                  </Text>
                  <Text style={styles.companionBody}>
                    Pressure: {member.characterSheet?.pressure ?? "—"}
                  </Text>
                  <Text style={styles.companionBody}>
                    Voice: {member.characterSheet?.voiceNotes ?? "—"}
                  </Text>
                </View>
              ))
            )}
          </View>
        ) : null}

        {companion === "backdrop" ? (
          <View accessibilityLabel="Split backdrop" style={styles.companion}>
            <Text style={styles.companionEye}>Split · Backdrop</Text>
            {backdropUrl === undefined ? (
              <Text style={styles.companionBody}>
                Add a backdrop URL in Context → Brief to pin place media. Sensory
                notes can still live on the scene sketch.
              </Text>
            ) : (
              <Text style={styles.companionBody}>Backdrop URL set.</Text>
            )}
            <Text style={styles.sheetTitle}>
              {backdropCaption ?? "No caption yet"}
            </Text>
          </View>
        ) : null}

        {assistOpen ? (
          <View style={styles.assistPane}>
            <WritingAssistPanel
              activeRole={activeRole}
              busy={assistBusy || disabled}
              onApply={(proposal) => void handleApply(proposal)}
              onDismiss={(proposal) =>
                setProposals((current) =>
                  current.filter((entry) => entry.id !== proposal.id)
                )
              }
              onGenerate={(role) => void handleGenerate(role)}
              onRoleChange={setActiveRole}
              proposals={proposals}
              statusMessage={assistStatus}
            />
          </View>
        ) : null}
      </View>

      <View accessibilityLabel="Scene sketch craft" style={styles.sketchBlock}>
        <Text style={styles.companionEye}>Scene sketch</Text>
        {(
          [
            ["purpose", "Purpose"],
            ["conflict", "Conflict"],
            ["turn", "Turn"],
            ["sensoryNotes", "Sensory notes"],
            ["openQuestions", "Open questions"]
          ] as const
        ).map(([key, label]) => (
          <View key={key} style={styles.field}>
            <Text style={styles.fieldLabel}>{label}</Text>
            <TextInput
              accessibilityLabel={label}
              editable={!disabled}
              onChangeText={(value) =>
                setDraftSketch((current) => ({ ...current, [key]: value }))
              }
              placeholder={label}
              style={styles.input}
              value={draftSketch[key]}
            />
          </View>
        ))}
        <Pressable
          accessibilityLabel="Save scene sketch"
          accessibilityRole="button"
          disabled={disabled}
          onPress={() => {
            const next: SceneSketch = {
              ...(draftSketch.purpose.trim() === ""
                ? {}
                : { purpose: draftSketch.purpose.trim() }),
              ...(draftSketch.conflict.trim() === ""
                ? {}
                : { conflict: draftSketch.conflict.trim() }),
              ...(draftSketch.turn.trim() === ""
                ? {}
                : { turn: draftSketch.turn.trim() }),
              ...(draftSketch.sensoryNotes.trim() === ""
                ? {}
                : { sensoryNotes: draftSketch.sensoryNotes.trim() }),
              ...(draftSketch.openQuestions.trim() === ""
                ? {}
                : { openQuestions: draftSketch.openQuestions.trim() }),
              ...(inkPaths.length === 0 ? {} : { inkPaths }),
              ...(sketch?.beats === undefined ? {} : { beats: sketch.beats })
            };
            if (Object.keys(next).length === 0) return;
            void saveSketch(next);
          }}
          style={({ pressed }) => [
            styles.saveSketch,
            pressed && styles.pressed,
            disabled && styles.disabled
          ]}
        >
          <Text style={styles.saveSketchText}>Save sketch</Text>
        </Pressable>
      </View>

      {modality === "ink" ? (
        <View accessibilityLabel="Sketch ink pad" style={styles.inkPad}>
          <Text style={styles.companionEye}>Stylus · craft ink</Text>
          <Text style={styles.inkHint}>
            Ink lives on the scene sketch only. Add a stroke mark, then keep
            editing craft fields. Paths saved: {inkPaths.length}
          </Text>
          <Pressable
            accessibilityLabel="Add ink stroke to sketch"
            accessibilityRole="button"
            disabled={disabled}
            onPress={() => {
              const nextPaths = [
                ...inkPaths,
                {
                  color: colors.accent,
                  size: 2,
                  points: Object.freeze([
                    Object.freeze({ x: 12 + inkPaths.length * 8, y: 24 }),
                    Object.freeze({ x: 64 + inkPaths.length * 8, y: 40 }),
                    Object.freeze({ x: 110 + inkPaths.length * 6, y: 28 })
                  ])
                }
              ];
              setInkPaths(nextPaths);
              const next: SceneSketch = {
                ...(draftSketch.purpose.trim() === ""
                  ? {}
                  : { purpose: draftSketch.purpose.trim() }),
                ...(draftSketch.conflict.trim() === ""
                  ? {}
                  : { conflict: draftSketch.conflict.trim() }),
                ...(draftSketch.turn.trim() === ""
                  ? {}
                  : { turn: draftSketch.turn.trim() }),
                ...(draftSketch.sensoryNotes.trim() === ""
                  ? {}
                  : { sensoryNotes: draftSketch.sensoryNotes.trim() }),
                ...(draftSketch.openQuestions.trim() === ""
                  ? {}
                  : { openQuestions: draftSketch.openQuestions.trim() }),
                inkPaths: nextPaths,
                ...(sketch?.beats === undefined ? {} : { beats: sketch.beats })
              };
              void saveSketch(next);
            }}
            style={({ pressed }) => [
              styles.saveSketch,
              pressed && styles.pressed,
              disabled && styles.disabled
            ]}
          >
            <Text style={styles.saveSketchText}>Add ink stroke</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: 8,
    marginBottom: 8
  },
  toolbar: {
    alignItems: "center",
    backgroundColor: colors.topbar,
    borderColor: colors.line,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    minHeight: 36,
    paddingHorizontal: 8,
    paddingVertical: 4
  },
  group: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 3
  },
  divider: {
    backgroundColor: colors.line,
    height: 22,
    marginHorizontal: 2,
    width: 1
  },
  chip: {
    alignItems: "center",
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 6,
    borderWidth: 1,
    height: 28,
    justifyContent: "center",
    minWidth: 28,
    paddingHorizontal: 8
  },
  chipSelected: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent
  },
  chipLive: {
    backgroundColor: colors.redSoft,
    borderColor: colors.red
  },
  chipText: {
    color: colors.ink,
    fontFamily: fonts.uiSemibold,
    fontSize: 10
  },
  chipTextSelected: {
    color: colors.accent
  },
  versionHint: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 9,
    marginLeft: "auto"
  },
  listenChip: {
    alignSelf: "flex-start",
    backgroundColor: colors.redSoft,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 5
  },
  listenChipText: {
    color: colors.red,
    fontFamily: fonts.uiSemibold,
    fontSize: 10
  },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  companion: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 8,
    borderWidth: 1,
    flexBasis: 240,
    flexGrow: 1,
    gap: 6,
    maxWidth: 320,
    padding: 10
  },
  assistPane: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 8,
    borderWidth: 1,
    flexBasis: 280,
    flexGrow: 1,
    maxHeight: 420,
    maxWidth: 360,
    overflow: "hidden"
  },
  companionEye: {
    color: colors.muted,
    fontFamily: fonts.uiSemibold,
    fontSize: 8,
    letterSpacing: 1,
    textTransform: "uppercase"
  },
  companionBody: {
    color: colors.ink,
    fontFamily: fonts.ui,
    fontSize: 12,
    lineHeight: 16
  },
  sheetCard: {
    backgroundColor: colors.wash,
    borderColor: colors.line,
    borderRadius: 8,
    borderWidth: 1,
    gap: 4,
    padding: 8
  },
  sheetTitle: {
    color: colors.ink,
    fontFamily: fonts.story,
    fontSize: 16
  },
  sketchBlock: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 8,
    borderWidth: 1,
    gap: 6,
    padding: 10
  },
  field: {
    gap: 3
  },
  fieldLabel: {
    color: colors.muted,
    fontFamily: fonts.uiSemibold,
    fontSize: 9,
    letterSpacing: 0.6,
    textTransform: "uppercase"
  },
  input: {
    borderColor: colors.line,
    borderRadius: 6,
    borderWidth: 1,
    color: colors.ink,
    fontFamily: fonts.ui,
    fontSize: 13,
    minHeight: 34,
    paddingHorizontal: 8,
    paddingVertical: 6
  },
  saveSketch: {
    alignSelf: "flex-start",
    backgroundColor: colors.brandDark,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  saveSketchText: {
    color: "#fff",
    fontFamily: fonts.uiSemibold,
    fontSize: 11
  },
  inkPad: {
    backgroundColor: "#fff7dc",
    borderColor: "#d7bd69",
    borderRadius: 8,
    borderWidth: 1,
    gap: 6,
    padding: 10
  },
  inkSurface: {
    borderColor: "#d7bd69",
    borderRadius: 8,
    borderStyle: "dashed",
    borderWidth: 1,
    minHeight: 140,
    padding: 12
  },
  inkHint: {
    color: "#9a8474",
    fontFamily: fonts.uiMedium,
    fontSize: 12
  },
  pressed: {
    opacity: 0.72
  },
  disabled: {
    opacity: 0.42
  }
});
