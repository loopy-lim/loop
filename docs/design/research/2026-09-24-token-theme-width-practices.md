# 디자인 토큰·테마·터미널 폭 정책 운용 관행 조사 — D-5·D-6 근거

- **일자:** 2026-09-24 KST
- **종류:** `research` (`survey-token-theme-workflows`, attempt 0)
- **읽기 범위:** `docs/design/design.md`, `docs/design/research/design-md-practices.md`, `docs/design/research/design-system-practices.md`
- **쓰기 범위:** 이 문서만
- **조사 범위:** 선행 조사에서 다룬 Primer·Polaris·Ink·Ratatui·Lipgloss 및 pi·opencode·gemini-cli·aider·crush·claude-code를 반복하지 않고, DTCG 2025.10의 최신 상태, Style Dictionary, Fluent 2, GitHub CLI/go-gh, Bubble Tea를 조사했다.
- **증거 경계:** 공식 스펙·공식 문서·공식 저장소 소스만 사용했다. 부록 A의 12개 출처를 원문 기준으로 대조했다.

---

## 0. 결과 요약

**조사한 1차 출처: 12개.**

- **D-5 — 조건부:** 폭 관찰→순수 정책→렌더러 입력의 세 경계를 지금 설계 원칙으로 고정하되, 구현은 좁은 터미널에서 P3-2가 재현되거나 잘림/랩 관찰 증거가 생길 때 착수한다. `lineTextLimit`은 설정 상한이며 실제값은 터미널 폭과 장식 예산을 반영한 유효 상한이어야 한다.
- **D-6 — 연기:** DTCG 2025.10은 안정된 Final Community Group Report여서 포맷 불안정성은 더 이상 핵심 연기 사유가 아니지만, Loop에는 아직 다중 테마·다중 배포 타깃이 없다. 현재는 타입 있는 역할 상수를 유지하고, 두 번째 런타임 테마 또는 둘 이상의 생성 소비자/언어가 생길 때 JSON 원본+생성 체인을 결정한다.

**파일:** `docs/design/research/2026-09-24-token-theme-width-practices.md`

## 1. 조사 질문과 판정 기준

두 보류 결정을 다음 질문으로 나누었다.

1. **D-5:** 누가 터미널 폭을 관찰하고, 누가 설정값과 결합해 출력 상한을 결정하며, 렌더러에는 무엇을 넘기는가?
2. **D-6:** 산업 사례는 언제 코드 상수에서 교환 포맷·생성 체인으로 넘어가는가? 라이트/다크 전환은 원본 복제인가, 역할 매핑 교체인가?
3. **도입 트리거:** Loop의 현재 단일 TS presentation 소비자와 단일 테마에서 추가 복잡성을 정당화할 관찰 가능한 사건은 무엇인가?

판정 시 다음 경계를 유지했다.

```text
환경 관찰(adapter/CLI) → 결정론적 폭 정책(existing policy owner) → 유효 한도(renderer input)
토큰 원본(source) → 검증·변환(build) → 생성물(runtime consumers)
```

터미널 크기 조회를 렌더러에 숨기면 동일 입력의 출력이 환경에 따라 달라지고 테스트가 어려워진다. 반대로 렌더러가 원시 터미널 폭을 직접 정책으로 해석하면 여백·접두사·최소 가독 폭 같은 운영 결정이 표현 계층에 샌다. 조사 사례는 두 책임을 분리하거나, 적어도 명시적인 폭 입력을 렌더러에 전달한다.

## 2. DTCG/W3C Design Tokens 스펙 현황

### 2.1 2025.10은 안정판이지만 W3C 표준은 아니다

Design Tokens Community Group의 2025.10 기술 보고서는 2025-10-28자 **Final Community Group Report**다. 상태 절은 동시에 다음 두 사실을 명시한다.

- 이 문서는 Design Tokens Community Group의 산출물이며 **W3C Standard도 W3C Recommendation도 아니다**.
- 분류상 **stable**로 간주하며, 이후 변경은 호환성을 보존하는 수정으로 제한한다.

따라서 선행 문서 `design-system-practices.md`의 “CG Draft, not a W3C Standard” 중 후반은 여전히 맞지만, 최신 상태는 단순 초안이 아니라 **안정된 최종 Community Group 보고서**로 갱신해야 한다. D-6에서 “포맷이 아직 흔들린다”는 연기 근거는 약해졌다. 다만 W3C Recommendation과 같은 표준 지위를 전제해서도 안 된다.[S1][S2]

### 2.2 포맷과 테마 해석이 별도 모듈이다

2025.10은 적어도 두 관심사를 구분한다.

- **Format Module:** JSON 문서 안에서 토큰·그룹·`$value`·`$type`·별칭과 그룹 상속(`$extends`)을 표현한다.[S2]
- **Resolver Module:** theme(light/dark/high contrast), platform, accessibility 같은 modifier와 context를 입력받아 어떤 토큰 파일들을 어떤 순서로 합칠지 기술한다. 공식 예시는 `theme/light.json`, `theme/dark.json`, `theme/dark-high-contrast.json`을 context에 따라 선택한다.[S3]

이 분리는 중요하다. `$value/$type` JSON을 채택하는 것과 런타임 다중 테마를 지원하는 것은 같은 결정이 아니다. 후자는 다음 운영 표면을 추가한다.

1. theme context의 원천(OS 감지, 사용자 설정, 명시 플래그),
2. context 검증과 기본값,
3. 파일 조합·우선순위,
4. 각 permutation의 생성 및 테스트.

Resolver 문서는 modifier가 2×2×…로 늘면 permutation 수도 곱셈으로 늘어난다고 설명한다. 단일 테마인 Loop에 resolver 계층을 먼저 만들면 실제 변형 없이 조합기와 테스트 행렬만 생긴다.[S3]

### 2.3 D-6에 주는 시사점

- **포맷 선택 위험은 낮아졌다:** 나중에 교환 포맷이 필요할 때 2025.10 `$value/$type` JSON을 기본 후보로 삼을 근거가 충분하다.
- **그러나 지금 채택할 이유는 별개다:** 표준의 안정성은 “써도 되는가”에 답할 뿐 “변환 체인이 필요한가”에는 답하지 않는다.
- **트리거를 넓혀야 한다:** 기존 D-6의 “Rust/TS 공유 필요” 외에도 (a) 두 번째 테마, (b) Figma/문서/웹 등 코드 밖 소비자, (c) 둘 이상의 생성 타깃이 실제로 생길 때가 포맷 승격 후보 시점이다.

## 3. 단일 원천→배포 체인: Style Dictionary

Style Dictionary의 공식 설정 문서는 전형적인 토큰 배포 체인을 명시적으로 드러낸다.[S4][S5]

```text
tokens/**/*.json|json5|js|ts
  → parser / preprocessor
  → platform별 transform 또는 transformGroup
  → filter + format
  → destination 생성 파일(CSS 변수, JS 등)
  → build 후 action(복사 등)
```

핵심 운용 관행은 다음과 같다.

1. **원본과 생성물을 구분한다.** `source` glob이 토큰 파일의 단일 입력이고, `platforms.*.files[].destination`은 생성 대상이다. 생성 파일에는 기본적으로 “Do not edit” 헤더를 붙일 수 있다.
2. **플랫폼별 표현만 변환한다.** transform은 토큰을 비파괴적으로 플랫폼 표현에 맞추고, format이 파일 문법을 결정한다. 원본 의미를 CSS/JS/Rust마다 수작업 복사하지 않는다.
3. **포맷 전환 경로가 있다.** 설정의 `usesDtcg`는 DTCG 포맷을 나타내며 보통 자동 감지된다. 즉 기존 상수에서 DTCG로 승격할 때도 소비자 API를 한 번에 바꾸기보다 생성물을 기존 인터페이스 모양으로 내보낼 수 있다.
4. **입력 포맷의 유연성과 교환 포맷은 다르다.** Style Dictionary는 JSON뿐 아니라 JSON5·ESM·일부 TS도 입력으로 받는다. 내부 전용이면 TS가 더 단순할 수 있고, 도구 간 교환이 목적일 때 DTCG JSON의 가치가 커진다.

### D-6 시사점

Loop가 지금 Style Dictionary류를 도입하면 `tokens source → config → generated TS → package export → codegen check`라는 새 빌드 면을 유지해야 한다. 현재 소비자가 `@loop/presentation` 하나라면 직접 타입 상수가 이미 단일 원천이므로 생성 단계가 가치를 더하지 않는다. 반대로 **같은 역할 이름을 TS와 Rust, 또는 CLI와 외부 문서/디자인 도구에 각각 손으로 복사하기 시작하는 순간** 생성 체인의 비용보다 드리프트 비용이 커진다. 그 첫 수작업 복제를 D-6 재질의 신호로 삼는 것이 적절하다.

## 4. 글로벌/시맨틱 토큰과 라이트·다크 전환: Fluent 2

### 4.1 두 계층: global → alias

Fluent 2 공식 디자인 토큰 문서는 두 계층을 정의한다.[S6]

- **Global tokens:** hex 색, typography, radius, stroke, animation처럼 문맥 없는 원시값.
- **Alias tokens:** 용도를 이름에 담은 시맨틱 값. 정확한 값 대신 어디에 적용할지 드러낸다.

문서는 토큰 체계가 OS의 light/dark/high-contrast와 brand 변형을 지원한다고 설명한다. 여기서 테마 전환의 안정된 API는 원시 팔레트가 아니라 alias 역할 이름이다.

### 4.2 소스 구현: 동일한 `Theme` shape, 다른 생성 함수

Fluent UI 저장소의 `createLightTheme`와 `createDarkTheme`는 같은 `BrandVariants` 입력과 같은 `Theme` 반환형을 사용한다. 두 함수 모두 global typography/spacing/radius/motion 값을 합치고, 각각 light/dark alias color 생성기와 palette/status 토큰을 합친다.[S7][S8]

`FluentProvider`는 부모 테마와 로컬 테마를 얕게 병합하고, 합쳐진 theme을 style tag와 context로 하위 컴포넌트에 전달한다.[S9] 데이터 흐름은 다음과 같다.

```text
brand ramp + global constants
  → createLightTheme | createDarkTheme
  → 동일 Theme 역할 맵
  → Provider에서 선택·부분 override
  → 컴포넌트는 역할 키만 소비
```

중요한 점은 “dark일 때 각 컴포넌트가 색을 고른다”가 아니라 **테마 생성 단계가 같은 역할 키에 다른 값을 매핑**한다는 것이다.

### D-6 시사점

- Loop가 라이트/다크를 도입하더라도 첫 단계부터 DTCG JSON이 필수는 아니다. `Theme` 타입과 `createDarkTheme`/`createLightTheme` 같은 **동일 shape의 타입 객체**로 먼저 검증할 수 있다.
- 다중 테마의 최소 트리거는 “두 번째 값 파일을 만들고 싶다”가 아니라 **실제 배경 감지/사용자 선택 요구와 두 역할 맵을 검증할 테스트가 함께 생겼는가**다.
- 테마가 생기면 소비자 분기를 금지하고, 환경 선택은 presentation 진입점 한 곳에서 `Theme` 객체 선택으로 끝내야 한다.

## 5. 토큰 파일 없이 역할 API만 운용: GitHub CLI

GitHub CLI는 대형 디자인 토큰 원본이나 생성 체인 없이 `pkg/iostreams/color.go`의 작은 `ColorScheme` API로 터미널 표현을 중앙화한다.[S10]

- 능력/환경 값: `Enabled`, `EightBitColor`, `TrueColor`, `Accessible`, `Theme`.
- 역할 API: `Muted`, `SuccessIcon`, `WarningIcon`, `FailureIcon`, `TableHeader`.
- light/dark 차이: `Muted`와 `TableHeader`가 `Theme`에 따라 내부 구현을 고르며 호출자는 분기하지 않는다.
- 물리 색 API도 남아 있지만 `Gray`는 “thematically contrasting color”인 `Muted` 사용을 권하며 deprecated 처리돼, 물리 색에서 역할 언어로 점진 이동한다.

이 사례는 “소규모 표면에서 토큰 포맷 없이 역할 상수/헬퍼만 둔다”는 운용 방식의 구체적 선례다. 완전한 디자인 시스템은 아니지만 CLI가 필요로 하는 성공·경고·실패·muted·header와 환경 가드를 한 타입에 모은다.

### D-6 시사점

- Loop의 현재 제안인 `ColorRole` 폐쇄 집합+presentation 상수는 임시방편이 아니라 검증된 소규모 CLI 패턴이다.
- 하나의 역할 API 안에서도 light/dark 전환을 추가할 수 있으므로, **다중 테마 자체가 곧 JSON 코드젠의 필수 조건은 아니다**.
- 다만 GitHub CLI 소스에는 물리 색 메서드와 역할 메서드가 공존한다. Loop는 처음부터 호출점에 물리 색을 공개하지 않고 역할만 노출하면 더 작은 API를 유지할 수 있다.

## 6. 터미널 폭 사례 1: GitHub CLI/go-gh 테이블

GitHub CLI의 테이블 경로는 폭 관찰→정책→렌더러 전달을 파일 경계로 보여준다.[S11][S12]

### 6.1 데이터 흐름

```text
IOStreams.TerminalWidth()
  └─ terminal Size() 관찰, 실패/0이면 DefaultWidth
      → cli/internal/tableprinter.New()
         └─ 비-TTY 기본 maxWidth=80, TTY면 관찰 폭 사용
             → go-gh tableprinter.New(writer, isTTY, maxWidth)
                └─ calculateColumnWidths(maxWidth)
                   → display width 기준 열 배분
                   → 각 필드 truncate → pad → color → write
```

구체적으로 GitHub CLI wrapper는 비-TTY 기본 `maxWidth=80`을 두고, stdout이 TTY일 때만 `ios.TerminalWidth()`로 바꾼다. 별도 `go-gh` 렌더러는 `maxWidth`를 생성자 입력으로 받고, 구분자 폭과 고정 열 폭을 뺀 가용 폭을 유연 열에 배분한 후 잘라낸다. 비-TTY에서는 아예 TSV renderer를 선택해 색과 truncation을 끈다.

### 6.2 설계상 의미

1. **관찰자는 IO 어댑터다.** table renderer는 terminal API를 호출하지 않는다.
2. **폴백은 관찰 경계에 있다.** 크기 조회 실패가 렌더러 예외로 새지 않는다.
3. **정책은 원시 폭과 동일하지 않다.** delimiter와 고정 열을 제외한 가용 폭을 계산한다.
4. **문자 수가 아니라 display width다.** ANSI 적용 전에 자르고, 화면 폭 측정 함수를 쓴다.
5. **비-TTY 정책은 별도다.** 파이프 출력까지 사람용 terminal width로 자르지 않는다.

### D-5 시사점

Loop도 `process.stdout.columns` 같은 관찰값을 presentation 내부에서 직접 읽지 말아야 한다. CLI가 `isTty`와 `terminalWidth?: number`를 관찰하고, 정책이 이를 `lineTextLimit`과 합쳐 **유효 grapheme/display-cell 상한**을 만든 뒤 렌더러에 숫자로 넘기는 구조가 적합하다. 비-TTY는 현재 설정 상한을 유지할지 무제한으로 둘지 별도 결정해야 하며, GitHub CLI처럼 TTY와 파이프를 명시적으로 나누는 것이 안전하다.

## 7. 터미널 폭 사례 2: Bubble Tea pager

Bubble Tea는 resize를 일회성 조회가 아니라 메시지로 모델에 전달한다. 코어 프로그램은 `WindowSizeMsg`를 받으면 renderer 크기를 갱신하고 그 메시지를 모델의 `Update`에도 전달한 뒤 `model.View()`를 renderer에 보낸다.[S12]

공식 pager 예제는 이 관찰값을 다음과 같이 정책화한다.[S12]

```text
terminal resize
  → WindowSizeMsg { Width, Height }
  → Update:
      contentWidth = msg.Width
      contentHeight = msg.Height - headerHeight - footerHeight
      viewport.SetWidth/SetHeight
  → View:
      header/footer는 viewport.Width()에서 장식 폭을 뺀 길이로 생성
      viewport.View() 렌더
```

초기 크기가 비동기로 도착하므로 예제는 첫 `WindowSizeMsg` 전에는 viewport를 초기화하지 않고 “Initializing...”을 렌더한다. 이후 resize마다 viewport의 폭·높이를 갱신한다. header/footer도 고정 숫자가 아니라 현재 viewport 폭에서 제목/정보의 display width를 뺀 만큼 선을 반복한다.

### D-5 시사점

- watch처럼 장수하는 Loop 출력은 시작 시 `columns` 한 번만 읽는 것보다 resize 이벤트를 받을 수 있는지 별도로 판단해야 한다.
- 다만 Loop는 full-screen TUI가 아니므로 Bubble Tea의 전체 event loop를 이식할 이유는 없다. **첫 렌더마다/갱신 주기마다 CLI가 폭을 재관찰해 유효 한도를 주입**하는 더 단순한 방식부터 시작할 수 있다.
- 접두사와 들여쓰기 폭을 빼는 정책이 필요하다. 전역 `lineTextLimit=160`을 `min(160, terminalWidth)`로만 바꾸면 상태 글리프·공백·라벨 때문에 여전히 wrap될 수 있다.

## 8. 사례 비교와 Loop용 경계

| 사례 | 원천/관찰 | 정책 | 렌더러 입력/소비 | D-5·D-6 교훈 |
| --- | --- | --- | --- | --- |
| DTCG 2025.10 | DTCG JSON + resolver input | modifier/context별 파일 조합 | resolved token set | 포맷은 안정됐지만 theme resolver는 실제 변형이 있을 때만 가치 |
| Style Dictionary | source token files | platform transform/filter/format | 생성 파일 | 둘 이상의 생성 타깃에서 단일 원천의 이득 발생 |
| Fluent 2 | global 값+brand ramp | light/dark alias 생성 | 동일 `Theme` shape | 소비자는 역할만 알고 테마 선택은 provider 경계에서 수행 |
| GitHub CLI 색 | `ColorScheme` 능력·Theme | 역할 helper 내부 선택 | 포맷터가 helper 호출 | 작은 CLI는 JSON 없이 타입/역할 API로 충분 |
| GitHub CLI 테이블 | IOStreams terminal size/TTY | fallback, TTY 분기, 열 가용 폭 배분 | `maxWidth` 생성자 인자 | 관찰과 렌더 분리, 파이프 정책 별도 |
| Bubble Tea pager | `WindowSizeMsg` | header/footer 차감, viewport 크기 갱신 | viewport width/height | 장수 화면은 resize 재관찰, 장식 폭 차감 |

Loop에 맞는 최소 데이터 흐름은 다음이다.

```text
CLI 환경 관찰
  { isTty, terminalColumns? }
      ↓
기존 출력 정책의 순수 파생
  configuredLimit = policy.toml output.lineTextLimit
  effectiveLimit = f(configuredLimit, terminalColumns, reservedColumns, minimumReadableWidth)
      ↓
presentation renderer
  render(input, { lineTextLimit: effectiveLimit, ...otherLimits })
      ↓
stdout
```

- **관찰 소유:** `packages/cli` 어댑터. OS/TTY API 의존은 여기서 끝낸다.
- **정책 소유:** 기존 `policy.toml → orchestrator config → renderer parameter` 흐름을 유지한다. 폭 파생은 결정론적 순수 함수여야 하며 `loop-core`에 터미널 개념을 넣지 않는다.
- **렌더 소유:** `packages/presentation`. 원시 terminal 객체가 아니라 계산된 limit만 받는다.
- **측정 단위:** 현재 계약과 같은 grapheme 기준을 유지할지 terminal cell width로 바꿀지 D-5 결정에서 명시해야 한다. GitHub CLI 사례는 실제 fit 보장에는 display width가 필요함을 보여준다. CJK/emoji에서 grapheme 수와 cell 폭은 다를 수 있다.

## 9. 트리거와 완료 조건

### 9.1 D-5 재질의 트리거

다음 중 하나가 관찰되면 구현 태스크를 연다.

1. 80/100/120열 중 하나에서 status·attention·findings 줄이 의도치 않게 wrap되거나 핵심 suffix가 보이지 않는다.
2. watch 출력의 resize 후에도 이전 폭 기준 잘림이 지속된다.
3. 사용자 이슈 또는 캡처에서 P3-2가 체감 문제로 재확인된다.

구현 전 결정해야 할 항목:

- `effectiveLimit = min(configuredLimit, availableWidth)`에서 `availableWidth`의 접두사/들여쓰기 예산,
- 최소 가독 폭보다 좁을 때 wrap/더 강한 truncate/현행 유지 중 어느 폴백인지,
- 비-TTY는 설정 상한 유지인지 폭 제한 해제인지,
- grapheme와 display-cell 중 어느 단위를 계약으로 삼는지,
- watch 중 resize 재관찰 주기.

최소 검증 행렬은 `isTty × width(unknown, 40, 80, 200) × prefix width × CJK/emoji`다. 터미널 폭 관찰 함수는 모의 가능해야 하고, renderer 테스트는 환경과 무관하게 명시적 숫자를 받아야 한다.

### 9.2 D-6 재질의 트리거

다음 중 하나가 생기면 DTCG JSON+생성 체인을 비교 결정한다.

1. 같은 역할 집합을 **TS와 Rust**가 공유해야 한다.
2. 코드 외 소비자(Figma 플러그인, 문서 사이트, 배포 테마 패키지)가 생긴다.
3. CSS/TS/Rust 등 **생성 타깃이 둘 이상**이 된다.
4. light/dark/high-contrast 중 두 개 이상을 실제 사용자 선택 또는 환경 감지로 제공하고, 역할 맵 복제가 드리프트하기 시작한다.
5. 역할 상수의 수작업 복사 또는 이름 불일치가 첫 번째로 발견된다.

승격 시 권고 순서:

1. 현재 역할 API와 이름을 먼저 안정화한다.
2. DTCG 2025.10 JSON을 원본 후보로 하고 schema validation을 추가한다.
3. 생성된 TS가 기존 presentation 인터페이스를 그대로 제공하게 해 호출점 변경을 피한다.
4. Rust 소비가 실제로 필요하면 저장소 경계에 맞게 Rust bridge 타입을 먼저 변경하고 `bun run codegen`을 사용한다. TS가 Rust 도메인 타입을 손으로 복제하지 않는다.
5. light/dark가 필요하면 resolver 또는 더 단순한 typed theme factory 중 작은 쪽을 선택한다. modifier 조합이 하나뿐이면 resolver를 도입하지 않는다.

## 10. 결론과 권고

### D-5 — **조건부(설계 원칙은 지금, 구현은 관찰 트리거 후)**

GitHub CLI와 Bubble Tea 모두 원시 터미널 폭을 렌더 함수가 몰래 읽게 하지 않는다. 환경/이벤트 계층이 폭을 관찰하고, 가용 영역 정책을 적용한 뒤 renderer/viewport에 명시적으로 전달한다. 따라서 Loop는 D-5의 구현을 계속 연기하되 다음 구조를 결정문에 미리 고정하는 것이 좋다.

- CLI가 TTY·폭을 관찰한다.
- 기존 출력 정책 소유자가 configured limit과 장식 폭을 결합해 effective limit을 계산한다.
- presentation은 effective limit만 입력받는다.
- 비-TTY와 관찰 실패는 명시적인 폴백을 갖는다.

착수 조건은 현재 `design.md`의 “P3-2가 체감 문제로 재확인”을 유지하되, §9.1의 80/100/120열 관찰과 watch resize를 재현 가능한 증거로 구체화한다. 이는 불필요한 선제 구현을 피하면서도 착수 후 경계 논쟁을 줄인다.

### D-6 — **연기(트리거 확대)**

DTCG 2025.10이 stable Final Community Group Report가 되었으므로 “스펙이 초안이라서” 연기할 이유는 사라졌다. 그러나 Style Dictionary가 보여주는 원본→변환→생성물 체인은 다중 소비자에서만 비용을 회수하며, Fluent와 GitHub CLI는 각각 typed theme object와 작은 역할 API로도 light/dark 및 의미 기반 스타일을 운영할 수 있음을 보여준다.

따라서 지금은 `@loop/presentation`의 폐쇄된 역할 상수/타입을 단일 원천으로 유지한다. 기존 트리거인 Rust/TS 공유에 더해 **두 번째 생성 타깃, 코드 외 소비자, 실제 다중 테마, 첫 수작업 드리프트**를 재질의 조건으로 기록한다. 트리거가 오면 DTCG 2025.10 JSON을 기본 교환 포맷 후보로 삼되, 다중 테마만 필요한 경우에는 먼저 동일 shape의 typed theme factory가 더 작은 대안인지 비교한다.

## 11. 미해결 위험

- **문자 폭 단위:** 현재 `lineTextLimit`은 grapheme 계약이다. 실제 terminal fit은 display cell 폭과 다르므로 D-5에서 호환성 변경 여부를 분리 결정해야 한다.
- **resize 비용:** 매 watch tick의 크기 조회가 충분히 싸더라도 테스트 가능한 관찰 인터페이스가 없으면 CLI가 다시 환경 결합된다. 이벤트 구독보다 단순 재조회가 적절한지는 현재 watch 주기와 플랫폼 지원을 확인해야 한다.
- **DTCG 도구 호환성:** 스펙 자체는 stable이지만 Community Group Report이고, 모든 도구가 Resolver Module 전체를 구현한다고 가정할 수 없다. 승격 때 실제 선택 도구의 2025.10 format/resolver 지원 범위를 검증해야 한다.
- **테마 조합 폭증:** light/dark 뒤에 high-contrast·accessible variants를 더하면 permutation 테스트가 곱셈으로 늘어난다. 사용자 요구 없는 축을 미리 만들지 않는다.

---

## 부록 A. 1차 출처 12개

| # | 출처 | 확인한 내용 | URL |
| --- | --- | --- | --- |
| S1 | Design Tokens Technical Reports 2025.10 | Final CG Report, stable, not W3C Standard/Recommendation | https://www.designtokens.org/TR/2025.10/ |
| S2 | DTCG Format Module 2025.10 | `$value`, `$type`, aliases, groups, `$extends`, JSON format | https://www.designtokens.org/TR/2025.10/format/ |
| S3 | DTCG Resolver Module 2025.10 | modifier/context, light/dark/high-contrast 파일 조합, permutation | https://www.designtokens.org/TR/2025.10/resolver/ |
| S4 | Style Dictionary — Design Tokens | 토큰 입력 모델과 DTCG 지원 개요 | https://styledictionary.com/info/tokens/ |
| S5 | Style Dictionary — Configuration | source/include, platform, transform, format, destination, `usesDtcg` | https://styledictionary.com/reference/config/ |
| S6 | Fluent 2 — Design tokens | global/alias 두 계층, light/dark/high-contrast/brand 지원 | https://fluent2.microsoft.design/design-tokens |
| S7 | Fluent UI `createLightTheme.ts` / `createDarkTheme.ts` | global+alias 조합, 같은 `Theme` 반환형 | https://github.com/microsoft/fluentui/tree/master/packages/tokens/src/utils |
| S8 | Fluent UI `useFluentProvider.ts` | 부모/로컬 theme 병합과 provider 전달 | https://github.com/microsoft/fluentui/blob/master/packages/react-components/react-provider/library/src/components/FluentProvider/useFluentProvider.ts |
| S9 | GitHub CLI `pkg/iostreams/color.go` | 작은 `ColorScheme`, 역할 helper, light/dark muted/header | https://github.com/cli/cli/blob/trunk/pkg/iostreams/color.go |
| S10 | GitHub CLI `pkg/iostreams/iostreams.go`, `internal/tableprinter/table_printer.go` | terminal width 관찰·fallback, TTY 분기, renderer로 `maxWidth` 전달 | https://github.com/cli/cli/blob/trunk/pkg/iostreams/iostreams.go ; https://github.com/cli/cli/blob/trunk/internal/tableprinter/table_printer.go |
| S11 | go-gh `pkg/tableprinter/table.go` | 명시적 `maxWidth`, display width 열 배분, truncate/pad/color 순서 | https://github.com/cli/go-gh/blob/trunk/pkg/tableprinter/table.go |
| S12 | Bubble Tea core `tea.go` 및 pager 예제 | `WindowSizeMsg` 전달, viewport 크기 정책, resize 갱신 | https://github.com/charmbracelet/bubbletea/blob/main/tea.go ; https://github.com/charmbracelet/bubbletea/blob/main/examples/pager/main.go |

> 출처 수는 표의 독립 조사 단위 기준 12개다. 한 행에서 같은 저장소의 밀접한 소스 두 파일을 함께 인용한 경우도 하나의 사례 단위로 셌다.

## 부록 B. 완료 확인

```bash
test -s docs/design/research/2026-09-24-token-theme-width-practices.md \
  && grep -q 'D-5' docs/design/research/2026-09-24-token-theme-width-practices.md \
  && grep -q 'D-6' docs/design/research/2026-09-24-token-theme-width-practices.md
```
