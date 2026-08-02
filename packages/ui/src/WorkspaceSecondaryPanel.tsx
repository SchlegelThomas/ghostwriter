import type { ReactNode } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import brandMark from "./GhostwriterMark.png";
import { ghostwriterTheme } from "./theme.js";
import type { WorkspaceSecondaryMode } from "./workspace-shell-layout.js";

const { colors, fonts } = ghostwriterTheme;

export type WorkspaceSecondaryPanelProps = Readonly<{
  mode: WorkspaceSecondaryMode;
  width: number;
  agent: ReactNode;
  inspector: ReactNode;
  inspectorLabel?: string;
  autoSuggestionsEnabled?: boolean;
  onAutoSuggestionsChange?(enabled: boolean): void;
  onCollapse?(): void;
}>;

/** Cursor-like secondary side: Agent chat or inspector / Context Dock (no tab chrome). */
export function WorkspaceSecondaryPanel({
  mode,
  width,
  agent,
  inspector,
  inspectorLabel = "Inspector",
  autoSuggestionsEnabled = false,
  onAutoSuggestionsChange,
  onCollapse
}: WorkspaceSecondaryPanelProps) {
  const headerLabel = mode === "agent" ? "Agent" : inspectorLabel;
  const showAutoSuggestionsToggle =
    mode === "agent" && onAutoSuggestionsChange !== undefined;

  return (
    <View
      accessibilityLabel="Secondary side panel"
      style={[styles.root, { width }]}
    >
      <View style={styles.header}>
        <Text style={styles.headerLabel}>{headerLabel}</Text>
        <View style={styles.headerSpacer} />
        {showAutoSuggestionsToggle ? (
          <Pressable
            accessibilityHint={
              autoSuggestionsEnabled
                ? "After a scene save, Ghostwriter may suggest next steps automatically."
                : "Turn on to allow cheap coach suggestions after a scene save."
            }
            accessibilityLabel={`Auto suggestions ${autoSuggestionsEnabled ? "on" : "off"}`}
            accessibilityRole="switch"
            accessibilityState={{ checked: autoSuggestionsEnabled }}
            onPress={() => onAutoSuggestionsChange(!autoSuggestionsEnabled)}
            style={({ pressed }) => [
              styles.autoSuggestionsToggle,
              autoSuggestionsEnabled
                ? styles.autoSuggestionsToggleOn
                : styles.autoSuggestionsToggleOff,
              pressed && styles.pressed
            ]}
            // Web tooltip
            {...({
              title: autoSuggestionsEnabled
                ? "Auto suggestions — cheap coach may run after save"
                : "Auto suggestions off — use Start after save"
            } as Record<string, string>)}
          >
            <View
              style={[
                styles.autoSuggestionsMarkFrame,
                autoSuggestionsEnabled
                  ? styles.autoSuggestionsMarkFrameOn
                  : styles.autoSuggestionsMarkFrameOff
              ]}
            >
              <Image
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                resizeMode="contain"
                source={brandMark}
                style={[
                  styles.autoSuggestionsMark,
                  autoSuggestionsEnabled
                    ? styles.autoSuggestionsMarkOn
                    : styles.autoSuggestionsMarkOff
                ]}
              />
            </View>
            <Text
              style={[
                styles.autoSuggestionsLabel,
                autoSuggestionsEnabled
                  ? styles.autoSuggestionsLabelOn
                  : styles.autoSuggestionsLabelOff
              ]}
            >
              Auto
            </Text>
          </Pressable>
        ) : null}
        {onCollapse === undefined ? null : (
          <Pressable
            accessibilityLabel="Collapse secondary panel"
            accessibilityRole="button"
            onPress={onCollapse}
            style={({ pressed }) => [styles.collapse, pressed && styles.pressed]}
          >
            <Text style={styles.collapseText}>⟩</Text>
          </Pressable>
        )}
      </View>
      <View style={styles.body}>
        <View style={styles.bodyFill}>
          {mode === "agent" ? agent : inspector}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignSelf: "stretch",
    backgroundColor: colors.paper,
    borderLeftColor: colors.line,
    borderLeftWidth: 1,
    flex: 1,
    flexDirection: "column",
    height: "100%",
    minHeight: 0,
    minWidth: 0,
    overflow: "hidden"
  },
  header: {
    alignItems: "center",
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    flexDirection: "row",
    flexShrink: 0,
    gap: 2,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  headerLabel: {
    color: colors.kicker,
    fontFamily: fonts.uiSemibold,
    fontSize: 11
  },
  autoSuggestionsToggle: {
    alignItems: "center",
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    height: 28,
    justifyContent: "center",
    marginRight: 4,
    paddingLeft: 3,
    paddingRight: 9
  },
  autoSuggestionsToggleOff: {
    backgroundColor: colors.paper,
    borderColor: colors.line
  },
  autoSuggestionsToggleOn: {
    backgroundColor: colors.rail,
    borderColor: colors.rail
  },
  autoSuggestionsMarkFrame: {
    alignItems: "center",
    borderRadius: 999,
    height: 22,
    justifyContent: "center",
    overflow: "hidden",
    width: 22
  },
  autoSuggestionsMarkFrameOff: {
    backgroundColor: "#f4eee6"
  },
  autoSuggestionsMarkFrameOn: {
    backgroundColor: colors.paper
  },
  autoSuggestionsMark: {
    height: 20,
    width: 20
  },
  autoSuggestionsMarkOff: {
    opacity: 0.72
  },
  autoSuggestionsMarkOn: {
    opacity: 1
  },
  autoSuggestionsLabel: {
    fontFamily: fonts.uiSemibold,
    fontSize: 11,
    letterSpacing: 0.2
  },
  autoSuggestionsLabelOff: {
    color: colors.muted
  },
  autoSuggestionsLabelOn: {
    color: colors.railText
  },
  headerSpacer: {
    flex: 1
  },
  collapse: {
    alignItems: "center",
    height: 28,
    justifyContent: "center",
    width: 28
  },
  collapseText: {
    color: colors.muted,
    fontFamily: fonts.uiSemibold,
    fontSize: 14
  },
  body: {
    flex: 1,
    flexDirection: "column",
    minHeight: 0,
    minWidth: 0
  },
  bodyFill: {
    flex: 1,
    minHeight: 0,
    minWidth: 0
  },
  pressed: {
    opacity: 0.85
  }
});
