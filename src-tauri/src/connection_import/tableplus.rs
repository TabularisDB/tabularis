//! TablePlus importer (macOS). Reads `Connections.plist` / `ConnectionGroups.plist`
//! from TablePlus' Application Support data dir and pulls passwords from the
//! login Keychain. Ported from TablePro's `TablePlusImporter.swift`.

use std::path::{Path, PathBuf};

use plist::Value;

use super::keychain_read::{read_generic_password, KeychainReadResult};
use super::types::{ImportEnvelope, ImportedConnection, ImportedCredentials, ImportedSsh, ImportedSsl};
use super::{driver_map, resolve_key_path, ForeignAppImporter, ForeignImportError};

const KEYCHAIN_SERVICE: &str = "com.tableplus.TablePlus";
const KNOWN_BUNDLE_IDS: &[&str] = &["com.tinyapp.TablePlus", "com.tinyapp.TablePlus-setapp"];

pub struct TablePlusImporter {
    /// Override of the TablePlus `Data` directory; `None` = auto-discover.
    data_dir_override: Option<PathBuf>,
}

impl Default for TablePlusImporter {
    fn default() -> Self {
        Self {
            data_dir_override: None,
        }
    }
}

#[async_trait::async_trait]
impl ForeignAppImporter for TablePlusImporter {
    fn id(&self) -> &'static str {
        "tableplus"
    }
    fn display_name(&self) -> &'static str {
        "TablePlus"
    }
    fn reads_passwords_from_keychain(&self) -> bool {
        true
    }
    async fn is_available(&self) -> bool {
        self.connections_file().is_file()
    }
    async fn connection_count(&self) -> usize {
        load_plist_array(&self.connections_file())
            .map(|a| a.len())
            .unwrap_or(0)
    }

    async fn import(
        &self,
        include_passwords: bool,
        _file: Option<&Path>,
    ) -> Result<ImportEnvelope, ForeignImportError> {
        let path = self.connections_file();
        if !path.is_file() {
            return Err(ForeignImportError::FileNotFound(self.display_name().to_string()));
        }
        let entries = load_plist_array(&path).ok_or_else(|| {
            ForeignImportError::UnsupportedFormat("Expected array in Connections.plist".into())
        })?;

        let group_map = self.load_groups();
        let mut envelope = ImportEnvelope {
            source_name: self.display_name().to_string(),
            ..Default::default()
        };
        let mut group_names: Vec<String> = Vec::new();

        for entry in &entries {
            let dict = match entry.as_dictionary() {
                Some(d) => d,
                None => continue,
            };
            let name = match dict.get("ConnectionName").and_then(Value::as_string) {
                Some(n) => n.to_string(),
                None => continue,
            };

            let driver_label = map_driver(dict.get("Driver").and_then(Value::as_string).unwrap_or(""));
            let driver_id = driver_map::canonical_id(&driver_label);
            let host = dict
                .get("DatabaseHost")
                .and_then(Value::as_string)
                .unwrap_or("localhost")
                .to_string();
            let port = dict
                .get("DatabasePort")
                .and_then(plist_port)
                .unwrap_or_else(|| driver_map::default_port(&driver_id));
            let username = dict
                .get("DatabaseUser")
                .and_then(Value::as_string)
                .unwrap_or("")
                .to_string();
            let database = if driver_id == "sqlite" {
                dict.get("DatabasePath").and_then(Value::as_string)
            } else {
                dict.get("DatabaseName").and_then(Value::as_string)
            }
            .unwrap_or("")
            .to_string();

            let group_name = dict
                .get("GroupID")
                .and_then(Value::as_string)
                .filter(|s| !s.is_empty())
                .and_then(|gid| group_map.get(gid).cloned());
            if let Some(g) = &group_name {
                if !group_names.contains(g) {
                    group_names.push(g.clone());
                }
            }

            let conn = ImportedConnection {
                name,
                host,
                port,
                database,
                username,
                driver_label,
                ssh: parse_ssh(dict),
                ssl: parse_ssl(dict),
                group_name,
            };
            let index = envelope.connections.len();
            envelope.connections.push(conn);

            if include_passwords && !envelope.credentials_aborted {
                if let Some(conn_id) = dict.get("ID").and_then(Value::as_string) {
                    let creds = read_credentials(conn_id, &mut envelope.credentials_aborted);
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

impl TablePlusImporter {
    #[cfg(test)]
    pub(crate) fn with_data_dir(dir: PathBuf) -> Self {
        Self {
            data_dir_override: Some(dir),
        }
    }

    fn data_dir(&self) -> PathBuf {
        if let Some(dir) = &self.data_dir_override {
            return dir.clone();
        }
        let home = super::home_dir().unwrap_or_default();
        let bundle = KNOWN_BUNDLE_IDS
            .iter()
            .map(|b| home.join(format!("Library/Application Support/{}/Data", b)))
            .find(|p| p.is_dir());
        bundle.unwrap_or_else(|| {
            home.join(format!("Library/Application Support/{}/Data", KNOWN_BUNDLE_IDS[0]))
        })
    }

    fn connections_file(&self) -> PathBuf {
        self.data_dir().join("Connections.plist")
    }

    fn load_groups(&self) -> std::collections::HashMap<String, String> {
        let mut map = std::collections::HashMap::new();
        if let Some(array) = load_plist_array(&self.data_dir().join("ConnectionGroups.plist")) {
            for group in array {
                if let Some(dict) = group.as_dictionary() {
                    if let (Some(id), Some(name)) = (
                        dict.get("ID").and_then(Value::as_string),
                        dict.get("Name").and_then(Value::as_string),
                    ) {
                        map.insert(id.to_string(), name.to_string());
                    }
                }
            }
        }
        map
    }
}

fn parse_ssh(dict: &plist::Dictionary) -> Option<ImportedSsh> {
    if dict.get("isOverSSH").and_then(Value::as_boolean) != Some(true) {
        return None;
    }
    let use_key = dict.get("isUsePrivateKey").and_then(Value::as_boolean).unwrap_or(false);
    let key_name = dict.get("ServerPrivateKeyName").and_then(Value::as_string).unwrap_or("");
    Some(ImportedSsh {
        host: dict.get("ServerAddress").and_then(Value::as_string).unwrap_or("").to_string(),
        port: dict.get("ServerPort").and_then(plist_port),
        username: dict.get("ServerUser").and_then(Value::as_string).unwrap_or("").to_string(),
        auth_type: if use_key { "ssh_key" } else { "password" }.to_string(),
        private_key_path: if use_key && !key_name.is_empty() {
            Some(resolve_key_path(key_name))
        } else {
            None
        },
    })
}

fn parse_ssl(dict: &plist::Dictionary) -> Option<ImportedSsl> {
    let tls_mode = dict.get("tLSMode")?.as_signed_integer()?;
    let mode = match tls_mode {
        0 => "prefer",
        1 => "require",
        2 => "verify-ca",
        3 => "verify-full",
        _ => return None,
    }
    .to_string();
    let paths: Vec<String> = dict
        .get("TlsKeyPaths")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .map(|v| v.as_string().unwrap_or("").to_string())
                .collect()
        })
        .unwrap_or_default();
    let at = |i: usize| paths.get(i).filter(|s| !s.is_empty()).cloned();
    Some(ImportedSsl {
        mode,
        ca_certificate_path: at(0),
        client_certificate_path: at(1),
        client_key_path: at(2),
    })
}

fn read_credentials(conn_id: &str, abort: &mut bool) -> ImportedCredentials {
    let mut read = |account: String| -> Option<String> {
        if *abort {
            return None;
        }
        match read_generic_password(KEYCHAIN_SERVICE, &account) {
            KeychainReadResult::Found(v) => Some(v),
            KeychainReadResult::NotFound => None,
            KeychainReadResult::Cancelled => {
                *abort = true;
                None
            }
        }
    };
    ImportedCredentials {
        password: read(format!("{conn_id}_database")),
        ssh_password: read(format!("{conn_id}_server")),
        ssh_key_passphrase: read(format!("{conn_id}_server_key")),
    }
}

/// TablePlus stores ports as a string or integer plist value.
fn plist_port(v: &Value) -> Option<u16> {
    if let Some(s) = v.as_string() {
        return s.parse().ok();
    }
    v.as_signed_integer().and_then(|n| u16::try_from(n).ok())
}

fn map_driver(driver: &str) -> String {
    match driver {
        "MySQL" => "MySQL",
        "PostgreSQL" => "PostgreSQL",
        "Mongo" => "MongoDB",
        "SQLite" => "SQLite",
        "Redis" => "Redis",
        "MSSQL" => "SQL Server",
        "Redshift" => "Redshift",
        "MariaDB" => "MariaDB",
        "CockroachDB" => "CockroachDB",
        other => other,
    }
    .to_string()
}

fn load_plist_array(path: &Path) -> Option<Vec<Value>> {
    let value = Value::from_file(path).ok()?;
    value.as_array().cloned()
}
