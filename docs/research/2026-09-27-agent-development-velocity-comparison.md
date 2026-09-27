# 개발 에이전트의 작업 완료 속도: Loop를 위한 1차 자료 비교

- 확인일: 2026-09-27. 공식 문서와 프로젝트 소유자의 저장소만 확인했다. 외부 프로젝트를 실행하거나 속도를 실측하지 않았다.
- 질문: 모델의 첫 응답 시간이 아니라, **사용자 요청부터 검증 가능한 코드 변경까지 걸리는 시간**을 어떻게 줄일 것인가?
- Loop 기준: [아키텍처](../architecture.md)의 **Herdr 안에서 실행하는 Pi Lead** → TypeScript orchestrator/adapters → generated Rustra → Rust core/store 경계, Herdr의 pane/process 소유권, 완료 계약과 scope-aware DAG를 유지한다. Pi [Lead 프롬프트](../../packages/pi-loop/src/lead/prompts.ts)는 이미 작은 변경을 직접 실행 태스크에 위임하고 형식적인 research/decision 노드를 빼라고 한다. 다만 [확장](../../packages/pi-loop/src/extension.ts)은 공학 요청마다 최소 문맥 탐색→DAG 작성→`loop_run` 1회 호출을 지시한다. `loop_run`은 실행 요약이 도착할 때까지 Pi tool call에서 기다리며 progress를 갱신한다. 따라서 **입구의 계획 생성 턴과 실행 중 Lead 상호작용**을 먼저 측정할 필요가 있다.

## 프로젝트별로 가져올 메커니즘

| 프로젝트 | 확인된 메커니즘 | Loop 적합성 / 주의점 |
| --- | --- | --- |
| **Oh My OpenAgent (옛 Oh My OpenCode, OMO)** | 공식 가이드는 단일 파일 수정은 메인 에이전트가 직접 처리하고, 복잡한 작업에 계획·위임·검증을 적용한다. `task(category=...)`는 작업 종류를 구성된 모델/스킬에 매핑한다. 의존성이 있는 작업은 DAG로 재시도·steer할 수 있으며, 실행 완료는 별도 reviewer와 ledger로 확인한다. [실행 가이드](https://github.com/code-yeongyu/oh-my-openagent/blob/dev/docs/guide/orchestration.md) | **추론:** Loop에는 이미 DAG와 완료 계약이 있고 Pi Lead에도 작은 작업을 단순화하는 지침이 있다. 그 지침의 실제 준수율과 생성 비용을 먼저 재고, 작업 종류별 구성 기반 라우팅과 선택적 독립 검증을 검토한다. OMO의 workflow 엔진을 복제하거나 모든 작업에 다중 reviewer를 붙이면 지연과 비용이 늘 수 있다. |
| **OpenCode** | 기본 Build/Plan과 범용·코드 탐색·외부 문서 탐색 subagent를 분리한다. `explore`는 빠른 읽기 전용 검색이며 child session을 탐색할 수 있다. 장기 세션은 [compaction](https://opencode.ai/v2/docs/compaction)으로 이어간다. [에이전트 문서](https://opencode.ai/docs/agents) | **추론:** Pi Lead의 모델 호출 전에 파일 위치만 찾는 저렴한 읽기 전용 탐색과 작업 세션 핸드오프 요약을 마련할 수 있다. OpenCode agent hierarchy를 Loop core에 넣지 말고 Pi/adapter 계층에서 사용한다. |
| **Aider** | 매 요청에 주요 class/function/signature를 담은 작은 [repo map](https://aider.chat/docs/repomap.html)을 제공한다. 편집 파일에 대해 lint를 자동 실행하고, 구성된 테스트를 수정 직후 돌려 실패를 고치게 할 수 있다. [lint/test 문서](https://aider.chat/docs/usage/lint-test.html) | **추론:** 최초 탐색과 잘못된 파일 편집을 줄일 수 있다. Rust/TS의 실제 심볼을 색인해 필요한 부분만 Pi/worker context에 주입하고, 수정 범위에 맞는 빠른 검사를 completion receipt로 연결한다. 전체 `bun run check`는 최종 게이트로 둔다. |
| **OpenHands SDK** | [PathTrigger와 점진적 스킬 로딩](https://docs.openhands.dev/sdk/guides/skill)은 파일을 읽거나 수정할 때 관련 규칙만 주입한다. [독립 도구 호출 병렬화](https://docs.openhands.dev/sdk/guides/parallel-tool-execution)는 선택 기능이며 공유 쓰기에는 race 위험이 있다. [TaskToolSet](https://docs.openhands.dev/sdk/guides/task-tool-set)은 child의 대화 상태를 보존해 이어갈 수 있다. [tracing](https://docs.openhands.dev/sdk/guides/observability)과 [usage metrics](https://docs.openhands.dev/sdk/guides/metrics)를 제공한다. | **추론:** 파일 경로별 Loop 경계 규칙을 관련 작업에만 넣고, 읽기/독립 도구에 한해 동시 실행한다. Loop의 기존 scope 충돌 검사와 Herdr 소유권을 우회하는 SDK 실행층으로 대체해서는 안 된다. 대화 전체를 저장하는 방식은 비밀정보 최소화와 구분해 검토한다. |
| **mini-SWE-agent** | 현재 프로젝트는 단순한 bash 작업 루프, 선형 trajectory, 독립 subprocess 실행을 강조하며 평가/디버깅에 쓴다. [프로젝트 README](https://github.com/SWE-agent/mini-swe-agent/blob/main/README.md)와 [단일 SWE-bench 실행기](https://github.com/SWE-agent/mini-swe-agent/blob/main/src/minisweagent/run/benchmarks/swebench_single.py) | **추론:** Loop의 복잡한 실행 경로가 유효한지 확인할 *최소 agent baseline*으로 유용하다. 단일 worker·동일 요청·동일 mock/provider 조건에서 Loop와 완료율/벽시계/도구 호출 수를 비교한다. bash-only 설계를 core로 가져오면 typed graph와 완료 계약을 잃는다. |
| **Goose** | custom agent는 재사용 역할, skill은 필요할 때 로드되는 절차, recipe는 반복 작업 설정, subagent는 격리된 실행으로 구분한다. [역할 구분](https://github.com/aaif-goose/goose/blob/main/documentation/docs/guides/context-engineering/custom-agents.md). [Subrecipe](https://github.com/aaif-goose/goose/blob/main/documentation/docs/guides/recipes/subrecipes.md)는 각자 별도 context에서 실행되며 파라미터와 결과를 부모에 전달한다. | **추론:** Loop에서도 persona, 작업 지식, 실행 그래프를 혼동하지 않도록 분리한다. 반복되는 작업은 구성 가능한 graph template로 만들되, 단일 작업마다 고정 recipe를 강제하지 않는다. |

## 우선할 다섯 가지 가설

1. **Pi Lead의 입구와 대기 시간을 줄인다.** [OMO](https://github.com/code-yeongyu/oh-my-openagent/blob/dev/docs/guide/orchestration.md)의 빠른 직접 실행 규칙과 [Aider의 기본 code mode](https://aider.chat/docs/usage/modes.html)를 참고한다. **현 상태:** [Lead 프롬프트](../../packages/pi-loop/src/lead/prompts.ts)는 이미 작은 변경에 형식적인 research/decision을 금지한다. [extension](../../packages/pi-loop/src/extension.ts)은 그래도 모든 공학 요청에서 DAG 작성과 `loop_run` 호출을 요구하며, tool call은 실행 요약까지 대기한다. **추론:** 소형 작업의 실제 그래프 크기·계획 턴·첫 worker 시작 시간과, run 중 사용자 입력 대기 시간을 측정한 뒤 Pi의 빠른 경로 또는 run 접수 직후 비차단 복귀를 비교한다. 축소하더라도 완료 계약·scope·durable event는 유지한다.
2. **검색된 근거만 context에 싣는다.** [Aider repo map](https://aider.chat/docs/repomap.html)과 [OpenHands path rules](https://docs.openhands.dev/sdk/guides/skill)를 결합하는 제안이다. **추론:** Pi/worker adapter에서 관련 심볼과 로컬 경계 규칙을 작게 제공하면 탐색 턴과 잘못된 수정이 줄 수 있다. 색인은 configuration/context 산출물로 취급하고 Rust domain type을 TypeScript에 다시 만들지 않는다.
3. **독립 읽기와 독립 작업만 병렬화한다.** [OpenHands 병렬 도구 지침](https://docs.openhands.dev/sdk/guides/parallel-tool-execution)은 공유 상태의 race를 명시한다. [OMO의 의존성 graph](https://github.com/code-yeongyu/oh-my-openagent/blob/dev/docs/guide/orchestration.md)는 실패 노드만 재실행한다. **추론:** Loop의 기존 Rust scope 충돌 검사와 decision/integration 직렬화를 유지하고, 읽기 전용 검색·독립 파일 범위 작업에서만 동시성을 키운다.
4. **편집 직후 좁은 피드백을 준다.** [Aider](https://aider.chat/docs/usage/lint-test.html)는 수정 파일 lint와 구성된 test command를 즉시 수행한다. **추론:** Loop worker가 국소 검사를 먼저 실행해 실패를 같은 작업에서 고치고, 검증 노드에서 `bun run check` 등 최종 게이트를 받으면 재시도 비용을 줄일 수 있다. `git status`/`git rev-parse`만으로는 코드 품질을 확인할 수 없다.
5. **작업 완료 시간을 계측해 최소 baseline과 비교한다.** [OpenHands tracing/metrics](https://docs.openhands.dev/sdk/guides/observability), [mini-SWE-agent trajectory](https://github.com/SWE-agent/mini-swe-agent/blob/main/README.md), [OMO ledger](https://github.com/code-yeongyu/oh-my-openagent/blob/dev/docs/guide/orchestration.md)가 근거다. **추론:** 프롬프트 접수→graph 확정→첫 수정→국소 검사→최종 검증의 시간, 호출/토큰 수, 재시도, 사용자 개입, 실제 완료율을 *같은 태스크 셋*에서 비교해야 한다. Loop는 이미 event log를 가지므로 먼저 이벤트/receipt로 계산하고 민감한 프롬프트·자격증명은 저장하지 않는다.

### 실행 중 자연어 지시의 위치

[Pi 확장](../../packages/pi-loop/src/extension.ts)은 `/loop steer <run> <task|all> <message>`를 제공한다. `packages/orchestrator/src/mailbox.ts`는 `GuidanceAdded`를 실행 중 steer 가능한 worker에 전달하고 `GuidanceDelivered`를 기록하며, 재클레임 문맥에도 반영한다. [Herdr worker 연결](../../packages/orchestrator/src/composition.ts)도 실행 중 steer 경로를 갖는다. **추론:** 빠진 것은 새로운 전달 엔진이 아니라 Pi Lead 대화에서 평범한 자연어 수정 지시를 현재 run의 steer/추가 태스크/새 요청 중 어느 것으로 다룰지 정하는 **입구 동작**이다. 설치된 Pi 문서와 [공식 사용 설명](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/usage.md)에 따르면, 실행 중 `Enter`로 보낸 지시는 큐에 들어가지만 현재 assistant turn의 도구 호출이 끝난 뒤 다음 모델 호출 전에 전달된다. 따라서 `loop_run`이 전체 실행 요약까지 기다리는 현재 구조에서는 Lead가 실행 도중 후속 문장을 해석해 Loop에 전달할 수 없다. 실행 소유권이 영속적으로 인계된 뒤 도구가 빨리 반환하도록 바꾸는 것이 자연어 steering의 선행 조건이다. 접수, worker 전달, 실제 반영은 서로 다른 상태로 표시해야 한다. [OMO의 child steer](https://github.com/code-yeongyu/oh-my-openagent/blob/dev/docs/guide/orchestration.md)는 상호작용 비교 기준일 뿐 전송층 대체안은 아니다.

## 판단 경계와 실험 제안

- 이것은 기능/구조 비교이며 **프로젝트 간 속도 순위가 아니다**. README의 벤치마크 수치와 서로 다른 모델·태스크의 실측을 Loop의 향상률로 옮기지 않는다.
- 세 가지 무료 fixture로 먼저 비교한다: (a) 단일 파일 수정, (b) Rust bridge→codegen→TS 소비자 변경, (c) 충돌하지 않는 두 구현 작업. **Pi Lead 경로**에서 graph 생성·`loop_run` 접수→첫 worker 시작·검증 receipt·완료까지 재고, 같은 scripted turns로 축소 입구/비차단 복귀 후보를 비교한다. 게이트웨이 template는 별도 fixture로 취급한다. 실제 공급자/Herdr UI 검증은 별도 증거로 남긴다.
- 가장 큰 미해결 질문은 **현재 작업에서 어느 구간이 실제 병목인지**다. 개발 태스크의 모델 지연·조정 오버헤드·테스트 시간 비중을 보여 주는 Pi/Herdr 실측은 아직 없다.

## 이 체크아웃의 Pi/Herdr 관찰

- 기본 사용자 구성 경로 `~/.config/loop`에는 `personas/`가 없다. 저장소에는 `config/personas/*.md`가 있지만 [로컬 설치 스크립트](../../scripts/install-local.sh)는 이를 복사하지 않는다. [persona 해석](../../packages/orchestrator/src/persona.ts)은 빈 registry에서 지시문 없이 조용히 진행한다. 따라서 현재 기본 구성에서는 worker에 역할별 지시문이 실리지 않는다. Herdr 프로세스가 별도 `LOOP_CONFIG_DIR`을 설정했다면 그 실제 경로는 따로 확인해야 한다.
- [Rust bridge](../../crates/loop-bridge/src/commands.rs)에는 `add_task`가 이미 있다. 그러나 Pi 확장과 CLI에는 이를 사용자 대화에서 호출하는 표면이 없다. 새로운 요구가 기존 실행의 한 worker 지시인지, DAG에 추가할 독립 작업인지 구분하려면 이 경계를 명시해야 한다.
- 오프라인 `loop verify-install --json`은 fake provider의 7개 태스크 완료와 최대 동시 실행 3개를 보고했고, `bun run check`도 통과했다. 이는 스케줄러/계약의 회귀 여부에 대한 증거이며 실제 Pi/Herdr 개발 작업의 완료 시간을 측정한 결과는 아니다.

### 추가로 언급된 “가제 코드”: 식별 미확정

공식 명칭 **Kage Code**인 단일 제품은 확인하지 못했다. 이름이 비슷한 별개 후보로 [Kage local agent orchestrator](https://kage.raskell.io/docs/)는 Rust 기반 로컬 supervisor·checkpoint/resume을 설명하고, [Kage verified memory](https://kage-core.com/guide.html)는 코드 경로에 연결된 Git 기반 메모리와 stale 검사를 설명한다. 둘은 다른 제품이며 어느 쪽도 사용자가 의도한 “가제 코드”라고 단정할 근거가 없다. 명칭/링크가 확정되면 해당 제품을 위 비교와 같은 기준으로 평가해야 한다.
