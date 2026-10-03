# Simulator showcase v2 — 서버·클라이언트 측 증거 (task `simulator-showcase-2`)

- **일시:** 2026-09-25 23:10–23:22 KST (14:10–14:22 UTC)
- **게이트웨이:** `http://loopy-macbookpro.tail42f248.ts.net:18477/v1` (launchd `dev.loop.gateway`, **deterministic-local real-run 구성** — 유료 모델 호출 0)
- **앱이 만든 run:** `run_8c4c5a63-f883-496c-9431-05051a276014` — 앱 Submit 핸들러가 `POST /v1/runs` → 202 → 실제 4-태스크 그래프 실행 → **completed** 수신
- **스크린샷:** `01-connect-screen.png` ~ `06-runs-list-after.png` (이 디렉터리)
- **선행 문서:** [`../evidence.md`](../evidence.md) (v1 — 스텁 시대), 결정 [`docs/decisions/2026-xx-real-run-planner.md`](../../../docs/decisions/2026-xx-real-run-planner.md)

> bearer 토큰은 이 문서에 없다(재발급은 `docs/research/app-device-install.md` §3.2 절차). 프롬프트·토큰은 게이트웨이에 기록되지 않는다.

## 0. 이번 세션의 전제 정비

1. **게이트웨이 재시작(필수):** launchd 서비스는 20:16 기동(스텁 시대 코드) 상태였고, `packages/gateway/src`는 23:05에 real-run 구성으로 교체되어 있었다. `launchctl kickstart -k gui/501/dev.loop.gateway`로 23:10 재기동(신규 pid). 서비스 로그: `gateway listening on http://100.80.133.120:18477/v1`.
2. **`LOOP_GATEWAY_PROJECT_ROOT` 추가(연산자 파일 `~/.loop/gateway.env`):** deterministic-local 템플릿의 완료 검사가 실제 git 명령(`git rev-parse --is-inside-work-tree` 등)이므로 실행 루트가 repo여야 한다. launchd 기본 cwd(`/`)로는 검사가 실패한다. 추가 값: `LOOP_GATEWAY_PROJECT_ROOT=/Users/loopy/dev/ll3/loop`. provider 모드는 기본값(`deterministic-local`) 그대로 — 유료 레인 비활성.
3. **앱 실버그 2건 수정 (v1에서 실제로는 스트림이 실패하고 있었다):** v1 스크린샷을 재검증하자 RunScreen은 스트림 오류 화면이었다. 원인은 (a) Hermes에 Web `TextDecoder`가 없음, (b) RN의 whatwg-fetch 폴리필은 `response.body`를 아예 노출하지 않음. v2에서 수정 후 재시연했다(§4).

## 1. 단계별 시연 타임라인

| 시각(KST) | 단계 | 근거 |
| --- | --- | --- |
| 23:10:0x | 게이트웨이 재기동 — real-run 구성 로드 | `service.log`, ps pid 87974 |
| 23:10:58 | curl 스모크 제출 → `run_988f9932` 202(planning) → **6초 내 completed, 4/4 done** | §2.1 |
| 23:11:5x | 신규 앱 빌드·설치·plain 기동 → Connect 화면(중앙 정렬) | `01-connect-screen.png` |
| 23:12:2x | showcase 기동(autoConnect만) → **실제 runs 목록 렌더링** | `02-runs-list.png` |
| 23:12:33 | showcase 기동(프롬프트 프리필 + 12초 후 autoSubmit) | `03-submit-screen.png` |
| 23:12:45 | 앱 Submit 핸들러 → `POST /v1/runs` 202 → `run_f5347b55` 생성·완료 | §2.2 |
| 23:16:3x | SSE 전송 수정판 재빌드(§4) 후 동일 시퀀스 재실행 | — |
| 23:20:2x | Connect / runs 목록 / 프리필+목록 재캡처 | `01`, `02`, `03` (최종본) |
| 23:20:45 | 앱 Submit → `run_8c4c5a63` 생성 → RunScreen이 **status·출력 12프레임·terminal을 스트림에서 수신** | `04-run-live.png`, `05-run-output.png`, §2.2–3 |
| 23:21:0x | 재기동 → 목록에 앱 run `completed` 포함 6건 표시 | `06-runs-list-after.png` |
| 23:21:2x | 서버 측 대조: `loop runs` = 앱 목록, `loop status` = completed 4/4 | §3 |

## 2. 서버 측 증거

### 2.1 curl 스모크 run (`run_988f9932-6eb7-4303-b869-b7228fcffcd7`)

```json
{"runId":"run_988f9932-…","status":"completed","terminal":true,
 "taskCounts":{"pending":0,"running":0,"attention":0,"done":4,"failed":0,"cancelled":0},
 "tasks":[{"taskId":"decision","status":"done","summary":"decision complete"},
          {"taskId":"implementation","status":"done","summary":"implementation complete"},
          {"taskId":"research","status":"done","summary":"research complete"},
          {"taskId":"verification","status":"done","summary":"verification complete"}]}
```

제출 6초 후 조회 기준 완료. 실제 실행은 ~0.3초(deterministic-local FakeProvider + git 완료 검사).

### 2.2 앱 run (`run_8c4c5a63-f883-496c-9431-05051a276014`)

`GET /v1/runs/run_8c4c5a63-…` (2026-09-25T14:21 UTC):

```json
{"status":"completed","terminal":true,"lastSequence":"176",
 "taskCounts":{"pending":0,"running":0,"attention":0,"done":4,"failed":0,"cancelled":0},
 "tasks":[{"taskId":"decision","status":"done","attempt":0,"summary":"decision complete"},
          {"taskId":"implementation","status":"done","attempt":0,"summary":"implementation complete"},
          {"taskId":"research","status":"done","attempt":0,"summary":"research complete"},
          {"taskId":"verification","status":"done","attempt":0,"summary":"verification complete"}],
 "attention":null}
```

`loop status run_8c4c5a63 --database ~/.loop/gateway/loop.db`:

```text
State: completed
Tasks: 4/4 · Workers: 0 · Attention: 0
decision · done · Decide approach: Showcase v2: run the deterministic local pipeline and report each step.
implementation · done · Implement: Showcase v2: …
research · done · Research context: Showcase v2: …
verification · done · Verify outcome: Showcase v2: …
```

→ **앱에서 제출한 프롬프트가 그대로 loop의 표준 그래프 템플릿(research→decision→implementation→verification)으로 분해되어 `loop status`에 보인다.**

### 2.3 앱이 수신한 SSE 프레임 (`GET /v1/runs/{runId}/events`)

프레임 집계: `status` 1건, **`output` 12건**(4 태스크 × `[lifecycle] starting`/`[lifecycle] completed`/`[result] <task> complete`), `terminal` 1건.

```text
event: output
data: {"version":1,"runId":"run_8c4c5a63-…","occurredAt":"2026-09-25T14:21:22.435Z",
       "taskId":"decision","activityId":"176:decision:0","text":"[lifecycle] starting decision", …}
event: output
data: {… "activityId":"176:decision:2","text":"[result] decision complete", …}
event: terminal
data: {"version":1,"runId":"run_8c4c5a63-…","occurredAt":"2026-09-25T14:21:22.456Z",
       "run":{"status":"completed","terminal":true,"lastSequence":"176", …}}
```

`activityId` 형식(`<seq>:<taskId>:<idx>`)과 비어 있지 않은 `text` — 결정 문서 수용기준 3(worker-output-carries-real-content)의 wire 형태와 일치.

### 2.4 앱 run 목록 = loop runs 목록

`GET /v1/runs?limit=10`의 durable 집합과 `loop runs --database ~/.loop/gateway/loop.db`:

```text
run_8c4c5a63-… · completed   (앱 제출, 이번 시연)
run_464db91c-… · completed   (앱 제출, §4 수정판 첫 검증)
run_f5347b55-… · completed   (앱 제출, 수정 전 빌드 — 스트림 오류 상태로 수신 실패)
run_988f9932-… · completed   (curl 스모크)
run_c7a84585-… · active      (스텁 시대 유물 — v1 쇼케이스 run)
run_0e3f2731-… · active      (스텁 시대 유물)
```

**양측 모두 동일한 6건**(순서만 정렬 규칙 차이). 결정 문서 수용기준 2(app-run-list-matches-loop-runs) 충족.

## 3. 스크린샷 (v2)

| 파일 | 내용 | sha256 (12자) |
| --- | --- | --- |
| `01-connect-screen.png` | Connect 화면 — 중앙 컬럼 레이아웃, 호스트/포트 프리필 | `75cfebb92612` |
| `02-runs-list.png` | Connect 직후 — **실제 runs 목록**(완료 3건 + 스텁 유물 2건) | `300d075c6e5d` |
| `03-submit-screen.png` | 프롬프트 프리필 + Recent runs 섹션 | `581f3673447d` |
| `04-run-live.png` | RunScreen — `run_8c4c5a63 · completed`, 태스크 4건 상태, **워커 출력 12줄** | `d45f1bb14462` |
| `05-run-output.png` | 안정 상태 재캡처(04와 동일 해시 — terminal 후 불변 확인) | `d45f1bb14462` |
| `06-runs-list-after.png` | 재기동 후 목록 — 앱 run `completed` 포함 6건 | `551533d1e06a` |

**검증 방법 명시:** 이 세션에는 시각 확인 수단이 없어, 모든 스크린샷을 macOS Vision OCR로 텍스트 검증했다. 예: `04`에서 `run_8c4c5a63-… / completed (terminal) / tasks: … done 4 / decision: done … [decision] [result] decision complete …` 전행 확인. (굵은 제목의 OCR 오인식 — `New run`→`New run20` 등 — 은 레이아웃 문제가 아니라 인식 한계다.)

## 4. 이번 태스크에서 수정한 것 (모두 `apps/loop-mobile` + 연산자 env)

| 파일 | 변경 | 이유 |
| --- | --- | --- |
| `src/gateway/sse.ts` | `TextDecoder` → 자체 `Utf8ChunkDecoder`(청크 경계 멀티바이트 carry, malformed는 U+FFFD) | **실버그.** Hermes에 Web `TextDecoder`가 없어 SSE 파싱이 `ReferenceError`로 즉사. v1 쇼케이스의 RunScreen도 실제로는 이 오류 화면이었다 |
| `src/gateway/xhr-sse.ts` (신규) | XHR 증분 이벤트 → 텍스트 청크 AsyncGenerator | **실버그.** RN의 whatwg-fetch는 `response.body`를 노출하지 않아(`undefined.getReader` TypeError) fetch 스트리밍 경로 자체가 RN에서 불가. RN XHR의 `onreadystatechange`(readyState 3) 증분 데이터로 동일 파서에 공급 |
| `src/gateway/client.ts` | observe 경로를 전송 무관 청크 루프로 통일. 실행 시 프루브(`new Response("x").body instanceof ReadableStream`)로 표준 fetch/Bun ↔ XHR(RN) 선택, non-200은 양 경로 모두 problem 계약으로 정규화 | 전송 차이를 client 한 곳에 흡수, 프레임 파싱·재시도·커서 로직은 단일 사본 유지 |
| `src/ui/Screen.tsx` (신규) + `App.tsx` | 모든 분기를 공용 `Screen`(중앙 컬럼, maxWidth 480)으로 감쌈 — 텍스트는 컬럼 내 좌측 정렬 리듬 | `ui-ux-guidance.md` §2(위계는 위치·분리 먼저)에 따른 중앙 정렬 결함 수정 |
| `src/screens/RunsList.tsx` (신규) + `SubmitScreen.tsx` | `GET /v1/runs` 실제 목록 섹션(행 탭 → 라이브 RunScreen 진입, Refresh) | "connect → 실제 run 목록 확인 → 제출" 흐름과 `loop runs` 대조 검증 가능화 |
| `src/screens/RunScreen.tsx` | 태스크별 상태 행(`taskId: status`) 추가, own ScrollView 제거 | 실시간 상태의 태스크 단위 가시성 |
| `src/App.tsx` | `openRunId` 상태로 목록→기존 run 열기/복귀 네비게이션 | 목록 행과 RunScreen 연결 |
| `test/sse-decoder.test.ts`, `test/xhr-sse.test.ts` (신규) | UTF-8 청크 분할·malformed·XHR 증분/중단/문제 본문 11건 | 전송 계층 회귀 방지 (총 28 pass) |
| `~/.loop/gateway.env` (연산자 파일, repo 외) | `LOOP_GATEWAY_PROJECT_ROOT=/Users/loopy/dev/ll3/loop` 추가 | 템플릿 완료 검사(git)가 실행될 repo 루트 확정 — §0.2 |

앱 테스트: `bun test apps/loop-mobile/test` **28 pass / 0 fail**. `bunx tsc --noEmit` 신규 오류 0(기존 TS7016 — react 타입 미설치 — 만 남음).

## 5. 운영자 재실행 명령

전제: 게이트웨이 서비스 실행 중(launchd `dev.loop.gateway`), `~/.loop/gateway.env`에 §0.2 값 존재, 시뮬레이터 부팅. 모두 결정론적, 유료 호출 없음.

```bash
cd /Users/loopy/dev/ll3/loop
UDID=99B087B5-DEF6-4CF1-9177-81A5DE564CFC
OUT=docs/research/simulator-showcase/v2

# 0) (필요 시) 게이트웨이 코드 갱신 반영: 재시작 + 헬스
launchctl kickstart -k gui/$(id -u)/dev.loop.gateway && sleep 3
tail -1 ~/.loop/gateway/service.log

# 1) bearer 발급 (메모리에만 존재 — 문서/로그에 쓰지 않는다)
TOKEN=$(bun -e '
const fs = require("node:fs");
const env = Object.fromEntries(fs.readFileSync(process.env.HOME + "/.loop/gateway.env", "utf8")
  .trim().split("\n").map((l) => l.split("=", 2)).filter((p) => p.length === 2));
const { signHs256Token } = await import("./packages/gateway/src/auth.ts");
const exp = Math.floor(Date.now() / 1000) + 24 * 3600;
process.stdout.write(signHs256Token({ iss: env.LOOP_GATEWAY_JWT_ISSUER, aud: env.LOOP_GATEWAY_JWT_AUDIENCE, exp }, env.LOOP_GATEWAY_JWT_SECRET));
' 2>/dev/null)

# 2) 빌드 + 설치 + 기동 (JS 정적 번들, Metro 불필요)
cd apps/loop-mobile && bash scripts/build-ios-simulator.sh && cd ../..

# 3) Connect 화면 캡처 (plain launch)
xcrun simctl terminate "$UDID" org.reactjs.native.example.LoopMobile 2>/dev/null; sleep 1
xcrun simctl launch "$UDID" org.reactjs.native.example.LoopMobile >/dev/null
sleep 7;  xcrun simctl io "$UDID" screenshot "$OUT/01-connect-screen.png"

# 4) runs 목록 캡처 (autoConnect만)
xcrun simctl terminate "$UDID" org.reactjs.native.example.LoopMobile 2>/dev/null; sleep 1
SIMCTL_CHILD_LOOP_SHOWCASE_BEARER="$TOKEN" SIMCTL_CHILD_LOOP_SHOWCASE_CONNECT=1 \
xcrun simctl launch "$UDID" org.reactjs.native.example.LoopMobile >/dev/null
sleep 9;  xcrun simctl io "$UDID" screenshot "$OUT/02-runs-list.png"

# 5) 실제 run: 프리필 + autoSubmit(12s), 단계 캡처
xcrun simctl terminate "$UDID" org.reactjs.native.example.LoopMobile 2>/dev/null; sleep 1
SIMCTL_CHILD_LOOP_SHOWCASE_BEARER="$TOKEN" \
SIMCTL_CHILD_LOOP_SHOWCASE_PROMPT="Showcase v2: run the deterministic local pipeline and report each step." \
SIMCTL_CHILD_LOOP_SHOWCASE_CONNECT=1 SIMCTL_CHILD_LOOP_SHOWCASE_SUBMIT=1 \
SIMCTL_CHILD_LOOP_SHOWCASE_SUBMIT_DELAY_MS=12000 \
xcrun simctl launch "$UDID" org.reactjs.native.example.LoopMobile >/dev/null
sleep 11; xcrun simctl io "$UDID" screenshot "$OUT/03-submit-screen.png"
sleep 5;  xcrun simctl io "$UDID" screenshot "$OUT/04-run-live.png"     # completed + 워커 출력
sleep 4;  xcrun simctl io "$UDID" screenshot "$OUT/05-run-output.png"   # 안정 상태 재캡처

# 6) 목록 갱신 캡처 (앱 run이 completed로 표시)
xcrun simctl terminate "$UDID" org.reactjs.native.example.LoopMobile 2>/dev/null; sleep 1
SIMCTL_CHILD_LOOP_SHOWCASE_BEARER="$TOKEN" SIMCTL_CHILD_LOOP_SHOWCASE_CONNECT=1 \
xcrun simctl launch "$UDID" org.reactjs.native.example.LoopMobile >/dev/null
sleep 9;  xcrun simctl io "$UDID" screenshot "$OUT/06-runs-list-after.png"

# 7) 서버 측 대조 (앱 목록 = loop runs, 상태 일치)
./dist/loop runs --database ~/.loop/gateway/loop.db
curl -s -m 5 -H "Authorization: Bearer $TOKEN" \
  "http://loopy-macbookpro.tail42f248.ts.net:18477/v1/runs?limit=10"
# 앱 runId는 5) 직후 목록의 최신 run. SSE 프레임 관찰:
# curl -s -N -H "Authorization: Bearer $TOKEN" -H "Accept: text/event-stream" \
#   "http://loopy-macbookpro.tail42f248.ts.net:18477/v1/runs/<runId>/events"
```

## 6. 미해결 리스크 / 후속

1. **스텁 시대 durable 유물 2건**(`run_c7a84585`, `run_0e3f2731`)이 목록에 `running`(pending 1)으로 영구 표시된다 — 실행 owner가 없어 새 게이트웨이도 실행하지 않는다(정상). 목록 가독성을 위해 `loop cleanup` 계열 정리나 gateway 목록 필터는 후속 결정 대상.
2. **durable run의 목록 `createdAt`** 이 저장소 생성 시각이 아닌 게이트웨이 첫 관찰 시각으로 표시된다 — store snapshot에 createdAt이 없어 생기는 표기 특성. gateway 측 수정은 이 태스크 쓰기 범위 밖.
3. **중간 실행 상태는 육안 관측 불가** — deterministic-local 실행이 ~0.3초라 앱은 replay 커서로 status/output/terminal을 즉시 수신한다. 라이브 스트리밍 자체(SSE 재연결·커서)는 계약 테스트와 프레임 증거로 검증됨. 긴 실행의 실시간 관측은 실제 provider lane 후속 과제.
4. **`docs/research/app-device-install.md` §5.2 드리프트** — IP 프리필 서술은 v1 때부터 부정확(v1 README §5.2 인계). 이 태스크 쓰기 범위 밖.
5. **TS7016(react 타입 미설치)** — 이 태스크 이전부터 존재하는 앱 typecheck 오류. `@types/react` 추가는 별도 의존성 결정.
