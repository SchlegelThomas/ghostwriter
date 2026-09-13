# CP3 grounded check contract

## Checkpoint outcome

One explicit Story work check examines a selected scene proposal or acknowledged scene head with
bounded surrounding context and returns a durable, typed, advisory findings artifact. The writer can
open evidence, dismiss or defer a finding, or start a separate revision assignment. A source change
shows Needs recheck without a provider call. Checks never approve or apply canonical story state.

The first vertical slice supports continuity. Character and dialogue/completeness use the same
contract after the continuity path is proven; they are not separate stores or mutation authorities.

## Authority and storage

- Add `story-check-findings-v1`; do not overload `catalog-memo-v1` or
  `pacing-findings-v1`. Legacy catalog drafts retain their acknowledge-only behavior.
- The provider returns bounded finding candidates only. Trusted server code attaches the exact
  target, coverage, dependency vector, context receipt and explicitly linked downstream scene IDs.
  Models cannot choose source versions, claim unread coverage, widen scene IDs or authorize actions.
- The complete artifact is an immutable `AgentProposal` linked to a durable
  `StoryWorkAssignment`. Writer resolution edits create replacement proposal versions and preserve
  generated lineage, as character and scene review already do.
- Add an `assess` destination operation for check assignments. It names the scene/project being
  assessed without implying a canonical update.
- Check lifecycle needs a non-mutation terminal state (`reviewed`) rather than reusing `applied`.
  This is added only when the assignment review transition is implemented; the schema foundation
  must not pretend a check was applied.

## Check targets

`mode` is explicit and participates in request identity:

1. `applied-scene` binds one active canonical scene head by project, scene, working version and
   content hash. Optional block anchors are valid only against this exact document.
2. `proposal-draft` binds one current `scene-draft-v1` artifact by assignment, proposal, artifact
   version and content hash. Draft prose has no canonical block IDs; its findings use scene and exact
   quote anchors only.

Named variants are not direct targets in the first slice. A later extension may bind an immutable
variant revision explicitly; it must not be treated as the working head.

## Finding payload

The trusted stored payload contains:

- schema and specialist (`continuity` first);
- exact target mode/reference;
- a bounded list of findings with stable server IDs;
- finding kind: `contradiction`, `suggestion`, or `question`;
- severity: `blocking`, `important`, or `advisory` (creative advice remains dismissible);
- concise claim and optional proposed next step;
- one or more validated evidence anchors:
  - required `sceneId`;
  - optional exact `quote`;
  - optional `blockId` only for acknowledged scene documents;
  - optional `storyKnowledgeId` only when that record was included in trusted context;
- writer resolution: `open`, `dismissed`, or `deferred`, with a bounded reason for deferred;
- trusted coverage: requested scope, examined scene IDs at exact versions, skipped scene IDs with
  reasons, truncation per resource, and an explicit `completeForRequestedScope` flag;
- trusted `StoryAssessmentRevisionVector`;
- trusted explicitly linked downstream scenes to consider for recheck.

There is no aggregate coherence score.

## Validation

Before proposal persistence, core validation:

- rejects unknown fields, duplicate finding IDs, excessive findings/anchors and empty text;
- requires every anchor scene/knowledge ID in the trusted receipt;
- requires quotes to be exact substrings of the provider-visible text for that resource;
- requires block IDs to exist in the bound acknowledged document and forbids them for proposal
  drafts;
- rejects claims of complete coverage when any requested source was skipped or truncated;
- distinguishes zero findings from zero coverage;
- rebuilds the dependency vector from trusted project records, scene heads and target artifact;
- records manuscript structure, consumed scene prose, scene intent, chapter objective and consumed
  story knowledge dependencies only when actually included.

Invalid model anchors fail the attempt as invalid output; they are not silently shown as evidence.

## Freshness

The stored vector is compared with a freshly assembled vector using
`evaluateStoryAssessmentFreshness`. Added unrelated records do not stale a check. Changed/missing
consumed prose, intent, objective, knowledge or manuscript slice produces `needs-recheck` with
deterministic reasons and no provider call. Findings remain inspectable but visibly outdated.

## Writer flow and refusal

- Agent → Develop story → Check story → Continuity.
- Choose applied scene or an exact reviewable scene proposal; choose bounded surrounding sources;
  preview what will and will not be read; Submit explicitly.
- Review shows coverage before findings. Open source navigates to the exact scene; block scrolling
  is required only for block-backed applied-scene evidence.
- Dismiss/defer changes review state only. Start revision creates a prefilled `revise` assignment
  but does not submit it automatically. Update intent opens the existing shared intent editor; its
  acknowledged command is separate from the finding resolution.
- Missing/archived/cross-project targets, stale proposal pointers, invalid anchors, empty coverage,
  unsupported models and changed source heads refuse without a result or second provider call.

## Initial implementation slices

1. Pure core schema, model-output schema, trusted envelope builder, anchor/coverage validator and
   dependency-vector builder with seeded contradiction tests.
2. Check generation lifecycle over existing assignment/run/receipt/proposal UOW patterns; memory
   then PostgreSQL parity. Provider call remains outside transactions.
3. Strict backend submission/generation/detail/freshness routes and hermetic provider fixture.
4. Check review/resolution UI, source navigation and prefilled revision handoff.
5. Browser success/refusal/stale walkthrough, full verification and documentation.

CP6 remains the scoped MCP parity audit. No Playwright runs before complete-outcome user
verification.
