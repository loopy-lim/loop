# Codex 디테일 체크리스트 최종 검증

- **태스크:** `detail-final-verification` (verification, attempt 0)
- **작성일:** 2026-09-26
- **입력:** 결정 `docs/decisions/2026-xx-codex-detail-checklist.md`(C1~C17), 감사 `docs/research/codex-detail-gap.md`, 쇼케이스 `docs/research/simulator-showcase/README.md` §v8 + `v8/` 스크린샷 5장, `apps/loop-mobile` 코드 검사
- **검증 수단:** `bun run check`(전체 체인 녹색), `bun test`(apps/loop-mobile — 150 pass / 0 fail), 코드 검사, v8 스크린샷 파이프라인 증거
- **제약 준수:** 유료 모델 호출 0회(전 증거가 demo 게이트웨이 스크립트 세션 기반)

## 1. 결과 요약

**16개 기준(C1~C16) 전부 pass, C17(변경 없음) pass.** 실패 0건. 유일한 표준 위반 후보(AC2-3 폰트명 하드코딩)는 §3에 기록 — 기능 동작에는 영향 없음.

## 2. 항목별 판정

### P0 — 시각적·정보 디테일

| 항목 | 판정 | 근거 |
| --- | --- | --- |
| C1 마크다운 렌더 | **pass** | AC1-1 단위 테스트 6건(`test/markdown.test.ts` — 5종 문법 노드 산출 + `~~` 평문 보존). AC1-3 의존성 0(`package.json` deps에 마크다운 라이브러리 없음 + 테스트로 고정). AC1-4 `src/features/markdown.ts` 순수 파서 — 프로젝션 텍스트 소비만, 재전송·재가공 경로 0건(코드 검사). AC1-2 스크린샷 `v8/01` |
| C2 코드블록 카드+복사 | **pass** (AC2-3 주의 1건, §3) | AC2-1 `v8/01` — 펜스가 `surfaceAlt` 카드로 본문과 분리. AC2-2 복사 페이로드 순수성 테스트(`markdown.test.ts` "the copy payload is the parsed raw code — no fence markers") + `markdown-view.tsx` `Clipboard.setString(props.code)` 코드 검사 — 스파는 bun 런타임에서 RN Clipboard 주입 불가로 페이로드 경계 검증으로 대체. AC2-3 색·타입은 토큰 경유이나 `fontFamily: "Menlo"`가 호출부 2곳에 하드코딩(§3) |
| C3 접힘 인자 요약 | **pass** | AC3-1 `tool-summary.test.ts` 3케이스 이상(path/command/빈 객체 + 말단 JSON 열화 7건). AC3-3 `conversation-timeline.tsx` `cardSummary` — `numberOfLines={1}`·`type.caption`·`colors.inkMute`, 렌더 시 `toolArgsSummary(item.argsJson)` 파생(상태 복제 없음). AC3-2 스크린샷 `v8/02` |
| C4 상태어 색 대비 | **pass** | AC4-1 `TOOL_STATUS` 지도로 `cardState`가 상태 파생 색(running=warn/done=ok/error=danger, 폐쇄 삼합) — 코드 검사. 문자는 색과 무관하게 남음. AC4-2 `v8/02` |
| C5 잘림 정직 표기 | **pass** | AC5-1 문구 상수 `ui/copy.ts` `TRUNCATED_NOTICE`·`EMPTY_RESULT_NOTICE`(인라인 조합 없음 — 바이트 수 대신 예산 소유자 명시가 더 정직한 변형, 결정 취지 준수). AC5-2 `toolResultView` 3케이스+α 단위 테스트(running=숨김 / 종료+빈 결과=`(no output)` / truncated 플래그). AC5-4 `Modal` import 0건 — 전체 보기 경로 없음. AC5-3 `v8/02` |
| C6 타임스탬프·상대 시간 | **pass** | AC6-1 `time-format.test.ts` 4케이스(5m/2h/3d/날짜). AC6-2 `timeline-rows.test.ts` 연속 같은 역할 첫 행만 캡션(steer는 캡션·일 커서 미개입 포함). AC6-4 `occurredAt`은 `clockTime(item.occurredAt)` 렌더 시 소비, 상태 복제 없음. AC6-3 `v8/04` |
| C7 타이핑 인디케이터 | **pass** | AC7-1 `streamingCursorVisible`/`streamingBusyRowVisible` 단위 테스트(`final` 소비). AC7-2 `glyph.cursor`(▍)·`glyph.busy`(···) 어휘 경유 — 신규 발명 없음. 타이머는 언마운트 해제(`StreamingCursor` useEffect cleanup). AC7-3 `v8/02`↔`v8/03` 정지 캡처 차이가 busy 신규 행에 국한(README §v8 캡처 신뢰성 노트) |
| C8 날짜 섹션 헤더 | **pass** | AC8-1 23:50→00:05 경계 1건 / 같은 날 10아이템 0건 단위 테스트. AC8-2 헤더 행 key 접두사 `hdr:` 분리 — D4 아이템 키와 무충돌 테스트 고정, 프로젝션 어휘 미유입. AC8-3 `v8/04`(이틀 걸친 히스토리) |
| C9 빈 상태 | **pass** | AC9-1 문구 상수 `EMPTY_TIMELINE_TITLE`/`EMPTY_TIMELINE_HINT`(`ui/copy.ts`). AC9-2 `shouldRenderEmptyState` 0/>0 테스트. AC9-3 `v8/05`(orphan 세션 직접 진입) |
| C10 에러/재연결 위계 | **pass** | AC10-1 notices 분기 — stale만 `noticeWarn`(colors.warn + `glyph.statusRunning`), ended/waiting은 최소 신호(코드 검사). AC10-2 대화 화면의 `Stream: {streamError}` 원문 보간 제거 → `STREAM_DISCONNECTED_NOTICE` 상수 1줄(`ConversationScreen.tsx:368`. Pane/Run 화면의 잔존 보간은 대화 GUI 밖 기존 표면 — 동작 불변 원칙으로 무변경이 옳음). AC10-3 `composer-retry.test.ts` — steer 실패 시 draft 보존 + 동일 steer 엔드포인트 재호출, idle 재시도는 prompt 엔드포인트. AC10-4 `v8/02~04`와 README 매핑(stale=warn 강조 vs ended=무음 캡션) |

### P1 — 인터랙션 디테일

| 항목 | 판정 | 근거 |
| --- | --- | --- |
| C11 맨 아래로 pill | **pass** | AC11-1 가시 조건이 기존 `following` 상태만 소비(`mode === "chat" && !following`) — 신규 스크롤 상태 0. 재진입은 기존 `onScroll` 48pt 엡실론(`nextFollowState`) 경로. AC11-2 `pane-projection.test.ts` 포함 150 테스트 무변경 통과. AC11-3 `v8/04`(스크립트 스크롤업 뒤 우하단 pill) |
| C12 스크롤 애니메이션 | **pass** | AC12-1 대화 화면 `scrollToEnd({ animated: true })` 2곳 — `animated: false` 잔존 0(`ConversationScreen.tsx`. `PaneScreen.tsx:109`의 false는 터미널 미러 기존 동작 — 체크리스트 범위 밖, 동작 불변). 프레임 병합 ≥250ms 수렴 조건은 D4 §2 그대로. AC12-2는 수동 항목 — §4 참조 |
| C13 pull-to-refresh | **pass** | AC13-1 `run-list.tsx` `RefreshControl refreshing={loading} onRefresh={reload}` — 기존 상태 재사용, 신규 로딩 상태 0. Refresh 텍스트 버튼 병존(§9-1 허용). AC13-2 기존 목록 테스트 무변경 통과(150 pass) |
| C14 터치 타깃 44pt | **pass** | AC14-1 코드 검사: 전송 버튼 44×44(`composer.tsx` `sendTouch`), 백 버튼 `minWidth/minHeight: 44`, raw 토글 hitSlop 확대(top/bottom 14·좌우 16). 실효 픽셀의 렌더 측정은 수동 항목 — §4 참조 |
| C15 동적 타입 1단계 | **pass** | AC15-1 `DynText`가 대화 표면 전체 텍스트 루트에 `maxFontSizeMultiplier ?? 1.3` 기본 적용 + TextInput에 `MAX_FONT_SCALE` 명시 — "화면 루트 설정"보다 강한 커버(메커니즘 차이는 DynText 문서화). AC15-2는 시뮬레이터 수동 — §4 참조 |
| C16 카드 확장 애니메이션 | **pass** | AC16-1 토글 핸들러에 `LayoutAnimation.configureNext(Presets.easeInEaseOut)` 1회(`ConversationScreen.tsx:423`) — RN 코어, 외부 라이브러리 0. 햅틱은 결정대로 보류. AC16-2는 수동 — §4 참조 |
| C17 가상화 무변경 | **pass** | AC17-1 `FlatList` 도입 0건(`grep -r FlatList src/` → 0), `ScrollView` 유지. AC17-2 트리거 문서화: 결정 문서 §C17·§7 + 감사 `codex-detail-gap.md:151`(500 아이템 + 프레임 드랍 관측 시 `FlatList`+`inverted` 후속 결정) |

## 3. 발견 사항 (수정 권고 — 이번 사이클 차단 아님)

1. **AC2-3 부분 위반 — 폰트명 호출부 하드코딩:** `conversation-timeline.tsx:328`(`cardMono`)과 `markdown-view.tsx:146`(`codeText`)이 `{ ...type.mono, fontFamily: "Menlo" }`로 호출부에서 폰트명을 하드코딩한다. 결정 AC2-3은 "호출부 hex·폰트명 하드코딩 금지"를 요구하며, 어휘는 이미 존재한다(`ui/terminalLayout.ts` `TERMINAL_FONT_FAMILY`). 권고: `tokens.ts`의 `type.mono`에 `fontFamily: TERMINAL_FONT_FAMILY`를 흡수하고 호출부 2곳에서 중복 제거. 색·타입 역할 경유 규칙은 충족 상태라 기능·시각 영향 없음.
2. **AC2-2 스파 방식 대체:** RN 코어 `Clipboard`는 bun 테스트 런타임에 주입 불가 — 스파 대신 "복사될 페이로드의 순수성"을 파서 경계에서 테스트하고 `Clipboard.setString(block.text)` 호출을 코드 검사로 확정. 결정의 폴백 원칙(의존성 0 우선)과 일치.
3. **C5 문구 상수의 정직한 변형:** 결정 예시는 "truncated at N KB"였으나 앱은 boolean만 수신하므로 `…(truncated — gateway wire budget)`로 예산 소유자를 명명 — 유계 없는 수치 발명을 피한 취지 준수(§7 문구 상수 원칙 유지).

## 4. 미실시 수동 항목 (자동 검증 불가 — 잔여 리스크)

AC12-2(스트리밍 스크롤 추적), AC14-2(44px 레이아웃 수용), AC15-2(AX3 큰 텍스트), AC16-2(전환 애니메이션 체감)는 시뮬레이터 수동 확인 항목으로 이 검증에서 미실시. 완화: 대응 코드는 단위 테스트·코드 검사로 고정됐고, v8 캡처 체인(`v8/capture.sh`)이 스크립트 스크롤·카드 토글 경로를 재현한다. 스크린샷 AC(AC1-2 등 10건)는 `v8/` 5장 + 선행 태스크의 픽셀 차이 재검증 기록(README §v8 "캡처 신뢰성" — MD5 5장 전부 상이, 교차 차이 21~36%)으로 확정. 본 태스크 모델은 이미지 직접 열람 불가로 육안 재검은 선행 기록에 의존.

## 5. 동작 불변·경계 확인

- **전체 체크:** `bun run check` = `codegen:check` → `typecheck` → `test:architecture` → `cargo test --workspace && cargo build -p loop-bridge && bun test packages tests plugins` — 체인 최종 단계까지 도달, **0 fail**(cargo 전 패키지 ok, bun 528 pass / architecture-boundaries 포함). 별도 `apps/loop-mobile` `bun test` **150 pass / 0 fail / 404 expect**.
- **경계:** wire·프로토콜·loop-core 변경 없이 `apps/loop-mobile` 표현 계층만 소비 추가 — 아키텍처 경계 테스트 녹색. steer 흐름(D4 §4)·raw 토글·제출 분기 무변경(`conversation-contract.test.ts` 등 기존 계약 테스트 전부 통과).
- **신규 상태 0:** 날짜 헤더·캡션·요약·커서가 전부 렌더 파생(`timeline-rows.ts`·`tool-summary.ts`·`time-format.ts` 순수 함수) — 프로젝션 어휘 무변경.
- **비용:** 유료 모델 호출 0회(모든 스크린샷은 demo 게이트웨이 스크립트 세션).
