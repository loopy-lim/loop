# Live Codex 조사 — TUI/스타일링 내부 구현

> 조사 대상: 실제 설치된 `@openai/codex@0.155.1` (`.research-sources/codex`)
> 방법: npm 래퍼 소스 + 내장 Rust 바이너리 strings/rg 추출 → 공개 저장소
> `openai/codex` `codex-rs/tui` 모듈로 교차 검증 (tag `rust-v0.155.1` + `main`)
> 증거 표기: **[BIN]** = 바이너리 문자열, **[SRC-0155]** = 0.155.1 태그 소스, **[SRC-main]** = main 브랜치 소스
> 일자: 2026-02-19 (설치본 2025-09-21 빌드 기준, `main`은 그 이후 진화 포함)

---

## 1. 설치 구조: npm 래퍼 → Rust 바이너리

Codex CLI는 **UI가 전부 Rust에 있다**. npm 패키지는 플랫폼 바이너리 선택 런처일 뿐이다.

```
@openai/codex (package.json, v0.155.1)
├── bin/codex.js                # 유일한 JS: 플랫폼 판별 → 자식 프로세스 spawn
└── node_modules/@openai/codex-darwin-arm64/
    └── vendor/aarch64-apple-darwin/bin/codex   # Mach-O arm64, 228,803,200 bytes
```

증거:

- **[BIN]** `package.json` — `optionalDependencies`에 6개 플랫폼 패키지
  (`@openai/codex-linux-x64` … `@openai/codex-win32-arm64`), `files`는 `bin/codex.js` 하나.
- **[SRC]** `bin/codex.js` — `PLATFORM_PACKAGE_BY_TARGET` 매핑 후
  `spawn(binaryPath, …, { stdio: "inherit" })`. SIGINT/SIGTERM/SIGHUP을 자식에게 전달.
  UI 코드는 0바트 — JS는 신호 전달/종료코드 미러링만 담당.
- **[BIN]** 바이너리 내 패닉 경로에 `tui/src/…` 소스 경로가 그대로 남아 모듈 지도 복원 가능
  (아래 §2). 예: `tui/src/render/highlight.rs:108 codex_tui::render::highlight` +
  `"set_theme_override called more than once; OnceLock values unchanged"`.

Loop 시사점: "TUI를 Rust에 두고 JS는 런처"라는 구조는 loop-bridge(바이너리)와
packages/presentation(TS) 경계 논의의 대조군이 된다. Codex는 프레젠테이션 정책을
네이티브 계층에 몰고, 어댑터는 얇게 유지한다 — AGENTS.md의 "Rust에 결정론적 정책,
TS 어댑터는 얇게" 원칙과 같은 방향.

## 2. TUI 모듈 지도 (바이너리 패닉 경로에서 복원, [BIN])

**[BIN]** `tui/src/*.rs` 경로 190개 이상 추출. 스타일링/레이아웃 관련 핵심만:

```
tui/src/
├── style.rs                  # 시맨틱 스타일 함수군 (§3)
├── color.rs                  # 색 수학: is_light / blend / perceptual_distance(CIE76)
├── terminal_palette.rs       # 터미널 색 역량·기본 fg/bg 감지, best_color 양자화
├── render/
│   ├── highlight.rs          # 구문 강조 테마 전역 상태 (§4)
│   └── renderable.rs         # 렌더러 불변 단위
├── terminal_probe.rs         # OSC 10/11 fg/bg 질의 (§3.1)
├── diff_render.rs            # DiffLineType + 배경 해석 (§4.3)
├── markdown_render.rs        # 마크다운 → 스타일 라인
├── chatwidget/               # 대본(transcript) 위젯: status_surfaces.rs,
│   ├── rendering.rs          #   streaming.rs, tokens/chart.rs, status_controls.rs …
├── bottom_pane/              # 입력/팝업 계층: chat_composer.rs, textarea/(vim 포함),
│   ├── popup_consts.rs       #   theme_picker용 리스트 뷰, key_hint, tooltips …
├── status/card.rs            # /status 카드 레이아웃
├── theme_picker.rs           # /theme 다이얼로그 (§4.2)
├── ascii_animation.rs        # 프레임 애니메이션 공용
└── pets/                     # terminal pet (asset_pack, sixel, image_protocol)
```

모듈 경계: **"입력(bottom_pane) / 대본(chatwidget+insert_history) / 스타일 공급
(style·color·terminal_palette·render) / 프로브(terminal_probe)"** 가 분리되어 있고,
색을 쓰는 모든 위젯은 `crate::style::*` 함수 또는 `render::highlight` 테마만 호출한다.
색 결정 로직이 위젯 코드에 흩어지지 않는다(패닉 경로상 위젯 파일에 색 리터럴 흔적 없음).

## 3. 색·스타일 아키텍처: "팔레트가 아니라 도출"

### 3.1 터미널 실측 → 전역 기본색

- **[SRC-main]** `terminal_probe.rs:247-255` — 기동 시 공유 데드라인 안에서
  `\x1B]10;?\x1B\\` (기본 fg) + `\x1B]11;?\x1B\\` (기본 bg) 를 질의해 파싱.
  fg/bg는 쌍으로만 유효하다고 문서화.
- **[SRC-0155/main]** `style.rs` — 모든 시맨틱 스타일 함수는 `default_bg()`,
  `default_fg()`, `effective_stdout_color_level()`에서 출발. **dark/light 테마
  팔레트 파일이 없다.** 사용자 터미널의 실제 배경을 읽어 색을 계산한다.

### 3.2 시맨틱 스타일 함수군 (style.rs, [SRC-0155]+[SRC-main] 일치)

```rust
pub(crate) enum StatusTone { Success, Attention, Failure }

/// Semantic status colors that preserve the terminal's configured palette.
fn status_style_for(tone, terminal_bg, color_level) -> Style {
    // Unknown → Color::Reset (무색), Success → Green, Failure → Red,
    // Attention → Yellow. 단 light 배경이면 Yellow 대신 Reset
    // ("Yellow can disappear on light themes")
}
```

| 역할 | 함수 (main 기준) | 정책 |
|---|---|---|
| 상태 | `status_style(StatusTone)` | ANSI 기본 16색(Green/Red/Yellow)만 사용 — **사용자 터미널 팔레트 보존** |
| 강조 | `accent_style` / `accent_color_on(bg)` | 배경 명도에 따라 색 선택 + contrast 보정 (§4.3) |
| 보조 텍스트 | `secondary_text_style` | fg를 bg에 alpha 0.6로 블렌드 — "measured foreground instead of terminal-dependent dimming" |
| 사용자 메시지 면 | `user_message_style_for` | dark: 흰색 alpha 0.12, light: 검정 alpha 0.04 블렌드 fill |
| 선택/하이라이트 | `selection_style` | `style/contrast.rs`에서 배경별 산출 |
| 표 구분선 | `table_separator_style` | fg/bg alpha 0.20 블렌드, Ansi16 이하는 `dim()` 폴백 |
| 경고 | `warning_notice_style` | "Muted amber … without looking like an error" (light/dark 각각 다른 RGB) |
| 가독성 | `readable_color_on(preferred, bg)` | RGB만 contrast 보정, ANSI 기본색은 그대로 통과 |

- **[SRC-main]** `color.rs` — `is_light` (luma Y=0.299R+0.587G+0.114B > 128),
  `blend`, `perceptual_distance` (sRGB→XYZ→Lab, CIE76).
- **[SRC-main]** `terminal_palette.rs` — `StdoutColorLevel { TrueColor, Ansi256, Ansi16,
  Unknown }`, `best_color()`가 목표색을 터미널이 표시 가능한 가장 가까운 색으로 양자화.
  Windows Terminal 특례(`WT_SESSION`, Ansi16→TrueColor 승격) 포함.
- **[SRC-main]** `style/contrast.rs` — 명도별 foreground/selection 보정 전담 서브모듈.

설계 요지: **"무엇을 강조할지(역할)"는 함수명으로 고정하고, "어떤 RGB를 쓸지"는
터미널 실측값의 함수로 런타임 계산.** 테마 파일 분기(dark/light 2벌 유지보수)가
원천적으로 없다.

## 4. 테마 시스템: 구문 강조 테마 = UI accent의 단일 진실 공급원

### 4.1 전역 상태와 캐시 무효화 ([SRC-0155] `render/highlight.rs` 57-61, [SRC-main] 동일 구조)

```rust
static SYNTAX_SET:     OnceLock<SyntaxSet>          // 문법 DB, 불변
static THEME:          OnceLock<RwLock<Theme>>      // 활성 테마, 런타임 교체 가능
static THEME_REVISION: AtomicU64                    // 테마 교체 시 렌더 캐시 무효화
static THEME_OVERRIDE: OnceLock<Option<String>>     // 사용자 설정, write-once
static CODEX_HOME:     OnceLock<Option<PathBuf>>    // 커스텀 .tmTheme 탐색 루트
```

- **[BIN]** `highlight.rs:108` 패닉/디버그 문자열
  `"set_theme_override called more than once; OnceLock values unchanged"` —
  override는 기동 시 1회만 설정됨을 타입·런타임 이중으로 강제. [SRC-0155] 106행 대응 확인.
- **[SRC]** `parse_theme_name` — kebab-case 이름 32종을 syntect `EmbeddedThemeName`에
  매핑. **[BIN]** 64,160행 근처에 동일 목록 존재 확인:
  `base16 … catppuccin-frappe … catppuccin-mocha … dracula … gruvbox-dark …
  nord … one-half-dark … solarized-dark … sublime-snazzy … two-dark … zenburn`.
- **[SRC]** `adaptive_default_theme_selection()` —
  배경이 light → `catppuccin-latte`, 아니면 → `catppuccin-mocha`.
  **기본 테마조차 터미널 실측 배경에서 자동 선택.**
- **[SRC]** 커스텀 테마: `{CODEX_HOME}/themes/{name}.tmTheme` (plist XML).
  실패 시 "Theme \"{name}\" not found. Using the default theme. …" 경고 문자열 [SRC].

### 4.2 `/theme` 피커 UX 메커니즘 ([SRC-main] `theme_picker.rs` 모듈 문서)

1. **Live preview** — 커서 이동마다 런타임 테마 교체(프리뷰 패널 + 보이는 코드 블록 즉시 반영)
2. **Cancel-restore** — Esc/Ctrl+C 시 피커를 연 시점의 테마 스냅샷 복원
3. **Persist on confirm** — `AppEvent::SyntaxThemeSelected` → `[tui] theme = "…"`를
   config.toml에 기록 (`ConfigEditsBuilder`)

프리뷰 렌더러 2종(`ThemePreviewWideRenderable`/`Narrow`)이 단말 폭에 따라
측면 패널(≥44컬럼) 또는 아래 스택(4줄)으로 반응형 전환.
**[BIN]** 슬래시 커맨드 문구: `"choose a syntax highlighting theme"`,
설정 설명 문자열 `themesSelect/…` 존재.

### 4.3 accent와 diff 색도 테마에서 파생

- **[SRC-main]** `style.rs::accent_style()` —
  `highlight::foreground_style_for_scopes(&["codex.accent"])` 로 활성 tmTheme에서
  accent fg를 **조회**한 뒤 `best_color` 양자화. 없으면 배경 명도 기반 폴백.
- **[SRC-main]** `assets/themes/ada.tmTheme` — `codex.accent` 스코프 = `#5FAFFF`.
  style.rs 테스트의 `rgb_color((95, 175, 255))`와 정확히 일치(교차 검증 성립).
  동일 파일에 `markup.inserted`(#00AF00/bg #213A2B), `markup.deleted`(#FF5F5F/bg #4A221D) 정의.
- **[SRC-main]** `diff_render.rs:206` — "Queries the active syntax theme for
  `markup.inserted` / `markup.deleted` (or fallback)" → `ResolvedDiffBackgrounds`.
  diff 배경색도 **활성 구문 테마의 스코프에서 나온다.**
- **[SRC-main]** `render/model_themes.rs` — codex 브랜드 테마 6종을 `include_str!` 임베드:
  `ada / babbage / curie / cushman / dali / davinci` (OpenAI 과학자 이름).

버전 주의(한계): **[BIN 0.155.1]** 에서 `babbage`, `codex.accent`, `#5FAFFF` 미검출 —
브랜드 테마·accent 스코프 메커니즘은 0.155.1 이후 main에 추가된 것이다. 0.155.1의 accent는
**[SRC-0155]** `LIGHT_BG_ACCENT_RGB = (0, 95, 135)`, dark 배경에서 `Color::Cyan`+bold,
light에서 `(0,95,135)` 양자화 — 즉 "하드코딩 2값 폴백" 단계였고, main에서
"테마 스코프 조회 + 폴백"으로 진화했다. **[BIN]** 에 `catppuccin-latte/-mocha`,
`solarized-dark` 등 kebab 이름과 `two_face`(syntect 테마 크레이트) 문자열이 1회씩
검출되어 0.155.1의 임베디드 테마 구조 자체는 확인된다.

## 5. 상태 표현: 글리프·스피너·status_line

### 5.1 스피너 ([SRC-main] `chatwidget/status_surfaces.rs:31-36` ≡ [BIN])

```rust
pub(super) const TERMINAL_TITLE_SPINNER_FRAMES: [&str; 10] =
    ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
pub(super) const TERMINAL_TITLE_SPINNER_INTERVAL: Duration = Duration::from_millis(100);
```

- **[BIN]** 10프레임 braille 시퀀스가 연속 문자열로 검출되며, 인접 문맥이
  `event tui/src/chatwidget/status_surfaces.rs:684` — 모듈 소속 일치.
- 프레임 진행은 `[tui] animations` 설정 게이트 ([SRC-main] 1015행:
  `self.local_settings.tui.animations`), 터미널 타이틀/상태 표시에 재사용.

### 5.2 글리프 세트 ([BIN] rg --fixed-strings 검출)

| 글리프 | 용도 (문맥 증거) |
|---|---|
| `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏` | 진행 스피너 (10프레임, 100ms) |
| `✓` (8) | 완료: `"✓ Signed in with your ChatGPT account"`, `"✓ Amazon Bedrock configured"` |
| `⚠` (9), `✗`, `↑`, `○`, `✕` | 주의/오류/화살표 상태 마커 (`↑⚠✗○` 연속 검출) |
| `•` (24) | 불릿/`"• Updated Plan"` 접두 |
| `└` (30) | 트리/계층 (`"runs[!] [-] ✓ 🔒"` 문맥) |
| `╭ ╮ ╰ ╯` (8/7) | **둥근 모서리 박스** — onboarding/API key 입력 프레임 (`╭╮╰╯ to go back`) |
| `─` (34) `│` (15) | 박스 테두리 |
| `·` | 힌트 구분자 (`"select · back"`, [SRC-main] popup_consts `" · ".dim()`) |
| `⌥` | mac 전용 Alt 라벨, 비-mac `"alt"` ([SRC-main] key_hint.rs) |

### 5.3 status_line 구성 항목 ([BIN] 구조체 필드 문자열)

`SpinnerStatusThreadNameThreadGitBranchContextUsedFiveHourLimitWeeklyLimit
CodexVersionUsedTokensTotalOutputTokensThreadCreditsEstimatedThreadCost
SessionIdModelWithReasoningReasoningTaskProgressProposedPlanStreamCell…`

→ **[BIN]** config 키 `status_line`, `status_line_use_colors`, `terminal_title`,
`animations`, `whimsy`, `show_tooltips`, `theme` 모두 검출. 사용자가 상태 줄 항목을
선별하는 구조이며, 각 항목 렌더러는 `chatwidget/status_surfaces.rs`·`status/card.rs`에
집중된다. 슬래시 커맨드 문구 **[BIN]**: `"configure which items appear in the status line"`.

## 6. 레이아웃 일관성: 상수·문구·힌트의 중앙화

### 6.1 popup_consts.rs — "uniform feel" 선언 ([SRC-main] 전문 확인)

```rust
/// Maximum number of rows any popup should attempt to display.
/// Keep this consistent across all popups for a uniform feel.
pub(crate) const MAX_POPUP_ROWS: usize = 8;

pub(crate) fn standard_popup_hint_line() -> Line<'static> {
    // "Press <Enter> to confirm or <Esc> to go back"
}
pub(crate) fn picker_hint_line_for_keymap(list_keymap: &ListKeymap) -> Line<'static> {
    // [Accept "select"] · [Cancel "back"]  — 구분자 " · ".dim()
}
```

- **[BIN]** `" to go back"` 2회, `" to select"` 15회, `" to confirm"` 12회,
  `" to toggle"` 4회, `" to dismiss"` 2회 — 문구가 한곳에서 생성되어 전 팝업이
  동일 힌트 문법을 공유함을 수치로 뒷받침.

### 6.2 key_hint.rs — 키 표기의 유일 원천 ([SRC-main] 모듈 문서)

"Rendering helpers emphasize each complete shortcut uniformly, including its
separators." — 리스트/피커는 `KeyEvent`를 직접 비교하지 않고 이 모듈의 매처를 쓰고,
C0 제어문자·Shift 보고 차이 등 터미널 간 불일치를 매처가 소유한다.

### 6.3 3영역 화면 구조 ([BIN] 모듈 지도 기반)

`insert_history`(불변 대본) + `chatwidget`(현재 턴 렌더) + `bottom_pane`
(컴포저 textarea + 팝업 오버레이 `pager_overlay.rs`) — 각 영역 렌더러가 파일로
분리되어 있고, 폭 의존 레이아웃은 `side_by_side_layout_widths`, `popup_content_width`
([SRC-main] theme_picker.rs import) 같은 공용 함수로 계산한다.
`resize_reflow.rs`(config 키 `terminal_resize_reflow_max_rows`)이 재배치를 담당.

### 6.4 툴팁/문구 자산 ([BIN]+[SRC-main])

`assets/tooltips.txt` + `tui/src/tooltips.rs` — 사용자 안내 문구를 코드 리터럴이
아닌 자산 파일로 분리. **[BIN]** 에 `themeConfigure`, `whimsy`(장식 토글) 등
문구 그룹 흔적.

## 7. 0.155.1 → main 진화 요약 (교차 검증 결과)

| 항목 | 0.155.1 (설치본) | main |
|---|---|---|
| accent | dark=`Color::Cyan`, light=RGB(0,95,135) 하드코드 | tmTheme `codex.accent` 스코프 조회 + 폴백 |
| 임베디드 브랜드 테마 | 없음 (syntect 32종만) | ada/babbage/curie/cushman/dali/davinci 6종 추가 |
| style API | `footer_hint_key_style` 등 7함수 | `readable_color_on`, `secondary_text_style`, `warning_notice_style`, `selection_style` 등 확장 |
| 공통 축 | OSC 10/11 실측 → derive, OnceLock 테마 상태, adaptive 기본 테마 | 동일 (변하지 않는 뼈대) |

## 8. 결론: codex의 디자인 일관성 메커니즘 3개

1. **실측 기반 파생(derived) 스타일 — 테마 분기의 제거**
   기동 시 OSC 10/11로 터미널의 실제 fg/bg를 질의(`terminal_probe.rs`)하고,
   모든 시맨틱 스타일(`status/accent/secondary/user_message/table_separator`)은
   `default_bg()`·`default_fg()`·`StdoutColorLevel`의 순수 함수로 런타임 계산한다
   (`is_light`/`blend`/`contrast`/`best_color`).
   dark/light 2벌 팔레트를 유지하는 대신, 역할(StatusTone 등)만 타입으로 고정한다.
   상태색은 ANSI 16색만 써서 사용자 터미널 팔레트를 보존하고, 표현력이 있는 터미널에서만
   블렌드 RGB로 정교화한다. → Loop presentation에 "색 상수 테이블" 대신
   "역할 함수 + 배경 파생" 모델을 그대로 이식 가능.

2. **단일 테마 원천(single source of truth) — 구문 테마가 UI accent·diff까지 지배**
   syntect tmTheme 한 벌(`THEME: OnceLock<RwLock<_>>` + `THEME_REVISION: AtomicU64`
   캐시 무효화)이 (a) 코드 하이라이팅, (b) `codex.accent` 스코프를 통한 UI 강조색,
   (c) `markup.inserted/deleted` 스코프를 통한 diff 배경색의 유일한 공급원이다.
   `/theme` 피커는 live preview → cancel-restore → config.toml persist의 3단
   계약으로 사용자 변경을 안전하게 반영하고, 기본값은 터미널 명도로 자동 선택
   (catppuccin-latte/mocha). → Loop에서 "테마 파일 1개 = 코드+UI+diff"로 묶는
   구조, 그리고 테마 교체 시 캐시 리비전 번호로 렌더 캐시를 무효화하는 패턴은
   presentation의 테마 상태 관리에 직접 적용 가능.

3. **공용 상수·문구·글리프 모듈에 의한 레이아웃 문법 표준화**
   팝업 최대 행수(`MAX_POPUP_ROWS=8`, "uniform feel" 주석), 표준 힌트 문장
   ("Press <Enter> to confirm or <Esc> to go back"), 키 힌트 렌더러(key_hint.rs,
   구분자 포함 균일 강조), 스피너 프레임 상수(10-braille/100ms), 그리고
   `status_line` 항목 선별형 config까지 — 화면 문법(문구·키 표기·글리프·밀도)을
   위젯이 아니라 공용 모듈이 소유한다. 바이너리 문자열만으로도 `" to select"` 15회
   등 동일 문법의 반복이 확인된다. → Loop의 packages/presentation에는 컴포넌트별
   하드코딩 대신 "프레이즈/글리프/상수 토큰 모듈"을 두는 것이 codex식 해법.

## 9. 한계

- 설치본(0.155.1, 2025-09-21)과 main 소스에 시차가 있다. 바이너리에 없는 기능
  (브랜드 테마, `codex.accent`)은 §7처럼 태그 소스로 버전별 구분해 기록했다.
- 바이너리 strings는 심볼 최적화로 함수명이 남지 않는다. 구조체 필드/패닉 메시지/
  설정 키로만 복원했으며, 레이아웃 수치(마진·패딩) 일부는 소스 확인에 의존한다.
- macOS grep이 바이너리에서 UTF-8 멀티바이트를 불안정하게 다뤄 글리프 카운트는
  `rg -a --fixed-strings`로 재검증했다(§5.2 수치).
- 단말 스크린샷 대조(실행 렌더링)는 이 조사 범위 밖이다.
