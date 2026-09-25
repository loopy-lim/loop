# Decision: Unified zai-primary routing with openai-codex fallbacks

- **Status:** decided
- **Kind:** runtime configuration decision
- **Supersedes:** `runtime-mixed-zai-gpt6-routing.md`
- **Scope:** `config/models.toml` and `config/runtime/models.toml.next`; Lead performs deployment to `~/.config/loop`

## Context

The previous decision routed volume classes through zai and reserved GPT-6 for hard work, but left antigravity gemini profiles inside the balanced and frontier fallback chains. The newer requirement is stricter: 1) every compute class must have a zai primary followed by an openai-codex (pi lane) fallback, 2) antigravity gemini profiles must leave the fallback chains entirely (provider configuration is retained), and 3) the runtime candidate `models.toml.next` must mirror the policy.

## Decision

Every class below follows the same shape: zai primary(s) first, then the unified openai-codex fallback. The `ModelRegistry.forComputeClass` ordering is `cost_weight + latency` ascending, ties broken by id; openai entries therefore carry strictly higher `cost_weight + latency` than the zai entries in the same class so the sort order reproduces the intended fallback order without provider-specific routing logic.

| Compute class | Fallback chain, in preference order (cost_weight + latency) |
| --- | --- |
| deterministic | `deterministic-local` (unchanged) |
| tiny | `zai/glm-5.3-flashx:off` (2) → `openai-codex/gpt-6-luna:off` (4) |
| typed_decision | `glm-5.3-flashx` (2) → `openai-codex/gpt-6-luna` (4) |
| fast | `zai/glm-5.3-flashx` (2) → `openai-codex/gpt-6-luna:low` (4) |
| balanced | `zai/glm-5.3-flashx:high` (2) → `zai/glm-5.3-flash` (3) → `openai-codex/gpt-6-luna:high` (4) |
| strong | `zai/glm-5.3-flash:high` (2) → `openai-codex/gpt-6-sol:low` (6) |
| frontier | `openai-codex/gpt-6-sol` (7) — all-openai lane per the requirement example |

Two new model ids were added following the existing `:<thinking>` variant style: `openai-codex/gpt-6-luna:high` (balanced fallback) and `openai-codex/gpt-6-sol:low` (strong fallback). The base `openai-codex/gpt-6-luna` id moved from balanced to typed_decision so each class keeps a unique profile id, as required by the duplicate-id check. No new `[pi.models]` metadata was declared, per the 2026-09-22 model-environment decision.

## Alternatives considered

1. Balanced third fallback `openai-codex/gpt-6-luna:low` (literal requirement example): rejected because that id is the fast-class fallback and model ids must be unique across classes; `luna:high` provides the same behavior with a distinct id.
2. Keep gemini as a last-resort balanced/frontier fallback: rejected — the requirement explicitly removes antigravity gemini from fallback chains to stop routing worker traffic through the antigravity lane; the provider and doctor configuration stay in place.
3. Give frontier a zai primary (e.g. `zai/glm-5.3-flash:high`): rejected — the requirement example defines frontier as the pure openai-codex `gpt-6-sol` lane.

## Gemini exclusion rationale

The antigravity gemini entries (`gemini-3.8-flash-high`, `gemini-3.1-pro-high`, `gemini-3.1-pro-low`) were removed from both `config/models.toml` and `config/runtime/models.toml.next`. `[providers.antigravity]` configuration and doctor checks are untouched, so the provider remains available for future explicit lanes; it is simply no longer part of the automatic class fallback chains.

## Verification

Offline verification: `bun test packages/orchestrator` and `bun test packages/cli` pass with the updated registry expectations (per-class chains above, 13 total models) and the completion greps confirm no `gemini` reference remains in either models file while the new `gpt-6-luna:off` / `gpt-6-sol` ids are present. Provider authentication, availability, quota behavior, and actual fallback selection require separate authenticated smoke validation; offline config checks do not prove them.
