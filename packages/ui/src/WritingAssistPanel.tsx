import type {
  WritingAssistProposal,
  WritingAssistRole
} from "@ghostwriter/core";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ghostwriterTheme } from "./theme.js";
import { WRITING_ASSIST_ROLES, type WritingAssistRoleId } from "./writing-studio.js";

const { colors, fonts } = ghostwriterTheme;

export type WritingAssistPanelProps = Readonly<{
  busy?: boolean;
  activeRole: WritingAssistRoleId;
  proposals: readonly WritingAssistProposal[];
  statusMessage?: string;
  onRoleChange(role: WritingAssistRoleId): void;
  onGenerate(role: WritingAssistRoleId): void;
  onApply(proposal: WritingAssistProposal): void;
  onDismiss(proposal: WritingAssistProposal): void;
}>;

export function WritingAssistPanel({
  busy = false,
  activeRole,
  proposals,
  statusMessage,
  onRoleChange,
  onGenerate,
  onApply,
  onDismiss
}: WritingAssistPanelProps) {
  return (
    <ScrollView
      accessibilityLabel="Writing Assist"
      contentContainerStyle={styles.body}
    >
      <Text style={styles.eyebrow}>Assist · propose only</Text>
      <Text style={styles.lede}>
        Agents return inspectable proposals. Nothing enters the manuscript or
        craft records until you apply it.
      </Text>
      <View style={styles.roleRow}>
        {WRITING_ASSIST_ROLES.map((role) => (
          <Pressable
            accessibilityLabel={role.label}
            accessibilityRole="button"
            accessibilityState={{ selected: activeRole === role.id, disabled: busy }}
            disabled={busy}
            key={role.id}
            onPress={() => onRoleChange(role.id)}
            style={({ pressed }) => [
              styles.roleChip,
              activeRole === role.id && styles.roleChipSelected,
              pressed && styles.pressed,
              busy && styles.disabled
            ]}
          >
            <Text
              style={[
                styles.roleChipText,
                activeRole === role.id && styles.roleChipTextSelected
              ]}
            >
              {role.label}
            </Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.roleDetail}>
        {WRITING_ASSIST_ROLES.find((role) => role.id === activeRole)?.detail}
      </Text>
      <Pressable
        accessibilityLabel={`Generate ${activeRole} proposals`}
        accessibilityRole="button"
        disabled={busy}
        onPress={() => onGenerate(activeRole)}
        style={({ pressed }) => [
          styles.generateButton,
          pressed && styles.pressed,
          busy && styles.disabled
        ]}
      >
        <Text style={styles.generateButtonText}>
          {busy ? "Generating…" : "Generate proposals"}
        </Text>
      </Pressable>
      {statusMessage === undefined ? null : (
        <Text style={styles.status}>{statusMessage}</Text>
      )}
      {proposals.length === 0 ? (
        <Text style={styles.empty}>
          No proposals yet. Generate to see deterministic local suggestions
          (OpenAI optional later).
        </Text>
      ) : (
        proposals.map((proposal) => (
          <View
            accessibilityLabel={`Proposal ${proposal.title}`}
            key={proposal.id}
            style={styles.card}
          >
            <Text style={styles.cardEyebrow}>
              {(proposal.role as WritingAssistRole).replace("-", " ")} ·{" "}
              {proposal.provider}
            </Text>
            <Text style={styles.cardTitle}>{proposal.title}</Text>
            <Text style={styles.cardSummary}>{proposal.summary}</Text>
            {proposal.prose === undefined ? null : (
              <Text style={styles.cardProse}>{proposal.prose}</Text>
            )}
            {proposal.sketch === undefined ? null : (
              <Text style={styles.cardProse}>
                Purpose: {proposal.sketch.purpose ?? "—"}
                {"\n"}Conflict: {proposal.sketch.conflict ?? "—"}
                {"\n"}Turn: {proposal.sketch.turn ?? "—"}
              </Text>
            )}
            {proposal.characterSheet === undefined ? null : (
              <Text style={styles.cardProse}>
                Desire: {proposal.characterSheet.desire ?? "—"}
                {"\n"}Pressure: {proposal.characterSheet.pressure ?? "—"}
                {"\n"}Voice: {proposal.characterSheet.voiceNotes ?? "—"}
              </Text>
            )}
            {proposal.backdropCaption === undefined ? null : (
              <Text style={styles.cardProse}>{proposal.backdropCaption}</Text>
            )}
            <View style={styles.actions}>
              <Pressable
                accessibilityLabel={`Apply ${proposal.title}`}
                accessibilityRole="button"
                disabled={
                  busy ||
                  (proposal.kind === "character-sheet" &&
                    proposal.characterSheet === undefined)
                }
                onPress={() => onApply(proposal)}
                style={({ pressed }) => [
                  styles.applyButton,
                  pressed && styles.pressed,
                  busy && styles.disabled
                ]}
              >
                <Text style={styles.applyButtonText}>Apply</Text>
              </Pressable>
              <Pressable
                accessibilityLabel={`Dismiss ${proposal.title}`}
                accessibilityRole="button"
                disabled={busy}
                onPress={() => onDismiss(proposal)}
                style={({ pressed }) => [
                  styles.dismissButton,
                  pressed && styles.pressed
                ]}
              >
                <Text style={styles.dismissButtonText}>Dismiss</Text>
              </Pressable>
            </View>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: 8,
    padding: 10,
    paddingBottom: 24
  },
  eyebrow: {
    color: colors.muted,
    fontFamily: fonts.uiSemibold,
    fontSize: 8,
    letterSpacing: 1.2,
    textTransform: "uppercase"
  },
  lede: {
    color: colors.ink,
    fontFamily: fonts.ui,
    fontSize: 12,
    lineHeight: 16
  },
  roleRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4
  },
  roleChip: {
    borderColor: colors.line,
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: colors.panel
  },
  roleChipSelected: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent
  },
  roleChipText: {
    color: colors.ink,
    fontFamily: fonts.uiSemibold,
    fontSize: 9
  },
  roleChipTextSelected: {
    color: colors.accent
  },
  roleDetail: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 11,
    lineHeight: 14
  },
  generateButton: {
    alignSelf: "flex-start",
    backgroundColor: colors.brandDark,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  generateButtonText: {
    color: "#fff",
    fontFamily: fonts.uiSemibold,
    fontSize: 11
  },
  status: {
    color: colors.amber,
    fontFamily: fonts.uiMedium,
    fontSize: 11
  },
  empty: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 12,
    lineHeight: 16
  },
  card: {
    backgroundColor: colors.wash,
    borderColor: colors.line,
    borderRadius: 8,
    borderWidth: 1,
    gap: 6,
    padding: 10
  },
  cardEyebrow: {
    color: colors.muted,
    fontFamily: fonts.uiSemibold,
    fontSize: 8,
    letterSpacing: 0.8,
    textTransform: "uppercase"
  },
  cardTitle: {
    color: colors.ink,
    fontFamily: fonts.uiSemibold,
    fontSize: 13
  },
  cardSummary: {
    color: colors.ink,
    fontFamily: fonts.ui,
    fontSize: 12,
    lineHeight: 16
  },
  cardProse: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 6,
    borderWidth: 1,
    color: colors.ink,
    fontFamily: fonts.story,
    fontSize: 14,
    lineHeight: 20,
    padding: 8
  },
  actions: {
    flexDirection: "row",
    gap: 6
  },
  applyButton: {
    backgroundColor: colors.brandDark,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 7
  },
  applyButtonText: {
    color: "#fff",
    fontFamily: fonts.uiSemibold,
    fontSize: 10
  },
  dismissButton: {
    borderColor: colors.line,
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: colors.panel
  },
  dismissButtonText: {
    color: colors.ink,
    fontFamily: fonts.uiSemibold,
    fontSize: 10
  },
  pressed: {
    opacity: 0.72
  },
  disabled: {
    opacity: 0.42
  }
});
