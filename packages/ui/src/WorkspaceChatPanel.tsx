import { useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import type { GhostwriterCapability } from "@ghostwriter/core";
import { ghostwriterTheme } from "./theme.js";

const { colors, fonts } = ghostwriterTheme;

export type WorkspaceChatMessage = Readonly<{
  id: string;
  role: "user" | "assistant" | "system";
  body: string;
}>;

export type WorkspaceChatPanelProps = Readonly<{
  capabilities: readonly GhostwriterCapability[];
  messages: readonly WorkspaceChatMessage[];
  busy?: boolean;
  open: boolean;
  onClose(): void;
  onSend(message: string): Promise<void> | void;
}>;

export function WorkspaceChatPanel({
  capabilities,
  messages,
  busy = false,
  open,
  onClose,
  onSend
}: WorkspaceChatPanelProps) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  if (!open) return null;

  async function send(): Promise<void> {
    const text = draft.trim();
    if (text.length === 0 || sending || busy) return;
    setSending(true);
    try {
      await onSend(text);
      setDraft("");
    } finally {
      setSending(false);
    }
  }

  return (
    <View accessibilityLabel="Workspace MCP chat" style={styles.panel}>
      <View style={styles.heading}>
        <View style={styles.headingCopy}>
          <Text style={styles.eyebrow}>Capabilities</Text>
          <Text style={styles.title}>MCP chat</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={onClose}
          style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
        >
          <Text style={styles.closeButtonText}>Close</Text>
        </Pressable>
      </View>
      <Text style={styles.help}>
        Tool invoke against the open project. LLM completion waits on an OpenAI
        key; until then replies echo tool results.
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.capabilityScroll}
      >
        {capabilities.slice(0, 24).map((capability) => (
          <View key={capability.id} style={styles.capabilityChip}>
            <Text numberOfLines={1} style={styles.capabilityText}>
              {capability.title}
            </Text>
          </View>
        ))}
      </ScrollView>
      <ScrollView
        contentContainerStyle={styles.messages}
        keyboardShouldPersistTaps="handled"
        style={styles.messageScroll}
      >
        {messages.length === 0 ? (
          <Text style={styles.empty}>
            Ask what tools can do for this project, or name a capability to run.
          </Text>
        ) : (
          messages.map((message) => (
            <View
              key={message.id}
              style={[
                styles.message,
                message.role === "user" && styles.messageUser,
                message.role === "system" && styles.messageSystem
              ]}
            >
              <Text style={styles.messageRole}>{message.role}</Text>
              <Text style={styles.messageBody}>{message.body}</Text>
            </View>
          ))
        )}
      </ScrollView>
      <View style={styles.composer}>
        <TextInput
          accessibilityLabel="Chat message"
          editable={!busy && !sending}
          multiline
          onChangeText={setDraft}
          onSubmitEditing={() => void send()}
          placeholder="Invoke a capability or ask about this project…"
          placeholderTextColor={colors.muted}
          style={styles.input}
          value={draft}
        />
        <Pressable
          accessibilityRole="button"
          disabled={busy || sending || draft.trim().length === 0}
          onPress={() => void send()}
          style={({ pressed }) => [
            styles.sendButton,
            pressed && styles.pressed,
            (busy || sending || draft.trim().length === 0) && styles.disabled
          ]}
        >
          <Text style={styles.sendButtonText}>
            {sending ? "Sending…" : "Send"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: "#f7f3ec",
    borderLeftColor: colors.line,
    borderLeftWidth: 1,
    flex: 1,
    minHeight: 0,
    minWidth: 0
  },
  heading: {
    alignItems: "flex-start",
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between",
    padding: 12
  },
  headingCopy: {
    flex: 1,
    minWidth: 0
  },
  eyebrow: {
    color: colors.kicker,
    fontFamily: fonts.uiSemibold,
    fontSize: 8,
    letterSpacing: 1.3,
    textTransform: "uppercase"
  },
  title: {
    color: colors.ink,
    fontFamily: fonts.story,
    fontSize: 20,
    marginTop: 2
  },
  closeButton: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 6
  },
  closeButtonText: {
    color: colors.ink,
    fontFamily: fonts.uiSemibold,
    fontSize: 8
  },
  help: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 9,
    lineHeight: 13,
    paddingHorizontal: 12,
    paddingTop: 8
  },
  capabilityScroll: {
    flexGrow: 0,
    marginTop: 8,
    maxHeight: 42,
    paddingHorizontal: 10
  },
  capabilityChip: {
    alignSelf: "center",
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 999,
    borderWidth: 1,
    marginRight: 6,
    paddingHorizontal: 8,
    paddingVertical: 5
  },
  capabilityText: {
    color: colors.muted,
    fontFamily: fonts.uiMedium,
    fontSize: 7,
    maxWidth: 140
  },
  messageScroll: {
    flex: 1,
    minHeight: 0
  },
  messages: {
    gap: 8,
    padding: 12
  },
  empty: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 10,
    fontStyle: "italic"
  },
  message: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 8,
    borderWidth: 1,
    gap: 4,
    padding: 9
  },
  messageUser: {
    backgroundColor: colors.accentSoft,
    borderColor: "#d4b7aa"
  },
  messageSystem: {
    backgroundColor: colors.amberSoft,
    borderColor: colors.amber
  },
  messageRole: {
    color: colors.kicker,
    fontFamily: fonts.uiSemibold,
    fontSize: 7,
    letterSpacing: 0.8,
    textTransform: "uppercase"
  },
  messageBody: {
    color: colors.ink,
    fontFamily: fonts.ui,
    fontSize: 10,
    lineHeight: 15
  },
  composer: {
    borderTopColor: colors.line,
    borderTopWidth: 1,
    gap: 8,
    padding: 10
  },
  input: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 7,
    borderWidth: 1,
    color: colors.ink,
    fontFamily: fonts.ui,
    fontSize: 10,
    minHeight: 56,
    paddingHorizontal: 9,
    paddingVertical: 8,
    textAlignVertical: "top",
    width: "100%"
  },
  sendButton: {
    alignItems: "center",
    alignSelf: "flex-end",
    backgroundColor: colors.brandDark,
    borderRadius: 6,
    minHeight: 34,
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  sendButtonText: {
    color: "#ffffff",
    fontFamily: fonts.uiSemibold,
    fontSize: 9
  },
  pressed: {
    opacity: 0.72
  },
  disabled: {
    opacity: 0.42
  }
});
