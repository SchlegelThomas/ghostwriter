import type { ReactElement } from "react";
import {
  BookOpen,
  FileText,
  FolderSimple,
  House,
  IdentificationCard,
  type Icon
} from "phosphor-react-native";
import { ghostwriterTheme } from "./theme.js";

const { colors } = ghostwriterTheme;

export type ManuscriptKindIconProps = Readonly<{
  kindLabel: string;
  size?: number;
  color?: string;
}>;

function iconForKindLabel(kindLabel: string): Icon {
  switch (kindLabel) {
    case "Project":
      return House;
    case "Book":
      return BookOpen;
    case "Part":
    case "Chapter":
    case "Scene folder":
    case "Project folder":
      return FolderSimple;
    case "Scene":
      return FileText;
    case "Story knowledge":
      return IdentificationCard;
    default:
      return FileText;
  }
}

export function ManuscriptKindIcon({
  kindLabel,
  size = 14,
  color = colors.muted
}: ManuscriptKindIconProps): ReactElement {
  const IconComponent = iconForKindLabel(kindLabel);
  return <IconComponent color={color} size={size} weight="thin" />;
}
