//! Connection-wide write policy shared by desktop, web and MCP.

use crate::drivers::driver_trait::{
    DatabaseDriver, DriverCapabilities, QueryChunkSink, StreamSummary,
};
use crate::models::{ConnectionParams, QueryResult};
use crate::runtime::RuntimeContext;

pub const WRITE_BLOCKED: &str = "This connection is read-only. Disable read-only mode in its connection settings to allow writes.";

/// Startup SQL is user code and runs before query protection is installed.
/// Keep it saved, but never send it to a driver while this policy is active.
pub fn prepare_params(params: &mut ConnectionParams) {
    if params.read_only {
        params.startup_script = None;
    }
}

pub fn validate_support(
    params: &ConnectionParams,
    capabilities: &DriverCapabilities,
) -> Result<(), String> {
    if params.read_only && !capabilities.readonly && !capabilities.read_only_queries {
        return Err("This driver does not support protected read-only queries. Update the plugin or disable read-only mode in the connection settings.".into());
    }
    Ok(())
}

/// Resolve the saved policy rather than trusting flags supplied by a caller.
pub fn ensure_writable(runtime: &RuntimeContext, connection_id: &str) -> Result<(), String> {
    let saved = super::connections::load_connections(&runtime.paths.connections_file())?
        .into_iter()
        .find(|connection| connection.id == connection_id)
        .ok_or_else(|| "Connection not found".to_string())?;
    if saved.params.read_only {
        return Err(WRITE_BLOCKED.into());
    }
    Ok(())
}

pub fn validate_query(
    params: &ConnectionParams,
    capabilities: &DriverCapabilities,
    query: &str,
) -> Result<(), String> {
    validate_support(params, capabilities)?;
    if params.read_only
        && crate::ai_activity::classify_query_kind_for_capabilities(query, Some(capabilities))
            != "select"
    {
        return Err(WRITE_BLOCKED.into());
    }
    Ok(())
}

/// Classification is only a preflight: the driver must also reject side
/// effects hidden in reads (for example a SELECT calling a write function).
pub async fn execute_query(
    driver: &dyn DatabaseDriver,
    params: &ConnectionParams,
    query: &str,
    limit: Option<u32>,
    page: u32,
    schema: Option<&str>,
) -> Result<QueryResult, String> {
    validate_query(params, &driver.manifest().capabilities, query)?;
    driver
        .execute_read_only_query(params, query, limit, page, schema)
        .await
}

/// `execute_query` without a row limit, with the rows handed to `sink` in
/// batches. A rejected statement sends nothing to `sink`.
pub async fn execute_query_stream(
    driver: &dyn DatabaseDriver,
    params: &ConnectionParams,
    query: &str,
    schema: Option<&str>,
    sink: &mut QueryChunkSink<'_>,
) -> Result<StreamSummary, String> {
    validate_query(params, &driver.manifest().capabilities, query)?;
    driver
        .execute_read_only_query_stream(params, query, schema, sink)
        .await
}

#[cfg(test)]
mod tests;
