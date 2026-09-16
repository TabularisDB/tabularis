use super::*;

#[test]
fn encrypt_decrypt_roundtrip() {
    let payload = r#"{"version":1,"connections":[{"id":"abc","password":"secret"}]}"#;
    let envelope = encrypt(payload, "correct horse battery staple").unwrap();

    assert_eq!(envelope.format, ENVELOPE_FORMAT);
    assert!(envelope.encrypted);
    assert_eq!(envelope.kdf, "argon2id");
    // The ciphertext must not leak the plaintext.
    assert!(!envelope.ciphertext.contains("secret"));

    let decrypted = decrypt(&envelope, "correct horse battery staple").unwrap();
    assert_eq!(decrypted, payload);
}

#[test]
fn wrong_password_fails() {
    let envelope = encrypt("{\"a\":1}", "right password").unwrap();
    let err = decrypt(&envelope, "wrong password").unwrap_err();
    assert!(err.contains("wrong password or corrupted file"));
}

#[test]
fn empty_password_rejected() {
    assert!(encrypt("{}", "").is_err());
}

#[test]
fn tampered_ciphertext_fails() {
    let mut envelope = encrypt("{\"a\":1}", "pw").unwrap();
    let mut raw = base64::engine::general_purpose::STANDARD
        .decode(&envelope.ciphertext)
        .unwrap();
    raw[0] ^= 0xff;
    envelope.ciphertext = base64::engine::general_purpose::STANDARD.encode(raw);
    assert!(decrypt(&envelope, "pw").is_err());
}

#[test]
fn unknown_format_rejected() {
    let mut envelope = encrypt("{}", "pw").unwrap();
    envelope.format = "something-else".to_string();
    assert!(decrypt(&envelope, "pw").is_err());
}

#[test]
fn excessive_kdf_parameters_rejected() {
    let mut envelope = encrypt("{}", "pw").unwrap();
    envelope.m_cost = u32::MAX;
    let err = decrypt(&envelope, "pw").unwrap_err();
    assert!(err.contains("KDF parameters exceed allowed limits"));

    let mut envelope = encrypt("{}", "pw").unwrap();
    envelope.t_cost = 1000;
    assert!(decrypt(&envelope, "pw").is_err());

    let mut envelope = encrypt("{}", "pw").unwrap();
    envelope.p_cost = 1000;
    assert!(decrypt(&envelope, "pw").is_err());
}

#[test]
fn envelope_serializes_with_encrypted_flag() {
    let envelope = encrypt("{}", "pw").unwrap();
    let json = serde_json::to_value(&envelope).unwrap();
    assert_eq!(json["encrypted"], serde_json::Value::Bool(true));
    assert_eq!(json["format"], ENVELOPE_FORMAT);
}

// ---------------------------------------------------------------------------
// Key-and-seal primitives
//
// These exist for callers that manage their own envelope: they derive the key
// once and keep it, rather than re-deriving it from a password on every
// operation the way `encrypt`/`decrypt` do.
// ---------------------------------------------------------------------------

/// Argon2 parameters that keep these tests fast. The production ones are
/// exercised through `encrypt`/`decrypt` above.
const TEST_M_COST: u32 = 8;
const TEST_T_COST: u32 = 1;
const TEST_P_COST: u32 = 1;

fn test_key(password: &str, salt: &[u8]) -> [u8; 32] {
    derive_key(password, salt, TEST_M_COST, TEST_T_COST, TEST_P_COST).unwrap()
}

#[test]
fn the_same_password_and_salt_derive_the_same_key() {
    // The whole point for a shared vault: every member must land on the same
    // key from the same password and the salt stored in the file.
    let salt = random_salt();
    assert_eq!(test_key("hunter2", &salt), test_key("hunter2", &salt));
}

#[test]
fn another_password_or_salt_derives_another_key() {
    let salt = random_salt();
    assert_ne!(test_key("hunter2", &salt), test_key("hunter3", &salt));
    assert_ne!(test_key("hunter2", &salt), test_key("hunter2", &random_salt()));
}

#[test]
fn random_salt_is_not_a_constant() {
    assert_ne!(random_salt(), random_salt());
    assert_eq!(random_salt().len(), SALT_LEN);
}

#[test]
fn seal_and_open_round_trip() {
    let key = test_key("pw", &random_salt());
    let sealed = seal_with_key(&key, "{\"hello\":\"world\"}").unwrap();
    assert_eq!(
        open_with_key(&key, &sealed).unwrap(),
        "{\"hello\":\"world\"}"
    );
}

#[test]
fn every_seal_uses_a_fresh_nonce() {
    // Reusing a nonce under the same AES-GCM key is fatal, and a long-lived
    // key sealing repeatedly is exactly this API's use case.
    let key = test_key("pw", &random_salt());
    let first = seal_with_key(&key, "same plaintext").unwrap();
    let second = seal_with_key(&key, "same plaintext").unwrap();
    assert_ne!(first.nonce, second.nonce);
    assert_ne!(first.ciphertext, second.ciphertext);
}

#[test]
fn another_key_cannot_open_it() {
    let sealed = seal_with_key(&test_key("pw", &random_salt()), "secret").unwrap();
    let err = open_with_key(&test_key("other", &random_salt()), &sealed).unwrap_err();
    assert!(err.contains("wrong password or corrupted data"));
}

#[test]
fn tampered_ciphertext_is_rejected() {
    // GCM authenticates: a flipped byte must fail rather than decrypt to junk.
    let key = test_key("pw", &random_salt());
    let mut sealed = seal_with_key(&key, "secret").unwrap();
    // Swap the first base64 character for a different one, so the tamper
    // happens whatever the ciphertext turned out to be.
    let first = sealed.ciphertext.remove(0);
    sealed.ciphertext.insert(0, if first == 'A' { 'B' } else { 'A' });
    assert!(open_with_key(&key, &sealed).is_err());
}

#[test]
fn a_malformed_nonce_is_rejected() {
    let key = test_key("pw", &random_salt());
    let mut sealed = seal_with_key(&key, "secret").unwrap();

    sealed.nonce = "not base64!".to_string();
    assert!(open_with_key(&key, &sealed).unwrap_err().contains("nonce"));

    let mut sealed = seal_with_key(&key, "secret").unwrap();
    sealed.nonce = String::new();
    assert!(open_with_key(&key, &sealed)
        .unwrap_err()
        .contains("nonce length"));
}

#[test]
fn derive_key_refuses_parameters_beyond_the_limits() {
    // The guard belongs to the derivation itself, not only to `decrypt`: a
    // caller that keeps its own envelope reads these from a file somebody else
    // may have written, and an unbounded m_cost is a denial of service on
    // every attempt, successful or not.
    let salt = random_salt();
    for (m, t, p) in [
        (u32::MAX, TEST_T_COST, TEST_P_COST),
        (TEST_M_COST, 1000, TEST_P_COST),
        (TEST_M_COST, TEST_T_COST, 1000),
    ] {
        let err = derive_key("pw", &salt, m, t, p).unwrap_err();
        assert!(
            err.contains("exceed allowed limits"),
            "expected a limits error, got: {err}"
        );
    }
}

#[test]
fn derive_key_accepts_the_production_parameters() {
    let salt = random_salt();
    assert!(derive_key("pw", &salt, ARGON2_M_COST, ARGON2_T_COST, ARGON2_P_COST).is_ok());
}
