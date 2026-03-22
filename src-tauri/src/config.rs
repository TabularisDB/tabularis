use crate::keychain_utils;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;
use tauri::Manager;

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
    pub active_external_drivers: Option<Vec<String>>,
    pub custom_registry_url: Option<String>,
    pub plugins: Option<HashMap<String, PluginConfig>>,
}

pub fn get_config_dir<R: tauri::Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path().app_config_dir().ok()
}

// Internal load
pub fn load_config_internal<R: tauri::Runtime>(app: &AppHandle<R>) -> AppConfig {
    if let Some(config_dir) = get_config_dir(app) {
        let config_path = config_dir.join("config.json");
        if config_path.exists() {
            if let Ok(content) = fs::read_to_string(config_path) {
                if let Ok(config) = serde_json::from_str(&content) {
                    return config;
                }
            }
        }
    }
    AppConfig::default()
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
        if config.active_external_drivers.is_some() {
            existing_config.active_external_drivers = config.active_external_drivers;
        }
        if config.plugins.is_some() {
            existing_config.plugins = config.plugins;
        }

        let content = serde_json::to_string_pretty(&existing_config).map_err(|e| e.to_string())?;
        fs::write(config_path, content).map_err(|e| e.to_string())?;
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

#[tauri::command]
pub fn get_system_prompt(app: AppHandle) -> String {
    if let Some(config_dir) = get_config_dir(&app) {
        let prompt_path = config_dir.join("prompt_query.txt");
        if prompt_path.exists() {
            if let Ok(content) = fs::read_to_string(prompt_path) {
                return content;
            }
        }
    }
    DEFAULT_SYSTEM_PROMPT.to_string()
}

#[tauri::command]
pub fn save_system_prompt(app: AppHandle, prompt: String) -> Result<(), String> {
    if let Some(config_dir) = get_config_dir(&app) {
        if !config_dir.exists() {
            fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;
        }
        let prompt_path = config_dir.join("prompt_query.txt");
        fs::write(prompt_path, prompt).map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("Could not resolve config directory".to_string())
    }
}

#[tauri::command]
pub fn reset_system_prompt(app: AppHandle) -> Result<String, String> {
    if let Some(config_dir) = get_config_dir(&app) {
        let prompt_path = config_dir.join("prompt_query.txt");
        if prompt_path.exists() {
            fs::remove_file(prompt_path).map_err(|e| e.to_string())?;
        }
    }
    Ok(DEFAULT_SYSTEM_PROMPT.to_string())
}

#[tauri::command]
pub fn get_explain_prompt(app: AppHandle) -> String {
    if let Some(config_dir) = get_config_dir(&app) {
        let prompt_path = config_dir.join("prompt_explain.txt");
        if prompt_path.exists() {
            if let Ok(content) = fs::read_to_string(prompt_path) {
                return content;
            }
        }
    }
    DEFAULT_EXPLAIN_PROMPT.to_string()
}

#[tauri::command]
pub fn save_explain_prompt(app: AppHandle, prompt: String) -> Result<(), String> {
    if let Some(config_dir) = get_config_dir(&app) {
        if !config_dir.exists() {
            fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;
        }
        let prompt_path = config_dir.join("prompt_explain.txt");
        fs::write(prompt_path, prompt).map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("Could not resolve config directory".to_string())
    }
}

#[tauri::command]
pub fn reset_explain_prompt(app: AppHandle) -> Result<String, String> {
    if let Some(config_dir) = get_config_dir(&app) {
        let prompt_path = config_dir.join("prompt_explain.txt");
        if prompt_path.exists() {
            fs::remove_file(prompt_path).map_err(|e| e.to_string())?;
        }
    }
    Ok(DEFAULT_EXPLAIN_PROMPT.to_string())
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
}
