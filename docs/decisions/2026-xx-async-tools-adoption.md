# Async Tools — Unreal Agent 패턴 채택 결정

- **Date:** 2026-09-25
- **Status:** decided
- **Kind:** decision
- **Input:** `docs/research/async-tools-unreal-pattern.md` (unreal-pattern-research worker 결과), `docs/research/async-human-input.md` (메일박스 선행 설계), `docs/research/references/unreal-agent.html` (원문 사본), `packages/orchestrator/src/**` 코드 증거
- **Tracked upstream decision:** `2026-09-23-watch-to-steer.md` (steer 라우팅), `2026-09-25-minimal-intervention-completion.md` (completion 계약)

## 결정 (한 단락)

Loop는 Unreal Agent의 비동기 하니스 패턴 중 **세 가지를 채택**한다 — (A1) pi 배치 병렬 기본값의 무조건 보존: Loop 어댑터가 `toolExecution`/`executionMode`를 절대 덮어쓰지 않고 프롬프트 가이드에 "독립 툴은 한 턴에 묶어 발행"을 유지해, "턴당 더 많은 툴 작업" 이점을 코드 변경 0으로 유지한다(`pi-agent-core/dist/agent.js:143`의 기본 parallel). (A2) completion check 병렬 실행: `packages/orchestrator/src/completion.ts:42`의 순차 검증 루프를 소규모 동시성 한정(동시성 cap 설정화) 병렬로 바꾸되 결과를 check id 순으로 재조립해 `recordCheckReceipts` 페이로드의 결정론을 보존한다 — 그래프 레벨 "worker 완료 즉시 후속 진행"(`coordinator.ts:237`)의 마지막 순차 병목을 제거한다. (A3) `GuidanceDelivered { task_id, worker_id, through_sequence }` 이벤트로 스티어링 메일박스 워터마크를 영속화한다(`mailbox.ts:14-18`이 문서화한 후속 과제) — 리플레이 정합성, 미전달 guidance 정확 산출, 스티어링 지연 측정 가능성을 확보한다. **두 가지는 기각**한다 — (N1) in-progress/final 두 항목 컨텍스트 패턴: 이 패턴의 유일한 소비자는 모델 컨텍스트인데 Loop는 모델 컨텍스트를 조립하지 않는다(하니스인 pi의 영역). Loop가 이를 채택하려면 orchestrator가 자체 모델 턴 루프를 가져야 하고, 이는 하니스 이중화 + orchestrator의 provider 개념 흡수라는 경계 침해다. 게다가 원문 각주 2가 인정했듯 일부 비(非)OpenAI 공급자가 거부하는 미표준 트릭이며, in-progress 삽입→final 치환 사이 KV 캐시 접미사 무효화 리스크가 있다. 이 패턴은 pi 업스트림 실험 과제(M3, Loop 스코프 밖)로만 지켜본다. (N2) 서브에이전트/그래프 제거 철학: Unreal의 "no sub-agents or workflows" 절감 요인은 Loop의 그래프 우선 정체성(태스크 DAG, 완료 계약, attention — AGENTS.md 첫 줄 원칙)과 정면 충돌하므로 채택하지 않는다. 같은 목적은 A1~A3과 frontier 통제로 달성한다. 또한 (N3) 툴 실행 중 인터럽트형 스티어링은 기각한다 — "툴 완료를 기다리지 않는 스티어링"의 Loop 대응은 이미 구현된 메일박스이며, 남는 차이(pi 배치 경계까지 대기)는 검증 계약과 도구 원자성을 지키기 위해 수용한다(`async-human-input.md` §O3 재확인). **Unreal과의 진짜 격차는 pi 하니스 내부(배치 전체 대기 vs 개별 완료 트리거, in-progress 항목)에 있고, Loop가 소유한 영역(이벤트 로그, 그래프 스케줄링, 스티어링 수신)은 이미 구조적으로 대응되어 있다는 것이 이 결정의 근거다.**

## 경계 준수

- **정책은 Rust, 결정론 유지:** A3의 신규 이벤트는 `loop-bridge` Rust 타입을 먼저 변경하고 `bun run codegen`으로 생성 파일을 함께 커밋한다. 리듀서는 전달 기록 프로젝션만 추가한다. 동시성 cap·응집 창 같은 튜닝값은 어댑터/설정에 둔다(실행 타이밍은 이벤트 로그 진실원을 오염시키지 않음).
- **loop-core에 provider 금지:** A1~A3 어느 항목도 loop-core에 provider/모델/하니스 개념을 유입시키지 않는다. N1 기각의 근본 이유가 이 경계다.
- **TS 어댑터는 얇게:** A2는 기존 `CompletionRunner` 인터페이스 안의 실행 전략 변경이고 A1은 설정 불변 확인이다. Rust 도메인 타입의 TS 복제 없이 `@loop/protocol` 생성 타입만 사용.

## 마일스톤 순서와 기계 검증 가능한 수용 기준

### M0 — pi 어댑터 toolExecution 불변 확인 (코드 변경 0)

- 의존: 없음. 스코프: `packages/providers/**` 읽기 + 기록.
- 수용 기준:
  - `rg 'toolExecution|executionMode' packages/providers/src/` 결과가 pi 기본값을 sequential로 덮어쓰는 할당이 없음을 문서로 기록.
  - 확인 결과가 이 문서 또는 후속 research 노트에 file:line으로 남음.

### M1 — completion check 병렬 실행 (A2)

- 의존: 없음. 스코프: `packages/orchestrator/src/completion.ts` + 테스트.
- 수용 기준:
  - 가짜 러너 테스트: 5개 check 중 1개가 100ms 지연돼도 `CompletionEvidence[]`와 `recordCheckReceipts` 페이로드가 check id 순서로 산출됨 (`bun test packages/orchestrator` 통과).
  - 동시성 cap이 설정 가능하고, cap 초과 check는 큐잉됨을 테스트로 증명.
  - 개별 check 실패·타임아웃이 기존 계약(다른 check 결과를 잃지 않음)을 유지함을 테스트로 증명.
  - `bun run check` 전체 통과.

### M2 — GuidanceDelivered 이벤트 (A3)

- 의존: 없음(메일박스 이미 구현). 스코프: `crates/loop-bridge/**`, `crates/loop-core/src/event/**`, `bun run codegen`, `packages/orchestrator/src/mailbox.ts`.
- 수용 기준:
  - `cargo test -p loop-core -p loop-bridge` — 리듀서가 `GuidanceDelivered`를 수용하고 전달 워터마크 프로젝션이 시퀀스 오름차순으로만 진행함을 테스트.
  - `bun run codegen:check` 통과 — Rust 타입과 생성 TS 타입 일치.
  - orchestrator 테스트: 라이브 드레인 성공 시 `GuidanceDelivered` append, 드레인 실패/크래시 시 미전달 guidance가 프로젝션에 남아 다음 클레임 컨텍스트에 중복 주입되지 않음(at-most-once 라이브 + recorded-steer 폴백).
  - `bun run test:architecture` 통과 — 경계 위반 없음.

### M3 — (선택, Loop 스코프 밖) pi 업스트림 실험

- in-progress/final 항목 + 캐시 영향 측정. pi 저장소 과제이며 실측에 유료 호출 가능성 → 본 결정의 채택/기각과 무관하게 Loop에 영향 없음. Responses API 표준화 동향(원문 각주 2)을 지켜볼 것.

## 리스크

- A2: 동시 cargo/bun 경합으로 check가 느려지거나 실패로 비칠 수 있음 → 보수적 기본 cap, 설정화.
- A3: 전달 후 append 직전 크래시 시 at-least-once 재전달 가능 — 메일박스 폴링이 이미 워터마크로 중복을 흡수하며, 완전 제거는 M2 테스트로 검증.
- M0: providers 패키지가 실제로 기본값을 덮어쓰고 있으면 A1이 "보존"이 아니라 "복구" 작업으로 바뀜 → M0를 최우선 실행해 조기 확정.

## 미해결 항목

- A2 동시성 cap 기본값과 config 위치 (M1 착수 시 확정).
- 무한 `Vec<Guidance>` 성장 한정 정책 (`async-human-input.md` §1.4) — M2와 함께 별도 결정.
