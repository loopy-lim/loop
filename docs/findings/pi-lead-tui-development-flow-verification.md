# Pi Lead TUI 개발 흐름 검증

- 날짜: 2026-09-27
- 대상: `pi-lead-tui` 브랜치, 로컬 설치본
- 범위: 오프라인 fake provider/CLI/Pi 확장, 설치본 TUI, Z.AI 인증 실행과 Herdr 탭 실측. 실공급자 예시는 별도의 임시 프로젝트에서 실행했다.

## 고정 fixture와 관측 결과

| fixture | 확인 경계 | 결과 | 시간 증거 |
| --- | --- | --- | --- |
| 작은 국소 수정 | Pi `loop_run`이 확인된 detached 인계 뒤 반환하고 같은 세션에서 상태/조정 도구를 제공 | `lead.test.ts`의 handoff 및 자연어 도구 테스트 통과 | fake CLI handoff 테스트 약 48 ms, 단일 실행 예시 |
| Rust bridge → codegen → TypeScript | Rust의 원자적 task 추가, generated protocol을 통한 CLI 입력 | `cargo test -p loop-store`, `commands-direct`, CLI add-task, `codegen:check` 통과 | 실제 코드 수정 시간은 계측하지 않음 |
| 충돌 없는 독립 작업 | fake provider의 durable scheduling, 완료 검사, owner 분리 | 설치본 `loop verify-install --json`: `completed`, 7 tasks, 최대 동시 3, escalation 1 | 실제 개발 작업 시간은 계측하지 않음 |
| 실행 중 요구 수정 | Pi의 원문 steer, 기존 mailbox 전달, observer의 attention/재개/세션 변경 | Pi extension과 orchestrator/turnloop 테스트 통과 | 접수→worker 전달 지연은 인증된 실행에서 계측하지 않음 |

이전 Pi Lead의 동등한 작업 완료 시간 측정값은 없다. 따라서 속도 향상률이나 첫 코드 수정 시간, 토큰 절감률을 주장하지 않는다. 기존 경로는 `loop_run` 도구 호출이 최종 summary까지 대기했고, 새 경로는 owner lease 확인 직후 반환한다. 후속 입력 가능 시점이 앞당겨졌다는 구조적 차이는 fake CLI handoff 테스트로 확인했다. 실제 개발 생산성 비교에는 동일한 작업과 공급자 조건에서 요청→검증 완료 시간을 반복 측정해야 한다.

## 검증 영수증

- 최종 작업 트리의 `bun run check`: Rust workspace, generated protocol, TypeScript, architecture 8개, Bun 651개 테스트 통과. 이 작업 트리에는 Pi Lead 작업 밖의 기존 미커밋 변경도 있다.
- 앞선 Pi Lead 구현 커밋 `86c4bd6`만 별도 디렉터리에 추출한 검사: codegen, TypeScript, architecture 6개, Rust workspace 통과. Bun은 358개 통과, 1개 실패(`fallback-transition.test.ts`의 exhausted fallback이 `attention` 대신 `failed`). 직전 커밋만 추출해 같은 테스트를 실행해도 동일하게 실패했다. 별도 미커밋 transport 분류 수정이 있는 현재 작업 트리에서는 통과한다. 따라서 이 실패는 Pi Lead 변경으로 생긴 회귀가 아니다.
- 최종 `bun run build:cli`: Node 대상 Pi 확장과 CLI/native bridge 빌드 성공. `dist/loop verify-install --json`은 fake provider에서 `completed`, 7 tasks, 최대 동시 3, escalation 1을 반환했다.
- 설치본 `loop`는 `dist/loop`를 가리키는 symlink이고, 최종 `loop-pi-extension.js`와 `libloop_bridge.dylib`는 설치본과 `dist` 산출물의 바이트 및 SHA-256이 일치했다. 설치본은 현재 작업 트리에서 빌드했으므로 Pi Lead 작업 밖의 기존 미커밋 변경도 포함한다.
- 실제 사용자 구성 경로에 누락된 `personas/*.md`와 `defaults.toml`을 추가했다. 기존 파일을 덮어쓰지 않는 동작은 임시 구성 경로에서 두 번 설치하는 테스트로 확인했다.
- Herdr의 기존 `loop.agent` 플러그인은 활성 상태이고 저장소 플러그인을 가리킨다. worker 탭의 `--no-focus`, 작업별 라벨, worker 탭만 닫는 수명 규칙은 `packages/herdr/test/lifecycle.test.ts`에서 검증했다.
- 최종 빌드의 로컬 설치본 `loop`를 임시 Pi/Loop 구성과 `PI_OFFLINE=1`로 PTY에서 시작했다. Pi 0.87.1 TUI가 `loop-pi-extension.js`를 로드하고 오류 없이 표시되었으며, 모델 요청 없이 종료했다.
- Herdr의 임시 pane에서 설치본 `loop`를 `PI_OFFLINE=1`로 실행했다. Herdr가 해당 pane의 Pi를 `idle`로 인식했고, TUI의 확장 목록에 `loop-pi-extension.js`가 표시됐다. 생성한 pane은 Pi 종료 후 닫았다. 이는 Herdr 안의 Lead 시작 증거이며 worker 탭 생성이나 실제 steer 전달 증거는 아니다.
- 설치된 Pi 0.87.1의 확장 API에서 `setStatus`, `setWidget`, 사용자 선택 UI, 커스텀 화면과 렌더러를 확인했다. 임시 확장의 3줄 위젯과 footer 상태를 Herdr pane의 Pi에서 모델 호출 없이 표시했다. 이후 실제 Loop 확장에 2줄 진행 위젯을 연결했다. Herdr pane에서 **설치본 `loop`와 설치본 확장**이 fake Loop CLI의 활성 스냅샷을 읽어 `Working: Implement proof` 위젯과 footer 상태를 함께 표시했다. 이 검사는 모델 호출이나 실제 worker 실행을 포함하지 않는다.
- 다른 run의 명시적 상태 조회·제어가 Pi 대화에 묶인 run의 위젯과 관찰 sequence를 덮어쓰지 않는 회귀 검사를 추가했다.

## 실제 Pi/Herdr 실행

- `/Users/loopy/.zshenv`에 `ZAI_API_KEY` 변수는 없다. Pi의 네이티브 인증 저장소는 `zai/glm-5.3-flash`를 `ready`로 판정했고, 별도 정확 응답 호출에서 `ZAI_READY`를 받았다. 사용자 구성의 별도 `[providers.zai]` API 경로는 `ZAI_API_KEY` 부재로 `doctor --auth`가 실패한다. 임시 구성에서는 이 API 경로만 끄고 Pi 경로를 사용했다. 비밀 값은 읽거나 기록하지 않았다.
- 첫 임시 프로젝트 실행은 40초에 완료됐다. 구현이 완료된 뒤 같은 Lead 대화에 넣은 변경 지시는 후속 검증 worker로 전달됐고, 읽기 전용 검증 worker가 파일을 썼다. 이후 Pi 검증 worker의 쓰기 도구 제한과 완료 작업에 대한 steer 거부를 추가했다.
- 두 번째 임시 실행은 68초에 `completed`가 됐지만, 읽기 전용 검증 worker가 `VERDICT: FAIL`로 보고한 허용 기준이 실행 검사에 없었다. 완료된 run 상태와 목표 충족은 서로 달랐다. Pi 완료 메시지는 이 FAIL을 검토 필요로 표시하도록 바꿨다. 후속 실행은 57초에 완료됐지만 원래 실패 기준을 충족한다고 증명하지 못했다.
- 세 번째 임시 실행에서 worker 탭 `implement-slugify·impl·a0`은 같은 Herdr workspace에 열렸다가 16초 뒤 작업 완료와 함께 닫혔다. Pi Lead가 `sleep 20`을 호출하는 동안 보낸 자연어 수정 요청은 worker 종료 뒤에 처리됐다. 폴링하지 않고 Lead turn을 끝내도록 지시하고, `panes` 모드의 성공한 대화형 worker 탭을 검토할 때까지 남기도록 바꿨다.
- 네 번째 임시 실행에서 Pi 위젯은 `Herdr tabs: implement-normalize-tags`를 보였고, Herdr에서 worker 탭을 직접 선택했다. run 시작 후 7초에 `guidance_added`와 `guidance_delivered`가 기록됐으며 17초에 run이 완료됐다. **그러나 독립 소스/테스트 확인에서 steer로 추가한 `#` 규칙은 반영되지 않았다.** 전달 이벤트는 처리·구현 증거가 아니다. Lead가 새 허용 기준에는 실행 검사가 있는 의존 작업 또는 후속 실행을 만들도록 지시를 강화했다.
- 다섯 번째 임시 실행에서는 추가 요구가 최초 `loop_run` 전에 도착해 처음부터 작업 계약과 검사에 포함됐다. `#` 규칙의 코드와 테스트가 존재하며 독립 `bun test` 6개가 통과했다. 이는 실행 중 worker의 steer 처리 증거는 아니다.
- 여섯 번째 임시 실행의 최초 작업은 20초에 완료됐고, 실행 중 입력한 새 대소문자 기준은 Lead가 terminal 상태를 확인한 후 별도 실행으로 이어졌다. 같은 task ID의 검토 탭이 둘 이상 남자 식별이 어려워져, 새 탭 이름과 위젯에 run 식별자를 추가했다. 후속 worker는 Z.AI `429 Rate limit` 재시도 중 Herdr가 잠시 idle로 판정한 화면을 성공 결과로 잘못 읽었고, 코드 변경 없이 집중 검사 실패로 run이 종료됐다. 재시도 화면에서는 완료 판정을 보류하고 재시도 소진 오류를 quota 실패로 분류하는 회귀 검사를 추가했다. 이 마지막 수정의 인증된 재실행은 공급자 한도 때문에 수행하지 않았다.

## 네이티브 Pi 재실행과 worker 탭 수명

- 사용자 요청에 따라 성공한 worker 탭을 남기는 옵션을 제거했다. `HerdrAgentProvider.release()`는 결과와 관계없이 해당 worker 탭을 닫는다. Lead 탭은 닫지 않는다. 실행 중의 탭 이름과 Pi 위젯에는 같은 짧은 run 식별자가 남는다. fake Herdr runner로 성공·quota 실패 시 닫기와 Lead 탭 보존을 확인했다.
- 설치된 Pi 0.87.1의 `pi auth check --provider zai --model glm-5.3-flashx --json --no-refresh`는 `ready`였고, Pi 네이티브 인증의 정확 응답 `ZAI_READY`는 1.93초, exit 0이었다. 이 호출은 429를 재현하지 않았다. 사용자 `providers.toml`의 별도 `[providers.zai]` HTTP API 경로를 비활성화하고, `models.toml`의 모호한 bare worker 모델을 `zai/glm-5.3-flashx:medium`으로 지정했다. 이후 설치본 `loop doctor --auth --json`은 exit 0이었다. 키 값은 읽거나 기록하지 않았다.
- 임시 프로젝트 `/private/tmp/loop-speed-njwv433e/project`에서 실패하는 `bun test`를 먼저 확인하고, 설치본 Loop CLI와 새로 빌드한 Pi 확장으로 한 worker 실행을 시작했다. Lead와 worker 화면은 각각 `(zai) glm-5.3-flashx`를 표시했다. Herdr에 `fix-normalize-lab·impl·a0·63b55b` worker 탭이 나타났다가 작업 종료 후 자동으로 사라졌고, Lead 탭 `Loop-speed-native-zai`는 유지됐다. run `loop-63b55b2d-7d96-4a9c-b84f-9f5fdced7c3b`는 `completed`, 검증 1/1, 독립 재실행 `bun test` 1 pass였다.
- 이 한 작업의 시각은 요청 제출 11:15:00.7 UTC, 영속 `run_created`/`worker_started` 11:15:08, `worker_finished`/`check_receipts_recorded`/`run_completed` 11:15:21이다. 초 단위 영속 이벤트 기준으로 요청→worker 약 7초, worker→검증 완료 약 13초, 전체 약 20초다. completion check 자체는 9ms였다. 이전 버전의 동일 작업·모델 기준선은 없으므로 속도 향상률은 계산하지 않는다.
- 이번 작업의 Herdr·provider·Pi Lead·orchestrator 집중 Bun 테스트 368개가 통과했다. 처음 `bun run check`는 동시에 진행 중인 별도 gateway 작업의 타입 오류에서 멈췄지만, 해당 작업이 정리된 뒤 재실행한 전체 `bun run check`는 Rust workspace, 코드 생성, TypeScript, architecture 8개, Bun 661개 모두 통과했다. 이 전체 검사는 병행 미커밋 변경을 포함한 현재 작업 트리에서 실행했으며, 이 커밋만의 별도 checkout 검사는 수행하지 않았다. `bun run build:cli`, 설치본 `loop verify-install --json`(7 tasks, 최대 동시 3, escalation 1)도 통과했고 설치본 Pi 확장과 새 빌드 산출물의 SHA-256이 일치한다.

## 남은 증거의 한계

인증된 실측은 한 환경의 소수 작업이다. 이전 버전과 동일 조건의 완료 시간 비교가 없어 개발 속도 향상률을 주장하지 않는다. `guidance_delivered`는 Herdr 입력 접수 증거이며, worker의 요구 반영 증거가 아니다. 새 허용 기준에 대한 독립 검사 없이 기존 run의 `completed` 상태만으로 목표 완료를 주장할 수 없다. 로컬 sandbox에서 기본 사용자 DB를 읽을 수 없어 첫 TUI smoke가 DB 접근 오류를 냈고, 확장이 시작을 중단하지 않도록 복구한 뒤 쓰기 가능한 임시 구성 경로에서 다시 확인했다.
