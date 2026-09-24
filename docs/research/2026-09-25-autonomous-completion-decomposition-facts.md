# 자율 완료를 위한 그래프 분해·기본값 관행 조사

- **일자:** 2026-09-25
- **태스크:** `research-decomposition-practice` (research, attempt 0)
- **목적:** 그래프 분해 단계의 모호성이 실행 중 Lead 질문으로 번지는 지점을 찾고, 질문 없이도 보수적으로 진행할 수 있는 기본값 관행을 정리한다.
- **읽기 범위:** `AGENTS.md`, 지정된 결정 문서 2건, `docs/design/**`, 지정된 연구 문서 2건
- **쓰기 범위:** 본 문서만
- **방법:** 저장소 문서에 기록된 실제 태스크 표·검증 리뷰·결정 기록을 정적으로 대조했다. 외부 모델 호출과 라이브 provider 호출은 없었다.
- **증거 한계:** 본 문서는 분해 계약과 문서화 관행을 분석한다. 질문 발생률을 계측한 Loop-native 완료 run은 아직 없으므로(`docs/research/self-trace-patterns.md`의 loop-store 완료 run 0건), 아래 관행의 효과 크기는 후속 trace로 검증해야 한다.

## 0. 결론

현재 Loop의 기본 규칙은 방향이 맞다. `AGENTS.md`는 의존성과 read/write scope 명시, decision/integration 직렬화, 비어 있지 않은 completion contract, material attention만 허용하는 원칙을 이미 고정한다. `docs/design/design.md`의 역추적 표는 이를 요구사항 ID·태스크 ID·경로·의존·완료 확인으로 구체화한다.

그러나 **선언의 존재가 모호성의 제거를 보장하지는 않는다.** 특히 다음 네 경우에는 워커가 Lead에게 질문하거나 임의 해석할 여지가 남는다.

1. 범위가 디렉터리 와일드카드라 병렬 태스크의 실제 파일 접점이 겹친다.
2. 요구사항이 결과가 아니라 구현 위치까지 고정하거나, 반대로 결정해야 할 선택을 연기하면서 실행 기본값을 쓰지 않는다.
3. 의존성이 실행 순서만 표현하고 선행 태스크가 넘겨야 할 증거·산출물 계약을 표현하지 않는다.
4. completion check가 파일 존재만 확인하거나, 정적/fake/live 증거의 등급을 구분하지 않는다.

따라서 Lead 질문을 줄이는 가장 효과적인 조합은 **(1) 질문 임계값과 attention 예산, (2) 태스크별 실행 기본값, (3) 가정 원장, (4) 파일 단위 쓰기 범위와 의미 충돌 직렬화, (5) 증거 수준이 명시된 완료 계약**이다. 이 다섯 가지는 새 계층이나 새 타입 없이 태스크 명세 관행만으로 적용할 수 있다.

---

## 1. 현재 그래프 분해 관행 — 확인된 사실

### 1.1 저장소의 기본 계약

`AGENTS.md`는 다음을 명시한다.

- 의존성과 read/write scope를 명시한다.
- decision과 integration 노드는 직렬화한다.
- completion contract는 비어 있지 않아야 하며 worker 성공 보고를 검증으로 보지 않는다.
- attention은 material question, decision, approval, conflict, exhausted failure에만 사용한다.

이는 질문 억제의 최소 골격이다. 워커에게 “어디를 읽고/쓰는가”, 스케줄러에게 “무엇을 병렬화하는가”, 완료 판정자에게 “무엇을 실행해 확인하는가”를 각각 제공한다.

### 1.2 가장 구체적인 현행 분해 형태

`docs/design/design.md` §7은 요구사항 ID ↔ 설계 요소 ↔ 태스크 ID/kind ↔ read/write scope ↔ 의존성 ↔ 완료 확인을 한 행에 둔다. 같은 문서는 결정(T1)과 통합(T10)을 직렬화하고, 구현 태스크 T3/T4는 쓰기 범위가 비중첩이라는 판단 아래 병렬화한다. `docs/design/research/design-md-practices.md` §3.2도 Spec Kit의 `[P]`와 정확한 파일 경로를 병렬성 판단의 핵심으로 소개한다.

`docs/design/jwt-validation-middleware.md` §5는 더 보수적인 예다. 타입을 순차 소비한다는 이유로 `auth-core → auth-bridge → auth-middleware → auth-verify`를 전부 직렬화하고, 각 단계에 패키지 수준 쓰기 범위와 명령 기반 완료 확인을 둔다.

### 1.3 기본값과 폴백의 선례

저장소에는 질문 대신 자동 해소하는 선례가 이미 있다.

- 미지 persona id는 hard fail이나 attention이 아니라 kind 기본 persona로 폴백하고 경고만 결과 요약에 남긴다(`docs/decisions/2026-09-22-worker-persona-contract.md` D2–D3).
- 색/환경 판정 불가 시 무색으로 가는 보수적 폴백이 설계 원칙으로 채택돼 있다(`docs/design/design.md` §5.2, §9).
- 깨진 외부 상태나 라이브 실측 부재는 단위/fake 증거와 “별도 실측 필요”를 분리해 기록한다(`docs/design/research/herdr-live-panes-review.md`, `herdr-inline-panes-review.md`, `herdr-tabs-revert-review.md`).
- 연기된 결정은 재개 트리거와 답변 책임자를 함께 적는다(`docs/design/design.md` §8 D-2/D-5/D-6).

즉 “모르면 묻는다” 외에 **기본값으로 계속 진행하고, 경고·가정·후속 트리거로 불확실성을 보존하는 방식**이 이미 여러 문서에서 검증된 관행이다.

---

## 2. 질문을 유발하는 모호성 패턴

### A1. 선언된 write scope가 실제 병렬 안전성을 증명하지 못함

**패턴:** `packages/presentation/src/`처럼 넓은 경로를 쓰거나 “신규 모듈”처럼 파일명이 정해지지 않으면, 서로 다른 태스크가 같은 파일을 선택할 수 있다.

**저장소 사례:** `docs/design/design.md` §7은 `migrate-snapshot-to-vocabulary`와 `move-cli-report-formatters`를 비중첩이라 판단한다. 그러나 전자는 `packages/presentation/src/snapshot.ts`, 후자는 `packages/presentation/src/`와 `formatSnapshot` 변경을 포함한다. 후자가 실제로 `snapshot.ts`를 고르면 물리적 충돌이 생긴다. “병렬 가능” 선언과 경로 표현 사이에 긴장이 있다.

**질문 유발:** 워커는 새 파일을 어디에 만들지, 기존 `snapshot.ts`를 바꿔도 되는지 Lead에게 확인하게 된다. 질문하지 않으면 충돌 또는 scope 위반 위험이 생긴다.

**분류:** 자동 해소 가능. 파일 단위 쓰기 목록 또는 “금지 접점”을 태스크 생성 시 계산하면 된다.

### A2. 파일 비중첩만 보고 의미 충돌을 놓침

**패턴:** 서로 다른 파일을 쓰더라도 같은 정책·어휘·생성물 계약을 동시에 바꾸면 의미 충돌이 난다.

**저장소 사례:** `AGENTS.md`는 decision/integration 직렬화를 요구한다. `docs/decisions/2026-09-24-evolution-roadmap.md`는 generated protocol 접점은 한 시점에 하나만 실행하고 Rust 변경과 codegen 산출물을 함께 묶으라고 일반화한다. 이는 물리적 파일 충돌보다 **소스 오브 트루스 충돌**이 더 중요하다는 선례다.

**질문 유발:** 두 태스크가 각자 “올바른” 기본 매핑이나 어휘를 고르면 통합 시 어느 쪽이 권위인지 Lead 결정을 요구한다.

**분류:** 자동 분류 가능. `decision`, `integration`, generated protocol, 동일 정책 키/도메인 어휘 접점은 기본 직렬화한다.

### A3. 요구사항에 결과와 구현 선택이 섞임

**패턴:** 요구사항이 WHAT/WHY가 아니라 특정 계층·파일·라이브러리까지 고정하거나, 반대로 설계가 필요한 선택을 요구사항에서 생략한다.

**저장소 사례:** `docs/design/research/design-md-practices.md` §3.3은 스펙에서 구현 세부를 금지하고 `[NEEDS CLARIFICATION]`을 사용하라고 한다. 반면 `docs/design/research/design-md-review.md` §5 관찰 2는 `design.md`의 EARS 요구사항에 presentation 계층명이 들어간 점을 의도적 소유권 요구로 판정하면서도 형식상 긴장으로 기록한다.

**질문 유발:** 워커가 “이 위치는 진짜 요구인가 예시인가”를 판단해야 한다. 위치를 따르면 과제 목적을 놓칠 수 있고, 바꾸면 scope 위반이 될 수 있다.

**분류:** 일부 자동 해소 가능. 요구사항에는 관찰 가능한 결과, 설계에는 소유권·파일을 둔다. 경계 자체가 요구인 경우 `constraint:`로 별도 표기한다.

### A4. 연기된 결정에 현재 실행 기본값이 없음

**패턴:** “후속 결정”, “나중에 재평가”만 있고 그 전까지 무엇을 할지 쓰지 않는다.

**저장소 사례:** 좋은 선례로 `docs/design/design.md` §8은 D-2에 “현재는 herdr 유지+규격화”, D-5/D-6에는 재질의 트리거를 적는다. 반대로 이런 임시 기본값이 없다면 구현 태스크는 결정을 기다리거나 attention을 올릴 수밖에 없다.

**질문 유발:** 지금 단계에서 기능을 생략할지, 최소 구현할지, 확장점을 미리 만들지 판단할 수 없다.

**분류:** 자동 해소 가능. 모든 deferred 항목에 `until-trigger default`를 필수화한다.

### A5. 가정은 있으나 가정이 틀렸을 때의 행동이 없음

**패턴:** 환경·소비자·호출 경로에 대한 가정을 적지만, 가정 실패 시 중단/폴백/기록 중 무엇을 할지 없다.

**저장소 사례:** `docs/design/jwt-validation-middleware.md`는 “HTTP surface가 아직 없다”는 가정과 첫 소비자를 제시한다. 이 상태에서 실제 소비자가 Rust-side로 정해지면 bridge seam이 불필요할 수 있다고 위험 절에 기록한다. 하지만 태스크마다 “소비자가 아직 없으면 middleware 태스크를 생략” 같은 실행 규칙이 없으면 워커가 질문할 여지가 남는다.

Herdr 연구들은 더 명확하다. live 실측은 유료 호출 위험 때문에 실행하지 않고 fake-runner 검증을 완료 증거로 사용하되 “별도 실측 필요”로 남긴다. 가정의 증거 수준과 다음 행동이 함께 있다.

**분류:** 자동 해소 가능. 가정마다 신뢰도, 반증 조건, 반증 시 기본 행동을 적는다.

### A6. 의존성이 순서만 말하고 입력 계약을 말하지 않음

**패턴:** `dependsOn`은 선행 완료를 보장하지만 후행 태스크가 어떤 파일·요약·결정·검증 출력을 소비해야 하는지 불명확하다.

**저장소 사례:** `docs/design/research/design-md-practices.md` §2.2는 Kiro가 세 스펙 파일 전체를 구현 대화에 주입하고, EARS 기준을 태스크 완료 기준으로 연결한다고 설명한다. `docs/design/design.md`의 표는 요구사항 ID 연결은 강하지만, 선행 태스크가 후행 태스크에 넘길 **필수 evidence bundle**은 별도 열로 표현하지 않는다.

**질문 유발:** 후행 워커가 선행 결과의 어느 부분이 규범인지, 단순 보고인지 재확인하게 된다.

**분류:** 자동 해소 가능. 의존 엣지마다 `consumes:`를 두고 산출물/결정 ID/검증 로그를 지정한다.

### A7. completion check가 존재 확인에 머무름

**패턴:** 비어 있지 않은 check는 있지만 내용의 정확성을 판정하지 못한다.

**현재 태스크 사례:** `test -s … && grep -qi '기본값\|default' …`는 문서 존재와 키워드만 확인한다. 요구된 “관행 5개 이상”, “기존 연구와 중복·충돌 검토”, “상위 5개 근거”는 검사하지 못한다.

**저장소 사례:** `docs/design/research/design-md-review.md`는 정적 문서 검증이 실제 구현 명령 출력이 아니라는 한계를 명시한다. Herdr 검증 문서들은 fake-runner PASS와 실제 라이브 실측 미수행을 분리한다. 이는 check에 **증거 등급**이 필요함을 보여준다.

**질문 유발:** 워커는 최소 grep만 만족하면 되는지, 산문 요구 전체를 수동 검증해야 하는지 판단해야 한다. 후속 통합 노드가 다시 물을 가능성이 높다.

**분류:** 자동 해소 가능. 구조 grep/스크립트 + 의미 체크리스트 + 증거 등급을 함께 둔다.

### A8. 실패·재시도·attention의 한도가 태스크에 없음

**패턴:** AGENTS.md는 exhausted failure만 attention 대상으로 정하지만 “exhausted”의 횟수와 대체 경로가 태스크마다 없다.

**저장소 사례:** `docs/research/self-trace-patterns.md`는 실제 세션에서 재시작보다 작은 retry/rework loop가 우세했다고 관찰한다. `docs/design/research/herdr-live-pane-survey.md`는 `agent_pane_busy`를 250ms 간격 최대 3회 재시도하는 구체 계약을 기록한다. 반면 일반 연구/구현 태스크에는 retry budget이 자주 없다.

**질문 유발:** 첫 실패에서 Lead에게 묻거나, 반대로 무한 반복할 수 있다.

**분류:** 자동 해소 가능. 실패 종류별 retry 횟수와 fallback을 태스크 기본값으로 둔다.

---

## 3. Lead에게 묻지 않고 해소하는 관행

아래 관행은 모두 “질문을 숨긴다”가 아니라 **가역적이고 보수적인 선택으로 진행하면서 불확실성을 기록**하는 방식이다. material decision, 비가역 변경, credential/비용, 범위 충돌은 여전히 attention 대상이다.

### P1. 질문 임계값 + attention 예산을 태스크에 선언

**규칙**

- 태스크 기본 attention 예산은 **0회**다.
- 다음 네 범주만 예산을 소비할 수 있다: (a) 비가역 데이터/공개 API 변경, (b) 보안·credential·유료 호출, (c) 선언 write scope 충돌, (d) 서로 양립할 수 없는 요구사항.
- 그 밖의 불확실성은 기본값·가정 원장·후속 위험으로 처리한다.
- 예산이 0인데 material 조건이 발생하면 한 번의 묶음 질문으로 올리고, 사소한 질문 여러 개로 쪼개지 않는다.

**사례**

- 라이브 Herdr 검증은 유료 호출 가능성이 있어 실행하지 않고 fake-runner 증거로 완료한 뒤 “별도 실측 필요”로 남긴다. 이는 비용 관련 attention을 자동 실행으로 우회하지 않는 보수적 선택이다(`herdr-inline-panes-review.md` 검증 방법).
- 미지 persona id는 material하지 않으므로 attention 없이 kind 기본값으로 폴백하고 경고만 기록한다(`worker-persona-contract.md` D3).

**효과:** 질문 가능 조건을 사전에 닫고, attention을 제품·데이터 안전에만 보존한다.

### P2. 태스크마다 `defaults` 블록을 둔다

**규칙**

모호할 때 적용할 선택을 태스크 명세에 명시한다.

```text
defaults:
  scope: 선언된 파일 중 최소 변경
  compatibility: 현재 출력·저장 형식 보존
  dependencies: 새 의존성 추가 안 함
  evidence: offline/static/fake 우선, live는 별도
  failure: 최대 2회 재시도 후 가역적 fallback
  deferred: 현재 동작 유지
```

선택 우선순위는 **안전 > 기존 호환 > 범위 최소 > 단순성 > 확장성**으로 고정한다.

**사례**

- WorkerState 저장 어휘 변경 대안에서 현재 소문자 저장 문자열을 보존하는 안을 채택해 migration 질문을 제거했다(`evolution-roadmap.md` 실행 1).
- 색 환경 판정 불가 시 무색으로 폴백한다(`design.md` §5.2). 보기 좋은 출력보다 로그 안전성과 기존 동작을 우선한다.
- deferred D-2는 현행 herdr 소유권을 유지하고 문서화만 한다(`design.md` §8).

**효과:** 워커마다 다른 “상식” 대신 저장소가 정한 보수 순서를 적용한다.

### P3. 가정 원장(assumption ledger)을 두고 명시 후 진행

**규칙**

각 가정을 다음 네 필드로 기록한다.

| 필드 | 의미 |
| --- | --- |
| `assumption` | 지금 사실로 두는 것 |
| `evidence` | 파일/결정/테스트 근거 |
| `if_false` | 반증 시 기본 행동 |
| `revisit` | 후속 검토 트리거 |

가정이 write scope 안에서 가역적이고 completion check로 탐지 가능하면 질문 없이 진행한다. 가정이 비가역 변경을 유발하면 attention으로 올린다.

**사례**

```text
assumption: 실제 provider 호출 없이 fake runner가 배치 계약을 검증한다.
evidence: lifecycle.test.ts 기대열 + AGENTS.md 유료 호출 금지.
if_false: PASS를 취소하지 않고 "live evidence missing" 위험으로 분리한다.
revisit: 첫 실제 interactive worker 기동 전.
```

Herdr 검증 문서들이 이 패턴을 사실상 사용한다. `self-trace-patterns.md`도 Loop-native 완료 run이 없음을 숨기지 않고 fixture와 telemetry의 증거 클래스를 분리한다.

**효과:** 질문하지 않은 이유와 판단 근거가 후속 노드에 남아, 통합 단계의 재질문을 줄인다.

### P4. 파일 단위 scope + 의미 접점 태그로 병렬성을 판정

**규칙**

- 가능한 경우 write scope를 파일 단위로 적는다.
- 디렉터리 범위가 필요한 신규 파일은 예상 파일명과 `must-not-touch`를 함께 둔다.
- 경로와 별도로 의미 접점 태그를 선언한다: `policy:<name>`, `domain-type:<name>`, `generated-protocol`, `persistent-format:<name>`, `presentation-vocabulary`.
- 파일이 달라도 같은 의미 접점의 decision/integration 변경은 직렬화한다.

**사례**

```text
T3 writes: packages/presentation/src/snapshot.ts
T3 must-not-touch: packages/presentation/src/reports.ts
T4 writes: packages/presentation/src/reports.ts, packages/cli/src/main.ts
T4 must-not-touch: packages/presentation/src/snapshot.ts
semantic touchpoint: presentation-vocabulary (read-only in both)
```

이렇게 적으면 `design.md` §7의 T3/T4 병렬성 긴장을 Lead 질문 없이 해소할 수 있다. generated protocol은 기존 로드맵 선례대로 무조건 단일 직렬 레인으로 둔다.

**효과:** 파일 충돌과 정책 충돌을 모두 사전에 탐지한다.

### P5. 의존 엣지에 `consumes` 계약을 추가

**규칙**

후행 태스크는 선행 태스크 이름만이 아니라 다음 중 무엇을 소비하는지 선언한다.

- 결정 ID와 채택 옵션
- 생성된 파일/타입
- 검증 명령과 종료 코드
- unresolved risk 목록
- dependency summary의 최대 행수와 필수 항목

의존 요약은 새 지시가 아니라 증거라는 worker instruction과 정합하게, `facts / decisions / artifacts / checks / risks` 다섯 칸으로 제한한다.

**사례**

```text
implementation consumes:
  decision: D3 = unknown persona → kind fallback
  artifact: generated TaskSpecInput.persona
  check: bun run codegen:check exit 0
  risk: built-in persona file may be absent
```

이 방식은 `worker-persona-contract.md`의 구현 순서를 단순 순서가 아니라 명시적 인수인계 계약으로 바꾼다.

**효과:** 후행 워커가 선행 문서 전체를 재해석하거나 Lead에게 권위 소스를 묻지 않아도 된다.

### P6. 완료 계약을 `artifact + semantics + evidence level` 3층으로 작성

**규칙**

1. **Artifact:** 파일/코드/생성물이 존재한다.
2. **Semantics:** 요구 개수, 필수 절, 금지 사항, 핵심 동작을 검사한다.
3. **Evidence level:** static, unit/fake, integration, live 중 실제 확보한 수준과 미확보 수준을 구분한다.

**사례 — 본 태스크에 더 강한 check를 적용한다면**

```sh
test -s docs/research/2026-09-25-autonomous-completion-decomposition-facts.md
grep -q '## 4. 채택 가능한 상위 5개' ...
test "$(grep -c '^### P[0-9]' ...)" -ge 5
grep -q 'self-trace-patterns.md' ...
```

그리고 사람/통합 노드가 “각 관행에 규칙·사례·근거가 있는가”를 의미 체크리스트로 검토한다. 정적 문서 검사는 live 효과 증거가 아님을 위험에 남긴다.

**효과:** “worker success ≠ completion”을 그래프 분해 시점에 구체화한다.

### P7. 실패 분류별 재시도·폴백 예산을 선언

**규칙**

- 일시적/경쟁 실패: 동일 시도 최대 3회, 짧은 고정 backoff.
- 결정적 테스트 실패: 같은 명령 무재시도, 원인 수정 후 1회 재검증.
- 외부 도구/라이브 환경 부재: offline/fake 증거로 강등하고 위험 기록.
- scope 충돌·비가역 위험: 즉시 attention.

**사례:** Herdr `agent_pane_busy`의 250ms × 3회 재시도는 좋은 구체 선례다(`herdr-live-pane-survey.md` §1.2). `self-trace-patterns.md`의 작은 implement↔verify 반복 관찰은 무조건 재시작보다 국소 재시도가 현재 작업 방식과 맞음을 보여준다.

**효과:** 첫 실패 질문과 무한 재시도를 동시에 줄인다.

### P8. deferred 결정에는 “현재 기본값 + 재질의 트리거 + 소유자”를 필수화

**규칙**

```text
deferred:
  question: herdr label ownership
  until_trigger_default: keep in herdr; document only
  trigger: second consumer needs the label vocabulary
  owner: follow-up decision node
```

**사례:** `design.md` §8 D-2/D-5/D-6이 이 형식에 가깝다. W3C JSON 토큰은 Rust/TS 공유가 필요해질 때만 승격하고, 그 전에는 TS 상수 모듈을 유지한다.

**효과:** 미래 결정을 현재 실행의 blocker로 만들지 않는다.

### P9. 요구사항·제약·설계·예시를 문법적으로 분리

**규칙**

- `requirement:` 관찰 가능한 결과
- `constraint:` 바꿀 수 없는 경계/호환 조건
- `design:` 이번 결정의 구현 선택
- `example:` 비규범 예시

EARS의 SHALL에는 결과만 두고, 파일 경로나 패키지 소유권이 필수이면 `constraint`로 승격한다. `[NEEDS CLARIFICATION]`은 accepted 전 0개여야 하지만, 실행 중 새로 발견된 비중요 불확실성은 assumption ledger로 처리한다.

**사례:** “presentation 계층을 통해서만 어휘를 결정한다”는 문장을 결과 요구와 소유권 제약으로 나누면, `design-md-review.md` §5 관찰 2의 긴장이 사라진다.

**효과:** 워커가 예시를 의무로 오해하거나, 의무를 자유 선택으로 오해하는 일을 줄인다.

---

## 4. 채택 가능한 관행 상위 5개

| 순위 | 관행 | 채택 근거 | 즉시 적용 비용 |
| --- | --- | --- | --- |
| **1** | **태스크별 `defaults` 블록(P2)** | persona 폴백, 무색 폴백, 저장 형식 보존 등 저장소 안 성공 선례가 많다. 질문 없이도 가장 안전한 선택 순서를 직접 제공한다. | 매우 낮음 — 태스크 스키마/프롬프트 산문 추가부터 가능 |
| **2** | **완료 계약 3층화(P6)** | AGENTS.md의 “worker success ≠ verification”을 실제 판정으로 만든다. 현재의 존재/grep check가 놓치는 의미 요건과 증거 등급을 보완한다. | 낮음 — check와 체크리스트 확장 |
| **3** | **파일 단위 scope + 의미 접점 태그(P4)** | 현재 분해의 핵심 위험은 “scope를 썼지만 실제로 겹침”이다. generated protocol 직렬화 선례가 이미 있다. 병렬 충돌·통합 질문을 동시에 줄인다. | 낮음~중간 — 태스크 생성 시 경로 정밀화 필요 |
| **4** | **가정 원장(P3)** | self-trace의 fixture/telemetry 구분과 Herdr의 fake/live 증거 구분을 일반화한다. 질문을 생략해도 판단 근거와 재검토 조건이 남는다. | 낮음 — 결과 보고 형식 확장 |
| **5** | **attention 예산·질문 임계값(P1)** | AGENTS.md의 material-only 원칙을 실행 가능한 분류표로 바꾼다. 사소한 확인 질문을 막으면서 보안·비용·비가역 위험은 보존한다. | 낮음 — 태스크 기본값 0 + 예외 4종 |

**차선:** 의존 `consumes` 계약(P5)은 효과가 크지만 task/protocol 표면 확장이 필요할 수 있어 2단계로 권한다. deferred 3필드(P8), retry budget(P7), 문법 분리(P9)는 위 상위 5개를 안정화하는 작성 규칙으로 함께 적용할 수 있다.

---

## 5. `self-trace-patterns.md` 및 기존 연구와의 중복·충돌 검토

### 5.1 `docs/research/self-trace-patterns.md`

- **중복 아님:** self-trace는 실제 agent-session telemetry에서 검증이 interleaved되고 evidence가 mutation보다 선행하며 retry/rework가 우세하다는 **실행 관찰**이다. 본 문서는 실행 전 **태스크 분해 계약**을 다룬다.
- **보강 관계:** self-trace의 “작은 implement↔verify 사이클”은 P7의 국소 재시도 기본값을 뒷받침한다. fixture와 telemetry를 구분한 증거 경계는 P3/P6의 evidence level로 일반화된다.
- **충돌 없음:** self-trace는 attention을 없애라고 하지 않는다. 실제 Loop-native 완료 run이 없다는 한계를 명시하므로 본 문서도 질문 감소 효과를 사실로 과장하지 않는다.

### 5.2 `docs/design/research/design-md-practices.md`와 `docs/design/design.md`

- **부분 중복:** 요구사항 ID, exact file paths, `[P]`, decision gate, completion check는 기존 연구가 이미 권고한다.
- **추가점:** 본 문서는 선언 형식보다 **실행 기본값, attention 예산, assumption ledger, 의미 접점, evidence level**을 추가한다. 특히 “scope 선언 자체가 모호할 수 있음”을 `design.md` T3/T4 사례로 드러낸다.
- **충돌 없음:** 기존 `[NEEDS CLARIFICATION]`은 설계 승인 전 모호성 제거 장치다. 본 문서의 “가정 후 진행”은 accepted 이후 실행 중 발생한 비중요·가역적 불확실성에만 적용한다. 서로 다른 단계다.

### 5.3 Herdr 검증 연구

- **중복 아님:** Herdr 문서는 특정 런타임 배치와 TUI 메커니즘 검증이다.
- **일반화:** fake-runner PASS와 live 실측 미수행을 분리한 방식을 P3/P6의 일반 관행으로 추출했다. 유료 호출 가능 시 자동 실행하지 않는 것은 P1의 material attention 경계와 정합한다.

### 5.4 기존 결정 문서와의 충돌 여부

- `worker-persona-contract.md`의 advisory 폴백은 P2와 직접 정합한다.
- `evolution-roadmap.md`의 decision/integration 및 generated protocol 직렬화는 P4와 정합한다.
- AGENTS.md 경계를 옮기지 않는다. 모든 권고는 우선 태스크 명세·프롬프트·검증 작성 관행이며, Rust 도메인 타입이나 TS 어댑터 계층 변경을 요구하지 않는다.

---

## 6. 적용 예시 — 모호한 태스크를 자율 실행 가능한 태스크로 바꾸기

### 변경 전

```text
Task: presentation 포맷터를 정리한다.
Writes: packages/presentation/src/**, packages/cli/src/main.ts
Depends on: vocabulary module
Check: bun test packages
```

질문 후보: 어느 파일에 둘지, snapshot.ts를 바꿔도 되는지, 출력 변경이 허용되는지, 선행 모듈의 어떤 결정을 따라야 하는지, 테스트 실패를 몇 번 재시도할지 알 수 없다.

### 변경 후

```text
Task: move-cli-report-formatters
kind: implementation
writes:
  - packages/presentation/src/reports.ts
  - packages/presentation/src/index.ts
  - packages/cli/src/main.ts
must-not-touch:
  - packages/presentation/src/snapshot.ts
semantic-touchpoints:
  - presentation-vocabulary (consume-only)
dependsOn:
  - add-presentation-vocabulary-module
consumes:
  - artifact: packages/presentation/src/tokens.ts
  - decision: glyph values remain byte-identical
  - check: bun test packages/presentation exit 0
defaults:
  - preserve output bytes
  - add no dependency
  - choose the smallest pure formatter interface
assumptions:
  - assumption: existing CLI contract tests cover all four reports
    if_false: add focused offline tests; do not ask Lead
attentionBudget: 0
attentionOnlyIf:
  - write scope conflict
  - incompatible output contracts
completion:
  - artifact: reports.ts exported and CLI delegates
  - semantics: no report formatter remains in main.ts; snapshots unchanged
  - evidence: bun test packages && bun run test:architecture
```

이 형태는 기존 경계를 바꾸지 않으면서 질문이 생길 지점을 태스크 생성 시점에 닫는다.

---

## 7. 미해결 위험과 후속 측정

1. **효과 계측 부재:** Loop-native 완료 run이 없어 “질문 수 감소”를 정량 입증하지 못했다. 후속 run에서 task별 attention count, attention reason, assumption count, fallback count를 수집해야 한다.
2. **과도한 기본값 위험:** 잘못된 기본값이 질문보다 더 큰 재작업을 만들 수 있다. 따라서 기본값은 가역적·보수적이어야 하며 비가역/보안/비용/범위 충돌은 예외로 남긴다.
3. **태스크 명세 비대화:** 모든 소형 태스크에 9개 관행을 강제하면 작성 비용이 커진다. 상위 5개를 기본 템플릿으로 두고, P5/P7/P8/P9는 해당 위험이 있을 때만 추가하는 경량화가 적절하다.
4. **의미 접점 자동 판정 한계:** 파일 경로는 기계적으로 비교 가능하지만 정책·도메인 어휘 충돌은 태그 품질에 의존한다. 초기에는 generated protocol, persistent format, config key, presentation vocabulary 네 종류만 폐쇄 집합으로 시작하는 편이 안전하다.
5. **completion check의 의미 검증 한계:** shell grep은 산문 품질을 완전히 검증하지 못한다. integration/verification 노드의 구조화 체크리스트가 계속 필요하며, worker 자기 보고만으로 완료 처리해서는 안 된다.

## 8. 출처

- `AGENTS.md` — scope/의존 선언, decision·integration 직렬화, completion/attention 규칙.
- `docs/decisions/2026-09-22-worker-persona-contract.md` — kind 기본 persona, 미지 id 폴백+경고, hard fail/attention 회피 선례.
- `docs/decisions/2026-09-24-evolution-roadmap.md` — 대안 비교, generated protocol 직렬화, 저장 형식 보존 기본값.
- `docs/design/design.md` — 요구사항–태스크 역추적, deferred 결정의 기본 행동·트리거, T3/T4 병렬 범위 사례.
- `docs/design/jwt-validation-middleware.md` — 순차 타입 소비 그래프, 가정/위험, 오프라인 검증 계약.
- `docs/design/research/design-md-practices.md` — EARS, `[NEEDS CLARIFICATION]`, exact paths, `[P]`, gate/traceability 관행.
- `docs/design/research/design-md-review.md` — 정적 문서 검증 한계와 요구사항/계층 소유권 긴장.
- `docs/design/research/herdr-live-pane-survey.md`, `herdr-live-panes-review.md`, `herdr-inline-panes-review.md`, `herdr-tabs-revert-review.md` — bounded retry, fake/live 증거 분리, 별도 실측 위험 기록.
- `docs/design/research/improvement-cycle-review.md`, `watch-columns-review.md` — 계획과 실제 산출물 차이, 완료 check와 ADR 요구 간 공백 사례.
- `docs/research/2026-09-24-backlog-reconciliation.md` — 정적 재감사와 잔여 항목 분류.
- `docs/research/self-trace-patterns.md` — evidence-first, interleaved verification, 국소 retry/rework 관찰과 Loop-native run 부재 한계.

## 9. 본 문서 검증

- 요구된 모호성 패턴: A1–A8, 8개.
- 질문 없는 해소 관행: P1–P9, 9개(각 규칙과 저장소 사례 포함).
- 채택 가능한 상위 관행: §4의 5개와 근거.
- 중복·충돌 확인: §5.
- 증거 수준: 저장소 문서 정적 대조. 유료 모델/실제 provider 호출 없음.
