# 런 스톨 감사 — `createComplexCodec` 와이어 취약 명령 전수 점검

날짜: 2026-10-03 · 상태: 감사 완료 (패치 후 잔여 위험 없음 확인)
상위 문서: `docs/findings/run-stall-diagnosis.md`

## 1. 배경

런 스톨의 근본 원인은 `@rustra/types` complex-codec의 와이어 버그 2겹이었고,
`patches/@rustra%2Ftypes@0.12.0.patch` 로 해제됐다(회귀 테스트
`packages/protocol/test/complex-worker-roundtrip.test.ts` 통과). 본 감사는
같은 취약 코덱(`createComplexCodec`)을 쓰는 **모든** 명령을 전수 나열하고,
패치 후 엔진 디스패치 경로에서 정상 왕복하는지 확인한다.

패치 내용(설치된 dist에 적용 확인):

- **버그 1 (응답)** — `node_modules/@rustra/types/dist/complex-codec.js:57-67`:
  Bun FFI caller 버퍼(`@rustra/bun/dist/bun-ffi.js:85-92`, capacity 512,
  `byteLength = capacity`)의 capacity 잉여 바이트를 `trailing bytes in
  complex response`로 거부하던 엄격 검사 제거(`void reader.remaining`).
  플랫폼 자체-종료 프레임 계약에 맞춤.
- **버그 2 (입력)** — `node_modules/@rustra/types/dist/complex-codec-compiled.js:92-105`:
  non-required nullable 필드(`["T","null"]` / `anyOf[T,null]`)의 option
  래퍼를 언랩해 presence 바이트 이중 태그를 제거(native fast-path의 plain
  serde `Option<T>` = 단일 태그와 정렬).

패치 적용 확인: `node_modules/@rustra/types/package.json` = 0.12.0 +
두 dist 파일에 "Loop local patch" 주석 존재.

## 2. `createComplexCodec` 명령 전수 목록

생성 코드 전체에서 `createComplexCodec`은 정확히 5곳에서 호출된다
(`packages/protocol/src/generated/frame-codecs.ts:163` import; 그 외 호출은
node_modules 내부). 레지스트리 등록:
`packages/protocol/src/generated/frame-registry.ts:35,37,79,81,83` (route: complex).

| # | 명령 | commandId | 정의 (frame-codecs.ts) | 입/출력 | 입출력 위험 필드 |
|---|------|-----------|------------------------|---------|------------------|
| 1 | `recordWorkerStarted` | 7 | :5173 | `WorkerInput` → `OperationOutput` | 입력 `executionOwner`/`state` non-required nullable (버그 2 경로) |
| 2 | `recordWorkerResult` | 8 | :5162 | `WorkerResultInput` → `OperationOutput` | 입력 `executionOwner`/`state` nullable (버그 2 경로) |
| 3 | `recordWorkerStopped` | 16 | :5184 | `WorkerInput` → `OperationOutput` | 동일 |
| 4 | `evaluateFailurePolicy` | 44 | :1611 | `EvaluateFailurePolicyInput` → `FailurePolicyOutput` | 입력 `failurePolicy`/`terminalizationPolicy` 중첩 optional, 출력 `retryScope`/`delayMs`/`dependents`/`independentBranches`/`run` nullable (버그 2 응답 디코드 경로) |
| 5 | `evaluateCleanupDisposition` | 45 | :1600 | `EvaluateCleanupDispositionInput` → `CleanupDispositionOutput` | 출력 enum `oneOf`(`x-rustra-variant-order`) |

이 5개가 전체이다. 다른 40여 개 명령은 손으로 작성된 postcard 생성 코덱
(자체 종료)이라 본 와이어 취약과 무관하다.

## 3. 명령별 엔진 디스패치 경로 감사

공통 경로: TS 호출부 → `packages/protocol/src/generated/commands.ts`의
`invokeGenerated*` → `@rustra/types` frame engine
(`dist/frame-engine-dispatch.js` roundTrip, `global-config.js:127`) →
`frameRegistry` 코덱 encode/decode → `@rustra/bun/dist/bun-ffi.js:92`
`rusta_ffi_invoke_frame_into` → Rust `loop-bridge` 핸들러.

### 3.1 `recordWorkerStarted` — ✅ 안전 (패치 후 정상 왕복, 라이브 경로)

- 호출부: `packages/orchestrator/src/coordinator.ts:307` — 워커 스폰(OS 부작용)
  **이전** 소유권 예약. 이 호출이 죽으면 런이 워커 0으로 스톨됐던 바로 그 지점.
- 계약 타입: `packages/orchestrator/src/control.ts:25`.
- Rust 핸들러: `crates/loop-bridge/src/commands.rs:616` (`execution_owner` 소비).
- 왕복 증거: 회귀 테스트 `complex-worker-roundtrip.test.ts` (pass,
  `state`/`executionOwner` 포함 변형과 도메인 거부 시 코덱 오류 부재 단언 포함).
  본 감사 인라인 실행: `{state:"running"}` 포함 → `{"accepted":true}`.

### 3.2 `recordWorkerResult` — ✅ 안전 (패치 후 정상 왕복, 라이브 경로)

- 호출부: `packages/orchestrator/src/task-execution.ts:190,271` (성공/실패 결과 기록).
- 계약 타입: `packages/orchestrator/src/control.ts:27`.
- Rust 핸들러: `crates/loop-bridge/src/commands.rs:663`.
- 왕복 증거: 회귀 테스트 pass (`summary` 문자열 + 도메인 거부 변형).
  본 감사 인라인 실행: stop 후 소유권 상실 도메인 거부
  (`projection error: worker did not own the task`) — 응답이 코덱 수준이 아닌
  도메인 수준에서 정상 디코드·전파됨을 확인.

### 3.3 `recordWorkerStopped` — ✅ 안전 (와이어 동형, 라이브 경로)

- 호출부: `packages/orchestrator/src/task-execution.ts:95,148,167,265`
  (abort/종료/예외 경로). 계약 타입: `control.ts:17`.
- `recordWorkerStarted`와 동일 `WorkerInput` → `OperationOutput` 와이어 형태
  (frame-codecs.ts:5184 vs :5173 — 같은 input/output schema, commandId만 16).
- Rust 핸들러: `crates/loop-bridge/src/commands.rs:959`; 직접 테스트
  `crates/loop-bridge/tests/commands-direct.rs:361`.
- 왕복 증거(본 감사 인라인, 엔진 경로): `{state:"cancelled"}` 포함 →
  `{"accepted":true}`.

### 3.4 `evaluateFailurePolicy` — ✅ 안전 (노출됨, TS 호출자 없음)

- Rust 핸들러: `crates/loop-bridge/src/commands.rs:1336`; 등록
  `commands.rs:1745` (additive 노출 — 기존 commandId 안정성 유지 주석).
- Rust 유닛 테스트: `commands.rs:1938`.
- **TS 호출자 없음**: 저장소 전체 grep에서 `src/generated`·테스트 외 호출 0건.
  즉 디스패처 스톨 경로에는 없지만, 향후 호출 시 응답의 nullable 필드 5개가
  버그 2 패치(응답 디코드 방향)에 의존한다.
- 왕복 증거(본 감사 인라인, 엔진 경로): retry budget 존재 입력 →
  `{"action":"retry","retryScope":"worker","delayMs":10}` —
  설정된 nullable 필드와 미설정(`dependents`/`run` 등) nullable 필드가
  혼재한 응답이 오류 없이 디코드됨.

### 3.5 `evaluateCleanupDisposition` — ✅ 안전 (노출됨, TS 호출자 없음)

- Rust 핸들러: `crates/loop-bridge/src/commands.rs:1327`; 등록 `commands.rs:1746`;
  유닛 테스트 `commands.rs:1927`.
- TS 호출자 없음(3.4와 동일 grep 근거). 응답은 required 단일 enum이라
  가장 단순한 complex 와이어.
- 왕복 증거(본 감사 인라인, 엔진 경로): `worktree_dirty` →
  `{"disposition":"require_decision"}`, `external_session` →
  `{"disposition":"skip"}` — `oneOf` 변형 2종 정상 디코드.

## 4. 검증 이력 (본 감사에서 실행)

| 검사 | 결과 |
|------|------|
| `bun test packages/protocol/test/complex-worker-roundtrip.test.ts` | 1 pass, 0 fail (9 expects) |
| 인라인 엔진 왕복: `evaluateCleanupDisposition` ×2 변형 | pass |
| 인라인 엔진 왕복: `evaluateFailurePolicy` (nullable 혼재 응답) | pass |
| 인라인 엔진 왕복: `recordWorkerStarted`/`recordWorkerStopped`/`recordWorkerResult` (optional `state` 포함) | pass (result는 도메인 소유권 거부 = 기대 동작) |

## 5. 결론 및 후속 권고

**결론**: `createComplexCodec` 명령은 위 5개가 전부이며, 패치 적용 후 모두
엔진 디스패치 경로에서 정상 왕복한다. 디스패처가 실제 호출하는 3개
(`recordWorkerStarted`/`recordWorkerResult`/`recordWorkerStopped`)는 회귀
테스트 또는 인라인 왕복으로, 노출만 된 2개(`evaluateFailurePolicy`/
`evaluateCleanupDisposition`)는 인라인 왕복과 Rust 유닛 테스트로 안전이
확인됐다. 동일 와이어 취약으로 인한 잔여 스톨 후보는 없다.

후속 권고 (우선순위 순):

1. **디스패처 견고화** — `coordinator.ts:307`의 `recordWorkerStarted` 실패는
   여전히 런을 워커 0 `running` 상태로 남긴다(attention만 요청). 코덱 오류와
   도메인 오류를 구분해 코덱/전송 계열 실패는 재시도 또는 런 fail-fast로
   전환하는 방어 계층 권장. (별도 과제 필요 — 이번 감사 범위 외)
2. **회귀 테스트 확장** — `complex-worker-roundtrip.test.ts`에
   `recordWorkerStopped`와(선택적으로) `evaluateFailurePolicy` 왕복을
   추가해 5개 명령 모두 CI에서 상시 검증. 현재 stopped는 인라인 확인만 존재.
3. **패치 핀 관리** — `@rustra/types`를 0.12.1 등으로 올리면 patchfile
   (`patches/@rustra%2Ftypes@0.12.0.patch`)이 미적용되어 두 버그가 재발한다.
   업그레이드 시 패치 이식 또는 업스트림 수정 확인을 체크리스트화 권장.
4. **미사용 노출 명령** — `evaluateFailurePolicy`/`evaluateCleanupDisposition`은
   TS 호출자가 없다. 사용 계획이 없다면 노출 제거(또는 계획 문서화)로 와이어
   면적 축소 가능.
