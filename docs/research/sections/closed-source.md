# 리서치 fan-out 1/3: 상용/폐쇄소스 코딩 에이전트 하네스 조사

- 날짜: 2026-09-30
- 범위: Claude Code, OpenAI Codex CLI, Google Gemini CLI, Cursor Agent, Sourcegraph Amp, Warp Agent
- 방법: 각 벤더 공식 문서/릴리스 문서를 2026-09-30 기준 직접 조회해 근거로 사용 (아래 출처 링크)
- 분류 주의: Codex CLI(Apache-2.0)와 Gemini CLI(Apache-2.0)는 라이선스상 오픈소스지만, 퍼스트파티 상용 하네스라는 관점에서 이 섹션에 포함한다. 완전 오픈소스 서드파티 하네스는 2/3 섹션에서 다룬다.

## 비교 표

| 하네스 | 실행 모델(대화형/헤드리스) | 멀티모델 지원 | 서브에이전트·병렬 fan-out | 컨텍스트 관리 | 검증 메커니즘 | 확장성(MCP/스킬/훅) | 라이선스/가격 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Claude Code | 대화형 CLI·데스크톱·웹(Projects) + 헤드리스 `claude -p`(JSON/stream-json 출력, exit code, `--bare`) 및 Agent SDK(TS/Python) | Anthropic 모델만(fable/opus/sonnet/haiku 별칭, 1M 옵션). Bedrock·Foundry·Google Cloud's Agent Platform·LLM 게이트웨이 경유. "worker는 모두 Claude 세션" — 타 벤더 모델은 MCP 서버로만 접근 | 강함. 세션 내 서브에이전트(foreground/background, `.claude/agents` 정의, 에이전트별 모델 지정, 기본 동시 20 제한), 대화 fork(`/subtask`·`/fork`), agent view(`claude agents` 백그라운드 병렬), agent teams(실험, 리드+피어+공유 태스크 리스트), dynamic workflows(수십~수백 에이전트 스크립트 오케스트레이션, `/deep-research` 내장), worktree 격리, cross-session messaging | 자동 compaction(`/compact`), 툴 결과 정리, CLAUDE.md, 툴 스키마·스킬 지연 로딩(tool search), 서브에이전트 컨텍스트 격리(부모는 최종 요약만 수신) | hooks(PreToolUse/PostToolUse/Stop/Notification 등), permission 모드, 헤드리스 구조화 출력+exit 코드, GitHub Actions/GitLab CI 연동, 워크플로우 상호 교차검증(claim 투표 후 미통과 주장 필터), `--max-budget-usd` | MCP 클라이언트(+`claude mcp serve`로 서버 동작), 스킬(Agent Skills 오픈 표준, 커스텀 커맨드 통합), 플러그인+마켓플레이스, hooks, settings JSON | 독점. Pro/Max/Team/Enterprise 구독 + API 토큰 과금 병행. 기업 기준 평균 $13/개발자/일, $150–250/월 (공식 costs 문서) |
| Codex CLI | 대화형 TUI + `codex exec`(비대화형, 기본 읽기전용 샌드박스, `--json`), `codex cloud`, IDE 확장, ChatGPT 데스크톱 앱, app-server 프로토콜 | OpenAI GPT-6/6.1(Sol·Luna·Astra) 중심. `model_providers`로 OpenAI 호환 엔드포인트(OpenRouter/Fireworks 등) 연결, `--oss` 로컬 모델, Bedrock 문서 제공. 서브에이전트 파일별 모델/추론노력 지정 | 강함(기본 활성). multi-agent v2 서브에이전트 워크플로우, 내장 에이전트(default/worker/explorer), 커스텀 에이전트 TOML(`~/.codex/agents/`, `.codex/agents/`), `[agents]` 설정(동시 스레드 상한, 기본 서브에이전트 모델), `/agent` 스레드 전환, ChatGPT Work 클라우드에서 동일 지원 | `/compact` + 자동 compaction(`model_auto_compact_token_limit`), AGENTS.md, `/resume`, `/fork` | 샌드박스(읽기전용/workspace-write/danger-full-access), granular approval 정책, hooks(PreToolUse/PermissionRequest/PostToolUse/PreCompact/PostCompact/SessionStart/SessionEnd/SubagentStart/SubagentStop/Stop 등), Code Review 커스텀 룰, `codex exec --output-schema`·exit 코드 | MCP 클라이언트, 스킬(빌트인 카탈로그+호스트 공급), 플러그인(작성/배포/관리), 커스텀 프롬프트, rules, config.toml 프로파일 | CLI는 Apache-2.0(실행에 ChatGPT/API 계정 필요). ChatGPT Free/Plus/Pro($500)/Business/Enterprise/Edu 사용량 + 크레딧, 또는 API 키 |
| Gemini CLI | 대화형 + 헤드리스(`-p`, `--output-format json`/JSONL 스트리밍, exit 코드 0/1/42/53) | Gemini 3(1M 컨텍스트) 기본. `--model`→`GEMINI_MODEL`→settings.json 우선순위, 장애 시 모델 폴백 라우팅, 로컬 Gemma 라우팅(실험). 서브에이전트 정의 파일에 모델 개별 지정 가능 | 강함. 내장 서브에이전트(Codebase Investigator, CLI Help Agent, Generalist Agent, Browser Agent), 자동 위임 + `@` 구문 강제, 커스텀 서브에이전트 정의 파일(kind local/remote, tools 와일드카드 `mcp_*`, 인라인 mcpServers, model/max_turns/timeout_mins), `/agents` 관리, 격리·재귀 방지 | 체크포인팅(섀도 git 스냅샷+`/restore`), GEMINI.md, 긴 대화 압축, 1M 토큰 컨텍스트 | 툴 승인 다이얼로그/auto-accept, 샌드박스 문서, 헤드리스 exit 코드, 서브에이전트별 max_turns·timeout_mins 한도, telemetry | MCP 클라이언트, extensions(설치/배포), 커스텀 서브에이전트, settings.json | Apache-2.0. 개인 Google 계정 무료(60 RPM/1,000 RPD), Gemini API 키, Vertex AI, Code Assist 라이선스 |
| Cursor Agent | IDE + Agents Window(Cursor 3, 2026-04 GA, 멀티워크스페이스·병렬 클라우드 에이전트) + CLI(`agent -p` print 모드, `--output-format text/json/stream-json`, `--force`) + 클라우드 에이전트(웹/폰/Slack/GitHub/Linear) | 가장 넓음. Claude 4.x–4.7/Fable 5.1, GPT-5.6 Sol/Terra/Luna, Gemini 3.1 Pro/3.8 Flash, Grok 4.x, Composer 2.5, GLM 5.x, Kimi 등. Cursor Router가 Auto 요청 모델 선택(Teams+), 사용량 풀 2종 | 강함. 서브에이전트(에디터·CLI·클라우드 공통, 자동 위임+명시 호출, 커스텀 서브에이전트 파일, 모델 설정, foreground/background), 클라우드 서브에이전트(`/in-cloud`, `/autopilot`), explore 서브에이전트로 병렬 검색 10개 권장, Agents Window 병렬 에이전트, worktrees 격리 | 서브에이전트 컨텍스트 격리(부모는 최종 요약만), rules, 코드베이스 인덱싱, preCompact 훅(압축 존재) | hooks(before/afterShellExecution, pre/postToolUse, subagentStart/Stop, preCompact, stop, afterAgentResponse 등), run modes(보안), agent review, 브라우저 툴, 클라우드 웹훅 | MCP 클라이언트(mcp.json), 스킬(Agent Skills 오픈 표준), hooks, rules, commands | 독점. Pro $20/Pro Plus $60/Ultra $200, Teams $40·$120(사용자/월), 인도 전용 Start ₹649. 모델별 토큰 과금 병행 |
| Amp | CLI(TUI) + execute mode(`amp -x`, 파이프 입력, stdout 리다이렉트 시 자동 전환) + `-ox` 오브 실행 + runner(`amp --no-tui` 원격 실행) + 스트리밍 JSON + 웹·macOS·iOS 앱 | "Amp가 모델 선택"이 원칙. Dial 모드(low/medium/high/ultra)가 모델+추론노력+시스템프롬프트 묶음. BYOK model routing(Anthropic/OpenAI 키, ChatGPT 구독 연동), 모드별 라우팅 공개. 예: high 모드 = GPT-6 Astra(메인) + Claude Fable 5.1(oracle) | 강함. 스페셜리스트 서브에이전트(Search, Oracle, Librarian, Read Thread) 자동 선택(주로 medium), 플러그인으로 커스텀 서브에이전트, 서브에이전트 간 통신 불가(격리 설계). Orbs로 독립 태스크 병렬(클라우드 VM, 버스트 20개 후 5분당 1개 스폰 페이싱) | 서브에이전트별 독립 컨텍스트, 스레드 handoff(긴 작업 전 새 스레드+핵심 컨텍스트만 이월), 시스템 모델이 장기 대화 압축·스레드 이름 생성, 메인은 최종 요약만 수신 | 기본 툴 승인 없음(정책 플러그인으로 보강), oracle 세컨드 오피니 도구, 오브에서 end-to-end 실행·테스트 후 "증명"을 스레드에 기록, `amp usage`로 사용량 추적 | MCP 클라이언트(`--mcp-config` 포함), 스킬(빌트인+프로젝트/글로벌/퍼블리시), 플러그인(lifecycle 이벤트 `agent.start`/`agent.end`, 커스텀 모드·서브에이전트), AGENTS.md, SDK(TS/Python) | 독점. Hobby 무료, Individual $20/월, Megawatt/Gigawatt 상위 티어, Teams 추가금 없음. 크레딧 과금(개인·비기업은 API 정가 마진 없음), 오브는 분당 과금 |
| Warp Agent | Warp 터미널 앱(GUI) + Warp Agent CLI(`warp`, `--resume`) + Oz CLI(`oz agent run-cloud`) + 웹 앱 + API/SDK(완전 헤드리스) + 트리거(Slack/Linear/스케줄/CI) | 넓음. OpenAI/Anthropic/Google/xAI 큐레이션 + Auto 모델 + 커스텀 라우터(자체 로직), 모델 폴백 체인, 프로파일별 기본 모델, BYOK 및 커스텀 엔드포인트(OpenRouter/LiteLLM/z.ai) | 가장 플랫폼적. 부모 에이전트가 자식 스폰하는 오케스트레이션(앱 `/orchestrate`·`/plan` 승인 카드, CLI 승인 카드, API `mode: orchestrate` 또는 `parent_run_id` 명시 링크), 자식별 하네스·모델·환경(로컬/클라우드/셀프호스트) 지정, 지속성 agent-to-agent 메시징. 클라우드에서는 Claude Code·Codex도 하네스로 선택 가능 | 코드베이스 인덱싱(로컬, 코드는 서버 미저장), Warp Rules, Skills, Agent Memory(리서치 프리뷰 — 하네스 불문 공유 지속 메모리), handoff 시 대화 fork+미커밋 변경 스냅샷 이월 | Agent Profiles(자율성·툴·권한), 자식 스폰 승인 카드(기본 승인 필요), 코드 리뷰 패널·대화형 코드 리뷰, 브라우저/컴퓨터 사용 테스트, 런 트랜스크립트·대시보드 관측 | MCP(Streamable HTTP/SSE, 로컬/클라우드), 스킬(마크다운, 하네스 불문 적용), Rules, 팩토리(foreman), API/SDK | 독점. Free(클라우드는 Warp Agent만), Build 이상에서 서드파티 하네스, 크레딧+플랫폼 크레딧(에이전트 시간별), BYOK 지원 |

## 항목별 요약

### Claude Code
세션 내 서브에이전트에서 시작해 agent view→agent teams→dynamic workflows로 확장되는 5단 병렬 체계를 갖춘 것이 특징이다. 특히 dynamic workflows는 오케스트레이션을 JavaScript 스크립트(런타임 실행)로 옮겨 수십~수백 에이전트를 돌리고, 내장 `/deep-research`는 웹 검색 fan-out 후 소스를 교차검증하고 claim별 투표로 미통과 주장을 걸러낸다. 모델은 Anthropic 계열로 제한되며, 다른 도구는 MCP 서버로만 조합한다.
출처: [sub-agents](https://code.claude.com/docs/en/sub-agents), [parallel agents](https://code.claude.com/docs/en/agents), [workflows](https://code.claude.com/docs/en/workflows), [headless](https://code.claude.com/docs/en/headless), [model-config](https://code.claude.com/docs/en/model-config), [costs](https://code.claude.com/docs/en/costs), [skills](https://code.claude.com/docs/en/skills), [hooks](https://code.claude.com/docs/en/hooks-guide)

### OpenAI Codex CLI
서브에이전트 워크플로우가 기본 활성화되어 있고, 커스텀 에이전트를 일반 세션 설정 레이어(TOML)로 정의하는 무게감 있는 접근이 특징이다. 공식 문서는 fan-out의 동기를 "컨텍스트 오염(context pollution)·컨텍스트 부패(context rot)" 방지로 명시한다. CLI는 Apache-2.0이지만 실행·모델은 ChatGPT 플랜/API 크레딧에 묶이며, 샌드박스·approval·hooks로 검증을 강제한다.
출처: [subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents), [codex manual](https://learn.chatgpt.com/docs/codex-manual.md), [models](https://learn.chatgpt.com/docs/models), [pricing](https://learn.chatgpt.com/docs/pricing), [GitHub(openai/codex, Apache-2.0)](https://github.com/openai/codex)

### Gemini CLI
무료 한도가 가장 관대하고(60 RPM/1,000 RPD), 서브에이전트 정의 파일이 kind(local/remote)·도구 와일드카드·턴/시간 한도까지 갖춰 선언적이다. 체크포인팅이 파일 수정 직전 전체 프로젝트 상태를 섀도 git에 스냅샷해 `/restore`로 되돌리는 점이 검증 축에서 독특하다. 헤드리스는 JSONL 스트리밍과 명확한 exit 코드(42 입력 오류, 53 턴 한도)를 제공한다.
출처: [README](https://github.com/google-gemini/gemini-cli#readme), [subagents](https://github.com/google-gemini/gemini-cli/blob/main/docs/core/subagents.md), [headless](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/headless.md), [model routing](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/model-routing.md), [checkpointing](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/checkpointing.md), [MCP](https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md)

### Cursor Agent
모델 선택폭이 가장 넓고(경쟁사 자체 모델+타사 프론티어+오픈모델), Agents Window(Cursor 3)가 병렬 에이전트의 기본 작업대가 되었다. 서브에이전트가 에디터·CLI·클라우드 어디서든 동일하게 동작하며 `/in-cloud`·`/autopilot`으로 장기 작업을 클라우드 VM에 넘긴다. 훅 이벤트가 subagentStart/Stop까지 촘촘해 fan-out 관찰·검증 자동화에 유리하다.
출처: [subagents](https://cursor.com/docs/subagents), [agents window](https://cursor.com/docs/agent/agents-window), [CLI headless](https://cursor.com/docs/cli/headless), [models & pricing](https://cursor.com/docs/models-and-pricing), [hooks](https://cursor.com/docs/hooks), [skills](https://cursor.com/docs/skills), [MCP](https://cursor.com/docs/mcp)

### Sourcegraph Amp
"사용자가 모델을 고르지 않고, 작업 난이도 모드(Dial)를 고른다"는 독자적 철학이며 모델 라우팅을 제품의 1급 개념으로 승격시켰다. Search·Oracle·Librarian 같은 스페셜리스트 서브에이전트와, 노트북을 꺼도 돌아가는 클라우드 VM(Orb) 병렬 실행(버스트 20개 스폰 페이싱)이 fan-out의 두 축이다. 서브에이전트 간 통신을 의도적으로 차단하는 대신 메인 수신량을 최종 요약으로 제한한다.
출처: [models & subagents](https://ampcode.com/docs/models-and-subagents), [the dial](https://ampcode.com/docs/the-dial), [tools(oracle/librarian)](https://ampcode.com/docs/tools), [orbs](https://ampcode.com/docs/orbs), [execute mode](https://ampcode.com/docs/cli/execute-mode), [pricing](https://ampcode.com/pricing), [plugins](https://ampcode.com/docs/customize/plugins)

### Warp Agent
단일 하네스를 넘어 "에이전트 오케스트레이션 플랫폼"으로 확장한 사례다. 부모-자식 에이전트 모델이 앱·CLI·웹·API에서 동일하게 동작하고, 자식의 하네스까지 지정할 수 있으며(클라우드에서 Claude Code·Codex를 하네스로 실행), parent/child 대화와 산출물을 한 화면에서 관찰한다. Agent Memory가 하네스 불문 공유 지속 메모리(리서치 프리뷰)로 접근하는 점도 주목할 만하다.
출처: [multi-agent runs](https://docs.warp.dev/platform/orchestration/multi-agent-runs/), [CLI cloud & orchestration](https://docs.warp.dev/agents/cli/cloud-and-orchestration/), [harnesses](https://docs.warp.dev/platform/harnesses/), [model choice](https://docs.warp.dev/agents/inference/model-choice/), [agent memory](https://docs.warp.dev/agents/agent-memory/), [plans & pricing](https://docs.warp.dev/support-and-community/plans-and-billing/plans-pricing-refunds/)

## subagent fan-out 상세 (리서치/탐색 관점)

| 하네스 | fan-out 단위 | 스폰 방식 | 동시성 한도 | 결과 수집·검증 |
| --- | --- | --- | --- | --- |
| Claude Code | 세션 내 서브에이전트 / 백그라운드 세션 / 팀원 / 워크플로우 에이전트 | Task 도구 자동 위임, `/agents` 정의 파일, `/deep-research` 워크플로우, `claude agents` 디스패치, workflows JS 스크립트 | 동시 서브에이전트 기본 20(`CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`; ultracode 시 미적용) | 서브에이전트는 최종 요약만 반환. 워크플로우는 독립 에이전트 상호 적대 리뷰·claim 투표로 교차검증 후 미통과 주장 필터 |
| Codex CLI | 서브에이전트 스레드 | 메인 에이전트 SpawnRequest로 스폰(기본 활성), AGENTS.md/스킬 지시로 위임 요청, 커스텀 에이전트 TOML | `[agents] max_concurrent_threads_per_session` | 메인 스레드가 결과를 최종 응답으로 수집, `/agent`로 개별 스레드 관찰, 서브에이전터 완료 이벤트 보존 |
| Gemini CLI | 서브에이전트(로컬/리모트) | 자동 위임 또는 `@` 구문 강제, 정의 파일(kind remote 포함) | 에이전트별 max_turns(기본 30)·timeout_mins(기본 10), 도구 와일드카드 격리 | 각 서브에이전트가 부모 세션에 결과 반환, `/agents` 관리·재귀 방지 |
| Cursor Agent | 서브에이전트(foreground/background) + 클라우드 서브에이전트 + 병렬 에이전트 | 자동 위임, 명시 호출, `/in-cloud`·`/autopilot`, Agents Window에서 다수 에이전트 | 문서 미고정(탐색 서브에이전트는 10개 병렬 검색 권장) | 컨텍스트 격리 후 부모가 최종 요약 수신, subagentStart/Stop 훅으로 관찰, worktrees로 쓰기 격리 |
| Amp | 스페셜리스트 서브에이전트 + 오브 스레드 | 에이전트 자동 선택(주로 medium) 또는 사용자 지시 분할, 오브는 CLI `-ox`·웹·API에서 스폰 | 오브 버스트 20, 이후 5분당 1개 스폰 페이싱 | 서브에이전트 간 통신 차단, 메인은 요약만. 오브는 실행 증명(테스트·서비스 상태)을 스레드에 남기고 슬립 |
| Warp Agent | 자식 에이전트(로컬/클라우드, 하네스 선택 가능) | `/orchestrate`·`/plan` 승인 카드, "split this across three agents" 자연어, `oz agent run-cloud`, API `mode: orchestrate`/`parent_run_id` | 승인 카드·프로파일 권한으로 게이트(Always allow/Never 설정 가능) | 부모-자식 메시징은 지속성 플랫폼 큐로 중계, 필 바·탭 바로 상태 관찰, 런 트랜스크립트 저장 |

## Loop 관련 시사점

1. **fan-out은 이제 하네스 표준 기능**: 구현 패턴은 세 가지로 수렴한다 — 세션 내 서브에이전트(Claude/Codex/Gemini/Cursor/Amp), 스크립트 워크플로우(Claude dynamic workflows), 플랫폼 오케스트레이션(Warp, Amp Orbs). Loop의 task DAG 방식은 세 번째 계열과 같은 방향이다.
2. **검증 축의 모범 사례는 "교차검증"**: Claude `/deep-research`의 소스 교차확인+claim 투표, Amp 오브의 "증명 남기기", Codex의 `--output-schema`+exit 코드가 리서치 완료 계약 설계의 참고점이다.
3. **컨텍스트 격리가 fan-out의 1차 동기**: OpenAI는 context rot/pollution, Anthropic은 "메인 컨텍스트는 최종 답만"으로 동기를 문서화한다. Loop의 "worker 결과는 completion contract로만 수신" 원칙과 일치한다.
4. **모델 라우팅 추상화가 업계 표준화 중**: Amp Dial(모드=모델 묶음), Warp Auto/커스텀 라우터, Cursor Router 모두 "리터럴 모델명이 아닌 정책 선택"이다. Loop의 compute class 정책과 같은 방향이며, 서브에이전트별 모델 상향/하향(에스컬레이션)도 여섯 하네스 모두 지원한다.
5. **동시성은 항상 상한으로 관리**: Claude(20 기본), Codex(설정), Gemini(턴/시간), Amp(스폰 페이싱), Warp(승인 게이트) — Loop 스케줄러의 동시성 상한도 문서화된 기본값을 갖는 편이 운영에 유리하다.

## 미확인·한계

- 가격 중 Amp Megawatt/Gigawatt 금액, Warp 플랜별 크레딧 단가는 마케팅 페이지가 JS 렌더링이라 문서에서 정수 확인 불가 — 표에는 등급 구조만 기재.
- Cursor의 자체 컨텍스트 압축 세부(compression 임계값 등)는 공개 문서에 명시적 서술이 약하고, preCompact 훅 존재로만 간접 확인.
- 문서는 2026-09-30 스냅샷이며 하네스 변화가 매우 빠름(특히 Warp 플랫폼·Amp Orbs는 최근 수개월 내 대규모 변경).
