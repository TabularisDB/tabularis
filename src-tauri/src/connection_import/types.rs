//! Neutral intermediate representation shared by every foreign-app importer.
//!
//! Each importer reads a third-party client's on-disk config and produces an
//! [`ImportEnvelope`]. The analyzer then annotates each connection and the
//! converter turns the envelope into Tabularis' own `ExportPayload`.

use serde::{Deserialize, Serialize};

/// A single connection extracted from a foreign app, in a driver-neutral shape.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportedConnection {
    pub name: String,
    pub host: String,
    pub port: u16,
    pub database: String,
    pub username: String,
    /// Human-readable database label as named by the source app
    /// (e.g. "PostgreSQL", "MySQL", "MariaDB"). Mapped to a Tabularis driver id
    /// by `driver_map`.
    pub driver_label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ssh: Option<ImportedSsh>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ssl: Option<ImportedSsl>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportedSsh {
    pub host: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
    pub username: String,
    /// "password" or "ssh_key" (mirrors `SshConnection::auth_type`).
    pub auth_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub private_key_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportedSsl {
    pub mode: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ca_certificate_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_certificate_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_key_path: Option<String>,
}

/// Secrets recovered for a connection (by its index in `connections`).
/// Kept entirely Rust-side; never serialized to the frontend.
#[derive(Debug, Clone, Default)]
pub struct ImportedCredentials {
    pub password: Option<String>,
    pub ssh_password: Option<String>,
    pub ssh_key_passphrase: Option<String>,
}

impl ImportedCredentials {
    pub fn is_empty(&self) -> bool {
        self.password.is_none()
            && self.ssh_password.is_none()
            && self.ssh_key_passphrase.is_none()
    }
}

/// The full result of importing from one source app.
#[derive(Debug, Clone, Default)]
pub struct ImportEnvelope {
    pub source_name: String,
    pub connections: Vec<ImportedConnection>,
    /// Map of connection index -> recovered secrets. Sparse: only present when
    /// credentials were requested and found.
    pub credentials_by_index: std::collections::HashMap<usize, ImportedCredentials>,
    pub group_names: Vec<String>,
    /// True when the user denied a Keychain prompt mid-import, so some
    /// passwords may be missing even though `include_passwords` was requested.
    pub credentials_aborted: bool,
}
