# pi 범용 워커 실행 옵션 조사, attempt 0

- kind: `research`
- attempt: `0`
- date: `2026-09-21` (Asia/Seoul)
- workspace: `/Users/loopy/dev/ll3/loop`
- 대상: `ProcessProvider` 계약, 기존 Codex/Z.AI CLI 어댑터, `config/models.toml`, pi CLI
- 쓰기 범위: 이 보고서 한 파일만 추가
- 금지 경계: pi 인증 프롬프트, provider readiness/auth 조회, 모델 prompt, 유료 모델 호출 없음

## 결론

pi CLI를 별도 프로세스 워커로 감싸는 것은 현재 구조에 맞는다. 기존
`ProcessProvider`가 실행 명령·인자·cwd를 어댑터에 위임하고, 공통 프로세스
취소·출력 구독·결과 정규화를 제공하기 때문이다.

두 라우팅 방식을 비교하면 **OPTION B: `config/models.toml`의 클래스-모델
매핑을 유지하고 pi를 실행 transport로만 사용하는 방식**을 권장한다. Loop의
`computeClass` 선택, 비용/지연/능력 메타데이터, 자동 에스컬레이션, provider별
receipt를 보존하면서 pi의 provider-native 인증과 모델 호출만 재사용할 수
있다.

OPTION A처럼 클래스별 모델 선택을 pi의 provider/default-model 라우팅에
위임하는 것도 가능하지만, pi CLI help와 공식 문서에는 Loop의
`computeClass` 개념이 없다. 따라서 “클래스”를 pi가 이해한다고 볼 수 없고,
Loop가 클래스마다 provider route를 별도로 선언해야 한다. 모델 ID와 비용
경계가 pi catalog/default에 의해 바뀌어 재현성이 낮아진다.

## 1. 현재 Loop 계약의 근거

### E1 — `ProcessProvider`는 pi를 수용할 수 있는 얇은 실행 seam이다

`packages/providers/src/process-provider.ts:21-44`의 추상 계약은
`capabilities()`와 `launch(input)`만 어댑터가 구현하도록 한다. `launch()`의
결과는 `command`, `args`, 선택적인 `cwd`, `env`뿐이다. 공통 구현은
`start()`에서 프로세스를 시작하고, `cancel/status/result/subscribe`를
제공한다 (`:46-108`).

`packages/providers/src/process.ts:25-54`의 `NodeProcessRunner`는 child
process를 `stdio: ["ignore", "pipe", "pipe"]`로 띄우고, `:55-91`에서
stdout/stderr을 수집하고 취소한다. 따라서 일회성 non-interactive pi
프로세스에는 바로 맞지만, stdin으로 명령을 계속 보내는 RPC 세션에는 현재
runner 계약만으로는 부족하다.

### E2 — 성공은 비어 있지 않은 최종 출력까지 포함한다

`packages/providers/src/process-provider.ts:110-153`의
`normalizeProcessResult()`는 exit code가 0이어도 final summary가 없으면
`incomplete_output` 실패로 판정한다. `:155-193`은 JSON Lines의 중첩 final
값과 session 식별자를 찾고, `:216-235`는 인증·quota·timeout·process
실패를 분류하고 출력/credential 패턴을 redaction한다.

pi JSON mode를 붙일 때도 단순히 exit code만 보아서는 안 된다. 최종
`message_end`와 유효한 텍스트를 확인하고, session ID를 receipt에 보존해야
한다.

### E3 — 기존 Codex/Z.AI CLI 어댑터는 모델을 실행 인자로 고정한다

- Codex는 help probe 후 `codex exec --json -C <cwd>`, sandbox/approval,
  선택적인 `--model`, prompt를 조합한다 (`packages/providers/src/codex/adapter.ts:43-66`).
  resume도 `codex exec resume <session> --json`으로 별도 구성한다
  (`:69-77`).
- Z.AI CLI는 `--output-format json --cwd <cwd>`, 선택적인 `--model`,
  `--prompt`를 조합한다 (`packages/providers/src/zai/cli.ts:32-50`).

즉 pi 어댑터도 같은 모양의 `capabilities()` + `launch()` 구현으로 시작할
수 있다. 다만 pi의 JSON event schema에 맞춘 final/session 추출은 별도
어댑터 테스트가 필요하다.

### E4 — 현재 라우팅은 클래스별 provider candidate를 선택한다

`packages/providers/src/registry.ts:12-24`는 capability가 available이고
요청 `computeClass`를 포함하는 첫 provider를 선택한다. Orchestrator는
선택된 provider에 task의 `preferredCompute`, attempt, requirements, cwd를
전달한다 (`packages/orchestrator/src/coordinator.ts:99-121`). worker 성공
뒤에는 별도의 completion contract verification을 수행한다
(`:160-187`).

`packages/orchestrator/src/composition.ts:21-76`은 활성 provider와
`config/models.toml`의 `model.provider`가 일치하는 각 모델에 대해
provider instance를 만든다. `packages/orchestrator/src/model-registry.ts:18-25`는
compute class별 모델을 cost+latency로 정렬한다. 이 구조가 Loop 소유
모델 매핑의 현재 근거다.

### E5 — 현재 설정은 model ID와 class metadata를 Loop에 둔다

`packages/orchestrator/src/config.ts:7-20`의 `ModelProfile`은 model ID,
provider, compute class, capabilities, latency, costWeight를 보유한다.
`config/models.toml`은 예를 들어 `glm-5.3-flash → zai/fast`,
`gpt-5.6-terra → codex/balanced`, `gpt-5.6-sol → codex/strong`을
명시한다. provider endpoints와 credential environment 이름은
`config/providers.example.toml`에만 있으며, 설정 parser는 credential literal을
거부한다 (`packages/orchestrator/src/config.ts:214-260`).

## 2. pi CLI 표면의 근거

### E6 — 설치된 pi help, read-only 확인

실행한 명령:

```text
pi --version
pi --help
pi --mode json --help
pi --print --help
```

관찰 결과: 설치된 binary는 `pi 0.86.1`이었다. 모든 help 조회에서 다음
옵션이 보였다.

```text
--provider <name>
--model <pattern>
--mode <mode>       text, json, or rpc
--print, -p         Non-interactive mode: process prompt and exit
--no-session        Don't save session
--tools <tools>
--no-tools
--extension <path>
--no-extensions
--offline
```

help 실행 중 기존 `/Users/loopy/.pi/agent/settings.json` lock directory에
대한 `EPERM` 경고가 한 번 출력됐지만, help는 정상 출력됐다. 이 경고는
현재 설치 환경의 설정 쓰기 상태이며, 인증 성공이나 provider availability의
증거가 아니다. 인증·prompt·모델 실행은 하지 않았다.

### E7 — pi 공식 CLI/JSON/RPC 문서

pi 공식 repository는 현재 `earendil-works/pi`로 연결된다.

- [CLI reference](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/README.md#cli-reference)는
  `--provider`, `--model`, `--mode text|json|rpc`, `--print`, `--no-session`,
  tool allowlist를 정의하고, `--mode json`과 non-interactive 예를 든다.
- [JSON event stream](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/json.md)은
  `pi --mode json`이 JSON Lines를 stdout으로 내보내며, session header 뒤에
  agent/turn/message/tool lifecycle event가 온다고 정의한다. `message_end`가
  최종 authoritative message다.
- [RPC mode](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md)는
  `pi --mode rpc`가 stdin JSONL command와 stdout response/event stream을
  사용하는 headless protocol이라고 정의한다. `prompt`, `abort`,
  `get_state`, `set_model`, `get_available_models`가 문서화되어 있다.

공식 문서에도 Loop의 `deterministic`, `fast`, `balanced`, `frontier` 같은
compute class는 없다. pi의 모델 선택 단위는 provider와 model pattern/ID다.

## 3. OPTION 비교

| OPTION | 클래스/모델 소유자 | 실행 형태 | Loop 적합성 |
| --- | --- | --- | --- |
| A. pi provider/default routing 위임 | pi provider route와 기본 모델 | `pi --mode json --print --provider <route>`; model 생략 가능 | 조건부, 재현성 위험 |
| B. Loop 매핑 유지, pi transport | Loop `models.toml`; pi는 provider/model 실행 | `pi --mode json --print --provider <p> --model <m>` | **권장** |
| C. B + pi RPC | Loop `models.toml`; pi는 장기 세션 transport | `pi --mode rpc --provider <p> --model <m>` | 장기적으로 유력, 현재 runner 확장 필요 |

### OPTION A — 클래스별 모델 선택을 pi provider 라우팅에 위임

#### 형태

각 compute class를 pi provider route에 연결하고, worker launch에서 concrete
`--model`을 생략한다. 예를 들어 개념적으로 `fast → zai`, `balanced →
openai-codex`처럼 route를 선택한 뒤 pi의 provider catalog/default model이
실제 모델을 정한다. 현재 `ProcessProvider` 계약에는 맞지만, pi CLI 자체에는
compute class 인자가 없으므로 Loop가 이 route metadata를 여전히 알아야
한다.

#### EVIDENCE

- E1/E3: command/args/cwd 중심의 기존 process adapter seam에 `pi` command를
  넣는 것은 가능하다.
- E6/E7: pi가 `--provider`를 제공하지만, class 선택이나 “이 provider의
  fast model” 옵션은 제공하지 않는다. `--model`은 pattern/ID 선택 옵션이다.
- E4: Loop registry는 provider capability의 `computeClasses`를 보고 선택한다.
  그러므로 A도 class별 capability 선언 없이는 현재 orchestrator에 연결되지
  않는다.

#### 장점

- provider별 pi-native catalog/default와 auth resolution을 재사용한다.
- model ID를 Loop 설정에 중복 선언하지 않아 catalog 변경을 따라가기 쉽다.
- provider 전환을 route 설정 한 곳에서 할 수 있다.

#### 위험

- **클래스 의미 붕괴:** 하나의 pi provider default를 모든 class에 쓰면
  `fast`와 `strong`의 차이가 실행에서 보장되지 않는다.
- **재현성 저하:** default model/catalog가 바뀌어도 `models.toml` diff나
  Loop receipt만으로는 실제 모델을 알 수 없다. `--models`는 cycling 범위이지
  deterministic class-to-model contract가 아니다.
- **비용·quota 경계 불명확:** pi가 선택한 모델이 Loop의 costWeight와
  다를 수 있다. 유료 모델 호출 여부도 Loop의 class metadata만으로 판단할
  수 없다.
- **resume/observability 불충분:** one-shot JSON event의 session header와
  final event를 읽어도 실제 resolved provider/model receipt를 별도 수집하지
  않으면 provider drift를 놓친다.
- **권한 경계:** pi는 현재 cwd를 받지만, cwd 자체는 sandbox가 아니다. tool
  allowlist는 사용 가능 도구를 제한할 뿐 OS 권한을 격리하지 않는다. 구현
  worker에 기본 tools를 열면 파일/프로세스 변경 범위가 Codex sandbox보다
  넓을 수 있다.

#### 판정

실현 가능하지만, “pi가 class별 모델을 알아서 고른다”는 주장은 근거가
없다. A를 채택하려면 최소한 class→pi route, 허용 provider/model 집합,
resolved model receipt, 비용 정책을 Loop 설정과 acceptance contract로
추가해야 한다. 현재 목표에는 부적합하다.

### OPTION B — `config/models.toml` 매핑을 유지하고 실행만 pi로 수행

#### 형태

새 `PiProvider`/`PiCliProvider`를 `ProcessProvider` 위에 두고, Loop가
선택한 `ModelProfile`의 `computeClass`, provider route, model ID를
구성 시점에 고정한다. worker 실행 인자는 개념적으로 다음과 같다.

```text
pi --mode json --print --no-session \
  --provider <pi-provider-name> --model <pi-model-id> -- <worker prompt>
```

credentials는 argv에 넣지 않고 pi가 상속받은 environment/native auth를
사용한다. 기존 `config/models.toml`의 `compute_class`, capabilities,
latency, costWeight는 그대로 Loop routing/verification의 입력으로 둔다.

현재 설정의 provider 명칭과 pi 명칭이 항상 같다는 보장은 없다. 예를 들어
Loop 설정의 `codex`, `antigravity`를 pi에서 사용할 때는 pi가 요구하는
`openai-codex`, `google-antigravity` 같은 provider name으로 변환하는
구성 필드가 필요하다. `zai`처럼 동일한 경우에는 직접 매핑할 수 있다.
이 변환은 adapter construction/config에만 두고 `loop-core`로 흘리지 않는다.

#### EVIDENCE

- E1/E3: 기존 Codex/Z.AI CLI adapter와 동일하게 pi command, cwd, model,
  prompt를 `launch()`에서 조합할 수 있다.
- E4/E5: provider registry와 model registry가 이미 class별 candidate와
  concrete model metadata를 보유한다. 별도의 class abstraction을 pi에
  요구하지 않아도 된다.
- E6/E7: pi는 명시적인 `--provider`와 `--model`을 지원한다. JSON mode는
  stdout JSONL, `message_end` authoritative final을 제공한다.
- 오프라인 현재 검증: `bun test packages/providers/test/adapters-v2.test.ts`
  12 pass, `bun test packages/orchestrator/test/config.test.ts packages/orchestrator/test/milestone.test.ts`
  15 pass, `bun run test:architecture` 6 pass. 이 결과는 기존 계약만
  검증하며 pi 실제 호출을 검증한 것이 아니다.

#### 장점

- **현재 Loop semantics 보존:** class 선택, cost/latency 정렬, escalation,
  provider history가 그대로 유지된다.
- **실행과 정책 분리:** pi는 process transport와 provider-native auth,
  model API 호출을 담당하고, deterministic policy는 Loop가 담당한다.
- **receipt가 명확하다:** 선택한 `provider/model/computeClass`를 worker
  record에 저장하고 pi session ID와 final `message_end`를 연결할 수 있다.
- 기존 Z.AI CLI/Codex adapter 테스트 패턴을 재사용하기 쉽다.

#### 위험

- **이중 catalog drift:** `models.toml`의 model ID/capability와 pi catalog가
  어긋날 수 있다. capability probe는 help만으로 model 존재를 증명하지
  못하므로 실제 acceptance 전용 검사가 필요하다.
- **provider 명칭 차이:** Loop의 `codex`/`antigravity`와 pi의 provider
  identifiers 사이 mapping이 누락되면 startup/auth failure가 된다.
- **pi JSON parser seam:** 현재 generic parser가 중첩 text를 일부 찾을 수
  있어도 Pi의 `session.id`, `message_end.message.content`, tool/error
  lifecycle을 명시적으로 처리하는 것이 안전하다. 특히 session ID는
  현재 `thread_id/session_id/conversation_id` 탐색 키만으로는 보장되지
  않는다.
- **권한/격리:** `ProcessProvider`의 cwd는 작업 디렉터리 선택이지 sandbox가
  아니다. 구현 worker라면 pi tool allowlist와 별도 Herdr/OS sandbox 경계를
  설계해야 한다.
- **resume 의미:** `--mode json --print` one-shot는 worker 완료 후 종료된다.
  resume는 pi `--session`/`--continue` 또는 RPC를 별도로 설계해야 하며,
  Loop의 `resume(sessionId, ...)`를 단순히 새 one-shot 실행으로 대체하면
  conversation continuity가 사라진다.

#### 판정

**현재 Loop 구조에 가장 적합하다.** 단, “pi 실행”과 “pi가 어떤 provider/model을
  골랐는지”를 분리하지 말고, Loop가 넘긴 concrete selection과 pi가 반환한
  session/final event를 모두 receipt에 남기는 계약으로 구현해야 한다.

### OPTION C — B의 매핑을 유지하되 pi RPC를 장기 transport로 사용

#### 형태

Loop가 model mapping을 계속 소유하고, `pi --mode rpc --no-session
--provider <p> --model <m>`를 한 worker 세션으로 유지한다. prompt와
`abort`를 stdin JSONL로 보내고 stdout response/event JSONL을 읽는다.

#### EVIDENCE

- 공식 RPC 문서는 stdin JSONL command, stdout response/event, request ID,
  `prompt`, `abort`, `get_state`, `set_model`을 명시한다.
- 따라서 one-shot `ProcessProvider`보다 live stream, cancel, state,
  resolved model observation, follow-up에 맞는 protocol seam이 있다.

#### 위험

- 현재 `ProcessRunner`는 stdin을 `ignore`로 만들고 write/close API가 없다
  (`packages/providers/src/process.ts:25-91`). RPC는 기존 `launch()`만
  추가해서 구현할 수 없고, 별도의 interactive/RPC runner와 framing,
  backpressure, terminal lifecycle이 필요하다.
- RPC prompt가 accepted 된 뒤의 provider failure는 별도 event stream으로
  오므로, response success를 worker success로 오인하면 안 된다.
- 장기 프로세스와 session 파일을 관리하면 cleanup, crash reattach,
  credential/config directory 격리 범위가 one-shot보다 커진다.

#### 판정

장기 실행·취소·재개가 핵심이면 유력한 후속 transport다. 다만 최초
`PiProvider` 조사/구현은 OPTION B의 one-shot JSON으로 시작하고, RPC는
별도 계약과 테스트가 준비된 뒤 선택하는 편이 안전하다.

## 4. 권장 결정과 acceptance 경계

1. **정책 소유:** Loop `ModelRegistry`와 `ProviderRegistry`가 class→model
   선택을 계속 소유한다. pi에는 concrete provider/model만 전달한다.
2. **실행:** 우선 `pi --mode json --print --no-session` one-shot adapter를
   검토한다. read-only research task는 필요할 때만 `--tools
   read,grep,find,ls`를 명시한다. implementation task의 tool 권한은
   별도 sandbox 결정 없이는 열지 않는다.
3. **receipt:** Loop가 선택한 provider/model/class와 pi session ID, final
   `message_end`, exit code, typed failure를 함께 저장한다. pi process
   exit 0은 completion verification을 대체하지 않는다.
4. **credential:** `--api-key`나 key literal을 argv/config/receipt에 넣지
   않는다. pi native auth/environment는 상속하되, 이번 조사에서는 읽거나
   확인하지 않았다.
5. **검증 순서:** 실제 모델 호출 전에는 (a) fake ProcessRunner argv
   contract, (b) captured Pi JSONL fixture parser, (c) missing model/provider,
     (d) cancel/timeout/redaction, (e) `bun run check`를 완료한다. 이후
   별도 승인된 real-provider smoke만 수행한다.

## Evidence boundary

이번 조사로 증명된 것은 **현재 계약에 pi process adapter를 설계할 수 있음**,
pi 0.86.1의 help surface, 공식 JSON/RPC protocol 문서, 기존 오프라인 계약
테스트 통과다. 다음은 증명하지 않았다.

- pi provider authentication 또는 model availability
- pi의 실제 prompt/model 호출, 유료 quota, 응답 latency
- pi JSONL의 실제 runtime payload가 현재 Loop parser와 완전히 호환됨
- `config/models.toml`의 모든 provider/model ID가 pi catalog에서 해석됨
- OS sandbox, Herdr pane lifecycle, crash reattach, long-running soak

따라서 이 문서는 **OPTION 비교와 구현 경계에 대한 SPEC 수준 조사**이며,
adapter 구현·version 변경·provider smoke·commit을 포함하지 않는다.
