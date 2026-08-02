/** Soft craft verbs for in-progress work-plan jobs (no ellipsis — UI pulses that). */
export const WORK_PLAN_WORKING_QUIPS = Object.freeze([
  "Reviewing",
  "Working",
  "Editing",
  "Consulting",
  "Listening",
  "Noticing",
  "Gathering",
  "Comparing",
  "Weighing",
  "Tracing",
  "Sketching",
  "Shaping",
  "Tightening",
  "Softening",
  "Checking",
  "Cross-checking",
  "Reading",
  "Rereading",
  "Mapping",
  "Aligning",
  "Balancing",
  "Combing",
  "Sifting",
  "Sorting",
  "Framing",
  "Reframing",
  "Considering",
  "Considering again",
  "Pausing",
  "Looking closer",
  "Looking wider",
  "Holding the beat",
  "Finding the turn",
  "Finding the voice",
  "Hearing the dialogue",
  "Watching the scene",
  "Walking the continuity",
  "Testing the motive",
  "Testing the stakes",
  "Naming the thread",
  "Naming the object",
  "Anchoring the cast",
  "Anchoring the place",
  "Tuning the rhythm",
  "Tuning the tone",
  "Polishing a line",
  "Polishing a beat",
  "Drafting lightly",
  "Drafting carefully",
  "Almost there"
] as const);

export type WorkPlanWorkingQuip = (typeof WORK_PLAN_WORKING_QUIPS)[number];

/** Typewriter: reveal one character every `charMs`; hold full word `holdMs`. */
export function workPlanQuipPhase(
  elapsedMs: number,
  quip: string,
  charMs = 55,
  holdMs = 2_400
): Readonly<{
  visible: string;
  complete: boolean;
  nextQuipAt: number;
}> {
  const typeDuration = Math.max(quip.length, 1) * charMs;
  const cycle = typeDuration + holdMs;
  const intoCycle = ((elapsedMs % cycle) + cycle) % cycle;
  if (intoCycle >= typeDuration) {
    return Object.freeze({
      visible: quip,
      complete: true,
      nextQuipAt: cycle - intoCycle
    });
  }
  const chars = Math.max(1, Math.floor(intoCycle / charMs) + 1);
  return Object.freeze({
    visible: quip.slice(0, Math.min(chars, quip.length)),
    complete: false,
    nextQuipAt: typeDuration - intoCycle + holdMs
  });
}

export function workPlanQuipAtIndex(index: number): string {
  const safe =
    ((index % WORK_PLAN_WORKING_QUIPS.length) +
      WORK_PLAN_WORKING_QUIPS.length) %
    WORK_PLAN_WORKING_QUIPS.length;
  return WORK_PLAN_WORKING_QUIPS[safe]!;
}
