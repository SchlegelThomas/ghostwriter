import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { CharacterCreateV2, StoryWorkArtifactPointer } from "@ghostwriter/core";
import {
  characterReviewFields, characterReviewHasEdits, characterReviewPayload, sameCharacterReviewArtifact,
  type CharacterReviewArtifact, type CharacterReviewFields
} from "./character-story-work-review.js";
import { ghostwriterTheme } from "./theme.js";

const { colors, fonts } = ghostwriterTheme;
const REVIEW_HEADING_ID = "character-story-work-review-heading";
const FIELDS: ReadonlyArray<Readonly<{ key: keyof CharacterReviewFields; label: string; limit: number }>> = [
  { key: "name", label: "Name", limit: 120 },
  { key: "summary", label: "Character summary", limit: 4000 },
  { key: "aliases", label: "Aliases · one per line", limit: 3900 },
  { key: "desire", label: "Desire", limit: 2000 },
  { key: "pressure", label: "Pressure", limit: 2000 },
  { key: "voiceNotes", label: "Voice notes", limit: 2000 }
];

export type CharacterStoryWorkReviewProps = Readonly<{
  artifact: CharacterReviewArtifact;
  brief: string;
  constraints: string;
  doneWhen: string;
  revisionInstruction?: string;
  refreshProblem?: string;
  status: "review" | "applied" | "rejected";
  onSave(input: Readonly<{ artifact: StoryWorkArtifactPointer; payload: CharacterCreateV2 }>): Promise<CharacterReviewArtifact>;
  onApply(artifact: StoryWorkArtifactPointer): Promise<void>;
  onReject(artifact: StoryWorkArtifactPointer): Promise<void>;
  onRevise(input: Readonly<{ artifact: StoryWorkArtifactPointer; instruction: string }>): Promise<void>;
  onClose(): void;
  onReload?(): Promise<void>;
  onOpenCharacter?(): void;
  onDirtyChange?(dirty: boolean): void;
  onBusyChange?(busy: boolean): void;
}>;

/** Review is fenced by the exact acknowledged artifact, never by the visible title. */
export function CharacterStoryWorkReview(props: CharacterStoryWorkReviewProps) {
  const [baseline, setBaseline] = useState(props.artifact);
  const [fields, setFields] = useState(() => characterReviewFields(props.artifact.payload));
  const [instruction, setInstruction] = useState("");
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const dirty = characterReviewHasEdits(fields, baseline.payload);
  const stale = !sameCharacterReviewArtifact(baseline.pointer, props.artifact.pointer);
  const writable = props.status === "review" && !pending && !stale;

  useEffect(() => { props.onDirtyChange?.(dirty || instruction.trim().length > 0); }, [dirty, instruction, props.onDirtyChange]);
  useEffect(() => () => props.onDirtyChange?.(false), [props.onDirtyChange]);
  useEffect(() => {
    if (typeof document === "undefined") return;
    const timer = setTimeout(() => {
      const heading = document.getElementById(REVIEW_HEADING_ID);
      if (!(heading instanceof HTMLElement)) return;
      heading.tabIndex = -1;
      heading.focus();
    }, 30);
    return () => clearTimeout(timer);
  }, []);

  async function perform(action: () => Promise<void>, success: string) {
    if (pendingRef.current) return;
    pendingRef.current = true;
    props.onBusyChange?.(true);
    setPending(true); setMessage(undefined); setError(undefined);
    try { await action(); setMessage(success); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The action was not acknowledged. Your review is still here."); }
    finally { pendingRef.current = false; setPending(false); props.onBusyChange?.(false); }
  }

  function reloadArtifact() {
    setBaseline(props.artifact); setFields(characterReviewFields(props.artifact.payload));
    setMessage("Latest artifact loaded."); setError(undefined);
  }

  return <View accessibilityLabel="Character review" style={styles.root}>
    <View style={styles.header}>
      <View style={styles.heading}>
        <Text style={styles.kicker}>CHARACTER · {props.status === "applied" ? "ADDED TO CAST" : props.status === "rejected" ? "REJECTED" : "REVIEW"}</Text>
        <Text accessibilityRole="header" nativeID={REVIEW_HEADING_ID} style={styles.title}>{baseline.payload.name}</Text>
      </View>
      <Action label="Back to story" disabled={pending} onPress={() => {
        if (dirty || instruction.trim()) { setError("Save or discard your edits and revision request before leaving this review."); return; }
        props.onClose();
      }} />
    </View>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.label}>Your original brief</Text>
      <Text style={styles.body}>{props.brief}</Text>
      <Text style={styles.label}>Constraints</Text><Text style={styles.body}>{props.constraints}</Text>
      <Text style={styles.label}>Done when</Text><Text style={styles.body}>{props.doneWhen}</Text>
      {props.revisionInstruction ? <><Text style={styles.label}>Revision request for this artifact</Text><Text style={styles.body}>{props.revisionInstruction}</Text></> : null}
      <Text style={styles.hint}>This character becomes part of your story only after Add to Cast is acknowledged.</Text>
      {stale ? <View style={styles.notice}>
        <Text style={styles.body}>{dirty ? "A newer artifact is available. Your local edits are still shown; reload before saving or applying." : "A newer artifact is ready. Load it to review the revised dossier before applying."}</Text>
        <Action label={dirty ? "Discard edits and load latest artifact" : "Load latest artifact"} disabled={pending} onPress={reloadArtifact} />
      </View> : null}
      {FIELDS.map(({ key, label, limit }) => <View key={key} style={styles.field}>
        <Text style={styles.label}>{label}</Text>
        <TextInput accessibilityLabel={label} editable={writable} multiline={key !== "name"} maxLength={limit}
          value={fields[key]} onChangeText={(value) => { setFields((current) => ({ ...current, [key]: value })); setMessage(undefined); }}
          style={[styles.input, key !== "name" && styles.multiline]} />
      </View>)}
      <Text style={styles.hint}>{baseline.payload.sourceSceneIds?.length ?? 0} explicitly supplied scene sources. Scene links are preserved when editing this dossier.</Text>
      {props.status === "review" ? <>
        <View style={styles.actions}>
          <Action label={pending ? "Working…" : "Save review edits"} disabled={!writable || !dirty} onPress={() => {
            void perform(async () => {
              const saved = await props.onSave({ artifact: baseline.pointer, payload: characterReviewPayload(fields, baseline.payload) });
              setBaseline(saved); setFields(characterReviewFields(saved.payload));
            }, "Review edits saved. Read the updated dossier before adding it to Cast.");
          }} />
          <Action label="Discard local edits" disabled={!dirty || pending} onPress={() => { setFields(characterReviewFields(baseline.payload)); setError(undefined); }} />
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>Ask for a revision</Text>
          <TextInput accessibilityLabel="Character revision request" multiline maxLength={20000} editable={writable}
            value={instruction} onChangeText={setInstruction} style={[styles.input, styles.multiline]} />
          <Text style={styles.hint}>The agent receives this request with your original brief, current artifact and the latest saved revisions of the same selected sources.</Text>
          <View style={styles.actions}>
            <Action label="Revise using latest saved sources" disabled={!writable || dirty || !instruction.trim()} onPress={() => {
              void perform(async () => { await props.onRevise({ artifact: baseline.pointer, instruction }); setInstruction(""); }, "The revision attempt is recorded. Review its result before applying.");
            }} />
            <Action label="Clear revision request" disabled={pending || !instruction} onPress={() => setInstruction("")} />
          </View>
        </View>
        <View style={styles.actions}>
          <Action label="Add to Cast" primary disabled={!writable || dirty || Boolean(instruction.trim())} onPress={() => {
            void perform(() => props.onApply(baseline.pointer), "Added to Cast.");
          }} />
          <Action label="Reject artifact" disabled={!writable || dirty || Boolean(instruction.trim())} onPress={() => {
            void perform(() => props.onReject(baseline.pointer), "Artifact rejected. Your story was not changed.");
          }} />
        </View>
        {dirty ? <Text style={styles.hint}>Save your edits before requesting another version or adding this character to Cast.</Text> : null}
      </> : props.status === "applied" && props.onOpenCharacter ? <Action label="Open character dossier" primary onPress={props.onOpenCharacter} /> : null}
      {message ? <Text accessibilityLiveRegion="polite" style={styles.success}>{message}</Text> : null}
      {error || props.refreshProblem ? <View style={styles.field}><Text accessibilityRole="alert" style={styles.error}>{error ?? props.refreshProblem}</Text>
        {props.onReload ? <Action label="Refresh saved review and story" disabled={pending} onPress={() => { void perform(() => props.onReload!(), "Latest saved review and story loaded. Local edits are retained."); }} /> : null}
      </View> : null}
    </ScrollView>
  </View>;
}

function Action({ label, onPress, disabled = false, primary = false }: Readonly<{ label: string; onPress(): void; disabled?: boolean; primary?: boolean }>) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} accessibilityState={{ disabled }} onPress={onPress}
    style={[styles.button, primary && styles.primary, disabled && styles.disabled]}>
    <Text style={[styles.buttonText, primary && styles.primaryText]}>{label}</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0, minWidth: 0, backgroundColor: colors.paper },
  header: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12, padding: 20, borderBottomWidth: 1, borderBottomColor: colors.line },
  heading: { flex: 1, minWidth: 160 }, kicker: { fontFamily: fonts.uiSemibold, color: colors.accent, fontSize: 10, letterSpacing: 1 },
  title: { fontFamily: fonts.story, color: colors.ink, fontSize: 28, marginTop: 4 },
  content: { padding: 20, gap: 16, maxWidth: 850, width: "100%", alignSelf: "center" },
  field: { gap: 7 }, label: { fontFamily: fonts.uiSemibold, color: colors.ink, fontSize: 13 },
  body: { fontFamily: fonts.ui, color: colors.ink, fontSize: 14, lineHeight: 21 },
  hint: { fontFamily: fonts.ui, color: colors.muted, fontSize: 12, lineHeight: 18 },
  input: { borderWidth: 1, borderColor: colors.line, borderRadius: 8, padding: 12, fontFamily: fonts.ui, fontSize: 14, color: colors.ink, backgroundColor: colors.panel },
  multiline: { minHeight: 86, textAlignVertical: "top" }, actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  button: { minHeight: 42, justifyContent: "center", paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: colors.line, borderRadius: 8, backgroundColor: colors.panel },
  buttonText: { fontFamily: fonts.uiSemibold, fontSize: 12, color: colors.ink }, primary: { backgroundColor: colors.accent, borderColor: colors.accent }, primaryText: { color: colors.panel },
  disabled: { opacity: 0.45 }, notice: { backgroundColor: colors.amberSoft, padding: 12, borderRadius: 8, gap: 8 },
  success: { color: colors.green, fontFamily: fonts.ui, lineHeight: 20 }, error: { color: colors.red, fontFamily: fonts.ui, lineHeight: 20 }
});
