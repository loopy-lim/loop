/// Freshness of a running task, derived from recorded progress timestamps.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProgressFreshness {
    Fresh,
    Stalled,
}

/// Missing progress is not evidence of health. Future timestamps are treated as fresh
/// to tolerate clock corrections; a zero threshold stalls immediately.
pub fn progress_freshness(
    now_ms: i64,
    last_progress_ms: Option<i64>,
    threshold_ms: i64,
) -> ProgressFreshness {
    match last_progress_ms {
        Some(last) if now_ms.saturating_sub(last) < threshold_ms.max(0) => ProgressFreshness::Fresh,
        _ => ProgressFreshness::Stalled,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derives_stall_at_boundary_and_for_missing_progress() {
        assert_eq!(
            progress_freshness(110, Some(100), 11),
            ProgressFreshness::Fresh
        );
        assert_eq!(
            progress_freshness(111, Some(100), 11),
            ProgressFreshness::Stalled
        );
        assert_eq!(
            progress_freshness(111, None, 11),
            ProgressFreshness::Stalled
        );
        assert_eq!(
            progress_freshness(90, Some(100), 11),
            ProgressFreshness::Fresh
        );
    }
}
