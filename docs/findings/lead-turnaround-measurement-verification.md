# Pi Lead 계측·복구 변경 검증 기록

- 날짜: 2026-09-27
- 범위: `bbc6670` 검사 실패 재시도, `f0fcf2f` 완료 후 목표 재검토, `a89ec9c`·`db06a35` Pi Lead 시간 계측과 첫 실사용에서 찾은 재검토 turn 분류 수정.
- 비교 과제: [고정 fixture](../benchmarks/lead-turnaround-fixtures.md). A의 Pi Lead 경로를 한 번 실행했다. 단일 worker 기준선과 B~D, P50/P95는 아직 `미측정`이다.

## 재현과 변경

저장된 402개 run snapshot을 읽기 전용으로 훑었을 때, 지속 중인 active run에 실행 가능한 task가 남았는데 전진하지 않는 영속 상태는 발견되지 않았다. 최근 실패 사례에는 검증 명령의 nonzero exit가 첫 시도에서 `Assertion`으로 분류되고, 허용된 `maxAttempts`가 남아 있어도 run이 terminal failed로 끝나 종속 task가 blocked되는 경로가 있었다. 이 분기는 제한된 재시도 후 소진 시 attention으로 전환하도록 수정했다. 잘못된 completion contract는 즉시 실패로 남는다. 기존 terminal run의 기록을 자동 변경하지는 않는다.

원래 요청의 일부가 graph에 없으면 모든 등록 task가 done이어도 graph 자체는 이를 알 수 없다. Pi Lead는 이제 terminal 결과를 대화에 표시한 뒤 원래 요청·후속 정정·실행 검사와 대조하는 turn을 한 번 시작한다. 빠진 기준이 있으면 명시적 검사와 함께 후속 run을 만들 수 있다. 자동 후속 run은 같은 재검토를 다시 예약하지 않는다. 명시적으로 취소한 run도 자동 재검토하지 않는다. 이 판단은 모델이 하므로 실제 요청에서 빠진 기준을 항상 찾아낸다는 보장은 아직 없다.

Pi Lead의 시간 영수증은 요청 turn, `loop_run` 호출, 확인된 owner 인계, terminal 결과 표시의 경계만 측정한다. 세션 재연결로 요청 시각을 잃었거나 handoff가 실패하면 없는 구간을 숫자로 채우지 않는다. 표시된 `요청→결과`는 **해당 run의 결과 표시**까지다. 자동 후속 run이 필요한 원래 목표의 전체 완료 시간은 fixture 실행에서 별도로 기록해야 한다.

첫 실사용에서 Pi의 `sendMessage(..., triggerTurn: true)`로 시작한 내부 재검토는 `before_agent_start`를 호출하지 않았다. 이전 구현은 다음 **사용자** turn을 내부 재검토로 잘못 분류해 자동 후속 run 표시를 붙이고 다음 완료 재검토를 생략했다. Pi 0.87.1의 실제 turn 경로와 세션 기록을 확인한 뒤, 내부 `loop-final-review`의 `message_start`와 `agent_end`로 구분하도록 고쳤다. 내부 재검토와 이후 사용자 정정을 연속 실행하는 회귀 테스트가 통과했다. 수정 후의 별도 Herdr 실사용 재현은 아직 수행하지 않았다.

## 실행 증거

| 검사 | 결과 | 증거 범위 |
| --- | --- | --- |
| `bun test packages/pi-loop/test/lead.test.ts packages/pi-loop/test/timing.test.ts` | 33 pass, 0 fail | fake Pi의 내부 재검토·다음 사용자 turn 구분, 취소·시간 누락, 가짜 시계 경계 |
| `bun run check` | exit 0; architecture 8 pass, Bun 669 pass/0 fail, Rust workspace tests 및 codegen/typecheck 통과 | 현재 작업 트리의 오프라인 회귀 검사. 병행 미커밋 변경도 포함됨 |
| `bun run build:cli` | exit 0; Node Pi 확장과 CLI 빌드, native bridge staging | 패키지 생성 |
| 설치된 Pi 확장 비교 | `dist/loop-pi-extension.js`와 `~/.local/bin/loop-pi-extension.js` SHA-256 동일 | 새 Pi Lead 세션에서 이 버전 로드 가능. 이미 실행 중인 Pi 프로세스는 재시작 전까지 구버전일 수 있음 |
| Pi native Z.AI 인증 | `ready` (`pi auth check --provider zai --model glm-5.3-flash --json --no-refresh`) | native auth 저장소의 준비 상태 |
| Pi `glm-5.3-flashx` 짧은 실호출 | 일반 Pi 6.7초, 설치된 Loop 확장 포함 Pi 1.68초; 둘 다 예상 문구, exit 0, 관측 429 없음 | 현재 quota의 두 단일 호출과 확장 로드. 개발 과제 수행·worker 실행·Herdr 화면 완료 증거는 아님 |
| Herdr 실사용 A | 서버 0.8.2, Pi Lead pane `w53:p6B`에서 `loop_run` 제출; worker pane `w53:p6C`가 실행 중 보이고 완료 후 agent 목록에서 사라짐 | 단일 fixture의 TUI 표시·정리 관찰. 다른 실패·중단 경우까지 일반화하지 않음 |

## 고정 과제 A의 첫 실사용

격리 worktree `/tmp/loop-bench-a-20260927`의 seed `db06a35`에서 Pi Lead `zai/glm-5.3-flashx`로 실행했다. 첫 run은 요청→인계 8.5초, 요청→run 결과 표시 83.3초였다. 모델이 단일 task를 제출했고, focused test 6 pass와 typecheck 통과를 확인했다. Pi가 최종 메시지 뒤 원래 요청을 재검토하고 추가 작업 없음이라고 답한 것까지 같은 대화에서 관찰했다.

외부 diff 확인에서 `bun.lock` 2줄 추가·2줄 삭제가 보여 같은 Pi 대화에 변경 범위를 정정했다. Pi는 새 후속 run을 시도했으나 첫 graph 제출이 compute 범위 오류로 거부됐다. 둘째 제출로 worker를 시작해 `bun.lock`을 원복하고 테스트를 다시 통과했다. 정정 사용자 메시지→후속 run 최종 표시는 33.3초, 첫 요청→범위 정정 완료 표시는 152.1초였다. 이 값에는 첫 최종 표시 뒤 약 30초의 사람 확인 지연이 포함된다. 첫 제출 실패로 정정 run의 요청 시각은 계측 상태에서 사라져 `도구→인계 0.2초`와 `인계→결과 18.2초`만 표시됐다. 숫자를 합쳐 요청→완료 시간으로 꾸미지 않았다.

실제 개발 속도 개선율, 네 fixture의 의미적 완료율, 실행 **중** steering 반영률은 추가 비교 실행 전까지 주장하지 않는다. 최근 10개 run에서 별도 scheduler 정지 사례를 특정하지 못했으므로 같은 증상이 재현되면 event 순서와 Pi 표시 시각을 함께 기록해 구분한다.
