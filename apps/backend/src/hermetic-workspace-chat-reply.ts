const WRITER_MESSAGE_LABEL = "Writer message:";
const OPEN_SCENE_DRAFT_LABEL = "Open scene draft:";

export type HermeticWorkspaceChatReply = Readonly<{
  reply: string;
}>;

function sectionAfterLabel(inputText: string, label: string): string {
  const marker = `${label}\n`;
  const start = inputText.indexOf(marker);
  if (start === -1) {
    const inline = `${label} `;
    const inlineStart = inputText.indexOf(inline);
    if (inlineStart === -1) return "";
    return inputText.slice(inlineStart + inline.length).trim();
  }
  const rest = inputText.slice(start + marker.length);
  const nextHeader = rest.search(
    /\n(?:Writer message:|Recent conversation|Project context:|Open scene draft:)/u
  );
  return (nextHeader === -1 ? rest : rest.slice(0, nextHeader)).trim();
}

function sceneTitleFromContext(inputText: string): string | undefined {
  const match = /scene="([^"]+)"/u.exec(inputText);
  const title = match?.[1]?.trim();
  return title === undefined || title.length === 0 ? undefined : title;
}

function softenAsk(ask: string): string {
  return ask
    .replace(/^(?:lets|let's|please|can we|could we|i want to|try)\s+/iu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/[.?!]+$/u, "");
}

function priorWriterCount(inputText: string): number {
  const block =
    inputText.split("Recent conversation")[1]?.split("Writer message:")[0] ?? "";
  return [...block.matchAll(/^Writer:/gmu)].length;
}

function wantsWrittenDraft(ask: string, priorWriters: number): boolean {
  if (ask.length === 0) return false;
  if (priorWriters > 0) return true;
  return /write|draft|introduce|connect|pull|feel|detail|continue|dark|insert|letter|try/iu.test(
    ask
  );
}

function continuationBeat(ask: string): string {
  const lowered = ask.toLowerCase();
  if (lowered.includes("pull") || lowered.includes("feel")) {
    return "The parchment warmed against his thumbs — not fire, the heat of something that had been waiting. He had not finished the first line, and already a pull sat behind his own name.";
  }
  if (lowered.includes("detail") || lowered.includes("wrong")) {
    return "The ink was darker in the loops of his name than it had any right to be, as if a second hand had finished the letter.";
  }
  if (lowered.includes("quiet")) {
    return "He almost missed it: a faint heat under the name, gone when he looked straight at the ink.";
  }
  if (lowered.includes("dark")) {
    return "Something older than the paper seemed to know him. The name on the envelope did not feel like a greeting. It felt like a claim.";
  }
  return "The next line can carry that pressure without naming it — a warmth in the page, a wrongness in the name, a sense that the letter is reading him back.";
}

/**
 * Writer-facing hermetic Agent reply. Later turns write a continuation the
 * writer can drop into the open scene. Never mentions propose-only or canon.
 */
export function buildHermeticWorkspaceChatReply(
  inputText: string
): HermeticWorkspaceChatReply {
  const sceneTitle = sceneTitleFromContext(inputText);
  const excerpt = sectionAfterLabel(inputText, OPEN_SCENE_DRAFT_LABEL);
  const ask = softenAsk(sectionAfterLabel(inputText, WRITER_MESSAGE_LABEL));
  if (!wantsWrittenDraft(ask, priorWriterCount(inputText))) {
    const opening =
      sceneTitle === undefined
        ? "The draft already has a live beat."
        : `On ${sceneTitle}, the draft already has a live beat.`;
    return {
      reply:
        ask.length === 0
          ? `${opening} What do you want to press on first — the image, the pressure on the page, or the next line?`
          : `${opening} We can hide that in a wrong detail, or in the body feeling it before it has a name. Which way do you want to try?`
    };
  }
  return {
    reply: [
      continuationBeat(ask),
      excerpt.length > 0
        ? "Want it darker, quieter, or dropped into the scene?"
        : "Want to change it, or drop this into the scene?"
    ].join("\n\n")
  };
}
