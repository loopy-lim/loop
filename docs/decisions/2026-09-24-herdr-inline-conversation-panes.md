# Herdr 인라인 대화 팬 — 워커 대화를 현재 space 옆 분할 팬으로 상시 표시

- **Date:** 2026-09-24 (실측 2026-09-25)
- **Status:** superseded (reverted 2026-09-25) — 사용자 결정: 워커는 탭으로, 분할 불요. 폐기 기록은 아래 §폐기 기록.
- **Kind:** decision
- **Supersedes:** `docs/decisions/2026-09-24-herdr-live-conversation-tabs.md` 중 **배치 규칙**(워커당 탭 1개, no split-screen clutter). 동 문서의 메커니즘 절(§2 런치 명령, §3 `agent prompt`, §4 steer, §5 상태 폴링, §6 TTY·미러·헤드리스 존치, §7 식별자)은 **계속 유효(normative)** 하며 본 문서가 인용해 재정의하지 않는다.
  — 이 Supersedes 관계는 아래 폐기 기록과 함께 2026-09-25 부로 효력을 잃었다(배치는 live-conversation-tabs 원래 규칙으로 복원).
- **Amends:** `docs/decisions/2026-09-24-herdr-caller-anchoring.md`(c606722) — 앵커링 계약(`HERDR_PANE_ID` 파싱, `loop-<runId>` 폴백)은 무변경. 표현만 "caller 워크스페이스의 형제 탭"에서 "caller 팬의 분할 팬"으로 바뀐다.
- **Evidence:** herdr 0.8.2 설치본 도움말 직접 실행(`pane split/resize/close/layout/move`, `agent start`) + 격리 워크스페이스 2개(w4Q, w4R)에서 분할·agent start·close·move 실측 후 폐기. 유료 모델 호출 없음(프롬프트 미전송).
- **Read scope:** `packages/herdr/src/**`, 이전 ADR, `docs/design/research/herdr-live-pane-survey.md`
- **Write scope:** 본 문서

## 폐기 기록 (2026-09-25)

본 문서의 배치 규칙(§1 분할 팬 배치, §2 대화 컬럼·최대 가시 2개·탭 강등, §3 팬 정리)은 구현된 후 **사용자 결정으로 폐기·회수(reverted)**되었다: 워커 대화는 각자의 탭으로 배치해야 하며(`tab create --no-focus` — 워커당 탭 1개), Lead 팬 옆 분할은 사용자가 의도한 UX가 아니다. 배치는 `docs/decisions/2026-09-24-herdr-live-conversation-tabs.md`의 원래 규칙으로 복원되었고, 본 문서가 "계속 유효"로 인용하던 메커니즘(`agent start --pane` + `agent prompt`, steer, 상태 폴링, workerName/agentName 식별자)도 그 문서가 다시 1차 소스가 된다. 본 문서는 herdr 0.8.2 분할 표면 실측 근거의 기록으로만 남는다.

## 배경과 요구

이전 ADR(herdr-live-conversation-tabs)은 워커의 실시간 대화 TUI를 여는 메커니즘(`mode="interactive"` + `agent start --pane` + `agent prompt`)을 확정했다. 그러나 그 배치 규칙은 "워커당 탭 1개"였고, 그 결과 워커 대화가 **새 탭으로 사라져** 사용자가 지금 보고 있는 화면 밖에 놓인다. 사용자 결정: 워커 대화 화면은 새 탭/새 공간이 아니라, **지금 사용자가 작업 중인 Lead 워크스페이스의 현재 화면 '옆'에 분할 팬으로 상시 떠 있어야** 한다.

### 실측로 확인한 분할 표면 (herdr 0.8.2)

```console
$ herdr pane split --help
  --direction <right|down>   # 분할 방향은 right/down 2종
  --ratio <FLOAT>            # 첫(기존) 쪽에 배정되는 비율
  --cwd <PATH>  --env K=V    # 새 팬의 cwd/환경
  --focus / --no-focus
# --label 없음 → pane rename 필요
```

격리 워크스페이스 실측 결과:

1. **ratio는 기존(첫) 팬의 점유율이다.** `pane split p1 --direction right --ratio 0.35` → p1 65열 / 새 팬 122열(전체 187). `--ratio 0.6` → p1 112열 / 새 팬 75열. 즉 **워커 팬을 40% 주려면 0.6을 넘긴다.**
2. **분할 팬도 `agent start`를 완전히 수용한다.** 탭 루트가 아닌 분할 팬(w4Q:p2)에서 `agent start loop-decide-pi --kind pi --pane w4Q:p2` → `interactive_ready:true`, `agent_status:idle`, 관리형 이름 등록, `argv:["pi"]`. 이전 ADR의 계약(이름·ready·blocked 보호)이 분할 팬에서 그대로 성립한다.
3. **`pane close`는 실행 중 에이전트 팬도 닫으며 레이아웃이 자가 치유된다.** pi가 떠 있는 p2를 close → `agent list`에서 소실, 하부 분할 노드가 접히며 형제 팬(p3)이 컬럼 전체 높이로 자동 확장.
4. **herdr는 팬 수 상한을 강제하지 않는다.** 우측 컬럼에 5개 적층 성공 — 각 팬이 30/15/7/8행으로 수축될 뿐 거부 없음. **최대 가시 팬 정책은 Loop 몫**이다.
5. **루트 팬 close 시에도 탭은 살아남고** 다른 팬이 승격된다(오복구는 herdr 몫이지만, Loop는 Lead/caller 팬을 절대 close하지 않는 계약으로 간다).
6. **`pane move`로 강등↔승격이 가능하다.** `pane move <PANE> --tab <T> --split right --target-pane <P> --ratio <F> --no-focus` → `changed:true`(t2→t1 재도킹, pane_id·terminal_id 불변). `pane move <PANE> --new-tab`으로 분할 팬을 탭으로 강등. 같은 탭 이동은 `changed:false, reason:"same_tab"` 노옵. 마지막 팬이 빠진 빈 탭은 자동 소멸.
7. `pane resize --amount`는 split ratio에 대한 절대 delta다(0.35 → +0.2 → 0.55 실측).

## 결정

### 1. 배치: caller 팬의 우측 분할 팬 (탭 생성 대체)

워커 시작 경로의 `tab create`를 **`pane split`으로 대체**한다. 배치 부모는 caller 앵커링 결정을 그대로 따른다:

```text
parentPane = caller?.paneId              # HERDR_PANE_ID가 있을 때: Lead의 현재 팬
           ?? workspace.rootPaneId       # 없을 때: loop-<runId> 워크스페이스 루트 팬

pane split <parentPane> --direction right --ratio 0.6 \
    --cwd <worktree> --no-focus          # Lead 60% / 워커 팬 40%
pane rename <newPaneId> <workerLabel>    # label 어휘는 기존 workerLabel 유지
agent start <workerName> --kind pi --pane <newPaneId> [-- <args...>]
agent prompt <workerName> <prompt>       # 이전 ADR §3 그대로
```

- **방향·비율 근거**: right + ratio 0.6(기존 팬 점유 = 실측 1번). Lead 팬은 너비의 60%를 유지하고 워커 대화 컬럼이 나머지 40%를 차지한다. down 우선 분할은 Lead 작업 영역을 세로로 절반으로 잘라 기각한다.
- **`--cwd <worktree>` 필수**: 분할 팬은 부모 팬의 cwd를 물려받으므로(Lead cwd), 워크트리 cwd를 명시해야 한다. `assertWorktreeInsideProject` 검사는 현행 유지.
- **caller 팬 포그라운드 무관**: split은 새 팬(셸)을 만들 뿐 caller 팬의 프로세스를 건드리지 않는다. `agent start`는 새 팬만 목표로 하므로 Lead 팬에서 `agent_pane_busy`가 날 여지가 없다. `#startAgentWithRetry`(250ms×3)는 분할 팬의 동일한 셸 초기화 경쟁을 흡수하기 위해 **그대로 유지**한다.
- **폴백(6)**: caller 없음(HERDR_PANE_ID 부재/오형식) → 기존 `#ensureWorkspace`가 `loop-<runId>` 워크스페이스를 만들고 **그 루트 팬을 똑같이 분할**한다(실측: workspace create가 root_pane 반환, split 성공). 지오메트리 규칙은 부모 팬 상대적이므로 두 경로가 완전히 동일하다.

### 2. 동시 워커 배치: 대화 컬럼 + 최대 가시 2개, 초과는 탭 강등

Lead 팬 오른쪽 40% 컬럼을 "대화 컬럼"으로 쓴다:

| 동시 워커 | 배치 |
|---|---|
| 1번째 | `pane split <parentPane> --right --ratio 0.6` → 컬럼 전체를 워커1 사용 |
| 2번째 | `pane split <worker1Pane> --direction down --ratio 0.5 --no-focus` → 컬럼 내 상하 2분할(각 40%폭 × 50%높이) |
| 3번째 이상(신규) | **탭 강등**: 기존 `tab create --workspace <caller ws> --label <label> --no-focus` + 루트 팬 런치(현행 start 경로 재사용) |

- **최대 가시 워커 팬 = 2**. 근거: herdr는 상한이 없어(실측 4번) Loop가 정책을 가져야 하고, 60행 터미널에서 3적층은 팬당 ~20행으로 대화 TUI 가독 하한을 깬다. 2x2 격자(Lead를 50%×50%로 축소)는 Lead 작업 영역 훼손으로 기각 — Lead는 항상 너비 60% × 전체 높이를 유지한다.
- **상주 팬 이동 없음(no churn)**: 가시 슬롯이 비면(워커 종료) 다음 **신규** 워커가 그 슬롯을 채운다. 실행 중 워커를 강등/승격 이동시키지 않는다. `pane move`는 실측으로 가능함을 확인했으나(위 표면 6번) 본 결정의 범위 밖(non-goal)이며, 승격 UX 수요가 생기면 별도 결정으로 열린다.
- **강등은 신규 워커 한정**: 3번째 워커는 탭으로 태어난다. 실행 중 팬의 `pane move --new-tab` 강등은 에이전트 생존이 미실측(pane_id/terminal_id 불변은 확인)이라 쓰지 않는다.
- 팬/탭 수 판정은 `pane layout --pane <parentPane>`의 탭별 팬 목록(실측 8번)으로 한다. 최대치 2는 herdr 어댑터 상수로 고정한다(터미널 크기 의존 상한은 후속 과제).

### 3. 워커 종료 시 팬 정리

- **가시 워커 종료** → `pane close <paneId>`. 실측 3번: 실행 중 에이전트 팬도 닫히고 레이아웃이 자가 치유된다. 컬럼의 마지막 워커 팬이 닫히면 분할 노드가 접히며 Lead 팬이 100%로 회복한다(형제 확장 실측의 자연 귀결 — 구현 태스크가 fake runner 기대열로 단언).
- **강등 탭 워커 종료** → `tab close <tabId>`(현행 `closePane` 경로).
- 정리 시점은 현행 계약 유지: cancel(`agent send-keys ctrl+c`) → 종료 관찰 → close. run 종료 시 미종료 워커 일괄 정리는 기존 `closeWorkspace`가 담당하되, **트래킹이 tabId뿐 아니라 분할 팬 paneId도 포함**하도록 확장한다(가시 워커는 탭을 만들지 않으므로).
- Lead/caller 팬과 loop-<runId> 루트 팬은 **절대 close 대상이 아니다**.

### 4. 이전 규칙과의 대체 관계

- **이전 ADR(herdr-live-conversation-tabs)의 "워커당 탭 1개, no split-screen clutter" 배치 규칙은 폐기**되고 본 문서의 분할 팬 규칙으로 대체된다. 메커니즘 절은 계속 유효하다(문서 상단 Supersedes 참조).
- **c606722(caller-anchoring)는 계약 무변경**: `HERDR_PANE_ID` 파싱과 `loop-<runId>` 폴백은 그대로이며, 고정 대상의 표현만 "같은 워크스페이스의 형제 탭"에서 "caller 팬의 분할 팬(및 초과 시 같은 워크스페이스의 탭)"으로 바뀐다.
- **범위 주의(이행 필요)**: 본 태스크의 write scope는 신규 문서로 한정되어 이전 ADR의 Status 행을 직접 고치지 못했다. 구현 태스크에서 이전 ADR 헤더를 다음으로 갱신할 것: `Status: superseded (placement만 — 메커니즘 절은 herdr-inline-conversation-panes ADR이 계속 채택)`.

### 5. focus 비강탈 유지

`pane split --no-focus`(실측 플래그)와 강등 `tab create --no-focus`를 항상 사용한다. `agent focus`/`tab focus`/`workspace focus`는 Loop가 호출하지 않는다. Lead의 키보드 포커스는 어떤 워커 이벤트로도 이동하지 않는다.

### 6. 관리형 인터랙티브 모드 전제 (무변경)

- `providers.toml`의 `mode="interactive"`(pi/codex/agy → `HerdrAgentProvider`)가 본 배치의 전제다. 헤드리스 모드(process/exec/persistent) 워커는 팬을 만들지 않으며 미러 팬+steer 릴레이 표면이 그대로 존치한다(이전 ADR §6).
- `agent start`/`agent prompt`, workerName(`loop-<taskId>`)/agentName 식별자, `interactive_ready` 확인, `agent_blocked` 보호, `agent get` 폴링+`pane get` 폴백, 런치 args(pi `-- --model <id>` 등), `--tui-mode fullscreen` 금지 — **전부 이전 ADR 결정을 인용해 그대로 유지**한다. 본 문서는 배치만 바꾼다.
- steer(orchestrator steerRun)도 `agent prompt` 전달로 무변경이다. 분할 팬에서 사용자가 직접 타이핑하는 것은 TUI 네이티브 동작이다(팬이 PTY를 소유).

## 대안 및 기각 이유

| 대안 | 기각 이유 |
|---|---|
| 2x2 격자(Lead 포함 4분할) | Lead 팬이 50%×50%로 축소 — 사용자의 활성 작업 영역 훼손. 대화 컬럼(Lead 60%×100%)이 동일 정보를 Lead 옆에 유지 |
| 가시 팬 3+ 적층 | herdr는 허용하지만(실측) 60행 기준 팬당 ~20행 — 대화 TUI 가독 하한 붕괴. 상한 정책은 Loop 몫임이 실측으로 확인된 이상 2가 합리적 기본값 |
| 3번째 워커를 `pane move --new-tab`으로 강등 | 실행 중 에이전트의 이동 생존이 미실측. 신규 워커의 `tab create` 직접 강등은 현행 검증 경로 |
| 가시 슬롯 공백 시 즉시 승격(`pane move --tab … --split`) | 실측으로 가능하나 상주 이동 churn와 경쟁 상태 추가. non-goal로 유예, 별도 결정에서 재검토 |
| down 우선 분할 / Lead 팬 하부 분할 | Lead 편집 영역을 세로로 절단. right 고정이 요구("옆에")와 직결 |
| 기존대로 탭 1개 유지 + 사용자가 수동 split | 사용자 조작이 상시 워크플로에 개입됨 — "옆에 계속 떠 있음" 요구를 Loop가 자동 보장해야 함 |

## 수정 대상 파일 (구현 태스크 범위)

- `packages/herdr/src/client.ts`: `start()`의 `tab create` → `pane split`(+`pane rename`) 치환, 컬럼 용량 판정(`pane layout`), 신규 워커 탭 강등 분기, `#workspaces` 트래킹에 paneId 추가, `closePane`/`closeWorkspace`의 pane close 경로. `#launch`·`#startAgentWithRetry`·식별자 로직 유지.
- `packages/herdr/test/**`: fake runner 기대열을 `tab create` → `pane split --direction right --ratio 0.6 --cwd … --no-focus` 열로 갱신, 용량 초과 강등/정리 회귀 추가.
- `docs/decisions/2026-09-24-herdr-live-conversation-tabs.md`: Status 행 superseded 표기(위 4절).
- `packages/orchestrator/src/**`, Rust, 생성 프로토콜: 변경 없음(composition의 interactive 미러 excluded 유지).

## 테스트 전략 (유료 모델 호출·실제 에이전트 프로세스 불요)

기존처럼 `HerdrRunner` fake 주입으로 검증한다:

1. **배치**: 첫 워커 → `pane split <callerPane> --direction right --ratio 0.6 --cwd <worktree> --no-focus` + `pane rename` + `agent start --pane <splitPane>`; caller 없음 → 루트 팬 대상 동일 열.
2. **용량**: 2번째 워커 → `pane split <worker1Pane> --direction down --ratio 0.5`; 3번째 → `tab create --no-focus` 강등 경로.
3. **정리**: 가시 워커 종료 → `pane close`, 강등 워커 종료 → `tab close`, run 종료 → 미종료 pane+tab 일괄 close, Lead/루트 팬 close 부재 단언.
4. **focus**: 어떤 경로에도 `--focus`/`focus` 서브커맨드 호출 부재.
5. 레이아웃 지오메트리 자체(열 너비, 자가 치유)는 herdr 소관이므로 단위 테스트에서 재단언하지 않는다 — 실측 증거로 대체.

## 결과 요약 (구현 태스크 전달)

- **분할 방식**: 배치 부모 = `caller.paneId`(없으면 `loop-<runId>` 루트 팬). `pane split <parent> --direction right --ratio 0.6 --cwd <worktree> --no-focus` → Lead 60% / 워커 40%. **ratio는 기존 팬 점유율**(실측)이므로 0.6을 넘겨야 워커가 40%를 받는다. `pane rename`으로 라벨, `--cwd` 필수.
- **배치/최대 가시**: 대화 컬럼 내 워커 팬 최대 **2개**(1번째 right 분할, 2번째 워커1 팬 down 0.5 분할). 3번째 이상 신규 워커는 같은 워크스페이스에 `tab create --no-focus` 강등. 상주 팬 이동/승격 없음(`pane move`는 실측된 향후 표면, non-goal).
- **정리 규칙**: 가시 워커 종료 → `pane close`(자가 치유 실측), 강등 탭 워커 종료 → `tab close`, run 종료 시 paneId+tabId 트래킹 일괄 close, Lead/루트 팬은 절대 close 금지.
- **유지 계약**: `mode="interactive"` 전제, `agent start`/`agent prompt`, workerName/agentName, `#startAgentWithRetry`, `interactive_ready`/`agent_blocked`, `agent get` 폴링+`pane get` 폴백, steer= `agent prompt`, `--no-focus` 비강탈, 미러+릴레이는 헤드리스 전용 존치.
- **대체 관계**: 이전 ADR의 탭 배치 규칙만 폐기(메커니즘 절은 normative 유지), c606722 앵커링 계약 무변경. 이전 ADR Status 갱신은 구현 태스크 몫(본 태스크 write scope 밖).

## 리스크

- **협소 터미널**: 너비가 좁으면 40% 워커 팬이 TUI 가독 하한 아래로 수축한다(herdr 하한 미관측). `pane resize`(delta 실측)가 수동 구제 표면 — 자동 반응형 비율은 후속 과제.
- **마지막 팬 close 후 Lead 100% 회복**: 형제 확장 실측의 귀결로 판단했으나 컬럼 전체 소멸 케이스는 미직접 실측. 구현 테스트가 fake 기대열로 계약을 고정한다.
- **이전 ADR status 미갱신**: write scope 제약으로 미수행 — 구현 태스크 첫 커밋에 포함 필요(미루면 두 ADR이 충돌하는 배치를 가리킴).
- **강등 탭과 가시 슬롯의 공정성**: 슬롯이 비어도 상주 강등 워커는 자동 승격되지 않는다(no churn 원칙). 장수 워커가 계속 탭에 머무는 UX 비용은 사용자 검증 후 승격 결정(pane move)으로 재검토.
- **`pane layout` 폴링 비용**: 용량 판정을 위한 layout 호출이 워커 시작마다 1회 추가된다(15초 타임아웃 러너 기준 경미). 캐시로 최적화하지 않는다(단순성 우선).
