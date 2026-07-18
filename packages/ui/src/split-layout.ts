export const SPLIT_RATIO_MIN = 0.28;
export const SPLIT_RATIO_MAX = 0.72;
export const SPLIT_RATIO_DEFAULT = 0.5;

export function clampSplitRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return SPLIT_RATIO_DEFAULT;
  return Math.min(SPLIT_RATIO_MAX, Math.max(SPLIT_RATIO_MIN, ratio));
}

export function splitStorageKey(projectId: string, accountId: string): string {
  return `ghostwriter:split-ratio:${accountId}:${projectId}`;
}

export function readStoredSplitRatio(
  projectId: string,
  accountId: string
): number | undefined {
  if (typeof globalThis.localStorage === "undefined") return undefined;
  const raw = globalThis.localStorage.getItem(
    splitStorageKey(projectId, accountId)
  );
  if (raw === null) return undefined;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? clampSplitRatio(parsed) : undefined;
}

export function writeStoredSplitRatio(
  projectId: string,
  accountId: string,
  ratio: number
): void {
  if (typeof globalThis.localStorage === "undefined") return;
  globalThis.localStorage.setItem(
    splitStorageKey(projectId, accountId),
    String(clampSplitRatio(ratio))
  );
}
