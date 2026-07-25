import { aiDiagnostic } from "./diagnostics.js";
import type {
  CredentialValidationResult,
  CredentialValidatingProvider,
  ProviderFinishStatus,
  StructuredCompletionInput,
  StructuredCompletionResult,
  TokenUsage
} from "./types.js";

export type FakeProviderFailureMode = "completion" | "validation" | "credential";

export type FakeProviderFailure = {
  mode: FakeProviderFailureMode;
  code: import("./types.js").AiDiagnosticCode;
};

export type FakeProviderFixture<TOutput> = {
  output: TOutput;
  usage?: TokenUsage;
  providerResponseId?: string;
  providerModel?: string;
  finishStatus?: ProviderFinishStatus;
  delayMs?: number;
  failure?: FakeProviderFailure;
  credentialFailure?: FakeProviderFailure;
};

export type FakeProviderResolver<TOutput = unknown> =
  | FakeProviderFixture<TOutput>
  | ((
      input: StructuredCompletionInput<TOutput>
    ) => FakeProviderFixture<TOutput> | Promise<FakeProviderFixture<TOutput>>);

const DEFAULT_USAGE: TokenUsage = {
  inputTokens: 12,
  outputTokens: 34,
  totalTokens: 46
};

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function resolveFixture<TOutput>(
  resolver: FakeProviderResolver<TOutput>,
  input: StructuredCompletionInput<TOutput>
): Promise<FakeProviderFixture<TOutput>> {
  if (typeof resolver === "function") {
    return resolver(input);
  }
  return resolver;
}

export function createFakeStructuredCompletionProvider<TOutput = unknown>(
  resolver: FakeProviderResolver<TOutput>
): CredentialValidatingProvider {
  return {
    async validateCredential(signal?: AbortSignal): Promise<CredentialValidationResult> {
      const fixture = await resolveFixture(resolver, {
        workflow: "credential-check",
        model: "fake",
        instructions: "",
        inputText: "",
        outputSchema: { name: "noop", schema: { type: "object" } },
        maxOutputTokens: 1,
        maxDurationMs: 1,
        validateOutput: (_value): _value is TOutput => true
      });

      if (signal?.aborted) {
        return { ok: false, diagnostic: aiDiagnostic("cancelled") };
      }

      if (fixture.credentialFailure) {
        return { ok: false, diagnostic: aiDiagnostic(fixture.credentialFailure.code) };
      }
      if (fixture.failure?.mode === "credential") {
        return { ok: false, diagnostic: aiDiagnostic(fixture.failure.code) };
      }

      return { ok: true };
    },

    async completeStructured<TOut>(
      input: StructuredCompletionInput<TOut>
    ): Promise<StructuredCompletionResult<TOut>> {
      const fixture = await resolveFixture(
        resolver as unknown as FakeProviderResolver<TOut>,
        input
      );

      if (input.signal?.aborted) {
        return { ok: false, diagnostic: aiDiagnostic("cancelled") };
      }

      const failure = fixture.failure;
      if (failure?.mode === "completion") {
        return { ok: false, diagnostic: aiDiagnostic(failure.code) };
      }

      try {
        if (fixture.delayMs && fixture.delayMs > 0) {
          await sleep(fixture.delayMs, input.signal ?? new AbortController().signal);
        }
      } catch {
        return { ok: false, diagnostic: aiDiagnostic("cancelled") };
      }

      if (input.signal?.aborted) {
        return { ok: false, diagnostic: aiDiagnostic("cancelled") };
      }

      if (failure?.mode === "validation") {
        return { ok: false, diagnostic: aiDiagnostic(failure.code) };
      }

      if (!input.validateOutput(fixture.output as unknown)) {
        return { ok: false, diagnostic: aiDiagnostic("validation_failed") };
      }

      return {
        ok: true,
        output: fixture.output as TOut,
        usage: fixture.usage ?? DEFAULT_USAGE,
        providerResponseId: fixture.providerResponseId ?? "fake-resp-stable",
        providerModel: fixture.providerModel ?? input.model,
        finishStatus: fixture.finishStatus ?? "completed"
      };
    }
  };
}
