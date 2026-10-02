# Loop 현재 기능 표면 인벤토리

- 작성일: 2026-09-30 (갭 분선파트 task `inventory`, attempt 0)
- 방법: 저장소 1차 소스(README, 문서, Rust 코어/스토어, TS 패키지, config)를 직접 읽고 항목별로 근거 파일 경로를 남겼다. 유료 모델 호출·실측 벤치마크 없음. "갖춤"은 코드 또는 문서가 동작을 기술하는 수준이며, 실측 품질과는 별개다.
- 용도: [harness-comparison.md](harness-comparison.md), [harness-advantages-cli.md](harness-advantages-cli.md) 등 외부 하네스 비교 조사의 Loop 측 기준선. 각 항목을 비교 카테고리(컨텍스트 관리 / UX / 생태계 / 검증 / 지속성 / 라우팅·정책 / 오케스트레이션·스케줄링 / 벤치마크·측정 / 보안·프라이버시)에 태깅했다.
- 판정 범례: ✅ 갖춤(동작이 코드·문서로 확인됨) · 🟡 부분(제한 조건 명시) · ⛔ 갖지 않기로 함(non-goal, 근거 포함)

## 1. 요약 표

| # | 기능 | 판정 | 비교 카테고리 | 근거 |
| --- | --- | --- | --- | --- |
| 1 | intent → 검증된 typed task DAG (사이클·의존성 사전 거절) | ✅ | 오케스트레이션·스케줄링 | `crates/loop-core/src/graph/validation.rs`, `crates/loop-core/src/graph/dag.rs`, `README.md` |
| 2 | 결정적 스케줄러: 의존성 충족 claim, 용량 한도, 결정 순서 반환 | ✅ | 오케스트레이션·스케줄링 | `crates/loop-core/src/scheduler/scheduler.rs`, `crates/loop-core/src/scheduler/capacity.rs`, `docs/architecture.md` |
| 3 | decision/integration 직렬화 + 겹치는 쓰기 범위 동시 배정 거절 | ✅ | 오케스트레이션·스케줄링 | `crates/loop-core/src/scheduler/conflicts.rs`, `crates/loop-core/src/task/kind.rs`, `config/policy.toml` (`decision_parallelism=1`, `unknown_write_scope_is_exclusive=true`) |
| 4 | task 상태 기계 Pending→Ready→Running→Verifying→Done(+Attention/Failed/Blocked/Cancelled) | ✅ | 지속성 | `crates/loop-core/src/task/state.rs`, `docs/architecture.md` (Lifecycle) |
| 5 | 읽기·쓰기 소유 범위 선언과 범위 외 관찰 감사 | ✅ | 오케스트레이션·스케줄링 | `crates/loop-core/src/task/ownership.rs`, `docs/reliable-runs.md` (병렬 실행) |
| 6 | 분해 계약(가정·의존 소비·시맨틱 접점·충돌 해결을 타입으로 기록) | ✅ | 검증 | `crates/loop-core/src/task/decomposition.rs` |
| 7 | 완료 계약(실행 가능 completion check 전부 통과 없이 `Done` 불가, worker 성공 보고는 증거 아님) | ✅ | 검증 | `crates/loop-core/src/task/contract.rs`, `packages/orchestrator/src/completion.ts`, `README.md` (Invariants) |
| 8 | 검증 실패 유형 분류 + 시도 예산 + compute class 1단계 승격 사다리 | ✅ | 검증 / 라우팅·정책 | `crates/loop-core/src/policy/failure.rs`, `crates/loop-core/src/policy/compute_class.rs`, `docs/model-routing.md` |
| 9 | deterministic assertion 실패는 재시도·승격 없이 첫 실패 terminal 처리 | ✅ | 검증 | `docs/reliable-runs.md` (실패 재시도와 terminal 종결), `crates/loop-core/src/policy/failure.rs` |
| 10 | attention 게이트: 열린 항목 존재 시 새 claim 중단, resolve 전용 경로 | ✅ | UX / 검증 | `crates/loop-core/src/attention/attention.rs`, `crates/loop-core/src/attention/resolution.rs`, `README.md` (Invariants) |
| 11 | steer/guidance 영구 저장 메일박스(진행 중 호출 프롬프트는 소급 변경 없음) | ✅ | UX | `packages/orchestrator/src/mailbox.ts`, `docs/reliable-runs.md`, `docs/decisions/2026-09-23-watch-to-steer.md` |
| 12 | compute class(deterministic~frontier) 라우팅, 모델 ID는 config에만 존재 | ✅ | 라우팅·정책 | `crates/loop-core/src/policy/routing.rs`, `docs/model-routing.md`, `config/models.toml` |
| 13 | 리스크 기반 class floor(high→strong, critical→frontier) + 후보 선택 결정 함수 | ✅ | 라우팅·정책 | `crates/loop-core/src/policy/routing.rs` (`select_candidate`, `CapabilityRequirements`), `config/policy.toml` (`[routing]`) |
| 14 | SQLite 이벤트 로그 권위 + 트랜잭션 내 상태 캐시 + 재생 projection | ✅ | 지속성 | `crates/loop-store/src/sqlite.rs`, `crates/loop-core/src/event/reducer.rs`, `docs/reliable-runs.md` (저장 형식) |
| 15 | 실행 소유권 임대(lease)로 늦은 결과·중복 배정 거절, TTL 갱신 | ✅ | 지속성 | `crates/loop-store/src/sqlite.rs` (`claim_execution`, `renew_execution`, `require_execution_owner`), `crates/loop-core/src/event/event.rs` |
| 16 | 재시작 복구: 이벤트 재생 후 라이브 워커 관찰로 `Running` 재판정(live/exited/missing), `loop reconcile` | ✅ | 지속성 | `crates/loop-store/src/sqlite.rs` (`recover_run`), `docs/architecture.md` (Durable recovery), `packages/cli/src/main.ts` (`reconcile`), `config/policy.toml` (`[recovery]`) |
| 17 | 명시적 정리·보존: `loop cleanup`(dry-run 기본, `--keep N`, active/attention run 보호, 유출 workspace 제거) | ✅ | 지속성 | `packages/cli/src/main.ts` (`cleanup`), `crates/loop-store/src/sqlite.rs` (`purge_plan`, `purge_run`), `crates/loop-core/src/policy/cleanup.rs`, `docs/adr/cleanup-and-retention.md` |
| 18 | 자동 purge 부재(데이터 손실 방지를 수동 트리거로 책임 전가) | ⛔ | 지속성 | `README.md` (Cleanup and retention), `docs/adr/cleanup-and-retention.md` |
| 19 | pause/resume/cancel/steer/resolve 런 제어 + 터미널 종료 후 지속 실행(detach) | ✅ | UX / 지속성 | `packages/cli/src/main.ts` (`pause`, `resume`, `cancel`, `--detach`), `docs/reliable-runs.md`, `packages/orchestrator/src/control.ts` |
| 20 | 관찰 명령: `runs`, `status`, `watch`, `graph`, `task --json` | ✅ | UX | `packages/cli/src/main.ts`, `docs/reliable-runs.md` (명령 표), `packages/presentation/src/*` |
| 21 | 컴팩트 출력 예산(상태 8줄, attention 6줄, findings 5줄) | ✅ | UX | `config/policy.toml` (`[output]`), `packages/presentation/src/compact.ts`, AGENTS.md |
| 22 | worker 활동 가시화 3모드(off/watch/panes, 기본 off) | 🟡 | UX | `config/policy.toml` (`worker_visibility`), `docs/decisions/2026-09-23-worker-visibility.md`, `packages/providers/src/mirror.ts` |
| 23 | Pi Lead 확장 명령 표면: `loop_run`, `loop_quick_run`, `loop_code_map`, `loop_status`, `loop_select_run`, `loop_task`, `loop_guidance`, `loop_steer`, `loop_add_task`, `loop_resolve`, `loop_control` | ✅ | UX | `packages/pi-loop/src/extension.ts` |
| 24 | 단일 bounded 작업 경량 fast path (`loop_quick_run`) | ✅ | UX / 오케스트레이션·스케줄링 | `packages/pi-loop/src/extension.ts` (loop_quick_run 정의) |
| 25 | Lead 분해 지원: DAG 분해, 결과 reduce, 코드맵, 프롬프트, 타이밍 | ✅ | 컨텍스트 관리 | `packages/pi-loop/src/lead/decompose.ts`, `packages/pi-loop/src/lead/reduce.ts`, `packages/pi-loop/src/lead/code-map.ts`, `packages/pi-loop/src/lead/prompts.ts` |
| 26 | 작업 컨텍스트 주입: 원래 요청·guidance·의존 결과·범위·완료 조건·실패 기록 전달 | ✅ | 컨텍스트 관리 | `packages/orchestrator/src/task-execution.ts`, `docs/reliable-runs.md` (병렬 실행과 결과 전달) |
| 27 | 자동 컨텍스트 압축(compaction/condensation) | ⛔ | 컨텍스트 관리 | `docs/research/harness-comparison.md` §4.2 (Loop 격차로 명시), 저장소 내 compaction 구현 부재 |
| 28 | worker 결과의 상태·요약·기록 텍스트 예산화 | 🟡 | 컨텍스트 관리 | `config/policy.toml` (`[output]` 라인 한도), `packages/presentation/src/compact.ts` |
| 29 | redaction: 상태·요약·스트림에서 인증 토큰 패턴 가림, 자격증명 비저장 | ✅ | 보안·프라이버시 | `packages/orchestrator/src/redact.ts`, `packages/providers/src/redact.ts`, `README.md`, `docs/provider-support.md` (Configuration) |
| 30 | `loop doctor --auth`: provider 자격 상태를 읽기전용 CLI로만 확인(프롬프트·키 노출 없음) | ✅ | 보안·프라이버시 / 생태계 | `packages/cli/src/health.ts`, `packages/cli/src/main.ts` (`doctor`), `docs/provider-support.md` |
| 31 | `AgentProvider` 단일 계약: Codex/Antigravity/Z.AI(API·CLI)/Pi/fake 어댑터, 타입화된 실패 계약 | ✅ | 생태계 | `packages/providers/src/types.ts`, `packages/providers/src/registry.ts`, `docs/provider-support.md` (Failure contract) |
| 32 | Antigravity persistent 세션(stream-json, 대화 재점착, 취소) + Herdr 가시 모드 | ✅ | 생태계 | `packages/providers/src/antigravity/`, `docs/provider-support.md` |
| 33 | Herdr 통합: workspace/pane 소유는 Herdr, Loop는 불투명 worker 식별자만 저장 | ✅ | 생태계 | `packages/herdr/src/*`, `packages/providers/src/herdr-agent.ts`, `docs/architecture.md` |
| 34 | 자체 MCP/skills/plugins 표준 | ⛔ | 생태계 | `docs/research/harness-advantages-cli.md` (Loop 기준 행), AGENTS.md 경계 규칙(코어에 provider/도구 생태계 개념 금지) |
| 35 | worker 측 own-turn-loop 어댑터(툴 레인, 순차/병렬 실행 모드) | 🟡 | 생태계 / 컨텍스트 관리 | `packages/turnloop/src/types.ts`, `packages/turnloop/src/lanes.ts`, `docs/decisions/2026-xx-own-turn-loop-and-subagent-steering.md` |
| 36 | 네임드 페르소나(kind별 기본 페르소나, 명시 전용 목록, 어휘 파생) | ✅ | 생태계 | `packages/orchestrator/src/persona.ts`, `config/personas/`, `docs/decisions/2026-09-24-persona-defaults-config.md` |
| 37 | 벤치마크 서브시스템: 결정적 워크플로우 프로필, 시나리오, trace | ✅ | 벤치마크·측정 | `crates/loop-core/src/benchmark/` (profile.rs, trace.rs, mod.rs), `packages/orchestrator/src/benchmark.ts`, `packages/cli/src/main.ts` (`benchmark run`) |
| 38 | 에이전트 비교 실행기(`loop benchmark agents`) + nightly 품질 루프 | ✅ | 벤치마크·측정 | `packages/orchestrator/src/agent-comparison.ts`, `packages/cli/src/nightly.ts`, `docs/decisions/2026-09-29-agent-quality-and-nightly.md` |
| 39 | fake provider 7-task 시나리오로 전 경로 무료 검증(`loop verify-install`) | ✅ | 벤치마크·측정 / 검증 | `packages/providers/src/fake.ts`, `packages/cli/src/main.ts` (`verify-install`), `README.md` |
| 40 | 이벤트 소싱 타입 표면: Run/Worker/Verification/Attention/Decision/Guidance 이벤트 | ✅ | 지속성 | `crates/loop-core/src/event/event.rs` (`EventKind`), `packages/protocol/src/generated/events.ts` |
| 41 | typed decision 결과 기록(provider-neutral decision class, 결정적 폴백 소유) | ✅ | 라우팅·정책 / 검증 | `crates/loop-core/src/event/event.rs` (`DecisionRecorded`), `docs/model-routing.md`, `packages/orchestrator/src/model-registry.ts` |
| 42 | 검증 아티팩트 저장(evidence-artifact, artifacts 테이블) | ✅ | 검증 / 지속성 | `packages/orchestrator/src/evidence-artifact.ts`, `crates/loop-store/src/sqlite.rs` (`record_artifact`, `artifacts`) |
| 43 | Rust 단일 소스 계약 codegen(Rustra) — 손작성 TS 도메인 타입 금지 | ✅ | 생태계 / 지속성 | `packages/protocol/src/generated/*`, `crates/loop-bridge/src/*`, AGENTS.md |
| 44 | portable config·환경 일반화(`LOOP_CONFIG_DIR`, pi models.json 동기화, `loop doctor` 검증) | ✅ | 생태계 | `docs/environment-generalization.md`, `packages/cli/src/health.ts`, `config/models.toml` |
| 45 | 실행 중 모델 재량 서브에이전트 스폰 | ⛔ | 오케스트레이션·스케줄링 | `docs/research/harness-comparison.md` §4 ("그대로 옮기지 않을 것"), AGENTS.md (스케줄 규칙은 Rust) |
| 46 | 요청 단위 auto 모델 라우팅 | ⛔ | 라우팅·정책 | `docs/research/harness-comparison.md` §4, `docs/model-routing.md` (정적 프로필 + 결정적 사다리) |
| 47 | OS 수준 샌드박스/파일 격리(write scope는 스케줄러 계약일 뿐) | 🟡 | 보안·프라이버시 | `docs/reliable-runs.md` (병렬 실행 — "운영체제 수준의 파일 접근 격리는 아님") |
| 48 | 리서치 fan-out의 제품 기본값(L Lead 재량 분해, 소스 다양성 강제 없음) | 🟡 | 오케스트레이션·스케줄링 | `docs/research/sections/loop-analysis.md`, `docs/research/harness-comparison.md` §4.1 |
| 49 | 외부 제어 HTTP API / SDK(headless 서버) | ⛔ | 생태계 | `docs/research/harness-advantages-cli.md` (OpenCode 비교 행), `packages/cli/src/main.ts` (HTTP 서버 부재, private CLI request만) |
| 50 | 터미널/IDE 소유(대화형 페어프로그래밍 UX) | ⛔ | UX | `README.md` (Herdr owns terminals, Pi owns the interactive Lead experience) |
| 51 | 파일 변경 checkpoint/rewind(git 스냅샷 복구) | ⛔ | 지속성 | `docs/research/harness-advantages-cli.md` (Gemini/Aider 비교 행), `docs/adr/cleanup-and-retention.md` (unmerged workspace는 수동 보호) |
| 52 | lifecycle hook 외부 노출(worker 도구 호출 경계의 외부 검사기 이벤트) | ⛔ | 생태계 / 검증 | `docs/research/harness-comparison.md` §4.4, `docs/research/harness-advantages-cli.md` P2 항목 |
| 53 | goal 클로저·acceptance 매핑(요구→검증 check ID 대응을 계약에 포함) | ✅ | 검증 | `packages/pi-loop/src/extension.ts` (loop_quick_run acceptance 설명), `docs/decisions/2026-09-28-goal-closure-and-routing.md` |
| 54 | 소스 상태 추적(worker 입력 출처 상태) | ✅ | 검증 | `packages/orchestrator/src/source-state.ts` |
| 55 | QR 페어링·리모트 앱 표면(별도 app 시리즈 결정) | 🟡 | UX / 생태계 | `packages/cli/src/pair.ts`, `packages/cli/src/qr.ts`, `docs/decisions/2026-xx-qr-pairing.md`, `docs/research/app-remote-access-surface.md` |

## 2. 비교 카테고리별 상세

### 2.1 오케스트레이션·스케줄링 (다른 하네스 대비 Loop의 중심 차별점)

- **갖춤**: 사이클 거절 포함 DAG 사전 검증(`crates/loop-core/src/graph/validation.rs`), 의존성 충족 claim과 결정적 순서(`crates/loop-core/src/scheduler/scheduler.rs`), 총/frontier 용량(`crates/loop-core/src/scheduler/capacity.rs`, `config/policy.toml` `max_parallel=6`, `max_frontier_workers=1`), decision/integration 직렬화, 쓰기 범위 겹침 거절(`crates/loop-core/src/scheduler/conflicts.rs`), 미선언 범위 배타 취급(`unknown_write_scope_is_exclusive=true`).
- **부분**: 리서치 fan-out이 제품 기본값이 아니라 Lead 재량(`docs/research/sections/loop-analysis.md`); 단일 작업 fast path는 `loop_quick_run`으로 존재(`packages/pi-loop/src/extension.ts`)하나 이는 Lead 도구이지 코어 경량 경로는 아니다.
- **갖지 않음**: 모델 재량 서브에이전트 스폰 — 쓰기 겹침·직렬화 보장을 우회하므로 의도적 제외(`docs/research/harness-comparison.md` §4).

### 2.2 검증

- **갖춤**: 완료 계약이 `Done`의 필요조건(`crates/loop-core/src/task/contract.rs` — `CompletionContract.is_satisfied_by`, `VerificationEvidence`), worker 성공 보고와 검증의 분리, 실패 유형 분류(`FailureClass`)·재시도 예산·승격 사다리(`crates/loop-core/src/policy/failure.rs`), deterministic assertion 첫 실패 terminal 처리(`docs/reliable-runs.md`), 분해 계약 기록(`crates/loop-core/src/task/decomposition.rs`), 검증 아티팩트 저장(`packages/orchestrator/src/evidence-artifact.ts`), goal→check acceptance 매핑(`packages/pi-loop/src/extension.ts`).
- **갖지 않음**: 외부 lifecycle hook(검증은 completion check로 유지, 실행 중 개입 지점 없음), 리서치 claim 교차검증 표준 계약.

### 2.3 지속성

- **갖춤**: append-only 이벤트 로그 권위 + 트랜잭션 내 캐시 갱신(`crates/loop-store/src/sqlite.rs`), 스키마 마이그레이션(`crates/loop-store/src/migration.rs`), 실행 임대(TTL 갱신·소유 확인·늦은 결과 거절), 재시작 복구(재생 + 라이브 관찰 3분류, `crates/loop-store/src/sqlite.rs::recover_run`), detach 실행·pause/resume/cancel(`packages/orchestrator/src/control.ts`), 명시적 cleanup/retention(`crates/loop-core/src/policy/cleanup.rs`).
- **갖지 않음**: 자동 purge(ADR에서 위험 동작으로 판정, `docs/adr/cleanup-and-retention.md`), 파일 checkpoint/rewind(이벤트 복구와 파일 되감기를 다른 개념으로 분리).

### 2.4 UX

- **갖춤**: `loop runs/status/watch/graph/task/pause/resume/steer/resolve/cancel/reconcile/cleanup/doctor/verify-install/benchmark` CLI 표면(`packages/cli/src/main.ts`), Pi Lead 11개 도구/명령(`packages/pi-loop/src/extension.ts`), 컴팩트 라인 예산(`config/policy.toml [output]`, `packages/presentation/src/compact.ts`), attention 중심 개입 게이트(`crates/loop-core/src/attention/attention.rs`), worker 가시화 3모드.
- **갖지 않음**: 대화형 페어프로그래밍 UX(터미널은 Herdr, 인터랙티브 Lead는 Pi 소유 — `README.md`), 트랜스크립트 재생·그래프 시각화 대시보드, IDE 플러그인.

### 2.5 생태계

- **갖춤**: `AgentProvider` 단일 계약과 6종 어댑터(`packages/providers/src/types.ts`, `docs/provider-support.md`), Antigravity persistent 세션, Herdr workspace/pane 위임(`packages/herdr/src/*`), 네임드 페르소나(`packages/orchestrator/src/persona.ts`), Rustra codegen 단일 소스 계약(`packages/protocol/src/generated/*`), portable config(`docs/environment-generalization.md`), own-turn-loop 어댑터 어휘(`packages/turnloop/src/*`).
- **갖지 않음**: 자체 MCP/skills/plugins 표준(어댑터·Lead 레벨 선별 채택이 원칙), 외부 제어 HTTP API/SDK.

### 2.6 컨텍스트 관리

- **갖춤(제한적)**: 작업 컨텍스트 주입(요청·guidance·의존 결과·범위·완료 조건·실패 기록 — `packages/orchestrator/src/task-execution.ts`), worker 결과 요약·활동 기록의 이벤트화(`crates/loop-core/src/event/event.rs` `TaskOutputRecorded`/`TaskActivityRecorded`), 출력 라인 예산, Lead 코드맵으로 필요 위치만 열람(`packages/pi-loop/src/lead/code-map.ts`), "worker 결과는 completion contract로만 수신" 원칙.
- **갖지 않음**: 자동 compaction/condensation, 세션 fork/rewind, repo map 상시 제공(code_map은 Lead 도구로 존재하나 worker 표준 컨텍스트는 아님).

### 2.7 라우팅·정책

- **갖춤**: 7단계 compute class(`crates/loop-core/src/policy/compute_class.rs`, `docs/model-routing.md`), 리스크 floor, 후보 선택 결정 함수(`crates/loop-core/src/policy/routing.rs::select_candidate`), 검증 실패 시 1단계 승격 + frontier 상한 초과 시 사람 attention, 모델 ID의 config 격리, typed decision 기록과 결정적 폴백.
- **갖지 않음**: 요청 단위 auto 라우팅, 실행 중 동적 프로필 전환.

### 2.8 벤치마크·측정

- **갖춤**: 결정적 워크플로우 프로필과 시나리오 생성(`crates/loop-core/src/benchmark/profile.rs`, `packages/orchestrator/src/benchmark.ts`), benchmark trace(`crates/loop-core/src/benchmark/trace.rs`), 에이전트 비교 실행기(`packages/orchestrator/src/agent-comparison.ts`, `packages/cli/src/main.ts` `benchmark agents`), nightly 품질 루프(`packages/cli/src/nightly.ts`), fake provider 무료 검증 시나리오(`packages/providers/src/fake.ts`).

### 2.9 보안·프라이버시

- **갖춤**: 자격증명 비저장·비로그(환경변수/키체인/provider 네이티브만 — `README.md`), 상태·요약·스트림 redaction(`packages/orchestrator/src/redact.ts`, `packages/providers/src/redact.ts`), `loop doctor --auth` 읽기전용 확인(`packages/cli/src/health.ts`), config에는 키 값 대신 환경변수 이름만(`config/providers.example.toml`).
- **부분**: OS 수준 샌드박스 부재 — write scope는 스케줄러 계약(`docs/reliable-runs.md` 명시).

## 3. 명시적 non-goals 정리 (근거와 함께)

| non-goal | 이유 (근거) |
| --- | --- |
| 모델 재량 서브에이전트 스폰 | 쓰기 겹침 방지·직렬화 보장을 우회 — `docs/research/harness-comparison.md` §4, AGENTS.md |
| 요청 단위 auto 모델 라우팅 | 클래스 선택 이유 추적성 상실 — `docs/research/harness-comparison.md` §4, `docs/model-routing.md` |
| 자동 데이터 purge | 잘못된 삭제가 run 기록·프로젝트 파괴 위험 — `docs/adr/cleanup-and-retention.md`, `README.md` |
| Jev provider | 유지보수 중단 엔드포인트 제거 — `docs/provider-support.md` |
| 터미널/IDE 소유 | Herdr(터미널)·Pi(Lead) 소유 분리 — `README.md`, `docs/architecture.md` |
| 코어에 provider/MCP/모델 개념 유입 | 계층 방향 고정(AGENTS.md), `bun run test:architecture`로 검증 — `crates/loop-core/src/lib.rs` |
| 클라우드 orb/런타임 이전(Amp orb, Warp handoff식) | 멀티머신 요구 실측 전 복잡성 근거 없음 — `docs/research/harness-comparison.md` §4 |
| checkpoint/rewind의 파일 되감기 | 이벤트 복구와 별개 개념, dirty workspace 수동 보호 — `docs/adr/cleanup-and-retention.md` |

## 4. 요약

- **비교 카테고리 수: 9** (오케스트레이션·스케줄링, 검증, 지속성, UX, 생태계, 컨텍스트 관리, 라우팅·정책, 벤치마크·측정, 보안·프라이버시 — 필수 5개(컨텍스트 관리/UX/생태계/검증/지속성) 모두 포함)
- **근거 파일 수: 81** — 고유 파일 경로 74 + 디렉터리 단위 참조 7(`crates/loop-core/src/benchmark/`, `crates/loop-bridge/src/*`, `config/personas/`, `packages/herdr/src/*`, `packages/providers/src/antigravity/`, `packages/protocol/src/generated/*`, `packages/presentation/src/*`); §1 표와 §2 인라인 인용 합산, 중복 제외
- **항목 수: 55** — ✅ 40, 🟡 8, ⛔ 7(non-goal은 §3에 이유 포함)
- **강점 중심 카테고리**: 검증·지속성·오케스트레이션·스케줄링·라우팅·정책 (타 하네스가 "모델 재량"에 맡기는 것을 구조·타입으로 보증)
- **약점 중심 카테고리**: 컨텍스트 관리(자동 압축 부재), 생태계(자체 확장 표준 부재), UX(시각화·트랜스크립트 부재) — [harness-comparison.md](harness-comparison.md) §4와 [harness-advantages-cli.md](harness-advantages-cli.md)의 갭 분석 입력으로 그대로 사용 가능
- **비고**: `loop_quick_run` 경량 fast path가 존재하므로 [harness-comparison.md](harness-comparison.md) §4.5("단일 노드 fast path 없음") 서술은 본 문서 기준 갱신 대상이다.
