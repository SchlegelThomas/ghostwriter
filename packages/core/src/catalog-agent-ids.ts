export const CATALOG_AGENT_IDS = Object.freeze([
  "idea-midwife",
  "genre-compass",
  "what-if-engine",
  "story-architect",
  "pacing-doctor",
  "promise-keeper",
  "outline-expander",
  "scene-sequel-coach",
  "dialogue-coach",
  "character-coach-cast",
  "developmental-editor",
  "continuity-reader",
  "line-editor",
  "copy-editor",
  "pitch-pack",
  "query-coach",
  "series-bible",
  "market-fit"
] as const);

export type CatalogAgentId = (typeof CATALOG_AGENT_IDS)[number];

export const CATALOG_AGENT_LABELS: Readonly<Record<CatalogAgentId, string>> =
  Object.freeze({
    "idea-midwife": "Idea Midwife",
    "genre-compass": "Genre Compass",
    "what-if-engine": "What-if Engine",
    "story-architect": "Story Architect",
    "pacing-doctor": "Pacing Doctor",
    "promise-keeper": "Promise Keeper",
    "outline-expander": "Outline Expander",
    "scene-sequel-coach": "Scene/Sequel Coach",
    "dialogue-coach": "Dialogue Coach",
    "character-coach-cast": "Character Coach · Cast",
    "developmental-editor": "Developmental Editor",
    "continuity-reader": "Continuity Reader",
    "line-editor": "Line Editor",
    "copy-editor": "Copy Editor",
    "pitch-pack": "Pitch Pack",
    "query-coach": "Query Coach",
    "series-bible": "Series Bible",
    "market-fit": "Market Fit"
  });

export function isCatalogAgentId(value: string): value is CatalogAgentId {
  return CATALOG_AGENT_IDS.includes(value as CatalogAgentId);
}

export function catalogAgentLabel(agentId: CatalogAgentId): string {
  return CATALOG_AGENT_LABELS[agentId];
}
