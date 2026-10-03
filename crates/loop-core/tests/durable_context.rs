#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
use loop_core::event::{Event, RunProjection};
use serde_json::json;

#[test]
fn execution_context_and_guidance_survive_replay() {
    let events = vec![
        json!({"run_id":"run", "kind":{"type":"run_created"}}),
        json!({"run_id":"run", "kind":{"type":"run_configured","data":{"intent":"Improve graph", "working_directory":"/project"}}}),
        json!({"run_id":"run", "kind":{"type":"guidance_added","data":{"task_id":null,"message":"Keep the public interface stable"}}}),
    ];
    let mut projection = RunProjection::default();
    for value in events {
        let parsed = serde_json::from_value::<Event>(value);
        assert!(parsed.is_ok(), "durable context event rejected: {parsed:?}");
        projection.apply(&parsed.unwrap()).unwrap();
    }
    assert_eq!(projection.intent, "Improve graph");
    assert_eq!(projection.working_directory, "/project");
    assert_eq!(
        projection.guidance[0].message,
        "Keep the public interface stable"
    );
}
