//! ChatGPT plan usage for the local desktop app. Credentials never cross IPC.
mod api_errors;
pub(crate) mod auth;
pub(crate) mod inference;
pub(crate) mod protocol;
pub(crate) mod storage;

#[cfg(test)]
mod tests;

use serde::Serialize;
use std::sync::Mutex;
use storage::session;
use tokio::sync::oneshot;

pub(crate) const ISSUER: &str = "https://auth.openai.com";
pub(crate) const RESOURCE: &str = "https://api.openai.com/v1";
const PLAN_SCOPE: &str = "chatgpt.tokens.use.direct";
pub(crate) static SESSION_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
pub(crate) static SIGN_IN_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
pub(crate) static SIGN_IN_CANCEL: Mutex<Option<oneshot::Sender<()>>> = Mutex::new(None);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatGptProfile {
    id: String,
    label: String,
    email: Option<String>,
    connected: bool,
    sharing: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatGptSession {
    active_profile_id: Option<String>,
    profiles: Vec<ChatGptProfile>,
}

pub(crate) fn http_client() -> Result<reqwest::Client, String> {
    crate::proxy::ai_http_client("chatgpt")
}

pub async fn get_chatgpt_session() -> Result<ChatGptSession, String> {
    let _guard = SESSION_LOCK.lock().await;
    let disk = storage::LockedStore::open()?;
    Ok(session(&disk.load()?))
}

pub fn cancel_chatgpt_sign_in() {
    if let Ok(mut sender) = SIGN_IN_CANCEL.lock() {
        if let Some(sender) = sender.take() {
            let _ = sender.send(());
        }
    }
}

pub async fn select_chatgpt_profile(profile_id: String) -> Result<ChatGptSession, String> {
    let _guard = SESSION_LOCK.lock().await;
    let disk = storage::LockedStore::open()?;
    let mut state = disk.load()?;
    if !state.profiles.iter().any(|p| p.id == profile_id) {
        return Err("ChatGPT account not found.".into());
    }
    state.active_profile_id = Some(profile_id);
    disk.save(&state)?;
    Ok(session(&state))
}

pub async fn sign_out_chatgpt(profile_id: String) -> Result<Option<String>, String> {
    let _guard = SESSION_LOCK.lock().await;
    let disk = storage::LockedStore::open()?;
    let mut state = disk.load()?;
    let profile = state
        .profiles
        .iter_mut()
        .find(|p| p.id == profile_id)
        .ok_or("ChatGPT account not found.")?;
    let mut warning = None;
    if let Some(tokens) = profile.tokens.take() {
        if auth::revoke(&profile.client_id, &tokens.refresh_token)
            .await
            .is_err()
        {
            warning = Some("Signed out locally. Remote revocation could not be confirmed. Disconnect Tabularis in ChatGPT Settings.".into());
        }
    }
    // Keep the registration and host ID for later reauthorization.
    disk.save(&state)?;
    Ok(warning)
}

pub use inference::{generate, list_models};

pub async fn get_chatgpt_models() -> Result<Vec<inference::ChatGptModel>, String> {
    list_models().await
}
