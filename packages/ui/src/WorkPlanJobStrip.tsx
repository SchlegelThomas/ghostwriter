import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View
} from "react-native";
import { CaretDown, CaretRight, CaretUp, X } from "phosphor-react-native";
import { ghostwriterTheme } from "./theme.js";
import {
  workPlanQuipAtIndex,
  workPlanQuipPhase
} from "./work-plan-working-quips.js";

const { colors, fonts } = ghostwriterTheme;

export type WorkPlanJobStripStatus =
  | "queued"
  | "running"
  | "done"
  | "error"
  | "skipped";

export type WorkPlanJobResultKind =
  | "plans"
  | "project-draft"
  | "scene-draft"
  | "none";

export type WorkPlanJobStripResult = Readonly<{
  kind: WorkPlanJobResultKind;
  openLabel: string;
  proposalId?: string;
  captureId?: string;
  preview?: string;
}>;

export type WorkPlanJobStripJob = Readonly<{
  id: string;
  title: string;
  status: WorkPlanJobStripStatus;
  detail?: string;
  /** Live progress lines shown when the job row is expanded. */
  logLines?: readonly string[];
  result?: WorkPlanJobStripResult;
}>;

export type WorkPlanJobStripAction = Readonly<{
  id: string;
  label: string;
}>;

export type WorkPlanJobStripProps = Readonly<{
  summary: string;
  jobs: readonly WorkPlanJobStripJob[];
  actions?: readonly WorkPlanJobStripAction[];
  onAction?(actionId: string): void;
  onOpenJob?(jobId: string): void;
  onDismiss?(): void;
}>;

function statusLabel(status: WorkPlanJobStripStatus): string {
  switch (status) {
    case "queued":
      return "Queued";
    case "running":
      return "Running";
    case "done":
      return "Done";
    case "error":
      return "Error";
    case "skipped":
      return "Skipped";
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

function progressLine(jobs: readonly WorkPlanJobStripJob[]): string {
  const total = jobs.length;
  let running = 0;
  let done = 0;
  let errored = 0;
  let queued = 0;
  for (const job of jobs) {
    if (job.status === "running") running += 1;
    else if (job.status === "done") done += 1;
    else if (job.status === "error") errored += 1;
    else queued += 1;
  }
  const finished = done + errored;
  if (running > 0 || (queued > 0 && finished < total)) {
    const active = Math.max(running, 1);
    return `Working · ${finished + active} of ${total}`;
  }
  if (errored === 0) {
    return `Finished · ${done} ready — tap a job to review`;
  }
  return `Finished · ${done} ready, ${errored} failed — tap a job`;
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || window.matchMedia === undefined) {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function PulsingEllipsis({ active }: Readonly<{ active: boolean }>) {
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!active || prefersReducedMotion()) {
      opacity.setValue(1);
      return;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.25,
          duration: 500,
          useNativeDriver: true
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 500,
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

  return (
    <Animated.Text style={[styles.ellipsis, { opacity }]}>...</Animated.Text>
  );
}

/** Typewriter quip + pulsing ellipsis while a job (or the strip) is working. */
function WorkingQuipStatus({
  active,
  seed = 0,
  style
}: Readonly<{
  active: boolean;
  seed?: number;
  style?: object;
}>) {
  const startedAt = useRef(Date.now());
  const [quipIndex, setQuipIndex] = useState(seed);
  const [visible, setVisible] = useState(() =>
    workPlanQuipAtIndex(seed).slice(0, 1)
  );

  useEffect(() => {
    if (!active) return;
    startedAt.current = Date.now();
    setQuipIndex(seed);
    setVisible(workPlanQuipAtIndex(seed).slice(0, 1));
  }, [active, seed]);

  useEffect(() => {
    if (!active) return;
    if (prefersReducedMotion()) {
      setVisible(workPlanQuipAtIndex(quipIndex));
      const hold = setInterval(() => {
        setQuipIndex((current) => current + 1);
      }, 2_400);
      return () => clearInterval(hold);
    }

    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const tick = (): void => {
      if (cancelled) return;
      const quip = workPlanQuipAtIndex(quipIndex);
      const elapsed = Date.now() - startedAt.current;
      const phase = workPlanQuipPhase(elapsed, quip);
      setVisible(phase.visible);
      if (phase.complete && phase.nextQuipAt <= 16) {
        startedAt.current = Date.now();
        setQuipIndex((current) => current + 1);
        timeout = setTimeout(tick, 40);
        return;
      }
      timeout = setTimeout(tick, phase.complete ? phase.nextQuipAt : 40);
    };
    tick();
    return () => {
      cancelled = true;
      if (timeout !== undefined) clearTimeout(timeout);
    };
  }, [active, quipIndex]);

  if (!active) return null;

  return (
    <View style={styles.quipRow}>
      <Text numberOfLines={1} style={[styles.quipText, style]}>
        {visible}
      </Text>
      <PulsingEllipsis active={active} />
    </View>
  );
}

export function WorkPlanJobStrip({
  summary,
  jobs,
  actions = [],
  onAction,
  onOpenJob,
  onDismiss
}: WorkPlanJobStripProps) {
  const [expandedId, setExpandedId] = useState<string | undefined>();
  const [stripCollapsed, setStripCollapsed] = useState(false);
  const wasInProgress = useRef(false);
  const inProgress = jobs.some(
    (job) => job.status === "running" || job.status === "queued"
  );

  // Auto-expand while work is running so the writer sees live status.
  useEffect(() => {
    if (inProgress && !wasInProgress.current) {
      setStripCollapsed(false);
    }
    wasInProgress.current = inProgress;
  }, [inProgress]);

  if (jobs.length === 0) return null;

  const trimmedSummary = summary.trim();
  const progress = progressLine(jobs);

  return (
    <View
      accessibilityLabel={`Work plan jobs · ${progress}${stripCollapsed ? " · collapsed" : ""}`}
      style={styles.strip}
    >
      <View style={styles.header}>
        <Pressable
          accessibilityHint={
            stripCollapsed
              ? "Expand work plan jobs"
              : "Collapse work plan jobs"
          }
          accessibilityLabel={stripCollapsed ? "Expand jobs" : "Collapse jobs"}
          accessibilityRole="button"
          accessibilityState={{ expanded: !stripCollapsed }}
          onPress={() => setStripCollapsed((current) => !current)}
          style={({ pressed }) => [
            styles.headerHit,
            pressed && styles.pressed
          ]}
        >
          {stripCollapsed ? (
            <CaretRight color={colors.muted} size={12} weight="bold" />
          ) : (
            <CaretUp color={colors.muted} size={12} weight="bold" />
          )}
          <View style={styles.headerCopy}>
            <Text numberOfLines={stripCollapsed ? 1 : 2} style={styles.summary}>
              {trimmedSummary.length > 0 ? trimmedSummary : "Work plan"}
            </Text>
            {inProgress ? (
              <WorkingQuipStatus active seed={jobs.length} />
            ) : (
              <Text style={styles.progress}>{progress}</Text>
            )}
            {stripCollapsed && inProgress ? (
              <Text style={styles.collapsedHint}>
                {progress} · expand for details
              </Text>
            ) : null}
          </View>
        </Pressable>
        {onDismiss !== undefined ? (
          <Pressable
            accessibilityLabel="Dismiss work plan jobs"
            accessibilityRole="button"
            onPress={onDismiss}
            style={({ pressed }) => [
              styles.dismissButton,
              pressed && styles.pressed
            ]}
          >
            <X color={colors.muted} size={12} weight="bold" />
          </Pressable>
        ) : null}
      </View>

      {stripCollapsed ? null : (
        <>
          <View style={styles.list}>
            {jobs.map((job, jobIndex) => {
              const expanded = expandedId === job.id;
              const logs = job.logLines ?? [];
              const canOpen =
                job.result !== undefined &&
                job.result.kind !== "none" &&
                onOpenJob !== undefined;
              const jobWorking =
                job.status === "running" || job.status === "queued";
              return (
                <View
                  key={job.id}
                  style={[styles.jobBlock, expanded && styles.jobBlockExpanded]}
                >
                  <Pressable
                    accessibilityHint="Show live progress and open the result"
                    accessibilityRole="button"
                    accessibilityState={{ expanded }}
                    onPress={() =>
                      setExpandedId((current) =>
                        current === job.id ? undefined : job.id
                      )
                    }
                    style={({ pressed }) => [
                      styles.jobRow,
                      pressed && styles.pressed
                    ]}
                  >
                    {expanded ? (
                      <CaretDown color={colors.muted} size={11} weight="bold" />
                    ) : (
                      <CaretRight
                        color={colors.muted}
                        size={11}
                        weight="bold"
                      />
                    )}
                    <Text numberOfLines={1} style={styles.jobTitle}>
                      {job.title}
                    </Text>
                    {jobWorking ? (
                      <WorkingQuipStatus
                        active
                        seed={jobIndex * 7 + 3}
                        style={styles.jobQuip}
                      />
                    ) : (
                      <Text
                        numberOfLines={1}
                        style={[
                          styles.jobStatus,
                          job.status === "done" && styles.jobStatusDone,
                          job.status === "error" && styles.jobStatusError
                        ]}
                      >
                        {job.detail !== undefined &&
                        job.detail.trim().length > 0
                          ? job.detail.trim()
                          : statusLabel(job.status)}
                      </Text>
                    )}
                  </Pressable>
                  {expanded ? (
                    <View style={styles.jobDetail}>
                      {jobWorking ? (
                        <WorkingQuipStatus
                          active
                          seed={jobIndex * 7 + 3}
                          style={styles.logQuip}
                        />
                      ) : null}
                      {logs.length > 0 ? (
                        <View style={styles.logBlock}>
                          {logs.map((line, index) => (
                            <Text
                              key={`${job.id}-log-${index}`}
                              style={[
                                styles.logLine,
                                index === logs.length - 1 &&
                                  job.status === "running" &&
                                  styles.logLineLive
                              ]}
                            >
                              {line}
                            </Text>
                          ))}
                        </View>
                      ) : jobWorking ? null : (
                        <Text style={styles.logLine}>
                          {statusLabel(job.status)}
                        </Text>
                      )}
                      {job.result?.preview !== undefined &&
                      job.result.preview.trim().length > 0 ? (
                        <Text numberOfLines={8} style={styles.preview}>
                          {job.result.preview.trim()}
                        </Text>
                      ) : null}
                      {canOpen ? (
                        <Pressable
                          accessibilityRole="button"
                          onPress={() => onOpenJob(job.id)}
                          style={({ pressed }) => [
                            styles.openButton,
                            pressed && styles.pressed
                          ]}
                        >
                          <Text style={styles.openButtonText}>
                            {job.result!.openLabel}
                          </Text>
                        </Pressable>
                      ) : null}
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
          {actions.length > 0 && onAction !== undefined ? (
            <View style={styles.actions}>
              {actions.map((action) => (
                <Pressable
                  accessibilityRole="button"
                  key={action.id}
                  onPress={() => onAction(action.id)}
                  style={({ pressed }) => [
                    styles.actionChip,
                    action.id === "review-plans" && styles.actionChipPrimary,
                    pressed && styles.pressed
                  ]}
                >
                  <Text
                    style={[
                      styles.actionChipText,
                      action.id === "review-plans" &&
                        styles.actionChipPrimaryText
                    ]}
                  >
                    {action.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    backgroundColor: colors.wash,
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    flexShrink: 0,
    gap: 6,
    paddingBottom: 8,
    paddingHorizontal: 10,
    paddingTop: 8
  },
  header: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 4,
    justifyContent: "space-between"
  },
  headerHit: {
    alignItems: "flex-start",
    flex: 1,
    flexDirection: "row",
    gap: 6,
    minWidth: 0,
    paddingVertical: 2
  },
  headerCopy: {
    flex: 1,
    gap: 2,
    minWidth: 0
  },
  summary: {
    color: colors.ink,
    fontFamily: fonts.uiSemibold,
    fontSize: 11,
    lineHeight: 15
  },
  progress: {
    color: colors.kicker,
    fontFamily: fonts.uiMedium,
    fontSize: 10,
    lineHeight: 13
  },
  collapsedHint: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 9,
    lineHeight: 12
  },
  quipRow: {
    alignItems: "baseline",
    flexDirection: "row",
    flexShrink: 1,
    maxWidth: "46%"
  },
  quipText: {
    color: colors.kicker,
    fontFamily: fonts.uiMedium,
    fontSize: 10,
    lineHeight: 13
  },
  ellipsis: {
    color: colors.kicker,
    fontFamily: fonts.uiMedium,
    fontSize: 10,
    lineHeight: 13
  },
  dismissButton: {
    borderRadius: 6,
    padding: 4
  },
  list: {
    backgroundColor: colors.paper,
    borderColor: colors.line,
    borderRadius: 10,
    borderWidth: 1,
    overflow: "hidden"
  },
  jobBlock: {
    borderBottomColor: colors.line,
    borderBottomWidth: StyleSheet.hairlineWidth
  },
  jobBlockExpanded: {
    backgroundColor: colors.wash
  },
  jobRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    justifyContent: "space-between",
    paddingHorizontal: 9,
    paddingVertical: 7
  },
  jobTitle: {
    color: colors.ink,
    flex: 1,
    fontFamily: fonts.ui,
    fontSize: 11
  },
  jobQuip: {
    fontSize: 10,
    textAlign: "right"
  },
  logQuip: {
    fontSize: 11
  },
  jobStatus: {
    color: colors.muted,
    fontFamily: fonts.uiSemibold,
    fontSize: 10,
    maxWidth: "38%",
    textAlign: "right"
  },
  jobStatusDone: {
    color: colors.green
  },
  jobStatusError: {
    color: colors.red
  },
  jobDetail: {
    gap: 7,
    paddingBottom: 9,
    paddingHorizontal: 12,
    paddingTop: 0
  },
  logBlock: {
    gap: 2
  },
  logLine: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 10,
    lineHeight: 14
  },
  logLineLive: {
    color: colors.ink,
    fontFamily: fonts.uiMedium
  },
  preview: {
    color: colors.ink,
    fontFamily: fonts.ui,
    fontSize: 10,
    lineHeight: 14
  },
  openButton: {
    alignSelf: "flex-start",
    backgroundColor: colors.rail,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6
  },
  openButtonText: {
    color: "#ffffff",
    fontFamily: fonts.uiSemibold,
    fontSize: 10
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6
  },
  actionChip: {
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
  actionChipPrimary: {
    backgroundColor: colors.rail,
    borderColor: colors.rail
  },
  actionChipText: {
    color: colors.ink,
    fontFamily: fonts.uiSemibold,
    fontSize: 10
  },
  actionChipPrimaryText: {
    color: "#ffffff"
  },
  pressed: {
    opacity: 0.72
  }
});
