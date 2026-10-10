use bytes::Bytes;
use chrono::{SecondsFormat, Utc};
use futures::{Stream, StreamExt};
use serde::{Deserialize, Serialize};
use std::fmt::Display;
use std::fs;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::task::{Context, Poll};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt, ReadBuf};
use uuid::Uuid;

pub const MAX_FILE_TRANSFER_BYTES: u64 = 512 * 1024 * 1024;
const DEFAULT_TRANSFER_TTL: Duration = Duration::from_secs(15 * 60);
const MAX_PENDING_TRANSFERS_PER_SESSION: usize = 64;
const CONTENT_FILE: &str = "content";
const MANIFEST_FILE: &str = "metadata.json";

#[derive(Clone, Debug)]
pub struct FileTransferStore {
    root: PathBuf,
    limits: TransferLimits,
}

#[derive(Clone, Debug)]
struct TransferLimits {
    max_bytes: u64,
    ttl: Duration,
    max_pending_per_session: usize,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileTransferMetadata {
    pub token: String,
    pub file_name: String,
    pub mime_type: String,
    pub size: u64,
    pub expires_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct TransferManifest {
    #[serde(flatten)]
    metadata: FileTransferMetadata,
    owner: Uuid,
    purpose: String,
    kind: TransferKind,
    expires_at_millis: u64,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
enum TransferKind {
    Upload,
    Download,
}

pub struct TransferReader {
    metadata: FileTransferMetadata,
    file: tokio::fs::File,
    cleanup_directory: Option<PathBuf>,
}

pub struct ClaimedUpload {
    metadata: FileTransferMetadata,
    content_path: PathBuf,
    cleanup_directory: Option<PathBuf>,
}

struct PendingDirectory {
    path: Option<PathBuf>,
}

impl FileTransferStore {
    pub fn new(data_dir: &Path) -> Self {
        Self {
            root: data_dir.join("web-file-transfers"),
            limits: TransferLimits {
                max_bytes: MAX_FILE_TRANSFER_BYTES,
                ttl: DEFAULT_TRANSFER_TTL,
                max_pending_per_session: MAX_PENDING_TRANSFERS_PER_SESSION,
            },
        }
    }

    #[cfg(test)]
    fn with_limits(data_dir: &Path, max_bytes: u64, ttl: Duration) -> Self {
        Self {
            root: data_dir.join("web-file-transfers"),
            limits: TransferLimits {
                max_bytes,
                ttl,
                max_pending_per_session: MAX_PENDING_TRANSFERS_PER_SESSION,
            },
        }
    }

    pub async fn store_upload<S, E>(
        &self,
        owner: Uuid,
        purpose: &str,
        file_name: &str,
        content_type: Option<&str>,
        stream: S,
    ) -> Result<FileTransferMetadata, String>
    where
        S: Stream<Item = Result<Bytes, E>>,
        E: Display,
    {
        self.store_stream(
            owner,
            purpose,
            file_name,
            content_type,
            TransferKind::Upload,
            stream,
        )
        .await
    }

    pub async fn store_download_bytes(
        &self,
        owner: Uuid,
        purpose: &str,
        file_name: &str,
        content_type: Option<&str>,
        bytes: Vec<u8>,
    ) -> Result<FileTransferMetadata, String> {
        self.store_download(
            owner,
            purpose,
            file_name,
            content_type,
            futures::stream::once(async move {
                Ok::<Bytes, std::convert::Infallible>(Bytes::from(bytes))
            }),
        )
        .await
    }

    pub async fn store_download<S, E>(
        &self,
        owner: Uuid,
        purpose: &str,
        file_name: &str,
        content_type: Option<&str>,
        stream: S,
    ) -> Result<FileTransferMetadata, String>
    where
        S: Stream<Item = Result<Bytes, E>>,
        E: Display,
    {
        self.store_stream(
            owner,
            purpose,
            file_name,
            content_type,
            TransferKind::Download,
            stream,
        )
        .await
    }

    pub async fn open_upload(
        &self,
        owner: Uuid,
        token: &str,
        purpose: &str,
    ) -> Result<TransferReader, String> {
        self.cleanup_expired()?;
        let directory = self.token_directory(owner, TransferKind::Upload, token)?;
        let manifest =
            self.read_manifest(&directory, owner, TransferKind::Upload, Some(purpose))?;
        let file = tokio::fs::File::open(directory.join(CONTENT_FILE))
            .await
            .map_err(|_| "File upload token is missing or expired".to_string())?;
        Ok(TransferReader {
            metadata: manifest.metadata,
            file,
            cleanup_directory: None,
        })
    }

    pub fn claim_upload(
        &self,
        owner: Uuid,
        token: &str,
        purpose: &str,
    ) -> Result<ClaimedUpload, String> {
        self.cleanup_expired()?;
        let directory = self.token_directory(owner, TransferKind::Upload, token)?;
        let manifest =
            self.read_manifest(&directory, owner, TransferKind::Upload, Some(purpose))?;
        let claimed = directory.with_file_name(format!(".claimed-{}", Uuid::new_v4()));
        fs::rename(&directory, &claimed)
            .map_err(|_| "File upload token is missing, expired, or already used".to_string())?;
        Ok(ClaimedUpload {
            metadata: manifest.metadata,
            content_path: claimed.join(CONTENT_FILE),
            cleanup_directory: Some(claimed),
        })
    }

    pub async fn consume_download(
        &self,
        owner: Uuid,
        token: &str,
    ) -> Result<TransferReader, String> {
        self.cleanup_expired()?;
        let directory = self.token_directory(owner, TransferKind::Download, token)?;
        let manifest = self.read_manifest(&directory, owner, TransferKind::Download, None)?;
        let claimed = directory.with_file_name(format!(".claimed-{}", Uuid::new_v4()));
        fs::rename(&directory, &claimed)
            .map_err(|_| "File download token is missing, expired, or already used".to_string())?;
        let file = match tokio::fs::File::open(claimed.join(CONTENT_FILE)).await {
            Ok(file) => file,
            Err(_) => {
                let _ = fs::remove_dir_all(&claimed);
                return Err("File download token is missing or expired".to_string());
            }
        };
        Ok(TransferReader {
            metadata: manifest.metadata,
            file,
            cleanup_directory: Some(claimed),
        })
    }

    pub fn cleanup_session(&self, owner: Uuid) {
        let _ = fs::remove_dir_all(self.root.join(owner.to_string()));
    }

    fn cleanup_expired(&self) -> Result<(), String> {
        let sessions = match fs::read_dir(&self.root) {
            Ok(sessions) => sessions,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error) => return Err(error.to_string()),
        };
        let now = unix_millis(SystemTime::now())?;
        for session in sessions {
            let session = session.map_err(|error| error.to_string())?;
            if !session
                .file_type()
                .map_err(|error| error.to_string())?
                .is_dir()
            {
                continue;
            }
            for kind in [TransferKind::Upload, TransferKind::Download] {
                let entries = match fs::read_dir(session.path().join(kind.directory())) {
                    Ok(entries) => entries,
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                    Err(error) => return Err(error.to_string()),
                };
                for entry in entries {
                    let entry = entry.map_err(|error| error.to_string())?;
                    if !entry
                        .file_type()
                        .map_err(|error| error.to_string())?
                        .is_dir()
                    {
                        continue;
                    }
                    let expires_at = fs::read(entry.path().join(MANIFEST_FILE))
                        .ok()
                        .and_then(|bytes| serde_json::from_slice::<TransferManifest>(&bytes).ok())
                        .map(|manifest| manifest.expires_at_millis)
                        .or_else(|| fallback_expiry(&entry.path(), self.limits.ttl));
                    if expires_at.is_some_and(|expires_at| expires_at <= now) {
                        let _ = fs::remove_dir_all(entry.path());
                    }
                }
            }
        }
        Ok(())
    }

    async fn store_stream<S, E>(
        &self,
        owner: Uuid,
        purpose: &str,
        file_name: &str,
        content_type: Option<&str>,
        kind: TransferKind,
        stream: S,
    ) -> Result<FileTransferMetadata, String>
    where
        S: Stream<Item = Result<Bytes, E>>,
        E: Display,
    {
        validate_purpose(purpose)?;
        self.cleanup_expired()?;
        let parent = self.root.join(owner.to_string()).join(kind.directory());
        create_private_directory(&parent)?;
        if pending_transfer_count(&parent)? >= self.limits.max_pending_per_session {
            return Err("Too many pending file transfers for this session".to_string());
        }

        let token = Uuid::new_v4().to_string();
        let pending_path = parent.join(format!(".pending-{}", Uuid::new_v4()));
        create_private_directory(&pending_path)?;
        let mut pending = PendingDirectory {
            path: Some(pending_path.clone()),
        };
        let content_path = pending_path.join(CONTENT_FILE);
        let mut file = create_private_file(&content_path).await?;
        let mut size = 0_u64;
        futures::pin_mut!(stream);
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|error| format!("File transfer interrupted: {error}"))?;
            size = size
                .checked_add(chunk.len() as u64)
                .ok_or_else(|| "File transfer size overflow".to_string())?;
            if size > self.limits.max_bytes {
                return Err(format!(
                    "File transfer exceeds the {} byte limit",
                    self.limits.max_bytes
                ));
            }
            file.write_all(&chunk)
                .await
                .map_err(|error| format!("Failed to store file transfer: {error}"))?;
        }
        file.flush()
            .await
            .map_err(|error| format!("Failed to store file transfer: {error}"))?;
        drop(file);

        let safe_name = safe_file_name(file_name);
        let mime_type = detected_content_type(&content_path)
            .await
            .unwrap_or_else(|| safe_content_type(content_type));
        let expires_at_time = SystemTime::now()
            .checked_add(self.limits.ttl)
            .ok_or_else(|| "Invalid file transfer expiration".to_string())?;
        let expires_at_millis = unix_millis(expires_at_time)?;
        let expires_at = chrono::DateTime::<Utc>::from(expires_at_time)
            .to_rfc3339_opts(SecondsFormat::Secs, true);
        let metadata = FileTransferMetadata {
            token: token.clone(),
            file_name: safe_name,
            mime_type,
            size,
            expires_at,
        };
        let manifest = TransferManifest {
            metadata: metadata.clone(),
            owner,
            purpose: purpose.to_string(),
            kind,
            expires_at_millis,
        };
        let manifest_bytes = serde_json::to_vec(&manifest).map_err(|error| error.to_string())?;
        write_private_bytes(&pending_path.join(MANIFEST_FILE), &manifest_bytes).await?;
        let final_path = parent.join(&token);
        fs::rename(&pending_path, &final_path)
            .map_err(|error| format!("Failed to finalize file transfer: {error}"))?;
        pending.path = None;
        Ok(metadata)
    }

    fn token_directory(
        &self,
        owner: Uuid,
        kind: TransferKind,
        token: &str,
    ) -> Result<PathBuf, String> {
        validate_token(token)?;
        Ok(self
            .root
            .join(owner.to_string())
            .join(kind.directory())
            .join(token))
    }

    fn read_manifest(
        &self,
        directory: &Path,
        owner: Uuid,
        kind: TransferKind,
        purpose: Option<&str>,
    ) -> Result<TransferManifest, String> {
        let bytes = fs::read(directory.join(MANIFEST_FILE))
            .map_err(|_| "File transfer token is missing or expired".to_string())?;
        let manifest = serde_json::from_slice::<TransferManifest>(&bytes)
            .map_err(|_| "File transfer token is invalid".to_string())?;
        let now = unix_millis(SystemTime::now())?;
        if manifest.owner != owner
            || manifest.kind != kind
            || manifest.expires_at_millis <= now
            || purpose.is_some_and(|purpose| manifest.purpose != purpose)
        {
            return Err("File transfer token is missing or expired".to_string());
        }
        Ok(manifest)
    }
}

impl TransferKind {
    fn directory(self) -> &'static str {
        match self {
            Self::Upload => "uploads",
            Self::Download => "downloads",
        }
    }
}

impl TransferReader {
    pub fn metadata(&self) -> &FileTransferMetadata {
        &self.metadata
    }
}

impl AsyncRead for TransferReader {
    fn poll_read(
        mut self: Pin<&mut Self>,
        context: &mut Context<'_>,
        buffer: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.file).poll_read(context, buffer)
    }
}

impl Drop for TransferReader {
    fn drop(&mut self) {
        if let Some(directory) = self.cleanup_directory.take() {
            let _ = fs::remove_dir_all(directory);
        }
    }
}

impl ClaimedUpload {
    pub fn metadata(&self) -> &FileTransferMetadata {
        &self.metadata
    }

    pub fn path(&self) -> &Path {
        &self.content_path
    }
}

impl Drop for ClaimedUpload {
    fn drop(&mut self) {
        if let Some(directory) = self.cleanup_directory.take() {
            let _ = fs::remove_dir_all(directory);
        }
    }
}

impl Drop for PendingDirectory {
    fn drop(&mut self) {
        if let Some(path) = self.path.take() {
            let _ = fs::remove_dir_all(path);
        }
    }
}

fn validate_token(token: &str) -> Result<(), String> {
    match Uuid::parse_str(token) {
        Ok(parsed) if parsed.get_version_num() == 4 => Ok(()),
        _ => Err("Invalid file transfer token".to_string()),
    }
}

fn validate_purpose(purpose: &str) -> Result<(), String> {
    if purpose.is_empty()
        || purpose.len() > 64
        || !purpose
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
    {
        return Err("Invalid file transfer purpose".to_string());
    }
    Ok(())
}

pub fn safe_file_name(file_name: &str) -> String {
    let normalized = file_name.replace('\\', "/");
    let base = normalized
        .split('/')
        .filter(|part| !part.is_empty())
        .next_back()
        .unwrap_or("download.bin");
    let mut safe = String::with_capacity(base.len().min(128));
    for character in base.chars() {
        if safe.len() >= 128 {
            break;
        }
        if character.is_ascii_alphanumeric()
            || matches!(character, '.' | '-' | '_' | ' ' | '(' | ')')
        {
            safe.push(character);
        } else {
            safe.push('_');
        }
    }
    let safe = safe.trim().trim_matches('.');
    if safe.is_empty() || matches!(safe, "." | "..") {
        "download.bin".to_string()
    } else {
        safe.to_string()
    }
}

async fn detected_content_type(path: &Path) -> Option<String> {
    let mut file = tokio::fs::File::open(path).await.ok()?;
    let mut header = vec![0_u8; 8192];
    let read = file.read(&mut header).await.ok()?;
    header.truncate(read);
    infer::get(&header).map(|kind| kind.mime_type().to_string())
}

pub fn safe_content_type(content_type: Option<&str>) -> String {
    let Some(content_type) = content_type else {
        return "application/octet-stream".to_string();
    };
    let content_type = content_type
        .split(';')
        .next()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    let Some((kind, subtype)) = content_type.split_once('/') else {
        return "application/octet-stream".to_string();
    };
    if kind.is_empty()
        || subtype.is_empty()
        || content_type.len() > 127
        || !kind.bytes().all(content_type_byte_is_safe)
        || !subtype.bytes().all(content_type_byte_is_safe)
    {
        return "application/octet-stream".to_string();
    }
    content_type
}

fn content_type_byte_is_safe(byte: u8) -> bool {
    byte.is_ascii_alphanumeric()
        || matches!(
            byte,
            b'!' | b'#' | b'$' | b'&' | b'^' | b'_' | b'.' | b'+' | b'-'
        )
}

async fn create_private_file(path: &Path) -> Result<tokio::fs::File, String> {
    let mut options = tokio::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    options.mode(0o600);
    options.open(path).await.map_err(|error| error.to_string())
}

async fn write_private_bytes(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut file = create_private_file(path).await?;
    file.write_all(bytes)
        .await
        .map_err(|error| error.to_string())?;
    file.flush().await.map_err(|error| error.to_string())
}

fn create_private_directory(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|error| error.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn pending_transfer_count(parent: &Path) -> Result<usize, String> {
    fs::read_dir(parent)
        .map_err(|error| error.to_string())?
        .try_fold(0_usize, |count, entry| {
            let entry = entry.map_err(|error| error.to_string())?;
            Ok(count
                + usize::from(
                    entry
                        .file_type()
                        .map_err(|error| error.to_string())?
                        .is_dir(),
                ))
        })
}

fn fallback_expiry(path: &Path, ttl: Duration) -> Option<u64> {
    let modified = fs::metadata(path).ok()?.modified().ok()?;
    unix_millis(modified.checked_add(ttl)?).ok()
}

fn unix_millis(time: SystemTime) -> Result<u64, String> {
    let millis = time
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "Invalid file transfer timestamp".to_string())?
        .as_millis();
    u64::try_from(millis).map_err(|_| "Invalid file transfer timestamp".to_string())
}

#[cfg(test)]
#[path = "file_transfers_tests.rs"]
mod tests;
