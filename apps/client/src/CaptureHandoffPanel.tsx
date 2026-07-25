import type { ProjectNavigator } from "@ghostwriter/core";
import { ghostwriterTheme } from "@ghostwriter/ui";
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
  CaptureHeadResponse,
  PromoteCaptureToSceneResponse
} from "./api.js";
import {
  buildCaptureHandoffPromoteRequest,
  captureHandoffApplyStatusText,
  captureHandoffAuthorityReceiptLines,
  captureHandoffCanApply,
  captureHandoffCanvasGeometryHintText,
  captureHandoffDefaultFormState,
  captureHandoffPanelSessionForCapture,
  captureHandoffPanelShouldResetSession,
  captureHandoffIntegratedReceiptLines,
  captureHandoffIsEligibleHead,
  captureHandoffOpenDraftAvailable,
  captureHandoffOpenSplitAvailable,
  captureHandoffPreviewLines,
  CAPTURE_HANDOFF_CANVAS_UNAVAILABLE,
  defaultCaptureHandoffCanvasGeometry,
  messageForCaptureHandoffPromotionFailure,
  type CaptureHandoffFormState,
  type CaptureHandoffPromoteInput
} from "./capture-handoff.js";
import { listManuscriptHandoffChoices } from "./manuscript-handoff-placement.js";

const { colors, fonts } = ghostwriterTheme;

export type CaptureHandoffPanelProps = Readonly<{
  project: ProjectNavigator;
  projectVersion: number;
  captureId: string;
  captureHead: CaptureHeadResponse;
  canvasVersion?: number;
  ensureCanvasVersion?(): Promise<number | undefined>;
  onPromote?(input: CaptureHandoffPromoteInput): Promise<PromoteCaptureToSceneResponse>;
  onIntegrated?(head: CaptureHeadResponse): void;
  onOpenDraft?(sceneId: string): void;
  onOpenSplit?(sceneId: string): void;
  onViewSource?(): void;
  /** When true, disables navigation that would leave the active handoff session. */
  navigationDisabled?: boolean;
}>;

function HandoffButton({
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

export function CaptureHandoffPanel({
  project,
  projectVersion,
  captureId,
  captureHead: initialHead,
  canvasVersion,
  ensureCanvasVersion,
  onPromote,
  onIntegrated,
  onOpenDraft,
  onOpenSplit,
  onViewSource,
  navigationDisabled = false
}: CaptureHandoffPanelProps) {
  const [head, setHead] = useState(initialHead);
  const [form, setForm] = useState<CaptureHandoffFormState>(() =>
    captureHandoffDefaultFormState(project)
  );
  const [applying, setApplying] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>();
  const titleRef = useRef<TextInput>(null);
  const sessionScopeRef = useRef<
    Readonly<{ captureId: string; projectId: string }> | undefined
  >(undefined);

  useEffect(() => {
    const previousScope = sessionScopeRef.current;
    if (
      captureHandoffPanelShouldResetSession({
        captureId,
        projectId: project.id,
        previousCaptureId: previousScope?.captureId,
        previousProjectId: previousScope?.projectId
      })
    ) {
      const session = captureHandoffPanelSessionForCapture({
        project,
        captureHead: initialHead
      });
      setHead(session.head);
      setForm(session.form);
      setApplying(session.applying);
      setErrorMessage(session.errorMessage);
      sessionScopeRef.current = { captureId, projectId: project.id };
      titleRef.current?.focus();
      return;
    }
    setHead(initialHead);
  }, [captureId, initialHead, project]);

  const integrated = head.status === "integrated";
  const eligible = captureHandoffIsEligibleHead(head);
  const placementChoices = listManuscriptHandoffChoices(project);
  const previewLines = captureHandoffPreviewLines({
    captureHead: head,
    projectVersion,
    canvasVersion,
    project,
    placementKey: form.placementKey,
    canvasEnabled: form.canvasEnabled
  });
  const canApply = captureHandoffCanApply({
    head,
    project,
    form,
    busy: applying,
    canvasEnabledRequiresVersion:
      form.canvasEnabled && canvasVersion === undefined && ensureCanvasVersion === undefined
  }) && onPromote !== undefined;

  const leaveHandoffDisabled = navigationDisabled || applying;

  async function applyIntegration(): Promise<void> {
    if (!canApply || onPromote === undefined) return;
    setApplying(true);
    setErrorMessage(undefined);
    try {
      let resolvedCanvasVersion = canvasVersion;
      if (form.canvasEnabled) {
        if (resolvedCanvasVersion === undefined && ensureCanvasVersion !== undefined) {
          resolvedCanvasVersion = await ensureCanvasVersion();
        }
        if (resolvedCanvasVersion === undefined) {
          setErrorMessage(CAPTURE_HANDOFF_CANVAS_UNAVAILABLE);
          return;
        }
      }
      const canvas =
        form.canvasEnabled && resolvedCanvasVersion !== undefined
          ? defaultCaptureHandoffCanvasGeometry({
              project,
              placementKey: form.placementKey,
              expectedCanvasVersion: resolvedCanvasVersion
            })
          : undefined;
      const request = buildCaptureHandoffPromoteRequest({
        captureId,
        captureHead: head,
        projectVersion,
        project,
        form,
        canvas
      });
      if (request === undefined) return;
      const response = await onPromote(request);
      setHead(response.captureHead);
      onIntegrated?.(response.captureHead);
    } catch (cause) {
      setErrorMessage(messageForCaptureHandoffPromotionFailure(cause));
    } finally {
      setApplying(false);
    }
  }

  const statusText = captureHandoffApplyStatusText({
    applying,
    errorMessage,
    integrated
  });

  if (integrated) {
    const sceneId = head.integratedSceneId;
    return (
      <View accessibilityLabel="Capture integration receipt" style={styles.panel}>
        <Text accessibilityRole="header" style={styles.title}>
          Integration receipt
        </Text>
        <Text accessibilityLiveRegion="polite" style={styles.status}>
          {statusText}
        </Text>
        {captureHandoffIntegratedReceiptLines(head).map((line) => (
          <Text key={line} style={styles.receiptLine}>
            {line}
          </Text>
        ))}
        <View style={styles.actions}>
          {onViewSource !== undefined ? (
            <HandoffButton
              disabled={leaveHandoffDisabled}
              label="View source"
              onPress={onViewSource}
            />
          ) : null}
          {captureHandoffOpenDraftAvailable(head) && sceneId !== undefined ? (
            <HandoffButton
              disabled={leaveHandoffDisabled}
              label="Open Draft"
              onPress={() => onOpenDraft?.(sceneId)}
              primary
            />
          ) : null}
          {captureHandoffOpenSplitAvailable(head) && sceneId !== undefined ? (
            <HandoffButton
              disabled={leaveHandoffDisabled}
              label="Open Split"
              onPress={() => onOpenSplit?.(sceneId)}
            />
          ) : null}
        </View>
      </View>
    );
  }

  if (!eligible) {
    return (
      <View style={styles.panel}>
        <Text style={styles.title}>Handoff unavailable</Text>
        <Text style={styles.body}>
          Only acknowledged nonempty Captures can integrate into Draft.
        </Text>
        {onViewSource !== undefined ? (
          <HandoffButton
            disabled={leaveHandoffDisabled}
            label="View source"
            onPress={onViewSource}
          />
        ) : null}
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.panel}>
      <Text accessibilityRole="header" style={styles.title}>
        Integrate into Draft
      </Text>
      <Text style={styles.eyebrow}>No-AI authority receipt</Text>
      {captureHandoffAuthorityReceiptLines().map((line) => (
        <Text key={line} style={styles.receiptLine}>
          {line}
        </Text>
      ))}

      <View style={styles.field}>
        <Text nativeID="capture-handoff-title-label" style={styles.label}>
          Scene title
        </Text>
        <TextInput
          accessibilityLabel="Scene title"
          accessibilityLabelledBy="capture-handoff-title-label"
          editable={!applying}
          onChangeText={(title) => setForm((current) => ({ ...current, title }))}
          ref={titleRef}
          style={styles.input}
          value={form.title}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Manuscript placement</Text>
        <View accessibilityRole="radiogroup" style={styles.choiceRow}>
          {placementChoices.map((choice) => {
            const selected = choice.key === form.placementKey;
            return (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                key={choice.key}
                onPress={() =>
                  setForm((current) => ({
                    ...current,
                    placementKey: choice.key
                  }))
                }
                style={({ pressed }) => [
                  styles.choice,
                  selected && styles.choiceSelected,
                  pressed && styles.buttonPressed
                ]}
              >
                <Text style={styles.choiceText}>{choice.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Canvas card</Text>
        <HandoffButton
          disabled={applying}
          label={form.canvasEnabled ? "Add Canvas card · on" : "Add Canvas card · off"}
          onPress={() =>
            setForm((current) => ({
              ...current,
              canvasEnabled: !current.canvasEnabled
            }))
          }
        />
        {form.canvasEnabled ? (
          <Text style={styles.hint}>
            {captureHandoffCanvasGeometryHintText(project, form.placementKey)}
          </Text>
        ) : null}
      </View>

      <View accessibilityLabel="Apply preview" style={styles.preview}>
        <Text style={styles.previewTitle}>Apply preview</Text>
        {previewLines.map((line) => (
          <Text key={line} style={styles.previewLine}>
            {line}
          </Text>
        ))}
      </View>

      <Text
        accessibilityLiveRegion="polite"
        accessibilityRole={errorMessage !== undefined ? "alert" : undefined}
        style={[styles.status, errorMessage !== undefined && styles.statusError]}
      >
        {statusText}
      </Text>

      <View style={styles.actions}>
        {onViewSource !== undefined ? (
          <HandoffButton
            disabled={leaveHandoffDisabled}
            label="View source"
            onPress={onViewSource}
          />
        ) : null}
        <HandoffButton
          disabled={!canApply}
          label={applying ? "Applying…" : "Apply"}
          onPress={() => void applyIntegration()}
          primary
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 10,
    borderWidth: 1,
    flex: 1,
    gap: 10,
    minWidth: 260,
    padding: 14
  },
  title: {
    color: colors.ink,
    fontFamily: fonts.uiMedium,
    fontSize: 18
  },
  eyebrow: {
    color: colors.muted,
    fontFamily: fonts.uiMedium,
    fontSize: 12,
    letterSpacing: 0.4,
    textTransform: "uppercase"
  },
  body: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 13,
    lineHeight: 18
  },
  receiptLine: {
    color: colors.ink,
    fontFamily: fonts.ui,
    fontSize: 13,
    lineHeight: 18
  },
  field: {
    gap: 6
  },
  label: {
    color: colors.ink,
    fontFamily: fonts.uiMedium,
    fontSize: 13
  },
  input: {
    backgroundColor: colors.paper,
    borderColor: colors.line,
    borderRadius: 8,
    borderWidth: 1,
    color: colors.ink,
    fontFamily: fonts.story,
    fontSize: 16,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  choiceRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  choice: {
    backgroundColor: colors.paper,
    borderColor: colors.line,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  choiceSelected: {
    borderColor: colors.brandDark
  },
  choiceText: {
    color: colors.ink,
    fontFamily: fonts.ui,
    fontSize: 12
  },
  hint: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 12,
    lineHeight: 16
  },
  preview: {
    backgroundColor: colors.wash,
    borderRadius: 8,
    gap: 4,
    padding: 10
  },
  previewTitle: {
    color: colors.ink,
    fontFamily: fonts.uiMedium,
    fontSize: 12
  },
  previewLine: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 12,
    lineHeight: 16
  },
  status: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 12
  },
  statusError: {
    color: colors.amber
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  button: {
    backgroundColor: colors.paper,
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
