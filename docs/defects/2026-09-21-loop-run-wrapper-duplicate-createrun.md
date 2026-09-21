# Defect: loop_run 래퍼의 중복 createRun으로 런이 빈 채 생성됨

- **상태**: open (2026-09-21 기록)
- **영향**: `loop_run` 도구로 runId를 지정해 제출하면 런이 생성된 뒤 플랜 제출이 실패하고, 런이 태스크 없는 채 `active`로 남는다.
- **재현**: 2026-09-21 `loop-ui-output-limits` 런 (태스크 4개, runId 지정)

## 증상

1. `loop_run` 호출(intent + tasksJson + runId) → 도구가
   `projection error: run has already been created` 반환.
2. `loop status <runId> --json` → `tasks: []`, `state: "active"` —
   런 레코드만 존재하고 플랜은 반영되지 않음.

## 관측된 근거

- 저장소 소스 기준 `coordinator.run()`은 `createRun` → `submitPlan` 순서로 항상
  런 생성을 시도한다(`packages/orchestrator/src/coordinator.ts`).
- 확장 경로는 `dist/loop __execute-plan`을 spawn하며 payload의 runId를 그대로 사용한다
  (`packages/pi-loop/src/extension.ts`).
- reducer는 동일 runId의 `CreateRun` 이벤트가 두 번 적용되면
  `run has already been created` 오류를 낸다(`crates/loop-core/src/event/reducer.rs`).
- 따라서 **확장 외부의 loop_run 래퍼가 먼저 createRun을 수행**하고, 확장의 CLI 경로가
  같은 runId로 다시 createRun → 충돌. 래퍼가 만든 런은 태스크가 비어 있다.
- 부수 관측: 래퍼는 tasksJson 검증 시 저장소 생성물과 다른 (구버전) 코덱 사본을 사용하는 것으로 보인다.
  소스 수정 전 동일 호출이 `invalid enum value for kind: undefined` 및
  `args.tasks[_i].completionChecks[_i].id` TypeError를 냈는데, 이는 저장소 소스의
  생성물에서는 재현되지 않는 경로다. (루트 원인은 rustra-bridge 코드젠의
  vec_struct 루프 변수 섀도잉 — 별도 커밋으로 수정, 재생성·와이어 검증 완료.)

## 제안 수정 (우선순위 순)

1. 래퍼가 런을 선생성하지 않도록 변경 — 런 생성은 확장 CLI 경로에 일임.
2. 또는 `coordinator.run()`이 기존 런을 재사용: `getSnapshot`으로 존재 확인 후
   `submitPlan`만 수행(멱등 제출).
3. 래퍼의 tasksJson 검증 코덱을 생성물과 동기화하거나 검증을 저장소 생성물로 위임.
