# 공개 에이전트/TUI 프로젝트의 UI 디자인 접근 조사

- **일자:** 2026-09-24 KST
- **종류:** `research` (survey-oss-agents, attempt 0)
- **읽기 범위:** `README.md`, `docs/**` (현재 상태 파악용)
- **쓰기 범위:** 이 문서만
- **증거 경계:** 실제 저장소 소스 트리(2026-09-24 `main` HEAD 클론)와 로컬 설치본(pi npm 패키지), 공식 문서 원문만 사용했다. 각 항목에 저장소 내 파일 경로 또는 문서 URL을 출처로 명시했다. 검증할 수 없는 항목은 "확인 불가"로 표기했다. design.md/ui-ux-pro 류 프롬프트 스킬 문서는 근거에서 배제했다(과업 지시).
- **자매 문서:** Loop 현황은 `loop-ui-audit.md`(P1–P4), 업계 디자인 시스템 일반 관행은 `design-system-practices.md`(R1–R5). 본 문서는 세 축 중 "실제 에이전트/TUI 프로젝트 사례"를 담당한다.

---

## 0. 요약 — Loop에 적용 가능한 패턴 상위 5개

**문서:** `docs/design/research/oss-agent-ui-survey.md`
**조사 대상:** pi(pi coding agent), opencode, gemini-cli, aider, crush, claude-code — 6개

1. **컬러를 역할(role) 이름의 폐쇄 집합으로 정의하고, 접근을 타입/클래스로 강제한다.** pi는 `ThemeColor`/`ThemeBg` 유니언 타입 밖의 색 접근 자체가 불가능하고(`theme.fg("error", s)`만 허용, §2), opencode는 `ThemeColor` 키 집합 밖의 토큰을 JSON이 가질 수 없다(§3), gemini-cli는 컴포넌트가 `SemanticColors`라는 시맨틱 구조체만 본다(§4). 어느 프로젝트도 컴포넌트에 원시 색 문자열을 흘리지 않는다.
2. **원시값 → 시맨틱 2계층 매핑이 표준이다.** pi는 `vars`(원시) → `colors`(역할), opencode는 `defs` → `theme`, gemini-cli는 `theme.ts`(raw 팔레트) → `semantic-tokens.ts`(역할), claude-code는 `base`(프리셋) → `overrides`(토큰) 구조다. 원시 팔레트를 아는 파일은 언제나 소수로 한정된다(§2–§5, §7).
3. **테마는 "코드 수정"이 아니라 "데이터 파일 + 검증"으로 확장한다.** 6개 중 5개(pi, opencode, gemini-cli, crush, claude-code)가 테마를 JSON 등 데이터로 분리하고, 스키마 검증(pi), 순환 참조·중복 이름 단위 테스트(opencode), 파일 파싱/해석 테스트(crush)로 무결성을 지킨다. 사용자 테마 폴더 핫리로드(pi, claude-code)까지 데이터 중심이다(§2, §3, §6, §7).
4. **프리미티브는 극소(2~6개)로 유지하고 나머지는 조합이다.** pi-tui는 box/text/stack 계열/spacer + 선택형 리스트(edit/select-list)가 전부이고, opencode는 @opentui의 box/text 원소 위에 `dialog-*` 조합 컴포넌트를 올린다. crush는 button/elements/diff 같은 공용 위젯 폴더 하나로 재사용한다(§2, §3, §6).
5. **환경 적응(색 능력·라이트/다크·NO_COLOR)은 프레임워크 한 곳의 관심사다.** pi는 truecolor/256색 모드 판정과 light/dark 자동 전환을 Theme 계층이 흡수하고, opencode의 `system` 테마는 터미널 배경색에서 그레이스케일을 생성하며, claude-code의 `auto` 프리셋은 OS 외관 변화를 따라간다. 호출점은 아무것도 감지하지 않는다(§2, §3, §7).

| # | 패턴 | Loop 적용 지점(감사 매핑) |
| --- | --- | --- |
| 1 | 역할 토큰 폐쇄 집합 + 접근 강제 | P1-1/P1-2(상태 색 부재) — `@loop/presentation` 토큰 모듈을 유니언 키 집합으로 |
| 2 | 원시→시맨틱 2계층 | P1-4(이중 시각 체계) — pi 토큰 어휘와 정합하는 Loop 시맨틱 계층 |
| 3 | 테마=데이터+검증 | P2(어휘 중복) — 글리프·문구를 상수 데이터로 모으고 테스트로 무결성 검사 |
| 4 | 극소 프리미티브 | P4-1(포맷터 분산) — presentation 프리미티브 레이어로 수렴 |
| 5 | 환경 적응의 중앙화 | P1-3/P3-1~P3-2(NO_COLOR·TTY·폭) — presentation 진입점 단일 가드 |

---

## 1. 조사 방법

- **수집:** 2026-09-24에 `git clone --depth 1`로 sst/opencode, google-gemini/gemini-cli, Aider-AI/aider, charmbracelet/crush의 `main` HEAD를 내려받아 소스를 직접 확인했다. pi는 로컬 npm 설치본(`@earendil-works/pi` 0.87.x, `pi-tui` 0.87.1)과 공식 문서, monorepo 루트 `package.json`(원문 fetch)을 사용했다. claude-code는 클로즈드 소스이므로 공식 문서(`code.claude.com/docs`) 원문 fetch로만 조사했다.
- **검증 원칙:** 모든 주장에 (a) 저장소 내 파일 경로, (b) 공식 문서 URL 중 하나를 출처로 붙인다. 이차 해석(블로그·튜토리얼)은 사용하지 않았다.
- **적용 대상:** `docs/design/research/loop-ui-audit.md`의 P1–P4.

## 2. pi (pi coding agent) — earendil-works/pi

모노레포(`packages/coding-agent` + TUI 프리미티브 전용 패키지 `pi-tui`). 조사 기준: 로컬 npm 설치본 0.87.x + `https://github.com/earendil-works/pi` 루트 `package.json`.

### 2.1 테마/컬러 시스템

- **정의 위치:** 내장 테마는 데이터 파일 2개(`dark.json`, `light.json`)와 JSON Schema(`theme-schema.json`) — 설치본 기준 `dist/modes/interactive/theme/`, 원본은 `packages/coding-agent/src/modes/interactive/theme/`. 사용자 테마는 `<agent-dir>/themes/<name>.json`.
- **2계층:** 테마 JSON은 `vars`(원시 팔레트, 변수 상호 참조 가능)와 `colors`(역할 배정)로 나뉜다. `dark.json`에서 `"vars": {"cyan": "#00d7ff", "green": "#b5bd68", …}` → `"colors": {"success": "green", "error": "red", …}`. 순환 참조·미정의 변수는 테마 무효 처리된다.
- **역할 어휘:** `ThemeColor`(전경 47개: `accent`, `border*`, `success/error/warning`, `muted`, `dim`, `text`, `toolTitle`, `toolDiff*`, `md*`, `syntax*`, `thinking*` …)와 `ThemeBg`(배경 7개: `selectedBg`, `toolPendingBg`, `toolSuccessBg`, `toolErrorBg` …)의 폐쇄 유니언. 선택적 토큰(`scrollbarTrack` 등 5개)만 지정된 폴백을 가진다. 출처: `dist/modes/interactive/theme/theme.d.ts`, `docs/themes.md`.
- **접근 강제:** 역할 소비 API는 `Theme` 클래스의 `fg(color: ThemeColor, text)` / `bg(color: ThemeBg, text)` / `bold(text)`뿐이다. 컴포넌트는 임의 색 문자열을 받을 수 없다(같은 `.d.ts`).
- **환경 적응:** hex는 truecolor 우선, 미지원 터미널은 256색 근사(`ColorMode = "truecolor" | "256color"`); `""`(빈 문자열)은 터미널 기본색 위임. 테마 설정에 `"light/dark"` 형식을 쓰면 터미널 외관 변화에 따라 자동 전환. 출처: `docs/themes.md`, `theme.d.ts`.

### 2.2 컴포넌트 프리미티브

- **전용 프리미티브 패키지 `pi-tui`:** `box`, `text`, `h-stack`, `v-stack`, `stack`, `spacer`, `scroll-view`, `truncated-text`(말줄임), `editor`(멀티라인 편집기), `input`, `select-list`, `autocomplete`, `settings-list`, `markdown`, `image`, `loader`, `mouse-region` 등. 레이아웃은 `layout-node`가 담당(.flex 기반 자체 엔진). 출처: 설치본 `node_modules/@earendil-works/pi-tui/dist/` 컴포넌트 나열.
- **구조:** "레이아웃 프리미티브(box/stack/spacer) + 인터랙션 프리미티브(editor/select-list) + 표현 유틸(truncated-text/markdown)"의 3종 분리. 코딩 에이전트 UI(pi 본체의 대화·툴 뷰)는 이 프리미티브의 조합이며, 색은 오직 `Theme` 역할 경유.

### 2.3 일관성 강제

- **스키마 검증:** 사용자 테마 JSON은 JSON Schema로 검증되고, "Pi reports invalid theme files during startup and `/reload`"(`docs/themes.md`). 내장 테마는 기본 비검증, 사용자 테마만 typebox 검증기 장착(모듈 그래프 17MB 비용 절약 주석) — `dist/modes/interactive/theme/theme.d.ts`의 `setThemeJsonValidator` 주석.
- **린트/테스트:** 모노레포 루트 `package.json`의 `check` = `biome check --write --error-on-warnings .` + 커스텀 검사 스크립트(`check:ts-imports`, `check:entry-graphs`, `check:pinned-deps`, `check:shrinkwrap` …) + `tsgo --noEmit`. 테스트는 워크스페이스별 vitest(`packages/coding-agent` `"test": "vitest --run"`).

## 3. opencode — sst/opencode

SolidJS 기반 TUI(@opentui/core + @opentui/solid). 조사 기준: 2026-09-24 `main` 클론.

### 3.1 테마/컬러 시스템

- **정의 위치:** 내장 테마 30여 개가 JSON 데이터 파일로 존재 — `packages/tui/src/theme/assets/*.json`(aura, ayu, catppuccin, dracula, gruvbox, nord, tokyonight …). 런타임 로더는 `packages/tui/src/theme/index.ts`.
- **2계층:** `ThemeJson = { $schema?, defs?, theme }` — `defs`(원시/별칭)를 `theme`(역할 토큰 `Record<ThemeColor, ColorValue>`)가 참조. `ColorValue = HexColor | RefName | Variant{dark,light} | RGBA`. 하나의 JSON이 라이트/다크 변형(`Variant`)을 모두 표현한다. 출처: `packages/tui/src/theme/index.ts:92-131`.
- **역할 어휘:** `primary/secondary/accent/error/warning/success + border + background + text + dim/muted + syntaxHighlighting(언어별 스타일)` 등 역할 키의 폐쇄 집합(같은 파일 `ThemeColor`).
- **환경 적응:** `system` 테마는 터미널 배경색에서 그레이스케일을 생성하고 ANSI 0–15를 사용해 사용자 팔레트를 존중(`generateSystem`, `index.ts:360`; `packages/web/src/content/docs/themes.mdx`). 선택 배경 대비는 명시 토큰이 없으면 휘도 계산으로 자동 결정(`selectedForeground`, `index.ts:92-107`).
- **확장:** 설정/플러그인 테마 발견은 `context/theme.tsx`의 `themeSource.discover()`(전역 config + cwd 상위 탐색). `/theme` 다이얼로그(`component/dialog-theme-list.tsx`)로 선택.

### 3.2 컴포넌트 프리미티브

- **원시 레이아웃/렌더는 @opentui(core) 소유**, opencode TUI는 `packages/tui/src/component/` 아래 조합 컴포넌트만 추가한다: `dialog-*` 20여 종(모델/세션/테마/태그…), `todo-item`, `spinner`, `startup-loading`, `workspace-label` 등. 컴포넌트는 `useTheme()` 컨텍스트로만 색을 얻는다(`context/theme.tsx:102` — `export const { use: useTheme, provider: ThemeProvider }`).
- **패턴:** "기능별 파일 1개 + 접두사 일관성(dialog-*)" — 새 화면 추가 시 파일 하나, 테마 컨텍스트 주입. 프리미티브 자체를 opencode가 재발명하지 않는다.

### 3.3 일관성 강제

- **테스트:** `packages/tui/test/theme.test.ts` — 중복 이름 거부, `theme` 객체 없는 항목 거부, **순환 참조 throws 검증**(`resolveTheme`가 "Circular color reference" throw), 터미널 팔레트 기반 시스템 테마 해석 검증.
- **린트/타입/훅:** 루트 `package.json` — `lint: oxlint`, `typecheck: bun turbo typecheck`(패키지별 `tsgo --noEmit`), `prepare: husky`(pre-commit). 루트 테스트는 의도적으로 금지(`"test": "echo 'do not run tests from root' && exit 1"`)하고 패키지 단위 실행을 강제.

## 4. gemini-cli — google-gemini/gemini-cli

React + Ink TUI. 조사 기준: 2026-09-24 `main` 클론.

### 4.1 테마/컬러 시스템

- **정의 위치:** raw 팔레트는 `packages/cli/src/ui/themes/theme.ts`(lightTheme/darkTheme/ANSI + `ThemeType = 'light' | 'dark' | 'ansi' | 'custom'`). **시맨틱 계층이 별도 파일** — `packages/cli/src/ui/themes/semantic-tokens.ts`.
- **2계층:** `lightSemanticColors`가 raw 토큰(`lightTheme.Foreground`, `lightTheme.AccentBlue` …)을 역할로 매핑한다. `SemanticColors` 구조체는 `text{primary,secondary,link,accent,response}`, `background{primary,message,input,focus,diff{added,removed}}`, `border`, `ui{comment,symbol,active,dark,focus,gradient}`, `status{error,success,warning}` — 상태 3종이 타입 수준으로 보장된다(`semantic-tokens.ts:11-40`).
- **소비:** 컴포넌트는 `semanticColors`만 참조한다(예: `components/Header.tsx`, `ColorsDisplay.tsx`). UI가 raw 팔레트 키를 모른다.
- **확장:** 커스텀 테마는 `settings.json`의 `customThemes` 블록(사용자/프로젝트/시스템 스코프, 설정 우선순위 준수) + 확장 기여 테마(`theme-manager.ts:128-186` `loadCustomThemes`/확장 등록). `ThemeDialog`가 라이브 선택 UI. 출처: `docs/cli/themes.md`.

### 4.2 컴포넌트 프리미티브

- Ink의 `Box`/`Text`가 원시. 프로젝트 고유 컴포넌트 100여 개가 `packages/cli/src/ui/components/`에 **파일당 컴포넌트 1개 + 동치 `*.test.tsx` + `__snapshots__/`** 관행으로 놓여 있다(AppHeader, Composer, Checklist, DetailedMessagesDisplay …).

### 4.3 일관성 강제

- **린트:** 루트 `lint` = `eslint . --cache --max-warnings 0`(경고 0 허용 안 함), `no-restricted-syntax`/`no-restricted-imports`/`no-console: error` 등(`eslint.config.js:106-254`).
- **테스트:** 테마 자체 단위 테스트 3종(`themes/color-utils.test.ts`, `theme-manager.test.ts`, `theme.test.ts`) + 컴포넌트 스냅샷 테스트(Ink 렌더 문자열 비교).
- **프로세스:** husky pre-commit, CI(`.github/workflows/ci.yml`), CODEOWNERS + PR 템플릿(`.github/CODEOWNERS`, `pull_request_template.md`) — 리뷰 게이트 존재.

## 5. aider — Aider-AI/aider

prompt_toolkit 기반 채팅 CLI. 조사 기준: 2026-09-24 `main` 클론. **대조군(한계 사례)으로 가치가 크다.**

### 5.1 테마/컬러 시스템

- **정의 위치:** 테마 파일 없음. 색은 `InputOutput` 생성자 인자 나열 — `aider/io.py:283-296`(`user_input_color`, `tool_output_color`, `tool_error_color`, `tool_warning_color`, `assistant_output_color`, `completion_menu_*`). 다크/라이트 프리셋은 `aider/main.py:534-544`의 하드코딩(`--dark-mode`: user_input `#32FF32`, error `#FF3333`, code_theme `monokai`; `--light-mode`: green/red/`#FFA500`, code_theme `default`).
- **코드 하이라이트:** pygments 스타일 이름을 `--code-theme`으로 위임(`aider/args.py:391` — "a Pygments builtin style"), diff/코드 렌더는 `PygmentsLexer` 경유(`io.py:23,350`).
- **환경 적응:** `pretty` 플래그가 색 자체를 None 처리(`io.py:283`), 비-pretty는 `Console(no_color=True)`(`io.py:361-364`). 자동 라이트/다크 감지는 없음(플래그 수동).

### 5.2 컴포넌트 프리미티브

- 없음에 가깝다. prompt_toolkit 스타일 dict를 `io.py`가 직접 조립(`style_dict.setdefault`, `completion_menu_style.append` … `io.py:405-426`)하고, UI 로직도 `io.py` 단일 파일에 집중된다.

### 5.3 일관성 강제

- pre-commit(isort/black/flake8, `.pre-commit-config.yaml`), GitHub Actions ubuntu/windows 테스트(`.github/workflows/ubuntu-tests.yml`, `windows-tests.yml`, `pre-commit.yml`), `tests/` 하위 유닛 테스트. 테마 일관성을 강제하는 장치는 없음 — 색 상수가 args→main→io로 흩어져 있어 "테마 추가 = 여러 파일 수정"이 되는 구조. **Loop 감사 P4-1(main.ts 포맷터 분산)과 동형의 문제가 대규모로 나타난 사례.**

## 6. crush — charmbracelet/crush

Bubble Tea + Lipgloss v2(Go). 조사 기준: 2026-09-24 `main` 클론.

### 6.1 테마/컬러 시스템

- **정의 위치:** `internal/ui/styles/themes.go` — `Styles` 구조체(키별 lipgloss 스타일 집합)가 단일 원천. 내장 테마는 `builtinThemes map[string]func() quickStyleOpts`(기본 팔레트) + `builtinThemeOverrides map[string]func(Styles) Styles`(테마별 보정)의 2단 구성. 사용자 테마는 JSON 파일(`Base`+`Palette` → `LoadPaletteTheme`)이며 **사용자 파일이 내장 테마보다 우선**(`FindThemeFile` 우선 검색, `themes.go:318-334`).
- **호환 규율:** `deprecatedThemeNames`로 구이름 → 신희 이름 정규화("existing configs and user theme files keep resolving", `themes.go:267-272`). 알 수 없는 테마명/깨진 파일은 기본 테마로 폴백하되 **`slog.Warn`으로 기록**("a missing or broken theme file is not silently replaced", `themes.go:326-334`) — 조용한 대체 금지 원칙.
- **컬러 모델:** lipgloss v2 + charmtone(색 조화 유틸). provider별 테마 매핑은 `ThemeKeyForProvider`가 "single source of truth"(`themes.go:19-29`).

### 6.2 컴포넌트 프리미티브

- `internal/ui/common/`의 공용 위젯 — `button.go`, `elements.go`, `diff.go`, `highlight.go`, `ansi16.go`, `chromastyle.go` + 대화상자는 `internal/ui/dialog/`(theme dialog/editor 포함). 위젯은 `Styles`에서 자신의 키만 꺼내 쓴다.

### 6.3 일관성 강제

- **동치 테스트 밀도:** 테마 관련만 `themes.go`에 `theme_test.go`, 별도 `theme_resolution_test.go`/`theme_file_test.go`(파일 로딩·이름 정규화·우선순위), 위젯별 `button_test.go`/`elements_test.go`/`common_test.go` 등 **소스 옆 colocated Go 테스트**.
- **린트:** `.golangci.yml` 존재(저장소 루트). 코드 리뷰는 GitHub PR 흐름(저장소 운영 관례상 — 세부 규정 문서는 확인 불가).

## 7. claude-code — Anthropic (클로즈드 소스)

소스 비공개(npm 패키지는 minified). 공식 문서 원문만 조사: `https://code.claude.com/docs/en/terminal-config`(2026-09-24 접근, Markdown 원문 fetch).

### 7.1 테마/컬러 시스템

- **내장 프리셋 6종:** `dark`, `light`, `dark-daltonized`, `light-daltonized`, `dark-ansi`, `light-ansi`(색약 변형 + ANSI 전용 변형). `/theme` 또는 `/config` 피커로 선택, `auto`는 터미널 라이트/다크 배경을 따라가며 OS 외관 변화 추적.
- **커스텀 테마 = 프리셋 + 토큰 오버라이드:** `~/.claude/themes/*.json`의 `{name, base, overrides}`. 토큰 참조는 공식 문서의 "Color token reference"가 영역별 표로 정의 — 텍스트/강조(`claude`, `text`, `inverseText`, `inactive`, `subtle` …), 상태(`success`, `error`, `warning`, `merged`), 입력/모드(`promptBorder`, `planMode`, `autoAccept`, `bashBorder` …), diff(`diffAdded/Removed(+Dimmed/Word)`), 전체화면 배경(`userMessageBackground`, `selectionBg` …), 미터/라벨, shimmer 변형 쌍(`claude`+`claudeShimmer`).
- **관대한 파싱 vs 엄격한 검증의 절충:** "Unknown tokens and invalid color values are ignored, so a typo cannot break rendering" — 오타가 렌더링을 깨지 않는다(pi는 무효 테마를 시작 시 보고하는 엄격파). 색 값은 `#rrggbb`, `#rgb`, `rgb()`, `ansi256(n)`, `ansi:<name>` 허용.
- **배포·수명:** 테마 디렉터리를 감시(watch)해 파일 변경 즉시 적용, 플러그인이 테마 기여 가능, `/theme` 내 인터랙티브 편집기로 토큰별 라이브 프리뷰 편집.

### 7.2 컴포넌트 프리미티브 / 7.3 일관성 강제

- 소스 비공개로 **확인 불가.** 컴포넌트 구조, 내부 린트/테스트/리뷰 규율은 공개 자료가 없다. 문서상 강제 장치는 토큰 참조 표(문서화된 어휘)와 인터랙티브 편집기(어휘 밖 값의 입력 차단)뿐이다.

## 8. 횡단 비교

| 프로젝트 | 테마 정의 위치 | 컬러 모델(계층) | 프리미티브 | 일관성 강제 |
| --- | --- | --- | --- | --- |
| pi | JSON 파일+스키마(`theme/dark.json`, `theme-schema.json`) | vars→colors 2계층, 역할 유니언 54키 | 전용 패키지 pi-tui(box/text/stack/editor/select-list…) | JSON Schema 검증(시작+`/reload`), biome+커스텀 check 스크립트, vitest |
| opencode | JSON 30여 개(`packages/tui/src/theme/assets/`) | defs→theme 2계층, `Variant` 라이트/다크 동시 표현 | @opentui 원시 + `dialog-*` 조합 컴포넌트 | 순환참조·중복 테스트, oxlint, turbo typecheck, husky |
| gemini-cli | TS(`theme.ts`) + 시맨틱 파일 분리(`semantic-tokens.ts`) | raw→SemanticColors 2계층(상태 3종 타입 보장) | Ink Box/Text + 파일당 컴포넌트+스냅샷 | eslint `--max-warnings 0`, colocated 테스트, CODEOWNERS/PR 템플릿 |
| aider | 없음(생성자 인자+main.py 하드코딩) | 1계층(평평한 색 문자열) | 없음(io.py가 style dict 직접 조립) | isort/black/flake8 + CI 테스트 (테마 강제 장치 없음) |
| crush | Go 코드(`themes.go`)+사용자 JSON | quickStyle(팔레트)→override(보정) 2단, Styles 구조체 | `internal/ui/common` 공용 위젯(button/elements/diff) | colocated Go 테스트(해석/파일/위젯), golangci-lint, 폴백 시 경고 로그 |
| claude-code | `~/.claude/themes/*.json`(문서화된 토큰 참조) | base 프리셋→overrides 2계층 | 확인 불가 | 토큰 참조 문서+인터랙티브 편집기(소스/린트는 확인 불가) |

**공통 불변식:** (1) 원시 색을 아는 파일은 항상 소수(테마 정의 파일뿐), (2) UI 코드가 참조하는 것은 역할 이름뿐, (3) 상태 색(success/error/warning)과 diff 색(added/removed)은 6개 모두가 1급 어휘로 포함 — pi(`toolDiff*`), opencode(`syntaxHighlighting`+border), gemini-cli(`diff.added/removed`), claude-code(`diffAdded/Removed`), crush(`diff.go`), aider(pygments diff 색). Loop 감사 P1-1(상태가 단어로만 구분)이 바로 이 어휘의 결여다.

**차이점 1개:** 파싱 실패 정책. pi는 무효 테마를 명시적으로 보고(엄격), claude-code는 무시(관대), crush는 기본 폴백+경고 로그(중간). Loop 같은 내장 표면이 적은 제품은 pi/crush형 "명시적 보고 또는 로그 폴백"이 적합하다.

## 9. Loop 적용 권고 (패턴 → 설계 지문)

`design-system-practices.md`의 R1–R5(업계 관행)와 상호 검증된 결과다. OSS 에이전트 6개가 실제로 채택한 방식이므로 "TUI라서 안 되는" 반례는 없다.

1. **토큰 모듈을 "역할 키의 폐쇄 집합"으로 선언하라(R1 보강).** pi처럼 유니언/키 집합으로 정의하고, 상태색(`success/warning/error/attention`), diff(`added/removed`), 강조(`accent/muted/dim/text`)는 최소 어휘로 포함한다. 호출점이 원시 hex/ANSI를 쓸 경로를 타입 수준에서 남기지 않는다(§0 패턴 1, gemini-cli SemanticColors 참조).
2. **원시값은 토큰 파일(또는 모듈 상단 상수) 한 곳에만(§0 패턴 2).** 나중에 다크/라이트를 나눌 때 파일 하나의 diff가 되도록 pi `vars`/opencode `defs` 대비 역할 매핑 구조를 유지한다.
3. **테마·어휘를 데이터로 취급하고 무결성 테스트를 붙여라(§0 패턴 3).** Loop의 글리프/구분자/빈 상태/overflow 문구(P2-1~P2-3)를 상수 데이터로 모으면, opencode의 "중복 이름 거부·순환 참조 throw"처럼 표 어휘 무결성을 단위 테스트로 잠글 수 있다. 기존 `cli.test.ts` 64단언이 회귀 망이다.
4. **프리미티브는 최소로 — box/text/stack 수준에서 시작(§0 패턴 4).** Loop는 현재 스냅샷 텍스트 렌더러가 전부이므로, pi-tui의 `truncated-text`(말줄임+overflow 카운트) 하나가 이미 `compactLines`의 대응물이다. 프레임워크 도입 없이 프리미티브 레이어(P4-1 수렴)부터.
5. **환경 적응을 presentation 진입 한 곳에(§0 패턴 5).** `NO_COLOR`/TTY/색 능력 판정과 (차기) 터미널 폭 인식을 토큰 모듈 옆 가드 함수로. pi의 truecolor→256 근사, opencode system 테마가 하는 일의 최소 버전이면 충분하다(P1-3, P3-2).

---

## 부록 A. 근거 목록

- **pi:** 로컬 설치본 `@earendil-works/pi`(0.87.x): `dist/modes/interactive/theme/{theme-schema.json,dark.json,light.json,theme.d.ts,theme-controller.js}`; `node_modules/@earendil-works/pi-tui/`(0.87.1, `dist/components/`); `docs/themes.md`(공식, 동일 설치본). 모노레포 루트: `https://raw.githubusercontent.com/earendil-works/pi/main/package.json` (2026-09-24 fetch).
- **opencode:** 클론(2026-09-24): `packages/tui/src/theme/index.ts`, `packages/tui/src/theme/assets/*.json`, `packages/tui/src/context/theme.tsx`, `packages/tui/test/theme.test.ts`, `packages/tui/package.json`, 루트 `package.json`, `packages/web/src/content/docs/themes.mdx`.
- **gemini-cli:** 클론(2026-09-24): `packages/cli/src/ui/themes/{theme.ts,semantic-tokens.ts,theme-manager.ts,color-utils.test.ts,theme.test.ts}`, `packages/cli/src/ui/components/`(스냅샷 구조), `eslint.config.js`, `package.json`, `docs/cli/themes.md`, `.github/{CODEOWNERS,pull_request_template.md,workflows/ci.yml}`.
- **aider:** 클론(2026-09-24): `aider/io.py`(283-296, 405-426, 361-364), `aider/main.py`(534-544), `aider/args.py`(391), `.pre-commit-config.yaml`, `.github/workflows/{ubuntu-tests,windows-tests,pre-commit}.yml`.
- **crush:** 클론(2026-09-24): `internal/ui/styles/{themes.go(19-29, 252-335), theme_resolution_test.go, theme_file_test.go}`, `internal/ui/common/{button.go,elements.go,diff.go,…}`, `.golangci.yml`.
- **claude-code:** `https://code.claude.com/docs/en/terminal-config`(2026-09-24 Markdown fetch — 테마 프리셋/커스텀 테마/토큰 참조 전문).

## 부록 B. 확인 불가 항목

- claude-code의 소스 구조(컴포넌트 프리미티브), 내부 린트/테스트/코드 리뷰 규율 — 소스 비공개.
- crush의 코드 리뷰 세부 규정(PR 승인 수 등) — 저장소에 규정 문서 없음.
- 각 프로젝트의 "UI 깨짐 방지" 전용 CI(시각 회귀 등) 운영 여부 — 6개 모두 저장소 내 관련 워크플로를 발견하지 못했다(스냅샷 테스트는 gemini-cli에서 확인).

## 부록 C. 검증

- 본 조사는 읽기 전용이며 코드·테스트 변경이 없으므로 `bun run check` 대상 변경도 없다.
- 완료 확인: `test -s docs/design/research/oss-agent-ui-survey.md && grep -qiE '^## ' docs/design/research/oss-agent-ui-survey.md`
