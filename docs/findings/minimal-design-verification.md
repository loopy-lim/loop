# 최소 재설계 최종 검증 — 전체 체크 + 스펙 감사

- **태스크:** `design-final-verification` (verification, attempt 0)
- **작성일:** 2026-09-26
- **판정:** **PASS** — 기계 검증 기준 14/14 전부 통과, 스크린샷 기준 2/5 통과 + 3건 데스크톱 캡처 지연(§3 한계)
- **검증 대상:** 결정 [`2026-xx-minimal-design-spec.md`](../decisions/2026-xx-minimal-design-spec.md) §3의 수용 기준(AC-S1~S8) + 요구사항(동작 불변 · SafeArea/키보드 · 경계)
- **쓰기 범위:** 이 문서만 (코드 변경 0건)

---

## 1. 전체 게이트 결과

| 검사 | 결과 | 요약 |
| --- | --- | --- |
| `bun run check` (cwd=repo root, exit code) | **exit 0** | `codegen:check` + `tsc` + `test:architecture`(8 pass) + `cargo test --workspace`(0 fail) + `bun test packages tests plugins`(**553 pass / 0 fail**, 64 files) |
| `bun test apps/loop-mobile/test` | **227 pass / 0 fail** (1,150 expect) | `check` 게이트는 apps를 포함하지 않아 별도 실행 — `design-spec.test.ts`가 AC 전항을 기계 검증 |
| `bun test apps/loop-desktop/test` | **69 pass / 0 fail** (277 expect) | 동일 사유로 별도 실행 |
| 유료 모델 호출 | **0회** | 전부 유닛/정적 검증 — 실기기·시뮬레이터 구동 없음 |

## 2. 스펙 기준별 판정 (AC-S1~S8)

### 기계 검증 — 전부 PASS

| AC | 기준 | 판정 | 증거 |
| --- | --- | --- | --- |
| S1-1 | 데스크톱 `:root` 미러 == 모바일 팔레트 | **pass** | `apps/loop-mobile/test/design-spec.test.ts:71` — styles.css 파싱 vs tokens.ts hex/rgba 전수 일치 단언 (227 통과 분) |
| S1-2 | 호출부 hex 0건(QR SVG 면제) | **pass** | grep: `styles.css`의 hex는 `:root` 미러 블록(:19-37, 스펙 §4가 정의한 유일 리터럴 장소)뿐, TS hex는 `apps/loop-desktop/src/ui/qr.ts:423-424`(스캐너 기능색, 스펙 명시 면제)뿐 |
| S1-3 | `#2f5fd0` 참조 0건 | **pass** | grep `apps/loop-desktop/src apps/loop-desktop/ui apps/loop-mobile/src packages/*/src` → **0건** |
| S2-1 | font-size 변수 경유, 스케일 {26,17,15,12}만 | **pass** | `styles.css` 내 `font-size` 18선언 전부 `var(--type-*)`; `:root` 값은 26/17/15/12px만 (`design-spec.test.ts:105` 재단언) |
| S3-1 | margin/padding/gap ∈ {2,4,8,12,16,24,32}∪{0,auto} | **pass** | grep 토큰 외 리터럴: `margin: 0`, `margin: 0 auto`, `margin-top: 0` 4건(허용 집합)뿐 |
| S3-2 | 모바일 호출부 `space.* ± 숫자` 0건 | **pass** | grep 0건 + `design-spec.test.ts:221` 회귀 감시 테스트 통과. 토큰+토큰 스텝 조합만 존재 |
| S4-1 | border-radius ∈ {4,8,12,16,999}∪{0,50%} | **pass** | `styles.css` 7선언 전부 `var(--radius-*)` |
| S5-1 | `elevation.card` 0건, float는 점프필만 | **pass** | grep: mobile 내 elevation 소비는 `ConversationScreen.tsx:763`(점프필 wrapper) 단일. `design-spec.test.ts:227` 단언 |
| S5-2 | styles.css box-shadow 0, border는 hairline 경유 | **pass** | grep `box-shadow` → 0건; border 선언 전부 `var(--hairline)` 또는 `border: 0` |
| S6-1 | 모션 = fade-in 1종 + reduced-motion 블록 | **pass** | grep: `@keyframes fade-in`(:404) + `.conv-item.enter`(:414) + `@media (prefers-reduced-motion: reduce)`(:417) 외 0건, transition 0건 |
| S6-2 | 자체 모션 타이머 0건, motion.tsx 단일 소비 | **pass** | `design-spec.test.ts:233` — RN 모션 메커니즘 import가 `ui/motion.tsx` 단일 경로 단언 |
| S8-1 | 데스크톱 className 100% 커버 | **pass** | `design-spec.test.ts:182` — TS가 방출하는 모든 클래스에 CSS 규칙 존재 단언 (미스타일 16건 → 0, D3 해소) |
| M1 | `terminalLayout.ts` hex 복제 제거 | **pass** | grep → 0건, tokens 경유 |
| M2 | glyph 마이크로 폰트 토큰 등록 | **pass** | `tokens.ts` `type.glyph`(8) 등록, 소비는 `run-list.tsx:233`·`ConversationScreen.tsx:726` 2건뿐 |

### 스크린샷 기준

| AC | 기준 | 판정 | 증거 |
| --- | --- | --- | --- |
| S5-3 | 행 구분선 없음, 카드 경계 hairline 1개 | **pass** | `docs/research/simulator-showcase/v11/01-chats-list.png`, `02-conversation-tool-card.png` — `.output-line` border-bottom 제거(D5)는 코드로도 확인(styles.css:156 블록에 border 없음) |
| S6-3 | 스트리밍 새 행 페이드 인 | **pass (소충)** | v11 `02-conversation-tool-card.png` → `03-conversation-streaming-arrival.png` 연속 2장 — 도착 상태 차이는 신규 행 1개. 정지 캡처 매체의 한계로 프레임 단위 애니메이션은 미증명(v11 evidence.md 동일 기재) |
| S1-4 | 데스크톱 배경이 모바일과 동일 근흑 | **지연 (코드 검증만)** | `styles.css:75` `body { background: var(--bg) }`, `--bg: #0d1117` = tokens `bg` (S1-1 동등성 테스트로 값 일치는 증명). **재설계 후 데스크톱 스크린샷 미존재** — v11 태스크가 쓰기 범위 밖으로 명시적 지연 |
| S2-2 | 데스크톱 타입 3계층 시각 구분 | **지연** | 상동 — 캡처 증거 없음 |
| S8-2 | 데스크톱 툴카드·버블·steer 표면/반경 패리티 | **지연** | 상동 — 규칙 자체는 styles.css `:216`(툴카드 surfaceAlt+radius.m+hairline), `:264`(버블 userBubble+radius.l), `:381-392`(steer hairline 좌측 인셋+warn 글리프)로 구현·테스트됨 |

### REMOVE 목록 잔존 확인 (S7)

`#2f5fd0` 0건 · `.output-line` border 없음 · `elevation.card` 0건 · terminalLayout hex 0건 · raw glyph font-size 0건(토큰 경유) · 스케일 밖 padding 10/18/20·radius 6 0건 · 미스타일 16개 → 커버리지 테스트 통과. **7건 전부 소멸.**

## 3. 요구사항 검증

- **동작 불변:** 전체 게이트 green(§1). 표현 계층만 변경되고 steer 마커는 표시 전용 유지(styles.css 주석 및 `conv-steer` 규칙 — lifecycle 텍스트·흐름 무변경), 계약 테스트(conversation-contract·pane-contract 등) 전부 통과.
- **SafeArea/키보드:** `App.tsx:273` SafeAreaProvider, `ui/Screen.tsx:31` `useSafeAreaInsets`, `SubmitScreen.tsx:66` KeyboardAvoidingView(padding), composer bottom-inset 위임(`features/composer.tsx:39`) — 재설계 후에도 원형 유지. 모바일 227 테스트가 projection 계약을 회귀 감시.
- **경계(AGENTS.md):** `bun run test:architecture` 8 pass — presentation/ui가 loop-core·provider 개념을 역수입하지 않음. `crates/loop-core` 내 "model" 일치 1건은 문서 주석(`run/worker.rs:13`)뿐. 토큰 모듈은 RN/DOM 표현 자산으로 브리지·codegen 대상 아님(`codegen:check` 통과로 확인).
- **크리덴셜:** 코드 내 내장 자격증명 grep **0건** (`[credential]=[redacted]` — 자격증명은 keychain/credential-store로 아키텍처 테스트가 auth 계층에만 국정화).

## 4. 변경 파일 (이 태스크)

- `docs/findings/minimal-design-verification.md` (신규, 유일 쓰기)

참고: 작업 트리에는 이 워커 체인 이전의 미커밋 변경(orchestrator/gateway/bridge 등)이 다수 존재하며, §1의 `bun run check` green은 그 상태 그대로의 저장소 전체 증거다. 본 태스크는 코드를 전혀 건드리지 않았다.

## 5. 미해결 리스크 / 후속

1. **데스크톱 스크린샷 AC 3건(S1-4·S2-2·S8-2) 미충족.** 값 동등성(S1-1)과 규칙 존재는 기계 증명됐지만 "화면이 실제로 절제 어휘로 보인다"는 시각 증거가 없다. 후속: 데스크톱 창 캡처 태스크(v11 절차의 데스크톱판) — v11 evidence.md도 동일하게 지연 기재.
2. **`bun run check` 게이트가 `apps/**` 테스트를 포함하지 않음**(`bun test packages tests plugins`만). 이번 감사에서 모바일 227+데스크톱 69를 별도 실행해 보완했으나, 회귀 감시망 구멍이므로 check 스크립트 확장을 권고한다(스펙 §5의 `bun test packages` 표기도 apps 미포함 — 결정 문서 개정 후보).
3. **스트리밍 페이드는 정지 캡처 2장 소충** — 프레임 연속성 증명이 필요하면 화면 녹화 기반 후속.
