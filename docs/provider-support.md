# Provider support

Reader: operators configuring a worker runtime.

| Adapter | Transport | Implemented behavior | Authentication |
| --- | --- | --- | --- |
| Codex | Herdr `agent kind=codex` by default; `codex exec --json` adapter available | visible pane, model/cwd/sandbox, normalized events, cancel; direct adapter also supports current resume syntax | provider-native Codex auth |
| Antigravity | Herdr `agent kind=agy` by default; `agy` print adapter available | visible pane, runtime model discovery, cwd, sandbox, stream-json, cancel, conversation resume | provider-native Antigravity auth |
| Z.AI API | OpenAI-compatible HTTP | configurable base/path/model, general vs coding-plan modes, abort, normalized result, redacted errors | API key supplied from environment by the caller |
| Z.AI CLI | configurable CLI command | availability, cwd, model, JSON output, cancel | provider-native CLI auth |
| Fake/scripted | in-process | delay, failure scripts, concurrency evidence, cancel | none |
| Pi (worker) | `pi -p` headless adapter; Herdr `agent kind=pi` for visible tabs | model patterns (`zai/glm-5.3-flash`, `zai/glm-5.3-flashx`), tools, cancellation; default route for the zai volume classes, with balanced/strong/frontier escalating through the codex exec lane (`gpt-5.6` luna/terra/sol) | pi auth store (`pi auth check --provider zai`) |
| Pi Lead | Herdr `agent kind=pi` plus installed Loop extension | natural-language intent, validated DAG submission, compact commands | Pi provider configuration |
| Herdr | supported JSON CLI commands | deterministic workspace/pane lifecycle, opaque reattachment IDs, no-focus execution | local Herdr installation |

## Failure contract

All coding providers implement one `AgentProvider` interface. Non-zero process exits and startup failures become typed failed worker results; authentication, quota, timeout, cancellation, unavailable command, incomplete output, and process failure remain distinct. Secrets are redacted from summaries and streamed chunks. A failed worker re-enters deterministic escalation while attempts remain.

## Configuration

`config/providers.example.toml` contains commands, endpoints, and an environment-variable name only. Do not place a key value in TOML or SQLite. The Z.AI API adapter reads its key from the named environment variable and sends it only in the authorization header. It remains disabled until that variable is configured.

Jev is no longer a supported provider. A disabled legacy `[providers.jev]` stanza is ignored so existing local configuration can migrate without breaking startup. Enabling that stanza fails configuration loading with `config.unsupported_provider`; remove it instead of routing work through an unmaintained endpoint.

Run `loop doctor --auth` to check the Pi Lead provider, Codex native login, and AGY native keyring without printing credentials or sending a model prompt. AGY authentication stays inside the installed `agy` CLI, which Herdr launches as `agent kind=agy`; there is no Loop-specific AGY credential store.

## Evidence boundary

Fake-run, adapter-contract, cancellation, redaction, and capability tests run offline. They prove integration behavior, not that a user's provider account is authenticated or has quota. Authenticated provider smoke tests are deliberately separate and are not required by the default test suite.
