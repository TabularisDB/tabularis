use super::*;
use crate::runtime::events::NoopRuntimeEvents;
use crate::runtime::paths::FixedRuntimePaths;
use crate::runtime::secrets::KeyringRuntimeSecrets;
use std::sync::Arc;

fn runtime(root: &Path) -> RuntimeContext {
    RuntimeContext::new(
        Arc::new(FixedRuntimePaths::new(
            root.to_path_buf(),
            root.to_path_buf(),
        )),
        Arc::new(NoopRuntimeEvents),
        Arc::new(KeyringRuntimeSecrets),
    )
}

fn editor_preferences(title: &str) -> EditorPreferences {
    EditorPreferences {
        tabs: vec![serde_json::json!({"id": "tab-1", "title": title})],
        active_tab_id: Some("tab-1".to_string()),
    }
}

fn custom_theme(id: &str) -> Theme {
    serde_json::from_value(serde_json::json!({
        "id": id,
        "name": "Custom",
        "isPreset": false,
        "isReadOnly": false,
        "colors": {
            "bg": {"base": "#000", "elevated": "#111", "overlay": "#222", "input": "#111", "tooltip": "#222"},
            "surface": {"primary": "#111", "secondary": "#222", "tertiary": "#333", "hover": "#444", "active": "#555", "disabled": "#666"},
            "text": {"primary": "#fff", "secondary": "#ddd", "muted": "#aaa", "disabled": "#777", "accent": "#09f", "inverse": "#000"},
            "accent": {"primary": "#09f", "secondary": "#08e", "success": "#0a0", "warning": "#fa0", "error": "#f00", "info": "#0af"},
            "border": {"subtle": "#222", "default": "#333", "strong": "#444", "focus": "#09f"},
            "semantic": {"string": "#f99", "number": "#9f9", "boolean": "#99f", "date": "#f9f", "null": "#999", "primaryKey": "#ff0", "foreignKey": "#0ff", "index": "#f0f", "connectionActive": "#0f0", "connectionInactive": "#999", "modified": "#fa0", "deleted": "#f00", "new": "#0f0"}
        },
        "typography": {
            "fontFamily": {"base": "sans-serif", "mono": "monospace"},
            "fontSize": {"xs": "10px", "sm": "12px", "base": "14px", "lg": "16px", "xl": "18px"}
        },
        "layout": {
            "borderRadius": {"sm": "2px", "base": "4px", "lg": "8px", "xl": "12px"},
            "spacing": {"xs": "2px", "sm": "4px", "base": "8px", "lg": "12px", "xl": "16px"}
        },
        "monacoTheme": {"base": "vs-dark", "inherit": true}
    }))
    .unwrap()
}

#[tokio::test]
async fn browser_editor_and_connection_preferences_are_isolated_by_session() {
    let temp = tempfile::tempdir().unwrap();
    let runtime = runtime(temp.path());
    let state = ApplicationState::default();
    let session_a = Uuid::new_v4();
    let session_b = Uuid::new_v4();

    execute(
        &runtime,
        &state,
        Some(session_a),
        PersistenceCommand::SaveEditorPreferences(
            "connection-1".to_string(),
            editor_preferences("Session A"),
        ),
    )
    .await
    .unwrap();
    execute(
        &runtime,
        &state,
        Some(session_a),
        PersistenceCommand::SetLastOpenConnections(vec!["connection-1".to_string()]),
    )
    .await
    .unwrap();
    execute(
        &runtime,
        &state,
        Some(session_a),
        PersistenceCommand::SetLastActiveConnection(Some("connection-1".to_string())),
    )
    .await
    .unwrap();

    assert_eq!(
        execute(
            &runtime,
            &state,
            Some(session_a),
            PersistenceCommand::LoadEditorPreferences("connection-1".to_string()),
        )
        .await
        .unwrap(),
        serde_json::to_value(editor_preferences("Session A")).unwrap()
    );
    assert_eq!(
        execute(
            &runtime,
            &state,
            Some(session_b),
            PersistenceCommand::LoadEditorPreferences("connection-1".to_string()),
        )
        .await
        .unwrap(),
        Value::Null
    );
    assert_eq!(
        execute(
            &runtime,
            &state,
            Some(session_b),
            PersistenceCommand::GetLastOpenConnections,
        )
        .await
        .unwrap(),
        serde_json::json!([])
    );
    assert!(!temp.path().join(PREFERENCES_DIR).exists());
    assert!(!temp.path().join(CONFIG_FILE).exists());
}

#[tokio::test]
async fn desktop_preferences_keep_the_existing_disk_locations() {
    let temp = tempfile::tempdir().unwrap();
    let runtime = runtime(temp.path());
    let state = ApplicationState::default();
    let preferences = editor_preferences("Desktop");

    execute(
        &runtime,
        &state,
        None,
        PersistenceCommand::SaveEditorPreferences("connection-1".to_string(), preferences.clone()),
    )
    .await
    .unwrap();
    execute(
        &runtime,
        &state,
        None,
        PersistenceCommand::SetLastOpenConnections(vec!["connection-1".to_string()]),
    )
    .await
    .unwrap();
    execute(
        &runtime,
        &state,
        None,
        PersistenceCommand::SetLastActiveConnection(None),
    )
    .await
    .unwrap();

    assert_eq!(
        load_editor_preferences(&runtime, &state, None, "connection-1").unwrap(),
        Some(preferences)
    );
    let config = load_config(&runtime);
    assert_eq!(config.last_open_connection_ids.unwrap(), ["connection-1"]);
    assert!(config.last_active_connection_id.is_none());
}

#[test]
fn runtime_api_clears_browser_preferences_when_a_session_ends() {
    use crate::application::{ApplicationApi, RuntimeApplicationApi};

    let temp = tempfile::tempdir().unwrap();
    let runtime = runtime(temp.path());
    let state = Arc::new(ApplicationState::default());
    let session_id = Uuid::new_v4();
    state
        .web_preferences
        .lock()
        .unwrap()
        .insert(session_id, WebSessionPreferences::default());
    state
        .web_active_connections
        .lock()
        .unwrap()
        .insert(session_id, std::collections::HashSet::new());

    RuntimeApplicationApi::new(runtime, state.clone()).clear_session(session_id);

    assert!(!state
        .web_preferences
        .lock()
        .unwrap()
        .contains_key(&session_id));
    assert!(!state
        .web_active_connections
        .lock()
        .unwrap()
        .contains_key(&session_id));
}

#[test]
fn config_updates_merge_without_clobbering_other_user_preferences() {
    let temp = tempfile::tempdir().unwrap();
    let runtime = runtime(temp.path());

    save_config(
        &runtime,
        AppConfig {
            language: Some("en".to_string()),
            theme: Some("tabularis-dark".to_string()),
            formatter_tab_width: Some(2),
            ..Default::default()
        },
    )
    .unwrap();
    let config = save_config(
        &runtime,
        AppConfig {
            language: Some("it".to_string()),
            ..Default::default()
        },
    )
    .unwrap();

    assert_eq!(config.language.as_deref(), Some("it"));
    assert_eq!(config.theme.as_deref(), Some("tabularis-dark"));
    assert_eq!(config.formatter_tab_width, Some(2));
}

#[tokio::test]
async fn browser_config_writes_cannot_replace_desktop_restore_state() {
    let temp = tempfile::tempdir().unwrap();
    let runtime = runtime(temp.path());
    let state = ApplicationState::default();
    save_config(
        &runtime,
        AppConfig {
            last_active_connection_id: Some("desktop".to_string()),
            last_open_connection_ids: Some(vec!["desktop".to_string()]),
            ..Default::default()
        },
    )
    .unwrap();

    execute(
        &runtime,
        &state,
        Some(Uuid::new_v4()),
        PersistenceCommand::SaveConfig(AppConfig {
            language: Some("de".to_string()),
            last_active_connection_id: Some("browser".to_string()),
            last_open_connection_ids: Some(vec!["browser".to_string()]),
            ..Default::default()
        }),
    )
    .await
    .unwrap();

    let config = load_config(&runtime);
    assert_eq!(config.language.as_deref(), Some("de"));
    assert_eq!(config.last_active_connection_id.as_deref(), Some("desktop"));
    assert_eq!(config.last_open_connection_ids.unwrap(), ["desktop"]);
}

#[test]
fn persists_and_deletes_custom_themes_in_the_shared_config_directory() {
    let temp = tempfile::tempdir().unwrap();
    let runtime = runtime(temp.path());
    let theme = custom_theme("custom-test");

    save_custom_theme(&runtime, &theme).unwrap();
    assert_eq!(get_all_themes(&runtime).len(), 1);
    assert_eq!(get_all_themes(&runtime)[0].id, "custom-test");
    delete_custom_theme(&runtime, "custom-test").unwrap();
    assert!(get_all_themes(&runtime).is_empty());
}

#[test]
fn rejects_path_traversal_in_browser_controlled_storage_keys() {
    let temp = tempfile::tempdir().unwrap();
    let runtime = runtime(temp.path());
    let state = ApplicationState::default();

    assert!(save_editor_preferences(
        &runtime,
        &state,
        Some(Uuid::new_v4()),
        "../outside",
        editor_preferences("unsafe"),
    )
    .is_err());
    assert!(delete_custom_theme(&runtime, "../outside").is_err());
}
