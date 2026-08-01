import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { ghostwriterTheme } from "./theme.js";
import type { WorkspaceSecondaryMode } from "./workspace-shell-layout.js";

const { colors, fonts } = ghostwriterTheme;

export type WorkspaceSecondaryPanelProps = Readonly<{
  mode: WorkspaceSecondaryMode;
  width: number;
  agent: ReactNode;
  inspector: ReactNode;
  inspectorLabel?: string;
  onCollapse?(): void;
}>;

/** Cursor-like secondary side: Agent chat or inspector / Context Dock (no tab chrome). */
export function WorkspaceSecondaryPanel({
  mode,
  width,
  agent,
  inspector,
  inspectorLabel = "Inspector",
  onCollapse
}: WorkspaceSecondaryPanelProps) {
  const headerLabel = mode === "agent" ? "Agent" : inspectorLabel;

  return (
    <View
      accessibilityLabel="Secondary side panel"
      style={[styles.root, { width }]}
    >
      <View style={styles.header}>
        <Text style={styles.headerLabel}>{headerLabel}</Text>
        <View style={styles.headerSpacer} />
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
