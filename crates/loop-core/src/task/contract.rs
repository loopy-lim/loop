use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct CompletionCheck {
    pub id: String,
    pub command: String,
    pub args: Vec<String>,
    pub working_directory: Option<String>,
    pub timeout_ms: u64,
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
        }
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
