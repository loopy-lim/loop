//! Cleanup commands: retention-bounded run purge plus the removal policy
//! evaluations (worktree and surface).

use super::{bridge_error, store};
use loop_core::policy::RetentionPolicy;
use rustra::prelude::*;

#[bridge_type]
pub struct CleanupRunInput {
    pub database_path: String,
    pub run_id: String,
    pub keep_recent: u32,
    pub dry_run: bool,
}

#[bridge_type]
pub struct SkippedArtifactOutput {
    pub artifact: String,
    pub reason: String,
}

#[bridge_type]
pub struct CleanupRunOutput {
    pub removed_artifacts: Vec<String>,
    pub skipped_artifacts: Vec<SkippedArtifactOutput>,
}

#[bridge_type]
pub struct EvaluateWorktreeRemovalInput {
    pub project_root: String,
    pub worktree_path: String,
    pub is_merged: bool,
    pub is_clean: bool,
}

#[bridge_type]
pub struct PolicyEvaluationOutput {
    pub allowed: bool,
    pub refusal_code: Option<String>,
    pub reason: Option<String>,
}

#[bridge_type]
pub struct EvaluateSurfaceRemovalInput {
    pub surface_id: String,
    pub is_owned_by_loop: bool,
}

pub(crate) fn register_cleanup(builder: rustra::PackageBuilder) -> rustra::PackageBuilder {
    register!(
        builder,
        cleanup_run,
        evaluate_worktree_removal,
        evaluate_surface_removal
    )
}

#[command]
pub fn cleanup_run(input: CleanupRunInput) -> Result<CleanupRunOutput> {
    let mut store = store(&input.database_path)?;
    let policy = RetentionPolicy::new(input.keep_recent as usize);

    if !input.run_id.trim().is_empty() {
        let run_id = &input.run_id;
        let runs = store
            .runs()
            .map_err(|error| bridge_error("runs_failed", error))?;
        let Some((_, state)) = runs.iter().find(|(id, _)| id == run_id) else {
            // Run doesn't exist or already removed: double-purge is idempotent
            return Ok(CleanupRunOutput {
                removed_artifacts: vec![],
                skipped_artifacts: vec![],
            });
        };

        if !state.is_terminal() {
            return Ok(CleanupRunOutput {
                removed_artifacts: vec![],
                skipped_artifacts: vec![SkippedArtifactOutput {
                    artifact: run_id.clone(),
                    reason: format!("run {} is in non-terminal state {:?}", run_id, state),
                }],
            });
        }

        let removable =
            policy.select_removable_runs(runs.iter().map(|(id, state)| (id.as_str(), *state)));
        if input.keep_recent > 0 && !removable.contains(&run_id.as_str()) {
            return Ok(CleanupRunOutput {
                removed_artifacts: vec![],
                skipped_artifacts: vec![SkippedArtifactOutput {
                    artifact: run_id.clone(),
                    reason: format!(
                        "run {} is retained by retention policy (keep_recent = {})",
                        run_id, input.keep_recent
                    ),
                }],
            });
        }

        if !input.dry_run {
            store
                .purge_run(run_id)
                .map_err(|error| bridge_error("purge_failed", error))?;
        }

        Ok(CleanupRunOutput {
            removed_artifacts: vec![run_id.clone()],
            skipped_artifacts: vec![],
        })
    } else {
        let plan = store
            .purge_plan(policy)
            .map_err(|error| bridge_error("purge_plan_failed", error))?;
        let removed_artifacts: Vec<String> =
            plan.actions.iter().map(|a| a.target.clone()).collect();
        let skipped_artifacts: Vec<SkippedArtifactOutput> = plan
            .refusals
            .into_iter()
            .map(|r| SkippedArtifactOutput {
                artifact: r.target,
                reason: r.reason,
            })
            .collect();

        if !input.dry_run {
            for action in &plan.actions {
                store
                    .purge_run(&action.target)
                    .map_err(|error| bridge_error("purge_failed", error))?;
            }
        }

        Ok(CleanupRunOutput {
            removed_artifacts,
            skipped_artifacts,
        })
    }
}

#[command]
pub fn evaluate_worktree_removal(
    input: EvaluateWorktreeRemovalInput,
) -> Result<PolicyEvaluationOutput> {
    match loop_core::policy::evaluate_worktree_removal(
        &input.project_root,
        &input.worktree_path,
        input.is_merged,
        input.is_clean,
    ) {
        Ok(()) => Ok(PolicyEvaluationOutput {
            allowed: true,
            refusal_code: None,
            reason: None,
        }),
        Err(refusal) => Ok(PolicyEvaluationOutput {
            allowed: false,
            refusal_code: Some(
                serde_json::to_string(&refusal.code)
                    .unwrap_or_default()
                    .trim_matches('"')
                    .to_string(),
            ),
            reason: Some(refusal.reason),
        }),
    }
}

#[command]
pub fn evaluate_surface_removal(
    input: EvaluateSurfaceRemovalInput,
) -> Result<PolicyEvaluationOutput> {
    match loop_core::policy::evaluate_surface_removal(&input.surface_id, input.is_owned_by_loop) {
        Ok(()) => Ok(PolicyEvaluationOutput {
            allowed: true,
            refusal_code: None,
            reason: None,
        }),
        Err(refusal) => Ok(PolicyEvaluationOutput {
            allowed: false,
            refusal_code: Some(
                serde_json::to_string(&refusal.code)
                    .unwrap_or_default()
                    .trim_matches('"')
                    .to_string(),
            ),
            reason: Some(refusal.reason),
        }),
    }
}
