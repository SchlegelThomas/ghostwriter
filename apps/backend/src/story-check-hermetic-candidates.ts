const ASSESS_SCENE_MARKER = "=== ASSESS SCENE ID (exact) ===\n";
const APPLIED_TARGET_MARKER =
  "=== CHECK TARGET: applied scene (canonical acknowledged head) ===\n";
const ORIGINAL_WRITER_BRIEF_MARKER = "=== ORIGINAL WRITER BRIEF (exact) ===\n";
const PROPOSAL_ARTIFACT_RESOURCE_PATTERN =
  /=== STORY RESOURCE \d+: proposal-artifact \(untrusted story data\) ===\n([\s\S]*?)(?=\n=== |$)/u;

const HERMETIC_GENERIC_CLAIM = "Hermetic continuity note for local validation.";
const AC10_BRASS_LETTER_CLAIM =
  "The discovery scene changes the brass letter's author from Mira and drops the earlier root warning.";
const HERMETIC_EVIDENCE_EXCERPT_MAX_CHARS = 120;

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

/** Writer brief line(s) from compiled story-check input, when present. */
export function extractStoryCheckHermeticWriterBrief(inputText: string): string | undefined {
  const idx = inputText.indexOf(ORIGINAL_WRITER_BRIEF_MARKER);
  if (idx < 0) {
    return undefined;
  }
  const after = inputText.slice(idx + ORIGINAL_WRITER_BRIEF_MARKER.length);
  const sectionEnd = after.search(/\n=== /u);
  const raw = (sectionEnd >= 0 ? after.slice(0, sectionEnd) : after).trim();
  return raw.length === 0 ? undefined : raw;
}

function normalizeHermeticEvidenceText(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

function hermeticEvidenceExcerpt(normalizedText: string): string {
  if (normalizedText.length <= HERMETIC_EVIDENCE_EXCERPT_MAX_CHARS) {
    return normalizedText;
  }
  return `${normalizedText.slice(0, HERMETIC_EVIDENCE_EXCERPT_MAX_CHARS - 1)}…`;
}

function hasAc10AuthorshipContradictionCues(normalizedText: string): boolean {
  const lower = normalizedText.toLowerCase();
  if (/not mira[''\u2019]s(?:\s+own(?:\s+signature)?)?/u.test(lower)) {
    return true;
  }
  return lower.includes("mira") && /not her own signature/u.test(lower);
}

function hasAc10RootWarningContradictionCue(normalizedText: string): boolean {
  return /no warning about roots/iu.test(normalizedText);
}

/** Deterministic claim from trusted compiled target text (and brief when target is absent). */
export function storyCheckHermeticClaimFromCompiledInput(
  inputText: string,
  providerText: string | undefined
): string {
  if (providerText !== undefined) {
    const normalized = normalizeHermeticEvidenceText(providerText);
    if (normalized.length > 0) {
      if (
        hasAc10AuthorshipContradictionCues(normalized) &&
        hasAc10RootWarningContradictionCue(normalized)
      ) {
        return AC10_BRASS_LETTER_CLAIM;
      }
      const excerpt = hermeticEvidenceExcerpt(normalized);
      return `Supplied target text includes: "${excerpt}".`;
    }
  }
  const brief = extractStoryCheckHermeticWriterBrief(inputText);
  if (brief !== undefined) {
    const normalizedBrief = normalizeHermeticEvidenceText(brief);
    if (normalizedBrief.length > 0) {
      const excerpt = hermeticEvidenceExcerpt(normalizedBrief);
      return `Writer brief for check: "${excerpt}".`;
    }
  }
  return HERMETIC_GENERIC_CLAIM;
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
  const claim = storyCheckHermeticClaimFromCompiledInput(inputText, providerText);
  return Object.freeze({
    schemaId: "story-check-findings-candidates-v1",
    findings: Object.freeze([
      Object.freeze({
        kind: "contradiction" as const,
        severity: "important" as const,
        claim,
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
