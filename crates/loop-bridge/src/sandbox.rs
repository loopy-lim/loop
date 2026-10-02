//! Wire types for adapter sandbox capability declaration (gap analysis G4a —
//! 샌드박스 능력 선언, 부분도입).
//!
//! Boundary: these types live only in the bridge (transport form). Loop does
//! not implement OS isolation; declared write scopes remain a scheduler
//! collision-avoidance contract, not a security boundary. Adapters declare
//! what isolation they CAN apply, and reporting surfaces (e.g. `loop doctor`)
//! relay the declaration honestly — an absent capability is `none`, never
//! inferred from write scopes.

use rustra::prelude::*;

/// Honestly-declared OS isolation strength an adapter applies around worker
/// execution (G4a). Variant casing follows the bridge codegen's camelCase
/// rule, so the wire values are `none` / `partial` / `enforced`.
#[bridge_type]
pub enum SandboxIsolation {
    /// No OS isolation: worker commands run with the caller's full authority
    /// and write scopes are advisory only.
    None,
    /// Best-effort isolation (allowlists, policy files, reduced tokens) that
    /// a determined process may escape; not a security boundary.
    Partial,
    /// OS-enforced isolation (container, seatbelt profile, restricted token)
    /// applied to every worker start.
    Enforced,
}

/// One adapter's sandbox capability declaration (G4a): what the adapter can
/// offer, reported by diagnostic surfaces. The declaration is adapter
/// metadata — never loop-core state — and an adapter with no sandbox support
/// declares `isolation: none` rather than omitting itself.
#[bridge_type]
pub struct SandboxCapabilityDeclaration {
    /// Adapter-reported identity label (e.g. "codex", "herdr"); opaque to
    /// the bridge.
    pub adapter_id: String,
    pub isolation: SandboxIsolation,
    /// True when the adapter can confine writes to the declared write scope
    /// at the OS level; false means write scope is a scheduler contract only.
    pub filesystem_scoped: bool,
    /// True when the adapter can block worker network egress.
    pub network_isolated: bool,
    /// Bounded human note on the mechanism and its limits; null when the
    /// flags say everything the adapter can honestly claim.
    pub detail: Option<String>,
}

/// Inventory of adapter sandbox capability declarations (G4a), mirroring the
/// session/pane list-report shape: one declaration per adapter known to the
/// reporter.
#[bridge_type]
pub struct SandboxCapabilityReport {
    pub capabilities: Vec<SandboxCapabilityDeclaration>,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The capability report round-trips serde JSON without loss (regression
    /// guard for the `#[bridge_type]` camelCase contract) and honest absence
    /// survives the round trip.
    #[test]
    fn sandbox_report_round_trips_through_serde_json() {
        let report = SandboxCapabilityReport {
            capabilities: vec![
                SandboxCapabilityDeclaration {
                    adapter_id: "codex".into(),
                    isolation: SandboxIsolation::Enforced,
                    filesystem_scoped: true,
                    network_isolated: false,
                    detail: Some("seatbelt profile, network allowed".into()),
                },
                SandboxCapabilityDeclaration {
                    adapter_id: "fake".into(),
                    isolation: SandboxIsolation::None,
                    filesystem_scoped: false,
                    network_isolated: false,
                    detail: None,
                },
            ],
        };
        let json = serde_json::to_string(&report).unwrap();
        assert!(json.contains(r#""adapterId":"codex""#));
        assert!(json.contains(r#""isolation":"enforced""#));
        assert!(json.contains(r#""isolation":"none""#));
        assert!(json.contains(r#""filesystemScoped":true"#));
        assert!(json.contains(r#""networkIsolated":false"#));
        assert!(json.contains(r#""detail":null"#));
        let parsed: SandboxCapabilityReport = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.capabilities.len(), 2);
        assert!(matches!(
            parsed.capabilities[0].isolation,
            SandboxIsolation::Enforced
        ));
        assert!(parsed.capabilities[1].detail.is_none());

        // Honesty invariant: an adapter with no sandbox support is declared
        // as `none` (never omitted from the inventory).
        let parsed: SandboxCapabilityReport = serde_json::from_str(
            r#"{"capabilities":[{"adapterId":"x","isolation":"none","filesystemScoped":false,"networkIsolated":false,"detail":null}]}"#,
        )
        .unwrap();
        assert!(matches!(
            parsed.capabilities[0].isolation,
            SandboxIsolation::None
        ));
    }

    /// The isolation vocabulary is fixed at v1: `none` / `partial` /
    /// `enforced`.
    #[test]
    fn sandbox_isolation_wire_vocabulary_is_fixed() {
        for (variant, wire) in [
            (SandboxIsolation::None, "none"),
            (SandboxIsolation::Partial, "partial"),
            (SandboxIsolation::Enforced, "enforced"),
        ] {
            assert_eq!(serde_json::to_string(&variant).unwrap(), format!(r#""{wire}""#));
        }
    }

    /// Schema presence: the loop package schema anchors the capability
    /// report payload under its rustra event name so diagnostic surfaces
    /// consume GENERATED wire types only.
    #[test]
    fn package_schema_anchors_sandbox_capability_report() {
        let schema = serde_json::to_string(&crate::loop_package().live_schema()).unwrap();
        assert!(schema.contains(r#""name":"loop.sandbox_capabilities""#));
        for definition in [
            "SandboxCapabilityReport",
            "SandboxCapabilityDeclaration",
            "SandboxIsolation",
        ] {
            assert!(
                schema.contains(&format!(r#""{definition}""#)),
                "missing definition {definition}"
            );
        }
    }
}
