# Decision: Wallbloom fast class uses GPT-6 Sol with low reasoning effort

- **Status:** superseded
- **Kind:** runtime configuration decision
- **Scope:** replacement candidate only; Lead performs deployment

## Context

`config/runtime/models.toml.current` pins every non-deterministic Wallbloom worker to the authenticated `pi` / `openai-codex` lane. Its `fast` compute class still selects `openai-codex/gpt-5.6-sol`, while the remaining runtime escalation classes already use GPT-6 models. The replacement must retire GPT-5.6 without changing the lane pin, follow the explicit requirement that the fast model be GPT-6 Sol, and limit frontier-quota consumption by high-volume fast workers.

## Decision

Set the `fast` compute class model to:

```toml
id = "openai-codex/gpt-6-sol:low"
provider = "pi"
compute_class = "fast"
```

The `:low` profile keeps the requested GPT-6 Sol model while explicitly lowering reasoning effort for fast-volume work. The bare `openai-codex/gpt-6-sol` entry remains the `balanced` profile, so fast and balanced do not become identical routes. Existing `strong = openai-codex/gpt-6-luna` and `frontier = openai-codex/gpt-6-astra` mappings remain unchanged. This is the smallest change that preserves the Wallbloom pi/openai-codex lane pin and removes the GPT-5.6 Sol dependency.

This limits per-call reasoning consumption; it does not create a separate quota pool. Fast workers still consume the authenticated openai-codex quota, so deployment monitoring remains necessary.

## Alternatives considered

1. **`openai-codex/gpt-6-sol` (bare):** rejected for fast because it would duplicate the existing balanced route exactly and would not constrain reasoning effort for high-volume work.
2. **`openai-codex/gpt-6-luna:low`:** rejected despite being a plausible lower-cost fast profile because it conflicts with the explicit GPT-6 Sol intent and overlaps the model family already assigned to strong.
3. **`openai-codex/gpt-6-sol:off`:** rejected because disabling reasoning is a larger behavioral change than required and is less consistent with the fast class's declared reasoning capability. `:low` is the conservative quota/quality compromise.

## Configuration diff

```diff
 [[models]]
-id = "openai-codex/gpt-5.6-sol"
+id = "openai-codex/gpt-6-sol:low"
 provider = "pi"
 compute_class = "fast"
```

No other snapshot entry, capability, rank, comment, provider, or compute-class mapping changes.

## Candidate and deployment

The complete replacement candidate is `config/runtime/models.toml.next`. It preserves the current snapshot's format and comments with only the fast model ID changed. This decision does not deploy or overwrite `config/runtime/models.toml.current`; the Lead owns that operation.

## Verification boundary

Repository checks can verify that the candidate contains GPT-6 and no `gpt-5.6-sol`, and that its only textual difference from the current snapshot is the selected fast model ID. Actual model availability, authentication, quota accounting, and service behavior require a separate Lead-run provider smoke check and are not claimed by offline verification.
