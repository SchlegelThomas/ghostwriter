const ASSESS_SCENE_MARKER = "=== ASSESS SCENE ID (exact) ===\n";
const APPLIED_TARGET_MARKER =
  "=== CHECK TARGET: applied scene (canonical acknowledged head) ===\n";
const PROPOSAL_ARTIFACT_RESOURCE_PATTERN =
  /=== STORY RESOURCE \d+: proposal-artifact \(untrusted story data\) ===\n([\s\S]*?)(?=\n=== |$)/u;

/** Assess scene id from compiled story-check provider input. */
export function extractStoryCheckHermeticAssessSceneId(inputText: string): string {
  return (
    inputText.split(ASSESS_SCENE_MARKER)[1]?.split("\n", 1)[0]?.trim() ?? "scene-unknown"
  );
}

/**
 * Target prose for hermetic anchors: applied-scene head text or proposal-artifact provider text.
 * Matches {@link compileStoryCheckContinuity} resource section headers.
 */
export function extractStoryCheckHermeticTargetProviderText(
  inputText: string
): string | undefined {
  const appliedIdx = inputText.indexOf(APPLIED_TARGET_MARKER);
  if (appliedIdx >= 0) {
    const text = inputText.slice(appliedIdx + APPLIED_TARGET_MARKER.length).split("\n=== ")[0];
    if (text === undefined || text.trim().length === 0) {
      return undefined;
    }
    return text;
  }
  const match = inputText.match(PROPOSAL_ARTIFACT_RESOURCE_PATTERN);
  if (match?.[1] === undefined || match[1].trim().length === 0) {
    return undefined;
  }
  return match[1];
}

/** Exact nonblank substring of provider text for trusted anchor validation, or undefined. */
export function storyCheckHermeticQuoteFromProviderText(
  providerText: string | undefined
): string | undefined {
  if (providerText === undefined) {
    return undefined;
  }
  const withoutLeadingWhitespace = providerText.replace(/^\s+/u, "");
  if (withoutLeadingWhitespace.length === 0) {
    return undefined;
  }
  const quoteLength = Math.min(24, withoutLeadingWhitespace.length);
  return withoutLeadingWhitespace.slice(0, quoteLength);
}

export type StoryCheckHermeticCandidatesOutput = Readonly<{
  schemaId: "story-check-findings-candidates-v1";
  findings: readonly Readonly<{
    kind: "contradiction";
    severity: "important";
    claim: string;
    anchors: readonly Readonly<{
      sceneId: string;
      quote?: string;
    }>[];
  }>[];
}>;

export function buildStoryCheckHermeticCandidatesOutput(
  inputText: string
): StoryCheckHermeticCandidatesOutput {
  const assessSceneId = extractStoryCheckHermeticAssessSceneId(inputText);
  const providerText = extractStoryCheckHermeticTargetProviderText(inputText);
  const quote = storyCheckHermeticQuoteFromProviderText(providerText);
  return Object.freeze({
    schemaId: "story-check-findings-candidates-v1",
    findings: Object.freeze([
      Object.freeze({
        kind: "contradiction" as const,
        severity: "important" as const,
        claim: "Hermetic continuity note for local validation.",
        anchors: Object.freeze([
          Object.freeze({
            sceneId: assessSceneId,
            ...(quote === undefined ? {} : { quote })
          })
        ])
      })
    ])
  });
}
