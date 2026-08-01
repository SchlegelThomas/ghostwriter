import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { ArrowUp, CaretDown, CaretRight, Check, CopySimple } from "phosphor-react-native";
import type { AgentModelId } from "@ghostwriter/core";
import { AgentChatMarkdown } from "./AgentChatMarkdown.js";
import {
  agentWorkingGroupState,
  type AgentWorkingGroupState
} from "./agent-working-summary.js";
import { ghostwriterTheme } from "./theme.js";
import type { OpenSettingsHandler } from "./settings-focus.js";
import { AgentModelPickerMenu } from "./AgentModelPickerMenu.js";
import {
  agentModelLabelWithProvider,
  WORKSPACE_AGENT_EFFORTS,
  WORKSPACE_AGENT_MODES,
  workspaceAgentEffortLabel,
  workspaceAgentModeLabel,
  workspaceAgentModelPickerOptions,
  type WorkspaceAgentEffort,
  type WorkspaceAgentMode,
  type WorkspaceAvailableModel
} from "./workspace-agent-prefs.js";
import {
  AGENT_TOOLKIT_ACTIONS,
  type AgentToolkitId
} from "./workspace-agent-toolkit.js";

const { colors, fonts } = ghostwriterTheme;

export type WorkspaceChatToolTrace = Readonly<{
  toolName: string;
  title: string;
  ok: boolean;
  summary: string;
  errorMessage?: string;
}>;

export type WorkspaceChatMessage = Readonly<{
  id: string;
  role: "user" | "assistant" | "system";
  body: string;
  toolTraces?: readonly WorkspaceChatToolTrace[];
  streaming?: boolean;
  statusLabel?: string;
}>;

export type WorkspaceChatSendInput = Readonly<{
  message: string;
  mode: WorkspaceAgentMode;
  model: AgentModelId;
  effort: WorkspaceAgentEffort;
}>;

export type WorkspaceChatPanelProps = Readonly<{
  messages: readonly WorkspaceChatMessage[];
  busy?: boolean;
  open: boolean;
  onClose(): void;
  onSend(input: WorkspaceChatSendInput): Promise<void> | void;
  mode: WorkspaceAgentMode;
  model: AgentModelId;
  effort: WorkspaceAgentEffort;
  onModeChange(mode: WorkspaceAgentMode): void;
  onModelChange(model: AgentModelId): void;
  onEffortChange(effort: WorkspaceAgentEffort): void;
  availableModels?: readonly WorkspaceAvailableModel[];
  providerConfigured?: boolean;
  onOpenSettings?: OpenSettingsHandler;
  selectionSummary?: string;
  onToolkitAction?(id: AgentToolkitId): void;
  /** Latest Plan-mode assistant reply available to save. */
  planOutlineText?: string;
  onSavePlanToPlans?(outlineText: string): void;
  /** Docked in the secondary shell — no outer border; close returns to Properties. */
  variant?: "floating" | "docked";
}>;

type PickerKind = "mode" | "model" | "effort" | null;

export function WorkspaceChatPanel({
  messages,
  busy = false,
  open,
  onClose,
  onSend,
  mode,
  model,
  effort,
  onModeChange,
  onModelChange,
  onEffortChange,
  availableModels = [],
  providerConfigured = true,
  onOpenSettings,
  selectionSummary,
  onToolkitAction,
  planOutlineText,
  onSavePlanToPlans,
  variant = "floating"
}: WorkspaceChatPanelProps) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [openPicker, setOpenPicker] = useState<PickerKind>(null);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (messages.length === 0) return;
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [messages]);

  if (!open) return null;

  async function send(): Promise<void> {
    const text = draft.trim();
    if (text.length === 0 || sending || busy) return;
    setSending(true);
    setOpenPicker(null);
    try {
      await onSend({ message: text, mode, model, effort });
      setDraft("");
    } finally {
      setSending(false);
    }
  }

  const composerDisabled = busy || sending;
  const canSend = !composerDisabled && draft.trim().length > 0;
  const canSavePlanToPlans =
    mode === "plan" &&
    onSavePlanToPlans !== undefined &&
    planOutlineText !== undefined &&
    planOutlineText.trim().length > 0 &&
    !composerDisabled;
  const modelPickerOptions = workspaceAgentModelPickerOptions(
    availableModels,
    mode
  );
  const modelChipLabel = agentModelLabelWithProvider(model, availableModels);

  return (
    <View
      accessibilityLabel="Workspace writing agent"
      style={[styles.panel, variant === "docked" && styles.panelDocked]}
    >
      {variant === "floating" ? (
        <View style={styles.floatingHeading}>
          <Text style={styles.floatingTitle}>Agent</Text>
          <Pressable
            accessibilityRole="button"
            onPress={onClose}
            style={({ pressed }) => [
              styles.ghostButton,
              pressed && styles.pressed
            ]}
          >
            <Text style={styles.ghostButtonText}>Close</Text>
          </Pressable>
        </View>
      ) : null}

      {selectionSummary !== undefined && selectionSummary.trim().length > 0 ? (
        <View style={styles.selectionChip}>
          <Text numberOfLines={1} style={styles.selectionChipText}>
            {selectionSummary}
          </Text>
        </View>
      ) : null}

      <View style={styles.messageArea}>
        <ScrollView
          contentContainerStyle={[
            styles.messages,
            messages.length === 0 && styles.messagesEmpty
          ]}
          keyboardShouldPersistTaps="handled"
          ref={scrollRef}
          style={styles.messageScroll}
        >
          {messages.length === 0 ? (
            <View style={styles.emptyBlock}>
              <Text style={styles.emptyTitle}>
                {mode === "plan"
                  ? "Plan with the manuscript"
                  : mode === "agent"
                    ? "Writing agent"
                    : "Chat about this project"}
              </Text>
              <Text style={styles.empty}>
                {mode === "plan"
                  ? "Ask for outlines, scene lists, or proposal drafts you can save to Plans."
                  : mode === "agent"
                    ? "Ask for next steps, cover ideas, or scene work — propose only until you apply."
                    : "Ask questions, research continuity, or draft ideas against the open project."}
              </Text>
              {!providerConfigured ? (
                <View style={styles.emptyCtaBlock}>
                  <Text style={styles.emptyHint}>
                    Add model provider keys in Settings for real replies.
                  </Text>
                  {onOpenSettings !== undefined ? (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => onOpenSettings("providers")}
                      style={({ pressed }) => [
                        styles.settingsButton,
                        pressed && styles.pressed
                      ]}
                    >
                      <Text style={styles.settingsButtonText}>Open Settings</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
            </View>
          ) : (
            messages.map((message) => (
              <ChatTurn key={message.id} message={message} />
            ))
          )}
        </ScrollView>
      </View>

      {mode === "agent" && onToolkitAction !== undefined ? (
        <View style={styles.toolkitRow}>
          {AGENT_TOOLKIT_ACTIONS.map((action) => (
            <Pressable
              accessibilityRole="button"
              key={action.id}
              onPress={() => onToolkitAction(action.id)}
              style={({ pressed }) => [
                styles.toolkitAction,
                pressed && styles.pressed
              ]}
            >
              <Text style={styles.toolkitActionText}>{action.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {canSavePlanToPlans ? (
        <View style={styles.savePlanRow}>
          <Pressable
            accessibilityRole="button"
            onPress={() => onSavePlanToPlans?.(planOutlineText!)}
            style={({ pressed }) => [
              styles.savePlanButton,
              pressed && styles.pressed
            ]}
          >
            <Text style={styles.savePlanButtonText}>Save to Plans</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.composer}>
        {openPicker === "model" ? (
          <AgentModelPickerMenu
            onDismiss={() => setOpenPicker(null)}
            onOpenSettings={
              onOpenSettings === undefined
                ? undefined
                : (focus) => {
                    setOpenPicker(null);
                    onOpenSettings(focus);
                  }
            }
            onSelect={(next) => {
              onModelChange(next);
              setOpenPicker(null);
            }}
            options={modelPickerOptions}
            selectedValue={model}
          />
        ) : openPicker !== null ? (
          <View style={styles.pickerMenuDock}>
            {(openPicker === "mode"
              ? WORKSPACE_AGENT_MODES.map((value) => ({
                  value,
                  label: workspaceAgentModeLabel(value)
                }))
              : WORKSPACE_AGENT_EFFORTS.map((value) => ({
                  value,
                  label: workspaceAgentEffortLabel(value)
                }))
            ).map((option) => (
              <Pressable
                accessibilityRole="menuitem"
                key={option.value}
                onPress={() => {
                  if (openPicker === "mode") {
                    onModeChange(option.value as WorkspaceAgentMode);
                  } else {
                    onEffortChange(option.value as WorkspaceAgentEffort);
                  }
                  setOpenPicker(null);
                }}
                style={({ pressed }) => [
                  styles.pickerOption,
                  pressed && styles.pressed
                ]}
              >
                <Text style={styles.pickerOptionText}>{option.label}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        <View style={styles.composerShell}>
          <TextInput
            accessibilityLabel="Chat message"
            editable={!composerDisabled}
            multiline
            onChangeText={setDraft}
            onSubmitEditing={() => void send()}
            placeholder="Ask about this project…"
            placeholderTextColor={colors.muted}
            style={styles.input}
            value={draft}
          />
          <View style={styles.composerToolbar}>
            <View style={styles.pickerRow}>
              <ComposerChip
                accessibilityLabel="Agent mode"
                disabled={composerDisabled}
                label={workspaceAgentModeLabel(mode)}
                onPress={() =>
                  setOpenPicker((current) =>
                    current === "mode" ? null : "mode"
                  )
                }
                selected={openPicker === "mode"}
              />
              <ComposerChip
                accessibilityLabel="Agent model"
                disabled={composerDisabled || modelPickerOptions.length === 0}
                label={modelChipLabel}
                onPress={() =>
                  setOpenPicker((current) =>
                    current === "model" ? null : "model"
                  )
                }
                selected={openPicker === "model"}
              />
              <ComposerChip
                accessibilityLabel="Agent effort"
                disabled={composerDisabled}
                label={workspaceAgentEffortLabel(effort)}
                onPress={() =>
                  setOpenPicker((current) =>
                    current === "effort" ? null : "effort"
                  )
                }
                selected={openPicker === "effort"}
              />
            </View>
            <Pressable
              accessibilityLabel="Send"
              accessibilityRole="button"
              disabled={!canSend}
              onPress={() => void send()}
              style={({ pressed }) => [
                styles.sendButton,
                pressed && styles.pressed,
                !canSend && styles.disabled
              ]}
            >
              <ArrowUp color="#ffffff" size={13} weight="thin" />
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const NO_TRACES: readonly WorkspaceChatToolTrace[] = Object.freeze([]);

/** One turn of the conversation: the writer's words, or the agent's reply. */
function ChatTurn({ message }: Readonly<{ message: WorkspaceChatMessage }>) {
  const streaming = message.streaming === true;
  const traces = message.toolTraces ?? NO_TRACES;
  const hasBody = message.body.trim().length > 0;

  if (message.role === "user") {
    return (
      <View style={styles.turnUser}>
        <View style={styles.userSaid}>
          <AgentChatMarkdown text={message.body} tone="user" />
        </View>
        <CopyMessageButton align="end" compact text={message.body} />
      </View>
    );
  }

  if (message.role === "system") {
    return (
      <View style={styles.turnSystem}>
        <Text style={styles.systemNote}>{message.body}</Text>
      </View>
    );
  }

  const working = agentWorkingGroupState({
    streaming,
    ...(message.statusLabel === undefined
      ? {}
      : { statusLabel: message.statusLabel }),
    traces: traces.map((trace) => ({ title: trace.title, ok: trace.ok }))
  });

  return (
    <View style={styles.turnAssistant}>
      {working.visible ? (
        <WorkingGroup state={working} streaming={streaming} traces={traces} />
      ) : null}
      {hasBody || streaming ? (
        <AgentChatMarkdown
          text={message.body}
          {...(streaming ? { trailing: <StreamingCaret /> } : {})}
        />
      ) : working.visible ? null : (
        <Text style={styles.emptyReply}>No reply came back.</Text>
      )}
      {streaming ? null : <CopyMessageButton align="start" text={message.body} />}
    </View>
  );
}

/** Status and tool steps, live while working and folded once the reply lands. */
function WorkingGroup({
  state,
  streaming,
  traces
}: Readonly<{
  state: AgentWorkingGroupState;
  streaming: boolean;
  traces: readonly WorkspaceChatToolTrace[];
}>) {
  const [override, setOverride] = useState<boolean | undefined>(undefined);
  const opacity = usePulse(streaming);

  const expanded = state.toggleable && (override ?? state.defaultExpanded);
  const Caret = expanded ? CaretDown : CaretRight;

  const label = (
    <Animated.Text numberOfLines={1} style={[styles.workingLabel, { opacity }]}>
      {state.label}
    </Animated.Text>
  );

  return (
    <View
      accessibilityLiveRegion={streaming ? "polite" : "none"}
      style={styles.working}
    >
      {state.toggleable ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          onPress={() => setOverride(!expanded)}
          style={({ pressed }) => [
            styles.workingHeader,
            pressed && styles.pressed
          ]}
        >
          <Caret color={colors.muted} size={10} weight="bold" />
          {label}
        </Pressable>
      ) : (
        <View style={styles.workingHeader}>
          <View style={styles.workingCaretSpace} />
          {label}
        </View>
      )}
      {expanded ? (
        <View style={styles.workingSteps}>
          {traces.map((trace, index) => (
            <View key={`${trace.toolName}-${index}`}>
              <Text style={styles.toolTraceLine}>
                {trace.title} · {trace.summary}
              </Text>
              {!trace.ok && trace.errorMessage !== undefined ? (
                <Text style={styles.toolTraceError}>{trace.errorMessage}</Text>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function clipboardWriteText(): ((text: string) => Promise<void>) | undefined {
  if (typeof navigator === "undefined") return undefined;
  const clipboard: Clipboard | undefined = navigator.clipboard;
  if (clipboard === undefined || typeof clipboard.writeText !== "function") {
    return undefined;
  }
  return (text) => clipboard.writeText(text);
}

/** Copies a turn verbatim — markdown and all — where the platform allows it. */
function CopyMessageButton({
  align,
  compact = false,
  text
}: Readonly<{ align: "start" | "end"; compact?: boolean; text: string }>) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );

  useEffect(
    () => () => {
      if (resetTimer.current !== undefined) clearTimeout(resetTimer.current);
    },
    []
  );

  const write = clipboardWriteText();
  if (write === undefined || text.trim().length === 0) return null;

  const copy = async (): Promise<void> => {
    try {
      await write(text);
    } catch {
      return;
    }
    setCopied(true);
    if (resetTimer.current !== undefined) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopied(false), 1600);
  };

  return (
    <View style={[styles.turnActions, align === "end" && styles.turnActionsEnd]}>
      <Pressable
        accessibilityLabel={copied ? "Copied" : "Copy message"}
        accessibilityRole="button"
        onPress={() => void copy()}
        style={({ pressed }) => [styles.copyButton, pressed && styles.pressed]}
      >
        {copied ? (
          <Check color={colors.green} size={10} weight="bold" />
        ) : (
          <CopySimple color={colors.muted} size={10} weight="regular" />
        )}
        {compact && !copied ? null : (
          <Text style={[styles.copyLabel, copied && styles.copyLabelDone]}>
            {copied ? "Copied" : "Copy"}
          </Text>
        )}
      </Pressable>
    </View>
  );
}

function usePulse(active: boolean): Animated.Value {
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!active || prefersReducedMotion()) {
      opacity.setValue(1);
      return;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.5,
          duration: 900,
          useNativeDriver: true
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 900,
          useNativeDriver: true
        })
      ])
    );
    animation.start();
    return () => {
      animation.stop();
      opacity.setValue(1);
    };
  }, [active, opacity]);

  return opacity;
}

function StreamingCaret() {
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (prefersReducedMotion()) return;
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.15,
          duration: 520,
          useNativeDriver: true
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 520,
          useNativeDriver: true
        })
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [opacity]);

  return (
    <Animated.Text style={[styles.streamingCaret, { opacity }]}>
      |
    </Animated.Text>
  );
}

function ComposerChip({
  accessibilityLabel,
  label,
  disabled,
  selected,
  onPress
}: Readonly<{
  accessibilityLabel: string;
  label: string;
  disabled: boolean;
  selected: boolean;
  onPress(): void;
}>) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ expanded: selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.pickerChip,
        selected && styles.pickerChipSelected,
        pressed && styles.pressed,
        disabled && styles.disabled
      ]}
    >
      <Text
        style={[
          styles.pickerChipText,
          selected && styles.pickerChipTextSelected
        ]}
      >
        {label} ▾
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: colors.paper,
    borderLeftColor: colors.line,
    borderLeftWidth: 1,
    flex: 1,
    flexDirection: "column",
    height: "100%",
    minHeight: 0,
    minWidth: 0,
    width: "100%",
    ...(typeof document !== "undefined"
      ? ({ display: "flex" } as object)
      : {})
  },
  panelDocked: {
    borderLeftWidth: 0
  },
  floatingHeading: {
    alignItems: "center",
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    flexDirection: "row",
    flexShrink: 0,
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  floatingTitle: {
    color: colors.ink,
    fontFamily: fonts.story,
    fontSize: 18
  },
  ghostButton: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 5
  },
  ghostButtonText: {
    color: colors.muted,
    fontFamily: fonts.uiSemibold,
    fontSize: 11
  },
  selectionChip: {
    alignSelf: "flex-start",
    backgroundColor: colors.wash,
    borderColor: colors.line,
    borderRadius: 999,
    borderWidth: 1,
    flexShrink: 0,
    marginHorizontal: 10,
    marginTop: 8,
    maxWidth: "92%",
    paddingHorizontal: 9,
    paddingVertical: 4
  },
  selectionChipText: {
    color: colors.muted,
    fontFamily: fonts.uiMedium,
    fontSize: 10
  },
  messageArea: {
    flex: 1,
    flexGrow: 1,
    minHeight: 0,
    minWidth: 0
  },
  toolkitRow: {
    borderTopColor: colors.line,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  toolkitAction: {
    borderColor: colors.line,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 8,
    paddingVertical: 5
  },
  toolkitActionText: {
    color: colors.kicker,
    fontFamily: fonts.uiMedium,
    fontSize: 11
  },
  savePlanRow: {
    borderTopColor: colors.line,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  savePlanButton: {
    alignSelf: "flex-start",
    backgroundColor: colors.brandDark,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 7
  },
  savePlanButtonText: {
    color: "#ffffff",
    fontFamily: fonts.uiSemibold,
    fontSize: 11
  },
  messageScroll: {
    flex: 1,
    minHeight: 0
  },
  messages: {
    flexGrow: 1,
    gap: 18,
    paddingHorizontal: 12,
    paddingVertical: 14
  },
  messagesEmpty: {
    flexGrow: 1,
    justifyContent: "center",
    minHeight: "100%" as unknown as number
  },
  emptyBlock: {
    gap: 8,
    paddingHorizontal: 4
  },
  emptyTitle: {
    color: colors.ink,
    fontFamily: fonts.uiSemibold,
    fontSize: 14
  },
  empty: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 12,
    lineHeight: 18
  },
  emptyCtaBlock: {
    gap: 8,
    marginTop: 6
  },
  emptyHint: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 11,
    lineHeight: 15
  },
  settingsButton: {
    alignSelf: "flex-start",
    backgroundColor: colors.brandDark,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 7
  },
  settingsButtonText: {
    color: "#ffffff",
    fontFamily: fonts.uiSemibold,
    fontSize: 11
  },
  turnAssistant: {
    gap: 8
  },
  turnUser: {
    alignItems: "flex-end",
    gap: 2
  },
  userSaid: {
    backgroundColor: colors.accentSoft,
    borderRadius: 12,
    maxWidth: "94%",
    paddingHorizontal: 11,
    paddingVertical: 8
  },
  turnSystem: {
    backgroundColor: colors.amberSoft,
    borderColor: colors.amber,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 7
  },
  systemNote: {
    color: colors.amber,
    fontFamily: fonts.ui,
    fontSize: 12,
    lineHeight: 17
  },
  working: {
    gap: 5
  },
  workingHeader: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderRadius: 5,
    flexDirection: "row",
    gap: 5,
    maxWidth: "100%",
    paddingVertical: 1
  },
  workingCaretSpace: {
    width: 10
  },
  workingLabel: {
    color: colors.muted,
    flexShrink: 1,
    fontFamily: fonts.uiMedium,
    fontSize: 11,
    lineHeight: 16
  },
  workingSteps: {
    borderLeftColor: colors.line,
    borderLeftWidth: StyleSheet.hairlineWidth,
    gap: 4,
    marginLeft: 4,
    paddingLeft: 10
  },
  turnActions: {
    flexDirection: "row"
  },
  turnActionsEnd: {
    justifyContent: "flex-end"
  },
  copyButton: {
    alignItems: "center",
    borderRadius: 5,
    flexDirection: "row",
    gap: 4,
    marginHorizontal: -4,
    opacity: 0.78,
    paddingHorizontal: 4,
    paddingVertical: 2
  },
  copyLabel: {
    color: colors.muted,
    fontFamily: fonts.uiMedium,
    fontSize: 10
  },
  copyLabelDone: {
    color: colors.green
  },
  emptyReply: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 12,
    fontStyle: "italic",
    lineHeight: 18
  },
  toolTraceLine: {
    color: colors.muted,
    fontFamily: fonts.uiMedium,
    fontSize: 11,
    lineHeight: 15
  },
  toolTraceError: {
    color: colors.amber,
    fontFamily: fonts.ui,
    fontSize: 10,
    lineHeight: 14
  },
  streamingCaret: {
    color: colors.kicker,
    fontFamily: fonts.ui,
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 1
  },
  composer: {
    borderTopColor: colors.line,
    borderTopWidth: 1,
    flexShrink: 0,
    gap: 6,
    marginTop: "auto",
    paddingBottom: 10,
    paddingHorizontal: 10,
    paddingTop: 8,
    position: "relative",
    // Keep mode/effort dock menus above message scroll; model menu uses position:fixed.
    zIndex: 40
  },
  pickerMenuDock: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 8,
    borderWidth: 1,
    bottom: "100%",
    left: 10,
    marginBottom: 6,
    maxHeight: 220,
    minWidth: 140,
    overflow: "hidden",
    position: "absolute",
    zIndex: 30
  },
  pickerOption: {
    paddingHorizontal: 12,
    paddingVertical: 9
  },
  pickerOptionText: {
    color: colors.ink,
    fontFamily: fonts.ui,
    fontSize: 12
  },
  composerShell: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 10,
    borderWidth: 1,
    gap: 4,
    paddingBottom: 6,
    paddingHorizontal: 8,
    paddingTop: 8
  },
  input: {
    color: colors.ink,
    fontFamily: fonts.ui,
    fontSize: 13,
    maxHeight: 140,
    minHeight: 44,
    paddingHorizontal: 4,
    paddingVertical: 2,
    textAlignVertical: "top",
    width: "100%"
  },
  composerToolbar: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between",
    minWidth: 0
  },
  pickerRow: {
    alignItems: "center",
    flexDirection: "row",
    flexShrink: 1,
    flexWrap: "wrap",
    gap: 4,
    minWidth: 0
  },
  pickerChip: {
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 5
  },
  pickerChipSelected: {
    backgroundColor: colors.accentSoft
  },
  pickerChipText: {
    color: colors.muted,
    fontFamily: fonts.uiMedium,
    fontSize: 11
  },
  pickerChipTextSelected: {
    color: colors.kicker
  },
  sendButton: {
    alignItems: "center",
    backgroundColor: colors.brandDark,
    borderRadius: 999,
    height: 24,
    justifyContent: "center",
    width: 24
  },
  pressed: {
    opacity: 0.72
  },
  disabled: {
    opacity: 0.42
  }
});
