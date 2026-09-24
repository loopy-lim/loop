# ZAI 쿼타 소진 시 worker 라우팅

상태: 구현 및 전체 검사 통과. 단, run attention은 미완료로 표현하지만 완료 DAG가 최초 intent의 모든 인수 조건을 충족했는지 별도 coverage로 증명하지는 않는다.

## 근거와 결정

Lead 모델과 worker 선택은 독립이다. 예시 설정의 Lead는 `openai-codex/gpt-6-sol`이며 구체 모델 ID, endpoint 및 순위 값은 설정에만 둔다. Worker는 요구 capability/compute class를 만족하는 후보 중 설정 비용·지연시간 순으로 선택한다. ZAI 후보의 설정 순위를 비-ZAI보다 높여 ZAI가 가용할 때 우선 선택하며, provider ID 정렬 하드코딩은 사용하지 않는다.

실행 중 분류된 quota/rate-limit 실패에서는 실패 후보 및 동일 quota pool 후보를 제외하고 Rust 선택 정책으로 유한하게 재선택한다. 실패 worker의 cleanup 후 전환하며, 후보 소진 시에만 attention을 기록한다. 인증·일반 실패·불확실한 startup·cleanup 실패를 quota fallback으로 위장하지 않는다. 다음 작업이나 회복 후에는 ZAI 후보를 다시 평가해 설정 순위대로 선택한다. 재시도 횟수는 후보 수에 한정하고 timer 기반 무한 재시도는 두지 않는다. Worker 성공은 기존 completion check 통과 후에만 확정한다.

대안 (a) provider ID 순서로 ZAI 우선은 설정 정책을 우회하므로 기각했다. (b) quota를 즉시 최종 실패로 기록하고 scheduler retry에 맡기는 방식은 같은 ZAI 반복 선택과 불필요한 attention 위험 때문에 기각했다. 선택안은 Rust의 결정 정책을 유지하고 TypeScript는 실패 분류, 후보 매핑 및 worker lifecycle만 담당한다.

## 변경 위치

- `config/providers.example.toml`, `config/models.toml`: Lead 및 worker 후보 설정.
- `packages/providers/src/registry.ts`: 설정된 비용·지연시간과 제외 후보를 선택 정책에 전달.
- `packages/orchestrator/src/task-execution.ts` 및 `coordinator.ts`: quota 분류, 제한된 후보 재선택, cleanup 및 durable 결과 기록.
- `packages/pi-loop/src/extension.ts`, `lead/prompts.ts`, `ui/summary.ts`: 부분 완료/attention을 완료로 표현하지 않고 후속 경로 표시.
- `crates/loop-core`의 provider-neutral routing 정책 유지. Rust bridge 타입 변경 및 codegen 변경은 불필요했다.

## 인수 조건과 회귀 증거

- Lead `gpt-6-sol`: 설정에 `openai-codex/gpt-6-sol`로 지정. 전체 `bun run check`에서는 기존 CLI 테스트가 옛 Lead를 기대해 실패하므로 통합 전체 pass는 아니다.
- ZAI 가용 시 worker 우선 및 compute 제약 유지: `packages/orchestrator/test/milestone.test.ts`의 설정 기반 후보 선택 테스트와 `packages/providers/test/adapters-v2.test.ts`의 metadata 전달 테스트.
- quota 시 유한 fallback, cleanup, 후보 소진 attention, 회복 후 ZAI 재선택: `packages/orchestrator/test/interventions.test.ts`의 fake-provider lifecycle 통합 사례.
- attention을 완료로 오인하지 않고 후속 안내: `packages/pi-loop/test/lead.test.ts`의 completed/attention 분기 테스트 통과. 단, UI의 Remaining은 일반 안내이며 개별 미완료 인수 조건 목록은 아니다.
- 부분 DAG 완료와 최초 목표 완료의 구분: 미보장. `packages/pi-loop/src/ui/summary.ts`는 run의 `completed`만으로 `Goal: complete`를 표시한다. Prompt는 모든 인수 조건의 DAG 매핑을 요구하지만, 누락된 인수 조건을 기계적으로 판정하는 증거는 없다. 따라서 attention 안내 통과를 최초 목표 완료 보장으로 확대 해석하지 않는다.

검증 결과: `bun run codegen:check` exit 0. `bun run check` exit 1. codegen, typecheck, architecture(6/6), Rust 테스트/build 및 다수의 Bun 테스트는 통과했으나 Bun 테스트 333 pass / 4 fail (1396 assertions). 실패 네 건은 `packages/cli/test/cli.test.ts`의 interactive run, bare loop, doctor auth 테스트가 예전 `zai/glm-5.3-flashx` Lead를 기대하고, models 목록 테스트가 16개를 기대하는데 현재 설정은 `openai-codex/gpt-6-sol` 및 18개 모델을 제공하는 불일치다. 이 파일은 통합 작업 쓰기 범위 밖이어서 수정하지 않았다. 따라서 인수 조건별 회귀 테스트는 있으나 전체 check가 실패했으므로 완료를 주장하지 않는다. 인증 없는 테스트는 실제 provider 접속 성공이나 실제 quota 동작을 증명하지 않는다.

### 이번 통합 재검증 기록

기존 작업 트리는 보존했다. 의존 작업 요약과 실제 변경 및 테스트를 대조했으며, 원래 실패 run `loop-56dac737-72a9-4383-ad66-6a87ef748774`의 원본 로그는 이번 읽기 범위에서 확인하지 않았다. 원인 분석은 registry의 ranking 누락 및 실행기의 quota 최종 실패 경로에 대한 코드·fake-provider 재현 근거이며, 그 run의 직접 관측 증거는 아니다.

| 인수 조건 | 결과 | 증거/제한 |
| --- | --- | --- |
| Lead `openai-codex/gpt-6-sol` | PASS (설정) | config 로딩 assertion; 실제 인증·모델 가용성 미검증 |
| ZAI 가용 시 worker 우선 | PASS (오프라인) | 설정 기반 tiny/fast/balanced 선택 및 composition ranking |
| quota 시 유한 타 provider fallback | PASS (오프라인) | cleanup 순서, 동일 pool 제외, 후보 소진 attention, auth/cleanup/cancel 경계 |
| 회복 후 ZAI 재선택 | PASS (오프라인) | 다음 의존 task에서 ZAI 재선택, scheduler attempt 유지 |
| attention 시 미완료 표시와 재개 안내 | PASS | Lead tool 결과의 incomplete/Remaining/attention/resume assertion |
| 부분 완료를 최초 목표 완료와 구분 | 미충족 | completed run을 Goal: complete로 표시; 개별 목표 coverage 검증 없음 |
| 전체 회귀 검증 | FAIL | CLI 테스트 4건 기대값 불일치 |

직접 실행 결과:
- `bun test packages/orchestrator/test/config.test.ts packages/orchestrator/test/milestone.test.ts packages/orchestrator/test/interventions.test.ts packages/pi-loop/test/lead.test.ts packages/providers/test/adapters-v2.test.ts`: exit 0, 80 pass / 0 fail, 268 assertions. 로그: `/tmp/loop-integration-acceptance.log`.
- `bun run check`: exit 1, Bun 333 pass / 4 fail, 1396 assertions. 로그: `/tmp/loop-integration-full-check.log`.
- `bun run codegen:check`: exit 0. 로그: `/tmp/loop-integration-codegen-check.log`.

후속 위임에는 `packages/cli/test/cli.test.ts` 기대값 갱신 권한과 부분 DAG/최초 목표 완료 구분을 위한 UI·계약 검토 범위를 포함해야 한다. 현재 쓰기 범위 밖의 구현을 임의 변경하거나 설정을 되돌려 검증을 통과시키지 않았다. 최초 목표 완료를 주장하지 않는다.

### attempt=2 재검증

동일 작업 트리의 의존 작업 diff와 기존 회귀 assertion을 다시 대조하고 아래 명령을 직접 실행했다. 이번 시도에서는 이 문서만 갱신했으며 기존 코드와 테스트 변경을 보존했다. 기존 테스트가 이미 설정·선택·quota lifecycle·attention 문구를 검증하므로 중복 테스트는 추가하지 않았다.

- 핵심 인수 조건 테스트 5개 파일: exit 0, **80 pass / 0 fail**, 268 assertions. `/tmp/loop-integration-attempt2-acceptance.log`.
- `bun run check`: exit 1, **333 pass / 4 fail**, 1396 assertions. codegen, TypeScript, architecture 및 Rust 테스트/build 단계는 통과했고 CLI 기대값 불일치 4건은 그대로다. `/tmp/loop-integration-attempt2-full-check.log`.
- `bun run codegen:check`: exit 0. `/tmp/loop-integration-attempt2-codegen-check.log`.
- `git diff --check`: exit 0.

인수 조건별 판정은 위 표와 동일하다. 특히 attention의 일반적인 미완료 표시와 재개 안내만 PASS이며, **개별 미완료 인수 조건 명시와 부분 DAG 완료/최초 목표 완료 구분은 미충족**이다. 현재 Lead 테스트의 `Goal: complete` assertion은 completed run의 출력만 확인하며 최초 intent 전체 충족의 증거가 아니다. 원본 실패 run 로그와 실제 인증 provider 접속은 확인하지 않았다.

후속 설계 대안은 (a) UI가 run 완료만 보고하고 최초 목표는 검증되지 않았다고 보수적으로 표현하는 최소 수정, (b) 최초 인수 조건과 검증 증거의 coverage를 Rust 도메인/bridge에 명시하고 UI가 그 판정을 표시하는 확장이다. 개별 미완료 조건의 기계적 추적까지 요구하면 (b)의 계약 설계와 codegen 변경이 필요하다. 이번 통합 재검증에서는 현재 코드가 run attention/paused/cancelled를 `Goal: incomplete`로 명시하고 completed와 분리하는 테스트를 확인했다. 다만 completed DAG에 대한 acceptance-criteria coverage 계약은 여전히 없으므로, 그보다 강한 최초 intent 완료 보증은 범위 밖의 잔여 리스크다.

### 최종 통합 확인

- `bun run check`: PASS, exit 0. codegen, typecheck, architecture(6/6), Rust workspace tests/build, Bun **337 pass / 0 fail / 1405 assertions**.
- `bun run codegen:check`: PASS, exit 0.
- Lead `openai-codex/gpt-6-sol`: PASS — `config/providers.example.toml` 및 `packages/orchestrator/test/config.test.ts` 설정 assertion; CLI regression tests도 invocation 값을 확인.
- ZAI 우선, quota 시 제한된 fallback, exhausted/cleanup 처리 및 회복 시 ZAI 재선택: PASS (오프라인) — `packages/orchestrator/test/milestone.test.ts`, `packages/orchestrator/test/interventions.test.ts`, `packages/providers/test/adapters-v2.test.ts`; exhausted, recovered, cleanup, auth 경계 테스트 모두 통과.
- Attention/부분 실행을 완료로 표시하지 않음: PASS (attention 경로) — `packages/pi-loop/test/lead.test.ts`가 attention 결과의 `Goal: incomplete`, 미검증 원래 인수 조건, 후속 경로를 확인하고 `Goal: complete` 및 `Verification: passed`가 없음을 단언. **완료 DAG가 최초 intent의 모든 조건을 충족하는지 별도 coverage로 증명하는 계약은 미구현**이며 별도 위험으로 남는다.
- 변경 경로: 이번 최종 통합은 이 결정 문서만 갱신. 기존 미커밋 코드/테스트 변경은 그대로 보존했다.
- `bun run check`는 fake/offline 테스트 증거다. 인증된 실제 provider 연결, quota 소진 및 복구 동작은 별도 실접속 검증이며 여기서 수행하지 않았다.
