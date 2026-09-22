# Model environment tolerance: pi custom-model warning path and Loop model-id flow

Reader: maintainers changing provider composition or model configuration.
Evidence baseline: pi v0.87.0 (`PI_ROOT` below = `/Users/loopy/.local/share/fnm/node-versions/v22.21.1/installation/lib/node_modules/@earendil-works/pi-coding-agent`).

## (a) When pi emits `Model "<id>" not found for provider "<provider>". Using custom model id.`

Exact source: `PI_ROOT/dist/core/model-resolver.js`, `resolveCliModel` (line 292), warning string built at lines 452–453. The warning is returned to `buildSessionOptions` (`PI_ROOT/dist/main.js:360–370`), merged into startup diagnostics (`main.js:645–646`), and printed as `Warning: <message>` in chalk yellow by `reportDiagnostics` (`main.js:68–71`, printed at `main.js:479–481`). `pi auth check` uses the same resolver (`PI_ROOT/dist/cli/auth-check.js:9`), so `loop doctor --auth` sees it too.

The warning fires only when **all four** hold:

1. A model pattern was given via CLI resolution (`--provider X --model Y`, or `--model X/Y` with the `X/` prefix recognized as a provider, `model-resolver.js:346–356`).
2. The provider name resolves against the merged catalog (built-in + `models.json` + extensions, `model-resolver.js:323–339`). Unknown providers hard-error instead (`Unknown provider`, line 310).
3. The pattern matches nothing in that provider's catalog (exact, `provider/id`, or fuzzy partial, `tryMatchModel`/`parseModelPattern`, lines 52–93, 165–171).
4. `buildFallbackModel` (lines 130–146) succeeds, i.e. the provider still has **at least one** model in the merged catalog. For built-in providers this is always true, so the warning + fallback is the guaranteed outcome for any catalog miss.

### The fallback model pi constructs

`buildFallbackModel` (`model-resolver.js:130–146`) picks the provider's default entry from `defaultModelPerProvider` (line 10; `zai → "glm-5.3"`, line 45) or the provider's first model, then returns `{ ...baseModel, id: modelId, name: modelId }`. Consequences:

- The request still works: the custom `id` is what reaches the provider endpoint.
- Metadata is **silently inherited from the wrong model**: `baseUrl`, `api`, `contextWindow`, `maxTokens`, `cost`, `input` all come from glm-5.3. For `glm-5.3-flashx` (not in the built-in zai catalog — verified against `pi-ai/dist/providers/data/zai.json`, which lists glm-4.7, glm-5-turbo, glm-5.2, glm-5.2-highspeed, glm-5.3, glm-5.3-flash, glm-5.3-highspeed), context window and cost metadata are wrong.
- With a thinking-level suffix, `reasoning` is forced true (`model-resolver.js:449–450`).
- If the provider had zero catalog models, behavior degrades to a hard error `Model "<provider>/<pattern>" not found. Use --list-models…` (`model-resolver.js:459–464`), exit 1 in `findInitialModel` (`main.js` path via `findInitialModel`, `model-resolver.js:495–505`).

### Entry-path differences

| Entry path | Resolver | Custom-id outcome |
| --- | --- | --- |
| CLI flag `--provider/--model` (lead, headless workers, doctor) | `resolveCliModel` (`model-resolver.js:292`) | Warning + inherited-metadata fallback model (lines 447–454) |
| CLI `--model` with `provider/` prefix | same, prefix inferred (`model-resolver.js:346–356`) | Same warning; pattern is the bare id |
| Scoped model patterns (`--models`, Ctrl+P scope) | `resolveModelScope` (`model-resolver.js:317–325`) | Different diagnostic `No models match pattern "<pattern>"`; **no** fallback model is constructed — the model is simply unavailable |
| Settings default (`defaultProvider`/`defaultModelId`) | `findInitialModel` step 3 (`model-resolver.js:508–521`) | Silent: `getModel` returns undefined, falls through to first available model; no warning |
| Session restore (`--continue`/`-r`) | `restoreModelFromSession` (`model-resolver.js:545+`) | Different warning `Could not restore model p/m (model no longer exists)` + fallback to current/first available |

Loop always spawns fresh sessions (`--no-session`, `packages/providers/src/pi/adapter.ts:60`; lead has no `--continue`, `packages/cli/src/main.ts:631–642`), so the Loop-visible path is exclusively the first row: `resolveCliModel`.

## (b) How Loop selects and passes model ids

1. **Declaration — `config/models.toml`.** Every `[models]` entry is `(id, provider, compute_class, …)`. The zai volume classes ride pi pattern syntax: `glm-5.3-flashx` (config/models.toml:16–17, typed_decision), `zai/glm-5.3-flashx:off` (:24–25, tiny), `zai/glm-5.3-flashx` (:32–33, fast), `zai/glm-5.3-flashx:high` (:43–44, balanced), `zai/glm-5.3-flash` (:51–52, balanced). The lead id lives separately: `[lead] provider="zai" model="glm-5.3-flashx"` (config/providers.example.toml:4–7).
2. **Load — `packages/orchestrator/src/config.ts`.** `loadLoopConfig` reads models.toml (:98) and the lead stanza (:112, :161–165) into `LoopConfig.lead` and `LoopConfig.models`. Model ids remain opaque strings; no provider knowledge enters loop-core (routing sends compute classes only, per docs/model-routing.md).
3. **Composition — `packages/orchestrator/src/composition.ts`.** For `providerId === "pi"`, interactive mode creates a visible Herdr agent with args `["--model", model.id]` (`visibleAgent`, :63, :99–112); exec mode creates `PiProvider({ model: model.id })` (:64–70).
4. **Spawn — `packages/providers/src/pi/adapter.ts`.** `launch()` pushes `--provider` only if explicitly configured (never today from composition) and `--model <pattern>` (adapter.ts:57–61), then `--no-session -p <prompt>` (:60). So workers run e.g. `pi --model zai/glm-5.3-flashx:high --no-session -p …` → pi infers provider `zai` from the slash → catalog miss → warning + fallback model, every spawn.
5. **Lead — `packages/cli/src/main.ts`.** `buildInteractiveLeadInvocation` (:621–643) builds `pi --no-extensions --extension loop-pi-extension.js --provider zai --model glm-5.3-flashx …`; `startInteractiveLead` feeds it `config.lead.*` (:368–382). Doctor probes the same pair through `pi auth check --provider zai --model glm-5.3-flashx --json --no-refresh` (:439–447), which resolves via the same code path (`PI_ROOT/dist/cli/auth-check.js:9`).
6. **pi-loop extension** (`packages/pi-loop/src/extension.ts:279–284`) only *displays* `loop models --json`; it never passes ids into pi resolution.

So the reported warning is the lead invocation (`--provider zai --model glm-5.3-flashx`, exact match to the symptom) plus each pi worker spawn; both resolve through `resolveCliModel`.

## (c) Options to eliminate or consciously handle the warning

| # | Option | Mechanism | Warning gone? | Correct metadata? | Config ownership (AGENTS.md) | Cost |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | pi `~/.pi/agent/models.json` custom-model merge | Add `{"providers":{"zai":{"models":[{"id":"glm-5.3-flashx",…}]}}}`; built-ins kept, upsert by id | Yes — exact catalog match (`model-resolver.js:175–178`) | Yes — explicit `contextWindow`/`cost` (defaults otherwise 128k/16384) | Model ids stay in config/models.toml; models.json is machine provisioning (same tier as auth), consumed by adapter environment | Small doc + provisioning slice; per-machine file |
| 2 | Loop-layer warning tolerance | Accept the warning as documented expected behavior; no code change | No (noise stays) | No — silent glm-5.3 metadata inheritance persists | Zero new ownership | Zero code, doc only |
| 3 | Rename Loop ids to built-in catalog ids | Use only `glm-5.3-flash`/`glm-5.3` etc. | Yes | Yes | Loop loses its own vocabulary; flashx quota economics (2.5×, models.toml:14) get lost | Distorts routing intent; fails "arbitrary providers/models" goal |
| 4 | Register a `loop` provider via the Loop pi extension | Extension registers provider+models from `loop models --json` at pi startup (`composeModelProvider`/`applyExtension`, `PI_ROOT/dist/core/provider-composer.js:142–162, 311+`) | Yes | Yes | Cleanest ownership (adapter construction), but worker spawns would need the extension installed in `~/.pi/agent/extensions`; headless `-p` + `--no-extensions` interplay must be verified | Large slice; later milestone |

### Merge semantics for option 1 (evidence)

`applyModelsJson` (`PI_ROOT/dist/core/provider-composer.js:106–140`) and docs (`PI_ROOT/docs/models.md:361–372`): built-in models are kept; `models.json` models are upserted by `id` within the provider; a matching id replaces the built-in, a new id is added. For a **built-in** provider such as `zai`, `api`/`baseUrl` are inherited from sibling built-in defaults (`findModelDefaults`, `provider-composer.js:100–105`; `modelFromJson` baseUrl fallback, :72–74), so no `baseUrl` is needed. For a **new** provider stanza, `baseUrl` plus an `api` (provider or model level) is mandatory (`provider-composer.js:73–74, 152–153`; models.md "Provider Configuration"). Auth gates availability (`/model`, `--list-models`) but not file loading; pi's zai auth already exists in `~/.pi/agent/auth.json`. There is no `models.json` on this machine yet (`~/.pi/agent/` listing), so this is net-new provisioning. Structural errors (bad schema, missing baseUrl) surface eagerly at registration/reload (`provider-composer.js:329`), so a typo fails loudly, not silently.

## Recommendation

**Option 1 (pi `models.json` custom-model merge) as the mechanism, with option 2 as the documented default stance for arbitrary ids.** Rationale:

- It is the only small slice that removes the warning *and* fixes the silent wrong-metadata fallback (context window/cost inherited from glm-5.3) for every entry path Loop uses (lead, exec workers, visible workers, doctor), without touching Rust bridge types, without importing provider concepts anywhere new, and without renaming Loop's model vocabulary.
- Config ownership stays intact: `config/models.toml` remains the single source of Loop model ids; `~/.pi/agent/models.json` is environment provisioning of the *adapter's* catalog — the same category as `pi auth` login state, which Loop already treats as external (docs/provider-support.md evidence boundary). A provisioning helper (e.g. emitted by `scripts/install-local.sh` or documented as a copy-paste stanza) must derive from config, never hardcode a second copy of ids in Loop source.
- Option 4 remains the long-term direction if Loop wants provider-catalog authority inside pi (e.g. dynamic model sets); it is deliberately deferred as a larger slice with headless-mode verification risk.
- Option 2 is retained for genuinely unknown future ids: pi's fallback keeps them runnable, and the doc records why the warning is benign but lossy — so an operator seeing it knows the fix is models.json, not a bug report.

Follow-up implementation slice (not this task): add the `zai` custom-model stanza to provisioning, document it in docs/provider-support.md, and optionally extend `loop doctor` to detect the `Using custom model id` warning and point at models.json.

## Verification

- Warning path read directly from `PI_ROOT/dist/core/model-resolver.js` (v0.87.0, installed build used by `which pi` → `dist/bundle/cli.js`).
- Built-in zai catalog enumerated from `pi-ai/dist/providers/data/zai.json`; `glm-5.3-flashx` absent.
- Loop flow traced through config.toml → `orchestrator/config.ts` → `orchestrator/composition.ts` → `providers/pi/adapter.ts` and `cli/main.ts` with line references above.
- No tests added (research task, write scope limited to this doc).
