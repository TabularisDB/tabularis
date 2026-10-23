pub mod auth;

use crate::chatgpt::storage::session;
use crate::chatgpt::*;
use tokio::sync::oneshot;

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
pub fn open_chatgpt_usage(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url("https://chatgpt.com/#settings/Usage", None::<&str>)
        .map_err(|_| "Could not open ChatGPT usage settings.".into())
}

#[tauri::command]
pub async fn get_chatgpt_session() -> Result<ChatGptSession, String> {
    crate::chatgpt::get_chatgpt_session().await
}

#[tauri::command]
pub fn cancel_chatgpt_sign_in() {
    crate::chatgpt::cancel_chatgpt_sign_in()
}

#[tauri::command]
pub async fn select_chatgpt_profile(profile_id: String) -> Result<ChatGptSession, String> {
    crate::chatgpt::select_chatgpt_profile(profile_id).await
}

#[tauri::command]
pub async fn sign_out_chatgpt(profile_id: String) -> Result<Option<String>, String> {
    crate::chatgpt::sign_out_chatgpt(profile_id).await
}

#[tauri::command]
pub async fn get_chatgpt_models() -> Result<Vec<inference::ChatGptModel>, String> {
    crate::chatgpt::get_chatgpt_models().await
}
