# DeerFlow·Kimi 에이전트 설계 조사 — Loop 배움 설문

- **일자:** 2026-09-24 KST
- **종류:** `implementation` (DeerFlow·Kimi 에이전트 설계 조사, attempt 0)
- **읽기 범위:** `AGENTS.md`, `README.md`, `docs/design/research/**`, `docs/reliable-runs.md`, 외부 1차 소스(아래 조사 방법)
- **쓰기 범위:** 이 문서만 (`docs/design/research/deerflow-kimi-agent-survey.md`)
- **증거 경계:** DeerFlow는 `git clone --depth 1`(2.0 `main`과 1.x `main-1.x`)로 받은 실제 소스 트리에서 직접 확인했고, 각 주장에 저장소 내 파일 경로 또는 GitHub URL을 출처로 명시했다. Kimi는 Moonshot AI 공식 블로그(moonshotai.github.io, kimi.com), 공식 오픈소스 저장소(MoonshotAI org), 공식 문서(moonshotai.github.io/kimi-code)만 사용했다. 이차 해석(언론·개인 블로그)은 사용하지 않았다.
- **사실/추론 구분:** 실측한 사실은 출처와 함께 기술하고, 출처에서 직접 확인되지 않은 해석은 문장 말이나 항목에 **(추정)** 또는 **(추론)** 으로 표기했다.
- **자매 문서:** Loop 현황은 `docs/reliable-runs.md`, 이전 UI 조사는 `oss-agent-ui-survey.md`.

---

## 0. 요약 — Loop에 적용 가능한 패턴 상위 5개

**조사 대상:** DeerFlow 2.0(bytedance/deer-flow `main`), DeerFlow 1.x(`main-1.x` 딥 리서치 프레임워크), Kimi-Researcher, Kimi K2/K2.5 모델 계열, Kimi Code CLI(MoonshotAI/kimi-code).

1. **검증을 "모델 자기 보고 → 코드 판정" 2계층으로 분리하고, 판정 불가는 절대 통과로 바꾸지 않는다.** DeerFlow 2.0은 서브에이전트 최종 보고를 명시적으로 SELF-REPORT로 규정하고, 리드가 코드로 판정 가능한 acceptance criteria를 코드로 재확인하며(`acceptance_checks.py`, §2.3), 코드로 판정 불가한 항목은 `checked=False`/`UNVERIFIED`로 남긴다. 이는 Loop의 "worker 성공 보고 후에도 completion check 명령 통과가 필요" 원칙과 같은 방향이며, 어휘 수준에서 더 정교하다(§5-A).
2. **비대화형 실행에서 human-in-the-loop를 억제하는 대신 구조화된 BLOCKED 결과로 대체한다.** DeerFlow 2.0의 `RunInteractionPolicy`는 scheduled/webhook/autonomous 모드에서 clarification를 금지하고 "최소 가역 가정 + 중요 가정 나열 또는 BLOCKED 구조화 결과"를 요구한다(§2.4). Loop의 attention은 비대기 억제 정책 자체를 명시하지 않으므로 참조 가치가 있다(§5-D).
3. **메인 모델과 서브에이전트 모델 풀을 설정으로 분리한다.** Kimi Code CLI는 설정에 `secondary_model`(서브에이전트 전용 모델 풀) 도메인을 두고 API로도 관리한다(§3.4). Loop에서 "기본 모델 sol, 스폰 워커 glm-5.3-flashx" 라우팅 요구는 이 패턴과 정확히 일치하며, `config/models.toml`에 이미 필요한 엔트리가 존재한다(§5-B, **추정** 포함).
4. **딥 리서치의 산출물은 "계획 승인 게이트 → 순차 실행 → 인용 수집 → 단일 리포터" 파이프라인이다.** DeerFlow 1.x는 LangGraph 상태 그래프로 coordinator/planner/human_feedback/research_team/reporter를 고정 위상으로 묶고, 계획은 `interrupt()`로 사람 승인([ACCEPTED]/[EDIT_PLAN])을 받는다(§2.2). Loop의 DAG+attention과 대비되는 "고정 위상 vs 선언 그래프" 차이가 명확하다(§4).
5. **모델 쪽 트렌드는 워크플로우 하드코딩에서 종단 RL 단일 모델, 다시 모델 주도 swarm으로 이동 중이다.** Kimi-Researcher는 워크플로우 기반 시스템의 한계(모델 버전 결합, 수동 갱신)를 명시적으로 비판하며 종단 RL로 전환을 정당화하고(§3.1), K2.5는 모델이 스스로 과업을 병렬 서브태스크로 분해하는 Agent Swarm을 내세운다(§3.3). Loop의 "deterministic policy는 Rust 그래프에" 원칙은 이 흐름과 정반대 베팅이며, 차별점으로 유지할 가치가 있다(§6).

---

## 1. 조사 방법

- **DeerFlow:** 2026-09-24에 `https://github.com/bytedance/deer-flow`를 `--depth 1`로 두 번 받았다. 2.0은 `main`, 1.x는 `main-1.x`(README가 "원조 Deep Research 프레임워크는 `main-1.x` 브랜치에서 유지된다"고 명시 — https://github.com/bytedance/deer-flow#readme). 2.0과 1.x는 코드 공유가 전혀 없음을 README가 명시한다(같은 출처).
- **Kimi:** Moonshot AI 공식 출처만 사용 — Kimi-Researcher 공식 블로그(https://moonshotai.github.io/Kimi-Researcher/), 오픈소스 모델 저장소(https://github.com/MoonshotAI/Kimi-K2, https://github.com/MoonshotAI/Kimi-K2.5), Kimi Code CLI 저장소와 공식 문서(https://github.com/MoonshotAI/kimi-code, https://moonshotai.github.io/kimi-code/en/). kimi.com의 소비자용 "Kimi Agent" 서비스 자체는 클로즈드 소스여서, 공식 블로그와 오픈소스(CLI, 모델 기술 보고서)로 간접 조사했다. K2.5 블로그 원문은 https://www.kimi.com/blog/kimi-k2-5.html 이며 README가 링크한다(https://github.com/MoonshotAI/Kimi-K2.5).
- **검증 원칙:** 모든 주장에 (a) 클론한 저장소 내 파일 경로, (b) 공식 URL 중 하나를 붙인다. 파일 경로는 클론 기준 상대경로이며 GitHub URL로 동일 위치를 확인할 수 있다.

---

## 2. DeerFlow (ByteDance, bytedance/deer-flow)

### 2.1 2.0 — "슈퍼 에이전트 하네스"로의 전면 재작성

- **위상:** DeerFlow 2.0은 "sub-agents, memory, sandboxes를 오케스트레이션하는 슈퍼 에이전트 하네스"로 자기 정의하며, v1과 코드 공유가 없는 전면 재작성임을 명시한다. 출처: `README.md` (https://github.com/bytedance/deer-flow#readme).
- **런타임 구조:** FastAPI Gateway(포트 8001)가 LangGraph 호환 runs/threads API와 임베디드 에이전트 런타임을 함께 제공하고, Nginx가 `/api/langgraph/*`를 게이트웨이 네이티브 라우트로 리라이트한다. 에이전트 진입점은 `packages/harness/deerflow/agents/lead_agent/agent.py:make_lead_agent`. 출처: `backend/docs/ARCHITECTURE.md` (https://github.com/bytedance/deer-flow/blob/main/backend/docs/ARCHITECTURE.md).
- **리드 에이전트 = 미들웨어 체인:** ThreadData → Uploads → Sandbox → Summarization → Title → TodoList(plan_mode) → ViewImage → Clarification 순의 미들웨어 체인이 모델 호출을 감싼다. 계획(planning)은 노드가 아니라 `TodoListMiddleware` + todo 도구로 "에이전트 내부"로 들어갔다. 출처: 같은 `ARCHITECTURE.md`의 Middleware Chain 도표.
- **상태:** `ThreadState`는 messages에 sandbox, artifacts, thread_data(workspace/uploads/outputs 경로), title, todos, viewed_images를 덧붙인 LangGraph `AgentState` 확장이다. 출처: 같은 `ARCHITECTURE.md`의 ThreadState 코드 블록.
- **1.x와의 본질적 차이 (추론):** 1.x가 "고정된 멀티노드 상태 그래프"라면 2.0은 "단일 리드 에이전트 루프 + 서브에이전트 위임 + 미들웨어 횡단 관심사"다. 그래프 구조가 설정·스킬·모델 구성으로부터 파생되며 소스에 하드코딩되지 않는다(§2.2와 비교).

### 2.2 1.x — 딥 리서치 파이프라인 (플래너/실행기 + human-in-the-loop)

- **고정 위상 그래프:** START → coordinator → background_investigator → planner → human_feedback → research_team →(researcher/analyst/coder)→ planner 재계획 또는 reporter → END. 노드 배선은 `src/graph/builder.py`의 `_build_base_graph`에 하드코딩되어 있다. 출처: https://github.com/bytedance/deer-flow/blob/main-1.x/src/graph/builder.py .
- **작업 실행 순서:** `continue_to_running_research_team`은 계획의 스텝 중 `execution_res`가 없는 첫 스텝을 찾아 step_type에 따라 researcher(RESEARCH)/analyst(ANALYSIS)/coder(PROCESSING)로 보낸다. 즉 **직렬 스텝 큐**이며 병렬 DAG가 아니다. 출처: 같은 `builder.py` 상단 라우터 함수.
- **human-in-the-loop:** `human_feedback_node`가 `auto_accepted_plan=False`이면 `interrupt("Please Review the Plan.")`로 그래프를 멈춘다. 피드백은 문자열 규약 `[ACCEPTED]`/`[EDIT_PLAN]`으로 판별하고, `[EDIT_PLAN]`이면 피드백을 `HumanMessage(name="feedback")`로 상태에 추가한 뒤 planner로 되돌아간다. 지원하지 않는 형식은 경고 후 planner로 되돌린다. 출처: https://github.com/bytedance/deer-flow/blob/main-1.x/src/graph/nodes.py (`human_feedback_node`, 458행 전후).
- **계획 검증·복구:** 승인된 계획 JSON은 `repair_json_output` → 정규화(리스트만 돌려온 Plan을 dict로 승격, 필수 필드 채우기) → `validate_and_fix_plan`(웹 검색 요구 강제) → `Plan.model_validate` 순으로 수리·검증하며, 파싱 실패 시 `max_plan_iterations` 예산 안에서 planner로 재시도한다. 출처: 같은 `nodes.py` `human_feedback_node` 후반부.
- **리포트 생성 파이프라인:** researcher/coder 실행 중 `src/citations`(collector/extractor/formatter/models)가 메시지에서 인용을 수집·병합해 state에 누적하고, `reporter_node`가 누적된 citations를 전용 citation 메시지로 조립해 리포터 프롬프트에 주입한 뒤 `final_report`를 단일 생성한다. 출처: 같은 `nodes.py` `reporter_node`(877행 전후)와 https://github.com/bytedance/deer-flow/tree/main-1.x/src/citations .
- **평가:** `src/eval` 디렉터리가 존재한다(출처: 클론 트리 나열). 상세 내용은 본 조사에서 확인하지 않았다(확인 불가).

### 2.3 2.0 — 서브에이전트 검증 스택 (Loop 완료 계약과 가장 비교 가치가 큰 부분)

DeerFlow 2.0의 `backend/packages/harness/deerflow/subagents/`는 3계층 검증 스택을 갖는다. 출처: 디렉터리 나열과 아래 각 파일.

- **1계층(프롬프트 계약) `report_contract.py`:** "최종 보고는 SELF-REPORT이며 위임자가 실행 기록과 대조해 미확증 행위 주장을 unverified로 취급한다"는 `<report_contract>` 섹션을 모든 서브에이전트 시스템 프롬프트에 주입한다. 규칙: 모든 산출물에 검증 가능한 핸들(절대 파일 경로, URL, 레코드 ID, HTTP 상태)을 붙일 것, 실패·생략·불확실을 명시할 것("수행하지 않은 행위를 주장하지 말 것"). 실행 기록 인용은 `[rN]` 형식으로 강제된다. acceptance criteria는 시스템 프롬프트가 아니라 신뢰 경계 밖 HumanMessage(태그 중화 + 경계 프레이밍)로 전달된다. 출처: https://github.com/bytedance/deer-flow/blob/main/backend/packages/harness/deerflow/subagents/report_contract.py .
- **2계층(코드 판정) `acceptance_checks.py`:** 리드가 task 위임에 붙인 `acceptance_criteria` 중 코드로 판정 가능한 것을 코드로 재확인한다. 리프 패밀리: `file:<path> json-valid`(바이트 상한 읽기+완전성 검증, NaN/Infinity 거부), `file:<path> exists/non-empty`(스레드 워크스페이스 범위 한정), `file_written:<path>`(존재+읽기 검증), `tests_passed:<command>`(성공한 실제 bash 실행 기록에 명령이 구조적으로 매칭되는지 확인 — echo 인자나 주석에 문자열이 등장하는 것으로는 앵커 불가). 그 외는 `checked=False`/`UNVERIFIED`이며 "절대 조용히 통과시키지 않는다"가 모듈 첫 문단이다. 리프 불리언 어휘는 `checked`/`holds`로 고정한다. 출처: https://github.com/bytedance/deer-flow/blob/main/backend/packages/harness/deerflow/subagents/acceptance_checks.py .
- **예산·용량:** `turn_budget.py`는 설정의 `max_turns`를 LangGraph `recursion_limit` 단위로 환산한다(미들웨어 노드 1개당 super-step 비용 때문에 직통 전달 시 예산이 조용히 축소되는 문제를 문서화). `config.example.yaml`은 `subagents.max_total_per_run` 상한을 문서화한다. 출처: https://github.com/bytedance/deer-flow/blob/main/backend/packages/harness/deerflow/subagents/turn_budget.py , https://github.com/bytedance/deer-flow/blob/main/config.example.yaml .
- **기타 서브에이전트 모듈:** `capacity.py`, `batch_acceptance.py`, `batch_runtime.py`, `batch_service.py`, `context_snapshot.py`, `status_contract.py`, `step_events.py`, `token_collector.py`가 존재한다(출처: 디렉터리 나열). 상세는 확인하지 않았다(확인 불가).

### 2.4 2.0 — 개입(intervention) 지점과 신뢰 경계

- **`RunInteractionPolicy`:** 런 컨텍스트에서 해석된 단일 정책이 리드 에이전트 도구 가시성, clarification 미들웨어 동작, 샌드박스 네트워크 승인 자격, 시스템 프롬프트 지침을 모두 결정한다. interactive가 아니면(scheduled/webhook/autonomous) 사람의 동기 응답을 기다리면 안 되며, 대신 문맥으로 최소 가역 가정을 하고 중요 가정을 나열하거나, 고위험·불가역 작업에 권한 부족 시 구조화된 `BLOCKED` 결과를 돌려야 한다. 억제된 clarification 도구 결과조차 이 경계를 보존해야 한다. 출처: `backend/docs/RUN_INTERACTION_POLICY.md` (https://github.com/bytedance/deer-flow/blob/main/backend/docs/RUN_INTERACTION_POLICY.md).
- **게이트웨이 신뢰 경계:** `interaction_mode`, `non_interactive`, `disable_clarification`, `channel_name`은 내부 호출자 전용 컨텍스트 키로, 공개 런 요청이 이를 사용해 clarification를 끄거나 채널을 사칭하거나 scheduled 런을 interactive로 되돌릴 수 없다. 명시적 모드는 레거시 힌트보다 우선하고, 알 수 없는 명시 모드는 interactive 폴백이 아니라 설정 오류다. 서브에이전트는 interactive 런에서도 대기 요청을 항상 거절한다. 출처: 같은 문서.
- **clarification 도구:** 기본 도구로 `ask_clarification`, `present_files`, `view_image`를 제공한다. 출처: `backend/docs/ARCHITECTURE.md` Tool System 도표.
- **피드백 루프:** `deerflow.reflection` 모듈(`resolvers.py`)과 `docs/LOOP_DETECTION.md`, `docs/GUARDRAILS.md`가 존재한다(출처: 디렉터리 나열). reflection 내용은 본 조사에서 심층 확인하지 않았다(확인 불가).

### 2.5 2.0 — 컨텍스트·메모리·스킬

- **프로젝트 고정 컨텍스트:** 런 입장 시 게이트웨이가 프로젝트 멤버십·선반 문서 스냅샷을 한 번 확정해 서버 소유 키에 고정하고, 미들웨어가 모델 호출마다 일회성 HumanMessage(`<project>` 블록 + 크기 상한 `<documents>` 선반 인덱스)로 렌더링한다. 사용자 서술 데이터는 시스템 프롬프트가 아니라 user 롤로 흘리고, 차단 태그 이름표로 프롬프트 인젝션을 무력화한다. 출처: `backend/docs/ARCHITECTURE.md` "Projects: Pinned Context and the Document Shelf".
- **스킬:** `packages/harness/deerflow/skills/`에 파서(frontmatter), 권한, 툴 정책, 보안 스캐너(`security_scanner.py`, `security_static_scanner.py`), 검증(`validation.py`), 리뷰(`review/`), 슬래시 커맨드(`slash.py`)가 존재한다. 출처: 디렉터리 나열. 설치·검증 파이프라인의 세부 동작은 확인하지 않았다(확인 불가).
- **장기 기능 (추정):** README가 "Long-Term Memory", "Session Goals", "Manual Context Compaction", "Scheduled Tasks"를 핵심 기능으로 나열한다(https://github.com/deer-flow#core-features). 세부 구현은 확인하지 않았다.

---

## 3. Kimi (Moonshot AI)

### 3.1 Kimi-Researcher — 종단 RL 에이전틱 리서처

- **정의:** 멀티턴 검색·추론 자율 에이전트. 태스크당 평균 23 추론 스텝, 200+ URL 탐색, 트라젝터리당 70+ 검색 쿼리(일부 쿼리 집합 기준 산술). 내부 k-계열 모델을 **종단(end-to-end) 에이전틱 RL**로만 학습해 HLE(Humanity's Last Exam) Pass@1 26.9%, Pass@4 40.17%(학습 전 8.6%). 출처: https://moonshotai.github.io/Kimi-Researcher/ .
- **도구 세트:** (1) 병렬 실시간 내부 검색 도구, (2) 대화형 웹 과업용 텍스트 기반 브라우저 도구, (3) 자동 코드 실행 도구 — 정확히 3종. 행동 형식은 `think_t, action_t`를 생성하고 `context_manager(s_t, think_t, tool_call_result_t)`가 다음 상태를 만들며, `action_t == finish`면 종료한다. 출처: 같은 블로그.
- **워크플로우 시스템 비판 (Loop 관점에서 중요한 대조):** 역할 분담 멀티에이전트 워크플로우는 특정 LLM 버전에 묶여 모델·환경이 바뀔 때마다 수동 갱신이 필요해 확장성·유연성이 떨어진다고 명시한다. SFT 모방학습은 긴 호라이즌 과업 라벨링 문제와 도구 버전 결합을 이유로 기각한다. 대안으로 단일 모델 종단 RL(계획·지각·도구 사용을 함께 학습)을 채택했다. 출처: 같은 블로그 "End-to-end agentic RL is promising but challenging".
- **학습 세부:** REINFORCE 기반, strict on-policy 데이터, 엔트로피 붕괴 완화를 위한 전략적 음성 샘플 폐기, 결과(outcome) 보상 + 무효 도구 호출 트라젝터리 형식 패널티. 합성 데이터 파이프라인은 GT 추출 + Pass@N 필터 퍼널로 비자명한 문제만 남긴다. 출처: 같은 블로그 "RL training".
- **Loop와의 관계 (추론):** Kimi-Researcher의 주장이 사실이라면, 고정 워크플로우(DeerFlow 1.x 포함)는 모델 교체 시마다 프롬프트·배선 유지보수 비용을 낸다. Loop는 이 비용을 "deterministic policy는 Rust, 모델은 교체 가능한 어댑터"로 분리해 완화하는 전략이며, 두 접근은 상충하지 않는다 — Loop 그래프는 프롬프트 워크플로우가 아니라 스케줄링·검증 계약이기 때문(§6).

### 3.2 Kimi K2 / K2.5 — 에이전틱 모델 계열

- **K2:** 1T 총모수/32B 활성 MoE, Muon(MuonClip) 옵티마이저, "tool use, reasoning, autonomous problem-solving에 맞춰 정밀 최적화된 에이전틱 지능"을 핵심 특징으로 명시. 출처: https://github.com/MoonshotAI/Kimi-K2 (README §1–2), 기술 블로그 https://moonshotai.github.io/Kimi-K2/ , 논문 https://www.arxiv.org/abs/2507.20534 .
- **K2.5:** K2-Base 위 약 15T 비주얼+텍스트 토큰으로 이어사전학습한 네이티브 멀티모달 에이전틱 모델. 핵심 특징 세 번째가 **Agent Swarm** — "단일 에이전트 스케일링에서 자기 주도적·조율된 swarm 실행으로 전환. 복잡한 과업을 병렬 서브태스크로 분해하고 동적으로 생성된 도메인별 에이전트가 실행한다". 벤치마크 표에서 Agent Swarm 적용 시 BrowseComp 78.4, WideSearch item-f1 79.0(단일 72.7 대비)을 보고한다. 출처: https://github.com/MoonshotAI/Kimi-K2.5 (README §1, §3).
- **의미 (추정):** Moonshot은 오케스트레이션을 하네스가 아닌 **모델 역량**으로 밀고 있다. swarm의 분해·조율이 하네스 내부(예: kimi-code)에서 어떻게 구현되는지는 공개 소스에서 확인되지 않는다(확인 불가).

### 3.3 Kimi Code CLI — 공식 오픈소스 코딩 에이전트 하네스

- **위상:** 터미널 AI 코딩 에이전트. 코드 읽기·편집, 셸 실행, 파일 검색, 웹 페치, 피드백 기반 다음 행동 선택. 단일 바이너리 배포, 전용 TUI, 영상 입력, 대화형 MCP 설정(`/mcp-config`), 플러그인 마켓플레이스, ACP(Agent Client Protocol) 에디터 연동. 출처: https://github.com/MoonshotAI/kimi-code (README), 공식 문서 https://moonshotai.github.io/kimi-code/en/ .
- **서브에이전트:** 내장 `coder`, `explore`, `plan` 서브에이전트를 **격리된 컨텍스트에서** 디스패치해 병렬 작업을 수행하고 메인 대화를 깨끗하게 유지한다(README "Subagents for focused, parallel work"). 서버 API 관점에서 서브에이전트는 백그라운드 태스크 `kind: "subagent"`로 레코드되며 `model`, `thinking_effort`, `subagent_type`, `parent_tool_call_id`, `output_preview` 필드를 갖는다. 출처: https://moonshotai.github.io/kimi-code/en/reference/server-api.md (`subagent` task object, Background tasks 절).
- **개입 지점:** 부수효과 도구 호출마다 승인 패널(승인/거절/이번 세션 한정 승인/영구 allow-deny 규칙). 세 가지 권한 모드 — Always Ask(기본, 읽기만 자동), Ask When Needed(`/yolo`, 일반 호출 자동 승인 + 민감 파일·위험 명령·Plan 모드 종료는 여전히 질문), Plan 모드. 계획 파일 쓰기는 승인을 트리거하지 않는다. 출처: https://moonshotai.github.io/kimi-code/en/guides/interaction.md .
- **Plan 모드:** `/plan` 또는 Shift-Tab으로 토글 — "먼저 계획하고 실행한다"(plan first, then execute). 출처: 같은 `interaction.md`, `getting-started.md`.
- **라이프사이클 훅:** 위험 도구 호출 게이팅, 결정 감사, 알림, 외부 자동화 연결을 위한 로컬 명령 훅. 출처: https://github.com/MoonshotAI/kimi-code (README "Lifecycle hooks").

### 3.4 Kimi Code CLI — 모델 라우팅 (본 태스크의 라우팅 요구와 직결)

- **`secondary_model` 도메인:** 설정에 `subagent`(서브에이전트 구성)와 **`secondary_model`(서브에이전트를 위한 보조 모델 풀)** 도메인이 존재하고, `POST /api/v1/config`로도 병합 패치된다. 프로바이더 삭제 시 서브에이전트 보조 모델 풀이 cascade된다. 출처: https://moonshotai.github.io/kimi-code/en/reference/server-api.md (`secondary_model` 행, providers 삭제 규칙).
- **모델 별칭:** 기본 모델(`default_model`)과 별칭 테이블이 분리되어 있고, `POST /api/v1/models/{model_id}:set_default`로 기본 모델만 교체한다. 출처: 같은 문서 "Models and providers".
- **Loop 시사점 (추론):** "메인=강모델, 서브에이전트=경제 모델" 분리는 Kimi Code가 설정 도메인으로 공식화한 패턴이다. 세부 스키마(어느 서브에이전트 타입에 어떤 풀을 쓰는지)는 문서에서 확인 불가.

---

## 4. Loop와의 비교

Loop 측 근거는 `docs/reliable-runs.md`와 `AGENTS.md`이다.

| 축 | DeerFlow 1.x | DeerFlow 2.0 | Kimi-Researcher / K2.5 | Kimi Code CLI | Loop (현행) |
| --- | --- | --- | --- | --- | --- |
| 작업 그래프 | 고정 위상 LangGraph 상태 그래프(coordinator→planner→feedback→research_team→reporter), 직렬 스텝 큐 — §2.2 | 리드 에이전트 루프 + 서브에이전트 위임, 그래프는 미들웨어·설정 파생 — §2.1 | 그래프 없음, 모델이 `think/action` 루프와 context_manager로 자기 주도 — §3.1 / K2.5는 모델 주도 swarm — §3.2 | 단일 세션 루프 + 격리 서브에이전트 병렬 태스크 — §3.3 | 선언적 저장 작업 그래프(DAG), 의존성+읽기/쓰기 범위, 충돌 시 직렬화 — `docs/reliable-runs.md` |
| 완료 판정 | 스텝 `execution_res` 채움 여부(자기 보고) — §2.2 | SELF-REPORT 계약 + 코드 acceptance check + `[rN]` 실행기록 인용, 판정 불가=UNVERIFIED — §2.3 | 결과 보상은 학습 시에만; 추론 시 종료는 모델 판단 — §3.1 (추정) | 태스크 상태 필드(failed/cancelled 포함) — §3.3 | completion contract: worker 성공 보고 후에도 명령 통과 필요, assertion 실패는 terminal Failed — `docs/reliable-runs.md` |
| human-in-the-loop | 계획 승인 `interrupt()` + `[ACCEPTED]`/`[EDIT_PLAN]` 문자열 규약 — §2.2 | `RunInteractionPolicy` 4모드, 비대화형은 BLOCKED 구조화 결과, 서브에이전트는 항상 거절 — §2.4 | 없음(자율 가정) — §3.1 | 도구별 승인 패널 + 3 권한 모드 + Plan 모드 — §3.3 | attention(질문/승인/실패) + `resolve` 명시 승인, `steer` 영구 지침 — `docs/reliable-runs.md` |
| 리포트/산출물 | citations 수집→reporter 단일 생성, `final_report` — §2.2 | artifacts + present_files + 검증 가능 핸들(경로/URL/ID) — §2.3 | 태스크 종료 시 최종 답 — §3.1 | 세션 산출물 + 서브에이전트 output — §3.3 | task 결과+검증 기록(`loop task --json`), 5줄 발견 요약 — `docs/reliable-runs.md` |
| 실행 분리 | 단일 프로세스 그래프 | 게이트웨이 임베디드 런타임+체크포인트 — §2.1 | 모델 내부 (확인 불가) | 서버 프로세스+재접속 복구(as_of_seq/epoch) — §3.4 | 저장된 실행 프로세스 분리, 화면 종료와 무관 지속, 소유권 임대+reconcile — `docs/reliable-runs.md` |
| 모델 라우팅 | 설정의 플래너/리서처 등 역할별 LLM — §2.2 | config.yaml 모델 팩토리 + 서브에이전트별 구성 — §2.3 | 단일 모델(학습이 곧 설계) — §3.1 | `secondary_model` 서브에이전트 풀 — §3.4 | `config/models.toml` compute-class 라우팅(strong/fallback) — `docs/reliable-runs.md` |

---

## 5. Loop가 채택하면 좋은 아이디어

### A. 완료 계약에 "판정 가능/불가" 리프 어휘 도입 — `loop-core` (completion contract) + `loop-store` (기록)

DeerFlow 2.0의 `acceptance_checks.py`는 2계층 검증을 어휘 수준까지 정식화했다: 코드로 판정되면 `checked/holds`, 판정 불가면 `checked=False` + `UNVERIFIED`이며, `tests_passed:`류 주장은 실제 실행 기록과의 구조적 매칭을 요구한다(§2.3). Loop의 completion contract는 "명령 통과"만 요구하는데, worker가 보고하는 정성 주장(예: "테스트를 돌렸다")에는 실행 기록 앵커 개념이 없다. 채택안: completion contract에 (1) 결정적 명령(기존), (2) 주장-기록 앵커 항목(해당 check와 매칭되는 worker 실행 기록 존재 여부) 두 종류를 두고, 앵커 불가 주장은 통과 대신 `UNVERIFIED`로 기록해 status에 노출한다. 근거: §2.3 출처 파일.

### B. 서브에이전트(워커) 전용 보조 모델 풀 — `config/models.toml` + orchestrator 라우팅

사용자 요청("기본 모델은 sol, 스폰 워커는 glm-5.3-flashx")은 Kimi Code CLI의 `secondary_model` 패턴과 동일하다(§3.4). Loop는 이미 `config/models.toml`에 `openai-codex/gpt-6.1-sol*`와 `zai/glm-5.3-flashx*` 프로필이 선언되어 있다(실측: 본 저장소 `config/models.toml` grep — sol 계열 3개, glm-5.3-flashx 계열 4개 프로필 존재). 따라서 남은 것은 **워커 스폰 시 기본 모델과 워커 compute class의 분리 선언**이다. 채택안: orchestrator의 worker compute-class 기본값을 `glm-5.3-flashx` 계열로, 리드/결정(decision·integration) 작업은 sol 계열로 고정하는 설정 계약을 정의한다. 단 이 변경은 본 태스크 쓰기 범위 밖이며, `bun run check`가 필요한 별도 태스크로 실행해야 한다(**추정**: 현재 라우팅 선택 코드가 어느 크레이트에 있는지는 이 조사에서 확인하지 않았다 — `docs/reliable-runs.md`가 "모델 라우팅"을 언급하는 위치로 보아 store/bridge 경계 쪽일 가능성).

### C. 검증 가능 핸들 + 인용 계약을 worker 보고 형식에 도입 — `loop-core` (작업 결과 전달) + presentation 표시

DeerFlow 2.0 `report_contract.py`의 두 줄이 핵심이다: "모든 산출물에 검증 가능한 핸들을 붙일 것(절대 경로, URL, 레코드 ID)"과 "실패·생략·불확실을 명시할 것 — 수행하지 않은 행위를 주장하지 말 것"(§2.3). Loop의 worker 지침 템플릿에 동일 문장을 도입하고, `loop task --json`의 결과 필드에 핸들 목록을 정식 필드로 두면, 후속 작업이 선행 작업 결과를 근거와 함께 검증할 수 있다. DeerFlow 1.x의 citations 수집기(§2.2)는 "리서치 결과는 인용과 함께 누적" 패턴의 오픈소스 참조 구현이다.

### D. 비대화형 실행의 BLOCKED 구조화 결과 — `loop-core` (attention 정책)

DeerFlow 2.0은 scheduled/webhook/autonomous 런에서 사람 대기 자체를 금지하고 "최소 가역 가정 + 중요 가정 나열 또는 BLOCKED"를 요구하며, 게이트웨이 키 신뢰 경계로 공개 요청이 개입 억제를 우회할 수 없게 한다(§2.4). Loop는 attention이 항상 열릴 수 있는 모델인데, 무인 실행(스케줄·웹훅)이 도입되면 attention 대기가 런을 무기한 붙잡는 문제가 생긴다. 채택안: 무인 런 정책에서 열 수 있는 attention 종류를 제한하고, 승인 필요 상황은 run을 Failed로 닫되 실패 결과에 "필요한 결정"을 구조화해 남긴다 — DeerFlow의 BLOCKED와 같은 철학이다. 서브에이전트는 대기 요청을 항상 거절한다는 규칙(§2.4)도 Loop의 "worker는 attention을 만들지 않는다" 원칙과 정합한다(AGENTS.md: attention은 결정·승인·충돌·소진 실패에만).

### E. 예산 환산의 명시적 문서화 — `loop-core`/`loop-store` (재시도·예산)

`turn_budget.py`의 교훈은 연산 예산의 단위가 런타임 내부 단위와 다르면 조용히 축소된다는 것이다: `max_turns=150`이 미들웨어 노드 구조 때문에 실제로는 약 18턴이 되었고, 미들웨어가 늘 때마다 다시 축소되었다(§2.3). Loop의 `maxAttempts`는 재시도 예산이지만, 유사한 "선언 예산 vs 실제 소비 단위" 불일치(예: completion check 명령의 타임아웃 누적, 검증이 병렬 한도에 포함되는 규칙)는 동일한 함정이다. 채택안: 예산 단위와 실제 소비 단위의 환산 규칙을 `docs/reliable-runs.md`에 명시하고, 환산을 담당하는 단일 함수를 둔다.

---

## 6. Loop의 차별점 — 유지할 개성

1. **선언적 DAG vs 모델 주도 루프/swarm.** DeerFlow 2.0과 Kimi 계열은 모두 실행 구조를 모델 역량에 위임하는 방향이다(K2.5 Agent Swarm, Kimi-Researcher의 워크플로우 비판 — §3). Loop는 의존성·범위·직렬화를 Rust 그래프 계약으로 고정한다. 모델이 바뀌어도 스케줄링·충돌 판정·terminal 종결 규칙이 흔들리지 않는 것이 Loop의 개성이다. Kimi-Researcher의 "워크플로우가 모델 버전에 묶인다" 비판(§3.1)은 프롬프트 워크플로우에는 유효하지만, 모델 무관한 계약 그래프에는 해당하지 않는다(**추론**).
2. **완료 = 명령 통과, 자기 보고 승격 금지.** Loop는 assertion 실패를 terminal Failed로 기록하고 worker 성공 보고로 대체하지 않는다(`docs/reliable-runs.md`). DeerFlow 2.0도 같은 방향이지만(§2.3) Loop는 "재시도 가능 실패 vs 계약 실패"를 더 강하게 구분한다. 이 엄격함을 완화하지 않는다.
3. **실행 프로세스 분리 + 소유권 임대 + reconcile.** 화면 종료와 런 프로세스 장애를 구분하고, 늦은 결과를 소유권으로 거절하는 구조(`docs/reliable-runs.md`)는 조사 대상 어디에도 없는 Loop 고유의 강점이다. Kimi Code의 재접속 복구(as_of_seq/epoch, §3.4)는 관찰 세션 복구에 가깝고, DeerFlow는 체크포인트에 의존한다(§2.1).
4. **steer의 소급 금지.** `steer`가 진행 중 프롬프트를 소급 변경하지 않고 이후 작업에만 적용되는 규칙(`docs/reliable-runs.md`)은 DeerFlow 1.x의 `[EDIT_PLAN]` 전면 재계획(§2.2)과 달리 진행 중 작업의 결정론을 보존한다. 유지 가치가 있다.
5. **범위 기반 병렬화.** 읽기/쓰기 범위 선언과 충돌 직렬화(§4 표)는 DeerFlow 1.x의 직렬 스텝 큐에도, Kimi의 모델 주도 분해에도 없는 명시적 계약이다.

---

## 7. 미해결·확인 불가 항목

- DeerFlow 2.0 `reflection/resolvers.py`, `GUARDRAILS.md`, `LOOP_DETECTION.md`, 스킬 보안 스캐너, 장기 기능(Long-Term Memory 등)의 내부 동작 — 본 조사 범위에서 심층 확인하지 않음(확인 불가).
- kimi.com 소비자용 "Kimi Agent"/OK Computer 서비스의 오케스트레이션 내부 — 클로즈드 소스, 공개 1차 소스 없음(확인 불가). K2.5 README의 Agent Swarm 서술(§3.2)이 유일한 공식 근거다.
- Kimi Code `secondary_model`의 상세 스키마와 서브에이전트 타입별 배정 규칙 — 문서에 도메인 존재만 확인(§3.4), 값 범위는 확인 불가.
- DeerFlow 2.0의 `subagents.max_total_per_run`과 concurrency의 실제 스케줄링 알고리즘 — `capacity.py` 미독(확인 불가).
