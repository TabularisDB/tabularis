//! Connection-wide write policy shared by desktop, web and MCP.

mod classification;

use crate::drivers::driver_trait::{DatabaseDriver, DriverCapabilities};
use crate::models::{ConnectionParams, QueryResult};
use crate::runtime::RuntimeContext;

pub use classification::classify_query;

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

/// The policy decision for a query whose kind is already known (see
/// [`classify_query`]). A caller that classified the query for another gate
/// passes that verdict in, so one text is classified once.
pub fn validate_kind(
    params: &ConnectionParams,
    capabilities: &DriverCapabilities,
    kind: &str,
) -> Result<(), String> {
    validate_support(params, capabilities)?;
    if params.read_only && kind != "select" {
        return Err(WRITE_BLOCKED.into());
    }
    Ok(())
}

/// Classifies `query` the way the driver's language requires and applies the
/// connection policy. Every path that runs a query on a connection checks it
/// here, so a driver that classifies its own language is heard by all of them.
pub async fn validate_query(
    driver: &dyn DatabaseDriver,
    params: &ConnectionParams,
    query: &str,
) -> Result<(), String> {
    let capabilities = &driver.manifest().capabilities;
    validate_support(params, capabilities)?;
    // A writable connection needs no verdict, and a plugin is not asked for one.
    if !params.read_only {
        return Ok(());
    }
    validate_kind(
        params,
        capabilities,
        classify_query(driver, params, query).await,
    )
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
    validate_query(driver, params, query).await?;
    driver
        .execute_read_only_query(params, query, limit, page, schema)
        .await
}

#[cfg(test)]
mod plugin_tests;
#[cfg(test)]
mod tests;
