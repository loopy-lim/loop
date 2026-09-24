# Loop 디자인 파운데이션 권고안

- **일자:** 2026-09-24 KST
- **종류:** `recommendation` (synthesize-foundations, attempt 0)
- **작성 근거(선행 리서치 3건):**
  - `docs/design/research/loop-ui-audit.md` — Loop 현재 UI 상태 감사 (P1–P4, worktree `86413fa` 기준)
  - `docs/design/research/oss-agent-ui-survey.md` — 에이전트/TUI 6개 프로젝트 사례 조사 (pi, opencode, gemini-cli, aider, crush, claude-code)
  - `docs/design/research/design-system-practices.md` — 업계 디자인 시스템 관행 조사 (W3C 토큰 스펙, Primer, Polaris, Ink, Ratatui, Lipgloss)
- **증거 경계(선행 문서의 한계 승계):**
  - 감사는 **정적 소스 조사**다. 런타임 플리커·물리 줄바꿈 재현은 별도 증거가 필요하다(§5 Step 6에서 보완).
  - OSS 조사는 **2026-09-24 클론 HEAD 기준**이며 upstream 변동 가능하다.
  - 관행 조사의 토큰 이름 규칙(`status.<state>.glyph` 등)은 제안에 불과하며 본 문서도 확정하지 않는다(§6 D-1에서 ADR로 승격).
- **아키텍처 전제:** AGENTS.md 경계(`loop-core → loop-store → loop-bridge → generated protocol → orchestrator → adapters/UI`)와 "presentation은 protocol 타입 위의 얇은 렌더 프리미티브" 정의(`docs/architecture.md`)를 준수한다. 본 권고는 Rust 도메인·bridge·codegen 변경을 수반하지 않는다.

---

## 0. 결과 요약

Loop의 UI 불일치·불안정은 "디자인 정책 부재"가 아니라 **"표현 어휘의 단일 원천 부재"**다. 줄 수 예산 정책(`config/policy.toml [output]`, `docs/decisions/ui-output-limits.md`)은 존재하지만, 글리프·구분자·빈 상태·overflow 문구·상태 표현은 호출점마다 재발명되고 있다(감사 P2). 색·테마 계층은 전무하며(P1), 유일한 ANSI가 비-TTY에서도 무조건 방출되는 화면 클리어다(P1-3, P3-1).

### 권고 상위 3개

| # | 권고 | 해소하는 감사 문제 | 근거 사례/출처 |
| --- | --- | --- | --- |
| **D1** | `@loop/presentation`에 **표현 어휘 토큰 모듈** 신설 — 상태 글리프(`✓`/`!`), 구분자, 빈 상태 상수, overflow 문구 팩토리를 상수 데이터로 단일화하고, `main.ts`의 CLI 전용 포맷터 4종(doctor/benchmark/models/cleanup)을 명시적 입력의 프리미티브로 presentation에 이관. `renderRuns` 이중 구현과 `replace("Next: /loop", …)` 역직렬화 제거 | P2-1~P2-6, P4-1 | 감사 §3-1; Ratatui 위젯 경계 지침(명시적 입력 구조체); opencode `dialog-*` 조합 컴포넌트·pi-tui 극소 프리미티브(§2 사례 비교); Primer 단일 출처 원칙 |
| **D2** | **최소 시맨틱 토큰 + 환경 가드** — 색 역할의 폐쇄 집합(success/warning/error + accent/muted/dim/text)을 presentation에 두고, `NO_COLOR`·비-TTY 감지를 렌더 진입 한 곳에서 처리. 첫 소비자는 task 상태색(P1-1)과 watch 클리어 가드(P1-3) | P1-1~P1-4, P3-1 | pi `ThemeColor`/`Theme.fg()` 접근 강제; gemini-cli `SemanticColors` 2계층; no-color.org 규약; Lipgloss 프로파일 다운샘플링 |
| **D3** | **일관성을 도구로 강제** — (a) presentation 밖 파일의 ANSI/색 리터럴 금지를 기존 `tests/architecture-boundaries.test.ts` 패턴으로 확장, (b) 토큰 모듈 무결성 단위 테스트(모든 상태에 글리프·역할 존재, overflow 문구가 `… {omitted} more {noun}` 계약 준수), (c) 기존 `cli.test.ts` 계약 테스트를 회귀 망으로 승격 | P2 전체의 재발 방지, P4 구조 고정 | Polaris `color/color-no-hex`(린트로 우회 금지); opencode 순환 참조·중복 이름 테스트; pi 커스텀 check 스크립트; Ink `lastFrame`·Ratatui `TestBackend`+insta 스냅샷 관행 |

### 후속 결정 필요 사항 (상세는 §6)

- **D-1** 토큰·어휘 이름 규칙 확정 — `status.<state>.glyph`류 점 경로 규칙을 ADR로 기록해야 함(관행 문서의 명시적 유보 승계).
- **D-2** herdr 워커 라벨 규칙(`workerLabel`, 32자 예산)의 소유권 — presentation 이관(어휘 단일화) vs herdr 유지+사양 문서화(비용 최소). §4.1-C에서 대안 비교.
- **D-3** cleanup의 `-` 글리프 의미 확정 — 제거 항목 불릿 `-`와 doctor의 성공 `✓`/경고 `!`를 어느 어휘로 통일할지.
- **D-4** 색 도입 범위와 1차 소비자 우선순위, ANSI 16색 vs truecolor 시작점.
- **D-5** 터미널 폭 인식 `lineTextLimit` — `config/policy.toml` 정책 변경을 수반하므로 정책 결정 필요.
- **D-6** W3C JSON 토큰 포맷 승격 시점(Rust/TS 토큰 공유 트리거 발생 시).

---

## 1. 문제 정의 (Loop 감사 기반)

### 1.1 현황 한 줄 요약

Loop에는 "줄 수 예산"이라는 얇은 디자인 정책은 있으나(`config/policy.toml [output]` 5키 → `packages/orchestrator/src/config.ts:165-175`, `docs/decisions/ui-output-limits.md`와 일치), **시각 언어(색·강조·상태 표현) 정책과 표현 어휘의 단일 원천이 없다.** 전 코드베이스에서 유일한 ANSI 이스케이프는 `packages/cli/src/main.ts:188`의 화면 클리어이며, 색상 의존성 자체가 없다. 같은 제품의 pi 내부 표면(pi-extensions todo-widget)은 pi theme 토큰 8종을 경유하므로, "무색 텍스트 CLI"와 "토큰 기반 TUI"라는 두 시각 체계가 공유 어휘 없이 병존한다.

### 1.2 문제 목록 (감사 P1–P4, 근거 파일:줄)

| 그룹 | 문제 | 대표 근거 |
| --- | --- | --- |
| **P1. 색·상태 시각화 계층 부재** — "불안정해 보이는" 근원 1 | 상태(running/failed/attention/done)가 단어로만 구분되고 시각적으로 동등하게 출력(우선순위 정렬은 렌더링에 미반영). 스타일 프리미티브 0개. `NO_COLOR`/TTY 미처리로 비-TTY에서도 클리어 방출. pi 표면과 CLI의 시각 체계 이중화 | `packages/presentation/src/snapshot.ts:160-171`, `packages/cli/src/main.ts:188` |
| **P2. 표현 어휘의 중복·불일치** | 성공/실패 글리프가 포맷터마다 하드코딩(`✓`/`!` vs `-`/`!`). overflow 문구 12개 변종이 인라인 람다로 중복. 빈 상태 문자열 표면별 정의(`No runs` 두 패키지 이중 정의). runs 렌더링 이중 구현(CLI가 `renderRuns` 미사용). 포맷 후 `replace()` 문자열 수술. 구분자 관행 불일치(`·` 17곳 / `: ` / `←`) | `packages/cli/src/main.ts:574,617,549,552,130,530` / `packages/presentation/src/snapshot.ts:23-31,99` 등 |
| **P3. 레이아웃·갱신 안정성** | watch가 매 갱신마다 전체 하드 클리어(플리커 여지, 커서·스크롤백 상실). 터미널 폭 미탐지로 `lineTextLimit=160` grapheme 고정 — 좁은 터미널에서 물리 줄바꿈으로 8줄 예산 붕괴. herdr 라벨 예산(32자)과 CLI 라인 예산(160 grapheme)이 서로 다른 규칙 체계로 병존 | `packages/cli/src/main.ts:188`, `packages/orchestrator/src/config.ts:175`, `packages/herdr/src/client.ts:548-591` |
| **P4. 구조 문제** | `main.ts` 909줄 모놀리스(인자 파싱+디스패치+포맷터 4종+help+프로세스 스폰). 워커 표시 라벨 규칙(`workerLabel`/`KIND_ALIASES`)이 터미널 어댑터(herdr) 소유 — 표시 어휘의 원천이 presentation 밖에 위치 | `packages/cli/src/main.ts:532-625`, `packages/herdr/src/client.ts:548-591` |

### 1.3 인과 구조

P4(포맷터가 presentation 밖에 흩어짐)가 P2(어휘 중복)의 구조적 원인이고, P2가 색 도입을 막는다(색을 붙일 단일 지점이 없으므로). P1/P3는 그 결과로 "모든 것이 회색 텍스트 + 전체 클리어"로 출력되는 체감 불안정으로 나타난다. 따라서 수정 순서는 **어휘 단일화 → 토큰·환경 가드 → 갱신 안정화**여야 하며, 역순(색부터)이면 호출점 대량 수정이 두 번 일어난다.

### 1.4 문서 공백

`docs/design/`에는 UI/디자인과 무관한 `jwt-validation-middleware.md` 하나만 있었다. 디자인 지식은 `docs/decisions/`의 정책 결정 6건(`ui-output-limits.md`, `run-visibility.md`, `persona-ux.md`, `2026-09-23-worker-visibility.md`, `worker-tab-placement.md`, `pi-worker-pane-visibility.md`)에 파편화되어 있다. 본 문서가 그 인덱스 역할을 개시한다(§4.4-4).

---

## 2. 타 프로젝트 사례 비교 (2026-09-24 클론 HEAD/공식 문서 기준)

### 2.1 비교표

| 프로젝트 | 테마 정의 위치 | 컬러 계층 | 프리미티브 | 일관성 강제 |
| --- | --- | --- | --- | --- |
| **pi** | JSON 데이터 파일(`dark.json`/`light.json`)+JSON Schema | `vars`(원시)→`colors`(역할) 2계층, `ThemeColor`/`ThemeBg` 유니언 54키, `Theme.fg(color, text)`만 색 접근 허용 | 전용 패키지 pi-tui(box/text/stack/spacer/editor/select-list/truncated-text…) | 스키마 검증(시작+`/reload` 시 무효 테마 보고), biome+커스텀 check 스크립트+vitest |
| **opencode** | JSON 30여 개(`packages/tui/src/theme/assets/`) | `defs`→`theme` 2계층, 하나의 JSON이 라이트/다크 `Variant` 동시 표현 | @opentui 원시(box/text) 위에 `dialog-*` 조합 컴포넌트, 색은 `useTheme()` 컨텍스트만 | 순환 참조 throw·중복 이름 거부 테스트, oxlint, turbo typecheck, husky |
| **gemini-cli** | TS(`theme.ts`) + 시맨틱 파일 분리(`semantic-tokens.ts`) | raw→`SemanticColors` 2계층, 상태 3종(error/success/warning)이 타입 수준 보장, 컴포넌트는 시맨틱만 참조 | Ink Box/Text + 파일당 컴포넌트 1개+동치 스냅샷 테스트 | eslint `--max-warnings 0`, colocated 테스트, CODEOWNERS/PR 템플릿 |
| **aider** (반면교사) | 없음 — 생성자 인자+`main.py` 하드코딩 | 1계층(평평한 색 문자열) | 없음(`io.py`가 style dict 직접 조립) | isort/black/flake8+CI. **테마 강제 장치 없음 — "테마 추가=여러 파일 수정" 구조. Loop P4-1과 동형의 문제가 대규모로 나타난 사례** |
| **crush** | Go 코드(`themes.go`)+사용자 JSON(내장보다 우선) | quickStyle(팔레트)→override(보정) 2단, `Styles` 구조체가 단일 원천 | `internal/ui/common` 공용 위젯(button/elements/diff) | colocated Go 테스트(해석/파일/위젯별), golangci-lint, 깨진 테마는 폴백하되 `slog.Warn`으로 기록(조용한 대체 금지) |
| **claude-code** | `~/.claude/themes/*.json`(`{name, base, overrides}`) | base 프리셋→overrides 2계층 | 확인 불가(소스 비공개) | 문서화된 토큰 참조 표+인터랙티브 편집기. 오타 토큰은 무시(관대한 파싱) |

### 2.2 공통 불변식과 차이

**6개 중 5개 이상이 공유하는 불변식(Loop가 채택할 것):**

1. **원시 색을 아는 파일은 항상 소수**(테마 정의 파일뿐) — UI 코드는 역할 이름만 참조한다.
2. **원시값 → 시맨틱 역할의 2계층 매핑**이 표준(pi `vars→colors`, opencode `defs→theme`, gemini-cli `theme.ts→semantic-tokens.ts`, claude-code `base→overrides`, crush 팔레트→override).
3. **상태 색(success/error/warning)과 diff 색(added/removed)은 전 프로젝트가 1급 어휘로 포함.** Loop 감사 P1-1(상태가 단어로만 구분)이 정확히 이 어휘의 결여다.
4. **프리미티브는 극소(2~6개)로 유지**, 나머지는 조합. 환경 적응(NO_COLOR·색 능력·라이트/다크)은 호출점이 아니라 프레임워크/토큰 계층 한 곳의 관심사.
5. **테마·어휘는 데이터+검증으로 다룬다**(스키마 검증, 순환 참조 테스트, 이름 정규화 테스트).

**차이 1개 — 무결성 실패 정책:** pi는 무효 테마 명시 보고(엄격), claude-code는 무시(관대), crush는 폴백+경고 로그(중간). Loop는 내장 표면이 적으므로 **엄격(컴파일 타임 상수 + 무결성 테스트)**이 적합하다. 외부 테마 파일을 읽는 일이 당분간 없기 때문이다.

---

## 3. 업계 관행 요약

1. **디자인 토큰의 본질은 값이 아니라 "이름 붙은 결정"이다.** W3C Design Tokens Format Module(CG Draft)은 토큰을 *"플랫폼 중립적으로 표현된 디자인 결정, 공통 어휘"*로 정의하고 이름+`$value`+`$type`만 요구한다. 도구 체인(Style Dictionary류)이 필요 없는 프로젝트는 **개념만**(이름 붙은 값, 명시적 타입, 참조) 가져오면 된다 — Loop가 지금 얻을 것은 JSON 포맷이 아니라 시맨틱 상수 모듈이다.
2. **일관성은 계층으로 만든다: 원시값 → 시맨틱 역할 → 컴포넌트.** Primer는 실제 저장소 트리에서 `base/`(팔레트)→`functional/`(`fgColor.success = {base.color.green.5}`)→`component/`(`button.fgColor.rest`) 3계층을 운영한다. 컴포넌트는 역할 언어만 알고 원시값을 모른다. 시맨틱 토큰에는 용도 규칙이 붙는다(`fgColor.muted`: "타임스탬프·메타데이터용. 1차 콘텐츠에 사용 금지"). 상태 축(`rest`/`disabled`)이 이름에 박혀 있어 컴포넌트가 상태 색을 스스로 해석하지 않는다.
3. **일관성 강제는 규율이 아니라 도구다.** Polaris는 `color/color-no-hex` 린트로 16진 색 사용을 기계적으로 차단하고("Do: `var(--p-color-text)` / Don't: `#202223`"), Primer는 토큰 이름 규칙을 `lint:tokens`로 검사한다. 작은 팀에게 효과가 큰 관행은 "린트/테스트가 우회를 거부하는 것"이다.
4. **TUI 프레임워크는 모두 같은 분리를 택한다: 레이아웃/콘텐츠/스타일은 값/환경감지는 한 곳.** Ink는 `Box`(레이아웃)+`Text`(인라인) 2프리미티브, Ratatui는 `(area, buf)` 순수 함수 트레이트+`Constraint` 반응형 레이아웃, Lipgloss는 색 프로파일 자동 다운샘플링과 배경색 감지(`LightDark`)를 프리미티브에 내장. Ratatui의 커스텀 위젯 지침은 P4-1에 대한 업계 정답이다: *"전역 상태를 참조하는 헬퍼 함수 대신 입력 필드가 선언된 구조체로. 재사용이 목적이 아니어도 의미 있는 경계면 위젯으로 만든다."*
5. **회귀 망은 문자열 스냅샷이 기본이고, 색은 별도 검증이다.** Ink `lastFrame()`(ANSI 제거 문자열 비교), Ratatui `TestBackend`(80x20 고정)+insta가 표준 패턴이며, Ratatui 공식 문서는 스냅샷이 색을 검증하지 못한다는 한계(ratatui#1402)를 명시한다. Loop의 기존 문자열 계약 테스트(`packages/cli/test/cli.test.ts`, 감사 기준 64단언)가 이미 이 패턴 위에 있다 — 부족한 것은 패턴이 아니라 테스트 대상의 단일화(P2-4)다.

---

## 4. Loop용 최소 디자인 파운데이션 제안

### 4.0 설계 원칙

현재 요구에 맞는 가장 단순한 구조를 기본으로 한다(AGENTS.md). Loop의 UI 표면은 스냅샷 렌더러 6종+CLI 포맷터 4종+herdr 라벨 2종으로 작다. 따라서 프레임워크 도입·다중 테마 파일·토큰 변환 체인 없이, **(a) 어휘 상수 모듈, (b) 명시적 입력 렌더 프리미티브, (c) 기계적 강제 장치**의 3요소만으로 시작한다(의도적 생략은 §4.6).

### 4.1 세 리서치 문서 간 상충 해소

**A. "테마는 데이터 파일"(OSS 조사 패턴 3) vs "상수 모듈로 시작"(관행 조사 R1).**
5개 프로젝트가 테마를 JSON 데이터로 분리하지만, 그 이유는 **사용자/플러그인 테마 확장과 30+ 내장 테마** 때문이다. Loop는 소비자가 없는 지금 JSON 파일을 만들면 해석기·검증기만 남는다. 해소: **타입 붙은 상수 모듈로 시작하고, 데이터 파일 포맷은 트리거 발생 시 승격한다**(트리거: Rust와 TS가 같은 토큰을 공유해야 할 때 — 그때는 `loop-bridge`/codegen 경계 위에서 W3C `$value/$type` JSON을 생성 원본으로). 이름 규칙만 점 경로(`status.<state>.glyph`류)로 정해 이행 비용을 낮춘다(§6 D-1 ADR).

**B. 실행 순서 — 감사 §3(어휘→테마→안정화) vs 관행 문서 §7.3(R1 토큰→R2 린트→R3 가드→R4 스냅샷→R5 포맷터).**
두 문서의 원칙은 동일하다("색 이전에 어휘 단일화"). 차이는 린트와 포맷터 이관의 상대 순서뿐이다. 해소: **2주 계획(§5)에서 병합** — 1주차에 어휘 모듈+포맷터 이관(D1)을, 2주차에 색 토큰+가드(D2)와 린트·무결성 테스트(D3)를 배치한다. 린트 규칙은 어휘 모듈이 존재해야 검사 대상이 생기므로 D1 직후가 자연스럽고, 포맷터 이관이 먼저여야 린트 예외 구간(presentation 내부)이 최소화된다.

**C. herdr 라벨 소유권 — 감사 P4-2 "경계상 허용되나 어휘가 presentation 밖" vs 어휘 단일화 원칙.**

| 대안 | 내용 | 판단 |
| --- | --- | --- |
| (a) presentation 이관 | `workerLabel`/`mirrorPaneLabel`/`KIND_ALIASES`를 presentation의 순수 함수로 이동하고 32자 예산은 `labelBudget` 파라미터로 주입(Herdr 제약은 호출점이 소유) | 어휘 단일화·CLI/pi-loop 재사용에 부합. 의존 방향은 합법(herdr→presentation, 기존 경계 테스트와 무충돌). 비용: herdr 테스트 이동 |
| (b) herdr 유지+사양 문서화 | 라벨 규칙은 herdr에 두고 본 문서 §4.2의 표시 규격 표에 예산·형식을 규격화 | 비용 최소(문서만). 그러나 `·` 구분자·kind 별칭이 두 계층에 계속 중복 |

**권고: 2주 계획에서는 (b)로 규격부터 문서화하고, (a)의 이관은 §6 D-2의 후속 결정으로 남긴다.** 라벨 예산은 Herdr 터미널 제약이고 긴급도가 낮은 반면, 1주차 D1의 호출점 교체 양을 늘리면 회귀 위험이 커지기 때문이다(변경을 기존 경계를 존중하는 방향으로 분할).

### 4.2 토큰/어휘 레이어 — 위치와 형태

**위치: `packages/presentation/src/`(신규 모듈, 예: `tokens.ts`).** 근거: `@loop/presentation`은 이미 CLI(`main.ts:14`)와 pi-loop(재수출 7파일)가 공유하는 유일한 프레젠테이션 leaf다. 여기에 두면 모든 소비자가 import 하나로 어휘를 얻고, 기존 경계 테스트(presentation은 provider/pi/herdr 개념 import 금지)가 그대로 보호한다.

**내용 — 두 그룹의 상수:**

1. **표현 어휘(무색, 1주차):** 상태 글리프(`✓`/`!` 및 D-3에서 확정할 neutral 불릿), 구분자(`list: "·"`, `label: ": "`, `depends: "←"`), 빈 상태 상수(`No runs`/`No tasks`/`No active workers`/`OK`/`No models configured`), overflow 팩토리 — 감사 P2-2의 12개 인라인 변종을 `… {omitted} more {noun}` 계약(`docs/decisions/ui-output-limits.md` 규칙 2)을 준수하는 팩토리로 수렴. doctor의 `(F failed, P passed)` 부가 정보는 팩토리 인자로.
2. **색 역할(2주차):** 폐쇄된 역할 키 집합 — 최소 `success/warning/error`(상태 3종은 6개 사례 전부가 1급 어휘다) + `accent/muted/dim/text`. 값은 ANSI 16색에서 시작하고 truecolor 확장은 열어둔다(pi의 `ColorMode` 근사, Lipgloss 다운샘플링의 최소 버전). task 상태→역할 매핑(`taskPriority` 옆의 조회 테이블)으로 P1-1을 "호출점 분기"가 아니라 "토큰 조회"로 해소(Primer 상태 축 관행).

**소유권 분할(변경 없음):** 줄 수·글자수 **예산은 `config/policy.toml` → orchestrator config → 렌더러 파라미터**로 유지한다(운영 정책). **어휘·역할은 presentation 상수**(디자인 결정). `loop-core`는 양쪽 모르게 유지한다(기존 경계 테스트가 `OutputLimits|compactLines|line_text_limit`의 core 유입을 이미 금지).

**표시 규격 통합 표(본 문서가 단일 원천, 감사 P3-3 해소의 문서 반쪽):**

| 표면 | 예산 | 소유 |
| --- | --- | --- |
| 스냅샷/목록 논리 줄 | status 8 / attention 6 / findings 5 / list 8 (`policy.toml`) | orchestrator config |
| 논리 줄 길이 | 기본 160 grapheme, `…` 종결 | orchestrator config(폭 인식은 §6 D-5) |
| herdr 워커 탭 라벨 | 32자, `<taskId>·<kind>·a<attempt>`, taskId 우선 보존 | herdr 어댑터(`client.ts:548-591`) |

### 4.3 컴포넌트 프리미티브 후보

Ratatui 위젯 경계 지침("의미 있는 경계면 위젯으로")과 pi-tui/opencode의 극소 프리미티브 원칙을 Loop 규모로 번역하면:

| 프리미티브 | 상태 | 해소 |
| --- | --- | --- |
| `compactLines`/`singleLine`/`compactItems` | **존재·유지**(pi `truncated-text`의 대응물) | P3-2의 절반(말줄임 계약) |
| 어휘 상수 모듈 + overflow 팩토리 | 신규(1주차) | P2-1~P2-3, P2-6 |
| 명시적 입력 포맷터: `renderDoctorChecks`/`renderModelList`/`renderBenchmarkReport`/`renderCleanupReport` — `main.ts:532-625`에서 presentation으로 이관, 입력은 필요한 데이터 구조만 파라미터로 | 신규(1주차) | P4-1, P2-4(`renderRuns` 재사용), P2-5(`formatSnapshot`이 `commandDisplayName` 옵션을 받아 `replace()` 삭제) |
| 환경 가드: `NO_COLOR`(비어있지 않으면 색 off)·TTY 감지 → 클리어 이스케이프 조건화, 색 활성 플래그 | 신규(2주차) | P1-3, P3-1의 가드 반쪽 |
| 스타일 값 객체(역할+bold/dim, 렌더 시점 적용) | 후보(2주차, D2와 함께) | P1-2 |

**하지 않는 것:** 범용 레이아웃 엔진(box/stack), 편집 프리미티브, 마크다운 렌더러. Loop 표면은 줄 기반 텍스트 렌더링이 전부이며, 필요해질 때 pi-tui·@opentui가 증명하듯 원시 레이어는 그때 분리해도 늦지 않다.

### 4.4 일관성 강제 수단

1. **경계 테스트 확장(린트 역할):** `tests/architecture-boundaries.test.ts`에 "presentation 밖 TS 파일에서 ANSI 이스케이프(`\x1b[`·`\u001b[`)·16진 색 리터럴 금지" 규칙 추가. 이 저장소의 기존 강제 패러다임(정규식 경계 검사) 안에서 Polaris `color-no-hex`와 동형의 효과를 낸다. 근거: Polaris 린트 규칙, pi의 커스텀 check 스크립트(`check:ts-imports`류).
2. **어휘 무결성 단위 테스트:** (a) 모든 task 상태(9종)에 글리프·색 역할 매핑 존재, (b) 모든 overflow 팩토리 출력이 `… {n} more {noun}` 정규식 준수, (c) 빈 상태 상수 중복 없음. 근거: opencode 순환 참조·중복 이름 테스트, Primer `lint:tokens`.
3. **계약 테스트의 회귀 망 승격:** 기존 `packages/cli/test/cli.test.ts`(감사 기준 64단언)를 D1 호출점 교체의 안전망으로 사용 — 1주차 교체는 출력이 바이트 동일이 원칙이고, 의도적 변경(글리프 통일 등 D-3)만 스냅샷을 의도적으로 갱신. 색 도입 후에는 텍스트 스냅샷(ANSI 제거)과 색 어설션을 분리한다(Ratatui 공식 한계 명시, ratatui#1402; Ink `lastFrame`은 ANSI 제거 비교).
4. **문서 인덱스로서의 본 문서:** 분산된 6개 결정 문서(`ui-output-limits.md`, `run-visibility.md`, `persona-ux.md`, `2026-09-23-worker-visibility.md`, `worker-tab-placement.md`, `pi-worker-pane-visibility.md`)와 감사·조사 3건을 링크하는 단일 진입점. 원칙: "문서에 적어두고 사람이 지키는" 자산이 아니라 **코드가 import하는 상수가 곧 문서**(Primer/Polaris 단일 출처 관행). 본 문서는 규격·근거·변경 이력의 보관소다.

### 4.5 아키텍처 경계 준수 확인

- **Rust 도메인 무변경:** D1–D3는 전부 TS(presentation/cli/테스트)에 한정. `bun run codegen` 대상 없음. 예산 정책(D-5)도 `policy.toml`+TS config 검증에서 끝난다.
- **presentation 순수성 유지:** 어휘·토큰은 `@loop/protocol` 타입(예: task 상태 유니언)만 참조. provider/Pi/Herdr 개념 유입은 기존 경계 테스트가 금지.
- **thin adapter 원칙:** 포맷터 이관은 로직 이동이 아니라 **소유권 정리**다 — 결정적 규칙(정렬·글리프·문구)이 presentation에 모이고, `main.ts`는 인자 파싱·디스패치·프로세스 스폰만 남는다(감사 P4-1의 해소 방향이자 AGENTS.md "TS 어댑터는 얇게"의 실현).
- **모델 ID·엔드포인트 무관:** 토큰·어휘에 구성값 없음.

### 4.6 의도적 생략 (근거 포함)

| 생략 항목 | 근거 | 재개 트리거 |
| --- | --- | --- |
| W3C JSON 토큰 파일+변환 체인 | 도구가 필요해지기 전에는 이중 계층이 유지보수만 늘림(관행 문서 §7.1-(b)) | Rust/TS 토큰 공유 필요(§6 D-6) |
| 라이트/다크 다중 테마 파일 | 테마가 1개. Primer의 diff 방식도 변형이 생겨야 의미 | 두 번째 테마 요구 |
| 시각 GIF 회귀(VHS), PTY e2e | Ratatui 문서 권고: 문자열 스냅샷이 커버하는 동안 "소수 중요 플로우만" | 색·부분 갱신 도입 후 플리커 회귀가 실제로 발생할 때 |
| 컴포넌트 카탈로그/Storybook류 | 표면이 작음(렌더러 6종+포맷터 4종) | 프리미티브 수 2배 시점 |
| herdr 라벨 presentation 이관 | §4.1-C — 긴급도 대비 회귀 위험 | §6 D-2 결정 |

---

## 5. 2주 실행 계획

원칙: 각 단계는 독립적으로 머지 가능해야 하고, 검증은 `bun test packages` + `bun run check`(+ 필요시 `bun run test:architecture`)로 충분해야 한다(AGENTS.md: 유닛/마일스톤 테스트는 유료 모델 호출 금지). 1주차는 **출력 바이트 동일**을 목표로 한다(색·문구 의도 변경 없음).

### 1주차 — 어휘 단일화 (D1)

| 단계 | 작업 | 검증 | 위험/롤백 |
| --- | --- | --- | --- |
| S1 | `packages/presentation/src/tokens.ts` 신규: 글리프·구분자·빈 상태·overflow 팩토리 상수(색 역할은 자리만). 무결성 테스트 동반(§4.4-2) | `bun test packages`(신규 무결성 테스트) | 신규 모듈 — 기존 동작 무변경, 롤백은 파일 삭제 |
| S2 | `snapshot.ts`의 인라인 overflow 람다·빈 상태·구분자를 토큰 참조로 교체(P2-2, P2-3, P2-6) | `bun test packages` — 기존 계약 테스트 통과로 바이트 동일 확인 | 호출점 교체이므로 이전 커밋으로 revert |
| S3 | `main.ts` 포맷터 4종을 `renderDoctorChecks`/`renderModelList`/`renderBenchmarkReport`/`renderCleanupReport`로 presentation 이관(정렬·글리프 로직 포함). CLI의 `renderRuns` 인라인 복제 삭제(P2-4), `formatSnapshot`에 표시명 파라미터를 추가해 `replace()` 삭제(P2-5). `main.ts`는 디스패치만 남는지 확인 | `bun test packages`, `bun run check`; `packages/cli/test/cli.test.ts` 전체 통과 | 순수 이동+파라미터화. 예상 외 동작 시 포맷터 단위 revert |
| S4 | doctor/benchmark의 `✓`/`!`와 cleanup의 `-`/`!`를 토큰 조회로 전환. **글리프 의미 통일은 D-3 결정 후**(결정 전까지는 현행 값을 상수로만 이동해 출력 불변) | `bun test packages` | S2와 동일 |

### 2주차 — 토큰·가드·강제 (D2, D3)

| 단계 | 작업 | 검증 | 위험/롤백 |
| --- | --- | --- | --- |
| S5 | 색 역할 토큰+환경 가드: `NO_COLOR`(비어있지 않으면 색 off)·비-TTY 감지 모듈. 첫 소비자: watch의 클리어 이스케이프를 TTY 조건화(P1-3), task 상태색 조회 테이블(P1-1) | `bun test packages`; 텍스트 스냅샷은 ANSI 제거 후 비교(색 어설션 별도, §4.4-3) | 가드가 보수적(false → 무색)이므로 최악은 현행과 동일한 무색 출력 |
| S6 | watch 안정화 조사(정적 감사의 한계 보완): 비-TTY 로그 캡처에서 클리어 방출 소거 확인, 필요 시 터미널 폭 인식 `lineTextLimit` 상한 설계안 작성(구현은 D-5 정책 결정 후) | 수동 재현 기록(터미널 폭 축소 시 논리 줄 예산 유지 여부)을 감사 후속 증거로 첨부 | 문서+가드만 — 레이아웃 정책 변경은 별도 결정 |
| S7 | 경계 테스트 확장: presentation 밖 ANSI/색 리터럴 금지(§4.4-1) | `bun run test:architecture`, `bun run check` | 새 규칙 위반 파일이 있으면 해당 호출점을 토큰으로 교체(예외 금지) |
| S8 | 문서 정리: 본 문서를 `docs/design/` 진입점으로 확정, 6개 결정 문서 상호 링크 갱신, D-1(토큰 이름 ADR) 초안 작성 | `bun run check`(문서 링크 유효성) | 문서만 |

**2주 뒤의 완료 상태:** P2 전체 해소, P1-1/P1-3 해소, P4-1 구조 해소, P3-1 가드 반쪽+P3-2 설계안, P3-3/P4-2는 규격 문서화+후속 결정 대기, `main.ts`는 디스패치 전용으로 축소.

---

## 6. 후속 결정 필요 사항 (요약 재게시)

| ID | 결정 | 옵션/근거 | 권장 시점 |
| --- | --- | --- | --- |
| D-1 | 토큰·어휘 이름 규칙(점 경로 `status.<state>.glyph`, `separator.list`류) ADR | Polaris 네이밍 문법·Primer 이름 제약이 선례. W3C JSON 승격(D-6) 시 이름이 호환되어야 함 | S1 착수 전 |
| D-2 | herdr 라벨 규칙 소유권 — §4.1-C (a) 이관 vs (b) 유지+규격화 | (a)는 어휘 단일화 완성, (b)는 회귀 최소 | 2주 계획 완료 후 |
| D-3 | cleanup `-` 불릿과 doctor `✓`/`!`의 통일 어휘 — neutral 불릿을 별도 글리프로 둘지 | 성공/경고/neutral 3종 분리를 권장(상태 3색 어휘와 평행) | S4 착수 전 |
| D-4 | 색 1차 소비자 범위(task 상태색만 vs attention 항목까지)와 ANSI 16색 시작 확정 | 최소: 상태색+클리어 가드. pi `ColorMode` 근사는 나중 | S5 착수 전 |
| D-5 | 터미널 폭 인식 `lineTextLimit` — `policy.toml`에 상한 규칙 추가 여부 | 감사 P3-2가 체감 불안정의 직접 원인. 다만 `ui-output-limits.md`가 "논리 줄 한도"임을 명시하므로 정책 문서 수정 동반 | S6 설계안 수령 후 |
| D-6 | W3C JSON 토큰 포맷 승격 — Rust bridge/codegen과 토큰 공유가 필요해질 때 | 관행 문서 §7.1-(b)의 연기 근거 유지 | 트리거 발생 시 |

---

## 부록: 출처 인덱스

- **Loop 내부:** `docs/design/research/loop-ui-audit.md`(감사, P1–P4), `docs/design/research/oss-agent-ui-survey.md`(사례 6종·부록 A 근거 목록), `docs/design/research/design-system-practices.md`(업계 관행·부록 A 1차 자료 URL), `docs/decisions/ui-output-limits.md`(줄 수 예산 계약), `docs/decisions/persona-ux.md`(pi theme 토큰 사용 팩트), `docs/architecture.md`(presentation 계층 정의), `tests/architecture-boundaries.test.ts`(기존 강제 패러다임).
- **외부 사례(전부 2026-09-24 접근, 조사 문서 부록 참조):** pi(earendil-works/pi, pi-tui), opencode(sst/opencode), gemini-cli(google-gemini/gemini-cli), aider(Aider-AI/aider), crush(charmbracelet/crush), claude-code(code.claude.com/docs).
- **외부 관행:** W3C Design Tokens Format Module(CG Draft 2025.10), primer/primitives, Shopify Polaris(polaris-tokens 구조 문서·stylelint-polaris 규칙), Ink, Ratatui(concepts/widgets, recipes/snapshots), Charmbracelet Lipgloss, no-color.org.
