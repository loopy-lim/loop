# 제안→승인→구현 상호작용 — 진단 결과를 첫 제안 원천으로

- **Date:** 2026-xx-xx
- **Status:** proposed (사람 attention 승인 대기)
- **Kind:** decision (`decide-proposal-approval-cycle`)
- **Read scope:** `docs/diagnosis/**`, `docs/decisions/**`, `docs/reliable-runs.md`, `docs/repo-conventions.md`, `docs/reviewer-pattern.md`, `config/templates/**`
- **Write scope:** 본 문서 (`docs/decisions/2026-xx-proposal-approval-cycle.md`)
- **근거 문서:**
  - `docs/diagnosis/2026-xx-death-patterns.md` — 죽음 패턴 6종 통합 분류와 "지금 가장 약한 계층" 결론, 다음 진단·수정 후보 5건
  - `docs/decisions/2026-09-29-agent-quality-and-nightly.md` — nightly continuation이 attention을 대신 해결하지 않고, work를 Git 변경에서 발명하지 않는다는 기존 계약
  - `docs/reliable-runs.md` — attention 승인 불변식(명시적 `approved` 필요, `rejected`는 취소), 완료 계약 불변식, 결정·통합 직렬화
  - `docs/reviewer-pattern.md` — 기존 `verification` kind + reviewer 페르소나 조합, 새 task kind 없음
  - `docs/repo-conventions.md` + `config/templates/implementation-task.example.md` — task 양식과 완료 조건 불변식
  - `docs/decisions/persona-benchmark-subsystem.md` — 반복 실행·trace 비교로 라우팅 정책 변경 전 근거를 쌓는 기존 부품

## 배경

사용자 방향: "제안된 상호작용을 잘 만들어주는 것" — 기계가 근거를 모아 제안하고, 사람은 승인만 하고, 승인분만 구현되는 흐름. 이를 새로운 core 개념으로 만들지 않고 기존 부품 조립으로 정의한다.

첫 제안 원천은 방금 검증 완료된 죽음 패턴 진단(`docs/diagnosis/2026-xx-death-patterns.md`)이다. 이 문서는 6개 패턴을 문서·커밋·테스트 근거로 분류하고 "지금 가장 약한 계층" 결론(orchestrator ↔ 프로세스 수명 주기 경계, 6개 중 3개 패턴의 공통 뿌리)과 우선순위가 매겨진 수정 후보 5건을 이미 제시한다. nightly는 실행 기록(`~/.loop/nightly/nightly.log`, `loop nightly --dry-run --json`)을 남기므로 후속 제안의 2차 원천이 된다. 단 nightly 자체는 work를 발명하지 않는다는 기존 계약(2026-09-29 ADR)을 유지한다 — 제안 생성은 사람이 읽는 문서 산출이지 자동 run 생성이 아니다.

## 결정

### 1. 사이클 정의 — 기존 부품 4개의 조립

새로운 core 개념, 새 task kind, 새 config 파서를 만들지 않는다. 사이클은 다음 4단계이고 각 단계는 이미 존재하는 부품이다.

```text
[원천] 진단 문서 + nightly 기록
   ↓  (Lead가 근거 기반 후보를 ADR 초안으로 문서화)
[제안] docs/decisions/ ADR 초안 (Status: proposed)
   ↓  (attention 생성 → 사람이 resolve)
[승인] attention 관문 — 명시적 approved만 통과
   ↓  (승인분만 run으로 변환)
[구현+검증] 기존 DAG task — 완료 계약 + 기계 검증 (+리스크 기반 reviewer)
```

| 단계 | 사용 부품 | 새로 만드는 것 |
| --- | --- | --- |
| 원천 | `docs/diagnosis/**` (근거 기반 분류), nightly 기록 | 없음 — 문서 관례 (`docs/diagnosis/`) 그대로 |
| 제안 | ADR 초안 (`docs/decisions/`, Status: proposed), `config/templates/` 양식 | 없음 — 문서 단독 |
| 승인 | 기존 attention: `loop resolve <run-id> <attention-id> approved\|rejected` | 없음 — attention 불변식(명시적 approved, rejected=취소) 재사용 |
| 구현·검증 | 기존 DAG: implementation/verification task, 완료 계약, `bun run check`, reviewer 패턴, benchmark | 없음 |

단계별 계약:

- **제안 (문서).** Lead는 원천에서 후보를 골라 ADR 초안을 쓴다. 각 제안은 (a) 근거(문서·커밋·테스트명), (b) 예상 검증 방법(유료 호출 0인 명령), (c) 사람 승인이 필요한 이유를 반드시 포함한다. 이 셋 중 하나라도 빠진 항목은 제안이 아니라 메모이므로 attention으로 올리지 않는다. 양식은 `config/templates/implementation-task.example.md`의 "완료 조건은 비어 있으면 안 된다" 불변식과 동일 원칙이다.
- **승인 (attention).** 제안 ADR 1건당 attention 1개. 사람의 `approved`만 다음 단계로 이어지고 `rejected`면 ADR을 `rejected`로 표기하고 폐기 기록을 남긴다(`2026-09-24-watch-columns.md` 폐기 선례). 부분 승인은 없다 — 승인 단위는 ADR 안의 제안 항목 1개다. 기계(워커·nightly)는 승인을 대신하지 않는다(2026-09-29 ADR의 "attention을 대신 해결하지 않음" 계약 계승).
- **구현 (DAG).** 승인된 제안 1건 = run 1개. Lead가 `config/templates/implementation-task.example.md` 양식으로 task를 분해하고, 모든 task에 비어 있지 않은 완료 조건(완료 계약)을 둔다. 구현 task가 2개 이상이면 integration task를 downstream에 둔다(2026-09-29 ADR의 기존 규칙). 리스크가 high 이상인 구현에는 독립 reviewer task를 붙인다(`docs/reviewer-pattern.md` — 새 kind 아님).
- **검증 (기계).** 워커 성공 보고는 근거가 아니며 완료 조건 명령의 통과 출력이 근거다. 라우팅·정책 기본값을 건드리는 제안은 단발 검증에 그치지 않고 `loop benchmark agents` 반복 실행으로 trace를 비교한 뒤 적용한다(persona-benchmark ADR의 "Repeated trials remain necessary before making a routing policy change" 계승).

### 2. 다음 사이클 후보 제안 (진단 "지금 가장 약한 계층" 결론 기반)

진단 결론: **orchestrator ↔ 프로세스 수명 주기 경계가 가장 약하다** — 6개 패턴 중 3개(패턴 1·2·3)가 "프로세스 실제 상태와 저장소·도구 응답이 담는 상태의 어긋남"에서 나왔고, 열린 구멍 3개((a) 5초 TTL 이벤트 루프 차단 오판, (b) 30분 상한의 운영 미조정, (c) Windows kill 경로 미검증)가 남아 있다. 아래 제안 1·2는 이 약한 계층의 열린 구멍을 직접 겨냥하고, 제안 3은 같은 문서가 죽음 오인 1순위로 지목한 관측 가능성 결함(패턴 4)을 다룬다. 각 항목은 위 §결정-1의 (a)(b)(c) 삼중 항목을 갖춘다.

#### 제안 1: resume/spawn 결과 관측 가능성 — 디태치드 owner의 spawn 결과를 attention으로 보고

- **근거:** 진단 후보 3번 그대로. lease recycle로 패턴 1의 *동작* 결함은 닫혔지만 `spawnOwner`가 detached·stdio ignore라 spawn 성공/실패가 resume 호출자에게 구조적으로 비관측이다(패턴 1 D3의 관측성 절반). 이는 "가장 약한 계층" 결론이 지목한 프로세스 상태 ↔ 저장 상태 어긋남의 잔여 사례다. 근거 소스: `docs/defects/2026-09-23-dispatcher-claims.md` D3, `docs/diagnosis/2026-xx-death-patterns.md` 패턴 1·후보 3.
- **예상 검증 방법:** orchestrator 단위 테스트(`packages/orchestrator/test/` — spawn 성공/실패 경로별 attention 생성 단언) + `packages/pi-loop/test/restart-recovery.test.ts` 회귀 + `bun run check`. 유료 모델 호출 0.
- **사람 승인이 필요한 이유:** 디태치드 spawn에 attention을 붙이면 정상 resume에서도 알림이 생겨 관찰 소음 정책(기본 상태 8줄 제약)에 영향을 준다. 알림을 언제 끌지(항상 vs 실패 시만)는 운영 취향 판단이므로 사람 결정이다.

#### 제안 2: stall 상한의 운영 측정 기반 튜닝 — 30분 기본값을 근거 숫자로 교체

- **근거:** 진단 후보 2번. `runTimeoutMs` 기본 30분과 `recovery.stall_timeout_ms`는 운영 측정 미반영 값이며, 정상 장시간 응답을 종료시킬 수 있다(패턴 2 잔여 위험, `docs/diagnosis/network-stall-hang.md` "남은 위험" 명시). "가장 약한 계층"의 열린 구멍 (b).
- **예상 검증 방법:** nightly·런 기록에서 provider별 응답 시간 분포를 집계해 근거 표를 ADR에 첨부하고, 변경 후 `loop benchmark agents` 반복 실행으로 timeout 발생률·완료율 trace 비교. 자동 회귀는 fake provider deadline 테스트(`packages/providers/test/lifecycle.test.ts`) 유지. 유료 호출 0 — 측정은 기존 기록 집계.
- **사람 승인이 필요한 이유:** 기본값 변경은 "정상 응답을 죽일 위험"과 "stall 방치 위험"의 트레이드오프다. 수용 가능한 오탐률은 사용자의 운영 판단이며, 집계 근거가 있어도 최종 값의 선택은 사람이 한다.

#### 제안 3: scheduler 세계 정지 게이트 완화 + 스킵 사유 기록

- **근거:** 진단 후보 1번. `crates/loop-core/src/scheduler/scheduler.rs`의 직렬 종류 세계 정지(`return Vec::new()`)와 빈 writeScope 보편 충돌이 진단 문서 작성 시점 코드 재확인에서도 미착지다(패턴 4). 죽음은 아니지만 "멈춘 것처럼 보이는" 실행의 오인 1순위로, 사용자 체감 죽음 신고의 상당 부분을 설명한다.
- **예상 검증 방법:** `cargo test -p loop-core`(scheduler claim·스킵 사유 단위 테스트 신설) + `bun run test:architecture` + 병렬 디스패치 회귀(`docs/diagnosis/2026-xx-parallel-dispatch-diagnosis.md`의 Root Cause별 재현 시나리오를 테스트로 고정). 유료 호출 0.
- **사람 승인이 필요한 이유:** 세계 정지 제거는 결정·통합 직렬화라는 안전 속성(`docs/reliable-runs.md`)의 경계를 다시 긋는 일이다. 어디까지 병렬을 허용할지는 스케줄러 보증 수준의 변경이므로 사람이 승인해야 하며, 기각될 경우 대안(직렬 유지 + 스킵 사유 기록만)으로 좁혀 재제안한다.

#### 제안 4 (후순위): 죽은 config 키 정리 — `decision_parallelism` 등 파싱되지 않는 키

- **근거:** 진단 후보 5번. 파싱되지 않는 config 키는 "없는 손잡이"로 운영자가 제안 3의 병렬 정책을 돌리려다 실패하게 만드는 관측성 결함이다(패턴 4 "dead keys" 섹션).
- **예상 검증 방법:** `bun run codegen:check` + config 파싱 단위 테스트(알 수 없는 키 경고 또는 거부 단언) + `bun run check`. 유료 호출 0.
- **사람 승인이 필요한 이유:** 구현할지 삭제할지가 사용자 노출 면의 변경이다. 키를 살리면 동작이, 지우면 설정 호환성이 바뀌므로 방향 선택은 사람 결정이다.

### 3. 의도적으로 하지 않는 것

- **자동 run 생성 없음.** nightly와 진단 파이프라인이 제안 문서까지는 만들 수 있지만 run 생성은 승인 뒤 Lead 분해로만 일어난다(2026-09-29 ADR의 "It does not invent work" 계약 유지).
- **새 attention kind·새 task kind 없음.** 제안 승인은 기존 attention, reviewer는 기존 `verification` kind다.
- **loop-core 변경 없음.** 본 결정은 상호작용 설계이며 이 자체로는 코드를 만지지 않는다. 각 제안이 승인된 뒤 각자의 run에서 처음으로 core/bridge에 닿는다.

## 요구사항 (EARS + `R<n>`)

- **R1** — WHEN Lead가 원천에서 후보를 제안하면, THE SYSTEM SHALL 근거·예상 검증 방법·사람 승인 사유를 모두 포함한 ADR 초안(Status: proposed)으로 문서화한다. *검증: 초안에 세 항목의 존재를 grep으로 확인.*
- **R2** — WHEN 제안이 attention에 올라오면, THE SYSTEM SHALL 명시적 `approved`에만 구현 run을 생성하고 `rejected`면 ADR에 rejected 상태와 폐기 기록을 남긴다. *검증: `loop resolve` 기록과 ADR 상태 대조.*
- **R3** — WHEN 승인된 제안이 run으로 변환되면, THE SYSTEM SHALL 모든 task에 비어 있지 않은 완료 조건을 두고, 구현 task 2개 이상 시 integration task를, high 이상 리스크에 reviewer task를 둔다. *검증: `loop graph` DAG 대조 + `bun run test:architecture`.*
- **R4** — WHEN 제안이 라우팅·정책 기본값을 변경하면, THE SYSTEM SHALL `loop benchmark agents` 반복 trace 비교 근거 없이 적용하지 않는다. *검증: ADR 첨부 trace 비교표 존재.*
- **R5** — IF 제안의 검증이 유료 모델 호출을 요구하면, THE SYSTEM SHALL 그 제안을 기각하고 오프라인 검증 가능한 형태로 재제안한다. *검증: AGENTS.md 검증 절 준수 기록.*

## 검증 계획 (본 ADR 자체에 대한 것)

```bash
test -s docs/decisions/2026-xx-proposal-approval-cycle.md
grep -q -e '^## ' docs/decisions/2026-xx-proposal-approval-cycle.md
grep -q 제안 docs/decisions/2026-xx-proposal-approval-cycle.md
! grep -E '(sk-[A-Za-z0-9]{8,}|ghp_[A-Za-z0-9]{16,})' docs/decisions/2026-xx-proposal-approval-cycle.md
```

코드 검증은 없다 — 본 문서는 설계 결정이며 각 제안의 검증 명령은 승인 후 해당 run의 완료 계약이 된다.

## 결과 요약

- **사이클:** 진단·nightly 원천 → 제안 ADR 초안(proposed) → attention 명시적 승인 → 승인분만 DAG run(완료 계약 + 기계 검증, 리스크 기반 reviewer). 신규 core 개념·kind 0, 기존 부품 4종 조립.
- **후보 제안 4건:** (1) resume/spawn 결과 attention 보고, (2) stall 상한 측정 기반 튜닝, (3) scheduler 세계 정지 완화 + 스킵 사유 기록, (4) 죽은 config 키 정리(후순위). 1·2는 진단이 지목한 가장 약한 계층(프로세스 수명 주기 경계)의 열린 구멍, 3·4는 죽음 오인 관측성 결함.
- **불변식 유지:** 기계는 attention을 대신 해결하지 않고 work를 발명하지 않으며, 워커 성공 보고는 근거가 아니고, 정책 기본값 변경은 benchmark 반복 근거를 요구한다.
