import { ghostwriterTheme } from "@ghostwriter/ui";
import type { ReactNode } from "react";
import { useEffect } from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";

const { colors } = ghostwriterTheme;

export type CaptureModalShellProps = Readonly<{
  visible: boolean;
  onRequestClose(): void;
  onShow?(): void;
  children: ReactNode;
  accessibilityLabel?: string;
  dismissAccessibilityLabel?: string;
}>;

export function CaptureModalShell({
  visible,
  onRequestClose,
  onShow,
  children,
  accessibilityLabel = "Capture composer",
  dismissAccessibilityLabel = "Dismiss Capture"
}: CaptureModalShellProps) {
  useEffect(() => {
    if (!visible || typeof document === "undefined") return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onRequestClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onRequestClose, visible]);

  return (
    <Modal
      animationType="fade"
      onRequestClose={onRequestClose}
      onShow={onShow}
      transparent
      visible={visible}
    >
      <View
        accessibilityLabel={accessibilityLabel}
        accessibilityViewIsModal
        style={styles.root}
        {...({ "aria-modal": true } as object)}
      >
        <Pressable
          accessibilityLabel={dismissAccessibilityLabel}
          accessibilityRole="button"
          onPress={onRequestClose}
          style={styles.backdrop}
        />
        <View style={styles.surface}>{children}</View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(18, 16, 14, 0.42)"
  },
  root: {
    flex: 1,
    justifyContent: "center",
    minHeight: 0,
    padding: 12
  },
  surface: {
    backgroundColor: colors.paper,
    borderColor: colors.line,
    borderRadius: 12,
    borderWidth: 1,
    flex: 1,
    maxHeight: "100%",
    minHeight: 0,
    overflow: "hidden",
    zIndex: 2
  }
});
