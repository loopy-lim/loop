# 검증 — worker 패널 steer 릴레이 (watch-to-steer)

- **일자:** 2026-09-23
- **태스크:** `verify-steer-relay` (attempt 0)
- **입력:** docs/decisions/2026-09-23-watch-to-steer.md (decided), 의존 태스크 implement-steer-relay 결과 요약
- **판정:** **자동 검증 전량 통과.** `bun run build:cli` PASS, `bun run check` 전 체인 PASS(exit 0 — codegen:check → typecheck → test:architecture → cargo test --workspace + bun test 261 pass / 0 fail), 오프라인 인수 PASS(`{"status":"completed",...}`, exit 0). 결정 문서의 계약 항목(steer 경로 동일성, provider stdin 날것 주입 금지, 릴레이 수명=pane 수명, 게이트 독립, 에코 redaction, headless 폴백)을 테스트 증빙으로 확인했다.
- **증빙 규칙:** 모델 호출 없음(오프라인 전량). git history 커맨드·대량 편집 스크립트 미사용.
- **미수행(수동 증빙):** 실제 로그인 상태에서의 라이브 herdr 패널 타이핑 — 결정 문서가 처음부터 사용자 수동 검증으로 분류한 항목이다(§4). 본 태스크의 자동 증빙 판정에 영향 없음.

## 1. 검증 커맨드 결과

### 1.1 `bun run build:cli` — PASS

```
$ cargo build -p loop-bridge && bun run build:pi && bun build --compile packages/cli/src/main.ts --outfile dist/loop && bun scripts/stage-native.ts
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.05s
$ bun build packages/pi-loop/src/extension.ts --target=node --outfile dist/loop-pi-extension.js
Bundled 390 modules in 15ms
  loop-pi-extension.js  80.91 KB  (entry point)
  [11ms]  bundle  114 modules
  [86ms]  compile  dist/loop
```

`dist/loop`가 재생성됐으므로 이어지는 verify-install은 방금 빌드한 바이너리로 수행했다.

### 1.2 `bun run check` — **PASS (exit 0, 전 체인)**

`codegen:check && typecheck && test:architecture && test` 체인이 중단 없이 끝까지 실행됐다(파이프라인 `CHECK_EXIT=0`로 재확인).

- **`codegen:check` — PASS.** Rust 스키마 ↔ 생성 TS 동기화.
- **`typecheck` — PASS.** 체인이 후속 단계를 실행했으므로 오류 0.
- **`test:architecture` — PASS.** 경계 위반 없음(loop-core 중립성, Rustra 유일 seam, 의존성 비반전 포함).
- **`cargo test --workspace` — PASS.** 전 타겟 `test result: ok`(0 failed).
- **`bun test packages tests plugins ...` — PASS.** **261 pass / 0 fail, 1134 expect() calls, 37 files, 11.74s.**

### 1.3 `./dist/loop verify-install --json` — PASS (오프라인 인수)

```
{"status":"completed","tasks":7,"maxConcurrent":3,"escalations":1}
```

exit 0. fake-provider 마일스톤만으로 구성된 기존 오프라인 인수 경로 그대로 — 릴레이 추가가 오프라인 계약을 흔들지 않았다.

## 2. 결정 문서 대비 피처 검증

결정: docs/decisions/2026-09-23-watch-to-steer.md. 각 계약 항목의 구현 위치와 테스트 증빙:

| 계약 | 구현 | 증빙 (261 pass 중 관측된 (pass) 라인) |
| --- | --- | --- |
| 패널에 릴레이 프로세스 부착 (`herdr pane run`) | `HerdrWorkerRuntime.runInPane` (client.ts:216), `PaneMirrorSink.#attachRelay` (mirror.ts) | "runInPane hosts the steer relay process via pane run" / "PaneMirrorSink > relay is hosted in the pane and mirror lines are framed for it" / "panes visibility hosts the steer relay in each worker pane via the composition relayCommand" |
| 입력 줄 → `loop steer`와 동일한 steer 경로 | 릴레이 `deliver` → `protocol.steerRun` (main.ts:865) == `loop steer`의 `protocol.steerRun` (main.ts:156) | "SteerRelaySession > a typed line is delivered as steer with the worker's run/task ids and echoed redacted" |
| **provider 프로세스 stdin 날것 주입 금지** | 릴레이는 pane 호스트 별도 프로세스며, 원문은 steerRun으로만 전달. pane 표시는 redact+clamp된 에코 한 줄뿐 | "the steer message carries the raw typed line; only the echo is redacted" / "echoes are clamped to the line limit" |
| 릴레이 수명 = worker/pane 수명 | pane close → relay stdin EOF → `runSteerRelaySession` 반환 → 프로세스 종료 (relay.ts, main.ts `runSteerRelay`) | "the relay dies with the pane: worker finish closes the pane and ends the relay" / "runSteerRelaySession > processes every line and returns when the source ends (pane close → stdin EOF)" |
| steer는 가시성 게이트와 독립 | `loop steer`는 visibility 조건 없이 항상 steerRun (main.ts:153–156); 릴레이는 `visibility === "panes"`에서만 부착 — off/watch에서도 `loop steer` 유지 | "without a relay builder the pane stays plain and nothing is hosted (v1 identical)" / "headless environments never create panes or host relays (fail-open)" / "panes visibility without herdr context never hosts a relay (headless no-op)" |
| 에코는 `redactProviderText` 경유만 표시 | 릴레이에 redact 함수 주입 (main.ts:873), 원문은 백엔드로만 | "a typed line is delivered as steer ... and echoed redacted" / "a failed delivery echoes a redacted failure and the relay stays alive" |
| 릴레이 실패 시 CLI 폴백 유지 | 스폰 실패 시 `framed=false`로 v1 미러링 계속, `loop steer` 잔존 | "relay spawn failure degrades silently to plain v1 mirroring" |
| 경계: loop-core는 pane/relay 모름 | relay는 packages/herdr(TS 어댑터) + cli 어댑터에만 존재, loop-core 무변경 | test:architecture 전체 PASS ("loop-core exports only provider-neutral orchestration modules" 등) |

프레이밍 계약도 고정돼 있다: 릴레이 생존 중 미러 출력은 `{"loopDisplay": ...}` 단일 줄 JSON으로 감싸고(parsePaneLine이 표시로 분류), 그 외 모든 줄은 사용자 steer 입력으로 처리한다. 사용자가 우연히 유효한 display 프레임을 치면 표시로 처리됨이 테스트로 명시적 동작이다("a user typing a display frame gets it displayed (no steer, no crash)").

## 3. 릴레이 전용 테스트 목록 (모두 pass)

- packages/herdr/test/relay.test.ts — parsePaneLine 프레임 왕복/임베디드 개행/비프레임 JSON은 steer, SteerRelaySession 전달·redacted 에코·clamp·다중 줄·빈 줄 스킵·전달 실패 생존, runSteerRelaySession EOF 종료
- packages/providers/test/mirror.test.ts — relay 호스팅+프레이밍, 스폰 실패 폴백, pane 종료 시 relay 종료, relay 없는 v1 동일성, headless no-op, 생성 중 finish된 pane 정리
- packages/herdr/test/lifecycle.test.ts — runInPane이 `pane run`으로 relay 호스팅
- packages/orchestrator/test/visibility.test.ts — composition relayCommand 경유 호스팅, headless 미호스팅
- packages/cli/test/cli.test.ts — `steer relay process command mirrors the owner spawn layout` (bun 엔트리 vs 컴파일 바이너리 분기), `__steer-relay` 인자 검증이 상태 접근 전에 실행

## 4. 수동 증빙 항목 (사용자 — 본 태스크에서 미수행)

결정 문서의 테스트 전략이 "실제 herdr 패널 상호작용은 사용자 수동 검증"으로 명시한다. 자동 검증으로 대체 불가한 항목:

1. 실제 로그인된 provider로 뜬 워커 패널에서 타이핑 → steer가 해당 run/task에 도달하고 패널에 확인 에코가 뜬다.
2. 워커 종료(pane close) 시점에 릴레이 프로세스가 실제 herdr 환경에서 같이 끝난다.
3. 미러 출력과 사용자 타이핑이 한 패널에 섞여 보이는 실제 가독성.

모델 호출 금지 가드에 따라 본 태스크는 위 항목을 실행하지 않았으며, 1–3은 fake provider/herdr 테스트가 동일 시나리오를 대리 증명한다.

## 5. 범위 경계 및 잔여 리스크

- **benchmark 레지스트리는 릴레이 미부착(의도된 omit).** `benchmark` 명령의 `buildProviderRegistry` 호출은 `relayCommand`를 전달하지 않는다(packages/cli/src/main.ts:216). 의존 태스크의 통보와 일치하며, v1 패널 동작 유지가 의도다. 벤치마크 패널에서의 steer는 `loop steer` 폴백으로 가능하다.
- **`visibility === "panes"` 조건의 누락 갭 없음.** `workerVisibility` 도메인이 `off|watch|panes` 3값뿐(config.ts:364, `"both"`는 ConfigError)이라 pane 모드 전집합을 커버한다.
- **라이브 패널 타이핑 미검증.** §4의 사용자 수동 증빙이 남아 있다. 자동 계약은 전부 충족.
- **프레임 충돌은 알려진 트레이드오프.** 사용자 입력이 우연히 `{"loopDisplay": ...}` 프레임과 동일하면 steer 대신 표시된다(테스트로 고정된 동작). 실사용 빈도상 희귀하며, 오류 없이 안전하게 처리된다.
- **릴레이 에코는 패널 pty 환경 의존.** 컴파일 바이너리 경로에서 `executablePath = process.execPath`를 쓰는데, 실제 herdr pane의 spawn 환경에서의 최종 확인은 §4 수동 증빙에 포함된다.
