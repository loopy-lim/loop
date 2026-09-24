# 진단 보고서: Loop task 실행 시 새 space가 생성되는 근본 원인

- **Date:** 2026-09-24
- **Kind:** finding (diagnosis) — 코드 변경 없음
- **Task:** diagnosis-report (id=diagnosis-report, attempt=0)
- **Contract:** docs/decisions/2026-09-24-herdr-caller-anchoring.md (decided, commit c606722)
- **선행 리서치:** docs/research/2026-09-24-new-space-placement-diagnosis.md (전파 추적·배치 분기), run-existing-tests (테스트 실행), trace-caller-capture

## 결론 요약

근본 원인은 **배치 코드의 결함이 아니라 배포 바이너리의 stale 빌드**다. `~/.local/bin/loop` → `dist/loop`(빌드 09-23 23:59:22)는 caller-anchoring 완성 커밋 c606722(09-24 01:23) **이전** 소스(ecee48c 시점 client.ts + a701a58 시점 mirror/herdr-agent)로 만들어졌고, 이 구버전 `createPane()`은 caller 파라미터가 없어 미러 패널 생성 시 **무조건 `#ensureWorkspace` → `herdr workspace create --label loop-<runId>`** 로 새 space를 만든다. 워커 탭 경로(`start()`)는 구빌드에도 caller anchoring이 있으므로, 새 space 안에 생기는 탭은 `mirror·<taskId>` 라벨의 미러 패널일 것이라는 **검증 가능한 예측**이 성립한다. 소스 전파 경로(CLI→orchestrator→HerdrWorkerRuntime)는 끊김 없이 계약과 일치하며, 수정은 코드 변경이 아니라 **재빌드(`bun run build:cli`)** 로 완료된다.

## 1. 근본 원인 확정/순위화

### 1순위 — 확정: stale 배포 바이너리 (dist/loop)

| 증거 | 내용 |
|---|---|
| 빌드 시각 | `dist/loop`, `dist/loop-pi-extension.js` 모두 **09-23 23:59:22** / caller-anchoring 소스(client.ts, mirror.ts, herdr-agent.ts) mtime **09-24 01:21:44**, 커밋 c606722 **09-24 01:23** |
| 바이너리 문자열 | `strings dist/loop`에 `herdrCallerFromEnvironment` **부재**. 반면 구버전 흔적 2개 존재: `input.caller ?? await this.#ensureWorkspace(input);`(start, 괄호 없는 구형) + `const parent = await this.#ensureWorkspace({`(caller 파라미터 없는 구형 createPane) |
| 구버전 소스 대조 | `git show ecee48c:packages/herdr/src/client.ts`의 `createPane(runId, taskId, projectRoot, worktree, label)`은 caller 인자가 없고 본문 첫 줄이 `#ensureWorkspace(...)` — 바이너리 문자열과 정확히 일치 |
| 설치 경로 | `~/.local/bin/loop` → `/Users/loopy/dev/ll3/loop/dist/loop` 심볼릭 링크. 사용자가 실행하는 것이 곧 stale 빌드 |

구빌드에서도 `start()`(f7070ed, 09-22 "워커를 caller 워크스페이스의 탭으로 배치")는 caller를 지원하므로 **워커 탭은 Lead 워크스페이스에 배치된다**. 새 space는 미러 패널 경로에서만 발생한다. 증상("새 space 생성 + 그 안에 탭")과 정확히 부합한다.

### 2순위 — 가설 (배제 근거와 함께 유지)

- **H1: `HERDR_WORKSPACE_ID`만 설정된 환경** — sink 활성 게이트는 `HERDR_WORKSPACE_ID || HERDR_PANE_ID`(`packages/providers/src/mirror.ts:390`)인데 배치 입력은 `HERDR_PANE_ID`만 사용한다(비대칭). 이 환경에서는 sink가 활성화되지만 caller가 `undefined`여서 정상 배포본에서도 폴백 워크스페이스가 생긴다. **가설**: 현재 세션 환경값을 직접 관측하지 못해 확정 불가(선행 리서치도 동일 표시). 조합 테스트 부재가 공백.
- **H2: 전파 끊김** — **배제됨.** 모든 링크가 `process.env` 상속이라 세부 추적으로 끊김 없음 확인(아래 2절).
- **H3: cleanup이 space를 못 정리해서 남는 것** — 생성 원인이 아님(정리 측). 다만 orchestrator `cleanupRun`의 프로덕션 호출부 부재는 확인된 별도 갭.

## 2. HERDR_PANE_ID/caller 전파 추적 (현재 소스 기준 — 계약 준수 확인)

| 단계 | 위치 | 전달 |
|---|---|---|
| `loop run` | `packages/cli/src/main.ts:908` → `spawnOwner` | — |
| owner spawn | `packages/cli/src/dispatcher.ts:15` | `env: process.env` 명시 상속 |
| provider 구성 | `packages/orchestrator/src/composition.ts:89,185` | `environment ?? process.env` 기본 |
| worker 탭 | `packages/providers/src/herdr-agent.ts:82` | `herdrCallerFromEnvironment(process.env)` → `runtime.start({ caller })` |
| 미러 패널 | `packages/providers/src/mirror.ts:327` | `herdrCallerFromEnvironment(this.#environment)` → `host.createPane(..., caller)` 6번째 인자 |
| 배치 분기 | `packages/herdr/src/client.ts:140`(start), `:198`(createPane) | `caller ?? await this.#ensureWorkspace(...)` |

단일 헬퍼 `herdrCallerFromEnvironment`(`packages/herdr/src/client.ts:21`)로 파싱이 통일돼 있고, caller-anchored 실행은 `#workspaces`에 runId 엔트리를 만들지 않는다. **전파 경로에 결함 없음.**

## 3. client·mirror·cleanup 분기 (caller 유무)

- **client.ts** — caller 있음: `tab create --workspace <caller.workspaceId> --no-focus`만 호출, 워크스페이스 생성·추적 없음. caller 없음/ malformation: `#ensureWorkspace`(`client.ts:481`)가 `workspace create --label loop-<runId>`(`client.ts:497`) 생성 — 문서화된 폴백.
- **mirror.ts** — sink는 caller를 host에 전달하며, 게이트 비대칭(`HERDR_WORKSPACE_ID` 단독 시 활성)만 H1 가설로 남음.
- **cleanup.ts** — `isOwnedByLoop: !request.caller && !request.isLeadPane`로 caller 소유 표면 거절 불변식 유지. `purgeLeakedWorkspaces`는 라벨 접두사 `loop-loop-`만 스캔하므로 caller 워크스페이스를 침범하지 않음. 주의: 위 1순위 원인으로 만들어진 `loop-<runId>` 워크스페이스는 runId가 `loop-<uuid>`라 라벨이 `loop-loop-<uuid>`가 되어 **leak 스캔 대상으로 정리 가능**.

## 4. 테스트 실행 결과 (직접 재실행 — fake runner/host, 유료 모델 불요)

```
bun test packages/herdr packages/providers packages/orchestrator
→ 215 pass, 0 fail (772 expect() calls, 24 files)
```

- caller 파싱(caller.test.ts), 워커/미러 caller 배치·폴백(lifecycle.test.ts), sink 전달(mirror.test.ts), cleanup caller-owned 거절(cleanup.test.ts) 모두 통과 → **소스 배치 로직은 정상, 문제는 배포물**이라는 진단과 일치.
- 공백: (a) `HERDR_WORKSPACE_ID` 단독 환경 조합 테스트 없음(H1), (b) `dist` 빌드 신선도를 검증하는 테스트 없음(본 결함의 직접 공백), (c) orchestrator `cleanupRun` 프로덕션 호출부 부재는 아키텍처 테스트로도 미검출.

## 5. 수정 지점과 예상 수정 방향 (코드 변경 없음)

| 우선순위 | 지점 | 수정 방향 |
|---|---|---|
| 1 (즉시) | `dist/loop` — 배포 바이너리 | **재빌드**: `bun run build:cli`(또는 `bun run build`). `~/.local/bin/loop` symlink가 즉시 반영. 소스 변경 불요 |
| 2 (예방, 별도 과제) | 빌드 신선도 검증 부재 | `verify-install`(`packages/cli/src/main.ts:230`)에 번들 소스 해시↔워킹트리 대조 추가, 또는 CI에서 `dist` mtime/해시 vs `packages/*/src` 검사. 이번 결함 유형("코드는 맞고 실행물이 stale")의 재발 방지는 코드가 아니라 **배포 파이프라인 계약** |
| 3 (부차) | `packages/providers/src/mirror.ts:390` 게이트 비대칭 | `HERDR_WORKSPACE_ID` 단독 환경에서 sink 비활성 또는 caller-less 폴백 명시 테스트 추가 여부를 H1 검증 후 결정 |

## 6. 미해결 리스크

- 실제 `loop run` 재현(새 space 안의 탭 라벨이 `mirror·*`인지 확인)은 유료/실 herdr 호출을 수반해 이번 스코프 밖 — 1순위 원인의 "검증 가능한 예측"으로 대체.
- 재빌드 후에도 증상이 지속된다면 H1(환경 비대칭) 또는 미관측 링크(Lead 세션 자체의 env)로 순위가 재조정된다.
- 워킹트리에 persona 관련 미커밋 변경이 있으나 배치 경로와 무관함을 선행 리서치가 확인했다.
