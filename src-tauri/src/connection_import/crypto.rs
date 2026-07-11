//! Decryption helpers for foreign-app credential stores.
//!
//! - DBeaver encrypts `credentials-config.json` with a hardcoded AES-128-CBC
//!   key; the 16-byte IV is prepended to the ciphertext.
//! - Beekeeper Studio uses the Node `simple-encryptor` format:
//!   `<hmac-sha256 hex (64)><iv hex (32)><base64(ciphertext)>`, AES-256-CBC,
//!   key = `SHA-256(rawKeyString)`, plaintext = `JSON.stringify(value)`.
//!
//! Both reuse the already-vendored `openssl` crate.

use openssl::symm::{decrypt, Cipher};
use sha2::{Digest, Sha256};

/// DBeaver's hardcoded AES-128 key (see `DBeaverImporter.swift`).
const DBEAVER_KEY: [u8; 16] = [
    0xBA, 0xBB, 0x4A, 0x9F, 0x77, 0x4A, 0xB8, 0x53, 0xC9, 0x6C, 0x2D, 0x65, 0x3D, 0xFE, 0x54, 0x4A,
];

/// Beekeeper's hardcoded bootstrap key, used only to unwrap the per-install
/// user key stored in the `.key` file.
pub const BEEKEEPER_BOOTSTRAP_KEY: &str =
    "38782F413F442A472D4B6150645367566B59703373367639792442264529482B";

/// Decrypt DBeaver's `credentials-config.json` blob. The first 16 bytes are the
/// IV; the rest is AES-128-CBC ciphertext with PKCS#7 padding.
pub fn decrypt_dbeaver(data: &[u8]) -> Option<Vec<u8>> {
    if data.len() <= 16 {
        return None;
    }
    let (iv, ciphertext) = data.split_at(16);
    decrypt(Cipher::aes_128_cbc(), &DBEAVER_KEY, Some(iv), ciphertext).ok()
}

/// Decrypt one Beekeeper `simple-encryptor` payload and return the raw JSON
/// plaintext bytes (still JSON-encoded; callers parse/unquote as needed).
/// HMAC verification is skipped: the file is owned by the user and tampering
/// surfaces as a failed JSON decode downstream.
pub fn decrypt_beekeeper(payload: &str, key_string: &str) -> Option<Vec<u8>> {
    // `payload` is attacker-/corruption-reachable (a `.key` file or an encrypted
    // TEXT column); `get` returns None on out-of-range or non-char-boundary
    // indices, so a crafted multibyte payload can't panic the whole import.
    let iv_hex = payload.get(64..96)?;
    let cipher_b64 = payload.get(96..)?;

    let iv = hex_decode(iv_hex)?;
    if iv.len() != 16 {
        return None;
    }
    let ciphertext = base64_decode(cipher_b64)?;

    let key = Sha256::digest(key_string.as_bytes());
    decrypt(Cipher::aes_256_cbc(), &key, Some(&iv), &ciphertext).ok()
}

/// Decrypt a Beekeeper payload whose plaintext is a JSON string, returning the
/// unquoted string value (e.g. a password).
pub fn decrypt_beekeeper_string(payload: &str, key_string: &str) -> Option<String> {
    let bytes = decrypt_beekeeper(payload, key_string)?;
    serde_json::from_slice::<String>(&bytes).ok()
}

/// Decrypt a Beekeeper payload whose plaintext is a JSON object (the `.key`
/// file: `{"encryptionKey":"<hex>"}`), returning the `encryptionKey` value.
pub fn decrypt_beekeeper_user_key(payload: &str) -> Option<String> {
    let bytes = decrypt_beekeeper(payload, BEEKEEPER_BOOTSTRAP_KEY)?;
    let value: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    value
        .get("encryptionKey")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

fn hex_decode(s: &str) -> Option<Vec<u8>> {
    if s.len() % 2 != 0 {
        return None;
    }
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).ok())
        .collect()
}

fn base64_decode(s: &str) -> Option<Vec<u8>> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.decode(s).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use openssl::symm::encrypt;

    #[test]
    fn dbeaver_roundtrip() {
        let plaintext = br##"{"conn":{"#connection":{"user":"bob","password":"secret"}}}"##;
        let iv = [7u8; 16];
        let ct = encrypt(Cipher::aes_128_cbc(), &DBEAVER_KEY, Some(&iv), plaintext).unwrap();
        let mut blob = iv.to_vec();
        blob.extend_from_slice(&ct);
        assert_eq!(decrypt_dbeaver(&blob).unwrap(), plaintext);
    }

    #[test]
    fn dbeaver_rejects_short_input() {
        assert!(decrypt_dbeaver(&[0u8; 8]).is_none());
    }

    #[test]
    fn beekeeper_string_roundtrip() {
        // Build a simple-encryptor payload: 64 hex (fake hmac) + 32 hex iv + b64 ct.
        use base64::Engine;
        let key_string = "my-user-key";
        let key = Sha256::digest(key_string.as_bytes());
        let iv = [3u8; 16];
        let plaintext = serde_json::to_vec("hunter2").unwrap(); // JSON-encoded string
        let ct = encrypt(Cipher::aes_256_cbc(), &key, Some(&iv), &plaintext).unwrap();

        let mut payload = "0".repeat(64); // hmac placeholder
        payload.push_str(&iv.iter().map(|b| format!("{:02x}", b)).collect::<String>());
        payload.push_str(&base64::engine::general_purpose::STANDARD.encode(&ct));

        assert_eq!(
            decrypt_beekeeper_string(&payload, key_string).unwrap(),
            "hunter2"
        );
    }

    #[test]
    fn beekeeper_rejects_short_payload() {
        assert!(decrypt_beekeeper(&"a".repeat(96), "k").is_none());
    }

    #[test]
    fn beekeeper_rejects_multibyte_payload_without_panicking() {
        // A multibyte char straddling byte offset 64/96 must not panic the
        // import; a byte-index slice here would. 50 'é' = 100 bytes.
        let payload = "é".repeat(50);
        assert!(decrypt_beekeeper(&payload, "k").is_none());
    }
}
