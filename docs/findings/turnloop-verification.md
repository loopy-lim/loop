# Turnloop 최종 검증 (M-TL0..M-TL3 + e2e 스모크)

- **Date:** 2026-09-26
- **Kind:** verification (`turnloop-final-verification`)
- **Scope read:** `AGENTS.md`, `crates/**`, `docs/**`, `packages/**`
- **Write:** `docs/findings/turnloop-verification.md` (이 문서)
- **유료 모델 호출: 0** — 전체 검증은 `FakeModelClient`(스크립트된 턴)와 `FakeProvider`로 수행했다.

## 결과 요약

| # | 인수 기준 | 결과 |
|---|---|---|
| 1 | 가짜 모델 e2e — 실행 중 GuidanceAdded → 다음 턴 경계 반영 → GuidanceDelivered 워터마크 기록 | **PASS** |
| 2 | pi lane 기본 + 혼합 모드 이벤트 계약 동일성 | **PASS** |
| 3 | M-TL2 steer 지속성 — at-most-once 라이브, 크래시 폴백, descendant 클레임 주입 | **PASS** |
| 4 | `bun run check` (codegen:check + typecheck + architecture + 전체 테스트) | **PASS** |
| 5 | `cargo test --workspace` | **PASS** (138 passed / 0 failed / 1 ignored) |
| 6 | 경계 — loop-core provider 개념 금지, turnloop import 화이트리스트 | **PASS** (주 1 참조) |
| 7 | `docs/findings/turnloop-verification.md` 존재 | **PASS** (이 문서) |

## 1. 핵심 e2e 스모크 (실행 중 steer → 다음 턴 경계 반영)

**증거:** `packages/orchestrator/test/steer-delivery.test.ts` —
`"end-to-end: mid-run guidance reaches a turn-loop worker at the very next fake-model turn and is recorded"`

```text
$ bun test packages/orchestrator/test/steer-delivery.test.ts -t "end-to-end"
  1 pass / 0 fail / 9 expect() calls [660.00ms]
```

시나리오(스크립트된 `FakeModelClient` + 파킹 툴, 이벤트는 실제 `protocol.steerRun`/`subscribeEvents` 경유):

- 턴 1이 서브된 뒤 툴이 루프를 파킹 → 실행 중 `GuidanceAdded`("steer: follow the recorded evidence")를 로그에 기록.
- **툴 완료 대기 없이** 메일박스가 실행 중 워커에게 인도하고 `GuidanceDelivered`가 `through_sequence = 해당 guidance 시퀀스`로 기록됨(공동 응집 창 10 s를 기다리지 않음 — 턴 경계 워커의 인박스가 응집기).
- 툴 완료 후 턴 2 요청 메시지에 해당 steer가 정확 1회 존재, 이후 steer는 미포함.
- 같은 창 안의 두 번째 steer도 다음 틱의 인박스로 즉시 인도 → 워터마크 오름차순 `[firstSequence, secondSequence]` 2건의 `guidance_delivered` 이벤트, worker id는 `${provider}:${task}` 형식.
- 턴 3(최종) 트랜스크립트에 두 steer가 각각 정확 1회씩 존재 — 재주입 없음.

## 2. pi lane 기본 + 혼합 모드 계약 동일성 (M-TL3)

**증거:** `packages/orchestrator/test/profile.test.ts`

```text
$ bun test packages/orchestrator/test/profile.test.ts -t "pi lane"      → 1 pass / 0 fail
$ bun test packages/orchestrator/test/profile.test.ts -t "mixed-mode"   → 1 pass / 0 fail
$ bun test packages/orchestrator/test/profile.test.ts -t "deterministically" → 1 pass / 0 fail (config.turnloop_lane_unavailable)
$ bun test packages/orchestrator/test/profile.test.ts -t "unknown lane" → 1 pass / 0 fail (config.unknown_worker_lane)
$ bun test packages/turnloop/test/capability.test.ts                    → 6 pass / 0 fail
```

- lane 키 부재 == 명시적 `lane = "pi"` — 동일 합성, 무영향(기본 유지 확인).
- 혼합 모드: 한 런에서 pi-lane FakeProvider(tiny)와 TurnLoopProvider(fake 모델, fast)가 공존. 런 전 guideline이 두 레인 모두 클레임 컨텍스트로 주입되고, `worker_started` / `worker_finished` / `guidance_delivered` 페이로드 어휘가 레인과 무관하게 동일함을 검증.
- 설정 키 문서: `docs/research/turnloop-profiles.md` (lane 키, 3층 게이팅 표, 결정론적 에러 코드).

## 3. M-TL2 steer 지속성 (폴백·정확 1회)

**증거:** `packages/orchestrator/test/steer-delivery.test.ts` (개별 실행 모두 0 fail)

- `-t "watermark survives"` → 메일박스 재시작 후 재-steer 없음(at-most-once, 1 pass).
- `-t "crash"` → steer 인도 직후·기록 전 크래시 시뮬레이션 → 다음 클레임에서 정확 1회 주입, `through_sequence` 일치(1 pass).
- `-t "claimContext"` → 조상 대상 guidance가 자손 클레임 컨텍스트에 정확 1회 주입, 워터마크 흡수, 무관 태스크 미노출(2 pass).
- `-t "descendant"` → 부모 guidance가 자손 live 워커에 전달, 레인별 워터마크 기록(2 pass).
- `"-t delivered-then-recorded"` → 라이브 인도된 guidance가 재시도 시도의 시작 컨텍스트에 반복되지 않음(포함 실행에서 pass).

## 4. 전체 체크

```text
$ bun run check   # = codegen:check && typecheck && test:architecture && test
- codegen:check: 생성물 일치 (별도 재실행도 CLEAN 확인)
- typecheck (tsc): 오류 없음
- tests/architecture-boundaries.test.ts: 9 passed; 0 failed
- cargo test --workspace: 전 suites "test result: ok"
- bun test packages tests plugins scripts/rustra-codegen.test.ts:
  463 pass / 0 fail / 1966 expect() calls / 55 files [21.77s]
```

```text
$ cargo test --workspace (별도 실행)
total passed=138 failed=0 ignored=1   (ignored: projection_performance 벤치성 테스트 1건)
```

## 5. 경계 확인

- **loop-core provider 금지:** 아키텍처 테스트 1번이 loop-core 전체 소스에서
  `/Codex|Herdr|PiRuntime|Antigravity|Z\.AI/` 및 `/\bprovider\b/i` 부재를 강제 — green.
- **turnloop import 화이트리스트:** `packages/turnloop/test/boundaries.test.ts` +
  `tests/architecture-boundaries.test.ts` — green.
- **주 1:** 태스크 명세는 "turnloop은 @loop/protocol만 import"로 적혀 있으나, 실제 강제 규칙은
  **`@loop/protocol` + `@loop/providers`(어댑터 계약/프롬프트 어댑터) 화이트리스트**다
  (`packages/turnloop/test/boundaries.test.ts`의 allowed set). 이는
  `packages/turnloop/src/index.ts` 문서 헤더와 ADR TL1 금지 목록과 일치하며,
  loop-core/loop-store/loop-bridge/orchestrator 및 그 외 워크스페이스 패키지 import는 금지된다.
  `@loop/providers` import는 계약 타입 소비이지 provider 개념의 역류가 아니므로 경계 위반이 아니다.
- **codegen:** `bun run codegen:check` CLEAN — Rust 스키마와 생성 TypeScript 일치.
- **유료 모델 호출 없음:** 모든 턴루프 검증은 `FakeModelClient` 스크립트 턴으로 수행.

## 미해결 리스크

- M-TL3는 실제 ModelClient 바인딩을 배송하지 않는다(CLI에서 `lane = "turnloop"` 선언은
  `config.turnloop_lane_unavailable`로 결정론적 거부). 실공급자 실측은 후속 ADR(M-TL4) 영역.
- 어댑터 폴백(`inProgressToolResults: false` → final-only 기록)은 단위 테스트로만 검증됨.
- `cargo test --workspace`의 ignored 1건(`projection_performance`)은 성능 프로브로 상시 제외 — 회귀 아님.

## 변경 파일

- `docs/findings/turnloop-verification.md` (신규, 이 문서) — 그 외 소스 변경 없음(검증 전용 태스크).
