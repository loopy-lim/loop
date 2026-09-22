use loop_core::event::{Event, EventKind};
use loop_store::SqliteStore;

#[test]
#[ignore = "measurement only; reports timings without machine-specific thresholds"]
fn measure_projection_and_append() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = SqliteStore::open(dir.path().join("bench.sqlite")).unwrap();
    store
        .append(&Event::new("bench", EventKind::RunCreated))
        .unwrap();
    let started = std::time::Instant::now();
    for i in 0..1000 {
        store
            .append(&Event::new(
                "bench",
                EventKind::DecisionRecorded {
                    decision_id: format!("d-{i}"),
                    task_id: None,
                    value: "a decision".into(),
                },
            ))
            .unwrap();
    }
    let append_ms = started.elapsed().as_millis();
    let started = std::time::Instant::now();
    for _ in 0..100 {
        assert!(store.projection("bench").unwrap().run_id.is_some());
    }
    println!(
        "append_1000_ms={append_ms} projection_100_ms={}",
        started.elapsed().as_millis()
    );
}
