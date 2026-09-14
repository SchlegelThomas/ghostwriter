import { useEffect, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import {
  STORY_CHECK_MAX_DEFER_REASON_CHARS,
  type SceneId,
  type StoryCheckFindingResolution,
  type StoryCheckFindingV1,
  type StoryCheckStoredPayloadFreshness,
  type StoryKnowledgeId,
  type StoryWorkArtifactPointer
} from "@ghostwriter/core";
import {
  sameStoryCheckReviewArtifact,
  storyCheckAnchorEvidenceLabel,
  storyCheckCoveragePresentation,
  storyCheckFindingKindLabel,
  storyCheckFindingSeverityLabel,
  storyCheckFreshnessHeadline,
  storyCheckFreshnessReasonCopy,
  storyCheckLinkedRecheckSceneLabel,
  storyCheckResolutionEditorDirty,
  storyCheckResolutionFromDraft,
  storyCheckReviewCanComplete,
  storyCheckRevisionPrefillInstruction,
  storyCheckSpecialistLabel,
  storyCheckStaleInspectCopy,
  storyCheckTargetModeLabel,
  validateStoryCheckDeferReason,
  type StoryCheckResolutionEditorDraft,
  type StoryCheckReviewArtifact,
  type StoryCheckReviewResolveInput,
  type StoryCheckReviewSceneLabel
} from "./story-check-review.js";
import { ghostwriterTheme } from "./theme.js";

const { colors, fonts } = ghostwriterTheme;
const REVIEW_HEADING_ID = "story-check-review-heading";

export type StoryCheckReviewProps = Readonly<{
  artifact: StoryCheckReviewArtifact;
  freshness: StoryCheckStoredPayloadFreshness;
  sceneLabels: readonly StoryCheckReviewSceneLabel[];
  brief: string;
  constraints: string;
  doneWhen: string;
  refreshProblem?: string;
  status: "review" | "reviewed" | "rejected";
  onResolve(input: StoryCheckReviewResolveInput): Promise<StoryCheckReviewArtifact>;
  onComplete(artifact: StoryWorkArtifactPointer): Promise<void>;
  onClose(): void;
  onReload?(): Promise<void>;
  onOpenScene(input: Readonly<{ sceneId: SceneId; blockId?: string }>): void;
  onStartRevisionAssignment(input: Readonly<{
    artifact: StoryWorkArtifactPointer;
    findingId: string;
    prefilledBrief: string;
  }>): void;
  onOpenStoryIntent?(input: Readonly<{
    sceneId?: SceneId;
    storyKnowledgeId?: StoryKnowledgeId;
  }>): void;
  onDirtyChange?(dirty: boolean): void;
  onBusyChange?(busy: boolean): void;
}>;

/** Presentational check review only. Freshness, leases and navigation stay with the caller. */
export function StoryCheckReview(props: StoryCheckReviewProps) {
  const [baseline, setBaseline] = useState(props.artifact);
  const [resolutionEditor, setResolutionEditor] = useState<
    StoryCheckResolutionEditorDraft | undefined
  >();
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();

  const payloadStale = props.freshness.status === "needs-recheck";
  const artifactStale = !sameStoryCheckReviewArtifact(
    baseline.pointer,
    props.artifact.pointer
  );
  const dirty =
    props.status === "review" && storyCheckResolutionEditorDirty(resolutionEditor);
  const writable = props.status === "review" && !pending && !artifactStale;
  const canComplete =
    writable &&
    !dirty &&
    !payloadStale &&
    !artifactStale &&
    storyCheckReviewCanComplete(props.freshness, baseline.payload);
  const coverage = storyCheckCoveragePresentation(
    baseline.payload.coverage,
    props.sceneLabels
  );

  useEffect(() => {
    props.onDirtyChange?.(dirty);
  }, [dirty, props.onDirtyChange]);
  useEffect(() => () => props.onDirtyChange?.(false), [props.onDirtyChange]);
  useEffect(() => {
    if (typeof document === "undefined") return;
    const timer = setTimeout(() => {
      const heading = document.getElementById(REVIEW_HEADING_ID);
      if (!(heading instanceof HTMLElement)) return;
      heading.tabIndex = -1;
      heading.focus();
    }, 30);
    return () => clearTimeout(timer);
  }, []);

  async function perform(action: () => Promise<void>, success: string) {
    if (pendingRef.current) return;
    pendingRef.current = true;
    props.onBusyChange?.(true);
    setPending(true);
    setMessage(undefined);
    setError(undefined);
    try {
      await action();
      setMessage(success);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The action was not acknowledged. Your review is still here."
      );
    } finally {
      pendingRef.current = false;
      setPending(false);
      props.onBusyChange?.(false);
    }
  }

  function reloadArtifact() {
    setBaseline(props.artifact);
    setResolutionEditor(undefined);
    setMessage("Latest artifact loaded.");
    setError(undefined);
  }

  function resolveFinding(
    findingId: string,
    status: "dismissed" | "deferred" | "open",
    deferReason?: string
  ) {
    if (!writable || pendingRef.current) return;
    let resolution: StoryCheckFindingResolution;
    if (status === "open") {
      resolution = { status: "open" };
    } else {
      const parsed = storyCheckResolutionFromDraft(status, deferReason);
      if ("error" in parsed) {
        setError(parsed.error);
        return;
      }
      resolution = parsed;
    }
    const success =
      status === "open"
        ? "Finding reopened."
        : status === "dismissed"
          ? "Finding dismissed."
          : "Finding deferred.";
    void perform(async () => {
      const saved = await props.onResolve({
        artifact: baseline.pointer,
        findingId,
        resolution
      });
      setBaseline(saved);
      setResolutionEditor(undefined);
    }, success);
  }

  const statusKicker =
    props.status === "reviewed"
      ? "REVIEW COMPLETE"
      : props.status === "rejected"
        ? "REJECTED"
        : "REVIEW";

  return (
    <View accessibilityLabel="Story check review" style={styles.root}>
      <View style={styles.header}>
        <View style={styles.heading}>
          <Text style={styles.kicker}>
            CHECK · {storyCheckSpecialistLabel(baseline.payload.specialist).toUpperCase()} ·{" "}
            {statusKicker}
          </Text>
          <Text
            accessibilityRole="header"
            nativeID={REVIEW_HEADING_ID}
            style={styles.title}
          >
            {storyCheckTargetModeLabel(baseline.payload.target)}
          </Text>
        </View>
        <Action
          label="Back to story"
          disabled={pending}
          onPress={() => {
            if (dirty) {
              setError(
                "Save or cancel the open defer reason before leaving this review."
              );
              return;
            }
            props.onClose();
          }}
        />
      </View>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.panel}>
          <Text style={styles.sectionTitle}>Freshness</Text>
          <Text style={styles.body}>{storyCheckFreshnessHeadline(props.freshness)}</Text>
          {props.freshness.status === "needs-recheck" ? (
            <>
              {props.freshness.reasons.map((entry) => (
                <Text key={entry.dependencyKey} style={styles.body}>
                  {storyCheckFreshnessReasonCopy(entry.reason)}
                </Text>
              ))}
              <Text style={styles.hint}>{storyCheckStaleInspectCopy()}</Text>
            </>
          ) : (
            <Text style={styles.hint}>
              Source heads still match the dependency vector recorded with this artifact.
            </Text>
          )}
        </View>

        <View style={styles.panel}>
          <Text style={styles.sectionTitle}>Requested coverage</Text>
          <Text style={styles.label}>Target mode</Text>
          <Text style={styles.body}>
            {storyCheckTargetModeLabel(baseline.payload.target)}
          </Text>
          <Text style={styles.label}>Scope</Text>
          <Text style={styles.body}>{coverage.requestedScopeSummary}</Text>
          <Text style={styles.label}>{coverage.completenessLabel}</Text>
          {coverage.limitedCoverageNotice ? (
            <Text style={styles.warning}>{coverage.limitedCoverageNotice}</Text>
          ) : null}
          <Text style={styles.label}>Examined scenes</Text>
          {coverage.examinedLines.length === 0 ? (
            <Text style={styles.hint}>No scene prose was examined.</Text>
          ) : (
            coverage.examinedLines.map((line) => (
              <Text key={line} style={styles.body}>
                {line}
              </Text>
            ))
          )}
          {coverage.skippedLines.length ? (
            <>
              <Text style={styles.label}>Skipped scenes</Text>
              {coverage.skippedLines.map((line) => (
                <Text key={line} style={styles.body}>
                  {line}
                </Text>
              ))}
            </>
          ) : null}
          {coverage.truncationLines.length ? (
            <>
              <Text style={styles.label}>Truncations</Text>
              {coverage.truncationLines.map((line) => (
                <Text key={line} style={styles.body}>
                  {line}
                </Text>
              ))}
            </>
          ) : null}
          {baseline.payload.linkedRecheckSceneIds.length ? (
            <>
              <Text style={styles.label}>Linked recheck scenes</Text>
              {baseline.payload.linkedRecheckSceneIds.map((linkedSceneId) => (
                <Text key={linkedSceneId} style={styles.body}>
                  {storyCheckLinkedRecheckSceneLabel(
                    linkedSceneId,
                    props.sceneLabels
                  )}
                </Text>
              ))}
            </>
          ) : null}
        </View>

        <Text style={styles.label}>Your original brief</Text>
        <Text style={styles.body}>{props.brief}</Text>
        <Text style={styles.label}>Constraints</Text>
        <Text style={styles.body}>{props.constraints}</Text>
        <Text style={styles.label}>Done when</Text>
        <Text style={styles.body}>{props.doneWhen}</Text>

        {artifactStale ? (
          <View style={styles.notice}>
            <Text style={styles.body}>
              {dirty
                ? "A newer artifact is available. Cancel the open defer reason and load the latest artifact before resolving findings."
                : "A newer artifact is ready. Load it before resolving findings or completing this review."}
            </Text>
            <Action
              label={dirty ? "Cancel defer and load latest artifact" : "Load latest artifact"}
              disabled={pending}
              onPress={() => {
                setResolutionEditor(undefined);
                reloadArtifact();
              }}
            />
          </View>
        ) : null}

        <Text style={styles.sectionTitle}>
          Findings · {baseline.payload.findings.length}
        </Text>
        {baseline.payload.findings.length === 0 ? (
          <Text style={styles.hint}>
            No findings were returned for this scope. Limited coverage still means the check is not
            a whole-book pass.
          </Text>
        ) : (
          baseline.payload.findings.map((finding) => (
            <FindingCard
              key={finding.id}
              finding={finding}
              sceneLabels={props.sceneLabels}
              linkedRecheckSceneIds={baseline.payload.linkedRecheckSceneIds}
              writable={writable}
              payloadStale={payloadStale}
              pending={pending}
              resolutionEditor={resolutionEditor}
              onOpenScene={props.onOpenScene}
              onOpenStoryIntent={props.onOpenStoryIntent}
              onStartRevision={(findingId) => {
                props.onStartRevisionAssignment({
                  artifact: baseline.pointer,
                  findingId,
                  prefilledBrief: storyCheckRevisionPrefillInstruction(finding)
                });
              }}
              onDismiss={() => resolveFinding(finding.id, "dismissed")}
              onDeferOpen={() =>
                setResolutionEditor({
                  findingId: finding.id,
                  status: "deferred",
                  reason:
                    finding.resolution.status === "deferred"
                      ? finding.resolution.reason
                      : ""
                })
              }
              onDeferApply={(reason) => resolveFinding(finding.id, "deferred", reason)}
              onReopen={() => resolveFinding(finding.id, "open")}
              onResolutionEditorChange={(reason) => {
                if (resolutionEditor?.findingId !== finding.id) return;
                setResolutionEditor({ ...resolutionEditor, reason });
              }}
              onCancelEditor={() => {
                setResolutionEditor(undefined);
                setError(undefined);
              }}
            />
          ))
        )}

        {props.status === "review" ? (
          <>
            <Action
              label="Complete review"
              primary
              disabled={!canComplete}
              onPress={() => {
                void perform(
                  () => props.onComplete(baseline.pointer),
                  "Check review marked complete. No canonical story state was changed."
                );
              }}
            />
            {payloadStale || artifactStale ? (
              <Text style={styles.hint}>
                Load a fresh check or the latest artifact before completing this review.
              </Text>
            ) : null}
            {dirty ? (
              <Text style={styles.hint}>
                Save or cancel the open defer reason before completing this review.
              </Text>
            ) : null}
          </>
        ) : null}

        {message ? (
          <Text accessibilityLiveRegion="polite" style={styles.success}>
            {message}
          </Text>
        ) : null}
        {error || props.refreshProblem ? (
          <View style={styles.field}>
            <Text accessibilityRole="alert" style={styles.error}>
              {error ?? props.refreshProblem}
            </Text>
            {props.onReload ? (
              <Action
                label="Refresh saved review and story"
                disabled={pending}
                onPress={() => {
                  void perform(
                    () => props.onReload!(),
                    "Latest saved review and story loaded."
                  );
                }}
              />
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

function FindingCard({
  finding,
  sceneLabels,
  linkedRecheckSceneIds,
  writable,
  payloadStale,
  pending,
  resolutionEditor,
  onOpenScene,
  onOpenStoryIntent,
  onStartRevision,
  onDismiss,
  onDeferOpen,
  onDeferApply,
  onReopen,
  onResolutionEditorChange,
  onCancelEditor
}: Readonly<{
  finding: StoryCheckFindingV1;
  sceneLabels: readonly StoryCheckReviewSceneLabel[];
  linkedRecheckSceneIds: readonly SceneId[];
  writable: boolean;
  payloadStale: boolean;
  pending: boolean;
  resolutionEditor: StoryCheckResolutionEditorDraft | undefined;
  onOpenScene(input: Readonly<{ sceneId: SceneId; blockId?: string }>): void;
  onOpenStoryIntent?(input: Readonly<{
    sceneId?: SceneId;
    storyKnowledgeId?: StoryKnowledgeId;
  }>): void;
  onStartRevision(findingId: string): void;
  onDismiss(): void;
  onDeferOpen(): void;
  onDeferApply(reason: string): void;
  onReopen(): void;
  onResolutionEditorChange(reason: string): void;
  onCancelEditor(): void;
}>) {
  const editing = resolutionEditor?.findingId === finding.id;
  const deferError = editing
    ? validateStoryCheckDeferReason(resolutionEditor.reason)
    : undefined;
  const resolutionLabel =
    finding.resolution.status === "open"
      ? "Open"
      : finding.resolution.status === "dismissed"
        ? "Dismissed"
        : "Deferred";
  const actionReady = writable && !pending && !editing;

  return (
    <View style={styles.findingCard}>
      <Text style={styles.label}>
        {storyCheckFindingKindLabel(finding.kind)} ·{" "}
        {storyCheckFindingSeverityLabel(finding.severity)} · {resolutionLabel}
      </Text>
      <Text style={styles.body}>{finding.claim}</Text>
      {finding.nextStep ? (
        <>
          <Text style={styles.label}>Suggested next step</Text>
          <Text style={styles.body}>{finding.nextStep}</Text>
        </>
      ) : null}
      <Text style={styles.label}>Evidence</Text>
      {finding.anchors.map((anchor, index) => (
        <View key={`${finding.id}-anchor-${index}`} style={styles.anchorRow}>
          <Text style={styles.body}>
            {storyCheckAnchorEvidenceLabel(anchor, sceneLabels)}
          </Text>
          <Action
            label="Open scene"
            disabled={pending}
            onPress={() =>
              onOpenScene({
                sceneId: anchor.sceneId,
                blockId: anchor.blockId
              })
            }
          />
          {anchor.storyKnowledgeId !== undefined && onOpenStoryIntent ? (
            <Action
              label="Open story intent"
              disabled={pending}
              onPress={() =>
                onOpenStoryIntent({
                  sceneId: anchor.sceneId,
                  storyKnowledgeId: anchor.storyKnowledgeId
                })
              }
            />
          ) : null}
        </View>
      ))}
      {linkedRecheckSceneIds.length ? (
        <>
          <Text style={styles.label}>Consider rechecking</Text>
          {linkedRecheckSceneIds.map((sceneId) => (
            <Text key={`${finding.id}-${sceneId}`} style={styles.hint}>
              {storyCheckLinkedRecheckSceneLabel(sceneId, sceneLabels)}
            </Text>
          ))}
        </>
      ) : null}
      <View style={styles.actions}>
        {finding.resolution.status === "open" ? (
          <>
            <Action label="Dismiss" disabled={!actionReady} onPress={onDismiss} />
            <Action
              label="Defer"
              disabled={!actionReady}
              onPress={onDeferOpen}
            />
          </>
        ) : (
          <Action label="Reopen" disabled={!actionReady} onPress={onReopen} />
        )}
        <Action
          label="Start revision assignment"
          disabled={!actionReady || payloadStale}
          onPress={() => onStartRevision(finding.id)}
        />
      </View>
      {editing ? (
        <View style={styles.field}>
          <Text style={styles.label}>Defer reason</Text>
          <TextInput
            accessibilityLabel="Defer reason"
            editable={actionReady}
            multiline
            maxLength={STORY_CHECK_MAX_DEFER_REASON_CHARS}
            value={resolutionEditor.reason}
            onChangeText={onResolutionEditorChange}
            style={[styles.input, styles.multiline]}
          />
          {deferError ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {deferError}
            </Text>
          ) : null}
          <View style={styles.actions}>
            <Action
              label="Save defer"
              disabled={!actionReady || deferError !== undefined}
              onPress={() => onDeferApply(resolutionEditor.reason)}
            />
            <Action label="Cancel" disabled={pending} onPress={onCancelEditor} />
          </View>
        </View>
      ) : null}
      {payloadStale ? (
        <Text style={styles.hint}>
          Source changed since this check ran. You can still inspect this finding, but start a fresh
          check before relying on it.
        </Text>
      ) : null}
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
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.button,
        primary && styles.primary,
        disabled && styles.disabled
      ]}
    >
      <Text style={[styles.buttonText, primary && styles.primaryText]}>
        {label}
      </Text>
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
    alignItems: "center",
    gap: 12,
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: colors.line
  },
  heading: { flex: 1, minWidth: 160 },
  kicker: {
    fontFamily: fonts.uiSemibold,
    color: colors.accent,
    fontSize: 10,
    letterSpacing: 1
  },
  title: { fontFamily: fonts.story, color: colors.ink, fontSize: 28, marginTop: 4 },
  content: { padding: 20, gap: 16, width: "100%", alignSelf: "stretch" },
  field: { gap: 7 },
  label: { fontFamily: fonts.uiSemibold, color: colors.ink, fontSize: 13 },
  sectionTitle: { fontFamily: fonts.story, color: colors.ink, fontSize: 21 },
  body: { fontFamily: fonts.ui, color: colors.ink, fontSize: 14, lineHeight: 21 },
  hint: { fontFamily: fonts.ui, color: colors.muted, fontSize: 12, lineHeight: 18 },
  panel: {
    gap: 8,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    backgroundColor: colors.panel
  },
  findingCard: {
    gap: 8,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    backgroundColor: colors.panel
  },
  anchorRow: { gap: 8 },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    padding: 12,
    fontFamily: fonts.ui,
    fontSize: 14,
    color: colors.ink,
    backgroundColor: colors.paper
  },
  multiline: { minHeight: 72, textAlignVertical: "top" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  button: {
    minHeight: 42,
    justifyContent: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    backgroundColor: colors.panel
  },
  buttonText: { fontFamily: fonts.uiSemibold, fontSize: 12, color: colors.ink },
  primary: { backgroundColor: colors.accent, borderColor: colors.accent },
  primaryText: { color: colors.panel },
  disabled: { opacity: 0.45 },
  notice: { backgroundColor: colors.amberSoft, padding: 12, borderRadius: 8, gap: 8 },
  warning: { color: colors.red, fontFamily: fonts.ui, fontSize: 13, lineHeight: 20 },
  success: { color: colors.green, fontFamily: fonts.ui, lineHeight: 20 },
  error: { color: colors.red, fontFamily: fonts.ui, lineHeight: 20 }
});
