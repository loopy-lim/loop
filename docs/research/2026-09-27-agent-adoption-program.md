# 다른 agent에서 배울 점을 Loop에 흡수하는 순서

- 날짜: 2026-09-27
- 근거: [agent 생태계 후속 조사](./2026-09-27-agent-ecosystem-followup.md), [Gajae-Code 비교](./2026-09-27-gajae-code-comparison.md), [Pi Lead 실증](../findings/pi-lead-tui-development-flow-verification.md)
- 상태: 채택 프로그램. 외부 기능을 복사하거나 속도 향상을 입증했다는 기록이 아니다.

## 판단 기준

Loop의 목표 시간은 **사용자 요청부터 변경된 요구까지 검사된 코드와 결과를 Pi Lead 대화에 돌려주기까지**다. 각 아이디어는 동일한 과제에서 이 시간을 줄이거나 완료 정확도를 높이고, Rust graph의 범위·의존성·완료 계약을 유지할 때 채택한다. 추가 worker, 모델, 계획 단계, TUI 표면은 자체 목적이 아니다. 베타 프로젝트의 문서화된 기능은 설계 후보이며 Loop에서 작동한다는 증거가 아니다.

고정 사용자 경험: Herdr 안의 Pi Lead 한 대화, 자연어 steering, 실행 중 보이는 worker 탭, worker 종료 후 탭 자동 닫기, 필요할 때 재조회 가능한 영속 결과. `/loop` 입력은 필수가 아니다. Pi-native Z.AI 인증을 사용하며 비밀정보를 기록하지 않는다.

## 독립된 구현 묶음

| 순서 | 결과물과 책임 | 흡수할 메커니즘 | 의존성·판정 |
| --- | --- | --- | --- |
| A. 계측·기준선 | Pi 요청·인계·완료 시간, 4개 고정 과제, fake/실공급자 증거 분리 | OpenHands tracing, mini-SWE-agent의 최소 루프 기준선, Gajae worker receipt | 현재 코드에서 먼저 구현. 측정되지 않은 개선율은 주장하지 않는다. |
| B. 빠른 착수 | 작은 작업의 단일 node 경로와 범위·검사 기본 입력, 필요한 파일·심볼만 제시 | OmO의 직접 실행, Aider code 모드·repo map, OpenHands 파일별 규칙 | A의 요청→worker 시작 구간을 비교. Rust bridge 입력과 generated protocol을 먼저 수정한다. |
| C. 변경 요구와 검증 | steer 접수·전달·반영 검사 분리, 소스 상태에 묶인 검사 영수증, 실제 수정 경로와 `writeScope` 대조 | Pi steering, OmO 독립 gate, Gajae 변경 해시, Claude 격리 | 병행 중인 guidance/coverage bridge 작업을 통합한 뒤 시작. 기존 dirty 파일과 동시 사용자 편집은 worker 소유로 추정하지 않는다. |
| D. 복구·쿼터 | 구조화된 Pi 종료 가능성 확인, focused check 실패의 같은 세션 수정, quota group별 동시성 실험 | Pi `agent_settled`, Aider lint/test repair, OpenHands 병렬 제한 | Herdr가 구조화된 종료를 제공하는지 먼저 확인. 429·완료시간 실측 없이 동시성 정책을 바꾸지 않는다. |
| E. 문맥·TUI | 짧은 코드 지도, 지연 로딩 규칙, worker 선택·상세 재조회, 큰 출력의 안전한 보관 | Aider repo map, OpenHands path rules, OpenCode child navigation, Gajae artifact | Pi Lead와 기존 Herdr 탭을 그대로 사용. 비밀정보 제거와 저장 성공 뒤에만 참조를 노출한다. |
| F. 선택적 운영 기능 | 반복 graph template, 검증된 기억, 정확한 checkpoint 범위, worker 비용 근거 | Goose recipe, Kage 기억, Claude checkpoint, Gajae receipt | A~E의 반복 데이터로 실익이 확인된 항목만 활성화한다. 원격 봇·독립 TUI·고정 swarm은 현재 제품 목표가 아니다. |

각 묶음은 별도 spec·plan·검증 기록을 갖는다. A는 다른 묶음의 속도 판정 기준이다. B와 E의 읽기 전용 탐색 실험은 독립적이지만 같은 파일을 쓰는 변경은 직렬화한다. C가 검증 영수증 계약을 확정한 뒤 D의 자동 수정 결과를 최종 판정한다. 정책은 `loop-core → loop-store → loop-bridge → generated protocol → orchestrator → adapters/UI` 방향을 지킨다.

## 공통 실험 계약

고정 과제는 국소 단일 수정, Rust bridge→codegen→TypeScript 변경, 서로 독립된 두 수정, 실행 중 허용 기준 변경이다. 같은 모델·설정·검사·입력으로 여러 번 실행하여 요청→인계, 인계→첫 worker, 요청→검증 완료의 P50/P95와 성공률·steer 반영률·429·worker 수·토큰/비용을 함께 보고한다. 값이 제공되지 않은 구간은 `미측정`으로 남긴다. fake provider는 스케줄러 회귀만 증명하고 실공급자 Pi/Herdr 결과와 합산하지 않는다. 동일 조건의 이전 경로가 없으면 전후 향상률을 쓰지 않는다.

채택 결과는 `채택`, `실험 계속`, `보류` 중 하나로 기록한다. 보류도 근거와 재검토 조건을 남긴다. 도구 성공, worker 성공, 검사 성공, 사용자의 새 요구 반영은 서로 다른 사실이다.

## 현재 경계

최초 계획 시점의 `bun run check`는 architecture 8개와 Bun 661개를 통과했다. 이후 A의 Pi 계측·고정 과제 계약과 첫 A/D 실사용을 [검증 기록](../findings/lead-turnaround-measurement-verification.md)에 남겼으며, 최신 전체 검사는 Bun 672개를 통과했다. 단일 worker 기준선과 B/C fixture, 반복 P50/P95가 없어 빠른 착수의 개선율은 미측정이다. 실행 중 D에서는 종속 task 등록·자동 dispatch를 확인했고, attention 해결 후 owner 재기동 누락을 찾아 Pi Lead에 수정했다. 기존 benchmark의 `process.exit(0)` 검사는 개발 과제의 완료 품질을 측정하지 않는다. Pi Lead의 단일 작업 지시, Herdr worker 탭 종료, mailbox 전달 watermark, Rust requirement/check coverage는 이미 존재한다. bridge·generated protocol·gateway·turnloop에는 병행 중인 미커밋 변경이 있어 묶음 C/D의 추가 구현 전에 해당 변경의 소유와 상태를 다시 확인한다.
