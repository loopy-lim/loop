# 공급자 가용성과 JEV 영향 범위 감사

- kind: `research`
- attempt: `0`
- date: `2026-09-21` (Asia/Seoul)
- workspace: `/Users/loopy/dev/ll3/loop`
- result: **PASS with evidence limits**

## Scope and safety boundary

이번 감사는 로컬 소스·설정·Loop SQLite 상태와 `loop doctor --auth`의 읽기 전용
상태 확인만 다뤘다. 인증 요청, 모델 프롬프트, 실 provider 생성 요청, 유료 모델
호출은 수행하지 않았다. 자격증명 값은 읽거나 기록하지 않았다.

`research` receipt를 남기기 위해 이 Markdown 파일만 새로 추가했다. 기존 dirty
worktree 변경과 실행 DB는 수정하지 않았다.

## 1. `loop doctor --auth` 실측

실행한 명령:

```bash
loop doctor --auth --json
```

실행 파일은 `/Users/loopy/.local/bin/loop`였고, active config directory는
`/Users/loopy/.config/loop`였다. 명령의 exit code는 `0`이었다. 구현과 테스트는
`packages/cli/src/main.ts:272-328`, `packages/cli/test/cli.test.ts:176-219`에
있으며 Pi에는 `auth check ... --no-refresh`, Codex에는 `login status`, AGY에는
`models`만 전달한다. 이 경로는 모델 prompt를 만들지 않는다.

이 receipt는 설치된 CLI와 active user config의 증거다. 현재 worktree의 dirty
소스를 새로 build/install한 뒤 얻은 결과가 아니므로, 설치 artifact와 source
worktree의 cross-process equivalence는 주장하지 않는다.

| 대상 | 실제 결과 | 의미와 한계 |
| --- | --- | --- |
| Z.AI | `pi` version `0.86.1`, `auth=ready` | Pi native auth store가 준비됨. 직접 Z.AI HTTP reachability, quota, generation 성공은 증명하지 않음. active `[lead]`는 `provider = "zai"`, `model = "glm-5.3-flash"`이고 direct `providers.zai`는 `enabled = false`; `ZAI_API_KEY` 환경변수도 absent였다. |
| Codex | `codex-cli 0.155.1`, `auth=ready` | `codex login status`가 성공. 출력에는 PATH alias 생성 권한 경고가 있었지만 exit code는 0이었다. 모델 실행·quota는 증명하지 않음. |
| Antigravity | `agy` version `1.2.7`, `auth=ready` | `agy models`가 성공. native keyring/model inventory 확인이며 실제 worker prompt 성공은 증명하지 않음. |
| JEV | **doctor probe 없음 / configured disabled** | active `[providers.jev]`는 `enabled = false`, `auth = "none"`, endpoint는 `http://127.0.0.1:8089`이며 command가 없다. 따라서 이번 명령은 JEV의 endpoint health를 “available” 또는 “unavailable”로 판정하지 않았다. |

부가적으로 같은 결과에서 `rustra`는 `contract ready`, Herdr는 `0.8.2`였다.
이는 provider generation 증거가 아니다.

## 2. `jev`와 `typed_decision` 참조 전수

아래는 현재 worktree에서 `jev`, `Jev`, `typed_decision`, 그리고 같은 도메인의
Rust `TypedDecision`을 검색한 결과다. generated protocol의 반복 enum variant도
포함했다.

### Configuration and policy

| 위치 | 참조 | 역할 / JEV disable 영향 |
| --- | --- | --- |
| `config/models.toml:12-17` | `jev-typed-decision`, provider `jev`, class `typed_decision` | JEV 후보 profile 선언. 현재 JEV provider가 disabled라 registry에 들어가지 않는다. |
| `config/models.toml:43-49` | Codex `gpt-5.6-terra`의 `typed_decision` | 현재 D1 class의 별도 Codex 후보. 따라서 JEV만 disabled해도 D1 class 전체가 즉시 사라지지는 않는다. |
| `config/policy.toml:12` | escalation에 `typed_decision` | deterministic 다음 escalation 단계로 D1을 유지한다. |
| `config/providers.example.toml:34-39` | `[providers.jev]`, disabled, deterministic fallback | 배포별 JEV endpoint 설정 예시. |
| `/Users/loopy/.config/loop/providers.toml:34-39` | active JEV 설정 | 이번 doctor가 읽은 실제 설정. 값은 repo에 복사하지 않았다. |

Rust core의 provider-neutral routing에도 같은 단계가 있다.

| 위치 | 참조 | 역할 |
| --- | --- | --- |
| `crates/loop-core/src/policy/compute_class.rs:8-26` | `ComputeClass::TypedDecision` | protocol/core enum 및 다음 class가 `TypedDecision -> Tiny`가 되는 ladder. |
| `crates/loop-core/src/event/reducer.rs:77-92` | verification failure 뒤 `next_compute_class` | 검증 실패 시 다음 compute class로 재시도하므로 D1을 제거하면 Rust state transition과 generated contract를 함께 바꿔야 한다. |
| `packages/orchestrator/src/config.ts:164-172` | `typed_decision` allowed set | TOML validation이 허용하는 class. |
| `packages/orchestrator/src/coordinator.ts:229-252` | compute ladder와 `d1` alias | missing-route 검사 및 provider selection의 escalation 범위. D1 provider가 없으면 attention으로 갈 수 있다. |

### Adapter, composition, and routing

| 위치 | 참조 / 관찰 | 영향 |
| --- | --- | --- |
| `packages/providers/src/jev/client.ts:1-60` | `JevClient`, score/margin gate, `source: "jev"`, deterministic fallback | JEV HTTP decision client는 구현되어 있다. network/error/ambiguous score는 fallback을 반환한다. |
| `packages/providers/src/index.ts:11` | JEV client export | package public export. |
| `packages/providers/test/adapters-v2.test.ts:252-280` | unavailable fallback 및 unambiguous decision tests | mock fetch를 사용하므로 JEV 실제 endpoint 가용성을 증명하지 않는다. |
| `packages/orchestrator/src/composition.ts:21-77` | **JEV branch 없음** | enabled provider/model을 registry에 넣지만 branch는 Codex, AGY, Z.AI API/CLI만 처리한다. 따라서 현재 JEV profile은 설정·export에는 존재해도 runtime `ProviderRegistry` provider로 instantiate되지 않는다. |
| `packages/orchestrator/src/coordinator.ts:103-120,192-207` | selected provider와 missing-route 검사 | 현재 active config에서는 D1을 제공하는 Codex model이 있고, JEV disable만으로 route가 없어지지 않는다. JEV만 D1 후보로 남기면 해당 class에서 attention이 예상된다. |

### Generated protocol

`typed_decision`은 provider 이름이 아니라 public compute-class contract이므로,
JEV만 비활성화하는 것과 protocol enum에서 D1을 삭제하는 것은 다른 변경이다.

- `packages/protocol/src/generated/types.ts:37`
- `packages/protocol/src/generated/schema.json:165,398,554,710,1256`
- `packages/protocol/src/generated/frame-codecs.ts:241,247,253,548,699,850,1461,1467,1473,1523`

이 파일들은 Rustra generated output이다. 삭제·변경하려면 Rust bridge/core type을
먼저 바꾸고 codegen을 다시 실행해야 한다.

### Tests, architecture guard, and documentation

- `packages/orchestrator/test/config.test.ts:109` — escalation TOML fixture의 D1.
- `tests/configuration.test.ts:24` — expected escalation list의 D1.
- `tests/architecture-boundaries.test.ts:33` — loop-core 소스가 `Jev`를 직접
  참조하지 않는 provider-neutral 경계 assertion.
- `README.md:27` — providers package 책임에 Jev를 열거.
- `docs/model-routing.md:5-13,35-39` — D1을 constrained Jev judgment로 설명하고
  deterministic fallback을 문서화.
- `docs/provider-support.md:5-12,18,22-24` — Jev transport/fallback 및
  authenticated provider evidence boundary.
- `docs/superpowers/plans/2026-09-21-loop-standalone-herdr-plan.md:166` — JEV
  client 변경 계획 위치.

### Impact estimate

현재 상태에서 JEV를 disabled로 두는 직접 영향은 낮다.

1. JEV는 이미 active config에서 disabled이고, composition root에도 JEV
   `AgentProvider` 생성 branch가 없다.
2. D1 `typed_decision`은 `config/models.toml:43-49`의 Codex
   `gpt-5.6-terra` profile이 별도로 제공한다. Codex native auth도 이번 doctor에서
   ready였다.
3. 다만 JEV를 “활성화하면 작동한다”고 말할 수는 없다. 현재 composition은
   enabled JEV를 registry에 추가하지 않으므로, JEV-only D1 route는 실제 worker
   provider가 되지 않는다.
4. `typed_decision` class 자체를 제거하는 것은 Rust enum/ladder, orchestrator
   validation/escalation, generated schema/codecs/types, config fixtures를 함께
   바꾸는 별도 migration이다.

## 3. 현재 stall 실패와 provider availability의 관계

active Loop SQLite를 원본에 journal을 만들지 않는 immutable read-only URI로
조회했다. `events`의 `verification_failed` 중 요청한 stall 문구를 가진 기록은
다음과 같다. DB timestamp는 UTC이며 괄호 안은 KST다.

| Seq | Run | Task | UTC (KST) | Failure |
| ---: | --- | --- | --- | --- |
| 19 | `loop-337a...` | `verify-offline-pipeline` | 11:54:06 (20:54:06) | `agent_prompt_stalled`: 5000 ms 동안 observed state change 없음, status idle, `state_change_seq` 불변 |
| 41 | `loop-af78...` | `audit-herdr-layout` | 12:09:57 (21:09:57) | `timeout: timed out waiting for agent status` |
| 44 | `loop-af78...` | `research-tab-capabilities` | 12:10:02 (21:10:02) | `timeout: timed out waiting for agent status` |
| 48 | `loop-af78...` | `audit-herdr-layout` | 12:15:02 (21:15:02) | `timeout: timed out waiting for agent status` |
| 68 | `loop-ed943...` | `audit-provider-availability` | 12:23:26 (21:23:26) | `timeout: timed out waiting for agent status` |
| 71 | `loop-ed943...` | `research-pi-universal-worker` | 12:23:30 (21:23:30) | `timeout: timed out waiting for agent status` |

`seq 19`은 이후 `seq 20`의 open attention으로 한 번 더 표현되지만 underlying
verification failure는 한 건이다. 따라서 DB에는 `agent_prompt_stalled` underlying
failure 1건과 timeout failure 5건이 있다. 최신 실행의 마지막 두 timeout과 직전
`audit-herdr-layout` timeout을 “현재 세 번”으로 묶을 수 있으나, 문구 기준으로는
전체 이력이 위와 같이 더 많다. 별도로 `Herdr returned invalid JSON` failure도
`seq 4`에 있으나 이번 stall 문구 집계에는 포함하지 않았다.

관계 판단:

- 이 failure reason들은 인증 실패, quota/rate-limit, endpoint unavailable가
  아니라 prompt 후 agent status/state 변화를 관찰하지 못한 lifecycle timeout이다.
- 해당 run의 `workers.provider` 값은 조회된 stall worker 행에서 비어 있었다.
  따라서 이 DB 증거만으로 JEV, Z.AI, Codex, AGY 중 어느 provider가 stall을
  일으켰는지 귀속할 수 없다.
- 최신 두 timeout task는 `preferred_compute = balanced`, `attempt = 1`로
  persisted되어 있지만 provider identity나 model identity는 failure event에 없다.
- 현재 소스에는 두 exact failure string이 없고, Herdr runtime은
  `packages/herdr/src/client.ts:115-130`에서 상태를 조회하고
  `:166-199`에서 `agent prompt --wait --timeout`을 실행한다. Herdr-backed
  provider는 `packages/providers/src/herdr-agent.ts:133-165`에서 wait 후 status를
  반복 관찰한다. 따라서 현 증거가 가리키는 1차 범위는 provider auth보다 Herdr/
  agent lifecycle 및 status observation 경계다.
- `loop doctor --auth`의 `ready` 결과는 native auth-store readiness일 뿐 prompt
  lifecycle 성공의 증거가 아니다. 반대로 stall 기록도 provider auth 불가의 증거가
  아니다. 양자는 별도 evidence level로 유지해야 한다.

## Reproduction / read-only checks

```bash
cd /Users/loopy/dev/ll3/loop
loop doctor --auth --json
sqlite3 'file:/Users/loopy/.config/loop/loop.sqlite?mode=ro&immutable=1' '.tables'
rg -n --hidden -g '!node_modules/**' -g '!target/**' -g '!.git/**' \
  -i 'jev|typed[_ -]?decision|typeddecision' .
```

No test, build, provider prompt, authentication refresh, or paid model call was
needed for this audit.
