import { CormorantGaramond_500Medium } from "@expo-google-fonts/cormorant-garamond/500Medium/index.js";
import { CormorantGaramond_500Medium_Italic } from "@expo-google-fonts/cormorant-garamond/500Medium_Italic/index.js";
import { Jost_400Regular } from "@expo-google-fonts/jost/400Regular/index.js";
import { Jost_500Medium } from "@expo-google-fonts/jost/500Medium/index.js";
import { Jost_600SemiBold } from "@expo-google-fonts/jost/600SemiBold/index.js";
import { Parisienne_400Regular } from "@expo-google-fonts/parisienne/400Regular/index.js";
import { BELLWETHER_FIXTURE_NAVIGATOR } from "@ghostwriter/core";
import {
  ghostwriterTheme,
  ProjectNavigatorScreen
} from "@ghostwriter/ui";
import { useFonts } from "expo-font";
import { ActivityIndicator, View } from "react-native";

export default function App() {
  const [fontsLoaded, fontError] = useFonts({
    [ghostwriterTheme.fonts.brand]: Parisienne_400Regular,
    [ghostwriterTheme.fonts.story]: CormorantGaramond_500Medium,
    [ghostwriterTheme.fonts.storyItalic]: CormorantGaramond_500Medium_Italic,
    [ghostwriterTheme.fonts.ui]: Jost_400Regular,
    [ghostwriterTheme.fonts.uiMedium]: Jost_500Medium,
    [ghostwriterTheme.fonts.uiSemibold]: Jost_600SemiBold
  });

  if (!fontsLoaded && fontError === null) {
    return (
      <View
        accessibilityLabel="Loading Ghostwriter"
        style={{
          alignItems: "center",
          backgroundColor: ghostwriterTheme.colors.paper,
          flex: 1,
          justifyContent: "center"
        }}
      >
        <ActivityIndicator color={ghostwriterTheme.colors.kicker} />
      </View>
    );
  }

  return <ProjectNavigatorScreen project={BELLWETHER_FIXTURE_NAVIGATOR} />;
}
