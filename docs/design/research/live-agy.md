# live-agy — agy(구글 Antigravity CLI) 실행 바이너리 실증 조사

- **조사 대상:** `.research-sources/agy` → `/Users/loopy/.local/bin/agy` (Mach-O 64-bit arm64, 176MB, go1.28)
- **조사 방법:** `go version -m`(빌드 정보), `strings` 전량 덤프(/tmp/agy-research/all-strings.txt) + Python 바이트 스캔(Go 문자열 블롭은 개행이 없어 문자열 단위 grep이 실패한다 — 유니코드 글리프는 UTF-8 바이트 시퀀스로 직접 검색), `agy --help` / `agy changelog` / `agy models` 실행 관찰
- **증거 표기:** **[BIN]** = 바이너리 내 문자열/심볼/pclntab 경로, **[RUN]** = 실행 관찰, **[PROTO]** = 바이너리 내 포토 디스크립터(protobuf descriptor) 원문
- **한계 선언:** agy는 **공개 소스가 없다**(§1). 따라서 본 문서 전체가 바이너리 문자열·심볼 테이블·프로토 디스크립터에서 복원한 증거이며, 소스 행 번호 수준의 검증은 불가능하다. 공개 소스 교차 검증은 수행하지 못했다(불가), 그 대신 바이너리가 스스로 진술하는 것(changelog, --help, 내장 문서 경로)을 1차 증거로 삼았다.
- **위치:** `docs/design/research/live-agy.md` (조사 전용, 코드 변경 없음, 분석 산출물은 /tmp에 한정)

---

## 0. 요약

**식별 결과:** agy는 **Google Antigravity CLI v1.2.9** 다. **[BIN]** 내부 패키지 경로 `google3/third_party/jetski/**`(jetbox, gemini_coder, cortex 등 코드명)과 **[RUN]** changelog 1.2.9 항목의 "browser companion page title to read `Antigravity CLI`"가 이를 직접 증명한다. UI는 **Charm 스택(lipgloss v2 + bubbles v2 + bubbletea v2 + glamour v2 + termenv)** 을 google3 내부 미러(`charm_land`)로 밴더링해 구현했다.

**agy의 디자인 일관성 단서 3개** (§3·§5 상세):

1. **테마·색·브랜드를 한 패키지에서 토큰으로 선언하고, 라이트/다크는 "시드(seeds)에서 파생"시킨다.** — `cli/types/{theme,colorscheme,brand}.go` 파일 3종 **[BIN]**, 상태 저장 proto의 `CustomThemeSeeds × {light, dark}` + `ThemeMode{DARK,LIGHT,INHERIT}` **[PROTO]**, 팔레트 진화용 `cli/onboarding/color_migration.go` **[BIN]**. 색 원본이 코드 곳곳이 아니라 한 곳에 살고, 모드 분기는 데이터 파생으로 해결된다.
2. **모든 화면 출력이 `render/` 패키지의 단일 관문을 통과한다.** — `render/{styles,wrap_ansi,cut,FlattenToLine,TruncateAnsi,StatusMarker,hint,header,scrollbar}.go` **[BIN]**: 스타일 적용, ANSI 인식 절단/랩, 상태 마커, 키 힌트가 한 디렉터리의 재사용 함수로 존재한다. 컴포넌트가 각자 ANSI를 조립할 수 없는 구조다.
3. **레이아웃은 "크롬 회계(예산제)" + 표준 힌트 세트로 통일된다.** — `layout.{Layout.FrameOverhead, MessageListAvailableLines, PanelAvailableLines}`, `Column.{ChromeLines, AvailableHeight, renderKeyboardHints}`, `RenderHints` + `KeyHint{HintNavigate, HintPage, HintSwitchView}` + 기본 세트(`DefaultModelHints`, `DefaultDetailViewHints`) **[BIN]**. 모든 뷰가 같은 높이 회계를 쓰고, 푸터 힌트는 3종 표준 어휘 중에서만 고른다.

부수 관찰: 상태 어휘가 소집합(Working/Running/Thinking/Pending/Queued/Failed/Idle)으로 수렴하고 **[BIN]**, 상태 자체는 `ActivitySnapshot`을 `reconcileStatus`로 재조정하는 파생값이다(§4). 인라인/알트스크린 이중 전략, kitty 그래픽 → ASCII 폴백의 저하 계단도 일관성의 일부다(§5).

---

## 1. 식별 — 빌드 정보와 원래 프로젝트

### 1.1 빌드 정보

```
$ go version -m .research-sources/agy
/Users/loopy/.local/bin/agy: go1.28-20260721-RC03 cl/951519500 +3ebc191975 X:fieldtrack,boringcrypto,mapsplitgroup
```

- `cl/951519500` = Google 내부 체인지리스트 번호, `boringcrypto`/`fieldtrack` = Google 내부 툴체인 빌드 플래그. **[RUN]**
- 모듈/의존성 목록이 출력되지 않는다 — google3(Bazel 계열) 빌드의 전형으로, 표준 Go buildinfo의 의존성 절이 채워지지 않았다. **의존성 버전은 바이너리에서 직접 복원해야 했다.**

### 1.2 원래 프로젝트 식별

**[BIN]** google3 소스 경로(심볼 테이블/pclntab에 잔존, 유니크 43,401개 중 주요 것):

```
google3/third_party/jetski/cli/…            (5,979 hits) ← CLI 본체
google3/third_party/jetski/cortex/…         ← 에이전트 엔진 (trajectory, tools, handlers)
google3/third_party/jetski/jetbox_state_pb/ ← 세션/설정 상태 proto (ThemeMode 포함, §3)
google3/third_party/jetski/language_server* ← 내장 언어서버
google3/third_party/jetski/codeium_common_pb/ + .exa. proto 프리픽스
google3/…/gemini_coder + gemini_coder_go_proto (2,587 hits of "gemini_coder")
```

- `jetski`, `jetbox`, `cortex`는 내부 코드명이다. `.exa.`/`codeium_common_pb` 접두 **[PROTO]** 은 Codeium/Windsurf 계열 기술 유산을 시사한다(추정 — 바이너리 증거는 접두사의 존재까지만 보장).
- 결정적 증거는 **[RUN]** 자기 진술이다. `agy changelog` v1.2.9:

  > Fixed the browser companion page title to read `Antigravity CLI` instead of `Antigravity Cli`

  즉 **agy = A**nti**g**ravit**y** CLI, 현재 버전 1.2.9(changelog에 버전 엔트리 55개).
- 공개 소스 조회: **불가**. Antigravity CLI는 오픈소스가 아니며 google3 소스가 공개되어 있지 않다. (참고: `google-gemini/gemini-cli`는 TypeScript 프로젝트로 별개 제품 — agy는 Go 바이너리이며 내부 구조가 다르다.) 이 문서는 **바이너리 증거만으로 한계를 명시하며** 작성됐다.

### 1.3 내장 문서 구조

**[BIN]** `agy-customizations/docs/{skills,rules,plugins,mcp_servers,json_configs,hooks}.md` — 사용자 설정 문서 파일명이 문자열로 내장돼 있다(도움말이 문서 파일명을 참조하는 구조).

---

## 2. 스타일 스택 — google3에 밴더링된 Charm v2

### 2.1 라이브러리 흔적

**[BIN]** `google3/third_party/golang/charm_land/**` — Charm 라이브러리의 google3 내부 미러(`charm_land`) 경로가 심볼 테이블에 1,282건:

| 경로 | 심볼 참조 수 | 역할 |
|---|---|---|
| `charm_land/lipgloss/v/v2` | 524 | 스타일·경계·색·정렬 |
| `charm_land/bubbles/v/v2` | 348 | 재사용 컴포넌트 |
| `charm_land/bubbletea/v/v2` | 278 | TUI 런타임(Elm 아키텍처) |
| `charm_land/glamour/v/v2` | 132 | 마크다운 렌더링 |

`github.com/charmbracelet/...` 원본 경로는 0건 — **전량 내부 미러로 재작성**됐다(vendoring 일관성). termenv(lipgloss의 하위 의존) 심볼도 확인: `termenv.{Color, ANSIColor, RGBColor, Profile, Output, Environ, ConvertToRGB}`.

### 2.2 lipgloss v2 API 사용 흔적

**[BIN]** 심볼: `lipgloss.Style`(222건), `lipgloss.Border`(+`GetTopSize/GetRightSize/…`), `lipgloss.Position`, `lipgloss.JoinHorizontal/JoinVertical`, `lipgloss.Wrap/NewWrapWriter`, `lipgloss.StyleRanges/NewRange`, `lipgloss.Blend1D`, 그리고 **`lipgloss.LightDark`** — lipgloss v2의 라이트/다크 적응색 API로, 런타임 배경 감지에 따라 한 토큰이 두 색을 갖게 한다(§3의 OSC 감지와 짝).

스타일 메서드 흔적: `Style.borderBlend`, `Style.applyBorder`, `Style.getBorderStyle`, `Style.styleBorder(Blend)`, `Style.getAsColors` — 경계와 색이 Style 빌더로만 조립됨을 알 수 있다.

### 2.3 glamour(마크다운)와 chroma 스타일

**[BIN]** `glamour.NewTermRenderer`, `glamour.WithStyles`, `glamour.WithWordWrap`, `glamour.WithPreservedNewLines`. 코드 하이라이트 스타일 이름이 chroma 프리셋 그대로 내장돼 있다: `"monokai"`, `"solarized-dark"`, `"solarized-light"`, `"dracula"`, `"gruvbox"`, `"gruvbox-light"`, `"nord"`, `"tokyonight-{day,moon,night,storm}"`, `"github-dark"`, `"onedark"`, `"hrdark"`, `"aura-theme-dark[-soft]"`, `"xcode-dark"`, `"paraiso-{dark,light}"` 등. **마크다운 코드블록의 색은 자체 발명이 아니라 검증된 프리셋 택1**이라는 점이 일관성 장치다.

### 2.4 스피너

**[BIN]** 바이너리에 10-프레임 브라유 스피너가 연속 문자열로 존재한다:

```
⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏
```

charmbracelet bubbles의 `MiniDot` 프리셋과 프레임까지 동일한 세트다. `bubbles/v/v2/spinner` 임포트 흔적(17건)과 함께 볼 때, 스피너 프레임은 자체 제작이 아니라 bubbles 프리셋 재사용이다. 이진 문자열 끝에 `⟳ ✓ `라는 복합 글리프 쌍도 관찰된다(진행↔완료 전환용으로 보이나 용도 확정은 불가).

### 2.5 저수준 터미널 제어 어휘

**[BIN]** 이스케이프 시퀀스 원문:

| 시퀀스 | 용도 |
|---|---|
| `\x1b[?1049h/l` | 알트스크린 진입/복귀 |
| `\x1b[?2026h/l` | 동기화 출력(찢김 방지) |
| `\x1b[?2027h` | 그래핌 클러스터링 |
| `\x1b[?u`, `\x1b[>4;2m` | kitty 키보드 프로토콜 |
| `\x1b]11;?`, `]10;?`, `]12;?` | **배경/전경/커서색 조회 → 라이트/다크 감지** |
| `\x1b]9;4;1..4;` | 진행률 알림(OSC 9;4) |
| `\x1b]8;;`, `]8;id=` | OSC 8 하이퍼링크 |
| `\x1b]52;c;` | OSC 52 클립보드 |
| `\x1b]2;` | 창 타이틀 |
| `ANSI256` | 색 프로파일 문자열(termenv 계열) |

터미널 식별 환경변수 흔적도 있다: `MATE_TERMINAL_SERVICE`, `GNOME_TERMINAL_SCREEN`, `TERM=rxvt/tmux/foot` 등 — **터미널 능력을 감지해 어휘를 낮추는 계단(graeful degradation)이 스택에 내장**돼 있다.

---

## 3. 테마·색 시스템 — "토큰 한 곳 + 시드 파생 + 모드 데이터"

### 3.1 테마 상태는 proto 열거형으로 저장된다

**[PROTO]** `jetbox_state_pb`:

```
enum ThemeMode { THEME_MODE_UNSPECIFIED; THEME_MODE_DARK; THEME_MODE_LIGHT; THEME_MODE_INHERIT; }
enum ConversationWidth { CONVERSATION_WIDTH_UNSPECIFIED; DEFAULT; NARROW; WIDE; }
message … { CustomThemeSeeds custom_theme_seeds_light; CustomThemeSeeds custom_theme_seeds_dark; }
```

**[PROTO]** `codeium_common_pb`: `enum ThemePreference { UNSPECIFIED; AUTO; LIGHT; DARK; }` — 사용자 설정(시스템 추종 포함)과 세션 모드(INHERIT 포함)가 **분리된 두 열거형**으로 관리된다. 레이아웃 폭 선호(NARROW/WIDE)조차 상태 proto의 일급 필드다.

### 3.2 시드 기반 테마 파생

**[PROTO]** `CustomThemeSeeds`(라이트/다크 한 쌍) + **[BIN]** `cli/onboarding/color_migration.go`. 즉 agy의 테마는 "완성된 팔레트 N개를 고르는" 모델이 아니라 **시드 색으로부터 모드별 팔레트를 파생시키고, 파생 규칙이 바뀌면 마이그레이션으로 이주시키는** 모델이다. 색의 원본(ground truth)이 하나의 메시지 타입에 봉인된다.

### 3.3 토큰의 물리적 위치

**[BIN]** pclntab에 남은 파일 경로(소스 트리 구조의 직접 증거):

```
third_party/jetski/cli/types/theme.go        ← 테마 타입
third_party/jetski/cli/types/colorscheme.go  ← 컬러스킴
third_party/jetski/cli/types/brand.go        ← 브랜드(로고/제품명 계열)
third_party/jetski/cli/types/{terminal,verbosity,permissions,settings}.go
third_party/jetski/cli/render/styles.go      ← 스타일 정의 본체
third_party/golang/charm_land/lipgloss/v/v2/{size,unset,wrap}.go
```

테마·컬러스킴·브랜드가 **`types` 패키지 파일 3종으로 분리**돼 있고, 소비측(`render`)은 그 토큰을 조립만 한다.

### 3.4 브랜드 팔레트 상수

**[BIN]** UI 문자열 클러스터 안에 Google 브랜드 4색이 연속 상수로 존재한다:

```
#4285F4  #EA4335  #FBBC04  #34A853   ← Google 블루/레드/옐로/그린
#CC7700                            ← (직전 문자열 "CAUTION", "Blocked" 근처 = 경고 오렌지)
```

커스텀 파생 팔레트와 별도로 **브랜드 고정색은 상수로 별도 관리**되는 흔적이다.

---

## 4. 상태 표현 — 어휘·글리프·상태 재조정

### 4.1 상태 어휘 집합

**[BIN]** 상태 단어 출현 빈도(바이너리 전체): `Failed`(205), `Working`(61), `Running`(40), `Pending`(33), `Complete`(18), `Thinking`(12), `Completed`(5), `Idle`(2), `Queued`(1). UI 문자열로 확인되는 조합형 상태: `⎿  Thinking...`, `Thinking:`, `Thought for %s`(사고 경과), `Processing...`, `worked %s`, `%d done`, `Loading`, `steps %d–%d (loading...)`, `No steps yet`, `%d steps`.

### 4.2 상태 글리프 인벤토리

**[BIN]** 유니코드 바이트 스캔(출현 횟수):

| 글리프 | 횟수 | 문맥 증거 |
|---|---|---|
| `✓` | 14 | `✓ approved`, `Name: ✓`, `✓`(완료 체크) |
| `✗` | 27 | `✗ rejected`, `✗ (%s)` |
| `⚠` | 52 | 경고 마커(`⚠️` 포함) |
| `●` | 4 | `● %s`(상태 점) |
| `○` / `◆` / `x` | 각 수 건 | **작업 파서 정규식** `^([ \t\|/\\-]*)(o\|\*\|@\|○\|◆\|x)(\s+.*)` — 미완료 `○`, 진행 `◆`, 완료 `x`가 파서의 일급 어휘 **[BIN]** |
| `□` | — | `□ new`(미확인 체크박스), `◉□⛁⊠`(상태 아이콘 세트로 보임) |
| `⎿` | — | `⎿  Thinking...`, `⎿ + %s / - %s` — 응답 들여쓰기 + diff 행 프리픽스 |
| `▸` `▾` | 5+ | 접기/펼치기(`▸ repo`, `▾ Thought Process`, `▾ %-*s`) |
| `└` `│` `├` | 101/216 | 트리(`└ %s`, `└─ Source:`) |
| `↑` `↓` | — | `↑ %d more / ↓ %d more`, `↑/↓` 탐색 힌트 |
| `░ ▒ █` | 14/14/73 | 스크롤바/게이지 블록, `████ ██  ██  ██████ ██ ████`(레터블록 배너 조각) |
| `⌫` `⋮─` `›` | — | 백스페이스 힌트, 말줄임, 인용 |
| `████` 계열 | 4종 | 레터블록 로고 — §4.4 |

### 4.3 상태는 파생값 — `ActivitySnapshot` 재조정 모델

**[BIN]** `cortex/agent_state_component` 심볼이 상태 모델을 말해준다:

```
agent_state_component.NewAgentState          ← 상태 컴포넌트 생성
agent_state_component.newPubSub              ← pub/sub 갱신
agent_state_component.ActivitySnapshot       ← 스냅샷 타입
  .IsFullyIdle / .DependentsFullyIdle / .SubagentsAndTasksIdle / .Merge
agent_state_component.reconcileStatus        ← 상태 재조정(파생)
agent_state_component.mergedUpdate / applyIndexedUpdate / buildFullTrajectoryUpdate
agent_state_component.computePageDiff / seedWaitingStepIndices
```

즉 UI의 "지금 뭐 하는 중" 표시는 원시 이벤트가 아니라 **스냅샷 병합 → 상태 재조정(reconcile)** 으로 계산되는 파생값이며, 서브에이전트·의존 작업까지 포함한 정의에 따라 `Idle`이 결정된다(`SubagentsAndTasksIdle`). 상태 표시가 컴포넌트마다 제멋대로 되기 어려운 구조다.

### 4.4 배너·로고

**[BIN]** `cli/render/` 심볼: `render.agyBanner`, **`render.jetskiBanner`**(구 코드명 배너가 공존 — 리브랜딩 흔적), `render.renderLetterBlock`, `render.BannerWithInfo`, `render.renderBanner`, `render.shouldHideLogo`, 그리고 별도 패키지 `cli/logo/{logo,agy}.go`. §4.2의 `████` 조각들과 changelog의 "startup banner displays the active Google Cloud Project ID beneath the signed-in account and plan tier" **[RUN]** 이 합쳐지면: 로고는 **레터블록 렌더러가 문자열에서 생성**하고, 로고 아래 정보 행(BannerWithInfo)이 붙으며, 좁은 터미널 등에서는 `shouldHideLogo`로 숨긴다.

### 4.5 대화상자·권한 어휘

**[BIN]** 권한 확인 응답지가 스코프별로 규칙적이다:

```
Yes, and always allow (tool|access to|permission for|…) / Yes, grant permission for …
No, and always deny (tool|access to|permission for|commands that start with …) / No, deny / No, reject / No, cancel / No, exit
"always proceeds" | "agent decides" | "asks for review"   ← 아티팩트 리뷰 자동화 3단 설정
```

기타 일관 어휘: `[Auth Needed]`, `[Auth Error] %s`, `Quota available/exhausted`, `AI Credits: %d`, `MODEL CREDITS`, `AGY_ERROR: {"short_error":%q}` / `AGY_ERROR: ` 접두, `[...repeated from below...]`(컴팩션 표시), `? for shortcuts`, `Press esc to interrupt generation.`

---

## 5. 레이아웃·컴포넌트 구조 — 369개 파일로 본 아키텍처

**[BIN]** pclntab에서 복원한 `third_party/jetski/cli/**` Go 파일 369개(유니크). 계층이 뚜렷하다:

```
cli/types/          토큰·설정 타입 (theme, colorscheme, brand, terminal, verbosity, …)
cli/render/         프레젠테이션 관문 (18+ 파일, §5.1)
cli/layout/         측정·크롬 회계 (layout, panel, detail_view, viewport)
cli/viewport/       렌더 전략 (altscreen.go, inline.go)
cli/model/          Bubbletea 모델 = 뷰별 1파일 (약 90 파일)
cli/store/          상태 매니저 = 도메인별 1파일 (약 60 파일)
cli/graphic|mermaid|latex/   리치 콘텐츠 (감지 → 이중 폴백)
cli/editing/        입력 엔진 (vim_engine, vim_text_objects, killring, wordops, …)
cli/keybindings/    키바인딩 시스템 (defaults, hint_types, model_configs, migrations, …)
```

### 5.1 render — 단일 관문

**[BIN]** `cli/render/`: `styles.go`, `header.go`, `hint.go`, `scrollbar.go`, `markdown.go`(+`markdown_extensions.go`), `code.go`, `step_render.go`, `semantic_milestones.go`+`semantic_milestone_rows.go`(단계 마일스톤 행 렌더), `hyperlink.go`, `linkify.go`, `cci_links.go`(파일 링크 placeholder 인코딩), `wrap_ansi.go`, `cut.go`+`TruncateAnsi`+`FlattenToLine`(**ANSI 인지 절단/평탄화**), `StatusMarker`, `active_items.go`, `input_modes.go`, `safe_rendering.go`, `product_name.go`, `recitation.go`.

핵심은 **무엇이 render에 없는가**다: 개별 뷰가 색 상수를 갖지 않고, 절단/랩을 자체 구현하지 않으며, 상태 마커를 자체 정의하지 않는다(모두 render 소속). 바이너리에서 `#hex` 상수 클러스터가 types/render 근처 문자열에만 몰려 있는 것(§3.4)과 정합한다.

### 5.2 layout — 크롬 회계와 표준 힌트

**[BIN]** `cli/layout/` 심볼:

```
layout.NewColumnLayout
layout.Layout{ FrameOverhead, MessageListAvailableLines, PanelAvailableLines }
layout.Column{ ChromeLines, Content, AvailableHeight, renderKeyboardHints, Apply, Render }
layout.WindowLines, layout.Height.Cap
layout.RenderHints, layout.KeyHint, layout.HintNavigate, layout.HintPage, layout.HintSwitchView
layout.DefaultModelHints, layout.DefaultDetailViewHints
```

- 화면 높이는 **크롬(테두리·힌트·여백)을 먼저 회계**하고 남은 줄만 콘텐츠에 준다(`ChromeLines` vs `AvailableHeight`, `FrameOverhead` vs `MessageListAvailableLines/PanelAvailableLines`).
- 푸터 힌트는 `KeyHint` 3종 표준(**탐색/페이징/뷰 전환**)으로만 구성되고, 뷰 종류별 기본 세트(`DefaultModelHints`, `DefaultDetailViewHints`)가 선언돼 있다. 개별 뷰가 힌트 문구를 발명할 여지가 구조적으로 없다.
- 뷰포트는 **인라인/알트스크린 이중 전략**: `viewport.NewInlineStrategy`, `viewport.NewAltScreenStrategy`, `buildScrollbackContent`, `computeSplitPoint` — 같은 콘텐츠가 두 모드에서 같은 어휘로 렌더된다.

### 5.3 model/store 분리와 리치 콘텐츠

- **[BIN]** `cli/model/*.go` 약 90개 = 뷰별 1파일(`conversation_picker{,_cursor,_grouping,_layout,_render}.go`처럼 뷰 하나가 5파일로 쪼개지기도), `cli/store/*.go` 약 60개 = 도메인 매니저(`permission_manager`, `quota_manager`, `statusline_manager`+`statusline_data_builder`+`statusline_runner`, `tips_manager`, `text_drip_manager` 등). Bubbletea(Elm)의 model/update/view와 매니저 계층이 분리돼 있다.
- **[BIN]** `cli/graphic/{detect,graphic,image,kitty}.go` + `cli/mermaid/{parse,mermaid,vector,vector_cluster,vector_route,ascii}.go` + `cli/latex/{latex,vector}.go`: 이미지는 kitty 그래픽 프로토콜, 다이어그램은 벡터 렌더, 수식은 자체 벡터 렌더 — 그리고 전부 ASCII/유니코드 폴백. changelog v1.2.7 **[RUN]**: "inline Kitty graphics rendering for LaTeX math … and Mermaid flowcharts … with Unicode ASCII fallback, Left/Right arrow horizontal panning for wide diagrams, and `m` to cycle between Image, ASCII, and Raw views". **"리치 → 저하 계단"이 컴포넌트 규격의 일부**다.
- **[BIN]** `cli/editing/vim_engine.go`+`vim_text_objects.go`+`killring.go` + `cli/keybindings/{defaults,keybindings_vim,hint_types,model_configs,migrations}.go`: vi 키바인딩이 기본값이면서 전부 설정 파일로 재매핑 가능(`MarshalKeybindings/DecodeKeybindings`, `migrateKeybindingDefaults`). 힌트 표시도 `keybindings/hint_types.go` → `layout.KeyHint`로 흐른다(키바인딩 시스템이 힌트 문구의 단일 출처).

---

## 6. 실행 관찰

### 6.1 `agy --help` **[RUN]**

- Go 표준 `flag` 패키지 서식(`Usage of agy:`), 플래그 28개, 서브커맨드 16개(`agent(s) changelog help install mcp mic-serve models plugin(s) remote-control update`).
- 쇼트 alias 규약: `-c`=`--continue`, `-p`=`--print`, `-i`=`--prompt-interactive` — 도움말 한 줄에 alias를 병기하는 일관 포맷.
- 출력 모드 3종 고정: `--output-format (text|json|stream-json)` + `--input-format (text|stream-json)` — TUI와 스크립트 모드가 같은 플래그 문법을 공유(`cli/printmode/headless_*.go` **[BIN]**).

### 6.2 `agy changelog` / `agy models` **[RUN]**

- changelog: 버전 엔트리 55개, 모두 `·` 불릿의 단일 포맷. UI 변경이 전부 "어느 화면의 무엇을 어떻게" 서술(`artifact viewer`, `/usage` panel progress bar, footer pan hint, startup banner 등) — 화면 어휘가 changelog 어휘와 1:1이다.
- models: `Fetching available models...`(스피너 라인) 후 탭 정렬 2컬럼. 모델 ID가 `gemini-3.8-flash-{high,medium,low}`처럼 **effort 접미사를 ID에 인코딩**하는 일관 명명.

---

## 7. 한계 (바이너리 전용 증거의 경계)

1. **공개 소스 없음** — Antigravity CLI는 비공개이며, 소스 행 수준 검증·버전 확정(lipgloss/bubbletea 정확 패치 버전)이 불가하다. "v2 계열"은 `charm_land/*/v/v2` 경로 **[BIN]** 으로만 확정했다.
2. **문자열 병합 왜곡** — Go 문자열 블롭은 문자열을 붙여 저장하므로, 짧은 UI 문자열의 기능 귀속은 주변 문맥 추정이 포함된다. 예: `◉□⛁⊠`·`StopGoodFineSkip` 클러스터는 아이콘/상태 세트로 보이나 용도 확정 불가. `horizon/dawn/cosmic/forge/infinity/jet` 클러스터는 인접 문자열(`glm-5.2-fp8`)로 볼 때 모델 코드명 추정이며 테마명 가능성은 낮지만 배제하지 못한다.
3. **`go version -m` 의존성 절 부재** — 빌드 시스템 특성상 모듈 버전 목록이 없어, 라이브러리 조합은 심볼 경로로만 복원했다.
4. 실행 관찰은 대화형 TUI 렌더(스피너 애니메이션, 색 적용 결과)를 포함하지 않는다 — 유료 모델 호출 없이 관찰 가능한 표면(--help/changelog/models)으로 한정했다(저장소 원칙 준수).

---

## 8. Loop packages/presentation 적용 제안

세 에이전트 비교 계열(live-pi, live-codex)과 정합하는 형태로:

1. **"토큰 한 곳 + 파생 + 마이그레이션" 채택** (단서 1) — Loop의 presentation 토큰(색/글리프/문구)을 한 모듈에서 선언하고, 라이트/다크나 밀도 변형은 원본 토큰에서 **파생 규칙**으로 만든다. agy의 `CustomThemeSeeds × {light,dark}` + `color_migration.go`는 "팔레트가 진화하면 데이터를 이주시킨다"는 선례를 준다. pi의 required-colors 스키마(live-pi §1.5)와 결합하면 완전 팔레트 강제 + 파생이 모두 가능하다.
2. **렌더 관문을 패키지로 봉인** (단서 2) — ANSI 인지 절단(`TruncateAnsi`), 랩(`wrap_ansi`), 평탄화(`FlattenToLine`), 상태 마커(`StatusMarker`), 힌트(`hint`)를 presentation 내부 단일 관문으로. 컴포넌트 코드에서 원시 이스케이프/색 상수를 못 만지게 하는 것이 agy의 구조적 선택이며, Loop의 "TS 어댑터 얇게" 원칙과도 상통한다(관문은 소수의 깊은 모듈).
3. **레이아웃 예산제 + 힌트 어휘 표준 3종** (단서 3) — `크롬 먼저 회계 → 가용 높이 산출`(`ChromeLines/AvailableHeight` 대응물)과 힌트를 탐색/페이징/뷰전환 3종 표준 어휘로 제한하는 규약은 Loop의 다중 뷰(트리·타임라인·상태)에서 즉시 적용 가능하다.
4. **상태는 소집합 + 재조정** (§4) — Working/Running/Thinking/Pending/Queued/Failed/Idle 수준의 소집합을 결정적으로 정의(Rust 코어 정책)하고, UI는 `reconcileStatus`식 파생 표시만 한다. agy가 서브에이전트 idle까지 상태 정의에 넣은 점은 Loop의 다중 워커 UI와 직접 대응된다.
5. **저하 계단을 규격으로** (§2.5, §5.3) — kitty 그래픽→ASCII, 알트/인라인, OSC 감지 기반 라이트/다크처럼 "최고 수식 ↔ 최저 폴백"의 쌍을 컴포넌트 규격에 명시하면, 터미널마다 다르게 보이는 문제(UI 일관성 감사의 P3 계열)가 개별 버그가 아니라 데이터 문제가 된다.

---

## 부록 A. 증거 추출 요약

| 방법 | 산출물(/tmp/agy-research/) | 비고 |
|---|---|---|
| `go version -m` | (출력 1줄) | 툴체인 식별만, 의존성 절 부재 |
| `strings -n 6` 전량 덤프 | `all-strings.txt` | google3 경로·UI 문자열 원문 |
| Python 바이트 스캔 | `scan*.py` | 유니코드 글리프는 UTF-8 바이트로 직접 카운트(문자열 단위 grep은 블롭 병합으로 실패) |
| proto 디스크립터 파싱 | (scan 출력) | `ThemeMode`, `ThemePreference`, `CustomThemeSeeds`, `ConversationWidth` 원문 확인 |
| `agy --help` / `changelog` / `models` | `changelog.txt`(55 버전) | [RUN] 관찰, 유료 호출 없음 |

대표 재현 명령:

```bash
go version -m .research-sources/agy
strings -n 6 .research-sources/agy > /tmp/agy-research/all-strings.txt
grep -c 'google3/third_party/golang/charm_land' /tmp/agy-research/all-strings.txt   # 1282
agy changelog | head -5        # v1.2.9 … "Antigravity CLI"
```
