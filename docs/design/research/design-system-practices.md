# 업계 디자인 시스템 관행 조사 — 토큰·테마 레이어·TUI 프리미티브

- **일자:** 2026-09-24 KST
- **종류:** `research` (survey-design-practices, attempt 0)
- **읽기 범위:** `README.md`, `docs/**` (현재 상태 파악용)
- **쓰기 범위:** 이 문서만
- **증거 경계:** 공식 스펙·공식 문서·공개 저장소 1차 자료만 사용했다(§부록 A 전 목록, 2026-09-24 접근 확인). design.md/ui-ux-pro 류 프롬프트 스킬 문서는 근거에서 배제했다. 네트워크로 원문을 직접 내려받아 인용문을 대조했다.

---

## 0. 요약 — Loop 규모(소규모 TS/Rust 팀)를 위한 최소 구성 권고

**문서:** `docs/design/research/design-system-practices.md`
**핵심 발견 5가지:**

1. **디자인 토큰의 본질은 "값"이 아니라 "이름 붙은 결정"이다.** W3C Design Tokens Format Module은 토큰을 *"플랫폼 중립적으로 표현된 디자인 결정, 공통 어휘"*로 정의하고 이름+값(`$value`)과 타입(`$type`)만 요구한다(§2.1). 즉 Loop가 지금 바로 얻을 것은 JSON 포맷이 아니라 **시맨틱 이름 하나짜리 상수 모듈**이다.
2. **일관성은 레이어로 만들어진다: 원시값 → 시맨틱 역할 → 컴포넌트.** Primer는 실제 저장소 트리에서 `base/`(팔레트) → `functional/`(역할: `fgColor.success` = `{base.color.green.5}` 참조) → `component/`(`button.fgColor.rest` = `{control.fgColor.rest}` 참조) 3계층을 운영한다(§2.2). 컴포넌트는 역할 언어만 알고 원시값을 모른다. 이것이 테마 교체·접근성 변형이 파일 하나(diff)로 가능한 이유다.
3. **일관성 강제는 규율이 아니라 도구로 한다.** Polaris는 `color/color-no-hex` 린트 규칙으로 16진 색 사용 자체를 컴파일/린트 에러로 막고("Do: `color: var(--p-color-text)` / Don't: `color: #202223`"), Primer는 토큰 이름 제약을 `lint:tokens`로 검사한다(§3.2). 작은 팀에게 가장 효과가 큰 관행은 "린트가 우회를 금지하는 것"이다.
4. **TUI 프레임워크는 모두 같은 분리를 택한다: 레이아웃/콘텐츠/스타일/환경감지.** Ink는 `Box`(레이아웃)+`Text`(인라인) 2프리미티브, Ratatui는 `Widget::render(area, buf)` 트레이트와 `Constraint` 기반 반응형 레이아웃, Lipgloss는 색 프로파일 자동 다운샘플링과 배경색 감지(`LightDark`)를 프리미티브에 내장한다(§4). 환경 적응(`NO_COLOR`, TTY, 색 능력)은 각 호출점이 아니라 **프레임워크(Loop라면 presentation) 한 곳**의 관심사다.
5. **회귀 망은 문자열 스냅샷이 기본이고 색은 별도 검증이다.** Ink의 `lastFrame()` 문자열 비교, Ratatui의 `TestBackend`+`insta` 스냅샷(80x20 고정 권고)이 업계 표준 패턴이며, Ratatui 공식 문서는 insta 스냅샷이 **색을 검증하지 못한다**(ratatui#1402)는 한계를 명시한다(§5). Loop의 기존 문자열 계약 테스트(`packages/cli/test/cli.test.ts` 64단언)가 이미 이 패턴 위에 있다.

**Loop 최소 구성 권고 (아래 §7 근거 포함):**

| # | 권고 | 근거 패턴 | 규모 근거(생략하는 것) |
| --- | --- | --- | --- |
| R1 | `@loop/presentation`에 **시맨틱 토큰 상수 모듈 1개**(역할 어휘: success/warning/error/dim/muted/accent + 상태 글리프·구분자·빈 상태·overflow 문구 팩토리) — base 팔레트 계층 없이 시작 | Primer functional 계층, W3C alias 개념만 차용 | W3C JSON 포맷+Style Dictionary 변환 체인은 도구가 필요해질 때 도입 (§7.1) |
| R2 | **스타일 우회 금지 린트**: presentation 밖 파일에서 ANSI 이스케이프/색 리터럴 금지 (ESLint `no-restricted-syntax`) | Polaris `color/color-no-hex`, `conventions-custom-property-allowed-list` (§3.2) | stylelint류 별도 도구 불필요, 기존 ESLint/Bun 설정으로 충분 |
| R3 | **환경 가드를 presentation 진입 한 곳에**: `NO_COLOR`(비어있지 않으면 색 off), 비-TTY 감지(파이프·캡처), 능력 다운그레이드 | no-color.org 규약, Lipgloss 프로파일 다운샘플링·`LightDark` (§4.3) | 터미널 배경색 질의(OSCTC)는 선택 — 기본은 `NO_COLOR`+TTY만 |
| R4 | **렌더 함수 단일화 + 문자열 스냅샷 유지**: 감사 P2(중복 포맷터·글리프)를 토큰 모듈로 수렴시키고, 기존 `cli.test.ts` 계약 테스트를 스냅샷 회귀 망으로 승격 | Ink `lastFrame`, Ratatui `TestBackend`+insta (§5) | PTY e2e(termlens류), GIF 회귀(VHS)는 중요 플로우 소수만 "나중에" |
| R5 | **포맷터를 명시적 입력의 위젯으로 추출**: `main.ts`의 4종 포맷터를 입력 필드가 선언된 presentation 구조체로. 출력 역직렬화(`replace`) 금지 | Ratatui "When to Make a Custom Widget" 경계 기준 (§4.2, §6) | 범용 컴포넌트 라이브러리화(Storybook, 카탈로그)는 하지 않는다 |

**하지 말 것(현 단계):** W3C JSON 토큰 파일과 변환 도구 체인, 라이트/다크 파일 분리 다중 테마, 시각 GIF 회귀 CI, 컴포넌트 카탈로그. 전부 규모 대비 비용이 비용보다 크고, R1–R5 위에 나중에 얹을 수 있다(§7.3).

---

## 1. 조사 방법

- **1차 자료 원칙:** 이 문서의 모든 주장은 (a) 공식 스펙 초안, (b) 프로젝트 공식 문서/공식 저장소 소스 파일, (c) 공식 문서 사이트의 내용으로만 뒷받침한다. 각 인용의 원문 URL은 부록 A에 있다.
- **수집 방법:** 2026-09-24에 `curl`로 원문(HTML/Markdown/JSON5/소스)을 직접 내려받아 인용문을 대조했다. 이차 해석(블로그·튜토리얼)은 서술에 사용하지 않았다.
- **Loop 맥락:** `docs/design/research/loop-ui-audit.md`(동일 날짜, 감사 문서)의 P1–P4 문제 목록을 적용 대상으로 삼고, §7에서 매핑한다. 코드 변경은 없다.

## 2. 디자인 토큰: 정의와 계층화

### 2.1 W3C Design Tokens Format Module — 토큰의 최소 정의

Design Tokens Community Group의 Format Module(버전 2025.10, CG Draft — *"not a W3C Standard"*)은 토큰을 이렇게 정의한다:

> "Design tokens are a methodology for expressing design decisions in a platform-agnostic way so that they can be shared across different disciplines, tools, and technologies. They help establish a common vocabulary across organizations."

포맷의 최소 요구는 세 가지뿐이다:

- **토큰 = `$value`를 가진 객체**, 부모 키가 이름. 이름과 값은 필수.
- **`$type`** — *"Design tokens always have an unambiguous type, so that tools can reliably interpret their value."* 값 내용으로 타입을 추측하는 것을 금지한다("Tools MUST NOT attempt to guess the type of a token by inspecting the contents of its value").
- **별칭(참조)** — *"A design token's value can be a reference to another token. The same value can have multiple names or aliases."* 값 자리에 `{base.color.green.5}` 같은 참조 문자열이 온다.

이득은 포맷이 아니라 **어휘**라는 점이 이 스펙 서두 자체에 있다: 스펙은 도구 생태계(디자인 도구↔코드 번역기)를 위한 것이고, 그 도구 체인이 필요 없는 프로젝트는 *개념만*(이름 붙은 값, 명시적 타입, 참조) 가져와도 충분하다.

### 2.2 3계층 패턴 — Primer의 실제 저장소 구조

`primer/primitives` 저장소의 `src/tokens/`는 3계층을 그대로 디렉터리로 보여준다:

```text
src/tokens/
├── base/        # 원시 팔레트: base.color.neutral.0-15, green.5, motion, size…
├── functional/  # 역할(시맨틱): fgColor.json5, bgColor.json5, control.json5, space.json5…
└── component/   # 컴포넌트: button.json5, avatar.json5, card.json5…
```

각 계층이 서로를 참조하는 실제 값(발췌):

```jsonc
// functional/color/fgColor.json5
fgColor: {
  default: { $value: '{base.color.neutral.13}', $type: 'color',
             $description: 'Default text color for primary content and headings' },
  success: { $value: '{base.color.green.5}', $type: 'color',
             $description: 'Success text for positive feedback and completed states' },
  muted:   { $value: '{base.color.neutral.9}', … }
}

// component/button.json5
button: {
  default: {
    fgColor: { rest: { '$value': '{control.fgColor.rest}' },   // 역할 위의 역할
               disabled: { '$value': '{control.fgColor.disabled}' } }
  }
}
```

관찰:

1. **컴포넌트 토큰은 상태 축을 가진다.** `rest`/`disabled`(그리고 hover/focus류) 같은 인터랙션 상태가 이름에 박혀 있어, 컴포넌트가 "이 상태에서 무슨 색"을 스스로 해석하지 않는다.
2. **시맨틱 토큰에는 용도 규칙이 붙는다.** `fgColor.muted`에는 *"Use for secondary text like timestamps, metadata, and helper text. Do NOT use for primary content."*라는 사용 규칙(`org.primer.llm.extensions`의 usage/rules)이 명시돼 있다 — 소비자가 임의로 고르지 못하게 어휘에 가이드가 내장된다.
3. **테마는 "메인 모드 + diff"다.** functional 토큰의 `$extensions['org.primer.overrides']`에 다크/고대비 변형만 diff로 기록한다(예: `fgColor.default`는 다크에서 `{base.color.neutral.12}`로만 바뀜). 라이트 전체를 복사하지 않는다. README는 이를 *"create a mode by only including the changes from the main mode"*로 설명한다.
4. **빌드와 검증은 자동화된다.** 토큰 JSON5를 Style Dictionary로 컴파일해 CSS 변수/npm 배포물을 만들고(`scripts/buildTokens.ts`), 이름 제약(camelCase/kebab-case, `{`, `}`, `.` 금지 — W3C의 문자 제한과 동일한 취지)을 `npm run lint:tokens`로 검사하며, a11y 대비율 검사를 GitHub Actions 워크플로(`a11y-contrast.yml`)로 돌린다.

### 2.3 Polaris — 네이밍 문법으로 일관성 강제

`polaris-tokens/polaris-tokens-structure.md`는 토큰 이름을 문법(grammar)으로 규정한다:

> `--p-color-[element]-[role?]-[prominence?]-[state?]`
> 예: `--p-color-text`, `--p-color-text-secondary`, `--p-color-input-text-secondary`

관찰: 이름이 자유 텍스트가 아니라 **위치가 의미를 갖는 문법**이라, 새 토큰 추가가 "문법에 맞는 조합 찾기"로 강제된다. 테마는 `src/themes/{base,light,dark,light-high-contrast,light-mobile}.ts`로 메인 모드와 변형을 분리한다(Primer의 diff 방식과 같은 발상). Polaris 저장소는 2025-10에 아카이브되어 Polaris Web Components로 이전했지만, 토큰 구조 문서 자체는 여전히 계층화·네이밍 관행의 1차 자료로 유효하다.

## 3. 코드로 일관성 강제하기 — 작은 팀 관점의 관행

### 3.1 단일 출처(single source of truth) + 생성물 소비

- Primer와 Polaris 모두 토큰 원본은 **한 곳**(Primer: `src/tokens/*.json5`, Polaris: `polaris-tokens/src/themes/*.ts`)에만 있고, CSS 변수·npm 패키지·Figma 값은 전부 빌드 산물이다. 소비자는 원본이 아니라 생성물(`var(--fgColor-default)`, `import {tokens}`)만 본다.
- 시사점: 토큰을 "문서에 적어두고 사람이 지키는" 자산으로 만들지 않는다. 코드가 임포트하는 상수/생성물이 곧 문서다.

### 3.2 우회 금지를 린트로 — 가장 싼 강제 장치

Polaris의 `stylelint-polaris`는 "raw 값 사용 금지 → 토큰만 허용"을 린트 규칙으로 구현한다. 공식 규칙 문서 `color/color-no-hex`의 전문 예시:

```diff
// Do
+ color: var(--p-color-text);
+ fill: var(--p-color-icon)
// Don't
- color: #202223;
- fill: #5c5f62;
```

같은 도구 모음에는 `conventions-custom-property-allowed-list`(허용된 커스텀 프로퍼티만), `color-global-disallowed-list`, `legacy-*` 시리즈 등이 있어, "토큰 밖 스타일 표현"을 커밋 전에 기계적으로 차단한다. Primer도 토큰 이름 규칙 위반을 `lint:tokens`로 검사한다.

- 시사점: 일관성은 리뷰어의 주의가 아니라 **기계가 거부하는 것**이므로, 작은 팀에서 가장 비용 대비 효과가 크다. Loop라면 "presentation 밖에서 ANSI/색 리터럴 금지" 한 규칙이 이 패턴이다.

### 3.3 테마 변형은 diff, 접근성 검증은 CI

Primer의 오버라이드 확장(`org.primer.overrides`)은 §2.2 관찰 3처럼 변형을 diff로 유지하고, 변형된 테마 조합(라이트/다크 × 고대비/색각 이상 9종)마다 a11y 대비율 워크플로를 돌린다. 테마를 파일 복제가 아니라 **데이터 diff + 검증 워크플로**로 다루는 것이 두 시스템의 공통 관행이다.

## 4. TUI 프레임워크의 프리미티브 설계 패턴

### 4.1 Ink (React for terminals) — 2프리미티브 + 훅

공식 README 기준 컴포넌트 표면은 의도적으로 좁다:

- `<Box>` — *"like `<div style="display: flex">` in the browser."* 레이아웃 전담. `width/height`를 수치와 **비율(%) 둘 다**로 받아 부모 기준으로 계산, flex 속성(`flexDirection`, `flexGrow`, `gap` 등)과 `border`, `padding/margin`.
- `<Text>` — 인라인 콘텐츠 + 스타일(`color`, `backgroundColor`, `bold`, `dimColor` 등).
- 특수 목적 최소 집합: `<Static>`(한 번만 출력되는 리스트 — 로그형 출력용), `<Transform>`, `<Newline>`, `<Spacer>`.
- 환경·입력은 훅으로: `useInput`, `useStdout`, `useWindowSize`, `useFocus`.

패턴: **레이아웃(Box)과 콘텐츠(Text)를 분리**하고, 나머지는 소비자가 조립한다. 이 생태계의 서드파티 컴포넌트들이(ink-table, ink-task-list, ink-spinner…) 모두 이 2프리미티브 위에서 만들어진다는 사실이 프리미티브의 충분성을 증명한다.

### 4.2 Ratatui (Rust) — 즉시모드 위젯 트레이트 + 명시적 입력 경계

- 코어 계약은 두 트레이트뿐이다:

```rust
pub trait Widget {
    fn render(self, area: Rect, buf: &mut Buffer);
}
pub trait StatefulWidget {
    type State;
    fn render(self, area: Rect, buf: &mut Buffer, state: &mut Self::State);
}
```

  렌더는 전부 **(영역, 버퍼) 대 (상태) 순수 함수**다. 스타일은 값(`Style`/`Modifier`)으로 존재하고 렌더 시점에 버퍼에 적용된다.
- **반응형 레이아웃**은 `Constraint` 열거형으로 선언한다: `Length`(고정)·`Min`/`Max`(하한/상한)·`Percentage`/`Ratio`(부모 상대)·`Fill`(잉여 분배). 공식 레이아웃 문서는 고정+가변 혼합 시 예상 밖 동작을 경고하고 중첩 레이아웃을 권한다 — "터미널 폭을 모르는 고정 폭"의 위험을 프레임워크 차원에서 다룬다.
- **컴포넌트 경계 가이드라인**(`When to Make a Custom Widget`)은 이번 조사에서 가장 Loop에 직접 applicable한 지침이다. 발췌:

> "A helper such as `fn render_sidebar(area, buf, app: &App)` can accidentally depend on any field in `App`. A widget struct makes the inputs explicit, such as `Sidebar { selected, items }`, and the render implementation can only use those fields."
> "Implementing a widget is useful when a section of UI needs a meaningful boundary, **not only when it will be reused**."

즉: (a) 전역 상태를 들쑥날쑥 참조하는 헬퍼 함수 대신 (b) 입력 필드가 선언된 구조체로, (c) 재사용이 목적이 아니어도 **의미 있는 경계**면 위젯으로 만든다. `main.ts` 909줄 모놀리스 문제(P4-1)에 대한 업계 정답이다.

### 4.3 Lipgloss (Charmbracelet, Go) — 환경 적응의 프리미티브화

공식 README의 두 관행이 Loop의 P1-3(`NO_COLOR`/TTY 부재)·P3-2(터미널 폭 미탐지)에 정확히 대응한다:

- **색 프로파일 자동 다운샘플링:** *"Some users don't have Truecolor terminals. Other times, output might not support color at all (for example, in logs). Lip Gloss was designed to handle this gracefully by automatically downsampling colors to the best available profile."* 스타일 선언과 출력 능력 협상을 분리한다.
- **배경색 감지 + 라이트/다크 선택:** `hasDarkBG := lipgloss.HasDarkBackground(os.Stdin, os.Stdout)` 후 `lightDark(lightColor, darkColor)`로 런타임 선택. 테마 분기가 소비자 코드 산책이 아니라 **프리미티브 API**로 제공된다.

### 4.4 프레임워크 공통 패턴

| 패턴 | Ink | Ratatui | Lipgloss |
| --- | --- | --- | --- |
| 레이아웃 엔진 분리 | `Box`(flexbox) | `Layout`+`Constraint` | `Width/Height/Align` |
| 스타일은 값, 적용은 렌더 시 | `<Text>` props | `Style`/`Modifier` → 버퍼 | `Style` 빌더 → `Render` |
| 환경감지는 한 곳 | `useWindowSize`, `useStdout` | backend 추상화(`TestBackend` 포함) | 프로파일 다운샘플, `LightDark` |
| 결정론적 렌더(테스트 가능) | `lastFrame()` 문자열 | `(area, buf)` 순수 함수 + `TestBackend` | `Sprint` 문자열 반환 |

## 5. 스냅샷·시각적 회귀 테스트

### 5.1 문자열 스냅샷 — 양대 표준 패턴

- **Ink:** `render()`가 `lastFrame()`(마지막 프레임 문자열), `frames`(전체 히스토리), `rerender()`, `stdin.write()`를 돌려준다. 렌더 결과를 **ANSI가 제거된 순수 문자열**로 비교하므로 테스트가 색 설정과 독립적이다.
- **Ratatui:** 공식 문서(Testing with insta snapshots)가 권장 절차는 `TestBackend::new(80, 20)` 고정 크기 → `terminal.draw(...)` → `insta::assert_snapshot!(terminal.backend())`이며, *"Use a consistent terminal size (80x20 in this example) to ensure reproducible results"*를 팁으로 명시한다. 스냅샷 파일에는 터미널 각 행이 문자열로 저장되고, 의도적 변경은 `cargo insta review`로 수락한다.

### 5.2 알려진 한계 — 색은 문자열 스냅샷에 안 잡힌다

Ratatui 공식 문서는 명시한다: *"Asserting with color is not supported as of now. See ratatui/ratatui#1402."* 즉 색 도입 후에는 (a) 텍스트 스냅샷(레이아웃·어휘 회귀)과 (b) 색 어설션(버퍼 스타일 직접 검사)을 **분리**해야 한다. 이것은 Loop가 색을 도입할 때 테스트 설계에 미리 반영할 제약이다.

### 5.3 전체 플로우 — PTY와 녹화는 "소수만"

- Ratatui 문서는 `TestBackend`가 이벤트 루프·키 처리·exit code를 못 덮으므로, PTY 기반 e2e(예: `termlens`)로 *"a small number of important user flows"*만 보완하라고 제한한다.
- Charmbracelet VHS는 *"Write terminal GIFs as code for integration testing and demoing your CLI tools"*라는 `.tape` 형식을 제공하지만, 이는 회귀 망의 기본이 아니라 데모/통합 검증 보조로 쓰인다.

### 5.4 Loop의 현재 위치

Loop는 이미 **(5.1) 문자열 계약 테스트** 패턴 위에 있다 — `packages/cli/test/cli.test.ts`의 64단언이 스냅샷 렌더러 출력의 회귀 망 역할을 한다(감사 문서 §3 참조). 부족한 것은 패턴이 아니라 **테스트 대상의 단일화**(P2-4 이중 구현)와 색 도입 시의 (5.2) 대응이다.

## 6. 컴포넌트 API 가이드라인 — 1차 자료에서 추출한 규칙

1. **입력을 선언하라.** Ratatui 위젯 경계 지침: 렌더 헬퍼가 전역(`App`)을 참조하게 두지 말고 입력 필드를 명시하라(§4.2). Loop의 대응물: 포맷터/렌더러가 `Snapshot` 등 필요한 데이터만 파라미터로 받게 한다 — `main.ts:530`의 출력 `replace` 역직렬화(P2-5)는 이 원칙 위반이다.
2. **이름은 문법으로 짓는다.** Polaris 네이밍 문법(§2.3), Primer의 이름 제약+`lint:tokens`(§3.2). Loop의 대응물: 토큰·글리프 상수에 위치 기반 규칙(예: `status.<state>.glyph`, `separator.list`)을 정하고 린트로 검사.
3. **상태 축을 이름에 넣는다.** Primer 버튼 토큰의 `rest`/`disabled`(§2.2). 상태별 표현이 호출점 분기가 아니라 토큰 조회가 되게 한다 — 상태가 시각적으로 동등하게 출력되는 P1-1의 해법.
4. **용도 규칙을 어휘에 붙인다.** Primer `fgColor.muted`의 "Do NOT use for primary content"(§2.2). 토큰 상수의 JSDoc에 용도·금용을 적는다.
5. **환경 폴백을 API에 내장한다.** Ink ARIA props·screen-reader 훅, Lipgloss 프로파일 다운샘플링(§4.3). Loop의 대응물: `NO_COLOR`·비-TTY 가드를 presentation 진입에서 한 번에 처리(R3).

## 7. Loop 적용 권고 (상세)

### 7.1 토큰 계층 설계 — 대안 비교

| 대안 | 내용 | 채택 판단 |
| --- | --- | --- |
| (a) **시맨틱 상수 모듈 1개** | `packages/presentation/src/tokens.ts`에 역할 어휘(색 역할·글리프·구분자·빈 상태·overflow 팩토리)를 타입 붙은 상수로. 값 참조 없이 리터럴 직접 보유 | **채택(지금).** 화면이 문자열+소수 색이면 base 팔레트 계층은 죽은 코드가 된다. W3C가 정의한 "어휘"는 이 구조로 충분히 확보된다. 이름 규칙만 점 경로(`status.done.glyph`)로 정해 (b)로의 이행 비용을 낮춘다 |
| (b) W3C 포맷 JSON + 변환 | 토큰을 `$value/$type` JSON으로, Style Dictionary류 코드젠 | **보류(트리거 연기).** 도구가 필요해지는 시점은 "Rust와 TS가 같은 토큰을 써야 할 때"다. `loop-bridge`/codegen 경계가 이미 있으므로 그때 토큰 파일을 생성 원본으로 승격하면 된다. 지금은 이중 계층이 유지보수만 늘린다 |
| (c) 3계층(base/functional/component) TS | Primer 전체 구조 이식 | **기각.** 컴포넌트 토큰 계층이 의미 있으려면 컴포넌트 수가 수십 개여야 한다. Loop 표면은 감사 기준 스냅샷 6종+CLI 포맷터 4종이다 |

### 7.2 감사 문제 → 업계 패턴 매핑

| 감사 문제(loop-ui-audit.md) | 적용 패턴(출처 §) | 최소 구현 |
| --- | --- | --- |
| P1-1 상태가 시각적으로 동등 | 상태 축 토큰(§2.2-1, §6-3) | `status.<state>.{glyph,role}` 조회로 렌더 |
| P1-2 스타일 프리미티브 0개 | 스타일은 값(§4.4) | presentation에 `Style` 미니 값 객체(색 역할+bold/dim) |
| P1-3 NO_COLOR/TTY 부재 | 환경감지 한 곳(§4.3, no-color.org) | presentation 진입 가드, watch 클리어에 TTY 조건 |
| P2-1~P2-6 어휘 중복 | 단일 출처+린트(§3.1–3.2) | R1 토큰 모듈 수렴 + ANSI/리터럴 린트 금지 |
| P3-2 고정 폭 160 | Constraint 사고(§4.2) | 터미널 폭 감지 시 `lineTextLimit` 상한 계산(선제 조치는 아니나 토큰 문서에 규격화) |
| P4-1 main.ts 모놀리스 | 위젯 경계(§4.2, §6-1) | 포맷터 4종을 명시적 입력 구조체로 presentation 이관 |

### 7.3 실행 순서와 의도적 생략

- **순서:** R1(토큰 모듈+어휘 수렴) → R2(린트) → R3(환경 가드) → R4(스냅샷 승격) → R5(포맷터 추출). R1이 먼저인 이유는 감사 §3과 동일하다 — 색 이전에 어휘가 단일화돼야 토큰 도입이 호출점 대량 수정이 되지 않는다.
- **의도적 생략(근거 포함):** 다중 테마 파일 분리(§3.3의 diff 방식도 아직 불필요 — 테마가 1개), 시각 GIF 회귀(§5.3 — 문자열 스냅샷으로 커버되는 동안), 컴포넌트 카탈로그/Storybook류(표면이 작음), W3C JSON 코드젠(§7.1-(b) 트리거까지).

## 부록 A: 1차 자료 목록 (모두 2026-09-24 접근)

| 출처 | 형태 | URL |
| --- | --- | --- |
| W3C Design Tokens CG, *Design Tokens Format Module 2025.10* (CG Draft) | 공식 스펙 초안 | https://tr.designtokens.org/format/ |
| GitHub `primer/primitives` README, `src/tokens/**` 트리, `functional/color/fgColor.json5`, `component/button.json5`, `base/color/light/light.json5` | 공식 저장소 소스 | https://github.com/primer/primitives |
| Shopify Polaris `polaris-tokens/polaris-tokens-structure.md`, `polaris-tokens/README.md`, `src/themes/**` 트리 | 공식 저장소 문서·소스 (2025-10 아카이브됨, 구조 문서는 유효) | https://github.com/Shopify/polaris |
| Polaris `stylelint-polaris` 규칙 문서 `color-color-no-hex.mdx` 외 `conventions-custom-property-allowed-list.mdx` 등 | 공식 저장소 규칙 문서 | https://github.com/Shopify/polaris/tree/main/polaris.shopify.com/content/tools/stylelint-polaris/rules |
| Ink 공식 README (`<Box>`, `<Text>`, Testing, Creating Components) | 공식 저장소 문서 | https://github.com/vadimdemedes/ink |
| `ink-testing-library` README | 공식 저장소 문서 | https://github.com/vadimdemedes/ink-testing-library |
| Ratatui 공식 문서: concepts/widgets.md, concepts/layout.md, recipes/testing/snapshots.md (ratatui-website) | 공식 문서 사이트 원본 | https://ratatui.rs (원본: https://github.com/ratatui/ratatui-website) |
| Charmbracelet Lipgloss README (색 프로파일, Adaptive/LightDark) | 공식 저장소 문서 | https://github.com/charmbracelet/lipgloss |
| NO_COLOR 규약 | 커뮤니티 규약 사이트 | https://no-color.org/ |
| Charmbracelet VHS README | 공식 저장소 문서 | https://github.com/charmbracelet/vhs |

## 부록 B: 검증

- 본 조사는 읽기 전용이며 코드·테스트 변경이 없으므로 `bun run check` 대상 변경이 없다.
- 완료 확인: `test -s docs/design/research/design-system-practices.md && grep -qiE '^## ' docs/design/research/design-system-practices.md`
