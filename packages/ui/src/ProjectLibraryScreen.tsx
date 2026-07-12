import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View
} from "react-native";
import type { StoryProjectSummary, WriterProfile } from "@ghostwriter/core";
import brandLockup from "./Ghostwriter.png";
import { ghostwriterTheme } from "./theme.js";

export type ProjectLibraryScreenProps = Readonly<{
  profile: WriterProfile;
  projects: readonly StoryProjectSummary[];
  includeArchived: boolean;
  busy?: boolean;
  profileSaveState?: "idle" | "saving" | "saved" | "error";
  error?: string;
  onCreate(input: Readonly<{ title: string; firstBookTitle: string }>): void;
  onOpen(projectId: string): void;
  onRefresh(): void;
  onSetIncludeArchived(includeArchived: boolean): void;
  onUpdateProfile(input: Readonly<{
    displayName: string;
    expectedVersion: number;
  }>): void;
  onSignOut(): void;
}>;

const { colors, fonts } = ghostwriterTheme;

function ActionButton({
  label,
  onPress,
  primary = false,
  disabled = false
}: Readonly<{
  label: string;
  onPress(): void;
  primary?: boolean;
  disabled?: boolean;
}>) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        primary && styles.buttonPrimary,
        pressed && styles.pressed,
        disabled && styles.disabled
      ]}
    >
      <Text style={[styles.buttonText, primary && styles.buttonTextPrimary]}>
        {label}
      </Text>
    </Pressable>
  );
}

export function ProjectLibraryScreen({
  profile,
  projects,
  includeArchived,
  busy = false,
  profileSaveState = "idle",
  error,
  onCreate,
  onOpen,
  onRefresh,
  onSetIncludeArchived,
  onUpdateProfile,
  onSignOut
}: ProjectLibraryScreenProps) {
  const { width } = useWindowDimensions();
  const compact = width < 760;
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [projectTitle, setProjectTitle] = useState("");
  const [firstBookTitle, setFirstBookTitle] = useState("");

  useEffect(() => setDisplayName(profile.displayName), [profile.displayName]);

  const canCreate = projectTitle.trim().length > 0 && firstBookTitle.trim().length > 0;

  return (
    <View style={styles.screen}>
      <View style={[styles.topbar, compact && styles.topbarCompact]}>
        <Image
          accessibilityLabel="ghost-writer AI Writing Studio"
          resizeMode="contain"
          source={brandLockup}
          style={styles.logo}
        />
        <View style={styles.topbarCopy}>
          <Text style={styles.topbarTitle}>Welcome, {profile.displayName}</Text>
          <Text style={styles.topbarMeta}>Your private project library</Text>
        </View>
        <ActionButton disabled={busy} label="Sign out" onPress={onSignOut} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {error === undefined ? null : (
          <View accessibilityRole="alert" style={styles.error}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <View style={[styles.grid, compact && styles.gridCompact]}>
          <View style={[styles.panel, styles.mainPanel]}>
            <View style={styles.panelHeader}>
              <View>
                <Text style={styles.eyebrow}>Projects</Text>
                <Text style={styles.heading}>Continue your story</Text>
              </View>
              <View style={styles.actionRow}>
                <ActionButton
                  disabled={busy}
                  label={includeArchived ? "Hide archived" : "Show archived"}
                  onPress={() => onSetIncludeArchived(!includeArchived)}
                />
                <ActionButton disabled={busy} label="Refresh" onPress={onRefresh} />
              </View>
            </View>

            {busy && projects.length === 0 ? (
              <ActivityIndicator color={colors.kicker} style={styles.loader} />
            ) : projects.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>No projects yet</Text>
                <Text style={styles.copy}>
                  Create a story project and its first book. Nothing here is sample data.
                </Text>
              </View>
            ) : (
              <View style={styles.projectList}>
                {projects.map((project) => (
                  <Pressable
                    accessibilityHint="Open this project"
                    accessibilityLabel={`Project ${project.title}`}
                    accessibilityRole="button"
                    key={project.id}
                    onPress={() => onOpen(project.id)}
                    style={({ pressed }) => [
                      styles.projectCard,
                      pressed && styles.projectCardPressed
                    ]}
                  >
                    <View style={styles.projectCopy}>
                      <Text style={styles.projectTitle}>{project.title}</Text>
                      <Text style={styles.projectMeta}>
                        {project.bookCount} {project.bookCount === 1 ? "book" : "books"} ·
                        version {project.version}
                      </Text>
                    </View>
                    {project.archivedAt === undefined ? (
                      <Text style={styles.openMark}>Open →</Text>
                    ) : (
                      <Text style={styles.archivedPill}>Archived</Text>
                    )}
                  </Pressable>
                ))}
              </View>
            )}
          </View>

          <View style={styles.sideColumn}>
            <View style={styles.panel}>
              <Text style={styles.eyebrow}>New project</Text>
              <Text style={styles.cardTitle}>Start with the real hierarchy</Text>
              <TextInput
                accessibilityLabel="Project title"
                editable={!busy}
                onChangeText={setProjectTitle}
                placeholder="Project title"
                placeholderTextColor={colors.muted}
                style={styles.input}
                value={projectTitle}
              />
              <TextInput
                accessibilityLabel="First book title"
                editable={!busy}
                onChangeText={setFirstBookTitle}
                placeholder="First book title"
                placeholderTextColor={colors.muted}
                style={styles.input}
                value={firstBookTitle}
              />
              <ActionButton
                disabled={busy || !canCreate}
                label="Create project"
                onPress={() => {
                  onCreate({
                    title: projectTitle.trim(),
                    firstBookTitle: firstBookTitle.trim()
                  });
                  setProjectTitle("");
                  setFirstBookTitle("");
                }}
                primary
              />
            </View>

            <View style={styles.panel}>
              <Text style={styles.eyebrow}>Writer profile</Text>
              <Text style={styles.cardTitle}>How Ghostwriter addresses you</Text>
              <TextInput
                accessibilityLabel="Writer display name"
                editable={!busy}
                onChangeText={setDisplayName}
                placeholder="Display name"
                placeholderTextColor={colors.muted}
                style={styles.input}
                value={displayName}
              />
              <ActionButton
                disabled={
                  busy ||
                  displayName.trim().length === 0 ||
                  displayName.trim() === profile.displayName
                }
                label="Save profile"
                onPress={() =>
                  onUpdateProfile({
                    displayName: displayName.trim(),
                    expectedVersion: profile.version
                  })
                }
              />
              <Text
                accessibilityLiveRegion="polite"
                style={[
                  styles.profileStatus,
                  profileSaveState === "error" && styles.profileStatusError
                ]}
              >
                {profileSaveState === "saving"
                  ? "Saving profile…"
                  : profileSaveState === "saved"
                    ? "Profile saved"
                    : profileSaveState === "error"
                      ? "Profile not saved"
                      : "Profile changes save to your account"}
              </Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: colors.canvas,
    flex: 1
  },
  topbar: {
    alignItems: "center",
    backgroundColor: colors.topbar,
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 14,
    minHeight: 72,
    paddingHorizontal: 18,
    paddingVertical: 8
  },
  topbarCompact: {
    alignItems: "flex-start",
    flexWrap: "wrap"
  },
  logo: {
    height: 56,
    width: 82
  },
  topbarCopy: {
    flex: 1,
    minWidth: 180
  },
  topbarTitle: {
    color: colors.ink,
    fontFamily: fonts.story,
    fontSize: 21
  },
  topbarMeta: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 9,
    marginTop: 2
  },
  content: {
    marginHorizontal: "auto",
    maxWidth: 1180,
    padding: 20,
    width: "100%"
  },
  error: {
    backgroundColor: colors.redSoft,
    borderRadius: 8,
    marginBottom: 12,
    padding: 11
  },
  errorText: {
    color: colors.red,
    fontFamily: fonts.uiMedium,
    fontSize: 10
  },
  grid: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 16
  },
  gridCompact: {
    flexDirection: "column"
  },
  mainPanel: {
    flex: 1,
    minWidth: 0
  },
  sideColumn: {
    gap: 16,
    maxWidth: 360,
    width: "100%"
  },
  panel: {
    backgroundColor: colors.paper,
    borderColor: colors.line,
    borderRadius: 10,
    borderWidth: 1,
    padding: 17,
    width: "100%"
  },
  panelHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    justifyContent: "space-between"
  },
  eyebrow: {
    color: colors.kicker,
    fontFamily: fonts.uiSemibold,
    fontSize: 8,
    letterSpacing: 1.4,
    textTransform: "uppercase"
  },
  heading: {
    color: colors.ink,
    fontFamily: fonts.story,
    fontSize: 30,
    marginTop: 3
  },
  cardTitle: {
    color: colors.ink,
    fontFamily: fonts.story,
    fontSize: 18,
    marginBottom: 10,
    marginTop: 4
  },
  actionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7
  },
  button: {
    alignItems: "center",
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 7,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 36,
    paddingHorizontal: 12,
    paddingVertical: 7
  },
  buttonPrimary: {
    backgroundColor: colors.brandDark,
    borderColor: colors.brandDark
  },
  buttonText: {
    color: colors.ink,
    fontFamily: fonts.uiSemibold,
    fontSize: 10
  },
  buttonTextPrimary: {
    color: "#ffffff"
  },
  pressed: {
    opacity: 0.75
  },
  disabled: {
    opacity: 0.45
  },
  loader: {
    marginVertical: 48
  },
  empty: {
    alignItems: "center",
    borderColor: colors.line,
    borderRadius: 9,
    borderStyle: "dashed",
    borderWidth: 1,
    marginTop: 18,
    padding: 34
  },
  emptyTitle: {
    color: colors.ink,
    fontFamily: fonts.story,
    fontSize: 21
  },
  copy: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 10,
    lineHeight: 16,
    marginTop: 5,
    textAlign: "center"
  },
  projectList: {
    gap: 9,
    marginTop: 18
  },
  projectCard: {
    alignItems: "center",
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    padding: 14
  },
  projectCardPressed: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.kicker
  },
  projectCopy: {
    flex: 1,
    minWidth: 0
  },
  projectTitle: {
    color: colors.ink,
    fontFamily: fonts.story,
    fontSize: 19
  },
  projectMeta: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 9,
    marginTop: 3
  },
  openMark: {
    color: colors.kicker,
    fontFamily: fonts.uiSemibold,
    fontSize: 10
  },
  archivedPill: {
    backgroundColor: colors.amberSoft,
    borderRadius: 999,
    color: colors.amber,
    fontFamily: fonts.uiSemibold,
    fontSize: 8,
    paddingHorizontal: 8,
    paddingVertical: 4
  },
  input: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 7,
    borderWidth: 1,
    color: colors.ink,
    fontFamily: fonts.ui,
    fontSize: 11,
    marginBottom: 9,
    minHeight: 42,
    paddingHorizontal: 11,
    paddingVertical: 9
  },
  profileStatus: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 8,
    marginTop: 8
  },
  profileStatusError: {
    color: colors.red
  }
});
