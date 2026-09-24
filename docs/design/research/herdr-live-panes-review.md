# herdr 라이브 대화 탭 구현 검토 (verify-live-panes)

- **Date:** 2026-09-25
- **Kind:** verification report
- **대상 ADR:** `docs/decisions/2026-09-24-herdr-live-conversation-tabs.md` (status: decided)
- **검증 방법:** ADR 각 절을 구현 코드와 fake-runner 테스트에 대조(정적 검토) + 전체 검증 명령 실행. 실제 herdr/pi/codex/agy 프로세스 구동·유료 모델 호출 없음(AGENTS.md 규칙 준수).
- **판정 기준:** 코드 수정 없음. 일치 여부만 기록.

## 결과 요약

**종합 판정: PASS — 단, FAIL 1건(steer 런타임 배선 미구현)을 후속 태스크로 남긴다.**

탭에 실제 대화 TUI를 띄우는 핵심 런치 경로(ADR §1·§2·§3), 식별자 불변(§7), TTY 건강 신호(§6), 상태 폴백(§5), fake-runner 테스트 전략은 모두 ADR과 일치하고 전체 검증이 녹색이다. ADR §4의 steer 1차 전달 경로는 표면(provider `steer?` → `agent prompt`)까지는 구현·테스트됐으나, steerRun을 라이브 워커의 `provider.steer`로 이어주는 호출부가 없어 런타임에 도달하지 않는다(문제 1).

### 문제 목록

| # | 판정 | 내용 | 위치 |
|---|---|---|---|
| 1 | **FAIL** | `loop steer`(steerRun)가 라이브 interactive 워커에게 실시간 전달되지 않는다. `steer_run`은 GuidanceAdded 기록만 하고, 오케스트레이터 실행 루프는 `provider.steer`를 호출하지 않으며, guidance는 다음 시도의 프롬프트에만 반영된다. ADR §4의 1차 경로(`herdr agent prompt`)가 런타임에 연결되지 않음 — 표면과 폴백 계약(기록 유지)은 구현·테스트 완료 | crates/loop-bridge/src/execution.rs:192, packages/orchestrator/src/task-execution.ts:59-80, packages/providers/src/prompt.ts:31 |
| 2 | 관찰(무해) | ADR §7 표기 `loop-<taskId>` vs 실제 규칙 `loop-<sanitized(runId-taskId)>`. 본 변경 이전의 선행 규칙이며 이번 구현이 바꾼 것이 아니므로 식별자 불변 위반 아님. ADR 문서 표기만 후속 정정 후보 | packages/providers/src/herdr-agent.ts:88, packages/herdr/src/client.ts:715 |
| 3 | 범위 외 | 작업 트리에 watch-columns 작업의 변경(packages/presentation/**, packages/cli/src/main.ts:188-193, 536-543)이 혼재한다. 본 검토 대상(read scope) 외부이므로 판정에서 제외 | — |

## ADR 절별 검증 매트릭스

| ADR 절 | 요구 | 구현 증거 | 테스트 증거 | 판정 |
|---|---|---|---|---|
| §1 M1 채택 | `agent start <workerId> --kind --pane` + `agent prompt` 구조 유지, `agent_pane_busy` 재시도 유지 | packages/herdr/src/client.ts:522-537(`#launch`), 505-519(`#startAgentWithRetry`, 3회·250×n 백오프) | packages/herdr/test/lifecycle.test.ts:750(busy 재시도 후 prompt) | PASS |
| §2 에이전트별 런치 | 종류별 차이는 `--` 뒤 args뿐, 런치 코드 분기 없음, fullscreen 금지 | packages/orchestrator/src/composition.ts:202-214(`visibleAgent`: codex `--sandbox workspace-write --model`, agy `--sandbox --model`, pi `--model`), client.ts:530-537(단일 경로에 `--` args 부착). 저장소 전체에서 `fullscreen`/`tui-mode` 플래그 부재 확인 | packages/providers/test/herdr-agent-live.test.ts:88-110(3종 argv 고정) | PASS |
| §3 초기 프롬프트 | ready 후 `agent prompt` 1회, 런치 인자 기각 유지 | client.ts:549-552(빈 프롬프트 스킵 가드 포함), argv 한 원소 전달(spawn shell:false) | lifecycle.test.ts:5-55, herdr-agent-live.test.ts:110 | PASS |
| §4 steer 전달 | `agent prompt` 표면, send-keys는 ctrl+c 전용, `agent_blocked` 시 기록 폴백, interactive 미러 제외 | client.ts:338-344(runtime.steer), 363-365(ctrl+c 전용), packages/providers/src/herdr-agent.ts:167-173, packages/providers/src/types.ts:97(`steer?`), packages/providers/src/mirror.ts:468-473(전달), composition.ts:189(interactive `excluded`) | herdr-agent-live.test.ts:116, 132(종료 후 거부), 157(blocked 전파), 314(MirroringProvider 경유), lifecycle.test.ts:945-993, packages/providers/test/mirror.test.ts:333(제외) | 표면 PASS / **배선 FAIL(문제 1)** |
| §5 상태 폴백 | already-gone → `pane get` → `exited`→`completed`, 탭 소실 시 종료 확정, 요약은 `agent read` | client.ts:251-287(status 폴백), 283-302(`#paneStatus`), 304-332(read 폴백, 이중 소실 시 빈 스냅샷) | lifecycle.test.ts:827-876, 912-940, herdr-agent-live.test.ts:178-260 | PASS |
| §6 TTY 건강 신호 | `interactive_ready` 명시 `false`만 실패, 부재는 관용, exit code/stdout 판정 금지 | client.ts:268-273(status), 539-548(런치 게이트, `agent_not_interactive`), 703-711(`optionalBoolean` — 부재는 undefined) | lifecycle.test.ts:792(런치 실패), 881(실패), 892(부재 관용), herdr-agent-live.test.ts:268(retryable loss) | PASS |
| §7 식별자 불변 | workerName 규칙·agentName·라벨·caller 앵커링 무변경 | client.ts:715-721(workerName, 미변경), 98-100(agentName=workerId), 727-748(workerLabel, 미변경), herdr-agent.ts:87-90(caller 앵커링, 미변경) | lifecycle.test.ts:57, 216, labels.test.ts 전체(미변경) | PASS |
| 테스트 전략 | fake runner만, 실제 프로세스·유료 호출 불요 | herdr-agent-live.test.ts 전체가 fake `HerdrRunner` 주입. 테스트 내 `herdr`/`pi`/`codex`/`agy` 바이너리 스폰 부재(`process.execPath` 사용은 기존 러너 데드라인 인프라 테스트뿐) | bun test 전체 0 fail | PASS |

`interactive_ready` 부재 관용(구버전 herdr 호환)은 구현 태스크가 보고한 대로 동작한다. `optionalBoolean`은 부재를 `undefined`로 두고 `=== false`만 실패로 판정하며, 런치(client.ts:545)와 폴링(client.ts:271) 양쪽에 동일하게 적용된다. ADR §6의 "exit code·stdout 판정 금지" 원칙과 정합한다.

## 실행한 전체 검증

| 명령 | 결과 |
|---|---|
| `bun run check` (codegen:check + typecheck + test:architecture + test) | **332 pass / 0 fail** (42 files) |
| `bun test packages` | **314 pass / 0 fail** (37 files) |
| `bun run test:architecture` | **6 pass / 0 fail** — 경계 위반·계층 역전 없음 |

## 별도 실측 필요 (본 태스크에서 실행하지 않음)

- 실제 `herdr` + `pi`/`codex`/`agy` 라이브 TUI 대화 확인(탭 렌더링·`agent prompt` 타이핑 체감·steer와 TUI 상태 경합) — 유료 모델 호출로 이어질 수 있어 수동 검증으로 분리한다(ADR 리스크 2·3항).
- pi 침묵 폴백 등 TTY 부재 시나리오는 단위 테스트에서 모사하지 않는 것이 ADR 테스트 전략이며, 여기서도 모사하지 않았다.

## 결론

ADR의 채택 메커니즘(M1)은 코드와 테스트에 그대로 구현되어 있으며, 탭=실시간 대화 요구의 런치 경로는 ADR 일치 상태다. 남은 것은 문제 1(steerRun → `provider.steer` 호출부 배선) 한 건이며, 표면과 폴백 계약이 이미 검증되어 있어 후속 태스크는 오케스트레이터 실행 루프에 라이브 워커 steer 디스패치를 연결하는 작업으로 한정된다.
