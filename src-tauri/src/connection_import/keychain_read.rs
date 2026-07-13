//! Reads generic passwords from the OS credential store on macOS, used by
//! importers whose source app keeps secrets in the login Keychain (TablePlus,
//! Sequel Ace, DataGrip).
//!
//! On macOS a generic password is keyed by (service, account); the `keyring`
//! crate's `Entry::new(service, account)` maps to exactly that. Reading another
//! app's item triggers a per-item access prompt — expected behaviour, mirrored
//! from TablePro. On non-macOS platforms these source apps don't use a shared
//! keychain, so we report `NotFound` without touching the local store.

/// Outcome of a single keychain lookup. `Cancelled` means the user denied the
/// access prompt; callers stop prompting for the rest of the import.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum KeychainReadResult {
    Found(String),
    NotFound,
    Cancelled,
}

#[cfg(target_os = "macos")]
pub fn read_generic_password(service: &str, account: &str) -> KeychainReadResult {
    match keyring::Entry::new(service, account) {
        Ok(entry) => match entry.get_password() {
            Ok(value) => KeychainReadResult::Found(value),
            Err(keyring::Error::NoEntry) => KeychainReadResult::NotFound,
            Err(_) => {
                // Access denied / user cancelled / item not decryptable: treat
                // as cancellation so the caller stops issuing more prompts.
                KeychainReadResult::Cancelled
            }
        },
        Err(_) => KeychainReadResult::NotFound,
    }
}

#[cfg(not(target_os = "macos"))]
pub fn read_generic_password(_service: &str, _account: &str) -> KeychainReadResult {
    KeychainReadResult::NotFound
}
