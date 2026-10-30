//! MySQL Workbench importer. Reads `connections.xml` from Workbench's user data
//! folder. Passwords live in the OS keychain or Workbench's own vault, so they
//! are not imported.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use roxmltree::{Document, Node};

use super::types::{ImportEnvelope, ImportedConnection, ImportedSsh, ImportedSsl};
use super::{resolve_key_path, ForeignAppImporter, ForeignImportError};

const CONNECTIONS_FILE: &str = "connections.xml";
const CONNECTION_STRUCT: &str = "db.mgmt.Connection";

/// Workbench identifies how a connection reaches the server by its driver id.
const DRIVER_TCP: &str = "com.mysql.rdbms.mysql.driver.native";
const DRIVER_SSH: &str = "com.mysql.rdbms.mysql.driver.native_sshtun";

#[derive(Default)]
pub struct MySqlWorkbenchImporter {
    /// Override of the Workbench data folder; `None` = auto-discover.
    data_dir_override: Option<PathBuf>,
}

#[async_trait::async_trait]
impl ForeignAppImporter for MySqlWorkbenchImporter {
    fn id(&self) -> &'static str {
        "mysqlworkbench"
    }
    fn display_name(&self) -> &'static str {
        "MySQL Workbench"
    }
    fn supports_manual_path(&self) -> bool {
        true
    }
    async fn is_available(&self) -> bool {
        self.connections_file(None).is_file()
    }
    async fn connection_count(&self) -> usize {
        read_connections(&self.connections_file(None))
            .map(|c| c.len())
            .unwrap_or(0)
    }

    async fn import(
        &self,
        _include_passwords: bool,
        file: Option<&Path>,
    ) -> Result<ImportEnvelope, ForeignImportError> {
        let path = self.connections_file(file);
        if !path.is_file() {
            return Err(ForeignImportError::FileNotFound(
                self.display_name().to_string(),
            ));
        }
        let connections = read_connections(&path).ok_or_else(|| {
            ForeignImportError::ParseError(format!("Invalid XML in {CONNECTIONS_FILE}"))
        })?;
        if connections.is_empty() {
            return Err(ForeignImportError::NoConnectionsFound);
        }
        Ok(ImportEnvelope {
            source_name: self.display_name().to_string(),
            connections,
            ..Default::default()
        })
    }
}

impl MySqlWorkbenchImporter {
    #[cfg(test)]
    pub(crate) fn with_data_dir(path: PathBuf) -> Self {
        Self {
            data_dir_override: Some(path),
        }
    }

    /// `manual` may be Workbench's data folder or `connections.xml` itself.
    fn connections_file(&self, manual: Option<&Path>) -> PathBuf {
        if let Some(path) = manual {
            return if path.is_dir() {
                path.join(CONNECTIONS_FILE)
            } else {
                path.to_path_buf()
            };
        }
        self.data_dir().join(CONNECTIONS_FILE)
    }

    fn data_dir(&self) -> PathBuf {
        if let Some(dir) = &self.data_dir_override {
            return dir.clone();
        }
        let home = super::home_dir().unwrap_or_default();
        if cfg!(target_os = "windows") {
            directories::BaseDirs::new()
                .map(|d| d.config_dir().join("MySQL").join("Workbench"))
                .unwrap_or_else(|| home.join("AppData/Roaming/MySQL/Workbench"))
        } else if cfg!(target_os = "macos") {
            home.join("Library/Application Support/MySQL/Workbench")
        } else {
            home.join(".mysql/workbench")
        }
    }
}

/// Parses `connections.xml`. Returns `None` when the file is unreadable or not
/// XML. Connections Tabularis cannot represent (local sockets, other drivers)
/// are skipped so one of them does not fail the whole import.
fn read_connections(path: &Path) -> Option<Vec<ImportedConnection>> {
    let text = std::fs::read_to_string(path).ok()?;
    let doc = Document::parse(&text).ok()?;
    let mut connections = Vec::new();
    for node in doc.descendants().filter(is_connection) {
        match parse_connection(node) {
            Some(conn) => connections.push(conn),
            None => log::warn!(
                "Skipped MySQL Workbench connection \"{}\": unsupported connection method",
                key_text(node, "name").unwrap_or_default()
            ),
        }
    }
    Some(connections)
}

fn is_connection(node: &Node) -> bool {
    node.has_tag_name("value")
        && node.attribute("type") == Some("object")
        && node.attribute("struct-name") == Some(CONNECTION_STRUCT)
}

/// Text of the direct child element carrying `key="<key>"`.
fn key_text(node: Node, key: &str) -> Option<String> {
    node.children()
        .find(|c| c.is_element() && c.attribute("key") == Some(key))
        .map(|c| c.text().unwrap_or("").trim().to_string())
}

fn parameter_values(node: Node) -> HashMap<String, String> {
    node.children()
        .find(|c| c.is_element() && c.attribute("key") == Some("parameterValues"))
        .map(|dict| {
            dict.children()
                .filter(|c| c.is_element())
                .filter_map(|c| {
                    let key = c.attribute("key")?;
                    Some((key.to_string(), c.text().unwrap_or("").trim().to_string()))
                })
                .collect()
        })
        .unwrap_or_default()
}

fn parse_connection(node: Node) -> Option<ImportedConnection> {
    let driver = key_text(node, "driver")?;
    let over_ssh = match driver.as_str() {
        DRIVER_TCP => false,
        DRIVER_SSH => true,
        _ => return None,
    };
    let params = parameter_values(node);
    let get = |key: &str| {
        params
            .get(key)
            .map(String::as_str)
            .filter(|v| !v.is_empty())
    };

    let host = get("hostName").unwrap_or("127.0.0.1").to_string();
    let name = key_text(node, "name")
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| host.clone());
    Some(ImportedConnection {
        name,
        host,
        port: get("port").and_then(|p| p.parse().ok()).unwrap_or(3306),
        database: get("schema").unwrap_or("").to_string(),
        username: get("userName").unwrap_or("").to_string(),
        driver_label: "MySQL".to_string(),
        ssh: if over_ssh { parse_ssh(&params) } else { None },
        ssl: parse_ssl(&params),
        group_name: None,
    })
}

/// `sshHost` is stored as `host` or `host:port`.
fn parse_ssh(params: &HashMap<String, String>) -> Option<ImportedSsh> {
    let get = |key: &str| {
        params
            .get(key)
            .map(String::as_str)
            .filter(|v| !v.is_empty())
    };
    let (host, port) = split_host_port(get("sshHost")?);
    let key_file = get("sshKeyFile");
    Some(ImportedSsh {
        host,
        port,
        username: get("sshUserName").unwrap_or("").to_string(),
        auth_type: if key_file.is_some() {
            "ssh_key"
        } else {
            "password"
        }
        .to_string(),
        private_key_path: key_file.map(resolve_key_path),
    })
}

fn split_host_port(value: &str) -> (String, Option<u16>) {
    match value.rsplit_once(':') {
        Some((host, port)) if !host.contains(':') => match port.parse() {
            Ok(port) => (host.to_string(), Some(port)),
            Err(_) => (value.to_string(), None),
        },
        _ => (value.to_string(), None),
    }
}

/// `useSSL`: 0 = no, 1 = if available, 2 = required, 3 = require and verify the
/// CA, 4 = require and verify the server identity.
fn parse_ssl(params: &HashMap<String, String>) -> Option<ImportedSsl> {
    let get = |key: &str| {
        params
            .get(key)
            .map(String::as_str)
            .filter(|v| !v.is_empty())
    };
    let mode = match get("useSSL")?.parse::<u8>().ok()? {
        1 => "preferred",
        2 => "required",
        3 => "verify_ca",
        4 => "verify_identity",
        _ => return None,
    };
    Some(ImportedSsl {
        mode: mode.to_string(),
        ca_certificate_path: get("sslCA").map(str::to_string),
        client_certificate_path: get("sslCert").map(str::to_string),
        client_key_path: get("sslKey").map(str::to_string),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_ssh_host_and_port() {
        assert_eq!(
            split_host_port("bastion.example.com:2222"),
            ("bastion.example.com".into(), Some(2222))
        );
        assert_eq!(
            split_host_port("bastion.example.com"),
            ("bastion.example.com".into(), None)
        );
        assert_eq!(
            split_host_port("bastion:notaport"),
            ("bastion:notaport".into(), None)
        );
        assert_eq!(split_host_port("fe80::1"), ("fe80::1".into(), None));
    }

    #[test]
    fn maps_use_ssl_levels() {
        let mode = |level: &str| {
            let params = HashMap::from([("useSSL".to_string(), level.to_string())]);
            parse_ssl(&params).map(|ssl| ssl.mode)
        };
        assert_eq!(mode("0"), None);
        assert_eq!(mode("1").as_deref(), Some("preferred"));
        assert_eq!(mode("2").as_deref(), Some("required"));
        assert_eq!(mode("3").as_deref(), Some("verify_ca"));
        assert_eq!(mode("4").as_deref(), Some("verify_identity"));
        assert_eq!(mode("9"), None);
        assert_eq!(mode(""), None);
    }
}
