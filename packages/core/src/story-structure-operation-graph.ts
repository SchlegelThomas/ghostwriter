import { DomainValidationError } from "./domain.js";
import type {
  StoryStructureDependency,
  StoryStructureOperation,
  StoryStructureOperationId
} from "./story-structure-proposal-v1.js";

export type StoryStructureSelectionValidation = Readonly<
  | { ok: true; requiredClosure: readonly StoryStructureOperationId[] }
  | {
      ok: false;
      code: "EMPTY_SELECTION" | "UNKNOWN_OPERATION" | "MISSING_REQUIREMENTS";
      missingRequired: readonly StoryStructureOperationId[];
    }
>;

function invalid(message: string): never {
  throw new DomainValidationError("INVALID_AGENT_OUTPUT", message);
}

function sortedUnique(ids: readonly StoryStructureOperationId[]): StoryStructureOperationId[] {
  return [...new Set(ids)].sort((left, right) => String(left).localeCompare(String(right)));
}

export function assertStoryStructureDependencyRecordsUnique(
  dependencies: readonly StoryStructureDependency[]
): void {
  const seen = new Set<StoryStructureOperationId>();
  for (const edge of dependencies) {
    if (seen.has(edge.operationId)) {
      invalid("Structure proposal dependency records must be unique per operation.");
    }
    seen.add(edge.operationId);
  }
}

export function assertStoryStructureDependenciesComplete(input: Readonly<{
  operations: readonly StoryStructureOperation[];
  dependencies: readonly StoryStructureDependency[];
}>): void {
  const operationIds = input.operations.map((operation) => operation.operationId);
  if (input.dependencies.length !== operationIds.length) {
    invalid("Structure proposal must include exactly one dependency record per operation.");
  }
  assertStoryStructureDependencyRecordsUnique(input.dependencies);
  const dependencyIds = new Set(input.dependencies.map((edge) => edge.operationId));
  for (const operationId of operationIds) {
    if (!dependencyIds.has(operationId)) {
      invalid("Structure proposal must include a dependency record for every operation.");
    }
  }
}

export function buildStoryStructureDependencyMap(
  dependencies: readonly StoryStructureDependency[]
): ReadonlyMap<StoryStructureOperationId, readonly StoryStructureOperationId[]> {
  assertStoryStructureDependencyRecordsUnique(dependencies);
  const map = new Map<StoryStructureOperationId, readonly StoryStructureOperationId[]>();
  for (const edge of dependencies) {
    map.set(edge.operationId, Object.freeze([...edge.requires]));
  }
  return map;
}

export function validateStoryStructureOperationGraph(input: Readonly<{
  operations: readonly StoryStructureOperation[];
  dependencies: readonly StoryStructureDependency[];
}>): void {
  const operationIds = input.operations.map((operation) => operation.operationId);
  if (operationIds.length === 0) {
    invalid("Structure proposals must include at least one operation.");
  }
  if (new Set(operationIds).size !== operationIds.length) {
    invalid("Structure proposal operation ids must be unique.");
  }
  assertStoryStructureDependenciesComplete(input);
  const known = new Set(operationIds);
  for (const edge of input.dependencies) {
    if (edge.requires.length > 32) {
      invalid("Structure proposal operation dependency list is out of bounds.");
    }
    const requires = new Set(edge.requires);
    if (requires.size !== edge.requires.length) {
      invalid("Structure proposal operation dependencies must be unique.");
    }
    for (const required of edge.requires) {
      if (!known.has(required)) {
        invalid("Structure proposal dependency requires an unknown operation.");
      }
      if (required === edge.operationId) {
        invalid("Structure proposal operations cannot depend on themselves.");
      }
    }
  }

  const adjacency = buildStoryStructureDependencyMap(input.dependencies);
  const visiting = new Set<StoryStructureOperationId>();
  const visited = new Set<StoryStructureOperationId>();

  const visit = (node: StoryStructureOperationId): void => {
    if (visited.has(node)) return;
    if (visiting.has(node)) {
      invalid("Structure proposal operation dependencies must not contain cycles.");
    }
    visiting.add(node);
    for (const required of adjacency.get(node) ?? []) {
      visit(required);
    }
    visiting.delete(node);
    visited.add(node);
  };

  for (const operationId of operationIds) {
    visit(operationId);
  }
}

export function computeStoryStructureRequiredClosure(
  selectedOperationIds: readonly StoryStructureOperationId[],
  dependencies: readonly StoryStructureDependency[]
): readonly StoryStructureOperationId[] {
  const dependencyMap = buildStoryStructureDependencyMap(dependencies);
  const closure = new Set<StoryStructureOperationId>();
  const stack = [...selectedOperationIds];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined || closure.has(current)) continue;
    closure.add(current);
    for (const required of dependencyMap.get(current) ?? []) {
      if (!closure.has(required)) stack.push(required);
    }
  }
  return Object.freeze(sortedUnique([...closure]));
}

export function validateStoryStructureOperationSelection(input: Readonly<{
  operations: readonly StoryStructureOperation[];
  dependencies: readonly StoryStructureDependency[];
  selectedOperationIds: readonly StoryStructureOperationId[];
}>): StoryStructureSelectionValidation {
  validateStoryStructureOperationGraph(input);
  if (input.selectedOperationIds.length === 0) {
    return Object.freeze({
      ok: false,
      code: "EMPTY_SELECTION",
      missingRequired: Object.freeze([])
    });
  }
  const known = new Set(input.operations.map((operation) => operation.operationId));
  for (const selected of input.selectedOperationIds) {
    if (!known.has(selected)) {
      return Object.freeze({
        ok: false,
        code: "UNKNOWN_OPERATION",
        missingRequired: Object.freeze([])
      });
    }
  }
  const selected = new Set(input.selectedOperationIds);
  const requiredClosure = computeStoryStructureRequiredClosure(
    input.selectedOperationIds,
    input.dependencies
  );
  const missingRequired = requiredClosure.filter((operationId) => !selected.has(operationId));
  if (missingRequired.length > 0) {
    return Object.freeze({
      ok: false,
      code: "MISSING_REQUIREMENTS",
      missingRequired: Object.freeze(sortedUnique(missingRequired))
    });
  }
  return Object.freeze({
    ok: true,
    requiredClosure
  });
}
