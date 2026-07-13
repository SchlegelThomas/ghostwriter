import { CormorantGaramond_500Medium } from "@expo-google-fonts/cormorant-garamond/500Medium/index.js";
import { CormorantGaramond_500Medium_Italic } from "@expo-google-fonts/cormorant-garamond/500Medium_Italic/index.js";
import { Jost_400Regular } from "@expo-google-fonts/jost/400Regular/index.js";
import { Jost_500Medium } from "@expo-google-fonts/jost/500Medium/index.js";
import { Jost_600SemiBold } from "@expo-google-fonts/jost/600SemiBold/index.js";
import { Parisienne_400Regular } from "@expo-google-fonts/parisienne/400Regular/index.js";
import type {
  BookId,
  CanvasCommand,
  CanvasObjectId,
  CanvasRevisionId,
  ProjectCommand,
  ProjectNavigator,
  SceneId,
  StoryProjectSummary
} from "@ghostwriter/core";
import {
  AccountGateScreen,
  AuthenticatedProjectWorkspace,
  BookReaderPanel,
  drillBack,
  drillIntoChapter,
  drillIntoScene,
  drillToScope,
  initialDrillStack,
  type CanvasDrillScope,
  type CanvasDrillStack,
  type CanvasWorkflowLens,
  ghostwriterTheme,
  ProjectLibraryScreen,
  type AcknowledgementToast,
  type ProjectWorkspaceMode
} from "@ghostwriter/ui";
import { useFonts } from "expo-font";
import { useEffect, useReducer, useRef, useState } from "react";
import { ActivityIndicator, Linking, View } from "react-native";
import {
  DraftPanel,
  type DraftAcknowledgementEvent,
  type DraftPanelHandle,
  type DraftProblemEvent
} from "./src/DraftPanel.js";
import {
  StoryCanvasPanel,
  type CanvasPanelMessage
} from "./src/StoryCanvasPanel.js";
import {
  beginGoogleSignIn,
  createSceneFromCanvas,
  createProject,
  executeCanvasCommand,
  executeProjectCommand,
  getBookReader,
  getCanvasBoard,
  getCanvasHistory,
  getCanvasPreference,
  getCurrentWriter,
  getProject,
  GhostwriterApiError,
  listProjects,
  releaseSceneLease,
  restoreCanvasRevision,
  saveCanvasPreference,
  signOut,
  undoCanvas,
  updateWriterProfile,
  type BookReaderResponse,
  type CanvasPreferenceResponse,
  type CanvasHistoryResponse,
  type CanvasSceneGeometryInput,
  type CanvasScenePlacementInput,
  type CanvasWorkspaceResponse,
  type CurrentWriter
} from "./src/api.js";
import {
  canvasFailureDisposition,
  preferredCanvasSceneId
} from "./src/canvas-model.js";
import {
  acknowledgementForCanvasCommand,
  acknowledgementForProjectCommand,
  acknowledgementToast,
  problemToast,
  shouldShowDraftAcknowledgement,
  toastReducer
} from "./src/acknowledgements.js";
import type { ManuscriptSelection } from "@ghostwriter/ui";
import { sceneRecoveryService } from "./src/scene-recovery.js";

type AppPhase = "loading" | "signedOut" | "library" | "project";

type ReaderReturnState = Readonly<{
  workspaceMode: ProjectWorkspaceMode;
  selectedSceneId?: SceneId;
  selectedCanvasObjectId?: CanvasObjectId;
}>;

function bookIdForScene(
  project: ProjectNavigator,
  sceneId: SceneId
): BookId | undefined {
  for (const book of project.books) {
    const inTree = [
      ...book.parts.flatMap((part) =>
        part.chapters.flatMap((chapter) => chapter.scenes)
      ),
      ...book.unassignedScenes
    ].some((scene) => scene.id === sceneId);
    if (inTree) return book.id;
  }
  return undefined;
}

function returnUrl(): string {
  if (typeof globalThis.location !== "undefined") {
    return `${globalThis.location.origin}/`;
  }
  return process.env.EXPO_PUBLIC_APP_URL ?? "ghostwriter://";
}

function projectSceneIds(project: ProjectNavigator): readonly SceneId[] {
  return project.books.flatMap((book) => [
    ...book.parts.flatMap((part) =>
      part.chapters.flatMap((chapter) =>
        chapter.scenes.map((scene) => scene.id)
      )
    ),
    ...book.unassignedScenes.map((scene) => scene.id)
  ]);
}

function firstProjectSceneId(project: ProjectNavigator): SceneId | undefined {
  return projectSceneIds(project)[0];
}

export default function App() {
  const [fontsLoaded, fontError] = useFonts({
    [ghostwriterTheme.fonts.brand]: Parisienne_400Regular,
    [ghostwriterTheme.fonts.story]: CormorantGaramond_500Medium,
    [ghostwriterTheme.fonts.storyItalic]: CormorantGaramond_500Medium_Italic,
    [ghostwriterTheme.fonts.ui]: Jost_400Regular,
    [ghostwriterTheme.fonts.uiMedium]: Jost_500Medium,
    [ghostwriterTheme.fonts.uiSemibold]: Jost_600SemiBold
  });
  const [phase, setPhase] = useState<AppPhase>("loading");
  const [writer, setWriter] = useState<CurrentWriter>();
  const [projects, setProjects] = useState<readonly StoryProjectSummary[]>([]);
  const [selectedProject, setSelectedProject] = useState<ProjectNavigator>();
  const [workspaceMode, setWorkspaceMode] =
    useState<ProjectWorkspaceMode>("draft");
  const [drillStack, setDrillStack] =
    useState<CanvasDrillStack>(initialDrillStack);
  const [workflowLens, setWorkflowLens] =
    useState<CanvasWorkflowLens>("outline");
  const [selectedSceneId, setSelectedSceneId] = useState<SceneId>();
  const [canvasWorkspace, setCanvasWorkspace] =
    useState<CanvasWorkspaceResponse>();
  const [canvasPreference, setCanvasPreference] =
    useState<CanvasPreferenceResponse | null>();
  const [canvasHistory, setCanvasHistory] = useState<CanvasHistoryResponse>();
  const [canvasHistoryLoading, setCanvasHistoryLoading] = useState(false);
  const [selectedCanvasObjectId, setSelectedCanvasObjectId] =
    useState<CanvasObjectId>();
  const [canvasLoading, setCanvasLoading] = useState(false);
  const [canvasBusy, setCanvasBusy] = useState(false);
  const [canvasSaveState, setCanvasSaveState] = useState<
    "saved" | "saving" | "error" | "conflict"
  >("saved");
  const [canvasMessage, setCanvasMessage] = useState<CanvasPanelMessage>();
  const [draftMountVersion, setDraftMountVersion] = useState(0);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">(
    "saved"
  );
  const [draftActivity, setDraftActivity] = useState<
    "idle" | "saving" | "problem"
  >("idle");
  const [profileSaveState, setProfileSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [toasts, dispatchToast] = useReducer(toastReducer, []);
  const [readerProjection, setReaderProjection] = useState<BookReaderResponse>();
  const [readerLoading, setReaderLoading] = useState(false);
  const [readerError, setReaderError] = useState<string>();
  const readerReturnStateRef = useRef<ReaderReturnState | undefined>(undefined);
  const draftPanelRef = useRef<DraftPanelHandle>(null);
  const selectedProjectRef = useRef<ProjectNavigator | undefined>(undefined);
  const toastSequenceRef = useRef(0);
  const toastActionsRef = useRef(
    new Map<string, () => void | Promise<void>>()
  );
  const metadataUndoToastIdRef = useRef<string | undefined>(undefined);
  const canvasUndoToastIdRef = useRef<string | undefined>(undefined);
  const lastDraftAcknowledgementAtRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    void bootstrap();
  }, []);

  useEffect(() => {
    selectedProjectRef.current = selectedProject;
  }, [selectedProject]);

  useEffect(() => {
    const timer = setInterval(
      () => dispatchToast({ type: "tick", now: Date.now() }),
      500
    );
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const visibleIds = new Set(toasts.map((toast) => toast.id));
    for (const id of toastActionsRef.current.keys()) {
      if (!visibleIds.has(id)) toastActionsRef.current.delete(id);
    }
    if (
      metadataUndoToastIdRef.current !== undefined &&
      !visibleIds.has(metadataUndoToastIdRef.current)
    ) {
      metadataUndoToastIdRef.current = undefined;
    }
    if (
      canvasUndoToastIdRef.current !== undefined &&
      !visibleIds.has(canvasUndoToastIdRef.current)
    ) {
      canvasUndoToastIdRef.current = undefined;
    }
  }, [toasts]);

  function nextToastId(scope: string): string {
    toastSequenceRef.current += 1;
    return `${scope}-${toastSequenceRef.current}`;
  }

  function showToast(
    toast: AcknowledgementToast,
    action?: () => void | Promise<void>
  ): void {
    if (action !== undefined) toastActionsRef.current.set(toast.id, action);
    dispatchToast({ type: "push", toast });
  }

  function dismissToast(id: string): void {
    toastActionsRef.current.delete(id);
    dispatchToast({ type: "dismiss", id });
  }

  function invalidateMetadataUndo(): void {
    const id = metadataUndoToastIdRef.current;
    if (id === undefined) return;
    toastActionsRef.current.delete(id);
    dispatchToast({ type: "expireAction", id });
    metadataUndoToastIdRef.current = undefined;
  }

  function invalidateCanvasUndo(): void {
    const id = canvasUndoToastIdRef.current;
    if (id === undefined) return;
    toastActionsRef.current.delete(id);
    dispatchToast({ type: "expireAction", id });
    canvasUndoToastIdRef.current = undefined;
  }

  function clearAcknowledgements(): void {
    toastActionsRef.current.clear();
    metadataUndoToastIdRef.current = undefined;
    canvasUndoToastIdRef.current = undefined;
    lastDraftAcknowledgementAtRef.current = undefined;
    dispatchToast({ type: "clear" });
  }

  function resetCanvasState(): void {
    setCanvasWorkspace(undefined);
    setCanvasPreference(undefined);
    setCanvasHistory(undefined);
    setCanvasHistoryLoading(false);
    setSelectedCanvasObjectId(undefined);
    setCanvasLoading(false);
    setCanvasBusy(false);
    setCanvasSaveState("saved");
    setCanvasMessage(undefined);
  }

  function handleError(cause: unknown, fallback: string): void {
    if (cause instanceof GhostwriterApiError && cause.status === 401) {
      setWriter(undefined);
      setProjects([]);
      setSelectedProject(undefined);
      selectedProjectRef.current = undefined;
      setSelectedSceneId(undefined);
      setWorkspaceMode("draft");
      setDraftMountVersion(0);
      setDraftActivity("idle");
      resetCanvasState();
      clearAcknowledgements();
      setPhase("signedOut");
      setError("Your session ended. Sign in again to continue.");
      return;
    }
    setError(cause instanceof Error ? cause.message : fallback);
  }

  async function bootstrap(): Promise<void> {
    setError(undefined);
    try {
      const current = await getCurrentWriter();
      const ownedProjects = await listProjects(false);
      setWriter(current);
      setProjects(ownedProjects);
      setPhase("library");
    } catch (cause) {
      if (cause instanceof GhostwriterApiError && cause.status === 401) {
        setPhase("signedOut");
      } else {
        setPhase("signedOut");
        handleError(cause, "Ghostwriter could not load your account.");
      }
    }
  }

  async function refreshProjects(
    showArchived: boolean = includeArchived
  ): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      setProjects(await listProjects(showArchived));
    } catch (cause) {
      handleError(cause, "Ghostwriter could not refresh your projects.");
    } finally {
      setBusy(false);
    }
  }

  async function startGoogleSignIn(): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      const url = await beginGoogleSignIn(returnUrl());
      if (typeof globalThis.location !== "undefined") {
        globalThis.location.assign(url);
      } else {
        await Linking.openURL(url);
      }
    } catch (cause) {
      handleError(cause, "Google sign-in could not start.");
      setBusy(false);
    }
  }

  async function endSession(): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      const accountId = writer?.account.id;
      await prepareCurrentDraftForExit();
      await signOut();
      if (accountId !== undefined) {
        await sceneRecoveryService.clearAccount(accountId);
      }
      setWriter(undefined);
      setProjects([]);
      setSelectedProject(undefined);
      selectedProjectRef.current = undefined;
      setSelectedSceneId(undefined);
      setWorkspaceMode("draft");
      setDraftMountVersion(0);
      setDraftActivity("idle");
      resetCanvasState();
      clearAcknowledgements();
      setPhase("signedOut");
    } catch (cause) {
      handleError(cause, "Ghostwriter could not sign out.");
    } finally {
      setBusy(false);
    }
  }

  async function openProject(projectId: string): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      const opened = await getProject(projectId);
      clearAcknowledgements();
      setSelectedProject(opened);
      selectedProjectRef.current = opened;
      setSelectedSceneId(firstProjectSceneId(opened));
      setWorkspaceMode("draft");
      setDrillStack(initialDrillStack());
      setWorkflowLens("outline");
      setDraftMountVersion(0);
      setDraftActivity("idle");
      resetCanvasState();
      setSaveState("saved");
      setPhase("project");
    } catch (cause) {
      handleError(cause, "Ghostwriter could not open the project.");
    } finally {
      setBusy(false);
    }
  }

  async function refreshCurrentProject(): Promise<void> {
    if (selectedProject === undefined) return;
    setBusy(true);
    setError(undefined);
    const draftIsVisible =
      workspaceMode === "draft" || workspaceMode === "split";
    if (draftIsVisible) await prepareCurrentDraftForExit();
    try {
      const latest = await getProject(selectedProject.id);
      invalidateMetadataUndo();
      dismissToast("project-conflict");
      dismissToast("project-save-problem");
      setSelectedProject(latest);
      selectedProjectRef.current = latest;
      const sceneIds = projectSceneIds(latest);
      setSelectedSceneId((current) =>
        current !== undefined && sceneIds.includes(current)
          ? current
          : sceneIds[0]
      );
      if (draftIsVisible) {
        setDraftMountVersion((version) => version + 1);
      }
      if (workspaceMode === "canvas" || workspaceMode === "split") {
        await loadCanvas(
          latest.id,
          "Latest project and Canvas loaded for review."
        );
      }
      setSaveState("saved");
    } catch (cause) {
      handleError(cause, "Ghostwriter could not refresh the project.");
    } finally {
      setBusy(false);
    }
  }

  async function makeProject(input: {
    title: string;
    firstBookTitle: string;
  }): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      const created = await createProject(input);
      clearAcknowledgements();
      setSelectedProject(created);
      selectedProjectRef.current = created;
      setSelectedSceneId(firstProjectSceneId(created));
      setWorkspaceMode("draft");
      setDrillStack(initialDrillStack());
      setWorkflowLens("outline");
      setDraftMountVersion(0);
      setDraftActivity("idle");
      resetCanvasState();
      setSaveState("saved");
      setPhase("project");
      const now = Date.now();
      showToast(
        acknowledgementToast({
          id: nextToastId("project"),
          title: "Project created",
          detail: `${created.title} · Saved to project`,
          now
        })
      );
    } catch (cause) {
      handleError(cause, "Ghostwriter could not create the project.");
    } finally {
      setBusy(false);
    }
  }

  async function runCommand(command: ProjectCommand): Promise<boolean> {
    const before = selectedProjectRef.current;
    if (before === undefined) return false;
    const previousSceneIds = new Set(projectSceneIds(before));
    setBusy(true);
    setError(undefined);
    setSaveState("saving");
    try {
      const updated = await executeProjectCommand({
        projectId: before.id,
        expectedVersion: before.version,
        command
      });
      setSelectedProject(updated);
      selectedProjectRef.current = updated;
      const updatedSceneIds = projectSceneIds(updated);
      const createdSceneId =
        command.type === "scene.create"
          ? updatedSceneIds.find((sceneId) => !previousSceneIds.has(sceneId))
          : undefined;
      setSelectedSceneId((current) => {
        if (createdSceneId !== undefined) return createdSceneId;
        return current !== undefined && updatedSceneIds.includes(current)
          ? current
          : updatedSceneIds[0];
      });
      setSaveState("saved");
      dismissToast("project-conflict");
      dismissToast("project-save-problem");

      const acknowledgement = acknowledgementForProjectCommand(
        before,
        command,
        updated
      );
      invalidateMetadataUndo();
      const now = Date.now();
      const id = nextToastId("project");
      const toast = acknowledgementToast({
        id,
        title: acknowledgement.title,
        detail: acknowledgement.detail,
        now,
        ...(acknowledgement.actionLabel === undefined
          ? {}
          : { actionLabel: acknowledgement.actionLabel })
      });
      if (
        acknowledgement.inverse !== undefined &&
        toast.expiresAt !== undefined
      ) {
        metadataUndoToastIdRef.current = id;
        const inverse = acknowledgement.inverse;
        const expiresAt = toast.expiresAt;
        showToast(toast, () =>
          undoProjectCommand(id, inverse, expiresAt)
        );
      } else {
        showToast(toast);
      }

      if (canvasWorkspace !== undefined) {
        try {
          setCanvasWorkspace(await getCanvasBoard(updated.id));
        } catch {
          setCanvasMessage({
            kind: "error",
            text: "Project metadata was saved, but the Canvas spine could not be refreshed."
          });
          showToast(
            problemToast({
              id: "canvas-spine-refresh",
              title: "Canvas spine needs refresh",
              detail:
                "Project metadata was saved, but the Canvas projection could not reload.",
              now: Date.now(),
              dismissible: true
            })
          );
        }
      }
      return true;
    } catch (cause) {
      setSaveState("error");
      if (
        cause instanceof GhostwriterApiError &&
        cause.code === "VERSION_CONFLICT"
      ) {
        invalidateMetadataUndo();
        try {
          const latest = await getProject(before.id);
          setSelectedProject(latest);
          selectedProjectRef.current = latest;
          const latestSceneIds = projectSceneIds(latest);
          setSelectedSceneId((current) =>
            current !== undefined && latestSceneIds.includes(current)
              ? current
              : latestSceneIds[0]
          );
          setError(
            "This project changed in another request. Ghostwriter reloaded the latest version; review and try again."
          );
          showToast(
            problemToast({
              id: "project-conflict",
              title: "Project changed elsewhere",
              detail:
                "Your command changed nothing. The latest project is loaded for review.",
              now: Date.now(),
              actionLabel: "Review latest"
            }),
            () => {
              setError(undefined);
              setSaveState("saved");
              dismissToast("project-conflict");
            }
          );
        } catch (reloadCause) {
          handleError(reloadCause, "Ghostwriter could not reload the project.");
        }
      } else {
        handleError(cause, "Ghostwriter could not save the change.");
        showToast(
          problemToast({
            id: "project-save-problem",
            title: "Project change not saved",
            detail:
              cause instanceof Error
                ? cause.message
                : "Review the current project and retry the action.",
            now: Date.now(),
            tone: "error",
            dismissible: true
          })
        );
      }
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function undoProjectCommand(
    sourceToastId: string,
    command: ProjectCommand,
    expiresAt: number
  ): Promise<void> {
    const before = selectedProjectRef.current;
    if (before === undefined || Date.now() >= expiresAt) {
      dismissToast(sourceToastId);
      return;
    }
    metadataUndoToastIdRef.current = undefined;
    toastActionsRef.current.delete(sourceToastId);
    setBusy(true);
    setError(undefined);
    setSaveState("saving");
    try {
      const updated = await executeProjectCommand({
        projectId: before.id,
        expectedVersion: before.version,
        command
      });
      setSelectedProject(updated);
      selectedProjectRef.current = updated;
      const sceneIds = projectSceneIds(updated);
      setSelectedSceneId((current) =>
        current !== undefined && sceneIds.includes(current)
          ? current
          : sceneIds[0]
      );
      setSaveState("saved");
      dismissToast(sourceToastId);
      const acknowledgement = acknowledgementForProjectCommand(
        before,
        command,
        updated
      );
      showToast(
        acknowledgementToast({
          id: nextToastId("project-undo"),
          title: acknowledgement.title,
          detail: `${acknowledgement.detail} · Undo complete`,
          now: Date.now()
        })
      );
      if (canvasWorkspace !== undefined) {
        try {
          setCanvasWorkspace(await getCanvasBoard(updated.id));
        } catch {
          setCanvasMessage({
            kind: "error",
            text: "The project Undo was saved, but the Canvas spine needs a refresh."
          });
        }
      }
    } catch (cause) {
      setSaveState("error");
      invalidateMetadataUndo();
      if (
        cause instanceof GhostwriterApiError &&
        cause.code === "VERSION_CONFLICT"
      ) {
        try {
          const latest = await getProject(before.id);
          setSelectedProject(latest);
          selectedProjectRef.current = latest;
        } catch {
          // The original inverse remains discarded; an explicit refresh can retry loading.
        }
        setError(
          "Undo was not applied because the project changed again. Ghostwriter kept the latest acknowledged version."
        );
        showToast(
          problemToast({
            id: "project-conflict",
            title: "Undo could not apply",
            detail:
              "The project changed again. Nothing was reversed; review the latest version.",
            now: Date.now(),
            dismissible: true
          })
        );
      } else {
        handleError(cause, "Ghostwriter could not undo the project change.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function saveProfile(input: {
    displayName: string;
    expectedVersion: number;
  }): Promise<void> {
    setBusy(true);
    setError(undefined);
    setProfileSaveState("saving");
    try {
      const result = await updateWriterProfile(input);
      setWriter((current) =>
        current === undefined ? current : { ...current, profile: result.profile }
      );
      setProfileSaveState("saved");
    } catch (cause) {
      setProfileSaveState("error");
      if (
        cause instanceof GhostwriterApiError &&
        cause.code === "VERSION_CONFLICT"
      ) {
        try {
          setWriter(await getCurrentWriter());
          setError(
            "Your profile changed in another tab. Ghostwriter reloaded the latest name; review and save again."
          );
        } catch (reloadCause) {
          handleError(reloadCause, "Ghostwriter could not reload your profile.");
        }
      } else {
        handleError(cause, "Ghostwriter could not update your profile.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function prepareCurrentDraftForExit(): Promise<void> {
    if (draftPanelRef.current !== null) {
      try {
        await draftPanelRef.current.flushAndRelease();
      } catch {
        // Navigation and sign-out must continue when best-effort cleanup fails.
      }
      setDraftActivity("idle");
      return;
    }
    if (selectedProject === undefined || selectedSceneId === undefined) return;
    try {
      await releaseSceneLease({
        projectId: selectedProject.id,
        sceneId: selectedSceneId
      });
    } catch {
      // Lease release is best-effort during navigation and sign-out.
    }
    setDraftActivity("idle");
  }

  async function leaveProject(): Promise<void> {
    setBusy(true);
    setError(undefined);
    await prepareCurrentDraftForExit();
    setReaderProjection(undefined);
    setReaderError(undefined);
    setReaderLoading(false);
    readerReturnStateRef.current = undefined;
    setSelectedSceneId(undefined);
    setSelectedProject(undefined);
    selectedProjectRef.current = undefined;
    setWorkspaceMode("draft");
    setDrillStack(initialDrillStack());
    setWorkflowLens("outline");
    setDraftActivity("idle");
    resetCanvasState();
    clearAcknowledgements();
    setPhase("library");
    setBusy(false);
    void refreshProjects();
  }

  async function loadCanvas(
    projectId: string,
    acknowledgement?: string
  ): Promise<void> {
    setCanvasLoading(true);
    try {
      const [loadedWorkspace, loadedPreference] = await Promise.all([
        getCanvasBoard(projectId),
        getCanvasPreference(projectId)
      ]);
      setCanvasWorkspace(loadedWorkspace);
      setCanvasPreference(loadedPreference);
      setCanvasSaveState("saved");
      setCanvasMessage(undefined);
      dismissToast("canvas-conflict");
      dismissToast("canvas-save-problem");
      if (acknowledgement !== undefined) {
        showToast(
          acknowledgementToast({
            id: nextToastId("canvas-load"),
            title: "Canvas refreshed",
            detail: acknowledgement,
            now: Date.now()
          })
        );
      }
      const preferredObject =
        loadedPreference?.selectedObjectId === undefined
          ? undefined
          : loadedWorkspace.board.objects.find(
              (object) => object.id === loadedPreference.selectedObjectId
            );
      setSelectedCanvasObjectId(preferredObject?.id);
      const preferredSceneId = preferredCanvasSceneId(
        loadedWorkspace.board,
        preferredObject?.id
      );
      if (preferredSceneId !== undefined) setSelectedSceneId(preferredSceneId);
      if (canvasHistory !== undefined) {
        void loadCanvasHistoryForProject(projectId);
      }
    } catch (cause) {
      if (cause instanceof GhostwriterApiError && cause.status === 401) {
        handleError(cause, "Ghostwriter could not load Story Canvas.");
      } else {
        setCanvasSaveState("error");
        setCanvasMessage({
          kind: "error",
          text:
            cause instanceof Error
              ? `Story Canvas could not load: ${cause.message}`
              : "Story Canvas could not load."
        });
        showToast(
          problemToast({
            id: "canvas-save-problem",
            title: "Canvas could not load",
            detail:
              cause instanceof Error
                ? cause.message
                : "Reload the latest Canvas to continue.",
            now: Date.now(),
            tone: "error",
            dismissible: true
          })
        );
      }
    } finally {
      setCanvasLoading(false);
    }
  }

  async function loadCanvasHistoryForProject(projectId: string): Promise<void> {
    setCanvasHistoryLoading(true);
    try {
      setCanvasHistory(await getCanvasHistory(projectId));
    } catch (cause) {
      if (cause instanceof GhostwriterApiError && cause.status === 401) {
        handleError(cause, "Ghostwriter could not load Canvas history.");
      } else {
        setCanvasMessage({
          kind: "error",
          text:
            cause instanceof Error
              ? `Canvas history could not load: ${cause.message}`
              : "Canvas history could not load."
        });
      }
    } finally {
      setCanvasHistoryLoading(false);
    }
  }

  async function changeWorkspaceMode(
    nextMode: ProjectWorkspaceMode
  ): Promise<void> {
    if (nextMode === workspaceMode || selectedProject === undefined) return;
    const draftIsVisible =
      workspaceMode === "draft" || workspaceMode === "split";
    const draftWillBeVisible = nextMode === "draft" || nextMode === "split";
    if (draftIsVisible && !draftWillBeVisible) {
      setBusy(true);
      await prepareCurrentDraftForExit();
      setBusy(false);
    }
    setWorkspaceMode(nextMode);
    if (
      (nextMode === "canvas" || nextMode === "split") &&
      canvasWorkspace === undefined
    ) {
      void loadCanvas(selectedProject.id);
    }
  }

  async function selectWorkspaceScene(sceneId: SceneId): Promise<void> {
    if (sceneId === selectedSceneId) return;
    if (workspaceMode === "draft" || workspaceMode === "split") {
      setBusy(true);
      await prepareCurrentDraftForExit();
      setBusy(false);
    }
    setSelectedSceneId(sceneId);
    setSelectedCanvasObjectId(
      canvasWorkspace?.board.objects.find(
        (object) =>
          object.sceneId === sceneId && object.archivedAt === undefined
      )?.id
    );
  }

  function handleDrillBack(): void {
    setDrillStack((stack) => drillBack(stack));
  }

  function handleDrillTo(scope: CanvasDrillScope): void {
    setDrillStack((stack) => drillToScope(stack, scope));
  }

  function handleEnterChapter(
    selection: Extract<ManuscriptSelection, { kind: "chapter" }>
  ): void {
    setDrillStack((stack) =>
      drillIntoChapter(stack, {
        kind: "chapter",
        bookId: selection.bookId,
        partId: selection.partId,
        chapterId: selection.chapterId
      })
    );
    if (workspaceMode !== "canvas" && workspaceMode !== "split") {
      void changeWorkspaceMode("canvas");
    }
  }

  function handleDrillIntoChapter(
    scope: Extract<CanvasDrillScope, { kind: "chapter" }>
  ): void {
    setDrillStack((stack) => drillIntoChapter(stack, scope));
    if (workspaceMode !== "canvas" && workspaceMode !== "split") {
      void changeWorkspaceMode("canvas");
    }
  }

  function handleDrillIntoScene(
    scope: Extract<CanvasDrillScope, { kind: "scene" }>
  ): void {
    setDrillStack((stack) => drillIntoScene(stack, scope));
    void selectWorkspaceScene(scope.sceneId);
    if (workflowLens === "plan-draft") {
      void changeWorkspaceMode("split");
      return;
    }
    if (workspaceMode !== "canvas" && workspaceMode !== "split") {
      void changeWorkspaceMode("canvas");
    }
  }

  function handleWorkflowLensChange(lens: CanvasWorkflowLens): void {
    setWorkflowLens(lens);
    if (lens === "plan-draft" && selectedSceneId !== undefined) {
      void changeWorkspaceMode("split");
    }
  }

  async function openReader(): Promise<void> {
    if (selectedProject === undefined || selectedSceneId === undefined) return;
    const bookId = bookIdForScene(selectedProject, selectedSceneId);
    if (bookId === undefined) {
      setReaderError("Choose a scene in a book to open Reader.");
      return;
    }

    readerReturnStateRef.current = {
      workspaceMode,
      selectedSceneId,
      selectedCanvasObjectId
    };
    setReaderError(undefined);
    setReaderLoading(true);
    try {
      const projection = await getBookReader({
        projectId: selectedProject.id,
        bookId,
        pinSceneId: selectedSceneId
      });
      setReaderProjection(projection);
    } catch (cause) {
      setReaderProjection(undefined);
      setReaderError(
        cause instanceof GhostwriterApiError
          ? cause.message
          : "Ghostwriter could not open Reader."
      );
    } finally {
      setReaderLoading(false);
    }
  }

  function exitReader(): void {
    const restore = readerReturnStateRef.current;
    setReaderProjection(undefined);
    setReaderError(undefined);
    setReaderLoading(false);
    if (restore === undefined) return;
    setWorkspaceMode(restore.workspaceMode);
    setSelectedSceneId(restore.selectedSceneId);
    setSelectedCanvasObjectId(restore.selectedCanvasObjectId);
    readerReturnStateRef.current = undefined;
  }

  async function handleCanvasFailure(cause: unknown): Promise<void> {
    if (cause instanceof GhostwriterApiError && cause.status === 401) {
      handleError(cause, "Ghostwriter could not save Story Canvas.");
      return;
    }
    const code =
      cause instanceof GhostwriterApiError ? cause.code : undefined;
    const disposition = canvasFailureDisposition(code);
    if (
      disposition !== "preserve-board" &&
      selectedProject !== undefined
    ) {
      invalidateCanvasUndo();
      try {
        const [latestCanvas, latestProject] = await Promise.all([
          getCanvasBoard(selectedProject.id),
          disposition === "reload-project-and-board"
            ? getProject(selectedProject.id)
            : Promise.resolve(undefined)
        ]);
        setCanvasWorkspace(latestCanvas);
        if (latestProject !== undefined) {
          setSelectedProject(latestProject);
          selectedProjectRef.current = latestProject;
          const sceneIds = projectSceneIds(latestProject);
          setSelectedSceneId((current) =>
            current !== undefined && sceneIds.includes(current)
              ? current
              : sceneIds[0]
          );
        }
        const selectedStillExists =
          selectedCanvasObjectId !== undefined &&
          latestCanvas.board.objects.some(
            (object) => object.id === selectedCanvasObjectId
          );
        if (!selectedStillExists) setSelectedCanvasObjectId(undefined);
        setCanvasSaveState("conflict");
        const conflictText =
          disposition === "reload-project-and-board"
            ? "The manuscript changed before this Canvas scene handoff. Ghostwriter created nothing, reloaded both latest views, and left them ready for review."
            : "Story Canvas changed in another request. Ghostwriter applied nothing, reloaded the latest board, and kept the new version ready for review.";
        setCanvasMessage({
          kind: "conflict",
          text: conflictText
        });
        showToast(
          problemToast({
            id: "canvas-conflict",
            title:
              disposition === "reload-project-and-board"
                ? "Manuscript changed during handoff"
                : "Canvas changed elsewhere",
            detail: conflictText,
            now: Date.now(),
            actionLabel: "Reload Canvas"
          }),
          () =>
            loadCanvas(
              selectedProject.id,
              "Latest server-acknowledged Canvas loaded for review."
            )
        );
        return;
      } catch (reloadCause) {
        setCanvasSaveState("error");
        setCanvasMessage({
          kind: "error",
          text:
            reloadCause instanceof Error
              ? `The Canvas conflict was safe, but the latest board could not reload: ${reloadCause.message}`
              : "The Canvas conflict was safe, but the latest board could not reload."
        });
        showToast(
          problemToast({
            id: "canvas-save-problem",
            title: "Canvas conflict needs review",
            detail:
              reloadCause instanceof Error
                ? reloadCause.message
                : "The latest Canvas could not reload.",
            now: Date.now(),
            tone: "error",
            dismissible: true
          })
        );
        return;
      }
    }
    setCanvasSaveState("error");
    setCanvasMessage({
      kind: "error",
      text:
        cause instanceof Error
          ? `Canvas content was not changed: ${cause.message}`
          : "Canvas content was not changed. Review the current board and retry."
    });
    showToast(
      problemToast({
        id: "canvas-save-problem",
        title: "Canvas change not saved",
        detail:
          cause instanceof Error
            ? cause.message
            : "Review the current board and retry.",
        now: Date.now(),
        tone: "error",
        dismissible: true
      })
    );
  }

  async function runCanvasCommand(command: CanvasCommand): Promise<boolean> {
    if (selectedProject === undefined || canvasWorkspace === undefined) {
      return false;
    }
    const previousObjectIds = new Set(
      canvasWorkspace.board.objects.map((object) => object.id)
    );
    setCanvasBusy(true);
    setCanvasSaveState("saving");
    setCanvasMessage(undefined);
    try {
      const updated = await executeCanvasCommand({
        projectId: selectedProject.id,
        expectedCanvasVersion: canvasWorkspace.board.version,
        command
      });
      setCanvasWorkspace(updated);
      setCanvasSaveState("saved");
      dismissToast("canvas-conflict");
      dismissToast("canvas-save-problem");
      const acknowledgement = acknowledgementForCanvasCommand(command);
      invalidateCanvasUndo();
      const now = Date.now();
      const id = nextToastId("canvas");
      const toast = acknowledgementToast({
        id,
        title: acknowledgement.title,
        detail: acknowledgement.detail,
        actionLabel: acknowledgement.actionLabel,
        now
      });
      canvasUndoToastIdRef.current = id;
      showToast(toast, () => undoLatestCanvasCommand(id));
      if (canvasHistory !== undefined) {
        void loadCanvasHistoryForProject(selectedProject.id);
      }
      if (
        command.type === "canvas.object.create" ||
        command.type === "canvas.object.place"
      ) {
        const created = updated.board.objects.find(
          (object) => !previousObjectIds.has(object.id)
        );
        if (created !== undefined) {
          setSelectedCanvasObjectId(created.id);
          if (created.sceneId !== undefined) setSelectedSceneId(created.sceneId);
        }
      }
      return true;
    } catch (cause) {
      await handleCanvasFailure(cause);
      return false;
    } finally {
      setCanvasBusy(false);
    }
  }

  async function undoLatestCanvasCommand(sourceToastId?: string): Promise<void> {
    if (selectedProject === undefined || canvasWorkspace === undefined) return;
    setCanvasBusy(true);
    setCanvasSaveState("saving");
    setCanvasMessage(undefined);
    try {
      const updated = await undoCanvas({
        projectId: selectedProject.id,
        expectedCanvasVersion: canvasWorkspace.board.version
      });
      setCanvasWorkspace(updated);
      setCanvasSaveState("saved");
      invalidateCanvasUndo();
      if (sourceToastId !== undefined) dismissToast(sourceToastId);
      if (canvasHistory !== undefined) {
        void loadCanvasHistoryForProject(selectedProject.id);
      }
      setCanvasMessage(undefined);
      showToast(
        acknowledgementToast({
          id: nextToastId("canvas-undo"),
          title: "Canvas action undone",
          detail:
            "Draft prose and canonical manuscript order were unchanged.",
          now: Date.now()
        })
      );
      if (
        selectedCanvasObjectId !== undefined &&
        !updated.board.objects.some(
          (object) => object.id === selectedCanvasObjectId
        )
      ) {
        setSelectedCanvasObjectId(undefined);
      }
    } catch (cause) {
      await handleCanvasFailure(cause);
    } finally {
      setCanvasBusy(false);
    }
  }

  async function restoreCanvasSnapshot(
    revisionId: CanvasRevisionId
  ): Promise<boolean> {
    if (selectedProject === undefined || canvasWorkspace === undefined) {
      return false;
    }
    setCanvasBusy(true);
    setCanvasSaveState("saving");
    setCanvasMessage(undefined);
    let restored: CanvasWorkspaceResponse | undefined;
    try {
      restored = await restoreCanvasRevision({
        projectId: selectedProject.id,
        expectedCanvasVersion: canvasWorkspace.board.version,
        revisionId
      });
      const [reloaded, updatedHistory] = await Promise.all([
        getCanvasBoard(selectedProject.id),
        getCanvasHistory(selectedProject.id)
      ]);
      setCanvasWorkspace(reloaded);
      setCanvasHistory(updatedHistory);
      setCanvasSaveState("saved");
      setCanvasMessage(undefined);
      invalidateCanvasUndo();
      const now = Date.now();
      const id = nextToastId("canvas-restore");
      const toast = acknowledgementToast({
        id,
        title: "Canvas snapshot restored",
        detail:
          "The earlier board is current. Draft prose and manuscript order were unchanged.",
        actionLabel: "Undo",
        now
      });
      canvasUndoToastIdRef.current = id;
      showToast(toast, () => undoLatestCanvasCommand(id));
      if (
        selectedCanvasObjectId !== undefined &&
        !reloaded.board.objects.some(
          (object) => object.id === selectedCanvasObjectId
        )
      ) {
        setSelectedCanvasObjectId(undefined);
      }
      return true;
    } catch (cause) {
      if (restored !== undefined) {
        setCanvasWorkspace(restored);
        setCanvasSaveState("error");
        setCanvasMessage({
          kind: "error",
          text:
            cause instanceof Error
              ? `The Canvas snapshot was restored, but the acknowledged board could not reload: ${cause.message}`
              : "The Canvas snapshot was restored, but the acknowledged board could not reload."
        });
        return true;
      }
      await handleCanvasFailure(cause);
      return false;
    } finally {
      setCanvasBusy(false);
    }
  }

  async function persistCanvasPreference(input: {
    x: number;
    y: number;
    zoom: number;
    selectedObjectId?: CanvasObjectId | null;
  }): Promise<void> {
    if (selectedProject === undefined) return;
    if (input.selectedObjectId !== undefined) {
      setSelectedCanvasObjectId(input.selectedObjectId ?? undefined);
    }
    try {
      setCanvasPreference(
        await saveCanvasPreference({
          projectId: selectedProject.id,
          ...input
        })
      );
    } catch (cause) {
      setCanvasMessage({
        kind: "error",
        text:
          cause instanceof Error
            ? `Canvas content is safe, but this personal view was not saved: ${cause.message}`
            : "Canvas content is safe, but this personal view was not saved."
      });
    }
  }

  async function createStoryboardScene(input: {
    title: string;
    manuscriptPlacement: CanvasScenePlacementInput;
    canvas: CanvasSceneGeometryInput;
  }): Promise<boolean> {
    if (selectedProject === undefined || canvasWorkspace === undefined) {
      return false;
    }
    setCanvasBusy(true);
    setCanvasSaveState("saving");
    setCanvasMessage(undefined);
    try {
      const result = await createSceneFromCanvas({
        projectId: selectedProject.id,
        expectedProjectVersion: selectedProject.version,
        expectedCanvasVersion: canvasWorkspace.board.version,
        ...input
      });
      if (workspaceMode === "split") {
        await prepareCurrentDraftForExit();
      }
      setSelectedProject(result.navigator);
      selectedProjectRef.current = result.navigator;
      setCanvasWorkspace(result.canvas);
      setSelectedSceneId(result.scene.id);
      setSelectedCanvasObjectId(
        result.canvas.board.objects.find(
          (object) => object.sceneId === result.scene.id
        )?.id
      );
      setCanvasSaveState("saved");
      setCanvasMessage(undefined);
      invalidateMetadataUndo();
      invalidateCanvasUndo();
      showToast(
        acknowledgementToast({
          id: nextToastId("canvas-scene"),
          title: "Scene created in Canvas and Draft",
          detail: `${result.scene.title} · One acknowledged transaction`,
          now: Date.now()
        })
      );
      return true;
    } catch (cause) {
      await handleCanvasFailure(cause);
      return false;
    } finally {
      setCanvasBusy(false);
    }
  }

  function handleDraftAcknowledgement(
    event: DraftAcknowledgementEvent
  ): void {
    const now = Date.now();
    if (event.kind === "save") {
      if (
        !shouldShowDraftAcknowledgement(
          lastDraftAcknowledgementAtRef.current,
          now
        )
      ) {
        return;
      }
      lastDraftAcknowledgementAtRef.current = now;
    }
    showToast(
      acknowledgementToast({
        id: nextToastId(`draft-${event.kind}`),
        title: event.title,
        detail:
          event.kind === "save"
            ? `${event.detail} · Saved to project`
            : event.detail,
        now
      })
    );
  }

  function handleDraftProblem(problem: DraftProblemEvent): void {
    showToast(
      problemToast({
        id: problem.id,
        title: problem.title,
        detail: problem.detail,
        tone: problem.tone,
        now: Date.now()
      })
    );
  }

  if (!fontsLoaded && fontError === null) {
    return (
      <View
        accessibilityLabel="Loading Ghostwriter"
        style={{
          alignItems: "center",
          backgroundColor: ghostwriterTheme.colors.paper,
          flex: 1,
          justifyContent: "center"
        }}
      >
        <ActivityIndicator color={ghostwriterTheme.colors.kicker} />
      </View>
    );
  }

  if (phase === "loading" || phase === "signedOut" || writer === undefined) {
    return (
      <AccountGateScreen
        error={error}
        loading={phase === "loading"}
        onSignIn={() => void startGoogleSignIn()}
        signingIn={busy && phase === "signedOut"}
      />
    );
  }

  if (phase === "project" && selectedProject !== undefined) {
    if (readerProjection !== undefined || readerLoading || readerError !== undefined) {
      return (
        <BookReaderPanel
          busy={readerLoading}
          error={readerError}
          onExit={exitReader}
          projection={readerProjection}
        />
      );
    }

    return (
      <AuthenticatedProjectWorkspace
        allChangesIdle={
          saveState === "saved" &&
          canvasSaveState === "saved" &&
          draftActivity === "idle" &&
          !busy &&
          !canvasBusy
        }
        busy={busy}
        drillStack={drillStack}
        error={error}
        mode={workspaceMode}
        onBack={() => void leaveProject()}
        onCommand={runCommand}
        onDrillBack={handleDrillBack}
        onDrillTo={handleDrillTo}
        onEnterChapter={handleEnterChapter}
        onModeChange={(mode) => void changeWorkspaceMode(mode)}
        onOpenReader={() => void openReader()}
        onRefresh={() => void refreshCurrentProject()}
        onSelectedSceneIdChange={(sceneId) => {
          if (sceneId !== undefined) void selectWorkspaceScene(sceneId);
        }}
        onSignOut={() => void endSession()}
        onToastAction={(id) => {
          const action = toastActionsRef.current.get(id);
          if (action !== undefined) void action();
        }}
        onToastDismiss={dismissToast}
        onToastPause={(id) =>
          dispatchToast({ type: "pause", id, now: Date.now() })
        }
        onToastResume={(id) =>
          dispatchToast({ type: "resume", id, now: Date.now() })
        }
        onWorkflowLensChange={handleWorkflowLensChange}
        profileDisplayName={writer.profile.displayName}
        project={selectedProject}
        storageAccountId={writer.account.id}
        renderCanvas={
          <StoryCanvasPanel
            busy={canvasBusy}
            condensed={workspaceMode === "split"}
            drillStack={drillStack}
            history={canvasHistory}
            historyLoading={canvasHistoryLoading}
            loading={canvasLoading}
            message={canvasMessage}
            onCommand={runCanvasCommand}
            onCreateScene={createStoryboardScene}
            onDrillIntoChapter={handleDrillIntoChapter}
            onDrillIntoScene={handleDrillIntoScene}
            onLoadHistory={() =>
              loadCanvasHistoryForProject(selectedProject.id)
            }
            onPreferenceChange={persistCanvasPreference}
            onReload={() =>
              loadCanvas(
                selectedProject.id,
                "Latest server-acknowledged Canvas loaded for review."
              )
            }
            onRestoreRevision={restoreCanvasSnapshot}
            onSelectObject={setSelectedCanvasObjectId}
            onSelectScene={(sceneId) => void selectWorkspaceScene(sceneId)}
            onUndo={undoLatestCanvasCommand}
            preference={canvasPreference}
            project={selectedProject}
            saveState={canvasSaveState}
            selectedObjectId={selectedCanvasObjectId}
            selectedSceneId={selectedSceneId}
            workflowLens={workflowLens}
            workspace={canvasWorkspace}
          />
        }
        renderDraft={(scene) =>
          scene === undefined ? null : (
            <DraftPanel
              accountId={writer.account.id}
              key={`${scene.id}:${draftMountVersion}`}
              onAcknowledgement={handleDraftAcknowledgement}
              onActivityChange={setDraftActivity}
              onProblem={handleDraftProblem}
              onProblemResolved={dismissToast}
              projectId={selectedProject.id}
              readOnly={scene.archivedAt !== undefined}
              ref={draftPanelRef}
              sceneId={scene.id}
              sceneTitle={scene.title}
            />
          )
        }
        selectedSceneId={selectedSceneId}
        toasts={toasts}
        workflowLens={workflowLens}
      />
    );
  }

  return (
    <ProjectLibraryScreen
      busy={busy}
      error={error}
      includeArchived={includeArchived}
      onCreate={(input) => void makeProject(input)}
      onOpen={(projectId) => void openProject(projectId)}
      onRefresh={() => void refreshProjects()}
      onSetIncludeArchived={(next) => {
        setIncludeArchived(next);
        void refreshProjects(next);
      }}
      onSignOut={() => void endSession()}
      onUpdateProfile={(input) => void saveProfile(input)}
      profile={writer.profile}
      profileSaveState={profileSaveState}
      projects={projects}
    />
  );
}
