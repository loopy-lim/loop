# 개선 사이클 전체 검증·커밋 결과

- **Date:** 2026-09-25
- **Kind:** verification report (task `verify-and-commit`)
- **Verdict:** **PASS** — 전체 검증 3종(`bun run check`, `bun test packages`, `bun run test:architecture`) 전부 통과. ADR `2026-09-25-improvement-cycle.md` §결정-3의 커밋 배분 C1–C5 실행 완료(+계획 외 ADR 자체·본 문서 2건, 사유 아래). 워크트리 클린, 시크릿 커밋 0건.
- **Verified intent:** 개선 사이클 3대상 — (1) 미커밋 변경 14파일+신규 소스·문서의 검증 후 커밋, (2) D1 표현 어휘 토큰 모듈 구현(implement-tokens 결과물), (3) watch-columns 철회 잔여물 정리 — 의 완결. 본 태스크는 구현을 수정하지 않고 검증·기록·커밋만 수행.
- **Read scope:** `docs/**`, `packages/**`, `tests/**`, `git`(상태·diff·로그)
- **Write scope:** 본 문서 (코드 수정 없음)

## 검증 방법

- 커밋 전 사전 점검: `git status`/`git diff HEAD` 전수 대조, watch 심볼 전역 grep, `layout.ts`·watch 테스트의 추적 이력 확인, 전체 diff 대상 시크릿 스캔(`api[_-]?key|secret|token=|password|Bearer …` — 매치는 redaction 정규식·기존 타입 정의뿐).
- 전체 검증 3종 실행(아래 표). 실패 시 수정 없이 FAIL 보고가 계약이었으나 실패 0건.
- 각 커밋 직전 `bun run check` 게이트(ADR R3) — 총 7회 모두 326 pass / 0 fail.
- 유료 모델 호출 0(ADR R4). `packages/providers/test/herdr-agent-live.test.ts`는 fake HerdrRunner 기반 단위 테스트로 실측 없음을 헤더 주석으로 확인.

## 전체 검증 결과

| 검증 | 결과 | 상세 |
| --- | --- | --- |
| `bun run check` | **PASS** | 326 pass / 0 fail — 41파일, 1333 expect (≈12.1s) |
| `bun test packages` | **PASS** | 308 pass / 0 fail — 36파일, 1141 expect (≈12.1s) |
| `bun run test:architecture` | **PASS** | 6 pass / 0 fail — 경계 6축 전부(≈0.17s) |

## 축별 결과

### 1. D1 토큰 모듈 (ADR §결정-1, R1) — 구현 확인 ✅

- `packages/presentation/src/tokens.ts` 신설: 상태 글리프(`✓`/`!`), cleanup 불릿 `-`(D-3 결정 전 현행값 동결 — 근거 주석 포함), 구분자(`·`/`←`/`│`), 빈 상태 5종, `moreItems()` overflow 팩토리(선택 detail 인자). 무색 원칙 준수 — 색 역할은 주석으로 자리만 표기.
- 호출점 교체 확인: `snapshot.ts`(overflow 람다·빈 상태·구분자), `compact.ts`(`ellipsis`), `main.ts`(포맷터 어휘), `index.ts`(export 추가).
- 최소 무결성 테스트 `packages/presentation/test/tokens.test.ts`: overflow 정규식 준수·빈 상태 중복 부재·글리프 값 고정 — `bun test packages` 통과로 간접 확인.
- 바이트 동일 원칙(R1): 기존 `cli.test.ts`·presentation 테스트 무수정 통과로 성립. S3(포맷터 4종 이관 등)는 계획대로 제외 — 후속 커밋 단위.

### 2. watch-columns 철회 (ADR §결정-2, R2) — 정리 확인 ✅

- ADR `2026-09-24-watch-columns.md` Status: `rejected (2026-09-25)` + 폐기 기록 섹션 — 기각이 사용자 결정임을 명시, 검증 문서(`watch-columns-review.md`)는 증거로 존치(C3에 동반 커밋).
- 코드 잔여물 grep 0건: `renderWatch`·`watchColumnPriority`·`WATCH_CHROME_ROWS`·`columnCountForWidth`·`from "./layout"`·`formatWatchFrame` 전부 미매치. `layout.ts`·`watch-columns.test.ts`·`layout.test.ts`는 워크트리에서 부재.
- **계획과의 차이(동등 증거로 대체):** ADR은 "C3 후 `git diff HEAD -- snapshot.ts·index.ts·main.ts` 공백"을 요구했으나, watch 컬럼 코드는 HEAD(9e8d094)에 한 번도 커밋된 적이 없어(`git log --all` 무매치) "HEAD 복귀"는 미추적 파일 삭제로 이미 완료된 상태였고, 해당 3파일의 현행 diff는 D1 토큰 변경(C5 소속)만 포함한다. 따라서 (a) HEAD에 watch 코드 부재, (b) 심볼 grep 0건, (c) 전체 테스트 통화를 동등 증거로 기록한다.

### 3. 커밋 배분 (ADR §결정-3, R3) — 실행 완료 ✅

| # | 해시 | 커밋 | 계획 준수 |
| --- | --- | --- | --- |
| C1 | `ffd1262` | `feat(herdr): 워커 라이브 대화 탭 — interactive 모드와 steer 채널` | 계획 배분 그대로 (14파일 중 herdr·providers·orchestrator + ADR 2건) |
| C2 | `430b3d3` | `docs(herdr): 탭 배치 진단과 복원 검증 기록` | 계획 배분 그대로 (진단·검증 문서 6건) |
| — | `34c4405` | `docs(decisions): 개선 사이클 범위 결정 — D1 어휘 토큰화와 watch-columns 철회` | **계획 외 삽입.** ADR 자체 파일이 §결정-3 표에 누락됨 — 결정이 지배하는 C3·C5에 선행하도록 C2와 C3 사이에 배치(5dd4bfa 선례) |
| C3 | `1f5fa80` | `chore(presentation): watch 컬럼 배치 철회 — 분리 화면 방향 기각` | ADR rejected 표기 + 검증 기록. 코드 제거분은 미추적이라 스테이징 대상 없음(§2 참조) |
| C4 | `766ca28` | `docs(design): 디자인 파운데이션 조사·권고안과 design.md 워크플로` | 계획 배분 그대로 (조사 9건 + design 2건 + `.gitignore`) |
| C5 | `43bd69e` | `feat(presentation): 표현 어휘 토큰 모듈 신설 — 하드코딩 어휘 상수화` | 계획 배분 그대로 (`tokens.ts`·`tokens.test.ts` 신설 + 호출점 4파일) |

- 각 커밋 직전 `bun run check` 326 pass / 0 fail — 7회 전부(R3의 "커밋 시점 게이트" 요건).
- F-4(watch 기능 커밋과 조사 문서의 분리, `watch-columns-review.md` §결론)는 C3/C4 분리로 충족.
- 커밋 후 `git status --porcelain` 공백 — 미커밋 변경 0건(완료 조건 `committed` 충족).

### 4. 시크릿 점검 — 이상 없음 ✅

- 커밋 전 diff 전수 스캔에서 실제 자격증명 무검출(매치는 `redact.ts`·`client.ts`의 redaction 정규식과 기존 `zai/api.ts` 타입 정의뿐 — 후자는 본 사이클 diff 아님).
- `.gitignore`에 `.research-sources/` 추가(C4) — 조사 원천 캐시의 커밋 차단.

## 남는 위험·후속

- **D1-S3(포맷터 4종 presentation 이관, `renderRuns` 이중 구현 제거, `formatSnapshot` `replace()` 제거)** — ADR이 명시한 후속 커밋 단위. 이번 사이클 의도적 제외.
- **D2(색 역할)·D-1(토큰 이름 규칙)·D-3(cleanup 글리프 통일)** — 파운데이션 §6 후속 결정 대기. D-3 결정 시 `cleanupBullet` 값만 바꾸면 되는 구조.
- **실기 라이브 TUI 실측**(herdr 탭·steer의 실제 렌더 확인) — 유료 호출 가능성으로 본 사이클에서 분리, 별도 수동 증거 대상(`herdr-tabs-revert-review.md`와 동일한 취급).
