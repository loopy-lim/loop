# 실세션 미러 최종 검증 (live-mirror-final-verification, 2026-09-26)

**결론: PASS.** 실사용 pi TUI 세션이 tap → collector → SSE → 앱으로 라이브 미러링되며, 세션·run이 채팅 목록에 구분 라벨로 공존하고, tap 실패가 pi에 영향을 주지 않으며, 아키텍처 경계가 유지된다. 전체 리포 검사와 워크스페이스 cargo 테스트가 모두 통과했다.

## 수락 기준별 판정

### 1. 실 pi TUI 세션이 tap → collector → SSE → 앱으로 흐른다 — **PASS**

- **앱 측 1차 증거(선행 태스크 live-session-showcase 산출물):** `docs/research/simulator-showcase/v12/` 스크린샷 4장 — ① 채팅 목록 SESSIONS 섹션에 실세션 6건, ② 턴 1 스트리밍 중 터미널 `⋯ Working` ↔ 앱 `● running` 나란히 일치, ③ 턴 1 완료(툴 카드 `✓ read … using-super… done` + 응답 `돌` 양측 동일), ④ 턴 2까지 누적된 최종 전사 일치. 상세 매핑은 동일 디렉터리 `evidence.md`.
- **서버 측 2차 증거(본 검증에서 직접 재현):** launchd 게이트웨이 `kr.ll3.loop.gateway`가 살아있고 소켓 `$TMPDIR/loop-session-collector.sock` 존재 확인. 데모 세션 SSE 재생:
  ```text
  $ curl -H "Accept: text/event-stream" \
      http://127.0.0.1:18477/v1/sessions/01a0ddfc-e465-74d4-9f09-fdb57b9ebae7/events
  event: lifecycle       data: {"phase":"sessionStarted", …}
  event: user_message    data: {"text":"1+1은? 정확히 한 단어로만 답해.","source":"interactive", …}
  event: lifecycle       data: {"phase":"turnStarted", …}
  event: assistant_message data: {…}
  event: tool_call_started data: {"toolName":"read","argsJson":"{…using-superpowers/SKILL.md…}", …}
  event: tool_call_ended data: {…}
  ```
  앱 스크린샷 03의 툴 카드와 동일 이벤트가 서버 버퍼에 그대로 존재 — tap → collector → SSE 구간 독립 확인.
- `GET /v1/sessions` 스냅샷: `total: 10 | live: 1 | lanes: {'pi'}` — 등록 라인 어휘(`sessionId/runId/taskId/workerId/lane/state`) 정상.

### 2. 세션과 run이 채팅 목록에 구분 라벨로 공존 — **PASS**

- `apps/loop-mobile/src/features/run-list.tsx`: CHATS(run 카드) 아래 `SESSIONS_HEADING = "Sessions"` 섹션(`src/ui/copy.ts:62`), 세션 행 라벨 `{session.lane} · run_id = null (no run correlation)`(run-list.tsx:196). 스크린샷 `01-chats-live-sessions.png`에서 두 섹션 동시 렌더 확인.
- 계약 테스트 `apps/loop-mobile/test/conversation-contract.test.ts` 통과(bun run check 소속).

### 3. tap 실패가 pi 본 동작에 영향 없음 (fail-observer) — **PASS**

- 코드 검토 `pi-extensions/session-tap.ts`: 전송·연결 전부 `catch`로 삼킴(라인 227/239/388/422/644/681/699/733), 재연결은 상한 15s 지수 백오프(348: `backoffMs 500, maxBackoffMs 15000`, 397–398), 타이머 `unref()`(402–403 — tap이 pi 프로세스 수명을 붙잡지 않음), 소켓 부재 시 프레임 조용히 폐기(이후 final 프레임이 앱 뷰 수렴).
- collector 측 방어 테스트 통과: `malformed bodies and refs are dropped (fail-observer)` 등 `packages/gateway/test/session-attachments.test.ts` 전량.
- 운영 환경 실증: 탭 등록 후 운영자의 다른 pi 프로세스들이 별도 설정 없이 같은 collector에 자동 등록되어 세션 간 간섭 없이 목록에 함께 표시됨(v12 evidence.md — 본 검증 시점에도 `live: 1`로 재확인).

### 4. 경계 불변 — **PASS**

- `bun run test:architecture` (독립 실행): **8 pass / 0 fail**.
- `crates/loop-core/src` 전체에서 `pane|pi` 스캔: 유일 적중은 `event/reducer.rs:72` 주석("no adapter, pane, or viewer …") — 개념 유입 없음. 송신자 소유는 pi 확장(tap)이, 인그레스는 게이트웨이 collector가 소유하는 D1 구조 유지.
- Rust 변경 시 codegen 규정: `bun run codegen:check` 통과(bun run check 첫 단계).

## 실행한 검사와 결과

| 검사 | 명령 | 결과 |
| --- | --- | --- |
| full-check | `bun run check` (codegen:check → typecheck → architecture → cargo test --workspace → bun test) | **통과 — 594 pass / 0 fail, 3,957 expect(), 67파일** |
| workspace cargo tests | `cargo test --workspace` | **통과 — exit 0**, loop-bridge 49(15+22+6+2+4), loop-core 49, loop-store 32 전부 `ok. … 0 failed` |
| architecture (독립) | `bun run test:architecture` | 8 pass / 0 fail |

## 변경 파일

- `docs/findings/live-session-mirror-verification.md` — 이 문서뿐 (선언된 쓰기 범위 준수). 앱·게이트웨이·tap 코드는 선행 태스크 산출물을 그대로 사용.

## 유료 호출 (전량 공개, 운영자 사전 승인)

데모 시 사용 2회, `(openai-codex) gpt-5.5 · medium`, pi 푸터 기준 합계 **$0.049 (sub)** — 턴 1 `1+1은?…`→`돌` $0.038, 턴 2 `2+2는?…`→`넷` +$0.011. 본 검증 태스크 자체는 추가 유료 호출 0회(기존 증거 + 서버 재생 재확인만 수행).

## 미해결 리스크

- **실기기 미검증** — iPhone 17 시뮬레이터만 사용. 시뮬레이터 NAT가 Tailscale utun 경로를 못 타는 확인된 제약(루프백 127.0.0.1:18477 사용)은 실기기에서는 해당 없음(v10에서 Tailscale 경로 증명).
- **collector 메모리 전용** — 게이트웨이 재시작 시 세션 인벤토리 초기화(tap이 재등록하며 수렴). 프레임의 영구 보존은 설계 범위 밖.
- `tool_execution_update`(부분 출력)는 v1 어휘에 프레임이 없어 관찰만 하고 미전송 — started/ended 쌍으로 카드 표현.
