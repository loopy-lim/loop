# Pi Lead TUI 개발 흐름 검증

- 날짜: 2026-09-27
- 대상: `pi-lead-tui` 브랜치, 로컬 설치본
- 범위: 오프라인 fake provider/CLI/Pi 확장과 설치된 TUI 시작. 인증된 모델의 실제 코드 작성 시간은 포함하지 않는다.

## 고정 fixture와 관측 결과

| fixture | 확인 경계 | 결과 | 시간 증거 |
| --- | --- | --- | --- |
| 작은 국소 수정 | Pi `loop_run`이 확인된 detached 인계 뒤 반환하고 같은 세션에서 상태/조정 도구를 제공 | `lead.test.ts`의 handoff 및 자연어 도구 테스트 통과 | fake CLI handoff 테스트 약 48 ms, 단일 실행 예시 |
| Rust bridge → codegen → TypeScript | Rust의 원자적 task 추가, generated protocol을 통한 CLI 입력 | `cargo test -p loop-store`, `commands-direct`, CLI add-task, `codegen:check` 통과 | 실제 코드 수정 시간은 계측하지 않음 |
| 충돌 없는 독립 작업 | fake provider의 durable scheduling, 완료 검사, owner 분리 | 설치본 `loop verify-install --json`: `completed`, 7 tasks, 최대 동시 3, escalation 1 | 실제 개발 작업 시간은 계측하지 않음 |
| 실행 중 요구 수정 | Pi의 원문 steer, 기존 mailbox 전달, observer의 attention/재개/세션 변경 | Pi extension과 orchestrator/turnloop 테스트 통과 | 접수→worker 전달 지연은 인증된 실행에서 계측하지 않음 |

이전 Pi Lead의 동등한 작업 완료 시간 측정값은 없다. 따라서 속도 향상률이나 첫 코드 수정 시간, 토큰 절감률을 주장하지 않는다. 기존 경로는 `loop_run` 도구 호출이 최종 summary까지 대기했고, 새 경로는 owner lease 확인 직후 반환한다. 후속 입력 가능 시점이 앞당겨졌다는 구조적 차이는 fake CLI handoff 테스트로 확인했다. 실제 개발 생산성 비교에는 동일한 작업과 공급자 조건에서 요청→검증 완료 시간을 반복 측정해야 한다.

## 검증 영수증

- 현재 작업 트리의 `bun run check`: Rust workspace, generated protocol, TypeScript, architecture 8개, Bun 643개 테스트 통과. 이 작업 트리에는 Pi Lead 작업 밖의 기존 미커밋 변경도 있다.
- 앞선 Pi Lead 구현 커밋 `86c4bd6`만 별도 디렉터리에 추출한 검사: codegen, TypeScript, architecture 6개, Rust workspace 통과. Bun은 358개 통과, 1개 실패(`fallback-transition.test.ts`의 exhausted fallback이 `attention` 대신 `failed`). 직전 커밋만 추출해 같은 테스트를 실행해도 동일하게 실패했다. 별도 미커밋 transport 분류 수정이 있는 현재 작업 트리에서는 통과한다. 따라서 이 실패는 Pi Lead 변경으로 생긴 회귀가 아니다.
- `bun run build:cli`: Node 대상 Pi 확장과 CLI/native bridge 빌드 성공.
- 앞선 설치 검증에서 설치본 `loop`, `loop-pi-extension.js`, `libloop_bridge.dylib`의 SHA-256이 각 `dist` 산출물과 일치했다. 이번 위젯 변경 뒤 `loop-pi-extension.js`를 다시 빌드·설치했고 설치본과 `dist`의 SHA-256이 일치했다. 설치본은 현재 작업 트리에서 빌드했으므로 Pi Lead 작업 밖의 기존 미커밋 변경도 포함한다.
- 실제 사용자 구성 경로에 누락된 `personas/*.md`와 `defaults.toml`을 추가했다. 기존 파일을 덮어쓰지 않는 동작은 임시 구성 경로에서 두 번 설치하는 테스트로 확인했다.
- Herdr의 기존 `loop.agent` 플러그인은 활성 상태이고 저장소 플러그인을 가리킨다. worker 탭의 `--no-focus`, 작업별 라벨, worker 탭만 닫는 수명 규칙은 `packages/herdr/test/lifecycle.test.ts`에서 검증했다.
- 최종 빌드의 로컬 설치본 `loop`를 임시 Pi/Loop 구성과 `PI_OFFLINE=1`로 PTY에서 시작했다. Pi 0.87.1 TUI가 `loop-pi-extension.js`를 로드하고 오류 없이 표시되었으며, 모델 요청 없이 종료했다.
- Herdr의 임시 pane에서 설치본 `loop`를 `PI_OFFLINE=1`로 실행했다. Herdr가 해당 pane의 Pi를 `idle`로 인식했고, TUI의 확장 목록에 `loop-pi-extension.js`가 표시됐다. 생성한 pane은 Pi 종료 후 닫았다. 이는 Herdr 안의 Lead 시작 증거이며 worker 탭 생성이나 실제 steer 전달 증거는 아니다.
- 설치된 Pi 0.87.1의 확장 API에서 `setStatus`, `setWidget`, 사용자 선택 UI, 커스텀 화면과 렌더러를 확인했다. 임시 확장의 3줄 위젯과 footer 상태를 Herdr pane의 Pi에서 모델 호출 없이 표시했다. 이후 실제 Loop 확장에 2줄 진행 위젯을 연결했다. Herdr pane에서 **설치본 `loop`와 설치본 확장**이 fake Loop CLI의 활성 스냅샷을 읽어 `Working: Implement proof` 위젯과 footer 상태를 함께 표시했다. 이 검사는 모델 호출이나 실제 worker 실행을 포함하지 않는다.
- 다른 run의 명시적 상태 조회·제어가 Pi 대화에 묶인 run의 위젯과 관찰 sequence를 덮어쓰지 않는 회귀 검사를 추가했다.

## 증거의 한계

Pi Lead에서 유료 모델을 통한 실제 코드 변경, Herdr worker 탭 시각 확인, 인증된 live steer 전달 시간은 수행하지 않았다. fake provider와 설치본 TUI 시작은 이 세 항목의 실공급자 수용 증거가 아니다. 로컬 sandbox에서 기본 사용자 DB를 읽을 수 없어 첫 TUI smoke가 DB 접근 오류를 냈고, 확장이 시작을 중단하지 않도록 복구한 뒤 쓰기 가능한 임시 구성 경로에서 다시 확인했다.
