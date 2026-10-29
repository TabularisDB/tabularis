//! HeidiSQL importer. Reads the text file written by File > Export settings
//! (the portable build keeps the same format in `portable_settings.txt`).
//! Each line is `<key path><|||><type><|||><value>` and sessions live under
//! `Servers\<folder>\...\<session>\<Key>`. HeidiSQL obfuscates saved passwords,
//! so they are never imported.

use std::collections::{BTreeMap, HashMap};
use std::path::Path;

use super::driver_map;
use super::types::{ImportEnvelope, ImportedConnection, ImportedSsh};
use super::{ForeignAppImporter, ForeignImportError};

const DELIMITER: &str = "<|||>";
const SESSIONS_PREFIX: &str = "Servers\\";

type Values<'a> = HashMap<&'a str, &'a str>;

#[derive(Default)]
pub struct HeidiSqlImporter;

#[async_trait::async_trait]
impl ForeignAppImporter for HeidiSqlImporter {
    fn id(&self) -> &'static str {
        "heidisql"
    }
    fn display_name(&self) -> &'static str {
        "HeidiSQL"
    }
    fn import_file_types(&self) -> Option<Vec<&'static str>> {
        Some(vec!["txt"])
    }
    async fn is_available(&self) -> bool {
        false
    }
    async fn connection_count(&self) -> usize {
        0
    }

    async fn import(
        &self,
        _include_passwords: bool,
        file: Option<&Path>,
    ) -> Result<ImportEnvelope, ForeignImportError> {
        let not_found = || ForeignImportError::FileNotFound(self.display_name().to_string());
        let bytes = std::fs::read(file.ok_or_else(not_found)?).map_err(|_| not_found())?;
        let text = String::from_utf8_lossy(&bytes);
        if !text.contains(DELIMITER) {
            return Err(ForeignImportError::UnsupportedFormat(
                "Not a HeidiSQL settings export".into(),
            ));
        }

        let mut envelope = ImportEnvelope {
            source_name: self.display_name().to_string(),
            ..Default::default()
        };
        for (path, values) in group_by_session(&text) {
            // Folders are keys that carry a `Folder` value; sessions never do.
            if values.contains_key("Folder") {
                continue;
            }
            let net_type = values
                .get("NetType")
                .and_then(|v| v.parse().ok())
                .unwrap_or(0);
            let Some((driver_label, ssh_tunnel)) = map_net_type(net_type) else {
                log::warn!(
                    "HeidiSQL session \"{path}\" skipped: unsupported network type {net_type}"
                );
                continue;
            };
            let conn = parse_session(path, &values, driver_label, ssh_tunnel);
            if let Some(group) = &conn.group_name {
                if !envelope.group_names.contains(group) {
                    envelope.group_names.push(group.clone());
                }
            }
            envelope.connections.push(conn);
        }

        if envelope.connections.is_empty() {
            return Err(ForeignImportError::NoConnectionsFound);
        }
        Ok(envelope)
    }
}

/// Collect the `Servers\...` lines of an export into `session path -> values`.
/// The type column is ignored: HeidiSQL's integer code differs between builds.
fn group_by_session(text: &str) -> BTreeMap<&str, Values<'_>> {
    let mut sessions: BTreeMap<&str, Values> = BTreeMap::new();
    for line in text.trim_start_matches('\u{feff}').lines() {
        let mut parts = line.splitn(3, DELIMITER);
        let (Some(key), Some(_type), Some(raw)) = (parts.next(), parts.next(), parts.next()) else {
            continue;
        };
        let Some((path, name)) = key
            .strip_prefix(SESSIONS_PREFIX)
            .and_then(|k| k.rsplit_once('\\'))
        else {
            continue;
        };
        sessions.entry(path).or_default().insert(name, raw);
    }
    sessions
}

/// Driver label and SSH-tunnel flag for the HeidiSQL `NetType` ordinals
/// (`TNetType` in HeidiSQL's `dbstructures.pas`) that Tabularis can open.
fn map_net_type(net_type: u32) -> Option<(&'static str, bool)> {
    match net_type {
        0 | 11 | 16 => Some(("MySQL", false)),
        2 => Some(("MySQL", true)),
        4 => Some(("SQL Server", false)),
        8 => Some(("PostgreSQL", false)),
        9 => Some(("PostgreSQL", true)),
        10 => Some(("SQLite", false)),
        _ => None,
    }
}

fn value<'a>(values: &Values<'a>, key: &str) -> &'a str {
    values.get(key).copied().unwrap_or("")
}

fn parse_session(
    path: &str,
    values: &Values,
    driver_label: &str,
    ssh_tunnel: bool,
) -> ImportedConnection {
    let mut segments = path.rsplit('\\');
    let name = segments.next().unwrap_or(path).to_string();
    let group_name = segments.next().map(str::to_string);

    let driver_id = driver_map::canonical_id(driver_label);
    let (host, port, database) = if driver_id == "sqlite" {
        // SQLite sessions keep their database files in `Host`, separated by `|`.
        let file = value(values, "Host").split('|').next().unwrap_or("");
        (String::new(), 0, file.to_string())
    } else {
        let host = Some(value(values, "Host"))
            .filter(|h| !h.is_empty())
            .unwrap_or("localhost");
        let port = value(values, "Port")
            .parse()
            .ok()
            .filter(|p| *p != 0)
            .unwrap_or_else(|| driver_map::default_port(&driver_id));
        let database = value(values, "Databases")
            .split(';')
            .find(|d| !d.is_empty())
            .unwrap_or("");
        (host.to_string(), port, database.to_string())
    };

    let ssh = ssh_tunnel.then(|| {
        let key = value(values, "SSHtunnelPrivateKey").trim();
        ImportedSsh {
            host: value(values, "SSHtunnelHost").to_string(),
            port: value(values, "SSHtunnelHostPort").parse().ok(),
            username: value(values, "SSHtunnelUser").to_string(),
            auth_type: if key.is_empty() {
                "password"
            } else {
                "ssh_key"
            }
            .to_string(),
            private_key_path: (!key.is_empty()).then(|| key.to_string()),
        }
    });

    ImportedConnection {
        name,
        host,
        port,
        database,
        username: value(values, "User").to_string(),
        driver_label: driver_label.to_string(),
        ssh,
        ssl: None,
        group_name,
    }
}
