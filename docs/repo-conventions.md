# Repo-owned Loop 설정·템플릿 관례 (G9)

- 상태: 채택 (갭 분석 G9, P2 부분도입 — 문서·config 축)
- 관련: [docs/environment-generalization.md](environment-generalization.md), [docs/decisions/2026-09-30-docs-config-conventions.md](decisions/2026-09-30-docs-config-conventions.md)

## 핵심 규칙

1. **repo가 Loop 설정을 소유하려면 repo 루트의 `.loop/` 디렉터리에 둔다.** 레이아웃은 `LOOP_CONFIG_DIR`과 동일하다: `models.toml`, `policy.toml`, `providers.toml`, `personas/*.md`, `templates/*.md`. 이 저장소의 `config/`가 그 원형(canonical shape)이다.
2. **병합은 없다.** 설정 해석은 단일 디렉터리 원칙을 따른다. repo 설정을 채택하는 방법은 둘 중 하나다:
   - `LOOP_CONFIG_DIR=<repo>/.loop`로 지정해 repo 설정을 전부 사용 (머신 설정 대체), 또는
   - 필요한 조각(persona·템플릿 파일)을 머신의 Loop config 디렉터리로 복사 (부분 채택).
   부분 병합·우선순위 규칙·marketplace·plugin 플랫폼은 보류다(갭 분석 §2).
3. **템플릿은 프롬프트 조각이지 런타임이 해석하는 코드가 아니다.** `templates/`의 Markdown은 Lead가 task 분해 시 복사·채워 쓰는 문서 양식이며, 새로운 config 파서나 core 개념을 요구하지 않는다.
4. **페르소나 문법은 기존 관례를 따른다.** persona는 `LOOP_CONFIG_DIR` 기준 상대 경로로 해석되는 Markdown 조각이고, `providers.toml`의 `[lead.persona]`와 `personas/defaults.toml`의 kind 기본 매핑이 선택한다.

## 채택 절차 (다른 repo에서 Loop를 쓸 때)

1. 이 저장소의 `config/`에서 필요한 조각을 `<repo>/.loop/`로 복사하고 팀 정책에 맞게 편집한다. 예: `config/templates/reviewer-task.example.md` → `<repo>/.loop/templates/reviewer-task.md`.
2. 고위험 구현에는 독립 reviewer task를 넣는다 — [docs/reviewer-pattern.md](reviewer-pattern.md)와 `templates/reviewer-task.example.md` 참조.
3. MCP 등 worker CLI별 도구 설정 위치는 팀 문서에 기록한다 — [docs/worker-mcp-config.md](worker-mcp-config.md).
4. worker의 권한 한계를 팀 온보딩 문서에 명시한다 — [docs/sandbox-limits.md](sandbox-limits.md).

## 템플릿 작성 규칙 (`templates/`)

- 파일 하나가 task 한 종류의 양식이다. 이름은 kebab-case, 확장자는 `.md`, 예시 파일은 `.example.md` 접미사를 쓴다.
- 양식은 `## 요구사항`, `## 완료 조건`, `## Read/Write scope`, `## 결과 요약 양식` 섹션을 최소 포함한다. 완료 조건은 비어 있으면 안 된다(완료 계약 불변식).
- 템플릿 안에 모델 id·엔드포인트·시크릿을 두지 않는다.
