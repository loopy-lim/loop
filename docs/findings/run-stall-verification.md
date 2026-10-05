# 런 스톨 통합 검증

**판정: FAIL (전체 요구 기준).** 검사 자체는 통과했지만, 조사된 무재디스패치 경로 전부가 수정되지는 않았다.

## 실행 증거

- `bun run check` (2026-10-01, 현재 작업 트리): exit 0. codegen:check, lint, typecheck, architecture, Rust 및 Bun 테스트 단계 통과; Bun 결과 909 pass / 0 fail (108 files). lint 경고는 있으나 실패 없음.
- `bun test packages/gateway/test/planner-retry.test.ts`: exit 0, 1 pass / 0 fail. `failed execution hand-off retries after the old lease expires` 회귀 테스트가 실제 파일에 존재하며 통과했다. 이 테스트는 재시도 호출을 확인하지만 모든 실패 유형의 지속적 복구를 보장하지 않는다.
- 독립 완료 검사 `bash -c 'test -s docs/findings/run-stall-verification.md'`: 이 문서 생성 후 실행 대상으로 명시한다.

## 경로별 잔여 위험과 이유

- `docs/findings/run-stall-gateway.md` S2의 execute reject 후 만료 lease 재시도 **1회만 수정** (`packages/gateway/src/planner.ts`, 회귀 테스트 위 참조). 재시도까지 실패하면 자동 복구 없음. S1 attention/paused는 의도된 사람 개입 정지이나 gateway 원격 resolve API가 없어 원격 복구 불가; S3 gateway 재시작 후 active lease 회수는 상시 reaper 부재로 미해결. S4 CLI attention 종료는 수동 resolve 계약.
- `docs/findings/run-stall-coordinator.md` I(lease 상실 뒤 active 고착), A1/A2(소유권 경합 뒤 owner 사망), J(pi-loop resolve 후 resume 실패), K(store 오류 시 execute reject)는 별도 자동 복구 보장이 없다. gateway의 1회 재시도는 이들에 대한 일반 해법이 아니다.
- `docs/findings/run-stall-pi-loop.md` R1(만료 전 lease 관측 후 owner 사망), R2(resume 실패), R3(stale activeWorkers)는 observer의 재판정/재디스패치 부재로 미해결. R4는 남은 attention에 대한 의도된 보류다.
- `docs/findings/run-stall-core.md` S1은 사람의 attention 해소가 필요한 정책적 hold; S2(해소 후 task가 Attention에 잔류), S3(검증 결과·failure attention 간 커밋 공백), S4(attention 해소 뒤 완료 재평가 부재)는 Rust 변경과 회귀 테스트가 필요해 미해결. S5 lease TTL은 제한된 일시 대기이며, owner 부재 후 재실행 주체 문제는 별개다.

변경 범위는 이 검증 문서뿐이다. 위 잔여 경로들은 이 태스크의 문서 전용 쓰기 범위에서 고칠 수 없으므로 전체 수정 완료로 판정하지 않는다.
