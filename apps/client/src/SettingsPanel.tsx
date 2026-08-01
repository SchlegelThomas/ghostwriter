import {
  ghostwriterTheme,
  type SettingsFocus
} from "@ghostwriter/ui";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { AiSetupPanel } from "./AiSetupPanel.js";
import { ModelPreferencesPanel } from "./ModelPreferencesPanel.js";
import { CatalogPlaybooksPanel } from "./CatalogPlaybooksPanel.js";

const { colors, fonts } = ghostwriterTheme;

const SETTINGS_TABS: readonly Readonly<{
  id: SettingsFocus;
  label: string;
}>[] = Object.freeze([
  Object.freeze({ id: "providers", label: "Providers" }),
  Object.freeze({ id: "models", label: "Models" }),
  Object.freeze({ id: "defaults", label: "Defaults" }),
  Object.freeze({ id: "playbooks", label: "Playbooks" })
]);

export type SettingsPanelProps = Readonly<{
  onClose(): void;
  onConfigured?(): void;
  accountId?: string;
  projectId?: string;
  providerStatusSignal?: number;
  onPreferencesChanged?(): void;
  activeTab?: SettingsFocus;
  onTabChange?(tab: SettingsFocus): void;
}>;

export function SettingsPanel({
  onClose,
  onConfigured,
  accountId,
  projectId,
  providerStatusSignal = 0,
  onPreferencesChanged,
  activeTab: controlledTab,
  onTabChange
}: SettingsPanelProps) {
  const [internalTab, setInternalTab] = useState<SettingsFocus>("providers");
  const activeTab = controlledTab ?? internalTab;

  function selectTab(tab: SettingsFocus): void {
    onTabChange?.(tab);
    if (controlledTab === undefined) {
      setInternalTab(tab);
    }
  }

  return (
    <View accessibilityLabel="Settings" style={styles.root}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text accessibilityRole="header" style={styles.title}>
            Settings
          </Text>
          <Text style={styles.lede}>
            Account-wide preferences for Ghostwriter. Add API keys for the model
            providers you use — they apply across Capture, Plans, and writing
            partners.
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

      <View
        accessibilityRole="tablist"
        style={styles.tabBar}
      >
        {SETTINGS_TABS.map((tab) => {
          const selected = activeTab === tab.id;
          return (
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              key={tab.id}
              onPress={() => selectTab(tab.id)}
              style={({ pressed }) => [
                styles.tabChip,
                selected && styles.tabChipSelected,
                pressed && styles.tabChipPressed
              ]}
            >
              <Text
                style={[
                  styles.tabChipText,
                  selected && styles.tabChipTextSelected
                ]}
              >
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.tabBody}>
        {activeTab === "providers" ? (
          <View
            accessibilityLabel="Providers settings"
            style={styles.tabPanelFill}
          >
            <AiSetupPanel
              onConfigured={onConfigured}
              onDismiss={onClose}
              settingsTab
            />
          </View>
        ) : null}
        {activeTab === "models" ? (
          <View
            accessibilityLabel="Models settings"
            style={styles.tabPanelFill}
          >
            <ModelPreferencesPanel
              accountId={accountId}
              fillHeight
              hideTitle
              onPreferencesChanged={onPreferencesChanged}
              providerStatusSignal={providerStatusSignal}
              section="models"
            />
          </View>
        ) : null}
        {activeTab === "defaults" ? (
          <View
            accessibilityLabel="Task defaults settings"
            style={styles.tabPanelFill}
          >
            <ModelPreferencesPanel
              accountId={accountId}
              fillHeight
              hideTitle
              onPreferencesChanged={onPreferencesChanged}
              providerStatusSignal={providerStatusSignal}
              section="defaults"
            />
          </View>
        ) : null}
        {activeTab === "playbooks" ? (
          <View
            accessibilityLabel="Catalog playbooks settings"
            style={styles.tabPanelFill}
          >
            <CatalogPlaybooksPanel projectId={projectId} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    gap: 16,
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
  tabBar: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  tabChip: {
    borderColor: colors.line,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 7
  },
  tabChipSelected: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.kicker
  },
  tabChipPressed: {
    opacity: 0.88
  },
  tabChipText: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 13
  },
  tabChipTextSelected: {
    color: colors.ink,
    fontFamily: fonts.uiMedium
  },
  tabBody: {
    flex: 1,
    minHeight: 0
  },
  tabPanelFill: {
    flex: 1,
    minHeight: 0
  }
});
