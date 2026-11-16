//! Validation for connection-scoped plugin extension requests.

#[cfg(test)]
mod tests;

use serde_json::Value;

fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 96
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
}

pub fn validate_target(plugin_id: &str, driver: &str) -> Result<(), String> {
    if !valid_id(plugin_id) || ["postgres", "mysql", "sqlite"].contains(&plugin_id) {
        return Err("An external plugin identifier is required".into());
    }
    if plugin_id != driver {
        return Err("Plugin does not own this connection".into());
    }
    Ok(())
}

pub fn validate_request(method: &str, args: &Value) -> Result<(), String> {
    // Extension methods use a namespace so built-in driver/lifecycle methods are never exposed here.
    if !valid_id(method)
        || !method.contains('_')
        || method.starts_with('_')
        || [
            "execute_query",
            "test_connection",
            "get_tables",
            "get_columns",
            "get_schemas",
        ]
        .contains(&method)
    {
        return Err("A namespaced plugin extension method is required".into());
    }
    if !args.is_object() || args.to_string().len() > 1_048_576 {
        return Err("Extension arguments must be an object of at most 1 MiB".into());
    }
    Ok(())
}

pub fn validate_secrets(value: &Value) -> Result<(), String> {
    let fields = value.as_object().ok_or("Secrets must be a JSON object")?;
    if fields.is_empty() || fields.len() > 64 || value.to_string().len() > 65536 {
        return Err("Provide 1–64 secret fields totaling at most 64 KiB".into());
    }
    for (key, value) in fields {
        if !valid_id(key) || value.as_str().map_or(true, |s| s.is_empty()) {
            return Err("Secret names must be identifiers and values non-empty strings".into());
        }
    }
    Ok(())
}

pub fn secret_key(plugin_id: &str, connection_id: &str) -> String {
    // Length prefixes prevent ambiguous plugin/connection combinations.
    format!(
        "plugin:{}:{}:{}:{}",
        plugin_id.len(),
        plugin_id,
        connection_id.len(),
        connection_id
    )
}
