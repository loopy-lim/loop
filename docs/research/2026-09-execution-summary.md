# 탐색 우선순위 실행 요약 — 2026-09

- 태스크: `integration-final-check` (integration, attempt 0)
- 근거: `docs/research/2026-09-exploration-priorities.md`의 priority-1/2/3 + deferred 실행 결과 통합 검증
- 검증: `bun run check` 전체 통과 (exit 0) — codegen:check ✓, typecheck ✓, architecture ✓, cargo workspace 97 pass / 0 fail, bun test 233 pass / 0 fail (35 files)

## priority-1 — 라우팅 정책 교량 노출 (착지)

- loop-bridge `select_candidate` 명령(`crates/loop-bridge/src/commands.rs:1020`)이 loop-core `policy::select_candidate`을 래핑. 대안 A(독립 명령)로 채택, 커밋 ecee48c 경유로 착지.
- `ProviderRegistry.select`(`packages/providers/src/registry.ts`)는 first-match 루프 대신 생성 protocol의 `selectCandidate`를 호출하는 실행기로 축소 — 가용성 필터·risk floor·cost/latency 정렬이 전부 Rust 결정으로 이동. docs-drift R5(risk floor 무시) 결함 해소.
- 미커밋 마무리: `ProviderCapabilities.computeClasses: string[]` → 생성 `ComputeClass` 타입으로 교체해 `as ComputeClass` 캐스트 제거(registry.ts, 어댑터 6종). TS 사본 없이 wire 타입 재사용.

## priority-2 — Herdr 요약 redaction (확인 → 차단 착지)

- 검증 보고서 `docs/research/2026-09-herdr-redaction-verify.md`: `@loop/herdr` read() 체인과 성공·실패 요약 경로의 redact 누락을 CONFIRMED로 확정(누출 경로 L1–L5, file:line 근거).
- 차단은 커밋 ecee48c로 착지: `herdr-agent.ts` 성공(210행)·실패(224행) 요약 모두 `redactProviderText` 경유 redact 후 반환·발행, 직접 테스트 `packages/providers/test/herdr-redaction.test.ts`(`Authorization: Bearer`, `api_key=` scrub 단언)가 bun test에서 통과. 어댑터 경계 redaction 원칙(boundary-audit clean 판정) 유지.
- 비고: 검증 보고서의 verdict 서술은 수정 착지 이전 시점 기준 — 최종 상태는 "확인된 결함 + 차단 착지 + 테스트 통과".

## priority-3 — store 마이그레이션 + bridge 직접 테스트 (store 신규 착지, bridge 기존 커밋 확인)

- 신규 `crates/loop-store/tests/migration-schema-direct.rs`(미커밋): private `migration.rs`/`schema.rs`를 `#[path]` include로 직접 시험. 신규 DB 전체 스키마 설치, 레거시 전역 키 재작성 시 행·리플레이 무손실, 재이관 멱등성, 부분 이관 테이블 허용, run별 복합키 스코핑, 캐시 프로젝션=리플레이 일치·손상 복구 — cargo test에서 통과.
- loop-bridge 직접 테스트는 커밋됨: `tests/commands.rs`(45개 시험 함수) + `src/commands.rs` 유닛 5개(`select_candidate_prefers_the_cheapest_eligible_candidate` 등).

## deferred-1 + finding 5 — 직렬 체인 (착지, 미커밋)

- `WorkerStatus` → `WorkerState` 어휘 통일: terminal-without-result를 loop-core serde 어휘 `lost`로 단일화(types.ts 신규 유니언, herdr-agent.ts 등 어댑터 전반). loop-core 측 직렬화 시험 `serde_vocabulary_is_snake_case_and_lost_not_failed` 통과.
- `StartWorkerInput.personaInstructions` 복원(D4) — finding 5와 동일 변경으로 처리: `task-execution.ts`의 임시 상위타입 `PersonaWorkerStartInput` 제거, 조건부 스프레드 한 식 구성. simplify-audit의 분리 금지 조건 준수.

## simplify findings 1–4 (병렬, 착지)

- finding 1 적용: `extension.ts`가 `KNOWN_PERSONA_IDS`/`PERSONA_KIND_DEFAULTS` 단일 상수에서 도구 설명·검증·프롬프트 문서(`lead/prompts.ts`)를 조립. 신규 `packages/pi-loop/test/persona.test.ts` 5건 통과(제출 시점 미지 id 거부, blank→null 전달 등).
- finding 4는 `normalizePersonas`의 `persona || null` 정규화로 조건 자체가 소거. finding 2·3(persona.ts 단일 조회, coordinator.ts 루프 불변 옵션 호이스트)은 커밋된 코드에서 이미 충족 — 재변경 불요.

## 미착지 및 잔여 리스크

1. **deferred-2 문서 갱신 미반영(최상위 리스크)**: impl-docs-refresh의 변경(`docs/provider-support.md` +9 — Antigravity print/persistent 행 분리·`by default` 제거, `docs/model-routing.md` +4 — selectCandidate 결정 서술)이 작업 트리에 없고 **`git stash@{0}`("wip-remainder2")에 보관**됨. 스태시는 protocol 재생성 변형(frame-codecs −75, schema.json +26 등)과 구버전 types.ts/extension.ts 스냅샷을 포함하며, 현재 트리의 동일 파일들과 갈라져 있음. 문서 hunk만 선별 반영하더라도 재검증 필요 — 무선택 pop은 codegen:check 불일치 소지. 후속 태스크(사람 확인) 권고.
2. WorkerState의 생성 protocol 편입(스태시 변형이 지향한 방향)은 미채택 — 현 트리는 TS 로컬 미러 유니언으로 커밋된 Rust bridge와 codegen:check 일치. protocol 편입을 원하면 Rust 타입 선变更 후 `bun run codegen` 재실행 필요.
3. `bun run check`는 `test:packaged`(dylib 스테이징 포함)를 실행하지 않음 — verify-packages가 지적한 dylib 재스테이징 이슈는 이 검증 범위 밖.
4. Rust 마이그레이션 실패 주입(제약 위반 롤백) 테스트 미커버 — verify-rust-crates 보고와 일치.
5. 하우스키핑 대상 잔여物(읽기 전용 확인만 함): `check_output.txt`, `fix-ts.js`, `scratch.ts`, `pi-extensions/` 미추적 파일.

## 검증

- `bun run check` — exit 0 (codegen:check → typecheck → test:architecture → cargo test --workspace && cargo build -p loop-bridge && bun test)
- `test -s docs/research/2026-09-execution-summary.md` — 통과(본 파일)
