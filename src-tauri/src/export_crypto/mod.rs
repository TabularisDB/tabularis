//! Password-based encryption for connection export files.
//!
//! Exported connections can be wrapped in an encrypted envelope so the file
//! can be stored or shared without exposing credentials. The payload JSON is
//! encrypted with AES-256-GCM using a key derived from the user's password
//! via Argon2id.

use aes_gcm::aead::rand_core::RngCore;
use aes_gcm::aead::{Aead, KeyInit, OsRng};
use aes_gcm::{Aes256Gcm, Nonce};
use argon2::{Algorithm, Argon2, Params, Version};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use serde::{Deserialize, Serialize};

#[cfg(test)]
mod tests;

pub const ENVELOPE_FORMAT: &str = "tabularis-connections-encrypted";

const SALT_LEN: usize = 16;
const NONCE_LEN: usize = 12;
// Argon2id parameters: 64 MiB memory, 3 iterations, 1 lane.
const ARGON2_M_COST: u32 = 65536;
const ARGON2_T_COST: u32 = 3;
const ARGON2_P_COST: u32 = 1;
// Upper bounds when decrypting: a malicious envelope must not be able to
// request unbounded memory or CPU during key derivation.
const ARGON2_MAX_M_COST: u32 = 1024 * 1024; // 1 GiB
const ARGON2_MAX_T_COST: u32 = 32;
const ARGON2_MAX_P_COST: u32 = 8;

/// Encrypted wrapper written to disk instead of the plaintext payload.
#[derive(Debug, Serialize, Deserialize)]
pub struct EncryptedEnvelope {
    pub format: String,
    pub version: u32,
    pub encrypted: bool,
    pub kdf: String,
    pub m_cost: u32,
    pub t_cost: u32,
    pub p_cost: u32,
    pub salt: String,
    pub nonce: String,
    pub ciphertext: String,
}

fn derive_key(
    password: &str,
    salt: &[u8],
    m_cost: u32,
    t_cost: u32,
    p_cost: u32,
) -> Result<[u8; 32], String> {
    let params = Params::new(m_cost, t_cost, p_cost, Some(32))
        .map_err(|e| format!("Invalid KDF parameters: {e}"))?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = [0u8; 32];
    argon2
        .hash_password_into(password.as_bytes(), salt, &mut key)
        .map_err(|e| format!("Key derivation failed: {e}"))?;
    Ok(key)
}

/// Encrypts a serialized payload with the given password.
pub fn encrypt(plaintext: &str, password: &str) -> Result<EncryptedEnvelope, String> {
    if password.is_empty() {
        return Err("Password must not be empty".to_string());
    }

    let mut salt = [0u8; SALT_LEN];
    OsRng.fill_bytes(&mut salt);
    let mut nonce_bytes = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce_bytes);

    let key = derive_key(password, &salt, ARGON2_M_COST, ARGON2_T_COST, ARGON2_P_COST)?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| e.to_string())?;
    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&nonce_bytes), plaintext.as_bytes())
        .map_err(|e| format!("Encryption failed: {e}"))?;

    Ok(EncryptedEnvelope {
        format: ENVELOPE_FORMAT.to_string(),
        version: 1,
        encrypted: true,
        kdf: "argon2id".to_string(),
        m_cost: ARGON2_M_COST,
        t_cost: ARGON2_T_COST,
        p_cost: ARGON2_P_COST,
        salt: BASE64.encode(salt),
        nonce: BASE64.encode(nonce_bytes),
        ciphertext: BASE64.encode(ciphertext),
    })
}

/// Decrypts an envelope back to the serialized payload string.
pub fn decrypt(envelope: &EncryptedEnvelope, password: &str) -> Result<String, String> {
    if envelope.format != ENVELOPE_FORMAT {
        return Err("Unrecognized encrypted export format".to_string());
    }
    if envelope.kdf != "argon2id" {
        return Err(format!("Unsupported KDF: {}", envelope.kdf));
    }
    if envelope.m_cost > ARGON2_MAX_M_COST
        || envelope.t_cost > ARGON2_MAX_T_COST
        || envelope.p_cost > ARGON2_MAX_P_COST
    {
        return Err("KDF parameters exceed allowed limits".to_string());
    }

    let salt = BASE64
        .decode(&envelope.salt)
        .map_err(|e| format!("Invalid salt: {e}"))?;
    let nonce_bytes = BASE64
        .decode(&envelope.nonce)
        .map_err(|e| format!("Invalid nonce: {e}"))?;
    if nonce_bytes.len() != NONCE_LEN {
        return Err("Invalid nonce length".to_string());
    }
    let ciphertext = BASE64
        .decode(&envelope.ciphertext)
        .map_err(|e| format!("Invalid ciphertext: {e}"))?;

    let key = derive_key(
        password,
        &salt,
        envelope.m_cost,
        envelope.t_cost,
        envelope.p_cost,
    )?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| e.to_string())?;
    let plaintext = cipher
        .decrypt(Nonce::from_slice(&nonce_bytes), ciphertext.as_ref())
        .map_err(|_| "Decryption failed: wrong password or corrupted file".to_string())?;

    String::from_utf8(plaintext).map_err(|e| format!("Decrypted data is not valid UTF-8: {e}"))
}
