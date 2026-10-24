use crate::config::*;
use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;
use tauri::Manager;

pub fn get_config_dir<R: tauri::Runtime>(_app: &AppHandle<R>) -> Option<PathBuf> {
    Some(crate::paths::get_app_config_dir())
}

// Internal load
pub fn load_config_internal<R: tauri::Runtime>(app: &AppHandle<R>) -> AppConfig {
    if let Some(config_dir) = get_config_dir(app) {
        let config_path = config_dir.join("config.json");
        if config_path.exists() {
            if let Ok(content) = fs::read_to_string(config_path) {
                if let Ok(mut config) = serde_json::from_str::<AppConfig>(&content) {
                    crate::plugins::compat::migrate_legacy_config(&mut config); // COMPAT(registry-ga)
                    cache_config(&config);
                    return config;
                }
            }
        }
    }
    let default_config = AppConfig::default();
    cache_config(&default_config);
    default_config
}

#[tauri::command]
pub fn get_config(app: AppHandle) -> AppConfig {
    crate::application::persistence::load_config(&app.state::<crate::runtime::RuntimeContext>())
}

#[tauri::command]
pub fn save_config(app: AppHandle, config: AppConfig) -> Result<(), String> {
    let runtime = app.state::<crate::runtime::RuntimeContext>();
    let previous = crate::application::persistence::load_config(&runtime);
    let requested_ping_interval = config.ping_interval;
    let window_decorations_changed = config.window_decorations.is_some()
        && config.window_decorations != previous.window_decorations;
    let saved = crate::application::persistence::save_config(&runtime, config)?;

    if window_decorations_changed {
        crate::transport::desktop::window_decorations::apply_to_all_windows(
            &app,
            saved.window_decorations.as_ref(),
        );
    }
    if requested_ping_interval.is_some() && saved.ping_interval != previous.ping_interval {
        let interval = saved
            .ping_interval
            .unwrap_or(crate::health_check::DEFAULT_PING_INTERVAL);
        crate::async_rt::spawn(crate::transport::desktop::health_check::restart_ping_loop(
            app,
            interval as u64,
        ));
    }
    Ok(())
}

#[tauri::command]
pub fn get_schema_preference(
    app: AppHandle,
    connection_id: String,
    database: Option<String>,
) -> Option<String> {
    crate::application::metadata::get_schema_preference(
        &app.state::<crate::runtime::RuntimeContext>(),
        &connection_id,
        database,
    )
}

#[tauri::command]
pub fn set_schema_preference(
    app: AppHandle,
    connection_id: String,
    schema: String,
    database: Option<String>,
) -> Result<(), String> {
    crate::application::metadata::set_schema_preference(
        &app.state::<crate::runtime::RuntimeContext>(),
        connection_id,
        schema,
        database,
    )
}

#[tauri::command]
pub fn get_last_active_connection(app: AppHandle) -> Option<String> {
    crate::application::persistence::load_config(&app.state::<crate::runtime::RuntimeContext>())
        .last_active_connection_id
}

#[tauri::command]
pub fn set_last_active_connection(
    app: AppHandle,
    connection_id: Option<String>,
) -> Result<(), String> {
    crate::application::persistence::set_last_active_connection_for_desktop(
        &app.state::<crate::runtime::RuntimeContext>(),
        connection_id,
    )
}

#[tauri::command]
pub fn get_last_open_connections(app: AppHandle) -> Vec<String> {
    crate::application::persistence::load_config(&app.state::<crate::runtime::RuntimeContext>())
        .last_open_connection_ids
        .unwrap_or_default()
}

#[tauri::command]
pub fn set_last_open_connections(
    app: AppHandle,
    connection_ids: Vec<String>,
) -> Result<(), String> {
    crate::application::persistence::set_last_open_connections_for_desktop(
        &app.state::<crate::runtime::RuntimeContext>(),
        connection_ids,
    )
}

#[tauri::command]
pub fn get_selected_schemas(
    app: AppHandle,
    connection_id: String,
    database: Option<String>,
) -> Vec<String> {
    crate::application::metadata::get_selected_schemas(
        &app.state::<crate::runtime::RuntimeContext>(),
        &connection_id,
        database,
    )
}

#[tauri::command]
pub fn set_selected_schemas(
    app: AppHandle,
    connection_id: String,
    schemas: Vec<String>,
    database: Option<String>,
) -> Result<(), String> {
    crate::application::metadata::set_selected_schemas(
        &app.state::<crate::runtime::RuntimeContext>(),
        connection_id,
        schemas,
        database,
    )
}

#[tauri::command]
pub fn set_ai_key(app: AppHandle, provider: String, key: String) -> Result<(), String> {
    crate::application::ai::set_key(
        &app.state::<crate::runtime::RuntimeContext>(),
        &app.state::<std::sync::Arc<crate::credential_cache::CredentialCache>>(),
        &provider,
        &key,
    )
}

#[tauri::command]
pub fn delete_ai_key(app: AppHandle, provider: String) -> Result<(), String> {
    crate::application::ai::delete_key(
        &app.state::<crate::runtime::RuntimeContext>(),
        &app.state::<std::sync::Arc<crate::credential_cache::CredentialCache>>(),
        &provider,
    )
}

/// Get the configured maximum BLOB size in bytes, or DEFAULT_MAX_BLOB_SIZE if not set
pub fn get_max_blob_size<R: tauri::Runtime>(app: &AppHandle<R>) -> u64 {
    let config = load_config_internal(app);
    config
        .max_blob_size
        .unwrap_or(crate::drivers::common::DEFAULT_MAX_BLOB_SIZE)
}

pub fn get_ai_api_key(app: &AppHandle, provider: &str) -> Result<String, String> {
    // 1. Try Keychain First (Override) — via the in-memory credential cache so
    //    repeated lookups don't trigger a macOS Keychain authorization prompt
    //    each time. The keychain is read at most once per provider per session.
    let cache = app.state::<std::sync::Arc<crate::credential_cache::CredentialCache>>();
    if let Ok(key) = crate::credential_cache::get_ai_key_cached(&cache, provider) {
        if !key.is_empty() {
            return Ok(key);
        }
    }

    // 2. Try Env Var
    let env_var = match provider {
        "openai" => "OPENAI_API_KEY",
        "anthropic" => "ANTHROPIC_API_KEY",
        "openrouter" => "OPENROUTER_API_KEY",
        "requesty" => "REQUESTY_API_KEY",
        "opper" => "OPPER_API_KEY",
        "custom-openai" => "CUSTOM_OPENAI_API_KEY",
        "minimax" => "MINIMAX_API_KEY",
        _ => "",
    };

    if !env_var.is_empty() {
        if let Ok(key) = std::env::var(env_var) {
            if !key.is_empty() {
                return Ok(key);
            }
        }
    }

    Err(format!(
        "API Key for {} not found in Keychain or Environment",
        provider
    ))
}

pub fn get_ai_api_key_status(app: &AppHandle, provider: &str) -> AiKeyStatus {
    // 1. Check Keychain (through the cache to avoid repeated auth prompts)
    let cache = app.state::<std::sync::Arc<crate::credential_cache::CredentialCache>>();
    let keychain_exists = crate::credential_cache::get_ai_key_cached(&cache, provider).is_ok();

    // 2. Check Env Var
    let env_var = match provider {
        "openai" => "OPENAI_API_KEY",
        "anthropic" => "ANTHROPIC_API_KEY",
        "openrouter" => "OPENROUTER_API_KEY",
        "requesty" => "REQUESTY_API_KEY",
        "opper" => "OPPER_API_KEY",
        "custom-openai" => "CUSTOM_OPENAI_API_KEY",
        "minimax" => "MINIMAX_API_KEY",
        _ => "",
    };

    let env_exists = if !env_var.is_empty() {
        std::env::var(env_var)
            .map(|k| !k.is_empty())
            .unwrap_or(false)
    } else {
        false
    };

    // Configured if either exists
    // from_env is true ONLY if keychain is NOT present but env IS present
    // because keychain overrides env now

    if keychain_exists {
        AiKeyStatus {
            configured: true,
            from_env: false, // Even if env exists, we are using keychain
        }
    } else if env_exists {
        AiKeyStatus {
            configured: true,
            from_env: true,
        }
    } else {
        AiKeyStatus {
            configured: false,
            from_env: false,
        }
    }
}

#[tauri::command]
pub fn check_ai_key(app: AppHandle, provider: String) -> bool {
    crate::application::ai::get_api_key(
        &app.state::<crate::runtime::RuntimeContext>(),
        &app.state::<std::sync::Arc<crate::credential_cache::CredentialCache>>(),
        &provider,
    )
    .is_ok()
}

#[tauri::command]
pub fn check_ai_key_status(
    app: AppHandle,
    provider: String,
) -> crate::application::ai::AiKeyStatus {
    crate::application::ai::key_status(
        &app.state::<crate::runtime::RuntimeContext>(),
        &app.state::<std::sync::Arc<crate::credential_cache::CredentialCache>>(),
        &provider,
    )
}

fn prompt_kind(app: &AppHandle, kind: crate::application::persistence::PromptKind) -> String {
    crate::application::persistence::get_prompt(
        &app.state::<crate::runtime::RuntimeContext>(),
        kind,
    )
}

fn save_prompt_kind(
    app: &AppHandle,
    kind: crate::application::persistence::PromptKind,
    prompt: &str,
) -> Result<(), String> {
    crate::application::persistence::save_prompt(
        &app.state::<crate::runtime::RuntimeContext>(),
        kind,
        prompt,
    )
}

fn reset_prompt_kind(
    app: &AppHandle,
    kind: crate::application::persistence::PromptKind,
) -> Result<String, String> {
    crate::application::persistence::reset_prompt(
        &app.state::<crate::runtime::RuntimeContext>(),
        kind,
    )
}

#[tauri::command]
pub fn get_system_prompt(app: AppHandle) -> String {
    prompt_kind(&app, crate::application::persistence::PromptKind::System)
}

#[tauri::command]
pub fn save_system_prompt(app: AppHandle, prompt: String) -> Result<(), String> {
    save_prompt_kind(
        &app,
        crate::application::persistence::PromptKind::System,
        &prompt,
    )
}

#[tauri::command]
pub fn reset_system_prompt(app: AppHandle) -> Result<String, String> {
    reset_prompt_kind(&app, crate::application::persistence::PromptKind::System)
}

#[tauri::command]
pub fn get_explain_prompt(app: AppHandle) -> String {
    prompt_kind(&app, crate::application::persistence::PromptKind::Explain)
}

#[tauri::command]
pub fn save_explain_prompt(app: AppHandle, prompt: String) -> Result<(), String> {
    save_prompt_kind(
        &app,
        crate::application::persistence::PromptKind::Explain,
        &prompt,
    )
}

#[tauri::command]
pub fn reset_explain_prompt(app: AppHandle) -> Result<String, String> {
    reset_prompt_kind(&app, crate::application::persistence::PromptKind::Explain)
}

#[tauri::command]
pub fn get_explainplan_prompt(app: AppHandle) -> String {
    prompt_kind(
        &app,
        crate::application::persistence::PromptKind::ExplainPlan,
    )
}

#[tauri::command]
pub fn save_explainplan_prompt(app: AppHandle, prompt: String) -> Result<(), String> {
    save_prompt_kind(
        &app,
        crate::application::persistence::PromptKind::ExplainPlan,
        &prompt,
    )
}

#[tauri::command]
pub fn reset_explainplan_prompt(app: AppHandle) -> Result<String, String> {
    reset_prompt_kind(
        &app,
        crate::application::persistence::PromptKind::ExplainPlan,
    )
}

#[tauri::command]
pub fn get_cellname_prompt(app: AppHandle) -> String {
    prompt_kind(&app, crate::application::persistence::PromptKind::CellName)
}

#[tauri::command]
pub fn save_cellname_prompt(app: AppHandle, prompt: String) -> Result<(), String> {
    save_prompt_kind(
        &app,
        crate::application::persistence::PromptKind::CellName,
        &prompt,
    )
}

#[tauri::command]
pub fn reset_cellname_prompt(app: AppHandle) -> Result<String, String> {
    reset_prompt_kind(&app, crate::application::persistence::PromptKind::CellName)
}

#[tauri::command]
pub fn get_tabrename_prompt(app: AppHandle) -> String {
    prompt_kind(&app, crate::application::persistence::PromptKind::TabRename)
}

#[tauri::command]
pub fn save_tabrename_prompt(app: AppHandle, prompt: String) -> Result<(), String> {
    save_prompt_kind(
        &app,
        crate::application::persistence::PromptKind::TabRename,
        &prompt,
    )
}

#[tauri::command]
pub fn reset_tabrename_prompt(app: AppHandle) -> Result<String, String> {
    reset_prompt_kind(&app, crate::application::persistence::PromptKind::TabRename)
}

#[tauri::command]
pub fn get_config_json(app: AppHandle) -> Result<String, String> {
    crate::application::persistence::get_config_json_for_desktop(
        &app.state::<crate::runtime::RuntimeContext>(),
    )
}

#[tauri::command]
pub fn relaunch_app(app: AppHandle) {
    crate::transport::desktop::window_placement::persist_cached(&app);
    app.restart();
}

#[tauri::command]
pub fn save_config_json(app: AppHandle, json: String) -> Result<(), String> {
    crate::application::persistence::save_config_json_for_desktop(
        &app.state::<crate::runtime::RuntimeContext>(),
        &json,
    )
}
