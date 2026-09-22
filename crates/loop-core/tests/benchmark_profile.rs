use std::str::FromStr;

use loop_core::benchmark::WorkflowProfile;

#[test]
fn profiles_parse_from_their_canonical_names() {
    assert_eq!(
        WorkflowProfile::from_str("plan-first"),
        Ok(WorkflowProfile::PlanFirst)
    );
    assert_eq!(
        WorkflowProfile::from_str("spike-first"),
        Ok(WorkflowProfile::SpikeFirst)
    );
    assert_eq!(
        WorkflowProfile::from_str("tdd-first"),
        Ok(WorkflowProfile::TddFirst)
    );
}

#[test]
fn unknown_profiles_are_rejected_with_the_input_echoed() {
    let error = WorkflowProfile::from_str("vibes-first").unwrap_err();
    assert_eq!(error, "unknown workflow profile: vibes-first");
}

#[test]
fn profile_display_matches_the_parse_format() {
    for profile in WorkflowProfile::ALL {
        assert_eq!(profile.to_string(), profile.as_str());
        assert_eq!(WorkflowProfile::from_str(profile.as_str()), Ok(profile));
    }
}

#[test]
fn profiles_round_trip_through_json_as_kebab_case_names() {
    for profile in WorkflowProfile::ALL {
        let serialized = serde_json::to_string(&profile).unwrap();
        assert_eq!(serialized, format!("\"{profile}\""));
        let deserialized: WorkflowProfile = serde_json::from_str(&serialized).unwrap();
        assert_eq!(deserialized, profile);
    }
}

#[test]
fn all_lists_every_profile_exactly_once() {
    let mut seen = WorkflowProfile::ALL.to_vec();
    seen.sort_by_key(|profile| profile.as_str());
    seen.dedup();
    assert_eq!(seen.len(), WorkflowProfile::ALL.len());
    assert_eq!(WorkflowProfile::ALL.len(), 3);
}
