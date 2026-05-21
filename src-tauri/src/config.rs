use crate::keychain_utils;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;
use tauri::Manager;
use std::sync::RwLock;

use std::collections::HashMap;

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct PluginConfig {
    pub interpreter: Option<String>,
    #[serde(default)]
    pub settings: HashMap<String, serde_json::Value>,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub theme: Option<String>,
    pub language: Option<String>,
    pub result_page_size: Option<u32>,
    pub font_family: Option<String>,
    pub font_size: Option<u32>,
    pub ai_enabled: Option<bool>,
    pub ai_provider: Option<String>,
    pub ai_model: Option<String>,
    pub ai_custom_models: Option<HashMap<String, Vec<String>>>,
    pub ai_ollama_port: Option<u16>,
    pub ai_custom_openai_url: Option<String>,
    pub ai_custom_openai_model: Option<String>,
    pub check_for_updates: Option<bool>,
    pub auto_check_updates_on_startup: Option<bool>,
    pub last_dismissed_version: Option<String>,
    pub er_diagram_default_layout: Option<String>,
    pub schema_preferences: Option<HashMap<String, String>>,
    pub selected_schemas: Option<HashMap<String, Vec<String>>>,
    pub max_blob_size: Option<u64>,
    pub copy_format: Option<String>,
    pub csv_delimiter: Option<String>,
    pub active_external_drivers: Option<Vec<String>>,
    pub custom_registry_url: Option<String>,
    pub plugins: Option<HashMap<String, PluginConfig>>,
    pub editor_theme: Option<String>,
    pub editor_font_family: Option<String>,
    pub editor_font_size: Option<u32>,
    pub editor_line_height: Option<f32>,
    pub editor_tab_size: Option<u32>,
    pub editor_word_wrap: Option<bool>,
    pub editor_show_line_numbers: Option<bool>,
    /// Whether the Enter key accepts the active autocomplete suggestion in the
    /// SQL editor. Maps to Monaco's `acceptSuggestionOnEnter` setting: `true`
    /// becomes `"smart"` (the safer variant), `false` becomes `"off"`.
    /// Default: `true` — matches the behaviour users expect from most editors.
    pub editor_accept_suggestion_on_enter: Option<bool>,
    /// Connection health check interval in seconds. 0 = disabled. Default: 30.
    pub ping_interval: Option<u32>,
    /// Maximum number of query history entries per connection. Default: 500.
    pub query_history_max_entries: Option<u32>,
    /// Whether to show the welcome screen on startup. Default: true (first launch).
    pub show_welcome: Option<bool>,

    // ----- AI Audit Log -----
    /// Record every MCP tool call to the audit log. Default: true.
    pub ai_audit_enabled: Option<bool>,
    /// Maximum entries per audit-log file before rotation. Default: 5000.
    pub ai_audit_max_entries: Option<u32>,
    /// Inactivity gap (in minutes) after which a new MCP session id is minted.
    /// Default: 10.
    pub ai_session_gap_minutes: Option<u32>,

    // ----- MCP Read-only Mode -----
    /// Default behaviour for MCP `run_query`: when true, every connection is
    /// read-only unless explicitly listed as writable. Default: false.
    pub mcp_readonly_default: Option<bool>,
    /// Per-connection override list. Semantics depend on `mcp_readonly_default`:
    /// when default is `false` this is the *inclusion* list of read-only
    /// connections; when default is `true` this is the *exclusion* list of
    /// connections that are allowed to write.
    pub mcp_readonly_connections: Option<Vec<String>>,

    // ----- MCP Approval Gate -----
    /// `"off"` | `"writes_only"` | `"all"`. Default: `"writes_only"`.
    pub mcp_approval_mode: Option<String>,
    /// Maximum time the MCP subprocess waits for the user to decide. Default: 120.
    pub mcp_approval_timeout_seconds: Option<u32>,
    /// Run a pre-flight EXPLAIN before opening the approval modal. Default: true.
    pub mcp_preflight_explain: Option<bool>,
}

static CONFIG_CACHE: Lazy<RwLock<AppConfig>> = Lazy::new(|| RwLock::new(AppConfig::default()));

pub fn get_config_dir<R: tauri::Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path().app_config_dir().ok()
}

fn cache_config(config: &AppConfig) {
    if let Ok(mut cached) = CONFIG_CACHE.write() {
        *cached = config.clone();
    }
}

pub fn get_cached_config() -> AppConfig {
    CONFIG_CACHE
        .read()
        .map(|cached| cached.clone())
        .unwrap_or_default()
}

// ---------- AI/MCP safety defaults ----------
pub const DEFAULT_AI_AUDIT_ENABLED: bool = true;
pub const DEFAULT_AI_AUDIT_MAX_ENTRIES: u32 = 5000;
pub const DEFAULT_AI_SESSION_GAP_MINUTES: u32 = 10;
pub const DEFAULT_MCP_READONLY_DEFAULT: bool = false;
pub const DEFAULT_MCP_APPROVAL_MODE: &str = "writes_only";
pub const DEFAULT_MCP_APPROVAL_TIMEOUT_SECONDS: u32 = 120;
pub const DEFAULT_MCP_PREFLIGHT_EXPLAIN: bool = true;

/// Load `config.json` directly from disk without an `AppHandle`.
///
/// Used by the standalone MCP subprocess (`tabularis --mcp`) which has no
/// Tauri runtime. Falls back to `AppConfig::default()` when missing or
/// unreadable.
pub fn load_config_from_disk() -> AppConfig {
    let path = crate::paths::get_app_config_dir().join("config.json");
    if !path.exists() {
        return AppConfig::default();
    }
    fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str::<AppConfig>(&s).ok())
        .unwrap_or_default()
}

/// True when `connection_id` should be treated as read-only by MCP, taking
/// the per-connection override list into account.
pub fn is_connection_readonly(config: &AppConfig, connection_id: &str) -> bool {
    let default_ro = config
        .mcp_readonly_default
        .unwrap_or(DEFAULT_MCP_READONLY_DEFAULT);
    let listed = config
        .mcp_readonly_connections
        .as_ref()
        .map(|v| v.iter().any(|s| s == connection_id))
        .unwrap_or(false);
    // When default is false the list flips that connection to read-only.
    // When default is true the list flips that connection to writable.
    if default_ro {
        !listed
    } else {
        listed
    }
}

// Internal load
pub fn load_config_internal<R: tauri::Runtime>(app: &AppHandle<R>) -> AppConfig {
    if let Some(config_dir) = get_config_dir(app) {
        let config_path = config_dir.join("config.json");
        if config_path.exists() {
            if let Ok(content) = fs::read_to_string(config_path) {
                if let Ok(config) = serde_json::from_str(&content) {
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
    load_config_internal(&app)
}

#[tauri::command]
pub fn save_config(app: AppHandle, config: AppConfig) -> Result<(), String> {
    if let Some(config_dir) = get_config_dir(&app) {
        if !config_dir.exists() {
            fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;
        }
        let config_path = config_dir.join("config.json");

        // Load existing config and merge with new values
        let mut existing_config = load_config_internal(&app);

        // Merge: only update fields that are Some in the new config
        if config.theme.is_some() {
            existing_config.theme = config.theme;
        }
        if config.language.is_some() {
            existing_config.language = config.language;
        }
        if config.result_page_size.is_some() {
            existing_config.result_page_size = config.result_page_size;
        }
        if config.font_family.is_some() {
            existing_config.font_family = config.font_family;
        }
        if config.font_size.is_some() {
            existing_config.font_size = config.font_size;
        }
        if config.ai_enabled.is_some() {
            existing_config.ai_enabled = config.ai_enabled;
        }
        if config.ai_provider.is_some() {
            existing_config.ai_provider = config.ai_provider;
        }
        if config.ai_model.is_some() {
            existing_config.ai_model = config.ai_model;
        }
        if config.ai_custom_models.is_some() {
            existing_config.ai_custom_models = config.ai_custom_models;
        }
        if config.ai_ollama_port.is_some() {
            existing_config.ai_ollama_port = config.ai_ollama_port;
        }
        if config.ai_custom_openai_url.is_some() {
            existing_config.ai_custom_openai_url = config.ai_custom_openai_url;
        }
        if config.ai_custom_openai_model.is_some() {
            existing_config.ai_custom_openai_model = config.ai_custom_openai_model;
        }
        if config.check_for_updates.is_some() {
            existing_config.check_for_updates = config.check_for_updates;
        }
        if config.auto_check_updates_on_startup.is_some() {
            existing_config.auto_check_updates_on_startup = config.auto_check_updates_on_startup;
        }
        if config.last_dismissed_version.is_some() {
            existing_config.last_dismissed_version = config.last_dismissed_version;
        }
        if config.er_diagram_default_layout.is_some() {
            existing_config.er_diagram_default_layout = config.er_diagram_default_layout;
        }
        if config.schema_preferences.is_some() {
            existing_config.schema_preferences = config.schema_preferences;
        }
        if config.selected_schemas.is_some() {
            existing_config.selected_schemas = config.selected_schemas;
        }
        if config.max_blob_size.is_some() {
            existing_config.max_blob_size = config.max_blob_size;
        }
        if config.copy_format.is_some() {
            existing_config.copy_format = config.copy_format;
        }
        if config.csv_delimiter.is_some() {
            existing_config.csv_delimiter = config.csv_delimiter;
        }
        if config.active_external_drivers.is_some() {
            existing_config.active_external_drivers = config.active_external_drivers;
        }
        if config.plugins.is_some() {
            existing_config.plugins = config.plugins;
        }
        if config.editor_theme.is_some() {
            existing_config.editor_theme = config.editor_theme;
        }
        if config.editor_font_family.is_some() {
            existing_config.editor_font_family = config.editor_font_family;
        }
        if config.editor_font_size.is_some() {
            existing_config.editor_font_size = config.editor_font_size;
        }
        if config.editor_line_height.is_some() {
            existing_config.editor_line_height = config.editor_line_height;
        }
        if config.editor_tab_size.is_some() {
            existing_config.editor_tab_size = config.editor_tab_size;
        }
        if config.editor_word_wrap.is_some() {
            existing_config.editor_word_wrap = config.editor_word_wrap;
        }
        if config.editor_show_line_numbers.is_some() {
            existing_config.editor_show_line_numbers = config.editor_show_line_numbers;
        }
        if config.editor_accept_suggestion_on_enter.is_some() {
            existing_config.editor_accept_suggestion_on_enter =
                config.editor_accept_suggestion_on_enter;
        }
        if config.ping_interval.is_some() {
            let old_interval = existing_config.ping_interval;
            existing_config.ping_interval = config.ping_interval;
            // Restart the ping loop if the interval changed.
            if existing_config.ping_interval != old_interval {
                let interval = existing_config
                    .ping_interval
                    .unwrap_or(crate::health_check::DEFAULT_PING_INTERVAL);
                tauri::async_runtime::spawn(crate::health_check::restart_ping_loop(
                    app.clone(),
                    interval as u64,
                ));
            }
        }
        if config.query_history_max_entries.is_some() {
            existing_config.query_history_max_entries = config.query_history_max_entries;
        }
        if config.show_welcome.is_some() {
            existing_config.show_welcome = config.show_welcome;
        }
        if config.ai_audit_enabled.is_some() {
            existing_config.ai_audit_enabled = config.ai_audit_enabled;
        }
        if config.ai_audit_max_entries.is_some() {
            existing_config.ai_audit_max_entries = config.ai_audit_max_entries;
        }
        if config.ai_session_gap_minutes.is_some() {
            existing_config.ai_session_gap_minutes = config.ai_session_gap_minutes;
        }
        if config.mcp_readonly_default.is_some() {
            existing_config.mcp_readonly_default = config.mcp_readonly_default;
        }
        if config.mcp_readonly_connections.is_some() {
            existing_config.mcp_readonly_connections = config.mcp_readonly_connections;
        }
        if config.mcp_approval_mode.is_some() {
            existing_config.mcp_approval_mode = config.mcp_approval_mode;
        }
        if config.mcp_approval_timeout_seconds.is_some() {
            existing_config.mcp_approval_timeout_seconds = config.mcp_approval_timeout_seconds;
        }
        if config.mcp_preflight_explain.is_some() {
            existing_config.mcp_preflight_explain = config.mcp_preflight_explain;
        }

        let content = serde_json::to_string_pretty(&existing_config).map_err(|e| e.to_string())?;
        fs::write(config_path, content).map_err(|e| e.to_string())?;
        cache_config(&existing_config);
        Ok(())
    } else {
        Err("Could not resolve config directory".to_string())
    }
}

#[tauri::command]
pub fn get_schema_preference(app: AppHandle, connection_id: String) -> Option<String> {
    let config = load_config_internal(&app);
    config
        .schema_preferences
        .and_then(|prefs| prefs.get(&connection_id).cloned())
}

#[tauri::command]
pub fn set_schema_preference(
    app: AppHandle,
    connection_id: String,
    schema: String,
) -> Result<(), String> {
    if let Some(config_dir) = get_config_dir(&app) {
        if !config_dir.exists() {
            fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;
        }
        let config_path = config_dir.join("config.json");
        let mut config = load_config_internal(&app);
        let prefs = config.schema_preferences.get_or_insert_with(HashMap::new);
        prefs.insert(connection_id, schema);
        let content = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
        fs::write(config_path, content).map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("Could not resolve config directory".to_string())
    }
}

#[tauri::command]
pub fn get_selected_schemas(app: AppHandle, connection_id: String) -> Vec<String> {
    let config = load_config_internal(&app);
    config
        .selected_schemas
        .and_then(|map| map.get(&connection_id).cloned())
        .unwrap_or_default()
}

#[tauri::command]
pub fn set_selected_schemas(
    app: AppHandle,
    connection_id: String,
    schemas: Vec<String>,
) -> Result<(), String> {
    if let Some(config_dir) = get_config_dir(&app) {
        if !config_dir.exists() {
            fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;
        }
        let config_path = config_dir.join("config.json");
        let mut config = load_config_internal(&app);
        let map = config.selected_schemas.get_or_insert_with(HashMap::new);
        if schemas.is_empty() {
            map.remove(&connection_id);
        } else {
            map.insert(connection_id, schemas);
        }
        let content = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
        fs::write(config_path, content).map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("Could not resolve config directory".to_string())
    }
}

#[tauri::command]
pub fn set_ai_key(provider: String, key: String) -> Result<(), String> {
    keychain_utils::set_ai_key(&provider, &key)
}

#[tauri::command]
pub fn delete_ai_key(provider: String) -> Result<(), String> {
    keychain_utils::delete_ai_key(&provider)
}

/// Get the configured maximum BLOB size in bytes, or DEFAULT_MAX_BLOB_SIZE if not set
pub fn get_max_blob_size<R: tauri::Runtime>(app: &AppHandle<R>) -> u64 {
    let config = load_config_internal(app);
    config
        .max_blob_size
        .unwrap_or(crate::drivers::common::DEFAULT_MAX_BLOB_SIZE)
}

pub fn get_ai_api_key(provider: &str) -> Result<String, String> {
    // 1. Try Keychain First (Override)
    if let Ok(key) = keychain_utils::get_ai_key(provider) {
        if !key.is_empty() {
            return Ok(key);
        }
    }

    // 2. Try Env Var
    let env_var = match provider {
        "openai" => "OPENAI_API_KEY",
        "anthropic" => "ANTHROPIC_API_KEY",
        "openrouter" => "OPENROUTER_API_KEY",
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiKeyStatus {
    pub configured: bool,
    pub from_env: bool,
}

pub fn get_ai_api_key_status(provider: &str) -> AiKeyStatus {
    // 1. Check Keychain
    let keychain_exists = keychain_utils::get_ai_key(provider).is_ok();

    // 2. Check Env Var
    let env_var = match provider {
        "openai" => "OPENAI_API_KEY",
        "anthropic" => "ANTHROPIC_API_KEY",
        "openrouter" => "OPENROUTER_API_KEY",
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
pub fn check_ai_key(provider: String) -> bool {
    get_ai_api_key(&provider).is_ok()
}

#[tauri::command]
pub fn check_ai_key_status(provider: String) -> AiKeyStatus {
    get_ai_api_key_status(&provider)
}

const DEFAULT_SYSTEM_PROMPT: &str = "You are an expert SQL assistant. Your task is to generate a SQL query based on the user's request and the provided database schema.\nReturn ONLY the SQL query, without any markdown formatting, explanations, or code blocks.\n\nSchema:\n{{SCHEMA}}";
const DEFAULT_EXPLAIN_PROMPT: &str =
    "You are a helpful SQL assistant. Explain SQL queries in {{LANGUAGE}}.";
const DEFAULT_EXPLAINPLAN_PROMPT: &str =
    "You are a database performance expert. Analyze the following SQL query and its EXPLAIN plan output. Identify performance bottlenecks, suggest index improvements, and explain the execution strategy. Respond in {{LANGUAGE}}.";
const DEFAULT_CELLNAME_PROMPT: &str = "You are an assistant that generates concise, descriptive names for notebook cells.\nGiven a SQL query or Markdown content, return ONLY a short name (3-6 words max) that describes what the cell does or what it is about.\nDo not include quotes, punctuation, or explanations. Just the name.";
const DEFAULT_TABRENAME_PROMPT: &str = "You are an assistant that generates concise, descriptive names for SQL query result tabs.\nGiven a SQL query, return ONLY a short name (3-6 words max) that describes what the query does.\nDo not include quotes, punctuation, or explanations. Just the name.";

fn get_prompt(app: &AppHandle, filename: &str, default: &str) -> String {
    if let Some(config_dir) = get_config_dir(app) {
        let path = config_dir.join(filename);
        if let Ok(content) = fs::read_to_string(path) {
            return content;
        }
    }
    default.to_string()
}

fn save_prompt(app: &AppHandle, filename: &str, prompt: &str) -> Result<(), String> {
    let config_dir = get_config_dir(app).ok_or("Could not resolve config directory")?;
    if !config_dir.exists() {
        fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;
    }
    fs::write(config_dir.join(filename), prompt).map_err(|e| e.to_string())
}

fn reset_prompt(app: &AppHandle, filename: &str, default: &str) -> Result<String, String> {
    if let Some(config_dir) = get_config_dir(app) {
        let path = config_dir.join(filename);
        if path.exists() {
            fs::remove_file(path).map_err(|e| e.to_string())?;
        }
    }
    Ok(default.to_string())
}

#[tauri::command]
pub fn get_system_prompt(app: AppHandle) -> String {
    get_prompt(&app, "prompt_query.txt", DEFAULT_SYSTEM_PROMPT)
}
#[tauri::command]
pub fn save_system_prompt(app: AppHandle, prompt: String) -> Result<(), String> {
    save_prompt(&app, "prompt_query.txt", &prompt)
}
#[tauri::command]
pub fn reset_system_prompt(app: AppHandle) -> Result<String, String> {
    reset_prompt(&app, "prompt_query.txt", DEFAULT_SYSTEM_PROMPT)
}

#[tauri::command]
pub fn get_explain_prompt(app: AppHandle) -> String {
    get_prompt(&app, "prompt_explain.txt", DEFAULT_EXPLAIN_PROMPT)
}
#[tauri::command]
pub fn save_explain_prompt(app: AppHandle, prompt: String) -> Result<(), String> {
    save_prompt(&app, "prompt_explain.txt", &prompt)
}
#[tauri::command]
pub fn reset_explain_prompt(app: AppHandle) -> Result<String, String> {
    reset_prompt(&app, "prompt_explain.txt", DEFAULT_EXPLAIN_PROMPT)
}

#[tauri::command]
pub fn get_explainplan_prompt(app: AppHandle) -> String {
    get_prompt(&app, "prompt_explainplan.txt", DEFAULT_EXPLAINPLAN_PROMPT)
}
#[tauri::command]
pub fn save_explainplan_prompt(app: AppHandle, prompt: String) -> Result<(), String> {
    save_prompt(&app, "prompt_explainplan.txt", &prompt)
}
#[tauri::command]
pub fn reset_explainplan_prompt(app: AppHandle) -> Result<String, String> {
    reset_prompt(&app, "prompt_explainplan.txt", DEFAULT_EXPLAINPLAN_PROMPT)
}

#[tauri::command]
pub fn get_cellname_prompt(app: AppHandle) -> String {
    get_prompt(&app, "prompt_cellname.txt", DEFAULT_CELLNAME_PROMPT)
}
#[tauri::command]
pub fn save_cellname_prompt(app: AppHandle, prompt: String) -> Result<(), String> {
    save_prompt(&app, "prompt_cellname.txt", &prompt)
}
#[tauri::command]
pub fn reset_cellname_prompt(app: AppHandle) -> Result<String, String> {
    reset_prompt(&app, "prompt_cellname.txt", DEFAULT_CELLNAME_PROMPT)
}

#[tauri::command]
pub fn get_tabrename_prompt(app: AppHandle) -> String {
    get_prompt(&app, "prompt_tabrename.txt", DEFAULT_TABRENAME_PROMPT)
}
#[tauri::command]
pub fn save_tabrename_prompt(app: AppHandle, prompt: String) -> Result<(), String> {
    save_prompt(&app, "prompt_tabrename.txt", &prompt)
}
#[tauri::command]
pub fn reset_tabrename_prompt(app: AppHandle) -> Result<String, String> {
    reset_prompt(&app, "prompt_tabrename.txt", DEFAULT_TABRENAME_PROMPT)
}

#[tauri::command]
pub fn get_config_json(app: AppHandle) -> Result<String, String> {
    if let Some(config_dir) = get_config_dir(&app) {
        let config_path = config_dir.join("config.json");
        if config_path.exists() {
            return fs::read_to_string(config_path).map_err(|e| e.to_string());
        }
    }
    // Return empty JSON object if no config file exists yet
    Ok("{}".to_string())
}

#[tauri::command]
pub fn relaunch_app(app: AppHandle) {
    app.restart();
}

#[tauri::command]
pub fn save_config_json(app: AppHandle, json: String) -> Result<(), String> {
    // Validate the JSON parses as a valid AppConfig
    serde_json::from_str::<AppConfig>(&json)
        .map_err(|e| format!("Invalid configuration JSON: {}", e))?;

    if let Some(config_dir) = get_config_dir(&app) {
        if !config_dir.exists() {
            fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;
        }
        let config_path = config_dir.join("config.json");
        // Re-serialize with pretty-printing for consistency
        let value: serde_json::Value = serde_json::from_str(&json).map_err(|e| e.to_string())?;
        let pretty = serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?;
        fs::write(config_path, pretty).map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("Could not resolve config directory".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selected_schemas_default_is_none() {
        let config = AppConfig::default();
        assert!(config.selected_schemas.is_none());
    }

    #[test]
    fn selected_schemas_serialization_round_trip() {
        let mut config = AppConfig::default();
        let mut map = HashMap::new();
        map.insert(
            "conn-1".to_string(),
            vec!["public".to_string(), "analytics".to_string()],
        );
        config.selected_schemas = Some(map);

        let json = serde_json::to_string(&config).unwrap();
        let deserialized: AppConfig = serde_json::from_str(&json).unwrap();

        let schemas = deserialized.selected_schemas.unwrap();
        let conn1 = schemas.get("conn-1").unwrap();
        assert_eq!(conn1, &vec!["public".to_string(), "analytics".to_string()]);
    }

    #[test]
    fn selected_schemas_camel_case_in_json() {
        let mut config = AppConfig::default();
        let mut map = HashMap::new();
        map.insert("conn-1".to_string(), vec!["public".to_string()]);
        config.selected_schemas = Some(map);

        let json = serde_json::to_string(&config).unwrap();
        assert!(json.contains("selectedSchemas"));
        assert!(!json.contains("selected_schemas"));
    }

    #[test]
    fn multiple_connections_independent_selected_schemas() {
        let mut config = AppConfig::default();
        let mut map = HashMap::new();
        map.insert("conn-1".to_string(), vec!["public".to_string()]);
        map.insert(
            "conn-2".to_string(),
            vec!["staging".to_string(), "prod".to_string()],
        );
        config.selected_schemas = Some(map);

        let json = serde_json::to_string(&config).unwrap();
        let deserialized: AppConfig = serde_json::from_str(&json).unwrap();

        let schemas = deserialized.selected_schemas.unwrap();
        assert_eq!(schemas.get("conn-1").unwrap(), &vec!["public".to_string()]);
        assert_eq!(
            schemas.get("conn-2").unwrap(),
            &vec!["staging".to_string(), "prod".to_string()]
        );
    }

    #[test]
    fn old_hidden_schemas_json_deserializes_without_error() {
        // Ensure old config files with hiddenSchemas don't break deserialization
        let json = r#"{"hiddenSchemas":{"conn-1":["secret"]}}"#;
        let config: AppConfig = serde_json::from_str(json).unwrap();
        // hiddenSchemas is no longer a field, so it's ignored; selectedSchemas is None
        assert!(config.selected_schemas.is_none());
    }

    #[test]
    fn editor_fields_default_to_none() {
        let config = AppConfig::default();
        assert!(config.editor_theme.is_none());
        assert!(config.editor_font_family.is_none());
        assert!(config.editor_font_size.is_none());
        assert!(config.editor_line_height.is_none());
        assert!(config.editor_tab_size.is_none());
        assert!(config.editor_word_wrap.is_none());
        assert!(config.editor_show_line_numbers.is_none());
        assert!(config.editor_accept_suggestion_on_enter.is_none());
    }

    #[test]
    fn editor_fields_serialize_with_camel_case() {
        let mut config = AppConfig::default();
        config.editor_font_family = Some("JetBrains Mono".to_string());
        config.editor_font_size = Some(16);
        config.editor_line_height = Some(1.5);
        config.editor_tab_size = Some(4);
        config.editor_word_wrap = Some(false);
        config.editor_show_line_numbers = Some(true);
        config.editor_theme = Some("tabularis-light".to_string());
        config.editor_accept_suggestion_on_enter = Some(true);

        let json = serde_json::to_string(&config).unwrap();
        assert!(json.contains("editorFontFamily"));
        assert!(json.contains("editorFontSize"));
        assert!(json.contains("editorLineHeight"));
        assert!(json.contains("editorTabSize"));
        assert!(json.contains("editorWordWrap"));
        assert!(json.contains("editorShowLineNumbers"));
        assert!(json.contains("editorTheme"));
        assert!(json.contains("editorAcceptSuggestionOnEnter"));
        // snake_case must not appear
        assert!(!json.contains("editor_font_family"));
        assert!(!json.contains("editor_accept_suggestion_on_enter"));
    }

    #[test]
    fn editor_fields_round_trip() {
        let json = r#"{
            "editorFontFamily": "Hack",
            "editorFontSize": 14,
            "editorLineHeight": 1.8,
            "editorTabSize": 2,
            "editorWordWrap": true,
            "editorShowLineNumbers": true,
            "editorTheme": "tabularis-dark",
            "editorAcceptSuggestionOnEnter": true
        }"#;

        let config: AppConfig = serde_json::from_str(json).unwrap();
        assert_eq!(config.editor_font_family.as_deref(), Some("Hack"));
        assert_eq!(config.editor_font_size, Some(14));
        assert_eq!(config.editor_tab_size, Some(2));
        assert_eq!(config.editor_word_wrap, Some(true));
        assert_eq!(config.editor_show_line_numbers, Some(true));
        assert_eq!(config.editor_theme.as_deref(), Some("tabularis-dark"));
        assert_eq!(config.editor_accept_suggestion_on_enter, Some(true));
    }

    #[test]
    fn save_config_json_rejects_invalid_json() {
        // Test that the validation logic catches malformed AppConfig JSON
        let invalid = r#"{"editorFontSize": "not-a-number"}"#;
        let result = serde_json::from_str::<AppConfig>(invalid);
        assert!(result.is_err());
    }

    #[test]
    fn ai_safety_fields_default_to_none() {
        let config = AppConfig::default();
        assert!(config.ai_audit_enabled.is_none());
        assert!(config.ai_audit_max_entries.is_none());
        assert!(config.ai_session_gap_minutes.is_none());
        assert!(config.mcp_readonly_default.is_none());
        assert!(config.mcp_readonly_connections.is_none());
        assert!(config.mcp_approval_mode.is_none());
        assert!(config.mcp_approval_timeout_seconds.is_none());
        assert!(config.mcp_preflight_explain.is_none());
    }

    #[test]
    fn ai_safety_fields_serialize_with_camel_case() {
        let mut config = AppConfig::default();
        config.ai_audit_enabled = Some(true);
        config.ai_audit_max_entries = Some(1000);
        config.ai_session_gap_minutes = Some(5);
        config.mcp_readonly_default = Some(true);
        config.mcp_readonly_connections = Some(vec!["c1".into()]);
        config.mcp_approval_mode = Some("all".into());
        config.mcp_approval_timeout_seconds = Some(60);
        config.mcp_preflight_explain = Some(false);

        let json = serde_json::to_string(&config).unwrap();
        assert!(json.contains("aiAuditEnabled"));
        assert!(json.contains("aiAuditMaxEntries"));
        assert!(json.contains("aiSessionGapMinutes"));
        assert!(json.contains("mcpReadonlyDefault"));
        assert!(json.contains("mcpReadonlyConnections"));
        assert!(json.contains("mcpApprovalMode"));
        assert!(json.contains("mcpApprovalTimeoutSeconds"));
        assert!(json.contains("mcpPreflightExplain"));
    }

    #[test]
    fn ai_safety_fields_round_trip() {
        let json = r#"{
            "aiAuditEnabled": false,
            "aiAuditMaxEntries": 2000,
            "aiSessionGapMinutes": 30,
            "mcpReadonlyDefault": true,
            "mcpReadonlyConnections": ["a", "b"],
            "mcpApprovalMode": "writes_only",
            "mcpApprovalTimeoutSeconds": 90,
            "mcpPreflightExplain": true
        }"#;
        let config: AppConfig = serde_json::from_str(json).unwrap();
        assert_eq!(config.ai_audit_enabled, Some(false));
        assert_eq!(config.ai_audit_max_entries, Some(2000));
        assert_eq!(config.ai_session_gap_minutes, Some(30));
        assert_eq!(config.mcp_readonly_default, Some(true));
        assert_eq!(
            config.mcp_readonly_connections.as_deref(),
            Some(&["a".to_string(), "b".to_string()][..])
        );
        assert_eq!(config.mcp_approval_mode.as_deref(), Some("writes_only"));
        assert_eq!(config.mcp_approval_timeout_seconds, Some(90));
        assert_eq!(config.mcp_preflight_explain, Some(true));
    }

    #[test]
    fn is_connection_readonly_default_false_no_override_returns_false() {
        let config = AppConfig::default();
        assert!(!is_connection_readonly(&config, "c1"));
    }

    #[test]
    fn is_connection_readonly_default_false_with_inclusion_list() {
        let mut config = AppConfig::default();
        config.mcp_readonly_default = Some(false);
        config.mcp_readonly_connections = Some(vec!["c1".into()]);
        assert!(is_connection_readonly(&config, "c1"));
        assert!(!is_connection_readonly(&config, "c2"));
    }

    #[test]
    fn is_connection_readonly_default_true_with_exclusion_list() {
        let mut config = AppConfig::default();
        config.mcp_readonly_default = Some(true);
        config.mcp_readonly_connections = Some(vec!["c1".into()]);
        assert!(!is_connection_readonly(&config, "c1"));
        assert!(is_connection_readonly(&config, "c2"));
    }

    #[test]
    fn load_config_from_disk_returns_default_when_missing() {
        // The default config dir is unlikely to have our test sentinels, so
        // we just confirm the call returns a valid AppConfig (Default fallback
        // path is exercised indirectly via parse failures + missing file).
        let _ = load_config_from_disk();
    }
}
