use super::{
    protocol::{self, Callback},
    storage::{LockedStore, Profile, Store, Tokens},
    ISSUER, RESOURCE,
};
use serde::Deserialize;
use serde_json::Value;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};

#[cfg(test)]
#[path = "auth_tests.rs"]
mod tests;

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: String,
    id_token: Option<String>,
    token_type: String,
    expires_in: u64,
    scope: Option<String>,
    earliest_refresh_at: Option<u64>,
}

impl TokenResponse {
    fn tokens(self, previous: Option<&Tokens>) -> Result<Tokens, String> {
        if !self.token_type.eq_ignore_ascii_case("bearer")
            || self.access_token.is_empty()
            || self.refresh_token.is_empty()
            || self.expires_in == 0
        {
            return Err("ChatGPT returned invalid credentials.".into());
        }
        Ok(Tokens {
            access_token: self.access_token,
            refresh_token: self.refresh_token,
            id_token: self
                .id_token
                .or_else(|| previous.map(|p| p.id_token.clone()))
                .ok_or("ChatGPT did not return an ID token.")?,
            scope: self
                .scope
                .or_else(|| previous.map(|p| p.scope.clone()))
                .ok_or("ChatGPT did not return granted permissions.")?,
            expires_at: protocol::now().saturating_add(self.expires_in),
            earliest_refresh_at: self.earliest_refresh_at,
        })
    }
}

async fn token_request(params: &[(&str, &str)]) -> Result<TokenResponse, String> {
    let body = url::form_urlencoded::Serializer::new(String::new())
        .extend_pairs(params.iter().copied())
        .finish();
    let response = super::http_client()?
        .post(format!("{ISSUER}/api/accounts/oauth/token"))
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(body)
        .timeout(std::time::Duration::from_secs(30))
        .send()
        .await
        .map_err(|_| {
            "Could not reach ChatGPT sign-in. Check your connection and proxy settings."
        })?;
    if !response.status().is_success() {
        let status = response.status().as_u16();
        let error = response.json::<Value>().await.ok();
        if error.as_ref().and_then(|v| v["error"].as_str()) == Some("invalid_grant") {
            return Err(
                "ChatGPT authorization expired or was revoked. Continue with ChatGPT again.".into(),
            );
        }
        return Err(protocol::api_error(status));
    }
    response
        .json()
        .await
        .map_err(|_| "ChatGPT returned an invalid token response.".into())
}

async fn callback(
    listener: &TcpListener,
    state: &str,
    existing: Option<&str>,
) -> Result<Callback, String> {
    loop {
        let (mut stream, _) = listener
            .accept()
            .await
            .map_err(|_| "Could not receive ChatGPT sign-in callback.")?;
        let request = tokio::time::timeout(std::time::Duration::from_secs(3), async {
            let mut bytes = Vec::new();
            loop {
                let mut buffer = [0u8; 1024];
                let count = stream
                    .read(&mut buffer)
                    .await
                    .map_err(|_| "Invalid callback request.")?;
                if count == 0 {
                    return Err("Incomplete callback request.");
                }
                bytes.extend_from_slice(&buffer[..count]);
                if bytes.len() > 16 * 1024 {
                    return Err("Callback request is too large.");
                }
                if bytes.windows(4).any(|w| w == b"\r\n\r\n") {
                    break;
                }
            }
            String::from_utf8(bytes).map_err(|_| "Invalid callback encoding.")
        })
        .await;
        let parsed = request.ok().and_then(Result::ok).and_then(|request| {
            let mut parts = request.lines().next()?.split_whitespace();
            if parts.next()? != "GET" {
                return None;
            }
            let target = parts.next()?;
            if !target.starts_with("/auth/callback?") {
                return None;
            }
            let parsed = protocol::parse_callback(target, state, existing);
            let denied = url::Url::parse(&format!("http://127.0.0.1{target}"))
                .ok()
                .is_some_and(|url| {
                    let params: Vec<_> = url.query_pairs().collect();
                    params.iter().filter(|(key, _)| key == "state").count() == 1
                        && params
                            .iter()
                            .any(|(key, value)| key == "state" && value == state)
                        && params.iter().any(|(key, _)| key == "error")
                });
            Some((parsed, denied))
        });
        let (status, body) = if parsed.as_ref().is_some_and(|(result, _)| result.is_ok()) {
            ("200 OK", "Return to Tabularis to finish connecting your ChatGPT account. You can close this tab.")
        } else {
            (
                "400 Bad Request",
                "This ChatGPT sign-in callback could not be accepted. Return to Tabularis.",
            )
        };
        let reply = format!("HTTP/1.1 {status}\r\nContent-Type: text/plain; charset=utf-8\r\nCache-Control: no-store\r\nContent-Security-Policy: default-src 'none'\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{body}", body.len());
        let _ = tokio::time::timeout(
            std::time::Duration::from_secs(2),
            stream.write_all(reply.as_bytes()),
        )
        .await;
        if let Some((result, denied)) = parsed {
            if result.is_ok() || denied {
                return result;
            }
        }
        // Ignore unrelated/malformed local requests. The attempt remains cancellable.
    }
}

pub(super) async fn sign_in(
    app: &tauri::AppHandle,
    disk: &LockedStore,
    store: &mut Store,
    profile_id: Option<&str>,
) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let existing = profile_id
        .map(|id| {
            store
                .profiles
                .iter()
                .find(|p| p.id == id)
                .cloned()
                .ok_or("ChatGPT account not found.")
        })
        .transpose()?;
    let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
        .await
        .map_err(|_| "Could not start the local ChatGPT callback listener.")?;
    let redirect_uri = format!(
        "http://127.0.0.1:{}/auth/callback",
        listener
            .local_addr()
            .map_err(|_| "Could not read callback port.")?
            .port()
    );
    let state = protocol::random()?;
    let nonce = protocol::random()?;
    let verifier = protocol::random()?;
    let challenge = protocol::challenge(&verifier);
    let client_id = existing
        .as_ref()
        .map(|p| p.client_id.as_str())
        .unwrap_or("dynamic_agent_client");
    let mut url = url::Url::parse(&format!("{ISSUER}/api/accounts/authorize"))
        .map_err(|_| "Invalid ChatGPT authorization endpoint.")?;
    url.query_pairs_mut().extend_pairs([
        ("client_id", client_id),
        ("ext_agent_host_id", &store.host_id),
        ("response_type", "code"),
        ("redirect_uri", &redirect_uri),
        (
            "scope",
            "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
        ),
        ("resource", RESOURCE),
        ("state", &state),
        ("nonce", &nonce),
        ("code_challenge_method", "S256"),
        ("code_challenge", &challenge),
    ]);
    if let Some(profile) = &existing {
        if let Some(tokens) = &profile.tokens {
            url.query_pairs_mut()
                .append_pair("id_token_hint", &tokens.id_token);
        }
        if let Some(email) = &profile.email {
            url.query_pairs_mut().append_pair("login_hint", email);
        }
    } else {
        url.query_pairs_mut()
            .append_pair("agent_name_hint", "Tabularis");
    }
    // Never include the authorization URL in errors or logs: it may contain an ID token.
    app.opener()
        .open_url(url.as_str(), None::<&str>)
        .map_err(|_| "Could not open the browser for ChatGPT sign-in.")?;
    let callback = callback(
        &listener,
        &state,
        existing.as_ref().map(|p| p.client_id.as_str()),
    )
    .await?;
    let index = if let Some(profile) = &existing {
        store
            .profiles
            .iter()
            .position(|p| p.id == profile.id)
            .ok_or("ChatGPT account not found.")?
    } else {
        store.profiles.push(Profile {
            id: uuid::Uuid::new_v4().to_string(),
            label: format!("Connection {}", store.profiles.len() + 1),
            client_id: callback.client_id.clone(),
            subject: None,
            email: None,
            tokens: None,
        });
        store.profiles.len() - 1
    };
    // Retain the issued registration even when code exchange fails or is cancelled.
    disk.save(store)?;
    let response = token_request(&[
        ("grant_type", "authorization_code"),
        ("client_id", &callback.client_id),
        ("code", &callback.code),
        ("code_verifier", &verifier),
        ("redirect_uri", &redirect_uri),
        ("resource", RESOURCE),
    ])
    .await?;
    let tokens = response.tokens(None)?;
    let response = super::http_client()?
        .get(format!("{ISSUER}/.well-known/jwks.json"))
        .timeout(std::time::Duration::from_secs(30))
        .send()
        .await
        .map_err(|_| "Could not retrieve ChatGPT identity verification keys.")?;
    if !response.status().is_success() {
        return Err("Could not retrieve ChatGPT identity verification keys.".into());
    }
    let keys: Value = response
        .json()
        .await
        .map_err(|_| "Invalid ChatGPT identity verification keys.")?;
    let identity = protocol::verify_identity(
        &tokens.id_token,
        &keys,
        &callback.client_id,
        &nonce,
        protocol::now(),
    )?;
    let profile = &mut store.profiles[index];
    if profile
        .subject
        .as_ref()
        .is_some_and(|subject| *subject != identity.sub)
    {
        return Err(
            "ChatGPT identity does not match the saved account. Add a new account instead.".into(),
        );
    }
    profile.subject = Some(identity.sub);
    profile.email = identity.email;
    profile.tokens = Some(tokens);
    store.active_profile_id = Some(profile.id.clone());
    disk.save(store)
}

pub(super) async fn access_token(disk: &LockedStore, store: &mut Store) -> Result<String, String> {
    let id = store
        .active_profile_id
        .as_ref()
        .ok_or("Continue with ChatGPT in AI settings first.")?;
    let index = store
        .profiles
        .iter()
        .position(|p| &p.id == id)
        .ok_or("ChatGPT account not found.")?;
    let profile = &store.profiles[index];
    let tokens = profile
        .tokens
        .as_ref()
        .ok_or("Continue with ChatGPT in AI settings again.")?;
    if !tokens.sharing() {
        return Err("Allow ChatGPT plan usage by continuing with ChatGPT in AI settings.".into());
    }
    let time = protocol::now();
    if time.saturating_add(60) < tokens.expires_at
        || (time < tokens.expires_at
            && tokens
                .earliest_refresh_at
                .is_some_and(|earliest| time < earliest))
    {
        return Ok(tokens.access_token.clone());
    }
    let refreshed = token_request(&[
        ("grant_type", "refresh_token"),
        ("client_id", &profile.client_id),
        ("refresh_token", &tokens.refresh_token),
        ("resource", RESOURCE),
    ])
    .await?
    .tokens(Some(tokens))?;
    let access_token = refreshed.access_token.clone();
    let sharing = refreshed.sharing();
    store.profiles[index].tokens = Some(refreshed);
    // Serialize the rotating refresh token and access-token metadata atomically.
    disk.save(store)?;
    if !sharing {
        return Err(
            "ChatGPT plan usage permission is no longer enabled. Continue with ChatGPT again."
                .into(),
        );
    }
    Ok(access_token)
}

pub(super) async fn revoke(client_id: &str, refresh_token: &str) -> Result<(), String> {
    let client = super::http_client()?;
    let discovery: Value = client
        .get(format!("{ISSUER}/.well-known/openid-configuration"))
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await
        .map_err(|_| "Discovery failed.")?
        .error_for_status()
        .map_err(|_| "Discovery failed.")?
        .json()
        .await
        .map_err(|_| "Invalid discovery.")?;
    if discovery["issuer"] != ISSUER {
        return Err("Unexpected ChatGPT issuer.".into());
    }
    let endpoint = discovery["revocation_endpoint"]
        .as_str()
        .ok_or("Missing revocation endpoint.")?;
    let url = url::Url::parse(endpoint).map_err(|_| "Invalid revocation endpoint.")?;
    if url.origin()
        != url::Url::parse(ISSUER)
            .map_err(|_| "Invalid issuer.")?
            .origin()
    {
        return Err("Unexpected revocation endpoint.".into());
    }
    let body = url::form_urlencoded::Serializer::new(String::new())
        .extend_pairs([
            ("token", refresh_token),
            ("token_type_hint", "refresh_token"),
            ("client_id", client_id),
        ])
        .finish();
    for attempt in 0..3 {
        let result = client
            .post(endpoint)
            .header("Content-Type", "application/x-www-form-urlencoded")
            .body(body.clone())
            .timeout(std::time::Duration::from_secs(10))
            .send()
            .await;
        match result {
            Ok(response) if response.status() == reqwest::StatusCode::OK => return Ok(()),
            Ok(response) if !response.status().is_server_error() => break,
            _ => {}
        }
        if attempt < 2 {
            tokio::time::sleep(std::time::Duration::from_millis(250 << attempt)).await;
        }
    }
    Err("Remote revocation could not be confirmed.".into())
}
