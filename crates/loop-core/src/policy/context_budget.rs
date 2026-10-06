use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::FailureClass;

/// Per-field head bound for a required context field (intent, requirement,
/// guidance item, previous failure). Matches the worker prompt renderer's
/// required-field limit, which throws above it.
pub const DEFAULT_MAX_FIELD_CHARS: usize = 6_000;
/// Total bound for the assembled essential contract. Matches the worker
/// prompt renderer's essential limit, which throws above it.
pub const DEFAULT_MAX_PROMPT_CHARS: usize = 16_000;
/// Head bound for one advisory body after compaction (dependency result
/// summary, previous result summary, check-receipt output). The full body
/// stays in the run store / artifacts; the context carries the bounded head
/// plus a truncation marker pointing there.
pub const DEFAULT_COMPACTED_BODY_CHARS: usize = 500;
/// Head bound for one dependency result summary in a fresh dispatch.
pub const DEFAULT_DEPENDENCY_SUMMARY_CHARS: usize = 2_000;
/// Conservative fixed cost the worker prompt renderer adds around the
/// context fields: section titles, framing, the boilerplate worker
/// instructions block, and the small task-line fields. The dispatch
/// decision only needs the estimate to be an upper bound, so slack here is
/// deliberate.
pub const PROMPT_OVERHEAD_CHARS: usize = 2_000;

/// UTF-16 code-unit length of `text`. The worker prompt renderer measures
/// limits in JavaScript string length (UTF-16 units), so the budget must
/// count the same unit or astral characters could slip past the bound.
pub fn utf16_len(text: &str) -> usize {
    text.chars().map(char::len_utf16).sum()
}

/// Longest prefix of `text` within `limit` UTF-16 code units, always cut on
/// a char boundary. Never splits a surrogate pair.
pub fn utf16_head(text: &str, limit: usize) -> String {
    let mut head = String::with_capacity(text.len());
    let mut units = 0;
    for ch in text.chars() {
        let len = ch.len_utf16();
        if units + len > limit {
            break;
        }
        head.push(ch);
        units += len;
    }
    head
}

/// One clamped text field: the bounded replacement plus how many UTF-16
/// units the original carried beyond the kept head. `dropped_chars == 0`
/// means the input was already within the bound and passed through intact.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct ClampedText {
    pub text: String,
    pub dropped_chars: u32,
}

impl ClampedText {
    fn unchanged(text: &str) -> Self {
        Self {
            text: text.to_string(),
            dropped_chars: 0,
        }
    }
}

fn truncation_marker(dropped_chars: u32, reference: Option<&str>) -> String {
    match reference {
        Some(reference) => {
            format!("\n[truncated {dropped_chars} chars; full text: {reference}]")
        }
        None => format!("\n[truncated {dropped_chars} chars; full text in the run store]"),
    }
}

/// Ordered deterministic reductions applied when the estimated essential
/// contract exceeds the total prompt bound. Compaction follows the
/// reference design (pi compaction, docs/defects/limits-inventory.md §4):
/// lighten the oldest advisory bulk first and instructions last, exactly
/// once per dispatch, and never touch the completion contract itself.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ReductionPass {
    /// Dependency result summaries and the previous result summary compress
    /// to `compacted_body_chars` heads with store references.
    CompactAdvisory,
    /// Guidance items additionally compress to `compacted_body_chars` heads.
    CompactGuidance,
}

/// Deterministic context-budget policy for worker dispatch
/// (docs/defects/limits-inventory.md R1·R2·R4). The bounds mirror the worker
/// prompt renderer's hard limits, so a context assembled under this policy
/// can never make prompt assembly throw; retries after a limit/stall failure
/// continue on a compacted context instead of resending the full prior one.
#[derive(
    Clone, Copy, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize,
)]
#[serde(rename_all = "camelCase")]
pub struct ContextBudgetPolicy {
    pub max_field_chars: usize,
    pub max_prompt_chars: usize,
    pub compacted_body_chars: usize,
    pub dependency_summary_chars: usize,
}

impl Default for ContextBudgetPolicy {
    fn default() -> Self {
        Self {
            max_field_chars: DEFAULT_MAX_FIELD_CHARS,
            max_prompt_chars: DEFAULT_MAX_PROMPT_CHARS,
            compacted_body_chars: DEFAULT_COMPACTED_BODY_CHARS,
            dependency_summary_chars: DEFAULT_DEPENDENCY_SUMMARY_CHARS,
        }
    }
}

/// Markers identifying an attempt that died on a limit — silence stall,
/// run/check timeout, or the worker prompt budget — rather than on check
/// evidence. Matched case-insensitively over the stored failure reason,
/// mirroring [`FailureClass::classify_transport`].
const STALL_OR_LIMIT_MARKERS: [&str; 5] = [
    "worker stalled",
    "stall threshold",
    "timed out",
    "(timeout)",
    "worker prompt essential contract",
];

/// Failure reason substrings that identify a worker prompt-budget overflow.
/// These reproduce identically on every retry of the same context, so they
/// must classify as `FailureClass::InvalidContract` (deterministic,
/// terminal) instead of consuming the attempt ladder as `Environment`.
const PROMPT_LIMIT_MARKERS: [&str; 3] = [
    "worker prompt essential contract",
    "exceeds 6000 characters",
    "exceeds 16000 characters",
];

impl ContextBudgetPolicy {
    /// Bound one required context field: within the limit it passes through
    /// byte-identical; above it, a bounded head plus a truncation marker
    /// naming the run store stays inside the same limit.
    pub fn clamp_required_field(&self, text: &str) -> ClampedText {
        self.bounded_head(text, self.max_field_chars, None)
    }

    /// Bound one advisory body, pointing at `reference` (an artifact path or
    /// the dependency task identity) for the dropped tail.
    pub fn clamp_body(&self, text: &str, reference: Option<&str>) -> ClampedText {
        self.bounded_head(text, self.dependency_summary_chars, reference)
    }

    /// Bound one body to the compacted head size used by retry compaction
    /// and the total-budget ladder.
    pub fn compact_body(&self, text: &str, reference: Option<&str>) -> ClampedText {
        self.bounded_head(text, self.compacted_body_chars, reference)
    }

    /// Head of `text` within `limit` UTF-16 units including the truncation
    /// marker, so the replacement never exceeds the bound it replaced. The
    /// exact dropped count is only known after the head is cut (and the
    /// marker reserves space inside the limit), so the marker is re-cut once
    /// if its digit count grew.
    fn bounded_head(&self, text: &str, limit: usize, reference: Option<&str>) -> ClampedText {
        let total = utf16_len(text);
        if total <= limit {
            return ClampedText::unchanged(text);
        }
        let mut marker = truncation_marker((total - limit) as u32, reference);
        let mut head = utf16_head(text, limit.saturating_sub(utf16_len(&marker)));
        for _ in 0..2 {
            let dropped = (total - utf16_len(&head)) as u32;
            let exact = truncation_marker(dropped, reference);
            if utf16_len(&exact) <= limit.saturating_sub(utf16_len(&head)) {
                return ClampedText {
                    text: format!("{head}{exact}"),
                    dropped_chars: dropped,
                };
            }
            marker = exact;
            head = utf16_head(text, limit.saturating_sub(utf16_len(&marker)));
        }
        // Degenerate bound smaller than the marker: keep a plain head.
        let dropped = (total - utf16_len(&head)) as u32;
        ClampedText {
            text: head,
            dropped_chars: dropped,
        }
    }

    /// Whether the next attempt after `previous_failure` continues on a
    /// compacted context instead of the full prior one. An attempt that died
    /// on a limit (stall, timeout, prompt overflow) re-sent into the same
    /// conditions would repeat the failure; an attempt that died on check
    /// evidence keeps its failure receipts verbatim because they are the
    /// repair input.
    pub fn retry_continues_compacted(previous_failure: Option<&str>) -> bool {
        let Some(reason) = previous_failure else {
            return false;
        };
        let haystack = reason.to_ascii_lowercase();
        STALL_OR_LIMIT_MARKERS
            .iter()
            .any(|marker| haystack.contains(marker))
    }

    /// Deterministic limit-failure detection over a recorded worker-result
    /// reason (inventory R2). Returns `Some(FailureClass::InvalidContract)`
    /// for prompt-budget overflows so the deterministic failure terminalizes
    /// with a precise class after one attempt instead of burning the ladder.
    pub fn classify_limit_failure(reason: &str) -> Option<FailureClass> {
        let haystack = reason.to_ascii_lowercase();
        PROMPT_LIMIT_MARKERS
            .iter()
            .any(|marker| haystack.contains(marker))
            .then_some(FailureClass::InvalidContract)
    }

    /// Next ladder pass when the estimated essential contract exceeds the
    /// total bound, given how many passes already applied. `None` means the
    /// estimate fits or the ladder is exhausted; an exhausted ladder leaves
    /// the context at its most-compacted state and the deterministic prompt
    /// renderer limit (and the `InvalidContract` classification above) is the
    /// final safety net.
    pub fn next_total_reduction(
        &self,
        estimated_chars: usize,
        passes_applied: u32,
    ) -> Option<ReductionPass> {
        if estimated_chars <= self.max_prompt_chars {
            return None;
        }
        match passes_applied {
            0 => Some(ReductionPass::CompactAdvisory),
            1 => Some(ReductionPass::CompactGuidance),
            _ => None,
        }
    }
}

#[cfg(test)]
mod context_budget_tests {
    use super::*;

    #[test]
    fn field_within_limit_passes_through_byte_identical() {
        let policy = ContextBudgetPolicy::default();
        let clamped = policy.clamp_required_field("exactly fine");
        assert_eq!(clamped.text, "exactly fine");
        assert_eq!(clamped.dropped_chars, 0);
    }

    /// Inventory §2 #1/#4: a 6,001-char previous failure or intent used to
    /// reach the renderer verbatim and throw on every attempt.
    #[test]
    fn oversized_field_clamps_to_bounded_head_with_marker() {
        let policy = ContextBudgetPolicy::default();
        let clamped = policy.clamp_required_field("F".repeat(6_100).as_str());
        assert!(utf16_len(&clamped.text) <= policy.max_field_chars);
        assert!(clamped.text.contains("truncated"));
        assert!(clamped.text.contains("full text in the run store"));
        assert!(clamped.dropped_chars > 0 && clamped.dropped_chars < 200);
    }

    #[test]
    fn body_clamp_names_the_artifact_reference() {
        let policy = ContextBudgetPolicy::default();
        let clamped = policy.compact_body("o".repeat(20_000).as_str(), Some("/artifacts/a.log"));
        assert!(utf16_len(&clamped.text) <= policy.compacted_body_chars);
        assert!(clamped.text.contains("/artifacts/a.log"));
    }

    /// The prompt renderer measures limits in UTF-16 units; four-byte
    /// characters count as two. The budget must not let astral text slip
    /// past the bound.
    #[test]
    fn astral_characters_count_as_two_utf16_units() {
        let policy = ContextBudgetPolicy::default();
        let astral = "🦀".repeat(4_000); // 4,000 chars but 8,000 UTF-16 units
        assert_eq!(utf16_len(&astral), 8_000);
        let clamped = policy.clamp_required_field(&astral);
        assert!(utf16_len(&clamped.text) <= policy.max_field_chars);
    }

    #[test]
    fn retry_compacts_after_stall_timeout_and_prompt_limit_failures() {
        for reason in [
            "Worker stalled: no progress for 900s (stall threshold 900s); failing the attempt for the retry policy",
            "worker timed out after 30m",
            "check tests: exit 124 (timeout)",
            "Worker prompt essential contract exceeds 16000 characters; split the task or shorten guidance before dispatch",
        ] {
            assert!(
                ContextBudgetPolicy::retry_continues_compacted(Some(reason)),
                "expected compacted continuation for: {reason}"
            );
        }
    }

    /// Check-evidence retries keep their receipts verbatim: they are the
    /// repair input, not a repeated hazard.
    #[test]
    fn assertion_retry_keeps_the_full_context() {
        for reason in [
            "check tests: exit 1\nassertion failed: expected 3, got 4",
            "",
        ] {
            assert!(!ContextBudgetPolicy::retry_continues_compacted(Some(reason)));
        }
        assert!(!ContextBudgetPolicy::retry_continues_compacted(None));
    }

    #[test]
    fn prompt_limit_failures_classify_as_invalid_contract() {
        assert_eq!(
            ContextBudgetPolicy::classify_limit_failure(
                "Worker prompt essential contract field exceeds 6000 characters; split the task or shorten guidance before dispatch",
            ),
            Some(FailureClass::InvalidContract)
        );
        assert_eq!(
            ContextBudgetPolicy::classify_limit_failure("assertion failed: expected 3, got 4"),
            None
        );
    }

    #[test]
    fn ladder_compacts_advisory_then_guidance_then_stops() {
        let policy = ContextBudgetPolicy::default();
        assert_eq!(
            policy.next_total_reduction(policy.max_prompt_chars - 1, 0),
            None,
            "within the bound nothing compacts"
        );
        assert_eq!(
            policy.next_total_reduction(policy.max_prompt_chars + 1, 0),
            Some(ReductionPass::CompactAdvisory)
        );
        assert_eq!(
            policy.next_total_reduction(policy.max_prompt_chars + 1, 1),
            Some(ReductionPass::CompactGuidance)
        );
        assert_eq!(
            policy.next_total_reduction(policy.max_prompt_chars + 1, 2),
            None,
            "ladder exhaustion leaves the deterministic renderer limit as the safety net"
        );
    }
}
