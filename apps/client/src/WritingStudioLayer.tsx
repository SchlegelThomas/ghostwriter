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
  companionForComposition,
  compositionHint,
  ghostwriterTheme,
  type QuickBuildOption,
  type WriteComposition,
  type WriteInputModality,
  type WritingAssistRoleId
} from "@ghostwriter/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
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

export type WritingStudioQuickBuild = Readonly<{
  open: boolean;
  options: readonly QuickBuildOption[];
  onOpenChange(open: boolean): void;
  onSelect(option: QuickBuildOption): void;
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
  quickBuild?: WritingStudioQuickBuild;
  onCompositionChange(composition: WriteComposition): void;
  onModalityChange(modality: WriteInputModality): void;
  onAssistOpenChange(open: boolean): void;
  onCommand(command: ProjectCommand): Promise<boolean>;
  onInsertProse(text: string): void;
  onAcknowledgement?(title: string, detail: string): void;
}>;

export type WritingStudioCompanionPaneProps = Readonly<{
  composition: WriteComposition;
  cast: readonly WritingStudioCastMember[];
  /** Characters (or records) not yet linked to this scene — shown for one-tap link. */
  linkCandidates?: readonly WritingStudioCastMember[];
  backdropUrl?: string;
  backdropCaption?: string;
  disabled?: boolean;
  onOpenContext?(): void;
  onClose?(): void;
  onSetCastLink?(memberId: string, linked: boolean): void;
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

/** Side companion for Sheet / Place — rendered beside the editor, not above it. */
export function WritingStudioCompanionPane({
  composition,
  cast,
  linkCandidates = [],
  backdropUrl,
  backdropCaption,
  disabled = false,
  onOpenContext,
  onClose,
  onSetCastLink
}: WritingStudioCompanionPaneProps) {
  const companion = companionForComposition(composition);
  if (companion === "none") return null;

  if (companion === "sheet") {
    return (
      <View
        accessibilityLabel="Character sheet beside page"
        style={styles.companionPane}
      >
        <View style={styles.companionHeader}>
          <View style={styles.companionHeadingCopy}>
            <Text style={styles.companionEye}>Sheet</Text>
            <Text style={styles.companionTitle}>Cast for this scene</Text>
          </View>
          {onClose === undefined ? null : (
            <Pressable
              accessibilityLabel="Close sheet — back to Page"
              accessibilityRole="button"
              onPress={onClose}
              style={({ pressed }) => [
                styles.companionClose,
                pressed && styles.pressed
              ]}
            >
              <Text style={styles.companionCloseText}>Page</Text>
            </Pressable>
          )}
        </View>
        <ScrollView style={styles.companionScroll}>
          {cast.length === 0 ? (
            <View style={styles.companionEmpty}>
              <Text style={styles.companionBody}>
                Link a character below. Sheet then keeps desire, pressure, and
                voice beside the prose.
              </Text>
            </View>
          ) : (
            cast.map((member) => (
              <View key={member.id} style={styles.sheetCard}>
                <View style={styles.sheetCardHeader}>
                  <Text style={styles.sheetTitle}>{member.label}</Text>
                  {onSetCastLink === undefined ? null : (
                    <Pressable
                      accessibilityLabel={`Unlink ${member.label}`}
                      accessibilityRole="button"
                      disabled={disabled}
                      onPress={() => onSetCastLink(member.id, false)}
                      style={({ pressed }) => [
                        styles.sheetLinkButton,
                        pressed && styles.pressed,
                        disabled && styles.disabled
                      ]}
                    >
                      <Text style={styles.sheetLinkButtonText}>Unlink</Text>
                    </Pressable>
                  )}
                </View>
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
          {linkCandidates.length === 0 ? (
            cast.length === 0 ? (
              <View style={styles.companionEmpty}>
                <Text style={styles.companionBody}>
                  No characters in this project yet. Create one from Characters
                  (K) or Context, then link them here.
                </Text>
                {onOpenContext === undefined ? null : (
                  <Pressable
                    accessibilityLabel="Open Context"
                    accessibilityRole="button"
                    onPress={onOpenContext}
                    style={({ pressed }) => [
                      styles.companionAction,
                      pressed && styles.pressed
                    ]}
                  >
                    <Text style={styles.companionActionText}>Open Context</Text>
                  </Pressable>
                )}
              </View>
            ) : null
          ) : (
            <View style={styles.linkCastSection}>
              <Text style={styles.companionEye}>Link to this scene</Text>
              {linkCandidates.map((member) => (
                <View key={member.id} style={styles.linkCastRow}>
                  <Text numberOfLines={1} style={styles.linkCastLabel}>
                    {member.label}
                  </Text>
                  <Pressable
                    accessibilityLabel={`Link ${member.label} to this scene`}
                    accessibilityRole="button"
                    disabled={disabled || onSetCastLink === undefined}
                    onPress={() => onSetCastLink?.(member.id, true)}
                    style={({ pressed }) => [
                      styles.companionAction,
                      pressed && styles.pressed,
                      (disabled || onSetCastLink === undefined) &&
                        styles.disabled
                    ]}
                  >
                    <Text style={styles.companionActionText}>Link</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      </View>
    );
  }

  return (
    <View
      accessibilityLabel="Place backdrop beside page"
      style={styles.companionPane}
    >
      <View style={styles.companionHeader}>
        <View style={styles.companionHeadingCopy}>
          <Text style={styles.companionEye}>Place</Text>
          <Text style={styles.companionTitle}>Scene backdrop</Text>
        </View>
        {onClose === undefined ? null : (
          <Pressable
            accessibilityLabel="Close place — back to Page"
            accessibilityRole="button"
            onPress={onClose}
            style={({ pressed }) => [
              styles.companionClose,
              pressed && styles.pressed
            ]}
          >
            <Text style={styles.companionCloseText}>Page</Text>
          </Pressable>
        )}
      </View>
      {backdropUrl === undefined || backdropUrl.trim() === "" ? (
        <View style={styles.companionEmpty}>
          <Text style={styles.companionBody}>
            Pin a backdrop URL in Context → Brief. Place keeps that media beside
            the page while you write.
          </Text>
          {onOpenContext === undefined ? null : (
            <Pressable
              accessibilityLabel="Open Context to set backdrop"
              accessibilityRole="button"
              onPress={onOpenContext}
              style={({ pressed }) => [
                styles.companionAction,
                pressed && styles.pressed
              ]}
            >
              <Text style={styles.companionActionText}>Open Context</Text>
            </Pressable>
          )}
        </View>
      ) : (
        <ScrollView style={styles.companionScroll}>
          <Image
            accessibilityLabel="Scene backdrop"
            resizeMode="cover"
            source={{ uri: backdropUrl }}
            style={styles.backdropImage}
          />
          <Text style={styles.sheetTitle}>
            {backdropCaption?.trim() || "No caption yet"}
          </Text>
        </ScrollView>
      )}
    </View>
  );
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
  quickBuild,
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
    openQuestions: sketch?.openQuestions ?? "",
    detail: sketch?.detail ?? ""
  });
  const [inkPaths, setInkPaths] = useState(sketch?.inkPaths ?? []);
  const [sketchModalOpen, setSketchModalOpen] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | undefined>(undefined);
  useEffect(() => {
    setDraftSketch({
      purpose: sketch?.purpose ?? "",
      conflict: sketch?.conflict ?? "",
      turn: sketch?.turn ?? "",
      sensoryNotes: sketch?.sensoryNotes ?? "",
      openQuestions: sketch?.openQuestions ?? "",
      detail: sketch?.detail ?? ""
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

  useEffect(() => {
    if (modality === "ink") setSketchModalOpen(true);
  }, [modality]);

  const hint = compositionHint(composition);

  const buildSketchPayload = useCallback((): SceneSketch => {
    return {
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
      ...(draftSketch.detail.trim() === ""
        ? {}
        : { detail: draftSketch.detail.trim() }),
      ...(inkPaths.length === 0 ? {} : { inkPaths }),
      ...(sketch?.beats === undefined ? {} : { beats: sketch.beats })
    };
  }, [draftSketch, inkPaths, sketch?.beats]);

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
          accessibilityLabel="Open scene sketch"
          accessibilityRole="button"
          onPress={() => setSketchModalOpen(true)}
          style={({ pressed }) => [
            styles.chip,
            sketchModalOpen && styles.chipSelected,
            pressed && styles.pressed
          ]}
        >
          <Text
            style={[
              styles.chipText,
              sketchModalOpen && styles.chipTextSelected
            ]}
          >
            Sketch
          </Text>
        </Pressable>
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
        {quickBuild === undefined || quickBuild.options.length === 0 ? null : (
          <View style={styles.quickBuildWrap}>
            <Pressable
              accessibilityLabel="Quick Build: add to the manuscript"
              accessibilityRole="button"
              accessibilityState={{ expanded: quickBuild.open }}
              disabled={disabled}
              onPress={() => quickBuild.onOpenChange(!quickBuild.open)}
              style={({ pressed }) => [
                styles.addChip,
                quickBuild.open && styles.chipSelected,
                pressed && styles.pressed,
                disabled && styles.disabled
              ]}
            >
              <Text
                style={[
                  styles.addChipText,
                  quickBuild.open && styles.chipTextSelected
                ]}
              >
                ＋ Add
              </Text>
            </Pressable>
            {quickBuild.open ? (
              <View
                accessibilityLabel="Quick Build options"
                style={styles.quickBuildMenu}
              >
                {quickBuild.options.map((option) => (
                  <Pressable
                    accessibilityLabel={option.label}
                    accessibilityRole="menuitem"
                    disabled={disabled}
                    key={option.id}
                    onPress={() => quickBuild.onSelect(option)}
                    style={({ pressed }) => [
                      styles.quickBuildOption,
                      pressed && styles.pressed,
                      disabled && styles.disabled
                    ]}
                  >
                    <Text style={styles.quickBuildOptionLabel}>
                      {option.label}
                    </Text>
                    <Text
                      numberOfLines={2}
                      style={styles.quickBuildOptionDetail}
                    >
                      {option.detail}
                    </Text>
                  </Pressable>
                ))}
                <Text style={styles.quickBuildHint}>
                  Titles commit with Enter in the manuscript tree. Escape
                  cancels.
                </Text>
              </View>
            ) : null}
          </View>
        )}
        <Text style={styles.versionHint}>v{projectVersion}</Text>
      </View>

      {hint.trim() === "" ? null : (
        <Text accessibilityLiveRegion="polite" style={styles.compositionHint}>
          {hint}
        </Text>
      )}

      {modality === "dictate" ? (
        <View style={styles.listenChip}>
          <Text style={styles.listenChipText}>● Listening</Text>
        </View>
      ) : null}

      <Modal
        animationType="fade"
        onRequestClose={() => setSketchModalOpen(false)}
        transparent
        visible={sketchModalOpen}
      >
        <View
          accessibilityLabel="Scene sketch dialog"
          accessibilityViewIsModal
          style={styles.modalRoot}
        >
          <Pressable
            accessibilityLabel="Dismiss sketch"
            accessibilityRole="button"
            onPress={() => setSketchModalOpen(false)}
            style={styles.modalBackdrop}
          />
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View style={styles.modalHeadingCopy}>
                <Text style={styles.companionEye}>Scene craft</Text>
                <Text style={styles.modalTitle}>Scene sketch</Text>
                <Text style={styles.modalRule}>
                  Sketch fields stay off the manuscript page until you apply
                  them.
                </Text>
              </View>
              <Pressable
                accessibilityLabel="Close sketch"
                accessibilityRole="button"
                onPress={() => setSketchModalOpen(false)}
                style={({ pressed }) => [
                  styles.modalClose,
                  pressed && styles.pressed
                ]}
              >
                <Text style={styles.modalCloseText}>×</Text>
              </Pressable>
            </View>
            <ScrollView
              contentContainerStyle={styles.modalBody}
              keyboardShouldPersistTaps="handled"
              style={styles.modalScroll}
            >
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
                    multiline
                    onChangeText={(value) =>
                      setDraftSketch((current) => ({
                        ...current,
                        [key]: value
                      }))
                    }
                    placeholder={label}
                    style={styles.input}
                    value={draftSketch[key]}
                  />
                </View>
              ))}
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Detail outline</Text>
                <TextInput
                  accessibilityLabel="Detail outline"
                  editable={!disabled}
                  multiline
                  onChangeText={(value) =>
                    setDraftSketch((current) => ({
                      ...current,
                      detail: value
                    }))
                  }
                  placeholder="Write the longer sketch / beat detail here. This stays craft-side — not manuscript prose."
                  style={styles.detailInput}
                  value={draftSketch.detail}
                />
              </View>
              {modality === "ink" ? (
                <View accessibilityLabel="Sketch ink pad" style={styles.inkPad}>
                  <Text style={styles.companionEye}>Stylus · craft ink</Text>
                  <Text style={styles.inkHint}>
                    Ink lives on the scene sketch only. Paths saved:{" "}
                    {inkPaths.length}
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
                            Object.freeze({
                              x: 12 + inkPaths.length * 8,
                              y: 24
                            }),
                            Object.freeze({
                              x: 64 + inkPaths.length * 8,
                              y: 40
                            }),
                            Object.freeze({
                              x: 110 + inkPaths.length * 6,
                              y: 28
                            })
                          ])
                        }
                      ];
                      setInkPaths(nextPaths);
                      void saveSketch({
                        ...buildSketchPayload(),
                        inkPaths: nextPaths
                      });
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
            </ScrollView>
            <View style={styles.modalFooter}>
              <Pressable
                accessibilityLabel="Cancel sketch"
                accessibilityRole="button"
                onPress={() => setSketchModalOpen(false)}
                style={({ pressed }) => [
                  styles.modalSecondary,
                  pressed && styles.pressed
                ]}
              >
                <Text style={styles.modalSecondaryText}>Close</Text>
              </Pressable>
              <Pressable
                accessibilityLabel="Save scene sketch"
                accessibilityRole="button"
                disabled={disabled}
                onPress={() => {
                  const next = buildSketchPayload();
                  if (Object.keys(next).length === 0) {
                    setSketchModalOpen(false);
                    return;
                  }
                  void saveSketch(next).then(() => setSketchModalOpen(false));
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
          </View>
        </View>
      </Modal>

      <Modal
        animationType="fade"
        onRequestClose={() => onAssistOpenChange(false)}
        transparent
        visible={assistOpen}
      >
        <View
          accessibilityLabel="Writing assist dialog"
          accessibilityViewIsModal
          style={styles.modalRoot}
        >
          <Pressable
            accessibilityLabel="Dismiss assist"
            accessibilityRole="button"
            onPress={() => onAssistOpenChange(false)}
            style={styles.modalBackdrop}
          />
          <View style={[styles.modalCard, styles.assistModalCard]}>
            <View style={styles.modalHeader}>
              <View style={styles.modalHeadingCopy}>
                <Text style={styles.companionEye}>Writing tools</Text>
                <Text style={styles.modalTitle}>Assist</Text>
              </View>
              <Pressable
                accessibilityLabel="Close assist"
                accessibilityRole="button"
                onPress={() => onAssistOpenChange(false)}
                style={({ pressed }) => [
                  styles.modalClose,
                  pressed && styles.pressed
                ]}
              >
                <Text style={styles.modalCloseText}>×</Text>
              </Pressable>
            </View>
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
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: 4,
    marginBottom: 6
  },
  toolbar: {
    alignItems: "center",
    backgroundColor: colors.topbar,
    borderColor: colors.line,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
    minHeight: 36,
    paddingHorizontal: 6,
    paddingVertical: 3
  },
  group: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 3
  },
  divider: {
    backgroundColor: colors.line,
    height: 20,
    marginHorizontal: 2,
    width: 1
  },
  chip: {
    alignItems: "center",
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 6,
    borderWidth: 1,
    height: 26,
    justifyContent: "center",
    minWidth: 26,
    paddingHorizontal: 7
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
  compositionHint: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 10,
    lineHeight: 14,
    paddingHorizontal: 2
  },
  addChip: {
    alignItems: "center",
    backgroundColor: colors.brandDark,
    borderColor: colors.brandDark,
    borderRadius: 6,
    borderWidth: 1,
    height: 26,
    justifyContent: "center",
    paddingHorizontal: 9
  },
  addChipText: {
    color: "#fff",
    fontFamily: fonts.uiSemibold,
    fontSize: 10
  },
  quickBuildWrap: {
    position: "relative",
    zIndex: 40
  },
  quickBuildMenu: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 8,
    borderWidth: 1,
    gap: 2,
    maxWidth: 280,
    minWidth: 220,
    padding: 6,
    position: "absolute",
    right: 0,
    top: 30,
    zIndex: 50,
    ...({
      boxShadow: "0 8px 24px rgba(28, 22, 16, 0.16)"
    } as object)
  },
  quickBuildOption: {
    borderRadius: 6,
    gap: 2,
    paddingHorizontal: 8,
    paddingVertical: 6
  },
  quickBuildOptionLabel: {
    color: colors.ink,
    fontFamily: fonts.uiSemibold,
    fontSize: 12
  },
  quickBuildOptionDetail: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 10,
    lineHeight: 13
  },
  quickBuildHint: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 9,
    lineHeight: 12,
    paddingHorizontal: 8,
    paddingVertical: 4
  },
  listenChip: {
    alignSelf: "flex-start",
    backgroundColor: colors.redSoft,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3
  },
  listenChipText: {
    color: colors.red,
    fontFamily: fonts.uiSemibold,
    fontSize: 10
  },
  companionPane: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 10,
    borderWidth: 1,
    flexBasis: 280,
    flexGrow: 0,
    flexShrink: 0,
    gap: 8,
    maxWidth: 320,
    minHeight: 0,
    minWidth: 240,
    overflow: "hidden",
    padding: 10,
    width: "34%"
  },
  companionHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between"
  },
  companionHeadingCopy: {
    flex: 1,
    gap: 2,
    minWidth: 0
  },
  companionTitle: {
    color: colors.ink,
    fontFamily: fonts.uiSemibold,
    fontSize: 13
  },
  companionClose: {
    borderColor: colors.line,
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 7,
    paddingVertical: 4
  },
  companionCloseText: {
    color: colors.ink,
    fontFamily: fonts.uiSemibold,
    fontSize: 10
  },
  companionEmpty: {
    gap: 10,
    paddingVertical: 4
  },
  companionAction: {
    alignSelf: "flex-start",
    backgroundColor: colors.brandDark,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 7
  },
  companionActionText: {
    color: "#fff",
    fontFamily: fonts.uiSemibold,
    fontSize: 11
  },
  companionScroll: {
    flex: 1,
    minHeight: 0
  },
  backdropImage: {
    backgroundColor: colors.wash,
    borderRadius: 8,
    height: 160,
    marginBottom: 8,
    width: "100%"
  },
  assistPane: {
    flex: 1,
    minHeight: 280,
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
    gap: 2,
    marginBottom: 6,
    padding: 6
  },
  sheetCardHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    justifyContent: "space-between"
  },
  sheetTitle: {
    color: colors.ink,
    flex: 1,
    fontFamily: fonts.story,
    fontSize: 15,
    minWidth: 0
  },
  sheetLinkButton: {
    borderColor: colors.line,
    borderRadius: 5,
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 3
  },
  sheetLinkButtonText: {
    color: colors.muted,
    fontFamily: fonts.uiSemibold,
    fontSize: 10
  },
  linkCastSection: {
    borderTopColor: colors.line,
    borderTopWidth: 1,
    gap: 6,
    marginTop: 8,
    paddingTop: 8
  },
  linkCastRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between"
  },
  linkCastLabel: {
    color: colors.ink,
    flex: 1,
    fontFamily: fonts.uiMedium,
    fontSize: 12,
    minWidth: 0
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
    minHeight: 52,
    paddingHorizontal: 8,
    paddingVertical: 6,
    textAlignVertical: "top"
  },
  detailInput: {
    borderColor: colors.line,
    borderRadius: 6,
    borderWidth: 1,
    color: colors.ink,
    fontFamily: fonts.story,
    fontSize: 15,
    lineHeight: 22,
    minHeight: 180,
    paddingHorizontal: 10,
    paddingVertical: 10,
    textAlignVertical: "top"
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
    marginTop: 4,
    padding: 10
  },
  inkHint: {
    color: "#9a8474",
    fontFamily: fonts.uiMedium,
    fontSize: 12
  },
  modalRoot: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    padding: 20
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(40, 35, 31, 0.45)"
  },
  modalCard: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 12,
    borderWidth: 1,
    maxHeight: "88%",
    maxWidth: 520,
    overflow: "hidden",
    width: "100%",
    zIndex: 1
  },
  assistModalCard: {
    maxWidth: 440
  },
  modalHeader: {
    alignItems: "flex-start",
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12
  },
  modalHeadingCopy: {
    flex: 1,
    gap: 2,
    minWidth: 0
  },
  modalTitle: {
    color: colors.ink,
    fontFamily: fonts.story,
    fontSize: 24
  },
  modalRule: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 11,
    lineHeight: 15,
    marginTop: 2
  },
  modalClose: {
    alignItems: "center",
    borderColor: colors.line,
    borderRadius: 6,
    borderWidth: 1,
    height: 28,
    justifyContent: "center",
    width: 28
  },
  modalCloseText: {
    color: colors.ink,
    fontFamily: fonts.uiSemibold,
    fontSize: 16,
    lineHeight: 18
  },
  modalScroll: {
    flexGrow: 0,
    maxHeight: 420
  },
  modalBody: {
    gap: 8,
    padding: 16
  },
  modalFooter: {
    alignItems: "center",
    borderTopColor: colors.line,
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 8,
    justifyContent: "flex-end",
    paddingHorizontal: 16,
    paddingVertical: 12
  },
  modalSecondary: {
    borderColor: colors.line,
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  modalSecondaryText: {
    color: colors.ink,
    fontFamily: fonts.uiSemibold,
    fontSize: 11
  },
  pressed: {
    opacity: 0.72
  },
  disabled: {
    opacity: 0.42
  }
});
