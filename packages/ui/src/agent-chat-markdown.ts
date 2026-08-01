/**
 * A deliberately small markdown subset for agent replies in the writing dock.
 *
 * Replies are prose first, so this parses only what a writing partner actually
 * uses — headings, paragraphs, lists, quotes, emphasis, inline code, fenced
 * code, and links — into plain data the React Native renderer can draw. There
 * is no HTML anywhere in the pipeline, so nothing a model returns can become
 * markup.
 *
 * Single newlines inside a paragraph are preserved rather than collapsed:
 * writers get verse, dialogue, and beat lists back the way the agent wrote them.
 */

/** One run of text with the marks that apply to it. */
export type AgentChatSpan = Readonly<{
  text: string;
  strong?: boolean;
  emphasis?: boolean;
  code?: boolean;
  /** Present only for links that passed the http/https safety check. */
  href?: string;
}>;

export type AgentChatListItem = Readonly<{
  /** Visual nesting level, capped so deep outlines stay readable in the dock. */
  depth: number;
  /** Rendered bullet or number, resolved at parse time. */
  marker: string;
  spans: readonly AgentChatSpan[];
}>;

export type AgentChatBlock =
  | Readonly<{ kind: "heading"; level: 1 | 2 | 3; spans: readonly AgentChatSpan[] }>
  | Readonly<{ kind: "paragraph"; spans: readonly AgentChatSpan[] }>
  | Readonly<{ kind: "quote"; spans: readonly AgentChatSpan[] }>
  | Readonly<{ kind: "list"; ordered: boolean; items: readonly AgentChatListItem[] }>
  | Readonly<{ kind: "code"; text: string; language?: string }>
  | Readonly<{ kind: "rule" }>;

type Marks = Readonly<{
  strong?: boolean;
  emphasis?: boolean;
  href?: string;
}>;

const MAX_LIST_DEPTH = 2;
const HEADING_LINE = /^ {0,3}(#{1,6})\s+(.*)$/;
const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})\s*([\w+#.-]*)\s*$/;
const RULE_LINE = /^ {0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/;
const QUOTE_LINE = /^ {0,3}> ?(.*)$/;
const BULLET_LINE = /^(\s*)[-*+]\s+(.*)$/;
const ORDERED_LINE = /^(\s*)(\d{1,9})[.)]\s+(.*)$/;
const UNSAFE_HREF_CHARS = new Set(["<", ">", '"', "'", "`", "\\"]);
const ESCAPABLE = new Set([
  "\\",
  "`",
  "*",
  "_",
  "[",
  "]",
  "(",
  ")",
  "#",
  ">",
  "-",
  "+",
  ".",
  "!"
]);

/** Only absolute http(s) targets open; everything else degrades to plain text. */
export function isSafeChatLinkHref(href: string): boolean {
  const value = stripAngleBrackets(href.trim());
  if (value.length === 0 || value.length > 2048) return false;
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0x20 || code === 0x7f) return false;
    if (UNSAFE_HREF_CHARS.has(char)) return false;
  }
  return /^https?:\/\/[^/?#]+/i.test(value);
}

/** Parses a reply body into renderable blocks. Never throws on odd input. */
export function parseAgentChatMarkdown(source: string): readonly AgentChatBlock[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: AgentChatBlock[] = [];
  let paragraph: string[] = [];
  let quote: string[] = [];

  function flushParagraph(): void {
    const text = paragraph.join("\n").trim();
    paragraph = [];
    if (text.length === 0) return;
    blocks.push({ kind: "paragraph", spans: parseAgentChatInline(text) });
  }

  function flushQuote(): void {
    const text = quote.join("\n").trim();
    quote = [];
    if (text.length === 0) return;
    blocks.push({ kind: "quote", spans: parseAgentChatInline(text) });
  }

  function flush(): void {
    flushParagraph();
    flushQuote();
  }

  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";

    const fence = FENCE_LINE.exec(line);
    if (fence !== null) {
      flush();
      const marker = fence[1] ?? "```";
      const language = (fence[2] ?? "").trim();
      const body: string[] = [];
      index += 1;
      while (index < lines.length) {
        const next = lines[index] ?? "";
        if (isClosingFence(next, marker)) {
          index += 1;
          break;
        }
        body.push(next);
        index += 1;
      }
      blocks.push({
        kind: "code",
        text: trimBlankEdges(body).join("\n"),
        ...(language.length > 0 ? { language } : {})
      });
      continue;
    }

    if (line.trim().length === 0) {
      flush();
      index += 1;
      continue;
    }

    if (RULE_LINE.test(line)) {
      flush();
      blocks.push({ kind: "rule" });
      index += 1;
      continue;
    }

    const heading = HEADING_LINE.exec(line);
    if (heading !== null) {
      flush();
      const hashes = (heading[1] ?? "#").length;
      const level = (hashes > 3 ? 3 : hashes) as 1 | 2 | 3;
      blocks.push({
        kind: "heading",
        level,
        spans: parseAgentChatInline((heading[2] ?? "").trim())
      });
      index += 1;
      continue;
    }

    const quoted = QUOTE_LINE.exec(line);
    if (quoted !== null) {
      flushParagraph();
      quote.push(quoted[1] ?? "");
      index += 1;
      continue;
    }
    flushQuote();

    if (BULLET_LINE.test(line) || ORDERED_LINE.test(line)) {
      flush();
      const list = readList(lines, index);
      blocks.push(list.block);
      index = list.next;
      continue;
    }

    paragraph.push(line);
    index += 1;
  }

  flush();
  return blocks;
}

/** Parses one line's worth of inline markdown. Exported for focused tests. */
export function parseAgentChatInline(source: string): readonly AgentChatSpan[] {
  const spans: AgentChatSpan[] = [];
  parseInlineInto(source, {}, spans);
  return spans;
}

function readList(
  lines: readonly string[],
  start: number
): Readonly<{ block: AgentChatBlock; next: number }> {
  const ordered = ORDERED_LINE.test(lines[start] ?? "");
  const items: AgentChatListItem[] = [];
  let index = start;
  let pending: Readonly<{ depth: number; marker: string }> | undefined;
  let text = "";

  function commit(): void {
    if (pending === undefined) return;
    items.push({
      depth: pending.depth,
      marker: pending.marker,
      spans: parseAgentChatInline(text.trim())
    });
    pending = undefined;
    text = "";
  }

  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (line.trim().length === 0) break;

    const match = ordered ? ORDERED_LINE.exec(line) : BULLET_LINE.exec(line);
    if (match !== null) {
      commit();
      pending = {
        depth: listDepth(match[1] ?? ""),
        marker: ordered ? `${match[2] ?? "1"}.` : "•"
      };
      text = (ordered ? match[3] : match[2]) ?? "";
      index += 1;
      continue;
    }

    // An indented, unmarked line continues the item above it.
    if (pending !== undefined && /^\s{2,}\S/.test(line)) {
      text = `${text}\n${line.trim()}`;
      index += 1;
      continue;
    }
    break;
  }

  commit();
  return { block: { kind: "list", ordered, items }, next: index };
}

function listDepth(indent: string): number {
  const width = indent.replace(/\t/g, "    ").length;
  return Math.min(MAX_LIST_DEPTH, Math.floor(width / 2));
}

function isClosingFence(line: string, marker: string): boolean {
  const trimmed = line.trim();
  const char = marker.charAt(0);
  if (trimmed.length < marker.length) return false;
  return trimmed.split("").every((entry) => entry === char);
}

function trimBlankEdges(lines: readonly string[]): readonly string[] {
  let first = 0;
  let last = lines.length;
  while (first < last && (lines[first] ?? "").trim().length === 0) first += 1;
  while (last > first && (lines[last - 1] ?? "").trim().length === 0) last -= 1;
  return lines.slice(first, last);
}

function parseInlineInto(
  source: string,
  marks: Marks,
  out: AgentChatSpan[]
): void {
  let buffer = "";
  let index = 0;

  const flush = (): void => {
    appendSpan(out, buffer, marks, false);
    buffer = "";
  };

  while (index < source.length) {
    const char = source.charAt(index);

    if (char === "\\") {
      const next = source.charAt(index + 1);
      if (next.length > 0 && ESCAPABLE.has(next)) {
        buffer += next;
        index += 2;
        continue;
      }
    }

    if (char === "`") {
      const fenceLength = runLength(source, index, "`");
      const closeIndex = findRun(source, index + fenceLength, "`", fenceLength);
      if (closeIndex !== -1) {
        const raw = source.slice(index + fenceLength, closeIndex);
        if (raw.trim().length > 0) {
          flush();
          appendSpan(out, trimCodeSpan(raw), marks, true);
          index = closeIndex + fenceLength;
          continue;
        }
      }
    }

    if (char === "[" && marks.href === undefined) {
      const link = matchLink(source, index);
      if (link !== undefined) {
        flush();
        parseInlineInto(
          link.label,
          isSafeChatLinkHref(link.href)
            ? { ...marks, href: stripAngleBrackets(link.href.trim()) }
            : marks,
          out
        );
        index = link.end;
        continue;
      }
    }

    if (char === "*" || char === "_") {
      const strong = matchEmphasis(source, index, char, 2);
      if (strong !== undefined) {
        flush();
        parseInlineInto(strong.inner, { ...marks, strong: true }, out);
        index = strong.end;
        continue;
      }
      const emphasis = matchEmphasis(source, index, char, 1);
      if (emphasis !== undefined) {
        flush();
        parseInlineInto(emphasis.inner, { ...marks, emphasis: true }, out);
        index = emphasis.end;
        continue;
      }
    }

    buffer += char;
    index += 1;
  }

  flush();
}

function matchEmphasis(
  source: string,
  start: number,
  char: string,
  length: number
): Readonly<{ inner: string; end: number }> | undefined {
  const delimiter = char.repeat(length);
  if (!source.startsWith(delimiter, start)) return undefined;
  if (source.charAt(start + length) === char) return undefined;
  // `snake_case` must survive untouched, so `_` only opens at a word boundary.
  if (char === "_" && isWordChar(source.charAt(start - 1))) return undefined;

  const closeIndex = source.indexOf(delimiter, start + length);
  if (closeIndex === -1) return undefined;
  if (char === "_" && isWordChar(source.charAt(closeIndex + length))) {
    return undefined;
  }

  const inner = source.slice(start + length, closeIndex);
  if (inner.length === 0) return undefined;
  if (/^\s/.test(inner) || /\s$/.test(inner)) return undefined;

  return { inner, end: closeIndex + length };
}

function matchLink(
  source: string,
  start: number
): Readonly<{ label: string; href: string; end: number }> | undefined {
  let depth = 0;
  let cursor = start;
  for (; cursor < source.length; cursor += 1) {
    const char = source.charAt(cursor);
    if (char === "\\") {
      cursor += 1;
      continue;
    }
    if (char === "[") depth += 1;
    else if (char === "]") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  if (cursor >= source.length) return undefined;
  if (source.charAt(cursor + 1) !== "(") return undefined;

  const close = source.indexOf(")", cursor + 2);
  if (close === -1) return undefined;

  const label = source.slice(start + 1, cursor);
  const target = source.slice(cursor + 2, close).trim();
  if (label.trim().length === 0 || target.length === 0) return undefined;

  return { label, href: target.split(/\s+/)[0] ?? "", end: close + 1 };
}

function appendSpan(
  out: AgentChatSpan[],
  text: string,
  marks: Marks,
  code: boolean
): void {
  if (text.length === 0) return;
  const span: AgentChatSpan = {
    text,
    ...(marks.strong === true ? { strong: true } : {}),
    ...(marks.emphasis === true ? { emphasis: true } : {}),
    ...(code ? { code: true } : {}),
    ...(marks.href === undefined ? {} : { href: marks.href })
  };
  const previous = out[out.length - 1];
  if (previous !== undefined && sameMarks(previous, span)) {
    out[out.length - 1] = { ...previous, text: `${previous.text}${text}` };
    return;
  }
  out.push(span);
}

function sameMarks(left: AgentChatSpan, right: AgentChatSpan): boolean {
  return (
    left.strong === right.strong &&
    left.emphasis === right.emphasis &&
    left.code === right.code &&
    left.href === right.href
  );
}

function runLength(source: string, start: number, char: string): number {
  let length = 0;
  while (source.charAt(start + length) === char) length += 1;
  return length;
}

function findRun(
  source: string,
  from: number,
  char: string,
  length: number
): number {
  const needle = char.repeat(length);
  let cursor = from;
  while (cursor < source.length) {
    const found = source.indexOf(needle, cursor);
    if (found === -1) return -1;
    if (runLength(source, found, char) === length) return found;
    cursor = found + runLength(source, found, char);
  }
  return -1;
}

function trimCodeSpan(raw: string): string {
  return raw.length > 1 && raw.startsWith(" ") && raw.endsWith(" ")
    ? raw.slice(1, -1)
    : raw;
}

function stripAngleBrackets(value: string): string {
  return value.startsWith("<") && value.endsWith(">")
    ? value.slice(1, -1)
    : value;
}

function isWordChar(value: string): boolean {
  return value.length > 0 && /[\p{L}\p{N}_]/u.test(value);
}
