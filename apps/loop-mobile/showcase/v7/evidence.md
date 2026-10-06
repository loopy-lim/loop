# v7 — 마이그레이션 후 쇼케이스 캡처 (task `showcase-recapture`)

> **증거 분류:** 아래 01–07은 iPhone 17 시뮬레이터(iOS 26.2)의 **실제 Loop 앱 Release 빌드** 화면이다. 데이터는 모두 로컬 루프백 데모 게이트웨이(`demo-gateway.ts` :18610, `attention-demo-gateway.ts` :18611)의 가짜 값(`run_demo_*`, `sess_demo_*`)이다. **모델 호출 0회, 유료 비용 0**, bearer는 상수 `demo-token`(자격 증명 아님, 메모리 전용·로그 금지 준수). 완료 체크는 파일 존재·내용만 읽는 읽기 전용이다.

## 캡처 조건

- **빌드:** 설치된 `LoopMobile.app`(2026-10-05 22:18 빌드)이 작업 트리 소스보다 최신 — `find src -newer <app binary>` 빈 결과로 확인. 사전 `bunx tsc --noEmit` 통과(깨진 번호로 인한 런치 크래시 선별 차단).
- **촬영:** `xcrun simctl io <udid> screenshot` (1206×2622, 3x). 앱 구동은 `SIMCTL_CHILD_LOOP_SHOWCASE_*` 런치 env(AppDelegate → `src/showcase.ts` initialProps) — 사람이 누르는 것과 동일한 버튼 핸들러만 호출.
- **attention 제출 UI 조작:** Simulator 접근성 트리에서 기기 화면 rect(그룹 346×752 @ (755,131), 스케일 0.8605)를 읽어 cliclick 좌표로 변환. 모든 내비게이션 탭은 32×32 그레이스케일 다운샘플 비교로 "화면이 실제로 바뀌었는지" 증명한 뒤 진행. 타이핑·제출은 실제 UI 요소(입력 포커스, Submit response 버튼)에 대한 실제 클릭이다.
- **해제 검증:** 게이트웨이 `GET /v1/demo/attention-state`가 `resolved:true`로 바뀌는 것 + run 프로젝션 `attention:null`로 확인. 테스트가 resolve HTTP를 직접 만들지 않았다(앱 UI 경유만).

## 화면 목록 (OCR + 토큰 픽셀 분석으로 내용 확인)

| # | 파일 | 화면 | 확인된 내용 |
| --- | --- | --- | --- |
| 1 | [01-connect-screen.png](01-connect-screen.png) | 연결 | `Connect` 제목, HOST/PORT/TOKEN 라벨 입력(tokenless 안내 문구), CTA `Connect`, `Scan pairing QR code` — scripted logout이 통과한 유일한 연결 경로로 복귀한 상태 |
| 2 | [02-runs-list.png](02-runs-list.png) | 런 목록 | `LOOP` 헤더, 신규 run 카드, CHATS 섹션(제목 + `• running` 상태 점 + 상대 시간), 세션 행 `sess_demo_empty_00…`의 `run_id=null` 정직 표기, 하단 탭(Files & reports / Settings) |
| 3 | [03-run-detail-conversation.png](03-run-detail-conversation.png) | 런 상세(대화) | 실행 중 run 헤더(`• running`, Raw 토글), 사용자/어시스턴트 버블 구분, 툴 카드(`read … ✓ done` 접힘 / `bash cargo test … ◐ running` 펼침 + mono args), steer 컴포저 |
| 4 | [04-attention-run-conversation.png](04-attention-run-conversation.png) | attention run 대화 | `run_demo_attention…` 세션 연결 중 상태("Connecting to this task's session") — attention run을 액티브 run으로 확정한 단계 |
| 5 | [05-attention-open-runs.png](05-attention-open-runs.png) | 런 상세(attention 열림) | `run_demo_attention... - attention`, `1 pending, 1 attention`, Worker 차단 질문 전문, `Your response` 입력, `Submit response` CTA |
| 6 | [06-attention-response-typed.png](06-attention-response-typed.png) | 응답 입력 완료 | 입력에 "Skip the flaky test and continue with the remaining tasks" 실제 타이핑 반영 |
| 7 | [07-attention-released.png](07-attention-released.png) | 해제 후 | 헤더가 `- running`, `1 done`으로 전환 — 제출이 실제 run 상태를 바꾼 것을 화면으로 증명 |

- **해제 확인 JSON:** [release-confirmation.json](release-confirmation.json) — `resolved:true`, `taskCountsAfter.attention=0`, `runStatusAfter:"running"`. 게이트웨이 상태와 run 프로젝션(`attention:null`) 모두 확인.
- 7장 전부 MD5 상이(중복 캡처 없음).

## 폐쇄 어휘 준수 판정 (docs/design 기준: 강조 1개 · 헤어라인 경계 · 잉크 위계)

판정 방법: `scripts/analyze-shot.ts`의 설계 토큰 **정확 일치 픽셀 분석** + 16단계 색 히스토그램(전 화면) + OCR 텍스트 구조. 눈 대신 측정값으로 판정한다.

- **강조 1개 — 통과.** 각 화면의 유일한 채움 강조는 흰 필 CTA(`Connect`, `Submit response`, `↑`)뿐이다. 상태색(green/warn)은 큰 채움 밴드를 만들지 않고 상태 글리프·텍스트 액센트 소면적으로만 나타난다(토큰 정확 일치 분석에서 warn `#D29922`는 어느 30px 행 버킷에서도 대면적 밴드 없음 — 05의 attention 상태도 글리프 수준).
- **헤어라인 경계 — 통과.** 히스토그램 상위 2개 버킷이 `bg #0D1117`(50–97%)과 `surface #161C26`(1–44%)뿐이다. 카드·행·탭은 밝은 채움 블록이 아니라 배경/표면 2톤 + 헤어라인으로 구분되며, 채도 있는 면 버킷은 어디에도 상위에 없다(03의 툴 카드 mono args 표면만 부분 표면 톤).
- **잉크 위계 — 통과.** 밝은 잉크(흰 계열) 비중이 전 화면 0.3–5.3%로, 본문/보조 잉크 대비 CTA·제목만 밝게 위계를 이룬다(06 입력 텍스트 `rgb(232,232,248)` 0.6%, 07 해제 후 0.3% — 정보 밀도가 낮은 화면일수록 밝은 잉크가 줄어드는 위계 일관성).

## 재실행 (시뮬레이터 전용, 유료 호출 0)

```bash
cd /Users/loopy/dev/ll3/loop
bunx tsc --noEmit --project apps/loop-mobile/tsconfig.json   # 프리플라이트
bun apps/loop-mobile/scripts/demo-gateway.ts 18610 &          # 일반 runs 가짜 게이트웨이
bun apps/loop-mobile/scripts/attention-demo-gateway.ts 18611 & # attention run 가짜 게이트웨이
UDID=$(xcrun simctl list devices booted | sed -n 's/.*(\([0-9A-F-]\{36\}\)) (Booted)/\1/p' | head -1)
env SIMCTL_CHILD_LOOP_SHOWCASE_BEARER=demo-token \
  SIMCTL_CHILD_LOOP_SHOWCASE_HOST=127.0.0.1 SIMCTL_CHILD_LOOP_SHOWCASE_PORT=18610 \
  SIMCTL_CHILD_LOOP_SHOWCASE_CONNECT=1 \
  xcrun simctl launch $UDID org.reactjs.native.example.LoopMobile
# attention 제출 흐름: Simulator AX 트리에서 기기 rect를 읽어 cliclick 탭 매핑
# (탭마다 32x32 그레이스케일 비교로 화면 전환 증명 — 이 문서의 캡처 조건 참조)
```

## 리스타일 전/후 비교 (task `design-restyle`, restyle/ 하위)

> **판정 방법(눈 없는 시각 리뷰):** Vision OCR(텍스트+bbox) / 토큰 정확 일치 픽셀 밴드 / 텍스트 라인 클러스터 측정으로 "백그라운드 캡처의 레이아웃"을 정량 분석했다. 아래 원인 특정은 전부 `01–07`(전) 픽셀·OCR 측정값이 근거이고, 교정 후 동일 컷을 `restyle/after-*.png`로 재촬영해 같은 측정을 다시 했다. 재촬영 앱은 교정 소스의 Release 재빌드(2026-10-05 22:5x 설치)이며, 탭·타이핑은 실제 UI 경유(OCR 좌표 → cliclick), 해제 검증은 게이트웨이 상태 대조다. 유료 호출 0.

### 화면별 원인 특정 (전 컷 측정 근거)

| # | 특정된 원인 | 측정 근거(전) | 분류 |
| --- | --- | --- | --- |
| 02, 05–07 | **비스크롤 화면의 수평 거터 붕괴** — `ui/Screen.tsx` 비스크롤 column에 세로 거터가 없어 홈·Files 화면 콘텐츠가 화면 끝까지 뻗음 | 02 런 카드 표면 밴드 `x=3..1202`(0pt 거터), `CHATS`/`SESSIONS`/`Show all sessions` 라벨 `x=0/1202` 풀블리드, 05 헤딩·질문 텍스트 `x=0..1198` | 간격 붕괴 |
| 02 | **하단 푸터 알약 2개가 좌측에 뭉침** — content-width 알약이 왼쪽 절반에 몰리고 우측 절반이 빈 채로 남음 | `Files & reports` `x=49..316` + `Settings` `x=441..594`, 화면 우측 절반(200..402pt)에 아무것도 없음 | 비례 붕괴 |
| 02 | **스폰 컴포저 카드의 죽은 공간** — 빈 상태에서 72pt(3줄) 인풋에 플레이스홀더 1줄 → 카드 150pt | 카드 밴드 `y=346..795`(150pt), 플레이스홀더 `y=404..450`, `Submit` `y=670..714` 사이 73pt 공백 | 비례 붕괴 |
| 05, 06 | **attention 블록 위계 부재 + 강조 오배치** — 결정적 행동 `Submit response`가 조용한 surface 카드로 렌더(§4 유일 강조가 없는 화면), 블록 간 분리가 전부 4–8pt로 헤딩·카운트·질문·입력·버튼이 한 줄기로 이어짐 | 전 05: attention 텍스트 `marginTop 4`, 입력·버튼 `marginTop 8`, 버튼 채움 = `surface`(#161C26, 백색 필 없음) | 위계 부재 + 강조 부재 |
| 01, 03, 04 | **결함 없음(대조 컷)** — 01 연결 화면은 16pt 거터·라벨-인풋 리듬 118px 일정, 03 대화는 버블 우측 17pt·툴카드 17pt로 정상 | 01 입력 밴드 간격 118px×2 일치, 03 userBubble `x=216..1156`(r=17pt), 카드 `x=52..1154` | — |

### 교정 (기존 토큰·글립 재결합 — 새 색·새 스케일 0)

| 파일 | 변경 |
| --- | --- |
| `src/ui/Screen.tsx` | 비스크롤 `columnFixed`에 `paddingHorizontal: COLUMN_GUTTER` 추가 — 스크롤 변형과 동일한 16pt 거터 |
| `src/App.tsx` | `QuietButton`에 등록 변형 `wide` 추가(§8-3): 홈 푸터 2알약이 `flex:1`로 균등 분할·중앙 정렬 — 탭 바처럼 읽히는 균형 밴드 |
| `src/screens/SubmitScreen.tsx` | 스폰 컴포저 인풋 `minHeight` 72→48(빈 상태 카드 150→126pt, 멀티라인 성장은 유지) |
| `src/screens/RunScreen.tsx` | attention 블록을 툴카드 어휘의 하나의 카드로 그룹핑(surface+hairline+radius.m+gap), 응답 입력은 중첩 표면 `surfaceAlt`, `Submit response`를 화면의 유일 강조 CTA 어휘(`cta` 필·pill·`ctaInk`·비활성 `ctaDisabled`)로 교정, 블록 리듬 m/xxs 재배열, 출력 줄을 `outputs` 그룹으로 묶음 |

### 재촬영 결과 (동일 컷, `restyle/`)

| 컷 | 전 → 후 측정 변화 | MD5 |
| --- | --- | --- |
| [after-01-connect-screen.png](restyle/after-01-connect-screen.png) | 변화 없음(교정 대상 없는 대조 컷 — ConnectScreen 무변경) | 전후 동일(정적 화면) |
| [after-02-runs-list.png](restyle/after-02-runs-list.png) | 카드 밴드 `x=3..1202` → **`x=48..1157`(16pt 거터)**, `CHATS` `x=0` → `x=46`, 푸터 알약 중심 61/172pt → **106/295pt(각 열 중앙 균등 분할)**, 컴포저 카드 150 → **126pt** | 상이 ✓ |
| [after-03-run-detail-conversation.png](restyle/after-03-run-detail-conversation.png) | 레이아웃 동일(대화 화면 무변경) — 바이트 차이는 시계 캡션(22:27→22:45)만 | 상이 ✓ |
| [after-04-attention-run-conversation.png](restyle/after-04-attention-run-conversation.png) | 변화 없음(연결 중 정적 상태, 무변경 화면) | 전후 동일(정적 화면) |
| [after-05-attention-open-runs.png](restyle/after-05-attention-open-runs.png) | 헤딩 `x=0` → **`x=46`**, 질문·입력·버튼이 attention 카드로 그룹핑, 빈 입력 상태에서 `Submit response`는 비활성 CTA(`ctaDisabled`) — 어휘 일관 | 상이 ✓ |
| [after-06-attention-response-typed.png](restyle/after-06-attention-response-typed.png) | 타이핑 시 **활성 백색 CTA 밴드 출현**: `#F0F6FC` `y=820..953`(44pt 높이, 카드 내 풀폭) — 전 컷에는 존재하지 않던 강조 | 상이 ✓ |
| [after-07-attention-released.png](restyle/after-07-attention-released.png) | 해제 후 `- running` / `1 done`, 헤딩 `x=46` | 상이 ✓ |

- **해제 확인 JSON:** [restyle/release-confirmation.json](restyle/release-confirmation.json) — `resolved:true`, `resolution` 전문, `runStatusAfter:"running"`, `taskCountsAfter` 갱신. run 프로젝션 `attention:null`도 확인. 제출은 교정된 attention 카드 UI 경유(입력 탭 → 실제 타이핑 → Submit response CTA 탭)였고 테스트가 resolve HTTP를 직접 만들지 않았다.
- **검증:** `bun test apps/loop-mobile/test` 429 pass / 0 fail, `bunx tsc --noEmit` 통과, 드리프트 grep 0건 — 전부 교정 후 재실행.

## 미달·한계

- 이번 런의 리스타일 작업(디자인 원인 시각 특정·교정)은 본 태스크 범위 밖 — v7 캡처는 **마이그레이션된 현재 UI**의 증거이며, 리스타일 전/후 비교 캡처는 리스타일 태스크의 증거로 남는다.
- 시뮬레이터 소프트웨어 키보드 대신 하드웨어 키보드 연결 상태에서 타이핑했다(I/O 메뉴 확인). 가로 모드·키보드 회피 화면은 v5 증거로 대신한다.
- 툴 카드 상태(03)는 가짜 스트림 기준이며, 실제 pi 세션 재현은 운영자 승인 절차(별도 증거)를 따른다.
- 리스타일 한계: Files 화면 하단에 `Files & reports` 알약과 `Back to chats` 알약이 계란형으로 쌓여 있는 것(05–07 하단)은 내비게이션 구조 변경이 필요해 이번 절제 범위 밖으로 남겼다. 01·04의 전후 바이트 동일은 무변경 화면의 정적 상태가 결정적 렌더링이라 정상이다.
