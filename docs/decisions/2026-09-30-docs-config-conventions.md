# 문서·config 관례 (G8·G9·G14·G4a 문서 축)

- 날짜: 2026-09-30
- 상태: 채택
- 입력: [갭 분석](../research/loop-gap-analysis.md) §1 G4/G8/G9/G14, §3.3
- 범위: 문서와 config 예시만. Rust core·bridge 코드 변경 없음, codegen 불요.

## 결정

1. **G8 (MCP)**: Loop는 MCP client/server를 구현하지 않는다(경계 유지). worker CLI의 기존 MCP 설정을 패스스루한다는 관례를 `docs/worker-mcp-config.md`로 문서화하고, `config/providers.example.toml`에 "Loop config에 MCP 섹션을 만들지 않는다"는 규칙을 명시한다. Loop 수준 가시성(설정 보고)은 별도 P2 어댑터 과제로 남긴다.
2. **G9 (repo-owned 설정)**: repo가 Loop 설정을 소유하는 관례를 repo 루트 `.loop/`(LOOP_CONFIG_DIR과 동일 레이아웃)로 정의하고, 채택은 전체 전환 또는 조각 복사 둘 중 하나로 한정한다(병합·marketplace 보류). 템플릿 원형을 `config/templates/`에 둔다.
3. **G14 (독립 검토)**: 새 task kind 없이 기존 `verification` kind + `reviewer` 페르소나 패턴으로 정의한다. 리스크 기반 삽입(high/critical), 작성자≠검토자, "검토 결과는 의견이지 테스트 증거가 아님"을 계약 문구로 강제한다. `docs/reviewer-pattern.md`와 `config/templates/reviewer-task.example.md`로 규정한다.
4. **G4a (샌드박스 한계)**: "write scope는 스케줄러 충돌 방지 계약이지 OS 격리가 아니다"를 `docs/sandbox-limits.md`로 규정하고 어댑터별 실제 격리 상태 표를 둔다. 능력 선언(codegen 수반)은 별도 어댑터 과제다.

## 검토한 대안

- **G8**: (a) Loop config에 `[mcp]` 섹션을 두고 어댑터가 worker CLI 설정을 렌더링 — Loop 자체 MCP 구현의 변형으로 경계 위반, 기각. (b) 패스스루 + 문서화 — 채택. 가시성 상실은 P2 어댑터 과제로 수요 확인 후 해소.
- **G14**: (a) core에 critic task kind 추가 — kind 확장과 "검토=완료" 혼동 위험, 기각. (b) 기존 kind + 페르소나 패턴 — core 변경 0, 채택.
- **G9**: (a) 설정 병합 계층과 우선순위 규칙 — 파서·테스트 비용 대비 수요 미실측, 보류. (b) 단일 디렉터리 + 복사 관례 — 채택.

## 결과

- `docs/worker-mcp-config.md`, `docs/repo-conventions.md`, `docs/reviewer-pattern.md`, `docs/sandbox-limits.md`
- `config/templates/README.md`, `config/templates/reviewer-task.example.md`, `config/templates/implementation-task.example.md`, `config/providers.example.toml` (MCP 패스스루 주석)

## 재검토 조건

- Loop 수준 MCP 가시성 수요가 실측되면 G8의 P2 어댑터 과제로 승격 (이 문서의 금지 규칙은 유지).
- repo 설정 병합 수요가 실측되면 G9에 우선순위 규칙 추가 검토.
- reviewer 패턴이 특정 리스크 클래스에서 반복 실패를 보이면 삽입 규칙 재조정.
