import { canonicalJsonStringify } from "./agent-canonical-json.js";
import type {
  AccountAiCollaborationProfile,
  AiCollaborationPosture,
  AsyncHashPort,
  ProjectAgentInstructions
} from "./agent-domain.js";
import {
  createAccountAiCollaborationProfile,
  createProjectAgentInstructions,
  createProjectPlaybook,
  instructionContentHash,
  type ProjectPlaybook
} from "./agent-domain.js";
import type {
  AccountAiCollaborationProfileRepository,
  ProjectAgentInstructionsRepository,
  ProjectPlaybookRepository
} from "./agent-guidance-repository.js";
import { normalizeAgentFoundationListLimit } from "./agent-runs-proposals.js";
import { ProjectArchivedMutationError } from "./capture-documents.js";
import type { PlaybookId, ProjectId } from "./domain.js";
import { playbookId } from "./domain.js";
import {
  ProjectAccessDeniedError,
  requireProjectOwner,
  type AccountId
} from "./identity.js";
import type { Clock, IdGenerator, ProjectRepository } from "./project-repository.js";

export class AgentGuidanceNotFoundError extends Error {
  constructor() {
    super("The requested agent guidance could not be found.");
    this.name = "AgentGuidanceNotFoundError";
  }
}

export class AgentGuidanceConflictError extends Error {
  constructor() {
    super("The agent guidance changed since it was loaded.");
    this.name = "AgentGuidanceConflictError";
  }
}

export type AgentGuidanceServices = Readonly<{
  getAccountAiCollaborationProfile(
    accountId: AccountId
  ): Promise<AccountAiCollaborationProfile | undefined>;
  saveAccountAiCollaborationProfile(input: Readonly<{
    accountId: AccountId;
    expectedVersion?: number;
    posture: AiCollaborationPosture;
    boundaries?: string;
  }>): Promise<AccountAiCollaborationProfile>;
  skipAccountAiCollaborationSetup(input: Readonly<{
    accountId: AccountId;
    expectedVersion?: number;
  }>): Promise<AccountAiCollaborationProfile>;
  getProjectAgentInstructions(input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
  }>): Promise<ProjectAgentInstructions | undefined>;
  saveProjectAgentInstructions(input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
    expectedVersion?: number;
    body: string;
  }>): Promise<ProjectAgentInstructions>;
  listProjectPlaybooks(input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
    limit?: number;
    includeArchived?: boolean;
  }>): Promise<readonly ProjectPlaybook[]>;
  saveProjectPlaybook(input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
    playbookId?: PlaybookId;
    expectedVersion?: number;
    name: string;
    enabled: boolean;
    trigger: ProjectPlaybook["trigger"];
    allowedContextClasses: readonly ProjectPlaybook["allowedContextClasses"][number][];
    outputSchemaId: ProjectPlaybook["outputSchemaId"];
    guidance: string;
  }>): Promise<ProjectPlaybook>;
  archiveProjectPlaybook(input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
    playbookId: PlaybookId;
    expectedVersion: number;
  }>): Promise<ProjectPlaybook>;
}>;

export type AgentGuidanceServiceDependencies = Readonly<{
  projects: ProjectRepository;
  collaborationProfiles: AccountAiCollaborationProfileRepository;
  projectInstructions: ProjectAgentInstructionsRepository;
  playbooks: ProjectPlaybookRepository;
  hashPort: AsyncHashPort;
  ids: IdGenerator;
  clock: Clock;
}>;

async function requireOwnedProjectRead(
  dependencies: AgentGuidanceServiceDependencies,
  accountId: AccountId,
  projectId: ProjectId
): Promise<void> {
  try {
    requireProjectOwner(
      projectId,
      await dependencies.projects.getProjectMembership(projectId, accountId)
    );
  } catch (error) {
    if (error instanceof ProjectAccessDeniedError) {
      throw new AgentGuidanceNotFoundError();
    }
    throw error;
  }
  const project = await dependencies.projects.getProject(projectId);
  if (project === undefined) {
    throw new AgentGuidanceNotFoundError();
  }
}

async function requireOwnedProjectMutation(
  dependencies: AgentGuidanceServiceDependencies,
  accountId: AccountId,
  projectId: ProjectId
): Promise<void> {
  await requireOwnedProjectRead(dependencies, accountId, projectId);
  const project = await dependencies.projects.getProject(projectId);
  if (project?.archivedAt !== undefined) {
    throw new ProjectArchivedMutationError();
  }
}

async function digestInstructionBody(body: string, hashPort: AsyncHashPort): Promise<string> {
  return hashPort.digestSha256Hex(canonicalJsonStringify({ body: body.trim() }));
}

export function createAgentGuidanceServices(
  dependencies: AgentGuidanceServiceDependencies
): AgentGuidanceServices {
  return Object.freeze({
    async getAccountAiCollaborationProfile(accountId) {
      return dependencies.collaborationProfiles.get(accountId);
    },

    async saveAccountAiCollaborationProfile(input) {
      const existing = await dependencies.collaborationProfiles.get(input.accountId);
      const now = dependencies.clock.now();
      const profile = createAccountAiCollaborationProfile({
        version: existing === undefined ? 1 : existing.version + 1,
        setupSkipped: false,
        posture: input.posture,
        ...(input.boundaries === undefined ? {} : { boundaries: input.boundaries }),
        updatedAt: now
      });
      const outcome = await dependencies.collaborationProfiles.upsert(
        input.accountId,
        profile,
        existing === undefined ? undefined : input.expectedVersion
      );
      if (!outcome.ok) {
        throw new AgentGuidanceConflictError();
      }
      return outcome.profile;
    },

    async skipAccountAiCollaborationSetup(input) {
      const existing = await dependencies.collaborationProfiles.get(input.accountId);
      const now = dependencies.clock.now();
      const profile = createAccountAiCollaborationProfile({
        version: existing === undefined ? 1 : existing.version + 1,
        setupSkipped: true,
        updatedAt: now
      });
      const outcome = await dependencies.collaborationProfiles.upsert(
        input.accountId,
        profile,
        existing === undefined ? undefined : input.expectedVersion
      );
      if (!outcome.ok) {
        throw new AgentGuidanceConflictError();
      }
      return outcome.profile;
    },

    async getProjectAgentInstructions(input) {
      await requireOwnedProjectRead(dependencies, input.accountId, input.projectId);
      const instructions = await dependencies.projectInstructions.get(input.projectId);
      if (instructions === undefined) {
        return undefined;
      }
      return instructions;
    },

    async saveProjectAgentInstructions(input) {
      await requireOwnedProjectMutation(dependencies, input.accountId, input.projectId);
      const existing = await dependencies.projectInstructions.get(input.projectId);
      const now = dependencies.clock.now();
      const digest = await digestInstructionBody(input.body, dependencies.hashPort);
      const instructions = createProjectAgentInstructions({
        projectId: input.projectId,
        version: existing === undefined ? 1 : existing.version + 1,
        body: input.body,
        contentHash: instructionContentHash(digest),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now
      });
      const outcome = await dependencies.projectInstructions.upsert(
        instructions,
        existing === undefined ? undefined : input.expectedVersion
      );
      if (!outcome.ok) {
        throw new AgentGuidanceConflictError();
      }
      return outcome.instructions;
    },

    async listProjectPlaybooks(input) {
      await requireOwnedProjectRead(dependencies, input.accountId, input.projectId);
      const limit = normalizeAgentFoundationListLimit(input.limit);
      const playbooks = await dependencies.playbooks.listByProject(input.projectId, {
        limit,
        includeArchived: input.includeArchived
      });
      return playbooks;
    },

    async saveProjectPlaybook(input) {
      await requireOwnedProjectMutation(dependencies, input.accountId, input.projectId);
      const now = dependencies.clock.now();
      const guidanceDigest = await digestInstructionBody(
        input.guidance,
        dependencies.hashPort
      );
      if (input.playbookId === undefined) {
        const playbook = createProjectPlaybook({
          projectId: input.projectId,
          id: playbookId(dependencies.ids.create("playbook")),
          version: 1,
          name: input.name,
          enabled: input.enabled,
          trigger: input.trigger,
          allowedContextClasses: input.allowedContextClasses,
          outputSchemaId: input.outputSchemaId,
          guidance: input.guidance,
          guidanceHash: instructionContentHash(guidanceDigest),
          createdAt: now,
          updatedAt: now
        });
        const outcome = await dependencies.playbooks.create(playbook);
        if (!outcome.ok) {
          throw new AgentGuidanceConflictError();
        }
        return outcome.playbook;
      }

      const existing = await dependencies.playbooks.get(input.playbookId);
      if (existing === undefined || existing.projectId !== input.projectId) {
        throw new AgentGuidanceNotFoundError();
      }
      if (existing.archivedAt !== undefined) {
        throw new AgentGuidanceConflictError();
      }
      const playbook = createProjectPlaybook({
        ...existing,
        version: existing.version + 1,
        name: input.name,
        enabled: input.enabled,
        trigger: input.trigger,
        allowedContextClasses: input.allowedContextClasses,
        outputSchemaId: input.outputSchemaId,
        guidance: input.guidance,
        guidanceHash: instructionContentHash(guidanceDigest),
        updatedAt: now
      });
      const outcome = await dependencies.playbooks.update(
        playbook,
        input.expectedVersion ?? existing.version
      );
      if (!outcome.ok) {
        if (outcome.reason === "not-found") {
          throw new AgentGuidanceNotFoundError();
        }
        throw new AgentGuidanceConflictError();
      }
      return outcome.playbook;
    },

    async archiveProjectPlaybook(input) {
      await requireOwnedProjectMutation(dependencies, input.accountId, input.projectId);
      const existing = await dependencies.playbooks.get(input.playbookId);
      if (existing === undefined || existing.projectId !== input.projectId) {
        throw new AgentGuidanceNotFoundError();
      }
      const now = dependencies.clock.now();
      const playbook = createProjectPlaybook({
        ...existing,
        version: existing.version + 1,
        enabled: false,
        updatedAt: now,
        archivedAt: now
      });
      const outcome = await dependencies.playbooks.update(playbook, input.expectedVersion);
      if (!outcome.ok) {
        if (outcome.reason === "not-found") {
          throw new AgentGuidanceNotFoundError();
        }
        throw new AgentGuidanceConflictError();
      }
      return outcome.playbook;
    }
  });
}
