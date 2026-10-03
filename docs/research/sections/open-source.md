# 리서치 fan-out 2/3: 오픈소스 코딩 에이전트 하네스 조사

- 날짜: 2026-09-30
- 범위: Aider, OpenCode, Cline, Roo Code, OpenHands, Block Goose
- 방법: 각 프로젝트 공식 문서/저장소를 2026-09-30 기준 직접 조회해 근거로 사용 (아래 출처 링크)
- 분류 주의: 이 섹션은 코드가 오픈소스이고 서드파티 커뮤니티 주도인 하네스를 다룬다. Codex CLI·Gemini CLI처럼 라이선스만 오픈소스인 퍼스트파티 상용 하네스는 1/3 섹션(closed-source.md)에서 다룬다.

## 비교 표

| 하네스 | 실행 모델(대화형/헤드리스) | 멀티모델 지원 | 서브에이전트·병렬 fan-out | 컨텍스트 관리 | 검증 메커니즘 | 확장성(MCP/스킬/훅) | 라이선스/가격 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Aider | 대화형 터미널 페어프로그래머 + 원샷 헤드리스(`--message`/`--message-file`, `--yes-always`, 처리 후 exit), Python API 스크립팅, 브라우저 모드 | 거의 모든 LLM(로컬 포함). architect 모드에서 architect 모델+editor 모델 2단 파이프라인(순차). 문서 기준 권장 모델은 Claude 3.7/DeepSeek/GPT-4o 시대로 다소 후행 | 없음. 단일 대화 단일 프로세스 설계. 서브에이전트 개념·병렬 fan-out 없음 — 병렬화는 여러 aider 프로세스를 셸에서 직접 띄우는 방식만 가능 | repo map(tree-sitter 기반 코드베이스 지도) 자동 관리, `/add`·`/drop` 수동 컨텍스트 제어, watch files(주석 지시 감지) | 자동 git 커밋(사람이 diff·revert로 검증), `--lint-cmd`/`--test-cmd` 설정 시 테스트 실패를 감지해 자동 수정 재시도 | YAML 설정, 커스텀 chat-mode 프롬프트, 이미지/음성 입력. MCP·스킬·훅 미지원(확장은 포크에서만) | Apache-2.0. BYO API key(무료 OSS) |
| OpenCode | TUI + 데스크톱 앱 + IDE 확장 + `opencode run [message]` 비대화형 + `opencode serve` 헤드리스 HTTP 서버(OpenAPI 3.1) + TS SDK + `--attach` 기존 서버 부착 | 75+ 프로바이더(AI SDK + models.dev), 로컬 모델, OpenCode Zen(큐레이션 모델, 종량제). 에이전트별 model/temperature/max steps 개별 지정 | 강함. primary(Build/Plan)+subagent(General="여러 작업 단위를 병렬로", Explore 읽기전용, Scout 의존성 리서치) + 숨은 시스템 에이전트(compaction/title/summary). 자동 위임·`@` 멘션·자식 세션 탐색 키바인딩 | 숨은 compaction 에이전트가 자동 압축, rules(AGENTS.md), 부모-자식 세션 구조로 컨텍스트 격리 | permission 시스템(ask/allow/deny + glob 규칙, 예: `git *`: allow, `rm *`: deny), policies, Plan 에이전트 읽기전용 제한, 내장 LSP·포매터로 진단 검증 | MCP 서버, Agent Skills, 플러그인(lifecycle 이벤트), 커스텀 툴, 테마·키바인드·커맨드·포매터, ACP 지원 | MIT(완전 무료 OSS). Zen은 종량제 크레딧 |
| Cline | VS Code·JetBrains 확장 + CLI(`cline`, `npm i -g cline`)+ TUI + Desktop + Kanban + ACP. `--json`/stdin 파이프/stdout 리다이렉트 시 자동 헤드리스, `--auto-approve true` 무인 실행 | Cline Provider(무료 모델+구독) 또는 BYO key — 30+ 프로바이더(Anthropic/OpenAI/Gemini/OpenRouter/Ollama/LiteLLM/Bedrock/Vertex/z.ai 등), 엔터프라이즈 원격 설정으로 프로바이더 통제 | 강함. `use_subagents` 툴로 병렬 읽기전용 리서치 서브에이전트(자체 컨텍스트·토큰 예산, 리포트만 반환, 파일 수정·브라우저·MCP·중첩 스폰 불가) 기본 활성. CLI/SDK/Kanban 한정 Agent Teams — 코디네이터+공유 태스크 보드+에이전트 간 메일박스, 팀 상태 영속 | Plan/Act 이중 모드, Memory Bank 베스트프랙티스, rules/.clinerules, 스킬 progressive loading(관련 시에만 로드) | 체크포인트(섀도 git, 툴 사용마다 스냅샷·복원), Plan 모드 쓰기 차단, 세분화된 auto-approve 토글, YOLO 모드 엔터프라이즈 통제, OpenTelemetry 관측 | MCP(+마켓플레이스), 스킬, 훅(SDK 플러그인), 플러그인, SDK(ClineCore)로 커스텀 툴·이벤트 | Apache-2.0. 확장 무료(BYO key), Cline Provider 유료 플랜/무료 모델 |
| Roo Code | VS Code 확장 중심(공식 CLI/헤드리스 없음. "Background Editing"은 diff 뷰 비활성화일 뿐). 병렬 개발은 worktrees로 다중 인스턴스 | 30+ 프로바이더(Anthropic/OpenAI/Gemini/OpenRouter/Ollama/LiteLLM/Bedrock 등), 모드별 모델 할당(Architect=Gemini, Code=Sonnet 식 자동 전환) | 중간. Boomerang Tasks(🪃 Orchestrator 모드)가 `new_task` 툴로 서브태스크 위임 — 부모 일시정지·자식 완료 후 요약만 복귀하는 계층 구조로, 한 세션 내 진짜 병렬 fan-out은 아님. 커스텀 모드로 전문화, worktrees로 세션 간 병렬 | Intelligent Context Condensing(임계 근접 시 AI 요약, 기본 활성), 코드베이스 인덱싱, context mentions, .rooignore | 체크포인트(섀도 git, 파일 수정 전 스냅샷·복원), 서브태스크 생성/완료 승인 게이트, auto-approving actions 세분화, IDE 진단 통합, Orchestrator 모드의 의도적 읽기 제한(context poisoning 방지) | MCP(+마켓플레이스), 스킬(.roo/skills), 커스텀 모드(JSON), 슬래시 커맨드, 실험적 커스텀 툴 | Apache-2.0. 확장 무료(BYO key) |
| OpenHands | Agent Canvas(브라우저 컨트롤 센터: 로컬/Docker/VM/Modal/Cloud 백엔드) + CLI(`openhands`, `--headless -t` 헤드리스, `--json` JSONL 이벤트 스트림) + Cloud + Enterprise + ACP 에이전트(Claude Code·Codex·Gemini CLI 구동) | LiteLLM 경유 100+ 프로바이더, LLM 프로파일, 로컬 모델. "Bring your own model" | 약함(단일 대화 기준). 네이티브 서브에이전트 fan-out 없음 — 실험적 병렬 툴 실행(`tool_concurrency_limit`, 기본 1)이 "여러 서브에이전트 동시 위임"을 가능하게 하는 수준. SDK로 다중 대회선 프로그래밍, Canvas automations·Cloud 샌드박스로 워크플로 병렬화 | Condenser 시스템(NoOp/LLM 요약/파이프라인, 임계 감지·뷰 관리), 스킬 4종 트리거(always/keyword/task/path), microagents 계보 | SecurityAnalyzer(실행 전 리스크 평가), confirmation mode, 샌드박스 격리(Docker/VM/Modal/Cloud), CLI critic, JSONL 이벤트로 CI 파싱 | MCP 서버, 스킬(.cursorrules/AGENTS.md 파싱 호환), 플러그인(엔터프라이즈 마켓플레이스), Python SDK 커스텀 툴, ACP | MIT(무료 OSS). OpenHands Cloud 유료, Enterprise 셀프호스트 |
| Goose | 데스크톱 앱 + CLI + API(Rust 네이티브). `goose run --recipe/--text/-i` 헤드리스, `--output-format text/json/stream-json`, `--quiet` | 15+ 프로바이더(Anthropic/OpenAI/Google/Ollama/OpenRouter/Azure/Bedrock), ACP로 Claude·ChatGPT·Gemini 구독 사용, `/model` 세션 중 전환, 서브레시피별 모델 지정 | 가장 강함. 서브에이전트(자율 스폰, 자연어로 순차/병렬 지정, 기본 최대 25턴·5분 타임아웃, 부모 확장 상속) + 서브레시피(YAML 재사용, 서브레시피별 provider/model) + 외부 서브에이전트(Codex·Claude Code를 MCP 서버로 구동해 조율) + 레시피로 헤드리스 워크플로 | Smart Context Management(토큰 한도 80% 도달 시 자동 압축, `GOOSE_AUTO_COMPACT_THRESHOLD`, 오래된 툴 출력 배경 요약, compaction.md 템플릿 커스터마이즈, 수동 compaction) | 권한 시스템(allowlist·툴 권한), adversary mode(적대적 프롬프트 인젝션 테스트), 프롬프트 인젝션 탐지, 훅으로 셸 커맨드 후 검사 자동화 | MCP(70+ 익스텐션, MCP-first), 스킬, 훅(Open Plugins 훅 명세), 플러그인(user/project 스코프), 커스텀 배포판, 레시피/서브레시피, ACP, GDK/SDK | Apache-2.0. 완전 무료 OSS. Linux Foundation 산하 AAIF(Agentic AI Foundation) 소속 |

## 항목별 요약

### Aider
"터미널 페어 프로그래밍"이라는 단일 대화 단일 프로세스 모델을 고수하는 가장 단순한 구조다. headless는 `--message`로 한 번 실행 후 exit하는 원샷 방식이고, 병렬 fan-out·서브에이전트 개념이 전혀 없어 오픈소스 하네스 중 fan-out 축의 하한선을 대표한다. repo map과 자동 git 커밋, 테스트 실패 자동 수정이 컨텍스트·검증 축의 핵심이다.
출처: [README](https://github.com/Aider-AI/aider), [scripting](https://aider.chat/docs/scripting.html), [chat modes](https://aider.chat/docs/usage/modes.html), [LLMs](https://aider.chat/docs/llms.html)

### OpenCode
TUI가 클라이언트이고 `opencode serve` HTTP 서버(OpenAPI 3.1)가 코어인 클라이언트-서버 구조로, SDK·IDE·웹이 같은 서버를 공유한다. primary/subagent 이원화와 hidden 시스템 에이전트(compaction/title/summary)가 특징이며, General 서브에이전트는 공식 문서에 "여러 작업 단위를 병렬로 실행"용으로 명시되어 있다. permission glob 규칙(`rm *`: deny)이 검증 축의 실용적 참고점이다.
출처: [저장소(anomalyco/opencode, MIT)](https://github.com/anomalyco/opencode), [agents](https://opencode.ai/docs/agents/), [server](https://opencode.ai/docs/server/), [CLI](https://opencode.ai/docs/cli/), [permissions](https://opencode.ai/docs/permissions/), [models](https://opencode.ai/docs/models/), [Zen](https://opencode.ai/zen/)

### Cline
읽기전용 병렬 리서치 서브에이전트(기본 활성)와 CLI 한정 Agent Teams(코디네이터+공유 태스크 보드+메일박스)의 2단 fan-out을 갖춘다. 서브에이전트는 "메인 컨텍스트 오염 없이 코드베이스를 넓게 탐색"이라는 리서치 전용 설계로, MCP·브라우저·중첩 스폰을 차단해 격리를 강제한다. 체크포인트가 툴 사용마다 섀도 git 스냅샷을 찍어 검증 비용을 거의 0으로 만든다.
출처: [저장소(cline/cline, Apache-2.0)](https://github.com/cline/cline), [subagents](https://docs.cline.bot/features/subagents), [agent teams](https://docs.cline.bot/cli/agent-teams), [CLI](https://docs.cline.bot/usage/cli-overview), [checkpoints](https://docs.cline.bot/core-workflows/checkpoints), [skills](https://docs.cline.bot/customization/skills), [SDK multi-agent](https://docs.cline.bot/sdk/guides/multi-agent-teams)

### Roo Code
Cline에서 갈라진 포크로, Boomerang Tasks(Orchestrator 모드)로 계층적 서브태스크 위임을 구현했다. 부모가 일시정지하고 요약만 수신하는 직렬 계층 구조라 병렬 fan-out은 아니며, Orchestrator 모드에서 파일 읽기를 아예 빼는 "context poisoning 방지" 설계가 인상적이다. 공식 CLI/헤드리스가 없어 자동화는 확장 내부에 의존하며, 병렬은 worktrees 다중 창으로 보완한다.
출처: [저장소(RooCodeInc/Roo-Code, Apache-2.0)](https://github.com/RooCodeInc/Roo-Code), [boomerang tasks](https://roocodeinc.github.io/Roo-Code/features/boomerang-tasks/), [checkpoints](https://roocodeinc.github.io/Roo-Code/features/checkpoints/), [condensing](https://roocodeinc.github.io/Roo-Code/features/intelligent-context-condensing/), [modes](https://roocodeinc.github.io/Roo-Code/basic-usage/using-modes/), [worktrees](https://roocodeinc.github.io/Roo-Code/features/worktrees/)

### OpenHands
단일 에이전트 대화 구조를 유지하면서 병렬성을 툴 실행 수준(실험적 `tool_concurrency_limit`)과 인프라 수준(Canvas automations, Cloud/Enterprise 샌드박스)으로 해결하는 접근이다. Condenser·SecurityAnalyzer·샌드박스가 SDK 아키텍처의 1급 시민으로, "실행 전 리스크 평가"를 명시적으로 분리한 몇 안 되는 하네스다. Agent Canvas에서 ACP로 Claude Code·Codex를 구동해 사실상 하네스 불문 컨트롤 센터로 진화했다.
출처: [저장소(OpenHands/OpenHands, MIT)](https://github.com/OpenHands/OpenHands), [headless](https://docs.openhands.dev/openhands/usage/cli/headless), [agent arch](https://docs.openhands.dev/sdk/arch/agent), [condenser](https://docs.openhands.dev/sdk/arch/condenser), [parallel tool execution](https://docs.openhands.dev/sdk/guides/parallel-tool-execution), [agent canvas](https://docs.openhands.dev/openhands/usage/agent-canvas/overview)

### Goose
오픈소스 하네스 중 fan-out 축이 가장 발달했다. 자연어로 병렬 지정하는 서브에이전트, 모델까지 지정 가능한 YAML 서브레시피, Codex·Claude Code를 MCP 서버로 물어 조율하는 외부 서브에이전트의 3층 구조다. 서브에이전트가 "성공한 것만 결과를 돌려준다"는 실패 정책과 25턴/5분 기본 한도, Linux Foundation AAIF 이관(거버넌스 중립화)이 특징이다.
출처: [저장소(block/goose → aaif-goose/goose, Apache-2.0)](https://github.com/block/goose), [subagents](https://goose-docs.ai/docs/guides/context-engineering/subagents), [subrecipes](https://goose-docs.ai/docs/guides/recipes/subrecipes), [smart context](https://goose-docs.ai/docs/guides/sessions/smart-context-management), [hooks](https://goose-docs.ai/docs/guides/context-engineering/hooks), [subagents vs subrecipes](https://goose-docs.ai/blog/2025/09/26/subagents-vs-subrecipes)

## subagent fan-out 상세 (리서치/탐색 관점)

| 하네스 | fan-out 단위 | 스폰 방식 | 동시성/한도 | 결과 수집·검증 |
| --- | --- | --- | --- | --- |
| Aider | 없음 | — | — | — (프로세스 여러 개 수동 실행이 유일한 병렬 수단) |
| OpenCode | 서브에이전트(자식 세션) | primary 에이전트가 설명 기반 자동 위임, `@` 멘션 명시 호출 | 문서에 고정 상한 없음(General은 "병렬 작업 단위"용) | 자식 세션이 결과 반환, 부모-자식 세션 탐색 키바인딩으로 관찰, 세션별 summary 에이전트 |
| Cline | 리서치 서브에이전트 / 팀 에이전트 | `use_subagents` 툴(기본 활성, 자동 판단), `cline --team-name` 코디네이터 스폰 | 문서에 고정 상한 없음. 서브에이전트별 토큰·비용 개별 추적 | 서브에이전트는 "다음에 읽을 파일 경로 중심 리포트"만 반환, 읽기전용·MCP 차단으로 검증 표면 최소화. 팀은 태스크 보드+미션 로그로 상태 영속 |
| Roo Code | 서브태스크(계층, 직렬) | Orchestrator 모드 `new_task` 툴, 모드 지정 위임 | 부모 일시정지로 사실상 1동시(계층 누적은 가능) | `attempt_completion`의 result 요약만 부모로 복귀, 생성/완료 승인 게이트, 컨텍스트 완전 격리 |
| OpenHands | 없음(툴 병렬만) | SDK `tool_concurrency_limit` > 1로 단일 응답 내 다중 툴 동시 실행(실험적, 기본 1) | 툴 동시성 상한 1(기본), 대화 자체는 1개 | 병렬 툴 결과도 동일 이벤트 스트림으로 귀환, headless `--json` JSONL로 CI 파싱 |
| Goose | 내부 서브에이전트 / 서브레시피 / 외부 에이전트 | 자율 스폰(자율 승인 모드 기본), 자연어 "in parallel", 레시피 참조, config로 Codex 등 MCP 서버화 | 최대 턴 25(`GOOSE_SUBAGENT_MAX_TURNS`), 타임아웃 5분 기본, 병렬/순차 자연어 지정 | 실행 요약(total/success/failed) 반환, 실패 서브에이전트는 결과 없음·성공분만 수집, 툴 호출 `[subagent:N]` 인라인 관찰 |

## Loop 관련 시사점

1. **fan-out은 상용과 오픈소스 모두의 표준이지만, 오픈소스는 구현 깊이가 3등급으로 갈린다**: 네이티브 병렬(Goose, Cline, OpenCode), 직렬 계층(Roo, Aider 없음), 인프라 위임(OpenHands). Loop의 task DAG는 첫 계열과 같은 방향이며 이미 한 단계 앞서 있다.
2. **리서치 서브에이전트는 "읽기전용+요약 반환"으로 수렴**: Cline(파일 수정·MCP·중첩 스폰 차단, 리포트만 반환), Roo(Orchestrator 읽기 제한), OpenCode(Explore 읽기전용) 모두 Loop의 "worker 결과는 completion contract로만 수신" 원칙과 일치한다. Loop 리서치 태스크에 read-only 툴 제한을 명시할 근거가 된다.
3. **실패 정책이 문서화된 곳은 Goose뿐**: "실패한 서브에이전트는 결과 없음, 성공분만 수집, 개별 타임아웃(5분)·턴 한도(25)"는 Loop의 attention 없는 부분 실패 처리와 비교할 만한 참고점이다.
4. **컨텍스트 관리도 하네스가 책임진다**: OpenCode의 hidden compaction 에이전트(에이전트를 에이전트로 처리), Goose의 80% 임계 자동 압축+툴 출력 요약, Roo/OpenHands의 condenser는 Loop가 컨텍스트 정책을 core에서 타입으로 다루는 설계를 지지한다.
5. **거버넌스·라이선스 분포**: Apache-2.0 4종(Aider/Cline/Roo/Goose), MIT 2종(OpenCode/OpenHands). Goose는 Linux Foundation AAIF로 이관해 벤더 중립성을 확보했다 — Loop가 참조할 "중립 하네스" 후보에서 우선순위가 올라가는 요소다.

## 미확인·한계

- Aider는 2025년 이후 개발 속도가 느려 문서의 권장 모델이 구버전(Claude 3.7/GPT-4o 시대)이며, 최신 모델 동호응 성능은 문서만으로 판단 불가.
- Cline 서브에이전트 동시성 상한, OpenCode 서브에이전트 동시성 상한은 공식 문서에 수치가 없다(각각 "Cline이 판단", "문서 미고정").
- OpenHands Cloud/Enterprise 가격, Cline Provider 플랜 금액, Roo Code Cloud 과금 세부는 마케팅 페이지 동적 렌더링으로 본 문서에서 정수 확인 불가.
- Goose 서브에이전트·서브레시피는 공식적으로 experimental 상태이며 동작이 변경될 수 있다(공식 블로그 명시).
- 문서는 2026-09-30 스냅샷이며, opencode(anomalyco 이전)·OpenHands(OpenHands 조직 이전)·Goose(AAIF 이관) 모두 최근 수개월 내 소속/구조 변경이 커서 링크 유효성이 짧을 수 있다.
