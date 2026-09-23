# Herdr 요약 redact 누락 검증 (P12 후속)

- Task: `fact-herdr-redaction` (research, attempt 0, 2026-09)
- Question: docs-drift P12 — herdr-agent.ts 성공/실패 요약 경로(208행, 222행 부근)와 @loop/herdr read() 체인에서 credential/secret이 redact 없이 반환되는가
- Method: 읽기 전용 정적 추적. 근거는 `file:line`. 유료 모델 호출 없음.

## Verdict: **CONFIRMED** (redact 누락)

`@loop/herdr` read() 체인 전체에 redact가 없으며, HerdrAgentProvider는 그 결과를 성공·실패 양 경로에서 가공 없이 WorkerResult.summary와 `final` 이벤트로 반환·발행한다. provider-support.md:18 "Secrets are redacted from summaries and streamed chunks" 계약을 유일하게 위반하는 어댑터 계열이다.

## 1. 누출 경로 (패스별 근거)

| # | 경로 | 근거 |
| --- | --- | --- |
| L1 | 성공 요약: `runtime.read()` 결과를 `.trim()`만 하고 그대로 반환 | herdr-agent.ts:208 → :219 `return { success: true, summary, ... }` — redact 호출 없음 |
| L2 | 성공 이벤트: 같은 raw 문자열을 `final` 이벤트로 구독자에게 발행 | herdr-agent.ts:218 `this.#emit(session, { type: "final", summary })` |
| L3 | 실패 요약: read() 결과 또는 fallback 문자열을 그대로 반환 | herdr-agent.ts:222-227 — redact 호출 없음 |
| L4 | read() 원천: herdr CLI stdout을 가공 없이 반환. 주석 자체가 "read prints the raw pane text" | client.ts:225-247 (`agent read --source recent-unwrapped` / `pane read`, :246 `return result.stdout`) |
| L5 | 프로바이더 내 유일한 redact 사용처는 start()의 catch 에러 메시지뿐 | herdr-agent.ts:118; :258-260 래퍼 |

**새는 문자열(요약 필드 경로):** worker pane 마지막 80줄(client.ts:225 기본 `lines = 80`) 전문이 (a) `WorkerResult.summary` — herdr-agent.ts:219, :227, (b) `ProviderEvent { type: "final", summary }` — herdr-agent.ts:218 로 그대로 흘러간다. worker CLI(codex/agy/pi)가 에코한 명령어·툴 출력에 `Authorization: Bearer …`, `api_key=…` 등이 포함되면 그대로 요약이 된다.

## 2. @loop/herdr 내부 확인 (drift report가 남긴 미확인 지점)

- redact 헬퍼는 존재하나 **오류 메시지 전용**: client.ts:565-572의 `redact()`는 `formatHerdrError`(client.ts:552-563, herdr CLI 비정상 종료 시 throw되는 에러)에만 적용된다. read() 성공 출력(:246)에는 미적용.
- 결론: read() 체인 어디에도 요약 redact가 없다 — P12의 "확인 필요한 잠재 결함"이 확정 결함으로 승격됨.

## 3. 기존 패턴 대조

- **ProcessProvider 계열(같은 패키지, 같은 계약)**: 청크 process-provider.ts:68 `redact(event.chunk)`, 기계 요약 :155/:157, final 이벤트 :169 `{ type: "final", summary: redact(summary) }` — 반환·발행 시점에 redact. HerdrAgentProvider만 이 패턴에서 이탈.
- **orchestrator redact 테스트 패턴** (packages/orchestrator/test/redact.test.ts:3-9): `Authorization: Basic …`, `authorization=Bearer …`, JSON authorization, `api_key=…`가 scrub되는지 검증. 동일 패턴으로 herdr-agent 요약 경로 테스트(스텁 runtime.read가 secret 포함 문자열 반환 → summary에 secret 부재 단언)를 작성하면 **오늘 기준 실패** — 이것이 이 판정의 기계 검증 재현 방법이다.

## 4. 하류 완화와 잔여 갭 (선언된 읽기 범위 밖, 참고 근거)

- orchestrator가 `recordWorkerResult` 직전 재redact (task-execution.ts:92) — 해당 소비 경로는 차단.
- 그러나 (a) 프로바이더 경계의 `WorkerResult.summary`/`final` 이벤트 소비자 전부에는 미치지 않고, (b) MirroringProvider의 `result()` 경로는 `[result] ${res.summary}`를 cleanLine(redact, mirror.ts:170) 없이 sink에 발행(mirror.ts:403-409 → composition.ts StoreActivitySink/PaneMirrorSink) — watch-feed 저장·pane 표시에 raw 요약 도달 가능. subscribe 렌더 경로(mirror.ts:63 + :170)만 redact됨.

## 5. 결론 (findings)

1. CONFIRMED — herdr-agent.ts:208/:222 요약 경로와 client.ts:246 read()가 raw pane 텍스트를 redact 없이 반환·발행; provider 계약(provider-support.md:18) 위반.
2. 유일 사내 완화는 orchestrator 하류 재redact뿐이며 mirror result() 경로는 그마저 우회 — 프로바이더 계층에서 차단 필요.
3. 수정 방향(하위 태스크용): :208/:222의 summary에 herdr-agent.ts:118과 동일한 `redact()`(redactProviderText) 적용 + redact.test.ts 패턴의 herdr 스텁 테스트 추가.

## 6. 한계

- 정적 분석 기반이며 실제 herdr CLI 실행·저장 포맷 검증은 포함하지 않음(evidence boundary 준수).
- orchestrator src/composition은 읽기 범위 밖이라 grep 발췌만 근거로 사용(§4 표기).
