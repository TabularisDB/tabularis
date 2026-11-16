//! Encrypted file store for the OS-keyring entries, for hosts without a
//! Secret Service (containers, headless servers). `TABULARIS_SECRET_STORE=file`
//! installs it as the process-wide `keyring` backend, so every `Entry::new`
//! (runtime secrets, keychain helpers, backups) lands here unchanged.
//!
//! The key comes from `TABULARIS_SECRET_KEY` or `TABULARIS_SECRET_KEY_FILE`.
//! Without either, a random key is generated next to the store: secrets then
//! survive restarts but are only as protected as the volume holding both.

use std::any::Any;
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use keyring::credential::{Credential, CredentialApi, CredentialBuilderApi};
use serde::{Deserialize, Serialize};

use crate::export_crypto::{self, Sealed};

const STORE_ENV: &str = "TABULARIS_SECRET_STORE";
const KEY_ENV: &str = "TABULARIS_SECRET_KEY";
const KEY_FILE_ENV: &str = "TABULARIS_SECRET_KEY_FILE";
const PATH_ENV: &str = "TABULARIS_SECRET_STORE_PATH";
const STORE_FILE: &str = "secrets.enc.json";
const GENERATED_KEY_FILE: &str = "secrets.key";
const MIN_KEY_CHARS: usize = 16;
/// Encrypted with the derived key so a wrong key fails at startup instead of
/// on the first secret read.
const KEY_CHECK: &str = "tabularis-secret-store";

#[derive(Serialize, Deserialize)]
struct StoreFile {
    version: u32,
    salt: String,
    m_cost: u32,
    t_cost: u32,
    p_cost: u32,
    check: Sealed,
    #[serde(default)]
    entries: BTreeMap<String, Sealed>,
}

pub struct FileSecretStore {
    path: PathBuf,
    key: [u8; 32],
    file: Mutex<StoreFile>,
}

impl FileSecretStore {
    /// Opens the store at `path`, creating it on first use. Fails when the
    /// file exists but was written with another key.
    pub fn open(path: PathBuf, passphrase: &str) -> Result<Self, String> {
        if passphrase.chars().count() < MIN_KEY_CHARS {
            return Err(format!(
                "{KEY_ENV} must contain at least {MIN_KEY_CHARS} characters"
            ));
        }
        if path.exists() {
            let content = fs::read_to_string(&path)
                .map_err(|error| format!("Cannot read {}: {error}", path.display()))?;
            let file: StoreFile = serde_json::from_str(&content)
                .map_err(|error| format!("Cannot parse {}: {error}", path.display()))?;
            let salt = BASE64
                .decode(&file.salt)
                .map_err(|error| format!("Invalid secret store salt: {error}"))?;
            let key = export_crypto::derive_key(
                passphrase,
                &salt,
                file.m_cost,
                file.t_cost,
                file.p_cost,
            )?;
            if export_crypto::open_with_key(&key, &file.check).as_deref() != Ok(KEY_CHECK) {
                return Err(format!(
                    "The secret key does not match the secret store at {}",
                    path.display()
                ));
            }
            return Ok(Self {
                path,
                key,
                file: Mutex::new(file),
            });
        }

        let salt = export_crypto::random_salt();
        let (m_cost, t_cost, p_cost) = (
            export_crypto::ARGON2_M_COST,
            export_crypto::ARGON2_T_COST,
            export_crypto::ARGON2_P_COST,
        );
        let key = export_crypto::derive_key(passphrase, &salt, m_cost, t_cost, p_cost)?;
        let store = Self {
            path,
            key,
            file: Mutex::new(StoreFile {
                version: 1,
                salt: BASE64.encode(salt),
                m_cost,
                t_cost,
                p_cost,
                check: export_crypto::seal_with_key(&key, KEY_CHECK)?,
                entries: BTreeMap::new(),
            }),
        };
        store.persist(&store.lock())?;
        Ok(store)
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, StoreFile> {
        self.file.lock().unwrap_or_else(|error| error.into_inner())
    }

    fn get(&self, id: &str) -> Result<Option<Vec<u8>>, String> {
        let file = self.lock();
        let Some(sealed) = file.entries.get(id) else {
            return Ok(None);
        };
        let encoded = export_crypto::open_with_key(&self.key, sealed)?;
        BASE64
            .decode(encoded)
            .map(Some)
            .map_err(|error| format!("Corrupt secret store entry: {error}"))
    }

    fn set(&self, id: &str, secret: &[u8]) -> Result<(), String> {
        let sealed = export_crypto::seal_with_key(&self.key, &BASE64.encode(secret))?;
        let mut file = self.lock();
        let previous = file.entries.insert(id.to_string(), sealed);
        self.persist(&file).inspect_err(|_| {
            match previous {
                Some(previous) => file.entries.insert(id.to_string(), previous),
                None => file.entries.remove(id),
            };
        })
    }

    /// `Ok(false)` when there was nothing to delete.
    fn delete(&self, id: &str) -> Result<bool, String> {
        let mut file = self.lock();
        let Some(previous) = file.entries.remove(id) else {
            return Ok(false);
        };
        self.persist(&file).inspect_err(|_| {
            file.entries.insert(id.to_string(), previous);
        })?;
        Ok(true)
    }

    /// Writes through a private temp file and a rename, so a crash never
    /// leaves a truncated store.
    fn persist(&self, file: &StoreFile) -> Result<(), String> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let content = serde_json::to_vec_pretty(file).map_err(|error| error.to_string())?;
        let temporary = self.path.with_extension("tmp");
        crate::persistence::write_private_file(&temporary, content)?;
        fs::rename(&temporary, &self.path).map_err(|error| {
            let _ = fs::remove_file(&temporary);
            format!("Cannot write {}: {error}", self.path.display())
        })
    }
}

/// Installs the file store as the `keyring` backend when
/// `TABULARIS_SECRET_STORE=file`. Must run before the first `keyring::Entry`.
pub fn install_from_env() -> Result<(), String> {
    match std::env::var(STORE_ENV).as_deref() {
        Err(_) | Ok("") | Ok("keyring") => return Ok(()),
        Ok("file") => {}
        Ok(other) => {
            return Err(format!(
                "Unknown {STORE_ENV} '{other}' (expected 'keyring' or 'file')"
            ))
        }
    }
    let directory = crate::paths::get_app_data_dir();
    let path = std::env::var_os(PATH_ENV)
        .filter(|path| !path.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| directory.join(STORE_FILE));
    let passphrase = resolve_passphrase(&directory, &path)?;
    let store = FileSecretStore::open(path.clone(), &passphrase)?;
    log::info!("Storing secrets in the encrypted file {}", path.display());
    keyring::set_default_credential_builder(Box::new(FileCredentialBuilder(Arc::new(store))));
    Ok(())
}

fn resolve_passphrase(directory: &Path, store_path: &Path) -> Result<String, String> {
    // Compose and Helm pass unset values as empty strings.
    if let Some(key) = std::env::var(KEY_ENV).ok().filter(|key| !key.is_empty()) {
        return Ok(key);
    }
    if let Some(path) = std::env::var_os(KEY_FILE_ENV).filter(|path| !path.is_empty()) {
        let path = PathBuf::from(path);
        return fs::read_to_string(&path)
            .map(|key| key.trim_end_matches(['\r', '\n']).to_string())
            .map_err(|error| format!("Cannot read {KEY_FILE_ENV} {}: {error}", path.display()));
    }
    generated_key(directory, store_path)
}

/// The key generated on first start, reused afterwards.
fn generated_key(directory: &Path, store_path: &Path) -> Result<String, String> {
    use std::io::Write;
    fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    // Keep the lock file: replacing its inode would let concurrent starts take different locks.
    let mut options = fs::OpenOptions::new();
    options.read(true).write(true).create(true).truncate(false);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let lock = options
        .open(directory.join(".secrets-key.lock"))
        .map_err(|error| error.to_string())?;
    fs2::FileExt::lock_exclusive(&lock).map_err(|error| error.to_string())?;
    let path = directory.join(GENERATED_KEY_FILE);
    match fs::read_to_string(&path) {
        Ok(key)
            if BASE64
                .decode(key.trim())
                .is_ok_and(|bytes| bytes.len() == 32) =>
        {
            return Ok(key.trim().to_string())
        }
        Ok(_) => {
            if store_path.try_exists().map_err(|error| {
                format!(
                    "Cannot inspect encrypted secret store {}: {error}",
                    store_path.display()
                )
            })? {
                return Err(format!("Generated key {} is incomplete. Restore the original key from backup; the existing secret store was not changed", path.display()));
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            if store_path.try_exists().map_err(|error| {
                format!(
                    "Cannot inspect encrypted secret store {}: {error}",
                    store_path.display()
                )
            })? {
                return Err(format!("Generated key {} is missing. Restore the original key from backup; the existing secret store was not changed", path.display()));
            }
        }
        Err(error) => {
            return Err(format!(
                "Cannot read generated key {}: {error}",
                path.display()
            ))
        }
    }
    let mut bytes = [0u8; 32];
    use aes_gcm::aead::rand_core::RngCore;
    aes_gcm::aead::OsRng.fill_bytes(&mut bytes);
    let key = BASE64.encode(bytes);
    let mut pending =
        tempfile::NamedTempFile::new_in(directory).map_err(|error| error.to_string())?;
    pending
        .write_all(key.as_bytes())
        .map_err(|error| error.to_string())?;
    pending
        .as_file()
        .sync_all()
        .map_err(|error| error.to_string())?;
    pending.persist(&path).map_err(|error| error.to_string())?;
    log::warn!(
        "No {KEY_ENV} set; generated {}. Anyone who can read the data volume can read the stored secrets",
        path.display()
    );
    Ok(key)
}

struct FileCredentialBuilder(Arc<FileSecretStore>);

impl CredentialBuilderApi for FileCredentialBuilder {
    fn build(
        &self,
        target: Option<&str>,
        service: &str,
        user: &str,
    ) -> keyring::Result<Box<Credential>> {
        Ok(Box::new(FileCredential {
            store: self.0.clone(),
            id: format!("{}\u{0}{}\u{0}{user}", target.unwrap_or_default(), service),
        }))
    }

    fn as_any(&self) -> &dyn Any {
        self
    }
}

struct FileCredential {
    store: Arc<FileSecretStore>,
    id: String,
}

impl std::fmt::Debug for FileCredential {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("FileCredential").finish_non_exhaustive()
    }
}

fn platform_error(error: String) -> keyring::Error {
    keyring::Error::PlatformFailure(error.into())
}

impl CredentialApi for FileCredential {
    fn set_secret(&self, secret: &[u8]) -> keyring::Result<()> {
        self.store.set(&self.id, secret).map_err(platform_error)
    }

    fn get_secret(&self) -> keyring::Result<Vec<u8>> {
        self.store
            .get(&self.id)
            .map_err(platform_error)?
            .ok_or(keyring::Error::NoEntry)
    }

    fn delete_credential(&self) -> keyring::Result<()> {
        match self.store.delete(&self.id).map_err(platform_error)? {
            true => Ok(()),
            false => Err(keyring::Error::NoEntry),
        }
    }

    fn as_any(&self) -> &dyn Any {
        self
    }
}

#[cfg(test)]
#[path = "secret_store_tests.rs"]
mod tests;
