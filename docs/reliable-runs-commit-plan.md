# 커밋 계획: 그래프 실행 안정화

생성 예정: 1개 커밋, 104개 파일. 구현·검증 완료 후 사용자 확인을 기다린다.

```text
feat(runtime): 그래프 실행의 관찰·개입·복구와 병렬 처리 안정화

저장된 그래프와 실행 소유권으로 중복 실행을 막고 화면 종료 후 실행을 유지한다.
작업 지침·결과·검증 기록을 전달하고 취소·자원 정리의 완료를 확인한다.
Jev 경로를 제거하고 재현 가능한 코드 생성·빌드와 회귀 검사를 추가한다.
```

Rust 계약과 생성 코드, 이를 사용하는 실행·표시 계층을 함께 변경하므로 하나의 기능 커밋으로 묶는다.

`README.md`와 `packages/cli/src/main.ts`에 별도로 추가된 cleanup 명령·설명은 작업 트리에 보존한다. 이번 커밋에는 해당 선행 추가분을 제외하고 이 작업의 변경만 포함한다. 인덱스 준비용 분리본은 임시 작업 기록에 보관했으며 커밋 직전에 현재 파일과 다시 대조한다.

검증: [최종 검증 기록](reliable-runs-verification.md). 사용자 설치 경로 변경·push·PR 생성은 포함하지 않는다.

## 파일 목록

- `.github/workflows/ci.yml`
- `Cargo.lock`
- `README.md`
- `bun.lock`
- `config/providers.example.toml`
- `crates/loop-bridge/Cargo.toml`
- `crates/loop-bridge/src/commands.rs`
- `crates/loop-bridge/src/execution.rs`
- `crates/loop-bridge/src/lib.rs`
- `crates/loop-bridge/tests/commands.rs`
- `crates/loop-bridge/tests/context.rs`
- `crates/loop-core/Cargo.toml`
- `crates/loop-core/src/attention/attention.rs`
- `crates/loop-core/src/event/event.rs`
- `crates/loop-core/src/event/mod.rs`
- `crates/loop-core/src/event/reducer.rs`
- `crates/loop-core/src/run/run.rs`
- `crates/loop-core/src/scheduler/conflicts.rs`
- `crates/loop-core/src/scheduler/scheduler.rs`
- `crates/loop-core/src/task/ownership.rs`
- `crates/loop-core/src/task/task.rs`
- `crates/loop-core/tests/durable_context.rs`
- `crates/loop-core/tests/event_reducer.rs`
- `crates/loop-core/tests/scheduler_domain.rs`
- `crates/loop-store/src/migration.rs`
- `crates/loop-store/src/schema.rs`
- `crates/loop-store/src/sqlite.rs`
- `crates/loop-store/tests/execution.rs`
- `crates/loop-store/tests/fixtures/global-id-schema.sql`
- `crates/loop-store/tests/projection_performance.rs`
- `crates/loop-store/tests/purge.rs`
- `crates/loop-store/tests/recovery.rs`
- `docs/adr/cleanup-and-retention.md`
- `docs/model-routing.md`
- `docs/provider-support.md`
- `docs/reliable-runs-commit-plan.md`
- `docs/reliable-runs-verification.md`
- `docs/reliable-runs.md`
- `docs/superpowers/plans/2026-09-22-reliable-graph-interventions.md`
- `docs/superpowers/specs/2026-09-22-reliable-graph-interventions-design.md`
- `package.json`
- `packages/cli/src/dispatcher.ts`
- `packages/cli/src/main.ts`
- `packages/cli/test/cli.test.ts`
- `packages/cli/test/detached.test.ts`
- `packages/cli/test/fixtures/detached-observer.ts`
- `packages/cli/test/fixtures/detached-owner.ts`
- `packages/herdr/src/client.ts`
- `packages/herdr/src/worker.ts`
- `packages/herdr/test/lifecycle.test.ts`
- `packages/orchestrator/src/cleanup.ts`
- `packages/orchestrator/src/completion.ts`
- `packages/orchestrator/src/config.ts`
- `packages/orchestrator/src/control.ts`
- `packages/orchestrator/src/coordinator.ts`
- `packages/orchestrator/src/redact.ts`
- `packages/orchestrator/src/runtime.ts`
- `packages/orchestrator/src/task-execution.ts`
- `packages/orchestrator/test/cleanup.test.ts`
- `packages/orchestrator/test/completion.test.ts`
- `packages/orchestrator/test/interventions.test.ts`
- `packages/orchestrator/test/milestone.test.ts`
- `packages/orchestrator/test/redact.test.ts`
- `packages/pi-loop/src/extension.ts`
- `packages/pi-loop/src/lead/prompts.ts`
- `packages/pi-loop/src/ui/snapshot.ts`
- `packages/pi-loop/test/lead.test.ts`
- `packages/pi-loop/test/ui.test.ts`
- `packages/presentation/package.json`
- `packages/presentation/src/index.ts`
- `packages/presentation/src/snapshot.ts`
- `packages/protocol/package.json`
- `packages/protocol/src/generated/.rustra-generated.json`
- `packages/protocol/src/generated/commands.ts`
- `packages/protocol/src/generated/contract.ts`
- `packages/protocol/src/generated/frame-codecs.ts`
- `packages/protocol/src/generated/frame-registry.ts`
- `packages/protocol/src/generated/schema.json`
- `packages/protocol/src/generated/types.ts`
- `packages/providers/package.json`
- `packages/providers/src/antigravity/adapter.ts`
- `packages/providers/src/antigravity/driver.ts`
- `packages/providers/src/antigravity/persistent.ts`
- `packages/providers/src/codex/adapter.ts`
- `packages/providers/src/herdr-agent.ts`
- `packages/providers/src/index.ts`
- `packages/providers/src/jev/client.ts` — 삭제
- `packages/providers/src/pi/adapter.ts`
- `packages/providers/src/process-provider.ts`
- `packages/providers/src/process.ts`
- `packages/providers/src/prompt.ts`
- `packages/providers/src/redact.ts`
- `packages/providers/src/types.ts`
- `packages/providers/src/zai/api.ts`
- `packages/providers/src/zai/cli.ts`
- `packages/providers/test/adapters-v2.test.ts`
- `packages/providers/test/antigravity-persistent.test.ts`
- `packages/providers/test/lifecycle.test.ts`
- `packages/providers/test/prompt.test.ts`
- `scripts/rustra-codegen.test.ts`
- `scripts/rustra-codegen.ts`
- `tests/architecture-boundaries.test.ts`
- `tests/configuration.test.ts`
- `tsconfig.json`
