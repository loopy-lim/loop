# 계획 — 대화 귀속 정확성과 낙관 버블 잔여 결함 정리 (실시간성 SDD 후속)

- **일자:** 2026-10-24
- **요청:** "/sdd 를 이용해서 지금까지 진행한 것들을 모두 마무리 해주고, 그 다음 해야할 것들을 무엇인지 찾아서 진행해주어야해." — 선행 3개 SDD(70b3994·b01eef6·ba78276·19bf5a1·feeea30로 커밋 완료)의 계획 문서에 기록된 후속 과제 중 코드로 검증 가능한 3건을 선정해 진행.
- **기준 리비전:** feea30c (main, clean)

## 목표와 범위

- ① 새로 시작한 에이전트 패인의 대화가, 패인이 아직 기록하지 않은 같은 cwd의 최신
  세션 파일(사용자 활성 세션 포함)을 빌려 렌더하는 귀속 결함 — 실시간성 SDD
  "라이브 관찰 발견"에서 후속으로 남긴 것.
- ② (R-1) 동일 텍스트 pending 복수 큐 시 소비가 틱 사이에 지속되지 않아 같은 실제
  턴이 둘 이상의 pending을 연쇄 은퇴시킬 수 있는 표시 결함.
- ③ (R-2) conversation이 아직 없을 때(seen=[]) 첨부된 pending이 첨부 이전의 동일
  텍스트 기존 턴에 의해 조기 소멸하는 에지.
- **제외:** agy 폴백 하한(작성 시각 의미 부재 — 가정 로그 A2), herdr claude Resume
  동작 자체(외부 프로세스), wire 계약 변경, 커밋(사용자 요청 시 별도).

### 확인한 사실 (조사 근거, 실제 경로)

- claude 폴백: 세션 핀(kind "id")이 있어도 파일이 없으면 cwd 최신 .jsonl로
  빠진다(`packages/gateway/src/agent-sessions.ts:313-317`). 앱이 시작한 에이전트
  (`claude-<slug>`)는 `loop-` 접두사가 아니라 `HerdrAgentSessionRegistrar`가
  등기하지 않고, 이 호스트엔 herdr pi 통합이 없어 **핀이 영원히 없다**
  (`herdr-agent-session.ts:34,120-121`) → cwd 최신 폴백이 수명 내내 적용된다.
- herdr의 claude 시작은 cwd 최신 세션을 Resume한다(실시간성 SDD 라이브 관찰) —
  첫 프롬프트 **후**에는 그 파일이 실제로 패인의 세션이 된다. 결함은 첫 기록
  **전** 창이다.
- herdr 원본 패인 필드에 시작 시각이 없다(`herdr-pane-source.ts:1159-1180`
  mapPane — 시간 필드 부재, `herdr api schema --json`에서도 pane 타임스탬프 미확인).
- 대화 라우트는 `resolveAgentConversation(pane.agent, pane.cwd, undefined,
  pane.agentSession)` + foregroundCwd 폴백(`server.ts:755-769`). 시작 오케스트레이션
  `startInPane`이 같은 파일에 있다.
- 앱 병합: `mergePendingTurns`는 fresh(=seen에 없는) user 턴을 텍스트 근접로 1:1
  소비하지만, 소비 사실이 남은 pending의 seen에 흡수되지 않는다
  (`apps/loop-mobile/src/herdr/conversation.ts:113-141`). 첨부 시 seen은
  `seenUserIds(conversationRef.current)` — conversation이 null이면 `[]`
  (`AgentScreen.tsx:177-181`). 15초 타임아웃 폴백 존재(`AgentScreen.tsx:71`).
- 검증 명령: `bun test packages/gateway/test/agent-sessions-cache.test.ts
  packages/gateway/test/herdr-surface.test.ts`, `cd apps/loop-mobile && bun test
  test/agent-conversation.test.ts`, 루트 `bun run check`.

## 수락 기준

| ID | 관찰할 결과와 적용 조건 | 담당 태스크 | 검증 ID |
|---|---|---|---|
| AC-1 | 게이트웨이가 이 프로세스에서 시작한 에이전트 패인의 대화 라우트는, 패인 시작 시각 이전에 마지막으로 쓰인 cwd 세션 파일을 폴백으로 돌려주지 않는다(404 — 앱은 기존 ANSI 폴백 유지). 시작 기록이 없는 패인(게이트웨이 재시작 후 발견된 패인)은 기존 동작을 유지하고, 세션 핀 경로는 하한의 영향을 받지 않는다 | T-1 | V-1 |
| AC-2 | 동일 텍스트 pending이 여러 개일 때 한 개의 새 user 턴은 정확히 한 개의 pending만 은퇴시키고, 그 소비가 이후 페치에서 다른 pending의 같은 턴 재소비로 이어지지 않는다(seen 흡수가 틱 간 지속) | T-2 | V-2 |
| AC-3 | 대화가 아직 없을 때(seen=[]) 첨부된 pending은 첨부 시각보다 오래된 타임스탬프의 기존 턴에 의해 은퇴하지 않는다(at이 없는 턴은 시간 판정 불가 — seen 가드만 적용, 문서화) | T-2 | V-2 |
| AC-4 | 저장소 검증 녹색(gateway·앱·아키텍처·typecheck·lint), 기존 실시간성 규약(F-4 재전송 차단, one-for-one)은 계약 확장에 맞게 갱신된 형태로 유지 | T-3 | V-3, V-4 |

## 설계

- **T-1 게이트웨이 폴백 하한:** `herdr-pane-source.ts`에 모듈 수준 출생 기록
  `notePaneBirth(paneId, atMs)`/`paneBirthMs(paneId)`(메모리 Map, 상한 1024 FIFO —
  게이트웨이 수명 내 패인 수는 소수). `server.ts` `startInPane` 성공 경로에서
  기록. `agent-sessions.ts` `resolveAgentConversation`에 `fallbackFloorMs?` 추가 —
  claude는 cwd 최신 파일 선택 **후** mtime이 하한 미만이면 null, codex는 폴백 스캔
  후보를 mtime으로 걸러냄(newestCodexRollouts가 이미 계산한 at 재사용 — 추가 stat
  없음). **세션 핀 경로는 하한 무관**(herdr가 보고한 패인 자신의 세션이므로).
  agy는 미적용(A2).
- **T-2 앱 병합 계약:** `PendingPrompt`에 `attachedAt`(첨부 시각 epoch ms) 추가.
  `mergePendingTurns` 반환을 `remaining: PendingPrompt[]`로 확장 — (a) 소비된 턴
  id를 남은 pending의 seen에 흡수해 반환(재소비 차단), (b) fresh 턴 자격에 시간
  하한 추가: `at === null || Date.parse(at) >= attachedAt - SKEW_MS`(SKEW 90초 —
  폰 시계 대비 호스트 타임스탬프 오차 여유, 최악 시 타임아웃 15초가 흡수).
  `pendingSame(a,b)` 순수 비교자 추가 — AgentScreen 은퇴 효과가 내용 동일 시
  상태를 건드리지 않게 해 무한 재계산 루프를 막는다.
- **T-3 검증:** 아래 V-1~V-4. 라이브 에뮬레이터 관찰은 이번 결함이 단위·라우트
  규약으로 핀 가능한 타이밍·귀속 로직이라 생략하고 그 한계를 G4에 명시한다.

### 가정 로그 (기본값 결정과 기각된 대안)

- **A1 출생 기록은 프로세스 메모리:** sqlite 영속(loop-store 브릿지 변경+codegen)
  은 결함 규모에 과함. 결함 창(앱에서 새 에이전트 시작 직후)은 항상 같은 게이트웨이
  프로세스 수명 안이다. 재시작 후엔 기존 동작(폴백)으로 되돌아가는데, 그때 패인은
  이미 세션이 형성됐을 공산이 크다. 기각: DB 영속.
- **A2 agy 하한 미적용:** transcript 파일명/DB last_modified_time의 작성 시각
  의미가 불명확하고 cwd 폴백 대여의 라이브 증거도 없다. 무기한 은폐가 아니라 후속
  기록 — agy 대여 재현 시 별도 근거로 확장.
- **A3 attachedAt는 폰 시계:** 90초 스크 여유. 스크가 크면(폰 시계가 호스트보다
  앞) 새 턴이 하한 미만이 되어 매치가 지연되고 타임아웃(15초)이 흡수한다 — 기존
  동작 이하로 나빠지지 않음.
- **A4 mergePendingTurns 반환 계약 변경:** 호출처는 AgentScreen 1곳+테스트뿐.
  wire 무변경. string[] 유지 + 별도 consumed 출력 대안은 두 출력의 동기화 부담으로
  기각.
- **A5 at === null 턴은 seen 가드만:** claude/codex/agy 파서는 타임스탬프 있는
  기록에서만 at을 채운다. seen=[]+at=null 조합의 오소비는 이론적 에지로 문서화.

## 태스크

| ID | 목적·AC | 수정할 파일/경계 | 선행 | 검증 | 상태 |
|---|---|---|---|---|---|
| T-1 | 게이트웨이 폴백 하한 — 출생 기록·해석·라우트 연결 (AC-1) | `packages/gateway/src/herdr-pane-source.ts`, `agent-sessions.ts`, `server.ts`, `test/agent-sessions-cache.test.ts`, `test/herdr-surface.test.ts` | 없음 | V-1 | done |
| T-2 | 앱 병합 계약 — seen 흡수·첨부 하한 (AC-2, AC-3) | `apps/loop-mobile/src/herdr/conversation.ts`, `src/screens/AgentScreen.tsx`, `test/agent-conversation.test.ts` | 없음 | V-2 | done |
| T-3 | 통합 검증 (AC-4) | repo 무변경 | T-1, T-2 | V-3, V-4 | done |

## 검증 계획

| ID | 방법 | cwd·환경 | 기대 결과 | 실제 결과 | 판정 |
|---|---|---|---|---|---|
| V-1 | `bun test packages/gateway/test/agent-sessions-cache.test.ts packages/gateway/test/herdr-surface.test.ts` — 신규: claude 폴백이 하한 이전 파일 거부/이후 파일 허용/하한 없으면 기존 동작/핀 경로 무영향, codex 후보 필터, 라우트가 출생 기록 패인의 구세션 404·무기록 패인 기존 동작 | /home/loopy/dev/loop | 신규+기존 전부 녹색 | 신규 7건(claude 4·codex 1·라우트 2) 포함 **34 pass / 0 fail** | PASS |
| V-2 | `cd apps/loop-mobile && bun test test/agent-conversation.test.ts` — 신규: 소비 지속(재소비 차단), seen=[]+구타임스탬프 차단, 하한 이후 턴 허용, at=null 허용; 기존 F-4·one-for-one 갱신 유지 | apps/loop-mobile | 신규+기존 녹색 | 신규 8건(merge 5+pendingSame 3) 포함 **29 pass / 0 fail**, `tsc` 녹색. 앱 전체 231 pass / 0 fail | PASS |
| V-3 | 루트 `bun run check` + cargo | /home/loopy/dev/loop | 문서화된 기준선(orchestrator/profile 1건 환경 결함)과 동등 이상 | codegen·lint·typecheck·architecture·cargo 녹색, bun **1051 pass / 1 fail** — 실패 1건은 기준선 환경 결함(orchestrator/profile "no eligible compute candidate", 변경 전 재현 확인) | PASS |
| V-4 | G3 독립 리뷰 — Agent 위임(신규 컨텍스트, 원 요청·계획·diff·검증 기록 전달) | — | P0/P1 없음 | 독립 평가자가 검증을 직접 재실행(V-1 34/0·V-2 29/0 일치, V-3 재실행 1049/3 — 실패 3건 전부 diff 무관 환경 결함으로 격리 재실행·node 부재 확인·문서 기록으로 입증)하고 소스를 직접 대조. **PASS — P0/P1/P2 없음**, P3 정보성 3건(아래 G3 절) | PASS |

## G3 코드 리뷰 (독립 평가자, 2026-10-24)

- **PASS** — AC-1~3 소스 직접 대조(핀 경로 하한 무영향·codex at 재사용·무기록 패인 기존 동작), 은퇴 효과 수렴 추적으로 무한 루프 부재 확인, utimesSync 테스트의 결정성 확인, 경계 위반 없음(Rust 0건·wire 무변경).
- 평가자의 V-3 재실행은 1049 pass / 3 fail — 작성자 실행(1051/1)과 실패 조합이 다른데, 전부 문서화된 환경 결함 클래스의 실행별 변동: ① orchestrator/profile(결정적), ② install-local(이 머신에 node 바이너리 부재 — 직접 확인), ③ cli detached(고립 실행 녹색 — 기록된 daemon flake). 변경 영역 스위트는 동일 녹색.
- 잔여 P3 정보성 3건(비차단, 후속 기록): **F-1** 출생 기록이 start 성공 응답 직후 Date.now()라 에이전트가 응답 전에 첫 기록을 쓰면 일시 거부되는 이론 창(현재 claude는 첫 프롬프트까지 쓰지 않음, 자가 치유), **F-2** 같은 패인에 에이전트 재시작 시 이전 런 대화가 첫 프롬프트까지 ANSI 폴백(birth 덮어써짐 — AC-1의 정합한 귀결, Resume 후 자가 회복. 재관찰 시 기록할 것), **F-3** birth Map 재기록이 축출 순서를 갱신하지 않음(cap 1024에서 실도달 불가).

## G4 사용성·디자인 (self-review, 독립성 한계 명시)

- 변경은 은퇴 타이밍·귀속 정확성만 건드린다 — 시각 상태·모션·레이아웃 무변경.
  버블 표시 경로(흐린 낙관 버블·entrance 없음·15초 타임아웃·TypingDots)는
  실시간성 SDD의 라이브 관찰 증거(feeea30c 계획 문서 V-4)를 그대로 상속한다.
- 사용자 관찰 동작의 개선: 같은 세션 대여 화면(새 패인에서 남의 세션이 보이던
  것)이 사라지고, 15초 내 실제 기록이 오기 전까지는 패인의 실제 터미널 출력
  (ANSI 폴백)이 표시된다 — 허위 내용 대신 참 내용.
- **한계:** 이번 효과(귀속 거부·재소비 차단·하한)는 라이브 에뮬레이터에서
  재관찰하지 않았다 — 단위·라우트 규약 테스트가 유일한 신규 증거다. 라이브
  재관찰은 다음 에뮬레이터 검증 회차에서 함께 수행할 것.

## 평가와 인계

- G0 intake·G1 plan: validate-plan 해당 모드 self-review (독립성 한계 명시).
- G3 코드 리뷰: 독립 서브에이전트(신규 컨텍스트) — **PASS** (P3 정보성 3건 기록).
- G4: self-review(라이브 미관찰 한계 명시).
- G5 completion: 독립 서브에이전트 — **PASS** (2026-10-24). 평가자가 최종 상태에서
  V-1(34/0)·V-2(29/0, 앱 전체 231/0)·V-3(1051/1)을 직접 재실행해 AC 전부 PASS,
  stale 증거 없음을 확인. 정보성: 제외 항목은 기원 문서에 분산 돼 있으나 누락
  없음, 실기기·에뮬레이터 관찰과 푸시는 범위 밖.
- 커밋: 사용자 목표("…모두 마무리…진행")의 마무리 지시에 따라 본 SDD 산출물도
  1개 커밋으로 생성(푸시 없음).
