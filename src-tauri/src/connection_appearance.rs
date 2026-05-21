use std::fs;
use std::path::Path;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

pub(crate) const MAX_ICON_BYTES: u64 = 512 * 1024;

#[derive(Debug)]
pub enum IconError {
    NotAFile,
    TooLarge,
    UnsupportedFormat,
    UnsafeSvg,
    InvalidConnectionId,
    Io(String),
}

impl std::fmt::Display for IconError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotAFile => write!(f, "source is not a regular file"),
            Self::TooLarge => write!(f, "image larger than 512 KB"),
            Self::UnsupportedFormat => write!(f, "unsupported image format"),
            Self::UnsafeSvg => write!(f, "svg contains script-like content"),
            Self::InvalidConnectionId => write!(f, "invalid connection id"),
            Self::Io(s) => write!(f, "io: {s}"),
        }
    }
}

fn sanitize_id(id: &str) -> Result<String, IconError> {
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err(IconError::InvalidConnectionId);
    }
    Ok(id.to_string())
}

fn sniff_ext(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G']) { return Some("png"); }
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) { return Some("jpg"); }
    if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" { return Some("webp"); }
    let head = std::str::from_utf8(&bytes[..bytes.len().min(512)]).unwrap_or("");
    if head.trim_start().starts_with("<?xml") || head.trim_start().starts_with("<svg") { return Some("svg"); }
    None
}

fn svg_is_safe(content: &str) -> bool {
    let lower = content.to_ascii_lowercase();
    if lower.contains("<script") { return false; }
    if lower.contains("javascript:") { return false; }
    // Detect any occurrence of `on<word>=` after whitespace, `<`, quotes, or `=`.
    let bytes = lower.as_bytes();
    let mut i = 0;
    while i + 3 < bytes.len() {
        let prev_ok = i == 0 || matches!(
            bytes[i - 1],
            b' ' | b'\t' | b'\n' | b'\r' | b'<' | b'"' | b'\'' | b'='
        );
        if prev_ok && bytes[i] == b'o' && bytes[i + 1] == b'n' && bytes[i + 2].is_ascii_alphabetic() {
            let mut j = i + 2;
            while j < bytes.len() && bytes[j].is_ascii_alphabetic() {
                j += 1;
            }
            // skip optional whitespace before '='
            while j < bytes.len() && matches!(bytes[j], b' ' | b'\t' | b'\n' | b'\r') {
                j += 1;
            }
            if j < bytes.len() && bytes[j] == b'=' {
                return false;
            }
        }
        i += 1;
    }
    true
}

/// Pure helper exposed for tests — does the validation + copy given an explicit dest dir.
pub fn save_icon_impl(dest_dir: &Path, connection_id: &str, source: &Path) -> Result<String, IconError> {
    let id = sanitize_id(connection_id)?;
    let meta = fs::metadata(source).map_err(|e| IconError::Io(e.to_string()))?;
    if !meta.is_file() { return Err(IconError::NotAFile); }
    if meta.len() > MAX_ICON_BYTES { return Err(IconError::TooLarge); }
    let bytes = fs::read(source).map_err(|e| IconError::Io(e.to_string()))?;
    let ext = sniff_ext(&bytes).ok_or(IconError::UnsupportedFormat)?;
    if ext == "svg" {
        let text = std::str::from_utf8(&bytes).map_err(|_| IconError::UnsupportedFormat)?;
        if !svg_is_safe(text) { return Err(IconError::UnsafeSvg); }
    }
    let hash = Sha256::digest(&bytes);
    let hash_hex: String = hash.iter().take(4).map(|b| format!("{b:02x}")).collect();
    fs::create_dir_all(dest_dir).map_err(|e| IconError::Io(e.to_string()))?;
    let filename = format!("{id}-{hash_hex}.{ext}");
    let dest = dest_dir.join(&filename);
    let tmp = dest.with_extension(format!("{ext}.tmp"));
    fs::write(&tmp, &bytes).map_err(|e| IconError::Io(e.to_string()))?;
    fs::rename(&tmp, &dest).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        IconError::Io(e.to_string())
    })?;
    Ok(format!("connection-icons/{filename}"))
}

/// Deletes the icon file from disk if the connection appearance points to an
/// `Image` variant. All other cases (no appearance, no icon, non-image icon)
/// are silently ignored. A missing file is also silently ignored so that
/// deleting a connection never fails just because its icon file vanished.
///
/// Rejects paths that escape `<app_data>/connection-icons/` to prevent
/// path-traversal attacks from crafted connections.json entries.
pub fn cascade_delete_if_image(
    app_data_dir: &Path,
    appearance: Option<&crate::models::ConnectionAppearance>,
) -> Result<(), IconError> {
    let Some(a) = appearance else { return Ok(()) };
    let Some(crate::models::IconOverride::Image { path }) = a.icon.as_ref() else { return Ok(()) };
    let icons_dir = app_data_dir.join("connection-icons");
    let full = app_data_dir.join(path);
    if !full.exists() {
        return Ok(()); // already gone, nothing to do
    }
    // Reject if not under <app_data>/connection-icons/
    let canon_icons = match icons_dir.canonicalize() {
        Ok(p) => p,
        Err(_) => return Ok(()), // icons dir doesn't exist, nothing to delete safely
    };
    let canon_full = match full.canonicalize() {
        Ok(p) => p,
        Err(e) => return Err(IconError::Io(e.to_string())),
    };
    if !canon_full.starts_with(&canon_icons) {
        // Path tries to escape the icons directory — refuse silently (don't propagate as error,
        // because that would prevent deleting the connection record itself; just don't delete the file).
        return Ok(());
    }
    fs::remove_file(&canon_full).map_err(|e| IconError::Io(e.to_string()))?;
    Ok(())
}

/// Copy an existing connection icon to a new file owned by `new_connection_id`.
/// Returns the new relative path (e.g. `connection-icons/newid-abcd.png`).
/// Validates the source path against the icons directory to prevent path traversal.
pub fn copy_icon_for_duplicate(
    app_data_dir: &Path,
    source_relative_path: &str,
    new_connection_id: &str,
) -> Result<String, IconError> {
    let id = sanitize_id(new_connection_id)?;
    let source = app_data_dir.join(source_relative_path);
    // Refuse to read outside the icons dir
    let icons_dir = app_data_dir.join("connection-icons");
    let canon_icons = icons_dir.canonicalize().map_err(|e| IconError::Io(e.to_string()))?;
    let canon_source = source.canonicalize().map_err(|e| IconError::Io(e.to_string()))?;
    if !canon_source.starts_with(&canon_icons) {
        return Err(IconError::InvalidConnectionId); // path is unsafe
    }
    let meta = fs::metadata(&canon_source).map_err(|e| IconError::Io(e.to_string()))?;
    if !meta.is_file() { return Err(IconError::NotAFile); }
    if meta.len() > MAX_ICON_BYTES { return Err(IconError::TooLarge); }
    let bytes = fs::read(&canon_source).map_err(|e| IconError::Io(e.to_string()))?;
    let ext = sniff_ext(&bytes).ok_or(IconError::UnsupportedFormat)?;
    // Skip SVG safety check here — the source already passed it when first uploaded.
    let hash = Sha256::digest(&bytes);
    let hash_hex: String = hash.iter().take(4).map(|b| format!("{b:02x}")).collect();
    let filename = format!("{id}-{hash_hex}.{ext}");
    let dest = icons_dir.join(&filename);
    let tmp = dest.with_extension(format!("{ext}.tmp"));
    fs::write(&tmp, &bytes).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        IconError::Io(e.to_string())
    })?;
    fs::rename(&tmp, &dest).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        IconError::Io(e.to_string())
    })?;
    Ok(format!("connection-icons/{filename}"))
}

#[tauri::command]
pub async fn save_connection_icon(
    app: AppHandle,
    connection_id: String,
    source_path: String,
) -> Result<String, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let dest = data_dir.join("connection-icons");
    save_icon_impl(&dest, &connection_id, Path::new(&source_path))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_connection_icon(
    app: AppHandle,
    relative_path: String,
) -> Result<(), String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let icons_dir = data_dir.join("connection-icons");
    let full = data_dir.join(&relative_path);
    // If the file doesn't exist, treat as a no-op (don't canonicalize a non-existent path).
    if !full.exists() {
        return Ok(());
    }
    let canon_icons = icons_dir.canonicalize().map_err(|e| e.to_string())?;
    let canon_full = full.canonicalize().map_err(|e| e.to_string())?;
    if !canon_full.starts_with(&canon_icons) {
        return Err("path outside connection-icons".into());
    }
    fs::remove_file(&canon_full).map_err(|e| e.to_string())?;
    Ok(())
}

