# 정리 트리거, 보존 규칙, 안전 계약

> 2026-09-22 안정화 개정: 아래 D3.5의 "purge와 teardown은 서로를 막지 않는다"는 규칙은 [그래프 실행 안정화 설계](../superpowers/specs/2026-09-22-reliable-graph-interventions-design.md)의 안전 계약으로 대체한다. 외부 정리가 실패하거나 상태가 불확실하면 실행 기록을 보존한다. 아래 본문은 최초 결정의 이력이다.

- **일자:** 2026-09-22
- **검증:** 2026-09-22, research pass 6 기준 재확인 — 라벨 파생(`herdr-agent.ts:73` → `client.ts:82-92,291-297`), `assertWorktreeInsideProject`의 빈 relative 경로 미거부(`worktree.ts`), `AttentionKind` variant 존재(`crates/loop-core/src/attention/attention.rs:10`), 빈 `crates/loop-core/src/herdr/`, `config/policy.toml` 내 `[retention]` 부재를 코드로 대조 확인
- **상태:** 결정됨; 구현은 후속 작업
- **결정 종류:** `decision`
- **의존성:** [`docs/research/cleanup-inventory.md`](../research/cleanup-inventory.md), [`docs/research/herdr-teardown-surface.md`](../research/herdr-teardown-surface.md), [`docs/decisions/ui-output-limits.md`](../decisions/ui-output-limits.md)
- **읽기 범위:** `crates/loop-core/`, `crates/loop-store/`, `crates/loop-bridge/`, `packages/orchestrator/`, `packages/cli/`, `packages/herdr/`, `config/policy.toml`
- **쓰기 범위:** 이 결정 기록만. Rust 도메인 타입, 생성 protocol, SQLite 스키마, 어댑터 코드는 후속 구현 작업의 범위다.

## 배경 (Context)

정리 인벤토리 조사(`cleanup-inventory.md`, refresh pass 6 기준)에 따르면 Loop는 run 하나당 네 계열의 artifact를 남기지만, 오늘날 production 경로의 삭제는 전무하다. `DELETE FROM` 문이 Rust 계층에 하나도 없고, `HerdrWorkerRuntime.cleanup`은 테스트에서만 호출되며 `AgyPersistentProvider.disposeAll`은 호출자가 아예 없다(테스트조차 내부 `driver.dispose`를 직접 호출한다). Herdr workspace·pane은 무한히 쌓이고(pane clutter audit으로 실측), SQLite 행은 영구 누적되며, `workingDirectory` 파일은 전혀 회수되지 않는다.

동시에 정리는 위험한 동작이다. run 기록은 audit/event-sourcing의 원천이고, worktree에는 아직 merge되지 않은 작업 결과가 있을 수 있으며, `workingDirectory`가 `projectRoot`와 같아지는 현재 live 경로에서는 잘못된 삭제가 프로젝트 자체를 파괴할 수 있다. Herdr teardown 조사는 안전한 해제 동사(`workspace close`, `tab close`, `pane close`)와 cascade 규칙, 그리고 Loop가 caller 소유 surface를 닫아서는 안 된다는 제약을 확인했다.

결정해야 할 축은 넷이다: (1) 정리 트리거, (2) 보존 규칙, (3) 안전 계약, (4) `loop-core`의 provider 중립적 명명.

## 결정 (Decision)

### D1. 트리거 — 자동 해제와 명시적 정리의 이원 구조

artifact를 **"Loop가 재생성 가능한 것"과 "삭제 시 손실인 것"**으로 나누고, 트리거를 나눈다.

| 트리거 | 대상 | 근거 |
| --- | --- | --- |
| **자동 — terminal run 상태 도달 시** | `surface`(Loop가 만든 terminal surface), `process`(worker 프로세스) | Loop가 소유하고 재생성 가능하다. 남겨두는 것이 기본값이 되어서는 안 되는 clutter다. |
| **명시적 — `loop cleanup` 명령만** | `run_record`(SQLite 행), `worktree`(working directory) | audit 기록과 파일 내용은 삭제가 곧 손실이다. 자동 삭제는 데이터 손실을 조용히 상식화한다. |

- Orchestrator는 run이 `Completed`/`Failed`/`Cancelled`에 도달하면 **해제(teardown)**만 수행한다: Loop가 생성한 surface의 close, worker 프로세스/프로세스 그룹 dispose. Best-effort로 실패가 run 결과를 막지 않으며, 실패는 run 이벤트로 기록된다. caller가 제공한 surface(`input.caller`가 정의된 경우)와 lead pane은 절대 닫지 않는다.
- **보존 정리(purge)는 자동으로 실행되지 않는다.** `loop cleanup` 명시적 명령만 `run_record`와 `worktree`를 삭제하며, 이 명령은 **dry-run이 기본값**이다(D3).
- surface 식별자는 durable하지 않으므로, 비정상 종료 후 정리는 어댑터가 라벨로 재발견하여 수행한다. run workspace의 라벨은 `loop-<runId>`이고 worker tab 라벨은 여기서 파생된 `loop-<runId>-<taskId>-<attempt>`(sanitize 후 32자 초과 시 sha256 접미사)다. 라벨이 일치하지 않는 surface — 특히 caller가 만든 workspace — 는 해제 대상이 아니다.

### D2. 보존 규칙

기본 보존 규칙은 **"terminal run 최근 8개 보존, 그 이전만 삭제 가능"**이다. `config/policy.toml`에 단일 source of truth로 둔다:

```toml
[retention]
keep_runs = 8
```

`keep_runs`는 양의 정수로 검증되는 `LoopConfig.retention` 값이며, `--keep <N>`으로 실행별 우선 적용할 수 있다. 규칙표:

| 대상 (loop-core 클래스) | 실체 | 보존 규칙 | 허용 트리거 | 거부 사유 (`RefusalCode`) |
| --- | --- | --- | --- | --- |
| `run_record` | SQLite의 run별 행(`runs`, `tasks`, `events` 등 cascade 자식 전부) | 최근 `keep_runs`개의 terminal run 보존, 그 이전은 삭제 후보 | `loop cleanup --execute`만 | `run_not_terminal` — `Active`/`Attention` run은 절대 삭제하지 않는다 |
| `worktree` | run의 `workingDirectory`(projectRoot 내부) | **merge되고 clean한 worktree만** 삭제한다. 미병합 커밋 또는 변경 사항이 있으면 보존한다 | `loop cleanup --execute`만. 사용자가 attention을 해소한 뒤 재시도 | `worktree_unmerged`, `worktree_dirty` |
| `worktree` (경로 가드) | 삭제 경로 자체 | `projectRoot` 내부의 절대 경로만, `projectRoot`와 동일한 경로는 결코 삭제 대상이 아니다 | — | `path_is_project_root`, `path_outside_project` |
| `surface` | Loop가 만든 terminal surface(pane/tab/workspace) | terminal 상태 도달 시 자동 해제. caller 소유 surface는 영구 보존 | terminal run 상태(자동), 크래시 후 라벨 재발견 | `surface_not_owned` |
| `process` | worker 프로세스/프로세스 그룹 | terminal 상태 도달 시 자동 dispose. orphan은 orchestrator 종료 hook이 수거 | terminal run 상태(자동), 종료 hook | 없음 (best-effort) |
| `external_session` | provider CLI가 소유한 세션 저장소 | **Loop 범위 밖. 절대 삭제하지 않는다** | 없음 | `external_session` |
| 임시 디렉터리 | acceptance test temp (`loop-acceptance-*`) | 보존 규칙 대상이 아님. 생성 사이트에서 `finally`로 즉시 정리 | 해당 명령 실행 중 자동 | 없음 |

추가 불변식:

- `run_record` 삭제는 run 하나당 **단일 트랜잭션**으로 cascade 자식(`ON DELETE CASCADE`)을 포함해 원자적으로 수행한다. 이벤트 로그는 run 단위로만 생애를 가지며 부분 삭제하지 않는다. `attention` 행도 run 단위 생애를 공유한다 — attention id가 runId 범위로 발급되어 run마다 누적되고 별도 제거 경로가 없음이 조사(pass 5)에서 확인됐으므로, cascade 자식으로서 run과 함께 정리되고 열린 attention은 `run_not_terminal` 거부로 보호된다. WAL 모드이므로 삭제 후 `PRAGMA wal_checkpoint(TRUNCATE)`를 고려한다.
- `external_session`은 resume이 가능한 동안 절대 삭제 대상이 아니며, 삭제는 전적으로 해당 CLI의 소유다.

### D3. 안전 계약

1. **경로 가드는 Rust가 결정하고 어댑터가 실행한다.** 어댑터는 파일시스템 접근이 필요한 canonical 경로 해석(symlink 포함)만 수행하고, 해석된 절대 경로가 projectRoot 내부인지, `projectRoot`가 아닌지의 판정은 Rust 순수 함수가 한다(`loop-core`는 파일시스템에 의존하지 않는다). 기존 `assertWorktreeInsideProject` 불변식을 Rust 정책으로 흡수한다. 참고로 현행 불변식은 `worktree == projectRoot`(빈 relative 경로)를 거부하지 않으므로, `path_is_project_root` 거부는 기존 검사의 이식이 아니라 추가 강화다 — 그래서 현재 live 경로(`workingDirectory = projectRoot`)가 성립하는 것이다.
2. **dry-run이 기본값이다.** `loop cleanup`은 인자 없이 실행하면 `PurgePlan`(삭제 후보와 거부 사유)만 출력하고 아무것도 바꾸지 않는다. 실제 삭제는 `--execute`가 필요하다. `--run <id>`로 단일 run을, `--keep <N>`으로 보존 수를 우선 적용할 수 있다.
3. **거부는 조용히 건너뛰지 않고 attention으로 올라온다.** 모든 거부는 typed `RefusalCode`를 갖는다. 사람의 판단이 필요한 거부(`worktree_unmerged`, `worktree_dirty`)는 `AttentionKind::Decision`, 환경이 막는 거부(`path_outside_project`, `path_is_project_root`, `surface_not_owned`)는 `AttentionKind::Failure`로 매핑되어 기존 attention 분류로 렌더링된다. `AttentionKind`에 새 variant를 추가하지 않는다. 렌더링은 출력 한도 정책(attention 6줄, findings 5줄, status 8줄)을 그대로 따른다.
4. **멱등성.** 이미 사라진 artifact는 오류가 아니라 ok("already gone")다. cleanup은 재실행 가능해야 한다. 어댑터의 `HerdrWorkerRuntime.cleanup`은 이미 `not_found`/`not_running`을 정상 처리하는 것으로 조사(pass 6)에서 확인됐으므로, 이 불변식은 신규 구현이 아니라 기존 어댑터 동작의 일반화다.
5. **자동 해제의 실패는 치명적이지 않다.** surface close/dispose 실패는 run 이벤트에 기록되고 다음 `loop cleanup` 실행 시 재시도 대상이 된다. purge와 teardown은 서로를 막지 않는다.
6. **자격 증명 불변.** 정리 경로는 새로운 비밀값을 읽거나 로그에 싣지 않으며, 기존 redaction 정책을 그대로 적용받는다.

### D4. `loop-core`의 provider 중립적 명명

`loop-core`·`loop-store`·`loop-bridge`는 정리를 다음 이름으로만 다룬다: `RetentionPolicy`, `PurgePlan`, `PurgeAction`, `CleanupRefusal`, `RefusalCode`, artifact 클래스 `run_record` / `worktree` / `surface` / `process` / `external_session`. **`herdr`, `pi`, `codex`, `agy`, provider, endpoint 토큰은 금지다.** "surface"는 호스트가 제공하는 terminal 표면의 총칭이며, `packages/herdr` 어댑터가 surface를 workspace/pane/tab으로 번역한다. "worktree"는 git 용어이므로 허용한다.

구현 순서와 경계:

1. Rust bridge 타입을 먼저 바꾸고 `bun run codegen`을 실행하며, 생성 파일을 Rust 변경과 함께 커밋한다.
2. 삭제 결정론(SQL 대상 선정, 보존 계산, 경로 판정, 거부 사유)은 `loop-store`/`loop-bridge`가 소유한다. TypeScript는 어댑터로서 파일시스템 삭제와 호스트 CLI 호출만 실행한다. TS에 손으로 쓴 SQL 삭제 쿼리를 두지 않는다.
3. `crates/loop-core/src/herdr/` 빈 디렉터리가 현재 존재한다. 구현 시 제거하고, architecture 테스트에 "loop-core 소스 트리에 provider 토큰 경로/식별자 없음" 회전 assertion을 추가한다.

## 결과 (Consequences)

**긍정.** terminal run마다 Loop가 만든 surface와 프로세스가 회수되어 pane clutter가 재축적되지 않는다. SQLite 성장이 bounded해지고, 삭제는 언제나 사전 계획(`PurgePlan`)과 거부 사유를 남기는 감사 가능한 동작이 된다. 미병합 작업은 삭제 대신 attention으로 사람에게 돌아온다. `loop-core`는 provider 중립성을 유지하며, Herdr 교체 시 정리 정책은 그대로 남는다.

**절충.** 보존 정리는 수동이다 — 사용자가 `loop cleanup --execute`를 실행하기 전까지 `run_record`는 무한히 쌓인다. 이는 허용된 절충으로, 자동 purge가 필요해지는 시점에도 같은 안전 계약(terminal 한정, dry-run 우선, 거부 시 attention)을 통과해야 한다. dry-run 기본값은 삭제까지 두 단계를 요구한다. 미병합 worktree는 자동 정리되지 않고 attention 대기열을 점유한다.

**후속 구현 항목 (이 ADR의 범위 밖):**

| 대상 | 변경 | 비고 |
| --- | --- | --- |
| `crates/loop-core` | `RetentionPolicy`, `PurgePlan`, `CleanupRefusal`, `RefusalCode`, 경로 판정 순수 함수; 빈 `src/herdr/` 제거 | provider 토큰 금지 |
| `crates/loop-store` | `delete_run`(원자 cascade), `purge_plan(keep_runs)` | 유일한 `DELETE` 소유처 |
| `crates/loop-bridge` | purge/teardown 명령 노출 | `bun run codegen` 후 생성 파일 함께 커밋 |
| `packages/orchestrator` | terminal 상태 도달 시 teardown hook, 종료 시 process dispose hook | best-effort, run 결과 비차단 |
| `packages/cli` | `loop cleanup [--dry-run(기본)|--execute] [--run <id>] [--keep <N>]` | 거부는 findings 양식(5줄), plan은 status 예산(8줄) 내 |
| `config/policy.toml` + `packages/orchestrator/src/config.ts` | `[retention] keep_runs = 8`과 `LoopConfig.retention` 검증 | 양의 정수 외 거부 |
| `tests/architecture-boundaries.test.ts` | loop-core의 provider 토큰 부재, TS 내 SQL 삭제 부재 assertion | `bun run test:architecture` |
| `packages/cli/src/main.ts` (`verifyInstall`) | temp 디렉터리 `finally` 정리 | 보존 규칙과 무관한 부수 결함 수정 |
