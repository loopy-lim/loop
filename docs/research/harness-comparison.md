# 코딩 에이전트 하네스 비교 — 최종 통합 보고서 (Loop 대비)

- 조사일: 2026-09-30
- 대상 12개 하네스: **상용/퍼스트파티 6** (Claude Code, OpenAI Codex CLI, Gemini CLI, Cursor Agent, Sourcegraph Amp, Warp Agent) + **오픈소스/서드파티 6** (Aider, OpenCode, Cline, Roo Code, OpenHands, Block Goose)
- 방법: 각 하네스의 공식 문서·공식 저장소를 1차 소스로 직접 조회했다. 본 보고서는 fan-out 리서치 3편(상용 섹션, 오픈소스 섹션, Loop 자체 분석)과 기존 초안을 통합·중복 제거한 최종본이다.
- 원본 섹션 (상세 근거·전체 표는 각 섹션 보존):
  - 1/3 상용·폐쇄소스: [sections/closed-source.md](sections/closed-source.md) — Codex CLI·Gemini CLI는 Apache-2.0이지만 퍼스트파티 상용 하네스로 이쪽에 분류
  - 2/3 오픈소스·서드파티: [sections/open-source.md](sections/open-source.md)
  - 3/3 Loop 자체 분석: [sections/loop-analysis.md](sections/loop-analysis.md)
- 한계: 실제 실행·벤치마크를 하지 않았다. 각 하네스가 공식 문서에서 *말하는* 기능이며 실측 품질·속도와는 별개다. 문서는 2026-09-30 스냅샷이다. Loop 측 서술 근거: [README](../../README.md), [architecture](../architecture.md), [model-routing](../model-routing.md), [provider-support](../provider-support.md), `config/models.toml`, `config/policy.toml`.

## 1. 전체 비교 표 (하네스 × 비교 축)

| 하네스 | 실행 모델(대화형/헤드리스) | 멀티모델 지원 | 서브에이전트·병렬 fan-out | 컨텍스트 관리 | 검증 메커니즘 | 확장성(MCP/스킬/훅) | 라이선스/가격 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Claude Code (상용) | 대화형 CLI·데스크톱·웹 + 헤드리스 `claude -p`(JSON/stream-json, exit 코드, `--bare`)·Agent SDK(TS/Python) | Anthropic 전용(fable/opus/sonnet/haiku, 1M 옵션). 타 벤더 모델은 MCP 서버로만 접근 | 강함. 서브에이전트(기본 동시 20, 에이전트별 모델), 대화 fork, agent teams(실험), dynamic workflows(JS 스크립트 오케스트레이션, `/deep-research` 내장), 백그라운드 병렬(`claude agents`) | 자동 compaction(`/compact`), CLAUDE.md, 툴 스키마 지연 로딩, 서브에이전트 격리(부모는 최종 요약만) | hooks(PreToolUse/PostToolUse/Stop 등, 결정 JSON), permission 모드, 워크플로우 교차검증(claim 투표), `--max-budget-usd` | MCP(+서버 동작), Agent Skills 오픈 표준, 플러그인+마켓플레이스, 훅 | 독점. Pro/Max/Team/Enterprise 구독 + API 토큰 |
| Codex CLI (상용) | TUI + `codex exec` 비대화형(기본 읽기전용 샌드박스, `--json`), `codex cloud`, IDE 확장, app-server 프로토콜 | GPT-6/6.1(Sol·Luna·Astra) 중심. `model_providers`로 OpenAI 호환 엔드포인트, `--oss` 로컬, 서브에이전트별 모델 지정 | 강함(기본 활성). multi-agent v2, 내장(default/worker/explorer) + 커스텀 에이전트 TOML, 동시 스레드 상한 설정, `/agent` 스레드 전환 | `/compact` + 자동 compaction(`model_auto_compact_token_limit`), AGENTS.md, `/resume`·`/fork` | 샌드박스 3단계 + granular approval, hooks(SubagentStart/Stop 등), Code Review 커스텀 룰, `--output-schema` + exit 코드 | MCP, 스킬(빌트인 카탈로그), 플러그인, 커스텀 프롬프트·rules | CLI는 Apache-2.0(실행은 ChatGPT/API 계정 필요). Free~Pro($500)/Enterprise |
| Gemini CLI (상용) | 대화형 + 헤드리스(`-p`, JSON/JSONL 스트리밍, exit 0/1/42/53) | Gemini 3(1M 컨텍스트). `--model`→settings 우선순위, 장애 시 모델 폴백 라우팅, 로컬 Gemma(실험) | 강함. 내장 서브에이전트(Investigator/Generalist/Browser 등), 자동 위임 + `@` 강제, 커스텀 정의 파일(kind local/remote, 턴/시간 한도), 재귀 방지 | 체크포인팅(섀도 git 스냅샷 + `/restore`), GEMINI.md, 긴 대화 자동 압축 | 툴 승인 다이얼로그/auto-accept, 헤드리스 exit 코드, 서브에이전트별 max_turns(30)·timeout(10분), telemetry | MCP, extensions, 커스텀 서브에이전트, settings.json | Apache-2.0. 개인 Google 계정 무료(60 RPM/1,000 RPD), Vertex/Code Assist 유료 |
| Cursor Agent (상용) | IDE + Agents Window(병렬 클라우드 에이전트) + CLI(`agent -p` print 모드, text/json/stream-json) + 클라우드 에이전트(웹/폰/Slack/Linear) | 가장 넓음(Claude/GPT/Gemini/Grok/Composer/GLM/Kimi). Cursor Router가 Auto 선택, 사용량 풀 2종 | 강함. 서브에이전트(에디터·CLI·클라우드 공통, 자동 위임+명시 호출, 커스텀 파일, fg/bg), 클라우드 서브에이전트(`/in-cloud`·`/autopilot`), 탐색 병렬 10개 권장 | 서브에이전트 격리(요약만 수신), rules 4종, 코드베이스 인덱싱, preCompact 훅 | 훅(before/afterShellExecution, subagentStart/Stop, preCompact 등), run modes, agent review | MCP(mcp.json), Agent Skills, hooks, rules, commands | 독점. Pro $20/Pro Plus $60/Ultra $200, Teams $40·$120, 토큰 병행 |
| Amp (상용) | CLI(TUI) + execute mode(`amp -x`) + `-ox` 오브 실행 + runner + 스트리밍 JSON + 웹·macOS·iOS | "Amp가 모델 선택" 원칙. Dial 모드(low~ultra)가 모델+추론노력 묶음. BYOK 라우팅, 예: high = GPT-6 Astra + Claude Fable 5.1(oracle) | 강함. 스페셜리스트 서브에이전트(Search/Oracle/Librarian) 자동 선택, 서브에이전트 간 통신 차단(격리 설계), Orbs(클라우드 VM 병렬, 버스트 20 후 페이싱) | 서브에이전트별 독립 컨텍스트, 스레드 handoff, 시스템 모델 장기 대화 압축, 메인은 요약만 | 기본 툴 승인 없음(정책 플러그인 보강), oracle 세컨드 오피니, 오브가 실행·테스트 "증명" 기록 | MCP, 스킬, 플러그인(lifecycle 이벤트, 커스텀 모드·서브에이전트), AGENTS.md, SDK | 독점. Hobby 무료/Individual $20/상위 티어, 크레딧 과금, 오브 분당 |
| Warp Agent (상용) | 터미널 앱 + Agent CLI(`warp`) + Oz CLI(클라우드) + 웹 + API/SDK + 트리거(Slack/Linear/스케줄/CI) | OpenAI/Anthropic/Google/xAI 큐레이션 + Auto 모델 + 커스텀 라우터, 모델 폴백 체인, BYOK·커스텀 엔드포인트 | 가장 플랫폼적. 부모-자식 오케스트레이션(승인 카드, API `mode: orchestrate`/`parent_run_id`), 자식별 하네스·모델·환경 지정 — 클라우드에서 Claude Code·Codex를 하네스로 구동 | 코드베이스 인덱싱, Rules·Skills, Agent Memory(하네스 불문 공유 메모리, 프리뷰), handoff 시 대화 fork + 변경 스냅샷 | Agent Profiles(자율성·권한), 자식 스폰 승인 카드, 코드 리뷰 패널, 런 트랜스크립트·대시보드 | MCP(Streamable HTTP/SSE), 스킬(하네스 불문), Rules, 팩토리(foreman), API/SDK | 독점. Free(자체 하네스만)/Build 이상에서 서드파티 하네스, 크레딧 |
| Aider (오픈소스) | 대화형 터미널 페어프로그래머 + 원샷 헤드리스(`--message`/`--message-file`, 처리 후 exit), Python API | 거의 모든 LLM. architect+editor 2단 순차 파이프라인. 권장 모델 문서가 구세대(Claude 3.7/GPT-4o) | **없음** — 단일 대화 단일 프로세스 설계. 병렬은 프로세스 여러 개 수동 실행뿐 | repo map(tree-sitter), `/add`·`/drop`, watch files | 자동 git 커밋(diff·revert 검증), `--lint-cmd`/`--test-cmd` 실패 감지 시 자동 수정 재시도 | YAML 설정, 커스텀 chat-mode. **MCP·스킬·훅 미지원** | Apache-2.0 무료. BYOK |
| OpenCode (오픈소스) | TUI + 데스크톱 + IDE 확장 + `opencode run` + `opencode serve` 헤드리스 HTTP(OpenAPI 3.1) + TS SDK | 75+ 프로바이더(models.dev), 로컬, OpenCode Zen(종량제). 에이전트별 model/temperature 지정 | 강함. primary(Build/Plan) + subagent(General 병렬, Explore 읽기전용, Scout) + 숨은 시스템 에이전트(compaction/title/summary), 자동 위임·`@` 멘션 | hidden compaction 에이전트가 자동 압축, AGENTS.md rules, 부모-자식 세션 격리 | permission 시스템(ask/allow/deny + glob, 예: `rm *`: deny), Plan 읽기전용, 내장 LSP·포매터 | MCP, Agent Skills, 플러그인(lifecycle 이벤트), 커스텀 툴, ACP | MIT 무료. Zen 종량제 |
| Cline (오픈소스) | VS Code·JetBrains 확장 + CLI(`cline`, `--json`/파이프 시 자동 헤드리스) + TUI + Desktop + Kanban + ACP | Cline Provider 또는 BYO key 30+, 엔터프라이즈 원격 설정으로 프로바이더 통제 | 강함. `use_subagents` 리서치 서브에이전트(기본 활성, 읽기전용·토큰 예산·리포트만 반환, 중첩 스폰 차단) + CLI 한정 Agent Teams(코디네이터+공유 보드+메일박스) | Plan/Act 이중 모드, Memory Bank, 스킬 progressive loading | 체크포인트(툴 사용마다 섀도 git 스냅샷), Plan 모드 쓰기 차단, 세분화 auto-approve 토글, OpenTelemetry | MCP(+마켓플레이스), 스킬, 훅(SDK 플러그인), ClineCore SDK | Apache-2.0. 확장 무료(BYO key) |
| Roo Code (오픈소스) | VS Code 확장 중심 — **공식 CLI/헤드리스 없음**, 병렬은 worktrees 다중 인스턴스 | 30+ 프로바이더, 모드별 모델 할당(Architect=Gemini, Code=Sonnet 식) | 중간. Boomerang Tasks(🪃 Orchestrator)가 `new_task`로 서브태스크 위임 — 부모 일시정지·요약만 복귀하는 **직렬 계층** (진짜 병렬 fan-out 아님) | Intelligent Context Condensing(임계 근접 시 AI 요약, 기본 활성), 코드베이스 인덱싱, .rooignore | 체크포인트(파일 수정 전 섀도 git), 서브태스크 승인 게이트, Orchestrator 모드 읽기 제한(context poisoning 방지) | MCP(+마켓플레이스), 스킬(.roo/skills), 커스텀 모드, 슬래시 커맨드 | Apache-2.0 무료. BYOK |
| OpenHands (오픈소스) | Agent Canvas(브라우저 컨트롤 센터) + CLI(`--headless -t`, `--json` JSONL) + Cloud + Enterprise + ACP 에이전트 | LiteLLM 경유 100+, LLM 프로파일, 로컬. "Bring your own model" | 약함(단일 대화 기준). 네이티브 fan-out 없음 — 실험적 툴 병렬(`tool_concurrency_limit`, 기본 1). 대신 ACP로 Claude Code·Codex·Gemini CLI 위임 | Condenser 시스템(NoOp/LLM 요약/파이프라인), 스킬 4종 트리거, microagents | SecurityAnalyzer(실행 전 리스크 평가), confirmation mode, Docker/VM/Modal 샌드박스, CLI critic, JSONL을 CI에서 파싱 | MCP, 스킬(.cursorrules/AGENTS.md 호환), 플러그인, Python SDK, ACP | MIT 무료. Cloud/Enterprise 유료 |
| Goose (오픈소스) | 데스크톱 앱 + CLI + API(Rust 네이티브). `goose run --recipe` 헤드리스, text/json/stream-json 출력 | 15+ 프로바이더, ACP로 Claude·ChatGPT·Gemini 구독 사용, 서브레시피별 모델 지정 | **가장 강함(오픈소스)**. 서브에이전트(자율 스폰, 자연어 병렬 지정, 25턴/5분 한도) + YAML 서브레시피 + 외부 서브에이전트(Codex·Claude Code를 MCP 서버로 구동) | Smart Context Management(토큰 80% 도달 시 자동 압축, 오래된 툴 출력 요약, `compaction.md` 템플릿) | 권한 시스템(allowlist), adversary mode(프롬프트 인젝션 테스트), 인젝션 탐지, 훅으로 셸 명령 후 검사 | MCP-first(70+ 익스텐션), 스킬, 훅(Open Plugins), 레시피/서브레시피, GDK/SDK | Apache-2.0 무료. Linux Foundation AAIF 소속 |

## 2. subagent fan-out 비교

### 2.1 fan-out 상세 표 (리서치/탐색 관점)

| 하네스 | fan-out 단위 | 스폰 방식 | 동시성/한도 | 결과 수집·검증 |
| --- | --- | --- | --- | --- |
| Claude Code | 세션 내 서브에이전트 / 백그라운드 세션 / 팀원 / 워크플로우 에이전트 | Task 도구 자동 위임, `/agents` 정의 파일, `/deep-research` 워크플로우, workflows JS 스크립트 | 동시 서브에이전트 기본 20(`CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`) | 서브에이전트는 최종 요약만 반환. 워크플로우는 상호 적대 리뷰·claim 투표로 교차검증 후 미통과 주장 필터 |
| Codex CLI | 서브에이전트 스레드 | 메인 에이전트 SpawnRequest(기본 활성), AGENTS.md/스킬 지시, 커스텀 에이전트 TOML | `[agents] max_concurrent_threads_per_session` | 메인 스레드가 결과 수집, `/agent`로 개별 스레드 관찰. fan-out 동기를 공식 문서가 "context pollution/rot 방지"로 명시 |
| Gemini CLI | 서브에이전트(로컬/리모트) | 자동 위임 또는 `@` 구문 강제, 정의 파일(kind remote 포함) | 에이전트별 max_turns(기본 30)·timeout_mins(기본 10) | 각 서브에이전트가 부모에 결과 반환, `/agents` 관리·재귀 방지 |
| Cursor Agent | 서브에이전트(fg/bg) + 클라우드 서브에이전트 + 병렬 에이전트 | 자동 위임, 명시 호출, `/in-cloud`·`/autopilot`, Agents Window | 문서 미고정(탐색 서브에이전트 10개 병렬 권장) | 컨텍스트 격리 후 요약 수신, subagentStart/Stop 훅으로 관찰, worktrees로 쓰기 격리 |
| Amp | 스페셜리스트 서브에이전트 + 오브 스레드 | 에이전트 자동 선택 또는 사용자 지시 분할, 오브는 `-ox`·웹·API | 오브 버스트 20, 이후 5분당 1개 스폰 페이싱 | 서브에이전트 간 통신 차단, 메인은 요약만. 오브는 실행 증명(테스트·서비스 상태)을 스레드에 기록 |
| Warp Agent | 자식 에이전트(로컬/클라우드, **하네스 선택 가능**) | `/orchestrate`·`/plan` 승인 카드, 자연어 분할 지시, API `mode: orchestrate`/`parent_run_id` | 승인 카드·프로파일 권한으로 게이트 | 부모-자식 메시징은 플랫폼 큐 중계, 런 트랜스크립트 저장·관찰 |
| Aider | 없음 | — | — | — (프로세스 여러 개 수동 실행이 유일한 병렬 수단) |
| OpenCode | 서브에이전트(자식 세션) | primary 에이전트 자동 위임, `@` 멘션 명시 호출 | 문서에 고정 상한 없음(General은 "병렬 작업 단위"용) | 자식 세션이 결과 반환, 부모-자식 세션 탐색 키바인딩, 세션별 summary 에이전트 |
| Cline | 리서치 서브에이전트 / 팀 에이전트 | `use_subagents` 툴(기본 활성), `cline --team-name` 코디네이터 | 문서에 고정 상한 없음, 서브에이전트별 토큰·비용 추적 | "다음에 읽을 파일 경로 중심 리포트"만 반환, 읽기전용·MCP 차단으로 검증 표면 최소화 |
| Roo Code | 서브태스크(계층, 직렬) | Orchestrator 모드 `new_task`, 모드 지정 위임 | 부모 일시정지로 사실상 1동시(계층 누적은 가능) | `attempt_completion`의 result 요약만 복귀, 생성/완료 승인 게이트, 컨텍스트 완전 격리 |
| OpenHands | 없음(툴 병렬만) | SDK `tool_concurrency_limit` > 1(실험적, 기본 1) | 툴 동시성 기본 1, 대화 자체는 1개 | 병렬 툴 결과도 동일 이벤트 스트림으로 귀환, headless `--json` JSONL을 CI에서 파싱 |
| Goose | 내부 서브에이전트 / 서브레시피 / 외부 에이전트 | 자율 스폰, 자연어 "in parallel", 레시피 참조, Codex 등을 MCP 서버화 | 최대 턴 25(`GOOSE_SUBAGENT_MAX_TURNS`), 타임아웃 5분 기본 | 실행 요약(total/success/failed) 반환, **실패 서브에이전트는 결과 없음·성공분만 수집**, 툴 호출 `[subagent:N]` 인라인 관찰 |

### 2.2 수렴 패턴

1. **fan-out은 이제 하네스 표준 기능**이며 구현은 세 계열로 수렴한다 — 세션 내 서브에이전트(Claude/Codex/Gemini/Cursor/Amp/Goose/Cline/OpenCode), 스크립트 워크플로우(Claude dynamic workflows, Goose 레시피), 플랫폼 오케스트레이션(Warp, Amp Orbs). Loop의 task DAG는 세 번째 계열과 같은 방향이다.
2. **오픈소스는 구현 깊이가 3등급으로 갈린다**: 네이티브 병렬(Goose, Cline, OpenCode), 직렬 계층(Roo, Aider 없음), 인프라 위임(OpenHands).
3. **컨텍스트 격리가 fan-out의 1차 동기**: OpenAI는 context rot/pollution, Anthropic·Cursor·Cline은 "메인은 최종 요약만"으로 문서화. Loop의 "worker 결과는 completion contract로만 수신" 원칙과 일치하며, 리서치 서브에이전트는 "읽기전용 + 요약 반환"으로 수렴한다.
4. **검증 모범 사례는 교차검증**: Claude `/deep-research` 소스 교차확인+claim 투표, Amp 오브의 "증명 남기기", Codex `--output-schema`+exit 코드, Goose의 실패 서브에이전트 탈락 처리가 리서치 완료 계약 설계의 참고점이다.
5. **동시성은 항상 상한으로 관리**된다: Claude(20 기본), Codex(설정), Gemini(턴/시간), Amp(스폰 페이싱), Warp(승인 게이트), Goose(25턴/5분) — Loop 스케줄러의 동시성 상한도 문서화된 기본값을 갖는 편이 운영에 유리하다.

## 3. Loop 대비 강점

근거: [sections/loop-analysis.md](sections/loop-analysis.md), [README](../../README.md), [architecture](../architecture.md)

1. **사전 검증되는 그래프가 오케스트레이션의 1급 단위.** 의존성 사이클 거절, decision/integration 직렬화, 쓰기 범위 겹침 금지가 실행 전 코어 불변식이다. 타 하네스의 서브에이전트는 "모델이 판단하면 스폰"하는 런타임 자발 구조가 기본이며(Warp의 parent/child가 가장 근접하나 부모 재량에 맡겨진다), 부모 재량을 구조가 보증하지 않는다.
2. **완료가 실행 증거로 강제된다.** 완료 계약(completion check) 전부 통과 없이 `Done`이 불가능하고, `Running → Verifying → Done`에서 검증 실패는 시도 증가 + compute class 1단계 승격으로 이어진다. 조사한 12개 중 "완료 선언을 검사 출력으로 강제"하는 하네스는 없었다. OpenHands Critic은 방향이 유사하나 예측 기반이지 실행 증거 기반이 아니다.
3. **모델이 아니라 클래스가 계약이다.** compute class(deterministic~frontier) 추상화 덕에 라우팅 전환이 `config/models.toml` 프로필 교체만으로 적용되고, 왜 바뀌었는지가 결정 문서로 추적된다. Amp Dial·Warp Auto·Cursor Router도 "리터럴 모델명이 아닌 정책 선택"으로 같은 방향이지만, 요청 단위 auto 선택은 "왜 이 클래스인가"를 흐린다.
4. **이벤트 로그 권위 + 라이브 재조정으로 재시작을 정의한다.** SQLite 이벤트 로그 재생 후 라이브 워커 관찰로 `Running`을 재판정하고 소유권 임대가 늦은 결과·중복 배정을 거절한다. 세션 체크포인트(타 하네스 표준)와 달리 실행 중 오케스트레이션 상태의 신뢰 재구축은 Loop 고유다.
5. **공급자 이질성을 하나의 계약으로 흡수한다.** `AgentProvider` 계약 하나로 Codex/AGY/Z.AI/Pi/fake를 정규화하고 실패 유형을 타입으로 구분한다. OpenHands의 ACP 위임·Warp의 cross-harness·Goose의 외부 서브에이전트가 같은 문제의 선행 사례다.
6. **경계가 구조로 이중 잠금이고, 사람 개입이 게이트로 모델링된다.** 코어의 provider 무지가 `bun run test:architecture`로 검증되고, attention이 열려 있으면 새 claim이 멈춘다. 승인 UI(Cline/Roo)·훅(Claude Code)과 달리 "언제 멈춰야 하는가"가 상태 기계에 있다.

## 4. Loop 대비 격차

1. **리서치 fan-out이 구조적 기본값이 아니다 (최대 격차).** fan-out은 Lead 페르소나 스탠딩 규칙(재량)이라 intent→DAG 분해가 LLM 재량에 남아 있고, 단일 워커 몰아주기가 여전히 가능하다. 대비: Claude `/deep-research`, Codex multi-agent(기본 활성), Cursor 병렬 탐색 10개는 제품 기본값이다. 완화: 리서치 kind task 분해 가이드 또는 소스 다양성 completion check.
2. **컨텍스트 관리가 없다.** compaction/condensation 부재 — 긴 worker 출력·재시도 문맥이 그대로 쌓인다. 대비: OpenHands Condenser, Roo Intelligent Condensing, Goose 80% 임계 자동 압축, Gemini CLI 이력 압축, Claude Code compaction 훅.
3. **확장 생태계 표준이 없다.** MCP·스킬·플러그인 표준이 Loop 자체에 없다(도구 확장은 Pi/어댑터 레벨). 조사 하네스에서 MCP 미지원은 Aider뿐 — 사실상 표준 미편입은 생태계 격차다. 어댑터 레벨 선별 채택이 경계를 지키는 방법이다.
4. **라이프사이클 훅이 외부에 노출되지 않는다.** 검증은 completion check로 강하지만 실행 중 개입 지점이 steer/attention뿐이다. 대비: Claude Code 훅 체계(결정 JSON), Codex·Cursor의 subagentStart/Stop 훅.
5. **typed task 계약의 고정 비용이 작은 작업에도 든다.** 단일 노드 fast path가 없어 즉흥적 위임·경량 fan-out이 계약 작성 비용을 요구한다.
6. **관찰성이 텍스트 라인 중심이다.** `loop status/watch`와 compact 예산은 있으나 트랜스크립트 재생·부모/자식 그래프 시각화는 없다. 대비: Warp Runs 대시보드, Amp 스레드 공유.
7. **리서치 결과의 교차검증 계약이 표준화되어 있지 않다.** 완료 계약이 형식적 grep/파일 존재 검사로 퇴화하기 쉽다. 대비: Claude claim 투표, Amp 오브 증명.
8. **가격/배포 모델이 없다.** 조사 대상 중 오픈소스 6개(Apache/MIT), 구독형 6개인 시장에서 사내 저장소의 기여·채택 경로는 별도 결정 사항. Goose의 Linux Foundation AAIF 이관은 "중립 하네스" 거버넌스 참고 사례다.

### 옮길 만한 것 (우선순위 순)

1. **리서치 fan-out 기본화의 구조화** — 페르소나 규칙을 넘어 리서치 kind 분해 가이드라인과 단일 워커 몰아주기 완화(소스 다양성 completion check). DAG 계약은 유지된다.
2. **컨텍스트 condensation 설계 조사** — OpenHands Condenser·Claude Code compaction의 "무엇을 버리고 무엇을 보호하는지" 명시 계약을 worker 재시도 문맥과 Lead 상태 예산에 적용.
3. **최소 라이프사이클 훅** — completion check는 유지한 채 worker 도구 호출 경계에 외부 검사기 이벤트 지점 추가. 코어가 아닌 어댑터 경계에 둔다.
4. **서브에이전트 "요약만 반환" 규칙** — findings 5줄 예산과 결합하면 Cursor/Claude Code의 컨텍스트 격리 이득을 그대로 이월한다.
5. **MCP 지점의 선별 채택** — 어댑터 레벨에서만. 코어에 MCP 개념을 넣는 것은 경계 위반이다(AGENTS.md 의존성 방향 준수).

### 그대로 옮기지 않을 것

- **모델 재량 서브에이전트 스폰**: 쓰기 겹침 방지·직렬화 보장을 우회한다. fan-out이 필요하면 Lead가 그래프를 넓히는 방향이 계약을 유지한다.
- **요청 단위 auto 모델 라우팅**: 클래스 선택 이유가 흐려진다. 정적 프로필 + 결정적 사다리의 추적성이 자산이다.
- **클라우드 orb/런타임 이전(Amp orb, Warp Handoff)**: 멀티머신 요구가 실측되기 전에는 복잡성 대비 근거가 없다.

## 5. 출처 링크

섹션 원본(전체 인용): [sections/closed-source.md](sections/closed-source.md) · [sections/open-source.md](sections/open-source.md) · [sections/loop-analysis.md](sections/loop-analysis.md)

- **Claude Code** — [sub-agents](https://code.claude.com/docs/en/sub-agents) · [parallel agents](https://code.claude.com/docs/en/agents) · [workflows](https://code.claude.com/docs/en/workflows) · [headless](https://code.claude.com/docs/en/headless) · [hooks](https://code.claude.com/docs/en/hooks-guide) · [memory](https://code.claude.com/docs/en/memory) · [costs](https://code.claude.com/docs/en/costs)
- **Codex CLI** — [subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents) · [codex manual](https://learn.chatgpt.com/docs/codex-manual.md) · [models](https://learn.chatgpt.com/docs/models) · [GitHub(openai/codex, Apache-2.0)](https://github.com/openai/codex)
- **Gemini CLI** — [README](https://github.com/google-gemini/gemini-cli#readme) · [subagents](https://github.com/google-gemini/gemini-cli/blob/main/docs/core/subagents.md) · [headless](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/headless.md) · [checkpointing](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/checkpointing.md) · [model routing](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/model-routing.md)
- **Cursor** — [subagents](https://cursor.com/docs/subagents) · [agents window](https://cursor.com/docs/agent/agents-window) · [CLI headless](https://cursor.com/docs/cli/headless) · [models & pricing](https://cursor.com/docs/models-and-pricing) · [hooks](https://cursor.com/docs/hooks)
- **Amp** — [models & subagents](https://ampcode.com/docs/models-and-subagents) · [the dial](https://ampcode.com/docs/the-dial) · [orbs](https://ampcode.com/docs/orbs) · [execute mode](https://ampcode.com/docs/cli/execute-mode) · [pricing](https://ampcode.com/pricing)
- **Warp** — [multi-agent runs](https://docs.warp.dev/platform/orchestration/multi-agent-runs/) · [harnesses](https://docs.warp.dev/platform/harnesses/) · [model choice](https://docs.warp.dev/agents/inference/model-choice/) · [agent memory](https://docs.warp.dev/agents/agent-memory/)
- **Aider** — [README](https://github.com/Aider-AI/aider) · [scripting](https://aider.chat/docs/scripting.html) · [chat modes](https://aider.chat/docs/usage/modes.html) · [LLMs](https://aider.chat/docs/llms.html)
- **OpenCode** — [저장소(anomalyco/opencode, MIT)](https://github.com/anomalyco/opencode) · [agents](https://opencode.ai/docs/agents/) · [server](https://opencode.ai/docs/server/) · [permissions](https://opencode.ai/docs/permissions/)
- **Cline** — [저장소(cline/cline, Apache-2.0)](https://github.com/cline/cline) · [subagents](https://docs.cline.bot/features/subagents) · [agent teams](https://docs.cline.bot/cli/agent-teams) · [checkpoints](https://docs.cline.bot/core-workflows/checkpoints)
- **Roo Code** — [저장소(RooCodeInc/Roo-Code, Apache-2.0)](https://github.com/RooCodeInc/Roo-Code) · [boomerang tasks](https://roocodeinc.github.io/Roo-Code/features/boomerang-tasks/) · [condensing](https://roocodeinc.github.io/Roo-Code/features/intelligent-context-condensing/)
- **OpenHands** — [저장소(OpenHands/OpenHands, MIT)](https://github.com/OpenHands/OpenHands) · [headless](https://docs.openhands.dev/openhands/usage/cli/headless) · [condenser](https://docs.openhands.dev/sdk/arch/condenser) · [parallel tool execution](https://docs.openhands.dev/sdk/guides/parallel-tool-execution)
- **Goose** — [저장소(block/goose → aaif-goose/goose, Apache-2.0)](https://github.com/block/goose) · [subagents](https://goose-docs.ai/docs/guides/context-engineering/subagents) · [subrecipes](https://goose-docs.ai/docs/guides/recipes/subrecipes) · [smart context](https://goose-docs.ai/docs/guides/sessions/smart-context-management)

미확인·한계: Amp 상위 티어 금액·Warp 플랜별 크레딧 단가·OpenHands Cloud 가격 등은 JS 렌더링 페이지로 정수 확인 불가(등급 구조만 기재). Cline·OpenCode 서브에이전트 동시성 수치는 문서 미고정. Goose 서브에이전트·서브레시피는 공식적으로 experimental. opencode/OpenHands/Goose는 최근 수개월 내 소속 변경이 커서 링크 유효성이 짧을 수 있다.

## 6. 핵심 시사점 (5줄 요약)

1. 조사한 12개 하네스 모두 "모델 재량 서브에이전트 + 세션 영속화"로 수렴하는 가운데, Loop의 "사전 검증 DAG + 완료 계약 + compute class 라우팅 + attention 게이트" 조합은 유일하며, 완료를 실행 증거로 강제하는 하네스는 없다.
2. fan-out은 표준 기능이지만 세 계열(세션 내 서브에이전트 / 스크립트 워크플로우 / 플랫폼 오케스트레이션)로 수렴한다 — Loop DAG는 세 번째 계열 방향이며, Loop의 최대 격차는 fan-out 자체가 아니라 fan-out이 페르소나 규칙(재량)이라 리서치가 단일 워커로 몰릴 수 있다는 점이다.
3. 가장 큰 기능 격차는 컨텍스트 관리(OpenHands Condenser, Roo Condensing, Goose 80% 임계 압축, Claude compaction)와 확장 생태계다 — MCP는 Aider를 제외한 전 하네스가 채택한 사실상 표준이며, 둘 다 코어 경계를 침범하지 않고 어댑터·Lead 레벨에서 부분 해소 가능하다.
4. 검증의 모범 사례는 교차검증(Claude `/deep-research` claim 투표, Amp 오브 증명, Codex `--output-schema`+exit)이고, Warp cross-harness와 OpenHands ACP는 "하나의 오케스트레이터가 이기종 하네스를 지배"하는 선행 사례로 Loop의 `AgentProvider` 정규화와 같은 문제다.
5. 2026-09-30 라우팅 전환(gpt-6.1-sol을 fast/balanced/strong primary로, zai 볼륨 레인을 폴백으로, `default_compute_class=fast`)은 클래스 추상화 덕에 `config/models.toml`·`config/policy.toml` 프로필 교체만으로 적용됐다 — 이 추적성은 타 하네스의 auto 라우팅에는 없는 Loop 고유 자산이다.
