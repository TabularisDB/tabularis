//! Custom storage location.
//!
//! By default Tabularis keeps connections, settings, saved queries, themes,
//! notebooks and so on in the platform config directory (see
//! [`crate::paths`]). Users who want to sync that data across machines (e.g.
//! through iCloud Drive, Dropbox or a git repo) can point Tabularis at a
//! different folder instead.
//!
//! The chosen folder is recorded in a small pointer file,
//! `storage-location.json`, that always lives in the *default* config
//! directory, so the app can find it before anything else is loaded. The
//! `TABULARIS_DATA_DIR` environment variable takes precedence over the pointer
//! file, which is handy for portable installs and for development.
//!
//! The override is resolved once per process and cached: both the GUI and the
//! standalone MCP subprocess (`tabularis --mcp`) read the same pointer file, so
//! they always agree on where the data lives. Changing the location therefore
//! requires a restart, and the UI says so.
//!
//! Installed plugins deliberately do *not* follow the custom location — they
//! are platform-specific binaries. See [`crate::paths::get_plugins_dir`].

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// Name of the pointer file stored in the default config directory.
pub const POINTER_FILE: &str = "storage-location.json";

/// Environment variable that overrides both the pointer file and the default.
pub const ENV_VAR: &str = "TABULARIS_DATA_DIR";

/// Files/folders inside the config directory that are runtime state of the
/// local machine and must not be copied to a new storage location.
const COPY_EXCLUDED: &[&str] = &[
    POINTER_FILE,
    "plugins",
    "tabularis.alive",
    "pending_approvals",
    ".mcp_session_state.json",
];

/// Where the active override comes from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum StorageLocationSource {
    /// Platform default directory.
    Default,
    /// Folder chosen by the user through the settings UI (pointer file).
    Custom,
    /// `TABULARIS_DATA_DIR` environment variable.
    Env,
}

/// Snapshot returned to the frontend.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageLocationInfo {
    /// Folder the running process is actually using.
    pub current_path: String,
    /// Platform default folder.
    pub default_path: String,
    /// Folder recorded in the pointer file, if any.
    pub custom_path: Option<String>,
    /// Where `current_path` was resolved from.
    pub source: StorageLocationSource,
    /// True when the pointer file (or its absence) no longer matches the
    /// folder in use, i.e. the user changed the location and has not
    /// restarted yet.
    pub restart_required: bool,
}

/// What a candidate folder looks like before switching to it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageLocationInspection {
    /// The folder exists on disk.
    pub exists: bool,
    /// The folder exists and contains no entries at all.
    pub is_empty: bool,
    /// The folder already holds Tabularis data (`connections.json` or
    /// `config.json`), e.g. synced from another machine.
    pub has_tabularis_data: bool,
}

#[derive(Debug, Serialize, Deserialize)]
struct PointerFile {
    path: String,
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

static ACTIVE_OVERRIDE: OnceLock<Option<PathBuf>> = OnceLock::new();

/// Custom storage folder in effect for this process, if any. Resolved on the
/// first call and cached for the process lifetime.
pub fn active_override() -> Option<&'static Path> {
    ACTIVE_OVERRIDE
        .get_or_init(|| {
            resolve_override_in(
                &crate::paths::get_default_app_config_dir(),
                std::env::var_os(ENV_VAR).map(|v| v.to_string_lossy().into_owned()),
            )
        })
        .as_deref()
}

/// Source of the folder this process is using.
pub fn active_source() -> StorageLocationSource {
    if std::env::var_os(ENV_VAR).is_some_and(|v| !v.is_empty()) && active_override().is_some() {
        StorageLocationSource::Env
    } else if active_override().is_some() {
        StorageLocationSource::Custom
    } else {
        StorageLocationSource::Default
    }
}

/// Pure resolver: environment variable first, then the pointer file in
/// `default_config_dir`, otherwise `None` (use the platform default).
///
/// Empty or relative values are ignored so a misconfigured pointer can never
/// send the app to a path relative to the working directory.
pub fn resolve_override_in(
    default_config_dir: &Path,
    env_value: Option<String>,
) -> Option<PathBuf> {
    if let Some(from_env) = env_value.and_then(|v| normalize_candidate(&v)) {
        return Some(from_env);
    }
    read_pointer(default_config_dir)
}

fn normalize_candidate(raw: &str) -> Option<PathBuf> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    let path = PathBuf::from(trimmed);
    if !path.is_absolute() {
        return None;
    }
    Some(path)
}

// ---------------------------------------------------------------------------
// Pointer file
// ---------------------------------------------------------------------------

fn pointer_path(default_config_dir: &Path) -> PathBuf {
    default_config_dir.join(POINTER_FILE)
}

/// Read the custom folder recorded in the pointer file, if present and valid.
pub fn read_pointer(default_config_dir: &Path) -> Option<PathBuf> {
    let content = fs::read_to_string(pointer_path(default_config_dir)).ok()?;
    let pointer: PointerFile = serde_json::from_str(&content).ok()?;
    normalize_candidate(&pointer.path)
}

/// Persist `target` as the custom storage folder.
pub fn write_pointer(default_config_dir: &Path, target: &Path) -> Result<(), String> {
    fs::create_dir_all(default_config_dir)
        .map_err(|e| format!("Failed to create config directory: {e}"))?;
    let pointer = PointerFile {
        path: target.to_string_lossy().into_owned(),
    };
    let json = serde_json::to_string_pretty(&pointer).map_err(|e| e.to_string())?;
    fs::write(pointer_path(default_config_dir), json)
        .map_err(|e| format!("Failed to write {POINTER_FILE}: {e}"))
}

/// Remove the pointer file so the next launch uses the platform default.
pub fn clear_pointer(default_config_dir: &Path) -> Result<(), String> {
    match fs::remove_file(pointer_path(default_config_dir)) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("Failed to remove {POINTER_FILE}: {e}")),
    }
}

// ---------------------------------------------------------------------------
// Validation & inspection
// ---------------------------------------------------------------------------

/// Check that `target` can be used as a storage folder while `current` is in
/// use. Rejects relative paths, files, the current folder itself and any
/// nesting between the two (copying a folder into itself would recurse
/// forever and a parent folder would swallow the current data).
pub fn validate_target(target: &Path, current: &Path) -> Result<(), String> {
    if !target.is_absolute() {
        return Err("The storage folder must be an absolute path.".to_string());
    }
    if target.exists() && !target.is_dir() {
        return Err("The selected path is not a folder.".to_string());
    }
    let target_c = canonical_or_self(target);
    let current_c = canonical_or_self(current);
    if target_c == current_c {
        return Err("This folder is already the current storage location.".to_string());
    }
    if target_c.starts_with(&current_c) {
        return Err("The new folder cannot be inside the current storage folder.".to_string());
    }
    if current_c.starts_with(&target_c) {
        return Err("The new folder cannot contain the current storage folder.".to_string());
    }
    Ok(())
}

fn canonical_or_self(path: &Path) -> PathBuf {
    fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

/// Describe a candidate folder so the UI can decide whether to offer copying
/// the current data into it.
pub fn inspect(target: &Path) -> StorageLocationInspection {
    let exists = target.is_dir();
    let is_empty = exists
        && fs::read_dir(target)
            .map(|mut it| it.next().is_none())
            .unwrap_or(false);
    let has_tabularis_data = exists
        && (target.join("connections.json").is_file() || target.join("config.json").is_file());
    StorageLocationInspection {
        exists,
        is_empty,
        has_tabularis_data,
    }
}

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

/// True when a top-level entry of the config directory should be copied.
pub fn is_copyable_entry(name: &str) -> bool {
    !COPY_EXCLUDED.contains(&name)
}

/// Copy the user's data from `config_dir` (and the `connection-icons` folder
/// from `data_dir`, when it is a different directory) into `target`.
/// Existing files in `target` are never overwritten. Returns the number of
/// files copied.
pub fn copy_storage(config_dir: &Path, data_dir: &Path, target: &Path) -> Result<usize, String> {
    fs::create_dir_all(target)
        .map_err(|e| format!("Failed to create {}: {e}", target.display()))?;
    let mut copied = 0;

    if config_dir.is_dir() {
        for entry in fs::read_dir(config_dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let name = entry.file_name();
            if !is_copyable_entry(&name.to_string_lossy()) {
                continue;
            }
            copied += copy_recursive(&entry.path(), &target.join(&name))?;
        }
    }

    let icons = data_dir.join("connection-icons");
    if canonical_or_self(data_dir) != canonical_or_self(config_dir) && icons.is_dir() {
        copied += copy_recursive(&icons, &target.join("connection-icons"))?;
    }

    Ok(copied)
}

fn copy_recursive(from: &Path, to: &Path) -> Result<usize, String> {
    if from.is_dir() {
        fs::create_dir_all(to).map_err(|e| format!("Failed to create {}: {e}", to.display()))?;
        let mut copied = 0;
        for entry in fs::read_dir(from).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            copied += copy_recursive(&entry.path(), &to.join(entry.file_name()))?;
        }
        Ok(copied)
    } else if from.is_file() {
        if to.exists() {
            return Ok(0);
        }
        fs::copy(from, to).map_err(|e| format!("Failed to copy {}: {e}", from.display()))?;
        Ok(1)
    } else {
        // Symlinks to nothing, sockets, ...: skip silently.
        Ok(0)
    }
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

fn info() -> StorageLocationInfo {
    let default_dir = crate::paths::get_default_app_config_dir();
    let current = crate::paths::get_app_config_dir();
    let custom = read_pointer(&default_dir);
    let source = active_source();
    // With the env var in charge the pointer file is irrelevant, so a
    // restart could not change anything.
    let restart_required = source != StorageLocationSource::Env
        && custom.as_deref().map(canonical_or_self) != active_override().map(canonical_or_self);
    StorageLocationInfo {
        current_path: current.to_string_lossy().into_owned(),
        default_path: default_dir.to_string_lossy().into_owned(),
        custom_path: custom.map(|p| p.to_string_lossy().into_owned()),
        source,
        restart_required,
    }
}

#[tauri::command]
pub fn get_storage_location() -> StorageLocationInfo {
    info()
}

#[tauri::command]
pub fn inspect_storage_location(path: String) -> Result<StorageLocationInspection, String> {
    let target = PathBuf::from(path);
    validate_target(&target, &crate::paths::get_app_config_dir())?;
    Ok(inspect(&target))
}

/// Record `path` as the storage folder, optionally copying the current data
/// into it. Takes effect on the next launch.
#[tauri::command]
pub fn set_storage_location(path: String, copy_data: bool) -> Result<StorageLocationInfo, String> {
    let target = PathBuf::from(path);
    let current = crate::paths::get_app_config_dir();
    validate_target(&target, &current)?;
    fs::create_dir_all(&target)
        .map_err(|e| format!("Failed to create {}: {e}", target.display()))?;
    if copy_data {
        let copied = copy_storage(&current, &crate::paths::get_app_data_dir(), &target)?;
        log::info!(
            "[StorageLocation] Copied {} file(s) from {} to {}",
            copied,
            current.display(),
            target.display()
        );
    }
    write_pointer(&crate::paths::get_default_app_config_dir(), &target)?;
    log::info!(
        "[StorageLocation] Storage folder set to {}",
        target.display()
    );
    Ok(info())
}

/// Go back to the platform default folder on the next launch. Data in the
/// custom folder is left untouched.
#[tauri::command]
pub fn reset_storage_location() -> Result<StorageLocationInfo, String> {
    clear_pointer(&crate::paths::get_default_app_config_dir())?;
    log::info!("[StorageLocation] Storage folder reset to default");
    Ok(info())
}

/// Reveal the folder currently in use in the system file manager.
#[tauri::command]
pub fn open_storage_location(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let dir = crate::paths::get_app_config_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    app.opener()
        .open_path(dir.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| format!("Failed to open storage folder: {e}"))
}

/// Absolute data directory, for the frontend to build `asset://` URLs of
/// connection icons. Replaces `appDataDir()` from the Tauri JS API, which
/// knows nothing about the custom location.
#[tauri::command]
pub fn get_app_data_dir() -> String {
    crate::paths::get_app_data_dir()
        .to_string_lossy()
        .into_owned()
}
