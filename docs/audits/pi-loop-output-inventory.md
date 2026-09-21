# pi-loop 사용자 노출 출력면 전수 조사

- Captured: 2026-09-21 KST
- Kind: `research`
- Attempt: `0`
- Scope: 현재 worktree의 `packages/pi-loop/src`, `packages/pi-loop/test`, `AGENTS.md` 정적 소스 조사
- Write scope: 이 보고서만 작성
- Evidence boundary: 런타임 Pi 세션, Herdr 화면, provider 호출, 인증 CLI 호출은 관측하지 않음

이 문서는 소스에 적힌 문자열, 호출 경로, `slice` 한도만 기록한다. 여기서 줄 수는 source가 `join("\n")`으로 만드는 배열 항목/행 기준이며, 동적 필드 값 내부의 개행은 별도로 세지 않는다. 동적 값의 실제 내용이나 런타임 표시 결과는 추론하지 않는다. 아래 줄 번호는 이 보고서를 작성한 시점의 현재 worktree 기준이다.

## 정책 기준

| 기준 | 근거 | 구현 한도 확인 위치 |
| --- | --- | --- |
| default status: 8줄 | `AGENTS.md:24` | `packages/pi-loop/src/ui/status.ts:25-31`의 `slice(0, 8)` |
| attention: 6줄 | `AGENTS.md:24` | `packages/pi-loop/src/ui/attention.ts:9-16`의 `slice(0, 6)` |
| findings: 5개 | `AGENTS.md:24` | `packages/pi-loop/src/lead/reduce.ts:8-12`의 `slice(0, 5)` |

## `extension.ts`의 사용자 노출 경로

### Pi tool result와 `ui.notify`

| 경로 | 파일:줄 | 사용자에게 전달되는 값 | 소스에 보이는 줄 수/한도 | 레벨 또는 전달 방식 |
| --- | --- | --- | --- | --- |
| `loop_run` 시작 update | `packages/pi-loop/src/extension.ts:100-104` | `Run {runId}`와 `Starting {tasks.length} tasks` | 두 개의 템플릿 문자열을 `\n`으로 연결한 2줄 | `onUpdate?.(result(...))` |
| `loop_run` 진행 update | `packages/pi-loop/src/extension.ts:105-116` | `renderSnapshot("status", snapshot)` 결과 | `renderSnapshot` default branch의 5개 배열 항목, `packages/pi-loop/src/extension.ts:325-332` | `onUpdate?.(result(...))` |
| `loop_run` 완료 notify | `packages/pi-loop/src/extension.ts:118-119` | `formatRunSummary(runId, summary)` 결과 | `formatRunSummary`의 5개 배열 항목, `packages/pi-loop/src/extension.ts:304-311` | `completed`이면 `success`, 그 외 `warning` |
| `loop_run` 완료 tool result | `packages/pi-loop/src/extension.ts:118-120` | 완료 notify와 같은 `text` | `result(text, ...)`가 `content[0].text`에 그대로 넣음, `packages/pi-loop/src/extension.ts:335-336` | `details`에는 `runId`, `status`를 넣음 |
| `loop models` | `packages/pi-loop/src/extension.ts:124-131` | `backend.models()`의 각 값을 `\n`으로 연결하거나 `No models configured` | 모델 배열에 대한 `slice` 없음; 소스상 줄 수 제한 없음 | `info` |
| run ID가 없을 때 `loop` 명령 | `packages/pi-loop/src/extension.ts:133-135` | `No Loop run yet. Submit an engineering request first.` | 1개 문자열 | `warning` |
| `loop status`, `graph`, `workers`, `attention`, `cancel`, `resume` | `packages/pi-loop/src/extension.ts:137-144` | `renderSnapshot(command, snapshot)` 결과 | 아래 `renderSnapshot` 표 참조 | `snapshot.state === "attention"`이면 `warning`, 그 외 `info` |

`ui.notify` 호출은 현재 `packages/pi-loop/src/extension.ts:119`, `:130`, `:134`, `:143`의 네 곳이다. `loop_run` 완료 시에는 같은 `text`가 notify와 반환되는 tool result 양쪽에 사용된다(`packages/pi-loop/src/extension.ts:118-120`).

`result` helper는 입력 문자열을 별도 가공하지 않고 Pi tool result의 text content로 만든다(`packages/pi-loop/src/extension.ts:335-336`). 진행 update가 생성되는 원천은 child stdout의 JSON event이며, `type === "snapshot"`인 event가 `onProgress`로 전달된다(`packages/pi-loop/src/extension.ts:218-226`).

### `renderSnapshot` 분기

| 명령 분기 | 파일:줄 | 출력 형식 | 현재 하드코딩 한도 | 정책 기준 대비 사실 |
| --- | --- | --- | --- | --- |
| `graph` | `packages/pi-loop/src/extension.ts:315-317` | task마다 ``{task.id} · {task.state}`` 1개 문자열, `\n` 연결 | `snapshot.tasks.slice(0, 7)` | status/attention/findings 정책 대상이라는 선언은 `AGENTS.md:24`에 없음 |
| `workers` | `packages/pi-loop/src/extension.ts:318-321` | worker마다 ``{worker.id} · {worker.taskId}``; 빈 결과는 `No active workers` | `snapshot.activeWorkers.slice(0, 7)` | status/attention/findings 정책 대상이라는 선언은 `AGENTS.md:24`에 없음 |
| `attention` | `packages/pi-loop/src/extension.ts:322-324` | open attention ID를 줄 단위로 연결; 빈 결과는 `OK` | `snapshot.openAttentionIds.slice(0, 5)` | attention 기준 6줄보다 1개 적은 ID 한도이며, source에 6줄 초과 경로는 없음 |
| default (`status` 포함) | `packages/pi-loop/src/extension.ts:325-332` | `Run`, `State`, `Tasks`, `Workers`, `Attention` 5개 배열 항목 | 별도 `slice` 없음; 배열이 5개 항목 | status 기준 8줄보다 3줄 적은 고정 출력 |

`renderSnapshot`은 `graph`, `workers`, `attention`만 별도 분기하고 나머지는 default branch로 간다(`packages/pi-loop/src/extension.ts:314-332`). 따라서 `cancel`과 `resume`도 `status` 형식으로 notify된다(`packages/pi-loop/src/extension.ts:137-143`).

### `formatRunSummary`

| 파일:줄 | 관측된 출력 항목 | 현재 한도/정책 비교 |
| --- | --- | --- |
| `packages/pi-loop/src/extension.ts:304-311` | `Run`, `State`, `Tasks`, `Escalations`, `Verification`의 5개 배열 항목 | 함수 내부 `slice` 없음. 정적 배열 항목은 5개이며, `AGENTS.md:24`는 이 완료 summary에 별도 한도를 지정하지 않음 |

이 함수는 `ui/summary.ts`의 `renderRunSummary`와 이름이 유사하지만 서로 다른 함수다. `formatRunSummary`는 `extension.ts` 내부 private 함수이고(`packages/pi-loop/src/extension.ts:304`), `renderRunSummary`는 별도 exported 함수다(`packages/pi-loop/src/ui/summary.ts:9`).

### `leadInstructions` 노출 경로

| 경로 | 파일:줄 | 관측된 값 |
| --- | --- | --- |
| `before_agent_start` hook 등록 | `packages/pi-loop/src/extension.ts:147-149` | 기존 `event.systemPrompt` 뒤에 `leadInstructions(event.prompt)`를 `\\n\\n`으로 붙인 새 `systemPrompt` 반환 |
| `leadInstructions` 본문 | `packages/pi-loop/src/extension.ts:294-301` | Loop interactive Lead 역할, `loop_run exactly once`, task 필드 요구, research 병렬화/decision·integration 직렬화, Loop 검증 위임 문구와 `decompositionPrompt(intent)`를 줄 단위로 연결 |
| intent 재삽입 | `packages/pi-loop/src/lead/prompts.ts:1-7` | `decompositionPrompt`가 `intent.trim()`을 prompt 배열에 포함 |

이 경로는 `context.ui.notify` 호출이 아니라 Pi의 `before_agent_start` hook이 반환하는 system prompt 경로다(`packages/pi-loop/src/extension.ts:147-149`).

## `ui/` renderer별 현재 줄 수 한도와 하드코딩 위치

| 파일:줄 | renderer | 관측된 구성 | 현재 줄 수/항목 한도 | 정책 기준 대비 사실 |
| --- | --- | --- | --- | --- |
| `packages/pi-loop/src/ui/status.ts:15-31` | `renderStatus` | 첫 줄 `Run`, stage 줄들, 마지막 `Workers · Attention` | stages는 `slice(0, 6)` (`:22-24`), 전체 반환은 `slice(0, 8)` (`:25-31`). 고정 2줄 + 최대 6 stage = 정적 배열 기준 최대 8개 항목 | status 8줄과 일치. 반환 배열은 `slice(0, 8)`을 통과함 |
| `packages/pi-loop/src/ui/attention.ts:8-16` | `renderAttention` | kind, summary, options, question | options는 `slice(0, 3)` (`:9-13`), 전체 반환은 `slice(0, 6)` (`:9-16`). 고정 3개 항목 + 최대 3 options = 정적 배열 기준 최대 6개 항목 | attention 6줄과 일치. 반환 배열은 `slice(0, 6)`을 통과함 |
| `packages/pi-loop/src/ui/summary.ts:9-24` | `renderRunSummary` | `Done`, 빈 줄, tasks, branches, checks, 조건부 escalation, 조건부 changed files | 반환 직전 `lines.slice(0, 8)` (`:24`). 현재 필드 조합으로 push되는 항목은 `:10-23`에 있음 | AGENTS 기준은 default status이지 summary라고 명시되어 있지 않음. source cap은 8줄이고, `slice` 전 정적 항목 조합은 최대 7개 |
| `packages/pi-loop/src/ui/worker.ts:8-14` | `renderWorkers` | worker마다 id/provider/model/state를 ` · `로 연결 | workers는 `slice(0, 8)` (`:9-14`); worker 1개당 map 결과 1개를 `\n`으로 연결 | status/attention/findings 기준에 직접 해당한다는 선언 없음. 8개 항목 cap은 있으나 별도 전체 줄 `slice`는 없음 |
| `packages/pi-loop/src/ui/graph.ts:3-10` | `renderGraph` | task마다 dependency graph 문자열을 만들고 `\n` 연결 | `slice` 없음. source상 task 수에 대한 줄 수/항목 cap 없음 | status/attention/findings 기준에 직접 해당한다는 선언 없음. 이 renderer에는 한도 hardcode가 없음 |

`packages/pi-loop/src/index.ts:7-11`은 위 다섯 renderer를 모두 export한다. 그러나 현재 source 직접 호출 검색에서 `renderStatus`, `renderAttention`, `renderRunSummary`의 호출은 `packages/pi-loop/test/ui.test.ts:11-48`에만 있고, `renderWorkers`와 `renderGraph`는 정의 외 직접 호출이 확인되지 않는다. `extension.ts`의 import는 `packages/pi-loop/src/extension.ts:8-15`에 있으며 위 `ui/` renderer를 import하지 않는다.

## findings 한도

| 파일:줄 | 관측된 동작 | 정책 기준 대비 사실 |
| --- | --- | --- |
| `packages/pi-loop/src/lead/reduce.ts:8-12` | findings를 `BLOCK` 우선으로 정렬한 뒤 `slice(0, 5)` | findings 5개 기준과 일치. source상 반환 배열은 5개를 초과하지 않음 |
| `packages/pi-loop/test/ui.test.ts:50-59` | 9개 입력에 대해 `compactFindings` 결과가 5개인지 검사하고 빈 입력 결과가 빈 배열인지 검사 | 구현 한도에 대한 테스트 사실 |

`compactFindings`는 위에서 조사한 `ui/` 다섯 파일 안에 있지 않고 `lead/reduce.ts`에 있다. 별도의 findings renderer 호출은 현재 source 검색에서 확인되지 않는다.

## 초과·불일치 사실 목록

| 비교 | 관측된 사실 | 분류 |
| --- | --- | --- |
| `ui/status.ts` vs 정책 | `renderStatus` 전체 cap은 8줄이다(`packages/pi-loop/src/ui/status.ts:25-31`). | 초과 없음 |
| `ui/attention.ts` vs 정책 | `renderAttention` 전체 cap은 6줄이다(`packages/pi-loop/src/ui/attention.ts:9-16`). | 초과 없음 |
| `compactFindings` vs 정책 | 반환 cap은 5개다(`packages/pi-loop/src/lead/reduce.ts:8-12`). | 초과 없음 |
| extension 진행 status vs exported status renderer | 진행 update는 private `renderSnapshot("status")`의 5개 항목을 사용한다(`packages/pi-loop/src/extension.ts:111-116`, `:325-332`). exported `renderStatus`는 최대 8줄이다(`packages/pi-loop/src/ui/status.ts:15-31`). | 출력 경로별 한도 불일치: 5개 vs 8줄 |
| extension attention vs exported attention renderer | extension 명령 경로는 attention ID를 최대 5개만 출력한다(`packages/pi-loop/src/extension.ts:322-324`). exported renderer는 options를 최대 3개 포함해 전체 6줄 cap을 둔다(`packages/pi-loop/src/ui/attention.ts:8-16`). | 출력 형식·한도 불일치: ID 5개 vs 구조화 6줄 |
| extension workers vs exported workers renderer | extension `renderSnapshot`은 active worker를 최대 7개 출력한다(`packages/pi-loop/src/extension.ts:318-321`). `renderWorkers`는 최대 8개 worker를 출력한다(`packages/pi-loop/src/ui/worker.ts:8-14`). | 출력 경로별 항목 한도 불일치: 7개 vs 8개 |
| extension graph vs exported graph renderer | extension graph branch는 task를 최대 7개 출력한다(`packages/pi-loop/src/extension.ts:315-317`). `renderGraph`에는 `slice`가 없다(`packages/pi-loop/src/ui/graph.ts:3-10`). | 출력 경로별 한도 불일치: 7개 vs source cap 없음 |
| summary 두 구현 | private `formatRunSummary`는 5개 배열 항목이다(`packages/pi-loop/src/extension.ts:304-311`). exported `renderRunSummary`는 반환 cap 8줄이다(`packages/pi-loop/src/ui/summary.ts:9-24`). | 함수·출력 경로 분리 및 한도 불일치: 5개 vs 8줄 cap |
| 명시된 정책 밖의 출력 | `loop models`는 모델 배열을 그대로 `\n` 연결하며 `slice`가 없다(`packages/pi-loop/src/extension.ts:129-131`). `renderGraph`도 `slice`가 없다(`packages/pi-loop/src/ui/graph.ts:3-10`). | status/attention/findings 정책과 직접 비교할 수 있는 cap 없음 |

따라서 현재 소스에서 정책 숫자보다 큰 cap을 가진 `status`, `attention`, `findings` 구현은 확인되지 않는다. 다만 policy에 직접 지정되지 않은 `models`·graph 경로는 소스상 줄 수 cap이 없고, extension private renderer와 exported `ui/` renderer 사이에는 위 표의 수치·형식 차이가 있다.

## 확인 범위와 한계

- `rg`로 `ui.notify`, `onUpdate`, `result`, `renderSnapshot`, `formatRunSummary`, `leadInstructions`, 다섯 `ui/` renderer, `compactFindings`의 정의·호출을 검색했다.
- `packages/pi-loop/src/herdr-lifecycle.ts:77-85`는 Pi lifecycle event를 Herdr sink에 연결한다. `packages/pi-loop/src/herdr-lifecycle.ts:87-101`의 child process는 stdout/stderr를 Pi UI에 직접 전달하는 코드가 없다. 이 감사에서 확인된 텍스트 출력 경로는 위 `extension.ts` 표의 tool result, notify, system prompt 경로다.
- 오류 경로는 child process stderr를 내부 문자열로 모은 뒤 reject한다(`packages/pi-loop/src/extension.ts:232-236`, `:266-271`). 이 source에는 해당 오류를 별도 `ui.notify`로 렌더링하는 호출이 없다.
- 이 감사는 정적 소스 조사만 수행했으며 테스트나 실제 provider/model 호출은 실행하지 않았다.
