import { useEffect, useMemo, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import {
  STORY_STRUCTURE_MAX_INTENT_FIELD_CHARS,
  STORY_STRUCTURE_MAX_OBJECTIVE_CHARS,
  STORY_STRUCTURE_MAX_TITLE_CHARS,
  type SceneId,
  type StoryStructureOperation,
  type StoryStructureOperationId,
  type StoryStructureProposalV1,
  type StoryWorkArtifactPointer
} from "@ghostwriter/core";
import {
  addRequiredStoryStructureOperations,
  buildStoryStructureOperationViewRows,
  defaultStoryStructureSelectedOperationIds,
  groupStoryStructureOperationViewRows,
  patchStoryStructureReviewPayload,
  sameStoryStructureReviewArtifact,
  selectedStoryStructureCreatedSceneIds,
  storyStructureCanvasPlacementCopy,
  storyStructureEditableFieldsForOperation,
  storyStructureOperationIsReadOnlyInReview,
  storyStructurePreviewImpactPresentation,
  storyStructureReviewCanApply,
  storyStructureReviewCanPreview,
  storyStructureReviewHasUnsavedEdits,
  storyStructureSelectionMissingRequired,
  toggleStoryStructureOperationSelection,
  type StoryStructureEditableOperationFields,
  type StoryStructureReviewArtifact,
  type StoryStructureReviewPreviewBinding
} from "./story-structure-review.js";
import { ghostwriterTheme } from "./theme.js";

const { colors, fonts } = ghostwriterTheme;
const REVIEW_HEADING_ID = "story-structure-review-heading";

export type StoryStructureReviewProps = Readonly<{
  artifact: StoryStructureReviewArtifact;
  status: "review" | "applied" | "rejected";
  bookLabel: string;
  brief: string;
  constraints: string;
  doneWhen: string;
  preview?: StoryStructureReviewPreviewBinding;
  appliedProjectVersion?: number;
  appliedFirstCreatedSceneId?: SceneId;
  canvasPlacedSceneLabel?: string;
  refreshProblem?: string;
  externalBusy?: boolean;
  externalError?: string;
  onEdit(payload: StoryStructureProposalV1): Promise<StoryStructureReviewArtifact>;
  onPreview(
    selectedOperationIds: readonly StoryStructureOperationId[]
  ): Promise<StoryStructureReviewPreviewBinding | undefined>;
  onApply(input: Readonly<{
    selectedOperationIds: readonly StoryStructureOperationId[];
    canvasSceneId?: SceneId;
  }>): Promise<void>;
  onReject(artifact: StoryWorkArtifactPointer): Promise<void>;
  onClose(): void;
  onOpenScene?(sceneId: SceneId): void;
  onReload?(): Promise<void>;
  onDirtyChange?(dirty: boolean): void;
  onBusyChange?(busy: boolean): void;
}>;

function operationById(
  payload: StoryStructureProposalV1,
  operationId: StoryStructureOperationId
): StoryStructureOperation | undefined {
  return payload.operations.find((operation) => operation.operationId === operationId);
}

/** Presentational structure review only. Preview, apply, and leases stay with the caller. */
export function StoryStructureReview(props: StoryStructureReviewProps) {
  const [baseline, setBaseline] = useState(props.artifact);
  const [edits, setEdits] = useState<
    Partial<Record<StoryStructureOperationId, StoryStructureEditableOperationFields>>
  >({});
  const [selectedOperationIds, setSelectedOperationIds] = useState(() =>
    defaultStoryStructureSelectedOperationIds(props.artifact.payload)
  );
  const [requestCanvasCard, setRequestCanvasCard] = useState(false);
  const [canvasSceneId, setCanvasSceneId] = useState<SceneId | undefined>();
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();

  const rows = useMemo(
    () => buildStoryStructureOperationViewRows(baseline.payload),
    [baseline.payload]
  );
  const groups = useMemo(() => groupStoryStructureOperationViewRows(rows), [rows]);
  const dirty = storyStructureReviewHasUnsavedEdits(edits);
  const artifactStale = !sameStoryStructureReviewArtifact(
    baseline.pointer,
    props.artifact.pointer
  );
  const busy = pending || props.externalBusy === true;
  const writable = props.status === "review" && !busy && !artifactStale;
  const missingRequired = storyStructureSelectionMissingRequired({
    proposal: baseline.payload,
    selectedOperationIds
  });
  const selectionEmpty = selectedOperationIds.length === 0;
  const previewPresentation =
    props.preview?.preview === undefined
      ? undefined
      : storyStructurePreviewImpactPresentation(props.preview.preview);
  const createdSceneOptions = selectedStoryStructureCreatedSceneIds({
    proposal: baseline.payload,
    selectedOperationIds,
    preview: props.preview?.preview
  });
  const createdSceneLabels = useMemo(
    () =>
      new Map(
        baseline.payload.operations.flatMap((operation) =>
          operation.type === "scene.createPlanned"
            ? [[operation.sceneId, operation.title] as const]
            : []
        )
      ),
    [baseline.payload]
  );
  const canPreview = storyStructureReviewCanPreview({
    dirty,
    artifactStale,
    proposal: baseline.payload,
    selectedOperationIds
  });
  const canApply = storyStructureReviewCanApply({
    dirty,
    artifactStale,
    proposal: baseline.payload,
    artifact: baseline.pointer,
    payload: baseline.payload,
    selectedOperationIds,
    preview: props.preview
  });

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

  useEffect(() => {
    if (!requestCanvasCard) {
      setCanvasSceneId(undefined);
      return;
    }
    if (
      canvasSceneId !== undefined &&
      createdSceneOptions.includes(canvasSceneId)
    ) {
      return;
    }
    setCanvasSceneId(createdSceneOptions[0]);
  }, [requestCanvasCard, createdSceneOptions, canvasSceneId]);

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
    setEdits({});
    setSelectedOperationIds(
      defaultStoryStructureSelectedOperationIds(props.artifact.payload)
    );
    setRequestCanvasCard(false);
    setMessage("Latest artifact loaded.");
    setError(undefined);
  }

  function updateEdit(
    operationId: StoryStructureOperationId,
    patch: StoryStructureEditableOperationFields
  ) {
    setEdits((current) =>
      Object.freeze({
        ...current,
        [operationId]: Object.freeze({ ...current[operationId], ...patch })
      })
    );
    setMessage(undefined);
  }

  function fieldValue(
    operation: StoryStructureOperation,
    field: keyof StoryStructureEditableOperationFields
  ): string {
    const edit = edits[operation.operationId];
    if (field === "intent") {
      const merged = { ...(operation.type === "scene.updateIntent" ? operation.patch : {}), ...edit?.intent };
      return String(merged.purpose ?? merged.conflict ?? merged.turn ?? merged.openQuestions ?? "");
    }
    if (field === "title" && edit?.title !== undefined) return edit.title;
    if (field === "objective" && edit?.objective !== undefined) return edit.objective;
    if (operation.type === "part.create" && field === "title") return operation.title;
    if (operation.type === "chapter.create") {
      if (field === "title") return operation.title;
      if (field === "objective") return operation.objective ?? "";
    }
    if (operation.type === "chapter.update" && field === "objective") {
      return operation.objective;
    }
    if (operation.type === "scene.createPlanned" && field === "title") {
      return operation.title;
    }
    return "";
  }

  function intentFieldValue(
    operation: Extract<StoryStructureOperation, { type: "scene.updateIntent" }>,
    key: keyof NonNullable<StoryStructureEditableOperationFields["intent"]>
  ): string {
    const edit = edits[operation.operationId]?.intent?.[key];
    if (edit !== undefined && edit !== null) return edit;
    const fromPatch = operation.patch[key];
    return fromPatch ?? "";
  }

  const statusKicker =
    props.status === "applied"
      ? "APPLIED"
      : props.status === "rejected"
        ? "REJECTED"
        : "REVIEW";

  return (
    <View accessibilityLabel="Story structure review" style={styles.root}>
      <View style={styles.header}>
        <View style={styles.heading}>
          <Text style={styles.kicker}>OUTLINE · {statusKicker}</Text>
          <Text
            accessibilityRole="header"
            nativeID={REVIEW_HEADING_ID}
            style={styles.title}
          >
            {props.bookLabel}
          </Text>
        </View>
        <Action
          label="Back to story"
          disabled={busy}
          onPress={() => {
            if (dirty) {
              setError(
                "Save or discard structure edits before leaving this review."
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
                ? "A newer artifact is available. Your local edits are still shown; reload before saving, previewing, or applying."
                : "A newer artifact is ready. Load it before previewing or applying."}
            </Text>
            <Action
              label={
                dirty ? "Discard edits and load latest artifact" : "Load latest artifact"
              }
              disabled={busy}
              onPress={reloadArtifact}
            />
          </View>
        ) : null}

        {groups.map((group) => (
          <View key={group.groupKey} style={styles.panel}>
            <Text style={styles.sectionTitle}>{group.title}</Text>
            {group.rows.map((row) => {
              const operation = operationById(baseline.payload, row.operationId);
              if (operation === undefined) return null;
              const checked = selectedOperationIds.includes(row.operationId);
              const readOnly = storyStructureOperationIsReadOnlyInReview(operation);
              const editableFields = storyStructureEditableFieldsForOperation(operation);
              return (
                <View key={row.operationId} style={styles.operationCard}>
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityLabel={`${row.label} · ${String(row.operationId)}`}
                    accessibilityState={{ checked, disabled: !writable }}
                    disabled={!writable || props.status !== "review"}
                    onPress={() =>
                      setSelectedOperationIds((current) =>
                        toggleStoryStructureOperationSelection(current, row.operationId)
                      )
                    }
                    style={styles.checkRow}
                  >
                    <Text style={styles.choiceMark}>{checked ? "✓" : ""}</Text>
                    <View style={styles.choiceText}>
                      <Text style={styles.label}>{row.label}</Text>
                      <Text style={styles.hint}>Operation · {String(row.operationId)}</Text>
                      {row.requires.length > 0 ? (
                        <Text style={styles.hint}>
                          Requires{" "}
                          {row.requires.map((req) => `${req.label} (${String(req.operationId)})`).join("; ")}
                        </Text>
                      ) : null}
                    </View>
                  </Pressable>

                  {readOnly ? (
                    <Text style={styles.hint}>
                      Positions, reorder, and archive details are read-only in this review. The
                      preview shows exact manuscript impact.
                    </Text>
                  ) : null}

                  {props.status === "review" && editableFields.length > 0 ? (
                    <View style={styles.field}>
                      {editableFields.includes("title") ? (
                        <>
                          <Text style={styles.label}>Title</Text>
                          <TextInput
                            accessibilityLabel={`${row.label} title`}
                            editable={writable}
                            maxLength={STORY_STRUCTURE_MAX_TITLE_CHARS}
                            value={fieldValue(operation, "title")}
                            onChangeText={(value) =>
                              updateEdit(operation.operationId, { title: value })
                            }
                            style={styles.input}
                          />
                        </>
                      ) : null}
                      {editableFields.includes("objective") ? (
                        <>
                          <Text style={styles.label}>Chapter objective</Text>
                          <TextInput
                            accessibilityLabel={`${row.label} objective`}
                            editable={writable}
                            multiline
                            maxLength={STORY_STRUCTURE_MAX_OBJECTIVE_CHARS}
                            value={fieldValue(operation, "objective")}
                            onChangeText={(value) =>
                              updateEdit(operation.operationId, { objective: value })
                            }
                            style={[styles.input, styles.multiline]}
                          />
                        </>
                      ) : null}
                      {editableFields.includes("intent") &&
                      operation.type === "scene.updateIntent" ? (
                        <>
                          {(
                            [
                              ["purpose", "Purpose"],
                              ["conflict", "Conflict"],
                              ["turn", "Turn"],
                              ["openQuestions", "Open questions"]
                            ] as const
                          ).map(([key, label]) => (
                            <View key={key}>
                              <Text style={styles.label}>{label}</Text>
                              <TextInput
                                accessibilityLabel={`${row.label} ${label}`}
                                editable={writable}
                                multiline
                                maxLength={STORY_STRUCTURE_MAX_INTENT_FIELD_CHARS}
                                value={intentFieldValue(operation, key)}
                                onChangeText={(value) =>
                                  updateEdit(operation.operationId, {
                                    intent: Object.freeze({
                                      ...edits[operation.operationId]?.intent,
                                      [key]: value
                                    })
                                  })
                                }
                                style={[styles.input, styles.multiline]}
                              />
                            </View>
                          ))}
                        </>
                      ) : null}
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        ))}

        {props.status === "review" && missingRequired.length > 0 ? (
          <View style={styles.notice}>
            <Text accessibilityRole="alert" style={styles.body}>
              Selected operations still need prerequisites:{" "}
              {missingRequired
                .map((operationId) => {
                  const row = rows.find((entry) => entry.operationId === operationId);
                  return row === undefined
                    ? String(operationId)
                    : `${row.label} (${String(operationId)})`;
                })
                .join("; ")}
            </Text>
            <Action
              label="Select required operations"
              disabled={!writable}
              onPress={() =>
                setSelectedOperationIds(
                  addRequiredStoryStructureOperations({
                    proposal: baseline.payload,
                    selectedOperationIds
                  })
                )
              }
            />
          </View>
        ) : null}

        {props.status === "review" && selectionEmpty ? (
          <Text accessibilityRole="alert" style={styles.error}>
            Select at least one operation before preview or apply.
          </Text>
        ) : null}

        {props.status === "review" ? (
          <>
            <View style={styles.actions}>
              <Action
                label={pending ? "Working…" : "Save review edits"}
                disabled={!writable || !dirty}
                onPress={() => {
                  void perform(async () => {
                    const patched = patchStoryStructureReviewPayload({
                      stored: baseline.payload,
                      edits
                    });
                    if (!patched.ok) {
                      throw new Error(patched.message);
                    }
                    const saved = await props.onEdit(patched.payload);
                    setBaseline(saved);
                    setEdits({});
                  }, "Review edits saved. Preview impact before applying.");
                }}
              />
              <Action
                label="Discard local edits"
                disabled={!dirty || busy}
                onPress={() => {
                  setEdits({});
                  setError(undefined);
                }}
              />
            </View>

            <View style={styles.panel}>
              <Text style={styles.sectionTitle}>Preview impact</Text>
              <Text style={styles.hint}>
                Save edits first. Preview uses your exact operation selection and does not widen
                it silently.
              </Text>
              <Action
                label="Preview selected operations"
                disabled={!writable || !canPreview}
                onPress={() => {
                  void perform(async () => {
                    await props.onPreview(selectedOperationIds);
                  }, "Impact preview updated for the current selection.");
                }}
              />
              {previewPresentation ? (
                <>
                  <Text style={styles.label}>Manuscript scenes</Text>
                  <Text style={styles.body}>
                    {previewPresentation.sceneCountBefore} →{" "}
                    {previewPresentation.sceneCountAfter} in reading order
                  </Text>
                  <Text style={styles.label}>Structural changes</Text>
                  <Text style={styles.body}>
                    Created parts {previewPresentation.createdParts}; chapters{" "}
                    {previewPresentation.createdChapters}; planned scenes{" "}
                    {previewPresentation.createdScenes}; updated scenes{" "}
                    {previewPresentation.updatedScenes}; moved{" "}
                    {previewPresentation.movedScenes}; archived{" "}
                    {previewPresentation.archivedScenes}; restored{" "}
                    {previewPresentation.restoredScenes}
                  </Text>
                  <Text style={styles.label}>Empty Draft genesis</Text>
                  <Text style={styles.body}>
                    {previewPresentation.emptyGenesisCount} new scene placeholder
                    {previewPresentation.emptyGenesisCount === 1 ? "" : "s"} would open with empty
                    Draft documents.
                  </Text>
                  {previewPresentation.narrativeImpactLines.length > 0 ? (
                    <>
                      <Text style={styles.label}>Narrative reading-order anchors</Text>
                      {previewPresentation.narrativeImpactLines.map((line) => (
                        <Text key={line} style={styles.body}>
                          {line}
                        </Text>
                      ))}
                    </>
                  ) : null}
                  {previewPresentation.staleCheckLines.length > 0 ? (
                    <>
                      <Text style={styles.label}>Checks after apply</Text>
                      {previewPresentation.staleCheckLines.map((line) => (
                        <Text key={line} style={styles.body}>
                          {line}
                        </Text>
                      ))}
                    </>
                  ) : null}
                  <Text style={styles.hint}>{previewPresentation.canvasInvariantLine}</Text>
                  <Text style={styles.body}>{previewPresentation.projectVersionLine}</Text>
                </>
              ) : null}
            </View>

            {createdSceneOptions.length > 0 ? (
              <View style={styles.panel}>
                <Text style={styles.sectionTitle}>Optional Canvas card</Text>
                <Text style={styles.hint}>{storyStructureCanvasPlacementCopy()}</Text>
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityLabel="Place one Canvas card for a created scene"
                  accessibilityState={{ checked: requestCanvasCard, disabled: !writable }}
                  disabled={!writable}
                  onPress={() => setRequestCanvasCard((value) => !value)}
                  style={styles.checkRow}
                >
                  <Text style={styles.choiceMark}>{requestCanvasCard ? "✓" : ""}</Text>
                  <Text style={styles.body}>Place one card on the current Canvas board</Text>
                </Pressable>
                {requestCanvasCard ? (
                  <View accessibilityRole="radiogroup" style={styles.choices}>
                    {createdSceneOptions.map((sceneId) => (
                      <Choice
                        key={String(sceneId)}
                        label={createdSceneLabels.get(sceneId) ?? "Planned scene"}
                        description="One created scene only"
                        selected={canvasSceneId === sceneId}
                        disabled={!writable}
                        onPress={() => setCanvasSceneId(sceneId)}
                      />
                    ))}
                  </View>
                ) : null}
              </View>
            ) : null}

            <View style={styles.actions}>
              <Action
                label="Apply structure once"
                primary
                disabled={!canApply || busy}
                onPress={() => {
                  void perform(
                    () =>
                      props.onApply({
                        selectedOperationIds,
                        canvasSceneId: requestCanvasCard ? canvasSceneId : undefined
                      }),
                    "Structure applied in one acknowledged batch."
                  );
                }}
              />
              <Action
                label="Reject artifact"
                disabled={!writable || dirty}
                onPress={() => {
                  void perform(
                    () => props.onReject(baseline.pointer),
                    "Artifact rejected. Canonical structure was not changed."
                  );
                }}
              />
            </View>
            {dirty ? (
              <Text style={styles.hint}>
                Save structure edits before preview or apply. Edits clear any prior preview match.
              </Text>
            ) : null}
          </>
        ) : props.status === "applied" ? (
          <View style={styles.resultPanel}>
            <Text style={styles.sectionTitle}>Applied</Text>
            <Text style={styles.body}>
              Structure changes were acknowledged
              {props.appliedProjectVersion !== undefined
                ? ` at project version ${props.appliedProjectVersion}`
                : ""}
              . Scene prose was not rewritten.
            </Text>
            {props.canvasPlacedSceneLabel ? (
              <Text style={styles.body}>
                Canvas card placed for {props.canvasPlacedSceneLabel}.
              </Text>
            ) : null}
            {props.onOpenScene && props.appliedFirstCreatedSceneId ? (
              <Action
                label="Open first created scene"
                primary
                onPress={() => props.onOpenScene!(props.appliedFirstCreatedSceneId!)}
              />
            ) : null}
          </View>
        ) : (
          <View style={styles.resultPanel}>
            <Text style={styles.sectionTitle}>Artifact rejected</Text>
            <Text style={styles.body}>
              No structure, Canvas geometry, or scene prose was changed.
            </Text>
          </View>
        )}

        {message ? (
          <Text accessibilityLiveRegion="polite" style={styles.success}>
            {message}
          </Text>
        ) : null}
        {error || props.externalError || props.refreshProblem ? (
          <View style={styles.field}>
            <Text accessibilityRole="alert" style={styles.error}>
              {error ?? props.externalError ?? props.refreshProblem}
            </Text>
            {props.onReload ? (
              <Action
                label="Refresh saved review"
                disabled={busy}
                onPress={() => {
                  void perform(
                    () => props.onReload!(),
                    "Latest saved review loaded."
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
      <Text style={[styles.buttonText, primary && styles.primaryText]}>{label}</Text>
    </Pressable>
  );
}

function Choice({
  label,
  description,
  selected,
  disabled,
  onPress
}: Readonly<{
  label: string;
  description?: string;
  selected: boolean;
  disabled: boolean;
  onPress(): void;
}>) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.choice, selected && styles.choiceSelected]}
    >
      <Text style={styles.choiceMark}>{selected ? "●" : ""}</Text>
      <View style={styles.choiceText}>
        <Text style={styles.label}>{label}</Text>
        {description ? <Text style={styles.hint}>{description}</Text> : null}
      </View>
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
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    padding: 12,
    fontFamily: fonts.ui,
    fontSize: 14,
    color: colors.ink,
    backgroundColor: colors.panel
  },
  multiline: { minHeight: 72, textAlignVertical: "top" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  panel: {
    gap: 10,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    backgroundColor: colors.panel
  },
  operationCard: {
    gap: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    backgroundColor: colors.paper
  },
  checkRow: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  choices: { gap: 8 },
  choice: {
    flexDirection: "row",
    gap: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    backgroundColor: colors.paper
  },
  choiceSelected: { borderColor: colors.accent },
  choiceMark: {
    width: 20,
    minHeight: 20,
    textAlign: "center",
    color: colors.accent,
    fontFamily: fonts.uiSemibold
  },
  choiceText: { flex: 1, minWidth: 0, gap: 3 },
  resultPanel: {
    gap: 10,
    padding: 16,
    borderRadius: 10,
    backgroundColor: colors.greenSoft
  },
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
  success: { color: colors.green, fontFamily: fonts.ui, lineHeight: 20 },
  error: { color: colors.red, fontFamily: fonts.ui, lineHeight: 20 }
});

export type {
  StoryStructureReviewArtifact,
  StoryStructureReviewPreviewBinding
} from "./story-structure-review.js";
