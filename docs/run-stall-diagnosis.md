# 화면은 열려 있지만 실행이 멎는 현상 진단

검증일: 2026-09-22. 앞선 안정화 커밋은 `a2ed996`이다. 이 문서는 이후 사용자 보고를 조사한 추가 수정과 증거를 기록한다.

## 실제 기록에서 확인한 사실

- 실행 `cleanup-support-r7`은 2026-09-22 13:54 KST에 시작하여 14:29 KST에 저장소상 완료되었다. 대응하는 Pi 세션에는 `loop_run` 호출이 남아 있고 도구 응답이 없었다.
- 관찰 시점에 해당 Pi 아래의 `loop __execute-plan` 프로세스와 그 아래 AGY 영속 프로세스 두 개가 남아 있었다. 완료 기록과 화면 대기가 불일치하는 증거다.
- 같은 실행에는 `agy turn timed out after 600000ms.`가 두 차례 기록되었다. 이전 실행들에는 Herdr 상태 대기 시간 초과, 응답 JSON 해석 오류, 사용 중인 pane에 대한 시작 실패가 있었다.
- 실제 Herdr 에이전트 조회에서 완료된 Pi 작업자는 `idle`로 나타났다. Loop의 Pi lifecycle hook 역시 `agent_end`에 `idle`을 보고한다.
- 사용자 SQLite는 읽기용 복사본으로 조사했다. 저장된 실행을 재개·취소하거나 현재 Pi/AGY 프로세스를 종료하지 않았다. 인증 값과 작업 본문은 진단 출력에 포함하지 않았다.

## 재현 및 수정

| 경로 | 재현 결과 | 수정 |
| --- | --- | --- |
| 완료 후 Pi가 계속 대기 | 자식이 완료 summary를 보낸 뒤 살아 있으면 도구 응답이 끝나지 않음 | summary 수신을 도구 완료로 처리하고 관찰 프로세스만 종료. 별도 실행 소유자는 유지 |
| Pi 작업 완료를 시작 실패로 해석 | `working → idle`을 시작하지 않은 것으로 판정 | 해당 작업자의 working 상태를 관측한 뒤 idle이 되면 결과를 읽고 검증으로 전달. 처음부터 idle인 과거 출력은 계속 거부 |
| AGY가 진행 중인데 변화가 보이지 않음 | `step_update`와 stderr가 구독자에게 전달되지 않음 | 민감한 문자열을 가린 진행 정보를 기존 활동 저장·표시 경로로 전달 |
| Herdr 제어 명령 무응답 | 호출이 끝날 때까지 시간 제한 없이 대기 | 15초 제한 후 TERM, 1초 뒤에도 남으면 KILL. 시간 초과를 오류로 전달 |
| Herdr 상태 보고가 Pi 다음 동작을 막음 | `agent_end` hook이 상태 보고 프로세스 종료를 무기한 기다림 | 보조 상태 보고에 2초 제한 적용. 보고 실패가 Pi의 다음 동작을 막지 않음 |

각 수정은 먼저 실패하는 검사로 재현한 뒤 같은 검사가 통과하는 것을 확인했다. Herdr의 일반 텍스트 `read` 응답 처리와 영속 작업자의 자원 해제는 앞선 안정화에 이미 포함되어 있었으며, 이번에는 실제 로컬 프로세스를 사용해 연결된 실행 경로를 추가 검증했다.

## 최종 검증

- `bun run check`: 코드 생성 일치, 타입 검사, 경계 검사, Rust 61개 및 Bun 170개 테스트 통과.
- `bun run test:packaged`: CLI·Node용 Pi 번들 생성 및 가짜 공급자 작업 7개 완료, 최대 동시 작업 3개, 의도한 단계 상승 1회.
- 실제 로컬 영속 프로세스: 성공한 작업자가 종료된 뒤 그래프가 완료 응답을 반환함을 확인.
- 실제 로컬 영속 프로세스의 시간 초과: 설정한 두 번의 시도 후 모든 해당 프로세스를 종료하고 원인이 포함된 확인 요청으로 전환함을 확인.
- 완료 summary 이후 프로세스가 살아 있는 경우, Pi의 응답 반환이 막히지 않는 회귀 검사 통과.
- `working → idle` 정상 종료와 처음부터 idle인 과거 출력 거부를 함께 검증.

유료 모델 호출, 실제 모델 서비스 장애 재현, 실행 중인 사용자 세션의 교체는 수행하지 않았다. AGY의 기존 10분 제한을 임의로 줄이거나 공급자 선택을 바꾸지 않았다. 진행 정보가 없는 조용한 작업이 항상 장애라는 뜻은 아니다.

## 실제 실행 구조와 적용 범위

Herdr의 현재 pane에서 `loop`가 Pi Lead를 실행한다. Pi가 작업 그래프를 제출하면 Loop의 Rust 정책·저장 계층과 TypeScript 실행 계층이 배정·검증·복구를 담당한다. 모든 작업자가 Pi인 것은 아니다. 현재 사용자 모델 설정에는 Pi와 AGY가 함께 등록되어 있다.

현재 `~/.local/bin/loop`는 이 저장소의 `dist/loop`를 가리키는 심볼릭 링크다. 같은 환경에서 컴파일한 경로 검사로 Bun 실행 파일이 링크 대상 경로를 `process.execPath`로 사용하는 것을 확인했다. 기본 경로로 새로 실행하면 새 `dist`의 인접 Pi 번들·네이티브 라이브러리를 사용한다. `LOOP_PI_EXTENSION` 같은 명시적 경로 재정의가 있으면 그 설정이 우선한다.

`~/.local/bin`에 별도로 복사된 예전 Pi 번들·네이티브 라이브러리는 새 dist 파일과 다르지만, 이를 이번 정지의 원인으로 단정하지 않는다. 오래 열어 둔 Pi는 이미 로드한 이전 코드를 유지하므로 새 코드를 사용하려면 Pi/Loop를 새로 실행해야 한다. 기존 세션과 사용자 설정은 보존했다.

## 추가 커밋 계획

1개 커밋, 다음 13개 파일만 포함한다. 기존 README 및 CLI cleanup 추가는 계속 제외한다.

```text
fix(runtime): Pi 완료 대기와 Herdr 장애 시 정지 경로 수정

완료 summary와 Pi의 working-to-idle 전이를 정상 종료로 처리한다.
AGY 진행 정보를 전달하고 Herdr 제어·상태 보고의 무한 대기를 제한한다.
실제 로컬 영속 프로세스로 종료·시간 초과·재시도 종료를 검증한다.
```

- `packages/herdr/src/client.ts`
- `packages/herdr/test/runner.test.ts`
- `packages/orchestrator/test/persistent-lifecycle.test.ts`
- `packages/pi-loop/src/extension.ts`
- `packages/pi-loop/src/herdr-lifecycle.ts`
- `packages/pi-loop/test/herdr-lifecycle.test.ts`
- `packages/pi-loop/test/lead.test.ts`
- `packages/providers/src/antigravity/driver.ts`
- `packages/providers/src/antigravity/persistent.ts`
- `packages/providers/src/herdr-agent.ts`
- `packages/providers/test/adapters-v2.test.ts`
- `packages/providers/test/antigravity-persistent.test.ts`
- `docs/run-stall-diagnosis.md`
