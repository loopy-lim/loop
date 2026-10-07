# attention agent 자동 해소 설계 결정 — 2026-xx

- **상태:** 채택 (설계 결정, 구현은 후속 작업)
- **결정 종류:** `decision` (`decision-attention-auto-resolution`)
- **근거:** [`attention facts 조사`](../research/2026-09-25-autonomous-completion-attention-facts.md), [`최소 개입 자율 완료 정책`](2026-09-25-minimal-intervention-completion.md), `crates/loop-core/src/attention/`(`AttentionKind`, `AttentionResolution`, `CorrectiveTask::is_well_formed`), `packages/orchestrator/src/coordinator.ts`의 attention 발생 지점

## 배경

Loop는 run이 멈추면 attention으로 승격하고 사람의 응답을 기다린다. attention은 종류별로 닫힌 해소 어휘를 가진다: `Failure`는 `retry`·`add_task(corrective)`·`relax_routing`·`defer`·`cancel` 지시만, `Approval`은 `approved`/`rejected`, `Question`/`Decision`/`Conflict`는 `answer(text)`만 받는다. `add_task`는 task-bound이면서 corrective 계약(`requirements` + `completion_checks`)이 well-formed일 때만, `relax_routing`은 하향 전용 완화 사다리가 남아 있을 때만 core가 수용한다.

문제는 이 해소가 전부 사람 손을 거친다는 점이다. check 실패·재시도 소진 같은 기계적 실패도 run 전체가 사람 응답에 묶여 야간 배치가 아침까지 정지한다. 사람 게이트를 완전히 제거하면 대가가 따른다. 이 ADR은 attention 종류별로 agent 자동 해소 허용 여부, 위험 통제, 완전 제소(완전 자동화)의 트레이드오프를 결정한다.

## 결정

### 1. 종류별 자동 해소 범위

| attention 종류 | agent 자동 해소 | 조건 |
| --- | --- | --- |
| `Failure` | **허용** | 지시 어휘 안에서만. 기계적 실패(래치 없는 check 실패, 일시적 provider 오류, 소진)는 AGENTS.md의 자율 해소 원칙대로 처리 |
| `Question`/`Decision`/`Conflict` | **조건부 허용** | 답이 durable 계약(`defaults`, `assumptions`, 기존 결정)만으로 도출되고 범위·수용 기준·in-flight 작업·credential에 닿지 않을 때만. 그 외는 material decision으로 사람 승격 |
| `Approval` | **불허** | agent는 증거를 붙여 제안만. 승인/거부 판정은 사람 전용 (기존 정책 유지: "기존 approval은 자동 승인하지 않는다") |
| run-level 실패(`owner-spawn-*`, `dispatcher-*`, credential) | **불허** | 실행 소유권·자격 증명·디스패처 본체의 실패는 사람 게이트 유지 |

`Failure` 자동 해소의 지시 선택 순서: `retry` → 실패 원인이 계약 결함이면 `add_task`(corrective는 원 실패 gate와 수정 gate를 모두 덮는 completion checks 포함) → 실행 가능 compute가 없으면 `relax_routing`(사다리 소진 시 불가) → 위 조건이 모두 실패하면 사람 승격. `cancel`은 자동 해소 금지.

### 2. 위험 통제

- **시도 한도:** attention당 자동 해소 예산(기본 2회)과 task당 누적 corrective 삽입 한도(기본 2개)를 둔다. 소진 시 자동 해소를 중단하고 사람 attention으로 승격한다. `relax_routing`의 완화 사다리는 core가 이미 하향 전용·유한 단계로 제한하므로 별도 상한을 두지 않는다. 무한 retry는 금지된다(기존 `on_exhaustion` 정책과 동일).
- **감사 기록:** 모든 자동 해소는 사람 해소와 구별되는 해소자 식별(`agent` 또는 `human`)과 근거 요약을 남긴다. 현재 `AttentionResolution`에는 해소자 필드가 없으므로, 구현 시 브리지 타입에 provenance를 추가하고 `AttentionResolved` 이벤트·러닝 상세에 그대로 남긴다. `add_task`의 corrective 계약 자체가 durable 결정 기록이므로 무엇을 왜 고쳤는지 재구성 가능해야 한다.
- **최후 인간 게이트:** 다음 중 하나라도 참이면 자동 해소를 시도하지 않고 사람에게 승격한다 — 자동 예산 소진, 수용 기준·완료 계약의 변경, in-flight 작업과의 충돌, credential·provider 접근, `Approval`·run-level 실패. 즉 사람 게이트는 제거 대상이 아니라 자동 경로가 설명을 못 만들 때만 발화하는 최후 수단으로 좁혀진다.
- **검증 분리 유지:** corrective task의 완료 판정은 계약의 completion checks가 소유한다. worker의 성공 보고·agent의 자동 해소 자체는 완료 증거가 아니다.

### 3. 검토한 대안과 트레이드오프

- **대안 A — 현상 유지(전부 사람 해소):** 안전하나 야간·장시간 run이 기계적 실패에서 정지한다. 자율 완료 정책(최소 개입 ADR)이 지향하는 "사람 판단이 필요할 때만 묻는다"와 배치되며, attention 리스트가 기계적 항목으로 채워져 진짜 material 결정이 묻힌다.
- **대안 B — `Failure`만 자동 + 나머지 조건부(채택):** 기계적 실패의 병목을 제거하면서 결정·승인의 책임은 사람에 남긴다. 비용은 정책이 두 곳(core 어휘 검증, 오케스트레이터 예산)으로 나뉘는 것과, provenance 필드 추가라는 브리지 타입 변경이다.
- **대안 C — 완전 자동(`Approval` 포함, 게이트 제거):** 사람 개입 0을 달성하지만 위험이 구조적이다. (1) agent가 자기 corrective check를 스스로 통과시키는 거짓 완료, (2) 예산만 남은 무의미한 retry·완화로 이어지는 비용 폭주, (3) 범위·수용 기준 변경이 기록만 남고 승인 없이 확정되는 수용 기준 침해, (4) 사람이 승인 의식을 잃어 이상 감지 능력이 퇴화한다. 최소 개입 ADR의 우선순위("사람에게 묻지 않는 것보다 거짓 완료·범위 침범을 막는다")와 정면으로 배치되어 기각한다.

## 채택 결과와 후속 작업

- core(`loop-core`)는 지시 어휘·well-formedness·사다리 검증을 유지하고, 자동 해소 여부 판단과 예산은 오케스트레이터 정책으로 둔다. 어휘 자체는 변경하지 않는다.
- 후속 작업: (1) `AttentionResolution` provenance 필드 추가와 codegen, (2) 자동 해소 예산·승격 규칙의 오케스트레이터 정책 구현, (3) attention 상세에 해소자·근거 표시. 각 작업은 자체 completion checks를 가진다.
- 미해결 위험: "material decision" 판별이 정책 휴리스틱이라 오판 시 불필요한 사람 승격(비용 낮음) 또는 늦은 승격(예산이 흡수)이 생길 수 있다. 예산·한도는 운영 데이터로 재조정한다.
