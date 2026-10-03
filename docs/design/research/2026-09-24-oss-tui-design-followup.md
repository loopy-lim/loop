# OSS 에이전트/TUI 디자인 관행 후속 조사

- **일자:** 2026-09-24 KST
- **종류:** `research` (`survey-oss-tui-design`, attempt 0)
- **조사 대상:** OpenAI Codex CLI, Block Goose, lazygit, btop++ — 기존 조사(`pi`, `opencode`, `gemini-cli`, `aider`, `crush`, `claude-code`)와 겹치지 않는 4개
- **쓰기 범위:** 이 문서만
- **증거 경계:** 각 프로젝트 공식 저장소의 `main` HEAD를 shallow clone하여 확인한 소스만 사용했다. 링크는 조사 시점 커밋에 고정했다. 의존 라이브러리의 동작은 저장소에 vendoring된 소스 또는 해당 프로젝트의 직접 호출부로 확인했다.
- **관찰 단위:** 프로젝트별 4개 관행, 총 **16개 관행** — (a) 시맨틱 색 역할, (b) `NO_COLOR`/비-TTY 가드, (c) 글리프·구분자·빈 상태 어휘의 단일 원천, (d) 터미널 폭 인식 렌더링.

> **결정 ID 주의:** 태스크 설명의 “D-1=herdr 라벨, D-2=폭” 표기는 현재 `docs/design/design.md` §8과 다르다. 이 문서는 승인 대상인 `design.md`를 정본으로 삼아 **D-1=토큰 명명, D-2=herdr 라벨 소유권, D-3=불릿, D-4=색 범위, D-5=폭 정책, D-6=토큰 포맷/다중 테마**로 표기한다.

## 1. 조사 방법과 판정 기준

- 색이 단순 팔레트가 아니라 `success`, `attention`, `active border`, `inactive`처럼 **용도 이름으로 조회**되면 시맨틱 역할로 판정했다.
- `NO_COLOR`와 비-TTY는 별개로 보았다. 색만 끄는 것, 인터랙티브 TUI 시작 자체를 거부하는 것, 파이프에서는 평문으로 전환하는 것을 구분했다.
- 어휘 단일 원천은 “일부 아이콘 파일이 있음”이 아니라 글리프·구분자·빈 상태가 호출점 재정의 없이 한 모듈을 통과하는지를 판정했다. 부분 중앙화는 그대로 “부분”이라고 기록했다.
- 폭 인식은 실제 프레임/뷰 폭을 렌더 입력으로 사용하거나 터미널 크기 변경에 재배치하는 경우만 인정했다. 고정 길이 축약은 제외했다.

## 2. OpenAI Codex CLI

조사 기준 커밋: [`12fd929f`](https://github.com/openai/codex/tree/12fd929f724371104a1dea7c14930b078d6b4a18)

### 2.1 (a) 시맨틱 색 역할 — 폐쇄된 상태 tone + 환경 적응

`style.rs`는 `StatusTone::{Success, Attention, Failure}`를 정의하고 단일 `status_style()`에서 Green/Yellow/Red로 해석한다. 배경이 밝거나 알 수 없으면 노랑 경고를 `Reset`으로 내리는 접근성 폴백도 있다.

> `pub(crate) enum StatusTone { Success, Attention, Failure }`
>
> `/// Semantic status colors that preserve the terminal's configured palette.`

출처: [`codex-rs/tui/src/style.rs`](https://github.com/openai/codex/blob/12fd929f724371104a1dea7c14930b078d6b4a18/codex-rs/tui/src/style.rs#L26-L53). 같은 모듈이 `accent_style`, `secondary_text_style`, `selection_style`, `warning_notice_style`도 소유한다. 다만 온보딩 등 일부 호출점에는 `Color::Cyan/Green` 직접 사용이 남아 있어 완전히 닫힌 토큰 체계는 아니다.

**Loop 매핑:** **P1** — 상태 3역할과 `Reset` 폴백은 R7/R10 및 D-3·D-4의 최소 `success/warning/error` 범위를 지지하지만, 직접 색 사용이 남은 사례는 R11 경계 검사가 필요한 이유다.

### 2.2 (b) `NO_COLOR`/비-TTY — 능력 감지와 TUI 진입 거부를 분리

출력 색 여부는 `supports_color::on(Stream::Stdout).is_some()`로 한 번 판정해 종료 메시지에 전달하고, 커스텀 터미널 렌더러는 `Colored::ansi_color_disabled_memoized()`가 참이면 색 SGR을 쓰지 않는다.

> `let color_enabled = supports_color::on(Stream::Stdout).is_some();`
>
> `let color_enabled = !Colored::ansi_color_disabled_memoized();`

출처: [`codex-rs/tui/src/main.rs`](https://github.com/openai/codex/blob/12fd929f724371104a1dea7c14930b078d6b4a18/codex-rs/tui/src/main.rs#L47-L50), [`custom_terminal.rs`](https://github.com/openai/codex/blob/12fd929f724371104a1dea7c14930b078d6b4a18/codex-rs/tui/src/custom_terminal.rs#L713-L760). 비-TTY에서는 인터랙티브 화면을 억지로 그리지 않고 `stdin/stdout is not a terminal` fatal로 종료한다. `TERM=dumb`이면서 확인용 TTY도 없으면 시작 전 거부한다([`codex-rs/cli/src/main.rs`](https://github.com/openai/codex/blob/12fd929f724371104a1dea7c14930b078d6b4a18/codex-rs/cli/src/main.rs#L2398-L2425)).

**Loop 매핑:** **P1** — R8(색 억제)과 R9(제어 시퀀스 억제)를 별도 정책으로 두고, 환경 판정 결과를 렌더러에 주입하는 구조를 지지한다.

### 2.3 (c) 글리프·구분자·빈 상태 — 단일 원천 아님

Codex는 스타일은 중앙화했지만 표현 어휘는 완전 중앙화하지 않았다. 표 구분자 `TABLE_BODY_SEPARATOR_CHAR = '─'`는 markdown 모듈 상수인 반면 계획 상태 글리프 `✔`/`□`는 `history_cell/plans.rs`의 두 렌더 경로에서 반복되고, 상태/빈 상태 문구도 각 컴포넌트가 소유한다([`markdown_render.rs`](https://github.com/openai/codex/blob/12fd929f724371104a1dea7c14930b078d6b4a18/codex-rs/tui/src/markdown_render.rs#L106-L109), [`history_cell/plans.rs`](https://github.com/openai/codex/blob/12fd929f724371104a1dea7c14930b078d6b4a18/codex-rs/tui/src/history_cell/plans.rs#L243-L252)). 즉 **색 역할 SSOT와 표현 어휘 SSOT는 독립 문제**다.

**Loop 매핑:** **P2** — 색 토큰만 도입해도 글리프·구분자 중복은 사라지지 않으므로 R1/R12의 별도 vocabulary 모듈이 필요하다.

### 2.4 (d) 폭 인식 — 영역 폭 주입 + wide/narrow 구성 전환

테마 피커는 문서 주석부터 두 렌더러를 명시한다.

> `Two preview renderables adapt to terminal width`
>
> `ThemePreviewWideRenderable` / `ThemePreviewNarrowRenderable`

side panel이 44열 이상이고 list가 40열 이상일 때 나란히 배치하고, 아니면 4줄 preview를 아래에 쌓는다. 실제 렌더는 Ratatui `Rect.width`에서 inset을 빼 `render_width`를 계산해 diff wrapping 함수에 전달한다([`theme_picker.rs`](https://github.com/openai/codex/blob/12fd929f724371104a1dea7c14930b078d6b4a18/codex-rs/tui/src/theme_picker.rs#L1-L18), [폭 계산·렌더](https://github.com/openai/codex/blob/12fd929f724371104a1dea7c14930b078d6b4a18/codex-rs/tui/src/theme_picker.rs#L149-L230)). 공용 축약기는 grapheme 단위 display width를 세고 overflow에 `…`를 붙인다([`line_truncation.rs`](https://github.com/openai/codex/blob/12fd929f724371104a1dea7c14930b078d6b4a18/codex-rs/tui/src/line_truncation.rs#L1-L95)).

**Loop 매핑:** **P4** — 폭을 전역에서 읽지 않고 렌더 영역/명시적 인자로 전달하는 방식은 presentation 포맷터 경계를 깊게 하고 `main.ts`의 환경 의존을 줄인다.

## 3. Block Goose CLI

조사 기준 커밋: [`80c11975`](https://github.com/block/goose/tree/80c1197583cc9dc909b7e010c78b4ad58c81e8ce)

### 3.1 (a) 시맨틱 색 역할 — 최소 함수층, 테마는 별도 축

`output.rs`는 `accent`, `success`, `warning`, `danger` 네 함수를 cyan/green/yellow/red에 매핑한다.

> `fn success<T: Display>(value: T) -> StyledObject<T> { style(value).green() }`

출처: [`crates/goose-cli/src/session/output.rs`](https://github.com/block/goose/blob/80c1197583cc9dc909b7e010c78b4ad58c81e8ce/crates/goose-cli/src/session/output.rs#L34-L49). 한편 `Theme::{Light, Dark, Ansi}`는 Markdown syntax theme 선택이며 상태 역할과 분리된다([같은 파일](https://github.com/block/goose/blob/80c1197583cc9dc909b7e010c78b4ad58c81e8ce/crates/goose-cli/src/session/output.rs#L51-L91)). 그러나 파일 안에 `.cyan()`, `.green()`, `.yellow()` 직접 호출도 많아 역할 접근이 타입으로 강제되지는 않는다.

**Loop 매핑:** **P1** — 네 개 함수만으로도 최소 역할층은 가능하지만, R7의 폐쇄 유니언과 R11 없이는 raw 색 호출이 다시 퍼진다는 대조 근거다.

### 3.2 (b) `NO_COLOR`/비-TTY — Markdown만 평문 경로로 명시적 전환

`env_no_color()`는 환경변수가 **존재하기만 하면** 색을 끄며, `print_markdown()`은 stdout이 TTY일 때만 bat/table 렌더링을 하고 파이프에서는 원문을 그대로 출력한다.

> `// if NO_COLOR is defined at all disable colors`
>
> `if std::io::stdout().is_terminal() { ... } else { print!("{}", content); }`

출처: [`output.rs`](https://github.com/block/goose/blob/80c1197583cc9dc909b7e010c78b4ad58c81e8ce/crates/goose-cli/src/session/output.rs#L1129-L1175). 벨도 stdout TTY가 아니면 방출하지 않는다([`output.rs`](https://github.com/block/goose/blob/80c1197583cc9dc909b7e010c78b4ad58c81e8ce/crates/goose-cli/src/session/output.rs#L126-L137)). 인터랙티브 single-select는 stdin과 stderr가 모두 TTY일 때만 사용한다([`elicitation.rs`](https://github.com/block/goose/blob/80c1197583cc9dc909b7e010c78b4ad58c81e8ce/crates/goose-cli/src/session/elicitation.rs#L48-L62)).

**Loop 매핑:** **P1** — 비-TTY를 단순 “무색 TUI”가 아니라 안정적인 평문 렌더 경로로 취급하는 것은 watch 출력의 clear 제거(R9)에 직접 대응한다.

### 3.3 (c) 글리프·구분자·빈 상태 — 파일 집중은 되었지만 SSOT는 아님

`output.rs` 한 파일에 `✓`, `·`, `▸`, 40자의 `─` 등이 모여 있으나 상수/팩토리가 아니라 호출점 리터럴이다. 예를 들어 extension ready의 `✓`, notification의 `·`, tool header의 `▸`/`─`가 각각 직접 쓰인다([`output.rs`](https://github.com/block/goose/blob/80c1197583cc9dc909b7e010c78b4ad58c81e8ce/crates/goose-cli/src/session/output.rs#L225-L238), [notification](https://github.com/block/goose/blob/80c1197583cc9dc909b7e010c78b4ad58c81e8ce/crates/goose-cli/src/session/output.rs#L350-L362), [tool header](https://github.com/block/goose/blob/80c1197583cc9dc909b7e010c78b4ad58c81e8ce/crates/goose-cli/src/session/output.rs#L1110-L1127)). 어휘 소유 위치는 좁지만 lookup 단일 원천은 아니다.

**Loop 매핑:** **P2** — “한 큰 렌더 파일에 모음”은 단일 원천이 아니며, R1의 이름 있는 상수와 R2 overflow 팩토리가 P2 재발 방지에 더 강하다.

### 3.4 (d) 폭 인식 — 터미널 폭에서 prefix 예산을 차감

JSON 값 렌더는 `Term::stdout().size_checked()`로 현재 폭을 얻고, 이미 출력할 prefix의 display width를 뺀 뒤 문자열을 축약한다.

> `.map(|(_h, w)| (w as usize).saturating_sub(reserve_width));`

출처: [`output.rs`](https://github.com/block/goose/blob/80c1197583cc9dc909b7e010c78b4ad58c81e8ce/crates/goose-cli/src/session/output.rs#L1347-L1367). 다만 `s.len() > w` 선판정은 byte length라 Unicode display width 정책이 완전하지 않고, tool separator는 40자로 고정이다.

**Loop 매핑:** **P4** — “관찰 폭 − prefix 예산”은 D-5의 계산식 후보지만, width 관찰과 Unicode/grapheme 정책은 공용 presentation 함수로 숨겨야 호출점 편차를 막는다.

## 4. lazygit

조사 기준 커밋: [`5fcbdadc`](https://github.com/jesseduffield/lazygit/tree/5fcbdadc67dc6bb8b60d2c095306d9ba21bc62c6)

### 4.1 (a) 시맨틱 색 역할 — 구성 스키마 → 런타임 역할

`ThemeConfig`는 `ActiveBorderColor`, `SearchingActiveBorderColor`, `SelectedLineBgColor`, `CherryPickedCommit*`, `UnstagedChangesColor`, `DefaultFgColor`처럼 용도 중심 필드를 선언한다([`pkg/config/user_config.go`](https://github.com/jesseduffield/lazygit/blob/5fcbdadc67dc6bb8b60d2c095306d9ba21bc62c6/pkg/config/user_config.go#L231-L260)). `theme.UpdateTheme()`가 이 구성값을 런타임 `TextStyle`/gocui attribute로 변환한다([`pkg/theme/theme.go`](https://github.com/jesseduffield/lazygit/blob/5fcbdadc67dc6bb8b60d2c095306d9ba21bc62c6/pkg/theme/theme.go#L8-L90)). 즉 파일 포맷은 일반 YAML config지만 컴포넌트는 의미 역할을 소비한다.

**Loop 매핑:** **P1** — 역할 이름은 제품 상태/표면 용어로 두고 실제 ANSI 값 변환은 한 계층에서 수행해야 한다는 근거다.

### 4.2 (b) `NO_COLOR`/비-TTY — backend가 `NO_COLOR`를 흡수

lazygit이 vendoring한 tcell screen backend는 `NO_COLOR`가 비어 있지 않으면 `truecolor=false`, `ncolor=0`, `noColor=true`를 함께 설정한다.

> `if os.Getenv("NO_COLOR") != "" { ... t.ncolor = 0; t.noColor = true }`

출처: [`vendor/github.com/gdamore/tcell/v3/tscreen.go`](https://github.com/jesseduffield/lazygit/blob/5fcbdadc67dc6bb8b60d2c095306d9ba21bc62c6/vendor/github.com/gdamore/tcell/v3/tscreen.go#L436-L442). 터미널 초기화도 tcell/term backend가 FD terminal 여부를 검사한다([`vendor/.../tty/stdin_unix.go`](https://github.com/jesseduffield/lazygit/blob/5fcbdadc67dc6bb8b60d2c095306d9ba21bc62c6/vendor/github.com/gdamore/tcell/v3/tty/stdin_unix.go#L55-L72)). lazygit은 fullscreen TUI라 비-TTY용 평문 대체 UI는 제공하지 않는다.

**Loop 매핑:** **P1** — 환경 적응을 backend 한 곳에 두는 점은 R8/R9와 같지만, Loop는 파이프가 정상 사용례이므로 lazygit식 시작 실패보다 Goose식 평문 폴백이 적합하다.

### 4.3 (c) 글리프·구분자·빈 상태 — 영역별 부분 SSOT

Nerd Font 아이콘은 `pkg/gui/presentation/icons`가 버전 선택과 전체 아이콘 맵을 소유하고([`icons.go`](https://github.com/jesseduffield/lazygit/blob/5fcbdadc67dc6bb8b60d2c095306d9ba21bc62c6/pkg/gui/presentation/icons/icons.go#L1-L34), [`git_icons.go`](https://github.com/jesseduffield/lazygit/blob/5fcbdadc67dc6bb8b60d2c095306d9ba21bc62c6/pkg/gui/presentation/icons/git_icons.go#L1-L91)), 빈 출력 `<Empty output>`은 i18n catalog의 `EmptyOutput` 하나를 custom command handler가 참조한다([`english.go`](https://github.com/jesseduffield/lazygit/blob/5fcbdadc67dc6bb8b60d2c095306d9ba21bc62c6/pkg/i18n/english.go#L2015-L2023), [`handler_creator.go`](https://github.com/jesseduffield/lazygit/blob/5fcbdadc67dc6bb8b60d2c095306d9ba21bc62c6/pkg/gui/services/custom_commands/handler_creator.go#L327-L336)). 반면 `✓`, `─` 같은 상태/구분자는 presentation/context 여러 파일에 직접 남아 있다. 결론은 **범주별 registry는 유효하지만 전체 표현 어휘 SSOT는 아니다**.

**Loop 매핑:** **P2** — 아이콘·빈 상태를 presentation/catalog에 두는 소유권은 R1을 지지하고, 흩어진 체크/구분자는 R11/R12 같은 강제가 없을 때의 한계를 보여준다.

### 4.4 (d) 폭 인식 — resize 때 레이아웃 재계산, view 폭으로 Unicode wrapping

`layout()`은 “every screen re-render e.g. when the screen is resized” 호출되며 `g.Size()`로 전체 폭/높이를 얻고, view 폭 변경 시 해당 context를 rerender 대상으로 표시한다([`pkg/gui/layout.go`](https://github.com/jesseduffield/lazygit/blob/5fcbdadc67dc6bb8b60d2c095306d9ba21bc62c6/pkg/gui/layout.go#L12-L25), [폭 변경 판정](https://github.com/jesseduffield/lazygit/blob/5fcbdadc67dc6bb8b60d2c095306d9ba21bc62c6/pkg/gui/layout.go#L104-L125)). 공용 `WrapViewLinesToWidth`는 view `InnerWidth()`를 받아 `uniseg.StringWidth`로 폭을 센다([`pkg/utils/lines.go`](https://github.com/jesseduffield/lazygit/blob/5fcbdadc67dc6bb8b60d2c095306d9ba21bc62c6/pkg/utils/lines.go#L106-L189)).

**Loop 매핑:** **P4** — 폭 변경을 “관찰 → 뷰 모델 rerender”로 전달하는 구조는 D-5의 width observer와 presentation 정책을 분리하는 선례다.

## 5. btop++

조사 기준 커밋: [`612e18f5`](https://github.com/aristocratos/btop/tree/612e18f5bd598fe987b30d041b39e5d7b3e0794f)

### 5.1 (a) 시맨틱 색 역할 — 역할 키 맵 + TTY 팔레트

`Default_theme`과 `TTY_theme`은 동일 키 집합(`main_fg`, `title`, `hi_fg`, `selected_bg`, `inactive_fg`, `graph_text`, `cpu_box`, `temp_start/mid/end` 등)을 각각 RGB/ANSI 값에 매핑한다([`src/btop_theme.cpp`](https://github.com/aristocratos/btop/blob/612e18f5bd598fe987b30d041b39e5d7b3e0794f/src/btop_theme.cpp#L42-L146)). 렌더러는 `Theme::c("title")`처럼 역할로 조회한다. `generateColors()`는 빠진 선택 토큰을 `inactive_fg` 또는 cpu gradient에서 보충하고 로그를 남긴다([`btop_theme.cpp`](https://github.com/aristocratos/btop/blob/612e18f5bd598fe987b30d041b39e5d7b3e0794f/src/btop_theme.cpp#L242-L304)).

**Loop 매핑:** **P1** — 동일 역할 키에 normal/TTY 값을 바꾸는 구조는 D-4의 ANSI 16색 시작과 D-6의 향후 다중 테마를 지금의 소비 API 변경 없이 연결할 수 있음을 보인다.

### 5.2 (b) `NO_COLOR`/비-TTY — 비-TTY는 거부, `NO_COLOR`는 미지원

`Term::init()`은 `isatty(STDIN_FILENO)`일 때만 성공하며, 실패하면 다음 메시지로 종료한다.

> `No tty detected!`
>
> `btop++ needs an interactive shell to run.`

출처: [`src/btop_tools.cpp`](https://github.com/aristocratos/btop/blob/612e18f5bd598fe987b30d041b39e5d7b3e0794f/src/btop_tools.cpp#L145-L176), [`src/btop.cpp`](https://github.com/aristocratos/btop/blob/612e18f5bd598fe987b30d041b39e5d7b3e0794f/src/btop.cpp#L1003-L1010). 조사한 소스에는 `NO_COLOR` 처리가 없다. `tty_mode`는 무색 모드가 아니라 16색/호환 글리프 모드다([`btop.cpp`](https://github.com/aristocratos/btop/blob/612e18f5bd598fe987b30d041b39e5d7b3e0794f/src/btop.cpp#L805-L823)).

**Loop 매핑:** **P1** — fullscreen 전용 도구에는 비-TTY 거부가 가능하지만, 평문 CLI인 Loop에는 부적합하다. 또한 “TTY 호환 모드”와 `NO_COLOR`는 같은 정책이 아님을 분명히 한다.

### 5.3 (c) 글리프·구분자·빈 상태 — Symbols namespace가 강한 단일 원천

박스 선, 모서리, divider, 화살표, enter, meter, superscript, braille/block/tty graph 문자는 `Symbols` namespace 한 곳에 모여 있고 렌더러는 이를 조합한다.

> `const string Symbols::h_line = "─";`
>
> `const string Symbols::enter = "↵";`

출처: [`src/btop_draw.cpp`](https://github.com/aristocratos/btop/blob/612e18f5bd598fe987b30d041b39e5d7b3e0794f/src/btop_draw.cpp#L57-L132). 다만 도메인 빈 상태 문구까지 catalog화한 구조는 아니고, btop의 고정 대시보드 특성상 일반 목록형 empty-state가 적다.

**Loop 매핑:** **P2** — 글리프를 렌더 파일의 namespace로 닫고 호환 variant까지 같은 lookup 아래 두는 것은 R1과 D-3의 가장 직접적인 선례다.

### 5.4 (d) 폭 인식 — OS 관찰, 최소 크기 정책, 재배치

`Term::refresh()`는 `ioctl(TIOCGWINSZ)`로 stdout 크기를 읽고 실패 시 `/dev/tty`로 폴백한다([`src/btop_tools.cpp`](https://github.com/aristocratos/btop/blob/612e18f5bd598fe987b30d041b39e5d7b3e0794f/src/btop_tools.cpp#L90-L124)). 현재 box 조합에서 최소 폭/높이를 계산하고, 부족하면 필요한 크기를 표시하며 resize를 기다린다([`src/btop_tools.cpp`](https://github.com/aristocratos/btop/blob/612e18f5bd598fe987b30d041b39e5d7b3e0794f/src/btop_tools.cpp#L126-L145), [`src/btop.cpp`](https://github.com/aristocratos/btop/blob/612e18f5bd598fe987b30d041b39e5d7b3e0794f/src/btop.cpp#L145-L184)). 즉 관찰값과 “이 UI의 최소 요구” 정책을 구분한다.

**Loop 매핑:** **P4** — D-5에서 width observer는 환경 어댑터, `min(configured limit, available content width)`는 presentation/운영 정책으로 분리해야 한다는 근거다.

## 6. 횡단 비교와 Loop 보류 결정에 주는 근거

| 프로젝트 | 색 역할 | `NO_COLOR`/비-TTY | 표현 어휘 SSOT | 폭 인식 |
| --- | --- | --- | --- | --- |
| Codex CLI | `StatusTone` + accent/secondary/selection; 일부 raw 색 잔존 | color capability 중앙 판정; 인터랙티브 TUI 비-TTY 거부 | **아님** — 스타일과 글리프 소유가 분리·중복 | `Rect.width` 주입, wide/narrow 전환, grapheme 축약 |
| Goose | accent/success/warning/danger 함수; 강제는 약함 | `NO_COLOR` 존재 시 off; 비-TTY Markdown 평문 | **아님** — 한 파일 안 호출점 리터럴 | terminal width에서 prefix 차감; Unicode 판정 약점 |
| lazygit | config의 표면/상태 역할 → runtime style | tcell backend가 `NO_COLOR`; 비-TTY TUI 대체 없음 | **부분** — icons/i18n은 중앙, separator/status glyph는 분산 | resize 재레이아웃 + `InnerWidth`/Unicode wrap |
| btop++ | 역할 키 맵 + normal/TTY 값 | 비-TTY 거부; `NO_COLOR` 없음 | **글리프는 강함**, empty-state catalog는 없음 | ioctl observer + 최소 크기 정책 |

### 6.1 D-1 — 토큰·어휘 명명

네 프로젝트 모두 값 이름을 기술색(`green`)보다 용도(`success`, `activeBorder`, `inactive_fg`, `selected_bg`)에 붙인다. **`status.<state>.glyph`, `separator.list`, `empty.<surface>`, `color.role.<role>` 점 경로 제안은 방향이 맞다.** 단, Codex처럼 style과 glyph가 별도 축임을 이름에도 유지해야 한다. `status.done.color`와 `status.done.glyph`를 같은 객체로 강결합하기보다 역할별 lookup을 명시적으로 둘 수 있다.

### 6.2 D-2 — herdr 라벨 소유권

이번 네 프로젝트의 공통점은 범용 어휘/스타일은 presentation/theme 모듈이 소유하지만, **런타임 자원 식별 형식은 해당 표면 가까이** 둔다는 점이다(예: Codex의 theme-picker row, lazygit의 git icon renderer, btop의 box renderer). 따라서 `<taskId>·<kind>·a<attempt>`와 32자 제약이 herdr 탭 하나에서만 소비되는 현재에는 **herdr 유지 + `design.md` 규격화**가 더 단순하다. presentation 이관 트리거는 같은 라벨을 CLI/presentation이 실제 소비하기 시작하거나 separator/축약 정책이 두 구현으로 갈라질 때로 구체화할 수 있다.

### 6.3 D-3·D-4 — 불릿과 1차 색 범위

Codex의 `Success/Attention/Failure`, Goose의 `success/warning/danger`, btop의 TTY 16색 역할 맵은 **성공 `✓` / 경고 `!` / 중립 `-`의 의미 분리**와 **상태색부터 시작**하는 제안을 지지한다. 동시에 Codex는 알려지지 않은/밝은 배경에서 경고색을 `Reset`으로 내린다. 따라서 글리프는 색 없이도 의미를 보존해야 하며, D-4 1차 범위는 task status + 환경 가드가 적절하다.

### 6.4 D-5 — 폭 관찰과 `lineTextLimit` 정책

관행은 세 단계로 수렴한다.

1. **관찰:** Codex `Rect.width`, Goose `Term::size_checked`, lazygit `g.Size()/InnerWidth`, btop `ioctl`.
2. **content 폭 계산:** frame/inset/prefix를 `saturating_sub`로 차감.
3. **렌더 정책:** wrap, ellipsis, layout variant 또는 최소 크기 안내.

Loop에는 `effectiveLineTextLimit = min(configuredLineTextLimit, max(1, observedColumns - surfaceOverhead))`가 가장 보수적이다. 관찰 실패/비-TTY에서는 현재 설정값 160을 유지하되 제어 시퀀스는 끈다. 이 방식은 `policy.toml`의 160을 **상한**으로 재해석하며, 관찰기는 CLI 어댑터, overhead/축약은 presentation이 소유한다. Codex/lazygit처럼 실제 render width를 인자로 넘기면 전역 terminal 조회가 포맷터에 누수되지 않는다.

### 6.5 D-6 — 토큰 포맷과 다중 테마

조사 대상은 서로 다른 포맷을 쓴다.

- Codex: custom `.tmTheme`(syntax theme) + Rust semantic style 함수
- Goose: Rust enum(`Light/Dark/Ansi`) + bat theme 이름
- lazygit: 일반 YAML config의 의미 필드
- btop: 자체 `.theme` key/value + 동일 역할 키의 내장 TTY map

**W3C JSON은 다중 테마의 전제조건이 아니다.** 오히려 네 사례는 소비 API의 역할 키 안정성이 파일 포맷보다 중요함을 보인다. Loop는 지금 typed TS 상수 하나로 시작하고, (a) 사용자 테마, (b) Rust/TS 공동 소비, (c) 두 번째 내장 테마 중 하나가 실제로 생길 때 JSON/codegen을 결정하는 현재 연기안이 타당하다. 다중 테마가 생기면 전체 복제보다 btop처럼 동일 역할 키에 값 맵을 바꾸는 형태가 최소다.

## 7. 트레이드오프와 선택지

### 폭 정책

- **대안 A — 설정값 160 고정:** 결정론적이고 비-TTY와 동일하지만 좁은 터미널에서 wrap이 이중 발생한다.
- **대안 B — 터미널 폭으로 완전 대체:** 즉시 적응하지만 운영 정책 상한이 사라지고 테스트 재현성이 약해진다.
- **권고 — 설정값을 상한으로 사용:** `min(config, observed-overhead)`. 관찰값을 테스트에서 주입할 수 있고 기존 정책도 보존한다.

### herdr 라벨 소유권

- **대안 A — presentation으로 즉시 이관:** separator/축약 SSOT는 강해지지만 herdr-only 개념과 32자 제약이 범용 모듈로 샌다.
- **대안 B — herdr 유지 + 표시 규격 계약:** 현재 경계를 보존하고 실제 두 번째 소비자가 생길 때 이관한다.
- **권고 — B:** 조사 프로젝트도 범용 토큰과 표면별 자원 라벨을 구분한다. 이관 트리거를 계약에 명시한다.

### 테마 저장 포맷

- **대안 A — 지금 W3C JSON/codegen:** 교차 언어 확장에는 유리하나 현재 소비자가 TS 하나라 도구 사슬이 본체보다 커진다.
- **대안 B — typed TS 역할 상수, 필요 시 데이터 포맷 승격:** 현재 가장 단순하고 네 사례의 다양한 포맷과도 모순되지 않는다.
- **권고 — B:** 포맷보다 역할 API 안정성을 먼저 잠근다.

## 결론

Loop에 채택 가치가 가장 높은 관행은 다음 3개다.

1. **환경 관찰과 렌더 정책을 분리하고 폭을 명시적 입력으로 주입한다.** Codex의 `Rect.width`, lazygit의 resize→rerender, btop의 observer→최소 크기 정책이 공통 근거다. D-5는 `min(configured limit, observed content width)`로 구체화하되 observer는 CLI, 축약은 presentation이 소유해야 한다.
2. **색 역할과 표현 어휘를 각각 닫힌 단일 원천으로 만든다.** Codex는 semantic style이 있어도 glyph가 중복되고, lazygit은 icons/i18n만 중앙화되어 separator가 남는다. 이는 Loop R1/R7/R11/R12를 한 묶음으로 해야 P1/P2가 함께 해소됨을 보여준다.
3. **비-TTY는 무색만이 아니라 평문 안전 경로로 취급한다.** Goose가 Markdown/table/벨을 TTY 여부로 분기하는 방식이 Loop의 watch/pipe 사용례에 가장 가깝다. Codex/btop/lazygit의 fullscreen TUI 거부는 대조군이며, Loop는 `NO_COLOR`와 비-TTY clear 억제를 별도 가드로 유지해야 한다.

이에 따라 `design.md`의 현재 제안 — D-2 herdr 유지+규격화, D-3 3역할 불릿, D-4 상태색+가드 최소 범위, D-5 연기하되 관찰/정책 분리, D-6 typed TS 우선 — 은 대체로 유지할 근거가 충분하다. 추가 수정이 필요한 부분은 D-5 후속 결정에 **상한 계산식과 관찰 실패 폴백**을 명문화하는 것이다.

## 부록 A. 1차 자료와 재현 정보

| 프로젝트 | 조사 커밋 | 공식 저장소 |
| --- | --- | --- |
| OpenAI Codex CLI | `12fd929f724371104a1dea7c14930b078d6b4a18` | https://github.com/openai/codex |
| Block Goose | `80c1197583cc9dc909b7e010c78b4ad58c81e8ce` | https://github.com/block/goose |
| lazygit | `5fcbdadc67dc6bb8b60d2c095306d9ba21bc62c6` | https://github.com/jesseduffield/lazygit |
| btop++ | `612e18f5bd598fe987b30d041b39e5d7b3e0794f` | https://github.com/aristocratos/btop |

수집은 각 저장소에 `git clone --depth 1`을 사용했고, 위 커밋의 소스 경로와 인용을 대조했다. 확인되지 않은 CI/리뷰 관행이나 2차 블로그 설명은 근거에 포함하지 않았다.
