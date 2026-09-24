use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::policy::FailurePolicy;

use super::TaskId;

#[derive(Clone, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Assumption {
    pub assumption: String,
    pub evidence: String,
    pub if_false: String,
    pub revisit: String,
}

impl Assumption {
    pub fn new(
        assumption: impl Into<String>,
        evidence: impl Into<String>,
        if_false: impl Into<String>,
        revisit: impl Into<String>,
    ) -> Self {
        Self {
            assumption: assumption.into(),
            evidence: evidence.into(),
            if_false: if_false.into(),
            revisit: revisit.into(),
        }
    }

    pub(crate) fn is_complete(&self) -> bool {
        [
            self.assumption.as_str(),
            self.evidence.as_str(),
            self.if_false.as_str(),
            self.revisit.as_str(),
        ]
        .into_iter()
        .all(|value| !value.trim().is_empty())
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SemanticAccess {
    Consume,
    Modify,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SemanticConflictResolution {
    Unresolved,
    Serialize,
    DependencyOrder,
}

#[derive(Clone, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticTouchpoint {
    pub id: String,
    pub access: SemanticAccess,
    pub conflict_resolution: SemanticConflictResolution,
}

impl SemanticTouchpoint {
    pub fn new(
        id: impl Into<String>,
        access: SemanticAccess,
        conflict_resolution: SemanticConflictResolution,
    ) -> Self {
        Self {
            id: id.into(),
            access,
            conflict_resolution,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DependencyConsumption {
    pub dependency: TaskId,
    pub decisions: Vec<String>,
    pub artifacts: Vec<String>,
    pub checks: Vec<String>,
    pub risks: Vec<String>,
}

impl DependencyConsumption {
    pub fn new<D, A, C, R, DS, AS, CS, RS>(
        dependency: TaskId,
        decisions: D,
        artifacts: A,
        checks: C,
        risks: R,
    ) -> Self
    where
        D: IntoIterator<Item = DS>,
        A: IntoIterator<Item = AS>,
        C: IntoIterator<Item = CS>,
        R: IntoIterator<Item = RS>,
        DS: Into<String>,
        AS: Into<String>,
        CS: Into<String>,
        RS: Into<String>,
    {
        Self {
            dependency,
            decisions: decisions.into_iter().map(Into::into).collect(),
            artifacts: artifacts.into_iter().map(Into::into).collect(),
            checks: checks.into_iter().map(Into::into).collect(),
            risks: risks.into_iter().map(Into::into).collect(),
        }
    }

    pub(crate) fn has_input(&self) -> bool {
        self.decisions
            .iter()
            .chain(&self.artifacts)
            .chain(&self.checks)
            .chain(&self.risks)
            .any(|value| !value.trim().is_empty())
    }
}

#[derive(Clone, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DecompositionContract {
    pub defaults: Vec<String>,
    pub assumptions: Vec<Assumption>,
    pub semantic_touchpoints: Vec<SemanticTouchpoint>,
    pub consumes: Vec<DependencyConsumption>,
    pub failure_policy: FailurePolicy,
}

impl DecompositionContract {
    pub fn new<D, DS>(
        defaults: D,
        assumptions: impl IntoIterator<Item = Assumption>,
        semantic_touchpoints: impl IntoIterator<Item = SemanticTouchpoint>,
        consumes: impl IntoIterator<Item = DependencyConsumption>,
        failure_policy: FailurePolicy,
    ) -> Self
    where
        D: IntoIterator<Item = DS>,
        DS: Into<String>,
    {
        Self {
            defaults: defaults.into_iter().map(Into::into).collect(),
            assumptions: assumptions.into_iter().collect(),
            semantic_touchpoints: semantic_touchpoints.into_iter().collect(),
            consumes: consumes.into_iter().collect(),
            failure_policy,
        }
    }
}
