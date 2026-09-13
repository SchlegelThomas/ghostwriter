import type { SceneDocumentV1 } from "@ghostwriter/editor";
import type { SceneLeaseResponse, SceneWorkspaceResponse } from "./api.js";
import type { SceneRecoveryCoordinator } from "./scene-recovery.js";
import type { SceneSaveQueue } from "./scene-save-queue.js";

export type DraftStoryWorkBoundaryFailure =
  | "draft-dirty"
  | "lease-unavailable"
  | "recovery-pending"
  | "scope-changed";

export class DraftStoryWorkBoundaryError extends Error {
  readonly code: DraftStoryWorkBoundaryFailure;

  constructor(code: DraftStoryWorkBoundaryFailure, message: string) {
    super(message);
    this.name = "DraftStoryWorkBoundaryError";
    this.code = code;
  }
}

export function isCurrentStoryWorkLease(
  lease: SceneLeaseResponse | null | undefined,
  now = Date.now()
): lease is SceneLeaseResponse {
  const expiresAt = lease === null || lease === undefined
    ? Number.NaN
    : Date.parse(lease.expiresAt);
  return (
    lease?.heldByCurrentSession === true &&
    Number.isFinite(expiresAt) &&
    expiresAt > now
  );
}

function requireCurrentScope(isCurrent: () => boolean): void {
  if (!isCurrent()) {
    throw new DraftStoryWorkBoundaryError(
      "scope-changed",
      "This Draft is no longer open."
    );
  }
}

function requireCurrentLease(
  currentLease: () => SceneLeaseResponse | null | undefined,
  now: () => number
): void {
  if (!isCurrentStoryWorkLease(currentLease(), now())) {
    throw new DraftStoryWorkBoundaryError(
      "lease-unavailable",
      "This Draft no longer has a current editing lease."
    );
  }
}

function requireClean(queue: SceneSaveQueue): void {
  if (queue.getSnapshot().dirty) {
    throw new DraftStoryWorkBoundaryError(
      "draft-dirty",
      "Save the latest Draft before applying story work."
    );
  }
}

export async function prepareDraftStoryWorkBoundary(input: Readonly<{
  queue: SceneSaveQueue;
  recovery?: SceneRecoveryCoordinator;
  unresolvedRecovery: boolean;
  currentLease(): SceneLeaseResponse | null | undefined;
  isCurrent(): boolean;
  now?(): number;
  hashDocument(document: SceneDocumentV1): Promise<string>;
}>): Promise<Readonly<{
  expectedWorkingVersion: number;
  expectedContentHash: string;
}>> {
  const now = input.now ?? Date.now;
  if (input.unresolvedRecovery) {
    throw new DraftStoryWorkBoundaryError(
      "recovery-pending",
      "Recover or discard local Draft recovery before applying reviewed scene work."
    );
  }
  requireCurrentScope(input.isCurrent);
  requireCurrentLease(input.currentLease, now);

  await input.recovery?.flush();
  await input.queue.flush();
  await input.recovery?.flush();
  requireCurrentScope(input.isCurrent);
  requireCurrentLease(input.currentLease, now);
  requireClean(input.queue);

  input.queue.pause();
  try {
    const snapshot = input.queue.getSnapshot();
    const expectedContentHash = await input.hashDocument(
      snapshot.acknowledgedDocument
    );
    requireCurrentScope(input.isCurrent);
    requireCurrentLease(input.currentLease, now);
    requireClean(input.queue);
    return {
      expectedWorkingVersion: snapshot.acknowledgedWorkingVersion,
      expectedContentHash
    };
  } catch (cause) {
    if (
      input.isCurrent() &&
      isCurrentStoryWorkLease(input.currentLease(), now()) &&
      input.queue.getSnapshot().status === "paused"
    ) {
      input.queue.resume();
    }
    throw cause;
  }
}

export async function refreshDraftStoryWorkBoundary(input: Readonly<{
  queue: SceneSaveQueue;
  recovery?: SceneRecoveryCoordinator;
  isCurrent(): boolean;
  loadWorkspace(): Promise<SceneWorkspaceResponse>;
}>): Promise<SceneWorkspaceResponse> {
  requireCurrentScope(input.isCurrent);
  const workspace = await input.loadWorkspace();
  requireCurrentScope(input.isCurrent);

  // A capture may still be persisting and has not necessarily enqueued yet.
  await input.recovery?.flush();
  requireCurrentScope(input.isCurrent);
  requireClean(input.queue);

  input.queue.installAcknowledgement(workspace.head, false);
  await input.recovery?.discard();
  requireCurrentScope(input.isCurrent);
  return workspace;
}
