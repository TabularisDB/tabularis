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

#[test]
fn tunnel_test_log_reports_the_socks5_listener_instead_of_the_database_port() {
    let mut resolved = connection_params("");
    resolved.port = Some(27017);
    assert_eq!(
        tunnel_endpoint_detail(&resolved).as_deref(),
        Some("127.0.0.1:27017")
    );

    resolved.socks5_proxy_host = Some("127.0.0.1".to_string());
    resolved.socks5_proxy_port = Some(40123);
    assert_eq!(
        tunnel_endpoint_detail(&resolved).as_deref(),
        Some("SOCKS5 127.0.0.1:40123")
    );
}

#[test]
fn test_log_host_port_keeps_url_hosts_and_named_ports() {
    assert_eq!(display_host_port("localhost", 5432), "localhost:5432");
    assert_eq!(display_host_port("192.168.1.10", 3306), "192.168.1.10:3306");
    assert_eq!(
        display_host_port("ws://127.0.0.1:8010", 8000),
        "ws://127.0.0.1:8010"
    );
    assert_eq!(
        display_host_port("wss://db.example.com", 8000),
        "wss://db.example.com"
    );
    assert_eq!(
        display_host_port("mongodb+srv://cluster.example.net", 27017),
        "mongodb+srv://cluster.example.net"
    );
    assert_eq!(
        display_host_port("db.example.com:5433", 5432),
        "db.example.com:5433"
    );
    assert_eq!(display_host_port("[::1]:5433", 5432), "[::1]:5433");
}

#[test]
fn test_log_host_port_brackets_bare_ipv6_hosts() {
    assert_eq!(display_host_port("[::1]", 5432), "[::1]:5432");
    assert_eq!(display_host_port("::1", 5432), "[::1]:5432");
    assert_eq!(display_host_port("2001:db8::1", 5432), "[2001:db8::1]:5432");
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
        managed: false,
    };

    bind_sql_builder_secrets(&runtime, &mut connection);
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

#[tokio::test]
async fn opening_data_files_saves_one_workspace_connection_and_reuses_it() {
    // The driver is looked up in the process-wide registry.
    let _registry = crate::drivers::registry::REGISTRY_TEST_LOCK.lock().await;
    let (temp, runtime, state) = fixture();
    let mut manifest = crate::plugins::driver::test_manifest();
    manifest.id = "data-file-workspace-test".to_string();
    manifest.capabilities.file_based = true;
    manifest.capabilities.data_files = vec!["parquet".to_string()];
    crate::drivers::registry::register_driver(crate::plugins::driver::test_driver_with_manifest(
        manifest,
        |_| Ok(Value::Null),
    ))
    .await;
    let open = |file_name: &'static str, workspace_name: &'static str| {
        let path = temp.path().join(file_name);
        fs::write(&path, b"PAR1").unwrap();
        execute(
            &runtime,
            &state,
            ConnectionCommand::OpenDataFile {
                source: crate::application::data_files::DataFileSource::ServerPath(path),
                workspace_name: workspace_name.to_string(),
            },
        )
    };

    let first = open("metrics.parquet", "Data files").await.unwrap();
    let second = open("events.parquet", "Renamed later").await.unwrap();
    let unnamed_reuse = open("more.parquet", " ").await.unwrap();

    let connections = load_file(&runtime).unwrap().connections;
    assert_eq!(connections.len(), 1);
    assert_eq!(connections[0].name, "Data files");
    assert_eq!(connections[0].params.driver, "data-file-workspace-test");
    assert_eq!(first["connectionId"], connections[0].id);
    assert_eq!(first["driver"], "data-file-workspace-test");
    assert_eq!(first["table"], "metrics");
    assert_eq!(first["format"], "parquet");
    assert_eq!(second["connectionId"], first["connectionId"]);
    assert_eq!(second["table"], "events");
    assert_eq!(unnamed_reuse["connectionId"], first["connectionId"]);

    let unsupported = temp.path().join("report.xlsx");
    fs::write(&unsupported, b"PK").unwrap();
    let error = execute(
        &runtime,
        &state,
        ConnectionCommand::OpenDataFile {
            source: crate::application::data_files::DataFileSource::ServerPath(unsupported),
            workspace_name: "Data files".to_string(),
        },
    )
    .await
    .unwrap_err();
    assert_eq!(error, "No installed driver can open xlsx data files");

    crate::drivers::registry::unregister_driver("data-file-workspace-test").await;
}

#[test]
fn collected_secrets_cover_keychain_inline_plugin_and_ssh_profile_values() {
    let (_temp, runtime, state) = fixture();
    let mut params = connection_params("keychain-db-secret");
    params.driver = "test-plugin".to_string();
    params.connection_uri = Some("pg://user:uri-secret@host/db".to_string());
    let changes = HashMap::from([("token".to_string(), Some("plugin-secret".to_string()))]);
    save_connection(
        &runtime,
        &state,
        "Secrets".into(),
        params,
        changes,
        None,
        None,
    )
    .unwrap();

    let values = collect_secret_values(&runtime).unwrap();
    assert!(values.contains(&"keychain-db-secret".to_string()));
    assert!(values.contains(&"plugin-secret".to_string()));
    assert!(values.iter().all(|value| !value.is_empty()));
}

#[test]
fn redacted_connections_drop_every_credential_field() {
    let mut params = connection_params("db-secret");
    params.connection_uri = Some("uri-secret".to_string());
    params.ssh_password = Some("ssh-secret".to_string());
    params.ssh_key_passphrase = Some("passphrase-secret".to_string());
    params.socks5_proxy_username = Some("socks-user".to_string());
    params.socks5_proxy_password = Some("socks-secret".to_string());
    params.proxy = Some(crate::proxy::ProxyOverride {
        mode: crate::proxy::ProxyMode::Custom,
        endpoint: Some(crate::proxy::ProxyEndpoint {
            protocol: Default::default(),
            host: "proxy.internal".to_string(),
            port: 3128,
            username: Some("proxy-user".to_string()),
            password: Some("proxy-secret".to_string()),
        }),
    });
    let connection = SavedConnection {
        id: "c".into(),
        name: "c".into(),
        params,
        plugin_secret_keys: Vec::new(),
        group_id: None,
        sort_order: None,
        detect_json_in_text_columns: None,
        appearance: None,
        tag_ids: None,
        environment: None,
        managed: true,
    };

    let json = serde_json::to_string(&redact_connection(connection)).unwrap();
    for secret in [
        "db-secret",
        "uri-secret",
        "ssh-secret",
        "passphrase-secret",
        "socks-secret",
        "proxy-secret",
    ] {
        assert!(!json.contains(secret), "{secret} leaked");
    }
}

#[test]
fn updating_and_duplicating_never_clear_or_copy_the_managed_marker() {
    let (_temp, runtime, state) = fixture();
    let saved = save_connection(
        &runtime,
        &state,
        "Marked".into(),
        connection_params("db-secret"),
        HashMap::new(),
        None,
        None,
    )
    .unwrap();
    assert!(!saved.managed);

    let mut file = load_file(&runtime).unwrap();
    file.connections[0].managed = true;
    save_file(&runtime, &state, &file).unwrap();

    let updated = update_connection(
        &runtime,
        &state,
        saved.id.clone(),
        "Renamed".into(),
        connection_params("db-secret"),
        HashMap::new(),
        None,
        None,
    )
    .unwrap();
    assert!(updated.managed);

    let duplicate = duplicate_connection(&runtime, &state, &saved.id).unwrap();
    assert!(!duplicate.managed);
}
