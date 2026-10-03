# Google Stitch DESIGN.md 스펙과 터미널 계열 사례 연구

- **일자:** 2026-09-24 KST
- **태스크:** `study-stitch-design-md` (`research`, attempt 0)
- **쓰기 범위:** 이 문서만
- **조사 대상:** Google Stitch 공식 문서 3건, `VoltAgent/awesome-design-md`의 DESIGN.md 원문 3건(Ollama, OpenCode, VoltAgent)
- **수집 방법:** `curl`로 공식 문서의 Markdown 응답과 GitHub raw 원문을 직접 내려받아 비교했다. 예시 3건은 getdesign.md 배포본도 내려받아 원문 접근 경로를 확인했다.

> **동명 문서 주의:** 이 문서에서 연구하는 Stitch식 `DESIGN.md`는 에이전트가 반복 소비하는 **비주얼 디자인 언어의 현재 정본(living artifact)** 이다. Loop의 기존 [`docs/design/design.md`](../design.md)는 EARS 요구사항, 기술 설계, 태스크 역추적, 승인 게이트를 담는 **변경 설계 문서**다. 전자는 제품 표면의 “어떻게 보여야 하는가”를 지속적으로 설명하고, 후자는 특정 변경의 “왜/무엇을/어떻게 구현하고 검증할 것인가”를 승인 시점에 고정한다. 이름이 같아도 역할과 수명주기를 합치면 안 된다.

## 1. 조사 범위와 출처 신뢰 경계

### 1.1 1차 출처

| 구분 | 출처 | 이 조사에서 확인한 내용 |
| --- | --- | --- |
| Stitch 공식 개요 | [What is DESIGN.md?](https://stitch.withgoogle.com/docs/design-md/overview/) ([직접 fetch한 Markdown 응답](https://app-companion-430619.appspot.com/docs/design-md/overview.md)) | 정의, 인간/에이전트 공동 소비, living artifact, YAML+Markdown 이중 구조 |
| Stitch 공식 규격 | [Specification](https://stitch.withgoogle.com/docs/design-md/specification/) ([직접 fetch한 Markdown 응답](https://app-companion-430619.appspot.com/docs/design-md/specification.md)) | 정식 섹션 순서, YAML 스키마, 타입과 참조 문법, 확장 처리 |
| Stitch 공식 CLI | [Validate with the CLI](https://stitch.withgoogle.com/docs/design-md/cli/) ([직접 fetch한 Markdown 응답](https://app-companion-430619.appspot.com/docs/design-md/cli.md)) | lint/diff/export, 에이전트 프롬프트용 spec 출력 |
| 큐레이션 목록 | [`VoltAgent/awesome-design-md` README](https://github.com/VoltAgent/awesome-design-md/blob/main/README.md) | 사례 선정 근거와 사용법 |
| Ollama 원문 | [`design-md/ollama/DESIGN.md`](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/ollama/DESIGN.md) ([raw](https://raw.githubusercontent.com/VoltAgent/awesome-design-md/main/design-md/ollama/DESIGN.md)) | terminal-first/monochrome 사례 |
| OpenCode 원문 | [`design-md/opencode.ai/DESIGN.md`](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/opencode.ai/DESIGN.md) ([raw](https://raw.githubusercontent.com/VoltAgent/awesome-design-md/main/design-md/opencode.ai/DESIGN.md)) | developer-centric/terminal-native 사례 |
| VoltAgent 원문 | [`design-md/voltagent/DESIGN.md`](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/voltagent/DESIGN.md) ([raw](https://raw.githubusercontent.com/VoltAgent/awesome-design-md/main/design-md/voltagent/DESIGN.md)) | agent framework/terminal-native dark 사례 |

### 1.2 해석 한계

- Google 문서는 규격의 1차 출처다. 반면 예시 3건은 각 제품 팀의 공식 디자인 시스템이 아니라 VoltAgent 팀이 공개 표면을 분석한 독립 큐레이션이다. getdesign.md도 “independent analysis”이며 해당 브랜드의 보증이 아니라고 밝힌다([Ollama 배포 페이지](https://getdesign.md/ollama/design-md), [OpenCode 배포 페이지](https://getdesign.md/opencode.ai/design-md), [VoltAgent 배포 페이지](https://getdesign.md/voltagent/design-md)). 따라서 **형식과 에이전트 소비 관행**을 비교하는 근거로 사용하되, 개별 제품의 공식 브랜드 규칙으로 간주하지 않는다.
- 세 문서는 웹 마케팅 표면을 중심으로 작성됐다. OpenCode 원문도 실제 전체 TUI는 captured set에 없다고 `Known Gaps`에서 명시한다([원문](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/opencode.ai/DESIGN.md#known-gaps)). Loop에 적용할 때 웹 breakpoint·카드 규칙을 그대로 복제하지 않고 CLI/TUI에 맞는 섹션만 남겨야 한다.

## 2. Stitch 공식 정의

Stitch는 DESIGN.md를 **인간과 에이전트가 읽고, 편집하고, 강제할 수 있는 plain-text design system document**로 정의하고 `AGENTS.md`의 디자인 대응물로 설명한다. `AGENTS.md`가 “어떻게 만들지”를 정한다면 `DESIGN.md`는 프로젝트가 “어떻게 보이고 느껴져야 하는지”를 정한다([공식 개요](https://stitch.withgoogle.com/docs/design-md/overview/)).

공식 정의의 핵심은 다음 네 가지다.

1. **일관성 입력:** 에이전트가 이후 화면을 생성할 때 palette, typography, component patterns를 반복 적용한다([공식 개요](https://stitch.withgoogle.com/docs/design-md/overview/)).
2. **living artifact:** 정적 설정 파일이 아니라 디자인과 함께 진화하고, 에이전트가 생성한 뒤 사람이 다듬고 반복 적용하는 문서다([공식 개요](https://stitch.withgoogle.com/docs/design-md/overview/)).
3. **두 계층:** YAML front matter는 정확한 값의 machine-readable token, Markdown 본문은 적용 이유와 맥락을 제공한다. 공식 규격은 **토큰 값을 normative**, prose를 적용 맥락으로 둔다([공식 규격](https://stitch.withgoogle.com/docs/design-md/specification/)).
4. **개방형 기반:** 규격은 prescription이 아니라 foundation이다. 알려지지 않은 섹션과 custom token을 보존하며 도메인 확장을 허용한다([공식 개요](https://stitch.withgoogle.com/docs/design-md/overview/), [unknown content 규칙](https://stitch.withgoogle.com/docs/design-md/specification/#consumer-behavior-for-unknown-content)).

## 3. 공식 형식

### 3.1 권장 섹션 골격

공식 규격은 존재하는 섹션을 아래 순서의 `##` heading으로 두도록 한다. 관련 없는 섹션은 생략할 수 있고, 도메인 전용 섹션을 추가할 수 있다([공식 규격: Sections](https://stitch.withgoogle.com/docs/design-md/specification/#sections)).

| 순서 | 정식 섹션 | 목적 |
| --- | --- | --- |
| 1 | `Overview` (`Brand & Style`) | 전체 분위기, 대상 사용자, 유도할 정서와 미정의 상황의 판단 기준 |
| 2 | `Colors` | 팔레트와 각 색의 기능적 역할 |
| 3 | `Typography` | 글꼴, 크기, weight, line-height, semantic role |
| 4 | `Layout` (`Layout & Spacing`) | grid, containment, spacing scale과 리듬 |
| 5 | `Elevation & Depth` (`Elevation`) | shadow 또는 border/tonal layer 같은 깊이 표현 |
| 6 | `Shapes` | radius, edge treatment, 전반적 shape language |
| 7 | `Components` | button/input/card 등 atom과 상태 variant의 스타일 |
| 8 | `Do's and Don'ts` | 생성 시 지켜야 할 guardrail과 anti-pattern |

출처: [Stitch DESIGN.md specification — Section order](https://stitch.withgoogle.com/docs/design-md/specification/#section-order).

### 3.2 토큰 스키마와 표기

YAML front matter는 정확히 `---`인 두 줄 사이에 위치한다. 최상위 공통 그룹은 `version`, `name`, optional `description`, `colors`, `typography`, `rounded`, `spacing`, `components`다([공식 규격: Design tokens/Schema](https://stitch.withgoogle.com/docs/design-md/specification/#design-tokens)).

```yaml
---
version: alpha
name: Example
colors:
  primary: "#1A1C1E"
typography:
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.6
rounded:
  md: 8px
spacing:
  md: 16px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    typography: "{typography.body-md}"
    rounded: "{rounded.md}"
---
```

공식 타입·참조 규칙은 다음과 같다([공식 규격: Token types](https://stitch.withgoogle.com/docs/design-md/specification/#token-types), [Token references](https://stitch.withgoogle.com/docs/design-md/specification/#token-references)).

- 색: quoted sRGB hex, 예: `"#1A1C1E"`.
- dimension: 숫자+단위, 예: `48px`, `-0.02em`; spacing에는 unitless 값도 허용한다.
- typography: `fontFamily`, `fontSize`, `fontWeight`, `lineHeight`, `letterSpacing` 등의 composite object. `lineHeight`는 unitless multiplier가 권장된다.
- 참조: 중괄호 object path인 `"{colors.primary}"`, `"{rounded.md}"`. 보통 primitive를 가리키지만 `components`에서는 `"{typography.body-md}"` 같은 composite 참조도 허용한다.
- variant: 상태를 객체 안에 중첩하지 않고 `button-primary`, `button-primary-hover`처럼 별도 component entry로 둔다.
- 이름: 규격은 semantic role+size(`body-md`, `label-sm`) 및 scale(`sm`, `md`, `full`)을 권장하지만 descriptive string key도 허용한다([Recommended token names](https://stitch.withgoogle.com/docs/design-md/specification/#recommended-token-names)).

## 4. 유사 사례 3개 비교

세 사례는 `awesome-design-md`가 각각 “terminal-first, monochrome”, “developer-centric”, “terminal-native”로 분류해 Loop와 가까운 예시다([큐레이션 목록](https://github.com/VoltAgent/awesome-design-md/blob/main/README.md#ai--llm-platforms)).

| 비교 축 | Ollama | OpenCode | VoltAgent |
| --- | --- | --- | --- |
| 전체 톤 | README처럼 보이는 paper-white, monochrome, 장식 최소화([원문 Overview](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/ollama/DESIGN.md#overview)) | manpage/terminal 같은 mono-only, ASCII iconography, warm cream+ink([원문 Overview](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/opencode.ai/DESIGN.md#overview)) | near-black canvas+electric green 1색 accent, “polished docs” 같은 엔지니어링 톤([원문 Overview](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/voltagent/DESIGN.md#overview)) |
| 색 | 검정/흰색/neutral 중심. semantic color는 terminal traffic light에 국소화([Colors](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/ollama/DESIGN.md#colors)) | 마케팅 chrome은 단색, 실제 TUI용 Apple 계열 accent/danger/warning/success ramp를 별도 기술([Colors](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/opencode.ai/DESIGN.md#colors)) | `#101010` canvas와 `#00d992` 단일 accent. 공개 표면에는 별도 error/warning palette가 없음([Colors](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/voltagent/DESIGN.md#colors)) |
| 타이포그래피 | SF Pro Rounded+system sans+`ui-monospace`; code가 독립 role([Typography](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/ollama/DESIGN.md#typography)) | 모든 role을 Berkeley Mono 하나로 통일([Typography](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/opencode.ai/DESIGN.md#typography)) | Inter 서술+SF Mono 코드/명령의 두 계층([Typography](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/voltagent/DESIGN.md#typography)) |
| 간격·레이아웃 | 8px 기반, 88px section rhythm, narrow reading column([Layout](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/ollama/DESIGN.md#layout)) | 8px 기반, 96px section rhythm, flush text block([Layout](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/opencode.ai/DESIGN.md#layout)) | 4px 기반 scale, 48px section band, 2–3열 card grid([Layout](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/voltagent/DESIGN.md#layout)) |
| 컴포넌트 | install snippet, terminal card, command tag를 signature component로 명시([Components](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/ollama/DESIGN.md#components)) | hero TUI mockup, prompt row, ASCII marker list/FAQ를 명시([Components](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/opencode.ai/DESIGN.md#components)) | code mockup, inline command chip, hairline card를 명시([Components](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/voltagent/DESIGN.md#components)) |
| 깊이·형태 | shadow 없음; hairline 또는 단일 inverted surface. interactive=pill([Elevation](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/ollama/DESIGN.md#elevation--depth), [Shapes](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/ollama/DESIGN.md#shapes)) | shadow 없음; 0px container/4px interactive([Elevation](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/opencode.ai/DESIGN.md#elevation--depth), [Shapes](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/opencode.ai/DESIGN.md#shapes)) | 기본은 dark hairline; button 6px/card 8px/status만 pill([Elevation](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/voltagent/DESIGN.md#elevation--depth), [Shapes](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/voltagent/DESIGN.md#shapes)) |
| 금기 | gradient/shadow/추가 brand color 금지([Do's and Don'ts](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/ollama/DESIGN.md#dos-and-donts)) | sans/SVG icon/shadow/gradient 금지, semantic ramp의 마케팅 사용 금지([Do's and Don'ts](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/opencode.ai/DESIGN.md#dos-and-donts)) | light counterpart, green body text, soft card shadow, font 대체 금지([Do's and Don'ts](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/voltagent/DESIGN.md#dos-and-donts)) |
| 추가 섹션 | Responsive Behavior, Iteration Guide, Known Gaps([원문](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/ollama/DESIGN.md)) | Responsive Behavior, Iteration Guide, Known Gaps([원문](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/opencode.ai/DESIGN.md)) | Layout 안의 Responsive Strategy, Examples([원문](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/voltagent/DESIGN.md)) |

### 4.1 공통 구조

세 문서 모두 다음 흐름을 공유한다.

1. YAML front matter에서 colors/typography/rounded/spacing/components의 exact value를 선언한다.
2. `Overview`에서 시각적 성격과 restraint를 자연어로 요약한다.
3. `Colors`, `Typography`, `Layout`, `Elevation & Depth`, `Shapes`, `Components`에서 값뿐 아니라 용도를 설명한다.
4. `Do's and Don'ts`에서 허용·금지 규칙을 명령문으로 만든다.
5. responsive/iteration/gaps 같은 확장 섹션으로 에이전트의 적용·수정 범위를 좁힌다.

이는 큐레이션 README가 설명하는 theme, color roles, typography, component styling, layout, depth, guardrail, responsive behavior, agent prompt guide의 확장 형식과도 일치한다([README: What's Inside Each DESIGN.md](https://github.com/VoltAgent/awesome-design-md/blob/main/README.md#whats-inside-each-designmd)).

## 5. 토큰 선언 방식 비교

| 항목 | Ollama | OpenCode | VoltAgent | 관찰 |
| --- | --- | --- | --- | --- |
| 원시 색 | `primary: "#000000"`([raw](https://raw.githubusercontent.com/VoltAgent/awesome-design-md/main/design-md/ollama/DESIGN.md)) | `accent: "#007aff"` 등([raw](https://raw.githubusercontent.com/VoltAgent/awesome-design-md/main/design-md/opencode.ai/DESIGN.md)) | `primary: "#00d992"`([raw](https://raw.githubusercontent.com/VoltAgent/awesome-design-md/main/design-md/voltagent/DESIGN.md)) | 모두 YAML hex 값을 정본으로 둔다. prose의 “Pure Black/Electric Green”은 설명 이름이다. |
| 역할 이름 | `canvas`, `body`, `hairline`, `on-dark` | `canvas`, `surface-dark`, `danger`, `success` | `canvas`, `body`, `hairline`, `on-primary` | 물리색 이름보다 역할 이름이 주류다. |
| 크기 이름 | `spacing.xs…section`, `rounded.sm…full` | 동일한 scale+`section` | `spacing.xxs…6xl`, `rounded.xs…pill` | scale은 사례별로 다르며 규격은 자유로운 descriptive key를 허용한다. |
| composite | typography 객체에 family/size/weight/lineHeight/letterSpacing | 동일 | 동일 | 자유 서술만으로 typography를 선언하지 않는다. |
| alias/reference | component에서 `"{colors.primary}"`, `"{typography.button-md}"` | 동일 | spacing까지 `"{spacing.md}"`로 적극 참조 | 중괄호 경로가 소비 가능한 연결부다. |
| 자연어 | 본문에서 token reference와 exact hex를 함께 설명 | 본문에서 역할·사용 금지 범위를 설명 | 본문에서 brand voice와 scarce accent 원칙 설명 | prose는 값의 복사본이 아니라 이유·범위·금기를 보강한다. |

따라서 이 세 예시는 **“hex 변수 또는 자유 서술” 중 하나를 고르는 방식이 아니다.** YAML에는 역할 이름→정확한 값과 참조를 두고, Markdown에는 인간 친화적 이름·사용 맥락·금기를 병행한다. 이는 “tokens are normative; prose provides context”라는 공식 규격과 정확히 맞는다([공식 규격](https://stitch.withgoogle.com/docs/design-md/specification/)).

## 6. 에이전트 재소비를 유도하는 문구와 장치

| 장치 | 실제 문구/형태 | 효과와 출처 |
| --- | --- | --- |
| 즉시 사용 명령 | README: DESIGN.md를 project root에 복사하고 AI agent에게 사용하라고 지시 | 발견→복사→에이전트 입력의 최소 루프를 만든다([README: How to Use](https://github.com/VoltAgent/awesome-design-md/blob/main/README.md#how-to-use)). |
| 직접 참조 명령 | Ollama/OpenCode Iteration Guide: “Reference component names and tokens directly … do not paraphrase.” | prose 재해석보다 token/component identifier의 재사용을 강제한다([Ollama](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/ollama/DESIGN.md#iteration-guide), [OpenCode](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/opencode.ai/DESIGN.md#iteration-guide)). |
| 한 번에 하나 | “Focus on ONE component at a time. Pull its YAML entry …” | 에이전트 변경 범위를 component 단위로 제한한다([Ollama](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/ollama/DESIGN.md#iteration-guide), [OpenCode](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/opencode.ai/DESIGN.md#iteration-guide)). |
| 새 토큰 억제 | 새 component 전에 기존 vocabulary로 표현 가능한지 먼저 묻는다 | 시각 언어의 무제한 확장을 막는다([Ollama](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/ollama/DESIGN.md#iteration-guide), [OpenCode](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/opencode.ai/DESIGN.md#iteration-guide)). |
| 상태를 별도 entry로 | `-active`, `-disabled`, `-focused` variant를 prose 안에 묻지 말라고 지시 | variant를 machine-readable graph로 유지한다([Ollama](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/ollama/DESIGN.md#iteration-guide), [공식 Components 규격](https://stitch.withgoogle.com/docs/design-md/specification/#components)). |
| 기계 검증 | 예시의 `npx @google/design.md lint DESIGN.md`; 공식 CLI의 lint/diff/export/spec JSON | 에이전트가 broken reference/contrast/orphaned token을 고칠 수 있고 spec 자체도 prompt context로 주입할 수 있다([공식 CLI](https://stitch.withgoogle.com/docs/design-md/cli/)). |
| 불확실성 공개 | `Known Gaps`에 캡처되지 않은 mobile/TUI/form 상태를 명시 | 관찰되지 않은 영역을 사실처럼 확장하는 것을 막는다([Ollama](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/ollama/DESIGN.md#known-gaps), [OpenCode](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/opencode.ai/DESIGN.md#known-gaps)). |

## 7. Loop 적용 시 경계에 대한 시사점

이 연구만으로 채택을 확정하지는 않지만, 채택한다면 가장 단순한 경계는 다음과 같다.

```text
변경 설계·승인 정본
  docs/design/design.md
  - EARS, architecture/data flow, alternatives, task traceability, approval
  - 특정 변경을 review/accept하고 구현으로 넘기는 수명주기

비주얼 언어 정본
  DESIGN.md (후속 결정에서 위치 확정)
  - CLI/TUI의 tone, semantic roles, typography/glyph/spacing, components, prohibitions
  - 에이전트가 UI 작업마다 재소비하고 현재 표현 언어와 함께 갱신하는 수명주기
```

두 문서 사이에는 **값 복제 대신 링크**를 둬야 한다. 변경 설계 문서는 “왜 이 visual rule을 도입했는가”와 승인 근거를 기록하고, Stitch식 DESIGN.md는 승인된 현재 규칙만 유지한다. 런타임 token/code가 생기면 DESIGN.md는 에이전트 입력 정본이더라도 executable value와의 drift 검증이 필요하다. 공식 CLI가 lint/diff/export를 제공하지만, Loop의 Rust→generated protocol 경계나 실제 ANSI 출력까지 자동 검증해 주지는 않는다([공식 CLI](https://stitch.withgoogle.com/docs/design-md/cli/)).

또한 후속 초안은 아직 승인 전인 값을 확정 사실처럼 쓰면 안 된다.

- **D-1 토큰 명명:** `pending 승인`
- **D-3 불릿 값:** `pending 승인`
- **D-4 색 범위:** `pending 승인`

즉 형식과 섹션은 먼저 제안할 수 있지만, 위 세 항목은 YAML의 normative value나 “Do” 규칙으로 확정하지 말고 명시적 pending marker 또는 unresolved section으로 남겨야 한다.

## 결론

### 공통 필수 섹션 상위 5개

공식 8개 canonical section과 사례 3개의 반복 빈도, 에이전트 재소비 가치를 함께 보면 Loop의 CLI/TUI용 DESIGN.md에서 우선할 상위 5개는 다음과 같다.

1. **Overview / Tone** — 미정의 상황에서도 에이전트가 일관된 선택을 하게 하는 전체 판단 기준([공식 Overview](https://stitch.withgoogle.com/docs/design-md/specification/#overview)).
2. **Colors / Semantic roles** — exact value보다 먼저 역할과 사용 범위를 고정하고, YAML에는 정확한 값 또는 pending 상태를 둔다([공식 Colors](https://stitch.withgoogle.com/docs/design-md/specification/#colors)).
3. **Typography & Glyph vocabulary** — CLI/TUI에서는 font family보다 hierarchy, mono text, glyph·separator·ASCII fallback의 의미가 핵심이다. Glyph는 공식 canonical section에는 없으므로 도메인 확장 section으로 추가할 수 있다([공식 확장 규칙](https://stitch.withgoogle.com/docs/design-md/specification/#consumer-behavior-for-unknown-content)).
4. **Layout & Spacing** — terminal width, indentation, density, line budget, pane/row rhythm을 재현 가능한 규칙으로 둔다([공식 Layout](https://stitch.withgoogle.com/docs/design-md/specification/#layout)).
5. **Components + Do's and Don'ts** — status line, task row, attention, finding, prompt 같은 표면 단위의 조합 규칙과 금기를 함께 둬 생성 drift를 막는다([공식 Components](https://stitch.withgoogle.com/docs/design-md/specification/#components), [Do's and Don'ts](https://stitch.withgoogle.com/docs/design-md/specification/#dos-and-donts)).

`Elevation & Depth`와 `Shapes`는 웹 UI에서는 독립 필수성이 높지만, ANSI CLI에서는 border/tonal hierarchy와 separator 규칙으로 축약 가능하다. fullscreen TUI pane이 실제 범위에 들어올 때 독립 절로 승격하는 편이 단순하다.

### 터미널/CLI 계열 사례의 특이점

- **코드가 장식이 아니라 1급 component다.** install snippet, command chip, terminal card/TUI mockup을 별도 component token으로 둔다([Ollama Components](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/ollama/DESIGN.md#components), [OpenCode Components](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/opencode.ai/DESIGN.md#components), [VoltAgent Components](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/voltagent/DESIGN.md#components)).
- **색보다 glyph·mono·hairline이 정체성을 운반한다.** OpenCode는 `[+]`, `[-]`, `[x]`를 icon으로 쓰고, Ollama는 거의 단색이며, VoltAgent도 accent를 단 하나로 제한한다([OpenCode Do/Don't](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/opencode.ai/DESIGN.md#dos-and-donts), [Ollama Colors](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/ollama/DESIGN.md#colors), [VoltAgent Colors](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/voltagent/DESIGN.md#colors)).
- **금기 규칙이 강하다.** shadow/gradient/추가 색/비-mono icon처럼 “하지 않을 것”을 명시해 에이전트의 평균적 웹 미학으로 회귀하는 것을 막는다.
- **single-source restraint가 반복된다.** 한 font, 한 accent, 한 inverted surface처럼 선택지를 닫아 일관성을 만든다.
- **웹 반응형 규칙은 그대로 CLI 규칙이 아니다.** Loop는 breakpoint보다 TTY 여부, `NO_COLOR`, 열 폭, Unicode/ASCII fallback, copy/paste 안정성, screen reader/로그 출력을 별도 도메인 확장으로 다뤄야 한다. 세 사례는 이 부분을 완전하게 제공하지 않는다.

### 판정 입력 요약

- **분석한 예시:** 3개 — Ollama, OpenCode, VoltAgent.
- **공통 섹션 요지:** machine-readable YAML token + Overview/Colors/Typography/Layout/Elevation/Shapes/Components/Do's and Don'ts 본문이며, 사례는 Responsive/Iteration/Known Gaps를 확장한다.
- **핵심 판정 근거:** Stitch식 DESIGN.md는 Loop의 기존 변경 설계 문서를 대체하지 않는다. 별도 비주얼 언어 정본으로만 채택 가치가 있으며, D-1·D-3·D-4는 후속 초안에서 반드시 `pending 승인`으로 남겨야 한다.
- **작성 파일:** `docs/design/research/2026-09-24-stitch-design-md-study.md`
