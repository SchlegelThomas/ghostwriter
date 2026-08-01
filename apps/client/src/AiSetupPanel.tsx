import {
  MODEL_CATALOG,
  PROVIDER_IDS,
  type ProviderId
} from "@ghostwriter/core";
import { ghostwriterTheme, providerDisplayLabel } from "@ghostwriter/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import {
  deleteProviderCredential,
  getAvailableModels,
  GhostwriterApiError,
  listAccountProviderCredentials,
  setProviderCredential,
  skipAiCollaborationSetup,
  validateProviderCredential,
  type AvailableModelCatalogEntry
} from "./api.js";

const { colors, fonts } = ghostwriterTheme;

export type AiSetupPanelProps = Readonly<{
  compact?: boolean;
  onConfigured?(): void;
  onDismiss?(): void;
  /** When hosted in Settings Providers tab — hide skip/close footer actions. */
  settingsTab?: boolean;
}>;

type ProviderListEntry =
  | Readonly<{ provider: string; configured: false }>
  | Readonly<{
      provider: string;
      configured: true;
      version: number;
      maskedHint: string;
      validationState: string;
      createdAt: string;
      updatedAt: string;
      validatedAt?: string;
    }>;

type ProviderRowState = Readonly<{
  apiKey: string;
  busy: boolean;
  message?: string;
}>;

function SetupButton({
  label,
  onPress,
  disabled = false
}: Readonly<{
  label: string;
  onPress(): void;
  disabled?: boolean;
}>) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        pressed && styles.buttonPressed,
        disabled && styles.buttonDisabled
      ]}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

function validationStatusLabel(
  validationState: string | undefined,
  configured: boolean
): string {
  if (!configured) {
    return "Not configured";
  }
  switch (validationState) {
    case "valid":
      return "Valid";
    case "invalid":
      return "Invalid";
    case "unvalidated":
      return "Needs check";
    case "revoked":
      return "Revoked";
    default:
      return "Needs check";
  }
}

function validationStatusTone(
  validationState: string | undefined,
  configured: boolean
): "muted" | "ok" | "warn" | "bad" {
  if (!configured) return "muted";
  switch (validationState) {
    case "valid":
      return "ok";
    case "invalid":
    case "revoked":
      return "bad";
    case "unvalidated":
      return "warn";
    default:
      return "warn";
  }
}

function configuredStatus(
  providers: readonly ProviderListEntry[],
  providerId: ProviderId
): ProviderListEntry | undefined {
  return providers.find((entry) => entry.provider === providerId);
}

function configuredEnvelope(
  entry: ProviderListEntry | undefined
): Extract<ProviderListEntry, { configured: true }> | undefined {
  if (entry?.configured !== true) return undefined;
  return entry;
}

function chatModelsForProvider(
  models: readonly AvailableModelCatalogEntry[],
  providerId: ProviderId
): readonly AvailableModelCatalogEntry[] {
  return models.filter(
    (entry) =>
      entry.provider === providerId &&
      entry.supportsChat &&
      entry.adapterReady !== false
  );
}

function ProviderCard({
  providerId,
  entry,
  row,
  callsDisabled,
  unlockedModels,
  onSave,
  onValidate,
  onRemove,
  onApiKeyChange
}: Readonly<{
  providerId: ProviderId;
  entry: ProviderListEntry | undefined;
  row: ProviderRowState | undefined;
  callsDisabled: boolean;
  unlockedModels: readonly AvailableModelCatalogEntry[];
  onSave(): void;
  onValidate(): void;
  onRemove(): void;
  onApiKeyChange(text: string): void;
}>) {
  const busy = row?.busy === true;
  const apiKey = row?.apiKey ?? "";
  const configured = entry?.configured === true;
  const validationState = configured ? entry.validationState : undefined;
  const tone = validationStatusTone(validationState, configured);

  return (
    <View style={styles.providerCard}>
      <View style={styles.providerHeader}>
        <Text style={styles.providerTitle}>
          {providerDisplayLabel(providerId)}
        </Text>
        <Text
          style={[
            styles.validationBadge,
            tone === "ok" && styles.validationOk,
            tone === "warn" && styles.validationWarn,
            tone === "bad" && styles.validationBad,
            tone === "muted" && styles.validationMuted
          ]}
        >
          {validationStatusLabel(validationState, configured)}
        </Text>
      </View>
      {configured ? (
        <Text style={styles.maskedHint}>{entry.maskedHint}</Text>
      ) : null}
      {unlockedModels.length > 0 ? (
        <Text style={styles.modelChipEmpty}>
          {unlockedModels.length} chat model
          {unlockedModels.length === 1 ? "" : "s"} unlocked — toggle which ones
          appear in pickers in the Models tab.
        </Text>
      ) : configured ? (
        <Text style={styles.modelChipEmpty}>
          No chat models unlocked yet — validate the key if needed.
        </Text>
      ) : null}
      <TextInput
        accessibilityLabel={`${providerDisplayLabel(providerId)} API key`}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!busy && !callsDisabled}
        onChangeText={onApiKeyChange}
        placeholder={`Paste ${providerDisplayLabel(providerId)} API key`}
        placeholderTextColor={colors.muted}
        secureTextEntry
        style={styles.input}
        value={apiKey}
      />
      <View style={styles.actions}>
        <SetupButton
          disabled={busy || callsDisabled || apiKey.trim().length < 20}
          label="Save"
          onPress={onSave}
        />
        <SetupButton
          disabled={busy || callsDisabled || !configured}
          label="Validate"
          onPress={onValidate}
        />
        <SetupButton
          disabled={busy || callsDisabled || !configured}
          label="Remove"
          onPress={onRemove}
        />
      </View>
      {row?.message !== undefined ? (
        <Text accessibilityRole="alert" style={styles.rowMessage}>
          {row.message}
        </Text>
      ) : null}
    </View>
  );
}

export function AiSetupPanel({
  compact = false,
  onConfigured,
  onDismiss,
  settingsTab = false
}: AiSetupPanelProps) {
  const [callsDisabled, setCallsDisabled] = useState(false);
  const [providers, setProviders] = useState<readonly ProviderListEntry[]>(
    []
  );
  const [availableModels, setAvailableModels] = useState<
    readonly AvailableModelCatalogEntry[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [panelMessage, setPanelMessage] = useState<string>();
  const [addProvidersOpen, setAddProvidersOpen] = useState(true);
  const [rowState, setRowState] = useState<
    Partial<Record<ProviderId, ProviderRowState>>
  >({});

  const refreshAvailableModels = useCallback(async (): Promise<void> => {
    try {
      const response = await getAvailableModels();
      setAvailableModels(response.models);
      setCallsDisabled(response.callsDisabled);
    } catch {
      // Keep last known models; provider list still drives setup.
    }
  }, []);

  async function refreshProviders(): Promise<
    readonly ProviderListEntry[]
  > {
    const response = await listAccountProviderCredentials();
    setCallsDisabled(response.callsDisabled);
    setProviders(response.providers);
    setLoading(false);
    await refreshAvailableModels();
    return response.providers;
  }

  useEffect(() => {
    void refreshProviders().catch((error: unknown) => {
      setLoading(false);
      setPanelMessage(
        error instanceof GhostwriterApiError
          ? error.message
          : "Ghostwriter could not load provider settings."
      );
    });
  }, []);

  function updateRow(
    providerId: ProviderId,
    patch: Partial<ProviderRowState>
  ): void {
    setRowState((current) => ({
      ...current,
      [providerId]: {
        apiKey: current[providerId]?.apiKey ?? "",
        busy: current[providerId]?.busy ?? false,
        message: current[providerId]?.message,
        ...patch
      }
    }));
  }

  async function saveKey(providerId: ProviderId): Promise<void> {
    const row = rowState[providerId];
    const apiKey = row?.apiKey.trim() ?? "";
    if (apiKey.length < 20) return;
    const entry = configuredEnvelope(configuredStatus(providers, providerId));
    updateRow(providerId, { busy: true, message: undefined });
    setPanelMessage(undefined);
    try {
      const saved = await setProviderCredential(providerId, {
        apiKey,
        ...(entry === undefined ? {} : { expectedVersion: entry.version })
      });
      await refreshProviders();
      updateRow(providerId, {
        busy: false,
        apiKey: "",
        message: saved.configured
          ? `${providerDisplayLabel(providerId)} key saved.`
          : "Key saved, but Ghostwriter could not confirm it."
      });
      if (saved.configured) onConfigured?.();
    } catch (error) {
      updateRow(providerId, {
        busy: false,
        message:
          error instanceof GhostwriterApiError
            ? error.message
            : "Ghostwriter could not save that key."
      });
    }
  }

  async function validateKey(providerId: ProviderId): Promise<void> {
    const entry = configuredEnvelope(configuredStatus(providers, providerId));
    if (entry === undefined) return;
    updateRow(providerId, { busy: true, message: undefined });
    try {
      const validated = await validateProviderCredential(providerId, {
        expectedVersion: entry.version
      });
      await refreshProviders();
      updateRow(providerId, {
        busy: false,
        message:
          validated.configured && validated.validationState === "valid"
            ? `${providerDisplayLabel(providerId)} key verified.`
            : "Validation failed. Check the key and try again."
      });
      if (
        validated.configured &&
        validated.validationState === "valid"
      ) {
        onConfigured?.();
      }
    } catch (error) {
      updateRow(providerId, {
        busy: false,
        message:
          error instanceof GhostwriterApiError
            ? error.message
            : "Ghostwriter could not validate that key."
      });
    }
  }

  async function removeKey(providerId: ProviderId): Promise<void> {
    const entry = configuredEnvelope(configuredStatus(providers, providerId));
    if (entry === undefined) return;
    updateRow(providerId, { busy: true, message: undefined });
    try {
      await deleteProviderCredential(providerId, {
        expectedVersion: entry.version
      });
      await refreshProviders();
      updateRow(providerId, {
        busy: false,
        apiKey: "",
        message: `${providerDisplayLabel(providerId)} key removed.`
      });
      onConfigured?.();
    } catch (error) {
      updateRow(providerId, {
        busy: false,
        message:
          error instanceof GhostwriterApiError
            ? error.message
            : "Ghostwriter could not remove that key."
      });
    }
  }

  async function skipSetup(): Promise<void> {
    setPanelMessage(undefined);
    try {
      await skipAiCollaborationSetup();
      setPanelMessage(
        "Collaboration setup skipped. You can add provider keys later in Settings."
      );
      onDismiss?.();
    } catch (error) {
      setPanelMessage(
        error instanceof GhostwriterApiError
          ? error.message
          : "Ghostwriter could not skip collaboration setup."
      );
    }
  }

  const configuredProviderIds = useMemo(
    () =>
      PROVIDER_IDS.filter(
        (providerId) =>
          configuredStatus(providers, providerId)?.configured === true
      ),
    [providers]
  );

  const unconfiguredProviderIds = useMemo(
    () =>
      PROVIDER_IDS.filter(
        (providerId) =>
          configuredStatus(providers, providerId)?.configured !== true
      ),
    [providers]
  );

  const chatModelCount = useMemo(
    () =>
      availableModels.filter(
        (entry) => entry.supportsChat && entry.adapterReady !== false
      ).length,
    [availableModels]
  );

  const unlockedIds = useMemo(
    () => new Set(availableModels.map((entry) => entry.id)),
    [availableModels]
  );

  const lockedChatModels = useMemo(
    () =>
      MODEL_CATALOG.filter(
        (entry) =>
          entry.supportsChat &&
          entry.adapterReady !== false &&
          !unlockedIds.has(entry.id)
      ),
    [unlockedIds]
  );

  const anyConfigured = configuredProviderIds.length > 0;

  return (
    <View style={[styles.panel, compact && styles.panelCompact]}>
      {!settingsTab ? <Text style={styles.title}>AI setup</Text> : null}
      <Text style={styles.copy}>
        Add a provider API key to unlock its models in the Agent dock. Capture
        still works without keys; writing agents need at least one provider.
      </Text>
      {!loading ? (
        <Text style={styles.summary}>
          {configuredProviderIds.length} provider
          {configuredProviderIds.length === 1 ? "" : "s"} configured ·{" "}
          {chatModelCount} chat model{chatModelCount === 1 ? "" : "s"} unlocked
          {lockedChatModels.length > 0
            ? ` · ${lockedChatModels.length} more available with other keys`
            : ""}
        </Text>
      ) : null}
      {loading ? (
        <Text style={styles.status}>Loading provider settings…</Text>
      ) : null}
      <ScrollView
        contentContainerStyle={styles.scrollBody}
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled
        style={styles.scroll}
      >
        {configuredProviderIds.length > 0 ? (
          <Text style={styles.sectionHeading}>Your providers</Text>
        ) : null}
        {configuredProviderIds.map((providerId) => (
          <ProviderCard
            callsDisabled={callsDisabled}
            entry={configuredStatus(providers, providerId)}
            key={providerId}
            onApiKeyChange={(text) =>
              updateRow(providerId, { apiKey: text, message: undefined })
            }
            onRemove={() => void removeKey(providerId)}
            onSave={() => void saveKey(providerId)}
            onValidate={() => void validateKey(providerId)}
            providerId={providerId}
            row={rowState[providerId]}
            unlockedModels={chatModelsForProvider(availableModels, providerId)}
          />
        ))}
        {unconfiguredProviderIds.length > 0 ? (
          <View style={styles.addSection}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: addProvidersOpen }}
              onPress={() => setAddProvidersOpen((open) => !open)}
              style={({ pressed }) => [
                styles.addToggle,
                pressed && styles.buttonPressed
              ]}
            >
              <Text style={styles.addToggleText}>
                {addProvidersOpen ? "▾" : "▸"} Enable more models
              </Text>
              <Text style={styles.addToggleHint}>
                {unconfiguredProviderIds.length} provider
                {unconfiguredProviderIds.length === 1 ? "" : "s"} · paste a key
                to unlock
              </Text>
            </Pressable>
            {addProvidersOpen
              ? unconfiguredProviderIds.map((providerId) => (
                  <ProviderCard
                    callsDisabled={callsDisabled}
                    entry={configuredStatus(providers, providerId)}
                    key={providerId}
                    onApiKeyChange={(text) =>
                      updateRow(providerId, {
                        apiKey: text,
                        message: undefined
                      })
                    }
                    onRemove={() => void removeKey(providerId)}
                    onSave={() => void saveKey(providerId)}
                    onValidate={() => void validateKey(providerId)}
                    providerId={providerId}
                    row={rowState[providerId]}
                    unlockedModels={chatModelsForProvider(
                      availableModels,
                      providerId
                    )}
                  />
                ))
              : null}
            {addProvidersOpen && lockedChatModels.length > 0 ? (
              <View style={styles.lockedList}>
                <Text style={styles.lockedHeading}>
                  Models you can unlock
                </Text>
                {lockedChatModels.map((model) => (
                  <Text key={model.id} style={styles.lockedRow}>
                    {model.label}
                    <Text style={styles.lockedMeta}>
                      {" "}
                      · {providerDisplayLabel(model.provider)}
                      {model.bestFor !== undefined
                        ? ` — ${model.bestFor}`
                        : ""}
                    </Text>
                  </Text>
                ))}
              </View>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
      {!loading && !anyConfigured && !settingsTab ? (
        <Text style={styles.emptyHint}>
          No provider keys yet. Add one above or skip for now and return in
          Settings.
        </Text>
      ) : null}
      {!settingsTab ? (
      <View style={styles.actions}>
        <SetupButton
          disabled={loading}
          label="Skip for now"
          onPress={() => void skipSetup()}
        />
        {onDismiss !== undefined ? (
          <SetupButton disabled={loading} label="Close" onPress={onDismiss} />
        ) : null}
      </View>
      ) : null}
      {panelMessage !== undefined ? (
        <Text accessibilityRole="alert" style={styles.message}>
          {panelMessage}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: colors.paper,
    borderColor: colors.line,
    borderRadius: 10,
    borderWidth: 1,
    flex: 1,
    gap: 10,
    minHeight: 0,
    padding: 14
  },
  panelCompact: {
    padding: 12
  },
  scroll: {
    flex: 1,
    minHeight: 0
  },
  scrollBody: {
    gap: 10,
    paddingBottom: 4
  },
  title: {
    color: colors.ink,
    fontFamily: fonts.uiMedium,
    fontSize: 16
  },
  copy: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 13,
    lineHeight: 18
  },
  summary: {
    color: colors.ink,
    fontFamily: fonts.uiMedium,
    fontSize: 13,
    lineHeight: 18
  },
  sectionHeading: {
    color: colors.ink,
    fontFamily: fonts.uiMedium,
    fontSize: 12,
    letterSpacing: 0.2,
    marginTop: 2
  },
  emptyHint: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 13,
    lineHeight: 18
  },
  addSection: {
    borderColor: colors.line,
    borderRadius: 8,
    borderWidth: 1,
    gap: 10,
    marginTop: 4,
    padding: 10
  },
  addToggle: {
    alignItems: "flex-start",
    gap: 4,
    paddingVertical: 2
  },
  addToggleText: {
    color: colors.kicker,
    fontFamily: fonts.uiMedium,
    fontSize: 14
  },
  addToggleHint: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 12,
    lineHeight: 16
  },
  lockedList: {
    borderTopColor: colors.line,
    borderTopWidth: 1,
    gap: 6,
    paddingTop: 10
  },
  lockedHeading: {
    color: colors.ink,
    fontFamily: fonts.uiMedium,
    fontSize: 12
  },
  lockedRow: {
    color: colors.ink,
    fontFamily: fonts.ui,
    fontSize: 12,
    lineHeight: 17
  },
  lockedMeta: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 12
  },
  providerCard: {
    borderColor: colors.line,
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
    padding: 10
  },
  providerHeader: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "space-between"
  },
  providerTitle: {
    color: colors.ink,
    fontFamily: fonts.uiMedium,
    fontSize: 14
  },
  validationBadge: {
    fontFamily: fonts.uiMedium,
    fontSize: 11,
    letterSpacing: 0.2
  },
  validationOk: {
    color: colors.kicker
  },
  validationWarn: {
    color: colors.muted
  },
  validationBad: {
    color: colors.ink
  },
  validationMuted: {
    color: colors.muted
  },
  maskedHint: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 12
  },
  modelChipEmpty: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 12,
    lineHeight: 16
  },
  status: {
    color: colors.ink,
    fontFamily: fonts.ui,
    fontSize: 13,
    lineHeight: 18
  },
  input: {
    borderColor: colors.line,
    borderRadius: 8,
    borderWidth: 1,
    color: colors.ink,
    fontFamily: fonts.ui,
    fontSize: 14,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  button: {
    backgroundColor: colors.ink,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  buttonPressed: {
    opacity: 0.85
  },
  buttonDisabled: {
    opacity: 0.45
  },
  buttonText: {
    color: colors.paper,
    fontFamily: fonts.uiMedium,
    fontSize: 13
  },
  rowMessage: {
    color: colors.ink,
    fontFamily: fonts.ui,
    fontSize: 12,
    lineHeight: 16
  },
  message: {
    color: colors.ink,
    fontFamily: fonts.ui,
    fontSize: 13,
    lineHeight: 18
  }
});
