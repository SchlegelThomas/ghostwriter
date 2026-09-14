import type { SceneId } from "@ghostwriter/core";

export type EvidenceFocusBlockRequestState = Readonly<{
  id: number;
  sceneId: SceneId;
  blockId: string;
}>;

export type EvidenceFocusAfterOpenSceneResult =
  | Readonly<{ kind: "clear" }>
  | Readonly<{ kind: "noop" }>
  | Readonly<{ kind: "install"; request: EvidenceFocusBlockRequestState }>;

/** Installs or clears evidence block focus after story-work scene navigation. */
export function resolveEvidenceFocusAfterOpenScene(input: Readonly<{
  blockId: string | undefined;
  navigationOpened: boolean;
  projectOpen: boolean;
  targetSceneId: SceneId;
  nextRequestId: number;
}>): EvidenceFocusAfterOpenSceneResult {
  if (input.blockId === undefined) {
    return { kind: "clear" };
  }
  if (!input.navigationOpened || !input.projectOpen) {
    return { kind: "noop" };
  }
  return {
    kind: "install",
    request: {
      id: input.nextRequestId,
      sceneId: input.targetSceneId,
      blockId: input.blockId,
    },
  };
}
