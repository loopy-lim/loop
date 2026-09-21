# Jev 및 `typed_decision` 영향 범위 감사, attempt 1

- kind: `research`
- attempt: `1`
- date: `2026-09-21` (Asia/Seoul)
- workspace: `/Users/loopy/dev/ll3/loop` (최종 source 재확인 `HEAD` `29a7b74`; 시작 시 기존 dirty/untracked 변경 존재)
- 읽기 범위: tracked/working-tree 소스, 설정, 테스트, 문서 및 생성 계약; 상위
  에이전트가 수행한 run event SQLite immutable read-only query와 `loop doctor --auth`
  읽기 전용 상태 조회 결과
- 쓰기 범위: 이 보고서 하나
- 금지 경계: 인증을 바꾸는 요청, credential 값 조회, 모델 프롬프트 및 유료 호출 없음

## 결론

1. 최종 active user config immutable read-only 관찰에서 `jev`는 disabled,
   Codex/Antigravity와 direct `zai` API provider는 enabled였다. direct Z.AI는
   `ZAI_API_KEY` environment가 없어 doctor에서 unavailable로 보고되었다. 이 user
   config는 repo 밖이라 링크하지 않는다. repo에는 `providers.example.toml`만 있고 loader는 user
   `providers.toml`을 우선한 뒤 example으로 fallback한다. D1 (`typed_decision`)에는
   Codex `gpt-5.6-terra` 프로필도 있으므로, **Jev만 disable/remove** 해도 현재
   worker registry의 D1 model coverage는 Codex에 남는다. 다만 Jev composition branch가
   없으므로 그 결론은 Jev endpoint의 실제 가용성 증거가 아니다.
   [`packages/orchestrator/src/config.ts:90-112`](../../packages/orchestrator/src/config.ts#L90-L112), [`config/models.toml:11-17`](../../config/models.toml#L11-L17), [`config/models.toml:43-49`](../../config/models.toml#L43-L49)
2. 더 강하게, `JevClient`는 export와 단위 테스트는 있으나 registry 조립에는 Jev
   branch가 없다. 따라서 `[providers.jev]`만 enable해도 worker adapter는 생성되지
   않으며, Jev 모델은 현재 task dispatch에 사용될 수 없다. [`packages/orchestrator/src/composition.ts:21-76`](../../packages/orchestrator/src/composition.ts#L21-L76), [`packages/providers/src/jev/client.ts:24-58`](../../packages/providers/src/jev/client.ts#L24-L58)
3. `typed_decision` 자체를 없애는 일은 Jev 제거와 다르다. Rust core의 compute
   enum/사다리와 Rustra 생성 계약, 설정 검증, coordinator 사다리, Codex D1 프로필을
   함께 바꾸고 codegen해야 하는 breaking change다. [`crates/loop-core/src/policy/compute_class.rs:8-27`](../../crates/loop-core/src/policy/compute_class.rs#L8-L27), [`packages/protocol/src/generated/types.ts:37`](../../packages/protocol/src/generated/types.ts#L37), [`AGENTS.md:12-13`](../../AGENTS.md#L12-L13)

## 전 참조 목록과 disable 영향

| 구분 | 모든 관련 위치 | Jev-only disable 영향 |
| --- | --- | --- |
| 설정 | `config/models.toml:11-17` (Jev D1), `:43-49` (Codex D1); `config/providers.example.toml:34-39`; `config/policy.toml:8-12` | Jev profile/provider 항목은 제거 대상이다. policy D1과 Codex D1은 남겨야 한다. active user config의 Jev는 read-only 관찰상 이미 disabled다. |
| Rust policy/생성 protocol | `crates/loop-core/src/policy/compute_class.rs:8-27`; `packages/protocol/src/generated/types.ts:37`; `schema.json:165,398,554,710,1256`; `frame-codecs.ts:241-253,548,699,850,1461-1473,1523` | Jev만 제거 시 변경 없음. D1 제거 시 Rust type부터 수정하고 이 생성물 전부를 `bun run codegen`으로 갱신해야 한다. |
| 설정/라우팅 | `packages/orchestrator/src/config.ts:142-143,164-172,186-211,214-247,264-269`; `packages/orchestrator/src/coordinator.ts:192-206,229-252`; `packages/providers/src/registry.ts:12-24` | `d1` alias와 escalation range는 D1을 독립 class로 취급한다. Jev가 결선되지 않았으므로 Codex D1까지 끄면 현재 composition에서 D1 선택은 `no provider supports compute class typed_decision`으로 막힌다. |
| Jev adapter | `packages/providers/src/jev/client.ts:1-60`; `packages/providers/src/index.ts:11` | HTTP 실패/비정상 점수는 호출자 fallback으로 복귀한다. 하지만 composition은 codex/antigravity/zai/zai_cli만 만들며 Jev를 연결하지 않는다: `composition.ts:26-70`. 제거 시 client/export와 직접 테스트를 삭제한다. |
| 테스트 | `packages/providers/test/adapters-v2.test.ts:9,252-281`; `packages/orchestrator/test/config.test.ts:99-115`; `tests/configuration.test.ts:16-28`; `tests/architecture-boundaries.test.ts:29-35` | Jev 테스트 및 Jev 금지명 assertion을 정리한다. D1 제거 시 config fixture와 generated-contract/architecture 검사를 함께 갱신한다. |
| 문서/계획 | `README.md:18-31`; `docs/model-routing.md:5-13,33-39`; `docs/provider-support.md:5-24`; `docs/superpowers/plans/2026-09-21-loop-standalone-herdr-plan.md:157-178` | README/provider/routing 설명에서 Jev를 제거 또는 “비결선 실험 client”로 정정한다. 계획의 `jev/client.ts` 언급도 정리한다. |

`JevClient.decide()`는 endpoint에 closed labels/features만 POST하며 HTTP 오류,
파싱/점수 부족, margin 부족 모두 `deterministic_fallback`을 반환한다. 따라서 이
client가 실제로 결선되더라도 Jev 단독 장애는 정의상 fallback이어야 한다.
[`packages/providers/src/jev/client.ts:33-58`](../../packages/providers/src/jev/client.ts#L33-L58)
단, 현재 registry에 결선되지 않았다는 사실은 이 fallback 테스트가 **실제 task
dispatch 증명은 아님**을 뜻한다. [`packages/providers/test/adapters-v2.test.ts:252-280`](../../packages/providers/test/adapters-v2.test.ts#L252-L280)

## `loop doctor --auth`의 관찰 가능 범위

이 명령은 enabled provider의 command version만 probe하고, `--auth`에서는 Pi의
`auth check --no-refresh`, enabled native Codex/Antigravity, enabled api-key
provider만 검사한다. Jev는 command도 native/api-key auth도 아니고 active user
config에서 disabled라 별도 상태 행이 없다. 최종 관찰에서 enabled direct Z.AI API는
environment가 없어 `missing ZAI_API_KEY` 상태 행을 냈다. Pi의 Z.AI auth 행은 Z.AI
HTTP endpoint/quota 가용성 검사가 아니다.
[`packages/cli/src/main.ts:248-266`](../../packages/cli/src/main.ts#L248-L266), [`packages/cli/src/main.ts:279-324`](../../packages/cli/src/main.ts#L279-L324), [`packages/cli/test/cli.test.ts:176-218`](../../packages/cli/test/cli.test.ts#L176-L218)

상위 에이전트가 `bun packages/cli/src/main.ts doctor --auth --json`을 실행한 결과는
exit 0이었다. Rustra contract와 Herdr 0.8.2가 준비되어 있고, Pi 0.86.1 (lead
`provider=zai`, `model=glm-5.3-flash`), Codex CLI 0.155.1, Antigravity 1.2.7이 각각
`auth: ready`를 반환했다. enabled direct Z.AI API provider는 `auth: missing
ZAI_API_KEY`여서 전체 doctor exit는 1이었다. 이 과정은 각 CLI의 status/auth check만
수행했고 모델 prompt를 보내지 않았다. 관찰 중 user config의 mtime이 21:32:55 KST로
변경되어, 초기의 disabled Z.AI 관찰 대신 이 최종 상태만 availability snapshot으로
사용한다.

| 대상 | 이번 read-only 증거 | 판정 경계 |
| --- | --- | --- |
| Jev | active user config에서 disabled; doctor 상태 행 없음 | endpoint, model, quota는 **미확인**; 현재 composition에도 결선되지 않음 |
| Z.AI | Pi lead의 provider-native auth `ready`; direct Z.AI API provider는 enabled이나 `missing ZAI_API_KEY` | Pi auth는 준비됨. direct Loop API route는 현재 credential environment 부재로 **unavailable**; HTTP endpoint/model/quota는 **미확인** |
| Codex | enabled native provider, `codex login status` exit 0, `auth: ready` | native login은 준비됨. 특정 모델의 호출/잔여 quota는 **미확인** |
| Antigravity | enabled native provider, `agy models` exit 0, `auth: ready` | native auth와 model-list surface는 준비됨. 특정 모델의 호출/잔여 quota는 **미확인** |

따라서 이 audit은 위 결과를 **Codex, Antigravity 및 Pi provider-native auth의
read-only 상태**로만 해석하며, Jev와 Z.AI API의 실제 endpoint/model availability로
승격하지 않는다.

## worker stall 3건과 공급자 가용성의 관계

### 실행 record와 확인한 사실

상위 에이전트가 `/Users/loopy/.config/loop/loop.sqlite`에 대해 수행한 immutable
read-only query는 아래 **정확한 네 record**를 반환했다. 이 SQLite event row는
발생 횟수/시각/사유에 관한 1차 실행 근거이며, 이 하위 감사는 DB를 직접 열거나
변경하지 않았다.

| run / sequence / 시각 | task | event / reason | attribution 경계 |
| --- | --- | --- | --- |
| 현재 `loop-ed943b8a-07dc-4f08-8745-8e7490836235`, seq 68, 21:23:26 | `audit-provider-availability` | `verification_failed`; `timeout: timed out waiting for agent status` | 현재 run worker table의 provider/session field가 모두 `NULL`이라 provider를 배정할 수 없음. |
| 현재 run, seq 71, 21:23:30 | `research-pi-universal-worker` | `verification_failed`; 같은 timeout | 위와 같음. |
| 현재 run, seq 74, 21:28:30 | `audit-provider-availability` | `verification_failed`; 같은 timeout | 위와 같음. |
| 직전 run, seq 19, 20:54:06 | `verify-offline-pipeline` | `agent_prompt_stalled`; 5,000ms 안에 observed state 변화 없음, status `idle` | **현재 run의 세 timeout과 별개**이며, provider/session attribution도 이 record만으로는 불가. |

따라서 “현재 worker stall 세 번”의 정확한 범위는 현재 run의
`verification_failed` timeout 세 건이며, `agent_prompt_stalled`는 직전 run의 별도
한 건이다. 세 timeout은 같은 task ID에서 두 번 발생했지만 event rows는 세 개다.

- visible Codex/AGY worker는 Herdr agent를 시작하고 prompt를 `--wait --timeout
  300000`으로 보낸다. 이 경로의 non-zero Herdr 응답은 runtime에서 throw되고,
  adapter는 redacted `process_error`/retryable 결과로 바꾼다. [`packages/herdr/src/client.ts:166-203`](../../packages/herdr/src/client.ts#L166-L203), [`packages/herdr/src/client.ts:294-310`](../../packages/herdr/src/client.ts#L294-L310), [`packages/providers/src/herdr-agent.ts:68-102`](../../packages/providers/src/herdr-agent.ts#L68-L102)
- 이후 status polling은 Herdr `agent get` 결과를 `running/blocked/completed/failed/
  unknown`으로 map한다. `blocked` 또는 `unknown`은 worker failure가 되며, prompt
  wait에 timeout guard 외 별도 stall detector는 없다. [`packages/herdr/src/client.ts:120-130`](../../packages/herdr/src/client.ts#L120-L130), [`packages/herdr/src/client.ts:272-291`](../../packages/herdr/src/client.ts#L272-L291), [`packages/providers/src/herdr-agent.ts:112-172`](../../packages/providers/src/herdr-agent.ts#L112-L172)
- Jev는 `AgentProvider`도 아니고 Herdr `agent prompt` 경로에도 없다. composition의
  visible worker kind는 Codex 또는 AGY만이다. 그러므로 현재 소스만으로는 위 두
  stall 문자열을 Jev 가용성 부족의 결과라고 연결할 근거가 없고, 직접 원인은
  Herdr prompt/status lifecycle 또는 실제 Codex/AGY worker 상태라는 범위까지만
  좁혀진다. [`packages/orchestrator/src/composition.ts:31-50`](../../packages/orchestrator/src/composition.ts#L31-L50), [`packages/herdr/src/worker.ts:1-3`](../../packages/herdr/src/worker.ts#L1-L3)

### 증거 경계와 다음 판별 기준

이것은 source/config 감사에 상위 에이전트의 immutable event query 및 `loop doctor
--auth` 읽기 전용 상태 조회를 합친 것이다. live Herdr pane, provider endpoint,
credential 값 또는 quota에는 접근하지 않았다. event row가 세 timeout의 횟수와 task를
확정하지만 현재 run의 provider/session이 `NULL`이므로 실제 provider availability와
연결하지 못한다. 각 record의 worker ID, Herdr error code, agent kind, prompt
start/finish 시각을 같은 run receipt에 보존해 대조해야
`agent_prompt_stalled`/status timeout이 provider auth·quota인지 Herdr lifecycle인지
판별할 수 있다. provider failure taxonomy는 timeout/authentication/quota를 별개로
가진다. [`packages/providers/src/types.ts:1-10`](../../packages/providers/src/types.ts#L1-L10), [`packages/providers/src/process-provider.ts:216-230`](../../packages/providers/src/process-provider.ts#L216-L230)
