import type {
  ProjectNavigator,
  ProjectNavigatorScene,
  SceneId
} from "@ghostwriter/core";
import type {
  SceneBlockV1,
  SceneDocumentV1,
  SceneInlineNodeV1
} from "@ghostwriter/editor";

export type DraftDeskSceneContext = Readonly<{
  sceneIndex: number;
  sceneCount: number;
  positionLabel: string;
  previousScene?: ProjectNavigatorScene;
  nextScene?: ProjectNavigatorScene;
  povLabel?: string;
}>;

export function projectScenes(
  project: ProjectNavigator
): readonly ProjectNavigatorScene[] {
  return project.books.flatMap((book) => [
    ...book.parts.flatMap((part) =>
      part.chapters.flatMap((chapter) => chapter.scenes)
    ),
    ...book.unassignedScenes
  ]);
}

export function draftDeskSceneContext(
  project: ProjectNavigator,
  sceneId: SceneId
): DraftDeskSceneContext {
  const scenes = projectScenes(project);
  const sceneIndex = scenes.findIndex((scene) => scene.id === sceneId);
  const scene = sceneIndex < 0 ? undefined : scenes[sceneIndex];
  const previousScene = sceneIndex > 0 ? scenes[sceneIndex - 1] : undefined;
  const nextScene =
    sceneIndex >= 0 && sceneIndex + 1 < scenes.length
      ? scenes[sceneIndex + 1]
      : undefined;
  const povLabel =
    scene?.povStoryKnowledgeId === undefined
      ? undefined
      : project.storyKnowledge.find(
          (knowledge) => knowledge.id === scene.povStoryKnowledgeId
        )?.label;
  return {
    sceneIndex,
    sceneCount: scenes.length,
    positionLabel:
      sceneIndex < 0
        ? "Manuscript scene"
        : `Scene ${sceneIndex + 1} of ${scenes.length}`,
    previousScene,
    nextScene,
    povLabel
  };
}

export function sceneDocumentWordCount(
  document: SceneDocumentV1 | undefined
): number {
  if (document === undefined) return 0;
  function text(node: SceneBlockV1 | SceneInlineNodeV1): string {
    if (node.type === "text") return node.text;
    if (node.type === "hardBreak" || node.type === "horizontalRule") return " ";
    return (node.content ?? []).map(text).join(" ");
  }
  const prose = document.document.content.map(text).join(" ");
  return prose.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
}
