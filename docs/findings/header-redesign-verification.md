# 헤더 = 스테이터스바 대체 재설계 검증 (header-showcase-verify, 2026-09-27)

운영자 지시 3항목 — (1) 상단 헤더가 iOS 스테이터스바를 대체(다이내믹 아일랜드 중앙, 제목 좌측/액션 우측), (2) 하단 로그아웃 행 제거 + 헤더 우측 코너 아이콘 → 확인 얼럿, (3) 텍스트 위계 정돈 완결 — 을 재빌드 → 재런치 → 시뮬레이터 실측 캡처 + 픽셀 분석으로 검증했다. 스크린샷은 [`docs/research/simulator-showcase/review-header/`](../research/simulator-showcase/review-header/), 재실행은 동일 디렉터리 `capture.sh`. **모델 호출 0회, 유료 비용 0.**

## 전제 확인

- 재빌드: `apps/loop-mobile/scripts/build-ios-simulator.sh` → Release 빌드 **BUILD SUCCEEDED** 후 설치·런치 (캡처 전 새 소스 반영 확인).
- 게이트웨이: 데모(fake data) `127.0.0.1:18588` `/v1/runs` **200**, 실서비스 launchd `kr.ll3.loop.gateway` `127.0.0.1:18477` `/v1/runs` **200**.
- 탭 자동화: 시뮬레이터 창 Point Accurate 스케일에서 디바이스 스크린이 화면 포인트 (1289,165)에 1:1로 대응함을 픽셀 캘리브레이션으로 확인 → `cliclick` 탭. 파괴 버튼 좌표는 매 프레임 스크린샷에서 red 텍스트 bbox로 동적 산출(하드코딩 없음).

## 스크린샷 (review-header/)

| # | 파일 | 증명 | 화면에서 확인되는 것 |
| --- | --- | --- | --- |
| 01 | `01-chats-header.png` | 좌우 플랭크 헤더 | 좌측 `Chats` 타이틀(x 52–162), 우측 로그아웃 글리프(x 1072–1111, y 73–113), 중앙은 아일랜드만 |
| 02 | `02-conversation-header.png` | 대화 헤더 | 좌측 back+타이틀(x 108–414), 우측 Raw/Chat 액션(x 1085–1154) |
| 03 | `03-logout-menu-open.png` | 로그아웃 메뉴(=확인 얼럿) 개방 | 헤더 아이콘 탭 1회 → 확인 얼럿. Cancel(좌, x 304–456) / **Log out destructive(우, red x 742–910, y 1504–1548)** |
| 04 | `04-logout-confirmed-connect.png` | destructive 확정 → Keychain 삭제 | Connect 화면 복귀. 헤더 코너 글리프 소멸(밝은 px 0), red 0 |
| 05 | `05-relaunch-stays-logged-out.png` | 무 env 재런치 로그아웃 유지 | 동일 Connect 구조(y 280–1672 콘텐츠 밴드), 로그인 복원 없음 |

요구의 "logout menu open"과 "confirmation alert"은 본 구현에서 **하나의 표면**이다 — 코너 아이콘 탭이 곧 `Alert.alert`(Cancel/Log out 2선택지)를 여는 단일 단계이며, 별도 중간 메뉴 화면은 없다(의도 문구 "탭 → 확인 얼럿 → Keychain 삭제"와 일치). 03이 그 표면이고, 04–05가 destructive 확정 이후 경로다.

## 픽셀 검증 (전 컷 1206×2622, 밝기 = r+g+b, 임계 330)

| 검증 | 대상 | 결과 |
| --- | --- | --- |
| 아일랜드 밴드(x 415–790, y 0–120) 밝은 앱 콘텐츠 | 01, 02 | **0 px (0%)** — 01 EMPTY, 02는 x 415–416 10 px뿐(좌측 타이틀 우단) |
| 아일랜드 하부 인셋 존(x 415–790, y 120–200) | 01 | **0 px** — 아일랜드 아래 어떤 앱 콘텐츠도 렌더 없음 |
| 실측 아일랜드 위치 | 01 y=60 | near-black 클러스터 x **429–776** — 02의 타이틀 우단 x 416과 **13 px 간격**, 아일랜드 침범 없음 |
| 하단 가장자리 로그아웃 잔재 | 01 | 바닥 200행 **전체 폭에서 bg(13,17,23) 외 픽셀 0개**(sum>200 기준) — 잘린 행 잔재 없음. (홈 인디케이터는 시스템 오버레이라 simctl 캡처에 미포함 — 잔재 오판 위험도 없음) |
| 03 얼럿 표면 | 03 | 패널(81,83,84) @ (600,1300), Cancel/Log out 텍스트 bbox 실측 상기 표 |
| 04·05 로그아웃 상태 | 04, 05 | 헤더 코너 글리프 0 px, red 0 px, Connect 콘텐츠 밴드 존재 |

## 구조 근거 (소스, read-only 확인)

- `apps/loop-mobile/src/ui/AppHeader.tsx` — `height: insets.top` 존, `StatusBar hidden`(App), 중앙 `ISLAND_RESERVE=130` 예약, leading(제목) 좌 / actions 우.
- `apps/loop-mobile/src/features/run-list.tsx` — 하단 로그아웃 행 제거 문서화(홈 인디케이터 코너 잘림 우려 반영).
- `apps/loop-mobile/src/App.tsx` — `LogoutButton`(44pt 터치 플로어, hitSlop) → `confirmLogout` → destructive 버튼만이 App 소유 로그아웃 핸들러로 통하는 mis-tap 가드. 캡처 중 Cancel 탭이 아무것도 삭제하지 않음을 실측으로 확인.

## 검증 실행

`bun run check` 전체 통과 — 아래 §체크 기록. 유료 모델 호출 0회, 실기기 없음.

## 미해결/후속

1. **`[dbg]` 로그 잔재**: 선행 작업(`header-statusbar-redesign`)의 계측 `console.log("[dbg] …")` 2줄이 `App.tsx`(`confirmLogout`, `LogoutButton`)에 남아 있다. 본 태스크 write scope는 앱 소스를 제외하므로 제거하지 않았다 — 후속 정리 1줄짜리 작업 권장.
2. 시뮬레이터 창 좌표 캘리브레이션 값(WINX/WINY=1289/165)은 창 이동·스케일 변경 시 재측정 필요(`capture.sh` 상단 주석 참조).
