# 0011: BYOK, context receipts, proposals, playbooks, and MCP grants

- Status: accepted
- Date: 2026-07-24
- Plan: `plans/active/2026-07-24-capture-to-story-agents/plan.html`
- Related: ADR 0002 (server authority), ADR 0005 (identity), ADR 0006 (revisions), ADR 0009 writing craft and assist, ADR 0010 (Capture and promotion)

## Context

ADR 0009 proves deterministic, human-applied writing-assist proposals, but its endpoint trusts
client-assembled context, keeps proposals only in UI state, and records no provider or context
receipt. Ghostwriter's first real agents need provider access, durable noncanonical results,
revision-bound apply, optional writer guidance, and MCP parity without turning raw instructions or
model output into authority.

Current OpenAI and Anthropic model APIs do not expose a documented consumer delegated OAuth flow
that a third-party Ghostwriter web app can use for ordinary model API billing. ChatGPT/Codex and
Claude/CLI browser logins are first-party product flows; OpenAI Apps OAuth authenticates ChatGPT to
an external service, and Anthropic workload identity federation authenticates managed workloads.

## Decision

### Provider and credential posture

- `packages/ai` defines provider-neutral structured-completion, streaming/cancellation, usage, and
  content-free diagnostic ports. OpenAI is the first live adapter; required CI uses a deterministic
  fake provider.
- Writers bring their own OpenAI API key. Ghostwriter must not reuse undocumented first-party OAuth
  tokens. A future official delegated flow may replace key entry behind the provider port.
- A writer key is encrypted in Lakebase with AES-256-GCM and a random nonce. The record stores
  provider, ciphertext, authentication data, masked hint, validation state, timestamps, and a key
  encryption-key version. The plaintext is never returned after storage.
- Versioned root key-encryption keys live only as Fly secrets. Decryption occurs only in the backend
  provider adapter immediately before an authorized call. Provider keys never enter prompts,
  receipts, MCP, exports, logs, errors, or client state.
- Backend operators with Fly secret and database access can technically decrypt writer keys. This is
  encrypted backend custody, not end-to-end encryption.
- On suspected root-key compromise, Ghostwriter revokes the affected root key, deletes unusable
  credential envelopes, disables provider calls, requires affected writers to enter a new key, and
  notifies them. Rotation supports overlapping key versions while safe envelopes are rewrapped.

### Progressive setup and data separation

- Capture and deterministic promotion work without AI. Provider setup appears only when a writer
  first requests agent help and remains skippable.
- AI collaboration preferences are separate from the publishing profile. Legal/contact, mailing,
  biography, and representation fields are excluded from model context by default and require a
  future workflow with separate explicit consent.
- The setup flow shows provider, model, destination, expected budget posture, key status, and context
  receipt before first egress.

### Instruction layers and declarative playbooks

- The server compiles instructions in this fixed order:
  product policy → workflow contract → account collaboration preferences → project instructions →
  matched playbook → current assignment.
- Product policy and workflow contracts are non-overridable. Later layers may refine creative goals
  but cannot add tools, permissions, resource scope, egress, executable behavior, or canonical
  authority.
- A custom playbook is versioned project data with a bounded trigger, allowed context classes,
  output schema identifier, and guidance text. It is not code, an MCP tool definition, a URL-fetch
  instruction, or a capability grant.
- Catalog agents may also have one versioned override per project and agent id. That override may
  replace craft doctrine and notes for known built-in section headings, but it is untrusted
  guidance: built-in constraints, evidence guidance, workflow/stage, agent identity, tools,
  resource scope, and canonical authority are not overridable.
- Manuscript prose, Captures, uploads, user preferences, playbooks, model output, and MCP content are
  all untrusted data. Prompt hierarchy is explanatory defense in depth; server policy and typed
  ports are the security boundary.

### Server-assembled context receipts

- Context is assembled on the server from authorized, revision-addressed resources. Clients name the
  workflow and intended target but cannot submit arbitrary manuscript context or broaden scope.
- Every run receives an immutable receipt containing resource IDs and revisions, inclusion reasons,
  instruction/playbook versions and hashes, provider/model destination, budgets, egress class, and a
  receipt hash. It excludes raw credentials and publishing/contact profile fields.
- No provider call begins until the writer confirms the displayed egress posture. A quiet invitation
  never performs background egress or spends provider budget.

### Runs, proposals, and apply authority

- Agent runs and typed proposals are durable noncanonical artifacts with initiator, workflow,
  provider/model, receipt, base revisions, content hash, usage, timestamps, and status.
- Run/proposal states cover queued, running, needs-input, ready, failed, canceled, stale, rejected,
  and applied where applicable. Cancellation guarantees no canonical change; provider usage may
  already have occurred.
- Model output is untrusted typed data. The server validates schema, target resources, size, evidence
  policy, and base revisions before a proposal becomes ready.
- Only a first-party authenticated human interaction may approve an exact proposal hash. Core
  rechecks authorization and every expected version in one transaction. Conflict applies nothing;
  retry or rebase creates a new proposal and provenance.
- A model is never recorded as the applying actor. Apply records the initiating workflow and final
  human actor and preserves undo/history.
- This supersedes ADR 0009 only where that ADR allowed client-assembled context and ephemeral
  proposals. Its craft-field boundaries and permanent propose-then-human-apply rule remain.

### Scoped MCP grants

- External MCP access uses server-created, project-scoped grants with expiry/revocation, closed-enum
  resource selectors, and closed-enum tools. A grant cannot widen or recreate itself.
- Initial external tools may discover the active grant, read explicitly granted Capture/context
  resources, assemble a receipt, and submit typed proposals into the same Inbox.
- External MCP clients cannot retrieve provider credentials, enumerate unauthorized projects, run
  arbitrary URLs/filesystem/shell, mutate grants, apply canonical changes, delete content, or invoke
  unrestricted project commands.
- UI and MCP proposal creation share core use cases and normalized outcomes; parity does not imply
  equal permission ceilings.

### Threat model and verification

- Protected assets are provider credentials, manuscript/Capture content, publishing profile data,
  context scope, budgets, proposals, grants, and canonical revisions.
- Primary attackers include a malicious authenticated writer, stolen browser session, malicious MCP
  client with a valid narrow grant, prompt-injected project/upload content, and an operator or
  service compromise.
- Server authorization, scope resolution, tool allowlists, egress destination, budgets, output
  validation, proposal authority, and version checks fail closed outside the model.
- Required tests include authorization matrices; property tests that arbitrary instruction strings
  cannot add tools/resources/egress/canonical effects; fuzzed Unicode, markup, fake tool JSON, URLs,
  and cross-project IDs; receipt golden fixtures; credential/log redaction; replay/idempotency; and
  prompt-injection fixtures that produce zero unauthorized reads, writes, or egress.

## Options considered

- **Ghostwriter-operated shared OpenAI key** — rejected for the first release because it introduces
  product billing, abuse, quota, and margin decisions before the workflow proves value.
- **Session-only writer keys** — rejected by founder direction because repeated setup undermines
  progressive onboarding; encrypted custody and explicit incident handling are accepted instead.
- **Use ChatGPT or Claude subscription OAuth tokens** — rejected because no supported third-party
  consumer delegation contract exists for this use.
- **Concatenate user instructions into one system prompt** — rejected. It obscures provenance and
  treats untrusted text as authority.
- **Executable user skills or arbitrary agent tools** — rejected. V1 playbooks are declarative and
  operate below fixed capability policy.
- **External MCP apply after writer approval** — rejected for this epic. Apply remains first-party UI
  authority.

## Consequences

- Ghostwriter assumes sensitive credential-custody, rotation, incident-response, audit, and provider
  compatibility responsibilities.
- Real agent workflows require new AI, context, receipt, run, proposal, instruction/playbook, and
  grant domain/storage/API surfaces.
- Writers can shape collaboration without prompt expertise while server policy remains auditable and
  enforceable.
- Persisted proposals and receipts make refresh, stale detection, provenance, and MCP parity possible
  but add retention and migration obligations.
- Live OpenAI quality and spend are writer-dependent; required tests remain hermetic and deterministic.
