import type { AgentProposalRepository } from "@ghostwriter/core";
import {
  type AccountId,
  type InstructionContentHash,
  type ProjectId,
  type StoryWorkAssignment,
  type StoryWorkAssignmentRepository,
  type StoryWorkSourceReference
} from "@ghostwriter/core";

export type CheckProposalFreshnessRepositories = Readonly<{
  assignments: Pick<StoryWorkAssignmentRepository, "get">;
  proposals: Pick<AgentProposalRepository, "get">;
}>;

type ProposalArtifactSource = Extract<
  StoryWorkSourceReference,
  { kind: "proposal-artifact" }
>;

function sourceAssignmentTargetsScene(
  sourceAssignment: StoryWorkAssignment,
  expectedSceneId: ProposalArtifactSource["sceneId"]
): boolean {
  return (
    (sourceAssignment.taskKind === "scene" || sourceAssignment.taskKind === "revise") &&
    sourceAssignment.destination.kind === "scene" &&
    sourceAssignment.destination.sceneId === expectedSceneId
  );
}

/**
 * Current scene-draft proposal hash for proposal-draft check freshness.
 * Returns undefined when the source assignment or artifact is gone or untrusted.
 */
export async function resolveCheckProposalDraftFreshnessContentHash(
  repositories: CheckProposalFreshnessRepositories,
  input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
    proposalSource: ProposalArtifactSource;
  }>
): Promise<InstructionContentHash | undefined> {
  const sourceAssignment = await repositories.assignments.get({
    accountId: input.accountId,
    projectId: input.projectId,
    assignmentId: input.proposalSource.assignmentId
  });
  if (
    sourceAssignment === undefined ||
    sourceAssignment.projectId !== input.projectId ||
    !sourceAssignmentTargetsScene(sourceAssignment, input.proposalSource.sceneId) ||
    sourceAssignment.currentArtifact === undefined
  ) {
    return undefined;
  }
  const currentArtifact = sourceAssignment.currentArtifact;
  const proposal = await repositories.proposals.get(currentArtifact.proposalId);
  if (
    proposal === undefined ||
    proposal.projectId !== input.projectId ||
    proposal.outputSchemaId !== "scene-draft-v1" ||
    proposal.contentHash !== currentArtifact.contentHash
  ) {
    return undefined;
  }
  return currentArtifact.contentHash;
}
