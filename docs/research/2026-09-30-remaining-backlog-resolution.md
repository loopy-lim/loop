# 잔여 백로그 최종 해소 감사 — 2026-09-30

- Task: `integration` (run aa6b7ecd, attempt 0)
- 입력: `docs/research/2026-09-24-backlog-reconciliation.md`의 남은(미착지) 항목 4건 + 이번 run의 WorkerState 코드젱 편입 착지물
- 방법: 정적 추적(file:line) + 오프라인 테스트/벤치마크 재실행만 사용. **유료 모델 호출 없음** (벤치마크는 `fake:baseline`/`fake:alternative` 프로파일로 실행).
- 의존 결과 반영: `bridge-test-state-fix`(bridge 테스트 19곳 `state: None` 보강), `providers-consume`(providers 핸드라이트 사본 제거·재노출 전환)

## 상태 요약

| 항목 (2026-09-24 잔여) | 최종 판정 | 핵심 근거 |
| --- | --- | --- |
| 1. [risk] provider-support.md 갱신 (deferred-2) | **해소** | P7/P8/P9 스테일 문구 전부 현 라우팅·인증 경로로 교체 (§1) |
| 2. [risk] WorkerState 표류 정리 (deferred-1) | **해소 — 단, 신규 코드젱 회귀 발견** | 생성 protocol 편입 완료, sqlite Debug 포맷 소멸. 그러나 코드젱 재생성이 complex-binary 코덱 경로를 유발해 전체 검사가 막힘 (§2, §5) |
| 3. [회귀] priority-3(b) 명시 6종 bridge 명령 직접 테스트 | **해소** | `commands-direct.rs`에 6종 전부 직접 테스트 존재 (§3) |
| 4. [정리] simplify f1 pi-loop 페르소나 단일 소스 | **해소** | `extension.ts`가 `@loop/orchestrator/persona` 어휘를 도출해 사용 (§4) |

## 1. provider-support.md 갱신 — 해소

- P7(스테일 escalation): `docs/provider-support.md:12` Pi 행이 이제 `config/models.toml` 2026-09-30 gpt-primary 결정을 서술 — balanced/strong 주력 `openai-codex/gpt-6.1-sol`, zai 항목은 클래스 폴백으로 강등, "the codex-exec provider lane was removed (2026-09)" 명시. 구 "balanced/strong/frontier escalating through the codex exec lane" 문구 소멸.
- P8(openai-codex 인증 경로): 같은 행 auth 셀이 zai pi auth store와 함께 "pi's `openai-codex` provider with ChatGPT native login (credentials stay in pi's own auth store, never logged or persisted by Loop)"를 기술. `:26` doctor 단락도 openai-codex ChatGPT 로그인이 Loop 측 저장소 밖에 있음을 명시 — 자격증명 비저장 계약과 일치.
- P9(AgyPersistentProvider 미등재): `:8` Antigravity 행이 "AgyPersistentProvider by default (`mode = "persistent"` … `packages/providers/src/antigravity/persistent.ts`)"를 등재하고 persistent/Herdr/print 모드별 기능 표를 분리.
- 근거 방법: `grep -n "escalating\|AgyPersistent\|ChatGPT\|persistent" docs/provider-support.md` — 구 P7 문구 0건, 신규 서술 3건 존재.

## 2. WorkerState 코드젱 편입 — 해소 (단, 신규 회귀 §5)

이번 run이 deferred-1의 미착지 2건을 모두 착지했다.

- **생성 protocol 편입**: `packages/protocol/src/generated/schema.json` definitions에 `WorkerState` 존재(enum `starting/running/completed/lost/cancelled`, 도메인 서술 주석 동봉), `types.ts`·`frame-codecs.ts`가 동일 정의 수송. `WorkerInput`/`WorkerResultInput` 입력 스키마에 optional `state` 필드(`anyOf: [WorkerState, null]`) 생성.
- **bridge 수송 필드**: `crates/loop-bridge/src/commands.rs:165,185` `state: Option<WorkerState>` — 부재 상태도 유효한 optional 계약 유지. 테스트 19곳에 `state: None` 보강(`crates/loop-bridge/tests/{context,guidance_delivery,commands-direct,commands}.rs`)으로 기존 동작 보존.
- **providers 재노출**: `packages/providers/src/types.ts:1,19`가 `@loop/protocol`의 `WorkerState`를 import+재노출. 핸드라이트 유니온과 frozen-contract 예외 주석 소멸 — 어휘 단일 진실원천이 loop-core → 코드젱 → @loop/protocol로 수렴.
- **Debug 포맷 저장**: `crates/loop-store/src/sqlite.rs`에서 `format!("{:?}")` 0건(grep) — deferred-1 부수 항목 소멸.
- `crates/loop-core/src/run/worker.rs:7-11`의 "bridge가 generated protocol으로 수송" 서술이 이제 사실과 일치.

그러나 §5의 코드젱 회귀가 이 편입의 **소비 경로**(어댑터가 실제로 `state`를 보내고 결과를 받는 왕복)를 맴. 판정은 "타입 계약 편입은 완료, 런타임 왕복은 §5 해소까지 보류".

## 3. priority-3(b) 명시 6종 직접 테스트 — 해소

`crates/loop-bridge/tests/commands-direct.rs`:

- `get_run_returns_the_live_run_snapshot` (:74), `add_task_appends_a_task_to_an_existing_plan` (:109, 미존재 run/의존성 누락/중복 부정 케이스 포함), `update_task_exposes_only_the_ready_transition` (:184), `record_decision_persists_a_durable_decision_event` (:243), `pause_run_and_confirm_paused_transition_the_run_state` (:289), `subscribe_events_streams_events_after_a_sequence_cursor` (:385).
- import 행(:4-6)이 6종 전부 직접 수입 — 2026-09-24 감사가 "직접 호출 0건"으로 지적한 목록과 1:1 대응. `graph_query_exposes_stage_dependencies_and_owner_health` (:53)도 동봉.
- 실행 증거: `cargo test -p loop-bridge` 전체 통과(bridge-test-state-fix 보고: lib 5 + commands 20 + context 2 + 기타).

## 4. simplify f1 pi-loop 페르소나 단일 소스 — 해소

- `packages/pi-loop/src/extension.ts:9-14`가 `@loop/orchestrator/persona`의 `derivePersonaVocabulary`를 subpath import(번들 순수성 주석 동봉), `:56`에서 `derivePersonaVocabulary(config.personas, config.personaKindDefaults)`로 어휘 도출, `:412` 프롬프트 산문과 `:1040` 미지 ID 거부가 같은 어휘를 소비.
- 로컬 `KNOWN_PERSONA_IDS` 배열과 `PERSONA_KIND_DEFAULTS` 산문 소멸(grep 0건) — orchestrator 단일 소스만 남음.

## 5. 신규 발견 — [차단] complex-binary 코덱 경로가 Bun 호스트 ABI와 불일치

WorkerState 편입을 위한 코드젱 재생성이 **잠재 불일치를 폭로**했다. 이것이 현재 `bun run check` 실패의 유일한 원인이다.

- **증상 A (JS 호스트, dylib 경로)**: `recordWorkerStarted`/`recordWorkerResult`/`recordWorkerStopped` 응답에서 `RustraCommandError: trailing bytes in complex response`(`invoke.malformed`). 계측 결과 응답 버퍼 total=512B 중 position 9의 `accepted=true` 1바이트만 새 프레임이고 나머지는 이전 응답의 잔재(재사용 슬롯).
- **증상 B (컴파일 CLI 경로)**: `./dist/loop benchmark` 트라이얼이 전부 `status=attention`, `worker_starts=0` — attention 사유 `postcard decode: Found an Option discriminant that wasn't 0 or 1`(Rust 측 요청 디코드 실패).
- **원인 체인**:
  1. 새 입력 스키마의 `state` 필드가 `{"anyOf":[{"$ref":"#/definitions/WorkerState"},{"type":"null"}]` — 정의 참조가 포함되자 `@rustra/cli 0.11.3` 생성기가 이 3개 프레임을 `/** route: complex-binary */` + `createComplexCodec`로 분류(`packages/protocol/src/generated/frame-codecs.ts:5162,5173,5184`). HEAD는 inline postcard 코덱(offset 8부터 필요한 만큼만 소비, trailing 검사 없음 — "디코드는 프레임 내부에서 종료").
  2. `@rustra/bun@0.10.2`(`node_modules/.bun/@rustra+bun@0.10.2/.../bun-ffi.js:87-123`)는 512B 재사용 caller 버퍼를 통째로 반환하는 계약(주석 명시: "byteLength 는 capacity(512)이고 … 완결 프레임에서 디코드는 프레임 내부에서 종료된다"). 워크스페이스 dev 버전(`../rustra-bridge/packages/bun` 0.11.0-dev)도 동일.
  3. `@rustra/types@0.12.0`의 `createComplexCodec`은 `reader.remaining !== 0` → strict trailing 예외(`complex-codec.js:58`) — 재사용 버퍼 계약과 정면 충돌. 요청 방향(anyOf 인코딩)도 Rust postcard `Option` 판별식과 어긋나 증상 B를 낸다.
  4. HEAD부터 존재하던 complex-binary 3종(`evaluateCleanupDisposition` 등)은 TS 호출자가 없어 미폭로 — WorkerState 편입이 최초로 소비 경로를 만들었다.
- **영향**: `bun test` 59건 실패 — 전부 워커 수명주기를 bridge로 왕복하는 통합 테스트(orchestrator interventions/milestone/mailbox/runtime/persistent-lifecycle, cli detached/benchmark, gateway real-run 등). `bun run check`의 typecheck·codegen:check·test:architecture·cargo 계열은 통과.
- **부수 정리(본 태스크에서 수행)**: `dist/libloop_bridge.dylib`(01:27)·`dist/loop`(02:38)가 소스 변경(12:0x) 이전 빌드로 stale — `bun run build`로 재빌드해 소스-아티팩트 정합 복원(12:20). 이것만으로는 해소되지 않으며 §5 원인은 남는다(빌드 아티팩트 갱신은 소스 변경 아님).

### 해소 경로 후보 (책임 배분 필요 — 본 태스크 write scope 밖)

1. `scripts/rustra-codegen.ts` 정규화 확장: complex-binary 경로를 재사용 버퍼 계약에 맞는 self-terminating 디코드로 되돌리는 shim (기존 `normalizeRustraFrameCodecs`가 "@rustra/cli 0.11.3 predates two upstream generator fixes"를 보정하는 전례와 같은 자리).
2. `@rustra/bun`/`@rustra/types` 버전 정렬: 호스트가 정확 길이를 반환하거나 코덱이 self-terminating인 릴리스로 통일.
3. Rust 쪽 완화: `state`를 정의 참조 없는 와이어 형태로 수송해 inline-postcard 경로 유지 — 다만 안 B(코드젱 편입) 취지를 훼손하므로 최후 수순.

## 검증 (완료 검사 3건 기준)

- `bun run check` — **실패**: test 단계 59건 실패(§5). codegen:check·typecheck·test:architecture·cargo test -p loop-core/-p loop-bridge/-p loop-store는 통과.
- `./dist/loop benchmark agents scripts/benchmark/manifest.json --json --database /tmp/loop-bench-final.sqlite` — 기계적으로는 통과(exit 0, trials JSON + `status` 키, fake 프로파일만 사용해 유료 호출 없음). 그러나 두 트라이얼 모두 `status=attention`, `worker_starts=0`, `verifiedCriteria=0` — §5 회귀로 워커 왕복이 불가. **오프라인 파이프라인의 유의미한 재증명은 §5 해소 후에만 가능.**
- `grep -q 'provider-support' && grep -q 'WorkerState' && grep -q 'benchmark' docs/research/2026-09-30-remaining-backlog-resolution.md` — 본 문서로 충족.

## 남은 항목

1. **[차단] §5 코덱 경로 불일치 해소** — 위 3개 후보 중 결정 후 착지, `bun run check` 전체 통과와 벤치마크 트라이얼 `completed` 전환으로 재증명.
2. (§5 해소 후) 어댑터가 실제 `state` 어휘를 보내는 소비 접점 테스트 — 현재 테스트는 전부 `state: None`으로 기존 동작만 보존.
