use super::{destination, parse_manifest, read_manifest, KIND};
use crate::plugins::{install_cancellation::InstallCancellation, registry, tabularium};
use crate::runtime::RuntimeContext;
use sha2::{Digest, Sha256};
use std::io::Read;

const MAX_ARCHIVE: usize = 4 * 1024 * 1024;
const MAX_EXPANDED: u64 = 8 * 1024 * 1024;

pub async fn install(
    runtime: &RuntimeContext,
    id: &str,
    version: Option<&str>,
    base: &str,
    cancellation: &InstallCancellation,
) -> Result<(), String> {
    let final_dir = destination(&runtime.paths.plugins_dir(), id)?;
    let detail = tabularium::fetch_plugin_detail(base, id).await?;
    if detail.kind.as_deref() != Some(KIND) {
        return Err("Package is not an AI assistant".into());
    }
    let version = version.unwrap_or(&detail.latest_version);
    let platform = "universal".to_string();
    let asset = registry::resolve_tabularium_asset(base, id, version, &platform).await?;
    let download = tabularium::tracked_download_url(base, id, version, &platform);
    let client = crate::proxy::app_http_client()?;
    let mut response = tokio::select! {
        _ = cancellation.cancelled() => return Err(crate::plugins::install_cancellation::INSTALL_CANCELLED_ERROR.into()),
        response = client.get(&download).send() => response.map_err(|e| e.to_string())?,
    }.error_for_status().map_err(|e| e.to_string())?;
    if response
        .content_length()
        .is_some_and(|size| size > MAX_ARCHIVE as u64)
    {
        return Err("AI assistant archive exceeds byte limit".into());
    }
    let mut bytes = Vec::new();
    loop {
        let chunk = tokio::select! {
            _ = cancellation.cancelled() => return Err(crate::plugins::install_cancellation::INSTALL_CANCELLED_ERROR.into()),
            chunk = response.chunk() => chunk.map_err(|e| e.to_string())?,
        };
        let Some(chunk) = chunk else {
            break;
        };
        if bytes.len() + chunk.len() > MAX_ARCHIVE {
            return Err("AI assistant archive exceeds byte limit".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    if let Some(expected) = asset.expected_sha256 {
        if !format!("{:x}", Sha256::digest(&bytes)).eq_ignore_ascii_case(&expected) {
            return Err("AI assistant archive SHA-256 mismatch".into());
        }
    }
    cancellation.check()?;
    install_archive(&final_dir, id, version, &bytes, cancellation)?;
    super::notify_changed(runtime);
    Ok(())
}

pub(crate) fn install_archive(
    final_dir: &std::path::Path,
    id: &str,
    version: &str,
    bytes: &[u8],
    cancellation: &InstallCancellation,
) -> Result<(), String> {
    let parent = final_dir
        .parent()
        .ok_or("Invalid AI assistant install path")?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    if std::fs::symlink_metadata(parent)
        .map_err(|e| e.to_string())?
        .file_type()
        .is_symlink()
    {
        return Err("AI assistant package directory must not be a symlink".into());
    }
    let _lock = package_lock(parent, id)?;
    recover_package(parent, id)?;
    let staging = tempfile::tempdir_in(parent).map_err(|e| e.to_string())?;
    let mut archive =
        zip::ZipArchive::new(std::io::Cursor::new(bytes)).map_err(|e| e.to_string())?;
    if archive.len() > 256 {
        return Err("AI assistant archive exceeds file count limit".into());
    }
    let manifest = {
        let mut file = archive
            .by_name(".tabularium")
            .map_err(|_| "AI assistant archive has no manifest")?;
        let mut source = Vec::new();
        (&mut file)
            .take(64 * 1024 + 1)
            .read_to_end(&mut source)
            .map_err(|e| e.to_string())?;
        parse_manifest(&source)?
    };
    if manifest.id != id || manifest.version != version {
        return Err("AI assistant archive identity or version mismatch".into());
    }
    crate::plugins::runtime_version::enforce_min_runtime_version(
        id,
        manifest.min_runtime_version.as_deref(),
    )?;
    let mut total = 0;
    let mut seen = std::collections::HashSet::new();
    for index in 0..archive.len() {
        cancellation.check()?;
        let mut file = archive.by_index(index).map_err(|e| e.to_string())?;
        if file.is_dir() {
            continue;
        }
        if ![".tabularium", "README.md", "LICENSE", "LICENSE.txt"].contains(&file.name())
            || !seen.insert(file.name().to_string())
            || file
                .unix_mode()
                .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err("Unsafe or duplicate AI assistant archive path".into());
        }
        total += file.size();
        if total > MAX_EXPANDED {
            return Err("AI assistant archive exceeds expanded byte limit".into());
        }
        let output = staging.path().join(
            file.enclosed_name()
                .ok_or("Unsafe AI assistant archive path")?,
        );
        std::fs::create_dir_all(output.parent().ok_or("Invalid archive path")?)
            .map_err(|e| e.to_string())?;
        let mut buffer = Vec::new();
        (&mut file)
            .take(MAX_EXPANDED + 1)
            .read_to_end(&mut buffer)
            .map_err(|e| e.to_string())?;
        if buffer.len() as u64 > MAX_EXPANDED {
            return Err("AI assistant file exceeds byte limit".into());
        }
        std::fs::write(&output, buffer).map_err(|e| e.to_string())?;
    }
    cancellation.check()?;
    let backup = parent.join(format!(".backup-{id}"));
    if backup.exists() {
        return Err("A previous AI assistant update needs recovery".into());
    }
    let existed = final_dir.exists();
    if existed {
        std::fs::rename(final_dir, &backup).map_err(|e| e.to_string())?;
    }
    if let Err(error) = std::fs::rename(staging.path(), final_dir) {
        if existed {
            let _ = std::fs::rename(&backup, final_dir);
        }
        return Err(error.to_string());
    }
    if existed {
        std::fs::remove_dir_all(backup).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn uninstall(runtime: &RuntimeContext, id: &str) -> Result<(), String> {
    let directory = destination(&runtime.paths.plugins_dir(), id)?;
    let _lock = package_lock(directory.parent().ok_or("Invalid AI assistant path")?, id)?;
    read_manifest(&runtime.paths.plugins_dir(), id)?;
    std::fs::remove_dir_all(destination(&runtime.paths.plugins_dir(), id)?)
        .map_err(|e| e.to_string())?;
    super::notify_changed(runtime);
    Ok(())
}

fn package_lock(parent: &std::path::Path, id: &str) -> Result<std::fs::File, String> {
    use fs2::FileExt;
    let lock = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(parent.join(format!(".lock-{id}")))
        .map_err(|error| error.to_string())?;
    lock.try_lock_exclusive()
        .map_err(|_| "Another AI assistant package operation is running".to_string())?;
    Ok(lock)
}

fn recover_package(parent: &std::path::Path, id: &str) -> Result<(), String> {
    let backup = parent.join(format!(".backup-{id}"));
    if !backup.exists() {
        return Ok(());
    }
    let root = parent.parent().ok_or("Invalid AI assistant package root")?;
    let destination = destination(root, id)?;
    if std::fs::symlink_metadata(&backup)
        .map_err(|error| error.to_string())?
        .file_type()
        .is_symlink()
    {
        return Err("Invalid AI assistant backup".into());
    }
    if destination.exists() {
        read_manifest(root, id)?;
        std::fs::remove_dir_all(backup).map_err(|error| error.to_string())?;
    } else {
        let bytes = std::fs::read(backup.join(".tabularium")).map_err(|error| error.to_string())?;
        if parse_manifest(&bytes)?.id != id {
            return Err("AI assistant backup identity mismatch".into());
        }
        std::fs::rename(backup, destination).map_err(|error| error.to_string())?;
    }
    Ok(())
}

/// Finish or roll back a commit interrupted between the two directory renames.
pub fn recover_installations(root: &std::path::Path) {
    let parent = root.join(KIND);
    let Ok(entries) = std::fs::read_dir(&parent) else {
        return;
    };
    for entry in entries.filter_map(Result::ok) {
        let name = entry.file_name();
        let Some(id) = name.to_str().and_then(|name| name.strip_prefix(".backup-")) else {
            continue;
        };
        if destination(root, id).is_err() {
            continue;
        }
        let Ok(_lock) = package_lock(&parent, id) else {
            continue;
        };
        if let Err(error) = recover_package(&parent, id) {
            log::warn!("Could not recover AI provider {id}: {error}");
        }
    }
}
