# watch-columns 검증 리뷰 — implement-columns 결과 대조

- **Date:** 2026-09-26
- **Kind:** verification (`verify-columns`)
- **대상 ADR:** `docs/decisions/2026-09-24-watch-columns.md`
- **Read scope:** ADR, `packages/cli/src/main.ts`, `packages/presentation/**`, `tests/**`
- **본 태스크 코드 변경:** 없음 (이 문서가 유일한 write 산출물)

## 결과 요약

**PASS (조건부) — 검증 요구사항 4항 전부 통과, 발견 문제 1건(정책 키 미이행, MEDIUM)은 후속 구현 권고.**

`watch_layout` 정책 키가 ADR 준수 목록 4번 대로 구현되지 않아, ADR이 보장하는 설정 기반 롤백 경로(`watch_layout = "stack"`)가 런타임에 도달 불가능하다. 그 외 컬럼 수학(산식·우선순위·강등·높이 회계), 기존 표면 동결, 아키텍처 경계는 전부 코드·테스트로 확인됐다. 본 판정은 태스크 요구사항(1)~(4) 기준이며, ADR 대비 불완전 구현임은 발견 문제 F-1로 추적한다.

## 검증 항목별 결과

### (1) ADR 규격 대조 — 컬럼 수 산식·우선순위·강등 규칙: **PASS**

| ADR 항목 | 구현 | 근거 |
| --- | --- | --- |
| §1 산식 `clamp(floor(width/34),1,4)`, `MIN=32/GUTTER=2/상한 4` | `packages/presentation/src/layout.ts:17-36` (`COLUMN_MIN_WIDTH=32`, `COLUMN_GUTTER=2`, `COLUMN_MAX_COUNT=4`, `columnCountForWidth`) | `layout.test.ts` 경계 0/67/68/80/101/102/135/136/1000 전부 통과 |
| §3 높이 회계 `activityCap = max(0, min(policy, floor((rows-5)/cols)-1))`, chrome=5 | `packages/presentation/src/snapshot.ts:263-268` (`WATCH_CHROME_ROWS=5`는 `layout.ts:27`) | R4 테스트: 7개 활동·cap 3 → 최신 2줄 + `… 5 more` |
| §4 우선순위 `running > attention > verifying > 나머지`, done/cancelled 제외, `… N more tasks` | `snapshot.ts:242-258` (`watchColumnPriority`, `taskPriority`와의 차이 주석 명시) + `snapshot.ts:280` 풋터 | R3 테스트: 8태스크 → 2×3 밴드 선택, 종결 태스크 미표시, `… 1 more tasks` |
| §5 강등: width ≤ 67 → 스택, 높이 부족 → 강등 없이 식별 줄 전용 | `snapshot.ts:47` (폭 조건만 강등), `snapshot.ts:268` cap 0 유지 | `watch-columns.test.ts` R2/§5 테스트: 폭 67 = 스택 바이트 동일, rows 6에서도 컬럼 유지 |
| §2 내용 규격: `id · state` + `  │ ` 접두사, 실패가 첫 내용 슬롯 대체 | `snapshot.ts:291-311` (`watchTaskBlock`) | 실패 테스트: `["t · running", "! boom", "  │ s3", "… 2 more"]` |
| R6 표시 폭: 그래펨 1, East Asian Wide 2, 결합 그래펨 단일 셀 | `layout.ts:42-50,86-117` (`displayWidth`/`clampCell`/`padCell`) | ZWJ 이모지 = 2폭, `한글abc` 5폭 클램프 = `한글…` 통과 |

### (2) 일회성 status 출력 회귀: **PASS**

- `git diff packages/presentation/src/snapshot.ts` = **+106 / −0 (순수 추가)**. `renderStatus`·`renderActivityFeed`·`taskPriority` 본문 무변경 → ADR 준수 목록 2번("한 글자도 바꾸지 않는다") 충족.
- `watch-columns.test.ts` "one-shot status rendering is unchanged (regression)": 피드 옵션 유무 양쪽 모두 기존 출력과 동일함을 문자열 전체로 단언.
- `packages/cli/test/cli.test.ts:305` "status stays byte-identical" 테스트 통과.

### (3) `--json`/non-watch 경로 미변경: **PASS**

- `packages/cli/src/main.ts:191`: `parsed.json ? JSON.stringify(snapshot)+"\n" : ...` 삼항의 JSON 분기는 변경 전과 동일(컬럼 렌더러는 사람 출력 쪽에만 삽입).
- non-watch `status`/`graph`/`workers`/`attention`은 기존 `formatSnapshot` → `renderSnapshot` 경로 그대로(`main.ts` diff는 watch 분기 + `formatWatchFrame` 신설뿐).
- 전체 회귀(`bun test packages` 288 pass)로 R7 확인.

### (4) 아키텍처 경계 (R8): **PASS**

- 컬럼 수학(산식·클램프·패딩·우선순위)은 `packages/presentation/src/layout.ts` + `snapshot.ts`에만 존재. `process.stdout` 직접 참조 없음(ADR 준수 목록 1번의 주입 원칙).
- CLI는 `main.ts:190`에서 `process.stdout.columns ?? 80 / rows ?? 24` 주입만 수행, 렌더러 선택은 presentation 소유(`main.ts:541` `formatWatchFrame`는 3줄 어댑터).
- `loop-core`·Rust bridge·생성 protocol 변경 0 → codegen 불필요 확인(`git status`).
- `bun run test:architecture` 6 pass: presentation은 `@loop/(providers|pi-loop|herdr)` 및 `Provider|PiRuntime|Herdr` 참조 금지 규칙 통과.

## 전체 검증 명령 결과

| 명령 | 결과 |
| --- | --- |
| `bun run check` (codegen:check + typecheck + test:architecture + test) | **306 pass / 0 fail** (41 files) |
| `bun test packages` | **288 pass / 0 fail** (36 files) |
| `bun run test:architecture` | **6 pass / 0 fail** |
| 초점 재현: `bun test packages/presentation packages/cli` | **38 pass / 0 fail** (컬럼 신규 테스트 포함) |

유료 모델 호출 0. 전부 오프라인 단위·회귀 근거다.

## 발견 문제 목록

- **F-1 (MEDIUM) — `watch_layout` 정책 키 미이행 (ADR 준수 목록 4번, §6, 역추적 표 "—(정책)" 행).** `config/policy.toml`과 `packages/orchestrator/src/config.ts`는 변경 없음(`worker_visibility`(29행)/`worker_activity_lines`(30행)만 존재). `WatchRenderOptions.watchLayout`은 `snapshot.ts:24,47`에 API로만 존재하고 CLI가 주입하지 않음(`main.ts:187-191`의 `feedOptions`/`view`에 watchLayout 없음) → 설정 기반 롤백 경로가 런타임에 도달 불가. 현재 상태로는 컬럼 레이아웃 복귀에 코드 롤백이 필요하며, ADR "부분 롤백 경계" 문장과 불일치. 권고: orchestrator config 파서 enum 추가 + `policy.toml` 키 + `main.ts` 주입 + orchestrator 파서 테스트(ADR 검증 계획의 `bun test packages/orchestrator` 행).
- **F-2 (LOW) — ANSI 0폭 처리를 선행 구현 (ADR은 색 결정 ADR로 승계 보류).** `layout.ts:39,44,61` `ansiPattern` 제거 방식. 현재 무색 출력에서 no-op이라 무해하나, `clampCell`은 이스케이프를 **보존하지 않고 제거**하므로 색 도입 시 클램프된 셀은 색을 잃는다. `layout.ts:5-9` 주석이 이 계약을 색 결정 ADR 승계 항목으로 명시 — 색 ADR 작성 시 반드시 승계할 것. (의존 태스크 결과와 일치, ADR 문면 "다루지 않는다"와의 의도적 초과 구현)
- **F-3 (INFO) — 파일명 불일치.** ADR 역추적 표는 `src/columns.ts`/`test/columns.test.ts`로 기록했으나 실제는 `src/layout.ts` + `test/layout.test.ts` + `test/watch-columns.test.ts`. 기능적으로 동등하나 역추적 표의 "구현 위치"가 문자 그대로는 해석되지 않음 — ADR 문서 갱신 또는 본 리뷰로 대체 참조 권고.
- **F-4 (INFO) — `.gitignore` +1 (`research-sources/`).** 컬럼 기능과 무관한 변경이 동일 워크트리에 섞여 있음. 무해하나 커밋 분리 대상.

## 미해결 위험

- F-1 미수정 시: 사용자가 좁은 터미널(폭 ≤ 67)이 아니면 스택 화면으로 돌아갈 방법이 없음. 기본 동작(폭 ≥ 68 컬럼) 자체는 전 테스트 통과로 검증됨.
- 비-TTY watch가 클리어 이스케이프를 내보내는 기존 P3-1 항목은 본 결정 범위 밖으로 그대로 유지됨(회귀 아님).
