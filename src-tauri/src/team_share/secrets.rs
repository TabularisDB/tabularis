//! The credentials of shared records, as held in memory while the share is
//! unlocked.
//!
//! Both types wipe their strings on drop: locking the share, leaving it or
//! closing the app must not leave the team's credentials in freed memory.

use zeroize::Zeroize;

use crate::models::{ConnectionParams, SshConnection, SshConnectionInput};

/// The credentials of one shared connection. Kept apart from the connection
/// itself so it is obvious which fields never reach the local file.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct EntrySecrets {
    pub password: Option<String>,
    pub ssh_password: Option<String>,
    pub ssh_key_passphrase: Option<String>,
    pub connection_uri: Option<String>,
}

impl Drop for EntrySecrets {
    fn drop(&mut self) {
        self.password.zeroize();
        self.ssh_password.zeroize();
        self.ssh_key_passphrase.zeroize();
        self.connection_uri.zeroize();
    }
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
        let mut incoming = Self::from_params(params);
        if incoming.password.is_some() {
            self.password = incoming.password.take();
        }
        if incoming.connection_uri.is_some() {
            self.connection_uri = incoming.connection_uri.take();
        }
        if params.ssh_enabled.unwrap_or(false) {
            if incoming.ssh_password.is_some() {
                self.ssh_password = incoming.ssh_password.take();
            }
            if incoming.ssh_key_passphrase.is_some() {
                self.ssh_key_passphrase = incoming.ssh_key_passphrase.take();
            }
        } else {
            self.ssh_password.zeroize();
            self.ssh_password = None;
            self.ssh_key_passphrase.zeroize();
            self.ssh_key_passphrase = None;
        }
    }
}

/// The credentials of one shared SSH profile. Same idea as [`EntrySecrets`],
/// for the two secrets an SSH profile owns.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SshSecrets {
    pub password: Option<String>,
    pub key_passphrase: Option<String>,
}

impl Drop for SshSecrets {
    fn drop(&mut self) {
        self.password.zeroize();
        self.key_passphrase.zeroize();
    }
}

impl SshSecrets {
    pub fn from_profile(profile: &SshConnection) -> Self {
        Self {
            password: non_empty(profile.password.as_deref()),
            key_passphrase: non_empty(profile.key_passphrase.as_deref()),
        }
    }

    /// Read the secrets out of what an edit form submitted.
    pub fn from_typed(password: Option<&str>, key_passphrase: Option<&str>) -> Self {
        Self {
            password: non_empty(password),
            key_passphrase: non_empty(key_passphrase),
        }
    }

    /// Read the secrets out of a profile form submission.
    pub fn from_input(input: &SshConnectionInput) -> Self {
        Self::from_typed(input.password.as_deref(), input.key_passphrase.as_deref())
    }

    pub fn apply_to(&self, profile: &mut SshConnection) {
        profile.password = self.password.clone();
        profile.key_passphrase = self.key_passphrase.clone();
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
}

pub(crate) fn non_empty(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string)
}
