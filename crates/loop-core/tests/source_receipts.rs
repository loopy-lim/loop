use loop_core::event::SourceReceipt;
use loop_core::task::WorkOwnership;

#[test]
fn source_receipt_only_binds_a_check_to_unchanged_source() {
    let receipt = SourceReceipt {
        before_fingerprint: "before".into(),
        after_fingerprint: "after".into(),
        observed_changed_paths: vec!["src/owned.rs".into()],
        observed_outside_write_scope: Vec::new(),
    };
    assert!(!receipt.is_stable());
    assert!(
        SourceReceipt {
            after_fingerprint: "before".into(),
            ..receipt
        }
        .is_stable()
    );
}

#[test]
fn observed_paths_outside_write_scope_remain_unattributed() {
    let ownership = WorkOwnership::new(["src/**"], ["src/**"]);
    assert_eq!(
        ownership.observed_outside_write_scope(&[
            "src/owned.rs".into(),
            "src2/user.rs".into(),
            "docs/other.md".into(),
        ]),
        vec!["docs/other.md", "src2/user.rs"]
    );
    assert!(
        !WorkOwnership::new(Vec::<String>::new(), ["src/**"]).write_scope_contains("src2/a.rs")
    );
}
