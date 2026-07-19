import {
  SceneEditor,
  type SceneEditorInsertRequest
} from "@ghostwriter/editor/react";
import type {
  SceneBlockV1,
  SceneDocumentComparison,
  SceneDocumentV1
} from "@ghostwriter/editor";
import type {
  CharacterSheet,
  ProjectCommand,
  SceneSketch
} from "@ghostwriter/core";
import {
  ghostwriterTheme,
  type WriteComposition,
  type WriteInputModality
} from "@ghostwriter/ui";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState
} from "react";
import { WritingStudioLayer } from "./WritingStudioLayer.js";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import {
  acquireSceneLease,
  compareSceneRevisions,
  createSceneCheckpoint,
  createSceneVariant,
  getSceneHistory,
  getSceneWorkspace,
  GhostwriterApiError,
  releaseSceneLease,
  renewSceneLease,
  restoreSceneRevision,
  saveSceneDocument,
  type SceneHeadMetadataResponse,
  type SceneHeadResponse,
  type SceneHistoryResponse,
  type SceneLeaseResponse,
  type SceneRevisionMetadataResponse,
  type SceneWorkspaceResponse
} from "./api.js";
import {
  createSceneRecoveryCoordinator,
  decideSceneRecovery,
  sceneRecoveryService,
  type SceneRecoveryCoordinator,
  type SceneRecoveryEntry,
  type SceneRecoveryStorageMode
} from "./scene-recovery.js";
import {
  createSceneSaveQueue,
  type SceneSaveQueue,
  type SceneSaveQueueSnapshot
} from "./scene-save-queue.js";
import { sceneDocumentWordCount } from "./draft-desk.js";

const { colors, fonts } = ghostwriterTheme;
const LEASE_RENEWAL_INTERVAL_MS = 20_000;
const AUTOSAVE_DEBOUNCE_MS = 900;

export type DraftPanelHandle = Readonly<{
  flushAndRelease(): Promise<void>;
}>;

export type DraftPanelProps = Readonly<{
  accountId: string;
  projectId: string;
  projectVersion: number;
  sceneId: string;
  sceneTitle: string;
  sceneStatus?: string;
  sceneSummary?: string;
  sceneSketch?: SceneSketch;
  sceneBackdropUrl?: string;
  sceneBackdropCaption?: string;
  sceneCast?: readonly Readonly<{
    id: string;
    label: string;
    characterSheet?: CharacterSheet;
  }>[];
  povLabel?: string;
  scenePosition?: string;
  previousSceneTitle?: string;
  nextSceneTitle?: string;
  contextDockOpen?: boolean;
  focusHalo?: boolean;
  historyOpen?: boolean;
  readOnly?: boolean;
  writeComposition?: WriteComposition;
  writeModality?: WriteInputModality;
  assistOpen?: boolean;
  onWriteCompositionChange?(composition: WriteComposition): void;
  onWriteModalityChange?(modality: WriteInputModality): void;
  onAssistOpenChange?(open: boolean): void;
  onProjectCommand?(command: ProjectCommand): Promise<boolean>;
  onContextDockOpenChange?(open: boolean): void;
  onFocusHaloChange?(focused: boolean): void;
  onHistoryOpenChange?(open: boolean): void;
  onPreviousScene?(): void;
  onNextScene?(): void;
  onAcknowledgement?(event: DraftAcknowledgementEvent): void;
  onActivityChange?(activity: DraftActivity): void;
  onProblem?(problem: DraftProblemEvent): void;
  onProblemResolved?(id: string): void;
}>;

export type DraftActivity = "idle" | "saving" | "problem";

export type DraftAcknowledgementEvent = Readonly<{
  kind: "save" | "checkpoint" | "variant" | "restore";
  title: string;
  detail: string;
}>;

export type DraftProblemEvent = Readonly<{
  id: string;
  title: string;
  detail: string;
  tone: "warning" | "error";
}>;

type LeasePhase = "loading" | "acquiring" | "held" | "readonly";
type HistoryPhase = "loading" | "ready" | "error";

type DraftProblem =
  | Readonly<{
      kind: "revision";
      message: string;
      workspace?: SceneWorkspaceResponse;
    }>
  | Readonly<{ kind: "lease" | "save" | "load"; message: string }>;

const REVISION_REASON_LABELS: Readonly<
  Record<SceneRevisionMetadataResponse["reason"], string>
> = {
  genesis: "Original Draft",
  checkpoint: "Checkpoint",
  "idle-checkpoint": "Automatic checkpoint",
  restore: "Restored Draft",
  "schema-migration": "Updated Draft format"
};

function formatRevisionTime(timestamp: string): string {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? timestamp : date.toLocaleString();
}

function actorLabel(
  revision: SceneRevisionMetadataResponse,
  accountId: string
): string {
  if (revision.origin === "system") return "Ghostwriter";
  if (revision.origin === "agent") return "Writing agent";
  return revision.actorAccountId === accountId ? "You" : "Another contributor";
}

function blockText(block: SceneBlockV1 | null): string {
  if (block === null) return "";
  if (block.type === "horizontalRule") return "Scene break";
  const content = block.content ?? [];
  const text = content
    .map((node) => {
      if (node.type === "text") return node.text;
      if (node.type === "hardBreak") return "\n";
      return blockText(node);
    })
    .join("")
    .trim();
  if (text.length <= 240) return text;
  return `${text.slice(0, 237)}…`;
}

function fullHeadFromMetadata(
  metadata: SceneHeadMetadataResponse,
  document: SceneDocumentV1
): SceneHeadResponse {
  return { ...metadata, document };
}

function DraftButton({
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
        pressed && styles.buttonPressed,
        disabled && styles.buttonDisabled
      ]}
    >
      <Text style={[styles.buttonText, primary && styles.buttonTextPrimary]}>
        {label}
      </Text>
    </Pressable>
  );
}

function DraftHistoryArea({
  accountId,
  history,
  phase,
  error,
  notice,
  currentCheckpointRevisionId,
  selectedRevisionId,
  comparison,
  variantName,
  busy,
  workingMessage,
  canMutate,
  confirmingRestore,
  onReload,
  onSelectRevision,
  onCheckpoint,
  onVariantNameChange,
  onCreateVariant,
  onCompare,
  onRequestRestore,
  onCancelRestore,
  onConfirmRestore
}: Readonly<{
  accountId: string;
  history: SceneHistoryResponse | undefined;
  phase: HistoryPhase;
  error: string | undefined;
  notice: string | undefined;
  currentCheckpointRevisionId: string | undefined;
  selectedRevisionId: string | undefined;
  comparison: SceneDocumentComparison | undefined;
  variantName: string;
  busy: boolean;
  workingMessage: string | undefined;
  canMutate: boolean;
  confirmingRestore: boolean;
  onReload(): void;
  onSelectRevision(revisionId: string): void;
  onCheckpoint(): void;
  onVariantNameChange(name: string): void;
  onCreateVariant(): void;
  onCompare(): void;
  onRequestRestore(): void;
  onCancelRestore(): void;
  onConfirmRestore(): void;
}>) {
  const revisions = history?.revisions ?? [];
  const variants = history?.variants ?? [];
  const selectedRevision = revisions.find(
    (revision) => revision.id === selectedRevisionId
  );
  const changedBlocks =
    comparison?.blocks.filter((block) => block.changes.length > 0) ?? [];
  const counts = {
    added: changedBlocks.filter((block) => block.changes.includes("added"))
      .length,
    removed: changedBlocks.filter((block) => block.changes.includes("removed"))
      .length,
    changed: changedBlocks.filter((block) => block.changes.includes("changed"))
      .length,
    moved: changedBlocks.filter((block) => block.changes.includes("moved"))
      .length
  };

  return (
    <View accessibilityLabel="Draft history" style={styles.history}>
      <View style={styles.historyHeading}>
        <View style={styles.historyHeadingCopy}>
          <Text style={styles.historyEyebrow}>History</Text>
          <Text style={styles.historyTitle}>Keep the turns that matter</Text>
          <Text style={styles.historyIntro}>
            Checkpoints and named variants preserve acknowledged prose. Working
            saves remain separate.
          </Text>
        </View>
        <DraftButton
          disabled={!canMutate || busy}
          label={busy ? "Working…" : "Create checkpoint"}
          onPress={onCheckpoint}
          primary
        />
      </View>

      <View style={styles.variantRow}>
        <View style={styles.variantField}>
          <Text style={styles.fieldLabel}>Variant name</Text>
          <TextInput
            accessibilityLabel="Variant name"
            editable={canMutate && !busy}
            maxLength={100}
            onChangeText={onVariantNameChange}
            placeholder="Alternate ending"
            placeholderTextColor={colors.muted}
            style={styles.textInput}
            value={variantName}
          />
        </View>
        <DraftButton
          disabled={!canMutate || busy || variantName.trim().length === 0}
          label="Create named variant"
          onPress={onCreateVariant}
        />
      </View>

      {notice === undefined ? null : (
        <Text accessibilityLiveRegion="polite" style={styles.historyNotice}>
          {notice}
        </Text>
      )}
      {workingMessage === undefined ? null : (
        <Text accessibilityLiveRegion="polite" style={styles.historyWorking}>
          {workingMessage}
        </Text>
      )}
      {error === undefined ? null : (
        <View accessibilityRole="alert" style={styles.historyError}>
          <Text style={styles.problemText}>{error}</Text>
          <View style={styles.actionRow}>
            <DraftButton
              disabled={busy}
              label="Reload history"
              onPress={onReload}
            />
          </View>
        </View>
      )}

      {phase === "loading" ? (
        <Text style={styles.historyEmpty}>Loading Draft history…</Text>
      ) : revisions.length === 0 ? (
        <Text style={styles.historyEmpty}>
          No checkpoints are available for this Draft yet.
        </Text>
      ) : (
        <View style={styles.historyColumns}>
          <View style={styles.historyColumn}>
            <Text style={styles.historySectionTitle}>Checkpoints</Text>
            <View style={styles.revisionList}>
              {revisions.map((revision, index) => {
                const selected = revision.id === selectedRevisionId;
                const current =
                  revision.id === currentCheckpointRevisionId;
                return (
                  <Pressable
                    accessibilityLabel={`Select revision ${index + 1}: ${
                      REVISION_REASON_LABELS[revision.reason]
                    }`}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    key={revision.id}
                    onPress={() => onSelectRevision(revision.id)}
                    style={({ pressed }) => [
                      styles.revision,
                      selected && styles.revisionSelected,
                      pressed && styles.buttonPressed
                    ]}
                  >
                    <View style={styles.revisionTitleRow}>
                      <Text style={styles.revisionTitle}>
                        {REVISION_REASON_LABELS[revision.reason]}
                      </Text>
                      {current ? (
                        <Text style={styles.currentCheckpoint}>
                          Current checkpoint
                        </Text>
                      ) : null}
                    </View>
                    <Text style={styles.revisionMeta}>
                      {actorLabel(revision, accountId)} ·{" "}
                      {formatRevisionTime(revision.createdAt)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={styles.historyColumn}>
            <Text style={styles.historySectionTitle}>Named variants</Text>
            {variants.length === 0 ? (
              <Text style={styles.historyEmpty}>No named variants yet.</Text>
            ) : (
              <View style={styles.variantList}>
                {variants.map((variant) => (
                  <View key={variant.id} style={styles.variant}>
                    <Text style={styles.variantName}>{variant.name}</Text>
                    <Text style={styles.revisionMeta}>
                      {variant.creatorAccountId === accountId
                        ? "You"
                        : "Another contributor"}{" "}
                      · {formatRevisionTime(variant.createdAt)}
                      {variant.revisionId === currentCheckpointRevisionId
                        ? " · Current checkpoint"
                        : ""}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        </View>
      )}

      {selectedRevision === undefined ? null : (
        <View style={styles.reviewArea}>
          <Text style={styles.historySectionTitle}>Review selection</Text>
          <Text style={styles.reviewMeta}>
            {REVISION_REASON_LABELS[selectedRevision.reason]} from{" "}
            {formatRevisionTime(selectedRevision.createdAt)}
          </Text>
          <View style={styles.actionRow}>
            <DraftButton
              disabled={busy || currentCheckpointRevisionId === undefined}
              label="Compare with current checkpoint"
              onPress={onCompare}
            />
            <DraftButton
              disabled={!canMutate || busy}
              label="Restore this revision"
              onPress={onRequestRestore}
            />
          </View>

          {confirmingRestore ? (
            <View accessibilityRole="alert" style={styles.restoreConfirmation}>
              <Text style={styles.problemText}>
                Restore this revision as the new Draft? The current working
                prose will be replaced, while every existing checkpoint stays
                in History. Ghostwriter will not combine the two versions.
              </Text>
              <View style={styles.actionRow}>
                <DraftButton
                  disabled={busy}
                  label="Confirm restore"
                  onPress={onConfirmRestore}
                  primary
                />
                <DraftButton
                  disabled={busy}
                  label="Cancel restore"
                  onPress={onCancelRestore}
                />
              </View>
            </View>
          ) : null}
        </View>
      )}

      {comparison === undefined ? null : (
        <View accessibilityLabel="Revision comparison" style={styles.comparison}>
          {comparison.equal ? (
            <Text style={styles.comparisonSummary}>
              These checkpoints contain the same blocks.
            </Text>
          ) : (
            <>
              <Text
                accessibilityLabel="Comparison summary"
                style={styles.comparisonSummary}
              >
                {counts.added} added · {counts.removed} removed ·{" "}
                {counts.changed} changed · {counts.moved} moved
              </Text>
              <View style={styles.comparisonBlocks}>
                {changedBlocks.map((block, index) => {
                  const changeLabels = block.changes.map((change) => {
                    if (change === "added") return "Added";
                    if (change === "removed") return "Removed";
                    if (change === "changed") return "Changed";
                    return "Moved";
                  });
                  const before = blockText(block.before);
                  const after = blockText(block.after);
                  return (
                    <View key={`${block.blockId}-${index}`} style={styles.change}>
                      <Text style={styles.changeTitle}>
                        {changeLabels.join(" and ")} block
                      </Text>
                      {before.length === 0 ? null : (
                        <View style={styles.excerpt}>
                          <Text style={styles.excerptLabel}>Selected revision</Text>
                          <Text style={styles.excerptText}>{before}</Text>
                        </View>
                      )}
                      {after.length === 0 ? null : (
                        <View style={styles.excerpt}>
                          <Text style={styles.excerptLabel}>
                            Current checkpoint
                          </Text>
                          <Text style={styles.excerptText}>{after}</Text>
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>
            </>
          )}
        </View>
      )}
    </View>
  );
}

function messageForLeaseFailure(cause: unknown): string {
  if (
    cause instanceof GhostwriterApiError &&
    cause.code === "LEASE_CONFLICT"
  ) {
    return (
      "This Draft is read-only because another browser session is editing it. " +
      "Only one direct editor is allowed at a time; Ghostwriter does not show live presence yet."
    );
  }
  if (
    cause instanceof GhostwriterApiError &&
    cause.code === "LEASE_EXPIRED"
  ) {
    return (
      "Editing timed out. Your unsaved Draft remains in local recovery for review; " +
      "retry editing to continue."
    );
  }
  if (cause instanceof GhostwriterApiError && cause.status === 401) {
    return "Your session ended. This Draft is read-only until you sign in again.";
  }
  return (
    "Ghostwriter could not confirm exclusive editing for this scene. The Draft is read-only, " +
    "and any captured unacknowledged prose remains in local recovery."
  );
}

function messageForLoadFailure(cause: unknown): string {
  if (cause instanceof GhostwriterApiError && cause.status === 401) {
    return "Your session ended. Sign in again before loading this Draft.";
  }
  return cause instanceof Error
    ? cause.message
    : "Ghostwriter could not load this Draft.";
}

function saveStatusText(
  snapshot: SceneSaveQueueSnapshot | undefined,
  problem: DraftProblem | undefined
): string {
  if (snapshot === undefined) return "Loading Draft…";
  if (problem?.kind === "revision") return "Revision conflict · not saved";
  if (snapshot.status === "saving") return "Saving…";
  if (snapshot.status === "pending") return "Waiting to save…";
  if (snapshot.dirty) return "Not saved";
  return "Saved to project";
}

function leaseStatusText(
  phase: LeasePhase,
  readOnly: boolean,
  lease: SceneLeaseResponse | undefined
): string {
  if (phase === "loading") return "Opening Draft…";
  if (phase === "acquiring") return "Opening this scene for editing…";
  if (phase === "held" && lease !== undefined) {
    return "Editing here · stays active while you write";
  }
  return readOnly ? "Read-only · archived scene" : "Read-only";
}

function recentProseFromDocument(
  document: SceneDocumentV1 | undefined
): string {
  if (document === undefined) return "";
  const chunks: string[] = [];
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== "object") return;
    const record = node as Readonly<{ text?: unknown; content?: unknown }>;
    if (typeof record.text === "string") chunks.push(record.text);
    if (Array.isArray(record.content)) {
      for (const child of record.content) walk(child);
    }
  };
  walk(document.document);
  return chunks.join(" ").replace(/\s+/g, " ").trim();
}

export const DraftPanel = forwardRef<DraftPanelHandle, DraftPanelProps>(
  function DraftPanel(
    {
      accountId,
      projectId,
      projectVersion,
      sceneId,
      sceneTitle,
      sceneStatus = "planned",
      sceneSummary,
      sceneSketch,
      sceneBackdropUrl,
      sceneBackdropCaption,
      sceneCast = [],
      povLabel,
      scenePosition,
      previousSceneTitle,
      nextSceneTitle,
      contextDockOpen = true,
      focusHalo = false,
      historyOpen = false,
      readOnly = false,
      writeComposition = "page",
      writeModality = "keyboard",
      assistOpen = false,
      onWriteCompositionChange,
      onWriteModalityChange,
      onAssistOpenChange,
      onProjectCommand,
      onContextDockOpenChange,
      onFocusHaloChange,
      onHistoryOpenChange,
      onPreviousScene,
      onNextScene,
      onAcknowledgement,
      onActivityChange,
      onProblem,
      onProblemResolved
    },
    ref
  ) {
    const [document, setDocument] = useState<SceneDocumentV1>();
    const [head, setHead] = useState<SceneHeadResponse>();
    const [lease, setLease] = useState<SceneLeaseResponse>();
    const [leasePhase, setLeasePhase] = useState<LeasePhase>("loading");
    const [saveSnapshot, setSaveSnapshot] =
      useState<SceneSaveQueueSnapshot>();
    const [problem, setProblem] = useState<DraftProblem>();
    const [actionBusy, setActionBusy] = useState(false);
    const [loadAttempt, setLoadAttempt] = useState(0);
    const [history, setHistory] = useState<SceneHistoryResponse>();
    const [historyPhase, setHistoryPhase] =
      useState<HistoryPhase>("loading");
    const [historyError, setHistoryError] = useState<string>();
    const [historyNotice, setHistoryNotice] = useState<string>();
    const [historyWorking, setHistoryWorking] = useState<string>();
    const [selectedRevisionId, setSelectedRevisionId] = useState<string>();
    const [comparison, setComparison] = useState<SceneDocumentComparison>();
    const [variantName, setVariantName] = useState("");
    const [confirmingRestore, setConfirmingRestore] = useState(false);
    const [recoveryOffer, setRecoveryOffer] = useState<SceneRecoveryEntry>();
    const [recoveryMode, setRecoveryMode] =
      useState<SceneRecoveryStorageMode>();
    const [insertTextRequest, setInsertTextRequest] =
      useState<SceneEditorInsertRequest>();
    const insertSeqRef = useRef(0);
    const queueRef = useRef<SceneSaveQueue | undefined>(undefined);
    const recoveryRef = useRef<SceneRecoveryCoordinator | undefined>(
      undefined
    );
    const acknowledgementCallbackRef = useRef(onAcknowledgement);
    const activityCallbackRef = useRef(onActivityChange);
    const problemCallbackRef = useRef(onProblem);
    const problemResolvedCallbackRef = useRef(onProblemResolved);
    const reportedProblemIdsRef = useRef(new Set<string>());
    const activeRef = useRef(false);
    const renewingRef = useRef(false);
    const releasePromiseRef = useRef<Promise<void> | undefined>(undefined);
    const transitionRef = useRef<Promise<void>>(Promise.resolve());
    acknowledgementCallbackRef.current = onAcknowledgement;
    activityCallbackRef.current = onActivityChange;
    problemCallbackRef.current = onProblem;
    problemResolvedCallbackRef.current = onProblemResolved;

    const refreshHistory = useCallback(
      async (currentCheckpointRevisionId?: string): Promise<void> => {
        setHistoryPhase("loading");
        setHistoryError(undefined);
        try {
          const loaded = await getSceneHistory({ projectId, sceneId });
          if (!activeRef.current) return;
          setHistory(loaded);
          setHistoryPhase("ready");
          setSelectedRevisionId((selected) => {
            if (
              selected !== undefined &&
              loaded.revisions.some((revision) => revision.id === selected)
            ) {
              return selected;
            }
            return (
              loaded.revisions.find(
                (revision) => revision.id !== currentCheckpointRevisionId
              )?.id ?? loaded.revisions[0]?.id
            );
          });
        } catch (cause) {
          if (!activeRef.current) return;
          setHistoryPhase("error");
          setHistoryError(
            cause instanceof Error
              ? `Ghostwriter could not load Draft history: ${cause.message}`
              : "Ghostwriter could not load Draft history."
          );
        }
      },
      [projectId, sceneId]
    );

    const releaseBestEffort = useCallback(async (): Promise<void> => {
      if (releasePromiseRef.current !== undefined) {
        await releasePromiseRef.current;
        return;
      }
      const request = releaseSceneLease({ projectId, sceneId })
        .catch(() => undefined)
        .then(() => undefined);
      releasePromiseRef.current = request;
      try {
        await request;
      } finally {
        if (releasePromiseRef.current === request) {
          releasePromiseRef.current = undefined;
        }
      }
    }, [projectId, sceneId]);

    const enterLeaseReadOnly = useCallback(
      (message: string): void => {
        queueRef.current?.pause();
        setLease(undefined);
        setLeasePhase("readonly");
        setProblem({ kind: "lease", message });
      },
      []
    );

    const flushAndRelease = useCallback(async (): Promise<void> => {
      const queue = queueRef.current;
      const recovery = recoveryRef.current;
      await recovery?.flush();
      await queue?.flush();
      await recovery?.flush();
      queue?.pause();
      await releaseBestEffort();
      if (activeRef.current) {
        setLease(undefined);
        setLeasePhase("readonly");
        setProblem({
          kind: "lease",
          message:
            "Editing paused while leaving this Draft. Reacquire the lease if you stay on this scene."
        });
      }
    }, [releaseBestEffort]);

    useImperativeHandle(ref, () => ({ flushAndRelease }), [flushAndRelease]);

    useEffect(() => {
      let active = true;
      let ownedQueue: SceneSaveQueue | undefined;
      let ownedRecovery: SceneRecoveryCoordinator | undefined;
      activeRef.current = true;
      setDocument(undefined);
      setHead(undefined);
      setLease(undefined);
      setLeasePhase("loading");
      setSaveSnapshot(undefined);
      setProblem(undefined);
      setActionBusy(false);
      setHistory(undefined);
      setHistoryPhase("loading");
      setHistoryError(undefined);
      setHistoryNotice(undefined);
      setHistoryWorking(undefined);
      setSelectedRevisionId(undefined);
      setComparison(undefined);
      setVariantName("");
      setConfirmingRestore(false);
      setRecoveryOffer(undefined);
      setRecoveryMode(undefined);

      async function handleSaveFailure(
        cause: unknown,
        queue: SceneSaveQueue
      ): Promise<void> {
        if (!active) return;
        if (
          cause instanceof GhostwriterApiError &&
          cause.code === "REVISION_CONFLICT"
        ) {
          setLease(undefined);
          setLeasePhase("readonly");
          setProblem({
            kind: "revision",
            message:
              "A newer scene revision is already acknowledged. Ghostwriter applied nothing " +
              "and kept your local Draft in recovery without combining it."
          });
          await releaseBestEffort();
          try {
            const workspace = await getSceneWorkspace({ projectId, sceneId });
            if (!active) return;
            queue.installAcknowledgement(workspace.head, true);
            setHead(workspace.head);
            setProblem({
              kind: "revision",
              message:
                "A newer scene revision is already acknowledged. Ghostwriter applied nothing " +
                "and kept your local Draft in recovery without combining it.",
              workspace
            });
          } catch {
            // The local document stays in the paused queue. The review action retries this read.
          }
          return;
        }
        if (
          cause instanceof GhostwriterApiError &&
          (cause.code === "LEASE_CONFLICT" ||
            cause.code === "LEASE_EXPIRED" ||
            cause.status === 401)
        ) {
          enterLeaseReadOnly(messageForLeaseFailure(cause));
          return;
        }
        setProblem({
          kind: "save",
          message:
            cause instanceof Error
              ? `Ghostwriter could not save this Draft: ${cause.message}`
              : "Ghostwriter could not save this Draft. Your unacknowledged prose remains in recovery."
        });
      }

      async function initialize(): Promise<void> {
        try {
          await transitionRef.current;
          if (!active) return;
          const workspace = await getSceneWorkspace({ projectId, sceneId });
          if (!active) return;
          setDocument(workspace.head.document);
          setHead(workspace.head);
          void refreshHistory(workspace.head.checkpointRevisionId);
          const localRecovery = {
            current: undefined as SceneRecoveryCoordinator | undefined
          };
          const queue = createSceneSaveQueue({
            initialAcknowledgement: workspace.head,
            debounceMs: AUTOSAVE_DEBOUNCE_MS,
            startPaused: true,
            save: ({ expectedWorkingVersion, document: nextDocument }) =>
              saveSceneDocument({
                projectId,
                sceneId,
                expectedWorkingVersion,
                document: nextDocument
              }),
            onAcknowledged: (acknowledgement) => {
              void localRecovery.current?.acknowledge(
                acknowledgement.document
              );
              if (active) {
                setHead(acknowledgement);
                acknowledgementCallbackRef.current?.({
                  kind: "save",
                  title: "Draft saved",
                  detail: `${sceneTitle} · Draft version ${acknowledgement.workingVersion}`
                });
              }
            },
            onError: (cause) => {
              void handleSaveFailure(cause, queue);
            },
            onStateChange: (snapshot) => {
              if (active) setSaveSnapshot(snapshot);
            }
          });
          ownedQueue = queue;
          queueRef.current = queue;
          setSaveSnapshot(queue.getSnapshot());
          const recovery = createSceneRecoveryCoordinator({
            service: sceneRecoveryService,
            scope: { accountId, projectId, sceneId },
            scheduleSave: (nextDocument) => queue.enqueue(nextDocument),
            onModeChange: (mode) => {
              if (active) setRecoveryMode(mode);
            }
          });
          localRecovery.current = recovery;
          ownedRecovery = recovery;
          recoveryRef.current = recovery;

          const recovered = await sceneRecoveryService.load({
            accountId,
            projectId,
            sceneId
          });
          if (!active) return;
          setRecoveryMode(recovered.mode);
          const recoveryDecision = decideSceneRecovery(
            recovered.entry,
            workspace.head.document
          );
          if (
            recoveryDecision === "matches-acknowledged" &&
            recovered.entry !== undefined
          ) {
            void recovery.acknowledge(workspace.head.document);
          } else if (
            recoveryDecision === "offer" &&
            recovered.entry !== undefined
          ) {
            setRecoveryOffer(recovered.entry);
          }

          if (readOnly) {
            setLeasePhase("readonly");
            return;
          }

          setLeasePhase("acquiring");
          try {
            const acquired = await acquireSceneLease({ projectId, sceneId });
            if (!active) {
              await releaseBestEffort();
              return;
            }
            setLease(acquired);
            setLeasePhase("held");
            queue.resume();
          } catch (cause) {
            if (active) enterLeaseReadOnly(messageForLeaseFailure(cause));
          }
        } catch (cause) {
          if (!active) return;
          setLeasePhase("readonly");
          setProblem({ kind: "load", message: messageForLoadFailure(cause) });
        }
      }

      const initialization = initialize();
      void initialization;
      return () => {
        active = false;
        activeRef.current = false;
        if (queueRef.current === ownedQueue) queueRef.current = undefined;
        if (recoveryRef.current === ownedRecovery) {
          recoveryRef.current = undefined;
        }
        const cleanup = (async () => {
          await initialization;
          await ownedRecovery?.flush();
          await ownedQueue?.flush();
          await ownedRecovery?.flush();
          ownedQueue?.dispose();
          await releaseBestEffort();
        })();
        transitionRef.current = cleanup;
        void cleanup;
      };
    }, [
      accountId,
      enterLeaseReadOnly,
      loadAttempt,
      projectId,
      readOnly,
      refreshHistory,
      releaseBestEffort,
      sceneId
    ]);

    useEffect(() => {
      if (leasePhase !== "held") return;
      let renewalActive = true;
      const renewal = setInterval(() => {
        if (renewingRef.current) return;
        renewingRef.current = true;
        void renewSceneLease({ projectId, sceneId })
          .then((renewed) => {
            if (!renewalActive || !activeRef.current) return;
            setLease(renewed);
          })
          .catch((cause: unknown) => {
            if (!renewalActive || !activeRef.current) return;
            enterLeaseReadOnly(messageForLeaseFailure(cause));
          })
          .finally(() => {
            renewingRef.current = false;
          });
      }, LEASE_RENEWAL_INTERVAL_MS);
      return () => {
        renewalActive = false;
        clearInterval(renewal);
      };
    }, [enterLeaseReadOnly, leasePhase, projectId, sceneId]);

    useEffect(() => {
      if (leasePhase !== "held" || lease === undefined) return;
      const remainingMs = Date.parse(lease.expiresAt) - Date.now();
      const expiry = setTimeout(
        () => {
          if (activeRef.current) {
            enterLeaseReadOnly(
              "The editing lease expired. Your unsaved Draft remains in local recovery for review; " +
                "reacquire the lease before retrying."
            );
          }
        },
        Math.max(0, remainingMs + 50)
      );
      return () => clearTimeout(expiry);
    }, [enterLeaseReadOnly, lease, leasePhase]);

    const flushLatestForBoundary =
      useCallback(async (): Promise<SceneSaveQueueSnapshot> => {
        const queue = queueRef.current;
        if (queue === undefined) {
          throw new Error("The Draft save queue is not ready.");
        }
        await recoveryRef.current?.flush();
        await queue.flush();
        await recoveryRef.current?.flush();
        const snapshot = queue.getSnapshot();
        if (snapshot.dirty) {
          throw new Error(
            "Save the latest Draft successfully before creating or restoring a checkpoint."
          );
        }
        return snapshot;
      }, []);

    const handleHistoryActionFailure = useCallback(
      async (cause: unknown, fallback: string): Promise<void> => {
        const queue = queueRef.current;
        if (
          cause instanceof GhostwriterApiError &&
          cause.code === "VARIANT_NAME_CONFLICT"
        ) {
          setHistoryError(
            "That variant name is already in use. Choose a different name."
          );
          return;
        }
        if (
          cause instanceof GhostwriterApiError &&
          cause.code === "REVISION_NOT_FOUND"
        ) {
          setHistoryError(
            "That checkpoint is no longer available. Reload History and choose another."
          );
          return;
        }
        if (
          cause instanceof GhostwriterApiError &&
          cause.code === "REVISION_CONFLICT"
        ) {
          queue?.pause();
          setLease(undefined);
          setLeasePhase("readonly");
          setHistoryError(
            "History was not changed because a newer Draft version is already acknowledged."
          );
          setProblem({
            kind: "revision",
            message:
              "A newer scene revision is already acknowledged. Ghostwriter applied nothing " +
              "and kept your local Draft without combining it."
          });
          await releaseBestEffort();
          try {
            const workspace = await getSceneWorkspace({ projectId, sceneId });
            if (!activeRef.current) return;
            queue?.installAcknowledgement(workspace.head, true);
            setHead(workspace.head);
            setProblem({
              kind: "revision",
              message:
                "A newer scene revision is already acknowledged. Ghostwriter applied nothing " +
                "and kept your local Draft without combining it.",
              workspace
            });
            void refreshHistory(workspace.head.checkpointRevisionId);
          } catch {
            // The local recovery and paused queue remain available for an explicit retry.
          }
          return;
        }
        if (
          cause instanceof GhostwriterApiError &&
          (cause.code === "LEASE_CONFLICT" ||
            cause.code === "LEASE_EXPIRED" ||
            cause.status === 401)
        ) {
          enterLeaseReadOnly(messageForLeaseFailure(cause));
          setHistoryError(
            "History was not changed because Ghostwriter could not confirm this Draft's editing lease."
          );
          return;
        }
        setHistoryError(
          cause instanceof Error ? `${fallback}: ${cause.message}` : fallback
        );
      },
      [
        enterLeaseReadOnly,
        projectId,
        refreshHistory,
        releaseBestEffort,
        sceneId
      ]
    );

    const createCheckpoint = useCallback(async (): Promise<void> => {
      if (leasePhase !== "held" || readOnly) return;
      const queue = queueRef.current;
      if (queue === undefined) return;
      setActionBusy(true);
      setHistoryError(undefined);
      setHistoryNotice(undefined);
      setHistoryWorking(
        "Saving the latest Draft and creating a checkpoint…"
      );
      try {
        const snapshot = await flushLatestForBoundary();
        const result = await createSceneCheckpoint({
          projectId,
          sceneId,
          expectedWorkingVersion: snapshot.acknowledgedWorkingVersion
        });
        if (!activeRef.current) return;
        const acknowledgedDocument =
          queue.getSnapshot().acknowledgedDocument;
        const nextHead = fullHeadFromMetadata(
          result.head,
          acknowledgedDocument
        );
        queue.installAcknowledgement(nextHead, true);
        setHead(nextHead);
        setComparison(undefined);
        setConfirmingRestore(false);
        acknowledgementCallbackRef.current?.({
          kind: "checkpoint",
          title: result.created
            ? "Checkpoint created"
            : "Checkpoint already current",
          detail: result.created
            ? `${sceneTitle} · Latest acknowledged Draft preserved`
            : `${sceneTitle} already matches its current checkpoint`
        });
        await refreshHistory(result.head.checkpointRevisionId);
      } catch (cause) {
        await handleHistoryActionFailure(
          cause,
          "Ghostwriter could not create this checkpoint"
        );
      } finally {
        if (activeRef.current) setHistoryWorking(undefined);
        if (activeRef.current) setActionBusy(false);
      }
    }, [
      flushLatestForBoundary,
      handleHistoryActionFailure,
      leasePhase,
      projectId,
      readOnly,
      refreshHistory,
      sceneId
    ]);

    const createVariant = useCallback(async (): Promise<void> => {
      const name = variantName.trim();
      if (leasePhase !== "held" || readOnly || name.length === 0) return;
      const queue = queueRef.current;
      if (queue === undefined) return;
      setActionBusy(true);
      setHistoryError(undefined);
      setHistoryNotice(undefined);
      setHistoryWorking(
        "Saving the latest Draft and creating a named variant…"
      );
      try {
        const snapshot = await flushLatestForBoundary();
        const result = await createSceneVariant({
          projectId,
          sceneId,
          expectedWorkingVersion: snapshot.acknowledgedWorkingVersion,
          name
        });
        if (!activeRef.current) return;
        const acknowledgedDocument =
          queue.getSnapshot().acknowledgedDocument;
        const nextHead = fullHeadFromMetadata(
          result.head,
          acknowledgedDocument
        );
        queue.installAcknowledgement(nextHead, true);
        setHead(nextHead);
        setVariantName("");
        setComparison(undefined);
        setConfirmingRestore(false);
        acknowledgementCallbackRef.current?.({
          kind: "variant",
          title: "Named variant created",
          detail: result.checkpointCreated
            ? `${result.variant.name} · New checkpoint preserved`
            : `${result.variant.name} · Current checkpoint preserved`
        });
        await refreshHistory(result.head.checkpointRevisionId);
      } catch (cause) {
        await handleHistoryActionFailure(
          cause,
          "Ghostwriter could not create this named variant"
        );
      } finally {
        if (activeRef.current) setHistoryWorking(undefined);
        if (activeRef.current) setActionBusy(false);
      }
    }, [
      flushLatestForBoundary,
      handleHistoryActionFailure,
      leasePhase,
      projectId,
      readOnly,
      refreshHistory,
      sceneId,
      variantName
    ]);

    const compareSelectedRevision = useCallback(async (): Promise<void> => {
      if (
        selectedRevisionId === undefined ||
        head?.checkpointRevisionId === undefined
      ) {
        return;
      }
      setActionBusy(true);
      setHistoryError(undefined);
      setHistoryNotice(undefined);
      setHistoryWorking(
        "Comparing the selected revision with the current checkpoint…"
      );
      setConfirmingRestore(false);
      try {
        const result = await compareSceneRevisions({
          projectId,
          sceneId,
          beforeRevisionId: selectedRevisionId,
          afterRevisionId: head.checkpointRevisionId
        });
        if (activeRef.current) setComparison(result.comparison);
      } catch (cause) {
        await handleHistoryActionFailure(
          cause,
          "Ghostwriter could not compare these checkpoints"
        );
      } finally {
        if (activeRef.current) setHistoryWorking(undefined);
        if (activeRef.current) setActionBusy(false);
      }
    }, [
      handleHistoryActionFailure,
      head?.checkpointRevisionId,
      projectId,
      sceneId,
      selectedRevisionId
    ]);

    const restoreSelectedRevision = useCallback(async (): Promise<void> => {
      if (
        selectedRevisionId === undefined ||
        leasePhase !== "held" ||
        readOnly
      ) {
        return;
      }
      const queue = queueRef.current;
      if (queue === undefined) return;
      let pausedForRestore = false;
      setActionBusy(true);
      setHistoryError(undefined);
      setHistoryNotice(undefined);
      setHistoryWorking("Restoring the selected revision…");
      try {
        const snapshot = await flushLatestForBoundary();
        queue.pause();
        pausedForRestore = true;
        const result = await restoreSceneRevision({
          projectId,
          sceneId,
          expectedWorkingVersion: snapshot.acknowledgedWorkingVersion,
          revisionId: selectedRevisionId
        });
        if (!activeRef.current) return;
        queue.installAcknowledgement(result.head, false);
        setDocument(result.head.document);
        setHead(result.head);
        setRecoveryOffer(undefined);
        await recoveryRef.current?.discard();
        setComparison(undefined);
        setConfirmingRestore(false);
        acknowledgementCallbackRef.current?.({
          kind: "restore",
          title: "Draft revision restored",
          detail:
            "Restored as a new checkpoint · Earlier History remains unchanged"
        });
        await refreshHistory(result.head.checkpointRevisionId);
        if (activeRef.current) queue.resume();
      } catch (cause) {
        const invalidatesLease =
          cause instanceof GhostwriterApiError &&
          (cause.code === "REVISION_CONFLICT" ||
            cause.code === "LEASE_CONFLICT" ||
            cause.code === "LEASE_EXPIRED" ||
            cause.status === 401);
        if (pausedForRestore && !invalidatesLease) queue.resume();
        await handleHistoryActionFailure(
          cause,
          "Ghostwriter could not restore this revision"
        );
      } finally {
        if (activeRef.current) setHistoryWorking(undefined);
        if (activeRef.current) setActionBusy(false);
      }
    }, [
      flushLatestForBoundary,
      handleHistoryActionFailure,
      leasePhase,
      projectId,
      readOnly,
      refreshHistory,
      sceneId,
      selectedRevisionId
    ]);

    const recoverLocalDraft = useCallback((): void => {
      const local = recoveryOffer;
      const queue = queueRef.current;
      const recovery = recoveryRef.current;
      if (local === undefined || queue === undefined || recovery === undefined) {
        return;
      }
      setDocument(local.document);
      setRecoveryOffer(undefined);
      setProblem(undefined);
      void recovery.capture(
        local.document,
        queue.getAcknowledgedWorkingVersion()
      );
    }, [recoveryOffer]);

    const discardLocalRecovery = useCallback(async (): Promise<void> => {
      setActionBusy(true);
      try {
        await recoveryRef.current?.discard();
        if (activeRef.current) setRecoveryOffer(undefined);
      } finally {
        if (activeRef.current) setActionBusy(false);
      }
    }, []);

    const reviewLatest = useCallback(async (): Promise<void> => {
      const queue = queueRef.current;
      if (queue === undefined) return;
      setActionBusy(true);
      queue.pause();
      try {
        const workspace = await getSceneWorkspace({ projectId, sceneId });
        if (!activeRef.current) return;
        queue.installAcknowledgement(workspace.head, true);
        setHead(workspace.head);
        setLease(undefined);
        setLeasePhase("readonly");
        setProblem({
          kind: "revision",
          message:
            "The latest acknowledged scene is ready for review. Your local Draft is still " +
            "unchanged in recovery, and Ghostwriter has not combined either document.",
          workspace
        });
      } catch (cause) {
        if (activeRef.current) {
          setProblem({
            kind: "revision",
            message:
              `Ghostwriter could not reload the latest scene for review: ` +
              `${messageForLoadFailure(cause)} Your local Draft remains in recovery.`
          });
        }
      } finally {
        if (activeRef.current) setActionBusy(false);
      }
    }, [projectId, sceneId]);

    const reacquireAndRetry = useCallback(async (): Promise<void> => {
      const queue = queueRef.current;
      if (queue === undefined || readOnly) return;
      setActionBusy(true);
      setLeasePhase("acquiring");
      try {
        const workspace = await getSceneWorkspace({ projectId, sceneId });
        if (!activeRef.current) return;
        const snapshot = queue.getSnapshot();
        if (
          workspace.head.workingVersion !==
            snapshot.acknowledgedWorkingVersion &&
          snapshot.dirty
        ) {
          queue.pause();
          queue.installAcknowledgement(workspace.head, true);
          setHead(workspace.head);
          setLease(undefined);
          setLeasePhase("readonly");
          setProblem({
            kind: "revision",
            message:
              "The server scene changed again before retry. Ghostwriter applied nothing and " +
              "kept your local Draft for another review choice.",
            workspace
          });
          await releaseBestEffort();
          return;
        }
        if (!snapshot.dirty) {
          queue.installAcknowledgement(workspace.head, false);
          setDocument(workspace.head.document);
        } else {
          queue.installAcknowledgement(workspace.head, true);
        }
        setHead(workspace.head);

        const acquired = await acquireSceneLease({ projectId, sceneId });
        if (!activeRef.current) {
          await releaseBestEffort();
          return;
        }
        setLease(acquired);
        setLeasePhase("held");
        setProblem(undefined);
        queue.resume({ immediate: true });
      } catch (cause) {
        if (activeRef.current) {
          enterLeaseReadOnly(messageForLeaseFailure(cause));
        }
      } finally {
        if (activeRef.current) setActionBusy(false);
      }
    }, [
      enterLeaseReadOnly,
      projectId,
      readOnly,
      releaseBestEffort,
      sceneId
    ]);

    const useServerDocument = useCallback(async (): Promise<void> => {
      const workspace =
        problem?.kind === "revision" ? problem.workspace : undefined;
      const queue = queueRef.current;
      if (workspace === undefined || queue === undefined) return;
      queue.pause();
      queue.installAcknowledgement(workspace.head, false);
      setDocument(workspace.head.document);
      setHead(workspace.head);
      setRecoveryOffer(undefined);
      await recoveryRef.current?.discard();
      setProblem(undefined);
      await reacquireAndRetry();
    }, [problem, reacquireAndRetry]);

    useEffect(() => {
      const nextIds = new Set<string>();
      if (recoveryOffer !== undefined) {
        const id = `draft-recovery:${sceneId}`;
        nextIds.add(id);
        problemCallbackRef.current?.({
          id,
          title: "Unsaved Draft recovered",
          detail:
            "Local prose differs from the acknowledged project Draft. Review Recover or Discard in Draft.",
          tone: "warning"
        });
      }
      if (recoveryMode === "tab-only") {
        const id = `draft-recovery-storage:${sceneId}`;
        nextIds.add(id);
        problemCallbackRef.current?.({
          id,
          title: "Browser recovery is limited",
          detail:
            "New unacknowledged prose is protected only while this tab remains open.",
          tone: "warning"
        });
      }
      if (problem !== undefined) {
        const id = `draft-problem:${sceneId}`;
        nextIds.add(id);
        problemCallbackRef.current?.({
          id,
          title:
            problem.kind === "revision"
              ? "Draft revision conflict"
              : problem.kind === "lease"
                ? "Draft lease needs attention"
                : problem.kind === "save"
                  ? "Draft not saved"
                  : "Draft could not load",
          detail: problem.message,
          tone: problem.kind === "save" || problem.kind === "load" ? "error" : "warning"
        });
      }
      for (const id of reportedProblemIdsRef.current) {
        if (!nextIds.has(id)) problemResolvedCallbackRef.current?.(id);
      }
      reportedProblemIdsRef.current = nextIds;
    }, [problem, recoveryMode, recoveryOffer, sceneId]);

    useEffect(
      () => () => {
        for (const id of reportedProblemIdsRef.current) {
          problemResolvedCallbackRef.current?.(id);
        }
        reportedProblemIdsRef.current.clear();
      },
      []
    );

    useEffect(() => {
      if (problem !== undefined || recoveryOffer !== undefined) {
        activityCallbackRef.current?.("problem");
        return;
      }
      if (
        saveSnapshot === undefined ||
        saveSnapshot.status === "pending" ||
        saveSnapshot.status === "saving" ||
        leasePhase === "loading" ||
        leasePhase === "acquiring"
      ) {
        activityCallbackRef.current?.("saving");
        return;
      }
      activityCallbackRef.current?.("idle");
    }, [leasePhase, problem, recoveryOffer, saveSnapshot]);

    const editorIsEditable =
      leasePhase === "held" &&
      !readOnly &&
      !actionBusy &&
      problem?.kind !== "revision" &&
      problem?.kind !== "lease";
    const historyCanMutate = editorIsEditable && problem === undefined;
    const statusText = saveStatusText(saveSnapshot, problem);
    const canReviewServer =
      problem?.kind === "revision" && problem.workspace !== undefined;
    const wordCount = sceneDocumentWordCount(document);

    return (
      <View
        accessibilityLabel="Draft Desk"
        style={[styles.panel, focusHalo && styles.panelFocused]}
      >
        <View accessibilityLabel="Draft scene ribbon" style={styles.sceneRibbon}>
          <View style={styles.sceneNavigation}>
            <DraftButton
              disabled={onPreviousScene === undefined || actionBusy}
              label={
                previousSceneTitle === undefined
                  ? "Previous scene"
                  : `Previous scene: ${previousSceneTitle}`
              }
              onPress={() => onPreviousScene?.()}
            />
            <DraftButton
              disabled={onNextScene === undefined || actionBusy}
              label={
                nextSceneTitle === undefined
                  ? "Next scene"
                  : `Next scene: ${nextSceneTitle}`
              }
              onPress={() => onNextScene?.()}
            />
          </View>
          <View style={styles.headingCopy}>
            <Text style={styles.eyebrow}>
              {scenePosition ?? "Manuscript scene"}
            </Text>
            <Text style={styles.title}>{sceneTitle}</Text>
            <View style={styles.sceneMetaRow}>
              <Text style={styles.meta}>{sceneStatus}</Text>
              <Text style={styles.meta}>POV · {povLabel ?? "Open"}</Text>
              <Text accessibilityLabel="Draft word count" style={styles.meta}>
                {wordCount} {wordCount === 1 ? "word" : "words"}
              </Text>
              <Text style={styles.meta}>
                {head === undefined
                  ? "Loading acknowledged Draft"
                  : `Draft ${head.workingVersion}`}
              </Text>
            </View>
          </View>
          <View style={styles.statusGroup}>
            <Text
              accessibilityLabel="Draft save status"
              accessibilityLiveRegion="polite"
              style={[
                styles.saveStatus,
                (saveSnapshot?.dirty === true || problem !== undefined) &&
                  styles.saveStatusWarning
              ]}
            >
              {statusText}
            </Text>
            {leasePhase === "held" && problem === undefined ? null : (
              <Text
                accessibilityLabel="Draft lease status"
                style={styles.leaseStatus}
              >
                {leaseStatusText(leasePhase, readOnly, lease)}
              </Text>
            )}
            <View style={styles.sceneRibbonActions}>
              <DraftButton
                label={contextDockOpen ? "Hide Context" : "Show Context"}
                onPress={() =>
                  onContextDockOpenChange?.(!contextDockOpen)
                }
              />
              <DraftButton
                label={historyOpen ? "Close History" : "History"}
                onPress={() => onHistoryOpenChange?.(!historyOpen)}
              />
              <DraftButton
                primary={focusHalo}
                label={focusHalo ? "Exit focus" : "Focus"}
                onPress={() => onFocusHaloChange?.(!focusHalo)}
              />
            </View>
          </View>
        </View>

        {readOnly ? (
          <View style={styles.notice}>
            <Text style={styles.noticeText}>
              This archived scene is read-only. Restore it with the scene metadata controls
              before editing its Draft.
            </Text>
          </View>
        ) : null}

        {recoveryMode === "tab-only" ? (
          <View accessibilityRole="alert" style={styles.recoveryWarning}>
            <Text style={styles.noticeText}>
              Encrypted browser recovery is unavailable. New unacknowledged
              prose is protected only while this tab remains open; editing and
              project saves still work.
            </Text>
          </View>
        ) : null}

        {onProjectCommand === undefined ? null : (
          <WritingStudioLayer
            assistOpen={assistOpen}
            backdropCaption={sceneBackdropCaption}
            backdropUrl={sceneBackdropUrl}
            cast={sceneCast}
            composition={writeComposition}
            disabled={readOnly || !editorIsEditable}
            focusHalo={focusHalo}
            modality={writeModality}
            onAcknowledgement={(title, detail) =>
              onAcknowledgement?.({
                kind: "save",
                title,
                detail
              })
            }
            onAssistOpenChange={(open) => {
              onAssistOpenChange?.(open);
              if (open) onContextDockOpenChange?.(true);
            }}
            onCommand={onProjectCommand}
            onCompositionChange={(composition) =>
              onWriteCompositionChange?.(composition)
            }
            onInsertProse={(text) => {
              insertSeqRef.current += 1;
              setInsertTextRequest({ id: insertSeqRef.current, text });
            }}
            onModalityChange={(modality) => onWriteModalityChange?.(modality)}
            projectId={projectId}
            projectVersion={projectVersion}
            recentProse={recentProseFromDocument(document)}
            sceneId={sceneId}
            sceneSummary={sceneSummary}
            sceneTitle={sceneTitle}
            sketch={sceneSketch}
          />
        )}

        {recoveryOffer === undefined ? null : (
          <View accessibilityRole="alert" style={styles.recoveryOffer}>
            <Text style={styles.problemText}>
              Local Draft recovery from{" "}
              {formatRevisionTime(recoveryOffer.updatedAt)} differs from the
              acknowledged project Draft. Ghostwriter will not combine or
              overwrite either version automatically.
            </Text>
            <Text style={styles.problemMeta}>
              Recovering chooses the local prose for the next save. Discarding
              keeps acknowledged Draft version {head?.workingVersion ?? "—"}.
            </Text>
            <View style={styles.actionRow}>
              <DraftButton
                disabled={actionBusy}
                label="Recover local Draft"
                onPress={recoverLocalDraft}
                primary
              />
              <DraftButton
                disabled={actionBusy}
                label="Discard local recovery"
                onPress={() => void discardLocalRecovery()}
              />
            </View>
          </View>
        )}

        {problem === undefined ? null : (
          <View accessibilityRole="alert" style={styles.problem}>
            <Text style={styles.problemText}>{problem.message}</Text>
            {canReviewServer ? (
              <Text style={styles.problemMeta}>
                Server Draft version {problem.workspace?.head.workingVersion}. Choose the
                document to continue from; Ghostwriter will not combine them automatically.
              </Text>
            ) : null}
            <View style={styles.actionRow}>
              {problem.kind === "load" ? (
                <DraftButton
                  disabled={actionBusy}
                  label="Reload Draft"
                  onPress={() => setLoadAttempt((attempt) => attempt + 1)}
                  primary
                />
              ) : problem.kind === "revision" ? (
                canReviewServer ? (
                  <>
                    <DraftButton
                      disabled={actionBusy}
                      label="Keep local and retry"
                      onPress={() => void reacquireAndRetry()}
                      primary
                    />
                    <DraftButton
                      disabled={actionBusy}
                      label="Use server document"
                      onPress={() => void useServerDocument()}
                    />
                  </>
                ) : (
                  <DraftButton
                    disabled={actionBusy}
                    label="Reload latest for review"
                    onPress={() => void reviewLatest()}
                    primary
                  />
                )
              ) : (
                <DraftButton
                  disabled={actionBusy}
                  label={
                    problem.kind === "lease"
                      ? "Reacquire lease and retry"
                      : "Retry save"
                  }
                  onPress={() => void reacquireAndRetry()}
                  primary
                />
              )}
            </View>
          </View>
        )}

        {document === undefined ? (
          <View style={styles.loading}>
            <Text style={styles.loadingText}>Loading Draft…</Text>
          </View>
        ) : (
          <View style={styles.editorHost}>
            <View style={styles.manuscriptPageHeading}>
              <Text style={styles.manuscriptPageEyebrow}>Manuscript page</Text>
              <Text style={styles.manuscriptPageTitle}>{sceneTitle}</Text>
              {sceneSummary === undefined ? null : (
                <Text style={styles.manuscriptPageSummary}>{sceneSummary}</Text>
              )}
            </View>
            <SceneEditor
              ariaLabel={`Draft for ${sceneTitle}`}
              editable={editorIsEditable}
              insertTextRequest={insertTextRequest}
              onChange={(nextDocument) => {
                setDocument(nextDocument);
                const queue = queueRef.current;
                const recovery = recoveryRef.current;
                if (queue === undefined) return;
                if (recovery === undefined) {
                  queue.enqueue(nextDocument);
                  return;
                }
                void recovery.capture(
                  nextDocument,
                  queue.getAcknowledgedWorkingVersion()
                );
              }}
              selectionStorageKey={`ghostwriter:draft-selection:${accountId}:${projectId}:${sceneId}`}
              style={{
                boxSizing: "border-box",
                maxWidth: "100%",
                width: "100%"
              }}
              value={document}
            />
          </View>
        )}

        {historyOpen ? (
          <View accessibilityLabel="Draft History drawer" style={styles.historyDrawer}>
            <View style={styles.historyDrawerHeading}>
              <View style={styles.headingCopy}>
                <Text style={styles.eyebrow}>Draft History</Text>
                <Text style={styles.historyDrawerTitle}>
                  Timeline, variants, compare, and restore
                </Text>
              </View>
              <DraftButton
                label="Close Draft History"
                onPress={() => onHistoryOpenChange?.(false)}
              />
            </View>
            <DraftHistoryArea
              accountId={accountId}
              busy={actionBusy}
              canMutate={historyCanMutate}
              comparison={comparison}
              confirmingRestore={confirmingRestore}
              currentCheckpointRevisionId={head?.checkpointRevisionId}
              error={historyError}
              history={history}
              notice={historyNotice}
              onCancelRestore={() => setConfirmingRestore(false)}
              onCheckpoint={() => void createCheckpoint()}
              onCompare={() => void compareSelectedRevision()}
              onConfirmRestore={() => void restoreSelectedRevision()}
              onCreateVariant={() => void createVariant()}
              onReload={() => void refreshHistory(head?.checkpointRevisionId)}
              onRequestRestore={() => setConfirmingRestore(true)}
              onSelectRevision={(revisionId) => {
                setSelectedRevisionId(revisionId);
                setComparison(undefined);
                setConfirmingRestore(false);
                setHistoryNotice(undefined);
              }}
              onVariantNameChange={setVariantName}
              phase={historyPhase}
              selectedRevisionId={selectedRevisionId}
              variantName={variantName}
              workingMessage={historyWorking}
            />
          </View>
        ) : null}
      </View>
    );
  }
);

const styles = StyleSheet.create({
  panel: {
    backgroundColor: colors.canvas,
    minWidth: 0,
    padding: 4,
    width: "100%"
  },
  panelFocused: {
    paddingHorizontal: 10
  },
  sceneRibbon: {
    alignItems: "center",
    backgroundColor: colors.paper,
    borderColor: colors.line,
    borderRadius: 9,
    borderWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    justifyContent: "space-between",
    marginBottom: 12,
    padding: 9
  },
  sceneNavigation: {
    flexDirection: "row",
    gap: 4
  },
  headingCopy: {
    flex: 1,
    minWidth: 0
  },
  eyebrow: {
    color: colors.kicker,
    fontFamily: fonts.uiSemibold,
    fontSize: 8,
    letterSpacing: 1.5,
    textTransform: "uppercase"
  },
  title: {
    color: colors.ink,
    fontFamily: fonts.story,
    fontSize: 27,
    marginTop: 3
  },
  meta: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 9,
    textTransform: "capitalize"
  },
  sceneMetaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 4
  },
  statusGroup: {
    alignItems: "flex-end",
    gap: 4,
    maxWidth: "100%"
  },
  sceneRibbonActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
    justifyContent: "flex-end"
  },
  leaseStatus: {
    color: colors.blue,
    fontFamily: fonts.uiMedium,
    fontSize: 9,
    textAlign: "right"
  },
  saveStatus: {
    color: colors.green,
    fontFamily: fonts.uiSemibold,
    fontSize: 9,
    textAlign: "right"
  },
  saveStatusWarning: {
    color: colors.amber
  },
  notice: {
    backgroundColor: colors.wash,
    borderRadius: 7,
    marginBottom: 12,
    padding: 10
  },
  noticeText: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 9,
    lineHeight: 14
  },
  recoveryWarning: {
    backgroundColor: colors.blueSoft,
    borderColor: colors.blue,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 12,
    padding: 10
  },
  recoveryOffer: {
    backgroundColor: colors.greenSoft,
    borderColor: colors.green,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 12,
    padding: 11
  },
  problem: {
    backgroundColor: colors.amberSoft,
    borderColor: colors.amber,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 12,
    padding: 11
  },
  problemText: {
    color: colors.ink,
    fontFamily: fonts.uiMedium,
    fontSize: 9,
    lineHeight: 14
  },
  problemMeta: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 8,
    lineHeight: 13,
    marginTop: 5
  },
  actionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7,
    marginTop: 9
  },
  button: {
    alignItems: "center",
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 6,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 34,
    paddingHorizontal: 10,
    paddingVertical: 6
  },
  buttonPrimary: {
    backgroundColor: colors.brandDark,
    borderColor: colors.brandDark
  },
  buttonPressed: {
    opacity: 0.72
  },
  buttonDisabled: {
    opacity: 0.42
  },
  buttonText: {
    color: colors.ink,
    fontFamily: fonts.uiSemibold,
    fontSize: 9
  },
  buttonTextPrimary: {
    color: "#ffffff"
  },
  loading: {
    alignItems: "center",
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 250
  },
  loadingText: {
    color: colors.muted,
    fontFamily: fonts.uiMedium,
    fontSize: 10
  },
  editorHost: {
    alignSelf: "center",
    backgroundColor: colors.paper,
    borderColor: colors.line,
    borderRadius: 10,
    borderWidth: 1,
    maxWidth: 820,
    minWidth: 0,
    overflow: "hidden",
    width: "100%"
  },
  manuscriptPageHeading: {
    paddingBottom: 4,
    paddingHorizontal: 28,
    paddingTop: 28
  },
  manuscriptPageEyebrow: {
    color: colors.kicker,
    fontFamily: fonts.uiSemibold,
    fontSize: 7,
    letterSpacing: 1.4,
    textTransform: "uppercase"
  },
  manuscriptPageTitle: {
    color: colors.ink,
    fontFamily: fonts.story,
    fontSize: 30,
    marginTop: 4
  },
  manuscriptPageSummary: {
    color: colors.muted,
    fontFamily: fonts.storyItalic,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 5
  },
  historyDrawer: {
    backgroundColor: colors.paper,
    borderColor: colors.line,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 12,
    padding: 12
  },
  historyDrawerHeading: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between"
  },
  historyDrawerTitle: {
    color: colors.ink,
    fontFamily: fonts.story,
    fontSize: 20,
    marginTop: 2
  },
  history: {
    backgroundColor: colors.wash,
    borderColor: colors.line,
    borderRadius: 9,
    borderWidth: 1,
    marginTop: 10,
    minWidth: 0,
    padding: 12,
    width: "100%"
  },
  historyHeading: {
    alignItems: "flex-start",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    justifyContent: "space-between"
  },
  historyHeadingCopy: {
    flex: 1,
    minWidth: 0
  },
  historyEyebrow: {
    color: colors.kicker,
    fontFamily: fonts.uiSemibold,
    fontSize: 8,
    letterSpacing: 1.3,
    textTransform: "uppercase"
  },
  historyTitle: {
    color: colors.ink,
    fontFamily: fonts.story,
    fontSize: 21,
    marginTop: 2
  },
  historyIntro: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 8,
    lineHeight: 13,
    marginTop: 3,
    maxWidth: 520
  },
  variantRow: {
    alignItems: "flex-end",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 12,
    minWidth: 0
  },
  variantField: {
    flexBasis: 220,
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0
  },
  fieldLabel: {
    color: colors.muted,
    fontFamily: fonts.uiSemibold,
    fontSize: 8,
    marginBottom: 4
  },
  textInput: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 6,
    borderWidth: 1,
    color: colors.ink,
    fontFamily: fonts.ui,
    fontSize: 10,
    minHeight: 36,
    minWidth: 0,
    paddingHorizontal: 9,
    paddingVertical: 7,
    width: "100%"
  },
  historyNotice: {
    color: colors.green,
    fontFamily: fonts.uiMedium,
    fontSize: 9,
    lineHeight: 14,
    marginTop: 10
  },
  historyWorking: {
    color: colors.blue,
    fontFamily: fonts.uiMedium,
    fontSize: 9,
    lineHeight: 14,
    marginTop: 10
  },
  historyError: {
    backgroundColor: colors.amberSoft,
    borderColor: colors.amber,
    borderRadius: 7,
    borderWidth: 1,
    marginTop: 10,
    padding: 9
  },
  historyEmpty: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 9,
    lineHeight: 14,
    marginTop: 9
  },
  historyColumns: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 13,
    minWidth: 0
  },
  historyColumn: {
    flexBasis: 260,
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0
  },
  historySectionTitle: {
    color: colors.ink,
    fontFamily: fonts.uiSemibold,
    fontSize: 9
  },
  revisionList: {
    gap: 6,
    marginTop: 6
  },
  revision: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 6,
    borderWidth: 1,
    minWidth: 0,
    padding: 8
  },
  revisionSelected: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent
  },
  revisionTitleRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    justifyContent: "space-between",
    minWidth: 0
  },
  revisionTitle: {
    color: colors.ink,
    flexShrink: 1,
    fontFamily: fonts.uiMedium,
    fontSize: 9
  },
  currentCheckpoint: {
    color: colors.green,
    fontFamily: fonts.uiSemibold,
    fontSize: 7,
    textTransform: "uppercase"
  },
  revisionMeta: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 7,
    lineHeight: 11,
    marginTop: 3
  },
  variantList: {
    gap: 6,
    marginTop: 6
  },
  variant: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 6,
    borderWidth: 1,
    minWidth: 0,
    padding: 8
  },
  variantName: {
    color: colors.ink,
    fontFamily: fonts.uiMedium,
    fontSize: 9
  },
  reviewArea: {
    borderTopColor: colors.line,
    borderTopWidth: 1,
    marginTop: 13,
    minWidth: 0,
    paddingTop: 11
  },
  reviewMeta: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 8,
    marginTop: 3
  },
  restoreConfirmation: {
    backgroundColor: colors.amberSoft,
    borderColor: colors.amber,
    borderRadius: 7,
    borderWidth: 1,
    marginTop: 9,
    padding: 9
  },
  comparison: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 7,
    borderWidth: 1,
    marginTop: 11,
    minWidth: 0,
    padding: 10
  },
  comparisonSummary: {
    color: colors.ink,
    fontFamily: fonts.uiSemibold,
    fontSize: 9,
    lineHeight: 14
  },
  comparisonBlocks: {
    gap: 8,
    marginTop: 8
  },
  change: {
    borderTopColor: colors.line,
    borderTopWidth: 1,
    minWidth: 0,
    paddingTop: 7
  },
  changeTitle: {
    color: colors.accent,
    fontFamily: fonts.uiSemibold,
    fontSize: 8
  },
  excerpt: {
    backgroundColor: colors.wash,
    borderRadius: 5,
    marginTop: 5,
    minWidth: 0,
    padding: 7
  },
  excerptLabel: {
    color: colors.muted,
    fontFamily: fonts.uiSemibold,
    fontSize: 7,
    textTransform: "uppercase"
  },
  excerptText: {
    color: colors.ink,
    fontFamily: fonts.story,
    fontSize: 14,
    lineHeight: 19,
    marginTop: 2
  }
});
