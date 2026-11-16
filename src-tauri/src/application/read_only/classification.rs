//! How the read-only policies decide whether a query is a read.
//!
//! Saved read-only connections and the MCP gates (read-only mode, approval)
//! ask the same question of every query: is this a clean read? For SQL
//! drivers the host answers it by reading the SQL
//! ([`ai_activity::classify_query_kind_for_capabilities`]). A driver whose
//! query language is not SQL can take the question over with the
//! `query_classification` capability, because only its own parser knows what
//! its statements do. The policies themselves stay in the host.

use crate::ai_activity;
use crate::drivers::driver_trait::{DatabaseDriver, DriverCapabilities};
use crate::models::ConnectionParams;

/// The kind of `query` (`"select"`, `"write"`, `"ddl"` or `"unknown"`) as the
/// read-only policies must see it. Fails closed: anything short of a verdict
/// the host can rely on is `"unknown"`.
///
/// * A driver without `query_classification` is read as SQL.
/// * A driver with it is never read as SQL. What the SQL classifier would say
///   about that driver's language means nothing, so a failed call (an error, a
///   timeout, `-32601`, an unreadable result) is `"unknown"` and not a reason
///   to fall back.
/// * `"select"` only counts when the driver also has an execution guarantee,
///   `read_only_queries` or `readonly`. A classifier alone does not stop a
///   write at execution, and a clean read runs without the user's approval.
///
/// Callers classify the exact text they are about to run, so a query edited
/// during approval has to come back through here.
pub async fn classify_query(
    driver: &dyn DatabaseDriver,
    params: &ConnectionParams,
    query: &str,
) -> &'static str {
    let capabilities = &driver.manifest().capabilities;
    if !capabilities.query_classification {
        return ai_activity::classify_query_kind_for_capabilities(query, Some(capabilities));
    }

    match driver.classify_query(params, query).await {
        Ok(Some(kind)) => trusted_kind(kind, capabilities),
        Ok(None) => "unknown",
        Err(error) => {
            log::warn!(
                "Driver '{}' could not classify a query; treating it as unknown: {error}",
                driver.manifest().id
            );
            "unknown"
        }
    }
}

/// The driver's verdict, minus a `"select"` that nothing enforces at execution.
///
/// The guarantee is the one `RpcDriver::execute_read_only_query` provides:
/// `read_only_queries` has the database refuse writes, and a `readonly`
/// driver has no write to refuse.
fn trusted_kind(kind: &'static str, capabilities: &DriverCapabilities) -> &'static str {
    let enforced = capabilities.read_only_queries || capabilities.readonly;
    if kind == "select" && !enforced {
        "unknown"
    } else {
        kind
    }
}

#[cfg(test)]
mod tests;
