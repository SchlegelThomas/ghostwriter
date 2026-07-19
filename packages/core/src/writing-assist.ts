import type {
  CharacterSheet,
  SceneSketch,
  StoryKnowledgeId
} from "./domain.js";

export type WritingAssistRole =
  | "scene-partner"
  | "character-coach"
  | "worldkeeper"
  | "sketch-partner";

export type WritingAssistProposalKind =
  | "prose-variant"
  | "sketch-fields"
  | "character-sheet"
  | "backdrop-notes";

export type WritingAssistProposal = Readonly<{
  id: string;
  role: WritingAssistRole;
  kind: WritingAssistProposalKind;
  title: string;
  summary: string;
  provider: "deterministic-local";
  status: "ready";
  /** Provisional prose for variant insert — never auto-applied. */
  prose?: string;
  sketch?: SceneSketch;
  characterSheet?: CharacterSheet;
  storyKnowledgeId?: StoryKnowledgeId;
  backdropCaption?: string;
}>;

export type WritingAssistContext = Readonly<{
  sceneTitle: string;
  sceneSummary?: string;
  sketch?: SceneSketch;
  recentProse?: string;
  cast?: readonly Readonly<{
    id: StoryKnowledgeId;
    label: string;
    characterSheet?: CharacterSheet;
  }>[];
  backdropCaption?: string;
}>;

function proseTail(text: string | undefined, max = 480): string {
  if (text === undefined) return "";
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `…${trimmed.slice(-max)}`;
}

export function buildDeterministicWritingAssistProposals(
  role: WritingAssistRole,
  context: WritingAssistContext
): readonly WritingAssistProposal[] {
  const sketch = context.sketch;
  const castLabel = context.cast?.[0]?.label ?? "the viewpoint character";
  const purpose = sketch?.purpose ?? "advance the scene’s dramatic question";
  const conflict = sketch?.conflict ?? "a pressure that forces a choice";
  const turn = sketch?.turn ?? "the character cannot leave unchanged";

  switch (role) {
    case "scene-partner": {
      const tail = proseTail(context.recentProse);
      return Object.freeze([
        Object.freeze({
          id: "scene-partner-a",
          role,
          kind: "prose-variant" as const,
          title: "Variant A · Answer in the present",
          summary: `Continue so ${castLabel} acts before the pressure settles.`,
          provider: "deterministic-local" as const,
          status: "ready" as const,
          prose: [
            tail.length > 0 ? "" : `${context.sceneTitle} opened on a held breath.`,
            `${castLabel} did not wait for permission. ${purpose[0]?.toUpperCase()}${purpose.slice(1)}.`,
            `Against ${conflict}, the only move left was forward — and ${turn}.`
          ]
            .filter((line) => line.length > 0)
            .join("\n\n")
        }),
        Object.freeze({
          id: "scene-partner-b",
          role,
          kind: "prose-variant" as const,
          title: "Variant B · Delay and deepen",
          summary: `Continue with a beat that raises cost before ${castLabel} commits.`,
          provider: "deterministic-local" as const,
          status: "ready" as const,
          prose: [
            `${castLabel} almost spoke, then didn’t. The pause made ${conflict} louder.`,
            `If the scene exists to ${purpose}, this beat withholds the easy answer — until ${turn}.`
          ].join("\n\n")
        })
      ]);
    }
    case "character-coach": {
      const target = context.cast?.[0];
      if (target === undefined) {
        return Object.freeze([
          Object.freeze({
            id: "character-coach-empty",
            role,
            kind: "character-sheet" as const,
            title: "Cast needed",
            summary:
              "Link a character to this scene before Character Coach can propose sheet updates.",
            provider: "deterministic-local" as const,
            status: "ready" as const
          })
        ]);
      }
      return Object.freeze([
        Object.freeze({
          id: "character-coach-sheet",
          role,
          kind: "character-sheet" as const,
          title: `Sheet delta · ${target.label}`,
          summary: "Sharpen desire, pressure, and voice for the current scene.",
          provider: "deterministic-local" as const,
          status: "ready" as const,
          storyKnowledgeId: target.id,
          characterSheet: Object.freeze({
            desire:
              target.characterSheet?.desire ??
              `Protect what ${target.label} still believes can be saved.`,
            pressure:
              target.characterSheet?.pressure ??
              conflict,
            voiceNotes:
              target.characterSheet?.voiceNotes ??
              "Spare, practical diction; resists mysticism until it bruises them."
          })
        })
      ]);
    }
    case "worldkeeper": {
      return Object.freeze([
        Object.freeze({
          id: "worldkeeper-backdrop",
          role,
          kind: "backdrop-notes" as const,
          title: "Backdrop constraint · candidate",
          summary: "A place rule that could constrain the scene without rewriting prose.",
          provider: "deterministic-local" as const,
          status: "ready" as const,
          backdropCaption:
            context.backdropCaption ??
            `Setting pressure: the place itself enforces a cost if ${castLabel} refuses ${purpose}.`
        })
      ]);
    }
    case "sketch-partner": {
      return Object.freeze([
        Object.freeze({
          id: "sketch-partner-fields",
          role,
          kind: "sketch-fields" as const,
          title: "Sketch fields · proposed",
          summary: "Turn current intent into editable purpose / conflict / turn.",
          provider: "deterministic-local" as const,
          status: "ready" as const,
          sketch: Object.freeze({
            purpose:
              sketch?.purpose ??
              `Force a decisive present-tense choice for ${castLabel}.`,
            conflict: sketch?.conflict ?? conflict,
            turn: sketch?.turn ?? turn,
            beats: sketch?.beats ??
              Object.freeze([
                "Establish the held breath",
                "Introduce the impossible pressure",
                "Force an answer or a refusal"
              ]),
            sensoryNotes:
              sketch?.sensoryNotes ??
              "One concrete sensory detail that belongs only to this room.",
            openQuestions:
              sketch?.openQuestions ??
              "What does the character lose by obeying?"
          })
        })
      ]);
    }
    default: {
      const _exhaustive: never = role;
      return _exhaustive;
    }
  }
}
