import { ghostwriterTheme } from "@ghostwriter/ui";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { AiSetupPanel } from "./AiSetupPanel.js";

const { colors, fonts } = ghostwriterTheme;

export type SettingsPanelProps = Readonly<{
  onClose(): void;
  onConfigured?(): void;
}>;

export function SettingsPanel({ onClose, onConfigured }: SettingsPanelProps) {
  return (
    <View accessibilityLabel="Settings" style={styles.root}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text accessibilityRole="header" style={styles.title}>
            Settings
          </Text>
          <Text style={styles.lede}>
            Account-wide preferences for Ghostwriter. Your OpenAI key is used
            across Capture, Plans, and writing partners.
          </Text>
        </View>
        <Pressable
          accessibilityLabel="Close Settings"
          accessibilityRole="button"
          onPress={onClose}
          style={({ pressed }) => [
            styles.closeButton,
            pressed && styles.closeButtonPressed
          ]}
        >
          <Text style={styles.closeGlyph}>×</Text>
        </Pressable>
      </View>
      <View style={styles.body}>
        <Text style={styles.sectionLabel}>AI collaboration</Text>
        <AiSetupPanel
          onConfigured={onConfigured}
          onDismiss={onClose}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    gap: 20,
    minHeight: 0,
    paddingHorizontal: 28,
    paddingVertical: 24
  },
  header: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 16,
    justifyContent: "space-between"
  },
  headerCopy: {
    flex: 1,
    gap: 8,
    minWidth: 0
  },
  title: {
    color: colors.ink,
    fontFamily: fonts.story,
    fontSize: 32,
    lineHeight: 38
  },
  lede: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 14,
    lineHeight: 21,
    maxWidth: 520
  },
  closeButton: {
    alignItems: "center",
    height: 32,
    justifyContent: "center",
    width: 32
  },
  closeButtonPressed: {
    opacity: 0.65
  },
  closeGlyph: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 28,
    lineHeight: 30
  },
  body: {
    flex: 1,
    gap: 12,
    minHeight: 0
  },
  sectionLabel: {
    color: colors.ink,
    fontFamily: fonts.ui,
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 0.2
  }
});
