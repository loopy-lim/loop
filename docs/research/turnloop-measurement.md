# Turnloop profile — small real-model measurement (M-TL4)

- **Date:** 2026-09-26
- **Kind:** real-provider evidence for M-TL4 of `docs/decisions/2026-xx-own-turn-loop-and-subagent-steering.md`
- **Scope read:** `config/**`, `docs/research/turnloop-profiles.md`, `packages/providers/src/**`, `packages/turnloop/**`
- **Changed:** `docs/research/turnloop-measurement.md` (이 문서) — 리포 코드 변경 없음
- **별도 증거 분리 선언:** 이 문서의 수치는 **real-provider 전용 증거**다. 단위·마일스톤 테스트는 계속 `FakeModelClient`/`FakeProvider`만 사용하며, 어떤 테스트도 이 실측에 의존하지 않고 어떤 실측도 테스트 요구사항이 아니다.

## 0. 운영자 승인 유료 구간 (disclosure)

- 총 **유료 모델 요청 3회**, 전부 소형 프롬프트(한 줄 산술 태스크), 전부 운영자 승인 레인:
  - turnloop 프로파일 경유 2회 (`openai-codex/gpt-6-luna`, ChatGPT 네이티브 로그인 — smoke evidence OK-LUNA-PI 레인과 동일 자격 경로)
  - pi lane 비교 1회 (동일 모델·자격 경로, `pi -p` 헤드리스)
- 합계 비용 ≈ **$0.000175** (아래 표의 provider 보고 cost 합계).
- credential=[redacted] — bearer 토큰은 `pi auth print-bearer-token`으로 스크립트 메모리에만 존재했고 로그·문서·영속화 어디에도 기록되지 않았다.
- 측정 드라이버는 리포 밖 스크래치(`/tmp/m-tl4/`)로, **루프 본체는 리포의 `packages/turnloop/src/engine.ts`를 그대로 임포트**해 실행했다. 가짜 경계(ModelClient)만 실제 pi-ai `openai-codex-responses` 클라이언트로 교체했다 — 단위 테스트와 동일 코드 경로, 클라이언트만 실공급자.

## 1. 태스크 (양 레인 공통 형식)

`17 * 23`을 계산해 한 줄 `product=<number>`로 답한다. 정답은 `product=391`. 도구 의존이 없고 출력이 수 토큰이라 토큰·벽시계 시간의 노이즈가 최소다.

## 2. 측정값 (provider 보고 usage 기준)

| run | 프로파일 | 결과 | turns | tool calls | 모델 요청 | input tok | output tok | (reasoning) | wall time | cost |
|---|---|---|---|---|---|---|---|---|---|---|
| TL-1 | turnloop | `product=391` ✓ completed | 1 | 0 | 1 | 48 | 30 | 21 | 5,480 ms | $0.0000198 |
| TL-2 | turnloop | 미응답 거절 (§4) | 1 | 0 | 1 | 67 | 199 | 182 | 6,680 ms | $0.0001062 |
| PI-1 | pi lane (`pi -p`, `--no-tools`) | `product=391` ✓ | 1 | 0 | 1 | 453 | 7 | 0 | 5,060 ms | $0.0000488 |

- TL-1 이벤트: `turn_start=1, assistant_text=1, turn_end=1` — 루프 이벤트 스트림·트랜스크립트·`TurnLoopOutcome.completed{finalText, turns, toolCallCount, messages}` 매핑이 실공급자에서도 동작했다.
- TL-1 turn usage 상세: `stopReason=stop`, cacheRead/cacheWrite 0 (단발 요청이라 프롬프트 캐시 없음).
- thinking level: 양쪽 모두 `low` (turnloop 드라이버 `reasoningEffort: "low"`, pi lane `:low` 패턴).
- 모델 요청당 벽시계 시간은 세 run 모두 ~5–7 s로 모델 추론 지배. 프로파일 오버헤드(루프·어댑터)는 측정 해상도에서 무의미한 수준.

## 3. turnloop vs pi lane 비교 (같은 소형 태스크)

| 항목 | turnloop | pi lane |
|---|---|---|
| input 토큰 | 48 | 453 |
| output 토큰 | 30 | 7 |
| wall time | 5.48 s | 5.06 s |
| 시스템 프롬프트 | 루프 고정 한 문장 (`DEFAULT_SYSTEM_PROMPT`) | pi 코딩 에이전트 preamble (도구 비활성 상태에서도 수백 토큰) |

- 해석: 소형 태스크에서 turnloop의 최소 시스템 프롬프트는 input 토큰을 ~10× 줄인다(453→48). 단, 이 것은 pi preamble 전체를 끄는 극단 비교이며, pi lane이 도구·컨텍스트 파일을 쓰는 실제 워커 용도와는 절충점이 다르다. output 토큰 차이(30 vs 7)는 turnloop run의 reasoning 21토큰이 output에 포함되기 때문(openai-codex 보고 방식).
- 공정성 한계: 프롬프트 문안이 run별로 약간 다르고(강제 문구 유무), pi lane은 `--no-tools --no-session`으로 최소화했다. 수치는 규모 감각용이며 계층 벤치마크가 아니다.

## 4. TL-2에서 발견된 스크래치 드라이버 결함 (리포 코드 결함 아님)

TL-2는 모델에게 도구 호출을 강제했으나 모델이 "도구를 부를 수 없다"고 답했다. 원인: 스크래치 어댑터가 pi-ai `Context`(systemPrompt/tools shorthand)를 `stream()`에 그대로 넘겼는데, `openai-codex-responses` 경계는 정규화된 `TranscriptContext`를 기대한다 — `normalizeContext()`(`pi-ai/dist/utils/transcript`)가 systemPrompt/tools를 선행 system 메시지로 접어야 도구 선언이 요청에 실린다(TL-2 input 67토큰은 도구 스키마 미포정과 일치).

- **의의:** 리포의 turnloop 소스(`packages/turnloop/**`) 결함이 아니라, 실제 ModelClient 어댑터 구현 시 반드시 거쳐야 할 경계를 특정했다. M-TL4 후속(리포 안의 실제 클라이언트 배송 + `turnloopWorker` 훅 연결, `docs/research/turnloop-profiles.md` §7)의 구현 체크리스트에 추가할 것: **pi-ai로 요청을 보내는 ModelClient는 `normalizeContext`를 통과시켜야 한다.**
- 도구 호출 경로(two-item 패턴의 실공급자 수용)는 이번 실측에서 미측정 — 호출 상한(1–2회)을 지키기 위해 TL-2에서 중단했다. 결론: 실공급자 tool round-trip 증거는 여전히 열려 있으며, 그 사이 이 경로는 `FakeModelClient` 스크립트 턴으로만 결론적으로 검증됨(`packages/turnloop/test/capability.test.ts`).

## 5. 증거 재현 (자격증명 비포함)

```
# turnloop run (스크래치 드라이버, 루프 엔진은 리포 것을 임포트)
bun /tmp/m-tl4/run-turnloop.mjs     # → 위 TL-1 JSON
bun /tmp/m-tl4/run-turnloop2.mjs    # → 위 TL-2 JSON

# pi lane 비교
pi -p --mode json --no-tools --no-session --no-extensions --no-skills \
  --no-prompt-templates --no-context-files \
  --provider openai-codex --model "openai-codex/gpt-6-luna:low" \
  "Compute 17 * 23. Reply with one line: product=<number>"
# message_end.usage: input=453 output=7 cost.total=4.88e-05
```

두 드라이버 모두 bearer 토큰을 stdout에 쓰지 않으며, 측정 JSON에는 모델 id·usage·이벤트 수만 담긴다.

## 6. 남은 것 / 리스크

- **실공급자 tool round-trip 미측정 (§4):** normalizeContext 수정 후 1회 재측정이 필요하나, 이번 승인 구간의 호출 상한(1–2회)을 소진해 수행하지 않았다. 다음 승인 구간 1회로 충분하다.
- **샘플 수 n=1 (프로파일당):** 본 실측은 "동작한다 + 규모 감각"의 증거이지 성능 분포의 증거가 아니다. 캐시 히트·재시도·긴 트랜스크립트에서의 거동은 미측정.
- **실제 ModelClient 리포 배송 여부:** 이 실측은 스크래치 어댑터로 수행됐다. `packages/turnloop`에 실제 클라이언트를 배송하는 것(및 `providers.toml` `[providers.turnloop]` 블록, orchestrator `turnloopWorker` 훅 기본 바인딩)은 여전히 M-TL4 후속 과제로 열려 있다(ADR §7과 동일).
