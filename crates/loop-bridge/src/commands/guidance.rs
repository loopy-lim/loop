//! Guidance·attention commands: durable decision records, attention
//! request/resolution, and the M-TL2 guidance delivery watermark.

use super::{CompletionCheckInput, OperationOutput, append, append_owned, bridge_error, store};
use loop_core::attention::{
    Attention, AttentionKind, AttentionResolution, CorrectiveTask, FailureDirective,
};
use loop_core::event::{Event, EventKind, RunProjection};
use loop_core::task::{
    CompletionCheck, CompletionContract, Task, TaskId, TaskKind, TaskState, WorkOwnership,
};
use rustra::prelude::*;

use crate::events::GuidanceDeliveredEvent;

#[bridge_type]
pub struct RecordGuidanceDeliveredInput {
    pub database_path: String,
    pub run_id: String,
    pub guidance: GuidanceDeliveredEvent,
    pub execution_owner: Option<String>,
}

#[bridge_type]
pub struct DecisionInput {
    pub database_path: String,
    pub run_id: String,
    pub decision_id: String,
    pub task_id: Option<String>,
    pub value: String,
}

#[bridge_type]
pub struct ResolveAttentionInput {
    pub database_path: String,
    pub run_id: String,
    pub attention_id: String,
    pub resolution: String,
    /// Corrective-task contract, required by — and only valid with — the
    /// `add_task` failure directive.
    pub corrective_task: Option<CorrectiveTaskInput>,
}

#[bridge_type]
pub struct CorrectiveTaskInput {
    pub id: String,
    pub title: String,
    pub write_scope: Vec<String>,
    pub requirements: Vec<String>,
    pub completion_checks: Vec<CompletionCheckInput>,
}

#[bridge_type]
pub struct RequestAttentionInput {
    pub database_path: String,
    pub run_id: String,
    pub attention_id: String,
    pub kind: AttentionKind,
    pub summary: String,
    pub task_id: Option<String>,
    pub execution_owner: Option<String>,
}

pub(crate) fn register_decision_attention(
    builder: rustra::PackageBuilder,
) -> rustra::PackageBuilder {
    register!(
        builder,
        record_decision,
        request_attention,
        resolve_attention
    )
}

pub(crate) fn register_guidance_delivery(
    builder: rustra::PackageBuilder,
) -> rustra::PackageBuilder {
    register!(builder, record_guidance_delivered)
}

/// Records that a live worker received guidance up to `through_sequence`
/// (ADR M-TL2 delivery watermark). The store's reducer enforces the
/// ascending-only watermark per task, so an out-of-order or duplicate
/// delivery record fails here instead of regressing the projection.
#[command]
pub fn record_guidance_delivered(input: RecordGuidanceDeliveredInput) -> Result<OperationOutput> {
    if input.guidance.worker_id.trim().is_empty() {
        return Err(bridge_error(
            "invalid_guidance_delivery",
            "worker id is required",
        ));
    }
    if input.guidance.through_sequence <= 0 {
        return Err(bridge_error(
            "invalid_guidance_delivery",
            "through_sequence must be a positive event-log sequence",
        ));
    }
    append_owned(
        &input.database_path,
        Event::new(
            input.run_id,
            EventKind::GuidanceDelivered {
                task_id: TaskId::from(input.guidance.task_id),
                worker_id: input.guidance.worker_id,
                through_sequence: input.guidance.through_sequence,
            },
        ),
        input.execution_owner.as_deref(),
    )
}

#[command]
pub fn record_decision(input: DecisionInput) -> Result<OperationOutput> {
    append(
        &input.database_path,
        Event::new(
            input.run_id,
            EventKind::DecisionRecorded {
                decision_id: input.decision_id,
                task_id: input.task_id.map(TaskId::from),
                value: input.value,
            },
        ),
    )
}

#[command]
pub fn resolve_attention(input: ResolveAttentionInput) -> Result<OperationOutput> {
    let attention_id = input.attention_id.clone();
    let resolution = parse_resolution(&input.resolution, input.corrective_task)?;
    let mut store = store(&input.database_path)?;
    let projection = store
        .projection(&input.run_id)
        .map_err(|error| bridge_error("run_not_found", error))?;
    let mut attention = projection
        .attention
        .get(&input.attention_id)
        .ok_or_else(|| bridge_error("attention_not_found", &input.attention_id))?
        .clone();
    // Pre-validate against the core acceptance rules so the wire error names
    // the actual violation (kind mismatch, free text on failure, malformed
    // corrective contract) instead of a failed batch append. The durable
    // append re-runs the same rules race-free.
    attention
        .resolve(resolution.clone())
        .map_err(|error| bridge_error("invalid_resolution", error))?;
    let mut events = vec![Event::new(
        &input.run_id,
        EventKind::AttentionResolved {
            attention_id: attention_id.clone(),
            resolution: resolution.clone(),
        },
    )];
    let mut output = OperationOutput::default();
    // Directive effects and legacy verdict effects stay in one place: the
    // dispatch is on the core vocabulary, so a directive can never grow a
    // bridge-only meaning.
    match resolution.as_failure_directive() {
        Some(FailureDirective::Retry) => {
            if let Some(task_id) = attention.task_id.clone() {
                output.redispatched_task_id = redispatch_ready_events(
                    &projection,
                    &input.run_id,
                    task_id.clone(),
                    &mut events,
                )?
                .map(|redispatched| redispatched.to_string());
                if output.redispatched_task_id.is_some() {
                    output.summary = Some(format!("re-dispatched task {task_id}"));
                }
            }
        }
        Some(FailureDirective::AddTask(corrective)) => {
            let task_id = attention.task_id.clone().ok_or_else(|| {
                bridge_error(
                    "invalid_resolution",
                    "the add_task directive requires a task-bound failure attention",
                )
            })?;
            if projection.tasks.contains_key(&corrective.id) {
                return Err(bridge_error(
                    "invalid_task",
                    format!("corrective task already exists: {}", corrective.id),
                ));
            }
            let corrective_id = corrective.id.clone();
            let created = Event::new(
                &input.run_id,
                EventKind::TaskCreated(corrective_task_spec(&corrective)?),
            );
            events.push(created);
            events.push(Event::new(
                &input.run_id,
                EventKind::TaskDependencyAdded {
                    task_id: task_id.clone(),
                    depends_on: corrective.id,
                },
            ));
            // Wiring a new prerequisite changes the failed task's dispatch
            // contract, so the task is explicitly re-qualified: TaskReady
            // moves queued work to Ready and parked work back into the
            // dispatch lane. Non-queueable states are refused first.
            let state = projection
                .tasks
                .get(&task_id)
                .ok_or_else(|| bridge_error("task_not_found", &task_id))?
                .state;
            if !matches!(
                state,
                TaskState::Pending | TaskState::Ready | TaskState::Attention | TaskState::Failed
            ) {
                return Err(bridge_error(
                    "reconciliation_required",
                    "running, verifying, or stopped work must be explicitly reconciled before re-qualification",
                ));
            }
            events.push(Event::new(
                &input.run_id,
                EventKind::TaskReady(task_id.clone()),
            ));
            output.redispatched_task_id = Some(task_id.to_string());
            output.summary = Some(format!(
                "corrective task {corrective_id} recorded as a prerequisite of {task_id}; re-dispatched"
            ));
        }
        Some(FailureDirective::RelaxRouting) => {
            let task_id = attention.task_id.clone().ok_or_else(|| {
                bridge_error(
                    "invalid_resolution",
                    "the relax_routing directive requires a task-bound failure attention",
                )
            })?;
            let task = projection
                .tasks
                .get(&task_id)
                .ok_or_else(|| bridge_error("task_not_found", &task_id))?;
            // The step choice is core policy: one graduated, downgrade-only
            // step from the routing ladder. A spent ladder is refused so the
            // resolver falls through to retry/defer/cancel instead of
            // pretending to recover.
            let step = task.routing.relax_step().ok_or_else(|| {
                bridge_error(
                    "relaxation_exhausted",
                    "every required capability is already at zero and the risk floor is low; choose retry, defer, or cancel",
                )
            })?;
            events.push(Event::new(
                &input.run_id,
                EventKind::TaskRoutingUpdated {
                    task_id: task_id.clone(),
                    relaxation: step,
                    reason: format!("attention:{attention_id} relax_routing"),
                },
            ));
            output.routing_relaxations = vec![step.describe()];
            output.redispatched_task_id =
                redispatch_ready_events(&projection, &input.run_id, task_id.clone(), &mut events)?
                    .map(|redispatched| redispatched.to_string());
            output.summary = Some(format!(
                "relaxed {} on task {task_id}{}",
                step.describe(),
                match output.redispatched_task_id {
                    Some(_) => "; re-dispatched",
                    None => "; task already queued",
                }
            ));
        }
        // Defer records a no-escalation decision, but it must never
        // silently park the run: the bound task re-enters the dispatch lane
        // so the resolution cannot leave Active runs holding only
        // Attention-state tasks with an empty scheduler verdict.
        Some(FailureDirective::Defer) => {
            if let Some(task_id) = attention.task_id.clone() {
                output.redispatched_task_id = redispatch_ready_events(
                    &projection,
                    &input.run_id,
                    task_id.clone(),
                    &mut events,
                )?
                .map(|redispatched| redispatched.to_string());
                output.summary = Some(match output.redispatched_task_id {
                    Some(_) => format!("deferred failure on task {task_id}; re-dispatched"),
                    None => format!("deferred failure on task {task_id}; already dispatchable"),
                });
            }
        }
        Some(FailureDirective::Cancel) | None => {
            if let AttentionResolution::Answer(message) = &resolution {
                events.push(Event::new(
                    &input.run_id,
                    EventKind::GuidanceAdded {
                        task_id: attention.task_id.clone(),
                        message: message.clone(),
                    },
                ));
            }
            if matches!(
                resolution,
                AttentionResolution::Cancel | AttentionResolution::Rejected(_)
            ) {
                events.push(Event::new(
                    &input.run_id,
                    if projection.has_in_flight_work() {
                        EventKind::RunCancellationRequested
                    } else {
                        EventKind::RunCancelled
                    },
                ));
            } else if let Some(task_id) = attention.task_id.clone() {
                // A non-cancelling verdict (answer/approval) must never leave
                // the bound task silently parked: parked work re-enters the
                // dispatch lane, queued or in-flight work already has one,
                // and terminal work has nothing to resume.
                if let Some(redispatched) =
                    resume_parked_task_events(&projection, &input.run_id, &task_id, &mut events)
                {
                    output.redispatched_task_id = Some(redispatched.to_string());
                    output.summary = Some(format!("guidance recorded; re-dispatched task {task_id}"));
                }
            }
        }
    }
    super::append_batch_and_notify(&mut store, &events, "attention_resolution_failed")?;
    output.accepted = true;
    Ok(output)
}

/// Parses the wire resolution string into the core vocabulary. Free text
/// stays an `Answer` — core rejects it for failure attentions, which is the
/// pinned contract that failure resolutions are directives, not prose.
/// `add_task:{json}` embeds the corrective contract inside the directive
/// token — that embedded form is the only channel the Lead tool chain has
/// (the resolution travels as one string through CLI argv), and it must
/// never merge with the structured `corrective_task` field.
fn parse_resolution(
    resolution: &str,
    corrective_task: Option<CorrectiveTaskInput>,
) -> Result<AttentionResolution> {
    if let Some(embedded) = resolution.strip_prefix("add_task:") {
        if corrective_task.is_some() {
            return Err(bridge_error(
                "invalid_resolution",
                "corrective_task was provided both inside the add_task token and as the structured field",
            ));
        }
        let embedded: CorrectiveTaskInput =
            serde_json::from_str(embedded.trim()).map_err(|error| {
                bridge_error(
                    "invalid_resolution",
                    format!("embedded corrective_task is not valid JSON: {error}"),
                )
            })?;
        return Ok(AttentionResolution::AddTask(corrective_task_from_input(
            embedded,
        )));
    }
    if corrective_task.is_some() && resolution != "add_task" {
        return Err(bridge_error(
            "invalid_resolution",
            "corrective_task is only valid with the add_task directive",
        ));
    }
    match resolution {
        "approved" => Ok(AttentionResolution::Approved),
        "retry" => Ok(AttentionResolution::Retry),
        "relax_routing" => Ok(AttentionResolution::RelaxRouting),
        "defer" => Ok(AttentionResolution::Defer),
        "cancel" => Ok(AttentionResolution::Cancel),
        "add_task" => {
            let corrective = corrective_task.ok_or_else(|| {
                bridge_error(
                    "invalid_resolution",
                    "the add_task directive requires a corrective_task payload",
                )
            })?;
            Ok(AttentionResolution::AddTask(corrective_task_from_input(
                corrective,
            )))
        }
        "rejected" => Ok(AttentionResolution::Rejected("rejected".into())),
        value if value.starts_with("rejected:") => Ok(AttentionResolution::Rejected(
            value.trim_start_matches("rejected:").trim().to_string(),
        )),
        value if !value.trim().is_empty() => Ok(AttentionResolution::Answer(value.to_string())),
        _ => Err(bridge_error("invalid_resolution", "resolution is required")),
    }
}

fn corrective_task_from_input(input: CorrectiveTaskInput) -> CorrectiveTask {
    CorrectiveTask::new(
        input.id,
        input.title,
        input.write_scope,
        input.requirements,
        input.completion_checks.into_iter().map(|check| {
            CompletionCheck::command(
                check.id,
                check.command,
                check.args,
                check.working_directory,
                check.timeout_ms,
            )
        }),
    )
}

/// Derives the corrective task from the directive contract: an
/// implementation-kind task whose write scope is exactly the one the resolver
/// fixed, so a repair cannot widen its blast radius beyond the decision
/// record.
fn corrective_task_spec(corrective: &CorrectiveTask) -> Result<Task> {
    Task::builder(
        corrective.id.clone(),
        corrective.title.clone(),
        TaskKind::Implementation,
    )
    .ownership(WorkOwnership::new(
        std::iter::empty::<String>(),
        corrective.write_scope.clone(),
    ))
    .requirements(corrective.requirements.clone())
    .completion_contract(CompletionContract::new(
        corrective.completion_checks.iter().cloned(),
    ))
    .build()
    .map_err(|error| bridge_error("invalid_task", error))
}

/// The shared re-dispatch contract of the `retry`, `defer`, `add_task`, and
/// `relax_routing` directives:
/// only queued (pending/ready) or parked (attention/failed) work can be
/// re-dispatched, and never past an explicit reconciliation. Returns the
/// task a `TaskReady` was committed for — already-queued work yields `None`
/// so the resolve receipt can state that no re-dispatch happened.
fn redispatch_ready_events(
    projection: &RunProjection,
    run_id: &str,
    task_id: TaskId,
    events: &mut Vec<Event>,
) -> Result<Option<TaskId>> {
    let state = projection
        .tasks
        .get(&task_id)
        .ok_or_else(|| bridge_error("task_not_found", &task_id))?
        .state;
    match state {
        TaskState::Pending | TaskState::Ready => Ok(None),
        TaskState::Attention | TaskState::Failed => {
            events.push(Event::new(run_id, EventKind::TaskReady(task_id.clone())));
            Ok(Some(task_id))
        }
        TaskState::Blocked => Err(bridge_error(
            "invalid_retry",
            "terminally blocked dependent work cannot be retried",
        )),
        TaskState::Running | TaskState::Verifying | TaskState::Cancelled => Err(bridge_error(
            "reconciliation_required",
            "running, verifying, or stopped work must be explicitly reconciled before retry",
        )),
        TaskState::Done => Err(bridge_error(
            "invalid_retry",
            "completed work cannot be retried",
        )),
    }
}

/// The guidance-resume contract of the `answer` and `approved` verdicts on a
/// task-bound attention: parked (attention/failed) work is re-qualified with
/// a `TaskReady` so resolving guidance can never leave the run silently
/// parked. Queued or in-flight work already has a dispatch path and terminal
/// or blocked work has nothing to resume, so those states append nothing.
fn resume_parked_task_events(
    projection: &RunProjection,
    run_id: &str,
    task_id: &TaskId,
    events: &mut Vec<Event>,
) -> Option<TaskId> {
    let parked = matches!(
        projection.tasks.get(task_id).map(|task| task.state),
        Some(TaskState::Attention | TaskState::Failed)
    );
    if parked {
        events.push(Event::new(run_id, EventKind::TaskReady(task_id.clone())));
        Some(task_id.clone())
    } else {
        None
    }
}

#[cfg(test)]
mod directive_recovery_tests {
    //! Reproduction tests for the two attention-recovery gaps: (a) the Lead
    //! string channel must carry the `add_task` corrective contract to the
    //! core, and (b) a batch-candidate-absence failure must have a programmatic
    //! relaxation directive (`relax_routing`) with durable evidence.
    use super::*;
    use crate::commands::run::{CreateRunInput, create_run};
    use crate::commands::task::{SubmitPlanInput, TaskSpecInput, submit_plan};
    use loop_core::attention::AttentionState;
    use loop_core::policy::{ComputeCapabilities, ComputeClass, Risk, TaskRouting};

    fn setup(run_id: &str, routing: Option<TaskRouting>) -> String {
        let dir = tempfile::tempdir().unwrap();
        let database_path = dir.path().join("loop.db").display().to_string();
        // The database must outlive this function: leak the guard so the
        // temp directory is only reclaimed at process exit.
        std::mem::forget(dir);
        create_run(CreateRunInput {
            database_path: database_path.clone(),
            run_id: run_id.into(),
        })
        .unwrap();
        submit_plan(SubmitPlanInput {
            database_path: database_path.clone(),
            run_id: run_id.into(),
            tasks: vec![TaskSpecInput {
                id: "impl".into(),
                title: "Implement".into(),
                kind: TaskKind::Implementation,
                dependencies: vec![],
                read_scope: vec![],
                write_scope: vec!["src/**".into()],
                requirements: vec!["requirement".into()],
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
                routing,
                max_attempts: 3,
            }],
        })
        .unwrap();
        request_attention(RequestAttentionInput {
            database_path: database_path.clone(),
            run_id: run_id.into(),
            attention_id: "failure-1".into(),
            kind: AttentionKind::Failure,
            summary: "no eligible compute candidate satisfies task constraints".into(),
            task_id: Some("impl".into()),
            execution_owner: None,
        })
        .unwrap();
        database_path
    }

    /// Gap (a): the corrective contract travels inside the `add_task:`
    /// directive token (the only Lead→bridge channel is the resolution
    /// string) and reaches the core as TaskCreated + dependency + redispatch.
    #[test]
    fn embedded_corrective_contract_reaches_the_core() {
        let database_path = setup("gap-a", None);
        let corrective = serde_json::json!({
            "id": "repair-check",
            "title": "Make the flaky check deterministic",
            "writeScope": ["src/checks/**"],
            "requirements": ["the failing check passes on a clean checkout"],
            "completionChecks": [{
                "id": "verify-repair",
                "command": "cargo",
                "args": ["test", "-p", "check"],
                "workingDirectory": null,
                "timeoutMs": 120_000
            }]
        });
        let output = resolve_attention(ResolveAttentionInput {
            database_path: database_path.clone(),
            run_id: "gap-a".into(),
            attention_id: "failure-1".into(),
            resolution: format!("add_task:{corrective}"),
            corrective_task: None,
        })
        .unwrap_or_else(|error| panic!("the embedded contract must resolve: {error}"));
        assert!(output.accepted);
        assert!(output.summary.as_deref().unwrap().contains("repair-check"));
        let store = store(&database_path).unwrap();
        let projection = store.projection("gap-a").unwrap();
        assert!(projection.tasks.contains_key(&TaskId::from("repair-check")));
        let failed = &projection.tasks[&TaskId::from("impl")];
        assert!(failed.dependencies.contains(&TaskId::from("repair-check")));
        assert_eq!(failed.state, TaskState::Ready);
        assert_eq!(
            projection.attention["failure-1"].state,
            AttentionState::Resolved
        );
    }

    /// Gap (b): `relax_routing` applies the core-owned ladder step, records
    /// the relaxation as durable evidence in the resolve receipt and the
    /// event payload, and re-qualifies the task for placement.
    #[test]
    fn relax_routing_directive_steps_down_and_redispatches() {
        let routing = TaskRouting {
            risk: Risk::High,
            required: ComputeCapabilities::new(0, 2, 1, 0, 0),
        };
        let database_path = setup("gap-b", Some(routing));
        let output = resolve_attention(ResolveAttentionInput {
            database_path: database_path.clone(),
            run_id: "gap-b".into(),
            attention_id: "failure-1".into(),
            resolution: "relax_routing".into(),
            corrective_task: None,
        })
        .unwrap_or_else(|error| panic!("the relaxation directive must resolve: {error}"));
        // Ladder: vision → long_context → tools → reasoning → coding → risk.
        assert_eq!(output.routing_relaxations, vec!["tools 1→0".to_string()]);
        assert_eq!(output.redispatched_task_id, None);
        assert!(output.summary.as_deref().unwrap().contains("tools 1→0"));
        let store = store(&database_path).unwrap();
        let projection = store.projection("gap-b").unwrap();
        let task = &projection.tasks[&TaskId::from("impl")];
        assert_eq!(task.routing.required.tools, 0);
        assert_eq!(task.routing.required.reasoning, 2);
        assert_eq!(task.routing.risk, Risk::High);
    }

    /// The ladder is finite: once every capability is zero and the risk floor
    /// is `low`, the directive names its exhaustion instead of pretending to
    /// recover — retry/defer/cancel remain the exits.
    #[test]
    fn relax_routing_names_exhaustion_when_the_ladder_is_spent() {
        let routing = TaskRouting {
            risk: Risk::Low,
            required: ComputeCapabilities::new(0, 0, 0, 0, 0),
        };
        let database_path = setup("gap-b-exhausted", Some(routing));
        let error = resolve_attention(ResolveAttentionInput {
            database_path,
            run_id: "gap-b-exhausted".into(),
            attention_id: "failure-1".into(),
            resolution: "relax_routing".into(),
            corrective_task: None,
        })
        .expect_err("a spent ladder must refuse to relax");
        assert_eq!(error.code(), "relaxation_exhausted");
    }

    #[test]
    fn add_task_with_an_embedded_payload_conflicts_with_the_structured_field() {
        let database_path = setup("gap-a-conflict", None);
        let error = resolve_attention(ResolveAttentionInput {
            database_path,
            run_id: "gap-a-conflict".into(),
            attention_id: "failure-1".into(),
            resolution: "add_task:{\"id\":\"x\"}".into(),
            corrective_task: Some(CorrectiveTaskInput {
                id: "x".into(),
                title: "x".into(),
                write_scope: vec!["src/**".into()],
                requirements: vec!["r".into()],
                completion_checks: vec![CompletionCheckInput {
                    id: "c".into(),
                    command: "true".into(),
                    args: vec![],
                    working_directory: None,
                    timeout_ms: 1_000,
                }],
            }),
        })
        .expect_err("two payload channels must not merge");
        assert_eq!(error.code(), "invalid_resolution");
    }
}

#[command]
pub fn request_attention(input: RequestAttentionInput) -> Result<OperationOutput> {
    if input.summary.trim().is_empty() {
        return Err(bridge_error("invalid_attention", "summary is required"));
    }
    let attention = match input.task_id {
        Some(task_id) => Attention::for_task(
            input.attention_id,
            input.kind,
            input.summary,
            TaskId::from(task_id),
        ),
        None => Attention::new(input.attention_id, input.kind, input.summary),
    };
    let event = Event::new(input.run_id, EventKind::AttentionCreated(attention));
    match input.execution_owner.as_deref() {
        Some(owner) => append_owned(&input.database_path, event, Some(owner)),
        None => append(&input.database_path, event),
    }
}
