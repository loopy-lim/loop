# Worker CLI MCP 설정 전달 관례 (G8)

- 상태: 채택 (갭 분석 G8, P1 부분도입 — 문서·config 축)
- 관련: [docs/environment-generalization.md](environment-generalization.md), [docs/decisions/2026-09-30-docs-config-conventions.md](decisions/2026-09-30-docs-config-conventions.md)

## 핵심 규칙

1. **Loop는 MCP client도 server도 구현하지 않는다.** 자체 MCP 표준·프록시·레지스트리는 만들지 않으며, `loop-core`와 Rust bridge에 MCP 개념이 유입되는 것을 금지한다. MCP 도구 접속은 순수하게 각 worker CLI의 기존 기능을 쓴다.
2. **worker는 완전한 CLI 하네스다.** pi, codex 등 worker는 이미 자체 MCP client를 가지므로, Loop는 MCP 설정을 생성·수정·삭제·병합하지 않고 자식 프로세스 환경을 그대로 패스스루한다.
3. **MCP 서버 주소와 자격증명은 Loop config에 두지 않는다.** `config/models.toml`, `config/policy.toml`, `config/providers.toml`에 MCP 항목을 추가하지 않는다. 서버 선언은 각 CLI의 네이티브 설정 파일에, 자격증명은 그 파일이 참조하는 키체인·환경 변수에 둔다.
4. **repo 단위 공유는 각 CLI의 repo-level 설정 관례를 따른다.** Loop 수준의 MCP 가시성(설정 존재 여부 보고 등)은 별도 어댑터 과제(P2)이며, 그 전에 `loop doctor`가 MCP를 검사한다는 보장도 없다.

## 어댑터별 네이티브 MCP 설정 위치

| worker CLI | MCP 설정 위치 | 비고 |
| --- | --- | --- |
| pi | pi 자체 설정 (pi 문서의 `docs/mcp.md` 참조) | `PI_CODING_AGENT_DIR` 아래 설정이 따라감 |
| codex | `~/.codex/config.toml`의 `[mcp_servers]` | codex sandbox 정책과 함께 운영자가 관리 |
| agy (antigravity) | agy 자체 설정 | Loop 개입 없음 |
| fake | 없음 | 테스트 전용 |

정확한 키·스키마는 각 CLI의 공식 문서를 따른다. Loop는 이 표의 위치를 해석하거나 검증하지 않는다.

## 운영자 절차

1. MCP 도구가 필요한 worker CLI의 네이티브 설정에 서버를 선언한다. (위 표)
2. repo 팀이 동일 MCP 서버를 공유하려면, 각 CLI가 지원하는 repo-level 설정 파일을 repo에 커밋하거나 [docs/repo-conventions.md](repo-conventions.md)의 `.loop/` 문서 관례로 설정 위치를 기록한다.
3. `loop doctor --auth`로 worker CLI 자체 인증 상태를 확인한다. MCP 연결 상태 자체는 각 CLI의 진단 명령으로 확인한다.

## 안티패턴

- Loop config에 `[mcp]` 섹션을 만들고 어댑터가 이를 worker 설정으로 렌더링하는 것 — Loop 자체 MCP 구현의 변형이므로 금지.
- worker spawn 시 MCP 관련 환경을 조건부 재작성하는 것 — 패스스루 원칙 위반.
- MCP 서버 URL·토큰을 페르소나·템플릿 문서에 기록하는 것 — 자격증명 비저장 원칙 위반.
