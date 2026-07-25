export const R2_OBJECT_STORAGE_CONFIG_ERROR =
  "R2 object storage configuration is invalid." as const;

const R2_ACCOUNT_ID_PATTERN = /^[0-9a-f]{32}$/;
const R2_BUCKET_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

function requireNonBlankTrimmed(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(R2_OBJECT_STORAGE_CONFIG_ERROR);
  }
  return trimmed;
}

export function parseValidatedR2AccountId(value: string): string {
  const trimmed = requireNonBlankTrimmed(value);
  const normalized = trimmed.toLowerCase();
  if (!R2_ACCOUNT_ID_PATTERN.test(normalized)) {
    throw new Error(R2_OBJECT_STORAGE_CONFIG_ERROR);
  }
  return normalized;
}

export function parseValidatedR2BucketName(value: string): string {
  const trimmed = requireNonBlankTrimmed(value);
  const normalized = trimmed.toLowerCase();
  if (
    normalized.length < 3 ||
    normalized.length > 63 ||
    !R2_BUCKET_NAME_PATTERN.test(normalized)
  ) {
    throw new Error(R2_OBJECT_STORAGE_CONFIG_ERROR);
  }
  return normalized;
}

export function parseValidatedR2Credential(value: string): string {
  return requireNonBlankTrimmed(value);
}

export function assertValidatedR2BucketName(bucketName: string): void {
  if (
    bucketName.length < 3 ||
    bucketName.length > 63 ||
    !R2_BUCKET_NAME_PATTERN.test(bucketName)
  ) {
    throw new Error(R2_OBJECT_STORAGE_CONFIG_ERROR);
  }
}
