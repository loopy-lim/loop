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
}
