import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View
} from "react-native";
import type {
  StoryProjectSummary,
  WriterProfile,
  WriterPublishingDetails
} from "@ghostwriter/core";
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
    publishing?: WriterPublishingDetails | null;
    expectedVersion: number;
  }>): void;
  onSignOut(): void;
}>;

type ProfileDraft = Readonly<{
  displayName: string;
  legalName: string;
  contactEmail: string;
  phone: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  website: string;
  bio: string;
  agentName: string;
  agencyName: string;
}>;

function draftFromProfile(profile: WriterProfile): ProfileDraft {
  const publishing = profile.publishing;
  return {
    displayName: profile.displayName,
    legalName: publishing?.legalName ?? "",
    contactEmail: publishing?.contactEmail ?? "",
    phone: publishing?.phone ?? "",
    addressLine1: publishing?.addressLine1 ?? "",
    addressLine2: publishing?.addressLine2 ?? "",
    city: publishing?.city ?? "",
    region: publishing?.region ?? "",
    postalCode: publishing?.postalCode ?? "",
    country: publishing?.country ?? "",
    website: publishing?.website ?? "",
    bio: publishing?.bio ?? "",
    agentName: publishing?.agentName ?? "",
    agencyName: publishing?.agencyName ?? ""
  };
}

function publishingFromDraft(draft: ProfileDraft): WriterPublishingDetails {
  return {
    legalName: draft.legalName,
    contactEmail: draft.contactEmail,
    phone: draft.phone,
    addressLine1: draft.addressLine1,
    addressLine2: draft.addressLine2,
    city: draft.city,
    region: draft.region,
    postalCode: draft.postalCode,
    country: draft.country,
    website: draft.website,
    bio: draft.bio,
    agentName: draft.agentName,
    agencyName: draft.agencyName
  };
}

function profileSummaryLines(profile: WriterProfile): readonly string[] {
  const publishing = profile.publishing;
  const lines: string[] = [];
  if (publishing?.legalName) lines.push(publishing.legalName);
  const place = [publishing?.city, publishing?.region, publishing?.country]
    .filter((part): part is string => part !== undefined && part.length > 0)
    .join(", ");
  if (place.length > 0) lines.push(place);
  if (publishing?.contactEmail) lines.push(publishing.contactEmail);
  if (publishing?.agentName || publishing?.agencyName) {
    lines.push(
      [publishing.agentName, publishing.agencyName]
        .filter((part): part is string => part !== undefined && part.length > 0)
        .join(" · ")
    );
  }
  return lines;
}

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
  const [profileOpen, setProfileOpen] = useState(false);
  const [draft, setDraft] = useState<ProfileDraft>(() => draftFromProfile(profile));
  const [projectTitle, setProjectTitle] = useState("");
  const [firstBookTitle, setFirstBookTitle] = useState("");

  useEffect(() => {
    if (!profileOpen) setDraft(draftFromProfile(profile));
  }, [profile, profileOpen]);

  const canCreate = projectTitle.trim().length > 0 && firstBookTitle.trim().length > 0;
  const summaryLines = profileSummaryLines(profile);
  const baseline = draftFromProfile(profile);
  const canSaveProfile =
    draft.displayName.trim().length > 0 &&
    (draft.displayName.trim() !== baseline.displayName.trim() ||
      JSON.stringify(draft) !== JSON.stringify(baseline));

  useEffect(() => {
    if (profileSaveState === "saved" && profileOpen) {
      setProfileOpen(false);
    }
  }, [profileOpen, profileSaveState]);

  function patchDraft<Key extends keyof ProfileDraft>(
    key: Key,
    value: ProfileDraft[Key]
  ): void {
    setDraft((current) => ({ ...current, [key]: value }));
  }

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
              <View style={styles.profileCardHeader}>
                <Text style={styles.eyebrow}>Writer profile</Text>
                <Pressable
                  accessibilityLabel="Edit writer profile"
                  accessibilityRole="button"
                  disabled={busy}
                  onPress={() => {
                    setDraft(draftFromProfile(profile));
                    setProfileOpen(true);
                  }}
                  style={({ pressed }) => [
                    styles.pencilButton,
                    pressed && styles.pressed,
                    busy && styles.disabled
                  ]}
                >
                  <Text style={styles.pencilGlyph}>✎</Text>
                </Pressable>
              </View>
              <Text style={styles.cardTitle}>{profile.displayName}</Text>
              {summaryLines.length === 0 ? (
                <Text style={styles.profileHint}>
                  Add publishing contact details for submissions and rights.
                </Text>
              ) : (
                summaryLines.map((line) => (
                  <Text key={line} style={styles.profileDetail}>
                    {line}
                  </Text>
                ))
              )}
              {profileSaveState === "idle" ? null : (
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
                      : "Profile not saved"}
                </Text>
              )}
            </View>
          </View>
        </View>
      </ScrollView>

      <Modal
        animationType="fade"
        onRequestClose={() => setProfileOpen(false)}
        transparent
        visible={profileOpen}
      >
        <View
          accessibilityLabel="Writer profile dialog"
          accessibilityViewIsModal
          style={styles.modalRoot}
        >
          <Pressable
            accessibilityLabel="Dismiss profile editor"
            accessibilityRole="button"
            onPress={() => setProfileOpen(false)}
            style={styles.modalBackdrop}
          />
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View style={styles.modalHeadingCopy}>
                <Text style={styles.eyebrow}>Writer profile</Text>
                <Text style={styles.modalTitle}>Publishing details</Text>
                <Text style={styles.modalRule}>
                  Pen name, legal contact, mailing address, and representation
                  for when you submit work.
                </Text>
              </View>
              <Pressable
                accessibilityLabel="Close profile editor"
                accessibilityRole="button"
                onPress={() => setProfileOpen(false)}
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
              <Text style={styles.fieldLabel}>Pen name</Text>
              <TextInput
                accessibilityLabel="Pen name"
                editable={!busy}
                onChangeText={(value) => patchDraft("displayName", value)}
                placeholder="How Ghostwriter addresses you"
                placeholderTextColor={colors.muted}
                style={styles.input}
                value={draft.displayName}
              />
              <Text style={styles.fieldLabel}>Legal name</Text>
              <TextInput
                accessibilityLabel="Legal name"
                editable={!busy}
                onChangeText={(value) => patchDraft("legalName", value)}
                placeholder="Name for contracts"
                placeholderTextColor={colors.muted}
                style={styles.input}
                value={draft.legalName}
              />
              <Text style={styles.fieldLabel}>Contact email</Text>
              <TextInput
                accessibilityLabel="Contact email"
                autoCapitalize="none"
                editable={!busy}
                keyboardType="email-address"
                onChangeText={(value) => patchDraft("contactEmail", value)}
                placeholder="publishing@example.com"
                placeholderTextColor={colors.muted}
                style={styles.input}
                value={draft.contactEmail}
              />
              <Text style={styles.fieldLabel}>Phone</Text>
              <TextInput
                accessibilityLabel="Phone"
                editable={!busy}
                keyboardType="phone-pad"
                onChangeText={(value) => patchDraft("phone", value)}
                placeholder="Phone"
                placeholderTextColor={colors.muted}
                style={styles.input}
                value={draft.phone}
              />
              <Text style={styles.sectionLabel}>Mailing address</Text>
              <TextInput
                accessibilityLabel="Address line 1"
                editable={!busy}
                onChangeText={(value) => patchDraft("addressLine1", value)}
                placeholder="Address line 1"
                placeholderTextColor={colors.muted}
                style={styles.input}
                value={draft.addressLine1}
              />
              <TextInput
                accessibilityLabel="Address line 2"
                editable={!busy}
                onChangeText={(value) => patchDraft("addressLine2", value)}
                placeholder="Address line 2"
                placeholderTextColor={colors.muted}
                style={styles.input}
                value={draft.addressLine2}
              />
              <View style={styles.fieldRow}>
                <TextInput
                  accessibilityLabel="City"
                  editable={!busy}
                  onChangeText={(value) => patchDraft("city", value)}
                  placeholder="City"
                  placeholderTextColor={colors.muted}
                  style={[styles.input, styles.fieldHalf]}
                  value={draft.city}
                />
                <TextInput
                  accessibilityLabel="State or region"
                  editable={!busy}
                  onChangeText={(value) => patchDraft("region", value)}
                  placeholder="State / region"
                  placeholderTextColor={colors.muted}
                  style={[styles.input, styles.fieldHalf]}
                  value={draft.region}
                />
              </View>
              <View style={styles.fieldRow}>
                <TextInput
                  accessibilityLabel="Postal code"
                  editable={!busy}
                  onChangeText={(value) => patchDraft("postalCode", value)}
                  placeholder="Postal code"
                  placeholderTextColor={colors.muted}
                  style={[styles.input, styles.fieldHalf]}
                  value={draft.postalCode}
                />
                <TextInput
                  accessibilityLabel="Country"
                  editable={!busy}
                  onChangeText={(value) => patchDraft("country", value)}
                  placeholder="Country"
                  placeholderTextColor={colors.muted}
                  style={[styles.input, styles.fieldHalf]}
                  value={draft.country}
                />
              </View>
              <Text style={styles.fieldLabel}>Author website</Text>
              <TextInput
                accessibilityLabel="Author website"
                autoCapitalize="none"
                editable={!busy}
                onChangeText={(value) => patchDraft("website", value)}
                placeholder="https://"
                placeholderTextColor={colors.muted}
                style={styles.input}
                value={draft.website}
              />
              <Text style={styles.fieldLabel}>Author bio</Text>
              <TextInput
                accessibilityLabel="Author bio"
                editable={!busy}
                multiline
                onChangeText={(value) => patchDraft("bio", value)}
                placeholder="Short bio for submissions"
                placeholderTextColor={colors.muted}
                style={[styles.input, styles.bioInput]}
                value={draft.bio}
              />
              <Text style={styles.sectionLabel}>Representation</Text>
              <TextInput
                accessibilityLabel="Literary agent"
                editable={!busy}
                onChangeText={(value) => patchDraft("agentName", value)}
                placeholder="Literary agent"
                placeholderTextColor={colors.muted}
                style={styles.input}
                value={draft.agentName}
              />
              <TextInput
                accessibilityLabel="Agency"
                editable={!busy}
                onChangeText={(value) => patchDraft("agencyName", value)}
                placeholder="Agency"
                placeholderTextColor={colors.muted}
                style={styles.input}
                value={draft.agencyName}
              />
            </ScrollView>
            <View style={styles.modalActions}>
              <ActionButton
                disabled={busy}
                label="Cancel"
                onPress={() => setProfileOpen(false)}
              />
              <ActionButton
                disabled={busy || !canSaveProfile}
                label={profileSaveState === "saving" ? "Saving…" : "Save profile"}
                onPress={() =>
                  onUpdateProfile({
                    displayName: draft.displayName.trim(),
                    publishing: publishingFromDraft(draft),
                    expectedVersion: profile.version
                  })
                }
                primary
              />
            </View>
          </View>
        </View>
      </Modal>
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
  profileCardHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between"
  },
  pencilButton: {
    alignItems: "center",
    borderColor: colors.line,
    borderRadius: 7,
    borderWidth: 1,
    height: 30,
    justifyContent: "center",
    width: 30
  },
  pencilGlyph: {
    color: colors.kicker,
    fontFamily: fonts.uiSemibold,
    fontSize: 14,
    marginTop: -1
  },
  profileHint: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 10,
    lineHeight: 15
  },
  profileDetail: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 10,
    lineHeight: 15,
    marginTop: 2
  },
  profileStatus: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 8,
    marginTop: 8
  },
  profileStatusError: {
    color: colors.red
  },
  modalRoot: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    padding: 16
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(40, 35, 31, 0.45)"
  },
  modalCard: {
    backgroundColor: colors.paper,
    borderColor: colors.line,
    borderRadius: 12,
    borderWidth: 1,
    maxHeight: "92%",
    maxWidth: 560,
    overflow: "hidden",
    width: "100%",
    zIndex: 2
  },
  modalHeader: {
    alignItems: "flex-start",
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 14
  },
  modalHeadingCopy: {
    flex: 1,
    gap: 4,
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
    fontSize: 10,
    lineHeight: 15
  },
  modalClose: {
    alignItems: "center",
    borderColor: colors.line,
    borderRadius: 7,
    borderWidth: 1,
    height: 30,
    justifyContent: "center",
    width: 30
  },
  modalCloseText: {
    color: colors.ink,
    fontFamily: fonts.uiSemibold,
    fontSize: 18,
    lineHeight: 20
  },
  modalScroll: {
    flexGrow: 0,
    maxHeight: 480
  },
  modalBody: {
    paddingHorizontal: 18,
    paddingVertical: 14
  },
  fieldLabel: {
    color: colors.muted,
    fontFamily: fonts.uiSemibold,
    fontSize: 9,
    letterSpacing: 0.6,
    marginBottom: 4,
    textTransform: "uppercase"
  },
  sectionLabel: {
    color: colors.kicker,
    fontFamily: fonts.uiSemibold,
    fontSize: 9,
    letterSpacing: 1.2,
    marginBottom: 8,
    marginTop: 6,
    textTransform: "uppercase"
  },
  fieldRow: {
    flexDirection: "row",
    gap: 8
  },
  fieldHalf: {
    flex: 1
  },
  bioInput: {
    minHeight: 96,
    textAlignVertical: "top"
  },
  modalActions: {
    borderTopColor: colors.line,
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 8,
    justifyContent: "flex-end",
    paddingHorizontal: 18,
    paddingVertical: 12
  }
});
