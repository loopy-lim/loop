# fab-icons DP 브리프 — 스폰 FAB 전환 + SF Symbols 아이콘 체계 (캐논 v3 근거)

- **태스크:** `fab-icons` (implementation, attempt 0)
- **접수 경로:** design-language.md DP lane → 캐논 `design-system.md` v3 개정 (§3 탐색과 아이콘·버튼 위계·pill 허용처·§5 float 범위·§6 REMOVE 11·12·§7 감시 표)
- **작성일:** 2026-10-08
- **쓰기 범위:** 본 문서 (`docs/design/audits/`) + 구현 범위 (apps/loop-mobile)

---

## 1. 문제 특정

| ID | 문제 | 증거 |
| --- | --- | --- |
| **P-1** | **유니코드 글리프가 이모지로 렌더링된다.** ⚠ (U+26A0)는 이모지 기본 표시(Emoji_Presentation=Yes) 코드포인트라 iOS 시스템 폰트 폴백에서 색 이모지 변형으로 렌더링된다. attention 행·런 상태 등 상태 신호가 절제 토큰이 아니라 플랫폼 이모지로 나가는 것은 캐논 §1(상태는 닫힌 삼합의 소면적 마크) 위반이자 예측 불가 렌더링이다 | `src/ui/glyphs.ts` v2 어휘; iOS 실측 (⚠️ 렌더) |
| **P-2** | **스폰 카드가 컴포저 뷰포트의 시각 덩어리였다.** 채팅 홈 1차 액션(Submit) 아래에 "New TUI session" 라벨 카드가 전폭 2차 버튼+상태줄로 자리 잡아 스크롤 앵커를 잠식 — 스폰은 저빈도 보조 진입인데 표면 점유는 1차급이었다 | `features/spawn-card.tsx` (폐기 전); SubmitScreen 레이아웃 |
| **P-3** | **아이콘 렌더 경로가 호출부 재량이었다.** v2 어휘는 문자열 목록이라 iOS에서 SF Symbol을 쓸지 텍스트 글리프를 쓸지 각 호출부가 정했다 — 렌더 일관성 보장이 없고 P-1이 그 틈으로 유입됐다 | ui/glyphs.ts 소비처 17개 파일 |

## 2. 결정

**D-1. 역할 키 폐쇄 레지스트리 + 이중 렌더 경로.** ui/glyphs.ts를 역할(ROLE) 단위 레지스트리로 승격한다. 각 역할은 (a) SF Symbol 이름(iOS 렌더), (b) VS15(U+FE0E) 고정 유니코드 폴백을 함께 등록하며, 파생 뷰 `glyph`가 인라인 텍스트 플로우에 텍스트 경로를 단일 제공한다. 뷰 레벨 아이콘은 ui/Icon 컴포넌트 하나로만 렌더링된다.

**D-2. iOS SF Symbols 네이티브 뷰.** `LoopIcon`(RCTViewManager, UIImageView + `UIImage(systemName:pointSize:weight:)` 템플릿 렌더)을 신설하고 ui/Icon이 iOS에서 이를 사용한다. 틴트는 토큰 색 역할을 그대로 받는다(RCTConvert UIColor — rgba()/hex 토큰 문자열). Symbol 이름은 배포 타깃(iOS 15.1)에서 유효한 것만 등록한다. 알 수 없는 심볼은 추측 대신 빈 렌더.

**D-3. 이모지 프리젠테이션 금지.** 모든 레지스트리 텍스트 값은 VS15 고정(단일 헬퍼 경유), VS16은 앱 소스 전역 금지 — `test/icon-registry.test.ts`가 레지스트리 값·소스를 회귀 감시한다(캐논 §6-11).

**D-4. 스폰 카드 → 원형 FAB.** 채팅 홈 우하단 56pt 원형(≥44pt 터치) FAB로 교체. 위계는 **2차 티어 유지**(surface 필 + hairline + `elevation.float`) — 화이트 CTA를 쓰면 Submit과 강조가 이원화되므로 §4를 개정하지 않는 선에서 해소된다. 생성 중·대기·타임아웃·차단 상태는 버튼 위 유일한 동반 pill로 인라인 유지하며, 생성 중 마크는 등록 어휘의 "···" 정적 신호다(§5 신설 모션 금지 준수). 플로우 로직(게이트 학습, before/after 세션 탐색, 문제 포맷)은 `features/session-spawn.ts`에서 불변 — 표면만 교체했다.

## 3. 대안 비교 (기각 포함)

| 대안 | 판정 | 이유 |
| --- | --- | --- |
| **A(채택): SF Symbol 레지스트리 + VS15 텍스트 폴백** | 채택 | 플랫폼 관행(iOS HIG) 부합, 이모지 폰트 도달 불가, 역할 폐쇄 집합 유지. 인라인 텍스트 플로우(마크다운 불릿·스트리밍 커서)는 네이티브 뷰가 텍스트 중간에 못 들어가므로 VS15 텍스트가 정답 |
| B: VS15만 전역 적용 (SF Symbols 미도입) | 기각 | P-1은 막지만 P-3(호출부 재량·비관행 렌더)이 남는다. 글리프가 폰트 폴백 체인에 의존하는 건 유지되고, C-5(아이콘 0개) 해소 방향과 역행 |
| C: 텍스트 안 이모지 방지를 전부 NSTextAttachment/Attributed 문자열로 | 기각 | 모든 DynText 경로를 NSAttributedString 파이프라인으로 바꿔야 함 — 구현 비용 대비 이득이 A의 10% 미만. 동적 타입 상한(DynText)과 상호작용 리스크만 추가 |
| 스폰 FAB를 1차(화이트 CTA)로 | 기각 | §4 강조 예산 — 뷰포트당 강한 강조 1개(Submit) 원칙 유지. FAB는 2차 티어가 옳다 (canon v2부터 spawn은 2차 보조 액션) |
| 스폰 카드 유지 + FAB 병행 | 기각 | 동일 액션의 이중 표면 — 드리프트. 카드는 완전 폐기 |

## 4. 트레이드오프

- (+) 상태 신호의 렌더가 플랫폼 이모지에서 분리됨 — 절제 토큰 통제 회복.
- (+) iOS 아이콘이 시스템 어휘(SF Symbols)로 승격 — 탭·헤더·행 마크의 판독성 향상 (C-5 후속).
- (−) 네이티브 뷰 1종(LoopIcon)이 빌드에 추가 — Swift/ObjC/pbxproj 유지보수점 2파일.
- (−) 인라인 텍스트 글리프는 이모지 방지는 되지만 SF Symbol 미적용 — 텍스트 플로우의 구조적 한계로 명시(레지스트리 `sf: null` 2역할 한정).
- (−) VS15가 폰트별로 렌더 차이를 낼 이론적 여지 — 시스템 폰트에서 default-ignorable로 검증됨.

## 5. 검증 (유료 호출 없음)

`bun test apps/loop-mobile/test` (icon-registry 게이트 포함) · `bunx tsc --noEmit` · `bun run test:architecture` · 드리프트 grep 건 — 전부 기계 검증. 시뮬레이터 실측( SF Symbol 렌더 확인)은 별도 evidence로 승계.
