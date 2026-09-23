# 4방향 조사 결과 후속 조치 우선순위 — 2026-09

- 태스크: `decision-prioritize` (decision, attempt 0)
- 입력: `2026-09-boundary-audit.md`, `2026-09-docs-drift-report.md`, `2026-09-simplify-audit.md`, `2026-09-test-gap-map.md`의 findings만. 외부 코드 재조사 없음, 유료 모델 호출 없음.
- 가중 규칙: **risk(경계 위반·문서 불일치) > 회귀 위험(테스트 공백) > 정리(simplify)**. 같은 티어 내에서는 (a) 확정 여부, (b) 정책 상향(max_parallel=4, default balanced, maximumCompute=frontier)과의 상호작용, (c) 수정 시 회귀 안전망 존재 여부로 순위를 매김.

## priority-1 — 라우팅 정책의 TS 중복 제거: `select_candidate` 교량 노출

> **[상태 2026-09-24 재감사: 착지됨]** — bridge 명령 `select_candidate`(`crates/loop-bridge/src/commands.rs:1020`), 코드젠 동봉, registry의 Rust 결정 실행기화까지 확인. 근거: `docs/research/2026-09-24-backlog-reconciliation.md` §1. 아래 본문은 작성 당시 원안이며, 후속 실행은 `docs/decisions/2026-09-24-evolution-roadmap.md`를 따른다.

**조치**: loop-bridge에 `loop_core::policy::routing::select_candidate`(`crates/loop-core/src/policy/routing.rs:120`)를 래핑하는 명령을 추가하고, `ProviderRegistry.select`(`packages/providers/src/registry.ts:14-21`)를 Rust 결정의 실행기로 축소. 코드젠 동봉(`bun run codegen` + 생성물 커밋).

**근거**:
- boundary-audit findings 2행: "확정적 라우팅 정책이 Rust에 있으나 교량 미노출로 사실상 사장됨: `crates/loop-core/src/policy/routing.rs:120` `select_candidate`는 테스트에서만 호출되고, 런타임 선택은 비용/지연/리스크 무시 first-match TS 루프 `packages/providers/src/registry.ts:14-21`가 담당 — B2/A1 위반." 유일한 **Violation (moderate)** 판정.
- 정책 상향과의 결합: docs-drift R5가 서술한 risk floor(high→strong, critical→frontier)는 loop-core 정책에 있으나 위 반복문이 교량 위에서 무시한다. maximumCompute=frontier 허용 하에서 risk floor 미적용은 고위험 태스크의 저등급 실행으로 직결되는 확정 결함.

**대안 기록**:
- A(권장): 신규 독립 bridge 명령으로 래핑 — 추가적(additive)이라 기존 호출자 무영향, 격리 단위 테스트 가능.
- B: `claim_runnable_tasks`에 라우팅 결정을 접어 반환값에 후보 포함 — 왕복 없으나 claim 계약 확장으로 회귀 범위가 넓어 우선순위에서 배제.
- 결정: A. 영향 범위는 loop-bridge + 생성 protocol + `packages/providers/registry.ts` 3점으로 국소적.

**자율/판단**: 자율 실행 가능 — `cargo test -p loop-core -p loop-bridge`, `bun test packages`, `bun run codegen:check`로 검증. 유료 호출 불필요.

## priority-2 — Herdr 요약 redact 누락 확인·차단

> **[상태 2026-09-24 재감사: 착지됨]** — 1단계 확인 보고서(`2026-09-herdr-redaction-verify.md`, P12 CONFIRMED) + 2단계 redact 적용(`herdr-agent.ts:211,225`) + 회귀 테스트 3건 통과. 잔여 관찰(mirror.ts `result()` sink 라인)은 결정 문서의 "관찰 유지"로 이월. 근거: 재감사 §2.

**조치**: 1단계 — `packages/herdr`의 `read()` 구현을 정적으로 확인(docs-drift가 읽기 범위 밖으로 미검증한 P12). 2단계 — 미차단 확인 시 `herdr-agent.ts` 요약 경로(성공 208행, 실패 222행)에 어댑터 경계 redaction 적용(boundary-audit의 clean 확인: "credential redaction stay adapter-side per the architecture table").

**근거**:
- docs-drift findings 3행: "mismatch — HerdrAgentProvider가 runtime.read() 요약을 redact 없이 반환(herdr-agent.ts:208,222)하여 'summaries redacted' 계약(provider-support.md:18) 위반 소지; @loop/herdr 내부 확인 필요."
- docs-drift §5: "P12는 @loop/herdr `read()` 구현 확인 전까지 확정 불가(읽기 범위 밖)."
- 상향 가중 사유: AGENTS.md "Do not persist or log credentials"는 경계 규칙 중 최상위 강령이며 자격증명 노출 가능성은 severity가 최상. 단 확정이 아니므로 priority-1의 확정 moderate 위반 뒤에 배치.

**자율/판단**: 1·2단계 모두 자율(정적 확인 + `packages/orchestrator` redact 테스트 패턴 재사용). **human attention 필요 부분**: 확인 결과 시크릿 포함 요약이 이미 이벤트 저장소에 영속됐다면 기존 데이터 스크럽 여부 판단, 그리고 redaction 책임을 `@loop/herdr` 내부로 옮기는 안(경계 이동)은 사람 승인 대상.

## priority-3 — 데이터·명령 회귀 안전망: store 마이그레이션 + bridge 명령 직접 테스트

> **[상태 2026-09-24 재감사: (a) 착지됨 / (b) 부분 착지]** — (a) `migration-schema-direct.rs` 5건 착지(`cbb3b74`). (b) 플로우 테스트 20건 존재하나 명시 6종(`get_run`, `add_task`, `update_task`, `record_decision`, `pause_run`/`confirm_paused`, `subscribe_events`) 직접 테스트 0건 → 결정 문서 실행 3으로 확정. 근거: 재감사 §3.

**조치**: (a) `crates/loop-store`의 private `migration.rs`/`schema.rs`에 직접 테스트 추가 — 특히 레거시 키 이관(`migration.rs:8-11`) 케이스. (b) loop-bridge에서 직접 테스트 0건인 15개 public 명령 중 회귀 방어 가치가 높은 것부터(`get_run`, `add_task`, `update_task`, `record_decision`, `pause_run`/`confirm_paused`, `subscribe_events`) 순차 직접 테스트 추가.

**근거**:
- test-gap-map findings 3행: "loop-store: private `migration.rs`/`schema.rs`에 직접 테스트 없음 — 전 store 테스트가 우회 간접 실행만 하므로 레거시 키 이관(migration.rs:8-11) 회귀 방어 없음." — 데이터 무결성 회귀 방어 부재는 티어 내 최고.
- test-gap-map findings 1행: "loop-bridge: 15개 public 명령과 `events.rs` 출력 타입이 크레이트 내 직접 테스트 0건 … 일부는 orchestrator 테스트가 간접 커버."
- priority-1과의 결합: priority-1이 loop-bridge와 생성 protocol을 수정하므로, 본 안전망은 priority-1 선행 또는 병행 시 그 회귀 위험을 직접 낮춘다. 회귀 티어 유일 항목으로 top-3 진입.

**자율/판단**: 완전 자율 — 제품 코드 무변경, `cargo test -p loop-store -p loop-bridge`로 검증.

## 다음 순위 (deferred, 라벨 없음)

1. **WorkerStatus·ComputeClass의 생성 protocol 통합** — boundary-audit findings 4행("`WorkerStatus`(`packages/providers/src/types.ts:5`)는 `WorkerState`(`crates/loop-core/src/run/worker.rs:6-12`)의 `lost` 대신 `failed`를 가짐 — B4 위반 저위험") + findings 5행 부차(Debug 포맷 저장 `sqlite.rs:452`) + test-gap-map findings 2행(재수출만 존재하는 `Worker`/`WorkerState`/`WorkerResult`). risk 티어지만 저위험이고 priority-1과 생성 protocol 접점을 공유하므로 **priority-1 이후에 순차 실행**해 코드젠 충돌을 피한다. `lost`/`failed` 어휘는 Rust에서 1회 확정.
   - **상태(2026-09-24 재감사): 부분 착지** — `lost` 어휘 통일 착지(`a701a58`); 생성 protocol 편입은 없었고 `worker.rs:8-11` 주석이 사실과 다른 신규 drift가 됨 + `sqlite.rs` Debug 포맷 저장 잔존 → 결정 문서 실행 1(risk)로 확정.
   - **상태(2026-09-24 이물질 감사): 착지** — 로드맵 실행 1 착지(`37981a2`): `worker.rs:5-15` 주석이 "Nothing in the bridge transports it today"로 정정(동결 계약 서술 포함), `sqlite.rs` 저장 어휘 상수화 + `worker-state-vocabulary.rs` 동결 테스트(저장 호출의 `format!("{:?}")` 잔여 0건). 근거: `docs/decisions/2026-09-24-weird-cleanup.md` §배경 검증.
2. **provider-support.md 갱신** — docs-drift findings 1·2·4행(스테일 Pi escalation 서술, AgyPersistentProvider 미등재, openai-codex 인증 경로 누락, print 어댑터 frontier 기본값). 자율 가능하나 priority-1/2가 다시 문서를 바꾸므로 착지 후 1회 갱신.
   - **상태(2026-09-24 재감사): 미착지** — P7/P8/P9 스테일 문구 잔존(`docs/provider-support.md:8,12`). 갱신 연기 조건("priority-1/2 착지 후 1회 갱신")은 이제 충족 → 결정 문서 실행 2(risk)로 확정.
   - **상태(2026-09-24 이물질 감사): 착지** — 로드맵 실행 2 착지(`1f557a6`): provider-support.md에 mixed routing·`openai-codex`(ChatGPT native login) 인증 서술·`AgyPersistentProvider` 등재 확인. 근거: `docs/decisions/2026-09-24-weird-cleanup.md` §배경 검증.
3. **computeClasses 사다리 설정 단일화** — boundary-audit findings 3행(6개 어댑터 생성자 하드코딩). 항목 1과 묶어 처리.
   - **상태(2026-09-24 재감사): 착지됨** — 어댑터 생성자 `computeClasses` 필수 옵션화 + models.toml 단일 소스 주입. docs-drift C4는 무효화(stale) — 재상정 금지(결정 문서 준수).
4. **simplify 5건 전체** — simplify-audit findings 1–5. 전부 동작 불변의 정리 티어로 최하위. 단 **finding 5는 `PersonaWorkerStartInput`(task-execution.ts:9-13) 임시 타입 제거와 동일 PR 필수**(simplify-audit 비고: "`@loop/providers`의 `personaInstructions` 필드 복원 후속 작업이 finding 5와 함께 이루어져야 상수로 남지 않음") — 분리 금지 조건으로 기록. 죽은 경로 정리(`packages/providers/src/jev/` 빈 디렉터리, boundary-audit note 7; herdr `BoundedPaneSender` 죽은 수출 후보, test-gap findings 4행)도 여기에 묶음.
   - **상태(2026-09-24 재감사): 부분 착지** — f2/f3/f4/f5 + jev 빈 디렉터 착지(f5 분리 금지 조건까지 `bbc5f31`로 이행). f1(pi-loop 페르소나 3중 복제)만 미착지 → 다음 사이클 정리 티어 후보(결정 문서 "남긴 항목"). `BoundedPaneSender` 항목은 무효화(stale, 실사용 확인).
   - **상태(2026-09-24 이물질 감사): 전건 착지** — f1 착지(`5692091` 어휘 단일 소스 + `428b018` 산문 파생): `extension.ts:8-12`가 `@loop/orchestrator/persona` 상수를 임포트. f1~f5 전부 착지 완료. 근거: `docs/decisions/2026-09-24-weird-cleanup.md` §배경 검증.

## 미해결 리스크

- docs-drift의 not-in-scope 5건(R4 Rust 불투명성, R5 risk floor 구현, P14 jev 거부, P15 loop doctor, @loop/herdr 내부)은 미검증 — R4/R5는 priority-1 구현 중 자연 검증됨.
- test-gap-map은 파일 수준 매핑이므로 분기 공백(`GraphError::DuplicateTask`, `CoreError` 변체 등)은 커버리지 도구 도입 전까지 비가시(의존 요약 명시).
- 본 결정은 4보고서 findings에 한정: 최신 커밋이 보고서 작성 후 변경됐다면 재감사 필요.
- **[상태 2026-09-24]** "R4/R5는 priority-1 구현 중 자연 검증" 전제는 해소됨 — priority-1 착지 및 select_candidate risk floor 직접 테스트 5건으로 확인(재감사 §1). 잔여 not-in-scope(P14, P15, @loop/herdr 내부 일부)는 결정 문서로 이월.

## 검증

- `test -s docs/research/2026-09-exploration-priorities.md` — 본 파일 존재.
- `grep -q priority-1 …` / `grep -q priority-3 …` — 라벨 포함.

---

## 후속 통합 — 2026-09-24 재감사 결과와 다음 실행 확정 (`integration-docs` 추가)

> 이 문서의 본문(priority-1~3, deferred 1~4)은 작성 당시 원안 그대로 보존된다. 아래와 각 항목의 상태 표기는 `facts-reconcile` 재감사 → `decision-roadmap` 결정 → 통합 태스크(`integration-docs`)가 **추기만**으로 남긴 기록이다(기존 내용 삭제·변경 없음).

- **재감사 보고서:** `docs/research/2026-09-24-backlog-reconciliation.md` — 커밋 `a701a58`, `bbc5f31`, `f22d744`, `cbb3b74` 이후 상태: priority-1/2/3(a)/deferred-3 **착지**, priority-3(b)/deferred-1/deferred-2/deferred-4(f1) **잔여**.
- **후속 결정 문서:** `docs/decisions/2026-09-24-evolution-roadmap.md` — 잔여만 대상으로 다음 실행 3건 확정:
  1. 실행 1 [risk] WorkerState 표류 수렴 — `worker.rs:8-11` 주석 정정 + `sqlite.rs` 저장 어휘 상수화(저장 문자열 소문자 보존, 코드젠 무접점).
  2. 실행 2 [risk] provider-support.md 갱신 — P7/P8/P9.
  3. 실행 3 [회귀] priority-3(b) 잔여 — bridge 명시 6종 명령 직접 테스트.
- **실행 순서:** 실행 1 단독 선행 → 실행 2 ∥ 실행 3 병렬(배치 전체 코드젠 접점 0건). simplify f1은 그 다음 사이클 정리 티어 후보.
- **통합 검증:** 본 통합은 문서 추가만 포함(코드 무변경). `bun run test:architecture` 통과를 회귀 기준으로 한다.
