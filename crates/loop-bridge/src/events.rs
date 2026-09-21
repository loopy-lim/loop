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
