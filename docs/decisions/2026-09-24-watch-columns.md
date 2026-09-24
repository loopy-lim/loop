# Watch 사이드바이사이드 컬럼 배치 규격 — 라이브 화면 전용 컬럼 그리드

- **Date:** 2026-09-24
- **Status:** rejected (2026-09-25) — 사용자 결정: 분리 화면(사이드바이사이드 컬럼) 방향 기각. 폐기 기록은 아래 §폐기 기록.
- **Kind:** decision (`decide-watch-columns`)
- **Read scope:** `config/policy.toml`, `docs/decisions/**`, `docs/design/research/live-agents-design-comparison.md`, `packages/cli/src/main.ts`, `packages/presentation/**`
- **Write scope:** 이 결정 문서 (`docs/decisions/2026-09-24-watch-columns.md`)
- **근거 문서:** `docs/design/research/live-agents-design-comparison.md`(§0 보류 권고 — agy 크롬 회계 `ChromeLines`/`AvailableHeight`, P3-2 행, §7 보류 표), `docs/decisions/ui-output-limits.md`(논리 줄 예산·overflow 문구 계약), `docs/decisions/2026-09-23-worker-visibility.md`(D3/D5 — watch 피드·`[output]` 단일 게이트), `docs/decisions/design-md-workflow.md`(요구사항 ID·역추적·검증 계획 골격)

## 배경과 범위

`loop watch`의 사람 출력은 `\x1b[2J\x1b[H` 클리어 후 `renderSnapshot`의 세로 줄 스택(`packages/presentation/src/snapshot.ts`의 `renderStatus` + `renderActivityFeed`)을 다시 그린다. 실행 중인 여러 태스크가 화면에 나란히 보이지 않아 "상태가 실제로 보인다"는 요구를 만족하지 못한다 — 이것이 본 결정의 직접 원인이다.

본 결정이 다루는 것: **watch 라이브 화면(사람 출력) 전용의 컬럼 그리드 규격.** 다음은 의도적으로 변경 대상이 아니다.

- 일회성 `loop status`/`loop graph`/`loop_run` 요약의 기존 논리 줄 예산(AGENTS.md의 status 8줄, attention 6줄, findings 5줄) — **변경 없음.** 8줄 규칙은 일회성 출력면의 규정이며, watch 라이브 화면은 본 문서의 표면 규격을 별도로 따른다.
- `--json` 출력과 기계 소비 경로 — **변경 없음**(`ui-output-limits.md`의 대상 제외 원칙 승계).
- watch 렌더 루프 자체(스냅샷 폴링 + 전체 클리어) — `live-agents-design-comparison.md` §7의 차분 렌더링 보류 트리거(관찰된 플리커 회귀)가 발생하기 전까지 유지.
- 전역 `line_text_limit`의 폭 인식화(D-5) — **여전히 보류.** 본 결정은 물리 폭 회계를 watch 표면에 한해 도입한다(§정책 정합).

## 결정

**채택: watch 사람 출력에 한해, 태스크를 나란히 놓는 고정 폭 컬럼 그리드를 도입한다.** 레이아웃 수학(산식·클램프·패딩)은 `packages/presentation` 전용 모듈이 소유하고, CLI는 `process.stdout`의 폭·높이를 주입하는 조립만 한다. 컬럼 안의 텍스트 생산은 기존 그래펨 클램프(`singleLine`, `Intl.Segmenter`)와 overflow 문구 관행(`… {omitted} more {noun}`)을 그대로 재사용한다.

### 1. 컬럼 수 산식

```text
width       = process.stdout.columns ?? 80        # TTY 폭 미탐지 시 기본 80
COLUMN_MIN_WIDTH = 32                               # 식별 줄(id · state) 가독 하한
COLUMN_GUTTER    = 2                                # 컬럼 사이 공백
slot        = COLUMN_MIN_WIDTH + COLUMN_GUTTER = 34
columnCount = clamp(floor(width / slot), 1, 4)     # 4 = 가독성 상한
```

- width 80(기본) → **2컬럼**, 102 ≤ width < 136 → 3컬럼, width ≥ 136 → 4컬럼.
- 상한 4의 근거: 초폭 터미널에서 열이 계속 늘어나면 밴드 높이 회계(§3)가 붕괴하고 한눈 비교라는 목적을 넘는다. 초과분은 §4의 우선순위 선택과 `… N more tasks` 표기로 흡수한다(`scheduler.max_parallel = 6`을 컬럼 수로 역참조하지 않는다 — 동시 실행 수와 화면 열 수는 독립 정책이다).
- 컬럼 폭 계산은 표시 폭(그래펨 수, East Asian Wide/Fullwidth는 2) 기준이며, 셀 텍스트는 `singleLine(cell, COLUMN_MIN_WIDTH)`으로 클램프 후 패딩한다. 공백 패딩을 만드는 헬퍼는 presentation 모듈 안에만 존재한다.

### 2. 컬럼당 표시 내용

컬럼 = 세로 밴드(row-major 배치, 왼→오른쪽 위→아래), 밴드 높이는 모든 컬럼에서 동일하다.

1. **식별 줄 1줄:** `{task.id} · {state}` — 컬럼 폭으로 그래펨 클램프. 과도하게 긴 id는 잘리며 상세는 일회성 `status`/`graph`의 역할로 남는다.
2. **내용 줄 `activityCap`개(§3):** 최근 활동 이력의 최신 `activityCap`개를 오래된→최신 순(최신이 아래)으로. 접두사는 기존 피드와 동일한 `  │ ` 어휘를 쓴다.
3. `task.lastFailure`가 있으면 내용 슬롯 중 첫 슬롯을 `! {failure}`(클램프)로 대체한다. 실패는 활동 이력보다 우선해 보인다.
4. 제목·`blockedBy`·`resultSummary` 등 나머지 상세는 컬럼에 넣지 않는다 — 좁은 열에서 어휘 과밀이 곧 가독성 붕괴이며, 그 상세는 기존 표면이 이미 담당한다.

### 3. 활동 줄 수 상한 — 2중 상한과 높이 회계

```text
rows          = process.stdout.rows ?? 24           # TTY 높이 미탐지 시 기본 24
chrome        = 5                                    # 헤더 3(Run/State/카운트) + 공백 1 + overflow 풋터 1
activityCap   = max(0, min(worker_activity_lines, floor((rows - chrome) / columnCount) - 1))
```

- 1차 상한은 정책값 `worker_activity_lines`(기본 5, 저장 상한 8) — `2026-09-23-worker-visibility.md` D3/D5의 표시 예산을 그대로 승계한다. `workerVisibility = "off"`면 활동 줄 예산은 0이고 컬럼은 식별 줄만 표시한다(레이아웃과 내용 게이트의 분리, §5).
- 2차 상한은 물리 높이 회계다. 이것이 `live-agents-design-comparison.md` §0·P3-2·§7이 보류 항목으로 기록한 **agy 크롬 회계(`ChromeLines`/`AvailableHeight`) 메커니즘의 watch 한정 채택**이다 — "크롬(고정 UI)을 먼저 회계하고 남은 높이를 내용에 배분"한다는 발상만 가져오고, agy의 6계층 레이아웃 시스템은 가져오지 않는다. 기본값(rows 24 × 2컬럼)에서는 `min(5, 9−1)=5`로 정책값이 그대로 살아남고, 4컬럼에서는 3으로 줄어든다.
- 내용이 상한을 넘으면 마지막 슬롯을 `… N more`(생략된 활동 줄 수)로 예약한다 — `ui-output-limits.md`의 "한도를 넘으면 마지막 줄을 카운트 요약으로 예약" 관행의 컬럼 적용.

### 4. 넘침 우선순위와 overflow 표기

- 컬럼 후보(전체 태스크)가 `columnCount × 밴드 수`를 넘으면 **running > attention > verifying > 나머지** 순으로 선택한다. 나머지는 기존 `taskPriority` 순서(failed > blocked > ready > pending)를 따른다 — 일회성 status의 정렬(attention 우선)과 의도가 다르다: 라이브 화면의 1순위는 "지금 움직이는 것"이고, 사용자 개입 대상(attention)이 그 다음이다.
- **done/cancelled는 컬럼 후보에서 제외**한다 — 헤더의 `Tasks: done/total` 카운트로 충분하며, 종결 태스크 열은 라이브 화면의 예산 낭비다.
- 선택되지 못한 태스크는 그리드 아래 1줄 `… N more tasks`로 표기한다(기존 overflow 팩토리 어휘).
- 컬럼 수학의 우선순위 테이블은 presentation이 소유하고, `taskPriority`와의 차이(상위 3위 재배열)는 상수 옆 주석으로 명시한다.

### 5. 강등 규칙 (컬럼 → 기존 스택)

다음 중 하나라도 참이면 컬럼 렌더러를 쓰지 않고 **오늘의 스택 출력(`renderStatus` + 피드 게이트)과 바이트 동일한 경로**로 렌더한다.

1. `watch_layout = "stack"` 설정(§6) — 명시적 복귀 경로.
2. `floor(width / 34) < 2`, 즉 width ≤ 67 — 컬럼 최소 폭을 두 번 담지 못하면 1컬럼(기존 스택)으로 강등한다. "1컬럼 그리드"라는 제3의 렌더러를 만들지 않는다 — 강등 시 렌더러는 정확히 하나(기존 경로)다.
3. 높이 회계의 결과 `activityCap`이 0이 되어도 스택으로 강등하지 않는다 — 식별 줄만 있는 컬럼이 "움직임 없음"의 올바른 표현이다(강등은 폭 조건에서만).

### 6. 정책·기존 결정과의 정합

- **신설 키 1개:** `config/policy.toml [output]`에 `watch_layout = "columns" | "stack"`(기본 `"columns"`). 파싱은 `workerVisibility`와 같은 enum 검증 패턴을 따른다(`packages/orchestrator/src/config.ts`의 `workerVisibility()` 선례). `"stack"`은 본 결정 이전 출력(피드 게이트 포함)과 바이트 동일 복귀 경로다.
- **`worker_visibility`는 그대로:** 이 키는 컬럼 **내용**(활동 줄)의 게이트로 유지된다. 레이아웃(`watch_layout`)과 내용(`worker_visibility`)은 독립 스위치다 — `columns + off` 조합은 식별 줄만 있는 그리드를 출력하며, 이는 D5의 "off = 어댑터 래핑·구독·패널 없음" 보장(미러링 기계에 관한 약속)과 상충하지 않는다.
- **기존 `[output]` 키 변경 없음:** `status_line_limit` 등 논리 줄 예산은 일회성 출력면의 것으로 의미가 불변이며, `lineTextLimit`(160)는 이제 컬럼 렌더에서 컬럼 폭(≤32)이 항상 먼저 적용되는 상한이 된다.
- **D-5는 여전히 보류:** 전역 `line_text_limit`의 폭 인식화는 하지 않았다. 물리 폭 회계는 watch 표면에 한해 도입되며, 전역 도입 여부는 D-5 결정으로 남는다(`live-agents-design-comparison.md` §7의 트리거 유지).
- **경계 준수(AGENTS.md):** loop-core·Rust bridge·생성 protocol 변경 0 — codegen 불필요. provider·herdr·모델 개념의 진입 0. 자격 증명 취급 0. CLI는 폭/높이 주입과 렌더러 선택만 하는 얇은 어댑터로 유지되며, 레이아웃 정책은 presentation(결정적 순수 함수 + 테스트)이 소유한다.

## 요구사항 (EARS + `R<n>`)

각 요구사항은 검증 방식을 동반한다(design-md-workflow §결정-3의 ID 체계).

- **R1** — WHEN `loop watch`가 사람 출력을 렌더하고 `watch_layout = "columns"`이며 폭이 68 이상일 때, THE SYSTEM SHALL §1의 산식으로 columnCount ≥ 2 그리드에 태스크를 나란히 렌더한다. *검증: presentation 단위 테스트(폭 68/80/102/136 경계별 컬럼 수·배치).*
- **R2** — WHEN 폭이 67 이하이거나 `watch_layout = "stack"`일 때, THE SYSTEM SHALL 기존 스택 출력과 바이트 동일한 문자열을 낸다. *검증: cli 테스트 회귀(변경 전 출력 스냅샷 대조).*
- **R3** — WHEN 컬럼 후보가 그리드 용량을 넘을 때, THE SYSTEM SHALL running > attention > verifying > 나머지 순으로 선택하고 미선택 수를 `… N more tasks` 1줄로 표기한다. *검증: presentation 단위 테스트(우선순위·마커).*
- **R4** — WHEN 태스크의 활동 줄이 `activityCap`을 넘을 때, THE SYSTEM SHALL 최신 줄을 남기고 마지막 슬롯을 `… N more`로 예약한다. *검증: presentation 단위 테스트.*
- **R5** — WHEN `workerVisibility = "off"`일 때, THE SYSTEM SHALL 컬럼에 활동 줄 없이 식별 줄만 표시한다. *검증: presentation/cli 단위 테스트.*
- **R6** — IF 셀 텍스트가 결합 그래펨 또는 East Asian Wide 문자를 포함하면, THE SYSTEM SHALL 표시 폭 기준으로 클램프·패딩해 컬럼 경계를 유지한다. *검증: 그래펨/와이드 문자 단위 테스트.*
- **R7** — `loop watch --json`과 일회성 `loop status` 출력은 본 결정과 무관하게 불변이다. *검증: 기존 테스트 전체 회귀.*
- **R8** — 컬럼 수학(산식·우선순위·클램프·패딩)은 presentation 내부에만 존재하고 CLI는 폭·높이를 주입한다. *검증: `bun run test:architecture`.*

## 요구사항–구현 역추적 표

| 요구사항 | 설계 요소 | 구현 위치 | 완료 확인 |
| --- | --- | --- | --- |
| R1, R3, R4 | 컬럼 수 산식·그리드 조립·우선순위 | `packages/presentation/src/columns.ts` (신설) + `src/index.ts` export | `bun test packages/presentation` |
| R2 | 스택 강등 경로 | `packages/cli/src/main.ts` watch 분기(기존 `renderSnapshot` 경로 유지) | `bun test packages/cli` |
| R5, R6 | 내용 게이트·표시 폭 클램프 | `columns.ts`(단일Line/패딩 헬퍼 재사용) | `bun test packages/presentation` |
| R7 | 불변 표면 동결 | 변경 없음(회귀로만 확인) | `bun test packages` |
| R8 | 레이아웃 소유권 경계 | `columns.ts` 전용 모듈, CLI 주입 | `bun run test:architecture` |
| — (정책) | `watch_layout` 키 | `config/policy.toml`, `packages/orchestrator/src/config.ts` 파서 | `bun test packages/orchestrator` |

## 검토된 대안

1. **전체 폭을 쓰는 단일 컬럼 강화(줄당 정보량 증가)** — 기각. 불만의 본질은 "나란히 비교"이며 줄 늘리기로는 해소되지 않는다. 8줄 예산 규칙과도 충돌한다.
2. **alt-screen TUI 프레임워크 도입(pi-tui 등)** — 기각. watch는 문자열 출력 루프가 유지 계약이고, 차분 렌더링·동기화 출력은 관찰된 플리커 회귀가 트리거일 때 검토한다(비교 문서 §7 보류 원칙 승계). 프레임워크 도입은 그 트리거보다 무겁다.
3. **상한 없는 순수 `floor(width/slot)` 산식** — 기각. 초폭 터미널에서 열 과잉·밴드 높이 붕괴가 발생한다. 상한 4 + overflow 우선순위가 이미 갖춰진 축소 메커니즘과 정합적이다.
4. **`worker_visibility`에 컬럼 게이트를 통합** — 기각. 기본값 "off"에서 레이아웃 개선이 잠기면 원 불만이 해소되지 않는다. 레이아웃과 내용 게이트의 분리가 정답이며, 복귀 경로는 `watch_layout = "stack"`이 담당한다.

## 구현 태스크 필수 준수 목록

구현 태스크는 다음을 순서대로 기계적으로 수행한다.

1. `packages/presentation/src/columns.ts` 신설: §1 산식 상수(`COLUMN_MIN_WIDTH=32`, `COLUMN_GUTTER=2`, 상한 4), §3 높이 회계, §4 우선순위 테이블(주석으로 `taskPriority`와의 차이 명시), 표시 폭 측정·클램프·패딩 헬퍼. `process.stdout` 직접 참조 금지 — 폭/높이는 파라미터 주입.
2. `snapshot.ts`의 기존 `renderStatus`/`renderActivityFeed`는 **한 글자도 바꾸지 않는다**(스택 경로·일회성 status의 단일 원천).
3. `packages/cli/src/main.ts` watch 분기: `config.output.watchLayout === "columns"` && 폭 조건 충족 시 컬럼 렌더러, 아니면 기존 경로. `--json` 분기는 불변.
4. `packages/orchestrator/src/config.ts`: `watch_layout` enum 파싱(기본 `"columns"`, 잘못된 값은 `ConfigError`) + `config/policy.toml` 키·주석 추가.
5. 테스트: `packages/presentation/test/columns.test.ts` 신설(R1·R3·R4·R5·R6), `packages/cli/test/cli.test.ts`에 R2(스택 바이트 동일)·R5 회귀, orchestrator config 파서 테스트.
6. 검증 명령(§검증 계획) 실행 후 결과를 completion contract에 첨부한다.

## 검증 계획

```bash
bun run check                                            # 전체 게이트
bun test packages/presentation                           # 컬럼 수학·그리드·클램프
bun test packages/cli                                    # watch 분기·스택 강등 회귀
bun test packages/orchestrator                           # watch_layout 파서
bun run test:architecture                                # R8 경계 (presentation 외 레이아웃 수학 금지)
```

유료 모델 호출 0. "워커 성공"은 완료 근거가 아니며 위 명령의 출력이 근거다. 부분 롤백 경계: `watch_layout = "stack"` 설정으로 레이아웃만 즉시 복귀 가능(코드 롤백 불필요).

## 한계와 승계 항목

- **색 도입 시 계약 승계:** 현재 Loop 출력은 무색이므로 표시 폭 계산은 그래펨 기준으로 충분하다. D2 색 역할 도입 시 ANSI 이스케이프를 표시 폭에서 제외하는 규칙을 색 결정 ADR이 승계해야 한다(컬럼 렌더러는 ANSI 유입원이 생기기 전까지 이를 다루지 않는다).
- **비-TTY watch:** 파이프된 watch는 여전히 클리어 이스케이프를 방출한다(P3-1 기존 처리, 본 결정 범위 밖).
- **task id 클램프:** 32 폭을 넘는 id는 식별 줄에서 잘린다 — 상세 조회는 `status`/`task` 표면의 역할로 유지한다.

## 폐기 기록 (2026-09-25)

본 결정의 컬럼 그리드는 구현·검증까지 완료된 뒤(`docs/design/research/watch-columns-review.md` — PASS 조건부, F-1~F-4) **사용자 결정으로 기각·회수(reverted)**되었다: 라이브 화면을 분리 화면(사이드바이사이드 컬럼)으로 놓는 방향 자체가 사용자가 의도한 UX가 아니다. 기각 사유는 기술적 결함이 아님을 명시한다 — 구현·검증은 본 문서 명세대로 완료됐다.

코드 제거는 `docs/decisions/2026-09-25-improvement-cycle.md` §결정-2에 따랐다: `packages/presentation/src/layout.ts` 삭제, `snapshot.ts`의 컬럼 렌더러(`renderWatch`·`watchColumnPriority`·`watchTaskBlock` 등) 제거로 HEAD 복귀, `index.ts`의 layout export 제거, `packages/cli/src/main.ts` watch 분기(`renderWatch` import·`view` 주입·`formatWatchFrame`) 제거, 관련 테스트(`layout.test.ts`·`watch-columns.test.ts`) 삭제. 정책 키 `watch_layout`(F-1)은 구현된 적이 없으므로 코드 제거로 F-1~F-3은 소멸한다(F-4의 커밋 분리 요구는 철회 커밋과 분리로 충족됐다). 본 문서와 `watch-columns-review.md`는 조사·검증 증거 기록으로 존치한다.
