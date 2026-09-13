import { canonicalJsonStringify } from "./agent-canonical-json.js";
import type { InstructionContentHash } from "./agent-domain.js";
import { ProjectArchivedMutationError } from "./capture-documents.js";
import { StoryWorkAssignmentNotFoundError } from "./character-story-work-services.js";
import type { ProjectId } from "./domain.js";
import {
  ProjectAccessDeniedError,
  requireProjectOwner,
  type AccountId
} from "./identity.js";
import type { ProjectRepository } from "./project-repository.js";
import type { StoryWorkAssignmentRepository } from "./story-work-assignment-repository.js";
import {
  createStoryWorkAssignment,
  storyWorkAssignmentRequestFingerprint,
  type StoryWorkAssignment,
  type StoryWorkAssignmentId
} from "./story-work-assignment.js";
import type { StoryWorkCoordinationRepository } from "./story-work-coordination-repository.js";
import {
  bindProposalContinuityCheckStep,
  createStoryWorkCoordination,
  projectStoryWorkCoordination,
  storyWorkCoordinationRequestFingerprint,
  StoryWorkCoordinationTransitionError,
  validateStoryWorkCoordinationChildAssignments,
  type ProposalContinuityCheckCoordinationStep,
  type SceneDraftCoordinationStep,
  type StoryWorkCoordination,
  type StoryWorkCoordinationChildAssignmentMap,
  type StoryWorkCoordinationId,
  type StoryWorkCoordinationStepBinding,
  type StoryWorkCoordinationStepId
} from "./story-work-coordination.js";
import type {
  BindProposalContinuityCheckInput,
  CreateStoryWorkCoordinationInput,
  FindStoryWorkCoordinationBindReplayInput,
  FindStoryWorkCoordinationCreateReplayInput,
  StoryWorkCoordinationBindResult,
  StoryWorkCoordinationCreateResult
} from "./story-work-coordination-uow.js";
import {
  StoryWorkCoordinationBindIdempotencyConflictError,
  StoryWorkCoordinationCreateIdempotencyConflictError,
  StoryWorkCoordinationDependencyConflictError
} from "./story-work-coordination-uow.js";

export type StoryWorkCoordinationRepositoryFailurePoint =
  | "after-root-assignment"
  | "after-check-assignment";

export type StoryWorkCoordinationRepositoryDependencies = Readonly<{
  projects: ProjectRepository;
  assignments: StoryWorkAssignmentRepository;
  coordinations: StoryWorkCoordinationRepository;
  failAfter?: StoryWorkCoordinationRepositoryFailurePoint;
}>;

export interface StoryWorkCoordinationRepositoryExecutor {
  findCreateReplay(
    input: FindStoryWorkCoordinationCreateReplayInput
  ): Promise<StoryWorkCoordinationCreateResult | undefined>;
  create(input: CreateStoryWorkCoordinationInput): Promise<StoryWorkCoordinationCreateResult>;
  findBindReplay(
    input: FindStoryWorkCoordinationBindReplayInput
  ): Promise<StoryWorkCoordinationBindResult | undefined>;
  bindProposalContinuityCheck(
    input: BindProposalContinuityCheckInput
  ): Promise<StoryWorkCoordinationBindResult>;
}

function exact(left: unknown, right: unknown): boolean {
  return canonicalJsonStringify(left) === canonicalJsonStringify(right);
}

function artifactPointerEquals(
  left: Readonly<{ proposalId: string; artifactVersion: number; contentHash: string }>,
  right: Readonly<{ proposalId: string; artifactVersion: number; contentHash: string }>
): boolean {
  return (
    left.proposalId === right.proposalId &&
    left.artifactVersion === right.artifactVersion &&
    left.contentHash === right.contentHash
  );
}

function sceneDraftRoot(
  coordination: StoryWorkCoordination
): SceneDraftCoordinationStep {
  const step = coordination.steps.find(
    (candidate): candidate is SceneDraftCoordinationStep => candidate.kind === "scene-draft"
  );
  if (step === undefined) {
    throw new StoryWorkCoordinationDependencyConflictError(
      "Story work coordination is missing its scene-draft root step."
    );
  }
  return step;
}

function checkStep(
  coordination: StoryWorkCoordination,
  stepId: StoryWorkCoordinationStepId
): ProposalContinuityCheckCoordinationStep {
  const step = coordination.steps.find((candidate) => candidate.stepId === stepId);
  if (step === undefined || step.kind !== "proposal-continuity-check") {
    throw new StoryWorkAssignmentNotFoundError();
  }
  return step;
}

function childMap(
  ...assignments: readonly StoryWorkAssignment[]
): StoryWorkCoordinationChildAssignmentMap {
  return new Map(assignments.map((assignment) => [assignment.id, assignment]));
}

function buildProjection(input: Readonly<{
  coordination: StoryWorkCoordination;
  rootAssignment: StoryWorkAssignment;
  checkAssignment?: StoryWorkAssignment;
}>) {
  const children =
    input.checkAssignment === undefined
      ? childMap(input.rootAssignment)
      : childMap(input.rootAssignment, input.checkAssignment);
  validateStoryWorkCoordinationChildAssignments({
    coordination: input.coordination,
    childAssignments: children
  });
  return projectStoryWorkCoordination({
    coordination: input.coordination,
    childAssignments: children
  });
}

function createCreateResult(input: Readonly<{
  replayed: boolean;
  coordination: StoryWorkCoordination;
  rootAssignment: StoryWorkAssignment;
}>): StoryWorkCoordinationCreateResult {
  return Object.freeze({
    replayed: input.replayed,
    coordination: input.coordination,
    projection: buildProjection(input),
    rootAssignment: input.rootAssignment
  });
}

function createBindResult(input: Readonly<{
  replayed: boolean;
  coordination: StoryWorkCoordination;
  rootAssignment: StoryWorkAssignment;
  checkAssignment: StoryWorkAssignment;
}>): StoryWorkCoordinationBindResult {
  return Object.freeze({
    replayed: input.replayed,
    coordination: input.coordination,
    projection: buildProjection(input),
    rootAssignment: input.rootAssignment,
    checkAssignment: input.checkAssignment
  });
}

function createIdempotencyConflict(message?: string): never {
  throw new StoryWorkCoordinationCreateIdempotencyConflictError(message);
}

function bindIdempotencyConflict(message?: string): never {
  throw new StoryWorkCoordinationBindIdempotencyConflictError(message);
}

function dependencyConflict(message?: string): never {
  throw new StoryWorkCoordinationDependencyConflictError(message);
}

function transitionConflict(message?: string): never {
  throw new StoryWorkCoordinationTransitionError(message);
}

function failAt(
  expected: StoryWorkCoordinationRepositoryDependencies["failAfter"],
  actual: StoryWorkCoordinationRepositoryFailurePoint
): void {
  if (expected === actual) {
    throw new Error(`Injected story work coordination failure ${actual}.`);
  }
}

async function requireActiveProject(
  dependencies: StoryWorkCoordinationRepositoryDependencies,
  input: Readonly<{ accountId: AccountId; projectId: ProjectId }>,
  forMutation: boolean
): Promise<void> {
  try {
    requireProjectOwner(
      input.projectId,
      await dependencies.projects.getProjectMembership(input.projectId, input.accountId)
    );
  } catch (error) {
    if (error instanceof ProjectAccessDeniedError) {
      throw new StoryWorkAssignmentNotFoundError();
    }
    throw error;
  }
  if (!forMutation) return;
  const project = await dependencies.projects.getProject(input.projectId);
  if (project?.archivedAt !== undefined) {
    throw new ProjectArchivedMutationError();
  }
}

async function requireCoordination(
  dependencies: StoryWorkCoordinationRepositoryDependencies,
  input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
    coordinationId: StoryWorkCoordinationId;
  }>
): Promise<StoryWorkCoordination> {
  await requireActiveProject(dependencies, input, false);
  const coordination = await dependencies.coordinations.get(input);
  if (coordination === undefined) {
    throw new StoryWorkAssignmentNotFoundError();
  }
  return coordination;
}

async function requireRootAssignment(
  dependencies: StoryWorkCoordinationRepositoryDependencies,
  input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
    assignmentId: StoryWorkAssignmentId;
  }>
): Promise<StoryWorkAssignment> {
  const assignment = await dependencies.assignments.get(input);
  if (assignment === undefined) {
    throw new StoryWorkAssignmentNotFoundError();
  }
  return assignment;
}

function assertCreateCoordinationShape(coordination: StoryWorkCoordination): void {
  if (coordination.version !== 1 || coordination.status !== "active") {
    dependencyConflict("Fresh coordinations must start active at version one.");
  }
  for (const step of coordination.steps) {
    if (step.kind === "proposal-continuity-check" && step.binding !== undefined) {
      dependencyConflict("Fresh coordinations cannot include bound continuity-check steps.");
    }
  }
}

function assertCheckAssignmentMatchesDeferred(
  step: ProposalContinuityCheckCoordinationStep,
  checkAssignment: StoryWorkAssignment
): void {
  if (
    checkAssignment.brief !== step.deferred.brief ||
    checkAssignment.constraints !== step.deferred.constraints ||
    checkAssignment.doneWhen !== step.deferred.doneWhen ||
    checkAssignment.model !== step.deferred.model
  ) {
    dependencyConflict(
      "Continuity-check assignment must match the deferred coordination configuration."
    );
  }
  const deferredScenes = step.deferred.surroundingSceneIds ?? [];
  const sceneSources = checkAssignment.sources.filter(
    (source): source is Extract<(typeof checkAssignment.sources)[number], { kind: "scene" }> =>
      source.kind === "scene"
  );
  if (sceneSources.length !== deferredScenes.length) {
    dependencyConflict(
      "Continuity-check assignment must match the deferred coordination configuration."
    );
  }
  for (const sceneId of deferredScenes) {
    if (!sceneSources.some((source) => source.sceneId === sceneId)) {
      dependencyConflict(
        "Continuity-check assignment must match the deferred coordination configuration."
      );
    }
  }
}

function assertRootAssignmentReady(
  coordination: StoryWorkCoordination,
  rootStep: SceneDraftCoordinationStep,
  rootAssignment: StoryWorkAssignment,
  input: Readonly<{ accountId: AccountId; projectId: ProjectId }>
): void {
  if (
    rootAssignment.id !== rootStep.assignmentId ||
    rootAssignment.projectId !== input.projectId ||
    rootAssignment.initiatorAccountId !== input.accountId ||
    coordination.projectId !== input.projectId ||
    coordination.initiatorAccountId !== input.accountId
  ) {
    dependencyConflict("Root scene assignment does not match the coordination scope.");
  }
  if (rootAssignment.status !== "brief-ready") {
    dependencyConflict("Root scene assignment must be brief-ready.");
  }
}

function bindingMatchesInput(
  binding: StoryWorkCoordinationStepBinding,
  input: FindStoryWorkCoordinationBindReplayInput,
  checkAssignmentId: StoryWorkAssignmentId
): boolean {
  return (
    binding.assignmentId === checkAssignmentId &&
    binding.resolvedDependency.stepId === input.resolvedDependency.stepId &&
    artifactPointerEquals(binding.resolvedDependency.artifact, input.resolvedDependency.artifact)
  );
}

export function matchesStoryWorkCoordinationCreateReplay(input: Readonly<{
  coordinationRequestFingerprint: InstructionContentHash;
  rootAssignmentRequestFingerprint: InstructionContentHash;
  coordination: StoryWorkCoordination;
  rootAssignment: StoryWorkAssignment;
  storedCoordinationFingerprint: InstructionContentHash;
  storedRootFingerprint: InstructionContentHash;
}>): boolean {
  return (
    storyWorkCoordinationRequestFingerprint(input.coordinationRequestFingerprint) ===
      storyWorkCoordinationRequestFingerprint(input.storedCoordinationFingerprint) &&
    storyWorkAssignmentRequestFingerprint(String(input.rootAssignmentRequestFingerprint)) ===
      storyWorkAssignmentRequestFingerprint(String(input.storedRootFingerprint)) &&
    exact(createStoryWorkCoordination(input.coordination), input.coordination) &&
    exact(createStoryWorkAssignment(input.rootAssignment), input.rootAssignment)
  );
}

export function matchesStoryWorkCoordinationBindReplay(input: Readonly<{
  bind: FindStoryWorkCoordinationBindReplayInput;
  coordination: StoryWorkCoordination;
  step: ProposalContinuityCheckCoordinationStep;
  checkAssignment: StoryWorkAssignment;
  boundAt: string;
}>): boolean {
  if (input.coordination.version !== input.bind.expectedCoordinationVersion + 1) {
    return false;
  }
  if (input.coordination.status !== "active") return false;
  const binding = input.step.binding;
  if (binding === undefined) return false;
  if (
    !bindingMatchesInput(binding, input.bind, input.checkAssignment.id) ||
    binding.boundAt !== input.boundAt
  ) {
    return false;
  }
  return exact(
    createStoryWorkAssignment(input.checkAssignment),
    input.checkAssignment
  );
}

async function loadCreateReplay(
  dependencies: StoryWorkCoordinationRepositoryDependencies,
  input: FindStoryWorkCoordinationCreateReplayInput
): Promise<StoryWorkCoordinationCreateResult | undefined> {
  await requireActiveProject(dependencies, input, false);
  const stored = await dependencies.coordinations.getByIdempotencyKey({
    accountId: input.accountId,
    projectId: input.projectId,
    idempotencyKey: input.idempotencyKey
  });
  if (stored === undefined) return undefined;
  const coordination = stored.coordination;
  const rootStep = sceneDraftRoot(coordination);
  const rootAssignment = await requireRootAssignment(dependencies, {
    accountId: input.accountId,
    projectId: input.projectId,
    assignmentId: rootStep.assignmentId
  });
  const rootRecord = await dependencies.assignments.getByIdempotencyKey({
    accountId: input.accountId,
    projectId: input.projectId,
    idempotencyKey: rootAssignment.idempotencyKey
  });
  if (rootRecord === undefined) {
    throw new StoryWorkAssignmentNotFoundError();
  }
  if (
    storyWorkCoordinationRequestFingerprint(input.coordinationRequestFingerprint) !==
    storyWorkCoordinationRequestFingerprint(stored.requestFingerprint)
  ) {
    createIdempotencyConflict();
  }
  validateStoryWorkCoordinationChildAssignments({
    coordination,
    childAssignments: childMap(rootAssignment)
  });
  return createCreateResult({
    replayed: true,
    coordination,
    rootAssignment
  });
}

function evaluateBindReplayState(
  input: FindStoryWorkCoordinationBindReplayInput,
  coordination: StoryWorkCoordination,
  step: ProposalContinuityCheckCoordinationStep
): "pending" | "replay" | "conflict" {
  if (coordination.status === "canceled") {
    dependencyConflict("Canceled coordinations cannot bind continuity-check steps.");
  }
  if (coordination.version === input.expectedCoordinationVersion) {
    if (step.binding !== undefined) {
      transitionConflict("Continuity-check step binding already exists at the expected version.");
    }
    return "pending";
  }
  if (coordination.version === input.expectedCoordinationVersion + 1) {
    if (step.binding === undefined) {
      transitionConflict();
    }
    const binding = step.binding;
    if (
      binding.resolvedDependency.stepId !== input.resolvedDependency.stepId ||
      !artifactPointerEquals(
        binding.resolvedDependency.artifact,
        input.resolvedDependency.artifact
      )
    ) {
      dependencyConflict("Continuity-check binding does not match the requested dependency.");
    }
    return "replay";
  }
  transitionConflict();
}

async function loadBindReplay(
  dependencies: StoryWorkCoordinationRepositoryDependencies,
  input: FindStoryWorkCoordinationBindReplayInput
): Promise<StoryWorkCoordinationBindResult | undefined> {
  const coordination = await requireCoordination(dependencies, input);
  const step = checkStep(coordination, input.stepId);
  const state = evaluateBindReplayState(input, coordination, step);
  if (state === "pending") return undefined;
  const rootStep = sceneDraftRoot(coordination);
  const rootAssignment = await requireRootAssignment(dependencies, {
    accountId: input.accountId,
    projectId: input.projectId,
    assignmentId: rootStep.assignmentId
  });
  const binding = step.binding!;
  const checkAssignment = await requireRootAssignment(dependencies, {
    accountId: input.accountId,
    projectId: input.projectId,
    assignmentId: binding.assignmentId
  });
  return createBindResult({
    replayed: true,
    coordination,
    rootAssignment,
    checkAssignment
  });
}

export function createRepositoryStoryWorkCoordinationExecutor(
  dependencies: StoryWorkCoordinationRepositoryDependencies
): StoryWorkCoordinationRepositoryExecutor {
  return Object.freeze({
    findCreateReplay(input: FindStoryWorkCoordinationCreateReplayInput) {
      return loadCreateReplay(dependencies, input);
    },

    async create(input: CreateStoryWorkCoordinationInput) {
      await requireActiveProject(dependencies, input, true);
      const replay = await loadCreateReplay(dependencies, {
        accountId: input.accountId,
        projectId: input.projectId,
        idempotencyKey: input.coordination.idempotencyKey,
        coordinationRequestFingerprint: input.coordinationRequestFingerprint
      });
      if (replay !== undefined) {
        const [storedCoordination, rootRecord] = await Promise.all([
          dependencies.coordinations.getByIdempotencyKey({
            accountId: input.accountId,
            projectId: input.projectId,
            idempotencyKey: input.coordination.idempotencyKey
          }),
          dependencies.assignments.getByIdempotencyKey({
            accountId: input.accountId,
            projectId: input.projectId,
            idempotencyKey: replay.rootAssignment.idempotencyKey
          })
        ]);
        if (storedCoordination === undefined || rootRecord === undefined) {
          throw new StoryWorkAssignmentNotFoundError();
        }
        if (
          storyWorkCoordinationRequestFingerprint(input.coordinationRequestFingerprint) !==
            storyWorkCoordinationRequestFingerprint(storedCoordination.requestFingerprint) ||
          storyWorkAssignmentRequestFingerprint(
            String(input.rootAssignmentRequestFingerprint)
          ) !==
            storyWorkAssignmentRequestFingerprint(String(rootRecord.requestFingerprint)) ||
          !exact(replay.coordination, createStoryWorkCoordination(input.coordination)) ||
          !exact(replay.rootAssignment, createStoryWorkAssignment(input.rootAssignment))
        ) {
          createIdempotencyConflict();
        }
        return replay;
      }

      const coordination = createStoryWorkCoordination(input.coordination);
      const rootAssignment = createStoryWorkAssignment(input.rootAssignment);
      const rootStep = sceneDraftRoot(coordination);
      assertCreateCoordinationShape(coordination);
      assertRootAssignmentReady(coordination, rootStep, rootAssignment, input);

      const coordinationFingerprint = storyWorkCoordinationRequestFingerprint(
        input.coordinationRequestFingerprint
      );
      const rootFingerprint = storyWorkAssignmentRequestFingerprint(
        String(input.rootAssignmentRequestFingerprint)
      );

      const existingRoot = await dependencies.assignments.getByIdempotencyKey({
        accountId: input.accountId,
        projectId: input.projectId,
        idempotencyKey: rootAssignment.idempotencyKey
      });
      if (existingRoot !== undefined) {
        if (
          storyWorkAssignmentRequestFingerprint(String(existingRoot.requestFingerprint)) !==
          rootFingerprint
        ) {
          createIdempotencyConflict();
        }
        if (!exact(existingRoot.assignment, rootAssignment)) {
          createIdempotencyConflict();
        }
      }

      const rootOutcome = await dependencies.assignments.create({
        assignment: rootAssignment,
        requestFingerprint: rootFingerprint
      });
      if (!rootOutcome.ok) {
        if (rootOutcome.reason === "idempotency-conflict") createIdempotencyConflict();
        createIdempotencyConflict("Root scene assignment identifier collided.");
      }
      failAt(dependencies.failAfter, "after-root-assignment");

      const coordinationOutcome = await dependencies.coordinations.create({
        coordination,
        requestFingerprint: coordinationFingerprint
      });
      if (!coordinationOutcome.ok) {
        if (coordinationOutcome.reason === "idempotency-conflict") {
          createIdempotencyConflict();
        }
        createIdempotencyConflict("Story work coordination identifier collided.");
      }

      return createCreateResult({
        replayed: coordinationOutcome.created === false,
        coordination: coordinationOutcome.coordination,
        rootAssignment: rootOutcome.assignment
      });
    },

    findBindReplay(input: FindStoryWorkCoordinationBindReplayInput) {
      return loadBindReplay(dependencies, input);
    },

    async bindProposalContinuityCheck(input: BindProposalContinuityCheckInput) {
      await requireActiveProject(dependencies, input, true);
      const boundReplay = await loadBindReplay(dependencies, input);
      if (boundReplay !== undefined) {
        const boundStep = checkStep(boundReplay.coordination, input.stepId);
        if (
          !exact(boundReplay.checkAssignment, createStoryWorkAssignment(input.checkAssignment)) ||
          boundStep.binding?.boundAt !== input.boundAt
        ) {
          bindIdempotencyConflict();
        }
        return boundReplay;
      }

      const coordination = await requireCoordination(dependencies, input);
      if (coordination.status === "canceled") {
        dependencyConflict("Canceled coordinations cannot bind continuity-check steps.");
      }
      if (coordination.version !== input.expectedCoordinationVersion) {
        transitionConflict();
      }
      const step = checkStep(coordination, input.stepId);
      if (step.binding !== undefined) {
        transitionConflict("Continuity-check step binding already exists.");
      }

      const rootStep = sceneDraftRoot(coordination);
      const rootAssignment = await requireRootAssignment(dependencies, {
        accountId: input.accountId,
        projectId: input.projectId,
        assignmentId: rootStep.assignmentId
      });
      const projection = projectStoryWorkCoordination({
        coordination,
        childAssignments: childMap(rootAssignment)
      });
      const stepProjection = projection.steps.find(
        (candidate) => candidate.stepId === input.stepId
      );
      if (
        stepProjection === undefined ||
        stepProjection.state !== "ready" ||
        stepProjection.resolvedDependency === undefined ||
        stepProjection.resolvedDependency.stepId !== input.resolvedDependency.stepId ||
        !artifactPointerEquals(
          stepProjection.resolvedDependency.artifact,
          input.resolvedDependency.artifact
        )
      ) {
        dependencyConflict();
      }

      const checkAssignment = createStoryWorkAssignment(input.checkAssignment);
      if (checkAssignment.status !== "brief-ready" || checkAssignment.taskKind !== "check") {
        dependencyConflict("Continuity-check assignment must be a brief-ready check task.");
      }
      assertCheckAssignmentMatchesDeferred(step, checkAssignment);
      const checkFingerprint = storyWorkAssignmentRequestFingerprint(
        String(input.checkAssignmentRequestFingerprint)
      );

      const existingCheck = await dependencies.assignments.getByIdempotencyKey({
        accountId: input.accountId,
        projectId: input.projectId,
        idempotencyKey: checkAssignment.idempotencyKey
      });
      if (existingCheck !== undefined) {
        if (
          storyWorkAssignmentRequestFingerprint(String(existingCheck.requestFingerprint)) !==
          checkFingerprint
        ) {
          bindIdempotencyConflict();
        }
        if (!exact(existingCheck.assignment, checkAssignment)) {
          bindIdempotencyConflict();
        }
      }

      const binding: StoryWorkCoordinationStepBinding = Object.freeze({
        assignmentId: checkAssignment.id,
        resolvedDependency: Object.freeze({
          stepId: input.resolvedDependency.stepId,
          artifact: input.resolvedDependency.artifact
        }),
        boundAt: input.boundAt
      });

      const tentativeChildren = childMap(rootAssignment, checkAssignment);
      try {
        validateStoryWorkCoordinationChildAssignments({
          coordination: bindProposalContinuityCheckStep({
            coordination,
            expectedVersion: input.expectedCoordinationVersion,
            stepId: input.stepId,
            binding,
            childAssignments: tentativeChildren,
            updatedAt: input.boundAt
          }),
          childAssignments: tentativeChildren
        });
      } catch {
        dependencyConflict(
          "Continuity-check assignment does not match the deferred coordination configuration."
        );
      }

      const checkOutcome = await dependencies.assignments.create({
        assignment: checkAssignment,
        requestFingerprint: checkFingerprint
      });
      if (!checkOutcome.ok) {
        if (checkOutcome.reason === "idempotency-conflict") bindIdempotencyConflict();
        bindIdempotencyConflict("Continuity-check assignment identifier collided.");
      }
      failAt(dependencies.failAfter, "after-check-assignment");

      const nextCoordination = bindProposalContinuityCheckStep({
        coordination,
        expectedVersion: input.expectedCoordinationVersion,
        stepId: input.stepId,
        binding,
        childAssignments: childMap(rootAssignment, checkOutcome.assignment),
        updatedAt: input.boundAt
      });
      const cas = await dependencies.coordinations.compareAndSet({
        accountId: input.accountId,
        projectId: input.projectId,
        coordinationId: coordination.id,
        expectedVersion: input.expectedCoordinationVersion,
        next: nextCoordination
      });
      if (!cas.ok) {
        if (cas.reason === "not-found") throw new StoryWorkAssignmentNotFoundError();
        const raced = await loadBindReplay(dependencies, input);
        if (raced !== undefined) {
          if (
            exact(raced.checkAssignment, checkAssignment) &&
            raced.coordination.steps.find((candidate) => candidate.stepId === input.stepId)
              ?.kind === "proposal-continuity-check" &&
            (
              raced.coordination.steps.find(
                (candidate) => candidate.stepId === input.stepId
              ) as ProposalContinuityCheckCoordinationStep
            ).binding?.boundAt === input.boundAt
          ) {
            return raced;
          }
        }
        transitionConflict();
      }

      return createBindResult({
        replayed: false,
        coordination: cas.coordination,
        rootAssignment,
        checkAssignment: checkOutcome.assignment
      });
    }
  });
}
