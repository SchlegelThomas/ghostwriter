import type { ComponentType } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type ViewProps
} from "react-native";
import { ghostwriterTheme } from "./theme.js";

const { colors, fonts } = ghostwriterTheme;

export type AcknowledgementToastTone = "success" | "warning" | "error";

export type AcknowledgementToast = Readonly<{
  id: string;
  title: string;
  detail: string;
  tone: AcknowledgementToastTone;
  createdAt: number;
  expiresAt?: number;
  pausedRemainingMs?: number;
  sticky?: boolean;
  actionLabel?: string;
  dismissible?: boolean;
}>;

export type AcknowledgementToastHostProps = Readonly<{
  toasts: readonly AcknowledgementToast[];
  onAction(id: string): void;
  onDismiss(id: string): void;
  onPause(id: string): void;
  onResume(id: string): void;
}>;

type WebToastProps = ViewProps &
  Readonly<{
    role: "status" | "alert";
    "aria-live": "polite" | "assertive";
    onMouseEnter(): void;
    onMouseLeave(): void;
  }>;

const WebToast = View as unknown as ComponentType<WebToastProps>;

function ToastButton({
  label,
  onPress,
  primary = false
}: Readonly<{
  label: string;
  onPress(): void;
  primary?: boolean;
}>) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        primary && styles.buttonPrimary,
        pressed && styles.pressed
      ]}
    >
      <Text
        style={[styles.buttonText, primary && styles.buttonTextPrimary]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function AcknowledgementToastHost({
  toasts,
  onAction,
  onDismiss,
  onPause,
  onResume
}: AcknowledgementToastHostProps) {
  const narrow = useWindowDimensions().width < 620;
  return (
    <View
      accessibilityLabel="Acknowledgements"
      pointerEvents="box-none"
      style={[styles.host, narrow && styles.hostNarrow]}
    >
      {toasts.map((toast) => {
        const alert = toast.tone !== "success" || toast.sticky === true;
        return (
          <WebToast
            aria-live={alert ? "assertive" : "polite"}
            key={toast.id}
            onMouseEnter={() => onPause(toast.id)}
            onMouseLeave={() => onResume(toast.id)}
            role={alert ? "alert" : "status"}
            style={[
              styles.toast,
              toast.tone === "success" && styles.toastSuccess,
              toast.tone === "warning" && styles.toastWarning,
              toast.tone === "error" && styles.toastError
            ]}
          >
            <View style={styles.copy}>
              <Text style={styles.title}>{toast.title}</Text>
              <Text style={styles.detail}>{toast.detail}</Text>
            </View>
            {toast.actionLabel === undefined &&
            toast.dismissible !== true ? null : (
              <View style={styles.actions}>
                {toast.actionLabel === undefined ? null : (
                  <ToastButton
                    label={toast.actionLabel}
                    onPress={() => onAction(toast.id)}
                    primary
                  />
                )}
                {toast.dismissible === true ? (
                  <ToastButton
                    label="Dismiss"
                    onPress={() => onDismiss(toast.id)}
                  />
                ) : null}
              </View>
            )}
          </WebToast>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    gap: 8,
    maxWidth: 390,
    pointerEvents: "box-none",
    position: "absolute",
    right: 14,
    top: 72,
    width: 390,
    zIndex: 1000
  },
  hostNarrow: {
    left: 10,
    right: 10,
    top: 118,
    width: "auto"
  },
  toast: {
    alignItems: "flex-start",
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderLeftWidth: 4,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 9,
    justifyContent: "space-between",
    padding: 11,
    shadowColor: colors.brandDark,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.14,
    shadowRadius: 8
  },
  toastSuccess: {
    backgroundColor: "#f8fcf9",
    borderLeftColor: colors.green
  },
  toastWarning: {
    backgroundColor: colors.amberSoft,
    borderLeftColor: colors.amber
  },
  toastError: {
    backgroundColor: colors.redSoft,
    borderLeftColor: colors.red
  },
  copy: {
    flex: 1,
    minWidth: 180
  },
  title: {
    color: colors.ink,
    fontFamily: fonts.uiSemibold,
    fontSize: 10
  },
  detail: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 8,
    lineHeight: 13,
    marginTop: 3
  },
  actions: {
    alignItems: "center",
    flexDirection: "row",
    gap: 5
  },
  button: {
    alignItems: "center",
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 6,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 31,
    paddingHorizontal: 8,
    paddingVertical: 5
  },
  buttonPrimary: {
    backgroundColor: colors.brandDark,
    borderColor: colors.brandDark
  },
  buttonText: {
    color: colors.ink,
    fontFamily: fonts.uiSemibold,
    fontSize: 8
  },
  buttonTextPrimary: {
    color: "#ffffff"
  },
  pressed: {
    opacity: 0.72
  }
});
