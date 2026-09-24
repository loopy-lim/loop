# live-pi — pi(@earendil-works/pi-coding-agent) 실제 구현 조사

- 조사 대상: `.research-sources/pi-coding-agent` (실행 중인 설치본 심볼릭 링크, v0.87.1)
- 조사 방법: 배포 `dist/` 컴파일 코드와 `node_modules/@earendil-works/pi-tui`(v0.87.1, 동일 버전)를 직접 정독. 공식 문서(`docs/themes.md`, `docs/tui.md`)와 교차 검증.
- 참고: pi는 소스(`src/`)를 배포하지 않고 컴파일된 `dist/*.js`(가독 가능, sourcemap 동봉)를 제공한다. 본 문서의 줄 번호는 `dist` 기준이다.
- 위치: `docs/design/research/live-pi.md` (조사 전용, 코드 변경 없음)

---

## 1. 테마 시스템 — "역할(role) 기반 시맨틱 팔레트 + 전역 단일 인스턴스"

### 1.1 구조

| 파일 | 역할 |
|---|---|
| `dist/modes/interactive/theme/theme.d.ts` | `ThemeColor`(49개 fg 역할) / `ThemeBg`(7개 bg 역할) 유니언 타입, `Theme` 클래스 |
| `dist/modes/interactive/theme/theme.js` (990 lines) | 색 유틸리티, `Theme` 클래스, 로딩/폴백/핫리로드, 전역 인스턴스 |
| `dist/modes/interactive/theme/dark.json`, `light.json` | 빌트인 테마 (vars → colors 2단 구조) |
| `dist/modes/interactive/theme/theme-schema.json` (356 lines) | 사용자 테마 JSON 검증 스키마 (required colors 명시) |
| `dist/modes/interactive/theme/theme-controller.js` | 인터랙티브 모드의 테마 적용/자동 전환 컨트롤러 |

### 1.2 타입으로 강제되는 색 역할

`ThemeColor`는 문자열 리터럴 유니언이다 (`theme.d.ts:11-12`):

```ts
export type ThemeColor = "accent" | "border" | "borderAccent" | "borderMuted" | "success" | "error" | "warning" | "muted" | "dim" | "text" | "thinkingText" | ... | "thinkingMax" | "bashMode";
export type ThemeBg = "selectedBg" | "searchMatchBg" | "userMessageBg" | "customMessageBg" | "toolPendingBg" | "toolSuccessBg" | "toolErrorBg";
```

`Theme.fg/bg`는 맵에 없는 키를 **런타임에서도 거부**한다 (`theme.js:244-252`):

```js
fg(color, text) {
    const ansi = this.fgColors.get(color);
    if (!ansi) throw new Error(`Unknown theme color: ${color}`);
    return `${ansi}${text}\x1b[39m`; // Reset only foreground color
}
```

즉 컴포넌트 작성자는 임의 hex/ANSI 문자열을 만질 수 없고, 49개 역할 이름 중 하나만 쓸 수 있다. fg 리셋이 `\x1b[39m`(전경만), bg 리셋이 `\x1b[49m`(배경만)인 이유도 주석으로 명시돼 있다 — 스타일이 서로를 지우지 않게 하기 위함.

### 1.3 테마 정의 파일: vars → colors 2단 참조

`dark.json:4-23`은 16개 `vars`(원시 색)를 정의하고, `colors`는 var 이름을 참조한다:

```json
"vars": { "cyan": "#00d7ff", "blue": "#5f87ff", "green": "#b5bd68", "red": "#cc6666", "text": "#d4d4d4", ... },
"colors": { "accent": "accent", "border": "blue", "borderAccent": "cyan", "success": "green", "error": "red", ... }
```

변수 참조는 체인 가능하며 순환 참조는 에러다 (`theme.js:178-191` `resolveVarRefs` — `visited` Set으로 `Circular variable reference detected` throw). 색 값 4형식은 `fgAnsi`/`bgAnsi`(`theme.js:117-141`)에서 처리한다: `"#rrggbb"`(truecolor or 256color 근사), 숫자(ANSI 256 인덱스), var 참조, `""`(터미널 기본값).

### 1.4 색수감 저하(256color 근사)가 라이브러리 안에 있음

`theme.js:50-115`: hex → sRGB 가중 유클리드 거리(`dr²*0.299 + dg²*0.587 + db²*0.114`, 주석: "human eye is more sensitive to green")로 6×6×6 큐브 vs 그레이 램프 중 가까운 쪽을 고른다. 채도가 거의 없는 색(spread < 10)만 그레이로 보낸다. 이는 `createTheme`(`theme.js:431-433`)의 모드 선택과 연결된다:

```js
const colorMode = mode ?? (getCapabilities().trueColor ? "truecolor" : "256color");
```

→ **테마 저자는 항상 hex 하나만 쓰고, 터미널 능력 저하는 시스템이 흡수한다.** 이것이 "같은 테마가 모든 터미널에서 비슷하게 보이는" 일관성의 첫 축이다.

### 1.5 선택적 역할의 폴백 테이블 (문서와 코드 일치)

`docs/themes.md`는 "Five colors are optional and inherit another color when omitted"라고 말하고, 코드 `withThemeColorFallbacks`(`theme.js:193-199`)가 정확히 이를 구현한다:

```js
function withThemeColorFallbacks(colors) {
    return {
        ...colors,
        scrollbarTrack: colors.scrollbarTrack ?? colors.muted,
        scrollbarThumb: colors.scrollbarThumb ?? colors.text,
        thinkingMax: colors.thinkingMax ?? colors.thinkingXhigh,
        searchMatchBg: colors.searchMatchBg ?? colors.selectedBg,
        searchMatchText: colors.searchMatchText ?? colors.text,
    };
}
```

`theme-schema.json:35-39`는 required colors를 강제하므로 "테마는 항상 완전한 팔레트"가 보장된다 — 부분 팔레트로 인한 색 튐이 구조적으로 불가능하다.

### 1.6 전역 단일 테마 인스턴스 (Proxy + Symbol.for)

`theme.js:611-619`:

```js
const THEME_KEY = Symbol.for("@earendil-works/pi-coding-agent:theme");
export const theme = new Proxy({}, {
    get(_target, prop) {
        const t = globalThis[THEME_KEY];
        if (!t) throw new Error("Theme not initialized. Call initTheme() first.");
        return t[prop];
    },
});
```

주석: "Use globalThis to share theme across module loaders (tsx + jiti in dev mode)". 모든 컴포넌트(`footer.js:6`, `status-indicator.js:3`, `tool-execution.js:5` 등)가 `import { theme }` 하나만 바라본다. 테마 교체는 `setGlobalTheme()`으로 포인터만 바꾸고, `onThemeChange` 콜백이 UI 전체에 `invalidate()` + `requestRender()`를 방파한다 (`interactive-mode.js:743-747`).

폴백도 일관성의 일부다: `setTheme`/`initTheme`은 로드 실패 시 조용히 `dark`로 떨어지고(`theme.js:664-675`), `theme-controller.js:112-118`은 "Failed to load theme ... Fell back to dark theme."를 표시한다. **화면이 색 없이 깨지는 상태가 없다.**

### 1.7 라이트/다크 자동 전환

`theme.js`는 터미널 배경을 3단으로 감지한다: OSC 11 쿼리(`detectTerminalBackgroundTheme`, luminance ≥ 0.5 → light), `COLORFGBG` env, fallback "dark". `theme-controller.js:38-52` `applyFromSettings()`는 `"light/dark"` 설정을 `parseAutoThemeSetting`으로 파싱해 자동 동기화를 켜고, `ui.onTerminalColorSchemeChange` 리스너로 실행 중 전환까지 한다. `assertThemeNameIsValid`(`theme.js:303-306`)는 이름에 `/`를 금지해 이 설정 문법을 보호한다 — docs(`themes.md:24-26` "Theme names cannot contain `/`")와 일치.

### 1.8 소비자별 파생 테마 헬퍼

`theme.js` 말미에는 하위 컴포넌트용 뷰가 있다: `getMarkdownTheme()`(mdHeading…highlightCode), `getSelectListTheme()`, `getEditorTheme()`, `getSettingsListTheme()`, `buildCliHighlightTheme()`(highlight.js 토큰 클래스 → theme 역할 매핑, `theme.js:846-872`). 문법 강조기의 `keyword`/`string`/`comment` 같은 외부 토큰 개념이 테마 역할로 **한 곳에서** 번역된다. 툴마다 제각각 문법 색을 고르는 일이 불가능한 구조다.

---

## 2. TUI 컴포넌트 구조 — "render(width) → string[] 계약 + 캐시 + 무효화"

### 2.1 두 레이어 아키텍처

- **`@earendil-works/pi-tui`**: 범용 프리미티브 라이브러리. pi 본체와 완전히 분리된 패키지 (`node_modules/@earendil-works/pi-tui`, version 0.87.1).
- **`dist/modes/interactive/components/*`**: pi 앱 컴포넌트. 프리미티브를 조립하고 `theme`을 주입한다.

프리미티브 목록 (`pi-tui/dist/index.d.ts:1-40` export):

```ts
export { Box } from "./components/box.ts";
export { CancellableLoader } from "./components/cancellable-loader.ts";
export { Editor, ... } from "./components/editor.ts";
export { HStack } from "./components/h-stack.ts";
export { Input } from "./components/input.ts";
export { Loader, type LoaderIndicatorOptions } from "./components/loader.ts";
export { Markdown, type MarkdownTheme } from "./components/markdown.ts";
export { MouseRegion, ... } from "./components/mouse-region.ts";
export { ScrollView, ... } from "./components/scroll-view.ts";
export { SelectList, ... } from "./components/select-list.ts";
export { SettingsList, ... } from "./components/settings-list.ts";
export { Spacer } from "./components/spacer.ts";
export { Text } from "./components/text.ts";
export { TruncatedText } from "./components/truncated-text.ts";
export { VStack, ... } from "./components/v-stack.ts";
```

### 2.2 Component 계약 (`pi-tui/dist/tui.d.ts:68-90`)

```ts
export interface Component {
    render(width: number): string[];
    handleInput?(data: string): void;
    handleMouse?(event: TuiMouseEvent): TuiMouseEventResult | undefined;
    wantsKeyRelease?: boolean;
    invalidate(): void;
}
```

`docs/tui.md` "Understand the component model"의 세 규칙이 코드와 정확히 대응한다:

1. "renders an array of terminal lines for an available width" → `render(width): string[]`.
2. "Measure visible terminal columns rather than string length" → `utils.js`의 `visibleWidth/truncateToWidth/sliceByColumn/wrapTextWithAnsi`를 공용 유틸로 제공 (`index.d.ts` 마지막 export).
3. "must invalidate cached output" → `invalidate()`가 계약의 필수 멤버.

### 2.3 캐시-무효화 패턴이 프리미티브에 내장

`Text.render`(`pi-tui/dist/components/text.js:31-33`):

```js
render(width) {
    // Check cache
    if (this.cachedLines && this.cachedText === this.text && this.cachedWidth === width) {
        return this.cachedLines;
    }
```

`invalidate()`는 캐시를 지운다(`text.js:45-49`). `Box`는 배경 함수 변경을 "sampling output"으로 감지한다(`box.js:33-35` 주석: "Don't invalidate here - we'll detect bgFn changes by sampling output"). 테마 교체 시 `Container.invalidate()`가 자식들에게 재귀 호출된다(`box.js:57-64`).

### 2.4 배경/패딩은 Box·Text가 전담

`Box(paddingX, paddingY, bgFn)`는 자식 라인에 배경을 씌우고 패딩을 둘러싼다. 앱 컴포넌트는 역할 색을 bgFn으로 넘길 뿐이다 — `user-message.js:40`:

```js
const contentBox = new Box(this.outputPad, 1, (content) => theme.bg("userMessageBg", content));
```

`tool-execution.js:71-73`도 동일: `new Box(1, 1, (text) => theme.bg("toolPendingBg", text))`. 상태(pending/success/error)에 따라 `setBgFn`으로 역할만 교체한다(아래 §3.4).

레이아웃 프리미티브는 `VStack/HStack/Spacer/ScrollView`이며, 전체 화면 조립도 이 조합이다(§4.2).

### 2.5 포커스/커서/마우스까지 프레임워크 소유

- `Focusable` + `CURSOR_MARKER`(`tui.d.ts:101-122`): 컴포넌트가 `\u001B_pi:c\u0007` 마커를 커서 위치에 출력하면 TUI가 하드웨어 커서를 배치 — IME 후보창 위치 보정. docs/tui.md의 "Containers that wrap an Input or Editor must propagate their focused state" 경고와 상응.
- `MouseRegion`(`index.d.ts`)으로 클릭 영역을 선언. 실사용 예: `tool-execution.js:113-121` — 결과 클릭 시 `setExpanded(!this.expanded)`(툴 출력 접기/펼치기), `assistant-message.js:139-147` — thinking 블록 클릭 토글.
- 오버레이 시스템(`OverlayOptions/OverlayHandle`, `tui.d.ts:130-215`): anchor/offset/margin/`visible(w,h)` 반응형 표시.

---

## 3. 상태 표현 — "상태 = 컴포넌트 교체 + 역할 색 교체"

### 3.1 스피너: Loader 프리미티브 + 상태별 서브클래스

`pi-tui/dist/components/loader.js:2-3`:

```js
const DEFAULT_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const DEFAULT_INTERVAL_MS = 80;
```

`Loader.updateDisplay()`(`loader.js:70-76`)가 프레임을 바꿀 때마다 `ui.requestRender()`를 호출한다 — 애니메이션도 동일한 렌더 루프를 탄다. 색은 생성자로 주입받는다: `spinnerColorFn`, `messageColorFn`.

pi 앱은 `status-indicator.js`에서 용도별 인디케이터를 정의한다:

```js
export class WorkingStatusIndicator extends StatusIndicator {   // spinner=accent, message=muted
export class RetryStatusIndicator extends StatusIndicator {     // spinner=warning + 카운트다운 "Retrying (2/5) in 4s..."
export class CompactionStatusIndicator extends StatusIndicator { // "Auto-compacting... (ctrl+c to cancel)"
export class BranchSummaryStatusIndicator extends StatusIndicator { // "Summarizing branch..."
export class IdleStatus { render(width) { return [" ".repeat(width), " ".repeat(width)]; } }
```

상태의 종류("working/retry/compaction")가 `kind` 필드로 컴포넌트에 새겨지고, `clearStatusIndicator(kind)`(`interactive-mode.js:1719-1736`)는 자기 kind만 지운다 — 상태 전환 충돌을 방지하는 소유권 모델.

### 3.2 상태줄(Footer): 단일 컴포넌트, 역할 색으로만 상태 색 지정

`footer.js:153-163` — 컨텍스트 사용량이 테마 `error`/`warning` 역할로 자동 등급화된다:

```js
if (contextPercentValue > 90) {
    contextPercentStr = theme.fg("error", contextPercentDisplay);
} else if (contextPercentValue > 70) {
    contextPercentStr = theme.fg("warning", contextPercentDisplay);
}
```

우측 정렬·폭 초과 트렁케이션·ANSI 리셋과 outer dim의 충돌 회피("statsLeft may contain color codes ... that end with a reset, which would clear an outer dim wrapper", `footer.js:196-200`)까지 컴포넌트가 캡슐화한다. 확장 상태줄은 `setExtensionStatus(key, text)`로 제공되며 알파벳 정렬 + `sanitizeStatusText`(제어문자 제거)로 한 줄에 합친다(`footer.js:210-222`).

### 3.3 에디터 테두리 = 에이전트 상태의 캔버스

`interactive-mode.js` `updateEditorBorderColor()`:

```js
if (this.isBashMode) {
    this.editor.borderColor = theme.getBashModeBorderColor();      // bashMode 역할
} else {
    const level = this.session.thinkingLevel || "off";
    this.editor.borderColor = theme.getThinkingBorderColor(level);  // off→max 7단계 역할
}
```

`Theme.getThinkingBorderColor`(`theme.js:262-280`)는 thinking 레벨(`off/minimal/low/medium/high/xhigh/max`)을 `thinkingOff`…`thinkingMax` 7개 전용 역할에 매핑한다. dark.json에서 실제 값: `#505050`(off) → `#6e6e6e` → `#5f87af` → `#81a2be` → `#b294bb` → `#d183e8` → `#ff5fff`(max) — **회색에서 마젠타로 가는 단조 채도 상승 스케일**이 테마 데이터로 선언돼 있다. 상태→색 대응이 코드 곳곳이 아니라 테마 파일 한 곳에 있다.

스피너 색도 같은 원리다. `showWorkingStatusIndicator()`(`interactive-mode.js:1737-1741`):

```js
const colorFn = isWorkingStatusEditor(this.editor)
    ? (text) => (this.editor.borderColor ?? theme.getThinkingBorderColor(this.session.thinkingLevel || "off"))(text)
    : undefined;
```

작업 중 스피너가 에디터 테두리와 **항상 같은 색**을 공유한다.

### 3.4 툴 실행 상태: 배경 역할 3종

`tool-execution.js`는 pending/success/error를 배경 역할로 표현한다: `toolPendingBg` / `toolSuccessBg` / `toolErrorBg`(dark.json: `#282832` / `#283228` / `#3c2828` — 무채색 계열에 아주 옅은 색조). 성공/실패 시 `setBgFn`으로 배경 역할만 교체하고, 결과 폴백 렌더는 `theme.fg("toolOutput", line)` + 확장 힌트 `theme.fg("muted", ...)`(`tool-execution.js:97-107`).

### 3.5 글리프

글리프는 하드코딩되되 **색은 항상 역할**로 입힌다:
- 스피너 프레임: braille 회전자 `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏` (`pi-tui/loader.js:2`).
- 테두리 문자: `"─".repeat(width)` (`dynamic-border.js:17`), 에디터 상태 테두리 `"── "` (`custom-editor.js:47`).
- 성공/실패 마커: `theme.fg("success", "✓")`, `theme.fg("warning", "✗")` (`interactive-mode.js:1252,1255`).
- 스크롤 오버플로: `` ` ↑ ${hiddenLineCount} more ` `` (`custom-editor.js:36`).
- 토큰 화살표: `↑${input}`, `↓${output}`, `R`/`W`(캐시) (`footer.js:125-130`).
- 구분자: `·` (`footer.js:139` 세션명 구분, `interactive-mode.js:711` 힌트 구분).

글리프 자체의 통일 규칙은 "역할 색과 함께 쓰는 ASCII/box-drawing/braille 1종 세트"이며, 새 글리프+새 색 조합이 등장할 지점이 언어적으로 막혀 있다(색은 `ThemeColor` 유니언으로 제한).

---

## 4. 렌더링 진입점 — "단일 트리, 차분 렌더, 강제 렌더 레이트"

### 4.1 진입 체인

```
main.js → dist/modes/interactive/interactive-mode.js  (InteractiveMode: 컴포넌트 트리 조립 + 세션/에이전트 연결)
        → dist/modes/interactive/tui-renderer.js      (createInteractiveTui: regular=TuiMainScreen / fullscreen=TuiAltScreen)
        → pi-tui/dist/tui-main-screen.js or tui-alt-screen.js  (doRender: 차분 렌더링)
```

`tui-renderer.js:5-31`: regular 모드는 `new TuiMainScreen(...)`, fullscreen은 `new TuiAltScreen(...)`에 검색 하이라이트 스타일(`theme.bg("searchMatchBg", theme.fg("searchMatchText", text))`)과 "↓ Jump to latest message" 인디케이터 스타일을 주입한다. `createInteractiveTuiReference`(`tui-renderer.js:34-55`)는 렌더러 교체 시에도 컴포넌트가 같은 프록시를 바라보게 하는 안정 참조 프록시다.

### 4.2 화면 레이아웃이 한 함수로 고정돼 있다

`chat-viewport.js:3-35` (파일 전체가 35줄):

```js
export function createChatViewport(options) {
    const transcript = new ScrollView(options.document, { follow: "end", primary: true, overscroll: "chain", ... });
    const dock = new VStack([
        { component: options.pendingMessages, shrink: 1, minSize: 0 },
        { component: options.status, shrink: 1, minSize: 0 },
        { component: options.editor, shrink: 1, minSize: 3 },
        { component: options.footer, shrink: 1, minSize: 0 },
    ]);
    return { transcript, root: new VStack([{ transcript, basis: 0, grow: 1, shrink: 1, minSize: 1 }, { dock, ... }]) };
}
```

트랜스크립트(ScrollView) + 하단 dock(pending → status → editor → footer)이라는 **레이아웃 슬롯이 코드 한 곳에 선언**돼 있다. `interactive-mode.js:648-668`에서 슬롯에 실제 컨테이너를 채우고, 마운트 순서도 동일하게 고정한다. 각 기능(푸터, 스피너, 헤더)은 자기 슬롯 컨테이너의 자식 교체로만 나타난다(§3.1의 `statusContainer.clear()` + `addChild`).

### 4.3 차분 렌더링 (pi-tui/dist/tui-main-screen.js)

`doRender()`(`tui-main-screen.js:212-`)의 흐름:

1. `let newLines = this.render(width)` — 컴포넌트 트리 전체를 라인 배열로 렌더.
2. 오버레이 컴포지트(`compositeOverlays`), 커서 마커 추출(`extractCursorPosition`).
3. 전체 재렴 조건: 첫 렌더 / 너비 변경("wrapping changes") / 높이 변경(Termux 예외) / 수축(clearOnShrink) → `fullRender(true)`는 `\x1b[?2026h`(synchronized output)로 감싼 뒤 `\x1b[2J\x1b[H\x1b[3J` 클리어.
4. 그 외에는 **라인 단위 diff**:

```js
let firstChanged = -1;
let lastChanged = -1;
const maxLines = Math.max(newLines.length, this.previousLines.length);
for (let i = 0; i < maxLines; i++) {
    const oldLine = i < this.previousLines.length ? this.previousLines[i] : "";
    const newLine = i < newLines.length ? newLines[i] : "";
    if (oldLine !== newLine) { ... }
}
```

첫/마지막 변경 라인 사이만 `\x1b[{n}A/B`(커서 이동) + `\r\x1b[2K`(라인 클리어)로 재출력한다. 변경 범위가 이전 뷰포트 위로 넘어가면 안전하게 fullRender로 회귀한다(`tui-main-screen.js:408-413`).

5. 렌더 수율 제어 (`pi-tui/dist/tui.js:607-655`):

```js
static MIN_RENDER_INTERVAL_MS = 16;   // tui.js:169 — ~60fps 상한
requestRender(force = false) {
    if (this.renderRequested) return;
    this.renderRequested = true;
    process.nextTick(() => this.scheduleRender());
}
```

요청은 nextTick으로 합쳐(coalesce)지고 16ms 스로틀을 거친다. 단, 키 입력 직후는 `requestImmediateRender()`(`tui.js:725-742`)가 타이머를 취소하고 즉시 그린다 — 주석: "Keyboard input is latency-sensitive".

### 4.4 테마 핫리로드가 렌더 루프와 맞물리는 방식

`theme.js:694-724` `startThemeWatcher`는 커스텀 테마 파일(`~/.pi/agent/themes/<name>.json`)만 감시하고, 100ms 디바운스 후 재로드 → `setGlobalTheme` → `onThemeChangeCallback`. `interactive-mode.js:743-747`의 콜백이 `ui.invalidate()`(전체 컴포넌트 캐시 클리어) + `updateEditorBorderColor()` + `requestRender()`. 캐시된 렌더 출력이 모두 버려지므로 테마 교체가 즉시 전 화면에 반영된다. docs/tui.md의 경고 — "Do not permanently store strings with theme colors unless invalidate() rebuilds them" — 이 이 구조의 전제다.

### 4.5 문서(docs/tui.md)와 코드의 대응표

| docs/tui.md 주장 | 코드 증거 |
|---|---|
| "The package includes components for..." 16종 목록 | `pi-tui/dist/index.d.ts` export 목록과 1:1 일치 |
| "A component renders an array of terminal lines" | `tui.d.ts:68-77` `Component` |
| "The TUI coalesces render requests" | `tui.js:607-655` requestRender/scheduleRender, `MIN_RENDER_INTERVAL_MS = 16` |
| "place CURSOR_MARKER immediately before its visual cursor" | `tui.d.ts:118` `CURSOR_MARKER = "\u001B_pi:c\u0007"`, `tui-main-screen.js:243` `extractCursorPosition` |
| "Unhandled wheel events scroll the nearest ScrollView" | mouse dispatch(`tui.js dispatchMouseEvent`) + ScrollView 핸들러 |
| "Pi resets styling and hyperlinks after every line" | `Theme.fg`가 `\x1b[39m`로만 닫음(`theme.js:246`), 트리가 라인 단위 diff이므로 각 라인이 자체적으로 완결 |

문서가 말하는 것과 코드가 하는 것이 불일치하는 지점은 발견하지 못했다. 다만 문서는 의도를 서술할 뿐 수치·알고리즘(16ms, 6x6x6 큐브 근사, 100ms 디바운스)은 전부 코드에만 있다.

---

## 5. Loop packages/presentation 적용 제언

pi의 구조를 Loop의 경계(`loop-core → loop-store → loop-bridge → … → packages/presentation`)에 대입하면:

1. **역할 기반 시맨틱 팔레트를 타입으로 밀봉** — `ThemeColor` 유니언 + 알 수 없는 키 throw + required-colors가 강제된 완전 팔레트(플랫폼별 폴백 테이블 포함). Loop의 presentation 계약이 "hex 문자열"이 아니라 "역할"이면 어댑터/UI에서 색 창작이 사라진다.
2. **렌더 계약 `render(width) → lines[]` + invalidate 캐시 + 단일 requestRender 스로틀** — 컴포넌트 간 렌더 방식이 강제로 수렴하며, 상태 표시(스피너·푸터)도 같은 루프를 탄다.
3. **레이아웃 슬롯 한 곳 선언(chat-viewport 35줄) + 상태 = 슬롯 내 컴포넌트 교체** — 화면 구조 편차가 구조적으로 불가능하고, 상태 종류(kind)별 소유권으로 인디케이터 충돌을 막는다.
4. 보너스: 상태→색 대응(thinking 7단계, 컨텍스트 70/90% 임계)을 코드 분기가 아니라 **테마 데이터(역할 이름)에 선언**. Loop의 Rust 코어 정책 결정론 원칙과 상통한다 — 상태 등급은 결정적 정책이고, 색 대응은 프레젠테이션 데이터다.

주의할 점: pi는 전역 싱글톤 `theme`(globalThis Proxy)로 통일성을 얻는데, Loop에서는 TS 어댑터가 얇아야 한다는 AGENTS.md 경계와 충돌할 수 있다. 대안은 (a) 전역 싱글톤 도입(가장 단순, pi 방식) vs (b) 렌더 컨텍스트로 테마를 명시 주입(경계 위반 없음, 다만 모든 컴포넌트 시그니처에 테마가 흐른다). pi 증거상 (b)도 실현 가능함을 `Loader`가 시사한다 — `Loader`는 전역 theme을 모르고 `spinnerColorFn/messageColorFn`을 주입받는다(프리미티브 레이어와 앱 레이어의 색 주입 방식이 다르다). 즉 **프리미티브는 색 함수 주입, 앱 컴포넌트는 전역 역할 팔레트**라는 pi의 2층 접근이 Loop의 계층 구조와 더 잘 맞는다.

---

## 부록: 조사 파일 목록

| 파일 | 규모 | 내용 |
|---|---|---|
| `.research-sources/pi-coding-agent/dist/modes/interactive/theme/theme.js` | 990 lines | 색 유틸·Theme 클래스·로딩·핫리로드·전역 인스턴스·파생 테마 헬퍼 |
| `dist/modes/interactive/theme/theme.d.ts` | 178 lines | ThemeColor/ThemeBg 유니언, 공개 API |
| `dist/modes/interactive/theme/dark.json` / `light.json` | 91/90 lines | 빌트인 팔레트 (vars+colors+export) |
| `dist/modes/interactive/theme/theme-schema.json` | 356 lines | required colors 검증 스키마 |
| `dist/modes/interactive/theme/theme-controller.js` | 129 lines | 라이트/다크 자동 동기화 컨트롤러 |
| `dist/modes/interactive/components/status-indicator.js` | 88 lines | 스피너 상태 4종 + IdleStatus |
| `dist/modes/interactive/components/footer.js` | 224 lines | 상태줄(토큰/컨텍스트/모델) |
| `dist/modes/interactive/components/{user,assistant}-message.js` | 48/157 lines | 메시지 컴포넌트 (Box bgFn, OSC133 존) |
| `dist/modes/interactive/components/tool-execution.js` | 336 lines | 툴 상태 배경/펼침/렌더러 위임 |
| `dist/modes/interactive/components/custom-editor.js` | — | 에디터 테두리 상태 렌더 |
| `dist/modes/interactive/chat-viewport.js` | 35 lines | 화면 레이아웃 슬롯 선언 |
| `dist/modes/interactive/tui-renderer.js` | 56 lines | TuiMainScreen/TuiAltScreen 선택·주입 |
| `dist/modes/interactive/interactive-mode.js` | 5751 lines | 전체 조립 (5751줄 중 테마/상태/레이아웃 관련부 발췌) |
| `node_modules/@earendil-works/pi-tui/dist/tui.d.ts` / `tui.js` | 419/838+ lines | Component 계약, 포커스·오버레이, 렌더 스로틀 |
| `node_modules/@earendil-works/pi-tui/dist/tui-main-screen.js` | ~560 lines | 라인 diff 차분 렌더 |
| `node_modules/@earendil-works/pi-tui/dist/components/{text,box,loader}.js` | 90/133/96 lines | 캐시·배경·스피너 프리미티브 |
| `docs/themes.md` / `docs/tui.md` | 110/107 lines | 공식 문서 (코드와 교차 검증 완료, §4.5) |
