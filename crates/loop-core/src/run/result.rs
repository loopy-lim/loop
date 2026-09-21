use serde::{Deserialize, Serialize};

use crate::task::VerificationEvidence;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct WorkerResult {
    pub worker_id: String,
    pub summary: String,
    pub evidence: VerificationEvidence,
}
