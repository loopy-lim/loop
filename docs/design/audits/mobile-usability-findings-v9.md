# loop-mobile 사용성 감사 — 어휘·흐름·인체공학 결과 (v9)

- **작업:** `research` (loop-mobile 사용성 감사, 코드 변경 없음)
- **검사 대상:** `apps/loop-mobile/src/**` (70파일, 약 10.7k 줄) 전수 정적 검토
- **선결 문서:** [`mobile-design-audit-v9.md`](mobile-design-audit-v9.md) (구조·토큰 감사) · 승인 카피 2건 (New TUI session→New task, Submit response→Reply)
- **방법 한계(먼저 읽을 것):** 이 감사는 **코드 기반 정적 검토**다. v9 디자인 감사와 동일하게 스크린샷을 눈으로 보지 못했으므로, 동선·인체공학 판정은 파일:줄 근거의 레이아웃 속성(터치 하한·inset·위치)으로 대체했다. 실렌더 체감은 vision 가능 세션의 재검토가 남는다.

---

## 요약

**종판정: 터치 인체공학과 상태 정직성은 이미 통과 수준이다. 남은 사용성 결함은 3종류다 — (1) attention 응답 입력이 대화 흐름 밖(Files 탭의 run 상세)에만 존재하는 동선 단절, (2) `run`·`submit`·`pane`·`projection`·`steer` 등 내부 구현 용어의 사용자 노출, (3) v9 P1의 react-doctor error 11건이 스크롤·제스처·복사라는 고빈도 동작의 품질로 직결되는 것.**

| 축 | 판정 | 요지 |
| --- | --- | --- |
| 터치 인체공학 | 양호 | send/attach 44pt, 헤더 컨트롤 44pt, 탭 44pt, FAB 56pt, remove 20pt+hitSlop — 전 표면 하한 유지 (§흐름 6) |
| 키보드 흐름 | 양호(틈 2건) | KeyboardAvoidingView 3화면 + inset 핸드오프 정확. 타임라인 스크롤 시 키보드 잔류, 컴포저 5줄 캡 확장 수단 없음 (U-9) |
| 빈·로딩·오류 상태 | 대체로 양호 | 대화·목록·파일 뷰어의 빈 상태는 "무엇이 비었나+다음 행동" 충실. 오류 문자열 5곳이 원문 덤프 (U-4) |
| 동선(IA) | **결함 1건** | attention 응답은 Files 탭 → run 상_detail에서만 가능. Chats의 attention 행을 탭하면 대답할 수 없는 대화 화면이 열린다 (U-1) |
| 어휘 | **결함 다수** | `run`/`submit`/`pane`/`projection`/`wire budget`/`lifecycle`/`steer` 상태 단어/원시 상태 enum이 사용자 표면에 노출 (§어휘) |
| 렌더 품질 (v9 P1 계승) | 미해소 | react-doctor error 11건 — onScroll setState ×2, ref-in-render ×4, Clipboard 제거 등 현 코드에서 재확인 (U-2) |

승인된 카피 2건(`Submit response`→`Reply`, `New TUI session`→`New task`)은 §해소안에 기계적 변경으로 접수했다. IA 재구성(Files 탭 흡수, 탭 축소)은 이 문서의 **DP 제안으로만 기록**하며 구현하지 않는다.

---

## 흐름 분석

### 1. 연결 흐름 (launch → connect)

- 복원: `App.tsx:216-240` — 기동 1회 restore, 성공 시 즉시 connected, 실패 시 수동 화면 + notice. 흐름 자체는 정직하다.
- 복원 중 표시: `App.tsx:351-355` `"Restoring connection…"` 한 줄 — 진행 표시로 충분.
- 수동 연결: `ConnectScreen.tsx:80-165` — host/port/token 3필드 + Connect CTA + QR 보조 입구. 오류는 폼 아래 caption.
- **결함 (U-11):** `ConnectScreen.tsx:26` `DEFAULT_GATEWAY_HOST = "loopy-macbookpro.tail42f248.ts.net"` — 특정 운영자의 tailnet 호스트가 소스에 하드코딩되어 모든 신규 설치의 기본값이 된다. 다른 사용자에게는 무의미한 값이 첫 화면을 채우고, 운영자 인프라 이름이 앱 바이너리에 새어 나간다.
- 연결 실패 notice는 부모가 `describeConnectFailure`로 형식화한다 (`App.tsx:139-142`) — 이 표면은 양호. 단 폼 자체 검증 오류는 `e.message` 원문 (`ConnectScreen.tsx:96-98`, U-4 묶음).

### 2. Chats 목록 (홈)

- 구성: 프롬프트 카드 + 3섹션 목록 + spawn FAB (`SubmitScreen.tsx:80-126`, `run-list.tsx:275-330`). 상태 없는 홈, 파괴적 컨트롤 부재 — 설계 의도대로 조용하다.
- 로딩: `run-list.tsx:180-190, 309-315` — 초기 로딩도 RefreshControl 스피너로만 표시된다. 스피너는 손을 끌어야 보이는 위치라, 첫 진입 시 "목록이 비었는지 로딩 중인지" 구분이 안 서는 짧은 공백이 있다 (U-10).
- 오류: `run-list.tsx:312` `runs list: {error}` — 내부 접두어 + 원문 오류 덤프 (U-4).
- 빈 상태 2종: `run-list.tsx:313-321` — 아예 없음(`EMPTY_RUNS_NOTICE`)/있는데 진행 중 없음(`EMPTY_ACTIVE_NOTICE`) 구분. 정직하고 양호.
- 스와이프: `run-list.tsx:191-201` — 첫 행이 살짝 열린 채 마운트(peek)되어 제스처가 발견 가능하다. 양호.

### 3. 런 상세 — 두 갈래 동선 (이 감사의 핵심 결함)

- 갈래 A: Chats 행 탭 → `ConversationScreen` (`App.tsx:416-441`). 대화 타임라인 + 컴포저. 진행 중 전송은 steer로 라우팅 (`ConversationScreen.tsx:337-352`).
- 갈래 B: Files 탭 → `RunSplitScreen` → `RunScreen` (`App.tsx:372-391`, `RunSplitScreen.tsx:43-60`). 상태·counts·**attention 응답 카드**·출력·터미널 목록.
- **결함 (U-1):** attention 응답 입력(`TextInput` + `Submit response` CTA)은 `RunScreen.tsx:223-266`에만 존재한다. Chats 목록의 attention 행(warn 엣지, `run-list.tsx:221`)을 탭하면 열리는 것은 갈래 A의 대화 화면이고, 그 화면 어디에도 attention 질문이 렌더되지 않는다 (`ConversationScreen.tsx` 전체에 attention 카드 없음 — 컴포저 steer 전송만 가능). 즉 **"질문이 왔다"는 신호를 준 표면에서 대답할 수 없고**, Files 탭 → 트리에서 run 선택이라는 탭 2회+모드 전환을 요구한다. 완료 요약의 안내문조차 `RUN_SUMMARY_HINT` "Continue this task from its chat in the Chats tab." (`copy.ts:44`, `RunScreen.tsx:292`)로 Chats를 가리켜, 응답 표면의 위치와 어긋난다.
- run 상세 화면 자체의 위계는 양호: 인간 언어 제목 + 조용한 id caption (`RunScreen.tsx:205-213`), 완료 시 빈 화면 대신 요약 카드 (`RunScreen.tsx:268-292`).

### 4. attention 응답 흐름 (갈래 B 내부)

- 카드: warn 좌엣지 + 질문 원문 + 48pt 다중줄 입력 + 흰 CTA (`RunScreen.tsx:217-266`). 시각 위계·강조 예산 준수.
- 응답 후 `resolvedAttentionId`로 카드 즉시 제거 (`RunScreen.tsx:81, 257`) — 낙관 반영 양호.
- 오류: `RunScreen.tsx:263` `resolveError` 원문 렌더 (U-4).
- 전송 중 라벨 `SUBMITTING_LABEL` (`RunScreen.tsx:260`) — 승인 카피 변경과 함께 아래 §해소안으로 정리.

### 5. 빈·로딩·오류 흐름 (대화·터미널·파일)

- 대화: 대기/재접속/종료 3종 notice가 종류별로 색 온도를 조절한다 (`ConversationScreen.tsx:558-571`, `copy.ts:22-29`). 스트림 단절도 한 줄 요약으로 낮춰 렌더 (`ConversationScreen.tsx:573-575`). 양호.
- 빈 타임라인: `ConversationScreen.tsx:700-712` — "무엇이 비었나 + 다음 행동" 충실 (C9).
- Raw 모드 터미널 목록: `ConversationScreen.tsx:772-796` — 로딩/빈 상태가 있으나 **인라인 소문자 리터럴** `"loading terminals…"`(774), `"No terminals observed."`(777). `copy.ts:31-32`의 소유 상수 `NO_PANES_NOTICE`/`PANE_LOADING_NOTICE`는 **미사용** (U-8).
- 터미널 상세(PaneScreen): 알림 4종이 모두 운영자 어휘다 — `"screen-buffer snapshots — not a lossless transcript"`, `"lifecycle only — this pane has no streaming source"`, `"not observed — pane is above the gateway observation cap"`, `"pane closed — worker lifetime ended"` (`terminalLayout.ts:46-49`). 상태의 정직성은 모범적이지만 단어 선택이 구현 관점이다 (§어휘).
- 파일 뷰어: 오류 지도 6종이 모두 인간 문장 ("Not found — the run may not have written it yet." 등, `file-viewer.tsx:39-45`). 전 표면 중 가장 좋은 오류 카피.

### 6. 키보드·컴포저 인체공학

- 회피: `KeyboardAvoidingView behavior="padding"` 3화면 (`SubmitScreen.tsx:80`, `ConversationScreen.tsx:566`, `ConnectScreen.tsx:80`).
- inset 핸드오프: 키보드 상승 시 홈 인디케이터 여백을 양도 (`ConversationScreen.tsx:748-750`, `composer.tsx:38-40`) — 하단 이중 여백 없음. 정확.
- 터치 하한: send 44×44 (`composer.tsx:243-249`), attach 44×44 (`composer.tsx:219-226`), 첨부 remove 20pt+비대칭 hitSlop (`composer.tsx:72-77`), Resend caption+hitSlop≈45pt (`composer.tsx:148-153`). 전부 기록된 근거와 일치.
- **틈 (U-9a):** 대화 타임라인 `ScrollView`에 `keyboardDismissMode` 미설정 (`ConversationScreen.tsx:654-660`) — 긴 읽기를 위해 스크롤해도 키보드가 내려오지 않아 화면 절반이 가려진 채 남는다.
- **틈 (U-9b):** 컴포저 입력 `maxHeight: 120` (`composer.tsx:237`) — 약 5줄에서 내부 스크롤로 전환되는데, 늘리는 수단이 없다. 긴 프롬프트는 캡 안쪽만 보인다.
- attention 입력도 48pt 다중줄로 동일 맥락 (`RunScreen.tsx:231-238, 350`).

### 7. 손 도달성

- 우하단 동작군: spawn FAB 56pt (`spawn-fab.tsx:159-172`), 점프 pill 우하단 44pt (`ConversationScreen.tsx:871-886`), send 버튼 우하단 — 엄지 도달 최적 위치에 고빈도 동작 배치. 양호.
- 탭 바: `minHeight: 44` + 하단 inset (`TabBar.tsx:62-79`). 양호.
- 상단: back 셰브론·햄버거 44pt (`App.tsx:545-548`, `ConversationScreen.tsx:813-818`) — 표준 iOS 위치라 수용.
- 뒤로 가기: 헤더 셰브론 + 좌단 스와이프가 같은 핸들러 (`ConversationScreen.tsx:764-770`) — 한 동사 두 경로. 양호.
- **트레이드오프 (U-12):** 시스템 상태바 전면 숨김 (`App.tsx:530` `<StatusBar hidden />`) — 시간·배터리를 앱 어디에서도 볼 수 없다. 헤더가 상태바 대체라는 설계 결정의 대가로, 장시간 사용 시 확인 불가 구간이 생긴다. DP-U6으로 판단 접수.
- 예외 하나: 드로어는 헤더 햄버거로만 열리는데 Chats 홈은 헤더가 없어 햄버거가 없다 (`App.tsx:458-475`). 단 홈에는 탭 바 3목적지가 전부 있으므로 대체 경로가 존재 — 결함 아님, 기록용.

---

## 어휘 전수 조사

`ui/copy.ts` 상수 + 화면 인라인 문자열 전체에서 내부 구현 용어 노출을 조사했다. **굵게** 표시한 것이 사용자가 알 필요가 없는 구현 용어다.

### copy.ts 상수 (소유 표면)

| 상수 / 위치 | 현재 문자열 | 문제 용어 | 대체안 (사용자 언어) |
| --- | --- | --- | --- |
| `SUBMIT_RESPONSE_LABEL` `copy.ts:47` | "Submit response" | **submit** + 기능명 | 승인: **"Reply"** |
| `SPAWN_TUI_LABEL` `copy.ts:139` | "New TUI session" | **TUI session** | 승인: **"New task"** |
| `SPAWN_TUI_SPAWNING` `copy.ts:140` | "Opening a new pi TUI on the host…" | **pi TUI, host** | "Opening a new task on your computer…" |
| `SPAWN_TUI_FAILED_PREFIX` `copy.ts:151` | "Spawn failed — " | **spawn** | "Couldn't open a new task — " |
| `SPAWN_TUI_BLOCKED` `copy.ts:149` | "Spawning is turned off on this gateway — ask the operator to enable it." | **spawning, gateway, operator** | "New tasks are turned off for this connection — ask the owner to enable them." |
| `WAITING_FOR_PROJECTION_NOTICE` `copy.ts:30` | "Waiting for run projection…" | **run projection** | "Getting this task ready…" |
| `TRUNCATED_NOTICE` `copy.ts:10` | "…(truncated — gateway wire budget)" | **gateway wire budget** | "…(truncated)" — 절단 사실만 |
| `EMPTY_RUNS_NOTICE` `copy.ts:100` | "No runs yet — submit a prompt to start one." | **runs, submit, prompt** | "No tasks yet — describe one below to start." |
| `NO_PANES_NOTICE` / `PANE_LOADING_NOTICE` `copy.ts:31-32` | "No terminals are available." / "Loading terminals…" | **panes** (상수명만, 문자열은 terminal) | 미사용 상수 — U-8에서 인라인 흡수 |
| `LIFECYCLE_ONLY_SUFFIX` `copy.ts:35` | " (lifecycle only)" | **lifecycle** | " (status only)" 또는 제거 |
| `TERMINAL_SUFFIX` `copy.ts:51` | " (terminal)" | **terminal** (허용 가능 경계) | 유지 — 파일/터미널은 실재하는 사용자 대상물 |
| `STEER_MARK_LABEL` `copy.ts:58` | "steer" | **steer** (내부 라우팅 개념) | "steering"로 진행형 표기 또는 "Replying while it works" — DP-U2 |
| `SUBMITTING_LABEL` `copy.ts:46` | "Submitting…" | **submit** | "Sending…" |
| `RUN_SUMMARY_HINT` `copy.ts:44` | "Continue this task from its chat in the Chats tab." | 없음 (단, U-1 동선과 불일치) | attention 통합 여부에 맞춰 재작성 |

### 화면 인라인 (소유 위반 포함)

| 위치 | 노출 | 문제 | 대체안 |
| --- | --- | --- | --- |
| `RunScreen.tsx:210` | `{run.status}` — `planning/running/attention/completed/failed/cancelled` 원시 enum | **내부 상태 enum 그대로** | 표시어 테이블 1장 ("Working…" / "Needs your reply" / "Done" / "Failed" / "Cancelled") |
| `RunScreen.tsx:198` | `Stream: {streamError}` | **전송 계층 원문 덤프**, C10 위반 | `STREAM_DISCONNECTED_NOTICE` 재사용 |
| `RunScreen.tsx:263` | `{resolveError}` 원문 | 오류 덤프 | "Couldn't send the reply — try again." + 재시도 |
| `RunScreen.tsx:211` + `run-list.tsx:60-71` | countsText "2 pending, 1 running, 3 attention…" | **pending/attention 등 작업 상태 내부어** | "1 working · 3 need reply" 식 축약 지도 |
| `RunScreen.tsx:285` | "reconnecting — recent output may be incomplete" 인라인 | copy.ts 소유 위반 (§7) | 상수화 |
| `ConversationScreen.tsx:618` | 토글 "Raw" / "Chat" | **Raw**(원시 시점 노출) | "Terminal" / "Chat" — 목적지명 |
| `ConversationScreen.tsx:774, 777` | "loading terminals…" / "No terminals observed." 인라인 | 소유 위반 + 대소문자 불일치 | copy.ts 상수로 |
| `ConversationScreen.tsx:790` / `RunScreen.tsx:299` | `" (lifecycle only)"` 인라인 중복 | **lifecycle** + 소유 위반 | 상수화 + 대체어 |
| `SubmitScreen.tsx:107` | "Submitting…" / "Submit" 인라인 | **submit**, 소유 위반 | "Sending…" / "Send" (신규 프롬프트 전송이므로) |
| `SubmitScreen.tsx:57, 72` | `"submit failed"` + `e.message` | 오류 덤프 | "Couldn't send — your draft is kept. Try again." |
| `composer.tsx:128` | "Steer the running task…" | **steer, running** | "Reply while it's working…" |
| `conversation-timeline.tsx:41-43` | 툴카드 상태 "running…/done/error" | 허용 경계 (색+글리프 병행) | 유지 |
| `conversation-timeline.tsx:47-51` | steer 상태 "pending/queued/delivered" | **메일박스 내부 상태** | 아이콘만 또는 "sending/sent" 2종으로 축소 |
| `conversation-timeline.tsx:88-89, 112-115` | `{toolName}`, `args: {argsJson}` 원문 | **도구·인자 원문** (펼칠 때만이라도) | 요약은 유지, `args:` 접두어 제거 + mono 유지 |
| `terminalLayout.ts:46-49` | pane 알림 4종 | **screen-buffer/observation cap/worker lifetime** | "This terminal shows recent screen contents only." 수준으로 |
| `session-title.ts:17, 89-91` | "새 세션", 배지 "TUI"/"앱" | **한영 혼용 + TUI** | 언어 정책 수립 후 일괄 (DP-U3) |
| `time-format.ts:53, 62` | "방금", "어제" | 한영 혼용 (UI 나머지는 영어) | "just now", "Yesterday" 또는 전면 한국어 |
| `QRScannerScreen.tsx:113` | "Point at the loop://connect QR code" | **URL 스킴** (동작 가능하므로 경계) | "Point at the pairing QR code" |
| `ConnectScreen.tsx:139, 146` | "TOKEN — FALLBACK ONLY", "empty = tokenless" | **fallback/tokenless** | "Token (optional)" + note 한 문장 |
| `run-list.tsx:312` | "runs list: {error}" | **접두어 + 덤프** | "Couldn't load the list — pull to retry." |
| `ConnectScreen.tsx:26` | 기본 host 하드코딩 | 운영자 인프라명 노출 | 기본값 공백 + placeholder |

### 언어 혼용 요약

사용자 표면의 조사 기준: copy.ts·화면 라벨은 영어, 상대시간(`방금`/`어제`)·세션 폴백 제목(`새 세션`)·소스 배지(`앱`)만 한국어. 한 화면 안에서 `"3 attention"`과 `어제`가 나란히 등장할 수 있다 (`run-list.tsx:67, 219` + `session-title.ts`). 언어 단일화는 전면 결정이므로 DP-U3.

---

## 우선순위 결과

### P1 — 다음 구현 런에 포함

**U-1. attention 응답 표면 단절 (동선 결함)**
- 근거: §흐름 3 — 응답 입력은 `RunScreen.tsx:223-266`에만 존재, Chats attention 행은 `ConversationScreen`(질문 부재)을 연다 (`App.tsx:416-441`, `run-list.tsx:221`).
- 해소 경합: 기계적 해소는 "attention 카드를 ConversationScreen에도 렌더"이지만 이는 run 상태 구독을 대화 화면에 추가하는 구조 변경이라 소규모가 아니다. 표면 재배치(Files 탭 흡수 포함)는 DP-U1로 제품 결정 접수. **단기 완화(기계적):** attention 행 탭 시 열리는 화면의 헤더 하단에 질문 요약 + Files 안내를 붙이는 것은 copy 수준으로 가능하나, U-1 자체의 해소는 DP-U1 판정 후로 미룬다.

**U-2. react-doctor v9 P1 error 11건 — 사용자 체감 직결분 (v9 F-2 계승, 현 코드 재확인)**
- 근거: 스크롤마다 setState — `ConversationScreen.tsx:317-325`, `PaneScreen.tsx:96-105` (jump pill/paused 표시 갱신이 프레임 리렌더 유발, 최대 빈도 스크롤 표면). render 중 ref 대입 ×4 — `ConversationScreen.tsx:185`, `ui/BackSwipeZone.tsx:24-25`, `ui/DrawerMenu.tsx:42-43`, `ui/SwipeableRow.tsx`(ActiveSwipeableRow) — 제스처 표면의 상태 불일치 씨앗. `Clipboard` 폐기 모듈 — `features/markdown-view.tsx:8, 72` (Copy code 버튼 환경에 따라 무응답 = 사용자 관점 "눌러도 되지 않는 버튼").
- 해소안: §해소안 표. v9 F-2의 순서(스크롤 2건 → cleanup → ref 4건 → Clipboard → unused)를 그대로 따른다.

**U-3. 상태 단어 이중·삼중 노출 (v9 F-4의 현 코드 확장)**
- 근거: run 상_detail — `run.status` 단어(`RunScreen.tsx:210`)와 countsText의 "N running"(`RunScreen.tsx:211`)이 한 줄에 나란히. 대화 화면 — 헤더 배지 "running"(`ConversationScreen.tsx:603-606`) + 툴카드 "running…"(`conversation-timeline.tsx:41`) + 컴포저 placeholder "Steer the running task…"(`composer.tsx:128`)가 실행 중 한 viewport에 3회.
- 해소안: v9 DP-4 채택 전제 — 헤더 배지는 도트만(단어 제거), status 행은 표시어 테이블로 바꾸고 counts에서 `running` 단어 중복 제거.

**U-4. 원문 오류 덤프 5곳**
- 근거: `RunScreen.tsx:198, 263` · `SubmitScreen.tsx:57, 72` · `run-list.tsx:312` (+ `ConnectScreen.tsx:96-98` 폼 검증).
- 해소안: 전부 `copy.ts` 상수로 치환 — 실패 사실 + 보존된 초안 + 다음 행동만 말한다. 기계적.

**U-5. 승인 카피 2건 적용**
- 근거: `copy.ts:47` ("Submit response"), `copy.ts:139` ("New TUI session") + 파생 문자열(`SPAWN_TUI_SPAWNING:140`, `SPAWN_TUI_FAILED_PREFIX:151`, 접근성 라벨 `spawn-fab.tsx:139`).
- 해소안: §해소안 표 — 상수값 교체만으로 끝나는 기계적 변경. 단 `Reply`는 attention 문맥, `New task`는 spawn 문맥이므로 주변 문장(`SPAWN_TUI_WAITING` 등)의 어휘 정합만 확인.

### P2 — 다음 정리 런

**U-6. 내부 용어 잔존 (§어휘 표 전반)**
- projection/wire budget/lifecycle/steer 상태/pending-queued-delivered/원시 status enum. 각 행의 대체안 그대로가 해소안. `RunScreen.tsx:210`의 enum 원문 노출이 최우선.

**U-7. 언어 혼용**
- `session-title.ts:17, 89-91`, `time-format.ts:53, 62` vs 영어 copy. DP-U3 판정 전까지는 변경하지 않는다(전면 결정).

**U-8. copy 소유 위반 + 사문 상수 (guidance §7)**
- 인라인 리터럴: `ConversationScreen.tsx:774, 777, 790` · `RunScreen.tsx:285, 299` · `SubmitScreen.tsx:107` · `SettingsScreen.tsx:31-32, 87-91, 103, 110` · `QRScannerScreen.tsx:100`.
- 미사용 상수: `copy.ts:31-32` (`NO_PANES_NOTICE`, `PANE_LOADING_NOTICE`) — 인라인 쌍둥이가 대신 쓰이는 중.
- 사문 뷰 모델: `session-title.ts`의 `sessionSubtitle`/`sourceBadgeLabel` — tsx 소비처 없음 (어휘 규칙과 함께 정리 대상).

**U-9. 키보드 틈 2건**
- `keyboardDismissMode` 부재 (`ConversationScreen.tsx:654-660`) — 1속성 추가.
- 컴포저 5줄 캡 확장 수단 부재 (`composer.tsx:237`) — 최소 해소는 캡 상향, 완전 해소는 확장 토글이라 P3 성격이며 DP-U5로 접수.

**U-10. 목록 초기 로딩 표시 공백**
- `run-list.tsx:309-315` — 최소 해소: 초기 로딩에 빈 상태 위치의 조용한 "Loading…" 한 줄 (상수 소유 방식 준수).

### P3 — 기록·선행 판정 대기

**U-11.** `ConnectScreen.tsx:26` 기본 host 하드코딩 — 배포 범위 결정(개인용 유지 여부)에 달려 있어 DP 접수.
**U-12.** 시스템 상태바 숨김의 시간·배터리 부재 — 설계 결정 재판정은 DP-U6.
**U-13.** 툴카드 `args:` 원문/도구명 노출 — 개발자 사용자에게는 가치가 있어 전면 제거가 정답이 아님. 노출 수위는 DP-U7.

---

## 해소안 (기계적 — 구현 런 접수 목록)

| # | 대상 | 변경 | 근거 |
| --- | --- | --- | --- |
| R-1 | `copy.ts:47` | `SUBMIT_RESPONSE_LABEL` → `"Reply"` (주변 `ATTENTION_RESPONSE_PLACEHOLDER` "Your response"와 정합 확인) | U-5 승인 |
| R-2 | `copy.ts:139-151` | `SPAWN_TUI_LABEL` → `"New task"`, `SPAWN_TUI_SPAWNING`/`SPAWN_TUI_FAILED_PREFIX`의 TUI·spawn 어휘 동시 정리, `spawn-fab.tsx:139` 접근성 라벨 자동 따라감 | U-5 승인 |
| R-3 | `ConversationScreen.tsx:603-606` | 헤더 배지에서 `running` 단어 제거, 펄스 도트만 유지 | U-3 (v9 DP-4 전제) |
| R-4 | `RunScreen.tsx:210-211` | 상태 표시어 테이블 도입(enum→화면어), countsText와의 `running` 중복 제거 | U-3, U-6 |
| R-5 | `RunScreen.tsx:198, 263` | `Stream: …`/resolveError 원문 → `copy.ts` 상수 2종 | U-4 |
| R-6 | `SubmitScreen.tsx:57, 72, 107` | "submit failed" 덤프 → 보존 안내 상수, CTA "Submit/Submitting…" → 상수화("Send/Sending…"은 승인 범위 확인 후) | U-4, U-8 |
| R-7 | `run-list.tsx:312` | "runs list: …" → "Couldn't load the list — pull to retry." 상수 | U-4 |
| R-8 | `ConversationScreen.tsx:654-660` | `keyboardDismissMode="on-drag"` 1속성 | U-9 |
| R-9 | `features/markdown-view.tsx:8, 72` | `Clipboard` → `@react-native-clipboard/clipboard` | U-2 (v9 F-2-4) |
| R-10 | `ConversationScreen.tsx:317-325`, `PaneScreen.tsx:96-105` | onScroll 판정을 rAF/threshold 경유로 이동해 프레임당 setState 제거 | U-2 (v9 F-2-1) |
| R-11 | ref-in-render 4곳 (`ConversationScreen.tsx:185`, `BackSwipeZone.tsx:24-25`, `DrawerMenu.tsx:42-43`, `SwipeableRow.tsx`) | 대입을 effect로 이동 | U-2 (v9 F-2-3) |
| R-12 | `ConversationScreen.tsx:772-796` + `copy.ts:31-32` | 인라인 터미널 문구를 소유 상수로 통일(미사용 상수 소생 or 정리) | U-8 |
| R-13 | `copy.ts:30, 10, 35, 46, 100` | projection/wire budget/lifecycle/Submitting/No runs 문구를 §어휘 표대로 교체 | U-6 |

R-1~R-2는 사용자 승인 완료, R-3~R-13은 기계적(동작 변화 최소)이다. 단 R-4의 표시어 테이블 신규 어휘("Needs your reply" 등)는 DP-U2의 정책 판정을 받아 확정한다.

---

## DP 제안 (design-language / product lane 접수 — 이 감사에서 구현하지 않음)

| ID | 제안 | 내용 | 근거 |
| --- | --- | --- | --- |
| DP-U1 | **IA 재구성 — Files 탭 흡수·탭 축소** | (a) attention 응답을 Chats 흐름으로: 대화 화면이 run 상태를 구독해 attention 카드를 인라인 렌더하거나, attention 행 탭을 run 상_detail(갈래 B)로 라우팅. (b) Files 탭을 Chats/설정으로 흡수해 3탭→2탭 축소, run 트리는 대화 화면의 보조 표면으로 이동. 동선 단절(U-1)의 구조적 해소이며 화면 구성·네비게이션 계약 변경을 수반하므로 제품 결정 | U-1, §흐름 3 |
| DP-U2 | attention·steer 어휘의 사용자 언어 정책 | "attention" → "Needs your reply" 계열 표시어 테이블 1장을 정의하고 status 행·counts·목록 글리프 접근성 라벨이 같은 테이블을 쓰게 한다. steer 마크 문구도 동일 정책에서 확정 | U-6, R-4 |
| DP-U3 | 앱 표면 언어 단일화 | 현재 영어 copy + 한국어 상대시간·세션 폴백 혼용. 전면 영어 또는 전면 한국어 중 하나로 정하고 `copy.ts` 외 노출 문자열 전부를 소유 상수로 강제 | U-7 |
| DP-U4 | "run"→"task" 잔존 어휘 전환 범위 산정 | `RUN_TITLE` 등은 이미 "Task"이나 `EMPTY_RUNS_NOTICE`, `RunSplitScreen` 힌트, countsText에 run·pending 잔존. 전환 대상 문자열 목록을 이 표에서 확정해 일괄 교체 | §어휘 |
| DP-U5 | 컴포저 확장 수단 | 5줄 캡(`composer.tsx:237`)을 넘는 긴 프롬프트를 위한 확장 토글(전체 화면 편집) 도입 여부 | U-9 |
| DP-U6 | 시스템 상태바 숨김 재판정 | 시간·배터리 부재(`App.tsx:530`)를 감수할지, 헤더 우측에 앱 자체 표시를 둘지 | U-12 |
| DP-U7 | 툴카드 원문(args·toolName) 노출 수위 | 개발자 가치 vs 일반 사용자 소음. 접기 기본 유지 + 라벨만 정리("args:" 제거)인 부분 해소를 기본안으로 판정 | U-13 |
| DP-U8 | 문자열 소유 강제 게이트 | 화면 인라인 리터럴 금지 grep 테스트(v9 DP-1과 같은 계열) — U-8의 재발 방지. `RunScreen.tsx:210`류 enum 직렬 렌더도 표시어 테이블 경유 강제 | U-8, U-6 |

---

## 완료 확인 (이 감사의 체크)

- `apps/loop-mobile/src` 변경: **없음** (감사 전문 — 보고서만 작성)
- 본 문서: `docs/design/audits/mobile-usability-findings-v9.md` (쓰기 범위 내 유일 변경)
- 미해소 리스크: §요약 방법 한계 — 실렌더 체감·동선 체감은 vision 가능 세션의 캡처 재검토로 보강 필요 (v9 F-1과 동일 항목)
