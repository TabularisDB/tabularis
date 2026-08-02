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
