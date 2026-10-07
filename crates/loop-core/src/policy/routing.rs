use std::collections::BTreeSet;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use super::ComputeClass;

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Risk {
    #[default]
    Low,
    Medium,
    High,
    Critical,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
pub struct ComputeCapabilities {
    pub coding: u8,
    pub reasoning: u8,
    pub tools: u8,
    pub vision: u8,
    pub long_context: u8,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
pub struct TaskRouting {
    pub risk: Risk,
    pub required: ComputeCapabilities,
}

impl ComputeCapabilities {
    pub const fn new(coding: u8, reasoning: u8, tools: u8, vision: u8, long_context: u8) -> Self {
        Self {
            coding,
            reasoning,
            tools,
            vision,
            long_context,
        }
    }

    fn satisfies(self, required: Self) -> bool {
        self.coding >= required.coding
            && self.reasoning >= required.reasoning
            && self.tools >= required.tools
            && self.vision >= required.vision
            && self.long_context >= required.long_context
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ComputeCandidate {
    pub id: String,
    pub compute_class: ComputeClass,
    pub capabilities: ComputeCapabilities,
    pub latency: u16,
    pub cost_weight: u16,
    pub available: bool,
}

impl ComputeCandidate {
    pub fn new(
        id: impl Into<String>,
        compute_class: ComputeClass,
        capabilities: ComputeCapabilities,
        latency: u16,
        cost_weight: u16,
    ) -> Self {
        Self {
            id: id.into(),
            compute_class,
            capabilities,
            latency,
            cost_weight,
            available: true,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct CapabilityRequirements {
    capabilities: ComputeCapabilities,
    minimum_compute: ComputeClass,
    maximum_compute: ComputeClass,
    risk: Risk,
    high_risk_floor: ComputeClass,
    critical_risk_floor: ComputeClass,
}

impl CapabilityRequirements {
    pub const fn new(coding: u8, reasoning: u8, tools: u8, vision: u8, long_context: u8) -> Self {
        Self {
            capabilities: ComputeCapabilities::new(coding, reasoning, tools, vision, long_context),
            minimum_compute: ComputeClass::Tiny,
            maximum_compute: ComputeClass::Frontier,
            risk: Risk::Low,
            high_risk_floor: ComputeClass::Strong,
            critical_risk_floor: ComputeClass::Frontier,
        }
    }

    pub const fn with_compute_range(
        mut self,
        minimum: ComputeClass,
        maximum: ComputeClass,
    ) -> Self {
        self.minimum_compute = minimum;
        self.maximum_compute = maximum;
        self
    }

    pub const fn with_risk(mut self, risk: Risk) -> Self {
        self.risk = risk;
        self
    }

    pub const fn with_risk_floors(mut self, high: ComputeClass, critical: ComputeClass) -> Self {
        self.high_risk_floor = high;
        self.critical_risk_floor = critical;
        self
    }

    fn effective_minimum(self) -> ComputeClass {
        let risk_floor = match self.risk {
            Risk::Low | Risk::Medium => ComputeClass::Tiny,
            Risk::High => self.high_risk_floor,
            Risk::Critical => self.critical_risk_floor,
        };
        self.minimum_compute.max(risk_floor)
    }
}

/// A capability requirement that the graduated relaxation ladder can step
/// down. The order is core policy: relax the least load-bearing senses first
/// (perception before tooling before reasoning before coding), then the risk
/// floor, so each step frees the cheapest constraint before a heavier one.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CapabilityKind {
    Vision,
    LongContext,
    Tools,
    Reasoning,
    Coding,
}

impl CapabilityKind {
    fn level(self, capabilities: ComputeCapabilities) -> u8 {
        match self {
            Self::Vision => capabilities.vision,
            Self::LongContext => capabilities.long_context,
            Self::Tools => capabilities.tools,
            Self::Reasoning => capabilities.reasoning,
            Self::Coding => capabilities.coding,
        }
    }

    fn set_level(self, capabilities: &mut ComputeCapabilities, value: u8) {
        match self {
            Self::Vision => capabilities.vision = value,
            Self::LongContext => capabilities.long_context = value,
            Self::Tools => capabilities.tools = value,
            Self::Reasoning => capabilities.reasoning = value,
            Self::Coding => capabilities.coding = value,
        }
    }

    fn name(self) -> &'static str {
        match self {
            Self::Vision => "vision",
            Self::LongContext => "long_context",
            Self::Tools => "tools",
            Self::Reasoning => "reasoning",
            Self::Coding => "coding",
        }
    }
}

/// One graduated, downgrade-only relaxation step the core policy grants a
/// task whose routing constraints no eligible compute candidate can satisfy.
/// The step is the durable evidence: it names what was relaxed and from what
/// level to what, and replays deterministically through
/// [`RoutingRelaxation::apply_to`].
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RoutingRelaxation {
    Capability {
        capability: CapabilityKind,
        from: u8,
        to: u8,
    },
    Risk {
        from: Risk,
        to: Risk,
    },
}

impl RoutingRelaxation {
    /// Human-readable evidence, e.g. `tools 1→0` or `risk high→medium`.
    pub fn describe(&self) -> String {
        match self {
            Self::Capability {
                capability,
                from,
                to,
            } => format!("{} {from}→{to}", capability.name()),
            Self::Risk { from, to } => format!("risk {from:?}→{to:?}").to_lowercase(),
        }
    }

    /// Applies the recorded step. Only strict downgrades of the recorded
    /// constraint are accepted: an event that claims to relax a constraint
    /// the task does not currently have, or that would raise a level, is a
    /// corrupted or forged record and must fail replay.
    pub fn apply_to(&self, routing: &mut TaskRouting) -> Result<(), RoutingError> {
        match self {
            Self::Capability {
                capability,
                from,
                to,
            } => {
                if capability.level(routing.required) != *from {
                    return Err(RoutingError::RelaxationNotApplicable);
                }
                if *to >= *from {
                    return Err(RoutingError::RelaxationNotDowngrade);
                }
                capability.set_level(&mut routing.required, *to);
            }
            Self::Risk { from, to } => {
                if routing.risk != *from {
                    return Err(RoutingError::RelaxationNotApplicable);
                }
                if risk_level(*to) >= risk_level(*from) {
                    return Err(RoutingError::RelaxationNotDowngrade);
                }
                routing.risk = *to;
            }
        }
        Ok(())
    }
}

impl TaskRouting {
    /// The full remaining relaxation ladder, in policy order. Walking this
    /// plan step by step is defined to equal granting
    /// [`TaskRouting::relax_step`] until it returns `None`, so a dispatcher
    /// automating the walk (ADR `2026-xx-attention-agent-auto-resolution`)
    /// can never act beyond the core-owned ladder: it either lands a
    /// candidate or reaches the same spent-ladder verdict core refuses with.
    /// The plan also bounds the automation budget: the deepest contract with
    /// every capability at 2 is 13 steps, so an auto-relax budget above that
    /// only stops anomalous declared contracts from degrading forever.
    pub fn relax_ladder(&self) -> Vec<RoutingRelaxation> {
        let mut ladder = Vec::new();
        let mut routing = self.clone();
        while let Some(step) = routing.relax_step() {
            step.apply_to(&mut routing)
                .expect("relax_step and apply_to are inverse-consistent");
            ladder.push(step);
        }
        ladder
    }
}

fn risk_level(risk: Risk) -> u8 {
    match risk {
        Risk::Low => 0,
        Risk::Medium => 1,
        Risk::High => 2,
        Risk::Critical => 3,
    }
}

impl TaskRouting {
    /// The next graduated relaxation step for constraints no candidate can
    /// satisfy, or `None` when the ladder is spent (every required
    /// capability is zero and the risk floor is already low). One step at a
    /// time keeps the relaxation reviewable in the event log and prevents a
    /// single resolution from erasing the whole contract.
    pub fn relax_step(&self) -> Option<RoutingRelaxation> {
        for capability in [
            CapabilityKind::Vision,
            CapabilityKind::LongContext,
            CapabilityKind::Tools,
            CapabilityKind::Reasoning,
            CapabilityKind::Coding,
        ] {
            let level = capability.level(self.required);
            if level > 0 {
                return Some(RoutingRelaxation::Capability {
                    capability,
                    from: level,
                    to: level - 1,
                });
            }
        }
        let to = match self.risk {
            Risk::Critical => Some(Risk::High),
            Risk::High => Some(Risk::Medium),
            Risk::Medium => Some(Risk::Low),
            Risk::Low => None,
        }?;
        Some(RoutingRelaxation::Risk {
            from: self.risk,
            to,
        })
    }
}

pub fn select_candidate<'a>(
    candidates: &'a [ComputeCandidate],
    eligible_candidate_ids: &BTreeSet<String>,
    requirements: &CapabilityRequirements,
) -> Result<&'a ComputeCandidate, RoutingError> {
    let minimum = requirements.effective_minimum();
    candidates
        .iter()
        .filter(|candidate| {
            candidate.available
                && eligible_candidate_ids.contains(&candidate.id)
                && candidate.compute_class >= minimum
                && candidate.compute_class <= requirements.maximum_compute
                && candidate.capabilities.satisfies(requirements.capabilities)
        })
        .min_by_key(|candidate| {
            (
                candidate.compute_class,
                u32::from(candidate.cost_weight) + u32::from(candidate.latency),
                &candidate.id,
            )
        })
        .ok_or(RoutingError::NoSufficientCandidate)
}

#[derive(Clone, Debug, Error, Eq, PartialEq)]
pub enum RoutingError {
    #[error("no eligible compute candidate satisfies task constraints")]
    NoSufficientCandidate,
    #[error("relaxation does not match the task's current routing constraints")]
    RelaxationNotApplicable,
    #[error("relaxation must lower a constraint, never raise it")]
    RelaxationNotDowngrade,
}

#[cfg(test)]
mod relaxation_tests {
    use super::*;

    #[test]
    fn the_ladder_steps_down_one_constraint_at_a_time_in_policy_order() {
        let mut routing = TaskRouting {
            risk: Risk::High,
            required: ComputeCapabilities::new(1, 2, 1, 0, 0),
        };
        // Policy order: vision → long_context → tools → reasoning → coding,
        // then the risk floor. Each step lowers exactly one level.
        let mut steps = Vec::new();
        while let Some(step) = routing.relax_step() {
            step.apply_to(&mut routing).unwrap();
            steps.push(step.describe());
        }
        assert_eq!(
            steps,
            vec![
                "tools 1→0",
                "reasoning 2→1",
                "reasoning 1→0",
                "coding 1→0",
                "risk high→medium",
                "risk medium→low",
            ]
        );
        assert_eq!(routing.required, ComputeCapabilities::new(0, 0, 0, 0, 0));
        assert_eq!(routing.risk, Risk::Low);
    }

    #[test]
    fn a_spent_ladder_reports_exhaustion_instead_of_a_step() {
        let routing = TaskRouting {
            risk: Risk::Low,
            required: ComputeCapabilities::new(0, 0, 0, 0, 0),
        };
        assert_eq!(routing.relax_step(), None);
        assert!(routing.relax_ladder().is_empty());
    }

    #[test]
    fn the_full_ladder_plan_matches_repeated_single_steps_and_ends_spent() {
        let routing = TaskRouting {
            risk: Risk::Critical,
            required: ComputeCapabilities::new(2, 2, 2, 2, 2),
        };
        let plan = routing.relax_ladder();
        // Five senses at two levels each, then critical→high→medium→low.
        assert_eq!(plan.len(), 13);
        let mut sequential = routing.clone();
        let mut walked = Vec::new();
        while let Some(step) = sequential.relax_step() {
            step.apply_to(&mut sequential).unwrap();
            walked.push(step);
        }
        assert_eq!(plan, walked);
        // Replaying the plan lands exactly on the floor core refuses from.
        let mut replayed = routing;
        for step in &plan {
            step.apply_to(&mut replayed).unwrap();
        }
        assert_eq!(replayed.relax_step(), None);
        assert_eq!(replayed.risk, Risk::Low);
        assert_eq!(replayed.required, ComputeCapabilities::new(0, 0, 0, 0, 0));
    }

    #[test]
    fn applied_relaxation_must_be_a_real_downgrade_of_the_current_constraint() {
        let mut routing = TaskRouting {
            risk: Risk::Medium,
            required: ComputeCapabilities::new(0, 1, 0, 0, 0),
        };
        let raise = RoutingRelaxation::Capability {
            capability: CapabilityKind::Reasoning,
            from: 1,
            to: 2,
        };
        assert_eq!(
            raise.apply_to(&mut routing),
            Err(RoutingError::RelaxationNotDowngrade)
        );
        let stale = RoutingRelaxation::Capability {
            capability: CapabilityKind::Reasoning,
            from: 2,
            to: 1,
        };
        assert_eq!(
            stale.apply_to(&mut routing),
            Err(RoutingError::RelaxationNotApplicable)
        );
        let risk_raise = RoutingRelaxation::Risk {
            from: Risk::Medium,
            to: Risk::High,
        };
        assert_eq!(
            risk_raise.apply_to(&mut routing),
            Err(RoutingError::RelaxationNotDowngrade)
        );
    }
}
