# Simulator showcase — 서버 측 증거 (task `simulator-showcase`)

- **일시:** 2026-09-25 22:40 KST (13:40 UTC)
- **게이트웨이:** `http://loopy-macbookpro.tail42f248.ts.net:18477/v1` (launchd `dev.loop.gateway`, stub planner — 유료 모델 호출 없음)
- **앱이 만든 run:** `run_c7a84585-de70-4713-93f0-8ab0c1cc83e5` — 앱 UI의 Submit 핸들러가 `POST /v1/runs`로 생성 (202 → runId 반환 → RunScreen에서 SSE 관찰)

> bearer 토큰은 이 문서에 없다(재발급은 `docs/research/app-device-install.md` §3.2). 프롬프트/토큰은 게이트웨이에 기록되지 않는다.

## 1. 타임라인 (스크립트 실행 순서)

| 시각(로컬) | 단계 | 근거 |
| --- | --- | --- |
| 22:40:05 | 시뮬레이터 앱 기동 (showcase env: bearer·프롬프트 프리필, autoConnect, autoSubmit 12s) | native log `showcase-launch: keys=[autoConnect,autoSubmit,bearer,prompt,submitDelayMs]` |
| 22:40:12 | Connect 화면 스크린샷 (직전 plain launch에서 캡처) | `01-connect-screen.png` |
| 22:40:13 | Submit 화면 스크린샷 (프롬프트 프리필 상태, 제출 전) | `02-submit-screen.png` |
| 22:40:17 | 앱 Submit 핸들러 → `POST /v1/runs` → 202, run 생성 | run `createdAt: 2026-09-25T13:40:17.153Z` |
| 22:40:23 | Run 화면 스크린샷 (SSE status 수신 후) | `03-live-status.png` |
| 22:40:28 | Run 화면 재캡처 (스트림 안정 상태 유지 확인) | `04-live-output.png` |
| 22:40:34 | 게이트웨이가 status 프레임 갱신 (`lastSequence: 4`) | SSE 프레임 `occurredAt: 13:40:34.979Z` |

## 2. `GET /v1/runs/run_c7a84585-de70-4713-93f0-8ab0c1cc83e5` (2026-09-25T13:40:35Z)

```json
{
  "runId": "run_c7a84585-de70-4713-93f0-8ab0c1cc83e5",
  "status": "running",
  "terminal": false,
  "createdAt": "2026-09-25T13:40:17.153Z",
  "updatedAt": "2026-09-25T13:40:34.959Z",
  "lastSequence": "4",
  "taskCounts": { "pending": 1, "running": 0, "attention": 0, "done": 0, "failed": 0, "cancelled": 0 },
  "tasks": [ { "taskId": "gateway-app", "status": "pending", "attempt": 0, "summary": null } ],
  "attention": null
}
```

run이 terminal로 끝나지 않는 것은 정상이다: standalone 게이트웨이에는 worker/orchestrator가 붙어 있지 않아
stub planner가 계획한 `gateway-app` 태스크가 pending으로 유지되고, SSE 스트림은 계속 열려 있다(라이브 상태).

## 3. `GET /v1/runs/{runId}/events` (Accept: text/event-stream) — 앱이 수신하는 프레임

```
id: eyJ2IjoxLCJnIjoxLCJyIjoicnVuX2M3YTg0NTg1LWRlNzAtNDcxMy05M2YwLThhYjBjMWNjODNlNSIsIm4iOjR9
event: status
data: {"version":1,"runId":"run_c7a84585-de70-4713-93f0-8ab0c1cc83e5","occurredAt":"2026-09-25T13:40:34.979Z",
       "run":{"status":"running","terminal":false,"taskCounts":{"pending":1,...},
              "tasks":[{"taskId":"gateway-app","status":"pending","attempt":0}],"attention":null}}
```

RunScreen(`apps/loop-mobile/src/screens/RunScreen.tsx`)은 이 프레임으로
`{runId} — {status}` / `tasks: pending 1, running 0, attention 0, done 0` 라인을 렌더링한다.

## 4. 스크린샷 해시 (내용 구분 확인)

| 파일 | bytes | sha256 (12자) |
| --- | --- | --- |
| `01-connect-screen.png` | 98,095 | `2e334b89194a` |
| `02-submit-screen.png` | 90,950 | `ac1d3da6b2f7` |
| `03-live-status.png` | 82,788 | `43b010889e35` |
| `04-live-output.png` | 82,788 | `43b010889e35` |

03/04는 동일 화면의 두 시점 캡처다(스트림이 안정 상태로 유지됨을 확인하는 목적).
