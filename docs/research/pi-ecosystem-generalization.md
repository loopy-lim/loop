# Pi Ecosystem Generalization Survey

- **Task:** `fact-ecosystem-scan`
- **Date:** 2026-09-22
- **Pi version surveyed:** 0.87.0 (docs at `@earendil-works/pi-coding-agent/docs/`)
- **Question:** which portability/personalization patterns from the pi ecosystem should Loop generalize, and at what boundary cost?

## Scope and Method

Sources surveyed:

- Pi docs: `models.md`, `settings.md`, `environment-variables.md`, `extensions.md`, `skills.md`, `packages.md`, `prompt-templates.md`, `themes.md`, `sdk.md`.
- Concrete user-side setups under `/Users/loopy/.agents/skills/`: `loop-me` (grilling → workflow specs in a workspace), `wayfinder` (huge work charted as decision tickets on an issue tracker), `implement` (spec → TDD → code-review → commit pipeline).
- Pi shipped examples: `examples/extensions/` (e.g., `git-checkpoint.ts`, `dirty-repo-guard.ts`, `dynamic-resources`, `custom-provider-anthropic`), `examples/sdk/` (`02-custom-model.ts`, `03-custom-prompt.ts`).
- In-repo grounding: `docs/architecture.md` (boundary table), `docs/decisions/` (`persona-benchmark-subsystem.md`, `ui-output-limits.md`, `2026-09-21-routing-jev-disable-and-pi-coverage.md`, `worker-tab-placement.md`, `bare-loop-behavior.md`), `packages/pi-loop/src/` (`extension.ts`, `herdr-lifecycle.ts`, `lead/`, `ui/`).

Method: for each ecosystem mechanism, extract the pattern, then map it to one concrete Loop improvement. Every opportunity below carries: **Source pattern** (with reference), **Loop adaptation sketch**, **Estimated effort** (S/M/L), and **Boundary compliance** (checked against `docs/architecture.md`: loop-core owns graph/policy/state only; TypeScript adapters stay thin; no provider/model concepts in loop-core; no Rust bridge change for this slice).

## Pattern Survey: How Pi Enables Portability and Personalization

| Mechanism | Reference | What it gives users |
| --- | --- | --- |
| Custom model registration | `docs/models.md` — `~/.pi/agent/models.json`, "Overriding Built-in Providers" | `models` array **upserts by `id`** into built-in providers; unknown ids in Loop config are the source of the `glm-5.3-flashx` startup warning today |
| Provider registration from code | `docs/extensions.md` — `pi.registerProvider(name, config)` | Extensions can add/override providers and live catalogs (`refreshModels`) without touching `models.json` |
| Settings layering | `docs/settings.md` — `~/.pi/agent/settings.json` vs `.pi/settings.json`, recursive merge, project trust | Per-machine defaults + per-project overrides shareable with a team |
| Resource arrays | `docs/settings.md` — `packages`/`extensions`/`skills`/`prompts`/`themes` arrays with globs | One settings file composes all personalization |
| Env-var configuration | `docs/environment-variables.md` — `PI_CODING_AGENT_DIR`, `PI_PACKAGE_DIR`, session markers (`AI_AGENT`, `PI_PROVIDER`, `PI_MODEL`) | Relocatable config roots; children detect and identify the pi host |
| Packaging | `docs/packages.md` — `pi` manifest (`extensions`/`skills`/`prompts`/`themes`), npm/git/local sources, project-scoped installs | Distribute Loop tooling as `pi install npm:…`; project settings auto-install packages after trust |
| Skills | `docs/skills.md` — Agent Skills standard, `/skill:name` commands, `disable-model-invocation` | On-demand workflow packages; users already carry cross-harness skills in `~/.agents/skills` |
| Prompt templates | `docs/prompt-templates.md` — `/name` commands, `$1…$@` args, `argument-hint` | Typed shortcuts that expand into full prompts |
| Instruction injection | `docs/extensions.md` — `before_agent_start` system-prompt chaining | Persona/role layers without editing the prompt template itself |
| Dynamic resources | `docs/extensions.md` — `resources_discover` event | Extensions contribute skill/prompt/theme paths at startup |
| Themes | `docs/themes.md` — 53 color tokens, `vars`, hot reload | Terminal-independent presentation, selectable per machine |
| SDK embedding | `docs/sdk.md` — `createAgentSession()`, run modes | Pi as a library: custom model, prompt, tools per host process |

User-side evidence (`loop-me`, `wayfinder`, `implement`) shows a consistent shape: **a workspace convention + a skill that encodes a workflow discipline** (grilling → spec; map of decision tickets; spec → TDD → review → commit). They are personal, portable (plain Markdown in `~/.agents/skills`), and harness-agnostic. Loop's equivalents (decomposition discipline, completion contracts, DAG templates) are currently hard-coded in `packages/pi-loop/src/lead/prompts.ts` and the orchestrator, not user-editable assets.

## Opportunity 1: Sync Loop model profiles into pi's model catalog

- **Source pattern:** `docs/models.md` — "Custom Models" and "Overriding Built-in Providers": `~/.pi/agent/models.json` `providers.<name>.models[]` upserts by `id` into built-in providers; `pi update --models` refreshes catalogs. Pi's resolver warns `Model "X" not found for provider "Y". Using custom model id.` when an id is absent from the catalog.
- **Loop adaptation sketch:** Loop already declares model profiles per compute class in `config/models.toml` (`docs/decisions/2026-09-21-routing-jev-disable-and-pi-coverage.md`). Add a small generator in the adapters (e.g., `loop models sync` or an orchestrator-side step when spawning pi workers) that renders Loop's active model profiles as a `models.json` fragment and points the pi child at it — either by writing `~/.pi/agent/models.json` merge input or by setting `PI_CODING_AGENT_DIR` to a Loop-managed dir containing it. This removes the startup warning and makes `zai:glm-5.3-flashx`-style ids first-class instead of fallback-resolved. `packages/pi-loop/src/extension.ts` already reads config at extension start (`loadLoopConfig().output`), so the same config directory can feed the generator.
- **Estimated effort:** M (config→JSON rendering + env plumbing + offline tests with a fixture TOML; no paid calls).
- **Boundary compliance:** generator lives in the orchestrator/providers adapter layer (it emits pi-specific files, exactly what adapters may normalize). loop-core never sees model ids; `config/models.toml` remains the only place model ids exist. No Rust bridge or generated-protocol change.

## Opportunity 2: Named Lead personas as config-driven instruction layers

- **Source pattern:** `docs/extensions.md` — `before_agent_start` chains system prompts per turn; `docs/settings.md` — global/project layering for defaults. User-side, `loop-me` and `implement` are personas as plain Markdown loaded on demand.
- **Loop adaptation sketch:** `packages/pi-loop/src/extension.ts` already appends a fixed `leadInstructions(event.prompt)` via `pi.on("before_agent_start", …)`. Generalize: `[lead.persona]` (or named profiles) in the Loop config directory supplies instruction fragments (tone, decomposition style, defaults like "prefer research-first DAGs"), and the extension composes `leadInstructions` from the active persona. This pairs with the planned `WorkflowProfile` benchmark work (`docs/decisions/persona-benchmark-subsystem.md`: `PlanFirst`/`SpikeFirst`/`TddFirst`) — the persona selects the profile, the benchmark measures it.
- **Estimated effort:** S (config parsing + string composition in `pi-loop`; tests assert fragment injection offline).
- **Boundary compliance:** prompt text stays in the pi-loop adapter and config; loop-core keeps seeing only typed `TaskSpecInput[]`. No provider/model concepts; no Rust change.

## Opportunity 3: Package Loop commands as an installable pi package

- **Source pattern:** `docs/packages.md` — `pi` manifest (`"pi": { "extensions": […], "prompts": […] }`), `pi install npm:…|git:…|./path`, project-scoped installs auto-loaded after trust; `docs/skills.md` — skills as `/skill:name`; `docs/prompt-templates.md` — `/name` argument-hinted templates.
- **Loop adaptation sketch:** publish the existing `registerLoopExtension` (`packages/pi-loop`) as a pi package (`loop-pi-extension.js` entry + `pi` manifest) so users `pi install ./packages/pi-loop` or `pi install npm:@loop/pi` instead of hand-wiring extension paths. Add prompt templates (`/loop-plan`, `/loop-status`, `/loop-review`) that expand into well-formed `loop_run` intents, and a skill (`loop-dag`) carrying the decomposition discipline so the Lead loads it on demand like `implement` does for TDD. Note the project-trust interaction: project `.pi/settings.json` installs require trust (`docs/settings.md`), so document `/trust` in the quickstart.
- **Estimated effort:** M (packaging manifest, templates, publish path; extension code barely changes).
- **Boundary compliance:** pure packaging of the existing TS adapter surface; loop-core untouched; the extension still talks to Loop only through the `loop` CLI (`DefaultLoopLeadBackend` spawns `LOOP_BIN`), so the adapter stays thin.

## Opportunity 4: Portable config roots for multi-machine setups ("on my pi" for Loop)

- **Source pattern:** `docs/environment-variables.md` — `PI_CODING_AGENT_DIR` overrides the whole pi config root; `docs/settings.md` — resources arrays accept `~`-relative paths; `docs/packages.md` — project settings share package pins with a team.
- **Loop adaptation sketch:** Loop already funnels configuration through `LOOP_CONFIG_DIR` (`docs/decisions/ui-output-limits.md`: CLI passes only the directory, never credentials; pi-loop reads the same resolver). Generalize this into the documented portability story: one Loop config directory (models.toml, policy.toml, personas) plus one pi config root, both relocatable via env vars, with a `loop doctor` check verifying resolvability of `LOOP_CONFIG_DIR`, `PI_CODING_AGENT_DIR`, and `HERDR_*` context. This directly supports the multi-machine goal: dotfile the two directories, and every machine reproduces the same Lead and worker behavior without editing `~/.pi/agent/models.json` by hand.
- **Estimated effort:** S for the doctor check + docs; M if combined with Opportunity 1's generator.
- **Boundary compliance:** path resolution and env plumbing live in the orchestrator/CLI adapters; loop-core has no filesystem or env concepts (verified: `crates/loop-core` is graph/policy only per `docs/architecture.md`). Credentials keep flowing only through provider auth stores, never config or logs.

## Opportunity 5: Workflow-profile DAG templates from the wayfinder/implement shape

- **Source pattern:** `/Users/loopy/.agents/skills/wayfinder/SKILL.md` — huge work charted as a map of **decision tickets**, resolved one at a time before execution; `implement` SKILL.md — fixed pipeline (spec → TDD → `/code-review` → commit); `docs/decisions/persona-benchmark-subsystem.md` already plans profile→DAG-template scenarios.
- **Loop adaptation sketch:** implement the planned DAG templates as config-declared fixtures mapping a profile name to `TaskSpecInput[]` skeletons (e.g., `tdd-first`: `[write-tests] → [implement] (iterative)`; `wayfinder-style`: serialized `[decision]` nodes ahead of `[implementation]` fan-out). The Lead's decomposition prompt then references the chosen profile (from Opportunity 2's persona or `/loop` args), and the orchestrator validates the skeleton like any plan. Expose via `loop benchmark run <config>` per the existing decision.
- **Estimated effort:** M–L (fixture schema + validation + benchmark wiring).
- **Boundary compliance:** profile→template mapping lives in orchestrator fixtures (per the persona-benchmark decision: "keep loop-core ignorant of text prompt specifics"); loop-core receives only typed tasks; compute-class names ride in existing config, not core.

## Opportunity 6: Session markers for worker and pane observability

- **Source pattern:** `docs/environment-variables.md` — pi sets `AI_AGENT=pi` / `PI_CODING_AGENT=true` process markers and injects `PI_SESSION_ID`, `PI_PROVIDER`, `PI_MODEL` into shell-tool children so scripts can self-identify the host.
- **Loop adaptation sketch:** mirror the convention for Loop-owned children: workers already get dispatch context in prompts; add stable env markers (`LOOP_RUN_ID`, `LOOP_TASK_ID`, `LOOP_ATTEMPT`) to worker and completion-check processes so scripts, hooks, and `herdr` panes can attribute output to a run without parsing prompts. Conversely, `packages/pi-loop/src/herdr-lifecycle.ts` already derives pane state from `HERDR_PANE_ID`/`HERDR_ENV`; `docs/decisions/worker-tab-placement.md` derives the caller workspace from the same prefix — consolidate these into one documented marker contract.
- **Estimated effort:** S (env injection at spawn sites + tests asserting child env).
- **Boundary compliance:** env passing is adapter/orchestrator wiring; loop-core states and transitions unchanged; no credential values in env (ids only).

## Opportunity 7: Theme-token-aware Loop rendering (presentation personalization)

- **Source pattern:** `docs/themes.md` — 53 color tokens with `vars` and hot reload; pi extensions can read theme colors (`docs/extensions.md` — "Theme Colors" under Custom UI).
- **Loop adaptation sketch:** Loop renders human-facing lines under the `[output]` line-limit policy (`docs/decisions/ui-output-limits.md`, `packages/pi-loop/src/ui/*`). Extend the renderers to pull accent/warn/dim colors from the active pi theme (via the extension context) instead of implying fixed styling, so Loop output matches the user's terminal identity on every machine. Keep line budgets and truncation logic exactly as decided.
- **Estimated effort:** S.
- **Boundary compliance:** presentation-only change inside `pi-loop` / `@loop/presentation`; no domain state, no Rust change; the leaf presentation package stays free of provider/Pi/Herdr imports.

## Prioritization

Highest leverage first, judged by (a) removing today's friction, (b) enabling the pi-universal worker direction, (c) boundary safety:

1. **Opportunity 1 (model catalog sync)** — eliminates the recurring `Warning: Model … not found` path and makes per-class model selection robust across machines; prerequisite-quality for the pi-universal worker decision.
2. **Opportunity 2 (config-driven Lead personas)** — smallest effort, unlocks personalization and feeds the planned persona benchmark subsystem.
3. **Opportunity 3 (pi package packaging)** — turns Loop's Lead into a distributable, `pi install`-able asset, the main adoption lever identified in `docs/decisions/adoptability-verdict.md`.

Opportunities 4–7 are cheap followers: 4 and 6 harden multi-machine portability; 5 lands the wayfinder/implement insight as measured profiles; 7 is cosmetic polish.

## Verification Note

This is a desk survey; no code was changed and no paid model calls were made. Cross-checks performed: pi docs read at v0.87.0 paths listed above; `packages/pi-loop/src/extension.ts` confirmed to use `before_agent_start`, `LOOP_BIN`, and `loadLoopConfig().output`; `herdr-lifecycle.ts` confirmed to read `HERDR_PANE_ID`/`HERDR_ENV`. Offline checks still apply to any implementation slice drawn from this doc (`bun run check`, `bun run test:architecture`).
