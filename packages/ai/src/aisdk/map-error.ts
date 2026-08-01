import { APICallError, NoObjectGeneratedError } from "ai";
import { aiDiagnostic } from "../diagnostics.js";
import type { CombinedAbort } from "../abort-timeout.js";
import type { AiDiagnostic } from "../types.js";

export function diagnosticFromHttpStatus(status: number): AiDiagnostic {
  if (status === 401 || status === 403) {
    return aiDiagnostic("auth_failed");
  }
  if (status === 429) {
    return aiDiagnostic("rate_limited");
  }
  return aiDiagnostic("upstream_error");
}

export function mapAiSdkError(
  error: unknown,
  combined: CombinedAbort,
  callerSignal: AbortSignal | undefined
): AiDiagnostic {
  const reason = combined.reason();
  if (reason === "timeout") {
    return aiDiagnostic("timeout");
  }
  if (reason === "caller" || callerSignal?.aborted) {
    return aiDiagnostic("cancelled");
  }
  if (error instanceof DOMException && error.name === "AbortError") {
    return aiDiagnostic("cancelled");
  }
  if (APICallError.isInstance(error)) {
    if (typeof error.statusCode === "number") {
      return diagnosticFromHttpStatus(error.statusCode);
    }
    return aiDiagnostic("upstream_error");
  }
  if (NoObjectGeneratedError.isInstance(error)) {
    return aiDiagnostic("invalid_structured_output");
  }
  return aiDiagnostic("upstream_error");
}
