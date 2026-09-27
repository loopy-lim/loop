# Pi Lead 한 대화에서 끝나는 Loop 개발 흐름

- 날짜: 2026-09-27
- 상태: 구현 완료; 오프라인 검증의 기존 baseline 실패와 실공급자 속도 비교 한계는 검증 기록 참조
- 범위: Herdr 안의 Pi Lead TUI, Loop CLI 인계·관찰, 기존 Rust 실행 그래프와 steering 경로
- 근거: [개발 속도 비교 조사](../../research/2026-09-27-agent-development-velocity-comparison.md), [Herdr worker 탭 결정](../../decisions/2026-09-24-herdr-live-conversation-tabs.md), [출력 한도](../../decisions/ui-output-limits.md)

## 목표

사용자는 Herdr의 **한 Pi Lead 대화**에서 개발 요청을 시작하고, 진행 상황을 묻고, 실행 중 방향을 바꾸고, 필요한 결정을 내리고, 검증 결과를 받는다. 작업 ID와 `/loop` 명령 문법을 알 필요가 없다. worker 탭은 같은 workspace 안에서 자세한 과정을 보는 보조 화면이다. Loop는 작은 작업을 불필요하게 분해하지 않고, 모든 작업의 읽기·쓰기 범위와 완료 계약을 유지한다.

성공은 모델의 첫 응답 시간이 아닌 **요청부터 검증 가능한 코드 변경까지의 시간과 완료 품질**로 판단한다. 성능 향상률은 현재 실측이 없으므로 미리 선언하지 않는다. 동일한 개발 태스크에서 기존 흐름과 새 흐름을 측정해 결과를 기록한다.

## 사용자 경험 계약

| 사용자 입력 또는 상황 | Lead TUI 동작 |
| --- | --- |
| “이 버그 고쳐줘” | 필요한 최소 문맥을 확인하고 범위·의존성·완료 검사가 있는 작은 그래프를 제출한다. 실행 owner가 확인되면 Lead는 즉시 다음 대화를 받을 수 있다. |
| “어디까지 됐어?” | 현재 실행의 영속 스냅샷을 읽어 8줄 이내로 답한다. 상태 표시에는 작업 진행 수, worker 수, 열린 attention 수만 간결하게 둔다. |
| “지금 작업에서 X는 빼줘” | 진행 중인 해당 작업과 후손에게 원문 지시를 기록·전달한다. 접수와 실제 worker 전달을 구별해 말한다. |
| “Y도 추가해줘” | 이미 끝난 작업을 다시 쓴 척하지 않는다. 새 작업의 의존성·범위·완료 계약을 명시해 현재 활성 그래프에 추가하거나, 실행이 종료됐다면 새 실행을 만든다. |
| “잠깐 멈춰”, “계속해”, “취소해” | 현재 실행을 확인한 뒤 기존 pause/resume/cancel 제어 경로를 호출한다. 모호한 실행 대상만 사용자에게 묻는다. |
| attention 발생 또는 “1번 승인해” | 중요한 질문·승인·충돌·실패만 6줄 이내로 표시한다. 승인을 추측하지 않고 해당 attention을 사용자의 명시적 답으로 해결한다. |
| 모든 작업 종료 | worker 성공과 완료 검사를 구분하여 최종 결과, 검사 증거, 남은 한계를 8줄 이내로 같은 TUI에 남긴다. |

정상 진행은 Pi footer 상태와 편집기 위 2줄 위젯을 갱신하고, 주의 항목과 종료 결과만 대화에 알린다. 위젯은 진행 수와 현재 작업 또는 필요한 결정을 표시하며, 실행 종료·세션 변경·관찰 오류에는 제거한다. 대화 입력의 초점은 Pi 편집기에 둔다. 5줄 이내 findings 한도를 포함해 기존 출력 정책을 적용한다. 기존 `/loop` 명령은 호환 경로로 유지할 수 있지만 도움말이나 완료 안내의 필수 다음 단계로 제시하지 않는다.

## 현재 코드와 변경 경계

- `packages/pi-loop/src/extension.ts`의 `loop_run`은 `__execute-plan --json --stream`의 최종 summary까지 기다린다. 설치된 Pi는 실행 중 Enter 입력을 현재 assistant turn의 도구 호출이 끝난 뒤 다음 모델 호출에 전달한다. 이 조합이 Lead의 중간 대화를 막는다.
- `packages/cli/src/main.ts`에는 `__execute-plan --detach`가 있지만, 현재 `spawnOwner`의 프로세스 생성만 확인하고 반환한다. 실제 실행 lease 또는 매우 빠른 terminal 상태를 확인한 결과가 필요하다.
- `packages/orchestrator/src/mailbox.ts`는 `GuidanceAdded`와 `GuidanceDelivered`를 사용해 live steer와 다음 claim 주입을 처리한다. `packages/providers/src/herdr-agent.ts`는 Herdr의 대화형 worker에게 steer할 수 있다. 이 전달 엔진을 복제하지 않는다.
- `crates/loop-bridge/src/commands.rs`에는 `add_task`가 있다. Pi Lead와 CLI에는 노출되지 않았고, 현재 명령은 그래프를 읽어 검사한 뒤 별도 저장 동작으로 이벤트를 추가한다. 두 동작 사이 경합을 닫아야 한다.
- `packages/herdr/src/client.ts`는 worker당 초점 이동 없는 탭 하나를 만들고 해당 worker 탭만 닫는다. Lead 탭과 workspace는 닫지 않는다. 이 배치 규칙을 유지한다.
- 기본 사용자 구성 경로의 `personas/`가 없으면 worker 역할 지시가 조용히 생략된다. `scripts/install-local.sh`는 저장소의 `config/personas/*.md`를 아직 설치하지 않는다.

## 구조와 책임

```text
사용자 ↔ Pi Lead TUI
          ├─ 모델 도구: 시작, 상태, steer, 작업 추가, attention, 제어
          ├─ 세션 바인딩: run ID + 정규화된 작업 디렉터리
          └─ 읽기 전용 관찰자: 상태 표시 + attention/완료 알림
                    ↓
             Loop CLI JSON 경계
                    ↓
  generated protocol → Rust bridge/store/core
                    ↓
       실행 owner → orchestrator → Herdr worker 탭
```

Rust는 실행 상태, 그래프 유효성, 작업 범위·의존성, 완료 계약, 이벤트 순서를 결정한다. CLI는 Pi가 사용할 JSON 제어·관찰 경계다. Pi 확장은 현재 실행을 식별하고 사용자의 문장을 적절한 도구 호출로 연결하며 TUI를 표시한다. 실행 owner는 Lead나 Pi 관찰자의 수명과 독립적이다. 모델·provider 이름, Herdr 탭 정보, Pi 세션 정보는 `loop-core`에 들어가지 않는다.

### 1. 안전한 실행 인계

`loop_run`은 계획을 제출하고 detached owner를 시작한다. CLI는 `prepare`와 프로세스 생성 뒤 짧은 유계 대기로 스냅샷을 확인한다. **생성한 child PID에 해당하는 유효 lease**, 또는 매우 빠르게 끝난 실행의 terminal 결과를 확인한 뒤에만 접수 결과를 반환한다. PID가 사라지거나 제한 시간 안에 lease가 생기지 않으면 `runId`와 실제 저장 상태를 포함한 오류를 돌려준다. 단순한 프로세스 생성만으로 “실행 중”이라고 말하지 않는다.

Pi 확장은 이 접수 결과 이후에만 현재 run을 세션에 기록한다. 모델 도구 호출이 반환되면 Pi가 Enter로 받은 다음 사용자 문장을 처리할 수 있다. 사용자가 Pi를 종료해도 owner는 유지되고, 종료되는 것은 Pi 측 관찰자뿐이다. cancel/pause는 별도의 명시적 제어 동작이다.

### 2. Pi 세션 바인딩과 관찰

Pi 세션에는 `runId`와 정규화된 작업 디렉터리만 비밀정보 없이 기록한다. `session_start`와 세션 브랜치 변경 시 현재 브랜치의 마지막 바인딩을 재구성하고, Loop 스냅샷의 작업 디렉터리와 대조한다. 바인딩이 없을 때는 같은 디렉터리의 활성 실행이 정확히 하나인 경우에만 자동 연결한다. 여러 실행이나 경로 불일치가 있으면 사용자가 Lead 대화에서 선택한다. 스냅샷이 진실의 원천이고 Pi 세션 항목은 연결 힌트다.

Pi 세션 관찰자는 기존 `loop watch --json` 또는 같은 읽기 전용 snapshot 경계를 이용해 상태 변화만 받는다. 상태 표시와 attention/완료 알림은 모델 호출 없이 갱신하며, 중복 sequence는 다시 출력하지 않는다. 종료 결과는 Pi 세션 기록과 TUI에 짧은 영속 항목으로 남긴다. 관찰자가 끊기면 다시 스냅샷을 읽고 마지막 sequence 이후부터 회복한다. `attention`이나 `paused` 상태에서 관찰이 정상 종료돼도 resolve/resume 뒤 다시 관찰한다. 관찰 오류는 실행을 취소하지 않으며 TUI에 관찰 실패로 표시한다. 세션 브랜치가 바뀌면 이전 브랜치의 관찰자를 먼저 끊고 새 바인딩을 확인한다. 세션 종료·교체 때 관찰 프로세스만 정리한다.

### 3. 자연어 동작과 실행 중 작업 추가

Lead는 후속 입력마다 현재 스냅샷을 기준으로 다음 중 하나를 고른다: 상태 질문, 진행 중 작업 수정, 새 작업 추가, attention 답변, pause/resume/cancel, 별개 목표의 새 실행. 대상이 하나로 특정되지 않거나 작업 범위가 충돌하면 간결하게 묻는다. 같은 작업 디렉터리에서 별개 목표를 요청했는데 이전 실행이 아직 활성이라면, 기존 목표에 포함할지 완료 후 새 실행으로 이어갈지 먼저 묻는다. 서로 다른 실행이 같은 파일을 동시에 쓰도록 조용히 시작하지 않는다. run ID·task ID는 도구 내부 인자이며 사용자에게 요구하지 않는다. 상태 조회를 포함한 각 동작은 모델이 호출할 수 있는 Pi 도구로 제공한다.

기존 작업 수정에는 사용자가 보낸 **원문 지시**를 `steerRun`에 기록한다. Lead는 대상 작업을 고르되 원문의 의미를 바꿔 재작성하지 않는다. 새 허용 기준이 생기면 활성 worker에 steer할 수 있어도 그것만으로 완료를 주장하지 않는다. 해당 기준을 직접 확인하는 실행 검사와 쓰기 범위를 가진 의존 작업을 추가한다. 실행이 이미 종료됐다면 후속 실행을 만든다. 모든 worker에 무조건 broadcast하지 않는다.

새 작업은 생성된 `TaskSpecInput` 계약을 사용한다. Rust bridge/store의 한 원자적 쓰기 경계 안에서 최신 projection, 전체 그래프, 의존성, 명시적 read/write scope와 비어 있지 않은 완료 계약을 검증하고 `TaskCreated`를 기록한다. 추가를 허용하는 실행 상태는 `active`, `paused`, `attention`이다. `pausing`, `cancelling`, terminal 상태에서는 이유를 반환하고 실행 상태를 새로 확인한다. 완료와 추가가 경합하면 저장 결과를 다시 읽어, 원래 사용자 요청을 잃지 않은 채 새 실행으로 넘긴다. 이미 시작한 작업의 소유 범위는 사후 변경하지 않는다. 중첩 범위는 기존 스케줄러 충돌 규칙과 명시적 의존성으로 안전하게 직렬화한다.

사용자에게는 `기록됨`, `worker에게 전달됨`, `완료 검사 통과`를 서로 다른 사실로 보고한다. mailbox의 전달 워터마크는 전송 증거이며 worker가 요청을 올바르게 구현했다는 증거가 아니다.

### 4. worker 탭과 역할 지시

Herdr는 Lead가 있는 workspace에 worker당 `--no-focus` 탭 하나를 만들고, task·kind·attempt 이름을 보여 준다. Pi 위젯은 활성 worker의 task ID를 표시해 해당 탭을 찾을 수 있게 한다. `worker_visibility=panes`이고 Herdr Lead pane에서 실행한 경우 탭 이름과 Pi 위젯에 짧은 실행 식별자를 표시하며, 성공한 대화형 worker 탭은 완료 후에도 살펴볼 수 있게 남긴다. 사용자가 Herdr에서 직접 닫는다. 실패·취소한 worker 탭은 즉시 정리한다. Lead의 질문·승인·steer는 Lead 대화에서 처리한다. Lead는 실행 인계 후 폴링용 `sleep`을 호출하지 않고 turn을 끝내며, 관찰자가 상태와 완료를 표시한다.

설치 스크립트는 누락된 기본 `config/personas/*.md`와 `defaults.toml`만 사용자 구성에 추가하고 기존 파일을 덮어쓰지 않는다. Pi Lead의 persona 목록과 worker의 실제 지시문이 같은 구성 경로에서 파생되는지 설치 검증으로 확인한다. 구성 경로가 `LOOP_CONFIG_DIR`로 바뀐 경우 해당 경로를 기준으로 동작한다.

## 속도·품질 검증

기존 Pi Lead 프롬프트는 작은 수정에 형식적인 연구·결정 노드를 추가하지 말라고 이미 지시한다. 먼저 그 준수율과 실제 시간을 측정한다. 네 fixture를 고정한다: 단일 국소 수정, Rust bridge→codegen→TypeScript 소비자 변경, 서로 충돌하지 않는 두 작업, 실행 중 요구 수정. 같은 태스크와 fake provider/scripted turn에서 기존·새 흐름의 요청→그래프 접수→owner lease→첫 worker 시작→완료 검사 통과 시간을 비교하고, 중간 지시 접수→worker 전달 시간과 작업 수·재시도·attention·검증 실패를 함께 기록한다. 요청 시각은 Pi 입력 경계에서 시각만 기록하며 프롬프트 내용이나 자격증명은 계측에 남기지 않는다. 이벤트/receipt에 없는 “첫 코드 수정 시간”이나 토큰 사용량은 추정하지 않는다.

완료 품질은 의미 있는 focused check와 최종 `bun run check`로 확인한다. worker 성공만으로 목표 완료를 선언하지 않는다. 실제 Pi/Herdr TUI의 한 대화 흐름, worker 탭 배치와 중간 지시 전달은 설치본에서 따로 확인한다. 유료 모델 호출은 단위·마일스톤 테스트에 넣지 않는다. 실공급자 작업 완료 시간과 품질은 별도 증거로 보고한다.

## 실패·복구 계약

| 실패 또는 경합 | 동작 |
| --- | --- |
| owner 생성 후 lease 미확인 | 실행 중으로 보고하지 않는다. 저장 상태와 복구 가능한 run ID를 Lead에 보여 준다. |
| Pi 종료·재시작 | owner는 계속 실행한다. 재개한 세션은 저장 바인딩과 스냅샷으로 관찰을 복구한다. |
| 관찰 프로세스 오류 | 실행 상태를 추측하지 않는다. 상태 표시를 관찰 오류로 바꾸고 스냅샷 재조회로 복구한다. |
| steer 채널 거부 또는 worker 종료 | `GuidanceAdded` 기록은 유지한다. mailbox의 다음 안전 지점·다음 claim 경로와 전달 기록으로 상태를 구별한다. |
| 작업 추가와 run 완료의 경합 | Rust의 원자적 검증에서 한 결과만 이긴다. terminal이면 새 실행으로 이어가며 기존 완료 기록을 바꾸지 않는다. |
| 여러 실행 또는 대상 작업이 모호함 | 임의 broadcast·취소·승인 없이 Lead 대화에서 하나를 고르게 한다. |
| 완료 검사가 실패함 | 검사 실패를 표시하고 기존 재시도·attention 정책을 따른다. 최종 성공 메시지를 내지 않는다. |

## 구현 순서와 수용 기준

1. **기준선:** 네 fixture와 영속 이벤트로 기존 흐름의 작업 수·접수/worker/검증 시간을 기록한다. 측정할 수 없는 항목은 빈칸으로 보고한다.
2. **인계·관찰:** owner lease 확인 후 `loop_run`이 반환되고, Pi 한 대화에서 바로 상태 질문을 받을 수 있다. Pi 종료가 owner를 죽이지 않으며 재시작 후 현재 실행이 복구된다.
3. **자연어 제어:** 실행 중 원문 수정 지시, 새 작업 추가, attention 답변, pause/resume/cancel이 slash 명령 없이 동작한다. 서로 다른 상태인 접수·전달·검증을 정확히 표시한다.
4. **탭·persona:** worker 탭은 초점 이동 없이 생성된다. `panes` 모드에서는 성공한 대화형 worker 탭을 사용자가 검토 후 닫고, 실패·취소 탭은 정리한다. 누락된 기본 persona가 설치되며 사용자 변경은 보존된다.
5. **완료 검증:** Rust 경합/상태 테스트, Pi extension fake backend 테스트, CLI owner 실패 테스트, `bun run codegen` 및 생성물 검사, `bun run check`를 통과한다. Node 대상 extension 빌드·설치본 일치와 실제 Herdr/Pi TUI 동작은 별도 확인한다.

Rust bridge 형식이 바뀌는 경우 Rust 타입을 먼저 수정하고 `bun run codegen` 결과를 함께 커밋한다. TypeScript에 Rust 도메인 타입의 손수 작성한 복사본을 만들지 않는다. 구현 커밋은 이 문서 검토와 별도 계획 이후 수행한다.
