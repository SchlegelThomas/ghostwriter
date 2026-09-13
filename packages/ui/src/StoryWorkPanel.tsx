import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type {
  AgentModelId,
  BookId,
  SceneId,
  StoryWorkArtifactPointer,
  StoryWorkAssignment,
  StoryWorkAssignmentId,
  StoryWorkTaskKind
} from "@ghostwriter/core";
import { storyCheckSourceScopeHint } from "./story-check-review.js";
import {
  sanitizeStoryWorkRevisePrefill,
  shouldApplyStoryWorkPanelPrefill,
  type StoryWorkPanelRevisePrefill
} from "./story-work-panel-prefill.js";
import type { WorkspaceAvailableModel } from "./workspace-agent-prefs.js";
import { ghostwriterTheme } from "./theme.js";

export type { StoryWorkPanelRevisePrefill, StoryWorkRevisePrefillBrief } from "./story-work-panel-prefill.js";

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
  "awaiting-review": "Awaiting your review", applied: "Applied to story", reviewed: "Review complete",
  rejected: "Rejected", failed: "Generation failed", canceled: "Canceled", stale: "Sources changed"
};

type SubmitStoryWorkBriefBase = Readonly<{
  brief: string;
  constraints: string;
  doneWhen: string;
  model: AgentModelId;
  sceneIds: readonly SceneId[];
}>;

export type SubmitStoryWorkBriefCheckApplied = SubmitStoryWorkBriefBase &
  Readonly<{
    taskKind: "check";
    specialist: "continuity";
    checkMode: "applied-scene";
    targetSceneId: SceneId;
  }>;

export type SubmitStoryWorkBriefCheckProposal = SubmitStoryWorkBriefBase &
  Readonly<{
    taskKind: "check";
    specialist: "continuity";
    checkMode: "proposal-draft";
    targetSceneId: SceneId;
    sourceAssignmentId: StoryWorkAssignmentId;
    sourceArtifact: StoryWorkArtifactPointer;
  }>;

export type SubmitStoryWorkBriefOutline = SubmitStoryWorkBriefBase &
  Readonly<{ taskKind: "outline"; targetBookId: BookId }>;

export type SubmitStoryWorkBrief =
  | (SubmitStoryWorkBriefBase & Readonly<{ taskKind: "revise"; targetSceneId: SceneId }>)
  | SubmitStoryWorkBriefCheckApplied
  | SubmitStoryWorkBriefCheckProposal
  | SubmitStoryWorkBriefOutline
  | (SubmitStoryWorkBriefBase &
      Readonly<{ taskKind: Exclude<StoryWorkTaskKind, "revise" | "check" | "outline"> }>);

export type StoryWorkOutlineBookOption = Readonly<{
  bookId: BookId;
  title: string;
  label?: string;
}>;

const EMPTY_OUTLINE_BOOKS: readonly StoryWorkOutlineBookOption[] = Object.freeze([]);

export type StoryWorkProposalCheckTarget = Readonly<{
  assignmentId: StoryWorkAssignmentId;
  artifact: StoryWorkArtifactPointer;
  targetSceneId: SceneId;
  title: string;
  label: string;
}>;

function proposalCheckTargetKey(target: StoryWorkProposalCheckTarget): string {
  return `${target.assignmentId}:${target.artifact.proposalId}:${target.artifact.artifactVersion}:${target.artifact.contentHash}`;
}

function resolveDefaultOutlineBookId(
  books: readonly StoryWorkOutlineBookOption[],
  selectedOutlineBookId: BookId | undefined
): BookId | undefined {
  if (
    selectedOutlineBookId !== undefined &&
    books.some((book) => book.bookId === selectedOutlineBookId)
  ) {
    return selectedOutlineBookId;
  }
  return books[0]?.bookId;
}

function outlineBookButtonLabel(book: StoryWorkOutlineBookOption): string {
  return book.label ? `${book.title} · ${book.label}` : book.title;
}

export type StoryWorkPanelProps = Readonly<{
  projectTitle: string;
  open?: boolean;
  supportedTaskKinds: readonly StoryWorkTaskKind[];
  models: readonly WorkspaceAvailableModel[];
  selectedModel?: AgentModelId;
  scenes: readonly Readonly<{ id: SceneId; title: string }>[];
  selectedSceneId?: SceneId;
  outlineBooks?: readonly StoryWorkOutlineBookOption[];
  selectedOutlineBookId?: BookId;
  proposalCheckTargets?: readonly StoryWorkProposalCheckTarget[];
  prefill?: StoryWorkPanelRevisePrefill;
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
  const [targetSceneId, setTargetSceneId] = useState<SceneId | undefined>(props.selectedSceneId);
  const [checkMode, setCheckMode] = useState<"applied-scene" | "proposal-draft">("applied-scene");
  const [selectedProposalTargetKey, setSelectedProposalTargetKey] = useState<string>();
  const [sourceSearch, setSourceSearch] = useState("");
  const [targetSearch, setTargetSearch] = useState("");
  const [outlineBookSearch, setOutlineBookSearch] = useState("");
  const [targetOutlineBookId, setTargetOutlineBookId] = useState<BookId | undefined>(() =>
    resolveDefaultOutlineBookId(
      props.outlineBooks ?? EMPTY_OUTLINE_BOOKS,
      props.selectedOutlineBookId
    )
  );
  const [proposalSearch, setProposalSearch] = useState("");
  const sourcesEdited = useRef(false);
  const targetEdited = useRef(false);
  const outlineBookEdited = useRef(false);
  const proposalTargetEdited = useRef(false);
  const appliedPrefillTokenRef = useRef<string | undefined>(undefined);
  const [prefillNotice, setPrefillNotice] = useState<string>();
  useEffect(() => {
    const nextToken = props.prefill?.requestToken;
    if (!shouldApplyStoryWorkPanelPrefill(appliedPrefillTokenRef.current, nextToken)) {
      return;
    }
    const sanitized = sanitizeStoryWorkRevisePrefill(
      props.prefill!.revise,
      props.scenes.map((scene) => scene.id)
    );
    appliedPrefillTokenRef.current = nextToken.trim();
    if (props.supportedTaskKinds.includes("revise")) {
      setTaskKind("revise");
    }
    setBrief(sanitized.brief);
    setConstraints(sanitized.constraints);
    setDoneWhen(sanitized.doneWhen);
    setTargetSceneId(sanitized.targetSceneId);
    setSceneIds(sanitized.sceneIds);
    targetEdited.current = true;
    sourcesEdited.current = true;
    proposalTargetEdited.current = false;
    setSourceSearch("");
    setTargetSearch("");
    setProposalSearch("");
    setCheckMode("applied-scene");
    setSelectedProposalTargetKey(undefined);
    setError(undefined);
    setPrefillNotice(
      sanitized.warnings.length > 0 ? sanitized.warnings.join(" ") : undefined
    );
    if (props.prefill?.focusStoryWork === false || typeof document === "undefined") {
      return;
    }
    const timer = setTimeout(() => {
      const heading = document.getElementById(STORY_WORK_HEADING_NATIVE_ID);
      if (!(heading instanceof HTMLElement)) return;
      heading.tabIndex = -1;
      heading.focus();
    }, 30);
    return () => clearTimeout(timer);
  }, [props.prefill, props.scenes, props.supportedTaskKinds]);
  useEffect(() => {
    if (props.open && !sourcesEdited.current && !brief && !constraints && !doneWhen) {
      setSceneIds(props.selectedSceneId ? [props.selectedSceneId] : []);
    }
  }, [props.open, props.selectedSceneId, brief, constraints, doneWhen]);
  const outlineBooks = props.outlineBooks ?? EMPTY_OUTLINE_BOOKS;
  useEffect(() => {
    const books = props.outlineBooks ?? EMPTY_OUTLINE_BOOKS;
    if (
      props.open &&
      !outlineBookEdited.current &&
      !brief &&
      !constraints &&
      !doneWhen
    ) {
      setTargetOutlineBookId(
        resolveDefaultOutlineBookId(books, props.selectedOutlineBookId)
      );
    }
  }, [props.open, props.selectedOutlineBookId, props.outlineBooks, brief, constraints, doneWhen]);
  useEffect(() => {
    const books = props.outlineBooks ?? EMPTY_OUTLINE_BOOKS;
    if (taskKind !== "outline") {
      outlineBookEdited.current = false;
      setOutlineBookSearch("");
      return;
    }
    if (!outlineBookEdited.current) {
      setTargetOutlineBookId(
        resolveDefaultOutlineBookId(books, props.selectedOutlineBookId)
      );
      return;
    }
    setTargetOutlineBookId((current) => {
      if (current !== undefined && books.some((book) => book.bookId === current)) {
        return current;
      }
      return resolveDefaultOutlineBookId(books, props.selectedOutlineBookId);
    });
  }, [taskKind, props.outlineBooks, props.selectedOutlineBookId]);
  useEffect(() => {
    if (taskKind !== "revise" && taskKind !== "check") {
      targetEdited.current = false;
      proposalTargetEdited.current = false;
      setTargetSceneId(undefined);
      setTargetSearch("");
      setCheckMode("applied-scene");
      setSelectedProposalTargetKey(undefined);
      return;
    }
    if (!targetEdited.current && taskKind === "revise") {
      setTargetSceneId(props.selectedSceneId);
    }
    if (taskKind === "check" && checkMode === "applied-scene" && !targetEdited.current) {
      setTargetSceneId(props.selectedSceneId);
      if (!sourcesEdited.current && props.selectedSceneId !== undefined) {
        setSceneIds([props.selectedSceneId]);
      }
    }
  }, [taskKind, props.selectedSceneId, checkMode]);
  useEffect(() => {
    if (taskKind !== "check") return;
    proposalTargetEdited.current = false;
    setSelectedProposalTargetKey(undefined);
    if (checkMode === "applied-scene") {
      if (!targetEdited.current) {
        setTargetSceneId(props.selectedSceneId);
      }
      return;
    }
    targetEdited.current = false;
    setTargetSceneId(undefined);
    setSceneIds((current) =>
      targetSceneId === undefined
        ? current
        : current.filter((id) => id !== targetSceneId)
    );
  }, [checkMode, taskKind]);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [error, setError] = useState<string>();
  const models = props.models.filter((entry) => entry.supportsStructured && entry.adapterReady !== false);
  const chosenModel = models.find((entry) => entry.id === model);
  const proposalTargets = props.proposalCheckTargets ?? [];
  const selectedProposalTarget = proposalTargets.find(
    (target) => proposalCheckTargetKey(target) === selectedProposalTargetKey
  );
  const sourceScenePool =
    taskKind === "check" && checkMode === "proposal-draft" && targetSceneId !== undefined
      ? props.scenes.filter((scene) => scene.id !== targetSceneId)
      : props.scenes;
  const visibleScenes = sourceScenePool
    .filter((scene) => scene.title.toLowerCase().includes(sourceSearch.toLowerCase()))
    .slice(0, 20);
  const visibleTargetScenes = props.scenes
    .filter((scene) => scene.title.toLowerCase().includes(targetSearch.toLowerCase()))
    .slice(0, 20);
  const visibleProposalTargets = proposalTargets
    .filter((target) =>
      `${target.title} ${target.label}`.toLowerCase().includes(proposalSearch.toLowerCase())
    )
    .slice(0, 20);
  const visibleOutlineBooks = outlineBooks
    .filter((book) =>
      outlineBookButtonLabel(book).toLowerCase().includes(outlineBookSearch.toLowerCase())
    )
    .slice(0, 20);
  const selectedOutlineBook = outlineBooks.find((book) => book.bookId === targetOutlineBookId);
  const reviseTargetActive =
    taskKind !== "revise" ||
    (targetSceneId !== undefined && props.scenes.some((scene) => scene.id === targetSceneId));
  const checkAppliedTargetActive =
    taskKind !== "check" ||
    checkMode !== "applied-scene" ||
    (targetSceneId !== undefined && props.scenes.some((scene) => scene.id === targetSceneId));
  const checkProposalTargetActive =
    taskKind !== "check" ||
    checkMode !== "proposal-draft" ||
    (selectedProposalTarget !== undefined &&
      targetSceneId !== undefined &&
      selectedProposalTarget.targetSceneId === targetSceneId);
  const checkSourcesValid =
    taskKind !== "check" ||
    checkMode !== "proposal-draft" ||
    (targetSceneId !== undefined && !sceneIds.includes(targetSceneId));
  const outlineTargetActive =
    taskKind !== "outline" ||
    (targetOutlineBookId !== undefined &&
      outlineBooks.some((book) => book.bookId === targetOutlineBookId));
  const canSubmit =
    props.supportedTaskKinds.includes(taskKind) &&
    brief.trim().length > 0 &&
    constraints.trim().length > 0 &&
    doneWhen.trim().length > 0 &&
    chosenModel !== undefined &&
    sceneIds.every((id) => props.scenes.some((scene) => scene.id === id)) &&
    reviseTargetActive &&
    checkAppliedTargetActive &&
    checkProposalTargetActive &&
    checkSourcesValid &&
    outlineTargetActive &&
    !submitting;

  async function submit() {
    if (!canSubmit || submittingRef.current || chosenModel === undefined) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError(undefined);
    try {
      let payload: SubmitStoryWorkBrief;
      if (taskKind === "revise") {
        payload = {
          taskKind,
          targetSceneId: targetSceneId as SceneId,
          brief,
          constraints,
          doneWhen,
          model: chosenModel.id as AgentModelId,
          sceneIds
        };
      } else if (taskKind === "check" && checkMode === "proposal-draft") {
        if (selectedProposalTarget === undefined) return;
        payload = {
          taskKind: "check",
          specialist: "continuity",
          checkMode: "proposal-draft",
          targetSceneId: selectedProposalTarget.targetSceneId,
          sourceAssignmentId: selectedProposalTarget.assignmentId,
          sourceArtifact: selectedProposalTarget.artifact,
          brief,
          constraints,
          doneWhen,
          model: chosenModel.id as AgentModelId,
          sceneIds
        };
      } else if (taskKind === "check") {
        payload = {
          taskKind: "check",
          specialist: "continuity",
          checkMode: "applied-scene",
          targetSceneId: targetSceneId as SceneId,
          brief,
          constraints,
          doneWhen,
          model: chosenModel.id as AgentModelId,
          sceneIds
        };
      } else if (taskKind === "outline") {
        if (targetOutlineBookId === undefined) return;
        payload = {
          taskKind: "outline",
          targetBookId: targetOutlineBookId,
          brief,
          constraints,
          doneWhen,
          model: chosenModel.id as AgentModelId,
          sceneIds
        };
      } else {
        payload = {
          taskKind,
          brief,
          constraints,
          doneWhen,
          model: chosenModel.id as AgentModelId,
          sceneIds
        };
      }
      await props.onSubmit(payload);
      sourcesEdited.current = false;
      targetEdited.current = false;
      outlineBookEdited.current = false;
      proposalTargetEdited.current = false;
      setBrief("");
      setConstraints("");
      setDoneWhen("");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The assignment was not acknowledged. Your brief is still here."
      );
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  function selectCheckTargetScene(scene: SceneId) {
    targetEdited.current = true;
    setTargetSceneId(scene);
  }

  function selectProposalTarget(target: StoryWorkProposalCheckTarget) {
    proposalTargetEdited.current = true;
    targetEdited.current = true;
    const key = proposalCheckTargetKey(target);
    setSelectedProposalTargetKey(key);
    setTargetSceneId(target.targetSceneId);
    setSceneIds((current) => current.filter((id) => id !== target.targetSceneId));
  }

  function toggleSourceScene(sceneId: SceneId) {
    if (
      taskKind === "check" &&
      checkMode === "proposal-draft" &&
      sceneId === targetSceneId
    ) {
      return;
    }
    sourcesEdited.current = true;
    setSceneIds((current) =>
      current.includes(sceneId)
        ? current.filter((id) => id !== sceneId)
        : [...current, sceneId]
    );
  }

  const taskHint =
    taskKind === "character"
      ? "Destination: a new character in Cast, after your review."
      : taskKind === "scene"
        ? "Destination: a new scene in your manuscript, after your review."
        : taskKind === "revise"
          ? "Destination: one existing scene you want rewritten. Sources below are separate prose the agent should read."
          : taskKind === "check"
            ? "Destination: continuity findings for one explicit scene or reviewable proposal. Sources below are separate surrounding prose to read."
            : taskKind === "outline"
              ? "Destination: typed chapter and scene placeholders in one book's structure—no prose. Review the preview before applying."
              : "Review the proposed result and its destination before applying it to your story.";

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
      <Text style={styles.hint}>{taskHint}</Text>
      {prefillNotice ? <Text accessibilityRole="alert" style={styles.error}>{prefillNotice}</Text> : null}
      <Field label="Your brief" value={brief} onChange={setBrief} limit={20000} disabled={submitting} />
      <Field label="Constraints" value={constraints} onChange={setConstraints} limit={8000} disabled={submitting} />
      <Field label="Done when" value={doneWhen} onChange={setDoneWhen} limit={4000} disabled={submitting} />
      {taskKind === "check" ? <>
        <Text style={styles.label}>Check specialist</Text>
        <Text style={styles.hint}>Continuity examines contradictions, timeline breaks, and dependency drift inside your selected scope.</Text>
        <View style={styles.choices}>
          <Button label="Continuity" selected disabled={submitting} onPress={() => {}} />
        </View>
        <Text style={styles.label}>Check mode</Text>
        <View accessibilityRole="radiogroup" style={styles.radioGroup}>
          <RadioChoice label="Applied scene" description="Check the acknowledged scene head currently in Draft." selected={checkMode === "applied-scene"} disabled={submitting} onPress={() => setCheckMode("applied-scene")} />
          <RadioChoice label="Reviewable proposal" description="Check a scene or revise artifact awaiting your review." selected={checkMode === "proposal-draft"} disabled={submitting} onPress={() => setCheckMode("proposal-draft")} />
        </View>
        {checkMode === "applied-scene" ? <>
          <Text style={styles.label}>Scene to assess</Text>
          <Text style={styles.hint}>Choose the exact scene head to examine. This is separate from surrounding source scenes below and may include the same scene.</Text>
          {targetSceneId ? <Text style={styles.hint}>Assess: {props.scenes.find((scene) => scene.id === targetSceneId)?.title ?? "Unavailable scene"}</Text> : <Text style={styles.hint}>Choose an active scene to assess.</Text>}
          <TextInput accessibilityLabel="Find assess scene" placeholder="Find assess scene" value={targetSearch} onChangeText={setTargetSearch} style={styles.input} />
          <View style={styles.choices}>{visibleTargetScenes.map((scene) => <Button key={`check-target-${scene.id}`} label={scene.title} selected={targetSceneId === scene.id} disabled={submitting} onPress={() => selectCheckTargetScene(scene.id)} />)}</View>
          {props.scenes.length > visibleTargetScenes.length ? <Text style={styles.hint}>Showing up to 20 matching scenes. Search to find others.</Text> : null}
        </> : <>
          <Text style={styles.label}>Proposal to assess</Text>
          <Text style={styles.hint}>Choose one reviewable scene or revise artifact. Its assess scene cannot also be selected as surrounding source prose.</Text>
          {selectedProposalTarget ? <Text style={styles.hint}>Assess: {selectedProposalTarget.title} · {selectedProposalTarget.label}</Text> : <Text style={styles.hint}>Choose a reviewable proposal.</Text>}
          <TextInput accessibilityLabel="Find reviewable proposal" placeholder="Find proposal" value={proposalSearch} onChangeText={setProposalSearch} style={styles.input} />
          <View style={styles.choices}>{visibleProposalTargets.map((target) => {
            const key = proposalCheckTargetKey(target);
            return <Button key={key} label={`${target.title} · ${target.label}`} selected={selectedProposalTargetKey === key} disabled={submitting} onPress={() => selectProposalTarget(target)} />;
          })}</View>
          {proposalTargets.length === 0 ? <Text style={styles.hint}>No reviewable scene or revise artifacts are available yet.</Text> : null}
          {proposalTargets.length > visibleProposalTargets.length ? <Text style={styles.hint}>Showing up to 20 matching proposals. Search to find others.</Text> : null}
        </>}
      </> : null}
      {taskKind === "revise" ? <>
        <Text style={styles.label}>Revision destination</Text>
        <Text style={styles.hint}>Choose the scene whose prose will be revised. This is not the same as source scenes below.</Text>
        {targetSceneId ? <Text style={styles.hint}>Destination: {props.scenes.find((scene) => scene.id === targetSceneId)?.title ?? "Unavailable scene"}</Text> : <Text style={styles.hint}>Choose an active scene to revise.</Text>}
        <TextInput accessibilityLabel="Find revision destination scene" placeholder="Find destination scene" value={targetSearch} onChangeText={setTargetSearch} style={styles.input} />
        <View style={styles.choices}>{visibleTargetScenes.map((scene) => <Button key={`target-${scene.id}`} label={scene.title} selected={targetSceneId === scene.id} disabled={submitting} onPress={() => {
          targetEdited.current = true;
          setTargetSceneId(scene.id);
        }} />)}</View>
        {props.scenes.length > visibleTargetScenes.length ? <Text style={styles.hint}>Showing up to 20 matching scenes. Search to find others.</Text> : null}
      </> : null}
      {taskKind === "outline" ? <>
        <Text style={styles.label}>Structure destination</Text>
        <Text style={styles.hint}>Choose the active book whose chapter and scene placeholders will be proposed. Source scenes below are optional context only.</Text>
        {selectedOutlineBook ? <Text style={styles.hint}>Destination: {outlineBookButtonLabel(selectedOutlineBook)}</Text> : outlineBooks.length === 0 ? <Text style={styles.hint}>No active books are available. Unarchive or create a book before starting an outline assignment.</Text> : <Text style={styles.hint}>Choose an active book for structure.</Text>}
        {outlineBooks.length > 0 ? <>
          <TextInput accessibilityLabel="Find structure destination book" placeholder="Find book" value={outlineBookSearch} onChangeText={setOutlineBookSearch} style={styles.input} />
          <View style={styles.choices}>{visibleOutlineBooks.map((book) => <Button key={`outline-book-${book.bookId}`} label={outlineBookButtonLabel(book)} selected={targetOutlineBookId === book.bookId} disabled={submitting} onPress={() => {
            outlineBookEdited.current = true;
            setTargetOutlineBookId(book.bookId);
          }} />)}</View>
          {outlineBooks.length > visibleOutlineBooks.length ? <Text style={styles.hint}>Showing up to 20 matching books. Search to find others.</Text> : null}
        </> : null}
      </> : null}
      <Text style={styles.label}>Sources</Text>
      <Text style={styles.hint}>{taskKind === "check" ? storyCheckSourceScopeHint() : "Shared story structure and intent are included. Select the scene prose the agent should read."}</Text>
      {sceneIds.length ? <Text style={styles.hint}>Selected: {sceneIds.map((id) => props.scenes.find((scene) => scene.id === id)?.title ?? "Unavailable scene").join(", ")}</Text> : <Text style={styles.hint}>No manuscript prose selected.</Text>}
      {taskKind === "check" && checkMode === "proposal-draft" && targetSceneId !== undefined ? <Text style={styles.hint}>The assess scene is excluded from surrounding sources in proposal mode.</Text> : null}
      <TextInput accessibilityLabel="Find a source scene" placeholder="Find a scene" value={sourceSearch} onChangeText={setSourceSearch} style={styles.input} />
      <View style={styles.choices}>{visibleScenes.map((scene) => {
        const blocked =
          taskKind === "check" &&
          checkMode === "proposal-draft" &&
          scene.id === targetSceneId;
        return <Button key={scene.id} label={scene.title} selected={sceneIds.includes(scene.id)} disabled={submitting || blocked || (!sceneIds.includes(scene.id) && sceneIds.length >= 32)} onPress={() => toggleSourceScene(scene.id)} />;
      })}</View>
      {sourceScenePool.length > visibleScenes.length ? <Text style={styles.hint}>Showing up to 20 matching scenes. Search to find others.</Text> : null}
      <Text style={styles.label}>Model</Text>
      {models.length ? <View style={styles.choices}>{models.map((entry) => <Button key={entry.id} label={entry.label} selected={entry.id === model} disabled={submitting} onPress={() => setModel(entry.id as AgentModelId)} />)}</View> : <>
        <Text style={styles.hint}>Connect a provider with a structured-output model to start story work.</Text>
        <Button label="Open provider settings" onPress={props.onOpenSettings} />
      </>}
      <Button label={submitting ? "Starting assignment…" : "Start assignment"} disabled={!canSubmit} selected onPress={() => { void submit(); }} />
      {taskKind === "outline" && !outlineTargetActive && brief.trim() && constraints.trim() && doneWhen.trim() && chosenModel !== undefined ? <Text style={styles.hint}>Choose an active structure destination book before starting.</Text> : null}
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
function RadioChoice({ label, description, selected, disabled, onPress }: Readonly<{ label: string; description: string; selected: boolean; disabled: boolean; onPress(): void }>) {
  return <Pressable accessibilityRole="radio" accessibilityLabel={label} accessibilityState={{ checked: selected, disabled }} disabled={disabled} onPress={onPress} style={[styles.radio, selected && styles.selected]}>
    <Text style={styles.buttonText}>{selected ? "● " : ""}{label}</Text>
    <Text style={styles.hint}>{description}</Text>
  </Pressable>;
}
const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0, minWidth: 0, backgroundColor: colors.paper },
  header: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8, padding: 10 },
  content: { padding: 12, gap: 12 }, title: { fontFamily: fonts.story, color: colors.ink, fontSize: 24 },
  label: { fontFamily: fonts.uiSemibold, color: colors.ink, fontSize: 12 }, body: { fontFamily: fonts.ui, color: colors.ink, fontSize: 13, lineHeight: 19 },
  hint: { fontFamily: fonts.ui, color: colors.muted, fontSize: 12, lineHeight: 18 },
  field: { gap: 6 }, input: { minWidth: 0, borderWidth: 1, borderColor: colors.line, borderRadius: 7, padding: 10, fontFamily: fonts.ui, color: colors.ink, fontSize: 13, backgroundColor: colors.panel },
  multiline: { minHeight: 72, textAlignVertical: "top" }, choices: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  radioGroup: { gap: 8 },
  radio: { borderWidth: 1, borderColor: colors.line, borderRadius: 7, padding: 10, gap: 4, backgroundColor: colors.panel },
  button: { borderWidth: 1, borderColor: colors.line, borderRadius: 7, padding: 10, minHeight: 40, justifyContent: "center", backgroundColor: colors.panel },
  selected: { borderColor: colors.accent, backgroundColor: colors.accentSoft }, disabled: { opacity: 0.45 }, buttonText: { color: colors.ink, fontFamily: fonts.uiSemibold, fontSize: 12 },
  assignment: { borderWidth: 1, borderColor: colors.line, borderRadius: 8, padding: 12, gap: 6 }, error: { fontFamily: fonts.ui, color: colors.red, fontSize: 12, lineHeight: 18 }
});
