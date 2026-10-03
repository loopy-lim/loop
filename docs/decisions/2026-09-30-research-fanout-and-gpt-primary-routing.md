# 리서치 fan-out 기본화와 gpt-6.1-sol primary 라우팅 승격

- **일자:** 2026-09-30
- **상태:** 결정됨; Lead 스탠딩 규칙(`config/personas/lead-default.md`)으로 영속화
- **결정 종류:** `decision` (routing + delegation pattern)
- **관련 결정:** `docs/decisions/2026-09-23-gpt6-pi-lane.md`, `docs/decisions/2026-09-28-goal-closure-and-routing.md`, `docs/decisions/runtime-fast-class-gpt6.md`

## 배경

- 2026-09-30, 사용자는 gpt 레인(openai-codex, ChatGPT 네이티브 로그인)에 쿼터 여유가 있다고 판단하고 gpt 레인을 기본으로 쓰기로 결정했다.
- 기존 라우팅은 zai 볼륨 레인(`zai/glm-5.3-flashx`)이 fast/balanced/strong을 1차로 담당하고 gpt 레인이 폴백이었다.
- 동일 날짜에 "fast를 gpt로 옮기자"는 시도가 있었으나 정정되었다: **fast/tiny는 zai/glm primary를 유지**한다. GPT의 "fast 옵션"은 compute class `fast`가 아니라 GPT의 fast thinking 프로필(`gpt-6.1-sol:minimal`)을 의미한다 — 두 표현은 다른 개념이며 혼용이 실제 오류의 원인이었다.
- 별도로, 리서치·탐색성 작업이 단일 워커에 몰리면 병렬성과 소스 다양성이 손해본다는 관찰이 있었다.

## 결정

1. **compute 라우팅:** `balanced`와 `strong`의 primary를 `openai-codex/gpt-6.1-sol`로 승격하고, zai 볼륨 레인(`zai/glm-5.3-flashx`)은 폴백으로 내린다. GPT는 이 두 클래스에서 fast thinking 프로필(`:minimal`/`:low`)로 운용한다. `fast`/`tiny`는 zai/glm primary를 유지하고 gpt는 폴백(각각 `:minimal`, gpt-6-luna)으로만 남는다. `frontier`는 bare `gpt-6.1-sol` 그대로다. `routing.default_compute_class`는 `balanced` 유지(같은 날 "fast"로 바꿨다가 철회).
2. **용어 규약:** "fast 옵션"은 문맥상 GLM `fast` 클래스가 아니라 GPT fast thinking 프로필을 뜻할 수 있다. Lead는 모호하면 진행 전에 확인한다.
3. **리서치 위임 패턴:** 리서치·탐색성 작업의 기본 패턴은 주제·소스별 병렬 섹션 워커 **fan-out** 후 통합(integration) 작업으로 병합이다. 단일 워커 몰아주기는 기본이 아니다.
4. **영속화:** 위 규칙을 Lead 페르소나 `config/personas/lead-default.md` 스탠딩 규칙으로 기록하고, `config/providers.example.toml`의 `[lead.persona.files]`에 `lead-default` 항목을 추가한다.

## 결과

- `config/models.toml`: balanced/strong에서 gpt-6.1-sol(`:minimal`/`:low` 포함) 엔트리가 zai 엔트리보다 앞서고, 상단 정책 주석이 본 결정으로 갱신됨.
- `config/policy.toml`: `default_compute_class = "balanced"` 유지.
- `config/personas/lead-default.md` 신설 + `scripts/install-personas.sh`로 `LOOP_CONFIG_DIR/personas/`에 설치.
- `config/providers.example.toml` `[lead.persona.files]`에 `lead-default = "personas/lead-default.md"` 추가. 활성화하려면 활성 `providers.toml`에 `[lead.persona] active = "lead-default"`와 files 항목이 필요하다.
- 리서치 태스크 분해 시 Lead가 fan-out을 기본 위임 패턴으로 따른다.
