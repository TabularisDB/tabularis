//! Annotates an [`ImportEnvelope`] against the user's existing connections and
//! the set of registered drivers, producing the serializable [`ImportPreview`]
//! the frontend renders. Ported from TablePro's `ConnectionImportAnalyzer`.

use serde::Serialize;

use super::types::ImportEnvelope;
use super::{driver_map, expand_home};
use crate::models::SavedConnection;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    pub source_name: String,
    pub credentials_aborted: bool,
    pub items: Vec<ImportItem>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportItem {
    /// Index into the envelope; the apply step resolves connections by this.
    pub index: usize,
    pub name: String,
    pub driver_id: String,
    pub driver_installed: bool,
    pub host: String,
    pub port: u16,
    pub database: String,
    pub username: String,
    pub has_ssh: bool,
    pub has_password: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_name: Option<String>,
    pub status: ImportItemStatus,
}

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ImportItemStatus {
    Ready,
    // `rename_all` on the enum only renames variant tags, not the fields inside
    // struct variants — those need their own annotation to reach the
    // camelCase keys the frontend reads (`existingId` / `existingName`).
    #[serde(rename_all = "camelCase")]
    Duplicate {
        existing_id: String,
        existing_name: String,
    },
    Warnings {
        warnings: Vec<String>,
    },
}

/// Build the preview. `registered_ids` is the set of drivers Tabularis can use
/// right now (built-in + plugins); `file_exists` lets tests stub path checks.
pub fn analyze(
    envelope: &ImportEnvelope,
    existing: &[SavedConnection],
    registered_ids: &[String],
    file_exists: &dyn Fn(&str) -> bool,
) -> ImportPreview {
    let existing_keys: Vec<(DupKey, String, String)> = existing
        .iter()
        .map(|c| {
            (
                dup_key_existing(c),
                c.id.clone(),
                c.name.clone(),
            )
        })
        .collect();

    let items = envelope
        .connections
        .iter()
        .enumerate()
        .map(|(index, conn)| {
            let (driver_id, driver_installed) =
                driver_map::map_driver_label(&conn.driver_label, registered_ids);
            let has_password = envelope
                .credentials_by_index
                .get(&index)
                .map(|c| c.password.is_some())
                .unwrap_or(false);

            let key = dup_key(&conn.host, conn.port, &conn.database, &conn.username);
            let status = if let Some((_, id, name)) =
                existing_keys.iter().find(|(k, _, _)| k == &key)
            {
                ImportItemStatus::Duplicate {
                    existing_id: id.clone(),
                    existing_name: name.clone(),
                }
            } else {
                let warnings = collect_warnings(conn, driver_installed, &driver_id, file_exists);
                if warnings.is_empty() {
                    ImportItemStatus::Ready
                } else {
                    ImportItemStatus::Warnings { warnings }
                }
            };

            ImportItem {
                index,
                name: conn.name.clone(),
                driver_id,
                driver_installed,
                host: conn.host.clone(),
                port: conn.port,
                database: conn.database.clone(),
                username: conn.username.clone(),
                has_ssh: conn.ssh.is_some(),
                has_password,
                group_name: conn.group_name.clone(),
                status,
            }
        })
        .collect();

    ImportPreview {
        source_name: envelope.source_name.clone(),
        credentials_aborted: envelope.credentials_aborted,
        items,
    }
}

fn collect_warnings(
    conn: &super::types::ImportedConnection,
    driver_installed: bool,
    driver_id: &str,
    file_exists: &dyn Fn(&str) -> bool,
) -> Vec<String> {
    let mut warnings = Vec::new();

    if let Some(ssh) = &conn.ssh {
        if let Some(key) = ssh.private_key_path.as_deref().filter(|s| !s.is_empty()) {
            if !file_exists(&expand_home(key)) {
                warnings.push(format!("SSH private key not found: {}", key));
            }
        }
    }
    if let Some(ssl) = &conn.ssl {
        for (path, label) in [
            (&ssl.ca_certificate_path, "CA certificate"),
            (&ssl.client_certificate_path, "Client certificate"),
            (&ssl.client_key_path, "Client key"),
        ] {
            if let Some(p) = path.as_deref().filter(|s| !s.is_empty()) {
                if !file_exists(&expand_home(p)) {
                    warnings.push(format!("{} not found: {}", label, p));
                }
            }
        }
    }
    if !driver_installed {
        warnings.push(format!("Database driver \"{}\" is not installed", driver_id));
    }
    warnings
}

#[derive(PartialEq, Eq)]
pub(crate) struct DupKey(Vec<String>);

fn dup_key(host: &str, port: u16, database: &str, username: &str) -> DupKey {
    DupKey(vec![
        norm(host),
        port.to_string(),
        norm(database),
        norm(username),
    ])
}

pub(crate) fn dup_key_existing(c: &SavedConnection) -> DupKey {
    dup_key(
        c.params.host.as_deref().unwrap_or(""),
        c.params.port.unwrap_or(0),
        c.params.database.primary(),
        c.params.username.as_deref().unwrap_or(""),
    )
}

fn norm(value: &str) -> String {
    value.trim().to_ascii_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::connection_import::types::ImportedConnection;
    use crate::models::{ConnectionParams, DatabaseSelection};

    fn conn(name: &str, host: &str, port: u16, db: &str, user: &str, driver: &str) -> ImportedConnection {
        ImportedConnection {
            name: name.to_string(),
            host: host.to_string(),
            port,
            database: db.to_string(),
            username: user.to_string(),
            driver_label: driver.to_string(),
            ssh: None,
            ssl: None,
            group_name: None,
        }
    }

    fn saved(id: &str, name: &str, host: &str, port: u16, db: &str, user: &str) -> SavedConnection {
        SavedConnection {
            id: id.to_string(),
            name: name.to_string(),
            params: ConnectionParams {
                driver: "postgres".to_string(),
                host: Some(host.to_string()),
                port: Some(port),
                username: Some(user.to_string()),
                database: DatabaseSelection::Single(db.to_string()),
                ..Default::default()
            },
            group_id: None,
            sort_order: None,
            detect_json_in_text_columns: None,
            appearance: None,
        }
    }

    fn envelope(conns: Vec<ImportedConnection>) -> ImportEnvelope {
        ImportEnvelope {
            source_name: "Test".to_string(),
            connections: conns,
            ..Default::default()
        }
    }

    #[test]
    fn marks_duplicates() {
        let env = envelope(vec![conn("A", "Host", 5432, "DB", "User", "PostgreSQL")]);
        let existing = vec![saved("x", "Existing", "host", 5432, "db", "user")];
        let preview = analyze(&env, &existing, &["postgres".into()], &|_| true);
        assert!(matches!(
            preview.items[0].status,
            ImportItemStatus::Duplicate { .. }
        ));
    }

    #[test]
    fn warns_on_uninstalled_driver() {
        let env = envelope(vec![conn("A", "h", 27017, "db", "u", "MongoDB")]);
        let preview = analyze(&env, &[], &["postgres".into()], &|_| true);
        match &preview.items[0].status {
            ImportItemStatus::Warnings { warnings } => {
                assert!(warnings.iter().any(|w| w.contains("not installed")));
            }
            other => panic!("expected warnings, got {:?}", other),
        }
        assert_eq!(preview.items[0].driver_id, "mongodb");
        assert!(!preview.items[0].driver_installed);
    }

    #[test]
    fn ready_when_known_and_unique() {
        let env = envelope(vec![conn("A", "h", 5432, "db", "u", "PostgreSQL")]);
        let preview = analyze(&env, &[], &["postgres".into()], &|_| true);
        assert!(matches!(preview.items[0].status, ImportItemStatus::Ready));
    }

    #[test]
    fn duplicate_status_serializes_camel_case_fields() {
        // The frontend reads `existingId` / `existingName`; a snake_case leak
        // here surfaces as `Duplicate of ""` in the UI (see analyzer note).
        let env = envelope(vec![conn("A", "Host", 5432, "DB", "User", "PostgreSQL")]);
        let existing = vec![saved("x", "Existing Name", "host", 5432, "db", "user")];
        let preview = analyze(&env, &existing, &["postgres".into()], &|_| true);
        let json = serde_json::to_value(&preview.items[0].status).unwrap();
        assert_eq!(json["kind"], "duplicate");
        assert_eq!(json["existingId"], "x");
        assert_eq!(json["existingName"], "Existing Name");
        assert!(json.get("existing_name").is_none());
    }
}
