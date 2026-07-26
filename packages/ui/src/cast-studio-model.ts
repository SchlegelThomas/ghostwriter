import type {
  CharacterSheet,
  CharacterVisual,
  ProjectNavigator,
  ProjectNavigatorKnowledge,
  SceneId,
  StoryKnowledgeAuthority,
  StoryKnowledgeId,
  StoryKnowledgeKind,
  StoryKnowledgeLinkKind
} from "@ghostwriter/core";

export type CharacterRoleSummaryInput = Readonly<{
  notes?: string;
  characterSheet?: CharacterSheet;
}>;

/** Deterministic Role-in-the-story copy — no provider. */
export function composeCharacterRoleSummary(
  input: CharacterRoleSummaryInput
): string {
  const parts: string[] = [];
  const notes = input.notes?.trim();
  if (notes !== undefined && notes.length > 0) parts.push(notes);
  const desire = input.characterSheet?.desire?.trim();
  if (desire !== undefined && desire.length > 0) parts.push(desire);
  const pressure = input.characterSheet?.pressure?.trim();
  if (pressure !== undefined && pressure.length > 0) parts.push(pressure);
  const voice = input.characterSheet?.voiceNotes?.trim();
  if (voice !== undefined && voice.length > 0) parts.push(voice);
  return parts.join("\n\n");
}

export type CastRosterRow = Readonly<{
  id: StoryKnowledgeId;
  label: string;
  authority: StoryKnowledgeAuthority;
  sceneCount: number;
  linkCount: number;
  archived: boolean;
}>;

export function projectCastRoster(
  project: ProjectNavigator,
  options: Readonly<{ includeArchived?: boolean }> = {}
): readonly CastRosterRow[] {
  const includeArchived = options.includeArchived === true;
  return project.storyKnowledge
    .filter(
      (record) =>
        record.kind === "character" &&
        (includeArchived || record.archivedAt === undefined)
    )
    .map((record) => ({
      id: record.id,
      label: record.label,
      authority: record.authority,
      sceneCount: record.linkedSceneCount,
      linkCount: record.linkedKnowledge.length,
      archived: record.archivedAt !== undefined
    }));
}

export type KnowledgeConstellationEgo = Readonly<{
  id: StoryKnowledgeId;
  label: string;
  kind: StoryKnowledgeKind;
}>;

export type KnowledgeConstellationPeer = Readonly<{
  id: StoryKnowledgeId;
  label: string;
  kind: StoryKnowledgeKind;
  linkKind: StoryKnowledgeLinkKind;
}>;

export type KnowledgeConstellation = Readonly<{
  ego: KnowledgeConstellationEgo;
  peers: readonly KnowledgeConstellationPeer[];
}>;

export function buildKnowledgeConstellation(
  ego: ProjectNavigatorKnowledge,
  storyKnowledge: readonly ProjectNavigatorKnowledge[]
): KnowledgeConstellation {
  const byId = new Map(storyKnowledge.map((record) => [record.id, record]));
  const peers: KnowledgeConstellationPeer[] = [];
  for (const link of ego.linkedKnowledge) {
    const peer = byId.get(link.toId);
    if (peer === undefined || peer.archivedAt !== undefined) continue;
    peers.push({
      id: peer.id,
      label: peer.label,
      kind: peer.kind,
      linkKind: link.kind
    });
  }
  return {
    ego: {
      id: ego.id,
      label: ego.label,
      kind: ego.kind
    },
    peers
  };
}

/** Narrow fallback: peers grouped by knowledge-link kind. */
export function groupConstellationPeersByKind(
  peers: readonly KnowledgeConstellationPeer[]
): readonly Readonly<{
  kind: StoryKnowledgeLinkKind;
  peers: readonly KnowledgeConstellationPeer[];
}>[] {
  const order: StoryKnowledgeLinkKind[] = [
    "cast",
    "theme",
    "development-cycle",
    "breadcrumb",
    "related"
  ];
  const groups = new Map<StoryKnowledgeLinkKind, KnowledgeConstellationPeer[]>();
  for (const peer of peers) {
    const list = groups.get(peer.linkKind) ?? [];
    list.push(peer);
    groups.set(peer.linkKind, list);
  }
  return order
    .filter((kind) => (groups.get(kind)?.length ?? 0) > 0)
    .map((kind) => ({
      kind,
      peers: groups.get(kind) ?? []
    }));
}

export type ScenePresenceRow = Readonly<{
  sceneId: SceneId;
  title: string;
  status: string;
  isPov: boolean;
}>;

export function scenePresenceRows(
  ego: ProjectNavigatorKnowledge,
  project: ProjectNavigator
): readonly ScenePresenceRow[] {
  const linked = new Set(ego.linkedSceneIds);
  const scenes = project.books.flatMap((book) => [
    ...book.parts.flatMap((part) =>
      part.chapters.flatMap((chapter) => chapter.scenes)
    ),
    ...book.unassignedScenes
  ]);
  return scenes
    .filter(
      (scene) =>
        scene.archivedAt === undefined && linked.has(scene.id)
    )
    .map((scene) => ({
      sceneId: scene.id,
      title: scene.title,
      status: scene.status,
      isPov: scene.povStoryKnowledgeId === ego.id
    }));
}

export function selectedCastKnowledge(
  project: ProjectNavigator,
  selection: Readonly<{
    kind: string;
    storyKnowledgeId?: StoryKnowledgeId;
  }>
): ProjectNavigatorKnowledge | undefined {
  if (selection.kind !== "storyKnowledge") return undefined;
  if (selection.storyKnowledgeId === undefined) return undefined;
  const knowledge = project.storyKnowledge.find(
    (record) => record.id === selection.storyKnowledgeId
  );
  if (knowledge === undefined || knowledge.kind !== "character") {
    return undefined;
  }
  return knowledge;
}

export function parseAliasList(value: string): readonly string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** Remove one gallery visual; returns null when the last image is removed. */
export function visualsAfterDelete(
  visuals: readonly CharacterVisual[] | undefined,
  visualId: string
): readonly CharacterVisual[] | null {
  const next = (visuals ?? []).filter((visual) => visual.id !== visualId);
  return next.length === 0 ? null : next;
}

export function characterVisualEmptyStateCopy(
  visuals: readonly CharacterVisual[] | undefined
): string | undefined {
  if (visuals !== undefined && visuals.length > 0) {
    return undefined;
  }
  return "No portraits yet. Generate or upload a visualization.";
}
