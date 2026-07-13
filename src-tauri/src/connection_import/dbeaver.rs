//! DBeaver importer. Reads `data-sources.json` from a DBeaver workspace and
//! decrypts `credentials-config.json` (AES-128-CBC, hardcoded key). DBeaver is
//! cross-platform; the workspace lives under a per-OS data root. Ported from
//! TablePro's `DBeaverImporter.swift`.

use std::path::{Path, PathBuf};

use serde_json::Value;

use super::types::{
    ImportEnvelope, ImportedConnection, ImportedCredentials, ImportedSsh, ImportedSsl,
};
use super::{crypto, driver_map, resolve_key_path, ForeignAppImporter, ForeignImportError};

pub struct DBeaverImporter {
    /// Directory containing `workspace*` folders. Injectable for tests.
    data_root: PathBuf,
}

impl Default for DBeaverImporter {
    fn default() -> Self {
        Self {
            data_root: default_data_root(),
        }
    }
}

/// Per-OS DBeaver data root. macOS uses `~/Library/DBeaverData`; Linux and
/// Windows use the platform data dir (`~/.local/share`, `%APPDATA%`).
fn default_data_root() -> PathBuf {
    #[cfg(target_os = "macos")]
    {
        super::home_dir()
            .map(|h| h.join("Library/DBeaverData"))
            .unwrap_or_default()
    }
    #[cfg(not(target_os = "macos"))]
    {
        directories::BaseDirs::new()
            .map(|d| d.data_dir().join("DBeaverData"))
            .unwrap_or_default()
    }
}

#[async_trait::async_trait]
impl ForeignAppImporter for DBeaverImporter {
    fn id(&self) -> &'static str {
        "dbeaver"
    }
    fn display_name(&self) -> &'static str {
        "DBeaver"
    }
    async fn is_available(&self) -> bool {
        self.find_data_sources_file().is_some()
    }
    async fn connection_count(&self) -> usize {
        self.find_data_sources_file()
            .and_then(|p| load_json(&p))
            .and_then(|j| {
                j.get("connections")
                    .and_then(Value::as_object)
                    .map(|m| m.len())
            })
            .unwrap_or(0)
    }

    async fn import(
        &self,
        include_passwords: bool,
        _file: Option<&Path>,
    ) -> Result<ImportEnvelope, ForeignImportError> {
        let ds_path = self
            .find_data_sources_file()
            .ok_or_else(|| ForeignImportError::FileNotFound(self.display_name().to_string()))?;

        let json = load_json(&ds_path)
            .ok_or_else(|| ForeignImportError::ParseError("Could not parse data-sources.json".into()))?;

        let connections = json
            .get("connections")
            .and_then(Value::as_object)
            .ok_or_else(|| {
                ForeignImportError::UnsupportedFormat("Missing connections key".into())
            })?;

        let empty = serde_json::Map::new();
        let folders = json.get("folders").and_then(Value::as_object).unwrap_or(&empty);

        let creds_map = if include_passwords {
            let creds_path = ds_path
                .parent()
                .map(|p| p.join("credentials-config.json"))
                .unwrap_or_default();
            load_credentials(&creds_path)
        } else {
            serde_json::Map::new()
        };

        let mut envelope = ImportEnvelope {
            source_name: self.display_name().to_string(),
            ..Default::default()
        };
        let mut group_names: Vec<String> = Vec::new();

        for (conn_id, conn_val) in connections {
            let conn_dict = match conn_val.as_object() {
                Some(d) => d,
                None => continue,
            };
            let credential_username = creds_map
                .get(conn_id)
                .and_then(|c| c.get("#connection"))
                .and_then(|c| c.get("user"))
                .and_then(Value::as_str);

            let conn = parse_connection(conn_id, conn_dict, folders, credential_username);
            if let Some(g) = &conn.group_name {
                if !group_names.contains(g) {
                    group_names.push(g.clone());
                }
            }
            let index = envelope.connections.len();
            envelope.connections.push(conn);

            if include_passwords {
                if let Some(conn_creds) = creds_map.get(conn_id) {
                    let creds = extract_credentials(conn_creds);
                    if !creds.is_empty() {
                        envelope.credentials_by_index.insert(index, creds);
                    }
                }
            }
        }

        if envelope.connections.is_empty() {
            return Err(ForeignImportError::NoConnectionsFound);
        }
        envelope.group_names = group_names;
        Ok(envelope)
    }
}

impl DBeaverImporter {
    #[cfg(test)]
    pub(crate) fn with_data_root(data_root: PathBuf) -> Self {
        Self { data_root }
    }

    /// Scan `<data_root>/workspace*/<project>/.dbeaver/data-sources.json`,
    /// preferring the highest workspace version.
    fn find_data_sources_file(&self) -> Option<PathBuf> {
        let mut workspaces: Vec<PathBuf> = std::fs::read_dir(&self.data_root)
            .ok()?
            .flatten()
            .map(|e| e.path())
            .filter(|p| {
                p.is_dir()
                    && p.file_name()
                        .and_then(|n| n.to_str())
                        .map(|n| n.starts_with("workspace"))
                        .unwrap_or(false)
            })
            .collect();
        workspaces.sort_by(|a, b| b.file_name().cmp(&a.file_name()));

        for workspace in workspaces {
            let projects = match std::fs::read_dir(&workspace) {
                Ok(p) => p,
                Err(_) => continue,
            };
            for project in projects.flatten() {
                let candidate = project.path().join(".dbeaver/data-sources.json");
                if candidate.is_file() {
                    return Some(candidate);
                }
            }
        }
        None
    }
}

fn load_json(path: &Path) -> Option<Value> {
    let data = std::fs::read(path).ok()?;
    serde_json::from_slice(&data).ok()
}

/// Decrypt and parse `credentials-config.json` into a map keyed by connection id.
fn load_credentials(path: &Path) -> serde_json::Map<String, Value> {
    let data = match std::fs::read(path) {
        Ok(d) => d,
        Err(_) => return serde_json::Map::new(),
    };
    let decrypted = match crypto::decrypt_dbeaver(&data) {
        Some(d) => d,
        None => return serde_json::Map::new(),
    };
    serde_json::from_slice::<Value>(&decrypted)
        .ok()
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default()
}

fn parse_connection(
    conn_id: &str,
    dict: &serde_json::Map<String, Value>,
    folders: &serde_json::Map<String, Value>,
    credential_username: Option<&str>,
) -> ImportedConnection {
    let name = dict
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or(conn_id)
        .to_string();
    let provider = dict.get("provider").and_then(Value::as_str).unwrap_or("");
    let driver_label = map_provider(provider);

    let config = dict.get("configuration").and_then(Value::as_object);
    let host = config
        .and_then(|c| c.get("host"))
        .and_then(Value::as_str)
        .unwrap_or("localhost")
        .to_string();
    let port = config
        .and_then(|c| c.get("port"))
        .and_then(parse_port)
        .unwrap_or_else(|| driver_map::default_port(&driver_map::canonical_id(&driver_label)));
    let database = config
        .and_then(|c| c.get("database").or_else(|| c.get("url")))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let config_user = config
        .and_then(|c| c.get("user"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let username = credential_username
        .filter(|s| !s.is_empty())
        .unwrap_or(config_user)
        .to_string();

    let group_name = dict
        .get("folder")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(|path| {
            folders
                .get(path)
                .and_then(|f| f.get("description"))
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string())
                .unwrap_or_else(|| path.rsplit('/').next().unwrap_or(path).to_string())
        });

    ImportedConnection {
        name,
        host,
        port,
        database,
        username,
        driver_label,
        ssh: config.and_then(parse_ssh),
        ssl: config.and_then(parse_ssl),
        group_name,
    }
}

fn parse_ssh(config: &serde_json::Map<String, Value>) -> Option<ImportedSsh> {
    let tunnel = config
        .get("handlers")
        .and_then(|h| h.get("ssh_tunnel"))
        .and_then(Value::as_object)?;
    let properties = tunnel.get("properties").and_then(Value::as_object);

    let enabled = tunnel
        .get("enabled")
        .and_then(Value::as_bool)
        .unwrap_or_else(|| properties.map(|p| p.contains_key("host")).unwrap_or(false));
    if !enabled {
        return None;
    }
    let props = properties?;
    let host = props.get("host").and_then(Value::as_str).unwrap_or("").to_string();
    let port = props.get("port").and_then(parse_port);
    let username = props
        .get("username")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let auth_type = props.get("authType").and_then(Value::as_str).unwrap_or("PASSWORD");
    let key_path = props.get("keyPath").and_then(Value::as_str).unwrap_or("");

    let (auth, private_key_path) = if auth_type == "PUBLIC_KEY" {
        ("ssh_key".to_string(), Some(resolve_key_path(key_path)))
    } else {
        ("password".to_string(), None)
    };

    Some(ImportedSsh {
        host,
        port,
        username,
        auth_type: auth,
        private_key_path,
    })
}

fn parse_ssl(config: &serde_json::Map<String, Value>) -> Option<ImportedSsl> {
    let ssl = config
        .get("handlers")
        .and_then(|h| h.get("ssl"))
        .and_then(Value::as_object)?;
    if !ssl.get("enabled").and_then(Value::as_bool).unwrap_or(false) {
        return None;
    }
    let props = ssl.get("properties").and_then(Value::as_object);
    let mode = match props.and_then(|p| p.get("sslMode")).and_then(Value::as_str) {
        Some("require") => "require",
        Some("verify-ca") => "verify-ca",
        Some("verify-full") => "verify-full",
        _ => "prefer",
    }
    .to_string();
    let get = |k: &str| {
        props
            .and_then(|p| p.get(k))
            .and_then(Value::as_str)
            .map(|s| s.to_string())
    };
    Some(ImportedSsl {
        mode,
        ca_certificate_path: get("caCertPath"),
        client_certificate_path: get("clientCertPath"),
        client_key_path: get("clientKeyPath"),
    })
}

fn extract_credentials(conn_creds: &Value) -> ImportedCredentials {
    let password = conn_creds
        .get("#connection")
        .and_then(|c| c.get("password"))
        .and_then(Value::as_str)
        .map(|s| s.to_string());
    let ssh_password = conn_creds
        .get("ssh_tunnel")
        .and_then(|c| c.get("password"))
        .and_then(Value::as_str)
        .map(|s| s.to_string());
    ImportedCredentials {
        password,
        ssh_password,
        ssh_key_passphrase: None,
    }
}

/// DBeaver stores ports as either a number or a string.
fn parse_port(v: &Value) -> Option<u16> {
    if let Some(n) = v.as_u64() {
        return u16::try_from(n).ok();
    }
    v.as_str().and_then(|s| s.parse().ok())
}

fn map_provider(provider: &str) -> String {
    match provider.to_ascii_lowercase().as_str() {
        "mysql" => "MySQL",
        "postgresql" => "PostgreSQL",
        "sqlite" => "SQLite",
        "sqlserver" => "SQL Server",
        "oracle" => "Oracle",
        "mongo" | "mongodb" => "MongoDB",
        "redis" => "Redis",
        "clickhouse" => "ClickHouse",
        "mariadb" => "MariaDB",
        "cassandra" => "Cassandra",
        other => return other.to_string(),
    }
    .to_string()
}
