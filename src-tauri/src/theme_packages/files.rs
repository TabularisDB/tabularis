//! Host-owned file operations. Reads never create directories or recover state.
use fs2::FileExt;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::Path;

pub(super) fn check_path(path: &Path) -> Result<(), String> {
    for ancestor in path.ancestors() {
        match fs::symlink_metadata(ancestor) {
            Ok(meta) if meta.file_type().is_symlink() => {
                return Err("Theme paths must not contain symbolic links".into())
            }
            Ok(_) => (),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
            Err(error) => return Err(error.to_string()),
        }
    }
    Ok(())
}

pub(super) fn directory(path: &Path) -> Result<Vec<std::fs::DirEntry>, String> {
    check_path(path)?;
    match fs::read_dir(path) {
        Ok(entries) => {
            let mut entries = entries
                .take(4097)
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            if entries.len() > 4096 {
                return Err("Theme directory entry budget exceeded".into());
            }
            entries.sort_by_key(|e| e.file_name());
            Ok(entries)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(error) => Err(error.to_string()),
    }
}

pub(super) fn read_file(path: &Path, limit: usize) -> Result<String, String> {
    check_path(path)?;
    let before = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if !before.is_file() || before.len() > limit as u64 {
        return Err("Theme file is not regular or exceeds its byte limit".into());
    }
    let file = File::open(path).map_err(|e| e.to_string())?;
    let metadata = file.metadata().map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.len() > limit as u64 {
        return Err("Theme file is not regular or exceeds its byte limit".into());
    }
    let mut bytes = Vec::new();
    file.take(limit as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > limit {
        return Err("Theme file exceeds its byte limit".into());
    }
    String::from_utf8(bytes).map_err(|_| "Theme file must be UTF-8".into())
}

pub(super) fn read_budgeted_file(
    path: &Path,
    limit: usize,
    remaining: &mut usize,
) -> Result<String, String> {
    check_path(path)?;
    let metadata = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.len() > limit as u64 {
        return Err("Theme file exceeds its allowed shape or size".into());
    }
    let bytes = metadata.len() as usize;
    if bytes > *remaining {
        *remaining = 0;
        return Err(
            "Theme catalog read budget exhausted; remaining sources are unavailable, not deleted"
                .into(),
        );
    }
    *remaining -= bytes;
    // A file that grows after the reservation is rejected rather than reading
    // beyond the global budget. Failed parsing also consumes the reservation.
    read_file(path, bytes)
}

pub(super) fn create_directory(path: &Path) -> Result<(), String> {
    check_path(path)?;
    let mut options = fs::DirBuilder::new();
    options.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        options.mode(0o700);
    }
    options.create(path).map_err(|e| e.to_string())
}

pub(super) fn atomic_write(path: &Path, content: &[u8], overwrite: bool) -> Result<(), String> {
    check_path(path)?;
    let parent = path.parent().ok_or("Missing theme parent directory")?;
    create_directory(parent)?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    temporary
        .write_all(content)
        .and_then(|()| temporary.as_file().sync_all())
        .map_err(|e| e.to_string())?;
    if overwrite {
        temporary.persist(path).map_err(|e| e.to_string())?;
    } else {
        temporary
            .persist_noclobber(path)
            .map_err(|e| e.to_string())?;
    }
    #[cfg(unix)]
    File::open(parent)
        .and_then(|file| file.sync_all())
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub(super) fn write_lock(root: &Path) -> Result<File, String> {
    create_directory(root)?;
    let path = root.join(".theme-write.lock");
    check_path(&path)?;
    match fs::symlink_metadata(&path) {
        Ok(metadata) if !metadata.is_file() => return Err("Invalid personal theme lock".into()),
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => return Err(error.to_string()),
        _ => (),
    }
    let mut options = OpenOptions::new();
    options.read(true).write(true).create(true).truncate(false);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let file = options.open(path).map_err(|e| e.to_string())?;
    FileExt::try_lock_exclusive(&file)
        .map_err(|_| "Another theme operation is in progress".to_string())?;
    Ok(file)
}

pub(super) fn package_read_lock(namespace: &Path) -> Result<Option<File>, String> {
    let path = namespace.join(".lock");
    check_path(&path)?;
    match fs::symlink_metadata(&path) {
        // Manual bundles do not have an installer lock. Reads never create it.
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.to_string()),
        Ok(metadata) if metadata.is_file() => (),
        Ok(_) => return Err("Invalid theme storage lock".into()),
    }
    let file =
        File::open(path).map_err(|_| "Theme namespace has no installation lock".to_string())?;
    if !file.metadata().map_err(|e| e.to_string())?.is_file() {
        return Err("Invalid theme namespace lock".into());
    }
    FileExt::try_lock_shared(&file).map_err(|_| "Theme storage is being updated".to_string())?;
    Ok(Some(file))
}
