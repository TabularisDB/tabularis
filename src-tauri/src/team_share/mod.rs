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
//! - Shared connections are materialized into the local `connections.json`
//!   **without their secrets** and flagged `shared`, so every existing screen
//!   (the connection list, groups, tags) keeps working untouched.
//! - The secrets live in memory only, for as long as the vault is unlocked.
//!   They are never written to the local file and never put in the OS
//!   keychain, so closing the app forgets them: the master password is asked
//!   again on the next launch.
//! - [`crate::commands::find_connection_by_id`] asks this module for the
//!   secrets of a shared connection instead of reading the keychain. While the
//!   vault is locked that call fails, which is what makes a locked share
//!   unusable rather than silently falling back to a stale local copy.
//!
//! Concurrency: the share is touched only inside [`sync`], which takes a lock
//! file, reads, merges, writes when something changed, and releases. Nothing
//! is kept open between two operations, and the merge ([`merge`]) is a
//! three-way merge against the last synced state so two members writing
//! around the same time cannot drop each other's connections.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use zeroize::Zeroizing;
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::models::{
    ConnectionParams, ConnectionsFile, SavedConnection, SshConnection, SshConnectionInput,
};
use crate::persistence;

pub mod merge;
pub mod vault;

#[cfg(test)]
mod tests;

use merge::{MergeContext, MergeOutcome, TOMBSTONE_RETENTION_DAYS};
use vault::{
    VaultEntry, VaultFile, VaultGroup, VaultK8sProfile, VaultPayload, VaultSshProfile, VaultTag,
};

/// Event emitted after the local connections were changed by a sync, so the
/// frontend reloads them.
pub const SYNCED_EVENT: &str = "team-share-synced";

/// Event emitted when something asked for a shared connection's credentials
/// while the vault was locked. The frontend opens the master-password prompt
/// on it, so hitting a shared connection after dismissing the prompt at
/// startup asks again instead of only reporting an error.
pub const LOCKED_EVENT: &str = "team-share-locked";

/// The credentials of one shared connection. Kept apart from the connection
/// itself so it is obvious which fields never reach the local file.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct EntrySecrets {
    pub password: Option<String>,
    pub ssh_password: Option<String>,
    pub ssh_key_passphrase: Option<String>,
    pub connection_uri: Option<String>,
}

impl EntrySecrets {
    pub fn from_params(params: &ConnectionParams) -> Self {
        Self {
            password: non_empty(params.password.as_deref()),
            ssh_password: non_empty(params.ssh_password.as_deref()),
            ssh_key_passphrase: non_empty(params.ssh_key_passphrase.as_deref()),
            connection_uri: non_empty(params.connection_uri.as_deref()),
        }
    }

    pub fn apply_to(&self, params: &mut ConnectionParams) {
        params.password = self.password.clone();
        params.ssh_password = self.ssh_password.clone();
        params.ssh_key_passphrase = self.ssh_key_passphrase.clone();
        params.connection_uri = self.connection_uri.clone();
    }

    /// Overwrite only the secrets `params` actually carries.
    ///
    /// An edit that leaves the password field untouched sends no password
    /// back, and must not wipe the one the team is using. This mirrors the
    /// keychain path, which likewise only writes the secrets it was given.
    /// Turning the SSH tunnel off is the one removal that is unambiguous, so
    /// it does drop the SSH secrets.
    pub fn overlay(&mut self, params: &ConnectionParams) {
        let incoming = Self::from_params(params);
        if incoming.password.is_some() {
            self.password = incoming.password;
        }
        if incoming.connection_uri.is_some() {
            self.connection_uri = incoming.connection_uri;
        }
        if params.ssh_enabled.unwrap_or(false) {
            if incoming.ssh_password.is_some() {
                self.ssh_password = incoming.ssh_password;
            }
            if incoming.ssh_key_passphrase.is_some() {
                self.ssh_key_passphrase = incoming.ssh_key_passphrase;
            }
        } else {
            self.ssh_password = None;
            self.ssh_key_passphrase = None;
        }
    }

    /// Remove every secret from `params`, for the copy that goes to disk.
    pub fn strip(params: &mut ConnectionParams) {
        params.password = None;
        params.ssh_password = None;
        params.ssh_key_passphrase = None;
        params.connection_uri = None;
        params.connection_uri_in_keychain = None;
    }
}

/// The credentials of one shared SSH profile. Same idea as [`EntrySecrets`],
/// for the two secrets an SSH profile owns.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SshSecrets {
    pub password: Option<String>,
    pub key_passphrase: Option<String>,
}

impl SshSecrets {
    pub fn from_profile(profile: &SshConnection) -> Self {
        Self {
            password: non_empty(profile.password.as_deref()),
            key_passphrase: non_empty(profile.key_passphrase.as_deref()),
        }
    }

    pub fn apply_to(&self, profile: &mut SshConnection) {
        profile.password = self.password.clone();
        profile.key_passphrase = self.key_passphrase.clone();
    }

    /// Read the secrets out of a profile form submission.
    ///
    /// Taken before the caller moves the form's fields into the profile it
    /// saves, so the push to the share still has them.
    pub fn from_input(input: &SshConnectionInput) -> Self {
        Self {
            password: non_empty(input.password.as_deref()),
            key_passphrase: non_empty(input.key_passphrase.as_deref()),
        }
    }

    /// Overwrite only what the caller supplied, for the same reason
    /// [`EntrySecrets::overlay`] does.
    pub fn overlay(&mut self, incoming: &SshSecrets) {
        if incoming.password.is_some() {
            self.password = incoming.password.clone();
        }
        if incoming.key_passphrase.is_some() {
            self.key_passphrase = incoming.key_passphrase.clone();
        }
    }

    pub fn strip(profile: &mut SshConnection) {
        profile.password = None;
        profile.key_passphrase = None;
    }
}

fn non_empty(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string)
}

/// An unlocked vault, for the lifetime of the app session.
///
/// Wiped on drop — locking the vault, leaving the share or closing the app
/// must not leave the master key or the team's credentials lying in freed
/// memory.
struct Session {
    /// Master key derived once at unlock. Deriving it costs 64 MiB of Argon2,
    /// so it is not recomputed per operation.
    key: Zeroizing<[u8; 32]>,
    path: PathBuf,
    /// Payload of the last successful sync: the base of the three-way merge.
    base: VaultPayload,
    /// Credentials of the shared connections as this machine currently sees
    /// them. Seeded by a sync, replaced when the user edits a shared
    /// connection.
    secrets: HashMap<String, EntrySecrets>,
    /// Same, for the SSH profiles those connections tunnel through.
    ssh_secrets: HashMap<String, SshSecrets>,
    revision: u64,
    updated_at: String,
    updated_by: String,
}

/// Managed state. Holds nothing at all until the user unlocks the vault.
#[derive(Default)]
pub struct TeamShareState {
    session: Mutex<Option<Session>>,
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
// Configuration
// ---------------------------------------------------------------------------

/// Vault path recorded in `config.json`, if any.
pub fn configured_path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    crate::config::load_config_internal(app)
        .team_share_path
        .map(PathBuf::from)
        .filter(|p| !p.as_os_str().is_empty())
}

fn set_configured_path<R: Runtime>(
    app: &AppHandle<R>,
    path: Option<&Path>,
) -> Result<(), String> {
    let mut config = crate::config::load_config_internal(app);
    config.team_share_path = path.map(|p| p.to_string_lossy().into_owned());
    crate::config::persist_config(app, &config)
}

// ---------------------------------------------------------------------------
// Local state <-> vault payload
// ---------------------------------------------------------------------------

fn connections_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    crate::commands::get_config_path(app)
}

fn ssh_connections_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    crate::commands::get_ssh_config_path(app)
}

fn base_cache_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let dir = crate::config::get_config_dir(app).ok_or("Could not resolve config directory")?;
    Ok(dir.join(vault::BASE_CACHE_FILENAME))
}

/// Persist the merge base for the next session. Best effort: a base that
/// could not be written only costs a redundant push next time.
fn write_base_cache<R: Runtime>(
    app: &AppHandle<R>,
    session: &Session,
    payload: &VaultPayload,
) {
    let write = || -> Result<(), String> {
        let cache = vault::seal_base_cache(&session.key, session.revision, payload)?;
        let json = serde_json::to_string_pretty(&cache).map_err(|e| e.to_string())?;
        std::fs::write(base_cache_path(app)?, json).map_err(|e| e.to_string())
    };
    if let Err(e) = write() {
        log::warn!("[TeamShare] Could not cache the merge base: {e}");
    }
}

/// Build the payload describing what this machine holds right now: the
/// connections flagged `shared`, with their in-memory credentials, plus the
/// groups and tags they need.
fn local_payload<R: Runtime>(app: &AppHandle<R>, session: &Session) -> Result<VaultPayload, String> {
    let file = persistence::load_connections_file(&connections_path(app)?)?;

    let mut entries = Vec::new();
    for connection in file.connections.iter().filter(|c| c.is_shared()) {
        let mut params = connection.params.clone();
        params.connection_id = None;
        if let Some(secrets) = session.secrets.get(&connection.id) {
            secrets.apply_to(&mut params);
        }
        let previous = find_entry(&session.base, &connection.id);
        entries.push(VaultEntry {
            id: connection.id.clone(),
            name: connection.name.clone(),
            params,
            group_id: connection.group_id.clone(),
            tag_ids: connection.tag_ids.clone(),
            environment: connection.environment.clone(),
            detect_json_in_text_columns: connection.detect_json_in_text_columns,
            appearance: vault::strip_local_appearance(connection.appearance.as_ref()),
            // Stamps are rewritten by the merge whenever the content actually
            // differs, so carrying the previous ones over keeps an untouched
            // record byte-identical to its base.
            updated_at: previous
                .map(|e| e.updated_at.clone())
                .unwrap_or_else(vault::now_timestamp),
            updated_by: previous
                .map(|e| e.updated_by.clone())
                .unwrap_or_else(vault::current_actor),
            deleted: false,
        });
    }

    // A group is on the share exactly while it holds a shared connection,
    // directly or through a descendant — the ancestor chain comes along so the
    // hierarchy is not orphaned. A group that loses its last shared connection
    // drops out here and is tombstoned by the merge, so the team does not
    // accumulate empty folders.
    let shared_group_ids: Vec<&str> = entries
        .iter()
        .filter_map(|e| e.group_id.as_deref())
        .collect();
    let wanted_groups = crate::models::collect_group_ancestors(&file.groups, shared_group_ids);

    let groups = file
        .groups
        .iter()
        .filter(|g| wanted_groups.contains(&g.id))
        .map(|g| VaultGroup {
            group: g.clone(),
            updated_at: find_group(&session.base, &g.id)
                .map(|v| v.updated_at.clone())
                .unwrap_or_else(vault::now_timestamp),
            deleted: false,
        })
        .collect();

    // Same rule for tags: only the ones a shared connection actually wears.
    let wanted_tags: HashSet<String> = entries
        .iter()
        .flat_map(|e| e.tag_ids.iter().flatten())
        .cloned()
        .collect();

    let tags = file
        .tags
        .iter()
        .filter(|t| wanted_tags.contains(&t.id))
        .map(|t| VaultTag {
            tag: t.clone(),
            updated_at: find_tag(&session.base, &t.id)
                .map(|v| v.updated_at.clone())
                .unwrap_or_else(vault::now_timestamp),
            deleted: false,
        })
        .collect();

    // SSH profiles the shared connections tunnel through, plus the ones
    // already on the share that still exist here — same rule as groups, so
    // unsharing the last connection using a profile does not delete it for
    // the team.
    let mut wanted_ssh: HashSet<String> = entries
        .iter()
        .filter(|entry| entry.params.ssh_enabled.unwrap_or(false))
        .filter_map(|entry| entry.params.ssh_connection_id.clone())
        .collect();
    wanted_ssh.extend(session.base.ssh_profiles.iter().map(|p| p.profile.id.clone()));

    let ssh_profiles = persistence::load_ssh_connections_file(&ssh_connections_path(app)?)?
        .into_iter()
        .filter(|profile| wanted_ssh.contains(&profile.id))
        .map(|profile| {
            let previous = find_ssh_profile(&session.base, &profile.id);
            let mut profile = profile;
            if let Some(secrets) = session.ssh_secrets.get(&profile.id) {
                secrets.apply_to(&mut profile);
            }
            VaultSshProfile {
                profile,
                updated_at: previous
                    .map(|p| p.updated_at.clone())
                    .unwrap_or_else(vault::now_timestamp),
                updated_by: previous
                    .map(|p| p.updated_by.clone())
                    .unwrap_or_else(vault::current_actor),
                deleted: false,
            }
        })
        .collect();

    // Same rule again for the Kubernetes tunnels the shared connections use.
    let mut wanted_k8s: HashSet<String> = entries
        .iter()
        .filter(|entry| entry.params.k8s_enabled.unwrap_or(false))
        .filter_map(|entry| entry.params.k8s_connection_id.clone())
        .collect();
    wanted_k8s.extend(session.base.k8s_profiles.iter().map(|p| p.profile.id.clone()));

    let k8s_profiles = crate::commands::load_k8s_connections(app)?
        .into_iter()
        .filter(|profile| wanted_k8s.contains(&profile.id))
        .map(|profile| {
            let previous = find_k8s_profile(&session.base, &profile.id);
            VaultK8sProfile {
                profile,
                updated_at: previous
                    .map(|p| p.updated_at.clone())
                    .unwrap_or_else(vault::now_timestamp),
                updated_by: previous
                    .map(|p| p.updated_by.clone())
                    .unwrap_or_else(vault::current_actor),
                deleted: false,
            }
        })
        .collect();

    Ok(VaultPayload {
        entries,
        groups,
        tags,
        ssh_profiles,
        k8s_profiles,
    })
}

fn find_entry<'a>(payload: &'a VaultPayload, id: &str) -> Option<&'a VaultEntry> {
    payload.entries.iter().find(|e| e.id == id)
}

fn find_group<'a>(payload: &'a VaultPayload, id: &str) -> Option<&'a VaultGroup> {
    payload.groups.iter().find(|g| g.group.id == id)
}

fn find_tag<'a>(payload: &'a VaultPayload, id: &str) -> Option<&'a VaultTag> {
    payload.tags.iter().find(|t| t.tag.id == id)
}

fn find_ssh_profile<'a>(payload: &'a VaultPayload, id: &str) -> Option<&'a VaultSshProfile> {
    payload.ssh_profiles.iter().find(|p| p.profile.id == id)
}

fn find_k8s_profile<'a>(payload: &'a VaultPayload, id: &str) -> Option<&'a VaultK8sProfile> {
    payload.k8s_profiles.iter().find(|p| p.profile.id == id)
}

/// Write the merged payload into the local `connections.json`, keeping the
/// secrets out of it, and return them for the in-memory map.
///
/// Local-only decoration (`appearance`, `sort_order`) survives, so a member's
/// own colours are not overwritten by a teammate's sync.
type MaterializedSecrets = (HashMap<String, EntrySecrets>, HashMap<String, SshSecrets>);

fn materialize<R: Runtime>(
    app: &AppHandle<R>,
    payload: &VaultPayload,
) -> Result<MaterializedSecrets, String> {
    let path = connections_path(app)?;
    let mut file: ConnectionsFile = persistence::load_connections_file(&path)?;
    let mut secrets = HashMap::new();

    for entry in &payload.entries {
        if entry.deleted {
            // Only ever drop a connection that came from the share; a local
            // connection that happens to share an id is left alone.
            file.connections
                .retain(|c| c.id != entry.id || !c.is_shared());
            continue;
        }
        secrets.insert(entry.id.clone(), EntrySecrets::from_params(&entry.params));

        let mut params = entry.params.clone();
        EntrySecrets::strip(&mut params);
        params.connection_id = None;

        let existing = file.connections.iter().find(|c| c.id == entry.id);
        let connection = SavedConnection {
            id: entry.id.clone(),
            name: entry.name.clone(),
            params,
            group_id: entry.group_id.clone(),
            // Ordering stays a per-member preference; the look does not.
            sort_order: existing.and_then(|c| c.sort_order),
            detect_json_in_text_columns: entry.detect_json_in_text_columns,
            appearance: vault::merge_appearance(
                entry.appearance.as_ref(),
                existing.and_then(|c| c.appearance.as_ref()),
            ),
            tag_ids: entry.tag_ids.clone(),
            environment: entry.environment.clone(),
            shared: Some(true),
        };
        match file.connections.iter_mut().find(|c| c.id == entry.id) {
            Some(slot) => *slot = connection,
            None => file.connections.push(connection),
        }
    }

    for group in &payload.groups {
        let id = &group.group.id;
        if group.deleted {
            file.groups.retain(|g| &g.id != id);
            // Do not leave local connections pointing at a group that is gone.
            for connection in &mut file.connections {
                if connection.group_id.as_ref() == Some(id) {
                    connection.group_id = None;
                }
            }
            continue;
        }
        match file.groups.iter_mut().find(|g| &g.id == id) {
            Some(slot) => *slot = group.group.clone(),
            None => file.groups.push(group.group.clone()),
        }
    }

    for tag in &payload.tags {
        let id = &tag.tag.id;
        if tag.deleted {
            file.tags.retain(|t| &t.id != id);
            for connection in &mut file.connections {
                if let Some(ids) = connection.tag_ids.as_mut() {
                    ids.retain(|t| t != id);
                }
            }
            continue;
        }
        match file.tags.iter_mut().find(|t| &t.id == id) {
            Some(slot) => *slot = tag.tag.clone(),
            None => file.tags.push(tag.tag.clone()),
        }
    }

    crate::commands::save_connections_and_invalidate(app, &path, &file)?;

    let ssh_secrets = materialize_ssh_profiles(app, payload)?;
    materialize_k8s_profiles(app, payload)?;
    Ok((secrets, ssh_secrets))
}

/// Mirror the shared Kubernetes tunnels into the local `k8s_connections.json`.
/// Simpler than the SSH counterpart because there are no secrets to hold back.
fn materialize_k8s_profiles<R: Runtime>(
    app: &AppHandle<R>,
    payload: &VaultPayload,
) -> Result<(), String> {
    if payload.k8s_profiles.is_empty() {
        return Ok(());
    }
    let mut profiles = crate::commands::load_k8s_connections(app)?;

    for shared in &payload.k8s_profiles {
        let id = &shared.profile.id;
        if shared.deleted {
            profiles.retain(|p| &p.id != id || !p.is_shared());
            continue;
        }
        let mut profile = shared.profile.clone();
        profile.shared = Some(true);
        match profiles.iter_mut().find(|p| &p.id == id) {
            Some(slot) => *slot = profile,
            None => profiles.push(profile),
        }
    }

    crate::commands::save_k8s_connections(app, &profiles)
}

/// Mirror the shared SSH profiles into the local `ssh_connections.json`,
/// keeping their secrets out of it, and return those secrets for the
/// in-memory map.
fn materialize_ssh_profiles<R: Runtime>(
    app: &AppHandle<R>,
    payload: &VaultPayload,
) -> Result<HashMap<String, SshSecrets>, String> {
    let path = ssh_connections_path(app)?;
    let mut profiles = persistence::load_ssh_connections_file(&path)?;
    let mut secrets = HashMap::new();

    for shared in &payload.ssh_profiles {
        let id = &shared.profile.id;
        if shared.deleted {
            // Only drop a profile that came from the share; a local profile
            // that happens to share an id is left alone.
            profiles.retain(|p| &p.id != id || !p.is_shared());
            continue;
        }
        secrets.insert(id.clone(), SshSecrets::from_profile(&shared.profile));

        let mut profile = shared.profile.clone();
        SshSecrets::strip(&mut profile);
        profile.shared = Some(true);
        match profiles.iter_mut().find(|p| &p.id == id) {
            Some(slot) => *slot = profile,
            None => profiles.push(profile),
        }
    }

    persistence::save_ssh_connections_file(&path, &profiles)?;
    Ok(secrets)
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

/// One read-merge-write cycle against the share.
///
/// The lock is taken for the whole cycle, but the cycle is short: the master
/// key is already derived, so this is a file read, a symmetric decrypt, an
/// in-memory merge and at most one write. The share is never left locked
/// while waiting for the user.
fn sync_session<R: Runtime>(
    app: &AppHandle<R>,
    session: &mut Session,
) -> Result<SyncReport, String> {
    let local = local_payload(app, session)?;

    let _lock = vault::VaultLock::acquire(&session.path)?;
    let mut file = vault::read(&session.path)?
        .ok_or("The shared vault file is no longer on the share.")?;
    if !vault::verify_key(&file, &session.key) {
        return Err(
            "The master password no longer opens this vault — it was re-created by a teammate."
                .to_string(),
        );
    }
    let remote = vault::open_payload(&file, &session.key)?;

    let ctx = merge_context();
    let (merged, notes) = merge::merge_payload(&session.base, &remote, &local, &ctx);

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
    drop(_lock);

    let (secrets, ssh_secrets) = materialize(app, &merged)?;
    session.secrets = secrets;
    session.ssh_secrets = ssh_secrets;
    session.revision = file.revision;
    session.updated_at = file.updated_at.clone();
    session.updated_by = file.updated_by.clone();
    report.revision = file.revision;
    write_base_cache(app, session, &merged);
    session.base = merged;

    log::info!(
        "[TeamShare] Sync done: {} pulled, {} pushed, {} conflict(s), {} removed",
        report.pulled,
        report.pushed,
        report.conflicts,
        report.removed
    );
    let _ = app.emit(SYNCED_EVENT, &report);
    Ok(report)
}

// ---------------------------------------------------------------------------
// Entry points used by the rest of the backend
// ---------------------------------------------------------------------------

/// Attach the credentials of a shared connection, from the unlocked vault.
///
/// Fails while the vault is locked: a shared connection must not fall back to
/// anything else.
pub fn attach_secrets<R: Runtime>(
    app: &AppHandle<R>,
    connection: &mut SavedConnection,
) -> Result<(), String> {
    let state = app.state::<TeamShareState>();
    let guard = state.session.lock().unwrap();
    let Some(session) = guard.as_ref() else {
        // Ask for the master password instead of leaving the user with a
        // dead end: the prompt is what they actually need at this point.
        let _ = app.emit(LOCKED_EVENT, ());
        return Err(
            "This connection is shared with your team. Unlock the team share with the master password to use it."
                .to_string(),
        );
    };
    match session.secrets.get(&connection.id) {
        Some(secrets) => {
            secrets.apply_to(&mut connection.params);
            Ok(())
        }
        None => Err(
            "This connection is shared with your team but is not in the shared vault yet. Sync the team share and try again."
                .to_string(),
        ),
    }
}

/// Attach the credentials of a shared SSH profile, from the unlocked vault.
///
/// Same contract as [`attach_secrets`]: while the vault is locked this fails
/// rather than falling back to the keychain.
pub fn attach_ssh_secrets<R: Runtime>(
    app: &AppHandle<R>,
    profile: &mut SshConnection,
) -> Result<(), String> {
    let state = app.state::<TeamShareState>();
    let guard = state.session.lock().unwrap();
    let Some(session) = guard.as_ref() else {
        let _ = app.emit(LOCKED_EVENT, ());
        return Err(
            "This SSH tunnel is shared with your team. Unlock the team share with the master password to use it."
                .to_string(),
        );
    };
    match session.ssh_secrets.get(&profile.id) {
        Some(secrets) => {
            secrets.apply_to(profile);
            Ok(())
        }
        None => Err(
            "This SSH tunnel is shared with your team but is not in the shared vault yet. Sync the team share and try again."
                .to_string(),
        ),
    }
}

/// Record the credentials the user just typed for a shared SSH profile and
/// push the change to the share. Best effort, like [`push_local_change`].
pub fn push_local_ssh_change<R: Runtime>(
    app: &AppHandle<R>,
    profile_id: &str,
    input: Option<&SshSecrets>,
) {
    let state = app.state::<TeamShareState>();
    let mut guard = state.session.lock().unwrap();
    let Some(session) = guard.as_mut() else {
        log::warn!(
            "[TeamShare] SSH profile {profile_id} changed while the team share is locked; it will be pushed after the next unlock"
        );
        return;
    };
    match input {
        Some(input) => session
            .ssh_secrets
            .entry(profile_id.to_string())
            .or_default()
            .overlay(input),
        None => {
            session.ssh_secrets.remove(profile_id);
        }
    }
    if let Err(e) = sync_session(app, session) {
        log::warn!("[TeamShare] Could not push the SSH profile change to the share: {e}");
    }
}

/// Push a change to a shared connection that left its credentials alone —
/// appearance, tags, the group it sits in.
///
/// No-op when the connection is not shared or the vault is locked, so callers
/// can fire it unconditionally after saving. Best effort like the other push:
/// the local change is already on disk, and an unreachable share must not fail
/// it.
pub fn push_metadata_change<R: Runtime>(app: &AppHandle<R>, connection_id: &str) {
    let is_shared = connections_path(app)
        .ok()
        .and_then(|path| persistence::load_connections_file(&path).ok())
        .is_some_and(|file| {
            file.connections
                .iter()
                .any(|c| c.id == connection_id && c.is_shared())
        });
    if !is_shared {
        return;
    }

    let state = app.state::<TeamShareState>();
    let mut guard = state.session.lock().unwrap();
    let Some(session) = guard.as_mut() else {
        return;
    };
    if let Err(e) = sync_session(app, session) {
        log::warn!("[TeamShare] Could not push the change to the share: {e}");
    }
}

/// Record the credentials the user just typed for a shared connection and push
/// the change to the share.
///
/// Best effort on the push: the local file was already written by the caller,
/// so a share that is offline must not fail the edit. The change is picked up
/// by the next sync.
pub fn push_local_change<R: Runtime>(
    app: &AppHandle<R>,
    connection_id: &str,
    params: Option<&ConnectionParams>,
) {
    let state = app.state::<TeamShareState>();
    let mut guard = state.session.lock().unwrap();
    let Some(session) = guard.as_mut() else {
        log::warn!(
            "[TeamShare] Connection {connection_id} changed while the team share is locked; it will be pushed after the next unlock"
        );
        return;
    };
    match params {
        Some(params) => session
            .secrets
            .entry(connection_id.to_string())
            .or_default()
            .overlay(params),
        None => {
            session.secrets.remove(connection_id);
        }
    }
    if let Err(e) = sync_session(app, session) {
        log::warn!("[TeamShare] Could not push the change to the share: {e}");
    }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

fn status<R: Runtime>(app: &AppHandle<R>, last_sync: Option<SyncReport>) -> TeamShareStatus {
    let configured = configured_path(app);
    let state = app.state::<TeamShareState>();
    let guard = state.session.lock().unwrap();
    let shared_connection_ids: Vec<String> = connections_path(app)
        .ok()
        .and_then(|path| persistence::load_connections_file(&path).ok())
        .map(|file| {
            file.connections
                .iter()
                .filter(|c| c.is_shared())
                .map(|c| c.id.clone())
                .collect()
        })
        .unwrap_or_default();

    TeamShareStatus {
        configured: configured.is_some(),
        vault_exists: configured.as_deref().map(Path::is_file).unwrap_or(false),
        path: configured.map(|p| p.to_string_lossy().into_owned()),
        unlocked: guard.is_some(),
        revision: guard.as_ref().map(|s| s.revision),
        updated_at: guard.as_ref().map(|s| s.updated_at.clone()),
        updated_by: guard.as_ref().map(|s| s.updated_by.clone()),
        shared_connection_ids,
        last_sync,
    }
}

#[tauri::command]
pub fn get_team_share_status<R: Runtime>(app: AppHandle<R>) -> TeamShareStatus {
    status(&app, None)
}

/// Point Tabularis at a vault and unlock it with `master_password`.
///
/// When `path` has no vault yet a new one is created and sealed with that
/// password. When it does, the password must open it — a wrong one is
/// rejected here and nothing is shared.
#[tauri::command]
pub fn setup_team_share<R: Runtime>(
    app: AppHandle<R>,
    path: String,
    master_password: String,
) -> Result<TeamShareStatus, String> {
    if master_password.trim().is_empty() {
        return Err("The master password must not be empty.".to_string());
    }
    let vault_path = vault::resolve_vault_path(Path::new(&path));
    if !vault_path.is_absolute() {
        return Err("The shared folder must be an absolute path.".to_string());
    }

    let existing = vault::read(&vault_path)?;
    let (file, created) = match existing {
        Some(file) => (file, false),
        None => {
            let kdf = vault::KdfParams::default();
            let key = vault::derive_key(&master_password, &kdf)?;
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

    let key = vault::derive_key(&master_password, &file.kdf)?;
    if !vault::verify_key(&file, &key) {
        return Err(
            "Wrong master password for this shared vault. The shared credentials stay locked."
                .to_string(),
        );
    }

    set_configured_path(&app, Some(&vault_path))?;
    log::info!(
        "[TeamShare] {} vault at {}",
        if created { "Created" } else { "Joined" },
        vault_path.display()
    );
    open_session(&app, key, vault_path, &file)
}

/// Unlock the configured vault for this session.
#[tauri::command]
pub fn unlock_team_share<R: Runtime>(
    app: AppHandle<R>,
    master_password: String,
) -> Result<TeamShareStatus, String> {
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
    // file never holds them, so without this seeding the first sync would see
    // every shared connection as "credentials removed here" and push that
    // emptiness back onto the team.
    let secrets: HashMap<String, EntrySecrets> = remote
        .entries
        .iter()
        .filter(|entry| !entry.deleted)
        .map(|entry| (entry.id.clone(), EntrySecrets::from_params(&entry.params)))
        .collect();
    let ssh_secrets: HashMap<String, SshSecrets> = remote
        .ssh_profiles
        .iter()
        .filter(|profile| !profile.deleted)
        .map(|profile| {
            (
                profile.profile.id.clone(),
                SshSecrets::from_profile(&profile.profile),
            )
        })
        .collect();
    // The base written by the previous session is what makes a deletion
    // distinguishable from a teammate's addition. Losing it is not fatal: the
    // merge then treats both sides as new, which re-adds a connection deleted
    // while the vault was locked but never drops one.
    let base = vault::read_base_cache(&base_cache_path(app)?, &key).unwrap_or_default();

    let mut session = Session {
        key,
        path,
        base,
        secrets,
        ssh_secrets,
        revision: file.revision,
        updated_at: file.updated_at.clone(),
        updated_by: file.updated_by.clone(),
    };
    let report = sync_session(app, &mut session)?;
    let state = app.state::<TeamShareState>();
    *state.session.lock().unwrap() = Some(session);
    Ok(status(app, Some(report)))
}

/// Forget the master key and the shared credentials for this session. The
/// shared connections stay in the list but cannot be used until the next
/// unlock.
#[tauri::command]
pub fn lock_team_share<R: Runtime>(app: AppHandle<R>) -> TeamShareStatus {
    {
        let state = app.state::<TeamShareState>();
        *state.session.lock().unwrap() = None;
    }
    log::info!("[TeamShare] Vault locked");
    status(&app, None)
}

/// Read the share, merge, and write back when something changed here.
#[tauri::command]
pub fn sync_team_share<R: Runtime>(app: AppHandle<R>) -> Result<TeamShareStatus, String> {
    let state = app.state::<TeamShareState>();
    let mut guard = state.session.lock().unwrap();
    let session = guard
        .as_mut()
        .ok_or("The team share is locked. Unlock it with the master password first.")?;
    let report = sync_session(&app, session)?;
    drop(guard);
    Ok(status(&app, Some(report)))
}

/// Stop using the team share on this machine.
///
/// The vault on the share is left untouched: other members keep working. When
/// `keep_connections` is set the shared connections stay in the local list as
/// ordinary connections *without* their credentials, which the user has to
/// retype; otherwise they are removed.
#[tauri::command]
pub fn disable_team_share<R: Runtime>(
    app: AppHandle<R>,
    keep_connections: bool,
) -> Result<TeamShareStatus, String> {
    let path = connections_path(&app)?;
    let mut file = persistence::load_connections_file(&path)?;
    if keep_connections {
        for connection in file.connections.iter_mut().filter(|c| c.is_shared()) {
            connection.shared = None;
        }
    } else {
        file.connections.retain(|c| !c.is_shared());
    }
    crate::commands::save_connections_and_invalidate(&app, &path, &file)?;

    // The SSH profiles that came with the share follow the same rule. Their
    // secrets were in the vault, not in the keychain, so a kept profile is
    // left without credentials for the user to retype.
    let ssh_path = ssh_connections_path(&app)?;
    let mut profiles = persistence::load_ssh_connections_file(&ssh_path)?;
    if keep_connections {
        for profile in profiles.iter_mut().filter(|p| p.is_shared()) {
            profile.shared = None;
        }
    } else {
        profiles.retain(|p| !p.is_shared());
    }
    persistence::save_ssh_connections_file(&ssh_path, &profiles)?;

    // The K8s tunnels follow the same rule, minus the credentials question.
    let mut k8s = crate::commands::load_k8s_connections(&app)?;
    if keep_connections {
        for profile in k8s.iter_mut().filter(|p| p.is_shared()) {
            profile.shared = None;
        }
    } else {
        k8s.retain(|p| !p.is_shared());
    }
    crate::commands::save_k8s_connections(&app, &k8s)?;

    {
        let state = app.state::<TeamShareState>();
        *state.session.lock().unwrap() = None;
    }
    // The base cache holds the shared credentials, encrypted. Nothing on this
    // machine should keep them once the share is no longer in use.
    if let Ok(cache) = base_cache_path(&app) {
        let _ = std::fs::remove_file(cache);
    }
    set_configured_path(&app, None)?;
    log::info!("[TeamShare] Team share disabled on this machine");
    let _ = app.emit(SYNCED_EVENT, SyncReport::default());
    Ok(status(&app, None))
}

/// Move connections into the share, or take them back out.
///
/// Sharing reads the credentials each connection has right now (keychain
/// included) into the vault and then deletes the local keychain entries: from
/// that moment the share is the only place those credentials live, which is
/// what makes the master password actually gate them. Unsharing does the
/// reverse, writing them back to the keychain when the connection asks for it.
///
/// Takes a list rather than one id so a multi-selection costs a single
/// read-merge-write against the share instead of one per connection.
#[tauri::command]
pub fn set_connections_shared<R: Runtime>(
    app: AppHandle<R>,
    connection_ids: Vec<String>,
    shared: bool,
) -> Result<TeamShareStatus, String> {
    let state = app.state::<TeamShareState>();
    let mut guard = state.session.lock().unwrap();
    let session = guard
        .as_mut()
        .ok_or("The team share is locked. Unlock it with the master password first.")?;

    let path = connections_path(&app)?;
    let mut file = persistence::load_connections_file(&path)?;

    // Keep only the connections whose flag actually changes. Skipping the
    // no-ops also avoids calling `find_connection_by_id` for an already-shared
    // connection, which would come back here for its secrets while this lock
    // is held.
    let targets: Vec<String> = connection_ids
        .into_iter()
        .filter(|id| {
            file.connections
                .iter()
                .any(|c| &c.id == id && c.is_shared() != shared)
        })
        .collect();
    if targets.is_empty() {
        drop(guard);
        return Ok(status(&app, None));
    }

    if shared {
        // Resolve the credentials while the connections are still local, so
        // whatever is in the keychain travels with them.
        for id in &targets {
            let resolved = crate::commands::find_connection_by_id(&app, id)?;
            session
                .secrets
                .insert(id.clone(), EntrySecrets::from_params(&resolved.params));
        }
        for id in &targets {
            if let Some(connection) = file.connections.iter_mut().find(|c| &c.id == id) {
                connection.shared = Some(true);
                EntrySecrets::strip(&mut connection.params);
            }
        }
    } else {
        for id in &targets {
            let secrets = session.secrets.remove(id).unwrap_or_default();
            let Some(connection) = file.connections.iter_mut().find(|c| &c.id == id) else {
                continue;
            };
            connection.shared = None;
            secrets.apply_to(&mut connection.params);
            // `save_connections_file` keeps a plaintext password out of the
            // file only for keychain-backed connections, so write the keychain
            // entries before saving.
            if connection.params.save_in_keychain.unwrap_or(false) {
                restore_local_credentials(&app, id, &secrets, connection)?;
            }
        }
    }

    // The SSH profiles and K8s tunnels follow the connections that use them.
    reconcile_ssh_profiles(&app, session, &file)?;
    reconcile_k8s_profiles(&app, &file)?;

    crate::commands::save_connections_and_invalidate(&app, &path, &file)?;
    if shared {
        for id in &targets {
            forget_local_credentials(&app, id);
        }
    }

    let report = sync_session(&app, session)?;
    drop(guard);
    Ok(status(&app, Some(report)))
}

/// Bring `ssh_connections.json` in line with which connections are shared.
///
/// A profile is shared exactly while at least one shared connection tunnels
/// through it — the user never toggles profiles directly. Joining moves its
/// secrets from the keychain into the session, leaving frees them back.
fn reconcile_ssh_profiles<R: Runtime>(
    app: &AppHandle<R>,
    session: &mut Session,
    file: &ConnectionsFile,
) -> Result<(), String> {
    let wanted: HashSet<String> = file
        .connections
        .iter()
        .filter(|c| c.is_shared() && c.params.ssh_enabled.unwrap_or(false))
        .filter_map(|c| c.params.ssh_connection_id.clone())
        .collect();

    let path = ssh_connections_path(app)?;
    let mut profiles = persistence::load_ssh_connections_file(&path)?;
    let cache = app.state::<std::sync::Arc<crate::credential_cache::CredentialCache>>();
    let mut changed = false;

    for profile in profiles.iter_mut() {
        let should_share = wanted.contains(&profile.id);
        if should_share == profile.is_shared() {
            continue;
        }
        changed = true;
        if should_share {
            // Read the tunnel secrets out of the keychain before they are
            // deleted from it.
            let mut secrets = SshSecrets::from_profile(profile);
            if profile.save_in_keychain.unwrap_or(false) {
                if let Ok(password) =
                    crate::credential_cache::get_ssh_password_cached(&cache, &profile.id)
                {
                    secrets.password = non_empty(Some(&password));
                }
                if let Ok(passphrase) =
                    crate::credential_cache::get_ssh_key_passphrase_cached(&cache, &profile.id)
                {
                    secrets.key_passphrase = non_empty(Some(&passphrase));
                }
            }
            session.ssh_secrets.insert(profile.id.clone(), secrets);
            profile.shared = Some(true);
            SshSecrets::strip(profile);
            let _ = crate::keychain_utils::delete_ssh_password(&profile.id);
            let _ = crate::keychain_utils::delete_ssh_key_passphrase(&profile.id);
            crate::credential_cache::invalidate_ssh_password(&cache, &profile.id);
            crate::credential_cache::invalidate_ssh_key_passphrase(&cache, &profile.id);
            log::info!("[TeamShare] SSH profile {} joined the share", profile.id);
        } else {
            let secrets = session.ssh_secrets.remove(&profile.id).unwrap_or_default();
            profile.shared = None;
            secrets.apply_to(profile);
            if profile.save_in_keychain.unwrap_or(false) {
                if let Some(password) = &secrets.password {
                    crate::keychain_utils::set_ssh_password(&profile.id, password)?;
                    crate::credential_cache::set_ssh_password_cached(
                        &cache,
                        &profile.id,
                        password,
                    );
                    profile.password = None;
                }
                if let Some(passphrase) = &secrets.key_passphrase {
                    crate::keychain_utils::set_ssh_key_passphrase(&profile.id, passphrase)?;
                    crate::credential_cache::set_ssh_key_passphrase_cached(
                        &cache,
                        &profile.id,
                        passphrase,
                    );
                    profile.key_passphrase = None;
                }
            }
            log::info!("[TeamShare] SSH profile {} left the share", profile.id);
        }
    }

    if changed {
        persistence::save_ssh_connections_file(&path, &profiles)?;
    }
    Ok(())
}

/// Bring `k8s_connections.json` in line with which connections are shared.
///
/// The K8s counterpart of [`reconcile_ssh_profiles`], and a much shorter one:
/// a tunnel holds no credentials, so joining or leaving the share is only a
/// flag.
fn reconcile_k8s_profiles<R: Runtime>(
    app: &AppHandle<R>,
    file: &ConnectionsFile,
) -> Result<(), String> {
    let wanted: HashSet<String> = file
        .connections
        .iter()
        .filter(|c| c.is_shared() && c.params.k8s_enabled.unwrap_or(false))
        .filter_map(|c| c.params.k8s_connection_id.clone())
        .collect();

    let mut profiles = crate::commands::load_k8s_connections(app)?;
    let mut changed = false;
    for profile in profiles.iter_mut() {
        let should_share = wanted.contains(&profile.id);
        if should_share == profile.is_shared() {
            continue;
        }
        profile.shared = should_share.then_some(true);
        changed = true;
        log::info!(
            "[TeamShare] K8s tunnel {} {} the share",
            profile.id,
            if should_share { "joined" } else { "left" }
        );
    }

    if changed {
        crate::commands::save_k8s_connections(app, &profiles)?;
    }
    Ok(())
}

/// Delete the keychain entries of a connection that just moved to the share.
fn forget_local_credentials<R: Runtime>(app: &AppHandle<R>, connection_id: &str) {
    let _ = crate::keychain_utils::delete_db_password(connection_id);
    let _ = crate::keychain_utils::delete_ssh_password(connection_id);
    let _ = crate::keychain_utils::delete_ssh_key_passphrase(connection_id);
    let _ = crate::keychain_utils::delete_connection_uri(connection_id);
    let cache = app.state::<std::sync::Arc<crate::credential_cache::CredentialCache>>();
    crate::credential_cache::invalidate_all_for_connection(&cache, connection_id);
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
