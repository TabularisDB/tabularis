use super::*;
use crate::models::DatabaseSelection;
use crate::runtime::events::{NoopRuntimeEvents, RuntimeEvents};
use crate::runtime::paths::FixedRuntimePaths;
use crate::runtime::secrets::RuntimeSecrets;
use std::collections::HashMap;
use std::sync::Mutex;

#[derive(Default)]
struct MemorySecrets {
    values: Mutex<HashMap<String, String>>,
}

#[derive(Default)]
struct RecordingEvents {
    values: Mutex<Vec<(String, Value)>>,
}

impl RuntimeEvents for RecordingEvents {
    fn emit(&self, event: &str, payload: Value) -> Result<(), String> {
        self.values
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .push((event.to_string(), payload));
        Ok(())
    }
}

impl RuntimeSecrets for MemorySecrets {
    fn get(&self, account: &str) -> Result<Option<String>, String> {
        Ok(self
            .values
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .get(account)
            .cloned())
    }

    fn set(&self, account: &str, secret: &str) -> Result<(), String> {
        self.values
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .insert(account.to_string(), secret.to_string());
        Ok(())
    }

    fn delete(&self, account: &str) -> Result<(), String> {
        self.values
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .remove(account);
        Ok(())
    }
}

fn fixture() -> (tempfile::TempDir, RuntimeContext, Arc<ApplicationState>) {
    let temp = tempfile::tempdir().unwrap();
    let runtime = RuntimeContext::new(
        Arc::new(FixedRuntimePaths::new(
            temp.path().to_path_buf(),
            temp.path().to_path_buf(),
        )),
        Arc::new(NoopRuntimeEvents),
        Arc::new(MemorySecrets::default()),
    );
    (temp, runtime, Arc::new(ApplicationState::default()))
}

fn connection_params(password: &str) -> ConnectionParams {
    ConnectionParams {
        driver: "postgres".to_string(),
        host: Some("127.0.0.1".to_string()),
        port: Some(5432),
        username: Some("browser-user".to_string()),
        password: Some(password.to_string()),
        database: DatabaseSelection::Single("browser-db".to_string()),
        save_in_keychain: Some(true),
        ..ConnectionParams::default()
    }
}

#[tokio::test]
async fn browser_connection_responses_keep_stored_secrets_write_only() {
    let (_temp, runtime, state) = fixture();
    let saved = execute(
        &runtime,
        &state,
        ConnectionCommand::SaveConnection {
            name: "Browser connection".to_string(),
            params: connection_params("stored-secret"),
            plugin_secret_changes: None,
            detect_json_in_text_columns: None,
            environment: Some("development".to_string()),
        },
    )
    .await
    .unwrap();

    assert!(saved["params"]["password"].is_null());
    let id = saved["id"].as_str().unwrap();
    assert_eq!(
        runtime.secrets.get(&format!("{id}:db")).unwrap().as_deref(),
        Some("stored-secret")
    );
    let persisted =
        crate::persistence::load_connections_file(&runtime.paths.connections_file()).unwrap();
    assert!(persisted.connections[0].params.password.is_none());

    let listed = execute(
        &runtime,
        &state,
        ConnectionCommand::GetConnectionsWithGroups,
    )
    .await
    .unwrap();
    assert!(listed["connections"][0]["params"]["password"].is_null());
}

/// The frontend derives delete dependents from exactly this payload, so the
/// redacted list must keep `credential_profile_id` while dropping the password.
#[tokio::test]
async fn get_connections_redacts_the_password_but_keeps_the_credential_profile_id() {
    let (_temp, runtime, state) = fixture();
    let profile = execute(
        &runtime,
        &state,
        ConnectionCommand::CreateCredentialProfile {
            name: "Shared".to_string(),
            username: "shared-user".to_string(),
            password: "profile-secret".to_string(),
        },
    )
    .await
    .unwrap();
    let profile_id = profile["id"].as_str().unwrap().to_string();

    let mut params = connection_params("inline-secret");
    params.credential_profile_id = Some(profile_id.clone());
    let saved = execute(
        &runtime,
        &state,
        ConnectionCommand::SaveConnection {
            name: "Linked".to_string(),
            params,
            plugin_secret_changes: None,
            detect_json_in_text_columns: None,
            environment: None,
        },
    )
    .await
    .unwrap();
    let connection_id = saved["id"].as_str().unwrap().to_string();

    let listed = execute(&runtime, &state, ConnectionCommand::GetConnections)
        .await
        .unwrap();
    let connection = listed
        .as_array()
        .unwrap()
        .iter()
        .find(|connection| connection["id"] == connection_id.as_str())
        .expect("the saved connection is listed");
    assert_eq!(
        connection["params"]["credential_profile_id"].as_str(),
        Some(profile_id.as_str())
    );
    assert!(connection["params"]["password"].is_null());
}

#[tokio::test]
async fn connection_groups_tags_ordering_and_duplication_share_one_service() {
    let (_temp, runtime, state) = fixture();
    let mut params = connection_params("plaintext-secret");
    params.save_in_keychain = Some(false);
    let saved = execute(
        &runtime,
        &state,
        ConnectionCommand::SaveConnection {
            name: "Original".to_string(),
            params,
            plugin_secret_changes: None,
            detect_json_in_text_columns: Some(true),
            environment: Some("staging".to_string()),
        },
    )
    .await
    .unwrap();
    let connection_id = saved["id"].as_str().unwrap().to_string();

    let group = execute(
        &runtime,
        &state,
        ConnectionCommand::CreateGroupPath {
            path: "Work/Reporting".to_string(),
            parent_id: None,
        },
    )
    .await
    .unwrap();
    let group_id = group["id"].as_str().unwrap().to_string();
    execute(
        &runtime,
        &state,
        ConnectionCommand::MoveConnectionToGroup {
            connection_id: connection_id.clone(),
            group_id: Some(group_id.clone()),
            sort_order: Some(4),
        },
    )
    .await
    .unwrap();

    let tag = execute(
        &runtime,
        &state,
        ConnectionCommand::CreateConnectionTag {
            name: "Reporting".to_string(),
            color: "#336699".to_string(),
        },
    )
    .await
    .unwrap();
    execute(
        &runtime,
        &state,
        ConnectionCommand::SetConnectionTags {
            connection_id: connection_id.clone(),
            tag_ids: vec![tag["id"].as_str().unwrap().to_string()],
        },
    )
    .await
    .unwrap();

    let duplicate = execute(
        &runtime,
        &state,
        ConnectionCommand::DuplicateConnection {
            id: connection_id.clone(),
        },
    )
    .await
    .unwrap();
    assert_eq!(duplicate["name"], "Original (Copy)");
    assert_eq!(duplicate["group_id"], group_id);
    assert!(duplicate["params"]["password"].is_null());

    let file =
        crate::persistence::load_connections_file(&runtime.paths.connections_file()).unwrap();
    assert_eq!(file.groups.len(), 2);
    assert_eq!(file.tags.len(), 1);
    assert_eq!(file.connections.len(), 2);
    assert_eq!(file.connections[0].sort_order, Some(4));
    assert_eq!(file.connections[0].tag_ids.as_ref().unwrap().len(), 1);

    execute(
        &runtime,
        &state,
        ConnectionCommand::DeleteConnection { id: connection_id },
    )
    .await
    .unwrap();
    let file =
        crate::persistence::load_connections_file(&runtime.paths.connections_file()).unwrap();
    assert_eq!(file.connections.len(), 1);
}

#[tokio::test]
async fn connection_test_failures_emit_correlated_progress() {
    let temp = tempfile::tempdir().unwrap();
    let events = Arc::new(RecordingEvents::default());
    let runtime = RuntimeContext::new(
        Arc::new(FixedRuntimePaths::new(
            temp.path().to_path_buf(),
            temp.path().to_path_buf(),
        )),
        events.clone(),
        Arc::new(MemorySecrets::default()),
    );
    let state = Arc::new(ApplicationState::default());
    let mut params = connection_params("");
    params.ssh_enabled = Some(true);

    let error = execute(
        &runtime,
        &state,
        ConnectionCommand::TestConnection {
            request: TestConnectionRequest {
                params,
                connection_id: None,
                plugin_secret_changes: Default::default(),
                progress_id: Some("progress-1".to_string()),
            },
        },
    )
    .await
    .unwrap_err();

    assert!(error.contains("Missing SSH Host"));
    let emitted = events
        .values
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    assert_eq!(emitted.len(), 2);
    assert_eq!(emitted[0].0, "connection-test-progress");
    assert_eq!(emitted[0].1["id"], "progress-1");
    assert_eq!(emitted[0].1["step"], "sshTunnel");
    assert_eq!(emitted[0].1["status"], "start");
    assert_eq!(emitted[1].1["step"], "sshTunnel");
    assert_eq!(emitted[1].1["status"], "error");
}

#[tokio::test]
async fn browser_active_connections_are_isolated_by_session() {
    let (_temp, runtime, state) = fixture();
    let session_a = Uuid::new_v4();
    let session_b = Uuid::new_v4();

    execute_for_session(
        &runtime,
        &state,
        Some(session_a),
        ConnectionCommand::RegisterActiveConnection {
            connection_id: "connection-a".to_string(),
        },
    )
    .await
    .unwrap();
    execute_for_session(
        &runtime,
        &state,
        Some(session_b),
        ConnectionCommand::RegisterActiveConnection {
            connection_id: "connection-b".to_string(),
        },
    )
    .await
    .unwrap();

    let active_a = execute_for_session(
        &runtime,
        &state,
        Some(session_a),
        ConnectionCommand::GetActiveConnections,
    )
    .await
    .unwrap();
    let active_b = execute_for_session(
        &runtime,
        &state,
        Some(session_b),
        ConnectionCommand::GetActiveConnections,
    )
    .await
    .unwrap();
    assert_eq!(active_a, serde_json::json!(["connection-a"]));
    assert_eq!(active_b, serde_json::json!(["connection-b"]));

    register_active_connection(
        &runtime,
        Some(&state),
        Some(session_a),
        "shared-connection".to_string(),
    )
    .await;
    register_active_connection(
        &runtime,
        Some(&state),
        Some(session_b),
        "shared-connection".to_string(),
    )
    .await;
    disconnect_connection(&runtime, Some(&state), Some(session_a), "shared-connection")
        .await
        .unwrap();
    let session_b_connections = active_connections(&state, Some(session_b)).await;
    assert!(session_b_connections.contains(&"shared-connection".to_string()));
    assert!(crate::health_check::active_connections()
        .await
        .contains(&"shared-connection".to_string()));

    crate::health_check::unregister_connection("connection-a").await;
    crate::health_check::unregister_connection("connection-b").await;
    crate::health_check::unregister_connection("shared-connection").await;
}

#[tokio::test]
async fn icon_upload_tokens_are_bound_to_the_authenticated_session() {
    let (_temp, runtime, state) = fixture();
    let owner = Uuid::new_v4();
    let other = Uuid::new_v4();
    let token =
        store_icon_upload(runtime.paths.data_dir(), owner, &[0x89, b'P', b'N', b'G']).unwrap();

    let rejected = execute(
        &runtime,
        &state,
        ConnectionCommand::SaveConnectionIcon {
            connection_id: "connection-1".to_string(),
            upload_token: token.clone(),
            session_id: other,
        },
    )
    .await;
    assert_eq!(rejected.unwrap_err(), "Icon upload token not found");

    let stored = execute(
        &runtime,
        &state,
        ConnectionCommand::SaveConnectionIcon {
            connection_id: "connection-1".to_string(),
            upload_token: token,
            session_id: owner,
        },
    )
    .await
    .unwrap();
    assert!(stored.as_str().unwrap().starts_with("connection-icons/"));
}

struct FailingSecrets {
    memory: MemorySecrets,
    fail_suffix: Option<&'static str>,
    block_config: Mutex<Option<PathBuf>>,
}

impl RuntimeSecrets for FailingSecrets {
    fn get(&self, account: &str) -> Result<Option<String>, String> {
        self.memory.get(account)
    }
    fn set(&self, account: &str, secret: &str) -> Result<(), String> {
        if self
            .fail_suffix
            .is_some_and(|suffix| account.ends_with(suffix))
        {
            return Err("Keychain unavailable".into());
        }
        self.memory.set(account, secret)?;
        if let Some(path) = self.block_config.lock().unwrap().take() {
            if path.is_file() {
                std::fs::remove_file(&path).unwrap();
            }
            std::fs::create_dir(&path).unwrap();
        }
        Ok(())
    }
    fn delete(&self, account: &str) -> Result<(), String> {
        self.memory.delete(account)
    }
}

#[test]
fn keychain_failure_persists_passwords_and_reports_fallback_without_exposing_them() {
    let (temp, _, state) = fixture();
    let secrets = Arc::new(FailingSecrets {
        memory: MemorySecrets::default(),
        fail_suffix: Some(":ssh"),
        block_config: Mutex::new(None),
    });
    let runtime = RuntimeContext::new(
        Arc::new(FixedRuntimePaths::new(
            temp.path().into(),
            temp.path().into(),
        )),
        Arc::new(NoopRuntimeEvents),
        secrets.clone(),
    );
    let mut params = connection_params("db-secret");
    params.ssh_enabled = Some(true);
    params.ssh_password = Some("ssh-secret".into());
    let saved = save_connection(
        &runtime,
        &state,
        "Fallback".into(),
        params,
        Default::default(),
        None,
        None,
    )
    .unwrap();
    assert_eq!(saved.params.save_in_keychain, Some(false));
    assert_eq!(saved.params.password, None);
    let persisted = find_connection(&load_file(&runtime).unwrap(), &saved.id).unwrap();
    assert_eq!(persisted.params.password.as_deref(), Some("db-secret"));
    assert_eq!(persisted.params.ssh_password.as_deref(), Some("ssh-secret"));
    assert!(secrets.memory.values.lock().unwrap().is_empty());
}

#[test]
fn failed_config_save_rolls_back_new_credentials() {
    let (temp, runtime, state) = fixture();
    let secrets = Arc::new(FailingSecrets {
        memory: MemorySecrets::default(),
        fail_suffix: None,
        block_config: Mutex::new(Some(runtime.paths.connections_file())),
    });
    let runtime = RuntimeContext::new(
        Arc::new(FixedRuntimePaths::new(
            temp.path().into(),
            temp.path().into(),
        )),
        Arc::new(NoopRuntimeEvents),
        secrets.clone(),
    );
    assert!(save_connection(
        &runtime,
        &state,
        "Failure".into(),
        connection_params("secret"),
        Default::default(),
        None,
        None
    )
    .is_err());
    assert!(secrets.memory.values.lock().unwrap().is_empty());
}

#[test]
fn duplicate_clears_a_missing_uri_marker() {
    let (_temp, runtime, state) = fixture();
    let mut params = connection_params("secret");
    params.connection_uri = Some("postgres://user:secret@localhost/db".into());
    let original = save_connection(
        &runtime,
        &state,
        "Original".into(),
        params,
        Default::default(),
        None,
        None,
    )
    .unwrap();
    runtime
        .secrets
        .delete(&secret_account(&original.id, CONNECTION_URI_SUFFIX))
        .unwrap();
    let duplicate = duplicate_connection(&runtime, &state, &original.id).unwrap();
    assert_eq!(duplicate.params.connection_uri_in_keychain, None);
}

#[test]
fn update_omitted_password_retains_the_secret_when_disabling_keychain() {
    let (_temp, runtime, state) = fixture();
    let saved = save_connection(
        &runtime,
        &state,
        "Original".into(),
        connection_params("secret"),
        Default::default(),
        None,
        None,
    )
    .unwrap();
    let mut params = saved.params;
    params.save_in_keychain = Some(false);
    update_connection(
        &runtime,
        &state,
        saved.id.clone(),
        "Edited".into(),
        params,
        Default::default(),
        None,
        None,
    )
    .unwrap();
    let persisted = find_connection(&load_file(&runtime).unwrap(), &saved.id).unwrap();
    assert_eq!(persisted.params.password.as_deref(), Some("secret"));
    assert_eq!(
        runtime
            .secrets
            .get(&secret_account(&saved.id, DB_SECRET_SUFFIX))
            .unwrap(),
        None
    );
}

#[tokio::test]
async fn switching_to_multiple_databases_backfills_saved_queries_and_history() {
    use super::super::productivity::{self, ProductivityCommand};
    let (_temp, runtime, state) = fixture();
    let saved = save_connection(
        &runtime,
        &state,
        "Original".into(),
        connection_params("secret"),
        Default::default(),
        None,
        None,
    )
    .unwrap();
    let config = runtime.paths.config_dir();
    productivity::execute(
        config,
        ProductivityCommand::SaveQuery {
            connection_id: saved.id.clone(),
            name: "Query".into(),
            sql: "SELECT 1".into(),
            database: None,
        },
    )
    .await
    .unwrap();
    productivity::execute(
        config,
        ProductivityCommand::AddQueryHistoryEntry {
            connection_id: saved.id.clone(),
            sql: "SELECT 1".into(),
            executed_at: "2026-10-15".into(),
            execution_time_ms: None,
            status: "success".into(),
            rows_affected: None,
            error: None,
            database: None,
        },
    )
    .await
    .unwrap();
    let mut params = saved.params;
    params.database = DatabaseSelection::Multiple(vec!["browser-db".into(), "other".into()]);
    update_connection(
        &runtime,
        &state,
        saved.id.clone(),
        "Edited".into(),
        params,
        Default::default(),
        None,
        None,
    )
    .unwrap();
    let queries = productivity::execute(
        config,
        ProductivityCommand::GetSavedQueries {
            connection_id: saved.id.clone(),
        },
    )
    .await
    .unwrap();
    let history = productivity::execute(
        config,
        ProductivityCommand::GetQueryHistory {
            connection_id: saved.id,
        },
    )
    .await
    .unwrap();
    assert_eq!(queries[0]["database"], "browser-db");
    assert_eq!(history["entries"][0]["database"], "browser-db");
}

#[test]
fn switching_driver_does_not_keep_the_previous_drivers_uri() {
    let (_temp, runtime, state) = fixture();
    let mut params = connection_params("secret");
    params.connection_uri = Some("postgres://user:secret@localhost/db".into());
    let saved = save_connection(
        &runtime,
        &state,
        "Original".into(),
        params,
        Default::default(),
        None,
        None,
    )
    .unwrap();
    let mut params = saved.params;
    params.driver = "mysql".into();
    let updated = update_connection(
        &runtime,
        &state,
        saved.id.clone(),
        "Edited".into(),
        params,
        Default::default(),
        None,
        None,
    )
    .unwrap();
    assert_eq!(updated.params.connection_uri_in_keychain, None);
    assert_eq!(
        runtime
            .secrets
            .get(&secret_account(&saved.id, CONNECTION_URI_SUFFIX))
            .unwrap(),
        None
    );
}

#[test]
fn unreadable_existing_secret_is_not_overwritten_or_deleted() {
    struct UnreadableSecrets(Mutex<Vec<String>>);
    impl RuntimeSecrets for UnreadableSecrets {
        fn get(&self, _account: &str) -> Result<Option<String>, String> {
            Err("Read denied".into())
        }
        fn set(&self, _account: &str, _secret: &str) -> Result<(), String> {
            self.0.lock().unwrap().push("set".into());
            Ok(())
        }
        fn delete(&self, _account: &str) -> Result<(), String> {
            self.0.lock().unwrap().push("delete".into());
            Ok(())
        }
    }
    let (temp, _, _) = fixture();
    let secrets = Arc::new(UnreadableSecrets(Mutex::new(Vec::new())));
    let runtime = RuntimeContext::new(
        Arc::new(FixedRuntimePaths::new(
            temp.path().into(),
            temp.path().into(),
        )),
        Arc::new(NoopRuntimeEvents),
        secrets.clone(),
    );
    let mut writes = SecretWrites::default();
    assert!(writes
        .set(&runtime, "existing:db".into(), "replacement")
        .is_err());
    writes.rollback(&runtime);
    assert!(secrets.0.lock().unwrap().is_empty());
}

#[test]
fn plugin_secrets_live_in_the_keychain_for_the_whole_connection_lifecycle() {
    let (_temp, runtime, state) = fixture();
    let mut params = connection_params("db-secret");
    params.driver = "test-plugin".to_string();
    params
        .extra
        .insert("token".to_string(), "inline-token".to_string());
    let changes = HashMap::from([("token".to_string(), Some("stored-token".to_string()))]);
    let saved = save_connection(
        &runtime,
        &state,
        "Plugin".into(),
        params,
        changes,
        None,
        None,
    )
    .unwrap();
    let account = |id: &str| format!("{id}:plugin:test-plugin:token");

    assert_eq!(saved.plugin_secret_keys, vec!["token"]);
    let persisted = find_connection(&load_file(&runtime).unwrap(), &saved.id).unwrap();
    assert!(!persisted.params.extra.contains_key("token"));
    assert_eq!(
        runtime.secrets.get(&account(&saved.id)).unwrap().as_deref(),
        Some("stored-token")
    );
    assert_eq!(
        load_plugin_secrets(&runtime, &persisted)
            .get("token")
            .map(String::as_str),
        Some("stored-token")
    );

    let duplicate = duplicate_connection(&runtime, &state, &saved.id).unwrap();
    assert_eq!(duplicate.plugin_secret_keys, vec!["token"]);
    assert_eq!(
        runtime
            .secrets
            .get(&account(&duplicate.id))
            .unwrap()
            .as_deref(),
        Some("stored-token")
    );

    let cleared = HashMap::from([("token".to_string(), None)]);
    let updated = update_connection(
        &runtime,
        &state,
        saved.id.clone(),
        "Plugin".into(),
        persisted.params,
        cleared,
        None,
        None,
    )
    .unwrap();
    assert!(updated.plugin_secret_keys.is_empty());
    assert_eq!(runtime.secrets.get(&account(&saved.id)).unwrap(), None);

    delete_connection(&runtime, &state, &duplicate.id).unwrap();
    assert_eq!(runtime.secrets.get(&account(&duplicate.id)).unwrap(), None);
}

#[test]
fn sql_builder_secrets_bind_stored_plugin_secrets_and_tolerate_missing_ones() {
    let (_temp, runtime, _state) = fixture();
    runtime
        .secrets
        .set("conn-1:plugin:test-plugin:credential", "stored-credential")
        .unwrap();
    let mut connection = SavedConnection {
        id: "conn-1".to_string(),
        name: "Plugin".to_string(),
        params: ConnectionParams {
            driver: "test-plugin".to_string(),
            host: Some("db.internal".to_string()),
            ssh_enabled: Some(true),
            ..ConnectionParams::default()
        },
        plugin_secret_keys: vec!["credential".to_string(), "missing".to_string()],
        group_id: None,
        sort_order: None,
        detect_json_in_text_columns: None,
        appearance: None,
        tag_ids: None,
        environment: None,
    };

    bind_sql_builder_secrets(&runtime, &mut connection).unwrap();
    let built = crate::commands::sql_builder_params(&connection, Some("analytics".into()));

    assert_eq!(
        built.extra.get("credential").map(String::as_str),
        Some("stored-credential")
    );
    assert!(!built.extra.contains_key("missing"));
    assert_eq!(built.host.as_deref(), Some("db.internal"));
    assert_eq!(
        built.database,
        DatabaseSelection::Single("analytics".to_string())
    );
}

fn fixture_with_secrets() -> (
    tempfile::TempDir,
    RuntimeContext,
    Arc<ApplicationState>,
    Arc<MemorySecrets>,
) {
    let temp = tempfile::tempdir().unwrap();
    let secrets = Arc::new(MemorySecrets::default());
    let runtime = RuntimeContext::new(
        Arc::new(FixedRuntimePaths::new(
            temp.path().to_path_buf(),
            temp.path().to_path_buf(),
        )),
        Arc::new(NoopRuntimeEvents),
        secrets.clone(),
    );
    (
        temp,
        runtime,
        Arc::new(ApplicationState::default()),
        secrets,
    )
}

fn stored_accounts(secrets: &MemorySecrets, connection_id: &str) -> Vec<String> {
    let mut accounts: Vec<String> = secrets
        .values
        .lock()
        .unwrap()
        .keys()
        .filter(|account| account.starts_with(connection_id))
        .cloned()
        .collect();
    accounts.sort();
    accounts
}

async fn add_history(runtime: &RuntimeContext, connection_id: &str) {
    use super::super::productivity::{self, ProductivityCommand};
    productivity::execute(
        runtime.paths.config_dir(),
        ProductivityCommand::AddQueryHistoryEntry {
            connection_id: connection_id.into(),
            sql: "SELECT 1".into(),
            executed_at: "2026-10-22".into(),
            execution_time_ms: None,
            status: "success".into(),
            rows_affected: None,
            error: None,
            database: None,
        },
    )
    .await
    .unwrap();
}

async fn history_len(runtime: &RuntimeContext, connection_id: &str) -> usize {
    use super::super::productivity::{self, ProductivityCommand};
    productivity::execute(
        runtime.paths.config_dir(),
        ProductivityCommand::GetQueryHistory {
            connection_id: connection_id.into(),
        },
    )
    .await
    .unwrap()["entries"]
        .as_array()
        .unwrap()
        .len()
}

#[tokio::test]
async fn deleting_a_connection_removes_its_secrets_and_history() {
    let (_temp, runtime, state, secrets) = fixture_with_secrets();
    let saved = save_connection(
        &runtime,
        &state,
        "Doomed".into(),
        connection_params("secret"),
        Default::default(),
        None,
        None,
    )
    .unwrap();
    add_history(&runtime, &saved.id).await;
    assert!(!stored_accounts(&secrets, &saved.id).is_empty());

    delete_connection(&runtime, &state, &saved.id).unwrap();

    assert!(stored_accounts(&secrets, &saved.id).is_empty());
    assert_eq!(history_len(&runtime, &saved.id).await, 0);
}

#[tokio::test]
async fn deleting_a_group_cleans_up_every_connection_in_it() {
    let (_temp, runtime, state, secrets) = fixture_with_secrets();
    let group = execute(
        &runtime,
        &state,
        ConnectionCommand::CreateConnectionGroup {
            name: "Doomed".into(),
            parent_id: None,
        },
    )
    .await
    .unwrap();
    let group_id = group["id"].as_str().unwrap().to_string();
    let saved = save_connection(
        &runtime,
        &state,
        "Grouped".into(),
        connection_params("secret"),
        Default::default(),
        None,
        None,
    )
    .unwrap();
    execute(
        &runtime,
        &state,
        ConnectionCommand::MoveConnectionToGroup {
            connection_id: saved.id.clone(),
            group_id: Some(group_id.clone()),
            sort_order: None,
        },
    )
    .await
    .unwrap();
    add_history(&runtime, &saved.id).await;

    execute(
        &runtime,
        &state,
        ConnectionCommand::DeleteConnectionGroup { id: group_id },
    )
    .await
    .unwrap();

    assert!(load_file(&runtime).unwrap().connections.is_empty());
    assert!(stored_accounts(&secrets, &saved.id).is_empty());
    assert_eq!(history_len(&runtime, &saved.id).await, 0);
}

#[test]
fn iam_guard_requires_a_token() {
    let error = require_iam_token(true, None).unwrap_err();
    assert!(error.contains("AWS IAM authentication is enabled"));
    assert!(error.contains("15 minutes"));
    assert!(require_iam_token(true, Some("")).is_err());
    require_iam_token(true, Some("token")).unwrap();
    require_iam_token(false, None).unwrap();
}

#[tokio::test]
async fn testing_an_iam_connection_never_uses_the_stored_password() {
    let (_temp, runtime, state, _secrets) = fixture_with_secrets();
    let mut params = connection_params("stale-token");
    params.use_iam_auth = Some(true);
    let saved = save_connection(
        &runtime,
        &state,
        "IAM".into(),
        params,
        Default::default(),
        None,
        None,
    )
    .unwrap();
    let mut request_params = saved.params.clone();
    request_params.password = None;
    let error = execute(
        &runtime,
        &state,
        ConnectionCommand::TestConnection {
            request: TestConnectionRequest {
                params: request_params,
                connection_id: Some(saved.id.clone()),
                progress_id: None,
                plugin_secret_changes: Default::default(),
            },
        },
    )
    .await
    .unwrap_err();
    assert!(
        error.contains("AWS IAM authentication is enabled"),
        "{error}"
    );

    let mut restored = saved.params.clone();
    restore_secrets(&runtime, &saved.id, &mut restored).unwrap();
    assert_eq!(restored.password, None);
}

#[test]
fn duplicating_an_iam_connection_does_not_copy_the_token() {
    let (_temp, runtime, state, secrets) = fixture_with_secrets();
    let mut params = connection_params("stale-token");
    params.use_iam_auth = Some(true);
    let saved = save_connection(
        &runtime,
        &state,
        "IAM".into(),
        params,
        Default::default(),
        None,
        None,
    )
    .unwrap();
    let copy = duplicate_connection(&runtime, &state, &saved.id).unwrap();
    assert!(!stored_accounts(&secrets, &copy.id).contains(&format!("{}:db", copy.id)));
}

#[test]
fn a_missing_keychain_uri_fails_the_connection_with_a_clear_message() {
    let (_temp, runtime, state, secrets) = fixture_with_secrets();
    let mut params = connection_params("secret");
    params.connection_uri = Some("postgres://user:secret@localhost/db".into());
    let saved = save_connection(
        &runtime,
        &state,
        "URI".into(),
        params,
        Default::default(),
        None,
        None,
    )
    .unwrap();
    secrets
        .values
        .lock()
        .unwrap()
        .remove(&format!("{}:connection_uri", saved.id));
    let error = resolve_saved_connection_params(&runtime, None, &saved.id).unwrap_err();
    assert_eq!(
        error,
        "Stored connection URI is unavailable in the OS keychain"
    );
}

#[test]
fn ssh_secrets_follow_the_tunnel_toggle() {
    let (_temp, runtime, state, secrets) = fixture_with_secrets();
    let mut params = connection_params("secret");
    params.ssh_password = Some("ssh-secret".into());
    let without_ssh = save_connection(
        &runtime,
        &state,
        "No tunnel".into(),
        params.clone(),
        Default::default(),
        None,
        None,
    )
    .unwrap();
    assert_eq!(
        stored_accounts(&secrets, &without_ssh.id),
        vec![format!("{}:db", without_ssh.id)]
    );

    params.ssh_enabled = Some(true);
    params.ssh_key_passphrase = Some("passphrase".into());
    let with_ssh = save_connection(
        &runtime,
        &state,
        "Tunnel".into(),
        params,
        Default::default(),
        None,
        None,
    )
    .unwrap();
    let ssh_password = format!("{}:ssh", with_ssh.id);
    let passphrase = format!("{}:ssh_passphrase", with_ssh.id);

    // An empty passphrase field keeps the stored one.
    let mut edit = with_ssh.params.clone();
    edit.ssh_key_passphrase = Some(" ".into());
    update_connection(
        &runtime,
        &state,
        with_ssh.id.clone(),
        "Tunnel".into(),
        edit.clone(),
        Default::default(),
        None,
        None,
    )
    .unwrap();
    assert!(stored_accounts(&secrets, &with_ssh.id).contains(&passphrase));

    // Turning the tunnel off drops its secrets.
    edit.ssh_enabled = Some(false);
    update_connection(
        &runtime,
        &state,
        with_ssh.id.clone(),
        "Tunnel".into(),
        edit,
        Default::default(),
        None,
        None,
    )
    .unwrap();
    let accounts = stored_accounts(&secrets, &with_ssh.id);
    assert!(!accounts.contains(&ssh_password));
    assert!(!accounts.contains(&passphrase));
    assert!(accounts.contains(&format!("{}:db", with_ssh.id)));
}

#[tokio::test]
async fn creating_a_sqlite_database_saves_a_connection_to_the_new_file() {
    let (temp, runtime, state) = fixture();
    let path = temp.path().join("inventory.sqlite");
    let created = execute(
        &runtime,
        &state,
        ConnectionCommand::CreateSqliteDatabase {
            path: path.to_string_lossy().into_owned(),
        },
    )
    .await
    .unwrap();
    assert!(path.is_file());
    assert_eq!(created["params"]["driver"], "sqlite");
    assert_eq!(load_file(&runtime).unwrap().connections.len(), 1);
}

fn credential_profile(id: &str, username: &str) -> CredentialProfile {
    CredentialProfile {
        id: id.to_string(),
        name: format!("{id} profile"),
        username: username.to_string(),
    }
}

fn profile_connection(
    id: &str,
    username: &str,
    password: Option<&str>,
    profile_id: Option<&str>,
) -> SavedConnection {
    SavedConnection {
        id: id.to_string(),
        name: id.to_string(),
        params: ConnectionParams {
            driver: "postgres".to_string(),
            host: Some("127.0.0.1".to_string()),
            port: Some(5432),
            username: Some(username.to_string()),
            password: password.map(str::to_string),
            database: DatabaseSelection::Single("browser-db".to_string()),
            save_in_keychain: Some(false),
            credential_profile_id: profile_id.map(str::to_string),
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

fn store_profile_fixture(
    runtime: &RuntimeContext,
    connections: Vec<SavedConnection>,
    profiles: Vec<CredentialProfile>,
) {
    crate::persistence::save_connections_file(
        &runtime.paths.connections_file(),
        &ConnectionsFile {
            connections,
            credential_profiles: profiles,
            ..ConnectionsFile::default()
        },
    )
    .unwrap();
}

fn load_profile_fixture_connection(runtime: &RuntimeContext, id: &str) -> SavedConnection {
    load_file(runtime)
        .unwrap()
        .connections
        .into_iter()
        .find(|connection| connection.id == id)
        .unwrap()
}

#[test]
fn two_connections_share_one_credential_profile() {
    let (_temp, runtime, _state, secrets) = fixture_with_secrets();
    secrets
        .set(
            &profile_db_secret_account("shared-profile"),
            "shared-password",
        )
        .unwrap();
    store_profile_fixture(
        &runtime,
        vec![
            profile_connection(
                "first",
                "first-inline",
                Some("first-inline-password"),
                Some("shared-profile"),
            ),
            profile_connection(
                "second",
                "second-inline",
                Some("second-inline-password"),
                Some("shared-profile"),
            ),
        ],
        vec![credential_profile("shared-profile", "shared-user")],
    );

    let (_, first) = resolve_saved_connection_params(&runtime, None, "first").unwrap();
    let (_, second) = resolve_saved_connection_params(&runtime, None, "second").unwrap();

    for resolved in [first, second] {
        assert_eq!(resolved.username.as_deref(), Some("shared-user"));
        assert_eq!(resolved.password.as_deref(), Some("shared-password"));
    }
}

#[test]
fn credential_profile_username_and_password_override_connection_credentials() {
    let (_temp, runtime, _state, secrets) = fixture_with_secrets();
    secrets
        .set(&profile_db_secret_account("profile-1"), "profile-password")
        .unwrap();
    store_profile_fixture(
        &runtime,
        vec![profile_connection(
            "conn-1",
            "inline-user",
            Some("inline-password"),
            Some("profile-1"),
        )],
        vec![credential_profile("profile-1", "profile-user")],
    );

    let (_, resolved) = resolve_saved_connection_params(&runtime, None, "conn-1").unwrap();

    assert_eq!(resolved.username.as_deref(), Some("profile-user"));
    assert_eq!(resolved.password.as_deref(), Some("profile-password"));
}

#[test]
fn missing_credential_profile_fails_closed_instead_of_using_the_connection_password() {
    let (_temp, runtime, _state, _secrets) = fixture_with_secrets();
    store_profile_fixture(
        &runtime,
        vec![profile_connection(
            "conn-1",
            "inline-user",
            Some("inline-password"),
            Some("missing-profile"),
        )],
        Vec::new(),
    );

    let error = resolve_saved_connection_params(&runtime, None, "conn-1").unwrap_err();

    assert!(
        error.contains("Credential profile 'missing-profile' not found"),
        "{error}"
    );
}

#[test]
fn credential_profile_without_a_stored_password_fails_closed() {
    let (_temp, runtime, _state, _secrets) = fixture_with_secrets();
    store_profile_fixture(
        &runtime,
        vec![profile_connection(
            "conn-1",
            "inline-user",
            Some("inline-password"),
            Some("profile-1"),
        )],
        vec![credential_profile("profile-1", "profile-user")],
    );

    let error = resolve_saved_connection_params(&runtime, None, "conn-1").unwrap_err();

    assert!(
        error.contains("Password for credential profile 'profile-1' is unavailable"),
        "{error}"
    );
}

#[test]
fn iam_and_legacy_connections_are_unchanged() {
    let (_temp, runtime, _state, secrets) = fixture_with_secrets();
    let mut iam = profile_connection("iam", "iam-user", Some("iam-token"), None);
    iam.params.use_iam_auth = Some(true);
    let mut legacy = profile_connection("legacy", "legacy-user", None, None);
    legacy.params.save_in_keychain = Some(true);
    store_profile_fixture(&runtime, vec![iam, legacy], Vec::new());
    secrets.set("legacy:db", "legacy-secret").unwrap();

    let (_, iam) = resolve_saved_connection_params(&runtime, None, "iam").unwrap();
    assert_eq!(iam.username.as_deref(), Some("iam-user"));
    assert_eq!(iam.password.as_deref(), Some("iam-token"));

    let (_, legacy) = resolve_saved_connection_params(&runtime, None, "legacy").unwrap();
    assert_eq!(legacy.username.as_deref(), Some("legacy-user"));
    assert_eq!(legacy.password.as_deref(), Some("legacy-secret"));
}

#[test]
fn sql_builder_uses_the_credential_profile_without_falling_back() {
    let (_temp, runtime, _state, secrets) = fixture_with_secrets();
    secrets
        .set(&profile_db_secret_account("profile-1"), "profile-password")
        .unwrap();
    secrets.set("conn-1:db", "connection-password").unwrap();
    let mut connection = profile_connection("conn-1", "inline-user", None, Some("profile-1"));
    connection.params.save_in_keychain = Some(true);
    store_profile_fixture(
        &runtime,
        vec![connection],
        vec![credential_profile("profile-1", "profile-user")],
    );

    let mut connection = load_profile_fixture_connection(&runtime, "conn-1");
    bind_sql_builder_secrets(&runtime, &mut connection).unwrap();

    assert_eq!(connection.params.username.as_deref(), Some("profile-user"));
    assert_eq!(
        connection.params.password.as_deref(),
        Some("profile-password")
    );
}

#[test]
fn sql_builder_fails_closed_when_credential_profile_is_missing() {
    let (_temp, runtime, _state, secrets) = fixture_with_secrets();
    let missing_profile = profile_connection(
        "conn-2",
        "inline-user",
        Some("inline-password"),
        Some("missing"),
    );
    store_profile_fixture(&runtime, vec![missing_profile], Vec::new());
    secrets.set("conn-2:db", "connection-password").unwrap();
    let mut connection = load_profile_fixture_connection(&runtime, "conn-2");

    let error = bind_sql_builder_secrets(&runtime, &mut connection).unwrap_err();

    assert!(error.contains("Credential profile 'missing' not found"));
    assert_eq!(connection.params.username.as_deref(), Some("inline-user"));
    assert_eq!(connection.params.password.as_deref(), None);
}

#[test]
fn sql_builder_fails_closed_when_credential_profile_password_is_missing() {
    let (_temp, runtime, _state, _secrets) = fixture_with_secrets();
    store_profile_fixture(
        &runtime,
        vec![profile_connection(
            "conn-1",
            "inline-user",
            Some("inline-password"),
            Some("profile-1"),
        )],
        vec![credential_profile("profile-1", "profile-user")],
    );
    let mut connection = load_profile_fixture_connection(&runtime, "conn-1");

    let error = bind_sql_builder_secrets(&runtime, &mut connection).unwrap_err();

    assert!(error.contains("Password for credential profile 'profile-1'"));
    assert_eq!(connection.params.username.as_deref(), Some("inline-user"));
    assert_eq!(connection.params.password.as_deref(), None);
}

#[test]
fn credential_profile_password_does_not_share_keychain_account_with_connection_id() {
    let (_temp, runtime, _state, secrets) = fixture_with_secrets();
    let shared_id = "shared-id";
    secrets
        .set(&format!("{shared_id}:db"), "connection-password")
        .unwrap();
    secrets
        .set(&profile_db_secret_account(shared_id), "profile-password")
        .unwrap();
    store_profile_fixture(
        &runtime,
        vec![profile_connection(
            shared_id,
            "inline-user",
            Some("inline-password"),
            Some(shared_id),
        )],
        vec![credential_profile(shared_id, "profile-user")],
    );

    let (_, resolved) = resolve_saved_connection_params(&runtime, None, shared_id).unwrap();
    assert_eq!(resolved.username.as_deref(), Some("profile-user"));
    assert_eq!(resolved.password.as_deref(), Some("profile-password"));

    secrets.delete(&format!("{shared_id}:db")).unwrap();
    let (_, without_connection_secret) =
        resolve_saved_connection_params(&runtime, None, shared_id).unwrap();
    assert_eq!(
        without_connection_secret.password.as_deref(),
        Some("profile-password")
    );
}

#[test]
fn connection_test_request_uses_the_credential_profile() {
    let (_temp, runtime, _state, secrets) = fixture_with_secrets();
    secrets
        .set(&profile_db_secret_account("profile-1"), "profile-password")
        .unwrap();
    store_profile_fixture(
        &runtime,
        vec![profile_connection(
            "conn-1",
            "inline-user",
            Some("inline-password"),
            Some("profile-1"),
        )],
        vec![credential_profile("profile-1", "profile-user")],
    );

    let connection = load_profile_fixture_connection(&runtime, "conn-1");
    let mut request = TestConnectionRequest {
        params: connection.params,
        connection_id: Some("conn-1".to_string()),
        plugin_secret_changes: std::collections::HashMap::new(),
        progress_id: None,
    };

    prepare_connection_request(&runtime, &mut request).unwrap();

    assert_eq!(request.params.username.as_deref(), Some("profile-user"));
    assert_eq!(request.params.password.as_deref(), Some("profile-password"));
}

#[tokio::test]
async fn credential_profile_create_list_and_update_never_expose_passwords() {
    let (_temp, runtime, state) = fixture();
    let created = execute(
        &runtime,
        &state,
        ConnectionCommand::CreateCredentialProfile {
            name: "Shared login".to_string(),
            username: "db-user".to_string(),
            password: "initial-password".to_string(),
        },
    )
    .await
    .unwrap();
    let profile_id = created["id"].as_str().unwrap().to_string();
    assert!(created.get("password").is_none());

    let listed = execute(&runtime, &state, ConnectionCommand::ListCredentialProfiles)
        .await
        .unwrap();
    assert_eq!(listed.as_array().unwrap().len(), 1);
    assert!(listed[0].get("password").is_none());

    execute(
        &runtime,
        &state,
        ConnectionCommand::UpdateCredentialProfile {
            id: profile_id.clone(),
            name: "Shared login".to_string(),
            username: "db-user-2".to_string(),
            password: Some("rotated-password".to_string()),
        },
    )
    .await
    .unwrap();

    let listed_after = execute(&runtime, &state, ConnectionCommand::ListCredentialProfiles)
        .await
        .unwrap();
    assert_eq!(listed_after[0]["username"], "db-user-2");
    assert_eq!(
        runtime
            .secrets
            .get(&profile_db_secret_account(&profile_id))
            .unwrap()
            .as_deref(),
        Some("rotated-password")
    );
}

#[tokio::test]
async fn rotating_a_credential_profile_password_updates_all_linked_connections() {
    let (_temp, runtime, state) = fixture();
    let profile = execute(
        &runtime,
        &state,
        ConnectionCommand::CreateCredentialProfile {
            name: "Shared".to_string(),
            username: "shared-user".to_string(),
            password: "password-v1".to_string(),
        },
    )
    .await
    .unwrap();
    let profile_id = profile["id"].as_str().unwrap().to_string();

    let mut params = connection_params("ignored-inline");
    params.credential_profile_id = Some(profile_id.clone());
    let mut connection_ids = Vec::new();
    for name in ["conn-a", "conn-b"] {
        let saved = execute(
            &runtime,
            &state,
            ConnectionCommand::SaveConnection {
                name: name.to_string(),
                params: params.clone(),
                plugin_secret_changes: None,
                detect_json_in_text_columns: None,
                environment: None,
            },
        )
        .await
        .unwrap();
        connection_ids.push(saved["id"].as_str().unwrap().to_string());
    }

    execute(
        &runtime,
        &state,
        ConnectionCommand::UpdateCredentialProfile {
            id: profile_id.clone(),
            name: "Shared".to_string(),
            username: "shared-user".to_string(),
            password: Some("password-v2".to_string()),
        },
    )
    .await
    .unwrap();

    for connection_id in connection_ids {
        let connection = load_profile_fixture_connection(&runtime, &connection_id);
        let mut request = TestConnectionRequest {
            params: connection.params,
            connection_id: Some(connection_id.to_string()),
            plugin_secret_changes: HashMap::new(),
            progress_id: None,
        };
        prepare_connection_request(&runtime, &mut request).unwrap();
        assert_eq!(request.params.password.as_deref(), Some("password-v2"));
    }
}

#[tokio::test]
async fn save_connection_with_profile_does_not_write_connection_db_secret() {
    let (_temp, runtime, state) = fixture();
    let profile = execute(
        &runtime,
        &state,
        ConnectionCommand::CreateCredentialProfile {
            name: "Shared".to_string(),
            username: "profile-user".to_string(),
            password: "profile-password".to_string(),
        },
    )
    .await
    .unwrap();
    let profile_id = profile["id"].as_str().unwrap().to_string();

    let mut params = connection_params("inline-should-not-persist");
    params.credential_profile_id = Some(profile_id.clone());
    let saved = execute(
        &runtime,
        &state,
        ConnectionCommand::SaveConnection {
            name: "Linked".to_string(),
            params,
            plugin_secret_changes: None,
            detect_json_in_text_columns: None,
            environment: None,
        },
    )
    .await
    .unwrap();
    let connection_id = saved["id"].as_str().unwrap();
    assert!(runtime
        .secrets
        .get(&format!("{connection_id}:db"))
        .unwrap()
        .is_none());
    assert_eq!(
        runtime
            .secrets
            .get(&profile_db_secret_account(&profile_id))
            .unwrap()
            .as_deref(),
        Some("profile-password")
    );
}

#[tokio::test]
async fn legacy_connection_save_without_profile_still_writes_connection_db_secret() {
    let (_temp, runtime, state) = fixture();
    let saved = execute(
        &runtime,
        &state,
        ConnectionCommand::SaveConnection {
            name: "Standalone".to_string(),
            params: connection_params("standalone-password"),
            plugin_secret_changes: None,
            detect_json_in_text_columns: None,
            environment: None,
        },
    )
    .await
    .unwrap();
    let connection_id = saved["id"].as_str().unwrap();
    assert_eq!(
        runtime
            .secrets
            .get(&format!("{connection_id}:db"))
            .unwrap()
            .as_deref(),
        Some("standalone-password")
    );
}

struct FailProfilePasswordSecrets {
    inner: MemorySecrets,
}

impl RuntimeSecrets for FailProfilePasswordSecrets {
    fn get(&self, account: &str) -> Result<Option<String>, String> {
        self.inner.get(account)
    }

    fn set(&self, account: &str, secret: &str) -> Result<(), String> {
        if account.ends_with(":profile:db") {
            return Err("simulated keychain failure".to_string());
        }
        self.inner.set(account, secret)
    }

    fn delete(&self, account: &str) -> Result<(), String> {
        self.inner.delete(account)
    }
}

#[tokio::test]
async fn create_credential_profile_rolls_back_when_keychain_write_fails() {
    let temp = tempfile::tempdir().unwrap();
    let runtime = RuntimeContext::new(
        Arc::new(FixedRuntimePaths::new(
            temp.path().to_path_buf(),
            temp.path().to_path_buf(),
        )),
        Arc::new(NoopRuntimeEvents),
        Arc::new(FailProfilePasswordSecrets {
            inner: MemorySecrets::default(),
        }),
    );
    let state = Arc::new(ApplicationState::default());

    let error = execute(
        &runtime,
        &state,
        ConnectionCommand::CreateCredentialProfile {
            name: "Broken".to_string(),
            username: "user".to_string(),
            password: "secret".to_string(),
        },
    )
    .await
    .unwrap_err();
    assert!(error.contains("keychain"));

    let file =
        crate::persistence::load_connections_file(&runtime.paths.connections_file()).unwrap();
    assert!(file.credential_profiles.is_empty());
}

#[tokio::test]
async fn profile_linked_connection_with_save_in_keychain_false_does_not_persist_inline_password() {
    let (_temp, runtime, state) = fixture();
    let profile = execute(
        &runtime,
        &state,
        ConnectionCommand::CreateCredentialProfile {
            name: "Shared".to_string(),
            username: "profile-user".to_string(),
            password: "profile-password".to_string(),
        },
    )
    .await
    .unwrap();
    let profile_id = profile["id"].as_str().unwrap().to_string();

    let mut params = connection_params("inline-password-must-not-persist");
    params.save_in_keychain = Some(false);
    params.credential_profile_id = Some(profile_id);

    execute(
        &runtime,
        &state,
        ConnectionCommand::SaveConnection {
            name: "Linked without keychain".to_string(),
            params,
            plugin_secret_changes: None,
            detect_json_in_text_columns: None,
            environment: None,
        },
    )
    .await
    .unwrap();

    let json = std::fs::read_to_string(runtime.paths.connections_file()).unwrap();
    assert!(!json.contains("inline-password-must-not-persist"));
    let persisted =
        crate::persistence::load_connections_file(&runtime.paths.connections_file()).unwrap();
    assert!(persisted.connections[0].params.password.is_none());
}

#[tokio::test]
async fn linking_profile_abc_to_connection_abc_profile_is_rejected() {
    let (_temp, runtime, state) = fixture();
    store_profile_fixture(
        &runtime,
        vec![profile_connection(
            "abc:profile",
            "inline-user",
            Some("inline-password"),
            None,
        )],
        vec![credential_profile("abc", "profile-user")],
    );

    let existing = load_profile_fixture_connection(&runtime, "abc:profile");
    let mut params = existing.params.clone();
    params.credential_profile_id = Some("abc".to_string());

    let error = execute(
        &runtime,
        &state,
        ConnectionCommand::UpdateConnection {
            id: "abc:profile".to_string(),
            name: existing.name,
            params,
            plugin_secret_changes: None,
            detect_json_in_text_columns: None,
            environment: None,
        },
    )
    .await
    .unwrap_err();
    assert!(error.contains("keychain"));
}

#[test]
fn colliding_profile_keychain_account_is_not_cleared_as_connection_db_secret() {
    let (_temp, _runtime, _state, secrets) = fixture_with_secrets();
    let account = profile_db_secret_account("abc");
    secrets.set(&account, "profile-owned-secret").unwrap();

    assert!(
        crate::credential_profiles::connection_db_collides_with_profile_db("abc:profile", "abc",)
    );
    if !crate::credential_profiles::connection_db_collides_with_profile_db("abc:profile", "abc") {
        secrets.delete(&account).unwrap();
    }

    assert_eq!(
        secrets.get(&account).unwrap().as_deref(),
        Some("profile-owned-secret")
    );
}

#[tokio::test]
async fn delete_unused_credential_profile_removes_metadata_and_keychain_secret() {
    let (_temp, runtime, state) = fixture();
    let created = execute(
        &runtime,
        &state,
        ConnectionCommand::CreateCredentialProfile {
            name: "Disposable".to_string(),
            username: "user".to_string(),
            password: "profile-secret".to_string(),
        },
    )
    .await
    .unwrap();
    let profile_id = created["id"].as_str().unwrap().to_string();

    execute(
        &runtime,
        &state,
        ConnectionCommand::DeleteCredentialProfile {
            id: profile_id.clone(),
        },
    )
    .await
    .unwrap();

    let file =
        crate::persistence::load_connections_file(&runtime.paths.connections_file()).unwrap();
    assert!(file.credential_profiles.is_empty());
    assert!(runtime
        .secrets
        .get(&profile_db_secret_account(&profile_id))
        .unwrap()
        .is_none());
}

#[tokio::test]
async fn delete_credential_profile_blocked_when_connections_reference_it() {
    let (_temp, runtime, state) = fixture();
    let profile = execute(
        &runtime,
        &state,
        ConnectionCommand::CreateCredentialProfile {
            name: "Shared".to_string(),
            username: "shared-user".to_string(),
            password: "profile-secret".to_string(),
        },
    )
    .await
    .unwrap();
    let profile_id = profile["id"].as_str().unwrap().to_string();

    let mut params = connection_params("ignored");
    params.credential_profile_id = Some(profile_id.clone());
    let saved = execute(
        &runtime,
        &state,
        ConnectionCommand::SaveConnection {
            name: "Linked".to_string(),
            params,
            plugin_secret_changes: None,
            detect_json_in_text_columns: None,
            environment: None,
        },
    )
    .await
    .unwrap();
    let connection_id = saved["id"].as_str().unwrap().to_string();

    let error = execute(
        &runtime,
        &state,
        ConnectionCommand::DeleteCredentialProfile {
            id: profile_id.clone(),
        },
    )
    .await
    .unwrap_err();
    let blocked: crate::credential_profiles::CredentialProfileDeleteBlockedError =
        serde_json::from_str(&error).unwrap();
    assert_eq!(
        blocked.code,
        crate::credential_profiles::CREDENTIAL_PROFILE_DELETE_BLOCKED_CODE
    );
    assert_eq!(blocked.connections.len(), 1);
    assert_eq!(blocked.connections[0].id, connection_id);
    assert_eq!(blocked.connections[0].name, "Linked");

    let file =
        crate::persistence::load_connections_file(&runtime.paths.connections_file()).unwrap();
    assert_eq!(file.credential_profiles.len(), 1);
    assert_eq!(
        runtime
            .secrets
            .get(&profile_db_secret_account(&profile_id))
            .unwrap()
            .as_deref(),
        Some("profile-secret")
    );
}

#[tokio::test]
async fn update_connection_unlinks_credential_profile_and_persists_inline_password() {
    let (_temp, runtime, state) = fixture();
    let profile = execute(
        &runtime,
        &state,
        ConnectionCommand::CreateCredentialProfile {
            name: "Shared".to_string(),
            username: "profile-user".to_string(),
            password: "profile-password".to_string(),
        },
    )
    .await
    .unwrap();
    let profile_id = profile["id"].as_str().unwrap().to_string();

    let mut params = connection_params("ignored-inline");
    params.credential_profile_id = Some(profile_id.clone());
    params.password = None;
    let saved = execute(
        &runtime,
        &state,
        ConnectionCommand::SaveConnection {
            name: "Linked".to_string(),
            params,
            plugin_secret_changes: None,
            detect_json_in_text_columns: None,
            environment: None,
        },
    )
    .await
    .unwrap();
    let connection_id = saved["id"].as_str().unwrap().to_string();

    let linked = load_profile_fixture_connection(&runtime, &connection_id);
    assert_eq!(
        linked.params.credential_profile_id.as_deref(),
        Some(profile_id.as_str())
    );

    let mut unlinked = linked.params.clone();
    unlinked.credential_profile_id = None;
    unlinked.username = Some("inline-user".to_string());
    unlinked.password = Some("inline-after-unlink".to_string());

    execute(
        &runtime,
        &state,
        ConnectionCommand::UpdateConnection {
            id: connection_id.clone(),
            name: "Linked".to_string(),
            params: unlinked,
            plugin_secret_changes: None,
            detect_json_in_text_columns: None,
            environment: None,
        },
    )
    .await
    .unwrap();

    let persisted = load_profile_fixture_connection(&runtime, &connection_id);
    assert!(persisted.params.credential_profile_id.is_none());
    assert_eq!(persisted.params.username.as_deref(), Some("inline-user"));

    let json = std::fs::read_to_string(runtime.paths.connections_file()).unwrap();
    assert!(!json.contains("credential_profile_id"));

    let mut request = TestConnectionRequest {
        params: persisted.params.clone(),
        connection_id: Some(connection_id),
        plugin_secret_changes: HashMap::new(),
        progress_id: None,
    };
    prepare_connection_request(&runtime, &mut request).unwrap();
    assert_eq!(
        request.params.password.as_deref(),
        Some("inline-after-unlink")
    );
    assert_eq!(
        runtime
            .secrets
            .get(&profile_db_secret_account(&profile_id))
            .unwrap()
            .as_deref(),
        Some("profile-password")
    );
}

#[tokio::test]
async fn delete_unknown_credential_profile_fails() {
    let (_temp, runtime, state) = fixture();
    let error = execute(
        &runtime,
        &state,
        ConnectionCommand::DeleteCredentialProfile {
            id: "missing-profile".to_string(),
        },
    )
    .await
    .unwrap_err();
    assert!(error.contains("not found"));
}

struct FailProfileDeleteSecrets {
    inner: MemorySecrets,
}

impl RuntimeSecrets for FailProfileDeleteSecrets {
    fn get(&self, account: &str) -> Result<Option<String>, String> {
        self.inner.get(account)
    }

    fn set(&self, account: &str, secret: &str) -> Result<(), String> {
        self.inner.set(account, secret)
    }

    fn delete(&self, account: &str) -> Result<(), String> {
        if account.ends_with(":profile:db") {
            return Err("simulated keychain delete failure".to_string());
        }
        self.inner.delete(account)
    }
}

#[tokio::test]
async fn delete_credential_profile_restores_metadata_when_keychain_delete_fails() {
    let temp = tempfile::tempdir().unwrap();
    let runtime = RuntimeContext::new(
        Arc::new(FixedRuntimePaths::new(
            temp.path().to_path_buf(),
            temp.path().to_path_buf(),
        )),
        Arc::new(NoopRuntimeEvents),
        Arc::new(FailProfileDeleteSecrets {
            inner: MemorySecrets::default(),
        }),
    );
    let state = Arc::new(ApplicationState::default());

    let created = execute(
        &runtime,
        &state,
        ConnectionCommand::CreateCredentialProfile {
            name: "Disposable".to_string(),
            username: "user".to_string(),
            password: "profile-secret".to_string(),
        },
    )
    .await
    .unwrap();
    let profile_id = created["id"].as_str().unwrap().to_string();

    let error = execute(
        &runtime,
        &state,
        ConnectionCommand::DeleteCredentialProfile {
            id: profile_id.clone(),
        },
    )
    .await
    .unwrap_err();
    assert!(error.contains("keychain"));

    let file =
        crate::persistence::load_connections_file(&runtime.paths.connections_file()).unwrap();
    assert_eq!(file.credential_profiles.len(), 1);
    assert_eq!(file.credential_profiles[0].id, profile_id);
    assert_eq!(
        runtime
            .secrets
            .get(&profile_db_secret_account(&profile_id))
            .unwrap()
            .as_deref(),
        Some("profile-secret")
    );
}

#[tokio::test]
async fn concurrent_connection_edit_survives_failed_profile_delete_restore() {
    use std::sync::mpsc;
    use std::time::Duration;

    let (_temp, runtime, state, secrets) = fixture_with_secrets();
    let profile = execute(
        &runtime,
        &state,
        ConnectionCommand::CreateCredentialProfile {
            name: "Shared".to_string(),
            username: "shared-user".to_string(),
            password: "profile-secret".to_string(),
        },
    )
    .await
    .unwrap();
    let profile_id = profile["id"].as_str().unwrap().to_string();
    secrets
        .set(&profile_db_secret_account(&profile_id), "profile-secret")
        .unwrap();

    let mut params = connection_params("local");
    params.save_in_keychain = Some(false);
    execute(
        &runtime,
        &state,
        ConnectionCommand::SaveConnection {
            name: "Side connection".to_string(),
            params,
            plugin_secret_changes: None,
            detect_json_in_text_columns: None,
            environment: None,
        },
    )
    .await
    .unwrap();

    let path = runtime.paths.connections_file();
    let (concurrent_done, wait_for_concurrent) = mpsc::channel();
    let on_delete = Arc::new(move || {
        let mut file = crate::persistence::load_connections_file(&path).unwrap();
        let connection = file
            .connections
            .iter_mut()
            .find(|connection| connection.name == "Side connection")
            .expect("side connection");
        connection.name = "Concurrent-Edit".to_string();
        crate::persistence::save_connections_file(&path, &file).unwrap();
        concurrent_done.send(()).unwrap();
    });

    struct FailProfileDeleteWithHook {
        inner: Arc<MemorySecrets>,
        on_delete: Arc<dyn Fn() + Send + Sync>,
    }

    impl RuntimeSecrets for FailProfileDeleteWithHook {
        fn get(&self, account: &str) -> Result<Option<String>, String> {
            self.inner.get(account)
        }

        fn set(&self, account: &str, secret: &str) -> Result<(), String> {
            self.inner.set(account, secret)
        }

        fn delete(&self, account: &str) -> Result<(), String> {
            if account.ends_with(":profile:db") {
                (self.on_delete)();
                return Err("simulated keychain delete failure".to_string());
            }
            self.inner.delete(account)
        }
    }

    let runtime = RuntimeContext::new(
        runtime.paths.clone(),
        runtime.events.clone(),
        Arc::new(FailProfileDeleteWithHook {
            inner: secrets.clone(),
            on_delete,
        }),
    );

    let error = execute(
        &runtime,
        &state,
        ConnectionCommand::DeleteCredentialProfile {
            id: profile_id.clone(),
        },
    )
    .await
    .unwrap_err();
    wait_for_concurrent
        .recv_timeout(Duration::from_secs(5))
        .expect("concurrent writer must finish during keychain delete");
    assert!(error.contains("keychain"));

    let saved =
        crate::persistence::load_connections_file(&runtime.paths.connections_file()).unwrap();
    assert_eq!(saved.credential_profiles.len(), 1);
    assert_eq!(saved.credential_profiles[0].id, profile_id);
    let side = saved
        .connections
        .iter()
        .find(|connection| connection.name == "Concurrent-Edit")
        .expect("concurrent connection edit");
    assert_eq!(side.name, "Concurrent-Edit");
}

#[tokio::test]
async fn delete_credential_profile_does_not_remove_colliding_connection_db_secret() {
    let (_temp, runtime, state, secrets) = fixture_with_secrets();
    let account = profile_db_secret_account("abc");
    secrets.set(&account, "connection-owned-secret").unwrap();
    store_profile_fixture(
        &runtime,
        vec![profile_connection("abc:profile", "conn-user", None, None)],
        vec![credential_profile("abc", "profile-user")],
    );

    let error = execute(
        &runtime,
        &state,
        ConnectionCommand::DeleteCredentialProfile {
            id: "abc".to_string(),
        },
    )
    .await
    .unwrap_err();
    assert!(error.contains("abc:profile"));

    let file =
        crate::persistence::load_connections_file(&runtime.paths.connections_file()).unwrap();
    assert_eq!(file.credential_profiles.len(), 1);
    assert_eq!(
        secrets.get(&account).unwrap().as_deref(),
        Some("connection-owned-secret")
    );
}
