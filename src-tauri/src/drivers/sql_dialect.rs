//! Manifest parsing helpers for [`SqlDialect`].

use serde::{Deserialize, Deserializer};

use crate::drivers::driver_trait::SqlDialect;

/// Parses a dialect name, falling back to [`SqlDialect::Generic`] for a name
/// this host doesn't know (for example one added in a newer release).
pub fn parse_or_generic(name: &str) -> SqlDialect {
    serde_json::from_value(serde_json::Value::String(name.to_string())).unwrap_or_else(|_| {
        log::warn!(
            "Unknown sql_dialect '{}' in plugin manifest; using 'generic'",
            name
        );
        SqlDialect::Generic
    })
}

/// `deserialize_with` helper for the manifest's optional `sql_dialect`.
/// An unknown dialect name maps to `Generic`, so a plugin written for a newer
/// host still loads with plain statement splitting instead of failing the
/// whole manifest. A value that is not a string is still rejected.
pub fn deserialize_lenient<'de, D>(deserializer: D) -> Result<Option<SqlDialect>, D::Error>
where
    D: Deserializer<'de>,
{
    let raw = Option::<String>::deserialize(deserializer)?;
    Ok(raw.as_deref().map(parse_or_generic))
}
