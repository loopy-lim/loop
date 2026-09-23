# 다음 진화 로드맵 우선순위 결정 — 2026-09-24

- **일자:** 2026-09-24
- **상태:** 결정됨; 실행은 후속 태스크
- **결정 종류:** `decision` (decision-roadmap)
- **의존성:** `facts-reconcile` 재감사 보고서(`docs/research/2026-09-24-backlog-reconciliation.md`)
- **읽기 범위:** `AGENTS.md`, `docs/architecture.md`, `docs/decisions/**`, `docs/research/2026-09-24-backlog-reconciliation.md`, `docs/research/2026-09-exploration-priorities.md` + 인용 지점 스팟 검증
- **쓰기 범위:** 이 결정 문서만
- **가중 규칙(유지):** risk(경계 위반·문서 불일치) > 회귀 위험(테스트 공백) > 정리(simplify)

## 상호 참조(기존 우선순위 체계와의 통합)

- 원 우선순위: `docs/research/2026-09-exploration-priorities.md` — priority-1/2/3과 deferred 1~4를 정의. 본 결정 자체는 해당 문서의 순위표를 아래 재감사 결과로 **상태만 갱신 해석**한다. 후속 통합 태스크(`integration-docs`)가 같은 문서에 재감사 상태 표기와 본 문서 참조를 **추기**로 남긴다(기존 내용 무변경, 착지 해석의 기준은 본 문서).
- 재감사 근거: `docs/research/2026-09-24-backlog-reconciliation.md` — priority-1(select_candidate 교량 노출), priority-2(herdr redact), priority-3(a) store 직접 테스트, deferred-3(computeClasses 단일화) 착지 확인. 본 문서는 그 **미착지 잔여만** 대상으로 다음 실행을 확정한다.
- `docs/decisions/2026-09-23-worker-visibility.md` D3 — 스냅샷 표면(`ActiveWorkerOutput`)의 형태가 아래 실행 1의 대안 판단 근거.

## 배경 — 재감사 결과와 스팟 검증

재감사 보고서의 미착지 판정 4건을 의사결정 전에 독립 스팟 검증했다(정적 읽기만, 유료 모델 호출 없음):

| 항목 | 티어 | 검증 결과 |
| --- | --- | --- |
| provider-support.md 스테일 3건(P7/P8/P9) | risk | `docs/provider-support.md:12`의 "escalating through the codex exec lane (`gpt-5.6` …)" 서술 확인 — 현행 models.toml 라우팅(balanced=zai flashx, frontier=gpt-6-sol pi 레인)과 불일치. `:8` Antigravity 행에 `AgyPersistentProvider` 미등재 확인 |
| WorkerState 표류(deferred-1 잔여) | risk | `crates/loop-core/src/run/worker.rs:8-11` 주석이 "the bridge carries it into the generated protocol"이라 주장하나 `packages/protocol/src/` 전체에서 `WorkerState` 부재(grep 0건), bridge `WorkerInput`/`WorkerResultInput`(`commands.rs:89-106`)에 상태 필드 없음, `SnapshotOutput.active_workers`의 `ActiveWorkerOutput = {id, taskId}`에도 없음 — **주석은 사실과 다름**. TS 유니온은 `packages/providers/src/types.ts:9` 핸드라이트로 잔존. `sqlite.rs:452,486,580,603`의 `format!("{:?}")` 저장 잔존 |
| priority-3(b) bridge 6종 명령 직접 테스트 | 회귀 | `get_run`, `add_task`, `update_task`, `record_decision`, `pause_run`/`confirm_paused`, `subscribe_events` — `crates/loop-bridge/tests/`(20개 플로우 테스트 포함)에서 직접 호출 0건 확인 |
| simplify f1(pi-loop 페르소나 중복) | 정리 | `packages/pi-loop/src/extension.ts:19-21` 로컬 `KNOWN_PERSONA_IDS` + `PERSONA_KIND_DEFAULTS` 산문 확인. 단일 소스는 `packages/orchestrator/src/persona.ts:20-34`(`KIND_DEFAULT_PERSONAS`/`PERSONA_IDS`)에 존재 |

### 재상정 금지(무효화 항목 — facts-reconcile 지시 준수)

아래 2건은 최신 커밋으로 **무효화(stale)**되었으므로 후속 태스크에서 다시 올리지 않는다:

- **docs-drift C4**(print 어댑터 기본값에 frontier 부재) — deferred-3 착지로 어댑터 생성자의 하드코딩 기본값 자체가 소멸(`computeClasses` 필수 옵션화). 문제의 전제가 없다.
- **`BoundedPaneSender` 죽은 수출**(`mirror.ts`) — 워커 가시성 작업(`ecee48c`) 이후 실사용 중(`mirror.ts:1,266`).

## 결정 — 다음 실행 3건(확정)

### 실행 1 [risk] WorkerState 표류 수렴: 주석 정정 + store 저장 어휘 상수화

**문제.** 두 갈래 risk가 한 항목에 묶인다. (a) `worker.rs:8-11` 주석이 존재하지 않는 교량 편입을 주장 — a701a58가 의도한 "생성 protocol 편입"은 실현되지 않았고, 이 거짓 주석 자체가 신규 drift다. (b) `sqlite.rs:452`(preferred_compute), `:486`/`:580`(attention.kind), `:603`(task.state)이 `format!("{:?}")` 디버그 포맷을 저장 — Rust 식별자 이름이 영속 포맷의 사실상 계약이 되어, 변(variant) 개명이 **조용히 저장 문자열을 바꾸고** 기존 행과 어긋나게 한다.

**대안.**

- **안 A(채택):** 주석을 현실로 정정한다 — 교량은 오늘날 이 어휘를 수송하는 지점이 없으며(`ActiveWorkerOutput`에 state 부재), TS 유니온은 "Rust 직렬 형태와의 동결 계약 사본"이라고 명시한다. `types.ts:4` 주석에 상호 참조를 보탠다. 동시에 `sqlite.rs` 4개 지점을 `format!("{:?}")` 대신 명시적 문자열 매핑(예: `as_str()`/const 테이블, **현재 저장 문자열과 동일하게 보존**)으로 교체하고, `migration-schema-direct.rs` 패턴으로 저장 어휘가 바뀌면 실패하는 직접 테스트를 추가한다.
- **안 B(기각):** 실제 코드젱 편입 — `ActiveWorkerOutput`에 `state: WorkerState`를 추가하거나 신규 명령으로 노출하고 `bun run codegen` 후 `types.ts:9`를 생성 유니온으로 교체. AGENTS.md "Do not hand-write a TypeScript copy of a Rust domain type"를 문자 그대로 준수하는 길이나, **수송할 소비자가 없다**: 프레젠테이션은 워커 상태를 스냅샷에서 요구하지 않았고 어댑터의 `status()`는 bridge를 거치지 않는다. 소비자 없는 프로토콜 표면 확장. watch 등이 워커 상태를 실제로 요구하는 시점에 재평가한다.
- **안 C(기각):** Rust `WorkerState`를 loop-core에서 제거해 TS가 단일 소유자가 된다. 회복(recovery) 어휘(`Lost`, `ObservedWorkerState`와의 대응)의 도메인 원천을 잃고 a701a58 결정을 되돌리는 경계 이동 — "deterministic policy in Rust" 위반이자 사람 승인 대상인데 그 가치가 없다.

**채택 근거.** 안 A가 유일하게 "거짓말 제거 + 데이터 형식 계약 동결"을 소비자 없는 표면 확장 없이 달성한다. 코드젠 무접점, 저장 문자열 보존으로 기존 영속 데이터 이관 불필요.

**영향 범위.** loop-core(`run/worker.rs` 주석만), loop-store(`sqlite.rs` 4지점 + 테스트), `packages/providers/src/types.ts:4` 주석. **코드젠 접점 없음**(타입 구조 무변경).

**검증.** `cargo test -p loop-core`(serde 어휘 테스트 유지 확인), `cargo test -p loop-store`(신규 직접 테스트 포함), `bun run test:architecture`. `bun run codegen:check`로 무변경 확인(선택).

**Human attention.** (1) `types.ts:9` 핸드라이트 사본을 "동결 계약 예외"로 명시적으로 남기는 것 — AGENTS.md 복사 금지 규칙과의 긴장을 문서로 승인받는 지점(material decision). (2) 저장 어휘 자체를 바꾸는 안으로 확장할 경우 기존 영속 데이터 이관/스크럽 승인 필요 — 안 A는 문자열 보존이므로 해당 없음.

### 실행 2 [risk] provider-support.md 갱신(P7/P8/P9)

**문제.** 운영자 계약 문서가 코드·구성과 어긋난다: P7 `provider-support.md:12`의 스테일 Pi escalation 서술("codex exec lane `gpt-5.6`"), P8 같은 행의 auth 셀이 pi 레인 openai-codex(ChatGPT native login) 인증 경로 미기술, P9 `:8` Antigravity 행에 실제 기본 모드인 `AgyPersistentProvider`(`packages/providers/src/antigravity/persistent.ts`) 미등재. 원 우선순위 문서의 연기 조건("priority-1/2가 다시 문서를 바꾸므로 착지 후 1회 갱신")은 이제 충족되었다.

**대안.**

- **안 A(채택):** 현행 `config/models.toml` 라우팅·`composition.ts` 조립·인증 경로를 기준으로 3건을 즉시 갱신한다. 원 우선순위 문서의 원안.
- **안 B(기각):** provider-support.md 표를 models.toml에서 자동 생성해 drift를 근본 제거. 기각 — 이 문서의 본체는 서사(escalation 정책, 인증 경로, 제약)이고 표는 요약이다. 생성 파이프라인 유지 비용이 문서 3줄의 재감사 루프보다 크다.
- **안 C(기각):** 정리 티어로 강등해 simplify 배치에 묶는다. 기각 — 문서-코드 불일치는 이 프로젝트의 가중 규칙에서 risk 티어이며, 운영자가 잘못된 인증 경로를 따르는 실비용이 있다.

**영향 범위.** `docs/provider-support.md`만. 코드 무변경, **코드젠 접점 없음**.

**검증.** 갱신 후 스테일 문구 소멸 grep(예: `grep -c "gpt-5.6" docs/provider-support.md` → 0) + `bun run test:architecture`. 유료 호출 불필요(정적 확인).

**Human attention.** 없음 — 자율 실행. 단 인증 경로 서술은 코드/구성 기준으로만 쓰고 실제 CLI 로그인 시연은 별도 증거로 분리(AGENTS.md 검증 규칙).

### 실행 3 [회귀] priority-3(b) 잔여: bridge 6종 명령 직접 테스트

**문제.** `crates/loop-bridge/tests/commands.rs`가 20개 플로우 테스트로 대부분의 명령을 직접 호출하지만, 우선순위 문서가 명시한 6종 — `get_run`, `add_task`, `update_task`, `record_decision`, `pause_run`/`confirm_paused`, `subscribe_events` — 은 어느 테스트 파일에서도 직접 호출 0건. 특히 `pause_run`/`confirm_paused`는 orchestrator 런타임 경로(`runtime.ts:86`, `coordinator.ts:160`)에서 매 실행마다 건드리는 명령이다.

**대안.**

- **안 A(채택):** 6종 전부에 직접 테스트를 추가한다(기존 `tests/commands.rs` 플로우 패턴 재사용). 원 우선순위 문서가 명시한 목록 그대로이고, 전부 "임시 저장소 + 입력 타입"만 있으면 되는 저비용 테스트다.
- **안 B(기각):** 런타임 노출 순위로 `pause_run`/`confirm_paused` + `subscribe_events`만 좁힌다. 기각 — `add_task`/`update_task`/`record_decision`은 그래프 수정 경로(의존성·스코프 검증)라 방어 가치가 같고, 비용 차이가 없는데 덜 커버할 이유가 없다.
- **안 C(기각):** orchestrator 통합 테스트의 간접 커버에 맡긴다. 기각 — 그 간접 의존 상태가 test-gap findings 1행이 지적한 문제 그 자체다. orchestrator 테스트 수정 없이 bridge 회귀만 잡는 지점이 없다.

**영향 범위.** `crates/loop-bridge/tests/`만. **제품 코드 무변경, 코드젠 접점 없음.**

**검증.** `cargo test -p loop-bridge`(기존 lib 5 + commands 20 + 신규 6종).

**Human attention.** 없음 — 완전 자율.

## 실행 순서와 코드젠 충돌 회피

```text
실행 1(WorkerState 수렴 + store 상수화)  →  실행 2(provider-support.md) ∥ 실행 3(bridge 테스트)
```

1. **실행 1을 먼저, 단독 커밋으로.** 배치에서 유일한 제품 코드 변경이자 유일한 데이터 형식 접점이다. 문자열 보존 설계이므로 이관은 없지만, 저장 계약을 다루는 변경은 다른 변경과 섞지 않는다(재감사 가능성 유지).
2. **실행 2와 3은 병렬 무충돌.** 접점이 각각 docs, bridge 테스트로 분리된다.
3. **코드젱 충돌 회피 조건(일반화):** 본 배치 3건 중 생성 protocol 접점은 **0건**(실행 1은 안 A로 무접점). 향후 안 B(WorkerState 실제 편입)나 생성 protocol을 만지는 어떤 항목도 **한 시점에 하나만 직렬 실행**하고 `bun run codegen` 생성물을 Rust 변경과 동일 커밋에 동봉하며 `bun run codegen:check`로 확인한다 — 원 우선순위 문서의 "priority-1 이후 순차 실행" 규칙의 일반화.
4. 전 배치 완료 후 `bun run check`로 전체 회귀 확인.

## 남긴 항목(deferred)과 미해결 리스크

- **simplify f1(정리 티어, 다음 사이클 후보):** `packages/pi-loop/src/extension.ts:19-21`의 페르소나 ID·기본 매핑 산문을 `packages/orchestrator/src/persona.ts:20-34` 단일 소스에서 도출. 원 우선순위 문서의 f5 분리 금지 조건은 이미 이행됨(`bbc5f31`).
- **관찰 유지(저위험, 비활성):** `mirror.ts:457-460` `result()`의 sink 발행 라인이 cleanLine 미적용 — 원천 redact로 자격증명 노출은 전이적으로 차단됨. sink 구현이 라인 한도를 적용하는 표면이 늘어나면 재평가.
- **test-gap 한계 이월:** 파일 수준 매핑이라 분기 공백(`GraphError::DuplicateTask`, `CoreError` 변체 등)은 커버리지 도구 도입 전까지 비가시 — 원 우선순위 문서 §미해결 리스크에서 이월.
- **docs-drift not-in-scope 5건 중 잔여:** R4(Rust 불투명성)·R5(risk floor)는 priority-1 테스트로 자연 검증됨(재감사 §1). P14(jev 거부)·P15(loop doctor)·@loop/herdr 내부 잔여는 미검증 상태로 둔다.

## 검증(본 결정 문서)

- `test -s docs/decisions/2026-09-24-evolution-roadmap.md` — 본 파일 존재.
- `grep -q 대안 docs/decisions/2026-09-24-evolution-roadmap.md` — 대안 섹션 포함.
- 본 결정은 정적 읽기·grep·기존 재감사 보고서의 오프라인 테스트 결과만 근거로 함 — 유료 모델 호출 없음.
- 통합 태스크(`integration-docs`)의 HEAD 기준 인용 재검증: `worker.rs:8-11` 거짓 주석, `types.ts:9` 핸드라이트 유니온, `provider-support.md:8,12` 스테일 행, `extension.ts:19-21`·`persona.ts:20-34` 산문, bridge 명시 6종 명령 직접 테스트 0건 — 전부 현재 HEAD와 일치 확인.
- 정밀화 1건(실행 1 집행 시 필독): `sqlite.rs` 4지점의 저장 표현식은 `format!("{:?}", …).to_lowercase()`로 **소문자 문자열**이 영속된다(예: `frontier`, `question`, `running`). "현재 저장 문자열과 동일하게 보존"은 이 소문자 계약을 의미하며, 매핑 테이블·직접 테스트는 동일 소문자를 산출해야 기존 행과 호환된다.
- 경계 적합성 재확인: 실행 1의 TS 동결 사본 예외는 Human attention 항목(1)으로 사람 승인 대상으로 유지되고, 실행 2·3은 문서·테스트 접점만 건드리므로 AGENTS.md 계층 경계 및 기존 결정 문서(`2026-09-23-worker-visibility.md` D3 포함)와 모순 없음.
