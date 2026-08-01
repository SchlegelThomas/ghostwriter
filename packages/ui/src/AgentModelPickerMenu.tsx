import { useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { Check } from "phosphor-react-native";
import type { AgentModelId } from "@ghostwriter/core";
import { ghostwriterTheme } from "./theme.js";
import type { OpenSettingsHandler } from "./settings-focus.js";
import {
  filterWorkspaceAgentModelPickerOptionsByQuery,
  providerDisplayLabel,
  WORKSPACE_AGENT_EFFORTS,
  workspaceAgentEffortLabel,
  type WorkspaceAgentEffort,
  type WorkspaceAgentModelPickerOption
} from "./workspace-agent-prefs.js";

const { colors, fonts } = ghostwriterTheme;

const MENU_BODY_HEIGHT = 280;
const DETAIL_PANE_WIDTH = 180;
const isWeb = typeof document !== "undefined";

export type AgentModelPickerMenuProps = Readonly<{
  effort: WorkspaceAgentEffort;
  options: readonly WorkspaceAgentModelPickerOption[];
  selectedValue: AgentModelId;
  onApplyModelEffort(value: AgentModelId, effort: WorkspaceAgentEffort): void;
  onSelect(value: AgentModelId): void;
  onDismiss?(): void;
  onOpenSettings?: OpenSettingsHandler;
}>;

export function AgentModelPickerMenu({
  effort,
  onApplyModelEffort,
  onDismiss,
  onOpenSettings,
  onSelect,
  options,
  selectedValue
}: AgentModelPickerMenuProps) {
  const [query, setQuery] = useState("");
  const [hoveredValue, setHoveredValue] = useState<AgentModelId | null>(null);
  const [editingValue, setEditingValue] = useState<AgentModelId | null>(null);

  const filtered = useMemo(
    () => filterWorkspaceAgentModelPickerOptionsByQuery(options, query),
    [options, query]
  );

  const targetModelId = hoveredValue ?? editingValue ?? selectedValue;
  const targetOption = useMemo(
    () => options.find((option) => option.value === targetModelId),
    [options, targetModelId]
  );
  const showEffortSection =
    targetModelId === editingValue || targetModelId === selectedValue;

  return (
    <View
      accessibilityRole="menu"
      style={[styles.menu, isWeb ? styles.menuFloatingWeb : styles.menuDocked]}
    >
      <View style={styles.searchRow}>
        <TextInput
          accessibilityLabel="Search models"
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setQuery}
          placeholder="Search models…"
          placeholderTextColor={colors.muted}
          style={styles.searchInput}
          value={query}
        />
        {onDismiss !== undefined ? (
          <Pressable
            accessibilityLabel="Close model menu"
            accessibilityRole="button"
            onPress={onDismiss}
            style={({ pressed }) => [styles.dismiss, pressed && styles.pressed]}
          >
            <Text style={styles.dismissText}>Done</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={styles.body}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
          style={styles.scroll}
        >
          {filtered.length === 0 ? (
            <Text style={styles.empty}>No models match your search.</Text>
          ) : (
            filtered.map((option) => {
              const selected = option.value === selectedValue;
              const editing = option.value === editingValue;
              const hovered = option.value === hoveredValue;
              const showEdit = hovered || selected || editing;
              const hoverIn = (): void => setHoveredValue(option.value);
              const hoverOut = (): void =>
                setHoveredValue((current) =>
                  current === option.value ? null : current
                );
              return (
                <View
                  key={option.value}
                  style={[
                    styles.row,
                    selected && styles.rowSelected,
                    hovered && styles.rowHover
                  ]}
                >
                  <Pressable
                    accessibilityHint={[
                      `Provider ${providerDisplayLabel(option.provider)}`,
                      option.bestFor,
                      option.relativeStrength
                    ]
                      .filter((part) => part !== undefined && part.length > 0)
                      .join(". ")}
                    accessibilityRole="menuitem"
                    accessibilityState={{ selected }}
                    onHoverIn={hoverIn}
                    onHoverOut={hoverOut}
                    onPress={() => onSelect(option.value)}
                    style={({ pressed }) => [
                      styles.rowMain,
                      pressed && styles.pressed
                    ]}
                  >
                    <Text
                      numberOfLines={2}
                      style={[
                        styles.rowLabel,
                        selected && styles.rowLabelSelected
                      ]}
                    >
                      {option.label}
                    </Text>
                  </Pressable>
                  {showEdit ? (
                    <Pressable
                      accessibilityLabel={`Effort for ${option.label}`}
                      accessibilityRole="button"
                      onHoverIn={hoverIn}
                      onHoverOut={hoverOut}
                      onPress={() => setEditingValue(option.value)}
                      style={({ pressed }) => [
                        styles.editButton,
                        editing && styles.editButtonActive,
                        pressed && styles.pressed
                      ]}
                    >
                      <Text style={styles.editButtonText}>Edit</Text>
                    </Pressable>
                  ) : (
                    <View style={styles.editSpacer} />
                  )}
                  {selected ? (
                    <Check color={colors.kicker} size={14} weight="bold" />
                  ) : (
                    <View style={styles.checkSpacer} />
                  )}
                </View>
              );
            })
          )}
        </ScrollView>
        <View accessibilityLiveRegion="polite" style={styles.detailPane}>
          {targetOption !== undefined ? (
            <ScrollView nestedScrollEnabled style={styles.detailScroll}>
              <Text style={styles.detailTitle}>{targetOption.label}</Text>
              <Text style={styles.detailMeta}>
                Provider · {providerDisplayLabel(targetOption.provider)}
              </Text>
              {showEffortSection ? (
                <View style={styles.detailBlock}>
                  <Text style={styles.detailLabel}>Effort</Text>
                  {WORKSPACE_AGENT_EFFORTS.map((nextEffort) => {
                    const effortSelected = effort === nextEffort;
                    return (
                      <Pressable
                        accessibilityRole="menuitem"
                        accessibilityState={{ selected: effortSelected }}
                        key={nextEffort}
                        onPress={() =>
                          onApplyModelEffort(targetOption.value, nextEffort)
                        }
                        style={({ pressed }) => [
                          styles.effortRow,
                          effortSelected && styles.effortRowSelected,
                          pressed && styles.pressed
                        ]}
                      >
                        <Text
                          style={[
                            styles.effortRowLabel,
                            effortSelected && styles.effortRowLabelSelected
                          ]}
                        >
                          {workspaceAgentEffortLabel(nextEffort)}
                        </Text>
                        {effortSelected ? (
                          <Check color={colors.kicker} size={12} weight="bold" />
                        ) : (
                          <View style={styles.effortCheckSpacer} />
                        )}
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}
              {targetOption.bestFor !== undefined &&
              targetOption.bestFor.length > 0 ? (
                <View style={styles.detailBlock}>
                  <Text style={styles.detailLabel}>Best for</Text>
                  <Text style={styles.detailBody}>{targetOption.bestFor}</Text>
                </View>
              ) : null}
              {targetOption.relativeStrength !== undefined &&
              targetOption.relativeStrength.length > 0 ? (
                <View style={styles.detailBlock}>
                  <Text style={styles.detailLabel}>Compared with others</Text>
                  <Text style={styles.detailBody}>
                    {targetOption.relativeStrength}
                  </Text>
                </View>
              ) : null}
            </ScrollView>
          ) : (
            <View style={styles.detailIdle}>
              <Text style={styles.detailIdleText}>
                Hover a model for provider, strengths, and how it compares.
              </Text>
            </View>
          )}
        </View>
      </View>
      {onOpenSettings !== undefined ? (
        <Pressable
          accessibilityLabel="Manage models in Settings"
          accessibilityRole="button"
          onPress={() => onOpenSettings("models")}
          style={({ pressed }) => [styles.settingsLink, pressed && styles.pressed]}
        >
          <Text style={styles.settingsLinkText}>Manage models in Settings…</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  menu: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 10,
    borderWidth: 1,
    overflow: "hidden",
    zIndex: 200
  },
  /** Escape overflow:hidden ancestors and float over the workspace. */
  menuFloatingWeb: {
    bottom: 72,
    left: "auto",
    maxWidth: 520,
    right: 16,
    width: "min(520px, calc(100vw - 32px))" as unknown as number,
    ...({
      position: "fixed",
      boxShadow: "0 18px 44px rgba(28, 22, 16, 0.22)"
    } as object)
  },
  /** Native / non-web fallback: grow above the composer inside the panel. */
  menuDocked: {
    bottom: "100%",
    left: 0,
    marginBottom: 6,
    minWidth: 320,
    position: "absolute",
    right: 0
  },
  searchRow: {
    alignItems: "center",
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  searchInput: {
    color: colors.ink,
    flex: 1,
    fontFamily: fonts.ui,
    fontSize: 12,
    minWidth: 0,
    paddingVertical: 4
  },
  dismiss: {
    paddingHorizontal: 4,
    paddingVertical: 2
  },
  dismissText: {
    color: colors.kicker,
    fontFamily: fonts.uiMedium,
    fontSize: 12
  },
  body: {
    flexDirection: "row",
    height: MENU_BODY_HEIGHT
  },
  scroll: {
    flex: 1,
    height: MENU_BODY_HEIGHT,
    minWidth: 0
  },
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    minWidth: 0,
    paddingHorizontal: 14
  },
  /** The label area selects the model; Edit stays a sibling so it can't be swallowed. */
  rowMain: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 9
  },
  rowSelected: {
    backgroundColor: colors.accentSoft
  },
  rowHover: {
    backgroundColor: colors.paper
  },
  rowLabel: {
    color: colors.ink,
    flex: 1,
    fontFamily: fonts.ui,
    fontSize: 12,
    minWidth: 0
  },
  rowLabelSelected: {
    fontFamily: fonts.uiSemibold
  },
  editButton: {
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 3
  },
  editButtonActive: {
    backgroundColor: colors.accentSoft
  },
  editButtonText: {
    color: colors.kicker,
    fontFamily: fonts.uiMedium,
    fontSize: 10
  },
  editSpacer: {
    width: 36
  },
  checkSpacer: {
    height: 14,
    width: 14
  },
  empty: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 12,
    lineHeight: 18,
    paddingHorizontal: 14,
    paddingVertical: 16
  },
  detailPane: {
    borderLeftColor: colors.line,
    borderLeftWidth: 1,
    flexShrink: 0,
    height: MENU_BODY_HEIGHT,
    paddingHorizontal: 12,
    paddingVertical: 12,
    width: DETAIL_PANE_WIDTH
  },
  detailScroll: {
    flex: 1
  },
  detailIdle: {
    flex: 1,
    justifyContent: "center"
  },
  detailIdleText: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 11,
    lineHeight: 16
  },
  detailTitle: {
    color: colors.ink,
    fontFamily: fonts.uiSemibold,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 4
  },
  detailMeta: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 11,
    lineHeight: 15,
    marginBottom: 10
  },
  detailBlock: {
    gap: 3,
    marginBottom: 10
  },
  detailLabel: {
    color: colors.kicker,
    fontFamily: fonts.uiMedium,
    fontSize: 10,
    letterSpacing: 0.3,
    textTransform: "uppercase"
  },
  detailBody: {
    color: colors.ink,
    fontFamily: fonts.ui,
    fontSize: 11,
    lineHeight: 15
  },
  effortRow: {
    alignItems: "center",
    borderRadius: 6,
    flexDirection: "row",
    gap: 6,
    marginBottom: 2,
    paddingHorizontal: 6,
    paddingVertical: 5
  },
  effortRowSelected: {
    backgroundColor: colors.accentSoft
  },
  effortRowLabel: {
    color: colors.ink,
    flex: 1,
    fontFamily: fonts.ui,
    fontSize: 11
  },
  effortRowLabelSelected: {
    fontFamily: fonts.uiSemibold
  },
  effortCheckSpacer: {
    height: 12,
    width: 12
  },
  pressed: {
    opacity: 0.88
  },
  settingsLink: {
    borderTopColor: colors.line,
    borderTopWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  settingsLinkText: {
    color: colors.kicker,
    fontFamily: fonts.uiMedium,
    fontSize: 12
  }
});
