//! Navicat importer. Reads a `.ncx` connection export (File > Export
//! Connections): one `<Connection>` element per saved connection, every setting
//! stored as an XML attribute.
//!
//! Passwords are NOT imported: Navicat encrypts them in the export, and that
//! cipher is out of scope for this version.

use std::path::Path;

use roxmltree::{Document, Node};

use super::types::{ImportEnvelope, ImportedConnection, ImportedSsh};
use super::{driver_map, ForeignAppImporter, ForeignImportError};

#[derive(Default)]
pub struct NavicatImporter;

#[async_trait::async_trait]
impl ForeignAppImporter for NavicatImporter {
    fn id(&self) -> &'static str {
        "navicat"
    }
    fn display_name(&self) -> &'static str {
        "Navicat"
    }
    fn import_file_types(&self) -> Option<Vec<&'static str>> {
        Some(vec!["ncx"])
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
        let path = file
            .filter(|p| p.is_file())
            .ok_or_else(|| ForeignImportError::FileNotFound(self.display_name().to_string()))?;
        let xml = std::fs::read_to_string(path)
            .map_err(|e| ForeignImportError::ParseError(e.to_string()))?;
        let doc =
            Document::parse(&xml).map_err(|e| ForeignImportError::ParseError(e.to_string()))?;
        if doc.root_element().tag_name().name() != "Connections" {
            return Err(ForeignImportError::UnsupportedFormat(
                "Expected a Navicat <Connections> export".into(),
            ));
        }

        let connections: Vec<ImportedConnection> = doc
            .descendants()
            .filter(|n| n.has_tag_name("Connection"))
            .filter_map(parse_connection)
            .collect();
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

fn attr<'a>(node: Node<'a, '_>, name: &str) -> &'a str {
    node.attribute(name).map(str::trim).unwrap_or("")
}

fn non_empty(value: &str) -> Option<&str> {
    Some(value).filter(|v| !v.is_empty())
}

fn parse_connection(node: Node) -> Option<ImportedConnection> {
    let conn_type = attr(node, "ConnType");
    let name = non_empty(attr(node, "ConnectionName")).unwrap_or("Untitled");
    let Some(driver_label) = map_conn_type(conn_type) else {
        log::warn!(
            "Navicat import: skipped \"{name}\", unsupported connection type \"{conn_type}\""
        );
        return None;
    };

    let driver_id = driver_map::canonical_id(driver_label);
    let (host, port, database) = if driver_id == "sqlite" {
        ("", 0, attr(node, "DatabaseFileName"))
    } else {
        (
            non_empty(attr(node, "Host")).unwrap_or("localhost"),
            attr(node, "Port")
                .parse()
                .unwrap_or_else(|_| driver_map::default_port(&driver_id)),
            attr(node, "Database"),
        )
    };

    Some(ImportedConnection {
        name: name.to_string(),
        host: host.to_string(),
        port,
        database: database.to_string(),
        username: attr(node, "UserName").to_string(),
        driver_label: driver_label.to_string(),
        ssh: parse_ssh(node),
        ssl: None,
        group_name: None,
    })
}

fn parse_ssh(node: Node) -> Option<ImportedSsh> {
    if !attr(node, "SSH").eq_ignore_ascii_case("true") {
        return None;
    }
    let key = attr(node, "SSH_PrivateKey");
    let use_key =
        !key.is_empty() && !attr(node, "SSH_AuthenMethod").eq_ignore_ascii_case("PASSWORD");
    Some(ImportedSsh {
        host: attr(node, "SSH_Host").to_string(),
        port: attr(node, "SSH_Port").parse().ok(),
        username: attr(node, "SSH_UserName").to_string(),
        auth_type: if use_key { "ssh_key" } else { "password" }.to_string(),
        private_key_path: use_key.then(|| key.to_string()),
    })
}

/// Maps Navicat's `ConnType` values to the labels `driver_map` knows.
/// Unknown types return `None` and are skipped by the caller.
fn map_conn_type(conn_type: &str) -> Option<&'static str> {
    Some(match conn_type.to_ascii_uppercase().as_str() {
        "MYSQL" => "MySQL",
        "MARIADB" => "MariaDB",
        "POSTGRESQL" => "PostgreSQL",
        "SQLITE" => "SQLite",
        "SQLSERVER" => "SQL Server",
        "ORACLE" => "Oracle",
        "MONGODB" => "MongoDB",
        _ => return None,
    })
}
