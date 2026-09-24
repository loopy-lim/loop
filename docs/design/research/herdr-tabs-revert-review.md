# Herdr 탭 배치 복원(revert) 검증 결과

- **Date:** 2026-09-25
- **Kind:** verification report (task `verify-revert`)
- **Verdict:** **PASS** — 요구된 5개 검증 축(탭 생성, 탭 안 인터랙티브 TUI, 분할/ratio 잔여물 없음, 식별자 불변, ADR 상태 정리) 전부 일치. 차단 문제 0건, 저위험 관찰 3건(아래 문제 목록).
- **Verified intent:** 런 loop-8fd4f58e(inline-conversation-panes ADR)의 분할 팬 배치를 `2026-09-24-herdr-live-conversation-tabs.md`의 원래 배치 규칙(워커당 `tab create --no-focus` 1개, 분할 없음)으로 되돌린 변경의 정확성. M1 인터랙티브 메커니즘(`agent start --pane` + `agent prompt`, `providers.toml mode="interactive"`)과 workerName/agentName 식별자는 무변경이어야 한다.
- **Read scope:** `docs/decisions/**`, `packages/herdr/**`, `tests/**` (provider/orchestrator/presentation 변경분은 경계 참고·회귀 확인만)
- **Write scope:** 본 문서 (코드 수정 없음)

## 검증 방법

- `packages/herdr/src/client.ts`(843행)·`worker.ts`(43행) 전체 정독 및 `git diff`(작업 트리 vs HEAD 9e8d094) 대조.
- `packages/herdr/test/**` 특히 `lifecycle.test.ts`(1206행) 기대열 대조, 저장소 전체 `pane split|ratio|pane move|pane resize|pane layout|pane close` grep.
- 전체 검증 3종 + 완료 조건 결합 명령 실행. 실제 herdr + pi/codex/agy 라이브 TUI 실측은 유료 모델 호출 가능성이 있어 **본 태스크에서 실행하지 않음 — 별도 수동 실측 대상**(의존성 결과와 동일).

## 축별 결과

### 1. 워커당 새 탭 생성 — 일치 ✅

- `start()`는 배치 부모(`input.caller ?? #ensureWorkspace`)의 워크스페이스에 워커마다 `tab create --workspace <ws> --cwd <worktree> --label <label> --no-focus`를 만들고(`client.ts:156-170`) `pane rename`으로 라벨만 부여한다(`client.ts:173`). 분할(pane split) 호출 경로는 존재하지 않는다.
- 용량 한도·강등·컬럼 개념 부재 — 이전 분할 구현의 `MAX_VISIBLE_WORKER_PANES`, `ANCHOR_SPLIT_RATIO`, `#columns`, `#isColumnPane`, `#pruneColumn`, `#releasePlacement`은 모두 제거됨(현 843행 vs 분할 구현 976행). 3번째 워커도 동일하게 탭으로 태어난다.
- 미러 표면(`createPane`)도 같은 규칙의 자체 no-focus 탭이다(`client.ts:203-228`).
- 테스트: 워커 3개 모두 개별 탭 생성 단언 + `pane split`/`pane layout`/`--focus` 부재 단언(`lifecycle.test.ts:1078-1124`), 전체 argv 기대열(`lifecycle.test.ts:5-46`), caller 앵커링(`lifecycle.test.ts:135-164`), caller 없음 폴백(`lifecycle.test.ts:201-222`).

### 2. 탭 안 `agent start --pane` 인터랙티브 TUI (M1) — 일치 ✅

- `#launch`는 `agent start <workerId> --kind pi|codex|agy --pane <paneId> [-- <args...>]` + `agent prompt <workerId> <prompt>` 구조를 그대로 유지한다(`client.ts:561-596`). `#startAgentWithRetry`(250ms×3 `agent_pane_busy` 백오프) 존치(`client.ts:544-558`).
- 런치 시 `interactive_ready: false` 명시 응답 → `agent_not_interactive` 실패(`client.ts:584-588`), 상태 폴링에서도 interactive_ready 상실 → `failed`(`client.ts:284-291`) — ADR §6 건강 신호 계약 유지.
- steer는 `agent prompt` 단일 표면(`client.ts:353-360`), `send-keys`는 cancel `ctrl+c` 전용(`client.ts:374-380`), `agent get` 폴링 + already-gone 시 `pane get`/`pane read` 폴백(`client.ts:263-343`) — ADR §4·§5 그대로.
- 설정 예시에 interactive 모드 유지: `config/providers.example.toml:38`(`[providers.pi] mode="interactive"`).
- provider 계층 회귀: pi/codex/agy 종류별 argv로 라이브 대화 TUI 런치, steer 1회 `agent prompt`, agent 소실 폴백, interactive_ready 상실 — `packages/providers/test/herdr-agent-live.test.ts`(fake runner 전용, 유료 호출 없음) 전부 통과.
- 실기 라이브 실측(실제 TUI 렌더)은 수동 대상으로 분리 — 단위 검증 축과 충돌 없음(양 ADR 공통 테스트 전략 5번).

### 3. 분할/ratio 로직 잔여물 없음 — 일치 ✅

- `packages/herdr/src`에 `pane split`, `pane resize`, `pane move`, `pane layout`, `pane close`, `--ratio`, `--direction` 호출이 존재하지 않는다(저장소 전체 grep — 유일 매치는 "integration"이라는 단어의 `ratio` 부분 일치와 테스트 코멘트뿐).
- 정리 경로도 탭 기준으로 복원: 워커 cleanup = `tab close <handle.tabId>`(`client.ts:400-414`), 런치 실패 롤백 = 워커 탭 1개만 close(`client.ts:184-192`), caller-anchored 런 종료 sweep = 이번 런이 만든 워커 탭만 `tab close`(`#sweepRunSurfaces` `client.ts:471-481`). `pane close`는 owned 워크스페이스 철수 폴백의 루트 팬 경로(`client.ts:519-524`)에만 남고 워커 배치와 무관 — live-tabs ADR Note의 "Lead/caller 팬·워크스페이스 보호"와 일치.
- 회귀 고정: "opens one no-focus tab per worker and never splits the anchor pane"(`lifecycle.test.ts:1078`), caller 워크스페이스·앵커 탭 무접촉 단언(`lifecycle.test.ts:1126-1196`), `pane close` 부재 단언(`providers/test/adapters-v2.test.ts:526`, `providers/test/mirror.test.ts:513`).

### 4. 식별자 불변 — 일치 ✅

- `workerName` = `loop-<taskId>`(32자 초과 시 해시 절단, `client.ts:680-690`), agent 실행의 `agentName = workerId`(`client.ts:182`), 표시 라벨 `<taskId>·<kind>·a<attempt>`는 tab create/rename 표면 한정(`client.ts:152-155`, `client.ts:693-726`, `worker.ts:12-16` identity/display 분리 주석).
- `herdrCallerFromEnvironment`(c606722 계약) 무변경(`client.ts:20-31`, `caller.test.ts`).
- 테스트: 식별자-라벨 분리(`lifecycle.test.ts:48-72`), 32자 한계(`lifecycle.test.ts:224-249`).

### 5. ADR 상태 정리 완료 — 일치 ✅

- `docs/decisions/2026-09-24-herdr-live-conversation-tabs.md:4` — Status `decided (배치 규칙 재확정 2026-09-25)` + `:6` Note에 회수 경위·복원 규칙·leftover 정리 범위 명시.
- `docs/decisions/2026-09-24-herdr-inline-conversation-panes.md:4` — Status `superseded (reverted 2026-09-25)` + §폐기 기록으로 배치 규칙 폐기·메커니즘 절의 1차 소스 환원 명시.
- 이전 리뷰(`herdr-inline-panes-review.md`)의 문제 1번(live-tabs ADR Status 미갱신)이 해소됨. 두 ADR이 더 이상 상충하는 배치를 가리키지 않는다. caller-anchoring ADR도 "형제 탭" 배치로 정합.

## 실행한 검증 (cwd=/Users/loopy/dev/ll3/loop)

| 명령 | 결과 |
|---|---|
| `bun run check` | **337 pass / 0 fail** (42 files, 1365 expect — codegen:check·typecheck·test:architecture 포함) |
| `bun test packages` | **319 pass / 0 fail** (37 files, 1173 expect) |
| `bun run test:architecture` | **6 pass / 0 fail** (계층 경계·interactive Lead 미소유 계약 포함) |
| 완료 조건 결합 명령 `bun run check && bun test packages && bun run test:architecture` | **exit 0** |

유료 모델 호출 0회. 모든 테스트는 `HerdrRunner` fake 주입 기반.

## 결과 요약

- **PASS/FAIL: PASS** (요구 5개 검증 축 전부 일치, 차단 문제 0건).
- **문제 목록 (차단 아님, 관찰):**
  1. `docs/decisions/2026-09-24-herdr-caller-anchoring.md:16` — "caller-anchored 실행은 `#workspaces`에 runId 엔트리를 만들지 않는다… Loop 워크스페이스가 존재할 때만 runId별로 추적" 문장이 현재 코드(`#ensureRunRef`가 모든 런에 owned:false sweep-only 기록 생성, `client.ts:174`, `client.ts:227`, `client.ts:641-652`)와 어긋난다. 신규 동작은 live-tabs ADR Note(`2026-09-24-herdr-live-conversation-tabs.md:6`)가 규정하므로 규범 충돌은 아니지만, 커밋 시 해당 문장에 폐기·대체 표기를 한 줄 남기는 것이 안전하다. (문서 정리, 코드 불요)
  2. `docs/decisions/2026-09-24-herdr-inline-conversation-panes.md:90` — 폐기된 문서 본문에 "이전 ADR 헤더를 `superseded (placement만…)`로 갱신할 것"이라는 미이행 지시가 역사적 텍스트로 남는다. 실제 해소 형태(본 문서 superseded/reverted + live-tabs 재확정 Note)가 더 정확하므로 조치 불요, 다만 읽는 사람이 혼동하지 않도록 커밋 메시지나 후속 문서 정리에서 언급 권장.
  3. 복원 변경 전체가 아직 **커밋되지 않은 작업 트리 상태**다(`git status`: packages/herdr, providers, orchestrator, presentation, docs 등 다수 수정·신규). 검증은 현재 작업 트리 기준이며, 커밋 분할 시 herdr 코드+테스트+두 ADR+본 리뷰가 한 묶음을 이루도록 권장.

- **변경 파일:** 본 문서 1개뿐 (선언된 write scope 준수, 코드 수정 없음).
- **실행한 검증:** 위 표 4건.
- **미해결 리스크:**
  - 실기 라이브 실측 미수행 — 실제 herdr 0.8.2 + pi/codex/agy가 뜬 상태에서 워커 탭 안 대화 TUI 렌더, 사용자 직접 타이핑, 런 종료 후 워커 탭 정리(Lead 워크스페이스 보호 포함)는 첫 실제 워커 기동 전 수동 확인 필요. 단위 테스트는 fake runner 계약만 고정한다(의존성 결과가 지적한 것과 동일).
  - 문제 1번의 문서 표기를 고치지 않은 채 방치하면 다음 감사에서 caller-anchoring ADR과 코드가 다시 상충하는 것으로 읽힐 수 있다(저위험).
