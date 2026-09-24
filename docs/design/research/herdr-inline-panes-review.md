# Herdr 인라인 대화 팬 구현 검증 결과

- **Date:** 2026-09-25
- **Kind:** verification report (task `verify-inline-panes`)
- **Verdict:** **PASS** — 코드 동작 기준 5개 검증 축 전부 ADR 일치. 단, 문서 불일치 1건(이전 ADR Status 미갱신)과 저위험 관찰 2건이 후속 조치로 남는다(아래 문제 목록).
- **Verified ADR:** `docs/decisions/2026-09-24-herdr-inline-conversation-panes.md`
- **Read scope:** 위 ADR, `packages/herdr/**`, `tests/**` (provider/orchestrator/presentation 변경분은 경계 참고만)
- **Write scope:** 본 문서 (코드 수정 없음)

## 검증 방법

`packages/herdr/src/client.ts`(976행)·`worker.ts` 전체 정독, `packages/herdr/test/**`(특히 `lifecycle.test.ts` 1303행) 대조, 전체 검증 3종 실행. 실제 herdr + 에이전트 라이브 실측은 유료 모델 호출 가능성이 있어 **본 태스크에서 실행하지 않음 — 별도 실측 필요**.

## 축별 결과

### 1. 분할 팬 배치 — 일치 ✅

- 배치 부모 = `input.caller ?? #ensureWorkspace(input)`(`client.ts:184`) — caller 팬(`HERDR_PANE_ID` 파싱, `client.ts:21-31`) 우선, 없으면 `loop-<runId>` 루트 팬. ADR §1 의사코드와 동일.
- 1번째 워커: `pane split <anchor> --direction right --ratio 0.6 --cwd <worktree> --no-focus`(`client.ts:706-716`, 상수 `ANCHOR_SPLIT_RATIO="0.6"` `client.ts:87`). ratio가 기존 팬 점유율이라는 실측 규칙을 그대로 반영(Lead 60% / 워커 40%).
- 2번째 워커: `pane split <worker1Pane> --direction down --ratio 0.5 --no-focus`(`COLUMN_SPLIT_RATIO="0.5"` `client.ts:89`) — 대화 컬럼 내 상하 분할.
- `pane rename <paneId> <label>` 후위 적용(`client.ts:188`), `--cwd <worktree>` 항상 명시(분할 팬 cwd 상속 대비), `assertWorktreeInsideProject` 유지(`client.ts:132`).
- `agent start <workerName> --kind <kind> --pane <splitPane>` + `agent prompt`(`#launch` `client.ts:595-630`), `#startAgentWithRetry`(250ms×3, `client.ts:577-593`) 유지 — 이전 ADR 메커니즘 절(normative) 존치.
- `tab create`는 강등 분기에서만 호출됨. 일반 경로에 탭 생성 없음.
- 테스트: 첫/두 번째 분할 정확 argv 단언(`lifecycle.test.ts:34-45, 162-172, 1148-1156`), caller 없음 경로(`:235-237`).

### 2. 최대 가시 팬 규칙 — 일치 ✅

- `MAX_VISIBLE_WORKER_PANES = 2` 어댑터 상수 고정(`client.ts:82`) — ADR "최대치 2는 herdr 어댑터 상수" 그대로.
- 용량 판정: `pane layout --pane <parentPane>`의 탭별 팬 목록으로 상주 열 정화(`#pruneColumn` `client.ts:748-759`), 배치당 정확히 1회 레이아웃 호출. 사용자가 닫은 팬은 관측에서 탈락해 슬롯이 재계산됨.
- 3번째 이상 신규 워커: `tab create --workspace <ws> --cwd <worktree> --label <label> --no-focus` 강등(`client.ts:718-730`). 테스트 `lifecycle.test.ts:1137-1181`.
- 상주 팬 이동 없음: `client.ts` 전체에 `pane move` 호출 부재(검증 grep). 슬롯 공백 시 다음 **신규** 워커가 down 분할로 채움(`lifecycle.test.ts:1200-1217`) — no-churn 원칙 일치.

### 3. 종료 정리 — 일치 ✅

- 가시 워커 종료 → `pane close <paneId>`(`cleanup` `client.ts:417-437`, `#isColumnPane` 판별), 강등 탭 워커 → `tab close <tabId>`. 정리 시점 계약(cancel ctrl+c → 종료 관찰 → close) 유지.
- 런 종료 일괄 정리: caller-anchored 런은 `#sweepRunSurfaces`(`client.ts:496-516`)로 트래킹된 `paneIds`+`tabIds`만 닫고 워크스페이스·탭·앵커 팬은 미접촉 — `WorkspaceRef`에 `paneIds` 확장(ADR §3 "트래킹이 tabId뿐 아니라 paneId도 포함") 이행. owned(`loop-<runId>`) 런은 기존 `workspace close` 전체 철수 유지.
- Lead/루트 팬 close 부재 단언: `not.toContainEqual(["pane","close","w1:p1"])`(`lifecycle.test.ts:1215-1216`), `w7:p4`(`:1202`), 루트 탭 `w1:t1`(`:1179`).
- 분할 배치의 `tabId = paneId`(팬 자신의 id, `worker.ts:38-45`) → 구형 tab close 경로가 caller 호스팅 탭을 파괴할 수 없음. 런치 실패 롤백도 분할/탭에 맞게 `#releasePlacement`(`client.ts:762-770`).

### 4. 식별자 불변 — 일치 ✅

- `workerName` = `loop-<taskId>`(32자 초과 해시 절단 포함, `client.ts:800-811`), `agentName = workerId`, 라벨 어휘 `<taskId>·<kind>·a<attempt>`는 rename 표면 한정(`client.ts:139-146`) — identity/display 분리 불변. 테스트 `lifecycle.test.ts:48-66`.
- `agent start/prompt/send-keys/get/read`, `pane get` 폴백, `interactive_ready` 런치 가드(`client.ts:612-620`)·상태 failed 매핑(`:300-307`), `agent_blocked` 전파 — 전부 기존 계약 유지.
- `herdrCallerFromEnvironment`(c606722 계약) 무변경.

### 5. fake runner 기반 테스트만 사용 + focus 비강탈 — 일치 ✅

- `packages/herdr/test/**` 전체가 `HerdrRunner` fake 주입. `NodeHerdrRunner` 인스턴스화·herdr 바이너리 스폰 테스트 부재(검증 grep). 신규 `packages/providers/test/herdr-agent-live.test.ts`도 파일 헤더 명시대로 fake runner 전용("no herdr binary, no agent process, no paid model call").
- focus: `--no-focus`만 사용(split/tab create/workspace create), `--focus` 플래그와 `focus` 서브커맨드는 `client.ts` 전체 부재(검증 grep). 부재 단언 `lifecycle.test.ts:1168-1169`.

## 실행한 검증 (cwd=/Users/loopy/dev/ll3/loop)

| 명령 | 결과 |
|---|---|
| `bun run check` | **337 pass / 0 fail** (42 files, 1369 expect) |
| `bun test packages` | **319 pass / 0 fail** (37 files) |
| `bun run test:architecture` | **6 pass / 0 fail** (계층 경계·interactive Lead 미소유 계약 포함) |
| `bun run codegen:check` (추가) | exit 0 — 생성 프로토콜 드리프트 없음 |

**별도 실측 필요(미실행):** 실제 herdr 0.8.2 + pi/codex 에이전트가 뜬 상태에서의 분할 지오메트리(Lead 60% 회복 포함), `interactive_ready` 실제 TUI 렌더, 사용자 직접 close 후 layout 정화 — 유료 모델 호출 가능성으로 본 태스크 범위 밖. ADR도 레이아웃 지오메트리를 herdr 소관으로 보고 fake 기대열로 계약만 고정하는 전략(테스트 전략 5번)이므로 단위 검증 축과 충돌하지 않는다.

## 결과 요약

- **PASS/FAIL: PASS** (코드 동작 기준, 5개 검증 축 전부 일치).
- **문제 목록:**
  1. `docs/decisions/2026-09-24-herdr-live-conversation-tabs.md:4` — Status 행이 여전히 `decided`. 인라인 ADR §4가 구현 태스크 몫으로 명시한 `superseded (placement만 — 메커니즘 절은 herdr-inline-conversation-panes ADR이 계속 채택)` 표기가 반영되지 않아, 두 ADR이 상쇄 마커 없이 상충하는 배치 규칙을 가리키는 상태. **문서 1행 수정 후속 커밋 필요.** (코드 동작과 무관, 본 태스크 write scope 밖)
  2. `packages/herdr/src/client.ts:772-778` — `cleanup`의 분할/탭 판별이 프로세스 메모리(`#columns`) 의존. Loop 재시작 후 재부착된 분할 팬 핸들은 `#isColumnPane`이 false가 되어 `tab close <paneId>` → `tab_not_found`로 "이미 정리됨" 처리되어 팬이 남을 수 있다. 현재 `attach()`의 프로덕션 호출부가 없어 미발동이며, 재시작 간 추적 공백은 변경 전 탭 트래킹과 동일한 기존 한계. 저위험 관찰 — 재부착 경로가 생기면 배치 모드를 핸들에 영속 기록해야 함.
  3. `packages/herdr/src/client.ts:216-246` — 미러 팬(`createPane`)이 대화 컬럼의 2슬롯 예산을 워커 대화 팬과 공유. 헤드리스 미러 1 + 인터랙티브 워커 2가 경쟁해 3번째 표면이 탭 강등된다. "caller 팬의 분할 팬" 표현의 방어 가능한 해석이지만 ADR이 이 상호작용을 명시하지 않았다 — 관찰 사항, 코드 변경 불요.

## 미해결 리스크

- 협소 터미널에서 40% 워커 팬 수축(ADR 리스크 인용) — `pane resize` 수동 구제, 자동 반응형은 후속 과제.
- 위 문제 2번의 재시작 시나리오가 실제로 열리면(재부착 도입) 정리 유출로 확대될 수 있음.
- 실기 라이브 실측 미수행 — 위 "별도 실측 필요" 항목을 첫 실제 워커 기동 전에 소화할 것.
