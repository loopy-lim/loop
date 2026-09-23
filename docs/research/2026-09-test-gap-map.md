# Test coverage gap map — 2026-09

- Task: `fact-test-gap-map` (research, read-only)
- Question: public 모듈/명령 중 직접적인 테스트 파일이 없는 것은 어디인가
- Scope: `crates/{loop-core,loop-store,loop-bridge}` src+tests, `packages/{herdr,orchestrator}` src+test
- Method: 오프라인 정적 분석만. 테스트 파일의 `use`/`import` 및 호출부 grep으로 모듈→테스트 매핑. 유료 모델 호출 없음.

## crates: module → test mapping

| 모듈 (src) | 직접 테스트 파일 | 비고 |
| --- | --- | --- |
| loop-core `attention` (+resolution) | tests/scheduler_domain.rs, tests/cleanup_policy.rs | 커버됨 |
| loop-core `benchmark/profile` | tests/benchmark_profile.rs | 커버됨 |
| loop-core `benchmark/trace` | tests/benchmark_trace.rs | 커버됨 |
| loop-core `error` | tests/cleanup_policy.rs:271 (CleanupRefused 변환만) | 부분 커버 |
| loop-core `event` (+reducer) | tests/event_reducer.rs, tests/durable_context.rs | 커버됨 |
| loop-core `graph` (dag/validation) | tests/scheduler_domain.rs:31,37 (MissingDependency, Cycle) | DuplicateTask 변체 미검증 |
| loop-core `policy/cleanup` | tests/cleanup_policy.rs | 커버됨 |
| loop-core `policy/compute_class`, `policy/routing` | tests/scheduler_domain.rs:6,130-133 (select_candidate), tests/event_reducer.rs | 커버됨 |
| loop-core `run/run` (RunState) | tests/event_reducer.rs, tests/cleanup_policy.rs | 커버됨 |
| loop-core `run/worker` (Worker, WorkerState) | **없음** | 아래 근거 |
| loop-core `run/result` (WorkerResult) | **없음** | 아래 근거 |
| loop-core `scheduler` (+capacity, conflicts) | tests/scheduler_domain.rs | 커버됨 |
| loop-core `task/*` | tests/event_reducer.rs, tests/scheduler_domain.rs, loop-store tests | 커버됨 |
| loop-bridge `commands` | tests/commands.rs (17개 명령), tests/context.rs (configure/prepare/steer, get_task_context) + 호출 grep: claim_execution, release_execution, reconcile_task, resume_run | 부분 커버 — 아래 미커버 목록 |
| loop-bridge `execution` | tests/context.rs, tests/commands.rs | 부분 커버 |
| loop-bridge `events` (EventOutput, RunChangedEvent) | **없음** | subscribe_events 미호출로 경로 접근 불가 |
| loop-bridge `bin/generate.rs` | **없음** | 코드젠 binary (13줄 wrapper) |
| loop-store `sqlite` | tests/{execution,purge,recovery,trace,projection_performance}.rs | 커버됨 |
| loop-store `trace` | tests/trace.rs | 커버됨 |
| loop-store `migration`, `schema` (private) | **없음** | 모든 SqliteStore 테스트가 migrate를 우회 간접 실행; 직접 마이그레이션/레거시 키 이관 케이스는 무전용 테스트 |

### crates 미커버 근거 (file:line)

- `crates/loop-core/src/run/worker.rs:7,16` — `WorkerState`, `Worker` 는 `run/mod.rs:7` 에서 재수출되는 public API 이나 src/tes측 그 어디서도 참조 없음 (grep: 정의·재수출 외 0건). 미사용+무테스트.
- `crates/loop-core/src/run/result.rs:7` — `WorkerResult` 도 `run/mod.rs:5` 재수출만 존재, 참조 0건. 미사용+무테스트.
- `crates/loop-bridge/src/events.rs:4,10` — `EventOutput`, `RunChangedEvent` 은 `subscribe_events`(commands.rs:751) 출력으로만 소비되는데 `subscribe_events` 가 테스트에서 미호출.
- loop-bridge public 명령 중 `crates/loop-bridge/tests/` 에서 호출 0건 (grep `\b<fn>\(`):
  - commands.rs: `get_run`:316, `add_task`:343, `update_task`:358, `record_decision`:573, `pause_run`:706, `confirm_paused`:714, `record_worker_stopped`:722, `subscribe_events`:751, `evaluate_worktree_removal`:855, `evaluate_surface_removal`:883
  - execution.rs: `record_check_receipts`:268, `stop_verification`:283, `record_activity`:297, `renew_execution`:321, `list_runs`:396
  - 완화: pause/resume·record_decision 등은 packages/orchestrator 테스트가 생성된 protocol 경유로 간접 커버 (interventions.test.ts:43-57 등). 직접(bridge 크레이트 내) 테스트는 없음.

## packages: module → test mapping

| 모듈 (src) | 직접 테스트 파일 | 비고 |
| --- | --- | --- |
| herdr `bounded-sender.ts` | **없음** | BoundedPaneSender 무테스트·read scope 내 사용처 없음 |
| herdr `client.ts` | test/runner.test.ts (NodeHerdrRunner), test/lifecycle.test.ts (HerdrWorkerRuntime, barrel 경유) | 커버됨 |
| herdr `pane.ts` | 없음 (type-only: PaneRef) | 타입 전용 — 런타임 갭 아님 |
| herdr `worker.ts` | 없음 (type-only) | 타입 전용 |
| herdr `worktree.ts` | **없음** | client.ts:120,166 에서 간접 사용, 가드 실패 분기 무테스트 |
| orchestrator `benchmark.ts` | test/benchmark.test.ts (barrel import) | 커버됨 |
| orchestrator `cleanup.ts` | test/cleanup.test.ts | 커버됨 |
| orchestrator `completion.ts` | test/completion.test.ts, interventions, persona | 커버됨 |
| orchestrator `composition.ts` | **없음** | buildProviderRegistry 무테스트 |
| orchestrator `config.ts` (+model-registry) | test/config.test.ts, benchmark, persona | 커버됨 |
| orchestrator `control.ts` | 없음 (type-only: OrchestrationControl) | pause/resume 동작은 coordinator 경유 interventions.test.ts:43-57 간접 커버 |
| orchestrator `coordinator.ts` | test/interventions, milestone, persona, persistent-lifecycle | 커버됨 |
| orchestrator `persona.ts` | test/persona.test.ts | 커버됨 |
| orchestrator `redact.ts` | test/redact.test.ts | 커버됨 |
| orchestrator `runtime.ts` | test/runtime.test.ts | 커버됨 |
| orchestrator `task-execution.ts` | test/persona.test.ts:15 (executeTask) | 단일 파일 진입 — 간주 커버, 분기 커버는 얕음 |

### packages 미커버 근거 (file:line)

- `packages/herdr/src/bounded-sender.ts:12` — `BoundedPaneSender` 의 coalesce/interval/queue-limit/suppression-marker 로직(67줄)은 테스트 0건이며 herdr·orchestrator src 내 사용처도 0건 (read scope 기준).
- `packages/herdr/src/worktree.ts:3` — `assertWorktreeInsideProject` 가드의 실패 경로(절대경로 아님/프로젝트 밖) 직접 테스트 없음. 정상 경로만 client.ts 경유 간접 통과.
- `packages/orchestrator/src/composition.ts:23` — `buildProviderRegistry` 는 테스트에서 미호출; 각 테스트가 `new ProviderRegistry()` + FakeProvider 로 수동 조립 (예: interventions.test.ts:11).

## Findings

1. loop-bridge: 15개 public 명령과 `events.rs` 출력 타입이 크레이트 내 직접 테스트 0건 — get_run:316, add_task:343, update_task:358, record_decision:573, pause_run:706, confirm_paused:714, record_worker_stopped:722, subscribe_events:751, evaluate_worktree_removal:855, evaluate_surface_removal:883, record_check_receipts:268, stop_verification:283, record_activity:297, renew_execution:321, list_runs:396; 일부는 orchestrator 테스트가 간접 커버.
2. loop-core: `run/worker.rs:7,16`(Worker/WorkerState)·`run/result.rs:7`(WorkerResult) 은 재수출만 존재하는 미사용 public API — 무테스트이며 제거 또는 사용처 추가 결정 필요.
3. loop-store: private `migration.rs`/`schema.rs` 에 직접 테스트 없음 — 전 store 테스트가 우회 간접 실행만 하므로 레거시 키 이관(migration.rs:8-11) 회귀 방어 없음.
4. herdr: `bounded-sender.ts:12`(BoundedPaneSender 배압 로직)·`worktree.ts:3`(경로 가드 실패 분기) 직접 테스트 없음; BoundedPaneSender 는 사용처도 없어 죽은 수출 후보.
5. orchestrator: `composition.ts:23`(buildProviderRegistry) 무테스트, `task-execution.ts` 는 persona.test.ts 단일 진입으로 커버 얕음 — 나머지 모듈은 1:1 테스트 파일 존재.

---

## 상태 정정 — 2026-09-24 (`decide-cleanup` 추기)

- findings 4행의 "BoundedPaneSender 는 사용처도 없어 죽은 수출 후보" 주장은 **무효**: 워커 가시성 작업(`ecee48c`) 이후 `packages/providers/src/mirror.ts:2,276`에서 실사용 중. 근거: `docs/decisions/2026-09-24-weird-cleanup.md` S-7'.
- "직접 테스트 없음" 부분은 여전히 사실(모듈표 47행 포함) — 무효화는 죽은 수출 주장에만 적용된다.
- findings 1행의 bridge 명령 직접 테스트 공백은 부분 해소: 6종 명령(get_run, add_task, update_task, record_decision, pause_run/confirm_paused, subscribe_events)의 직접 테스트가 `crates/loop-bridge/tests/commands-direct.rs`로 착지(커밋 `9724e81`). 나머지 9종은 여전히 간접 커버만.
- findings 3행의 loop-store 마이그레이션 직접 테스트 공백은 해소: `crates/loop-store/tests/worker-state-vocabulary.rs` 및 migration·schema 직접 테스트 착지(커밋 `cbb3b74`).
