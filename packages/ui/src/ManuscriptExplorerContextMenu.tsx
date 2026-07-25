import { useEffect, useRef } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { ghostwriterTheme } from "./theme.js";
import {
  manuscriptExplorerActionLabel,
  type ManuscriptExplorerActionFlags,
  type ManuscriptExplorerActionId
} from "./manuscript-explorer-actions.js";

const { colors, fonts } = ghostwriterTheme;

export type ManuscriptExplorerContextMenuProps = Readonly<{
  x: number;
  y: number;
  actions: readonly ManuscriptExplorerActionId[];
  flags?: Pick<ManuscriptExplorerActionFlags, "addLabel">;
  onAction(action: ManuscriptExplorerActionId): void;
  onDismiss(): void;
}>;

export function ManuscriptExplorerContextMenu({
  x,
  y,
  actions,
  flags,
  onAction,
  onDismiss
}: ManuscriptExplorerContextMenuProps) {
  const rootRef = useRef<View>(null);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const onPointerDown = (event: MouseEvent): void => {
      const node = rootRef.current as unknown as HTMLElement | null;
      if (node === null) return;
      if (event.target instanceof Node && node.contains(event.target)) return;
      onDismiss();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        onDismiss();
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onDismiss]);

  return (
    <View
      accessibilityLabel="Manuscript explorer menu"
      accessibilityRole="menu"
      pointerEvents="box-none"
      ref={rootRef}
      style={[styles.menu, { left: x, top: y }]}
    >
      {actions.map((action) => (
        <Pressable
          accessibilityRole="menuitem"
          key={action}
          onPress={() => {
            onAction(action);
            onDismiss();
          }}
          style={({ pressed }) => [
            styles.item,
            pressed && styles.itemPressed,
            (action === "archive" || action === "restore") && styles.itemDivider
          ]}
        >
          <Text
            style={[
              styles.itemText,
              action === "archive" && styles.itemTextDanger
            ]}
          >
            {manuscriptExplorerActionLabel(action, flags)}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  menu: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 6,
    borderWidth: 1,
    minWidth: 168,
    paddingVertical: 4,
    position: "fixed" as unknown as "absolute",
    shadowColor: "#1c1914",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 14,
    zIndex: 80
  },
  item: {
    paddingHorizontal: 12,
    paddingVertical: 7
  },
  itemPressed: {
    backgroundColor: colors.wash
  },
  itemDivider: {
    borderTopColor: colors.line,
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 2,
    paddingTop: 9
  },
  itemText: {
    color: colors.ink,
    fontFamily: fonts.ui,
    fontSize: 12
  },
  itemTextDanger: {
    color: colors.red
  }
});
