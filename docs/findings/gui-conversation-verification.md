# GUI 대화 경험 최종 검증 — findings

- **태스크:** `gui-final-verification` (kind=verification, 후속 — 최종)
- **일자:** 2026-09-26
- **검증자:** 워커 (운영자 세션, `/Users/loopy/dev/ll3/loop`)
- **유료 호출:** 이 검증 태스크에서 **0회**
- **선행 조건 확인:** 운영자가 네이티브 브릿지 재빌드 완료 — `dist/loop`(03:12:25), `dist/libloop_bridge.dylib`(03:12:22), `dist/loop-pi-extension.js`(03:12:25)가 모든 Rust 소스 최신 변경(`crates/loop-bridge/src/lib.rs` 01:36:02)보다 최신. 게이트웨이 세션 테스트 로컬 재확인 통과(아래).

## 수용 기준별 판정

| # | 기준 | 판정 | 근거 |
| --- | --- | --- | --- |
| 1 | 대화 이벤트 흐름 pi → 게이트웨이 SSE → GUI 렌더링 (툴 카드) | **pass (테스트 수준)** | `session-stream.test.ts` + `session-collector.test.ts` 24 pass, `conversation-contract.test.ts` 포함 46 pass. 상세는 아래 |
| 1a | 실행 중 steer가 다음 턴에 반영 | **pass (테스트 수준) / 라이브 시연 미달(문서화됨)** | `steer-delivery.test.ts`/`mailbox.test.ts` — mid-run guidance가 실행 중 steer 가능 워커에 도달·정확 1회 전달. 라이브 시연은 v4에서 `502 steer_unavailable`로 미달 — `v4/evidence.md`에 정직하게 기록 완료. 유료 호출 금지 하에서 라이브 재시연은 불가하므로 별도 운영자 승인 과제로 남음 |
| 2a | 생성 타입만 사용 (대화 이벤트 TS 사본 없음) | **pass** | `apps/loop-mobile/src/gateway/conversation.ts`는 `RustraEventPayloads`(`@loop/protocol`)만 import, 로컬 payload 정의 0 |
| 2b | loop-core에 provider/pane 개념 없음 | **pass** | 소스 grep 결과 유일 언급은 `reducer.rs:72`의 부정형 문서 주석("no adapter, pane, or viewer"); `tests/architecture-boundaries.test.ts` 6 pass(0 fail)로 경계 강제 |
| 2c | codegen:check 클린 | **pass** | 단독 재실행 exit 0 (재생성 결과 무차이) |
| 2d | `[credential]=[redacted]` 불변 | **pass** | `herdr-redaction.test.ts` 3 pass, 게이트웨이 스트림 테스트 "credential-bearing pane text leaves as [credential]=[redacted]" pass |
| 3 | v4 스크린샷이 Codex 앱 유사 GUI를 보여줌 | **pass (메타데이터·증거 문서 수준)** | `v4/01~04` PNG 존재, 전부 1206×2622(타임스탬프 03:01–03:02), `evidence.md` 단계별 기술(채팅 목록 → 대기 → 라이브: 접힌 `read`/`bash` 카드 `done`, 어시스턴트 최종 텍스트). **한계:** 검증 워커 모델은 이미지 관찰 불가 — 픽셀 육안 최종 판정은 운영자 몫. v4 캡처(03:01)는 최신 네이티브 재빌드(03:12) 이전 촬영이나, 대화 스트림은 게이트웨이 SSE 경유라 네이티브 브리지 스탬프와 무관 |
| 4 | `bun run check` | **pass** | exit 0 — codegen:check + typecheck + architecture(6 pass) + cargo test/build + bun 508 pass / 0 fail (62 files, 2297 expect) |
| 5 | `cargo test --workspace` | **pass** | 단독 재실행 exit 0, 25개 스위트 전부 `0 failed` |

## 명령 증거

```text
$ bun run check                                  # exit 0
#   codegen:check → 재생성 무차이
#   tsc -p tsconfig.json → 클린 (TYPECHECK_OK)
#   bun test tests/architecture-boundaries.test.ts → 6 pass, 0 fail
#   cargo test --workspace && cargo build -p loop-bridge → ok
#   bun test packages tests plugins scripts/… → 508 pass, 0 fail, 62 files

$ cargo test --workspace                         # 단독 재실행 → exit 0
#   "test result: ok" 25개, 전부 "0 failed"

$ bun test packages/gateway/test/session-stream.test.ts \
           packages/gateway/test/session-collector.test.ts
#   24 pass, 0 fail — user_message → 툴 카드(started/ended) → delta 병합/최종,
#   steer_queued 정확 1회 미러(리플레이 포함) → source=steer user_message, 순서 보존

$ bun test packages/orchestrator/test/steer-delivery.test.ts \
           packages/orchestrator/test/mailbox.test.ts \
           apps/loop-mobile/test/conversation-contract.test.ts \
           packages/providers/test/herdr-redaction.test.ts
#   46 pass, 0 fail — mid-run guidance → run mailbox → 워커 steer 콜백 1회 수신;
#   GUI 계약: 툴 카드(done/error), steer 마커 fold, source=steer 도착 시 마커 전이

$ bun run codegen:check                          # exit 0
```

## 네이티브 재빌드 pitfall — 3번째 반복 결함 문서화

**규칙(이후 필수):** Rust 변경(`loop-core`/`loop-store`/`loop-bridge` 및 이를 참조하는 generated protocol)이 있으면, 브리지를 로드하는 **어떤 `bun test`라도 실행하기 전에** `bun run codegen && bun run build:cli`를 먼저 실행한다. `dist/`의 dylib·CLI·pi 확장은 타임스탬프 기반 캐시가 아니라 수동 산출물이므로, 재빌드 없이는 소스와 번들이 어긋난 상태로 테스트·시연이 "통과"할 수 있다(위장 양성).

**재발 이력:** 이 결함으로 검증 반복이 3회 지연됨 — (1) 최초 GUI 검증에서 시뮬레이터가 구형 브리지 로드, (2) 후속에서도 dist 미갱신으로 게이트웨이 로컬 재확인 실패, (3) 이번 후속에서 운영자 재빌드로 해소. 근본 원리는 동일: Rust 소스 mtime > dist 산출물 mtime인 상태에서 브리지 의존 테스트 실행.

**개선 제안 (우선순위 순):**

1. **스탬프 가드 스크립트 (저비용, 권장).** `scripts/native-fresh.ts` 추가: `crates/**/*.{rs,toml}` 중 최신 mtime과 `dist/libloop_bridge.dylib`·`dist/loop` mtime을 비교해, Rust가 더 새로우면 exit 1 + `"run: bun run codegen && bun run build:cli"` 안내. `bun run check`와 `test` 스크립트의 첫 단계로 삽입. 구현 10줄 남짓, 실패 시 원인이 즉시 드러남.
2. **pretest 자동 재빌드 (편의, CI 시간 증가).** package.json에 `"pretest": "bun run codegen && bun run native-fresh || bun run build:cli"` 형태로 자동화. 개발 루프가 느려질 수 있어 cargo fingerprint 변화 감지(`cargo build -p loop-bridge --quiet`가 이미 증분)와 함께 사용.
3. **codegen 훅 연계.** `scripts/rustra-codegen.ts`가 타입 재생성을 수행했음을 감지하면(무차이가 아닌 경우) 종료 전 `build:cli` 실행 또는 리마인더 출력 — "타입 바뀌었으면 브리지도 다시"를 한 지점에서 강제.

최소 수정은 1번: `check`가 이미 `codegen:check`로 타입 일치는 보장하므로, 남는 구멍은 정확히 "dist 네이티브 산출물 vs Rust 소스" 하나이고 이를 mtime 가드로 막으면 된다.

## 미달 및 위험 (잔여)

1. **steer 라이브 시연 부재 (기준 1a의 라이브 축).** 원인은 데모 환경 steer port 502와 standalone pi 세션의 run 상관 부재. 필요 조건: run에 매핑된 워커 세션, 작동하는 steer bridge, pi mailbox 주입, 확장의 `source=steer` 분류. 유료 호출 승인 하 별도 재시연 과제. **테스트 수준 흐름(게이트웨이 미러 → mailbox → 워커 콜백 → GUI 마커 전이)은 전부 통과.**
2. **`apps/loop-mobile/src/gateway/wire.ts` 임시 시접.** 대화 이벤트 계열은 생성 타입만 쓰지만, 이 파일이 v3 이전 run/pane 읽기 측 사본을 문서화된 임시 시접으로 유지. 후속 정리 대상.
3. **스크린샷 픽셀 육안 판정.** 검증 워커가 이미지 관찰 불가 — "Codex 앱 유사" 최종 판정은 운영자 확인 권장.
4. **iOS 상태바와 제목 겹침.** `v4/evidence.md` 기록의 화면 다듬기 잔여 과제.

## 결론

코드베이스·체크 축의 수용 기준은 **전부 통과**: 경계 위반 없음, 생성 타입 단일 진실원, codegen/typecheck/architecture/cargo workspace/bun 전체 클린, 네이티브 dist가 Rust 소스 대비 최신임 확인, credential redaction 불변. 유일하게 열려 있는 축은 **steer 라이브 시연**(유료 호출 승인 필요, 이미 v4에 미달로 기록)이며, 나머지는 문서화된 잔여 정리(wire.ts 시접, 상태바 겹침)다. 네이티브 재빌드 pitfall은 위 규칙과 1번 가드 스크립트 제안으로 문서화 완료 — 동일 결함의 4번째 반복을 이 가드가 차단해야 한다.
