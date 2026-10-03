//! GuidanceDelivered delivery watermark projection (ADR M-TL2 / A3).
//!
//! The watermark is deterministic core policy: it advances only in ascending
//! event-log sequence order per task, rejects out-of-order or duplicate
//! deliveries, and replays identically from the durable event log.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use loop_core::event::{Event, EventKind, ProjectionError, RunProjection};
use loop_core::policy::ComputeClass;
use loop_core::task::{
    CompletionCheck, CompletionContract, Task, TaskId, TaskKind, WorkOwnership,
};

fn implementation_task(id: &str) -> Task {
    Task::builder(TaskId::from(id), id, TaskKind::Implementation)
        .ownership(WorkOwnership::new(std::iter::empty::<&str>(), ["src/**"]))
        .compute(ComputeClass::Fast, ComputeClass::Tiny, ComputeClass::Strong)
        .completion_contract(CompletionContract::new([CompletionCheck::new("tests")]))
        .build()
        .unwrap()
}

fn guidance_added() -> EventKind {
    EventKind::GuidanceAdded {
        task_id: Some(TaskId::from("impl")),
        message: "keep the boundary intact".into(),
    }
}

fn delivered(task_id: &str, worker_id: &str, through_sequence: i64) -> Event {
    Event::new(
        "run-1",
        EventKind::GuidanceDelivered {
            task_id: TaskId::from(task_id),
            worker_id: worker_id.into(),
            through_sequence,
        },
    )
}

fn projection_with_task() -> RunProjection {
    let mut projection = RunProjection::default();
    for event in [
        Event::new("run-1", EventKind::RunCreated),
        Event::new("run-1", EventKind::TaskCreated(implementation_task("impl"))),
        Event::new("run-1", guidance_added()),
        delivered("impl", "worker-1", 30),
    ] {
        projection.apply(&event).unwrap();
    }
    projection
}

#[test]
fn watermark_advances_only_in_ascending_sequence_order() {
    let mut projection = projection_with_task();
    assert_eq!(projection.guidance_delivered_through[&TaskId::from("impl")], 30);

    // Strictly ascending deliveries advance the watermark.
    projection
        .apply(&delivered("impl", "worker-1", 41))
        .unwrap();
    assert_eq!(projection.guidance_delivered_through[&TaskId::from("impl")], 41);

    // Out-of-order (below the watermark) delivery is rejected.
    let regression = projection.apply(&delivered("impl", "worker-1", 35)).unwrap_err();
    assert!(matches!(
        regression,
        ProjectionError::GuidanceDeliveryRegression { ref task_id, through_sequence, watermark }
            if task_id == &TaskId::from("impl") && through_sequence == 35 && watermark == 41
    ));

    // Duplicate delivery (equal to the watermark) is rejected too.
    let duplicate = projection.apply(&delivered("impl", "worker-1", 41)).unwrap_err();
    assert!(matches!(
        duplicate,
        ProjectionError::GuidanceDeliveryRegression { through_sequence: 41, watermark: 41, .. }
    ));

    // Rejections leave the watermark unchanged.
    assert_eq!(projection.guidance_delivered_through[&TaskId::from("impl")], 41);
}

#[test]
fn watermarks_are_tracked_per_task_independently() {
    let mut projection = RunProjection::default();
    for event in [
        Event::new("run-1", EventKind::RunCreated),
        Event::new("run-1", EventKind::TaskCreated(implementation_task("impl"))),
        Event::new(
            "run-1",
            EventKind::TaskCreated(implementation_task("impl-sub")),
        ),
    ] {
        projection.apply(&event).unwrap();
    }
    projection.apply(&delivered("impl", "worker-1", 55)).unwrap();
    projection
        .apply(&delivered("impl-sub", "worker-2", 12))
        .unwrap();

    assert_eq!(
        projection.guidance_delivered_through.get(&TaskId::from("impl")),
        Some(&55)
    );
    assert_eq!(
        projection
            .guidance_delivered_through
            .get(&TaskId::from("impl-sub")),
        Some(&12)
    );

    // A low watermark on one task does not admit regression on another.
    let regression = projection
        .apply(&delivered("impl", "worker-1", 12))
        .unwrap_err();
    assert!(matches!(
        regression,
        ProjectionError::GuidanceDeliveryRegression { through_sequence: 12, watermark: 55, .. }
    ));
}

#[test]
fn guidance_delivery_requires_a_known_task_and_positive_sequence() {
    let mut projection = RunProjection::default();
    projection
        .apply(&Event::new("run-1", EventKind::RunCreated))
        .unwrap();

    let unknown_task = projection.apply(&delivered("impl", "worker-1", 7)).unwrap_err();
    assert!(matches!(
        unknown_task,
        ProjectionError::TaskNotFound(ref task_id) if task_id == &TaskId::from("impl")
    ));

    projection
        .apply(&Event::new("run-1", EventKind::TaskCreated(implementation_task("impl"))))
        .unwrap();
    for sequence in [0, -3] {
        let invalid = projection
            .apply(&delivered("impl", "worker-1", sequence))
            .unwrap_err();
        assert!(
            matches!(invalid, ProjectionError::InvalidGuidanceSequence(value) if value == sequence)
        );
    }
    assert!(projection.guidance_delivered_through.is_empty());
}

#[test]
fn guidance_delivery_replays_deterministically_from_the_event_log() {
    let events = vec![
        Event::new("run-1", EventKind::RunCreated),
        Event::new("run-1", EventKind::TaskCreated(implementation_task("impl"))),
        Event::new("run-1", guidance_added()),
        delivered("impl", "worker-1", 30),
        delivered("impl", "worker-1", 44),
    ];

    let mut first = RunProjection::default();
    for event in &events {
        first.apply(event).unwrap();
    }

    // Replay of the identical log slice (crash recovery, projection rebuild)
    // must produce the identical watermark.
    let mut replay = RunProjection::default();
    for event in &events {
        replay.apply(event).unwrap();
    }
    assert_eq!(first.guidance_delivered_through, replay.guidance_delivered_through);
    assert_eq!(
        first.guidance_delivered_through[&TaskId::from("impl")],
        44,
        "watermark equals the highest delivered GuidanceAdded sequence"
    );

    // The durable wire form is stable: the reducer accepts the event back from
    // its serialized log representation (serde tag/content, snake_case).
    let serialized = serde_json::to_value(&events[4]).unwrap();
    assert_eq!(
        serialized["kind"]["type"],
        serde_json::Value::String("guidance_delivered".into())
    );
    assert_eq!(serialized["kind"]["data"]["through_sequence"], 44);
    let deserialized: Event = serde_json::from_value(serialized).unwrap();
    let mut from_log = RunProjection::default();
    for event in &events[..4] {
        from_log.apply(event).unwrap();
    }
    from_log.apply(&deserialized).unwrap();
    assert_eq!(from_log.guidance_delivered_through, replay.guidance_delivered_through);
}

#[test]
fn delivered_guidance_keeps_the_recorded_steer_fallback() {
    let projection = projection_with_task();

    // The watermark records live delivery only; the guidance list (the
    // recorded-steer fallback for the next claim context) is untouched, so
    // delivery bookkeeping never erases run history.
    assert_eq!(projection.guidance.len(), 1);
    assert_eq!(projection.guidance[0].message, "keep the boundary intact");
    assert_eq!(projection.guidance_delivered_through[&TaskId::from("impl")], 30);
}
