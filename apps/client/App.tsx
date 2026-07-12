import { CormorantGaramond_500Medium } from "@expo-google-fonts/cormorant-garamond/500Medium/index.js";
import { CormorantGaramond_500Medium_Italic } from "@expo-google-fonts/cormorant-garamond/500Medium_Italic/index.js";
import { Jost_400Regular } from "@expo-google-fonts/jost/400Regular/index.js";
import { Jost_500Medium } from "@expo-google-fonts/jost/500Medium/index.js";
import { Jost_600SemiBold } from "@expo-google-fonts/jost/600SemiBold/index.js";
import { Parisienne_400Regular } from "@expo-google-fonts/parisienne/400Regular/index.js";
import type {
  ProjectCommand,
  ProjectNavigator,
  StoryProjectSummary
} from "@ghostwriter/core";
import {
  AccountGateScreen,
  AuthenticatedProjectWorkspace,
  ghostwriterTheme,
  ProjectLibraryScreen
} from "@ghostwriter/ui";
import { useFonts } from "expo-font";
import { useEffect, useState } from "react";
import { ActivityIndicator, Linking, View } from "react-native";
import {
  beginGoogleSignIn,
  createProject,
  executeProjectCommand,
  getCurrentWriter,
  getProject,
  GhostwriterApiError,
  listProjects,
  signOut,
  updateWriterProfile,
  type CurrentWriter
} from "./src/api.js";

type AppPhase = "loading" | "signedOut" | "library" | "project";

function returnUrl(): string {
  if (typeof globalThis.location !== "undefined") {
    return `${globalThis.location.origin}/`;
  }
  return process.env.EXPO_PUBLIC_APP_URL ?? "ghostwriter://";
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
  const [includeArchived, setIncludeArchived] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">(
    "saved"
  );

  useEffect(() => {
    void bootstrap();
  }, []);

  function handleError(cause: unknown, fallback: string): void {
    if (cause instanceof GhostwriterApiError && cause.status === 401) {
      setWriter(undefined);
      setProjects([]);
      setSelectedProject(undefined);
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
      await signOut();
      setWriter(undefined);
      setProjects([]);
      setSelectedProject(undefined);
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
      setSelectedProject(await getProject(projectId));
      setSaveState("saved");
      setPhase("project");
    } catch (cause) {
      handleError(cause, "Ghostwriter could not open the project.");
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
      setSaveState("saved");
    } catch (cause) {
      setSaveState("error");
      if (
        cause instanceof GhostwriterApiError &&
        cause.code === "VERSION_CONFLICT"
      ) {
        try {
          setSelectedProject(await getProject(selectedProject.id));
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
    try {
      const result = await updateWriterProfile(input);
      setWriter((current) =>
        current === undefined ? current : { ...current, profile: result.profile }
      );
    } catch (cause) {
      handleError(cause, "Ghostwriter could not update your profile.");
    } finally {
      setBusy(false);
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
        onBack={() => {
          setSelectedProject(undefined);
          setPhase("library");
          void refreshProjects();
        }}
        onCommand={(command) => void runCommand(command)}
        onRefresh={() => void openProject(selectedProject.id)}
        onSignOut={() => void endSession()}
        profileDisplayName={writer.profile.displayName}
        project={selectedProject}
        saveState={saveState}
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
      projects={projects}
    />
  );
}
