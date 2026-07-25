import type { ReactElement } from "react";
import {
  BookOpen,
  ClockCounterClockwise,
  Columns,
  Files,
  GearSix,
  Graph,
  List,
  MagnifyingGlass,
  PencilSimple,
  Sparkle,
  type Icon
} from "phosphor-react-native";
import { Circle, Path, Svg } from "react-native-svg";
import { ghostwriterTheme } from "./theme.js";

const { colors } = ghostwriterTheme;

export type RailIconTone = "default" | "selected";

export type RailIconProps = Readonly<{
  size?: number;
  tone?: RailIconTone;
}>;

function railIconColor(tone: RailIconTone): string {
  return tone === "selected" ? "#ffffff" : colors.railText;
}

function PhosphorRailIcon({
  Icon,
  size = 15,
  tone = "default"
}: RailIconProps & Readonly<{ Icon: Icon }>): ReactElement {
  return (
    <Icon color={railIconColor(tone)} size={size} weight="thin" />
  );
}

/** Custom: soft cloud + sparkle — Plans (brand-native). */
export function DreamsRailIcon({
  size = 15,
  tone = "default"
}: RailIconProps): ReactElement {
  const stroke = railIconColor(tone);
  return (
    <Svg
      accessibilityElementsHidden
      fill="none"
      height={size}
      importantForAccessibility="no-hide-descendants"
      viewBox="0 0 24 24"
      width={size}
    >
      <Path
        d="M7.2 16.4c-1.9 0-3.4-1.4-3.4-3.2 0-1.5 1-2.8 2.4-3.2.3-2.2 2.2-3.9 4.5-3.9 1.7 0 3.2.9 4 2.3.5-.2 1-.3 1.6-.3 2.1 0 3.8 1.6 3.8 3.6 0 .3 0 .6-.1.9 1.2.4 2 1.5 2 2.8 0 1.6-1.4 2.9-3.1 2.9H7.2z"
        stroke={stroke}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1}
      />
      <Path
        d="M17.8 5.2l.45 1.35L19.6 7l-1.35.45L17.8 8.8l-.45-1.35L16 7l1.35-.45.45-1.35z"
        fill={stroke}
      />
      <Circle cx={15.2} cy={4.2} fill={stroke} r={0.55} />
    </Svg>
  );
}

/** Custom: filled cloud with + — Idea Capture (pairs with Plans cloud). */
export function CaptureRailIcon({
  size = 15,
  tone = "default"
}: RailIconProps): ReactElement {
  const fill = railIconColor(tone);
  return (
    <Svg
      accessibilityElementsHidden
      fill="none"
      height={size}
      importantForAccessibility="no-hide-descendants"
      viewBox="0 0 24 24"
      width={size}
    >
      <Path
        d="M5.6 15.8c-1.6 0-2.9-1.2-2.9-2.7 0-1.3.9-2.4 2.1-2.7.3-1.9 1.9-3.3 3.9-3.3 1.4 0 2.7.8 3.4 2 .4-.2.8-.3 1.3-.3 1.8 0 3.2 1.3 3.2 3 0 .2 0 .5-.1.7 1 .3 1.7 1.3 1.7 2.4 0 1.4-1.2 2.5-2.6 2.5H5.6z"
        fill={fill}
      />
      <Path
        d="M19.2 14.2v5.2"
        stroke={fill}
        strokeLinecap="round"
        strokeWidth={1.35}
      />
      <Path
        d="M16.6 16.8h5.2"
        stroke={fill}
        strokeLinecap="round"
        strokeWidth={1.35}
      />
    </Svg>
  );
}

/** Custom: soft head-and-shoulders silhouette — Characters. */
export function CharactersRailIcon({
  size = 15,
  tone = "default"
}: RailIconProps): ReactElement {
  const stroke = railIconColor(tone);
  return (
    <Svg
      accessibilityElementsHidden
      fill="none"
      height={size}
      importantForAccessibility="no-hide-descendants"
      viewBox="0 0 24 24"
      width={size}
    >
      <Path
        d="M12 12.2c1.9 0 3.4-1.6 3.4-3.5S13.9 5.2 12 5.2 8.6 6.8 8.6 8.7s1.5 3.5 3.4 3.5z"
        stroke={stroke}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1}
      />
      <Path
        d="M6.2 19.2c.6-2.6 2.8-4.2 5.8-4.2s5.2 1.6 5.8 4.2"
        stroke={stroke}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1}
      />
    </Svg>
  );
}

export function DraftRailIcon(props: RailIconProps): ReactElement {
  return <PhosphorRailIcon Icon={PencilSimple} {...props} />;
}

export function CanvasRailIcon(props: RailIconProps): ReactElement {
  return <PhosphorRailIcon Icon={Graph} {...props} />;
}

export function SplitRailIcon(props: RailIconProps): ReactElement {
  return <PhosphorRailIcon Icon={Columns} {...props} />;
}

export function ReaderRailIcon(props: RailIconProps): ReactElement {
  return <PhosphorRailIcon Icon={BookOpen} {...props} />;
}

export function HistoryRailIcon(props: RailIconProps): ReactElement {
  return <PhosphorRailIcon Icon={ClockCounterClockwise} {...props} />;
}

export function ChatRailIcon(props: RailIconProps): ReactElement {
  return <PhosphorRailIcon Icon={Sparkle} {...props} />;
}

export function JumpRailIcon(props: RailIconProps): ReactElement {
  return <PhosphorRailIcon Icon={MagnifyingGlass} {...props} />;
}

export function StructureRailIcon(props: RailIconProps): ReactElement {
  return <PhosphorRailIcon Icon={List} {...props} />;
}

export function ExplorerRailIcon(props: RailIconProps): ReactElement {
  return <PhosphorRailIcon Icon={Files} {...props} />;
}

export function SettingsRailIcon(props: RailIconProps): ReactElement {
  return <PhosphorRailIcon Icon={GearSix} {...props} />;
}
