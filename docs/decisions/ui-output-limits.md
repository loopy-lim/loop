# 사용자 출력 줄 수 한도 정책

- **일자:** 2026-09-21
- **상태:** 결정됨; 구현은 후속 작업
- **결정 종류:** `decision`
- **의존성:** `config/policy.toml`의 정책 로더, CLI와 Pi Lead의 사람이 읽는 렌더러
- **읽기 범위:** `config/`, `packages/orchestrator/`, `packages/cli/`, `packages/pi-loop/`, `tests/architecture-boundaries.test.ts`
- **쓰기 범위:** 이 결정 기록만. Rust 도메인, 생성 protocol, SQLite 스키마, provider 설정은 범위 밖이다.

## 결정

사람에게 보여 주는 Loop 운영 출력은 하나의 `output` 정책에서 한도를 읽어 CLI와 Pi Lead에 똑같이 적용한다. 기본값은 status 8줄, attention 6줄, findings 5줄을 유지한다. graph, workers, doctor checks, models는 공통 목록 한도 8줄을 쓴다.

이 정책은 **논리 줄**의 한도다. 터미널 폭에 따른 줄바꿈 수를 보장하지 않는다. 동적 값의 CR/LF는 공백 하나로 정규화하고, 한 줄은 기본 160 Unicode grapheme까지 남긴 뒤 `…`로 끝낸다. 이 처리는 비밀값을 새로 노출하거나 redaction을 대체하지 않는다.

기계 소비용 JSON, `__execute-plan --stream`의 JSON Lines, Rust 이벤트/SQLite 상태, worker stdout/stderr는 이 정책의 대상이 아니다. JSON을 사람이 읽기 좋게 만든다는 이유로 잘라서는 안 된다. 오류·도움말·설치 검증의 고정 출력은 기존 별도 계약을 유지한다. 오류의 credential redaction과 4,000자 방어 한도도 별도 보안 정책이다.

## 최종 출력면 한도와 초과 규칙

공통 초과 규칙은 다음과 같다.

1. 입력 순서가 이미 의미 있는 경우 그 순서를 보존한다. 축약 헬퍼는 정렬하거나 도메인 상태를 고르지 않는다.
2. 목록이 한도를 넘으면 마지막 줄을 `… {omitted} more {noun}` 카운트 요약으로 예약한다. 즉 한도가 8이면 처음 7개와 요약 1개를, 한도가 5이면 처음 4개와 요약 1개를 보인다. 한도가 1인 유효 설정에서는 요약 한 줄만 보인다.
3. findings는 `BLOCK` 우선, 같은 severity 안에서는 입력 순서 보존이다. doctor checks는 실패 우선, 같은 결과 안에서는 입력 순서 보존이다. 이 두 우선순위는 렌더링 전에 각 어댑터가 명시적으로 적용한다.
4. 빈 목록은 한 줄의 안정된 빈 상태(`No active workers`, `No models configured`, `OK`)를 출력하며, 빈 목록 때문에 요약 줄을 만들지 않는다.

| 출력면 | 최종 한도 | 정상 출력 | 초과 시 축약 |
| --- | ---: | --- | --- |
| 기본 status 및 `cancel`/`resume` 뒤 snapshot | 8줄 | `Run`, `State`, `Tasks`, `Workers`, `Attention`을 우선 보존한다. 남은 3줄만 선택적 단계/진행 상세에 쓴다. | 선택적 상세가 남은 칸을 넘으면 마지막 남은 칸을 `… N more status lines`으로 쓴다. |
| `loop_run` 완료 summary | 8줄 | run/state/tasks/escalations/verification을 우선 보존한다. | 추가 상세는 status와 같은 규칙으로 축약한다. |
| 단일 attention 상세 | 6줄 | kind, summary, 선택지 최대 3개, 질문 순서다. | 각 동적 텍스트는 말줄임 처리한다. 선택지가 3개를 넘으면 마지막 선택지 슬롯을 `… N more options`로 바꾼다. |
| `loop attention` 열린 항목 목록 | 6줄 | 첫 줄은 `Attention: N open`, 나머지는 항목 ID다. | 5개를 넘으면 처음 4개와 `… N more attention items`을 보인다. |
| findings | 5줄 | 한 finding은 반드시 한 논리 줄이며 `BLOCK` 후 `FIX` 순서다. | 5개를 넘으면 처음 4개와 `… N more findings`을 보인다. 카운트 요약도 5줄 예산에 포함한다. |
| `loop graph` | 8줄 | task의 snapshot/DAG 입력 순서대로 한 task/edge를 한 줄에 보인다. | 처음 7개와 `… N more tasks`를 보인다. |
| `loop workers` | 8줄 | active worker snapshot 순서대로 한 worker를 한 줄에 보인다. | 처음 7개와 `… N more workers`를 보인다. |
| `loop doctor` checks | 8줄 | 첫 줄은 `Loop doctor`; 실패를 먼저, 그 다음 성공을 보인다. | 결과 6개와 `… N more checks (F failed, P passed)`를 보인다. 현재의 무설명 `slice(0, 7)`은 제거한다. |
| `loop models`와 Pi `/loop models` | 8줄 | compute class와 model ID를 한 줄에 보인다. | 처음 7개와 `… N more models`를 보인다. CLI의 사람이 읽는 기본 모델 출력은 pretty JSON이 아니라 이 목록 형식으로 맞춘다. |
| `loop_run` 시작 알림 | 2줄 고정 | `Run …`, `Starting … tasks` | 목록을 싣지 않으므로 별도 축약이 없다. |

## 설정 계약과 적용 범위

기존 `[attention]`은 status/findings까지 담아 의미가 넓고, 현재 `LoopConfig.attention` 값은 렌더러가 소비하지 않는다. 후속 구현에서 그 세 필드를 삭제하고 다음을 `config/policy.toml`의 단일 source of truth로 둔다.

```toml
[output]
status_line_limit = 8
attention_line_limit = 6
findings_line_limit = 5
list_line_limit = 8
line_text_limit = 160
```

`LoopConfig.output`은 위 다섯 값을 모두 양의 정수로 검증한 읽기 전용 presentation-policy 값이다. `list_line_limit`은 graph, workers, doctor checks, models에 공통 적용한다. 표의 개별 한도는 이 기본 설정을 전제로 하며, surface별 하드코딩 숫자를 다시 만들지 않는다.

| 소비자 | 정책 적용 | 전달 방식 | 적용하지 않는 것 |
| --- | --- | --- | --- |
| CLI | 사람용 `status`, `graph`, `workers`, `attention`, `doctor`, `models` | `configuration(parsed).output`을 renderer에 명시적으로 전달 | `--json`, stream JSON Lines, error/help/verify-install |
| Pi Lead UI | `loop_run` 진행 update·완료 result/notify, `/loop status|graph|workers|attention|models|cancel|resume` | extension 시작 시 같은 config directory에서 `output`만 읽는다. CLI의 `--config`는 child 환경의 `LOOP_CONFIG_DIR`로 전달한다. | backend JSON 호출 결과와 child worker stdout/stderr |
| Orchestrator runtime | typed config을 읽어 CLI/Pi 어댑터가 소비할 값을 제공할 뿐, 상태 전이·스케줄·completion verification에 사용하지 않는다. | `LoopConfig.output` | Rust domain/store/bridge/protocol에 출력 값 저장 또는 전달 |

`LOOP_CONFIG_DIR`에는 디렉터리 경로만 전달하며 provider credential 값은 전달하지 않는다. Pi를 CLI 밖에서 직접 시작한 경우에도 같은 config resolver의 기본 경로를 사용한다. 설정을 읽을 수 없으면 임의의 hardcoded fallback을 쓰지 않고 기존 config 오류로 실패시킨다.

## 공통 축약 헬퍼와 구현 경계

공통 헬퍼는 새 leaf adapter package인 `packages/presentation/src/compact.ts`에 둔다. `@loop/presentation`은 CLI와 `pi-loop`만 의존하고, orchestrator와 Rust/bridge/protocol에는 역의존을 만들지 않는다. 헬퍼의 입력은 이미 렌더링된 단일 줄 문자열과 숫자 한도뿐이다. 줄 정규화, grapheme 말줄임, 마지막 카운트 요약만 수행하고 provider, Pi, Herdr, model, task 상태, severity 같은 도메인 개념을 알지 않는다.

따라서 TypeScript는 얇은 presentation adapter로 남는다. `loop-core`는 출력면, terminal, CLI, Pi, provider, 또는 `OutputLimits`를 알지 않으며, policy 적용을 위해 Rust bridge 타입이나 생성 protocol을 변경하지 않는다. graph/worker의 도메인 순서와 run 상태는 기존 Rust snapshot이 계속 소유하고, 어댑터는 그것을 축약해 보여 줄 뿐이다.

| 대상 파일 | 변경 | 책임 | 추가/수정 테스트 |
| --- | --- | --- | --- |
| `config/policy.toml` | `[attention]`의 세 출력 필드를 `[output]` 다섯 필드로 교체 | 기본 정책값의 유일한 선언 | `packages/orchestrator/test/config.test.ts` fixture를 새 TOML로 갱신 |
| `packages/orchestrator/src/config.ts` | `LoopConfig.output`과 엄격 파서를 추가하고 옛 `attention` 출력 필드를 제거 | typed config 로드·양의 정수 검증만 수행 | `packages/orchestrator/test/config.test.ts`: 기본값, 각 0/음수/누락 거부, custom 값 보존 |
| `packages/presentation/package.json` (신규) | 의존성 없는 `@loop/presentation` leaf package 선언 | 공통 adapter helper의 소유 경계 | package resolution smoke를 `packages/presentation/test/compact.test.ts`에 포함 |
| `packages/presentation/src/compact.ts` (신규) | `OutputLimits`, 단일 줄 정규화/말줄임, 목록과 overflow summary 헬퍼를 export | 도메인 비의존 presentation 축약 | `packages/presentation/test/compact.test.ts` (신규): 8/6/5 경계, 1줄 edge case, CRLF, grapheme 말줄임, 정확한 omitted count |
| `packages/cli/package.json`, `packages/pi-loop/package.json` | 각 adapter가 `@loop/presentation`을 workspace dependency로 선언 | UI leaf가 orchestrator 쪽으로 역류하지 않게 함 | `bun run typecheck`와 package import smoke |
| `packages/cli/src/main.ts` | `formatSnapshot`, `doctor`, 사람이 읽는 `models`가 `config.output`과 공통 helper를 사용하도록 분리; Pi child에는 `LOOP_CONFIG_DIR`만 주입 | CLI presentation adapter 및 config-directory 전달 | `packages/cli/test/cli.test.ts`: 모든 human surface의 경계/overflow, 실패 우선 checks, JSON 미축약, `--config` 전달 |
| `packages/pi-loop/src/extension.ts` | private `renderSnapshot`/`formatRunSummary`를 정책 주입 가능한 UI renderer 호출로 교체 | Pi notify/result 경로를 단일 renderer로 연결 | `packages/pi-loop/test/lead.test.ts`: update, notify, tool result가 같은 한도를 쓰고 config 오류를 숨기지 않음 |
| `packages/pi-loop/src/ui/status.ts`, `attention.ts`, `graph.ts`, `worker.ts`, `summary.ts` | 각 renderer가 공통 helper와 주입된 limits를 사용하게 하고, extension과 중복된 숫자를 제거 | Pi-specific 표현만 결정 | `packages/pi-loop/test/ui.test.ts`: status 8, attention 6, findings 5, graph/workers/models overflow summary, 160-grapheme line |
| `packages/pi-loop/src/lead/reduce.ts` | findings의 `BLOCK` 우선 stable ordering은 유지하되 숫자 `5`는 주입된 `findingsLineLimit`으로 교체 | review finding의 이미 정의된 화면 우선순위 | `packages/pi-loop/test/ui.test.ts`: 동률 stable ordering과 4+summary overflow |
| `tests/architecture-boundaries.test.ts` | `loop-core` source에 `OutputLimits` 또는 rendering helper가 들어오지 않고, presentation package가 provider/Pi/Herdr를 import하지 않는 회귀 assertion을 추가 | core의 provider/UI 중립성과 adapter leaf 유지 | `bun run test:architecture`에 포함 |

후속 구현은 Rust bridge type을 먼저 바꾸거나 `bun run codegen`을 실행할 일이 없다. Rust domain 형식이 바뀌지 않기 때문이다.

## 수용 기준과 검증

- 모든 사람이 읽는 표 대상 출력면은 입력 항목 수와 무관하게 해당 논리 줄 한도를 넘지 않는다.
- 초과하면 마지막 줄에 정확한 omitted count가 있으며, 조용히 `slice()`로 항목을 잃지 않는다.
- 기본 config의 값은 8/6/5/8/160이고, custom config는 CLI와 Pi에서 동일하게 반영된다.
- `--json`과 stream JSON Lines는 전체 원문 레코드를 유지한다.
- `loop-core`, `loop-store`, `loop-bridge`, generated protocol에는 이 출력 정책 타입·문자열·의존성이 추가되지 않는다.
- 구현 후 `bun run check`와 `bun run test:architecture`를 실행한다. 이는 offline evidence이며 실제 Pi 화면 폭이나 provider 호출 증거는 아니다.

## 근거

- 현재 정책 값 5/8/6은 `config/policy.toml`과 `packages/orchestrator/src/config.ts`에서 파싱되지만 CLI/Pi renderer에는 전달되지 않는다. 상세 감사: [`docs/audits/cli-policy-inventory.md`](../audits/cli-policy-inventory.md), [`docs/audits/pi-loop-output-inventory.md`](../audits/pi-loop-output-inventory.md).
- 현재 CLI와 Pi extension은 graph/workers/attention에 서로 다른 hardcoded slice를 쓰고, Pi models와 exported graph renderer에는 unbounded 경로가 있다. 이 결정은 그 drift를 하나의 config와 helper로 제거한다.
- 기존 architecture test는 core의 provider/Pi/SQLite 경계를 검증한다. 이 결정은 그 경계를 출력 policy에도 확장할 뿐 core의 책임을 늘리지 않는다.
