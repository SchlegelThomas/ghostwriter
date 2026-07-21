import { useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ProjectNavigator } from "@ghostwriter/core";
import {
  CANVAS_WORKFLOW_LENSES,
  drillBreadcrumbs,
  workflowLensLabel,
  type CanvasDrillScope,
  type CanvasDrillStack,
  type CanvasWorkflowLens
} from "./canvas-drill.js";
import { ghostwriterTheme } from "./theme.js";

const { colors, fonts } = ghostwriterTheme;

export type CanvasDrillBarProps = Readonly<{
  project: ProjectNavigator;
  drillStack: CanvasDrillStack;
  workflowLens: CanvasWorkflowLens;
  canvasVisible?: boolean;
  /** Dense Map chrome: single thin row for breadcrumbs + lenses. */
  compact?: boolean;
  busy?: boolean;
  onDrillBack(): void;
  onDrillTo(scope: CanvasDrillScope): void;
  onWorkflowLensChange(lens: CanvasWorkflowLens): void;
}>;

const LENS_GLYPHS: Readonly<Record<CanvasWorkflowLens, string>> = {
  outline: "☰",
  relationships: "⇄",
  continuity: "◎",
  "plan-draft": "→",
  review: "◷"
};

export function CanvasDrillBar({
  project,
  drillStack,
  workflowLens,
  canvasVisible = true,
  compact = false,
  busy = false,
  onDrillBack,
  onDrillTo,
  onWorkflowLensChange
}: CanvasDrillBarProps) {
  const breadcrumbs = drillBreadcrumbs(drillStack, project);
  const canGoBack = drillStack.length > 1;

  useEffect(() => {
    if (!canGoBack || typeof document === "undefined") return;
    const backButton = document.getElementById("canvas-drill-back");
    backButton?.focus();
  }, [canGoBack, drillStack.length]);

  if (!canvasVisible) return null;

  return (
    <View
      accessibilityLabel="Canvas drill and workflow controls"
      style={[styles.bar, compact && styles.barCompact]}
    >
      <View style={styles.breadcrumbRow}>
        {canGoBack ? (
          <Pressable
            accessibilityLabel="Back to parent Canvas scope"
            accessibilityRole="button"
            disabled={busy}
            nativeID="canvas-drill-back"
            onPress={onDrillBack}
            style={({ pressed }) => [
              styles.backButton,
              compact && styles.backButtonCompact,
              pressed && styles.pressed,
              busy && styles.disabled
            ]}
          >
            <Text style={styles.backButtonText}>←</Text>
          </Pressable>
        ) : null}
        <View
          accessibilityLabel="Canvas drill breadcrumbs"
          style={styles.breadcrumbs}
        >
          {breadcrumbs.map((crumb, index) => {
            const last = index === breadcrumbs.length - 1;
            return (
              <View key={crumb.focusKey} style={styles.crumbGroup}>
                {index > 0 ? <Text style={styles.separator}>/</Text> : null}
                <Pressable
                  accessibilityLabel={`Canvas scope ${crumb.label}${
                    last ? ", current scope" : ""
                  }`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: last }}
                  disabled={busy || last}
                  nativeID={crumb.focusKey}
                  onPress={() => onDrillTo(crumb.scope)}
                  style={({ pressed }) => [
                    styles.crumbButton,
                    last && styles.crumbButtonCurrent,
                    pressed && styles.pressed,
                    (busy || last) && styles.crumbButtonDisabled
                  ]}
                >
                  <Text
                    style={[
                      styles.crumbText,
                      last && styles.crumbTextCurrent
                    ]}
                  >
                    {crumb.label}
                  </Text>
                </Pressable>
              </View>
            );
          })}
        </View>
      </View>
      <View
        accessibilityLabel="Canvas workflow lenses"
        accessibilityRole="tablist"
        style={styles.lensRow}
      >
        {CANVAS_WORKFLOW_LENSES.map((lens) => {
          const label = workflowLensLabel(lens);
          return (
            <Pressable
              accessibilityLabel={`${label} lens`}
              accessibilityRole="tab"
              accessibilityState={{ disabled: busy, selected: workflowLens === lens }}
              disabled={busy}
              key={lens}
              onPress={() => onWorkflowLensChange(lens)}
              {...({ title: `${label} lens` } as object)}
              style={({ pressed }) => [
                compact ? styles.lensIcon : styles.lensButton,
                workflowLens === lens &&
                  (compact
                    ? styles.lensIconSelected
                    : styles.lensButtonSelected),
                pressed && styles.pressed,
                busy && styles.disabled
              ]}
            >
              <Text
                style={[
                  compact ? styles.lensIconGlyph : styles.lensButtonText,
                  workflowLens === lens &&
                    (compact
                      ? styles.lensIconGlyphSelected
                      : styles.lensButtonTextSelected)
                ]}
              >
                {compact ? LENS_GLYPHS[lens] : label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    gap: 8,
    minWidth: 0,
    width: "100%"
  },
  barCompact: {
    alignItems: "center",
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "space-between",
    minHeight: 36,
    paddingHorizontal: 8,
    paddingVertical: 4
  },
  breadcrumbRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    flexShrink: 1,
    gap: 6,
    minWidth: 0
  },
  backButton: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 6,
    borderWidth: 1,
    minHeight: 30,
    paddingHorizontal: 8,
    paddingVertical: 5
  },
  backButtonCompact: {
    minHeight: 28,
    minWidth: 28,
    paddingHorizontal: 6
  },
  backButtonText: {
    color: colors.ink,
    fontFamily: fonts.uiSemibold,
    fontSize: 10
  },
  breadcrumbs: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 2,
    minWidth: 0
  },
  crumbGroup: {
    alignItems: "center",
    flexDirection: "row",
    gap: 2
  },
  separator: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 8
  },
  crumbButton: {
    borderRadius: 5,
    minHeight: 28,
    paddingHorizontal: 6,
    paddingVertical: 4
  },
  crumbButtonCurrent: {
    backgroundColor: colors.accentSoft
  },
  crumbButtonDisabled: {
    opacity: 1
  },
  crumbText: {
    color: colors.accent,
    fontFamily: fonts.uiSemibold,
    fontSize: 8
  },
  crumbTextCurrent: {
    color: colors.ink
  },
  lensRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
    minWidth: 0
  },
  lensButton: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 6,
    borderWidth: 1,
    minHeight: 30,
    paddingHorizontal: 8,
    paddingVertical: 5
  },
  lensButtonSelected: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent
  },
  lensButtonText: {
    color: colors.ink,
    fontFamily: fonts.uiSemibold,
    fontSize: 8
  },
  lensButtonTextSelected: {
    color: colors.accent
  },
  lensIcon: {
    alignItems: "center",
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 6,
    borderWidth: 1,
    height: 28,
    justifyContent: "center",
    minWidth: 28,
    paddingHorizontal: 5
  },
  lensIconSelected: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent
  },
  lensIconGlyph: {
    color: colors.ink,
    fontFamily: fonts.uiSemibold,
    fontSize: 12
  },
  lensIconGlyphSelected: {
    color: colors.accent
  },
  pressed: {
    opacity: 0.72
  },
  disabled: {
    opacity: 0.42
  }
});
