use crate::runtime::events::NoopRuntimeEvents;
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
