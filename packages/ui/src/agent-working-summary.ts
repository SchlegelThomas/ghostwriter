/**
 * Collapse rules for the "Working" group under an agent turn.
 *
 * While the agent is working the writer wants to see it think; once the reply
 * lands, the steps fold away into one honest line so the conversation reads
 * like prose instead of a console.
 */

export type AgentWorkingTrace = Readonly<{ title: string; ok: boolean }>;

export type AgentWorkingGroupInput = Readonly<{
  streaming: boolean;
  statusLabel?: string;
  traces: readonly AgentWorkingTrace[];
}>;

export type AgentWorkingGroupState = Readonly<{
  /** False when the turn did no visible work worth reporting. */
  visible: boolean;
  /** One-line summary shown on the group header. */
  label: string;
  /** Expanded while working, folded once the turn finishes. */
  defaultExpanded: boolean;
  /** False when there are no traces to reveal. */
  toggleable: boolean;
}>;

export function agentWorkingGroupState(
  input: AgentWorkingGroupInput
): AgentWorkingGroupState {
  const traceCount = input.traces.length;
  const failedCount = input.traces.filter((trace) => !trace.ok).length;

  return {
    visible: input.streaming || traceCount > 0,
    label: agentWorkingLabel(input, traceCount, failedCount),
    defaultExpanded: input.streaming,
    toggleable: traceCount > 0
  };
}

function agentWorkingLabel(
  input: AgentWorkingGroupInput,
  traceCount: number,
  failedCount: number
): string {
  if (input.streaming) {
    const status = (input.statusLabel ?? "").trim();
    const head = status.length > 0 ? status : "Working…";
    return traceCount > 0 ? `${head} · ${stepCount(traceCount)}` : head;
  }

  const first = input.traces[0];
  let head = "Worked";
  if (traceCount === 1 && first !== undefined && first.title.trim().length > 0) {
    head = `Worked · ${first.title.trim()}`;
  } else if (traceCount > 0) {
    head = `Worked · ${stepCount(traceCount)}`;
  }

  if (failedCount === 0) return head;
  return `${head} · ${failedCount} ${
    failedCount === 1 ? "needs" : "need"
  } a look`;
}

function stepCount(count: number): string {
  return count === 1 ? "1 step" : `${count} steps`;
}
