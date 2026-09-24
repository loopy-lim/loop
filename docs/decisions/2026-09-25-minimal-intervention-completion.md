# 최소 개입 자율 완료 정책 결정 — 2026-09-25

- **상태:** 구현 완료
- **결정 종류:** `decision` (`decision-autonomy-policy`)
- **근거:** [`attention` 발생 지점 조사](../research/2026-09-25-autonomous-completion-attention-facts.md), [그래프 분해·기본값 관행 조사](../research/2026-09-25-autonomous-completion-decomposition-facts.md), [완료·검증·재시도 계약 조사](../research/2026-09-25-autonomous-completion-verification-facts.md)
- **적용 원칙:** 사람에게 묻지 않는 것보다 거짓 완료·범위 침범·중복 실행·데이터 손실을 막는 것이 우선이다.

## 배경

현재 Loop는 worker의 성공 보고와 완료를 구분한다. worker가 성공을 보고해도 비어 있지 않은 completion contract의 모든 check가 통과해야 `Done`이 된다. 그러나 check와 최초 요구사항 사이의 coverage는 표현되지 않아 파일 존재나 always-pass 명령도 완료 증거가 될 수 있다. 검증 실패도 boolean과 문자열로 축약되어 일시적 장애, 결정적 assertion 실패, 잘못된 계약을 서로 다르게 처리하기 어렵다. retry/exhaustion 정책 역시 한 곳의 typed policy로 드러나지 않아 실행 가능 task가 사라지면 원인과 무관하게 generic attention으로 수렴할 수 있다.

질문의 상당수는 실행 중에 새로 생기는 것이 아니라 그래프 분해 때 남긴 모호성에서 온다. 넓은 write scope, 의미 접점 누락, 선행 결과의 소비 계약 부재, 현재 기본값 없는 deferred 결정, 약한 completion check가 후속 worker의 질문이나 통합 충돌로 늦게 나타난다. 반대로 스케줄러의 알려진 scope 중첩, non-terminal cleanup, 프로젝트 밖 또는 비소유 자원 cleanup처럼 사용자 의도를 추측하지 않고도 직렬화·보류·거부할 수 있는 사건까지 attention으로 만들 필요는 없다.

따라서 목표는 **attention 0건 자체가 아니라, 사전 계약 안에서 최대한 진행한 뒤 검증된 성공 또는 설명 가능한 terminal failure로 run을 깨끗하게 닫는 것**이다. 완료 여부를 알 수 없거나 안전 경계를 넘는 경우에만 사람의 판단을 요청한다.

## 연구 근거 추적

| 결정 영역 | 직접 근거 | 이 문서가 채택한 해석 |
| --- | --- | --- |
| attention 생성 전 자동 처리와 cleanup 경계 | [`attention-facts` §1–§4](../research/2026-09-25-autonomous-completion-attention-facts.md): attention 타입은 상태·해소 유효성만 소유하고, scope 충돌은 직렬 대기하며, non-terminal/root/outside/non-owned/external cleanup은 defer 또는 fail-closed skip 가능 | 자동화 규칙을 `Attention::resolve`에 넣지 않고 core policy outcome으로 먼저 결정한다. 기존 approval은 자동 승인하지 않는다. |
| 질문을 앞당겨 제거하는 분해 계약 | [`decomposition-facts` §2–§4](../research/2026-09-25-autonomous-completion-decomposition-facts.md): 넓은 scope, 의미 접점 누락, deferred default 부재, `consumes` 부재, 약한 check가 질문을 유발하며 P1–P9와 상위 5개 관행을 제안 | 파일 scope, 의미 접점, defaults, assumptions, `consumes`, 3층 완료 계약을 preflight 입력으로 채택한다. |
| worker success와 완료의 분리 | [`verification-facts` 「완료 판정 코드 경로」와 「상위 5개 약점」](../research/2026-09-25-autonomous-completion-verification-facts.md): non-empty contract와 `Done` guard는 있으나 requirement-check coverage와 typed failure taxonomy가 없음 | 기존 `Done` guard를 유지하고 artifact·semantics·evidence coverage 및 failure class를 보강한다. |
| retry 소진과 독립 branch 처리 | [`verification-facts` 후보 A+B](../research/2026-09-25-autonomous-completion-verification-facts.md): bounded retry 후 `Failed`, 후손만 terminal propagation, 독립 branch 지속을 기본 조합으로 권고 | 소진을 기본 attention이 아닌 설명 가능한 terminal failure로 닫고 serial decision/integration의 부분 채택은 금지한다. |
| 증거 한계 | [`decomposition-facts` §7](../research/2026-09-25-autonomous-completion-decomposition-facts.md)와 [`verification-facts` 「추가 검증이 필요한 위험」](../research/2026-09-25-autonomous-completion-verification-facts.md): Loop-native 효과 계측, 실제 attempt 전이·원자성, live provider 증거가 미확인 | 정책 결정과 현행 구현 사실을 구분하고, 미확인 사항은 후속 작업과 terminal summary의 제한으로 남긴다. |

## 결정

### 1. 정책 우선순위

모든 분해·실행·검증 정책은 다음 순서로 적용한다. 낮은 순위는 높은 순위의 안전 조건을 완화할 수 없다.

1. **안전과 완료 진실성:** scope·소유권·credential·비가역 변경 경계를 지키고, 검증되지 않은 결과를 `Done`으로 만들지 않는다.
2. **명시 계약:** 요구사항, 기존 결정, task의 scope/defaults/assumptions/completion contract를 따른다.
3. **기존 호환성:** 저장 형식, 공개 동작, 이미 채택된 정책을 보존한다.
4. **최소 범위와 가역성:** 선언된 범위 안에서 가장 작은 가역적 변경을 선택한다.
5. **단순성:** 새 의존성이나 추측성 확장 지점을 만들지 않는다.

이 순서로 답이 하나로 정해지면 question/decision attention을 만들지 않고, 적용한 기본값과 근거를 결과에 남긴다.

### 2. 그래프를 실행 전에 자율 실행 가능한 계약으로 만든다

모든 task는 다음 계약을 가져야 한다.

- 파일 단위 read/write scope. 디렉터리 범위가 불가피하면 예상 파일과 `must-not-touch`를 함께 둔다.
- `decision`, `integration`, `generated-protocol`, 영속 형식, 동일 정책·도메인 어휘 같은 **의미 접점**. 동일 접점을 변경하는 task는 파일이 달라도 직렬화한다.
- `defaults`: 기본 순서는 `안전 > 기존 호환 > 범위 최소 > 단순성 > 확장성`이다. 별도 지시가 없으면 새 의존성을 추가하지 않고, 현재 동작을 보존하며, offline/static/fake 증거를 우선한다.
- `assumptions`: 가정, 근거, 반증 시 행동, 재검토 조건을 기록한다. 반증돼도 가역적 fallback이 있으면 묻지 않고 적용한다.
- 의존 edge의 `consumes`: 선행 결정, 산출물, check 결과, 남은 위험 중 후행 task가 무엇을 규범적 입력으로 쓰는지 밝힌다. dependency summary는 증거이지 새 지시가 아니다.
- completion contract의 세 층: **artifact**(무엇이 존재하는가), **semantics**(어떤 요구와 금지 조건을 만족하는가), **evidence level**(static/unit·fake/integration/live 중 무엇을 실제 확보했는가).
- 실패 종류별 retry scope·횟수·backoff와 `on_exhaustion`을 실행 전에 선언한다. 무한 retry는 허용하지 않는다.

그래프 validation은 빈/약한 계약, 필수 write scope 누락, 요구사항과 check의 미매핑, 미해결 scope 또는 의미 접점 충돌을 실행 전에 거부한다. 알려진 물리적 scope 중첩은 질문하지 않고 직렬화한다. 서로 다른 소유자가 같은 scope를 요구하거나 양립 불가능한 요구가 있어 어느 쪽도 우선할 근거가 없을 때만 attention으로 승격한다.

### 3. 실행 중에는 deterministic 조치를 attention보다 먼저 적용한다

다음은 사람 개입 없이 처리한다.

- non-terminal run cleanup은 terminal 전이까지 **defer**한다.
- 프로젝트 루트·프로젝트 밖 경로, 비소유 surface, 외부 세션 cleanup은 **fail-closed skip**하고 감사 가능한 refusal을 남긴다. 사람 승인으로 소유권 경계를 덮어쓰지 않는다.
- scheduler가 아는 read/write 충돌과 decision/integration task는 **직렬 대기**한다. 단, 계약 누락으로 영구 대기시키지 않고 preflight 오류 또는 terminal failure로 분류한다.
- quota/rate-limit처럼 확실히 분류된 실패는 cleanup 성공과 미시도 적격 후보가 모두 확인될 때만 후보 수에 한정해 fallback한다.
- timeout, 일시적 process/environment 오류처럼 transient로 분류된 실패만 선언된 예산 안에서 check-level retry, provider fallback, worker retry 또는 compute escalation을 수행한다.
- deterministic assertion 실패는 같은 명령을 그대로 반복하지 않는다. 범위 안 수정 기회가 계약에 있으면 제한된 worker 재시도 후 재검증하고, 없거나 소진되면 실패로 닫는다.
- invalid completion contract는 원칙적으로 preflight에서 막는다. 저장소별 allowlist check catalog가 명시된 경우에만 한 번 대체 검증할 수 있으며, 임의 명령이나 LLM 판단으로 `Done` guard를 우회하지 않는다.

정책은 결과를 산출한 뒤 attention 생성 여부를 결정한다. `Attention::resolve` 안에 자동화 규칙을 넣거나 이미 생성된 approval을 자동 승인하지 않는다.

### 4. 완료·검증·소진은 fail-closed로 종결한다

`worker success ≠ completion`을 불변식으로 유지한다. task는 선언된 artifact와 semantics를 coverage하는 모든 필수 evidence가 통과할 때만 `Done`이다. fake/offline PASS를 live 증거로 확대 해석하지 않으며, 확보하지 못한 evidence level은 terminal summary의 제한으로 남긴다.

검증 실패는 `assertion`, `timeout`, `process_start`, `invalid_contract`, `interrupted`, `environment`처럼 정책이 처리할 수 있는 중립적 failure class로 보존한다. retry budget이 소진되거나 non-retryable verification이 실패하면:

1. 해당 task를 `Failed`로 terminalize한다. 실패한 검증을 생략하거나 worker 보고로 대체해 `Done`으로 만들지 않는다.
2. 해당 task에 의존하는 후손은 `Blocked-terminal` 또는 `Cancelled`로 전파한다.
3. 의존하지 않는 branch는 계속 실행해 확보 가능한 증거를 보존한다.
4. 직렬 decision/integration task가 실패하면 부분 결정을 채택하거나 부분 통합하지 않고 run을 실패로 닫는다.
5. run summary에는 실패 class, 시도 수, 마지막 receipt, 영향받은 요구사항·branch, 미확보 evidence, 안전한 후속 선택지를 기록한다.

**재시도 소진 자체는 기본적으로 질문이 아니라 설명 가능한 terminal failure다.** 사람의 답이 없어도 안전하게 실패 상태를 확정할 수 있기 때문이다. 다만 외부 프로세스 생존 여부처럼 중복 실행 가능성 때문에 terminal 상태조차 기계적으로 확정할 수 없거나, 사전 계약에 사람만 선택할 수 있는 복구안이 명시된 경우에는 attention으로 전환한다.

### 5. 사람 필수 attention의 폐쇄 목록

기본 task attention 예산은 0이다. 다음 중 하나일 때만 사람 attention을 만들며, 같은 원인에서 나온 질문은 증거·기본안·대안·미응답 시 안전 조치를 포함해 한 번으로 묶는다.

1. 양립 불가능한 요구사항, 미해결 소유권 또는 선언 write scope 충돌로 어느 쪽을 선택해도 다른 계약을 위반하는 경우.
2. 데이터 손실, dirty/unmerged worktree 폐기, 공개 API·영속 형식의 비호환 변경처럼 비가역 선택이 필요한 경우.
3. credential·보안·유료 호출·명시적 approval처럼 권한 위임으로 대체할 수 없는 경우.
4. 실행 프로세스의 생존 상태가 불명확해 retry가 중복 부작용을 만들 수 있는 경우.
5. 유한 retry/fallback 소진 뒤에도 안전한 terminal 상태를 결정할 수 없거나, 제품 의도에 따라 서로 다른 복구가 가능한 material failure인 경우.
6. 사전 deterministic merge 규칙으로 해소할 수 없는 의미 충돌 또는 새로운 제품 결정인 경우.

이미 만들어진 `Approval`은 사람만 해소한다. 자유형 `Question`, `Decision`, `Conflict`는 현재 schema에 기본값·위험도·자동화 허용 여부가 없으므로 일반 자동 답변하지 않는다. 사전 정책으로 답이 정해진 사건은 처음부터 attention을 생성하지 않는다.

### 6. 모듈 경계

- **`loop-core`:** provider-neutral failure class, retry budget, exhaustion, dependency terminalization, scope·cleanup 같은 deterministic policy를 소유한다. attention 타입은 기록 가능한 상태와 resolution 유효성만 소유한다.
- **`loop-store`:** 시도, receipt, policy outcome, terminal propagation을 원자적으로 영속화한다.
- **`loop-bridge`와 generated protocol:** Rust 결정 입력·결과를 전달한다. Rust 타입을 먼저 바꾸고 `bun run codegen`으로 생성물을 함께 갱신한다.
- **orchestrator:** 명령 실행, process receipt 수집, backoff와 core가 결정한 조치 수행만 담당한다. retry 횟수나 완료 의미를 TypeScript에서 별도로 발명하지 않는다.
- **provider/UI adapter:** provider 고유 오류를 credential을 제외한 중립적 사실로 매핑하고 terminal 결과를 표시한다. 모델 ID·endpoint·quota pool 구성은 core에 넣지 않는다.

## 기존 결정과의 관계 및 상충 처리

- [`design-md-workflow.md` §4](./design-md-workflow.md)는 “쓰기 범위 비중첩”을 병렬 가능 판정으로 삼는다. 본 결정은 이를 폐기하지 않고 **필요조건으로 좁힌다**. 파일이 비중첩이어도 generated protocol, 영속 형식, 동일 정책·도메인 어휘 같은 의미 접점이 같으면 직렬화한다. 요구사항 ID·검증 방식·decision/integration 직렬화 규칙은 그대로 유지한다.
- [`zai-quota-fallback-routing.md`](./zai-quota-fallback-routing.md)는 quota/rate-limit 때 동일 pool을 제외한 유한 fallback을 기록한다. 본 결정의 구현은 **유한 fallback·cleanup·미시도 후보 조건은 유지**하되, 후보 소진 처리를 **기본 terminal `Failed`로 변경**했다. 제약 완화 승인, 중복 실행 위험, terminal 상태 판정 불능이 있을 때만 attention을 유지한다.
- [`2026-09-23-gpt6-pi-lane.md` §2](./2026-09-23-gpt6-pi-lane.md)의 “verification failure escalates one compute class”는 독립 lane 보존의 근거로는 유지하지만, 본 결정은 escalation 대상을 **typed transient failure로 한정**한다. deterministic assertion과 invalid contract에는 lane/compute escalation을 적용하지 않는다.
- [`2026-09-24-evolution-roadmap.md` 「코드젠 충돌 회피 조건」](./2026-09-24-evolution-roadmap.md)의 generated protocol 단일 직렬 레인과 Rust 변경+codegen 동봉 규칙은 그대로 유지하며, 본 결정의 의미 접점 직렬화가 이를 일반화한다.
- [`2026-09-22-worker-persona-contract.md` D3](./2026-09-22-worker-persona-contract.md)의 advisory persona fallback은 안전하고 가역적인 기본값 선례로 유지한다. persona 경고는 completion이나 attention에 영향을 주지 않는다는 기존 경계도 바꾸지 않는다.
- 나머지 `docs/decisions/**`의 UI 배치, 출력 제한, provider/model 구성, persona UX 결정은 이 정책의 완료·attention 전이를 정의하지 않으므로 변경하지 않는다. 이 문서는 과거 실행 결과를 소급 재분류하지 않고 후속 구현 시점의 정책만 정한다.

## 근거

1. 현재 core에는 non-empty completion contract와 `Done` guard가 이미 있어, 검증 우회보다 coverage와 failure taxonomy를 강화하는 편이 기존 구조를 보존한다.
2. terminal `Failed`와 독립 branch 스케줄링이 이미 가능한 상태 공간이므로, generic blocked attention보다 bounded retry 후 실패 전파가 단순하고 예측 가능하다.
3. cleanup 경계 위반은 사용자가 승인해도 안전해지지 않는다. defer/skip이 질문보다 안전하며 의도를 추측하지 않는다.
4. quota fallback, persona fallback, 무색 출력, generated protocol 직렬화처럼 보수적 기본값과 유한 fallback의 저장소 선례가 있다.
5. 질문 원인의 다수는 실행기의 지능 부족이 아니라 scope/default/evidence 계약 누락이다. 실행 중 자동 답변을 늘리기보다 분해 시 계약을 강화하는 것이 재현 가능하다.
6. attention을 material decision에만 남기면 사람의 응답이 필요한 사건과 단순 실패 알림이 구분된다. 자동 실패도 숨기지 않고 terminal summary와 후속 선택지를 보존한다.

## 거부안

### 거부안 A — 모호성이나 첫 실패마다 사람에게 질문

가장 보수적으로 보이지만 scope 중첩, transient failure, cleanup defer처럼 결정론적으로 처리 가능한 사건까지 Lead 병목으로 만든다. 질문이 작은 단위로 반복되고 run이 비종결 상태에 머무르므로 거부한다.

### 거부안 B — 질문을 없애기 위해 자동 승인·검증 생략·무제한 재시도

attention 수는 줄지만 거짓 완료, 비용 폭주, 중복 부작용, 데이터 손실 위험을 만든다. 특히 worker success를 completion으로 보거나 실패 check를 다른 근거 없이 통과시키는 방식은 핵심 안전 불변식을 깨므로 거부한다.

### 거부안 C — 모든 실패에서 전체 run 즉시 취소

원자적 배포 작업에는 opt-in profile로 유효할 수 있으나, 일반 DAG에서는 실패와 무관한 branch의 유용한 산출물·증거까지 버린다. 기본값으로는 task 실패와 후손만 닫고 독립 branch를 계속하는 방식을 채택한다.

### 거부안 D — 실패할 때마다 LLM 검증자 또는 저장소 기본 명령으로 자동 대체

대체 검증이 원 요구사항을 coverage한다는 계약이 없으면 더 강한 검증이 아니라 다른 검증일 뿐이다. 검증 전용 task와 allowlist check catalog는 plan에 사전 선언된 경우에만 제한적으로 허용하고 기본 정책으로 채택하지 않는다.

### 거부안 E — attention schema에 자동화 정책을 직접 넣기

attention은 이미 사람이 판단해야 하는 사건의 기록과 해소 유효성을 담당한다. 정책을 여기에 넣으면 deterministic core policy와 사람 상호작용 상태가 결합되고 orchestrator 경계도 흐려진다. 자동 해결 가능한 사건은 attention 생성 전에 policy outcome으로 끝내는 방식을 채택한다.

## 구현 결과와 남은 검증

정책 타입과 terminalization은 `loop-core`에 두고, bridge/generated protocol을 거쳐 orchestrator가 그 결과를 실행하도록 구현했다. retry 가능한 실패는 선언된 예산 안에서만 재시도하고, 소진되면 task와 run을 terminal `Failed`로 닫는다. 실패 task의 후손은 `Blocked`로 전파하되 독립 branch는 계속하며, decision/integration 실패는 run 실패로 종결한다. deterministic completion-check 실패는 같은 검증을 재시도하거나 compute class를 승격하지 않는다. cleanup의 defer·fail-closed skip도 failure attention과 분리했다.

fake/offline milestone 검증은 scope 충돌 직렬화, transient retry 후 성공, deterministic 실패 무재시도, retry 소진 terminalization, 후손 차단과 독립 branch 지속, serial decision/integration 실패를 포함한다. Rust core·bridge 테스트, 전체 package/test 회귀, architecture test와 codegen check까지 자동 증거를 확보했다.

미확보 evidence level은 실제 인증 provider·유료 모델 호출·장시간 운영 환경의 live 검증이다. 따라서 공급자별 오류 매핑, 실제 quota fallback, 프로세스 crash 경계의 운영 신뢰성은 자동 fake/integration 증거보다 강하게 해석하지 않는다. task별 attention·fallback·retry 수와 false-completion 발견률의 장기 계측도 남아 있다.
