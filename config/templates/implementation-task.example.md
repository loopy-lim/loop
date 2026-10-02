# Task template: 구현 task (G9) — example

# Lead가 task 분해 시 쓰는 표준 구현 task 양식이다. 다른 repo는 이 파일을
# `<repo>/.loop/templates/implementation-task.md`로 복사해 팀 관례에 맞게
# 고친다 (docs/repo-conventions.md). `<...>` 자리표시자를 채워 사용한다.

kind = "implementation"
persona = "implementer"        # config/personas/defaults.toml의 kind 기본값
depends_on = ["<선행 task id들; 없으면 생략>"]

## 요구사항

- `<구현할 내용을 검증 가능한 문장으로>` — 모호한 표현은 가정을 명시하고 가장 단순한 해석으로 진행한다.
- 기존 코드 스타일·규칙을 먼저 관찰하고 그대로 따른다.

## 완료 조건 (비어 있으면 안 된다)

1. `<검증 명령>` 이 통과하는 증거를 결과에 첨부한다.
2. 선언된 write scope 밖의 파일을 수정하지 않았다.
3. 무엇을, 어디에, 어떻게 검증했는지 결과 요약에 명시했다.

## Read/Write scope

- Read: `<읽기 범위 경로들>`
- Write: `<겹치지 않는 최소 쓰기 범위>` — 범위는 스케줄러 충돌 방지 계약이지 OS 격리가 아니다 (docs/sandbox-limits.md).

## 결과 요약 양식

- 변경 파일 목록과 각 변경의 이유
- 실행한 검증 명령과 핵심 출력
- 명시한 가정 (있다면)
