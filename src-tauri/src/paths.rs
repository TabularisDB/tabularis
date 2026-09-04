use directories::ProjectDirs;
use std::path::{Path, PathBuf};

fn project_dirs() -> Option<ProjectDirs> {
    ProjectDirs::from("", "", "tabularis")
}

/// On Windows the `directories` crate nests a `config`/`data` leaf under
/// `%APPDATA%\tabularis`; strip it so every kind of app data shares a single
/// `tabularis` folder. On other platforms the path is returned unchanged.
/// Pure on its inputs so it stays unit-testable on any host.
pub(crate) fn unnested_app_dir(dir: &Path, strip_leaf: bool) -> PathBuf {
    if strip_leaf {
        dir.parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| dir.to_path_buf())
    } else {
        dir.to_path_buf()
    }
}

/// Platform default for the configuration directory, ignoring any custom
/// storage location. This is where the storage-location pointer file lives,
/// so it must never be redirected itself.
pub fn get_default_app_config_dir() -> PathBuf {
    match project_dirs() {
        Some(proj_dirs) => unnested_app_dir(proj_dirs.config_dir(), cfg!(target_os = "windows")),
        // Fallback for weird environments
        None => PathBuf::from(".config/tabularis"),
    }
}

/// Platform default for the data directory, ignoring any custom storage
/// location. Installed plugins always live here: they are platform-specific
/// binaries and must not be synced across machines.
pub fn get_default_app_data_dir() -> PathBuf {
    match project_dirs() {
        Some(proj_dirs) => unnested_app_dir(proj_dirs.data_dir(), cfg!(target_os = "windows")),
        // Fallback for weird environments
        None => PathBuf::from(".local/share/tabularis"),
    }
}

/// Directory for app configuration (connections, settings, themes, saved
/// queries, notebooks, AI activity, ...).
///
/// When the user picked a custom storage location (see
/// [`crate::storage_location`]) this resolves to that folder instead of the
/// platform default. The override is resolved once per process, so a change
/// only takes effect after a restart.
pub fn get_app_config_dir() -> PathBuf {
    match crate::storage_location::active_override() {
        Some(custom) => custom.to_path_buf(),
        None => get_default_app_config_dir(),
    }
}

/// Directory for user data that belongs to the connections (custom connection
/// icons, ...). On Linux this resolves to `~/.local/share/tabularis`; on
/// macOS/Windows it shares the same `tabularis` folder used by
/// [`get_app_config_dir`]. A custom storage location redirects it too, so the
/// icons referenced by `connections.json` travel with the connections.
pub fn get_app_data_dir() -> PathBuf {
    match crate::storage_location::active_override() {
        Some(custom) => custom.to_path_buf(),
        None => get_default_app_data_dir(),
    }
}

/// Directory holding installed plugins. Never follows the custom storage
/// location: plugin binaries are per-platform and must stay local.
pub fn get_plugins_dir() -> PathBuf {
    get_default_app_data_dir().join("plugins")
}

/// Directory holding custom connection icons, relative to which
/// `connections.json` stores `connection-icons/<file>` paths.
pub fn get_connection_icons_dir() -> PathBuf {
    get_app_data_dir().join("connection-icons")
}

/// Resolve the connections file inside `config_dir`.
///
/// In dev builds (`debug_assertions`) a `connections.dev.json` takes
/// precedence when it exists, so development can run against a separate
/// set of connections without touching the real `connections.json`.
/// Release builds always use `connections.json`.
pub fn resolve_connections_path(config_dir: &Path) -> PathBuf {
    if cfg!(debug_assertions) {
        let dev = config_dir.join("connections.dev.json");
        if dev.exists() {
            return dev;
        }
    }
    config_dir.join("connections.json")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_connections_path_defaults_to_connections_json() {
        let dir = std::env::temp_dir().join("tabularis-paths-test-empty");
        let _ = std::fs::create_dir_all(&dir);
        assert_eq!(resolve_connections_path(&dir), dir.join("connections.json"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn resolve_connections_path_prefers_dev_file_in_debug_builds() {
        let dir = std::env::temp_dir().join("tabularis-paths-test-dev");
        let _ = std::fs::create_dir_all(&dir);
        std::fs::write(dir.join("connections.dev.json"), "{}").unwrap();

        let resolved = resolve_connections_path(&dir);
        if cfg!(debug_assertions) {
            assert_eq!(resolved, dir.join("connections.dev.json"));
        } else {
            assert_eq!(resolved, dir.join("connections.json"));
        }
        let _ = std::fs::remove_dir_all(&dir);
    }
}
