use super::archive::ValidatedThemePackage;
use super::json::parse_bounded_json;
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;
use uuid::Uuid;

#[derive(Debug, Serialize)]
pub struct ThemeCommit {
    /// A committed operation remains successful if deferred cleanup needs retry.
    pub warnings: Vec<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Journal {
    version: u8,
    package: String,
}

struct Staging(PathBuf);
impl Drop for Staging {
    fn drop(&mut self) {
        if let Err(error) = fs::remove_dir_all(&self.0) {
            if error.kind() != std::io::ErrorKind::NotFound {
                log::warn!("Failed to remove disposable theme staging: {}", error);
            }
        }
    }
}

fn existing_directory(path: &Path) -> Result<bool, String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => Ok(true),
        Ok(_) => Err("Theme storage path must be a real directory".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error.to_string()),
    }
}

fn create_directory(path: &Path) -> Result<(), String> {
    if existing_directory(path)? {
        return Ok(());
    }
    let mut builder = fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(path).map_err(|error| error.to_string())
}

fn namespace(root: &Path, registry_key: &str) -> Result<PathBuf, String> {
    if registry_key.len() != 64
        || !registry_key
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
    {
        return Err("Invalid host-issued theme registry identity".into());
    }
    super::files::check_path(root)?;
    Ok(root.join(super::locations::directory_name()))
}

fn storage_lock(
    folder: &Path,
    check_cancelled: &impl Fn() -> Result<(), String>,
) -> Result<File, String> {
    let path = folder.join(".lock");
    match fs::symlink_metadata(&path) {
        Ok(metadata) if metadata.is_file() && !metadata.file_type().is_symlink() => (),
        Ok(_) => return Err("Invalid theme storage lock file".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
        Err(error) => return Err(error.to_string()),
    }
    let mut options = OpenOptions::new();
    options.read(true).write(true).create(true).truncate(false);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let file = options.open(path).map_err(|error| error.to_string())?;
    loop {
        check_cancelled()?;
        match FileExt::try_lock_exclusive(&file) {
            Ok(()) => return Ok(file),
            Err(error) if error.raw_os_error() == fs2::lock_contended_error().raw_os_error() => {
                std::thread::sleep(Duration::from_millis(10))
            }
            Err(error) => return Err(error.to_string()),
        }
    }
}

fn write_new(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path).map_err(|error| error.to_string())?;
    let result = file.write_all(bytes).and_then(|()| file.sync_all());
    drop(file);
    if let Err(error) = result {
        // This path was exclusively created by this call. Never retain a
        // partially written journal when cleanup is still possible.
        if let Err(cleanup) = fs::remove_file(path) {
            return Err(format!(
                "Theme write failed: {}; cleanup failed: {}",
                error, cleanup
            ));
        }
        return Err(error.to_string());
    }
    Ok(())
}

fn sync_directory(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        File::open(path)
            .and_then(|file| file.sync_all())
            .map_err(|error| error.to_string())?;
    }
    #[cfg(not(unix))]
    {
        let _ = path;
    }
    Ok(())
}

fn journal_id(name: &str, prefix: &str, suffix: &str) -> Option<Uuid> {
    let raw = name.strip_prefix(prefix)?.strip_suffix(suffix)?;
    let id = Uuid::parse_str(raw).ok()?;
    (id.to_string() == raw).then_some(id)
}

fn recover_locked(folder: &Path) -> Result<(), String> {
    let mut entries: Vec<_> = fs::read_dir(folder)
        .map_err(|error| error.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|error| error.to_string())?;
    entries.sort_by_key(|entry| entry.file_name());
    for entry in &entries {
        let name = entry.file_name().to_string_lossy().into_owned();
        let Some(id) = journal_id(&name, ".transaction-", ".json") else {
            continue;
        };
        let metadata = fs::symlink_metadata(entry.path()).map_err(|error| error.to_string())?;
        if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > 1024 {
            return Err("Invalid theme transaction journal".into());
        }
        let mut bytes = Vec::new();
        File::open(entry.path())
            .map_err(|error| error.to_string())?
            .take(1025)
            .read_to_end(&mut bytes)
            .map_err(|error| error.to_string())?;
        let journal: Journal = serde_json::from_value(parse_bounded_json(&bytes, 1024, 4, 16)?)
            .map_err(|error| error.to_string())?;
        if journal.version != 1 || !super::is_package_slug(&journal.package) {
            return Err("Invalid theme transaction ownership".into());
        }
        let destination = folder.join(&journal.package);
        let backup = folder.join(format!(".backup-{}", id));
        let staging = folder.join(format!(".staging-{}", id));
        let destination_exists = existing_directory(&destination)?;
        let backup_exists = existing_directory(&backup)?;
        let staging_exists = existing_directory(&staging)?;
        if !destination_exists && backup_exists {
            fs::rename(&backup, &destination).map_err(|error| error.to_string())?;
        } else if backup_exists {
            fs::remove_dir_all(&backup).map_err(|error| error.to_string())?;
        }
        if staging_exists {
            fs::remove_dir_all(&staging).map_err(|error| error.to_string())?;
        }
        fs::remove_file(entry.path()).map_err(|error| error.to_string())?;
        sync_directory(folder)?;
    }
    // Staging can precede journal creation. The namespace lock excludes active
    // installers, including other processes, while abandoned staging is removed.
    for entry in entries {
        let name = entry.file_name().to_string_lossy().into_owned();
        if journal_id(&name, ".staging-", "").is_some() && existing_directory(&entry.path())? {
            fs::remove_dir_all(entry.path()).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

/// Explicit startup/write recovery, NOT a side effect of catalog reads.
pub fn recover_theme_transactions(root: &Path, registry_key: &str) -> Result<(), String> {
    let folder = namespace(root, registry_key)?;
    if !existing_directory(root)? || !existing_directory(&folder)? {
        return Ok(());
    }
    let _lock = storage_lock(&folder, &|| Ok(()))?;
    recover_locked(&folder)
}

/// The root is host-owned theme-package storage, never a user command argument.
/// Cancellation stops before the commit point; no preferences are written here.
pub fn install_validated_theme(
    root: &Path,
    registry_key: &str,
    package: &ValidatedThemePackage,
    check_cancelled: &impl Fn() -> Result<(), String>,
) -> Result<ThemeCommit, String> {
    install_with_rename(root, registry_key, package, check_cancelled, &|from, to| {
        fs::rename(from, to)
    })
}

pub(super) fn install_with_rename(
    root: &Path,
    registry_key: &str,
    package: &ValidatedThemePackage,
    check_cancelled: &impl Fn() -> Result<(), String>,
    rename: &impl Fn(&Path, &Path) -> std::io::Result<()>,
) -> Result<ThemeCommit, String> {
    check_cancelled()?;
    let folder = namespace(root, registry_key)?;
    let name = super::package_id(&package.manifest)
        .map_err(|_| "Invalid theme package identity".to_string())?;
    create_directory(root)?;
    create_directory(&folder)?;
    let _lock = storage_lock(&folder, check_cancelled)?;
    recover_locked(&folder)?;
    let destination = folder.join(name);
    let replacing = existing_directory(&destination)?;
    let id = Uuid::new_v4();
    let stage_path = folder.join(format!(".staging-{}", id));
    // Exclusive creation: never clean up a path that this operation did not own.
    fs::create_dir(&stage_path).map_err(|error| error.to_string())?;
    let staging = Staging(stage_path);
    for (relative, bytes) in &package.files {
        check_cancelled()?;
        let path = staging.0.join(relative);
        create_directory(path.parent().ok_or("Missing theme file parent")?)?;
        write_new(&path, bytes)?;
    }
    // Provenance is host-owned metadata, never accepted from an archive.
    write_new(&staging.0.join(super::locations::ORIGIN_FILE), registry_key.as_bytes())?;
    sync_directory(&staging.0)?;
    check_cancelled()?;
    let marker = folder.join(format!(".transaction-{}.json", id));
    let backup = folder.join(format!(".backup-{}", id));
    let journal = serde_json::to_vec(&Journal {
        version: 1,
        package: name.into(),
    })
    .map_err(|error| error.to_string())?;
    write_new(&marker, &journal)?;
    sync_directory(&folder)?;
    if let Err(error) = check_cancelled() {
        fs::remove_file(&marker)
            .map_err(|cleanup| format!("{}; journal cleanup failed: {}", error, cleanup))?;
        return Err(error);
    }
    // Commit critical section: a late cancellation must not turn an already
    // committed operation into an error or suppress its refresh event.
    if replacing {
        if let Err(error) = rename(&destination, &backup) {
            let _ = fs::remove_file(&marker);
            return Err(error.to_string());
        }
    }
    if let Err(error) = rename(&staging.0, &destination) {
        if replacing {
            if let Err(rollback) = rename(&backup, &destination) {
                return Err(format!(
                    "Theme replacement failed: {}; recovery retained for retry: {}",
                    error, rollback
                ));
            }
        }
        let _ = fs::remove_file(&marker);
        return Err(format!(
            "Theme replacement failed; previous installation preserved: {}",
            error
        ));
    }
    let mut warnings = Vec::new();
    if let Err(error) = sync_directory(&folder) {
        warnings.push(error);
    }
    let cleanup = (|| -> Result<(), String> {
        if replacing {
            fs::remove_dir_all(&backup).map_err(|error| error.to_string())?;
        }
        fs::remove_file(&marker).map_err(|error| error.to_string())?;
        sync_directory(&folder)
    })();
    if let Err(error) = cleanup {
        warnings.push(format!("Committed theme cleanup pending: {}", error));
    }
    // A successful update migrates flat themes into the kind directory. Never
    // retire a driver with the same name, or touch fallback data on failure.
    let fallback = root.join(name);
    if !crate::plugins::layout::is_kind_directory(name) {
        let cleanup = (|| -> Result<(), String> {
            let old_marker = root.join(format!(".disabled-{name}"));
            let marker = folder.join(format!(".disabled-{name}"));
            if old_marker.try_exists().map_err(|e| e.to_string())?
                && !marker.try_exists().map_err(|e| e.to_string())?
            {
                let value = super::files::read_file(&old_marker, 1)?;
                if value != "1" { return Err("Invalid disabled theme marker".into()); }
                super::files::atomic_write(&marker, b"1", false)?;
            }
            if super::locations::is_theme_package(&fallback).unwrap_or(false) {
                fs::remove_dir_all(&fallback).map_err(|e| e.to_string())?;
            }
            if old_marker.try_exists().map_err(|e| e.to_string())? {
                fs::remove_file(old_marker).map_err(|e| e.to_string())?;
            }
            Ok(())
        })();
        if let Err(error) = cleanup {
            warnings.push(format!("Installed theme; fallback cleanup pending: {error}"));
        }
    }
    Ok(ThemeCommit { warnings })
}
