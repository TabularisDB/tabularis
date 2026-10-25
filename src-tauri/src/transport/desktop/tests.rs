use crate::models::{
    ConnectionParams, ConnectionsFile, CredentialProfile, DatabaseSelection, SavedConnection,
};
use crate::runtime::events::NoopRuntimeEvents;
use crate::runtime::paths::FixedRuntimePaths;
use crate::runtime::secrets::RuntimeSecrets;
use crate::runtime::RuntimeContext;
use std::sync::Arc;

struct NoSecrets;

impl RuntimeSecrets for NoSecrets {
    fn get(&self, _account: &str) -> Result<Option<String>, String> {
        Ok(None)
    }

    fn set(&self, _account: &str, _secret: &str) -> Result<(), String> {
        Ok(())
    }

    fn delete(&self, _account: &str) -> Result<(), String> {
        Ok(())
    }
}

#[tokio::test]
async fn desktop_productivity_commands_use_the_managed_custom_config_directory() {
    use crate::transport::desktop::{query_history, saved_queries};
    let root = tempfile::tempdir().unwrap();
    let config = root.path().join("custom-config");
    let runtime = RuntimeContext::new(
        Arc::new(crate::runtime::paths::FixedRuntimePaths::new(
            config.clone(),
            root.path().join("data"),
        )),
        Arc::new(NoopRuntimeEvents),
        Arc::new(NoSecrets),
    );
    let app = tauri::test::mock_builder()
        .manage(runtime)
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    let handle = app.handle().clone();
    let connection = uuid::Uuid::new_v4().to_string();
    let seed = crate::application::productivity::execute(
        &config,
        crate::application::productivity::ProductivityCommand::SaveQuery {
            connection_id: connection.clone(),
            name: "Seed".into(),
            sql: "SELECT 0".into(),
            database: None,
        },
    )
    .await
    .unwrap();
    assert_eq!(
        saved_queries::get_saved_queries(handle.clone(), connection.clone())
            .await
            .unwrap()
            .len(),
        1,
        "desktop reads must use the managed runtime path"
    );
    saved_queries::delete_saved_query(
        handle.clone(),
        Some(connection.clone()),
        seed["id"].as_str().unwrap().into(),
    )
    .await
    .unwrap();
    let saved = saved_queries::save_query(
        handle.clone(),
        connection.clone(),
        "Custom".into(),
        "SELECT 1".into(),
        None,
    )
    .await
    .unwrap();
    assert!(
        config.join("saved_queries").exists(),
        "saved queries must use the runtime config directory"
    );
    assert_eq!(
        saved_queries::get_saved_queries(handle.clone(), connection.clone())
            .await
            .unwrap()
            .len(),
        1
    );
    saved_queries::update_saved_query(
        handle.clone(),
        Some(connection.clone()),
        saved.id.clone(),
        "Updated".into(),
        "SELECT 2".into(),
        None,
    )
    .await
    .unwrap();
    assert_eq!(
        saved_queries::backfill_missing_database_for_connection(&handle, &connection, "db")
            .unwrap(),
        1
    );
    saved_queries::delete_saved_query(handle.clone(), Some(connection.clone()), saved.id)
        .await
        .unwrap();
    assert!(
        saved_queries::get_saved_queries(handle.clone(), connection.clone())
            .await
            .unwrap()
            .is_empty()
    );
    let entry = query_history::add_query_history_entry(
        handle.clone(),
        connection.clone(),
        "SELECT 1".into(),
        "2026-10-15T00:00:00Z".into(),
        None,
        "success".into(),
        None,
        None,
        None,
    )
    .await
    .unwrap();
    assert!(
        config.join("query_history").exists(),
        "history must use the runtime config directory"
    );
    assert_eq!(
        query_history::get_query_history(handle.clone(), connection.clone())
            .await
            .unwrap()
            .entries
            .len(),
        1
    );
    assert_eq!(
        query_history::backfill_missing_database_for_connection(&handle, &connection, "db")
            .await
            .unwrap(),
        1
    );
    query_history::delete_query_history_entry(handle.clone(), connection.clone(), entry.id)
        .await
        .unwrap();
    query_history::clear_query_history(handle.clone(), connection.clone())
        .await
        .unwrap();
    query_history::remove_history_for_connection(&handle, &connection)
        .await
        .unwrap();
    assert!(!config
        .join("query_history")
        .join(format!("{connection}.json"))
        .exists());
}

fn linked_connection(id: &str, profile_id: &str) -> SavedConnection {
    SavedConnection {
        id: id.to_string(),
        name: "Linked".to_string(),
        params: ConnectionParams {
            driver: "postgres".to_string(),
            host: Some("127.0.0.1".to_string()),
            port: Some(5432),
            username: Some("inline-user".to_string()),
            database: DatabaseSelection::Single("db".to_string()),
            save_in_keychain: Some(true),
            credential_profile_id: Some(profile_id.to_string()),
            ..ConnectionParams::default()
        },
        plugin_secret_keys: Vec::new(),
        group_id: None,
        sort_order: None,
        detect_json_in_text_columns: None,
        appearance: None,
        tag_ids: None,
        environment: None,
    }
}

/// The edit/metadata read must never resolve a credential profile: a missing
/// profile password has to reach the edit form as a plain reference, exactly
/// like the web transport.
#[tokio::test]
async fn desktop_connections_metadata_read_keeps_the_profile_unresolved() {
    use crate::transport::desktop::commands::find_connection_metadata_by_id;

    let root = tempfile::tempdir().unwrap();
    let runtime = RuntimeContext::new(
        Arc::new(FixedRuntimePaths::new(
            root.path().to_path_buf(),
            root.path().to_path_buf(),
        )),
        Arc::new(NoopRuntimeEvents),
        Arc::new(NoSecrets),
    );
    let connection_cache = Arc::new(crate::connection_cache::ConnectionCache::default());
    connection_cache.populate(&[linked_connection("conn-1", "profile-1")]);
    let app = tauri::test::mock_builder()
        .manage(runtime)
        .manage(connection_cache)
        .manage(Arc::new(crate::credential_cache::CredentialCache::default()))
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();

    let conn = find_connection_metadata_by_id(app.handle(), "conn-1")
        .expect("a missing profile password must not fail the edit/metadata read");
    assert_eq!(
        conn.params.credential_profile_id.as_deref(),
        Some("profile-1")
    );
    assert!(
        conn.params.password.is_none(),
        "the shared password must stay out of the edit form"
    );
}

/// Execution reads (`health_check`, disconnect, query execution) still resolve
/// the profile and fail closed when its password is missing.
#[tokio::test]
async fn desktop_connections_execution_read_resolves_and_fails_closed() {
    use crate::transport::desktop::commands::find_connection_by_id;

    let root = tempfile::tempdir().unwrap();
    let runtime = RuntimeContext::new(
        Arc::new(FixedRuntimePaths::new(
            root.path().to_path_buf(),
            root.path().to_path_buf(),
        )),
        Arc::new(NoopRuntimeEvents),
        Arc::new(NoSecrets),
    );
    // The profile exists, but `NoSecrets` holds no password for it.
    let file = ConnectionsFile {
        connections: vec![linked_connection("conn-1", "profile-1")],
        credential_profiles: vec![CredentialProfile {
            id: "profile-1".to_string(),
            name: "Shared".to_string(),
            username: "shared-user".to_string(),
        }],
        ..ConnectionsFile::default()
    };
    crate::persistence::save_connections_file(&runtime.paths.connections_file(), &file).unwrap();

    let connection_cache = Arc::new(crate::connection_cache::ConnectionCache::default());
    connection_cache.populate(&[linked_connection("conn-1", "profile-1")]);
    let app = tauri::test::mock_builder()
        .manage(runtime)
        .manage(connection_cache)
        .manage(Arc::new(crate::credential_cache::CredentialCache::default()))
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();

    let error = find_connection_by_id(app.handle(), "conn-1")
        .expect_err("execution must fail closed when the profile password is missing");
    assert!(
        error.contains("profile-1"),
        "the failure must name the credential profile: {error}"
    );
}
