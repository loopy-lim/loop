# Pi Lead 개발 완료 시간 계측 설계

- 날짜: 2026-09-27
- 상태: 승인된 첫 구현 묶음의 설계
- 상위 순서: [agent 흡수 프로그램](../../research/2026-09-27-agent-adoption-program.md)의 A

## 문제와 목표

Pi Lead가 detached owner를 빨리 인계하는 것은 확인됐지만, 요청을 읽고 graph를 제출하는 시간과 검증된 결과를 사용자에게 돌려주는 시간은 동일 조건으로 측정되지 않았다. 현재 Rust trace는 이벤트 수와 초 단위의 경과를 제공하고, synthetic benchmark의 검사 명령은 항상 성공한다. 실제 개발 속도와 동일하게 해석할 수 없다.

이 묶음은 Pi Lead의 **요청 접수 → `loop_run` 호출 → owner 인계 확인 → 영속 terminal 관측 → 최종 결과 표시**를 개인 정보 없이 계측한다. 작은 변경의 착수 지연과 전체 완료 시간을 별도로 보여 준다. 사용자가 Pi를 종료하거나 관찰이 끊겨 일부 시각을 잃으면 해당 구간은 `미측정`이다. 이벤트에 없는 첫 파일 수정, 실제 검증 시작, 모델 토큰 수를 추정하지 않는다.

## 경계와 인터페이스

`packages/pi-loop/src/lead/timing.ts`는 시계 주입이 가능한 순수 상태 기계다. 한 Pi turn의 시작을 기록하고 `loop_run`이 실제 호출됐을 때만 그 turn을 run에 연결한다. 인계 확인 시 두 구간(`요청→도구 호출`, `도구 호출→인계`)을 고정한다. terminal snapshot과 최종 메시지 시각을 기록해 요청→결과 표시 경과를 계산한다. 같은 `runId` 중복 관측은 시각을 덮어쓰지 않는다. 다른 디렉터리 run, 단순 상태 질문, 실패한 인계는 성공한 개발 실행의 시간으로 집계하지 않는다.

Pi adapter는 `before_agent_start`에서 원문을 저장하지 않고 시각만 전달한다. `loop_run` 도구 호출과 `backend.run`의 확인된 반환, observer의 terminal snapshot, `reportFinal`의 사용자 표시를 상태 기계에 전달한다. 결과는 기존 8줄 제한 안에서 `인계 N초 · 결과 M초`처럼 한 줄로 표시한다. 어느 구간이 빠져 있으면 해당 구간 숫자를 표시하지 않는다. Pi 종료 후에도 owner는 계속 실행하며, 재연결한 Pi가 기존 시각을 복구하지 못하면 새로 시작한 구간을 과거 요청의 시간으로 주장하지 않는다.

이 첫 묶음은 Rust domain/bridge 타입을 바꾸지 않는다. 상태와 시간은 Pi 세션의 관찰 진단이며 graph의 완료 판정에 들어가지 않는다. 추후 묶음에서 영속 고해상도 event가 필요하면 Rust store→bridge→codegen 순서로 별도 설계한다. Pi/Herdr/provider 개념은 `loop-core`로 들어가지 않는다.

## 비교 과제와 보고

`docs/benchmarks/lead-turnaround-fixtures.md`에 네 과제의 입력, 결과 조건, 검사 명령, 반복 조건, 결과 표를 고정한다. 단일 국소 수정, bridge/codegen 변경, 독립 수정 2개, 실행 중 기준 변경을 모두 포함한다. 단일 worker 경로, 현 Pi Lead 경로, 이후 개선 경로를 같은 모델·설정에서 비교한다. fake 경로는 scheduler와 timestamp 계약만 확인하고 실공급자 속도 표에는 넣지 않는다. 유료 모델 호출은 테스트 명령에 넣지 않는다. 토큰/비용은 provider가 영수증을 제공할 때만 보고한다.

최초 실제 실행은 기준선으로 남긴다. 이전 버전의 동등한 과제를 재현하지 못하면 개선율을 만들지 않는다. P50/P95는 반복 수와 원시 구간을 함께 기록하고, 의미 검사가 실패한 실행은 빠른 완료로 취급하지 않는다. 429와 steer 누락은 별도 실패로 표시한다.

## 오류·검증

- `backend.run`이 인계 전에 실패하면 실패를 그대로 표시하고 성공 인계 시간은 기록하지 않는다.
- terminal 관측 전에 Pi 세션이 닫히면 owner 동작은 유지되고 최종 표시 시간은 `미측정`이다.
- 동일 snapshot sequence가 반복되어도 final 메시지와 시간 영수증은 한 번만 남긴다.
- 시계가 역행하거나 구간이 비정상적이면 숫자를 내보내지 않는다.
- 시각, run ID, 단계만 취급한다. prompt, credential, worker transcript는 계측에 저장하거나 출력하지 않는다.

의미 있는 테스트는 가짜 시계로 성공 경로, 비실행 turn, 실패한 인계, 중복 terminal, 재연결/누락 시각을 확인한다. Pi extension fake backend 테스트는 실제 사용자 표시가 8줄 안에 남고 중복 final을 만들지 않음을 확인한다. `bun run check`를 최종 회귀 검사로 실행한다. 설치본 Pi/Herdr와 Z.AI 실행 결과는 별도의 실공급자 영수증이다.
