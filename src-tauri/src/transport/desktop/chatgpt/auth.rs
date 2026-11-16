use crate::chatgpt::auth::*;
use crate::chatgpt::{
    protocol::{self},
    storage::{LockedStore, Store},
    ISSUER, RESOURCE,
};
use serde_json::Value;
use tokio::net::TcpListener;

pub(super) async fn sign_in(
    app: &tauri::AppHandle,
    store: Store,
    profile_id: Option<&str>,
) -> Result<Store, String> {
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
    let target_profile_id = {
        let _guard = crate::chatgpt::SESSION_LOCK.lock().await;
        let disk = LockedStore::open()?;
        let mut current = disk.load()?;
        if current.host_id != store.host_id {
            return Err("ChatGPT installation changed during sign-in. Please try again.".into());
        }
        let id = register_profile(&mut current, existing.as_ref(), &callback)?;
        // Retain the issued registration even when code exchange fails or is cancelled.
        disk.save(&current)?;
        id
    };
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
    let response = crate::chatgpt::http_client()?
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
    let _guard = crate::chatgpt::SESSION_LOCK.lock().await;
    let disk = LockedStore::open()?;
    let mut current = disk.load()?;
    if current.host_id != store.host_id {
        return Err("ChatGPT installation changed during sign-in. Please try again.".into());
    }
    complete_sign_in(
        &mut current,
        &target_profile_id,
        &callback.client_id,
        identity,
        tokens,
    )?;
    disk.save(&current)?;
    Ok(current)
}
