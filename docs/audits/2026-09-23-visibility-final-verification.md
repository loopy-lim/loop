# 최종 검증 — worker-visibility 구현, gpt-6/persona 매트릭스, 전체 check

- **일자:** 2026-09-23 (attempt 2 갱신 — 전 체인 통과로 판정 전환)
- **태스크:** `verify-final` (loop-fc0ffbc6 후속 런의 마지막 검증 태스크)
- **판정:** **전체 통과.** `bun run build:cli` PASS, `bun run check` 전 체인 PASS(exit 0 — codegen:check → typecheck → test:architecture → test 233/0), 오프라인 인수 PASS, 피처 매트릭스 4/4 충족. 직전 시도의 typecheck 9오류는 의존 태스크의 수습으로 소멸했다(§1.2). 잔여 리스크는 §4: `WorkerState`가 브리지 등록이 아닌 providers측 손작성 유니온으로 해소됨(집 규칙과의 긴장), 실제 herdr 패널 플러딩 관측·pi `--mode json`(D2)은 결정 대기 유지.
- **증빙 규칙:** 모델 호출 없음(오프라인 전량). git history 커맨드·대량 편집 스크립트 미사용.

## 1. 검증 커맨드 결과

### 1.1 `bun run build:cli` — PASS

```
$ cargo build -p loop-bridge && bun run build:pi && bun build --compile packages/cli/src/main.ts --outfile dist/loop && bun scripts/stage-native.ts
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.03s
Bundled 390 modules in 12ms
  loop-pi-extension.js  80.91 KB  (entry point)
  [8ms]  bundle  113 modules
 [115ms] compile  dist/loop
```

### 1.2 `bun run check` — **PASS (exit 0, 전 체인)**

직전 시도(attempt 1)는 typecheck에서 9오류로 중단됐다. 현재 트리에서 수습 내역:

| attempt 1 오류 | 현재 상태 |
| --- | --- |
| `types.ts(1,48)` `@loop/protocol`에 `WorkerState` 없음 | 수습 — 다만 **브리지 등록이 아니라 providers측 손작성 유니온**으로 대체(`types.ts:9`, §4 리스크) |
| `lead.test.ts`·`ui.test.ts`의 `activities` 누락/구형 `activity` 잔존 6건 | 수습 — fixture 전면 마이그레이션(`lead.test.ts:115,430`, `ui.test.ts:249,263,331,344`에 `activities` 존재, 구형 단수 필드는 `toContain` 문자열 1곳만) |

단계별 결과:

- **`codegen:check` — PASS.** Rust 스키마 ↔ 생성 TS 동기화(활동 이력 `activities` 포함).
- **`typecheck` — PASS.** `tsc -p tsconfig.json` 무오류 종료.
- **`test:architecture` — PASS.** 6/6 (loop-core 중립성, Rustra 유일 seam, 의존성 비반전, 설정 격리 등).
- **`test` — PASS.** **233 pass / 0 fail / 1053 expect() calls, 35 files, 11.99s.** 직전 시도의 런타임 9적(lead 3, ui 2, persona 4) 전부 소멸. 구 debris `check_output.txt`의 `provisioned patterns` 회귀도 재현 없음.

### 1.3 `./dist/loop verify-install --json` — PASS (오프라인 인수)

```
{"status":"completed","tasks":7,"maxConcurrent":3,"escalations":1}
```

exit 0. 페이크 프로바이더 전체 런 완주, 유료/인증 호출 없음. 빌드 직후의 `dist/loop`로 실행(§1.1 산출물).

## 2. 피처 매트릭스 — 4/4 충족

### 2.1 gpt-6 — config/models.toml — PASS

| 항목 | 증거 줄 |
| --- | --- |
| pi 레인 프라이머리 `openai-codex/gpt-6-luna` (`provider = "pi"`, balanced) | `config/models.toml:96` |
| pi 레인 프라이머리 `openai-codex/gpt-6-sol` (`provider = "pi"`, frontier) | `config/models.toml:104` |
| codex 레인 폴백 `gpt-6-luna` (`provider = "codex"`) | `config/models.toml:141` |
| codex 레인 폴백 `gpt-6-sol` (`provider = "codex"`) | `config/models.toml:149` |

주석에 스모크 증빙(OK-LUNA-PI/OK-SOL-PI pi 0.87.1, OK-LUNA/OK-SOL codex-cli 0.155.1)과 "Primary gpt-6 traffic runs on the pi lane above" 구성 명시.

### 2.2 페르소나 파일 — config/personas/ — PASS

`architect.md`, `debugger.md`, `designer.md`, `implementer.md`, `reviewer.md` 5종. 런타임 확인: `loadLoopConfig({ configDirectory: "./config" })` → `personas` 키 = `reviewer,architect,debugger,designer,implementer` 5개 전부 로드(오프라인 import).

### 2.3 pi-loop `KNOWN_PERSONA_IDS` contains designer — **PASS (attempt 2에서 실현)**

attempt 1에서는 심볼 자체가 없어 "오케스트레이터 `PERSONA_IDS`만 충족"이었으나, 현재 트리에는 pi-loop측 구현이 존재한다:

- `packages/pi-loop/src/extension.ts:19` — `const KNOWN_PERSONA_IDS = ["implementer", "reviewer", "debugger", "architect", "designer"] as const;` (**designer 포함**)
- `:468` — 제출 시점 unknown persona 거부(`unknown persona '…' in task …`)
- `:118` — `loop_run` 도구 설명에 선택적 persona id 문구와 kind 기본값 문서화
- 검증: `bun test packages/pi-loop/test/persona.test.ts` — **5 pass / 0 fail** (전달·거부·트림·설명 문서화·stdin 직렬화)
- 오케스트레이터 정전 `PERSONA_IDS`(`packages/orchestrator/src/persona.ts:32`)도 동일 5종 — 양측 정합.

### 2.4 가시성 게이트 기본 off — PASS

- 정적: `config/policy.toml:29` `worker_visibility = "off"` (`"off" | "watch" | "panes"`), `:30` `worker_activity_lines = 5`, `:31` `worker_pane_limit = 4`.
- 런타임(오프라인 import): `loadLoopConfig` → `output.workerVisibility = "off"`, `workerActivityLines = 5`, `workerPaneLimit = 4`.
- 게이트 동작: `packages/orchestrator/src/composition.ts:161` `wrapForVisibility` — off면 providers를 그대로 반환(래핑·구독 없음, D5 끈 상태 동일성). watch 쪽 `packages/cli/src/main.ts:184` — off면 피드 렌더 옵션 자체를 `undefined`로 끊음.
- 설정 검증 회귀: config.test.ts의 `worker_visibility="both"` 거부 케이스 포함(`bun run check` 통과 집합 내).

## 3. 구현 증거 스냅샷 (결정 문서 대비)

### 3.1 D3 저장소 트랜스포트 — 구현, 코드젠 동기화

- `crates/loop-core/src/event/reducer.rs:62` `activities: BTreeMap<TaskId, VecDeque<String>>`, `:69` `ACTIVITY_HISTORY_LIMIT = 8` (저장 상한 8 ≥ 표시 기본 5), `:115` 상한 강제.
- `crates/loop-bridge/src/commands.rs:189` 스냅샷 `activities: Vec<String>`.
- `packages/protocol/src/generated/types.ts:110` `activities: string[]` — `codegen:check` PASS가 동기화 증빙.

### 3.2 D1 미러 데코레이터 — 구현

`packages/providers/src/mirror.ts`: `renderProviderEvent`(`:47`), `compositeSink`(`:182`), `PaneMirrorSink`(`:255`), `hasHerdrContext`(`:322`), `MirroringProvider`(문서 주석 `:177`). 주입: `packages/orchestrator/src/composition.ts:41` `StoreActivitySink`, `:161` `wrapForVisibility`.

### 3.3 D4 herdr 패널 sink — 구현, 실관측은 별도 evidence 대기

`mirror.ts:255` `PaneMirrorSink`(250ms 병합·유계, `worker_pane_limit` 소비). interactive(`HerdrAgentProvider`) 워커는 send-text 미러링 제외. **실제 herdr 패널 플러딩 계측은 결정 문서대로 별도 evidence로 남음** — 의존 태스크 finish-visibility 결과와 정합.

### 3.4 D5 watch 피드 렌더 — 구현

`packages/presentation/src/snapshot.ts:164`(활동 있는 running 태스크 필터), `:167`(`slice(-budget)`), `:182`(`activities.at(-1)`). `packages/cli/src/main.ts:184` `workerVisibility === "off"` 게이팅.

## 4. 종합 판정 및 잔여 리스크

| 완료 체크 | 결과 |
| --- | --- |
| full-check (`bun run check`) | **PASS** — exit 0. codegen:check·typecheck·architecture(6/6)·test(233/0) 전 단계 |
| offline-acceptance (`./dist/loop verify-install --json`) | **PASS** — `{"status":"completed","tasks":7,"maxConcurrent":3,"escalations":1}` exit 0 |
| audit-recorded (본 문서) | **PASS** — `workerVisibility`/`worker_visibility` 증빙 다수 포함 |

**잔여 리스크 (기록 전용, 본 태스크 write scope 밖):**

1. **`WorkerState` 손작성 유니온.** `packages/providers/src/types.ts:9`가 loop-core `WorkerState`(`crates/loop-core/src/run/worker.rs:26`, JsonSchema derive 포함)를 "mirroring … serde snake_case" 주석과 함께 **손으로 재수술**하고, 브리지 스키마에는 여전히 등록되지 않았다(`crates/loop-bridge/src`에서 0건). 이는 AGENTS.md 집 규칙 "Do not hand-write a TypeScript copy of a Rust domain type"과 긴장이 있으며, 향후 loop-core에 변종(예: 새 상태)이 추가될 때 조용히 어긋날 수 있다. 현재 typecheck·codegen:check·architecture 테스트 모두 이 격차를 잡지 못한다. 권장 수습: 브리지 등록 → `bun run codegen` → 손작성 유니온 삭제.
2. **별도 결정 대기:** 실제 herdr 패널 플러딩 관측(D4 evidence), pi `--mode json` 채택(D2) — 의존 태스크 결과 요약과 정합하게 계류 유지.
3. **debris 정리 후보:** untracked `check_output.txt`(스테일 로그), `fix-ts.js`, `scratch.ts` — 내용 기준 현재 트리와 무관하며 별도 청소 대상.

**인계 요약:** 완료 체크 3/3 통과로 본 검증 태스크의 계약은 충족. 남은 항목은 위 리스크 1(표준 위반 소지)과 2(외부 evidence)뿐으로, 어느 쪽도 이번 런의 범위가 아니다.
