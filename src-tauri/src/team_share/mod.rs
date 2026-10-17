//! Team share: a copy of selected connections and their credentials kept on a
//! shared folder, encrypted with a master password the team agrees on.
//!
//! What it is for: a team that already shares a network folder wants to share
//! database connections — host, port, database, *and* the credentials —
//! without each member retyping them and without putting secrets in plain
//! text on the share.
//!
//! How it fits the rest of the app:
//!
//! - The vault file is the single source of truth for shared connections. See
//!   [`vault`] for its format.
//! - Shared records are materialized into the local files **without their
//!   secrets** and with `managed_by: "team-share"`, so every existing screen
//!   (the connection list, groups, tags) keeps working untouched.
//! - Core reaches the team share only through [`crate::managed`]: it asks
//!   [`TeamShareSource`] for credentials and tells it about local edits. That
//!   boundary is what a later move to a plugin would turn into RPC.
//! - The secrets live in memory only, for as long as the vault is unlocked.
//!   They are never written to the local files and never put in the OS
//!   keychain, so closing the app forgets them: the master password is asked
//!   again on the next launch.
//!
//! Concurrency: the unlocked secrets sit behind their own lock, which lookups
//! take for a map read and which is never held while the shared folder is
//! read or written. The share itself is touched only inside a sync, which runs
//! on a blocking thread, takes a lock file, reads, merges, writes when
//! something changed, and releases. A sync that finds a local edit landed
//! while it talked to the share merges again instead of overwriting it (see
//! [`crate::persistence::WriteGate`]). The merge ([`merge`]) is a three-way
//! merge against the last synced state, so two members writing around the same
//! time cannot drop each other's connections.
//!
//! Threat model, in short: whoever has the master password *and* read access
//! to the folder has every shared credential. There is no per-member access or
//! revocation — when someone leaves the team, change the master password (set
//! the share up again in a new vault) and rotate the credentials it held.
//! Deletions travel as tombstones that are kept for
//! [`merge::TOMBSTONE_RETENTION_DAYS`] days; a member who has not synced for
//! longer than that and still holds a deleted connection pushes it back.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard, PoisonError, RwLock, RwLockReadGuard, RwLockWriteGuard};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use zeroize::Zeroizing;

use crate::models::{SavedConnection, SshConnection};
use crate::persistence;

pub mod local;
pub mod merge;
pub mod secrets;
mod source;
pub mod vault;

#[cfg(test)]
mod tests;

use local::{is_team, LocalFiles, SecretMaps};
use merge::{MergeContext, MergeOutcome, TOMBSTONE_RETENTION_DAYS};
use vault::{VaultFile, VaultPayload};

pub use secrets::{EntrySecrets, SshSecrets};
pub use source::TeamShareSource;

/// `managed_by` value of the records the team share owns.
pub const SOURCE_ID: &str = "team-share";

/// Event emitted after the local files were changed by a sync, so the
/// frontend reloads them.
pub const SYNCED_EVENT: &str = "team-share-synced";

/// Event emitted when something asked for a shared connection's credentials
/// while the vault was locked. The frontend opens the master-password prompt
/// on it, unless the user dismissed the prompt and has not asked for anything
/// since.
pub const LOCKED_EVENT: &str = "team-share-locked";

/// Event emitted when the share was set up, unlocked, locked or left, so every
/// screen showing its state refreshes.
pub const STATUS_EVENT: &str = "team-share-status";

/// Minimum gap between two [`LOCKED_EVENT`]s. Something resolving connections
/// in the background would otherwise fire one per lookup.
const LOCKED_PROMPT_INTERVAL: Duration = Duration::from_secs(5);

/// How many times a sync merges again when local edits keep landing while it
/// talks to the share, before giving up until the next change.
const SYNC_ATTEMPTS: usize = 3;

const LOCKED_MESSAGE: &str = "The team share is locked. Unlock it with the master password first.";

/// What an unlocked share exposes to the rest of the app.
///
/// Read on every lookup of a shared connection, so it sits behind its own lock
/// that is never held across share I/O.
struct Unlocked {
    secrets: SecretMaps,
    /// Bumped by every local write to `secrets` (a password typed in an edit
    /// form), so a sync can tell whether one landed while it ran.
    generation: u64,
    revision: u64,
    updated_at: String,
    updated_by: String,
    last_sync: Option<SyncReport>,
}

/// What a sync needs and nothing else reads: the master key and the merge base.
///
/// Wiped on drop — locking the vault, leaving the share or closing the app
/// must not leave the master key lying in freed memory.
struct Session {
    /// Derived once at unlock. Deriving it costs 64 MiB of Argon2, so it is
    /// not recomputed per sync.
    key: Zeroizing<[u8; 32]>,
    path: PathBuf,
    /// Payload of the last successful sync: the base of the three-way merge.
    base: VaultPayload,
}

/// Managed state. Holds nothing at all until the user unlocks the vault.
#[derive(Default)]
pub struct TeamShareState {
    unlocked: RwLock<Option<Unlocked>>,
    /// Held for a whole sync, which may wait on a slow shared folder. Only
    /// sync paths take it, never a lookup.
    session: Mutex<Option<Session>>,
    /// A background push is queued and has not started yet.
    push_queued: AtomicBool,
    last_locked_prompt: Mutex<Option<Instant>>,
}

impl TeamShareState {
    fn read(&self) -> RwLockReadGuard<'_, Option<Unlocked>> {
        self.unlocked.read().unwrap_or_else(PoisonError::into_inner)
    }

    fn write(&self) -> RwLockWriteGuard<'_, Option<Unlocked>> {
        self.unlocked
            .write()
            .unwrap_or_else(PoisonError::into_inner)
    }

    fn session(&self) -> MutexGuard<'_, Option<Session>> {
        self.session.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

/// What a sync did, for the log and for the settings panel.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncReport {
    pub pulled: usize,
    pub pushed: usize,
    pub conflicts: usize,
    pub removed: usize,
    pub revision: u64,
}

/// Snapshot handed to the settings panel and to the unlock gate.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamShareStatus {
    /// A vault path is recorded in the config.
    pub configured: bool,
    pub path: Option<String>,
    /// The vault file exists at that path.
    pub vault_exists: bool,
    pub unlocked: bool,
    pub revision: Option<u64>,
    pub updated_at: Option<String>,
    pub updated_by: Option<String>,
    /// Ids of the connections currently coming from the share.
    pub shared_connection_ids: Vec<String>,
    pub last_sync: Option<SyncReport>,
}

// ---------------------------------------------------------------------------
// Configuration and paths
// ---------------------------------------------------------------------------

/// Vault path recorded in `config.json`, if any.
pub fn configured_path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    crate::config::load_config_internal(app)
        .team_share_path
        .map(PathBuf::from)
        .filter(|p| !p.as_os_str().is_empty())
}

fn set_configured_path<R: Runtime>(app: &AppHandle<R>, path: Option<&Path>) -> Result<(), String> {
    let mut config = crate::config::load_config_internal(app);
    config.team_share_path = path.map(|p| p.to_string_lossy().into_owned());
    crate::config::persist_config(app, &config)
}

/// The three local files a sync reads and writes.
struct LocalPaths {
    connections: PathBuf,
    ssh: PathBuf,
    k8s: PathBuf,
}

impl LocalPaths {
    fn resolve<R: Runtime>(app: &AppHandle<R>) -> Result<Self, String> {
        Ok(Self {
            connections: crate::commands::get_config_path(app)?,
            ssh: crate::commands::get_ssh_config_path(app)?,
            k8s: crate::commands::get_k8s_config_path(app)?,
        })
    }

    fn load(&self) -> Result<LocalFiles, String> {
        Ok(LocalFiles {
            connections: persistence::load_connections_file(&self.connections)?,
            ssh: persistence::load_ssh_connections_file(&self.ssh)?,
            k8s: persistence::load_k8s_connections_file(&self.k8s)?,
        })
    }

    fn save<R: Runtime>(&self, app: &AppHandle<R>, files: &LocalFiles) -> Result<(), String> {
        persistence::save_connections_file(&self.connections, &files.connections)?;
        persistence::save_ssh_connections_file(&self.ssh, &files.ssh)?;
        persistence::save_k8s_connections_file(&self.k8s, &files.k8s)?;
        invalidate_connection_cache(app);
        Ok(())
    }
}

fn invalidate_connection_cache<R: Runtime>(app: &AppHandle<R>) {
    if let Some(cache) = app.try_state::<std::sync::Arc<crate::connection_cache::ConnectionCache>>()
    {
        cache.invalidate();
    }
}

fn base_cache_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let dir = crate::config::get_config_dir(app).ok_or("Could not resolve config directory")?;
    Ok(dir.join(vault::BASE_CACHE_FILENAME))
}

/// Persist the merge base for the next session. Best effort: a base that
/// could not be written only costs a redundant push next time.
fn write_base_cache<R: Runtime>(
    app: &AppHandle<R>,
    key: &[u8; 32],
    revision: u64,
    payload: &VaultPayload,
) {
    let write = || -> Result<(), String> {
        let cache = vault::seal_base_cache(key, revision, payload)?;
        let json = serde_json::to_string_pretty(&cache).map_err(|e| e.to_string())?;
        persistence::write_private_file(&base_cache_path(app)?, json)
    };
    if let Err(e) = write() {
        log::warn!("[TeamShare] Could not cache the merge base: {e}");
    }
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

fn merge_context() -> MergeContext {
    let cutoff = chrono::Utc::now() - chrono::Duration::days(TOMBSTONE_RETENTION_DAYS);
    MergeContext {
        now: vault::now_timestamp(),
        actor: vault::current_actor(),
        tombstone_cutoff: cutoff.to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
    }
}

/// The local state a sync starts from, with the write counts it was read at.
struct Snapshot {
    files: LocalFiles,
    file_generations: [u64; 3],
    secret_generation: u64,
    local: VaultPayload,
}

fn take_snapshot(
    paths: &LocalPaths,
    state: &TeamShareState,
    base: &VaultPayload,
) -> Result<Snapshot, String> {
    // Each file is read under its gate, so the count recorded is the one the
    // content belongs to.
    let (connections, connections_generation) = {
        let generation = persistence::CONNECTIONS_FILE_GATE.hold();
        (
            persistence::load_connections_file(&paths.connections)?,
            *generation,
        )
    };
    let (ssh, ssh_generation) = {
        let generation = persistence::SSH_FILE_GATE.hold();
        (
            persistence::load_ssh_connections_file(&paths.ssh)?,
            *generation,
        )
    };
    let (k8s, k8s_generation) = {
        let generation = persistence::K8S_FILE_GATE.hold();
        (
            persistence::load_k8s_connections_file(&paths.k8s)?,
            *generation,
        )
    };
    let (secrets, secret_generation) = {
        let unlocked = state.read();
        let open = unlocked.as_ref().ok_or(LOCKED_MESSAGE)?;
        (open.secrets.clone(), open.generation)
    };

    let files = LocalFiles {
        connections,
        ssh,
        k8s,
    };
    let local = local::build_payload(&files, &secrets, base);
    Ok(Snapshot {
        files,
        file_generations: [connections_generation, ssh_generation, k8s_generation],
        secret_generation,
        local,
    })
}

/// What the share looked like after the read-merge-write.
struct Exchange {
    merged: VaultPayload,
    revision: u64,
    updated_at: String,
    updated_by: String,
    report: SyncReport,
}

/// The part of a sync that touches the shared folder.
///
/// The lock file is held for the whole cycle, but the cycle is short: the
/// master key is already derived, so this is a file read, a symmetric
/// decrypt, an in-memory merge and at most one write. Waiting for the lock can
/// take up to ~10 s, which is why this only ever runs on a blocking thread.
fn exchange_with_share(session: &Session, local: &VaultPayload) -> Result<Exchange, String> {
    let lock = vault::VaultLock::acquire(&session.path)?;
    let mut file =
        vault::read(&session.path)?.ok_or("The shared vault file is no longer on the share.")?;
    if !vault::verify_key(&file, &session.key) {
        return Err(
            "The master password no longer opens this vault — it was re-created by a teammate."
                .to_string(),
        );
    }
    let remote = vault::open_payload(&file, &session.key)?;

    let (merged, notes) = merge::merge_payload(&session.base, &remote, local, &merge_context());

    let mut report = SyncReport::default();
    for note in &notes {
        match note.outcome {
            MergeOutcome::PulledFromShare => {
                report.pulled += 1;
                log::info!("[TeamShare] pulled {} {}", note.kind, note.id);
            }
            MergeOutcome::PushedFromLocal => {
                report.pushed += 1;
                log::info!("[TeamShare] pushed {} {}", note.kind, note.id);
            }
            MergeOutcome::ConflictLocalWins => {
                report.conflicts += 1;
                log::warn!(
                    "[TeamShare] {} {} changed here and on the share since the last sync; the local version wins",
                    note.kind,
                    note.id
                );
            }
            MergeOutcome::TombstonedLocally => report.removed += 1,
            MergeOutcome::TombstoneExpired => {}
        }
    }

    if merged != remote {
        vault::reseal(&mut file, &session.key, &merged)?;
        vault::write(&session.path, &file)?;
        log::info!(
            "[TeamShare] Vault written: revision {}, {} shared connection(s)",
            file.revision,
            merged.entries.iter().filter(|e| !e.deleted).count()
        );
    }
    drop(lock);

    report.revision = file.revision;
    Ok(Exchange {
        merged,
        revision: file.revision,
        updated_at: file.updated_at,
        updated_by: file.updated_by,
        report,
    })
}

/// Write the merged payload into the local files and the in-memory secrets —
/// unless something local changed since `snapshot` was taken.
///
/// All three file gates and the secrets lock are held from the check to the
/// last write, so no local edit can slip in between. Returns `false` when the
/// snapshot is stale: the caller merges again rather than overwrite the edit.
fn apply_locally<R: Runtime>(
    app: &AppHandle<R>,
    state: &TeamShareState,
    paths: &LocalPaths,
    snapshot: &Snapshot,
    exchange: &Exchange,
) -> Result<bool, String> {
    let mut connections_generation = persistence::CONNECTIONS_FILE_GATE.hold();
    let mut ssh_generation = persistence::SSH_FILE_GATE.hold();
    let mut k8s_generation = persistence::K8S_FILE_GATE.hold();
    let mut unlocked = state.write();
    let open = unlocked
        .as_mut()
        .ok_or("The team share was locked during the sync.")?;

    let current = [*connections_generation, *ssh_generation, *k8s_generation];
    if current != snapshot.file_generations || open.generation != snapshot.secret_generation {
        return Ok(false);
    }

    let mut files = snapshot.files.clone();
    let secrets = local::apply_payload(&mut files, &exchange.merged);
    persistence::save_connections_file_held(
        &mut connections_generation,
        &paths.connections,
        &files.connections,
    )?;
    persistence::save_ssh_connections_file_held(&mut ssh_generation, &paths.ssh, &files.ssh)?;
    if files.k8s.len() != snapshot.files.k8s.len() || !exchange.merged.k8s_profiles.is_empty() {
        persistence::save_k8s_connections_file_held(&mut k8s_generation, &paths.k8s, &files.k8s)?;
    }

    open.secrets = secrets;
    open.revision = exchange.revision;
    open.updated_at = exchange.updated_at.clone();
    open.updated_by = exchange.updated_by.clone();
    open.last_sync = Some(exchange.report.clone());
    drop(unlocked);
    drop(k8s_generation);
    drop(ssh_generation);
    drop(connections_generation);

    invalidate_connection_cache(app);
    Ok(true)
}

/// One sync: snapshot the local state, read-merge-write the share, write the
/// result back here. Runs on a blocking thread, with the session held.
fn sync_session<R: Runtime>(
    app: &AppHandle<R>,
    state: &TeamShareState,
    session: &mut Session,
) -> Result<SyncReport, String> {
    let paths = LocalPaths::resolve(app)?;
    for attempt in 1..=SYNC_ATTEMPTS {
        let snapshot = take_snapshot(&paths, state, &session.base)?;
        let exchange = exchange_with_share(session, &snapshot.local)?;
        if !apply_locally(app, state, &paths, &snapshot, &exchange)? {
            // The base stays where it was: what this attempt wrote to the
            // share is merged again, together with the new local edit.
            log::info!(
                "[TeamShare] A local change landed during sync attempt {attempt}; merging again"
            );
            continue;
        }

        write_base_cache(app, &session.key, exchange.revision, &exchange.merged);
        session.base = exchange.merged;
        let report = exchange.report;
        log::info!(
            "[TeamShare] Sync done: {} pulled, {} pushed, {} conflict(s), {} removed",
            report.pulled,
            report.pushed,
            report.conflicts,
            report.removed
        );
        let _ = app.emit(SYNCED_EVENT, &report);
        return Ok(report);
    }
    Err(
        "Local changes kept arriving while syncing with the team share. They will be synced with the next change."
            .to_string(),
    )
}

/// Push local changes to the share from a blocking thread.
///
/// Coalesced: while a push is queued and has not started, further changes ride
/// along with it, since it snapshots the local state only once it runs.
pub(crate) fn schedule_push<R: Runtime>(app: &AppHandle<R>) {
    let state = app.state::<TeamShareState>();
    if state.push_queued.swap(true, Ordering::AcqRel) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<TeamShareState>();
        let mut session = state.session();
        // Cleared only once the session is ours: a change recorded from here
        // on may be missed by this snapshot, so it queues a push of its own.
        state.push_queued.store(false, Ordering::Release);
        let Some(session) = session.as_mut() else {
            return;
        };
        if let Err(e) = sync_session(&app, &state, session) {
            log::warn!("[TeamShare] Could not push the local change to the share: {e}");
        }
    });
}

/// Payload of [`LOCKED_EVENT`].
#[derive(Debug, Clone, Serialize)]
pub struct LockedPrompt {
    /// The user asked for this (an edit, an export), as opposed to a lookup
    /// that may come from the background. Only an explicit request reopens a
    /// prompt the user dismissed.
    pub explicit: bool,
}

/// Ask the frontend for the master password. Background lookups are
/// debounced to one event per [`LOCKED_PROMPT_INTERVAL`]; an explicit request
/// always goes through.
pub(crate) fn request_unlock_prompt<R: Runtime>(app: &AppHandle<R>, explicit: bool) {
    let state = app.state::<TeamShareState>();
    let mut last = state
        .last_locked_prompt
        .lock()
        .unwrap_or_else(PoisonError::into_inner);
    if !explicit && last.is_some_and(|at| at.elapsed() < LOCKED_PROMPT_INTERVAL) {
        return;
    }
    *last = Some(Instant::now());
    let _ = app.emit(LOCKED_EVENT, LockedPrompt { explicit });
}

/// Run `work` on a blocking thread. Every command that may touch the shared
/// folder or derive the master key goes through here, so neither the main
/// thread nor the async workers wait on a slow share.
async fn blocking<R, T, F>(app: &AppHandle<R>, work: F) -> Result<T, String>
where
    R: Runtime,
    T: Send + 'static,
    F: FnOnce(AppHandle<R>) -> Result<T, String> + Send + 'static,
{
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || work(app))
        .await
        .map_err(|e| format!("Team share task failed: {e}"))?
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

fn status<R: Runtime>(app: &AppHandle<R>) -> TeamShareStatus {
    let configured = configured_path(app);
    let shared_connection_ids: Vec<String> = crate::commands::get_config_path(app)
        .ok()
        .and_then(|path| persistence::load_connections_file(&path).ok())
        .map(|file| {
            file.connections
                .iter()
                .filter(|c| is_team(&c.managed_by))
                .map(|c| c.id.clone())
                .collect()
        })
        .unwrap_or_default();

    let state = app.state::<TeamShareState>();
    let unlocked = state.read();
    TeamShareStatus {
        configured: configured.is_some(),
        vault_exists: configured.as_deref().map(Path::is_file).unwrap_or(false),
        path: configured.map(|p| p.to_string_lossy().into_owned()),
        unlocked: unlocked.is_some(),
        revision: unlocked.as_ref().map(|u| u.revision),
        updated_at: unlocked.as_ref().map(|u| u.updated_at.clone()),
        updated_by: unlocked.as_ref().map(|u| u.updated_by.clone()),
        shared_connection_ids,
        last_sync: unlocked.as_ref().and_then(|u| u.last_sync.clone()),
    }
}

fn emit_status<R: Runtime>(app: &AppHandle<R>) -> TeamShareStatus {
    let current = status(app);
    let _ = app.emit(STATUS_EVENT, &current);
    current
}

#[tauri::command]
pub async fn get_team_share_status<R: Runtime>(app: AppHandle<R>) -> TeamShareStatus {
    status(&app)
}

/// Point Tabularis at a vault and unlock it with `master_password`.
///
/// When `path` has no vault yet a new one is created and sealed with that
/// password. When it does, the password must open it — a wrong one is
/// rejected here and nothing is shared.
#[tauri::command]
pub async fn setup_team_share<R: Runtime>(
    app: AppHandle<R>,
    path: String,
    master_password: String,
) -> Result<TeamShareStatus, String> {
    let master_password = Zeroizing::new(master_password);
    if master_password.trim().is_empty() {
        return Err("The master password must not be empty.".to_string());
    }
    let vault_path = vault::resolve_vault_path(Path::new(&path));
    if !vault_path.is_absolute() {
        return Err("The shared folder must be an absolute path.".to_string());
    }
    blocking(&app, move |app| {
        setup_blocking(&app, vault_path, &master_password)
    })
    .await
}

fn setup_blocking<R: Runtime>(
    app: &AppHandle<R>,
    vault_path: PathBuf,
    master_password: &str,
) -> Result<TeamShareStatus, String> {
    let existing = vault::read(&vault_path)?;
    let (file, created) = match existing {
        Some(file) => (file, false),
        None => {
            let kdf = vault::KdfParams::default();
            let key = vault::derive_key(master_password, &kdf)?;
            let file = vault::create(kdf, &key, &VaultPayload::default())?;
            let _lock = vault::VaultLock::acquire(&vault_path)?;
            // Re-check under the lock: a teammate may have created the vault
            // between our read and now, and overwriting it would lock them out.
            match vault::read(&vault_path)? {
                Some(theirs) => (theirs, false),
                None => {
                    vault::write(&vault_path, &file)?;
                    (file, true)
                }
            }
        }
    };

    let key = vault::derive_key(master_password, &file.kdf)?;
    if !vault::verify_key(&file, &key) {
        return Err(
            "Wrong master password for this shared vault. The shared credentials stay locked."
                .to_string(),
        );
    }

    set_configured_path(app, Some(&vault_path))?;
    log::info!(
        "[TeamShare] {} vault at {}",
        if created { "Created" } else { "Joined" },
        vault_path.display()
    );
    open_session(app, key, vault_path, &file)
}

/// Unlock the configured vault for this session.
#[tauri::command]
pub async fn unlock_team_share<R: Runtime>(
    app: AppHandle<R>,
    master_password: String,
) -> Result<TeamShareStatus, String> {
    let master_password = Zeroizing::new(master_password);
    blocking(&app, move |app| {
        let path = configured_path(&app).ok_or("No team share is configured.")?;
        let file = vault::read(&path)?.ok_or_else(|| {
            format!(
                "The shared vault was not found at {}. Check that the share is reachable.",
                path.display()
            )
        })?;
        let key = vault::derive_key(&master_password, &file.kdf)?;
        if !vault::verify_key(&file, &key) {
            return Err("Wrong master password. The shared credentials stay locked.".to_string());
        }
        open_session(&app, key, path, &file)
    })
    .await
}

/// Install a fresh session and run the first sync.
fn open_session<R: Runtime>(
    app: &AppHandle<R>,
    key: Zeroizing<[u8; 32]>,
    path: PathBuf,
    file: &VaultFile,
) -> Result<TeamShareStatus, String> {
    let remote = vault::open_payload(file, &key)?;
    // Seed the credentials from the share before the first merge. The local
    // files never hold them, so without this seeding the first sync would see
    // every shared connection as "credentials removed here" and push that
    // emptiness back onto the team.
    let seeded = SecretMaps {
        connections: remote
            .entries
            .iter()
            .filter(|entry| !entry.deleted)
            .map(|entry| (entry.id.clone(), EntrySecrets::from_params(&entry.params)))
            .collect(),
        ssh: remote
            .ssh_profiles
            .iter()
            .filter(|profile| !profile.deleted)
            .map(|profile| {
                (
                    profile.profile.id.clone(),
                    SshSecrets::from_profile(&profile.profile),
                )
            })
            .collect(),
    };
    // The base written by the previous session is what makes a deletion
    // distinguishable from a teammate's addition. Losing it is not fatal: the
    // merge then treats both sides as new, which re-adds a connection deleted
    // while the vault was locked but never drops one.
    let base = vault::read_base_cache(&base_cache_path(app)?, &key).unwrap_or_default();

    let state = app.state::<TeamShareState>();
    let mut current = state.session();
    *state.write() = Some(Unlocked {
        secrets: seeded,
        generation: 0,
        revision: file.revision,
        updated_at: file.updated_at.clone(),
        updated_by: file.updated_by.clone(),
        last_sync: None,
    });
    let mut session = Session { key, path, base };
    if let Err(e) = sync_session(app, &state, &mut session) {
        *state.write() = None;
        return Err(e);
    }
    *current = Some(session);
    drop(current);
    Ok(emit_status(app))
}

/// Forget the master key and the shared credentials for this session. The
/// shared connections stay in the list but cannot be used until the next
/// unlock.
#[tauri::command]
pub async fn lock_team_share<R: Runtime>(app: AppHandle<R>) -> Result<TeamShareStatus, String> {
    // The credentials go first and at once: from here on a lookup is refused,
    // even while a sync still holds the session.
    *app.state::<TeamShareState>().write() = None;
    blocking(&app, |app| {
        *app.state::<TeamShareState>().session() = None;
        Ok(())
    })
    .await?;
    log::info!("[TeamShare] Vault locked");
    Ok(emit_status(&app))
}

/// Read the share, merge, and write back when something changed here.
#[tauri::command]
pub async fn sync_team_share<R: Runtime>(app: AppHandle<R>) -> Result<TeamShareStatus, String> {
    blocking(&app, |app| {
        let state = app.state::<TeamShareState>();
        let mut session = state.session();
        let session = session.as_mut().ok_or(LOCKED_MESSAGE)?;
        sync_session(&app, &state, session)?;
        Ok(())
    })
    .await?;
    Ok(status(&app))
}

/// Stop using the team share on this machine.
///
/// The vault on the share is left untouched: other members keep working. When
/// `keep_connections` is set the shared records stay as ordinary local ones,
/// and — if the share is unlocked — get their credentials back, in the
/// keychain where they ask for it. Otherwise they are removed.
#[tauri::command]
pub async fn disable_team_share<R: Runtime>(
    app: AppHandle<R>,
    keep_connections: bool,
) -> Result<TeamShareStatus, String> {
    blocking(&app, move |app| disable_blocking(&app, keep_connections)).await
}

fn disable_blocking<R: Runtime>(
    app: &AppHandle<R>,
    keep_connections: bool,
) -> Result<TeamShareStatus, String> {
    let state = app.state::<TeamShareState>();
    // No sync runs while the files are rewritten.
    let mut session = state.session();
    let secrets = state.read().as_ref().map(|u| u.secrets.clone());

    let paths = LocalPaths::resolve(app)?;
    let mut files = paths.load()?;
    let outcome = local::leave_share(&mut files, keep_connections, secrets.as_ref());
    // Keychain first: a connection that asks for the keychain must not reach
    // the file with its password in plain text.
    for id in &outcome.restored_connections {
        if let Some(connection) = files
            .connections
            .connections
            .iter_mut()
            .find(|c| &c.id == id)
        {
            if connection.params.save_in_keychain.unwrap_or(false) {
                let secrets = EntrySecrets::from_params(&connection.params);
                restore_local_credentials(app, id, &secrets, connection)?;
            }
        }
    }
    for id in &outcome.restored_ssh_profiles {
        if let Some(profile) = files.ssh.iter_mut().find(|p| &p.id == id) {
            restore_ssh_credentials(app, profile)?;
        }
    }
    paths.save(app, &files)?;
    if outcome.kept_without_credentials > 0 {
        log::warn!(
            "[TeamShare] {} kept record(s) left without credentials: the share was locked",
            outcome.kept_without_credentials
        );
    }

    *session = None;
    *state.write() = None;
    drop(session);
    // The base cache holds the shared credentials, encrypted. Nothing on this
    // machine should keep them once the share is no longer in use.
    if let Ok(cache) = base_cache_path(app) {
        let _ = std::fs::remove_file(cache);
    }
    set_configured_path(app, None)?;
    log::info!("[TeamShare] Team share disabled on this machine");
    let _ = app.emit(SYNCED_EVENT, SyncReport::default());
    Ok(emit_status(app))
}

/// Move connections into the share, or take them back out.
///
/// Sharing reads the credentials each connection has right now (keychain
/// included) into the vault, and only once the vault holds them deletes the
/// local keychain entries: from then on the share is the only place those
/// credentials live, which is what makes the master password actually gate
/// them. Unsharing does the reverse, writing them back to the keychain when
/// the connection asks for it. A failed sync puts everything back as it was.
///
/// Takes a list rather than one id so a multi-selection costs a single
/// read-merge-write against the share instead of one per connection.
#[tauri::command]
pub async fn set_connections_shared<R: Runtime>(
    app: AppHandle<R>,
    connection_ids: Vec<String>,
    shared: bool,
) -> Result<TeamShareStatus, String> {
    blocking(&app, move |app| {
        set_connections_shared_blocking(&app, connection_ids, shared)
    })
    .await
}

/// Keychain work of a membership change: done once the share has the
/// credentials, or undone when the sync failed.
#[derive(Default)]
struct KeychainPlan {
    /// Connections and SSH profiles that joined the share: their keychain
    /// entries go once the vault holds them.
    forget_connections: Vec<String>,
    forget_ssh: Vec<String>,
    /// Connections and SSH profiles that left the share and were written back
    /// to the keychain: removed again if the share keeps them after all.
    restored_connections: Vec<String>,
    restored_ssh: Vec<String>,
}

fn set_connections_shared_blocking<R: Runtime>(
    app: &AppHandle<R>,
    connection_ids: Vec<String>,
    shared: bool,
) -> Result<TeamShareStatus, String> {
    let state = app.state::<TeamShareState>();
    let mut guard = state.session();
    let session = guard.as_mut().ok_or(LOCKED_MESSAGE)?;

    let paths = LocalPaths::resolve(app)?;
    let original = paths.load()?;

    // Keep only the connections whose membership actually changes. A
    // connection owned by another source is never shared from here.
    let targets: Vec<String> = connection_ids
        .into_iter()
        .filter(|id| {
            original.connections.connections.iter().any(|c| {
                &c.id == id
                    && if shared {
                        c.managed_by.is_none()
                    } else {
                        is_team(&c.managed_by)
                    }
            })
        })
        .collect();
    if targets.is_empty() {
        drop(guard);
        return Ok(status(app));
    }

    let mut files = original.clone();
    let mut plan = KeychainPlan::default();
    let result = change_membership(
        app, &state, session, &paths, &mut files, &targets, shared, &mut plan,
    );

    match result {
        Ok(_) => {
            for id in &plan.forget_connections {
                forget_local_credentials(app, id);
            }
            for id in &plan.forget_ssh {
                forget_ssh_credentials(app, id);
            }
            drop(guard);
            Ok(emit_status(app))
        }
        Err(e) => {
            log::warn!("[TeamShare] Membership change failed, restoring the local state: {e}");
            if let Err(restore) = paths.save(app, &original) {
                log::error!("[TeamShare] Could not restore the local files: {restore}");
            }
            {
                let mut unlocked = state.write();
                if let Some(open) = unlocked.as_mut() {
                    for id in &plan.forget_connections {
                        open.secrets.connections.remove(id);
                    }
                    for id in &plan.forget_ssh {
                        open.secrets.ssh.remove(id);
                    }
                }
            }
            // The share still holds these: a keychain copy would be a second
            // place for the same credentials.
            for id in &plan.restored_connections {
                forget_local_credentials(app, id);
            }
            for id in &plan.restored_ssh {
                forget_ssh_credentials(app, id);
            }
            Err(e)
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn change_membership<R: Runtime>(
    app: &AppHandle<R>,
    state: &TeamShareState,
    session: &mut Session,
    paths: &LocalPaths,
    files: &mut LocalFiles,
    targets: &[String],
    shared: bool,
    plan: &mut KeychainPlan,
) -> Result<SyncReport, String> {
    if shared {
        // Resolve the credentials while the connections are still local, so
        // whatever is in the keychain travels with them.
        for id in targets {
            let resolved = crate::commands::find_connection_by_id(app, id)?;
            record_connection_secrets(state, id, EntrySecrets::from_params(&resolved.params));
            if let Some(connection) = files
                .connections
                .connections
                .iter_mut()
                .find(|c| &c.id == id)
            {
                connection.managed_by = Some(SOURCE_ID.to_string());
                crate::managed::strip_connection_secrets(&mut connection.params);
            }
            plan.forget_connections.push(id.clone());
        }
    } else {
        for id in targets {
            let secrets = state
                .read()
                .as_ref()
                .and_then(|u| u.secrets.connections.get(id).cloned())
                .unwrap_or_default();
            let Some(connection) = files
                .connections
                .connections
                .iter_mut()
                .find(|c| &c.id == id)
            else {
                continue;
            };
            connection.managed_by = None;
            secrets.apply_to(&mut connection.params);
            // `save_connections_file` keeps a plaintext password out of the
            // file only for keychain-backed connections, so write the keychain
            // entries before saving.
            if connection.params.save_in_keychain.unwrap_or(false) {
                plan.restored_connections.push(id.clone());
                restore_local_credentials(app, id, &secrets, connection)?;
            }
        }
    }

    // The SSH profiles and K8s tunnels follow the connections that use them.
    let (wanted_ssh, wanted_k8s) = local::wanted_profiles(&files.connections);
    reconcile_ssh_profiles(app, state, &mut files.ssh, &wanted_ssh, plan)?;
    local::reconcile_k8s_flags(&mut files.k8s, &wanted_k8s);

    paths.save(app, files)?;
    sync_session(app, state, session)
}

fn record_connection_secrets(state: &TeamShareState, id: &str, secrets: EntrySecrets) {
    if let Some(open) = state.write().as_mut() {
        open.secrets.connections.insert(id.to_string(), secrets);
        open.generation += 1;
    }
}

/// Bring the SSH profiles in line with which connections are shared.
///
/// A profile is shared exactly while at least one shared connection tunnels
/// through it — the user never toggles profiles directly. Joining moves its
/// secrets from the keychain into the session (the keychain entries go once
/// the vault holds them); leaving writes them back.
fn reconcile_ssh_profiles<R: Runtime>(
    app: &AppHandle<R>,
    state: &TeamShareState,
    profiles: &mut [SshConnection],
    wanted: &std::collections::HashSet<String>,
    plan: &mut KeychainPlan,
) -> Result<(), String> {
    let cache = app.state::<std::sync::Arc<crate::credential_cache::CredentialCache>>();

    for profile in profiles.iter_mut() {
        let is_shared = is_team(&profile.managed_by);
        // A profile owned by another source is left alone.
        if profile.managed_by.is_some() && !is_shared {
            continue;
        }
        let should_share = wanted.contains(&profile.id);
        if should_share == is_shared {
            continue;
        }
        if should_share {
            let mut secrets = SshSecrets::from_profile(profile);
            if profile.save_in_keychain.unwrap_or(false) {
                if let Ok(password) =
                    crate::credential_cache::get_ssh_password_cached(&cache, &profile.id)
                {
                    secrets.password = secrets::non_empty(Some(&password));
                }
                if let Ok(passphrase) =
                    crate::credential_cache::get_ssh_key_passphrase_cached(&cache, &profile.id)
                {
                    secrets.key_passphrase = secrets::non_empty(Some(&passphrase));
                }
            }
            if let Some(open) = state.write().as_mut() {
                open.secrets.ssh.insert(profile.id.clone(), secrets);
                open.generation += 1;
            }
            profile.managed_by = Some(SOURCE_ID.to_string());
            crate::managed::strip_ssh_secrets(profile);
            plan.forget_ssh.push(profile.id.clone());
            log::info!("[TeamShare] SSH profile {} joined the share", profile.id);
        } else {
            let secrets = state
                .read()
                .as_ref()
                .and_then(|u| u.secrets.ssh.get(&profile.id).cloned())
                .unwrap_or_default();
            profile.managed_by = None;
            secrets.apply_to(profile);
            if profile.save_in_keychain.unwrap_or(false) {
                plan.restored_ssh.push(profile.id.clone());
            }
            restore_ssh_credentials(app, profile)?;
            log::info!("[TeamShare] SSH profile {} left the share", profile.id);
        }
    }
    Ok(())
}

/// Delete the keychain entries of a connection that moved to the share.
fn forget_local_credentials<R: Runtime>(app: &AppHandle<R>, connection_id: &str) {
    let _ = crate::keychain_utils::delete_db_password(connection_id);
    let _ = crate::keychain_utils::delete_ssh_password(connection_id);
    let _ = crate::keychain_utils::delete_ssh_key_passphrase(connection_id);
    let _ = crate::keychain_utils::delete_connection_uri(connection_id);
    let cache = app.state::<std::sync::Arc<crate::credential_cache::CredentialCache>>();
    crate::credential_cache::invalidate_all_for_connection(&cache, connection_id);
}

/// Delete the keychain entries of an SSH profile that moved to the share.
fn forget_ssh_credentials<R: Runtime>(app: &AppHandle<R>, profile_id: &str) {
    let _ = crate::keychain_utils::delete_ssh_password(profile_id);
    let _ = crate::keychain_utils::delete_ssh_key_passphrase(profile_id);
    let cache = app.state::<std::sync::Arc<crate::credential_cache::CredentialCache>>();
    crate::credential_cache::invalidate_ssh_password(&cache, profile_id);
    crate::credential_cache::invalidate_ssh_key_passphrase(&cache, profile_id);
}

/// Put the credentials of a connection leaving the share back in the keychain.
fn restore_local_credentials<R: Runtime>(
    app: &AppHandle<R>,
    connection_id: &str,
    secrets: &EntrySecrets,
    connection: &mut SavedConnection,
) -> Result<(), String> {
    let cache = app.state::<std::sync::Arc<crate::credential_cache::CredentialCache>>();
    if let Some(password) = &secrets.password {
        crate::keychain_utils::set_db_password(connection_id, password)?;
        crate::credential_cache::set_db_password_cached(&cache, connection_id, password);
        connection.params.password = None;
    }
    if let Some(password) = &secrets.ssh_password {
        crate::keychain_utils::set_ssh_password(connection_id, password)?;
        crate::credential_cache::set_ssh_password_cached(&cache, connection_id, password);
        connection.params.ssh_password = None;
    }
    if let Some(passphrase) = &secrets.ssh_key_passphrase {
        crate::keychain_utils::set_ssh_key_passphrase(connection_id, passphrase)?;
        crate::credential_cache::set_ssh_key_passphrase_cached(&cache, connection_id, passphrase);
        connection.params.ssh_key_passphrase = None;
    }
    if let Some(uri) = &secrets.connection_uri {
        crate::keychain_utils::set_connection_uri(connection_id, uri)?;
        crate::credential_cache::set_connection_uri_cached(&cache, connection_id, uri);
        connection.params.connection_uri = None;
        connection.params.connection_uri_in_keychain = Some(true);
    }
    Ok(())
}

/// Move the credentials now on a profile leaving the share into the keychain,
/// when the profile asks for it. A profile that does not keeps them on itself,
/// as an ordinary local profile would.
fn restore_ssh_credentials<R: Runtime>(
    app: &AppHandle<R>,
    profile: &mut SshConnection,
) -> Result<(), String> {
    if !profile.save_in_keychain.unwrap_or(false) {
        return Ok(());
    }
    let cache = app.state::<std::sync::Arc<crate::credential_cache::CredentialCache>>();
    if let Some(password) = profile.password.take() {
        crate::keychain_utils::set_ssh_password(&profile.id, &password)?;
        crate::credential_cache::set_ssh_password_cached(&cache, &profile.id, &password);
    }
    if let Some(passphrase) = profile.key_passphrase.take() {
        crate::keychain_utils::set_ssh_key_passphrase(&profile.id, &passphrase)?;
        crate::credential_cache::set_ssh_key_passphrase_cached(&cache, &profile.id, &passphrase);
    }
    Ok(())
}
