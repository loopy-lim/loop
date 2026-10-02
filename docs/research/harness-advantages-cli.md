# CLI 코딩 에이전트 하네스의 검증된 장점과 Loop 갭

- 조사일: 2026-09-30. 공개 공식 문서·저장소를 기준으로 기능을 정리했으며 실행 성능은 비교하지 않았다.
- 범위: Claude Code, OpenAI Codex CLI, Gemini CLI, OpenCode, Aider, Amp/Crush (6개 하네스). Crush는 공개 제품 문서가 충분히 특정되지 않아 Amp와 별도 기능 주장을 하지 않고 Amp/Crush 계열 항목에 제한해 표시했다.
- Loop 기준: README와 기존 Loop 분석([harness-comparison](harness-comparison.md), [Loop 분석](sections/loop-analysis.md)). Loop는 선검증 DAG, worker 병렬 실행·write scope 격리, completion checks, 이벤트 영속·재조정, `status/watch`, provider adapter를 갖춘다. 자체 MCP/skills/hooks, 자동 컨텍스트 압축, 대화 세션 rewind, IDE 통합은 확인되지 않는다.
- 판정은 기능의 유무이며 품질 우열을 뜻하지 않는다. 각 장점의 출처 URL을 개별 항목에 표기한다.

## 비교 항목

### Claude Code

1. Subagents와 agent teams로 탐색·구현을 분담하고 컨텍스트를 격리한다. **Loop:** DAG worker 병렬화 있음(명시적 그래프·write scope 규율이 강점), 대화 안에서 자율 subagent/team 없음. **비용:** 작은 조사도 DAG를 구성해야 하며 즉석 위임은 어렵다. 출처: https://code.claude.com/docs/en/sub-agents
2. Hooks는 도구 전후·세션 종료 등 lifecycle 지점에서 자동 정책을 실행한다. **Loop:** 해당 worker lifecycle hook API 없음; completion checks는 종료 검증이지 매 호출 개입이 아니다. **비용:** 정책 검사·자동 포맷·감사 연동을 별도 adapter로 만들어야 한다. 출처: https://code.claude.com/docs/en/hooks-guide
3. CLAUDE.md, skills와 자동 compaction으로 프로젝트 지침·반복 절차·긴 대화를 다룬다. **Loop:** lead/worker 지침은 있으나 표준 skill 로딩 및 compaction 없음. **비용:** 긴 실행에서 유효 문맥이 불어나고 절차 재사용이 수동이다. 출처: https://code.claude.com/docs/en/memory ; https://code.claude.com/docs/en/skills
4. 헤드리스 실행 및 SDK로 CLI 외 자동화에 연결할 수 있다. **Loop:** CLI 오케스트레이션은 있으나 Claude SDK 자체가 아니라 provider adapter 경유. **비용:** Claude 고유 세션·도구 기능을 직접 재사용하기 어렵다. 출처: https://code.claude.com/docs/en/headless

### OpenAI Codex CLI

1. 기본 활성 multi-agent와 explorer/worker 등 에이전트별 역할·모델 지정. **Loop:** 병렬 DAG worker 있음, 모델별 agent thread를 대화에서 동적으로 운영하지 않음. **비용:** 조사 역할 분담을 명시적으로 계획해야 한다. 출처: https://learn.chatgpt.com/docs/agent-configuration/subagents
2. 샌드박스와 승인 정책이 파일·네트워크·명령 실행 권한을 제어한다. **Loop:** task write scope 및 attention 게이트는 있으나 범용 OS sandbox/도구별 승인 체계는 아님. **비용:** 위험 명령의 세밀한 실행 시점 통제가 provider 환경에 의존한다. 출처: https://github.com/openai/codex
3. `/resume`, `/fork`, `/compact`와 AGENTS.md로 세션 연속성과 문맥 관리를 지원한다. **Loop:** 영속 run 상태 및 재개 있음, 대화 fork/요약 compact 없음. **비용:** 탐색 분기와 장기 대화 압축을 사용자가 별도 관리한다. 출처: https://learn.chatgpt.com/docs/codex-manual.md
4. MCP 서버와 skills를 통한 도구·절차 확장. **Loop:** 코어에 MCP/skills 표준 없음(어댑터 확장 가능). **비용:** Codex 생태계 설정을 Loop에 그대로 가져올 수 없다. 출처: https://github.com/openai/codex

### Gemini CLI

1. 서브에이전트 자동 위임 및 `@` 명시 호출, 커스텀 역할·실행 한도. **Loop:** 그래프에 의한 worker fan-out 있음, 모델 재량 subagent 호출 없음. **비용:** 단순한 조사 분할도 Lead가 DAG로 표현해야 한다. 출처: https://github.com/google-gemini/gemini-cli/blob/main/docs/core/subagents.md
2. 체크포인트와 `/restore`로 변경 전 상태를 복구한다. **Loop:** run 재개·취소는 있으나 파일 변경 checkpoint rewind 없음. **비용:** 잘못된 worker 변경은 별도 git 복구가 필요하다. 출처: https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/checkpointing.md
3. 긴 대화 자동 압축 및 GEMINI.md 지침. **Loop:** 자동 context compaction 없음. **비용:** 긴 작업에서 지침/초기 근거가 문맥 한도에 밀릴 수 있다. 출처: https://github.com/google-gemini/gemini-cli
4. MCP 및 extensions 생태계. **Loop:** 내장 MCP/extensions 없음. **비용:** 외부 도구 연결의 설정·수명주기를 별도 구성해야 한다. 출처: https://github.com/google-gemini/gemini-cli

### OpenCode

1. Build/Plan primary agent와 Explore 등 subagent, 읽기 전용 계획 모드. **Loop:** decision/integration 직렬화와 DAG 있음, 대화형 모드 전환 및 자율 위임 없음. **비용:** 즉석 설계-실행 전환이 상대적으로 무겁다. 출처: https://opencode.ai/docs/agents/
2. 세분화된 allow/ask/deny 권한과 glob 정책. **Loop:** task write scope·attention은 있으나 일반 도구 권한 규칙은 제한적. **비용:** 파일/명령별 접근 정책을 별도로 설정해야 한다. 출처: https://opencode.ai/docs/permissions/
3. 75+ provider, 로컬 모델 및 agent별 설정. **Loop:** provider-neutral adapter가 있으나 지원 provider 범위가 구성·adapter 구현에 한정된다. **비용:** 신규 모델/환경 연결에 adapter 작업이 생길 수 있다. 출처: https://opencode.ai/docs/providers/
4. MCP, 플러그인 및 HTTP 서버/SDK 통합. **Loop:** MCP/plugin 표준이나 외부 제어 HTTP API 없음. **비용:** 기존 도구 생태계와 IDE·자동화 연동에 접착 코드가 필요하다. 출처: https://opencode.ai/docs/mcp/ ; https://opencode.ai/docs/server/

### Aider

1. Repo map과 언어 파서로 코드베이스를 선택적으로 문맥화한다. **Loop:** task scope는 있으나 worker의 repo map 제공은 하네스 표준 기능이 아니다. **비용:** 큰 저장소에서 필요한 코드 위치를 worker가 직접 찾아야 한다. 출처: https://aider.chat/docs/repomap.html
2. 자동 git commit 및 diff 기반 되돌리기, 테스트·lint 명령 재시도. **Loop:** 완료 계약·검증 상태가 강제되나 작업별 자동 git checkpoint/revert는 없음. **비용:** 실패한 변경의 복구·원인 분리가 수동이다. 출처: https://aider.chat/docs/git.html ; https://aider.chat/docs/usage/lint-test.html
3. 다양한 LLM 제공자 및 architect/editor 모드. **Loop:** compute class와 adapter 라우팅은 있지만 임의 모델 연결 범위는 adapter에 좌우됨. **비용:** 새 모델 사용 전 통합 작업이 필요할 수 있다. 출처: https://aider.chat/docs/llms.html
4. 대화형 페어프로그래밍과 스크립트/원샷 실행. **Loop:** 독립 CLI run 제어는 강하지만 Aider식 단일 대화 편집 흐름은 제공하지 않는다. **비용:** 한 파일의 빠른 수정에도 run/task 오케스트레이션이 과하게 느껴질 수 있다. 출처: https://aider.chat/docs/scripting.html

### Amp / Crush

1. Amp의 specialist subagents(Search/Oracle 등) 및 Orbs 병렬 클라우드 작업. **Loop:** DAG worker 병렬성·격리 있음, 자동 specialist 선택 및 클라우드 작업공간 없음. **비용:** 역할에 맞는 연구자 선택과 원격 격리는 직접 설계해야 한다. 출처: https://ampcode.com/docs/models-and-subagents ; https://ampcode.com/docs/orbs
2. Amp의 Oracle second opinion과 실행 증거 공유. **Loop:** 완료 계약은 실행 검증을 강제하지만 자동 독립 second opinion은 없음. **비용:** 설계·결과의 독립 검토자를 별도 task로 추가해야 한다. 출처: https://ampcode.com/docs/models-and-subagents
3. Amp MCP·skills·플러그인 확장. **Loop:** 자체 표준 미지원. **비용:** 재사용 도구·절차를 Loop에 연결할 때 adapter 통합 부담. 출처: https://ampcode.com/docs
4. Amp CLI execute mode와 오브/웹 세션 연속성. **Loop:** CLI 및 durable run 재개 있음, Amp식 개인 대화 세션·클라우드 세션 핸드오프 없음. **비용:** 로컬 인터랙티브 작업에서 원격 이어하기가 어렵다. 출처: https://ampcode.com/docs/cli/execute-mode ; https://ampcode.com/docs/orbs
5. Crush는 공개 Go 오픈소스 CLI로 여러 provider와 MCP 사용을 표방한다. **Loop:** provider adapter 경계는 있으나 Crush의 대화형 TUI·MCP 도구 카탈로그 없음. **비용:** 기존 Crush 도구 설정을 직접 이식할 수 없다. 출처: https://github.com/charmbracelet/crush

## 우선순위 갭 및 보완 방향

1. **P1 — 컨텍스트 수명 관리:** Claude/Gemini/OpenCode 계열의 compaction이 일반적이다. worker 출력·재시도 이력을 요약하되 completion contract, 결정, 실패 증거는 보존하는 압축 정책을 adapter/orchestrator 경계에서 설계한다. 먼저 토큰·출력 증가를 계측하고, 요약 손실 검증 테스트를 추가한다.
2. **P1 — 도구 생태계 접속:** MCP는 여러 경쟁 하네스의 공통 확장점이다. 코어에 MCP 타입을 넣지 말고 adapter 측 선택적 MCP client/server 연동을 조사한다. 권한·자격증명은 기존 비저장 규칙을 따른다.
3. **P2 — 실행 lifecycle hook:** worker 시작/종료·도구 실행 전후에 typed event seam을 adapter 계층에서 제공하고 정책 검증·관측에 활용한다. 단, 결정적 검증은 현재 completion check에 남긴다.
4. **P2 — checkpoint/rewind UX:** Gemini/Aider의 git 기반 복구 편익을 참고해 worker 작업공간 단위 snapshot/restore를 검토한다. 이벤트 로그의 run 복구와 파일 되감기는 다른 개념이므로 별도 소유권·dirty workspace 규칙이 필요하다.
5. **P3 — 대화형 경량 모드 및 IDE 통합:** OpenCode/Aider/Claude의 IDE·대화 경험은 Loop의 현재 orchestration 목적과 다르다. 먼저 기존 Pi/Herdr 경계에서 편의성을 개선하고, Loop 코어에 UI/provider 개념을 유입시키지 않는다.

## 요약 evidence

- 조사한 하네스 수: **6** (Claude Code, OpenAI Codex CLI, Gemini CLI, OpenCode, Aider, Amp/Crush).
- 장점 항목 수: **25** (각 항목별 Loop 유무·체감 비용·출처를 기재).
- 가장 보편적인 차이는 자동 컨텍스트 관리와 도구 확장 생태계이며, Loop의 강점인 사전 검증 DAG·완료 계약을 훼손하지 않고 adapter/orchestrator 경계에서 보완하는 것이 우선이다.
