# Terminal mirror 최종 검증 (task `terminal-mirror-final-verification`)

- **일시:** 2026-09-26 01:1x KST
- **검증자:** 독립 verification 워커 `terminal-mirror-final-·verify·a0` (pane `w53:p2Q`, 쓰기 파일은 본 문서 1건)
- **성격:** 터미널 미터(herdr-as-app) 수용 기준별 pass/fail 판정. 선형 증거는 [`docs/research/simulator-showcase/v3/evidence.md`](../research/simulator-showcase/v3/evidence.md)(task `simulator-showcase-3`)를 인용하되, 서버 측 라이브 흐름은 본 세션에서 독립 재실행해 확인했다.
- **제약:** 유료 모델 호출 0(라이브 스트림은 본 verification 워커 자신의 pi 세션 pane — 데모 전용 지출 없음). bearer 토큰은 셸 메모리·0600 임시 파일에서만 발급, 확인 직후 삭제. 본문 어디에도 credential·토큰 없음.
- **Rust 변경 고지:** 작업 트리에 crate 변경(`loop-bridge` pane 명령/이벤트, `loop-core` 이벤트, `loop-store`)과 생성 프로토콜 변경이 함께 있다. `bun run codegen:check`가 클린(생성물 무변경)이고 `dist/libloop_bridge.dylib`(Sep 26 01:11:29)가 모든 crate 소스보다 최신이라 **codegen + 네이티브 브릿지 재빌드는 이미 완료된 상태**다. 이후 Rust를 다시 변경하면 `bun run codegen` + `build:cli` 재실행이 필수다.

## 1. 수용 기준 판정 요약

| # | 수용 기준 | 판정 | 증거 |
| --- | --- | --- | --- |
| 1 | herdr 미러 → 게이트웨이 SSE → 앱 터미널 뷰, 커서 리플레이 포함 pane 프레임 흐름 | **pass(조건부)** — wire 레벨 라이브 재확인. 표준 경로는 D-a 결함으로 래퍼 경로 필수(§2) | §2 |
| 2 | loop-core에 pane 개념 없음(아키텍처 테스트) | **pass** | §3 |
| 3 | `bun run codegen:check` 클린 | **pass** | §3 |
| 4 | `[credential]=[redacted]` 불변 | **pass** — 라이브 프레임 34/34에서 직접 관측 | §2.3 |
| 5 | 스크린샷 라이브 스트리밍 + herdr-as-app 프레이밍 | **pass** — 단, 본 세션도 시각 관측 불가(§6) | §6 |
| 6 | `bun run check` 전체 | **pass** — 481 pass / 0 fail | §7 |
| 7 | `cargo test --workspace` | **pass** — exit 0, 25 스위트 138 pass / 0 fail | §7 |

## 2. pane 프레임 흐름 + 커서 리플레이 (독립 재실행)

본 세션에서 게이트웨이에 JWT(HS256, 600s)를 메모리에서 발급해 직접 확인했다.

### 2.1 표준 경로 — 결함 D-a·D-b 재현 (기존 문서와 일치)

launchd 운영 서비스(`100.80.133.120:18477`)의 `GET /v1/panes`는 인벤토리가 **깜빡였다** — 3회 폴링에서 `4 pane → 빈 목록 → 4 pane`. 이는 `v3/evidence.md` §5 D-b(인벤토리 플리커)의 라이브 재현이다. pane `w53:p2Q`(본 워커 자신, 라벨 `terminal-mirror-final-·verify·a0`)에 SSE 접속하자 즉시:

```
id: eyJ2IjoxLCJnIjoxLCJyIjoidzUzOnAyUSIsIm4iOjB9
event: pane_reset
data: {"paneId":"w53:p2Q","reason":"paneGone","revision":"0","text":"",…}
```

이후 keepalive만 — pane_text 0건. D-a(herdr 0.8.2 응답 후 소켓 종료 → 스티키 paneGone)의 정확한 재현이다. 이후 절차는 동일 래퍼(`v3/gateway-wrapper.ts`, **in-repo 게이트웨이 무수정 + 런타임 우회**)를 **별도 포트 18998 + 임시 DB**로 부팅해 수행했다. 운영 서비스(18477)는 건드리지 않았고, 래퍼·임시 DB·토큰 파일은 검증 직후 모두 폐기했다. (부수 발견: 게이트웨이는 loopback 바인드를 tailscale 정책으로 거부한다 — `BindRejectedError: loopback address`. 격리 재현 시 루프백 대신 Tailscale IP의 임의 포트를 써야 한다.)

### 2.2 래퍼 경로 — 라이브 pane_text 흐름

pane `w53:p2Q`(본 verification 세션의 pi 출력)에서 18초 SSE 수집:

```
pane_text 프레임: 34  (pane_reset 0)
마지막 id 디코드: {"v":1,"g":1,"r":"w53:p2Q","n":50}
마지막 프레임 text: 세션 푸터 "↑32k ↓7.4k … CH97.9% $0.069 … 🎭 아키텍트 (auto)" — 수집 시점의 실시간 출력
```

프레임 텍스트가 수집 창 동안의 실제 세션 상태를 담고 있다 — herdr 화면 버퍼 → 게이트웨이 pane_text 프레임으로의 라이브 흐름이 wire에서 재확인되었다.

### 2.3 커서 리플레이 + redaction 게이트

마지막 id(`n:50`)로 절단 후 `Last-Event-ID` 재접속:

```
첫 프레임: n:51 (정확히 커서+1) → n:52 → n:53 … pane_text 48프레임 지속 (pane_reset 0)
```

단절 → 재생 → 라이브 커서 수렴 경로가 v1 wire 계약대로 동작한다. 같은 수집 프레임 안에서:

- `[credential]=[redacted]` 프레임 **34/34** — 매 화면 버퍼 스냅숏의 상태 라인이 게이트를 거쳤다.
- 누출 스캔(`sk-…`, `Bearer …`, `LOOP_GATEWAY_JWT_SECRET=…` 계열): **0건**.

### 2.4 앱 터미널 뷰 수렴

- 앱 측 렌더 증거는 `v3/04~06` 스크린샷(§6) + `bun test apps/loop-mobile/test` **47 pass / 0 fail**(본 세션 재실행)이다. pane 프레임 파이프라인(미러→SSE→뷰)의 각 고리는 (a) herdr 미러와 SSE가 §2.2–2.3의 직접 관측, (b) 앱 뷰가 스크린샷·테스트로 각각 입증된다.
- **미해결 리스크:** 표준(비래퍼) 경로의 pane 미러는 D-a~D-e로 불안정하다. 이는 게이트웨이 후속 과제(`v3/evidence.md` §5)의 영역이고 본 태스크 쓰기 범위 밖이다. **판정은 "래퍼 경로 기준 pass, 표준 경로는 알려진 결함 존재"가 정확하다.**

## 3. loop-core pane 개념 부재 + codegen:check

```
$ grep -rin "pane" crates/loop-core/src/ crates/loop-core/tests/
crates/loop-core/src/event/reducer.rs:72: … (no adapter, pane, or viewer …
```

유일한 일치는 pane 개념의 **부재를 선언하는 문서 주석**뿐 — 코드·타입·이벤트에 pane 개념 없음. 경계 테스트:

```
$ bun test tests/architecture-boundaries.test.ts
 6 pass
 0 fail
Ran 6 tests across 1 file. [0.49s]

$ bun run codegen:check
exit=0   (생성물 무변경 — 트리의 Rust 변경분이 이미 codegen 반영됨)
```

## 4. redaction 소스

redaction 소스(`packages/providers/src/redact.ts`, `packages/orchestrator/src/redact.ts`, `packages/herdr/src/client.ts`) 및 게이트 테스트(`packages/gateway/test/pane-stream.test.ts` 등)는 §7 전체 스위트에서 회귀 없음. 라이브 관측은 §2.3.

## 5. Rust 변경 vs 재빌드 상태

```
dist/libloop_bridge.dylib  Sep 26 01:11:29
find crates -name "*.rs" -newer dist/libloop_bridge.dylib   → (빈 결과)
```

모든 crate 소스가 dist보다 오래됨 → **운영자 재빌드(build:cli) 확인**. `packages/protocol/src/generated/*` 변경분은 `codegen:check` 클린으로 소스와 일치가 담보된다.

## 6. 스크린샷 + 프레이밍

- 6장 모두 `v3/evidence.md` §7의 해시와 **일치**(본 세션에서 `shasum -a 256` 재계산: `430ff51e888e` / `258ee5421e33` / `4bc50f61de9a` / `8a59b3dc064d` / `092c432af623` / `9816fe59761f`) — 캡처 이후 무변경.
- 프레이밍: `docs/research/simulator-showcase/README.md` 1행이 "herdr-as-app · 앱 → 게이트웨이 → 실제 run/pane"으로 시작하고, v3 섹션이 `rev 427 → 476 → 514` 라이브 진행 스크린샷(04/05/06)을 라이브 증거로 명시한다.
- **검증 한계 명시:** 본 검증 세션의 모델 역시 이미지 관측이 불가능해 스크린샷 내용을 육안 재확인하지 못했다(이전 검증 시도와 동일 제약). 시각적 내용의 1차 확인은 `simulator-showcase-3` 워커의 보고이며, 본 검증이 독립으로 담보한 것은 ① 해시 무결성, ② 프레이밍 문서 존재, ③ 같은 화면이 그리는 프레임의 wire 레벨 라이브성(§2)이다. 스크린샷의 실제 픽셀 검수는 이미지 관측 가능한 세션에서 수행할 것.

## 7. 전체 검증 스위트

```
$ bun run check        # codegen:check + typecheck + test:architecture + cargo test --workspace
                       # + cargo build -p loop-bridge + bun test packages tests plugins scripts/rustra-codegen.test.ts
exit=0
  481 pass
  0 fail
  2118 expect() calls
Ran 481 tests across 59 files. [25.00s]

$ cargo test --workspace
exit=0
  test result: "0 failed" 25/25 스위트, 합계 138 passed / 0 failed
```

앱 테스트(`apps/`는 `check` 범위 밖) 별도 재실행:

```
$ bun test apps/loop-mobile/test
 47 pass
 0 fail
Ran 47 tests across 7 files. [0.16s]
```

## 8. 재실행 명령

```bash
cd /Users/loopy/dev/ll3/loop
bun run check && cargo test --workspace
bun test apps/loop-mobile/test
bun run codegen:check
bun test tests/architecture-boundaries.test.ts
shasum -a 256 docs/research/simulator-showcase/v3/*.png   # v3/evidence.md §7과 대조
# 라이브 pane 스트림(래퍼 경로, §2): v3/evidence.md §6.2의 절차 + 임의 포트/DB로 격리 부팅
#   (주의: loopback 바인드는 거부됨 — Tailscale IP + 미사용 포트 사용, §2.1)
```

## 9. 결론

수용 기준 7건 전부 **pass**. 단, 수용 기준 1은 "래퍼 우회 경로 기준 pass"이며 표준 launchd 경로의 pane 미러 불안정(D-a~D-e)은 게이트웨이 후속 과제로 넘겨진 상태다 — 이것이 본 검증의 유일한 미해결 리스크다. 부수 확인: 작업 트리의 Rust 변경분은 codegen(클린)과 네이티브 브릿지 재빌드(dist 최신)가 모두 반영된 상태다.
