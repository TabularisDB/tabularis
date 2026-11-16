use super::*;
use crate::runtime::events::RuntimeEvents;
use crate::runtime::paths::FixedRuntimePaths;
use crate::runtime::secrets::RuntimeSecrets;
use std::sync::{Arc, Mutex};

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
async fn shares_state_through_the_config_folder_and_announces_changes() {
    let temp = tempfile::tempdir().unwrap();
    let events = Arc::new(RecordingEvents::default());
    let runtime = RuntimeContext::new(
        Arc::new(FixedRuntimePaths::new(
            temp.path().to_path_buf(),
            temp.path().join("data"),
        )),
        events.clone(),
        Arc::new(NoSecrets),
    );

    execute(
        &runtime,
        UiStateCommand::Set {
            key: "tabularis_last_seen_version".into(),
            value: json!("0.25.0"),
        },
    )
    .await
    .unwrap();
    let all = execute(&runtime, UiStateCommand::Get { keys: None })
        .await
        .unwrap();
    assert_eq!(all, json!({ "tabularis_last_seen_version": "0.25.0" }));
    assert!(temp.path().join(crate::ui_state::DATABASE_FILE).exists());

    execute(
        &runtime,
        UiStateCommand::Delete {
            key: "tabularis_last_seen_version".into(),
        },
    )
    .await
    .unwrap();
    // Deleting a missing key is not announced.
    execute(
        &runtime,
        UiStateCommand::Delete {
            key: "tabularis_last_seen_version".into(),
        },
    )
    .await
    .unwrap();

    let emitted = events.values.lock().unwrap().clone();
    assert_eq!(
        emitted,
        vec![
            (
                UI_STATE_CHANGED_EVENT.to_string(),
                json!({ "key": "tabularis_last_seen_version", "value": "0.25.0" })
            ),
            (
                UI_STATE_CHANGED_EVENT.to_string(),
                json!({ "key": "tabularis_last_seen_version", "value": null })
            ),
        ]
    );
    crate::ui_state::close(&crate::ui_state::database_path(temp.path())).await;
}
