import { useEffect, useMemo, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { ghostwriterTheme } from "./theme.js";
import {
  filterWorkspaceJumpTargets,
  unifiedSearchKinds,
  type WorkspaceJumpTarget
} from "./workspace-quick-nav.js";

const { colors, fonts } = ghostwriterTheme;

export type WorkspaceTopSearchProps = Readonly<{
  targets: readonly WorkspaceJumpTarget[];
  busy?: boolean;
  /** Mirrors into the manuscript explorer when non-empty. */
  onExplorerQueryChange?(query: string): void;
  onPick(target: WorkspaceJumpTarget): void;
}>;

function sectionLabel(kind: WorkspaceJumpTarget["kind"]): string {
  switch (kind) {
    case "capability":
      return "Tools";
    case "mode":
    case "panel":
      return "Actions";
    default:
      return "Manuscript";
  }
}

export function WorkspaceTopSearch({
  targets,
  busy = false,
  onExplorerQueryChange,
  onPick
}: WorkspaceTopSearchProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<TextInput>(null);
  const rootRef = useRef<View>(null);

  const results = useMemo(
    () =>
      filterWorkspaceJumpTargets(targets, query, {
        kinds: unifiedSearchKinds(),
        limit: 28
      }),
    [query, targets]
  );

  useEffect(() => {
    onExplorerQueryChange?.(query);
  }, [onExplorerQueryChange, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    if (!open || typeof document === "undefined") return;
    const onPointerDown = (event: MouseEvent): void => {
      const node = rootRef.current as unknown as HTMLElement | null;
      if (node === null) return;
      if (event.target instanceof Node && node.contains(event.target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  function pick(target: WorkspaceJumpTarget): void {
    onPick(target);
    setQuery("");
    setOpen(false);
    onExplorerQueryChange?.("");
  }

  return (
    <View
      accessibilityLabel="Workspace quick search"
      ref={rootRef}
      style={styles.root}
    >
      <TextInput
        accessibilityLabel="Search manuscript, jump targets, and MCP tools"
        editable={!busy}
        onChangeText={(next) => {
          setQuery(next);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyPress={(event) => {
          const key = event.nativeEvent.key;
          if (key === "Escape") {
            setOpen(false);
            setQuery("");
            onExplorerQueryChange?.("");
            return;
          }
          if (key === "ArrowDown") {
            setActiveIndex((current) =>
              results.length === 0
                ? 0
                : Math.min(results.length - 1, current + 1)
            );
            return;
          }
          if (key === "ArrowUp") {
            setActiveIndex((current) => Math.max(0, current - 1));
            return;
          }
          if (key === "Enter") {
            const target = results[activeIndex] ?? results[0];
            if (target !== undefined) pick(target);
          }
        }}
        placeholder="Search project, jump, or MCP tools…"
        placeholderTextColor={colors.muted}
        ref={inputRef}
        style={styles.input}
        value={query}
      />
      {open ? (
        <View accessibilityRole="list" style={styles.dropdown}>
          {results.length === 0 ? (
            <Text style={styles.empty}>
              {query.trim().length === 0
                ? "Type to jump to a scene, run a tool, or open a surface."
                : `No matches for “${query.trim()}”.`}
            </Text>
          ) : (
            <ScrollView
              keyboardShouldPersistTaps="handled"
              style={styles.list}
            >
              {results.map((target, index) => {
                const showSection =
                  index === 0 ||
                  sectionLabel(target.kind) !==
                    sectionLabel(results[index - 1]!.kind);
                return (
                  <View key={target.id}>
                    {showSection ? (
                      <Text style={styles.section}>
                        {sectionLabel(target.kind)}
                      </Text>
                    ) : null}
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => pick(target)}
                      style={({ pressed }) => [
                        styles.row,
                        index === activeIndex && styles.rowActive,
                        pressed && styles.pressed
                      ]}
                    >
                      <Text numberOfLines={1} style={styles.rowTitle}>
                        {target.title}
                      </Text>
                      <Text numberOfLines={1} style={styles.rowSubtitle}>
                        {target.subtitle}
                      </Text>
                    </Pressable>
                  </View>
                );
              })}
            </ScrollView>
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    maxWidth: "100%",
    minWidth: 0,
    position: "relative",
    width: "100%",
    zIndex: 20
  },
  input: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 8,
    borderWidth: 1,
    color: colors.ink,
    fontFamily: fonts.ui,
    fontSize: 13,
    minHeight: 34,
    paddingHorizontal: 12,
    paddingVertical: 6,
    width: "100%"
  },
  dropdown: {
    backgroundColor: colors.paper,
    borderColor: colors.line,
    borderRadius: 10,
    borderWidth: 1,
    left: 0,
    maxHeight: 360,
    overflow: "hidden",
    position: "absolute",
    right: 0,
    shadowColor: "#1d150f",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 18,
    top: 40,
    zIndex: 30
  },
  list: {
    maxHeight: 360
  },
  section: {
    color: colors.muted,
    fontFamily: fonts.uiSemibold,
    fontSize: 10,
    letterSpacing: 0.4,
    paddingHorizontal: 12,
    paddingTop: 10,
    textTransform: "uppercase"
  },
  row: {
    gap: 2,
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  rowActive: {
    backgroundColor: colors.accentSoft
  },
  rowTitle: {
    color: colors.ink,
    fontFamily: fonts.uiMedium,
    fontSize: 13
  },
  rowSubtitle: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 11
  },
  empty: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 12,
    lineHeight: 18,
    padding: 14
  },
  pressed: {
    opacity: 0.9
  }
});
