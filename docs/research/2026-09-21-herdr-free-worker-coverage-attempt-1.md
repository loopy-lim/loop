# Herdr-free worker coverage — attempt 1

- kind: `research`; attempt: `1`; date: `2026-09-21` (Asia/Seoul)
- workspace: `/Users/loopy/dev/ll3/loop`; current `HEAD` `39b93a5`; pre-existing working tree state preserved
- dependencies: `AgentProvider`/`ProcessProvider`, provider adapters (`codex`, `antigravity`, `zai`, `fake`), orchestrator, completion verifier, Rust store/core recovery, Pi extension
- read scope: `packages/providers`, `packages/orchestrator`, `packages/pi-loop`, `packages/cli`, Rust core/store/bridge, config, tests, and historical docs/commits
- write scope: this report file `docs/research/2026-09-21-herdr-free-worker-coverage-attempt-1.md`
- 표기: `[직접]`은 소스 코드/테스트에서 직접 확인한 사실, `[추론]`은 확인된 사실에서 도출한 아키텍처적 결론 및 설계 책임이다.
- 외부 provider/auth CLI 및 유료 모델 호출은 전혀 실행하지 않았다.

---

## 1. COMPARISON: `HerdrAgentProvider` vs `ProcessProvider` / Native Providers

Herdr 통합 제거 이전 `HerdrAgentProvider`가 제공하던 기능(가시 pane, prompt/status 관찰, 재시작 조정)을 현재 남아있는 process/API/fake 프로바이더와 비교한 결과는 다음과 같다.

| 비교 항목 | `HerdrAgentProvider` (제거 전) | `ProcessProvider` (`codex`, `antigravity`, `zai_cli`) | `ZaiApiProvider` (`zai`) | `FakeProvider` (`fake`) |
| :--- | :--- | :--- | :--- | :--- |
| **실행 메커니즘** | Herdr runtime CLI (`herdr pane split`, `herdr agent start`) 경유 | Node.js `child_process.spawn` 기반 파이프 프로세스 (`stdio: ["ignore", "pipe", "pipe"]`) | HTTP `fetch` (JSON body + `AbortController`) | Node.js 인메모리 타이머 (`setTimeout`) |
| **가시 pane (UI)** | **있음:** Herdr workspace 내 우측 pane 자동 분할 (`--direction right --no-focus`) 후 터미널 세션 노출 | **없음:** 완전히 백그라운드 headless 프로세스로 실행 (외부 가시 윈도우/터미널 없음) | **없음:** 네트워크 API 호출 | **없음:** 메모리 시뮬레이션 |
| **프롬프트 전달** | `herdr agent prompt <id> <prompt> --wait --timeout`으로 비동기 전달 및 턴 대기 | 프로세스 구동 시 단발 argv 인자로 전달 (`--print`, `--prompt`, positional arg) | HTTP POST body (`payload.prompt`) 1회 전송 | 메모리 task metadata 직접 수신 |
| **실시간 관찰** | `herdr agent get` 상태 폴링 + `herdr agent read --lines 80`으로 터미널 버퍼 직접 스크래핑 | `stdout`/`stderr` 파이프 스트림 구독 (`subscribe`) 및 JSON Lines 파싱 | HTTP 응답 수신 대기 (단발) | 이벤트 루프 타이머 관찰 |
| **프롬프트 재주입** | 가능 (`herdr agent prompt` 추가 호출 가능) | **불가:** 단발성 CLI 실행으로 실행 중 추가 대화형 프롬프트 주입 미지원 | **불가:** 단발성 요청 | 해당 없음 |
| **결과 정규화** | 터미널 텍스트 버퍼를 읽고 빈 출력이면 `incomplete_output` 생성 | JSON/stream-json 이벤트(`result`, `item.completed`, `final` 등) 자동 파싱, 누락 시 `incomplete_output` | API response JSON (`content[].text`) 파싱 | 사전 정의된 스크립트 결과 반환 |
| **취소 (Cancel)** | `herdr agent send-keys <id> ctrl+c` (우아한 시그널 전달) | `process.kill("SIGTERM")` 후 2.5초 타임아웃 시 `SIGKILL` 강제 종료 | `AbortController.abort()` | `clearTimeout()` 및 프로미스 즉시 reject/resolve |
| **재시작/재부착 (Reattach)** | **외부 데몬 보존:** Herdr 데몬이 pane/agent 수명을 유지하므로 handle로 `attach` 가능 | **인메모리 한정:** 오케스트레이터 재시작 시 `Map<string, Session>` 소실로 실행 중 프로세스 재부착 불가 | **불가:** `resumableSession: false` | **불가:** 인메모리 소실 |
| **세션 Resume** | Herdr opaque session ID 보존 | CLI 차원의 thread resume 지원 (`codex exec resume`, `agy --conversation`) 단, 새 프로세스 구동 | 미지원 | 인메모리 시뮬레이션 |

### 핵심 차이 분석

1. **가시 pane (Visible Pane)**
   - `[직접]` Herdr는 자체 워크스페이스 관리 데몬을 통해 `pane split --direction right --no-focus`를 실행하여 사용자 시야에 워커 터미널을 노출했다 ([`packages/herdr/src/client.ts:64-107`](file:///Users/loopy/dev/ll3/loop/packages/herdr/src/client.ts#L64-L107)).
   - `[직접]` 반면 `ProcessProvider`는 `packages/providers/src/process.ts:41-63`의 `NodeProcessRunner`를 통해 `stdio: ["ignore", "pipe", "pipe"]`로 백그라운드 프로세스를 구동한다. 따라서 워커는 시각적 창 없이 오케스트레이터의 파이프 스트림으로만 제어된다.

2. **프롬프트/상태 관찰 (Prompt & Observation)**
   - `[직접]` Herdr 어댑터는 주기적(250ms)으로 `runtime.status()`를 폴링하고 최종 완료 시 `runtime.read(session.handle)`로 터미널 스크린 버퍼를 읽었다 ([`packages/providers/src/herdr-agent.ts:115-165`](file:///Users/loopy/dev/ll3/loop/packages/providers/src/herdr-agent.ts#L115-L165)).
   - `[직접]` `ProcessProvider`는 `packages/providers/src/process-provider.ts:130-194`의 `extractMachineResult` 및 `findFinalSummary`를 통해 프로세스의 `stdout`에서 구조화된 JSON 메시지(`result`, `final`, `item.completed`)를 능동적으로 파싱한다. 출력이 비어있으면 `incomplete_output`으로 정확히 감지한다.

3. **재시작 조정 및 재부착 (Restart Coordination)**
   - `[직접]` Herdr는 데몬에 프로세스가 살아있어 `attach()`로 재접속할 수 있는 가능성을 열어두었다 ([`packages/herdr/src/client.ts:110-164`](file:///Users/loopy/dev/ll3/loop/packages/herdr/src/client.ts#L110-L164)).
   - `[직접]` `ProcessProvider`의 세션은 인스턴스의 `#sessions = new Map<string, Session>()`에만 존재한다 ([`packages/providers/src/process-provider.ts:22`](file:///Users/loopy/dev/ll3/loop/packages/providers/src/process-provider.ts#L22)). 오케스트레이터 프로세스가 죽으면 실행 중이던 OS 프로세스 핸들과의 연결이 끊어진다.
   - `[직접]` `CodexProvider`의 `exec resume <sessionId>`와 `AntigravityProvider`의 `--conversation <sessionId>`는 "이미 끝난 이전 대화 스레드를 이어받아 새 프로세스를 실행"하는 기능이지, 백그라운드에서 돌고 있던 프로세스에 재부착하는 것이 아니다 ([`packages/providers/src/codex/adapter.ts:69-78`](file:///Users/loopy/dev/ll3/loop/packages/providers/src/codex/adapter.ts#L69-L78), [`packages/providers/src/antigravity/adapter.ts:68-73`](file:///Users/loopy/dev/ll3/loop/packages/providers/src/antigravity/adapter.ts#L68-L73)).

---

## 2. VERIFICATION: Fake 프로바이더 기반 워커 실행 및 검증 커버리지

Herdr 제거 후에도 Loop의 전체 워커 실행·검증 수명주기가 `FakeProvider`를 통해 100% 온전히 테스트됨이 코드와 오프라인 테스트 결과로 확인되었다.

### 2.1 코드 레벨 증거

1. **워커 실행과 독립 검증의 엄격한 분리 (Worker Success != Task Completion)**
   - `[직접]` [`packages/orchestrator/src/coordinator.ts:168-188`](file:///Users/loopy/dev/ll3/loop/packages/orchestrator/src/coordinator.ts#L168-L188)에 따르면, 프로바이더가 성공 결과를 반환하더라도(`completed.value.success === true`), 오케스트레이터는 작업 명세에 지정된 `completionChecks`를 `CompletionVerifier`로 직접 실행한다. 모든 검증을 통과해야만 `recordVerification(passed=true)`를 기록한다.
   - `[직접]` [`packages/orchestrator/test/milestone.test.ts:146-177`](file:///Users/loopy/dev/ll3/loop/packages/orchestrator/test/milestone.test.ts#L146-L177)의 `test("worker success does not complete a task when its completion command fails")`는 `FakeProvider`가 즉시 성공을 반환하더라도 completion check가 실패(`process.exit(7)`)하면 태스크가 `attention` 상태로 전이함을 검증한다. 이는 Herdr 유무와 무관하게 Loop의 핵심 불변식을 증명한다.

2. **DAG 스케줄링, 동시성 제한, 단계적 에스컬레이션, 취소**
   - `[직접]` [`packages/orchestrator/test/milestone.test.ts:51-144`](file:///Users/loopy/dev/ll3/loop/packages/orchestrator/test/milestone.test.ts#L51-L144):
     - 5개 태스크의 의존성 그래프(`research` → `plan` → `impl-a`, `impl-b` → `verify`)의 토폴로지 순서 실행 검증.
     - `maxWorkers: 2` 제한 시 최대 동시 실행 수가 2를 초과하지 않음 검증 (`maxConcurrent <= 2`).
     - 의도적 실패 주입(`failures: { "impl-a": 1 }`) 시 자동 재시도 및 상위 컴퓨트 클래스(`fast` → `balanced`)로의 에스컬레이션 검증.
     - 활성 실행 취소 시 프로바이더 cancel 호출 및 `cancelled` 상태 영속화 검증.
     - 에스컬레이션 소진 시 크래시 없이 컴팩트한 인간 주의(`attention`) 상태로 전이 검증.
   - `[직접]` [`packages/orchestrator/test/milestone.test.ts:179-201`](file:///Users/loopy/dev/ll3/loop/packages/orchestrator/test/milestone.test.ts#L179-L201):
     - 동일 파일 쓰기 스코프(`src/**`)를 가진 작업들이 DAG 상 의존성이 없더라도 쓰기 잠금에 의해 직렬화됨을 검증.

3. **재시작 복구 및 Lost 워커 격리**
   - `[직접]` [`packages/orchestrator/src/runtime.ts:72-87`](file:///Users/loopy/dev/ll3/loop/packages/orchestrator/src/runtime.ts#L72-L87) 및 [`packages/orchestrator/test/runtime.test.ts:31-75`](file:///Users/loopy/dev/ll3/loop/packages/orchestrator/test/runtime.test.ts#L31-L75):
     - 오케스트레이터 재시작 시 `WorkerReconciler.observe(worker.id)`가 `running`을 확인하지 못한 워커는 즉시 `attention`(`recovery-${worker.id}`)을 요청한다.
     - 라이브 상태가 입증된 워커만 `running`을 유지한다.
   - `[직접]` [`crates/loop-store/tests/recovery.rs:41-103`](file:///Users/loopy/dev/ll3/loop/crates/loop-store/tests/recovery.rs#L41-L103) 및 [`crates/loop-core/tests/scheduler_domain.rs:89-103`](file:///Users/loopy/dev/ll3/loop/crates/loop-core/tests/scheduler_domain.rs#L89-L103):
     - Rust 계층에서도 미확인 워커는 `RecoveredWorkerState::Lost`로 전이되며, 완료 증거(`VerificationEvidence`)가 없으면 `TaskState::Done`으로 전이할 수 없도록 강제한다.

4. **오프라인 CLI 수용 테스트 (Offline Installation Verification)**
   - `[직접]` [`packages/cli/test/cli.test.ts:193-211`](file:///Users/loopy/dev/ll3/loop/packages/cli/test/cli.test.ts#L193-L211)의 `test("offline installation verification proves the fake-provider milestone")`:
     - CLI의 `verifyInstallation()` 함수가 fake 프로바이더 환경에서 전체 마일스톤 실행, 스냅샷 영속화, 검증 통과를 137ms 만에 오프라인으로 완주함을 입증한다.

### 2.2 테스트 실행 결과 요약 (외부/유료 호출 0)

- `bun run test:architecture`: **6 pass, 0 fail** (Herdr/외부 호스트 연결 없음 및 클린 바운더리 통과).
- `packages/orchestrator/test/milestone.test.ts`: **6 pass, 0 fail** (스케줄링, 동시성, 에스컬레이션, 취소, 검증 불일치, 쓰기 스코프 직렬화 전부 통과).
- `packages/orchestrator/test/completion.test.ts`: **3 pass, 0 fail** (검증 커맨드 실행, 실패 판정, 디렉토리 제약 통과).
- `packages/orchestrator/test/runtime.test.ts`: **2 pass, 0 fail** (재시작 복구 통과).
- `packages/providers/test/adapters-v2.test.ts`: **11 pass, 0 fail** (Codex, Antigravity, ZAI CLI/API, ProcessProvider 정규화/마스킹 전부 통과).
- `packages/cli/test/cli.test.ts` (offline milestone): **1 pass, 0 fail** (순수 오프라인 검증 통과).

---

## 3. RISK

Herdr 통합 제거로 인해 손실되는 기능과 잠재적 위험은 다음과 같다.

1. **워커 가시 터미널/패널 부재 (Loss of Visible Worker Pane)**
   - *현상:* Herdr가 자동으로 제공하던 우측 분할 터미널 창(`herdr pane split`)이 사라짐.
   - *영향:* 워커가 어떤 파일들을 수정하고 있는지, 실시간 진행 출력은 어떤지 개발자가 직접 실시간 터미널 뷰로 볼 수 없으며, 백그라운드 파이프 출력 수집에 의존하게 됨.
   - *위험:* 워커가 긴 작업을 수행할 때 사용자 입장에서 진행 상황이 불투명하게 느껴질 수 있음.

2. **양방향 대화형 프롬프트 재주입 및 중간 조율 상실 (Loss of Interactive Steering)**
   - *현상:* Herdr의 `agent prompt --wait`를 통한 턴별 개입이 사라지고, 프로세스 기동 시 argv 단발 전달(`--prompt ...`)로 변경됨.
   - *영향:* 워커가 의도와 다른 방향으로 탐색하거나 추가 맥락을 요구할 때, 실행 도중에 프롬프트를 재주입하여 바로잡을 수 없음.
   - *위험:* 워커가 잘못된 가정을 바탕으로 긴 시간을 소모한 뒤 타임아웃 또는 검증 실패로 끝나야만 재시도(attempt + 1)가 가능해짐.

3. **외부 데몬 기반 프로세스 생존 및 재부착(Re-attachment) 상실**
   - *현상:* Herdr 데몬이 OS 세션을 붙잡아주던 구조에서 오케스트레이터의 인메모리 프로세스 관리(`Map<string, Session>`)로 전환됨.
   - *영향:* 오케스트레이터(CLI 또는 Node.js 프로세스)가 종료되거나 재기동되면 실행 중이던 차일드 프로세스와의 연결이 영구 소실됨.
   - *위험:* Loop의 durable recovery 정책에 따라 재기동 시 살아있는 프로세스도 관찰 불가(`unknown`/`lost`)로 판정되어 즉시 `attention`으로 떨어지고, 수동 재개(`resume`)가 필요함.

4. **CLI 출력 포맷 변경 시 `incomplete_output` 실패 취약성**
   - *현상:* 터미널 버퍼 스크래핑(`agent read`) 대신 `stdout` JSON Lines 스트림(`extractMachineResult`)에 의존함.
   - *영향:* 워커 프로세스가 정상 종료(exit code 0)하더라도 파싱 가능한 `result`/`final`/`item.completed` 포맷을 내보내지 않으면 오케스트레이터는 이를 `incomplete_output` 실패로 규정함.
   - *위험:* CLI 도구의 업데이트 등으로 출력 형태가 미세하게 변경되면 워커가 실제 작업을 완수했더라도 태스크가 실패 처리될 수 있음.

---

## 4. PI-ADAPTER

Herdr가 맡았던 실행 계층의 공백을 메우고, Loop의 아키텍처 원칙을 지키면서 워커 실행을 지원하기 위해 Pi 어댑터가 맡아야 할 책임은 다음과 같다.

1. **`AgentProvider` 얇은 어댑터 경계 준수 (Thin Provider Adapter Boundary)**
   - `packages/providers` 내에 위치하며 표준 `AgentProvider` 인터페이스(`capabilities`, `start`, `resume?`, `cancel`, `status`, `result`, `subscribe?`)를 구현한다.
   - `loop-core` 및 생성된 protocol에 Pi 개념을 일절 침범시키지 않는다.
   - 모델 ID, provider 매핑, compute class는 `config/models.toml` 및 오케스트레이터 composition에서 주입받는다.

2. **결정론적 비대화형 실행 (Deterministic Headless Transport)**
   - Pi CLI의 headless 모드(`pi --mode json --print ...` 또는 `--mode rpc`)를 활용하여 쉘 없이 argv 배열로 안전하게 프로세스를 기동한다.
   - 작업 디렉토리(`cwd`), 태스크 요구사항, 컴퓨트 제약, 툴 allowlist를 명시적으로 전달하며 자격 증명(token/key)을 CLI 인자에 노출하지 않는다.

3. **스트림 및 결과 정규화 (Normalization & Lifecycle Mapping)**
   - Pi의 JSON Lines 이벤트 스트림(`session`, `turn`, `message_end`, `tool_call`)을 수신하여 `ProviderEvent` 및 `WorkerResult`로 정규화한다.
   - 성공적인 종료에도 불구하고 `message_end` 최종 텍스트가 없으면 `incomplete_output`으로 처리한다.
   - 인증 실패, Quota 초과, 프로세스 에러, 사용자 취소 시그널을 기존 `ProviderFailureKind` 규격으로 분류하고 출력 내 민감 정보를 마스킹(redaction)한다.

4. **세션 식별자 보존 및 재시작 조정 (Session Tracking & Reconciliation)**
   - Pi가 생성한 세션 ID를 `sessionId` 필드로 Loop 영속 저장소에 기록한다.
   - 향후 재시작 복구 시 `WorkerReconciler.observe(workerId)`가 Pi 세션의 생존 여부(`running`, `completed`, `lost`)를 질의할 수 있는 관찰 접점을 제공한다. 관찰할 수 없는 세션은 조용히 덮어쓰지 않고 `Lost → Attention`으로 투명하게 이관한다.

5. **가시성 및 UI 책임의 올바른 분리 (UI Responsibility Separation)**
   - Herdr의 가시 pane 기능을 Pi 어댑터가 임의로 프로세스 내에서 복제(GUI 창 강제 팝업 등)하려 시도하지 않는다.
   - 워커 어댑터는 순수한 스트림/상태 공급자 역할에 집중하고, 사용자에게 보이는 가시성(컴팩트 8줄 상태 표시, 주의 6줄 알림, `/loop` 커맨드)은 호스트 역할을 하는 Pi 확장(`packages/pi-loop/src/extension.ts`)이 담당하도록 책임을 엄격히 분리한다.

6. **완전한 오프라인 단위 테스트 선행 (Offline Contract Test Precedence)**
   - 실제 Pi 모델 호출이나 인증 없이 가상 `ProcessRunner`를 통해 argv 조립, JSON 스트림 파싱, 취소 처리, 자격증명 마스킹을 검증하는 오프라인 어댑터 테스트를 선행 구축한다.
