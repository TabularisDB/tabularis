/// Maximum size in bytes for BLOB data to include as base64 preview.
/// All blobs are serialised as "BLOB:<size>:<mime_type>:<base64_data>".
/// For blobs larger than this threshold only the first N bytes are included;
/// smaller blobs are encoded in full.
pub const MAX_BLOB_PREVIEW_SIZE: usize = 4096;

/// Default maximum size in bytes for a BLOB file that can be uploaded/loaded into memory.
/// Files larger than this limit will be rejected to prevent memory exhaustion.
/// Default limit: 100MB (104,857,600 bytes)
/// Can be overridden via config.json with "maxBlobSize" field.
pub const DEFAULT_MAX_BLOB_SIZE: u64 = 100 * 1024 * 1024;

/// Encodes a blob byte slice into the canonical wire format used by all drivers.
/// Format: "BLOB:<total_size_bytes>:<mime_type>:<base64_data>"
pub fn encode_blob(data: &[u8]) -> String {
    let total_size = data.len();
    let preview = if total_size > MAX_BLOB_PREVIEW_SIZE {
        &data[..MAX_BLOB_PREVIEW_SIZE]
    } else {
        data
    };

    let mime_type = infer::get(preview)
        .map(|k| k.mime_type())
        .unwrap_or("application/octet-stream");

    let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, preview);

    format!("BLOB:{}:{}:{}", total_size, mime_type, b64)
}

/// Encodes a blob byte slice into the canonical wire format encoding ALL bytes.
/// Unlike `encode_blob` which truncates to MAX_BLOB_PREVIEW_SIZE for the read
/// path, this function preserves the complete data — used by upload / write paths
/// so that files larger than 4KB are not silently truncated.
pub fn encode_blob_full(data: &[u8]) -> String {
    let total_size = data.len();

    let mime_type = infer::get(data)
        .map(|k| k.mime_type())
        .unwrap_or("application/octet-stream");

    let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, data);

    format!("BLOB:{}:{}:{}", total_size, mime_type, b64)
}

/// Resolves a BLOB_FILE_REF to actual bytes by reading from disk.
/// Format: "BLOB_FILE_REF:<size>:<mime>:<filepath>"
/// Returns the raw file bytes, or an error if the file cannot be read.
/// Enforces max_size limit to prevent memory exhaustion.
pub fn resolve_blob_file_ref(value: &str, max_size: u64) -> Result<Vec<u8>, String> {
    let rest = value
        .strip_prefix("BLOB_FILE_REF:")
        .ok_or_else(|| "Not a BLOB_FILE_REF".to_string())?;

    // Parse: <size>:<mime>:<filepath>
    let parts: Vec<&str> = rest.splitn(3, ':').collect();
    if parts.len() != 3 {
        return Err("Invalid BLOB_FILE_REF format".to_string());
    }

    let size_str = parts[0];
    let file_path = parts[2];

    // Parse and validate file size
    let file_size: u64 = size_str
        .parse()
        .map_err(|_| "Invalid file size in BLOB_FILE_REF".to_string())?;

    if file_size > max_size {
        return Err(format!(
            "File size ({} bytes) exceeds maximum allowed size ({} bytes / {}MB). Please choose a smaller file.",
            file_size,
            max_size,
            max_size / (1024 * 1024)
        ));
    }

    // Read file from disk
    std::fs::read(file_path).map_err(|e| format!("Failed to read BLOB file: {}", e))
}

/// Decodes the canonical blob wire format back to raw bytes.
///
/// Expected format: "BLOB:<total_size_bytes>:<mime_type>:<base64_data>"
/// or "BLOB_FILE_REF:<size>:<mime>:<filepath>"
///
/// Returns `Some(Vec<u8>)` with the decoded bytes if the string matches the
/// wire format, or `None` if it is a plain string that should be stored as-is.
/// This is used by all write paths (update_record / insert_record) so that the
/// database always receives raw binary data instead of the internal wire format
/// string, ensuring interoperability with other SQL editors.
pub fn decode_blob_wire_format(value: &str, max_size: u64) -> Option<Vec<u8>> {
    // Handle BLOB_FILE_REF first
    if value.starts_with("BLOB_FILE_REF:") {
        return resolve_blob_file_ref(value, max_size).ok();
    }

    // Format: "BLOB:<digits>:<mime_type>:<base64_data>"
    // MIME type can contain letters, digits, dots, plus, hyphens, slashes
    let rest = value.strip_prefix("BLOB:")?;

    // Skip the size field
    let after_size = rest.splitn(2, ':').nth(1)?;

    // Skip the mime field — split only on the first colon after mime
    let base64_data = after_size.splitn(2, ':').nth(1)?;

    base64::Engine::decode(&base64::engine::general_purpose::STANDARD, base64_data).ok()
}
