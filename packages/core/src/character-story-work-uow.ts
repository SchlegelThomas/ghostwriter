import type { InstructionContentHash } from "./agent-domain.js";
import type { AgentProposal } from "./agent-runs-proposals.js";
import type { AgentProposalId, ProjectId, StoryKnowledgeId } from "./domain.js";
import type { AccountId } from "./identity.js";
import type {
  StoryWorkAssignment,
  StoryWorkAssignmentId,
  StoryWorkResultReference
} from "./story-work-assignment.js";

export type ApplyCharacterStoryWorkInput = Readonly<{
  accountId: AccountId;
  projectId: ProjectId;
  assignmentId: StoryWorkAssignmentId;
  expectedAssignmentVersion: number;
  proposalId: AgentProposalId;
  expectedArtifactVersion: number;
  expectedProposalContentHash: InstructionContentHash | string;
  expectedProjectVersion: number;
}>;

export type CharacterStoryWorkApplyResult = Readonly<{
  replayed: boolean;
  assignment: StoryWorkAssignment;
  proposal: AgentProposal;
  result: Extract<StoryWorkResultReference, { kind: "story-knowledge" }>;
}>;

export interface CharacterStoryWorkApplyUnitOfWork {
  applyCharacter(
    input: ApplyCharacterStoryWorkInput & Readonly<{ appliedAt: string }>
  ): Promise<CharacterStoryWorkApplyResult>;
}

export type CharacterStoryWorkApplySummary = Readonly<{
  storyKnowledgeId: StoryKnowledgeId;
  projectVersion: number;
}>;
