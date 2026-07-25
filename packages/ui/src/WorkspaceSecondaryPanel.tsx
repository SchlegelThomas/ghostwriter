import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { ghostwriterTheme } from "./theme.js";
import type { WorkspaceSecondaryTab } from "./workspace-shell-layout.js";

const { colors, fonts } = ghostwriterTheme;

export type WorkspaceSecondaryPanelProps = Readonly<{
  tab: WorkspaceSecondaryTab;
  onTabChange(tab: WorkspaceSecondaryTab): void;
  width: number;
  agent: ReactNode;
  properties: ReactNode;
  onCollapse?(): void;
}>;

function TabButton({
  label,
  selected,
  onPress
}: Readonly<{
  label: string;
  selected: boolean;
  onPress(): void;
}>) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tab,
        selected && styles.tabSelected,
        pressed && styles.pressed
      ]}
    >
      <Text style={[styles.tabLabel, selected && styles.tabLabelSelected]}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Cursor-like secondary side: Agent (MCP chat) | Properties. */
export function WorkspaceSecondaryPanel({
  tab,
  onTabChange,
  width,
  agent,
  properties,
  onCollapse
}: WorkspaceSecondaryPanelProps) {
  return (
    <View
      accessibilityLabel="Secondary side panel"
      style={[styles.root, { width }]}
    >
      <View accessibilityRole="tablist" style={styles.tabs}>
        <TabButton
          label="Agent"
          onPress={() => onTabChange("agent")}
          selected={tab === "agent"}
        />
        <TabButton
          label="Properties"
          onPress={() => onTabChange("properties")}
          selected={tab === "properties"}
        />
        <View style={styles.tabSpacer} />
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
          {tab === "agent" ? agent : properties}
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
  tabs: {
    alignItems: "center",
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    flexDirection: "row",
    flexShrink: 0,
    gap: 2,
    paddingHorizontal: 6,
    paddingVertical: 6
  },
  tab: {
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6
  },
  tabSelected: {
    backgroundColor: colors.accentSoft
  },
  tabLabel: {
    color: colors.muted,
    fontFamily: fonts.uiSemibold,
    fontSize: 11
  },
  tabLabelSelected: {
    color: colors.kicker
  },
  tabSpacer: {
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
