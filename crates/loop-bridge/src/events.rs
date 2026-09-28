use rustra::prelude::*;

#[bridge_type]
pub struct EventOutput {
    pub sequence: i64,
    pub payload_json: String,
}

#[bridge_type]
pub struct RunChangedEvent {
    pub run_id: String,
    pub last_sequence: i64,
}

/// Wire shape of a steer-mailbox delivery record (ADR M-TL2): the mailbox
/// appends one of these per live worker after a successful `provider.steer`,
/// marking every `GuidanceAdded` at or below `through_sequence` as received by
/// that worker's task. The delivery watermark projection lives in loop-core;
/// this type is only the transport form (see `record_guidance_delivered`).
#[bridge_type]
pub struct GuidanceDeliveredEvent {
    pub task_id: String,
    pub worker_id: String,
    pub through_sequence: i64,
}
