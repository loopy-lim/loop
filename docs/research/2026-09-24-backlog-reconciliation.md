# 우선순위 백로그 × 최신 커밋 상태 재감사 — 2026-09-24

- Task: `facts-reconcile` (research, attempt 0)
- 입력: `docs/research/2026-09-exploration-priorities.md`의 priority-1/2/3 + deferred 1~4
- 방법: 정적 분석만(읽기 전용 추적 + 오프라인 유닛 테스트 재실행). 유료 모델 호출 없음. 근거는 `file:line`.
- 대상 커밋: 보고서 기준점 이후 `a701a58`(WorkerState 어휘·computeClasses), `bbc5f31`(simplify 페르소나), `f22d744`(4방향 보고서), `cbb3b74`(store 직접 테스트), `3375414`~`33898ad`(워커 가시성·페르소나 후속)

## 상태 요약

| 항목 | 판정 | 핵심 근거 |
| --- | --- | --- |
| priority-1 `select_candidate` 교량 노출 | **착지됨** | bridge 명령 + 코드젠 + registry가 Rust 결정 실행 (아래 §1) |
| priority-2 herdr 요약 redact | **착지됨** | 1단계 확정 보고서 + 2단계 redact 적용 + 테스트 3건 통과 (§2) |
| priority-3 (a) store 직접 테스트 | **착지됨** | `migration-schema-direct.rs` 5건 통과, cbb3b74 (§3) |
| priority-3 (b) bridge 명령 직접 테스트 | **부분 착지** | 플로우 테스트 20건 존재하나 명시된 6종 명령 직접 테스트 0건 (§3) |
| deferred-1 WorkerState·프로토콜 통합 | **부분 착지** | `lost` 어휘 통일은 착지, 생성 protocol 편입·Debug 포맷 저장은 미착지 (§4) |
| deferred-2 provider-support.md 갱신 | **미착지** | P7/P8/P9 스테일 문구 그대로 잔존 (§5) |
| deferred-3 computeClasses 사다리 단일화 | **착지됨** | 하드코딩 기본값 제거, models.toml 단일 소스 주입 (§6) |
| deferred-4 simplify 5건 + 죽은 경로 | **부분 착지** | f2/f3/f4/f5 착지, f1(pi-loop 페르소나 단일 소스)만 미착지 (§7) |

## 1. priority-1 — 착지됨

- bridge 명령: `crates/loop-bridge/src/commands.rs:1020` `select_candidate`가 `loop_core::policy::select_candidate`를 호출(`:1038`). 대안 A(독립 명령)로 착지 — `commands.rs:1347` 주석 "additive exposure of the routing decision".
- 코드젠 동봉: `packages/protocol/src/generated/commands.ts:143-146` `selectCandidate`, `frame-codecs.ts:4018`, `frame-registry.ts:77`.
- TS 루프 축소: `packages/providers/src/registry.ts:1`가 `@loop/protocol`의 `selectCandidate`를 import하고 `:49`에서 실행. 구 first-match 루프는 소멸 — 이제 후보 매핑만 수행하고 가용성·역량·risk floor·비용 정렬은 Rust 소관(`:15-20` 문서 주석).
- 직접 테스트: `commands.rs:1400-1477` 5건(최저 비용 선택, risk floor, maximumCompute/적격성, 역량 요구, 전원 부적격 거부). `cargo test -p loop-bridge` lib 5건 통과.
- docs-drift 미해결 리스크 R5(risk floor)는 이 테스트로 자연 검증됨 — 우선순위 문서 §미해결 리스크의 전제가 해소.

## 2. priority-2 — 착지됨 (1·2단계 모두)

- 1단계(확인): `docs/research/2026-09-herdr-redaction-verify.md` — P12를 CONFIRMED로 승격, 누출 경로 L1~L5를 `file:line`으로 확정.
- 2단계(차단): `packages/providers/src/herdr-agent.ts:211`(성공 요약)과 `:225`(실패 요약) 모두 `redact()`로 감쌈 — `:261-262`가 `redactProviderText`로 위임. 에러 경로 `:121`도 redact. `final` 이벤트(`:231`)는 redact된 summary를 발행.
- 회귀 테스트: `packages/providers/test/herdr-redaction.test.ts` 3건 — 성공/실패/자격증명 전용 출력 케이스. `bun test` 3 pass 확인. 문서 상호참조 주석으로 검증 보고서를 인용.
- 잔여 관찰(신규, 저위험): `packages/providers/src/mirror.ts:457-460` `result()`가 `[result] ${res.summary}`를 `#publishLines`→`sink.publish`로 한 줄 제한(cleanLine) 없이 발행. 다만 모든 어댑터가 원천에서 summary를 redact하므로(herdr-agent `:211/:225`, process-provider) 자격증명 노출은 전이적으로 차단된 상태. 검증 보고서 §4가 지적한 mirror 우회 갭은 원천 차단으로 축소.

## 3. priority-3 — (a) 착지됨, (b) 부분 착지

- (a) store 직접 테스트 **착지**: `crates/loop-store/tests/migration-schema-direct.rs` — `#[path]` include로 private `schema.rs`/`migration.rs`를 공개 API 확장 없이 직접 실행. 레거시 단일 키 재작성(`legacy_global_keys_are_rewritten_without_losing_rows`), 멱등 마이그레이션, 복합키 스코핑 등 5건. `cargo test -p loop-store --test migration-schema-direct` 5 pass. 커밋 `cbb3b74`. 보조로 `tests/recovery.rs`의 `migration_creates_the_durable_orchestration_entities`도 존재.
- (b) bridge 명령 직접 테스트 **부분 착지**: `crates/loop-bridge/tests/commands.rs`(1,063행, 20 tests pass)가 플로우 수준으로 create_run/submit_plan/claim_runnable_tasks/record_worker_started/record_worker_result/record_verification/request_attention/resolve_attention/resume_run/cleanup_run/get_trace/compare_traces/get_run_plan/get_task_context/reconcile_task/claim_execution/get_snapshot을 직접 호출. src 내 단위 테스트는 select_candidate 5건.
- **그러나** 우선순위 문서가 명시한 6종 — `get_run`, `add_task`, `update_task`, `record_decision`, `pause_run`/`confirm_paused`, `subscribe_events` — 은 어느 테스트에서도 직접 호출되지 않음(`crates/loop-bridge/tests/`, `packages/orchestrator/test/` grep 0건). `cancel_run`, `record_worker_stopped`, `evaluate_worktree_removal`, `evaluate_surface_removal`도 미직접. → 남은 항목.

## 4. deferred-1 — 부분 착지

- **착지**: 어휘 1회 확정. `crates/loop-core/src/run/worker.rs:27-33` `WorkerState = {starting, running, completed, lost, cancelled}` + "deliberately no `failed` variant" 결정 주석. TS `packages/providers/src/types.ts:9`가 동일 유니온으로 `lost` 사용. 커밋 `a701a58`.
- **미착지 1 — 생성 protocol 편입 없음**: `packages/protocol/src/` 전체에 `WorkerState`/"starting" 부재(grep 0건). TS 유니온은 여전히 핸드라이트 복사(`types.ts:9`)이고 bridge `WorkerInput`/`WorkerResultInput`(`commands.rs:89-106`)은 상태 필드 자체가 없음. 이로써 `worker.rs:8-11`의 "the bridge carries it into the generated protocol, and TypeScript adapters consume the generated `WorkerState` union" 주석은 **사실과 다른 신규 drift**가 됨.
- **미착지 2 — Debug 포맷 저장 잔존**: `crates/loop-store/src/sqlite.rs:452`(preferred_compute), `:486`, `:580`(attention.kind), `:603`(task.state)이 여전히 `format!("{:?}")` 저장. 원 boundary-audit finding 5행 그대로.

## 5. deferred-2 — 미착지 (문서 갱신 지연)

- P7: `docs/provider-support.md:12` Pi 행이 여전히 "balanced/strong/frontier escalating through the codex exec lane (`gpt-5.6` …)" 서술 — pi 레인이 balanced(zai flashx)·frontier(openai-codex gpt-6-sol)를 직접 수용하는 현 models.toml 라우팅과 불일치.
- P8: 같은 행 auth 셀이 zai pi auth store만 기술 — pi 레인의 openai-codex(ChatGPT native login) 인증 경로 미기술.
- P9: `:8` Antigravity 행이 print 어댑터만 등재 — 실제 기본 mode인 `AgyPersistentProvider`(`packages/providers/src/antigravity/persistent.ts`) 미등재.
- 부분 진전: models.toml→pi models.json 동기화 단락은 `974b021`에서 추가됨. 그러나 위 3개 mismatch는 drift 보고서(`f22d744`) 이후 무변경. → 남은 항목.

## 6. deferred-3 — 착지됨

- 어댑터 생성자가 `computeClasses: ComputeClass[]`를 필수 옵션으로 요구(하드코딩 기본값 소멸): `pi/adapter.ts:16,42`, `codex/adapter.ts:22,44`, `antigravity/adapter.ts:17,37`, `antigravity/persistent.ts:23,59`, `herdr-agent.ts:26,59`, `fake.ts:38`. 생성 `ComputeClass` 유니온 타입이라 TS 사본 없음.
- 단일 소스 주입: `packages/orchestrator/src/composition.ts:105,116,123,133,143,151,220`이 models.toml 프로필의 `model.computeClass`에서 주입.
- docs-drift C4(print 어댑터 기본값에 frontier 부재)는 **무효화(stale)** — 기본값이 사라져 설정 미주입 생성이 불가능해짐.

## 7. deferred-4 — 부분 착지

| simplify finding | 상태 | 근거 |
| --- | --- | --- |
| f1 pi-loop 페르소나 3중 복제 | **미착지** | `packages/pi-loop/src/extension.ts:19-20`에 여전히 로컬 `KNOWN_PERSONA_IDS` 배열 + `PERSONA_KIND_DEFAULTS` 산문; orchestrator `persona.ts:20-34`의 단일 소스(KIND_DEFAULT_PERSONAS/PERSONA_IDS) 미도출. → 남은 항목 |
| f2 resolvePersona 이중 조회 | 착지 | `packages/orchestrator/src/persona.ts:53-55` — 조회 1회 후 분기 |
| f3 coordinator 루프 불변 옵션 | 착지 | `packages/orchestrator/src/coordinator.ts:195` `{ ...taskExecutionOptions, context, workerId, provider }` |
| f4 `persona === null \|\| === ""` 병합 | 착지 | `extension.ts:468` `if (persona && …)` 단일 조건 (구 분기 부재) |
| f5 PersonaWorkerStartInput 제거 | 착지 | `bbc5f31`; `task-execution.ts:9` 제거 주석, `:56` 조건부 스프레드 한 식, `StartWorkerInput.personaInstructions` 복원(`types.ts:45`) — 분리 금지 조건까지 함께 이행 |
| 죽은 경로: `src/jev/` 빈 디렉터 | 착지(소멸) | 디렉터 부재 |
| 죽은 경로: `BoundedPaneSender` 죽은 수출 | 무효화(stale) | `mirror.ts:1,266`가 실사용 — 워커 가시성 작업(`ecee48c`)으로 후급 해소 |

## 남은(미착지) 항목 — 경계 규칙(risk > 회귀 > 정리) 순

1. **[risk] provider-support.md 갱신** (deferred-2 잔여): P7 스테일 escalation·P8 openai-codex 인증 경로·P9 AgyPersistentProvider 미등재. 문서-코드 불일치가 운영자 계약 수준에서 지속.
2. **[risk] WorkerState 표류 정리** (deferred-1 잔여): `worker.rs:8-11` 주석이 주장하는 "generated protocol 편입"이 실제로는 없음 — 주석 정정 또는 실제 코드젠 편입 둘 중 하나로 수렴 필요. 부수로 `sqlite.rs:452,486,580,603` Debug 포맷 저장.
3. **[회귀] priority-3(b) 잔여**: 명시 6종 bridge 명령(`get_run`, `add_task`, `update_task`, `record_decision`, `pause_run`/`confirm_paused`, `subscribe_events`) 직접 테스트 0건. `pause_run`/`confirm_paused`는 orchestrator 런타임 경로(`runtime.ts:86`, `coordinator.ts:160`)에 존재하나 어떤 테스트도 직접 실행하지 않음.
4. **[정리] simplify f1**: pi-loop 페르소나 ID·기본 매핑의 orchestrator 단일 소스화.

## 신규 발견 (재감사 과정)

- `mirror.ts result()` sink 발행 라인은 cleanLine 미적용(`:457-460`, `#publishLines`) — 원천 redact로 자격증명은 차단되나, 라인 길이 제한 우회 여부는 sink 구현에 의존. 저위험 관찰.
- docs-drift C4와 test-gap의 BoundedPaneSender 항목은 최신 커밋으로 무효화 — 후속 결정 문서에서 재올리지 않아야 함.

## 검증

- `test -s docs/research/2026-09-24-backlog-reconciliation.md` — 본 파일 존재.
- `grep -q priority-1 docs/research/2026-09-24-backlog-reconciliation.md` — 라벨 포함.
- `cargo test -p loop-store --test migration-schema-direct` — 5 pass.
- `cargo test -p loop-bridge` — lib 5 + commands 20 + context 2 pass.
- `bun test packages/providers/test/herdr-redaction.test.ts` — 3 pass.
- 유료 모델 호출 없음. 정적 추적 + 오프라인 테스트만 사용.
