# Provider support

Reader: operators configuring a worker runtime.

| Adapter | Transport | Implemented behavior | Authentication |
| --- | --- | --- | --- |
| Codex | Herdr `agent kind=codex` by default; `codex exec --json` adapter available | visible pane, model/cwd/sandbox, normalized events, cancel; direct adapter also supports current resume syntax | provider-native Codex auth |
| Antigravity | AgyPersistentProvider by default (`mode = "persistent"` in config/providers.example.toml; packages/providers/src/antigravity/persistent.ts); Herdr `agent kind=agy` for visible tabs; `agy` print adapter for the print mode | persistent mode: one stream-json `agy` process per session, the conversation continues across turns via agy's native conversation id, resume reattaches with `--conversation`, cancel, typed failures; Herdr mode: visible pane, runtime model discovery, cwd, sandbox; print adapter: model discovery, cwd, sandbox, stream-json, cancel, conversation resume | provider-native Antigravity auth (agy's own native store; no key passes through Loop) |
| Z.AI API | OpenAI-compatible HTTP | configurable base/path/model, general vs coding-plan modes, abort, normalized result, redacted errors | API key supplied from environment by the caller |
| Z.AI CLI | configurable CLI command | availability, cwd, model, JSON output, cancel | provider-native CLI auth |
| Fake/scripted | in-process | delay, failure scripts, concurrency evidence, cancel | none |
| Pi (worker) | `pi -p` headless adapter; Herdr `agent kind=pi` for visible tabs | model patterns (`zai/glm-5.3-flash`, `zai/glm-5.3-flashx`, `openai-codex/gpt-6-luna`, `openai-codex/gpt-6-sol`), tools, cancellation; default route for the zai volume classes plus the gpt-6 primary lane (mixed routing, 2026-09-23): balanced prefers `zai/glm-5.3-flashx:high` on this lane and frontier `openai-codex/gpt-6-sol` on this lane, while the codex exec lane retains its `gpt-5.6` luna/terra/sol line plus the gpt-6 fallback and antigravity gemini remains fallback | pi auth store for the zai volume classes (`pi auth check --provider zai`); the gpt-6 luna/sol lane authenticates through pi's `openai-codex` provider with ChatGPT native login (credentials stay in pi's own auth store, never logged or persisted by Loop) |
| Pi Lead | Herdr `agent kind=pi` plus installed Loop extension | natural-language intent, validated DAG submission, compact commands | Pi provider configuration |
| Herdr | supported JSON CLI commands | deterministic workspace/pane lifecycle, opaque reattachment IDs, no-focus execution | local Herdr installation |

## Failure contract

All coding providers implement one `AgentProvider` interface. Non-zero process exits and startup failures become typed failed worker results; authentication, quota, timeout, cancellation, unavailable command, incomplete output, and process failure remain distinct. Secrets are redacted from summaries and streamed chunks. A failed worker re-enters deterministic escalation while attempts remain.

## Configuration

`config/providers.example.toml` contains commands, endpoints, and an environment-variable name only. Do not place a key value in TOML or SQLite. The Z.AI API adapter reads its key from the named environment variable and sends it only in the authorization header. It remains disabled until that variable is configured.

Jev is no longer a supported provider. A disabled legacy `[providers.jev]` stanza is ignored so existing local configuration can migrate without breaking startup. Enabling that stanza fails configuration loading with `config.unsupported_provider`; remove it instead of routing work through an unmaintained endpoint.

Run `loop doctor --auth` to check the Pi Lead provider, Codex native login, and AGY native keyring without printing credentials or sending a model prompt; the pi lane's `openai-codex` ChatGPT login lives inside pi's own auth store and has no separate Loop-side probe. AGY authentication stays inside the installed `agy` CLI, which Herdr launches as `agent kind=agy`; there is no Loop-specific AGY credential store.

Custom model ids (for example `glm-5.3-flashx` on the pi lane) are registered into pi's catalog by syncing `config/models.toml` profiles into a pi `models.json` fragment, so they spawn without the "Using custom model id" warning. Named Lead personas and the portable config roots checked by `loop doctor` (`LOOP_CONFIG_DIR`, `PI_CODING_AGENT_DIR`, `HERDR_*`) are described in [docs/environment-generalization.md](environment-generalization.md).

## Evidence boundary

Fake-run, adapter-contract, cancellation, redaction, and capability tests run offline. They prove integration behavior, not that a user's provider account is authenticated or has quota. Authenticated provider smoke tests are deliberately separate and are not required by the default test suite.
