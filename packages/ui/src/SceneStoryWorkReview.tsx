import { useEffect, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import type {
  BookId,
  ChapterId,
  SceneDraftV1,
  StoryWorkArtifactPointer
} from "@ghostwriter/core";
import { SCENE_DRAFT_V1_MAX_PROSE_CHARS } from "@ghostwriter/core";
import {
  applySceneReviewRevisionPrefill,
  sameSceneReviewArtifact,
  sceneReviewHasEdits,
  sceneReviewPayload,
  sceneReviewSourceCoverage,
  shouldApplySceneReviewRevisionPrefill,
  type SceneReviewArtifact,
  type SceneReviewSource,
  type SceneStoryWorkRevisionPrefill
} from "./scene-story-work-review.js";

export type { SceneStoryWorkRevisionPrefill } from "./scene-story-work-review.js";
import { ghostwriterTheme } from "./theme.js";

const { colors, fonts } = ghostwriterTheme;
const REVIEW_HEADING_ID = "scene-story-work-review-heading";
export const SCENE_STORY_WORK_REVISION_REQUEST_NATIVE_ID =
  "scene-story-work-revision-request";

export type SceneReviewManuscriptPlacement =
  | Readonly<{
      kind: "chapter";
      bookId: BookId;
      chapterId: ChapterId;
      position?: number;
    }>
  | Readonly<{ kind: "unassigned"; bookId: BookId; position?: number }>;

export type SceneReviewPlacementChoice = Readonly<{
  id: string;
  label: string;
  description?: string;
  manuscriptPlacement: SceneReviewManuscriptPlacement;
}>;

export type SceneReviewDestination =
  | Readonly<{
      operation: "create";
      label: string;
      suggestedTitle?: string;
      placementChoices: readonly SceneReviewPlacementChoice[];
      currentCanvas?: Readonly<{ label: string; description?: string }>;
    }>
  | Readonly<{
      operation: "update";
      label: string;
    }>;

export type SceneReviewApplyRequest =
  | Readonly<{
      mode: "create-scene";
      artifact: StoryWorkArtifactPointer;
      title: string;
      manuscriptPlacement: SceneReviewManuscriptPlacement;
      placeOnCurrentCanvas: boolean;
    }>
  | Readonly<{
      mode: "named-variant";
      artifact: StoryWorkArtifactPointer;
      variantName: string;
    }>
  | Readonly<{
      mode: "apply-revision";
      artifact: StoryWorkArtifactPointer;
    }>;

export type SceneStoryWorkReviewProps = Readonly<{
  artifact: SceneReviewArtifact;
  destination: SceneReviewDestination;
  sourceScenes: readonly SceneReviewSource[];
  brief: string;
  constraints: string;
  doneWhen: string;
  revisionInstruction?: string;
  revisionPrefill?: SceneStoryWorkRevisionPrefill;
  refreshProblem?: string;
  status: "review" | "applied" | "rejected";
  appliedMode?: SceneReviewApplyRequest["mode"];
  onSave(input: Readonly<{
    artifact: StoryWorkArtifactPointer;
    payload: SceneDraftV1;
  }>): Promise<SceneReviewArtifact>;
  onApply(input: SceneReviewApplyRequest): Promise<void>;
  onReject(artifact: StoryWorkArtifactPointer): Promise<void>;
  onRevise(input: Readonly<{
    artifact: StoryWorkArtifactPointer;
    instruction: string;
  }>): Promise<void>;
  onClose(): void;
  onReload?(): Promise<void>;
  onOpenResult?(): void;
  onDirtyChange?(dirty: boolean): void;
  onBusyChange?(busy: boolean): void;
}>;

/** Presentational review only. Canonical scene versions, leases and IDs stay with the caller. */
export function SceneStoryWorkReview(props: SceneStoryWorkReviewProps) {
  const destination = props.destination;
  const initialTitle =
    destination.operation === "create" ? destination.suggestedTitle ?? "" : "";
  const initialPlacementId =
    destination.operation === "create"
      ? destination.placementChoices[0]?.id
      : undefined;
  const [baseline, setBaseline] = useState(props.artifact);
  const [prose, setProse] = useState(props.artifact.payload.prose);
  const [instruction, setInstruction] = useState("");
  const [title, setTitle] = useState(initialTitle);
  const [placementId, setPlacementId] = useState(initialPlacementId);
  const [placeOnCurrentCanvas, setPlaceOnCurrentCanvas] = useState(false);
  const [updateMode, setUpdateMode] = useState<
    "named-variant" | "apply-revision"
  >("named-variant");
  const [variantName, setVariantName] = useState("");
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [revisionPrefillNotice, setRevisionPrefillNotice] = useState<string>();
  const appliedRevisionPrefillTokenRef = useRef<string | undefined>(undefined);
  const instructionRef = useRef(instruction);
  instructionRef.current = instruction;

  const proseDirty = sceneReviewHasEdits(prose, baseline.payload);
  const stale = !sameSceneReviewArtifact(
    baseline.pointer,
    props.artifact.pointer
  );
  const applyChoiceDirty =
    destination.operation === "create"
      ? title !== initialTitle ||
        placementId !== initialPlacementId ||
        placeOnCurrentCanvas
      : updateMode !== "named-variant" || variantName.length > 0;
  const dirty =
    props.status === "review" &&
    (proseDirty || instruction.trim().length > 0 || applyChoiceDirty);
  const writable = props.status === "review" && !pending && !stale;
  const selectedPlacement =
    destination.operation === "create"
      ? destination.placementChoices.find((choice) => choice.id === placementId)
      : undefined;
  const applyReady =
    writable &&
    !proseDirty &&
    instruction.trim().length === 0 &&
    (destination.operation === "create"
      ? title.trim().length > 0 && selectedPlacement !== undefined
      : updateMode === "apply-revision" || variantName.trim().length > 0);
  const sourceCoverage = sceneReviewSourceCoverage(
    baseline.payload,
    props.sourceScenes
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

  useEffect(() => {
    if (props.status !== "review") return;
    const nextToken = props.revisionPrefill?.requestToken;
    if (
      !shouldApplySceneReviewRevisionPrefill(
        appliedRevisionPrefillTokenRef.current,
        nextToken
      )
    ) {
      return;
    }
    appliedRevisionPrefillTokenRef.current = nextToken.trim();
    const decision = applySceneReviewRevisionPrefill({
      instruction: props.revisionPrefill!.instruction,
      currentInstruction: instructionRef.current
    });
    if (decision.action === "install") {
      setRevisionPrefillNotice(undefined);
      setInstruction(decision.instruction);
      if (typeof document === "undefined") return;
      const timer = setTimeout(() => {
        const field = document.getElementById(
          SCENE_STORY_WORK_REVISION_REQUEST_NATIVE_ID
        );
        if (!(field instanceof HTMLElement)) return;
        field.focus();
      }, 30);
      return () => clearTimeout(timer);
    }
    setRevisionPrefillNotice(decision.reason);
  }, [props.revisionPrefill, props.status]);

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
    setProse(props.artifact.payload.prose);
    setInstruction("");
    setMessage("Latest artifact loaded.");
    setError(undefined);
  }

  function resetApplyChoices() {
    setTitle(initialTitle);
    setPlacementId(initialPlacementId);
    setPlaceOnCurrentCanvas(false);
    setUpdateMode("named-variant");
    setVariantName("");
    setError(undefined);
  }

  function applyReviewedArtifact() {
    if (!applyReady) return;
    if (destination.operation === "create") {
      if (selectedPlacement === undefined) return;
      void perform(
        () =>
          props.onApply({
            mode: "create-scene",
            artifact: baseline.pointer,
            title,
            manuscriptPlacement: selectedPlacement.manuscriptPlacement,
            placeOnCurrentCanvas
          }),
        "Scene created from the reviewed artifact."
      );
      return;
    }
    if (updateMode === "named-variant") {
      void perform(
        () =>
          props.onApply({
            mode: "named-variant",
            artifact: baseline.pointer,
            variantName
          }),
        "Named variant saved. The working Draft was not replaced."
      );
      return;
    }
    void perform(
      () =>
        props.onApply({
          mode: "apply-revision",
          artifact: baseline.pointer
        }),
      "The reviewed prose replaced the working Draft as a saved revision."
    );
  }

  const appliedCopy =
    props.appliedMode === "create-scene"
      ? "The reviewed artifact created a scene in your manuscript."
      : props.appliedMode === "named-variant"
        ? "The reviewed artifact is saved as a named variant. The working Draft was not replaced."
        : props.appliedMode === "apply-revision"
          ? "The reviewed artifact replaced the working Draft as an immutable revision."
          : "The reviewed scene artifact was applied.";
  const openResultLabel =
    props.appliedMode === "named-variant"
      ? "Open scene"
      : props.appliedMode === "apply-revision"
        ? "Open updated Draft"
        : "Open created scene";

  return (
    <View accessibilityLabel="Scene review" style={styles.root}>
      <View style={styles.header}>
        <View style={styles.heading}>
          <Text style={styles.kicker}>
            SCENE · {props.status === "applied" ? "APPLIED" : props.status === "rejected" ? "REJECTED" : "REVIEW"}
          </Text>
          <Text
            accessibilityRole="header"
            nativeID={REVIEW_HEADING_ID}
            style={styles.title}
          >
            {destination.label}
          </Text>
        </View>
        <Action
          label="Back to story"
          disabled={pending}
          onPress={() => {
            if (dirty) {
              setError(
                "Save or discard prose, clear the revision request, and reset unfinished apply choices before leaving this review."
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
        {props.revisionInstruction ? (
          <>
            <Text style={styles.label}>Revision request for this artifact</Text>
            <Text style={styles.body}>{props.revisionInstruction}</Text>
          </>
        ) : null}

        <View style={styles.field}>
          <Text style={styles.label}>
            Selected scene sources · {sourceCoverage.length}
          </Text>
          {sourceCoverage.length === 0 ? (
            <Text style={styles.hint}>No scene prose was supplied as a source.</Text>
          ) : (
            sourceCoverage.map((source, index) => (
              <Text key={source.sceneId} style={styles.body}>
                {index + 1}. {source.title}
                {source.available ? "" : " · label unavailable"}
              </Text>
            ))
          )}
          <Text style={styles.hint}>
            These source links stay unchanged when you edit the prose.
          </Text>
        </View>

        {stale ? (
          <View style={styles.notice}>
            <Text style={styles.body}>
              {proseDirty
                ? "A newer artifact is available. Your local prose is still shown; discard it and load the latest artifact before saving or applying."
                : "A newer artifact is ready. Load it before reviewing or applying."}
            </Text>
            <Action
              label={
                proseDirty
                  ? "Discard prose and load latest artifact"
                  : "Load latest artifact"
              }
              disabled={pending}
              onPress={reloadArtifact}
            />
          </View>
        ) : null}

        <View style={styles.field}>
          <Text style={styles.label}>Proposed scene prose</Text>
          <TextInput
            accessibilityLabel="Proposed scene prose"
            editable={writable}
            multiline
            maxLength={SCENE_DRAFT_V1_MAX_PROSE_CHARS}
            value={prose}
            onChangeText={(value) => {
              setProse(value);
              setMessage(undefined);
            }}
            style={[styles.input, styles.proseInput]}
          />
        </View>

        {props.status === "review" ? (
          <>
            <View style={styles.actions}>
              <Action
                label={pending ? "Working…" : "Save review edits"}
                disabled={!writable || !proseDirty}
                onPress={() => {
                  void perform(async () => {
                    const saved = await props.onSave({
                      artifact: baseline.pointer,
                      payload: sceneReviewPayload(prose, baseline.payload)
                    });
                    setBaseline(saved);
                    setProse(saved.payload.prose);
                  }, "Review edits saved. Read the updated prose before applying it.");
                }}
              />
              <Action
                label="Discard local prose edits"
                disabled={!proseDirty || pending}
                onPress={() => {
                  setProse(baseline.payload.prose);
                  setError(undefined);
                }}
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Ask for a revision</Text>
              {revisionPrefillNotice ? (
                <Text accessibilityRole="alert" style={styles.error}>
                  {revisionPrefillNotice}
                </Text>
              ) : null}
              <TextInput
                accessibilityLabel="Scene revision request"
                nativeID={SCENE_STORY_WORK_REVISION_REQUEST_NATIVE_ID}
                editable={writable}
                multiline
                maxLength={20_000}
                value={instruction}
                onChangeText={(value) => {
                  setInstruction(value);
                  if (revisionPrefillNotice) setRevisionPrefillNotice(undefined);
                }}
                style={[styles.input, styles.multiline]}
              />
              <Text style={styles.hint}>
                The agent receives this request with your original brief, current
                artifact, and the latest saved revisions of the same selected sources.
              </Text>
              <View style={styles.actions}>
                <Action
                  label="Revise using latest saved sources"
                  disabled={!writable || proseDirty || !instruction.trim()}
                  onPress={() => {
                    void perform(async () => {
                      await props.onRevise({
                        artifact: baseline.pointer,
                        instruction
                      });
                      setInstruction("");
                    }, "The revision attempt is recorded. Load its result before applying.");
                  }}
                />
                <Action
                  label="Clear revision request"
                  disabled={pending || !instruction}
                  onPress={() => setInstruction("")}
                />
              </View>
            </View>

            {destination.operation === "create" ? (
              <View style={styles.applyPanel}>
                <Text style={styles.sectionTitle}>Create this scene</Text>
                <Text style={styles.hint}>
                  The scene is added only after this action is acknowledged.
                </Text>
                <Text style={styles.label}>Scene title</Text>
                <TextInput
                  accessibilityLabel="Scene title"
                  editable={writable}
                  maxLength={200}
                  value={title}
                  onChangeText={setTitle}
                  style={styles.input}
                />
                <Text style={styles.label}>Manuscript destination</Text>
                <View accessibilityRole="radiogroup" style={styles.choices}>
                  {destination.placementChoices.map((choice) => (
                    <Choice
                      key={choice.id}
                      label={choice.label}
                      description={choice.description}
                      selected={choice.id === placementId}
                      disabled={!writable}
                      onPress={() => setPlacementId(choice.id)}
                    />
                  ))}
                </View>
                {destination.placementChoices.length === 0 ? (
                  <Text accessibilityRole="alert" style={styles.error}>
                    No available manuscript destination was supplied. Return to the
                    story and choose a book or chapter before creating this scene.
                  </Text>
                ) : null}
                {destination.currentCanvas ? (
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityLabel={`Place on ${destination.currentCanvas.label}`}
                    accessibilityState={{
                      checked: placeOnCurrentCanvas,
                      disabled: !writable
                    }}
                    disabled={!writable}
                    onPress={() => setPlaceOnCurrentCanvas((value) => !value)}
                    style={styles.checkChoice}
                  >
                    <Text style={styles.choiceMark}>
                      {placeOnCurrentCanvas ? "✓" : ""}
                    </Text>
                    <View style={styles.choiceText}>
                      <Text style={styles.label}>
                        Place on {destination.currentCanvas.label}
                      </Text>
                      {destination.currentCanvas.description ? (
                        <Text style={styles.hint}>
                          {destination.currentCanvas.description}
                        </Text>
                      ) : null}
                    </View>
                  </Pressable>
                ) : null}
                <View style={styles.actions}>
                  <Action
                    label="Create scene"
                    primary
                    disabled={!applyReady}
                    onPress={applyReviewedArtifact}
                  />
                  <Action
                    label="Reset creation choices"
                    disabled={pending || !applyChoiceDirty}
                    onPress={resetApplyChoices}
                  />
                </View>
              </View>
            ) : (
              <View style={styles.applyPanel}>
                <Text style={styles.sectionTitle}>Apply to this scene</Text>
                <View accessibilityRole="radiogroup" style={styles.choices}>
                  <Choice
                    label="Save as named variant"
                    description="Keeps the current working Draft unchanged and saves this prose as an immutable alternative in scene history."
                    selected={updateMode === "named-variant"}
                    disabled={!writable}
                    onPress={() => setUpdateMode("named-variant")}
                  />
                  <Choice
                    label="Replace working Draft"
                    description="Replaces the current working prose with this reviewed artifact and records an immutable agent-applied revision. A version or editing-session conflict leaves the review unchanged."
                    selected={updateMode === "apply-revision"}
                    disabled={!writable}
                    onPress={() => setUpdateMode("apply-revision")}
                  />
                </View>
                {updateMode === "named-variant" ? (
                  <>
                    <Text style={styles.label}>Variant name</Text>
                    <TextInput
                      accessibilityLabel="Variant name"
                      editable={writable}
                      maxLength={100}
                      value={variantName}
                      onChangeText={setVariantName}
                      style={styles.input}
                    />
                  </>
                ) : (
                  <Text style={styles.warning}>
                    This replaces the visible working Draft after the save is
                    acknowledged. Existing history remains available.
                  </Text>
                )}
                <View style={styles.actions}>
                  <Action
                    label={
                      updateMode === "named-variant"
                        ? "Save named variant"
                        : "Replace working Draft"
                    }
                    primary
                    disabled={!applyReady}
                    onPress={applyReviewedArtifact}
                  />
                  <Action
                    label="Reset apply choices"
                    disabled={pending || !applyChoiceDirty}
                    onPress={resetApplyChoices}
                  />
                </View>
              </View>
            )}

            <Action
              label="Reject artifact"
              disabled={!writable || proseDirty || Boolean(instruction.trim())}
              onPress={() => {
                void perform(
                  () => props.onReject(baseline.pointer),
                  "Artifact rejected. No scene, variant, or Draft prose was changed."
                );
              }}
            />
            {proseDirty ? (
              <Text style={styles.hint}>
                Save your prose edits before requesting another version or applying
                this scene.
              </Text>
            ) : null}
          </>
        ) : props.status === "applied" ? (
          <View style={styles.resultPanel}>
            <Text style={styles.sectionTitle}>Applied</Text>
            <Text style={styles.body}>{appliedCopy}</Text>
            {props.onOpenResult ? (
              <Action
                label={openResultLabel}
                primary
                onPress={props.onOpenResult}
              />
            ) : null}
          </View>
        ) : (
          <View style={styles.resultPanel}>
            <Text style={styles.sectionTitle}>Artifact rejected</Text>
            <Text style={styles.body}>
              No scene, named variant, or working Draft prose was changed.
            </Text>
          </View>
        )}

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
                    "Latest saved review and story loaded. Local prose is retained."
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
      <Text style={[styles.buttonText, primary && styles.primaryText]}>
        {label}
      </Text>
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
  multiline: { minHeight: 86, textAlignVertical: "top" },
  proseInput: { minHeight: 320, textAlignVertical: "top", lineHeight: 22 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  choices: { gap: 8 },
  choice: {
    flexDirection: "row",
    gap: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    backgroundColor: colors.panel
  },
  choiceSelected: { borderColor: colors.accent },
  checkChoice: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  choiceMark: {
    width: 20,
    minHeight: 20,
    textAlign: "center",
    color: colors.accent,
    fontFamily: fonts.uiSemibold
  },
  choiceText: { flex: 1, minWidth: 0, gap: 3 },
  applyPanel: {
    gap: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    backgroundColor: colors.panel
  },
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
  warning: { color: colors.red, fontFamily: fonts.ui, fontSize: 13, lineHeight: 20 },
  success: { color: colors.green, fontFamily: fonts.ui, lineHeight: 20 },
  error: { color: colors.red, fontFamily: fonts.ui, lineHeight: 20 }
});
