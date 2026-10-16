use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    path::PathBuf,
};

#[derive(Serialize, Deserialize)]
pub(super) struct Store {
    pub host_id: String,
    pub active_profile_id: Option<String>,
    pub profiles: Vec<Profile>,
}

impl Default for Store {
    fn default() -> Self {
        Self {
            host_id: format!("urn:uuid:{}", uuid::Uuid::new_v4()),
            active_profile_id: None,
            profiles: vec![],
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
pub(super) struct Profile {
    pub id: String,
    pub label: String,
    pub client_id: String,
    pub subject: Option<String>,
    pub email: Option<String>,
    pub tokens: Option<Tokens>,
}

#[derive(Clone, Serialize, Deserialize)]
pub(super) struct Tokens {
    pub access_token: String,
    pub refresh_token: String,
    pub id_token: String,
    pub scope: String,
    pub expires_at: u64,
    pub earliest_refresh_at: Option<u64>,
}

impl Tokens {
    pub fn sharing(&self) -> bool {
        self.scope
            .split_whitespace()
            .any(|s| s == super::PLAN_SCOPE)
    }
}

pub(super) struct LockedStore {
    path: PathBuf,
    _lock: File,
}

pub(super) fn session(state: &Store) -> super::ChatGptSession {
    super::ChatGptSession {
        active_profile_id: state.active_profile_id.clone(),
        profiles: state
            .profiles
            .iter()
            .map(|p| super::ChatGptProfile {
                id: p.id.clone(),
                label: p.label.clone(),
                email: p.email.clone(),
                connected: p.tokens.is_some(),
                sharing: p.tokens.as_ref().is_some_and(|t| t.sharing()),
            })
            .collect(),
    }
}

impl LockedStore {
    pub fn open() -> Result<Self, String> {
        let dir = crate::paths::get_app_config_dir();
        fs::create_dir_all(&dir).map_err(|_| "Could not create ChatGPT storage.")?;
        let mut options = OpenOptions::new();
        options.read(true).write(true).create(true).truncate(false);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let lock = options
            .open(dir.join("chatgpt.lock"))
            .map_err(|_| "Could not lock ChatGPT storage.")?;
        lock.try_lock_exclusive()
            .map_err(|_| "ChatGPT is in use by another Tabularis process.")?;
        Ok(Self {
            path: dir.join("chatgpt.enc"),
            _lock: lock,
        })
    }

    fn key(&self, create: bool) -> Result<Vec<u8>, String> {
        // Only a short encryption key goes in the OS keychain, including on Windows.
        let encoded = match crate::keychain_utils::get_ai_key("chatgpt-storage")? {
            Some(key) => key,
            None if create => {
                let mut key = [0u8; 32];
                openssl::rand::rand_bytes(&mut key)
                    .map_err(|_| "Could not generate a ChatGPT storage key.")?;
                let encoded = URL_SAFE_NO_PAD.encode(key);
                crate::keychain_utils::set_ai_key("chatgpt-storage", &encoded)?;
                encoded
            }
            None => return Err("ChatGPT storage key is missing from the system keychain.".into()),
        };
        let key = URL_SAFE_NO_PAD
            .decode(encoded)
            .map_err(|_| "Invalid ChatGPT storage key.")?;
        if key.len() != 32 {
            return Err("Invalid ChatGPT storage key.".into());
        }
        Ok(key)
    }

    pub fn load(&self) -> Result<Store, String> {
        let data = match fs::read(&self.path) {
            Ok(data) => data,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Store::default()),
            Err(_) => return Err("Could not read ChatGPT storage.".into()),
        };
        let plain = decrypt(&self.key(false)?, &data)?;
        serde_json::from_slice(&plain).map_err(|_| "Invalid ChatGPT storage.".into())
    }

    pub fn save(&self, store: &Store) -> Result<(), String> {
        let plain = serde_json::to_vec(store).map_err(|_| "Could not encode ChatGPT storage.")?;
        let data = encrypt(&self.key(!self.path.exists())?, &plain)?;
        let mut file = tempfile::NamedTempFile::new_in(
            self.path.parent().ok_or("Invalid ChatGPT storage path.")?,
        )
        .map_err(|_| "Could not create ChatGPT storage file.")?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            file.as_file()
                .set_permissions(fs::Permissions::from_mode(0o600))
                .map_err(|_| "Could not protect ChatGPT storage.")?;
        }
        file.write_all(&data)
            .and_then(|_| file.as_file().sync_all())
            .map_err(|_| "Could not write ChatGPT storage.")?;
        file.persist(&self.path)
            .map_err(|_| "Could not replace ChatGPT storage.")?;
        Ok(())
    }
}

pub(super) fn encrypt(key: &[u8], plain: &[u8]) -> Result<Vec<u8>, String> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| "Invalid ChatGPT storage key.")?;
    let mut nonce = [0u8; 12];
    openssl::rand::rand_bytes(&mut nonce).map_err(|_| "Could not generate storage nonce.")?;
    let encrypted = cipher
        .encrypt(Nonce::from_slice(&nonce), plain)
        .map_err(|_| "Could not encrypt ChatGPT storage.")?;
    let mut data = b"TCG1".to_vec();
    data.extend(nonce);
    data.extend(encrypted);
    Ok(data)
}

pub(super) fn decrypt(key: &[u8], data: &[u8]) -> Result<Vec<u8>, String> {
    if data.len() < 32 || &data[..4] != b"TCG1" {
        return Err("Invalid ChatGPT storage.".into());
    }
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| "Invalid ChatGPT storage key.")?;
    cipher
        .decrypt(Nonce::from_slice(&data[4..16]), &data[16..])
        .map_err(|_| "Could not decrypt ChatGPT storage.".into())
}
