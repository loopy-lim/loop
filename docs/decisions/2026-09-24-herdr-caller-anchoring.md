# Herdr Caller-Anchoring — worker 탭·미러 패널 배치 계약

- **Date:** 2026-09-24
- **Status:** decided (shipped — 본 문서는 구현과 일치하도록 최종 확정됨)
- **Kind:** decision
- **Read scope:** `packages/herdr/src/client.ts`, `packages/herdr/src/worker.ts`, `packages/orchestrator/src/cleanup.ts`, `packages/providers/src/herdr-agent.ts`, `packages/providers/src/mirror.ts`
- **Defects:** `HerdrWorkerRuntime.createPane()`이 caller를 무시하고 항상 `#ensureWorkspace`로 별도 `loop-<runId>` 워크스페이스를 만든다. `HERDR_PANE_ID` 부재 시 폴백 계약이 문서화돼 있지 않다.

## 결정

### 1. 배치 규칙 (placement)

- **caller 있음:** `HERDR_PANE_ID`가 설정됐으면 worker 탭과 미러 패널 모두 **Lead 패널과 같은 caller 워크스페이스의 형제 탭**으로 만든다 (`tab create --workspace <caller.workspaceId> --no-focus`). 워크스페이스 추가 생성 금지. 탭 순서는 herdr 소관으로 계약하지 않는다.
- **caller 없음 (명시적 폴백):** `HERDR_PANE_ID`가 unset/empty이거나 **malformed(구분자 `:`가 없거나 워크스페이스 접두사가 빈 값)**이면 caller를 `undefined`로 판정하고 기존대로 실행당 전용 `loop-<runId>` 워크스페이스(`#ensureWorkspace`)에 배치한다.
- 파싱은 단일 순수 함수 `herdrCallerFromEnvironment(env): HerdrCaller | undefined`로 통일한다. **shipped 위치는 `packages/herdr/src/client.ts`**이며 패키지 index로 재노출된다(`HerdrCaller` 타입은 `worker.ts`). 규칙: `{ workspaceId = HERDR_PANE_ID의 첫 ':' 앞 접두사, paneId = 원본 값 }`, `indexOf(":") <= 0`이면 `undefined`. `HERDR_WORKSPACE_ID`는 배치 근거가 아니라 mirror sink 활성 게이트(`hasHerdrContext`)로만 유지한다.
- caller-anchored 실행은 `#workspaces`에 runId 엔트리를 만들지 않는다(Loop 소유 워크스페이스가 없음). 생성한 탭 id는 Loop 워크스페이스가 존재할 때만 runId별로 추적하며, 실행 종료 시 정리는 탭 단위(`tab close`)다.

### 2. 시그니처 변경

- `HerdrWorkerRuntime.createPane`과 `PaneMirrorHost.createPane` 모두 **끝에 선택 파라미터 `caller?: HerdrCaller`를 추가**한다:
  `createPane(runId, taskId, projectRoot, worktree, label?, caller?)`. `label`은 PaneMirrorHost 호환용으로만 받고 무시하며(미러 라벨은 taskId에서 파생), 기존 5-인자 호출부는 소스·구조적으로 호환(파라미터 수가 적은 함수는 assignable).
- `HerdrWorkerRuntime.createPane` 구현: `const parent = caller ?? await this.#ensureWorkspace(...)` — `start()`와 동일한 규칙. `#ensureWorkspace`는 no-caller 경로에서만 호출된다.
- `PaneMirrorSink.onWorkerStart`가 자신의 `environment`에서 헬퍼로 caller를 유도해 전달한다. `herdr-agent.ts`의 인라인 `split(':')` 파싱도 헬퍼로 교체됐다(동작 동일, 단일 출처).

### 3. agents-view 가시성 보장 (`herdr agent list`)

- agent 실행(`execution.type === "agent"`)의 모든 worker는 배치와 무관하게 `herdr agent start <workerId> --kind <kind> --pane <paneId>`로 등록되고(`agent_pane_busy` 재시도 포함), 핸들은 `agentName = workerId`를 유지한다. identity(workerId/agentName)와 표시 라벨(`<taskId>·<kind>·a<attempt>`)은 분리다.
- 따라서 caller-anchored 탭(Lead 워크스페이스)이든 `loop-<runId>` 폴백 워크스페이스든 **worker는 항상 `herdr agent list`에 나타난다**. status/read/cancel/prompt도 `agentName`이 있으면 `agent get/agent read/agent send-keys/agent prompt`를 사용한다.
- caller-anchoring은 **탭이 어느 워크스페이스에 호스팅되는지만 바꾼다**. agents-view 보장은 배치와 독립적이다. 미러 패널은 수동 뷰어 표면이며 의도적으로 agent로 등록하지 않는다(수명은 `closePane` 소유).

### 4. cleanup.ts 소유권 — 변경 불필요 (불변식 명시만)

- `isOwnedByLoop: !request.caller && !request.isLeadPane`은 이미 caller 워크스페이스를 Loop 비소유로 분류하고, bridge 정책이 거절("caller-owned surface")하면 `closeWorkspace(runId)`는 실행되지 않는다. caller-anchored 미러 패널은 **사용자 워크스페이스 안의 탭**이므로 `purgeLeakedWorkspaces`의 워크스페이스 라벨 접두사(`loop-loop-`) 스캔과도 매치될 수 없다.
- 계약: `purgeLeakedWorkspaces`와 `closeWorkspace`의 라벨 폴백은 **워크스페이스 라벨만** 검사한다(탭/패널 검사 금지). cleanup.ts와 `packages/orchestrator` 코드는 이 결정에서 변경 없음 — caller 소유 거절 불변식은 기존 커밋(2026-09-22, a2ed996)의 `cleanup.test.ts` 회귀 테스트가, 라벨 전용 스캔 불변식은 이번 변경의 `lifecycle.test.ts` 테스트가 고정한다.
- 알려진 한계(수용): caller 워크스페이스에 남은 고아 탭의 GC 경로는 없다. 탭 단위 수명은 provider release + mirror `closePane`이 소유한다.

### 5. 검증 증거 (전부 fake runner/host — 실 herdr·유료 모델 불요)

- 헬퍼 파싱 계약: `bun test packages/herdr` — `caller.test.ts`(신규): well-formed 파싱, 첫 `:` 분할, absent/empty/malformed → `undefined`, `HERDR_WORKSPACE_ID` 단독 → `undefined`.
- worker 탭 caller 배치: `lifecycle.test.ts` "uses an explicit caller pane instead of creating a workspace" (caller 지정 시 `tab create --workspace <caller>`만 호출, `workspace create` 부재).
- 미러 패널 caller 배치 + 폴백: `lifecycle.test.ts` "anchors mirror panes to the caller workspace without creating a Loop workspace" / "falls back to a dedicated loop-<runId> workspace when no caller is given".
- sink→host 전달: `bun test packages/providers` — `mirror.test.ts` "mirror panes are anchored to the caller workspace derived from HERDR_PANE_ID" / "without HERDR_PANE_ID the sink propagates no caller (loop-<runId> fallback in the host)"; 선택 6번째 파라미터라 기존 5-인자 fake host와 호환.
- agents-view 보장: `lifecycle.test.ts` "starts a recognized agent in a no-focus Herdr pane and submits its task" 등이 `agent start ... --pane` 호출과 핸들의 `agentName`을 단언.
- cleanup 불변식: `bun test packages/orchestrator` — `cleanup.test.ts` "caller-owned and lead surfaces are refused without touching other artifacts" (기존) + `lifecycle.test.ts` "purgeLeakedWorkspaces scans workspace labels only and never inspects caller-anchored tabs" (신규).
- 최종 확정 시 전체 스위트: `bun run check` 통과 (아래 통합 기록 참조).

## 수정 대상 파일 (shipped)

`packages/herdr/src/client.ts`(헬퍼 추가 + createPane 시그니처·배치), `packages/providers/src/mirror.ts`(호스트 인터페이스·sink 전달), `packages/providers/src/herdr-agent.ts`(헬퍼 교체), `packages/herdr/test/lifecycle.test.ts`, `packages/herdr/test/caller.test.ts`(신규), `packages/providers/test/mirror.test.ts`. **Rust 변경 없음. `worker.ts`·`cleanup.ts`·orchestrator 코드 무변경.**

## 리스크

- caller-anchored 고아 탭 GC 부재(수용, 4절). malformed pane id는 폴백 워크스페이스로 떨어지므로 herdr-side id 형식 변경 시 헬퍼 테스트(`caller.test.ts`)가 먼저 깨진다. caller 워크스페이스 내 탭 생성은 herdr의 `tab create --workspace` 의미론에 의존한다.
