# Pi Lead 개발 완료 시간 비교 과제

- 고정 소스: `db06a35` (`pi-lead-tui`, 2026-09-27). 각 반복은 이 커밋에서 만든 별도 임시 worktree를 사용한다. 현재 작업 디렉터리의 미커밋 변경을 섞지 않는다.
- 시작: 새 Pi Lead 세션에서 아래 요청을 그대로 보낸 순간. 종료: 지정된 focused check와 필요한 전체 경계 검사를 통과한 결과가 같은 Pi 대화에 표시된 순간.
- 비교: 단일 worker, 이 커밋의 Pi Lead→Loop, 이후 개선본. 동일 Pi/Z.AI 모델·설정·머신에서 순서를 교차해 반복한다. 성공/실패를 모두 남기고, 성공 실행만의 평균으로 실패를 숨기지 않는다.
- 각 작업 전 별도 worktree와 별도 Loop/Pi 세션을 사용한다. worktree 안에서 `bun install --frozen-lockfile`을 실행하고 `bun run typecheck`가 통과하며 `bun.lock`이 변경되지 않았음을 확인한 뒤 요청을 보낸다. 루트 `node_modules`를 다른 checkout에서 심볼릭 링크하지 않는다. 기준선과 개선본의 소스가 달라지면 같은 fixture가 아니므로 새 버전으로 기록한다.

| ID | 고정 요청과 시작 상태 | 필수 검사와 완료 조건 |
| --- | --- | --- |
| A · 국소 수정 | `packages/pi-loop/src/lead/timing.ts`의 초 단위 표시는 60초 이상도 소수 한 자리의 총 초로 쓴다. “60초 이상은 `M분 S.s초`로 읽기 좋게 표시하고, 60초 미만의 표시와 누락값 처리는 유지해 주세요.” | `packages/pi-loop/test/timing.test.ts`에 59.9초/60초/61.2초/누락값 사례를 추가하고 `bun test packages/pi-loop/test/timing.test.ts`, `bun run typecheck`. 변경은 timing 모듈과 해당 테스트에 한정한다. |
| B · Rust bridge/codegen | `crates/loop-bridge/src/execution.rs`의 `TaskContextOutput.previous_checks`에는 실패와 timeout 영수증이 있다. “TaskContextOutput에 `failedCheckCount`를 추가해 이전 검사 중 nonzero exit 또는 timeout 수를 반환하고 생성 프로토콜까지 연결해 주세요.” | Rust bridge 타입과 계산을 먼저 바꾸고 `bun run codegen`으로 생성 파일을 갱신한다. 실패·timeout·성공 혼합 영수증 Rust 테스트를 추가한다. v2 완료 계약: `cargo test -p loop-bridge`, `cargo build -p loop-bridge`, `bun run codegen:check`, `bun test packages/protocol/test/generated-runtime.test.ts`, `bun run typecheck`, `bun run test:architecture` 통과. 수작업 TS 타입은 금지한다. |
| C · 독립 수정 2개 | `packages/pi-loop/src/ui/models.ts`와 `packages/pi-loop/src/ui/worker.ts`는 별도 출력 모듈이다. “모델 목록에서 같은 항목 중복을 한 번만 보여 주고, worker 목록에서도 같은 worker id 중복을 한 번만 보여 주세요. 각 출력의 기존 순서는 유지해 주세요.” | 두 모듈은 서로 다른 worker가 소유하고 각각 새 focused test 파일을 소유한다. 합류 뒤 `bun test packages/pi-loop/test`, `bun run typecheck`를 통과하며 두 중복 사례가 검사에 포함된다. `worker.ts`의 실제 입력 타입과 식별자를 먼저 확인한다. |
| D · 실행 중 기준 변경 | A와 같은 시작 커밋의 별도 worktree에서 “60초 이상을 `M분 S.s초`로 표시해 주세요.”를 보낸다. worker가 첫 수정 활동을 보고한 뒤, 최종 검사 전에 “정정: 1시간 이상은 `H시간 M분 S.s초`로 표시하고 0값도 검사해 주세요.”를 같은 Pi Lead 대화에 보낸다. | steering 접수→worker 전달→worker 확인→변경된 기준 반영을 별도로 기록한다. 59.9초/60초/3600초/0값 테스트와 `bun test packages/pi-loop/test/timing.test.ts`, `bun run typecheck` 통과. 수정 지시가 terminal 이후에 도착하면 새 종속 작업 또는 후속 run으로 완료하고, 해당 반복은 ‘실행 중 steer’ 성공으로 세지 않는다. |

## 실행 기록 양식

각 반복에 `fixture ID`, seed SHA, 경로(단일 worker/현 Pi Lead/개선본), Pi·Herdr 버전, 실제 provider/model, 반복 번호, task 수, 요청→인계, 요청→검사된 결과, 429 횟수, steer 단계별 상태, focused check 결과, 전체 경계 검사 결과, token/비용(영수증이 있을 때만), 실패 원인을 남긴다. 시각이나 사용량을 얻지 못했으면 `미측정`으로 적는다. P50/P95에는 원시 시간과 성공·실패 반복 수를 함께 적는다.

| Fixture | 경로 | 반복 | 요청→인계 | 요청→검사된 결과 | 검사 | 429 | steer 반영 | token/비용 |
| --- | --- | ---: | --- | --- | --- | ---: | --- | --- |
| A | Pi Lead (`glm-5.3-flashx`) | 1 + 범위 정정 후속 run | 8.5초 | 최초 83.3초; 범위 정정 완료 152.1초(사용자 확인 지연 약 30초 포함) | focused 6 pass, typecheck 통과 | 관측 0 | terminal 후 새 run | 미측정 |
| B v1 | Pi Lead (`glm-5.3-flashx`) | 1 + 복구·후속 run | 20.2초 | 첫 graph 894.6초(환경 복구 포함); 원래 목표의 typecheck 완료는 후속 run 종료 시각으로 별도 기록 | 첫 graph 4개 검사 pass; 외부 `bun run typecheck` fail → 후속 run | 관측 0 | 해당 없음 | 미측정 |
| B v2 | 빠른 단일 task(첫 도구 형식) | 1, 취소 | 8.1초 | 취소까지 346.4초 | 잘못 등록된 `bash run check-bridge-failed-count`가 exit 127; 기계 검증 실패 | 관측 0 | 해당 없음 | 미측정 |
| B v3 | 빠른 단일 task(검사 배열) + 같은 checkout의 후속 run | 1 + 취소·후속 run | 최초 24.9초; 후속 9.1초 | 선행 graph 취소까지 251.0초; 후속 run 58.3초 | 선행은 fixture 7곳의 typecheck 오류로 취소; 후속 6개 검사 통과, 외부 typecheck 통과 | 관측 0 | 실행 중 정정은 graph 구조 오류를 발견; 새 run으로 이어감 | 미측정 |
| B v4 | bridge→fixture 2-task DAG (`glm-5.3-flashx`) | 1 | 18.5초 | Pi 최종 검토 응답까지 250.9초(Loop 검증 시각 별도 미측정) | 2/2; bridge 검사 4개, consumer 검사 2개 통과; 외부 typecheck·diff check 통과 | 관측 0 | 해당 없음 | 미측정 |
| C 기준 | 이전 Pi Lead (`glm-5.3-flashx`) | 1 | 19.8초 | Pi 최종 검토 응답까지 120.3초(Loop 검증 시각 별도 미측정) | 3/3; focused·합류 테스트와 typecheck 통과 | 관측 0 | 해당 없음 | 미측정 |
| C 개선 | 범위 지침 수정 Pi Lead (`glm-5.3-flashx`) | 1 | 19.7초 | Loop 검증 103.0초; Pi 최종 검토 응답까지 114.4초 | 3/3; focused·합류 테스트와 typecheck 통과 | 관측 0 | 해당 없음 | 미측정 |
| D | Pi Lead (`glm-5.3-flashx`) | 1, 환경 오류로 비교 제외 | 8.1초 | 546.2초(환경 복구·수동 resume 포함) | 최종 2/2 task, focused 6 pass, typecheck 통과 | 관측 0 | 실행 중 종속 task 등록 후 완료 | 미측정 |
| D v2 | Pi Lead (`glm-5.3-flashx`) | 1 + terminal 뒤 새 run | 7.8초; 후속 16.4초 | 비교 제외 | 후속 1/1, focused 6 pass·typecheck 통과 | 관측 0 | 원 task 완료 후 도착한 정정을 새 run으로 반영 | 미측정 |
| D v3 | Pi Lead (`glm-5.3-flashx`) | 1 | 5.3초 | 미측정 | 1/1, focused 7 pass·typecheck 통과, 외부 재실행 동일 | 관측 0 | 실행 중 `GuidanceAdded` 10483 → `GuidanceDelivered`, 0초·3600초 테스트 반영 | 미측정 |

오프라인 fake 테스트는 이벤트 순서와 시간 누락 계약만 입증한다. 실제 개발 속도, Herdr 표시, Z.AI quota, 사용자 지시의 의미적 반영은 위 반복 기록으로만 판정한다.

첫 A 반복은 60초 표시 수정과 검사는 통과했으나 worker의 의존성 정리로 `bun.lock`도 바뀌었다. 같은 Pi 대화에 범위 정정을 요청해 후속 run에서 잠금 파일을 복원하고 검사를 재실행했다. 위 152.1초에는 최초 사용자 메시지(12:36:51.204Z)부터 후속 run 최종 표시(12:39:23.342Z)까지, **첫 최종 표시 뒤 약 30초의 사람 확인 시간**이 포함된다. 단일 worker 기준선과 반복 측정이 없으므로 속도 향상률은 계산하지 않는다.

첫 D 반복은 worker 실행 중 정정이 기존 task에 의존하는 `hour-format`으로 등록됐다. 그러나 시험 harness가 루트 `node_modules`를 다른 checkout으로 연결해 타입 검사가 실패했고, 3회 시도 뒤 attention에 들어갔다. 격리 worktree에 의존성을 정상 설치한 후 `retry`를 답했을 때 상태만 active/ready로 바뀌고 owner가 재시작하지 않았다. 별도 `resume`으로 owner를 재기동하자 첫 task 완료 직후 `hour-format`이 자동 실행되어 최종 2/2가 검증됐다. 546.2초에는 이 환경 복구와 사람 입력 대기가 포함되므로 개발 속도 비교에서는 제외한다.

B v1의 첫 실사용은 요청→인계 20.2초, 첫 graph 최종 894.6초였다. 생성된 필드와 Rust 계산/혼합 영수증 테스트는 맞았고 선언한 네 검사는 최종 pass했다. 다만 Loop가 자체 native library 경로를 완료 검사 프로세스에 물려줘 다른 worktree의 generated-runtime-test가 계약 해시 불일치로 반복 실패했다. 외부 재현 뒤 실행기 환경 전달을 수정하고 Pi Lead의 `retry`→owner 재시작→1/1 완료를 확인했다. 완료 뒤 외부 `bun run typecheck`가 누락된 TypeScript fixture 7곳을 찾아, 원래 목표는 후속 run으로 이어졌다. 이 반복은 환경 복구와 불완전한 v1 완료 계약 때문에 속도 비교에서 제외한다. v2는 native build와 TypeScript typecheck를 완료 계약에 추가한다.

B v1 후속 run은 누락된 fixture 7곳을 수정해 typecheck를 통과했다(요청→인계 7.1초, 후속 run 검증 63.4초). C 기준에서는 두 구현 task의 읽기 범위에 서로의 쓰기 파일이 들어가 Rust scheduler가 정당하게 직렬화했다. 개선본은 같은 설정의 새 세션에서 각 구현 task의 읽기 범위를 자기 파일로 좁혀 두 worker가 동시에 실행됐다. `max_frontier_workers`는 두 task 모두 `fast`였으므로 병목 원인이 아니었다. 단일 반복의 최종 응답 시간 차이 5.9초를 일반적인 속도 향상률로 해석하지 않는다.

B v2는 초기 `loop_quick_run` 도구가 검사 하나만 받는 형태라 Lead가 존재하지 않는 합성 명령을 등록했고, exit 127을 확인한 뒤 취소했다. 도구를 개별 검사 배열로 고쳤다. B v3에서는 여섯 검사가 등록됐지만 첫 task의 전체 typecheck가 후속 fixture 작업의 선행 조건이 되어 그 후속 작업을 시작할 수 없었다. 이를 취소하고 같은 checkout에서 정확히 일곱 fixture 파일만 소유하는 새 run으로 전체 검사 여섯 개를 통과했다. 따라서 이 두 반복은 한 번의 완결된 B 실행이나 속도 개선 증거가 아니다.

D v3는 원 task가 `running`일 때 정정을 `loop_steer`로 기록했고, 이후 worker 전달 watermark가 접수 sequence 10483을 포함하는 것을 `loop_guidance`로 확인했다. 이 worktree에서 0초·3600초·3661.5초의 기대값이 포함된 focused 테스트 7개와 typecheck를 별도 재실행해 통과했다. 전달 영수증과 코드 반영 검사는 구분한다. 소스 해시와 completion check의 원자적 결합 영수증은 아직 없다.

B v4에서는 첫 task가 Rust bridge와 생성 프로토콜을 수정하고 네 검사를 통과해 `1/2`가 된 직후, 의존한 consumer task의 Herdr worker 탭이 자동 시작됐다. 이어 정확히 지정한 fixture 7곳을 수정하고 typecheck·architecture 검사까지 통과해 `2/2`, attention 0으로 끝났다. `failedCheckCount` 구현 자체는 속도 측정용 임시 worktree의 변경이며 이 저장소 본 작업 트리에 합치지 않는다. 250.9초는 Pi 대화의 마지막 리뷰까지 포함하고, 1회 실행이므로 B의 일반적인 완료 시간을 뜻하지 않는다.
