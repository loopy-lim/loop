# Loop 비주얼 언어 팩트와 Stitch `DESIGN.md` 적용 경계

- **일자:** 2026-09-24 KST
- **태스크:** `map-loop-visual-language-facts` (research, attempt 0)
- **범위:** Loop의 CLI 리포트·presentation 스냅샷·herdr 워커 탭에 이미 존재하는 시각 언어를 정리하고, Google Stitch가 말하는 `DESIGN.md`와 Loop의 변경 설계 문서 `docs/design/design.md`의 역할을 분리한다.
- **쓰기 범위:** 본 문서만. 코드 변경 없음.
- **판정:** **조건부 채택 가능.** Loop용 `DESIGN.md`는 승인된 현재 시각 규범을 에이전트가 빠르게 읽는 **파생된 시각 truth/read model**로만 쓸 수 있다. 변경 요구사항·승인·태스크의 원천은 계속 `docs/design/design.md`이고, 런타임 규범 값의 원천은 승인 후 presentation 상수와 테스트다. D-1·D-3·D-4가 아직 승인 전이므로 지금 완성된 truth 문서를 만들면 제3의 추정 원천이 된다.

## 1. 조사 방법과 증거 경계

### 내부 자료

- 현재 표면 팩트: [`loop-ui-audit.md`](loop-ui-audit.md) §1–§3.
- 변경 요구사항·설계·승인 상태: [`../design.md`](../design.md) §1, §4, §5, §7–§9.
- 보조적인 현행 문자열 목록과 권고: [`../design-foundations.md`](../design-foundations.md) §4.2.
- 기존 `design.md` 조사와의 중복 판정: [`design-md-practices.md`](design-md-practices.md).
- 기존 스킬 생태계 종합 판정과의 정합 확인: [`2026-09-24-design-skill-synthesis.md`](2026-09-24-design-skill-synthesis.md).

### 외부 1차·예시 자료

2026-09-24에 `curl`로 원문을 직접 확인했다.

1. **Google Stitch 공식 문서:** [overview](https://stitch.withgoogle.com/docs/design-md/overview/), [format](https://stitch.withgoogle.com/docs/design-md/format/). 공식 페이지의 클라이언트가 제공하는 생성 지침은 `DESIGN.md`를 제품의 “desired look and feel”을 설명하는 디자인 시스템 문서로 정의하고, “YAML frontmatter containing all structured design tokens” 뒤에 “free-form Markdown”으로 시각 정체성과 사용 지침을 설명하도록 요구한다. 공식 지침이 링크하는 고정 원문은 Google `design.md` 저장소의 [README](https://github.com/google-labs-code/design.md/blob/9bf8eae67128b6cc55ad9bf86665767deb4c11cd/README.md#L1-L7)와 [format spec](https://github.com/google-labs-code/design.md/blob/9bf8eae67128b6cc55ad9bf86665767deb4c11cd/docs/spec.md#L4-L17)이다.
2. **Google 포맷 원문:** “The tokens are the normative values. The prose provides context for how to apply them.”이라고 명시한다([README L99–108](https://github.com/google-labs-code/design.md/blob/9bf8eae67128b6cc55ad9bf86665767deb4c11cd/README.md#L99-L108)). 형식은 아직 `alpha`이며 변경 가능하다([README L360](https://github.com/google-labs-code/design.md/blob/9bf8eae67128b6cc55ad9bf86665767deb4c11cd/README.md#L360)).
3. **`awesome-design-md` 예시:** 고정 커밋 `f696123…`의 [OpenCode `DESIGN.md`](https://github.com/VoltAgent/awesome-design-md/blob/f6961238d5cddcf8042a74a70fc400ec67181abb/design-md/opencode.ai/DESIGN.md)와 [Ollama `DESIGN.md`](https://github.com/VoltAgent/awesome-design-md/blob/f6961238d5cddcf8042a74a70fc400ec67181abb/design-md/ollama/DESIGN.md)를 직접 확인했다. 두 문서 모두 YAML 토큰 뒤에 Overview, Colors, Typography, Layout, Elevation, Shapes, Components, Do/Don't, Responsive Behavior, Iteration Guide, Known Gaps를 둔다. OpenCode 예시는 `[+]`/`[-]`/`[x]`를 “part of the text content, not a separate icon”으로 규정하고, 색의 표면별 사용 범위를 구분한다. Ollama 예시는 현존하지 않는 상태 팔레트를 억지로 채우지 않고 “effectively no error/success/warning palette”라고 기록한다.

`awesome-design-md`는 큐레이션된 **제3자 분석 예시**이지 Google 규격이나 각 제품의 공식 디자인 시스템이 아니다. 실제로 Stitch 공식 UI도 웹 저장소 목록을 third-party이며 Google/Stitch의 보증·제휴 대상이 아니라고 표시한다. 따라서 예시에서는 문서 구성법과 “현재 관찰/금지/known gap을 함께 적는 방식”만 참고하고, 값은 Loop 내부 증거로만 확정한다.

## 2. 기존 `design-md-practices.md`와의 중복 제거

| 질문 | `design-md-practices.md`가 이미 조사한 것 | 이번 조사에서 새로 다루는 차이 |
| --- | --- | --- |
| 문서 목적 | Kiro·Spec Kit·Rust RFC·Google 기술 디자인 문서의 **요구사항→설계→태스크→승인** 프로세스. EARS, 역추적 ID, 대안, 검증 계획이 중심이다. | Stitch `DESIGN.md`의 **현재 시각 언어**: 글리프, 색 역할, 타이포그래피, 레이아웃, 컴포넌트 사용·금지 규칙을 에이전트에 전달하는 형식이다. |
| Google 사례 | Malte Ubl의 기술 design doc 관행을 다뤘다. 해당 문서는 스스로 “This isn't a requirements doc”라고 설명하는 기술 설계 리뷰 문맥이다. | Google Stitch의 시각 identity 포맷과 공식 `google-labs-code/design.md` 규격을 확인했다. 같은 이름이어도 대상과 수명주기가 다르다. |
| `DESIGN.md` 예시 | 서두의 증거 경계에서 “design.md/ui-ux-pro 류 프롬프트 스킬 문서”를 근거에서 제외했다. Stitch 시각 문서와 `awesome-design-md` 원문을 조사하지 않았다. | `awesome-design-md`의 실제 OpenCode/Ollama 원문을 확인해 YAML 토큰+서술+guardrail+known gaps 패턴을 기록했다. |
| Loop 산출물 | `docs/design/design.md` 9절 골격(EARS R, 설계, 대안, R↔태스크, 승인, 검증)을 제안했다. | 같은 내용을 복제하지 않는다. Loop용 시각 `DESIGN.md`가 생기더라도 R·D·태스크·승인 상태는 링크만 하고 본문에 소유하지 않아야 한다. |

따라서 기존 조사의 EARS·게이트·역추적 결론은 재서술하지 않고, 본 문서는 **시각 truth의 내용 경계와 현재 표면 팩트**만 추가한다. `2026-09-24-design-skill-synthesis.md`가 별도 루트 `DESIGN.md`를 당시 비채택한 이유(제3의 원천 위험)도 유효하다. 이번 자료가 추가하는 좁은 예외는 “승인된 코드/ADR에서 생성·검증되는 read model”일 때뿐이다.

## 3. Loop 표면의 현재 비주얼 언어 팩트

아래 **16개**는 제안값이 아니라 감사 기준 worktree `86413fa`에서 관찰된 현재 상태다. 향후 승인값과 혼동하지 않는다.

| ID | 현재 팩트 | 근거 |
| --- | --- | --- |
| F1 | 공통 표면은 presentation 스냅샷, CLI 전용 리포트(doctor/benchmark/models/cleanup), herdr 워커 탭·페인 라벨이다. | `loop-ui-audit.md` §1.1, `design.md` §2 |
| F2 | presentation/CLI의 내용 출력은 순수 텍스트이며 스타일 프리미티브가 없다. | 감사 P1-2, `design.md` R7 |
| F3 | task 상태는 `running`/`failed`/`attention`/`done` 같은 단어로만 구분되고, 우선순위 정렬은 시각 강조로 이어지지 않는다. | 감사 P1-1, `design.md` R10 |
| F4 | 관찰된 글리프 어휘는 성공 `✓`, 경고·스킵 `!`, cleanup 제거 항목 `-`다. 서로 다른 CLI 포맷터에 하드코딩되어 있고 아직 통일된 의미 체계가 아니다. | 감사 P2-1, `design.md` R1·§5.4 |
| F5 | 목록 구분자 `·`, 라벨 구분자 `: `, 의존 방향 `←`가 쓰인다. 하나의 문서화된 규칙이 아니라 표면별 관례다. | 감사 P2-6, `design.md` R1 |
| F6 | herdr 워커 탭 라벨은 `<taskId>·<kind>·a<attempt>`, mirror는 `mirror·<taskId>` 형식이며, task ID를 우선 보존하는 32자 예산을 가진다. | 감사 §1.3·P3-3·P4-2, `design.md` §5.5 |
| F7 | 관찰된 빈 상태 문구는 `No runs`, `No tasks`, `No active workers`, `OK`, `No models configured`다. 이 중 `No runs`는 CLI와 presentation에 중복 정의되어 있다. | 감사 P2-3, `design-foundations.md` §4.2, `design.md` R1 |
| F8 | 생략 문구의 정책 계약은 `… {omitted} more {noun}`이지만, 현재 12개 인라인 변종이 suffix를 각자 구성한다. | 감사 P2-2, `design.md` R2 |
| F9 | 기본 논리 줄 예산은 status 8, attention 6, findings 5, list 8이다. 예산은 디자인 토큰이 아니라 `policy.toml → orchestrator config → renderer parameter` 운영 정책이다. | `design.md` §5.5, AGENTS.md 기본 상태/attention/findings 규칙 |
| F10 | 기본 논리 줄 길이는 160 grapheme이고 `…`로 끝난다. 터미널 실제 폭을 감지하지 않으므로 좁은 터미널의 물리 줄 수는 논리 줄 예산을 넘을 수 있다. | 감사 P3-2, `design.md` §5.5·D-5 |
| F11 | CLI/presentation은 현재 무색이다. 코드베이스에서 확인된 유일한 ANSI 이스케이프는 watch의 화면 전체 clear+home `\x1b[2J\x1b[H` 한 곳이다. | 감사 §1.2·P1-2, `design.md` §2 |
| F12 | watch는 변경 시 전체 화면을 지워 다시 출력하므로 커서·스크롤백 맥락을 잃고 터미널별 플리커 가능성이 있다. | 감사 P3-1, `design.md` 요구사항 커버리지 표 |
| F13 | `NO_COLOR`를 처리하지 않는다. 따라서 향후 색을 넣기 전에 비어 있지 않은 `NO_COLOR` 값의 의미를 렌더 진입점에서 정의해야 한다. | 감사 P1-3, `design.md` R8 |
| F14 | TTY 여부를 검사하지 않아 현재 watch의 clear escape가 파이프·로그 캡처에도 방출된다. | 감사 P1-3, `design.md` R9 |
| F15 | pi 내부 표면은 pi theme 역할 8종을 사용하지만 CLI/presentation과 공유 어휘가 없다. 반면 herdr 탭은 색 없이 텍스트 라벨만 소유한다. | 감사 §1.1–§1.2·P1-4 |
| F16 | 시각 어휘의 현재 소유권은 스냅샷(`snapshot.ts`), CLI 리포트(`main.ts`), herdr 라벨(`client.ts`) 세 곳에 분산되어 있다. 이 분산이 같은 의미의 중복 렌더와 문구 불일치의 구조적 원인이다. | 감사 §1.3·P4, `design.md` R3–R5 |

### 현재 값과 승인 대기값의 경계

- F4의 `✓`/`!`/`-`는 **관찰된 현재 출력**일 뿐 D-3의 canonical 역할·불릿 값 승인이 아니다.
- F11의 무색 출력은 **현황**일 뿐 D-4의 향후 색 범위·ANSI 단계 승인이 아니다.
- `design.md` §5.3의 점 경로 예시는 **제안**일 뿐 D-1의 이름 규칙 승인이 아니다.
- 따라서 시각 `DESIGN.md` 초안은 이 세 항목을 각각 `pending approval: D-3`, `pending approval: D-4`, `pending approval: D-1`로 표시하고 normative YAML 값으로 승격하면 안 된다.

## 4. `DESIGN.md`가 맡을 것과 맡지 않을 것 — R1~R13·D-1~D-6 매핑

원칙은 세 원천의 수명주기를 분리하는 것이다.

1. **`docs/design/design.md`:** 변경 제안, EARS 요구사항, 대안, 승인, 태스크, 검증 계획.
2. **presentation 상수·테스트와 운영 config:** 실행되는 현재 규범 값.
3. **시각 `DESIGN.md`(채택 시):** 위 승인된 현재 값을 에이전트가 읽기 좋게 투영한 시각 언어 read model. 독립적으로 값을 결정하지 않는다.

| 항목 | 시각 `DESIGN.md`에 둘 수 있는 내용 | 두면 안 되는 내용 / canonical 원천 | 현재 처리 |
| --- | --- | --- | --- |
| R1 어휘 단일 원천 | 승인된 글리프·구분자·빈 상태의 의미와 사용 예 | 상수 대신 독립적인 값 원천이 되는 것 | 현재 팩트만 기록; D-1·D-3 전까지 pending |
| R2 overflow 계약 | 사용자에게 보이는 패턴과 좋은/나쁜 예 | 팩토리 구현, 테스트 정규식, 변경 태스크 | 계약은 `design.md` R2와 `ui-output-limits`가 소유 |
| R3 포맷터 소유권 | CLI 리포트가 공유하는 시각 패턴 | 파일 이동 계획·태스크·의존성 | `design.md` R3·§7만 소유 |
| R4 runs 단일 구현 | runs가 모든 표면에서 같은 모습이어야 한다는 결과 | 구현 중복 제거 태스크 | `design.md` R4 소유 |
| R5 출력 역직렬화 금지 | 필요 시 agent guardrail로 한 줄 요약 | API 변경 방법·`replace()` 제거 태스크 | `design.md` R5 소유 |
| R6 출력 보존 | 기존 표면을 바꿀 때 시각 회귀를 피한다는 guardrail | 바이트 동일 completion contract | `design.md` R6·§9 소유 |
| R7 색 역할 | 승인된 semantic role과 표면별 사용/금지 규칙 | 미승인 색 값·역할 집합을 normative token으로 선언 | **pending approval: D-4** |
| R8 `NO_COLOR` | 무색 모드에서 유지되어야 할 계층·글리프 규칙 | 환경 감지 구현과 단위 테스트 | 동작 계약은 `design.md` R8 소유 |
| R9 비-TTY clear | pipe/log 표면은 정적·escape-free여야 한다는 시각 규칙 | TTY 판정 구현·watch 태스크 | 동작 계약은 `design.md` R9 소유 |
| R10 상태 색 조회 | 승인 후 상태별 semantic role의 읽기용 표 | 9종 매핑을 코드보다 먼저 확정 | D-4 승인과 코드 구현 후 투영 |
| R11 경계 테스트 | “raw ANSI/색 리터럴 금지” guardrail 요약 | 테스트 구현·예외·완료 명령 | `design.md` R11·테스트가 canonical |
| R12 무결성 테스트 | 문서가 검증된다는 링크와 생성 시각 | 무결성 조건 자체의 별도 복제 | `design.md` R12·테스트가 canonical |
| R13 디자인 진입점 | 관련 ADR·코드·변경 설계 링크를 제공하는 시각 인덱스 | `design.md`를 대체하거나 같은 R/태스크를 복사 | 시각 문서는 R13의 하위 링크 대상일 수 있음 |
| D-1 토큰 명명 | 승인된 뒤 token path와 alias 금지 규칙 | 제안된 점 경로를 지금 확정 | **pending approval: D-1** |
| D-2 herdr 라벨 소유권 | 현재 라벨 문법·32자 예산과 “herdr-owned” 표시 | presentation 이관 결정을 선취 | 현행 사실만; 후속 결정까지 유지 |
| D-3 불릿 | 현재 관찰값과 승인 후 semantic glyph 역할 | `✓`/`!`/`-`를 미래 canonical로 선언 | **pending approval: D-3** |
| D-4 색 범위 | 현재 무색, clear 1개, pi 체계 분리라는 사실 | 상태색 범위·ANSI 16색·소비자 우선순위 확정 | **pending approval: D-4** |
| D-5 터미널 폭 | 현재 160 grapheme 상한과 알려진 물리 wrapping 한계 | 반응형 폭 정책을 추정해 추가 | 연기; 관찰 증거 후 결정 |
| D-6 포맷 승격 | 문서 포맷 버전·생성 원천·마지막 동기화 정보 | Google alpha YAML을 Rust/TS canonical 원천으로 즉시 승격 | Rust/TS 공유 트리거까지 연기 |

## 5. 채택 시 최소 형식 경계

최종 초안 작성자가 사용할 수 있는 최소 골격이다. **값 초안이 아니라 역할 골격**이다.

```markdown
---
version: alpha
name: Loop CLI/TUI visual language
# generatedFrom: 승인된 ADR + presentation tokens + policy config
# D-1 token naming: pending approval
# D-3 semantic glyph/bullet vocabulary: pending approval
# D-4 color roles and first-use scope: pending approval
---

## Overview
## Surfaces
## Glyphs and Separators
## Empty and Overflow States
## Density and Line Budgets
## Color and Terminal Capabilities
## Herdr Tab Labels
## Do's and Don'ts
## Known Gaps and Pending Decisions
## Provenance
```

형식 선택에는 두 대안이 있다.

| 대안 | 장점 | 비용·위험 | 판정 |
| --- | --- | --- | --- |
| A. 독립 수기 truth | 에이전트가 한 파일만 읽으면 됨 | `design.md`·ADR·presentation 상수와 값이 drift하는 제3 원천 | 비채택 |
| B. 승인된 원천에서 투영한 read model | Stitch의 agent-readable 장점을 얻으면서 단일 원천 유지 | 생성/검증 또는 명시적 동기화 절차 필요 | **조건부 채택** |
| C. 도입하지 않고 기존 문서+코드만 사용 | 추가 유지비 없음 | 에이전트가 세 표면의 시각 규칙을 여러 파일에서 재구성해야 함 | D-1·D-3·D-4 승인 전 기본값 |

권장 순서는 **D-1·D-3·D-4 승인 → presentation 상수/테스트 구현 → 실제 값에서 시각 `DESIGN.md` 투영**이다. 그 전 초안은 위 골격과 `pending approval` 표지만 가져야 한다. 루트 파일명·배치 위치도 기존 `docs/design/design.md`와 혼동되지 않도록 별도 decision에서 확정해야 한다.

## 6. 결과 요약

- **팩트 수:** 16개(F1–F16).
- **구분표 요지:** R1–R13과 D-1–D-6 중 시각 규범의 설명·사용 예만 `DESIGN.md`에 투영할 수 있다. 변경 요구사항·설계 대안·승인·태스크·completion contract는 계속 `docs/design/design.md`가 소유한다. D-1(토큰 명명), D-3(불릿/글리프 의미), D-4(색 범위)는 모두 **pending approval**이며 초안의 normative 값이 될 수 없다.
- **작성 파일:** `docs/design/research/2026-09-24-loop-visual-language-facts.md`.
- **미해결 위험:** Google 포맷은 alpha이고, awesome 예시는 제3자 분석이며, 감사는 정적 소스 기준이다. 따라서 런타임 TTY/폭/플리커 관찰과 문서 동기화 방식은 후속 결정이 필요하다.
