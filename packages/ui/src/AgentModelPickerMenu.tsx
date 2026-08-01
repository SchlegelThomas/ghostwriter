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
  type WorkspaceAgentModelPickerOption
} from "./workspace-agent-prefs.js";

const { colors, fonts } = ghostwriterTheme;

const MENU_BODY_HEIGHT = 280;
const DETAIL_PANE_WIDTH = 180;
const isWeb = typeof document !== "undefined";

export type AgentModelPickerMenuProps = Readonly<{
  options: readonly WorkspaceAgentModelPickerOption[];
  selectedValue: AgentModelId;
  onSelect(value: AgentModelId): void;
  onDismiss?(): void;
  onOpenSettings?: OpenSettingsHandler;
}>;

export function AgentModelPickerMenu({
  options,
  selectedValue,
  onSelect,
  onDismiss,
  onOpenSettings
}: AgentModelPickerMenuProps) {
  const [query, setQuery] = useState("");
  const [hoveredValue, setHoveredValue] = useState<AgentModelId | null>(null);

  const filtered = useMemo(
    () => filterWorkspaceAgentModelPickerOptionsByQuery(options, query),
    [options, query]
  );

  const hovered = useMemo(
    () =>
      hoveredValue === null
        ? undefined
        : filtered.find((option) => option.value === hoveredValue),
    [filtered, hoveredValue]
  );

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
              return (
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
                  key={option.value}
                  onHoverIn={() => setHoveredValue(option.value)}
                  onHoverOut={() =>
                    setHoveredValue((current) =>
                      current === option.value ? null : current
                    )
                  }
                  onPress={() => onSelect(option.value)}
                  style={({ pressed }) => [
                    styles.row,
                    selected && styles.rowSelected,
                    hoveredValue === option.value && styles.rowHover,
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
                  {selected ? (
                    <Check color={colors.kicker} size={14} weight="bold" />
                  ) : (
                    <View style={styles.checkSpacer} />
                  )}
                </Pressable>
              );
            })
          )}
        </ScrollView>
        <View
          accessibilityLiveRegion="polite"
          style={styles.detailPane}
        >
          {hovered !== undefined ? (
            <ScrollView
              nestedScrollEnabled
              style={styles.detailScroll}
            >
              <Text style={styles.detailTitle}>{hovered.label}</Text>
              <Text style={styles.detailMeta}>
                Provider · {providerDisplayLabel(hovered.provider)}
              </Text>
              {hovered.bestFor !== undefined && hovered.bestFor.length > 0 ? (
                <View style={styles.detailBlock}>
                  <Text style={styles.detailLabel}>Best for</Text>
                  <Text style={styles.detailBody}>{hovered.bestFor}</Text>
                </View>
              ) : null}
              {hovered.relativeStrength !== undefined &&
              hovered.relativeStrength.length > 0 ? (
                <View style={styles.detailBlock}>
                  <Text style={styles.detailLabel}>Compared with others</Text>
                  <Text style={styles.detailBody}>
                    {hovered.relativeStrength}
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
    gap: 8,
    minWidth: 0,
    paddingHorizontal: 14,
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
