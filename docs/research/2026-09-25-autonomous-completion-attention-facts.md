# Loop attention 발생 지점과 자동 해결 가능 범위 — 사실 조사

- **일자:** 2026-09-25
- **태스크:** `research-attention-points`
- **조사 범위:** `crates/loop-core/src/{attention,policy,scheduler}/**`, `docs/decisions/**`, `docs/reliable-runs.md`
- **근거 원칙:** 코드와 저장소 결정 문서만 1차 자료로 사용했다. 아래의 “발생”은 (1) 범위 안 코드가 직접 attention 종류를 산출하거나, (2) 범위 안 정책 오류가 결정 문서상 attention으로 승격되는 경우를 뜻한다.

## 1. 판정 기준과 구조적 한계

| 등급 | 판정 기준 |
| --- | --- |
| **자동가능** | 입력과 불변식만으로 단일한 비손실 조치가 정해진다. 보류·직렬화·관리 대상이 아닌 자원 건너뛰기처럼 사용자 의도를 추측하지 않는다. |
| **조건부자동** | 명시된 기본값, 유한 재시도 예산, 후보 집합, 검증 명령 등 사전 계약이 있을 때만 자동화할 수 있다. 계약이 소진돼도 `on_exhaustion`이 안전한 terminal failure로 정해져 있으면 자동 종결할 수 있고, terminal 상태 판정 불능·권한·비가역 선택이 남을 때만 사람에게 올린다. |
| **사람필수** | 승인, 제품 의도, 데이터 손실, 외부 상태 또는 중복 실행 가능성을 사람이 확인해야 한다. |

`loop-core`의 attention 모듈은 **저장 가능한 합 타입과 해소 유효성만** 소유한다. 종류는 `Question`, `Decision`, `Approval`, `Conflict`, `Failure`이고, 생성자는 임의 kind를 열린 상태로 만들지만 어떤 사건에서 만들지는 결정하지 않는다 (`crates/loop-core/src/attention/attention.rs:10-16,35-56`). 해소 계약은 모든 종류의 `Cancel`, approval의 `Approved/Rejected`, failure의 `Retry`, question/decision/conflict의 `Answer`뿐이다 (`attention.rs:59-79`, `attention/resolution.rs:5-10`). 따라서 **자동화 정책을 `Attention::resolve` 안에 넣으면 안 된다**. deterministic policy가 결론과 증거를 먼저 만들고 상위 orchestrator가 attention 생성 자체를 생략하거나 허용된 resolution을 기록해야 현재 경계를 보존한다.

조사 범위의 `attention/**`, `policy/**`, `scheduler/**`에는 `Attention::new`/`Attention::for_task` 호출이 없다. 직접 kind를 산출하는 구체 정책은 cleanup의 `RefusalCode::attention_kind`뿐이다 (`crates/loop-core/src/policy/cleanup.rs:67-87,114-116`). routing은 typed error를 반환하고 scheduler는 대기시킬 뿐 attention을 직접 만들지 않는다.

## 2. 유형별 attention 및 개입 지점

### 2.1 질문·결정·승인·충돌

| 유형 / 발생 지점 | 현재 동작 또는 해소 계약 | 자동화 등급 | 안전한 자동 해결 범위와 근거 | Evidence |
| --- | --- | --- | --- | --- |
| **Question — 일반 질문** | 생성자가 어떤 질문도 열 수 있고 해소는 문자열 `Answer`만 허용한다. 질문 내용별 정책은 core에 없다. | **조건부자동** | task 계약에 명시된 기본값, 저장소 불변식, 선행 결정에서 답이 유일할 때만 답을 합성할 수 있다. 자유형 질문을 일반적으로 자동 답변하면 사용자 의도를 발명한다. 설계 단계에서 clarification을 없애거나 attention으로 승격하는 관행은 질문을 실행 중이 아니라 직렬 decision 단계에서 갚게 한다. | `attention.rs:10-16,35-56,69-72`; `docs/decisions/design-md-workflow.md:43,47,81` |
| **Decision — 일반 material 결정** | 문자열 `Answer`로만 해소한다. core에는 선택지, 비용, 권한, 기본안 필드가 없다. | **사람필수** | 현재 타입만으로는 “기본안 승인”과 “새 제품 결정”을 구분할 수 없다. 사전 승인된 deterministic policy로 환원된 선택은 attention을 만들지 않는 것이 낫고, material 제품/경계 변경은 사람에게 남긴다. | `attention.rs:12,69-72`; 제품 결정 보류 사례 `docs/decisions/2026-09-24-weird-cleanup.md:100` |
| **Approval — 명시적 승인 게이트** | `Approved`, `Rejected(reason)`, `Cancel`만 유효하다. `resume`은 승인 대기를 해제하지 않고 명시적 `approved`가 필요하다. | **사람필수** | 승인 의미를 유지하려면 자동 승인하면 안 된다. 저위험 작업에 승인 노드 자체를 만들지 않는 별도 정책은 가능하지만 이미 생성된 approval은 사람만 해소해야 한다. | `attention.rs:13,65-68`; `docs/reliable-runs.md:24` |
| **Conflict — 의미/결과 충돌** | 문자열 `Answer`로 해소한다. 충돌 당사자, 우선순위, 병합 가능성은 타입에 없다. | **사람필수** | current schema로는 안전한 승자를 계산할 근거가 없다. 동일 결과, append-only 결합, 사전 우선순위처럼 별도 deterministic merge 계약이 있는 경우에만 attention 생성 전 자동화할 수 있다. | `attention.rs:14,69-72` |
| **스케줄러 read/write scope 충돌** *(Conflict kind가 아님)* | 겹치는 read/write scope나 필수 write scope 누락을 `tasks_conflict`로 판정해 동시 claim을 건너뛴다. 결정·통합(serial) 작업도 단독 실행한다. | **자동가능** | 현재처럼 직렬 대기하면 데이터 손실 없이 충돌을 피한다. 이를 사람용 conflict attention으로 승격할 이유가 없다. 단, scope가 영원히 누락된 task를 “대기”만 시키는 장기 정체 감지는 별도 필요하다. | `crates/loop-core/src/scheduler/scheduler.rs:17-63,67-75`; `scheduler/conflicts.rs:1-25`; `docs/reliable-runs.md:30` |

### 2.2 실패와 정책 거부

| 유형 / 발생 지점 | 현재 kind / 결과 | 자동화 등급 | 안전한 자동 해결 범위와 근거 | Evidence |
| --- | --- | --- | --- | --- |
| **Failure — 일반 worker/verification 실패** | failure attention은 `Retry` 또는 모든 종류에 공통인 `Cancel`만 가능하다. worker 성공 보고 뒤에도 completion check가 통과해야 완료다. | **조건부자동** | 동일 입력의 무한 retry는 금지하고, 실패가 일시적이며 시도 예산·백오프·상향 compute class·재검증 계약이 있을 때만 유한 retry한다. deterministic 검증 실패나 예산 소진은 `on_exhaustion` 계약이 있으면 `Failed`로 자동 종결할 수 있다. 상태를 확정할 수 없거나 제품 선택이 남을 때만 attention이 필요하다. | `attention.rs:65,68`; `policy/compute_class.rs:18-27`; `docs/reliable-runs.md:32` |
| **라우팅 후보 없음** (`NoSufficientCandidate`) | 가용성, eligible ID, compute 범위, capability, risk floor를 모두 만족하는 후보가 없으면 typed error를 반환한다. core 자체는 attention을 만들지 않는다. | **조건부자동** | 아직 시도하지 않은 적격 후보나 허용 범위 내 다음 compute class가 있으면 정책적으로 재선택한다. 후보 집합 또는 최고 class 소진 뒤에는 요구를 자동 완화하지 않고 terminal failure로 닫을 수 있다. capability/risk floor 완화나 유료·credential 선택으로 계속하려는 경우에만 사람 결정이 필요하다. 과거 typed-decision 후보 부재는 실제 attention을 만들었다. | `policy/routing.rs:108-146`; `policy/compute_class.rs:18-27`; `docs/decisions/2026-09-21-routing-jev-disable-and-pi-coverage.md:11-12` |
| **quota/rate-limit 후보 실패** | 결정 문서상 실패 후보와 같은 quota pool을 제외해 유한 재선택하고, 후보 소진 때만 attention을 기록한다. | **조건부자동** | 이미 채택된 최우선 후보다. 분류가 quota/rate-limit으로 확실하고 cleanup 성공, 미시도 후보 존재 시에만 자동 fallback한다. auth·일반 실패·startup 불확실·cleanup 실패는 위장하지 않는다. | `docs/decisions/zai-quota-fallback-routing.md:7-11,25` |
| **실행 프로세스 비정상 종료로 이전 worker 상태 불명** | 중복 실행을 막고 확인 요청을 남긴다. worker와 검증 프로세스가 모두 멈췄음을 확인한 뒤 `reconcile ... stopped` 해야 한다. | **사람필수** | 외부 프로세스 생존 여부가 불확실한 동안 자동 retry하면 중복 부작용 위험이 있다. 신뢰 가능한 process handle/fencing으로 “stopped”가 기계적으로 증명되는 경우에만 향후 조건부 자동화할 수 있다. 현재 운영 계약은 사람 확인이다. | `docs/reliable-runs.md:26,36` |
| **RunNotTerminal cleanup 거부** | non-terminal run record 제거를 `Failure`로 분류한다. retention 평가와 단건 제거 모두 거부한다. | **자동가능** | 삭제하지 않고 terminal 전이까지 보류하면 된다. 이 상태는 실패 attention보다 “not eligible yet”로 다루는 편이 안전하며, terminal 뒤 retention policy를 재평가할 수 있다. | `policy/cleanup.rs:68,84-85,198-224,340-353` |
| **PathIsProjectRoot cleanup 거부** | 프로젝트 루트와 같은 worktree 경로 삭제를 `Failure`로 분류한다. | **자동가능** | 항상 fail-closed로 해당 action을 제거/건너뛴다. 사용자에게 삭제 승인을 물어도 안전해지지 않으므로 자동 승인 대상이 아니라 자동 **거부** 대상이다. | `policy/cleanup.rs:71,82,243-258` |
| **PathOutsideProject cleanup 거부** | 절대 경로가 아니거나 루트 밖/부모 경로인 worktree 삭제를 `Failure`로 분류한다. | **자동가능** | 항상 fail-closed로 건너뛴다. 경로 정규화 후에도 루트 내부임이 증명되지 않으면 삭제하지 않는다. | `policy/cleanup.rs:72,81,227-280` |
| **SurfaceNotOwned cleanup 거부** | caller-owned surface 제거를 `Failure`로 분류한다. | **자동가능** | Loop 소유가 아니면 제거하지 않고 cleanup을 계속한다. ownership을 사람이 즉석 승인해 덮어쓰지 않는다. | `policy/cleanup.rs:73,83,313-327` |
| **ExternalSession cleanup 거부** | 외부 세션은 항상 `Failure`; Loop scope 밖이며 “never be deleted”다. | **자동가능** | 영구 skip이 유일한 안전 조치다. 반복 attention 대신 관리 대상 아님으로 기록하면 된다. | `policy/cleanup.rs:74,85,329-338`; managed 판정 `cleanup.rs:31-33` |
| **WorktreeUnmerged cleanup 거부** | 미병합 commit이 있으면 `Decision`으로 분류한다. | **사람필수** | commit 보존/병합/폐기는 제품·데이터 보존 결정이다. 자동 삭제 금지. 자동으로 할 수 있는 것은 cleanup 보류와 증거(브랜치/commit) 제시뿐이다. | `policy/cleanup.rs:69,80,283-299`; worktree는 removal이 lossy `cleanup.rs:27-29` |
| **WorktreeDirty cleanup 거부** | 미커밋 수정이 있으면 `Decision`으로 분류한다. | **사람필수** | 변경 보존 여부를 추측할 수 없다. 자동 stash/commit도 새 영속 상태와 의미를 만들므로 사전 계약 없이는 금지하고, 보류+diff 요약까지만 자동화한다. | `policy/cleanup.rs:70,80,301-307`; worktree는 removal이 lossy `cleanup.rs:27-29` |

## 3. “attention 발생”으로 오인하면 안 되는 대기

| 대기 원인 | core 동작 | 결론 | Evidence |
| --- | --- | --- | --- |
| 전체 worker 용량 소진 | 빈 claim 반환 | 정상 backpressure; attention 아님 | `scheduler/scheduler.rs:17-20,30-33` |
| serial task 실행 중 | 새 task claim 중지 | 결정·통합 직렬화; attention 아님 | `scheduler/scheduler.rs:21-24,39-45` |
| dependency 미완료 | 해당 task skip | 정상 DAG 대기; attention 아님 | `scheduler/scheduler.rs:34-37` |
| frontier 용량 소진 | 해당 frontier task skip | class별 backpressure; attention 아님 | `scheduler/scheduler.rs:46-49` |
| scope 겹침/필수 scope 누락 | 동시 claim skip | 실행 충돌 예방. 다만 다른 running task가 사라진 뒤에도 필수 scope 누락으로 영구 정체될 수 있으므로 graph validation에서 조기 실패시키는 후보 | `scheduler/scheduler.rs:51-56,67-75` |

## 4. 상위 5개 자동화 후보

1. **non-terminal run cleanup을 attention이 아닌 defer로 처리** — `RunNotTerminal`은 terminal 전까지 기다렸다 retention을 재평가하면 되며 데이터 손실이 없다 (`cleanup.rs:198-224,340-353`).
2. **관리 경계 위반 cleanup을 fail-closed skip으로 일괄 수습** — project root/outside, non-owned surface, external session은 승인을 받아도 안전 경계가 바뀌지 않는다. 반복 failure attention 대신 refusal을 감사 기록으로 남기고 나머지 cleanup을 계속할 수 있다 (`cleanup.rs:227-280,313-338`).
3. **quota/rate-limit의 유한 후보 fallback 일반화** — 명확한 실패 분류, cleanup 성공, 미시도 적격 후보라는 세 조건 아래 이미 근거와 회귀 사례가 있다. 현행 결정은 후보 소진 때 attention을 기록한다. fallback 자동화와 별개로, 소진 뒤 attention 또는 terminal failure 중 무엇을 택할지는 `on_exhaustion` 정책 결정 사항이다 (`zai-quota-fallback-routing.md:7-11,25`).
4. **일시적 worker/verification 실패의 예산 기반 retry + compute escalation** — `Retry`와 유한 compute ladder가 이미 타입으로 존재한다. 동일 실패 반복과 deterministic check 실패에는 재시도하지 않고, 예산·frontier 소진 시 사전 `on_exhaustion`에 따라 terminal failure로 닫는 조건을 붙이면 질문을 줄이면서 무한 루프를 막을 수 있다 (`attention.rs:68`; `compute_class.rs:18-27`; `reliable-runs.md:32`).
5. **graph 생성/검증 단계에서 scope·모호성 조기 차단** — scheduler의 scope 충돌은 이미 자동 직렬화되지만 필수 write scope 누락은 영구 skip 가능성이 있다. 실행 전에 non-empty scope와 explicit default를 검증하고, design workflow의 clarification/요구사항–태스크 역추적 규칙을 적용하면 runtime question/conflict로 늦게 나타나는 것을 줄인다 (`scheduler.rs:67-75`; `design-md-workflow.md:43,46-48,58-61`).

## 5. 결론과 남은 위험

- **경계 결론:** deterministic 판정은 `loop-core` policy에 두되, attention 타입은 결과 기록과 허용 resolution 검증에만 남기는 구조가 현재 의존성 방향에 맞다. provider 분류나 endpoint 지식을 core로 옮기지 말고, adapter가 중립적인 실패 사실을 전달하면 Rust policy가 retry/defer/escalate/stop을 정해야 한다.
- **가장 큰 스키마 한계:** generic question/decision/conflict에는 선택지, 기본값, 위험도, 기한, 자동화 허용 여부가 없다. 따라서 현재 데이터만으로 이 세 종류를 안전하게 일괄 자동 해소할 수 없다.
- **cleanup 표현의 잡음:** `RunNotTerminal`, 경계 밖 path, 외부 세션까지 `Failure` attention kind로 매핑된다. 이 중 다수는 사람에게 해결을 요구하는 실패가 아니라 deterministic refusal/defer다. refusal과 human attention의 승격 조건을 분리할 여지가 크다.
- **scheduler 정체 위험:** 충돌은 안전하게 기다리지만 이유/기한을 상태로 승격하지 않는다. 특히 필수 write scope 누락은 두 task의 동시성 문제가 아니라 task 계약 오류이므로 claim-time skip보다 graph validation-time failure가 명확하다.
- **완료 위험:** worker 성공은 completion check 통과와 같지 않다는 운영 계약은 존재한다 (`docs/reliable-runs.md:32`). 그러나 완료 DAG가 최초 intent의 모든 acceptance criterion을 덮는지 증명하는 coverage 계약은 아직 없다 (`docs/decisions/zai-quota-fallback-routing.md:26-27,61-63,71`). 따라서 attention 0건만으로 “사용자 목표 완료”를 주장할 수 없다.
