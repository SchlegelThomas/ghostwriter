import { useEffect, useMemo, useRef, useState } from "react";
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
import type { WorkspaceChatMessage } from "./WorkspaceChatPanel.js";
import {
  commandPaletteKinds,
  filterWorkspaceJumpTargets,
  manuscriptJumpKinds,
  type WorkspaceJumpTarget
} from "./workspace-quick-nav.js";

const { colors, fonts } = ghostwriterTheme;

export type WorkspacePaletteMode = "jump" | "command";

export type WorkspaceQuickNavProps = Readonly<{
  mode: WorkspacePaletteMode;
  targets: readonly WorkspaceJumpTarget[];
  chatCapabilities?: readonly GhostwriterCapability[];
  chatMessages?: readonly WorkspaceChatMessage[];
  chatBusy?: boolean;
  onClose(): void;
  onPick(target: WorkspaceJumpTarget): void;
  onChatSend?(message: string): Promise<void> | void;
}>;

export function WorkspaceQuickNav({
  mode,
  targets,
  chatCapabilities = [],
  chatMessages = [],
  chatBusy = false,
  onClose,
  onPick,
  onChatSend
}: WorkspaceQuickNavProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [sending, setSending] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const activeIndexRef = useRef(0);
  const resultsRef = useRef<readonly WorkspaceJumpTarget[]>([]);
  const queryRef = useRef("");
  const confirmingRef = useRef(false);

  const kinds =
    mode === "jump" ? manuscriptJumpKinds() : commandPaletteKinds();
  const results = useMemo(
    () => filterWorkspaceJumpTargets(targets, query, { kinds, limit: 32 }),
    [kinds, query, targets]
  );

  activeIndexRef.current = activeIndex;
  resultsRef.current = results;
  queryRef.current = query;

  useEffect(() => {
    setActiveIndex(0);
  }, [query, mode]);

  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(timer);
  }, [mode]);

  function confirmActiveTarget(
    event?: Readonly<{ preventDefault(): void; metaKey?: boolean; ctrlKey?: boolean }>
  ): void {
    if (confirmingRef.current) return;
    const currentResults = resultsRef.current;
    const currentQuery = queryRef.current;
    const sendAsChat =
      mode === "command" &&
      onChatSend !== undefined &&
      currentQuery.trim().length > 0 &&
      (event?.metaKey === true ||
        event?.ctrlKey === true ||
        currentResults.length === 0);
    if (sendAsChat) {
      event?.preventDefault();
      void sendChat(currentQuery);
      return;
    }
    const target = currentResults[activeIndexRef.current] ?? currentResults[0];
    if (target === undefined) return;
    event?.preventDefault();
    confirmingRef.current = true;
    onPick(target);
    queueMicrotask(() => {
      confirmingRef.current = false;
    });
  }

  useEffect(() => {
    if (typeof document === "undefined") return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((current) => {
          const length = resultsRef.current.length;
          return length === 0 ? 0 : Math.min(length - 1, current + 1);
        });
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((current) => Math.max(0, current - 1));
        return;
      }
      if (event.key !== "Enter") return;
      // Prefer the input's submit handler; this catches Enter outside the field.
      confirmActiveTarget(event);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [mode, onChatSend, onClose, onPick]);

  async function sendChat(message: string): Promise<void> {
    if (onChatSend === undefined || sending || chatBusy) return;
    const text = message.trim();
    if (text.length === 0) return;
    setSending(true);
    try {
      await onChatSend(text);
      setQuery("");
    } finally {
      setSending(false);
    }
  }

  return (
    <View
      accessibilityLabel={
        mode === "jump" ? "Quick jump palette" : "Command and chat palette"
      }
      style={styles.backdrop}
      {...({
        onClick: (event: { target: EventTarget; currentTarget: EventTarget }) => {
          if (event.target === event.currentTarget) onClose();
        }
      } as object)}
    >
      <View style={styles.panel}>
        <View style={styles.header}>
          <Text style={styles.eyebrow}>
            {mode === "jump" ? "Quick jump · ⌘P" : "Command · chat · ⌘⇧P"}
          </Text>
          <Pressable
            accessibilityLabel="Close palette"
            accessibilityRole="button"
            onPress={onClose}
            style={({ pressed }) => [styles.close, pressed && styles.pressed]}
          >
            <Text style={styles.closeText}>Esc</Text>
          </Pressable>
        </View>
        <TextInput
          accessibilityLabel={
            mode === "jump"
              ? "Search books, chapters, scenes"
              : "Filter commands or type a chat message"
          }
          autoFocus
          blurOnSubmit={false}
          onChangeText={setQuery}
          onSubmitEditing={() => confirmActiveTarget()}
          placeholder={
            mode === "jump"
              ? "Jump to a book, chapter, scene, or story record…"
              : "Run a command, or type to chat (⌘Enter to send)…"
          }
          placeholderTextColor={colors.muted}
          ref={inputRef}
          returnKeyType="go"
          style={styles.input}
          value={query}
          {...({
            onKeyDown: (event: {
              key: string;
              metaKey?: boolean;
              ctrlKey?: boolean;
              preventDefault(): void;
              stopPropagation(): void;
            }) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                event.stopPropagation();
                setActiveIndex((current) => {
                  const length = resultsRef.current.length;
                  return length === 0 ? 0 : Math.min(length - 1, current + 1);
                });
                return;
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                event.stopPropagation();
                setActiveIndex((current) => Math.max(0, current - 1));
                return;
              }
              if (event.key !== "Enter") return;
              event.preventDefault();
              event.stopPropagation();
              confirmActiveTarget(event);
            }
          } as object)}
        />
        <ScrollView
          keyboardShouldPersistTaps="handled"
          style={styles.results}
        >
          {results.map((target, index) => (
            <Pressable
              accessibilityRole="button"
              key={target.id}
              onPress={() => onPick(target)}
              onHoverIn={() => setActiveIndex(index)}
              style={({ pressed }) => [
                styles.result,
                index === activeIndex && styles.resultActive,
                pressed && styles.pressed
              ]}
            >
              <Text style={styles.resultKind}>{target.kind}</Text>
              <View style={styles.resultCopy}>
                <Text numberOfLines={1} style={styles.resultTitle}>
                  {target.title}
                </Text>
                <Text numberOfLines={1} style={styles.resultSubtitle}>
                  {target.subtitle}
                </Text>
              </View>
            </Pressable>
          ))}
          {results.length === 0 ? (
            <Text style={styles.empty}>
              {mode === "jump"
                ? "No matching manuscript items"
                : "No matching commands — ⌘Enter sends as chat"}
            </Text>
          ) : null}
        </ScrollView>
        {mode === "command" ? (
          <View style={styles.chatBlock}>
            <Text style={styles.chatEyebrow}>
              MCP chat
              {chatCapabilities.length > 0
                ? ` · ${chatCapabilities.length} capabilities`
                : ""}
            </Text>
            <ScrollView style={styles.chatLog}>
              {chatMessages.slice(-6).map((message) => (
                <Text key={message.id} style={styles.chatLine}>
                  <Text style={styles.chatRole}>{message.role}: </Text>
                  {message.body}
                </Text>
              ))}
              {chatMessages.length === 0 ? (
                <Text style={styles.empty}>Ask the project assistant…</Text>
              ) : null}
            </ScrollView>
            <Pressable
              accessibilityLabel="Send chat message"
              accessibilityRole="button"
              disabled={sending || chatBusy || query.trim().length === 0}
              onPress={() => void sendChat(query)}
              style={({ pressed }) => [
                styles.sendButton,
                (sending || chatBusy || query.trim().length === 0) &&
                  styles.disabled,
                pressed && styles.pressed
              ]}
            >
              <Text style={styles.sendButtonText}>
                {sending || chatBusy ? "Sending…" : "Send chat · ⌘Enter"}
              </Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    alignItems: "center",
    backgroundColor: "rgba(40, 35, 31, 0.28)",
    bottom: 0,
    justifyContent: "flex-start",
    left: 0,
    paddingTop: 48,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 80
  },
  panel: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 12,
    borderWidth: 1,
    maxHeight: "78%",
    maxWidth: 720,
    overflow: "hidden",
    shadowColor: "#2c2a27",
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.22,
    shadowRadius: 28,
    width: "92%"
  },
  header: {
    alignItems: "center",
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 10
  },
  eyebrow: {
    color: colors.kicker,
    fontFamily: fonts.uiSemibold,
    fontSize: 11,
    letterSpacing: 0.4,
    textTransform: "uppercase"
  },
  close: {
    borderColor: colors.line,
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4
  },
  closeText: {
    color: colors.muted,
    fontFamily: fonts.uiSemibold,
    fontSize: 11
  },
  input: {
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    color: colors.ink,
    fontFamily: fonts.uiMedium,
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 14
  },
  results: {
    maxHeight: 280
  },
  result: {
    alignItems: "center",
    borderBottomColor: colors.wash,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10
  },
  resultActive: {
    backgroundColor: colors.accentSoft
  },
  resultKind: {
    color: colors.muted,
    fontFamily: fonts.uiSemibold,
    fontSize: 9,
    minWidth: 72,
    textTransform: "uppercase"
  },
  resultCopy: {
    flex: 1,
    minWidth: 0
  },
  resultTitle: {
    color: colors.ink,
    fontFamily: fonts.uiSemibold,
    fontSize: 14
  },
  resultSubtitle: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 11,
    marginTop: 2
  },
  empty: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 12,
    paddingHorizontal: 14,
    paddingVertical: 16
  },
  chatBlock: {
    borderTopColor: colors.line,
    borderTopWidth: 1,
    maxHeight: 220,
    paddingBottom: 10,
    paddingTop: 8
  },
  chatEyebrow: {
    color: colors.kicker,
    fontFamily: fonts.uiSemibold,
    fontSize: 10,
    letterSpacing: 0.3,
    paddingHorizontal: 14,
    textTransform: "uppercase"
  },
  chatLog: {
    maxHeight: 120,
    paddingHorizontal: 14,
    paddingVertical: 6
  },
  chatLine: {
    color: colors.ink,
    fontFamily: fonts.ui,
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 6
  },
  chatRole: {
    color: colors.muted,
    fontFamily: fonts.uiSemibold
  },
  sendButton: {
    alignSelf: "flex-end",
    backgroundColor: colors.accent,
    borderRadius: 8,
    marginHorizontal: 14,
    marginTop: 4,
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  sendButtonText: {
    color: "#ffffff",
    fontFamily: fonts.uiSemibold,
    fontSize: 12
  },
  pressed: {
    opacity: 0.85
  },
  disabled: {
    opacity: 0.45
  }
});
