# live-agents-design-comparison — 3개 에이전트 실구현 비교 → Loop 적용 결론

- **일자:** 2026-09-24 KST
- **종류:** `research` (compare-live-agents, attempt 0, integration)
- **작업 디렉터리:** `/Users/loopy/dev/ll3/loop` — 코드 변경 없음, 본 문서만 작성
- **입력(전부 읽음):** `docs/design/research/live-pi.md` (pi v0.87.1), `docs/design/research/live-codex.md` (codex 0.155.1 설치본 + main 태그 교차), `docs/design/research/live-agy.md` (agy = Google Antigravity CLI v1.2.9 바이너리), `docs/design/research/loop-ui-audit.md` (감사 P1–P4, worktree `86413fa`), `docs/design/design-foundations.md` (권고 D1–D3), `packages/presentation/**` (현재 상태 대조: `compact.ts` 47줄, `snapshot.ts` 207줄, 토큰/스타일 모듈 부재)

---

## 0. 결과 요약

세 에이전트는 스택(TS/pi, Rust/codex, Go/agy)과 테마 철학(데이터 파일 파레트/실측 파생/시드 파생)이 다르지만, **"원시 색·글리프·문구를 아는 곳은 정확히 한 곳이고, 그 경계를 타입·스키마·모듈 관문으로 봉인한다"** 는 동일한 불변식 위에서 돌아간다. Loop 감사의 P2(어휘 중복)는 이 불변식이 없는 상태이고, P1(색 부재)은 봉인된 어휘가 있어야 안전하게 도입할 수 있는 다음 층이다. 감사 §1.3과 파운데이션 §1.3의 인과 구조(P4→P2→색)가 세 실구현에서 그대로 재확인됐다.

### Loop가 도입해야 할 메커니즘 상위 3개 (증거 출처 포함)

| # | 메커니즘 | 증거 출처 | 해소하는 감사 문제 | 파운데이션 정합 |
| --- | --- | --- | --- | --- |
| **1** | **화면 문법의 공용 모듈 소유** — 상태 글리프·구분자·표준 문구·빈 상태·overflow 문구를 위젷/포맷터가 아니라 한 모듈이 소유. codex는 이를 "uniform feel"이라는 주석으로 명문화 | codex `tui/src/popup_consts.rs`(전문 주석 "Keep this consistent across all popups for a uniform feel", `MAX_POPUP_ROWS=8`, 표준 힌트 문장) + `key_hint.rs`(키 표기 유일 원천, [BIN] `" to select"` 15회·`" to confirm"` 12회 = 문구 재사용의 직접 증거); agy `cli/render/{StatusMarker,hint,scrollbar,styles}.go` 단일 관문 [BIN] + `layout.KeyHint` 3종 표준 힌트(`HintNavigate/HintPage/HintSwitchView`) | P2-1, P2-2, P2-3, P2-6 | D1 확정 |
| **2** | **색 역할 밀봉 + 상태→역할 조회 테이블** — 역할 이름의 폐쇄 집합을 타입으로 봉인하고 알 수 없는 키는 런타임 throw. 상태색은 ANSI 16색으로 시작해 사용자 터미널 팔레트를 보존(측정 기반 파생은 확장점) | pi `theme.d.ts:11-12` `ThemeColor` 49역할 유니언 + `theme.js:244-252` `fg()` 미지 키 throw + `theme-schema.json` 필수 색 강제 + `footer.js:153-163` 컨텍스트 70/90% → `warning`/`error` 역할 등급화; codex `style.rs` `StatusTone{Success,Attention,Failure}` → `status_style_for()`(ANSI 기본색만, light 배경에서는 Yellow→Reset 보정 — "Yellow can disappear on light themes") | P1-1, P1-2, P1-4 | D2 확정 |
| **3** | **어휘/팔레트 완전성의 기계적 강제** — 부분 팔레트·부분 글리프 맵이 구조적으로 불가능하도록 검증을 도구로 소유 | pi `theme-schema.json`(required colors) + `withThemeColorFallbacks`(`theme.js:193-199`) + `resolveVarRefs` 순환 참조 throw(`theme.js:178-191`); codex 컴파일 타임 봉인(위젷 파일에 색 리터럴 흔적 없음 — 바이너리 패닉 경로상 색 결정이 `style.rs`/`terminal_palette.rs`에만 존재 [BIN]); agy 구조적 관문(개별 뷰가 색 상수·절단·상태 마커를 소유하지 않는 `render/` 패키지) | P2 전체의 재발 방지, P4 구조 고정 | D3 확정 |

**보류 권고(트리거 명시):** 차분 렌더링(pi 라인 diff + `\x1b[?2026h` 동기화 출력 + 16ms 스로틀), 크롬 회계 레이아웃(agy `ChromeLines`/`AvailableHeight`), 시드 파생 테마(agy `CustomThemeSeeds` + `color_migration.go`), 측정 기반 색 파생(codex OSC 10/11 + blend/contrast) — §7 참조. 현재 Loop 표면(렌더러 6종+포맷터 4종, 테마 1개, 무색 출력)에서는 비용 대비 이득이 없고, 파운데이션 §4.6의 의도적 생략 원칙과 일치하게 트리거 발생 시 도입한다.

---

## 1. 비교 방법과 증거 신뢰도

본 문서는 코드를 직접 읽지 않고, **각 에이전트를 실제 설치본 대상으로 조사한 1차 문서 3건**(live-pi/live-codex/live-agy)을 통합한다. 인용은 그 문서의 증거 표기를 승계한다.

| 에이전트 | 조사 표면 (`.research-sources/`) | 증거 등급 | 버전 기준 | 주요 한계(워커 결과 승계) |
| --- | --- | --- | --- | --- |
| **pi** | 배포 `dist/*.js` 정독 + `node_modules/@earendil-works/pi-tui` + 공식 문서(`docs/themes.md`, `docs/tui.md`) 교차 검증 | **높음** — 가독 가능한 컴파일 코드 + 문서-코드 대응표까지 작성됨 | v0.87.1 (dist 기준 줄번호) | 소스(`src/`) 비공개 — dist 줄 번호는 버전 고정 필요 |
| **codex** | npm 래퍼 JS + Rust 바이너리 strings/rg + 공개 저장소 `openai/codex` 태그 소스 교차 | **높음** — 바이너리 [BIN]과 소스 [SRC] 이중 검증 | 0.155.1 설치본 (2025-09-21 빌드) + main | 설치본과 main의 시차 존재(§3.1) — 버전별 구분 기록됨. 실행 렌더링 스크린샷 대조는 범위 밖 |
| **agy** | Mach-O 바이너리 strings/심볼/proto 디스크립터 + `--help`/`changelog`/`models` 실행 관찰 | **중간** — 공개 소스 없음, 바이너리 자기 진술(changelog)만이 정체 증명 | v1.2.9 (go1.28) | 대화형 TUI 렌더링(색 적용 결과) 미관찰 — 유료 모델 호출 배제 원칙으로 `--help`/`changelog`/`models` 표면에 한정. 문자열 블롭 병합 왜곡 가능성 명시됨 |

세 에이전트가 스택(TS/Rust/Go)과 배포 형태(npm+dist / npm+Rust 바이너리 / 단일 Go 바이너리)까지 제각각이라는 점이 오히려 비교의 힘이다 — **아래 불변식들은 특정 언어/프레임워크의 우연이 아니라 설계 원칙이다.**

---

## 2. 5축 비교표

| 축 | **pi** (TS + pi-tui) | **codex** (Rust, ratatui 계열 자체 TUI) | **agy** (Go + 밴더링된 Charm v2) |
| --- | --- | --- | --- |
| **테마/색 정의 위치** | 데이터 파일 `dist/modes/interactive/theme/{dark,light}.json` — `vars`(원시 16색)→`colors`(역할) 2단 참조. 소비는 `ThemeColor`/`ThemeBg` 유니언(49+7역할)과 `theme.fg/bg()`만 허용(미지 키 throw). 전역 싱글톤(`Symbol.for` Proxy) + 핫리로드 | **팔레트 파일이 없다.** 기동 시 OSC 10/11로 터미널 실측 fg/bg를 질의(`terminal_probe.rs`)하고 `style.rs`의 시맨틱 함수군(`status/accent/secondary/user_message/table_separator`)이 `default_bg()`·`StdoutColorLevel`의 순수 함수로 런타임 계산. 단일 테마 원천 = syntect tmTheme(`OnceLock<RwLock<Theme>>` + `THEME_REVISION: AtomicU64` 캐시 무효화)이 accent·diff색까지 지배 | 토큰 패키지 `cli/types/{theme,colorscheme,brand}.go` [BIN] — 라이트/다크는 `CustomThemeSeeds × {light,dark}` proto에서 **시드 파생** + `ThemeMode{DARK,LIGHT,INHERIT}` 열거. 팔레트 진화는 `cli/onboarding/color_migration.go`로 이주. 브랜드 4색(`#4285F4…`)은 별도 상수. 렌더 시점 적용은 밴더링 lipgloss v2(`LightDark`) |
| **컴포넌트 프리미티브 경계** | 2층: 범용 `@earendil-works/pi-tui`(Box/Text/VStack/HStack/ScrollView/Editor/SelectList/TruncatedText…)와 앱 컴포넌트(`dist/modes/interactive/components/*`). 계약 `render(width): string[]` + `invalidate()` 캐시. 화면 레이아웃 슬롯이 `chat-viewport.js`(35줄) 한 함수에 선언 | 모듈 분리: `bottom_pane`(입력/팝업) / `chatwidget`(대본) / 스타일 공급(`style`·`color`·`terminal_palette`·`render`) / `terminal_probe`. 색을 쓰는 모든 위젷은 `crate::style::*` 또는 `render::highlight` 테마만 호출 — 위젷 파일에 색 리터럴 흔적 없음 [BIN] | 계층 패키지: `types`(토큰) → `render`(단일 관문: styles/wrap_ansi/cut/`TruncateAnsi`/`FlattenToLine`/`StatusMarker`/hint) → `layout`(측정) → `model`/`store`(뷰·상태 약 90/60파일). 개별 뷰는 ANSI 조립 불가 |
| **상태 표현 방식** | 상태 = 슬롯 내 **컴포넌트 교체** + **역할 색 교체**. 스피너는 `Loader` 프리미티브(색은 `spinnerColorFn` 주입), 인디케이터는 kind별 소유권(`clearStatusIndicator(kind)`). 툴 상태는 배경 역할 3종(`toolPendingBg/Success/Error`), 에디터 테두리는 thinking 7단계 역할 — 상태→색 대응이 **테마 데이터에 선언** | 상태 = `StatusTone` 3종 enum → `status_style_for()` 파생(ANSI Green/Red/Yellow, light 배경 Yellow→Reset). 스피너는 상수(10-프레임 braille/100ms), 글리프·문구는 공용 모듈 소유. `status_line` 항목은 config로 선별 | 상태 = **소집합 어휘**(Working/Running/Thinking/Pending/Queued/Failed/Idle) + `ActivitySnapshot` 병합 → `reconcileStatus` **파생값**(`SubagentsAndTasksIdle` 등 서브에이전트·의존 작업 포함 정의). 글리프 `✓/✗/⚠/○/◆/x`는 파서의 1급 어휘 [BIN] |
| **일관성 강제 수단** | 타입(유니언) + 런타임 throw + JSON Schema(required colors) + 폴백 테이블 + 문서-코드 대응(docs/tui.md ↔ `tui.d.ts`). `Theme.fg`는 fg만 리셋(`\x1b[39m`)해 스타일 상충 구조적 차단 | **컴파일 타임 봉인**(크레이트 프라이빗 함수, enum) + 공용 상수 모듈(`popup_consts.rs` "uniform feel", `key_hint.rs`) + 문구 자산 파일(`assets/tooltips.txt`). 바이너리 문자열 반복 횟수로 문법 공유가 수치 확인됨 | **구조적 관문**(render 패키지) + 표준 힌트 3종(`KeyHint`) + 뷰별 기본 세트(`DefaultModelHints`) + 저하 계단 규격(kitty 그래픽→ASCII, 알트/인라인 이중 전략). 라이브러리는 google3 미러로 밴더링(버전 외부 유입 차단) |
| **강점** | 문서화된 확장 지점(커스텀 테마+핫리로드), 완전 팔레트 보장, 역할 이름만으로 색 창작 불능. 프리미티브는 색 함수 **주입**(Loader), 앱은 전역 역할 팔레트 — 2층 주입 모델 | 테마 분기(dark/light 2벌)가 원천적으로 없음 — 실측 파생으로 "모든 터미널에서 비슷하게". 사용자 팔레트 보존(상태색 ANSI 16). Rust 컴파일 타임 강제. `/theme` 피커의 live preview→cancel-restore→persist 3단 계약 | 파생+마이그레이션으로 팔레트 진화 관리. 크롬 회계(`FrameOverhead`/`ChromeLines`/`AvailableHeight`)로 모든 뷰가 동일 높이 회계. 다중 워커 상태 재조정(reconcile)이 상태 모델의 핵심 |
| **약점** | `interactive-mode.js` 5,751줄 모놀리식 조립(Loop P4-1과 동형). 전역 싱글톤(theme Proxy)은 모듈 로더 간 편의를 위한 것으로, 명시적 주입 원칙과 충돌 가능 | 설치본(0.155.1)과 main의 시차 — accent가 "하드코드 2값 폴백"에서 "테마 스코프 조회"로 진화 중. 실측 파생은 디버깅·재현이 테마 파일 대비 어려움(입력이 사용자 터미널 상태) | 공개 소스 없음 — 재현·검증 불가. 바이너리 문자열 병합으로 짧은 어휘의 귀속 추정 필요. 369개 파일·6계층은 Loop 규모 대비 과잉 |

---

## 3. 축별 분석과 공통 불변식

### 3.1 테마/색 — 같은 문제, 세 가른 답

"어떤 RGB를 쓸 것인가"에 대한 세 답은 정확히 스펙트럼을 이룬다.

| 전략 | 채택자 | 작동 방식 | Loop 적합도 |
| --- | --- | --- | --- |
| **선언된 팔레트(데이터)** | pi | 역할 이름 → hex 매핑을 JSON으로 선언, 역할은 유니언 타입으로 밀봉, 256color 근사는 라이브러리가 흡수 | **높음** — 테마 1개·소비자 소수인 현재 Loop에 최소 비용. D2의 직접 근거 |
| **실측 파생(계산)** | codex | 터미널 fg/bg 실측 → `is_light`/`blend`/`contrast`/`best_color`로 역할색을 런타임 계산. 팔레트 파일 부재 | 중간 — OSC 프로브·색 수학이 필요. 단, **"상태색은 ANSI 16 기본색으로 사용자 팔레트 보존"** 원칙은 지금 채택 가능 |
| **시드 파생 + 마이그레이션** | agy | 시드 샌에서 라이트/다크 팔레트 파생, 파생 규칙 변경 시 데이터 마이그레이션 | 낮음(지금은) — 다중 모드·사용자 커스텀 테마가 생긴 뒤의 기술. D-6 트리거와 함께 기록 |

공통점은 전략이 아니라 **경계**다: 세 에이전트 모두 (a) 원시 색을 아는 지점이 1개 계층으로 폐쇄돼 있고, (b) 상태→색 대응이 호출점 분기가 아니라 조회/파생으로 존재하며, (c) 능력 저하(256color/ANSI16/light-bg)가 값 선택 계층에서 흡수된다. codex의 "light 배경에서는 Yellow 대신 Reset"(노란색이 라이트 테마에서 사라진다는 주석)과 pi의 256color 근사(녹색 가중 유클리드 거리)가 같은 관심사의 두 구현이다.

### 3.2 컴포넌트 프리미티브 경계 — "관문"의 3가지 형태

| 형태 | 채택자 | Loop 대응물 |
| --- | --- | --- |
| 계약으로 강제(`render(width)→string[]` + `invalidate()`) | pi | `compactLines`/`singleLine`이 이미 줄 기반 계약 — 토큰 모듈 추가 시 이 계약 위에 얹음 |
| 모듈 소유권으로 강제(스타일 공급 모듈만 색을 앎) | codex | `packages/presentation/src/tokens.ts`가 유일한 색·어휘 원천 → 경계 테스트가 밖의 사용을 거부(D3-a) |
| 패키지 관문으로 강제(render/ 를 통과하지 않으면 화면 출력 불가) | agy | TS 패키지 구조+경계 테스트로 근사 — "관문 함수"(역할 래퍼, overflow 팩토리)를 export하는 것이 실질적 관문 |

pi의 `chat-viewport.js`(트랜스크립트+하단 dock 슬롯을 35줄 함수로 고정)는 Loop P4-1의 해법을 보여준다: **화면 구조의 편차는 레이아웃을 한 곳에 선언하면 구조적으로 불가능해진다.** Loop의 대응물은 슬롯 조립이 아니라 "포맷터 4종이 presentation 안에서만 존재"하는 소유권 정리다(D1-S3).

### 3.3 상태 표현 — 소집합 + 파생의 만장일치

세 에이전트의 상태 어휘는 모두 **닫힌 소집합**이다: pi 인디케이터 kind 4종+Idle, codex `StatusTone` 3종, agy 7단어(재조정 파생). 그리고 표시 상태는 원시 이벤트가 아니라 **계산값**이다(pi는 세션 상태에서, codex는 톤 enum으로, agy는 `ActivitySnapshot` 병합+`reconcileStatus`로 — 서브에이전트·의존 작업의 idle까지 정의에 포함). 이는 Loop의 그래프 퍼스트 원칙(task 상태 9종이 protocol 유니언으로 존재, `taskPriority` 정렬은 이미 결정적)과 정확히 같은 방향이며, **상태→시각 역할 매핑만 presentation 조회 테이블로 보태면 된다.**

### 3.4 일관성 강제 — 세 에이전트가 공유하는 5불변식

1. **원시 색·이스케이프를 아는 파일은 한 계층뿐** — pi theme/, codex style·color·terminal_palette, agy types+render.
2. **상태·역할 어휘는 닫힌 집합(타입/enum/스키마)** — pi `ThemeColor` 유니언, codex `StatusTone`, agy proto 열거형.
3. **화면 문법(문구·힌트·글리프·밀도 상수)은 공용 모듈 소유** — codex `popup_consts.rs`·`key_hint.rs`, agy `render/hint`·`layout.KeyHint` 3종, pi 표준 인디케이터·표준 overflow 문구.
4. **환경 적응(색 능력·라이트/다크)은 호출점이 아니라 계층이 흡수** — pi colorMode 감지+256 근사, codex `StdoutColorLevel`+`best_color`, agy termenv 프로파일+저하 계단.
5. **테마/어휘 변경은 캐시 무효화와 짝** — pi `invalidate()` 전파, codex `THEME_REVISION` 증가, agy pub/sub 갱신.

이 5개는 oss-agent-ui-survey(문서 기반 6프로젝트)와 design-system-practices(업계 관행)가 제시한 불변식과 교차해서 **실행 중인 실장에서 재확인**된 것이다 — 문서-코드 일치 검증(pi §4.5)과 바이너리 수치 증거(codex `" to select"` 15회)까지 포함해, "이론이 아니라 돌아가는 코드의 성질"이라는 과제 의도를 충족한다.

---

## 4. Loop 감사 P1–P4 대조: 증거 출처 → Loop 적용안

감아 각 문제에 대해 세 에이전트의 해당 메커니즘과 Loop 적용안을 '증거 출처 → 적용안'으로 대응시킨다. "채택"은 2주 계획(파운데이션 §5) 범위, "보류"는 트리거 명시.

| 감사 문제 | 세 에이전트 메커니즘 (증보 출처) | Loop 적용안 | 채택/보류 |
| --- | --- | --- | --- |
| **P1-1** 상태가 시각적으로 동등 | → pi `footer.js:153-163`: 컨텍스트 %를 `warning`/`error` 역할로 등급화하는 임계 분기가 **컴포넌트 1곳**에 존재; `theme.js:262-280`: thinking 7단계→테두리 색 역할 매핑이 **테마 데이터에 선언** → codex `style.rs` `status_style_for(StatusTone)`: 상태 3색이 함수 1개에서 결정, light-bg 보정 포함 → agy 상태 소집합 + `reconcileStatus` 파생 | `tokens.ts`에 색 역할 폐쇄 집합(`success/warning/error + accent/muted/dim/text`)과 **task 상태→역할 조회 테이블**(`taskPriority` 옆). 우선순위 정렬은 이미 존재하므로 조회만으로 P1-1 해소 | **채택** (D2, S5) |
| **P1-2** 스타일 프리미티브 0개 | → pi `theme.fg(color, text)` 역할 래퍼(리셋 범위까지 관리: fg만 `\x1b[39m`) → codex `style.rs` 시맨틱 함수군(`secondary_text_style` 등) → agy `render/styles.go` | 역할 래퍼 함수 1개(`paint(role, text)`)를 tokens 모듈에. 굵기·배경은 Loop 표면에 없으므로 미신설 | **채택** (D2) |
| **P1-3** `NO_COLOR`/비-TTY 미처리 | → pi `createTheme`: `getCapabilities().trueColor ? truecolor : 256color`(능력 감지가 색 결정의 입력) → codex `terminal_palette.rs` `StdoutColorLevel{Unknown→Color::Reset}`: 감지 불능 시 **무색이 명시적 상태** → agy OSC 10/11 감지 + termenv 프로파일 | 환경 가드 모듈(진입 1곳): 비-TTY면 클리어 이스케이프 방출 중단(P3-1 절반), `NO_COLOR` 비었지 않으면 색 off. 세 에이전트 모두 "감지 실패 = 무색 폴백"이므로 보수적 가드가 실증 관행과 일치 | **채택** (D2, S5) |
| **P1-4** CLI/pi 표면 이중 시각 체계 | → pi `ThemeColor` 역할 이름이 pi-loop/pi-extensions가 이미 경유하는 어휘(persona-ux.md 팩트 3: 8역할 사용) | Loop 역할 키 이름을 pi 역할과 의미 정렬(`success/warning/error/muted/dim/text/accent`) — 두 체계가 같은 역할 언어를 공유. 색 값까지 통일은 pi 테마가 사용자 교체 가능하므로 하지 않음(역할 이름만의 정렬) | **채택** (D2 명명 규칙) |
| **P2-1** 글리프 포맷터별 하드코딩 | → pi `theme.fg("success","✓")`·`fg("warning","✗")` — 글리프+역할 조합이 집중 → codex 글리프가 상수/공용 모듈 소속 → agy `render/StatusMarker` 전용 | 글리프 상수(`✓`/`!`/neutral 불릿 D-3)를 tokens 모듈에, 소비는 상수 참조만 | **채택** (D1, S1·S4) |
| **P2-2** overflow 문구 12변종 | → pi overflow 표현이 프리미티브에 단일 구현(`custom-editor.js:36` `` ` ↑ ${hiddenLineCount} more ` ``) → agy `↑ %d more / ↓ %d more` 동일 패턴 [BIN] | `… {omitted} more {noun}` 팩토리 1개로 수렴(기존 `ui-output-limits.md` 계약 유지 — pi/agy의 `↑` 화살표 문구는 채택하지 않고 **메커니즘**(단일 팩토리)만 채택) | **채택** (D1, S1·S2) |
| **P2-3** 빈 상태 문자열 분산 | → agy `"No steps yet"` 등 표준 문구가 render/ 관문 소속 → codex 표준 문구 생성 함수 | 빈 상태 상수를 tokens 모듈에 단일화(`No runs` 이중 정의 제거) | **채택** (D1, S1·S2) |
| **P2-4** `renderRuns` 이중 구현 | → pi 2층 구조: 포맷 로직이 앱 임의 코드가 아니라 컴포넌트/공용 레이어 소속 → codex 렌더러가 `renderable.rs` 불변 단위로 집중 | CLI 인라인 복제 삭제, `renderRuns` 단일 구현 사용(포맷터 이관의 일부) | **채택** (D1, S3) |
| **P2-5** 포맷 후 `replace()` 수술 | → pi 컴포넌트 계약: 표시명 파라미터를 명시 수신(Ratatui "명시적 입력 구조체" 지침과 동일) | `formatSnapshot`에 표시명 파라미터 추가, `replace()` 삭제 | **채택** (D1, S3) |
| **P2-6** 구분자 관행 불일치 | → codex `" · ".dim()`이 공용 코드에서 생성([SRC-main] `popup_consts.rs`) → agy 힌트 구분자가 render 관문 소속 | 구분자 상수(`list: "·"`, `label: ": "`, `depends: "←"`)를 tokens 모듈에, 의미별로 이름 부여 | **채택** (D1, S1) |
| **P3-1** watch 전체 하드 클리어 | → pi 라인 단위 diff 렌더 + `\x1b[?2026h` synchronized output + 16ms 스로틀+nextTick 병합(`tui-main-screen.js`, `tui.js:169`) → agy 2026/2027 이스케이프 내장 [BIN] | 우선 TTY 가드만(비-TTY에서 클리어 소거). 차분 렌더링은 트리거: "플리커 회귀가 실제 관찰될 때"(파운데이션 §4.6 승계). 스냅샷 폴링+문자열 출력 구조에서 16ms 스로틀은 과투자 | **부분 채택, 나머지 보류** (S5·S6) |
| **P3-2** 터미널 폭 미탐지 | → pi 계약 자체가 `render(width)` — 폭이 모든 렌더의 입력 → agy 크롬 회계(`ChromeLines`/`AvailableHeight`)로 가용 영역 산출 → codex `side_by_side_layout_widths` 공용 함수 | 터미널 폭 인식 `lineTextLimit` 상한 — `policy.toml` 정책 변경 수반(D-5). agy의 "크롬 먼저 회계"는 Loop의 논리 줄 예산(status 8 등)과 같은 발상이므로 설계안 참고 | **보류** (D-5 결정 후) |
| **P3-3** 라벨 예산 이중 체계 | → agy: 키 힌트가 `keybindings/hint_types.go` → `layout.KeyHint`로 단일 흐름(키바인딩 시스템이 힌트 문구의 원천) | herdr 라벨은 (b) 유지+규격 문서화(파운데이션 §4.1-C 권고 승계). agy 사례는 "어댑터 제약 파라미터 + presentation 어휘" 분리의 선례로 D-2 결정 시 참조 | **보류** (D-2) |
| **P4-1** `main.ts` 909줄 모놀리스 | → codex 모듈 분리(입력/대본/스타일 공급/프로브) → agy types→render→layout→model/store 6계층 → pi조차 조립부는 별도(`interactive-mode.js`는 여전히 거대하나 — 포맷터가 아닌 상태 관리가 비대한 것으로, Loop 교훈: **디스패치와 포맷의 분리가 유효한 경계**) | 포맷터 4종(doctor/benchmark/models/cleanup)을 명시적 입력의 `render*` 함수로 presentation 이관, `main.ts`는 인자 파싱·디스패치·프로세스 스폰만 | **채택** (D1, S3) |
| **P4-2** 표시 라벨 원천이 presentation 밖 | → codex `key_hint.rs`(키 표기의 유일 원천이 하부 시스템이 아닌 공용 모듈) → agy 힌트 단일 흐름(위와 동일) | P3-3과 동일 취급 — D-2 후속 결정 | **보류** (D-2) |

---

## 5. design-foundations D1–D3와의 일치/상충

| 권고 | 실증과 **일치** | 실증과 **상충/보정** | 결론 |
| --- | --- | --- | --- |
| **D1** 표현 어휘 토큰 모듈(무색, 1주차) | 세 에이전트 모두 화면 문법을 공용 모듈이 소유(codex `popup_consts.rs`는 "uniform feel"을 주석으로 명문화 + 바이너리 반복 횟수 증거, agy render 관문, pi 표준 문구·인디케이터). overflow 단일 구현(pi `↑ N more`), 빈 상태 표준화(agy "No steps yet")도 실증됨 | pi의 글리프는 "하드코딩되되 색은 항상 역할"(live-pi §3.5) — 즉 글리프 상수 모듈의 근거는 codex/agy 쪽이 더 직접적. 또 pi의 전역 theme 싱글톤은 어휘 접근 방식의 하나일 뿐, D1이 채택하는 것은 상수 모듈이므로 충돌 없음 | **D1 강화 확정.** 상수 모듈+명시적 import 형태는 세 실증 중 어느 것과도 충돌하지 않는 최소 형태 |
| **D2** 최소 시맨틱 토큰 + 환경 가드 | codex 상태 3색 = ANSI 기본색 보존 + light-bg 보정은 D2의 "ANSI 16색 시작"과 정확히 일치. pi 폐쇄 역할 집합+유니언+throw, 능력 감지(colorMode)도 D2의 형태 | (a) codex의 전면적 "실측→파생"은 D2보다 무거운 기계(OSC 프로브·색 수학) — D2는 역할 상수로 시작하고 파생은 확장점으로 기록한다(파운데이션 §4.1-A의 "트리거 시 승격" 원칙과 동일 구조). (b) `NO_COLOR`는 세 문서 어디에서도 명시 관찰되지 않았다(세 에이전트는 능력 감지로 상위 개념을 구현) — D2의 NO_COLOR 가드는 유지하되 "색 능력 감지 프레임의 특수 케이스"로 문서화하는 것이 실증과 정합. (c) agy 시드 파생·라이트/다크는 테마 1개인 Loop 범위 밖 | **D2 확정, 보정 2건 반영:** (1) 파생 확장점 명시, (2) 가드를 능력 감지 프레임으로 일반화 |
| **D3** 도구로 강제(경계 테스트+무결성 테스트+계약 테스트) | pi schema+런타임 throw+순환 참조 감지 테스트가 무결성 검증의 실례. codex는 컴파일 타임 봉인으로 **더 강한** 수준. agy는 구조적 관문 | TS 프레젠테이션에서 Rust식 컴파일 봉인은 불가능. 단 pi의 유니언 타입+런타임 throw는 TS에서 동일하게 실현 가능하므로, D3에 "역할 키는 유니언 타입으로 선언하고 래퍼 함수가 미지 키를 throw"를 명시적으로 포함시킨다(강제 수단이 테스트만이 아니라 타입+런타임 2층이 됨) | **D3 확정, 보정 1건:** 무결성 테스트에 유니언+throw 계약 추가 |

종합: **D1–D3는 세 실구현 증거와 충돌 없이 강화됐다.** 상충으로 보였던 것들은 전부 "지금 채택할 최소 형태 vs 나중 확장점"(파생/시드/차분 렌더)의 순서 문제로, 파운데이션 §4.6의 의도적 생략 원칙이 그대로 유효하다. 유일하게 실증이 우선순위를 바꾼 것은 없다 — 어휘 → 토큰/가드 → 강제 순서(§1.3)는 세 에이전트의 의존 방향(원시값 계층 → 역할 → 문법 모듈)과 일치한다.

---

## 6. 상위 3개 메커니즘 상세 (Loop 적용 형태와 검증)

### 6.1 화면 문법의 공용 모듈 소유 (→ D1)

- **증거:** codex `tui/src/popup_consts.rs` 전문("Keep this consistent across all popups for a uniform feel", `MAX_POPUP_ROWS: usize = 8`, `standard_popup_hint_line()`), `key_hint.rs`("Rendering helpers emphasize each complete shortcut uniformly, including its separators"), 바이너리 증거 `" to go back"` 2회·`" to select"` 15회·`" to confirm"` 12회·`" to toggle"` 4회 — 문구가 한곳에서 생성됨을 반복 수치로 뒷받침. agy `cli/render/`(18+ 파일 관문: `StatusMarker`, `hint.go`, `scrollbar.go`, `TruncateAnsi`, `wrap_ansi`) + `layout.KeyHint` 3종 표준 힌트와 `DefaultModelHints`/`DefaultDetailViewHints` 기본 세트 [BIN].
- **Loop 적용:** `packages/presentation/src/tokens.ts` — 상태 글리프, 구분자(의미명 부여), 빈 상태 상수, `… {omitted} more {noun}` overflow 팩토리. CLI 포맷터 4종 이관(S3)과 호출점 교체(S2)가 소비 전제.
- **검증:** 기존 `cli.test.ts` 계약 회귀(1주차는 바이트 동일) + 무결성 단위 테스트(§6.3).

### 6.2 색 역할 밀봉 + 상태→역할 조회 테이블 (→ D2)

- **증거:** pi `theme.d.ts:11-12`(`ThemeColor` 49역할 유니언 — 컴포넌트 작성자가 임의 hex/ANSI를 만질 수 없음), `theme.js:244-252`(`fg()` 미지 키 `throw new Error("Unknown theme color: …")`), `theme-schema.json`(필수 색 강제 = 완전 팔레트), `footer.js:153-163`(70/90% 임계 → `warning`/`error` 역할 등급화가 1곳에). codex `style.rs` `StatusTone{Success,Attention,Failure}` → `status_style_for()`(ANSI 기본색만 사용해 **사용자 터미널 팔레트 보존**, light 배경에서는 Yellow→Reset).
- **Loop 적용:** 역할 키 유니언(`success|warning|error|accent|muted|dim|text` — pi 역할과 의미 정렬, P1-4), `paint(role, text)` 래퍼(미지 키 throw), task 상태→역할 조회 테이블(`taskPriority` 옆), 환경 가드(비-TTY·`NO_COLOR`·색 능력 감지를 진입 1곳에서). 첫 소비자는 task 상태색과 watch 클리어 가드.
- **검증:** 텍스트 스냅샷은 ANSI 제거 후 비교 + 색 어설션 분리(파운데이션 §4.4-3 승계).
- **명시적 거부:** pi의 전역 싱글톤(theme Proxy, globalThis 공유)은 Loop의 "TS 어댑터 얇게" 원칙과 충돌 소지가 있어 채택하지 않는다(live-pi §5 주의 승계). 대안으로 pi 스스로가 프리미티브에서 증명한 **주입 모델**(Loader는 `spinnerColorFn`을 주입받고 전역 theme을 모름)을 따른다 — Loop에서는 모듈 상수+명시적 import가 그 등가물이며, 모든 컴포넌트 시그니처에 테마를 흘려보낼 필요도 없다(상수 모듈이 곧 주입 결과).

### 6.3 어휘/팔레트 완전성의 기계적 강제 (→ D3)

- **증거:** pi `theme-schema.json`(required colors → 부분 팔레트로 인한 색 특이 구조적으로 불가), `withThemeColorFallbacks`(`theme.js:193-199`, 선택 역할의 상속 테이블 — 문서 "Five colors are optional…"와 1:1), `resolveVarRefs` 순환 참조 throw(`theme.js:178-191`). codex 컴파일 타임 봉인(위젷 파일에 색 리터럴 부재 — 190+ `tui/src/*.rs` 패닉 경로 복원으로 확인). agy 구조적 관문(뷰가 색·절단·마커를 소유하지 않음).
- **Loop 적용:** D3 3요소에 pi식 2층 추가 — (a) 경계 테스트 확장: presentation 밖 ANSI/색 리터럴 금지, (b) 무결성 테스트: 모든 task 상태(9종)에 글리프·색 역할 존재 + 모든 overflow 출력이 계약 정규식 준수 + 빈 상태 중복 부재 + **역할 유니언 외 키 전달 시 throw**, (c) `cli.test.ts` 회귀 망 승격.
- **검증:** `bun run test:architecture` + `bun test packages`(유료 모델 호출 없음 — AGENTS.md 준수).

---

## 7. 보류 권고 (트리거 명시)

| 메커니즘 | 증거 | 미채택 이유 | 재검 트리거 |
| --- | --- | --- | --- |
| 차분 렌더링+동기화 출력+스로틀 | pi `tui-main-screen.js`(라인 diff, `\x1b[?2026h`, 변경 구간만 재출력), `tui.js:169` `MIN_RENDER_INTERVAL_MS=16` | Loop watch는 변경 시에만 재출력하는 문자열 출력 — 프레임워크급 렌더 루프는 과투자 | 플리커 회귀가 실제 관찰될 때(파운데이션 §4.6 승계) |
| 실측 기반 색 파생(OSC 10/11 + blend/contrast) | codex `terminal_probe.rs`, `color.rs`(CIE76), `terminal_palette.rs` | OSC 프로브·색 수학은 테마 1개·무색 시작인 현재에 불필요. D2의 역할 상수가 파생의 자리를 남겨둠 | 라이트/다크 적응 또는 정밀 대비 보정 요구 시(D-4/D-6과 함께) |
| 시드 파생 테마 + 마이그레이션 | agy `CustomThemeSeeds` proto + `cli/onboarding/color_migration.go` | 다중 모드·사용자 커스텀 테마가 없음 | 두 번째 테마·사용자 테마 확장 시 |
| 크롬 회계 레이아웃(ChromeLines/AvailableHeight) | agy `cli/layout/` [BIN] | Loop는 논리 줄 예산(policy.toml)이 이미 등가 역할 — 물리 폭 회계는 D-5 정책 결정과 결합 필요 | 터미널 폭 인식 lineTextLimit 도입 시(D-5) |
| 구문 강조 테마가 UI accent까지 지배하는 단일 원천 | codex `render/highlight.rs`(`codex.accent`, `markup.inserted/deleted` 스코프) | Loop에 코드 하이라이팅 표면이 없음 | 코드 렌더 표면 추가 시 |

---

## 8. 한계와 미해결 리스크

1. **실행 시각 증거 부재(3건 공통 승계):** pi는 dist 정독, codex는 바이너리+소스 교차, agy는 바이너리+`--help`/`changelog`/`models` 관찰 — **어떤 에이전트도 실행 중 렌더링(스크린샷·플리커·색 적용 결과)을 관찰하지 않았다.** 본 문서의 비교는 구조 증거이며, 체감 품질 비교가 아니다. agy의 색 파생·스피너 실동작은 미확인 상태로 남는다(유료 호출 배제 원칙 준수).
2. **버전 고정 필요:** pi v0.87.1 dist 줄 번호, codex 0.155.1↔main 시차(accent 메커니즘이 버전마다 다름 — live-codex §7), agy v1.2.9. 재인용 시 각 문서의 버전 기준을 함께 인용해야 한다.
3. **agy 증거의 추정 성분:** 문자열 블롭 병합으로 일부 어휘의 기능 귀속이 추정이다(live-agy §7.2). 본 문서는 agy 인용을 구조(파일 경로·심볼·proto) 수준으로 제한하고 문구 귀속 추정에는 의존하지 않았다.
4. **미해결 후속 결정:** D-1(이름 규칙 ADR), D-2(herdr 라벨 소유권), D-3(cleanup `-` 불릿), D-4(색 1차 소비자·ANSI 16 시작), D-5(폭 인식 lineTextLimit), D-6(W3C JSON 승격) — 본 비교는 이들의 우선순위를 바꿀 증거를 발견하지 못했다(§5 종합).
5. **본 문서는 권고 문서다:** 구현 착수는 파운데이션 §5의 2주 계획(S1–S8)을 따르며, 본 문서는 그 계획의 근거를 실증으로 보강하는 역할에 한정된다.

---

## 부록: 출처 인덱스

- **1차 조사(본 문서의 전부가 여기서 파생):** `docs/design/research/live-pi.md`(pi v0.87.1 dist+pi-tui+docs 교차), `docs/design/research/live-codex.md`(codex 0.155.1 npm+바이너리+openai/codex 태그 소스), `docs/design/research/live-agy.md`(agy v1.2.9 바이너리 strings/proto/실행 관찰). 각 문서의 부록에 재현 명령과 파일 목록이 있다.
- **Loop 기준선:** `docs/design/research/loop-ui-audit.md`(P1–P4, worktree `86413fa`), `docs/design/design-foundations.md`(D1–D3, 2주 계획, D-1~D-6), `packages/presentation/src/{compact,snapshot,index}.ts`(현황: 프리미티브는 compact 계열뿐, 어휘·토큰 모듈 부재), `packages/cli/src/main.ts`(909줄, 감사 P4-1).
- **정책 계약:** `docs/decisions/ui-output-limits.md`(overflow 문구 계약), `config/policy.toml [output]`(줄 수 예산), `docs/decisions/persona-ux.md`(pi theme 역할 8종 사용 팩트 — P1-4 정합 근거).
