//! Sequel Ace importer (macOS). Reads `Favorites.plist` from the sandbox
//! container and pulls passwords from the login Keychain. Sequel Ace is
//! MySQL-only. Ported from TablePro's `SequelAceImporter.swift`.

use std::path::{Path, PathBuf};

use plist::Value;

use super::keychain_read::{read_generic_password, KeychainReadResult};
use super::types::{ImportEnvelope, ImportedConnection, ImportedCredentials, ImportedSsh, ImportedSsl};
use super::{resolve_key_path, ForeignAppImporter, ForeignImportError};

pub struct SequelAceImporter {
    favorites_override: Option<PathBuf>,
}

impl Default for SequelAceImporter {
    fn default() -> Self {
        Self {
            favorites_override: None,
        }
    }
}

#[async_trait::async_trait]
impl ForeignAppImporter for SequelAceImporter {
    fn id(&self) -> &'static str {
        "sequelace"
    }
    fn display_name(&self) -> &'static str {
        "Sequel Ace"
    }
    fn reads_passwords_from_keychain(&self) -> bool {
        true
    }
    async fn is_available(&self) -> bool {
        self.favorites_file().is_file()
    }
    async fn connection_count(&self) -> usize {
        self.root_children().map(|c| count(&c)).unwrap_or(0)
    }

    async fn import(
        &self,
        include_passwords: bool,
        _file: Option<&Path>,
    ) -> Result<ImportEnvelope, ForeignImportError> {
        if !self.favorites_file().is_file() {
            return Err(ForeignImportError::FileNotFound(self.display_name().to_string()));
        }
        let children = self.root_children().ok_or_else(|| {
            ForeignImportError::UnsupportedFormat("Missing Favorites Root or Children".into())
        })?;

        let mut envelope = ImportEnvelope {
            source_name: self.display_name().to_string(),
            ..Default::default()
        };
        let mut group_names: Vec<String> = Vec::new();
        parse_children(
            &children,
            None,
            include_passwords,
            &mut envelope,
            &mut group_names,
        );

        if envelope.connections.is_empty() {
            return Err(ForeignImportError::NoConnectionsFound);
        }
        envelope.group_names = group_names;
        Ok(envelope)
    }
}

impl SequelAceImporter {
    #[cfg(test)]
    pub(crate) fn with_favorites(path: PathBuf) -> Self {
        Self {
            favorites_override: Some(path),
        }
    }

    fn favorites_file(&self) -> PathBuf {
        if let Some(p) = &self.favorites_override {
            return p.clone();
        }
        super::home_dir()
            .unwrap_or_default()
            .join("Library/Containers/com.sequel-ace.sequel-ace/Data/Library/Application Support/Sequel Ace/Data/Favorites.plist")
    }

    fn root_children(&self) -> Option<Vec<Value>> {
        let root = Value::from_file(self.favorites_file()).ok()?;
        root.as_dictionary()?
            .get("Favorites Root")?
            .as_dictionary()?
            .get("Children")?
            .as_array()
            .cloned()
    }
}

fn count(children: &[Value]) -> usize {
    let mut n = 0;
    for child in children {
        let Some(dict) = child.as_dictionary() else { continue };
        if let Some(sub) = dict.get("Children").and_then(Value::as_array) {
            n += count(sub);
        } else if dict.contains_key("host") || dict.contains_key("id") {
            n += 1;
        }
    }
    n
}

fn parse_children(
    children: &[Value],
    group_name: Option<&str>,
    include_passwords: bool,
    envelope: &mut ImportEnvelope,
    group_names: &mut Vec<String>,
) {
    for child in children {
        let Some(dict) = child.as_dictionary() else { continue };
        if let Some(sub) = dict.get("Children").and_then(Value::as_array) {
            let name = dict
                .get("Name")
                .and_then(Value::as_string)
                .unwrap_or("Untitled Group")
                .to_string();
            if !group_names.contains(&name) {
                group_names.push(name.clone());
            }
            parse_children(sub, Some(&name), include_passwords, envelope, group_names);
        } else {
            let conn = parse_connection(dict, group_name);
            let index = envelope.connections.len();
            envelope.connections.push(conn);
            if include_passwords && !envelope.credentials_aborted {
                let creds = read_credentials(dict, &mut envelope.credentials_aborted);
                if !creds.is_empty() {
                    envelope.credentials_by_index.insert(index, creds);
                }
            }
        }
    }
}

fn parse_connection(dict: &plist::Dictionary, group_name: Option<&str>) -> ImportedConnection {
    let connection_type = dict.get("type").and_then(Value::as_signed_integer).unwrap_or(0);
    ImportedConnection {
        name: dict.get("name").and_then(Value::as_string).unwrap_or("Untitled").to_string(),
        host: dict.get("host").and_then(Value::as_string).unwrap_or("localhost").to_string(),
        port: dict.get("port").and_then(plist_port).unwrap_or(3306),
        database: dict.get("database").and_then(Value::as_string).unwrap_or("").to_string(),
        username: dict.get("user").and_then(Value::as_string).unwrap_or("").to_string(),
        driver_label: "MySQL".to_string(),
        ssh: parse_ssh(dict, connection_type),
        ssl: parse_ssl(dict),
        group_name: group_name.map(|s| s.to_string()),
    }
}

fn parse_ssh(dict: &plist::Dictionary, connection_type: i64) -> Option<ImportedSsh> {
    if connection_type != 2 {
        return None;
    }
    let key_enabled = dict.get("sshKeyLocationEnabled").and_then(Value::as_signed_integer).unwrap_or(0) != 0;
    let raw_key = dict.get("sshKeyLocation").and_then(Value::as_string).unwrap_or("");
    Some(ImportedSsh {
        host: dict.get("sshHost").and_then(Value::as_string).unwrap_or("").to_string(),
        port: dict.get("sshPort").and_then(plist_port),
        username: dict.get("sshUser").and_then(Value::as_string).unwrap_or("").to_string(),
        auth_type: if key_enabled { "ssh_key" } else { "password" }.to_string(),
        private_key_path: if key_enabled {
            Some(resolve_key_path(raw_key))
        } else {
            None
        },
    })
}

fn parse_ssl(dict: &plist::Dictionary) -> Option<ImportedSsl> {
    let use_ssl = match dict.get("useSSL") {
        Some(v) => v.as_signed_integer().map(|n| n != 0).or_else(|| v.as_boolean()).unwrap_or(false),
        None => false,
    };
    if !use_ssl {
        return None;
    }
    let get = |k: &str| dict.get(k).and_then(Value::as_string).map(|s| s.to_string());
    Some(ImportedSsl {
        mode: "require".to_string(),
        ca_certificate_path: get("sslCACertFileLocation"),
        client_certificate_path: get("sslCertificateFileLocation"),
        client_key_path: get("sslKeyFileLocation"),
    })
}

fn read_credentials(dict: &plist::Dictionary, abort: &mut bool) -> ImportedCredentials {
    let name = dict.get("name").and_then(Value::as_string).unwrap_or("");
    let conn_id = dict
        .get("id")
        .and_then(Value::as_signed_integer)
        .map(|i| i.to_string())
        .unwrap_or_else(|| "0".to_string());
    let user = dict.get("user").and_then(Value::as_string).unwrap_or("");
    let host = dict.get("host").and_then(Value::as_string).unwrap_or("");
    let database = dict.get("database").and_then(Value::as_string).unwrap_or("");

    let mut read = |service: String, account: String| -> Option<String> {
        if *abort {
            return None;
        }
        match read_generic_password(&service, &account) {
            KeychainReadResult::Found(v) => Some(v),
            KeychainReadResult::NotFound => None,
            KeychainReadResult::Cancelled => {
                *abort = true;
                None
            }
        }
    };

    let password = read(
        format!("Sequel Ace : {name} ({conn_id})"),
        format!("{user}@{host}/{database}"),
    );

    let ssh_password = if dict.get("type").and_then(Value::as_signed_integer) == Some(2) {
        let ssh_user = dict.get("sshUser").and_then(Value::as_string).unwrap_or("");
        let ssh_host = dict.get("sshHost").and_then(Value::as_string).unwrap_or("");
        read(
            format!("Sequel Ace SSHTunnel : {name} ({conn_id})"),
            format!("{ssh_user}@{ssh_host}"),
        )
    } else {
        None
    };

    ImportedCredentials {
        password,
        ssh_password,
        ssh_key_passphrase: None,
    }
}

fn plist_port(v: &Value) -> Option<u16> {
    if let Some(s) = v.as_string() {
        return s.parse().ok();
    }
    v.as_signed_integer().and_then(|n| u16::try_from(n).ok())
}
