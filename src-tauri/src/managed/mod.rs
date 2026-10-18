//! Connections owned by something other than this machine.
//!
//! A saved connection, SSH profile or K8s tunnel can carry
//! `managed_by: Some("<source id>")`. Its credentials then never come from the
//! OS keychain or the local files: core asks the source registered under that
//! id, through [`CredentialProvider`], and tells it about local edits through
//! [`ConnectionSource`]. Nothing in here knows what the source does with them —
//! the team share keeps them in an encrypted vault on a shared folder, a plugin
//! could keep them anywhere else.
//!
//! This is the whole surface core uses. Keeping it this narrow is what lets a
//! source move out of the core crate later (into a plugin, over RPC) without
//! touching the credential paths a second time.

use std::collections::HashMap;
use std::sync::Arc;

use tauri::{AppHandle, Manager, Runtime};

use crate::models::{ConnectionParams, ConnectionsFile, SavedConnection, SshConnection};

#[cfg(test)]
mod tests;

/// Which kind of record a change or a lookup is about.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ManagedKind {
    Connection,
    SshProfile,
    K8sTunnel,
}

/// Credentials the user just typed in an edit form, handed to the source.
///
/// Only what the form carries: an edit that leaves the password field
/// untouched sends no password, and the source keeps the one it has.
#[derive(Debug, Clone, Copy)]
pub enum TypedSecrets<'a> {
    Connection(&'a ConnectionParams),
    SshProfile {
        password: Option<&'a str>,
        key_passphrase: Option<&'a str>,
    },
}

/// What happened to a managed record on this machine.
#[derive(Debug, Clone, Copy)]
pub enum ManagedChange<'a> {
    /// The record was saved. `secrets` is `None` for a change that left the
    /// credentials alone: appearance, tags, the group it sits in, a K8s tunnel.
    Saved {
        secrets: Option<TypedSecrets<'a>>,
    },
    Deleted,
}

/// Resolves the secrets of the records a source manages.
///
/// A source may be *unavailable* — the team share is locked until the master
/// password is typed. Every method then fails rather than letting core fall
/// back to the keychain or a stale local copy.
pub trait CredentialProvider<R: Runtime>: Send + Sync {
    /// Whether the secrets can be provided right now.
    fn is_available(&self, app: &AppHandle<R>) -> bool;

    /// Fill in the secrets of a managed connection.
    fn connection_secrets(
        &self,
        app: &AppHandle<R>,
        connection: &mut SavedConnection,
    ) -> Result<(), String>;

    /// Fill in the secrets of a managed SSH profile.
    fn ssh_secrets(&self, app: &AppHandle<R>, profile: &mut SshConnection) -> Result<(), String>;

    /// The error for an action that needs the secrets while they are
    /// unavailable. The source may also ask the user to make them available.
    fn unavailable_error(&self, app: &AppHandle<R>, kind: ManagedKind) -> String;
}

/// Hears about local changes to the records a source manages.
pub trait ConnectionSource<R: Runtime>: Send + Sync {
    /// A managed record changed on this machine and is already on disk.
    ///
    /// Called from async commands, so it must return quickly: any I/O the
    /// source needs to propagate the change runs off the async workers.
    fn local_change(
        &self,
        app: &AppHandle<R>,
        kind: ManagedKind,
        id: &str,
        change: ManagedChange<'_>,
    );
}

/// A registered source: both halves.
pub trait ManagedSource<R: Runtime>: CredentialProvider<R> + ConnectionSource<R> {}

impl<R: Runtime, T: CredentialProvider<R> + ConnectionSource<R>> ManagedSource<R> for T {}

/// The sources this build knows about, by the id stored in `managed_by`.
/// Managed as Tauri state.
pub struct ManagedRegistry<R: Runtime> {
    sources: HashMap<&'static str, Arc<dyn ManagedSource<R>>>,
}

impl<R: Runtime> Default for ManagedRegistry<R> {
    fn default() -> Self {
        Self {
            sources: HashMap::new(),
        }
    }
}

impl<R: Runtime> ManagedRegistry<R> {
    pub fn with(mut self, id: &'static str, source: Arc<dyn ManagedSource<R>>) -> Self {
        self.sources.insert(id, source);
        self
    }

    pub fn get(&self, id: &str) -> Option<Arc<dyn ManagedSource<R>>> {
        self.sources.get(id).cloned()
    }
}

fn source<R: Runtime>(
    app: &AppHandle<R>,
    managed_by: &str,
) -> Result<Arc<dyn ManagedSource<R>>, String> {
    app.try_state::<ManagedRegistry<R>>()
        .and_then(|registry| registry.get(managed_by))
        .ok_or_else(|| missing_source_message(managed_by))
}

/// Error for a record whose source is not part of this build.
pub fn missing_source_message(managed_by: &str) -> String {
    format!(
        "This connection is managed by \"{managed_by}\", which is not available in this version of Tabularis."
    )
}

/// Fill in the secrets of a managed connection from its source. A connection
/// that is not managed is left untouched.
pub fn resolve_connection_secrets<R: Runtime>(
    app: &AppHandle<R>,
    connection: &mut SavedConnection,
) -> Result<(), String> {
    let Some(managed_by) = connection.managed_by.clone() else {
        return Ok(());
    };
    source(app, &managed_by)?.connection_secrets(app, connection)
}

/// Fill in the secrets of a managed SSH profile from its source. A profile
/// that is not managed is left untouched.
pub fn resolve_ssh_secrets<R: Runtime>(
    app: &AppHandle<R>,
    profile: &mut SshConnection,
) -> Result<(), String> {
    let Some(managed_by) = profile.managed_by.clone() else {
        return Ok(());
    };
    source(app, &managed_by)?.ssh_secrets(app, profile)
}

/// Fail unless the source of a managed record can take its secrets right now.
///
/// For edits: saving a form while the source is unavailable would drop the
/// credentials the user typed, so it is refused instead of silently succeeding.
pub fn require_available<R: Runtime>(
    app: &AppHandle<R>,
    managed_by: Option<&str>,
    kind: ManagedKind,
) -> Result<(), String> {
    let Some(managed_by) = managed_by else {
        return Ok(());
    };
    let source = source(app, managed_by)?;
    if source.is_available(app) {
        Ok(())
    } else {
        Err(source.unavailable_error(app, kind))
    }
}

/// Tell the source of a managed record that it changed here.
///
/// The single place core reports local changes, so a call site does not need
/// to know which source — if any — owns the record. No-op for a record that is
/// not managed, or whose source is not part of this build.
pub fn notify_managed_change<R: Runtime>(
    app: &AppHandle<R>,
    managed_by: Option<&str>,
    kind: ManagedKind,
    id: &str,
    change: ManagedChange<'_>,
) {
    let Some(managed_by) = managed_by else {
        return;
    };
    match source(app, managed_by) {
        Ok(source) => source.local_change(app, kind, id, change),
        Err(e) => log::warn!("[Managed] {kind:?} {id} changed: {e}"),
    }
}

/// `managed_by` of a connection in `file`, for call sites that only have its id.
pub fn connection_manager(file: &ConnectionsFile, id: &str) -> Option<String> {
    file.connections
        .iter()
        .find(|c| c.id == id)
        .and_then(|c| c.managed_by.clone())
}

/// Remove every secret from `params`, for the copy of a managed connection
/// that goes to disk.
pub fn strip_connection_secrets(params: &mut ConnectionParams) {
    params.password = None;
    params.ssh_password = None;
    params.ssh_key_passphrase = None;
    params.connection_uri = None;
    params.connection_uri_in_keychain = None;
}

/// Remove the secrets of an SSH profile, for the copy that goes to disk.
pub fn strip_ssh_secrets(profile: &mut SshConnection) {
    profile.password = None;
    profile.key_passphrase = None;
}

/// Error for a managed record used from outside the app (the MCP server runs
/// as its own process), where no source can be unlocked.
pub fn unavailable_outside_app_message(managed_by: &str, name: &str) -> String {
    match managed_by {
        "team-share" => format!(
            "Connection '{name}' is shared with your team: its credentials live in the team share, which only the Tabularis app can unlock. It cannot be used over MCP."
        ),
        other => format!(
            "Connection '{name}' is managed by \"{other}\": its credentials are only available inside the Tabularis app. It cannot be used over MCP."
        ),
    }
}
