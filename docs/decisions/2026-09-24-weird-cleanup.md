# 저장소 이물질 제거·수정 분류 결정 — 2026-09-24

- **일자:** 2026-09-24
- **상태:** 결정됨; 실행은 후속 태스크
- **결정 종류:** `decision` (decide-cleanup)
- **의존성:** `facts-weird-inventory` 전수 조사 보고서(`docs/research/2026-09-24-weird-inventory.md`), 선행 자료 `docs/research/cleanup-inventory.md`
- **읽기 범위:** `AGENTS.md`, `docs/architecture.md`, `docs/decisions/2026-09-24-evolution-roadmap.md`, `docs/research/2026-09-24-weird-inventory.md`, `docs/research/cleanup-inventory.md` + 결정 근거 스팟 검증
- **쓰기 범위:** 이 결정 문서만
- **분류 기준:** (1) AGENTS.md 경계 규칙 준수 (2) 동작 불변(제거·수정이 런타임 행동·영속 데이터·생성물을 바꾸지 않음) (3) 타 실행 소관 7파일 제외(이월) (4) 확정되지 않은 항목은 보류하고 material 여부를 명시

## 배경 — 의존 보고서 스팟 검증

재상정 금지 전제 확인: simplify f1~f5는 전부 착지, jev 빈 디렉터리는 소멸, `BoundedPaneSender`는 실사용(`packages/providers/src/mirror.ts:2,276` — 본 검증으로 재확인). 재조사 없음.

의존 보고서의 제거·수정 후보 전수를 현재 HEAD(`c606722`)에서 독립 재검증했다(정적 읽기 + grep, 유료 호출 없음):

| 항목 | 보고서 주장 | 검증 결과 |
| --- | --- | --- |
| D-1 `LeadCoordinator` | 정의 외 참조 없음 | 확인 — `packages/pi-loop/src/lead/coordinator.ts:8` 정의뿐, 경로 참조는 `packages/pi-loop/src/index.ts:3` 재수출 1건. `extension.ts:22-23`은 `./lead/decompose`·`./lead/prompts`만 임포트 |
| D-2 `PaneRef` | 정의 외 참조 없음 | 확인 — `packages/herdr/src/pane.ts:1` 정의뿐, `packages/herdr/src/index.ts:3` 재수출 1건. 단 문서 참조 1건 발견: `docs/research/2026-09-test-gap-map.md:49` — **실행 3 갱신 범위에 추가**(보고서 누락, 아래 S-7') |
| D-3 `ScriptedProvider` | 0참조 | 확인 — `packages/providers/src/fake.ts:118` 정의뿐. 형제 `FailingProvider`(:110)·`SlowProvider`(:120)는 `packages/orchestrator/test/milestone.test.ts:8,95,118` 사용 — 생존 |
| D-4 `HerdrLifecycleReport` | 0참조 | 확인 — `packages/pi-loop/src/herdr-lifecycle.ts:11` 정의뿐(인터페이스만 죽음. `HerdrLifecycleReporter` 클래스 :43는 `extension.ts:33`·테스트가 실사용) |
| D-5 `API_VERSION` | 0참조 | 확인 — `crates/loop-core/src/lib.rs:3` 정의뿐. `tests/architecture-boundaries.test.ts:9-21`은 `pub mod` 목록만 고정(const 무관) — 제거 안전 |
| D-6 `drop_artifact` | 0참조 | 확인 — `crates/loop-core/src/event/reducer.rs:410` 정의뿐(파일 내 출현 1회). 인접 `is_artifact_removed`(:405)·`drop_removed_artifacts`(:414) 생존 |
| D-7 `PurgeAction::for_run` | 외부 0참조, 내부 :211만 | 확인 — `crates/loop-core/src/policy/cleanup.rs:135`(정의), `:211`(내부 사용) |
| S-1 presentation 누락 | README·architecture.md 미기재 | 확인 — README 저장소 지도(`README.md:25-30`) 6행에 `packages/presentation` 부재. `docs/architecture.md` 전체에서 presentation 0건. 실체: `packages/presentation/package.json`(`@loop/presentation`, private, 의존 `@loop/protocol` 단일), `src/{compact,snapshot}.ts`, 임포터 `packages/cli/src/main.ts:14`, `packages/pi-loop/src/extension.ts:14`, `ui/*` 7파일, `lead/reduce.ts` |
| S-2~S-4 exploration-priorities 상태 라인 ":47, :52, :59" | 스테일 3건 | **핀 정정** — 실제 상태 라인은 `:53`(deferred-1), `:55`(deferred-2), `:59`(deferred-4). `:57`(deferred-3, "착지됨")는 정확하므로 무관. 본 결정은 정정된 핀 사용 |
| S-7' test-gap-map BoundedPaneSender 행 | ":47, :66, :75" 스테일 | 확인 — `docs/research/2026-09-test-gap-map.md:47`(모듈표), `:66`(근거 불릿), `:75`(findings 4행)의 "사용처 없음/죽은 수출 후보" 주장은 `mirror.ts:2,276` 실사용으로 무효. 단 "직접 테스트 없음"은 여전히 사실 — 무효화는 죽은 수출 주장에만 적용 |

## 결정 — 실행 3건(확정)

### 실행 1 [정리·저위험] TS 죽은 코드 제거 (D-1~D-4)

**조치(파일별).**

1. `packages/pi-loop/src/lead/coordinator.ts` — 모듈 전체 삭제(`LeadCoordinator` :8, `Decomposer` :6 계단식 죽음 포함)
2. `packages/pi-loop/src/index.ts:3` — `export * from "./lead/coordinator"` 행 삭제
3. `packages/herdr/src/pane.ts` — 모듈 전체 삭제(`PaneRef`)
4. `packages/herdr/src/index.ts:3` — `export * from "./pane"` 행 삭제
5. `packages/providers/src/fake.ts:118` — `ScriptedProvider` 빈 하위 클래스 삭제
6. `packages/pi-loop/src/herdr-lifecycle.ts:11` — `HerdrLifecycleReport` 인터페이스 삭제

**대안.**

- **안 A(채택):** 위 6개 조치 그대로. 전 항목 "정의 외 참조 0"을 본 결정 검증으로 재확인했고, `@loop/*` 전 패키지가 private(`package.json: "private": true`)이므로 공개 면 축소의 외부 영향 없음. 동작 불변 — 코드 경로에서 도달 불가능한 선언만 제거.
- **안 B(기각):** 죽은 모듈을 보존하고 "deprecated" 주석만 표기. 기각 — 이번 조사 목적이 이물질 제거이며, 주석은 다음 감사에서 또 "죽은 코드+주석"으로 재발견된다. 참조자가 0인 이상 주석은 정보를 더하지 않는다.
- **안 C(기각):** `ScriptedProvider`·`HerdrLifecycleReport`만 심볼 단위 제거하고 죽은 모듈 2개(D-1/D-2)는 보존. 기각 — 모듈 전체가 죽었으면면(정의 1건 + barrel 재수출) 남길 이유가 없고, 부분 제거는 다음 감사의 비용만 남긴다.
- **안 D(기각):** 죽은 모듈 2개에 소비자를 만들어 살린다(예: pi-loop 조율 로직을 `LeadCoordinator`로 이동). 기각 — `extension.ts`가 이미 조율을 인라인 보유하며 리팩터링 요구가 없다. 소비자 없는 코드를 위해 구조를 움직이는 것은 동작 불변 원칙 위반이다.

**영향 범위.** pi-loop, herdr, providers 3패키지. **생성 protocol 무접점, 코드젱 무관.** 문서 파급(계단식): `docs/research/2026-09-test-gap-map.md:49` pane.ts 행이 스테일화 — 실행 3에서 추기 갱신(실행 순서 조건 참조). 역사 plan 문서의 `lead/coordinator.ts` 언급(`docs/superpowers/plans/2026-09-21-loop-standalone-herdr-plan.md:184`)은 날짜 기록 문서라 무수정.

**검증.** `bun run typecheck`, `bun test packages`(pi-loop·herdr·providers 전체), `bun run test:architecture`, `bun run codegen:check`(무변경 확인, 선택).

### 실행 2 [정리·저위험] Rust 죽은 코드 제거·공개면 축소 (D-5~D-7)

**조치(파일별).**

1. `crates/loop-core/src/lib.rs:3` — `pub const API_VERSION: &str = "loop.v1"` 삭제
2. `crates/loop-core/src/event/reducer.rs:410-412` — `pub fn drop_artifact` 삭제
3. `crates/loop-core/src/policy/cleanup.rs:135` — `PurgeAction::for_run`의 `pub` 제거(모듈 private화; 내부 사용 :211 유지)

**대안.**

- **안 A(채택):** 위 3개 조치 그대로. D-5/D-6은 전 저장소 0참조(본 결정 검증), D-7은 가시성만 낮추는 동작 불변 변경. `architecture-boundaries.test.ts:9-21`은 `pub mod` 목록만 고정하므로 const·메서드 제거에 영향 없음.
- **안 B(기각):** D-7을 포함해 `for_run`도 삭제. 기각 — `cleanup.rs:211`의 런타임 경로(purge 정책 산출)가 사용 중이므로 삭제 불가. private화가 정확한 최소 조치다.
- **안 C(기각):** `API_VERSION`을 향후 버전 협상용으로 보존. 기각 — 소비자 0인 예약 표면은 AGENTS.md의 "확장 지점은 비용이 낮을 때만" 정신에 반한다. 필요해지면 그때 다시 도입한다(git 이력에 근거 존재).
- **안 D(기각):** `drop_artifact`를 store 정리 정책에서 쓰도록 배선. 기각 — `drop_removed_artifacts`(:414, 생존·테스트 존재)가 이미 그 역할을 하고 있다. 중복 로직을 배선하는 것은 역방향이다.

**영향 범위.** loop-core 단일 크레이트. **생성 protocol 무접점**(bridge 미수정) — `bun run codegen` 불필요.

**검증.** `cargo test -p loop-core`(cleanup_policy·reducer 관련 테스트 포함), `cargo test -p loop-store`(크로스 크레이트 영향 0 확인), `bun run test:architecture`.

### 실행 3 [risk·문서] 생존 문서 갱신 — 사실 근거 명시 (S-1~S-4, S-7')

생존 문서(계속 갱신되는 계약 문서)의 불일치만 수정한다. 각 수정 대상의 사실 근거는 아래 표와 같다(코드 사실 확인 완료 — 본 결정 §배경 검증 표가 근거).

**조치(파일별).**

1. `README.md` 저장소 지도(:25-30 표) — `packages/presentation` 행 추가. 근거: 활성 워크스페이스 패키지(`packages/presentation/package.json`)가 지도에서 누락; pi-loop·cli의 렌더 기반(임포터: `packages/cli/src/main.ts:14`, `packages/pi-loop/src/extension.ts:14`, `ui/*`, `lead/reduce.ts`)
2. `docs/architecture.md` 계층표 — Presentation 행 추가(owns: 프로토콜 타입 기반 컴팩트 렌더 원시(`compact.ts`의 `compactLines`, `snapshot.ts`의 `renderSnapshot`·`renderTaskContext`), must-not-own: 파일·프로세스·스폰, 스케줄링·프로바이더 지식). 근거: 의존 `@loop/protocol` 단일(package.json), `fs`/`spawn`/`mkdtemp` 0건(cleanup-inventory pass 3 검증)
3. `docs/research/2026-09-exploration-priorities.md` — 스테일 상태 라인 3건에 날짜 찍힌 신규 상태 라인을 **추기**(기존 라인 무변경 — roadmap :13의 추기 규칙 준수). 대상: `:53`(deferred-1 → 실행 1·2 착지 사실 반영, `37981a2`), `:55`(deferred-2 → 착지, `1f557a6`), `:59`(deferred-4 → f1 착지 `5692091`+`428b018`, 전건 착지 완료)
4. `docs/research/2026-09-test-gap-map.md` — 무효화 추기 4곳: `:47`, `:66`, `:75`(BoundedPaneSender "사용처 없음/죽은 수출 후보" 주장 무효 — `packages/providers/src/mirror.ts:2,276` 실사용; **"직접 테스트 없음" 관찰은 여전히 유효하므로 무효화 범위는 죽은 수출 주장에 한정**) 및 `:49`(pane.ts 행 — 실행 1의 모듈 삭제 반영)

**대안.**

- **안 A(채택):** 위 4개 조치. 추기 방식은 roadmap `2026-09-24-evolution-roadmap.md`:13이 확립한 선례(기존 내용 무변경, 날짜 찍힌 상태 표기 추가)를 따른다.
- **안 B(기각):** exploration-priorities·test-gap-map의 스테일 라인을 직접 수정(제자리 갱신). 기각 — 날짜 기록 문서의 감사 흐름을 지우는 것이고, roadmap :13이 "기존 내용 무변경, 착지 해석의 기준은 본 문서(roadmap)"로 명시한 규칙 위반이다.
- **안 C(기각):** architecture.md는 개념 계층 문서이므로 presentation 행을 추가하지 않고 README만 갱신. 기각 — presentation은 프로토콜 타입만 소비하는 렌더 경계로, 계층표의 "Must not own" 규율(파일·프로세스 금지)을 문서화할 가치가 있는 실제 모듈 경계다. 표의 각 행이 소유/비소유를 규정하는 구조에 정확히 들어맞는다.
- **안 D(기각):** presentation 행 추가를 별도 결정으로 보류. 기각 — 사실 확인이 완료된 계약 문서 결함이므로 확정 불필요 항목이고, 보류는 다음 감사에서 같은 findings를 재생산한다.

**영향 범위.** 문서 4파일만. **코드 무변경, 코드젱 무접점.**

**검증.** 갱신 후 스테일 주장 소멸 확인: `grep -n "사용처 없음" docs/research/2026-09-test-gap-map.md`의 죽은 수출 맥락 소멸(무효화 주석 잔존 허용), `grep -c "packages/presentation" README.md` ≥ 1, exploration-priorities에 신규 착지 상태 라인 존재. `bun run test:architecture`.

## 보류(제외) 항목과 사유

| 항목 | 분류 | 사유 |
| --- | --- | --- |
| P-1 `ModelRegistry`(`packages/orchestrator/src/model-registry.ts:5`) | **보류** | 테스트 전용 생산 코드이나 프로덕션 라우팅과의 관계는 기능 설계(`composition.ts` 주입 방식) 소관. 제거는 회귀 티어를 넘는다 |
| P-2 `LoopRuntime.recover`(`packages/orchestrator/src/runtime.ts:102`)·`WorkerReconciler` | **보류 — human attention** | 복구 진입점 미배선은 이물질이 아니라 기능 갭(`docs/research/dispatch-resume-gaps.md` 소관). **배선(CLI 노출) vs 제거는 제품 결정**이므로 사람 승인 대상. 본 정리 배치에서 제거하면 안 됨 |
| P-3 `disposeAll`(`packages/providers/src/antigravity/persistent.ts:193`) | **보류** | 시그널 핸들러 배선이 정답인 알려진 갭(cleanup-inventory D2). 제거는 디튜브 경로를 막는 역방향. 기존 갭 추적으로 이월 |
| B3 `verify-install` 임시 디렉터리(`packages/cli/src/main.ts:701`) | **보류** | cleanup-inventory B3으로 추적 중인 기존 갭(권고 해법 `try/finally`+`rmSync` 존재). 이물질 아님 — 기능 수정 소관 |
| §1.4 수출 키워드 중복 그룹(cli·herdr·orchestrator·pi-loop·presentation·providers 다수 타입) | **보류** | 전부 타입 또는 내부 헬퍼로 동작 영향 0. `index.ts`의 `export *` barrel 구조에서 개별 `export` 제거는 공개 면 규율 태스크가 열릴 때 일괄 처리하는 것이 단순. 미미 |
| §1.5 생성 protocol 표면(`packages/protocol/src/generated/*`) | **보류** | 생성물 — AGENTS.md 규칙상 수작업 편집 금지. Rust 교량이 요구하는 한 재생성되며 `bun run codegen:check` 통과 중(의존 보고서 확인) |
| S-5~S-8 날짜 기록 문서의 스테일 절대 서술(cleanup-inventory, cleanup-and-retention ADR, backlog-reconciliation, docs-drift C4) | **보존(무수정)** | 전부 시점 스냅샷이며 무효화 판정은 이미 재감사 문서에 기록됨. roadmap :13이 backlog-reconciliation의 재작성 불필요를 명시. 본 결정 문서가 정정 근거로 존재 |
| §3.1 jev 잔여(`config.ts:268-272` 가드, `tests/configuration.test.ts:54-81`, `provider-support.md:24`) | **유지** | 의도적 마이그레이션 계약 + 회귀 테스트 + 운영자 문서 일치. 제거 대상 아님 |
| §3.2 삭제된 경로를 가리키는 역사 plan 문서 3건 | **보존** | 작성 시점 기록. 현재 사실 기준 재집필하지 않음 |
| 감사 문서 `2026-09-simplify-audit.md` | **무갱신** | 시점 주장 라인 없는 스냅샷 — 착지 사실은 exploration-priorities 추기(실행 3)로 전달 |

**보류 판정의 총괄 근거:** 위 항목은 "이물질"이 아니라 (a) 기능 갭(P-1~P-3, B3), (b) 구조적 미미 사항(§1.4), (c) 생성·기록 산물(§1.5, S-5~S-8, §3)이다. 분류 기준 (2) 동작 불변·(4) 확정성 어느 쪽에서도 즉시 제거 근거가 성립하지 않는다.

## 수정 금지 7파일 — 발견 항목 이월

타 실행(herdr 소관)이 소유한 아래 7파일은 본 결정의 조치 대상에서 제외하며, 관찰된 항목은 후속 작업으로 이월한다:

| 파일 | 발견 | 처치 |
| --- | --- | --- |
| `packages/providers/src/mirror.ts` | `result()`의 sink 발행(`:471-474` 경유 `#publishLines` :498-502)이 `cleanLine`(:174) 미적용. 원천 redact(herdr-agent 요약 redact)로 자격증명은 전이적으로 차단 — 저위험 | **이월:** 해당 실행 착지 후 재검증 조건부 후속 태스크(cleanLine 적용 여부 판정). 본 배치에서 수정 금지 |
| `packages/herdr/src/client.ts`, `packages/herdr/test/lifecycle.test.ts`, `packages/herdr/test/caller.test.ts`, `packages/providers/src/herdr-agent.ts`, `packages/providers/test/mirror.test.ts` | 이상 없음(의존 보고서 §6, 본 검증으로 재확인된 수정 금지 파일 상태 `c606722` 커밋 완료) | 조치 없음 |
| `docs/decisions/2026-09-24-herdr-caller-anchoring.md` | "decided(shipped)" — 구현과 일치, 스테일 아님 | 조치 없음 |

## 실행 순서와 충돌 회피

```text
실행 1(TS 제거) ∥ 실행 2(Rust 제거)  →  실행 3(생존 문서 갱신)
```

1. 실행 1·2는 접점이 분리(TS 패키지 vs loop-core 크레이트)되어 병렬 무충돌.
2. **실행 3은 실행 1 착지 후에 완료**해야 한다 — test-gap-map `:49` pane.ts 행 갱신은 모듈 삭제가 "현재 사실"이 된 이후에만 사실 근거를 갖는다(문서 스테일 서술은 코드 사실 확인 없이 수정 금지).
3. 본 배치 3건 모두 **생성 protocol 무접점**(loop-bridge 미수정) — `bun run codegen` 불필요, `bun run codegen:check`로 무변경 확인(선택).
4. 전 배치 완료 후 `bun run check`로 전체 회귀 확인.

## 결과 요약 — 최종 조치 목록(파일별)

| 파일 | 조치 | 실행 |
| --- | --- | --- |
| `packages/pi-loop/src/lead/coordinator.ts` | **제거**(모듈 전체) | 1 |
| `packages/pi-loop/src/index.ts` | **수정**(:3 재수출 행 삭제) | 1 |
| `packages/herdr/src/pane.ts` | **제거**(모듈 전체) | 1 |
| `packages/herdr/src/index.ts` | **수정**(:3 재수출 행 삭제) | 1 |
| `packages/providers/src/fake.ts` | **수정**(:118 `ScriptedProvider` 삭제) | 1 |
| `packages/pi-loop/src/herdr-lifecycle.ts` | **수정**(:11 인터페이스 삭제) | 1 |
| `crates/loop-core/src/lib.rs` | **수정**(:3 `API_VERSION` 삭제) | 2 |
| `crates/loop-core/src/event/reducer.rs` | **수정**(:410 `drop_artifact` 삭제) | 2 |
| `crates/loop-core/src/policy/cleanup.rs` | **수정**(:135 `pub` 제거) | 2 |
| `README.md` | **수정**(저장소 지도 presentation 행 추가) | 3 |
| `docs/architecture.md` | **수정**(계층표 Presentation 행 추가) | 3 |
| `docs/research/2026-09-exploration-priorities.md` | **수정**(상태 라인 :53/:55/:59 추기) | 3 |
| `docs/research/2026-09-test-gap-map.md` | **수정**(:47/:49/:66/:75 무효화·반영 추기) | 3 |
| `packages/providers/src/mirror.ts` | **보류 — 이월**(cleanLine 관찰, 타 실행 착지 후 재검증) | 후속 |
| P-1·P-2·P-3·B3·§1.4·§1.5·S-5~S-8·§3 해당 파일 | **보류·보존·유지**(사유 §보류 표) | — |

보류 사유 요약: P-2는 제품 결정(human attention), P-1·P-3·B3는 기존 기능 갭 추적 소관, §1.4는 미미(공개 면 규율 태스크 대기), §1.5는 생성물(수작업 편집 금지), S-5~S-8·§3은 날짜 기록 문서 보존 원칙, jev 잔여는 의도적 마이그레이션 계약.

## 검증(본 결정 문서)

- `test -s docs/decisions/2026-09-24-weird-cleanup.md` — 본 파일 존재.
- `grep -q 대안 docs/decisions/2026-09-24-weird-cleanup.md` — 대안 섹션 포함.
- 본 결정의 모든 분류 근거는 정적 읽기 + grep + 선행 보고서(cleanup-inventory 오프라인 검증)만 사용 — **유료 모델 호출 없음**.
- 근거 핀 중 1건 정정: exploration-priorities 상태 라인은 보고서 핀 ":47, :52"가 아니라 ":53, :55"임을 현재 파일에서 확인(§배경). 실행 3은 정정된 핀 사용.
- 수정 금지 7파일은 읽기·검증만 수행(쓰기 0건). `mytest.db*`는 대상에서 제외.
