# 로그아웃 위치 이동 + 텍스트 위계 정돈 — 전/후 증거 (task `logout-relocation-polish`)

캡처 조건: iOS 시뮬레이터(iPhone 17, 부팅 1대), demo 게이트웨이(루프백 18589, 가짜
데이터 `demo-*`), `LOOP_SHOWCASE_*` launch env(v11 캡처 절차 계승). **모델 호출 0회,
유료 비용 0, 실기기 없음.** OCR은 macOS Vision으로 잉크 확인에만 사용.

## 컷 구성

| 파일 | 상태 | 증명 포인트 |
| --- | --- | --- |
| `before-01-chats.png` | BEFORE | 목록 하단 가장자리에 **고정 Log out pill**(bottom inset 미적용, y≈2550/2622)이 마지막 세션 행 제목("Showcase v9: photo attach…")과 **겹쳐 렌더** — 스크롤과 무관하게 항상 화면에 붙어 있는 파괴적 버튼 + 오탭 위험 |
| `after-01-chats.png` | AFTER | 고정 pill 제거. 하단 가장자리가 스크롤 콘텐츠로 깔끔. 행 메타가 간결 카운트로 렌더(`3 done · terminal · session ended`) |
| `after-02-chats-scrolled.png` | AFTER (스크롤) | 목록 끝의 **조용한 Log out 행**: hairline 위, caption/inkFaint(가장 잔잔한 잉크 단계 — OCR도 읽지 못할 톤), 44pt 터치 높이, 홈 인디케이터 여백 확보 |
| `after-03-logout-confirm.png` | AFTER (탭) | 행 탭 → **확인 얼럿** "Log out?" + "The saved gateway credential is deleted on this device; the next launch asks you to sign in." + Cancel / **Log out(destructive)** |
| `after-04-after-logout-connect.png` | AFTER (확정) | destructive 탭 → Keychain 삭제 + 연결 해제 → **수동 Connect 복귀**(host/port 프리필, 토큰 필드 빈 값 — credential 결정 D2-4 계약 불변) |

## 기계 검증

- `test/logout-placement.test.ts` — 소스 검사 3개 게이트: (1) App에 고정 로그아웃
  버튼 없음(핸들러는 App 소유), (2) 푸터가 SESSIONS 섹션 **뒤** 목록의 마지막
  자식 + hairline/caption 톤, (3) 행 onPress는 `Alert.alert` 개봉뿐 — 핸들러는
  destructive 버튼이 유일한 호출 경로.
- `bun test apps/loop-mobile/test` 278 pass / 0 fail, `bun run typecheck` 통과.
- 픽셀 대조: BEFORE 하단 `x=54..183` pill 클러스터가 AFTER에서 소멸(전면 스캔).

## 재실행

```bash
cd apps/loop-mobile && bash scripts/build-ios-simulator.sh && cd ../..
bun apps/loop-mobile/scripts/demo-gateway.ts 18589 &   # 가짜 데이터 게이트웨이
# 시뮬레이터 런치: LOOP_SHOWCASE_BEARER=demo-token HOST=127.0.0.1 PORT=18589 CONNECT=1
# 스크롤/탭 합성: cliclick(시뮬레이터 창 좌표) — after-02~04 절차
```
