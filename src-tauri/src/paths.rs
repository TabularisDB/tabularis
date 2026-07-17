use directories::ProjectDirs;
use std::path::{Path, PathBuf};

pub fn get_app_config_dir() -> PathBuf {
    if let Some(proj_dirs) = ProjectDirs::from("", "", "tabularis") {

        #[cfg(target_os = "windows")]
        {
            proj_dirs.config_dir().parent().unwrap().to_path_buf()
        }
        #[cfg(not(target_os = "windows"))]
        {
            proj_dirs.config_dir().to_path_buf()
        }
    } else {
        // Fallback for weird environments
        PathBuf::from(".config/tabularis")
    }
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
