//! Pre-flight EXPLAIN dispatch for the MCP approval gate.
//!
//! Wraps the existing per-driver `explain_query` functions and returns the
//! plan as a `serde_json::Value` so it can be embedded in a `PendingApproval`
//! file and rendered by the frontend's Visual Explain component.
//!
//! The wrapper is intentionally non-blocking: if EXPLAIN fails (DDL, missing
//! permission, syntax error) we return the error string and let the caller
//! decide whether to still surface the approval modal.

use serde_json::Value;

use crate::drivers::driver_trait::DatabaseDriver;
use crate::models::ConnectionParams;

/// Result of a pre-flight EXPLAIN attempt.
pub struct PreflightOutcome {
    pub plan: Option<Value>,
    pub error: Option<String>,
}

/// Run EXPLAIN against the given driver and return the plan as JSON.
pub async fn preflight_explain(
    driver: &dyn DatabaseDriver,
    params: &ConnectionParams,
    query: &str,
    schema: Option<&str>,
) -> PreflightOutcome {
    let plan_result = driver.explain_query(params, query, false, schema).await;

    match plan_result {
        Ok(plan) => match serde_json::to_value(&plan) {
            Ok(v) => PreflightOutcome {
                plan: Some(v),
                error: None,
            },
            Err(e) => PreflightOutcome {
                plan: None,
                error: Some(e.to_string()),
            },
        },
        Err(e) => PreflightOutcome {
            plan: None,
            error: Some(e),
        },
    }
}
