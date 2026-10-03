# 독립 reviewer task 패턴 (G14)

- 상태: 채택 (갭 분석 G14, P1 부분도입 — 기존 DAG task kind로 충분, core 변경 없음)
- 관련: [config/personas/reviewer.md](../config/personas/reviewer.md), [config/templates/reviewer-task.example.md](../config/templates/reviewer-task.example.md), [docs/decisions/2026-09-30-docs-config-conventions.md](decisions/2026-09-30-docs-config-conventions.md)

## 핵심 규칙

1. **독립 검토는 새로운 task kind가 아니라 기존 `verification` kind task에 reviewer 페르소나를 붙인 패턴이다.** `loop-core`에 critic 개념을 추가하지 않는다.
2. **작성자와 검토자는 달라야 한다.** reviewer task는 검토 대상 구현 task와 의존성(구현 → 검토)으로 연결하고, 같은 worker가 자기 결과를 검토하지 않게 한다.
3. **검토 결과는 의견이지 테스트 증거가 아니다.** reviewer 승인은 완료 계약을 대체하지 못한다. task의 완료 조건은 기존 검증 명령(테스트·lint·빌드) 그대로 유지되며, reviewer 판정은 그 위에 얹히는 second opinion이다.
4. **삽입은 리스크 기반이다.** risk가 `high` 또는 `critical`인 구현 task마다 독립 reviewer task 1개를 둔다. `medium` 이하는 Lead 재량(생략 가능), trivial 변경에는 두지 않는다.
5. **지적은 근거를 필수로 한다.** 파일·위치·재현 시나리오 없는 의견은 리뷰 결과에서 제외하고, 판정은 완료 조건 검증 명령의 증거에 근거한다.

## task 구성 양식

검토 대상 구현 task에 이어서:

```text
kind = verification            # 새 kind 아님
persona = reviewer             # config/personas/reviewer.md
depends_on = <대상 구현 task>
write_scope = []               # 검토는 기록 문서 1개(선택) 외 쓰기 없음
completion_check = 기존 검증 명령 유지 + 리뷰 결과 문서 존재
```

전체 양식은 [config/templates/reviewer-task.example.md](../config/templates/reviewer-task.example.md)를 따른다.

## 페르소나

- `config/personas/reviewer.md`: 사실 기반 검토, 심각도 구분(차단/권장/니트픽), 근거 필수, 최소 변경 제안.
- 페르소나 본문에 계약 문구가 이미 포함되어 있다: "판정은 완료 조건 검증 명령의 증거를 근거로 한다".

## 안티패턴

- reviewer 승인을 completion check로 대체하는 것 — 규칙 3 위반.
- reviewer가 수정을 직접 수행하는 것 — 검토자가 작성자가 되면 독립성이 소멸한다. 수정은 재지시로 구현 task에 돌아간다.
- reviewer task의 완료 조건이 "리뷰 문서 작성" 같은 파일-존재 검사로 퇴화하는 것 — 문서 존재가 아니라 근거 포함 판정을 요구해야 한다.
- 모든 task에 무조건 reviewer를 붙이는 것 — 규칙 4의 리스크 기준을 무시하면 검토 비용만 증가한다.
