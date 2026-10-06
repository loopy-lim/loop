# 워커 실행 한도 전수 조사 + 회복 설계 권고

- task: `limits-research` (2026-10-05, attempt 0)
- 범위: 디스패치(컨텍스트 조립) → 워커 프롬프트 조립 → 실행 → 결과 반환 전 경로의 크기·시간·토큰 한도
- 방법: 소스 전수 조사 + 저장소 테스트 실행 + `bun -e` 런타임 재현 (유료 호출 없음)

## 1. 한도 인벤토리

### 1.1 컨텍스트 조립 (디스패치 전)

| 한도 | 값 | 위치 | 초과 시 거동 |
|---|---|---|---|
| advisory 바이트 예산 (G1 fold 트리거) | 24,000 B | `packages/orchestrator/src/context-lifecycle.ts` `DEFAULT_CONTEXT_LIFECYCLE_POLICY` | 초과 시 passed-check 본문 + 이전 시도 resultSummary를 head-요약으로 fold |
| fold 요약 항목 head | 400 B/항목 | 위 동일 | — |
| fold 요약 총 상한 | 4,000 B | 위 동일 | 초과 시 `truncated=true` |
| **보존 세트 상한** | **없음** | 위 동일 (Preservation invariant) | requirements·guidance·failure receipt·dependency 결과·resultSummary는 **절대 fold 되지 않음** |
| guidance 메일박스 메시지 | 16,000 B/단일 메시지 (초과분도 1배치로 전달) | `packages/orchestrator/src/mailbox.ts` `maxMessageBytes` | 전달은 되지만 아래 프롬프트 필드 상한과 충돌 |

### 1.2 워커 프롬프트 조립 (`packages/providers/src/prompt.ts`)

| 한도 | 값 | 초과 시 거동 |
|---|---|---|
| 필수 필드당 | 6,000자 (`MAX_FIELD_LENGTH`) | **throw** — "essential contract field exceeds 6000 characters". 필수 필드: intent, task id/title/kind/attempt/cwd, read/write scope, requirements 각 항목, persona, completion checks 각 항목, guidance 각 항목, previousFailure |
| 프롬프트 총량 (essential) | 16,000자 (`MAX_PROMPT_LENGTH`) | **throw** — "essential contract exceeds 16000 characters" |
| 프롬프트 총량 (supplemental) | 16,000자 | 무음 head-truncate + `...[truncated]` (dependency 결과, previous checks 수신) |
| 지원 필드당 | 6,000자 | 무음 head-truncate |

throw는 `provider.start()` reject → `task-execution.ts` catch → `recordWorkerResult(success:false)` → **시도 사다리 소모** (§3).

### 1.3 실행 (프로세스·시간)

| 한도 | 값 | 위치 | 초과 시 거동 |
|---|---|---|---|
| 시작 타임아웃 | 30,000 ms (하드코딩) | `task-execution.ts` `startup()` | `StartupUncertain` → attention, 핸들 지연 회수 |
| stall 워치독 (무음 예산) | 기본 15분 (`DEFAULT_STALL_TIMEOUT_MS`, `policy.toml [recovery].stall_timeout_ms`) | `config.ts:561`, `task-execution.ts` | `WorkerStalled` → 실패 결과로 기록 → 재시도 사다리. 진행 신호: 프로바이더 이벤트, lifecycle 전이, 체크 마일스톤 (lease 갱신·owner 헬스는 제외) |
| 프로세스 run 타임아웃 | 30분 (`DEFAULT_RUN_TIMEOUT_MS`) | `packages/providers/src/process.ts` | SIGTERM→(3s)→SIGKILL, exit 124, stderr에 "worker timed out" → `timeout/retryable` 분류 |
| stdout/stderr 버퍼 | tail 256,000자 | `process.ts` `bounded()` | 오래된 출력 드롭 |
| worker 상호작용 | release 5s×2회, cancel 5s | `task-execution.ts` `bounded()` | 초과 시 CleanupFailed→attention 또는 cancel 불명확→attention |
| 실행 lease TTL | 5,000 ms (갱신 하트비트) | `coordinator.ts` claim/renew | 만료 시 소유권 상실 → 재조정 경로 |
| 완료 체크 타임아웃 | 체크당 `timeoutMs` (기본 120초) | `loop-core/src/task/contract.rs`, `completion.ts` `safeTimeout` | `timedOut=true`, exit 124. **체크 간 진행 신호 없음** (직렬 실행, 검증 시작/종료에만 touchProgress) |
| 태스크 총 벽시계 예산 | **없음** | — | 시도×(stall/run 타임아웃)+폴백 체인이 누적 가능 |

### 1.4 결과 반환

| 한도 | 값 | 위치 | 초과 시 거동 |
|---|---|---|---|
| 결과 요약 (프로바이더) | head 4,000자 | `process-provider.ts` `redactProviderText` 기본값 | 무음 head-truncate |
| 결과 요약 (오케스트레이터 저장) | tail 16,000자 | `orchestrator/redact.ts` `redact` 기본값 | `recordWorkerResult` 요약·catch 경로 오류 메시지 |
| 체크 수신 stdout/stderr | tail 16,000자 인라인 + **500자 초과분은 아티팩트 파일 참조** | `evidence-artifact.ts` `INLINE_LIMIT=500` | 이미 "아티팩트 참조 + 바운드 요약" 패턴 |
| 결과 요약 누락 | exit 0 + 요약 없음 | `process-provider.ts` `normalizeProcessResult` | `incomplete_output/retryable` → 재시도 (요약만 누락된 성공도 재실행됨) |
| 활동 기록 | 1Hz throttle, 라인 tail 300자, 태스크당 8줄 | `task-execution.ts`, `loop-core ACTIVITY_HISTORY_LIMIT=8` | 드롭 (프레젠테이션 한도) |
| attention/활동 요약 | 500자 | `task-execution.ts` | truncate |

## 2. 재현된 실패 (유료 호출 없음)

기존 테스트 (전부 통과 확인):

- `packages/providers/test/prompt.test.ts` — "oversized required guidance fails before a worker receives an incomplete brief", "buildWorkerPrompt rejects oversized required context without exposing credentials", "large evidence cannot remove the worker's scope and completion contract" (7 pass)
- `packages/orchestrator/test/stall-watchdog.test.ts` — "the stall watchdog fails a silent attempt with a stalled worker result" 등 (stall 임계·설정 스레딩 확인)
- `packages/orchestrator/test/context-dispatch.test.ts` — "folding fires on oversized advisory context and preserved sets stay verbatim" (fold가 보존 세트를 건드리지 않음을 확인)

런타임 재현 (`bun -e`, 요약 — 전체 스크립트는 §5):

| # | 시나리오 | 결과 |
|---|---|---|
| 1 | `previousFailure` 6,001자로 디스패치 | `buildWorkerPrompt` throw — 시도 시작 전 사망 |
| 2 | 동일 컨텍스트를 G1 fold 통과 후 재조립 | previousFailure 길이 6,001 불변(보존 세트) → **모든 후속 시도에서 동일 throw** |
| 3 | guidance 단일 항목 6,001자 | throw (메일박스는 16,000B까지 전달하므로 실제로 도달 가능) |
| 4 | intent 6,001자 | throw — run 의도가 길면 run 내 모든 태스크 디스패치 실패 |
| 5 | previousChecks 200KB 수신 | 생존 — supplemental head-truncate, 프롬프트 6,779자 |

## 3. 죽는 경우 vs 복구 불가 지점

재시도 상호작용: `maxAttempts` 기본 3 (`loop-core/src/task/task.rs`). 실패 결과는 소유자 lease 하에서 `VerificationClassifiedFailure`로 기록 (`loop-bridge/src/commands/task.rs`): transport 마커 일치 시 `Interrupted`→attention, 그 외 `Environment`→attempt++→Ready 재시도. `Assertion` 이외가 사다리 끝에 도달하면 `Failed`(터미널) + 의존성 terminalize (`loop-core/src/event/reducer.rs:398-421`).

| 지점 | 분류 | 경로 |
|---|---|---|
| 필수 필드(보존 세트) > 6,000자 | **복구 불가 + 시도 3회 낭비** | throw는 매 시도 동일 재현(재현 #2) → `Environment`로 재시도 3회 소모 → `Failed` + 의존성 terminalize. fold가 보존 세트를 축소하지 않으므로 재시도로 회복 불가 |
| failure 요약 6,001–16,000자 저장 | 동일 루프의 트리거 | 오케스트레이터가 tail 16,000자로 저장(§1.4) → 다음 시도 `previousFailure` 필수 필드 초과. (프로세스 프로바이더 요약은 이미 head 4,000자라 안전하나, catch 경로 `redact(error)`와 비프로세스 어댑터는 16,000자까지 저장 가능) |
| 6,001–16,000자 guidance 전달 | 복구 불가 | 메일박스는 전달(1.1), 프롬프트는 throw(1.2) — guidance는 보존 세트라 fold도 불가 |
| 무음 15분 | 회복 가능(재시도) | `WorkerStalled` → Environment 재시도. 단 3회×15분=45분 소모 후 종료 |
| 출력하며 미종료 30분 | 회복 가능 | run 타임아웃 kill → `timeout/retryable` → 폴백 체인 → 사다리. 태스크 총 예산 없음(≈30분×시도×폴백) |
| 15분+ 직렬 검증 | 회복 가능하나 부작용 | 체크 간 touchProgress 없음 → stall 발동 → `verifier.verify`는 취소되지 않고 고아 실행, 다음 시도가 체크 재실행 (중복 실행) |
| startup 30초 초과 | attention | `StartupUncertain` — 시도 소모 없음 |
| exit 0 + 요약 누락 | 재시도 낭비 | `incomplete_output/retryable` — 작업은 끝났는데 요약만 없어도 전체 재실행 |
| 저장 요약 16,000자 테일 컷 | 정보 손실 | head가 아닌 tail이므로 실패 원인 서두 유실 — 다음 시도 디버깅 힌트 상실 |

## 4. 회복 설계 권고 (pi compaction + Claude식 압축 참고)

참고: pi Compaction Reference (pi-coding-agent 설치 문서 `docs/compaction.md` — 저장소 내 경로엔 부재, 인용 시 설치 경로 사용). 핵심 메커니즘: ① 임계 트리거(`contextTokens > window − reserveTokens`, reserve 16,384) ② overflow/length 시 **정확히 1회 compact-and-retry** ③ 컷은 사용자/어시스턴트 경계에서, 도구 결과는 호출과 분리 금지 ④ 직렬화 시 tool result 2,000자 truncate + 잘림 마커 ⑤ 구조화 요약(Goal/Constraints/Progress/Decisions/Next Steps/Critical Context + read/modified files) ⑥ 원본 엔트리는 저장 유지(컨텍스트에서만 omitted) ⑦ 요약 생성 실패 시 재시도 없이 안전 정지. Claude식 마이크로컴팩션: 오래된 도구 결과부터 경량화하고 최근 N개는 원문 유지.

정책 위치 (경계 유지): 한도·분류·사다리는 이미 `loop-core`에 있음(`FailureClass`, `RetryBudget`, `maxAttempts`). 결정론적 head-clamp fold는 순수 함수이므로 **loop-core Rust로** 이동 가능(현재 "요약은 compute 호출 가능 → orchestrator" 경계는 LLM 요약에만 유지). 어댑터는 프롬프트 렌더만 담당하는 현 구조 유지.

| # | 권고 | 대응 한도 | 위치 | 검증 |
|---|---|---|---|---|
| R1 | **보존 세트 필드 클램프**: previousFailure/guidance/intent/requirements를 6,000자 head + `[truncated N chars]` 마커로 클램프하는 결정론적 fold(정책 타입 `ContextBudgetPolicy`는 loop-core). 원본은 스토어에 존재하므로 요약은 참조만 | §2 #1–4 복구 불가 루프 제거 | loop-core(정책) + orchestrator(적용) | 단위 테스트: 6,001자 failure가 클램프 후 프롬프트 통과 |
| R2 | **디스패치 전 사전 검증 게이트**: 프롬프트 조립 실패를 `FailureClass::InvalidContract`로 1회 attention — 결정론적 실패에 시도 사다리 소모 금지(`FailurePolicy::evaluate`는 이미 deterministic 클래스 재시도를 거부하므로 분류만 정확히) | 시도 3회 낭비 → 1회 attention | loop-core 분류 + task-execution throw 매핑 | 단위 테스트: oversized 컨텍스트가 attempt를 소모하지 않음 |
| R3 | **overflow compact-and-retry 1회**: essential > 16,000자면 supplemental 전체 드롭 + 보존 세트 클램프본으로 1회 재조Assembly(pi ②·⑦). 그래도 초과면 attention | essential > 16k 하드 throw | orchestrator(조립은 providers) | 단위 테스트: 재조립 성공/실패 두 갈래 |
| R4 | **결과 아티팩트 참조 확장**: 실패 요약 저장도 `storeCheckOutput` 패턴(500자 초과분 아티팩트 + 바운드 head)으로 통일, 저장 상한을 필드 상한 이하로(§1.4 테일컷→head 전환) | 6,001–16,000자 failure 루프·정보 손실 | loop-bridge 저장 + orchestrator | 단위 테스트: 16k 실패 요약 저장 후 다음 디스패치 성공 |
| R5 | **검증-스톨 정합**: 완료된 체크마다 touchProgress + stall 발동 시 AbortSignal로 `verify` 취소(고아 제거) | 15분+ 직렬 검증 중복 실행 | task-execution | stall-watchdog 테스트 확장 |
| R6 | **태스크 총 시간 예산**: 시도×(stall, run 타임아웃) 합산 상한을 loop-core 정책으로, 초과 시 Environment 재시도 대신 attention | 총 벽시계 무상한 | loop-core 정책 + coordinator | 단위 테스트: 예산 초과 시 재시도 대신 attention |
| R7 | **구조화 요약 스키마**: `loop.context_summary`의 summary를 pi 형식(Goal/Progress/Key Decisions/Next Steps/Critical Context)으로 권고하고, 체크 수신은 "id + exit + head" 유지(pi ③④) | fold 요약 품질 | context-lifecycle (문서+선택 적용) | 기존 context-lifecycle 테스트 확장 |

우선순위: R1·R2·R4가 §3의 복구 불가 지점을 직접 제거한다. 전부 유료 호출 없이 단위 테스트로 검증 가능하다.

## 6. 구현 후 판정 (guard-verification)

검증 기준: 2026-10-05 작업 트리. `bun run build:cli && ./dist/loop verify-install` 통과. `bun run check` 실패(종료 코드 1): `lint` 단계에서 쓰기 범위 밖의 미추적 파일 `apps/loop-mobile/src/ui/DrawerMenu.tsx:115:7`에 `error eslint(no-unused-vars): Variable 'DRAWER_PANEL_FRACTION_APPLIED' is declared but never used. Unused variables should start with a '_'. help: Consider removing this declaration.` 발생. 원문 종료 메시지: `error: script "lint" exited with code 1` / `error: script "check" exited with code 1`. 그 외 다수 경고는 종료 원인으로 확인되지 않음. 따라서 전체 체크 통과는 판정할 수 없음. 해당 파일은 선언된 쓰기 범위 밖이므로 수정하지 않음.

| 권고 | 판정 | 근거 |
|---|---|---|
| R1 보존 세트 필드 클램프 | 해소 | loop-core `ContextBudgetPolicy` 기반 클램프 구현. 6,001자 previousFailure 디스패치 재현 테스트에서 필드 한도 내 마커 포함으로 통과. |
| R2 사전 검증/결정론적 실패 분류 | 해소 | prompt-limit 실패를 `InvalidContract`로 분류해 재시도 사다리 1회 소모 후 종결. 회귀 테스트 통과. |
| R3 overflow compact-and-retry 1회 | 부분 해소 | 전체 예산 사다리의 문맥 축소와 축소 재시도 구현·테스트 확인. 프롬프트 essential 총량 초과의 별도 1회 재조립 동작은 증거가 없어 미확인. |
| R4 결과 아티팩트 참조 및 저장 요약 head 전환 | 부분 해소 | 대형 의존성 결과·재시도 영수증에 아티팩트 참조 기반 압축 경로가 구현됨. 모든 실패 요약 저장 경로의 head 저장 전환은 확인되지 않아 미확인. |
| R5 검증 stall 정합/취소 | 미해결 | 이번 작업 증거에 체크 간 진행 갱신 및 AbortSignal 취소 구현·검증이 없음. |
| R6 태스크 총 시간 예산 | 미해결 | 이번 작업 증거에 loop-core 총 벽시계 예산 구현·검증이 없음. |
| R7 구조화 요약 스키마 | 미해결 | 이번 작업 증거에 권고된 구조화 스키마 적용이 없음. |

구현 단위 증거(의존 작업 보고): `cargo test -p loop-core` 125 통과, `bun test packages/orchestrator` 198 통과, `bun run codegen:check` 통과, `cargo test -p loop-bridge` 44 통과, `bun run typecheck` 통과. 이 증거는 현재 `bun run check` 실패를 대체하지 않는다.

### 최종 검증 판정 (final-verify, 2026-10-05)

- `bun run check`: 통과(exit 0). 최초 재검증에서 `apps/loop-mobile/src/ui/DrawerMenu.tsx`의 `DRAWER_PANEL_FRACTION_APPLIED` 미사용이 lint 오류로 확인되어, 상수를 실제 패널 너비 계산에 사용하고 값의 단일 출처를 `DRAWER_WIDTH_FRACTION`으로 정리했다. 수정 후 codegen, lint, typecheck, architecture 검사 및 전체 테스트가 모두 통과했다 (938 tests, 0 failures).
- `bash -lc 'bun run build:cli && ./dist/loop verify-install'`: 이전 실행에서 통과(exit 0). 오프라인 수락 결과: `State: completed`, `Tasks: 7`, `Max concurrency: 3`, `Escalations: 1`.
- 한도 격차 최종 판정은 아래 R1–R7 표와 같다.

| 권고 | 최종 판정 |
|---|---|
| R1 보존 세트 필드 클램프 | 해소 — 구현 및 경계 테스트 증거 기록됨. |
| R2 사전 검증/결정론적 실패 분류 | 해소 — 분류 및 회귀 테스트 증거 기록됨. |
| R3 overflow compact-and-retry 1회 | 부분 해소 — 축소 재시도는 있으나 essential 초과 재조립 증거 없음. |
| R4 결과 아티팩트 참조 및 저장 요약 head 전환 | 부분 해소 — 일부 결과 경로의 아티팩트 압축은 있으나 모든 실패 저장 경로 증명되지 않음. |
| R5 검증 stall 정합/취소 | 미해결 — 구현·검증 증거 없음. |
| R6 태스크 총 시간 예산 | 미해결 — 구현·검증 증거 없음. |
| R7 구조화 요약 스키마 | 미해결 — 구현·검증 증거 없음. |

### 재검증 판정 (final-verify 재실행)

- `bun run check`: 통과(exit 0). 최초 오류는 `DrawerMenu.tsx:115:7`의 미사용 상수였다. 상수를 너비 계산에 연결한 뒤 전체 명령이 성공했고, 테스트 결과는 938 통과 / 0 실패였다.
- `bash -lc 'bun run build:cli && ./dist/loop verify-install'`: 통과(exit 0), 기존 실행에서 CLI 빌드 및 오프라인 수락 성공 (`State: completed`, `Tasks: 7`, `Max concurrency: 3`, `Escalations: 1`).
- R1·R2 해소, R3·R4 부분 해소, R5–R7 미해결 판정은 변경 없이 유지한다. 두 최종 검증 요구사항을 모두 충족했다.

## 5. 재현 스크립트 (저장소 루트에서 `bun -e '…'`로 실행, 파일 생성 없음)

```ts
import { buildWorkerPrompt } from "./packages/providers/src/prompt.ts";
import { summarizeTaskContext, DEFAULT_CONTEXT_LIFECYCLE_POLICY } from "./packages/orchestrator/src/context-lifecycle.ts";

const ctx = (o = {}) => ({
  intent: "i", workingDirectory: "/tmp/w",
  task: { id: "t1", title: "T", kind: "implementation", preferredCompute: "fast", maximumCompute: "fast",
    readScope: [], writeScope: ["src/**"], requirements: ["r"],
    completionChecks: [{ id: "c", command: "true", args: [], workingDirectory: null, timeoutMs: 120000 }],
    dependencies: [], persona: null, maxAttempts: 3 },
  decompositionContract: null, attempt: 0, dependencyResults: [],
  resultSummary: null, previousFailure: null, previousChecks: [], guidance: [], ...o,
});
const start = (c) => buildWorkerPrompt({ runId: "r", taskId: "t1", title: "T", kind: "implementation", attempt: 1, requirements: ["r"], context: c });

try { start(ctx({ previousFailure: "F".repeat(6001) })); } catch { /* [1] throw — 필수 필드 상한 */ }
const { context: folded } = summarizeTaskContext(ctx({ previousFailure: "F".repeat(6001) }), DEFAULT_CONTEXT_LIFECYCLE_POLICY);
console.log(folded.previousFailure.length); // [2] 6001 — fold 무손상 → 재시도해도 동일 throw
try { start(ctx({ guidance: ["g".repeat(6001)] })); } catch { /* [3] throw */ }
try { start(ctx({ intent: "i".repeat(6001) })); } catch { /* [4] throw */ }
// [5] 200KB receipt → 생존 (supplemental head-truncate)
```

실행 결과(2026-10-05): [1] throw, [2] 6001 불변, [3] throw, [4] throw, [5] 6,779자 + `...[truncated]`.
