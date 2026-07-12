import { CormorantGaramond_500Medium } from "@expo-google-fonts/cormorant-garamond/500Medium/index.js";
import { CormorantGaramond_500Medium_Italic } from "@expo-google-fonts/cormorant-garamond/500Medium_Italic/index.js";
import { Jost_400Regular } from "@expo-google-fonts/jost/400Regular/index.js";
import { Jost_500Medium } from "@expo-google-fonts/jost/500Medium/index.js";
import { Jost_600SemiBold } from "@expo-google-fonts/jost/600SemiBold/index.js";
import { Parisienne_400Regular } from "@expo-google-fonts/parisienne/400Regular/index.js";
import type {
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
  ghostwriterTheme,
  ProjectLibraryScreen,
  type ProjectWorkspaceMode
} from "@ghostwriter/ui";
import { useFonts } from "expo-font";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, View } from "react-native";
import { DraftPanel, type DraftPanelHandle } from "./src/DraftPanel.js";
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
import { sceneRecoveryService } from "./src/scene-recovery.js";

type AppPhase = "loading" | "signedOut" | "library" | "project";

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
    useState<ProjectWorkspaceMode>("setup");
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
  const [profileSaveState, setProfileSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const draftPanelRef = useRef<DraftPanelHandle>(null);

  useEffect(() => {
    void bootstrap();
  }, []);

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
      setSelectedSceneId(undefined);
      setWorkspaceMode("setup");
      setDraftMountVersion(0);
      resetCanvasState();
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
      setSelectedSceneId(undefined);
      setWorkspaceMode("setup");
      setDraftMountVersion(0);
      resetCanvasState();
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
      setSelectedProject(opened);
      setSelectedSceneId(firstProjectSceneId(opened));
      setWorkspaceMode(
        firstProjectSceneId(opened) === undefined ? "setup" : "draft"
      );
      setDraftMountVersion(0);
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
      setSelectedProject(latest);
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
      setSelectedProject(created);
      setSelectedSceneId(firstProjectSceneId(created));
      setWorkspaceMode("setup");
      setDraftMountVersion(0);
      resetCanvasState();
      setSaveState("saved");
      setPhase("project");
    } catch (cause) {
      handleError(cause, "Ghostwriter could not create the project.");
    } finally {
      setBusy(false);
    }
  }

  async function runCommand(command: ProjectCommand): Promise<void> {
    if (selectedProject === undefined) return;
    const previousSceneIds = new Set(projectSceneIds(selectedProject));
    setBusy(true);
    setError(undefined);
    setSaveState("saving");
    try {
      const updated = await executeProjectCommand({
        projectId: selectedProject.id,
        expectedVersion: selectedProject.version,
        command
      });
      setSelectedProject(updated);
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
      if (canvasWorkspace !== undefined) {
        try {
          setCanvasWorkspace(await getCanvasBoard(updated.id));
        } catch {
          setCanvasMessage({
            kind: "error",
            text: "Project metadata was saved, but the Canvas spine could not be refreshed."
          });
        }
      }
    } catch (cause) {
      setSaveState("error");
      if (
        cause instanceof GhostwriterApiError &&
        cause.code === "VERSION_CONFLICT"
      ) {
        try {
          const latest = await getProject(selectedProject.id);
          setSelectedProject(latest);
          const latestSceneIds = projectSceneIds(latest);
          setSelectedSceneId((current) =>
            current !== undefined && latestSceneIds.includes(current)
              ? current
              : latestSceneIds[0]
          );
          setError(
            "This project changed in another request. Ghostwriter reloaded the latest version; review and try again."
          );
        } catch (reloadCause) {
          handleError(reloadCause, "Ghostwriter could not reload the project.");
        }
      } else {
        handleError(cause, "Ghostwriter could not save the change.");
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
  }

  async function leaveProject(): Promise<void> {
    setBusy(true);
    setError(undefined);
    await prepareCurrentDraftForExit();
    setSelectedSceneId(undefined);
    setSelectedProject(undefined);
    setWorkspaceMode("setup");
    resetCanvasState();
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
      setCanvasMessage(
        acknowledgement === undefined
          ? undefined
          : { kind: "notice", text: acknowledgement }
      );
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
        setCanvasMessage({
          kind: "conflict",
          text:
            disposition === "reload-project-and-board"
              ? "The manuscript changed before this Canvas scene handoff. Ghostwriter created nothing, reloaded both latest views, and left them ready for review."
              : "Story Canvas changed in another request. Ghostwriter applied nothing, reloaded the latest board, and kept the new version ready for review."
        });
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

  async function undoLatestCanvasCommand(): Promise<void> {
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
      if (canvasHistory !== undefined) {
        void loadCanvasHistoryForProject(selectedProject.id);
      }
      setCanvasMessage({
        kind: "notice",
        text: "The latest Canvas command was undone. Draft prose and manuscript order were unchanged."
      });
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
      setCanvasMessage({
        kind: "notice",
        text: "The selected Canvas snapshot was restored as a new current board. Draft prose and manuscript order were unchanged."
      });
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
      setCanvasWorkspace(result.canvas);
      setSelectedSceneId(result.scene.id);
      setSelectedCanvasObjectId(
        result.canvas.board.objects.find(
          (object) => object.sceneId === result.scene.id
        )?.id
      );
      setCanvasSaveState("saved");
      setCanvasMessage({
        kind: "notice",
        text: `Scene “${result.scene.title}” was created once, placed on Canvas, and added to Draft.`
      });
      return true;
    } catch (cause) {
      await handleCanvasFailure(cause);
      return false;
    } finally {
      setCanvasBusy(false);
    }
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
    return (
      <AuthenticatedProjectWorkspace
        busy={busy}
        error={error}
        mode={workspaceMode}
        onBack={() => void leaveProject()}
        onCommand={(command) => void runCommand(command)}
        onModeChange={(mode) => void changeWorkspaceMode(mode)}
        onRefresh={() => void refreshCurrentProject()}
        onSelectedSceneIdChange={(sceneId) => {
          if (sceneId !== undefined) void selectWorkspaceScene(sceneId);
        }}
        onSignOut={() => void endSession()}
        profileDisplayName={writer.profile.displayName}
        project={selectedProject}
        renderCanvas={
          <StoryCanvasPanel
            busy={canvasBusy}
            condensed={workspaceMode === "split"}
            history={canvasHistory}
            historyLoading={canvasHistoryLoading}
            loading={canvasLoading}
            message={canvasMessage}
            onCommand={runCanvasCommand}
            onCreateScene={createStoryboardScene}
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
            workspace={canvasWorkspace}
          />
        }
        renderDraft={(scene) =>
          scene === undefined ? null : (
            <DraftPanel
              accountId={writer.account.id}
              key={`${scene.id}:${draftMountVersion}`}
              projectId={selectedProject.id}
              readOnly={scene.archivedAt !== undefined}
              ref={draftPanelRef}
              sceneId={scene.id}
              sceneTitle={scene.title}
            />
          )
        }
        saveState={saveState}
        selectedSceneId={selectedSceneId}
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
