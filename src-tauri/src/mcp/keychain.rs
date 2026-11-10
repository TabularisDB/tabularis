//! Keychain reads while MCP resolves a saved connection.
//!
//! The MCP server is usually started by another app (the MCP client), and the
//! keychain lookup can fail there while it works in the desktop app. A
//! swallowed read error then reaches the driver as a missing password and comes
//! back as an unrelated error such as `invalid configuration`, so a failed read
//! of a secret the connection needs is reported as what it is.

use super::protocol::JsonRpcError;

/// A secret MCP reads from the keychain, named in the error message.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum StoredSecret {
    Password,
    ConnectionUri,
    SshPassword,
    SshKeyPassphrase,
}

impl StoredSecret {
    fn label(self) -> &'static str {
        match self {
            StoredSecret::Password => "password",
            StoredSecret::ConnectionUri => "connection URI",
            StoredSecret::SshPassword => "SSH password",
            StoredSecret::SshKeyPassphrase => "SSH key passphrase",
        }
    }
}

/// Applies the result of a `keychain_utils::find_*` read for `owner` (for
/// example `connection "prod"`).
///
/// A missing entry is `None`, as before. A keychain failure is returned as an
/// MCP error when the connection cannot work without the secret (`required`);
/// otherwise it is logged and the secret stays unset.
pub(super) fn read_stored_secret(
    read: Result<Option<String>, String>,
    secret: StoredSecret,
    owner: &str,
    required: bool,
) -> Result<Option<String>, JsonRpcError> {
    match read {
        Ok(value) => Ok(value),
        Err(e) if required => Err(keychain_read_error(secret, owner, &e)),
        Err(e) => {
            eprintln!(
                "[MCP] Could not read the {} of {} from the OS keychain, continuing without it: {}",
                secret.label(),
                owner,
                e
            );
            Ok(None)
        }
    }
}

/// The MCP error for a failed keychain read: the keychain's own message plus
/// the workaround, instead of the driver's error for a missing secret.
pub(super) fn keychain_read_error(secret: StoredSecret, owner: &str, error: &str) -> JsonRpcError {
    let mut message = format!(
        "Could not read the {} of {} from the OS keychain: {}. The desktop app may still be able \
to read it: whether the lookup works can depend on how the MCP client started Tabularis, and it can be intermittent.",
        secret.label(),
        owner,
        error.trim_end_matches('.'),
    );
    // A connection URI can only be saved in the keychain, so there is no
    // setting to turn off for it.
    if secret != StoredSecret::ConnectionUri {
        message.push_str(&format!(
            " Turning off \"Save passwords in Keychain\" for {} avoids the lookup.",
            owner
        ));
    }
    JsonRpcError {
        code: -32000,
        message,
        data: None,
    }
}
