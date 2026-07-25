export class CaptureObjectStorageError extends Error {
  readonly code = "OBJECT_STORAGE_FAILURE" as const;

  constructor() {
    super("Capture object storage failed.");
    this.name = "CaptureObjectStorageError";
  }
}
