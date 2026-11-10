use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use openssl::{bn::BigNum, hash::MessageDigest, pkey::PKey, rsa::Rsa, sign::Verifier};
use serde::Deserialize;
use serde_json::Value;
use sha2::{Digest, Sha256};

pub(crate) fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

pub(crate) fn random() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    openssl::rand::rand_bytes(&mut bytes)
        .map_err(|_| "Could not prepare secure ChatGPT sign-in.")?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}

pub(crate) fn challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

pub(crate) struct Callback {
    pub code: String,
    pub client_id: String,
}

pub(super) fn parse_callback(
    target: &str,
    state: &str,
    existing_client: Option<&str>,
) -> Result<Callback, String> {
    let url = url::Url::parse(&format!("http://127.0.0.1{target}"))
        .map_err(|_| "Invalid ChatGPT callback.")?;
    if url.path() != "/auth/callback" {
        return Err("Unexpected ChatGPT callback path.".into());
    }
    // Reject duplicate security parameters instead of accepting an ambiguous value.
    let mut params = std::collections::HashMap::new();
    for (key, value) in url.query_pairs() {
        if params
            .insert(key.into_owned(), value.into_owned())
            .is_some()
        {
            return Err("Duplicate ChatGPT callback parameter.".into());
        }
    }
    if params.get("state").map(String::as_str) != Some(state) {
        return Err("ChatGPT sign-in state does not match.".into());
    }
    if params.contains_key("error") {
        return Err("ChatGPT authorization was declined. Please try again.".into());
    }
    let code = params
        .get("code")
        .filter(|s| !s.is_empty())
        .ok_or("ChatGPT callback has no authorization code.")?
        .clone();
    let client_id = params
        .get("client_id")
        .map(String::as_str)
        .or(existing_client)
        .ok_or("ChatGPT registration did not return a client ID.")?;
    if client_id == "dynamic_agent_client" || client_id.is_empty() {
        return Err("ChatGPT registration did not return an issued client ID.".into());
    }
    if existing_client.is_some_and(|existing| existing != client_id) {
        return Err("ChatGPT client ID does not match the selected account.".into());
    }
    Ok(Callback {
        code,
        client_id: client_id.into(),
    })
}

#[derive(Deserialize)]
pub(crate) struct Identity {
    pub iss: String,
    pub sub: String,
    pub aud: Value,
    pub exp: u64,
    pub nonce: Option<String>,
    pub email: Option<String>,
    pub nbf: Option<u64>,
    pub azp: Option<String>,
}

pub(crate) fn verify_identity(
    token: &str,
    jwks: &Value,
    client_id: &str,
    nonce: &str,
    time: u64,
) -> Result<Identity, String> {
    let invalid = || "Could not verify ChatGPT identity.".to_string();
    let parts: Vec<_> = token.split('.').collect();
    if parts.len() != 3 {
        return Err(invalid());
    }
    let decode = |s| URL_SAFE_NO_PAD.decode(s).map_err(|_| invalid());
    let header: Value = serde_json::from_slice(&decode(parts[0])?).map_err(|_| invalid())?;
    if header["alg"] != "RS256" {
        return Err(invalid());
    }
    let kid = header["kid"].as_str().ok_or_else(invalid)?;
    let key = jwks["keys"]
        .as_array()
        .and_then(|keys| {
            keys.iter()
                .find(|key| key["kid"] == kid && key["kty"] == "RSA")
        })
        .ok_or_else(invalid)?;
    if key.get("use").is_some_and(|usage| usage != "sig")
        || key.get("alg").is_some_and(|alg| alg != "RS256")
    {
        return Err(invalid());
    }
    let n = BigNum::from_slice(&decode(key["n"].as_str().ok_or_else(invalid)?)?)
        .map_err(|_| invalid())?;
    let e = BigNum::from_slice(&decode(key["e"].as_str().ok_or_else(invalid)?)?)
        .map_err(|_| invalid())?;
    let rsa = Rsa::from_public_components(n, e).map_err(|_| invalid())?;
    let key = PKey::from_rsa(rsa).map_err(|_| invalid())?;
    let mut verifier = Verifier::new(MessageDigest::sha256(), &key).map_err(|_| invalid())?;
    verifier
        .update(format!("{}.{}", parts[0], parts[1]).as_bytes())
        .map_err(|_| invalid())?;
    if !verifier.verify(&decode(parts[2])?).map_err(|_| invalid())? {
        return Err(invalid());
    }
    let identity: Identity = serde_json::from_slice(&decode(parts[1])?).map_err(|_| invalid())?;
    let valid_audience = identity.aud.as_str() == Some(client_id)
        || identity
            .aud
            .as_array()
            .is_some_and(|aud| aud.iter().any(|a| a.as_str() == Some(client_id)));
    let multiple_audiences = identity.aud.as_array().is_some_and(|aud| aud.len() > 1);
    if identity.iss != super::ISSUER
        || identity.sub.is_empty()
        || !valid_audience
        || identity.exp <= time
        || identity.nbf.is_some_and(|nbf| nbf > time)
        || identity.nonce.as_deref() != Some(nonce)
        || identity.azp.as_deref().is_some_and(|azp| azp != client_id)
        || (multiple_audiences && identity.azp.as_deref() != Some(client_id))
    {
        return Err(invalid());
    }
    Ok(identity)
}

pub(super) fn api_error(status: u16) -> String {
    match status {
        401 => "ChatGPT access expired or was revoked. Continue with ChatGPT again.".into(),
        403 => {
            "ChatGPT plan usage is unavailable. Continue with ChatGPT and allow plan usage.".into()
        }
        429 => "ChatGPT usage limit reached. Open Manage usage in AI settings.".into(),
        _ => format!("ChatGPT request failed (HTTP {status}). Please try again."),
    }
}

/// Incremental byte parser: network chunks may split UTF-8 or SSE frame boundaries.
#[derive(Default)]
pub(super) struct ResponseStream {
    pending: Vec<u8>,
    pub text: String,
    pub completed: bool,
}

impl ResponseStream {
    pub fn push(&mut self, chunk: &[u8]) -> Result<(), String> {
        self.pending.extend_from_slice(chunk);
        loop {
            let lf = self
                .pending
                .windows(2)
                .position(|w| w == b"\n\n")
                .map(|i| (i, 2));
            let crlf = self
                .pending
                .windows(4)
                .position(|w| w == b"\r\n\r\n")
                .map(|i| (i, 4));
            let boundary = match (lf, crlf) {
                (Some(a), Some(b)) => Some(if a.0 < b.0 { a } else { b }),
                (a, b) => a.or(b),
            };
            let Some((end, len)) = boundary else {
                break;
            };
            let frame = self.pending.drain(..end + len).collect::<Vec<_>>();
            self.event(&frame[..end])?;
        }
        if self.pending.len() > 16 * 1024 * 1024 || self.text.len() > 16 * 1024 * 1024 {
            return Err("ChatGPT response is too large.".into());
        }
        Ok(())
    }

    fn event(&mut self, frame: &[u8]) -> Result<(), String> {
        let frame = std::str::from_utf8(frame).map_err(|_| "Invalid ChatGPT response encoding.")?;
        let data = frame
            .lines()
            .filter_map(|line| {
                line.strip_prefix("data:")
                    .map(|s| s.strip_prefix(' ').unwrap_or(s))
            })
            .collect::<Vec<_>>()
            .join("\n");
        if data.is_empty() || data == "[DONE]" {
            return Ok(());
        }
        let event: Value =
            serde_json::from_str(&data).map_err(|_| "Invalid ChatGPT response event.")?;
        match event["type"].as_str() {
            Some("response.output_text.delta") => self.text.push_str(event["delta"].as_str().ok_or("Invalid ChatGPT text event.")?),
            Some("response.completed") => {
                if event["response"]["status"] != "completed" { return Err("ChatGPT response did not complete.".into()); }
                self.completed = true;
            }
            Some("response.failed" | "response.incomplete" | "error") => return Err("ChatGPT could not complete the response. Check Manage usage in AI settings and try again.".into()),
            _ => {},
        }
        Ok(())
    }

    pub fn finish(self) -> Result<String, String> {
        if !self.completed {
            return Err("ChatGPT stream ended before response.completed. Please try again.".into());
        }
        if self.text.trim().is_empty() {
            return Err("ChatGPT returned an empty response.".into());
        }
        Ok(self.text)
    }
}
