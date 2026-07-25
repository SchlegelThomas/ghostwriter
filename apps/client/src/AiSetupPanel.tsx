import { ghostwriterTheme } from "@ghostwriter/ui";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import {
  deleteOpenAiProviderCredential,
  getOpenAiProviderStatus,
  GhostwriterApiError,
  setOpenAiProviderCredential,
  skipAiCollaborationSetup,
  validateOpenAiProviderCredential,
  type OpenAiProviderStatusResponse
} from "./api.js";

const { colors, fonts } = ghostwriterTheme;

export type AiSetupPanelProps = Readonly<{
  compact?: boolean;
  onConfigured?(): void;
  onDismiss?(): void;
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

function statusLine(status: OpenAiProviderStatusResponse | undefined): string {
  if (status === undefined) return "Checking OpenAI key…";
  if (status.callsDisabled) {
    return "Provider calls are temporarily disabled.";
  }
  if (!status.configured) {
    return "No OpenAI key is configured yet.";
  }
  return `OpenAI key configured (${status.maskedHint}) · ${status.validationState}`;
}

export function AiSetupPanel({
  compact = false,
  onConfigured,
  onDismiss
}: AiSetupPanelProps) {
  const [status, setStatus] = useState<OpenAiProviderStatusResponse>();
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

  async function refreshStatus(): Promise<OpenAiProviderStatusResponse> {
    const next = await getOpenAiProviderStatus();
    setStatus(next);
    return next;
  }

  useEffect(() => {
    void refreshStatus().catch((error: unknown) => {
      setMessage(
        error instanceof GhostwriterApiError
          ? error.message
          : "Ghostwriter could not load provider status."
      );
    });
  }, []);

  async function saveKey(): Promise<void> {
    setBusy(true);
    setMessage(undefined);
    try {
      const next = await setOpenAiProviderCredential({
        apiKey,
        ...(status?.configured === true
          ? { expectedVersion: status.version }
          : {})
      });
      setStatus(next);
      setApiKey("");
      setMessage("OpenAI key saved.");
      onConfigured?.();
    } catch (error) {
      setMessage(
        error instanceof GhostwriterApiError
          ? error.message
          : "Ghostwriter could not save that OpenAI key."
      );
    } finally {
      setBusy(false);
    }
  }

  async function testKey(): Promise<void> {
    if (status?.configured !== true) return;
    setBusy(true);
    setMessage(undefined);
    try {
      const next = await validateOpenAiProviderCredential({
        expectedVersion: status.version
      });
      setStatus(next);
      setMessage(
        next.configured && next.validationState === "valid"
          ? "OpenAI key looks valid."
          : "OpenAI key did not validate."
      );
    } catch (error) {
      setMessage(
        error instanceof GhostwriterApiError
          ? error.message
          : "Ghostwriter could not test that OpenAI key."
      );
    } finally {
      setBusy(false);
    }
  }

  async function removeKey(): Promise<void> {
    if (status?.configured !== true) return;
    setBusy(true);
    setMessage(undefined);
    try {
      const next = await deleteOpenAiProviderCredential({
        expectedVersion: status.version
      });
      setStatus(next);
      setMessage("OpenAI key removed.");
    } catch (error) {
      setMessage(
        error instanceof GhostwriterApiError
          ? error.message
          : "Ghostwriter could not remove that OpenAI key."
      );
    } finally {
      setBusy(false);
    }
  }

  async function skipSetup(): Promise<void> {
    setBusy(true);
    setMessage(undefined);
    try {
      await skipAiCollaborationSetup();
      setMessage("Collaboration setup skipped. You can add a key later.");
      onDismiss?.();
    } catch (error) {
      setMessage(
        error instanceof GhostwriterApiError
          ? error.message
          : "Ghostwriter could not skip collaboration setup."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={[styles.panel, compact && styles.panelCompact]}>
      <Text style={styles.title}>AI setup</Text>
      <Text style={styles.copy}>
        Scene Partner uses your own OpenAI key. Capture still works without one.
      </Text>
      <Text style={styles.status}>{statusLine(status)}</Text>
      <TextInput
        accessibilityLabel="OpenAI API key"
        autoCapitalize="none"
        autoCorrect={false}
        editable={!busy}
        onChangeText={setApiKey}
        placeholder="Paste OpenAI API key"
        placeholderTextColor={colors.muted}
        secureTextEntry
        style={styles.input}
        value={apiKey}
      />
      <View style={styles.actions}>
        <SetupButton
          disabled={busy || apiKey.trim().length < 20}
          label="Save key"
          onPress={() => void saveKey()}
        />
        <SetupButton
          disabled={busy || status?.configured !== true}
          label="Test key"
          onPress={() => void testKey()}
        />
        <SetupButton
          disabled={busy || status?.configured !== true}
          label="Remove key"
          onPress={() => void removeKey()}
        />
        <SetupButton
          disabled={busy}
          label="Skip for now"
          onPress={() => void skipSetup()}
        />
        {onDismiss !== undefined ? (
          <SetupButton disabled={busy} label="Close" onPress={onDismiss} />
        ) : null}
      </View>
      {message !== undefined ? (
        <Text accessibilityRole="alert" style={styles.message}>
          {message}
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
    gap: 10,
    padding: 14
  },
  panelCompact: {
    padding: 12
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
  message: {
    color: colors.ink,
    fontFamily: fonts.ui,
    fontSize: 13,
    lineHeight: 18
  }
});
