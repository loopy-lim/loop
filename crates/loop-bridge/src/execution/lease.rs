//! Execution lease commands: claim/renew/release, task reconciliation,
//! interrupted-claim recycling, and run listing.

use crate::commands::{OperationOutput, bridge_error, store};
use loop_core::attention::{AttentionKind, AttentionResolution, AttentionState};
use loop_core::event::{Event, EventKind};
use loop_core::task::TaskId;
use loop_store::RenewalOutcome;
use rustra::prelude::*;
use std::collections::BTreeSet;

#[bridge_type]
pub struct ReconcileTaskInput {
    pub database_path: String,
    pub run_id: String,
    pub task_id: String,
    pub confirmed_stopped: bool,
}

#[bridge_type]
pub struct ExecutionLeaseInput {
    pub database_path: String,
    pub run_id: String,
    pub owner: String,
    pub now_ms: i64,
    pub ttl_ms: i64,
}

#[bridge_type]
pub struct ReleaseExecutionInput {
    pub database_path: String,
    pub run_id: String,
    pub owner: String,
}

#[bridge_type]
pub struct RunListOutput {
    pub run_id: String,
    pub state: loop_core::run::RunState,
}

#[bridge_type]
pub struct ListRunsInput {
    pub database_path: String,
}

#[bridge_type]
pub struct RecycleInterruptedInput {
    pub database_path: String,
    pub run_id: String,
    pub execution_owner: String,
}

#[bridge_type]
pub struct RecycleInterruptedOutput {
    pub recycled_task_ids: Vec<String>,
}

pub(crate) fn register_lease(builder: rustra::PackageBuilder) -> rustra::PackageBuilder {
    register!(
        builder,
        claim_execution,
        renew_execution,
        release_execution,
        reconcile_task,
        recycle_interrupted_execution,
        list_runs
    )
}

#[command]
pub fn claim_execution(input: ExecutionLeaseInput) -> Result<OperationOutput> {
    let _ignored_client_clock = input.now_ms;
    let accepted = store(&input.database_path)?
        .claim_execution(&input.run_id, &input.owner, input.ttl_ms)
        .map_err(|e| bridge_error("execution_lease_failed", e))?;
    Ok(OperationOutput {
        accepted,
        ..OperationOutput::default()
    })
}

#[command]
pub fn renew_execution(input: ExecutionLeaseInput) -> Result<OperationOutput> {
    let _ignored_client_clock = input.now_ms;
    // Bounded automatic retry (diag-rust C3): a transient renewal failure is
    // retried inside the renewal threshold before the owner gives up. Only a
    // lost lease or an exhausted budget reaches the durable hand-off path.
    let renewed = store(&input.database_path)?
        .renew_execution_retrying(&input.run_id, &input.owner, input.ttl_ms)
        .map_err(|e| bridge_error("execution_lease_failed", e))?
        == RenewalOutcome::Renewed;
    Ok(OperationOutput {
        accepted: renewed,
        ..OperationOutput::default()
    })
}

#[command]
pub fn release_execution(input: ReleaseExecutionInput) -> Result<OperationOutput> {
    store(&input.database_path)?
        .release_execution(&input.run_id, &input.owner)
        .map_err(|e| bridge_error("execution_release_failed", e))?;
    Ok(OperationOutput {
        accepted: true,
        ..OperationOutput::default()
    })
}

#[command]
pub fn reconcile_task(input: ReconcileTaskInput) -> Result<OperationOutput> {
    if !input.confirmed_stopped {
        return Err(bridge_error(
            "confirmation_required",
            "Confirm the previous worker and verification processes have stopped before retrying",
        ));
    }
    let mut store = store(&input.database_path)?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| bridge_error("clock_failed", e))?
        .as_millis() as i64;
    let owner = format!("reconcile-{}-{now}", std::process::id());
    if !store
        .claim_execution(&input.run_id, &owner, 5000)
        .map_err(|e| bridge_error("lease_failed", e))?
    {
        return Err(bridge_error(
            "owner_active",
            "The execution owner is still active; pause or cancel it first",
        ));
    }
    let result = (|| {
        let projection = store
            .projection(&input.run_id)
            .map_err(|e| bridge_error("run_not_found", e))?;
        let task_id = TaskId::from(input.task_id);
        let mut events = vec![Event::new(
            &input.run_id,
            EventKind::TaskExecutionReconciled {
                task_id: task_id.clone(),
            },
        )];
        for attention in projection.attention.values().filter(|a| {
            a.state == AttentionState::Open
                && a.kind == AttentionKind::Failure
                && a.task_id.as_ref() == Some(&task_id)
        }) {
            events.push(Event::new(
                &input.run_id,
                EventKind::AttentionResolved {
                    attention_id: attention.id.clone(),
                    resolution: AttentionResolution::Retry,
                },
            ));
        }
        store
            .append_batch_owned(&events, Some(&owner))
            .map_err(|e| bridge_error("reconcile_failed", e))?;
        Ok(OperationOutput {
            accepted: true,
            ..OperationOutput::default()
        })
    })();
    store
        .release_execution(&input.run_id, &owner)
        .map_err(|e| bridge_error("lease_failed", e))?;
    result
}

/// Recovery judgment for an interrupted dispatcher (D1/D3): the current
/// execution lease holder proves its predecessor dead by durable fact — a
/// lapsed lease can never append again, so leftover running/verifying claims
/// are abandoned work, not live work. Recycling returns each task to ready
/// and resolves the stale failure attentions bound to it, so the dispatch
/// loop proceeds instead of demanding human confirmation.
#[command]
pub fn recycle_interrupted_execution(
    input: RecycleInterruptedInput,
) -> Result<RecycleInterruptedOutput> {
    let mut store = store(&input.database_path)?;
    store
        .require_execution_owner(&input.run_id, Some(&input.execution_owner))
        .map_err(|e| bridge_error("execution_owner_required", e))?;
    let claims = store
        .interrupted_execution_claims(&input.run_id)
        .map_err(|e| bridge_error("run_not_found", e))?;
    let task_ids: BTreeSet<String> = claims
        .claims
        .into_iter()
        .map(|claim| claim.task_id)
        .collect();
    if task_ids.is_empty() {
        return Ok(RecycleInterruptedOutput {
            recycled_task_ids: Vec::new(),
        });
    }
    let projection = store
        .projection(&input.run_id)
        .map_err(|e| bridge_error("run_not_found", e))?;
    // Reconcile first: AttentionResolved(Retry) rejects running/verifying
    // tasks, so each task must be back to ready before its attentions resolve.
    let mut events = Vec::new();
    for task_id in &task_ids {
        events.push(Event::new(
            &input.run_id,
            EventKind::TaskExecutionReconciled {
                task_id: TaskId::from(task_id.clone()),
            },
        ));
        for attention in projection.attention.values().filter(|a| {
            a.state == AttentionState::Open
                && a.kind == AttentionKind::Failure
                && a.task_id.as_ref().map(|id| id.as_str()) == Some(task_id.as_str())
        }) {
            events.push(Event::new(
                &input.run_id,
                EventKind::AttentionResolved {
                    attention_id: attention.id.clone(),
                    resolution: AttentionResolution::Retry,
                },
            ));
        }
    }
    store
        .append_batch_owned(&events, Some(&input.execution_owner))
        .map_err(|e| bridge_error("reconcile_failed", e))?;
    Ok(RecycleInterruptedOutput {
        recycled_task_ids: task_ids.into_iter().collect(),
    })
}

#[command]
pub fn list_runs(input: ListRunsInput) -> Result<Vec<RunListOutput>> {
    Ok(store(&input.database_path)?
        .runs()
        .map_err(|e| bridge_error("runs_failed", e))?
        .into_iter()
        .map(|(run_id, state)| RunListOutput { run_id, state })
        .collect())
}
