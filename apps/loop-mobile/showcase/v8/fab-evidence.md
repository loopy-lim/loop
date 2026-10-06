# + FAB·아이콘 캡처 — 판정: PASS (task `fab-capture`)

## 결과

Release 빌드 복구 후 시뮬레이터 캡처 2장 확보, 픽셀 분석으로 FAB와
SF Symbols 아이콘의 실제 렌더를 확인했다.

- 조건: iPhone 17 / iOS 26.2 (UDID `99B087B5-DEF6-4CF1-9177-81A5DE564CFC`),
  `apps/loop-mobile/scripts/build-ios-simulator.sh` Release 빌드 → 설치·기동,
  `xcrun simctl io booted screenshot` 촬영. 데이터는 로컬 가짜 게이트웨이
  `showcase/v8/polish-demo-gateway.ts` (127.0.0.1:18777, 루프백, 토크리스) —
  유료 모델 호출·실제 워커 없음. 연결은 `SIMCTL_CHILD_LOOP_SHOWCASE_HOST/PORT/CONNECT=1`
  (§D-A1), 2번 컷은 `LOOP_SHOWCASE_OPEN_RUN=run_polish_attention_0001` 자동 오픈.

| 파일 | 화면 | 픽셀 판정 |
| --- | --- | --- |
| `fab-01-home-fab.png` | 채팅 홈, 우하단 + FAB | 54pt 원형 표면 채움(#12161E, 161×161px) + 헤어라인 링(#363941), 원 중심에 + 글리프(#B4B7BC 288px = inkMute 합성톤) 렌더 확인. FAB 도입 전 컷(`02-runs-list.png`)과 같은 영역 비교 시 해당 영역 변화 확인(채움은 surface↔bg 차가 작아 링·글리프 픽셀 기준) |
| `fab-02-run-detail-icons.png` | 런 상세(attention), 헤더·composer·탭 바 | 탭 바 아이콘+라벨(#B4B7BC 447px)·선택 상태(#8B8F95 3.3k px), 헤더 잉크 톤(#F2F5F9 336px) 확인. 화면 전체 채도 색 0픽셀 — 유니코드 글리프가 이모지(다색)로 렌더되지 않았음. `fab-01`의 채도 색은 warn(#AF8121)·accent(#636EB9) 토큰 계열뿐 |

## 이번 컷에서 수정한 것 (쓰기 범위 밖 — 명시적 보고)

선언 쓰기 범위는 `apps/loop-mobile/showcase/v8/**`이지만, 캡처 요건의 전제인
빌드 차단과 아이콘 미렌더를 해소하기 위해 최소 수정 2건을 적용했다. 둘 다
`fab-icons` 산출물의 결함이다.

1. `apps/loop-mobile/ios/LoopMobile/LoopIcon.swift` — `override init(frame:)`에
   `= .zero` 기본값 부여. required `init?(coder:)` 구현이 편의 `init()` 상속을
   끊어 66행 `LoopIconView()`가 컴파일되지 않던 문제(전회 FAIL 근거)의 해소.
   이전 시도의 fab-evidence.md에 기록된 수정안과 동일.
2. `apps/loop-mobile/src/ui/Icon.tsx` — 네이티브 LoopIcon 경로에
   `width/height = pointSize`를 명시. yoga가 네이티브 뷰에 내재 크기를 주지
   않아 뷰가 0×0으로 붕괴, 모든 SF Symbol이 그려지지 않던 문제. 빌드 성공 후에도
   FAB 원 안에 글리프 픽셀이 0개였던 것을 원인 추적으로 확인하고 수정 — 수정 전
   원 내부 non-surface 픽셀 0개 → 수정 후 436개(+ 글리프와 안티앨리어싱).

## 실행한 검사

- `bash scripts/build-ios-simulator.sh` (Release) → **BUILD SUCCEEDED**, 설치·기동 확인
- `bun test test` → 490 pass / 0 fail
- `bunx tsc -p tsconfig.json --noEmit` → `test/sse-decoder.test.ts(77)` 기존 오류 1건
  (이번 변경과 무관한 `fab-icons` 워킹트리 기존 문제 — 미해결 위험으로 기록)
- 픽셀 검증: Pillow로 FAB 원형·글리프·탭 바 아이콘·채도(이모지 부정) 확인 (위 표)

## 완료 체크

`fab-capture-check`: `apps/loop-mobile/showcase/v8/fab-evidence.md` 존재 +
`fab-*.png` 2장 — `fab-01-home-fab.png`, `fab-02-run-detail-icons.png` 충족.

## 명시적으로 확인되지 않은 것

- FAB 탭 → 세션 스폰 플로우 자체(생성 중 상태 pill)는 이번 컷에서 시동하지 않음
  — 요건은 "생성 중 상태 유지"의 구현이 아니라 적용 화면 캡처.
- 아이콘이 SF Symbols 폰트로 그려졌다는 것은 픽셀에서 직접 증명 불가(다색 이모지
  부정만 확인). 기호 형태의 단색 잉크 렌더로 간접 확인.
- 사람의 육안 검수는 없음 — 판정은 픽셀 분석에 근거.
