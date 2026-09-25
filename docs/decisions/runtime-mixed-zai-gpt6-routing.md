# Decision: Wallbloom mixed ZAI volume / GPT-6 hard routing

- **Status:** superseded by `runtime-openai-fallback-routing.md`
- **Kind:** runtime configuration decision
- **Supersedes:** `runtime-fast-class-gpt6.md`
- **Scope:** candidate snapshot only; Lead performs deployment

## Context

The previous decision replaced only the fast model while keeping every runtime worker on the OpenAI Codex lane. The newer requirement prioritizes ZAI GLM-5.3-FlashX for high-volume classes and reserves GPT-6 for difficult work. `config/models.toml` provides the class composition and pi metadata reference. The current Wallbloom snapshot's `gpt-5.3-codex-spark` volume entries and `gpt-5.6-sol` fast entry must be replaced; `gpt-5.6-sol` is retired.

## Decision

Use ZAI for tiny, fast, typed_decision, and balanced primary. Use GPT-6 Luna Low as a balanced fallback and the default Luna profile as the strong model; use GPT-6 Sol for frontier. There is no GPT-6 candidate in tiny or fast. The ZAI pi default provider and FlashX metadata are copied from `config/models.toml` so the bare typed-decision ID resolves to ZAI. Distinct reasoning suffixes keep the balanced and strong Luna profiles unique, as required by the loader. This keeps deterministic selection in the existing class/cost policy rather than introducing provider-specific routing logic.

| Compute class | Selected model(s), in preference order |
| --- | --- |
| deterministic | `deterministic-local` |
| tiny | `zai/glm-5.3-flashx:off` |
| typed_decision | `glm-5.3-flashx` (ZAI default provider) |
| fast | `zai/glm-5.3-flashx` |
| balanced | `zai/glm-5.3-flashx:high`, `openai-codex/gpt-6-luna:low` fallback |
| strong | `openai-codex/gpt-6-luna` |
| frontier | `openai-codex/gpt-6-sol` |

## Snapshot replacement

| Current entry | Candidate replacement |
| --- | --- |
| `openai-codex/gpt-5.3-codex-spark` / typed_decision | `glm-5.3-flashx` / typed_decision (ZAI default provider) |
| `openai-codex/gpt-5.3-codex-spark:off` / tiny | `zai/glm-5.3-flashx:off` / tiny |
| `openai-codex/gpt-5.6-sol` / fast | `zai/glm-5.3-flashx` / fast; GPT-5.6 Sol retired |
| `openai-codex/gpt-6-sol` / balanced | `zai/glm-5.3-flashx:high` primary; `openai-codex/gpt-6-luna:low` fallback |
| `openai-codex/gpt-6-luna` / strong | retained as strong |
| `openai-codex/gpt-6-astra` / frontier | `openai-codex/gpt-6-sol` / frontier |

Unlike a literal one-for-one rename, this changes the balanced route from GPT-6 Sol to ZAI-first and moves GPT-6 Sol to frontier. The obsolete Astra frontier entry is removed. Current snapshot GPT-6 Luna's capability metadata differs by class in the candidate: its strong profile follows the repository class definition; metadata is not sourced from the snapshot's former strong profile.

## Alternatives considered

1. Keep all volume work on GPT-6 and only change fast to `gpt-6-sol:low`: rejected because it fails the newer explicit ZAI-first volume requirement.
2. Remove GPT-6 Luna from balanced entirely: simpler and stricter hard-lane isolation, but rejected because the request permits a balanced fallback and fallback reduces risk when ZAI is unavailable.
3. Keep `gpt-6-astra` as frontier: rejected in favor of the requested GPT-6 Sol frontier lane matching the repository's mixed configuration.

## Candidate and deployment

The complete candidate is `config/runtime/models.toml.next`, in the Wallbloom TOML table format. It does not modify `config/runtime/models.toml.current`; Lead owns deployment to `~/.config/loop`. Provider authentication, availability, quota behavior, and actual fallback selection require separate authenticated smoke validation; offline config checks do not prove them.

## Loader validation

Offline validation passed: `loadLoopConfig` loaded the candidate as `models.toml` beside minimal policy/provider fixtures, and `ModelRegistry.forComputeClass` returned the exact seven class mappings in the decision table (including ZAI tiny/typed_decision/fast and `openai-codex/gpt-6-sol` frontier), without a provider call.
