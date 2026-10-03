# Loop 원격 앱 이전 실행 산출물 복구 인벤토리

- **Task:** `artifact-recovery`
- **이전 실행:** `loop-627ee7a0` (`failed`)
- **판정 기준:** 확정 스택(React Native 모바일, Tauri 데스크톱, Rustra Rust 브릿지/codegen), `AGENTS.md` 계층 경계, 현재 worktree의 파일 내용
- **결론:** 표면 조사 문서는 재사용 가능하고 wire contract의 대부분은 보존할 수 있다. 그러나 기존 아키텍처 결정과 `apps/loop-app`은 확정 스택과 충돌하므로 각각 대폭 개정/교체해야 한다. gateway와 원격 앱용 Rust 브릿지 타입/codegen 산출물은 없다.

## 1. 출처와 귀속 한계

현재 worktree에서 `loop-627ee7a0` 문자열 자체는 scoped 파일에 남아 있지 않다. 아래 귀속은 서로 연속된 수정 시각, 문서의 task 표식, 동일한 `/v1` 계약을 사용하는 앱 fixture를 근거로 한다.

- `docs/research/app-remote-access-surface.md:3`은 task를 `surface-research`로 기록한다.
- `docs/decisions/2026-xx-remote-app-architecture.md:4`는 task를 `stack-transport-decision`으로 기록하고 위 조사 문서를 선행 근거로 링크한다.
- `apps/loop-app/README.md`와 `apps/loop-app/src/lib.rs`는 결정 문서의 `/v1` HTTP/SSE 계약을 그대로 참조/구현한다.
- 세 산출물은 모두 git에서 untracked 상태이며 수정 시각이 `2026-09-25 12:48`~`12:58 +0900`으로 이어진다.

따라서 이들을 이전 실행의 잔존 산출물로 보는 것이 가장 타당하지만, run manifest가 없으므로 절대적인 provenance는 확인할 수 없다.

## 2. 존재하며 재사용 가능한 산출물

| 산출물 | 경로 증거 | 상태 | 확정 스택 적합성 및 조치 |
| --- | --- | --- | --- |
| 현재 접근 표면 조사 | `docs/research/app-remote-access-surface.md` | **재사용 가능, 소폭 개정** | `LoopRuntime`, generated protocol, snapshot/activity, Herdr/Pi 경계와 HTTP/Tailscale/auth gap을 소스 경로별로 기록했다. 이 내용은 UI shell 선택과 독립적이며 RN/Tauri/Rustra 구조에도 유효하다. 결론의 “Rust-native app” 전제는 없지만, 후속 문서에서 모바일=RN·데스크톱=Tauri를 명시하고 앱이 gateway DTO만 소비하도록 보완해야 한다. |
| v1 HTTP/SSE wire contract | `docs/decisions/2026-xx-remote-app-architecture.md:91-413` | **부분 재사용 가능** | `/v1/runs`, run 조회/목록, SSE `status/output/reset/terminal`, cursor/replay, RFC 9457형 오류, Tailscale fail-closed bind, credential 비저장 규칙은 RN/Tauri와 독립적이다. wire payload를 Rust `loop-bridge`에서 먼저 소유하고 Rustra로 생성한다는 D3도 확정 스택과 맞는다. 다만 같은 문서의 앱 결정과 결론이 충돌하므로 현 상태 그대로는 승인된 ADR로 사용할 수 없다. |
| 기존 Rustra bridge/codegen 기반 | `crates/loop-bridge/Cargo.toml:14`, `crates/loop-bridge/src/lib.rs`, `crates/loop-bridge/src/bin/generate.rs`, `packages/protocol/src/generated/.rustra-generated.json`, `packages/protocol/src/generated/*` | **기반만 재사용 가능** | Rustra package와 generated TS protocol 파이프라인은 이미 존재하므로 새 remote contract의 생성 기반으로 재사용한다. 그러나 `SubmitPrompt`, `RemoteRun`, `RemoteRunEvent`, `TaskCounts` 등 원격 계약 symbol은 `crates/loop-bridge`와 `packages/protocol` 어디에도 없다. 즉 이전 실행이 만든 원격 bridge/codegen 산출물은 아니다. |
| 계약 예제 fixture | `apps/loop-app/test/fixtures/accepted.json` | **예제로만 재사용 가능** | `202 Accepted`의 `RemoteRunSummary` 예제로 wire contract와 일치한다. 향후 generated DTO/gateway/app smoke fixture로 이동 또는 재사용할 수 있다. RN/Tauri 구현 자체는 아니다. |

## 3. 존재하지만 깨졌거나 교체해야 하는 산출물

| 산출물 | 경로 증거 | 문제 | 판정 |
| --- | --- | --- | --- |
| 아키텍처 결정의 앱 shell | `docs/decisions/2026-xx-remote-app-architecture.md:25-47`, `:50-76`, `:415-435` | D1은 “Rust-native + loopy-lim”을 채택하고 RN과 Tauri를 기각한다. 새로 확정된 **RN 모바일 + Tauri 데스크톱 + Rustra 공유 프로토콜**과 정면 충돌한다. diagram도 `Rust-native app` 단일 shell을 전제로 한다. | **대폭 개정 필요.** wire contract와 gateway 경계는 보존하되 D1, 대안 표의 채택/기각, 앱 독립 구현 계약, 위험/요약을 새 스택 기준으로 다시 결정해야 한다. 작은 정정만으로는 ADR의 결정 의미가 뒤집히므로 사실상 decision section rewrite가 안전하다. |
| `loop-app` 네이티브 Rust CLI scaffold | `apps/loop-app/Cargo.toml`, `apps/loop-app/src/main.rs`, `apps/loop-app/src/lib.rs`, `apps/loop-app/README.md` | React Native도 Tauri도 아닌 터미널용 순수 Rust binary다. `Cargo.toml`에는 `tauri`가 없고 scoped manifests 전체에 `react-native`, `expo`, `@tauri-apps/*`, `tauri` 의존성이 없다. `src/lib.rs`가 `RunStatus`, `RunSummary`, `RemoteRun` 등을 손으로 정의하여 Rustra-generated 공유 타입 요구와 맞지 않는다. README도 이를 임시 로컬 DTO라고 명시한다. SSE Authorization 작성은 `"Authorization: Bearer {token}\\r\\n"`으로 literal backslash를 보내는 결함이 있어 인증 gateway와 호환되지 않는다. | **앱 scaffold로는 폐기/교체.** HTTP validation 아이디어와 accepted fixture만 참고하고 RN/Tauri scaffold를 별도 앱 경계로 만든다. 이 코드를 공통 domain/client로 승격하면 수작업 타입 중복과 UI shell 경계 혼합이 고착된다. |
| `loop-app` 테스트 | `apps/loop-app/src/lib.rs:tests`, `apps/loop-app/test/client.test.ts` | `cargo test --manifest-path apps/loop-app/Cargo.toml`은 3개 테스트가 통과하지만 fixture decode, 빈 prompt, HTTPS fail-closed만 검사한다. 실제 HTTP/SSE gateway smoke, Authorization header, reconnect, RN, Tauri를 검증하지 않는다. | **제한적 참고만 가능.** 통과 사실은 현재 scaffold의 스택 적합성이나 end-to-end 사용 가능성을 입증하지 않는다. |

## 4. 누락된 산출물

| 요구 산출물 | 확인 결과 | 파일 경로 증거 | 조치 |
| --- | --- | --- | --- |
| Loop HTTP gateway | **누락** | `packages/gateway`가 존재하지 않으며 scoped manifest 목록에도 gateway package가 없다. | adapter 계층에 새 package로 작성한다. HTTP/SSE framing, Tailscale 주소 검사, auth/credential redaction만 소유하고 orchestrator를 주입받아야 한다. |
| 원격 wire용 Rust 타입 | **누락** | `crates/loop-bridge`에서 `SubmitPrompt|RemoteRun|RunStatus|TaskCounts|activityId|clientContext` 검색 결과가 없다. | `loop-bridge`에 transport-neutral payload/projection을 먼저 정의한다. HTTP route/header, Tailscale, Pi, Herdr 이름은 타입에 넣지 않는다. |
| 원격 wire codegen 결과 | **누락** | `packages/protocol/src/generated/*`에도 위 원격 contract symbol이 없다. 현재 `.rustra-generated.json`은 기존 schema hash `16a9d8d...`만 기록한다. `git diff -- crates/loop-bridge packages/protocol`도 비어 있다. | Rust 타입 추가 후 `bun run codegen`을 실행하고 생성물을 함께 커밋한다. |
| React Native 모바일 앱 | **누락** | `apps` 아래 실질 앱 디렉터리는 `apps/loop-app` 하나뿐이고 RN/Expo manifest 의존성이 없다. | RN scaffold를 새로 작성하고 generated/shared gateway protocol을 소비하는 thin UI/client로 유지한다. |
| Tauri 데스크톱 앱 | **누락** | `apps/loop-app`에 `src-tauri`, `tauri.conf.*`, `tauri`/`@tauri-apps/*` 의존성이 없다. | Tauri scaffold를 새로 작성한다. desktop shell이 gateway나 Loop domain 정책을 소유하지 않게 한다. |
| gateway-app smoke | **누락** | 존재하는 `apps/loop-app/test/client.test.ts`는 로컬 `cargo test` wrapper이며 gateway process/fake runtime과 통신하지 않는다. | 유료 모델 호출 없이 fake planner/runtime으로 submit→status/output→terminal을 검증한다. |

## 5. 복구 결정

### 채택안: 조사와 wire contract는 보존하고, stack-specific shell은 교체

1. `docs/research/app-remote-access-surface.md`는 사실 조사로 재사용하고 확정 스택을 짧게 보완한다.
2. `docs/decisions/2026-xx-remote-app-architecture.md`는 HTTP/SSE·오류·Tailscale·credential 규칙을 보존하되, D1과 앱 경계를 RN/Tauri/Rustra 기준으로 다시 쓴다.
3. `apps/loop-app`의 hand-written DTO/CLI를 정식 앱 기반으로 발전시키지 않는다. accepted fixture 등 transport 예제만 선별 재사용한다.
4. 구현 순서는 `loop-bridge` Rust payload → `bun run codegen` → thin gateway → RN/Tauri clients다. 이 순서가 `loop-core → loop-store → loop-bridge → generated protocol → orchestrator → adapters/UI` 방향을 보존한다.

### 기각안: 기존 Rust CLI를 공통 앱 코어로 확장

코드 일부를 빠르게 재사용할 수 있지만 RN과 Tauri 양쪽에 별도 FFI/바인딩을 만들고, 이미 손으로 복사된 DTO를 또 유지해야 한다. 새로 확정된 shell과 Rustra 공유 계층을 우회하므로 장기 경계 비용이 더 크다.

### 기각안: 이전 산출물을 전부 삭제하고 처음부터 재작성

스택 충돌은 제거되지만 검증 가능한 surface 조사와 상세 wire semantics까지 잃는다. transport 계약은 shell과 독립적이므로 전면 폐기보다 선택적 보존이 더 작고 안전하다.

## 6. 실행한 확인

- scoped 경로 `find`, `rg`, manifest 검색으로 파일/프레임워크/remote symbol 존재 여부 확인
- `git status --short -- apps crates docs/decisions docs/research packages/gateway packages/protocol`
- `git diff -- crates/loop-bridge packages/protocol` — remote bridge/codegen 변경 없음
- `cargo test --manifest-path apps/loop-app/Cargo.toml` — 3 passed, 0 failed
- 완료 조건: `test -s docs/research/app-remote-access-recovery.md`

## 7. 미해결 위험

- 이전 run ID를 파일과 직접 연결하는 manifest가 없어 산출물 귀속은 정황 증거 기반이다.
- RN과 Tauri가 하나의 generated wire artifact를 어떤 언어 경계로 소비할지(codegen TS를 공통 사용할지, Tauri Rust command layer도 schema를 직접 사용할지)는 후속 아키텍처 개정에서 고정해야 한다.
- 기존 ADR의 SSE/JWT 세부 계약은 구현 전 contract test로 검증해야 하며, 현재 문서 존재만으로 구현 가능성이 입증되지는 않는다.
