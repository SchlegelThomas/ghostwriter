import { useEffect, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { ArrowUp } from "phosphor-react-native";
import type { AgentModelId } from "@ghostwriter/core";
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
  }, [messages.length]);

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
              <View
                key={message.id}
                style={[
                  styles.message,
                  message.role === "user" && styles.messageUser,
                  message.role === "system" && styles.messageSystem
                ]}
              >
                <Text style={styles.messageRole}>{message.role}</Text>
                {message.toolTraces !== undefined &&
                message.toolTraces.length > 0 ? (
                  <View style={styles.toolTraceList}>
                    {message.toolTraces.map((trace) => (
                      <View key={`${message.id}-${trace.toolName}-${trace.summary}`}>
                        <Text style={styles.toolTraceLine}>
                          {trace.title} · {trace.summary}
                        </Text>
                        {!trace.ok && trace.errorMessage !== undefined ? (
                          <Text style={styles.toolTraceError}>
                            {trace.errorMessage}
                          </Text>
                        ) : null}
                      </View>
                    ))}
                  </View>
                ) : null}
                <Text style={styles.messageBody}>{message.body}</Text>
              </View>
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
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12
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
  message: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 8,
    borderWidth: 1,
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 9
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
    fontSize: 9,
    letterSpacing: 0.6,
    textTransform: "uppercase"
  },
  toolTraceList: {
    gap: 3
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
  messageBody: {
    color: colors.ink,
    fontFamily: fonts.ui,
    fontSize: 13,
    lineHeight: 19
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
