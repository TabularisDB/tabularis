use crate::drivers::driver_trait::DriverCapabilities;
use crate::models::{ConnectionParams, DatabaseSelection};

use super::protocol::JsonRpcError;

/// Select a configured database without widening the saved connection's scope.
/// Local paths and implicit databases cannot be selected through MCP input.
pub(super) fn apply_database_override(
    params: &mut ConnectionParams,
    database: Option<&str>,
    capabilities: &DriverCapabilities,
) -> Result<(), JsonRpcError> {
    let Some(database) = database else {
        return Ok(());
    };

    if capabilities.file_based || capabilities.folder_based || capabilities.single_database {
        return Err(JsonRpcError {
            code: -32602,
            message: "The 'database' parameter is not supported for this connection".to_string(),
            data: None,
        });
    }

    // An empty selection is not an unrestricted allowlist. Compare exact
    // names: normalization could grant access to a different database.
    if !params
        .database
        .as_vec()
        .iter()
        .any(|configured| configured == database)
    {
        return Err(JsonRpcError {
            code: -32602,
            message: "Database is not in the configured database selection for this connection"
                .to_string(),
            data: None,
        });
    }

    params.database = DatabaseSelection::Single(database.to_string());
    Ok(())
}

#[cfg(test)]
mod tests;
