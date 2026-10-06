# 메인 화면 정리 캡처 — polish (task `polish-capture`)

## 캡처 조건

- 기기: iPhone 17 시뮬레이터 / iOS 26.2 (UDID `99B087B5-DEF6-4CF1-9177-81A5DE564CFC`), 1206×2622 px, 3×.
- 빌드: `apps/loop-mobile/scripts/build-ios-simulator.sh` — **Release** 구성, self-contained JS 번들(Metro 개발 서버 없이 실행). `** BUILD SUCCEEDED **` 후 설치·기동 확인.
- 데이터: 로컬 가짜 게이트웨이 `showcase/v8/polish-demo-gateway.ts` (127.0.0.1:18777, 루프백 바인드, 토큰리스 허용). 모든 데이터는 `polish-*` 데모 id — 유료 모델 호출·실제 워커 없음. 런 5개를 그룹핑이 결정적으로 보이도록 구성: attention 1(진행 중 선두)·running 1·오늘 완료 2(이 중 1개는 세션 미상관 → `Untitled task`)·어제 완료 1, 미상관 live 세션 1(이름 관찰 없음 → `Unnamed session`).
- 앱 실행: `SIMCTL_CHILD_LOOP_SHOWCASE_HOST/PORT/CONNECT=1` 런치 env로 연결 화면의 실제 Connect 경로와 동일한 자동 연결(§D-A1). "Show all sessions" 토글은 cliclick으로 **사람이 탭하는 것과 동일한** 화면 탭으로 누름(좌표는 시뮬레이터 접근성 그룹 (784,154) 346×753pt에 실측 캘리브레이션).
- 검증 방법: 캡처 PNG를 macOS Vision OCR(`VNRecognizeTextRequest`, ko+en)로 행 단위 텍스트·위치를 읽어 판정. 이미지 육안 검토가 불가한 세션이라 OCR 좌표가 1차 증거.

## 캡처 결과

| 파일 | 화면 | 판정 |
| --- | --- | --- |
| `polish-01-runs-list.png` | 기본(진행 중 집중) 뷰: 컴포저 아래 `IN PROGRESS` 섹션 + "Show all sessions" 토글 | **확인** — (1) `LOOP` AppHeader 없음: 최상단 콘텐츠(컴포저 placeholder y≈247px)가 상태 바 바로 아래에서 시작, Logout은 화면에 없음(하단 Settings 탭 경로만 존재). (2) attention 행("Retry or skip the flaky integration test?", 7m)이 섹션 선두. (3) **첫 행 부분 개방(peek)**: 첫 행 제목 x≈175px vs 나머지 행 x≈90px — 첫 행만 ~28pt 열려 스와이프 액션 발견성 확보. (4) 기술값 없음: 미상관 live 세션이 `Unnamed session`, run id 노출 0건. |
| `polish-02-session-groups.png` | 토글 탭 후 전체 그룹핑 뷰 | **확인** — 3섹션 모두 렌더: `IN PROGRESS`(attention 9m 선두 + running 5m + `Unnamed session`) / `TODAY`(`Fix the gateway test flake` 47m, `Untitled task` 1h) / `EARLIER`(`Two-day touchpoint map audit` 23h). 세션 미상관 완료 런이 **`Untitled task`** 빈 상태 문구로 표시 — run_id 등 기술값 노출 없음(brief S-11). 토글 라벨이 `Active only`로 반전(집중 뷰 복귀 경로 존재). |

## 명시적으로 확인되지 않은 것

- 스와이프 액션의 **완전 개방 후 동작**(Open 실행)과 길게 눌러 메뉴 경로는 이 컷에서 주장하지 않음 — peek 렌더만 확인.
- 실제 게이트웨이/실제 런 데이터에서의 그룹핑(데모 타임스탬프는 결정적으로 고정된 가짜값).
- 상태 글리프의 색 정확성(warn/ok 토큰 매핑)은 OCR로 확인 불가 — `attention` 행의 왼쪽 warn edge는 픽셀 검사 미실시.

## 재현

```bash
bun apps/loop-mobile/showcase/v8/polish-demo-gateway.ts 18777 &
cd apps/loop-mobile && bash scripts/build-ios-simulator.sh
SIMCTL_CHILD_LOOP_SHOWCASE_HOST=127.0.0.1 SIMCTL_CHILD_LOOP_SHOWCASE_PORT=18777 \
  SIMCTL_CHILD_LOOP_SHOWCASE_CONNECT=1 xcrun simctl launch <UDID> org.reactjs.native.example.LoopMobile
# 스크린샷 1장 → "Show all sessions" 토글 탭 → 스크린샷 2장
```
