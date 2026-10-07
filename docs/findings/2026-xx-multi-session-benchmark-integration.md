# multi-session 벤치마크 런 통합 기록 — 2026-xx

범위: run `multi-session-followup`의 진단·수정·벤치마크·UI 가시화·ADR 결과 통합. 근거 문서는 [`진단`](2026-xx-multi-session-same-folder-diagnosis.md), [`real-provider 벤치마크`](2026-xx-benchmark-agents-real-providers.md), [`attention 자동 해소 ADR`](../decisions/2026-xx-attention-agent-auto-resolution.md).

## 진단 — 같은 폴더 다중 세션/런 충돌 지점

정적 조사 + 오프라인 계약 테스트로 6개 지점을 식별했다(상세는 진단 문서): tap Unix 소켓 경로 탈취(높음), SQLite writer 직렬화·busy 5초(중간), 실행 리스 만료 경계 대기(중간), 공유 파일·worktree 격리 부재(중간), HTTP 포트·runtime record 경쟁(중간), cwd 기반 attention 바인딩 모호성(낮음). 실제 동시 유료-provider 실행 관측은 없었다.

## 수정 — 확정·검증된 것

| 항목 | 내용 |
| --- | --- |
| tap 소켓 소유권(진단 최상위 지점) | `packages/gateway/src/session-collector.ts`가 기존 소켓을 unlink하지 않고 fail-closed로 `Session socket already exists`를 던진다. 진단의 구조적 선택 A(단일 소유자)의 소켓 축을 채택. `tests/multi-session-same-folder.test.ts`가 수정된 계약(두 번째 gateway 시작 실패 + 첫 소켓 접속 유지)을 고정 |
| 계층 import 방향 위반 | `apps/loop-mobile/src/ui/followScroll.ts`의 ui→state import가 D-B 결정 위반 → 순수 follow 머신(`nextFollowState`, `AUTOSCROLL_BOTTOM_EPSILON`)을 ui로 이동, state는 도메인 projection만 유지 |
| benchmark fixture normalize | `docs/benchmarks/agent-comparison-fixture/src/normalize.ts` 스텁을 실제 구현(trim·공백 축약·타이틀 케이스)으로 교체해 루트 `bun run check`를 green으로 복구 |
| 부수 복구 | 동시 작업자가 남긴 `RunScreen.tsx` 식 위치 JSX 주석 구문 오류를 의도 보존해 수정 |

증거: `bun run check` exit 0(아래 재현 포함), `bun test packages` 973 pass.

## 벤치마크 — real providers

같은 fixture 커밋에서 4트라이 전부 완주: zai glm-5.3-flashx 2/2(25,187·27,624 ms), openai-codex gpt-6.1-sol:minimal 2/2(44,029·48,981 ms), 기준 1/1 검증, scope 위반·worker 실패·verification 실패·attention 0. 비용 미측정. 이 결과는 fixture 규모의 동작 증명일 뿐 일반 agent 품질 판정이 아니다.

## UI 가시화 — 왼쪽 패널

`packages/pi-loop/src/ui/dashboard.ts`의 `DashboardOverlay`가 `AttentionList`·`TaskCard`·`ProgressLine`과 presentation status 렌더러를 조합해 실행 중 run/task, attention 항목, 빈 상태(noRuns/attentionOk)를 이미 렌더링했다. 남은 공백은 `loop-dashboard` 커맨드 배선뿐이었고, 신규 `packages/pi-loop/test/dashboard-command.test.ts` 3개(오버레이 호스팅·활성 run 필터·stale 스냅샷 무시·빈 상태·비-TUI 경고)로 증명해 제품 코드 변경 없이 완료했다.

## ADR — attention agent 자동 해소

`docs/decisions/2026-xx-attention-agent-auto-resolution.md` 채택: `Failure`는 지시 어휘 내 자동 해소(retry → corrective add_task → relax_routing → 승격, cancel 금지), `Question`/`Decision`/`Conflict`는 durable 계약만으로 답이 나올 때 조건부 허용, `Approval`과 run-level 실패는 사람 전용. 위험 통제는 attention당 자동 예산 2회·corrective 2개 한도, provenance 기록, 최후 인간 게이트. 전면 자동화 대안 C는 거짓 완료·비용 폭주·수용 기준 침해로 기각. 라우팅 실패 축은 `auto-relax-routing-policy` 작업으로 부분 선구현됐다(core `relax_ladder` + 오케스트레이터 예산 16).

## 남은 한계

- **미수정 트레이드오프**: 진단 6개 지점 중 소켓만 수정했다. SQLite busy 발생률 미계측, 리스 만료 경계 대기, 같은 cwd 공유 파일·worktree 충돌 격리 부재, 포트·runtime record 경쟁, cwd 기반 attention 다중 후보 노출은 미해결. A안(단일 gateway 소유자) 운영 계약 명문화와 worktree 정책이 후속 과제다.
- **provider 미설정 대기**: 벤치마크 재현은 로컬 provider 인증(zai·openai-codex)에 의존한다. 인증이 없는 환경·머신에서는 real-provider 재실행이 불가하며, `config/models.toml`을 `--config`로 명시해야 한다.
- **검증 한계**: 오프라인 테스트는 계약을 고정할 뿐 사용자가 관측한 실제 두 프로세스 장애를 재현·증명하지 않는다.
- **flake**: `packages/orchestrator/test/criteria-self-heal.test.ts` 3개가 부하 하 1회 일시 실패(단독·재실행 통과). 재발 시 타이밍 의존 제거가 필요하다.
- **ADR 후속 미구현**: `AttentionResolution` provenance 필드+codegen, 예산 정책의 라우팅 외 확장, attention 상세 해소자 표시.

## 재검증 증거

- `bun run check` — exit 0 (codegen:check·lint·typecheck·architecture·전체 테스트)
- `bun test tests/multi-session-same-folder.test.ts` — 1 pass, 0 fail
