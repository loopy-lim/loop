# 개선 사이클 범위 — D1 어휘 토큰화·watch-columns 철회 정리·커밋 계획

- **Date:** 2026-09-25
- **Status:** decided
- **Kind:** decision (`decide-improvement-cycle`)
- **Read scope:** `docs/decisions/**`, `docs/design/design-foundations.md`, `docs/design/research/live-agents-design-comparison.md`, `docs/design/research/loop-ui-audit.md`, `packages/presentation/**`, `git` (워크트리 상태·과거 커밋 관례)
- **Write scope:** 본 문서 (`docs/decisions/2026-09-25-improvement-cycle.md`)
- **근거 문서:**
  - `docs/design/design-foundations.md` — D1 권고와 2주 계획 S1–S4(§4.2, §5), 후속 결정 D-1~D-6(§6)
  - `docs/design/research/live-agents-design-comparison.md` — 메커니즘 1(공용 모듈 소유)·3(기계적 강제)의 3개 실구현(pi/codex/agy) 확정 증거(§0, §6.1, §6.3)
  - `docs/design/research/loop-ui-audit.md` — P2(어휘 중복) 문제 목록과 근거 file:line
  - `docs/decisions/2026-09-24-watch-columns.md` — 철회 대상 ADR(현 Status: decided)
  - `docs/design/research/watch-columns-review.md` — watch-columns 구현 검증 기록(PASS 조건부, F-1~F-4)
  - `docs/decisions/2026-09-24-herdr-inline-conversation-panes.md` / `2026-09-24-herdr-live-conversation-tabs.md` / `docs/design/research/herdr-tabs-revert-review.md` — 분리 화면 방향 기각의 선례와 미러·배치 정리 완료 증거

## 배경과 범위

워크트리에 미커밋 변경 14파일(+877/−83)과 신규 소스·문서가 섞여 있다. 구성은 세 부류다: (a) herdr 라이브 대화 탭 기능(검증 완료 — `herdr-tabs-revert-review.md` PASS), (b) watch 컬럼 배치 구현(사용자가 분리 화면 방향을 기각하여 철회 대상), (c) 디자인 파운데이션 조사·권고 문서군. 동시에 live-agents 비교 3건이 모두 확정한 D1(표현 어휘 단일 원천)이 미구현 상태다. 본 결정은 이 사이클에서 무엇을 할지 확정한다: D1의 이번 사이클 구현 범위, watch-columns 잔여물의 처리, 전체 변경의 커밋 배분.

다음은 의도적으로 본 결정의 대상이 아니다.

- D2(색 역할·환경 가드), D3의 경계 테스트 확장 — 파운데이션 §5 2주차 범위로 유지. 단 S1에 딛는 최소 무결성 테스트는 D1에 포함한다(§결정-1).
- S3 포맷터 4종 이관·`renderRuns` 이중 구현 제거·`formatSnapshot` `replace()` 제거 — D1의 후속 단계로 분리한다(§결정-1의 제외 항목).
- herdr 미러·배치 잔여물 정리 — 이미 선행 사이클에서 완료됐다(inline-panes ADR 폐기 기록, revert 검증 PASS). 본 사이클은 재처리하지 않고 상호 참조로만 연결한다.
- D-1(토큰 이름 규칙), D-3(cleanup `-` 글리프 통일) 등 파운데이션 §6 후속 결정 — 값 변경을 수반하므로 본 사이클(바이트 동일 원칙)과 양립하지 않는다. 기각하지 않고 후속 결정으로 유지한다.

## 결정

### 1. D1 표현 어휘 토큰 모듈 — 이번 사이클 범위

**채택: 파운데이션 §5 1주차의 S1+S2와 main.ts의 어휘 상수화(S4의 상수 이동 반)만 수행한다.** 출력은 바이트 단위 동일을 원칙으로 한다 — 동일 문자열의 상수화만 하고, 글리프·문구·정렬의 표시 변화는 일절 없다. 이는 live-agents 비교가 3개 실구현에서 공통 확인한 "화면 문법의 공용 모듈 소유"(codex `popup_consts.rs` "uniform feel", agy `render/` 관문, pi 표준 문구)의 최소 구현 형태다.

**신설 모듈:** `packages/presentation/src/tokens.ts` (무색, 색 역할은 신설하지 않음 — 자리만 주석으로 표기). 내용:

| 그룹 | 상수 | 근거 위치(현행 하드코딩) |
| --- | --- | --- |
| 상태 글리프 | `success: "✓"`, `warning: "!"`, cleanup 불릿 `-`(D-3 결정 전까지 현행값 보존, 이름에 근거 주석) | `main.ts:558,561,564,586,629` |
| 구분자 | `list: "·"`, `depends: "←"` | `snapshot.ts` 다수, `main.ts:586` |
| 빈 상태 | `noRuns: "No runs"`, `noTasks: "No tasks"`, `noActiveWorkers: "No active workers"`, `attentionOk: "OK"`, `noModels: "No models configured"` | `snapshot.ts:54,86,105,118`, `main.ts` models 포맷터 |
| overflow 팩토리 | `moreItems(n, noun)` → `… {n} more {noun}` 계약(`ui-output-limits.md` 규칙 2), 부가 정보 인자 지원(`… N more checks (F failed, P passed)`) | `snapshot.ts:58,81,100,111,141,150,169,179,206`, `main.ts:130,570,602,614,635` |

**교체 대상 호출점:** `snapshot.ts`(overflow 람다 9곳·빈 상태 4곳·구분자), `compact.ts`(말줄임 `…` — `compactLines` 계약 일부), `main.ts`(위 표의 포맷터 내 어휘). `renderRuns`·`renderTaskContext` 등 presentation 내부 함수 본문의 어휘도 동일 원칙으로 교체한다.

**동반 최소 무결성 테스트** (`packages/presentation/test/tokens.test.ts`): (a) 모든 overflow 팩토리 출력이 `… \d+ more ` 정규식 준수, (b) 빈 상태 상수 상호 중복 없음, (c) 글리프·구분자 상수 존재와 값 고정. D3의 전체 무결성(상태 9종 매핑 등)은 색 역할 도입 시로 남긴다.

**이번 사이클 제외(후속 D1-S3로 분리):** `main.ts` 포맷터 4종(doctor/benchmark/models/cleanup)의 presentation 이관, CLI `renderRuns` 인라인 복제 삭제, `formatSnapshot` 표시명 파라미터화(`replace()` 제거). 이유: 본 사이클이 이미 watch-columns 제거와 herdr 커밋 정리를 포함해 변경 면이 넓다. 어휘 상수화만으로 감사 P2의 "단일 원천 부재"는 1차 해소되고, S3는 소유권 이동(순수 리팩터링)으로 별도 커밋·별도 리뷰가 정확한 단위다. 호출점 교체는 이전 커밋 revert로 롤백 가능하다(파운데이션 §5 위험/롤백 계승).

### 2. watch-columns 잔여물 처리

**채택: ADR 상태를 기각으로 표기하고, 컬럼 배치 코드는 전부 제거한다.**

**ADR 상태 표기:** `docs/decisions/2026-09-24-watch-columns.md`의 `Status: decided`를 `rejected`(사용자 결정, 2026-09-25 — 분리 화면 방향 기각)로 갱신하고, 본문 하단에 폐기 기록 섹션을 추가한다(`2026-09-24-herdr-inline-conversation-panes.md`의 폐기 기록 형식을 따른다). 기각 사유는 사용자 결정이며 기술적 결함이 아님을 명시한다 — 구현·검증 자체는 `watch-columns-review.md` 기준 완료됐다(PASS 조건부, F-1 정책 키 미이행은 무의미化: 코드 제거로 F-1~F-3은 소멸). 조사·검증 문서는 증거 기록으로 존치한다.

**코드 제거 대상 (layout.ts 컬럼 배치 코드 제거 결정):**

| 파일 | 처리 |
| --- | --- |
| `packages/presentation/src/layout.ts` | 삭제 — 산식 상수(`COLUMN_MIN_WIDTH` 등), `columnCountForWidth`, `displayWidth`/`clampCell`/`padCell` 전부 watch 컬럼 렌더 전용 |
| `packages/presentation/src/snapshot.ts` | watch 컬럼 렌더러 제거(+106행: `renderWatch`, `watchColumnPriority`, `WATCH_CHROME_ROWS`, `watchTaskBlock` 등) — HEAD(9e8d094) 상태로 복귀 |
| `packages/presentation/src/index.ts` | `export * from "./layout"` 제거 — HEAD 복귀 |
| `packages/presentation/test/layout.test.ts`, `test/watch-columns.test.ts` | 삭제 |
| `packages/cli/src/main.ts` | watch 분기 제거(`renderWatch` import, `view` 주입, `formatWatchFrame`) — HEAD 복귀 |

**검토된 대안:**

1. **`layout.ts` 그래펨 폭 헬퍼(`displayWidth` 등)만 존치** — 기각. D2(색) 도입 시 표시 폭 회계에 재사용할 수 있다는 가치가 있으나, 현재 소비자가 0인 죽은 코드다. 게다가 F-2가 지적했듯 `clampCell`은 ANSI 이스케이프를 보존하지 않고 제거하므로, 색이 들어오는 시점에는 어차피 계약을 다시 써야 한다. 저장소 선례(86413fa "죽은 코드 제거")와 AGENTS.md "확장 지점은 비용이 낮을 때만" 원칙상 지금 유지 비용(오독·경계 표면 확대)이 재작성 비용보다 크다. D2 착수 시 필요한 형태로 새로 쓴다.
2. **컬럼 코드를 설정 게이트 뒤에 존치** — 기각. `watch_layout` 정책 키가 구현되지 않았으므로(F-1) 게이트가 없고, 키를 추가하는 것은 기각된 방향에 코드를 계속 태우는 일이다.
3. **ADR 삭제** — 기각. 폐기된 결정도 의사 이력이다. herdr-inline-panes 선례대로 상태 표기로 남긴다.

**경계 명시:** `packages/providers/src/mirror.ts`·`types.ts`·`herdr-agent.ts`의 `steer` 추가와 herdr `client.ts` 변경은 watch-columns 잔여물이 아니라 `2026-09-24-herdr-live-conversation-tabs.md`(decided) 소속이다. 미러·배치 정리는 선행 사이클에서 완료됐다(revert 검증 PASS).

### 3. 커밋 계획 — 한국어 Conventional Commits

**원칙:** (a) 검증 완료된 기능을 먼저 확정해 스테이징 면을 줄이고, (b) 철회 제거는 단독 커밋으로 "HEAD 복귀"를 검증 가능하게 만들고, (c) D1은 제거 이후에 커밋해 snapshot.ts의 diff가 단일 목적(어휘 상수화)이 되게 한다. 각 커밋 직전 `bun run check` 통과를 조건으로 한다.

| # | 커밋 메시지 | 파일 배분 |
| --- | --- | --- |
| **C1** | `feat(herdr): 워커 라이브 대화 탭 — interactive 모드와 steer 채널` | `packages/herdr/src/client.ts`, `worker.ts`, `packages/herdr/test/lifecycle.test.ts`, `packages/providers/src/herdr-agent.ts`, `mirror.ts`, `types.ts`, `packages/providers/test/adapters-v2.test.ts`, `mirror.test.ts`, `pi-visibility.test.ts`, `herdr-agent-live.test.ts`(신규), `packages/orchestrator/test/visibility.test.ts`, `docs/decisions/2026-09-24-herdr-live-conversation-tabs.md`, `docs/decisions/2026-09-24-herdr-inline-conversation-panes.md` — c606722 선례(기능 커밋에 ADR 동봉) |
| **C2** | `docs(herdr): 탭 배치 진단과 복원 검증 기록` | `docs/findings/herdr-tab-placement-diagnosis.md`, `docs/research/2026-09-24-new-space-placement-diagnosis.md`, `docs/design/research/herdr-live-pane-survey.md`, `herdr-inline-panes-review.md`, `herdr-live-panes-review.md`, `herdr-tabs-revert-review.md` — 33898ad/5dd4bfa 선례(문서 단독 커밋) |
| **C3** | `chore(presentation): watch 컬럼 배치 철회 — 분리 화면 방향 기각` | §결정-2 제거 표 전부 + `docs/decisions/2026-09-24-watch-columns.md`(상태 갱신) + `docs/design/research/watch-columns-review.md`(검증 기록 존치). 커밋 후 `snapshot.ts`·`index.ts`·`main.ts`가 HEAD와 동일함을 `git diff HEAD -- <파일>` 공백 출력으로 확인 |
| **C4** | `docs(design): 디자인 파운데이션 조사·권고안과 design.md 워크플로` | `docs/design/design-foundations.md`, `docs/design/design.md`, `docs/design/research/{live-pi,live-codex,live-agy,live-agents-design-comparison,loop-ui-audit,oss-agent-ui-survey,design-system-practices,design-md-practices,design-md-review}.md`, `docs/decisions/design-md-workflow.md`, `.gitignore`(`.research-sources/`) — 조사 산출물과 그 원천 무시 규칙이 한 묶음. F-4의 분리 요구(컬럼 기능 커밋과의 분리)는 C3가 이미 충족 |
| **C5** | `feat(presentation): 표현 어휘 토큰 모듈 신설 — 하드코딩 어휘 상수화` | `packages/presentation/src/tokens.ts`(신설), `index.ts`(export 추가), `snapshot.ts`, `compact.ts`, `packages/cli/src/main.ts`, `packages/presentation/test/tokens.test.ts`(신설). 바이트 동일 원칙의 증거 = 기존 `packages/cli/test/cli.test.ts`·presentation 테스트 전체 무수정 통과 |

## 요구사항 (EARS + `R<n>`)

- **R1** — WHEN 구현 태스크가 D1을 수행하면, THE SYSTEM SHALL §결정-1 표의 상수를 `tokens.ts`에 신설하고 표기된 호출점을 교체하며, 출력을 바이트 동일로 유지한다. *검증: 기존 `cli.test.ts`·presentation 테스트 무수정 통과 + `bun run check`.*
- **R2** — WHEN watch-columns 잔여물을 정리하면, THE SYSTEM SHALL §결정-2 표의 파일을 제거하고 ADR에 rejected 상태와 폐기 기록을 남긴다. *검증: C3 커밋 후 해당 3파일(`snapshot.ts`·`index.ts`·`main.ts`)이 HEAD와 동일 + `bun run test:architecture`.*
- **R3** — WHEN 커밋을 만들면, THE SYSTEM SHALL §결정-3 표의 배분과 순서를 따르고 각 커밋 직전 전체 게이트를 통과시킨다. *검증: `git log` 묶음 대조 + 커밋 시점 `bun run check` 출력.*
- **R4** — IF 유료 모델 호출이 필요한 검증이 제안되면, THE SYSTEM SHALL 그것을 수행하지 않고 오프라인 단위·회귀 근거로 대체한다. *검증: AGENTS.md 검증 절 준수 기록.*

## 검증 계획

```bash
bun run check                       # 전체 게이트 (각 커밋 직전)
bun test packages/presentation      # D1 토큰·무결성 + 제거 후 회귀
bun test packages/cli               # 바이트 동일 회귀 (C3·C5)
bun run test:architecture           # 경계 (C3·C5)
git diff HEAD -- packages/presentation/src/snapshot.ts packages/presentation/src/index.ts packages/cli/src/main.ts   # C3 직후 공백 출력 확인
```

유료 모델 호출 0. "워커 성공"은 완료 근거가 아니며 위 명령 출력이 근거다.

## 결과 요약 (구현 태스크 전달)

- **D1 범위:** `tokens.ts` 신설(글리프 `✓`/`!`/cleanup `-` 보존, 구분자 `·`/`←`, 빈 상태 5종, overflow 팩토리) + `snapshot.ts`/`compact.ts`/`main.ts` 호출점 상수화 + 최소 무결성 테스트. 바이트 동일 원칙. S3 포맷터 이관은 제외(후속).
- **watch-columns 처리:** ADR `rejected` 표기 + 폐기 기록 추가, `layout.ts`·컬럼 렌더러·테스트·CLI 분기 전부 제거(HEAD 복귀), `watch-columns-review.md`는 증거로 존치. herdr steer/client 변경은 이 소속이 아님.
- **커밋 배분:** C1 feat(herdr) → C2 docs(herdr) → C3 chore(presentation) 철회 → C4 docs(design) → C5 feat(presentation) D1. 각 커밋 직전 `bun run check`.
