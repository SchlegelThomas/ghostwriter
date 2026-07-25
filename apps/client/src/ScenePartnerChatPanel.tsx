import { ghostwriterTheme } from "@ghostwriter/ui";
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { AiSetupPanel } from "./AiSetupPanel.js";
import {
  getOpenAiProviderStatus,
  GhostwriterApiError,
  postScenePartnerImage,
  postScenePartnerTurn
} from "./api.js";
import {
  advanceScenePartnerTurn,
  buildScenePartnerImageProposalTurn,
  buildScenePartnerOpening,
  imageProposalMessageFromLive,
  messagesFromScenePartnerLiveTurn,
  scenePartnerTranscriptForApi,
  thinkingMessagesForLabels,
  thinkingMessagesForSteps,
  type ScenePartnerActionKind,
  type ScenePartnerChatMessage,
  type ScenePartnerManuscriptScene,
  type ScenePartnerScriptPhase
} from "./scene-partner-chat.js";

const { colors, fonts } = ghostwriterTheme;

const THINKING_STEP_MS = 280;

export type ScenePartnerPlacementChoice = Readonly<{
  key: string;
  label: string;
}>;

export type ScenePartnerApplyInput = Readonly<{
  title: string;
  placementKey: string;
}>;

export type ScenePartnerChatPanelProps = Readonly<{
  projectId: string;
  captureId: string;
  ideaProse: string;
  scenes: readonly ScenePartnerManuscriptScene[];
  placementChoices: readonly ScenePartnerPlacementChoice[];
  defaultPlacementKey?: string;
  defaultTitle?: string;
  compact?: boolean;
  disabled?: boolean;
  onApplyAsNewScene(input: ScenePartnerApplyInput): Promise<void>;
  onBusyChange?(busy: boolean): void;
  onOpenSettings?(): void;
  /** Bump when Settings may have changed the OpenAI key. */
  providerStatusSignal?: number;
}>;

type ProviderGate = "checking" | "needs-setup" | "ready";

function ChatButton({
  label,
  onPress,
  primary = false,
  disabled = false
}: Readonly<{
  label: string;
  onPress(): void;
  primary?: boolean;
  disabled?: boolean;
}>) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        primary && styles.buttonPrimary,
        pressed && !disabled && styles.buttonPressed,
        disabled && styles.buttonDisabled
      ]}
    >
      <Text style={[styles.buttonText, primary && styles.buttonTextPrimary]}>
        {label}
      </Text>
    </Pressable>
  );
}

function revealThinkingThenMessages(input: Readonly<{
  thinkingTrail: readonly ScenePartnerChatMessage[];
  messages: readonly ScenePartnerChatMessage[];
  timers: ReturnType<typeof setTimeout>[];
  setMessages: Dispatch<SetStateAction<ScenePartnerChatMessage[]>>;
  setThinking: (value: boolean) => void;
  onDone?(): void;
}>): void {
  const thinkingTrail = input.thinkingTrail;

  let step = 0;
  const revealNext = (): void => {
    if (step < thinkingTrail.length) {
      const next = thinkingTrail[step];
      if (next !== undefined) {
        input.setMessages((current) => [...current, next]);
      }
      step += 1;
      const timer = setTimeout(revealNext, THINKING_STEP_MS);
      input.timers.push(timer);
      return;
    }
    input.setMessages((current) => [...current, ...input.messages]);
    input.setThinking(false);
    input.onDone?.();
  };

  const timer = setTimeout(revealNext, THINKING_STEP_MS);
  input.timers.push(timer);
}

export function ScenePartnerChatPanel({
  projectId,
  captureId,
  ideaProse,
  scenes,
  placementChoices,
  defaultPlacementKey = "",
  defaultTitle = "Untitled scene",
  compact = false,
  disabled = false,
  onApplyAsNewScene,
  onBusyChange,
  onOpenSettings,
  providerStatusSignal = 0
}: ScenePartnerChatPanelProps) {
  const [providerGate, setProviderGate] = useState<ProviderGate>("checking");
  const [providerConfigured, setProviderConfigured] = useState(false);
  const [messages, setMessages] = useState<ScenePartnerChatMessage[]>([]);
  const [phase, setPhase] = useState<ScenePartnerScriptPhase>("interview");
  const [matchedScene, setMatchedScene] = useState<
    ScenePartnerManuscriptScene | undefined
  >();
  const [lastImagePrompt, setLastImagePrompt] = useState<string | undefined>();
  const [composer, setComposer] = useState("");
  const [thinking, setThinking] = useState(false);
  const [replyBusy, setReplyBusy] = useState(false);
  const [applyOpen, setApplyOpen] = useState(false);
  const [applyTitle, setApplyTitle] = useState(defaultTitle);
  const [applyPlacementKey, setApplyPlacementKey] = useState(
    defaultPlacementKey
  );
  const [statusMessage, setStatusMessage] = useState<string>();
  const [applyBusy, setApplyBusy] = useState(false);
  const sessionStartedRef = useRef(false);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const captureScopeRef = useRef(captureId);
  const messagesRef = useRef<ScenePartnerChatMessage[]>([]);
  const phaseRef = useRef<ScenePartnerScriptPhase>(phase);
  const matchedSceneRef = useRef(matchedScene);

  const sessionBusy = thinking || replyBusy || applyBusy;

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    matchedSceneRef.current = matchedScene;
  }, [matchedScene]);

  useEffect(() => {
    onBusyChange?.(sessionBusy);
  }, [onBusyChange, sessionBusy]);

  useEffect(() => {
    return () => {
      for (const timer of timersRef.current) clearTimeout(timer);
      timersRef.current = [];
    };
  }, []);

  useEffect(() => {
    if (captureScopeRef.current === captureId) return;
    captureScopeRef.current = captureId;
    sessionStartedRef.current = false;
    for (const timer of timersRef.current) clearTimeout(timer);
    timersRef.current = [];
    setMessages([]);
    setComposer("");
    setThinking(false);
    setReplyBusy(false);
    setApplyOpen(false);
    setApplyTitle(defaultTitle);
    setApplyPlacementKey(defaultPlacementKey);
    setStatusMessage(undefined);
    setLastImagePrompt(undefined);
    setProviderConfigured(false);
    setProviderGate("checking");
  }, [captureId, defaultPlacementKey, defaultTitle]);

  useEffect(() => {
    if (providerStatusSignal === 0) return;
    sessionStartedRef.current = false;
    setMessages([]);
    setProviderConfigured(false);
    setProviderGate("checking");
  }, [providerStatusSignal]);

  useEffect(() => {
    if (providerGate !== "checking") return;
    let cancelled = false;
    void (async () => {
      try {
        const status = await getOpenAiProviderStatus();
        if (cancelled) return;
        if (status.callsDisabled) {
          setStatusMessage("Provider calls are temporarily disabled.");
          setProviderConfigured(false);
          setProviderGate("ready");
          return;
        }
        if (!status.configured) {
          setProviderConfigured(false);
          setProviderGate("needs-setup");
          return;
        }
        setProviderConfigured(true);
        setProviderGate("ready");
      } catch (error) {
        if (cancelled) return;
        setStatusMessage(
          error instanceof GhostwriterApiError
            ? error.message
            : "Ghostwriter could not check the OpenAI key."
        );
        // Hermetic / offline: continue with the fake session script.
        setProviderConfigured(false);
        setProviderGate("ready");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [providerGate, captureId]);

  useEffect(() => {
    if (providerGate !== "ready" || sessionStartedRef.current) return;
    sessionStartedRef.current = true;
    setThinking(true);
    setMessages([]);
    setStatusMessage(undefined);

    if (!providerConfigured) {
      const opening = buildScenePartnerOpening({ ideaProse, scenes });
      setPhase(opening.phase);
      setMatchedScene(opening.matchedScene);
      revealThinkingThenMessages({
        thinkingTrail: thinkingMessagesForSteps(opening.thinkingSteps),
        messages: opening.messages,
        timers: timersRef.current,
        setMessages,
        setThinking
      });
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const turn = await postScenePartnerTurn({
          projectId,
          captureId,
          ideaProse,
          scenes,
          messages: []
        });
        if (cancelled) return;
        setPhase(turn.phase);
        setMatchedScene(
          turn.matchedSceneId === null
            ? undefined
            : scenes.find((scene) => scene.id === turn.matchedSceneId)
        );
        if (turn.imagePrompt !== null) {
          setLastImagePrompt(turn.imagePrompt);
        }
        revealThinkingThenMessages({
          thinkingTrail: thinkingMessagesForLabels(turn.thinkingSteps),
          messages: messagesFromScenePartnerLiveTurn(turn),
          timers: timersRef.current,
          setMessages,
          setThinking
        });
      } catch (error) {
        if (cancelled) return;
        setThinking(false);
        setStatusMessage(
          error instanceof GhostwriterApiError
            ? error.message
            : "Scene Partner could not start a live turn."
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [providerGate, providerConfigured, ideaProse, scenes, projectId, captureId]);

  async function sendComposer(): Promise<void> {
    const text = composer.trim();
    if (text.length === 0 || sessionBusy || disabled) return;
    setComposer("");
    setReplyBusy(true);
    setStatusMessage(undefined);

    const userMessage: ScenePartnerChatMessage = {
      id: `scene-partner-user-${Date.now()}`,
      role: "user",
      kind: "user",
      body: text
    };
    setMessages((current) => [...current, userMessage]);

    if (!providerConfigured) {
      try {
        const turn = advanceScenePartnerTurn({
          phase,
          userText: text,
          ideaProse,
          matchedScene,
          scenes
        });
        setPhase(turn.phase);
        if (turn.phase === "match" || turn.phase === "new-scene") {
          const reopen = buildScenePartnerOpening({
            ideaProse: [ideaProse, text].filter(Boolean).join(" "),
            scenes
          });
          setMatchedScene(reopen.matchedScene);
        }
        setMessages((current) => [...current, ...turn.messages.slice(1)]);
      } finally {
        setReplyBusy(false);
      }
      return;
    }

    setThinking(true);
    try {
      const transcript = [
        ...scenePartnerTranscriptForApi(messagesRef.current),
        { role: "user" as const, body: text }
      ];
      const turn = await postScenePartnerTurn({
        projectId,
        captureId,
        ideaProse,
        scenes,
        messages: transcript,
        phase: phaseRef.current,
        matchedSceneId: matchedSceneRef.current?.id ?? null
      });
      setPhase(turn.phase);
      setMatchedScene(
        turn.matchedSceneId === null
          ? undefined
          : scenes.find((scene) => scene.id === turn.matchedSceneId)
      );
      if (turn.imagePrompt !== null) {
        setLastImagePrompt(turn.imagePrompt);
      }
      revealThinkingThenMessages({
        thinkingTrail: thinkingMessagesForLabels(turn.thinkingSteps),
        messages: messagesFromScenePartnerLiveTurn(turn),
        timers: timersRef.current,
        setMessages,
        setThinking,
        onDone: () => setReplyBusy(false)
      });
    } catch (error) {
      setThinking(false);
      setReplyBusy(false);
      setStatusMessage(
        error instanceof GhostwriterApiError
          ? error.message
          : "Scene Partner could not complete that turn."
      );
    }
  }

  async function runProposeImage(): Promise<void> {
    if (sessionBusy || disabled) return;
    setReplyBusy(true);
    setStatusMessage(undefined);
    const prompt =
      lastImagePrompt?.trim() ||
      (ideaProse.trim().length > 0
        ? `Quiet literary study for: ${ideaProse.trim().slice(0, 120)}`
        : "Quiet literary study of an unnamed scene");

    if (!providerConfigured) {
      const turn = buildScenePartnerImageProposalTurn(ideaProse);
      setPhase(turn.phase);
      setMessages((current) => [...current, ...turn.messages]);
      setReplyBusy(false);
      return;
    }

    try {
      const image = await postScenePartnerImage({
        projectId,
        captureId,
        prompt
      });
      setPhase("iterate");
      setMessages((current) => [
        ...current,
        imageProposalMessageFromLive(image)
      ]);
    } catch (error) {
      const turn = buildScenePartnerImageProposalTurn(ideaProse);
      setPhase(turn.phase);
      setMessages((current) => [...current, ...turn.messages]);
      setStatusMessage(
        error instanceof GhostwriterApiError
          ? `${error.message} Showing a placeholder image instead.`
          : "Image generation failed. Showing a placeholder instead."
      );
    } finally {
      setReplyBusy(false);
    }
  }

  function runAction(action: ScenePartnerActionKind): void {
    if (sessionBusy || disabled) return;
    if (action === "apply-new-scene") {
      setApplyOpen(true);
      setStatusMessage(undefined);
      return;
    }
    if (action === "propose-image") {
      void runProposeImage();
    }
  }

  async function confirmApply(): Promise<void> {
    const title = applyTitle.trim();
    if (title.length === 0) {
      setStatusMessage("Give the new scene a title before applying.");
      return;
    }
    if (applyPlacementKey.length === 0) {
      setStatusMessage("Choose a manuscript placement before applying.");
      return;
    }
    setApplyBusy(true);
    setStatusMessage(undefined);
    try {
      await onApplyAsNewScene({
        title,
        placementKey: applyPlacementKey
      });
      setApplyOpen(false);
      setMessages((current) => [
        ...current,
        {
          id: `scene-partner-applied-${Date.now()}`,
          role: "assistant",
          kind: "assistant",
          body: `Applied as scene “${title}”. The draft stayed unchanged until you confirmed.`
        }
      ]);
    } catch (error) {
      setStatusMessage(
        error instanceof Error
          ? error.message
          : "Ghostwriter could not apply that scene."
      );
    } finally {
      setApplyBusy(false);
    }
  }

  return (
    <View
      accessibilityLabel="Scene Partner chat"
      style={[styles.panel, compact && styles.panelCompact]}
    >
      <Text accessibilityRole="header" style={styles.title}>
        Scene Partner
      </Text>
      <Text style={styles.lede}>
        A quiet working chat — thinking stays visible; nothing enters the
        manuscript until you apply.
      </Text>

      <View
        accessibilityLabel="Idea under discussion"
        style={styles.ideaContext}
      >
        <Text style={styles.ideaContextLabel}>This idea</Text>
        <Text style={styles.ideaContextBody}>
          {ideaProse.trim().length > 0
            ? ideaProse.trim()
            : "This capture has no prose yet — open Idea Capture to add some."}
        </Text>
      </View>

      {providerGate === "needs-setup" ? (
        <View style={styles.setupCard}>
          <Text style={styles.statusCopy}>
            Scene Partner needs your OpenAI key. Add it once in Settings at the
            bottom of the left rail — it applies across the whole app.
          </Text>
          {onOpenSettings === undefined ? (
            <AiSetupPanel
              compact={compact}
              onConfigured={() => {
                setProviderConfigured(true);
                setProviderGate("ready");
              }}
              onDismiss={() => setProviderGate("ready")}
            />
          ) : (
            <ChatButton
              label="Open Settings"
              onPress={onOpenSettings}
              primary
            />
          )}
        </View>
      ) : null}

      {providerGate === "checking" ? (
        <Text style={styles.statusCopy}>Preparing Scene Partner…</Text>
      ) : null}

      {statusMessage !== undefined ? (
        <Text accessibilityRole="alert" style={styles.statusCopy}>
          {statusMessage}
        </Text>
      ) : null}

      <View accessibilityLabel="Conversation" style={styles.thread}>
        {messages.map((message) => (
          <MessageBubble
            key={message.id}
            disabled={disabled || sessionBusy}
            message={message}
            onAction={runAction}
          />
        ))}
        {thinking ? (
          <Text style={styles.thinkingLive}>Thinking…</Text>
        ) : null}
      </View>

      {applyOpen ? (
        <View style={styles.applyCard}>
          <Text style={styles.applyTitle}>Apply as new scene</Text>
          <Text style={styles.statusCopy}>
            Human-gated — Ghostwriter will not write this into the manuscript
            until you confirm.
          </Text>
          <TextInput
            accessibilityLabel="New scene title"
            editable={!disabled && !applyBusy}
            onChangeText={setApplyTitle}
            style={styles.input}
            value={applyTitle}
          />
          <View style={styles.chipRow}>
            {placementChoices.map((choice) => (
              <ChatButton
                key={choice.key}
                disabled={disabled || applyBusy}
                label={
                  applyPlacementKey === choice.key
                    ? `✓ ${choice.label}`
                    : choice.label
                }
                onPress={() => setApplyPlacementKey(choice.key)}
              />
            ))}
          </View>
          <View style={styles.chipRow}>
            <ChatButton
              disabled={disabled || applyBusy}
              label="Confirm apply"
              onPress={() => void confirmApply()}
              primary
            />
            <ChatButton
              disabled={disabled || applyBusy}
              label="Not yet"
              onPress={() => setApplyOpen(false)}
            />
          </View>
        </View>
      ) : null}

      <View style={styles.composerRow}>
        <TextInput
          accessibilityLabel="Reply to Scene Partner"
          editable={!disabled && !sessionBusy && providerGate === "ready"}
          multiline
          onChangeText={setComposer}
          placeholder="Reply…"
          placeholderTextColor={colors.muted}
          style={styles.composer}
          value={composer}
        />
        <ChatButton
          disabled={
            disabled ||
            sessionBusy ||
            providerGate !== "ready" ||
            composer.trim().length === 0
          }
          label="Send"
          onPress={() => void sendComposer()}
          primary
        />
      </View>
    </View>
  );
}

function MessageBubble({
  message,
  disabled,
  onAction
}: Readonly<{
  message: ScenePartnerChatMessage;
  disabled: boolean;
  onAction(action: ScenePartnerActionKind): void;
}>) {
  if (message.kind === "thinking") {
    return (
      <View accessibilityLabel={`Thinking: ${message.body}`} style={styles.thinkingRow}>
        <Text style={styles.thinkingMark}>·</Text>
        <Text style={styles.thinkingText}>{message.body}</Text>
      </View>
    );
  }

  if (message.role === "user") {
    return (
      <View style={[styles.bubble, styles.userBubble]}>
        <Text style={styles.userText}>{message.body}</Text>
      </View>
    );
  }

  return (
    <View
      style={[
        styles.bubble,
        styles.assistantBubble,
        message.kind === "image-proposal" && styles.imageBubble
      ]}
    >
      <Text style={styles.assistantText}>{message.body}</Text>
      {message.proseDraft !== undefined ? (
        <Text style={styles.proseDraft}>{message.proseDraft}</Text>
      ) : null}
      {message.imageProposal !== undefined ? (
        <View style={styles.imageCard}>
          <Image
            accessibilityLabel={message.imageProposal.alt}
            source={{ uri: message.imageProposal.url }}
            style={styles.image}
          />
          <Text style={styles.imagePrompt}>{message.imageProposal.prompt}</Text>
        </View>
      ) : null}
      {message.actions !== undefined && message.actions.length > 0 ? (
        <View style={styles.chipRow}>
          {message.actions.map((action) => (
            <ChatButton
              key={`${message.id}-${action}`}
              disabled={disabled}
              label={
                action === "apply-new-scene"
                  ? "Apply as new scene"
                  : "Propose scene image"
              }
              onPress={() => onAction(action)}
              primary={action === "apply-new-scene"}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    gap: 14
  },
  panelCompact: {
    gap: 12
  },
  title: {
    color: colors.ink,
    fontFamily: fonts.story,
    fontSize: 26,
    lineHeight: 32
  },
  lede: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 13,
    lineHeight: 19,
    maxWidth: 520
  },
  ideaContext: {
    backgroundColor: colors.wash,
    borderColor: colors.line,
    borderRadius: 10,
    borderWidth: 1,
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 12
  },
  ideaContextLabel: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.4,
    textTransform: "uppercase"
  },
  ideaContextBody: {
    color: colors.ink,
    fontFamily: fonts.story,
    fontSize: 16,
    lineHeight: 24
  },
  setupCard: {
    gap: 12
  },
  thread: {
    gap: 10
  },
  thinkingRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    paddingVertical: 2
  },
  thinkingMark: {
    color: colors.amber,
    fontFamily: fonts.uiMedium,
    fontSize: 18,
    lineHeight: 18
  },
  thinkingText: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 13,
    fontStyle: "italic"
  },
  thinkingLive: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 12,
    fontStyle: "italic"
  },
  bubble: {
    borderRadius: 12,
    gap: 8,
    maxWidth: "100%",
    paddingHorizontal: 14,
    paddingVertical: 12
  },
  assistantBubble: {
    alignSelf: "flex-start",
    backgroundColor: colors.wash,
    borderColor: colors.line,
    borderWidth: 1,
    maxWidth: "92%"
  },
  imageBubble: {
    backgroundColor: colors.panel
  },
  userBubble: {
    alignSelf: "flex-end",
    backgroundColor: colors.accentSoft,
    maxWidth: "85%"
  },
  assistantText: {
    color: colors.ink,
    fontFamily: fonts.story,
    fontSize: 17,
    lineHeight: 26
  },
  userText: {
    color: colors.ink,
    fontFamily: fonts.ui,
    fontSize: 14,
    lineHeight: 20
  },
  proseDraft: {
    borderLeftColor: colors.brandRule,
    borderLeftWidth: 2,
    color: colors.ink,
    fontFamily: fonts.storyItalic,
    fontSize: 17,
    lineHeight: 26,
    paddingLeft: 12
  },
  imageCard: {
    gap: 8
  },
  image: {
    backgroundColor: colors.canvas,
    borderColor: colors.line,
    borderRadius: 8,
    borderWidth: 1,
    height: 160,
    width: "100%"
  },
  imagePrompt: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 12,
    lineHeight: 17
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  applyCard: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 10,
    borderWidth: 1,
    gap: 10,
    padding: 12
  },
  applyTitle: {
    color: colors.ink,
    fontFamily: fonts.uiMedium,
    fontSize: 15
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
  composerRow: {
    alignItems: "flex-end",
    flexDirection: "row",
    gap: 8
  },
  composer: {
    borderColor: colors.line,
    borderRadius: 10,
    borderWidth: 1,
    color: colors.ink,
    flex: 1,
    fontFamily: fonts.story,
    fontSize: 16,
    lineHeight: 24,
    maxHeight: 120,
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  statusCopy: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 13,
    lineHeight: 18
  },
  button: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  buttonPrimary: {
    backgroundColor: colors.brandDark,
    borderColor: colors.brandDark
  },
  buttonPressed: {
    opacity: 0.85
  },
  buttonDisabled: {
    opacity: 0.5
  },
  buttonText: {
    color: colors.ink,
    fontFamily: fonts.uiMedium,
    fontSize: 13
  },
  buttonTextPrimary: {
    color: colors.paper
  }
});
