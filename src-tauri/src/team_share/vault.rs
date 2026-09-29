//! On-disk format of the team vault and the primitives that read and write it.
//!
//! The vault is a single JSON file on a shared folder. Its header is plain
//! text — format marker, revision counter, KDF parameters and a verifier — so
//! any team member can tell whether their master password is the right one
//! before anything is decrypted. Everything that matters (connection
//! parameters, credentials, groups, tags) lives in `payload`, encrypted with
//! AES-256-GCM under a key derived from the master password with Argon2id.
//!
//! The salt is generated once, when the vault is created, and stays in the
//! header: every member must derive the *same* key from the same password.
//!
//! No file handle is ever kept open. A read opens the file, slurps it and
//! closes it; a write goes to a sibling temp file that is renamed over the
//! target while a lock file is held, and the lock is released immediately
//! afterwards. Nothing in this module holds a handle across an await point or
//! across a user interaction.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use crate::export_crypto::{self, Sealed};
use crate::models::{
    ConnectionAppearance, ConnectionGroup, ConnectionParams, ConnectionTag, IconOverride,
    K8sConnection, SshConnection,
};

/// Marker written into every vault file.
pub const VAULT_FORMAT: &str = "tabularis-team-vault";
/// Format revision of the file layout itself (not the content revision).
pub const VAULT_VERSION: u32 = 1;
/// Default file name created inside a folder the user picks.
pub const DEFAULT_VAULT_FILENAME: &str = "tabularis-team-vault.json";

/// Plaintext sealed under the master key so a wrong password is reported as
/// such instead of surfacing as a corrupted payload.
const VERIFIER_PLAINTEXT: &str = "tabularis-team-vault-verifier";

/// A lock file older than this is considered abandoned (the process that
/// wrote it crashed or lost the network) and is broken.
const LOCK_STALE_AFTER: Duration = Duration::from_secs(30);
/// How many times acquiring the lock is retried before giving up.
const LOCK_ATTEMPTS: u32 = 40;
/// Pause between two lock attempts.
const LOCK_RETRY_DELAY: Duration = Duration::from_millis(250);

/// Argon2id parameters recorded in the header, so a future release can raise
/// them without locking older vaults out.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct KdfParams {
    /// Base64 salt, fixed for the life of the vault.
    pub salt: String,
    pub m_cost: u32,
    pub t_cost: u32,
    pub p_cost: u32,
}

impl Default for KdfParams {
    fn default() -> Self {
        Self {
            salt: base64_encode(&export_crypto::random_salt()),
            m_cost: export_crypto::ARGON2_M_COST,
            t_cost: export_crypto::ARGON2_T_COST,
            p_cost: export_crypto::ARGON2_P_COST,
        }
    }
}

/// The file as it sits on the share.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultFile {
    pub format: String,
    pub version: u32,
    /// Bumped on every write. Used to detect that somebody else wrote between
    /// our read and our write.
    pub revision: u64,
    pub updated_at: String,
    pub updated_by: String,
    pub kdf: KdfParams,
    pub verifier: Sealed,
    pub payload: Sealed,
}

/// Decrypted content of the vault.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VaultPayload {
    #[serde(default)]
    pub entries: Vec<VaultEntry>,
    #[serde(default)]
    pub groups: Vec<VaultGroup>,
    #[serde(default)]
    pub tags: Vec<VaultTag>,
    /// SSH profiles the shared connections tunnel through. Without these a
    /// teammate would receive a connection pointing at a profile they do not
    /// have, and the tunnel could not be opened.
    #[serde(default)]
    pub ssh_profiles: Vec<VaultSshProfile>,
    /// Kubernetes tunnels the shared connections route through, for the same
    /// reason. These carry no credentials, only reachability settings.
    #[serde(default)]
    pub k8s_profiles: Vec<VaultK8sProfile>,
}

/// One shared connection, credentials included.
///
/// `id` is the same uuid the connection has in the members' local
/// `connections.json`, which is what makes the merge a simple keyed join.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VaultEntry {
    pub id: String,
    pub name: String,
    /// Full connection parameters, including `password`, `sshPassword`,
    /// `sshKeyPassphrase` and `connectionUri` when the owner had them.
    pub params: ConnectionParams,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tag_ids: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub environment: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detect_json_in_text_columns: Option<bool>,
    /// Accent colour and icon, so a connection looks the same for everyone.
    ///
    /// Only the portable forms travel: a colour, an icon-pack id or an emoji
    /// are plain strings. An uploaded image lives as a file under
    /// `<app_data>/connection-icons/`, and its path means nothing on a
    /// teammate's machine, so [`strip_local_appearance`] drops it rather than
    /// carrying a reference that cannot resolve.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub appearance: Option<ConnectionAppearance>,
    pub updated_at: String,
    #[serde(default)]
    pub updated_by: String,
    /// Tombstone: the entry was removed from the share. Kept so the removal
    /// propagates to members that have not synced yet.
    #[serde(default)]
    pub deleted: bool,
}

/// A shared group, carrying the same fields as a local one plus the merge
/// metadata.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VaultGroup {
    #[serde(flatten)]
    pub group: ConnectionGroup,
    pub updated_at: String,
    #[serde(default)]
    pub deleted: bool,
}

/// A shared tag, with the same metadata as [`VaultGroup`].
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VaultTag {
    #[serde(flatten)]
    pub tag: ConnectionTag,
    pub updated_at: String,
    #[serde(default)]
    pub deleted: bool,
}

/// A shared SSH profile, credentials included: the tunnel password and the
/// key passphrase travel with it, exactly like a connection's own password.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VaultSshProfile {
    #[serde(flatten)]
    pub profile: SshConnection,
    pub updated_at: String,
    #[serde(default)]
    pub updated_by: String,
    #[serde(default)]
    pub deleted: bool,
}

/// A shared Kubernetes tunnel. Unlike [`VaultSshProfile`] it holds no
/// secrets — context, namespace and resource name are plain configuration.
///
/// `kubectlPath` and `kubeconfigPath` are machine-local paths, so they travel
/// verbatim and may not resolve on a teammate's machine; an environment
/// variable in them is the portable way to write
/// one.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VaultK8sProfile {
    #[serde(flatten)]
    pub profile: K8sConnection,
    pub updated_at: String,
    #[serde(default)]
    pub updated_by: String,
    #[serde(default)]
    pub deleted: bool,
}

/// The shareable part of a connection's appearance.
///
/// An uploaded image is a path into this machine's own data directory, so it
/// is dropped: a teammate would resolve it to nothing. The accent colour
/// survives on its own, so a connection that had both keeps its colour.
/// Returns `None` when nothing portable is left.
pub fn strip_local_appearance(
    appearance: Option<&ConnectionAppearance>,
) -> Option<ConnectionAppearance> {
    let appearance = appearance?;
    let icon = match &appearance.icon {
        Some(IconOverride::Image { .. }) | None => None,
        Some(portable) => Some(portable.clone()),
    };
    if icon.is_none() && appearance.accent_color.is_none() {
        return None;
    }
    Some(ConnectionAppearance {
        icon,
        accent_color: appearance.accent_color.clone(),
    })
}

/// Appearance to store locally for a shared connection.
///
/// The team's look wins, so a connection is recognisable to everyone. The one
/// thing kept from the member is an uploaded image icon, and only while the
/// team brings no icon of its own: the share never carries images (see
/// [`strip_local_appearance`]), so overwriting one with nothing would silently
/// undo a choice the member made and cannot get back.
pub fn merge_appearance(
    shared: Option<&ConnectionAppearance>,
    local: Option<&ConnectionAppearance>,
) -> Option<ConnectionAppearance> {
    let local_image = local.and_then(|a| match &a.icon {
        Some(IconOverride::Image { .. }) => a.icon.clone(),
        _ => None,
    });
    match shared {
        Some(shared) => Some(ConnectionAppearance {
            icon: shared.icon.clone().or(local_image),
            accent_color: shared.accent_color.clone(),
        }),
        None => local_image.map(|icon| ConnectionAppearance {
            icon: Some(icon),
            accent_color: None,
        }),
    }
}

fn base64_encode(bytes: &[u8]) -> String {
    use base64::engine::general_purpose::STANDARD as BASE64;
    use base64::Engine;
    BASE64.encode(bytes)
}

fn base64_decode(value: &str) -> Result<Vec<u8>, String> {
    use base64::engine::general_purpose::STANDARD as BASE64;
    use base64::Engine;
    BASE64
        .decode(value)
        .map_err(|e| format!("Invalid salt in the vault header: {e}"))
}

/// RFC-3339 timestamp in UTC with millisecond precision. Fixed width and
/// fixed offset, so the merge can order two stamps by plain string compare.
pub fn now_timestamp() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

/// Label recorded as `updatedBy`, so a teammate can tell who wrote last.
///
/// Best effort and purely informational. The user name comes from `USER`
/// (macOS/Linux) or `USERNAME` (Windows); the host from `COMPUTERNAME`
/// (Windows), `/etc/hostname` (Linux) or `HOSTNAME`, which most shells do not
/// export — so on macOS the label is usually just the user name.
pub fn current_actor() -> String {
    let user = std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .unwrap_or_else(|_| "unknown".to_string());
    match current_host() {
        Some(host) => format!("{user}@{host}"),
        None => user,
    }
}

fn current_host() -> Option<String> {
    if let Ok(host) = std::env::var("COMPUTERNAME") {
        if !host.is_empty() {
            return Some(host);
        }
    }
    if let Ok(host) = fs::read_to_string("/etc/hostname") {
        let host = host.trim();
        if !host.is_empty() {
            return Some(host.to_string());
        }
    }
    std::env::var("HOSTNAME").ok().filter(|h| !h.is_empty())
}

/// Derive the master key from `password` and the vault's own KDF parameters.
///
/// Returned wrapped so every copy of the key — including the short-lived ones
/// made while joining or unlocking a vault — is wiped when it goes out of
/// scope, not just the one the session holds.
pub fn derive_key(password: &str, kdf: &KdfParams) -> Result<Zeroizing<[u8; 32]>, String> {
    let salt = base64_decode(&kdf.salt)?;
    Ok(Zeroizing::new(export_crypto::derive_key(
        password, &salt, kdf.m_cost, kdf.t_cost, kdf.p_cost,
    )?))
}

/// True when `key` is the key the vault was sealed with.
pub fn verify_key(file: &VaultFile, key: &[u8; 32]) -> bool {
    matches!(
        export_crypto::open_with_key(key, &file.verifier),
        Ok(plaintext) if plaintext == VERIFIER_PLAINTEXT
    )
}

/// Build a brand-new vault sealed with `key`.
pub fn create(kdf: KdfParams, key: &[u8; 32], payload: &VaultPayload) -> Result<VaultFile, String> {
    Ok(VaultFile {
        format: VAULT_FORMAT.to_string(),
        version: VAULT_VERSION,
        revision: 1,
        updated_at: now_timestamp(),
        updated_by: current_actor(),
        kdf,
        verifier: export_crypto::seal_with_key(key, VERIFIER_PLAINTEXT)?,
        payload: seal_payload(key, payload)?,
    })
}

fn seal_payload(key: &[u8; 32], payload: &VaultPayload) -> Result<Sealed, String> {
    let plaintext = serde_json::to_string(payload).map_err(|e| e.to_string())?;
    export_crypto::seal_with_key(key, &plaintext)
}

/// Decrypt the payload of `file`.
pub fn open_payload(file: &VaultFile, key: &[u8; 32]) -> Result<VaultPayload, String> {
    let plaintext = export_crypto::open_with_key(key, &file.payload)?;
    serde_json::from_str(&plaintext).map_err(|e| format!("Invalid vault payload: {e}"))
}

/// Replace the payload of `file` and bump its revision.
pub fn reseal(file: &mut VaultFile, key: &[u8; 32], payload: &VaultPayload) -> Result<(), String> {
    file.payload = seal_payload(key, payload)?;
    file.revision = file.revision.saturating_add(1);
    file.updated_at = now_timestamp();
    file.updated_by = current_actor();
    Ok(())
}

/// Read and parse the vault. `Ok(None)` when the file does not exist yet.
///
/// The handle is dropped before this returns: the share is touched only for
/// the duration of the read.
pub fn read(path: &Path) -> Result<Option<VaultFile>, String> {
    let content = match fs::read_to_string(path) {
        Ok(content) => content,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("Cannot read the shared vault: {e}")),
    };
    let file: VaultFile = serde_json::from_str(&content)
        .map_err(|e| format!("The shared vault file is not a valid vault: {e}"))?;
    if file.format != VAULT_FORMAT {
        return Err(format!(
            "Unrecognized shared vault format: {}",
            file.format
        ));
    }
    if file.version > VAULT_VERSION {
        return Err(format!(
            "The shared vault was written by a newer version of Tabularis (format {} > {VAULT_VERSION}). Update Tabularis to use it.",
            file.version
        ));
    }
    Ok(Some(file))
}

/// Write the vault through a sibling temp file renamed over the target, so a
/// reader never observes a half-written file. Caller must hold a [`VaultLock`].
pub fn write(path: &Path, file: &VaultFile) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Cannot reach the shared folder {}: {e}", parent.display()))?;
    }
    let json = serde_json::to_string_pretty(file).map_err(|e| e.to_string())?;
    let temp = temp_path_for(path);
    fs::write(&temp, json).map_err(|e| format!("Cannot write to the shared folder: {e}"))?;
    // POSIX `rename` replaces the destination atomically, so macOS and Linux
    // go straight to it and a reader never sees the file missing. Windows
    // refuses to rename onto an existing file, so there it has to go first;
    // that window is covered by the lock file, and the temp file still holds
    // the full content if the rename then fails.
    #[cfg(windows)]
    if path.exists() {
        // Clean the temp file up on the way out: leaving it behind would
        // litter the team's folder with one orphan per failed write.
        if let Err(e) = fs::remove_file(path) {
            let _ = fs::remove_file(&temp);
            return Err(format!("Cannot replace the shared vault: {e}"));
        }
    }
    match fs::rename(&temp, path) {
        Ok(()) => Ok(()),
        Err(e) => {
            let _ = fs::remove_file(&temp);
            Err(format!("Cannot replace the shared vault: {e}"))
        }
    }
}

fn temp_path_for(path: &Path) -> PathBuf {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| DEFAULT_VAULT_FILENAME.to_string());
    let unique = uuid::Uuid::new_v4();
    path.with_file_name(format!(".{name}.{unique}.tmp"))
}

/// Path of the lock file guarding `vault_path`.
pub fn lock_path_for(vault_path: &Path) -> PathBuf {
    let name = vault_path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| DEFAULT_VAULT_FILENAME.to_string());
    vault_path.with_file_name(format!("{name}.lock"))
}

/// Exclusive, advisory lock over the vault file, released on drop.
///
/// Held only around a read-merge-write cycle — never across a user
/// interaction — so the share is never left locked waiting for somebody to
/// type a password.
pub struct VaultLock {
    path: PathBuf,
}

impl VaultLock {
    /// Take the lock, breaking one that has gone stale. Blocks for at most
    /// `LOCK_ATTEMPTS * LOCK_RETRY_DELAY`.
    pub fn acquire(vault_path: &Path) -> Result<Self, String> {
        let path = lock_path_for(vault_path);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Cannot reach the shared folder {}: {e}", parent.display()))?;
        }
        for attempt in 0..LOCK_ATTEMPTS {
            match fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&path)
            {
                Ok(mut handle) => {
                    use std::io::Write;
                    // Content is diagnostic only; the lock is the file's
                    // existence. Failing to write it must not fail the lock.
                    let _ = writeln!(handle, "{} {}", current_actor(), now_timestamp());
                    return Ok(Self { path });
                }
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                    if break_if_stale(&path) {
                        continue;
                    }
                    if attempt + 1 < LOCK_ATTEMPTS {
                        std::thread::sleep(LOCK_RETRY_DELAY);
                    }
                }
                Err(e) => return Err(format!("Cannot lock the shared vault: {e}")),
            }
        }
        Err(
            "The shared vault is locked by another team member. Try again in a moment."
                .to_string(),
        )
    }
}

impl Drop for VaultLock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

/// Remove `path` when it is older than [`LOCK_STALE_AFTER`]. Returns whether
/// it was removed. A lock whose age cannot be determined is left alone.
fn break_if_stale(path: &Path) -> bool {
    let Ok(modified) = fs::metadata(path).and_then(|m| m.modified()) else {
        return false;
    };
    let Ok(age) = SystemTime::now().duration_since(modified) else {
        return false;
    };
    if age < LOCK_STALE_AFTER {
        return false;
    }
    log::warn!(
        "[TeamShare] Breaking a stale vault lock ({}s old): {}",
        age.as_secs(),
        path.display()
    );
    fs::remove_file(path).is_ok()
}

/// Local cache of the payload as of the last successful sync, i.e. the base
/// of the three-way merge.
///
/// Without it the merge cannot tell "my teammate added this" from "I deleted
/// this" after a restart. It is sealed with the same master key as the vault,
/// so it is readable only by somebody who knows the master password — the
/// same bar as the share itself.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BaseCache {
    pub format: String,
    pub vault_revision: u64,
    pub payload: Sealed,
}

/// File name of the base cache inside the app config directory.
pub const BASE_CACHE_FILENAME: &str = "team-share-base.json";

/// Seal `payload` as the new merge base.
pub fn seal_base_cache(
    key: &[u8; 32],
    revision: u64,
    payload: &VaultPayload,
) -> Result<BaseCache, String> {
    Ok(BaseCache {
        format: VAULT_FORMAT.to_string(),
        vault_revision: revision,
        payload: seal_payload(key, payload)?,
    })
}

/// Read the merge base written by the previous session.
///
/// Every failure — missing file, unreadable, sealed with another key — yields
/// `None`. An absent base makes the next merge treat both sides as new, which
/// only costs a redundant push; a *wrong* base would cost data.
pub fn read_base_cache(path: &Path, key: &[u8; 32]) -> Option<VaultPayload> {
    let content = fs::read_to_string(path).ok()?;
    let cache: BaseCache = serde_json::from_str(&content).ok()?;
    if cache.format != VAULT_FORMAT {
        return None;
    }
    let plaintext = export_crypto::open_with_key(key, &cache.payload).ok()?;
    serde_json::from_str(&plaintext).ok()
}

/// Resolve what the user picked into the path of the vault file itself:
/// a folder gets the default file name appended, anything else is taken as
/// the file path.
pub fn resolve_vault_path(picked: &Path) -> PathBuf {
    if picked.is_dir() {
        picked.join(DEFAULT_VAULT_FILENAME)
    } else {
        picked.to_path_buf()
    }
}
