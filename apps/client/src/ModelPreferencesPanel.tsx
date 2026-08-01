import {
  MODEL_CATALOG,
  PROVIDER_IDS,
  type ModelCatalogEntry,
  type ProviderId
} from "@ghostwriter/core";
import {
  filterModelsByPreferences,
  ghostwriterTheme,
  isModelEnabled,
  modelTaskKindLabel,
  providerDisplayLabel,
  readModelPreferences,
  toggleModelEnabled,
  withEnabledModelIds,
  writeModelPreferences,
  type ModelPreferences,
  type ModelTaskKind,
  type WorkspaceAvailableModel
} from "@ghostwriter/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import {
  getAvailableModels,
  type AvailableModelCatalogEntry
} from "./api.js";

const { colors, fonts } = ghostwriterTheme;

export type ModelPreferencesPanelProps = Readonly<{
  accountId?: string;
  providerStatusSignal?: number;
  onPreferencesChanged?(): void;
  section?: "models" | "defaults" | "all";
  hideTitle?: boolean;
  fillHeight?: boolean;
}>;

type ProviderFilter = "all" | ProviderId;

const TASK_DEFAULT_KINDS: readonly ModelTaskKind[] = Object.freeze([
  "chat",
  "plan",
  "agent",
  "image",
  "captureReflection",
  "scenePartner"
]);

function toCatalogEntry(entry: AvailableModelCatalogEntry): ModelCatalogEntry {
  return Object.freeze({
    id: entry.id,
    provider: entry.provider as ProviderId,
    label: entry.label,
    supportsChat: entry.supportsChat,
    supportsTools: entry.supportsTools,
    supportsStructured: entry.supportsStructured,
    supportsImage: entry.supportsImage,
    ...(entry.defaultEffort === undefined ? {} : { defaultEffort: entry.defaultEffort }),
    ...(entry.notes === undefined ? {} : { notes: entry.notes }),
    ...(entry.bestFor === undefined ? {} : { bestFor: entry.bestFor }),
    ...(entry.relativeStrength === undefined
      ? {}
      : { relativeStrength: entry.relativeStrength }),
    adapterReady: entry.adapterReady
  });
}

/**
 * Primary list = live available-models (discovered + curated merge).
 * Locked curated highlights remain for providers without keys.
 */
function catalogRowsForSettings(
  available: readonly AvailableModelCatalogEntry[]
): readonly Readonly<{ entry: ModelCatalogEntry; unlocked: boolean }>[] {
  const unlockedIds = new Set(available.map((entry) => entry.id));
  const rows: { entry: ModelCatalogEntry; unlocked: boolean }[] = available.map(
    (entry) =>
      Object.freeze({
        entry: toCatalogEntry(entry),
        unlocked: true
      })
  );
  for (const curated of MODEL_CATALOG) {
    if (!curated.adapterReady || unlockedIds.has(curated.id)) continue;
    rows.push(
      Object.freeze({
        entry: curated,
        unlocked: false
      })
    );
  }
  rows.sort((a, b) => {
    if (a.unlocked !== b.unlocked) return a.unlocked ? -1 : 1;
    return a.entry.label.localeCompare(b.entry.label);
  });
  return Object.freeze(rows);
}

function enabledIdSet(prefs: ModelPreferences): Set<string> | "all" {
  return prefs.enabledModelIds === "all" ? "all" : new Set(prefs.enabledModelIds);
}

function taskEligibleModels(
  task: ModelTaskKind,
  available: readonly WorkspaceAvailableModel[],
  prefs: ModelPreferences
): readonly WorkspaceAvailableModel[] {
  const enabled = filterModelsByPreferences(available, prefs);
  return enabled.filter((entry) => {
    switch (task) {
      case "image":
        return entry.supportsImage;
      case "agent":
        return entry.supportsChat && entry.supportsTools;
      case "captureReflection":
      case "scenePartner":
        return entry.supportsStructured || entry.supportsChat;
      default:
        return entry.supportsChat;
    }
  });
}

function TaskModelDropdown({
  task,
  prefs,
  options,
  onChange
}: Readonly<{
  task: ModelTaskKind;
  prefs: ModelPreferences;
  options: readonly WorkspaceAvailableModel[];
  onChange(next: ModelPreferences): void;
}>) {
  const [open, setOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const selectedId = prefs.taskModels[task];
  const selected =
    selectedId !== undefined
      ? options.find((entry) => entry.id === selectedId)
      : undefined;
  const taskLabel = modelTaskKindLabel(task);

  const filteredOptions = useMemo(() => {
    const normalized = pickerQuery.trim().toLowerCase();
    if (normalized.length === 0) return options;
    return options.filter((entry) => {
      const haystack = [
        entry.label,
        entry.id,
        providerDisplayLabel(entry.provider)
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalized);
    });
  }, [options, pickerQuery]);

  function closePicker(): void {
    setOpen(false);
    setPickerQuery("");
  }

  return (
    <View style={styles.taskRow}>
      <Text style={styles.taskLabel}>{taskLabel}</Text>
      <Pressable
        accessibilityLabel={`Default model for ${taskLabel}`}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        disabled={options.length === 0}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          styles.taskTrigger,
          pressed && styles.pressed,
          options.length === 0 && styles.taskTriggerDisabled
        ]}
      >
        <Text numberOfLines={1} style={styles.taskTriggerText}>
          {selected !== undefined
            ? `${selected.label} · ${providerDisplayLabel(selected.provider)}`
            : options.length === 0
              ? "No enabled models"
              : "Use workspace default"}
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
          accessibilityLabel={`Choose default for ${taskLabel}`}
          accessibilityViewIsModal
          style={styles.taskPickerRoot}
          {...({ "aria-modal": true } as object)}
        >
          <Pressable
            accessibilityLabel="Dismiss model picker"
            accessibilityRole="button"
            onPress={closePicker}
            style={styles.taskPickerBackdrop}
          />
          <View style={styles.taskPickerCard}>
            <View style={styles.taskPickerHeader}>
              <Text style={styles.taskPickerTitle}>{taskLabel}</Text>
              <Pressable
                accessibilityLabel="Close model picker"
                accessibilityRole="button"
                onPress={closePicker}
                style={({ pressed }) => [
                  styles.taskPickerClose,
                  pressed && styles.pressed
                ]}
              >
                <Text style={styles.taskPickerCloseText}>×</Text>
              </Pressable>
            </View>
            <TextInput
              accessibilityLabel={`Search models for ${taskLabel}`}
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setPickerQuery}
              placeholder="Search models…"
              placeholderTextColor={colors.muted}
              style={styles.taskPickerSearch}
              value={pickerQuery}
            />
            <ScrollView
              keyboardShouldPersistTaps="handled"
              style={styles.taskPickerList}
            >
              <Pressable
                accessibilityRole="menuitem"
                accessibilityState={{ selected: selectedId === undefined }}
                onPress={() => {
                  const { [task]: _removed, ...rest } = prefs.taskModels;
                  onChange(
                    Object.freeze({
                      ...prefs,
                      taskModels: Object.freeze(rest)
                    })
                  );
                  closePicker();
                }}
                style={({ pressed }) => [
                  styles.taskMenuItem,
                  selectedId === undefined && styles.taskMenuItemSelected,
                  pressed && styles.pressed
                ]}
              >
                <Text
                  style={[
                    styles.taskMenuItemText,
                    selectedId === undefined && styles.taskMenuItemTextSelected
                  ]}
                >
                  Use workspace default
                </Text>
              </Pressable>
              {filteredOptions.length === 0 ? (
                <Text style={styles.taskPickerEmpty}>
                  No enabled models match this search.
                </Text>
              ) : (
                filteredOptions.map((entry) => {
                  const isSelected = entry.id === selectedId;
                  return (
                    <Pressable
                      accessibilityRole="menuitem"
                      accessibilityState={{ selected: isSelected }}
                      key={entry.id}
                      onPress={() => {
                        onChange(
                          Object.freeze({
                            ...prefs,
                            taskModels: Object.freeze({
                              ...prefs.taskModels,
                              [task]: entry.id
                            })
                          })
                        );
                        closePicker();
                      }}
                      style={({ pressed }) => [
                        styles.taskMenuItem,
                        isSelected && styles.taskMenuItemSelected,
                        pressed && styles.pressed
                      ]}
                    >
                      <Text
                        style={[
                          styles.taskMenuItemText,
                          isSelected && styles.taskMenuItemTextSelected
                        ]}
                      >
                        {entry.label} ·{" "}
                        {providerDisplayLabel(entry.provider)}
                      </Text>
                    </Pressable>
                  );
                })
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

export function ModelPreferencesPanel({
  accountId,
  providerStatusSignal = 0,
  onPreferencesChanged,
  section = "all",
  hideTitle = false,
  fillHeight = false
}: ModelPreferencesPanelProps) {
  const [prefs, setPrefs] = useState(() => readModelPreferences(accountId));
  const [available, setAvailable] = useState<
    readonly AvailableModelCatalogEntry[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [providerFilter, setProviderFilter] = useState<ProviderFilter>("all");

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const response = await getAvailableModels();
      setAvailable(response.models);
    } catch {
      // Keep prior list when refresh fails.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setPrefs(readModelPreferences(accountId));
    void refresh();
  }, [accountId, providerStatusSignal, refresh]);

  const catalogRows = useMemo(
    () => catalogRowsForSettings(available),
    [available]
  );

  const unlockedCatalogIds = useMemo(
    () =>
      Object.freeze(
        catalogRows.filter((row) => row.unlocked).map((row) => row.entry.id)
      ),
    [catalogRows]
  );

  const filteredRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return catalogRows.filter((row) => {
      if (
        providerFilter !== "all" &&
        row.entry.provider !== providerFilter
      ) {
        return false;
      }
      if (normalizedQuery.length === 0) return true;
      const haystack = [
        row.entry.label,
        row.entry.id,
        providerDisplayLabel(row.entry.provider)
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [catalogRows, providerFilter, query]);

  const availableForTasks = useMemo(
    (): readonly WorkspaceAvailableModel[] =>
      Object.freeze(
        available.map((entry) =>
          Object.freeze({
            id: entry.id,
            provider: entry.provider,
            label: entry.label,
            supportsChat: entry.supportsChat,
            supportsTools: entry.supportsTools,
            supportsStructured: entry.supportsStructured,
            supportsImage: entry.supportsImage,
            adapterReady: entry.adapterReady
          })
        )
      ),
    [available]
  );

  function persist(next: ModelPreferences): void {
    writeModelPreferences(next, accountId);
    setPrefs(next);
    onPreferencesChanged?.();
  }

  function selectAllFiltered(enabled: boolean): void {
    const filteredUnlocked = filteredRows
      .filter((row) => row.unlocked)
      .map((row) => row.entry.id);
    if (filteredUnlocked.length === 0) return;

    if (enabled) {
      const current = enabledIdSet(prefs);
      if (current === "all") return;
      const merged = new Set([...current, ...filteredUnlocked]);
      if (merged.size === unlockedCatalogIds.length) {
        persist(withEnabledModelIds(prefs, "all"));
        return;
      }
      persist(withEnabledModelIds(prefs, [...merged]));
      return;
    }

    let next = prefs;
    for (const id of filteredUnlocked) {
      next = toggleModelEnabled(next, id, false, unlockedCatalogIds);
    }
    persist(next);
  }

  const showModels = section === "all" || section === "models";
  const showDefaults = section === "all" || section === "defaults";

  return (
    <View style={[styles.panel, fillHeight && styles.panelFill]}>
      {!hideTitle ? <Text style={styles.sectionTitle}>Models</Text> : null}
      {section === "all" ? (
        <Text style={styles.lede}>
          Choose which unlocked models appear in workspace pickers and set defaults
          for common tasks. Preferences stay on this device for now.
        </Text>
      ) : section === "models" ? (
        <Text style={styles.lede}>
          Choose which unlocked models appear in workspace pickers. Preferences
          stay on this device for now.
        </Text>
      ) : (
        <Text style={styles.lede}>
          Set default models for common tasks. Each default must stay enabled in
          the Models tab.
        </Text>
      )}

      {showModels ? (
        <>
      <Text style={styles.subsectionLabel}>Enabled models</Text>
      <Text style={styles.hint}>
        Toggle models on to show them in the Agent panel picker. Off models stay
        hidden until you turn them back on.
      </Text>
      <View style={styles.searchRow}>
        <TextInput
          accessibilityLabel="Search catalog models"
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setQuery}
          placeholder="Search models…"
          placeholderTextColor={colors.muted}
          style={styles.searchInput}
          value={query}
        />
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipScroll}
      >
        <View style={styles.chipRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: providerFilter === "all" }}
            onPress={() => setProviderFilter("all")}
            style={({ pressed }) => [
              styles.chip,
              providerFilter === "all" && styles.chipSelected,
              pressed && styles.pressed
            ]}
          >
            <Text
              style={[
                styles.chipText,
                providerFilter === "all" && styles.chipTextSelected
              ]}
            >
              All
            </Text>
          </Pressable>
          {PROVIDER_IDS.map((providerId) => (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: providerFilter === providerId }}
              key={providerId}
              onPress={() => setProviderFilter(providerId)}
              style={({ pressed }) => [
                styles.chip,
                providerFilter === providerId && styles.chipSelected,
                pressed && styles.pressed
              ]}
            >
              <Text
                style={[
                  styles.chipText,
                  providerFilter === providerId && styles.chipTextSelected
                ]}
              >
                {providerDisplayLabel(providerId)}
              </Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
      <View style={styles.bulkRow}>
        <Pressable
          accessibilityRole="button"
          onPress={() => selectAllFiltered(true)}
          style={({ pressed }) => [styles.bulkAction, pressed && styles.pressed]}
        >
          <Text style={styles.bulkActionText}>Select all in filter</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => selectAllFiltered(false)}
          style={({ pressed }) => [styles.bulkAction, pressed && styles.pressed]}
        >
          <Text style={styles.bulkActionText}>Select none in filter</Text>
        </Pressable>
      </View>

      {loading ? (
        <Text style={styles.hint}>Loading models…</Text>
      ) : (
        <ScrollView
          nestedScrollEnabled
          style={[
            styles.catalogListScroll,
            fillHeight && styles.catalogListScrollFill
          ]}
        >
          <View style={styles.catalogList}>
            {filteredRows.length === 0 ? (
              <Text style={[styles.hint, styles.catalogPadding]}>
                No models match this filter.
              </Text>
            ) : (
              filteredRows.map(({ entry, unlocked }) => {
              const enabled = unlocked && isModelEnabled(prefs, entry.id);
              return (
                <Pressable
                  accessibilityLabel={`${enabled ? "Disable" : "Enable"} ${entry.label}`}
                  accessibilityRole="switch"
                  accessibilityState={{
                    checked: enabled,
                    disabled: !unlocked
                  }}
                  disabled={!unlocked}
                  key={entry.id}
                  onPress={() => {
                    persist(
                      toggleModelEnabled(
                        prefs,
                        entry.id,
                        !enabled,
                        unlockedCatalogIds
                      )
                    );
                  }}
                  style={({ pressed }) => [
                    styles.catalogRow,
                    !unlocked && styles.catalogRowDisabled,
                    pressed && unlocked && styles.pressed
                  ]}
                >
                  <View style={styles.catalogCopy}>
                    <Text style={styles.catalogLabel}>{entry.label}</Text>
                    <Text style={styles.catalogMeta}>
                      {providerDisplayLabel(entry.provider)}
                      {!unlocked
                        ? section === "models"
                          ? ` · Add ${providerDisplayLabel(entry.provider)} key in Providers`
                          : ` · Add ${providerDisplayLabel(entry.provider)} key above`
                        : ""}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.toggleTrack,
                      enabled && styles.toggleTrackOn,
                      !unlocked && styles.toggleTrackDisabled
                    ]}
                  >
                    <View style={styles.toggleThumb} />
                  </View>
                </Pressable>
              );
            })
          )}
          </View>
        </ScrollView>
      )}
        </>
      ) : null}

      {showDefaults ? (
        <>
      <Text
        style={[
          styles.subsectionLabel,
          showModels && styles.subsectionSpaced
        ]}
      >
        Task defaults
      </Text>
      {section !== "defaults" ? (
        <Text style={styles.hint}>
          Defaults apply when you switch modes or open image generation. They must
          stay enabled above.
        </Text>
      ) : (
        <Text style={styles.hint}>
          Defaults apply when you switch modes or open image generation. They must
          stay enabled in the Models tab.
        </Text>
      )}
      <ScrollView
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled
        style={fillHeight ? styles.taskListScrollFill : undefined}
      >
      <View style={styles.taskList}>
        {TASK_DEFAULT_KINDS.map((task) => (
          <TaskModelDropdown
            key={task}
            onChange={persist}
            options={taskEligibleModels(task, availableForTasks, prefs)}
            prefs={prefs}
            task={task}
          />
        ))}
      </View>
      </ScrollView>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    gap: 10
  },
  panelFill: {
    flex: 1,
    minHeight: 0
  },
  sectionTitle: {
    color: colors.ink,
    fontFamily: fonts.uiSemibold,
    fontSize: 16,
    lineHeight: 22
  },
  lede: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 13,
    lineHeight: 19,
    maxWidth: 560
  },
  subsectionLabel: {
    color: colors.ink,
    fontFamily: fonts.uiMedium,
    fontSize: 13,
    letterSpacing: 0.2,
    marginTop: 4
  },
  subsectionSpaced: {
    marginTop: 16
  },
  searchRow: {
    marginTop: 4
  },
  searchInput: {
    borderColor: colors.line,
    borderRadius: 6,
    borderWidth: 1,
    color: colors.ink,
    fontFamily: fonts.ui,
    fontSize: 13,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  chipScroll: {
    flexGrow: 0
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "nowrap",
    gap: 6,
    paddingVertical: 4
  },
  chip: {
    borderColor: colors.line,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5
  },
  chipSelected: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.kicker
  },
  chipText: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 12
  },
  chipTextSelected: {
    color: colors.ink,
    fontFamily: fonts.uiMedium
  },
  bulkRow: {
    flexDirection: "row",
    gap: 12
  },
  bulkAction: {
    paddingVertical: 2
  },
  bulkActionText: {
    color: colors.kicker,
    fontFamily: fonts.uiMedium,
    fontSize: 12
  },
  catalogListScroll: {
    maxHeight: 280
  },
  catalogListScrollFill: {
    flex: 1,
    maxHeight: undefined,
    minHeight: 0
  },
  catalogList: {
    borderColor: colors.line,
    borderRadius: 8,
    borderWidth: 1,
    gap: 0,
    overflow: "hidden"
  },
  catalogPadding: {
    paddingHorizontal: 12,
    paddingVertical: 12
  },
  catalogRow: {
    alignItems: "center",
    borderBottomColor: colors.line,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 11
  },
  catalogRowDisabled: {
    opacity: 0.55
  },
  toggleTrack: {
    alignItems: "center",
    backgroundColor: colors.line,
    borderRadius: 999,
    flexDirection: "row",
    height: 22,
    justifyContent: "flex-start",
    paddingHorizontal: 2,
    width: 40
  },
  toggleTrackOn: {
    backgroundColor: colors.green,
    justifyContent: "flex-end"
  },
  toggleTrackDisabled: {
    opacity: 0.7
  },
  toggleThumb: {
    backgroundColor: colors.panel,
    borderRadius: 999,
    height: 18,
    width: 18
  },
  catalogCopy: {
    flex: 1,
    gap: 2,
    minWidth: 0
  },
  catalogLabel: {
    color: colors.ink,
    fontFamily: fonts.ui,
    fontSize: 13,
    lineHeight: 18
  },
  catalogMeta: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 11,
    lineHeight: 15
  },
  hint: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 12,
    lineHeight: 17
  },
  taskList: {
    gap: 10
  },
  taskListScrollFill: {
    flex: 1,
    minHeight: 0
  },
  taskRow: {
    gap: 6
  },
  taskLabel: {
    color: colors.ink,
    fontFamily: fonts.uiMedium,
    fontSize: 12
  },
  taskTrigger: {
    alignItems: "center",
    borderColor: colors.line,
    borderRadius: 6,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between",
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  taskTriggerDisabled: {
    opacity: 0.55
  },
  taskTriggerText: {
    color: colors.ink,
    flex: 1,
    fontFamily: fonts.ui,
    fontSize: 13,
    minWidth: 0
  },
  caret: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 11
  },
  taskPickerRoot: {
    flex: 1,
    justifyContent: "center",
    minHeight: 0,
    padding: 24
  },
  taskPickerBackdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(18, 16, 14, 0.42)"
  },
  taskPickerCard: {
    alignSelf: "center",
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 12,
    borderWidth: 1,
    gap: 10,
    maxHeight: "80%",
    maxWidth: 520,
    minHeight: 280,
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
  taskPickerHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between"
  },
  taskPickerTitle: {
    color: colors.ink,
    fontFamily: fonts.uiSemibold,
    fontSize: 15
  },
  taskPickerClose: {
    alignItems: "center",
    height: 28,
    justifyContent: "center",
    width: 28
  },
  taskPickerCloseText: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 22,
    lineHeight: 24
  },
  taskPickerSearch: {
    borderColor: colors.line,
    borderRadius: 6,
    borderWidth: 1,
    color: colors.ink,
    fontFamily: fonts.ui,
    fontSize: 13,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  taskPickerList: {
    flexGrow: 0,
    maxHeight: 360
  },
  taskPickerEmpty: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 12,
    lineHeight: 17,
    paddingHorizontal: 10,
    paddingVertical: 16
  },
  taskMenuItem: {
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 10
  },
  taskMenuItemSelected: {
    backgroundColor: colors.accentSoft
  },
  taskMenuItemText: {
    color: colors.ink,
    fontFamily: fonts.ui,
    fontSize: 13
  },
  taskMenuItemTextSelected: {
    fontFamily: fonts.uiSemibold
  },
  pressed: {
    opacity: 0.88
  }
});
