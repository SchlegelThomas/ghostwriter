import { useState, type ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { ghostwriterTheme } from "./theme.js";
import type { OpenSettingsHandler } from "./settings-focus.js";
import type { WorkspaceImageModelPickerOption } from "./workspace-agent-prefs.js";

const { colors, fonts } = ghostwriterTheme;

export function ImageModelPicker({
  label = "Image model",
  options,
  value,
  disabled = false,
  onChange
}: Readonly<{
  label?: string;
  options: readonly WorkspaceImageModelPickerOption[];
  value: string;
  disabled?: boolean;
  onChange(next: string): void;
}>): ReactElement | null {
  const [open, setOpen] = useState(false);
  if (options.length === 0) {
    return null;
  }
  const selected =
    options.find((entry) => entry.value === value) ?? options[0]!;

  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.dropdown}>
        <Pressable
          accessibilityLabel={label}
          accessibilityRole="button"
          accessibilityState={{ expanded: open, disabled }}
          disabled={disabled}
          onPress={() => setOpen((current) => !current)}
          style={({ pressed }) => [
            styles.trigger,
            pressed && styles.pressed,
            disabled && styles.disabled
          ]}
        >
          <Text numberOfLines={1} style={styles.triggerText}>
            {selected.label}
          </Text>
          <Text style={styles.caret}>{open ? "▴" : "▾"}</Text>
        </Pressable>
        {open ? (
          <View accessibilityRole="menu" style={styles.menu}>
            {options.map((option) => {
              const isSelected = option.value === selected.value;
              return (
                <Pressable
                  accessibilityRole="menuitem"
                  accessibilityState={{ selected: isSelected }}
                  key={option.value}
                  onPress={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  style={({ pressed }) => [
                    styles.item,
                    isSelected && styles.itemSelected,
                    pressed && styles.pressed
                  ]}
                >
                  <Text
                    style={[
                      styles.itemText,
                      isSelected && styles.itemTextSelected
                    ]}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}
      </View>
    </View>
  );
}

export function ImageGenerationUnavailable({
  onOpenSettings
}: Readonly<{
  onOpenSettings?: OpenSettingsHandler;
}>): ReactElement {
  return (
    <View style={styles.unavailableBlock}>
      <Text style={styles.unavailableHint}>
        Add an OpenAI key in Settings to generate images with your account.
      </Text>
      {onOpenSettings === undefined ? null : (
        <Pressable
          accessibilityRole="button"
          onPress={() => onOpenSettings("providers")}
          style={({ pressed }) => [styles.settingsButton, pressed && styles.pressed]}
        >
          <Text style={styles.settingsButtonText}>Open Settings</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: 6
  },
  fieldLabel: {
    color: colors.muted,
    fontFamily: fonts.uiMedium,
    fontSize: 11,
    letterSpacing: 0.4,
    textTransform: "uppercase"
  },
  dropdown: {
    position: "relative",
    zIndex: 4
  },
  trigger: {
    alignItems: "center",
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 6,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  triggerText: {
    color: colors.ink,
    flex: 1,
    fontFamily: fonts.uiMedium,
    fontSize: 12
  },
  caret: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 10
  },
  menu: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 6,
    borderWidth: 1,
    marginTop: 4,
    maxWidth: "100%",
    minWidth: "100%",
    overflow: "hidden",
    position: "absolute",
    top: "100%",
    zIndex: 10
  },
  item: {
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  itemSelected: {
    backgroundColor: colors.accentSoft
  },
  itemText: {
    color: colors.ink,
    fontFamily: fonts.ui,
    fontSize: 12
  },
  itemTextSelected: {
    color: colors.kicker,
    fontFamily: fonts.uiSemibold
  },
  unavailableBlock: {
    gap: 8
  },
  unavailableHint: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 12,
    lineHeight: 18
  },
  settingsButton: {
    alignSelf: "flex-start",
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 7
  },
  settingsButtonText: {
    color: colors.kicker,
    fontFamily: fonts.uiMedium,
    fontSize: 12
  },
  pressed: {
    opacity: 0.85
  },
  disabled: {
    opacity: 0.5
  }
});
