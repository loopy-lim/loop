# benchmark trace 채점의 소유 계층 — loop-core 유지

- **일자:** 2026-09-30
- **상태:** 결정됨
- **결정 종류:** `decision`
- **읽기 범위:** `crates/loop-core/src/benchmark/**`, `crates/loop-store/src/trace.rs`, `crates/loop-bridge/src/commands.rs`, `packages/orchestrator/src/benchmark.ts`, `tests/architecture-boundaries.test.ts`, `docs/architecture.md`
- **쓰기 범위:** 이 결정 기록과 `docs/architecture.md`의 Core Owns 행

## 배경 (Context)

`loop benchmark run` / `loop benchmark agents`는 워크플로우 프로필(PlanFirst·SpikeFirst·TddFirst)과 에이전트 구성을 비교하기 위해 run 이벤트 로그를 채점한다. 현재 구현은 층이 나뉘어 있다:

| 계층 | 파일 | 역할 |
| --- | --- | --- |
| core | `crates/loop-core/src/benchmark/trace.rs` | `TraceSummary::from_events` — `EventKind` 순수 집계, `TraceScore`/`compare_traces` 결정론 채점·순위 |
| core | `crates/loop-core/src/benchmark/profile.rs` | `WorkflowProfile` 열거형 — 워크플로우 형태 이름만 정의 |
| store | `crates/loop-store/src/trace.rs` | 이벤트 시퀀스 스캔으로 run별 `TraceSummary` 행 생성 |
| bridge | `crates/loop-bridge/src/commands.rs` | 채점 결과를 프로세스 경계 명령으로 노출 (`compare_traces` 호출) |
| orchestrator | `packages/orchestrator/src/benchmark.ts` | 프로필 → 구체적 DAG 시나리오 매핑, 실행 루프, 설정 파싱 |
| cli | `packages/cli/src/main.ts` | `benchmark run` / `benchmark agents` 커맨드, 리포트 렌더링 |

경계 위반이라기보다 배치 판정이 기록되지 않은 상태이므로, "채점이 어디에 속하는가"를 결정으로 고정할 필요가 있다. 특히 core의 `benchmark` 모듈은 `tests/architecture-boundaries.test.ts`가 provider 중립 모듈 목록과 토큰 금지 검사 대상으로 이미 포함하고 있어, 이 배치를 문서가 따라잡아야 한다.

## 결정 (Decision)

**benchmark trace 채점(`TraceSummary`, `TraceScore`, `compare_traces`, `WorkflowProfile`)은 loop-core에 유지한다.** store·bridge·orchestrator로 옮기지 않는다. 근거는 다음과 같다.

1. **core의 존재 이유와 정확히 일치한다.** AGENTS.md가 정한 "결정론적 정책은 Rust가 소유" 원칙의 순수 사례다. 채점은 `EventKind`만 소비하고, 시계·I/O·provider 지식이 전혀 없으며(`elapsed_ms`는 호출자가 채우도록 설계됨), 유일한 wall-clock 필드조차 발명하지 않는다. 타이 breaking까지 label 오름차순으로 고정하는 완전 결정론 순위다.
2. **의존성 방향상 유일하게 성립하는 자리다.** 채점은 core의 자체 도메인 타입(`Event`)에 의존한다. store로 옮기면 "정책이 스키마 계층에 갇히고" core 방향 의존만 늘어나며, orchestrator(TS)로 옮기면 bridge 결과와 TS 재계산이 갈라져 단일 소스가 깨진다. store는 이미 core를 import하므로 현 배치는 그래프를 역전시키지 않는다.
3. **프로토콜 경계를 통과하는 값이므로 Rust가 소유해야 한다.** `TraceComparison`은 bridge 커맨드 결과로 codegen을 거쳐 TS에 도달한다. 채점이 TS 쪽에 있으면 생성 protocol + 손으로 쓴 TS 사본이라는 금지 패턴이 재현된다.
4. **`WorkflowProfile`의 절제가 이미 올바르다.** 프로필은 워크플로우 형태 이름만 정의하고, 프로필을 구체적 작업 시퀀스(프롬프트 텍스트)로 번역하는 일은 orchestrator fixture가 소유한다. core는 프롬프트 텍스트를 결코 본다. 이 절제 덕분에 채점 소유를 core에 두어도 provider 중립 검사를 통과한다.

**명시적 비소유(경계 유지):**

| 대상 | 소유 계층 | core가 하지 않는 것 |
| --- | --- | --- |
| 프로필 → DAG 시나리오 매핑, 벤치마크 실행 루프 | orchestrator (`benchmark.ts`) | 프롬프트 텍스트, fixture 작업 시퀀스를 core로 끌어들이지 않는다 |
| 설정 파싱(`BenchmarkConfig`) | orchestrator | TOML/설정 스키마를 core 타입으로 두지 않는다 |
| run별 이벤트 스캔·행 생성 | store (`trace.rs`) | core는 SQL이나 스캔 순서를 모른다 |
| 커맨드 노출·렌더링 | bridge / cli | core가 출력 형식을 결정하지 않는다 |

## 결과 (Consequences)

**긍정.** 채점 규칙이 하나의 Rust 순수 함수로 고정되어 bridge 결과와 어떤 TS 재계산 사이에도 불일치가 생길 수 없다. `cargo test -p loop-core`만으로 채점 결정론을 검증할 수 있고, 유료 모델 호출 없는 단위 테스트 요건을 충족한다. `WorkflowProfile`의 lockstep 테스트(ALL 배열·serde 문자열·`as_str` 일치)가 profile.rs에 붙을 명확한 근거가 된다.

**절충.** "benchmark"라는 이름이 core에 남지만, 이는 제품 정책(run 품질의 결정론 비교 기준)이지 벤치마크 실행기가 아니다. 실행기 관점의 코드가 생기면 그 자리는 orchestrator다. 모듈 이름이 오해를 부를 여지는 남는다 — 문서로 통제한다.

**거부한 대안.** (a) store 이동 — 정책이 스키마 계층에 갇히고 core→store 의존이 역전된다. (b) orchestrator/TS 이동 — 어댑터 비대화, 생성 protocol과의 이중 정의, 결정론 보장 상실. (c) 신규 crate(예: `loop-benchmark`) — 현재 크기(파일 3개, ~220줄)에 과도한 경계 비용.

**후속 항목.** `crates/loop-core/src/benchmark/profile.rs`에 `WorkflowProfile::ALL` ↔ serde 케밥 문자열 ↔ `as_str` lockstep 테스트 추가(별도 과제). 아키텍처 문서의 Core Owns 행에 benchmark trace 채점을 명시(이 결정과 함께 수행).
