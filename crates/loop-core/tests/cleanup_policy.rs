#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
use std::path::Path;

use loop_core::attention::AttentionKind;
use loop_core::error::CoreError;
use loop_core::event::{Artifact, ArtifactState, Event, EventKind, ProjectionError, RunProjection};
use loop_core::policy::{
    evaluate_external_session_removal, evaluate_run_record_removal, evaluate_surface_removal,
    evaluate_worktree_path, evaluate_worktree_removal, ArtifactKind, PurgePlan, RefusalCode,
    RetentionPolicy,
};

use loop_core::run::RunState;

#[test]
fn retention_selection_keeps_newest_terminal_runs_and_selects_older_runs() {
    let policy = RetentionPolicy::new(3);

    // 5 terminal runs from newest to oldest
    let runs = [
        ("run-5", RunState::Completed),
        ("run-4", RunState::Failed),
        ("run-3", RunState::Cancelled),
        ("run-2", RunState::Completed),
        ("run-1", RunState::Failed),
    ];

    let removable = policy.select_removable_runs(runs);
    assert_eq!(removable, vec!["run-2", "run-1"]);
}

#[test]
fn default_retention_policy_retains_eight_terminal_runs() {
    let policy = RetentionPolicy::default();
    assert_eq!(policy.keep_runs, 8);

    let runs = [
        ("run-10", RunState::Completed),
        ("run-9", RunState::Completed),
        ("run-8", RunState::Completed),
        ("run-7", RunState::Completed),
        ("run-6", RunState::Completed),
        ("run-5", RunState::Completed),
        ("run-4", RunState::Completed),
        ("run-3", RunState::Completed),
        ("run-2", RunState::Completed),
        ("run-1", RunState::Completed),
    ];

    let removable = policy.select_removable_runs(runs);
    assert_eq!(removable, vec!["run-2", "run-1"]);
}

#[test]
fn retention_evaluation_generates_purge_plan_and_refuses_non_terminal_runs() {
    let policy = RetentionPolicy::new(2);

    let runs = [
        ("run-active", RunState::Active),
        ("run-4", RunState::Completed),
        ("run-attention", RunState::Attention),
        ("run-3", RunState::Failed),
        ("run-2", RunState::Completed),
        ("run-1", RunState::Cancelled),
    ];

    let plan: PurgePlan = policy.evaluate_runs(runs);

    // Terminal runs: run-4 (keep 1), run-3 (keep 2), run-2 (action), run-1 (action)
    assert_eq!(plan.actions.len(), 2);
    assert_eq!(plan.actions[0].artifact_kind, ArtifactKind::RunRecord);
    assert_eq!(plan.actions[0].target, "run-2");
    assert_eq!(plan.actions[1].artifact_kind, ArtifactKind::RunRecord);
    assert_eq!(plan.actions[1].target, "run-1");

    // Non-terminal runs: run-active and run-attention are refused
    assert_eq!(plan.refusals.len(), 2);
    assert_eq!(plan.refusals[0].artifact_kind, ArtifactKind::RunRecord);
    assert_eq!(plan.refusals[0].target, "run-active");
    assert_eq!(plan.refusals[0].code, RefusalCode::RunNotTerminal);
    assert_eq!(plan.refusals[0].attention_kind(), AttentionKind::Failure);

    assert_eq!(plan.refusals[1].artifact_kind, ArtifactKind::RunRecord);
    assert_eq!(plan.refusals[1].target, "run-attention");
    assert_eq!(plan.refusals[1].code, RefusalCode::RunNotTerminal);
    assert_eq!(plan.refusals[1].attention_kind(), AttentionKind::Failure);
}

#[test]
fn retention_selection_when_terminal_runs_fewer_than_keep_count() {
    let policy = RetentionPolicy::new(5);
    let runs = [("run-2", RunState::Completed), ("run-1", RunState::Failed)];

    let removable = policy.select_removable_runs(runs);
    assert!(removable.is_empty());

    let plan = policy.evaluate_runs(runs);
    assert!(plan.is_empty());
}

#[test]
fn event_reducer_tracks_artifact_creation_and_removal_lifecycle() {
    let mut projection = RunProjection::default();

    projection
        .apply(&Event::new("run-1", EventKind::RunCreated))
        .unwrap();

    let artifact = Artifact::new("surface-1", ArtifactKind::Surface, "tab-42");
    projection
        .apply(&Event::new(
            "run-1",
            EventKind::ArtifactCreated(artifact.clone()),
        ))
        .unwrap();

    assert_eq!(projection.artifacts.len(), 1);
    let record = &projection.artifacts["surface-1"];
    assert_eq!(record.id, "surface-1");
    assert_eq!(record.kind, ArtifactKind::Surface);
    assert_eq!(record.target, "tab-42");
    assert_eq!(record.state, ArtifactState::Active);
    assert!(record.is_active());
    assert!(!record.is_removal_pending());
    assert!(!record.is_removed());

    // Removal intent event marks the artifact as pending removal
    projection
        .apply(&Event::new(
            "run-1",
            EventKind::ArtifactRemovalRequested {
                artifact_id: "surface-1".into(),
                kind: ArtifactKind::Surface,
            },
        ))
        .unwrap();

    assert_eq!(
        projection.artifacts["surface-1"].state,
        ArtifactState::RemovalPending
    );
    assert!(projection.artifacts["surface-1"].is_removal_pending());
    assert!(!projection.artifacts["surface-1"].is_active());

    // Removal event marks the artifact as removed
    projection
        .apply(&Event::new(
            "run-1",
            EventKind::ArtifactRemoved {
                artifact_id: "surface-1".into(),
                kind: ArtifactKind::Surface,
            },
        ))
        .unwrap();

    assert_eq!(
        projection.artifacts["surface-1"].state,
        ArtifactState::Removed
    );
    assert!(projection.artifacts["surface-1"].is_removed());
    assert!(projection.is_artifact_removed("surface-1"));

    // active_artifacts filters out removed artifacts
    assert_eq!(projection.active_artifacts().count(), 0);

    // Dropping removed artifacts removes them from the projection map
    projection.drop_removed_artifacts();
    assert!(projection.artifacts.is_empty());
}

#[test]
fn event_reducer_rejects_duplicate_artifact_creation() {
    let mut projection = RunProjection::default();
    projection
        .apply(&Event::new("run-1", EventKind::RunCreated))
        .unwrap();

    let artifact = Artifact::new("worktree-1", ArtifactKind::Worktree, "/path/wt");
    projection
        .apply(&Event::new(
            "run-1",
            EventKind::ArtifactCreated(artifact.clone()),
        ))
        .unwrap();

    let err = projection
        .apply(&Event::new("run-1", EventKind::ArtifactCreated(artifact)))
        .unwrap_err();

    match err {
        ProjectionError::ArtifactAlreadyCreated(id) => assert_eq!(id, "worktree-1"),
        other => panic!("unexpected error: {:?}", other),
    }
}

#[test]
fn event_reducer_rejects_removal_of_nonexistent_artifact() {
    let mut projection = RunProjection::default();
    projection
        .apply(&Event::new("run-1", EventKind::RunCreated))
        .unwrap();

    let err = projection
        .apply(&Event::new(
            "run-1",
            EventKind::ArtifactRemovalRequested {
                artifact_id: "missing-artifact".into(),
                kind: ArtifactKind::Surface,
            },
        ))
        .unwrap_err();

    match err {
        ProjectionError::ArtifactNotFound(id) => assert_eq!(id, "missing-artifact"),
        other => panic!("unexpected error: {:?}", other),
    }

    let err2 = projection
        .apply(&Event::new(
            "run-1",
            EventKind::ArtifactRemoved {
                artifact_id: "missing-artifact".into(),
                kind: ArtifactKind::Surface,
            },
        ))
        .unwrap_err();

    match err2 {
        ProjectionError::ArtifactNotFound(id) => assert_eq!(id, "missing-artifact"),
        other => panic!("unexpected error: {:?}", other),
    }
}

#[test]
fn event_reducer_rejects_artifact_events_before_run_creation() {
    let mut projection = RunProjection::default();

    let err = projection
        .apply(&Event::new(
            "run-1",
            EventKind::ArtifactCreated(Artifact::new("p-1", ArtifactKind::Process, "proc-10")),
        ))
        .unwrap_err();

    assert!(matches!(err, ProjectionError::RunNotCreated));
}

#[test]
fn unsafe_removal_refuses_worktree_path_equal_to_project_root() {
    let project_root = Path::new("/workspace/project");
    let worktree_path = Path::new("/workspace/project");

    let refusal = evaluate_worktree_path(project_root, worktree_path).unwrap_err();
    assert_eq!(refusal.code, RefusalCode::PathIsProjectRoot);
    assert_eq!(refusal.artifact_kind, ArtifactKind::Worktree);
    assert_eq!(refusal.attention_kind(), AttentionKind::Failure);

    // Verify CoreError conversion
    let core_err: CoreError = refusal.into();
    assert!(matches!(core_err, CoreError::CleanupRefused(_)));
}

#[test]
fn unsafe_removal_refuses_worktree_path_outside_project_root() {
    let project_root = Path::new("/workspace/project");
    let outside_path = Path::new("/workspace/other-repo");

    let refusal = evaluate_worktree_path(project_root, outside_path).unwrap_err();
    assert_eq!(refusal.code, RefusalCode::PathOutsideProject);
    assert_eq!(refusal.attention_kind(), AttentionKind::Failure);

    // Traversal attempting to escape project root
    let escape_path = Path::new("/workspace/project/../other");
    let refusal2 = evaluate_worktree_path(project_root, escape_path).unwrap_err();
    assert_eq!(refusal2.code, RefusalCode::PathOutsideProject);

    // Non-absolute path
    let rel_path = Path::new("relative/path");
    let refusal3 = evaluate_worktree_path(project_root, rel_path).unwrap_err();
    assert_eq!(refusal3.code, RefusalCode::PathOutsideProject);
}

#[test]
fn unsafe_removal_allows_valid_sub_worktree_path() {
    let project_root = Path::new("/workspace/project");
    let valid_worktree = Path::new("/workspace/project/.worktrees/run-1");

    assert!(evaluate_worktree_path(project_root, valid_worktree).is_ok());
}

#[test]
fn unsafe_removal_refuses_unmerged_or_dirty_worktrees() {
    let project_root = Path::new("/workspace/project");
    let worktree = Path::new("/workspace/project/.worktrees/run-1");

    // Unmerged commits -> Decision attention
    let unmerged_refusal =
        evaluate_worktree_removal(project_root, worktree, false, true).unwrap_err();
    assert_eq!(unmerged_refusal.code, RefusalCode::WorktreeUnmerged);
    assert_eq!(unmerged_refusal.attention_kind(), AttentionKind::Decision);

    // Dirty working directory -> Decision attention
    let dirty_refusal = evaluate_worktree_removal(project_root, worktree, true, false).unwrap_err();
    assert_eq!(dirty_refusal.code, RefusalCode::WorktreeDirty);
    assert_eq!(dirty_refusal.attention_kind(), AttentionKind::Decision);

    // Clean and merged -> Ok
    assert!(evaluate_worktree_removal(project_root, worktree, true, true).is_ok());
}

#[test]
fn unsafe_removal_refuses_caller_owned_surfaces() {
    let refusal = evaluate_surface_removal("surface-caller-1", false).unwrap_err();
    assert_eq!(refusal.code, RefusalCode::SurfaceNotOwned);
    assert_eq!(refusal.artifact_kind, ArtifactKind::Surface);
    assert_eq!(refusal.attention_kind(), AttentionKind::Failure);

    assert!(evaluate_surface_removal("surface-loop-owned", true).is_ok());
}

#[test]
fn unsafe_removal_refuses_external_sessions() {
    let refusal = evaluate_external_session_removal("ext-sess-1").unwrap_err();
    assert_eq!(refusal.code, RefusalCode::ExternalSession);
    assert_eq!(refusal.artifact_kind, ArtifactKind::ExternalSession);
    assert_eq!(refusal.attention_kind(), AttentionKind::Failure);
}

#[test]
fn unsafe_removal_refuses_non_terminal_run_records() {
    let active_refusal = evaluate_run_record_removal("run-1", RunState::Active).unwrap_err();
    assert_eq!(active_refusal.code, RefusalCode::RunNotTerminal);
    assert_eq!(active_refusal.attention_kind(), AttentionKind::Failure);

    let attention_refusal = evaluate_run_record_removal("run-2", RunState::Attention).unwrap_err();
    assert_eq!(attention_refusal.code, RefusalCode::RunNotTerminal);
    assert_eq!(attention_refusal.attention_kind(), AttentionKind::Failure);

    assert!(evaluate_run_record_removal("run-3", RunState::Completed).is_ok());
    assert!(evaluate_run_record_removal("run-4", RunState::Failed).is_ok());
    assert!(evaluate_run_record_removal("run-5", RunState::Cancelled).is_ok());
}
