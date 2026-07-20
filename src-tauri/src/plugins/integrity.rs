//! Release-integrity verification for the Tabularium registry.
//!
//! The registry never hosts plugin binaries — it hosts the plugin author's
//! *signed hashes* of the forge (GitHub/Codeberg) release assets. The client
//! downloads the asset from the forge and proves it matches what the author
//! published. This module verifies the Ed25519 JWS the registry serves at
//! `GET /api/plugins/{slug}/releases/{version}/integrity`, so the installer
//! trusts only values that live *inside* the signed payload — never the
//! surrounding (unsigned) JSON envelope.
//!
//! A valid signature over the *wrong* release is still an attack, so the
//! payload's `plugin_slug` / `release_version` / `registry` are guarded
//! against what the caller asked for. Everything fails closed.

use base64::Engine;
use ed25519_dalek::{Signature, VerifyingKey};
use serde::Deserialize;

/// JWKS endpoint, relative to the registry base URL.
const JWKS_PATH: &str = "/.well-known/registry-key.json";

/// One Ed25519 public key from the registry JWKS.
#[derive(Deserialize, Clone, Debug)]
pub struct Jwk {
    pub kty: String,
    pub crv: String,
    /// base64url (no pad) of the 32-byte Ed25519 public key.
    pub x: String,
    pub kid: String,
}

#[derive(Deserialize)]
struct Jwks {
    keys: Vec<Jwk>,
}

/// A signed asset row, from inside the verified JWS payload.
#[derive(Deserialize, Clone, Debug)]
pub struct SignedAsset {
    pub name: String,
    pub sha256: String,
}

/// The canonical, signature-verified payload — the only values the client
/// is allowed to trust when deciding what to install.
#[derive(Deserialize, Clone, Debug)]
pub struct SignedPayload {
    pub registry: String,
    pub plugin_slug: String,
    pub release_version: String,
    #[serde(default)]
    pub manifest_sha256: Option<String>,
    pub assets: Vec<SignedAsset>,
}

impl SignedPayload {
    /// SHA-256 the registry signed for the asset with this exact `name`
    /// (the forge filename, e.g. `firestore-plugin-linux-x64.zip`).
    pub fn sha256_for(&self, asset_name: &str) -> Option<&str> {
        self.assets
            .iter()
            .find(|a| a.name == asset_name)
            .map(|a| a.sha256.as_str())
    }
}

#[derive(Deserialize)]
struct JwsHeader {
    alg: String,
    kid: String,
}

fn b64url(segment: &str) -> Result<Vec<u8>, String> {
    base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(segment)
        .map_err(|e| format!("invalid base64url segment: {e}"))
}

/// Fetch the registry JWKS (current + optional previous key, so key rotation
/// doesn't break in-flight installs).
pub async fn fetch_jwks(base_url: &str) -> Result<Vec<Jwk>, String> {
    let url = format!("{}{}", base_url.trim_end_matches('/'), JWKS_PATH);
    let resp = reqwest::get(&url)
        .await
        .map_err(|e| format!("JWKS fetch failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("JWKS fetch failed: HTTP {}", resp.status()));
    }
    let jwks: Jwks = resp
        .json()
        .await
        .map_err(|e| format!("JWKS parse failed: {e}"))?;
    Ok(jwks.keys)
}

fn verifying_key(jwk: &Jwk) -> Result<VerifyingKey, String> {
    if jwk.kty != "OKP" || jwk.crv != "Ed25519" {
        return Err(format!("unsupported JWKS key {}/{}", jwk.kty, jwk.crv));
    }
    let raw = b64url(&jwk.x)?;
    let bytes: [u8; 32] = raw
        .as_slice()
        .try_into()
        .map_err(|_| format!("Ed25519 key must be 32 bytes, got {}", raw.len()))?;
    VerifyingKey::from_bytes(&bytes).map_err(|e| format!("invalid Ed25519 key: {e}"))
}

/// Verify a compact JWS (EdDSA) against the JWKS and the expected release
/// identity, returning the signed payload. Fails closed on any malformed
/// input, signature failure, unknown `kid`, or identity-guard mismatch.
pub fn verify_jws(
    jws: &str,
    jwks: &[Jwk],
    expect_slug: &str,
    expect_version: &str,
    expect_registry: &str,
) -> Result<SignedPayload, String> {
    // Compact JWS is exactly three base64url segments: header.payload.signature.
    let mut parts = jws.split('.');
    let (h, p, s) = match (parts.next(), parts.next(), parts.next(), parts.next()) {
        (Some(h), Some(p), Some(s), None) => (h, p, s),
        _ => return Err("malformed JWS (expected 3 segments)".into()),
    };

    let header: JwsHeader =
        serde_json::from_slice(&b64url(h)?).map_err(|e| format!("invalid JWS header: {e}"))?;
    if header.alg != "EdDSA" {
        return Err(format!("unexpected JWS alg '{}'", header.alg));
    }

    let jwk = jwks
        .iter()
        .find(|k| k.kid == header.kid)
        .ok_or_else(|| format!("no JWKS key for kid '{}'", header.kid))?;
    let key = verifying_key(jwk)?;

    let sig = Signature::from_slice(&b64url(s)?)
        .map_err(|e| format!("invalid signature bytes: {e}"))?;

    // The JWS signing input is the ASCII string "<header>.<payload>".
    let signing_input = format!("{h}.{p}");
    key.verify_strict(signing_input.as_bytes(), &sig)
        .map_err(|_| "JWS signature verification failed".to_string())?;

    let payload: SignedPayload =
        serde_json::from_slice(&b64url(p)?).map_err(|e| format!("invalid JWS payload: {e}"))?;

    // Guard the payload — a valid signature over the WRONG release is an attack.
    if payload.plugin_slug != expect_slug {
        return Err(format!(
            "signed slug '{}' != requested '{}'",
            payload.plugin_slug, expect_slug
        ));
    }
    if payload.release_version != expect_version {
        return Err(format!(
            "signed version '{}' != requested '{}'",
            payload.release_version, expect_version
        ));
    }
    if payload.registry.trim_end_matches('/') != expect_registry.trim_end_matches('/') {
        return Err(format!(
            "signed registry '{}' != '{}'",
            payload.registry, expect_registry
        ));
    }

    Ok(payload)
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    const KID: &str = "test-key-1";

    fn b64(bytes: &[u8]) -> String {
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
    }

    /// Build a signed compact JWS + the matching JWKS for a payload, using a
    /// deterministic test keypair (fixed seed — no RNG needed).
    fn sign(payload: &serde_json::Value) -> (String, Vec<Jwk>) {
        let signing = SigningKey::from_bytes(&[7u8; 32]);
        let jwk = Jwk {
            kty: "OKP".into(),
            crv: "Ed25519".into(),
            x: b64(signing.verifying_key().as_bytes()),
            kid: KID.into(),
        };
        let header = serde_json::json!({ "alg": "EdDSA", "kid": KID });
        let h = b64(serde_json::to_string(&header).unwrap().as_bytes());
        let p = b64(serde_json::to_string(payload).unwrap().as_bytes());
        let sig = signing.sign(format!("{h}.{p}").as_bytes());
        (format!("{h}.{p}.{}", b64(&sig.to_bytes())), vec![jwk])
    }

    fn payload() -> serde_json::Value {
        serde_json::json!({
            "v": 1,
            "registry": "https://registry.tabularis.dev",
            "plugin_slug": "firestore",
            "release_version": "0.5.0",
            "manifest_sha256": "abc",
            "assets": [{ "name": "firestore-linux-x64.zip", "sha256": "deadbeef" }]
        })
    }

    #[test]
    fn verifies_and_returns_signed_asset_hash() {
        let (jws, jwks) = sign(&payload());
        let p = verify_jws(&jws, &jwks, "firestore", "0.5.0", "https://registry.tabularis.dev")
            .expect("should verify");
        assert_eq!(p.sha256_for("firestore-linux-x64.zip"), Some("deadbeef"));
        // Trailing-slash difference on the registry must not fail the guard.
        assert!(verify_jws(&jws, &jwks, "firestore", "0.5.0", "https://registry.tabularis.dev/").is_ok());
    }

    #[test]
    fn rejects_tampered_payload() {
        let (jws, jwks) = sign(&payload());
        // Flip one char in the payload segment — signature no longer matches.
        let mut seg: Vec<&str> = jws.split('.').collect();
        let mutated = seg[1].to_string() + "A";
        seg[1] = &mutated;
        let bad = seg.join(".");
        assert!(verify_jws(&bad, &jwks, "firestore", "0.5.0", "https://registry.tabularis.dev").is_err());
    }

    #[test]
    fn rejects_wrong_release_identity() {
        let (jws, jwks) = sign(&payload());
        // Correct signature, wrong slug / version / registry → all rejected.
        assert!(verify_jws(&jws, &jwks, "postgres", "0.5.0", "https://registry.tabularis.dev").is_err());
        assert!(verify_jws(&jws, &jwks, "firestore", "9.9.9", "https://registry.tabularis.dev").is_err());
        assert!(verify_jws(&jws, &jwks, "firestore", "0.5.0", "https://evil.example").is_err());
    }

    #[test]
    fn rejects_unknown_kid() {
        let (jws, _) = sign(&payload());
        let other = SigningKey::from_bytes(&[9u8; 32]);
        let wrong = vec![Jwk {
            kty: "OKP".into(),
            crv: "Ed25519".into(),
            x: b64(other.verifying_key().as_bytes()),
            kid: "some-other-kid".into(),
        }];
        assert!(verify_jws(&jws, &wrong, "firestore", "0.5.0", "https://registry.tabularis.dev").is_err());
    }

    #[test]
    fn rejects_malformed_jws() {
        let jwks = sign(&payload()).1;
        assert!(verify_jws("only.two", &jwks, "firestore", "0.5.0", "https://registry.tabularis.dev").is_err());
    }
}
