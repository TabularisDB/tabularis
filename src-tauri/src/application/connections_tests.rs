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
