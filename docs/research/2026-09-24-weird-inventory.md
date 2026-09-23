# 저장소 이물질 전수 조사 — 2026-09-24

- Task: `facts-weird-inventory` (research, attempt 0)
- 기준: working tree HEAD `c606722` (clean — 수정 금지 7파일은 이미 `c606722`까지 커밋된 상태로 관측됨)
- 방법: 정적 읽기 + grep 전수 + 유료 모델 호출 없음. 선행 자료: `docs/research/cleanup-inventory.md`, `docs/research/2026-09-24-backlog-reconciliation.md`.
- 제약 준수: 쓰기는 본 파일만. 수정 금지 7파일(herdr 소관)은 읽기 조사 후 §6에 "수정 불가(타 실행 소관)"로 표기. `mytest.db*`는 gitignored 로컬 DB로 대상 제외(`.gitignore:4-6` `*.db`).

## 결과 요약

| 카테고리 | 항목 수 | 내용 |
| --- | --- | --- |
| (1) 죽은 수출·죽은 코드 | 12 | 제거 대상 7(모듈 2개 포함), 프로덕션 미사용 보류 3, 수출 키워드 중복 그룹 1, 생성 표면 그룹 1 |
| (2) 스테일 서술 | 8 | 생존 문서 결함 2(living doc), 날짜 기록 문서의 스테일 절대 서술 6 |
| (3) 잔여 참조 | 6 | 의도적 마이그레이션 가드 3(jev), 삭제된 경로를 가리키는 역사 plan 문서 3 |
| (4) 임시·디버그 산물 | 1 | TODO/FIXME/HACK·디버그 출력·빈 디렉터리 0건, 잔여 갭 1(B3 온도 누수) |
| (5) simplify f1~f5 및 감사 문서 | 5/5 착지 + 3 | f1~f5 전부 착지, jev 빈 디렉터 소멸, BoundedPaneSender 실사용 재확인, 감사 문서 스테일 상태 서술 3건 |

**수정 권고 목록**(우선순위순. §번호 참조):

1. **[정리·저위험]** `packages/pi-loop/src/lead/coordinator.ts` 모듈 전체 제거 + `packages/pi-loop/src/index.ts:3` (§1.1)
2. **[정리·저위험]** `packages/herdr/src/pane.ts` 모듈 전체 제거 + `packages/herdr/src/index.ts:3` (§1.1)
3. **[정리·저위험]** `packages/providers/src/fake.ts:118` `ScriptedProvider` 제거 (§1.1)
4. **[정리·저위험]** `packages/pi-loop/src/herdr-lifecycle.ts:11` `HerdrLifecycleReport` 제거 (§1.1)
5. **[정리·저위험]** `crates/loop-core/src/lib.rs:3` `API_VERSION` 제거 (§1.2)
6. **[정리·저위험]** `crates/loop-core/src/event/reducer.rs:410` `drop_artifact` 제거 (§1.2)
7. **[정리·미미]** `crates/loop-core/src/policy/cleanup.rs:135` `PurgeAction::for_run` `pub`→private (§1.2)
8. **[문서]** `README.md` 저장소 지도·`docs/architecture.md` 계층표에 `packages/presentation` 누락 보강 (§2.1)
9. **[문서]** `docs/research/2026-09-exploration-priorities.md` 상태 라인 3건(:47, :52, :59) 갱신 — roadmap 본문 :13의 "추기" 방식 준수 (§2.1, §5)
10. **[문서]** `docs/research/2026-09-test-gap-map.md` BoundedPaneSender 행(:47, :66, :75) 무효화 추기 (§2.1)
11. **[보류]** `ModelRegistry`·`LoopRuntime.recover`·`disposeAll` — 기능 갭 소관(§1.3), B3 온도 누수(§4), 수출 키워드 중복·생성 표면(§1.4–1.5)은 미미 또는 별도 결정 대기

---

## 1. 죽은 수출·죽은 코드

탐지 방법: 패키지별 `export` 선언 추출 → 정의 파일 외 전 저장소(`packages`, `tests`, `scripts`, `plugins`, `crates`, `docs`) 참조 검색. Rust는 `pub fn/struct/enum/const` 동일 방식. "완전 죽음" = 정의 라인 외 어떤 파일에도 등장하지 않음. "수출만 중복" = 정의 파일 내부 사용은 있으나 임포터가 없음.

### 1.1 완전 죽은 코드 — 제거 권장 (TS)

| # | 위치 | 대상 | 근거 | 위험도 |
| --- | --- | --- | --- | --- |
| D-1 | `packages/pi-loop/src/lead/coordinator.ts` (모듈 전체, `LeadCoordinator` 클래스 :8 + `Decomposer` 타입 :6) | 죽은 모듈 + 계단식 죽음 | `LeadCoordinator` 전 저장소 등장 1건(정의뿐), `Decomposer`는 죽은 클래스의 생성자 파라미터(:11)에서만 사용. `extension.ts`는 `./lead/decompose`, `./lead/prompts`만 임포트(:22-23)하고 조율 로직을 인라인 보유. 유일 참조는 `packages/pi-loop/src/index.ts:3` 재수출과 역사 plan 문서(`docs/superpowers/plans/2026-09-21-loop-standalone-herdr-plan.md:184`) | 낮음 — `bun run typecheck`·전체 테스트가 회귀 검증 |
| D-2 | `packages/herdr/src/pane.ts` (모듈 전체, `PaneRef` 인터페이스) | 죽은 모듈 | `PaneRef` 등장 1건(정의뿐). `client.ts`는 동일 형태를 인라인 타입으로 사용(:119, :219, :481, :507 — `{ workspaceId: string; paneId: string }`). 유일 참조는 `packages/herdr/src/index.ts:3` 재수출 | 낮음 |
| D-3 | `packages/providers/src/fake.ts:118` | `export class ScriptedProvider extends FakeProvider {}` — 빈 하위 클래스 | 전 저장소 0참조. 형제 `FailingProvider`(:110), `SlowProvider`(:120)는 `packages/orchestrator/test/milestone.test.ts`가 사용 | 낮음 |
| D-4 | `packages/pi-loop/src/herdr-lifecycle.ts:11` | `export interface HerdrLifecycleReport` | 전 저장소 0참조(정의 파일 내부 포함 1회). 형제 옵션·환경 타입들은 파일 내부 사용 존재(§1.4) | 낮음 |

### 1.2 완전 죽은 코드 — 제거 권장 (Rust)

| # | 위치 | 대상 | 근거 | 위험도 |
| --- | --- | --- | --- | --- |
| D-5 | `crates/loop-core/src/lib.rs:3` | `pub const API_VERSION: &str = "loop.v1"` | `crates`·`packages`·`tests`·`docs` 전역 0참조. `tests/architecture-boundaries.test.ts:9`는 `pub mod` 목록만 고정하므로 제거 안전 | 낮음 |
| D-6 | `crates/loop-core/src/event/reducer.rs:410` | `pub fn drop_artifact` | 전 저장소 0참조. 인접 `is_artifact_removed`(:405), `drop_removed_artifacts`(:414)는 `crates/loop-core/tests/cleanup_policy.rs:169,175`가 사용 — 이 둘은 생존 | 낮음 |
| D-7 | `crates/loop-core/src/policy/cleanup.rs:135` | `pub fn PurgeAction::for_run` | 외부 참조 0, 내부 사용만(:211). `pub` 제거(모듈 private화) 권장 — 동작 불변 | 미미 |

### 1.3 프로덕션 미사용(테스트 전용·의도적 미배선) — 보류

제거가 아니라 기능 갭 해소(배선)가 정답일 수 있는 항목. 별도 결정 소관으로 기록만 한다.

| # | 위치 | 상태 | 근거 |
| --- | --- | --- | --- |
| P-1 | `packages/orchestrator/src/model-registry.ts:5` `ModelRegistry` | 테스트 전용 | 유일 사용처 `packages/orchestrator/test/config.test.ts:7,34`. 프로덕션 라우팅은 `composition.ts`가 models.toml 프로필을 직접 주입 |
| P-2 | `packages/orchestrator/src/runtime.ts:102` `LoopRuntime.recover` + `:13` `WorkerReconciler` | 테스트 전용 | 유일 호출처 `packages/orchestrator/test/runtime.test.ts:36,70`. CLI(`packages/cli/src/main.ts` — `recover` 부재 grep 0건)·pi 확장 어디에도 복구 진입점 없음. `docs/research/dispatch-resume-gaps.md`가 다루는 알려진 갭과 일치 |
| P-3 | `packages/providers/src/antigravity/persistent.ts:193` `disposeAll` | 호출자 0 | `cleanup-inventory.md` D2 갭 그대로. 시그널 핸들러 배선이 권고 해법이었음(제거 아님). 참고: 형제 `AgyStreamDriver.dispose`도 테스트만 호출(`antigravity-persistent.test.ts`) |

### 1.4 수출 키워드만 중복(임포터 없음, 정의 파일 내부 사용 존재) — 미미

다음 심볼은 `export`가 공개 면을 통해 재노출되지만 패키지 외부·테스트 어디서도 임포트하지 않는다. 전부 타입(동작 영향 0) 또는 내부 헬퍼다. 권고: `export` 키워드 제거로 공개 면 축소(선택적, 미미). 단 이 그룹 전반이 `index.ts`의 `export *`로 공개 API를 이루는 현 구조에서는 보류도 합리적이다.

- `packages/cli/src/main.ts`: `ProbeResult`(:25), `RunCliOptions`(:30), `InteractiveLeadInvocation`(:39), `formatCleanupSnapshot`(:533) — cli 테스트는 `runCli`, `CliIo`, `format*` 등만 임포트(`packages/cli/test/cli.test.ts:10-15`)
- `packages/herdr/src/`: `HerdrWorkerLabel`(worker.ts:15), `HerdrWorkerRuntimeOptions`(client.ts:41), `WorkerLabelInput`(client.ts:558), `PaneTextSender`(bounded-sender.ts:8), `ParsedPaneLine`(relay.ts:30), `SteerRelayOptions`(relay.ts:57)
- `packages/orchestrator/src/`: `RunRequest`·`ExistingRunRequest`(coordinator.ts:26,34), `LoadLoopConfigOptions`·`ResolveConfigDirectoryOptions`(config.ts:101,87), `LoopRuntimeOptions`·`ObservedWorkerState`·`StartRunInput`·`WorkerReconciler`(runtime.ts:17,11,29,13), `PersonaResolution`·`ResolvePersonaInput`(persona.ts:36,45), `ProviderCompositionOptions`(composition.ts:26), `CompletionRunner`·`CompletionEvidence`·`CompletionProcessResult`(completion.ts:24,15,8), `BenchmarkControl`·`BenchmarkRunRequest`·`BenchmarkRunRow`·`BenchmarkScenario`·`WorkflowProfileName`(benchmark.ts:35,50,61,45,23)
- `packages/pi-loop/src/`: `HerdrLifecycleEnvironment`·`HerdrLifecycleOptions`(herdr-lifecycle.ts:23,29), `AttentionView`(ui/attention.ts:3), `StatusView`·`StageStatus`(ui/status.ts:3,10), `WorkerView`(ui/worker.ts:3), `RunSummaryView`(ui/summary.ts:4), `CompactFinding`·`ReviewFinding`(lead/reduce.ts:10,3)
- `packages/presentation/src/`: `CompactedItems`·`CompactLinesOptions`(compact.ts:15,9)
- `packages/providers/src/`: `AgyStreamDriverOptions`·`AgyTurnResult`(antigravity/driver.ts:22,34), `MirrorSinkInput`·`PaneMirrorSinkOptions`·`PaneRelayAssignment`·`RenderOptions`(mirror.ts:35,251,244,44), `toMirrorSink`(mirror.ts:37 — :405 내부 사용), `classifyFailure`(process-provider.ts:224 — :130-131 내부 사용), `NodeProcessRunnerOptions`·`ProcessEvent`(process.ts:31,17), pi/models-json.ts 카탈로그 타입 11종(:33-347)

### 1.5 생성 protocol 표면 — 보류(수작업 편집 금지)

`packages/protocol/src/generated/events.ts`의 `RustraEventName`(:10), `RustraEventPayloads`(:13), `SubscribeFn`(:21), `onRustraEvent`(:27)은 생성 파일 외 참조 0건. 생성 commands·codecs의 다수 심볼도 TS 측 미사용(예: `addTask`, `getRun`, `updateTask`, `recordDecision`, `subscribeEvents` — 생성 파일 간 상호 참조만 존재). 이 표면은 Rust 교량 정의에서 `bun run codegen`으로 재생성되므로(AGENTS.md 경계 규칙) 수작업 제거 대상 아님. `bun run codegen:check` 통과 확인 — Rust 원본과 정합. 보류.

---

## 2. 스테일 서술

구분 기준: **생존 문서**(README, architecture.md, provider-support.md, model-routing.md — 계속 갱신되는 계약 문서)의 불일치는 수정 권장. **날짜 기록 문서**(research/decision/plan — 작성 시점 스냅샷을 명시)는 원칙적으로 보존하되, 이후 판돌이 잘못 인용하지 않도록 이 보고서가 정정 근거를 남긴다.

### 2.1 생존 문서 결함 — 수정 권장

| # | 위치 | 서술 | 실제 | 권고·위험도 |
| --- | --- | --- | --- | --- |
| S-1 | `README.md` "Repository map"(~:25-36 표) + `docs/architecture.md` 계층표 | `packages/presentation` 계층 미기재 | `@loop/presentation`은 활성 워크스페이스 패키지(`packages/presentation/package.json`)로 `packages/pi-loop/src/ui/*`(snapshot/status/summary/graph/models/attention/worker), `lead/reduce.ts`, `extension.ts`, `packages/cli/src/main.ts`가 임포트 — pi-loop·cli의 렌더 기반 | 수정(행/계층 추가). 위험도 낮음 |
| S-2 | `docs/research/2026-09-exploration-priorities.md:59` | "f1(pi-loop 페르소나 3중 복제)만 미착지" | f1 착지(§5) — `extension.ts:8-12` 단일 소스 임포트, `:29-31` 산문 파생(커밋 `5692091`, `428b018`) | 갱신(roadmap :13 "추기" 방식). 위험도 낮음 |
| S-3 | `docs/research/2026-09-exploration-priorities.md:52` | deferred-2 "미착지 — P7/P8/P9 스테일 문구 잔존(`provider-support.md:8,12`)" | `1f557a6`로 현행화 완료 — Pi 행은 mixed routing·openai-codex(ChatGPT native login) 인증 서술, Antigravity 행은 `AgyPersistentProvider` persistent 모드 등재(본 감사 원문 대조 확인) | 갱신(추기). 위험도 낮음 |
| S-4 | `docs/research/2026-09-exploration-priorities.md:47` | deferred-1 "`worker.rs:8-11` 주석이 사실과 다른 신규 drift + `sqlite.rs` Debug 포맷 저장 잔존" | 둘 다 해소 — `worker.rs:5-15` 주석이 "Nothing in the bridge transports it today"로 정정(동결 계약 서술 포함), `sqlite.rs`에 `format!("{:?}")` 0건(`37981a2` 상수화 + `worker-state-vocabulary.rs` 동결 테스트) | 갱신(추기). 위험도 낮음 |

### 2.2 날짜 기록 문서의 스테일 절대 서술 — 보존·정정 근거 기록

| # | 문서 | 스테일 서술 | 현재 사실 | 권고 |
| --- | --- | --- | --- | --- |
| S-5 | `docs/research/cleanup-inventory.md` | "`HerdrWorkerRuntime.cleanup` … called only from `lifecycle.test.ts:69`"(D7/gap 1), "zero `DELETE FROM` in `crates/`" | cleanup 프로덕션 호출 존재: `packages/providers/src/herdr-agent.ts:162`, `packages/herdr/src/client.ts:309`. `DELETE FROM` 3건(`crates/loop-store/src/sqlite.rs:215,324,599`) + `purge_run`/`purge_plan` 교량 명령(`commands.rs:816,826`) | 보존(다중 갱신 노트가 있는 스냅샷). 잔존 참 claim: `disposeAll` 0호출(P-3), B3 온도 누수(§4) |
| S-6 | `docs/adr/cleanup-and-retention.md`(검증 노트) | "빈 `crates/loop-core/src/herdr/` 존재" | 해당 디렉터리 부재(`find -type d -empty` 0건). `WorkerState` 저장 어휘는 상수화·동결됨 | 보존(2026-09-22 검증 이력) |
| S-7 | `docs/research/2026-09-24-backlog-reconciliation.md` 상태 요약표 | deferred-1 부분 착지·deferred-2 미착지·priority-3(b) 부분 착지·f1 미착지 | 전부 이후 커밋으로 착지: `37981a2`(실행 1), `1f557a6`(실행 2), `9724e81`(실행 3), `5692091`+`428b018`(f1) | 보존 — `docs/decisions/2026-09-24-evolution-roadmap.md:13`이 "본 문서(roadmap)가 착지 해석 기준"으로 지정했으므로 재작성 불필요 |
| S-8 | `docs/research/2026-09-docs-drift-report.md:45`(C4) | print 어댑터 기본 computeClasses에 frontier 부재 | 전제 소멸 — 어댑터 생성자 `computeClasses` 필수 옵션화(하드코딩 기본값 없음, backlog-reconciliation §6에서 이미 무효화 판정) | 보존(무효화 판정이 재감사 문서에 이미 기록됨 — 후속 문서에서 재상정 금지) |

`docs/decisions/2026-09-24-herdr-caller-anchoring.md`는 "shipped — 구현과 일치"로 최종 확정돼 있어 스테일 아님(수정 불가 파일, §6).

---

## 3. 잔여 참조 (제거된 개념)

### 3.1 jev — 의도적 잔여(제거 대상 아님)

| 위치 | 내용 | 판정 |
| --- | --- | --- |
| `packages/orchestrator/src/config.ts:268-272` | `provider jev is no longer supported; remove or disable providers.jev` — 레거시 스탠자 거부 가드 | **유지** — `config.unsupported_provider` 마이그레이션 계약의 구현체. 테스트 존재 |
| `tests/configuration.test.ts:54-81` | 위 거부 동작 테스트(레거시 `[providers.jev]` TOML 픽스처 포함) | **유지** — 가드의 회귀 테스트 |
| `docs/provider-support.md:24` | "Jev is no longer a supported provider…" | **유지** — 운영자 계약 서술, 코드와 일치 |
| `docs/research/2026-09-21-provider-*jev*` 2건, `docs/decisions/2026-09-21-routing-jev-disable-and-pi-coverage.md` | jev 비활성 결정·영향 감사 | **보존** — 역사 기록 |
| `config/providers.example.toml` | `[providers.jev]` 스탠자 부재 확인 | 정상 — 예시에서 이미 제거됨 |

코드상 jev 어댑터 잔여는 0건: `packages/providers/src/jev/` 디렉터리 부재, `packages/providers/src/index.ts` 수출 목록에 jev 없음.

### 3.2 삭제된 파일 경로를 가리키는 역사 plan 문서 — 보존

| 위치 | 내용 | 판정 |
| --- | --- | --- |
| `docs/reliable-runs-commit-plan.md:107` | "`packages/providers/src/jev/client.ts` — 삭제" | 보존 — 2026-09-21 시점 실행 계획 기록. 해당 파일 삭제는 이미 완료된 상태 |
| `docs/superpowers/plans/2026-09-21-loop-standalone-herdr-plan.md:166` | "Modify: `packages/providers/src/jev/client.ts`" | 보존 — 작성 시점엔 파일이 존재했던 plan 문서 |
| `docs/superpowers/plans/2026-09-21-loop-standalone-herdr-plan.md:184` | "Replace: `packages/pi-loop/src/lead/coordinator.ts`" | 보존 — 단 §1.1 D-1로 이 모듈이 이제 실제 제거 후보가 됨(계획 문서와 무관하게 현재 사실 기준) |

### 3.3 PersonaWorkerStartInput — 정리 완료

- 코드 잔여: `packages/orchestrator/src/task-execution.ts:9`의 제거 이력 주석 1건뿐(의도적 기록). 임시 타입 자체는 소멸, `StartWorkerInput.personaInstructions` 복원(`packages/providers/src/types.ts:51`).
- 문서 언급(`2026-09-simplify-audit.md:26,30`, `2026-09-execution-summary.md:27` 등)은 전부 시점 기록 서술로 코드 사실과 모순 없음.

### 3.4 기타 제거 개념

- `WorkerStatus`(구 어휘): `packages`·`crates` 전역 0건 — 완전 소멸(`lost` 어휘로 통일, `crates/loop-core/src/run/worker.rs:33`).
- `crates/loop-core/src/herdr/` 빈 디렉터리: 부재 — 소멸(§2.2 S-6 참조).

---

## 4. 임시·디버그 산물

| 항목 | 결과 |
| --- | --- |
| 커밋된 TODO/FIXME/HACK/XXX | **0건** — `packages/*/src`, `crates/*/src`, `scripts`, `tests`, `config` 전역 grep |
| 콘솔 디버그 출력 | **0건** — 프로덕션 TS에 `console.*` 부재. 테스트 픽스처/스폰 스크립트 문자열만 존재(`packages/cli/test/fixtures/detached-observer.ts:4` 등, 의도적) |
| Rust `println!`/`dbg!` | 프로덕션 0건. `crates/loop-store/tests/projection_performance.rs:30` 벤치마크 출력 1건(테스트, 정상) |
| 주석처리된 코드 블록 | 0건 — `// const/return/if/await/...` 패턴 grep |
| `@ts-ignore`/`@ts-expect-error`/`unreachable!`/`todo!` | 0건 |
| 빈 디렉터리 | 0건 — `find packages crates scripts tests config docs -type d -empty` |
| 임시 파일 | 0건 — `git status` clean, 루트에 gitignored 항목(`mytest.db*`, `dist/`, `target/`, `node_modules/`)만. gitignore 패턴(`.gitignore:1-7`)이 로컬 산물을 정상 커버 |
| **잔여 갭 1건** | `packages/cli/src/main.ts:701` — `verify-install`이 `mkdtempSync(join(tmpdir(), "loop-acceptance-"))` 디렉터리를 만들고 회수 경로 없음(`rmSync` main.ts 0건). `cleanup-inventory.md` B3로 이미 기록된 알려진 항목. 권고: **보류**(기존 갭 추적 소관) — `try/finally` + `rmSync(dir, { recursive: true, force: true })`가 기존 권고 해법 |

`scripts/trace-report.ts`는 자기추적 보고 도구로 문서화·사용 가능 상태(디버그 산물 아님). `pi-extensions/`, `plugins/`는 Loop 빌드 외부의 pi 확장(`pi-extensions/README.md` 명시, tsconfig 제외)로 의도적 산출물.

---

## 5. simplify f1~f5 착지 확인 + 감사 문서 스테일 상태

| finding | 상태 | 근거(file:line) |
| --- | --- | --- |
| f1 pi-loop 페르소나 3중 복제 → 단일 소스 | **착지** | `packages/pi-loop/src/extension.ts:8-12`(`@loop/orchestrator/persona`에서 `KIND_DEFAULT_PERSONAS`·`PERSONA_IDS`·`EXPLICIT_ONLY_PERSONA_IDS` 임포트), `:29-31`(산문이 상수에서 파생), 로컬 `KNOWN_PERSONA_IDS` 부재. 커밋 `5692091`(어휘), `428b018`(산문 파생) |
| f2 resolvePersona 이중 조회 | **착지** | `packages/orchestrator/src/persona.ts:53-67` — 기본 조회 1회 후 분기 |
| f3 coordinator 루프 불변 옵션 전개 | **착지** | `packages/orchestrator/src/coordinator.ts:196` — `{ ...taskExecutionOptions, context, workerId, provider }` 한 식 |
| f4 `persona === null \|\| === ""` 병합 | **착지** | `packages/pi-loop/src/extension.ts:477-483` — `if (persona && …)` 단일 조건 |
| f5 PersonaWorkerStartInput 제거 | **착지** | `packages/orchestrator/src/task-execution.ts:9`(제거 주석), `:56`(조건부 스프레드 한 식), `packages/providers/src/types.ts:51`(`personaInstructions` 복원) — 분리 금지 조건 이행 확인 |
| 죽은 경로: `src/jev/` 빈 디렉터리 | **소멸 확인** | 디렉터리 부재(§3.1) |
| 죽은 경로: `BoundedPaneSender` 죽은 수출 | **무효화 확인(실사용)** | `packages/providers/src/mirror.ts:2,276`이 `@loop/herdr` `BoundedPaneSender` 사용. 단 mirror.ts는 수정 금지 파일(§6) — 조사만 |

**감사 문서 스테일 상태 서술 결론**:

- `docs/research/2026-09-simplify-audit.md` — findings 5건 전부 착지 완료. 본문은 날짜 기록 스냅샷(현재 시점을 주장하는 상태 라인 없음)이라 파일 갱신 불필요.
- `docs/research/2026-09-exploration-priorities.md` — "상태(2026-09-24 재감사)" 라인 3건(:47, :52, :59)이 이후 커밋들로 스테일화됨(§2.1 S-2~S-4). 갱신 시 roadmap :13의 추기 규칙 준수 권고.
- 부수 확인: 미해결 리스크의 P14(jev 거부)는 이번 감사가 코드·테스트·문서 일치를 확인(§3.1) — not-in-scope 5건 중 1건 검증 완료로 기록.

---

## 6. 수정 금지 파일 조사 결과 (수정 불가 — 타 실행 소관)

다음 7파일은 읽기 조사만 수행했다. 이 보고서는 이 파일들의 수정을 권고하지 않는다.

| 파일 | 조사 결과 |
| --- | --- |
| `packages/herdr/src/client.ts` | 프로덕션 cleanup 호출(:309)·`herdrCallerFromEnvironment`(caller 파싱) 관측 — §2.2 S-5 정정 근거로 사용. 이상 없음 |
| `packages/herdr/test/lifecycle.test.ts` | `runtime.cleanup` 호출(:131) 관측. 이상 없음 |
| `packages/herdr/test/caller.test.ts` | 존재·정상. 이상 없음 |
| `packages/providers/src/herdr-agent.ts` | `#wait` teardown cleanup 호출(:162), 요약 redact(:210, :224, :260-261) 확인. 이상 없음 |
| `packages/providers/src/mirror.ts` | 저위험 관찰 1건(기존 기록과 동일): `result()`의 `[result] ${res.summary}` 발행(:471-474)이 `#publishLines`(:498-502)를 통해 `cleanLine`(:174) 없이 sink로 전달. 원천 redact(herdr-agent :210/:224)로 자격증명은 전이적으로 차단 — `2026-09-24-backlog-reconciliation.md` 신규 발견란과 동일 결론. **수정 불가(타 실행 소관)** |
| `packages/providers/test/mirror.test.ts` | 존재·정상. 이상 없음 |
| `docs/decisions/2026-09-24-herdr-caller-anchoring.md` | "decided(shipped)" 상태로 코드와 일치. 스테일 아님. **수정 불가(타 실행 소관)** |

---

## 검증

- `test -s docs/research/2026-09-24-weird-inventory.md` — 본 파일 존재.
- `grep -q 죽은 docs/research/2026-09-24-weird-inventory.md` — 카테고리 라벨 포함.
- `bun run codegen:check` — 통과(생성 protocol이 Rust 교량과 정합, §1.5).
- `bun run typecheck` — 통과(§1 제거 후보들이 현재 타입 수준에서 무결임을 확인하는 기준선).
- 죽은 수출 탐지 스크립트 2회 전수(패키지 src 전체 + Rust `pub` 전체), 개별 심볼 grep 재확인.
- 유료 모델 호출 없음. 모든 근거는 정적 읽기 + 오프라인 명령.

## 미해결 리스크

- §1.1 D-1/D-2 제거는 공개 면(패키지 index 재수출) 축소를 수반한다. 외부 소비자가 없음을 전제로 하나(저장소 내 전수), `@loop/*` 패키지가 사설(private)임을 확인했으므로(`package.json: "private": true`) 위험은 낮다.
- §1.3 P-2(recover 미배선)와 §4 B3(온도 누수)는 이물질이라기보다 알려진 기능 갭이다. 본 보고서는 기록만 하고 기능 결정(배선 vs 제거)은 소관 태스크로 넘긴다.
- 수정 금지 7파일에 대한 관찰(mirror cleanLine 등)은 해당 실행이 착지한 이후 재검증이 필요하다.
