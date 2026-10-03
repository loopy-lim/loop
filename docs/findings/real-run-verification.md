# Real-run pipeline 최종 검증 (task `real-run-final-verification`)

- **일시:** 2026-09-25 23:3x KST
- **검증자:** 독립 verification 워커 (작성 파일은 본 문서 1건뿐)
- **성격:** 후속 2차 실제 run 파이프라인의 수용 기준별 pass/fail 판정. 선형 증거는 [`docs/research/simulator-showcase/v2/evidence.md`](../research/simulator-showcase/v2/evidence.md)(task `simulator-showcase-2`)를 그대로 인용하되, 아래 모든 서버 측 사실은 본 세션에서 독립 재실행하여 확인했다.
- **제약:** 유료 모델 호출 0(전부 deterministic-local), bearer 토큰은 셸 메모리에서만 발급·문서/로그 미기록.

## 1. 수용 기준 판정 요약

| # | 수용 기준 | 판정 | 증거 |
| --- | --- | --- | --- |
| 1 | helpers 타입 정합 + 11개 실패 테스트 해결 | **pass** | §2.1, §2.2 |
| 2 | gateway 48/48 + typecheck 클린 | **pass** | §2.1–2.2 |
| 3 | 시뮬레이터 실제 run 재시연 + 중앙 정렬 UI v2 캡처 | **pass** | §3 |
| 4 | 제출 프롬프트가 `loop status`에 보임 | **pass** | §4.1 |
| 5 | 앱 run 목록 = `loop runs` 목록 | **pass** | §4.2 |
| 6 | 워커 출력 이벤트 실제 내용 | **pass** | §4.3 |
| 7 | 스텁 플래너 제거/격리 | **pass** | §4.4 |
| 8 | `bun run check` 전체 + 경계(아키텍처/codegen/provider 누출/redaction) | **pass** | §5 |

## 2. 테스트·타입 정합

### 2.1 gateway 전체 테스트

```
$ bun test packages/gateway/test
 48 pass
 0 fail
 196 expect() calls
Ran 48 tests across 6 files. [799.00ms]
```

인텐트의 11개 실패 항목이 모두 포함된 파일군이 통과한다: origin/framing 거부(`bind-auth.test.ts` — Origin 헤더 거부, problem 매핑), submit→SSE happy path(`submit-stream.test.ts` — 202 + status/output/terminal, planning 실패 전이), runs list cursor pagination, validation/problem mapping 5건(400 invalid_request / 413 prompt_too_large / 429 + Retry-After / 503 planner_unavailable / request-id·type URL), disconnect semantics(연결 끊김 후 run 계속·완료), prepare commits template graph(`real-run.integration.test.ts` — 스토어 정합까지 검증).

### 2.2 typecheck

```
$ bun run typecheck   # = tsc -p tsconfig.json (출력 없음 = 오류 0)
```

인텐트의 1건(`packages/gateway/test/helpers.ts` jwt 서명 함수 string 할당) 해결 확인. 참고: 앱(`apps/loop-mobile`)의 기존 TS7016(react 타입 미설치)은 `bun run check`의 tsconfig 범위 밖 기존 항목으로, 본 작업 범위 밖 후속(evidence.md §6.5 동일).

## 3. 시뮬레이터 재시연 (의존성 `simulator-showcase-2` 결과 + 독립 대조)

앱에서 `deterministic-local` 실제 run 제출 → SSE로 실시간 상태·출력 수신 → completed(4/4). `run_8c4c5a63-f883-496c-9431-05051a276014`. 유료 호출 0.

스크린샷 무결성 독립 재검증 — v2 캡처 6건의 sha256(12자)이 evidence.md §3 표와 전건 일치:

```
75cfebb92612  01-connect-screen.png
300d075c6e5d  02-runs-list.png
581f3673447d  03-submit-screen.png
d45f1bb14462  04-run-live.png
d45f1bb14462  05-run-output.png   (04와 동일 해시 — terminal 후 불변, 문서화된 의도)
551533d1e06a  06-runs-list-after.png
```

중앙 정렬 레이아웃과 실제 데이터 표시는 공용 `Screen`(중앙 컬럼, maxWidth 480) 도입 + macOS Vision OCR 전행 텍스트 검증(evidence.md §3)으로 근거됨.

## 4. 엔드투엔드 대조 (본 세션 독립 재실행)

### 4.1 제출 프롬프트 → `loop status`

```
$ ./dist/loop status run_8c4c5a63-f883-496c-9431-05051a276014 --database ~/.loop/gateway/loop.db
State: completed
Tasks: 4/4 · Workers: 0 · Attention: 0
decision · done · Decide approach: Showcase v2: run the deterministic local pipeline and report each step. · activity: [result] decision complete · …
implementation · done · Implement: Showcase v2: … · activity: [result] implementation complete · …
research · done · Research context: Showcase v2: … · activity: [result] research complete · …
verification · done · Verify outcome: Showcase v2: … · activity: [result] verification complete · …
```

앱이 제출한 프롬프트("Showcase v2: run the deterministic local pipeline and report each step.")가 표준 4-태스크 템플릿 그래프로 분해되어 각 태스크 요약에 그대로 보인다.

### 4.2 앱 run 목록 = `loop runs`

`GET /v1/runs?limit=10`(게이트웨이, 앱이 사용하는 동일 API)과 `loop runs --database ~/.loop/gateway/loop.db`:

| runId | 게이트웨이 | loop |
| --- | --- | --- |
| run_8c4c5a63 | completed | completed |
| run_464db91c | completed | completed |
| run_f5347b55 | completed | completed |
| run_988f9932 | completed | completed |
| run_c7a84585 | running | active |
| run_0e3f2731 | running | active |

**동일 6건, 집합 일치.** `running`↔`active`는 게이트웨이 상태 사영(projection) 매핑이며 `projection.test.ts`가 계약으로 고정. 2건의 `active` 유물은 스텁 시대 durable run으로 실행 owner가 없어(신규 게이트웨이가 채택하지 않음) 정상 동작이다(§6 리스크 1).

### 4.3 워커 출력 이벤트 실제 내용

`GET /v1/runs/run_8c4c5a63-…/events` SSE 리플레이에서 추출한 `text` 필드 12건 — 전부 비어 있지 않은 실제 내용:

```
[lifecycle] starting decision          [lifecycle] starting implementation
[lifecycle] completed                  [lifecycle] completed
[result] decision complete             [result] implementation complete
[lifecycle] starting research          [lifecycle] starting verification
[lifecycle] completed                  [lifecycle] completed
[result] research complete             [result] verification complete
```

결정 문서 수용기준(worker-output-carries-real-content)의 wire 형태(`activityId` `<seq>:<taskId>:<idx>`, 비어 있지 않은 `text`)와 일치.

### 4.4 스텁 플래너 제거/격리

```
$ rg -n -i "stub" packages/gateway/src packages/orchestrator/src
packages/gateway/src/planner.ts:45: (주석 1건 — "deliberately not an `echo` stub")
```

실행 가능한 스텁 플래너는 존재하지 않는다. 유일한 언급은 실제 그래프 커밋을 강조하는 문서 주석. 런타임 구성은 `deterministic-local`(FakeProvider + 실제 git 완료 검사)로 유료 레인과 분리되어 있으며, 이는 스텁이 아니라 비용 없는 결정론적 실제 실행 lane이다.

## 5. 전체 검증 (`bun run check`)

`package.json` 체인: `codegen:check && typecheck && test:architecture && test` — **전 단계 통과**.

```
$ bun run codegen:check        → exit 0 (생성물 최신)
$ bun run typecheck            → 출력 없음 (오류 0)
$ bun run test:architecture    → 6 pass / 0 fail, 166 expect()
$ bun run test                 → 467 pass / 0 fail, 1996 expect(), 57 files [23.07s]
```

경계 조건:

- **아키텍처 테스트:** 6 pass (`test:architecture`, 전체 체인 포함).
- **codegen:check:** 클린 — Rust 브리지 타입과 생성물 동기화.
- **loop-core 내 provider 개념:** 코드 의존 없음. 유일 적중은 `crates/loop-core/src/run/worker.rs:13`의 frozen-contract 문서 주석 TS 사본 위치 안내(의존 아님, 아키텍처 테스트도 이를 고정).
- **`[credential]=[redacted]` 불변:** `packages/providers/src/redact.ts`, `packages/orchestrator/src/redact.ts`, `packages/herdr/src/client.ts` 및 각 테스트의 단언이 그대로 존재. 자격 증명은 본 문서·증거 어디에도 기록되지 않음.

## 6. 미해결 리스크 / 후속 (판정에 영향 없음)

1. **스텁 시대 durable 유물 2건**(`run_c7a84585`, `run_0e3f2731`)이 목록에 `running`(=loop `active`)으로 영구 표시 — 실행 owner 부재로 정상. 정리(`loop cleanup` 계열) 또는 목록 필터는 별도 결정 대상.
2. **게이트웨이 목록 정렬**이 관찰 시각 기준으로 표시되어 newest-first 기대와 어긋나 보일 수 있음 — store snapshot에 createdAt 부재에서 오는 표기 특성(evidence.md §6.2 동일). 계약 테스트("newest-first with cursor pagination")는 통과하므로 판정에 영향 없으나, 저장소 생성 시각 노출은 후속 개선 후보.
3. **앱 typecheck TS7016**(`@types/react` 미설치) — `bun run check` 범위 밖 기존 항목. 의존성 추가는 별도 결정.
4. **중간 실행 상태 육안 관측 불가** — deterministic-local 실행이 ~0.3초라 앱은 replay 커서로 즉시 수신. 긴 실행의 라이브 관측은 실제 provider lane 후속 과제.
