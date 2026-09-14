import type { AsyncHashPort } from "./agent-domain.js";
import type { InstructionContentHash } from "./agent-domain.js";
import {
  createStoryAssessmentRevisionVector,
  storyChapterObjectiveRevisionToken,
  storyKnowledgeRevisionToken,
  storyManuscriptSliceRevisionToken,
  storySceneIntentRevisionToken,
  type StoryAssessmentDependency,
  type StoryAssessmentRevisionVector
} from "./story-assessment-freshness.js";
import {
  DomainValidationError,
  type ChapterId,
  type ManuscriptChapter,
  type Scene,
  type SceneId,
  type StoryKnowledge,
  type StoryKnowledgeId
} from "./domain.js";
import type { StoryContextProjection } from "./story-context.js";
import type { StoryCheckTarget } from "./story-check-findings-v1.js";
import type { SceneContentHash } from "./scene-documents.js";

export type StoryCheckConsumedSceneProse = Readonly<{
  sceneId: SceneId;
  workingVersion: number;
  contentHash: SceneContentHash;
}>;

export type StoryCheckRevisionVectorInput = Readonly<{
  target: StoryCheckTarget;
  consumedSceneProse: readonly StoryCheckConsumedSceneProse[];
  targetSceneIntent?: Pick<Scene, "id" | "summary" | "sketch">;
  chapterObjective?: Pick<ManuscriptChapter, "id" | "summary">;
  consumedStoryKnowledge?: readonly StoryKnowledge[];
  manuscriptSlice?: StoryContextProjection;
  hashPort: AsyncHashPort;
}>;

export type StoryCheckRevisionVectorBuildResult = Readonly<{
  revisionVector: StoryAssessmentRevisionVector;
  /**
   * Proposal-draft prose is bound on the target artifact, not scene-prose dependencies.
   * Freshness compares target.contentHash to the current StoryWorkArtifactPointer /
   * AgentProposal contentHash outside the assessment vector.
   */
  proposalDraftArtifactTrackedOnTarget: boolean;
}>;

/**
 * Builds the exact dependency vector for a grounded check from trusted inputs only.
 * Proposal-draft targets never add a scene-prose row for draft artifact prose.
 */
export async function buildStoryCheckRevisionVector(
  input: StoryCheckRevisionVectorInput
): Promise<StoryCheckRevisionVectorBuildResult> {
  const dependencies: StoryAssessmentDependency[] = [];
  const proseKeys = new Set<string>();

  for (const prose of input.consumedSceneProse) {
    const key = `scene-prose:${prose.sceneId}`;
    if (proseKeys.has(key)) {
      throw new DomainValidationError(
        "DUPLICATE_REFERENCE",
        `Story check consumed duplicate scene prose "${prose.sceneId}".`
      );
    }
    proseKeys.add(key);
    dependencies.push(
      Object.freeze({
        kind: "scene-prose",
        sceneId: prose.sceneId,
        workingVersion: prose.workingVersion,
        contentHash: prose.contentHash
      })
    );
  }

  if (input.targetSceneIntent !== undefined) {
    dependencies.push(
      Object.freeze({
        kind: "scene-intent",
        sceneId: input.targetSceneIntent.id,
        revisionToken: await storySceneIntentRevisionToken(
          input.targetSceneIntent,
          input.hashPort
        )
      })
    );
  }

  if (input.chapterObjective !== undefined) {
    dependencies.push(
      Object.freeze({
        kind: "chapter-objective",
        chapterId: input.chapterObjective.id as ChapterId,
        revisionToken: await storyChapterObjectiveRevisionToken(
          input.chapterObjective,
          input.hashPort
        )
      })
    );
  }

  if (input.consumedStoryKnowledge !== undefined) {
    const knowledgeKeys = new Set<StoryKnowledgeId>();
    for (const knowledge of input.consumedStoryKnowledge) {
      if (knowledgeKeys.has(knowledge.id)) {
        throw new DomainValidationError(
          "DUPLICATE_REFERENCE",
          `Story check consumed duplicate story knowledge "${knowledge.id}".`
        );
      }
      knowledgeKeys.add(knowledge.id);
      dependencies.push(
        Object.freeze({
          kind: "story-knowledge",
          storyKnowledgeId: knowledge.id,
          revisionToken: await storyKnowledgeRevisionToken(
            knowledge,
            input.hashPort
          )
        })
      );
    }
  }

  if (input.manuscriptSlice !== undefined) {
    dependencies.push(
      Object.freeze({
        kind: "manuscript-slice",
        scope: input.manuscriptSlice.scope,
        revisionToken: await storyManuscriptSliceRevisionToken(
          input.manuscriptSlice,
          input.hashPort
        )
      })
    );
  }

  if (input.target.mode === "proposal-draft") {
    return Object.freeze({
      revisionVector: createStoryAssessmentRevisionVector(dependencies),
      proposalDraftArtifactTrackedOnTarget: true
    });
  }

  return Object.freeze({
    revisionVector: createStoryAssessmentRevisionVector(dependencies),
    proposalDraftArtifactTrackedOnTarget: false
  });
}

/** Compares stored and current AgentProposal / StoryWorkArtifactPointer content hashes. */
export function evaluateStoryCheckProposalDraftArtifactFreshness(
  storedContentHash: InstructionContentHash,
  currentContentHash: InstructionContentHash
): Readonly<{ status: "fresh" } | { status: "needs-recheck"; reason: "proposal-artifact-changed" }> {
  return storedContentHash === currentContentHash
    ? Object.freeze({ status: "fresh" })
    : Object.freeze({
        status: "needs-recheck",
        reason: "proposal-artifact-changed"
      });
}
