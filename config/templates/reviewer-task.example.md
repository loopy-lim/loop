# Task template: 독립 reviewer task (G14) — example

# Lead가 고위험(high/critical) 구현 task 뒤에 붙이는 verification-kind task
# 양식이다. 사용법과 금지사항은 docs/reviewer-pattern.md를 따른다.
# `<...>` 자리표시자를 채운 뒤 task 본문으로 사용한다.

kind = "verification"          # 새로운 task kind가 아니다 — 기존 kind 재사용
persona = "reviewer"           # config/personas/reviewer.md
depends_on = ["<검토 대상 구현 task id>"]
write_scope = []               # 검토는 쓰기를 하지 않는다 (리뷰 결과 문서 1개는 선택)

## 요구사항

- 검토 대상: `<구현 task의 요구사항 전문 또는 참조>` — 원 요구사항 없이 diff만 검토하지 않는다.
- 결과물: 리뷰 결과를 다음 섹션 양식으로 작성한다.

## 완료 조건 (비어 있으면 안 된다)

1. 기존 검증 명령을 그대로 실행하고 증거를 첨부한다: `<원 task의 검증 명령>` — reviewer 승인은 이 증거를 대체하지 않는다.
2. 리뷰 결과에 모든 지적에 근거(파일·위치·재현 시나리오)가 포함되어 있다.
3. 판정(문제 없음 / 차단 / 권장 / 니트픽)이 명시되어 있다.

## Read/Write scope

- Read: `<검토 대상 task의 read+write scope>` (구현 결과 전체를 읽을 수 있어야 한다)
- Write: 없음 — 리뷰 결과 문서를 쓴다면 `docs/reviews/<run-id>-<task-id>.md` 하나뿐이다.

## 결과 요약 양식

- 판정: (문제 없음 | 차단 N건 | 권장 N건 | 니트픽 N건)
- 차단 사항: 각 항목에 파일·위치·시나리오·최소 수정 제안
- 검증 증거: 실행한 명령과 핵심 출력 (비었으면 판정 불가)
- 의견(테스트 증거 아님)임을 명시하는 문구
