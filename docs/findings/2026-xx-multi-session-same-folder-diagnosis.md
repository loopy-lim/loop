# 같은 폴더 다중 세션/런 진단

범위: 정적 소스 조사 및 오프라인 계약 테스트. 실제 동시 유료-provider 실행이나 사용자 환경의 장애 로그는 확보하지 못했다. 아래는 관측된 사용자 증상과 구분한 잠재 충돌 지점이다.

| 심각도 | 지점 / 근거 파일 | 판단 및 제안 수정 |
| --- | --- | --- |
| 높음 | tap Unix 소켓: `packages/gateway/src/session-collector.ts` (`defaultSessionSocketPath`, `start`, `unlinkStaleSocket`), `packages/gateway/src/main.ts` (`sessionSocketPathFromEnv`) | 모든 기본 gateway가 동일한 임시 소켓 경로를 선택하고 시작 시 기존 소켓 파일을 삭제한다. 두 gateway가 병행 실행되면 새 프로세스가 기존 주소를 탈취할 수 있다. gateway 인스턴스별 경로 또는 단일 소켓 소유자 정책을 채택하고, 살아 있는 소켓은 unlink하지 않도록 소유권 확인이 필요하다. 현재는 `LOOP_GATEWAY_SESSION_SOCKET`으로 분리 가능. |
| 중간 | SQLite writer: `crates/loop-store/src/schema.rs` (`journal_mode=WAL`), `crates/loop-store/src/sqlite.rs` (`busy_timeout` 5초) | WAL은 읽기 병행을 허용하지만 같은 DB에 대한 쓰기 직렬화와 5초 제한은 남는다. 부하 시 busy 오류 가능성은 아직 계측되지 않았다. busy 발생률 측정 후 bounded retry/backoff 검토. DB를 run별로 분리할 경우 통합 조회 비용이 증가한다. |
| 중간 | 실행 리스: `crates/loop-store/src/sqlite.rs` (`execution_leases` run_id별 CAS/renew), `packages/gateway/src/planner.ts` (만료 후 재시도) | 동일 run의 소유권 경쟁은 CAS로 막지만 만료·재획득 경계에서 후속 작업이 대기할 수 있다. run별 소유자/만료/재시도 결과를 함께 관찰하고 만료된 리스만 회수할 것. |
| 중간 | 공유 파일 및 worktree: `packages/orchestrator/src/coordinator.ts` (workingDirectory realpath), `packages/orchestrator/src/cleanup.ts` (worktree 제거 전 점검) | 같은 cwd의 서로 다른 run에 쓰기 파일 격리가 자동 보장되지 않는다. 공통 `node_modules` 설치나 빌드 산출물 변경 시 충돌 가능. task write scope 중첩을 검사하거나 run마다 별도 worktree를 제공하고 설치 작업을 직렬화할 것. cleanup의 preflight는 다른 run의 파일 소유권 증명이 아니다. |
| 중간 | HTTP 포트 및 런타임 레코드: `packages/gateway/src/server.ts` (`config.port`로 listen), `packages/gateway/src/main.ts` (시작 후 runtime record 기록), `packages/gateway/src/runtime-record.ts` | 같은 포트 설정으로 두 gateway를 띄우면 bind 경쟁; 공유 well-known record는 마지막 writer만 가리킬 수 있다. gateway를 하나만 운영하거나 인스턴스별 포트·레코드 경로를 지정할 것. |
| 낮음 | attention / Pi binding: `packages/pi-loop/src/extension.ts` (`loop-run-binding` 기록, cwd 기준 후보 탐색), `crates/loop-bridge/src/commands/guidance.rs` (run_id + attention_id 해석) | 동일 cwd의 활성 run이 여럿이면 cwd만으로 유일한 run을 정할 수 없다. attention 해석 자체는 run ID를 받는다. UI/도구에서 명시 run ID를 유지하고 선택 시 다중 후보를 노출할 것. |

## 오프라인 재현

`bun test tests/multi-session-same-folder.test.ts`: **1 pass, 0 fail**. 서로 다른 두 gateway 호출의 기본 소켓 경로가 같다는 현재의 충돌 계약을 고정한다. provider 호출 없음. 이 테스트는 실제 두 프로세스의 socket unlink/접속 실패나 사용자가 관측한 장애의 원인까지 증명하지 않는다. 수정 시 기본 경로 격리 또는 단일 소유자 계약으로 테스트를 교체해야 한다.

## 구조적 선택

- A: gateway 단일 소유자 + 여러 run 공유. 소켓·포트·runtime record 소유권이 단순하지만 gateway 장애 도메인이 공유된다.
- B: gateway별 소켓/포트/record 분리. 독립 실행에 유리하지만 tap discovery와 UI 대상 선택이 복잡해진다.

현 시점 권고: 우선 A를 기본 운영 계약으로 명시하고 다중 gateway가 필요하면 B의 인스턴스 식별자를 composition root에서 주입한다. core/store에 provider나 gateway 주소 개념을 추가하지 않는다.
