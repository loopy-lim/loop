use std::path::{Component, Path};

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::attention::AttentionKind;
use crate::run::RunState;

#[derive(
    Clone, Copy, Debug, Deserialize, Eq, Hash, JsonSchema, Ord, PartialEq, PartialOrd, Serialize,
)]
#[serde(rename_all = "snake_case")]
pub enum ArtifactKind {
    RunRecord,
    Worktree,
    Surface,
    Process,
    ExternalSession,
}

impl ArtifactKind {
    pub const fn is_recreatable(self) -> bool {
        matches!(self, Self::Surface | Self::Process)
    }

    pub const fn is_lossy_on_removal(self) -> bool {
        matches!(self, Self::RunRecord | Self::Worktree)
    }

    pub const fn is_managed_by_loop(self) -> bool {
        !matches!(self, Self::ExternalSession)
    }
}

impl std::fmt::Display for ArtifactKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::RunRecord => write!(f, "run_record"),
            Self::Worktree => write!(f, "worktree"),
            Self::Surface => write!(f, "surface"),
            Self::Process => write!(f, "process"),
            Self::ExternalSession => write!(f, "external_session"),
        }
    }
}

impl std::str::FromStr for ArtifactKind {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "run_record" => Ok(Self::RunRecord),
            "worktree" => Ok(Self::Worktree),
            "surface" => Ok(Self::Surface),
            "process" => Ok(Self::Process),
            "external_session" => Ok(Self::ExternalSession),
            other => Err(format!("unknown artifact kind: {other}")),
        }
    }
}

#[derive(
    Clone, Copy, Debug, Deserialize, Eq, Hash, JsonSchema, Ord, PartialEq, PartialOrd, Serialize,
)]
#[serde(rename_all = "snake_case")]
pub enum RefusalCode {
    RunNotTerminal,
    WorktreeUnmerged,
    WorktreeDirty,
    PathIsProjectRoot,
    PathOutsideProject,
    SurfaceNotOwned,
    ExternalSession,
}

impl RefusalCode {
    pub const fn attention_kind(self) -> AttentionKind {
        match self {
            Self::WorktreeUnmerged | Self::WorktreeDirty => AttentionKind::Decision,
            Self::PathOutsideProject
            | Self::PathIsProjectRoot
            | Self::SurfaceNotOwned
            | Self::RunNotTerminal
            | Self::ExternalSession => AttentionKind::Failure,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize, Error)]
#[error("cleanup refused for {artifact_kind} ({target}): {code:?} - {reason}")]
pub struct CleanupRefusal {
    pub artifact_kind: ArtifactKind,
    pub target: String,
    pub code: RefusalCode,
    pub reason: String,
}

impl CleanupRefusal {
    pub fn new(
        artifact_kind: ArtifactKind,
        target: impl Into<String>,
        code: RefusalCode,
        reason: impl Into<String>,
    ) -> Self {
        Self {
            artifact_kind,
            target: target.into(),
            code,
            reason: reason.into(),
        }
    }

    pub fn attention_kind(&self) -> AttentionKind {
        self.code.attention_kind()
    }
}

#[derive(Clone, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
pub struct PurgeAction {
    pub artifact_kind: ArtifactKind,
    pub target: String,
    pub run_id: Option<String>,
}

impl PurgeAction {
    pub fn new(artifact_kind: ArtifactKind, target: impl Into<String>) -> Self {
        Self {
            artifact_kind,
            target: target.into(),
            run_id: None,
        }
    }

    fn for_run(
        artifact_kind: ArtifactKind,
        target: impl Into<String>,
        run_id: impl Into<String>,
    ) -> Self {
        Self {
            artifact_kind,
            target: target.into(),
            run_id: Some(run_id.into()),
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
pub struct PurgePlan {
    pub actions: Vec<PurgeAction>,
    pub refusals: Vec<CleanupRefusal>,
}

impl PurgePlan {
    pub fn new(actions: Vec<PurgeAction>, refusals: Vec<CleanupRefusal>) -> Self {
        Self { actions, refusals }
    }

    pub fn is_empty(&self) -> bool {
        self.actions.is_empty() && self.refusals.is_empty()
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
pub struct RetentionPolicy {
    pub keep_runs: usize,
}

impl Default for RetentionPolicy {
    fn default() -> Self {
        Self { keep_runs: 8 }
    }
}

impl RetentionPolicy {
    pub const fn new(keep_runs: usize) -> Self {
        Self { keep_runs }
    }

    pub fn select_removable_runs<'a>(
        &self,
        runs_newest_first: impl IntoIterator<Item = (&'a str, RunState)>,
    ) -> Vec<&'a str> {
        let mut terminal_count = 0;
        let mut removable = Vec::new();
        for (id, state) in runs_newest_first {
            if state.is_terminal() {
                if terminal_count < self.keep_runs {
                    terminal_count += 1;
                } else {
                    removable.push(id);
                }
            }
        }
        removable
    }

    pub fn evaluate_runs<'a>(
        &self,
        runs_newest_first: impl IntoIterator<Item = (&'a str, RunState)>,
    ) -> PurgePlan {
        let mut terminal_count = 0;
        let mut actions = Vec::new();
        let mut refusals = Vec::new();

        for (id, state) in runs_newest_first {
            if state.is_terminal() {
                if terminal_count < self.keep_runs {
                    terminal_count += 1;
                } else {
                    actions.push(PurgeAction::for_run(ArtifactKind::RunRecord, id, id));
                }
            } else {
                refusals.push(CleanupRefusal::new(
                    ArtifactKind::RunRecord,
                    id,
                    RefusalCode::RunNotTerminal,
                    format!("run {} is in non-terminal state {:?}", id, state),
                ));
            }
        }

        PurgePlan::new(actions, refusals)
    }
}

pub fn evaluate_worktree_path(
    project_root: impl AsRef<Path>,
    worktree_path: impl AsRef<Path>,
) -> Result<(), CleanupRefusal> {
    let root = project_root.as_ref();
    let target = worktree_path.as_ref();

    if !root.is_absolute() || !target.is_absolute() {
        return Err(CleanupRefusal::new(
            ArtifactKind::Worktree,
            target.to_string_lossy(),
            RefusalCode::PathOutsideProject,
            "project root and worktree path must be absolute",
        ));
    }

    if root == target {
        return Err(CleanupRefusal::new(
            ArtifactKind::Worktree,
            target.to_string_lossy(),
            RefusalCode::PathIsProjectRoot,
            "worktree path cannot be identical to project root",
        ));
    }

    match target.strip_prefix(root) {
        Ok(relative) if relative.as_os_str().is_empty() => Err(CleanupRefusal::new(
            ArtifactKind::Worktree,
            target.to_string_lossy(),
            RefusalCode::PathIsProjectRoot,
            "worktree path cannot be identical to project root",
        )),
        Ok(relative) => {
            if relative
                .components()
                .any(|c| matches!(c, Component::ParentDir))
            {
                Err(CleanupRefusal::new(
                    ArtifactKind::Worktree,
                    target.to_string_lossy(),
                    RefusalCode::PathOutsideProject,
                    "worktree path must remain strictly inside project root",
                ))
            } else {
                Ok(())
            }
        }
        Err(_) => Err(CleanupRefusal::new(
            ArtifactKind::Worktree,
            target.to_string_lossy(),
            RefusalCode::PathOutsideProject,
            "worktree path must be inside project root",
        )),
    }
}

pub fn evaluate_worktree_removal(
    project_root: impl AsRef<Path>,
    worktree_path: impl AsRef<Path>,
    is_merged: bool,
    is_clean: bool,
) -> Result<(), CleanupRefusal> {
    evaluate_worktree_path(project_root, worktree_path.as_ref())?;

    let target_str = worktree_path.as_ref().to_string_lossy();
    if !is_merged {
        return Err(CleanupRefusal::new(
            ArtifactKind::Worktree,
            target_str,
            RefusalCode::WorktreeUnmerged,
            "worktree has unmerged commits",
        ));
    }

    if !is_clean {
        return Err(CleanupRefusal::new(
            ArtifactKind::Worktree,
            target_str,
            RefusalCode::WorktreeDirty,
            "worktree has uncommitted modifications",
        ));
    }

    Ok(())
}

pub fn evaluate_surface_removal(
    surface_id: impl Into<String>,
    is_owned_by_loop: bool,
) -> Result<(), CleanupRefusal> {
    let surface_id = surface_id.into();
    if !is_owned_by_loop {
        return Err(CleanupRefusal::new(
            ArtifactKind::Surface,
            surface_id,
            RefusalCode::SurfaceNotOwned,
            "caller-owned surface cannot be removed",
        ));
    }
    Ok(())
}

pub fn evaluate_external_session_removal(
    session_id: impl Into<String>,
) -> Result<(), CleanupRefusal> {
    Err(CleanupRefusal::new(
        ArtifactKind::ExternalSession,
        session_id.into(),
        RefusalCode::ExternalSession,
        "external session state is outside Loop scope and must never be deleted",
    ))
}

pub fn evaluate_run_record_removal(
    run_id: impl Into<String>,
    state: RunState,
) -> Result<(), CleanupRefusal> {
    let run_id = run_id.into();
    if !state.is_terminal() {
        return Err(CleanupRefusal::new(
            ArtifactKind::RunRecord,
            run_id,
            RefusalCode::RunNotTerminal,
            format!("cannot purge run in non-terminal state {:?}", state),
        ));
    }
    Ok(())
}
