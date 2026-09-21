use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskKind {
    Research,
    Decision,
    Implementation,
    Verification,
    Integration,
}

impl TaskKind {
    pub const fn is_serial(self) -> bool {
        matches!(self, Self::Decision | Self::Integration)
    }

    pub const fn requires_explicit_write_scope(self) -> bool {
        matches!(
            self,
            Self::Decision | Self::Implementation | Self::Integration
        )
    }
}
