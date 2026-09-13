import {
  storyContextFromProjectNavigator,
  type NarrativeBeatId,
  type NarrativeBeatRole,
  type NarrativeThreadResolution,
  type ProjectCommand,
  type ProjectNavigator,
  type SceneId,
  type StoryKnowledgeId
} from "@ghostwriter/core";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import {
  continueStoryIntentDraft,
  continueStoryTextDraft,
  createStoryIntentEditState,
  createStoryTextEditState,
  acknowledgedNarrativeBeatId,
  editStoryIntent,
  editStoryText,
  narrativeAnchorLabel,
  narrativeDependencyChoices,
  reconcileStoryIntent,
  reconcileStoryText,
  storyContextThreadChoices,
  storyIntentHasChanges,
  storyIntentPatch,
  storyIntentSaveResult,
  storyIntentSaving,
  storyNarrativeDraftMatchesSubmission,
  storyTextSaveResult,
  storyTextSaving,
  threadSceneSemantics,
  useLatestStoryIntent,
  useLatestStoryText,
  type StoryIntentDraft,
  type StoryNarrativeBeatSubmission
} from "./story-context-companion.js";
import { ghostwriterTheme } from "./theme.js";

const { colors, fonts } = ghostwriterTheme;

const ROLES: readonly NarrativeBeatRole[] = [
  "setup",
  "development",
  "payoff",
  "consequence"
];
const RESOLUTIONS: readonly NarrativeThreadResolution[] = [
  "open",
  "intentionally-open",
  "resolved"
];

type NarrativeDraft = Readonly<{
  projectVersion: number;
  threadId?: StoryKnowledgeId;
  beatId?: NarrativeBeatId;
  role: NarrativeBeatRole;
  summary: string;
  dependencyIds: readonly NarrativeBeatId[];
  dirty: boolean;
  stale: boolean;
  status?: "saving" | "saved" | "not-saved";
  submitted?: StoryNarrativeBeatSubmission;
}>;

export type StoryContextCompanionProps = Readonly<{
  project: ProjectNavigator;
  sceneId: SceneId;
  onCommand(command: ProjectCommand): Promise<boolean>;
  onOpenScene(sceneId: SceneId): void;
  onShowCanvas?(): void;
  onDirtyChange?(dirty: boolean): void;
  busy?: boolean;
}>;

function Button({
  label,
  onPress,
  disabled = false,
  selected = false,
  quiet = false
}: Readonly<{
  label: string;
  onPress(): void;
  disabled?: boolean;
  selected?: boolean;
  quiet?: boolean;
}>) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        quiet ? styles.quietButton : styles.button,
        selected && styles.buttonSelected,
        pressed && styles.pressed,
        disabled && styles.disabled
      ]}
    >
      <Text
        style={[
          quiet ? styles.quietButtonText : styles.buttonText,
          selected && styles.buttonSelectedText
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function LabeledInput({
  label,
  value,
  onChangeText,
  editable,
  multiline = false,
  placeholder
}: Readonly<{
  label: string;
  value: string;
  onChangeText(value: string): void;
  editable: boolean;
  multiline?: boolean;
  placeholder?: string;
}>) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        editable={editable}
        multiline={multiline}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        style={[styles.input, multiline && styles.multilineInput, !editable && styles.disabledInput]}
        value={value}
      />
    </View>
  );
}

function StatusText({ status }: Readonly<{ status?: string }>) {
  if (status === undefined || status === "ready" || status === "editing") return null;
  const label =
    status === "saving"
      ? "Saving…"
      : status === "saved"
        ? "Saved"
        : status === "canonical-changed"
          ? "Story records changed while you were editing. Review before saving."
          : "Not saved. Your edits are still here.";
  return <Text style={status === "saved" ? styles.success : styles.status}>{label}</Text>;
}

/**
 * A shared, canonical story-context editor for Draft and Canvas hosts.
 * Hosts should key this component by sceneId and resolve dirty navigation before
 * changing that key; the internal state still preserves dirty text if they do not.
 */
export function StoryContextCompanion({
  project,
  sceneId,
  onCommand,
  onOpenScene,
  onShowCanvas,
  onDirtyChange,
  busy = false
}: StoryContextCompanionProps) {
  const context = useMemo(
    () => storyContextFromProjectNavigator(project, { scope: { kind: "scene", sceneId } }),
    [project, sceneId]
  );
  const scene = context.scenes[0];
  if (scene === undefined) {
    throw new Error(`Story context did not return scene "${sceneId}".`);
  }

  const [intent, setIntent] = useState(() =>
    createStoryIntentEditState(scene.id, project.version, scene.intent)
  );
  const objectiveIdentity = scene.chapter === undefined || scene.part === undefined
    ? `unassigned:${scene.id}`
    : `${scene.book.id}:${scene.part.id}:${scene.chapter.id}`;
  const [objective, setObjective] = useState(() =>
    createStoryTextEditState(objectiveIdentity, project.version, scene.chapter?.objective)
  );
  const [threadSearch, setThreadSearch] = useState("");
  const [threadCreationOpen, setThreadCreationOpen] = useState(false);
  const pendingThreadCreation = useRef<{ label: string; existingIds: readonly StoryKnowledgeId[] } | undefined>(undefined);
  const threadChoices = useMemo(
    () => storyContextThreadChoices(project, context, undefined, threadSearch),
    [context, project, threadSearch]
  );
  const [narrative, setNarrative] = useState<NarrativeDraft>(() => ({
    projectVersion: project.version,
    ...(threadChoices[0] === undefined ? {} : { threadId: threadChoices[0].id }),
    role: "setup",
    summary: "",
    dependencyIds: Object.freeze([]),
    dirty: false,
    stale: false
  }));
  const [threadLabel, setThreadLabel] = useState("");
  const [threadCreateStatus, setThreadCreateStatus] = useState<string>();
  const [narrativeStatus, setNarrativeStatus] = useState<string>();
  const narrativeSavePendingRef = useRef(false);

  useEffect(() => {
    setIntent((current) =>
      reconcileStoryIntent(current, scene.id, project.version, scene.intent)
    );
  }, [project.version, scene.id, scene.intent]);
  useEffect(() => {
    setObjective((current) =>
      reconcileStoryText(
        current,
        objectiveIdentity,
        project.version,
        scene.chapter?.objective
      )
    );
  }, [objectiveIdentity, project.version, scene.chapter?.objective]);
  useEffect(() => {
    setNarrative((current) => {
      if (current.projectVersion === project.version) return current;
      const canonicalThread = project.storyKnowledge.find(
        (knowledge) => knowledge.id === current.threadId && knowledge.kind === "thread"
      );
      const acknowledgedBeatId = current.submitted === undefined
        ? undefined
        : acknowledgedNarrativeBeatId(
            current.submitted,
            canonicalThread?.narrative?.beats ?? []
          );
      if (current.submitted !== undefined && acknowledgedBeatId !== undefined) {
        const hasLaterEdits = !storyNarrativeDraftMatchesSubmission(
          {
            ...(current.threadId === undefined ? {} : { threadId: current.threadId }),
            sceneId: scene.id,
            ...(current.beatId === undefined ? {} : { beatId: current.beatId }),
            role: current.role,
            summary: current.summary,
            dependencyIds: current.dependencyIds
          },
          current.submitted
        );
        return {
          ...current,
          beatId: acknowledgedBeatId,
          projectVersion: project.version,
          dirty: hasLaterEdits,
          stale: false,
          status: narrativeSavePendingRef.current ? "saving" : hasLaterEdits ? undefined : "saved",
          submitted: narrativeSavePendingRef.current ? current.submitted : undefined
        };
      }
      if (current.dirty || current.submitted !== undefined) {
        return { ...current, stale: true };
      }
      const canonicalBeat = canonicalThread?.narrative?.beats.find(
        (beat) => beat.id === current.beatId
      );
      return {
        ...current,
        projectVersion: project.version,
        role: canonicalBeat?.role ?? "setup",
        summary: canonicalBeat?.summary ?? "",
        dependencyIds: Object.freeze([...(canonicalBeat?.dependsOnBeatIds ?? [])]),
        stale: false
      };
    });
  }, [project.storyKnowledge, project.version, scene.id]);
  useEffect(() => {
    if (narrative.threadId !== undefined || threadChoices[0] === undefined) return;
    setNarrative((current) => ({ ...current, threadId: threadChoices[0]?.id }));
  }, [narrative.threadId, threadChoices]);

  useEffect(() => {
    const pending = pendingThreadCreation.current;
    if (pending === undefined) return;
    const candidates = project.storyKnowledge.filter((item) =>
      item.kind === "thread" && item.label === pending.label && !pending.existingIds.includes(item.id));
    if (candidates.length !== 1) return;
    pendingThreadCreation.current = undefined;
    setThreadCreationOpen(false);
    setThreadSearch(pending.label);
    setNarrative({ projectVersion: project.version, threadId: candidates[0]!.id,
      role: "setup", summary: "", dependencyIds: [], dirty: false, stale: false });
  }, [project.storyKnowledge, project.version]);

  const selectedThread = project.storyKnowledge.find(
    (knowledge) => knowledge.id === narrative.threadId && knowledge.kind === "thread"
  );
  const selectedContextThread = context.threads.find(
    (thread) => thread.id === narrative.threadId
  );
  const selectedBeat = selectedThread?.narrative?.beats.find(
    (beat) => beat.id === narrative.beatId
  );
  const dependencyChoices = useMemo(
    () => selectedThread === undefined
      ? Object.freeze([])
      : narrativeDependencyChoices(project, selectedThread, {
          ...(narrative.beatId === undefined ? {} : { excludeBeatId: narrative.beatId }),
          includeBeatIds: narrative.dependencyIds
        }),
    [narrative.beatId, narrative.dependencyIds, project, selectedThread]
  );
  const archived =
    scene.archival.projectArchived ||
    scene.archival.bookArchived ||
    scene.archival.sceneArchived;
  const threadArchived = selectedThread?.archivedAt !== undefined;
  const writesDisabled = busy || archived;
  const narrativeWritesDisabled = writesDisabled || threadArchived;
  const intentSaving = intent.status === "saving";
  const objectiveSaving = objective.status === "saving";
  const narrativeSaving = narrative.status === "saving";
  const hasPendingEdits =
    storyIntentHasChanges(intent) ||
    objective.base.trim() !== objective.draft.trim() ||
    narrative.dirty ||
    threadLabel.trim().length > 0;

  useEffect(() => {
    onDirtyChange?.(hasPendingEdits);
  }, [hasPendingEdits, onDirtyChange]);

  const runCommand = async (command: ProjectCommand): Promise<boolean> => {
    try {
      return await onCommand(command);
    } catch {
      return false;
    }
  };

  const saveIntent = async () => {
    if (
      writesDisabled ||
      intentSaving ||
      intent.status === "canonical-changed" ||
      intent.projectVersion !== project.version ||
      !storyIntentHasChanges(intent)
    ) return;
    const saving = storyIntentSaving(intent);
    setIntent(saving);
    const saved = await runCommand({
      type: "scene.updateIntent",
      sceneId: scene.id,
      patch: storyIntentPatch(saving.base, saving.draft)
    });
    setIntent((current) => storyIntentSaveResult(current, saved));
  };

  const saveObjective = async () => {
    if (
      writesDisabled ||
      objectiveSaving ||
      scene.chapter === undefined ||
      scene.part === undefined ||
      objective.status === "canonical-changed" ||
      objective.projectVersion !== project.version ||
      objective.base.trim() === objective.draft.trim()
    ) return;
    const saving = storyTextSaving(objective);
    setObjective(saving);
    const value = saving.draft.trim();
    const saved = await runCommand({
      type: "chapter.update",
      bookId: scene.book.id,
      partId: scene.part.id,
      chapterId: scene.chapter.id,
      summary: value.length === 0 ? null : value
    });
    setObjective((current) => storyTextSaveResult(current, saved));
  };

  const beginBeat = (beatId?: NarrativeBeatId) => {
    const beat = selectedThread?.narrative?.beats.find((candidate) => candidate.id === beatId);
    setNarrative({
      projectVersion: project.version,
      ...(selectedThread === undefined ? {} : { threadId: selectedThread.id }),
      ...(beat === undefined ? {} : { beatId: beat.id }),
      role: beat?.role ?? "setup",
      summary: beat?.summary ?? "",
      dependencyIds: Object.freeze([...(beat?.dependsOnBeatIds ?? [])]),
      dirty: false,
      stale: false
    });
    setNarrativeStatus(undefined);
  };

  const editNarrative = (patch: Partial<Pick<NarrativeDraft, "role" | "summary" | "dependencyIds">>) => {
    setNarrative((current) => ({
      ...current,
      ...patch,
      dirty: true,
      stale: current.stale || current.projectVersion !== project.version,
      status: undefined
    }));
  };

  const saveBeat = async () => {
    if (
      narrativeSavePendingRef.current ||
      narrative.status === "saving" ||
      selectedThread === undefined ||
      narrativeWritesDisabled ||
      narrative.stale ||
      narrative.projectVersion !== project.version ||
      narrative.summary.trim().length === 0
    ) return;
    const submission: StoryNarrativeBeatSubmission = {
      projectVersion: project.version,
      threadId: selectedThread.id,
      sceneId: scene.id,
      ...(narrative.beatId === undefined ? {} : { beatId: narrative.beatId }),
      role: narrative.role,
      summary: narrative.summary.trim(),
      dependencyIds: Object.freeze([...narrative.dependencyIds]),
      existingBeatIds: Object.freeze([
        ...(selectedThread.narrative?.beats.map((beat) => beat.id) ?? [])
      ])
    };
    narrativeSavePendingRef.current = true;
    setNarrative((current) => ({ ...current, status: "saving", submitted: submission }));
    const command: ProjectCommand = submission.beatId === undefined
      ? {
          type: "storyKnowledge.addNarrativeBeat",
          storyKnowledgeId: submission.threadId,
          sceneId: submission.sceneId,
          role: submission.role,
          summary: submission.summary,
          dependsOnBeatIds: submission.dependencyIds
        }
      : {
          type: "storyKnowledge.updateNarrativeBeat",
          storyKnowledgeId: submission.threadId,
          beatId: submission.beatId,
          patch: {
            role: submission.role,
            summary: submission.summary,
            dependsOnBeatIds: submission.dependencyIds
          }
        };
    const saved = await runCommand(command);
    narrativeSavePendingRef.current = false;
    setNarrative((current) => {
      if (saved && current.submitted === undefined) return current;
      const hasLaterEdits = !storyNarrativeDraftMatchesSubmission(
        {
          ...(current.threadId === undefined ? {} : { threadId: current.threadId }),
          sceneId: scene.id,
          ...(current.beatId === undefined ? {} : { beatId: current.beatId }),
          role: current.role,
          summary: current.summary,
          dependencyIds: current.dependencyIds
        },
        submission
      );
      return {
        ...current,
        dirty: saved ? hasLaterEdits : true,
        status: saved && !current.stale
          ? hasLaterEdits ? undefined : "saved"
          : saved ? undefined : "not-saved",
        ...(!saved || current.projectVersion > submission.projectVersion
          ? { submitted: undefined }
          : { submitted: submission })
      };
    });
  };

  const setBeatArchived = async (beatId: NarrativeBeatId, beatArchived: boolean) => {
    if (
      selectedThread === undefined ||
      narrativeWritesDisabled ||
      narrative.stale ||
      narrative.projectVersion !== project.version
    ) return;
    const saved = await runCommand({
      type: "storyKnowledge.setNarrativeBeatArchived",
      storyKnowledgeId: selectedThread.id,
      beatId,
      archived: beatArchived
    });
    setNarrativeStatus(saved ? (beatArchived ? "Beat archived" : "Beat restored") : "Not saved");
  };

  const setResolution = async (resolution: NarrativeThreadResolution) => {
    if (
      selectedThread?.narrative === undefined ||
      narrativeWritesDisabled ||
      narrative.stale ||
      narrative.projectVersion !== project.version
    ) return;
    const saved = await runCommand({
      type: "storyKnowledge.setNarrativeResolution",
      storyKnowledgeId: selectedThread.id,
      resolution
    });
    setNarrativeStatus(saved ? "Thread state saved" : "Not saved");
  };

  const createThread = async () => {
    const label = threadLabel.trim();
    if (writesDisabled || narrative.dirty || narrativeSaving || threadCreateStatus === "Saving…" || label.length === 0) return;
    pendingThreadCreation.current = { label, existingIds: project.storyKnowledge.map((item) => item.id) };
    setThreadCreateStatus("Saving…");
    const saved = await runCommand({
      type: "storyKnowledge.create",
      label,
      kind: "thread",
      authority: "planned"
    });
    setThreadCreateStatus(saved ? "Thread created in story records" : "Not saved");
    if (saved) setThreadLabel("");
    else pendingThreadCreation.current = undefined;
  };

  const intentFields: readonly Readonly<{
    key: keyof StoryIntentDraft;
    label: string;
    placeholder: string;
  }>[] = [
    { key: "purpose", label: "Purpose", placeholder: "What must this scene accomplish?" },
    { key: "conflict", label: "Conflict", placeholder: "What presses against the scene?" },
    { key: "turn", label: "Turn", placeholder: "What changes by the end?" },
    { key: "openQuestions", label: "Questions", placeholder: "What remains unresolved?" }
  ];

  return (
    <ScrollView accessibilityLabel="Story context" contentContainerStyle={styles.body}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>Story context</Text>
          <Text style={styles.title}>{scene.title}</Text>
          <Text style={styles.path}>
            {scene.book.title}
            {scene.part === undefined ? " · Unassigned" : ` · ${scene.part.title}`}
            {scene.chapter === undefined ? "" : ` · ${scene.chapter.title}`}
          </Text>
        </View>
        {onShowCanvas === undefined ? null : (
          <Button label="Show in Canvas" onPress={onShowCanvas} quiet />
        )}
      </View>

      <View style={styles.navigationRow}>
        <Button
          disabled={scene.previousScene === undefined || hasPendingEdits}
          label={scene.previousScene === undefined ? "No previous scene" : `← ${scene.previousScene.title}`}
          onPress={() => scene.previousScene === undefined ? undefined : onOpenScene(scene.previousScene.id)}
          quiet
        />
        <Button
          disabled={scene.nextScene === undefined || hasPendingEdits}
          label={scene.nextScene === undefined ? "No next scene" : `${scene.nextScene.title} →`}
          onPress={() => scene.nextScene === undefined ? undefined : onOpenScene(scene.nextScene.id)}
          quiet
        />
      </View>

      {hasPendingEdits ? (
        <Text style={styles.status}>Save or discard your edits before moving to another scene.</Text>
      ) : null}

      {archived ? (
        <Text style={styles.warning}>This project, book, or scene is archived. Story-context editing is unavailable.</Text>
      ) : null}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Chapter objective</Text>
        {scene.chapter === undefined || scene.part === undefined ? (
          <Text style={styles.empty}>Place this scene in a chapter to give it a chapter objective.</Text>
        ) : (
          <>
            <LabeledInput
              editable={!writesDisabled && !objectiveSaving}
              label="Objective"
              multiline
              onChangeText={(value) => setObjective((current) => editStoryText(current, value))}
              placeholder="What does this chapter move forward?"
              value={objective.draft}
            />
            {objective.status === "canonical-changed" ? (
              <View style={styles.notice}>
                <Text style={styles.warning}>The chapter changed while you were editing. Review which text to keep.</Text>
                <View style={styles.actions}>
                  <Button label="Use latest" onPress={() => setObjective(useLatestStoryText)} quiet />
                  {objective.incoming?.identity === objective.identity ? (
                    <Button label="Continue with my draft" onPress={() => setObjective(continueStoryTextDraft)} quiet />
                  ) : null}
                </View>
              </View>
            ) : null}
            <View style={styles.actions}>
              <Button
                disabled={writesDisabled || objectiveSaving || objective.status === "canonical-changed" || objective.projectVersion !== project.version || objective.base.trim() === objective.draft.trim()}
                label="Save objective"
                onPress={() => void saveObjective()}
              />
              {objective.base.trim() === objective.draft.trim() ? null : (
                <Button
                  disabled={objectiveSaving}
                  label="Discard objective draft"
                  onPress={() => setObjective(
                    createStoryTextEditState(
                      objectiveIdentity,
                      project.version,
                      scene.chapter?.objective
                    )
                  )}
                  quiet
                />
              )}
              <StatusText status={objective.status} />
            </View>
          </>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Scene intent</Text>
        <Text style={styles.help}>Manual craft notes shared by Draft and Canvas.</Text>
        {intentFields.map((field) => (
          <LabeledInput
            editable={!writesDisabled && !intentSaving}
            key={field.key}
            label={field.label}
            multiline
            onChangeText={(value) => setIntent((current) => editStoryIntent(current, field.key, value))}
            placeholder={field.placeholder}
            value={intent.draft[field.key]}
          />
        ))}
        {intent.status === "canonical-changed" ? (
          <View style={styles.notice}>
            <Text style={styles.warning}>The canonical scene changed while you were editing. Review which text to keep.</Text>
            <View style={styles.actions}>
              <Button label="Use latest" onPress={() => setIntent(useLatestStoryIntent)} quiet />
              {intent.incoming?.sceneId === intent.sceneId ? (
                <Button label="Continue with my draft" onPress={() => setIntent(continueStoryIntentDraft)} quiet />
              ) : null}
            </View>
          </View>
        ) : null}
        <View style={styles.actions}>
          <Button
            disabled={writesDisabled || intentSaving || intent.status === "canonical-changed" || intent.projectVersion !== project.version || !storyIntentHasChanges(intent)}
            label="Save scene intent"
            onPress={() => void saveIntent()}
          />
          {storyIntentHasChanges(intent) ? (
            <Button
              disabled={intentSaving}
              label="Discard intent draft"
              onPress={() => setIntent(
                createStoryIntentEditState(scene.id, project.version, scene.intent)
              )}
              quiet
            />
          ) : null}
          <StatusText status={intent.status} />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Story threads</Text>
        <LabeledInput label="Find a thread" value={threadSearch} onChangeText={setThreadSearch} placeholder="Search story threads" editable={!narrativeSaving} />
        <Button label={threadCreationOpen ? "Cancel new thread" : "New thread"} disabled={narrative.dirty || narrativeSaving || threadCreateStatus === "Saving…"} quiet onPress={() => { setThreadCreationOpen(!threadCreationOpen); setThreadLabel(""); }} />
        {threadCreationOpen || !project.storyKnowledge.some((item) => item.kind === "thread") ? (
          <View style={styles.notice}>
            <Text style={styles.empty}>Create thread in story records</Text>
            <LabeledInput
              editable={!writesDisabled && threadCreateStatus !== "Saving…"}
              label="Thread name"
              onChangeText={setThreadLabel}
              placeholder="A promise, question, or line of change"
              value={threadLabel}
            />
            <View style={styles.actions}>
              <Button disabled={writesDisabled || narrative.dirty || narrativeSaving || threadCreateStatus === "Saving…" || threadLabel.trim().length === 0} label="Create thread" onPress={() => void createThread()} />
              {threadCreateStatus === undefined ? null : <Text style={threadCreateStatus.startsWith("Not") ? styles.status : styles.success}>{threadCreateStatus}</Text>}
            </View>
          </View>
        ) : null}
        {threadChoices.length === 0 ? <Text style={styles.empty}>No matching threads. Create one or change your search.</Text> : (
          <>
            <View style={styles.choiceRow}>
              {threadChoices.map((choice) => (
                <Button
                  disabled={narrative.dirty || narrativeSaving}
                  key={choice.id}
                  label={`${choice.label}${choice.archived ? " · archived" : ""}`}
                  onPress={() => {
                    setNarrative({
                      projectVersion: project.version,
                      threadId: choice.id,
                      role: "setup",
                      summary: "",
                      dependencyIds: Object.freeze([]),
                      dirty: false,
                      stale: false
                    });
                    setNarrativeStatus(undefined);
                  }}
                  quiet
                  selected={narrative.threadId === choice.id}
                />
              ))}
            </View>
            {selectedThread === undefined ? null : (
              <>
                {threadArchived ? <Text style={styles.warning}>This thread is archived. Its anchors remain visible, but editing is unavailable.</Text> : null}
                <Text style={styles.meta}>
                  {selectedContextThread?.narrativeState ?? selectedThread.narrative?.resolution ?? "unmapped"}
                  {" · "}
                  {(selectedContextThread?.associatedSceneIds ?? []).length} scene associations
                </Text>
                <View style={styles.choiceRow}>
                  {RESOLUTIONS.map((resolution) => (
                    <Button
                      disabled={
                        narrativeWritesDisabled ||
                        narrativeSaving ||
                        selectedThread.narrative === undefined ||
                        narrative.stale ||
                        narrative.projectVersion !== project.version
                      }
                      key={resolution}
                      label={resolution.replace("-", " ")}
                      onPress={() => void setResolution(resolution)}
                      quiet
                      selected={(selectedThread.narrative?.resolution ?? "unmapped") === resolution}
                    />
                  ))}
                </View>

                <Text style={styles.subheading}>This scene</Text>
                {(selectedContextThread?.narrativeBeats ?? []).length === 0 ? (
                  <View style={styles.notice}>
                    <Text style={styles.empty}>No authored beat maps this thread to this scene.</Text>
                    {threadSceneSemantics({
                      associated: selectedContextThread?.associatedSceneIds.includes(scene.id) ?? false,
                      mappedBeatCount: 0
                    }).map((label) => <Text key={label} style={styles.badge}>{label}</Text>)}
                  </View>
                ) : (
                  selectedContextThread?.narrativeBeats.map((beat) => (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ selected: narrative.beatId === beat.id }}
                      disabled={narrativeSaving}
                      key={beat.id}
                      onPress={() => beginBeat(beat.id)}
                      style={({ pressed }) => [styles.beatCard, narrative.beatId === beat.id && styles.selectedCard, pressed && styles.pressed]}
                    >
                      <Text style={styles.beatRole}>{beat.role}</Text>
                      <Text style={styles.beatSummary}>{beat.summary}</Text>
                      <Text style={styles.anchor}>{narrativeAnchorLabel(beat)}</Text>
                      <View style={styles.choiceRow}>
                        {threadSceneSemantics({
                          associated: selectedContextThread.associatedSceneIds.includes(scene.id),
                          mappedBeatCount: 1
                        }).map((label) => <Text key={label} style={styles.badge}>{label}</Text>)}
                      </View>
                    </Pressable>
                  ))
                )}

                <View style={styles.editorCard}>
                  <View style={styles.sectionHeader}>
                    <Text style={styles.subheading}>{narrative.beatId === undefined ? "Add an authored beat" : "Edit authored beat"}</Text>
                    {narrative.beatId === undefined ? null : (
                      <Button
                        disabled={narrative.dirty || narrativeSaving}
                        label="New beat"
                        onPress={() => beginBeat()}
                        quiet
                      />
                    )}
                  </View>
                  <Text style={styles.label}>Role</Text>
                  <View style={styles.choiceRow}>
                    {ROLES.map((role) => (
                      <Button
                        disabled={narrativeWritesDisabled || narrativeSaving}
                        key={role}
                        label={role}
                        onPress={() => editNarrative({ role })}
                        quiet
                        selected={narrative.role === role}
                      />
                    ))}
                  </View>
                  <LabeledInput
                    editable={!narrativeWritesDisabled && !narrativeSaving}
                    label="Beat summary"
                    multiline
                    onChangeText={(summary) => editNarrative({ summary })}
                    placeholder="What authored story movement happens here?"
                    value={narrative.summary}
                  />
                  {dependencyChoices.length === 0 ? null : (
                    <>
                      <Text style={styles.label}>Depends on same-thread beats</Text>
                      <View style={styles.dependencyList}>
                        {dependencyChoices.map((choice) => {
                          const selected = narrative.dependencyIds.includes(choice.id);
                          return (
                            <Button
                              disabled={narrativeWritesDisabled || narrativeSaving}
                              key={choice.id}
                              label={`${choice.label}${choice.archived ? " · archived beat" : ""}${choice.sceneArchived ? " · archived scene" : ""}`}
                              onPress={() => editNarrative({
                                dependencyIds: selected
                                  ? narrative.dependencyIds.filter((id) => id !== choice.id)
                                  : Object.freeze([...narrative.dependencyIds, choice.id])
                              })}
                              quiet
                              selected={selected}
                            />
                          );
                        })}
                      </View>
                    </>
                  )}
                  {narrative.stale ? (
                    <View style={styles.notice}>
                      <Text style={styles.warning}>Story records changed while you were editing this beat. Review before saving.</Text>
                      <View style={styles.actions}>
                        <Button disabled={narrativeSaving} label="Reload narrative" onPress={() => beginBeat(narrative.beatId)} quiet />
                        <Button disabled={narrativeSaving} label="Continue with my draft" onPress={() => setNarrative((current) => ({ ...current, projectVersion: project.version, stale: false, submitted: undefined }))} quiet />
                      </View>
                    </View>
                  ) : null}
                  <View style={styles.actions}>
                    <Button
                      disabled={narrativeWritesDisabled || narrativeSaving || narrative.stale || narrative.projectVersion !== project.version || narrative.summary.trim().length === 0}
                      label={narrative.beatId === undefined ? "Add beat" : "Save beat"}
                      onPress={() => void saveBeat()}
                    />
                    {selectedBeat === undefined ? null : (
                      <Button
                        disabled={narrativeWritesDisabled || narrativeSaving || narrative.stale || narrative.projectVersion !== project.version}
                        label={selectedBeat.archivedAt === undefined ? "Archive beat" : "Restore beat"}
                        onPress={() => void setBeatArchived(selectedBeat.id, selectedBeat.archivedAt === undefined)}
                        quiet
                      />
                    )}
                    {narrative.dirty ? (
                      <Button
                        disabled={narrativeSaving}
                        label="Discard beat draft"
                        onPress={() => beginBeat(narrative.beatId)}
                        quiet
                      />
                    ) : null}
                    <StatusText status={narrative.status} />
                  </View>
                  {narrativeStatus === undefined ? null : <Text style={narrativeStatus === "Not saved" ? styles.status : styles.success}>{narrativeStatus}</Text>}
                </View>
              </>
            )}
          </>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { gap: 12, padding: 12, paddingBottom: 28 },
  header: { alignItems: "flex-start", flexDirection: "row", gap: 8, justifyContent: "space-between" },
  headerCopy: { flex: 1, gap: 2 },
  eyebrow: { color: colors.kicker, fontFamily: fonts.uiSemibold, fontSize: 9, letterSpacing: 1.1, textTransform: "uppercase" },
  title: { color: colors.ink, fontFamily: fonts.story, fontSize: 22 },
  path: { color: colors.muted, fontFamily: fonts.ui, fontSize: 11 },
  navigationRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, justifyContent: "space-between" },
  section: { backgroundColor: colors.panel, borderColor: colors.line, borderRadius: 10, borderWidth: 1, gap: 8, padding: 10 },
  sectionHeader: { alignItems: "center", flexDirection: "row", gap: 8, justifyContent: "space-between" },
  sectionTitle: { color: colors.ink, fontFamily: fonts.story, fontSize: 17 },
  subheading: { color: colors.ink, fontFamily: fonts.uiSemibold, fontSize: 12 },
  help: { color: colors.muted, fontFamily: fonts.ui, fontSize: 11, lineHeight: 16 },
  field: { gap: 4 },
  label: { color: colors.muted, fontFamily: fonts.uiSemibold, fontSize: 9, letterSpacing: 0.5, textTransform: "uppercase" },
  input: { backgroundColor: colors.paper, borderColor: colors.line, borderRadius: 7, borderWidth: 1, color: colors.ink, fontFamily: fonts.ui, fontSize: 12, minHeight: 36, paddingHorizontal: 9, paddingVertical: 7 },
  multilineInput: { minHeight: 62, textAlignVertical: "top" },
  disabledInput: { backgroundColor: colors.wash, color: colors.muted },
  actions: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 7 },
  choiceRow: { flexDirection: "row", flexWrap: "wrap", gap: 5 },
  dependencyList: { gap: 5 },
  button: { backgroundColor: colors.accent, borderColor: colors.accent, borderRadius: 7, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 7 },
  buttonText: { color: colors.panel, fontFamily: fonts.uiSemibold, fontSize: 11 },
  quietButton: { backgroundColor: colors.paper, borderColor: colors.line, borderRadius: 7, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 6 },
  quietButtonText: { color: colors.ink, fontFamily: fonts.uiMedium, fontSize: 10 },
  buttonSelected: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  buttonSelectedText: { color: colors.accent },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.45 },
  notice: { backgroundColor: colors.wash, borderRadius: 7, gap: 6, padding: 8 },
  warning: { color: colors.red, fontFamily: fonts.uiMedium, fontSize: 11, lineHeight: 16 },
  status: { color: colors.red, fontFamily: fonts.uiMedium, fontSize: 10 },
  success: { color: colors.green, fontFamily: fonts.uiMedium, fontSize: 10 },
  empty: { color: colors.muted, fontFamily: fonts.ui, fontSize: 11, lineHeight: 16 },
  meta: { color: colors.muted, fontFamily: fonts.ui, fontSize: 10, textTransform: "capitalize" },
  beatCard: { backgroundColor: colors.paper, borderColor: colors.line, borderRadius: 7, borderWidth: 1, gap: 3, padding: 8 },
  selectedCard: { borderColor: colors.accent },
  beatRole: { color: colors.kicker, fontFamily: fonts.uiSemibold, fontSize: 9, textTransform: "uppercase" },
  beatSummary: { color: colors.ink, fontFamily: fonts.ui, fontSize: 12, lineHeight: 17 },
  anchor: { color: colors.muted, fontFamily: fonts.ui, fontSize: 9 },
  badge: { alignSelf: "flex-start", backgroundColor: colors.blueSoft, borderRadius: 8, color: colors.blue, fontFamily: fonts.uiMedium, fontSize: 9, overflow: "hidden", paddingHorizontal: 6, paddingVertical: 3 },
  editorCard: { backgroundColor: colors.canvas, borderRadius: 8, gap: 8, padding: 9 }
});
