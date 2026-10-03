# 샌드박스 한계 — write scope는 OS 격리가 아니다

- 상태: 채택 (갭 분석 G4a, P0 부분도입의 문서 축)
- 관련: [docs/reliable-runs.md](reliable-runs.md), [docs/decisions/2026-09-30-docs-config-conventions.md](decisions/2026-09-30-docs-config-conventions.md)

## 핵심 규칙

1. **write scope는 스케줄러의 소유 범위 계약이지 운영체제 수준의 파일 접근 격리가 아니다.** Loop는 쓰기 범위가 겹치는 작업을 동시에 배정하지 않을 뿐, worker 프로세스의 파일시스템 접근을 차단하지 않는다.
2. **worker는 호출한 사용자의 권한으로 실행된다.** worker가 scope 밖 경로에 쓰는 것을 Loop가 기술적으로 막지 못하며, 이를 전제한 보안 설계를 하지 않는다.
3. **write scope를 보안 경계로 취급하지 않는다.** 신뢰 경계는 (a) 완료 계약 검증 명령, (b) 독립 reviewer task([docs/reviewer-pattern.md](reviewer-pattern.md)), (c) 사용자가 운영하는 외부 샌드박스(컨테이너·VM)뿐이다.
4. **자격증명은 worker 환경에 노출을 최소화한다.** 시크릿은 환경 변수·OS 키체인·provider 네이티브 인증에만 두고 Loop가 저장·전달·로그하지 않는다(README 불변식).

## 어댑터별 실제 격리 상태

| 어댑터 (worker CLI) | 실행 형태 | Loop가 제공하는 격리 | 비고 |
| --- | --- | --- | --- |
| pi | interactive TUI / `pi -p` 헤드리스 | 없음 — 사용자 권한 프로세스 | MCP 등 도구 설정은 pi 자체 설정 따름 |
| codex | exec 드라이버 | 없음 — codex 자체 sandbox 정책에 위임 | codex를 sandbox 모드로 실행하는 것은 운영자의 codex 설정 책임 |
| agy (antigravity) | persistent stream-json | 없음 — 사용자 권한 프로세스 | 키는 agy 네이티브 인증에만 존재 |
| zai | API 호출 | 해당 없음 — 파일시스템 접근 없음 | |
| fake | 테스트 전용 | 없음 | 유료 호출 없는 검증용 |

## 능력 선언과의 관계

어댑터별 sandbox 능력 선언(능력 없음도 명시적으로 보고)과 `loop doctor` 보고는 별도 구현 과제(G4a의 어댑터 축)이다. 이 문서는 한계를 규정하며, 능력 선언이 도입되어도 규칙 1–3은 변하지 않는다: 능력 선언은 사실을 보고할 뿐 격리를 제공하지 않는다.

## 운영 체크리스트

- [ ] 신뢰할 수 없는 코드를 다루는 run은 컨테이너·VM 등 외부 격리 안에서 실행했는가?
- [ ] worker 환경에 불필요한 시크릿이 들어가지 않았는가?
- [ ] write scope 겹침 판정은 스케줄러 충돌 방지용임을 팀 문서·온보딩에 명시했는가?
- [ ] 고위험 변경에 독립 reviewer task를 두었는가? ([docs/reviewer-pattern.md](reviewer-pattern.md))
