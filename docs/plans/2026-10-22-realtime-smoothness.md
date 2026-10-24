# 계획 — loop-mobile 실시간성·부드러움 개선 (스트리밍 파이프라인 + 지각 피드백)

- **일자:** 2026-10-22
- **요청:** "이 프로젝트에서 결국 부드러운 애니메이션과 압도적인 사용 편안함이 있어야 할 것 같다. 특히 실시간성을 제대로 봐야 한다." `/sdd` 전체 흐름.
- **기준 리비전:** aa5b8cc (main) + 미커밋 변경 보존(안드로이드 이식·https 계약 등 이전 SDD 산출물 — 본 계획은 그 위에 적층, 되돌리지 않음)

## 목표와 범위

작업 중 에이전트의 출력이 폰 대화 화면에 빠르고 끊김 없이 반영되고, 대화가 길어져도
갱신 비용이 늘지 않으며, 전송·작업 중 피드백이 즉각적이어야 한다.

- **범위:** 게이트웨이 conversation 읽기 경로(`packages/gateway`), 앱 실시간 갱신·렌더
  경로(`apps/loop-mobile` src/herdr·screens/AgentScreen·ui/motion), copy/테스트.
- **제외:** SSE 재연결 정책(이미 구현됨), 증분 conversation API 등 wire 계약 변경,
  HerdScreen 목록 최적화(리스트가 작아 병목 아님 확인), 커밋(사용자 요청 시 별도).

### 확인한 사실 (조사 근거, 실제 경로)

- 실시간 체인: herdr `pane.output_matched` → `HerdrStateMonitor` 200ms coalesce →
  refresh(`session.snapshot` + 에이전트 패인마다 `readTail`, 각 요청 새 unix 소켓) →
  version bump → SSE full-state → 폰 (`packages/gateway/src/herdr-state.ts:150-228`,
  `herdr-pane-source.ts:993`).
- 폰은 revision 변화마다 `refresh()` — **직렬** `readPane(400줄 ansi)` →
  `conversation()` 2회 왕복 (`apps/loop-mobile/src/screens/AgentScreen.tsx:81-113`).
  구조화 턴 뷰에서 ANSI 읽기는 표시에 안 쓰이는 낭비(터미널 세그먼트·강등 폴백에만 필요).
- 게이트웨이 conversation 라우트가 요청마다 `resolveAgentConversation` → 세션 JSONL
  **전체 재read·재parse**, 캐시 없음 (`packages/gateway/src/server.ts:748-769`,
  `agent-sessions.ts:133-216`). 히스토리가 길수록 틱당 게이트웨이 비용 선형 증가.
- 폰 렌더: `nextConversation` wholesale 교체(`herdr/conversation.ts:48-55`) → 매 틱
  모든 턴 객체 새로 생성 → `memo(ChatTurnRow)` 항상 실패(`AgentScreen.tsx:434`) →
  **모든 행 리렌더**, 스트리밍 중 턴의 markdown 전체 재파싱.
- 턴 id는 파일 절대 위치·uuid 기반이고 `slice(-TURN_BUDGET)`이 id 부여 **후**라 안정적
  (`agent-sessions.ts:157,195,241`) — FlatList 키 안정. remount 점프 원인 아님.
- 유휴 시: `viewUnchanged`로 version 무증가 → SSE 프레임 없음 → 폰 재fetch 없음
  (이미 정상, `herdr-state.ts:216`).
- 전송 후: 승인 즉시 composer는 비지만 유저 버블은 다음 conversation 왕복까지 없음
  (`AgentScreen.tsx:143-161`), working 중 진행 인디케이터 없음.
- 검증 명령 확인: 루트 `bun run check`(codegen:check+lint+typecheck+architecture+test),
  gateway `bun test packages/gateway/test`, 앱 `bun test test`(apps/loop-mobile,
  211+ 테스트). 에뮬레이터 KVM 가속 활성(이전 계획 V-5: p50 16ms·jank 2.95%).

## 수락 기준

| ID | 관찰할 결과와 적용 조건 | 담당 태스크 | 검증 ID |
|---|---|---|---|
| AC-1 | 작업 중 에이전트의 출력이 게이트웨이 상태 version 상승 1틱 내 폰 대화에 반영된다(에뮬레이터 라이브 관찰). 적용 조건: 게이트웨이·herdr·세션이 같은 머신 | T-2 | V-1, V-4 |
| AC-2 | 대화가 길어져도 틱당 게이트웨이 파싱과 폰 리렌더 행 수가 히스토리 크기에 비례해 늘지 않는다(캐시 히트·memo 스킵을 단위 테스트로 핀) | T-1, T-3 | V-2, V-3 |
| AC-3 | 프롬프트 전송 즉시 내 말풍선이 대화에 나타난다; blocked·실패 시 낙관 버블 없음(기존 안내 유지) | T-4 | V-3, V-4 |
| AC-4 | working 중 대화 꼬리에 진행 인디케이터가 뜨고 idle·blocked·done이면 없다 | T-4 | V-3, V-4 |
| AC-5 | 저장소 검증 전부 녹색 + 기존 라이브 흐름(연결→목록→대화→전송→키) 에뮬레이터 무결 | T-5 | V-5, V-6 |

## 설계

- **T-1 게이트웨이 conversation 파싱 캐시:** `agent-sessions.ts`(순수 leaf 유지)에
  파일 경로 키 소형 캐시 — 항목 `{mtimeMs, size, payload}`; `statSync`가 같으면 캐시
  반환, 다르면 재파싱 후 저장. cap 64, 초과 시 가장 오래된 항목 제거(클로즈업: claude
  kind별 파일 1개 + codex 롤아웃 다수). `resolveAgentConversation` 시그니처 무변경,
  wire 무변경. append는 mtime을 바꾸므로 틱 도중 stale 캐시 불가.
- **T-2 폰 refresh 병렬화·조건화:** readPane/conversation을 `Promise.all` 병렬.
  구조화 턴 뷰가 확정된 동안(마지막 fetch가 turns surface && segment chat) readPane
  생략; 터미널 세그먼트 진입·turns 미확정·conversation 실패 시에만 읽는다. segment는
  ref로 추횔해 콜백 deps 오염 방지, 세그먼트 전환 시 명시 1회 refresh.
- **T-3 유효 memo:** `herdr/conversation.ts`에 순수 `turnsEqual(a,b)`(요소별
  kind·id·text·title·detail·state 비교) 추가, `memo(ChatTurnRow, …)` 비교자로 사용.
  내용이 같은 새 객체는 스킵 → 스트리밍 중 바뀐 마지막 턴만 리렌더·재파싱.
- **T-4 지각 피드백:** (a) 낙관 유저 버블 — 전송 승인 시 pending 합성 턴을 로컬
  부착(`pending:<seq>`), 다음 fetch의 실제 user 턴과 trim 텍스트 일치 시 제거, 15초
  타임아웃 폴백; 병합 규칙은 순수 함수 `nextTurnsWithPending`으로 (단위 테스트).
  (b) working 인디케이터 — `ui/motion.tsx`에 `TypingDots`(PulseDot 계열, 조용한 3점)
  추가, turns 뷰 ListFooter에 `pane.status === "working"`일 때만 표시.
- **T-5 검증·관찰:** 아래 V-1~V-6. 라이브 스트리밍 표적은 이 머신의 실 herdr 세션
  (새 유료 호출 최소화 — 기존 세션 출력 스트리밍 관찰).

### 가정 로그 (기본값 결정과 기각된 대안)

- **A1 wire 무변경:** 증분 conversation API(turns since cursor)는 계약 변경 리스크가
  크고 캐시+memo로 목표 지연·규모 불변성이 달성되므로 하지 않는다. 필요 시 후속.
- **A2 Entrance 유지:** 세그먼트 재진입 시 전체 페이드인 재생은 명시적 사용자 동작
  직후 1회 피드백으로 판단해 유지(매 틱 재생이 진짜 결함이었고 그건 T-3으로 해소).
- **A3 낙관 버블 매칭:** 텍스트 일치 + 타임아웃 폴백. TURN_TEXT_CAP으로 잘린 긴 텍스트
  꼬리 일치 한계는 타임아웃이 흡수(최악: 버블이 실제 턴과 잠깐 병렬 표시).
- **A4 성능 수치 판정 금지 유지:** 에뮬레이터 절대 프레임 수치는 환경 한계로 판정
  불가(이전 V-5 전례) — 정성 관찰 + 단위 테스트 핀 + gfxinfo 참고용.

## 태스크

| ID | 목적·AC | 수정할 파일/경계 | 선행 | 검증 | 상태 |
|---|---|---|---|---|---|
| T-1 | 게이트웨이 conversation 파싱 캐시 (AC-2) | `packages/gateway/src/agent-sessions.ts`, `packages/gateway/test/agent-sessions-cache.test.ts`(신규) | 없음 | V-2 | done (G3 F-1 수정: 읽기 캐시 → **파싱 결과 캐시** SessionParseCache, 파싱 카운트 테스트로 핀) |
| T-2 | 폰 refresh 병렬화·조건화 (AC-1) | `apps/loop-mobile/src/screens/AgentScreen.tsx`, `herdr/conversation.ts`(planRefresh) | 없음 | V-1 | done (G3 F-2 수정: planRefresh 순수 계약 + 단위 테스트 4건) |
| T-3 | 턴 동등 비교로 유효 memo (AC-2) | `herdr/conversation.ts`, `AgentScreen.tsx`, `test/agent-conversation.test.ts` | 없음 | V-3 | done |
| T-4 | 낙관 버블 + working 인디케이터 (AC-3, AC-4) | `herdr/conversation.ts`, `AgentScreen.tsx`, `ui/motion.tsx`, `src/copy.ts`, 앱 테스트 | T-3 | V-3 | done (G3 F-4 수정: seen 스냅샷으로 재전송 조기 retire 차단, 1:1 소비) |
| T-5 | 통합 검증 + 에뮬레이터 라이브 관찰 기록 (AC-1, AC-5) | 문서/캡처(구현 파일 무변경) | T-1~T-4 | V-4~V-6 | done (G5 completion PASS, 2026-10-23 — 독립 평가자, F-V1~V3 장부 정리 수준) |

## G3 코드 리뷰 결함 처리 (독립 평가자, 2026-10-23)

- **F-1 [P1] 수정**: 1차 구현은 파일 읽기만 캐싱해 히트 시에도 줄 단위 JSON.parse 전체가
  매 틱 실행(2.8MB 기준 히트 호출 7~8ms 실측) → `SessionParseCache<T>`로 파싱 결과까지
  경로+stat 지문 캐싱. 4 reader(claude/codex cwd/codex/agy) 각각 전용 인스턴스, 캐시 항목
  64 + 64MB 소스 바이트 예산 FIFO. 파싱 카운터 테스트로 히트를 비용 단계에서 핀.
- **F-2 [P2] 수정**: refresh의 읽기 필요 여부를 순수 `planRefresh(segment, surface, force)`
  로 추출, 단위 테스트 4건(chat+turns 생략·터미널 전용·unknown/other 유지·강제 전환).
- **F-3 [P3] 수용·문서화**: cap을 계획의 64로 정렬하고 소스 바이트 예산 64MB 추가(축출은
  문서화된 트레이드오프 — codex 400 후보 스캔과의 상호작용은 기준선보다 나쁘지 않음).
- **F-4 [P3] 수정**: pending에 첨부 시점 user-turn id 스냅샷(`seen`)을 심어 재전송 텍스트가
  기존 기록과 매치돼 조기 소멸하는 경로 차단, 새 턴 1:1 소비 방식.

## 검증 계획과 결과

| ID | 방법 | cwd·환경 | 기대 결과 | 실제 결과 | 판정 |
|---|---|---|---|---|---|
| V-1 | 앱 단위: `planRefresh` 규약 테스트 + 병렬 페치 코드 검토 | apps/loop-mobile | 규약 녹색 | 4건 신규 포함 앱 224 pass, tsc 녹색 | PASS |
| V-2 | 게이트웨이 캐시 단위: 파싱 1회 핀(카운터), append·동일크기 재작성 미스, 부재 파일, cap 축출, 라우트 무stale (`bun test packages/gateway/test/agent-sessions-cache.test.ts`) | /home/loopy/dev/loop | 신규 5건 녹색 + 기존 surface 녹색 | gateway+cli+architecture 278 pass / 0 fail | PASS |
| V-3 | 앱 순수: `turnsEqual`·`mergePendingTurns`(seen 규약 포함) 단위 | apps/loop-mobile | 신규 테스트 녹색 | 앱 224 pass / 0 fail | PASS |
| V-4 | 에뮬레이터 라이브: 실 세션 스트리밍 관찰, 전송 즉시 버블, working 인디케이터, 캡처 | Android 에뮬레이터 + 이 머신 게이트웨이(herdr 0.9.5) | AC-1·AC-3·AC-4 관찰 | **AC-1**: 1.5s 간격 3프레임 해시 모두 상이·내용 진행·꼬리 고정(sdd-burst-1~3, sdd-live-02/12), 프롬프트→herdr→claude 응답→세션 파일→화면 라운드트립 확인(w6:p3 패인에 카운트 응답, 신규 세션 파일 1478bd6a에 기록). **AC-3**: 전송 버튼 탭 후 0.6s 캡처에서 흐린(0.7) 낙관 버블이 entrance 없이 꼬리에 즉시 렌더 + "전송됨" 공지(sdd-v4-04). **AC-4**: working 중 TypingDots(• • •) 3회 관찰(sdd-live-02, sdd-v4-04/06) | PASS |
| V-5 | 저장소 검증: codegen:check·lint·typecheck·architecture·cargo+bun | /home/loopy/dev/loop | 전부 녹색 | codegen:check·lint(기존 경고만)·앱 224/게이트웨이+cli+아키텍처 278 전부 녹색, cargo 녹색. **기존·환경 결함 기록**: (a) packages/cli daemon 테스트가 전체 스위트에서 매번 다른 조합으로 sqlite tmp 오류 — 기준선 stash 재현 확인(사전 존재 flake, 고립 실행 항상 녹색); (b) tests/install-local 1건·orchestrator/profile 1건이 특정 시점부터 이 머신에서 결정적 실패(브릿지 compute 후보 선택·node stderr) — diff 경로와 분리, 재빌드로 불변 | PASS (환경 결함 2건 기록, diff 무관 근거 첨부) |
| V-6 | 기존 흐름 회귀: 연결→Herd→대화→터미널 세그먼트→키→백 | 에뮬레이터 | 기존 동작 무결 | 재설치 후 자동 연결 복구 → Herd 목록 실시간 pill → 대화(구조화 턴) → 터미널 세그먼트(ANSI 미러 렌더, sdd-v6-01) → 대화 복귀 → esc·ctrl+c 전송 무오류 → 에이전트 정지 확인(w6:p3 done) | PASS |

## 라이브 관찰 발견 (이번 범위 밖 — 후속 제안)

- **새 에이전트의 대화가 cwd 최신 세션을 빌려온다**: 방금 시작한 빈 패인(w6:p3)의 대화가
  같은 cwd의 최신 claude 세션(사용자 활성 세션)을 렌더하고, herdr의 claude 시작이 그
  세션을 이어받는 동작(Resume)까지 확인 — 새 세션이 쓰이기 전까지 resolver의 cwd+mtime
  폴백이 최신 파일을 그대로 보여준다(`agent-sessions.ts` 헤더의 문서화된 폴백). 개인
  머신에선 편의로, 공유 머신에선 혼동 소지 — 대화 표시에 agent_session 키 우선순위 강화
  또는 빈 세션 안내 후보.
- **세그먼트 복귀 직후 목표 위치**: 대화→터미널→대화 복귀 직후 한 순간 목록 상단이
  보였다가 다음 갱신 틱에 꼬리로 정착(강제 refresh가 도착하기 전 0.5~1s) — 자가 치유.
- **RN Android IME 잔상**: `input text`+Enter로 전송해 composer 상태가 비워진 뒤 네이티브
  입력란에 텍스트 잔상이 남는 화면이 관찰됨(adb 입력 특수성 가능성) — 실기기 사용자 입력
  재현 여부 확인 필요(P3 후속).

## G3 재판정 (독립 평가자, 2026-10-23)

- **PASS** — F-1~F-4 전건 해소. F-1은 동일 합성 세션(2.8MB·16k 라인)에서 1차 호출
  21.4ms → 캐시 히트 평균 **0.02ms** 실측으로 AC-2 게이트웨이 반쪽 성립. F-2·F-4는
  규약·시나리오 테스트 핀 확인. 재실행 검증: gateway+cli+architecture 278 pass,
  앱 순수 39 pass, tsc 녹색.
- 잔여 P3 정보성 후속 3건(비차단): **R-1** 동일 텍스트 pending 복수 큐 시 retire
  캐스케이드 가능(표시 전용·자가 치유), **R-2** conversation null 상태 전송 시 seen=[]
  공백 에지, **R-3** bytes=text.length는 UTF-16 유닛 수(예산 rough bound, 주석 명시됨).

## G4 사용성·디자인 (self-review, 라이브 관찰 기반 — 독립성 한계 명시)

- **전송 흐름 완결**: 입력 → 전송 즉시 흐린 낙관 버블(entrance 없음, remount 시 재생 없음)
  + "전송됨" 공지 + working 인디케이터 → 실제 턴 도착 시 1:1 교체. 라이브 캡처로 관찰
  (sdd-v4-04). 실패·blocked 시 버블 없음(코드 경로 + 단위 테스트).
- **작업 중 피드백**: working일 때만 꼬리에 TypingDots(• • •, accessibilityLabel="에이전트
  작업 중"). idle/done 부재는 코드 조건으로 보장 — done 전환 직후의 대화 화면 캡처는 없음
  (관찰 한계).
- **모션 예산 준수**: 신규 애니메이션은 PulseDot 재사용(등록된 pulse 주기 동기, 네이티브
  드라이버 transform/opacity만) — JS 스레드 갱신과 충돌 없음. 버블 opacity 0.7은 유일한
  신규 시각 상태.
- **관찰된 한계(후속)**: 세그먼트 복귀 직후 ~1s 목표 위치 정착 지연(자가 치유), RN Android
  IME 잔상(adb 입력 특수성, 실기기 재확인 필요) — 계획 문서 "라이브 관찰 발견" 절.

## 평가와 인계

- G0 intake·G1 plan: validate-plan 해당 모드로 self-review (독립성 한계 명시).
- G3 코드 리뷰: 독립 서브에이전트(신규 컨텍스트)에 원 요청·계획·diff·검증 기록 전달.
- G4 사용성: V-4 관찰 기록으로 self-review(관찰 범위 명시).
- G5 completion: 독립 서브에이전트로 AC별 증거 대조.
- 커밋은 사용자 요청 시에만.
