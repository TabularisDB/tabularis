use keyring::Entry;

use crate::sandbox::{self, Sandbox};

const SERVICE_NAME: &str = "tabularis";

/// Advice appended to keychain failures inside the Snap package.
///
/// `password-manager-service` is declared as a plug but is not auto-connected
/// by default, so every Secret Service call is refused by AppArmor until the
/// user (or the Snap Store, once auto-connection is granted) connects it.
pub const SNAP_KEYCHAIN_HINT: &str = "The snap sandbox is blocking access to the system keychain. \
Run `sudo snap connect tabularis:password-manager-service` and restart Tabularis.";

/// Converts a keyring failure into the message surfaced to the frontend.
///
/// Delegates to [`describe_error`] with the sandbox of the running process.
pub fn keychain_error(err: keyring::Error) -> String {
    describe_error(&err, sandbox::current())
}

/// Pure formatter behind [`keychain_error`].
///
/// A platform failure inside a snap is almost always the missing
/// `password-manager-service` connection, so the message tells the user how
/// to fix it instead of leaving them with a raw D-Bus/AppArmor error. Every
/// other error keeps the keyring crate's own description.
pub fn describe_error(err: &keyring::Error, sandbox: Option<Sandbox>) -> String {
    let message = err.to_string();
    match (err, sandbox) {
        (keyring::Error::PlatformFailure(_), Some(Sandbox::Snap)) => {
            format!("{message}. {SNAP_KEYCHAIN_HINT}")
        }
        _ => message,
    }
}

pub fn set_db_password(connection_id: &str, password: &str) -> Result<(), String> {
    eprintln!("[Keychain] Setting DB password for {}", connection_id);
    let entry =
        Entry::new(SERVICE_NAME, &format!("{}:db", connection_id)).map_err(|e| e.to_string())?;
    entry.set_password(password).map_err(|e| {
        eprintln!("[Keychain] Error setting password: {}", e);
        keychain_error(e)
    })
}

pub fn get_db_password(connection_id: &str, connection_name: &str) -> Result<String, String> {
    if connection_name.is_empty() {
        eprintln!("[Keychain] Getting DB password for {}", connection_id);
    } else {
        eprintln!(
            "[Keychain] Getting DB password for {} ({})",
            connection_name, connection_id
        );
    }
    let entry =
        Entry::new(SERVICE_NAME, &format!("{}:db", connection_id)).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(pwd) => {
            eprintln!("[Keychain] Password found for {}", connection_id);
            Ok(pwd)
        }
        Err(e) => {
            eprintln!(
                "[Keychain] Error getting password for {}: {}",
                connection_id, e
            );
            Err(keychain_error(e))
        }
    }
}

pub fn delete_db_password(connection_id: &str) -> Result<(), String> {
    let entry =
        Entry::new(SERVICE_NAME, &format!("{}:db", connection_id)).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(_) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(keychain_error(e)),
    }
}

pub fn set_connection_uri(connection_id: &str, connection_uri: &str) -> Result<(), String> {
    let entry = Entry::new(SERVICE_NAME, &format!("{}:connection_uri", connection_id))
        .map_err(|e| e.to_string())?;
    entry.set_password(connection_uri).map_err(keychain_error)
}

pub fn get_connection_uri(connection_id: &str) -> Result<String, String> {
    let entry = Entry::new(SERVICE_NAME, &format!("{}:connection_uri", connection_id))
        .map_err(|e| e.to_string())?;
    entry.get_password().map_err(keychain_error)
}

pub fn delete_connection_uri(connection_id: &str) -> Result<(), String> {
    let entry = Entry::new(SERVICE_NAME, &format!("{}:connection_uri", connection_id))
        .map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(_) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(keychain_error(e)),
    }
}

pub fn set_ssh_password(connection_id: &str, password: &str) -> Result<(), String> {
    eprintln!("[Keychain] Setting SSH password for {}", connection_id);
    let entry =
        Entry::new(SERVICE_NAME, &format!("{}:ssh", connection_id)).map_err(|e| e.to_string())?;
    entry.set_password(password).map_err(|e| {
        eprintln!("[Keychain] Error setting SSH password: {}", e);
        keychain_error(e)
    })
}

pub fn get_ssh_password(connection_id: &str, connection_name: &str) -> Result<String, String> {
    if connection_name.is_empty() {
        eprintln!("[Keychain] Getting SSH password for {}", connection_id);
    } else {
        eprintln!(
            "[Keychain] Getting SSH password for {} ({})",
            connection_name, connection_id
        );
    }
    let entry =
        Entry::new(SERVICE_NAME, &format!("{}:ssh", connection_id)).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(pwd) => {
            eprintln!("[Keychain] SSH Password found for {}", connection_id);
            Ok(pwd)
        }
        Err(e) => {
            eprintln!(
                "[Keychain] Error getting SSH password for {}: {}",
                connection_id, e
            );
            Err(keychain_error(e))
        }
    }
}

pub fn delete_ssh_password(connection_id: &str) -> Result<(), String> {
    let entry =
        Entry::new(SERVICE_NAME, &format!("{}:ssh", connection_id)).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(_) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(keychain_error(e)),
    }
}

pub fn set_ssh_key_passphrase(connection_id: &str, passphrase: &str) -> Result<(), String> {
    eprintln!(
        "[Keychain] Setting SSH key passphrase for {}",
        connection_id
    );
    let entry = Entry::new(SERVICE_NAME, &format!("{}:ssh_passphrase", connection_id))
        .map_err(|e| e.to_string())?;
    entry.set_password(passphrase).map_err(|e| {
        eprintln!("[Keychain] Error setting SSH key passphrase: {}", e);
        keychain_error(e)
    })
}

pub fn get_ssh_key_passphrase(
    connection_id: &str,
    connection_name: &str,
) -> Result<String, String> {
    if connection_name.is_empty() {
        eprintln!(
            "[Keychain] Getting SSH key passphrase for {}",
            connection_id
        );
    } else {
        eprintln!(
            "[Keychain] Getting SSH key passphrase for {} ({})",
            connection_name, connection_id
        );
    }
    let entry = Entry::new(SERVICE_NAME, &format!("{}:ssh_passphrase", connection_id))
        .map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(pwd) => {
            eprintln!("[Keychain] SSH key passphrase found for {}", connection_id);
            Ok(pwd)
        }
        Err(e) => {
            eprintln!(
                "[Keychain] Error getting SSH key passphrase for {}: {}",
                connection_id, e
            );
            Err(keychain_error(e))
        }
    }
}

pub fn delete_ssh_key_passphrase(connection_id: &str) -> Result<(), String> {
    let entry = Entry::new(SERVICE_NAME, &format!("{}:ssh_passphrase", connection_id))
        .map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(_) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(keychain_error(e)),
    }
}

pub fn set_ai_key(provider: &str, key: &str) -> Result<(), String> {
    eprintln!("[Keychain] Setting AI key for {}", provider);
    let entry =
        Entry::new(SERVICE_NAME, &format!("ai_key:{}", provider)).map_err(|e| e.to_string())?;
    entry.set_password(key).map_err(|e| {
        eprintln!("[Keychain] Error setting AI key: {}", e);
        keychain_error(e)
    })
}

/// Read an AI key from the keychain.
///
/// Returns `Ok(Some(key))` when present, `Ok(None)` when the keychain
/// definitively has no such entry (`NoEntry`), and `Err` only for genuine /
/// transient failures (access denied, prompt timeout, securityd error, ...).
/// Distinguishing the two lets the cache layer avoid storing a transient
/// failure as a permanent "absent" — which would otherwise make a configured
/// key appear missing until the app restarts.
pub fn get_ai_key(provider: &str) -> Result<Option<String>, String> {
    #[cfg(debug_assertions)]
    log::info!("[Keychain] Getting AI key for {}", provider);
    let entry =
        Entry::new(SERVICE_NAME, &format!("ai_key:{}", provider)).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(pwd) => Ok(Some(pwd)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => {
            eprintln!("[Keychain] Error getting AI key for {}: {}", provider, e);
            Err(keychain_error(e))
        }
    }
}

pub fn delete_ai_key(provider: &str) -> Result<(), String> {
    let entry =
        Entry::new(SERVICE_NAME, &format!("ai_key:{}", provider)).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(_) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(keychain_error(e)),
    }
}
