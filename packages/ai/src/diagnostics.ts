import type { AiDiagnostic, AiDiagnosticCode } from "./types.js";

const RETRYABLE: Readonly<Record<AiDiagnosticCode, boolean>> = {
  auth_failed: false,
  rate_limited: true,
  upstream_error: true,
  timeout: true,
  cancelled: false,
  invalid_structured_output: false,
  refusal: false,
  budget_exceeded: false,
  validation_failed: false
};

export function aiDiagnostic(code: AiDiagnosticCode): AiDiagnostic {
  return { code, retryable: RETRYABLE[code] };
}
