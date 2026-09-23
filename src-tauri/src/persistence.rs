use crate::models::{ConnectionGroup, ConnectionsFile, SavedConnection};
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::fs;
use std::path::Path;

/// Parses connections file content already read from disk. Supports both
/// the old format (a bare array of connections) and the new format (an
/// object with groups/tags). Split out from `load_connections_file` so a
/// caller that already has the file's content in hand (e.g. to compare
/// against a later read, as `connection_migrations` does) can parse it
/// without triggering a second `fs::read_to_string`.
pub fn parse_connections_file(content: &str) -> Result<ConnectionsFile, String> {
    // Try parsing as the new format first
    if let Ok(file) = serde_json::from_str::<ConnectionsFile>(content) {
        return Ok(file);
    }

    // Fall back to old format (array of connections)
    let connections: Vec<SavedConnection> = serde_json::from_str(content)
        .map_err(|_| "Failed to parse connections file".to_string())?;

    Ok(ConnectionsFile {
        groups: Vec::new(),
        connections,
        tags: Vec::new(),
    })
}

/// Load connections file (raw, no keychain reads).
/// Supports both old format (array of connections) and new format (with groups).
/// Use `load_connections` or `load_connections_with_passwords` when passwords are needed.
pub fn load_connections_file(path: &Path) -> Result<ConnectionsFile, String> {
    if !path.exists() {
        return Ok(ConnectionsFile::default());
    }
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    parse_connections_file(&content)
}

/// Load connections list (raw, no keychain reads) — for listing UI.
pub fn load_connections(path: &Path) -> Result<Vec<SavedConnection>, String> {
    let file = load_connections_file(path)?;
    Ok(file.connections)
}

pub fn save_connections_file(path: &Path, file: &ConnectionsFile) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
    }

    // Create a copy to sanitize passwords before saving to JSON
    let mut connections_to_save = Vec::new();
    for conn in &file.connections {
        let mut c = conn.clone();
        if c.params.save_in_keychain.unwrap_or(false) {
            // Passwords are stored in keychain, remove from JSON
            c.params.password = None;
            c.params.ssh_password = None;
        }
        connections_to_save.push(c);
    }

    let to_save = ConnectionsFile {
        groups: file.groups.clone(),
        connections: connections_to_save,
        tags: file.tags.clone(),
    };

    let mut json = serde_json::to_value(&to_save).map_err(|e| e.to_string())?;
    preserve_unknown_fields(path, &mut json);
    let json = serde_json::to_string_pretty(&json).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())
}

/// Fields of `raw` the current binary's structs do not know: anything present
/// on disk but absent from the round-trip of the typed parse, which is exactly
/// what a save would have dropped. Aliases resolve to their renamed spelling
/// during the round-trip, so they never register as unknown.
fn unknown_fields<'a>(
    raw: &'a Map<String, Value>,
    roundtripped: &Value,
    aliases: &[&str],
) -> Vec<(&'a str, &'a Value)> {
    let Some(known) = roundtripped.as_object() else {
        return Vec::new();
    };
    raw.iter()
        .filter(|(key, _)| !known.contains_key(key.as_str()) && !aliases.contains(&key.as_str()))
        .map(|(key, value)| (key.as_str(), value))
        .collect()
}

/// Copies fields the current binary's structs do not know from the previous
/// on-disk content into the value about to be written, so a save no longer
/// silently drops them (#668: the GUI and an older `--mcp` binary are
/// independent writers of the same file). Matching is by connection id and
/// covers the top level, each connection, and each connection's params. Known
/// fields keep their in-memory value: something this save deliberately
/// dropped (an optional cleared, a connection deleted) is not resurrected.
/// The previous content is re-read here, not passed in, so whichever process
/// wrote last still wins for the fields it knows.
fn preserve_unknown_fields(path: &Path, next: &mut Value) {
    let Ok(content) = fs::read_to_string(path) else {
        return;
    };
    let Ok(prev_raw) = serde_json::from_str::<Value>(&content) else {
        return;
    };
    let Ok(prev_typed) = parse_connections_file(&content) else {
        return;
    };
    let Ok(prev_roundtrip) = serde_json::to_value(&prev_typed) else {
        return;
    };

    // Connections to compare against: the new format stores them under
    // "connections", the old format is the bare array itself. The round-trip
    // of a typed parse is always the new format.
    let prev_conns_raw: &[Value] = match &prev_raw {
        Value::Array(a) => a,
        Value::Object(o) => o
            .get("connections")
            .and_then(Value::as_array)
            .map(Vec::as_slice)
            .unwrap_or(&[]),
        _ => &[],
    };
    let prev_rt_conns: &[Value] = prev_roundtrip
        .get("connections")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[]);

    let raw_conn_by_id: HashMap<&str, &Value> = prev_conns_raw
        .iter()
        .filter_map(|c| c.get("id").and_then(Value::as_str).map(|id| (id, c)))
        .collect();
    let rt_conn_by_id: HashMap<&str, &Value> = prev_rt_conns
        .iter()
        .filter_map(|c| c.get("id").and_then(Value::as_str).map(|id| (id, c)))
        .collect();

    let Some(next_root) = next.as_object_mut() else {
        return;
    };

    if let Value::Object(prev_root) = &prev_raw {
        for (key, val) in unknown_fields(prev_root, &prev_roundtrip, &[]) {
            if !next_root.contains_key(key) {
                next_root.insert(key.to_string(), val.clone());
            }
        }
    }

    let Some(next_conns) = next_root
        .get_mut("connections")
        .and_then(Value::as_array_mut)
    else {
        return;
    };
    for conn in next_conns.iter_mut() {
        let Some(obj) = conn.as_object_mut() else {
            continue;
        };
        let Some(id) = obj.get("id").and_then(Value::as_str) else {
            continue;
        };
        let (Some(raw_conn), Some(rt_conn)) = (raw_conn_by_id.get(id), rt_conn_by_id.get(id))
        else {
            continue;
        };
        let Some(raw_conn) = raw_conn.as_object() else {
            continue;
        };
        for (key, val) in unknown_fields(raw_conn, rt_conn, &[]) {
            if !obj.contains_key(key) {
                obj.insert(key.to_string(), val.clone());
            }
        }
        if let (Some(raw_params), Some(next_params), Some(rt_params)) = (
            raw_conn.get("params").and_then(Value::as_object),
            obj.get_mut("params").and_then(Value::as_object_mut),
            rt_conn.get("params"),
        ) {
            for (key, val) in unknown_fields(
                raw_params,
                rt_params,
                &["connectionUri", "connectionUriInKeychain"],
            ) {
                if !next_params.contains_key(key) {
                    next_params.insert(key.to_string(), val.clone());
                }
            }
        }
    }
}

/// Legacy function for backward compatibility - saves using new format
pub fn save_connections(path: &Path, connections: &[SavedConnection]) -> Result<(), String> {
    // Load existing groups if any
    let existing = load_connections_file(path).unwrap_or_default();
    let file = ConnectionsFile {
        groups: existing.groups,
        connections: connections.to_vec(),
        tags: existing.tags,
    };
    save_connections_file(path, &file)
}

pub fn load_groups(path: &Path) -> Result<Vec<ConnectionGroup>, String> {
    let file = load_connections_file(path)?;
    Ok(file.groups)
}

pub fn save_groups(path: &Path, groups: &[ConnectionGroup]) -> Result<(), String> {
    let mut file = load_connections_file(path).unwrap_or_default();
    file.groups = groups.to_vec();
    save_connections_file(path, &file)
}
