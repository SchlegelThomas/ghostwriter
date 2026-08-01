import { useCallback, useMemo, type ReactNode } from "react";
import {
  Linking,
  Platform,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle
} from "react-native";
import {
  parseAgentChatMarkdown,
  type AgentChatBlock,
  type AgentChatSpan
} from "./agent-chat-markdown.js";
import { ghostwriterTheme } from "./theme.js";

const { colors, fonts } = ghostwriterTheme;

const codeFontFamily =
  Platform.OS === "web"
    ? "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    : "Courier";

export type AgentChatMarkdownTone = "assistant" | "user" | "system";

export type AgentChatMarkdownProps = Readonly<{
  text: string;
  tone?: AgentChatMarkdownTone;
  /** Rendered inside the last block — used to keep the streaming caret on the prose. */
  trailing?: ReactNode;
  /** Overrides the default http(s) open. Unsafe targets never reach here. */
  onOpenLink?(href: string): void;
}>;

/**
 * Draws an agent reply as calm, readable prose.
 *
 * Everything is React Native `Text` — no HTML, no `dangerouslySetInnerHTML` —
 * so a reply can only ever become styled text, a list, or a link the writer
 * chooses to open.
 */
export function AgentChatMarkdown({
  text,
  tone = "assistant",
  trailing,
  onOpenLink
}: AgentChatMarkdownProps) {
  const blocks = useMemo(() => parseAgentChatMarkdown(text), [text]);
  const openLink = useCallback(
    (href: string) => {
      if (onOpenLink !== undefined) {
        onOpenLink(href);
        return;
      }
      void Linking.openURL(href).catch(() => undefined);
    },
    [onOpenLink]
  );

  const bodyStyle = toneStyles[tone];

  if (blocks.length === 0) {
    if (trailing === undefined) return null;
    return <Text style={bodyStyle}>{trailing}</Text>;
  }

  return (
    <View style={styles.root}>
      {blocks.map((block, index) => (
        <BlockView
          block={block}
          bodyStyle={bodyStyle}
          key={index}
          onOpenLink={openLink}
          trailing={index === blocks.length - 1 ? trailing : undefined}
        />
      ))}
    </View>
  );
}

function BlockView({
  block,
  bodyStyle,
  trailing,
  onOpenLink
}: Readonly<{
  block: AgentChatBlock;
  bodyStyle: StyleProp<TextStyle>;
  trailing: ReactNode;
  onOpenLink(href: string): void;
}>) {
  if (block.kind === "rule") {
    return <View style={styles.rule} />;
  }

  if (block.kind === "code") {
    return (
      <View style={styles.codeBlock}>
        {block.language === undefined ? null : (
          <Text style={styles.codeLanguage}>{block.language}</Text>
        )}
        <Text selectable style={styles.codeText}>
          {block.text}
          {trailing}
        </Text>
      </View>
    );
  }

  if (block.kind === "heading") {
    return (
      <Text
        accessibilityRole="header"
        style={[
          styles.heading,
          block.level === 1 && styles.headingOne,
          block.level === 2 && styles.headingTwo,
          block.level === 3 && styles.headingThree
        ]}
      >
        {renderSpans(block.spans, onOpenLink)}
        {trailing}
      </Text>
    );
  }

  if (block.kind === "quote") {
    return (
      <View style={styles.quote}>
        <Text style={styles.quoteText}>
          {renderSpans(block.spans, onOpenLink)}
          {trailing}
        </Text>
      </View>
    );
  }

  if (block.kind === "list") {
    return (
      <View style={styles.list}>
        {block.items.map((item, index) => (
          <View
            key={index}
            style={[
              styles.listItem,
              item.depth > 0 && { marginLeft: item.depth * 12 }
            ]}
          >
            <Text style={[bodyStyle, styles.listMarker]}>{item.marker}</Text>
            <Text style={[bodyStyle, styles.listContent]}>
              {renderSpans(item.spans, onOpenLink)}
              {index === block.items.length - 1 ? trailing : null}
            </Text>
          </View>
        ))}
      </View>
    );
  }

  return (
    <Text style={bodyStyle}>
      {renderSpans(block.spans, onOpenLink)}
      {trailing}
    </Text>
  );
}

function renderSpans(
  spans: readonly AgentChatSpan[],
  onOpenLink: (href: string) => void
): ReactNode {
  return spans.map((span, index) => {
    const spanStyle = [
      span.strong === true && styles.strong,
      span.emphasis === true && styles.emphasis,
      span.code === true && styles.inlineCode
    ];
    const href = span.href;
    if (href !== undefined) {
      return (
        <Text
          accessibilityRole="link"
          key={index}
          onPress={() => onOpenLink(href)}
          style={[spanStyle, styles.link]}
        >
          {span.text}
        </Text>
      );
    }
    return (
      <Text key={index} style={spanStyle}>
        {span.text}
      </Text>
    );
  });
}

const styles = StyleSheet.create({
  root: {
    gap: 9
  },
  body: {
    color: colors.ink,
    fontFamily: fonts.ui,
    fontSize: 13,
    lineHeight: 20
  },
  bodyUser: {
    color: colors.ink,
    fontFamily: fonts.ui,
    fontSize: 13,
    lineHeight: 20
  },
  bodySystem: {
    color: colors.amber,
    fontFamily: fonts.ui,
    fontSize: 12,
    lineHeight: 18
  },
  heading: {
    color: colors.ink
  },
  headingOne: {
    fontFamily: fonts.story,
    fontSize: 19,
    lineHeight: 25
  },
  headingTwo: {
    fontFamily: fonts.story,
    fontSize: 16,
    lineHeight: 22
  },
  headingThree: {
    color: colors.kicker,
    fontFamily: fonts.uiSemibold,
    fontSize: 10,
    letterSpacing: 0.7,
    lineHeight: 15,
    textTransform: "uppercase"
  },
  quote: {
    borderLeftColor: colors.brandRuleSoft,
    borderLeftWidth: 2,
    paddingLeft: 11
  },
  quoteText: {
    color: colors.ink,
    fontFamily: fonts.storyItalic,
    fontSize: 15,
    lineHeight: 22
  },
  list: {
    gap: 4
  },
  listItem: {
    flexDirection: "row",
    gap: 7
  },
  listMarker: {
    color: colors.muted,
    minWidth: 12,
    textAlign: "right"
  },
  listContent: {
    flex: 1,
    minWidth: 0
  },
  strong: {
    fontFamily: fonts.uiSemibold
  },
  emphasis: {
    fontStyle: "italic"
  },
  inlineCode: {
    backgroundColor: colors.wash,
    color: colors.kicker,
    fontFamily: codeFontFamily,
    fontSize: 12
  },
  link: {
    color: colors.accent,
    textDecorationLine: "underline"
  },
  codeBlock: {
    backgroundColor: colors.wash,
    borderColor: colors.line,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  codeLanguage: {
    color: colors.muted,
    fontFamily: fonts.uiMedium,
    fontSize: 9,
    letterSpacing: 0.6,
    textTransform: "uppercase"
  },
  codeText: {
    color: colors.ink,
    fontFamily: codeFontFamily,
    fontSize: 12,
    lineHeight: 18
  },
  rule: {
    backgroundColor: colors.line,
    height: StyleSheet.hairlineWidth,
    marginVertical: 2
  }
});

const toneStyles: Readonly<Record<AgentChatMarkdownTone, StyleProp<TextStyle>>> =
  {
    assistant: styles.body,
    user: styles.bodyUser,
    system: styles.bodySystem
  };
