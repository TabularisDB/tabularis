//! Beekeeper Studio importer. Reads the local workspace from Beekeeper's
//! `app.db` (SQLite) and decrypts password columns with the per-install key
//! stored in `.key`. Ported from TablePro's `BeekeeperStudioImporter.swift`.
//!
//! Only the personal workspace (`workspaceId = -1`) is imported; cloud-synced
//! rows have a positive id and their own source of truth.

use std::path::{Path, PathBuf};

use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::Row;

use super::types::{
    ImportEnvelope, ImportedConnection, ImportedCredentials, ImportedSsh, ImportedSsl,
};
use super::{crypto, driver_map, resolve_key_path, ForeignAppImporter, ForeignImportError};

pub struct BeekeeperImporter {
    data_dir: PathBuf,
}

impl Default for BeekeeperImporter {
    fn default() -> Self {
        Self {
            data_dir: default_data_dir(),
        }
    }
}

/// Beekeeper stores `app.db` under the Electron userData dir:
/// macOS `~/Library/Application Support/beekeeper-studio`, Linux
/// `~/.config/beekeeper-studio`, Windows `%APPDATA%/beekeeper-studio`.
fn default_data_dir() -> PathBuf {
    #[cfg(target_os = "macos")]
    {
        super::home_dir()
            .map(|h| h.join("Library/Application Support/beekeeper-studio"))
            .unwrap_or_default()
    }
    #[cfg(target_os = "linux")]
    {
        directories::BaseDirs::new()
            .map(|d| d.config_dir().join("beekeeper-studio"))
            .unwrap_or_default()
    }
    #[cfg(target_os = "windows")]
    {
        directories::BaseDirs::new()
            .map(|d| d.data_dir().join("beekeeper-studio"))
            .unwrap_or_default()
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        PathBuf::new()
    }
}

#[derive(sqlx::FromRow)]
struct SavedConnectionRow {
    name: Option<String>,
    #[sqlx(rename = "connectionType")]
    connection_type: Option<String>,
    host: Option<String>,
    port: Option<i64>,
    username: Option<String>,
    #[sqlx(rename = "defaultDatabase")]
    default_database: Option<String>,
    password: Option<String>,
    ssl: Option<i64>,
    #[sqlx(rename = "sslCaFile")]
    ssl_ca_file: Option<String>,
    #[sqlx(rename = "sslCertFile")]
    ssl_cert_file: Option<String>,
    #[sqlx(rename = "sslKeyFile")]
    ssl_key_file: Option<String>,
    #[sqlx(rename = "sslRejectUnauthorized")]
    ssl_reject_unauthorized: Option<i64>,
    #[sqlx(rename = "sshEnabled")]
    ssh_enabled: Option<i64>,
    #[sqlx(rename = "sshHost")]
    ssh_host: Option<String>,
    #[sqlx(rename = "sshPort")]
    ssh_port: Option<i64>,
    #[sqlx(rename = "sshUsername")]
    ssh_username: Option<String>,
    #[sqlx(rename = "sshMode")]
    ssh_mode: Option<String>,
    #[sqlx(rename = "sshKeyfile")]
    ssh_keyfile: Option<String>,
    #[sqlx(rename = "sshKeyfilePassword")]
    ssh_keyfile_password: Option<String>,
    #[sqlx(rename = "sshPassword")]
    ssh_password: Option<String>,
    #[sqlx(rename = "labelColor")]
    _label_color: Option<String>,
    #[sqlx(rename = "connectionFolderId")]
    connection_folder_id: Option<i64>,
}

const SELECT_CONNECTIONS: &str = "SELECT id, name, connectionType, host, port, username, \
    defaultDatabase, password, ssl, sslCaFile, sslCertFile, sslKeyFile, sslRejectUnauthorized, \
    sshEnabled, sshHost, sshPort, sshUsername, sshMode, sshKeyfile, sshKeyfilePassword, \
    sshPassword, labelColor, connectionFolderId \
    FROM saved_connection WHERE workspaceId = -1 ORDER BY id";

#[async_trait::async_trait]
impl ForeignAppImporter for BeekeeperImporter {
    fn id(&self) -> &'static str {
        "beekeeperstudio"
    }
    fn display_name(&self) -> &'static str {
        "Beekeeper Studio"
    }
    async fn is_available(&self) -> bool {
        self.app_db_path().is_file()
    }
    async fn connection_count(&self) -> usize {
        match self.read_rows().await {
            Ok(rows) => rows
                .iter()
                .filter(|r| map_driver(r.connection_type.as_deref()).is_some())
                .count(),
            Err(_) => 0,
        }
    }

    async fn import(
        &self,
        include_passwords: bool,
        _file: Option<&Path>,
    ) -> Result<ImportEnvelope, ForeignImportError> {
        if !self.app_db_path().is_file() {
            return Err(ForeignImportError::FileNotFound(self.display_name().to_string()));
        }
        let rows = self.read_rows().await?;
        let folder_map = self.read_folders().await.unwrap_or_default();
        let user_key = if include_passwords {
            self.load_user_encryption_key()
        } else {
            None
        };

        let mut envelope = ImportEnvelope {
            source_name: self.display_name().to_string(),
            ..Default::default()
        };
        let mut group_names: Vec<String> = Vec::new();

        for row in &rows {
            let driver_label = match map_driver(row.connection_type.as_deref()) {
                Some(d) => d,
                None => continue, // unsupported driver — skip, like TablePro
            };
            let group_name = row
                .connection_folder_id
                .and_then(|id| folder_map.get(&id).cloned());
            if let Some(g) = &group_name {
                if !group_names.contains(g) {
                    group_names.push(g.clone());
                }
            }

            let driver_id = driver_map::canonical_id(&driver_label);
            let port = row
                .port
                .and_then(|p| u16::try_from(p).ok())
                .unwrap_or_else(|| driver_map::default_port(&driver_id));

            let conn = ImportedConnection {
                name: non_empty(row.name.clone()).unwrap_or_else(|| "Untitled".to_string()),
                host: non_empty(row.host.clone()).unwrap_or_else(|| "localhost".to_string()),
                port,
                database: row.default_database.clone().unwrap_or_default(),
                username: row.username.clone().unwrap_or_default(),
                driver_label,
                ssh: build_ssh(row),
                ssl: build_ssl(row),
                group_name,
            };
            let index = envelope.connections.len();
            envelope.connections.push(conn);

            if let Some(key) = &user_key {
                let creds = extract_credentials(row, key);
                if !creds.is_empty() {
                    envelope.credentials_by_index.insert(index, creds);
                }
            }
        }

        if envelope.connections.is_empty() {
            return Err(ForeignImportError::NoConnectionsFound);
        }
        group_names.sort();
        envelope.group_names = group_names;
        Ok(envelope)
    }
}

impl BeekeeperImporter {
    #[cfg(test)]
    pub(crate) fn with_data_dir(data_dir: PathBuf) -> Self {
        Self { data_dir }
    }

    fn app_db_path(&self) -> PathBuf {
        self.data_dir.join("app.db")
    }
    fn key_file_path(&self) -> PathBuf {
        self.data_dir.join(".key")
    }

    /// Open `app.db` read-only/immutable so we never write a journal into
    /// another app's data directory.
    async fn open(&self) -> Result<sqlx::SqlitePool, ForeignImportError> {
        let opts = SqliteConnectOptions::new()
            .filename(self.app_db_path())
            .read_only(true)
            .immutable(true);
        SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(opts)
            .await
            .map_err(|e| ForeignImportError::ParseError(format!("Could not open app.db: {e}")))
    }

    async fn read_rows(&self) -> Result<Vec<SavedConnectionRow>, ForeignImportError> {
        let pool = self.open().await?;
        let rows = sqlx::query_as::<_, SavedConnectionRow>(SELECT_CONNECTIONS)
            .fetch_all(&pool)
            .await
            .map_err(|_| {
                ForeignImportError::UnsupportedFormat("saved_connection schema mismatch".into())
            })?;
        pool.close().await;
        Ok(rows)
    }

    async fn read_folders(&self) -> Result<std::collections::HashMap<i64, String>, ForeignImportError> {
        let pool = self.open().await?;
        let rows = sqlx::query("SELECT id, name FROM connection_folder")
            .fetch_all(&pool)
            .await
            .unwrap_or_default();
        pool.close().await;
        let mut map = std::collections::HashMap::new();
        for row in rows {
            let id: i64 = row.try_get("id").unwrap_or_default();
            let name: Option<String> = row.try_get("name").ok();
            if let Some(name) = name.filter(|n| !n.is_empty()) {
                map.insert(id, name);
            }
        }
        Ok(map)
    }

    /// Decrypt `.key` with the bootstrap key to recover the per-install
    /// encryption key used for password columns.
    fn load_user_encryption_key(&self) -> Option<String> {
        let payload = std::fs::read_to_string(self.key_file_path()).ok()?;
        crypto::decrypt_beekeeper_user_key(payload.trim())
    }
}

fn build_ssh(row: &SavedConnectionRow) -> Option<ImportedSsh> {
    if row.ssh_enabled.unwrap_or(0) == 0 {
        return None;
    }
    let auth_type = match row.ssh_mode.as_deref().map(str::to_ascii_lowercase).as_deref() {
        Some("keyfile") => "ssh_key",
        _ => "password",
    }
    .to_string();
    Some(ImportedSsh {
        host: row.ssh_host.clone().unwrap_or_default(),
        port: row.ssh_port.and_then(|p| u16::try_from(p).ok()),
        username: row.ssh_username.clone().unwrap_or_default(),
        private_key_path: row
            .ssh_keyfile
            .as_deref()
            .filter(|s| !s.is_empty())
            .map(resolve_key_path),
        auth_type,
    })
}

fn build_ssl(row: &SavedConnectionRow) -> Option<ImportedSsl> {
    if row.ssl.unwrap_or(0) == 0 {
        return None;
    }
    let mode = if row.ssl_reject_unauthorized.unwrap_or(0) != 0 {
        "verify-full"
    } else {
        "require"
    }
    .to_string();
    Some(ImportedSsl {
        mode,
        ca_certificate_path: non_empty(row.ssl_ca_file.clone()),
        client_certificate_path: non_empty(row.ssl_cert_file.clone()),
        client_key_path: non_empty(row.ssl_key_file.clone()),
    })
}

fn extract_credentials(row: &SavedConnectionRow, key: &str) -> ImportedCredentials {
    let dec = |v: &Option<String>| {
        v.as_deref()
            .filter(|s| !s.is_empty())
            .and_then(|s| crypto::decrypt_beekeeper_string(s, key))
    };
    ImportedCredentials {
        password: dec(&row.password),
        ssh_password: dec(&row.ssh_password),
        ssh_key_passphrase: dec(&row.ssh_keyfile_password),
    }
}

fn non_empty(v: Option<String>) -> Option<String> {
    v.filter(|s| !s.is_empty())
}

/// Maps Beekeeper's `ConnectionType` strings to the labels `driver_map` knows.
/// Unknown drivers return `None` and are skipped by the caller.
fn map_driver(raw: Option<&str>) -> Option<String> {
    let raw = raw?.to_ascii_lowercase();
    let label = match raw.as_str() {
        "mysql" => "MySQL",
        "mariadb" => "MariaDB",
        "postgresql" | "postgres" => "PostgreSQL",
        "redshift" => "Redshift",
        "cockroachdb" => "CockroachDB",
        "sqlite" => "SQLite",
        "sqlserver" => "SQL Server",
        "oracle" => "Oracle",
        "mongodb" | "mongo" => "MongoDB",
        "redis" => "Redis",
        "cassandra" => "Cassandra",
        "clickhouse" => "ClickHouse",
        "bigquery" => "BigQuery",
        "duckdb" => "DuckDB",
        "libsql" => "libSQL",
        _ => return None,
    };
    Some(label.to_string())
}
