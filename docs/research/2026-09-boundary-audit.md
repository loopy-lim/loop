# Boundary Audit: loop-core / adapters (2026-09)

- Task: `fact-boundary-audit` (research, attempt 0, read-only)
- Question 1: loop-core가 provider/Pi/Herdr/모델/엔드포인트 개념을 import하는 위반이 있는가?
- Question 2: Rust에 있어야 할 확정적 정책(deterministic policy)이 TypeScript로 새는 곳은 어디인가?
- Rule sources: `AGENTS.md` (Boundaries), `docs/architecture.md` (layer ownership table)

## Method

- Read-scope sweep: `crates/loop-core/src/**`, `crates/loop-store/src/**`, `crates/loop-bridge/src/**`, `packages/providers/src/**`, plus rule docs.
- Greps: provider/herdr/pi/endpoint/model/codex/claude/gemini/zai/antigravity/api-key/url over all three crates; compute/parallel/scheduling/policy over store and bridge; computeClass/retry/attempt over providers.
- Cross-checked dependency manifests (`Cargo.toml`) and call sites of core policy APIs (`select_candidate`, `next_compute_class`) to see what is actually wired through the bridge vs. stranded in core.

## Q1: provider/Pi/Herdr/model/endpoint concepts in loop-core — clean

No violations found. Evidence:

- `crates/loop-core/Cargo.toml` dependencies are `schemars`, `serde`, `thiserror` only — no HTTP, process, or provider crate.
- Case-insensitive scan for `provider|herdr|pi|codex|zai|antigravity|api key|http` over `crates/loop-core/src` matches only a doc comment stating the invariant itself (`crates/loop-core/src/event/reducer.rs:66`: "no provider/terminal concepts").
- Compute is an abstract ladder with no model ids: `crates/loop-core/src/policy/compute_class.rs:9-27`; routing works on anonymous `ComputeCandidate { id, compute_class, capabilities, latency, cost_weight }` (`crates/loop-core/src/policy/routing.rs:52-70`), never on model names or endpoints.
- Store stays a projection/index: retention policy is evaluated by core (`crates/loop-store/src/sqlite.rs:299` calls `loop_core::policy`), no provider calls; bridge delegates scheduling to `Scheduler::claim_runnable` (`crates/loop-bridge/src/commands.rs:426-433`), matching the architecture table (Store: no provider calls/scheduling policy; Bridge: no model-specific behavior).

## Q2 + violation candidate table

Rule references: AGENTS.md B1="Never import provider/Pi/Herdr/model/endpoint concepts into loop-core", B2="Put deterministic policy in Rust, keep TS adapters thin", B3="Model IDs and provider endpoints only in configuration or adapter construction", B4="Do not hand-write a TypeScript copy of a Rust domain type". architecture.md A1="Orchestrator/adapters must not own duplicated scheduler rules".

| # | Candidate | Evidence | Rule | Verdict |
|---|---|---|---|---|
| 1 | Capability/latency/cost/risk-aware provider routing exists in Rust but is not exposed via the bridge; runtime provider selection is a TS first-match loop that ignores cost, latency, and risk floors | Rust: `crates/loop-core/src/policy/routing.rs:106-137` (`select_candidate`, risk floors `effective_minimum`); only callers outside core are tests (`crates/loop-core/tests/scheduler_domain.rs:6`), no `loop-bridge` command wraps it. TS: `packages/providers/src/registry.ts:12-24` (`ProviderRegistry.select` returns first available provider whose `computeClasses` includes the class; no min/max bounds, no cost tiebreak) | B2, A1 | **Violation (moderate)** — selection policy duplicated in TS with weaker semantics |
| 2 | Default compute-class membership ladders hard-coded as string arrays in six adapter constructors instead of one configuration source | `packages/providers/src/pi/adapter.ts:39`, `packages/providers/src/codex/adapter.ts:43`, `packages/providers/src/zai/api.ts:56`, `packages/providers/src/zai/cli.ts:30`, `packages/providers/src/antigravity/adapter.ts:34`, `packages/providers/src/antigravity/persistent.ts:56` | B3 (spirit), B2 | **Gray** — allowed location (adapter construction) but per-provider capability defaults in code drift silently from `config/models.toml` stance claimed for model ids |
| 3 | Untyped TS strings mirror the Rust `ComputeClass` serde vocabulary with no shared contract | Rust enum: `crates/loop-core/src/policy/compute_class.rs:9-18` (snake_case serde); TS side passes `computeClass: string` / `computeClasses: string[]` (`packages/providers/src/types.ts:17,30`), so typos surface only at runtime `registry.select` failure | B4 | **Gray** — a stringly-typed copy of a Rust domain enum; the generated protocol is the right home |
| 4 | `WorkerStatus` is a hand-written near-copy of Rust `WorkerState` that already diverged (`failed` vs `lost`) | TS: `packages/providers/src/types.ts:5` (`"starting"|"running"|"completed"|"failed"|"cancelled"`); Rust: `crates/loop-core/src/run/worker.rs:6-12` (`Lost`, no `Failed`) | B4 | **Violation (low)** — two state vocabularies for the same concept; reconciliation (`Lost`/`CompletedNeedsResult`) is Rust-side (`crates/loop-bridge/src/execution.rs:338`), so TS `failed` is a third meaning |
| 5 | Failure taxonomy + retryability classification lives only in TS | `packages/providers/src/types.ts:7-15` (`ProviderFailureKind`, `retryable`); classification at `packages/providers/src/zai/api.ts:149-158` (401/403→auth, 429→quota, retryable iff 429/5xx), `packages/providers/src/antigravity/driver.ts:159-335`; Rust side stores only opaque `last_failure: Option<String>` (`crates/loop-bridge/src/commands.rs:188`) and decides attention on exhaustion (`crates/loop-bridge/src/commands.rs:1046-1080`) | B2 | **Gray** — per-protocol error mapping is adapter-shaped normalization (allowed), but the cross-provider retry/escalation semantics encoded in `retryable` have no Rust counterpart to verify against |
| 6 | Store encodes `ComputeClass` into the `attempts` table via `Debug` formatting | `crates/loop-store/src/sqlite.rs:452` (`format!("{:?}", task.preferred_compute).to_lowercase()`), schema `crates/loop-store/src/schema.rs:33` | — (robustness, not layering) | **Note** — couples persisted values to Rust variant identifiers instead of the serde contract; renaming a variant silently changes stored strings |
| 7 | Leftover empty directory `packages/providers/src/jev/` (no files, not exported) | `packages/providers/src/index.ts` (exports list) | — | **Note** — dead path, harmless |

Clean confirmations worth recording: worker prompt building and credential redaction stay adapter-side per the architecture table (`packages/providers/src/prompt.ts`, `packages/providers/src/redact.ts:1-7`); pi `models.json` provisioning derives strictly from config and embeds no model ids (`packages/providers/src/pi/models-json.ts:17-24`); scheduler capacity, frontier cap, decision/integration serialization, and write-scope conflicts are all Rust (`crates/loop-core/src/scheduler/scheduler.rs:17-52`, `crates/loop-core/src/task/kind.rs:15-17`, `crates/loop-core/src/scheduler/conflicts.rs:1`); escalation-on-failure clamps to `maximum_compute` in the reducer (`crates/loop-core/src/event/reducer.rs:190`), which is the correct home for the new `maximumCompute=frontier` allowance.

## Findings

1. loop-core는 provider/Pi/Herdr/모델/엔드포인트 개념 위반 없음 — 유일한 언급은 불변식을 서술하는 주석 `crates/loop-core/src/event/reducer.rs:66`, 의존성은 serde/schemars/thiserror뿐 (`crates/loop-core/Cargo.toml`).
2. 확정적 라우팅 정책이 Rust에 있으나 교량 미노출로 사실상 사장됨: `crates/loop-core/src/policy/routing.rs:120` `select_candidate`는 테스트에서만 호출되고, 런타임 선택은 비용/지연/리스크 무시 first-match TS 루프 `packages/providers/src/registry.ts:14-21`가 담당 — B2/A1 위반.
3. 6개 어댑터 생성자에 계산등급 기본 사다리가 하드코딩됨: `packages/providers/src/pi/adapter.ts:39`, `packages/providers/src/codex/adapter.ts:43`, `packages/providers/src/zai/api.ts:56`, `packages/providers/src/zai/cli.ts:30`, `packages/providers/src/antigravity/adapter.ts:34`, `packages/providers/src/antigravity/persistent.ts:56` — 설정 단일 소스 원칙(B3 정신)과 어긋나는 회색지대.
4. Rust 도메인 타입의 수기 TS 사본이 이미 발산: `WorkerStatus`(`packages/providers/src/types.ts:5`)는 `WorkerState`(`crates/loop-core/src/run/worker.rs:6-12`)의 `lost` 대신 `failed`를 가짐 — B4 위반 저위험; `ComputeClass`도 문자열로만 복사됨(`packages/providers/src/types.ts:30`).
5. 실패 분류·재시도 가능 판단은 TS 전용(`packages/providers/src/types.ts:7-15`, `packages/providers/src/zai/api.ts:149-158`)이고 Rust는 opaque 문자열만 저장(`crates/loop-bridge/src/commands.rs:188`) — 검증 가능한 Rust 대응물이 없어 B2 회색지대; 부차적으로 `crates/loop-store/src/sqlite.rs:452`가 serde 계약이 아닌 Debug 포맷으로 등급을 저장.

## Suggested follow-ups (input for decision task)

- Expose a bridge command wrapping `select_candidate` (or fold provider selection into `claim_runnable_tasks`) and reduce `ProviderRegistry.select` to an executor of the Rust decision.
- Move default `computeClasses` ladders into `config/models.toml`-adjacent configuration or the generated protocol, deleting the six hard-coded defaults.
- Replace hand-written `WorkerStatus`/compute-class strings with generated protocol types; decide the `failed` vs `lost` vocabulary once, in Rust.
- Store `ComputeClass` via its serde representation, not `Debug` formatting.
