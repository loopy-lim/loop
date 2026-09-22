# Environment generalization

Reader: operators running the same Loop setup across machines, providers, and pi environments.

Decision: `docs/decisions/2026-09-22-model-environment-generalization.md`. Research: `docs/research/pi-ecosystem-generalization.md` and `docs/research/model-environment-tolerance.md`. This slice is documentation and example configuration; the adapter-side generator work is tracked separately and must not add model concepts to `loop-core` or the Rust bridge.

## Custom model registration (pi `models.json` merge)

Loop declares model ids in `config/models.toml` (for example `glm-5.3-flashx`, `zai/glm-5.3-flashx:high`). Pi resolves those ids against its built-in provider catalog at startup. When an id is absent, pi falls back with a warning and inherits whatever metadata the resolver can guess:

```text
Warning: Model "glm-5.3-flashx" not found for provider "zai". Using custom model id.
```

The chosen mechanism (decision Option 1) is pi's own custom-model merge, not Loop-layer tolerance:

- Loop's adapters render the active profiles from `config/models.toml` into a pi `models.json` fragment and point the pi child at it — either by writing the merge input into the pi config root or by setting `PI_CODING_AGENT_DIR` to a Loop-managed root that contains it.
- Pi merges the fragment per its documented semantics (`docs/models.md`, "Overriding Built-in Providers"): built-in models are kept, and custom models are **upserted by `id`** within the provider; a matching id replaces the built-in entry, a new id is added alongside.
- The upserted entries carry real metadata (`contextWindow`, `maxTokens`, `cost`, `reasoning`), so custom ids are first-class instead of fallback-resolved.

What operators do: nothing by hand. Model ids stay only in `config/models.toml`; never edit `~/.pi/agent/models.json` manually for Loop ids. After changing `models.toml`, the next spawned pi worker syncs the fragment. `pi update --models` remains the way to refresh pi's own built-in catalogs.

Example fragment shape (generated; shown for understanding, not for hand-editing):

```json
{
  "providers": {
    "zai": {
      "models": [
        {
          "id": "glm-5.3-flashx",
          "name": "GLM 5.3 FlashX",
          "contextWindow": 200000,
          "maxTokens": 32000,
          "cost": { "input": 0.6, "output": 2.2, "cacheRead": 0.11, "cacheWrite": 0.0 }
        }
      ]
    }
  }
}
```

Acceptance: a pi worker spawned with a custom model id declared in `models.toml` starts without the "Using custom model id" warning and uses correct cost/context metadata. The adapter generator and its offline tests are owned by the model-tolerance slice; the example configuration lives in `config/providers.example.toml`.

## Named Lead personas (config-driven instruction layers)

The pi-loop extension composes the Lead's system instructions from a named persona instead of a fixed prompt. A persona is a Markdown instruction fragment in the Loop config directory (`LOOP_CONFIG_DIR`); the active persona's fragment is appended via the extension's `before_agent_start` hook each turn.

Example configuration in `providers.toml` (see `config/providers.example.toml`):

```toml
[lead.persona]
active = "plan-first"

[lead.persona.files]
plan-first = "personas/plan-first.md"
```

Example persona file at `$LOOP_CONFIG_DIR/personas/plan-first.md`:

```markdown
# Plan-first Lead

Prefer research and decision tasks before any implementation task. Resolve
material questions as serialized decision nodes ahead of the fan-out. Keep
worker write scopes disjoint, require a non-empty completion contract, and
escalate fast-to-strong only after verification failure.
```

Notes:

- Persona names pair with the workflow profiles measured by the persona benchmark (`plan-first`, `spike-first`, `tdd-first`; see `docs/decisions/persona-benchmark-subsystem.md` and `config/persona-benchmark.example.toml`): the persona selects the profile shape, the benchmark measures it.
- Remove `[lead.persona]` to run the built-in instructions unchanged; unknown keys stay harmless to config parsing.
- Prompt text lives only in the pi-loop adapter and config; `loop-core` keeps receiving typed tasks and never sees persona content.

Acceptance: the pi-loop extension composes `leadInstructions` from a named persona file located in `LOOP_CONFIG_DIR`, verified offline by the extension tests in the persona slice.

## Portable config roots (multi-machine setups)

The whole Loop environment is two directories plus Herdr context, all relocatable by environment variables:

| Variable | Role | Default |
| --- | --- | --- |
| `LOOP_CONFIG_DIR` | Loop config directory: `models.toml`, `policy.toml`, `providers.toml`, personas | `$XDG_CONFIG_HOME/loop`, else `~/.config/loop` |
| `PI_CODING_AGENT_DIR` | Pi config root: `models.json` fragments, settings, auth | `~/.pi/agent` |
| `HERDR_*` | Herdr workspace/pane context for run reporting | detected from the calling pane |

`loop doctor` verifies that each variable, when set, resolves to an existing, readable directory, so a broken relocation fails fast at diagnosis instead of at worker spawn. The CLI forwards the resolved `LOOP_CONFIG_DIR` to the Lead child environment; credentials never travel through either variable.

Multi-machine recipe: dotfile the two directories, set both variables per machine, and every machine reproduces the same Lead behavior, worker routing, and model catalog without editing machine-local files.

Acceptance: a `loop doctor` check verifies resolvability of `LOOP_CONFIG_DIR`, `PI_CODING_AGENT_DIR`, and `HERDR_*`; the doctor implementation and tests are owned by the portability slice.

## Acceptance-criteria traceability

| Decision acceptance criterion | Artifact in this slice |
| --- | --- |
| Custom-model pi worker spawns without the "Using custom model id" warning, with correct metadata | Mechanism and fragment semantics documented above; sync flow and id placement demonstrated in `config/providers.example.toml` |
| Extension composes `leadInstructions` from a named persona in `LOOP_CONFIG_DIR` | `[lead.persona]` example stanza in `config/providers.example.toml`; persona file shape and composition rules documented above |
| `loop doctor` verifies `LOOP_CONFIG_DIR`, `PI_CODING_AGENT_DIR`, `HERDR_*` resolvability | Variable table and doctor check documented above; pointers in `README.md` and `docs/provider-support.md` |
