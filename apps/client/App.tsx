import { StyleSheet, Text, View } from "react-native";
import { addChapter, createManuscript } from "@ghostwriter/core";

const manuscript = addChapter(
  createManuscript("welcome", "The First Page"),
  "chapter-one",
  "A beginning"
);

export default function App() {
  return (
    <View style={styles.page}>
      <Text style={styles.eyebrow}>GHOSTWRITER</Text>
      <Text style={styles.title}>{manuscript.title}</Text>
      <Text style={styles.copy}>
        Your universal writing workspace is ready. {manuscript.chapters.length} chapter is
        available in the shared core.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    alignItems: "flex-start",
    backgroundColor: "#fffdf8",
    flex: 1,
    justifyContent: "center",
    padding: 32
  },
  eyebrow: {
    color: "#786c5d",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 2
  },
  title: {
    color: "#251e18",
    fontSize: 40,
    fontWeight: "700",
    marginTop: 12
  },
  copy: {
    color: "#554a40",
    fontSize: 18,
    lineHeight: 28,
    marginTop: 16,
    maxWidth: 520
  }
});
