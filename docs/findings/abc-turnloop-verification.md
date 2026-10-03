# a/b/c 후속 최종 검증 (abc-final-verification)

- **Date:** 2026-09-26
- **Kind:** verification (`abc-final-verification`)
- **Scope read:** `AGENTS.md`, `apps/**`, `crates/**`, `docs/**`, `packages/**`
- **Write:** `docs/findings/abc-turnloop-verification.md` (이 문서)
- **검증 중 유료 모델 호출: 0** — 이 태스크는 결정론적 검증만 수행했다. 유료 호출은 (a) 태스크(`m-tl4-real-measurement`)에서 이미 소진·기록됨.

## 결과 요약

| # | 인수 기준 | 결과 |
|---|---|---|
| a | 실측 문서가 실측치를 담고 단위 증거와 분리됨 | **PASS** |
| b | 게이트웨이 프로파일 선택 + 앱 표시, 이벤트 계약 동일성 | **FAIL** — 미구현 (§3) |
| c | 시뮬레이터 쇼케이스 스크린샷 + 재현 가능한 플로우 문서 | **PASS** (단, 프로파일 배지는 (b) 미완으로 미연동 — §4 각주) |
| 4 | `bun run check` 전체 통과 | **PASS** |
| 5 | 경계 — 아키텍처 테스트, codegen:check, loop-core provider 개념 금지 | **PASS** |

**종합: PASS 아님 — (b)만 미완료. (a), (c)와 저장소 전체 건전성은 모두 녹색.**

## 1. (a) M-TL4 실측 문서 — PASS

**증거:** `docs/research/turnloop-measurement.md` (git 상태: untracked — 커밋된 단위 테스트 계약과 별도 파일)

- 실측치 존재: 유료 요청 3회(TL-1/TL-2 turnloop, PI-1 pi lane)에 대해 turns, tool calls, 모델 요청 수, input/output/reasoning 토큰, wall time(ms), provider 보고 cost(합계 ≈ $0.000175)가 표로 기록됨. 호출 수 상한(1~2회 소형 프롬프트) 준수를 문서가 스스로 공시(§0).
- 증거 분리: 문서 서두에 "**real-provider 전용 증거**… 단위·마일스톤 테스트는 계속 `FakeModelClient`/`FakeProvider`만 사용하며 어떤 테스트도 이 실측에 의존하지 않는다"고 명시. 실측 드라이버는 리포 밖(`/tmp/m-tl4/`) 스크래치로, 리포 코드 변경 0건. credential 비기록 확인 문구 포함.
- 리포 안의 단위/마일스톤 증거는 결정론적 경로로 별도 유지됨 — §5의 `bun run check`/`cargo test` 결과가 그 증거 (유료 호출 불요 확인).

## 2. (b) 게이트웨이·앱 turnloop 프로파일 연동 — FAIL (미구현)

의도는 "게이트웨이가 제출된 run의 worker 프로파일(pi 기본 vs turnloop)을 설정/요청으로 선택 + 앱(clients)이 표시/선택 가능한 계약 확장"이지만, 현재 작업 트리에는 그 확장이 없다.

```text
$ rg -ni "profile|lane" packages/gateway/src
  (0건 — auth/config/cursor/events/index/main/problem/projection/server/service/stream/tailscale/wire 모두 무관)

$ rg -n "turnloop|lane|profile" apps/loop-mobile/src
  (0건)

$ rg -n "workerProfile|profile" packages/protocol/src/generated/types.ts
  (0건 — wire 계약에 프로파일 필드 없음)
```

- 이 작업 트리의 미커밋 변경은 M-TL2 steer 인도(`GuidanceDelivered` 이벤트·`record_guidance_delivered` 커맨드)이며 프로파일 계약과 무관.
- 존재하는 것은 **오케스트레이터 수준의 lane 지원(M-TL3)**뿐이다: `packages/orchestrator/src/config.ts`의 `WorkerLane = "pi" | "turnloop"`, `composition.ts`의 `turnloopWorker` 바인딩과 `config.turnloop_lane_unavailable` 패스트 fail. 즉 `config/models.toml`의 프로파일이 lane을 선택할 수 있으나, **게이트웨이 요청으로 프로파일을 고르는 경로와 wire 표시는 없다.**
- 이벤트 계약 동일성: 확장 자체가 없어 wire 이벤트 계약은 기존과 동일(변경 자체가 부재 — 기준 자체가 미충족).
- `docs/research/simulator-showcase/README.md` §1·§5.1도 의존 태스크 `gateway-turnloop-integration` 미착수와 프로파일 배지 재시연 필요를 기록 — 이 검증과 정합.

**필요한 후속:** (1) 게이트웨이 제출 계약(또는 설정)에 worker 프로파일 선택 필드 추가, (2) orchestrator로의 전달, (3) protocol generated 계약 확장(Rust bridge 타입 우선 변경 후 `bun run codegen`), (4) 앱 렌더링 + 쇼케이스 재실행.

## 3. (c) iOS 시뮬레이터 쇼케이스 — PASS

**증거:** `docs/research/simulator-showcase/`

```text
$ ls -la docs/research/simulator-showcase/
  01-connect-screen.png  98095 bytes  PNG 1206x2622
  02-submit-screen.png   90950 bytes  PNG 1206x2622
  03-live-status.png     82788 bytes  PNG 1206x2622
  04-live-output.png     82788 bytes  PNG 1206x2622
  README.md              8639 bytes
  evidence.md            3498 bytes
```

- 플로우 문서(`README.md`)가 6단계(부팅 → 빌드/설치/기동 → Connect → 제출 202 + runId → SSE 실시간 상태 → 출력 렌더링)를 운영자 재실행 가능한 명령으로 기술: `xcrun simctl boot`, `scripts/build-ios-simulator.sh`, bearer 발급(메모리 전용), launch env 훅, `simctl io screenshot`, 서버 측 curl 검증. 실기기 설치 없음, 유료 호출 없음(stub planner) — 운영자 지시 준수.
- 서버 측 대응 증거(`evidence.md`): run `run_c7a84585-…` 생성, SSE `event: status` 프레임 수신 기록.
- 자동/수동 경계의 정직한 구분(§2): launch env는 사람 탭과 동일한 앱 버튼 핸들러를 실행 — 코드 경로 동일성 명시.
- 각주: run 화면의 worker 프로파일 표시는 (b) 미완으로 미연동. 쇼케이스 자체의 인수 기준(스크린샷 + 재현 가능한 단계)은 충족하므로 PASS로 판정하되, (b) 착수 시 재시연이 문서에 예약돼 있다.
- 관찰 1건: `03-live-status.png`와 `04-live-output.png`가 동일 바이트 수(82788) — 안정 상태 재캡처가 동일 프레임. 시연 유효성에는 영향 없음.

## 4. 전체 검증 — PASS

```text
$ bun run check        # = codegen:check && typecheck && test:architecture && test
  [rustra] ✓ … done in 0.1s → CODEGEN_CLEAN (generated files up to date)
  architecture: 6 pass / 0 fail (166 expect calls)
  cargo test --workspace: 모든 "test result: ok." — 0 failed
  bun test: 463 pass / 0 fail / 1966 expect() calls (55 files)

$ bun run codegen:check → 정리 완료 (exit 0)
$ bun run test:architecture → 6 pass / 0 fail
$ cargo test --workspace → 전부 ok (요약: 0 failed, ignored 소수)
```

### 경계 확인

- **아키텍처 테스트 녹색:** `tests/architecture-boundaries.test.ts` 6/6 — loop-core provider-neutral export 목록, TS→Rust seam 단일성(pro generated binding), provider/Pi/SQLite 역전 금지, 설정-비즈니스 로직 분리 포함.
- **codegen:check 클린:** 생성된 `packages/protocol/src/generated/**`가 Rust bridge 타입과 일치.
- **loop-core provider 개념 금지:** `rg -ni "provider|endpoint|\bpi\b|herdr" crates/loop-core/src`의 유일 적중은 `run/worker.rs:13`의 doc comment가 `packages/providers/src/types.ts`라는 타입 이름을 **참조**하는 문장 — `\bprovider\b` 단어 경계 매치가 아닌 복수형 타입 경로 언급이며, 아키텍처 테스트가 녹색이므로 경계 위반 아님. loop-core는 provider·Pi·Herdr·endpoint 개념을 import하지 않음.

## 5. 변경 파일

- `docs/findings/abc-turnloop-verification.md` (신규, 이 문서) — 쓰기 범위 내 유일 변경. 리포 코드 변경 없음.

## 6. 미해결 리스크 / 후속

1. **(b) 미구현이 이번 패키지의 유일한 미충족 기준.** 게이트웨이 제출·설정 계약의 프로파일 선택은 protocol(bridge 타입 → codegen) → orchestrator → gateway → presentation → 앱 순의 경계 존중 확장이 필요하며, 완료 후 `simulator-showcase` 재시연(프로파일 배지 포함)이 예약돼 있음.
2. (a) 문서 스스로 공시한 한계: 실공급자 tool round-trip 미측정, 샘플 n=1 — 다음 운영자 승인 구간 과제로 유지.
3. `app-device-install.md` 문서 드리프트(기본 호스트명 불일치) — 이 태스크 쓰기 범위 밖, 운영자 갱신 필요(쇼케이스 README §5.2 참조).
