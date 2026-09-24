# Loop 현재 UI/디자인 상태 감사

- **일자:** 2026-09-24 KST
- **종류:** `research` (audit-loop-ui, attempt 1)
- **기준:** worktree `86413fa` (2026-09-24), 읽기 전용 감사 — 코드 변경 없음
- **읽기 범위:** `docs/**`, `packages/cli/**`, `packages/herdr/**`, `packages/presentation/**`
- **쓰기 범위:** 이 문서만
- **증거 경계:** 정적 소스 조사. 런타임 터미널 화면, Herdr 세션, pi TUI, provider 호출은 관측하지 않았다. `packages/pi-loop/**`, `pi-extensions/**`는 선언된 읽기 범위 밖이므로 `docs/` 내 문서와 import 그래프로만 확인했다(§1.4).

## 1. 현황 요약

### 1.1 UI 표면 인벤토리

| 표면 | 파일(줄 수) | 역할 | 스타일 수단 |
| --- | --- | --- | --- |
| 공통 축약 헬퍼 | `packages/presentation/src/compact.ts` (47) | 줄 정규화, grapheme 말줄임, overflow 카운트 요약 | 없음(순수 텍스트) |
| 스냅샷 렌더러 | `packages/presentation/src/snapshot.ts` (207) | status/graph/workers/attention/task-context/runs | 없음(순수 텍스트) |
| CLI 진입점·포맷터 | `packages/cli/src/main.ts` (909) | 디스패치 + doctor/benchmark/models/cleanup 포맷 + help + watch 루프 | 없음(ANSI 클리어 1곳) |
| 관찰 루프 | `packages/cli/src/dispatcher.ts` (50) | 100 ms 스냅샷 폴링, 변경 시 콜백 | 해당 없음 |
| 터미널 세션 어댑터 | `packages/herdr/src/client.ts` (691) | 워커 탭/페인 라이프사이클 + **표시 라벨 규칙** | 없음(라벨 텍스트만) |

`@loop/presentation`은 도메인 비의존 leaf로서 `compactLines`/`singleLine`/`renderSnapshot` 등을 제공하고, CLI(`main.ts:14`)와 pi-loop(`packages/pi-loop/src/ui/snapshot.ts:1` 재수출 포함 7파일)가 함께 소비한다. **레이아웃 예산 정책(`config/policy.toml [output]` 5키 → `packages/orchestrator/src/config.ts:165-175`)은 구현되어 있고 문서(`docs/decisions/ui-output-limits.md`)와 일치한다.** 즉 Loop에는 "줄 수 예산"이라는 얇은 디자인 정책은 존재하지만, 시각 언어(색·강조·상태 표현) 정책은 존재하지 않는다.

### 1.2 테마 메커니즘 유무

**없다.** CLI/presentation 전체에서 ANSI 이스케이프는 `main.ts:188`의 화면 클리어(`"\x1b[2J\x1b[H"`) 단 한 곳뿐이며, 색상·굵기·상태 색 지정 코드는 전무하다(`chalk`/색상 의존성도 없음). `NO_COLOR` 처리, TERM/TTY 능력 탐지도 없다. 반면 같은 제품의 pi 내부 표면(pi-extensions todo-widget)은 pi의 theme 토큰 8종(`accent/warning/success/dim/muted/text/toolTitle/error/borderMuted`, `docs/decisions/persona-ux.md` 배경 팩트 3)을 경유한다. 결과적으로 **하나의 제품 안에 "무색 텍스트 CLI"와 "토큰 기반 TUI"라는 두 개의 시각 체계가 병존하며, 공유 어휘가 없다.**

### 1.3 표시 어휘의 소유 지점

라벨/표시 명명 규칙은 세 곳에 나뉘어 있다: (1) 스냅샷 라인 어휘는 `snapshot.ts`, (2) CLI 전용 포맷(doctor의 `이름: 상세`, benchmark, cleanup)은 `main.ts`, (3) 워커 탭 라벨(`<taskId>·<kind>·a<attempt>`, `mirror·<taskId>`, 32자 예산)은 herdr 어댑터(`client.ts:548-591`)가 소유한다. 각 규칙 자체는 잘 문서화된 주석을 갖지만, 이를 하나로 묶는 "디자인 어휘" 문서는 없다.

### 1.4 문서 수준과 `docs/design/` 공백

- `docs/design/` 디렉터리에는 **`jwt-validation-middleware.md` 하나만 있고 UI/디자인과 무관하다.** 디자인 관련 지식은 `docs/decisions/`의 정책 결정 6건(`ui-output-limits.md`, `run-visibility.md`, `persona-ux.md`, `2026-09-23-worker-visibility.md`, `worker-tab-placement.md`, `pi-worker-pane-visibility.md`)에 파편화되어 있다.
- 이 결정들은 레이아웃 예산·라벨 형식·탭 배치 같은 **정책**은 정하지만, 시각 언어(색 역할, 타이포그래피, 상태 표현 규약), 디자인 토큰 정의, 화면/컴포넌트 카탈로그는 어디에도 없다.
- 기존 감사 2건(`docs/audits/cli-policy-inventory.md`, `docs/audits/pi-loop-output-inventory.md`)은 2026-09-21, `[output]` 정책 도입 **이전** 상태를 기록하며 현재 코드와 불일치한다(예: 당시 지적된 `slice(0, 7)` 하드코딩은 `compactLines` 도입으로 해소됨). 현재 코드 기준의 UI 감사는 본 문서가 최초다.

## 2. 문제 목록 (파일:줄 근거 포함)

### P1. 색·상태 시각화 계층 부재 — "불안정해 보이는" 근원 1

| # | 문제 | 근거 |
| --- | --- | --- |
| P1-1 | 상태(running/failed/attention/done)가 단어로만 구분되고 시각적으로 동등하게 출력됨. 우선순위 정렬은 있으나(`taskPriority`) 렌더링에는 반영 안 됨 | `packages/presentation/src/snapshot.ts:160-171`, `:126-145` |
| P1-2 | 전 코드베이스에서 유일한 ANSI가 화면 클리어. 스타일 프리미티브(색 래퍼, dim, bold) 0개 | `packages/cli/src/main.ts:188` |
| P1-3 | `NO_COLOR` 준수, TTY 여부 확인 없음. watch 비-JSON 경로가 비-TTY(파이프·로그 캡처)에서도 클리어 이스케이프를 무조건 방출 | `packages/cli/src/main.ts:188` |
| P1-4 | pi 내부 표면은 theme 토큰을 쓰는데 CLI는 무색 — 제품 내 시각 체계 이중화, 공유 토큰 없음 | `docs/decisions/persona-ux.md` 배경 팩트 3 vs `packages/presentation/src/**` 전체 무색 |

### P2. 표현 어휘(글리프·구분자·빈 상태·overflow 문구)의 중복·불일치

| # | 문제 | 근거 |
| --- | --- | --- |
| P2-1 | 성공/실패 글리프 `✓`/`!`가 두 포맷터에 각각 하드코딩. cleanup은 `-`/`!`라는 또 다른 조합 | `packages/cli/src/main.ts:574`, `:617` vs `:549`, `:552` |
| P2-2 | overflow 문구 12개 변종이 인라인 람다로 각 호출점에 중복 정의. 형식이 제각각(`more lines` / `more report lines (use --json …)` / `more checks (F failed, P passed)`). `ui-output-limits.md`의 `… {omitted} more {noun}` 계약은 각자 수작업으로 준수 중 | `packages/presentation/src/snapshot.ts:28,51,70,81,111,120,139,149` / `packages/cli/src/main.ts:558,590,602,623` |
| P2-3 | 빈 상태 문자열이 표면마다 독립 정의되고 `No runs`는 두 패키지에 이중 정의 | `packages/cli/src/main.ts:142`, `:598` / `packages/presentation/src/snapshot.ts:24,56,75,88` |
| P2-4 | runs 렌더링 이중 구현: CLI가 `renderRuns`를 쓰지 않고 동일 로직을 인라인 복제 (라벨 포맷·overflow 문구까지 복사) | `packages/cli/src/main.ts:130` vs `packages/presentation/src/snapshot.ts:23-31` |
| P2-5 | 포맷 후 문자열 수술: presentation이 `/loop` 접두어로 렌더한 안내줄을 CLI가 `replace`로 재작성. 명령 표시명을 인자로 받아야 할 것을 출력 역직렬화로 우회 | `packages/cli/src/main.ts:530` ↔ `packages/presentation/src/snapshot.ts:99` |
| P2-6 | 구분자 관행 불일치: 목록에는 `·`, 라벨에는 `Name: detail`, 그래프 의존성에는 `←` — 규약 문서 없이 관례로만 유지 | `packages/presentation/src/snapshot.ts:63`(`←`), `:9` 등(`·` 9곳), `packages/cli/src/main.ts:617`(`: `), `main.ts` 내 `·` 8곳 |

### P3. 레이아웃·갱신 안정성

| # | 문제 | 근거 |
| --- | --- | --- |
| P3-1 | watch가 매 갱신마다 전체 화면 하드 클리어 후 재출력. 커서·스크롤백 맥락 상실, 터미널별 플리커 여지(변경 시에만 재출력이라 빈도는 제한적) | `packages/cli/src/main.ts:188`, `docs/decisions/run-visibility.md` 결정 2 |
| P3-2 | 터미널 폭 미탐지. `line_text_limit = 160` grapheme 고정 — 좁은 터미널에서 물리 줄바꿈으로 8줄 예산이 깨져 레이아웃이 불안정해짐. 결정 문서는 "논리 줄" 한도임을 명시(알려진 한계)지만 체감 불안정의 직접 원인 | `packages/orchestrator/src/config.ts:175`, `docs/decisions/ui-output-limits.md` |
| P3-3 | herdr 라벨 예산(32자, 어댑터 소유)과 CLI 라인 예산(160 grapheme, 정책 소유)이 서로 다른 규칙 체계로 병존 — 단일 "Loop 표시 규격" 문서 없음 | `packages/herdr/src/client.ts:548-591` vs `config/policy.toml [output]` |

### P4. 구조 문제

| # | 문제 | 근거 |
| --- | --- | --- |
| P4-1 | `main.ts` 909줄 모놀리스: 인자 파싱·디스패치·포맷터 4종(doctor/benchmark/models/cleanup)·help·프로세스 스폰이 한 파일. CLI 전용 포맷터들이 presentation 계층 밖에 있어 표면별 스타일 규칙이 계속 갈라짐(P2의 원인 구조) | `packages/cli/src/main.ts:532-625`(포맷터군), `:791`(help), 총 909줄 |
| P4-2 | 워커 표시 라벨 규칙(`workerLabel`/`mirrorPaneLabel`/`KIND_ALIASES`)이 터미널 어댑터(herdr) 소유. 경계상 허용되나, 표시 어휘의 단일 원천이 프레젠테이션 계층 밖에 위치 | `packages/herdr/src/client.ts:548-591` |

## 3. 우선순위 3개 (후속 파운데이션 작업 권고 순서)

1. **표현 어휘 단일화 — `@loop/presentation`에 프리미티브 레이어 신설.** 상태 글리프(`✓`/`!`/`-`), 구분자, 빈 상태 상수, overflow 문구 팩토리(`moreLines(noun, …)`)를 한 모듈로 모으고 P2 전체(P2-1~P2-6, 특히 `main.ts:130` `renderRuns` 재사용과 `main.ts:530` replace 제거)를 호출점 교체로 해소한다. 색을 도입하기 전의 전제 작업이고, 기존 문자열 계약 테스트(`packages/cli/test/cli.test.ts` 64개 단언)가 회귀 망 역할을 하므로 위험이 가장 낮다.
2. **최소 토큰 기반 테마 계층 도입.** pi theme 토큰 어휘(`accent/warning/success/dim/error/…`, persona-ux.md 팩트 3)와 정합하는 Loop 자체 토큰 집합을 presentation에 두고, `NO_COLOR`·비-TTY 감지를 포함한다. 첫 소비자는 상태 색(running/failed/attention 구분, P1-1)과 watch 클리어 가드(P1-3)로 잡는다. herdr 라벨 예산과의 관계(P3-3)도 토큰 문서에 함께 규격화한다.
3. **watch 렌더링 안정화 + `docs/design/` 파운데이션 문서 신설.** 비-TTY 가드, 필요 시 부분 갱신, 터미널 폭 인식 `lineTextLimit`(P3-1~P3-2)을 개선하고, 분산된 6개 결정 문서를 인덱스하는 통합 디자인 파운데이션 문서(토큰 정의·어휘·화면 카탈로그·기존 감사 링크)를 `docs/design/`에 만들어 §1.4의 문서 공백을 닫는다. 본 감사가 그 입력이다.

## 부록: 검증

- 본 감사는 읽기 전용이며 코드·테스트 변경이 없으므로 `bun run check` 대상 변경도 없다.
- 완료 확인: `test -s docs/design/research/loop-ui-audit.md && grep -qiE '^## ' docs/design/research/loop-ui-audit.md`
