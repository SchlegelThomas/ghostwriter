# 0012: Multi-provider model registry and AI SDK adapters

- Status: accepted
- Date: 2026-07-26
- Plan: `plans/active/2026-07-26-multi-provider-models/plan.html`
- Related: ADR 0011 (BYOK, receipts, propose-only)

## Context

ADR 0011 made `packages/ai` provider-neutral with OpenAI BYOK first. Writers increasingly hold keys for Anthropic, Google, Groq, xAI, Mistral, DeepSeek, and aggregators. Ghostwriter needed many providers in Settings and the Agent dock without turning a third-party gateway into the product control plane, and without reusing ChatGPT/Claude browser OAuth.

## Decision

- Ghostwriter owns a **curated model catalog** (`packages/core` model catalog) with real upstream model ids, provider ids, and capability flags (`supportsChat`, `supportsTools`, `supportsStructured`, `supportsImage`).
- **Available models** for an account are catalog entries whose provider has a non-revoked encrypted BYOK credential. Settings and the Agent dock show only available models. Agent mode further requires `supportsTools`.
- Writer credentials are stored **one envelope per `(account, provider)`** under the existing KEK AES-GCM custody from ADR 0011.
- Live adapters live in `packages/ai` and use the open-source **Vercel AI SDK npm packages** (`ai`, `@ai-sdk/*`) inside the Fly Node backend. This is not Vercel hosting and not Vercel AI Gateway as the BYOK store. Keys decrypt only in the backend adapter immediately before an authorized call; Ghostwriter calls providers directly.
- First-wave providers: OpenAI, Anthropic, Google Gemini. Second-wave: Groq, xAI, Mistral, DeepSeek, and optional OpenRouter (OpenAI-compatible). Image generation selects catalog models with `supportsImage` (initially OpenAI image models).
- Luna/Terra/Sol Ghostwriter aliases are retired as stored model identity; effort remains Fast/Standard/High posture mapped per call.
- Self-hosted LiteLLM (or other Python/OpenAI-compat proxies) is **not** the default control plane. Revisit only if Ghostwriter later needs a shared OpenAI-compatible org gateway for external CLI/MCP clients.

## Options considered

- **Self-host LiteLLM as default gateway** — rejected for v1: Python sidecar, hop, and ops burden fight the Node/Fly BYOK shape; product policy must stay in Ghostwriter.
- **OpenRouter as sole upstream** — rejected: fee/privacy hop and wrong tenancy for per-writer direct keys; allowed only as an optional named provider.
- **Vercel AI Gateway hosted BYOK** — rejected as the credential plane: team-scoped gateway keys are not Ghostwriter’s per-writer KEK model. AI SDK *packages* are still used in-process.
- **Keep OpenAI-only + hard-coded gpt-5.6-* aliases** — rejected by product direction for multi-provider real model ids.

## Consequences

- Settings, available-models API, Agent dock, and image jobs must stay catalog-driven.
- Adapter variance (tools, structured output, image APIs) is gated by catalog flags and hermetic fake providers in CI.
- ADR 0011 propose-only, receipt, and credential non-disclosure rules remain in force for every provider.
- Pin AI SDK dependency versions; keep Ghostwriter ports stable so SDK churn stays inside adapters.
}