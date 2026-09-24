# 진단: Loop task 실행 시 새 space 생성 — caller 배치 전파 추적

- **Date:** 2026-09-24
- **Kind:** research (diagnosis) — 코드 변경 없음
- **Task:** trace-placement-branches
- **Contract:** docs/decisions/2026-09-24-herdr-caller-anchoring.md (decided, commit c606722)
- **Read scope:** herdr client/worker, orchestrator cleanup/composition, providers mirror/herdr-agent, cli main/dispatcher, pi-loop extension

## 1. 결론 요약

배치 코드 자체는 계약(c606722)과 일치한다. 실제 배포 바이너리가 수정 이전 커밋으로
빌드된 것이 가장 유력한 근본 원인이며, 그 외 코드상 남은 새-space 경로는 문서화된
폴백( caller 부재/malformed)과 mirror 활성 게이트의 비대칭뿐이다.

## 2. HERDR_PANE_ID 전파 추적 (CLI → orchestrator → HerdrWorkerRuntime)

| 단계 | 위치 | 전달 방식 |
|---|---|---|
| herdr pane 환경 | 현재 세션: `HERDR_PANE_ID=w3Y:pT` (well-formed `ws:pane`) | herdr 0.8.2 |
| `loop run` → Lead spawn | `packages/cli/src/main.ts:656-661` (`runInteractiveLead`) | `env: process.env` 상속 |
| Lead(pi extension) → 실행 | `packages/pi-loop/src/extension.ts:327-331` (`runLoopPlan`) | spawn에 env 미지정 → 기본 상속 |
| detach owner spawn | `packages/cli/src/dispatcher.ts:15` (`spawnOwner`) | `env: process.env` 명시 상속 |
| provider 구성 | `packages/cli/src/main.ts:252-254` (`__dispatch`) | `environment` 미지정 → `process.env` 기본 (`packages/orchestrator/src/composition.ts:97,170`) |
| worker 탭 | `packages/providers/src/herdr-agent.ts:82` | `herdrCallerFromEnvironment(process.env)` → `runtime.start({ caller })` (line 94) |
| 미러 패널 | `packages/providers/src/mirror.ts:330-335` (`PaneMirrorSink.onWorkerStart`) | `herdrCallerFromEnvironment(this.#environment)` → `host.createPane(..., caller)` |
| 런타임 배치 | `packages/herdr/src/client.ts:140` (`start`), `client.ts:198` (`createPane`) | `caller ?? await this.#ensureWorkspace(...)` |

전파 경로는 끊김이 없다. 모든 링크가 `process.env` 상속이므로, orchestrator
프로세스에 `HERDR_PANE_ID`가 있으면 caller 배치가 선택된다.

완료 검사 증거 (`rg -n "caller \?\?|ensureWorkspace|isOwnedByLoop" ...`):
`client.ts:140,198,481` / `cleanup.ts:82`.

## 3. client·mirror·cleanup 분기 정리

### client.ts (HerdrWorkerRuntime)
- `start()` — `client.ts:140`: `const parent = input.caller ?? (await this.#ensureWorkspace(input))`. caller 있으면 `tab create --workspace <caller.workspaceId>`만 호출(140-158), `workspace create` 없음. caller 없으면 `#ensureWorkspace`(`client.ts:481-516`)가 `workspace create --label loop-<runId>` 생성.
- `createPane()` — `client.ts:198`: 동일 규칙. caller 없을 때만 폴백 워크스페이스.
- caller-anchored 실행은 `#workspaces`에 runId 엔트리를 만들지 않는다(160-162의 조건부 add). 따라서 `closeWorkspace(runId)`(`client.ts:351-377`)는 라벨 조회 → 미발견 → `already_gone` — 사용자 워크스페이스를 닫을 위험 없음.
- `purgeLeakedWorkspaces`(`client.ts:326-348`)와 CLI leak 스캔(`main.ts:104`)은 라벨 접두사 `loop-loop-`만 매치. runId가 `loop-<uuid>`(`extension.ts:150`)이므로 폴백 워크스페이스 라벨 `loop-loop-<uuid>`와 정확히 매치 → **caller 없이 생성된 Loop 소유 워크스페이스는 leak 스캔으로 정리된다.**

### mirror.ts (PaneMirrorSink)
- `onWorkerStart`는 `host.createPane(..., herdrCallerFromEnvironment(this.#environment))`로 caller를 전달한다(`mirror.ts:330-335`) — 계약 준수.
- 단, 활성 게이트는 `hasHerdrContext = HERDR_WORKSPACE_ID || HERDR_PANE_ID`(`mirror.ts:389-391`)로, 배치 입력(HERDR_PANE_ID)과 게이트가 비대칭이다.

### cleanup.ts (orchestrator)
- `cleanup.ts:82`: `isOwnedByLoop: !request.caller && !request.isLeadPane` — caller 없이 생성된 워크스페이스는 Loop 소유로 판정되어 `closeWorkspace(runId)`(`cleanup.ts:128`)가 허용된다. caller 있으면 "caller-owned surface" 거절. 불변식은 `cleanup.test.ts`가 고정.
- **배치 갭:** orchestrator 레벨 `cleanupRun`은 프로덕션 호출부가 없다. `Orchestrator.cleanupRun`(`coordinator.ts:66-68`)과 `LoopRuntime.cleanupRun`(`runtime.ts:57-65`)이 존재하지만 이를 호출하는 프로덕션 코드가 없고, CLI `loop cleanup`은 브리지 `protocol.cleanupRun` + `loop-loop-` 스캔(`main.ts:95-116`)으로 우회한다. caller-aware 분기는 현재 테스트 전용 경로.

## 4. 테스트 실행 결과 (전부 fake runner/host, 유료 모델 불요)

| 스위트 | 결과 | 핵심 테스트 |
|---|---|---|
| `bun test packages/herdr` | 47 pass / 0 fail | caller 파싱 4종(caller.test.ts), "uses an explicit caller pane instead of creating a workspace", "anchors mirror panes to the caller workspace…", "falls back to a dedicated loop-<runId> workspace…", purge 라벨 전용 스캔 |
| `bun test packages/providers` | 71 pass / 0 fail | "mirror panes are anchored to the caller workspace derived from HERDR_PANE_ID", "without HERDR_PANE_ID the sink propagates no caller" |
| `bun test packages/orchestrator` | 82 pass / 0 fail | cleanup caller-owned 거절 불변식 |

테스트 공백: (a) `HERDR_WORKSPACE_ID`만 있는 환경에서 sink가 활성화되며 caller 없이
폴백 워크스페이스를 만드는 조합 테스트 없음, (b) orchestrator cleanupRun의 프로덕션
와이어링(호출부 부재)을 검출하는 아키텍처 테스트 없음.

## 5. '새 space 생성'을 목격하는 시나리오

1. **herdr 밖에서 실행** (`HERDR_PANE_ID` unset): 문서화된 폴백 — `#ensureWorkspace`가 `loop-loop-<uuid>` 워크스페이스 생성(`client.ts:140,492`). by-design.
2. **malformed `HERDR_PANE_ID`** (`:` 부재/빈 접두사, `client.ts:25-27`): caller undefined → 시나리오 1과 동일한 폴백. 로그로 구분 불가하여 원인 파악이 어렵다.
3. **`HERDR_WORKSPACE_ID`만 설정, `HERDR_PANE_ID` unset**: 게이트는 통과(`mirror.ts:390`)하지만 caller는 undefined → 미러 패널만으로 폴백 워크스페이스 생성(`mirror.ts:330-335` → `client.ts:198`). 게이트/배치 입력 비대칭.
4. **수정 이전 바이너리로 실행 (가설 1위 — 아래 6절)**: c606722 이전 `createPane`은 caller를 무시하고 항상 폴백 워크스페이스 생성. HERDR_PANE_ID가 정상이어도 재현됨.

## 6. 근본 원인 진단

- **운영적 원인 (가장 유력):** 설치된 `loop`는 `~/.local/bin/loop → dist/loop` 심링크이고 `dist/loop`는 **Sep 23 23:59** 빌드. 수정 커밋 c606722는 **Sep 24 01:23**. 즉, 배포 바이너리는 caller-anchoring 수정 이전 코드이며, HERDR_PANE_ID가 정상인 환경에서도 새 space가 만들어진다. → **수정 지점: 코드가 아니라 배포물 재빌드(`bun run check` 후 dist 재생성).**
- **코드상 잔존 경로:** 5절 시나리오 1~3. 시나리오 3의 비대칭은 `hasHerdrContext`를 `HERDR_PANE_ID` 기준으로 좁히거나(동작 변경 — 계약 문서 수정 수반), 워크스페이스-only 컨텍스트에서 caller를 유도하는 방식으로 정렬 가능하다. 현재 herdr 0.8.2 세션은 두 변수를 함께 설정하므로 당장의 재현 원인은 아니다.
- **구조적 갭 (버그는 아니지만 계약 미완):** caller-aware orchestrator cleanup이 프로덕션에 와이어링되지 않음(3절). run 종료 시 폴백 워크스페이스 정리는 `process.on("exit")` 핸들러(`client.ts:110-120`, SIGKILL/crash 시 미동작)와 `loop cleanup` leak 스캔에 의존한다.

## 7. 리스크 / 미해결

- dist 바이너리가 수정 전 커밋이라는 점은 빌드 시각으로 추정한 것 — 실행 재현(`loop run` 1회 + `herdr workspace list`)으로 확정 가능하나 유료 모델 호출이 수반될 수 있어 이번 스코프 밖.
- caller-anchored 고아 탭 GC 부재는 계약상 수용된 한계(결정 문서 4절).
- 작업 트리에 persona 관련 미커밋 변경 존재(coordinator/runtime 등) — 배치 경로와 무관 확인.
