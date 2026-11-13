//! Native whole-database operations; no generic SQL fallback for plugins.
use crate::drivers::driver_trait::DriverCapabilities;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DatabaseOperation {
    Empty,
    Truncate,
    Drop,
}

impl DatabaseOperation {
    pub fn supported(self, capabilities: &DriverCapabilities) -> bool {
        !capabilities.readonly
            && match self {
                Self::Empty => capabilities.empty_database,
                Self::Truncate => capabilities.truncate_database,
                Self::Drop => capabilities.drop_database,
            }
    }
}

pub fn validate_database(database: &str, protected: &[&str]) -> Result<(), String> {
    if database.is_empty()
        || database.contains('\0')
        || protected
            .iter()
            .any(|name| database.eq_ignore_ascii_case(name))
    {
        return Err("Database is empty, invalid, or protected".into());
    }
    Ok(())
}

#[cfg(test)]
#[path = "database_operations_tests.rs"]
mod tests;
