# Code & Design Quality Review — Loop Repository

- 날짜: 2026-xx (task `review-code-design`)
- 범위: `crates/loop-core`, `crates/loop-store`, `crates/loop-bridge`, `packages/orchestrator`, `packages/protocol`, `packages/cli`
- 기준: `AGENTS.md` 경계 규칙 (`loop-core → loop-store → loop-bridge → generated protocol → orchestrator → adapters/UI`), `docs/architecture.md` 레이어 표
- 증거 실행 결과 (모두 통과):
  - `cargo test -p loop-core`: 74 passed, 0 failed (lib 21 + 통합 53)
  - `cargo test -p loop-store`: 33 passed, 0 failed, 1 ignored (`projection_performance` 측정 전용)
  - `cargo test -p loop-bridge`: 66 passed, 0 failed (lib 30 + commands 23 + commands-direct 7 + context 2 + guidance_delivery 4)
  - `bun run test:architecture`: 8 pass, 0 fail, 493 assertions
  - `bun run codegen:check`: 통과 (생성물 최신)

## Strengths

1. **Rust 워크스페이스 의존 위생이 규칙 그대로다.** `crates/loop-core/Cargo.toml`은 외부 deps가 serde/schemars/thiserror뿐이고 내부 크레이트 의존이 없다. store→core, bridge→{core,store,rustra} 순서만 존재하며, TS side도 동일한 화살표다: `packages/presentation`은 `@loop/protocol`만, `providers/turnloop`은 protocol+계약만 import한다. `tests/architecture-boundaries.test.ts`(493 assertions)가 이를 기계 검증한다.
2. **Rust↔TS 유일한 seam이 생성물이다.** `packages/protocol/src/generated/*`(7,599줄)는 `bun run codegen`으로 재생성되고 `codegen:check`가 green이다. 아키텍처 테스트가 hand-written client(`packages/protocol/src/client.ts`)의 부재와 `TaskSpecInput` 정의가 `generated/types.ts`에만 존재함을 강제한다 (`tests/architecture-boundaries.test.ts` "generated Rustra bindings are the only TypeScript to Rust seam").
3. **이벤트 소싱 저장소의 영속 계약이 테스트로 얼어 있다.** `crates/loop-store/src/schema.rs` — append-only `events` 테이블이 권위이고 나머지 테이블은 재구성 가능한 인덱스. WAL+FK, `projection_cache`, 실행 리스(`claim_execution_at`이 TTL 1_000..=60_000ms 검증). `crates/loop-store/tests/worker-state-vocabulary.rs`가 저장 단어(`typeddecision`의 의도적 serde 불일치 포함)를 고정한다.
4. **결정론적 스케줄 정책이 Rust에만 있고 TS가 복제하지 않는다.** `Scheduler::claim_runnable`(`crates/loop-core/src/scheduler/scheduler.rs`)이 capacity, serial-kind 직렬화, write/read scope 겹침, semantic touchpoint 충돌을 단독 소유한다. orchestrator는 bridge `claim_runnable_tasks`(`crates/loop-bridge/src/commands.rs:563`)로만 claim하며 readiness를 재구현하지 않는다.
5. **불변식 중심 테스트 문화다.** reducer 테스트가 "검증 증거 없는 완료 불가", "generic TaskReady가 정합 회피 불가"를 증명하고(`crates/loop-core/tests/event_reducer.rs:42,191`), milestone 테스트가 계약 게이트 완료·scope 겹침 직렬화·재시도 소진 시 하위 차단을.coverage한다(`packages/orchestrator/test/milestone.test.ts:322,346`). policy 단위 테스트는 fail-closed 기본값을 핀다(`crates/loop-core/src/policy/mod.rs` 테스트).

## Risks/Defects

1. **Rust↔TS 문자열/상수 미러 3곳이 lockstep 테스트 없이 유지된다.** (a) `WorkerState` TS union `packages/providers/src/types.ts:17` ↔ `crates/loop-core/src/run/worker.rs` serde 형태 — Rust 측은 테스트가 pin하지만 TS 측 검증은 없다. (b) `ACTIVITY_HISTORY_LIMIT = 8` `packages/orchestrator/src/config.ts:113` ↔ `crates/loop-core/src/event/reducer.rs:89` — 코멘트로만 참조. (c) `WorkflowProfileName` `packages/orchestrator/src/benchmark.ts:19` ↔ `crates/loop-core/src/benchmark/profile.rs` kebab-case. 전부 "의도적 복사"로 문서화돼 있지만 자동 검증이 없어 Rust 측 변경은 런타임(또는 상수의 경우 침묵)까지 실패하지 않는다.
2. **bridge 프로세스 경계 파일이 모놀리식이다.** `crates/loop-bridge/src/commands.rs` 1,970줄에 40+ `#[command]`가 dispatch·이벤트 조립·에러 매핑·임베디드 테스트를 함께 담고, `execution.rs` 1,009줄이 뒤따른다. 가장 자주 바뀌는 seam에서 리뷰 비용과 충돌 면적이 계속 증가한다.
3. **스케줄 일시정지 정책이 core가 아니라 bridge에 인코딩돼 있다.** `claim_runnable_tasks`(`crates/loop-bridge/src/commands.rs:570-574`)가 `run_state != Active || has_open_attention()`을 판정해 빈 목록을 반환한다. `docs/architecture.md` 스케줄링 규칙 3("Pause when the run has open attention")의 소유자가 bridge 커맨드이며, 호출자는 "일시정지/어텐션 보유"와 "실행 가능 없음"을 구분할 수 없다.
4. **CLI front door가 1,124줄 단일 파일이다.** `packages/cli/src/main.ts`에 argv 파싱, doctor, 인증, steer relay, pairing, payload 파서가 공존한다. TS 트리에서 가장 큰 파일이며 앱 surface가 mobile로 수렴하는 시점에서 최초 접점 유지보수 리스크다.
5. **core 모듈 범위가 문서화된 charter에서 벗어나기 시작했다.** `docs/architecture.md`는 Core 소유를 "task/DAG invariants, readiness, conflicts, capacity, compute classes, transitions"로 규정하지만 core는 `benchmark`(trace 채점/랭킹, `crates/loop-core/src/benchmark/trace.rs`)도 export한다. 결정론 정책이라 방어 가능하지만 core 감사 면적을 키우며 export whitelist 테스트만이 유일한 방어선이다.

## Boundary-rule violations found

1. **loop-core 내 live 위반 없음.** 수동 스캔 + `test:architecture`의 정규식 게이트(provider/endpoint/model명 차단) 모두 통과. 어휘가 provider-neutral이다(`ComputeCandidate`, `ComputeCapabilities`, `Risk`).
2. **문서화된 예외 1건 (live 누수 아님):** `WorkerState` TS frozen-contract 복사본(`packages/providers/src/types.ts:6-17`) — 표면상 "Do not hand-write a TypeScript copy of a Rust domain type" 위반이나, bridge 전송이 `WorkerState`를 운반하지 않는다는 근거로 `docs/decisions/2026-09-24-evolution-roadmap.md`(실행 1)에 기록돼 있다. 다만 CI가 lockstep을 검증하지 않는다 (Risk 1a).
3. **문서화 없는 경계선 사례 1건:** `WorkflowProfileName`(`packages/orchestrator/src/benchmark.ts:19-24`)은 Rust 도메인 타입 `WorkflowProfile`의 직렬화 형태에 대한 손작성 TS copy다. 배치 근거(코어가 프롬프트 텍스트를 못 보게 한다)는 코멘트에 있지만 AGENTS.md 복사 금지 규칙과의 관계는 어디에도 기록돼 있지 않다.

## Top 5 prioritized improvements

1. **3개 미러를 기계 검증하거나 생성으로 전환.** `WorkerState`·`WorkflowProfile`을 rustra schema에 노출해 codegen에 흡수하는 것이 정석이다. 비용이 크면 우선 TS 측 lockstep 테스트(정확한 문자열 집합 단언)를 추가한다 — `worker-state-vocabulary.rs`의 TS 대응물. (Risk 1·위반 2·3 해소)
2. **스케줄 pause/attention 판정을 core로 이동.** `Scheduler` 또는 projection API가 `Claimed | Paused | AttentionHeld | Empty`를 반환하게 하고 bridge 커맨드는 결과를 중계만 한다. 호출자가 빈 claim의 원인을 구분할 수 있게 된다. (Risk 3 해소)
3. **`commands.rs`를 커맨드 패밀리별로 분해.** run lifecycle / task lifecycle / guidance·attention / cleanup / benchmark·trace 모듈로 나누고 하나의 `commands` mod에서 재export, 에러 매핑은 한 곳에 유지. 다음 기능 착수 전 파일당 <600줄 목표. (Risk 2 해소)
4. **`packages/cli/src/main.ts`를 커맨드별 모듈로 분할.** 파싱은 얇게 유지하고 서브커맨드 구현을 분리해 모바일 수렴 전 검토 가능한 진입점을 만든다. (Risk 4 해소)
5. **benchmark 모듈 배치를 결정하고 기록.** architecture.md Core "Owns"에 benchmark trace 채점을 명시하거나, bridge 뒤 orchestrator 측 concern으로 이동한다. ADR으로 근거를 남긴다. (Risk 5 해소)
