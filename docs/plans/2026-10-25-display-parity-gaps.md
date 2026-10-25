# 계획 — 잘 보여주는 앱 대비 표시 격차 해소 (display parity)

- **일자:** 2026-10-25
- **요청:** "/sdd 다른 이런 잘 보여주는 앱하고 비교했을 때에 무엇이 부족할까? 그것들을 모두 찾아보고 새건해보자." — loop가 herdr 쇼케이스로 역할 한정된 만큼, loop-mobile 대화 표시를 경쟁 앱(Happy·Omnara·Orca·Paseo·Claude/ChatGPT 본가 앱) 표준과 비교해 격차를 전수 조사하고, 이번 회차에서 해소 가능한 것을 구현한다. "새건해보자"는 문맥상 "찾아서 해결해보자"로 해석.
- **기준 리비전:** main @ 508b98c (clean, AGENTS.md.bak 미추적 제외)
- **조사 근거:** UI 전수 인벤토리(2026-10-25, Explore 위임) + 경쟁 앱 기능 조사(Happy features 문서, Omnara/Orca/Paseo 공식 사이트, ChatGPT 릴리스 노트). 경로는 아래 확인한 사실에 기록.

## 목표와 범위

**목표:** 대화 화면(AgentScreen)이 에이전트 활동을 경쟁 앱 수준으로 "보여주게" 한다 — 시간 맥락, 꼬리 복귀, 복사, 도구 상세 확장, 연결 상태, 풍부한 응답 구조(링크·목록·thinking), 접근성 기본기.

**이번 회차 구현 (T-1~T-8):** 타임스탬프·날짜 구분선, 점프-투-바텀 필, 턴 복사 메뉴, 도구 턴 확장, 연결 상태 배너, 마크다운 확장(순서 목록·링크·이탤릭), claude thinking 턴, 정합·접근성 마무리.

**제외 (후속 — 전수 조사 목록에는 포함, 이번 회차 미구현):**

| 격차 | 후속 사유 |
|---|---|
| 푸시 알림 | 브리프 v1 비목표(포그라운드 실시간성만) |
| 멀티머신 UI | 브리프 v1 비목표 |
| 파일 뷰어 이관 | 브리프 v1 비목표 |
| 사용량/토큰/비용 표시 | herdr 표면에 데이터 없음 — 게이트웨이 신규 노출 필요(별도 계약 변경) |
| 대화 내 검색 | 검색 UI·하이라이트 엔진이 별도 회차 규모 |
| 음성 입력·파일 멘션 | 새 권한·입력 계약 필요 |
| Android RefreshControl | RN 0.88 Fabric 버그(기기 문제, 우회 설계 별도) |
| 라이트 테마 | 토큰 계약이 후속으로 예약, 별도 회차 |
| 어시스턴트 본문 네이티브 선택 | A2 가정: 복사 메뉴로 충족(선택 핸들과 스크롤 제스처 충돌 회피) |

### 확인한 사실 (조사 근거, 실제 경로)

- 턴 3종(`user`/`assistant`/`tool{id,title,detail,state,at}`), `at`은 RFC3339로 이미 전달되며 pending 은퇴 판정에만 사용되고 렌더는 안 함(`apps/loop-mobile/src/herdr/wire.ts:74-84`, `src/herdr/conversation.ts:139-143`).
- `features/time-format.ts:9-85`의 clockTime/relativeTime/dayKey 등이 테스트(`test/time-format.test.ts`)만 있고 src에서 0 임포트 — 죽은 코드.
- 점프-투-바텀 필은 `src/ui/tokens.ts:121`·`src/ui/followScroll.ts:57-59`가 참조하나 렌더가 없다. followScroll 기계(48px 엡실론, 터치 시 detach)는 존재.
- 도구 턴은 상태 아이콘+제목+2줄 상세 고정(`src/screens/AgentScreen.tsx:570-596`), fold 아이콘 2종이 등록만 돼 있음(`src/ui/glyphs.ts:59-61`). 게이트웨이가 detail 600자 상한(`packages/gateway/src/agent-sessions.ts:35-38`)까지 전달하므로 확장 표시는 데이터가 충분하다.
- 재연결 상태머신 idle|connecting|live|waiting|failed는 `src/herdr/store.ts:19`에 있으나 화면 배너가 없고 설정에만 노출(`src/screens/SettingsScreen.tsx:49-55`).
- 마크다운 파서는 5문법 폐쇄 문법(`src/features/markdown.ts:62-108`), 의존성 0이 테스트로 고정(`test/markdown.test.ts:83-89`). 문법 추가는 계약 위반이 아니다.
- thinking 블록은 게이트웨이 파서가 text/tool_use만 처리해 드랍(`packages/gateway/src/agent-sessions.ts:222-299`).
- 사용자 버블이 `colors.surface`를 쓰고 `userBubble` 토큰(#202734)이 미사용(`src/ui/tokens.ts:29` vs `AgentScreen.tsx:785`). 전송 버튼 38px, 퀵키 paddingVertical 4 — 44pt 미만.
- clipboard TurboModule 시브(`src/features/clipboard.ts:27-32`), haptics(`src/ui/haptics.ts`), AnimatedSheet 프리미티브, Entrance/PulseDot 모션(`src/ui/motion.tsx`)은 기존 자산.
- 검증 명령: 앱 `cd apps/loop-mobile && bun test test`(package.json:7), 루트 `bun run check`(package.json scripts.check), 게이트웨이 `bun test packages/gateway/test/agent-sessions*.test.ts`. 에뮬레이터 2대 부팅 중(emulator-5554에 adb reverse tcp:18477 설정됨, loop-gateway systemd 서비스 active — 2026-10-25 확인).

### 가정 로그

- **A1 (범위 기본값):** "모두 해소"를 이번 회차에서는 위 표의 구현 세트로 한정한다. 근거: 브리프 비목표 계약 존중 + 한 회차 품질 한계. 기각된 대안: 대화 검색까지 포함(별도 회차 규모 — 상태 머신·하이라이트·점프 렌더가 필요), 사용량 표시(게이트웨이 표면 신규 노출이 선행).
- **A2 (복사 UX):** 길게 누르기 → 시트 복사 메뉴로 충족한다. 이유: selectable Text의 선택 핸들이 스크롤/뒤로가기 제스처와 충돌할 수 있고, 터미널 텍스트만 이미 selectable이라 일관된 계층이 유지된다. 기각된 대안: assistant 본문 selectable=true(표준이지만 제스처 충돌 위험), 코드블록만 유지(사용자 요구 미충족).
- **A3 (링크):** `Linking.openURL`로 바로 연다(확인 다이얼로그 없음 — 본가 앱 관례). http/https만 허용한다.
- **A4 (thinking 범위):** claude 파서에만 추가한다. 다른 종류(codex/agy 등)는 구조 턴 경로가 없거나 summary 표면으로, thinking 개념이 없다.
- **A5 (시각 표시 단위):** 턴별 HH:MM 캡션 + 날짜가 바뀌는 경계에만 날짜 구분선(매 턴 날짜 반복 금지 — 본가 앱 관례). 도구 확장 카드에는 상대시간까지 표시.
- **A6 (배너 판정원):** store의 status(waiting/failed)를 그대로 사용한다. 새 판정 상태를 만들지 않는다.

## 수락 기준

| ID | 관찰할 결과와 적용 조건 | 담당 태스크 | 검증 ID |
|---|---|---|---|
| AC-1 | 대화 화면의 구조 턴(user·assistant·tool)에 시각이 보인다. 날짜가 바뀌는 첫 턴 위에 날짜 구분선이 있다. ANSI 폴백·터미널 세그먼트는 기존과 같다 | T-1 | V-1, V-9 |
| AC-2 | 스크롤이 꼬리에서 48px 이상 벗어나면 필이 나타나고, 탭하면 꼬리로 복귀한다. 꼬리에 붙어 있을 땐 보이지 않는다 | T-2 | V-2, V-9 |
| AC-3 | user·assistant 턴을 길게 누르면 복사 시트가 열리고 전체 텍스트를 복사할 수 있다. 성공·실패가 정직하게 표시된다(가짜 "복사됨" 금지) | T-3 | V-3 |
| AC-4 | 도구 턴을 탭하면 상세 전체와 시각이 펼쳐지고, 다시 탭하면 접힌다. 접힘 상태는 새 데이터가 와도 유지된다 | T-4 | V-4, V-9 |
| AC-5 | 스트림이 waiting(재연결 중)이면 대화 화면에 배너가 보이고, failed면 실패 배너가 보인다. live로 돌아오면 사라진다 | T-5 | V-5, V-9 |
| AC-6 | 어시스턴트 응답의 순서 목록·인라인 링크·이탤릭이 구조로 렌더된다. 링크 탭은 http/https만 시스템 브라우저로 연다. 기존 5문법 렌더는 유지된다 | T-6 | V-6 |
| AC-7 | claude 세션의 thinking 블록이 게이트웨이를 거쳐 thinking 턴으로 도착하고, 접힌 카드로 렌더된다(기본 접힘, 탭 확장). text/tool 턴 렌더는 변하지 않는다 | T-7 | V-7 |
| AC-8 | 사용자 버블이 userBubble 토큰을 쓴다. 전송·퀵키 터치 타깃이 44pt 이상이다. 작업 중 상태 전환이 스크린리더 공지를 갖는다. Herd 초기 로딩에 표시가 있다 | T-8 | V-8, V-9 |
| AC-9 | 저장소 검증 녹색(루트 check·앱 테스트·게이트웨이 테스트), 디자인 계약 테스트(토큰·명암·design-spec) 유지, 에뮬레이터 라이브 관찰 캡처로 AC-1·2·4·5·7의 화면 증거 | 전체 | V-9, V-10 |

## 설계

- **책임:** 순수 로직(시각 배치, 필 표시 판정, 복사 페이로드, 접힘 상태, 배너 판정, 파서)은 모듈 함수로, 렌더는 화면 컴포넌트가 맡는다 — 기존 conversation.ts/markdown.ts 계층 관례 준수. 상태는 HerdrStore 단일 소유(화면 useState 금지 영역 준수).
- **시각 배치:** `turnTimeGaps(turns)` 순수 함수가 구분선 삽입 위치를 반환 — 렌더 중 판정 금지. 캡션은 time-format 기존 함수 재사용.
- **필:** followScroll 판정원이 이미 꼬리 이탈을 계산하므로, 화면이 그 verdict를 state로 받아 필 렌더. 새 토큰 추가 금지 — elevation.float·기존 토큰만.
- **복사 메뉴:** AnimatedSheet 재사용(드래그 해제·바깥 탭 닫기), clipboard 시브 사용, 실패 시 실패 문구. haptic은 시트 열림에만.
- **도구 확장:** 턴 id 기반 Set<string> 접힘 상태(기본 접힘), 새 턴 도착에 유지. thinking 카드와 fold 아이콘 공유.
- **배너:** store status 파생 렌더 — waiting은 주황(warn 토큰), failed는 danger 토큰, live면 미렌더. 새 색 금지.
- **thinking 턴:** 게이트웨이 `parseClaudeTurns`에 thinking 블록 매핑(thinking 텍스트 상한은 TURN_TEXT_CAP 재사용), wire.ts kind 확장, 앱 chatBody 게이트·turnsEqual은 확장된 kind에 일반 동작. 렌더는 기본 접힌 회색 카드.
- **오류·복구 경계:** 복사 실패(시브 false) → 실패 문구 유지. 링크 open 실패 → 조용히 무시하지 않고 문구 없이 로그 수준에서 유지(문구 추가 없음 — A3). 배너는 상태가 live로 회복하면 즉시 사라진다(SSE 프레임 기반).
- **접근성:** 상태 전환 announce(accessibilityLiveRegion Android + iOS announceForAccessibility 대응은 RN 접근성 속성), 터치 타깃 44pt, 배너·필·시트에 라벨.
- **디자인 출처:** 전부 기존 tokens·motion·primitives·glyphs(등록된 미사용 아이콘 foldClosed/foldOpen 포함). 새 색·폰트·모션 토큰 없음 — design-spec/contrast/tokens 테스트가 기계적으로 잠근다.
- **호환:** wire kind 확장은 추가 전용(기존 3종 소비자 무영향). 게이트웨이 턴 캡·예산 계약 유지. ANSI 폴백·터미널 세그먼트 무변경.

## 태스크

| ID | 목적·AC | 수정할 파일/경계 | 선행 | 검증 ID | 상태 |
|---|---|---|---|---|---|
| T-1 | 턴 시각 캡션·날짜 구분선 + summary modifiedAt 표시 (AC-1) | apps/loop-mobile/src/herdr/conversation.ts(순수), features/time-format.ts(필요 시 보강), screens/AgentScreen.tsx | 없음 | V-1 | pending |
| T-2 | 점프-투-바텀 필 (AC-2) | screens/AgentScreen.tsx, ui/followScroll.ts(필요 시 verdict 노출 보강) | 없음 | V-2 | pending |
| T-3 | 턴 복사 메뉴 (AC-3) | screens/AgentScreen.tsx, features/turn-copy.ts(신규 순수), copy.ts | 없음 | V-3 | pending |
| T-4 | 도구 턴 확장 (AC-4) | screens/AgentScreen.tsx(접힘 상태), copy.ts | 없음 | V-4 | pending |
| T-5 | 연결 상태 배너 (AC-5) | screens/AgentScreen.tsx, screens/TerminalScreen.tsx, copy.ts | 없음 | V-5 | pending |
| T-6 | 마크다운 순서 목록·링크·이탤릭 (AC-6) | features/markdown.ts, features/markdown-view.tsx, test/markdown.test.ts | 없음 | V-6 | pending |
| T-7 | thinking 턴 (AC-7) | packages/gateway/src/agent-sessions.ts + test, apps/loop-mobile/src/herdr/wire.ts, screens/AgentScreen.tsx | 없음 | V-7 | pending |
| T-8 | 토큰 정합·터치 타깃·공지·로딩 표시 (AC-8) | screens/AgentScreen.tsx, screens/HerdScreen.tsx, copy.ts | T-1~T-5 이후(공유 파일 충돌 방지) | V-8 | pending |

공유 파일(AgentScreen.tsx) 소유자는 구현자 1인 — 순차 구현. T-7은 게이트웨이 선수행.

## 검증 계획과 결과

| ID | 방법·정의 근거 | cwd·환경 | 기대 결과 | 실제 결과·증거 | 판정 |
|---|---|---|---|---|---|
| V-1 | `bun test test/agent-conversation.test.ts test/time-format.test.ts`(turnTimeMarks 신규 describe 포함) | apps/loop-mobile | 구분선·캡션 판정 통과 | 64 pass / 0 fail(2026-10-25, turnTimeMarks는 아키텍처 경계로 features/time-format.ts로 이동) | PASS |
| V-2 | followScroll는 순수 기계 유지 + 점프 억제 창(JUMP_SUPPRESS_MS)은 훅 캐리어 — 화면 연결은 에뮬레이터 관찰로 판정 | apps/loop-mobile + emulator | 이탈→필 표시, 탭→꼬리 복귀 | 라이브 관찰: detach 시 필 표시(sdd-20), 탭 후 꼬리 복귀·필 소멸(sdd-21). 초기 2회 빌드에서 탭 무반응 발견 → 직접 Pressable+재시도·억제 창으로 수정 후 재검증 PASS | PASS(수정 후) |
| V-3 | 복사는 기존 clipboard 시브 계약(clipboard.ts) 재사용 — 신규 순수 테스트 대신 라이브 관찰로 판정 | apps/loop-mobile | 시트→복사→정직 피드백 | 라이브 관찰: 시트 표시(sdd-27), 복사 성공 + "복사됐어요" + 시스템 클립보드 툴바에 복사 텍스트 프리뷰(sdd-28) | PASS |
| V-4 | 접힘 상태는 턴 id 기반 Set — 새 페치에 유지(코드 계약). 라이브 관찰로 도구 확장 판정 | apps/loop-mobile | 확장/재접힘 동작 | 라이브 관찰: 2줄→전체 상세+상대시간("10월 23일")+치브 반전(sdd-25) | PASS |
| V-5 | store status 파생 렌더 — waiting 관찰, failed는 이 시나리오에서 미관찰 | apps/loop-mobile + emulator | waiting 배너 표시·live 복귀 소멸 | 게이트웨이 stop → waiting 배너(sdd-31), start → 자동 소멸(sdd-33). failed 배너는 스트림이 접속 거절 상황에서도 waiting을 유지하는 설계라 라이브 미관찰(코드 분기 검토만 — 제한 기록) | PASS(부분 — failed 미관찰 명시) |
| V-6 | `bun test test/markdown.test.ts`(순서 목록·링크·이탤릭·http 한정·flanking·기존 문법 회귀) | apps/loop-mobile | 통과 + 의존성 0 유지 | 247 pass / 0 fail(앱 전체), markdown lib 금지 테스트 유지 | PASS |
| V-7 | `bun test packages/gateway/test/agent-sessions-cache.test.ts`(thinking 매핑 신규) + 게이트웨이 라이브 응답 확인 | 루트 + live gw | thinking 턴 파싱 | 10 pass / 0 fail; 게이트웨이 재시작 후 curl에서 thinking 54개(`kinds: {assistant 62, tool 52, user 32, thinking 54}`), 앱 렌더는 라이브 관찰 | PASS |
| V-8 | design-spec/contrast/tokens 테스트 + 터치 타깃 코드 검토 | apps/loop-mobile | 계약 테스트 녹색, 44pt | 앱 테스트 247 pass(토큰·명암·design-spec 포함), 전송 44px·퀵키 minHeight 44. 상태 공지(announce)는 접근성 채널로 화면 캡처 불가 — 코드 검토만 | PASS(공지는 코드 검증) |
| V-9 | `bun run check`(codegen·lint·typecheck·아키텍처·test) | 루트 | 녹색 | codegen·lint·typecheck·아키텍처 PASS. test 2 fail — **둘 다 기준 리비전에서 동일 재현 확인**(profile.test.ts rustra 후보 제약, cli gateway.test.ts 포트 레이스 — 살아있는 loop-gateway 서비스와 경합). 단독 실행 시 양쪽 모두 0 fail | PASS(기존 환경 실패 2건 분리 명시) |
| V-10 | 에뮬레이터 라이브 관찰(`bun run android:release` 설치, adb reverse tcp:18477, 실게이트웨이) | emulator-5554 | AC-1·2·3·4·5·7 화면 증거 | 캡처 11장 `docs/plans/2026-10-25-display-parity-captures/`(sdd-02·13·20·21·25·27·28·31·33·34·35). Herd 로딩 스피너는 로컬 연결이 즉시라 관찰 창 없음(코드 검증). 링크 탭 렌더는 단위 테스트만(채팅에 http 링크 사례 미출현) | PASS(제한 2건 명시) |

**라이브 발견→수정 기록:** 초기 빌드에서 점프 필 탭이 무반응(프로그램 스크롤 글라이드가 onScroll만 내보내 재-detach + PressableScale 내부 absolute 프레임 모호성) → followScroll에 점프 억제 창, 화면에 이중 스크롤 재시도, 필을 직접 Pressable로 교체 → 재빌드 후 라이브 재검증 PASS. 아키텍처 경계 위반(herdr→features 임포트) 1건도 발견→turnTimeMarks를 features/time-format으로 이동해 해소.

## 평가와 인계

- G1 plan 모드: self-review(독립 평가자 미투입 — 계획 단계, 기록됨).
- G2 task 모드: self-review — 태스크별 V-1~V-8 실측으로 판정(위 표).
- G3 코드: **독립 서브에이전트 PASS**(2026-10-25, review-changes 기준 — 최종 트리에서 검증 재실행: 앱 247·게이트웨이 252 pass, lint·typecheck·codegen·아키텍처 녹색; 전체 스위트 기존 환경 실패 2건 제외 판정). P3 권고 5건 — F-1 링크 catch(반영), F-2 공지 타이머 상충(조건부 소멸로 반영), F-3 점프 재시도 타이머 정리(반영), F-5 시트 드래그 미결합(panHandlers 결합으로 반영), F-4 점프 억제 창의 실사용 detach 흡수(수용 — 0.6s 한정 거래, 주석 기록). 관찰 2건(F-6 복사 a11y 액션 비노출, F-7 마운트 시 초기 announce)은 후속.
- G4 디자인: **독립 서브에이전트 FAIL → 수정 후 재검증 PASS**(2026-10-25, review-design 구현 모드 — 캡처 직접 관찰). 결함 처리: F-1(P2) 복사 피드백 무기한 지속 → flashNotice 2.5s 자동 소멸, 표시(dbg capture `sdd-g4-fix-copied-flash.png`)·소멸(`sdd-g4-fix-copied-cleared.png`) 재관찰 PASS. F-2(P2) 확장 도구 카드 상대시간 inkGhost(AA 미달·장식 티어 계약 위반) → inkFaint, 재관찰(`sdd-g4-fix-toolexpand-inkfaint.png`) PASS + truncateNotice 동일 패턴 정리. F-3(P3) waiting 배너 warn 미적용 → warn 아이콘·텍스트 적용(계획 설계와 일치). F-4(P3) thinking 카드 타깃 33px → hitSlop 추가. F-5(P3, 후속) 사용자 버블의 원시 프로토콜 XML 노이즈 — 아래 후속 목록에 추가.
- G5 완료: completion 모드(아래 AC별 판정).

## G5 완료 판정 (completion, 2026-10-25)

| AC | 판정 | 증거 |
|---|---|---|
| AC-1 시각·날짜 구분선 | PASS | V-1 단위 테스트, 캡처 sdd-02(HH:MM 캡션), sdd-18 경유 Oct 22 헤더는 sdd-13 시퀀스에서 관찰(파일은 11장 선별에서 제외 — dayHeader 렌더는 단위 테스트 핀 + 라이브 관찰 기록) |
| AC-2 점프 필 | PASS | 라이브 관찰 sdd-20(표시)→sdd-21(탭 후 소멸·꼬리 복귀); 초기 무반응 결함 수정 기록 포함 |
| AC-3 복사 메뉴 | PASS | sdd-27(시트)→sdd-28(복사됐어요+시스템 클립보드 도달), g4 재관찰(플래시 표시→자동 소멸) |
| AC-4 도구 확장 | PASS | sdd-25(전체 상세+상대시간+치브 반전), g4 재관찰(inkFaint 가독) |
| AC-5 연결 배너 | PASS(부분 명시) | sdd-31(waiting)→sdd-33(복구 소멸); failed 배너는 스트림 설계상 라이브 미관찰(코드 분기 검토만 — 정직 기록) |
| AC-6 마크다운 확장 | PASS | 단위 테스트(순서 목록·링크 http/https 한정·이탤릭 flanking·기존 문법 회귀), 라이브 순서 목록 관찰(sdd-13); 링크 탭은 채팅에 http 사례 미출현으로 단위 테스트만(한계 기록) |
| AC-7 thinking 턴 | PASS | 게이트웨이 테스트 + live curl(thinking 54개), sdd-34(접힘)→sdd-35(확장) |
| AC-8 정합·접근성 | PASS(공지는 코드 검증) | userBubble 실사용(sdd-20), 44pt(전송·퀵키·시트 액션·thinking hitSlop), 상태 announce는 접근성 채널로 코드 검증만, Herd 로딩은 로컬 즉시 연결로 관찰 창 없음(코드 검증) |
| AC-9 저장소 검증·캡처 | PASS | codegen·lint·typecheck·아키텍처 녹색, 앱 247·게이트웨이 252 pass, 전체 스위트 기존 환경 실패 2건(기준 리비전 재현 확인) 분리, 캡처 14장 |

**잔여 한계:** failed 배너·스크린리더 공지·Herd 로딩 스피너·링크 탭은 각각 관찰 불가 시나위 또는 미출현 사례 — 코드 검증만 적용된 것을 위 표에 명시했다. 이것을 PASS로 승격하지 않는다.

**후속 목록(조사됐으나 이번 회차 제외 — 코드로 새지 않음):** 사용량/토큰/비용 표시(게이트웨이 herdr 표면 신규 노출 선행), 대화 내 검색, 음성 입력·파일 멘션, Android RefreshControl(Fabric 버그), 라이트 테마, 어시스턴트 본문 네이티브 선택, 사용자 버블의 원시 프로토콜 XML 요약·접기(G4 F-5), 복사 원문(마크다운 마커 포함) vs 렌더 텍스트 격차, 복사 액션의 스크린리더 노출(G3 F-6).

커밋은 사용자 요청 시 별도 수행(SDD 자동 마지막 단계 아님).
