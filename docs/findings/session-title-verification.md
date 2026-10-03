# 세션 제목 규칙 최종 검증 (session-title-showcase)

- **일시:** 2026-09-27 00:31–00:34 KST
- **Kind:** verification (`session-title-showcase`) — 선행 구현: `session-title-implementation`
- **Scope read:** `apps/loop-mobile/**`, `docs/research/simulator-showcase/**`, `packages/gateway/**`
- **Write:** `docs/findings/session-title-verification.md`(이 문서), `docs/research/simulator-showcase/review-latest/**`
- **유료 모델 호출: 0** — demo 게이트웨이(`apps/loop-mobile/scripts/demo-gateway.ts`, 루프백 가짜 데이터)만 사용. 실기기 없음.

## 결과 요약

| 항목 | 결과 |
| --- | --- |
| 채팅 목록 SESSIONS 행이 승인된 규칙 제목·부제를 표시 | **PASS** — 컷 04·06 (아래 OCR 전사) |
| 규칙 전 경로 시연: 발화 제목·48자 말줄임 / 새 세션+시각 / 상대 시간 / TUI 배지 / 무증거 폴백 | **PASS** — 컷 01~06 |
| 단위 테스트 (빈 세션·긴 발화·줄바꿈·반복 제목·상대 시간 경계) | **PASS** — `session-title.test.ts`+`time-format.test.ts` 33 pass (전체 `bun run check`에 포함) |
| `bun run check` 전체 | **PASS** — exit 0 (codegen:clean · typecheck · architecture · cargo 25 suites ok · bun 594 pass) |
| 데스크톱 동일 규칙 | **부분 + 문서화** — 어댑터 라벨 + `새 세션` 폴백만 적용, 전체 규칙은 `apps/loop-desktop/src/features/chat-rows.ts` 주석에 후속으로 기록(증거 fold·wire 필드 부재) |

**종합: PASS.**

## 방법

1. **재빌드:** `cd apps/loop-mobile && bash scripts/build-ios-simulator.sh` → Release 정적 JS 번들, iPhone 17 시뮬레이터(UDID `99B087B5-…`) 설치·기동, BUILD SUCCEEDED. 설치 번들이 세션 제목 소스를 포함함을 보장.
2. **demo 게이트웨이:** `bun apps/loop-mobile/scripts/demo-gateway.ts 18588 --max-runs=2` (CHATS를 2건으로 제한해 SESSIONS 섹션이 첫 화면에 들어오도록 — capture-session-title.sh와 동일). `/v1/runs` 200 확인 후 캡처.
3. **런치 env 훅:** `SIMCTL_CHILD_LOOP_SHOWCASE_{BEARER,HOST,PORT,CONNECT,OPEN_SESSION,BACK_DELAY_MS}` — `env(1)` 경유(simctl argv≠환경변수 교훈, v8). 사람의 탭과 동일한 앱 핸들러 경로만 구동.
4. **규칙 시연용 입력 주입:** 컷 05·06에서는 demo 게이트웨이의 `POST /v1/sessions/{id}/input`(실게이트웨이 D5 경로 미러)으로 `user_message source=interactive` 프레임을 스트림에 push → 앱이 대화 화면에서 그 프레임을 **관찰**해 앱-로컬 `SessionNamingIndex`에 적립(조작된 제목이 아니라 관찰된 증거).
5. **판정 보조:** 검증 모델이 이미지를 읽지 못해 macOS Vision OCR(`ko-KR`)로 화면 텍스트를 추출해 아래 전사를 남김. 원본 PNG가 1차 증거.

## 스크린샷 (`docs/research/simulator-showcase/review-latest/`)

| # | 파일 | 증명 | 화면 텍스트(OCR 전사, 요지) |
| --- | --- | --- | --- |
| 01 | `01-chats-fresh-fallback.png` | 무증거 신규 기동 — 정직한 폴백(규칙 위조 없음) | SESSIONS: `sess_demo_orphan_0… / interactive / • ended`, `sess_demo_empty_00… / interactive / • live` |
| 02 | `02-header-first-utterance.png` | 헤더 = 첫 발화 48자 말줄임 (어댑터 라벨 "Showcase v8: markdown + code budget"이 아님) | 헤더 `Where does the demo gateway tri…` + 본문 발화 `Where does the demo gateway trim the SSE tail? Show code.` |
| 03 | `03-header-new-session-stamp.png` | 발화 없는 세션 — `새 세션` + 시작 시각 | 헤더 `새 세션 (2026-09-27 00:29)` |
| 04 | `04-chats-after-observe.png` | 목록: 관찰된 세션이 규칙 제목+상대 시간으로 갱신, 무증거 행은 폴백 유지 | SESSIONS: `sess_demo_orphan_0… / interactive`(폴백) · `새 세션 (2026-09-27 00:29) / 2분 전 / • live` |
| 05 | `05-header-utterance-folded.png` | input 주입 프레임 관찰 → 헤더가 즉시 발화 제목으로 | 헤더 `Where does the SSE tail get Cut W…` (말줄임) |
| 06 | `06-chats-titled-tui-badge.png` | 목록: 발화 제목 + 상대 시간 + 소스 배지 | SESSIONS: `Where does the SSE tail get cut when tool r… / 2분 전 · TUI / • live` (+ orphan 폴백 행) |

- PNG 6장 전부 MD5 상이(고유 컷). 캡처 시각 00:31–00:34.
- 컷 04·06의 부제 `2분 전`은 캡처가 세션 시작(00:29) 대비 약 2분 뒤 촬영이어서의 실측값 — `relativeTimeKo`가 실시간으로 산출.
- 컷 06의 배지 `TUI`는 demo `source: "interactive"` → `sourceBadgeLabel` 매핑의 실측. 앱 소스(`api`/`steer` → `앱`)는 단위 테스트 커버.
- 이전 캡처(`apps/loop-mobile/showcase-captures/session-title/`, 구현 태스크 산출)는 원본으로 보존 — 이 검증은 review-latest에 독립 재실행.

## 규칙 대응표 (승인된 규칙 ↔ 증거)

| 규칙 | 증거 |
| --- | --- |
| 제목 = 첫 사용자 발화 한 줄 (줄바꿈→공백, 공백 정리) | 컷 02·05·06 헤더/행 — 컷 05는 발화 1줄화 실측, 줄바꿈 접기는 `session-title.test.ts`(`oneLine`) 커버 |
| 48자 말줄임 | 컷 02 `…tri…`, 컷 05·06 `…w…`/`…tool r…` 말줄임 실측 |
| 발화 없으면 `새 세션` + 시작 시각 | 컷 03 `새 세션 (2026-09-27 00:29)`, 컷 04 목록 행 |
| 부제 = 상대 시간 + 소스 배지 | 컷 04 `2분 전`, 컷 06 `2분 전 · TUI` |
| 동일 제목 반복 시 시작 시각 덧붙임 | 화면 시연 조건 부재(demo에 동일 발화 세션 2건 없음) — `sessionTitles` 반복 그룹 전체 스탬프 부착을 `session-title.test.ts`가 커버 |
| 자동 요약·이모지 금지, 모델 호출 없음, 결정론 | 순수 헬퍼(`apps/loop-mobile/src/features/session-title.ts`) — 네트워크/React 의존 0, 이번 검증 전체에서 유료 호출 0회 |

## 검사 실행

```text
$ cd apps/loop-mobile && bash scripts/build-ios-simulator.sh
  ** BUILD SUCCEEDED ** → installed + launched (iPhone 17, UDID 99B087B5-…)

$ bun test apps/loop-mobile/test/session-title.test.ts apps/loop-mobile/test/time-format.test.ts
  33 pass / 0 fail

$ bun run check   # = codegen:check && typecheck && test:architecture && test
  exit=0 — [rustra] CODEGEN_CLEAN, architecture boundaries 통과,
  cargo test --workspace "test result: ok" 25 suites / 0 failed,
  bun test 594 pass / 0 fail / 3971 expect() calls (67 files)
```

## 한계·리스크

1. **반복 제목 중복 해소는 화면 미시연** — demo 데이터에 동일 제목 목록이 없어 유닛 테스트 근거만 존재. 필요하면 demo 세션 추가 후 재시연.
2. **데스크톱은 규칙 부분 적용** — 어댑터 라벨 우선 + `새 세션` 폴백만; 전체 규칙(발화 제목·말줄임·스탬프 중복 해소·부제)은 `SessionNamingIndex` 이식이 전제로 `chat-rows.ts`에 문서화된 후속. 인텐트의 "동일 규칙이면 적용 아니면 문서화" 중 문서화 분기 충족.
3. **컷 05 헤더 OCR이 `Cut W`로 대문자화** — Vision OCR 인식 한계(원문 `cut w`). 판정에 영향 없음, 원본 PNG 참조.
4. **부제 상대 시간은 캡처 시각 의존** — 시간이 지나면 `N시간 전/어제` 등으로 바뀌는 것이 정상(결정론은 "관찰 시각 기준 함수"로 유지).
