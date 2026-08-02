import { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { ArrowUp, CaretDown, CaretRight, Check, ClockCounterClockwise, CopySimple, DotsThree, Microphone, Paperclip, Plus, X } from "phosphor-react-native";
import {
  CATALOG_MEMO_LENSES,
  type AgentModelId,
  type CatalogAgentId,
  type CatalogMemoLens,
  type SceneId,
  type WorkPlanV1
} from "@ghostwriter/core";
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
  WORKSPACE_AGENT_MODES,
  workspaceAgentEffortLabel,
  workspaceAgentModeLabel,
  workspaceAgentModelPickerOptions,
  type WorkspaceAgentEffort,
  type WorkspaceAgentMode,
  type WorkspaceAvailableModel
} from "./workspace-agent-prefs.js";
import {
  resolveAssistantFollowUpChips,
  resolveSystemFollowUpChips,
  type WorkspaceChatFollowUpChip
} from "./workspace-chat-follow-ups.js";
import type { WorkspaceChatPriorTurn } from "./workspace-chat-sessions.js";
import {
  AGENT_CATALOG_STAGES,
  agentCatalogStageLabel,
  findShippedCatalogAgentId,
  findShippedToolkitId,
  formatActiveCatalogPartnerSummary,
  type ActiveWorkspaceCatalogPartner,
  type AgentCatalogStageId,
  type AgentToolkitId
} from "./workspace-agent-toolkit.js";
import {
  composerAttachmentAcceptAttribute,
  readComposerAttachmentFile,
  resolveComposerSendMessage,
  shouldSubmitChatOnEnterKey,
  WORKSPACE_CHAT_MAX_ATTACHMENTS,
  type WorkspaceChatComposerKeyEvent,
  type WorkspaceChatPendingAttachment
} from "./workspace-chat-composer.js";
import type { SceneSaveNextActionChip } from "./scene-save-next-action-invite.js";
import { formatWorkspaceChatTranscript } from "./workspace-chat-transcript.js";
import {
  WorkPlanJobStrip,
  type WorkPlanJobStripAction,
  type WorkPlanJobStripJob
} from "./WorkPlanJobStrip.js";
import {
  WORK_PLAN_ACTION_CHIPS,
  WORK_PLAN_DISMISS_CHIP,
  WORK_PLAN_SUBMIT_CHIP
} from "./work-plan-submit.js";
import brandMark from "./GhostwriterMark.png";

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
  retryable?: boolean;
  /** In-thread action chips (next-step coach, etc.) — not composer chrome. */
  actionChips?: readonly SceneSaveNextActionChip[];
  nextActionSceneId?: SceneId;
  nextActionRevision?: number;
  /** Attached multi-job plan the writer can Submit from this turn. */
  workPlan?: WorkPlanV1;
  /** System notes: tap opens this scene in Draft. */
  openSceneOnPress?: SceneId;
}>;

export type WorkspaceChatSendInput = Readonly<{
  message: string;
  mode: WorkspaceAgentMode;
  model: AgentModelId;
  effort: WorkspaceAgentEffort;
  resendFromMessageId?: string;
  existingUserMessageId?: string;
  priorTurns?: readonly WorkspaceChatPriorTurn[];
  baseMessages?: readonly WorkspaceChatMessage[];
  attachments?: readonly WorkspaceChatPendingAttachment[];
}>;

export type WorkspaceChatSessionTab = Readonly<{
  id: string;
  title: string;
  /** When true, session is already an open tab — select instead of reopen. */
  open?: boolean;
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
  onCatalogAgentRun?(id: CatalogAgentId, lens?: CatalogMemoLens): void;
  /** Latest Plan-mode assistant reply available to save. */
  planOutlineText?: string;
  onSavePlanToPlans?(outlineText: string): void;
  chatSessions?: readonly WorkspaceChatSessionTab[];
  activeChatSessionId?: string;
  onChatSessionSelect?(sessionId: string): void;
  onNewChatSession?(): void;
  onRenameChatSession?(sessionId: string, title: string): void;
  onDismissChatSession?(sessionId: string): void;
  onReopenChatSession?(sessionId: string): void;
  chatHistorySessions?: readonly WorkspaceChatSessionTab[];
  onDeleteChatSession?(sessionId: string): void;
  chatStreaming?: boolean;
  onStop?(): void;
  onForkMessage?(messageId: string): void;
  onRegenerateMessage?(messageId: string): void;
  onRetryFailedTurn?(): void;
  onOpenScene?(sceneId?: SceneId): void;
  canOpenScene?: boolean;
  /** Scene id for manual next-steps coach (Agent selection chip). */
  manualNextActionSceneId?: SceneId;
  /** Docked in the secondary shell — collapse control lives in the shell header. */
  variant?: "floating" | "docked";
  dictating?: boolean;
  onToggleDictation?(): void;
  dictationAvailable?: boolean;
  onBindDictateAppend?(append: (text: string) => void): void;
  onMessageActionChip?(input: Readonly<{
    messageId: string;
    chipId: string;
    sceneId?: SceneId;
    revision?: number;
    catalogAgentId?: CatalogAgentId;
  }>): void;
  /** Manual next-steps coach (cheap model) — Ghostwriter mark in composer. */
  onManualNextActionCoach?(sceneId?: SceneId): void;
  nextActionCoachBusy?: boolean;
  /** Active work-plan job strip under session tabs. */
  workPlanJobSummary?: string;
  workPlanJobs?: readonly WorkPlanJobStripJob[];
  workPlanJobActions?: readonly WorkPlanJobStripAction[];
  onWorkPlanJobAction?(actionId: string): void;
  onOpenWorkPlanJob?(jobId: string): void;
  onDismissWorkPlanJobs?(): void;
}>;

type PickerKind = "mode" | "model" | null;

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
  onCatalogAgentRun,
  planOutlineText,
  onSavePlanToPlans,
  chatSessions = [],
  activeChatSessionId,
  onChatSessionSelect,
  onNewChatSession,
  onRenameChatSession,
  onDismissChatSession,
  onReopenChatSession,
  chatHistorySessions = [],
  onDeleteChatSession,
  chatStreaming = false,
  onStop,
  onForkMessage,
  onRegenerateMessage,
  onRetryFailedTurn,
  onOpenScene,
  canOpenScene = false,
  manualNextActionSceneId,
  variant = "floating",
  dictating = false,
  onToggleDictation,
  dictationAvailable = false,
  onBindDictateAppend,
  onMessageActionChip,
  onManualNextActionCoach,
  nextActionCoachBusy = false,
  workPlanJobSummary,
  workPlanJobs = [],
  workPlanJobActions = [],
  onWorkPlanJobAction,
  onOpenWorkPlanJob,
  onDismissWorkPlanJobs
}: WorkspaceChatPanelProps) {
  const [draft, setDraft] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<
    readonly WorkspaceChatPendingAttachment[]
  >([]);
  const [attachmentError, setAttachmentError] = useState<string>();
  const [sending, setSending] = useState(false);
  const [editUserMessageId, setEditUserMessageId] = useState<string | null>(
    null
  );
  const [openPicker, setOpenPicker] = useState<PickerKind>(null);
  const [openStageMenu, setOpenStageMenu] = useState<AgentCatalogStageId | null>(
    null
  );
  const [catalogLens, setCatalogLens] =
    useState<CatalogMemoLens>("save-the-cat");
  const [activeCatalogPartner, setActiveCatalogPartner] = useState<
    ActiveWorkspaceCatalogPartner | null
  >(null);
  const [historyMenuOpen, setHistoryMenuOpen] = useState(false);
  const [historyMenuSessionId, setHistoryMenuSessionId] = useState<string | null>(
    null
  );
  const [historySearchQuery, setHistorySearchQuery] = useState("");
  const [turnMenuId, setTurnMenuId] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (messages.length === 0) return;
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [messages]);

  useEffect(() => {
    onBindDictateAppend?.((text) => {
      if (text.length === 0) return;
      setDraft((current) => current + text);
    });
  }, [onBindDictateAppend]);

  useEffect(() => {
    if (mode !== "agent") {
      setActiveCatalogPartner(null);
      setOpenStageMenu(null);
    }
  }, [mode]);

  useEffect(() => {
    setActiveCatalogPartner((current) => {
      if (current === null || current.stageId !== "structure") return current;
      if (current.lens === catalogLens) return current;
      return { ...current, lens: catalogLens };
    });
  }, [catalogLens]);

  const composerDisabled = busy || sending || chatStreaming;

  if (!open) return null;

  async function send(): Promise<void> {
    const message = resolveComposerSendMessage(draft, pendingAttachments);
    if (
      message.length === 0 ||
      sending ||
      busy ||
      chatStreaming
    ) {
      return;
    }
    const attachmentsSnapshot = pendingAttachments;
    const editSnapshot = editUserMessageId;
    const draftSnapshot = draft;
    setSending(true);
    setOpenPicker(null);
    setOpenStageMenu(null);
    // Clear immediately on submit — do not wait for the stream to finish.
    setDraft("");
    setPendingAttachments([]);
    setAttachmentError(undefined);
    setEditUserMessageId(null);
    try {
      await onSend({
        message,
        mode,
        model,
        effort,
        ...(attachmentsSnapshot.length === 0
          ? {}
          : { attachments: attachmentsSnapshot }),
        ...(editSnapshot === null
          ? {}
          : { resendFromMessageId: editSnapshot })
      });
    } catch {
      setDraft(draftSnapshot);
      setPendingAttachments(attachmentsSnapshot);
      setEditUserMessageId(editSnapshot);
    } finally {
      setSending(false);
    }
  }

  async function pickAttachments(): Promise<void> {
    if (composerDisabled || typeof document === "undefined") return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = composerAttachmentAcceptAttribute();
    input.multiple = true;
    input.onchange = () => {
      void (async () => {
        const files =
          input.files === null ? [] : Array.from(input.files);
        if (files.length === 0) return;
        const remaining = WORKSPACE_CHAT_MAX_ATTACHMENTS - pendingAttachments.length;
        if (remaining <= 0) {
          setAttachmentError(`At most ${WORKSPACE_CHAT_MAX_ATTACHMENTS} attachments.`);
          return;
        }
        const selected = files.slice(0, remaining);
        const next: WorkspaceChatPendingAttachment[] = [...pendingAttachments];
        for (const file of selected) {
          const read = await readComposerAttachmentFile(file);
          if ("error" in read) {
            setAttachmentError(read.error);
            continue;
          }
          next.push(read);
        }
        setPendingAttachments(next);
        if (next.length > pendingAttachments.length) {
          setAttachmentError(undefined);
        }
      })();
    };
    input.click();
  }

  function removeAttachment(id: string): void {
    setPendingAttachments((current) =>
      current.filter((attachment) => attachment.id !== id)
    );
  }

  const canSend =
    !composerDisabled &&
    (draft.trim().length > 0 || pendingAttachments.length > 0);
  const lastUserMessageId = findLastUserMessageId(messages);
  const lastAssistantMessageId = findLastAssistantMessageId(messages);
  const assistantFollowUpChips = resolveAssistantFollowUpChips({
    mode,
    planOutlineText,
    canSavePlan:
      onSavePlanToPlans !== undefined &&
      planOutlineText !== undefined &&
      planOutlineText.trim().length > 0,
    canOpenScene: canOpenScene && onOpenScene !== undefined
  });
  const modelPickerOptions = workspaceAgentModelPickerOptions(
    availableModels,
    mode
  );
  const modelChipLabel = `${agentModelLabelWithProvider(model, availableModels)} · ${workspaceAgentEffortLabel(effort)}`;
  const activeSessionTitle = chatSessions.find(
    (session) => session.id === activeChatSessionId
  )?.title;
  const formattedTranscript = formatWorkspaceChatTranscript({
    messages,
    sessionTitle: activeSessionTitle,
    selectionSummary
  });
  const showSessionRow =
    chatSessions.length > 0 &&
    onChatSessionSelect !== undefined &&
    activeChatSessionId !== undefined;
  const showHistoryControl =
    onChatSessionSelect !== undefined && onReopenChatSession !== undefined;
  const filteredHistorySessions = useMemo(() => {
    const query = historySearchQuery.trim().toLowerCase();
    if (query.length === 0) return chatHistorySessions;
    return chatHistorySessions.filter((session) =>
      session.title.toLowerCase().includes(query)
    );
  }, [chatHistorySessions, historySearchQuery]);
  const uniqueChatSessionCount = useMemo(
    () =>
      new Set([
        ...chatHistorySessions.map((session) => session.id),
        ...chatSessions.map((session) => session.id)
      ]).size,
    [chatHistorySessions, chatSessions]
  );

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

      {showSessionRow ? (
        <View
          style={[
            styles.sessionRow,
            historyMenuOpen && styles.sessionRowMenuOpen
          ]}
        >
          <ScrollView
            contentContainerStyle={styles.sessionScrollContent}
            horizontal
            keyboardShouldPersistTaps="handled"
            showsHorizontalScrollIndicator={false}
            style={styles.sessionScroll}
          >
            {chatSessions.map((session) => {
              const active = session.id === activeChatSessionId;
              const canDismiss = onDismissChatSession !== undefined;
              return (
                <View key={session.id} style={styles.sessionTabWrap}>
                  <View
                    style={[
                      styles.sessionTab,
                      active && styles.sessionTabActive
                    ]}
                  >
                    <Pressable
                      accessibilityRole="tab"
                      accessibilityState={{ selected: active }}
                      onLongPress={
                        onRenameChatSession === undefined
                          ? undefined
                          : () => {
                              setHistoryMenuOpen(false);
                              promptRenameSession(session.title, (title) =>
                                onRenameChatSession(session.id, title)
                              );
                            }
                      }
                      onPress={() => {
                        setHistoryMenuOpen(false);
                        onChatSessionSelect(session.id);
                      }}
                      style={({ pressed }) => [
                        styles.sessionTabHit,
                        pressed && styles.pressed
                      ]}
                    >
                      <Text
                        numberOfLines={1}
                        style={[
                          styles.sessionTabText,
                          active && styles.sessionTabTextActive
                        ]}
                      >
                        {session.title}
                      </Text>
                    </Pressable>
                    {canDismiss ? (
                      <Pressable
                        accessibilityLabel={`Close ${session.title}`}
                        accessibilityRole="button"
                        onPress={() => {
                          setHistoryMenuOpen(false);
                          onDismissChatSession(session.id);
                        }}
                        style={({ pressed }) => [
                          styles.sessionDismissButton,
                          pressed && styles.pressed
                        ]}
                      >
                        <X
                          color={active ? colors.kicker : colors.muted}
                          size={12}
                          weight="bold"
                        />
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              );
            })}
          </ScrollView>
          <CopyTranscriptButton text={formattedTranscript} />
          {showHistoryControl ? (
            <View style={styles.historyMenuWrap}>
              <Pressable
                accessibilityLabel="Chat history"
                accessibilityRole="button"
                onPress={() => {
                  setHistoryMenuSessionId(null);
                  setHistoryMenuOpen((current) => {
                    if (current) setHistorySearchQuery("");
                    return !current;
                  });
                }}
                style={({ pressed }) => [
                  styles.newSessionButton,
                  pressed && styles.pressed
                ]}
              >
                <ClockCounterClockwise
                  color={colors.kicker}
                  size={13}
                  weight="regular"
                />
              </Pressable>
              {historyMenuOpen ? (
                <View style={styles.historyMenu}>
                  <TextInput
                    accessibilityLabel="Search chat history"
                    autoCapitalize="none"
                    autoCorrect={false}
                    onChangeText={setHistorySearchQuery}
                    placeholder="Search chats…"
                    placeholderTextColor={colors.muted}
                    style={styles.historyMenuSearch}
                    value={historySearchQuery}
                  />
                  {chatHistorySessions.length === 0 ? (
                    <Text style={styles.historyMenuEmptyText}>
                      No chats with content yet
                    </Text>
                  ) : filteredHistorySessions.length === 0 ? (
                    <Text style={styles.historyMenuEmptyText}>No matches</Text>
                  ) : (
                    filteredHistorySessions.map((session) => {
                      const actionsOpen = historyMenuSessionId === session.id;
                      const canRename = onRenameChatSession !== undefined;
                      const canDelete =
                        onDeleteChatSession !== undefined &&
                        uniqueChatSessionCount > 1;
                      return (
                        <View key={session.id}>
                          <View style={styles.historyMenuRow}>
                            <Pressable
                              accessibilityRole="menuitem"
                              onPress={() => {
                                setHistoryMenuOpen(false);
                                setHistoryMenuSessionId(null);
                                setHistorySearchQuery("");
                                if (session.open) {
                                  onChatSessionSelect?.(session.id);
                                } else {
                                  onReopenChatSession(session.id);
                                }
                              }}
                              style={({ pressed }) => [
                                styles.historyMenuItem,
                                pressed && styles.pressed
                              ]}
                            >
                              <Text
                                numberOfLines={1}
                                style={styles.historyMenuItemText}
                              >
                                {session.title}
                              </Text>
                            </Pressable>
                            {canRename || canDelete ? (
                              <Pressable
                                accessibilityLabel={`History actions for ${session.title}`}
                                accessibilityRole="button"
                                onPress={() =>
                                  setHistoryMenuSessionId((current) =>
                                    current === session.id ? null : session.id
                                  )
                                }
                                style={({ pressed }) => [
                                  styles.sessionMenuButton,
                                  pressed && styles.pressed
                                ]}
                              >
                                <DotsThree
                                  color={colors.muted}
                                  size={12}
                                  weight="bold"
                                />
                              </Pressable>
                            ) : null}
                          </View>
                          {actionsOpen ? (
                            <View style={styles.historyMenuActions}>
                              {canRename ? (
                                <Pressable
                                  accessibilityRole="menuitem"
                                  onPress={() => {
                                    setHistoryMenuSessionId(null);
                                    promptRenameSession(session.title, (title) =>
                                      onRenameChatSession?.(session.id, title)
                                    );
                                  }}
                                  style={({ pressed }) => [
                                    styles.sessionMenuItem,
                                    pressed && styles.pressed
                                  ]}
                                >
                                  <Text style={styles.sessionMenuItemText}>
                                    Rename
                                  </Text>
                                </Pressable>
                              ) : null}
                              {canDelete ? (
                                <Pressable
                                  accessibilityRole="menuitem"
                                  onPress={() => {
                                    setHistoryMenuSessionId(null);
                                    onDeleteChatSession?.(session.id);
                                  }}
                                  style={({ pressed }) => [
                                    styles.sessionMenuItem,
                                    pressed && styles.pressed
                                  ]}
                                >
                                  <Text style={styles.sessionMenuItemText}>
                                    Delete
                                  </Text>
                                </Pressable>
                              ) : null}
                            </View>
                          ) : null}
                        </View>
                      );
                    })
                  )}
                </View>
              ) : null}
            </View>
          ) : null}
          {onNewChatSession !== undefined ? (
            <Pressable
              accessibilityLabel="New chat"
              accessibilityRole="button"
              onPress={() => {
                setHistoryMenuOpen(false);
                onNewChatSession();
              }}
              style={({ pressed }) => [
                styles.newSessionButton,
                pressed && styles.pressed
              ]}
            >
              <Plus color={colors.kicker} size={13} weight="bold" />
            </Pressable>
          ) : null}
        </View>
      ) : messages.length > 0 ? (
        <View style={styles.sessionActionsRow}>
          <CopyTranscriptButton text={formattedTranscript} />
        </View>
      ) : null}

      {workPlanJobs.length > 0 ? (
        <WorkPlanJobStrip
          actions={workPlanJobActions}
          jobs={workPlanJobs}
          onAction={onWorkPlanJobAction}
          onDismiss={onDismissWorkPlanJobs}
          onOpenJob={onOpenWorkPlanJob}
          summary={workPlanJobSummary ?? "Work plan"}
        />
      ) : null}

      {selectionSummary !== undefined && selectionSummary.trim().length > 0 ? (
        onOpenScene !== undefined && canOpenScene ? (
          <Pressable
            accessibilityLabel="Open selected scene"
            accessibilityRole="button"
            onPress={() => onOpenScene?.(manualNextActionSceneId)}
            style={({ pressed }) => [
              styles.selectionChip,
              styles.selectionChipPressable,
              pressed && styles.pressed
            ]}
          >
            <Text numberOfLines={1} style={styles.selectionChipText}>
              {selectionSummary}
            </Text>
          </Pressable>
        ) : (
          <View style={styles.selectionChip}>
            <Text numberOfLines={1} style={styles.selectionChipText}>
              {selectionSummary}
            </Text>
          </View>
        )
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
            messages.map((message, index) => (
              <ChatTurn
                assistantFollowUpChips={
                  index === messages.length - 1 &&
                  message.role === "assistant" &&
                  message.streaming !== true
                    ? assistantFollowUpChips
                    : undefined
                }
                canEditResend={
                  message.role === "user" && message.id === lastUserMessageId
                }
                canFork={onForkMessage !== undefined}
                canRegenerate={
                  message.role === "assistant" &&
                  message.id === lastAssistantMessageId &&
                  message.streaming !== true
                }
                key={message.id}
                menuOpen={turnMenuId === message.id}
                message={message}
                onEditResend={
                  message.role === "user" &&
                  message.id === lastUserMessageId
                    ? () => {
                        setTurnMenuId(null);
                        setEditUserMessageId(message.id);
                        setDraft(message.body);
                      }
                    : undefined
                }
                onFollowUpChip={(chip) => {
                  if (chip.id === "save-plan" && planOutlineText !== undefined) {
                    onSavePlanToPlans?.(planOutlineText);
                    return;
                  }
                  if (chip.id === "open-scene") {
                    onOpenScene?.(message.nextActionSceneId);
                    return;
                  }
                  if (chip.id === "retry") {
                    onRetryFailedTurn?.();
                  }
                }}
                onMessageActionChip={
                  onMessageActionChip === undefined
                    ? undefined
                    : (chip) =>
                        onMessageActionChip({
                          messageId: message.id,
                          chipId: chip.id,
                          ...(message.nextActionSceneId === undefined
                            ? {}
                            : { sceneId: message.nextActionSceneId }),
                          ...(message.nextActionRevision === undefined
                            ? {}
                            : { revision: message.nextActionRevision }),
                          ...(chip.catalogAgentId === undefined
                            ? {}
                            : { catalogAgentId: chip.catalogAgentId })
                        })
                }
                onOpenScene={onOpenScene}
                onFork={
                  onForkMessage === undefined
                    ? undefined
                    : () => {
                        setTurnMenuId(null);
                        onForkMessage(message.id);
                      }
                }
                onRegenerate={
                  onRegenerateMessage === undefined
                    ? undefined
                    : () => {
                        setTurnMenuId(null);
                        onRegenerateMessage(message.id);
                      }
                }
                onToggleMenu={() =>
                  setTurnMenuId((current) =>
                    current === message.id ? null : message.id
                  )
                }
                systemFollowUpChips={
                  message.role === "system"
                    ? resolveSystemFollowUpChips(message.retryable === true)
                    : undefined
                }
              />
            ))
          )}
        </ScrollView>
      </View>

      {mode === "agent" &&
      (onToolkitAction !== undefined || onCatalogAgentRun !== undefined) ? (
        <View style={styles.toolkitSection}>
          {openStageMenu !== null ? (
            <View style={styles.toolkitMenuDock}>
              <ScrollView
                keyboardShouldPersistTaps="handled"
                nestedScrollEnabled
                style={styles.toolkitMenuScroll}
              >
                <View style={styles.toolkitMenuScrollContent}>
                  {openStageMenu === "structure" ? (
                    <View style={styles.toolkitLensBlock}>
                      <Text style={styles.toolkitLensLabel}>Structure lens</Text>
                      <View style={styles.toolkitLensRow}>
                        {CATALOG_MEMO_LENSES.map((lens) => (
                          <Pressable
                            accessibilityRole="button"
                            accessibilityState={{ selected: catalogLens === lens }}
                            key={lens}
                            onPress={() => setCatalogLens(lens)}
                            style={[
                              styles.toolkitLensChip,
                              catalogLens === lens && styles.toolkitLensChipSelected
                            ]}
                          >
                            <Text style={styles.toolkitLensChipText}>
                              {lens.replaceAll("-", " ")}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                    </View>
                  ) : null}
                  {AGENT_CATALOG_STAGES.find(
                    (stage) => stage.id === openStageMenu
                  )?.agents.map((entry, index, agents) => {
                    const shipped = entry.status === "shipped";
                    const toolkitId = findShippedToolkitId(entry);
                    const catalogAgentId = findShippedCatalogAgentId(entry);
                    const last = index === agents.length - 1;
                    return (
                      <Pressable
                        accessibilityHint={entry.blurb}
                        accessibilityLabel={entry.label}
                        accessibilityRole="menuitem"
                        accessibilityState={{ disabled: !shipped }}
                        disabled={!shipped}
                        key={entry.id}
                        onPress={() => {
                          if (toolkitId !== undefined) {
                            onToolkitAction?.(toolkitId);
                          } else if (catalogAgentId !== undefined) {
                            onCatalogAgentRun?.(
                              catalogAgentId,
                              openStageMenu === "structure"
                                ? catalogLens
                                : undefined
                            );
                          } else {
                            return;
                          }
                          setActiveCatalogPartner({
                            entryId: entry.id,
                            label: entry.label,
                            stageId: openStageMenu,
                            ...(openStageMenu === "structure"
                              ? { lens: catalogLens }
                              : {})
                          });
                          setOpenStageMenu(null);
                        }}
                        style={({ pressed }) => [
                          styles.toolkitMenuItem,
                          last && styles.toolkitMenuItemLast,
                          !shipped && styles.toolkitMenuItemDisabled,
                          activeCatalogPartner?.entryId === entry.id &&
                            styles.toolkitMenuItemActive,
                          pressed && shipped && styles.pressed
                        ]}
                      >
                        <Text
                          style={[
                            styles.toolkitMenuItemLabel,
                            !shipped && styles.toolkitMenuItemLabelDisabled,
                            activeCatalogPartner?.entryId === entry.id &&
                              styles.toolkitMenuItemLabelActive
                          ]}
                        >
                          {entry.label}
                        </Text>
                        <Text
                          style={[
                            styles.toolkitMenuItemBlurb,
                            !shipped && styles.toolkitMenuItemBlurbDisabled
                          ]}
                        >
                          {shipped ? entry.blurb : "Coming soon"}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </ScrollView>
            </View>
          ) : null}
          <ScrollView
            contentContainerStyle={styles.toolkitRowContent}
            horizontal
            keyboardShouldPersistTaps="handled"
            showsHorizontalScrollIndicator={false}
            style={styles.toolkitRow}
          >
            {AGENT_CATALOG_STAGES.map((stage) => {
              const stageActive =
                openStageMenu === stage.id ||
                activeCatalogPartner?.stageId === stage.id;
              return (
                <Pressable
                  accessibilityLabel={
                    activeCatalogPartner?.stageId === stage.id
                      ? `${stage.label}, working with ${activeCatalogPartner.label}`
                      : stage.label
                  }
                  accessibilityRole="button"
                  accessibilityState={{
                    expanded: openStageMenu === stage.id,
                    selected: activeCatalogPartner?.stageId === stage.id
                  }}
                  key={stage.id}
                  onPress={() => {
                    setOpenPicker(null);
                    setOpenStageMenu((current) =>
                      current === stage.id ? null : stage.id
                    );
                  }}
                  style={({ pressed }) => [
                    styles.toolkitAction,
                    stageActive && styles.toolkitActionSelected,
                    pressed && styles.pressed
                  ]}
                >
                  <Text
                    style={[
                      styles.toolkitActionText,
                      stageActive && styles.toolkitActionTextSelected
                    ]}
                  >
                    {agentCatalogStageLabel(stage.id)}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
          {activeCatalogPartner === null ? null : (
            <View
              accessibilityLabel={`Working with ${formatActiveCatalogPartnerSummary(activeCatalogPartner)}`}
              style={styles.activePartnerBanner}
            >
              <View style={styles.activePartnerCopy}>
                <Text style={styles.activePartnerEyebrow}>Working with</Text>
                <Text numberOfLines={2} style={styles.activePartnerLabel}>
                  {formatActiveCatalogPartnerSummary(activeCatalogPartner)}
                </Text>
              </View>
              <Pressable
                accessibilityLabel="Clear active writing agent"
                accessibilityRole="button"
                onPress={() => setActiveCatalogPartner(null)}
                style={({ pressed }) => [
                  styles.activePartnerClear,
                  pressed && styles.pressed
                ]}
              >
                <X color={colors.muted} size={12} weight="bold" />
              </Pressable>
            </View>
          )}
        </View>
      ) : null}

      <View style={styles.composer}>
        {openPicker === "model" ? (
          <AgentModelPickerMenu
            effort={effort}
            onApplyModelEffort={(next, nextEffort) => {
              if (next !== model) onModelChange(next);
              onEffortChange(nextEffort);
            }}
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
        ) : openPicker === "mode" ? (
          <View style={styles.pickerMenuDock}>
            {WORKSPACE_AGENT_MODES.map((value) => (
              <Pressable
                accessibilityRole="menuitem"
                key={value}
                onPress={() => {
                  onModeChange(value);
                  setOpenPicker(null);
                }}
                style={({ pressed }) => [
                  styles.pickerOption,
                  pressed && styles.pressed
                ]}
              >
                <Text style={styles.pickerOptionText}>
                  {workspaceAgentModeLabel(value)}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        <View style={styles.composerShell}>
          {pendingAttachments.length > 0 ? (
            <View style={styles.attachmentRow}>
              {pendingAttachments.map((attachment) => (
                <View key={attachment.id} style={styles.attachmentChip}>
                  <Text numberOfLines={1} style={styles.attachmentChipText}>
                    {attachment.kind === "image" ? "Image · " : "Video · "}
                    {attachment.name}
                  </Text>
                  <Pressable
                    accessibilityLabel={`Remove ${attachment.name}`}
                    accessibilityRole="button"
                    disabled={composerDisabled}
                    onPress={() => removeAttachment(attachment.id)}
                    style={({ pressed }) => [
                      styles.attachmentRemove,
                      pressed && styles.pressed
                    ]}
                  >
                    <X color={colors.muted} size={10} weight="bold" />
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}
          {attachmentError === undefined ? null : (
            <Text style={styles.attachmentError}>{attachmentError}</Text>
          )}
          <TextInput
            accessibilityHint="Enter to send, Shift+Enter for newline"
            accessibilityLabel="Chat message"
            editable={!composerDisabled}
            multiline
            onChangeText={setDraft}
            onKeyPress={(event) => {
              const keyEvent = event as unknown as WorkspaceChatComposerKeyEvent & {
                preventDefault(): void;
              };
              if (!shouldSubmitChatOnEnterKey(keyEvent)) return;
              keyEvent.preventDefault();
              void send();
            }}
            onSubmitEditing={() => void send()}
            placeholder="Ask about this project…"
            placeholderTextColor={colors.muted}
            style={styles.input}
            value={draft}
          />
          <View style={styles.composerToolbar}>
            <View style={styles.pickerRow}>
              {onManualNextActionCoach === undefined ? null : (
                <Pressable
                  accessibilityHint="Ask Ghostwriter for next-step suggestions on the open scene"
                  accessibilityLabel="Suggest next steps"
                  accessibilityRole="button"
                  accessibilityState={{ busy: nextActionCoachBusy }}
                  disabled={composerDisabled || nextActionCoachBusy}
                  onPress={() => onManualNextActionCoach?.(manualNextActionSceneId)}
                  style={({ pressed }) => [
                    styles.nextActionMarkButton,
                    pressed && styles.pressed,
                    (composerDisabled || nextActionCoachBusy) && styles.disabled
                  ]}
                  {...({
                    title: "Suggest next steps for this scene"
                  } as Record<string, string>)}
                >
                  <View style={styles.nextActionMarkFrame}>
                    <Image
                      accessibilityElementsHidden
                      importantForAccessibility="no-hide-descendants"
                      resizeMode="contain"
                      source={brandMark}
                      style={styles.nextActionMarkImage}
                    />
                  </View>
                </Pressable>
              )}
              {typeof document !== "undefined" ? (
                <Pressable
                  accessibilityLabel="Attach image or video"
                  accessibilityRole="button"
                  disabled={
                    composerDisabled ||
                    pendingAttachments.length >= WORKSPACE_CHAT_MAX_ATTACHMENTS
                  }
                  onPress={() => void pickAttachments()}
                  style={({ pressed }) => [
                    styles.iconToolButton,
                    pressed && styles.pressed,
                    composerDisabled && styles.disabled
                  ]}
                >
                  <Paperclip color={colors.muted} size={14} weight="regular" />
                </Pressable>
              ) : null}
              {onToggleDictation === undefined ? null : (
                <Pressable
                  accessibilityLabel={dictating ? "Stop dictation" : "Dictate"}
                  accessibilityRole="button"
                  accessibilityState={{
                    selected: dictating,
                    disabled: !dictationAvailable || composerDisabled
                  }}
                  disabled={!dictationAvailable || composerDisabled}
                  onPress={onToggleDictation}
                  style={({ pressed }) => [
                    styles.iconToolButton,
                    dictating && styles.iconToolButtonActive,
                    pressed && styles.pressed,
                    (!dictationAvailable || composerDisabled) && styles.disabled
                  ]}
                >
                  <Microphone
                    color={dictating ? colors.kicker : colors.muted}
                    size={14}
                    weight={dictating ? "fill" : "regular"}
                  />
                </Pressable>
              )}
              <ComposerChip
                accessibilityLabel="Agent mode"
                disabled={composerDisabled}
                label={workspaceAgentModeLabel(mode)}
                onPress={() => {
                  setOpenStageMenu(null);
                  setOpenPicker((current) =>
                    current === "mode" ? null : "mode"
                  );
                }}
                selected={openPicker === "mode"}
              />
            </View>
            <View style={styles.composerToolbarEnd}>
              <ComposerChip
                accessibilityLabel="Agent model and effort"
                disabled={composerDisabled || modelPickerOptions.length === 0}
                label={modelPickerOptions.length === 0 ? "Model" : modelChipLabel}
                onPress={() => {
                  setOpenStageMenu(null);
                  setOpenPicker((current) =>
                    current === "model" ? null : "model"
                  );
                }}
                selected={openPicker === "model"}
              />
            <Pressable
              accessibilityLabel={chatStreaming ? "Stop" : "Send"}
              accessibilityRole="button"
              disabled={chatStreaming ? onStop === undefined : !canSend}
              onPress={() => {
                if (chatStreaming) {
                  onStop?.();
                  return;
                }
                void send();
              }}
              style={({ pressed }) => [
                styles.sendButton,
                chatStreaming && styles.stopButton,
                pressed && styles.pressed,
                (chatStreaming ? onStop === undefined : !canSend) && styles.disabled
              ]}
            >
              {chatStreaming ? (
                <Text style={styles.stopButtonText}>■</Text>
              ) : (
                <ArrowUp color="#ffffff" size={13} weight="thin" />
              )}
            </Pressable>
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

function findLastUserMessageId(
  messages: readonly WorkspaceChatMessage[]
): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user") return message.id;
  }
  return undefined;
}

function findLastAssistantMessageId(
  messages: readonly WorkspaceChatMessage[]
): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "assistant") return message.id;
  }
  return undefined;
}

function promptRenameSession(
  currentTitle: string,
  onRename: (title: string) => void
): void {
  if (typeof globalThis.prompt !== "function") return;
  const next = globalThis.prompt("Rename chat", currentTitle);
  if (next === null) return;
  const trimmed = next.trim();
  if (trimmed.length === 0) return;
  onRename(trimmed);
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const NO_TRACES: readonly WorkspaceChatToolTrace[] = Object.freeze([]);

/** One turn of the conversation: the writer's words, or the agent's reply. */
function ChatTurn({
  assistantFollowUpChips,
  canEditResend,
  canFork,
  canRegenerate,
  menuOpen,
  message,
  onEditResend,
  onFollowUpChip,
  onMessageActionChip,
  onOpenScene,
  onFork,
  onRegenerate,
  onToggleMenu,
  systemFollowUpChips
}: Readonly<{
  assistantFollowUpChips?: readonly WorkspaceChatFollowUpChip[];
  canEditResend: boolean;
  canFork: boolean;
  canRegenerate: boolean;
  menuOpen: boolean;
  message: WorkspaceChatMessage;
  onEditResend?(): void;
  onFollowUpChip?(chip: WorkspaceChatFollowUpChip): void;
  onMessageActionChip?(chip: SceneSaveNextActionChip): void;
  onOpenScene?(sceneId?: SceneId): void;
  onFork?(): void;
  onRegenerate?(): void;
  onToggleMenu?(): void;
  systemFollowUpChips?: readonly WorkspaceChatFollowUpChip[];
}>) {
  const streaming = message.streaming === true;
  const traces = message.toolTraces ?? NO_TRACES;
  const hasBody = message.body.trim().length > 0;
  const showTurnMenu =
    canFork ||
    (canEditResend && onEditResend !== undefined) ||
    (canRegenerate && onRegenerate !== undefined);

  if (message.role === "user") {
    return (
      <View style={styles.turnUser}>
        <View style={styles.userSaid}>
          <AgentChatMarkdown text={message.body} tone="user" />
        </View>
        <View style={[styles.turnActions, styles.turnActionsEnd]}>
          {showTurnMenu ? (
            <TurnActionMenu
              canEditResend={canEditResend}
              canFork={canFork}
              canRegenerate={false}
              menuOpen={menuOpen}
              onEditResend={onEditResend}
              onFork={onFork}
              onToggleMenu={onToggleMenu}
            />
          ) : null}
          <CopyMessageButton align="end" compact text={message.body} />
        </View>
      </View>
    );
  }

  if (message.role === "system") {
    const chips = systemFollowUpChips ?? NO_CHIPS;
    const actionChips = resolveMessageActionChips(message);
    const openSceneId = message.openSceneOnPress;
    const canOpenFromNote =
      openSceneId !== undefined && onOpenScene !== undefined;
    const note = (
      <Text
        style={[styles.systemNote, canOpenFromNote && styles.systemNoteLink]}
      >
        {message.body}
      </Text>
    );
    return (
      <View style={styles.turnSystem}>
        {canOpenFromNote ? (
          <Pressable
            accessibilityHint="Opens the scene draft"
            accessibilityLabel={message.body}
            accessibilityRole="link"
            onPress={() => onOpenScene?.(openSceneId)}
            style={({ pressed }) => [pressed && styles.pressed]}
          >
            {note}
          </Pressable>
        ) : (
          note
        )}
        {chips.length > 0 ? (
          <FollowUpChips chips={chips} onPress={onFollowUpChip} />
        ) : null}
        {actionChips.length > 0 ? (
          <MessageActionChips chips={actionChips} onPress={onMessageActionChip} />
        ) : null}
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
  const chips = assistantFollowUpChips ?? NO_CHIPS;
  const actionChips = resolveMessageActionChips(message);

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
      {streaming ? null : (
        <View style={styles.turnActions}>
          {showTurnMenu ? (
            <TurnActionMenu
              canEditResend={false}
              canFork={canFork}
              canRegenerate={canRegenerate}
              menuOpen={menuOpen}
              onFork={onFork}
              onRegenerate={onRegenerate}
              onToggleMenu={onToggleMenu}
            />
          ) : null}
          <CopyMessageButton align="start" text={message.body} />
        </View>
      )}
      {!streaming && chips.length > 0 ? (
        <FollowUpChips chips={chips} onPress={onFollowUpChip} />
      ) : null}
      {!streaming && actionChips.length > 0 ? (
        <MessageActionChips chips={actionChips} onPress={onMessageActionChip} />
      ) : null}
    </View>
  );
}

const NO_CHIPS: readonly WorkspaceChatFollowUpChip[] = Object.freeze([]);
const NO_ACTION_CHIPS: readonly SceneSaveNextActionChip[] = Object.freeze([]);

function resolveMessageActionChips(
  message: WorkspaceChatMessage
): readonly SceneSaveNextActionChip[] {
  const base = message.actionChips ?? NO_ACTION_CHIPS;
  if (message.workPlan === undefined) return base;
  const hasSubmit = base.some((chip) => chip.id === "submit-work-plan");
  if (hasSubmit) return base;
  if (base.length === 0) return WORK_PLAN_ACTION_CHIPS;
  const withoutDismiss = base.filter(
    (chip) => chip.id !== "dismiss-next-action" && chip.id !== "dismiss-work-plan"
  );
  return Object.freeze([
    ...withoutDismiss,
    WORK_PLAN_SUBMIT_CHIP,
    WORK_PLAN_DISMISS_CHIP
  ]);
}

function MessageActionChips({
  chips,
  onPress
}: Readonly<{
  chips: readonly SceneSaveNextActionChip[];
  onPress?(chip: SceneSaveNextActionChip): void;
}>) {
  if (chips.length === 0) return null;
  return (
    <View style={styles.followUpRow}>
      {chips.map((chip) => (
        <Pressable
          accessibilityRole="button"
          key={chip.id}
          onPress={() => onPress?.(chip)}
          style={({ pressed }) => [
            styles.followUpChip,
            (chip.id === "start-next-action-coach" ||
              chip.id === "submit-work-plan") &&
              styles.messageActionChipPrimary,
            pressed && styles.pressed
          ]}
        >
          <Text
            style={[
              styles.followUpChipText,
              (chip.id === "start-next-action-coach" ||
                chip.id === "submit-work-plan") &&
                styles.messageActionChipPrimaryText
            ]}
          >
            {chip.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function FollowUpChips({
  chips,
  onPress
}: Readonly<{
  chips: readonly WorkspaceChatFollowUpChip[];
  onPress?(chip: WorkspaceChatFollowUpChip): void;
}>) {
  if (onPress === undefined) return null;
  return (
    <View style={styles.followUpRow}>
      {chips.map((chip) => (
        <Pressable
          accessibilityRole="button"
          key={chip.id}
          onPress={() => onPress(chip)}
          style={({ pressed }) => [
            styles.followUpChip,
            pressed && styles.pressed
          ]}
        >
          <Text style={styles.followUpChipText}>{chip.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function TurnActionMenu({
  canEditResend,
  canFork,
  canRegenerate,
  menuOpen,
  onEditResend,
  onFork,
  onRegenerate,
  onToggleMenu
}: Readonly<{
  canEditResend: boolean;
  canFork: boolean;
  canRegenerate: boolean;
  menuOpen: boolean;
  onEditResend?(): void;
  onFork?(): void;
  onRegenerate?(): void;
  onToggleMenu?(): void;
}>) {
  if (onToggleMenu === undefined) return null;
  return (
    <View style={styles.turnMenuWrap}>
      <Pressable
        accessibilityLabel="Message actions"
        accessibilityRole="button"
        onPress={onToggleMenu}
        style={({ pressed }) => [styles.turnMenuButton, pressed && styles.pressed]}
      >
        <DotsThree color={colors.muted} size={12} weight="bold" />
      </Pressable>
      {menuOpen ? (
        <View style={styles.turnMenu}>
          {canFork && onFork !== undefined ? (
            <Pressable
              accessibilityRole="menuitem"
              onPress={onFork}
              style={({ pressed }) => [
                styles.turnMenuItem,
                pressed && styles.pressed
              ]}
            >
              <Text style={styles.turnMenuItemText}>Fork</Text>
            </Pressable>
          ) : null}
          {canRegenerate && onRegenerate !== undefined ? (
            <Pressable
              accessibilityRole="menuitem"
              onPress={onRegenerate}
              style={({ pressed }) => [
                styles.turnMenuItem,
                pressed && styles.pressed
              ]}
            >
              <Text style={styles.turnMenuItemText}>Regenerate</Text>
            </Pressable>
          ) : null}
          {canEditResend && onEditResend !== undefined ? (
            <Pressable
              accessibilityRole="menuitem"
              onPress={onEditResend}
              style={({ pressed }) => [
                styles.turnMenuItem,
                pressed && styles.pressed
              ]}
            >
              <Text style={styles.turnMenuItemText}>Edit & resend</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
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

function CopyTranscriptButton({ text }: Readonly<{ text: string }>) {
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
    <Pressable
      accessibilityLabel={
        copied ? "Copied chat transcript" : "Copy chat transcript"
      }
      accessibilityRole="button"
      onPress={() => void copy()}
      style={({ pressed }) => [
        styles.newSessionButton,
        pressed && styles.pressed
      ]}
    >
      {copied ? (
        <Check color={colors.green} size={13} weight="bold" />
      ) : (
        <CopySimple color={colors.kicker} size={13} weight="regular" />
      )}
    </Pressable>
  );
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
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 6,
    borderWidth: 1,
    flexShrink: 0,
    marginHorizontal: 10,
    marginTop: 8,
    maxWidth: "92%",
    paddingHorizontal: 8,
    paddingVertical: 5
  },
  selectionChipPressable: {
    borderColor: colors.kicker
  },
  selectionChipText: {
    color: colors.ink,
    fontFamily: fonts.uiSemibold,
    fontSize: 10
  },
  sessionRow: {
    alignItems: "flex-end",
    backgroundColor: colors.wash,
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    flexDirection: "row",
    flexShrink: 0,
    gap: 2,
    paddingLeft: 8,
    paddingRight: 6,
    paddingTop: 6
  },
  sessionRowMenuOpen: {
    overflow: "visible",
    zIndex: 40
  },
  sessionScroll: {
    flex: 1,
    minWidth: 0
  },
  sessionScrollContent: {
    alignItems: "flex-end",
    gap: 2,
    paddingRight: 4
  },
  sessionTabWrap: {
    position: "relative"
  },
  sessionTab: {
    alignItems: "center",
    backgroundColor: "transparent",
    borderBottomWidth: 0,
    borderColor: "transparent",
    borderTopLeftRadius: 11,
    borderTopRightRadius: 3,
    borderWidth: 1,
    flexDirection: "row",
    marginBottom: -1,
    maxWidth: 180,
    minHeight: 30,
    paddingLeft: 10,
    paddingRight: 4
  },
  sessionTabActive: {
    backgroundColor: colors.paper,
    borderBottomColor: colors.paper,
    borderColor: colors.brandRuleSoft,
    // Soft page-leaf lift — asymmetric corners + quiet edge shadow.
    elevation: 2,
    shadowColor: "#1c1610",
    shadowOffset: { width: 2, height: -1 },
    shadowOpacity: 0.1,
    shadowRadius: 5,
    ...({
      boxShadow:
        "1px -1px 0 rgba(179, 169, 157, 0.4), 3px 0 10px rgba(28, 22, 16, 0.07)"
    } as object)
  },
  sessionTabHit: {
    flexShrink: 1,
    maxWidth: 148,
    paddingVertical: 7
  },
  sessionTabText: {
    color: colors.muted,
    fontFamily: fonts.uiMedium,
    fontSize: 11
  },
  sessionTabTextActive: {
    color: colors.ink,
    fontFamily: fonts.uiSemibold
  },
  sessionMenuButton: {
    alignItems: "center",
    borderRadius: 4,
    height: 22,
    justifyContent: "center",
    width: 20
  },
  sessionDismissButton: {
    alignItems: "center",
    borderRadius: 4,
    height: 22,
    justifyContent: "center",
    width: 20
  },
  historyMenuWrap: {
    position: "relative",
    zIndex: 50
  },
  historyMenu: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 8,
    borderWidth: 1,
    elevation: 8,
    maxHeight: 260,
    minWidth: 200,
    position: "absolute",
    right: 0,
    shadowColor: "#1c1610",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    top: "100%",
    zIndex: 100
  },
  historyMenuSearch: {
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    color: colors.ink,
    fontFamily: fonts.ui,
    fontSize: 11,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  historyMenuEmptyText: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 11,
    paddingHorizontal: 10,
    paddingVertical: 10
  },
  historyMenuRow: {
    alignItems: "center",
    flexDirection: "row"
  },
  historyMenuItem: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  historyMenuItemText: {
    color: colors.ink,
    fontFamily: fonts.ui,
    fontSize: 11
  },
  historyMenuActions: {
    borderTopColor: colors.line,
    borderTopWidth: 1
  },
  sessionMenu: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 8,
    borderWidth: 1,
    left: 0,
    minWidth: 96,
    position: "absolute",
    top: "100%",
    zIndex: 20
  },
  sessionMenuItem: {
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  sessionMenuItemText: {
    color: colors.ink,
    fontFamily: fonts.ui,
    fontSize: 11
  },
  newSessionButton: {
    alignItems: "center",
    alignSelf: "center",
    borderRadius: 6,
    height: 26,
    justifyContent: "center",
    marginBottom: 2,
    width: 26
  },
  sessionActionsRow: {
    alignItems: "flex-end",
    backgroundColor: colors.wash,
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    flexDirection: "row",
    flexShrink: 0,
    gap: 2,
    justifyContent: "flex-end",
    paddingHorizontal: 6,
    paddingTop: 6
  },
  messageArea: {
    backgroundColor: colors.wash,
    flex: 1,
    flexGrow: 1,
    minHeight: 0,
    minWidth: 0
  },
  toolkitSection: {
    flexShrink: 0,
    position: "relative",
    zIndex: 35
  },
  toolkitMenuDock: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 8,
    borderWidth: 1,
    bottom: "100%",
    left: 8,
    marginBottom: 4,
    maxHeight: 220,
    minWidth: 200,
    overflow: "hidden",
    position: "absolute",
    right: 8,
    zIndex: 30
  },
  toolkitMenuScroll: {
    maxHeight: 220
  },
  toolkitMenuScrollContent: {
    paddingBottom: 4,
    paddingTop: 2
  },
  toolkitLensBlock: {
    borderBottomColor: colors.line,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  toolkitLensLabel: {
    color: colors.muted,
    fontFamily: fonts.uiMedium,
    fontSize: 10,
    textTransform: "uppercase"
  },
  toolkitLensRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4
  },
  toolkitLensChip: {
    borderColor: colors.line,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 6,
    paddingVertical: 3
  },
  toolkitLensChipSelected: {
    borderColor: colors.kicker
  },
  toolkitLensChipText: {
    color: colors.ink,
    fontFamily: fonts.ui,
    fontSize: 10,
    textTransform: "capitalize"
  },
  toolkitMenuItem: {
    borderBottomColor: colors.line,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 1,
    paddingHorizontal: 10,
    paddingVertical: 7
  },
  toolkitMenuItemLast: {
    borderBottomWidth: 0
  },
  toolkitMenuItemDisabled: {
    opacity: 0.55
  },
  toolkitMenuItemActive: {
    backgroundColor: colors.accentSoft
  },
  toolkitMenuItemLabel: {
    color: colors.ink,
    fontFamily: fonts.uiMedium,
    fontSize: 12,
    lineHeight: 16
  },
  toolkitMenuItemLabelDisabled: {
    color: colors.muted
  },
  toolkitMenuItemLabelActive: {
    color: colors.kicker,
    fontFamily: fonts.uiSemibold
  },
  toolkitMenuItemBlurb: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 10,
    lineHeight: 14
  },
  toolkitMenuItemBlurbDisabled: {
    fontStyle: "italic"
  },
  toolkitRow: {
    borderTopColor: colors.line,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexGrow: 0,
    flexShrink: 0
  },
  toolkitRowContent: {
    alignItems: "center",
    flexDirection: "row",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 6
  },
  toolkitAction: {
    borderColor: colors.line,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    flexShrink: 0,
    paddingHorizontal: 8,
    paddingVertical: 4
  },
  toolkitActionSelected: {
    backgroundColor: colors.panel,
    borderColor: colors.kicker
  },
  toolkitActionText: {
    color: colors.kicker,
    fontFamily: fonts.uiMedium,
    fontSize: 11,
    lineHeight: 14
  },
  toolkitActionTextSelected: {
    color: colors.ink
  },
  activePartnerBanner: {
    alignItems: "center",
    backgroundColor: colors.accentSoft,
    borderTopColor: colors.line,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  activePartnerCopy: {
    flex: 1,
    gap: 2,
    minWidth: 0
  },
  activePartnerEyebrow: {
    color: colors.kicker,
    fontFamily: fonts.uiSemibold,
    fontSize: 9,
    letterSpacing: 0.5,
    textTransform: "uppercase"
  },
  activePartnerLabel: {
    color: colors.ink,
    fontFamily: fonts.uiMedium,
    fontSize: 12,
    lineHeight: 16
  },
  activePartnerClear: {
    alignItems: "center",
    borderRadius: 999,
    height: 24,
    justifyContent: "center",
    width: 24
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
    gap: 12,
    paddingHorizontal: 10,
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
  turnAssistant: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 10,
    borderWidth: 1,
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  turnUser: {
    alignItems: "flex-end",
    gap: 4
  },
  userSaid: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.brandRuleSoft,
    borderRadius: 10,
    borderWidth: 1,
    maxWidth: "94%",
    paddingHorizontal: 11,
    paddingVertical: 9
  },
  turnSystem: {
    backgroundColor: colors.amberSoft,
    borderColor: colors.amber,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 11,
    paddingVertical: 8
  },
  systemNote: {
    color: colors.amber,
    fontFamily: fonts.ui,
    fontSize: 12,
    lineHeight: 17
  },
  systemNoteLink: {
    textDecorationLine: "underline"
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
  turnMenuWrap: {
    position: "relative"
  },
  turnMenuButton: {
    alignItems: "center",
    borderRadius: 5,
    height: 18,
    justifyContent: "center",
    opacity: 0.78,
    width: 18
  },
  turnMenu: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 8,
    borderWidth: 1,
    left: 0,
    minWidth: 108,
    position: "absolute",
    top: "100%",
    zIndex: 20
  },
  turnMenuItem: {
    paddingHorizontal: 10,
    paddingVertical: 7
  },
  turnMenuItemText: {
    color: colors.ink,
    fontFamily: fonts.ui,
    fontSize: 11
  },
  followUpRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6
  },
  followUpChip: {
    alignItems: "center",
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 6,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 26,
    paddingHorizontal: 9,
    paddingVertical: 5
  },
  followUpChipText: {
    color: colors.ink,
    fontFamily: fonts.uiSemibold,
    fontSize: 10
  },
  messageActionChipPrimary: {
    backgroundColor: colors.rail,
    borderColor: colors.rail
  },
  messageActionChipPrimaryText: {
    // High contrast on rail black — railText is too close to ink for chips.
    color: "#ffffff"
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
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "space-between",
    minWidth: 0,
    rowGap: 6
  },
  pickerRow: {
    alignItems: "center",
    flexDirection: "row",
    flexGrow: 1,
    flexShrink: 1,
    flexWrap: "wrap",
    gap: 4,
    minWidth: 0
  },
  composerToolbarEnd: {
    alignItems: "center",
    flexDirection: "row",
    flexShrink: 0,
    gap: 6
  },
  iconToolButton: {
    alignItems: "center",
    borderRadius: 6,
    height: 28,
    justifyContent: "center",
    width: 28
  },
  iconToolButtonActive: {
    backgroundColor: colors.accentSoft
  },
  nextActionMarkButton: {
    alignItems: "center",
    backgroundColor: colors.rail,
    borderRadius: 6,
    height: 28,
    justifyContent: "center",
    width: 28
  },
  nextActionMarkFrame: {
    alignItems: "center",
    backgroundColor: colors.paper,
    borderRadius: 4,
    height: 20,
    justifyContent: "center",
    overflow: "hidden",
    width: 20
  },
  nextActionMarkImage: {
    height: 18,
    width: 18
  },
  attachmentRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    paddingHorizontal: 2
  },
  attachmentChip: {
    alignItems: "center",
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 6,
    borderWidth: 1,
    flexDirection: "row",
    gap: 4,
    maxWidth: "100%",
    paddingLeft: 8,
    paddingRight: 4,
    paddingVertical: 4
  },
  attachmentChipText: {
    color: colors.muted,
    flexShrink: 1,
    fontFamily: fonts.uiMedium,
    fontSize: 10,
    maxWidth: 160
  },
  attachmentRemove: {
    alignItems: "center",
    borderRadius: 999,
    height: 18,
    justifyContent: "center",
    width: 18
  },
  attachmentError: {
    color: colors.amber,
    fontFamily: fonts.ui,
    fontSize: 10,
    paddingHorizontal: 2
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
  stopButton: {
    backgroundColor: colors.amber
  },
  stopButtonText: {
    color: "#ffffff",
    fontFamily: fonts.uiSemibold,
    fontSize: 9,
    lineHeight: 10
  },
  pressed: {
    opacity: 0.72
  },
  disabled: {
    opacity: 0.42
  }
});
