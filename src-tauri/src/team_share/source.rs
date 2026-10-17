//! The team share as core sees it: a [`crate::managed`] source registered
//! under [`super::SOURCE_ID`].
//!
//! Lookups read the unlocked secrets and never wait for the shared folder;
//! local changes are recorded in memory and pushed from a blocking thread.

use tauri::{AppHandle, Manager, Runtime};

use crate::managed::{
    ConnectionSource, CredentialProvider, ManagedChange, ManagedKind, TypedSecrets,
};
use crate::models::{SavedConnection, SshConnection};

use super::secrets::SshSecrets;
use super::{request_unlock_prompt, schedule_push, TeamShareState};

/// Zero-sized: everything lives in [`TeamShareState`].
pub struct TeamShareSource;

impl<R: Runtime> CredentialProvider<R> for TeamShareSource {
    fn is_available(&self, app: &AppHandle<R>) -> bool {
        app.state::<TeamShareState>().read().is_some()
    }

    fn connection_secrets(
        &self,
        app: &AppHandle<R>,
        connection: &mut SavedConnection,
    ) -> Result<(), String> {
        let state = app.state::<TeamShareState>();
        let unlocked = state.read();
        let Some(open) = unlocked.as_ref() else {
            drop(unlocked);
            // Ask for the master password instead of leaving the user with a
            // dead end: the prompt is what they actually need at this point.
            request_unlock_prompt(app, false);
            return Err(
                "This connection is shared with your team. Unlock the team share with the master password to use it."
                    .to_string(),
            );
        };
        match open.secrets.connections.get(&connection.id) {
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

    fn ssh_secrets(&self, app: &AppHandle<R>, profile: &mut SshConnection) -> Result<(), String> {
        let state = app.state::<TeamShareState>();
        let unlocked = state.read();
        let Some(open) = unlocked.as_ref() else {
            drop(unlocked);
            request_unlock_prompt(app, false);
            return Err(
                "This SSH tunnel is shared with your team. Unlock the team share with the master password to use it."
                    .to_string(),
            );
        };
        match open.secrets.ssh.get(&profile.id) {
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

    fn unavailable_error(&self, app: &AppHandle<R>, kind: ManagedKind) -> String {
        request_unlock_prompt(app, true);
        let what = match kind {
            ManagedKind::Connection => "connection",
            ManagedKind::SshProfile => "SSH tunnel",
            ManagedKind::K8sTunnel => "Kubernetes tunnel",
        };
        format!(
            "This {what} is shared with your team and the team share is locked. Unlock it with the master password before editing, so the changes reach the team."
        )
    }
}

impl<R: Runtime> ConnectionSource<R> for TeamShareSource {
    fn local_change(
        &self,
        app: &AppHandle<R>,
        kind: ManagedKind,
        id: &str,
        change: ManagedChange<'_>,
    ) {
        let state = app.state::<TeamShareState>();
        {
            let mut unlocked = state.write();
            let Some(open) = unlocked.as_mut() else {
                // Only changes without credentials get here while locked —
                // edits that carry some are refused upstream. They are already
                // on disk and go out with the first sync after the unlock.
                log::info!(
                    "[TeamShare] {kind:?} {id} changed while the team share is locked; it will be synced after the next unlock"
                );
                return;
            };
            match (kind, change) {
                (
                    ManagedKind::Connection,
                    ManagedChange::Saved {
                        secrets: Some(TypedSecrets::Connection(params)),
                    },
                ) => {
                    open.secrets
                        .connections
                        .entry(id.to_string())
                        .or_default()
                        .overlay(params);
                    open.generation += 1;
                }
                (
                    ManagedKind::SshProfile,
                    ManagedChange::Saved {
                        secrets:
                            Some(TypedSecrets::SshProfile {
                                password,
                                key_passphrase,
                            }),
                    },
                ) => {
                    open.secrets
                        .ssh
                        .entry(id.to_string())
                        .or_default()
                        .overlay(&SshSecrets::from_typed(password, key_passphrase));
                    open.generation += 1;
                }
                (ManagedKind::Connection, ManagedChange::Deleted) => {
                    open.secrets.connections.remove(id);
                    open.generation += 1;
                }
                (ManagedKind::SshProfile, ManagedChange::Deleted) => {
                    open.secrets.ssh.remove(id);
                    open.generation += 1;
                }
                // Metadata only: the files already say everything.
                _ => {}
            }
        }
        schedule_push(app);
    }
}
