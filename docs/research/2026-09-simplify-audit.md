# Simplify 감사 — 페르소나 하위시스템 최근 변경 (2026-09)

- 태스크: `fact-simplify-audit` (research, 읽기 전용)
- 방법: `git log`/`git diff`로 변경 범위를 확인한 뒤, simplify 지침(명확성·일관성, 동작 변경 금지)을 적용해 정적 검토. 유료 모델 호출 없음.

## 검토 범위 (git status 기준)

| 파일 | 상태 |
| --- | --- |
| `packages/orchestrator/src/config.ts` | 수정 (+27) |
| `packages/orchestrator/src/coordinator.ts` | 수정 (+6) |
| `packages/orchestrator/src/index.ts` | 수정 (+1) |
| `packages/orchestrator/src/runtime.ts` | 수정 (+3) |
| `packages/orchestrator/src/task-execution.ts` | 수정 (+23) |
| `packages/orchestrator/src/persona.ts` | 신규 (69줄) |
| `packages/pi-loop/src/extension.ts` | 수정 (+36) |

변경 주제는 워커 페르소나 계약(docs/decisions/2026-09-22-worker-persona-contract.md)의 구현: config 로딩(`loadPersonaRegistry`), advisory 해석(`resolvePersona`), worker 시작 입력 전달, Lead 도구 설명·제출 검증.

## findings (개선 기회, 모두 동작 불변 제안)

1. `packages/pi-loop/src/extension.ts:96-108,129-130` — 페르소나 ID 목록·kind 기본 매핑이 배열 1개 + 산문 2벌(107행 `personaFieldDescription()` 내부, 129-130행 도구 설명)로 3중 복제됨. pi-loop은 이미 `@loop/orchestrator` 의존(extension.ts:7-8)이므로 `KIND_DEFAULT_PERSONAS`/ID 집합을 단일 소스에서 파생하고 도구 설명을 `personaFieldDescription()`으로 조립. 효과: 프롬프트 문구와 실제 해석 정책의 드리프트 원천 제거.
2. `packages/orchestrator/src/persona.ts:44-65` — `resolvePersona`가 kind 기본 조회(`KIND_DEFAULT_PERSONAS[kind]` + registry 확인)를 두 분기(45-46행, 58-59행)에서 반복. 조회를 1회 수행 후 결과로 분기하도록 추출. 효과: 폴백 경로 단일화로 경고 조건 검증 난이도 하락, ~6줄 감소.
3. `packages/orchestrator/src/coordinator.ts:183` — `executeTask` 호출 옵션(7개 필드)이 스케줄 루프 안의 한 긴 인라인 라인. 루프 불변 필드(`control`/`verifier`/`personas`)는 루프 진입 전 1회 조립으로 분리. 효과: 핫 루프 가독성 향상, 불변 옵션의 1회 생성이 명시적.
4. `packages/pi-loop/src/extension.ts:474` — `persona === null || persona === ""`는 `!persona`와 동치(둘 다 falsy, 반환문 동일). 조건 병합. 효과: 동일 결과 분기 2개 → 1개.
5. `packages/orchestrator/src/task-execution.ts:56-57` — startInput 리터럴 선언 직후 조건부 대입으로 `personaInstructions`를 덧붙이는 2단 구성은 임시 타입(`PersonaWorkerStartInput`, 9-13행)의 임시성을 흐림. 조건부 스프레드 등 한 식으로 병합(현재 `personaInstructions`의 소비자는 이 지점뿐이므로 속성 접근 의미론 불변). 효과: 워커 시작 입력 구성이 한 눈에 들어옴, 임시 타입 제거 시 수정점 단일화.

## 비고 및 리스크

- `packages/orchestrator/src/task-execution.ts:9-13`의 `PersonaWorkerStartInput`은 문서화된 임시 구조적 상위타입(`@loop/providers`의 `StartWorkerInput.personaInstructions` 필드 복원 전까지). finding 5와 함께 후속 PR에서 한 번에 제거해야 임시 코드가 남지 않음.
- finding 1의 파생 방향은 기존 의존 방향(pi-loop → orchestrator)과 일치하며, 경계 규칙(orchestrator에 provider/Pi 개념 금지)을 위반하지 않음 — persona.ts는 이미 그 규칙을 지키고 있음.
- `resolvePersona`의 "미등록 registry는 침묵, 등록됐는데 기본 누락은 경고" 구분(persona.ts:60-65)은 주석으로 근거가 명시돼 있어 단순화 대상에서 의도적으로 제외.
- 본 감사는 읽기 전용: 어떤 소스 파일도 수정하지 않았고, 본 보고서만 작성함.

## 검증

- `test -s docs/research/2026-09-simplify-audit.md` — 통과(본 파일)
- `grep -q \.ts: docs/research/2026-09-simplify-audit.md` — 통과(findings 전항에 `.ts:` 근거 포함)

---

## 착지 상태 — 2026-09-24 추기 (`implement-cleanup`)

> 본문은 작성 당시 감사 스냅샷 그대로 보존한다(기존 내용 무변경). 아래는 `docs/decisions/2026-09-24-weird-cleanup.md`(§배경 검증)가 확인한 착지 사실의 추기다.

- **f1 — 착지** (`5692091` 어휘 단일 소스 + `428b018` 산문 파생): `packages/pi-loop/src/extension.ts:8-12`가 `@loop/orchestrator/persona`의 `KIND_DEFAULT_PERSONAS`·`PERSONA_IDS`·`EXPLICIT_ONLY_PERSONA_IDS`를 임포트하고 산문이 상수에서 파생. 로컬 `KNOWN_PERSONA_IDS` 부재.
- **f2 — 착지**: `packages/orchestrator/src/persona.ts:53-67` — kind 기본 조회 1회 후 결과로 분기.
- **f3 — 착지**: `packages/orchestrator/src/coordinator.ts:196` — `{ ...taskExecutionOptions, context, workerId, provider }` 한 식 전개.
- **f4 — 착지**: `packages/pi-loop/src/extension.ts:477-483` — `if (persona && …)` 단일 조건.
- **f5 — 착지** (`bbc5f31`, 분리 금지 조건 이행): `packages/orchestrator/src/task-execution.ts:56` 조건부 스프레드 한 식 + `packages/providers/src/types.ts:51` `personaInstructions` 복원. 임시 타입 `PersonaWorkerStartInput` 소멸(제거 이력 주석만 잔존).
- 부수: jev 빈 디렉터리 소멸. `BoundedPaneSender`는 실사용(`packages/providers/src/mirror.ts:2,276`)으로 "죽은 수출 후보" 판정은 무효 — 재상정 금지.
