# DP — loop-mobile 세션 중심 IA 제안 (2026-10-07 승인 방향)

## 배경과 결정

현재 홈 `SubmitScreen.tsx:44-56,89-115`는 프롬프트 카드에서 `submitPrompt`로 run을 생성하고, 같은 화면의 `SubmitScreen.tsx:124-134` FAB는 `spawnTuiSession`으로 별도 TUI 세션을 연다(`spawn-fab.tsx:66-107`). 결과적으로 사용자에게 두 개의 시작 버튼이 보인다. `run-list.tsx:201-208,233-274`는 run 행을 우선 만들고 연관된 세션을 run에 붙이며, run 없는 세션만 별도 행으로 표시한다. `sessionsView.ts:11-25`가 이 분리를 명시한다. `App.tsx:241-245,390-454`도 runId 진입과 sessionId 진입을 병행한다. 게이트웨이의 생성 계약은 서로 다르다: `server.ts:906-966`의 POST /v1/runs와 `server.ts:829-835`·`spawn.ts:3-28`의 POST /v1/sessions/spawn은 동일 작업이 아니다. 후자의 응답은 세션 ID가 아닌 런처 target이므로 목록 발견을 기다린다(`spawn-fab.tsx:69-107`).

**결정:** 앱의 1급 탐색 단위는 관측된 loop 세션의 sessionId. 홈은 열려 있는 세션 목록, `+`는 새 loop 세션을 여는 유일한 홈 생성 입구. run은 세션에 연결된 실행/검증 상태의 보조 정보로 유지한다. 원격 프롬프트 제출은 홈 생성 카드가 아닌 명시적인 보조 동작으로 옮긴다. 기존 run API와 영속 기록은 삭제하지 않는다. 세션과 run은 동의어가 아니며 run 없는 세션도 정식 행이다. 세션 없는 run은 숨기거나 가짜 세션으로 포장하지 않고 별도 ‘연결 대기/실행 기록’ 표면에서 정직하게 보여준다.

대안: (A) 기존 run 홈에 세션 필터만 추가하면 변경 비용은 작지만 두 생성 경로와 run 우선 행 모델이 남는다. (B) **권장:** 홈/탐색을 세션 우선으로 재배치하고 게이트웨이 계약은 보존한다. 진입과 생성의 의미를 바로잡되 마이그레이션을 분리할 수 있다. (C) run API까지 세션으로 통합하면 클라이언트가 단순해 보이지만 run의 독립적인 내구 상태와 terminal/tap 수명 차이를 파괴한다. B를 채택한다.

## 목표 IA 및 경계

| 표면 | 이전 | 이후 |
| --- | --- | --- |
| 연결 후 홈 | 프롬프트 카드 + run 우선 Chats 목록 + spawn FAB (`SubmitScreen.tsx:80-134`) | live 세션 목록만 기본 표시; sessionId로 한 행/한 진입. `+`는 새 세션 열기. 종료 세션과 세션 없는 run은 보조 ‘전체/기록’에서 확인 |
| `+` | 홈 프롬프트 제출과 TUI spawn이 병존 | POST /v1/sessions/spawn만 호출; 발견 전 대기/실패 상태 유지, 발견 시 해당 세션 열기. 실패 시 run 생성으로 자동 폴백하지 않음 |
| 세션 상세 | runId 또는 sessionId로 대화 진입 (`ConversationScreen.tsx:104-107,217-253`) | sessionId가 탐색 키. 대화/상태·질문·응답/터미널 미러/보조 run 상세를 한 세션 컨텍스트에서 전환 |
| 터미널 | Files/run 트리를 통한 별도 pane (`PaneScreen.tsx:25-35`; `App.tsx:390-422`) | 세션 상세의 ‘터미널’ 보조 보기; paneId 연관이 증명된 경우만 연결, 무관한 pane은 임의 매칭하지 않음 |
| run·원격 프롬프트 | 홈 제출 → 새 run 대화 (`SubmitScreen.tsx:52-79`) | 세션 상세의 ‘새 실행/원격 제출’ 명시적 보조 메뉴 또는 별도 실행 기록. POST /v1/runs가 새 세션을 보장하지 않음을 전송 전 알림; 성공하면 runId 기록으로 이동하고 세션 관측 후 연결. 홈 `+`와 혼동 금지 |
| attention | run 상세 `RunScreen.tsx:222-270`에서만 응답 | 연관 세션의 대화 상단 질문 카드 → 답변 → `resolveAttention(runId, attentionId, resolution)` → 동일 세션에 결과 표시; 일반 send/steer와 분리. 세션 미연결 run은 실행 기록의 run 상세에서 기존 응답 유지 |

세션 목록 읽기는 게이트웨이 sessions inventory, 실행 상태는 runs inventory, 터미널은 panes inventory를 사용한다(`server.ts:364-407,540-573,966-995`). 모바일의 순수 view fold에서 sessionId 기준으로 연결하고 runId는 선택적 메타데이터로 둔다. 화면은 네트워크/정책 소유자가 아니다. 게이트웨이의 HTTP 계약과 Rust 소유 run 상태를 UI 명칭 때문에 변경하지 않는다. 세션 입력 `server.ts:774-826`과 run steer `server.ts:671-706` 및 attention resolve `server.ts:710-741`는 서로 다른 배송 경로다. 실행 중 연결된 run의 steer는 기존 경로를 사용하고, runId가 없으면 steer라고 표시하지 않고 세션 input만 사용한다. attention 응답은 composer send가 아니라 질문 ID가 있는 전용 action으로 보낸다. `ConversationScreen.tsx:327-357,540-545`의 현재 steerMode가 runId에 의존하는 점을 유지/검증한다.

## 단계별 마이그레이션 계획

### P0 — 목록·유일 생성 진입
- 파일: `apps/loop-mobile/src/screens/SubmitScreen.tsx`, `features/run-list.tsx`, `features/spawn-fab.tsx`, `state/sessionsView.ts`, `state/activeView.ts`, `state/session-groups.ts`, `App.tsx`, `ui/copy.ts`; 테스트 `test/session-focus.test.ts`, `test/session-groups.test.ts`, `test/session-spawn.test.ts`, `test/showcase-config.test.ts`.
- sessionId 중복 제거·live 우선 목록 fold를 먼저 테스트. run 없는 live 세션과 연결된 run이 있는 live 세션이 각각 한 행인지, run만 존재할 때 거짓 세션이 생기지 않는지 검증. 홈 프롬프트 카드를 제거하고 보조 실행 진입으로 옮길 때 기존 POST /v1/runs 호출 자체는 보존. `+` 비활성/404/발견 대기/목록 조회 실패는 실패를 명시하고 재시도 가능하게 한다. 이름은 관측 근거만 사용.
- 검증: `bun test apps/loop-mobile/test/session-focus.test.ts apps/loop-mobile/test/session-groups.test.ts apps/loop-mobile/test/session-spawn.test.ts apps/loop-mobile/test/showcase-config.test.ts`; 홈 화면 수동 확인(0개/여러 개/live+ended/상관없는 run/spawn 차단).

### P1 — 세션 상세 통합·attention 응답
- 파일: `apps/loop-mobile/src/screens/ConversationScreen.tsx`, `screens/RunScreen.tsx`, `screens/RunSplitScreen.tsx`, `screens/PaneScreen.tsx`, `state/runProjection.ts`, `state/paneProjection.ts`, `state/composer.ts`, `features/composer.tsx`, `gateway-client/client.ts`, `App.tsx`, `ui/copy.ts`; 테스트 `test/conversation-contract.test.ts`, `test/run-projection.test.ts`, `test/pane-contract.test.ts`, `test/contract-client.test.ts`, `test/composer-retry.test.ts`.
- 세션 상세 진입 시 runId가 검증된 연결인 경우에만 해당 run 상태/attention을 구독. 질문 카드가 message와 attentionId를 표시하고 빈 답변 금지, 중복 전송 방지, 오류 시 초안 유지, 성공 후 재구독으로 해소 확인; 응답을 세션 input으로 잘못 전송하지 않는다. 터미널 뷰는 증명된 pane 연결만 열고 snapshot은 transcript로 표현하지 않는다. run 없는 세션은 입력과 터미널만 제공하며 질문 카드가 없다.
- 검증: 위 focused tests + `bun test apps/loop-mobile/test/conversation-waiting.test.ts`; attention 행→세션→질문→답변 동선과 중복 탭/연결 끊김/미연결 run fallback 수동 확인. React 변경 뒤 react-doctor 및 `bun run check`.

### P2 — 보조 표면·어휘/증거 정리
- 파일: `apps/loop-mobile/src/screens/SubmitScreen.tsx`, `screens/RunScreen.tsx`, `screens/RunSplitScreen.tsx`, `screens/ConversationScreen.tsx`, `features/run-list.tsx`, `features/session-title.ts`, `ui/copy.ts`, `src/showcase.ts`, `App.tsx`; 테스트 `test/design-spec.test.ts`, `test/showcase-config.test.ts`, `test/split-viewer-contract.test.ts`; 문서 `docs/design/audits/mobile-usability-findings-v9.md`, `docs/design/audits/mobile-design-audit-v9.md` 및 showcase evidence/captures (후속 작업에서만 변경).
- Files/run 상세를 세션 상세의 보조 실행·파일 보기 또는 실행 기록 진입으로 정리한다. 문구는 ‘세션 열기’와 ‘실행 제출’을 구별한다. v9 감사의 ‘New task’ 승인 카피는 이전 spawn 문맥의 판단이므로 새 세션 IA와 충돌한다: 제품 카피 재승인을 받은 뒤 변경하고, 미승인 시 임의로 바꾸지 않는다. 실행 기록/원격 제출 접근성은 보존하고 홈 primary CTA로 복귀시키지 않는다.
- 검증: 위 focused tests + `bun test apps/loop-mobile/test`; 새 홈/세션/attention/터미널/기록 showcase 스크린샷과 기존 v9 캡처 비교, `bun run check`.

## 영향과 위험

- v9 사용성 감사 `mobile-usability-findings-v9.md:12-23,39-49,220-224`는 attention 동선 단절과 run 용어 노출을 이미 기록한다. 다만 기존 줄 번호/카피는 현재 변경 중인 작업트리와 어긋날 수 있으므로 구현 시 다시 확인한다.
- 테스트·쇼케이스: run 첫 화면·자동 submit 전제(`SubmitScreen.tsx:27-79`, `App.tsx:268-279`)와 mock inventory, 스냅샷/화면 캡처가 바뀐다. 기존 run 생성 API contract 테스트는 삭제하지 않고 보조 동선으로 재배치한다.
- 세션 발견 경쟁: spawn 응답에는 sessionId가 없고 inventory가 늦거나 읽히지 않을 수 있다(`spawn-fab.tsx:69-107`). 잘못된 기존 세션을 열지 말고 대기/재조회 또는 명시 오류를 유지한다.
- 수명/결합 위험: run은 non-terminal이어도 세션 tap은 ended일 수 있다(`activeView.ts:17-26`). 세션에 없는 attention은 별도 실행 기록에서 해결 가능해야 한다. 동일 폴더·여러 세션에 run을 추정 매칭하지 않는다.
- 권한/가용성: spawn route 미설치/차단 시 유일 생성 버튼은 비활성 원인을 설명하고, 원격 제출을 몰래 대체 경로로 사용하지 않는다. 제품 측에서 ‘새 세션 불가 시 대체 생성’ 정책 변경을 승인해야만 재설계한다.
- 범위: 이번 결정은 문서만 기록한다. P0/P1/P2 코드는 후속 작업이며 기존 변경 중인 소스/테스트는 수정하지 않는다.
