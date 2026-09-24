use std::collections::BTreeMap;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceLevel {
    Static,
    Unit,
    Fake,
    Integration,
    Live,
}

#[derive(Clone, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletionCoverage {
    pub requirements: Vec<String>,
    pub artifacts: Vec<String>,
    pub semantics: Vec<String>,
    pub evidence_level: EvidenceLevel,
}

impl CompletionCoverage {
    pub fn new<R, A, S, RS, AS, SS>(
        requirements: R,
        artifacts: A,
        semantics: S,
        evidence_level: EvidenceLevel,
    ) -> Self
    where
        R: IntoIterator<Item = RS>,
        A: IntoIterator<Item = AS>,
        S: IntoIterator<Item = SS>,
        RS: Into<String>,
        AS: Into<String>,
        SS: Into<String>,
    {
        Self {
            requirements: requirements.into_iter().map(Into::into).collect(),
            artifacts: artifacts.into_iter().map(Into::into).collect(),
            semantics: semantics.into_iter().map(Into::into).collect(),
            evidence_level,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct CompletionCheck {
    pub id: String,
    pub command: String,
    pub args: Vec<String>,
    pub working_directory: Option<String>,
    pub timeout_ms: u64,
    #[serde(default)]
    pub coverage: Option<CompletionCoverage>,
}

impl CompletionCheck {
    pub fn new(id: impl Into<String>) -> Self {
        let id = id.into();
        Self {
            command: id.clone(),
            id,
            args: Vec::new(),
            working_directory: None,
            timeout_ms: 120_000,
            coverage: None,
        }
    }

    pub fn command(
        id: impl Into<String>,
        command: impl Into<String>,
        args: impl IntoIterator<Item = impl Into<String>>,
        working_directory: Option<String>,
        timeout_ms: u64,
    ) -> Self {
        Self {
            id: id.into(),
            command: command.into(),
            args: args.into_iter().map(Into::into).collect(),
            working_directory,
            timeout_ms,
            coverage: None,
        }
    }

    pub fn coverage(mut self, coverage: CompletionCoverage) -> Self {
        self.coverage = Some(coverage);
        self
    }
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct CompletionContract {
    pub checks: Vec<CompletionCheck>,
}

impl CompletionContract {
    pub fn new(checks: impl IntoIterator<Item = CompletionCheck>) -> Self {
        Self {
            checks: checks.into_iter().collect(),
        }
    }

    pub fn is_satisfied_by(&self, evidence: &VerificationEvidence) -> bool {
        !self.checks.is_empty()
            && self
                .checks
                .iter()
                .all(|check| evidence.checks.get(&check.id) == Some(&true))
    }
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct VerificationEvidence {
    pub checks: BTreeMap<String, bool>,
}

impl VerificationEvidence {
    pub fn new<I, K>(checks: I) -> Self
    where
        I: IntoIterator<Item = (K, bool)>,
        K: Into<String>,
    {
        Self {
            checks: checks
                .into_iter()
                .map(|(id, passed)| (id.into(), passed))
                .collect(),
        }
    }
}
