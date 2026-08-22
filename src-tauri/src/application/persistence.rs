use crate::config::AppConfig;
use crate::preferences::EditorPreferences;
use crate::runtime::{state::ApplicationState, RuntimeContext};
use crate::theme_models::Theme;
use once_cell::sync::Lazy;
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use uuid::Uuid;

const CONFIG_FILE: &str = "config.json";
const KEYBINDINGS_FILE: &str = "keybindings.json";
const THEMES_DIR: &str = "themes";
const PREFERENCES_DIR: &str = "preferences";

const DEFAULT_SYSTEM_PROMPT: &str = "You are an expert SQL assistant. Your task is to generate a SQL query based on the user's request and the provided database schema.\nReturn ONLY the SQL query, without any markdown formatting, explanations, or code blocks.\n\nSchema:\n{{SCHEMA}}";
const DEFAULT_EXPLAIN_PROMPT: &str =
    "You are a helpful SQL assistant. Explain SQL queries in {{LANGUAGE}}.";
const DEFAULT_EXPLAINPLAN_PROMPT: &str =
    "You are a database performance expert. Analyze the following SQL query and its EXPLAIN plan output. Identify performance bottlenecks, suggest index improvements, and explain the execution strategy. Respond in {{LANGUAGE}}.";
const DEFAULT_CELLNAME_PROMPT: &str = "You are an assistant that generates concise, descriptive names for notebook cells.\nGiven a SQL query or Markdown content, return ONLY a short name (3-6 words max) that describes what the cell does or what it is about.\nDo not include quotes, punctuation, or explanations. Just the name.";
const DEFAULT_TABRENAME_PROMPT: &str = "You are an assistant that generates concise, descriptive names for SQL query result tabs.\nGiven a SQL query, return ONLY a short name (3-6 words max) that describes what the query does.\nDo not include quotes, punctuation, or explanations. Just the name.";

static PERSISTENCE_WRITE_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PromptKind {
    System,
    Explain,
    ExplainPlan,
    CellName,
    TabRename,
}

impl PromptKind {
    fn filename(self) -> &'static str {
        match self {
            Self::System => "prompt_query.txt",
            Self::Explain => "prompt_explain.txt",
            Self::ExplainPlan => "prompt_explainplan.txt",
            Self::CellName => "prompt_cellname.txt",
            Self::TabRename => "prompt_tabrename.txt",
        }
    }

    fn default_prompt(self) -> &'static str {
        match self {
            Self::System => DEFAULT_SYSTEM_PROMPT,
            Self::Explain => DEFAULT_EXPLAIN_PROMPT,
            Self::ExplainPlan => DEFAULT_EXPLAINPLAN_PROMPT,
            Self::CellName => DEFAULT_CELLNAME_PROMPT,
            Self::TabRename => DEFAULT_TABRENAME_PROMPT,
        }
    }
}

#[derive(Debug)]
pub enum PersistenceCommand {
    GetConfig,
    SaveConfig(AppConfig),
    GetConfigJson,
    SaveConfigJson(String),
    GetKeybindings,
    SaveKeybindings(Value),
    GetAllThemes,
    SaveCustomTheme(Theme),
    DeleteCustomTheme(String),
    GetPrompt(PromptKind),
    SavePrompt(PromptKind, String),
    ResetPrompt(PromptKind),
    LoadEditorPreferences(String),
    SaveEditorPreferences(String, EditorPreferences),
    DeleteEditorPreferences(String),
    GetLastActiveConnection,
    SetLastActiveConnection(Option<String>),
    GetLastOpenConnections,
    SetLastOpenConnections(Vec<String>),
}

#[derive(Clone, Debug, Default)]
pub struct WebSessionPreferences {
    pub last_active_connection_id: Option<String>,
    pub last_open_connection_ids: Vec<String>,
    pub editor_preferences: HashMap<String, EditorPreferences>,
}

pub async fn execute(
    runtime: &RuntimeContext,
    state: &ApplicationState,
    session_id: Option<Uuid>,
    command: PersistenceCommand,
) -> Result<Value, String> {
    match command {
        PersistenceCommand::GetConfig => json(config_for_session(runtime, state, session_id)),
        PersistenceCommand::SaveConfig(config) => {
            save_config_for_session(runtime, state, session_id, config)?;
            Ok(Value::Null)
        }
        PersistenceCommand::GetConfigJson => json(get_config_json(runtime, state, session_id)?),
        PersistenceCommand::SaveConfigJson(content) => {
            save_config_json(runtime, session_id, &content)?;
            Ok(Value::Null)
        }
        PersistenceCommand::GetKeybindings => get_keybindings(runtime),
        PersistenceCommand::SaveKeybindings(keybindings) => {
            save_keybindings(runtime, &keybindings)?;
            Ok(Value::Null)
        }
        PersistenceCommand::GetAllThemes => json(get_all_themes(runtime)),
        PersistenceCommand::SaveCustomTheme(theme) => {
            save_custom_theme(runtime, &theme)?;
            Ok(Value::Null)
        }
        PersistenceCommand::DeleteCustomTheme(theme_id) => {
            delete_custom_theme(runtime, &theme_id)?;
            Ok(Value::Null)
        }
        PersistenceCommand::GetPrompt(kind) => json(get_prompt(runtime, kind)),
        PersistenceCommand::SavePrompt(kind, prompt) => {
            save_prompt(runtime, kind, &prompt)?;
            Ok(Value::Null)
        }
        PersistenceCommand::ResetPrompt(kind) => json(reset_prompt(runtime, kind)?),
        PersistenceCommand::LoadEditorPreferences(connection_id) => json(load_editor_preferences(
            runtime,
            state,
            session_id,
            &connection_id,
        )?),
        PersistenceCommand::SaveEditorPreferences(connection_id, preferences) => {
            save_editor_preferences(runtime, state, session_id, &connection_id, preferences)?;
            Ok(Value::Null)
        }
        PersistenceCommand::DeleteEditorPreferences(connection_id) => {
            delete_editor_preferences(runtime, state, session_id, &connection_id)?;
            Ok(Value::Null)
        }
        PersistenceCommand::GetLastActiveConnection => {
            json(last_active_connection(runtime, state, session_id))
        }
        PersistenceCommand::SetLastActiveConnection(connection_id) => {
            set_last_active_connection(runtime, state, session_id, connection_id)?;
            Ok(Value::Null)
        }
        PersistenceCommand::GetLastOpenConnections => {
            json(last_open_connections(runtime, state, session_id))
        }
        PersistenceCommand::SetLastOpenConnections(connection_ids) => {
            set_last_open_connections(runtime, state, session_id, connection_ids)?;
            Ok(Value::Null)
        }
    }
}

pub fn load_config(runtime: &RuntimeContext) -> AppConfig {
    let _guard = PERSISTENCE_WRITE_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let config = load_config_path(&runtime.paths.config_dir().join(CONFIG_FILE));
    crate::config::cache_config(&config);
    config
}

pub fn save_config(runtime: &RuntimeContext, update: AppConfig) -> Result<AppConfig, String> {
    update_config(runtime, |config| merge_config(config, update))
}

pub fn set_selected_schemas(
    runtime: &RuntimeContext,
    connection_id: String,
    schemas: Vec<String>,
) -> Result<(), String> {
    update_config(runtime, |config| {
        let selections = config
            .selected_schemas
            .get_or_insert_with(std::collections::HashMap::new);
        if schemas.is_empty() {
            selections.remove(&connection_id);
        } else {
            selections.insert(connection_id, schemas);
        }
    })
    .map(|_| ())
}

pub fn set_schema_preference(
    runtime: &RuntimeContext,
    connection_id: String,
    schema: String,
) -> Result<(), String> {
    update_config(runtime, |config| {
        config
            .schema_preferences
            .get_or_insert_with(std::collections::HashMap::new)
            .insert(connection_id, schema);
    })
    .map(|_| ())
}

fn update_config(
    runtime: &RuntimeContext,
    update: impl FnOnce(&mut AppConfig),
) -> Result<AppConfig, String> {
    let _guard = PERSISTENCE_WRITE_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let path = runtime.paths.config_dir().join(CONFIG_FILE);
    let mut config = load_config_path(&path);
    update(&mut config);
    write_config(&path, &config)?;
    Ok(config)
}

fn config_for_session(
    runtime: &RuntimeContext,
    state: &ApplicationState,
    session_id: Option<Uuid>,
) -> AppConfig {
    let mut config = load_config(runtime);
    if let Some(session_id) = session_id {
        let sessions = state
            .web_preferences
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let preferences = sessions.get(&session_id);
        config.last_active_connection_id =
            preferences.and_then(|value| value.last_active_connection_id.clone());
        config.last_open_connection_ids = Some(
            preferences
                .map(|value| value.last_open_connection_ids.clone())
                .unwrap_or_default(),
        );
    }
    config
}

fn save_config_for_session(
    runtime: &RuntimeContext,
    _state: &ApplicationState,
    session_id: Option<Uuid>,
    mut update: AppConfig,
) -> Result<(), String> {
    if session_id.is_some() {
        update.last_active_connection_id = None;
        update.last_open_connection_ids = None;
    }
    save_config(runtime, update).map(|_| ())
}

fn load_config_path(path: &Path) -> AppConfig {
    let mut config = fs::read_to_string(path)
        .ok()
        .and_then(|content| serde_json::from_str(&content).ok())
        .unwrap_or_default();
    crate::plugins::compat::migrate_legacy_config(&mut config);
    config
}

fn write_config(path: &Path, config: &AppConfig) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let content = serde_json::to_string_pretty(config).map_err(|error| error.to_string())?;
    fs::write(path, content).map_err(|error| error.to_string())?;
    crate::config::cache_config(config);
    Ok(())
}

fn merge_config(existing: &mut AppConfig, update: AppConfig) {
    macro_rules! merge_fields {
        ($($field:ident),+ $(,)?) => {
            $(if update.$field.is_some() { existing.$field = update.$field; })+
        };
    }

    merge_fields!(
        theme,
        language,
        result_page_size,
        font_family,
        font_size,
        result_color_by_type,
        result_type_colors,
        ai_enabled,
        ai_provider,
        ai_model,
        ai_custom_models,
        ai_ollama_port,
        ai_custom_openai_url,
        ai_custom_openai_model,
        check_for_updates,
        auto_check_updates_on_startup,
        last_dismissed_version,
        er_diagram_default_layout,
        schema_preferences,
        selected_schemas,
        max_blob_size,
        copy_format,
        csv_delimiter,
        csv_include_headers,
        active_external_drivers,
        tabularium_registry_url,
        release_channel,
        plugins,
        editor_theme,
        editor_font_family,
        editor_font_size,
        editor_line_height,
        editor_tab_size,
        editor_word_wrap,
        editor_show_line_numbers,
        editor_accept_suggestion_on_enter,
        run_statement_under_cursor,
        safety_confirmation_delay_enabled,
        formatter_keyword_case,
        formatter_indent_style,
        formatter_tab_width,
        formatter_use_tabs,
        formatter_function_case,
        formatter_lines_between_queries,
        formatter_dense_operators,
        ping_interval,
        query_history_max_entries,
        show_welcome,
        start_maximized,
        display_timezone,
        ai_audit_enabled,
        ai_audit_max_entries,
        ai_session_gap_minutes,
        mcp_readonly_default,
        mcp_readonly_connections,
        mcp_approval_mode,
        mcp_approval_timeout_seconds,
        mcp_preflight_explain,
        mcp_approval_always_on_top,
        mcp_approval_notify_sound,
        backup_mode,
        backup_directory,
        backup_interval_minutes,
        backup_retention,
        backup_target,
        backup_webdav_url,
        backup_webdav_username,
        auto_connect_last_connection,
        last_active_connection_id,
        last_open_connection_ids
    );
}

pub fn get_config_json(
    runtime: &RuntimeContext,
    state: &ApplicationState,
    session_id: Option<Uuid>,
) -> Result<String, String> {
    if session_id.is_none() {
        return get_config_json_for_desktop(runtime);
    }
    serde_json::to_string_pretty(&config_for_session(runtime, state, session_id))
        .map_err(|error| error.to_string())
}

pub fn get_config_json_for_desktop(runtime: &RuntimeContext) -> Result<String, String> {
    let _guard = PERSISTENCE_WRITE_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let path = runtime.paths.config_dir().join(CONFIG_FILE);
    if path.exists() {
        fs::read_to_string(path).map_err(|error| error.to_string())
    } else {
        Ok("{}".to_string())
    }
}

pub fn save_config_json(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    content: &str,
) -> Result<(), String> {
    let mut config: AppConfig = serde_json::from_str(content)
        .map_err(|error| format!("Invalid configuration JSON: {error}"))?;
    let _guard = PERSISTENCE_WRITE_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let path = runtime.paths.config_dir().join(CONFIG_FILE);
    if session_id.is_some() {
        let existing = load_config_path(&path);
        config.last_active_connection_id = existing.last_active_connection_id;
        config.last_open_connection_ids = existing.last_open_connection_ids;
    }
    write_config(&path, &config)
}

pub fn save_config_json_for_desktop(runtime: &RuntimeContext, content: &str) -> Result<(), String> {
    save_config_json(runtime, None, content)
}

pub fn get_keybindings(runtime: &RuntimeContext) -> Result<Value, String> {
    let _guard = PERSISTENCE_WRITE_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let path = runtime.paths.config_dir().join(KEYBINDINGS_FILE);
    if !path.exists() {
        return Ok(Value::Object(serde_json::Map::new()));
    }
    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&content).map_err(|error| error.to_string())
}

pub fn save_keybindings(runtime: &RuntimeContext, keybindings: &Value) -> Result<(), String> {
    let _guard = PERSISTENCE_WRITE_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    fs::create_dir_all(runtime.paths.config_dir()).map_err(|error| error.to_string())?;
    let content = serde_json::to_string_pretty(keybindings).map_err(|error| error.to_string())?;
    fs::write(runtime.paths.config_dir().join(KEYBINDINGS_FILE), content)
        .map_err(|error| error.to_string())
}

pub fn get_all_themes(runtime: &RuntimeContext) -> Vec<Theme> {
    let _guard = PERSISTENCE_WRITE_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let themes_dir = runtime.paths.config_dir().join(THEMES_DIR);
    let Ok(entries) = fs::read_dir(themes_dir) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter_map(|entry| fs::read_to_string(entry.path()).ok())
        .filter_map(|content| serde_json::from_str(&content).ok())
        .collect()
}

pub fn save_custom_theme(runtime: &RuntimeContext, theme: &Theme) -> Result<(), String> {
    if theme.is_preset {
        return Err("Cannot save preset themes".to_string());
    }
    let path = theme_path(runtime, &theme.id)?;
    let _guard = PERSISTENCE_WRITE_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let content = serde_json::to_string_pretty(theme).map_err(|error| error.to_string())?;
    fs::write(path, content).map_err(|error| error.to_string())
}

pub fn delete_custom_theme(runtime: &RuntimeContext, theme_id: &str) -> Result<(), String> {
    let path = theme_path(runtime, theme_id)?;
    let _guard = PERSISTENCE_WRITE_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    if !path.exists() {
        return Err(format!("Theme {theme_id} not found"));
    }
    let content = fs::read_to_string(&path).map_err(|error| error.to_string())?;
    let theme: Theme = serde_json::from_str(&content).map_err(|error| error.to_string())?;
    if theme.is_preset {
        return Err("Cannot delete preset themes".to_string());
    }
    fs::remove_file(path).map_err(|error| error.to_string())
}

fn theme_path(runtime: &RuntimeContext, theme_id: &str) -> Result<PathBuf, String> {
    validate_storage_key(theme_id, "theme id")?;
    Ok(runtime
        .paths
        .config_dir()
        .join(THEMES_DIR)
        .join(format!("{theme_id}.json")))
}

pub fn get_prompt(runtime: &RuntimeContext, kind: PromptKind) -> String {
    let _guard = PERSISTENCE_WRITE_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    fs::read_to_string(runtime.paths.config_dir().join(kind.filename()))
        .unwrap_or_else(|_| kind.default_prompt().to_string())
}

pub fn save_prompt(runtime: &RuntimeContext, kind: PromptKind, prompt: &str) -> Result<(), String> {
    let _guard = PERSISTENCE_WRITE_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    fs::create_dir_all(runtime.paths.config_dir()).map_err(|error| error.to_string())?;
    fs::write(runtime.paths.config_dir().join(kind.filename()), prompt)
        .map_err(|error| error.to_string())
}

pub fn reset_prompt(runtime: &RuntimeContext, kind: PromptKind) -> Result<String, String> {
    let path = runtime.paths.config_dir().join(kind.filename());
    let _guard = PERSISTENCE_WRITE_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    if path.exists() {
        fs::remove_file(path).map_err(|error| error.to_string())?;
    }
    Ok(kind.default_prompt().to_string())
}

pub fn load_editor_preferences_for_desktop(
    runtime: &RuntimeContext,
    connection_id: &str,
) -> Result<Option<EditorPreferences>, String> {
    validate_storage_key(connection_id, "connection id")?;
    let _guard = PERSISTENCE_WRITE_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let path = editor_preferences_path(runtime, connection_id);
    if !path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&content)
        .map(Some)
        .map_err(|error| error.to_string())
}

pub fn load_editor_preferences(
    runtime: &RuntimeContext,
    state: &ApplicationState,
    session_id: Option<Uuid>,
    connection_id: &str,
) -> Result<Option<EditorPreferences>, String> {
    validate_storage_key(connection_id, "connection id")?;
    if let Some(session_id) = session_id {
        return Ok(state
            .web_preferences
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .get(&session_id)
            .and_then(|session| session.editor_preferences.get(connection_id).cloned()));
    }
    load_editor_preferences_for_desktop(runtime, connection_id)
}

pub fn save_editor_preferences_for_desktop(
    runtime: &RuntimeContext,
    connection_id: &str,
    preferences: &EditorPreferences,
) -> Result<(), String> {
    validate_storage_key(connection_id, "connection id")?;
    let path = editor_preferences_path(runtime, connection_id);
    let _guard = PERSISTENCE_WRITE_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let content = serde_json::to_string_pretty(preferences).map_err(|error| error.to_string())?;
    fs::write(path, content).map_err(|error| error.to_string())
}

pub fn save_editor_preferences(
    runtime: &RuntimeContext,
    state: &ApplicationState,
    session_id: Option<Uuid>,
    connection_id: &str,
    preferences: EditorPreferences,
) -> Result<(), String> {
    validate_storage_key(connection_id, "connection id")?;
    if let Some(session_id) = session_id {
        state
            .web_preferences
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .entry(session_id)
            .or_default()
            .editor_preferences
            .insert(connection_id.to_string(), preferences);
        return Ok(());
    }
    save_editor_preferences_for_desktop(runtime, connection_id, &preferences)
}

pub fn delete_editor_preferences_for_desktop(
    runtime: &RuntimeContext,
    connection_id: &str,
) -> Result<(), String> {
    validate_storage_key(connection_id, "connection id")?;
    let path = editor_preferences_path(runtime, connection_id);
    if path.exists() {
        let _guard = PERSISTENCE_WRITE_LOCK
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        fs::remove_file(path).map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub fn delete_editor_preferences(
    runtime: &RuntimeContext,
    state: &ApplicationState,
    session_id: Option<Uuid>,
    connection_id: &str,
) -> Result<(), String> {
    validate_storage_key(connection_id, "connection id")?;
    if let Some(session_id) = session_id {
        if let Some(session) = state
            .web_preferences
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .get_mut(&session_id)
        {
            session.editor_preferences.remove(connection_id);
        }
        return Ok(());
    }
    delete_editor_preferences_for_desktop(runtime, connection_id)
}

fn editor_preferences_path(runtime: &RuntimeContext, connection_id: &str) -> PathBuf {
    runtime
        .paths
        .config_dir()
        .join(PREFERENCES_DIR)
        .join(connection_id)
        .join("preferences.json")
}

pub fn last_active_connection(
    runtime: &RuntimeContext,
    state: &ApplicationState,
    session_id: Option<Uuid>,
) -> Option<String> {
    if let Some(session_id) = session_id {
        return state
            .web_preferences
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .get(&session_id)
            .and_then(|session| session.last_active_connection_id.clone());
    }
    load_config(runtime).last_active_connection_id
}

pub fn set_last_active_connection_for_desktop(
    runtime: &RuntimeContext,
    connection_id: Option<String>,
) -> Result<(), String> {
    let _guard = PERSISTENCE_WRITE_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let path = runtime.paths.config_dir().join(CONFIG_FILE);
    let mut config = load_config_path(&path);
    config.last_active_connection_id = connection_id;
    write_config(&path, &config)
}

pub fn set_last_active_connection(
    runtime: &RuntimeContext,
    state: &ApplicationState,
    session_id: Option<Uuid>,
    connection_id: Option<String>,
) -> Result<(), String> {
    if let Some(session_id) = session_id {
        state
            .web_preferences
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .entry(session_id)
            .or_default()
            .last_active_connection_id = connection_id;
        return Ok(());
    }
    set_last_active_connection_for_desktop(runtime, connection_id)
}

pub fn last_open_connections(
    runtime: &RuntimeContext,
    state: &ApplicationState,
    session_id: Option<Uuid>,
) -> Vec<String> {
    if let Some(session_id) = session_id {
        return state
            .web_preferences
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .get(&session_id)
            .map(|session| session.last_open_connection_ids.clone())
            .unwrap_or_default();
    }
    load_config(runtime)
        .last_open_connection_ids
        .unwrap_or_default()
}

pub fn set_last_open_connections_for_desktop(
    runtime: &RuntimeContext,
    connection_ids: Vec<String>,
) -> Result<(), String> {
    save_config(
        runtime,
        AppConfig {
            last_open_connection_ids: Some(connection_ids),
            ..Default::default()
        },
    )
    .map(|_| ())
}

pub fn set_last_open_connections(
    runtime: &RuntimeContext,
    state: &ApplicationState,
    session_id: Option<Uuid>,
    connection_ids: Vec<String>,
) -> Result<(), String> {
    if let Some(session_id) = session_id {
        state
            .web_preferences
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .entry(session_id)
            .or_default()
            .last_open_connection_ids = connection_ids;
        return Ok(());
    }
    set_last_open_connections_for_desktop(runtime, connection_ids)
}

fn validate_storage_key(value: &str, label: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 255
        || value == "."
        || value == ".."
        || value
            .chars()
            .any(|character| character == '/' || character == '\\' || character == '\0')
    {
        return Err(format!("Invalid {label}"));
    }
    Ok(())
}

fn json(value: impl serde::Serialize) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|error| error.to_string())
}

#[cfg(test)]
#[path = "persistence_tests.rs"]
mod tests;
