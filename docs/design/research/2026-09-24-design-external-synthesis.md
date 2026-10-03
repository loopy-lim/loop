# 외부 조사 종합 — Loop design.md 보류 결정 D-1~D-6

- **일자:** 2026-09-24 KST
- **종류:** `research synthesis` (`synthesize-external-vs-loop`, attempt 0)
- **대상 정본:** [`docs/design/design.md` §8](../design.md#8-미해결-질문위험) (`draft`, 승인 대기)
- **입력 조사:**
  - [`2026-09-24-oss-tui-design-followup.md`](./2026-09-24-oss-tui-design-followup.md) — Codex CLI, Goose, lazygit, btop++
  - [`2026-09-24-token-theme-width-practices.md`](./2026-09-24-token-theme-width-practices.md) — DTCG 2025.10, Style Dictionary, Fluent 2, GitHub CLI/go-gh, Bubble Tea
- **변경 범위:** 이 종합 문서만 작성한다. 승인 게이트 전이므로 `design.md` 본문과 코드는 변경하지 않는다.

> **결정 ID 정규화:** 태스크 Intent의 괄호에는 D-1을 herdr 라벨, D-2를 폭으로 적은 요약이 있으나, 승인 대상 정본인 [`design.md` §8](../design.md#8-미해결-질문위험)은 **D-1=토큰 명명, D-2=herdr 라벨 소유권, D-3=불릿, D-4=색 범위, D-5=폭 정책, D-6=토큰 포맷/다중 테마**로 정의한다. 아래에서는 이 정본 ID를 사용한다.

## 1. 판정 기준

- **즉시 채택 권고:** 현재 제안을 승인 게이트에서 확정할 외부 근거가 충분하고, 별도의 런타임 관찰 없이도 인터페이스·소유권 또는 의미 규칙을 결정할 수 있다.
- **조건부:** 경계와 정책 방향은 지금 확정할 수 있지만, 구현 착수에는 재현 증거나 세부 정책 결정이 더 필요하다.
- **연기 유지:** 현재 복잡성을 추가할 실사용자가 없으며, 명시된 트리거가 생기기 전에는 현 구조가 더 단순하다.

외부 사례는 그대로 복제하지 않고 Loop의 경계에 맞춰 해석한다. 특히 fullscreen TUI의 비-TTY 실행 거부는 파이프 출력이 정상 사용례인 Loop에 적용하지 않으며, 환경 관찰은 CLI 어댑터, 결정론적 표현은 presentation, 운영 상한은 기존 policy/config 흐름이 소유해야 한다.

## 2. 결정 × 외부 근거 × 권고

| 결정 | `design.md`의 현재 제안 | 외부 근거 | 판정 | Loop 권고 |
| --- | --- | --- | --- | --- |
| **D-1 토큰·어휘 명명** | [`§5.3`](../design.md#53-명명-규칙--d-1-제안-해소-승인-시-확정)의 `status.<state>.glyph`, `separator.*`, `empty.*`, `color.role.*` 점 경로 | Codex `StatusTone`, Goose `success/warning/danger`, lazygit `ActiveBorderColor`, btop `inactive_fg`는 모두 물리색보다 **용도**를 이름에 둔다([후속 조사 §6.1](./2026-09-24-oss-tui-design-followup.md#61-d-1--토큰어휘-명명)). DTCG는 토큰 그룹·별칭·`$value/$type`을 안정된 포맷으로 제공한다([토큰 조사 §2](./2026-09-24-token-theme-width-practices.md#2-dtcgw3c-design-tokens-스펙-현황), [DTCG Format](https://www.designtokens.org/TR/2025.10/format/)). | **즉시 채택 권고** | 의미 축을 이름에 두는 현재 점 경로안을 승인하고 ADR로 고정한다. 단, glyph와 color를 하나의 복합 토큰으로 묶지 말고 `status.<state>.glyph`와 상태→`color.role` lookup을 독립시켜 무색 출력에서도 의미를 보존한다. |
| **D-2 herdr 라벨 소유권** | [`§5.5`](../design.md#55-표시-규격-통합-표-p3-3의-문서-반쪽)에 32자·형식을 규격화하고 구현은 herdr에 유지 | 네 OSS 사례는 공용 색·글리프 역할은 theme/presentation에 두되 표면 전용 자원 식별 형식은 해당 렌더러 가까이에 둔다. 조사 결론은 herdr-only 라벨이면 현 위치를 유지하고, 두 번째 소비자나 중복 정책이 생길 때 이관하라는 것이다([후속 조사 §6.2](./2026-09-24-oss-tui-design-followup.md#62-d-2--herdr-라벨-소유권), [§7 대안](./2026-09-24-oss-tui-design-followup.md#herdr-라벨-소유권)). | **즉시 채택 권고** | **herdr 유지+규격화**를 현재 결정으로 확정한다. presentation 이관 트리거를 “CLI/presentation의 두 번째 소비자 발생” 또는 “separator·축약 구현의 중복 발생”으로 좁힌다. Herdr의 32자 터미널 제약을 범용 presentation API로 선제 누수시키지 않는다. |
| **D-3 불릿 어휘** | [`§5.4`](../design.md#54-글리프색-범위--d-3d-4-제안-해소-승인-시-확정)의 성공 `✓` / 경고 `!` / 중립 `-`, 값 불변 | Codex와 Goose는 success/attention-or-warning/failure 의미 역할을 분리하고, btop은 글리프를 `Symbols` 단일 원천에 둔다([후속 조사 §2.1](./2026-09-24-oss-tui-design-followup.md#21-a-시맨틱-색-역할--폐쇄된-상태-tone--환경-적응), [§5.3](./2026-09-24-oss-tui-design-followup.md#53-c-글리프구분자빈-상태--symbols-namespace가-강한-단일-원천), [§6.3](./2026-09-24-oss-tui-design-followup.md#63-d-3d-4--불릿과-1차-색-범위)). Codex의 분산 glyph는 색 SSOT만으로 어휘 중복이 해결되지 않음을 보여준다([§2.3](./2026-09-24-oss-tui-design-followup.md#23-c-글리프구분자빈-상태--단일-원천-아님)). | **즉시 채택 권고** | 현재 3역할 의미를 확정한다. 색은 보조 신호로만 사용하고 glyph 자체가 무색·비-TTY에서도 의미를 유지하게 한다. 값은 현행과 같으므로 이관 단계의 바이트 동일 원칙과도 양립한다. |
| **D-4 색 1차 범위** | [`§5.4`](../design.md#54-글리프색-범위--d-3d-4-제안-해소-승인-시-확정)의 task 상태색 + 환경 가드, ANSI 16색 시작 | Codex의 닫힌 상태 tone과 밝은/불명 배경 `Reset` 폴백, Goose의 `NO_COLOR`+비-TTY 평문 경로, btop의 동일 역할 키 normal/TTY 맵이 최소 역할층과 환경 적응을 지지한다([후속 조사 §6.3](./2026-09-24-oss-tui-design-followup.md#63-d-3d-4--불릿과-1차-색-범위)). GitHub CLI도 거대한 토큰 체인 없이 `ColorScheme`의 `SuccessIcon`·`WarningIcon`·`FailureIcon`·`Muted` 역할 API를 운용한다([토큰 조사 §5](./2026-09-24-token-theme-width-practices.md#5-토큰-파일-없이-역할-api만-운용-github-cli), [GitHub CLI source](https://github.com/cli/cli/blob/trunk/pkg/iostreams/color.go)). | **즉시 채택 권고** | task 상태 역할과 `NO_COLOR`/비-TTY 가드까지만 1차 범위로 확정하고 ANSI 16색으로 시작한다. raw 색을 호출점에 공개하지 않는다. attention 전체·truecolor·배경 감지·부분 갱신은 이번 결정에 넣지 않는다. |
| **D-5 터미널 폭 인식 `lineTextLimit`** | [`§8`](../design.md#8-미해결-질문위험)에서 P3-2 체감 문제 재확인까지 구현 연기 | Codex는 `Rect.width`, lazygit은 resize→rerender, btop은 OS 관찰→최소 크기 정책으로 관찰과 렌더 결정을 나눈다([후속 조사 §6.4](./2026-09-24-oss-tui-design-followup.md#64-d-5--폭-관찰과-linetextlimit-정책)). GitHub CLI/go-gh는 IO 계층이 폭을 관찰하고 구분자·고정 열을 뺀 `maxWidth`를 renderer에 전달하며, Bubble Tea는 resize를 메시지로 모델에 전달한다([토큰 조사 §6](./2026-09-24-token-theme-width-practices.md#6-터미널-폭-사례-1-github-cligo-gh-테이블), [§7](./2026-09-24-token-theme-width-practices.md#7-터미널-폭-사례-2-bubble-tea-pager)). | **조건부** | 구현 연기는 유지하되 구조는 지금 고정한다: `CLI 폭 관찰 → 기존 policy/config의 순수 effective-limit 계산 → presentation 숫자 입력`. 후보식은 `min(configuredLimit, observedColumns - reservedColumns)`이다. 80/100/120열 wrap 또는 watch resize 문제가 재현되면 구현하며, 그 전에 display-cell 대 grapheme, 비-TTY/관찰 실패 폴백, 최소 폭을 별도 결정한다. |
| **D-6 토큰 포맷·다중 테마** | [`§8`](../design.md#8-미해결-질문위험)에서 Rust/TS 공유 필요까지 W3C JSON 승격 연기 | DTCG 2025.10은 stable Final Community Group Report지만 W3C Recommendation은 아니며, Format과 theme Resolver는 별도 관심사다([토큰 조사 §2](./2026-09-24-token-theme-width-practices.md#2-dtcgw3c-design-tokens-스펙-현황), [DTCG reports](https://www.designtokens.org/TR/2025.10/)). Style Dictionary의 source→transform→generated target 체인은 다중 배포 타깃에서 가치가 생긴다([토큰 조사 §3](./2026-09-24-token-theme-width-practices.md#3-단일-원천배포-체인-style-dictionary)). Fluent 2와 GitHub CLI는 동일 shape의 typed theme/역할 API만으로도 테마 차이를 숨길 수 있다([§4](./2026-09-24-token-theme-width-practices.md#4-글로벌시맨틱-토큰과-라이트다크-전환-fluent-2), [§5](./2026-09-24-token-theme-width-practices.md#5-토큰-파일-없이-역할-api만-운용-github-cli)). | **연기 유지** | 현재는 typed TS 역할 상수를 단일 원천으로 유지한다. 재질의 트리거를 Rust/TS 공유뿐 아니라 두 번째 생성 타깃, 코드 밖 소비자, 실제 light/dark/high-contrast 요구, 첫 수작업 드리프트로 확대한다. 트리거 발생 시 DTCG JSON+생성과 동일 shape typed theme factory를 함께 비교한다. |

## 3. 결정별 해석과 경계 영향

### D-1 — 이름은 지금 잠그되 저장 포맷은 잠그지 않는다

외부 프로젝트의 공통분모는 `green` 같은 구현값이 아니라 `success`, `activeBorder`, `inactive` 같은 **용도 언어**다. 이는 현재 [`design.md` §5.3](../design.md#53-명명-규칙--d-1-제안-해소-승인-시-확정)을 지지한다. 점 경로는 향후 DTCG 그룹/별칭으로 옮기기 쉬운 이름 체계지만, DTCG 채택 자체를 뜻하지 않는다.

소유권은 다음처럼 분리하는 것이 가장 작다.

```text
presentation vocabulary: status.<state>.glyph, separator.*, empty.*
presentation color roles: color.role.* + state → role lookup
theme implementation: role → ANSI value (D-4 범위)
```

이 분리는 Codex가 보여준 “시맨틱 스타일 중앙화와 glyph 중복은 별개 문제”를 피한다. ADR은 이름 문법과 허용 축만 고정하고 JSON schema나 theme resolver를 선제 도입하지 않아야 한다.

### D-2 — 표면 제약은 표면에, 공유 어휘만 presentation에 둔다

`<taskId>·<kind>·a<attempt>`와 32자 예산은 현재 Herdr 탭이라는 단일 표면의 자원 식별 계약이다. 이를 즉시 presentation으로 옮기면 Herdr 개념과 제한이 범용 프레젠테이션 모듈에 유입될 수 있다. 따라서 현재의 **herdr 유지+`design.md` 규격화**가 계층 경계를 가장 잘 보존한다.

다만 라벨 내부의 `·`가 공용 separator 토큰과 의도적으로 같다는 점은 규격에서 추적할 수 있어야 한다. 두 번째 소비자가 생기면 라벨을 “문자열”로 공유하기보다 `taskId/kind/attempt/budget`을 명시적으로 받는 순수 formatter로 이관하는 대안을 다시 비교한다.

### D-3·D-4 — 무색 의미를 먼저, 색은 최소 보강으로 둔다

세 glyph 역할은 기존 출력값을 바꾸지 않으면서 의미를 명시한다. 색은 glyph를 대체하지 않는다. 따라서 `NO_COLOR`, 비-TTY, ANSI 16색만 가능한 환경에서도 성공·경고·중립 구분이 유지된다.

D-4의 환경 데이터 흐름은 다음 경계를 지켜야 한다.

```text
CLI adapter: isTty, NO_COLOR 관찰
  → presentation entry: color mode / clear 가능 여부 결정
  → renderer: 닫힌 ColorRole만 소비
  → stdout
```

fullscreen TUI인 Codex·lazygit·btop의 비-TTY 거부는 Loop에 그대로 적용하지 않는다. 평문 파이프가 정상 경로인 Loop에는 Goose·GitHub CLI식 “제어 시퀀스 없는 평문”이 더 적합하다.

### D-5 — 구현보다 관찰·정책·렌더 경계를 먼저 확정한다

두 조사 모두 폭 인식 자체보다 **책임 분리**에 강한 합의를 보인다.

```text
packages/cli (environment observer)
  { isTty, terminalColumns? }
      ↓
기존 policy.toml → orchestrator config 흐름 (pure policy)
  effectiveLimit = f(configuredLimit, observedColumns, reservedColumns, minimumWidth)
      ↓
packages/presentation (deterministic renderer)
  lineTextLimit: effectiveLimit
```

이 구조는 `loop-core`에 terminal 개념을 넣지 않고, 같은 입력의 렌더 결과를 결정적으로 유지한다. 다만 현재 160 한도는 grapheme 계약인데 실제 terminal fit은 display cell 기준이므로, 구현 전 호환성 결정을 분리해야 한다. 좁은 폭의 실제 실패를 아직 재현하지 않았다면 YAGNI 원칙상 구현 연기가 맞다.

### D-6 — 안정된 포맷은 도입 필요성의 증거가 아니다

DTCG 2025.10의 안정화로 “초안이라서 연기”하는 근거는 제거해야 한다. 그러나 Loop는 현재 단일 TS presentation 소비자와 단일 theme만 가지므로, typed 상수가 이미 가장 짧은 단일 원천이다. JSON 원본·검증·생성물·codegen check를 더하면 소비자 없이 배포 체인만 늘어난다.

향후 Rust가 같은 토큰을 소비하면 저장소 경계 원칙에 따라 Rust bridge 타입을 먼저 바꾸고 codegen을 사용해야 하며, TS가 Rust 도메인 타입을 손으로 복제해서는 안 된다. 다중 테마만 필요한 경우에는 DTCG resolver보다 동일 `Theme` shape의 typed factory가 더 작은 대안일 수 있다.

## 4. 승인 리뷰에 대한 종합 권고

1. **D-1, D-2, D-3, D-4는 `design.md`의 현재 제안을 승인 시 확정한다.** D-2의 “즉시 채택”은 presentation 이관이 아니라 **현 위치 유지+규격화 결정의 확정**을 뜻한다.
2. **D-5는 조건부로 유지한다.** 구현은 연기하지만 관찰자·정책·렌더러의 경계와 재현 트리거를 후속 결정문에 명시한다.
3. **D-6는 연기 유지한다.** 단, 연기 이유를 포맷 불안정성이 아니라 “다중 소비자·다중 theme 부재”로 갱신하고 트리거를 확대한다.
4. 본 문서는 근거만 제공한다. [`design.md` §8](../design.md#8-미해결-질문위험)의 상태 변경과 ADR 생성은 승인 게이트 이후 별도 태스크가 수행한다.

## 5. 후속 결정 태스크 후보

| 후보 id | 종류 | 착수 조건 | 결정해야 할 것 | 예상 산출물 |
| --- | --- | --- | --- | --- |
| `decide-token-naming-adr` | decision | `design.md` 승인 | D-1 점 경로 문법, glyph/color 축 분리, 금지되는 raw 이름 | `docs/decisions/` 신규 ADR |
| `decide-herdr-label-ownership` | decision | 두 번째 라벨 소비자 또는 separator/축약 중복 발생 | herdr 유지 vs 명시적 입력의 presentation formatter 이관; 32자 예산 소유권 | 별도 ADR 또는 현 규격 유지 결정 |
| `decide-terminal-width-policy` | decision | 80/100/120열 wrap, watch resize 오류, 사용자 캡처 중 하나 재현 | display-cell vs grapheme, reserved columns, 최소 폭, 비-TTY·관찰 실패 폴백, resize 재관찰 | 폭 정책 ADR + 구현 태스크 입력 |
| `decide-token-source-format` | decision | D-6 트리거 중 하나 발생 | typed theme factory vs DTCG 2025.10 JSON, 검증기, 생성 타깃, 원본/생성물 경계 | 포맷 ADR; 필요 시 bridge/codegen 계획 |

D-3·D-4는 외부 근거가 현재 제안과 일치하고 독립적인 미지수가 남지 않아 별도 결정 태스크를 기본으로 만들 필요가 없다. 승인 리뷰가 값을 수정하는 경우에만 별도 decision 태스크를 추가한다.

## 6. 남은 위험

- **D-5 측정 단위:** grapheme 수는 CJK/emoji의 terminal cell 폭과 다르다. 기존 계약을 바꾸면 스냅샷·정책 문서에 호환성 영향이 생긴다.
- **D-5 비-TTY 정책:** 외부 사례도 평문 무제한, 기본 폭, 실행 거부로 갈린다. Loop의 파이프 사용례를 기준으로 별도 확정해야 한다.
- **D-6 도구 지원:** DTCG 보고서는 stable이지만 W3C Recommendation은 아니며, 선택 도구가 Format/Resolver 전체를 구현한다고 가정할 수 없다.
- **D-2 이관 시 경계:** 향후 이관하더라도 presentation이 Herdr 세션·pane 타입을 import하지 않고 명시적 primitive 입력만 받아야 한다.

## 7. 판정 요약

- **D-1 — 즉시 채택 권고:** 의미 기반 점 경로 명명을 확정하되 glyph와 color lookup은 분리한다.
- **D-2 — 즉시 채택 권고:** herdr-only 라벨은 herdr에 유지하고 32자·형식을 규격화하며, 두 번째 소비자/중복을 이관 트리거로 삼는다.
- **D-3 — 즉시 채택 권고:** 성공 `✓`·경고 `!`·중립 `-`의 3역할을 값 변경 없이 확정한다.
- **D-4 — 즉시 채택 권고:** task 상태색과 환경 가드만 ANSI 16색으로 시작하고 raw 색·추가 표면은 제외한다.
- **D-5 — 조건부:** 관찰→순수 정책→렌더 입력 경계는 확정하되, 폭 문제 재현과 세부 단위 결정 전까지 구현은 연기한다.
- **D-6 — 연기 유지:** typed TS 역할 상수를 유지하고 다중 소비자·실제 다중 theme·드리프트가 생길 때 포맷을 재결정한다.
