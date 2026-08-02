export type WorkspaceChatTranscriptMessage = Readonly<{
  role: "user" | "assistant" | "system";
  body: string;
}>;

const ROLE_LABELS: Record<WorkspaceChatTranscriptMessage["role"], string> = {
  user: "You",
  assistant: "Ghostwriter",
  system: "System"
};

export function formatWorkspaceChatTranscript(
  input: Readonly<{
    messages: readonly WorkspaceChatTranscriptMessage[];
    sessionTitle?: string;
    selectionSummary?: string;
  }>
): string {
  const headerLines: string[] = [];

  const sessionTitle = input.sessionTitle?.trim();
  if (sessionTitle !== undefined && sessionTitle.length > 0) {
    headerLines.push(`Session: ${sessionTitle}`);
  }

  const selectionSummary = input.selectionSummary?.trim();
  if (selectionSummary !== undefined && selectionSummary.length > 0) {
    headerLines.push(`Context: ${selectionSummary}`);
  }

  const turns: string[] = [];
  for (const message of input.messages) {
    const body = message.body.trim();
    if (body.length === 0) continue;
    turns.push(`${ROLE_LABELS[message.role]}:\n${body}`);
  }

  if (headerLines.length === 0 && turns.length === 0) {
    return "";
  }

  const parts: string[] = [];
  if (headerLines.length > 0) {
    parts.push(headerLines.join("\n"));
    if (turns.length > 0) {
      parts.push("");
    }
  }
  if (turns.length > 0) {
    parts.push(turns.join("\n\n"));
  }

  return parts.join("\n");
}
