# RN/Tauri 원격 앱 아키텍처 및 v1 wire contract

- **상태:** 결정됨
- **태스크:** `wire-contract-decision`
- **결정 종류:** `decision`
- **작성일:** 2026-xx
- **선행 근거:** [`docs/research/app-remote-access-surface.md`](../research/app-remote-access-surface.md)
- **범위:** 앱 shell 선택, 게이트웨이 배치, Tailscale 노출 방식, v1 wire contract

## 1. 배경

Loop에는 이미 `LoopRuntime.start/snapshot/subscribe`, Rust가 소유하고 생성한 protocol 타입, bounded task activity가 있다. 그러나 raw prompt를 Pi에 전달하는 원격 표면, HTTP 서버, Tailscale 바인딩, 네트워크 재연결 계약은 없다. Herdr의 pane text는 직접적인 원격 protocol이 아니며, authoritative run 상태는 Loop snapshot/event store다.

이번 결정은 모바일/데스크톱 앱과 게이트웨이가 서로의 구현을 기다리지 않고 개발될 수 있도록 앱 shell과 wire contract를 고정한다. 구현은 다음 기존 의존 방향을 바꾸지 않는다.

```text
loop-core → loop-store → loop-bridge → generated protocol → orchestrator → adapters/UI
                                                                    ↑
RN mobile ─┐                                                       │
           ├─ Rustra-generated protocol ← HTTP/SSE ← gateway adapter┘
Tauri app ─┘                              ├─ Pi adapter (prompt 해석/계획)
                                          └─ Herdr adapter (로컬 관찰; wire에 노출하지 않음)
```

## 2. 결정

### D1. 앱 shell: React Native mobile + Tauri desktop

모바일 앱은 **React Native**, 데스크톱 앱은 **Tauri**로 구현한다. 두 앱은 Rustra가 `loop-bridge`의 Rust 타입에서 생성한 동일한 TypeScript protocol artifact를 소비한다. Rustra는 원격 앱을 Loop 프로세스에 직접 FFI로 연결하는 수단이 아니라 Rust-first wire schema와 codegen seam이다. Tauri의 Rust shell은 창·수명주기 같은 데스크톱 기능만 제공하며 wire DTO를 다시 정의하지 않는다. 두 앱 모두 SQLite, Bun FFI, `loop-bridge` 런타임 또는 Herdr pane에 직접 접근하지 않고 오직 본 문서의 HTTP/SSE contract를 소비한다.

선택 근거:

1. RN은 모바일 native 생태계와 빠른 UI iteration을 제공하고, Tauri는 작은 desktop shell과 성숙한 패키징을 제공한다.
2. 서로 다른 shell이어도 Rustra-generated TypeScript protocol을 단일 interface로 사용하므로 run/event 의미가 drift하지 않는다.
3. HTTP/SSE client와 UI reducer는 각 앱에서 얇게 유지하고, 상태 projection과 정책은 Rust bridge가 소유한다.
4. 앱 UI에는 스케줄링, provider 선택, Pi/Herdr 지식이 없다. prompt submit, run projection, event reduction만 담당한다.

### D2. 전송: Tailscale 전용 HTTP/1.1 + JSON + SSE

게이트웨이는 adapter 계층의 HTTP 서버다.

- command/query는 versioned HTTP JSON(`/v1/**`)을 사용한다.
- run 상태와 출력은 단방향 **SSE**를 사용한다. v1 앱은 submit/control 응답 외에 서버로 지속적인 양방향 channel이 필요하지 않으므로 WebSocket을 도입하지 않는다.
- gateway는 명시된 Tailscale interface 주소에만 bind한다. wildcard(`0.0.0.0`, `::`), loopback, 일반 LAN 주소는 거부한다.
- 시작 시 bind 주소가 현재 활성 Tailscale interface에 속하는지 검사하고, 아니면 fail closed한다. 자동 탐색 결과가 0개 또는 2개 이상이어도 명시적 주소 없이는 시작하지 않는다.
- gateway adapter config는 필수 `host`와 `port`를 받는다. `host`는 활성 Tailscale IP 한 개여야 하고 `port`는 1..65535다. 앱의 base URL은 정확히 `http://<host>:<port>`이며 `/v1`은 route prefix다. tailnet의 WireGuard 암호화와 ACL을 전제로 하며 public Internet bind는 v1 범위 밖이다.
- 모든 `/v1/**` 요청은 `Authorization: Bearer <token>`을 요구한다. v1 token은 HS256 JWT이고 `exp`, exact `iss`, exact `aud`가 필수이며 `alg:none`과 algorithm mismatch를 거부한다. issuer/audience와 secret의 **환경변수 이름**만 config에 둘 수 있고, token/signing secret은 환경변수 또는 프로세스 메모리에서만 읽으며 event, SQLite, crash report, access log에 기록하지 않는다. 앱도 bearer를 세션 process memory에만 두고 AsyncStorage, Tauri store, 파일, DB 또는 로그에 저장하지 않는다. token 발급/refresh는 v1 범위 밖이다.
- `Origin`이 있는 요청은 기본 거부한다. v1 client는 native app이므로 CORS를 열지 않는다.

### D3. 소유권과 seam

wire의 transport-neutral payload는 **Rust `loop-bridge` 타입으로 먼저 정의**하고 Rustra schema/codegen으로 생성한다. 정확한 Rust-owned 목록은 `SubmitPromptInput`, `ClientContext`, `SubmitPromptAccepted`, `RemoteRunStatus`, `RemoteTaskStatus`, `TaskCounts`, `RemoteRunSummary`, `RemoteTask`, `RemoteAttention`, `RemoteRun`, `RemoteRunPage`, `RemoteRunEventEnvelope`, `RemoteRunStatusEvent`, `RemoteRunOutputEvent`, `RemoteRunResetReason`, `RemoteRunResetEvent`, `RemoteRunTerminalEvent`다. SSE의 `event` field가 payload 종류를 판별하므로 JSON `data`에 별도 중복 discriminant를 추가하지 않는다. RN과 Tauri frontend 및 TypeScript gateway는 생성 타입을 import하며 수작업 DTO 복사본을 만들지 않는다. status/task-count projection과 terminal 판정은 Rust-owned deterministic conversion이다.

adapter-local 타입은 `GatewayConfig { host, port }`, Tailscale interface 검사 결과, 인증 context/verifier 결과, HTTP route/path/query/header parsing, HTTP response wrapper, RFC 9457 problem envelope, list/SSE opaque cursor codec와 process-generation state, SSE frame/heartbeat 및 연결별 backpressure state다. 이 타입들은 domain 또는 generated protocol로 승격하지 않는다. 특히 다음 이름은 Rust payload에 들어갈 수 없다: HTTP route, URL, Tailscale, Pi, Herdr, pane, provider, model, endpoint.

`loop-core`에는 prompt transport, 인증, HTTP/SSE, Tailscale, Pi, Herdr 개념을 추가하지 않는다. raw prompt는 gateway가 Pi adapter에 넘기고, Pi adapter가 만든 plan만 기존 orchestrator/generated protocol seam을 지난다. authoritative status는 Loop snapshot이다. v1 output은 snapshot의 bounded `tasks[].activities`를 adapter가 증분 투영한 것이며 lossless pane transcript가 아니다.

## 3. 검토한 대안

| 대안 | 장점 | 기각 이유 |
| --- | --- | --- |
| RN mobile + Tauri desktop (**채택**) | 각 플랫폼에 맞는 생태계, desktop 경량 패키징, generated TS protocol 공동 소비 | shell/toolchain이 둘이므로 UI 코드는 완전 공유하지 않는다. 대신 wire types와 contract tests만 공유해 결합을 제한한다. |
| React Native/Expo로 mobile+desktop 통일 | UI/state 코드 공유가 가장 큼 | desktop packaging과 OS 통합을 위해 추가 계층이 필요하고 확정된 Tauri 요구를 충족하지 않는다. |
| Tauri 2로 mobile+desktop 통일 | Rust shell/tooling 통일 | mobile WebView/toolchain 성숙도와 RN 생태계를 포기하며 확정된 RN 요구를 충족하지 않는다. |
| Rust-native + loopy-lim | 공통 Rust client/state와 직접적인 Rust 모델 소비 | RN/Tauri 확정 스택과 충돌하고 target 지원 위험이 있다. 이전 결정을 대체한다. |
| WebSocket | 양방향 multiplex와 향후 control 확장 | v1은 submit HTTP + server→client stream이면 충분하다. heartbeat, reconnect, proxy 동작이 단순한 SSE가 더 작다. |
| snapshot polling | 구현이 가장 단순 | 모바일 foreground에서 지연·배터리·중복 payload 비용이 크고 실시간 output 요구를 충족하기 어렵다. SSE 장애 시 앱의 명시적 fallback으로만 허용한다. |
| direct Rustra/native bridge | 네트워크 protocol 불필요 | 원격 Tailscale client가 host의 Bun FFI/SQLite에 결합되고 보안 seam이 사라진다. 원격 앱에는 사용할 수 없다. |

## 4. v1 wire contract

### 4.1 공통 규칙

- Base path: `/v1`
- JSON request/response: `Content-Type: application/json; charset=utf-8`
- Error response: `Content-Type: application/problem+json`
- UTF-8만 허용한다. 알 수 없는 JSON field는 v1에서 무시한다. 필수 field 누락, 잘못된 enum/type, 빈 문자열은 `400 invalid_request`다.
- 시간은 UTC RFC 3339 문자열(예: `2026-09-25T03:14:15.926Z`)이다.
- Rust의 `u64`/`bigint` 값은 JSON number가 아니라 10진 문자열이다. `lastSequence`도 이 규칙을 따른다.
- ID는 opaque, 대소문자를 구분하는 UTF-8 문자열이다. 앱은 ID 형식을 해석하지 않는다.
- 모든 성공/오류 응답에 `X-Request-Id`가 있다. 요청의 유효한 `X-Request-Id`를 반사하거나 서버가 생성한다. 이 값은 idempotency key가 아니다.
- v1 submit은 idempotent하지 않다. client는 응답을 받기 전에 연결이 끊겼다고 자동 재제출하지 않고 `GET /v1/runs`로 생성 여부를 확인한다.
- prompt 최대 크기는 UTF-8 기준 64 KiB이며 trim 후 비어 있으면 안 된다. gateway access log와 error에는 prompt를 기록하지 않는다.

### 4.2 공통 타입

#### `RemoteRunStatus`

```text
accepted | planning | running | attention | completed | failed | cancelled
```

- `accepted`: gateway가 prompt를 받았지만 Pi adapter가 아직 시작되지 않음
- `planning`: Pi adapter가 prompt를 plan으로 변환 중
- `running`: Loop snapshot이 active 실행을 나타냄
- `attention`: Loop snapshot이 사람의 결정/승인/실패 처리를 요구함
- `completed | failed | cancelled`: terminal

status mapping은 Rust-owned deterministic projection으로 구현한다. TypeScript handler가 문자열 분기로 재정의하지 않는다.

#### `RemoteRunSummary`

```json
{
  "runId": "run_01J...",
  "status": "running",
  "terminal": false,
  "createdAt": "2026-09-25T03:14:15.926Z",
  "updatedAt": "2026-09-25T03:14:19.004Z",
  "lastSequence": "42",
  "taskCounts": {
    "pending": 1,
    "running": 2,
    "attention": 0,
    "done": 3,
    "failed": 0,
    "cancelled": 0
  }
}
```

- `lastSequence`는 아직 durable Loop run이 생기지 않은 `accepted/planning`에서는 `null`이다.
- `taskCounts`는 모든 알려진 task를 위 여섯 projection bucket에 정확히 한 번 포함한다. 아직 plan이 없으면 전부 0이다.

#### `RemoteRun`

```json
{
  "runId": "run_01J...",
  "status": "attention",
  "terminal": false,
  "createdAt": "2026-09-25T03:14:15.926Z",
  "updatedAt": "2026-09-25T03:14:30.112Z",
  "lastSequence": "57",
  "taskCounts": {
    "pending": 0,
    "running": 1,
    "attention": 1,
    "done": 4,
    "failed": 0,
    "cancelled": 0
  },
  "tasks": [
    {
      "taskId": "gateway-app",
      "status": "running",
      "attempt": 1,
      "summary": null
    }
  ],
  "attention": {
    "attentionId": "attn_01J...",
    "taskId": "gateway-auth",
    "kind": "decision",
    "message": "Select the tailnet ACL policy"
  }
}
```

- `RemoteRun`은 `RemoteRunSummary` field를 모두 포함한다.
- task status projection은 `pending | running | attention | done | failed | cancelled`다.
- `summary`는 없으면 `null`; 한 줄 UTF-8, 최대 2 KiB다.
- 열린 attention이 없으면 `attention`은 `null`이다. 여러 attention이 있으면 oldest-open 하나를 제공하고 전체 목록은 v1 범위 밖이다.
- task 순서는 plan의 안정 순서다.

### 4.3 Prompt 제출

#### `POST /v1/runs`

Request:

```json
{
  "prompt": "Implement the remote gateway and verify it",
  "clientContext": {
    "displayName": "Loopy's phone"
  }
}
```

- `prompt`: 필수, trim 후 1..65536 UTF-8 bytes.
- `clientContext`: 선택. 있으면 object.
- `clientContext.displayName`: 선택, trim 후 1..80 grapheme. 표시용일 뿐 scheduling/policy에 영향이 없으며 credential을 넣어서는 안 된다.
- working directory, provider, model, endpoint는 요청할 수 없다. gateway composition/config가 이를 결정한다.

Success: `202 Accepted`

```json
{
  "run": {
    "runId": "run_01J...",
    "status": "accepted",
    "terminal": false,
    "createdAt": "2026-09-25T03:14:15.926Z",
    "updatedAt": "2026-09-25T03:14:15.926Z",
    "lastSequence": null,
    "taskCounts": {
      "pending": 0,
      "running": 0,
      "attention": 0,
      "done": 0,
      "failed": 0,
      "cancelled": 0
    }
  }
}
```

Gateway는 응답 전에 run ID를 할당하고 transient submission registry에 `accepted`를 등록한다. 이어 Pi adapter에 prompt와 같은 run ID를 전달한다. Pi가 plan을 제출하면 authoritative Loop snapshot으로 전환한다. client disconnect는 run을 취소하지 않는다.

실패:

- `400 invalid_request`: schema/빈 prompt 오류
- `401 unauthorized`: bearer 없음/불일치/만료
- `413 prompt_too_large`: 64 KiB 초과
- `429 capacity_exhausted`: planning queue가 설정 한도에 도달; `Retry-After` 초 포함
- `503 planner_unavailable`: Pi adapter를 시작할 수 없음

`202` 이후 planning이 실패하면 HTTP 응답을 되돌릴 수 없으므로 run은 `failed`로 바뀌고 SSE `status` 다음 `terminal` event를 낸다.

### 4.4 Run 목록과 단건 조회

#### `GET /v1/runs?limit=<n>&cursor=<opaque>`

- `limit`: 선택, 기본 20, 범위 1..100.
- `cursor`: 선택, 직전 응답의 `nextCursor`를 그대로 전달한다.
- 정렬: `createdAt` 내림차순, tie-breaker는 `runId` 내림차순.
- pagination snapshot isolation은 보장하지 않는다. 중복 `runId`는 client가 제거한다.

Success: `200 OK`

```json
{
  "runs": [
    {
      "runId": "run_01J...",
      "status": "running",
      "terminal": false,
      "createdAt": "2026-09-25T03:14:15.926Z",
      "updatedAt": "2026-09-25T03:14:19.004Z",
      "lastSequence": "42",
      "taskCounts": {
        "pending": 1,
        "running": 2,
        "attention": 0,
        "done": 3,
        "failed": 0,
        "cancelled": 0
      }
    }
  ],
  "nextCursor": null
}
```

`nextCursor`는 다음 page가 없으면 `null`이다. malformed/expired cursor는 `400 invalid_cursor`다.

#### `GET /v1/runs/{runId}`

Success: `200 OK` with `RemoteRun`.

Unknown run은 `404 run_not_found`다. gateway restart 전에 `accepted/planning`이었고 아직 durable Loop run이 되지 않은 submission도 `404`가 될 수 있다. durable run은 store에서 재구성한다.

### 4.5 Run 상태/output stream

#### `GET /v1/runs/{runId}/events`

Request headers:

```http
Accept: text/event-stream
Authorization: Bearer <token>
Last-Event-ID: <opaque cursor>   # 선택
```

Success headers:

```http
HTTP/1.1 200 OK
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache, no-transform
X-Accel-Buffering: no
```

각 frame은 `id`, `event`, 단일 JSON `data` line, 빈 줄 순서다. `id`는 gateway가 발급한 opaque cursor이며 client는 비교/파싱하지 않는다. 연결 직후 `Last-Event-ID`가 없으면 현재 `status` event 하나를 먼저 보낸다.

Gateway는 run별 최근 1,024개 event를 process memory에 ring buffer로 보존한다. cursor는 gateway process generation과 run에 한정된다. `Last-Event-ID` 이후 event가 buffer에 모두 있으면 순서대로 replay하고, generation/run 불일치 또는 buffer eviction이면 `reset`한다. 연결별 outbound queue 한도는 256 event 또는 1 MiB 중 먼저 도달하는 값이다. 한도 초과 시 대기 중 `output`을 버리고 최신 `RemoteRun`을 담은 `reset(reason: "slow_consumer")` 하나로 수렴한다. 그 frame도 enqueue할 수 없으면 연결을 닫으며 run 실행에는 영향이 없다.

공통 event envelope:

```json
{
  "version": 1,
  "runId": "run_01J...",
  "occurredAt": "2026-09-25T03:14:19.004Z"
}
```

#### `event: status`

```text
id: eyJnZW4iOjEsIm4iOjQyfQ
event: status
data: {"version":1,"runId":"run_01J...","occurredAt":"2026-09-25T03:14:19.004Z","run":{...RemoteRun}}

```

`RemoteRun` projection이 변경될 때 발생한다. 동일 projection을 반복하지 않는다.

#### `event: output`

```text
id: eyJnZW4iOjEsIm4iOjQzfQ
event: output
data: {"version":1,"runId":"run_01J...","occurredAt":"2026-09-25T03:14:19.104Z","taskId":"gateway-app","activityId":"57:gateway-app:3","text":"gateway listening on tailnet","truncated":false}

```

- `activityId`: run 안에서 dedupe에 쓰는 opaque 문자열.
- `text`: 한 개 logical activity, UTF-8 최대 8 KiB. 초과 시 gateway가 grapheme 경계에서 자르고 `truncated: true`로 보낸다.
- source/provider/pane 식별자는 wire에 없다.
- output은 Loop snapshot의 bounded activity를 관찰한 projection이다. 연결 중에는 순서를 보존하지만 lossless transcript를 보장하지 않는다. client는 `activityId`로 중복 제거한다.

#### `event: reset`

```text
id: eyJnZW4iOjIsIm4iOjF9
event: reset
data: {"version":1,"runId":"run_01J...","occurredAt":"2026-09-25T03:15:00.000Z","reason":"cursor_unavailable","run":{...RemoteRun}}

```

`reason`은 `cursor_unavailable | slow_consumer`다. `Last-Event-ID`가 현재 gateway generation에서 replay 가능하지 않으면 연결 자체를 실패시키지 않고 `reset`을 첫 event로 보낸다. client는 보유 output을 "이전 관찰 기록"으로 남길 수 있으나 authoritative status는 `run`으로 교체하고 이후 event를 새 cursor부터 적용한다. reset은 누락된 output 복구를 보장하지 않는다.

#### `event: terminal`

```text
id: eyJnZW4iOjEsIm4iOjUwfQ
event: terminal
data: {"version":1,"runId":"run_01J...","occurredAt":"2026-09-25T03:16:00.000Z","run":{...RemoteRun}}

```

`completed | failed | cancelled`에서 정확히 한 번 발생한다. gateway는 frame을 flush한 뒤 연결을 닫는다. client는 terminal event를 받으면 reconnect하지 않는다.

#### heartbeat와 stream 오류

- activity가 없어도 15초마다 SSE comment `: keepalive\n\n`를 보낸다. cursor를 소비하지 않는다.
- 인증/unknown run처럼 header 전의 오류는 일반 problem response(`401`/`404`)다.
- header 후 복구 불가능한 오류는 `event: error`에 아래 problem object를 `data`로 보내고 연결을 닫는다. client는 `retryable`에 따라 exponential backoff(1s, 2s, 4s, 최대 30s + jitter)하거나 중단한다.
- 정상 non-terminal disconnect는 client가 마지막 `id`를 `Last-Event-ID`로 보내 재연결한다.

### 4.6 Error contract

모든 HTTP error와 SSE `error` data는 같은 shape를 사용한다.

```json
{
  "type": "https://loop.local/problems/run-not-found",
  "title": "Run not found",
  "status": 404,
  "code": "run_not_found",
  "detail": "The requested run does not exist.",
  "requestId": "req_01J...",
  "retryable": false,
  "fields": null
}
```

- `detail`은 token, prompt, provider/model endpoint, stack trace, filesystem path를 포함하지 않는다.
- validation 오류만 `fields`를 사용한다: `{ "prompt": "must not be empty" }`. 그 외는 `null`.
- client는 `title/detail/type`이 아니라 `code`와 `status`로 분기한다.

| HTTP | code | retryable | 의미 |
| --- | --- | --- | --- |
| 400 | `invalid_request` | false | body/query/header schema 오류 |
| 400 | `invalid_cursor` | false | list cursor 형식/수명 오류 |
| 401 | `unauthorized` | false | bearer 누락 또는 검증 실패 |
| 404 | `run_not_found` | false | run 없음 |
| 406 | `stream_not_acceptable` | false | SSE endpoint에서 Accept 불일치 |
| 413 | `prompt_too_large` | false | prompt 64 KiB 초과 |
| 429 | `capacity_exhausted` | true | planning/stream 한도 초과 |
| 500 | `internal` | false | 예상하지 못한 서버 오류; 상세 비공개 |
| 503 | `planner_unavailable` | true | Pi prompt adapter 시작 실패 |
| 503 | `runtime_unavailable` | true | Loop runtime/store 접근 실패 |

## 5. Gateway와 앱의 독립 구현 계약

### Gateway adapter가 제공할 interface

1. `submitPrompt(prompt, clientContext) -> accepted RemoteRunSummary`
2. `listRuns(page) -> RemoteRunSummary[]`
3. `getRun(runId) -> RemoteRun`
4. `observeRun(runId, afterCursor) -> status/output/reset/terminal events`

gateway 내부 의존성은 composition root에서 주입한다: prompt planner(Pi adapter), run runtime(`LoopRuntime`), auth verifier, Tailscale address inspector, clock. handler는 이를 생성하지 않는다. disconnect는 실행 owner의 cancel signal이 아니다.

### 앱이 가정할 interface

RN과 Tauri 앱에는 세 화면/상태만 필요하다.

1. 사용자가 입력하거나 런타임에 주입한 `http://<Tailscale-host>:<port>` base URL과 bearer를 process memory에서 읽는 connection 설정
2. prompt submit 후 받은 `runId`로 stream 구독
3. generated `RemoteRun`을 교체하고 generated `output.activityId`를 dedupe하여 상태와 bounded output 표시

bearer는 앱 재시작 후 다시 입력/주입하며 어떠한 앱 persistence에도 저장하지 않는다. 앱은 SSE가 반복 실패할 때만 `GET /v1/runs/{runId}`를 foreground 2초 간격으로 polling한다. terminal 상태 또는 background 전환 시 polling을 중단한다.

## 6. 검증 및 acceptance evidence

후속 구현은 다음을 자동화해야 한다.

1. Rust payload schema golden test와 `bun run codegen:check`: Rust 타입과 generated protocol drift 없음.
2. architecture test: `loop-core`에 `http|sse|tailscale|pi|herdr|provider|endpoint` 신규 개념 없음; gateway만 route/framing 소유.
3. bind test: wildcard/LAN/loopback 거부, fake Tailscale interface 주소 허용, interface 소실 시 시작 실패.
4. contract test: submit `202`, list/get projection, problem mapping, bigint 문자열 직렬화.
5. SSE test: initial status, output 순서, heartbeat, reconnect replay, stale cursor reset, terminal flush+close, slow client bounded queue.
6. security test: access/error logs와 persistence에 bearer/signing secret 없음; prompt도 gateway log에 없음.
7. gateway-app smoke: fake Pi/runtime으로 prompt 제출 → planning/running → output → completed를 RN client와 Tauri frontend client가 같은 generated protocol로 수신. paid model/authenticated provider 호출 금지.
8. 최종 통합: `bun run check`, `bun run test:architecture`, gateway-app smoke.

## 7. 결과와 위험

**긍정:** gateway는 application seam 위의 깊은 module이 된다. 앱은 작은 submit/list/get/observe interface만 배우고, Pi·Herdr·store·bridge 구현은 숨겨진다. Rust-first schema가 gateway와 앱의 병렬 개발 기준점이 된다.

**절충/위험:** v1 output은 bounded activity projection이므로 pane transcript와 동일하지 않다. gateway restart 중 아직 durable plan이 되지 않은 `accepted/planning` submission은 유실될 수 있다. SSE replay buffer 밖 cursor는 status reset만 가능하고 누락 output을 복구하지 못한다. RN과 Tauri는 UI 구현을 공유하지 않으므로 contract test가 drift 방지의 핵심이다. 앞의 세 전송 제한을 해소하려면 각각 durable output log, durable submission inbox, durable event replay가 필요하며 v1에 미리 추가하지 않는다.

## 8. Dependents용 contract 요약

React Native 모바일 앱과 Tauri 데스크톱 앱은 Rust `loop-bridge`에서 먼저 정의하고 Rustra로 생성한 공통 protocol을 통해, `host:port`로 구성되어 활성 Tailscale interface에만 fail-closed bind된 gateway의 `/v1` HTTP/SSE를 사용한다. `POST /v1/runs`는 raw prompt를 받아 `202`와 accepted run을 반환하고, `GET /v1/runs`/`GET /v1/runs/{runId}`는 목록과 authoritative run projection을 제공하며, `GET /v1/runs/{runId}/events`는 opaque SSE cursor로 `status`, bounded `output`, `reset`, `terminal` event를 전달한다. status와 event payload는 generated bridge types이고 HTTP/SSE framing, problem response, 인증, cursor 및 Tailscale 검사는 adapter-local이며, HTTP/Pi/Herdr/Tailscale 개념은 `loop-core`에 들어가지 않고 bearer/signing credential은 gateway나 앱의 config·로그·DB·파일에 저장하지 않는다.

## 9. 개정 (2026-10-22): serve-TLS front 경로

tailscale serve(또는 동등한 tailnet-internal TLS 프록시)를 gateway 앞에 두면
앱이 `https://<magicdns-name>[:port]` base URL로 접속할 수 있다. 이 개정은
D2의 기본 계약(`http://<host>:<port>`, tailnet 멤버십이 신뢰 경계)을 바꾸지
않는다 — plain http host:port가 기본이고, https는 같은 tailnet 안의 TLS
front를 통한 표현일 뿐이다.

- 허용하는 것: 앱 연결 설정이 `https://host[:port]` 전체 URL을 받는다
  (`connectionConfigFromUrl`), 키체인 영속 항목이 스킴을 보존한다
  (`https://host:port` username), 수동 연결 화면이 전체 URL을 받는다.
  QR 페어링 payload(`loop://connect?host=&port=`)는 http host:port로
  유지된다 — serve front는 수동 입력으로 연결한다.
- 여전히 금지: public Internet 노출(funnel 포함)은 v1 범위 밖. bearer 없는
  https는 tailnet 멤버십 + TLS 전송 보호를 전제로 하며, credential 정책은
  무변경(키체인만, 로그·파일 금지).
- Android 릴리스 빌드는 network security config로 클리어텍스트를 명시 허용해
  iOS(raw IP ATS 우회 + 스코프드 예외)와 같은 목적을 달성한다. 단 Android의
  base-config 허용은 iOS의 도메인 스코프 예외보다 넓다 — 앱은 게이트웨이 외
  통신이 없어 허용 범위 차이의 실효 위험은 낮고, 도메인 스코핑이 필요해지는
  시점(서드파티 통신 추가)에 후속으로 좁힌다.
