import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  entityDraftAccessibilityLabel,
  entityDraftCardSummary,
  entityDraftCardTitle,
  entityDraftKindLabel,
  entityDraftPartnerLabel,
  entityDraftPrimaryAction,
  entityDraftPrimaryActionLabel,
  formatEntityDraftCreatedAt,
  type EntityDraftSummary
} from "./entity-draft-model.js";
import { ghostwriterTheme } from "./theme.js";

const { colors, fonts } = ghostwriterTheme;

export type EntityDraftsPanelProps = Readonly<{
  drafts: readonly EntityDraftSummary[];
  loading?: boolean;
  busy?: boolean;
  mutatingProposalId?: string;
  expandedDraftId?: string;
  expandedBody?: string;
  expandedLoading?: boolean;
  /** @deprecated Prefer structured preview fields on each draft summary. */
  detailTitles?: Readonly<Record<string, string>>;
  onReject?(proposalId: string): void;
  onAcknowledge?(proposalId: string): void;
  onSelect?(proposalId: string): void;
  onRefresh?(): void;
}>;

function PanelButton({
  label,
  onPress,
  disabled = false,
  primary = false,
  danger = false
}: Readonly<{
  label: string;
  onPress(): void;
  disabled?: boolean;
  primary?: boolean;
  danger?: boolean;
}>) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        primary && styles.buttonPrimary,
        danger && styles.buttonDanger,
        pressed && styles.pressed,
        disabled && styles.disabled
      ]}
    >
      <Text
        style={[
          styles.buttonText,
          primary && styles.buttonTextPrimary,
          danger && styles.buttonTextDanger
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function EntityDraftsPanel({
  drafts,
  loading = false,
  busy = false,
  mutatingProposalId,
  expandedDraftId,
  expandedBody,
  expandedLoading = false,
  detailTitles = {},
  onReject,
  onAcknowledge,
  onSelect,
  onRefresh
}: EntityDraftsPanelProps) {
  const controlsDisabled = busy || mutatingProposalId !== undefined;

  return (
    <View accessibilityLabel="Entity drafts" style={styles.section}>
      <View style={styles.sectionHeading}>
        <Text style={styles.sectionTitle}>Drafts</Text>
        {onRefresh === undefined ? null : (
          <PanelButton
            disabled={controlsDisabled || loading}
            label="Refresh"
            onPress={onRefresh}
          />
        )}
      </View>
      {loading ? (
        <Text accessibilityLiveRegion="polite" style={styles.help}>
          Loading drafts…
        </Text>
      ) : drafts.length === 0 ? (
        <Text style={styles.help}>
          No drafts yet — agent recommendations will appear here.
        </Text>
      ) : (
        drafts.map((draft) => {
          const primaryAction = entityDraftPrimaryAction(draft);
          const rowBusy = mutatingProposalId === draft.id;
          const rowDisabled = controlsDisabled || rowBusy;
          const expanded = expandedDraftId === draft.id;
          const partnerLabel = entityDraftPartnerLabel(draft);
          const cardTitle = entityDraftCardTitle(draft, detailTitles[draft.id]);
          const cardSummary = entityDraftCardSummary(draft);
          const kindLabel = entityDraftKindLabel(draft.outputSchemaId);
          const hasExplicitTitle =
            (draft.preview?.title?.trim().length ?? 0) > 0 ||
            (detailTitles[draft.id]?.trim().length ?? 0) > 0;
          const showTitleLine = hasExplicitTitle || partnerLabel === undefined;
          const cardContent = (
            <>
              <View style={styles.draftHeader}>
                <Text style={styles.draftKind}>{kindLabel.toUpperCase()}</Text>
                <Text style={styles.draftMeta}>
                  {formatEntityDraftCreatedAt(draft.createdAt)}
                </Text>
              </View>
              {partnerLabel === undefined ? null : (
                <Text numberOfLines={1} style={styles.draftPartner}>
                  {partnerLabel}
                </Text>
              )}
              {showTitleLine ? (
                <Text numberOfLines={2} style={styles.draftTitle}>
                  {cardTitle}
                </Text>
              ) : null}
              {cardSummary === undefined ? null : (
                <Text numberOfLines={3} style={styles.draftSummary}>
                  {cardSummary}
                </Text>
              )}
              <View style={styles.actionRow}>
                {primaryAction === "acknowledge" && onAcknowledge !== undefined ? (
                  <PanelButton
                    disabled={rowDisabled}
                    label={
                      rowBusy ? "Working…" : entityDraftPrimaryActionLabel(primaryAction)
                    }
                    onPress={() => onAcknowledge(draft.id)}
                    primary
                  />
                ) : onSelect !== undefined ? (
                  <PanelButton
                    disabled={rowDisabled}
                    label={
                      rowBusy ? "Working…" : entityDraftPrimaryActionLabel(primaryAction)
                    }
                    onPress={() => onSelect(draft.id)}
                    primary={primaryAction !== "view"}
                  />
                ) : null}
                {onReject === undefined ? null : (
                  <PanelButton
                    danger
                    disabled={rowDisabled}
                    label="Reject"
                    onPress={() => onReject(draft.id)}
                  />
                )}
              </View>
              {expanded ? (
                expandedLoading ? (
                  <Text accessibilityLiveRegion="polite" style={styles.help}>
                    Loading draft detail…
                  </Text>
                ) : expandedBody === undefined || expandedBody.length === 0 ? null : (
                  <Text style={styles.draftBody}>{expandedBody}</Text>
                )
              ) : null}
            </>
          );

          if (onSelect === undefined) {
            return (
              <View key={draft.id} style={styles.draftCard}>
                {cardContent}
              </View>
            );
          }

          return (
            <Pressable
              key={draft.id}
              accessibilityLabel={entityDraftAccessibilityLabel(draft)}
              accessibilityRole="button"
              disabled={rowDisabled}
              onPress={() => onSelect(draft.id)}
              style={({ pressed }) => [
                styles.draftCard,
                expanded && styles.draftCardExpanded,
                pressed && styles.pressed
              ]}
            >
              {cardContent}
            </Pressable>
          );
        })
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    padding: 12
  },
  sectionHeading: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between",
    marginBottom: 9
  },
  sectionTitle: {
    color: colors.ink,
    fontFamily: fonts.uiSemibold,
    fontSize: 10
  },
  help: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 9,
    lineHeight: 14
  },
  draftCard: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 7,
    borderWidth: 1,
    gap: 4,
    marginBottom: 7,
    padding: 8
  },
  draftCardExpanded: {
    borderColor: colors.brandDark
  },
  draftHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between"
  },
  draftKind: {
    color: colors.muted,
    fontFamily: fonts.uiSemibold,
    fontSize: 7,
    letterSpacing: 0.6
  },
  draftPartner: {
    color: colors.ink,
    fontFamily: fonts.uiSemibold,
    fontSize: 9,
    lineHeight: 13
  },
  draftTitle: {
    color: colors.ink,
    fontFamily: fonts.uiSemibold,
    fontSize: 9,
    lineHeight: 13
  },
  draftSummary: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 8,
    lineHeight: 12
  },
  draftMeta: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 8
  },
  draftBody: {
    color: colors.ink,
    fontFamily: fonts.ui,
    fontSize: 9,
    lineHeight: 14,
    marginTop: 4
  },
  actionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 5,
    marginTop: 4,
    minWidth: 0
  },
  button: {
    alignItems: "center",
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 6,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 33,
    paddingHorizontal: 8,
    paddingVertical: 6
  },
  buttonPrimary: {
    backgroundColor: colors.brandDark,
    borderColor: colors.brandDark
  },
  buttonDanger: {
    backgroundColor: colors.redSoft,
    borderColor: colors.red
  },
  buttonText: {
    color: colors.ink,
    fontFamily: fonts.uiSemibold,
    fontSize: 8
  },
  buttonTextPrimary: {
    color: "#ffffff"
  },
  buttonTextDanger: {
    color: colors.red
  },
  pressed: {
    opacity: 0.72
  },
  disabled: {
    opacity: 0.42
  }
});
