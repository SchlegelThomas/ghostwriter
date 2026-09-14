import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  storyWorkCoordinationReviewForegroundCopy,
  storyWorkCoordinationReviewRefreshCopy,
  type StoryWorkCoordinationReviewStepActionKind,
  type StoryWorkCoordinationReviewStepViewModel
} from "./story-work-coordination-review.js";
import { ghostwriterTheme } from "./theme.js";

const { colors, fonts } = ghostwriterTheme;
export const STORY_WORK_COORDINATION_REVIEW_HEADING_NATIVE_ID =
  "story-work-coordination-review-heading";

export type {
  StoryWorkCoordinationReviewStepActionKind,
  StoryWorkCoordinationReviewStepKind,
  StoryWorkCoordinationReviewStepViewModel
} from "./story-work-coordination-review.js";

export type StoryWorkCoordinationReviewProps = Readonly<{
  coordinationTitle: string;
  coordinationStatusLabel: string;
  coordinationVersion: number;
  steps: readonly StoryWorkCoordinationReviewStepViewModel[];
  busy?: boolean;
  error?: string;
  message?: string;
  onAction(
    stepId: string,
    kind: StoryWorkCoordinationReviewStepActionKind
  ): void | Promise<void>;
  onRefresh(): void | Promise<void>;
  onClose(): void;
  onBusyChange?(busy: boolean): void;
}>;

function statusTone(statusLabel: string): Readonly<{ border: string; background: string }> {
  switch (statusLabel) {
    case "Blocked":
      return { border: colors.line, background: colors.panel };
    case "Working":
      return { border: colors.accent, background: colors.accentSoft };
    case "Brief ready":
    case "Draft ready":
    case "Ready":
      return { border: colors.accent, background: colors.panel };
    case "Awaiting review":
      return { border: colors.accent, background: colors.accentSoft };
    case "Needs attention":
      return { border: colors.red, background: colors.amberSoft };
    case "Applied to story":
    case "Review complete":
      return { border: colors.green, background: colors.greenSoft };
    case "Canceled":
      return { border: colors.line, background: colors.panel };
    default:
      return { border: colors.line, background: colors.panel };
  }
}

/** Presentational coordinated story work review. Scheduling and server truth stay with the caller. */
export function StoryWorkCoordinationReview(props: StoryWorkCoordinationReviewProps) {
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [localMessage, setLocalMessage] = useState<string>();
  const [localError, setLocalError] = useState<string>();
  const busy = pending || props.busy === true;

  useEffect(() => {
    props.onBusyChange?.(busy);
  }, [busy, props.onBusyChange]);

  async function runAction(
    kind: StoryWorkCoordinationReviewStepActionKind,
    action: () => void | Promise<void>
  ) {
    if (pendingRef.current || busy) return;
    pendingRef.current = true;
    setPending(true);
    setLocalMessage(undefined);
    setLocalError(undefined);
    try {
      await action();
    } catch (cause) {
      setLocalError(
        cause instanceof Error
          ? cause.message
          : "The coordination action was not acknowledged. Refresh and try again."
      );
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  async function refresh() {
    if (pendingRef.current || busy) return;
    pendingRef.current = true;
    setPending(true);
    setLocalMessage(undefined);
    setLocalError(undefined);
    try {
      await props.onRefresh();
      setLocalMessage("Coordination details refreshed.");
    } catch (cause) {
      setLocalError(
        cause instanceof Error
          ? cause.message
          : "Coordination details could not be refreshed."
      );
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  const announcement = props.message ?? localMessage;
  const problem = props.error ?? localError;

  return (
    <View accessibilityLabel="Coordinated story work review" style={styles.root}>
      <View style={styles.header}>
        <View style={styles.heading}>
          <Text style={styles.kicker}>COORDINATED STORY WORK</Text>
          <Text
            accessibilityRole="header"
            nativeID={STORY_WORK_COORDINATION_REVIEW_HEADING_NATIVE_ID}
            style={styles.title}
          >
            Coordinated story work
          </Text>
          <Text style={styles.subtitle}>{props.coordinationTitle}</Text>
          <Text style={styles.meta}>
            {props.coordinationStatusLabel} · version {props.coordinationVersion}
          </Text>
        </View>
        <Action label="Back to story work" disabled={busy} onPress={props.onClose} />
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.body}>{storyWorkCoordinationReviewForegroundCopy()}</Text>
        <Text style={styles.hint}>{storyWorkCoordinationReviewRefreshCopy()}</Text>
        <View style={styles.actions}>
          <Action
            label={busy ? "Refreshing…" : "Refresh coordination"}
            disabled={busy}
            onPress={() => {
              void refresh();
            }}
          />
        </View>
        {announcement ? (
          <Text accessibilityLiveRegion="polite" style={styles.success}>
            {announcement}
          </Text>
        ) : null}
        {problem ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {problem}
          </Text>
        ) : null}
        <View style={styles.timeline} accessibilityRole="list">
          {props.steps.map((step, index) => (
            <StepRow
              key={step.stepId}
              step={step}
              isLast={index === props.steps.length - 1}
              disabled={busy}
              onAction={(kind) => {
                void runAction(kind, () => props.onAction(step.stepId, kind));
              }}
            />
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

function StepRow({
  step,
  isLast,
  disabled,
  onAction
}: Readonly<{
  step: StoryWorkCoordinationReviewStepViewModel;
  isLast: boolean;
  disabled: boolean;
  onAction(kind: StoryWorkCoordinationReviewStepActionKind): void;
}>) {
  const tone = statusTone(step.statusLabel);
  return (
    <View style={styles.stepRow}>
      <View style={styles.rail} importantForAccessibility="no-hide-descendants">
        <View style={[styles.railDot, { borderColor: tone.border, backgroundColor: tone.background }]} />
        {!isLast ? <View style={styles.railLine} /> : null}
      </View>
      <View style={[styles.stepCard, { borderColor: tone.border, backgroundColor: tone.background }]}>
        <Text style={styles.stepKind}>
          {step.kind === "scene-draft" ? "Scene draft" : "Continuity check"}
        </Text>
        <Text style={styles.stepTitle}>{step.title}</Text>
        <Text accessibilityLiveRegion="polite" style={styles.status}>
          {step.statusLabel}
        </Text>
        <Text style={styles.body}>{step.detail}</Text>
        {step.blockedReason ? (
          <Text accessibilityRole="alert" style={styles.blocked}>
            {step.blockedReason}
          </Text>
        ) : null}
        {step.action ? (
          <Action
            label={step.action.label}
            disabled={disabled}
            primary
            onPress={() => onAction(step.action!.kind)}
          />
        ) : null}
      </View>
    </View>
  );
}

function Action({
  label,
  onPress,
  disabled = false,
  primary = false
}: Readonly<{
  label: string;
  onPress(): void;
  disabled?: boolean;
  primary?: boolean;
}>) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.button,
        primary && styles.primary,
        disabled && styles.disabled
      ]}
    >
      <Text style={[styles.buttonText, primary && styles.primaryText]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    minHeight: 0,
    minWidth: 0,
    backgroundColor: colors.paper
  },
  header: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "flex-start",
    gap: 12,
    paddingTop: 20,
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.line
  },
  heading: { flex: 1, minWidth: 200, gap: 4 },
  kicker: {
    fontFamily: fonts.uiSemibold,
    color: colors.accent,
    fontSize: 10,
    letterSpacing: 1,
    lineHeight: 14
  },
  title: {
    fontFamily: fonts.story,
    color: colors.ink,
    fontSize: 28,
    lineHeight: 34,
    paddingTop: 2
  },
  subtitle: {
    fontFamily: fonts.story,
    color: colors.ink,
    fontSize: 20,
    lineHeight: 26
  },
  meta: { fontFamily: fonts.ui, color: colors.muted, fontSize: 12, lineHeight: 18 },
  content: {
    paddingTop: 20,
    paddingHorizontal: 20,
    paddingBottom: 24,
    gap: 14,
    width: "100%",
    maxWidth: 720,
    alignSelf: "center"
  },
  body: { fontFamily: fonts.ui, color: colors.ink, fontSize: 14, lineHeight: 22 },
  hint: { fontFamily: fonts.ui, color: colors.muted, fontSize: 12, lineHeight: 20 },
  success: { fontFamily: fonts.ui, color: colors.green, fontSize: 13, lineHeight: 20 },
  error: { fontFamily: fonts.ui, color: colors.red, fontSize: 13, lineHeight: 20 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  timeline: { gap: 0, marginTop: 4 },
  stepRow: { flexDirection: "row", alignItems: "stretch", gap: 12 },
  rail: { width: 18, alignItems: "center" },
  railDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    marginTop: 18
  },
  railLine: {
    flex: 1,
    width: 2,
    minHeight: 24,
    backgroundColor: colors.line,
    marginTop: 4
  },
  stepCard: {
    flex: 1,
    minWidth: 0,
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
    gap: 8,
    marginBottom: 12
  },
  stepKind: {
    fontFamily: fonts.uiSemibold,
    color: colors.muted,
    fontSize: 10,
    letterSpacing: 0.6,
    textTransform: "uppercase"
  },
  stepTitle: { fontFamily: fonts.uiSemibold, color: colors.ink, fontSize: 15, lineHeight: 21 },
  status: { fontFamily: fonts.uiSemibold, color: colors.ink, fontSize: 13, lineHeight: 18 },
  blocked: { fontFamily: fonts.ui, color: colors.red, fontSize: 12, lineHeight: 18 },
  button: {
    minHeight: 42,
    justifyContent: "center",
    alignSelf: "flex-start",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    backgroundColor: colors.panel
  },
  primary: { backgroundColor: colors.accent, borderColor: colors.accent },
  primaryText: { color: colors.panel },
  buttonText: { fontFamily: fonts.uiSemibold, fontSize: 12, color: colors.ink },
  disabled: { opacity: 0.45 }
});
