use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::event::{Event, EventKind};

/// Aggregate, deterministic metrics for one run's ordered event sequence.
///
/// Every counter is derived purely from event kinds; `elapsed_ms` is the only
/// wall-clock field and is never invented here — a caller with a clock (such as
/// a store query joining recorded timings) may fill it in.
#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(default)]
pub struct TraceSummary {
    pub total_events: u32,
    pub tasks_created: u32,
    pub tasks_completed: u32,
    pub worker_starts: u32,
    pub worker_finishes: u32,
    pub worker_failures: u32,
    pub verification_passes: u32,
    pub verification_failures: u32,
    pub attention_created: u32,
    pub attention_resolved: u32,
    pub elapsed_ms: Option<u64>,
}

impl TraceSummary {
    /// Aggregate one run's events in causal order. Callers pass a single run's
    /// event slice; events from other runs must be filtered out beforehand.
    pub fn from_events(events: &[Event]) -> Self {
        let mut summary = Self::default();
        for event in events {
            summary.total_events += 1;
            match &event.kind {
                EventKind::TaskCreated(_) => summary.tasks_created += 1,
                EventKind::TaskCompleted(_) => summary.tasks_completed += 1,
                EventKind::WorkerStarted { .. } => summary.worker_starts += 1,
                EventKind::WorkerFinished { .. } => summary.worker_finishes += 1,
                EventKind::WorkerFailed { .. } => summary.worker_failures += 1,
                EventKind::VerificationPassed { .. } => summary.verification_passes += 1,
                EventKind::VerificationFailed { .. } => summary.verification_failures += 1,
                EventKind::AttentionCreated(_) => summary.attention_created += 1,
                EventKind::AttentionResolved { .. } => summary.attention_resolved += 1,
                EventKind::RunCreated
                | EventKind::RunConfigured { .. }
                | EventKind::GuidanceAdded { .. }
                | EventKind::TaskOutputRecorded { .. }
                | EventKind::CheckReceiptsRecorded { .. }
                | EventKind::TaskActivityRecorded { .. }
                | EventKind::TaskReady(_)
                | EventKind::DecisionRecorded { .. }
                | EventKind::RunCompleted
                | EventKind::RunPauseRequested
                | EventKind::RunPaused
                | EventKind::RunCancellationRequested
                | EventKind::VerificationStopped { .. }
                | EventKind::TaskExecutionReconciled { .. }
                | EventKind::WorkerStopped { .. }
                | EventKind::RunCancelled
                | EventKind::RunResumed
                | EventKind::ArtifactCreated(_)
                | EventKind::ArtifactRemovalRequested { .. }
                | EventKind::ArtifactRemoved { .. } => {}
            }
        }
        summary
    }

    /// Total verification attempts observed (passes plus failures).
    pub fn attempts(&self) -> u32 {
        self.verification_passes + self.verification_failures
    }

    /// Verification retries, i.e. attempts that did not pass.
    pub fn retries(&self) -> u32 {
        self.verification_failures
    }

    /// Score this trace on fixed per-mille scales (0..=1000 per component).
    pub fn score(&self) -> TraceScore {
        if self.total_events == 0 {
            return TraceScore::default();
        }
        TraceScore {
            reliability: per_mille(self.tasks_completed, self.tasks_created),
            autonomy: if self.attention_created == 0 {
                1000
            } else {
                per_mille(self.attention_resolved, self.attention_created)
            },
            first_pass: per_mille(self.verification_passes, self.attempts()),
        }
    }
}

/// Deterministic comparison score for a [`TraceSummary`].
///
/// Each component is per-mille (0..=1000); `total` is therefore 0..=3000.
#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
pub struct TraceScore {
    /// Completed tasks out of created tasks.
    pub reliability: u16,
    /// Resolved attention out of created attention; a run that never needed
    /// attention scores full marks.
    pub autonomy: u16,
    /// Verification passes out of verification attempts.
    pub first_pass: u16,
}

impl TraceScore {
    pub fn total(&self) -> u16 {
        self.reliability + self.autonomy + self.first_pass
    }
}

#[derive(Clone, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
pub struct TraceRanking {
    pub label: String,
    pub score: TraceScore,
}

#[derive(Clone, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
pub struct TraceComparison {
    pub rankings: Vec<TraceRanking>,
}

impl TraceComparison {
    pub fn best(&self) -> Option<&TraceRanking> {
        self.rankings.first()
    }
}

/// Rank labeled traces by score, highest first. Ties break by label ascending
/// so the ordering is fully deterministic.
pub fn compare_traces(
    entries: impl IntoIterator<Item = (impl Into<String>, TraceSummary)>,
) -> TraceComparison {
    let mut rankings: Vec<TraceRanking> = entries
        .into_iter()
        .map(|(label, summary)| TraceRanking {
            label: label.into(),
            score: summary.score(),
        })
        .collect();
    rankings.sort_by(|a, b| {
        b.score
            .total()
            .cmp(&a.score.total())
            .then_with(|| a.label.cmp(&b.label))
    });
    TraceComparison { rankings }
}

fn per_mille(numerator: u32, denominator: u32) -> u16 {
    if denominator == 0 {
        0
    } else {
        ((u64::from(numerator) * 1000) / u64::from(denominator)) as u16
    }
}
