import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View
} from "react-native";
import brandLockup from "./Ghostwriter.png";
import { ghostwriterTheme } from "./theme.js";

export type AccountGateScreenProps = Readonly<{
  loading?: boolean;
  signingIn?: boolean;
  error?: string;
  onSignIn(): void;
}>;

const { colors, fonts } = ghostwriterTheme;

export function AccountGateScreen({
  loading = false,
  signingIn = false,
  error,
  onSignIn
}: AccountGateScreenProps) {
  const busy = loading || signingIn;

  return (
    <View style={styles.screen}>
      <View style={styles.card}>
        <Image
          accessibilityLabel="ghost-writer — Bring your ideas to life"
          resizeMode="contain"
          source={brandLockup}
          style={styles.logo}
        />
        <Text style={styles.eyebrow}>Bring your ideas to life</Text>
        {error === undefined ? null : (
          <View accessibilityRole="alert" style={styles.error}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={onSignIn}
          style={({ pressed }) => [
            styles.button,
            pressed && styles.buttonPressed,
            busy && styles.buttonDisabled
          ]}
        >
          {busy ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.buttonText}>Continue with Google</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    alignItems: "center",
    backgroundColor: colors.canvas,
    flex: 1,
    justifyContent: "center",
    padding: 20
  },
  card: {
    alignItems: "stretch",
    backgroundColor: colors.paper,
    borderColor: colors.documentLine,
    borderRadius: 14,
    borderWidth: 1,
    maxWidth: 560,
    paddingHorizontal: 36,
    paddingVertical: 40,
    shadowColor: colors.brandDark,
    shadowOffset: { height: 12, width: 0 },
    shadowOpacity: 0.08,
    shadowRadius: 28,
    width: "100%"
  },
  logo: {
    alignSelf: "center",
    height: 260,
    marginBottom: 4,
    width: 340
  },
  eyebrow: {
    color: colors.kicker,
    fontFamily: fonts.brand,
    fontSize: 28,
    letterSpacing: 0.2,
    marginTop: -40,
    textAlign: "center"
  },
  error: {
    backgroundColor: colors.redSoft,
    borderRadius: 8,
    marginTop: 16,
    padding: 10
  },
  errorText: {
    color: colors.red,
    fontFamily: fonts.uiMedium,
    fontSize: 11,
    lineHeight: 17
  },
  button: {
    alignItems: "center",
    backgroundColor: colors.brandDark,
    borderRadius: 8,
    justifyContent: "center",
    marginTop: 22,
    minHeight: 48,
    paddingHorizontal: 18
  },
  buttonPressed: {
    opacity: 0.82
  },
  buttonDisabled: {
    opacity: 0.58
  },
  buttonText: {
    color: "#ffffff",
    fontFamily: fonts.uiSemibold,
    fontSize: 13
  }
});
