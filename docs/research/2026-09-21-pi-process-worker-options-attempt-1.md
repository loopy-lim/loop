# Pi CLI 프로세스 워커 옵션 조사 — attempt 1

- Kind: `research`
- Attempt: `1`
- Captured: 2026-09-21 KST
- Workspace: `/Users/loopy/dev/ll3/loop` (`HEAD` `3c17869a0ff9f277ae0a2244985df763671c37e2`)
- 범위: `ProcessProvider` 계약, Codex/Z.AI CLI 어댑터, composition/config, 그리고 설치된 Pi CLI의 도움말만 읽었다. 이 문서만 새로 썼다.
- 금지 경계: 인증·로그인·credential 조회, 모델 프롬프트/호출, 유료 호출, Loop 코드·설정·생성 파일 변경은 하지 않았다. `pi auth`는 실행하지 않았고 `pi auth --help`만 조회했다.

## 결론

**Pi CLI 프로세스 워커 어댑터 자체는 실현 가능하다.** `ProcessProvider`가 요구하는 것은
명령, 인수, cwd, 선택적 환경뿐이고, 설치된 Pi 도움말은 비대화형 `--print`, `--mode json`,
`--provider`, `--model`, 세션 및 도구 제한 인수를 제공한다. 다만 현재는 Pi가 Lead
런타임일 뿐 워커 composition 분기가 없고, Pi JSON의 완료/세션 이벤트 스키마도 이
조사에서는 모델을 호출하지 않아 증명하지 못했다.

권장안은 **OPTION B (Loop의 `models.toml` 클래스-모델 정책 유지, 실행만 Pi)** 이다.
Loop가 compute class와 escalation의 선택 책임을 계속 가지므로 현재 DAG/정책 경계와
일치한다. OPTION A는 Pi의 기본/저장된 provider 라우팅을 쓸 수 있지만, Pi 도움말에
Loop의 `compute_class`와 연결되는 인수는 없어서 Pi 쪽에 별도 클래스 라우터 계약이
없는 한 `fast`/`strong` 선택을 재현·감사할 수 없다.

## 현재 계약과 관찰

| 관찰 | 근거 | Pi 워커에 주는 의미 |
| --- | --- | --- |
| `ProcessProvider`는 `launch()`의 command/args/cwd/env를 시작하고 stdout/stderr를 결과·이벤트로 정규화한다. | [`process-provider.ts:21-94`](../../packages/providers/src/process-provider.ts#L21-L94), [`process.ts:41-95`](../../packages/providers/src/process.ts#L41-L95) | 얇은 `PiCliProvider extends ProcessProvider`로 process lifecycle/cancel/redaction을 재사용할 수 있다. |
| 정상 종료라도 비어 있거나 인식 못 한 최종 출력이면 `incomplete_output`이다. 세션 ID는 현재 `thread_id`, `session_id`, `conversation_id`만 찾는다. | [`process-provider.ts:103-193`](../../packages/providers/src/process-provider.ts#L103-L193) | `--mode json` 출력의 final/session 모양을 fixture로 먼저 증명하거나 Pi 전용 normalizer를 추가해야 한다. 도움말만으로는 충족 여부가 불명이다. |
| `StartWorkerInput`에는 `computeClass`, `attempt`, `requirements`, `workingDirectory`가 있고 결과에는 비어 있지 않은 summary가 필요하다. | [`types.ts:12-66`](../../packages/providers/src/types.ts#L12-L66) | Pi 인수에 compute class가 없으므로, A의 class 선택은 Pi 외부 계약 없이는 prompt에만 남는다. prompt는 routing 증거가 아니다. |
| Codex와 Z.AI CLI는 같은 추상화를 각각 `exec --json … --model` 및 `--output-format json … --model --prompt`로 구현한다. | [`codex/adapter.ts:21-87`](../../packages/providers/src/codex/adapter.ts#L21-L87), [`zai/cli.ts:14-51`](../../packages/providers/src/zai/cli.ts#L14-L51) | Pi에도 capability probe + 안전한 noninteractive launch + adapter contract test라는 동일한 얇은 seam이 있다. |
| composition은 설정된 모델마다 provider를 하나 만들고, 그 provider에는 해당 모델의 compute class 하나만 준다. Pi worker 분기는 없다. | [`composition.ts:21-77`](../../packages/orchestrator/src/composition.ts#L21-L77) | B는 현 구조를 가장 적게 바꾼다. A는 하나의 Pi adapter가 복수 class를 주장하도록 registry semantics를 바꾼다. |
| 모델의 provider/id/compute class는 `models.toml`에서 읽고 provider 설정에는 command/mode/auth만 있다. | [`config.ts:186-247`](../../packages/orchestrator/src/config.ts#L186-L247), [`models.toml:1-81`](../../config/models.toml#L1-L81) | 현재 schema에는 Pi의 **하위 provider 이름**을 모델별로 담을 필드가 없다. 여러 Pi provider를 B로 pin하려면 config 확장이 필요하다. |
| Pi는 현재 Lead만 담당한다. CLI는 Lead에만 `--provider`/`--model`을 넘긴다. | [`README.md:5`](../../README.md#L5), [`README.md:53-55`](../../README.md#L53-L55), [`main.ts:390-413`](../../packages/cli/src/main.ts#L390-L413) | 기존 `lead` 설정을 worker runtime 설정으로 재사용하면 Lead/worker policy가 결합된다. 별도 `[providers.pi]`가 필요하다. |

## Pi CLI 도움말 증거 (실행 시각의 설치본)

다음은 **도움말 조회만**의 출력이다. 모델 프롬프트와 `pi auth check`는 실행하지
않았다.

```text
$ pi --help
  --provider <name>              Provider name (default: google)
  --model <pattern>              Model pattern or ID (supports "provider/id" and optional ":<thinking>")
  --mode <mode>                  Output mode: text (default), json, or rpc
  --print, -p                    Non-interactive mode: process prompt and exit
  --session <path|id>            Use specific session file or partial UUID
  --session-id <id>              Use exact project session ID, creating it if missing
  --no-session                   Don't save session (ephemeral)
  --no-tools, -nt                Disable all tools by default (built-in and extension)
  --tools, -t <tools>            Comma-separated allowlist of tool names to enable
  --no-extensions, -ne           Disable extension discovery (explicit -e paths still work)
  --no-skills, -ns               Disable skills discovery and loading
  --no-prompt-templates, -np     Disable prompt template discovery and loading
  --no-context-files, -nc        Disable AGENTS.md and CLAUDE.md discovery and loading
  --offline                      Disable startup network operations (same as PI_OFFLINE=1)
```

같은 도움말은 read-only 도구 제한 예시로 `pi --tools read,grep,find,ls -p …`를
제시한다. `pi auth --help`는 `auth check`가 기본적으로 만료 OAuth를 refresh하고
`--no-refresh`가 이를 막는다고 명시한다. 따라서 이 조사에서는 `auth check`를 하지
않았다.

중요한 한계도 관찰됐다. 이 설치본의 `pi --help`는 다음 경고를 내며 settings lock을
만들려고 시도했다(권한 오류로 실패).

```text
Warning: Invalid settings file /Users/loopy/.pi/agent/settings.json: EPERM: operation not permitted, mkdir '/Users/loopy/.pi/agent/settings.json.lock'
```

즉 `--help`가 인증·모델 호출은 하지 않았지만, **capability probe를 완전히 무상태라고
가정하면 안 된다.** 구현 시 strict isolation이 필요하면 별도의 제어된
`PI_CODING_AGENT_DIR`를 사용하고, 그 동작은 유료 호출 없이 별도 검증해야 한다.

## OPTION A — 클래스별 모델 선택을 Pi provider 라우팅에 위임

### 설계

하나의 `PiCliProvider`가 Loop의 복수 class(예: `tiny`~`frontier`)를 capability로
advertise하고, launch는 `pi --print --mode json`에 `--provider`/`--model`을 주지
않거나 Pi가 가진 provider-default/route alias만 준다. Pi의 저장된 provider/model
선택이 실제 모델을 정하고, Loop는 task의 `computeClass`를 scheduler/escalation
순서에만 사용한다.

후보 실행 벡터는 다음과 같지만, 실제 구현 인수로 확정된 것은 아니다.

```text
pi --print --mode json --no-extensions --no-skills --no-prompt-templates \
   --no-context-files --no-session [--tools <명시적-allowlist>] <worker prompt>
```

### EVIDENCE

- Pi 도움말은 noninteractive `--print`, `json`/`rpc` mode, provider/model 선택 및
  `--no-session`을 제공한다. 위의 **Pi CLI 도움말 증거**를 참조한다.
- Loop registry는 advertised compute class가 포함된 첫 available provider만 선택한다.
  [`registry.ts:12-24`](../../packages/providers/src/registry.ts#L12-L24)
- core policy는 구체 모델명이 아니라 compute class만 선택해야 한다.
  [`README.md:61-67`](../../README.md#L61-L67),
  [`model-routing.md:15-35`](../../docs/model-routing.md#L15-L35)

### 위험과 미해결 계약

- **정책 드리프트 (높음):** `fast`/`strong`은 Loop의 의미인데 Pi 도움말에는
  `--compute-class`가 없다. prompt에 `kind`나 `computeClass`를 넣어도 Pi가 해당
  class의 모델을 골랐다는 검증 가능한 계약은 되지 않는다.
- **재현성·감사 약화 (높음):** `models.toml`의 profile/cost/latency가 실제 Pi의
  default model과 분리된다. Pi 설정 변경 뒤 동일한 durable run을 재시도해도 다른
  모델/provider가 선택될 수 있다.
- **capability 오표현 (높음):** 한 adapter가 넓은 class를 advertise하면 registry는
  route가 실제로 가능한지 알 수 없다. 실패가 worker 실행 뒤에야 나타나 missing-route
  attention보다 늦고, escalation의 provider 기록도 같은 `pi` ID만 남는다.
- **출력 계약 미증명 (차단):** 도움말은 `json`이 있다고만 말한다. 최종 summary와
  session ID가 현재 `ProcessProvider` parser에 맞는지는 유료 호출 없이 아직 증명하지
  못했다.
- **설정 side effect (중간):** `--help`도 settings lock을 시도했다. capability probe
  자체를 일반 사용자 Pi state에서 반복하면 strict read-only 기대와 충돌할 수 있다.

### 판정

Pi에 class→route를 고정하는 별도, 버전 관리되는 router 설정과 실행 결과의 선택된
provider/model receipt가 생긴 경우에만 조건부로 실현 가능하다. 그 전에는 Loop의
class policy를 Pi default에 위임하는 방식은 권장하지 않는다.

## OPTION B — `config/models.toml` 클래스-모델 매핑을 유지하고 실행만 Pi로 전환

### 설계

`models.toml`의 각 profile마다 `PiCliProvider`를 하나 생성한다. 각 인스턴스는
`computeClasses: [model.computeClass]`만 advertise하고, Pi launch에는 해당 profile의
고정 provider/model을 전달한다.

```text
pi --print --mode json --no-extensions --no-skills --no-prompt-templates \
   --no-context-files --no-session --provider <configured-pi-provider> \
   --model <configured-model-id> [--tools <명시적-allowlist>] <worker prompt>
```

현재 `ModelProfile.provider`는 Loop adapter identity/composition key이므로 Pi의 하위
provider와 같은 의미로 재사용할 수 없다. 최소 설계는 `models.toml`에 adapter identity
`provider = "pi"`를 두고, 모델별 `pi_provider` (또는 명시적 route alias)와 `id`를
추가하는 것이다. parser와 composition이 이 설정을 읽어 Pi 인수로만 전달한다. 이는
provider/model 정보를 adapter/config layer에 두며 Rust core와 bridge에는 Pi 개념을
넣지 않는다.

### EVIDENCE

- 현재 composition은 model 하나마다 provider 하나를 만들고 class 하나만 부여한다.
  [`composition.ts:26-68`](../../packages/orchestrator/src/composition.ts#L26-L68) B의
  인스턴스 단위와 같다.
- Codex adapter도 model 하나와 class 배열 하나를 construction에 받고 launch에
  `--model`을 고정한다. [`codex/adapter.ts:10-66`](../../packages/providers/src/codex/adapter.ts#L10-L66)
- Pi 도움말은 `--provider <name>` 및 provider-qualified `--model <pattern>`을
  지원한다. 위의 **Pi CLI 도움말 증거**를 참조한다.
- `models.toml`은 이미 구체 provider/model과 compute class를 config에 한정하고,
  문서는 provider name이 TypeScript composition root에 남아야 한다고 규정한다.
  [`models.toml:1-81`](../../config/models.toml#L1-L81),
  [`model-routing.md:33-35`](../../docs/model-routing.md#L33-L35)

### 위험과 미해결 계약

- **config schema 확장 (중간):** 현재 parser는 `id`, `provider`, `compute_class`만
  profile route로 읽고, `ProviderConfig`에는 모델별 Pi provider가 없다.
  [`config.ts:186-247`](../../packages/orchestrator/src/config.ts#L186-L247) `pi_provider`
  같은 명시 필드를 추가하고 unknown/missing route를 검증해야 한다.
- **Pi JSON normalizer (차단):** `--mode json` final/session event schema이
  `ProcessProvider`의 generic parser와 맞는지 아직 모른다. fixture/공개 source 또는
  무료·격리된 contract source가 없으면 성공 결과를 신뢰하면 안 된다.
- **권한과 도구 scope (높음):** Pi tool 기본값에 의존하면 task의 read/write scope와
  달라질 수 있다. `--no-extensions --no-skills --no-prompt-templates`와 task별
  allowlist/denylist의 정책을 설계하고, write task에만 필요한 도구를 명시해야 한다.
- **session semantics (중간):** `--no-session`이면 현재 ProcessProvider 기본 resume은
  새 start로 돌아간다. Pi resume을 지원하려면 Pi의 `--session-id`와 persisted ID를
  generic session extraction에 안전하게 연결해야 한다.
- **probe side effect (중간):** capability check로 `pi --help`를 매번 부르면 위의
  settings lock 시도가 반복된다. command availability를 별도 side-effect-aware probe
  정책으로 다뤄야 한다.

### 판정

**조건부 권장.** 작은 adapter/composition/config 변경으로 현재 registry, class
escalation, provider 기록, completion-contract 경계를 보존한다. 단, JSON output
fixture와 config route validation이 선행하지 않으면 구현 완료로 간주할 수 없다.

## 의존성, 읽기/쓰기 scope, 향후 completion contract

| 항목 | 내용 |
| --- | --- |
| 의존성 | 설치된 Pi의 비대화형 `--print`/`--mode json` surface, provider-native Pi 인증 상태(Loop는 credential을 읽거나 전달하지 않음), `ProcessProvider`, composition/config seam |
| 읽기 scope | Pi 도움말 출력, provider/process/orchestrator/config/문서 소스 |
| 쓰기 scope (이번 조사) | 이 문서 한 개뿐 |
| 쓰기 scope (B 구현 시) | `packages/providers`의 새 adapter와 contract test, `packages/orchestrator` composition/config test, 명시 승인된 `config`/문서. Rust core/store/bridge/generated protocol은 변경 대상이 아님 |
| non-empty completion contract (구현 전제) | (1) FakeRunner로 정확한 Pi argv·cwd·redaction·cancel을 검증, (2) Pi JSON final/session의 고정 fixture를 normalizer에 통과, (3) `models.toml` 각 Pi route가 단 하나의 compute class로 select되는 composition test, (4) JSON 누락은 `incomplete_output`, route 누락은 dispatch 전 attention, (5) default test suite는 유료 모델 호출 없이 통과 |

실제 Pi provider 인증·quota·모델 호출은 위 offline 계약과 별도 evidence다. 이 조사는
그 실행 증거를 만들지 않았으며, 어떤 OPTION도 실계정 동작을 검증했다고 주장하지
않는다.
