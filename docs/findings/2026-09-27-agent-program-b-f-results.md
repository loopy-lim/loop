# Pi Lead·Herdr agent 개선 B–F 결과

2026-09-27의 사용자 승인 설계와 [고정 fixture](../benchmarks/lead-turnaround-fixtures.md)를 기준으로 했다. 실제 Pi는 native `zai/glm-5.3-flashx`로 Herdr 안에서 실행했고, 단위·milestone 검사는 유료 모델 호출 없이 실행했다. benchmark 코드 변경은 `db06a35`에서 분기한 임시 worktree에만 있다.

| 단계 | 채택한 변경 | 실사용 확인 | 남은 경계 |
| --- | --- | --- | --- |
| B · 빠른 착수 | `loop_quick_run`이 한 작업을 generated `TaskSpecInput`으로 제출한다. 필요한 완료 검사를 각각 구조화해 받고, 기본 compute는 설정을 쓴다. 복잡한 bridge→소비자 작업은 의존 DAG로 나누도록 Lead 지침을 보강했다. | B v4: 요청→인계 18.5초, bridge 4개 검사 후 consumer 자동 시작, 2/2·attention 0. | 단일 반복이다. B v2의 한 검사 합성 명령 오류와 B v3의 선행 typecheck 교착을 수정했지만 일반적인 속도 향상률은 주장하지 않는다. |
| C · 정정 | Pi 대화의 `loop_guidance`와 CLI `loop guidance`가 접수 sequence와 worker 전달 watermark를 별도로 표시한다. 정정 접수만으로 반영 완료를 표기하지 않는다. | D v3: task 실행 중 정정 접수 sequence 10483, `GuidanceDelivered` 확인, 0초·3600초 focused 검사 7개와 typecheck 통과. | 수정 파일의 소스 해시·검사 영수증·writeScope를 하나로 묶은 반영 증명은 없다. 기존 dirty 변경이나 다른 worker 편집을 해당 worker의 결과로 추정하지 않는다. |
| D · 복구 | 소진된 실패의 `retry` 뒤 owner가 재시작하는 경로를 실사용 B v1에서 확인했다. 완료 검사 자식 프로세스에 Loop CLI의 사설 native bridge 경로가 새어 다른 checkout의 계약 검사에 실패하던 문제를 고쳤다. | B v1: 재현한 contract mismatch 수정 뒤 `retry`→worker 재시작→1/1 완료. B v4: predecessor 완료 뒤 descendant 자동 시작. 오프라인 quota·fallback 검사 통과. | 이번 반복에서 실제 429는 관측하지 못했다. 쿼터 동시성이나 모델 라우팅을 근거 없이 바꾸지 않았다. Pi의 구조화된 최종 정착 신호와 같은 worker 내 검사 실패 피드백은 별도 실험이 필요하다. |
| E · TUI·문맥 | 같은 Pi 대화에서 task 상세와 정정 단계를 조회한다. 모델·worker 목록 중복을 안정적으로 제거하고, 완료 리뷰를 짧게 쓰도록 했다. worker 탭은 완료 시 닫힌다. | C 개선: 구현 worker 2개 동시 실행, 3/3·attention 0, Loop 검증 103.0초. 완료 worker 탭 자동 정리. Pi 최종 리뷰는 간결하게 표시됐다. | 원문 출력 artifact 보존·재조회, 소스 심볼 지도, 선택한 worker 탭으로 이동하는 TUI 동작은 추가 구현·검증이 없다. |
| F · 선택 기능 | graph template, 장기 기억, checkpoint, worker 세션 재사용은 기본값으로 켜지 않았다. | B와 C 단일 실측에서 추가 worker·재사용 이득을 계산할 근거가 없다. | 동일 fixture 반복의 시간·성공률·비용과 stale context·파일 복구 안전성 영수증을 얻은 뒤 각각 판단한다. |

단계 B에서 나온 두 결함은 도구와 Lead 지침으로 고쳤다. 빠른 도구가 검사 하나만 받아 존재하지 않는 합성 명령을 등록했던 실행은 취소했다. 소비자 fixture가 수정돼야 통과하는 전체 typecheck를 선행 task에 배치해 후속 task가 시작되지 못한 실행도 취소했다. 새 DAG는 bridge 검사와 소비자 검사를 단계별로 나눴고 한 run에서 자동 완료했다. worker가 선언한 검사 외에 넓은 테스트를 반복하던 비용을 줄이도록, focused 피드백 검사와 Loop의 최종 재실행 역할도 prompt에 명시했다.

검증: 루트 작업본 `bun run check` 통과(코드 생성, 타입, 아키텍처, Rust workspace, Bun 684개). `bun run build:cli`와 오프라인 `./dist/loop verify-install --json` 통과(7 tasks, 최대 동시 3). `/Users/loopy/.local/bin/loop-pi-extension.js`는 빌드 산출물과 SHA-256이 같다. 실제 Pi/Herdr/Z.AI 검증과 오프라인 검사 결과는 서로 다른 증거로 취급한다.

현재 본 작업본에는 이 변경과 별개인 미커밋 파일이 이미 많다. benchmark 임시 worktree의 `failedCheckCount`와 timing 예제 변경은 본 작업본에 합치지 않았고, 기존 미커밋 변경을 초기화하거나 덮어쓰지 않았다.

## 2026-09-28 마무리 검증

- C: 완료 검사 묶음 전후에 선언한 read/write scope의 Git 가시 파일 내용을 해시한다. 검사 명령이 0으로 끝나도 관련 소스가 검사 도중 바뀌면 Rust bridge가 완료를 거부한다. worker 시작 전후의 변경 경로를 영수증에 남기고 Rust에서 `writeScope` 밖 경로를 계산한다. 공유 작업본의 관찰만으로 작성자를 특정하지 않는다. 기존 dirty 파일의 내용이 그대로면 새 변경으로 기록하지 않는다.
- C: `loop guidance`/Pi `loop_guidance`는 기록됨·전달됨·전달 후 검사됨을 나눈다. 마지막 단계는 전달 이후 안정된 소스의 검사 영수증과 verification pass가 이어졌다는 뜻이다. 바뀐 수용 기준 자체의 의미 검증은 검사 coverage를 살펴야 한다.
- D: Herdr의 구조화 `agent_status`를 정착 상태로 읽는 기존 경로와 출력에서 실패 원인을 분류하는 경계를 재확인했다. `429` 숫자만 남은 재시도 오류도 quota로 분류한다. 실제 429 영수증은 여전히 없어 동시성·라우팅 정책을 조정하지 않았다.
- E: Pi Lead에 요청한 상대 경로의 파일·export 심볼 이름을 최대 8줄로 보여주는 `loop_code_map`을 추가했다. 원문은 자동으로 읽지 않는다. 큰 완료 검사 출력은 기존 16,000자 redaction 경계 안에서 별도 0600 파일에 보관하며, 저장 성공 뒤에만 경로를 영수증에 기록한다. 환경변수에 실린 API key·token 값도 저장 전에 제거한다.
- F: graph template, 장기 기억, checkpoint, 세션 재사용은 기본 비활성 상태로 둔다. 동일한 고정 fixture의 반복 성공률·wall time·사용량 증거가 없으므로 채택 이득을 판단할 수 없다.

소스 증거의 범위는 작업 디렉터리가 Git 저장소 루트인 경우의 추적 파일과 무시되지 않은 새 파일이다. Git ignored 파일, 저장소 밖 의존성, 선언 범위에서 빠진 파일은 해시에 들어가지 않는다. 해당 조건이 성립하지 않으면 source 영수증을 만들지 않고 기존 명령 검사 계약을 유지한다. 큰 출력 artifact도 이미 프로세스 실행기에서 잘린 앞부분은 복구할 수 없다.

검증: 실패하는 focused 테스트에서 시작해 Rust scope·source 안정성, Rust bridge 완료 거부, Bun source 상태·artifact·code map·guidance 상태·429 분류, fake provider end-to-end를 확인했다. `bun run check` 재실행 통과(코드 생성·타입·아키텍처·Rust workspace·Bun **698 pass, 0 fail**). 첫 전체 병렬 실행의 일부 5초 제한 테스트는 시간 초과됐으나 단독 재현은 통과했고, 재실행에서는 모두 통과했다. `bun run build:cli`, `./dist/loop verify-install --json` 통과(7 tasks, 최대 동시 3, escalations 1), 설치된 `loop doctor --auth --json`에서 Rustra/Herdr/Pi 및 Pi auth ready 확인. 현재 native bridge와 Pi 확장은 설치본과 빌드 산출물의 SHA-256이 일치한다.

실제 Z.AI 경로: Pi 0.87.1의 native `zai/glm-5.3-flashx:off` 한 번의 무도구 요청에 `LOOP_NATIVE_ZAI_OK`가 반환됐다. 별도 임시 Git 저장소 `/private/tmp/loop-live-final.3BXlRu`에서 설치된 Loop Pi Lead→Herdr worker로 `hello.txt`를 만들고 run `loop-64295e6f-6025-45f2-a8a9-ac946f0a376d`가 1/1 완료, attention 0, active worker 0으로 끝났다. 파일 바이트는 `b'hello\n'`, `exact-contents` 검사는 exit 0이었다. 영수증의 검사 전후 source fingerprint는 같고, 관찰 변경 경로는 `hello.txt`, 범위 밖 관찰 경로는 빈 목록이었다. 별도 새 D steering·실제 429 fixture는 돌리지 않았으며, 이 짧은 성공 한 번을 속도 향상률로 해석하지 않는다.

## 2026-09-28 커밋 범위 검증

다른 앱·gateway·turnloop 작업을 제외한 staged tree를 임시 디렉터리로 내보내 Rust bridge에서 `bun run codegen`을 다시 실행했다. 해당 독립 작업본의 `bun run check`는 코드 생성 일치, TypeScript, 아키텍처, Rust workspace 및 Bun 425건 통과·0건 실패였다. 같은 작업본의 `bun run build:cli`와 `./dist/loop verify-install --json`도 통과했다(7 tasks, 최대 동시 3, escalations 1). 따라서 이 수치는 전체 dirty 작업본의 698건 검사와 구별된다.
