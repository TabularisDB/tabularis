use super::{snapshot_params, snapshot_target, target_matches};
use crate::application::connections::{execute, ConnectionCommand};
use crate::models::{ConnectionParams, DatabaseSelection};
use crate::runtime::events::NoopRuntimeEvents;
use crate::runtime::paths::FixedRuntimePaths;
use crate::runtime::secrets::RuntimeSecrets;
use crate::runtime::state::ApplicationState;
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

fn params(host: &str, username: &str) -> ConnectionParams {
    ConnectionParams {
        driver: "postgres".to_string(),
        host: Some(host.to_string()),
        port: Some(5432),
        username: Some(username.to_string()),
        database: DatabaseSelection::Single("app".to_string()),
        ..Default::default()
    }
}

#[tokio::test]
async fn a_connection_edited_after_the_target_check_is_not_the_one_opened() {
    let temp = tempfile::tempdir().unwrap();
    let runtime = RuntimeContext::new(
        Arc::new(FixedRuntimePaths::new(
            temp.path().to_path_buf(),
            temp.path().to_path_buf(),
        )),
        Arc::new(NoopRuntimeEvents),
        Arc::new(NoSecrets),
    );
    let state = Arc::new(ApplicationState::default());
    let saved = execute(
        &runtime,
        &state,
        ConnectionCommand::SaveConnection {
            name: "Prod".to_string(),
            params: params("prod.internal", "app"),
            plugin_secret_changes: None,
            detect_json_in_text_columns: None,
            environment: None,
        },
    )
    .await
    .unwrap();
    let id = saved["id"].as_str().unwrap().to_string();

    // What a restore does: fingerprint the connection, compare it with the
    // record, then open the connection.
    let checked = snapshot_target(&runtime, &id).unwrap();
    let recorded_on = checked.fingerprint.clone();
    assert!(target_matches(
        &record_on(&recorded_on),
        &checked.fingerprint
    ));

    // The connection is repointed after the check and before the open.
    execute(
        &runtime,
        &state,
        ConnectionCommand::UpdateConnection {
            id: id.clone(),
            name: "Prod".to_string(),
            params: params("staging.internal", "postgres.staging"),
            plugin_secret_changes: None,
            detect_json_in_text_columns: None,
            environment: None,
        },
    )
    .await
    .unwrap();

    let opened = snapshot_params(&runtime, None, &checked.snapshot, None).unwrap();
    assert_eq!(opened.host.as_deref(), Some("prod.internal"));
    assert_eq!(opened.username.as_deref(), Some("app"));

    let after = snapshot_target(&runtime, &id).unwrap();
    assert_ne!(after.fingerprint, recorded_on);
    assert!(!target_matches(
        &record_on(&recorded_on),
        &after.fingerprint
    ));
}

fn record_on(target: &str) -> super::SaveRecord {
    super::SaveRecord {
        id: "r".to_string(),
        saved_at: chrono::Utc::now().to_rfc3339(),
        database: None,
        schema: None,
        table: "t".to_string(),
        target: Some(target.to_string()),
        key: Default::default(),
        columns: vec![],
        restorable: true,
        non_restorable_reason: None,
        restored_at: None,
    }
}
