import { useState, type ReactElement } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View
} from "react-native";
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

  function closePicker(): void {
    setOpen(false);
  }

  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Pressable
        accessibilityLabel={label}
        accessibilityRole="button"
        accessibilityState={{ expanded: open, disabled }}
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          styles.trigger,
          pressed && styles.pressed,
          disabled && styles.disabled
        ]}
      >
        <Text numberOfLines={1} style={styles.triggerText}>
          {selected.label}
        </Text>
        <Text style={styles.caret}>▾</Text>
      </Pressable>

      <Modal
        animationType="fade"
        onRequestClose={closePicker}
        transparent
        visible={open}
      >
        <View
          accessibilityLabel={`Choose ${label.toLowerCase()}`}
          accessibilityViewIsModal
          style={styles.pickerRoot}
          {...({ "aria-modal": true } as object)}
        >
          <Pressable
            accessibilityLabel="Dismiss image model picker"
            accessibilityRole="button"
            onPress={closePicker}
            style={styles.pickerBackdrop}
          />
          <View style={styles.pickerCard}>
            <View style={styles.pickerHeader}>
              <Text style={styles.pickerTitle}>{label}</Text>
              <Pressable
                accessibilityLabel="Close image model picker"
                accessibilityRole="button"
                onPress={closePicker}
                style={({ pressed }) => [
                  styles.pickerClose,
                  pressed && styles.pressed
                ]}
              >
                <Text style={styles.pickerCloseText}>×</Text>
              </Pressable>
            </View>
            <ScrollView
              accessibilityRole="menu"
              keyboardShouldPersistTaps="handled"
              style={styles.pickerList}
            >
              {options.map((option) => {
                const isSelected = option.value === selected.value;
                return (
                  <Pressable
                    accessibilityRole="menuitem"
                    accessibilityState={{ selected: isSelected }}
                    key={option.value}
                    onPress={() => {
                      onChange(option.value);
                      closePicker();
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
            </ScrollView>
          </View>
        </View>
      </Modal>
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
  pickerRoot: {
    flex: 1,
    justifyContent: "center",
    minHeight: 0,
    padding: 24
  },
  pickerBackdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(18, 16, 14, 0.42)"
  },
  pickerCard: {
    alignSelf: "center",
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 12,
    borderWidth: 1,
    gap: 10,
    maxHeight: "80%",
    maxWidth: 520,
    minHeight: 200,
    overflow: "hidden",
    paddingBottom: 8,
    paddingHorizontal: 14,
    paddingTop: 12,
    width: "100%",
    zIndex: 2,
    ...({
      boxShadow: "0 18px 44px rgba(28, 22, 16, 0.22)"
    } as object)
  },
  pickerHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between"
  },
  pickerTitle: {
    color: colors.ink,
    fontFamily: fonts.uiSemibold,
    fontSize: 15
  },
  pickerClose: {
    alignItems: "center",
    height: 28,
    justifyContent: "center",
    width: 28
  },
  pickerCloseText: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 22,
    lineHeight: 24
  },
  pickerList: {
    flexGrow: 0,
    maxHeight: 360
  },
  item: {
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 10
  },
  itemSelected: {
    backgroundColor: colors.accentSoft
  },
  itemText: {
    color: colors.ink,
    fontFamily: fonts.ui,
    fontSize: 13
  },
  itemTextSelected: {
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
