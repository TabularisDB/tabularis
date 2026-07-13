//! Import database connections from other installed SQL clients.
//!
//! Ported from TablePro's `ForeignApp` importers. Each [`ForeignAppImporter`]
//! reads a third-party client's on-disk config, decrypts any credentials and
//! returns a neutral [`ImportEnvelope`]. [`analyzer`] annotates the result
//! (duplicates / warnings) and [`convert`] turns it into Tabularis'
//! `ExportPayload`, which is merged through the existing import path.

use std::path::{Path, PathBuf};

pub mod analyzer;
pub mod convert;
pub mod crypto;
pub mod driver_map;
pub mod keychain_read;
pub mod types;

mod beekeeper;
mod dbeaver;
mod datagrip;
mod sequelace;
mod tableplus;

#[cfg(test)]
mod importer_tests;

pub use types::{ImportEnvelope, ImportedConnection, ImportedCredentials, ImportedSsh, ImportedSsl};

/// Errors surfaced while importing from a foreign app.
#[derive(Debug, Clone)]
pub enum ForeignImportError {
    FileNotFound(String),
    ParseError(String),
    UnsupportedFormat(String),
    NoConnectionsFound,
}

impl std::fmt::Display for ForeignImportError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ForeignImportError::FileNotFound(app) => {
                write!(f, "Could not find {} data files", app)
            }
            ForeignImportError::ParseError(detail) => {
                write!(f, "Failed to parse connections: {}", detail)
            }
            ForeignImportError::UnsupportedFormat(detail) => {
                write!(f, "Unsupported file format: {}", detail)
            }
            ForeignImportError::NoConnectionsFound => {
                write!(f, "No connections found to import")
            }
        }
    }
}

impl std::error::Error for ForeignImportError {}

/// One importable source app. Implementations are stateless: file locations are
/// computed from the user's home directory each call so tests can override the
/// home via [`home_dir`]-independent constructors where needed.
///
/// Async because some sources (Beekeeper Studio) read an external SQLite file
/// through `sqlx`; the file-based sources simply don't await.
#[async_trait::async_trait]
pub trait ForeignAppImporter: Send + Sync {
    /// Stable identifier used by the frontend (e.g. "dbeaver").
    fn id(&self) -> &'static str;
    /// Human-readable name shown in the picker (e.g. "DBeaver").
    fn display_name(&self) -> &'static str;
    /// True when reading passwords hits the macOS Keychain (per-item prompt).
    fn reads_passwords_from_keychain(&self) -> bool {
        false
    }
    /// File extensions to filter to when the importer reads a user-picked file
    /// instead of auto-discovering installed data. `None` = auto-discover.
    fn import_file_types(&self) -> Option<Vec<&'static str>> {
        None
    }
    /// True when the source app's data is present on disk.
    async fn is_available(&self) -> bool;
    /// Best-effort count of discoverable connections (0 on any error).
    async fn connection_count(&self) -> usize;
    /// Run the import. `file` is only set for file-sourced importers.
    async fn import(
        &self,
        include_passwords: bool,
        file: Option<&Path>,
    ) -> Result<ImportEnvelope, ForeignImportError>;
}

/// All known importers, in the order shown to the user.
pub fn all_importers() -> Vec<Box<dyn ForeignAppImporter>> {
    vec![
        Box::new(dbeaver::DBeaverImporter::default()),
        Box::new(beekeeper::BeekeeperImporter::default()),
        Box::new(tableplus::TablePlusImporter::default()),
        Box::new(datagrip::DataGripImporter::default()),
        Box::new(sequelace::SequelAceImporter::default()),
    ]
}

/// Look up a single importer by id.
pub fn importer_by_id(id: &str) -> Option<Box<dyn ForeignAppImporter>> {
    all_importers().into_iter().find(|i| i.id() == id)
}

// MARK: - Path helpers

/// The current user's home directory (`$HOME` / `%USERPROFILE%`).
pub fn home_dir() -> Option<PathBuf> {
    directories::BaseDirs::new().map(|d| d.home_dir().to_path_buf())
}

/// Expand a leading `~/` to the user's home directory.
pub fn expand_home(path: &str) -> String {
    if let Some(rest) = path.strip_prefix("~/") {
        if let Some(home) = home_dir() {
            return home.join(rest).to_string_lossy().to_string();
        }
    }
    path.to_string()
}

/// Resolve a private-key reference the way the foreign apps store them: an
/// absolute or `~/`-rooted path is kept as-is, a bare filename is assumed to
/// live under `~/.ssh/`.
pub fn resolve_key_path(path: &str) -> String {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    if trimmed.starts_with('/') || trimmed.starts_with("~/") {
        return trimmed.to_string();
    }
    format!("~/.ssh/{}", trimmed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_has_unique_ids() {
        let importers = all_importers();
        let mut ids: Vec<&str> = importers.iter().map(|i| i.id()).collect();
        ids.sort_unstable();
        let len = ids.len();
        ids.dedup();
        assert_eq!(ids.len(), len, "importer ids must be unique");
        assert!(importer_by_id("dbeaver").is_some());
    }

    #[test]
    fn resolve_key_path_rules() {
        assert_eq!(resolve_key_path("/abs/key"), "/abs/key");
        assert_eq!(resolve_key_path("~/keys/id"), "~/keys/id");
        assert_eq!(resolve_key_path("id_rsa"), "~/.ssh/id_rsa");
        assert_eq!(resolve_key_path(""), "");
    }
}
