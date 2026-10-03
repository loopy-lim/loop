---
version: alpha
name: Loop CLI/TUI visual language
status: draft
lifecycle: design.md 승인 게이트 이후 갱신 대상
---

# Loop CLI/TUI 비주얼 디자인 언어

> **상태:** `draft` — [`design.md`](design.md)의 승인 게이트 이후 갱신 대상이다. 이 초안은 미승인 제안이나 실행 가능한 토큰의 정본이 아니다.
>
> **근거 조사:** [Stitch DESIGN.md 연구](research/2026-09-24-stitch-design-md-study.md) · [Loop 비주얼 언어 팩트](research/2026-09-24-loop-visual-language-facts.md) · [기존 스킬 관행 종합](research/2026-09-24-design-skill-synthesis.md)

## 디자인 논의·수정 제안 방법
- 색·글리프·밀도·컴포넌트·tone 등 시각 언어 값의 추가·수정·삭제 제안은 아래 `## Proposals / 제안`에만 남기며, canonical 본문을 직접 고치지 않는다.
- 문제·목표·EARS 요구사항·대안·태스크·검증을 바꾸는 제안은 [`design.md`](design.md)를 개정하는 decision 태스크로 보내고, 여러 에픽에 남을 규칙은 ADR로 기록한다.
- 제안은 `<!-- design-proposal:start DP-YYYYMMDD-N -->`/`end` 마커 안에 상태(`proposed`)·제안자·대상·**현재 근거(필수)**·제안·이유와 영향·후속을 적는다.
- 제안은 현재 규칙이 아니며, 검토·분류 → 필요 시 변경 설계 승인과 구현 검증 → integration 반영 순서를 따른다([근거 ADR](../decisions/design-md-workflow.md#후속-결정--디자인-논의-진입점과-read-model-편집-프로토콜)).

## Proposals / 제안

새 제안은 위 형식과 [근거 ADR](../decisions/design-md-workflow.md#후속-결정--디자인-논의-진입점과-read-model-편집-프로토콜)에 따라 출처에 맞는 하위 그룹(`### 공통/혼합 기반` · `### Notion 기반` · `### Slack 기반` · `### 기타 corpus 기반`)의 끝에 추가한다. 그룹 단위 채택은 "그룹 DP 전체를 `design.md` 승인 게이트 입력으로 일괄 검토"하는 방식을 허용하고, 그룹 간 혼합은 개별 DP 승인으로 처리한다. 이 절의 내용은 승인된 canonical 규칙으로 소비하지 않는다.

### 공통/혼합 기반

> 여러 출처가 섞였거나 출처와 무관한 공통 규율을 다루는 제안 그룹이다. 그룹 단위 채택 시 이 그룹의 DP 전체를 `design.md` 승인 게이트 입력으로 일괄 검토할 수 있다. 그룹 간 혼합(예: 공통 규율 + 특정 출처 값)은 개별 DP 승인으로 처리하며, 그룹화는 개별 DP 마커·상태·후속 규칙을 바꾸지 않는다.

<!-- design-proposal:start DP-20260925-1 -->
### DP-20260925-1 — 작업 상태색과 일반 semantic 색의 namespace 분리
- **상태:** proposed
- **제안자:** lead-seed (external corpus mining)
- **대상:** [`design.md`](design.md) §5.2 색 역할(R7·R10) 및 D-4 색 1차 범위
- **현재 근거:** [`design.md`](design.md) R7(색 역할 폐쇄 집합 `ColorRole`)·R10(`colorRoleFor(state)` 상태 색 조회)과 감사 P1-1(상태(running/failed/attention/done)이 단어로만 구분되고 렌더링에 우선순위가 미반영)·P1-4(pi 표면과 CLI의 시각 체계 이중화). 외부 비교 사례: `docs/design/references/awesome-design-md/cursor.md`는 제품의 agent action 단계색(AI timeline pastels 5종)을 일반 semantic(success/error) 토큰과 별도 namespace로 분리해 관리하고, `docs/design/references/awesome-design-md/opencode.ai.md`는 semantic accent ramp를 in-TUI 상태에 한정해 chrome 색과 섞이지 않게 한다.
- **제안:** D-4 확정 시 Loop task 상태(running/failed/attention/done)의 색을 일반 semantic 역할(success/warning/error)과 별도의 상태색 namespace로 정의한다. R7의 폐쇄 집합 안에서 task 상태 전용 매핑을 유지하고, 일반 문구·라벨 강조가 상태색 역할을 재활용하지 않는 규칙을 어휘 모듈 계약에 추가한다.
- **이유와 영향:** 상태색이 일반 강조와 섞이면 감사 P1-1의 근원(상태가 시각적으로 동등 출력)이 색 도입 후에도 재발한다. namespace 분리는 R10의 상태→색 단일 조회 경로를 보존하며, 출력 바이트 변화는 D-4 승인 후 S5 태스크 범위로 한정된다. 값(hex)은 도입하지 않고 소유 규칙만 제안한다.
- **후속:** untriaged
<!-- design-proposal:end DP-20260925-1 -->

<!-- design-proposal:start DP-20260925-2 -->
### DP-20260925-2 — 색에 독립적인 텍스트 강조 계층 우선 정의
- **상태:** proposed
- **제안자:** lead-seed (external corpus mining)
- **대상:** [`design.md`](design.md) §5.2(R7·R8) 색 역할·환경 가드, §3 글리프 어휘
- **현재 근거:** [`design.md`](design.md) R8(NO_COLOR 준수)과 감사 P1-2(스타일 프리미티브 0개)·P1-3(비-TTY에서도 클리어 이스케이프 무조건 방출). `config/policy.toml [output]`의 줄 예산(status 8/attention 6/findings 5)은 ANSI 비의존 텍스트 계층으로 동작한다. 외부 비교 사례: `docs/design/references/awesome-design-md/warp.md`는 chromatic accent 없이 텍스트 계층(body-strong/body/mute)과 surface 대비만으로 우선순위를 만들고, `docs/design/references/awesome-design-md/clickhouse.md`는 "bigger Inter 700 before adding color"로 색 이전에 서체 강조를 먼저 쓴다.
- **제안:** 색 도입(R7·D-4)과 별개로, bold/dim 텍스트 강조 단계를 presentation 어휘 모듈(S1 산출물)에 먼저 정의해 NO_COLOR·비-TTY 모드에서도 상태 우선순위가 판독되게 한다. 색은 이 텍스트 계층 위에 덧대는 부가 신호로만 쌓고, 색만으로 전달되는 정보를 남기지 않는다.
- **이유와 영향:** R8·R9 가드가 색을 off했을 때 정보가 사라지는 것을 구조적으로 막는다. 감사 P1-1(우선순위 미반영)을 색 승인과 무관하게 부분 해소할 수 있어 D-4 지연 리스크와 분리된다. 텍스트 계층도 ANSI 속성이므로 R11 경계 테스트와 R12 무결성 테스트 대상에 포함해야 한다.
- **후속:** untriaged
<!-- design-proposal:end DP-20260925-2 -->

<!-- design-proposal:start DP-20260925-3 -->
### DP-20260925-3 — 표면 단위 강조 예산 (색·bold 희소성 규율)
- **상태:** proposed
- **제안자:** lead-seed (external corpus mining)
- **대상:** `config/policy.toml [output]` 밀도 규율, [`design.md`](design.md) §4 레이아웃·D-4
- **현재 근거:** `config/policy.toml [output]`의 status 8/attention 6/findings 5/list 8 줄 예산이 밀도는 규율하지만 강조(색·bold) 사용량 규율은 없으며, 감사 P1-1이 `taskPriority` 정렬이 렌더링에 미반영임을 기록한다. 외부 비교 사례: `docs/design/references/awesome-design-md/clickhouse.md`는 accent를 primary와 핵심 수치에 한정해 강조를 희소하게 유지하고, `docs/design/references/awesome-design-md/ollama.md`는 "fold당 primary pill 최대 1개"를, `docs/design/references/awesome-design-md/voltagent.md`는 단일 accent를 CTA·상태 pill에만 예약하는 규율을 명문화한다.
- **제안:** D-4 색 도입 시 표면(스냅샷·리포트 1회 출력)당 상태색/bold 강조 사용 상한을 policy 키로 정의한다. 강조 승격은 attention 대상 항목에 한정하고, 줄 예산과 우선순위 정렬로 이미 해소되는 우선순위를 강조로 이중 표현하지 않는다.
- **이유와 영향:** 줄 예산(운영 정책)과 같은 방식으로 강조도 정책 소유로 두면 표면이 시끄러워지는 것을 코드 변경 없이 규율할 수 있다. 8/6/5줄 예산 안에서 강조 상한이 자연스럽게 소진되므로 기존 출력과의 호환성 리스크가 낮다. 상한 값은 D-4·R10 구현 시 관찰 후 확정한다.
- **후속:** untriaged
<!-- design-proposal:end DP-20260925-3 -->

<!-- design-proposal:start DP-20260925-4 -->
### DP-20260925-4 — 글리프를 아이콘이 아닌 텍스트 콘텐츠로 규정
- **상태:** proposed
- **제안자:** lead-seed (external corpus mining)
- **대상:** [`design.md`](design.md) §3 타이포그래피·글리프, §5.4 D-3 불릿 어휘
- **현재 근거:** [`design.md`](design.md) §5.4 D-3 후속(`✓`/`!`/`-` 3역할, 값 불변 단계)·R1(어휘 단일 원천)과 감사 P2-1(포맷터별 글리프 하드코딩)·P2-6(구분자 `·`/`: `/`←` 관행 불일치). 외부 비교 사례: `docs/design/references/awesome-design-md/opencode.ai.md`는 `[+]`/`[-]`/`[x]` 불릿과 `+`/`−` 토글을 "별도 아이콘이 아니라 텍스트 콘텐츠의 일부"로 규정하고 SVG 아이콘 대체를 금지한다.
- **제안:** D-3 확정 시 글리프를 아이콘이 아닌 복사·파이프·로그 출력에 남는 텍스트 어휘로 규정하는 규칙을 어휘 모듈 계약(R1·R12)에 추가한다. 글리프 후보는 단일 코드포인트 텍스트로 한정하고 SVG/이미지 아이콘 도입을 금지하며, R11 경계 테스트에 리터럴 금지 규칙으로 강제한다.
- **이유와 영향:** Loop 출력은 `--json`·파이프·로그 캡처로 재소비되므로 글리프가 렌더 계층 전용 장식이면 역직렬화 리스크(감사 P2-5 계열)가 생긴다. 텍스트 콘텐츠 규정은 D-3 값 불변(✓/!/-)과 충돌하지 않고 소유 규칙만 추가한다. 브랜드 글리프 값(`[+]` 등)은 가져오지 않는다.
- **후속:** untriaged
<!-- design-proposal:end DP-20260925-4 -->

<!-- design-proposal:start DP-20260925-5 -->
### DP-20260925-5 — 상태색 후보 팔레트 (외부 corpus 값 후보 대안집)
- **상태:** proposed
- **제안자:** lead-seed (external corpus value intake, [ADR 개정](../decisions/design-reference-corpus.md#개정--외부-값의-제안-lane-후보-반입-허용-2026-09-25)에 따른 최초 접수)
- **대상:** [`design.md`](design.md) §5.2 R7·R10, §5.4 D-4 색 1차 범위, [`DP-20260925-1`](#dp-20260925-1--작업-상태색과-일반-semantic-색의-namespace-분리)·[`DP-20260925-2`](#dp-20260925-2--색에-독립적인-텍스트-강조-계층-우선-정의)
- **현재 근거:** Loop 내부 — [`design.md`](design.md) R7(색 역할 폐쇄 집합)·R8(NO_COLOR 준수)·R10(`colorRoleFor(state)`)과 §5.4 D-4 pending(ANSI 16색 시작), `config/policy.toml [output]` 줄 예산, 감사 P1-1·P1-2([facts](research/2026-09-24-loop-visual-language-facts.md)). 외부 값 출처(MIT snapshot, commit `f6961238d5cddcf8042a74a70fc400ec67181abb`): `docs/design/references/awesome-design-md/cursor.md`(timeline-read `#9fbbe0`, timeline-done `#c08532`, semantic-error `#cf2d56`, semantic-success `#1f8a65`), `docs/design/references/awesome-design-md/opencode.ai.md`(accent `#007aff`, danger `#ff3b30`, warning `#ff9f0a`, success `#30d158`), `docs/design/references/awesome-design-md/voltagent.md`(단일 accent `#00d992` 예약 규율만 채용).
- **제안:** D-4 승인 리뷰용 **후보 값 대안집 2세트**다. 아래 값은 모두 **후보(candidate)**이며, D-4 승인과 구현 검증 전까지 규칙·토큰·코드·config로 소비할 수 없다. 24-bit 전용으로만 관찰 가능한 값은 제외했고, 모든 후보는 ANSI 16/256 양쪽에서 관찰 가능하다.

  **후보 세트 A — Cursor 계열(저채도 pastel/semantic 혼합):**

  | Loop 상태 | 후보 hex(출처) | ANSI 16 후보 | ANSI 256 후보 |
  | --- | --- | --- | --- |
  | running | `#9fbbe0` (cursor timeline-read) | bright blue (94) | 110 |
  | failed | `#cf2d56` (cursor semantic-error) | red (91) | 161 |
  | attention | `#c08532` (cursor timeline-done, warm gold) | yellow (93) | 172 |
  | done | `#1f8a65` (cursor semantic-success) | green (92) | 71 |

  **후보 세트 B — OpenCode 계열(시스템 semantic 고채도):**

  | Loop 상태 | 후보 hex(출처) | ANSI 16 후보 | ANSI 256 후보 |
  | --- | --- | --- | --- |
  | running | `#007aff` (opencode accent) | bright blue (94) | 33 |
  | failed | `#ff3b30` (opencode danger) | red (91) | 203 |
  | attention | `#ff9f0a` (opencode warning) | yellow (93) | 214 |
  | done | `#30d158` (opencode success) | green (92) | 114 |

  **NO_COLOR·비-TTY 폴백:** 두 세트 모두 색이 꺼진 환경(`NO_COLOR`, 파이프, `--json`, 로그 캡처)에서는 상태 글리프와 텍스트 계층(`DP-20260925-2`의 bold/dim 단계)만으로 상태가 판독되어야 한다. 즉 폴백은 "무색 텍스트 계층 유지"이며, 색은 그 위에 덧대는 부가 신호다.
- **이유와 영향:** 외부 값을 비교 대안으로 접수하면 D-4 리뷰에서 발명 비용 없이 두 방향(저채도 vs 고채도)을 직접 비교할 수 있다. VoltAgent의 "단일 accent를 CTA·상태 pill에만 예약" 규율은 값이 아니라 강조 예산 제안(`DP-20260925-7`)의 근거로만 인용한다. **규율 충돌 확인:** (a) 줄 예산(status 8/attention 6/findings 5)과 충돌 없음 — 색은 줄 수를 바꾸지 않는다. (b) 무색 출력 경로와 충돌 없음 — R8 폴백을 제안 내에 명시했다. 출력 바이트 변화는 D-4 승인 후 S5 태스크 범위로 한정된다.
- **후속:** untriaged → design: design.md#5.4 (D-4 승인 리뷰에서 세트 A/B 중 선별 또는 기각; 승인 시 integration 태스크가 정본에서 확인한 값만 투영)
<!-- design-proposal:end DP-20260925-5 -->

<!-- design-proposal:start DP-20260925-6 -->
### DP-20260925-6 — 불릿 글리프 대안집 비교표 (외부 corpus 값 후보)
- **상태:** proposed
- **제안자:** lead-seed (external corpus value intake, [ADR 개정](../decisions/design-reference-corpus.md#개정--외부-값의-제안-lane-후보-반입-허용-2026-09-25)에 따른 최초 접수)
- **대상:** [`design.md`](design.md) §5.4 D-3 불릿 어휘, R1·R12, [`DP-20260925-4`](#dp-20260925-4--글리프를-아이콘이-아닌-텍스트-콘텐츠로-규정)
- **현재 근거:** Loop 내부 — [`design.md`](design.md) §5.4 D-3 pending(성공 `✓`/경고 `!`/중립 `-` 3역할, 값 불변 단계), R1(어휘 단일 원천), R12(무결성 테스트), 감사 P2-1(포맷터별 글리프 하드코딩). 외부 값 출처(MIT snapshot, commit `f6961238d5cddcf8042a74a70fc400ec67181abb`): `docs/design/references/awesome-design-md/opencode.ai.md` — ASCII 브래킷 불릿 `[+]`/`[-]`/`[x]`를 "별도 아이콘이 아니라 텍스트 콘텐츠의 일부"로 규정.
- **제안:** D-3 승인 리뷰용 **글리프 후보 대안 비교표**다. 아래 어느 값도 후보이며, D-3 승인과 구현 검증 전까지 규칙·어휘 모듈로 소비할 수 없다. 기본안은 **Loop 현행 값 유지**다.

  | Loop 역할 | 대안 1: 현행 유지(기본안) | 대안 2: OpenCode ASCII 브래킷 | 대안 3: 하이브리드 |
  | --- | --- | --- | --- |
  | success/done | `✓` | `[+]` | `✓` |
  | warning/attention | `!` | `[x]` | `[!]` |
  | neutral/제거 | `-` | `[-]` | `-` |
  | running | (글리프 없음, 단어) | (대응 값 없음) | `…` 후보 별도 검토 필요 |

  비교 근거: 대안 2는 전 문자가 ASCII 1셀 폭이라 동아시아 터미널 폭 문제가 없지만, OpenCode에서 `[x]`는 부정(실패 아님)이므로 역할 대응이 왜곡될 수 있고 running 역할이 집합에 없다. 대안 1·3은 `✓`가 East Asian Ambiguous 폭으로 렌더링될 수 있다는 리스크를 안는다. 모든 대안은 단일 코드포인트 또는 순수 ASCII 텍스트로 `DP-20260925-4`의 "아이콘 금지" 규칙과 양립한다.
- **이유와 영향:** D-3은 값 불변(현행 `✓`/`!`/`-`)이 원칙이므로 이 대안집은 값 교체를 제안하지 않고, 리뷰에서 폭·역할 대응 리스크를 표로 소진시키기 위한 비교 재료다. **규율 충돌 확인:** (a) 줄 예산과 충돌 없음 — 글리프 교체는 줄 수를 바꾸지 않는다. (b) 무색 출력 경로와 충돌 없음 — 모든 후보가 색 비의존 텍스트다.
- **후속:** untriaged → design: design.md#5.4 (D-3 승인 리뷰에서 대안 선별 또는 기각; 기본안은 현행 값 유지)
<!-- design-proposal:end DP-20260925-6 -->

<!-- design-proposal:start DP-20260925-7 -->
### DP-20260925-7 — 표면당 강조 예산 후보 수치 (외부 규율에서 파생한 값 후보)
- **상태:** proposed
- **제안자:** lead-seed (external corpus value intake, [ADR 개정](../decisions/design-reference-corpus.md#개정--외부-값의-제안-lane-후보-반입-허용-2026-09-25)에 따른 최초 접수)
- **대상:** `config/policy.toml [output]`, [`design.md`](design.md) §4·D-4, [`DP-20260925-3`](#dp-20260925-3--표면-단위-강조-예산-색-bold-희소성-규율)
- **현재 근거:** Loop 내부 — `config/policy.toml [output]`의 status 8/attention 6/findings 5/list 8 줄 예산, [`DP-20260925-3`](#dp-20260925-3--표면-단위-강조-예산-색-bold-희소성-규율)("상한 값은 관찰 후 확정" 명시), 감사 P1-1. 외부 규율 출처(MIT snapshot, commit `f6961238d5cddcf8042a74a70fc400ec67181abb`): `docs/design/references/awesome-design-md/voltagent.md`(단일 accent를 CTA·상태 pill에만 예약), `docs/design/references/awesome-design-md/ollama.md`(fold당 primary pill 최대 1개), `docs/design/references/awesome-design-md/clickhouse.md`(accent를 primary와 핵심 수치에 한정).
- **제안:** `DP-20260925-3`이 정의한 표면당 강조 상한의 **후보 수치 대안집 3세트**다. 어느 값도 후보이며, D-4 승인과 policy 키 구현 검증 전까지 config·규칙으로 소비할 수 없다.

  | 후보 | 수치 | 파생 근거 |
  | --- | --- | --- |
  | A: pill 1 규율 | 표면당 최강조(상태색+bold 동시 사용) 항목 1개 — attention 최상위 1항목만 | ollama "fold당 primary pill 1개" |
  | B: 예산 비례 | 표면당 강조 상한 = `min(3, ceil(줄 예산 / 2))` → status 4 / attention 3 / findings 3 | clickhouse accent 희소성 |
  | C: 역할 분리 상한 | 상태색은 R10 상태 행에 한정하고 표면당 상태색 행 ≤ 줄 예산의 1/2, 일반 bold ≤ 2 | voltagent 단일 accent 예약 |

- **이유와 영향:** 세 후보 모두 기존 줄 예산 안에서 소진되므로 출력 구조 변화가 0이고, `config/policy.toml` 키 1개 추가 범위다. 후보 A는 가장 엄격해 attention 이중 표현을 확실히 막지만 running 표현이 제한되고, 후보 B·C는 상태 다양성을 허용하며 소음 관리를 비례식에 위임한다. **규율 충돌 확인:** (a) 줄 예산과 충돌 없음 — 강조 상한은 줄 예산의 하위 제약이다. (b) 무색 출력 경로와 충돌 없음 — 상한은 ANSI 사용량 규율이므로 NO_COLOR 경로에서 자동으로 무의미하다.
- **후속:** untriaged → design: design.md#5.4 (D-4 승인 리뷰에서 후보 선별 또는 기각; 승인 시 policy 키 추가 태스크로 분리)
<!-- design-proposal:end DP-20260925-7 -->

### Notion 기반

> 출처: `docs/design/references/awesome-design-md/notion.md`(non-canonical 외부 참고 자료, MIT snapshot commit `f6961238d5cddcf8042a74a70fc400ec67181abb`). 그룹 단위 채택 시 이 그룹의 DP 전체를 `design.md` 승인 게이트 입력으로 일괄 검토할 수 있고, 다른 그룹과의 혼합은 개별 DP 승인으로 처리한다.

<!-- design-proposal:start DP-20260925-8 -->
### DP-20260925-8 — 무색 중립 잉크 계층 후보 어휘 (Notion 기반)
- **상태:** proposed
- **제안자:** lead-seed (external corpus value intake — Notion, [ADR 개정](../decisions/design-reference-corpus.md#개정--외부-값의-제안-lane-후보-반입-허용-2026-09-25)에 따른 접수)
- **대상:** [`design.md`](design.md) §5.2 R8, §3 강조 계층, [`DP-20260925-2`](#dp-20260925-2--색에-독립적인-텍스트-강조-계층-우선-정의)
- **현재 근거:** Loop 내부 — [`design.md`](design.md) R8(NO_COLOR 준수), `config/policy.toml [output]` 줄 예산(status 8/attention 6/findings 5), 감사 P1-1(우선순위 미반영)·P1-2(스타일 프리미티브 0개)([facts](research/2026-09-24-loop-visual-language-facts.md)). 외부 값 출처(MIT snapshot, commit `f6961238d5cddcf8042a74a70fc400ec67181abb`): `docs/design/references/awesome-design-md/notion.md` — 색 없이 7단계 중립 잉크(`ink-deep`→`ink`→`charcoal`/`slate`/`steel`/`stone`→`muted`)와 400/500 서체 두께(body-md vs body-md-medium)만으로 본문 위계를 만들고, semantic 색 3종은 이 중립 위계 위에 별도로 얹는다.
- **제안:** `DP-20260925-2`의 bold/dim 텍스트 계층의 **후보 어휘 대안**으로, 중립 강조 3~4단계(strong/body/mute, 필요 시 ghost)를 NO_COLOR 기본 경로의 위계 어휘로 정의한다. ANSI 속성 대응 후보: strong=bold, body=일반, mute=dim, ghost=dim(구현 검증 대상). Notion처럼 의미 색(상태색)은 이 위계에 덧대는 부가 신호로 한정한다.
- **이유와 영향:** 줄 예산 안의 텍스트 출력은 색이 꺼져도 강조 단계 수만으로 우선순위가 판독되어야 하며(감사 P1-1), Notion의 중립 잉크 위계는 "단계를 3~4수준으로 제한하면 단일 표면에서 위계가 판독된다"는 근거를 제공한다. 값(hex)은 D-4 전까지 소비할 수 없는 후보이고, 줄 수·출력 구조 변화는 0이다. ANSI 속성이므로 R11 경계 테스트·R12 무결성 테스트 대상에 포함된다.
- **후속:** untriaged → design: design.md#5.4 (D-4 리뷰에서 `DP-20260925-2`와 함께 단계 수·이름 선별 또는 기각)
<!-- design-proposal:end DP-20260925-8 -->

<!-- design-proposal:start DP-20260925-9 -->
### DP-20260925-9 — semantic 삼종 폐쇄와 상태색·강조 accent 역할 분리 후보 값 (Notion 기반)
- **상태:** proposed
- **제안자:** lead-seed (external corpus value intake — Notion, [ADR 개정](../decisions/design-reference-corpus.md#개정--외부-값의-제안-lane-후보-반입-허용-2026-09-25)에 따른 접수)
- **대상:** [`design.md`](design.md) §5.2 R7·R10, §5.4 D-4 색 1차 범위, [`DP-20260925-1`](#dp-20260925-1--작업-상태색과-일반-semantic-색의-namespace-분리)·[`DP-20260925-5`](#dp-20260925-5--상태색-후보-팔레트-외부-corpus-값-후보-대안집)
- **현재 근거:** Loop 내부 — [`design.md`](design.md) R7(색 역할 폐쇄 집합)·R10(`colorRoleFor(state)`), §5.4 D-4 pending, 감사 P1-1·P1-4([facts](research/2026-09-24-loop-visual-language-facts.md)). 외부 값 출처(MIT snapshot, commit `f6961238d5cddcf8042a74a70fc400ec67181abb`): `docs/design/references/awesome-design-md/notion.md` — semantic namespace를 success `#1aae39`·warning `#dd5b00`(노랑이 아닌 주황)·error `#e03131` 3종으로 폐쇄하고, 브랜드 primary(보라 `#5645d4`)와 링크 blue(`#0075de`)를 별도 역할로 분리해 "상태 신호"와 "행위 유도·강조"가 같은 색을 재활용하지 않게 한다.
- **제안:** D-4 승인 리뷰용 **상태색 후보 값 세트 C**(세트 A/B는 `DP-20260925-5`)다. 아래 값은 모두 **후보**이며, D-4 승인과 구현 검증 전까지 규칙·토큰·config로 소비할 수 없다. 함께 제안하는 규율: 상태색 namespace(R7 폐쇄 집합)를 최소 3종으로 폐쇄하고, 일반 강조·링크에 쓸 accent 역할은 상태색 값을 재활용하지 않는다(`DP-20260925-1`의 규율을 값 후보로 보강).

  | Loop 상태 | 후보 hex(출처) | ANSI 16 후보 | ANSI 256 후보 |
  | --- | --- | --- | --- |
  | running | (대응 값 없음 — corpus 표면에 진행 상태 없음) | — | — |
  | failed | `#e03131` (notion semantic-error) | red (31) | 124 |
  | attention | `#dd5b00` (notion semantic-warning, 주황) | 노랑 (33, #aa5500 계열) | 130 |
  | done | `#1aae39` (notion semantic-success) | green (32) | 29 |

  주황 계열 attention 후보는 노랑 대비 흑백·저채도 환경 판독에 유리하다는 점이 파생 근거다. **NO_COLOR·비-TTY 폴백:** 색이 꺼진 환경(`NO_COLOR`, 파이프, `--json`, 로그 캡처)에서는 상태 글리프와 텍스트 계층(`DP-20260925-2`, 후보 어휘는 `DP-20260925-8`)만으로 상태가 판독되어야 한다.
- **이유와 영향:** semantic 폐쇄(3종)와 accent 분리는 감사 P1-4(시각 체계 이중화)의 재발을 막는 소유 규칙이며, 세트 C는 `DP-20260925-5`의 세트 A/B와 D-4 리뷰에서 직접 비교된다. running 후보 공백은 corpus가 정직하게 기록한 것으로, running 값은 세트 A/B 또는 별도 출처에서 보완한다. 출력 바이트 변화는 D-4 승인 후 S5 태스크 범위로 한정된다.
- **후속:** untriaged → design: design.md#5.4 (D-4 승인 리뷰에서 세트 A/B/C 비교 후 선별 또는 기각)
<!-- design-proposal:end DP-20260925-9 -->

### Slack 기반

> 출처: `docs/design/references/awesome-design-md/slack.md`(non-canonical 외부 참고 자료, MIT snapshot commit `f6961238d5cddcf8042a74a70fc400ec67181abb`). 그룹 단위 채택 시 이 그룹의 DP 전체를 `design.md` 승인 게이트 입력으로 일괄 검토할 수 있고, 다른 그룹과의 혼합은 개별 DP 승인으로 처리한다.

<!-- design-proposal:start DP-20260925-10 -->
### DP-20260925-10 — 상태색 후보 값 세트 D와 무색 폴백 (Slack 기반)
- **상태:** proposed
- **제안자:** lead-seed (external corpus value intake — Slack, [ADR 개정](../decisions/design-reference-corpus.md#개정--외부-값의-제안-lane-후보-반입-허용-2026-09-25)에 따른 접수)
- **대상:** [`design.md`](design.md) §5.2 R7·R8·R10, §5.4 D-4 색 1차 범위, [`DP-20260925-5`](#dp-20260925-5--상태색-후보-팔레트-외부-corpus-값-후보-대안집)
- **현재 근거:** Loop 내부 — [`design.md`](design.md) R7(색 역할 폐쇄 집합)·R8(NO_COLOR 준수)·R10(`colorRoleFor(state)`), §5.4 D-4 pending(ANSI 16색 시작), 감사 P1-1([facts](research/2026-09-24-loop-visual-language-facts.md)). 외부 값 출처(MIT snapshot, commit `f6961238d5cddcf8042a74a70fc400ec67181abb`): `docs/design/references/awesome-design-md/slack.md` — semantic-success `#007a5a`(활성/긍정), semantic-error `#cc4117`, 링크 blue `#1264a3`을 aubergine 브랜드 색과 별도로 소수만 유지한다.
- **제안:** D-4 승인 리뷰용 **상태색 후보 값 세트 D**다. 아래 값은 모두 **후보**이며, D-4 승인과 구현 검증 전까지 규칙·토큰·config로 소비할 수 없다. Slack corpus에는 경고(attention) 대응 톤이 없어 이 세트는 3상태만 제시하고 attention는 `DP-20260925-5` 세트 A/B·세트 C(`DP-20260925-9`)를 참조한다.

  | Loop 상태 | 후보 hex(출처) | ANSI 16 후보 | ANSI 256 후보 |
  | --- | --- | --- | --- |
  | running | `#1264a3` (slack link-blue) | blue (34) | 25 |
  | failed | `#cc4117` (slack semantic-error) | red (31) | 130 |
  | attention | (대응 값 없음 — corpus에 경고 톤 부재, 세트 A/B·C 참조) | — | — |
  | done | `#007a5a` (slack semantic-success) | green (32) | 23 |

  **NO_COLOR·비-TTY 폴백:** 색이 꺼진 환경(`NO_COLOR`, 파이프, `--json`, 로그 캡처)에서는 상태 글리프와 텍스트 계층(`DP-20260925-2`)만으로 상태가 판독되어야 한다. 링크 blue를 running에 쓰는 후보는 "링크와 상태의 값 재활용" 리스크가 있어(`DP-20260925-1` 규율), 리뷰에서 명시적으로 기각하거나 running 전용 값으로 치환해야 한다.
- **이유와 영향:** 세트 D는 D-4 리뷰에서 저채도(세트 A)·고채도(세트 B)·주황 경고(세트 C)에 이어 "소수 semantic + 차분한 링크톤" 방향을 비교 재료로 추가한다. 값 도입 외 출력 구조 변화는 없고, 줄 예산과 충돌하지 않는다.
- **후속:** untriaged → design: design.md#5.4 (D-4 승인 리뷰에서 세트 A/B/C/D 비교 후 선별 또는 기각)
<!-- design-proposal:end DP-20260925-10 -->

<!-- design-proposal:start DP-20260925-11 -->
### DP-20260925-11 — 표면당 최강조 1개 희소 규율 후보 (Slack 기반)
- **상태:** proposed
- **제안자:** lead-seed (external corpus value intake — Slack, [ADR 개정](../decisions/design-reference-corpus.md#개정--외부-값의-제안-lane-후보-반입-허용-2026-09-25)에 따른 접수)
- **대상:** `config/policy.toml [output]`, [`design.md`](design.md) §4·§5.4 D-4, [`DP-20260925-3`](#dp-20260925-3--표면-단위-강조-예산-색-bold-희소성-규율)·[`DP-20260925-7`](#dp-20260925-7--표면당-강조-예산-후보-수치-외부-규율에서-파생한-값-후보)
- **현재 근거:** Loop 내부 — `config/policy.toml [output]` 줄 예산(status 8/attention 6/findings 5), 감사 P1-1(우선순위 미반영), [`DP-20260925-7`](#dp-20260925-7--표면당-강조-예산-후보-수치-외부-규율에서-파생한-값-후보) 후보 A(pill 1 규율). 외부 규율 출처(MIT snapshot, commit `f6961238d5cddcf8042a74a70fc400ec67181abb`): `docs/design/references/awesome-design-md/slack.md` — "viewport당 filled aubergine 버튼 1개"를 명문화해 최강조를 희소하게 유지하고, 상태 pill은 `rounded.xs`의 "rare" 용도로만 남기며, 나머지 강조는 무채 위계(ink vs ink-mute)로 해소한다.
- **제안:** `DP-20260925-7` 후보 A의 **추가 파생 근거로 Slack 규율을 채택**하고, 구체 후보로 "상태색+bold 동시 사용(최강조)은 표면당 attention 최상위 1항목으로 한정, 나머지 상태 행은 텍스트 계층(`DP-20260925-2`)만"을 D-4 리뷰에 접수한다. policy 키 1개(`[output]` 강조 상한)로 소유하며 값 확정은 관찰 후위임한다.
- **이유와 영향:** 감사 P1-1의 근원(모든 상태가 시각적으로 동등)을 "최강조 1개 + 무채 위계" 구조로 직접 겨냥하며, 줄 예산의 하위 제약이라 출력 구조 변화가 0이다. running 표현 제한 리스크는 `DP-20260925-7` 비교표에서 후보 A와 함께 검토한다. **규율 충돌 확인:** (a) 줄 예산과 충돌 없음. (b) 무색 출력 경로와 충돌 없음 — 상한은 ANSI 사용량 규율이므로 NO_COLOR 경로에서 자동으로 무의미하다.
- **후속:** untriaged → design: design.md#5.4 (D-4 승인 리뷰에서 `DP-20260925-7` 후보와 병합 검토)
<!-- design-proposal:end DP-20260925-11 -->

### 기타 corpus 기반(OpenCode·Cursor·VoltAgent 등)

> OpenCode·Cursor·VoltAgent·Warp·Ollama·ClickHouse 등 단일 출처에서 파생한 후보를 이후 접수할 때 사용하는 그룹이다. 기존 `DP-20260925-1`~`7`은 복수 출처 혼합이므로 공통/혼합 기반에 유지된다. 그룹 단위 채택 시 이 그룹의 DP 전체를 `design.md` 승인 게이트 입력으로 일괄 검토할 수 있고, 다른 그룹과의 혼합은 개별 DP 승인으로 처리한다.

## 0. 채택 판정과 문서 수명주기

**판정: 조건부 채택.** Loop는 Stitch식 문서를 에이전트가 CLI/TUI의 현재 시각 언어를 빠르게 읽는 **파생 read model**로 채택한다. 배치 위치는 루트 `DESIGN.md`가 아니라 `docs/design/design-language.md`다. 루트 파일은 자동 발견에는 유리하지만, 기존 종합 조사가 지적한 것처럼 변경 설계·ADR·presentation 상수에 이어 독립적인 제3의 원천으로 오인될 위험이 더 크다. `docs/design/` 배치는 동명 문서의 관계와 승인 상태를 함께 드러내며, 이 문서가 값을 독립 결정하지 않는다는 경계를 보존한다.

공식 Stitch 문서는 `DESIGN.md`를 `AGENTS.md`의 디자인 대응물, 즉 프로젝트가 “how the project should look and feel”을 설명하는 “living artifact”로 정의한다([공식 Overview](https://stitch.withgoogle.com/docs/design-md/overview/)). 또한 YAML 토큰을 normative value, Markdown을 적용 맥락으로 구분한다([공식 Specification](https://stitch.withgoogle.com/docs/design-md/specification/)). 이 초안은 그 구조를 참고하되, 아직 승인되지 않은 값을 normative YAML에 넣지 않는다.

수명주기는 다음처럼 분리한다.

| 문서/원천 | 역할 | 갱신 시점 |
| --- | --- | --- |
| [`docs/design/design.md`](design.md) | EARS 요구사항, 대안, 설계, 승인 게이트, 태스크와 검증을 소유하는 **변경 설계 문서** | 변경을 제안·검토·승인할 때 |
| ADR·presentation 상수/테스트·`config/policy.toml` | 승인된 결정과 실행되는 규범 값의 정본 | 결정 승인 및 구현 시 |
| 이 문서 | 승인된 현재 시각 언어를 에이전트용으로 투영하는 **시각 truth/read model** | `design.md` 승인과 구현 검증 뒤, 정본에서 확인한 값으로 갱신 |

- 이 문서는 EARS 요구사항, 태스크 상태, 승인 결과 또는 completion contract를 복제하거나 변경하지 않는다.
- 이 문서와 실행 값이 다르면 ADR·코드/테스트·운영 config가 우선하며, 이 문서를 수정한다.
- D-1·D-3·D-4 승인 전에는 아래 관찰값을 미래 canonical 규칙으로 해석하지 않는다.

## 1. Overview / Tone

Loop의 CLI/TUI 표면은 장식보다 작업 상태와 다음 행동의 빠른 판독을 우선한다. 현재 공통 표면은 presentation 스냅샷, CLI 리포트, herdr 워커 라벨이며, 텍스트 중심으로 동작한다.

이 문서가 다루는 것은 사용자가 보는 어휘·밀도·터미널 표현이다. 변경 이유와 구현 계획은 [`design.md`](design.md)가 소유한다. 새 표현을 추측해서 추가하지 말고, 관찰된 현재 값 또는 승인·검증된 값만 기록한다.

## 2. Colors / Semantic Roles

현재 CLI/presentation 내용 출력은 **무색 텍스트**다. 관찰된 유일한 ANSI 이스케이프는 watch 화면의 clear+home이며, 색 토큰은 아니다. pi 내부 표면은 별도 pi theme 역할을 사용하고 herdr 탭은 색 없는 텍스트 라벨을 사용한다.

- **pending approval: D-4 — 승인 대기.** 색 역할 집합, 최초 적용 표면, ANSI 범위는 아직 canonical 규칙이 아니다.
- **pending approval: D-1 — 승인 대기.** 색과 어휘의 토큰 명명 규칙은 아직 확정되지 않았다.
- 따라서 이 초안의 YAML에는 `colors`나 토큰 경로를 선언하지 않는다.
- 색이 승인되기 전에도 상태·경고·성공의 의미를 색만으로 전달한다고 가정하지 않는다.

## 3. Typography & Glyph Vocabulary

현재 표면은 터미널 텍스트 계층을 사용하며 별도 font family나 크기 토큰을 정의하지 않는다. 관찰된 표현 어휘는 다음과 같다.

| 종류 | 현재 관찰값 | 현재 의미와 경계 |
| --- | --- | --- |
| 글리프 | `✓` | doctor 등의 성공 출력에서 관찰됨 |
| 글리프 | `!` | 경고·스킵 출력에서 관찰됨 |
| 글리프 | `-` | cleanup 제거 항목에서 관찰됨 |
| 목록 구분자 | `·` | 항목과 워커 라벨의 부분 구분에 사용됨 |
| 라벨 구분자 | `: ` | 라벨과 값 사이에 사용됨 |
| 의존 방향 | `←` | 의존 관계 표시에 사용됨 |

**pending approval: D-3 — 승인 대기.** `✓`/`!`/`-`는 현재 출력에 존재하지만 success/warning/neutral의 canonical 불릿 체계로 아직 승인되지 않았다. 에이전트는 이 값을 새 표면의 규범으로 확장하지 않는다.

OpenCode 큐레이션 예시가 `[+]`/`[-]`/`[x]`를 별도 아이콘이 아닌 텍스트 내용으로 규정하듯([원문](https://raw.githubusercontent.com/VoltAgent/awesome-design-md/f6961238d5cddcf8042a74a70fc400ec67181abb/design-md/opencode.ai/DESIGN.md)), Loop도 글리프를 복사·로그 출력에 남는 텍스트 어휘로 취급한다. 단, 그 예시의 글리프 값을 Loop로 가져오지는 않는다.

## 4. Layout & Spacing

Loop의 확인된 밀도 규칙은 픽셀 간격이 아니라 논리 줄 예산이다.

| 출력 종류 | 기본 줄 예산 | 정본 |
| --- | ---: | --- |
| status | 8 | `config/policy.toml [output]` |
| attention | 6 | `config/policy.toml [output]` |
| findings | 5 | `config/policy.toml [output]` |

이 예산은 디자인 토큰이 아니라 `policy.toml → orchestrator config → renderer parameter`로 전달되는 운영 정책이다. 문서 안에 독립 토큰으로 복제하지 않는다. 목록 구분에는 현재 `·`가 쓰이지만, 정렬을 위해 임의의 장식·들여쓰기·빈 줄을 추가해 줄 예산을 잠식하지 않는다.

## 5. Components + Do's and Don'ts

### Empty states

현재 관찰된 빈 상태 문구는 다음과 같다.

- `No runs`
- `No tasks`
- `No active workers`
- `OK`
- `No models configured`

이는 현재 표면의 사실 목록이다. `No runs`는 CLI와 presentation에 중복 정의되어 있으며, 이 문서가 그 중복을 해소하거나 새 canonical 문자열을 결정하지 않는다.

### Do

- 현재 표면을 설명할 때 `✓`, `!`, `-`, `·`와 빈 상태 문구를 관찰값으로 정확히 인용한다.
- status 8줄, attention 6줄, findings 5줄 예산을 지킨다.
- 변경 제안·승인·검증은 [`design.md`](design.md)에 연결하고, 승인된 실행 값은 정본 코드·테스트·config에서 확인한다.
- 알려지지 않은 상태는 추측해 채우지 않고 아래 pending 결정으로 남긴다.

### Don't

- D-1 승인 전에 점 경로 등 토큰 명명을 canonical로 선언하지 않는다.
- D-3 승인 전에 `✓`/`!`/`-`를 새 표면의 semantic 역할로 확장하지 않는다.
- D-4 승인 전에 색 역할, ANSI 색 값 또는 적용 범위를 발명하지 않는다.
- 웹 사례의 spacing, breakpoint, shadow, radius, font 또는 palette를 CLI/TUI 규칙으로 복사하지 않는다.
- 이 문서에서 EARS 요구사항·태스크·승인 상태를 새로 만들거나 `design.md`를 override하지 않는다.

VoltAgent 큐레이션의 Ollama 예시는 관찰되지 않은 상태 팔레트를 억지로 채우지 않고 “effectively no error/success/warning palette”라고 명시한다([원문](https://raw.githubusercontent.com/VoltAgent/awesome-design-md/f6961238d5cddcf8042a74a70fc400ec67181abb/design-md/ollama/DESIGN.md)). Loop도 같은 방식으로 미확정 영역을 값 대신 gap으로 보존한다.

## 6. Known Gaps and Pending Decisions

| 결정 | 상태 | 이 문서에서 금지되는 선취 |
| --- | --- | --- |
| D-1 토큰·어휘 명명 | **pending approval / 승인 대기** | 이름·경로·alias 규칙의 normative YAML 선언 |
| D-3 불릿/글리프 의미 | **pending approval / 승인 대기** | 현재 `✓`/`!`/`-`를 미래 canonical 역할로 선언 |
| D-4 색 범위 | **pending approval / 승인 대기** | semantic role, ANSI 단계, 최초 소비자 확정 |

승인 게이트 이후에는 정본 구현과 테스트를 먼저 확인한 다음 이 표와 관련 섹션을 갱신한다. 그 전까지 이 파일의 `draft` 상태를 유지한다.

## 7. Provenance

- 변경 설계와 승인 상태: [`docs/design/design.md`](design.md)
- 현재 표면 감사의 정리: [`2026-09-24-loop-visual-language-facts.md`](research/2026-09-24-loop-visual-language-facts.md)
- Stitch 공식 형식과 사례 비교: [`2026-09-24-stitch-design-md-study.md`](research/2026-09-24-stitch-design-md-study.md)
- 루트 `DESIGN.md`의 제3 원천 위험을 포함한 기존 판정: [`2026-09-24-design-skill-synthesis.md`](research/2026-09-24-design-skill-synthesis.md)
- 공식 1차 출처: [Stitch Overview](https://stitch.withgoogle.com/docs/design-md/overview/) · [Stitch Specification](https://stitch.withgoogle.com/docs/design-md/specification/)
- 제3자 예시 원문: [OpenCode](https://raw.githubusercontent.com/VoltAgent/awesome-design-md/f6961238d5cddcf8042a74a70fc400ec67181abb/design-md/opencode.ai/DESIGN.md) · [Ollama](https://raw.githubusercontent.com/VoltAgent/awesome-design-md/f6961238d5cddcf8042a74a70fc400ec67181abb/design-md/ollama/DESIGN.md) · [VoltAgent](https://raw.githubusercontent.com/VoltAgent/awesome-design-md/f6961238d5cddcf8042a74a70fc400ec67181abb/design-md/voltagent/DESIGN.md)

`awesome-design-md` 문서는 제품 팀의 공식 디자인 시스템이 아니라 공개 표면을 분석한 제3자 예시다. Loop는 그 구성법과 known-gap 관행만 참고하며, 규범 값은 Loop 내부 승인 근거에서만 가져온다.
