import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { AgentModelId, SceneId, StoryWorkAssignment, StoryWorkAssignmentId, StoryWorkTaskKind } from "@ghostwriter/core";
import type { WorkspaceAvailableModel } from "./workspace-agent-prefs.js";
import { ghostwriterTheme } from "./theme.js";

const { colors, fonts } = ghostwriterTheme;
export const STORY_WORK_HEADING_NATIVE_ID = "story-work-heading";

export function storyWorkAssignmentButtonNativeId(id: StoryWorkAssignmentId): string {
  return `story-work-assignment-${encodeURIComponent(id)}`;
}
const TASK_LABELS: Record<StoryWorkTaskKind, string> = {
  character: "New character", scene: "New scene", outline: "Outline", chapter: "Chapter",
  plan: "Plan", revise: "Revise writing", check: "Check story"
};
const STATUS_LABELS: Record<StoryWorkAssignment["status"], string> = {
  "brief-ready": "Brief ready", running: "Working", "artifact-ready": "Draft ready",
  "awaiting-review": "Awaiting your review", applied: "Applied to story", rejected: "Rejected",
  failed: "Generation failed", canceled: "Canceled", stale: "Sources changed"
};

export type SubmitStoryWorkBrief = Readonly<{
  taskKind: StoryWorkTaskKind;
  brief: string;
  constraints: string;
  doneWhen: string;
  model: AgentModelId;
  sceneIds: readonly SceneId[];
}>;

export type StoryWorkPanelProps = Readonly<{
  projectTitle: string;
  open?: boolean;
  supportedTaskKinds: readonly StoryWorkTaskKind[];
  models: readonly WorkspaceAvailableModel[];
  selectedModel?: AgentModelId;
  scenes: readonly Readonly<{ id: SceneId; title: string }>[];
  selectedSceneId?: SceneId;
  assignments: readonly StoryWorkAssignment[];
  loading?: boolean;
  error?: string;
  onSubmit(input: SubmitStoryWorkBrief): Promise<void>;
  onOpenAssignment(id: StoryWorkAssignmentId): void;
  onRefresh(): void;
  onBackToChat(): void;
  onOpenSettings(): void;
}>;

export function StoryWorkPanel(props: StoryWorkPanelProps) {
  const [taskKind, setTaskKind] = useState<StoryWorkTaskKind>(props.supportedTaskKinds[0] ?? "character");
  const [brief, setBrief] = useState("");
  const [constraints, setConstraints] = useState("");
  const [doneWhen, setDoneWhen] = useState("");
  const [model, setModel] = useState(props.selectedModel);
  const [sceneIds, setSceneIds] = useState<readonly SceneId[]>(props.selectedSceneId ? [props.selectedSceneId] : []);
  const [sourceSearch, setSourceSearch] = useState("");
  const sourcesEdited = useRef(false);
  useEffect(() => {
    if (props.open && !sourcesEdited.current && !brief && !constraints && !doneWhen) {
      setSceneIds(props.selectedSceneId ? [props.selectedSceneId] : []);
    }
  }, [props.open, props.selectedSceneId, brief, constraints, doneWhen]);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [error, setError] = useState<string>();
  const models = props.models.filter((entry) => entry.supportsStructured && entry.adapterReady !== false);
  const chosenModel = models.find((entry) => entry.id === model);
  const visibleScenes = props.scenes.filter((scene) => scene.title.toLowerCase().includes(sourceSearch.toLowerCase())).slice(0, 20);
  const canSubmit = props.supportedTaskKinds.includes(taskKind) && brief.trim().length > 0 && constraints.trim().length > 0 && doneWhen.trim().length > 0 &&
    chosenModel !== undefined && sceneIds.every((id) => props.scenes.some((scene) => scene.id === id)) && !submitting;

  async function submit() {
    if (!canSubmit || submittingRef.current || chosenModel === undefined) return;
    submittingRef.current = true; setSubmitting(true); setError(undefined);
    try {
      await props.onSubmit({ taskKind, brief, constraints, doneWhen, model: chosenModel.id as AgentModelId, sceneIds });
      sourcesEdited.current = false;
      setBrief(""); setConstraints(""); setDoneWhen("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The assignment was not acknowledged. Your brief is still here."); }
    finally { submittingRef.current = false; setSubmitting(false); }
  }

  return <View accessibilityLabel="Story work" style={styles.root}>
    <View style={styles.header}>
      <Text accessibilityRole="header" nativeID={STORY_WORK_HEADING_NATIVE_ID} style={styles.title}>Story work</Text>
      <Button label="Chat" disabled={submitting} onPress={props.onBackToChat} />
    </View>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.hint}>{props.projectTitle}</Text>
      <Text style={styles.label}>What are we developing?</Text>
      <Text style={styles.hint}>Include a brief, constraints and a done condition before starting.</Text>
      <View style={styles.choices}>{props.supportedTaskKinds.map((kind) => <Button key={kind} label={TASK_LABELS[kind]} selected={taskKind === kind} disabled={submitting} onPress={() => setTaskKind(kind)} />)}</View>
      <Text style={styles.hint}>{taskKind === "character" ? "Destination: a new character in Cast, after your review." : "Review the proposed result and its destination before applying it to your story."}</Text>
      <Field label="Your brief" value={brief} onChange={setBrief} limit={20000} disabled={submitting} />
      <Field label="Constraints" value={constraints} onChange={setConstraints} limit={8000} disabled={submitting} />
      <Field label="Done when" value={doneWhen} onChange={setDoneWhen} limit={4000} disabled={submitting} />
      <Text style={styles.label}>Sources</Text>
      <Text style={styles.hint}>Shared story structure and intent are included. Select the scene prose the agent should read.</Text>
      {sceneIds.length ? <Text style={styles.hint}>Selected: {sceneIds.map((id) => props.scenes.find((scene) => scene.id === id)?.title ?? "Unavailable scene").join(", ")}</Text> : <Text style={styles.hint}>No manuscript prose selected.</Text>}
      <TextInput accessibilityLabel="Find a source scene" placeholder="Find a scene" value={sourceSearch} onChangeText={setSourceSearch} style={styles.input} />
      <View style={styles.choices}>{visibleScenes.map((scene) => <Button key={scene.id} label={scene.title} selected={sceneIds.includes(scene.id)} disabled={submitting || (!sceneIds.includes(scene.id) && sceneIds.length >= 32)} onPress={() => {
        sourcesEdited.current = true;
        setSceneIds((current) => current.includes(scene.id) ? current.filter((id) => id !== scene.id) : [...current, scene.id]);
      }} />)}</View>
      {props.scenes.length > visibleScenes.length ? <Text style={styles.hint}>Showing up to 20 matching scenes. Search to find others.</Text> : null}
      <Text style={styles.label}>Model</Text>
      {models.length ? <View style={styles.choices}>{models.map((entry) => <Button key={entry.id} label={entry.label} selected={entry.id === model} disabled={submitting} onPress={() => setModel(entry.id as AgentModelId)} />)}</View> : <>
        <Text style={styles.hint}>Connect a provider with a structured-output model to start story work.</Text>
        <Button label="Open provider settings" onPress={props.onOpenSettings} />
      </>}
      <Button label={submitting ? "Starting assignment…" : "Start assignment"} disabled={!canSubmit} selected onPress={() => { void submit(); }} />
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <View style={styles.header}><Text accessibilityRole="header" style={styles.label}>Assignments</Text><Button label="Refresh assignments" disabled={props.loading} onPress={props.onRefresh} /></View>
      {props.loading ? <Text accessibilityLiveRegion="polite" style={styles.hint}>Loading assignments…</Text> : null}
      {props.error ? <Text accessibilityRole="alert" style={styles.error}>{props.error}</Text> : null}
      {!props.loading && !props.error && props.assignments.length === 0 ? <Text style={styles.hint}>Your assignments and reviewed results will appear here.</Text> : null}
      {props.assignments.map((assignment) => <Pressable key={assignment.id} accessibilityRole="button" accessibilityLabel={`${TASK_LABELS[assignment.taskKind]} · ${STATUS_LABELS[assignment.status]} · ${assignment.brief}`} nativeID={storyWorkAssignmentButtonNativeId(assignment.id)} onPress={() => props.onOpenAssignment(assignment.id)} style={styles.assignment}>
        <Text style={styles.label}>{TASK_LABELS[assignment.taskKind]} · {STATUS_LABELS[assignment.status]}</Text>
        <Text style={styles.body} numberOfLines={3}>{assignment.brief}</Text>
        <Text style={styles.hint}>{assignment.currentArtifact ? "Open result and review" : "Open assignment"}</Text>
      </Pressable>)}
    </ScrollView>
  </View>;
}

function Field({ label, value, onChange, limit, disabled }: Readonly<{ label: string; value: string; onChange(value: string): void; limit: number; disabled: boolean }>) {
  return <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput accessibilityLabel={label} multiline editable={!disabled} maxLength={limit} value={value} onChangeText={onChange} style={[styles.input, styles.multiline]} /></View>;
}
function Button({ label, onPress, disabled = false, selected = false }: Readonly<{ label: string; onPress(): void; disabled?: boolean; selected?: boolean }>) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled, selected }} disabled={disabled} onPress={onPress} style={[styles.button, selected && styles.selected, disabled && styles.disabled]}><Text style={styles.buttonText}>{label}</Text></Pressable>;
}
const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0, minWidth: 0, backgroundColor: colors.paper },
  header: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8, padding: 10 },
  content: { padding: 12, gap: 12 }, title: { fontFamily: fonts.story, color: colors.ink, fontSize: 24 },
  label: { fontFamily: fonts.uiSemibold, color: colors.ink, fontSize: 12 }, body: { fontFamily: fonts.ui, color: colors.ink, fontSize: 13, lineHeight: 19 },
  hint: { fontFamily: fonts.ui, color: colors.muted, fontSize: 12, lineHeight: 18 },
  field: { gap: 6 }, input: { minWidth: 0, borderWidth: 1, borderColor: colors.line, borderRadius: 7, padding: 10, fontFamily: fonts.ui, color: colors.ink, fontSize: 13, backgroundColor: colors.panel },
  multiline: { minHeight: 72, textAlignVertical: "top" }, choices: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  button: { borderWidth: 1, borderColor: colors.line, borderRadius: 7, padding: 10, minHeight: 40, justifyContent: "center", backgroundColor: colors.panel },
  selected: { borderColor: colors.accent, backgroundColor: colors.accentSoft }, disabled: { opacity: 0.45 }, buttonText: { color: colors.ink, fontFamily: fonts.uiSemibold, fontSize: 12 },
  assignment: { borderWidth: 1, borderColor: colors.line, borderRadius: 8, padding: 12, gap: 6 }, error: { fontFamily: fonts.ui, color: colors.red, fontSize: 12, lineHeight: 18 }
});
