import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text } from "react-native";
import { validateCharacterCreateV2, type AgentModelId, type ProjectNavigator, type SceneId, type StoryKnowledgeId, type StoryWorkAssignment, type StoryWorkAssignmentId } from "@ghostwriter/core";
import { CharacterStoryWorkReview, STORY_WORK_HEADING_NATIVE_ID, StoryWorkPanel, ghostwriterTheme, storyWorkAssignmentButtonNativeId, type SubmitStoryWorkBrief, type WorkspaceAvailableModel } from "@ghostwriter/ui";
import { storyWorkRetryInput } from "./story-work-attempt-input.js";
import { applyCharacterStoryWork, GhostwriterApiError, createCharacterStoryWorkAssignment, getProject, getStoryWorkAssignment, listStoryWorkAssignments, reviewCharacterStoryWork, startCharacterStoryWorkAttempt, type StoryWorkDetailResponse } from "./api.js";

export function useStoryWorkWorkspace(input: Readonly<{
  project?: ProjectNavigator;
  accountId?: string;
  selectedSceneId?: SceneId;
  model?: AgentModelId;
  models: readonly WorkspaceAvailableModel[];
  onProjectChanged(project: ProjectNavigator): void;
  onOpenSettings(): void;
}>) {
  const projectId = input.project?.id;
  const scopeKey = `${input.accountId ?? ""}:${projectId ?? ""}`;
  const scopeRef = useRef(scopeKey);
  const scopeEpoch = useRef(0);
  if (scopeRef.current !== scopeKey) { scopeRef.current = scopeKey; scopeEpoch.current += 1; }
  const renderEpoch = scopeEpoch.current;
  const [panelOpen, setPanelOpen] = useState(false);
  const [assignments, setAssignments] = useState<readonly StoryWorkAssignment[]>([]);
  const [detail, setDetail] = useState<StoryWorkDetailResponse>();
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewDirty, setReviewDirty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [projectRefreshError, setProjectRefreshError] = useState<{ assignmentId: string; message: string }>();
  const [requestedKnowledgeId, setRequestedKnowledgeId] = useState<StoryKnowledgeId>();
  const openSequence = useRef(0);
  const submitRequest = useRef<{ fingerprint: string; key: string; attemptKey: string; assignment?: StoryWorkAssignment } | undefined>(undefined);
  const revisionRequest = useRef<{ fingerprint: string; key: string } | undefined>(undefined);
  const retryRequest = useRef<{ fingerprint: string; key: string } | undefined>(undefined);
  const applyRequest = useRef<Parameters<typeof applyCharacterStoryWork>[0] | undefined>(undefined);
  const returnFocusTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [operationPending, setOperationPending] = useState(false);

  const onReviewDirty = useCallback((dirty: boolean) => { if (scopeEpoch.current === renderEpoch) setReviewDirty(dirty); }, [renderEpoch]);
  const onReviewBusy = useCallback((pending: boolean) => { if (scopeEpoch.current === renderEpoch) setOperationPending(pending); }, [renderEpoch]);
  function cancelReturnFocus() {
    if (returnFocusTimer.current === undefined) return;
    clearTimeout(returnFocusTimer.current);
    returnFocusTimer.current = undefined;
  }

  function focusVisibleStoryWorkTarget(id: string): boolean {
    if (typeof document === "undefined") return false;
    const target = document.getElementById(id);
    if (!(target instanceof HTMLElement) || target.getClientRects().length === 0) return false;
    if (target.tabIndex < 0) target.tabIndex = -1;
    target.focus();
    return true;
  }

  function closeReview(restoreFocus = false) {
    if (reviewDirty || operationPending) return;
    openSequence.current += 1;
    cancelReturnFocus();
    const assignmentId = detail?.assignment.id;
    const epoch = scopeEpoch.current;
    setReviewOpen(false);
    if (!restoreFocus) return;
    returnFocusTimer.current = setTimeout(() => {
      returnFocusTimer.current = undefined;
      if (scopeEpoch.current !== epoch) return;
      if (
        assignmentId !== undefined &&
        focusVisibleStoryWorkTarget(storyWorkAssignmentButtonNativeId(assignmentId))
      ) return;
      focusVisibleStoryWorkTarget(STORY_WORK_HEADING_NATIVE_ID);
    }, 30);
  }

  useEffect(() => {
    cancelReturnFocus();
    setProjectRefreshError(undefined); retryRequest.current = undefined;
    setPanelOpen(false); setAssignments([]); setDetail(undefined); setReviewOpen(false); setReviewDirty(false); setError(undefined);
    setRequestedKnowledgeId(undefined); submitRequest.current = undefined; revisionRequest.current = undefined; applyRequest.current = undefined;
    openSequence.current += 1; setOperationPending(false);
    return cancelReturnFocus;
  }, [scopeKey]);

  const upsert = useCallback((assignment: StoryWorkAssignment) => {
    setAssignments((current) => [assignment, ...current.filter((entry) => entry.id !== assignment.id)]);
  }, []);

  const refresh = useCallback(async () => {
    if (!projectId) return;
    const scope = scopeEpoch.current;
    setLoading(true);
    try { const next = await listStoryWorkAssignments(projectId); if (scope === scopeEpoch.current) { setAssignments(next); setError(undefined); } }
    catch (cause) { if (scope === scopeEpoch.current) setError(cause instanceof Error ? cause.message : "Assignments could not be loaded."); }
    finally { if (scope === scopeEpoch.current) setLoading(false); }
  }, [projectId]);

  useEffect(() => { if (panelOpen) void refresh(); }, [panelOpen, refresh]);

  async function openAssignment(id: StoryWorkAssignmentId) {
    if (!projectId || reviewDirty || operationPending) return;
    const scope = scopeEpoch.current;
    const sequence = ++openSequence.current;
    setError(undefined);
    try {
      let next = await getStoryWorkAssignment(projectId, id);
      if (scope !== scopeEpoch.current || sequence !== openSequence.current) return;
      if (next.assignment.status === "artifact-ready" && next.assignment.currentArtifact) {
        const opened = await reviewCharacterStoryWork({ projectId, assignmentId: id, expectedAssignmentVersion: next.assignment.version, artifact: next.assignment.currentArtifact, action: "open" });
        next = { ...next, ...opened };
      }
      if (scope !== scopeEpoch.current || sequence !== openSequence.current) return;
      setDetail(next); upsert(next.assignment); setReviewOpen(true); applyRequest.current = undefined;
    } catch (cause) { if (scope === scopeEpoch.current) setError(cause instanceof Error ? cause.message : "The assignment could not be opened."); }
  }

  async function submit(brief: SubmitStoryWorkBrief) {
    if (!input.project) throw new Error("Open a project before starting story work.");
    const scope = scopeEpoch.current;
    const fingerprint = JSON.stringify({ projectId: input.project.id, ...brief });
    if (submitRequest.current?.fingerprint !== fingerprint) submitRequest.current = { fingerprint, key: crypto.randomUUID(), attemptKey: crypto.randomUUID() };
    const request = submitRequest.current;
    setOperationPending(true);
    try {
      if (!request.assignment) {
        const created = await createCharacterStoryWorkAssignment({ projectId: input.project.id, expectedProjectVersion: input.project.version, idempotencyKey: request.key, brief: brief.brief, constraints: brief.constraints, doneWhen: brief.doneWhen, sceneIds: brief.sceneIds, model: brief.model });
        request.assignment = created.assignment;
      }
      if (scope !== scopeEpoch.current) return;
      upsert(request.assignment); setDetail({ assignment: request.assignment });
      const result = await startCharacterStoryWorkAttempt({ projectId: input.project.id, assignmentId: request.assignment.id, expectedAssignmentVersion: request.assignment.version,
        kind: "initial", sourceMode: "submitted-snapshot", instruction: request.assignment.brief, idempotencyKey: request.attemptKey });
      if (scope !== scopeEpoch.current) return;
      upsert(result.state.assignment);
      const next = await getStoryWorkAssignment(input.project.id, request.assignment.id);
      if (scope !== scopeEpoch.current) return;
      setDetail(next);
      if (result.kind === "failed" || result.kind === "canceled" || result.kind === "stale") setError("The assignment stopped without an applicable artifact. Open it to inspect the recorded outcome.");
      submitRequest.current = undefined;
    } finally { if (scope === scopeEpoch.current) setOperationPending(false); }
  }

  const scenes = input.project?.books.filter((book) => !book.archivedAt).flatMap((book) => [
    ...book.parts.flatMap((part) => part.chapters.flatMap((chapter) => chapter.scenes)), ...book.unassignedScenes
  ]).filter((scene) => !scene.archivedAt) ?? [];
  const panel = input.project ? <StoryWorkPanel key={scopeKey} open={panelOpen} projectTitle={input.project.title} supportedTaskKinds={["character"]} models={input.models} selectedModel={input.model}
    selectedSceneId={input.selectedSceneId} scenes={scenes} assignments={assignments} loading={loading} error={error}
    onSubmit={submit} onOpenAssignment={(id) => { void openAssignment(id); }} onRefresh={() => { void refresh(); }} onBackToChat={() => { openSequence.current += 1; setPanelOpen(false); }} onOpenSettings={input.onOpenSettings} /> : null;

  const assignment = detail?.assignment;
  const artifact = detail?.proposal?.outputSchemaId === "character-create-v2" && assignment?.currentArtifact ? {
    pointer: assignment.currentArtifact, payload: validateCharacterCreateV2(detail.proposal.payload)
  } : undefined;
  const review = reviewOpen && assignment && projectId ? artifact && ["awaiting-review", "applied", "rejected"].includes(assignment.status) ? <CharacterStoryWorkReview key={assignment.id}
    artifact={artifact} brief={assignment.brief} constraints={assignment.constraints} doneWhen={assignment.doneWhen}
    revisionInstruction={detail?.attempt?.kind === "revision" ? detail.attempt.instruction : undefined} refreshProblem={projectRefreshError?.assignmentId === assignment.id ? projectRefreshError.message : undefined} status={assignment.status === "applied" ? "applied" : assignment.status === "rejected" ? "rejected" : "review"}
    onDirtyChange={onReviewDirty} onBusyChange={onReviewBusy} onClose={() => closeReview(true)}
    onReload={async () => {
      const [next, project] = await Promise.all([getStoryWorkAssignment(projectId, assignment.id), getProject(projectId)]);
      if (scopeEpoch.current !== renderEpoch) return;
      setDetail(next); upsert(next.assignment); input.onProjectChanged(project); applyRequest.current = undefined; setProjectRefreshError(undefined);
    }}
    onSave={async ({ artifact: pointer, payload }) => {
      const saved = await reviewCharacterStoryWork({ projectId, assignmentId: assignment.id, expectedAssignmentVersion: assignment.version, artifact: pointer, payload, action: "edit" });
      if (scopeEpoch.current !== renderEpoch) throw new Error("This project is no longer open.");
      setDetail((current) => current ? { ...current, ...saved } : current); upsert(saved.assignment);
      return { pointer: saved.assignment.currentArtifact!, payload: validateCharacterCreateV2(saved.proposal.payload) };
    }}
    onReject={async (pointer) => {
      const rejected = await reviewCharacterStoryWork({ projectId, assignmentId: assignment.id, expectedAssignmentVersion: assignment.version, artifact: pointer, action: "reject" });
      if (scopeEpoch.current !== renderEpoch) return;
      setDetail((current) => current ? { ...current, ...rejected } : current); upsert(rejected.assignment);
    }}
    onApply={async (pointer) => {
      if (!input.project) return;
      const prior = applyRequest.current;
      const request = prior?.assignmentId === assignment.id && prior.proposalId === pointer.proposalId ? prior : {
        projectId, assignmentId: assignment.id, expectedAssignmentVersion: assignment.version, expectedProjectVersion: input.project.version,
        proposalId: pointer.proposalId, expectedArtifactVersion: pointer.artifactVersion, expectedProposalContentHash: pointer.contentHash
      };
      applyRequest.current = request;
      const applied = await applyCharacterStoryWork(request).catch((cause) => {
        if (scopeEpoch.current === renderEpoch && cause instanceof GhostwriterApiError && cause.status < 500) applyRequest.current = undefined;
        throw cause;
      });
      if (scopeEpoch.current !== renderEpoch) return;
      setDetail((current) => current ? { ...current, assignment: applied.assignment, proposal: applied.proposal } : current); upsert(applied.assignment);
      try {
        const project = await getProject(projectId);
        if (scopeEpoch.current === renderEpoch) { input.onProjectChanged(project); setProjectRefreshError(undefined); }
      } catch {
        if (scopeEpoch.current === renderEpoch) setProjectRefreshError({ assignmentId: assignment.id, message: "Added to Cast. The story view could not refresh; use Refresh saved review and story to load the acknowledged result." });
      }
    }}
    onRevise={async ({ artifact: pointer, instruction }) => {
      const fingerprint = JSON.stringify({ assignmentId: assignment.id, pointer, instruction });
      if (revisionRequest.current?.fingerprint !== fingerprint) revisionRequest.current = { fingerprint, key: crypto.randomUUID() };
      await startCharacterStoryWorkAttempt({ projectId, assignmentId: assignment.id, expectedAssignmentVersion: assignment.version, kind: "revision", sourceMode: "latest-authorized", instruction, priorArtifact: pointer, idempotencyKey: revisionRequest.current.key });
      let next = await getStoryWorkAssignment(projectId, assignment.id);
      if (scopeEpoch.current !== renderEpoch) return;
      if (next.assignment.status === "artifact-ready" && next.assignment.currentArtifact) {
        const opened = await reviewCharacterStoryWork({ projectId, assignmentId: assignment.id, expectedAssignmentVersion: next.assignment.version, artifact: next.assignment.currentArtifact, action: "open" });
        next = { ...next, ...opened };
      }
      if (scopeEpoch.current !== renderEpoch) return;
      upsert(next.assignment); setDetail(next);
      setReviewOpen(true); revisionRequest.current = undefined;
    }}
    onOpenCharacter={() => {
      const result = assignment.results.find((entry) => entry.kind === "story-knowledge");
      if (result?.kind !== "story-knowledge") return;
      void getProject(projectId).then((project) => {
        if (scopeEpoch.current !== renderEpoch) return;
        input.onProjectChanged(project); setRequestedKnowledgeId(result.storyKnowledgeId); setReviewOpen(false);
      }).catch(() => { if (scopeEpoch.current === renderEpoch) setProjectRefreshError({ assignmentId: assignment.id, message: "The character is saved, but its dossier could not be opened. Refresh the story and try again." }); });
    }}
  /> : <ScrollView contentContainerStyle={{ padding: 24, gap: 14 }}>
    <Text accessibilityRole="header" style={{ fontFamily: ghostwriterTheme.fonts.story, fontSize: 26 }}>Character assignment</Text>
    <Text>{assignment.brief}</Text><Text>Constraints: {assignment.constraints}</Text><Text>Done when: {assignment.doneWhen}</Text><Text>Status: {assignment.status}</Text>
    {detail?.attempt?.kind === "revision" ? <Text>Revision request: {detail.attempt.instruction}</Text> : null}
    <Text>{detail?.run?.terminalDiagnosticCode ?? "No reviewable artifact is available yet."}</Text>
    {["brief-ready", "failed", "canceled", "stale"].includes(assignment.status) ? <Pressable accessibilityRole="button" disabled={operationPending} onPress={() => {
      if (operationPending) return;
      setOperationPending(true);
      const scope = scopeEpoch.current;
      let retry;
      try { retry = { projectId, assignmentId: assignment.id, expectedAssignmentVersion: assignment.version, ...storyWorkRetryInput(assignment, detail?.attempt) }; }
      catch (cause) { setError(cause instanceof Error ? cause.message : "The recorded request is unavailable."); setOperationPending(false); return; }
      const fingerprint = JSON.stringify(retry);
      if (retryRequest.current?.fingerprint !== fingerprint) retryRequest.current = { fingerprint, key: crypto.randomUUID() };
      void startCharacterStoryWorkAttempt({ ...retry, idempotencyKey: retryRequest.current.key })
      .then(async () => { const next = await getStoryWorkAssignment(projectId, assignment.id); if (scope === scopeEpoch.current) { setDetail(next); upsert(next.assignment); retryRequest.current = undefined; } })
        .catch((cause) => { if (scope === scopeEpoch.current) setError(cause instanceof Error ? cause.message : "The attempt could not be started."); })
        .finally(() => { if (scope === scopeEpoch.current) setOperationPending(false); });
    }}><Text>{operationPending ? "Working…" : assignment.status === "brief-ready" ? "Start this assignment" : "Try another generation"}</Text></Pressable> : null}
    {error ? <Text accessibilityRole="alert">{error}</Text> : null}
    <Pressable accessibilityRole="button" onPress={() => { void openAssignment(assignment.id); }}><Text>Refresh assignment</Text></Pressable>
    <Pressable accessibilityRole="button" onPress={() => closeReview(true)}><Text>Back to story</Text></Pressable>
  </ScrollView> : null;

  return { panelOpen, panel, review, dirty: reviewDirty, pending: operationPending, requestedKnowledgeId,
    clearRequestedKnowledge: () => setRequestedKnowledgeId(undefined), open: () => setPanelOpen(true),
    closeReview: () => closeReview(false), refresh };
}
