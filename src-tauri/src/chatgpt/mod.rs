//! ChatGPT plan usage for the local desktop app. Credentials never cross IPC.
mod api_errors;
mod auth;
mod inference;
mod protocol;
mod storage;

#[cfg(test)]
mod tests;

use serde::Serialize;
use std::sync::Mutex;
use storage::session;
use tokio::sync::oneshot;

const ISSUER: &str = "https://auth.openai.com";
const RESOURCE: &str = "https://api.openai.com/v1";
const PLAN_SCOPE: &str = "chatgpt.tokens.use.direct";
static SESSION_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
static SIGN_IN_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
static SIGN_IN_CANCEL: Mutex<Option<oneshot::Sender<()>>> = Mutex::new(None);

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

fn http_client() -> Result<reqwest::Client, String> {
    crate::proxy::ai_http_client("chatgpt")
}

#[tauri::command]
pub async fn get_chatgpt_session() -> Result<ChatGptSession, String> {
    let _guard = SESSION_LOCK.lock().await;
    let disk = storage::LockedStore::open()?;
    Ok(session(&disk.load()?))
}

#[tauri::command]
pub async fn sign_in_chatgpt(
    app: tauri::AppHandle,
    profile_id: Option<String>,
) -> Result<ChatGptSession, String> {
    let _sign_in = SIGN_IN_LOCK
        .try_lock()
        .map_err(|_| "Another ChatGPT sign-in is running.")?;
    let (cancel, cancelled) = oneshot::channel();
    *SIGN_IN_CANCEL
        .lock()
        .map_err(|_| "ChatGPT sign-in lock is unavailable.")? = Some(cancel);
    let attempt = async {
        let state = {
            let _guard = SESSION_LOCK.lock().await;
            let disk = storage::LockedStore::open()?;
            let state = disk.load()?;
            // Persist the installation ID before opening the browser.
            disk.save(&state)?;
            state
        };
        auth::sign_in(&app, state, profile_id.as_deref()).await
    };
    let result = tokio::select! {
        result = tokio::time::timeout(std::time::Duration::from_secs(300), attempt) => {
            result.map_err(|_| "ChatGPT sign-in timed out. Please try again.".to_string()).and_then(|r| r)
        }
        _ = cancelled => Err("ChatGPT sign-in cancelled.".to_string()),
    };
    SIGN_IN_CANCEL
        .lock()
        .map_err(|_| "ChatGPT sign-in lock is unavailable.")?
        .take();
    Ok(session(&result?))
}

#[tauri::command]
pub fn cancel_chatgpt_sign_in() {
    if let Ok(mut sender) = SIGN_IN_CANCEL.lock() {
        if let Some(sender) = sender.take() {
            let _ = sender.send(());
        }
    }
}

#[tauri::command]
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

#[tauri::command]
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

#[tauri::command]
pub fn open_chatgpt_usage(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url("https://chatgpt.com/#settings/Usage", None::<&str>)
        .map_err(|_| "Could not open ChatGPT usage settings.".into())
}

pub use inference::{generate, list_models};

#[tauri::command]
pub async fn get_chatgpt_models() -> Result<Vec<inference::ChatGptModel>, String> {
    list_models().await
}
