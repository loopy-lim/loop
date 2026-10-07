//! Task context commands: run plan read-back, per-task worker context, check
//! receipts, stop verification, activity and output records.

use super::{decomposition_contract, task_spec};
use crate::commands::{
    DecompositionContractOutput, OperationOutput, RunInput, TaskSpecInput, append_owned,
    bridge_error, store,
};
use loop_core::event::{CheckReceipt, Event, EventKind};
use loop_core::policy::{
    ClampedText, ContextBudgetPolicy, PROMPT_OVERHEAD_CHARS, ReductionPass, utf16_len,
};
use loop_core::task::{TaskId, TaskState};
use rustra::prelude::*;

#[bridge_type]
pub struct TaskContextInput {
    pub database_path: String,
    pub run_id: String,
    pub task_id: String,
}

#[bridge_type]
pub struct DependencyResultOutput {
    pub task_id: String,
    pub title: String,
    pub summary: String,
}

#[bridge_type]
pub struct TaskContextOutput {
    pub intent: String,
    pub working_directory: String,
    pub task: TaskSpecInput,
    pub decomposition_contract: Option<DecompositionContractOutput>,
    pub attempt: u16,
    pub dependency_results: Vec<DependencyResultOutput>,
    pub result_summary: Option<String>,
    pub previous_failure: Option<String>,
    pub previous_checks: Vec<CheckReceipt>,
    pub guidance: Vec<String>,
    /// Present when the context-budget policy had to shrink anything
    /// (docs/defects/limits-inventory.md R1·R2·R4). The full text of every
    /// shrunk field stays in the run store; this record is observability
    /// for the dispatch surface.
    pub context_reduction: Option<ContextReductionRecord>,
}

/// What the context-budget policy changed while assembling one dispatch
/// context. Counts are UTF-16 code units dropped, matching the unit the
/// worker prompt renderer measures its limits in.
#[bridge_type]
#[derive(Default)]
pub struct ContextReductionRecord {
    pub field_clamps: u32,
    pub body_compactions: u32,
    pub dropped_chars: u32,
    /// True when this dispatch continues a retry after a stall/limit
    /// failure, so the prior attempt's bulky context was compacted.
    pub retry_compaction: bool,
    pub total_budget_passes: u32,
    pub estimated_essential_chars: u32,
}

#[bridge_type]
pub struct RunPlanOutput {
    pub intent: String,
    pub working_directory: String,
    pub tasks: Vec<TaskSpecInput>,
}

#[bridge_type]
pub struct RecordCheckReceiptsInput {
    pub database_path: String,
    pub run_id: String,
    pub task_id: String,
    pub checks: Vec<CheckReceipt>,
    pub execution_owner: Option<String>,
}

#[bridge_type]
pub struct StopVerificationInput {
    pub database_path: String,
    pub run_id: String,
    pub task_id: String,
    pub execution_owner: Option<String>,
}

#[bridge_type]
pub struct RecordActivityInput {
    pub database_path: String,
    pub run_id: String,
    pub task_id: String,
    pub activity: String,
    pub execution_owner: Option<String>,
}

#[bridge_type]
pub struct RecordTaskOutputInput {
    pub database_path: String,
    pub run_id: String,
    pub task_id: String,
    pub summary: String,
    pub execution_owner: Option<String>,
}

pub(crate) fn register_run_context(builder: rustra::PackageBuilder) -> rustra::PackageBuilder {
    register!(
        builder,
        get_run_plan,
        get_task_context,
        record_check_receipts,
        stop_verification,
        record_activity,
        record_task_output
    )
}

#[command]
pub fn get_run_plan(input: RunInput) -> Result<RunPlanOutput> {
    let projection = store(&input.database_path)?
        .projection(&input.run_id)
        .map_err(|e| bridge_error("run_not_found", e))?;
    Ok(RunPlanOutput {
        intent: projection.intent,
        working_directory: projection.working_directory,
        tasks: projection.tasks.values().map(task_spec).collect(),
    })
}

#[command]
pub fn get_task_context(input: TaskContextInput) -> Result<TaskContextOutput> {
    let projection = store(&input.database_path)?
        .projection(&input.run_id)
        .map_err(|e| bridge_error("run_not_found", e))?;
    let id = TaskId::from(input.task_id);
    let task = projection
        .tasks
        .get(&id)
        .ok_or_else(|| bridge_error("task_not_found", &id))?;
    let dependency_results = task
        .dependencies
        .iter()
        .filter_map(|id| {
            let dependency = projection.tasks.get(id)?;
            if dependency.state != TaskState::Done {
                return None;
            }
            Some(DependencyResultOutput {
                task_id: id.to_string(),
                title: dependency.title.clone(),
                summary: projection.outputs.get(id).cloned().unwrap_or_default(),
            })
        })
        .collect();
    let guidance = projection
        .guidance
        .iter()
        .filter(|item| item.task_id.as_ref().is_none_or(|target| target == &id))
        .map(|item| item.message.clone())
        .collect();
    let mut context = TaskContextOutput {
        intent: projection.intent.clone(),
        working_directory: projection.working_directory.clone(),
        task: task_spec(task),
        decomposition_contract: decomposition_contract(task),
        attempt: task.attempt,
        dependency_results,
        result_summary: projection.outputs.get(&id).cloned(),
        previous_failure: projection.failures.get(&id).cloned(),
        previous_checks: projection.checks.get(&id).cloned().unwrap_or_default(),
        guidance,
        context_reduction: None,
    };
    context.context_reduction = apply_context_budget(&mut context);
    Ok(context)
}

fn clamp_into(record: &mut ContextReductionRecord, clamped: ClampedText) -> String {
    if clamped.dropped_chars > 0 {
        record.field_clamps = record.field_clamps.saturating_add(1);
        record.dropped_chars = record.dropped_chars.saturating_add(clamped.dropped_chars);
    }
    clamped.text
}

fn compact_into(record: &mut ContextReductionRecord, clamped: ClampedText) -> String {
    if clamped.dropped_chars > 0 {
        record.body_compactions = record.body_compactions.saturating_add(1);
        record.dropped_chars = record.dropped_chars.saturating_add(clamped.dropped_chars);
    }
    clamped.text
}

fn dependency_reference(task_id: &str) -> String {
    format!("dependency task {task_id} result in the run store")
}

const RESULT_SUMMARY_REFERENCE: &str = "previous attempt result in the run store";

/// Upper-bound estimate of the essential worker-contract length in UTF-16
/// code units. Mirrors the renderer's field set (intent, task lines, scopes,
/// requirements, persona, completion checks, guidance, result summary,
/// previous failure) plus the [`PROMPT_OVERHEAD_CHARS`] framing allowance;
/// check receipts are supplemental and rendered under the renderer's own
/// silent total truncation, so they are not counted here.
fn estimate_essential_chars(context: &TaskContextOutput) -> usize {
    let task = &context.task;
    let mut total = PROMPT_OVERHEAD_CHARS;
    total += utf16_len(&context.intent) + 16;
    total += utf16_len(&task.id) + utf16_len(&task.title) + 64;
    total += utf16_len(&context.working_directory) + 32;
    for scope in task.read_scope.iter().chain(task.write_scope.iter()) {
        total += utf16_len(scope) + 4;
    }
    for requirement in &task.requirements {
        total += utf16_len(requirement) + 4;
    }
    if let Some(persona) = &task.persona {
        total += utf16_len(persona) + 16;
    }
    for check in &task.completion_checks {
        total += utf16_len(&check.id) + utf16_len(&check.command) + 64;
        total += check
            .args
            .iter()
            .map(|arg| utf16_len(arg) + 1)
            .sum::<usize>();
        if let Some(directory) = &check.working_directory {
            total += utf16_len(directory) + 4;
        }
        total += 12; // timeoutMs digits
    }
    for item in &context.guidance {
        total += utf16_len(item) + 4;
    }
    if let Some(summary) = &context.result_summary {
        total += utf16_len(summary) + 48;
    }
    if let Some(failure) = &context.previous_failure {
        total += utf16_len(failure) + 48;
    }
    total
}

/// Apply the loop-core context-budget policy to one assembled dispatch
/// context (docs/defects/limits-inventory.md R1·R2·R4). Deterministic, in
/// order: (a1) required contract fields clamp to the renderer's per-field
/// bound with a store-reference marker — the run store keeps the full text,
/// so the marker is the artifact reference; (a2) oversized advisory bodies
/// (dependency results, result summary) compact to bounded heads with
/// references; (b) a retry after a stall/limit failure continues on a
/// compacted context instead of resending the full prior one; (c) a two-pass
/// ladder keeps the estimated essential contract under the renderer's total
/// bound, advisory first and guidance last. Returns the reduction record, or
/// `None` when nothing changed.
fn apply_context_budget(context: &mut TaskContextOutput) -> Option<ContextReductionRecord> {
    let policy = ContextBudgetPolicy::default();
    let mut record = ContextReductionRecord::default();

    context.intent = clamp_into(&mut record, policy.clamp_required_field(&context.intent));
    context.task.requirements = context
        .task
        .requirements
        .iter()
        .map(|requirement| clamp_into(&mut record, policy.clamp_required_field(requirement)))
        .collect();
    context.previous_failure = context
        .previous_failure
        .take()
        .map(|failure| clamp_into(&mut record, policy.clamp_required_field(&failure)));
    context.guidance = context
        .guidance
        .iter()
        .map(|item| clamp_into(&mut record, policy.clamp_required_field(item)))
        .collect();

    for dependency in &mut context.dependency_results {
        let reference = dependency_reference(&dependency.task_id);
        dependency.summary = compact_into(
            &mut record,
            policy.compact_body(&dependency.summary, Some(&reference)),
        );
    }
    context.result_summary = context.result_summary.take().map(|summary| {
        compact_into(
            &mut record,
            policy.clamp_body(&summary, Some(RESULT_SUMMARY_REFERENCE)),
        )
    });

    // (b) A retry after a stall/limit failure continues on a compacted
    // context: bulky bodies become bounded heads plus the artifact
    // reference that already accompanies oversized check output.
    if ContextBudgetPolicy::retry_continues_compacted(context.previous_failure.as_deref()) {
        record.retry_compaction = true;
        for receipt in &mut context.previous_checks {
            let reference = receipt
                .output_artifact
                .clone()
                .unwrap_or_else(|| format!("check {} output in the run store", receipt.id));
            receipt.stdout = compact_into(
                &mut record,
                policy.compact_body(&receipt.stdout, Some(&reference)),
            );
            receipt.stderr = compact_into(
                &mut record,
                policy.compact_body(&receipt.stderr, Some(&reference)),
            );
        }
        context.result_summary = context.result_summary.take().map(|summary| {
            compact_into(
                &mut record,
                policy.compact_body(&summary, Some(RESULT_SUMMARY_REFERENCE)),
            )
        });
        for dependency in &mut context.dependency_results {
            let reference = dependency_reference(&dependency.task_id);
            dependency.summary = compact_into(
                &mut record,
                policy.compact_body(&dependency.summary, Some(&reference)),
            );
        }
    }

    // (c) Total-bound ladder: advisory bodies first, guidance last, exactly
    // once per dispatch. An exhausted ladder leaves the renderer's
    // deterministic limit plus the InvalidContract classification as the
    // safety net (structurally unreachable for store-sourced content).
    let mut passes = 0;
    while let Some(pass) = policy.next_total_reduction(estimate_essential_chars(context), passes) {
        passes += 1;
        match pass {
            ReductionPass::CompactAdvisory => {
                for dependency in &mut context.dependency_results {
                    let reference = dependency_reference(&dependency.task_id);
                    dependency.summary = compact_into(
                        &mut record,
                        policy.compact_body(&dependency.summary, Some(&reference)),
                    );
                }
                context.result_summary = context.result_summary.take().map(|summary| {
                    compact_into(
                        &mut record,
                        policy.compact_body(&summary, Some(RESULT_SUMMARY_REFERENCE)),
                    )
                });
            }
            ReductionPass::CompactGuidance => {
                context.guidance = context
                    .guidance
                    .iter()
                    .map(|item| compact_into(&mut record, policy.compact_body(item, None)))
                    .collect();
            }
        }
    }
    record.total_budget_passes = passes;
    record.estimated_essential_chars =
        u32::try_from(estimate_essential_chars(context)).unwrap_or(u32::MAX);

    let changed = record.field_clamps != 0
        || record.body_compactions != 0
        || record.dropped_chars != 0
        || record.retry_compaction
        || record.total_budget_passes != 0;
    changed.then_some(record)
}

#[command]
pub fn record_check_receipts(input: RecordCheckReceiptsInput) -> Result<OperationOutput> {
    let projection = store(&input.database_path)?
        .projection(&input.run_id)
        .map_err(|error| bridge_error("snapshot_failed", error))?;
    let task_id = TaskId::from(input.task_id);
    let task = projection
        .tasks
        .get(&task_id)
        .ok_or_else(|| bridge_error("task_not_found", &task_id))?;
    let mut checks = input.checks;
    for check in &mut checks {
        if let Some(source) = &mut check.source {
            source.observed_outside_write_scope = task
                .ownership
                .observed_outside_write_scope(&source.observed_changed_paths);
        }
    }
    append_owned(
        &input.database_path,
        Event::new(
            input.run_id,
            EventKind::CheckReceiptsRecorded { task_id, checks },
        ),
        input.execution_owner.as_deref(),
    )
}

#[command]
pub fn stop_verification(input: StopVerificationInput) -> Result<OperationOutput> {
    append_owned(
        &input.database_path,
        Event::new(
            input.run_id,
            EventKind::VerificationStopped {
                task_id: TaskId::from(input.task_id),
            },
        ),
        input.execution_owner.as_deref(),
    )
}

#[command]
pub fn record_activity(input: RecordActivityInput) -> Result<OperationOutput> {
    append_owned(
        &input.database_path,
        Event::new(
            input.run_id,
            EventKind::TaskActivityRecorded {
                task_id: TaskId::from(input.task_id),
                activity: input.activity,
            },
        ),
        input.execution_owner.as_deref(),
    )
}

#[cfg(test)]
mod context_budget_repros {
    //! Reproduction tests for docs/defects/limits-inventory.md §3: oversized
    //! preserved fields reached the worker prompt verbatim and made every
    //! dispatch attempt throw before a worker could start (recovery-impossible
    //! loop), and a stall/limit retry resent the full prior context.

    use super::*;
    use crate::commands::{
        CheckResultInput, ClaimRunnableTasksInput, CompletionCheckInput, CreateRunInput,
        SubmitPlanInput, TaskSpecInput, VerificationInput, WorkerInput, WorkerResultInput, append,
        claim_runnable_tasks, create_run, record_verification, record_worker_result,
        record_worker_started, submit_plan,
    };
    use crate::execution::{ExecutionLeaseInput, claim_execution};
    use loop_core::policy::ComputeClass;
    use loop_core::task::TaskKind;

    fn owner() -> Option<String> {
        Some("owner".to_string())
    }

    fn task_spec(id: &str, dependencies: &[&str]) -> TaskSpecInput {
        TaskSpecInput {
            id: id.into(),
            title: id.into(),
            kind: TaskKind::Implementation,
            dependencies: dependencies.iter().map(|id| (*id).to_string()).collect(),
            read_scope: vec![],
            write_scope: vec!["src/**".into()],
            requirements: vec![format!("requirement-{id}")],
            persona: None,
            completion_checks: vec![CompletionCheckInput {
                id: "tests".into(),
                command: "true".into(),
                args: vec![],
                working_directory: None,
                timeout_ms: 1_000,
            }],
            preferred_compute: ComputeClass::Fast,
            minimum_compute: ComputeClass::Tiny,
            maximum_compute: ComputeClass::Strong,
            routing: None,
            max_attempts: 3,
        }
    }

    fn plan(database_path: &str, run_id: &str, tasks: Vec<TaskSpecInput>) {
        let task_count = tasks.len() as u16;
        create_run(CreateRunInput {
            database_path: database_path.into(),
            run_id: run_id.into(),
        })
        .unwrap();
        submit_plan(SubmitPlanInput {
            database_path: database_path.into(),
            run_id: run_id.into(),
            tasks,
        })
        .unwrap();
        // Owned appends require an active execution lease held by "owner".
        claim_execution(ExecutionLeaseInput {
            database_path: database_path.into(),
            run_id: run_id.into(),
            owner: "owner".into(),
            now_ms: 0,
            ttl_ms: 60_000,
        })
        .unwrap();
        // Claimed work materializes the Pending→Ready transitions.
        claim_runnable_tasks(ClaimRunnableTasksInput {
            database_path: database_path.into(),
            run_id: run_id.into(),
            running_task_ids: vec![],
            max_workers: task_count,
            max_frontier_workers: task_count,
            execution_owner: Some("owner".into()),
        })
        .unwrap();
    }

    fn start_worker(database_path: &str, run_id: &str, task_id: &str) {
        record_worker_started(WorkerInput {
            database_path: database_path.into(),
            run_id: run_id.into(),
            task_id: task_id.into(),
            worker_id: format!("w-{task_id}"),
            execution_owner: owner(),
            state: None,
        })
        .unwrap();
    }

    fn fail_worker(database_path: &str, run_id: &str, task_id: &str, summary: String) {
        record_worker_result(WorkerResultInput {
            database_path: database_path.into(),
            run_id: run_id.into(),
            task_id: task_id.into(),
            worker_id: format!("w-{task_id}"),
            success: false,
            summary,
            execution_owner: owner(),
            state: None,
        })
        .unwrap();
    }

    fn finish_successfully_with_summary(
        database_path: &str,
        run_id: &str,
        task_id: &str,
        summary: String,
    ) {
        start_worker(database_path, run_id, task_id);
        record_worker_result(WorkerResultInput {
            database_path: database_path.into(),
            run_id: run_id.into(),
            task_id: task_id.into(),
            worker_id: format!("w-{task_id}"),
            success: true,
            summary,
            execution_owner: owner(),
            state: None,
        })
        .unwrap();
        record_verification(VerificationInput {
            database_path: database_path.into(),
            run_id: run_id.into(),
            task_id: task_id.into(),
            passed: true,
            checks: vec![CheckResultInput {
                id: "tests".into(),
                passed: true,
            }],
            reason: String::new(),
            execution_owner: owner(),
        })
        .unwrap();
    }

    fn record_receipts(database_path: &str, run_id: &str, task_id: &str, stdout_chars: usize) {
        record_check_receipts(RecordCheckReceiptsInput {
            database_path: database_path.into(),
            run_id: run_id.into(),
            task_id: task_id.into(),
            checks: vec![CheckReceipt {
                id: "tests".into(),
                command: "bun".into(),
                args: vec!["test".into()],
                working_directory: "/tmp/w".into(),
                exit_code: 1,
                stdout: "o".repeat(stdout_chars),
                stderr: "e".repeat(stdout_chars),
                timed_out: false,
                duration_ms: 12,
                output_artifact: Some("/artifacts/t1-tests.log".into()),
                source: None,
            }],
            execution_owner: owner(),
        })
        .unwrap();
    }

    /// Inventory §3 row 1: a stored failure summary over the 6,000-character
    /// required-field bound re-threw on every dispatch attempt. The assembled
    /// context must already respect the bound the prompt enforces.
    #[test]
    fn oversized_previous_failure_dispatches_within_the_field_bound() {
        let dir = tempfile::tempdir().unwrap();
        let database_path = dir.path().join("loop.db").display().to_string();
        let run_id = "budget-field";
        plan(&database_path, run_id, vec![task_spec("t1", &[])]);

        start_worker(&database_path, run_id, "t1");
        fail_worker(&database_path, run_id, "t1", "F".repeat(6_100));

        let context = get_task_context(TaskContextInput {
            database_path,
            run_id: run_id.into(),
            task_id: "t1".into(),
        })
        .unwrap();
        let failure = context.previous_failure.expect("failure recorded");
        assert!(
            failure.chars().count() <= 6_000,
            "previousFailure must be bounded for the prompt: got {} chars",
            failure.chars().count()
        );
        assert!(
            failure.contains("truncated"),
            "the bound must carry a truncation marker naming the store: {failure}"
        );
        let reduction = context.context_reduction.expect("clamp recorded");
        assert!(reduction.field_clamps >= 1);
        assert!(reduction.dropped_chars > 0);
        assert!(!reduction.retry_compaction);
    }

    /// Inventory §3: a retry after a stall/limit failure resent the full prior
    /// context (failure receipts verbatim). The retry must continue on a
    /// compacted context whose bodies are bounded heads plus the artifact
    /// reference that already accompanies oversized check output.
    #[test]
    fn stall_retry_continues_on_compacted_receipts_with_artifact_references() {
        let dir = tempfile::tempdir().unwrap();
        let database_path = dir.path().join("loop.db").display().to_string();
        let run_id = "budget-stall";
        plan(&database_path, run_id, vec![task_spec("t1", &[])]);
        record_receipts(&database_path, run_id, "t1", 20_000);

        start_worker(&database_path, run_id, "t1");
        fail_worker(
            &database_path,
            run_id,
            "t1",
            "Worker stalled: no progress for 900s (stall threshold 900s); failing the attempt for the retry policy"
                .into(),
        );

        let context = get_task_context(TaskContextInput {
            database_path,
            run_id: run_id.into(),
            task_id: "t1".into(),
        })
        .unwrap();
        let receipt = &context.previous_checks[0];
        assert!(
            receipt.stdout.chars().count() <= 600,
            "stalled-retry receipt body must be a bounded head: got {} chars",
            receipt.stdout.chars().count()
        );
        assert!(receipt.stderr.chars().count() <= 600);
        assert!(
            receipt.stdout.contains("/artifacts/t1-tests.log"),
            "the compaction must keep the artifact reference: {}",
            receipt.stdout
        );
        assert_eq!(
            receipt.output_artifact.as_deref(),
            Some("/artifacts/t1-tests.log")
        );
        assert_eq!(receipt.exit_code, 1);
        let reduction = context.context_reduction.expect("compaction recorded");
        assert!(
            reduction.retry_compaction,
            "stall retry must be marked as a compacted continuation"
        );
        assert!(reduction.body_compactions >= 2);
    }

    /// Inventory §1.1/§2 #5: a dependency result stored up to the 16,000-char
    /// output bound passed verbatim into the context. Oversized dependency
    /// results must travel as a bounded summary plus a store reference.
    #[test]
    fn oversized_dependency_result_passes_as_bounded_summary_with_reference() {
        let dir = tempfile::tempdir().unwrap();
        let database_path = dir.path().join("loop.db").display().to_string();
        let run_id = "budget-dependency";
        plan(
            &database_path,
            run_id,
            vec![task_spec("dep", &[]), task_spec("t1", &["dep"])],
        );
        finish_successfully_with_summary(&database_path, run_id, "dep", "d".repeat(9_000));

        let context = get_task_context(TaskContextInput {
            database_path,
            run_id: run_id.into(),
            task_id: "t1".into(),
        })
        .unwrap();
        let summary = &context.dependency_results[0].summary;
        assert!(
            summary.chars().count() <= 2_100,
            "dependency summary must be bounded: got {} chars",
            summary.chars().count()
        );
        assert!(
            summary.contains("truncated") && summary.contains("dep"),
            "the bound must reference the dependency task in the store: {summary}"
        );
    }

    /// Repair evidence keeps today's preservation invariant: a retry after a
    /// check failure (no stall/limit marker in the failure reason) still
    /// receives the failure receipt verbatim.
    #[test]
    fn assertion_retry_keeps_failure_receipts_verbatim() {
        let dir = tempfile::tempdir().unwrap();
        let database_path = dir.path().join("loop.db").display().to_string();
        let run_id = "budget-assertion";
        plan(&database_path, run_id, vec![task_spec("t1", &[])]);
        record_receipts(&database_path, run_id, "t1", 20_000);

        start_worker(&database_path, run_id, "t1");
        fail_worker(
            &database_path,
            run_id,
            "t1",
            "check tests: exit 1\nassertion failed: expected 3, got 4".into(),
        );

        let context = get_task_context(TaskContextInput {
            database_path,
            run_id: run_id.into(),
            task_id: "t1".into(),
        })
        .unwrap();
        assert_eq!(context.previous_checks[0].stdout.len(), 20_000);
    }

    /// Inventory §1.2 total bound: three at-bound guidance items alone push
    /// the essential contract past 16,000 characters, which made prompt
    /// assembly throw on every attempt. The ladder must compact guidance
    /// after advisory bodies fail to bring the estimate under the bound.
    #[test]
    fn total_budget_ladder_compacts_guidance_when_the_estimate_overflows() {
        let dir = tempfile::tempdir().unwrap();
        let database_path = dir.path().join("loop.db").display().to_string();
        let run_id = "budget-ladder";
        plan(&database_path, run_id, vec![task_spec("t1", &[])]);
        for index in 0..3 {
            append(
                &database_path,
                Event::new(
                    run_id,
                    EventKind::GuidanceAdded {
                        task_id: Some(TaskId::from("t1")),
                        message: format!("g{index}-{}", "x".repeat(5_996)),
                    },
                ),
            )
            .unwrap();
        }

        let context = get_task_context(TaskContextInput {
            database_path,
            run_id: run_id.into(),
            task_id: "t1".into(),
        })
        .unwrap();
        for item in &context.guidance {
            assert!(
                item.chars().count() <= 600,
                "ladder must compact guidance bodies: got {} chars",
                item.chars().count()
            );
            assert!(
                item.contains("truncated"),
                "compacted guidance keeps a marker: {item}"
            );
        }
    }
}

#[command]
pub fn record_task_output(input: RecordTaskOutputInput) -> Result<OperationOutput> {
    if input.summary.trim().is_empty() {
        return Err(bridge_error(
            "invalid_output",
            "task output summary is required",
        ));
    }
    append_owned(
        &input.database_path,
        Event::new(
            input.run_id,
            EventKind::TaskOutputRecorded {
                task_id: TaskId::from(input.task_id),
                summary: input.summary,
            },
        ),
        input.execution_owner.as_deref(),
    )
}
