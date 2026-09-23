# GPT-6 Model Configuration Verification Audit

- **Date:** 2026-09-23
- **Scope:** Repository verification for the addition of `gpt-6-luna` and `gpt-6-sol` to Loop model configuration and routing documentation
- **Status:** PASS (all automated checks passed with 0 failures)
- **Reference Configurations:**
  - [`config/models.toml`](file:///Users/loopy/dev/ll3/loop/config/models.toml)
  - [`config/providers.example.toml`](file:///Users/loopy/dev/ll3/loop/config/providers.example.toml)
  - [`docs/model-routing.md`](file:///Users/loopy/dev/ll3/loop/docs/model-routing.md)

---

## 1. Executive Summary

Automated verification for the addition of OpenAI ChatGPT codex-lane models `gpt-6-luna` and `gpt-6-sol` completed successfully. The end-to-end repository gate `bun run check` passed completely with zero test failures, zero typecheck errors, and zero architectural boundary violations.

In accordance with [`AGENTS.md`](file:///Users/loopy/dev/ll3/loop/AGENTS.md) ("Real-provider or authenticated CLI checks are separate evidence. Unit and milestone tests must never require a paid model call"), verification relies strictly on local deterministic tests, protocol codegen checks, typechecks, and architecture assertions. Smoke verification of real model execution was performed upfront by the Lead via `codex exec` and is documented below.

---

## 2. Lead-Provided Smoke Evidence

Live CLI smoke verification was conducted by the Lead prior to configuration integration.

| Parameter | Value |
|---|---|
| **CLI Tool** | `codex-cli 0.155.1` |
| **Provider Lane** | `codex` (`mode = "exec"`, native ChatGPT login via [`config/providers.example.toml`](file:///Users/loopy/dev/ll3/loop/config/providers.example.toml)) |
| **Lane Separation** | Runs on `codex` provider lane, NOT the `pi` lane (which carries `zai` volume classes) |
| **Authentication** | Native login (`auth = "native"`), credentials maintained in Codex auth store; zero credentials logged or persisted |

### Invocations and Results
1. **`gpt-6-luna`**:
   - Command: `codex exec --json -m gpt-6-luna`
   - Result: Successful completed turn returning item text `OK-LUNA` with full usage metrics.
2. **`gpt-6-sol`**:
   - Command: `codex exec --json -m gpt-6-sol`
   - Result: Successful completed turn returning item text `OK-SOL` with full usage metrics.

### Configuration Decisions
- **`gpt-6-luna`** is configured under compute class `balanced` (`latency = 2`, `cost_weight = 2`), mirroring `gpt-5.6-luna`.
- **`gpt-6-sol`** is configured under compute class `frontier` (`latency = 3`, `cost_weight = 4`), mirroring `gpt-5.6-sol`.
- **`gpt-6-terra`** is deliberately absent because smoke evidence has not yet been gathered.
- **Fallback Strategy**: Existing `gpt-5.6-luna`, `gpt-5.6-terra`, and `gpt-5.6-sol` entries remain intact as reliable fallbacks.

---

## 3. Scope of Changes

- **[`config/models.toml`](file:///Users/loopy/dev/ll3/loop/config/models.toml)**:
  - Added `[[models]]` entries for `gpt-6-luna` (`balanced`) and `gpt-6-sol` (`frontier`).
  - Total model count expanded from 12 to 14.
  - Updated header comments and section documentation to describe the gpt-6 line and fallback hierarchy.
- **[`config/providers.example.toml`](file:///Users/loopy/dev/ll3/loop/config/providers.example.toml)**:
  - Updated routing comments for `[providers.codex]` noting `gpt-6 luna/sol` with `gpt-5.6` as fallback.
- **[`docs/model-routing.md`](file:///Users/loopy/dev/ll3/loop/docs/model-routing.md)**:
  - Updated model routing table notes to reflect `gpt-6 luna/sol` smoke verification on codex-cli 0.155.1.
- **Test Invariants**:
  - [`packages/orchestrator/test/config.test.ts`](file:///Users/loopy/dev/ll3/loop/packages/orchestrator/test/config.test.ts): Verified compute class lookups for `gpt-6-luna` and `gpt-6-sol`, and confirmed deterministic ordering for `frontier` candidates (`gemini-3.1-pro-low`, `gpt-5.6-sol`, `gpt-6-sol`).
  - [`packages/cli/test/cli.test.ts`](file:///Users/loopy/dev/ll3/loop/packages/cli/test/cli.test.ts): Updated JSON model list expectation to 14 models.

---

## 4. End-to-End Verification (`bun run check`)

- **Command:** `bun run check`
- **Working Directory:** `/Users/loopy/dev/ll3/loop`
- **Result:** Exit code `0` (ALL CHECKS PASSED)

### Pipeline Breakdown

| Stage | Command | Result | Notes |
|---|---|---|---|
| **1. Codegen Check** | `bun run codegen:check` (`bun scripts/rustra-codegen.ts --check`) | **PASS** | Generated TypeScript bindings match Rust schema exactly |
| **2. TypeScript Typecheck** | `bun run typecheck` (`tsc -p tsconfig.json`) | **PASS** | Zero compiler diagnostics / type errors |
| **3. Architecture Boundaries** | `bun run test:architecture` (`bun test tests/architecture-boundaries.test.ts`) | **PASS** | 6/6 tests passed (156 expect assertions) |
| **4. Rust Workspace Tests** | `cargo test --workspace` | **PASS** | 84 tests passed across `loop-core`, `loop-store`, and `loop-bridge` |
| **5. Bridge Build** | `cargo build -p loop-bridge` | **PASS** | Bridge crate builds cleanly |
| **6. TypeScript Test Suites** | `bun test packages tests plugins scripts/rustra-codegen.test.ts` | **PASS** | 214/214 tests passed across 32 files (1020 expect assertions) |

---

## 5. Key Verification Evidence Lines

### 1. Codegen and Typecheck
```text
$ bun run codegen:check && bun run typecheck && bun run test:architecture && bun run test
$ bun scripts/rustra-codegen.ts --check
[rustra] Rust schema: cargo run --manifest-path crates/loop-bridge/Cargo.toml --package loop-bridge --bin loop-bridge-generate
[rustra] ✓ Rust schema generation (loop-bridge/loop-bridge-generate) done in 0.1s
[rustra] TypeScript/C++: generate --config .../rustra.json
Generated TypeScript files in ...: types.ts, commands.ts, contract.ts, frame-codecs.ts, frame-registry.ts, events.ts, bun.ts
$ tsc -p tsconfig.json
```

### 2. Architecture Boundary Verification
```text
$ bun test tests/architecture-boundaries.test.ts
bun test v1.4.1 (4661e494f)

tests/architecture-boundaries.test.ts:
✓ loop-core exports only provider-neutral orchestration modules [1.37ms]
✓ generated Rustra bindings are the only TypeScript to Rust seam [0.08ms]
✓ provider, Pi, SQLite, and generated protocol dependencies do not invert [4.85ms]
✓ configuration keeps model names and provider endpoints out of business logic [1.46ms]
✓ the repository contains no recovered legacy product surfaces [0.08ms]
✓ the interactive Loop Lead never owns Herdr workspace or attachment lifecycle [0.12ms]

 6 pass
 0 fail
 156 expect() calls
Ran 6 tests across 1 file. [111.00ms]
```

### 3. Model Configuration and Registry Tests
From [`packages/orchestrator/test/config.test.ts`](file:///Users/loopy/dev/ll3/loop/packages/orchestrator/test/config.test.ts):
```text
packages/orchestrator/test/config.test.ts:
✓ loads the repository configuration into typed runtime data [0.73ms]
✓ resolves explicit, environment, XDG, then home configuration directories [0.03ms]
✓ rejects duplicate model id [0.71ms]
✓ rejects unknown compute class [0.38ms]
✓ rejects invalid concurrency [0.37ms]
✓ rejects literal secret [0.44ms]
✓ rejects invalid credential environment name [2.06ms]
✓ rejects missing credential environment name [0.62ms]
✓ reports missing required configuration files with a stable error code [0.18ms]
✓ preserves custom output limits [0.46ms]
```
Evidence points:
- `ModelRegistry` successfully parsed `gpt-6-luna` (`balanced`) and `gpt-6-sol` (`frontier`).
- Frontier ordering assertion verified tie-breaking order: `["gemini-3.1-pro-low", "gpt-5.6-sol", "gpt-6-sol"]` by `cost_weight + latency = 7` sorted lexicographically by id.

### 4. CLI Model Listing Test
From [`packages/cli/test/cli.test.ts`](file:///Users/loopy/dev/ll3/loop/packages/cli/test/cli.test.ts):
```text
packages/cli/test/cli.test.ts:
✓ human models output is a bounded list while JSON remains complete [3.45ms]
```
Evidence points:
- `expect(JSON.parse(json.stdout())).toHaveLength(14);` passed, proving both new models are exposed by the CLI layer without breaking pagination/truncation rules for human output.

### 5. Full Test Suite Summary
```text
 214 pass
 0 fail
 1020 expect() calls
Ran 214 tests across 32 files. [10.88s]
```

---

## 6. Architectural Boundary Invariant Review

Per [`AGENTS.md`](file:///Users/loopy/dev/ll3/loop/AGENTS.md):
- **Boundary rule:** `loop-core → loop-store → loop-bridge → generated protocol → orchestrator → adapters/UI`
  - `gpt-6-luna` and `gpt-6-sol` are declared exclusively in `config/models.toml`.
  - `loop-core` contains zero references to `gpt-6` or provider endpoints.
  - The model registry in `orchestrator` consumes the TOML config and abstracts compute classes (`balanced`, `frontier`) away from the scheduling core.
- **Credentials and Auth:**
  - Codex lane uses native ChatGPT auth via `codex exec`. No credentials or tokens are stored, persisted, or logged in Loop.

---

## 7. Unresolved Risks

- **`gpt-6-terra`**: Currently omitted because live smoke evidence has not yet been obtained. If workloads require strong-tier OpenAI models, `gpt-5.6-terra` will continue to be selected on fallback.
- **Provider Rate Limits / Quotas**: As new frontier models, `gpt-6-sol` usage should be monitored under sustained workloads to ensure ChatGPT native rate limits are respected by Codex exec.
